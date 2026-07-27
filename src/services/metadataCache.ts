const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

class MetadataCache {
  private store = new Map<string, { data: unknown; expiresAt: number }>();

  set(key: string, data: unknown, ttlMs: number = DEFAULT_TTL): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  invalidate(prefix?: string): void {
    if (prefix === undefined) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

export const metadataCache = new MetadataCache();
