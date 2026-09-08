import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useRemoteMode } from '../../../context/RemoteModeContext';
import FirewallSetupDialog from '../FirewallSetupDialog';

/**
 * "Remote" settings section (be-controlled / control-others toggles, device
 * picker launcher, desktop firewall helper). Self-contained: reads everything
 * from RemoteModeContext and owns the firewall-dialog visibility.
 * Renders nothing when remote mode isn't available on this platform.
 */
const RemoteSettingsSection: React.FC = () => {
  const {
    isRemoteModeAvailable,
    remoteControlEnabled,  setRemoteControlEnabled,
    remoteControllerEnabled, setRemoteControllerEnabled,
    availableDevices,
    remoteTarget,
    isOnWifi,
  } = useRemoteMode();
  const [showFirewallDialog, setShowFirewallDialog] = useState(false);

  if (!isRemoteModeAvailable) return null;

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">Remote</h3>
        <div className="settings-card">
          <button
            className={`settings-row${remoteControlEnabled ? ' active' : ''}`}
            onClick={() => setRemoteControlEnabled(!remoteControlEnabled)}
          >
            <span className="settings-row-icon"><i className="fas fa-satellite-dish" /></span>
            <span className="settings-row-label">
              Be Controlled
              <span className="settings-row-sub">Let other Xylonic devices on your network control playback here</span>
            </span>
            <span className="settings-row-action">
              <span className={`settings-badge ${remoteControlEnabled ? 'on' : 'off'}`}>
                {remoteControlEnabled ? 'On' : 'Off'}
              </span>
            </span>
          </button>

          <>
            <div className="settings-divider" />
            <button
              className={`settings-row${remoteControllerEnabled ? ' active' : ''}`}
              onClick={() => setRemoteControllerEnabled(!remoteControllerEnabled)}
            >
              <span className="settings-row-icon"><i className="fas fa-gamepad" /></span>
              <span className="settings-row-label">
                Control Others
                <span className="settings-row-sub">Discover and control other Xylonic devices on your network</span>
              </span>
              <span className="settings-row-action">
                <span className={`settings-badge ${remoteControllerEnabled ? 'on' : 'off'}`}>
                  {remoteControllerEnabled ? 'On' : 'Off'}
                </span>
              </span>
            </button>
          </>

          <div className="settings-divider" />
          <button
            className="settings-row"
            onClick={() => window.dispatchEvent(new Event('xylonic-open-remote-picker'))}
          >
            <span className="settings-row-icon">
              <i className="fas fa-network-wired" />
            </span>
            <span className="settings-row-label">
              Remote Devices
              <span className="settings-row-sub">
                {remoteTarget
                  ? 'Currently controlling a remote device'
                  : availableDevices.length > 0
                    ? `${availableDevices.length} device${availableDevices.length !== 1 ? 's' : ''} found`
                    : isOnWifi ? 'No devices found yet' : 'Requires Wi-Fi / LAN'}
              </span>
            </span>
            <span className="settings-row-action">
              {remoteTarget
                ? <span className="settings-badge on">Connected</span>
                : <i className="fas fa-chevron-right" />}
            </span>
          </button>

          {!Capacitor.isNativePlatform() && (
            <>
              <div className="settings-divider" />
              <button
                className="settings-row"
                onClick={() => setShowFirewallDialog(true)}
              >
                <span className="settings-row-icon"><i className="fas fa-fire-alt" /></span>
                <span className="settings-row-label">
                  Firewall Setup
                  <span className="settings-row-sub">Open ports 7766 (UDP) and 7767 (TCP) for remote discovery</span>
                </span>
                <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
              </button>
            </>
          )}
        </div>
      </section>

      {showFirewallDialog && <FirewallSetupDialog onClose={() => setShowFirewallDialog(false)} />}
    </>
  );
};

export default RemoteSettingsSection;
