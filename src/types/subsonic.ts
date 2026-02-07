export interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
}

export interface SubsonicResponse {
    'subsonic-response': {
        status: string;
        version: string;
        [key: string]: any;
    };
}