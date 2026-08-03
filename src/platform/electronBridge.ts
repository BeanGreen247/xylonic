import type { PlatformBridge } from './bridge';

const e = () => (window as any).electron;

export const electronBridge: PlatformBridge = {
  isElectron: true,
  isCapacitor: false,
  isCacheAvailable: true,

  readColorConfig: (u) => e().readColorConfig(u),
  writeColorConfig: (u, c) => e().writeColorConfig(u, c),

  getCacheDir: () => e().getCacheDir(),
  readCacheIndex: () => e().readCacheIndex(),
  writeCacheIndex: (d) => e().writeCacheIndex(d),
  readUserCacheIndex: (uid) => e().readUserCacheIndex(uid),
  writeUserCacheIndex: (uid, d) => e().writeUserCacheIndex(uid, d),
  readUserMetadata: (uid) => e().readUserMetadata(uid),
  writeUserMetadata: (uid, d) => e().writeUserMetadata(uid, d),
  readAudioRegistry: () => e().readAudioRegistry(),
  writeAudioRegistry: (d) => e().writeAudioRegistry(d),
  saveAudioFile: (buf, hash, ext) => e().saveAudioFile(buf, hash, ext),
  saveCoverArtFile: (buf, hash, ext) => e().saveCoverArtFile(buf, hash, ext),
  deleteAudioDir: (hash) => e().deleteAudioDir(hash),
  getAudioFilePath: (hash, fn) => e().getAudioFilePath(hash, fn),
  readCachedImage: (p) => e().readCachedImage(p),
  deleteCachedFile: (p) => e().deleteCachedFile(p),
  clearCacheDir: () => e().clearCacheDir(),
  getCacheStats: () => e().getCacheStats(),
  findSiblingArt: (hash) => e().findSiblingArt(hash),
  extractEmbeddedArt: (hash) => e().extractEmbeddedArt(hash),
  migrateFileToHashStorage: (old, hash, fn) => e().migrateFileToHashStorage(old, hash, fn),

  safeStorageAvailable: () => e().safeStorageAvailable(),
  encryptCredential: (p) => e().encryptCredential(p),
  decryptCredential: (enc) => e().decryptCredential(enc),

  writeLog: (params) => e().writeLog(params),
  getLogPath: () => e().getLogPath(),
  getLoggingEnabled: () => e().getLoggingEnabled(),
  setLoggingEnabled: (en) => e().setLoggingEnabled(en),
  openLogFolder: () => e().openLogFolder(),

  async startMediaService() {},
  async stopMediaService()  {},
  async updateMediaMetadata(_t, _ar, _al, _u) {},
  async updateMediaPlaybackState(_p, _pos, _dur) {},
  async updateMediaNotificationState(_liked, _repeatMode) {},
  async preloadNextArtwork(_url) {},
  onMediaControl(_cb) { return () => {}; },

  showDownloadNotification: (opts) => e().setDownloadProgress(opts),
  hideDownloadNotification: () => e().clearDownloadProgress(),
  setDownloadActive: (active) => e().setDownloadActive(active),

  getSystemStats: () => e().getSystemStats(),
  setPowerSaverPriority: (en) => e().setPowerSaverPriority(en),
  setPerformancePriority: () => e().setPerformancePriority(),
  toggleMiniPlayer: () => e().toggleMiniPlayer(),
  isMiniPlayer: () => e().isMiniPlayer(),
  requestPlayerState: () => e().requestPlayerState(),
  sendPlayerState: (s) => e().sendPlayerState(s),
  onPlayerStateChanged: (cb) => e().onPlayerStateChanged(cb),
  sendPlayerControl: (a, d) => e().sendPlayerControl(a, d),
  onPlayerControlAction: (cb) => e().onPlayerControlAction(cb),
  onCacheRebuildTrigger: (cb) => e().onCacheRebuildTrigger(cb),
};
