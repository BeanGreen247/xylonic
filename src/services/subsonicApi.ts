import axios from 'axios';
import md5 from '../utils/md5';

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'SubsonicMusicApp';

const createAuthParams = (username: string, password: string) => {
    const salt = Math.random().toString(36).substring(7);
    const token = md5(password + salt);
    
    return {
        u: username,
        t: token,
        s: salt,
        v: API_VERSION,
        c: CLIENT_NAME,
        f: 'json'
    };
};

export const authenticateUser = async (username: string, password: string, serverUrl: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/ping`;
    
    try {
        const response = await axios.get(url, { params });
        return response.data['subsonic-response']?.status === 'ok';
    } catch (error) {
        console.error('Authentication failed:', error);
        return false;
    }
};

export const testConnection = async (username: string, password: string, serverUrl: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/ping`;
    
    try {
        const response = await axios.get(url, { params });
        return response;
    } catch (error) {
        console.error('Connection test failed:', error);
        throw error;
    }
};

export const getArtists = async (username: string, password: string, serverUrl: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/getArtists`;
    
    try {
        const response = await axios.get(url, { params });
        return response;
    } catch (error) {
        console.error('Failed to fetch artists:', error);
        throw error;
    }
};

export const getArtist = async (username: string, password: string, serverUrl: string, id: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/getArtist`;
    
    try {
        const response = await axios.get(url, { params: { ...params, id } });
        return response;
    } catch (error) {
        console.error('Failed to fetch artist:', error);
        throw error;
    }
};

export const getAlbum = async (username: string, password: string, serverUrl: string, id: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/getAlbum`;
    
    try {
        const response = await axios.get(url, { params: { ...params, id } });
        return response;
    } catch (error) {
        console.error('Failed to fetch album:', error);
        throw error;
    }
};

export const fetchSongs = async (username: string, password: string, serverUrl: string, albumId?: string) => {
    if (albumId) {
        const album = await getAlbum(username, password, serverUrl, albumId);
        return album.data['subsonic-response']?.album?.song || [];
    }
    
    return await getAllSongs(username, password, serverUrl);
};

export const getAllSongs = async (username: string, password: string, serverUrl: string) => {
    try {
        const artistsResponse = await getArtists(username, password, serverUrl);
        const indexes = artistsResponse.data['subsonic-response']?.artists?.index || [];
        const allSongs: any[] = [];

        for (const index of indexes) {
            if (index.artist) {
                for (const artist of index.artist) {
                    try {
                        const artistDetail = await getArtist(username, password, serverUrl, artist.id);
                        const albums = artistDetail.data['subsonic-response']?.artist?.album || [];
                        
                        for (const album of albums) {
                            try {
                                const albumDetail = await getAlbum(username, password, serverUrl, album.id);
                                const songs = albumDetail.data['subsonic-response']?.album?.song || [];
                                allSongs.push(...songs);
                            } catch (err) {
                                console.error(`Failed to fetch album ${album.id}:`, err);
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to fetch artist ${artist.id}:`, err);
                    }
                }
            }
        }

        return allSongs;
    } catch (error) {
        console.error('Failed to fetch all songs:', error);
        throw error;
    }
};

export const getStreamUrl = (username: string, password: string, serverUrl: string, id: string, maxBitRate?: number) => {
    const params = createAuthParams(username, password);
    const queryParams = new URLSearchParams({
        ...params as any,
        id,
        ...(maxBitRate && { maxBitRate: maxBitRate.toString() })
    });
    
    return `${serverUrl}/rest/stream?${queryParams.toString()}`;
};

export const getCoverArtUrl = (username: string, password: string, serverUrl: string, id: string, size?: number) => {
    const params = createAuthParams(username, password);
    const queryParams = new URLSearchParams({
        ...params as any,
        id,
        ...(size && { size: size.toString() })
    });
    
    return `${serverUrl}/rest/getCoverArt?${queryParams.toString()}`;
};

export const downloadSong = async (username: string, password: string, serverUrl: string, id: string) => {
    const params = createAuthParams(username, password);
    const url = `${serverUrl}/rest/download`;
    
    const response = await axios.get(url, {
        params: { ...params, id },
        responseType: 'arraybuffer'
    });
    
    return response.data;
};