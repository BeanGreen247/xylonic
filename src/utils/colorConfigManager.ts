import { logger } from './logger';
import { parseCfg, stringifyCfg } from './cfgParser';
import { getBridge } from '../platform/bridge';

interface UserColorConfig {
  theme: string;
  customThemes: Record<string, any>;
}

export const readUserColorConfig = async (username: string): Promise<UserColorConfig | null> => {
  try {
    if (!username) return null;

    const bridge = getBridge();
    const cfgContent = await bridge.readColorConfig(username);

    if (cfgContent) {
      const parsed = parseCfg(cfgContent);
      return parsed[username] || null;
    }

    return null;
  } catch (error) {
    logger.error('Failed to read color config:', error);
    return null;
  }
};

export const writeUserColorConfig = async (username: string, config: UserColorConfig): Promise<void> => {
  try {
    if (!username) return;

    const bridge = getBridge();
    const cfgContent = stringifyCfg({ [username]: config });
    await bridge.writeColorConfig(username, cfgContent);
  } catch (error) {
    logger.error('Failed to write color config:', error);
  }
};
