package com.hoshikuzu.mobile;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Listens for the desktop's UDP discovery beacons (port 7881). Beacons contain
 * no pairing token; discovery only fills in the address, while first-time
 * pairing still uses the QR code.
 */
final class DiscoveryClient {
    static final int DISCOVERY_PORT = 7881;
    private static final int MAX_SEEN_DESKTOPS = 32;
    private static final int MAX_NAME_LENGTH = 80;

    interface Listener {
        void onDesktop(Desktop desktop);

        void onError(String message);
    }

    static final class Desktop {
        final String name;
        final String address;
        final int port;
        final String version;

        Desktop(String name, String address, int port, String version) {
            this.name = name;
            this.address = address;
            this.port = port;
            this.version = version;
        }

        String key() {
            return address + ":" + port;
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Desktop> seen = new LinkedHashMap<>();
    private volatile boolean running = false;
    private DatagramSocket socket;
    private Thread thread;

    void start(Listener listener) {
        if (running) return;
        running = true;
        thread = new Thread(() -> {
            DatagramSocket local = null;
            try {
                local = new DatagramSocket(null);
                local.setReuseAddress(true);
                local.setBroadcast(true);
                local.bind(new InetSocketAddress(DISCOVERY_PORT));
                local.setSoTimeout(1200);
                socket = local;
                byte[] buffer = new byte[8192];
                while (running) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        local.receive(packet);
                    } catch (java.net.SocketTimeoutException timeout) {
                        continue;
                    } catch (Exception error) {
                        if (!running) break;
                        throw error;
                    }
                    String text = new String(packet.getData(), packet.getOffset(),
                            packet.getLength(), java.nio.charset.StandardCharsets.UTF_8);
                    JSONObject json;
                    try {
                        json = new JSONObject(text);
                    } catch (Exception error) {
                        continue;
                    }
                    if (!"hoshikuzu-album".equals(json.optString("app", ""))) continue;
                    InetAddress source = packet.getAddress();
                    if (source == null) continue;
                    String address = source.getHostAddress();
                    int port = json.optInt("port", 0);
                    if (port <= 0 || port > 65535) continue;
                    String name = json.optString("name", "时光轴相册");
                    if (name == null || name.trim().isEmpty()) name = "时光轴相册";
                    name = name.trim();
                    if (name.length() > MAX_NAME_LENGTH) {
                        name = name.substring(0, MAX_NAME_LENGTH);
                    }
                    String version = json.optString("version", "");
                    Desktop desktop = new Desktop(name, address, port, version);
                    if (seen.containsKey(desktop.key())) continue;
                    // Beacons are unauthenticated; cap the set so a busy or
                    // hostile LAN cannot grow the UI model without bound.
                    while (seen.size() >= MAX_SEEN_DESKTOPS) {
                        Iterator<String> keys = seen.keySet().iterator();
                        if (!keys.hasNext()) break;
                        keys.next();
                        keys.remove();
                    }
                    seen.put(desktop.key(), desktop);
                    main.post(() -> listener.onDesktop(desktop));
                }
            } catch (Exception error) {
                if (running) {
                    String message = error.getMessage() == null
                            ? "无法监听局域网发现端口。" : error.getMessage();
                    main.post(() -> listener.onError(message));
                }
            } finally {
                if (local != null) {
                    try {
                        local.close();
                    } catch (Exception ignored) {
                        // Already closed.
                    }
                }
                if (socket == local) socket = null;
            }
        }, "hoshikuzu-discovery");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        running = false;
        if (socket != null) {
            try {
                socket.close();
            } catch (Exception ignored) {
                // Already closed.
            }
            socket = null;
        }
    }
}
