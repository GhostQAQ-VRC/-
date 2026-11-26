package com.hoshikuzu.mobile;

import android.app.Activity;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Native HTTP for AI and cloud providers. A WebView cannot call arbitrary
 * provider endpoints (CORS, WebDAV methods, OAuth headers), so the shared
 * frontend routes those requests through this bridge instead of fetching
 * directly. Binary bodies use base64.
 */
final class HttpBridge {
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    private HttpBridge() {
    }

    static void request(Activity activity, WebView webView, String callbackId, String json) {
        new Thread(() -> {
            JSONObject result = new JSONObject();
            try {
                JSONObject request = new JSONObject(json);
                String url = request.getString("url");
                String method = request.optString("method", "GET").toUpperCase();
                int timeoutMs = request.optInt("timeoutMs", 60000);
                boolean binaryResponse = request.optBoolean("binaryResponse", false);

                Request.Builder builder = new Request.Builder().url(url);
                JSONObject headers = request.optJSONObject("headers");
                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        builder.header(key, headers.optString(key, ""));
                    }
                }

                byte[] bodyBytes = null;
                String contentType = null;
                if (request.has("bodyBase64")) {
                    bodyBytes = Base64.decode(request.getString("bodyBase64"), Base64.DEFAULT);
                } else if (request.has("body") && !request.isNull("body")) {
                    bodyBytes = request.getString("body")
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                }
                if (headers != null) contentType = headers.optString("content-type", null);
                if (bodyBytes != null || method.equals("POST") || method.equals("PUT")
                        || method.equals("PATCH")) {
                    MediaType mediaType = MediaType.parse(
                            contentType == null ? "application/octet-stream" : contentType);
                    builder.method(method, RequestBody.create(
                            bodyBytes == null ? new byte[0] : bodyBytes, mediaType));
                } else {
                    builder.method(method, null);
                }

                OkHttpClient client = CLIENT.newBuilder()
                        .readTimeout(Math.max(5000, timeoutMs), TimeUnit.MILLISECONDS)
                        .writeTimeout(Math.max(5000, timeoutMs), TimeUnit.MILLISECONDS)
                        .callTimeout(Math.max(10000, timeoutMs + 5000), TimeUnit.MILLISECONDS)
                        .build();

                try (Response response = client.newCall(builder.build()).execute()) {
                    ResponseBody responseBody = response.body();
                    byte[] bytes = responseBody == null ? new byte[0] : responseBody.bytes();
                    result.put("ok", response.isSuccessful());
                    result.put("status", response.code());
                    JSONObject responseHeaders = new JSONObject();
                    Headers responseHeadersRaw = response.headers();
                    for (String name : responseHeadersRaw.names()) {
                        responseHeaders.put(name, responseHeadersRaw.get(name));
                    }
                    result.put("headers", responseHeaders);
                    if (binaryResponse) {
                        result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    } else {
                        result.put("body", new String(bytes,
                                java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
            } catch (Exception error) {
                try {
                    result.put("ok", false);
                    result.put("status", 0);
                    result.put("error", error.getMessage() == null
                            ? error.getClass().getSimpleName() : error.getMessage());
                } catch (Exception ignored) {
                    // Ignore.
                }
            }
            deliver(activity, webView, callbackId, result.toString());
        }, "hoshikuzu-http").start();
    }

    private static void deliver(Activity activity, WebView webView,
                                String callbackId, String json) {
        if (webView == null) return;
        activity.runOnUiThread(() -> {
            try {
                String script =
                        "window.__hoshikuzuMobileHttpResult&&window.__hoshikuzuMobileHttpResult("
                                + JSONObject.quote(callbackId) + "," + JSONObject.quote(json) + ")";
                webView.evaluateJavascript(script, null);
            } catch (Exception ignored) {
                // WebView may be gone.
            }
        });
    }
}
