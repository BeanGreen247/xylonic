import React, { useState, useEffect } from 'react';
import {
  isEnabled, getCpuLagPct, getCoreCount, getFPS,
  getFrameIntervalMs, getFrameJitter, startFpsLoop, stopFpsLoop,
} from '../../services/renderTimerService';
import { getThrottleFps } from '../../services/rafThrottle';
import { getBridge } from '../../platform/bridge';
import { isPowerSaverEnabled } from '../../services/powerSaverService';
import { isPerformanceModeEnabled } from '../../services/performanceModeService';
import './RenderTimerHUD.css';

function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576)    return (bytes / 1048576).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function cpuColor(pct: number): string {
  return pct < 30 ? '#1db954' : pct < 70 ? '#ff9f0a' : '#ff3b30';
}

type AppMode = 'normal' | 'performance' | 'powerSaver';
type Health  = 'nominal' | 'overload' | 'uncapped';

function throttleHealth(fps: number, targetFps: number): Health {
  if (fps === 0) return 'nominal';
  if (fps < targetFps * 0.75) return 'overload';
  if (targetFps < 60 && fps > targetFps * 1.15) return 'uncapped';
  return 'nominal';
}

/** Fallback for Android/web: approximate active cores from total CPU %. */
function CoreDots({ cores, cpuPct, mode }: { cores: number; cpuPct: number; mode: AppMode }) {
  const active       = Math.round((cpuPct / 100) * cores);
  const deprioCutoff = mode === 'powerSaver' ? Math.ceil(cores / 2) : cores;
  return (
    <span className="rt-core-dots" aria-hidden="true">
      {Array.from({ length: cores }, (_, i) => {
        let cls = 'rt-core-dot';
        if (i < active)        cls += ' rt-core-dot-on';
        if (i >= deprioCutoff) cls += ' rt-core-dot-depriorised';
        return <span key={i} className={cls} />;
      })}
    </span>
  );
}

/** Per-Electron-process CPU bars (app-specific, not system-wide). */
function ProcessBars({ bars }: { bars: Array<{ label: string; pct: number }> }) {
  return (
    <div className="rt-proc-list" aria-hidden="true">
      {bars.map(({ label, pct }) => (
        <div key={label} className="rt-proc-row">
          <span className="rt-proc-label">{label}</span>
          <div className="rt-proc-bar">
            <div
              className="rt-proc-fill"
              style={{ width: `${Math.min(100, pct)}%`, background: cpuColor(pct) }}
            />
          </div>
          <span className="rt-proc-pct">{pct}</span>
        </div>
      ))}
    </div>
  );
}

// Batched into two objects so each polling tick causes at most one React render.
type FastStats = { fps: number; targetFps: number; frameMs: number; jitter: number };
type SlowStats = {
  cpuPct:      number;
  cores:       number;
  processBars: Array<{ label: string; pct: number }>;
  appMem:      number | null;
  isElectron:  boolean;
};

const RenderTimerHUD: React.FC = () => {
  const [enabled, setEnabledState] = useState(isEnabled);
  const [fast, setFast] = useState<FastStats>({
    fps: 0, targetFps: getThrottleFps(), frameMs: 0, jitter: 0,
  });
  const [slow, setSlow] = useState<SlowStats>({
    cpuPct: 0, cores: getCoreCount(), processBars: [], appMem: null, isElectron: false,
  });

  useEffect(() => {
    const onToggle = () => setEnabledState(isEnabled());
    window.addEventListener('renderTimerChanged', onToggle);
    return () => window.removeEventListener('renderTimerChanged', onToggle);
  }, []);

  // All active work is gated behind `enabled` so none of it runs while the HUD is hidden.
  useEffect(() => {
    if (!enabled) return;

    startFpsLoop();

    const fastId = setInterval(() => {
      setFast({
        fps:      getFPS(),
        targetFps: getThrottleFps(),
        frameMs:  getFrameIntervalMs(),
        jitter:   getFrameJitter(),
      });
    }, 500);

    const slowId = setInterval(async () => {
      const stats = await getBridge().getSystemStats();
      if (stats) {
        setSlow({
          cpuPct:      stats.cpuPercent,
          cores:       stats.cores,
          processBars: stats.processBreakdown ?? [],
          appMem:      stats.appMemBytes,
          isElectron:  true,
        });
      } else {
        setSlow({
          cpuPct:      getCpuLagPct(),
          cores:       getCoreCount(),
          processBars: [],
          appMem:      null,
          isElectron:  false,
        });
      }
    }, 1000);

    // Keep targetFps in sync immediately when mode switches.
    const onMode = () => setFast(prev => ({ ...prev, targetFps: getThrottleFps() }));
    window.addEventListener('appModeChanged', onMode);

    return () => {
      stopFpsLoop();
      clearInterval(fastId);
      clearInterval(slowId);
      window.removeEventListener('appModeChanged', onMode);
    };
  }, [enabled]);

  if (!enabled) return null;

  const { fps, targetFps, frameMs, jitter } = fast;
  const { cpuPct, cores, processBars, appMem, isElectron } = slow;

  const powerSaver = isPowerSaverEnabled();
  const perfMode   = isPerformanceModeEnabled();
  const appMode: AppMode = powerSaver ? 'powerSaver' : perfMode ? 'performance' : 'normal';

  // Use a ratio so thresholds scale correctly across all three modes (60/30/5 fps).
  // fps===0 means warmup — show neutral rather than alarming red.
  const fpsRatio = fps === 0 ? 1 : fps / targetFps;
  const fpsColor = fpsRatio >= 0.9 ? '#1db954' : fpsRatio >= 0.75 ? '#ff9f0a' : '#ff3b30';
  const cColor   = cpuColor(cpuPct);

  const targetMs = targetFps > 0 ? parseFloat((1000 / targetFps).toFixed(1)) : 0;

  const health = throttleHealth(fps, targetFps);
  const healthLabel: Record<Health, string> = {
    nominal:  appMode === 'normal' ? 'SMOOTH' : 'LOCKED',
    overload: 'OVERLOAD',
    uncapped: 'UNCAPPED',
  };
  const healthColor: Record<Health, string> = {
    nominal:  '#1db954',
    overload: '#ff9f0a',
    uncapped: '#ff3b30',
  };

  const modeLabel: Record<AppMode, string> = {
    normal:      'NORMAL',
    performance: 'PERF',
    powerSaver:  'ECO',
  };
  const modeIcon: Record<AppMode, string> = {
    normal:      'fa-circle',
    performance: 'fa-tachometer-alt',
    powerSaver:  'fa-leaf',
  };
  const modeColor: Record<AppMode, string> = {
    normal:      'rgba(255,255,255,0.35)',
    performance: '#ff9f0a',
    powerSaver:  '#1db954',
  };

  return (
    <div className="render-timer-hud" aria-hidden="true">

      {/* ── Mode ── */}
      <div className="rt-mode-badge" style={{ color: modeColor[appMode] }}>
        <i className={`fas ${modeIcon[appMode]}`} />
        {' '}{modeLabel[appMode]}
      </div>

      {/* ── FPS ── */}
      <div className="rt-section-label">FPS</div>
      <div className="rt-fps-row">
        <span className="rt-fps-actual" style={{ color: fpsColor }}>{fps}</span>
        <span className="rt-fps-sep">/</span>
        <span className="rt-fps-target">{targetFps}</span>
        <span className="rt-fps-label">target</span>
      </div>

      {/* Frame interval: actual ms ↔ target ms */}
      {frameMs > 0 && targetMs > 0 && (
        <div className="rt-interval-row">
          <span className="rt-interval-val">{frameMs.toFixed(1)}</span>
          <span className="rt-interval-unit">ms</span>
          <span className="rt-interval-arrow">↔</span>
          <span className="rt-interval-val rt-interval-target">{targetMs.toFixed(1)}</span>
          <span className="rt-interval-unit">ms</span>
        </div>
      )}

      {/* Throttle health + frame jitter */}
      {fps > 0 && (
        <div className="rt-health-row">
          <span className="rt-health-dot" style={{ color: healthColor[health] }}>●</span>
          <span className="rt-health-label" style={{ color: healthColor[health] }}>
            {healthLabel[health]}
          </span>
          {jitter > 0 && (
            <span className="rt-jitter">±{jitter.toFixed(1)}ms</span>
          )}
        </div>
      )}

      <div className="rt-divider" />

      {/* ── CPU ── */}
      <div className="rt-row rt-cpu-row">
        <span className="rt-section-label">APP CPU</span>
        <span className="rt-cpu-pct" style={{ color: cColor }}>
          {isElectron ? '' : '~'}{cpuPct}%
        </span>
        {/* Dots fallback when no per-process data (Android/web) */}
        {processBars.length === 0 && cores > 0 && (
          <CoreDots cores={Math.min(cores, 16)} cpuPct={cpuPct} mode={appMode} />
        )}
      </div>
      {cores > 0 && (
        <div className="rt-cpu-sub">
          {cores} core{cores !== 1 ? 's' : ''}
        </div>
      )}

      {/* Per-process bars (Electron only) */}
      {processBars.length > 0 && (
        <ProcessBars bars={processBars} />
      )}

      {/* ── App RAM ── */}
      {appMem !== null && (
        <>
          <div className="rt-divider" />
          <div className="rt-section-label">APP RAM</div>
          <div className="rt-ram-value">
            {fmtBytes(appMem)}
            <span className="rt-ram-label">{isElectron ? ' working set' : ' JS heap'}</span>
          </div>
        </>
      )}
    </div>
  );
};

export default RenderTimerHUD;
