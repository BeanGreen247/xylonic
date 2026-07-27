import React, { useEffect, useState, useCallback } from 'react';
import {
  getPlaylists,
  createPlaylist,
  addSongToPlaylist,
  setPlaylistServerId,
  upsertServerPlaylist,
  Playlist,
} from '../../services/playlistService';
import {
  getServerPlaylists,
  createServerPlaylist,
  addSongsToServerPlaylist,
} from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import './AddToPlaylistDialog.css';

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  url: string;
  duration?: number;
  coverArt?: string;
}

interface Props {
  song: Song;
  onClose: () => void;
}

const AddToPlaylistDialog: React.FC<Props> = ({ song, onClose }) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const reload = useCallback(() => setPlaylists(getPlaylists()), []);

  useEffect(() => {
    reload();
    // Pull server playlists and merge them into local storage
    const { serverUrl, username, password } = getFromStorage();
    if (!serverUrl || !username || !password) return;
    setSyncing(true);
    getServerPlaylists(serverUrl, username, password)
      .then(serverLists => {
        serverLists.forEach(sl => upsertServerPlaylist(sl.id, sl.name, sl.owner));
        reload();
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [reload]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0 && !newName.trim()) return;
    setSaving(true);
    const { serverUrl, username, password } = getFromStorage();
    const hasServer = !!(serverUrl && username && password);

    try {
      // Add to existing selected playlists
      for (const localId of selected) {
        const pl = playlists.find(p => p.id === localId);
        if (!pl) continue;
        addSongToPlaylist(localId, song as any);
        if (pl.serverId && hasServer) {
          await addSongsToServerPlaylist(serverUrl!, username!, password!, pl.serverId, [song.id]).catch(() => {});
        }
      }

      // Create new playlist
      if (newName.trim()) {
        const created = createPlaylist(newName.trim(), [song as any]);
        if (hasServer) {
          const serverId = await createServerPlaylist(serverUrl!, username!, password!, newName.trim(), [song.id]).catch(() => '');
          if (serverId) setPlaylistServerId(created.id, serverId);
        }
      }

      setToast(`Added to ${selected.size + (newName.trim() ? 1 : 0)} playlist(s)`);
      setTimeout(() => { onClose(); }, 900);
    } catch {
      setToast('Something went wrong');
      setSaving(false);
    }
  };

  const addCount = selected.size + (newName.trim() ? 1 : 0);

  return (
    <div className="apt-backdrop" onClick={onClose}>
      <div className="apt-sheet" onClick={e => e.stopPropagation()}>
        <div className="apt-header">
          <span className="apt-title">Add to Playlist</span>
          <button className="apt-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="apt-song-label">
          <i className="fas fa-music" />
          <span>{song.title}</span>
        </div>

        {syncing && (
          <div className="apt-syncing">
            <span className="apt-spinner" />
            Syncing from server…
          </div>
        )}

        <div className="apt-divider" />

        <div className="apt-list">
          {playlists.length === 0 && !syncing && (
            <div className="apt-empty">No playlists yet. Create one below.</div>
          )}
          {playlists.map(pl => {
            const isSelected = selected.has(pl.id);
            const alreadyHas = pl.songs.some(s => s.id === song.id);
            return (
              <label key={pl.id} className={`apt-item${alreadyHas ? ' apt-item--has' : ''}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(pl.id)}
                  disabled={alreadyHas}
                />
                <div className="apt-item-info">
                  <span className="apt-item-name">{pl.name}</span>
                  <span className="apt-item-meta">
                    {pl.songs.length} song{pl.songs.length !== 1 ? 's' : ''}
                    {pl.serverId && <span className="apt-server-badge"><i className="fas fa-cloud" /></span>}
                    {alreadyHas && <span className="apt-has-badge">Already added</span>}
                  </span>
                </div>
              </label>
            );
          })}
        </div>

        <div className="apt-new">
          <i className="fas fa-plus-circle" />
          <input
            type="text"
            className="apt-new-input"
            placeholder="New playlist name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
        </div>

        {toast ? (
          <div className="apt-toast">{toast}</div>
        ) : (
          <button
            className="apt-confirm"
            onClick={handleAdd}
            disabled={saving || addCount === 0}
          >
            {saving ? <span className="apt-spinner" /> : <i className="fas fa-check" />}
            {addCount > 0 ? `Add to ${addCount} playlist${addCount !== 1 ? 's' : ''}` : 'Select a playlist'}
          </button>
        )}
      </div>
    </div>
  );
};

export default AddToPlaylistDialog;
