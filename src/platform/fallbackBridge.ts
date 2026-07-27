import type { PlatformBridge } from './bridge';

/**
 * Used when running in a plain web browser (not Electron, not Android).
 * Cache operations are unavailable; everything else is a silent no-op.
 */
export const fallbackBridge: PlatformBridge = {
  isElectron: false,
  isCapacitor: false,
  isCacheAvailable: false,

  async readColorConfig(_u) { return ''; },
  async writeColorConfig(_u, _c) { return false; },

  async getCacheDir() { return ''; },
  async readCacheIndex() { return null; },
  async writeCacheIndex(_d) { return false; },
  async readUserCacheIndex(_uid) { return null; },
  async writeUserCacheIndex(_uid, _d) { return false; },
  async readUserMetadata(_uid) { return null; },
  async writeUserMetadata(_uid, _d) { return false; },
  async readAudioRegistry() { return null; },
  async writeAudioRegistry(_d) { return false; },
  async saveAudioFile(_b, _h, _e) { return { success: false, path: '' }; },
  async saveCoverArtFile(_b, _h, _e) { return { success: false, path: '' }; },
  async deleteAudioDir(_h) { return false; },
  async getAudioFilePath(_h, _fn) { return null; },
  async readCachedImage(_p) { return null; },
  async deleteCachedFile(_p) { return false; },
  async clearCacheDir() { return false; },
  async getCacheStats() { return { totalSize: 0, fileCount: 0 }; },
  async findSiblingArt(_h) { return null; },
  async extractEmbeddedArt(_h) { return null; },
  async migrateFileToHashStorage(_o, _h, _f) { return { success: false, error: 'not available' }; },

  async safeStorageAvailable() { return false; },
  async encryptCredential(_p) { return null; },
  async decryptCredential(_e) { return null; },

  async writeLog(_p) {},
  async getLogPath() { return ''; },
  async getLoggingEnabled() { return false; },
  async setLoggingEnabled(_e) { return false; },
  async openLogFolder() { return false; },

  async startMediaService() {},
  async stopMediaService()  {},
  async updateMediaMetadata(_t, _ar, _al, _u) {},
  async updateMediaPlaybackState(_p, _pos, _dur) {},
  async updateMediaNotificationState(_liked, _repeatMode) {},
  async preloadNextArtwork(_url) {},
  onMediaControl(_cb) { return () => {}; },

  async showDownloadNotification(_opts) {},
  async hideDownloadNotification() {},
  async setDownloadActive(_active) {},

  async getSystemStats() { return null; },
  async setPowerSaverPriority(_enabled: boolean) {},
  async setPerformancePriority() {},
  async toggleMiniPlayer() { return false; },
  async isMiniPlayer() { return false; },
  async requestPlayerState() { return null; },
  async sendPlayerState(_s) {},
  onPlayerStateChanged(_cb) { return () => {}; },
  async sendPlayerControl(_a, _d?) {},
  onPlayerControlAction(_cb) { return () => {}; },
  onCacheRebuildTrigger(_cb) { return () => {}; },
};
