// Secure credential storage — encrypt/decrypt via Electron safeStorage.
// Extracted from public/electron.js (WS-ARCH). 3 IPC handlers, no other deps.

function registerCredentialsIpc({ ipcMain, safeStorage }) {
  ipcMain.handle('safe-storage-available', () => safeStorage.isEncryptionAvailable());

  ipcMain.handle('safe-storage-encrypt', (_event, plaintext) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('Encryption not available - storing credentials in memory only');
        return null;
      }
      return safeStorage.encryptString(plaintext).toString('base64');
    } catch (error) {
      console.error('Failed to encrypt credential:', error);
      return null;
    }
  });

  ipcMain.handle('safe-storage-decrypt', (_event, encrypted) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('Encryption not available - cannot decrypt');
        return null;
      }
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (error) {
      console.error('Failed to decrypt credential:', error);
      return null;
    }
  });
}

module.exports = { registerCredentialsIpc };
