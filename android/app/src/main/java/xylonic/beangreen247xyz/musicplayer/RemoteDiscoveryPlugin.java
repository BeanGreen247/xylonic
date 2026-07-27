package xylonic.beangreen247xyz.musicplayer;

import android.content.Context;
import android.util.Log;
import xylonic.beangreen247xyz.musicplayer.BuildConfig;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "RemoteDiscovery")
public class RemoteDiscoveryPlugin extends Plugin {

    private static final int    BROADCAST_PORT       = 7766;
    private static final int    CMD_PORT             = 7767;
    private static final int    BROADCAST_INTERVAL_MS = 2000;
    private static final long   STALE_MS             = 15000;
    // Dedicated site-local multicast group — more reliable than broadcast on Android 12+
    private static final String MULTICAST_ADDR       = "239.255.85.89";
    private static final String  TAG = "XylonicRemote";
    private static final boolean D   = BuildConfig.DEBUG;

    private String deviceId   = "";
    private String deviceName = "Xylonic";

    // null = not paired; non-null = locked to this controller's device ID
    private volatile String pairedControllerId = null;
    // null = not acting as controller; non-null = device ID we are currently controlling
    private volatile String controllingId = null;
    // md5(username:serverUrl) for this device — empty string means not set
    private volatile String accountId = "";
    // last known player state as JSON — included in every broadcast so peers can mirror us
    private volatile String lastPlayerStateJson = null;

    private volatile boolean broadcastRunning = false;
    private volatile boolean discoveryRunning = false;

    private Thread broadcastThread;
    private Thread listenerThread;
    private Thread httpThread;
    private Thread cleanupThread;

    private MulticastSocket listenerSocket;
    private ServerSocket   commandServer;

    private WifiManager.MulticastLock multicastLock;

    private final Map<String, JSONObject> devices = new ConcurrentHashMap<>();

    // ── Broadcast own presence ────────────────────────────────────────────────

    @PluginMethod
    public void startBroadcast(PluginCall call) {
        deviceId   = call.getString("deviceId",   "");
        deviceName = call.getString("deviceName", "Xylonic");
        accountId  = call.getString("accountId",  "");

        if (broadcastRunning) { call.resolve(); return; }
        broadcastRunning = true;
        if (D) Log.i(TAG, "startBroadcast: id=" + deviceId + " name=" + deviceName);

        broadcastThread = new Thread(() -> {
            DatagramSocket sock = null;
            try {
                // Explicitly IPv4 — DatagramSocket() may default to IPv6 on Android
                sock = new DatagramSocket(null);
                sock.setReuseAddress(true);
                sock.bind(new java.net.InetSocketAddress(
                    InetAddress.getByName("0.0.0.0"), 0));
                sock.setBroadcast(true);
                while (broadcastRunning) {
                    try {
                        String paired      = pairedControllerId;
                        String controlling = controllingId;
                        String psJson      = lastPlayerStateJson;
                        JSONObject p = new JSONObject();
                        p.put("type",          "XYLONIC_PRESENCE");
                        p.put("id",            deviceId);
                        p.put("name",          deviceName);
                        p.put("host",          getLocalIp());
                        p.put("cmdPort",       CMD_PORT);
                        p.put("platform",      "android");
                        p.put("pairedWith",    paired      != null ? paired      : JSONObject.NULL);
                        p.put("controllingId", controlling != null ? controlling : JSONObject.NULL);
                        p.put("accountId",     accountId.isEmpty() ? JSONObject.NULL : accountId);
                        p.put("ts",            System.currentTimeMillis());
                        if (psJson != null) {
                            try { p.put("playerState", new JSONObject(psJson)); } catch (Exception ignored) {}
                        }

                        byte[] buf = p.toString().getBytes("UTF-8");

                        // Send to multicast group (reliable on Android 12+) + broadcast fallback
                        List<InetAddress> targets = getBroadcastAddresses();
                        targets.add(InetAddress.getByName("255.255.255.255"));
                        targets.add(InetAddress.getByName(MULTICAST_ADDR));
                        if (D) Log.d(TAG, "broadcasting from " + getLocalIp() + " to " + targets.size() + " targets");
                        for (InetAddress target : targets) {
                            try {
                                sock.send(new DatagramPacket(buf, buf.length, target, BROADCAST_PORT));
                            } catch (Exception e) {
                                if (D) Log.w(TAG, "send to " + target + " failed: " + e.getMessage());
                            }
                        }
                    } catch (Exception ignored) {}
                    Thread.sleep(BROADCAST_INTERVAL_MS);
                }
            } catch (InterruptedException ignored) {
            } catch (Exception ignored) {
            } finally {
                if (sock != null && !sock.isClosed()) sock.close();
            }
        });
        broadcastThread.setDaemon(true);
        broadcastThread.start();
        call.resolve();
    }

    @PluginMethod
    public void stopBroadcast(PluginCall call) {
        broadcastRunning = false;
        controllingId = null;
        if (broadcastThread != null) broadcastThread.interrupt();
        call.resolve();
    }

    @PluginMethod
    public void setControllerTarget(PluginCall call) {
        String id = call.getString("id", null);
        controllingId = (id != null && !id.isEmpty()) ? id : null;
        call.resolve();
    }

    @PluginMethod
    public void updatePlayerState(PluginCall call) {
        lastPlayerStateJson = call.getString("playerStateJson", null);
        call.resolve();
    }

    // ── Listen for peers + serve incoming commands ────────────────────────────

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (discoveryRunning) { call.resolve(); return; }
        discoveryRunning = true;

        // Acquire multicast lock so Android doesn't filter LAN broadcasts
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("xylonic_remote");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (Exception ignored) {}

        // UDP listener thread — MulticastSocket receives both broadcast AND multicast
        listenerThread = new Thread(() -> {
            try {
                // Explicitly bind IPv4 — MulticastSocket(null) defaults to IPv6 on Android
                listenerSocket = new MulticastSocket(null);
                listenerSocket.setReuseAddress(true);
                listenerSocket.setBroadcast(true);
                listenerSocket.bind(new java.net.InetSocketAddress(
                    InetAddress.getByName("0.0.0.0"), BROADCAST_PORT));
                listenerSocket.setSoTimeout(1000);
                if (D) Log.i(TAG, "UDP listener bound on port " + BROADCAST_PORT + " (IPv4)");

                // Join multicast group — use modern joinGroup(SocketAddress, NetworkInterface)
                // to avoid the deprecated joinGroup(InetAddress) that throws on Android 16 / Java 17+
                joinMulticastGroup();

                byte[] buf = new byte[4096];
                while (discoveryRunning) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        listenerSocket.receive(pkt);
                        String msg = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8");
                        handlePresencePacket(msg);
                    } catch (SocketTimeoutException ignored) {
                    } catch (Exception e) {
                        if (discoveryRunning) Log.w(TAG, "receive error: " + e.getMessage());
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "UDP listener fatal: " + e);
            } finally {
                if (listenerSocket != null && !listenerSocket.isClosed()) listenerSocket.close();
            }
        });
        listenerThread.setDaemon(true);
        listenerThread.start();

        // HTTP command server thread
        httpThread = new Thread(() -> {
            try {
                commandServer = new ServerSocket();
                commandServer.setReuseAddress(true);
                commandServer.bind(new java.net.InetSocketAddress(CMD_PORT));
                commandServer.setSoTimeout(1000);
                if (D) Log.i(TAG, "HTTP command server bound on port " + CMD_PORT);
                while (discoveryRunning) {
                    try {
                        Socket client = commandServer.accept();
                        handleCommand(client);
                    } catch (SocketTimeoutException ignored) {
                    } catch (Exception ignored) {}
                }
            } catch (Exception ignored) {
            } finally {
                if (commandServer != null && !commandServer.isClosed()) {
                    try { commandServer.close(); } catch (Exception ignored) {}
                }
            }
        });
        httpThread.setDaemon(true);
        httpThread.start();

        // Stale device cleanup thread
        cleanupThread = new Thread(() -> {
            while (discoveryRunning) {
                try { Thread.sleep(2000); } catch (InterruptedException e) { break; }
                long now = System.currentTimeMillis();
                devices.entrySet().removeIf(entry -> {
                    try {
                        if (now - entry.getValue().getLong("lastSeen") > STALE_MS) {
                            String removedId = entry.getKey();

                            // Auto-unpair if the stale device was our paired controller
                            if (removedId.equals(pairedControllerId)) {
                                pairedControllerId = null;
                                notifyListeners("pairingCleared", new JSObject());
                            }

                            JSObject ev = new JSObject();
                            ev.put("id", removedId);
                            notifyListeners("deviceLost", ev);
                            return true;
                        }
                    } catch (Exception ignored) {}
                    return false;
                });
            }
        });
        cleanupThread.setDaemon(true);
        cleanupThread.start();

        call.resolve();
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        discoveryRunning = false;
        if (listenerThread  != null) listenerThread.interrupt();
        if (httpThread      != null) httpThread.interrupt();
        if (cleanupThread   != null) cleanupThread.interrupt();
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        call.resolve();
    }

    // ── Send a command to a remote device and return the response ─────────────

    @PluginMethod
    public void sendCommand(PluginCall call) {
        String host         = call.getString("host",         "");
        int    port         = call.getInt("port",             CMD_PORT);
        String action       = call.getString("action",       "");
        String data         = call.getString("data",         "{}");
        String controllerId = call.getString("controllerId", "");

        if (D) Log.i(TAG, "sendCommand action=" + action + " -> " + host + ":" + port);
        new Thread(() -> {
            try {
                URL connUrl = new URL("http://" + host + ":" + port + "/cmd");
                HttpURLConnection conn = (HttpURLConnection) connUrl.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(3000);

                JSONObject body = new JSONObject();
                body.put("action",       action);
                body.put("data",         new JSONObject(data));
                body.put("controllerId", controllerId);
                byte[] bytes = body.toString().getBytes("UTF-8");
                conn.getOutputStream().write(bytes);
                conn.getOutputStream().flush();

                int    code     = conn.getResponseCode();
                String respBody = readStream(conn.getInputStream());
                conn.disconnect();

                JSONObject resp = new JSONObject(respBody);
                JSObject result = new JSObject();
                result.put("ok",     resp.optBoolean("ok", false));
                result.put("reason", resp.optString("reason", ""));
                call.resolve(result);
            } catch (Exception e) {
                Log.w(TAG, "sendCommand to " + host + ":" + port + " failed: " + e);
                JSObject err = new JSObject();
                err.put("ok",     false);
                err.put("reason", "network_error");
                call.resolve(err);
            }
        }).start();
    }

    // ── WiFi check ────────────────────────────────────────────────────────────

    @PluginMethod
    public void isOnWifi(PluginCall call) {
        boolean onWifi = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext()
                .getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // Check ALL networks, not just getActiveNetwork(). On Android 10+
                // with dual WiFi+cellular, getActiveNetwork() often returns cellular
                // even when WiFi is fully connected, disabling the Remote button.
                for (Network net : cm.getAllNetworks()) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                    if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        onWifi = true;
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}

        // Fallback for API < 23: WifiManager
        if (!onWifi) {
            try {
                WifiManager wm = (WifiManager) getContext().getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    onWifi = wm.isWifiEnabled() && wm.getConnectionInfo().getNetworkId() != -1;
                }
            } catch (Exception ignored) {}
        }

        if (D) Log.i(TAG, "isOnWifi=" + onWifi);
        JSObject r = new JSObject();
        r.put("onWifi", onWifi);
        call.resolve(r);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private void handlePresencePacket(String msg) {
        try {
            JSONObject p = new JSONObject(msg);
            if (!"XYLONIC_PRESENCE".equals(p.optString("type"))) return;

            String id = p.getString("id");
            if (id.equals(deviceId)) return; // skip self

            p.put("lastSeen", System.currentTimeMillis());
            JSONObject prevEntry = devices.get(id);
            boolean isNew = prevEntry == null;
            devices.put(id, p);

            // Extract pairedWith as a plain String — null/missing/"null" all mean "not paired"
            String pairedWith = null;
            if (!p.isNull("pairedWith")) {
                String s = p.optString("pairedWith", "");
                if (!s.isEmpty() && !"null".equals(s)) pairedWith = s;
            }
            String peerControllingId = null;
            if (!p.isNull("controllingId")) {
                String s = p.optString("controllingId", "");
                if (!s.isEmpty() && !"null".equals(s)) peerControllingId = s;
            }
            String peerAccountId = null;
            if (!p.isNull("accountId")) {
                String s = p.optString("accountId", "");
                if (!s.isEmpty() && !"null".equals(s)) peerAccountId = s;
            }
            if (D) Log.d(TAG, "presence from " + p.optString("name") + " (" + id + ")" +
                " isNew=" + isNew + " pairedWith=" + pairedWith + " accountId=" + peerAccountId);

            // Emit player state update so the controller can mirror what the target is playing
            if (p.has("playerState") && !p.isNull("playerState")) {
                JSONObject ps = p.optJSONObject("playerState");
                if (ps != null) {
                    JSObject stateEv = new JSObject();
                    stateEv.put("id",          id);
                    stateEv.put("isPlaying",   ps.optBoolean("isPlaying", false));
                    stateEv.put("currentTime", ps.optDouble("currentTime", 0));
                    stateEv.put("duration",    ps.optDouble("duration", 0));
                    stateEv.put("stateTs",     p.optLong("ts", System.currentTimeMillis()));
                    JSONObject songJson = ps.optJSONObject("song");
                    if (songJson != null) {
                        JSObject songEv = new JSObject();
                        songEv.put("id",       songJson.optString("id", ""));
                        songEv.put("title",    songJson.optString("title", ""));
                        songEv.put("artist",   songJson.optString("artist", ""));
                        songEv.put("album",    songJson.optString("album", ""));
                        songEv.put("coverArt", songJson.optString("coverArt", ""));
                        songEv.put("duration", songJson.optDouble("duration", 0));
                        stateEv.put("song", songEv);
                    }
                    notifyListeners("playerStateUpdate", stateEv);
                }
            }

            if (isNew) {
                JSObject ev = new JSObject();
                ev.put("id",       id);
                ev.put("name",     p.getString("name"));
                ev.put("host",     p.getString("host"));
                ev.put("cmdPort",  p.getInt("cmdPort"));
                ev.put("platform", p.getString("platform"));
                if (pairedWith        != null) ev.put("pairedWith",    pairedWith);
                if (peerControllingId != null) ev.put("controllingId", peerControllingId);
                if (peerAccountId     != null) ev.put("accountId",     peerAccountId);
                notifyListeners("deviceFound", ev);
            } else {
                String prevPairedWith = null;
                String prevControllingId = null;
                try {
                    if (prevEntry != null && !prevEntry.isNull("pairedWith")) {
                        String s = prevEntry.optString("pairedWith", "");
                        if (!s.isEmpty() && !"null".equals(s)) prevPairedWith = s;
                    }
                    if (prevEntry != null && !prevEntry.isNull("controllingId")) {
                        String s = prevEntry.optString("controllingId", "");
                        if (!s.isEmpty() && !"null".equals(s)) prevControllingId = s;
                    }
                } catch (Exception ignored) {}

                boolean pairedChanged     = !java.util.Objects.equals(pairedWith,        prevPairedWith);
                boolean controllingChanged = !java.util.Objects.equals(peerControllingId, prevControllingId);
                if (pairedChanged || controllingChanged) {
                    JSObject ev = new JSObject();
                    ev.put("id", id);
                    if (pairedWith        != null) ev.put("pairedWith",    pairedWith);
                    if (peerControllingId != null) ev.put("controllingId", peerControllingId);
                    if (peerAccountId     != null) ev.put("accountId",     peerAccountId);
                    notifyListeners("devicePairingChanged", ev);
                }
            }
        } catch (Exception ignored) {}
    }

    private void handleCommand(final Socket client) {
        new Thread(() -> {
            try {
                client.setSoTimeout(5000);
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(client.getInputStream(), "UTF-8"));

                reader.readLine(); // discard request line

                int contentLength = 0;
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (line.toLowerCase().startsWith("content-length:")) {
                        contentLength = Integer.parseInt(
                            line.substring(line.indexOf(':') + 1).trim());
                    }
                }

                char[] bodyChars = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = reader.read(bodyChars, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }
                String body = new String(bodyChars, 0, read);

                JSONObject cmd          = new JSONObject(body);
                String     action       = cmd.optString("action", "");
                String     controllerId = cmd.optString("controllerId", "");
                String     dataJson     = cmd.has("data") ? cmd.getJSONObject("data").toString() : "{}";

                String  responseBody;

                if ("pair".equals(action)) {
                    JSONObject dataObj = cmd.has("data") ? cmd.optJSONObject("data") : null;
                    String controllerName      = dataObj != null ? dataObj.optString("controllerName",      "") : "";
                    String controllerAccountId = dataObj != null ? dataObj.optString("controllerAccountId", "") : "";
                    responseBody = handlePair(controllerId, controllerName, controllerAccountId);
                } else if ("disconnect".equals(action)) {
                    responseBody = handleDisconnect(controllerId);
                } else {
                    // All other commands require matching pairedControllerId
                    if (pairedControllerId != null && !pairedControllerId.equals(controllerId)) {
                        responseBody = "{\"ok\":false,\"reason\":\"not_paired\"}";
                    } else {
                        JSObject ev = new JSObject();
                        ev.put("action", action);
                        ev.put("data",   dataJson);
                        notifyListeners("remoteCommand", ev);
                        responseBody = "{\"ok\":true}";
                    }
                }

                String httpResp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    + "Content-Length: " + responseBody.getBytes("UTF-8").length + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n\r\n"
                    + responseBody;
                client.getOutputStream().write(httpResp.getBytes("UTF-8"));
                client.getOutputStream().flush();
            } catch (Exception ignored) {
            } finally {
                try { client.close(); } catch (Exception ignored) {}
            }
        }).start();
    }

    private synchronized String handlePair(String controllerId, String controllerName, String controllerAccountId) {
        if (controllerId == null || controllerId.isEmpty()) {
            return "{\"ok\":false,\"reason\":\"missing_id\"}";
        }
        // Reject if this device has no account — no shared library to control
        if (accountId.isEmpty()) {
            return "{\"ok\":false,\"reason\":\"no_account\"}";
        }
        // Reject if both sides have a non-empty accountId and they differ
        if (!accountId.isEmpty()
                && controllerAccountId != null
                && !controllerAccountId.isEmpty()
                && !accountId.equals(controllerAccountId)) {
            return "{\"ok\":false,\"reason\":\"account_mismatch\"}";
        }
        // Reject only if the currently-paired controller is STILL visible on the
        // network (present in the devices map). If it has gone offline the new
        // controller can take over — this prevents phantom locks after switching
        // between controller devices.
        if (pairedControllerId != null
                && !pairedControllerId.equals(controllerId)
                && devices.containsKey(pairedControllerId)) {
            return "{\"ok\":false,\"reason\":\"already_paired\"}";
        }
        pairedControllerId = controllerId;
        JSObject ev = new JSObject();
        ev.put("controllerId",   controllerId);
        ev.put("controllerName", controllerName);
        notifyListeners("pairingEstablished", ev);
        return "{\"ok\":true}";
    }

    private synchronized String handleDisconnect(String controllerId) {
        if (controllerId != null && controllerId.equals(pairedControllerId)) {
            pairedControllerId = null;
            notifyListeners("pairingCleared", new JSObject());
            return "{\"ok\":true}";
        }
        // Wrong controller or not paired — silently reject
        return "{\"ok\":false,\"reason\":\"not_paired\"}";
    }

    // ── Network utilities ─────────────────────────────────────────────────────

    /**
     * Joins the site-local multicast group on the active WiFi interface.
     *
     * joinGroup(InetAddress) is deprecated since Java 17 / Android API 35 and
     * throws UnsupportedOperationException on Android 16+. We prefer the modern
     * joinGroup(SocketAddress, NetworkInterface) form with the explicit WiFi
     * interface, and fall back to the legacy form if the interface can't be resolved.
     */
    private void joinMulticastGroup() {
        InetAddress group;
        try {
            group = InetAddress.getByName(MULTICAST_ADDR);
        } catch (Exception e) {
            Log.w(TAG, "joinMulticastGroup: cannot resolve " + MULTICAST_ADDR + ": " + e);
            return;
        }

        // Try modern form first: joinGroup(SocketAddress, NetworkInterface)
        String localIp = getLocalIp();
        if (!"127.0.0.1".equals(localIp)) {
            try {
                NetworkInterface iface = NetworkInterface.getByInetAddress(
                    InetAddress.getByName(localIp));
                if (iface != null) {
                    listenerSocket.joinGroup(
                        new java.net.InetSocketAddress(group, 0), iface);
                    if (D) Log.i(TAG, "joined multicast " + MULTICAST_ADDR
                        + " on iface " + iface.getName() + " (modern API)");
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "joinGroup (modern) failed: " + e + " — trying legacy");
            }
        }

        // Legacy fallback: joinGroup(InetAddress) — works on Android ≤ 14
        try {
            listenerSocket.joinGroup(group);
            if (D) Log.i(TAG, "joined multicast " + MULTICAST_ADDR + " (legacy API)");
        } catch (Exception e) {
            Log.w(TAG, "joinGroup (legacy) also failed: " + e
                + " — multicast disabled, broadcast-only mode");
        }
    }

    private String getLocalIp() {
        // On Android 6+ (API 23), use ConnectivityManager to find the active WiFi
        // network's IP. This avoids picking up USB-tethering (rndis0), VPN, or
        // hotspot interfaces that NetworkInterface may enumerate first.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getContext()
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    for (Network net : cm.getAllNetworks()) {
                        NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                        if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
                        LinkProperties lp = cm.getLinkProperties(net);
                        if (lp == null) continue;
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                if (D) Log.i(TAG, "localIp (WiFi/CM)=" + addr.getHostAddress());
                                return addr.getHostAddress();
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        // Fallback: iterate NetworkInterface (works on older Android and non-WiFi)
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces != null) {
                while (ifaces.hasMoreElements()) {
                    NetworkInterface iface = ifaces.nextElement();
                    if (iface.isLoopback() || !iface.isUp()) continue;
                    Enumeration<InetAddress> addrs = iface.getInetAddresses();
                    while (addrs.hasMoreElements()) {
                        InetAddress addr = addrs.nextElement();
                        if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                            if (D) Log.i(TAG, "localIp (fallback NI)=" + addr.getHostAddress());
                            return addr.getHostAddress();
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    /** Returns the directed broadcast address for each active IPv4 interface. */
    private List<InetAddress> getBroadcastAddresses() {
        List<InetAddress> result = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces != null) {
                while (ifaces.hasMoreElements()) {
                    NetworkInterface iface = ifaces.nextElement();
                    if (iface.isLoopback() || !iface.isUp()) continue;
                    for (InterfaceAddress ia : iface.getInterfaceAddresses()) {
                        InetAddress broadcast = ia.getBroadcast();
                        if (broadcast != null) result.add(broadcast);
                    }
                }
            }
        } catch (Exception ignored) {}
        return result;
    }

    private String readStream(java.io.InputStream is) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        return sb.toString();
    }
}
