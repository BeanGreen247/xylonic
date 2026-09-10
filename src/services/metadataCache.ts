import { persistentCache } from './persistentCache';

// Thin facade over `persistentCache` (WS-PERF). Keeps the historical sync
// get/set/invalidate API its consumers (ArtistList / AlbumList / SongList /
// AllAlbumsGrid) already use, but the data now survives a reload / app restart
// because `persistentCache` is IndexedDB-backed. New call sites that want
// stale-while-revalidate should use `persistentCache.swr(...)` directly.

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const PREFIX = 'meta:';

class MetadataCache {
  set(key: string, data: unknown, ttlMs: number = DEFAULT_TTL): void {
    persistentCache.set(PREFIX + key, data, ttlMs);
  }

  get<T>(key: string): T | null {
    return persistentCache.get<T>(PREFIX + key);
  }

  invalidate(prefix?: string): void {
    persistentCache.invalidate(prefix === undefined ? PREFIX : PREFIX + prefix);
  }

  /** Stale-while-revalidate read — see `persistentCache.swr`. */
  swr<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = DEFAULT_TTL,
    opts?: { onRevalidated?: (fresh: T) => void },
  ): Promise<T> {
    return persistentCache.swr<T>(PREFIX + key, fetcher, ttlMs, opts);
  }
}

export const metadataCache = new MetadataCache();
