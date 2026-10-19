import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { ThemeType, Theme, presetThemes, generateColorVariants } from '../types/theme';
import { readUserColorConfig, writeUserColorConfig } from '../utils/colorConfigManager';
import { logger } from '../utils/logger';
import { deriveNeutrals, ensureContrast, hexToRgbTriplet, onColor } from '../utils/colorContrast';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  currentTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  customThemes: Record<string, Theme>;
  updateCustomTheme: (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4', primaryColor: string, name: string) => void;
  resetCustomTheme: (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4') => void;
  getAllThemes: () => Record<string, Theme>;
  refreshThemes: () => Promise<void>;
  /** light/dark mode — orthogonal to the accent theme above */
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
}

const THEME_MODE_KEY = 'xylonic_theme_mode';
const BG = { dark: '#121212', light: '#f7f7f8' } as const;
// Worst-case surface an accent has to stay readable on in each mode (--surface-variant).
const ACCENT_SURFACE = { dark: '#2a2a2a', light: '#f0f0f2' } as const;

function effectiveMode(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_MODE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

/** Reflect the mode onto <html data-theme> and the theme-color meta. */
function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  const effective =
    mode === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BG[effective]);
}

// Apply synchronously at module load so there's no flash before React mounts.
try {
  applyThemeMode(readThemeMode());
} catch {
  /* SSR / no document */
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

const defaultCustomTheme = (name: string): Theme => ({
  name,
  primaryColor: '#00bcd4',
  primaryLight: '#4dd0e1',
  primaryDark: '#0097a7',
  secondaryColor: '#03a9f4',
  secondaryLight: '#4fc3f7',
  secondaryDark: '#0288d1',
  accentColor: '#00e5ff',
  accentLight: '#84ffff',
  isCustom: true,
});

// Helper: current logged-in user from localStorage
const getCurrentUser = () => {
  const auth = localStorage.getItem('auth');
  const username = localStorage.getItem('username');
  if (auth === 'true' && username) return username;
  return null;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeType>('cyan');
  const [customThemes, setCustomThemes] = useState<Record<string, Theme>>({
    custom1: defaultCustomTheme('My Theme 1'),
    custom2: defaultCustomTheme('My Theme 2'),
    custom3: defaultCustomTheme('My Theme 3'),
    custom4: defaultCustomTheme('My Theme 4'),
  });
  const [loaded, setLoaded] = useState(false);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readThemeMode);

  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeState(m);
    try {
      if (m === 'system') localStorage.removeItem(THEME_MODE_KEY);
      else localStorage.setItem(THEME_MODE_KEY, m);
    } catch {
      /* ignore */
    }
    applyThemeMode(m);
  }, []);

  // Keep the theme-color meta in sync when the OS scheme changes while on 'system'.
  useEffect(() => {
    if (themeMode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyThemeMode('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeMode]);

  const getAllThemes = useCallback(
    () => ({
      ...presetThemes,
      ...customThemes,
    }),
    [customThemes]
  );

  const applyTheme = useCallback(
    (themeKey: string) => {
      const allThemes = {
        ...presetThemes,
        ...customThemes,
      };
      const theme = allThemes[themeKey];
      if (!theme) {
        logger.error('Theme not found:', themeKey);
        return;
      }
      const root = document.documentElement;

      // Accents are tuned per mode so text/icons stay readable whatever colour
      // combo is chosen: lightened on dark, darkened on light, until they reach
      // WCAG AA (4.5:1) against the worst surface (3:1 for the light accent).
      const mode = effectiveMode();
      const surface = ACCENT_SURFACE[mode];
      // Neutrals (secondary/muted text, borders) are derived from the accent too,
      // so greys keep their contrast on this theme's tinted hover/selected fills.
      const neutrals = deriveNeutrals(mode, theme.primaryColor);
      const primary = neutrals.accent;
      root.style.setProperty('--text-secondary', neutrals.textSecondary);
      root.style.setProperty('--text-muted', neutrals.textMuted);
      root.style.setProperty('--border', neutrals.border);
      root.style.setProperty('--border-strong', neutrals.borderStrong);
      root.style.setProperty('--primary-color', primary);
      root.style.setProperty('--primary-light', ensureContrast(theme.primaryLight, surface, 4.5));
      root.style.setProperty('--primary-dark', theme.primaryDark);
      root.style.setProperty('--secondary-color', ensureContrast(theme.secondaryColor, surface, 4.5));
      root.style.setProperty('--secondary-light', theme.secondaryLight);
      root.style.setProperty('--secondary-dark', theme.secondaryDark);
      root.style.setProperty('--accent-color', ensureContrast(theme.accentColor, surface, 4.5));
      root.style.setProperty('--accent-light', ensureContrast(theme.accentLight, surface, 3));
      // Tinted fills keep the theme's own hue; only text/icon shades are adjusted.
      root.style.setProperty('--primary-color-rgb', hexToRgbTriplet(theme.primaryColor));
      root.style.setProperty('--on-primary', onColor(primary));
      
      // Set gradient variables for mini player
      root.style.setProperty('--gradient-start', theme.primaryDark);
      root.style.setProperty('--gradient-end', theme.primaryColor);

      logger.log('[ThemeContext] Applied theme to window:', themeKey, theme);
      logger.log('Applied theme:', themeKey, theme);
    },
    [customThemes]
  );

  // Core loader: read config for current user and update state
  const loadUserTheme = useCallback(async () => {
    const username = getCurrentUser();
    logger.log('[ThemeContext] loadUserTheme called, username:', username);
    if (!username) {
      // Logged out: try to load from localStorage for mini player
      const savedTheme = localStorage.getItem('currentTheme');
      const savedCustomThemes = localStorage.getItem('customThemes');
      if (savedTheme && savedCustomThemes) {
        logger.log('[ThemeContext] Loading theme from localStorage (no auth)');
        setCurrentTheme(savedTheme as ThemeType);
        setCustomThemes(JSON.parse(savedCustomThemes));
      }
      logger.log('[ThemeContext] No authenticated user, leaving default CSS theme');
      logger.log('ThemeContext: no authenticated user, leaving default CSS theme');
      setLoaded(true);
      return;
    }

    // Try localStorage first for instant loading (especially for mini player)
    const savedTheme = localStorage.getItem('currentTheme');
    const savedCustomThemes = localStorage.getItem('customThemes');
    if (savedTheme && savedCustomThemes) {
      logger.log('[ThemeContext] Loading theme from localStorage immediately');
      setCurrentTheme(savedTheme as ThemeType);
      setCustomThemes(JSON.parse(savedCustomThemes));
      setLoaded(true);
    } else {
      setLoaded(false);
    }

    try {
      logger.log('[ThemeContext] Loading theme from config file for user:', username);
      logger.log('ThemeContext: loading theme for user:', username);
      const config = await readUserColorConfig(username);
      logger.log('[ThemeContext] Config loaded from file:', config);
      if (config && config.customThemes && Object.keys(config.customThemes).length > 0) {
        // Use exactly what is in this user's cfg file
        logger.log('[ThemeContext] Applying user config theme:', config.theme);
        setCustomThemes(config.customThemes as Record<string, Theme>);
        setCurrentTheme((config.theme as ThemeType) || 'cyan');
      } else {
        // First time for this user: start from defaults (but ONLY for this user)
        logger.log('[ThemeContext] No config found, using defaults');
        setCustomThemes({
          custom1: defaultCustomTheme('My Theme 1'),
          custom2: defaultCustomTheme('My Theme 2'),
          custom3: defaultCustomTheme('My Theme 3'),
          custom4: defaultCustomTheme('My Theme 4'),
        });
        setCurrentTheme('cyan');
      }
    } catch (error) {
      logger.error('[ThemeContext] Failed to load color config:', error);
      logger.error('Failed to load color config:', error);
      // Fallback to defaults for this user
      setCustomThemes({
        custom1: defaultCustomTheme('My Theme 1'),
        custom2: defaultCustomTheme('My Theme 2'),
        custom3: defaultCustomTheme('My Theme 3'),
        custom4: defaultCustomTheme('My Theme 4'),
      });
      setCurrentTheme('cyan');
    } finally {
      setLoaded(true);
    }
  }, []);

  // Public API for Theme dialog: re-read from disk
  const refreshThemes = useCallback(async () => {
    await loadUserTheme();
  }, [loadUserTheme]);

  // 1) Initial load based on persisted auth
  // 2) React to login/logout/user-switch via a custom event from AuthContext
  useEffect(() => {
    logger.log('[ThemeContext] Initializing theme system');
    loadUserTheme();

    const handleAuthChanged = () => {
      logger.log('[ThemeContext] auth-changed event received, reloading theme');
      logger.log('ThemeContext: auth-changed event received, reloading theme');
      loadUserTheme();
    };

    window.addEventListener('auth-changed', handleAuthChanged);
    return () => {
      window.removeEventListener('auth-changed', handleAuthChanged);
    };
  }, [loadUserTheme]);

  // Apply theme after loading to avoid flicker and avoid applying defaults over user theme
  useEffect(() => {
    logger.log('[ThemeContext] Apply theme effect triggered. loaded:', loaded, 'currentTheme:', currentTheme);
    if (loaded) {
      applyTheme(currentTheme);
    }
  }, [currentTheme, customThemes, loaded, applyTheme]);

  // Light/dark switches (including the OS flipping while on 'system') change which
  // accent shades pass contrast, so retune the accents whenever the mode changes.
  useEffect(() => {
    if (!loaded) return;
    applyTheme(currentTheme);
    if (themeMode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme(currentTheme);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeMode, loaded, currentTheme, applyTheme]);

  // Persist theme changes per user (only when logged in & loaded)
  useEffect(() => {
    if (!loaded) return;
    
    // Always save to localStorage for instant access
    localStorage.setItem('currentTheme', currentTheme);
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
    logger.log('[ThemeContext] Saved theme to localStorage:', currentTheme);
    
    const username = getCurrentUser();
    if (!username) return;

    const saveTheme = async () => {
      try {
        await writeUserColorConfig(username, {
          theme: currentTheme,
          customThemes,
        });
        logger.log('Color config saved for', username);
      } catch (error) {
        logger.error('ERROR: Failed to save color config:', error);
      }
    };

    const timeoutId = setTimeout(saveTheme, 500);
    return () => clearTimeout(timeoutId);
  }, [currentTheme, customThemes, loaded]);

  const setTheme = useCallback((theme: ThemeType) => {
    setCurrentTheme(theme);
  }, []);

  const updateCustomTheme = useCallback((
    slot: 'custom1' | 'custom2' | 'custom3' | 'custom4',
    primaryColor: string,
    name: string
  ) => {
    const variants = generateColorVariants(primaryColor);
    const accentVariants = generateColorVariants(primaryColor);
    const newTheme: Theme = {
      name,
      primaryColor,
      primaryLight: variants.light,
      primaryDark: variants.dark,
      secondaryColor: primaryColor,
      secondaryLight: variants.light,
      secondaryDark: variants.dark,
      accentColor: accentVariants.light,
      accentLight: accentVariants.light,
      isCustom: true,
    };
    setCustomThemes(prev => ({
      ...prev,
      [slot]: newTheme,
    }));
    if (currentTheme === slot) {
      setTimeout(() => applyTheme(slot), 0);
    }
  }, [currentTheme, applyTheme]);

  const resetCustomTheme = useCallback((slot: 'custom1' | 'custom2' | 'custom3' | 'custom4') => {
    const slotNumber = slot.replace('custom', '');
    const defaultTheme = defaultCustomTheme('My Theme ' + slotNumber);
    setCustomThemes(prev => ({
      ...prev,
      [slot]: defaultTheme,
    }));
    if (currentTheme === slot) {
      setCurrentTheme('cyan');
      applyTheme('cyan');
    }
  }, [currentTheme, applyTheme]);

  const value = useMemo(
    () => ({
      currentTheme,
      setTheme,
      customThemes,
      updateCustomTheme,
      resetCustomTheme,
      getAllThemes,
      refreshThemes,
      themeMode,
      setThemeMode,
    }),
    [currentTheme, setTheme, customThemes, updateCustomTheme, resetCustomTheme, getAllThemes, refreshThemes, themeMode, setThemeMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
