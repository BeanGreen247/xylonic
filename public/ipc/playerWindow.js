// Mini-player window toggle, player-state sync between windows, and MPRIS cover
// art resolution (Linux). Extracted from public/electron.js (WS-ARCH) — this is
// the last IPC domain to come out; it couples to both BrowserWindows,
// `lastPlayerState`, the power-save blocker and the `mpris` module, all injected.
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

function registerPlayerWindowIpc({
  ipcMain,
  mpris, // may be null (non-Linux)
  pathToFileUrl,
  getMainWindow,
  getMiniPlayerWindow,
  createMiniPlayer,
  getLastPlayerState,
  setLastPlayerState,
  onPlayerStateChange, // drives the power-save blocker in electron.js
  getCacheBasePath,
}) {
  const MPRIS_ART_CACHE_MAX = 10;
  const artMem = new Map(); // coverArtId -> file:// URL (LRU)
  const artPending = new Map(); // coverArtId -> Promise (fetch dedup)

  const artCacheGet = (id) => {
    if (!artMem.has(id)) return undefined;
    const u = artMem.get(id);
    artMem.delete(id);
    artMem.set(id, u); // move to MRU
    return u;
  };
  const artCacheSet = (id, url) => {
    artMem.delete(id);
    if (artMem.size >= MPRIS_ART_CACHE_MAX) artMem.delete(artMem.keys().next().value);
    artMem.set(id, url);
  };

  // Deterministic temp path per coverArtId — written once, reused across sessions.
  const artTempPath = (id) =>
    path.join(os.tmpdir(), `xylonic_mpris_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`);

  // Layered cover-art → file:// URL resolution: LRU mem → offline registry →
  // existing temp file → single network fetch+write. Concurrent calls for the
  // same id share one Promise.
  function resolveMprisArt(coverArtId, httpUrl) {
    const hit = artCacheGet(coverArtId);
    if (hit !== undefined) return Promise.resolve(hit);
    if (artPending.has(coverArtId)) return artPending.get(coverArtId);

    const promise = (async () => {
      try {
        const cacheDir = getCacheBasePath();
        const registryFile = path.join(cacheDir, 'registry.json');
        if (fs.existsSync(registryFile)) {
          const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
          const hash = registry.coverArtIdMap?.[coverArtId];
          const entry = hash && registry.coverArtFiles?.[hash];
          if (entry?.filePath) {
            const full = path.join(cacheDir, entry.filePath);
            if (fs.existsSync(full)) {
              const u = pathToFileUrl(full);
              artCacheSet(coverArtId, u);
              return u;
            }
          }
        }
      } catch {
        /* registry unreadable — continue */
      }

      const tmpPath = artTempPath(coverArtId);
      if (fs.existsSync(tmpPath)) {
        const u = pathToFileUrl(tmpPath);
        artCacheSet(coverArtId, u);
        return u;
      }

      if (!httpUrl) return null;
      return new Promise((resolve) => {
        try {
          const parsed = new URL(httpUrl);
          const transport = parsed.protocol === 'https:' ? https : http;
          const req = transport.get(httpUrl, { timeout: 8000 }, (res) => {
            if (res.statusCode !== 200) {
              res.resume();
              return resolve(null);
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              try {
                fs.writeFileSync(tmpPath, Buffer.concat(chunks));
                const u = pathToFileUrl(tmpPath);
                artCacheSet(coverArtId, u);
                console.log('[MPRIS] Art written:', tmpPath);
                resolve(u);
              } catch (e) {
                console.warn('[MPRIS] Art write failed:', e.message);
                resolve(null);
              }
            });
            res.on('error', (e) => {
              console.warn('[MPRIS] Art response error:', e.message);
              resolve(null);
            });
          });
          req.on('error', (e) => {
            console.warn('[MPRIS] Art request error:', e.message);
            resolve(null);
          });
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
        } catch (e) {
          console.warn('[MPRIS] Art fetch error:', e.message);
          resolve(null);
        }
      });
    })().finally(() => artPending.delete(coverArtId));

    artPending.set(coverArtId, promise);
    return promise;
  }

  ipcMain.handle('toggle-mini-player', () => {
    try {
      const mini = getMiniPlayerWindow();
      const main = getMainWindow();
      if (mini) {
        mini.close();
        if (main) {
          main.show();
          main.focus();
        }
        return false;
      }
      createMiniPlayer();
      if (main) main.hide();
      return true;
    } catch (error) {
      console.error('Failed to toggle mini player:', error);
      return false;
    }
  });

  ipcMain.handle('is-mini-player', (event) => event.sender === getMiniPlayerWindow()?.webContents);

  ipcMain.handle('request-player-state', () => {
    const state = getLastPlayerState();
    console.log('[Electron] request-player-state called, returning:', state);
    return state;
  });

  ipcMain.handle('player-state-update', async (_event, state) => {
    setLastPlayerState(state);
    onPlayerStateChange();

    const mini = getMiniPlayerWindow();
    if (mini && !mini.isDestroyed()) {
      mini.webContents.send('player-state-changed', state);
    }
    if (!mpris) return;

    const coverArtId = state.currentSong?.coverArt;
    if (!coverArtId) {
      mpris.updateMprisState({ ...state, coverArtUrl: null });
      return;
    }

    const cached = artCacheGet(coverArtId);
    if (cached !== undefined) {
      mpris.updateMprisState({ ...state, coverArtUrl: cached });
      return;
    }

    // Text metadata now; art follows once resolved.
    mpris.updateMprisState({ ...state, coverArtUrl: null });

    resolveMprisArt(coverArtId, state.coverArtUrl).then((fileUrl) => {
      const latest = getLastPlayerState();
      if (fileUrl && mpris && latest?.currentSong?.coverArt === coverArtId) {
        mpris.updateMprisState({ ...latest, coverArtUrl: fileUrl });
      }
    });
  });

  ipcMain.handle('player-control', (_event, action, data) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send('player-control-action', action, data);
    }
  });
}

module.exports = { registerPlayerWindowIpc };
