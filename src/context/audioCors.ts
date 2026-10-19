/**
 * Probes whether the Subsonic server answers cross-origin requests. When it
 * does, the shared audio element can be marked crossOrigin="anonymous", which
 * lets Web Audio (the Car Mode spectrum) read streamed audio instead of getting
 * silence from a CORS-tainted source. Resolves false on any failure so a server
 * without CORS headers keeps the plain, untouched element.
 */
export async function serverAllowsCors(): Promise<boolean> {
  let serverUrl = '';
  try { serverUrl = localStorage.getItem('serverUrl') ?? ''; } catch { return false; }
  if (!/^https?:\/\//i.test(serverUrl)) return false;
  const base = serverUrl.replace(/\/+$/, '');
  if (new URL(base).origin === window.location.origin) return false; // same origin: nothing to do
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    // A successful (non-opaque) response in cors mode means the server sent Access-Control-Allow-Origin.
    await fetch(`${base}/rest/ping.view?v=1.16.1&c=Xylonic&f=json`, { mode: 'cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
