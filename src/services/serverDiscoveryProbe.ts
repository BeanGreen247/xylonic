import type { DiscoveredServer } from '../platform/bridge';
import { getLocalNetwork } from './remoteDiscoveryService';
import { getConnectionHistory } from './connectionHistoryService';

// Renderer-side discovery for platforms without a native scanner (Android/iOS
// WebView, plain browser). Electron uses the main-process scanner instead
// (`public/ipc/serverDiscovery.js`), which can open raw TCP sockets; a WebView
// can only fetch(), so this does the same job in two stages:
//   1. servers we already know: saved/previous connections, the page host and a
//      few well-known hostnames (MagicDNS / mDNS names);
//   2. a sweep of the local subnet. Android reports its Wi-Fi/Ethernet network
//      through the native RemoteDiscovery plugin; without that (iOS, browsers)
//      the /24s of known servers and the usual home ranges are swept instead.
// A port counts as open when a no-cors fetch settles instead of failing, and is
// then confirmed with an unauthenticated ping.view, so only real Subsonic-API
// servers are reported. No credentials are ever sent.

const PORTS = [4533, 4747, 4040]; // Navidrome, Gonic, Airsonic / Subsonic
const HOSTNAMES = ['navidrome', 'navidrome.local', 'gonic', 'gonic.local', 'airsonic', 'airsonic.local', 'subsonic', 'subsonic.local', 'music', 'music.local'];
const PING_PATH = '/rest/ping.view?v=1.16.1&c=xylonic&f=json';
const TIMEOUT_MS = 2000;
const OPEN_TIMEOUT_MS = 700;
const CONCURRENCY = 64;
const MAX_SWEEP_HOSTS = 1024;
const DEFAULT_SUBNETS = ['192.168.0', '192.168.1'];

async function ping(baseUrl: string): Promise<{ type: string; version?: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + PING_PATH, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.text();
    try {
      const r = JSON.parse(body)['subsonic-response'];
      if (r) return { type: r.type || 'subsonic', version: r.serverVersion || r.version };
    } catch {
      /* XML-only original Subsonic */
    }
    return body.includes('<subsonic-response') ? { type: 'subsonic' } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const ipToInt = (ip: string) => ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0);
const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const isPrivateIp = (ip: string) => {
  const n = ipToInt(ip);
  return (
    (n & 0xff000000) >>> 0 === 0x0a000000 || // 10/8
    (n & 0xfff00000) >>> 0 === 0xac100000 || // 172.16/12
    (n & 0xffff0000) >>> 0 === 0xc0a80000 // 192.168/16
  );
};

/** Host addresses of the network `ip`/`prefix` (clamped to at most MAX_SWEEP_HOSTS), minus our own address. */
function subnetHosts(ip: string, prefix: number): string[] {
  const bits = Math.min(30, Math.max(32 - Math.log2(MAX_SWEEP_HOSTS), prefix));
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  const base = (ipToInt(ip) & mask) >>> 0;
  const size = 2 ** (32 - bits);
  const self = ipToInt(ip);
  const hosts: string[] = [];
  for (let i = 1; i < size - 1; i += 1) {
    const addr = (base + i) >>> 0;
    if (addr !== self) hosts.push(intToIp(addr));
  }
  return hosts;
}

/** True when something answers on host:port — any settled fetch (even an opaque one) means the port is open. */
async function portOpen(host: string, port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
  try {
    await fetch(`http://${host}:${port}/`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Servers the user has used before, as base URLs (scheme and port kept). */
function knownServerUrls(): string[] {
  const urls = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try { urls.add(new URL(raw).origin); } catch { /* not a URL */ }
  };
  try { add(localStorage.getItem('serverUrl')); } catch { /* storage unavailable */ }
  for (const profile of getConnectionHistory()) add(profile.serverUrl);
  return [...urls];
}

export function probeKnownHosts(onFound: (server: DiscoveredServer) => void, onDone: () => void): () => void {
  let cancelled = false;
  const reported = new Set<string>();
  const report = (url: string, name: string, info: { type: string; version?: string }) => {
    if (cancelled || reported.has(url)) return;
    reported.add(url);
    onFound({ url, name, via: 'lan', type: info.type, version: info.version });
  };

  const run = async () => {
    const known = knownServerUrls();
    const tasks: Array<() => Promise<void>> = [];

    // 1. Servers we already know (saved + previous connections): answered first.
    for (const url of known) {
      tasks.push(async () => {
        const info = await ping(url);
        if (info) report(url, new URL(url).hostname, info);
      });
    }

    // 2. Subnet sweep, most common port first so a Navidrome server shows up early.
    const sweep = new Set<string>();
    const network = await getLocalNetwork();
    if (network && isPrivateIp(network.ip)) {
      subnetHosts(network.ip, network.prefix).forEach((h) => sweep.add(h));
    } else {
      const prefixes = new Set<string>();
      for (const url of known) {
        const host = new URL(url).hostname;
        if (IPV4.test(host) && isPrivateIp(host)) prefixes.add(host.split('.').slice(0, 3).join('.'));
      }
      (prefixes.size ? [...prefixes] : DEFAULT_SUBNETS).forEach((prefix) => {
        for (let i = 1; i < 255; i += 1) sweep.add(`${prefix}.${i}`);
      });
    }
    const skip = new Set(known.map((u) => new URL(u).host));
    for (const port of PORTS) {
      for (const host of sweep) {
        if (skip.has(`${host}:${port}`)) continue;
        tasks.push(async () => {
          if (!(await portOpen(host, port))) return;
          const url = `http://${host}:${port}`;
          const info = await ping(url);
          if (info) report(url, host, info);
        });
      }
    }

    // 3. Well-known names (MagicDNS / mDNS) and, in a browser, the page's own host.
    const hosts = [...HOSTNAMES];
    const pageHost = typeof location !== 'undefined' ? location.hostname : '';
    if (pageHost && /^https?:$/.test(location.protocol) && pageHost !== 'localhost' && !hosts.includes(pageHost)) hosts.unshift(pageHost);
    for (const host of hosts) {
      for (const port of PORTS) {
        tasks.push(async () => {
          const url = `http://${host}:${port}`;
          const info = await ping(url);
          if (info) report(url, host, info);
        });
      }
    }

    // One bounded pool for everything, in the order above.
    const queue = tasks;
    const worker = async () => {
      while (!cancelled && queue.length > 0) await queue.shift()!();
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  };

  run().finally(() => {
    if (!cancelled) onDone();
  });
  return () => {
    cancelled = true;
  };
}
