import { setThrottleFps } from './rafThrottle';
import { resetFpsWindow } from './renderTimerService';

const STORAGE_KEY = 'xylonic_performance_mode';
const PERF_FPS    = 30;
const NORMAL_FPS  = 60;

function _applyCss(on: boolean) {
    if (on) document.body.classList.add('performance-mode');
    else    document.body.classList.remove('performance-mode');
}

export function isPerformanceModeEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setPerformanceMode(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    _applyCss(enabled);
    setThrottleFps(enabled ? PERF_FPS : NORMAL_FPS);
    resetFpsWindow();
    window.dispatchEvent(new Event('appModeChanged'));
}

/** Call once before React mounts to restore the saved state. */
export function initPerformanceMode(): void {
    const on = isPerformanceModeEnabled();
    _applyCss(on);
    setThrottleFps(on ? PERF_FPS : NORMAL_FPS);
}
