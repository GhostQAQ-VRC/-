package com.hoshikuzu.mobile;

import android.webkit.JavascriptInterface;

import java.lang.ref.WeakReference;

/**
 * Minimal JS bridge for the LAN client. The web app calls saveUrl() for both
 * the automatic "save" cast mode and the manual save button. Downloads are
 * streamed natively with the WebView's cookies, so large originals never pass
 * through a base64 string or a blob URL.
 */
public class SaveBridge {
    private final WeakReference<MainActivity> activityRef;

    SaveBridge(MainActivity activity) {
        this.activityRef = new WeakReference<>(activity);
    }

    @JavascriptInterface
    public boolean saveUrl(String name, String url) {
        MainActivity activity = activityRef.get();
        if (activity == null || activity.isFinishing()) return false;
        if (url == null) return false;
        String target = url.trim();
        if (!target.startsWith("http://") && !target.startsWith("https://")) return false;
        if (target.startsWith("http://") && !activity.isAllowedHttpDownload(target)) {
            return false;
        }
        activity.requestNativeSave(name, target);
        return true;
    }

    @JavascriptInterface
    public void toast(String message) {
        MainActivity activity = activityRef.get();
        if (activity == null || message == null) return;
        activity.runOnUiThread(() ->
                android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public String appVersion() {
        return "1.1.0";
    }
}
