import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import {
  getPlaylists,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  removeSongFromPlaylist,
  updatePlaylistSongs,
  setPlaylistServerId,
  upsertServerPlaylist,
  Playlist,
} from '../../services/playlistService';
import {
  getServerPlaylists,
  getServerPlaylist,
  createServerPlaylist,
  deleteServerPlaylist,
  updateServerPlaylist,
  replaceServerPlaylistContent,
} from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { Song } from '../../types';

interface PlaylistsTabProps {
  searchTerm?: string;
}

const PlaylistsTab: React.FC<PlaylistsTabProps> = ({ searchTerm = '' }) => {
  const { playPlaylist, addToQueue, playlist: currentQueue } = usePlayback();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newName, setNewName] = useState('');
  const [dragSongIndex, setDragSongIndex] = useState<{ plId: string; index: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const syncedOnMount = useRef(false);

  const refresh = useCallback(() => setPlaylists(getPlaylists()), []);

  const addSyncingId = (id: string) => setSyncingIds(prev => new Set(prev).add(id));
  const removeSyncingId = (id: string) => setSyncingIds(prev => { const s = new Set(prev); s.delete(id); return s; });

  // Pull server playlists (metadata + songs) and merge into local storage
  const syncFromServer = useCallback(async () => {
    const { serverUrl, username, password } = getFromStorage();
    if (!serverUrl || !username || !password) return;
    setSyncing(true);
    try {
      const serverLists = await getServerPlaylists(serverUrl, username, password);
      for (const sl of serverLists) {
        const local = upsertServerPlaylist(sl.id, sl.name, sl.owner);
        // Fetch full song list for server playlists whose local copy has no songs
        const localPl = getPlaylists().find(p => p.id === local.id);
        if (!localPl || localPl.songs.length === 0) {
          try {
            const { entries } = await getServerPlaylist(serverUrl, username, password, sl.id);
            const songs: Song[] = entries.map((e: any) => ({
              id: e.id,
              title: e.title,
              artist: e.artist ?? '',
              album: e.album ?? '',
              url: '',
              duration: e.duration,
              coverArt: e.coverArt,
            }));
            updatePlaylistSongs(local.id, songs);
          } catch {
            // non-critical — we'll show the playlist without songs for now
          }
        }
      }
      refresh();
    } catch {
      // server unreachable — local playlists still usable
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    if (!syncedOnMount.current) {
      syncedOnMount.current = true;
      syncFromServer();
    }
  }, [refresh, syncFromServer]);

  const getCreds = () => getFromStorage();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const pl = createPlaylist(newName.trim());
    setNewName('');
    refresh();

    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    addSyncingId(pl.id);
    try {
      const serverId = await createServerPlaylist(serverUrl, username, password, pl.name);
      if (serverId) setPlaylistServerId(pl.id, serverId);
      refresh();
    } catch {
      // local creation still succeeded
    } finally {
      removeSyncingId(pl.id);
    }
  };

  const handleSaveQueueAsPlaylist = async () => {
    const name = prompt('Playlist name:');
    if (!name?.trim()) return;
    const songs = [...currentQueue];
    const pl = createPlaylist(name.trim(), songs);
    refresh();

    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    addSyncingId(pl.id);
    try {
      const serverId = await createServerPlaylist(serverUrl, username, password, pl.name, songs.map(s => s.id));
      if (serverId) setPlaylistServerId(pl.id, serverId);
      refresh();
    } catch {
      // local creation still succeeded
    } finally {
      removeSyncingId(pl.id);
    }
  };

  const handleDelete = async (pl: Playlist) => {
    if (!window.confirm('Delete this playlist?')) return;
    deletePlaylist(pl.id);
    if (expandedId === pl.id) setExpandedId(null);
    refresh();

    if (!pl.serverId) return;
    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    try {
      await deleteServerPlaylist(serverUrl, username, password, pl.serverId);
    } catch {
      // local deletion still succeeded
    }
  };

  const startRename = (pl: Playlist) => {
    setRenamingId(pl.id);
    setRenameValue(pl.name);
  };

  const commitRename = async (pl: Playlist) => {
    const trimmed = renameValue.trim();
    if (trimmed) renamePlaylist(pl.id, trimmed);
    setRenamingId(null);
    refresh();

    if (!pl.serverId || !trimmed) return;
    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    addSyncingId(pl.id);
    try {
      await updateServerPlaylist(serverUrl, username, password, pl.serverId, { name: trimmed });
    } catch {
      // local rename still succeeded
    } finally {
      removeSyncingId(pl.id);
    }
  };

  const handleRemoveSong = async (pl: Playlist, songIndex: number) => {
    removeSongFromPlaylist(pl.id, songIndex);
    refresh();

    if (!pl.serverId) return;
    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    addSyncingId(pl.id);
    try {
      await updateServerPlaylist(serverUrl, username, password, pl.serverId, { indicesToRemove: [songIndex] });
    } catch {
      // local removal still succeeded
    } finally {
      removeSyncingId(pl.id);
    }
  };

  const handlePlayPlaylist = (pl: Playlist) => {
    if (pl.songs.length === 0) return;
    playPlaylist(pl.songs);
  };

  const handleAddAllToQueue = (pl: Playlist) => {
    pl.songs.forEach(s => addToQueue(s));
  };

  const handleSongDragStart = (plId: string, index: number) => {
    setDragSongIndex({ plId, index });
  };

  const handleSongDrop = async (pl: Playlist, toIndex: number) => {
    if (!dragSongIndex || dragSongIndex.plId !== pl.id || dragSongIndex.index === toIndex) {
      setDragSongIndex(null);
      return;
    }
    const songs = [...pl.songs];
    const [item] = songs.splice(dragSongIndex.index, 1);
    songs.splice(toIndex, 0, item);
    updatePlaylistSongs(pl.id, songs);
    setDragSongIndex(null);
    refresh();

    if (!pl.serverId) return;
    const { serverUrl, username, password } = getCreds();
    if (!serverUrl || !username || !password) return;
    addSyncingId(pl.id);
    try {
      await replaceServerPlaylistContent(serverUrl, username, password, pl.serverId, songs.map(s => s.id));
    } catch {
      // local reorder still succeeded
    } finally {
      removeSyncingId(pl.id);
    }
  };

  return (
    <>
      {/* Create new playlist */}
      <div className="create-playlist-form">
        <input
          className="create-playlist-input"
          placeholder="New playlist name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button
          className="create-playlist-btn"
          onClick={handleCreate}
          disabled={!newName.trim()}
        >
          Create
        </button>
      </div>

      <div className="panel-section-header">
        {currentQueue.length > 0 && (
          <>
            <span className="panel-section-label">From queue</span>
            <button className="panel-section-btn" onClick={handleSaveQueueAsPlaylist} title="Save current queue as playlist">
              <i className="fas fa-save"></i> Save Queue
            </button>
          </>
        )}
        <button
          className="panel-section-btn"
          onClick={syncFromServer}
          disabled={syncing}
          title="Sync playlists from server"
          style={{ marginLeft: 'auto' }}
        >
          <i className={`fas fa-sync-alt${syncing ? ' fa-spin' : ''}`}></i>
          {syncing ? ' Syncing…' : ' Sync'}
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="panel-empty">
          <i className="fas fa-music"></i>
          <p>No playlists yet.<br />Create one above to get started.</p>
        </div>
      ) : (() => {
        const term = searchTerm.toLowerCase();
        const visible = term
          ? playlists.filter(pl =>
              pl.name.toLowerCase().includes(term) ||
              pl.songs.some(s => s.title.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term))
            )
          : playlists;
        if (visible.length === 0) {
          return (
            <div className="panel-empty">
              <i className="fas fa-search"></i>
              <p>No results for "{searchTerm}"</p>
            </div>
          );
        }
        return visible.map(pl => (
          <div key={pl.id} className="playlist-card">
            <div
              className="playlist-card-header"
              onClick={() => setExpandedId(expandedId === pl.id ? null : pl.id)}
            >
              <i className={`fas fa-chevron-right playlist-card-expand-icon${expandedId === pl.id ? ' expanded' : ''}`}></i>

              {renamingId === pl.id ? (
                <input
                  className="playlist-rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(pl);
                    if (e.key === 'Escape') setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  onBlur={() => commitRename(pl)}
                />
              ) : (
                <span className="playlist-card-name">
                  {pl.name}
                  {pl.serverId && (
                    <i
                      className={`fas ${syncingIds.has(pl.id) ? 'fa-spinner fa-spin' : 'fa-cloud'} playlist-server-icon`}
                      title={syncingIds.has(pl.id) ? 'Syncing…' : 'Synced with server'}
                    />
                  )}
                </span>
              )}

              <span className="playlist-card-count">{pl.songs.length}</span>

              <div className="playlist-card-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="panel-action-btn"
                  onClick={() => handleAddAllToQueue(pl)}
                  title="Add all to queue"
                >
                  <i className="fas fa-list-ul"></i>
                </button>
                <button
                  className="panel-action-btn primary"
                  onClick={() => handlePlayPlaylist(pl)}
                  title="Play playlist"
                  disabled={pl.songs.length === 0}
                >
                  <i className="fas fa-play"></i>
                </button>
                <button
                  className="panel-action-btn"
                  onClick={() => startRename(pl)}
                  title="Rename"
                >
                  <i className="fas fa-pen"></i>
                </button>
                <button
                  className="panel-action-btn danger"
                  onClick={() => handleDelete(pl)}
                  title="Delete playlist"
                >
                  <i className="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>

            <div className={`playlist-card-songs${expandedId === pl.id ? ' expanded' : ''}`}>
              {pl.songs.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  No songs yet
                </div>
              ) : (
                pl.songs.map((song, idx) => (
                  <div
                    key={`${song.id}-${idx}`}
                    className="panel-song-row"
                    draggable
                    onDragStart={() => handleSongDragStart(pl.id, idx)}
                    onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drag-over'); }}
                    onDragLeave={e => (e.currentTarget as HTMLElement).classList.remove('drag-over')}
                    onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove('drag-over'); handleSongDrop(pl, idx); }}
                  >
                    <span className="panel-drag-handle"><i className="fas fa-grip-vertical"></i></span>
                    <div className="panel-song-info">
                      <div className="panel-song-title">{song.title}</div>
                      <div className="panel-song-sub">{song.artist}</div>
                    </div>
                    <div className="panel-song-actions">
                      <button
                        className="panel-action-btn"
                        onClick={() => addToQueue(song)}
                        title="Add to queue"
                      >
                        <i className="fas fa-list-ul"></i>
                      </button>
                      <button
                        className="panel-action-btn danger"
                        onClick={() => handleRemoveSong(pl, idx)}
                        title="Remove from playlist"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ));
      })()}
    </>
  );
};

export default PlaylistsTab;
