import React, { useEffect, useState } from 'react';
import { precacheStateService } from '../../services/precacheStateService';
import './CachePreloadDialog.css';

interface CachePreloadDialogProps {
  onComplete: () => void;
  onSkip: () => void;
}

export const CachePreloadDialog: React.FC<CachePreloadDialogProps> = ({ onComplete, onSkip }) => {
  const [artistsCached, setArtistsCached] = useState(0);
  const [totalArtists, setTotalArtists] = useState(0);
  const [albumsCached, setAlbumsCached] = useState(0);
  const [totalAlbums, setTotalAlbums] = useState(0);
  const [searchIndexComplete, setSearchIndexComplete] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<'artists' | 'albums' | 'search' | 'complete'>('artists');
  const [searchProgress, setSearchProgress] = useState('Waiting...');

  const handleSkip = () => {
    precacheStateService.completePrecaching();
    onSkip();
  };

  useEffect(() => {
    const startCaching = async () => {
      console.log('[CachePreloadDialog] Starting pre-cache process');
      
      // Block individual image requests during bulk pre-cache
      precacheStateService.startPrecaching();
      
      // Store data for search index building
      let allArtistsData: any[] = [];
      let allAlbumsData: any[] = [];
      
      // Use browser-friendly batch size to respect connection limits (browsers cap at 6-8 connections/domain)
      const SAFE_BATCH_SIZE = 6; // Respects browser connection pool limit
      const RETRY_ATTEMPTS = 3; // Retry failed requests
      const BATCH_DELAY_MS = 100; // Small delay between batches to prevent server overwhelm
      
      console.log(`Using safe batch size: ${SAFE_BATCH_SIZE} (respects browser connection limits)`);

      // Helper function for retry logic (available to all phases)
      const fetchWithRetry = async (fn: () => Promise<any>, retries = RETRY_ATTEMPTS): Promise<any> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            if (attempt === retries) {
              throw error; // Failed all retries
            }
            // Exponential backoff: 500ms, 1s, 2s
            const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };
      
      // Phase 1: Pre-cache artist images
      setCurrentPhase('artists');
      try {
        const { getArtists, getArtist } = await import('../../services/subsonicApi');
        const { imageCacheService } = await import('../../services/imageCacheService');
        
        const serverUrl = localStorage.getItem('serverUrl');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');

        if (!serverUrl || !username || !password) {
          console.warn('Missing credentials for pre-caching');
          precacheStateService.completePrecaching();
          onSkip();
          return;
        }

        // CRITICAL: Initialize the image cache service first
        console.log('🔧 Initializing image cache service...');
        try {
          await imageCacheService.initialize(username, serverUrl);
          console.log('Image cache service initialized');
        } catch (initError) {
          console.error('Failed to initialize image cache:', initError);
          // Skip image caching if initialization fails
          setCurrentPhase('complete');
          await new Promise(resolve => setTimeout(resolve, 500));
          precacheStateService.completePrecaching();
          onComplete();
          return;
        }

        // Clear old cache before rebuilding (removes deleted content, ensures clean state)
        console.log('Clearing old image cache...');
        try {
          await imageCacheService.clearCache();
          console.log('Old cache cleared - starting fresh rebuild');
        } catch (clearError) {
          console.warn('Failed to clear old cache:', clearError);
          // Continue anyway - will update in-place
        }

        // Clear old search cache
        console.log('Clearing old search cache...');
        try {
          const { searchCacheService } = await import('../../services/searchCacheService');
          await searchCacheService.clearCache();
          console.log('Old search cache cleared');
        } catch (clearError) {
          console.warn('Failed to clear search cache:', clearError);
        }

        // Get all artists
        const response = await getArtists(serverUrl, username, password);
        const subsonicResponse = response.data['subsonic-response'];
        
        if (subsonicResponse?.status === 'ok' && subsonicResponse.artists?.index) {
          const allArtists: any[] = [];
          subsonicResponse.artists.index.forEach((index: any) => {
            if (index.artist) {
              allArtists.push(...index.artist);
            }
          });
          
          // Store for search index building
          allArtistsData = allArtists;

          setTotalArtists(allArtists.length);
          console.log(`📸 Pre-caching ${allArtists.length} artist images`);

          // Pre-cache artist images in safe batches
          const imagePhaseStart = performance.now();
          let successCount = 0;
          let failCount = 0;
          
          for (let i = 0; i < allArtists.length; i += SAFE_BATCH_SIZE) {
            const batchStart = performance.now();
            const batch = allArtists.slice(i, i + SAFE_BATCH_SIZE);
            
            // Use Promise.allSettled to handle individual failures gracefully
            const results = await Promise.allSettled(
              batch.map(async (artist) => {
                if (!artist.coverArt) return null;
                
                return fetchWithRetry(async () => {
                  const { getCoverArtUrl } = await import('../../services/subsonicApi');
                  const coverArtUrl = getCoverArtUrl(serverUrl, username, password, artist.coverArt, 300);
                  
                  // Fetch and cache with timeout
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
                  
                  try {
                    const response = await fetch(coverArtUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                      const blob = await response.blob();
                      // Skip memory cache during bulk preload to prevent blob URL exhaustion (1500+ images)
                      await imageCacheService.cacheImageDirect(artist.coverArt, coverArtUrl, blob, true);
                      return { success: true, artist: artist.name };
                    } else {
                      throw new Error(`HTTP ${response.status}`);
                    }
                  } catch (err) {
                    clearTimeout(timeoutId);
                    throw err;
                  }
                });
              })
            );

            // Count successes/failures
            results.forEach((result, idx) => {
              if (result.status === 'fulfilled' && result.value?.success) {
                successCount++;
              } else if (result.status === 'rejected' || !batch[idx].coverArt) {
                failCount++;
                if (result.status === 'rejected') {
                  console.warn(`Failed to cache artist ${batch[idx].name}:`, result.reason);
                }
              }
            });

            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            const batchNum = Math.ceil((i + SAFE_BATCH_SIZE) / SAFE_BATCH_SIZE);
            const totalBatches = Math.ceil(allArtists.length / SAFE_BATCH_SIZE);
            console.log(`  [BATCH ${batchNum}/${totalBatches}] ${batchTime}s | Success: ${successCount}, Failed: ${failCount}`);
            
            setArtistsCached(Math.min(i + SAFE_BATCH_SIZE, allArtists.length));
            
            // Small delay between batches to prevent server overwhelm
            if (i + SAFE_BATCH_SIZE < allArtists.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }

          const imagePhaseTime = ((performance.now() - imagePhaseStart) / 1000).toFixed(1);
          console.log(`✅ Artist images: ${successCount} cached, ${failCount} failed (${imagePhaseTime}s total)`);

          // Phase 2: Pre-cache ALL album images
          setCurrentPhase('albums');
          const albumPhaseStart = performance.now();
          console.log(`Now fetching albums for all ${allArtists.length} artists...`);

          const allAlbums: any[] = [];
          
          // Fetch albums for each artist (safe batches with retry)
          const albumFetchStart = performance.now();
          let artistFetchSuccess = 0;
          let artistFetchFail = 0;
          
          for (let i = 0; i < allArtists.length; i += SAFE_BATCH_SIZE) {
            const batchStart = performance.now();
            const artistBatch = allArtists.slice(i, i + SAFE_BATCH_SIZE);
            
            const albumResults = await Promise.allSettled(
              artistBatch.map(async (artist) => 
                fetchWithRetry(async () => {
                  const artistResponse = await getArtist(serverUrl, username, password, artist.id);
                  const artistData = artistResponse.data['subsonic-response'];
                  if (artistData?.status === 'ok' && artistData.artist?.album) {
                    return artistData.artist.album;
                  }
                  return [];
                })
              )
            );

            // Flatten results and count successes/failures
            albumResults.forEach((result, idx) => {
              if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                allAlbums.push(...result.value);
                artistFetchSuccess++;
              } else {
                artistFetchFail++;
                if (result.status === 'rejected') {
                  console.warn(`Failed to fetch albums for ${artistBatch[idx].name}:`, result.reason);
                }
              }
            });
            
            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            const batchNum = Math.ceil((i + SAFE_BATCH_SIZE) / SAFE_BATCH_SIZE);
            const totalBatches = Math.ceil(allArtists.length / SAFE_BATCH_SIZE);
            console.log(`  [BATCH ${batchNum}/${totalBatches}] ${batchTime}s | Artists: ${artistFetchSuccess}/${allArtists.length}, Albums: ${allAlbums.length}`);
            
            // Small delay between batches
            if (i + SAFE_BATCH_SIZE < allArtists.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }
          
          const albumFetchTime = ((performance.now() - albumFetchStart) / 1000).toFixed(1);
          console.log(`✅ Fetched ${allAlbums.length} albums in ${albumFetchTime}s (${artistFetchSuccess} artists, ${artistFetchFail} failed)`);
          
          // Store for search index building
          allAlbumsData = allAlbums;

          setTotalAlbums(allAlbums.length);
          console.log(`Pre-caching ${allAlbums.length} album cover arts`);

          // Pre-cache album images in safe batches with retry
          const albumCacheStart = performance.now();
          let albumSuccessCount = 0;
          let albumFailCount = 0;
          
          for (let i = 0; i < allAlbums.length; i += SAFE_BATCH_SIZE) {
            const batchStart = performance.now();
            const batch = allAlbums.slice(i, i + SAFE_BATCH_SIZE);
            
            const results = await Promise.allSettled(
              batch.map(async (album) => {
                if (!album.coverArt) return null;
                
                return fetchWithRetry(async () => {
                  const { getCoverArtUrl } = await import('../../services/subsonicApi');
                  const coverArtUrl = getCoverArtUrl(serverUrl, username, password, album.coverArt, 300);
                  
                  // Fetch with timeout
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 10000);
                  
                  try {
                    const response = await fetch(coverArtUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                      const blob = await response.blob();
                      // Skip memory cache during bulk preload to prevent blob URL exhaustion (1500+ images)
                      await imageCacheService.cacheImageDirect(album.coverArt, coverArtUrl, blob, true);
                      return { success: true, album: album.name };
                    } else {
                      throw new Error(`HTTP ${response.status}`);
                    }
                  } catch (err) {
                    clearTimeout(timeoutId);
                    throw err;
                  }
                });
              })
            );

            // Count successes/failures
            results.forEach((result, idx) => {
              if (result.status === 'fulfilled' && result.value?.success) {
                albumSuccessCount++;
              } else if (result.status === 'rejected' || !batch[idx].coverArt) {
                albumFailCount++;
                if (result.status === 'rejected') {
                  console.warn(`Failed to cache album ${batch[idx].name}:`, result.reason);
                }
              }
            });

            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            const batchNum = Math.ceil((i + SAFE_BATCH_SIZE) / SAFE_BATCH_SIZE);
            const totalBatches = Math.ceil(allAlbums.length / SAFE_BATCH_SIZE);
            console.log(`  [BATCH ${batchNum}/${totalBatches}] ${batchTime}s | Success: ${albumSuccessCount}, Failed: ${albumFailCount}`);
            
            setAlbumsCached(Math.min(i + SAFE_BATCH_SIZE, allAlbums.length));
            
            // Small delay between batches
            if (i + SAFE_BATCH_SIZE < allAlbums.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }

          const albumCacheTime = ((performance.now() - albumCacheStart) / 1000).toFixed(1);
          const albumPhaseTime = ((performance.now() - albumPhaseStart) / 1000).toFixed(1);
          console.log(`✅ Album covers: ${albumSuccessCount} cached, ${albumFailCount} failed`);
          console.log(`ALBUM TIMING: Fetch=${albumFetchTime}s, Cache=${albumCacheTime}s, Total=${albumPhaseTime}s`);
        }
      } catch (error) {
        console.error('Error pre-caching images:', error);
      }

      // Phase 3: Build search index (LAST - CPU intensive)
      setCurrentPhase('search');
      try {
        console.log('%c🔍 PHASE 3: Building search index...', 'background: blue; color: white; font-size: 14px; font-weight: bold');
        setSearchProgress('Building search index...');
        
        const { searchCacheService } = await import('../../services/searchCacheService');
        const { getAlbum } = await import('../../services/subsonicApi');
        
        const serverUrl = localStorage.getItem('serverUrl');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');

        if (!serverUrl || !username || !password) {
          console.warn('Missing credentials for search indexing');
          setSearchIndexComplete(true);
        } else {
          // Initialize search cache service
          await searchCacheService.initialize(username, serverUrl);
          
          // Fetch songs from all albums
          console.log(`📚 Fetching songs from ${allAlbumsData.length} albums...`);
          setSearchProgress(`Fetching songs from ${allAlbumsData.length} albums...`);
          
          const allSongs: any[] = [];
          let processedAlbums = 0;
          let songFetchSuccess = 0;
          let songFetchFail = 0;
          
          const songFetchStart = performance.now();
          
          for (let i = 0; i < allAlbumsData.length; i += SAFE_BATCH_SIZE) {
            const batchStart = performance.now();
            const albumBatch = allAlbumsData.slice(i, i + SAFE_BATCH_SIZE);
            
            const songResults = await Promise.allSettled(
              albumBatch.map(async (album) =>
                fetchWithRetry(async () => {
                  const response = await getAlbum(serverUrl, username, password, album.id);
                  const albumData = response.data['subsonic-response'];
                  
                  if (albumData?.status === 'ok' && albumData.album?.song) {
                    return albumData.album.song;
                  }
                  return [];
                })
              )
            );
            
            // Flatten and collect songs, count successes/failures
            songResults.forEach((result, idx) => {
              if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                allSongs.push(...result.value);
                songFetchSuccess++;
              } else {
                songFetchFail++;
                if (result.status === 'rejected') {
                  console.warn(`Failed to fetch songs for album ${albumBatch[idx].name}:`, result.reason);
                }
              }
            });
            
            processedAlbums += albumBatch.length;
            const progress = Math.round((processedAlbums / allAlbumsData.length) * 100);
            const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
            
            setSearchProgress(`Fetching songs: ${processedAlbums}/${allAlbumsData.length} albums (${progress}%)`);
            console.log(`  [BATCH] ${processedAlbums}/${allAlbumsData.length} (${progress}%) - ${allSongs.length} songs - ${batchTime}s/batch`);
            
            // Small delay between batches
            if (i + SAFE_BATCH_SIZE < allAlbumsData.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }
          
          const songFetchTime = ((performance.now() - songFetchStart) / 1000).toFixed(1);
          console.log(`✅ Fetched ${allSongs.length} songs in ${songFetchTime}s (${songFetchSuccess} albums, ${songFetchFail} failed)`);
          
          // Build and save the search index
          setSearchProgress('Saving search index to cache...');
          console.log(`💾 Saving search index: ${allArtistsData.length} artists, ${allAlbumsData.length} albums, ${allSongs.length} songs`);
          
          await searchCacheService.updateSearchIndex(allArtistsData, allAlbumsData, allSongs);
          
          console.log('%c✅ Search index build COMPLETE!', 'background: green; color: white; font-size: 14px; font-weight: bold');
          setSearchProgress('Search index ready!');
          setSearchIndexComplete(true);
        }
        
      } catch (error) {
        console.error('Error building search index:', error);
        setSearchIndexComplete(true); // Continue anyway
      }

      // Phase 4: Complete (blob URLs created on-demand during browsing)
      setCurrentPhase('complete');
      await new Promise(resolve => setTimeout(resolve, 500));
      precacheStateService.completePrecaching();
      onComplete();
    };

    startCaching();
  }, [onComplete, onSkip]);

  const artistsProgress = totalArtists > 0 ? Math.round((artistsCached / totalArtists) * 100) : 0;
  const albumsProgress = totalAlbums > 0 ? Math.round((albumsCached / totalAlbums) * 100) : 0;

  return (
    <div className="cache-preload-overlay">
      <div className="cache-preload-dialog">
        <h2>Preparing Your Library</h2>
        <p className="cache-preload-subtitle">
          Setting up comprehensive caching for instant performance...
        </p>

        <div className="cache-preload-phases">
          {/* Artist Image Caching Phase */}
          <div className={`cache-phase ${currentPhase === 'artists' ? 'active' : ['albums', 'search', 'complete'].includes(currentPhase) ? 'complete' : ''}`}>
            <div className="cache-phase-icon">
              {['albums', 'search', 'complete'].includes(currentPhase) ? (
                <i className="fas fa-check-circle"></i>
              ) : currentPhase === 'artists' ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <i className="fas fa-clock"></i>
              )}
            </div>
            <div className="cache-phase-content">
              <h3>Pre-caching Artist Images</h3>
              {totalArtists > 0 && (
                <>
                  <p>{artistsCached} / {totalArtists} artists cached ({artistsProgress}%)</p>
                  <div className="cache-progress-bar">
                    <div 
                      className="cache-progress-fill" 
                      style={{ width: `${artistsProgress}%` }}
                    />
                  </div>
                </>
              )}
              {totalArtists === 0 && <p>Preparing...</p>}
            </div>
          </div>

          {/* Album Image Caching Phase */}
          <div className={`cache-phase ${currentPhase === 'albums' ? 'active' : ['search', 'complete'].includes(currentPhase) ? 'complete' : ''}`}>
            <div className="cache-phase-icon">
              {['search', 'complete'].includes(currentPhase) ? (
                <i className="fas fa-check-circle"></i>
              ) : currentPhase === 'albums' ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <i className="fas fa-clock"></i>
              )}
            </div>
            <div className="cache-phase-content">
              <h3>Pre-caching Album Covers</h3>
              {totalAlbums > 0 && (
                <>
                  <p>{albumsCached} / {totalAlbums} albums cached ({albumsProgress}%)</p>
                  <div className="cache-progress-bar">
                    <div 
                      className="cache-progress-fill" 
                      style={{ width: `${albumsProgress}%` }}
                    />
                  </div>
                </>
              )}
              {totalAlbums === 0 && currentPhase === 'albums' && <p>Fetching album list...</p>}
              {totalAlbums === 0 && currentPhase !== 'albums' && currentPhase !== 'complete' && <p>Waiting...</p>}
            </div>
          </div>

          {/* Search Index Phase */}
          <div className={`cache-phase ${currentPhase === 'search' ? 'active' : currentPhase === 'complete' ? 'complete' : ''}`}>
            <div className="cache-phase-icon">
              {currentPhase === 'complete' ? (
                <i className="fas fa-check-circle"></i>
              ) : currentPhase === 'search' ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <i className="fas fa-clock"></i>
              )}
            </div>
            <div className="cache-phase-content">
              <h3>Building Search Index</h3>
              <p>{searchProgress}</p>
            </div>
          </div>
        </div>

        <div className="cache-preload-actions">
          <button 
            className="cache-skip-button" 
            onClick={handleSkip}
            disabled={currentPhase === 'complete'}
          >
            Skip and Continue
          </button>
          <p className="cache-preload-note">
            {currentPhase === 'complete' 
              ? 'Complete! App will restart in 2 seconds...' 
              : 'Building cache and search index. Images will load on-demand when browsing.'}
          </p>
        </div>
      </div>
    </div>
  );
};
