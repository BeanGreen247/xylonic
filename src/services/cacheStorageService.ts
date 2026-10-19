import { Capacitor, registerPlugin } from '@capacitor/core';

export interface StorageVolume {
  id: string;
  label: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
  removable: boolean;
  selected: boolean;
}

export interface StorageInfo {
  volumes: StorageVolume[];
  cacheBytes: number;
  /** The chosen volume is currently missing (e.g. SD card removed): the cache is read from internal storage meanwhile. */
  storedUnavailable: boolean;
}

interface CacheStoragePlugin {
  getVolumes(): Promise<StorageInfo>;
  getCacheRoot(): Promise<{ path?: string }>;
  setLocation(opts: { path: string }): Promise<{ movedBytes?: number }>;
  openAppSettings(): Promise<void>;
  addListener(event: 'moveProgress', handler: (p: { copiedBytes: number; totalBytes: number }) => void): Promise<{ remove(): void }>;
}

const Native = registerPlugin<CacheStoragePlugin>('CacheStorage');

/** Choosing where the permanent cache lives is an Android-only feature (native storage volumes). */
export const isCacheLocationSupported = (): boolean => Capacitor.getPlatform() === 'android';

export async function getCacheRoot(): Promise<string> {
  if (!isCacheLocationSupported()) return '';
  try {
    return (await Native.getCacheRoot()).path ?? '';
  } catch {
    return '';
  }
}

export const getStorageInfo = (): Promise<StorageInfo> => Native.getVolumes();

/** Moves the cache to `path` (one of the volumes from getStorageInfo) and switches to it. */
export async function moveCacheTo(path: string, onProgress: (copied: number, total: number) => void): Promise<void> {
  const handle = await Native.addListener('moveProgress', p => onProgress(p.copiedBytes, p.totalBytes));
  try {
    await Native.setLocation({ path });
  } finally {
    handle.remove();
  }
}

export const openAppSettings = (): Promise<void> => Native.openAppSettings();
