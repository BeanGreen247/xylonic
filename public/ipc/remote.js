// Remote Mode: LAN device discovery (UDP 7766) + HTTP command server (7767).
// Extracted from public/electron.js (WS-ARCH). electron.js calls
// registerRemoteIpc({ ipcMain, app, getMainWindow }) once after the main window
// exists, then startRemoteDiscovery() from app.whenReady().
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const http = require('http');

function registerRemoteIpc({ ipcMain, app, getMainWindow, getLastPlayerState }) {
  // Guarded push to the renderer — replaces the old
  // `mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send(...)`.
  const pushToRenderer = (channel, payload) => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

const dgram   = require('dgram');
const crypto  = require('crypto');
const REMOTE_BROADCAST_PORT = 7766;
const REMOTE_CMD_PORT       = 7767;
const REMOTE_MULTICAST_ADDR = '239.255.85.89';

let _remoteDeviceId        = null;
let _remoteBroadcastSock   = null;
let _remoteBroadcastTimer  = null;
let _remoteListenerSock    = null;
let _remoteCommandServer   = null;
let _remotePairedController = null; // device ID of the controller that has locked this device
let _remoteControllingId   = null;  // device ID this device is currently controlling (as controller)
let _remoteControlEnabled  = true;  // synced from renderer localStorage on startup
let _remoteAccountId       = '';    // md5(username:serverUrl) — empty string means not set
const _remoteDevices       = new Map(); // id -> { id, name, host, cmdPort, platform, pairedWith, lastSeen }

function _getRemoteDeviceId() {
    if (_remoteDeviceId) return _remoteDeviceId;
    const idFile = path.join(app.getPath('userData'), 'device_id.txt');
    try {
        if (fs.existsSync(idFile)) {
            _remoteDeviceId = fs.readFileSync(idFile, 'utf8').trim();
        } else {
            _remoteDeviceId = (crypto.randomUUID ? crypto.randomUUID() :
                crypto.randomBytes(16).toString('hex'));
            fs.writeFileSync(idFile, _remoteDeviceId, 'utf8');
        }
    } catch { _remoteDeviceId = 'electron-' + Date.now(); }
    return _remoteDeviceId;
}

function _getRemoteDeviceName() {
    const osType = process.platform === 'win32' ? 'Windows'
                 : process.platform === 'linux'  ? 'Linux'
                 : process.platform === 'darwin' ? 'macOS'
                 : process.platform;
    return os.hostname() + ',' + osType;
}

function _getLocalIp() {
    const ifaces = os.networkInterfaces();
    // Skip virtual/tunnel interface name prefixes — these are never reachable from LAN peers.
    const VIRTUAL_PREFIXES = ['docker', 'veth', 'br-', 'vmnet', 'virbr', 'tun', 'tap', 'vpn', 'wsl', 'lo'];
    const isVirtual = (name) => VIRTUAL_PREFIXES.some(p => name.toLowerCase().startsWith(p));
    // Private LAN ranges that a phone on the same WiFi router can actually reach.
    const isLanIp = (addr) =>
        /^192\.168\./.test(addr) ||
        /^10\./.test(addr) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr);

    // First pass: prefer a LAN IP on a non-virtual interface.
    for (const name of Object.keys(ifaces)) {
        if (isVirtual(name)) continue;
        for (const iface of (ifaces[name] || [])) {
            if (iface.family === 'IPv4' && !iface.internal && isLanIp(iface.address))
                return iface.address;
        }
    }
    // Second pass: any non-virtual, non-loopback IPv4.
    for (const name of Object.keys(ifaces)) {
        if (isVirtual(name)) continue;
        for (const iface of (ifaces[name] || [])) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    // Last resort.
    return '127.0.0.1';
}

/** Compute directed broadcast addresses for all active IPv4 interfaces. */
function _getBroadcastAddresses() {
    const results = new Set(['255.255.255.255']);
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of (ifaces[name] || [])) {
            if (iface.family !== 'IPv4' || iface.internal) continue;
            try {
                const ip      = iface.address.split('.').map(Number);
                const mask    = iface.netmask.split('.').map(Number);
                const bcast   = ip.map((b, i) => (b & mask[i]) | (~mask[i] & 0xff));
                results.add(bcast.join('.'));
            } catch {}
        }
    }
    return Array.from(results);
}

function _stopRemoteBroadcast() {
    if (_remoteBroadcastTimer) { clearInterval(_remoteBroadcastTimer); _remoteBroadcastTimer = null; }
    if (_remoteBroadcastSock) { try { _remoteBroadcastSock.close(); } catch {} _remoteBroadcastSock = null; }
}

function _startRemoteBroadcast() {
    if (_remoteBroadcastSock) return;
    if (!_remoteControlEnabled) return;
    try {
        _remoteBroadcastSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        _remoteBroadcastSock.bind(0, () => {
            try { _remoteBroadcastSock.setBroadcast(true); } catch {}
            const send = () => {
                const ps = getLastPlayerState();
                const now = Date.now();
                const packet = {
                    type:       'XYLONIC_PRESENCE',
                    id:         _getRemoteDeviceId(),
                    name:       _getRemoteDeviceName(),
                    host:       _getLocalIp(),
                    cmdPort:    REMOTE_CMD_PORT,
                    platform:   'electron',
                    pairedWith:    _remotePairedController || null,
                    controllingId: _remoteControllingId   || null,
                    accountId:     _remoteAccountId       || null,
                    ts:            now,
                };
                if (ps) {
                    packet.playerState = {
                        isPlaying:   !!(ps.isPlaying && !ps.isLoading),
                        currentTime: ps.currentTime || 0,
                        duration:    ps.duration    || 0,
                        song: ps.currentSong ? {
                            id:       ps.currentSong.id,
                            title:    ps.currentSong.title,
                            artist:   ps.currentSong.artist,
                            album:    ps.currentSong.album    || '',
                            coverArt: ps.currentSong.coverArt || '',
                            duration: ps.currentSong.duration || 0,
                        } : null,
                    };
                }
                const payload = Buffer.from(JSON.stringify(packet), 'utf8');
                for (const addr of _getBroadcastAddresses()) {
                    try { _remoteBroadcastSock.send(payload, REMOTE_BROADCAST_PORT, addr); } catch {}
                }
                // Also send to our dedicated multicast group for Android 12+ discovery
                try { _remoteBroadcastSock.send(payload, REMOTE_BROADCAST_PORT, REMOTE_MULTICAST_ADDR); } catch {}
            };
            send();
            _remoteBroadcastTimer = setInterval(send, 1000);
        });
        _remoteBroadcastSock.on('error', () => {});
    } catch {}
}

function _startRemoteListener() {
    if (_remoteListenerSock) return;
    try {
        _remoteListenerSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        _remoteListenerSock.on('message', (buf) => {
            try {
                const pkt = JSON.parse(buf.toString('utf8'));
                if (pkt.type !== 'XYLONIC_PRESENCE') return;
                const { id, name, host, cmdPort, platform, pairedWith, controllingId, accountId } = pkt;
                if (id === _getRemoteDeviceId()) return;

                const isNew    = !_remoteDevices.has(id);
                const prev     = _remoteDevices.get(id);
                const nowPaired      = pairedWith    || null;
                const nowControlling = controllingId || null;
                const nowAccountId   = accountId     || null;
                const nowEntry = { id, name, host, cmdPort, platform, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId, lastSeen: Date.now() };
                _remoteDevices.set(id, nowEntry);

                if (isNew && getMainWindow()) {
                    pushToRenderer('remote-device-found', { id, name, host, cmdPort, platform, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId });
                } else if (!isNew && prev && getMainWindow()) {
                    const pairedChanged      = prev.pairedWith    !== nowPaired;
                    const controllingChanged = prev.controllingId !== nowControlling;
                    if (pairedChanged || controllingChanged) {
                        pushToRenderer('remote-device-pairing-changed', { id, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId });
                    }
                }

                // Forward live player state to the renderer when this packet is from
                // the device this Electron instance is currently controlling.
                if (_remoteControllingId && id === _remoteControllingId &&
                    getMainWindow()) {
                    const ps = pkt.playerState || {};
                    pushToRenderer('remote-player-state-update', {
                        id,
                        isPlaying:   ps.isPlaying   || false,
                        currentTime: ps.currentTime || 0,
                        duration:    ps.duration    || (ps.song && ps.song.duration) || 0,
                        stateTs:     pkt.ts         || Date.now(),
                        song:        ps.song        || null,
                    });
                }
            } catch {}
        });
        _remoteListenerSock.on('error', () => {});
        _remoteListenerSock.bind(REMOTE_BROADCAST_PORT, () => {
            try { _remoteListenerSock.setBroadcast(true); } catch {}
            // Join multicast on every active non-loopback IPv4 interface so we
            // receive packets from Android, which sends to the multicast group only
            // (255.255.255.255 broadcast is restricted on modern Android).
            // A single addMembership() with no interface binds to the default route
            // interface only and silently misses WiFi packets when another interface
            // (Ethernet, VPN) is the default.
            const ifaces = os.networkInterfaces();
            for (const name of Object.keys(ifaces)) {
                for (const iface of (ifaces[name] || [])) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        try { _remoteListenerSock.addMembership(REMOTE_MULTICAST_ADDR, iface.address); } catch {}
                    }
                }
            }
        });

        // Stale device cleanup — also auto-unpairts if the paired controller disappears
        setInterval(() => {
            const now = Date.now();
            for (const [id, dev] of _remoteDevices.entries()) {
                if (now - dev.lastSeen > 15000) {
                    _remoteDevices.delete(id);
                    if (id === _remotePairedController) {
                        _remotePairedController = null;
                        if (getMainWindow()) {
                            pushToRenderer('remote-pairing-cleared', {});
                        }
                    }
                    if (getMainWindow()) {
                        pushToRenderer('remote-device-lost', { id });
                    }
                }
            }
        }, 5000);
    } catch {}
}

function _startRemoteCommandServer() {
    if (_remoteCommandServer) return;
    try {
        _remoteCommandServer = http.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/cmd') {
                res.writeHead(404); res.end(); return;
            }
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
                try {
                    const { action, data, controllerId } = JSON.parse(body);

                    if (action === 'pair') {
                        if (!_remoteControlEnabled) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"remote_control_disabled"}'); return;
                        }
                        if (!controllerId) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"missing_id"}'); return;
                        }
                        // Reject if this device has no account — no shared library to control
                        if (!_remoteAccountId) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"no_account"}'); return;
                        }
                        // Reject if both sides have a non-empty accountId that differs
                        const controllerAccountId = (data || {}).controllerAccountId || '';
                        if (_remoteAccountId && controllerAccountId && _remoteAccountId !== controllerAccountId) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"account_mismatch"}'); return;
                        }
                        // Reject only if currently paired with a DIFFERENT controller that is
                        // still visible on the network. If the old controller has gone offline
                        // (dropped from _remoteDevices by the stale-cleanup timer), allow the
                        // new device to take over — this prevents phantom locks after switching
                        // between controller devices.
                        if (_remotePairedController &&
                            _remotePairedController !== controllerId &&
                            _remoteDevices.has(_remotePairedController)) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"already_paired"}'); return;
                        }
                        _remotePairedController = controllerId;
                        if (getMainWindow()) {
                            pushToRenderer('remote-pairing-established', { controllerId, controllerName: (data || {}).controllerName || '' });
                        }
                        res.writeHead(200, headers);
                        res.end('{"ok":true}'); return;
                    }

                    if (action === 'disconnect') {
                        if (controllerId && controllerId === _remotePairedController) {
                            _remotePairedController = null;
                            if (getMainWindow()) {
                                pushToRenderer('remote-pairing-cleared', {});
                            }
                            res.writeHead(200, headers);
                            res.end('{"ok":true}');
                        } else {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"not_paired"}');
                        }
                        return;
                    }

                    // All other commands — require matching controller
                    if (_remotePairedController && _remotePairedController !== controllerId) {
                        res.writeHead(200, headers);
                        res.end('{"ok":false,"reason":"not_paired"}'); return;
                    }

                    if (getMainWindow()) {
                        pushToRenderer('remote-command', { action, data: data || {} });
                    }
                    res.writeHead(200, headers);
                    res.end('{"ok":true}');
                } catch {
                    res.writeHead(400, headers);
                    res.end('{"ok":false,"reason":"parse_error"}');
                }
            });
        });
        _remoteCommandServer.listen(REMOTE_CMD_PORT, '0.0.0.0');
        _remoteCommandServer.on('error', () => {});
    } catch {}
}

ipcMain.handle('remote-get-devices', () => Array.from(_remoteDevices.values()));
ipcMain.handle('remote-get-device-id', () => _getRemoteDeviceId());
ipcMain.handle('remote-get-device-name', () => _getRemoteDeviceName());
ipcMain.handle('remote-get-control-enabled', () => _remoteControlEnabled);
ipcMain.handle('remote-set-control-enabled', (event, enabled) => {
    _remoteControlEnabled = !!enabled;
    if (_remoteControlEnabled) {
        _startRemoteBroadcast();
    } else {
        _stopRemoteBroadcast();
        // Drop any active pairing so the next controller can connect after re-enabling
        if (_remotePairedController) {
            _remotePairedController = null;
            if (getMainWindow()) {
                pushToRenderer('remote-pairing-cleared', {});
            }
        }
    }
});
ipcMain.handle('remote-set-account-id', (_event, id) => { _remoteAccountId = id || ''; });
ipcMain.handle('remote-set-controller-target', (event, id) => {
    _remoteControllingId = id || null;
});
// Outgoing HTTP command — Electron can now act as a controller as well as a target.
ipcMain.handle('remote-send-command', (_event, { host, port, action, data, controllerId }) => {
    return new Promise((resolve) => {
        // Android's handleCommand calls getJSONObject("data") — it expects an object,
        // not a string. The renderer passes data as JSON.stringify(obj), so parse it
        // back to an object here before encoding the request body.
        let dataObj;
        try { dataObj = typeof data === 'string' ? JSON.parse(data) : (data || {}); } catch { dataObj = {}; }
        const body = JSON.stringify({ action, data: dataObj, controllerId });
        const req = http.request(
            { hostname: host, port, path: '/cmd', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            (res) => {
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(raw)); }
                    catch { resolve({ ok: false, reason: 'parse_error' }); }
                });
            },
        );
        req.on('error', () => resolve({ ok: false, reason: 'network_error' }));
        req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
        req.write(body);
        req.end();
    });
});


  _getRemoteDeviceId();
  return {
    startRemoteDiscovery() {
      _startRemoteBroadcast();
      _startRemoteListener();
      _startRemoteCommandServer();
    },
  };
}

module.exports = { registerRemoteIpc };
