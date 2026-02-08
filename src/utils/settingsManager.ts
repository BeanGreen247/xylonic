import { logger } from './logger';
import { parseCfg, stringifyCfg } from './cfgParser';

// Use Electron's remote or IPC if available, otherwise use browser localStorage as fallback
const isElectron = () => {
  return !!(window && (window as any).electron);
};

interface UserSettings {
  theme: string;
  customThemes: Record<string, any>;
}

interface AllSettings {
  [username: string]: UserSettings;
}

const SETTINGS_KEY = 'xylonic_settings';

// Get settings file path (for Electron)
const getSettingsPath = async (): Promise<string | null> => {
  try {
    if (isElectron()) {
      const electron = (window as any).electron;
      if (electron && electron.getSettingsPath) {
        return await electron.getSettingsPath();
      }
    }
  } catch (error) {
    logger.error('Failed to get settings path:', error);
  }
  return null;
};

// Read all settings from file or localStorage
export const readSettings = async (): Promise<AllSettings> => {
  try {
    const settingsPath = await getSettingsPath();
    
    console.log('=== READ SETTINGS START ===');
    console.log('Settings path:', settingsPath);
    console.log('Is Electron?', isElectron());
    
    if (settingsPath && isElectron()) {
      const electron = (window as any).electron;
      console.log('Electron object exists?', !!electron);
      console.log('readSettings function exists?', !!electron?.readSettings);
      
      const cfgContent = await electron.readSettings();
      console.log('CFG content length:', cfgContent?.length || 0);
      console.log('CFG content preview:', cfgContent?.substring(0, 200));
      
      if (cfgContent) {
        const parsed = parseCfg(cfgContent);
        console.log('Parsed settings:', JSON.stringify(parsed, null, 2));
        console.log('=== READ SETTINGS END ===');
        return parsed;
      }
      return {};
    } else {
      // Fallback to localStorage
      console.log('Using localStorage fallback');
      const data = localStorage.getItem(SETTINGS_KEY);
      logger.log('Read settings from localStorage');
      return data ? JSON.parse(data) : {};
    }
  } catch (error) {
    console.error('=== READ SETTINGS ERROR ===', error);
    logger.error('Failed to read settings:', error);
    return {};
  }
};

// Write all settings to file or localStorage
export const writeSettings = async (settings: AllSettings): Promise<void> => {
  try {
    const settingsPath = await getSettingsPath();
    
    if (settingsPath && isElectron()) {
      const electron = (window as any).electron;
      const cfgContent = stringifyCfg(settings);
      logger.log('Writing CFG content, length:', cfgContent.length);
      await electron.writeSettings(cfgContent);
      logger.log('Settings saved to file:', settingsPath);
    } else {
      // Fallback to localStorage (still use JSON here)
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      logger.log('Settings saved to localStorage');
    }
  } catch (error) {
    logger.error('Failed to write settings:', error);
  }
};

// Get settings for specific user
export const getUserSettings = async (username: string): Promise<UserSettings | null> => {
  const allSettings = await readSettings();
  return allSettings[username] || null;
};

// Save settings for specific user
export const saveUserSettings = async (username: string, userSettings: UserSettings): Promise<void> => {
  const allSettings = await readSettings();
  allSettings[username] = userSettings;
  await writeSettings(allSettings);
};

// Delete settings for specific user
export const deleteUserSettings = async (username: string): Promise<void> => {
  const allSettings = await readSettings();
  delete allSettings[username];
  await writeSettings(allSettings);
};
