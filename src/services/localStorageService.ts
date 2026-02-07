import { getItem, setItem } from '../utils/storage';

const AUTH_KEY = 'subsonic_auth';

interface AuthData {
    serverUrl: string;
    username: string;
    password: string;
}

interface LocalSong {
    id: string;
    title: string;
    artist: string;
    album: string;
    localPath: string;
    bitrate: number;
    downloadedAt: string;
    duration?: number;
    coverArt?: string;
}

class LocalStorageService {
    private readonly STORAGE_KEY = 'downloadedSongs';

    // Get all downloaded songs
    getDownloadedSongs(): LocalSong[] {
        const stored = getItem(this.STORAGE_KEY);
        if (!stored) return [];
        try {
            return JSON.parse(stored);
        } catch {
            return [];
        }
    }

    // Add a downloaded song
    addDownloadedSong(song: LocalSong): void {
        const songs = this.getDownloadedSongs();
        
        const existingIndex = songs.findIndex(s => 
            s.id === song.id && s.bitrate === song.bitrate
        );
        
        if (existingIndex >= 0) {
            songs[existingIndex] = song;
        } else {
            songs.push(song);
        }
        
        setItem(this.STORAGE_KEY, JSON.stringify(songs));
    }

    // Check if song is downloaded at specific quality
    isSongDownloaded(songId: string, bitrate: number): boolean {
        const songs = this.getDownloadedSongs();
        return songs.some(s => s.id === songId && s.bitrate === bitrate);
    }

    // Get local path for a song
    getLocalPath(songId: string, bitrate: number): string | null {
        const songs = this.getDownloadedSongs();
        const song = songs.find(s => s.id === songId && s.bitrate === bitrate);
        return song?.localPath || null;
    }

    // Get downloaded song by ID and bitrate
    getDownloadedSong(songId: string, bitrate: number): LocalSong | null {
        const songs = this.getDownloadedSongs();
        return songs.find(s => s.id === songId && s.bitrate === bitrate) || null;
    }

    // Remove a downloaded song
    removeDownloadedSong(songId: string, bitrate: number): void {
        let songs = this.getDownloadedSongs();
        songs = songs.filter(s => !(s.id === songId && s.bitrate === bitrate));
        setItem(this.STORAGE_KEY, JSON.stringify(songs));
    }

    // Get all songs grouped by artist
    getSongsByArtist(): Map<string, LocalSong[]> {
        const songs = this.getDownloadedSongs();
        const grouped = new Map<string, LocalSong[]>();
        
        songs.forEach(song => {
            const artistSongs = grouped.get(song.artist) || [];
            artistSongs.push(song);
            grouped.set(song.artist, artistSongs);
        });
        
        return grouped;
    }

    // Get all songs grouped by album
    getSongsByAlbum(): Map<string, LocalSong[]> {
        const songs = this.getDownloadedSongs();
        const grouped = new Map<string, LocalSong[]>();
        
        songs.forEach(song => {
            const key = `${song.artist}|||${song.album}`;
            const albumSongs = grouped.get(key) || [];
            albumSongs.push(song);
            grouped.set(key, albumSongs);
        });
        
        return grouped;
    }

    // Clear all downloaded songs
    clearAll(): void {
        setItem(this.STORAGE_KEY, JSON.stringify([]));
    }

    // Auth methods
    saveAuth(serverUrl: string, username: string, password: string) {
        const authData: AuthData = { serverUrl, username, password };
        localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
    }

    getAuth(): AuthData | null {
        const data = localStorage.getItem(AUTH_KEY);
        if (!data) return null;
        
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    clearAuth() {
        localStorage.removeItem(AUTH_KEY);
    }
}

export const localStorageService = new LocalStorageService();
export type { LocalSong };