export interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
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
  bitRate?: number;
  suffix?: string;
  size?: number;
  samplingRate?: number;
  channelCount?: number;
  discNumber?: number;
}

export interface SearchResult3 {
  artist?: Artist[];
  album?: Album[];
  song?: SearchResultSong[];
}

// ── Subsonic API 1.16.1 response envelope ────────────────────────────────────
// Modelled against the subset of the spec this app actually reads (Navidrome /
// Airsonic / Gonic). Response bodies are probed key-by-key, so the body is one
// interface with every container optional rather than a discriminated union.

export interface SubsonicErrorInfo {
  code: number;
  message: string;
}

export interface SubsonicBaseResponse {
  status: 'ok' | 'failed';
  version: string;
  type?: string;
  serverVersion?: string;
  openSubsonic?: boolean;
  error?: SubsonicErrorInfo;
}

// A song / track / playlist entry. `title` is always present for songs; the app
// has always treated `artist` / `album` as present too, so they are required
// here to avoid a cascade of null-guards at call sites.
export interface SubsonicChild {
  id: string;
  parent?: string;
  isDir?: boolean;
  title: string;
  album: string;
  artist: string;
  track?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  transcodedContentType?: string;
  transcodedSuffix?: string;
  duration?: number;
  bitRate?: number;
  samplingRate?: number;
  channelCount?: number;
  bitDepth?: number;
  path?: string;
  isVideo?: boolean;
  playCount?: number;
  discNumber?: number;
  created?: string;
  starred?: string;
  albumId?: string;
  artistId?: string;
  type?: string;
}

export interface SubsonicArtistSummary {
  id: string;
  name: string;
  coverArt?: string;
  artistImageUrl?: string;
  albumCount?: number;
  starred?: string;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  playCount?: number;
  created?: string;
  year?: number;
  genre?: string;
  starred?: string;
  song?: SubsonicChild[];
}

export interface SubsonicArtistWithAlbums extends SubsonicArtistSummary {
  album?: SubsonicAlbum[];
}

export interface SubsonicIndex {
  name: string;
  artist?: SubsonicArtistSummary[];
}

export interface SubsonicArtistsContainer {
  index?: SubsonicIndex[];
  ignoredArticles?: string;
}

export interface SubsonicSearchResult3Raw {
  artist?: SubsonicArtistSummary[];
  album?: SubsonicAlbum[];
  song?: SubsonicChild[];
}

export interface SubsonicAlbumList2 {
  album?: SubsonicAlbum[];
}

export interface SubsonicStarred2 {
  artist?: SubsonicArtistSummary[];
  album?: SubsonicAlbum[];
  song?: SubsonicChild[];
}

export interface SubsonicRandomSongs {
  song?: SubsonicChild[];
}

export interface SubsonicPlaylistMeta {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  created?: string;
  changed?: string;
  coverArt?: string;
}

export interface SubsonicPlaylistWithEntries extends SubsonicPlaylistMeta {
  entry?: SubsonicChild[];
}

export interface SubsonicPlaylistsContainer {
  playlist?: SubsonicPlaylistMeta[] | SubsonicPlaylistMeta;
}

export interface SubsonicResponseBody extends SubsonicBaseResponse {
  artists?: SubsonicArtistsContainer;
  artist?: SubsonicArtistWithAlbums;
  album?: SubsonicAlbum;
  albumList2?: SubsonicAlbumList2;
  searchResult3?: SubsonicSearchResult3Raw;
  starred2?: SubsonicStarred2;
  starred?: SubsonicStarred2;
  randomSongs?: SubsonicRandomSongs;
  playlists?: SubsonicPlaylistsContainer;
  playlist?: SubsonicPlaylistWithEntries;
  song?: SubsonicChild;
}

export interface SubsonicEnvelope {
  'subsonic-response': SubsonicResponseBody;
}

// Kept for existing consumers.
export interface SubsonicResponse {
  'subsonic-response': SubsonicResponseBody;
}

export interface SubsonicSearchResponse {
  'subsonic-response': SubsonicBaseResponse & {
    searchResult3?: SearchResult3;
  };
}
