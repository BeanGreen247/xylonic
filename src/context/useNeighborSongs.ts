import { useEffect, useMemo, type MutableRefObject, type RefObject } from 'react';
import { offlineCacheService } from '../services/offlineCacheService';
import { imageCacheService } from '../services/imageCacheService';
import { getCoverArtUrl } from '../services/subsonicApi';
import { getFromStorage } from '../utils/storage';
import { getBridge } from '../platform/bridge';
import { PREFETCH_AHEAD, getPerfMode } from '../services/perfModeService';

type SongLike = { id: string; url: string; coverArt?: string };

interface NeighborDeps<S extends SongLike> {
  playlist: S[];
  currentIndex: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  historyTip: S | null;
  shuffleQueueRef: MutableRefObject<number[]>;
  shuffleQueueIndexRef: MutableRefObject<number>;
  preloadRef: RefObject<HTMLAudioElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  offlineModeEnabledRef: RefObject<boolean>;
}

/**
 * Neighbor-song derivation + look-ahead preloading (WS-ARCH — extracted verbatim
 * from `PlayerContext`). Computes `nextSong` / `prevSong` and runs four effects:
 * audio buffer preload, a 15 s-before-end safety-net preload, cover-art
 * prefetch for the look-ahead window, and native-notification artwork preload.
 * Behaviour is unchanged — this is a lift-and-shift.
 */
export function useNeighborSongs<S extends SongLike>({
  playlist,
  currentIndex,
  shuffle,
  repeat,
  historyTip,
  shuffleQueueRef,
  shuffleQueueIndexRef,
  preloadRef,
  audioRef,
  offlineModeEnabledRef,
}: NeighborDeps<S>): { nextSong: S | null; prevSong: S | null } {
  const nextSong = useMemo<S | null>(() => {
    if (playlist.length === 0) return null;
    if (shuffle) {
      // Peek at the next position in the shuffle queue without advancing it
      const nextIdx = shuffleQueueRef.current[shuffleQueueIndexRef.current];
      return nextIdx !== undefined ? (playlist[nextIdx] ?? null) : null;
    }
    const i = currentIndex + 1;
    if (i >= playlist.length) return repeat === 'all' ? playlist[0] : null;
    return playlist[i];
  }, [playlist, currentIndex, shuffle, repeat]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevSong = useMemo<S | null>(() => {
    // History always wins — shows literally the last-played song in all modes
    if (historyTip) return historyTip;
    // Sequential fallback when no history yet
    if (shuffle || playlist.length === 0) return null;
    const i = currentIndex - 1;
    if (i < 0) return repeat === 'all' ? playlist[playlist.length - 1] : null;
    return playlist[i];
  }, [historyTip, playlist, currentIndex, shuffle, repeat]);

  // Preload next song's audio so browser HTTP cache has it buffered before it plays
  useEffect(() => {
    const audio = preloadRef.current;
    if (!audio) return;
    if (!nextSong) { audio.src = ''; return; }

    const songId = nextSong.id;
    const songUrl = nextSong.url;
    let cancelled = false;

    (async () => {
      let url = songUrl;
      if (offlineCacheService.isCached(songId)) {
        const p = await offlineCacheService.getCachedFilePath(songId);
        if (p) url = /^https?:\/\/|^capacitor:\/\//.test(p)
          ? p
          : `file:///${p.replace(/\\/g, '/')}`;
      } else if (offlineCacheService.getConfig().enabled) {
        const el = preloadRef.current;
        if (el) { el.src = ''; }
        return;
      }
      if (!cancelled) {
        const current = preloadRef.current;
        if (current && current.src !== url) { current.src = url; current.load(); }
      }
    })();

    return () => { cancelled = true; };
  }, [nextSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety-net: if next song wasn't known when the current track started (e.g.
  // shuffle pick or queue insertion), trigger preload 15 s before the end.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !nextSong) return;
    const id = nextSong.id;
    const url = nextSong.url;
    const handler = () => {
      if (!audio.duration || audio.duration === Infinity) return;
      const remaining = audio.duration - audio.currentTime;
      if (remaining < 15 && remaining > 0) {
        const preload = preloadRef.current;
        if (preload && !preload.src) {
          (async () => {
            let src = url;
            if (offlineCacheService.isCached(id)) {
              const p = await offlineCacheService.getCachedFilePath(id);
              if (p) src = /^https?:\/\/|^capacitor:\/\//.test(p) ? p : `file:///${p.replace(/\\/g, '/')}`;
            } else if (offlineCacheService.getConfig().enabled) {
              return;
            }
            const el = preloadRef.current;
            if (el && !el.src) { el.src = src; el.load(); }
          })();
        }
      }
    };
    audio.addEventListener('timeupdate', handler);
    return () => audio.removeEventListener('timeupdate', handler);
  }, [nextSong]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch cover art for neighbors + lookahead window (up to 5 songs ahead)
  useEffect(() => {
    if (offlineModeEnabledRef.current) return;
    const { username, password, serverUrl } = getFromStorage();
    if (!username || !password || !serverUrl) return;

    const toPreload: (S | null)[] = [nextSong, prevSong];

    // Add upcoming songs from the sequential queue
    // (depth per tier: gaming=8, balanced=4, eco=0)
    const maxAhead = PREFETCH_AHEAD[getPerfMode()];
    if (!shuffle && playlist.length > 0) {
      for (let offset = 2; offset <= maxAhead; offset++) {
        const i = currentIndex + offset;
        if (i < playlist.length) toPreload.push(playlist[i]);
      }
    }

    for (const song of toPreload) {
      if (song?.coverArt) {
        imageCacheService.getImage(
          song.coverArt,
          () => getCoverArtUrl(serverUrl, username, password, song.coverArt!, 512),
        );
      }
    }
  }, [nextSong?.id, prevSong?.id, currentIndex, shuffle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload next song's artwork into the native notification layer so it appears instantly
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge.isCapacitor || !nextSong?.coverArt) return;
    if (getPerfMode() === 'eco') return;
    const { username, password, serverUrl } = getFromStorage();
    let cancelled = false;
    (async () => {
      let artworkUrl: string | null = null;
      if (offlineCacheService.isCoverArtCached(nextSong.coverArt!)) {
        const rel = offlineCacheService.getCachedCoverArtPath(nextSong.coverArt!);
        if (rel) artworkUrl = await getBridge().readCachedImage(rel);
      }
      if (!artworkUrl && username && password && serverUrl && !offlineCacheService.getConfig().enabled) {
        artworkUrl = getCoverArtUrl(serverUrl, username, password, nextSong.coverArt!, 512);
      }
      if (!cancelled && artworkUrl) bridge.preloadNextArtwork(artworkUrl);
    })();
    return () => { cancelled = true; };
  }, [nextSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { nextSong, prevSong };
}
