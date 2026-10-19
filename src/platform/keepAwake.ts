import { Capacitor, registerPlugin } from '@capacitor/core';

interface KeepAwakePlugin {
  setKeepScreenOn(opts: { enabled: boolean }): Promise<void>;
}
// Same native plugin as the orientation lock (ScreenOrientation); Capacitor shares one registration.
const Native = registerPlugin<KeepAwakePlugin>('ScreenOrientation');

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

/**
 * Keeps the screen on, so it neither dims, sleeps nor auto-locks, until the returned
 * function is called. Android sets the window's keep-screen-on flag; everywhere else
 * the Screen Wake Lock API is used (re-requested when the page becomes visible again,
 * because browsers drop the lock whenever it is hidden). Where neither exists it does
 * nothing, and the release function is still safe to call.
 */
export async function acquireKeepAwake(): Promise<() => void> {
  if (Capacitor.getPlatform() === 'android') {
    try { await Native.setKeepScreenOn({ enabled: true }); } catch { /* build without the method */ }
    return () => { void Native.setKeepScreenOn({ enabled: false }).catch(() => {}); };
  }
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock) return () => {};
  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;
  const request = async () => {
    try { sentinel = await wakeLock.request('screen'); } catch { /* denied (hidden tab, battery saver) */ }
  };
  const onVisible = () => { if (!released && document.visibilityState === 'visible') void request(); };
  await request();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => {});
  };
}
