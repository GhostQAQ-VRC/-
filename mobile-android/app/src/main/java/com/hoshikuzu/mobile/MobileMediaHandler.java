package com.hoshikuzu.mobile;

import android.content.Context;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves imported originals, generated thumbnails and video backgrounds from
 * the app's private library over the same secure asset origin as the UI. The
 * shared React frontend can therefore use ordinary URLs and preserve the
 * desktop image-loading strategy.
 */
final class MobileMediaHandler implements WebViewAssetLoader.PathHandler {
    private final File base;

    MobileMediaHandler(Context context) {
        base = new File(context.getApplicationContext().getFilesDir(), "mobile-library");
    }

    @Override
    public WebResourceResponse handle(String path) {
        if (path == null) return null;
        String clean = path.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);
        if (clean.isEmpty() || clean.contains("..")) return null;

        String kind;
        String name;
        int slash = clean.indexOf('/');
        if (slash < 0) return null;
        kind = clean.substring(0, slash);
        name = clean.substring(slash + 1);

        File directory;
        switch (kind) {
            case "preview":
                directory = new File(base, "previews");
                break;
            case "original":
                directory = new File(base, "originals");
                break;
            case "background":
                directory = new File(base, "backgrounds");
                break;
            default:
                return null;
        }

        File file = new File(directory, name);
        try {
            String canonicalBase = base.getCanonicalPath() + File.separator;
            if (!file.getCanonicalPath().startsWith(canonicalBase)) return null;
        } catch (Exception error) {
            return null;
        }
        if (!file.isFile() || file.length() == 0) return null;

        try {
            WebResourceResponse response = new WebResourceResponse(
                    mimeFor(file.getName()), null, new FileInputStream(file));
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control",
                    kind.equals("preview") || kind.equals("background")
                            ? "public, max-age=31536000, immutable"
                            : "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            response.setResponseHeaders(headers);
            return response;
        } catch (Exception error) {
            return null;
        }
    }

    private static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 ? name.substring(dot + 1).toLowerCase() : "";
        switch (extension) {
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "webp":
                return "image/webp";
            case "gif":
                return "image/gif";
            case "avif":
                return "image/avif";
            case "heic":
            case "heif":
                return "image/heic";
            case "webm":
                return "video/webm";
            case "mp4":
                return "video/mp4";
            default:
                String guessed = MimeTypeMap.getSingleton()
                        .getMimeTypeFromExtension(extension);
                return guessed == null ? "application/octet-stream" : guessed;
        }
    }
}
