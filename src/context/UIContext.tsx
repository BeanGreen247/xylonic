import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

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

  const openPanel = useCallback((tab?: PanelTab) => {
    if (tab) setPanelTab(tab);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);
  const setTab = useCallback((tab: PanelTab) => setPanelTab(tab), []);

  const togglePanel = useCallback((tab?: PanelTab) => {
    if (panelOpen && (!tab || tab === panelTab)) {
      setPanelOpen(false);
    } else {
      if (tab) setPanelTab(tab);
      setPanelOpen(true);
    }
  }, [panelOpen, panelTab]);

  const openNowPlaying  = useCallback(() => setNowPlayingOpen(true), []);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), []);

  const openDesktopNowPlaying  = useCallback(() => setDesktopNowPlayingOpen(true), []);
  const closeDesktopNowPlaying = useCallback(() => setDesktopNowPlayingOpen(false), []);

  const value = useMemo<UIContextType>(() => ({
    panelOpen, panelTab, openPanel, closePanel, setTab, togglePanel,
    nowPlayingOpen, openNowPlaying, closeNowPlaying,
    desktopNowPlayingOpen, openDesktopNowPlaying, closeDesktopNowPlaying,
  }), [
    panelOpen, panelTab, openPanel, closePanel, setTab, togglePanel,
    nowPlayingOpen, openNowPlaying, closeNowPlaying,
    desktopNowPlayingOpen, openDesktopNowPlaying, closeDesktopNowPlaying,
  ]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
