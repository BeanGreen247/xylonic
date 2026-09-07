/**
 * Orphan-recovery planning for downloadManagerService (WS-ARCH split slice 2).
 *
 * When a native batch download completes but the `songDownloaded` event never
 * reaches JS (renderer OOM on Android, WKWebView suspended on iOS), the song is
 * on disk but absent from the cache index. On next launch the service reads the
 * native completion log and cross-checks it against the pending-batch map it
 * persisted before starting. This module is the pure decision layer — the I/O
 * (reading the log, calling registerNativeDownload, clearing the log) stays in
 * the service.
 */
import type { DownloadQuality, DownloadableSong } from '../types/offline';

/** A native completion-log record, normalised across the Android / iOS shapes. */
export interface CompletionEntry {
  songId: string;
  hash: string;
  extension: string;
  fileSize: number;
}

export interface PendingItem {
  song: DownloadableSong;
  quality: DownloadQuality;
  artistId?: string;
  artistCoverArtId?: string;
}

/** Everything registerNativeDownload needs for one recovered song. */
export interface OrphanRegistration extends PendingItem {
  hash: string;
  extension: string;
  fileSize: number;
}

/**
 * Given the native completion log, the persisted pending-batch map and an
 * `isCached` check, return the songs that are genuine orphans and the exact
 * args to re-register them with. Entries already in the cache, or with no
 * matching pending record, are skipped.
 */
export function planOrphanReconciliation(
  entries: CompletionEntry[],
  pending: Record<string, PendingItem>,
  isCached: (id: string) => boolean,
): OrphanRegistration[] {
  const out: OrphanRegistration[] = [];
  for (const entry of entries) {
    if (isCached(entry.songId)) continue;
    const item = pending[entry.songId];
    if (!item) continue;
    out.push({
      song: item.song,
      quality: item.quality,
      artistId: item.artistId,
      artistCoverArtId: item.artistCoverArtId,
      hash: entry.hash,
      extension: entry.extension,
      fileSize: entry.fileSize,
    });
  }
  return out;
}

/**
 * Merge freshly-queued items into the persisted pending-batch map (keyed by
 * song id) — merge, not overwrite, so several crashed batches all stay
 * recoverable.
 */
export function mergePendingBatch(
  existing: Record<string, PendingItem>,
  items: Array<{ song: { id: string } & DownloadableSong; quality: DownloadQuality; artistId?: string; artistCoverArtId?: string }>,
): Record<string, PendingItem> {
  const next: Record<string, PendingItem> = { ...existing };
  for (const item of items) {
    next[item.song.id] = {
      song: item.song,
      quality: item.quality,
      artistId: item.artistId,
      artistCoverArtId: item.artistCoverArtId,
    };
  }
  return next;
}

/** Parse the pending-batch localStorage value; tolerate corruption → {}. */
export function parsePendingBatch(raw: string | null): Record<string, PendingItem> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The iOS path historically stored the pending set as the raw queue array under
 * a different key; reduce that shape to the same keyed map.
 */
export function pendingBatchFromQueueArray(raw: string | null): Record<string, PendingItem> {
  if (!raw) return {};
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return {};
    const map: Record<string, PendingItem> = {};
    for (const item of arr) {
      const id = item?.song?.id;
      if (id) map[id] = item;
    }
    return map;
  } catch {
    return {};
  }
}
