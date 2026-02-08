import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { ThemeType, Theme, presetThemes, generateColorVariants } from '../types/theme';
import { readUserColorConfig, writeUserColorConfig } from '../utils/colorConfigManager';
import { logger } from '../utils/logger';

interface ThemeContextType {
  currentTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  customThemes: Record<string, Theme>;
  updateCustomTheme: (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4', primaryColor: string, name: string) => void;
  resetCustomTheme: (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4') => void;
  getAllThemes: () => Record<string, Theme>;
  refreshThemes: () => Promise<void>;
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

      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
          const r = parseInt(result[1], 16);
          const g = parseInt(result[2], 16);
          const b = parseInt(result[3], 16);
          return `${r}, ${g}, ${b}`;
        }
        return '0, 188, 212';
      };

      root.style.setProperty('--primary-color', theme.primaryColor);
      root.style.setProperty('--primary-light', theme.primaryLight);
      root.style.setProperty('--primary-dark', theme.primaryDark);
      root.style.setProperty('--secondary-color', theme.secondaryColor);
      root.style.setProperty('--secondary-light', theme.secondaryLight);
      root.style.setProperty('--secondary-dark', theme.secondaryDark);
      root.style.setProperty('--accent-color', theme.accentColor);
      root.style.setProperty('--accent-light', theme.accentLight);
      root.style.setProperty('--primary-color-rgb', hexToRgb(theme.primaryColor));

      logger.log('Applied theme:', themeKey, theme);
    },
    [customThemes]
  );

  // Core loader: read config for current user and update state
  const loadUserTheme = useCallback(async () => {
    const username = getCurrentUser();
    if (!username) {
      // Logged out: don't touch existing CSS so login screen uses defaults
      logger.log('ThemeContext: no authenticated user, leaving default CSS theme');
      setLoaded(true);
      return;
    }

    setLoaded(false);

    try {
      logger.log('ThemeContext: loading theme for user:', username);
      const config = await readUserColorConfig(username);
      if (config && config.customThemes && Object.keys(config.customThemes).length > 0) {
        // Use exactly what is in this user's cfg file
        setCustomThemes(config.customThemes as Record<string, Theme>);
        setCurrentTheme((config.theme as ThemeType) || 'cyan');
      } else {
        // First time for this user: start from defaults (but ONLY for this user)
        setCustomThemes({
          custom1: defaultCustomTheme('My Theme 1'),
          custom2: defaultCustomTheme('My Theme 2'),
          custom3: defaultCustomTheme('My Theme 3'),
          custom4: defaultCustomTheme('My Theme 4'),
        });
        setCurrentTheme('cyan');
      }
    } catch (error) {
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
    loadUserTheme();

    const handleAuthChanged = () => {
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
    if (loaded) {
      applyTheme(currentTheme);
    }
  }, [currentTheme, customThemes, loaded, applyTheme]);

  // Persist theme changes per user (only when logged in & loaded)
  useEffect(() => {
    if (!loaded) return;
    const username = getCurrentUser();
    if (!username) return;

    const saveTheme = async () => {
      try {
        await writeUserColorConfig(username, {
          theme: currentTheme,
          customThemes,
        });
        logger.log('✅ Color config saved for', username);
      } catch (error) {
        logger.error('❌ Failed to save color config:', error);
      }
    };

    const timeoutId = setTimeout(saveTheme, 500);
    return () => clearTimeout(timeoutId);
  }, [currentTheme, customThemes, loaded]);

  const setTheme = (theme: ThemeType) => {
    setCurrentTheme(theme);
  };

  const updateCustomTheme = (
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
  };

  const resetCustomTheme = (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4') => {
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
  };

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        setTheme,
        customThemes,
        updateCustomTheme,
        resetCustomTheme,
        getAllThemes,
        refreshThemes,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
