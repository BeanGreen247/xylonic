export interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
}

export interface PlayerState {
    currentTrack: Song | null;
    isPlaying: boolean;
    volume: number;
    currentTime: number;
    duration: number;
    repeat: 'none' | 'one' | 'all';
    shuffle: boolean;
}