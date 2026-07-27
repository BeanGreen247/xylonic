import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useUI } from '../../context/UIContext';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { AppSection } from '../Layout/AppNav';
import type { PanelTab } from '../../context/UIContext';
import './MobileBottomNav.css';

interface Props {
  appSection: AppSection;
  isSearching: boolean;
  onSectionChange: (section: AppSection) => void;
  onSearch: () => void;
  onRemote?: () => void;
  remoteActive?: boolean;
  remoteEnabled?: boolean;
}

const PANEL_ITEMS: { tab: PanelTab; icon: string; label: string }[] = [
  { tab: 'queue',     icon: 'fa-list-ul', label: 'Queue' },
  { tab: 'history',   icon: 'fa-history',  label: 'History' },
  { tab: 'playlists', icon: 'fa-music',    label: 'Playlists' },
];

const MobileBottomNav: React.FC<Props> = ({
  appSection,
  isSearching,
  onSectionChange,
  onSearch,
  onRemote,
  remoteActive = false,
  remoteEnabled = false,
}) => {
  const { panelOpen, panelTab, togglePanel, closePanel } = useUI();
  const { offlineModeEnabled } = useOfflineMode();
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const subMenuRef = useRef<HTMLDivElement>(null);

  const homeActive     = appSection === 'home'     && !isSearching && !panelOpen;
  const libraryActive  = appSection === 'library'  && !isSearching && !panelOpen;
  const searchActive   = isSearching               && !panelOpen;
  const panelActive    = panelOpen;
  const settingsActive = appSection === 'settings' && !isSearching && !panelOpen;

  const activeItem = PANEL_ITEMS.find(i => i.tab === panelTab) ?? PANEL_ITEMS[0];

  const handleHome     = () => { closePanel(); setSubMenuOpen(false); onSectionChange('home'); };
  const handleLibrary  = () => { closePanel(); setSubMenuOpen(false); onSectionChange('library'); };
  const handleSettings = () => { closePanel(); setSubMenuOpen(false); onSectionChange('settings'); };

  const handlePanelBtn = () => {
    if (subMenuOpen) {
      setSubMenuOpen(false);
    } else if (panelOpen) {
      setSubMenuOpen(true);
    } else {
      setSubMenuOpen(true);
    }
  };

  const handleSubItem = (tab: PanelTab) => {
    setSubMenuOpen(false);
    togglePanel(tab);
  };

  // Close submenu when tapping outside
  useEffect(() => {
    if (!subMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (subMenuRef.current && !subMenuRef.current.contains(e.target as Node)) {
        setSubMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [subMenuOpen]);

  // Close submenu when panel closes externally (e.g. backdrop tap)
  useEffect(() => {
    if (!panelOpen) setSubMenuOpen(false);
  }, [panelOpen]);

  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
      <button
        className={`mobile-nav-btn${homeActive ? ' active' : ''}${offlineModeEnabled ? ' disabled' : ''}`}
        onClick={offlineModeEnabled ? undefined : handleHome}
        disabled={offlineModeEnabled}
        aria-label="Home"
        title={offlineModeEnabled ? 'Not available in offline mode' : undefined}
      >
        <i className="fas fa-home" />
        <span>Home</span>
      </button>

      <button
        className={`mobile-nav-btn${libraryActive ? ' active' : ''}`}
        onClick={handleLibrary}
        aria-label="Library"
      >
        <i className="fas fa-book-open" />
        <span>Library</span>
      </button>

      <button
        className={`mobile-nav-btn${searchActive ? ' active' : ''}`}
        onClick={() => { closePanel(); setSubMenuOpen(false); onSearch(); }}
        aria-label="Search"
      >
        <i className="fas fa-search" />
        <span>Search</span>
      </button>

      {/* Queue / History / Playlists submenu */}
      <div ref={subMenuRef} className="mobile-nav-panel-wrap">
        {subMenuOpen && (
          <div className="mobile-nav-submenu" role="menu" aria-label="Panel tabs">
            {PANEL_ITEMS.map(({ tab, icon, label }) => (
              <button
                key={tab}
                className={`mobile-nav-submenu-item${panelOpen && panelTab === tab ? ' active' : ''}`}
                onClick={() => handleSubItem(tab)}
                role="menuitem"
                aria-label={label}
              >
                <i className={`fas ${icon}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          className={`mobile-nav-btn${panelActive ? ' active' : ''}${subMenuOpen ? ' submenu-open' : ''}`}
          onClick={handlePanelBtn}
          aria-label="Queue and playlists"
          aria-expanded={subMenuOpen}
          aria-haspopup="menu"
        >
          <i className={`fas ${panelActive ? activeItem.icon : 'fa-list-ul'}`} />
          <span>{panelActive ? activeItem.label : 'Queue'}</span>
        </button>
      </div>

      <button
        className={`mobile-nav-btn${settingsActive ? ' active' : ''}`}
        onClick={handleSettings}
        aria-label="Settings"
      >
        <i className="fas fa-cog" />
        <span>Settings</span>
      </button>

      {Capacitor.isNativePlatform() && (
        <button
          className={`mobile-nav-btn mobile-nav-btn--remote${remoteActive ? ' active' : ''}${!remoteEnabled ? ' disabled' : ''}`}
          onClick={remoteEnabled ? onRemote : undefined}
          disabled={!remoteEnabled}
          aria-label="Remote Mode"
          title={
            !remoteEnabled
              ? 'No Xylonic devices found on this network'
              : remoteActive
              ? 'Remote Mode active'
              : 'Control another Xylonic device'
          }
        >
          <i className="fas fa-satellite-dish" />
          <span>Remote</span>
          {remoteEnabled && !remoteActive && (
            <span className="mobile-nav-remote-dot" />
          )}
        </button>
      )}
    </nav>
  );
};

export default MobileBottomNav;
