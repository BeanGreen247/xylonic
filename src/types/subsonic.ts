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

export interface Artist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
}

export interface SearchResultSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  year?: number;
  genre?: string;
}

export interface SearchResult3 {
  artist?: Artist[];
  album?: Album[];
  song?: SearchResultSong[];
}

export interface SubsonicSearchResponse {
  'subsonic-response': {
    status: 'ok' | 'failed';
    version: string;
    searchResult3?: SearchResult3;
    error?: {
      code: number;
      message: string;
    };
  };
}