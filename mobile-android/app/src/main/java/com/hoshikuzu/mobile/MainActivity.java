package com.hoshikuzu.mobile;

import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "hoshikuzu_mobile";
    private static final String KEY_URL = "server_url";
    private static final String APP_VERSION = "1.1.0";

    private WebView webView;
    private ScrollView setupScroll;
    private LinearLayout loadingLayer;
    private TextView loadingText;
    private TextView statusText;
    private EditText urlInput;

    private String currentUrl;
    private boolean pageReady;
    private boolean mainFrameFailed;
    private static final int REQUEST_SAVE_STORAGE = 4102;
    private String pendingSaveName;
    private String pendingSaveUrl;
    private boolean backPending;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() != null && !result.getContents().trim().isEmpty()) {
                    connectTo(result.getContents(), true);
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        setupScroll = findViewById(R.id.setup_scroll);
        loadingLayer = findViewById(R.id.loading_layer);
        loadingText = findViewById(R.id.loading_text);
        statusText = findViewById(R.id.status_text);
        urlInput = findViewById(R.id.url_input);

        configureWebView();
        bindActions();

        String saved = prefs().getString(KEY_URL, "");
        if (!TextUtils.isEmpty(saved)) {
            urlInput.setText(saved);
            connectTo(saved, false);
        } else {
            showSetup(null);
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(ContextCompat.getColor(this, R.color.status_bar));
        window.setNavigationBarColor(ContextCompat.getColor(this, R.color.bg_deep));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.setNavigationBarDividerColor(ContextCompat.getColor(this, R.color.bg_deep));
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private void bindActions() {
        findViewById(R.id.scan_button).setOnClickListener(v -> launchScanner());
        findViewById(R.id.connect_button).setOnClickListener(v ->
                connectTo(urlInput.getText() == null ? "" : urlInput.getText().toString(), false));
        findViewById(R.id.paste_button).setOnClickListener(v -> pasteFromClipboard());
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                connectTo(urlInput.getText() == null ? "" : urlInput.getText().toString(), false);
                return true;
            }
            return false;
        });
    }

    private void launchScanner() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt(getString(R.string.scan_prompt));
        options.setBeepEnabled(false);
        options.setBarcodeImageEnabled(false);
        options.setOrientationLocked(false);
        scanLauncher.launch(options);
    }

    private void pasteFromClipboard() {
        try {
            ClipboardManager clipboard =
                    (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null && clipboard.hasPrimaryClip()
                    && clipboard.getPrimaryClip() != null
                    && clipboard.getPrimaryClip().getItemCount() > 0) {
                CharSequence text = clipboard.getPrimaryClip()
                        .getItemAt(0)
                        .coerceToText(this);
                if (text != null && !text.toString().trim().isEmpty()) {
                    urlInput.setText(text.toString().trim());
                    urlInput.setSelection(urlInput.getText().length());
                    return;
                }
            }
            Toast.makeText(this, "剪贴板里没有可用的地址", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "无法读取剪贴板", Toast.LENGTH_SHORT).show();
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(
                settings.getUserAgentString() + " HoshikuzuMobile/" + APP_VERSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(false);
        }

        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.bg_deep));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Long-press is used by the web timeline to save a photo. Suppress the
        // native text/image selection menu so it does not steal that gesture.
        webView.setLongClickable(false);
        webView.setOnLongClickListener(v -> true);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new SaveBridge(this), "HoshikuzuAndroid");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                NativeDownloader.save(this, url, null);
            }
        });

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
    }

    private void connectTo(String raw, boolean fromScan) {
        String normalized = normalizeServerUrl(raw);
        if (normalized == null) {
            showSetup("地址格式不正确。二维码或地址应类似 http://192.168.1.23:7880/m");
            return;
        }
        hideKeyboard();
        currentUrl = normalized;
        urlInput.setText(normalized);
        prefs().edit().putString(KEY_URL, normalized).apply();
        pageReady = false;
        mainFrameFailed = false;
        setupScroll.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        showLoading(true, getString(R.string.loading_page));
        webView.loadUrl(normalized);
        if (fromScan) {
            Toast.makeText(this, "已识别二维码", Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Accepts a QR link, a full URL, or a bare "ip:port". Only HTTP(S) is
     * allowed; a bare host is routed to /m so the phone can still show the
     * pairing prompt if the token is missing.
     */
    static String normalizeServerUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        if (!value.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*")) {
            value = "http://" + value;
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (scheme == null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            String authority = uri.getRawAuthority();
            if (TextUtils.isEmpty(authority) || uri.getHost() == null) return null;
            String path = uri.getRawPath();
            if (TextUtils.isEmpty(path) || "/".equals(path)) {
                path = "/m";
            }
            String query = uri.getRawQuery();
            return scheme + "://" + authority + path + (query == null ? "" : "?" + query);
        } catch (URISyntaxException error) {
            return null;
        }
    }

    private void showSetup(String message) {
        setupScroll.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
        webView.setKeepScreenOn(false);
        loadingLayer.setVisibility(View.GONE);
        if (TextUtils.isEmpty(message)) {
            statusText.setText(R.string.status_ready);
            statusText.setTextColor(ContextCompat.getColor(this, R.color.muted));
        } else {
            statusText.setText(message);
            statusText.setTextColor(ContextCompat.getColor(this, R.color.danger));
        }
    }

    private void showLoading(boolean visible, String message) {
        loadingLayer.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (message != null) loadingText.setText(message);
    }

    private void hideKeyboard() {
        try {
            InputMethodManager input =
                    (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (input != null) {
                input.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);
            }
            urlInput.clearFocus();
        } catch (Exception ignored) {
            // The keyboard is a convenience; never let it break connecting.
        }
    }

    private boolean isSameServer(Uri uri) {
        if (currentUrl == null) return false;
        Uri current = Uri.parse(currentUrl);
        String host = uri.getHost();
        String currentHost = current.getHost();
        if (host == null || currentHost == null) return false;
        return host.equalsIgnoreCase(currentHost)
                && effectivePort(uri) == effectivePort(current);
    }

    /** Used by the JS bridge before a plain-HTTP download. */
    boolean isAllowedHttpDownload(String url) {
        if (currentUrl == null) return false;
        try {
            Uri target = Uri.parse(url);
            if (target.getHost() == null) return false;
            return isSameServer(target);
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * Called from the JS bridge. Android 9 and older need a runtime permission
     * before writing to the public Downloads folder; Android 10+ uses
     * MediaStore and needs none.
     */
    void requestNativeSave(String name, String url) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    && ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingSaveName = name;
                pendingSaveUrl = url;
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQUEST_SAVE_STORAGE);
                return;
            }
            startNativeSave(name, url);
        });
    }

    private void startNativeSave(String name, String url) {
        Toast.makeText(this, R.string.save_started, Toast.LENGTH_SHORT).show();
        NativeDownloader.save(this, url, name);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_SAVE_STORAGE) return;
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && pendingSaveUrl != null) {
            startNativeSave(pendingSaveName, pendingSaveUrl);
        } else {
            Toast.makeText(this, "没有存储权限，无法保存到手机。", Toast.LENGTH_LONG).show();
        }
        pendingSaveName = null;
        pendingSaveUrl = null;
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private void reloadPage() {
        if (currentUrl == null) return;
        mainFrameFailed = false;
        pageReady = false;
        showLoading(true, getString(R.string.loading_page));
        webView.reload();
    }

    private void switchComputer() {
        prefs().edit().remove(KEY_URL).apply();
        currentUrl = null;
        pageReady = false;
        mainFrameFailed = false;
        webView.stopLoading();
        webView.loadUrl("about:blank");
        webView.setKeepScreenOn(false);
        webView.setVisibility(View.GONE);
        urlInput.setText("");
        showSetup("扫描新的二维码，或输入电脑上的手机同步地址。");
    }

    private void showSessionDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.session_title)
                .setItems(new String[]{
                        getString(R.string.session_reload),
                        getString(R.string.session_switch),
                        getString(R.string.session_exit)
                }, (dialog, which) -> {
                    if (which == 0) {
                        reloadPage();
                    } else if (which == 1) {
                        switchComputer();
                    } else {
                        finish();
                    }
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        if (setupScroll.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        if (webView == null || backPending) return;
        backPending = true;
        webView.evaluateJavascript(
                "(function(){try{var h=window.__hoshikuzuHandleBack;return h&&h()?'1':'0';}catch(e){return '0';}})()",
                value -> {
                    backPending = false;
                    if (value != null && value.contains("1")) return;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        showSessionDialog();
                    }
                });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try {
                webView.removeJavascriptInterface("HoshikuzuAndroid");
                FrameLayout root = findViewById(R.id.root);
                root.removeView(webView);
                webView.destroy();
            } catch (Exception ignored) {
                // Destroy is best-effort during process teardown.
            }
            webView = null;
        }
        super.onDestroy();
    }

    private class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUri(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUri(Uri.parse(url));
        }

        private boolean handleUri(Uri uri) {
            if (uri == null) return true;
            String scheme = uri.getScheme();
            if (scheme == null) return true;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (scheme.equals("http") || scheme.equals("https")) {
                if (isSameServer(uri)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "无法打开外部链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            if (scheme.equals("mailto") || scheme.equals("tel")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // No mail/phone app.
                }
                return true;
            }
            // blob:, intent:, file: and javascript: never navigate the client
            // away from the paired album page.
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if (!pageReady) showLoading(true, getString(R.string.loading_page));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (mainFrameFailed) return;
            pageReady = true;
            showLoading(false, null);
            setupScroll.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            // A live cast client is meant to stay open while the user watches
            // the phone; keep the display awake but let the system turn it off
            // when the app goes to the background.
            webView.setKeepScreenOn(true);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                mainFrameFailed = true;
                webView.setKeepScreenOn(false);
                String reason = error != null && error.getDescription() != null
                        ? error.getDescription().toString()
                        : "网络不可达";
                showSetup("无法连接电脑：" + reason + "\n请确认电脑端已开启手机同步、手机与电脑在同一 Wi-Fi。");
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse response) {
            super.onReceivedHttpError(view, request, response);
            if (!request.isForMainFrame()) return;
            int status = response == null ? 0 : response.getStatusCode();
            if (status == 401 || status == 403) {
                mainFrameFailed = true;
                prefs().edit().remove(KEY_URL).apply();
                urlInput.setText("");
                showSetup("配对已过期。请在电脑上刷新二维码，然后用手机重新扫描。");
            } else if (status >= 500) {
                mainFrameFailed = true;
                showSetup("电脑端服务暂时不可用（HTTP " + status + "）。请稍后在电脑上重新开启手机同步。");
            }
        }
    }
}
