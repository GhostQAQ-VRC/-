package com.hoshikuzu.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import androidx.exifinterface.media.ExifInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Phone-side library: copies picked originals into app storage, generates WebP
 * thumbnails, and returns DesktopImportDraft-shaped JSON so the shared frontend
 * import flow works unchanged.
 */
final class MobileLibrary {
    private static final Pattern WORLD_PATTERN = Pattern.compile(
            "wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern FILE_DATE = Pattern.compile(
            "(20\\d{2})[-_](\\d{2})[-_](\\d{2})[ _-](\\d{2})[-_.:](\\d{2})[-_.:](\\d{2})");
    private static final SimpleDateFormat EXIF_DATE =
            new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US);

    private MobileLibrary() {
    }

    static void importUris(Activity activity, WebView webView, List<Uri> uris,
                           String callbackId, int maxEdge, int quality) {
        new Thread(() -> {
            JSONArray drafts = new JSONArray();
            JSONArray errors = new JSONArray();
            try {
                for (Uri uri : uris) {
                    try {
                        JSONObject draft = importOne(activity, uri, maxEdge, quality);
                        if (draft != null) drafts.put(draft);
                    } catch (Exception error) {
                        JSONObject item = new JSONObject();
                        item.put("file", displayName(activity, uri));
                        item.put("message", error.getMessage() == null
                                ? "导入失败" : error.getMessage());
                        errors.put(item);
                    }
                }
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("canceled", false);
                result.put("drafts", drafts);
                result.put("errors", errors);
                deliver(activity, webView, callbackId, result.toString());
            } catch (Exception error) {
                try {
                    JSONObject result = new JSONObject();
                    result.put("ok", false);
                    result.put("canceled", false);
                    result.put("drafts", new JSONArray());
                    result.put("errors", new JSONArray());
                    result.put("error", error.getMessage() == null ? "导入失败" : error.getMessage());
                    deliver(activity, webView, callbackId, result.toString());
                } catch (Exception ignored) {
                    // The page may be gone.
                }
            }
        }, "hoshikuzu-import").start();
    }

    static void deliverCanceled(Activity activity, WebView webView, String callbackId) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("canceled", true);
            result.put("drafts", new JSONArray());
            result.put("errors", new JSONArray());
            deliver(activity, webView, callbackId, result.toString());
        } catch (Exception ignored) {
            // Ignore.
        }
    }

    private static void deliver(Activity activity, WebView webView,
                                String callbackId, String json) {
        if (webView == null) return;
        activity.runOnUiThread(() -> {
            try {
                String script = "window.__hoshikuzuMobilePickResult&&window.__hoshikuzuMobilePickResult("
                        + JSONObject.quote(callbackId) + "," + JSONObject.quote(json) + ")";
                webView.evaluateJavascript(script, null);
            } catch (Exception ignored) {
                // WebView may be destroyed.
            }
        });
    }

    private static JSONObject importOne(Activity activity, Uri uri,
                                        int maxEdge, int quality) throws Exception {
        ContentResolver resolver = activity.getContentResolver();
        String displayName = displayName(activity, uri);
        String mime = resolver.getType(uri);
        String extension = extensionFor(displayName, mime);

        File originalDir = new File(baseDir(activity), "originals");
        File previewDir = new File(baseDir(activity), "previews");
        if (!originalDir.exists() && !originalDir.mkdirs()) {
            throw new Exception("无法创建原图目录");
        }
        if (!previewDir.exists() && !previewDir.mkdirs()) {
            throw new Exception("无法创建缩略图目录");
        }

        File temp = new File(activity.getCacheDir(),
                "hoshikuzu-import-" + UUID.randomUUID() + ".bin");
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        long bytes = 0;
        try (InputStream input = resolver.openInputStream(uri);
             FileOutputStream output = new FileOutputStream(temp)) {
            if (input == null) throw new Exception("无法读取相册文件");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                bytes += read;
            }
        }

        String hash = hex(digest.digest());
        String originalName = hash + extension;
        File original = new File(originalDir, originalName);
        if (!original.exists()) {
            if (!temp.renameTo(original)) {
                copyFile(temp, original);
                //noinspection ResultOfMethodCallIgnored
                temp.delete();
            }
        } else {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
        }

        ExifInterface exif = null;
        try {
            exif = new ExifInterface(original.getAbsolutePath());
        } catch (Exception ignored) {
            // Some formats have no EXIF; filename/mtime still work.
        }

        int orientation = exif == null ? ExifInterface.ORIENTATION_NORMAL
                : exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(original.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new Exception("无法解码这张图片");
        }

        int sample = 1;
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        while (longest / (sample * 2) >= maxEdge * 2) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap decoded = BitmapFactory.decodeFile(original.getAbsolutePath(), options);
        if (decoded == null) throw new Exception("无法解码这张图片");

        Bitmap oriented = applyOrientation(decoded, orientation);
        int width = oriented.getWidth();
        int height = oriented.getHeight();
        float scale = Math.min(1f, (float) maxEdge / Math.max(width, height));
        Bitmap preview = scale >= 1f
                ? oriented
                : Bitmap.createScaledBitmap(oriented,
                Math.max(1, Math.round(width * scale)),
                Math.max(1, Math.round(height * scale)), true);

        String previewName = hash + "_" + maxEdge + "_q" + quality + ".webp";
        File previewFile = new File(previewDir, previewName);
        try (FileOutputStream output = new FileOutputStream(previewFile)) {
            if (!preview.compress(Bitmap.CompressFormat.WEBP, quality, output)) {
                throw new Exception("无法生成缩略图");
            }
        }

        if (preview != oriented) preview.recycle();
        if (oriented != decoded) oriented.recycle();
        decoded.recycle();

        DateMetadata date = captureDate(exif, displayName, original.lastModified());
        String worldText = displayName;
        if (exif != null) {
            worldText += "\n" + safe(exif.getAttribute(ExifInterface.TAG_XMP))
                    + "\n" + safe(exif.getAttribute(ExifInterface.TAG_IMAGE_DESCRIPTION))
                    + "\n" + safe(exif.getAttribute(ExifInterface.TAG_USER_COMMENT));
        }
        Matcher world = WORLD_PATTERN.matcher(worldText);
        String worldId = world.find() ? world.group() : null;

        JSONObject draft = new JSONObject();
        draft.put("src", "");
        draft.put("alt", displayName);
        draft.put("capturedAt", date.iso);
        draft.put("width", width);
        draft.put("height", height);
        draft.put("fileBytes", bytes);
        draft.put("contentHash", hash);
        draft.put("libraryPath", originalName);
        draft.put("previewPath", previewName);
        draft.put("metaSource", date.source);
        if (worldId != null) draft.put("worldId", worldId);
        draft.put("managedCopy", true);
        return draft;
    }

    private static Bitmap applyOrientation(Bitmap bitmap, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.postRotate(90);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.postRotate(180);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.postScale(1, -1);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.postRotate(90);
                matrix.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.postRotate(270);
                matrix.postScale(-1, 1);
                break;
            default:
                return bitmap;
        }
        Bitmap transformed = Bitmap.createBitmap(
                bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (transformed != bitmap) bitmap.recycle();
        return transformed;
    }

    private static DateMetadata captureDate(ExifInterface exif, String name, long modified) {
        if (exif != null) {
            String value = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            if (value == null) value = exif.getAttribute(ExifInterface.TAG_DATETIME);
            if (value != null) {
                try {
                    Date date = EXIF_DATE.parse(value);
                    if (date != null) {
                        return new DateMetadata(Instant.ofEpochMilli(date.getTime()).toString(), "exif");
                    }
                } catch (Exception ignored) {
                    // Fall through to filename/mtime.
                }
            }
        }
        Matcher matcher = FILE_DATE.matcher(name);
        if (matcher.find()) {
            try {
                LocalDateTime local = LocalDateTime.of(
                        Integer.parseInt(matcher.group(1)),
                        Integer.parseInt(matcher.group(2)),
                        Integer.parseInt(matcher.group(3)),
                        Integer.parseInt(matcher.group(4)),
                        Integer.parseInt(matcher.group(5)),
                        Integer.parseInt(matcher.group(6)));
                String iso = local.atZone(ZoneId.systemDefault()).toInstant().toString();
                return new DateMetadata(iso, "filename");
            } catch (Exception ignored) {
                // Fall through.
            }
        }
        return new DateMetadata(Instant.ofEpochMilli(modified).toString(), "mtime");
    }

    static boolean deleteManaged(Activity activity, String hash) {
        if (hash == null || hash.length() < 8) return false;
        boolean removed = false;
        File base = baseDir(activity);
        for (String folder : new String[]{"originals", "previews"}) {
            File[] files = new File(base, folder).listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (file.getName().startsWith(hash)) {
                    //noinspection ResultOfMethodCallIgnored
                    if (file.delete()) removed = true;
                }
            }
        }
        return removed;
    }

    private static File baseDir(Activity activity) {
        return new File(activity.getFilesDir(), "mobile-library");
    }

    private static String displayName(Activity activity, Uri uri) {
        try (Cursor cursor = activity.getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // Fall back to the last path segment.
        }
        String segment = uri.getLastPathSegment();
        return segment == null || segment.isEmpty() ? "手机照片" : segment;
    }

    private static String extensionFor(String name, String mime) {
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            String extension = name.substring(dot).toLowerCase(Locale.ROOT);
            if (extension.matches("\\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)")) {
                return extension.equals(".jpeg") ? ".jpg" : extension;
            }
        }
        String fromMime = mime == null ? null
                : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        if (fromMime != null && !fromMime.isEmpty()) return "." + fromMime;
        return ".jpg";
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format(Locale.ROOT, "%02x", value));
        }
        return builder.toString();
    }

    private static void copyFile(File source, File target) throws Exception {
        try (FileInputStream input = new FileInputStream(source);
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private static final class DateMetadata {
        final String iso;
        final String source;

        DateMetadata(String iso, String source) {
            this.iso = iso;
            this.source = source;
        }
    }
}
