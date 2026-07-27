import { Song } from '../types';

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
  serverId?: string;
  owner?: string;
}

const STORAGE_KEY_PREFIX = 'playlists_';

const getKey = (): string => {
  const username = localStorage.getItem('username') || 'guest';
  return `${STORAGE_KEY_PREFIX}${username}`;
};

const save = (playlists: Playlist[]): void => {
  localStorage.setItem(getKey(), JSON.stringify(playlists));
};

export const getPlaylists = (): Playlist[] => {
  try {
    const raw = localStorage.getItem(getKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const createPlaylist = (name: string, songs: Song[] = []): Playlist => {
  const playlists = getPlaylists();
  const playlist: Playlist = {
    id: `pl_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: name.trim() || 'Untitled Playlist',
    songs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  save([...playlists, playlist]);
  return playlist;
};

export const deletePlaylist = (id: string): void => {
  save(getPlaylists().filter(p => p.id !== id));
};

export const renamePlaylist = (id: string, name: string): void => {
  save(getPlaylists().map(p =>
    p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p
  ));
};

export const addSongToPlaylist = (playlistId: string, song: Song): boolean => {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return false;
  if (playlist.songs.some(s => s.id === song.id)) return false;
  save(playlists.map(p =>
    p.id === playlistId
      ? { ...p, songs: [...p.songs, song], updatedAt: Date.now() }
      : p
  ));
  return true;
};

export const removeSongFromPlaylist = (playlistId: string, songIndex: number): void => {
  save(getPlaylists().map(p => {
    if (p.id !== playlistId) return p;
    const songs = [...p.songs];
    songs.splice(songIndex, 1);
    return { ...p, songs, updatedAt: Date.now() };
  }));
};

export const updatePlaylistSongs = (playlistId: string, songs: Song[]): void => {
  save(getPlaylists().map(p =>
    p.id === playlistId ? { ...p, songs, updatedAt: Date.now() } : p
  ));
};

export const setPlaylistServerId = (localId: string, serverId: string): void => {
  save(getPlaylists().map(p =>
    p.id === localId ? { ...p, serverId } : p
  ));
};

export const upsertServerPlaylist = (serverId: string, name: string, owner?: string): Playlist => {
  const playlists = getPlaylists();
  const existing = playlists.find(p => p.serverId === serverId);
  if (existing) {
    const updated = playlists.map(p =>
      p.serverId === serverId ? { ...p, name, owner, updatedAt: Date.now() } : p
    );
    save(updated);
    return updated.find(p => p.serverId === serverId)!;
  }
  const playlist: Playlist = {
    id: `sv_${serverId}`,
    name,
    songs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    serverId,
    owner,
  };
  save([...playlists, playlist]);
  return playlist;
};
