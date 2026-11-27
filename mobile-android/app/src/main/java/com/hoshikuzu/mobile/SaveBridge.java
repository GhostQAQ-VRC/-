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

    /** Only the bundled local album page may call the native bridge. */
    private boolean localOnly() {
        return activityRef.get() != null && activityRef.get().isOnLocalOrigin();
    }

    @JavascriptInterface
    public boolean saveUrl(String name, String url) {
        MainActivity activity = activityRef.get();
        if (activity == null || activity.isFinishing() || !localOnly()) return false;
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
        if (activity == null || !localOnly()) return;
        activity.runOnUiThread(() ->
                android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public String appVersion() {
        MainActivity activity = activityRef.get();
        return activity == null ? "1.1.3" : activity.appVersion();
    }

    @JavascriptInterface
    public void pickMedia(String callbackId, int maxEdge, int quality) {
        MainActivity activity = activityRef.get();
        if (activity == null || activity.isFinishing() || !localOnly()) return;
        activity.runOnUiThread(() -> activity.pickMedia(callbackId, maxEdge, quality));
    }

    @JavascriptInterface
    public boolean deleteManaged(String contentHash) {
        MainActivity activity = activityRef.get();
        return activity != null && localOnly() && activity.deleteManaged(contentHash);
    }

    @JavascriptInterface
    public String secureGet(String key) {
        MainActivity activity = activityRef.get();
        return activity == null || !localOnly() ? null : activity.secureGet(key);
    }

    @JavascriptInterface
    public boolean secureSet(String key, String value) {
        MainActivity activity = activityRef.get();
        return activity != null && localOnly() && activity.secureSet(key, value);
    }

    @JavascriptInterface
    public boolean secureDelete(String key) {
        MainActivity activity = activityRef.get();
        return activity != null && localOnly() && activity.secureDelete(key);
    }

    @JavascriptInterface
    public void openExternal(String url) {
        MainActivity activity = activityRef.get();
        if (activity == null || !localOnly()) return;
        activity.runOnUiThread(() -> activity.openExternal(url));
    }

    @JavascriptInterface
    public void httpRequest(String callbackId, String requestJson) {
        MainActivity activity = activityRef.get();
        if (activity == null || !localOnly() || callbackId == null || requestJson == null) return;
        activity.runOnUiThread(() -> activity.httpRequest(callbackId, requestJson));
    }

    @JavascriptInterface
    public String md5Hex(String base64) {
        MainActivity activity = activityRef.get();
        return activity == null || !localOnly() ? "" : activity.md5Hex(base64);
    }

    @JavascriptInterface
    public void openConnect() {
        MainActivity activity = activityRef.get();
        if (activity == null || activity.isFinishing()) return;
        activity.runOnUiThread(() -> activity.showConnect(false));
    }

    @JavascriptInterface
    public void openLocal() {
        MainActivity activity = activityRef.get();
        if (activity == null || activity.isFinishing()) return;
        activity.runOnUiThread(activity::returnToLocal);
    }
}
