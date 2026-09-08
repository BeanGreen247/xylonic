import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { TopLevelView } from '../../Library/LibraryViewToggle';

const PREF_KEY = (username: string) => `xylonic_library_view_${username}`;

const VIEW_OPTIONS: { view: TopLevelView; label: string }[] = [
  { view: 'artists',    label: 'Artists' },
  { view: 'allAlbums',  label: 'Albums'  },
  { view: 'allSongs',   label: 'Songs'   },
  { view: 'likedSongs', label: 'Liked'   },
];

/**
 * "Library" settings section — the per-user default landing view. Persists to
 * localStorage keyed by username; self-contained apart from reading `username`.
 */
const LibrarySection: React.FC = () => {
  const { username } = useAuth();
  const [preferredView, setPreferredView] = useState<TopLevelView>('artists');

  useEffect(() => {
    if (!username) return;
    const saved = localStorage.getItem(PREF_KEY(username)) as TopLevelView | null;
    if (saved && ['artists', 'allAlbums', 'allSongs', 'likedSongs'].includes(saved)) {
      setPreferredView(saved as TopLevelView);
    }
  }, [username]);

  const handlePreferredViewChange = (view: TopLevelView) => {
    setPreferredView(view);
    if (username) localStorage.setItem(PREF_KEY(username), view);
  };

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Library</h3>
      <div className="settings-card">
        <div className="settings-row non-interactive">
          <span className="settings-row-icon"><i className="fas fa-book-open" /></span>
          <span className="settings-row-label">Default View</span>
          <span className="settings-row-action">
            <select
              className="settings-select"
              value={preferredView}
              onChange={e => handlePreferredViewChange(e.target.value as TopLevelView)}
            >
              {VIEW_OPTIONS.map(({ view, label }) => (
                <option key={view} value={view}>{label}</option>
              ))}
            </select>
          </span>
        </div>
      </div>
    </section>
  );
};

export default LibrarySection;
