package com.hoshikuzu.mobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
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
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
import androidx.webkit.WebViewAssetLoader;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "hoshikuzu_mobile";
    private static final String KEY_URL = "server_url";
    private static final String KEY_PAIRS = "paired_desktops";
    private static final String APP_VERSION = "1.5.0";
    private static final String LOCAL_URL =
            "https://appassets.androidplatform.net/assets/web/mobile-client.html";
    private static final String LOCAL_HOST = "appassets.androidplatform.net";
    private static final int MODE_LOCAL = 0;
    private static final int MODE_REMOTE = 1;
    private static final int REQUEST_FILE_CHOOSER = 4103;
    private static final int REQUEST_PICK_MEDIA = 4104;
    private static final int REQUEST_NOTIFICATIONS = 4105;
    private static final int REQUEST_BACKUP_EXPORT = 4106;
    private static final int REQUEST_BACKUP_IMPORT = 4107;
    private static final int REQUEST_UNLOCK = 4108;
    private static final long RELOCK_AFTER_MS = 10_000;

    private WebView webView;
    private ScrollView setupScroll;
    private LinearLayout loadingLayer;
    private TextView loadingText;
    private TextView statusText;
    private EditText urlInput;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileChooserCallback;
    private SecureStore secureStore;
    private String pendingPickCallbackId;
    private int pendingPreviewMaxEdge = 1600;
    private int pendingPreviewQuality = 82;

    private String currentUrl;
    private int mode = MODE_LOCAL;
    private int previousMode = MODE_LOCAL;
    private boolean pageReady;
    private boolean mainFrameFailed;
    private static final int REQUEST_SAVE_STORAGE = 4102;
    private String pendingSaveName;
    private String pendingSaveUrl;
    private boolean backPending;
    private volatile boolean backupBusy;
    private String pendingBackupCallbackId;
    private File pendingBackupFile;
    private final List<Uri> pendingSharedUris = new ArrayList<>();
    private View lockLayer;
    private View unlockButton;
    private LinearLayout discoveredSection;
    private LinearLayout discoveredList;
    private TextView discoveredStatus;
    private DiscoveryClient discoveryClient;
    private boolean unlocked = true;
    private boolean unlockInFlight = false;
    private boolean skipRelockOnce = false;
    private long pausedAt = 0;

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
        lockLayer = findViewById(R.id.lock_layer);
        unlockButton = findViewById(R.id.unlock_button);
        discoveredSection = findViewById(R.id.discovered_section);
        discoveredList = findViewById(R.id.discovered_list);
        discoveredStatus = findViewById(R.id.discovered_status);
        if (unlockButton != null) {
            unlockButton.setOnClickListener(v -> requestUnlock());
        }

        secureStore = new SecureStore(this);
        configureWebView();
        bindActions();
        CastNotifier.ensureChannel(this);
        requestNotificationPermission();
        unlocked = !deviceHasLock();

        // The app always starts in the standalone local album. Desktop sync is
        // an optional action opened from the local page, never a launch gate.
        captureSharedIntent(getIntent());
        loadLocal(false);
    }

    private boolean deviceHasLock() {
        KeyguardManager manager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return manager != null && manager.isDeviceSecure();
    }

    private void showLock(boolean visible) {
        if (lockLayer != null) {
            lockLayer.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
        if (visible) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            if (unlockButton != null) unlockButton.requestFocus();
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private void requestUnlock() {
        if (unlockInFlight) return;
        if (!deviceHasLock()) {
            unlocked = true;
            showLock(false);
            return;
        }
        KeyguardManager manager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        Intent intent = manager == null ? null : manager.createConfirmDeviceCredentialIntent(
                getString(R.string.lock_title), getString(R.string.lock_hint));
        if (intent == null) {
            Toast.makeText(this, R.string.lock_no_device, Toast.LENGTH_LONG).show();
            return;
        }
        unlockInFlight = true;
        try {
            startActivityForResult(intent, REQUEST_UNLOCK);
        } catch (Exception error) {
            unlockInFlight = false;
            Toast.makeText(this, "无法打开设备解锁界面", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureSharedIntent(intent);
        handlePendingShares();
    }

    /** Collect image URIs from ACTION_SEND / ACTION_SEND_MULTIPLE. */
    private void captureSharedIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action)
                && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) uris.add(stream);
        } else {
            ArrayList<Uri> streams =
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null) uris.addAll(streams);
        }
        ClipData clip = intent.getClipData();
        if (uris.isEmpty() && clip != null) {
            for (int index = 0; index < clip.getItemCount(); index += 1) {
                Uri uri = clip.getItemAt(index).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        if (uris.isEmpty()) return;
        pendingSharedUris.clear();
        pendingSharedUris.addAll(uris);
        // Consumed once; a configuration change must not re-import the same URIs.
        intent.setAction(null);
    }

    /** Ask the local page to pull any pending shared images. */
    private void handlePendingShares() {
        if (pendingSharedUris.isEmpty()) return;
        if (mode == MODE_REMOTE) {
            returnToLocal();
            return;
        }
        if (!pageReady || webView == null || !isOnLocalOrigin()) return;
        try {
            webView.evaluateJavascript(
                    "window.__hoshikuzuRequestSharedMedia&&window.__hoshikuzuRequestSharedMedia()",
                    null);
        } catch (Exception ignored) {
            // The page will retry on the next resume/share.
        }
    }

    /** Called by the JS bridge; imports pending shared images into the library. */
    void consumeSharedMedia(String callbackId, int maxEdge, int quality) {
        if (pendingSharedUris.isEmpty()) {
            MobileLibrary.deliverCanceled(this, webView, callbackId);
            return;
        }
        List<Uri> uris = new ArrayList<>(pendingSharedUris);
        pendingSharedUris.clear();
        MobileLibrary.importUris(
                this,
                webView,
                uris,
                callbackId,
                maxEdge > 0 ? maxEdge : 1600,
                quality >= 30 && quality <= 100 ? quality : 82);
    }

    /** Persist the current "on this day" card for the home-screen widget. */
    void updateOnThisDayWidget(String json) {
        try {
            OnThisDayWidget.save(this, json);
        } catch (Exception ignored) {
            // A widget update must never disturb the album.
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(
                this,
                new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_NOTIFICATIONS);
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
        findViewById(R.id.back_local).setOnClickListener(v -> returnToLocal());
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
        skipRelockOnce = true;
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

    /**
     * The bundled pages must never be framed by a paired (or hostile) desktop
     * page. X-Frame-Options is part of the response because meta CSP ignores
     * frame-ancestors.
     */
    private static WebViewAssetLoader.PathHandler withFrameGuard(
            WebViewAssetLoader.PathHandler handler) {
        return path -> {
            WebResourceResponse response = handler.handle(path);
            if (response == null) return null;
            Map<String, String> headers = new HashMap<>();
            if (response.getResponseHeaders() != null) {
                headers.putAll(response.getResponseHeaders());
            }
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("X-Frame-Options", "DENY");
            response.setResponseHeaders(headers);
            return response;
        };
    }

    private void configureWebView() {
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", withFrameGuard(
                        new WebViewAssetLoader.AssetsPathHandler(this)))
                .addPathHandler("/media/", withFrameGuard(new MobileMediaHandler(this)))
                .build();

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
            settings.setSafeBrowsingEnabled(true);
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
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    skipRelockOnce = true;
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this,
                            "无法打开系统相册", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null) return;
            boolean http = url.startsWith("http://");
            boolean https = url.startsWith("https://");
            if (!http && !https) return;
            // A paired desktop page may only push downloads from its own
            // origin; otherwise it could drive-by download arbitrary content
            // into the phone's Downloads collection.
            boolean trusted = isLocalUrl(webView.getUrl()) || isSameServer(Uri.parse(url));
            if (trusted) NativeDownloader.save(this, url, null);
        });

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
    }

    private boolean isLocalUrl(String url) {
        if (url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (scheme == null || !"https".equalsIgnoreCase(scheme.trim())) return false;
            String path = uri.getPath();
            return LOCAL_HOST.equalsIgnoreCase(uri.getHost())
                    && path != null
                    && path.startsWith("/assets/web/");
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * True only while the WebView shows the bundled local album. The JS bridge
     * refuses privileged calls (secure store, HTTP proxy, import, delete) from
     * any other page, so a hostile paired "desktop" cannot touch local secrets.
     */
    boolean isOnLocalOrigin() {
        return isLocalUrl(webView == null ? null : webView.getUrl());
    }

    /** True while the WebView shows the paired desktop album (cast target). */
    boolean isOnRemoteAlbum() {
        if (webView == null) return false;
        try {
            Uri uri = Uri.parse(webView.getUrl());
            String scheme = uri.getScheme();
            if (scheme == null) return false;
            String lower = scheme.toLowerCase(Locale.ROOT);
            if (!lower.equals("http") && !lower.equals("https")) return false;
            return isSameServer(uri);
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * External links from the local page open in the browser, but only http(s)
     * targets — no intent:// or file:// tricks through the bridge.
     */
    private boolean isSafeExternalUrl(String url) {
        if (url == null) return false;
        try {
            Uri uri = Uri.parse(url.trim());
            String scheme = uri.getScheme();
            if (scheme == null) return false;
            scheme = scheme.toLowerCase(Locale.ROOT);
            return scheme.equals("http") || scheme.equals("https");
        } catch (Exception error) {
            return false;
        }
    }

    private void loadLocal(boolean force) {
        mode = MODE_LOCAL;
        previousMode = MODE_LOCAL;
        setupScroll.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.setKeepScreenOn(false);
        if (force || !isLocalUrl(webView.getUrl())) {
            pageReady = false;
            mainFrameFailed = false;
            showLoading(true, getString(R.string.loading_local));
            webView.loadUrl(LOCAL_URL);
        } else {
            showLoading(false, null);
        }
        if (deviceHasLock() && !unlocked) {
            showLock(true);
            requestUnlock();
        } else {
            showLock(false);
        }
    }

    void showConnect(boolean clearSaved) {
        previousMode = mode;
        if (clearSaved) {
            prefs().edit().remove(KEY_URL).apply();
            currentUrl = null;
            urlInput.setText("");
        } else {
            String saved = prefs().getString(KEY_URL, "");
            if (TextUtils.isEmpty(saved) && currentUrl != null) saved = currentUrl;
            if (!TextUtils.isEmpty(saved)) urlInput.setText(saved);
        }
        setupScroll.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
        loadingLayer.setVisibility(View.GONE);
        statusText.setText(R.string.connect_hint);
        statusText.setTextColor(ContextCompat.getColor(this, R.color.muted));
        startDiscovery();
    }

    private void closeConnect() {
        stopDiscovery();
        setupScroll.setVisibility(View.GONE);
        loadingLayer.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        if (previousMode == MODE_LOCAL) {
            if (!isLocalUrl(webView.getUrl())) loadLocal(false);
            else webView.setKeepScreenOn(false);
        } else {
            webView.setKeepScreenOn(true);
        }
    }

    void returnToLocal() {
        stopDiscovery();
        setupScroll.setVisibility(View.GONE);
        loadingLayer.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        loadLocal(false);
    }

    private void connectTo(String raw, boolean fromScan) {
        String normalized = normalizeServerUrl(raw);
        if (normalized == null) {
            showSetup("地址格式不正确。二维码或地址应类似 http://192.168.1.23:7880/m");
            return;
        }
        hideKeyboard();
        stopDiscovery();
        mode = MODE_REMOTE;
        currentUrl = normalized;
        urlInput.setText(normalized);
        prefs().edit().putString(KEY_URL, normalized).apply();
        savePairedDesktop(normalized);
        if (deviceHasLock()) {
            // The remote desktop album is not the private local library, but
            // returning to local mode must pass the device credential again.
            unlocked = false;
            showLock(false);
        }
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

    private void startDiscovery() {
        if (discoveredSection == null || discoveredList == null || discoveredStatus == null) return;
        if (discoveryClient != null) return;
        discoveredSection.setVisibility(View.VISIBLE);
        renderSavedDesktops();
        discoveredStatus.setText(R.string.discovering);
        discoveryClient = new DiscoveryClient();
        discoveryClient.start(new DiscoveryClient.Listener() {
            @Override
            public void onDesktop(DiscoveryClient.Desktop desktop) {
                runOnUiThread(() -> addDiscoveredDesktop(desktop));
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    if (discoveredList != null && discoveredList.getChildCount() == 0) {
                        discoveredStatus.setText("未发现电脑：" + message);
                    }
                });
            }
        });
    }

    private void stopDiscovery() {
        if (discoveryClient != null) {
            discoveryClient.stop();
            discoveryClient = null;
        }
    }

    private void renderSavedDesktops() {
        if (discoveredList == null) return;
        discoveredList.removeAllViews();
        JSONArray saved = loadSavedPairs();
        for (int index = 0; index < saved.length(); index += 1) {
            JSONObject entry = saved.optJSONObject(index);
            if (entry == null) continue;
            String url = entry.optString("url", "");
            String label = entry.optString("label", "");
            String host = entry.optString("host", "");
            int port = entry.optInt("port", 0);
            if (TextUtils.isEmpty(url)) continue;
            if (TextUtils.isEmpty(label)) label = host + ":" + port;
            addDesktopRow(
                    "saved:" + host + ":" + port,
                    label,
                    getString(R.string.discovered_paired),
                    v -> connectTo(url, false),
                    v -> {
                        removeSavedDesktop(host, port);
                        Toast.makeText(this, R.string.saved_removed, Toast.LENGTH_SHORT).show();
                        stopDiscovery();
                        startDiscovery();
                        return true;
                    });
        }
        if (saved.length() == 0 && discoveredList.getChildCount() == 0) {
            discoveredStatus.setText(R.string.discovered_none);
        }
    }

    private void addDiscoveredDesktop(DiscoveryClient.Desktop desktop) {
        if (discoveredList == null || discoveredSection == null) return;
        if (findSavedDesktop(desktop.address, desktop.port) != null) return;
        String tag = "discovered:" + desktop.key();
        if (discoveredList.findViewWithTag(tag) != null) return;
        String subtitle = desktop.address + ":" + desktop.port + " · "
                + getString(R.string.discovered_new);
        addDesktopRow(tag, desktop.name, subtitle, v -> {
            urlInput.setText("http://" + desktop.address + ":" + desktop.port + "/m");
            urlInput.setSelection(urlInput.getText().length());
            statusText.setText(R.string.pair_first);
            statusText.setTextColor(ContextCompat.getColor(this, R.color.aqua));
            urlInput.requestFocus();
        }, null);
        discoveredStatus.setText(getString(
                R.string.discovered_found, discoveredList.getChildCount()));
    }

    private void addDesktopRow(String tag, String title, String subtitle,
                               View.OnClickListener click,
                               View.OnLongClickListener longClick) {
        if (discoveredList == null) return;
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setBackgroundResource(R.drawable.bg_card);
        row.setPadding(dp(14), dp(11), dp(14), dp(11));
        row.setClickable(true);
        row.setFocusable(true);
        row.setTag(tag);

        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextColor(ContextCompat.getColor(this, R.color.ink));
        heading.setTextSize(13);
        heading.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(heading);

        TextView detail = new TextView(this);
        detail.setText(subtitle);
        detail.setTextColor(ContextCompat.getColor(this, R.color.muted));
        detail.setTextSize(10.5f);
        detail.setLineSpacing(dp(2), 1f);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        detailParams.topMargin = dp(3);
        row.addView(detail, detailParams);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(8);
        row.setLayoutParams(params);
        row.setOnClickListener(click);
        if (longClick != null) row.setOnLongClickListener(longClick);
        discoveredList.addView(row);
        discoveredSection.setVisibility(View.VISIBLE);
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private JSONArray loadSavedPairs() {
        try {
            return new JSONArray(prefs().getString(KEY_PAIRS, "[]"));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private void persistSavedPairs(JSONArray entries) {
        prefs().edit().putString(KEY_PAIRS, entries.toString()).apply();
    }

    private void savePairedDesktop(String normalized) {
        try {
            Uri uri = Uri.parse(normalized);
            String scheme = uri.getScheme();
            String path = uri.getPath();
            String authority = uri.getAuthority();
            String host = uri.getHost();
            if (scheme == null || path == null || authority == null || host == null) return;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return;
            if (!path.matches("^/m/[A-Za-z0-9_-]{8,}/?$")) return;
            int at = authority.lastIndexOf('@');
            if (at >= 0) authority = authority.substring(at + 1);
            String clean = scheme + "://" + authority + "/m";
            int port = effectivePort(uri);

            JSONArray existing = loadSavedPairs();
            JSONArray next = new JSONArray();
            for (int index = 0; index < existing.length(); index += 1) {
                JSONObject entry = existing.optJSONObject(index);
                if (entry == null) continue;
                if (host.equalsIgnoreCase(entry.optString("host"))
                        && port == entry.optInt("port", 0)) {
                    continue;
                }
                next.put(entry);
            }
            JSONObject saved = new JSONObject();
            saved.put("url", clean);
            saved.put("host", host);
            saved.put("port", port);
            saved.put("label", host + ":" + port);
            saved.put("savedAt", System.currentTimeMillis());
            next.put(saved);
            if (next.length() > 8) {
                JSONArray trimmed = new JSONArray();
                for (int index = next.length() - 8; index < next.length(); index += 1) {
                    trimmed.put(next.get(index));
                }
                next = trimmed;
            }
            persistSavedPairs(next);
        } catch (Exception ignored) {
            // A malformed URL simply does not create a saved pairing.
        }
    }

    private JSONObject findSavedDesktop(String host, int port) {
        JSONArray saved = loadSavedPairs();
        for (int index = 0; index < saved.length(); index += 1) {
            JSONObject entry = saved.optJSONObject(index);
            if (entry == null) continue;
            if (host != null && host.equalsIgnoreCase(entry.optString("host"))
                    && port == entry.optInt("port", 0)) {
                return entry;
            }
        }
        return null;
    }

    private void removeSavedDesktop(String host, int port) {
        JSONArray existing = loadSavedPairs();
        JSONArray next = new JSONArray();
        for (int index = 0; index < existing.length(); index += 1) {
            JSONObject entry = existing.optJSONObject(index);
            if (entry == null) continue;
            if (host != null && host.equalsIgnoreCase(entry.optString("host"))
                    && port == entry.optInt("port", 0)) {
                continue;
            }
            next.put(entry);
        }
        persistSavedPairs(next);
    }

    private void removeSavedDesktopForUrl(String url) {
        if (url == null) return;
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (host != null) removeSavedDesktop(host, effectivePort(uri));
        } catch (Exception ignored) {
            // Ignore malformed saved URLs.
        }
    }

    private void showSetup(String message) {        setupScroll.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
        webView.setKeepScreenOn(false);
        loadingLayer.setVisibility(View.GONE);
        if (TextUtils.isEmpty(message)) {
            statusText.setText(R.string.connect_hint);
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
        if (currentUrl == null || uri == null) return false;
        Uri current = Uri.parse(currentUrl);
        String host = uri.getHost();
        String currentHost = current.getHost();
        String scheme = uri.getScheme();
        String currentScheme = current.getScheme();
        if (host == null || currentHost == null || scheme == null || currentScheme == null) {
            return false;
        }
        return scheme.equalsIgnoreCase(currentScheme)
                && host.equalsIgnoreCase(currentHost)
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
        if (mode == MODE_LOCAL) {
            loadLocal(true);
            return;
        }
        if (currentUrl == null) return;
        mainFrameFailed = false;
        pageReady = false;
        showLoading(true, getString(R.string.loading_page));
        webView.reload();
    }

    private void showLocalDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.session_title)
                .setItems(new String[]{
                        getString(R.string.session_connect),
                        getString(R.string.session_reload_local),
                        getString(R.string.session_exit)
                }, (dialog, which) -> {
                    if (which == 0) {
                        showConnect(false);
                    } else if (which == 1) {
                        loadLocal(true);
                    } else {
                        finish();
                    }
                })
                .show();
    }

    private void showRemoteDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.session_title)
                .setItems(new String[]{
                        getString(R.string.session_local),
                        getString(R.string.session_reload),
                        getString(R.string.session_switch),
                        getString(R.string.session_exit)
                }, (dialog, which) -> {
                    if (which == 0) {
                        returnToLocal();
                    } else if (which == 1) {
                        reloadPage();
                    } else if (which == 2) {
                        showConnect(true);
                    } else {
                        finish();
                    }
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        if (!unlocked && lockLayer != null && lockLayer.getVisibility() == View.VISIBLE) {
            moveTaskToBack(true);
            return;
        }
        if (setupScroll.getVisibility() == View.VISIBLE) {
            closeConnect();
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
                    } else if (mode == MODE_REMOTE) {
                        showRemoteDialog();
                    } else {
                        showLocalDialog();
                    }
                });
    }

    void pickMedia(String callbackId, int maxEdge, int quality) {
        if (pendingPickCallbackId != null) return;
        pendingPickCallbackId = callbackId;
        pendingPreviewMaxEdge = maxEdge > 0 ? maxEdge : 1600;
        pendingPreviewQuality = quality >= 30 && quality <= 100 ? quality : 82;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            skipRelockOnce = true;
            startActivityForResult(intent, REQUEST_PICK_MEDIA);
        } catch (Exception error) {
            String callback = pendingPickCallbackId;
            pendingPickCallbackId = null;
            if (webView != null) MobileLibrary.deliverCanceled(this, webView, callback);
        }
    }

    boolean deleteManaged(String contentHash) {
        return MobileLibrary.deleteManaged(this, contentHash);
    }

    String secureGet(String key) {
        return secureStore == null || key == null ? null : secureStore.get(key);
    }

    boolean secureSet(String key, String value) {
        return secureStore != null && key != null && secureStore.set(key, value);
    }

    boolean secureDelete(String key) {
        return secureStore != null && key != null && secureStore.delete(key);
    }

    void openExternal(String url) {
        if (!isSafeExternalUrl(url)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())));
        } catch (Exception error) {
            Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
        }
    }

    String appVersion() {
        return APP_VERSION;
    }

    /** Deliver a native action result back to the local page callback. */
    void deliverActionResult(String callbackId, String json) {
        if (callbackId == null) return;
        runOnUiThread(() -> {
            if (webView == null) return;
            try {
                String script =
                        "window.__hoshikuzuMobileActionResult&&window.__hoshikuzuMobileActionResult("
                                + JSONObject.quote(callbackId) + "," + JSONObject.quote(json) + ")";
                webView.evaluateJavascript(script, null);
            } catch (Exception ignored) {
                // WebView may be gone.
            }
        });
    }

    /** Export the album JSON through ACTION_CREATE_DOCUMENT. */
    void exportBackupText(String callbackId, String name, String text) {
        if (callbackId == null) return;
        if (backupBusy) {
            deliverActionResult(callbackId, backupError("已有备份操作进行中。"));
            return;
        }
        backupBusy = true;
        new Thread(() -> {
            try {
                File file = BackupActions.writeCacheText(getApplicationContext(), text);
                runOnUiThread(() -> launchBackupExport(
                        callbackId, name, file, "application/json"));
            } catch (Exception error) {
                backupBusy = false;
                deliverActionResult(callbackId, backupError(
                        error.getMessage() == null ? "导出失败。" : error.getMessage()));
            }
        }, "hoshikuzu-backup-text").start();
    }

    /** Export album + originals + previews as a ZIP through ACTION_CREATE_DOCUMENT. */
    void exportBackupZip(String callbackId, String name, String albumJson) {
        if (callbackId == null) return;
        if (backupBusy) {
            deliverActionResult(callbackId, backupError("已有备份操作进行中。"));
            return;
        }
        backupBusy = true;
        new Thread(() -> {
            try {
                File file = BackupActions.buildZip(getApplicationContext(), albumJson);
                runOnUiThread(() -> launchBackupExport(
                        callbackId, name, file, "application/zip"));
            } catch (Exception error) {
                backupBusy = false;
                deliverActionResult(callbackId, backupError(
                        error.getMessage() == null ? "打包失败。" : error.getMessage()));
            }
        }, "hoshikuzu-backup-zip").start();
    }

    /** Import a JSON or ZIP backup through ACTION_OPEN_DOCUMENT. */
    void importBackup(String callbackId) {
        if (callbackId == null) return;
        if (backupBusy) {
            deliverActionResult(callbackId, backupError("已有备份操作进行中。"));
            return;
        }
        backupBusy = true;
        pendingBackupCallbackId = callbackId;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/json",
                "application/zip",
                "application/x-zip-compressed",
                "application/octet-stream",
                "text/plain"
        });
        try {
            skipRelockOnce = true;
            startActivityForResult(intent, REQUEST_BACKUP_IMPORT);
        } catch (Exception error) {
            backupBusy = false;
            pendingBackupCallbackId = null;
            deliverActionResult(callbackId, backupError(
                    error.getMessage() == null ? "无法打开文件选择器。" : error.getMessage()));
        }
    }

    private void launchBackupExport(String callbackId, String name, File file, String mime) {
        pendingBackupCallbackId = callbackId;
        pendingBackupFile = file;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        boolean zip = "application/zip".equals(mime);
        intent.putExtra(Intent.EXTRA_TITLE, BackupActions.safeName(
                name,
                zip ? "hoshikuzu-library" : "hoshikuzu-album",
                zip ? ".zip" : ".json"));
        try {
            skipRelockOnce = true;
            startActivityForResult(intent, REQUEST_BACKUP_EXPORT);
        } catch (Exception error) {
            backupBusy = false;
            pendingBackupCallbackId = null;
            pendingBackupFile = null;
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            deliverActionResult(callbackId, backupError(
                    error.getMessage() == null ? "无法打开保存对话框。" : error.getMessage()));
        }
    }

    private static String backupCanceled() {
        return "{\"ok\":false,\"canceled\":true}";
    }

    private static String backupError(String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", false);
            payload.put("error", message == null || message.isEmpty() ? "备份操作失败。" : message);
            return payload.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"备份操作失败。\"}";
        }
    }

    void httpRequest(String callbackId, String requestJson) {
        HttpBridge.request(this, webView, callbackId, requestJson);
    }

    /** Post a system notification for a cast while the page is backgrounded. */
    void notifyCast(String photoId, String title, String body) {
        if (!isOnRemoteAlbum()) return;
        CastNotifier.show(this, photoId, title, body);
    }

    String md5Hex(String base64) {
        try {
            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("MD5");
            byte[] hash = digest.digest(bytes);
            StringBuilder builder = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                builder.append(String.format(java.util.Locale.ROOT, "%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            return "";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_UNLOCK) {
            unlockInFlight = false;
            pausedAt = 0;
            if (resultCode == RESULT_OK) {
                unlocked = true;
                showLock(false);
            } else {
                unlocked = false;
                showLock(true);
            }
            return;
        }
        if (requestCode == REQUEST_BACKUP_EXPORT) {
            String callback = pendingBackupCallbackId;
            File file = pendingBackupFile;
            pendingBackupCallbackId = null;
            pendingBackupFile = null;
            backupBusy = false;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                if (file != null) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                deliverActionResult(callback, backupCanceled());
                return;
            }
            if (file == null) {
                deliverActionResult(callback, backupError("备份临时文件缺失。"));
                return;
            }
            Uri target = data.getData();
            new Thread(() -> {
                String result = BackupActions.exportFile(
                        getApplicationContext(), target, file);
                deliverActionResult(callback, result);
            }, "hoshikuzu-backup-write").start();
            return;
        }
        if (requestCode == REQUEST_BACKUP_IMPORT) {
            String callback = pendingBackupCallbackId;
            pendingBackupCallbackId = null;
            pendingBackupFile = null;
            backupBusy = false;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                deliverActionResult(callback, backupCanceled());
                return;
            }
            Uri source = data.getData();
            new Thread(() -> {
                String result = BackupActions.importDocument(
                        getApplicationContext(), source);
                deliverActionResult(callback, result);
            }, "hoshikuzu-backup-read").start();
            return;
        }
        if (requestCode == REQUEST_PICK_MEDIA) {
            String callback = pendingPickCallbackId;
            pendingPickCallbackId = null;
            List<Uri> uris = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    for (int index = 0; index < clip.getItemCount(); index += 1) {
                        uris.add(clip.getItemAt(index).getUri());
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }
            if (webView == null || callback == null) return;
            if (uris.isEmpty()) {
                MobileLibrary.deliverCanceled(this, webView, callback);
            } else {
                MobileLibrary.importUris(this, webView, uris, callback,
                        pendingPreviewMaxEdge, pendingPreviewQuality);
            }
            return;
        }
        if (requestCode != REQUEST_FILE_CHOOSER || fileChooserCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                results = new Uri[clip.getItemCount()];
                for (int index = 0; index < clip.getItemCount(); index += 1) {
                    results[index] = clip.getItemAt(index).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        if (setupScroll != null && setupScroll.getVisibility() == View.VISIBLE) {
            startDiscovery();
        }
        long away = pausedAt > 0 ? System.currentTimeMillis() - pausedAt : 0;
        pausedAt = 0;
        if (skipRelockOnce) {
            skipRelockOnce = false;
            away = 0;
        }
        if (away > RELOCK_AFTER_MS
                && mode == MODE_LOCAL
                && unlocked
                && !unlockInFlight
                && deviceHasLock()) {
            unlocked = false;
            showLock(true);
            requestUnlock();
        } else if (unlocked) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @Override
    protected void onPause() {
        pausedAt = System.currentTimeMillis();
        stopDiscovery();
        if (mode == MODE_LOCAL && deviceHasLock()) {
            // Hide the local album from the recents snapshot while the app is
            // in the background; it is cleared again on resume when unlocked.
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        if (webView != null) {
            webView.onPause();
            // Keep timers/SSE alive while paired to the desktop. A true
            // background service is still preferable on aggressive OEMs, but
            // this keeps the live cast connection alive across short pauses.
            if (mode != MODE_REMOTE) webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopDiscovery();
        if (pendingBackupFile != null) {
            //noinspection ResultOfMethodCallIgnored
            pendingBackupFile.delete();
            pendingBackupFile = null;
        }
        pendingBackupCallbackId = null;
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
                if (isLocalUrl(uri.toString())) return false;
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
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if (!pageReady) {
                showLoading(true, getString(
                        isLocalUrl(url) ? R.string.loading_local : R.string.loading_page));
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (mainFrameFailed) return;
            pageReady = true;
            mode = isLocalUrl(url) ? MODE_LOCAL : MODE_REMOTE;
            showLoading(false, null);
            setupScroll.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            // Keep the display awake only for the live desktop cast page. The
            // local album behaves like a normal gallery and may sleep.
            webView.setKeepScreenOn(mode == MODE_REMOTE);
            if (mode == MODE_LOCAL) handlePendingShares();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                mainFrameFailed = true;
                webView.setKeepScreenOn(false);
                if (isLocalUrl(request.getUrl().toString())) {
                    showSetup("本地相册资源加载失败，请重新安装客户端。");
                    return;
                }
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
                mode = MODE_LOCAL;
                previousMode = MODE_LOCAL;
                if (currentUrl != null) removeSavedDesktopForUrl(currentUrl);
                prefs().edit().remove(KEY_URL).apply();
                urlInput.setText("");
                showSetup("配对已过期。请在电脑上刷新二维码，然后用手机重新扫描；本地相册不受影响。");
                startDiscovery();
            } else if (status >= 500) {
                mainFrameFailed = true;
                mode = MODE_LOCAL;
                previousMode = MODE_LOCAL;
                showSetup("电脑端服务暂时不可用（HTTP " + status + "）。本地相册不受影响，稍后可再连接。");
                startDiscovery();
            }
        }
    }
}
