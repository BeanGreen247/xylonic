import React, { useEffect, useRef, useState } from 'react';
import { getArtists, getArtist, getCoverArtUrl, getAlbum } from '../../services/subsonicApi';
import { imageCacheService } from '../../services/imageCacheService';
import { searchCacheService } from '../../services/searchCacheService';
import { precacheStateService } from '../../services/precacheStateService';
import { networkStatsService } from '../../services/networkStatsService';
import './CachePreloadDialog.css';

interface CachePreloadDialogProps {
  onComplete: () => void;
  onSkip: () => void;
  reason?: 'first-run' | 'library-change';
  changeDetails?: { artists: number; songs: number };
}

const RELOAD_DELAY_S  = 15;
const SAFE_BATCH_SIZE = 12;
const IDB_WRITE_BATCH = 50;
const RING_CIRC       = 175.93; // 2π × r28

// ── Minimal circular ring gauge ────────────────────────────────────────────────
interface GaugeProps {
  pct: number;
  gaugeStatus: 'waiting' | 'active' | 'done';
  label: string;
  elapsed?: string | null;
  loading?: boolean; // true = we're in this phase but haven't received data yet
}

const CacheRingGauge: React.FC<GaugeProps> = ({ pct, gaugeStatus, label, elapsed, loading }) => {
  const offset = gaugeStatus === 'waiting' ? RING_CIRC : RING_CIRC * (1 - pct / 100);
  return (
    <div className={`cpd-gauge cpd-gauge--${gaugeStatus}`}>
      <div className="cpd-ring-wrap">
        <svg viewBox="0 0 72 72" className="cpd-ring-svg" aria-hidden="true">
          <circle cx="36" cy="36" r="28" className="cpd-ring-track" />
          <circle cx="36" cy="36" r="28" className="cpd-ring-fill"
            style={{ strokeDashoffset: offset }} />
        </svg>
        <div className="cpd-ring-center">
          {gaugeStatus === 'done'
            ? <i className="fas fa-check" />
            : gaugeStatus === 'waiting' || loading
              ? <span className="cpd-dash">—</span>
              : `${pct}%`}
        </div>
      </div>
      <div className="cpd-gauge-label">{label}</div>
      {elapsed && <div className="cpd-gauge-elapsed">{elapsed}</div>}
    </div>
  );
};
// ──────────────────────────────────────────────────────────────────────────────

export const CachePreloadDialog: React.FC<CachePreloadDialogProps> = ({ onComplete, onSkip, reason = 'first-run', changeDetails }) => {
  const onCompleteRef = useRef(onComplete);
  const onSkipRef = useRef(onSkip);
  onCompleteRef.current = onComplete;
  onSkipRef.current = onSkip;

  const [artistsCached, setArtistsCached] = useState(0);
  const [totalArtists, setTotalArtists] = useState(0);
  const [albumsCached, setAlbumsCached] = useState(0);
  const [totalAlbums, setTotalAlbums] = useState(0);
  const [searchIndexComplete, setSearchIndexComplete] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<'artists' | 'albums' | 'search' | 'complete'>('artists');
  const [searchProgress, setSearchProgress] = useState('Waiting...');
  const [searchProgressPct, setSearchProgressPct] = useState(0);
  const [reloadCountdown, setReloadCountdown] = useState<number>(RELOAD_DELAY_S);
  const [artistsElapsed, setArtistsElapsed] = useState<string | null>(null);
  const [albumsElapsed, setAlbumsElapsed] = useState<string | null>(null);
  const [searchElapsed, setSearchElapsed] = useState<string | null>(null);

  const handleSkip = () => {
    precacheStateService.completePrecaching();
    onSkipRef.current();
  };

  useEffect(() => {
    let cancelled = false;

    const startCaching = async () => {
      if (cancelled) return;
      console.log('[CachePreloadDialog] Starting pre-cache process');

      precacheStateService.startPrecaching();

      let allArtistsData: any[] = [];
      let allAlbumsData: any[] = [];

      const RETRY_ATTEMPTS = 3;

      const fetchWithRetry = async (fn: () => Promise<any>, retries = RETRY_ATTEMPTS): Promise<any> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            if (attempt === retries) throw error;
            const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };

      const fmtTime = (secs: number): string => {
        if (secs < 60) return `${Math.round(secs)}s`;
        const m = Math.floor(secs / 60);
        const s = Math.round(secs % 60);
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
      };

      if (cancelled) return;
      setCurrentPhase('artists');
      try {
        const serverUrl = localStorage.getItem('serverUrl');
        const username  = localStorage.getItem('username');
        const password  = localStorage.getItem('password');

        if (!serverUrl || !username || !password) {
          console.warn('Missing credentials for pre-caching');
          precacheStateService.completePrecaching();
          onSkipRef.current();
          return;
        }

        try {
          await imageCacheService.initialize(username, serverUrl);
        } catch (initError) {
          console.error('Failed to initialize image cache:', initError);
          setCurrentPhase('complete');
          await new Promise(resolve => setTimeout(resolve, 500));
          precacheStateService.completePrecaching();
          onCompleteRef.current();
          return;
        }

        try { await imageCacheService.clearCache(); } catch { /* continue anyway */ }
        try { await searchCacheService.clearCache(); } catch { /* continue anyway */ }

        const response = await getArtists(serverUrl, username, password);
        const subsonicResponse = response.data['subsonic-response'];

        if (subsonicResponse?.status === 'ok' && subsonicResponse.artists?.index) {
          const allArtists: any[] = [];
          subsonicResponse.artists.index.forEach((index: any) => {
            if (index.artist) allArtists.push(...index.artist);
          });
          allArtistsData = allArtists;
          setTotalArtists(allArtists.length);

          // ── Pipeline: album metadata fetch runs while artist images cache ──
          const fetchAllAlbumMeta = async (): Promise<any[]> => {
            const allAlbums: any[] = [];
            for (let i = 0; i < allArtists.length; i += SAFE_BATCH_SIZE) {
              if (cancelled) break;
              const artistBatch = allArtists.slice(i, i + SAFE_BATCH_SIZE);
              const results = await Promise.allSettled(
                artistBatch.map(async (artist) =>
                  fetchWithRetry(async () => {
                    const artistResponse = await getArtist(serverUrl, username, password, artist.id);
                    const artistData = artistResponse.data['subsonic-response'];
                    if (artistData?.status === 'ok' && artistData.artist?.album) return artistData.artist.album;
                    return [];
                  })
                )
              );
              results.forEach(r => { if (r.status === 'fulfilled' && Array.isArray(r.value)) allAlbums.push(...r.value); });
            }
            const seen = new Set<string>();
            return allAlbums.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
          };

          // ── Pipeline: song metadata fetch runs while album images cache ──
          const fetchAllSongMeta = async (albums: any[]): Promise<any[]> => {
            const allSongs: any[] = [];
            for (let i = 0; i < albums.length; i += SAFE_BATCH_SIZE) {
              if (cancelled) break;
              const albumBatch = albums.slice(i, i + SAFE_BATCH_SIZE);
              const results = await Promise.allSettled(
                albumBatch.map(async (album) =>
                  fetchWithRetry(async () => {
                    const songResponse = await getAlbum(serverUrl, username, password, album.id);
                    const albumData = songResponse.data['subsonic-response'];
                    if (albumData?.status === 'ok' && albumData.album?.song) return albumData.album.song;
                    return [];
                  })
                )
              );
              results.forEach(r => { if (r.status === 'fulfilled' && Array.isArray(r.value)) allSongs.push(...r.value); });
            }
            return allSongs;
          };

          // Start album metadata fetch immediately — runs in background during Phase 1
          const albumMetaPromise = fetchAllAlbumMeta();

          const imagePhaseStart = performance.now();
          let successCount = 0;
          let failCount = 0;
          let lastArtistPct = -1;
          const idbArtistBuffer: Array<{ coverArtId: string; url: string; blob: Blob }> = [];

          for (let i = 0; i < allArtists.length; i += SAFE_BATCH_SIZE) {
            if (cancelled) break;
            const isLastBatch = i + SAFE_BATCH_SIZE >= allArtists.length;
            const batchStart = performance.now();
            const batch = allArtists.slice(i, i + SAFE_BATCH_SIZE);

            const results = await Promise.allSettled(
              batch.map(async (artist) => {
                if (!artist.coverArt) return null;
                return fetchWithRetry(async () => {
                  const coverArtUrl = getCoverArtUrl(serverUrl, username, password, artist.coverArt, 300);
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 10000);
                  try {
                    const fetchResponse = await fetch(coverArtUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (fetchResponse.ok) {
                      const blob = await fetchResponse.blob();
                      idbArtistBuffer.push({ coverArtId: artist.coverArt, url: coverArtUrl, blob });
                      return { success: true };
                    }
                    throw new Error(`HTTP ${fetchResponse.status}`);
                  } catch (err) { clearTimeout(timeoutId); throw err; }
                });
              })
            );

            results.forEach((result, idx) => {
              if (result.status === 'fulfilled' && result.value?.success) { successCount++; }
              else if (result.status === 'rejected' || !batch[idx].coverArt) { failCount++; }
            });

            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            const batchNum = Math.ceil((i + SAFE_BATCH_SIZE) / SAFE_BATCH_SIZE);
            const totalBatches = Math.ceil(allArtists.length / SAFE_BATCH_SIZE);
            console.log(`  [artists ${batchNum}/${totalBatches}] ${batchTime}s | ok:${successCount} fail:${failCount}`);

            const newCount = Math.min(i + SAFE_BATCH_SIZE, allArtists.length);
            const newPct = isLastBatch ? 100 : Math.min(99, Math.round((newCount / allArtists.length) * 100));
            if (newPct > lastArtistPct) {
              lastArtistPct = newPct;
              setArtistsCached(newCount);
              if (isLastBatch) setArtistsElapsed(fmtTime((performance.now() - imagePhaseStart) / 1000));
            }

            if (idbArtistBuffer.length >= IDB_WRITE_BATCH || isLastBatch) {
              if (idbArtistBuffer.length > 0) await imageCacheService.cacheImagesBatch(idbArtistBuffer.splice(0));
            }
          }
          console.log(`✅ Artist images: ${successCount} cached, ${failCount} failed (${((performance.now() - imagePhaseStart) / 1000).toFixed(1)}s)`);

          // Phase 2: Album covers — album metadata already fetched in background
          if (cancelled) return;
          setCurrentPhase('albums');
          const albumPhaseStart = performance.now();
          allAlbumsData = await albumMetaPromise;

          const seenCoverArtIds = new Set<string>();
          const albumsToCache = allAlbumsData.filter(a => {
            if (!a.coverArt || seenCoverArtIds.has(a.coverArt)) return false;
            seenCoverArtIds.add(a.coverArt);
            return true;
          });

          setTotalAlbums(albumsToCache.length);

          // Start song metadata fetch immediately — runs in background during Phase 2
          const songMetaPromise = fetchAllSongMeta(allAlbumsData);

          let albumSuccessCount = 0;
          let albumFailCount = 0;
          let lastAlbumPct = -1;
          const idbAlbumBuffer: Array<{ coverArtId: string; url: string; blob: Blob }> = [];

          for (let i = 0; i < albumsToCache.length; i += SAFE_BATCH_SIZE) {
            if (cancelled) break;
            const isLastBatch = i + SAFE_BATCH_SIZE >= albumsToCache.length;
            const batchStart = performance.now();
            const batch = albumsToCache.slice(i, i + SAFE_BATCH_SIZE);

            const results = await Promise.allSettled(
              batch.map(async (album) =>
                fetchWithRetry(async () => {
                  const coverArtUrl = getCoverArtUrl(serverUrl, username, password, album.coverArt, 300);
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 10000);
                  try {
                    const fetchResponse = await fetch(coverArtUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (fetchResponse.ok) {
                      const blob = await fetchResponse.blob();
                      idbAlbumBuffer.push({ coverArtId: album.coverArt, url: coverArtUrl, blob });
                      return { success: true };
                    }
                    throw new Error(`HTTP ${fetchResponse.status}`);
                  } catch (err) { clearTimeout(timeoutId); throw err; }
                })
              )
            );

            results.forEach((result, idx) => {
              if (result.status === 'fulfilled' && result.value?.success) { albumSuccessCount++; }
              else { albumFailCount++; if (result.status === 'rejected') console.warn(`Album fail ${batch[idx].name}:`, result.reason); }
            });

            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            const batchNum = Math.ceil((i + SAFE_BATCH_SIZE) / SAFE_BATCH_SIZE);
            const totalBatches = Math.ceil(albumsToCache.length / SAFE_BATCH_SIZE);
            console.log(`  [albums ${batchNum}/${totalBatches}] ${batchTime}s | ok:${albumSuccessCount} fail:${albumFailCount}`);

            const newCount = Math.min(i + SAFE_BATCH_SIZE, albumsToCache.length);
            const newPct = isLastBatch ? 100 : Math.min(99, Math.round((newCount / albumsToCache.length) * 100));
            if (newPct > lastAlbumPct) {
              lastAlbumPct = newPct;
              setAlbumsCached(newCount);
              if (isLastBatch) setAlbumsElapsed(fmtTime((performance.now() - albumPhaseStart) / 1000));
            }

            if (idbAlbumBuffer.length >= IDB_WRITE_BATCH || isLastBatch) {
              if (idbAlbumBuffer.length > 0) await imageCacheService.cacheImagesBatch(idbAlbumBuffer.splice(0));
            }
          }
          console.log(`✅ Album covers: ${albumSuccessCount} cached, ${albumFailCount} failed (${((performance.now() - albumPhaseStart) / 1000).toFixed(1)}s)`);

          // Phase 3: Search index — song metadata already fetched in background
          if (cancelled) return;
          setCurrentPhase('search');
          const searchPhaseStart = performance.now();

          try {
            setSearchProgress('Finalizing search index...');
            await searchCacheService.initialize(username, serverUrl);

            const allSongs = await songMetaPromise;
            console.log(`📚 ${allSongs.length} songs from ${allAlbumsData.length} albums`);

            setSearchProgress('Saving search index…');
            setSearchProgressPct(50);
            await searchCacheService.updateSearchIndex(allArtistsData, allAlbumsData, allSongs);

            setSearchProgress('Search index ready!');
            setSearchProgressPct(100);
            setSearchIndexComplete(true);
            setSearchElapsed(fmtTime((performance.now() - searchPhaseStart) / 1000));
          } catch (error) {
            console.error('Error building search index:', error);
            setSearchIndexComplete(true);
          }
        }
      } catch (error) {
        console.error('Error pre-caching images:', error);
      }

      if (cancelled) return;
      // Clear preload-inflated API call counts so Settings stats reflect browsing only.
      networkStatsService.reset();
      setCurrentPhase('complete');
      precacheStateService.completePrecaching();
      onCompleteRef.current();
    };

    startCaching();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (currentPhase !== 'complete') return;
    setReloadCountdown(RELOAD_DELAY_S);
    const id = setInterval(() => {
      setReloadCountdown(prev => {
        if (prev <= 1) {
          clearInterval(id);
          if (reason === 'first-run') window.location.reload();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [currentPhase, reason]);

  // ── Gauge state helpers ──────────────────────────────────────────────────────
  const artistsProgress = totalArtists > 0 ? Math.round((artistsCached / totalArtists) * 100) : 0;
  const albumsProgress  = totalAlbums  > 0 ? Math.round((albumsCached  / totalAlbums)  * 100) : 0;

  const artistsDone = ['albums', 'search', 'complete'].includes(currentPhase);
  const albumsDone  = ['search', 'complete'].includes(currentPhase);
  const searchDone  = currentPhase === 'complete';

  const overallProgress = currentPhase === 'complete' ? 100
    : currentPhase === 'artists' ? Math.floor(artistsProgress * 0.33)
    : currentPhase === 'albums'  ? Math.floor(33 + albumsProgress * 0.33)
    : Math.floor(66 + searchProgressPct * 0.34);

  const statusText = currentPhase === 'complete' ? ''
    : currentPhase === 'artists' ? (totalArtists > 0 ? `${artistsCached} / ${totalArtists} artist images` : 'Fetching artist list…')
    : currentPhase === 'albums'  ? (totalAlbums  > 0 ? `${albumsCached} / ${totalAlbums} album covers` : 'Fetching album list…')
    : searchProgress;

  // ── Subtitle for the dialog ──────────────────────────────────────────────────
  const subtitleText = reason === 'library-change'
    ? (() => {
        const parts: string[] = [];
        if (changeDetails?.artists && changeDetails.artists !== 0)
          parts.push(`${changeDetails.artists > 0 ? '+' : ''}${changeDetails.artists} artist${Math.abs(changeDetails.artists) !== 1 ? 's' : ''}`);
        if (changeDetails?.songs && changeDetails.songs !== 0)
          parts.push(`${changeDetails.songs > 0 ? '+' : ''}${changeDetails.songs} song${Math.abs(changeDetails.songs) !== 1 ? 's' : ''}`);
        return parts.length > 0 ? `${parts.join(', ')} detected — rebuilding cache` : 'Library changed — rebuilding cache';
      })()
    : 'Building image cache and search index for instant performance';

  return (
    <div className="cache-preload-overlay">
      <div className="cache-preload-dialog">
        <h2 className="cpd-title">
          {reason === 'library-change' ? 'Updating Library Cache' : 'Building Performance Cache'}
        </h2>
        <p className="cpd-subtitle">{subtitleText}</p>

        <div className="cpd-gauges">
          <CacheRingGauge
            pct={artistsProgress}
            gaugeStatus={artistsDone ? 'done' : currentPhase === 'artists' ? 'active' : 'waiting'}
            label="Artist Images"
            elapsed={artistsElapsed}
            loading={totalArtists === 0 && currentPhase === 'artists'}
          />
          <CacheRingGauge
            pct={albumsProgress}
            gaugeStatus={albumsDone ? 'done' : currentPhase === 'albums' ? 'active' : 'waiting'}
            label="Album Covers"
            elapsed={albumsElapsed}
            loading={totalAlbums === 0 && currentPhase === 'albums'}
          />
          <CacheRingGauge
            pct={searchProgressPct}
            gaugeStatus={searchDone ? 'done' : currentPhase === 'search' ? 'active' : 'waiting'}
            label="Search Index"
            elapsed={searchElapsed}
            loading={searchProgressPct === 0 && currentPhase === 'search'}
          />
          <CacheRingGauge
            pct={overallProgress}
            gaugeStatus={currentPhase === 'complete' ? 'done' : 'active'}
            label="Overall"
          />
        </div>

        {statusText && <p className="cpd-status">{statusText}</p>}

        {currentPhase === 'complete' ? (
          <div className="cache-restart-banner">
            <div className="cache-restart-header">
              <i className="fas fa-check-circle cache-restart-icon" />
              <div className="cache-restart-text">
                <h3 className="cache-restart-title">{reason === 'library-change' ? 'Cache Updated!' : 'Library Ready!'}</h3>
                <p className="cache-restart-subtitle">
                  {reason === 'library-change' ? 'Cache refreshed with the latest library changes' : 'App will restart automatically'}
                </p>
              </div>
            </div>

            <div className="cache-countdown-wrap">
              <svg className="cache-countdown-svg" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" className="cache-countdown-track" />
                <circle cx="50" cy="50" r="42" className="cache-countdown-ring"
                  style={{ animationDuration: `${RELOAD_DELAY_S}s` }} />
              </svg>
              <span className="cache-countdown-number" aria-live="polite" aria-label={`Restarting in ${reloadCountdown} seconds`}>
                {reloadCountdown}
              </span>
            </div>

            <button className="cache-restart-now-btn" onClick={() => window.location.reload()}>
              Restart Now
            </button>
          </div>
        ) : (
          <div className="cache-preload-actions">
            <button className="cache-skip-button" onClick={handleSkip}>
              Skip for Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
