import { setThrottleFps } from './rafThrottle';
import { resetFpsWindow } from './renderTimerService';
import { getBridge } from '../platform/bridge';

// Single source of truth for the app's performance tier. Replaces the two
// independent booleans this used to be (`performanceModeService` +
// `powerSaverService`), which the UI already forced mutually-exclusive.
//
//   gaming   — strips Xylonic's system load to the bone so a foreground game
//              gets the machine: 15 fps RAF cap, GPU effects gone via the
//              existing `body.performance-mode` stylesheet, every translucent
//              surface flattened to opaque (`body.gaming-mode` — fewer draw
//              calls, less VRAM), zero look-ahead prefetch, one concurrent image
//              fetch, small image-memory cache, lowest native scheduling priority
//              on a quarter of the cores, and — while the window is unfocused or
//              hidden (a game has the foreground) — RAF drops to 2 fps and
//              Chromium's caches are released. Audio and basic control still work.
//   balanced — the former "Normal": 60 fps, full effects, default prefetch.
//   eco      — the former "Power Saver" (+ the old middle "Performance" tier,
//              folded in): 10 fps, everything stripped via
//              `body.power-saver-mode`, pixelated art, no prefetch, native
//              priority dropped — maximum battery life.
export type PerfMode = 'gaming' | 'balanced' | 'eco';

const STORAGE_KEY = 'xylonic_perf_mode';
const LEGACY_PERF_KEY = 'xylonic_performance_mode';
const LEGACY_POWER_KEY = 'xylonic_power_saver_mode';

const FPS: Record<PerfMode, number> = { gaming: 15, balanced: 60, eco: 10 };

/** Gaming tier while the window is unfocused/hidden. */
const GAMING_IDLE_FPS = 2;

/** Upcoming-track cover-art prefetch depth (see `useNeighborSongs`). */
export const PREFETCH_AHEAD: Record<PerfMode, number> = { gaming: 0, balanced: 4, eco: 0 };

/** `imageCacheService` tuning per tier — fewer concurrent fetches = fewer CPU
 *  cycles; smaller memory cache = lower RAM footprint. */
export const IMAGE_CACHE_TUNING: Record<PerfMode, { maxConcurrentFetches: number; maxMemoryCacheSize: number }> = {
    gaming: { maxConcurrentFetches: 1, maxMemoryCacheSize: 120 },
    balanced: { maxConcurrentFetches: 4, maxMemoryCacheSize: 400 },
    eco: { maxConcurrentFetches: 1, maxMemoryCacheSize: 100 },
};

/** Native process scheduling: balanced keeps normal cores, eco yields (gaming has its own profile). */
export const YIELDS_CPU: Record<PerfMode, boolean> = { gaming: true, balanced: false, eco: true };

let _mode: PerfMode = 'balanced';
let _idle = false;

function _resolveStored(): PerfMode {
    const explicit = localStorage.getItem(STORAGE_KEY);
    if (explicit === 'gaming' || explicit === 'balanced' || explicit === 'eco') return explicit;
    // Both legacy modes only ever reduced load — fold them into eco.
    if (localStorage.getItem(LEGACY_POWER_KEY) === 'true') return 'eco';
    if (localStorage.getItem(LEGACY_PERF_KEY) === 'true') return 'eco';
    return 'balanced';
}

function _applyCss(mode: PerfMode): void {
    const cl = document.body.classList;
    // gaming reuses the existing `body.performance-mode` effect-stripping block
    // (no transitions / blur / shadow / GPU layers) plus a `gaming-mode`
    // supplement that flattens the translucent chrome to opaque surfaces.
    cl.toggle('performance-mode', mode === 'gaming');
    cl.toggle('gaming-mode', mode === 'gaming');
    // eco keeps the heavier `body.power-saver-mode` block.
    cl.toggle('power-saver-mode', mode === 'eco');
}

// Gaming only: a game (or anything else) holding focus means the user isn't
// interacting with Xylonic, so spend as little as possible until they return.
function _syncIdle(): void {
    const idle = _mode === 'gaming' && (document.hidden || !document.hasFocus());
    if (idle === _idle) return;
    _idle = idle;
    setThrottleFps(idle ? GAMING_IDLE_FPS : FPS[_mode]);
    if (idle) getBridge().trimMemory().catch(() => {});
}

/** Push the tier's native scheduling profile (priority / affinity / cache trim). */
export function applyNativePriority(mode: PerfMode = _mode): void {
    const bridge = getBridge();
    const p = mode === 'gaming' ? bridge.setGamingMode(true) : bridge.setPowerSaverPriority(YIELDS_CPU[mode]);
    p.catch(() => {});
}

export function getPerfMode(): PerfMode {
    return _mode;
}

/** True for the low-power tier — for call sites that only care "is eco on?". */
export function isEcoMode(): boolean {
    return _mode === 'eco';
}

export function isGamingMode(): boolean {
    return _mode === 'gaming';
}

export function setPerfMode(mode: PerfMode): void {
    _mode = mode;
    localStorage.setItem(STORAGE_KEY, mode);
    localStorage.removeItem(LEGACY_PERF_KEY);
    localStorage.removeItem(LEGACY_POWER_KEY);
    _applyCss(mode);
    _idle = false;
    setThrottleFps(FPS[mode]);
    _syncIdle();
    resetFpsWindow();
    window.dispatchEvent(new Event('appModeChanged'));
}

/** Call once before React mounts to restore the saved tier. */
export function initPerfMode(): void {
    _mode = _resolveStored();
    _applyCss(_mode);
    setThrottleFps(FPS[_mode]);
    window.addEventListener('blur', _syncIdle);
    window.addEventListener('focus', _syncIdle);
    document.addEventListener('visibilitychange', _syncIdle);
    _syncIdle();
}
