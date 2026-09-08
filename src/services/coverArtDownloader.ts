/**
 * Cover-art downloader
 *
 * The album- and artist-artwork half of a download job, split out of
 * downloadManagerService. Owns the per-batch dedup/alias bookkeeping so the
 * synchronous "claim the slot before any await" race guards stay intact — the
 * download manager just calls `download()` per song and `reset()` whenever it
 * clears its queue. Behaviour is unchanged from the former inline method.
 */

import md5 from 'md5';
import type { DownloadQueueItem } from '../types/offline';
import { offlineCacheService } from './offlineCacheService';
import { logger } from '../utils/logger';

// Cryptographically-random hex salt for Subsonic auth params (16 bytes).
const randomSalt = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

export class CoverArtDownloader {
  private downloadedAlbumCovers: Set<string> = new Set();
  private downloadedArtistCovers: Set<string> = new Set();
  // albumId → the coverArt id chosen as that album's primary art (first seen)
  private albumCoverArtMap: Map<string, string> = new Map();
  // albumId → coverArt ids waiting to be aliased once the primary finishes
  private pendingCoverArtAliases: Map<string, string[]> = new Map();

  /** Drop all per-batch dedup state — call when the queue is cleared/reset. */
  reset(): void {
    this.downloadedAlbumCovers.clear();
    this.downloadedArtistCovers.clear();
    this.albumCoverArtMap.clear();
    this.pendingCoverArtAliases.clear();
  }

  async download(
    item: DownloadQueueItem,
    serverUrl: string,
    username: string,
    password: string,
  ): Promise<void> {
    // ── Album cover art ──────────────────────────────────────────────────────
    if (item.song.coverArt) {
      const alreadyClaimed = this.downloadedAlbumCovers.has(item.albumId);

      // Claim the slot synchronously before any await so concurrent events
      // from the same album don't race past this guard.
      if (!alreadyClaimed) {
        this.downloadedAlbumCovers.add(item.albumId);
        this.albumCoverArtMap.set(item.albumId, item.song.coverArt);
      }

      if (!alreadyClaimed && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
        try {
          const salt  = randomSalt();
          const token = md5(password + salt);
          const url   = `${serverUrl}/rest/getCoverArt.view?id=${item.song.coverArt}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
          const res   = await fetch(url);
          if (res.ok) {
            const data = await res.arrayBuffer();
            const ct   = res.headers.get('content-type') || 'image/jpeg';
            const ext  = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
            await offlineCacheService.cacheCoverArt(item.song.coverArt, new Uint8Array(data), ext);
            // Apply any aliases that raced ahead before this download completed
            const pending = this.pendingCoverArtAliases.get(item.albumId) || [];
            this.pendingCoverArtAliases.delete(item.albumId);
            for (const aliasId of pending) {
              offlineCacheService.createCoverArtAlias(aliasId, item.song.coverArt).catch(() => {});
            }
          }
        } catch (e) {
          logger.warn('[DownloadManager] Failed to cache album cover art:', e);
        }
      } else if (alreadyClaimed && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
        // Different coverArt ID for the same album — alias to the primary
        const primaryId = this.albumCoverArtMap.get(item.albumId);
        if (primaryId && offlineCacheService.isCoverArtCached(primaryId)) {
          offlineCacheService.createCoverArtAlias(item.song.coverArt, primaryId).catch(() => {});
        } else {
          // Primary art is still downloading — buffer for when it completes
          const pending = this.pendingCoverArtAliases.get(item.albumId) || [];
          if (!pending.includes(item.song.coverArt)) pending.push(item.song.coverArt);
          this.pendingCoverArtAliases.set(item.albumId, pending);
        }
      }
    }

    // ── Artist cover art ─────────────────────────────────────────────────────
    const artistKey = item.artistId || item.artistName;
    if (item.artistCoverArtId && artistKey) {
      const alreadyClaimed = this.downloadedArtistCovers.has(artistKey);

      // Claim synchronously before any await.
      if (!alreadyClaimed) this.downloadedArtistCovers.add(artistKey);

      if (!alreadyClaimed && !offlineCacheService.isCoverArtCached(item.artistCoverArtId)) {
        let artistArtCached = false;
        try {
          const salt  = randomSalt();
          const token = md5(password + salt);
          const url   = `${serverUrl}/rest/getCoverArt.view?id=${item.artistCoverArtId}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
          const res   = await fetch(url);
          if (res.ok) {
            const data = await res.arrayBuffer();
            const ct   = res.headers.get('content-type') || 'image/jpeg';
            const ext  = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
            await offlineCacheService.cacheCoverArt(item.artistCoverArtId, new Uint8Array(data), ext);
            artistArtCached = true;
          }
        } catch (e) {
          logger.warn('[DownloadManager] Failed to cache artist cover art:', e);
        }

        if (!artistArtCached) {
          const albumCoverId = this.albumCoverArtMap.get(item.albumId) || item.song.coverArt;
          if (albumCoverId && offlineCacheService.isCoverArtCached(albumCoverId)) {
            offlineCacheService.createCoverArtAlias(item.artistCoverArtId, albumCoverId).catch(() => {});
          }
        }
      }
    }
  }
}
