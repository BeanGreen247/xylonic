import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { isReleaseBuild } from '../../../config/buildVariant';
import { getBridge } from '../../../platform/bridge';
import { logger } from '../../../utils/logger';
import { isPerformanceModeEnabled, setPerformanceMode } from '../../../services/performanceModeService';
import { isPowerSaverEnabled, setPowerSaverMode } from '../../../services/powerSaverService';
import { isEnabled as isRenderTimerEnabled, setEnabled as setRenderTimerEnabled } from '../../../services/renderTimerService';

/**
 * Settings → Advanced. Self-contained: owns the perf-mode / power-saver /
 * render-timer / debug-logging toggles and their side effects. No props — split
 * out of `SettingsView` (WS-ARCH); none of this state is read elsewhere.
 */
const AdvancedSection: React.FC = () => {
  const [perfMode, setPerfMode] = useState(isPerformanceModeEnabled);
  const [powerSaver, setPowerSaver] = useState(isPowerSaverEnabled);
  const [renderTimer, setRenderTimer] = useState(isRenderTimerEnabled);
  const [loggingEnabled, setLoggingEnabled] = useState(false);

  useEffect(() => {
    setLoggingEnabled(logger.isEnabled());
  }, []);

  const handlePerfModeToggle = () => {
    const next = !perfMode;
    setPerfMode(next);
    if (next) {
      if (powerSaver) { setPowerSaver(false); setPowerSaverMode(false); }
      setPerformanceMode(true);
      getBridge().setPerformancePriority().catch(() => {});
    } else {
      setPerformanceMode(false);
      getBridge().setPowerSaverPriority(false).catch(() => {});
    }
  };

  const handlePowerSaverToggle = () => {
    const next = !powerSaver;
    setPowerSaver(next);
    if (next) {
      if (perfMode) { setPerfMode(false); setPerformanceMode(false); }
      setPowerSaverMode(true);
    } else {
      setPowerSaverMode(false);
    }
    getBridge().setPowerSaverPriority(next).catch(() => {});
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
        <button className={`settings-row${perfMode ? ' active' : ''}`} onClick={handlePerfModeToggle}>
          <span className="settings-row-icon">
            <i className="fas fa-gamepad" />
          </span>
          <span className="settings-row-label">
            Game / Performance Mode
            <span className="settings-row-sub">
              Removes GPU effects, caps frame rate to 30 fps — frees GPU &amp; CPU for games
            </span>
          </span>
          <span className="settings-row-action">
            <span className={`settings-badge ${perfMode ? 'on' : 'off'}`}>
              {perfMode ? 'On' : 'Off'}
            </span>
          </span>
        </button>
        <div className="settings-divider" />
        <button className={`settings-row${powerSaver ? ' active' : ''}`} onClick={handlePowerSaverToggle}>
          <span className="settings-row-icon">
            <i className="fas fa-leaf" style={{ color: powerSaver ? '#1db954' : undefined }} />
          </span>
          <span className="settings-row-label">
            Power Saver Mode
            <span className="settings-row-sub">
              Caps frame rate to 5 fps, lowers process scheduling priority, removes all GPU effects — extends battery life
            </span>
          </span>
          <span className="settings-row-action">
            <span className={`settings-badge ${powerSaver ? 'on' : 'off'}`}>
              {powerSaver ? 'On' : 'Off'}
            </span>
          </span>
        </button>
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
