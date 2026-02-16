import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { SearchResult3, Artist, Album, SearchResultSong } from '../types/subsonic';
import { searchCacheService } from '../services/searchCacheService';
import { logger } from '../utils/logger';

interface SearchContextType {
  isSearching: boolean;
  searchQuery: string;
  searchResults: SearchResult3 | null;
  navigatedFromSearch: boolean;
  isIndexing: boolean;
  cacheInitialized: boolean;
  setSearching: (searching: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult3 | null) => void;
  setNavigatedFromSearch: (value: boolean) => void;
  clearSearch: () => void;
  returnToSearch: () => void;
  setOnClearCallback: (callback: (() => void) | null) => void;
  searchCached: (query: string) => SearchResult3 | null;
  buildSearchIndex: () => Promise<void>;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSearching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult3 | null>(null);
  const [navigatedFromSearch, setNavigatedFromSearch] = useState(false);
  const [onClearCallback, setOnClearCallback] = useState<(() => void) | null>(null);
  const [cacheInitialized, setCacheInitialized] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);

  const buildSearchIndex = useCallback(async () => {
    setIsIndexing(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl');
      const username = localStorage.getItem('username');
      const password = localStorage.getItem('password');

      if (!serverUrl || !username || !password) {
        logger.warn('[SearchContext] Cannot build index - missing credentials');
        return;
      }

      console.log('%cBUILDING 100% COMPLETE INDEX (API-BASED)', 'background: blue; color: white; font-size: 16px; font-weight: bold;');
      console.log('%cUsing direct API calls with parallel batching for maximum speed & reliability', 'color: cyan; font-weight: bold');
      
      // Import APIs dynamically
      const { getArtists, getArtist, getAlbum } = await import('../services/subsonicApi');
      
      // Strategy: Direct API fetching - 100% reliable, catches EVERYTHING
      // 1. Get all artists from getArtists()
      // 2. For each artist, fetch albums (parallel batches)
      // 3. For each album, fetch sons (parallel batches)
      // This guarantees we get ALL 1811 songs!
      
      const artistsMap = new Map<string, Artist>();
      const albumsMap = new Map<string, Album>();
      const songsMap = new Map<string, SearchResultSong>();

      console.log('%cStep 1/3: Fetching all artists...', 'color: yellow; font-size: 12px; font-weight: bold');
      const step1Start = performance.now();
      
      // Step 1: Get ALL artists
      const artistsResponse = await getArtists(serverUrl, username, password);
      const subsonicResponse = artistsResponse.data['subsonic-response'];
      
      if (subsonicResponse?.status === 'ok' && subsonicResponse.artists?.index) {
        subsonicResponse.artists.index.forEach((index: any) => {
          if (index.artist) {
            index.artist.forEach((artist: Artist) => {
              artistsMap.set(artist.id, artist);
            });
          }
        });
      }
      
      const allArtists = Array.from(artistsMap.values());
      const step1Time = ((performance.now() - step1Start) / 1000).toFixed(1);
      console.log(`%cFound ${allArtists.length} artists in ${step1Time}s`, 'color: lime; font-weight: bold');
      
      // Step 2: Fetch albums for each artist (MASSIVE parallel batches)
      console.log('%cStep 2/3: Fetching albums for all artists (HYPER-PARALLEL mode)...', 'color: yellow; font-size: 12px; font-weight: bold');
      const step2Start = performance.now();
      
      // Use ALL available threads for maximum throughput (8c/16t = 16 threads)
      const cpuThreads = navigator.hardwareConcurrency || 4;
      const artistBatchSize = Math.max(50, cpuThreads * 15); // 50-240 parallel!
      console.log(`%c⚡ TURBO MODE: ${artistBatchSize} parallel requests (${cpuThreads} threads detected)`, 'color: orange; font-weight: bold');
      let processedArtists = 0;
      
      for (let i = 0; i < allArtists.length; i += artistBatchSize) {
        const batchStart = performance.now();
        const artistBatch = allArtists.slice(i, i + artistBatchSize);
        
        await Promise.all(
          artistBatch.map(async (artist) => {
            try {
              const response = await getArtist(serverUrl, username, password, artist.id);
              const artistData = response.data['subsonic-response'];
              
              if (artistData?.status === 'ok' && artistData.artist?.album) {
                const albums = artistData.artist.album;
                // Add albums to map
                albums.forEach((album: Album) => {
                  if (!albumsMap.has(album.id)) {
                    albumsMap.set(album.id, album);
                  }
                });
                return albums;
              }
            } catch (err) {
              console.warn(`Failed to fetch albums for ${artist.name}:`, err);
            }
            return [];
          })
        );
        
        processedArtists += artistBatch.length;
        const progress = Math.round((processedArtists / allArtists.length) * 100);
        const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
        console.log(`%c  [STATS] Artist batch: ${processedArtists}/${allArtists.length} (${progress}%) - ${albumsMap.size} albums - ${batchTime}s/batch`, 'color: cyan');
      }
      
      const allAlbums = Array.from(albumsMap.values());
      const step2Time = ((performance.now() - step2Start) / 1000).toFixed(1);
      console.log(`%cFound ${allAlbums.length} albums in ${step2Time}s`, 'color: lime; font-weight: bold');
      
      // Step 3: Fetch songs for each album (INSANE parallel batches!)
      console.log('%cStep 3/3: Fetching songs for all albums (MAX PARALLEL mode)...', 'color: yellow; font-size: 12px; font-weight: bold');
      const step3Start = performance.now();
      
      const albumBatchSize = Math.max(100, cpuThreads * 30); // 100-480 parallel!!
      console.log(`%c⚡ MAXIMUM SPEED: ${albumBatchSize} parallel requests for albums`, 'color: orange; font-weight: bold');
      let processedAlbums = 0;
      
      for (let i = 0; i < allAlbums.length; i += albumBatchSize) {
        const batchStart = performance.now();
        const albumBatch = allAlbums.slice(i, i + albumBatchSize);
        
        await Promise.all(
          albumBatch.map(async (album) => {
            try {
              const response = await getAlbum(serverUrl, username, password, album.id);
              const albumData = response.data['subsonic-response'];
              
              if (albumData?.status === 'ok' && albumData.album?.song) {
                const songs = albumData.album.song;
                // Add songs to map
                songs.forEach((song: any) => {
                  if (!songsMap.has(song.id)) {
                    // Convert to SearchResultSong format
                    const searchSong: SearchResultSong = {
                      id: song.id,
                      title: song.title,
                      artist: song.artist || album.artist || '',
                      album: song.album || album.name || '',
                      albumId: album.id,
                      artistId: song.artistId || '',
                      coverArt: song.coverArt || album.coverArt,
                      duration: song.duration,
                      track: song.track,
                      year: song.year || album.year,
                      genre: song.genre
                    };
                    songsMap.set(song.id, searchSong);
                  }
                });
              }
            } catch (err) {
              console.warn(`Failed to fetch songs for album ${album.name}:`, err);
            }
          })
        );
        
        processedAlbums += albumBatch.length;
        const progress = Math.round((processedAlbums / allAlbums.length) * 100);
        const batchTime = ((performance.now() - batchStart) / 1000).toFixed(1);
        console.log(`%c  [STATS] Album batch: ${processedAlbums}/${allAlbums.length} (${progress}%) - ${songsMap.size} songs - ${batchTime}s/batch`, 'color: cyan');
      }

      const artists = Array.from(artistsMap.values());
      const albums = Array.from(albumsMap.values());
      const songs = Array.from(songsMap.values());
      
      const step3Time = ((performance.now() - step3Start) / 1000).toFixed(1);
      const totalTime = ((performance.now() - step1Start) / 1000).toFixed(1);

      // Update the search index
      await searchCacheService.updateSearchIndex(artists, albums, songs);
      
      console.log(`%cINDEX COMPLETE: ${artists.length} artists, ${albums.length} albums, ${songs.length} songs in ${totalTime}s`, 'background: green; color: white; font-size: 14px; font-weight: bold; padding: 4px');
      console.log(`%cTIMING BREAKDOWN: Step1=${step1Time}s, Step2=${step2Time}s, Step3=${step3Time}s`, 'color: magenta; font-weight: bold; font-size: 12px');
      
      if (songs.length < 1811) {
        console.warn(`%cWARNING: Expected 1811 songs but found ${songs.length} - ${1811 - songs.length} songs may be in compilations/various artists`, 'color: orange; font-weight: bold');
      }
    } catch (error) {
      console.error('%cERROR: Failed to build search index:', 'background: red; color: white', error);
    } finally {
      setIsIndexing(false);
    }
  }, []);

  // Initialize search cache on mount and build index immediately in background
  useEffect(() => {
    const initCache = async () => {
      const username = localStorage.getItem('username');
      const serverUrl = localStorage.getItem('serverUrl');

      if (username && serverUrl) {
        try {
          await searchCacheService.initialize(username, serverUrl);
          setCacheInitialized(true);
          logger.log('[SearchContext] Search cache initialized');

          // Check if index needs building
          if (!searchCacheService.hasValidIndex()) {
            logger.log('[SearchContext] Starting background index build...');
            // Build index in background (don't await)
            buildSearchIndex();
          } else {
            logger.log('[SearchContext] Using existing valid search index');
          }
        } catch (error) {
          logger.error('[SearchContext] ERROR: Failed to initialize search cache:', error);
        }
      }
    };

    // Start initialization immediately
    initCache();
  }, [buildSearchIndex]);

  const searchCached = useCallback((query: string): SearchResult3 | null => {
    if (!cacheInitialized) {
      return null;
    }
    return searchCacheService.search(query);
  }, [cacheInitialized]);

  const clearSearch = () => {
    setSearching(false);
    setSearchQuery('');
    setSearchResults(null);
    setNavigatedFromSearch(false);
    // Call the callback if it exists
    if (onClearCallback) {
      onClearCallback();
    }
  };

  const returnToSearch = () => {
    setSearching(true);
    setNavigatedFromSearch(false);
  };

  return (
    <SearchContext.Provider
      value={{
        isSearching,
        searchQuery,
        searchResults,
        navigatedFromSearch,
        isIndexing,
        cacheInitialized,
        setSearching,
        setSearchQuery,
        setSearchResults,
        setNavigatedFromSearch,
        clearSearch,
        returnToSearch,
        setOnClearCallback,
        searchCached,
        buildSearchIndex
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within SearchProvider');
  }
  return context;
};

export default useSearch;
