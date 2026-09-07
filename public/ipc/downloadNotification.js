// Desktop download progress surface: dock/taskbar progress bar, a Tray icon +
// tooltip, and the macOS dock badge. Plus `set-download-active`, which drives the
// power-save blocker in electron.js. Extracted from public/electron.js (WS-ARCH).
const path = require('path');

function registerDownloadNotificationIpc({
  ipcMain,
  app,
  Tray,
  nativeImage,
  getMainWindow,
  onDownloadActiveChange,
}) {
  let downloadTray = null;

  ipcMain.handle('set-download-active', (_event, active) => {
    onDownloadActiveChange(!!active);
  });

  ipcMain.handle(
    'set-download-progress',
    (_event, { progress = 0, indeterminate = false, title = '', text = '' } = {}) => {
      const win = getMainWindow();
      if (!win) return;
      try {
        win.setProgressBar(indeterminate ? 2 : Math.min(Math.max(progress, 0), 100) / 100, {
          mode: indeterminate ? 'indeterminate' : 'normal',
        });
      } catch {
        /* setProgressBar unsupported on this platform build */
      }

      if (!downloadTray) {
        try {
          downloadTray = new Tray(
            nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon-tray.png')),
          );
        } catch {
          downloadTray = null;
        }
      }
      if (downloadTray) {
        const pct = indeterminate ? '…' : `${Math.round(progress)}%`;
        downloadTray.setToolTip(`${title || 'Downloading'}${text ? `: ${text}` : ''} (${pct})`);
      }

      if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge(indeterminate ? '…' : `${Math.round(progress)}%`);
      }
    },
  );

  ipcMain.handle('clear-download-progress', () => {
    const win = getMainWindow();
    if (win) {
      try {
        win.setProgressBar(-1);
      } catch {
        /* ignore */
      }
    }
    if (downloadTray) {
      downloadTray.destroy();
      downloadTray = null;
    }
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge('');
    }
  });
}

module.exports = { registerDownloadNotificationIpc };
