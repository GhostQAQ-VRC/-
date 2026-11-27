package com.hoshikuzu.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.webkit.CookieManager;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Local-library actions that need filesystem / MediaStore / OkHttp access:
 * save an imported original to the phone, share it through the system sheet,
 * and upload it back to the paired desktop.
 *
 * Every entry point re-validates the library-relative path; the JS bridge only
 * passes a hash-style file name, never an absolute path.
 */
final class MobileActions {
    private static final String PREFS = "hoshikuzu_mobile";
    private static final String KEY_URL = "server_url";
    private static final String ORIGINAL_PATTERN =
            "^[0-9a-f]{40}(?:-\\d+)?\\.(?:jpe?g|png|webp|gif|avif|heic|heif|bmp)$";
    private static final int MAX_SHARE_FILES = 30;

    private MobileActions() {
    }

    static String save(Context context, String libraryPath, String name) {
        File file = resolveOriginal(context, libraryPath);
        if (file == null) return error("照片文件不存在或路径不合法。");
        String mime = mimeFor(file.getName());
        String safe = NativeDownloader.sanitizeName(name);
        if (TextUtils.isEmpty(safe)) safe = file.getName();
        if (!hasExtension(safe)) safe += extensionOf(file.getName());
        try (InputStream input = new FileInputStream(file)) {
            String location;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                location = MediaStoreSaver.save(context, safe, mime, input);
            } else {
                location = NativeDownloader.saveToLegacyDownloads(context, safe, mime, input);
            }
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("location", location);
            return payload.toString();
        } catch (Exception error) {
            return error(error.getMessage() == null ? "保存失败。" : error.getMessage());
        }
    }

    static String share(Activity activity, String libraryPathsJson) {
        try {
            JSONArray array = new JSONArray(libraryPathsJson);
            ArrayList<Uri> uris = new ArrayList<>();
            String authority = activity.getPackageName() + ".fileprovider";
            for (int index = 0; index < array.length() && uris.size() < MAX_SHARE_FILES; index += 1) {
                File file = resolveOriginal(activity, array.optString(index));
                if (file == null) continue;
                uris.add(FileProvider.getUriForFile(activity, authority, file));
            }
            if (uris.isEmpty()) return error("没有可分享的照片。");

            Intent intent;
            if (uris.size() == 1) {
                intent = new Intent(Intent.ACTION_SEND);
                intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            intent.setType("image/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(Intent.createChooser(intent, "分享照片"));

            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("count", uris.size());
            return payload.toString();
        } catch (Exception error) {
            return error(error.getMessage() == null ? "分享失败。" : error.getMessage());
        }
    }

    static String upload(Context context, String libraryPath, String name) {
        File file = resolveOriginal(context, libraryPath);
        if (file == null) return error("照片文件不存在或路径不合法。");

        String base = desktopBaseUrl(context);
        if (TextUtils.isEmpty(base)) return error("请先在手机端连接电脑。");
        String cookie = CookieManager.getInstance().getCookie(base + "/");
        if (TextUtils.isEmpty(cookie)) cookie = CookieManager.getInstance().getCookie(base);
        if (TextUtils.isEmpty(cookie)) {
            return error("配对已过期，请在电脑上刷新二维码后重新连接。");
        }

        String safe = NativeDownloader.sanitizeName(name);
        if (TextUtils.isEmpty(safe)) safe = file.getName();
        if (!hasExtension(safe)) safe += extensionOf(file.getName());

        try {
            String endpoint = base + "/api/mobile/upload?name="
                    + URLEncoder.encode(safe, "UTF-8");
            RequestBody body = RequestBody.create(file,
                    MediaType.parse("application/octet-stream"));
            Request request = new Request.Builder()
                    .url(endpoint)
                    .header("Cookie", cookie)
                    .header("Accept", "application/json")
                    .post(body)
                    .build();
            OkHttpClient client = new OkHttpClient.Builder()
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .writeTimeout(5, TimeUnit.MINUTES)
                    .readTimeout(5, TimeUnit.MINUTES)
                    .callTimeout(6, TimeUnit.MINUTES)
                    .build();
            try (Response response = client.newCall(request).execute()) {
                ResponseBody responseBody = response.body();
                String text = responseBody == null ? "" : responseBody.string();
                if (!response.isSuccessful()) {
                    return error(serverMessage(text, response.code()));
                }
                JSONObject payload = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                if (!payload.optBoolean("ok", true)) {
                    return error(payload.optString("error", "上传失败。"));
                }
                payload.put("http", response.code());
                return payload.toString();
            }
        } catch (Exception error) {
            return error(error.getMessage() == null ? "上传失败。" : error.getMessage());
        }
    }

    /** Origin of the last paired desktop, or "" when the phone is not paired. */
    static String desktopBaseUrl(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(KEY_URL, "");
        if (TextUtils.isEmpty(saved)) return "";
        try {
            Uri uri = Uri.parse(saved);
            String scheme = uri.getScheme();
            if (scheme == null) return "";
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return "";
            String authority = uri.getAuthority();
            if (TextUtils.isEmpty(authority)) return "";
            int at = authority.lastIndexOf('@');
            if (at >= 0) authority = authority.substring(at + 1);
            return scheme + "://" + authority;
        } catch (Exception error) {
            return "";
        }
    }

    static File resolveOriginal(Context context, String libraryPath) {
        String name = String.valueOf(libraryPath == null ? "" : libraryPath).trim();
        if (!name.matches(ORIGINAL_PATTERN)) return null;
        File directory = new File(context.getFilesDir(), "mobile-library/originals");
        File file = new File(directory, name);
        try {
            String base = directory.getCanonicalPath() + File.separator;
            if (!file.getCanonicalPath().startsWith(base)) return null;
        } catch (Exception error) {
            return null;
        }
        return file.isFile() ? file : null;
    }

    private static String serverMessage(String text, int status) {
        try {
            JSONObject json = new JSONObject(text);
            String message = json.optString("error", "");
            if (!TextUtils.isEmpty(message)) return message;
        } catch (Exception ignored) {
            // Fall back to the HTTP status.
        }
        return "电脑返回 HTTP " + status + "。";
    }

    private static String error(String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", false);
            payload.put("error", message == null || message.isEmpty() ? "操作失败。" : message);
            return payload.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"操作失败。\"}";
        }
    }

    private static boolean hasExtension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length() - 1 && name.length() - dot <= 6;
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            String extension = name.substring(dot).toLowerCase(Locale.ROOT);
            if (extension.matches("\\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)")) {
                return extension;
            }
        }
        return ".jpg";
    }

    static String mimeFor(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
        if (lower.endsWith(".bmp")) return "image/bmp";
        return "image/jpeg";
    }
}
