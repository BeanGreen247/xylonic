import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { SearchResult3, Artist, Album, SearchResultSong } from '../types/subsonic';
import { search, getArtists, getArtist, getAlbum } from '../services/subsonicApi';
import { searchCacheService } from '../services/searchCacheService';
import { imageCacheService } from '../services/imageCacheService';
import { logger } from '../utils/logger';

interface SearchContextType {
  isSearching: boolean;
  isLoading: boolean;
  inputValue: string;
  searchQuery: string;
  searchResults: SearchResult3 | null;
  navigatedFromSearch: boolean;
  isIndexing: boolean;
  cacheInitialized: boolean;
  handleInputChange: (value: string) => void;
  activateSearch: () => void;
  clearSearchInput: () => void;
  setSearching: (searching: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult3 | null) => void;
  setNavigatedFromSearch: (value: boolean) => void;
  clearSearch: () => void;
  returnToSearch: () => void;
  setOnClearCallback: (callback: (() => void) | null) => void;
  searchCached: (query: string) => Promise<SearchResult3 | null>;
  buildSearchIndex: () => Promise<void>;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSearching, setSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult3 | null>(null);
  const [navigatedFromSearch, setNavigatedFromSearch] = useState(false);
  const [onClearCallback, setOnClearCallback] = useState<(() => void) | null>(null);
  const [cacheInitialized, setCacheInitialized] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setIsLoading(true);
    setSearchQuery(query);
    setSearching(true);

    try {
      if (cacheInitialized) {
        const cached = await searchCacheService.search(query);
        if (cached) {
          setSearchResults(cached);
          return;
        }
      }

      const results = await search(query);
      setSearchResults(results);
    } catch (error) {
      logger.error('[SearchContext] Search failed:', error);
      setSearchResults(null);
    } finally {
      setIsLoading(false);
    }
  }, [cacheInitialized]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!value.trim()) {
      setSearchQuery('');
      setSearchResults(null);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(value);
    }, 300);
  }, [executeSearch]);

  const activateSearch = useCallback(() => {
    setSearching(true);
  }, []);

  const clearSearchInput = useCallback(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setInputValue('');
    setSearchQuery('');
    setSearchResults(null);
  }, []);

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

      const artistsMap = new Map<string, Artist>();
      const albumsMap = new Map<string, Album>();
      const songsMap = new Map<string, SearchResultSong>();

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
      const cpuThreads = navigator.hardwareConcurrency || 4;
      const artistBatchSize = Math.max(50, cpuThreads * 15);

      for (let i = 0; i < allArtists.length; i += artistBatchSize) {
        const artistBatch = allArtists.slice(i, i + artistBatchSize);
        await Promise.all(
          artistBatch.map(async (artist) => {
            try {
              const response = await getArtist(serverUrl, username, password, artist.id);
              const artistData = response.data['subsonic-response'];
              if (artistData?.status === 'ok' && artistData.artist?.album) {
                artistData.artist.album.forEach((album: Album) => {
                  if (!albumsMap.has(album.id)) albumsMap.set(album.id, album);
                });
              }
            } catch (err) {
              console.warn(`Failed to fetch albums for ${artist.name}:`, err);
            }
          })
        );
      }

      const allAlbums = Array.from(albumsMap.values());
      const albumBatchSize = Math.max(100, cpuThreads * 30);

      for (let i = 0; i < allAlbums.length; i += albumBatchSize) {
        const albumBatch = allAlbums.slice(i, i + albumBatchSize);
        await Promise.all(
          albumBatch.map(async (album) => {
            try {
              const response = await getAlbum(serverUrl, username, password, album.id);
              const albumData = response.data['subsonic-response'];
              if (albumData?.status === 'ok' && albumData.album?.song) {
                albumData.album.song.forEach((song: any) => {
                  if (!songsMap.has(song.id)) {
                    songsMap.set(song.id, {
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
                      genre: song.genre,
                    });
                  }
                });
              }
            } catch (err) {
              console.warn(`Failed to fetch songs for album ${album.name}:`, err);
            }
          })
        );
      }

      const albums = Array.from(albumsMap.values());
      const songs  = Array.from(songsMap.values());

      await searchCacheService.updateSearchIndex(
        Array.from(artistsMap.values()),
        albums,
        songs,
      );

      // Rebuild alias map so song-level coverArt IDs (e.g. Navidrome mf-*) resolve
      // to pre-cached album blob URLs for the rest of this session.
      imageCacheService.buildAliasMap(albums, songs);

      console.log(`%cINDEX COMPLETE: ${artistsMap.size} artists, ${albumsMap.size} albums, ${songsMap.size} songs`, 'background: green; color: white; font-size: 14px; font-weight: bold; padding: 4px');
    } catch (error) {
      console.error('%cERROR: Failed to build search index:', 'background: red; color: white', error);
    } finally {
      setIsIndexing(false);
    }
  }, []);

  useEffect(() => {
    const initCache = async () => {
      const username = localStorage.getItem('username');
      const serverUrl = localStorage.getItem('serverUrl');

      if (username && serverUrl) {
        try {
          await searchCacheService.initialize(username, serverUrl);
          setCacheInitialized(true);
          logger.log('[SearchContext] Search cache initialized');

          if (searchCacheService.needsRefresh()) {
            logger.log('[SearchContext] Index missing or stale - starting background rebuild...');
            buildSearchIndex();
          } else {
            logger.log('[SearchContext] Using existing valid search index');
          }
        } catch (error) {
          logger.error('[SearchContext] ERROR: Failed to initialize search cache:', error);
        }
      }
    };

    initCache();
  }, [buildSearchIndex]);

  const searchCached = useCallback((query: string): Promise<SearchResult3 | null> => {
    if (!cacheInitialized) return Promise.resolve(null);
    return searchCacheService.search(query);
  }, [cacheInitialized]);

  const clearSearch = () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setSearching(false);
    setInputValue('');
    setSearchQuery('');
    setSearchResults(null);
    setNavigatedFromSearch(false);
    if (onClearCallback) onClearCallback();
  };

  const returnToSearch = () => {
    setSearching(true);
    setNavigatedFromSearch(false);
  };

  return (
    <SearchContext.Provider
      value={{
        isSearching,
        isLoading,
        inputValue,
        searchQuery,
        searchResults,
        navigatedFromSearch,
        isIndexing,
        cacheInitialized,
        handleInputChange,
        activateSearch,
        clearSearchInput,
        setSearching,
        setSearchQuery,
        setSearchResults,
        setNavigatedFromSearch,
        clearSearch,
        returnToSearch,
        setOnClearCallback,
        searchCached,
        buildSearchIndex,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) throw new Error('useSearch must be used within SearchProvider');
  return context;
};

export default useSearch;
