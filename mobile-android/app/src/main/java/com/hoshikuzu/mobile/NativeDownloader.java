package com.hoshikuzu.mobile;

import android.content.Context;
import android.media.MediaScannerConnection;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * Streams a remote original into the phone's Downloads collection. MediaStore
 * is used on Android 10+ (no permission); Android 8/9 write to the public
 * Downloads folder after the runtime permission granted by MainActivity.
 */
final class NativeDownloader {
    private static final int BUFFER = 64 * 1024;

    private NativeDownloader() {
    }

    static void save(Context context, String url, String suggestedName) {
        Context appContext = context.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL parsed = new URL(url);
                connection = (HttpURLConnection) parsed.openConnection();
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(90_000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "HoshikuzuMobile/1.1.0");
                connection.setRequestProperty("Accept", "image/*,*/*;q=0.8");
                String cookie = CookieManager.getInstance().getCookie(url);
                if (!TextUtils.isEmpty(cookie)) {
                    connection.setRequestProperty("Cookie", cookie);
                }

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IOException("HTTP " + status);
                }

                String mime = connection.getContentType();
                String disposition = connection.getHeaderField("Content-Disposition");
                String name = sanitizeName(suggestedName);
                if (TextUtils.isEmpty(name)) {
                    name = URLUtil.guessFileName(url, disposition, mime);
                }
                name = sanitizeName(name);
                if (TextUtils.isEmpty(name)) {
                    name = "hoshikuzu-" + System.currentTimeMillis() + extensionFor(mime, url);
                } else if (!hasExtension(name)) {
                    name = name + extensionFor(mime, url);
                }

                String location;
                try (InputStream input = connection.getInputStream()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        location = MediaStoreSaver.save(appContext, name, mime, input);
                    } else {
                        location = saveToLegacyDownloads(appContext, name, mime, input);
                    }
                }

                final String saved = location;
                main.post(() -> Toast.makeText(appContext,
                        "已保存到 " + saved, Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                String message = error.getMessage();
                if (TextUtils.isEmpty(message)) message = "未知错误";
                final String detail = message;
                main.post(() -> Toast.makeText(appContext,
                        "保存失败：" + detail, Toast.LENGTH_LONG).show());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "hoshikuzu-save").start();
    }

    @SuppressWarnings("deprecation")
    private static String saveToLegacyDownloads(Context context, String name, String mime,
                                                InputStream input) throws IOException {
        File base = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS);
        File directory = new File(base, "Hoshikuzu");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("无法创建下载目录");
        }
        File target = uniqueFile(directory, name);
        try (FileOutputStream output = new FileOutputStream(target)) {
            copy(input, output);
        }
        MediaScannerConnection.scanFile(
                context,
                new String[]{target.getAbsolutePath()},
                new String[]{TextUtils.isEmpty(mime) ? guessMime(name) : mime},
                null);
        return "下载/Hoshikuzu/" + target.getName();
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[BUFFER];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        output.flush();
    }

    private static File uniqueFile(File directory, String name) {
        File candidate = new File(directory, name);
        if (!candidate.exists()) return candidate;
        String stem = name;
        String extension = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            stem = name.substring(0, dot);
            extension = name.substring(dot);
        }
        for (int index = 1; index < 1000; index += 1) {
            candidate = new File(directory, stem + "-" + index + extension);
            if (!candidate.exists()) return candidate;
        }
        return new File(directory, stem + "-" + System.currentTimeMillis() + extension);
    }

    static String sanitizeName(String value) {
        if (value == null) return "";
        String name = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (name.length() > 120) {
            String extension = "";
            int dot = name.lastIndexOf('.');
            if (dot > 0) extension = name.substring(dot);
            name = name.substring(0, 120 - extension.length()) + extension;
        }
        return name;
    }

    private static boolean hasExtension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length() - 1 && name.length() - dot <= 6;
    }

    private static String extensionFor(String mime, String url) {
        String type = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (type.contains("png")) return ".png";
        if (type.contains("webp")) return ".webp";
        if (type.contains("gif")) return ".gif";
        if (type.contains("avif")) return ".avif";
        if (type.contains("heic") || type.contains("heif")) return ".heic";
        if (type.contains("bmp")) return ".bmp";
        if (type.contains("jpeg") || type.contains("jpg")) return ".jpg";
        String lower = url == null ? "" : url.toLowerCase(Locale.ROOT);
        if (lower.contains(".png")) return ".png";
        if (lower.contains(".webp")) return ".webp";
        if (lower.contains(".gif")) return ".gif";
        return ".jpg";
    }

    private static String guessMime(String name) {
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
