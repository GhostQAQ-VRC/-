package com.hoshikuzu.mobile;

import android.content.Context;
import android.net.Uri;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Phone-local backup helpers: JSON export, full ZIP (album + originals +
 * previews), and ZIP/JSON import through the Android document picker.
 *
 * Imports validate every entry against the mobile-library root (zip-slip),
 * ignore unknown entries, and cap both entry count and expanded bytes.
 */
final class BackupActions {
    private static final int MAX_JSON_BYTES = 30 * 1024 * 1024;
    private static final long MAX_EXTRACT_BYTES = 2L * 1024 * 1024 * 1024;
    private static final int MAX_ENTRIES = 20_000;
    private static final int BUFFER = 64 * 1024;

    private BackupActions() {
    }

    static File writeCacheText(Context context, String text) throws IOException {
        File file = new File(context.getCacheDir(),
            "hoshikuzu-backup-" + System.currentTimeMillis() + ".json");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return file;
    }

    static File buildZip(Context context, String albumJson) throws IOException {
        File file = new File(context.getCacheDir(),
            "hoshikuzu-library-" + System.currentTimeMillis() + ".zip");
        File base = new File(context.getFilesDir(), "mobile-library");
        try (ZipOutputStream zip = new ZipOutputStream(
                new BufferedOutputStream(new FileOutputStream(file)))) {
            zip.putNextEntry(new ZipEntry("album.json"));
            zip.write(albumJson.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            addDirectory(zip, new File(base, "originals"), "originals/");
            addDirectory(zip, new File(base, "previews"), "previews/");
        }
        return file;
    }

    private static void addDirectory(ZipOutputStream zip, File directory, String prefix)
            throws IOException {
        File[] files = directory.listFiles();
        if (files == null) return;
        byte[] buffer = new byte[BUFFER];
        for (File file : files) {
            if (!file.isFile()) continue;
            zip.putNextEntry(new ZipEntry(prefix + file.getName()));
            try (InputStream input = new FileInputStream(file)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    zip.write(buffer, 0, read);
                }
            }
            zip.closeEntry();
        }
    }

    static String exportText(Context context, Uri target, String text) {
        try (OutputStream output = context.getContentResolver().openOutputStream(target)) {
            if (output == null) throw new IOException("无法写入目标文件");
            output.write(text.getBytes(StandardCharsets.UTF_8));
            output.flush();
            return ok(target.toString(), null);
        } catch (Exception error) {
            return error(error.getMessage() == null ? "导出失败。" : error.getMessage());
        }
    }

    static String exportFile(Context context, Uri target, File source) {
        try (InputStream input = new FileInputStream(source);
             OutputStream output = context.getContentResolver().openOutputStream(target)) {
            if (output == null) throw new IOException("无法写入目标文件");
            byte[] buffer = new byte[BUFFER];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
            return ok(target.toString(), null);
        } catch (Exception error) {
            return error(error.getMessage() == null ? "导出失败。" : error.getMessage());
        } finally {
            // Best effort cleanup of the cache copy.
            //noinspection ResultOfMethodCallIgnored
            source.delete();
        }
    }

    static String importDocument(Context context, Uri source) {
        String name = String.valueOf(source.getLastPathSegment() == null
            ? "" : source.getLastPathSegment()).toLowerCase(Locale.ROOT);
        try {
            boolean zip;
            try (InputStream probe = context.getContentResolver().openInputStream(source)) {
                if (probe == null) throw new IOException("无法读取备份文件");
                byte[] head = new byte[4];
                int read = probe.read(head);
                zip = read == 4
                    && head[0] == 'P' && head[1] == 'K'
                    && (head[2] == 3 || head[2] == 5 || head[2] == 7)
                    && (head[3] == 4 || head[3] == 6 || head[3] == 8);
            }
            if (!zip) zip = name.endsWith(".zip");
            if (zip) return importZip(context, source);
            return importJson(context, source);
        } catch (Exception error) {
            return error(error.getMessage() == null ? "导入失败。" : error.getMessage());
        }
    }

    private static String importJson(Context context, Uri source) throws IOException {
        String text;
        try (InputStream input = context.getContentResolver().openInputStream(source)) {
            if (input == null) throw new IOException("无法读取备份文件");
            text = readText(input, MAX_JSON_BYTES);
        }
        if (!text.trim().startsWith("{")) throw new IOException("备份文件不是有效的 JSON");
        return ok(source.toString(), text);
    }

    private static String importZip(Context context, Uri source) throws IOException {
        File base = new File(context.getFilesDir(), "mobile-library");
        String basePath = base.getCanonicalPath() + File.separator;
        String albumJson = null;
        long total = 0;
        int entries = 0;
        byte[] buffer = new byte[BUFFER];

        InputStream raw = context.getContentResolver().openInputStream(source);
        if (raw == null) throw new IOException("无法读取备份文件");
        try (ZipInputStream zip = new ZipInputStream(raw)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries += 1;
                if (entries > MAX_ENTRIES) throw new IOException("压缩包条目过多，已取消导入。");
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                if ("album.json".equals(name) || "hoshikuzu-library.json".equals(name)) {
                    albumJson = readText(zip, MAX_JSON_BYTES);
                    continue;
                }
                if (!name.startsWith("originals/") && !name.startsWith("previews/")) {
                    continue;
                }
                if (name.startsWith("/") || name.contains("..") || name.matches("^[A-Za-z]:.*")) {
                    throw new IOException("压缩包包含不安全的路径。");
                }
                File destination = new File(base, name);
                String canonical = destination.getCanonicalPath();
                if (!canonical.startsWith(basePath)) {
                    throw new IOException("压缩包包含不安全的路径。");
                }
                File parent = destination.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("无法创建相册目录。");
                }
                try (OutputStream output = new FileOutputStream(destination)) {
                    int read;
                    while ((read = zip.read(buffer)) != -1) {
                        total += read;
                        if (total > MAX_EXTRACT_BYTES) {
                            throw new IOException("备份解压后超过 2GB 上限。");
                        }
                        output.write(buffer, 0, read);
                    }
                }
            }
        }
        if (albumJson == null || albumJson.trim().isEmpty()) {
            throw new IOException("压缩包缺少 album.json。");
        }
        return ok(source.toString(), albumJson);
    }

    private static String readText(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[BUFFER];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new IOException("备份文件过大。");
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    static String safeName(String value, String fallback, String extension) {
        String name = NativeDownloader.sanitizeName(value);
        if (name.isEmpty()) name = fallback;
        if (!name.toLowerCase(Locale.ROOT).endsWith(extension)) name += extension;
        return name;
    }

    private static String ok(String path, String text) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("path", path);
            if (text != null) payload.put("text", text);
            return payload.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"操作失败。\"}";
        }
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
}
