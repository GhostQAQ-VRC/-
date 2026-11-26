package com.hoshikuzu.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.webkit.WebView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowWebView;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MainActivityTest {
    @Test
    public void firstLaunchShowsLocalAlbum() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        View setup = activity.findViewById(R.id.setup_scroll);
        WebView web = activity.findViewById(R.id.web_view);
        assertNotNull(setup);
        assertNotNull(web);
        assertEquals(View.GONE, setup.getVisibility());
        assertEquals(View.VISIBLE, web.getVisibility());
        ShadowWebView shadow = Shadows.shadowOf(web);
        assertEquals(
                "https://appassets.androidplatform.net/assets/web/mobile-client.html",
                shadow.getLastLoadedUrl());
    }

    @Test
    public void connectScreenIsOptionalAndReturnsToLocal() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        activity.showConnect(false);
        assertEquals(View.VISIBLE, activity.findViewById(R.id.setup_scroll).getVisibility());
        assertEquals(View.GONE, activity.findViewById(R.id.web_view).getVisibility());
        activity.returnToLocal();
        assertEquals(View.GONE, activity.findViewById(R.id.setup_scroll).getVisibility());
        assertEquals(View.VISIBLE, activity.findViewById(R.id.web_view).getVisibility());
    }

    @Test
    public void acceptsQrPairingUrl() {
        assertEquals(
                "http://192.168.1.23:7880/m/AbC123",
                MainActivity.normalizeServerUrl("http://192.168.1.23:7880/m/AbC123"));
        assertEquals(
                "https://example.test/m/token",
                MainActivity.normalizeServerUrl("https://example.test/m/token"));
    }

    @Test
    public void bareHostRoutesToMobileEntry() {
        assertEquals(
                "http://192.168.1.23:7880/m",
                MainActivity.normalizeServerUrl("192.168.1.23:7880"));
        assertEquals(
                "http://192.168.1.23:7880/m",
                MainActivity.normalizeServerUrl("http://192.168.1.23:7880/"));
    }

    @Test
    public void rejectsUnsupportedOrEmptyAddresses() {
        assertNull(MainActivity.normalizeServerUrl(""));
        assertNull(MainActivity.normalizeServerUrl("   "));
        assertNull(MainActivity.normalizeServerUrl("ftp://192.168.1.2/m"));
        assertNull(MainActivity.normalizeServerUrl("javascript:alert(1)"));
    }

    @Test
    public void downloadNamesAreSafe() {
        assertEquals("a_b_c.png", NativeDownloader.sanitizeName("a:b*c.png"));
        assertTrue(NativeDownloader.sanitizeName("../../secret.png").indexOf('/') < 0);
        assertEquals("", NativeDownloader.sanitizeName(null));
        assertTrue(NativeDownloader.sanitizeName("x".repeat(300)).length() <= 120);
    }

    @Test
    public void httpSaveIsRestrictedToCurrentDesktop() throws Exception {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        java.lang.reflect.Field field = MainActivity.class.getDeclaredField("currentUrl");
        field.setAccessible(true);
        field.set(activity, "http://192.168.1.2:7880/m/token");
        assertTrue(activity.isAllowedHttpDownload(
                "http://192.168.1.2:7880/api/mobile/photos/photo_1/original?download=1"));
        assertTrue(!activity.isAllowedHttpDownload(
                "http://192.168.1.3:7880/api/mobile/photos/photo_1/original"));
        assertTrue(!activity.isAllowedHttpDownload(
                "http://192.168.1.2:9999/api/mobile/photos/photo_1/original"));
    }

    @Test
    public void saveBridgeRejectsNonHttpSchemes() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        SaveBridge bridge = new SaveBridge(activity);
        assertTrue(!bridge.saveUrl("x.png", "ftp://192.168.1.2/x.png"));
        assertTrue(!bridge.saveUrl("x.png", "javascript:alert(1)"));
        assertTrue(!bridge.saveUrl("x.png", null));
    }
}
