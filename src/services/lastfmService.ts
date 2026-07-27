import md5 from 'md5';

const API_BASE = 'https://ws.audioscrobbler.com/2.0/';
const configKey = (appUser: string) => `xylonic_lastfm_${appUser}`;

export interface LastfmConfig {
  enabled: boolean;
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
  lastfmUsername: string;
}

export function getLastfmConfig(appUsername: string): LastfmConfig | null {
  try {
    const raw = localStorage.getItem(configKey(appUsername));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveLastfmConfig(appUsername: string, config: LastfmConfig): void {
  localStorage.setItem(configKey(appUsername), JSON.stringify(config));
}

export function clearLastfmConfig(appUsername: string): void {
  localStorage.removeItem(configKey(appUsername));
}

function buildApiSig(params: Record<string, string>, apiSecret: string): string {
  const keys = Object.keys(params).filter(k => k !== 'format').sort();
  const str = keys.map(k => `${k}${params[k]}`).join('') + apiSecret;
  return md5(str);
}

async function apiPost(params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, format: 'json' });
  const resp = await fetch(API_BASE, { method: 'POST', body });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function lastfmAuthenticate(
  apiKey: string,
  apiSecret: string,
  username: string,
  password: string,
): Promise<{ success: boolean; sessionKey?: string; error?: string }> {
  try {
    const params: Record<string, string> = {
      method: 'auth.getMobileSession',
      username,
      password,
      api_key: apiKey,
    };
    params.api_sig = buildApiSig(params, apiSecret);
    const data = await apiPost(params);
    if (data?.session?.key) return { success: true, sessionKey: data.session.key };
    const msg = data?.message ?? 'Authentication failed';
    return { success: false, error: `${msg}${data?.error ? ` (code ${data.error})` : ''}` };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Network error' };
  }
}

export async function lastfmUpdateNowPlaying(
  config: LastfmConfig,
  song: { title: string; artist: string; album: string; duration?: number },
): Promise<void> {
  if (!config.enabled || !config.sessionKey) return;
  try {
    const params: Record<string, string> = {
      method: 'track.updateNowPlaying',
      track: song.title,
      artist: song.artist,
      album: song.album ?? '',
      api_key: config.apiKey,
      sk: config.sessionKey,
    };
    if (song.duration) params.duration = String(Math.floor(song.duration));
    params.api_sig = buildApiSig(params, config.apiSecret);
    await apiPost(params);
  } catch { /* fire-and-forget */ }
}

export async function lastfmScrobble(
  config: LastfmConfig,
  song: { title: string; artist: string; album: string; duration?: number },
  startTimestamp: number,
): Promise<void> {
  if (!config.enabled || !config.sessionKey) return;
  try {
    const params: Record<string, string> = {
      method: 'track.scrobble',
      'track[0]': song.title,
      'artist[0]': song.artist,
      'album[0]': song.album ?? '',
      'timestamp[0]': String(startTimestamp),
      api_key: config.apiKey,
      sk: config.sessionKey,
    };
    if (song.duration) params['duration[0]'] = String(Math.floor(song.duration));
    params.api_sig = buildApiSig(params, config.apiSecret);
    await apiPost(params);
  } catch { /* fire-and-forget */ }
}
