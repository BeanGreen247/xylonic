import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { isReleaseBuild } from '../../../config/buildVariant';
import { getBridge } from '../../../platform/bridge';
import { logger } from '../../../utils/logger';
import { getPerfMode, setPerfMode as applyPerfMode, YIELDS_CPU, PerfMode } from '../../../services/perfModeService';
import { isEnabled as isRenderTimerEnabled, setEnabled as setRenderTimerEnabled } from '../../../services/renderTimerService';

const PERF_TIERS: { mode: PerfMode; icon: string; label: string; sub: string; color?: string }[] = [
  {
    mode: 'gaming',
    icon: 'fa-gamepad',
    label: 'Gaming',
    sub: 'Minimises system load for a foreground game — 15 fps, GPU effects and translucency off, no prefetch, small image cache, CPU priority yielded. Audio and basic control still work',
    color: '#ff9f0a',
  },
  {
    mode: 'balanced',
    icon: 'fa-circle',
    label: 'Balanced',
    sub: 'Default — 60 fps, full GPU effects, standard prefetch',
  },
  {
    mode: 'eco',
    icon: 'fa-leaf',
    label: 'Eco',
    sub: '10 fps, every GPU effect off, pixelated art, no prefetch, CPU priority yielded — maximum battery life',
    color: '#1db954',
  },
];

/**
 * Settings → Advanced. Self-contained: owns the perf-tier selector, the
 * render-timer and debug-logging toggles and their side effects. No props —
 * split out of `SettingsView` (WS-ARCH); none of this state is read elsewhere.
 */
const AdvancedSection: React.FC = () => {
  const [perfMode, setPerfMode] = useState<PerfMode>(getPerfMode);
  const [renderTimer, setRenderTimer] = useState(isRenderTimerEnabled);
  const [loggingEnabled, setLoggingEnabled] = useState(false);

  useEffect(() => {
    setLoggingEnabled(logger.isEnabled());
  }, []);

  const handlePerfTier = (mode: PerfMode) => {
    if (mode === perfMode) return;
    setPerfMode(mode);
    applyPerfMode(mode);
    getBridge().setPowerSaverPriority(YIELDS_CPU[mode]).catch(() => {});
  };

  const handleRenderTimerToggle = () => {
    const next = !renderTimer;
    setRenderTimer(next);
    setRenderTimerEnabled(next);
  };

  const handleLoggingToggle = async () => {
    const next = !loggingEnabled;
    const ok = await logger.setEnabled(next);
    if (ok) setLoggingEnabled(next);
  };

  const handleOpenLogFolder = async () => {
    try { await getBridge().openLogFolder(); } catch { /* no-op */ }
  };

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Advanced</h3>
      <div className="settings-card">
        {PERF_TIERS.map((tier, i) => {
          const active = perfMode === tier.mode;
          return (
            <React.Fragment key={tier.mode}>
              {i > 0 && <div className="settings-divider" />}
              <button
                className={`settings-row${active ? ' active' : ''}`}
                onClick={() => handlePerfTier(tier.mode)}
                aria-pressed={active}
              >
                <span className="settings-row-icon">
                  <i className={`fas ${tier.icon}`} style={{ color: active && tier.color ? tier.color : undefined }} />
                </span>
                <span className="settings-row-label">
                  {tier.label} Mode
                  <span className="settings-row-sub">{tier.sub}</span>
                </span>
                <span className="settings-row-action">
                  <span className={`settings-badge ${active ? 'on' : 'off'}`}>
                    {active ? 'Active' : ''}
                  </span>
                </span>
              </button>
            </React.Fragment>
          );
        })}
        {!isReleaseBuild && <div className="settings-divider" />}
        {!isReleaseBuild && <button className={`settings-row${renderTimer ? ' active' : ''}`} onClick={handleRenderTimerToggle}>
          <span className="settings-row-icon">
            <i className="fas fa-tachometer-alt" />
          </span>
          <span className="settings-row-label">
            Performance Overlay
            <span className="settings-row-sub">Shows FPS, CPU load, and OS RAM usage — green &lt;16 ms, yellow &lt;50 ms, red ≥50 ms</span>
          </span>
          <span className="settings-row-action">
            <span className={`settings-badge ${renderTimer ? 'on' : 'off'}`}>
              {renderTimer ? 'On' : 'Off'}
            </span>
          </span>
        </button>}
        <div className="settings-divider" />
        <button className={`settings-row${loggingEnabled ? ' active' : ''}`} onClick={handleLoggingToggle}>
          <span className="settings-row-icon">
            <i className={`fas fa-${loggingEnabled ? 'file-alt' : 'file'}`} />
          </span>
          <span className="settings-row-label">
            Debug Logging
            <span className="settings-row-sub">Writes detailed logs to disk</span>
          </span>
          <span className="settings-row-action">
            <span className={`settings-badge ${loggingEnabled ? 'on' : 'off'}`}>
              {loggingEnabled ? 'On' : 'Off'}
            </span>
          </span>
        </button>
        {loggingEnabled && !Capacitor.isNativePlatform() && (
          <>
            <div className="settings-divider" />
            <button className="settings-row" onClick={handleOpenLogFolder}>
              <span className="settings-row-icon"><i className="fas fa-folder-open" /></span>
              <span className="settings-row-label">Open Log Folder</span>
              <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default AdvancedSection;
