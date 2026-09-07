// File logging for the Electron main process + its 5 IPC handlers.
// Extracted from public/electron.js (WS-ARCH). electron.js calls
// registerLoggingIpc(...) early (it overrides console.* as a side effect), then
// _logging.initLogging() from app.whenReady().
const path = require('path');
const fs = require('fs');

function registerLoggingIpc({ ipcMain, app, shell, version, buildSuffix = '', isDev = false }) {
  let loggingEnabled = false; // disabled by default
  const maxLogSize = 5 * 1024 * 1024; // 5 MB
  const getLogFilePath = () => path.join(app.getPath('userData'), 'app.log');
  const getSettingsFilePath = () => path.join(app.getPath('userData'), 'settings.cfg');

  // originals captured before we override console.*
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  function writeLog(message, level = 'INFO') {
    if (!loggingEnabled) return;
    try {
      const logLine = `[${new Date().toISOString()}] [${level}] ${message}\n`;
      fs.appendFileSync(getLogFilePath(), logLine, 'utf8');
      if (level === 'ERROR') origError(logLine.trim());
      else if (level === 'WARN') origWarn(logLine.trim());
      else origLog(logLine.trim());
    } catch (error) {
      origError('Failed to write to log file:', error);
    }
  }

  function checkLoggingPreference() {
    try {
      const settingsFile = getSettingsFilePath();
      if (fs.existsSync(settingsFile)) {
        const match = fs.readFileSync(settingsFile, 'utf8').match(/^logging_enabled=(true|false)$/m);
        if (match) {
          loggingEnabled = match[1] === 'true';
          origLog('Logging', loggingEnabled ? 'enabled' : 'disabled');
          return;
        }
      }
    } catch {
      /* keep logging disabled */
    }
    loggingEnabled = false;
  }

  function initializeLogFile() {
    if (!loggingEnabled) return;
    try {
      const logFile = getLogFilePath();
      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > maxLogSize) {
          const backupFile = logFile.replace('.log', '.old.log');
          if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
          fs.renameSync(logFile, backupFile);
          origLog('Rotated log file to:', backupFile);
        }
      }

      writeLog('='.repeat(80));
      writeLog(`Xylonic v${version}${buildSuffix} starting on ${new Date().toISOString()}`);
      writeLog(`Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
      writeLog(`Log file: ${logFile}`);
      writeLog(`User data: ${app.getPath('userData')}`);
      writeLog('='.repeat(80));
    } catch (error) {
      origError('Failed to initialize log file:', error);
    }
  }

  // Route console.* through the file logger (no-op unless logging is enabled).
  const fmt = (args) =>
    args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  console.log = (...args) => { if (loggingEnabled) writeLog(fmt(args), 'INFO'); };
  console.error = (...args) => { if (loggingEnabled) writeLog(fmt(args), 'ERROR'); };
  console.warn = (...args) => { if (loggingEnabled) writeLog(fmt(args), 'WARN'); };

  ipcMain.handle('write-log', async (_event, { message, level }) => {
    writeLog(message, level || 'INFO');
  });
  ipcMain.handle('get-log-path', () => getLogFilePath());
  ipcMain.handle('get-logging-enabled', () => loggingEnabled);

  ipcMain.handle('set-logging-enabled', (_event, enabled) => {
    loggingEnabled = enabled;
    try {
      const settingsFile = getSettingsFilePath();
      let content = fs.existsSync(settingsFile)
        ? fs.readFileSync(settingsFile, 'utf8')
        : '# Xylonic Settings File\n# Generated automatically - edit with care\n\n';
      content = content.includes('logging_enabled=')
        ? content.replace(/^logging_enabled=(true|false)$/m, `logging_enabled=${enabled}`)
        : content + `\nlogging_enabled=${enabled}\n`;
      fs.writeFileSync(settingsFile, content, 'utf8');
      if (enabled) initializeLogFile();
      return true;
    } catch (error) {
      origError('Failed to save logging preference:', error);
      return false;
    }
  });

  ipcMain.handle('open-log-folder', async () => {
    try {
      shell.showItemInFolder(getLogFilePath());
      return true;
    } catch (error) {
      origError('Failed to open log folder:', error);
      return false;
    }
  });

  return {
    initLogging() {
      checkLoggingPreference();
      initializeLogFile();
    },
    writeLog,
    isLoggingEnabled: () => loggingEnabled,
  };
}

module.exports = { registerLoggingIpc };
