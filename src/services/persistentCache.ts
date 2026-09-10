import { logger } from '../utils/logger';

// Persistent, stale-while-revalidate key/value cache (WS-PERF).
//
// Two tiers: a synchronous in-memory Map in front of an IndexedDB object store.
// The memory tier is hydrated from IDB once at boot, so after the first launch
// the library views can paint from disk instead of showing skeletons while
// sequential Subsonic fetches run.
//
//   get(key)      — sync, memory tier only, honours the per-entry TTL
//   set(key,d,ttl)— memory now, IDB write fire-and-forget
//   swr(key,fn,o) — serve cached immediately; if stale, refresh in the
//                   background (deduped); on a miss, await the fetcher
//
// Entries past `ttlMs` are stale; entries past `ttlMs * STALE_FACTOR` are dead
// and treated as a miss.

interface Entry<T = unknown> {
    data: T;
    storedAt: number;
    ttlMs: number;
}

const DB_NAME = 'xylonic-perf-cache';
const DB_VERSION = 1;
const STORE = 'kv';
const STALE_FACTOR = 8; // dead once age > ttlMs * 8
const MAX_ENTRIES = 400; // evict oldest beyond this (keeps IDB + memory bounded)

class PersistentCache {
    private mem = new Map<string, Entry>();
    private db: IDBDatabase | null = null;
    private ready: Promise<void> | null = null;
    private inFlight = new Map<string, Promise<unknown>>();

    /** Open IDB and hydrate the memory tier. Idempotent; safe to call early. */
    init(): Promise<void> {
        if (this.ready) return this.ready;
        this.ready = new Promise<void>((resolve) => {
            let req: IDBOpenDBRequest;
            try {
                req = indexedDB.open(DB_NAME, DB_VERSION);
            } catch {
                resolve(); // no IDB (private mode / disabled) — memory-only
                return;
            }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onerror = () => {
                logger.warn('[PerfCache] IDB open failed — running memory-only');
                resolve();
            };
            req.onsuccess = () => {
                this.db = req.result;
                this.hydrate().finally(resolve);
            };
        });
        return this.ready;
    }

    private hydrate(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.db) return resolve();
            const now = Date.now();
            const tx = this.db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return;
                const entry = cursor.value as Entry;
                if (now - entry.storedAt <= entry.ttlMs * STALE_FACTOR) {
                    this.mem.set(String(cursor.key), entry);
                }
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    private writeIDB(key: string, entry: Entry): void {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(entry, key);
        } catch {
            /* transaction may fail if the DB is closing — memory tier still holds it */
        }
    }

    private deleteIDB(pred: (key: string) => boolean): void {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const cursorReq = store.openKeyCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return;
                if (pred(String(cursor.key))) store.delete(cursor.key);
                cursor.continue();
            };
        } catch {
            /* ignore — memory tier is the source of truth for the session */
        }
    }

    private evictIfNeeded(): void {
        if (this.mem.size <= MAX_ENTRIES) return;
        const oldest = [...this.mem.entries()]
            .sort((a, b) => a[1].storedAt - b[1].storedAt)
            .slice(0, this.mem.size - MAX_ENTRIES);
        for (const [key] of oldest) {
            this.mem.delete(key);
            this.deleteIDB((k) => k === key);
        }
    }

    /** Sync read from the memory tier. Returns null past the fresh TTL. */
    get<T>(key: string): T | null {
        const entry = this.mem.get(key);
        if (!entry) return null;
        if (Date.now() - entry.storedAt > entry.ttlMs) return null;
        return entry.data as T;
    }

    /** Read with freshness metadata (does not drop stale entries). */
    peek<T>(key: string): { data: T; fresh: boolean; stale: boolean } | null {
        const entry = this.mem.get(key);
        if (!entry) return null;
        const age = Date.now() - entry.storedAt;
        if (age > entry.ttlMs * STALE_FACTOR) return null;
        return { data: entry.data as T, fresh: age <= entry.ttlMs, stale: age > entry.ttlMs };
    }

    set<T>(key: string, data: T, ttlMs: number): void {
        const entry: Entry<T> = { data, storedAt: Date.now(), ttlMs };
        this.mem.set(key, entry);
        this.writeIDB(key, entry);
        this.evictIfNeeded();
    }

    /**
     * Stale-while-revalidate. Serves the cached value immediately when present;
     * refreshes in the background (deduped by key) when it is stale; awaits the
     * fetcher only on a hard miss.
     */
    async swr<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
        const hit = this.peek<T>(key);
        if (hit && hit.fresh) return hit.data;

        if (hit && hit.stale) {
            if (!this.inFlight.has(key)) {
                const p = fetcher()
                    .then((fresh) => {
                        this.set(key, fresh, ttlMs);
                        return fresh;
                    })
                    .catch((err) => {
                        logger.warn(`[PerfCache] revalidate failed for ${key}:`, err);
                        return hit.data;
                    })
                    .finally(() => this.inFlight.delete(key));
                this.inFlight.set(key, p);
            }
            return hit.data; // stale-but-usable now; the refresh lands next visit
        }

        // Hard miss — dedupe concurrent callers too.
        const existing = this.inFlight.get(key) as Promise<T> | undefined;
        if (existing) return existing;
        const p = fetcher()
            .then((fresh) => {
                this.set(key, fresh, ttlMs);
                return fresh;
            })
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, p);
        return p;
    }

    /** Drop everything (no prefix) or every key starting with `prefix`. */
    invalidate(prefix?: string): void {
        if (prefix === undefined) {
            this.mem.clear();
            this.deleteIDB(() => true);
            return;
        }
        for (const key of this.mem.keys()) {
            if (key.startsWith(prefix)) this.mem.delete(key);
        }
        this.deleteIDB((k) => k.startsWith(prefix));
    }
}

export const persistentCache = new PersistentCache();
