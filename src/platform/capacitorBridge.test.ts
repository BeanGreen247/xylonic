import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const prefs = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(async () => {}) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: prefs }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {},
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ addListener: vi.fn(async () => ({ remove: vi.fn() })) }),
}));

import { capacitorBridge } from './capacitorBridge';

beforeEach(() => {
  vi.clearAllMocks();
  prefs.get.mockResolvedValue({ value: null });
});

describe('capacitorBridge contract', () => {
  it('advertises Capacitor capabilities', () => {
    expect(capacitorBridge.isElectron).toBe(false);
    expect(capacitorBridge.isCapacitor).toBe(true);
    expect(capacitorBridge.isCacheAvailable).toBe(true);
  });

  it('reads colour config from a namespaced Preferences key, empty string when absent', async () => {
    expect(await capacitorBridge.readColorConfig('kenny')).toBe('');
    expect(prefs.get).toHaveBeenCalledWith({ key: 'colors_kenny' });

    prefs.get.mockResolvedValue({ value: '[kenny]\ntheme=cyan' });
    expect(await capacitorBridge.readColorConfig('kenny')).toBe('[kenny]\ntheme=cyan');
  });

  it('writes colour config to the namespaced key and returns true', async () => {
    expect(await capacitorBridge.writeColorConfig('bob', 'cfg')).toBe(true);
    expect(prefs.set).toHaveBeenCalledWith({ key: 'colors_bob', value: 'cfg' });
  });

  it('secure storage is unavailable on Capacitor (no safeStorage)', async () => {
    expect(await capacitorBridge.safeStorageAvailable()).toBe(false);
    expect(await capacitorBridge.encryptCredential('p')).toBeNull();
    expect(await capacitorBridge.decryptCredential('e')).toBeNull();
  });

  it('mini-player / multi-window ops are inert (Electron-only feature)', async () => {
    expect(await capacitorBridge.toggleMiniPlayer()).toBe(false);
    expect(await capacitorBridge.isMiniPlayer()).toBe(false);
    expect(await capacitorBridge.requestPlayerState()).toBeNull();
    expect(typeof capacitorBridge.onPlayerStateChanged(() => {})).toBe('function');
  });

  it('getSystemStats returns null (no per-process stats on mobile)', async () => {
    expect(await capacitorBridge.getSystemStats()).toBeNull();
  });
});
