import type { DiscoveredServer } from '../platform/bridge';

// Renderer-side discovery for platforms without a native scanner (Android/iOS
// WebView, plain browser). A WebView can't enumerate its own subnet or ask
// Tailscale for peers, so this only probes well-known hostnames (which resolve
// over Tailscale MagicDNS / LAN mDNS when the device is on those networks) and,
// in a browser, the host the page was served from. Electron uses the main
// process scanner instead (`public/ipc/serverDiscovery.js`).

const PORTS = [4533, 4747, 4040]; // Navidrome, Gonic, Airsonic / Subsonic
const HOSTNAMES = ['navidrome', 'navidrome.local', 'gonic', 'gonic.local', 'airsonic', 'airsonic.local', 'subsonic', 'subsonic.local', 'music', 'music.local'];
const PING_PATH = '/rest/ping.view?v=1.16.1&c=xylonic&f=json';
const TIMEOUT_MS = 1500;
const CONCURRENCY = 6;

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

export function probeKnownHosts(onFound: (server: DiscoveredServer) => void, onDone: () => void): () => void {
  let cancelled = false;
  const hosts = [...HOSTNAMES];
  const pageHost = typeof location !== 'undefined' ? location.hostname : '';
  if (pageHost && /^https?:$/.test(location.protocol) && pageHost !== 'localhost' && !hosts.includes(pageHost)) {
    hosts.unshift(pageHost);
  }
  const queue = hosts.flatMap((host) => PORTS.map((port) => ({ host, port })));

  const worker = async () => {
    while (!cancelled && queue.length > 0) {
      const { host, port } = queue.shift()!;
      const url = `http://${host}:${port}`;
      const info = await ping(url);
      if (info && !cancelled) onFound({ url, name: host, via: 'lan', type: info.type, version: info.version });
    }
  };

  Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => {
    if (!cancelled) onDone();
  });
  return () => {
    cancelled = true;
  };
}
