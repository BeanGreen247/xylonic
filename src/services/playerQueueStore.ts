import { logger } from '../utils/logger';

/**
 * IndexedDB-backed store for the persisted playback queue's *song bodies*
 * (WS-PERF T22). `playerPersistence.ts` still keeps the cheap, always-fresh
 * bits in localStorage — song IDs, the current index, shuffle/repeat prefs —
 * synchronously. This store holds the actual `Song[]` array, written via
 * IndexedDB structured clone (no `JSON.stringify`) instead of
 * `localStorage.setItem(JSON.stringify(...))`, and only when the queue's
 * song *identity* actually changes — not on every `next`/`prev`/shuffle,
 * which only move an index.
 *
 * Same "hydrate before first paint" shape as `persistentCache`: `init()` is
 * raced against a timeout in `index.tsx` before `root.render`, so by the
 * time `PlayerContext` runs its `useState` initializers, `getSync()` already
 * has the answer — no async flash of an empty queue on a warm relaunch.
 */

const DB_NAME = 'xylonic-queue-store';
const DB_VERSION = 1;
const STORE = 'queues';

class PlayerQueueStore {
    private db: IDBDatabase | null = null;
    private ready: Promise<void> | null = null;
    private mem = new Map<string, unknown[]>();

    /** Open IDB and hydrate the memory tier. Idempotent; safe to call early. */
    init(): Promise<void> {
        if (this.ready) return this.ready;
        this.ready = new Promise<void>((resolve) => {
            let req: IDBOpenDBRequest;
            try {
                req = indexedDB.open(DB_NAME, DB_VERSION);
            } catch {
                resolve(); // no IDB (private mode / disabled) — memory-only, empty
                return;
            }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onerror = () => {
                logger.warn('[QueueStore] IDB open failed — queue will not persist across restarts');
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
            const tx = this.db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return;
                this.mem.set(String(cursor.key), cursor.value as unknown[]);
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    /** Sync read from the memory tier. Only reliable after `init()` resolves. */
    getSync<T>(user: string): T[] | null {
        return (this.mem.get(user) as T[] | undefined) ?? null;
    }

    /** Fire-and-forget write: memory now, IDB in the background. */
    set<T>(user: string, songs: T[]): void {
        this.mem.set(user, songs as unknown[]);
        if (!this.db) return;
        try {
            const tx = this.db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(songs, user);
        } catch {
            /* transaction may fail if the DB is closing — memory tier still holds it */
        }
    }

    /** Drop a user's persisted queue (logout). */
    clear(user: string): void {
        this.mem.delete(user);
        if (!this.db) return;
        try {
            const tx = this.db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(user);
        } catch {
            /* ignore — memory tier is already cleared */
        }
    }
}

export const playerQueueStore = new PlayerQueueStore();
