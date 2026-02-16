import { logger } from './logger';
import { parseCfg, stringifyCfg } from './cfgParser';

interface UserColorConfig {
  theme: string;
  customThemes: Record<string, any>;
}

const isElectron = () => {
  return !!(window && (window as any).electron);
};

// Read color config for specific user
export const readUserColorConfig = async (username: string): Promise<UserColorConfig | null> => {
  try {
    if (!username) return null;
    
    console.log('📖 Reading color config for:', username);
    
    if (isElectron()) {
      const electron = (window as any).electron;
      const cfgContent = await electron.readColorConfig(username);
      
      if (cfgContent) {
        const parsed = parseCfg(cfgContent);
        console.log('Parsed color config:', parsed);
        return parsed[username] || null;
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to read color config:', error);
    return null;
  }
};

// Write color config for specific user
export const writeUserColorConfig = async (username: string, config: UserColorConfig): Promise<void> => {
  try {
    if (!username) return;
    
    console.log('[ColorConfig] Writing color config for:', username);
    
    if (isElectron()) {
      const electron = (window as any).electron;
      const cfgContent = stringifyCfg({ [username]: config });
      await electron.writeColorConfig(username, cfgContent);
      console.log('Color config saved');
    }
  } catch (error) {
    logger.error('Failed to write color config:', error);
  }
};
