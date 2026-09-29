// Finds Subsonic-API servers (Navidrome, Gonic, Airsonic, Subsonic, …) reachable
// from this machine so the login page can offer them: the local subnets, VPN
// subnets, Tailscale peers (a DERP relay is only transport — relayed peers still
// appear in `tailscale status`) and a few well-known hostnames.
//
// Two stages keep it cheap: a TCP connect sweep (no HTTP, no allocation per
// closed port), then one unauthenticated `ping.view` against each open port. A
// Subsonic server answers that with a `subsonic-response` envelope even when it
// rejects the missing credentials, which is what identifies it. No credentials
// are ever sent, and only private / CGNAT / link-local addresses are swept.
const net = require('net');
const http = require('http');
const https = require('https');
const os = require('os');
const { execFile } = require('child_process');

const PORTS = [4533, 4747, 4040]; // Navidrome, Gonic, Airsonic / Subsonic
const HOSTNAMES = [
  'localhost',
  'navidrome',
  'navidrome.local',
  'gonic',
  'gonic.local',
  'airsonic',
  'airsonic.local',
  'subsonic',
  'subsonic.local',
  'music',
  'music.local',
];
const TAILSCALE_BINS = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
];
const MAX_SWEEP_HOSTS = 1024;
const CONCURRENCY = 48;
const CONNECT_TIMEOUT_MS = 700;
const PING_TIMEOUT_MS = 2500;
const PING_PATH = '/rest/ping.view?v=1.16.1&c=xylonic&f=json';

const ipToInt = (ip) => ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0);
const intToIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const inCgnat = (ip) => (ipToInt(ip) & 0xffc00000) >>> 0 === 0x64400000; // 100.64.0.0/10
const isPrivate = (ip) => {
  const n = ipToInt(ip);
  return (
    inCgnat(ip) ||
    (n & 0xff000000) >>> 0 === 0x0a000000 || // 10/8
    (n & 0xfff00000) >>> 0 === 0xac100000 || // 172.16/12
    (n & 0xffff0000) >>> 0 === 0xc0a80000 || // 192.168/16
    (n & 0xffff0000) >>> 0 === 0xa9fe0000 || // 169.254/16
    (n & 0xff000000) >>> 0 === 0x7f000000 // 127/8
  );
};
const VPN_IFACE = /^(tun|tap|wg|ppp|utun|zt)|wireguard|openvpn|zerotier|vpn/i;

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(CONNECT_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

// Resolves { type, version } for a Subsonic-API server, or null.
function ping(baseUrl) {
  return new Promise((resolve) => {
    const lib = baseUrl.startsWith('https') ? https : http;
    const req = lib.get(baseUrl + PING_PATH, { timeout: PING_TIMEOUT_MS }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return resolve(null);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on('end', () => {
        try {
          const r = JSON.parse(body)['subsonic-response'];
          if (r) return resolve({ type: r.type || 'subsonic', version: r.serverVersion || r.version });
        } catch {
          /* not JSON — original Subsonic answers XML */
        }
        resolve(body.includes('<subsonic-response') ? { type: 'subsonic' } : null);
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function tailscalePeers() {
  const attempt = (i) =>
    new Promise((resolve) => {
      if (i >= TAILSCALE_BINS.length) return resolve([]);
      execFile(TAILSCALE_BINS[i], ['status', '--json'], { timeout: 3000, maxBuffer: 4 << 20 }, (err, out) => {
        if (err) return resolve(attempt(i + 1));
        try {
          const peers = Object.values(JSON.parse(out).Peer || {})
            .filter((p) => p.Online)
            .map((p) => ({
              ip: (p.TailscaleIPs || []).find((a) => a.includes('.')),
              label: p.HostName || (p.DNSName || '').split('.')[0],
              dns: (p.DNSName || '').replace(/\.$/, ''),
            }))
            .filter((p) => p.ip);
          resolve(peers);
        } catch {
          resolve([]);
        }
      });
    });
  return attempt(0);
}

function subnetTargets() {
  const targets = [];
  let budget = MAX_SWEEP_HOSTS;
  for (const [ifName, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivate(a.address) || inCgnat(a.address)) continue;
      let prefix = a.netmask.split('.').reduce((n, o) => n + Number(o).toString(2).replace(/0/g, '').length, 0);
      if (prefix < 22) prefix = 24; // don't sweep a /16 — stay on our own /24
      if (prefix >= 31) continue;
      const mask = (0xffffffff << (32 - prefix)) >>> 0;
      const self = ipToInt(a.address);
      const network = (self & mask) >>> 0;
      const via = VPN_IFACE.test(ifName) ? 'vpn' : 'lan';
      for (let n = network + 1; n < (network | ~mask) >>> 0 && budget > 0; n++, budget--) {
        if (n !== self) targets.push({ host: intToIp(n), via, name: intToIp(n) });
      }
    }
  }
  return targets;
}

function registerServerDiscoveryIpc({ ipcMain }) {
  let scan = null; // { cancelled } of the scan in flight

  const runScan = async (sender) => {
    const token = { cancelled: false };
    if (scan) scan.cancelled = true;
    scan = token;

    const seen = new Set();
    const emit = (url, name, via, info) => {
      if (token.cancelled || seen.has(url) || sender.isDestroyed()) return;
      seen.add(url);
      sender.send('server-discovered', { url, name, via, type: info.type, version: info.version });
    };

    const tasks = [];
    const addHost = (host, name, via, withHttps) => {
      for (const port of PORTS) tasks.push({ host, port, name, via, scheme: 'http' });
      if (withHttps) tasks.push({ host, port: 443, name, via, scheme: 'https' });
    };

    for (const h of HOSTNAMES) addHost(h, h, h === 'localhost' ? 'local' : 'lan', h !== 'localhost');
    const peers = await tailscalePeers();
    for (const p of peers) {
      addHost(p.ip, p.label, 'tailscale', false);
      if (p.dns) addHost(p.dns, p.label, 'tailscale', true);
    }
    for (const t of subnetTargets()) addHost(t.host, t.name, t.via, false);

    let next = 0;
    const worker = async () => {
      while (!token.cancelled && next < tasks.length) {
        const { host, port, name, via, scheme } = tasks[next++];
        if (!(await tcpOpen(host, port))) continue;
        const portPart = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`;
        const base = `${scheme}://${host}${portPart}`;
        const info = await ping(base);
        if (info) emit(base, name, via, info);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (scan === token) scan = null;
  };

  ipcMain.handle('discover-servers', (event) => runScan(event.sender));
  ipcMain.handle('cancel-server-discovery', () => {
    if (scan) scan.cancelled = true;
  });
}

module.exports = { registerServerDiscoveryIpc };
