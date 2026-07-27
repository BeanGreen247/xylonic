import React, { createContext, useContext, useState, ReactNode } from 'react';

export type PanelTab = 'queue' | 'history' | 'playlists';

interface UIContextType {
  panelOpen: boolean;
  panelTab: PanelTab;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setTab: (tab: PanelTab) => void;
  togglePanel: (tab?: PanelTab) => void;
  nowPlayingOpen: boolean;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  desktopNowPlayingOpen: boolean;
  openDesktopNowPlaying: () => void;
  closeDesktopNowPlaying: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const useUI = (): UIContextType => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
};

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('queue');
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [desktopNowPlayingOpen, setDesktopNowPlayingOpen] = useState(false);

  const openPanel = (tab?: PanelTab) => {
    if (tab) setPanelTab(tab);
    setPanelOpen(true);
  };

  const closePanel = () => setPanelOpen(false);
  const setTab = (tab: PanelTab) => setPanelTab(tab);

  const togglePanel = (tab?: PanelTab) => {
    if (panelOpen && (!tab || tab === panelTab)) {
      setPanelOpen(false);
    } else {
      if (tab) setPanelTab(tab);
      setPanelOpen(true);
    }
  };

  const openNowPlaying  = () => setNowPlayingOpen(true);
  const closeNowPlaying = () => setNowPlayingOpen(false);

  const openDesktopNowPlaying  = () => setDesktopNowPlayingOpen(true);
  const closeDesktopNowPlaying = () => setDesktopNowPlayingOpen(false);

  return (
    <UIContext.Provider value={{
      panelOpen, panelTab, openPanel, closePanel, setTab, togglePanel,
      nowPlayingOpen, openNowPlaying, closeNowPlaying,
      desktopNowPlayingOpen, openDesktopNowPlaying, closeDesktopNowPlaying,
    }}>
      {children}
    </UIContext.Provider>
  );
};
