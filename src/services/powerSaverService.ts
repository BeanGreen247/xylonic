import { setThrottleFps } from './rafThrottle';
import { resetFpsWindow } from './renderTimerService';

const STORAGE_KEY = 'xylonic_power_saver_mode';
const POWER_FPS   = 5;
const NORMAL_FPS  = 60;

function _applyCss(on: boolean) {
    if (on) document.body.classList.add('power-saver-mode');
    else    document.body.classList.remove('power-saver-mode');
}

export function isPowerSaverEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setPowerSaverMode(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    _applyCss(enabled);
    setThrottleFps(enabled ? POWER_FPS : NORMAL_FPS);
    resetFpsWindow();
    window.dispatchEvent(new Event('appModeChanged'));
}

export function initPowerSaverMode(): void {
    const on = isPowerSaverEnabled();
    _applyCss(on);
    setThrottleFps(on ? POWER_FPS : NORMAL_FPS);
}
