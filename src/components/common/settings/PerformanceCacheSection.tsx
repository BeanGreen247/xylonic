import React from 'react';
import { type PerformanceCacheStats } from '../../../services/imageCacheService';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface PerformanceCacheSectionProps {
  stats: PerformanceCacheStats | null;
  onRefresh: () => void;
}

/** Read-only "Performance Cache" stats section, lifted out of SettingsView (WS-ARCH). */
const PerformanceCacheSection: React.FC<PerformanceCacheSectionProps> = ({ stats: perfCacheStats, onRefresh }) => (
      <section className="settings-section">
        <h3 className="settings-section-title">
          Performance Cache
          <button
            className="settings-section-refresh"
            onClick={onRefresh}
            title="Refresh stats"
            aria-label="Refresh performance cache stats"
          >
            <i className={`fas fa-sync-alt${perfCacheStats === null ? ' fa-spin' : ''}`} />
          </button>
        </h3>
        <div className="settings-card">

          {/* ── Overall summary ── */}
          {perfCacheStats ? (() => {
            const cached   = perfCacheStats.memoryHits + perfCacheStats.idbHits;
            const internet = perfCacheStats.serverFetches + perfCacheStats.internetArtFetches + perfCacheStats.metadataFetches;
            const total    = cached + internet;
            const cachedPct   = total === 0 ? 50 : Math.round((cached   / total) * 100);
            const internetPct = 100 - cachedPct;
            return (
              <div className="perf-overview">
                <div className="perf-overview-numbers">
                  <span className="perf-overview-cached">
                    <i className="fas fa-check-circle" />
                    {cached.toLocaleString()} cached
                  </span>
                  <span className="perf-overview-internet">
                    {internet.toLocaleString()} internet
                    <i className="fas fa-wifi" />
                  </span>
                </div>
                <div className="perf-overview-bar" title={`${cachedPct}% served from cache`}>
                  <div className="perf-overview-bar-cached"   style={{ width: `${cachedPct}%` }} />
                  <div className="perf-overview-bar-internet" style={{ width: `${internetPct}%` }} />
                </div>
                <div className="perf-overview-label">
                  {total === 0
                    ? 'No requests yet this session'
                    : `${cachedPct}% served from cache · ${internetPct}% used the network`}
                </div>
              </div>
            );
          })() : (
            <div className="perf-overview perf-overview-loading">
              <i className="fas fa-spinner fa-spin" /> Loading stats…
            </div>
          )}
          <div className="settings-divider" />

          {/* Image disk cache size */}
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-images" /></span>
            <span className="settings-row-label">
              Image Cache (IndexedDB)
              <span className="settings-row-sub">Cover art blobs persisted across sessions</span>
            </span>
            <span className="settings-row-action perf-cache-stat-group">
              {perfCacheStats ? (
                <>
                  <span className="perf-cache-stat">
                    <span className="perf-cache-stat-value">{perfCacheStats.totalImages.toLocaleString()}</span>
                    <span className="perf-cache-stat-label">images</span>
                  </span>
                  <span className="perf-cache-stat">
                    <span className="perf-cache-stat-value">{fmtBytes(perfCacheStats.cacheSize)}</span>
                    <span className="perf-cache-stat-label">on disk</span>
                  </span>
                </>
              ) : <span className="perf-cache-stat-loading"><i className="fas fa-spinner fa-spin" /></span>}
            </span>
          </div>
          <div className="settings-divider" />

          {/* Search index size */}
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-list-alt" /></span>
            <span className="settings-row-label">
              Search Index (IndexedDB)
              <span className="settings-row-sub">
                {perfCacheStats && perfCacheStats.searchIndexSongs > 0
                  ? `${perfCacheStats.searchIndexArtists.toLocaleString()} artists · ${perfCacheStats.searchIndexAlbums.toLocaleString()} albums · ${perfCacheStats.searchIndexSongs.toLocaleString()} songs`
                  : 'Library metadata for instant search'}
              </span>
            </span>
            <span className="settings-row-action perf-cache-stat-group">
              {perfCacheStats ? (
                perfCacheStats.searchIndexSizeBytes > 0 ? (
                  <span className="perf-cache-stat">
                    <span className="perf-cache-stat-value">{fmtBytes(perfCacheStats.searchIndexSizeBytes)}</span>
                    <span className="perf-cache-stat-label">on disk</span>
                  </span>
                ) : (
                  <span className="perf-cache-stat">
                    <span className="perf-cache-stat-value" style={{ color: 'var(--text-muted)' }}>—</span>
                    <span className="perf-cache-stat-label">not built</span>
                  </span>
                )
              ) : <span className="perf-cache-stat-loading"><i className="fas fa-spinner fa-spin" /></span>}
            </span>
          </div>
          <div className="settings-divider" />

          {/* Images — no network */}
          <div className="settings-row non-interactive">
            <span className="settings-row-icon perf-icon-ok"><i className="fas fa-check-circle" /></span>
            <span className="settings-row-label">
              Images — No Network
              <span className="settings-row-sub">
                {perfCacheStats
                  ? `${perfCacheStats.memoryHits.toLocaleString()} from RAM · ${perfCacheStats.idbHits.toLocaleString()} from disk`
                  : '—'}
              </span>
            </span>
            <span className="settings-row-action perf-cache-stat-group">
              {perfCacheStats && (
                <span className="perf-cache-stat">
                  <span className="perf-cache-stat-value">
                    {(perfCacheStats.memoryHits + perfCacheStats.idbHits).toLocaleString()}
                  </span>
                  <span className="perf-cache-stat-label">served</span>
                </span>
              )}
            </span>
          </div>
          <div className="settings-divider" />

          {/* Images — used internet */}
          <div className="settings-row non-interactive">
            <span className="settings-row-icon perf-icon-warn"><i className="fas fa-wifi" /></span>
            <span className="settings-row-label">
              Images — Internet Used
              <span className="settings-row-sub">
                {perfCacheStats
                  ? `${perfCacheStats.serverFetches.toLocaleString()} from Subsonic server · ${perfCacheStats.internetArtFetches.toLocaleString()} from art service`
                  : '—'}
              </span>
            </span>
            <span className="settings-row-action perf-cache-stat-group">
              {perfCacheStats ? (() => {
                const total = perfCacheStats.memoryHits + perfCacheStats.idbHits
                  + perfCacheStats.serverFetches + perfCacheStats.internetArtFetches;
                const hit = perfCacheStats.memoryHits + perfCacheStats.idbHits;
                const pct = total === 0 ? null : Math.round((hit / total) * 100);
                return (
                  <>
                    <span className="perf-cache-stat">
                      <span className="perf-cache-stat-value">
                        {(perfCacheStats.serverFetches + perfCacheStats.internetArtFetches).toLocaleString()}
                      </span>
                      <span className="perf-cache-stat-label">fetched</span>
                    </span>
                    {pct !== null && (
                      <span className={`settings-badge ${pct >= 80 ? 'on' : pct >= 50 ? '' : 'danger'}`}>
                        {pct}% cached
                      </span>
                    )}
                  </>
                );
              })() : null}
            </span>
          </div>
          <div className="settings-divider" />

          {/* Metadata — always internet */}
          <div className="settings-row non-interactive">
            <span className="settings-row-icon perf-icon-warn"><i className="fas fa-server" /></span>
            <span className="settings-row-label">
              Metadata — Internet Used
              <span className="settings-row-sub">Artist lists, album details, song lists, search — always from server</span>
            </span>
            <span className="settings-row-action perf-cache-stat-group">
              {perfCacheStats && (
                <span className="perf-cache-stat">
                  <span className="perf-cache-stat-value">{perfCacheStats.metadataFetches.toLocaleString()}</span>
                  <span className="perf-cache-stat-label">API calls</span>
                </span>
              )}
            </span>
          </div>

        </div>
      </section>
);

export default PerformanceCacheSection;
