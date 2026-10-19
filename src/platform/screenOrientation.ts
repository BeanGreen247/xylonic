import { Capacitor, registerPlugin } from '@capacitor/core';

export type OrientationMode = 'landscape' | 'landscape-primary' | 'landscape-secondary' | 'default';

interface ScreenOrientationPlugin {
  setMode(opts: { mode: OrientationMode }): Promise<void>;
}
const NativeOrientation = registerPlugin<ScreenOrientationPlugin>('ScreenOrientation');

type LockableOrientation = ScreenOrientation & {
  lock?: (type: string) => Promise<void>;
  unlock?: () => void;
};

/**
 * Requests an orientation. Resolves true when the platform honoured it, false
 * when it cannot (desktop, iOS WebView, browsers without the lock API) so the
 * caller can fall back to a CSS rotation.
 */
export async function setOrientation(mode: OrientationMode): Promise<boolean> {
  if (Capacitor.getPlatform() === 'android') {
    try {
      await NativeOrientation.setMode({ mode });
      return true;
    } catch {
      return false;
    }
  }
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  if (!orientation?.lock) return false;
  try {
    if (mode === 'default') { orientation.unlock?.(); return true; }
    await orientation.lock(mode);
    return true;
  } catch {
    return false;
  }
}

/** The landscape orientation the screen is in right now, or null in portrait/unknown. */
export function currentLandscape(): 'landscape-primary' | 'landscape-secondary' | null {
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  return type === 'landscape-primary' || type === 'landscape-secondary' ? type : null;
}
