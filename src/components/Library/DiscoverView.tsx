import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getAlbumList2, getAlbum, getStreamUrl, AlbumListType, AlbumSummary } from '../../services/subsonicApi';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { usePlayback } from '../../hooks/usePlayback';
import AlbumArt from '../common/AlbumArt';
import './DiscoverView.css';

interface DiscoverViewProps {
  onAlbumClick: (albumId: string, albumName: string, artistName: string, artistId?: string) => void;
  onArtistClick?: (artistId: string, artistName: string) => void;
}

interface SectionState {
  albums: AlbumSummary[];
  loading: boolean;
  error: string | null;
}

type SectionsMap = Record<AlbumListType, SectionState>;

const SECTIONS: { type: AlbumListType; title: string; icon: string }[] = [
  { type: 'newest',         title: 'Recently Added',  icon: 'fa-calendar-plus' },
  { type: 'recent',         title: 'Recently Played',  icon: 'fa-history'       },
  { type: 'frequent',       title: 'Most Played',      icon: 'fa-fire'          },
  { type: 'random',         title: 'Random Mix',       icon: 'fa-random'        },
];

const SECTION_SIZE   = 20;
const SKELETON_COUNT = 10;
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes

const emptySection = (): SectionState => ({ albums: [], loading: true, error: null });

// Module-level cache — survives navigation, invalidated by TTL or server change.
interface DiscoverCacheEntry { albums: AlbumSummary[]; fetchedAt: number; serverUrl: string; }
const SECTION_CACHE = new Map<AlbumListType, DiscoverCacheEntry>();

// 'random' is intentionally not cached — it should give fresh picks every visit.
const UNCACHED_SECTIONS: AlbumListType[] = ['random'];

function getCachedSection(type: AlbumListType): AlbumSummary[] | null {
  if (UNCACHED_SECTIONS.includes(type)) return null;
  const entry = SECTION_CACHE.get(type);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  if (entry.serverUrl !== (localStorage.getItem('serverUrl') || '')) return null;
  return entry.albums;
}

const SCROLL_BY = 560; // ~3 cards

// ── Horizontal scroll row with arrow buttons ─────────────────────────────────
const HScrollRow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows);
    updateArrows();
    return () => el.removeEventListener('scroll', updateArrows);
  }, [updateArrows]);

  // Re-check arrows after children change (skeleton → real albums)
  useEffect(() => {
    const id = setTimeout(updateArrows, 50);
    return () => clearTimeout(id);
  }, [children, updateArrows]);

  return (
    <div className="discover-scroll-wrapper">
      <button
        className={`discover-scroll-arrow discover-scroll-arrow-left${canScrollLeft ? ' visible' : ''}`}
        onClick={() => scrollRef.current?.scrollBy({ left: -SCROLL_BY, behavior: 'smooth' })}
        aria-label="Scroll left"
        tabIndex={canScrollLeft ? 0 : -1}
      >
        <i className="fas fa-chevron-left" />
      </button>

      <div ref={scrollRef} className="discover-section-scroll">{children}</div>

      <button
        className={`discover-scroll-arrow discover-scroll-arrow-right${canScrollRight ? ' visible' : ''}`}
        onClick={() => scrollRef.current?.scrollBy({ left: SCROLL_BY, behavior: 'smooth' })}
        aria-label="Scroll right"
        tabIndex={canScrollRight ? 0 : -1}
      >
        <i className="fas fa-chevron-right" />
      </button>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────
const DiscoverView: React.FC<DiscoverViewProps> = ({ onAlbumClick, onArtistClick }) => {
  const { offlineModeEnabled } = useOfflineMode();
  const { playPlaylist, bitrate } = usePlayback();

  const [sections, setSections] = useState<SectionsMap>(() =>
    Object.fromEntries(
      SECTIONS.map(s => {
        const cached = getCachedSection(s.type);
        return [s.type, cached
          ? { albums: cached, loading: false, error: null }
          : emptySection()];
      })
    ) as SectionsMap
  );
  const [playingRandom, setPlayingRandom] = useState(false);

  const fetchSection = useCallback(async (type: AlbumListType) => {
    setSections(prev => ({ ...prev, [type]: { ...prev[type], loading: true, error: null } }));
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username  = localStorage.getItem('username')  || '';
      const password  = localStorage.getItem('password')  || '';
      const albums = await getAlbumList2(serverUrl, username, password, type, SECTION_SIZE);
      if (!UNCACHED_SECTIONS.includes(type)) {
        SECTION_CACHE.set(type, { albums, fetchedAt: Date.now(), serverUrl });
      }
      setSections(prev => ({ ...prev, [type]: { albums, loading: false, error: null } }));
    } catch (err) {
      setSections(prev => ({
        ...prev,
        [type]: { albums: [], loading: false, error: (err as Error).message || 'Failed to load' },
      }));
    }
  }, []);

  useEffect(() => {
    if (offlineModeEnabled) return;
    // Load missing sections sequentially so we don't flood the connection pool
    // on first visit. Cached sections are already populated from initial state,
    // so on return navigation this loop exits immediately without any API calls.
    const loadMissing = async () => {
      for (const { type } of SECTIONS) {
        if (!getCachedSection(type)) {
          await fetchSection(type);
        }
      }
    };
    loadMissing();
  }, [offlineModeEnabled, fetchSection]);

  const handlePlayRandomMix = useCallback(async () => {
    const randomAlbums = sections['random'].albums;
    if (!randomAlbums.length || playingRandom) return;

    setPlayingRandom(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username  = localStorage.getItem('username')  || '';
      const password  = localStorage.getItem('password')  || '';

      const results = await Promise.all(
        randomAlbums.map(a => getAlbum(serverUrl, username, password, a.id))
      );

      const songs: { id: string; title: string; artist: string; album: string; url: string; duration?: number; coverArt?: string }[] = [];
      for (const res of results) {
        const albumData = res.data['subsonic-response']?.album;
        for (const s of albumData?.song ?? []) {
          songs.push({
            id:       s.id,
            title:    s.title    || '',
            artist:   s.artist   || albumData?.artist || '',
            album:    s.album    || albumData?.name   || '',
            url:      getStreamUrl(serverUrl, username, password, s.id, bitrate ?? undefined),
            duration: s.duration,
            coverArt: s.coverArt || albumData?.coverArt,
          });
        }
      }

      if (songs.length > 0) playPlaylist(songs);
    } catch (err) {
      console.error('[Discover] Failed to load random mix songs:', err);
    } finally {
      setPlayingRandom(false);
    }
  }, [sections, playingRandom, playPlaylist, bitrate]);

  if (offlineModeEnabled) {
    return (
      <div className="discover-offline">
        <i className="fas fa-ban" />
        <p>Discover requires an online connection</p>
      </div>
    );
  }

  return (
    <div className="discover-view">
      <div className="library-header">
        <h2 className="library-title">
          <i className="fas fa-compass" />
          Discover
        </h2>
      </div>

      {SECTIONS.map(({ type, title, icon }) => {
        const { albums, loading, error } = sections[type];
        const isRandom = type === 'random';

        return (
          <section key={type} className="discover-section">
            <div className="discover-section-header">
              <h3 className="discover-section-title">
                <i className={`fas ${icon}`} />
                {title}
              </h3>

              <div className="discover-section-actions">
                {isRandom && !loading && albums.length > 0 && (
                  <button
                    className="discover-play-btn"
                    onClick={handlePlayRandomMix}
                    disabled={playingRandom}
                    title="Play all Random Mix albums"
                  >
                    {playingRandom
                      ? <><i className="fas fa-spinner fa-spin" /> Loading…</>
                      : <><i className="fas fa-play" /> Play All</>
                    }
                  </button>
                )}
                <button
                  className="discover-refresh-btn"
                  onClick={() => fetchSection(type)}
                  disabled={loading}
                  title={`Refresh ${title}`}
                >
                  <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} />
                </button>
              </div>
            </div>

            {error ? (
              <div className="discover-section-message">
                <i className="fas fa-exclamation-circle" style={{ color: '#ff3b30' }} />
                <span>{error}</span>
              </div>
            ) : (
              <HScrollRow>
                {loading ? (
                  Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                    <div key={i} className="album-card discover-skeleton-card" aria-hidden="true">
                      <div className="album-cover discover-cover-skeleton" />
                      <div className="discover-text-skeleton" />
                      <div className="discover-text-skeleton discover-text-skeleton-short" />
                    </div>
                  ))
                ) : albums.length === 0 ? (
                  <div className="discover-section-message">
                    <i className="fas fa-compact-disc" />
                    <span>No albums found</span>
                  </div>
                ) : (
                  albums.map(album => (
                    <div
                      key={album.id}
                      className="album-card"
                      onClick={() => onAlbumClick(album.id, album.name, album.artist, album.artistId)}
                    >
                      <div className="album-cover">
                        <AlbumArt
                          coverArtId={album.coverArt}
                          albumId={album.id}
                          alt={album.name}
                          size={300}
                          artist={album.artist}
                          album={album.name}
                        />
                      </div>
                      <div className="album-name" title={album.name}>{album.name}</div>
                      <div
                        className={`album-artist${onArtistClick && album.artistId ? ' discover-artist-link' : ''}`}
                        title={album.artist}
                        onClick={e => {
                          if (onArtistClick && album.artistId) {
                            e.stopPropagation();
                            onArtistClick(album.artistId, album.artist);
                          }
                        }}
                      >
                        {album.year ? `${album.year} · ` : ''}{album.artist}
                      </div>
                    </div>
                  ))
                )}
              </HScrollRow>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default DiscoverView;
