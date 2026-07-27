import axios from 'axios';
import md5 from 'md5';
import { logger } from '../utils/logger';
import { SearchResult3, SubsonicSearchResponse } from '../types/subsonic';
import { offlineCacheService } from './offlineCacheService';
import { networkStatsService } from './networkStatsService';

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'SubsonicMusicApp';

// Check if offline mode is enabled and block network requests
const checkOfflineMode = () => {
    const config = offlineCacheService.getConfig();
    if (config.enabled) {
        throw new Error('Network requests blocked: Offline mode is enabled');
    }
};

// Generate authentication parameters
const generateAuthParams = (username: string, password: string) => {
    const salt = Math.random().toString(36).substring(7);
    const token = md5(password + salt);  // Token = md5(password + salt)
    
    return {
        u: username,
        t: token,    // Different every request
        s: salt,     // Different every request
        v: API_VERSION,
        c: CLIENT_NAME,
        f: 'json'
    };
};

// Build full API URL
const buildApiUrl = (serverUrl: string, endpoint: string, params: Record<string, string>) => {
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    const queryParams = new URLSearchParams(params).toString();
    return `${baseUrl}/rest/${endpoint}?${queryParams}`;
};

// Test connection to Subsonic server
export const testConnection = async (serverUrl: string, username: string, password: string) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'ping.view', authParams);
        
        logger.log('Testing connection to URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        logger.error('Connection test failed:', error);
        throw error;
    }
};

// Get all artists
export const getArtists = async (serverUrl: string, username: string, password: string) => {
    checkOfflineMode();
    networkStatsService.recordMetadataFetch();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getArtists.view', authParams);
        
        logger.log('Fetching artists from URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        logger.error('Failed to fetch artists:', error);
        throw error;
    }
};

// Get artist details
export const getArtist = async (serverUrl: string, username: string, password: string, artistId: string) => {
    checkOfflineMode();
    networkStatsService.recordMetadataFetch();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getArtist.view', { ...authParams, id: artistId });
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        logger.error('Failed to fetch artist:', error);
        throw error;
    }
};

// Get album details
export const getAlbum = async (serverUrl: string, username: string, password: string, albumId: string) => {
    checkOfflineMode();
    networkStatsService.recordMetadataFetch();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getAlbum.view', { ...authParams, id: albumId });
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        logger.error('Failed to fetch album:', error);
        throw error;
    }
};

// Get all songs using search3 pagination — one request per 500 songs instead of
// one request per album. For a 2000-song library: ~4 requests vs ~150+.
export const getAllSongs = async (serverUrl: string, username: string, password: string) => {
    checkOfflineMode();
    const allSongs: any[] = [];
    const PAGE_SIZE = 500;
    let offset = 0;

    while (true) {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'search3.view', {
            ...authParams,
            query: '',
            songCount: PAGE_SIZE.toString(),
            songOffset: offset.toString(),
            albumCount: '0',
            artistCount: '0',
        });

        const response = await axios.get(url);
        const data = response.data['subsonic-response'];

        if (data?.status === 'failed') {
            throw new Error(data.error?.message || 'Failed to fetch songs');
        }

        const page: any[] = data?.searchResult3?.song || [];
        allSongs.push(...page);

        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return allSongs;
};

// Get random songs (better for shuffle functionality)
export const getRandomSongs = async (serverUrl: string, username: string, password: string, size: number = 50) => {
    checkOfflineMode();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getRandomSongs.view', { 
            ...authParams, 
            size: size.toString() 
        });
        
        logger.log('Fetching random songs from URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        logger.error('Failed to fetch random songs:', error);
        throw error;
    }
};

// Get stream URL for a song
export const getStreamUrl = (serverUrl: string, username: string, password: string, songId: string, bitrate?: number) => {
    const authParams = generateAuthParams(username, password);
    const params: Record<string, string> = { ...authParams, id: songId };
    
    if (bitrate) {
        params.maxBitRate = bitrate.toString();
        console.log(`[STREAM URL] Generating stream with maxBitRate=${bitrate} for song ${songId}`);
    } else {
        console.log(`[STREAM URL] Generating stream with NO transcoding (original quality) for song ${songId}`);
    }
    
    const url = buildApiUrl(serverUrl, 'stream.view', params);
    console.log(`[STREAM URL] ${url}`);
    
    return url;
};

// Get cover art URL
export const getCoverArtUrl = (serverUrl: string, username: string, password: string, coverArtId: string, size?: number) => {
    const authParams = generateAuthParams(username, password);
    const params: Record<string, string> = { ...authParams, id: coverArtId };
    
    if (size) {
        params.size = size.toString();
    }
    
    return buildApiUrl(serverUrl, 'getCoverArt.view', params);
};

// Get song count from server
export const getSongCount = async (serverUrl: string, username: string, password: string) => {
    checkOfflineMode();
    try {
        const authParams = generateAuthParams(username, password);
        // Use search with empty query to get count, or getAlbumList2 to count songs
        const url = buildApiUrl(serverUrl, 'getAlbumList2.view', { 
            ...authParams, 
            type: 'alphabeticalByName',
            size: '500' // Get many albums to count their songs
        });
        
        logger.log('Fetching albums to count songs');
        
        const response = await axios.get(url);
        const albums = response.data['subsonic-response']?.albumList2?.album || [];
        
        // Sum up all song counts from albums
        let totalSongs = 0;
        for (const album of albums) {
            totalSongs += album.songCount || 0;
        }
        
        return totalSongs;
    } catch (error) {
        logger.error('Failed to get song count:', error);
        return 0;
    }
};

// Get a typed album list (newest, recentlyPlayed, frequent, starred, random, etc.)
export type AlbumListType = 'newest' | 'recent' | 'frequent' | 'starred' | 'random' | 'alphabeticalByName' | 'alphabeticalByArtist';

export interface AlbumSummary {
    id: string;
    name: string;
    artist: string;
    artistId?: string;
    coverArt?: string;
    songCount?: number;
    year?: number;
    duration?: number;
}

export const getAlbumList2 = async (
    serverUrl: string,
    username: string,
    password: string,
    type: AlbumListType,
    size: number = 20,
    offset: number = 0
): Promise<AlbumSummary[]> => {
    checkOfflineMode();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getAlbumList2.view', {
            ...authParams,
            type,
            size: size.toString(),
            offset: offset.toString(),
        });
        const response = await axios.get(url);
        return response.data['subsonic-response']?.albumList2?.album || [];
    } catch (error) {
        logger.error(`Failed to get album list (${type}):`, error);
        throw error;
    }
};

// Get paginated list of all albums
export const getAllAlbumsPaginated = async (
    serverUrl: string,
    username: string,
    password: string,
    offset: number = 0,
    size: number = 50
): Promise<AlbumSummary[]> => {
    return getAlbumList2(serverUrl, username, password, 'alphabeticalByArtist', size, offset);
};

// Search songs with pagination (empty query = all songs)
export const searchSongsPaginated = async (
    serverUrl: string,
    username: string,
    password: string,
    query: string = '',
    songOffset: number = 0,
    songCount: number = 50
) => {
    checkOfflineMode();
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'search3.view', {
            ...authParams,
            query,
            songOffset: songOffset.toString(),
            songCount: songCount.toString(),
            albumCount: '0',
            artistCount: '0',
        });
        const response = await axios.get(url);
        const songs = response.data['subsonic-response']?.searchResult3?.song || [];
        return songs as Array<{
            id: string;
            title: string;
            artist: string;
            album: string;
            albumId?: string;
            coverArt?: string;
            duration?: number;
            track?: number;
            year?: number;
        }>;
    } catch (error) {
        logger.error('Failed to search songs:', error);
        throw error;
    }
};

// Search function
export const search = async (query: string): Promise<SearchResult3> => {
  checkOfflineMode();
  networkStatsService.recordMetadataFetch();
  try {
    // Debug: Check what's in localStorage
    console.log('All localStorage keys:', Object.keys(localStorage));
    console.log('auth key:', localStorage.getItem('auth'));
    console.log('serverUrl key:', localStorage.getItem('serverUrl'));
    console.log('username key:', localStorage.getItem('username'));
    console.log('password key:', localStorage.getItem('password'));

    // Try multiple storage formats (your app might use different keys)
    let serverUrl, username, password;

    // Format 1: Everything in 'auth' key
    const authData = localStorage.getItem('auth');
    if (authData) {
      const parsed = JSON.parse(authData);
      serverUrl = parsed.serverUrl;
      username = parsed.username;
      password = parsed.password;
    }

    // Format 2: Separate keys (fallback)
    if (!serverUrl || !username || !password) {
      serverUrl = localStorage.getItem('serverUrl');
      username = localStorage.getItem('username');
      password = localStorage.getItem('password');
    }
    
    if (!serverUrl || !username || !password) {
      console.error('Missing credentials. serverUrl:', serverUrl, 'username:', username, 'password:', !!password);
      throw new Error('Missing credentials');
    }

    const salt = Math.random().toString(36).substring(7);
    const token = md5(password + salt);

    const params = new URLSearchParams({
      u: username,
      t: token,
      s: salt,
      v: '1.16.1',
      c: 'SubsonicMusicApp',
      f: 'json',
      query: query,
      artistCount: '20',
      albumCount: '20',
      songCount: '50'
    });

    const response = await axios.get<SubsonicSearchResponse>(
      `${serverUrl}/rest/search3.view?${params}`
    );

    if (response.data['subsonic-response']?.status === 'ok') {
      return response.data['subsonic-response'].searchResult3 || {};
    }

    throw new Error('Search failed');
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
};

// Get starred/favorited songs from server
export const getStarred = async (serverUrl: string, username: string, password: string) => {
  checkOfflineMode();
  try {
    const authParams = generateAuthParams(username, password);
    const url = buildApiUrl(serverUrl, 'getStarred2.view', authParams);
    
    logger.log('Fetching starred songs from:', url);
    
    const response = await axios.get(url);
    return response;
  } catch (error) {
    logger.error('Failed to get starred songs:', error);
    throw error;
  }
};

// Star a song on the server
export const starSong = async (serverUrl: string, username: string, password: string, songId: string) => {
  checkOfflineMode();
  try {
    const authParams = generateAuthParams(username, password);
    const params = { ...authParams, id: songId };
    const url = buildApiUrl(serverUrl, 'star.view', params);
    
    logger.log('Starring song:', songId);
    
    const response = await axios.get(url);
    return response;
  } catch (error) {
    logger.error('Failed to star song:', error);
    throw error;
  }
};

// Unstar a song on the server
export const unstarSong = async (serverUrl: string, username: string, password: string, songId: string) => {
  checkOfflineMode();
  try {
    const authParams = generateAuthParams(username, password);
    const params = { ...authParams, id: songId };
    const url = buildApiUrl(serverUrl, 'unstar.view', params);

    logger.log('Unstarring song:', songId);

    const response = await axios.get(url);
    return response;
  } catch (error) {
    logger.error('Failed to unstar song:', error);
    throw error;
  }
};

// Tell the server a track is now playing (submission=false).
// The server forwards this to Last.fm / ListenBrainz if configured.
export const serverUpdateNowPlaying = async (
  serverUrl: string, username: string, password: string, songId: string,
): Promise<void> => {
  try {
    checkOfflineMode();
    const params = { ...generateAuthParams(username, password), id: songId, submission: 'false' };
    await axios.get(buildApiUrl(serverUrl, 'scrobble.view', params));
  } catch { /* fire-and-forget */ }
};

// Submit a completed play to the server (submission=true).
// The server forwards to Last.fm / ListenBrainz if configured.
export const serverScrobble = async (
  serverUrl: string, username: string, password: string,
  songId: string, startTimestampSec: number,
): Promise<void> => {
  try {
    checkOfflineMode();
    const params = {
      ...generateAuthParams(username, password),
      id: songId,
      time: String(startTimestampSec * 1000), // Subsonic expects milliseconds
      submission: 'true',
    };
    await axios.get(buildApiUrl(serverUrl, 'scrobble.view', params));
  } catch { /* fire-and-forget */ }
};

// ── Playlist API ──────────────────────────────────────────────────────────────

export interface ServerPlaylistMeta {
  id: string;
  name: string;
  owner: string;
  songCount: number;
  duration: number;
  coverArt?: string;
  public?: boolean;
}

export const getServerPlaylists = async (
  serverUrl: string, username: string, password: string,
): Promise<ServerPlaylistMeta[]> => {
  checkOfflineMode();
  const params = generateAuthParams(username, password);
  const url = buildApiUrl(serverUrl, 'getPlaylists.view', params);
  const response = await axios.get(url);
  const data = response.data['subsonic-response'];
  if (data?.status === 'failed') throw new Error(data.error?.message || 'Failed to fetch playlists');
  const playlists = data?.playlists?.playlist;
  if (!playlists) return [];
  return Array.isArray(playlists) ? playlists : [playlists];
};

export const getServerPlaylist = async (
  serverUrl: string, username: string, password: string, playlistId: string,
): Promise<{ meta: ServerPlaylistMeta; entries: any[] }> => {
  checkOfflineMode();
  const params = { ...generateAuthParams(username, password), id: playlistId };
  const url = buildApiUrl(serverUrl, 'getPlaylist.view', params);
  const response = await axios.get(url);
  const data = response.data['subsonic-response'];
  if (data?.status === 'failed') throw new Error(data.error?.message || 'Failed to fetch playlist');
  const pl = data?.playlist;
  const entries = pl?.entry ? (Array.isArray(pl.entry) ? pl.entry : [pl.entry]) : [];
  return { meta: pl, entries };
};

export const createServerPlaylist = async (
  serverUrl: string, username: string, password: string,
  name: string, songIds: string[] = [],
): Promise<string> => {
  checkOfflineMode();
  const sp = new URLSearchParams({ ...generateAuthParams(username, password), name });
  songIds.forEach(id => sp.append('songId', id));
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  const response = await axios.get(`${baseUrl}/rest/createPlaylist.view?${sp.toString()}`);
  const data = response.data['subsonic-response'];
  if (data?.status === 'failed') throw new Error(data.error?.message || 'Failed to create playlist');
  return data?.playlist?.id ?? '';
};

export const addSongsToServerPlaylist = async (
  serverUrl: string, username: string, password: string,
  playlistId: string, songIds: string[],
): Promise<void> => {
  checkOfflineMode();
  const sp = new URLSearchParams({ ...generateAuthParams(username, password), playlistId });
  songIds.forEach(id => sp.append('songIdToAdd', id));
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  await axios.get(`${baseUrl}/rest/updatePlaylist.view?${sp.toString()}`);
};

export const deleteServerPlaylist = async (
  serverUrl: string, username: string, password: string, playlistId: string,
): Promise<void> => {
  checkOfflineMode();
  const params = { ...generateAuthParams(username, password), id: playlistId };
  const url = buildApiUrl(serverUrl, 'deletePlaylist.view', params);
  await axios.get(url);
};

export const updateServerPlaylist = async (
  serverUrl: string, username: string, password: string,
  playlistId: string,
  opts: { name?: string; indicesToRemove?: number[] },
): Promise<void> => {
  checkOfflineMode();
  const sp = new URLSearchParams({ ...generateAuthParams(username, password), playlistId });
  if (opts.name) sp.set('name', opts.name);
  (opts.indicesToRemove ?? []).forEach(i => sp.append('songIndexToRemove', String(i)));
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  await axios.get(`${baseUrl}/rest/updatePlaylist.view?${sp.toString()}`);
};

// Replaces the entire song list of a server playlist (used for reordering).
// Subsonic's createPlaylist.view with an existing playlistId overwrites its content.
export const replaceServerPlaylistContent = async (
  serverUrl: string, username: string, password: string,
  playlistId: string, songIds: string[],
): Promise<void> => {
  checkOfflineMode();
  const sp = new URLSearchParams({ ...generateAuthParams(username, password), playlistId });
  songIds.forEach(id => sp.append('songId', id));
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  await axios.get(`${baseUrl}/rest/createPlaylist.view?${sp.toString()}`);
};

export interface SongAudioMeta {
  bitRate?: number;
  suffix?: string;
  size?: number;
  samplingRate?: number;
  channelCount?: number;
  bitDepth?: number;
}

export const getSongMetadata = async (
  serverUrl: string, username: string, password: string, songId: string,
): Promise<SongAudioMeta | null> => {
  try {
    const authParams = generateAuthParams(username, password);
    const url = buildApiUrl(serverUrl, 'getSong.view', { ...authParams, id: songId });
    const response = await axios.get(url);
    const song = response.data?.['subsonic-response']?.song;
    if (!song) return null;
    return {
      bitRate: song.bitRate,
      suffix: song.suffix,
      size: song.size,
      samplingRate: song.samplingRate,
      channelCount: song.channelCount,
      bitDepth: song.bitDepth,
    };
  } catch {
    return null;
  }
};
