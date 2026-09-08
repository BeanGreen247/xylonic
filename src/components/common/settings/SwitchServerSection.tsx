import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../../../context/AuthContext';
import { getConnectionHistory, ConnectionProfile } from '../../../services/connectionHistoryService';
import { isSecureStorageAvailable, getDecryptedPassword } from '../../../services/secureCredentialService';
import { testConnection } from '../../../services/subsonicApi';

/**
 * "Switch Server" row for the Account settings section, plus its two portalled
 * modals (connection picker + password prompt). Self-contained: owns all of its
 * own state and only needs `login` from AuthContext.
 */
const SwitchServerSection: React.FC = () => {
  const { login } = useAuth();

  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [connections,      setConnections]      = useState<ConnectionProfile[]>([]);
  const [switchPassConn,   setSwitchPassConn]   = useState<ConnectionProfile | null>(null);
  const [switchPassword,   setSwitchPassword]   = useState('');
  const [switchError,      setSwitchError]      = useState('');
  const [switching,        setSwitching]        = useState(false);

  const handleOpenSwitchPicker = () => {
    setConnections(getConnectionHistory());
    setShowSwitchPicker(true);
  };

  const handleSwitchSelect = async (conn: ConnectionProfile) => {
    setShowSwitchPicker(false);
    setSwitching(true);
    try {
      const secureAvail = await isSecureStorageAvailable();
      if (secureAvail) {
        const pwd = await getDecryptedPassword(conn.serverUrl, conn.username);
        if (pwd) {
          const resp = await testConnection(conn.serverUrl, conn.username, pwd);
          if (resp.data['subsonic-response']?.status === 'ok') {
            login(conn.serverUrl, conn.username, pwd);
            setSwitching(false);
            return;
          }
        }
      }
      setSwitchPassConn(conn);
      setSwitchPassword('');
      setSwitchError('');
    } catch {
      setSwitchPassConn(conn);
      setSwitchPassword('');
      setSwitchError('');
    } finally {
      setSwitching(false);
    }
  };

  const handleSwitchWithPassword = async () => {
    if (!switchPassConn || !switchPassword) return;
    setSwitching(true);
    try {
      const resp = await testConnection(switchPassConn.serverUrl, switchPassConn.username, switchPassword);
      if (resp.data['subsonic-response']?.status === 'ok') {
        login(switchPassConn.serverUrl, switchPassConn.username, switchPassword);
        setSwitchPassConn(null);
      } else {
        setSwitchError('Wrong password or connection failed.');
      }
    } catch {
      setSwitchError('Could not reach server.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <button className="settings-row" onClick={handleOpenSwitchPicker} disabled={switching}>
        <span className="settings-row-icon">
          <i className={`fas fa-${switching ? 'spinner fa-spin' : 'exchange-alt'}`} />
        </span>
        <span className="settings-row-label">{switching ? 'Switching…' : 'Switch Server'}</span>
        <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
      </button>

      {/* Switch server picker */}
      {showSwitchPicker && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setShowSwitchPicker(false)} />
          <div className="quality-picker-modal" role="listbox" aria-label="Switch server">
            <div className="quality-picker-header">
              <span className="quality-picker-title"><i className="fas fa-exchange-alt" /> Switch Server</span>
              <button className="quality-picker-close" onClick={() => setShowSwitchPicker(false)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <p className="quality-picker-hint">Select a saved connection to switch to.</p>
            <div className="quality-picker-list">
              {connections.length === 0 && (
                <p style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13 }}>No saved connections yet.</p>
              )}
              {connections.map(conn => (
                <button
                  key={conn.id}
                  className="quality-picker-item"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSwitchSelect(conn)}
                >
                  <div className="conn-picker-icon"><i className="fas fa-server" /></div>
                  <div className="quality-picker-info">
                    <span className="quality-picker-name">{conn.displayName}</span>
                    <span className="quality-picker-desc">{conn.username} · {conn.serverUrl}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* Switch server password prompt */}
      {switchPassConn && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setSwitchPassConn(null)} />
          <div className="quality-picker-modal switch-pass-modal" role="dialog">
            <div className="quality-picker-header">
              <span className="quality-picker-title"><i className="fas fa-lock" /> Enter Password</span>
              <button className="quality-picker-close" onClick={() => setSwitchPassConn(null)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="switch-pass-body">
              <p className="quality-picker-hint">Switching to <strong>{switchPassConn.displayName}</strong></p>
              <input
                type="password"
                className="switch-pass-input"
                placeholder="Password"
                value={switchPassword}
                autoFocus
                onChange={e => setSwitchPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSwitchWithPassword(); }}
              />
              {switchError && (
                <p className="switch-pass-error"><i className="fas fa-times-circle" /> {switchError}</p>
              )}
              <button
                className="switch-pass-btn"
                onClick={handleSwitchWithPassword}
                disabled={switching || !switchPassword}
              >
                {switching ? <><i className="fas fa-spinner fa-spin" /> Connecting…</> : 'Connect'}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
};

export default SwitchServerSection;
