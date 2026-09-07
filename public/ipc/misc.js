// Small one-off main-process IPC: OS platform, Linux firewall probe, legacy
// song-save, download dir. Extracted from public/electron.js (WS-ARCH).
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function registerMiscIpc({ ipcMain, app }) {
  ipcMain.handle('get-os-platform', () => process.platform);

  // Which Linux firewall front-ends are installed (for the firewall setup dialog).
  ipcMain.handle('detect-linux-firewall', async () => {
    if (process.platform !== 'linux') return [];
    const found = [];
    const probe = (cmd) => {
      try {
        execSync(cmd, { timeout: 2000, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    };
    if (probe('which ufw')) found.push('ufw');
    if (probe('which firewall-cmd')) found.push('firewalld');
    if (probe('which nft')) found.push('nftables');
    if (probe('which iptables')) found.push('iptables');
    return found;
  });

  // Legacy "save to ~/Music/SubsonicDownloads" path (pre offline-cache).
  ipcMain.handle('save-song', async (_event, { buffer, filePath }) => {
    try {
      const fullPath = path.join(app.getPath('music'), 'SubsonicDownloads', filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);
      console.log(`Saved: ${fullPath}`);
      return { success: true, path: fullPath };
    } catch (error) {
      console.error('Failed to save song:', error);
      throw error;
    }
  });

  ipcMain.handle('get-download-dir', async () =>
    path.join(app.getPath('music'), 'SubsonicDownloads'),
  );
}

module.exports = { registerMiscIpc };
