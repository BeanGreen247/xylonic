/**
 * credentialsService — single authoritative credential path (WS-SEC).
 *
 * Backends:
 *  - Electron: password encrypted at rest via safeStorage (secureCredentialService).
 *  - Capacitor (Android/iOS): TODO Keychain/Keystore via @capacitor/preferences
 *    group; currently falls through to the cache like web.
 *  - Web: in-memory for the session.
 *
 * `localStorage` is still used as the synchronous hydration source so the existing
 * call sites keep their current timing semantics (they read `localStorage`
 * synchronously today). Removing plaintext-at-rest is the WS-SEC endgame and is
 * gated on migrating every reader to `getCached()` first — see docs/ROADMAP.md.
 */
import { logger } from '../utils/logger';
import {
  isSecureStorageAvailable,
  saveCredentials,
  getDecryptedPassword,
  deleteCredentials,
} from './secureCredentialService';

export interface Credentials {
  serverUrl: string;
  username: string;
  password: string;
}

const EMPTY: Credentials = { serverUrl: '', username: '', password: '' };

function readLocalStorage(): Credentials {
  try {
    return {
      serverUrl: localStorage.getItem('serverUrl') || '',
      username: localStorage.getItem('username') || '',
      password: localStorage.getItem('password') || '',
    };
  } catch {
    return { ...EMPTY };
  }
}

let cache: Credentials = readLocalStorage();

/** Synchronous best-effort read — drop-in for the old `localStorage` triple. */
export function getCached(): Credentials {
  return cache;
}

/** Async read: prefers the encrypted backend for the password, refreshes cache. */
export async function get(): Promise<Credentials> {
  const base = readLocalStorage();
  cache = base;
  if (base.serverUrl && base.username) {
    try {
      if (await isSecureStorageAvailable()) {
        const pw = await getDecryptedPassword(base.serverUrl, base.username);
        if (pw) cache = { ...base, password: pw };
      }
    } catch (e) {
      logger.error('[Credentials] secure read failed', e);
    }
  }
  return cache;
}

/** Populate the sync cache from the encrypted backend once at boot. */
export async function hydrate(): Promise<void> {
  await get();
}

/** Persist credentials (encrypted where supported). */
export async function set(c: Credentials): Promise<void> {
  cache = { ...c };
  try {
    localStorage.setItem('serverUrl', c.serverUrl);
    localStorage.setItem('username', c.username);
    // Plaintext kept until every reader uses getCached() (WS-SEC endgame).
    localStorage.setItem('password', c.password);
  } catch (e) {
    logger.error('[Credentials] localStorage write failed', e);
  }
  try {
    if (await isSecureStorageAvailable()) {
      await saveCredentials(c.serverUrl, c.username, c.password);
    }
  } catch (e) {
    logger.error('[Credentials] secure write failed', e);
  }
}

/** Wipe the password (keeps username so themes still load, matching logout()). */
export async function clear(): Promise<void> {
  const { serverUrl, username } = cache;
  cache = { ...cache, password: '' };
  try {
    localStorage.removeItem('password');
  } catch {
    /* ignore */
  }
  try {
    if (serverUrl && username && (await isSecureStorageAvailable())) {
      await deleteCredentials(serverUrl, username);
    }
  } catch (e) {
    logger.error('[Credentials] secure clear failed', e);
  }
}

export const credentialsService = { get, getCached, hydrate, set, clear };
