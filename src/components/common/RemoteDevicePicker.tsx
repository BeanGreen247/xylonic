import React from 'react';
import ReactDOM from 'react-dom';
import { RemoteDevice } from '../../services/remoteDiscoveryService';
import './RemoteDevicePicker.css';

interface Props {
  devices: RemoteDevice[];
  activeTarget: RemoteDevice | null;
  myDeviceId: string;
  myAccountId: string;
  isOnWifi: boolean;
  pairingError: string | null;
  onSelect(device: RemoteDevice): void;
  onDisconnect(): void;
  onClose(): void;
  onClearError(): void;
}

const platformIcon = (platform: string) =>
  platform === 'electron' ? 'fas fa-desktop' : 'fas fa-mobile-alt';

const RemoteDevicePicker: React.FC<Props> = ({
  devices,
  activeTarget,
  myDeviceId,
  myAccountId,
  isOnWifi,
  pairingError,
  onSelect,
  onDisconnect,
  onClose,
  onClearError,
}) => {
  const modal = (
    <>
      <div className="rdp-backdrop" onClick={onClose} />
      <div className="rdp-modal" role="dialog" aria-label="Remote Mode">
        <div className="rdp-header">
          <span className="rdp-title">
            <i className="fas fa-satellite-dish" />
            Remote Mode
          </span>
          <button className="rdp-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        {pairingError && (
          <div className="rdp-error-bar" onClick={onClearError}>
            <i className="fas fa-exclamation-circle" />
            {pairingError}
          </div>
        )}

        {!isOnWifi ? (
          <div className="rdp-status rdp-status--warn">
            <i className="fas fa-wifi" />
            Remote Mode requires a WiFi connection (not mobile data).
          </div>
        ) : devices.length === 0 ? (
          <div className="rdp-status">
            <i className="fas fa-circle-notch fa-spin" />
            Searching for Xylonic devices on your network…
          </div>
        ) : (
          <p className="rdp-hint">
            Select an available device to control it remotely.
          </p>
        )}

        {activeTarget && (
          <div className="rdp-active-bar">
            <i className={platformIcon(activeTarget.platform)} />
            <span>Controlling: <strong>{activeTarget.name}</strong></span>
            <button className="rdp-disconnect-btn" onClick={onDisconnect}>
              <i className="fas fa-unlink" />
              Disconnect
            </button>
          </div>
        )}

        <div className="rdp-list">
          {devices.map(dev => {
            const isActive = activeTarget?.id === dev.id;
            const pairedWith = dev.pairedWith || null;
            // Busy if locked by a different controller, OR if it's currently acting as a controller itself
            const isBusy = !isActive && (
              (pairedWith !== null && pairedWith !== myDeviceId) ||
              (dev.controllingId !== null && dev.controllingId !== undefined)
            );
            // Wrong account: both sides have a non-empty accountId and they differ
            const isWrongAccount = !isActive && !!(dev.accountId && myAccountId && dev.accountId !== myAccountId);

            return (
              <button
                key={dev.id}
                className={[
                  'rdp-item',
                  isActive      ? 'rdp-item--active'       : '',
                  isBusy        ? 'rdp-item--busy'         : '',
                  isWrongAccount ? 'rdp-item--wrong-account' : '',
                ].filter(Boolean).join(' ')}
                onClick={!isActive && !isWrongAccount ? () => onSelect(dev) : undefined}
                disabled={isActive || isWrongAccount}
                title={
                  isWrongAccount ? 'Signed into a different Navidrome account' :
                  isBusy        ? 'Another Xylonic may be using this device — tap to try anyway' :
                  isActive      ? 'Currently connected' :
                  `Control ${dev.name}`
                }
              >
                <div className="rdp-item-icon">
                  <i className={platformIcon(dev.platform)} />
                </div>
                <div className="rdp-item-info">
                  <span className="rdp-item-name">{dev.name}</span>
                  <span className="rdp-item-sub">
                    {dev.host} · {dev.platform === 'electron' ? 'Desktop' : 'Android'}
                  </span>
                </div>
                {isActive && (
                  <span className="rdp-item-badge rdp-item-badge--active">
                    <i className="fas fa-link" /> Active
                  </span>
                )}
                {isBusy && !isWrongAccount && (
                  <span className="rdp-item-badge rdp-item-badge--busy">
                    <i className="fas fa-lock" /> Busy
                  </span>
                )}
                {isWrongAccount && (
                  <span className="rdp-item-badge rdp-item-badge--wrong-account">
                    <i className="fas fa-user-slash" /> Different account
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  return ReactDOM.createPortal(modal, document.body);
};

export default RemoteDevicePicker;
