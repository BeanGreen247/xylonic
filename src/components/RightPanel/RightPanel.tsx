import React, { useEffect, useRef, useState } from 'react';
import { useUI } from '../../context/UIContext';
import QueueTab from './QueueTab';
import HistoryTab from './HistoryTab';
import PlaylistsTab from './PlaylistsTab';
import './RightPanel.css';

const PANEL_TITLES = {
  queue: 'Queue',
  history: 'Recently Played',
  playlists: 'Playlists',
} as const;

const PANEL_ICONS = {
  queue: 'fa-list-ul',
  history: 'fa-history',
  playlists: 'fa-music',
} as const;

const RightPanel: React.FC = () => {
  const { panelOpen, panelTab, closePanel } = useUI();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchTerm('');
  }, [panelTab]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchTerm('');
    } else {
      setSearchOpen(true);
    }
  };

  return (
    <>
      <div
        className={`right-panel-backdrop${panelOpen ? ' open' : ''}`}
        onClick={closePanel}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className={`right-panel${panelOpen ? ' open' : ''}`}
        role="complementary"
        aria-label={PANEL_TITLES[panelTab]}
      >
        <div className="right-panel-header">
          <i className={`fas ${PANEL_ICONS[panelTab]} right-panel-header-icon`}></i>
          <span className="right-panel-title">{PANEL_TITLES[panelTab]}</span>
          <button
            className={`right-panel-close${searchOpen ? ' active' : ''}`}
            onClick={toggleSearch}
            title="Search"
          >
            <i className="fas fa-search"></i>
          </button>
          <button className="right-panel-close" onClick={closePanel} title="Close (Esc)">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {searchOpen && (
          <div className="right-panel-search">
            <i className="fas fa-search right-panel-search-icon"></i>
            <input
              ref={searchInputRef}
              className="right-panel-search-input"
              placeholder="Filter…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchTerm(''); } }}
            />
            {searchTerm && (
              <button className="right-panel-search-clear" onClick={() => setSearchTerm('')} title="Clear">
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
        )}

        <div className="right-panel-content">
          {panelTab === 'queue'     && <QueueTab searchTerm={searchTerm} />}
          {panelTab === 'history'   && <HistoryTab searchTerm={searchTerm} />}
          {panelTab === 'playlists' && <PlaylistsTab searchTerm={searchTerm} />}
        </div>
      </div>
    </>
  );
};

export default RightPanel;
