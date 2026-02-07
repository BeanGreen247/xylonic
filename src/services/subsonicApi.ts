import axios from 'axios';
import md5 from 'md5';  // ✅ This is correct - uses the npm package

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'SubsonicMusicApp';

// Generate authentication parameters
const generateAuthParams = (username: string, password: string) => {
    // ✅ Generate NEW salt and token for EACH request
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
        
        console.log('Testing connection to URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Connection test failed:', error);
        throw error;
    }
};

// Get all artists
export const getArtists = async (serverUrl: string, username: string, password: string) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getArtists.view', authParams);
        
        console.log('Fetching artists from URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Failed to fetch artists:', error);
        throw error;
    }
};

// Get artist details
export const getArtist = async (serverUrl: string, username: string, password: string, artistId: string) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getArtist.view', { ...authParams, id: artistId });
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Failed to fetch artist:', error);
        throw error;
    }
};

// Get album details
export const getAlbum = async (serverUrl: string, username: string, password: string, albumId: string) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getAlbum.view', { ...authParams, id: albumId });
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Failed to fetch album:', error);
        throw error;
    }
};

// Get all songs (uses getRandomSongs as Subsonic doesn't have getAllSongs)
export const getAllSongs = async (serverUrl: string, username: string, password: string) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getRandomSongs.view', { ...authParams, size: '500' });
        
        console.log('Fetching songs from URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Failed to fetch songs:', error);
        throw error;
    }
};

// Get random songs (better for shuffle functionality)
export const getRandomSongs = async (serverUrl: string, username: string, password: string, size: number = 50) => {
    try {
        const authParams = generateAuthParams(username, password);
        const url = buildApiUrl(serverUrl, 'getRandomSongs.view', { 
            ...authParams, 
            size: size.toString() 
        });
        
        console.log('Fetching random songs from URL:', url);
        
        const response = await axios.get(url);
        return response;
    } catch (error) {
        console.error('Failed to fetch random songs:', error);
        throw error;
    }
};

// Get stream URL for a song
export const getStreamUrl = (serverUrl: string, username: string, password: string, songId: string, bitrate?: number) => {
    const authParams = generateAuthParams(username, password);
    const params: Record<string, string> = { ...authParams, id: songId };
    
    if (bitrate) {
        params.maxBitRate = bitrate.toString();
    }
    
    return buildApiUrl(serverUrl, 'stream.view', params);
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
    try {
        const authParams = generateAuthParams(username, password);
        // Use search with empty query to get count, or getAlbumList2 to count songs
        const url = buildApiUrl(serverUrl, 'getAlbumList2.view', { 
            ...authParams, 
            type: 'alphabeticalByName',
            size: '500' // Get many albums to count their songs
        });
        
        console.log('Fetching albums to count songs');
        
        const response = await axios.get(url);
        const albums = response.data['subsonic-response']?.albumList2?.album || [];
        
        // Sum up all song counts from albums
        let totalSongs = 0;
        for (const album of albums) {
            totalSongs += album.songCount || 0;
        }
        
        return totalSongs;
    } catch (error) {
        console.error('Failed to get song count:', error);
        return 0;
    }
};