/**
 * Pure helpers pulled out of the `downloadManagerService` god-object (WS-ARCH).
 * No `this`, no I/O — just the arithmetic and string munging the service does
 * inline, now unit-testable in isolation. The service imports these; behaviour
 * is unchanged.
 */
import type { DownloadQuality, DownloadableSong } from '../types/offline';

/** Quality preset → Subsonic `maxBitRate`. `original` = no transcoding. */
export function qualityToBitrate(quality: DownloadQuality): number | undefined {
  switch (quality) {
    case '320':
      return 320;
    case '256':
      return 256;
    case '128':
      return 128;
    case '64':
      return 64;
    case 'original':
    default:
      return undefined;
  }
}

/** Human-readable transfer rate for the OS download notification. */
export function formatSpeed(bps: number): string {
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Strip characters that are illegal in filenames on Windows/Android, cap length. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

export interface SpeedSample {
  time: number;
  bytes: number;
}

/**
 * Rolling-window transfer speed. Given prior samples plus the current
 * (now, bytesReceived), drop samples older than `windowMs` and return
 * bytes/sec across the retained window (0 if fewer than 2 samples).
 */
export function computeSpeedBps(
  samples: SpeedSample[],
  now: number,
  bytesReceived: number,
  windowMs = 3000,
): { samples: SpeedSample[]; bps: number } {
  const next = [...samples, { time: now, bytes: bytesReceived }].filter(
    (s) => now - s.time <= windowMs,
  );
  if (next.length < 2) return { samples: next, bps: 0 };
  const oldest = next[0];
  const dt = (now - oldest.time) / 1000;
  const bps = dt > 0 ? (bytesReceived - oldest.bytes) / dt : 0;
  return { samples: next, bps };
}

/** Songs from a request that aren't already cached or already queued/downloading. */
export function filterUnqueuedSongs<T extends { id: string }>(
  songs: T[],
  isCached: (id: string) => boolean,
  activeIds: Set<string>,
): T[] {
  return songs.filter((s) => !isCached(s.id) && !activeIds.has(s.id));
}

export interface ProgressCounters {
  sessionTotal: number;
  sessionCompleted: number;
  sessionFailed: number;
  /** progress (0-100) of every item currently 'downloading' */
  downloadingProgress: number[];
}

export interface ProgressNumbers {
  totalSongs: number;
  completedSongs: number;
  failedSongs: number;
  pendingSongs: number;
  overallProgress: number;
}

/** The numeric half of `getProgress()` — see downloadManagerService. */
export function computeProgress(c: ProgressCounters): ProgressNumbers {
  const totalSongs = c.sessionTotal;
  const completedSongs = c.sessionCompleted;
  const failedSongs = c.sessionFailed;
  const pendingSongs = Math.max(0, totalSongs - completedSongs - failedSongs);

  let overallProgress = 0;
  if (totalSongs > 0) {
    const inFlight = c.downloadingProgress.reduce((sum, p) => sum + (p ?? 0), 0);
    overallProgress = Math.min(100, Math.round((completedSongs * 100 + inFlight) / totalSongs));
  }

  return { totalSongs, completedSongs, failedSongs, pendingSongs, overallProgress };
}

// Re-exported so callers can keep a single import site.
export type { DownloadQuality, DownloadableSong };
