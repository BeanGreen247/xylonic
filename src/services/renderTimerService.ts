const STORAGE_KEY = 'xylonic_render_timer';

export function isEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setEnabled(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(on));
  window.dispatchEvent(new Event('renderTimerChanged'));
}

// ── Event-loop lag → CPU busyness fallback (used when bridge stats unavailable) ─
const LAG_INTERVAL_MS = 500;
let _cpuLagPct   = 0;
let _lastLagTick = 0;
let _lagTimer: ReturnType<typeof setInterval> | null = null;

function _startLagTimer() {
  if (_lagTimer !== null) return;
  _lastLagTick = performance.now();
  _lagTimer = setInterval(() => {
    const now   = performance.now();
    const lag   = (now - _lastLagTick) - LAG_INTERVAL_MS;
    _cpuLagPct  = Math.min(100, Math.max(0, Math.round((lag / LAG_INTERVAL_MS) * 100)));
    _lastLagTick = now;
  }, LAG_INTERVAL_MS);
}

function _stopLagTimer() {
  if (_lagTimer === null) return;
  clearInterval(_lagTimer);
  _lagTimer  = null;
  _cpuLagPct = 0;
}

export function getCpuLagPct(): number { return _cpuLagPct; }

// ── JS heap (Chromium only) ───────────────────────────────────────────────────
export interface WebMemoryStats {
  usedBytes:  number;
  totalBytes: number;
  limitBytes: number;
}

export function getWebMemoryStats(): WebMemoryStats | null {
  const mem = (performance as any).memory;
  if (!mem) return null;
  return {
    usedBytes:  mem.usedJSHeapSize,
    totalBytes: mem.totalJSHeapSize,
    limitBytes: mem.jsHeapSizeLimit,
  };
}

export function getCoreCount(): number {
  return navigator.hardwareConcurrency || 0;
}

// ── FPS counter via RAF ───────────────────────────────────────────────────────
const FPS_WINDOW = 6;
const _frameTimes: number[] = [];
let _fps   = 0;
let _rafId: number | null = null;

function _rafFpsLoop(ts: number) {
  _frameTimes.push(ts);
  if (_frameTimes.length > FPS_WINDOW) _frameTimes.shift();
  if (_frameTimes.length >= 2) {
    const span = _frameTimes[_frameTimes.length - 1] - _frameTimes[0];
    if (span > 0) _fps = Math.round((_frameTimes.length - 1) / (span / 1000));
  }
  _rafId = requestAnimationFrame(_rafFpsLoop);
}

/** Start the FPS-measuring RAF loop and lag timer. Call when the HUD becomes visible. */
export function startFpsLoop(): void {
  if (_rafId !== null) return;
  _startLagTimer();
  _rafId = requestAnimationFrame(_rafFpsLoop);
}

/** Stop the FPS loop and lag timer. Call when the HUD is hidden to eliminate background overhead. */
export function stopFpsLoop(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _stopLagTimer();
  _frameTimes.length = 0;
  _fps = 0;
}

export function getFPS(): number { return _fps; }

/** Mean interval between frames in ms (one decimal place). */
export function getFrameIntervalMs(): number {
  if (_frameTimes.length < 2) return 0;
  const span = _frameTimes[_frameTimes.length - 1] - _frameTimes[0];
  return Math.round((span / (_frameTimes.length - 1)) * 10) / 10;
}

/** Max deviation of any single frame interval from the mean, in ms. */
export function getFrameJitter(): number {
  if (_frameTimes.length < 3) return 0;
  const avg = getFrameIntervalMs();
  let maxDev = 0;
  for (let i = 1; i < _frameTimes.length; i++) {
    const interval = _frameTimes[i] - _frameTimes[i - 1];
    const dev = Math.abs(interval - avg);
    if (dev > maxDev) maxDev = dev;
  }
  return Math.round(maxDev * 10) / 10;
}

/** Clear the sliding window so the display settles immediately after a rate change. */
export function resetFpsWindow(): void {
  _frameTimes.length = 0;
  _fps = 0;
}
