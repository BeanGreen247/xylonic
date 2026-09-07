// settings.cfg + per-user color-config file handling, and its 6 IPC handlers.
// Extracted from public/electron.js (WS-ARCH). electron.js keeps ownership of the
// path helpers (shared with the cache-location code) and injects them.
const path = require('path');
const fs = require('fs');

function registerSettingsIpc({ ipcMain, getSettingsFilePath, getSettingsDir }) {
  const getColorConfigPath = (username) =>
    username ? path.join(getSettingsDir(), `colors_${username}.cfg`) : null;

  // ONLY CREATE IF MISSING — never modify an existing settings file.
  function ensureSettingsFile() {
    try {
      const settingsFile = getSettingsFilePath();
      const dir = path.dirname(settingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('Created settings directory:', dir);
      }
      if (!fs.existsSync(settingsFile)) {
        fs.writeFileSync(
          settingsFile,
          '# Xylonic Settings File\n# Generated automatically - edit with care\n\n',
          'utf8',
        );
        console.log('Created new settings file:', settingsFile);
      } else {
        console.log('Settings file already exists (not modifying):', settingsFile);
      }
    } catch (error) {
      console.error('Failed to ensure settings file:', error);
    }
  }

  function ensureSettingsDir() {
    try {
      const dir = getSettingsDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('Created color_settings directory:', dir);
      } else {
        console.log('color_settings directory exists:', dir);
      }
    } catch (error) {
      console.error('Failed to create color_settings directory:', error);
    }
  }

  function ensureColorConfig(username) {
    if (!username) return;
    try {
      ensureSettingsDir();
      const colorFile = getColorConfigPath(username);
      if (!colorFile) return;
      if (!fs.existsSync(colorFile)) {
        fs.writeFileSync(
          colorFile,
          `# Xylonic Color Config for ${username}\n# Generated automatically - edit with care\n\n`,
          'utf8',
        );
        console.log(`Created color config: color_settings/colors_${username}.cfg`);
      }
    } catch (error) {
      console.error(`Failed to ensure color config for ${username}:`, error);
    }
  }

  ipcMain.handle('get-settings-path', () => getSettingsFilePath());

  ipcMain.handle('read-settings', () => {
    try {
      const settingsFile = getSettingsFilePath();
      if (fs.existsSync(settingsFile)) {
        const data = fs.readFileSync(settingsFile, 'utf8');
        console.log('Read settings file, length:', data.length);
        return data; // raw CFG string
      }
      return '';
    } catch (error) {
      console.error('Failed to read settings:', error);
      return '';
    }
  });

  ipcMain.handle('write-settings', (_event, settingsContent) => {
    try {
      fs.writeFileSync(getSettingsFilePath(), settingsContent, 'utf8');
      console.log('Wrote settings file');
      return true;
    } catch (error) {
      console.error('Failed to write settings:', error);
      return false;
    }
  });

  ipcMain.handle('get-color-config-path', (_event, username) => getColorConfigPath(username));

  ipcMain.handle('read-color-config', (_event, username) => {
    try {
      const colorFile = getColorConfigPath(username);
      if (!colorFile) return '';
      ensureColorConfig(username);
      if (fs.existsSync(colorFile)) {
        const data = fs.readFileSync(colorFile, 'utf8');
        console.log(`Read color config for ${username}, length:`, data.length);
        return data;
      }
      return '';
    } catch (error) {
      console.error(`Failed to read color config for ${username}:`, error);
      return '';
    }
  });

  ipcMain.handle('write-color-config', (_event, username, configContent) => {
    try {
      const colorFile = getColorConfigPath(username);
      if (!colorFile) return false;
      fs.writeFileSync(colorFile, configContent, 'utf8');
      console.log(`Wrote color config for ${username}`);
      return true;
    } catch (error) {
      console.error(`Failed to write color config for ${username}:`, error);
      return false;
    }
  });

  return { ensureSettingsDir, ensureSettingsFile, ensureColorConfig, getColorConfigPath };
}

module.exports = { registerSettingsIpc };
