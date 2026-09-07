import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

/**
 * The one place layout/form-factor branching lives (WS-ARCH). Components read
 * `useLayoutMode()` instead of scattering `window.innerWidth <= 767` /
 * `if (isElectron)` checks.
 *
 * - compact  : phone — single pane, bottom nav
 * - medium   : tablet / small desktop window — rail nav
 * - expanded : desktop — sidebar + content + right panel
 * - tv       : 10-foot / D-pad (Android TV) — populated in WS-TV via the native
 *              `getUiMode()` bridge; the viewport heuristic here never returns it
 *
 * Viewport `matchMedia` for now; WS-UX upgrades the medium/expanded split to
 * container queries.
 */
export type LayoutMode = 'compact' | 'medium' | 'expanded' | 'tv';

interface LayoutModeValue {
  mode: LayoutMode;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  isTv: boolean;
  /** true on real touch devices with no fine pointer */
  isCoarsePointer: boolean;
}

const COMPACT_MAX = 767; // matches the existing CSS breakpoint
const MEDIUM_MAX = 1199;

function readViewportMode(): LayoutMode {
  if (typeof window === 'undefined') return 'expanded';
  const w = window.innerWidth;
  if (w <= COMPACT_MAX) return 'compact';
  if (w <= MEDIUM_MAX) return 'medium';
  return 'expanded';
}

function readCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

const LayoutModeContext = createContext<LayoutModeValue>({
  mode: 'expanded',
  isCompact: false,
  isMedium: false,
  isExpanded: true,
  isTv: false,
  isCoarsePointer: false,
});

export const LayoutModeProvider: React.FC<{ children: ReactNode; forceMode?: LayoutMode }> = ({
  children,
  forceMode,
}) => {
  const [mode, setMode] = useState<LayoutMode>(() => forceMode ?? readViewportMode());
  const [coarse, setCoarse] = useState<boolean>(readCoarsePointer);

  useEffect(() => {
    if (forceMode || typeof window === 'undefined') return;
    const update = () => setMode(readViewportMode());
    const mqUpdate = () => setCoarse(readCoarsePointer());

    window.addEventListener('resize', update);
    const mq = window.matchMedia?.('(hover: none) and (pointer: coarse)');
    mq?.addEventListener?.('change', mqUpdate);

    update();
    mqUpdate();
    return () => {
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', mqUpdate);
    };
  }, [forceMode]);

  const value = useMemo<LayoutModeValue>(
    () => ({
      mode,
      isCompact: mode === 'compact',
      isMedium: mode === 'medium',
      isExpanded: mode === 'expanded',
      isTv: mode === 'tv',
      isCoarsePointer: coarse,
    }),
    [mode, coarse],
  );

  return <LayoutModeContext.Provider value={value}>{children}</LayoutModeContext.Provider>;
};

export const useLayoutMode = (): LayoutModeValue => useContext(LayoutModeContext);
