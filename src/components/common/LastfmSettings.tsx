import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import {
  getLastfmConfig, saveLastfmConfig, clearLastfmConfig,
  lastfmAuthenticate, LastfmConfig,
} from '../../services/lastfmService';
import './LastfmSettings.css';

interface Props {
  onClose: () => void;
}

const LastfmSettings: React.FC<Props> = ({ onClose }) => {
  const { username } = useAuth();

  const [config, setConfig] = useState<LastfmConfig | null>(null);
  const [apiKey, setApiKey]       = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [lfmUser, setLfmUser]     = useState('');
  const [lfmPass, setLfmPass]     = useState('');
  const [status, setStatus]       = useState<{ ok: boolean; msg: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!username) return;
    const saved = getLastfmConfig(username);
    setConfig(saved);
  }, [username]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConnect = async () => {
    if (!username) return;
    if (!apiKey || !apiSecret || !lfmUser || !lfmPass) {
      setStatus({ ok: false, msg: 'All fields are required.' });
      return;
    }
    setConnecting(true);
    setStatus(null);
    const result = await lastfmAuthenticate(apiKey, apiSecret, lfmUser, lfmPass);
    setConnecting(false);
    if (result.success && result.sessionKey) {
      const newConfig: LastfmConfig = {
        enabled: true,
        apiKey,
        apiSecret,
        sessionKey: result.sessionKey,
        lastfmUsername: lfmUser,
      };
      saveLastfmConfig(username, newConfig);
      setConfig(newConfig);
      setLfmPass('');
      setStatus({ ok: true, msg: `Connected as ${lfmUser}` });
    } else {
      setStatus({ ok: false, msg: result.error ?? 'Failed to connect.' });
    }
  };

  const handleToggleEnabled = () => {
    if (!username || !config) return;
    const updated = { ...config, enabled: !config.enabled };
    saveLastfmConfig(username, updated);
    setConfig(updated);
  };

  const handleDisconnect = () => {
    if (!username) return;
    clearLastfmConfig(username);
    setConfig(null);
    setApiKey('');
    setApiSecret('');
    setLfmUser('');
    setLfmPass('');
    setStatus(null);
  };

  return ReactDOM.createPortal(
    <>
      <div className="lfm-backdrop" onClick={onClose} />
      <div className="lfm-modal" role="dialog" aria-label="Last.fm Settings">
        <div className="lfm-header">
          <span className="lfm-title">
            <i className="fab fa-lastfm" />
            Last.fm Scrobbling
          </span>
          <button className="lfm-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        {config ? (
          /* ── Connected state ── */
          <div className="lfm-connected">
            <div className="lfm-connected-info">
              <i className="fab fa-lastfm lfm-connected-icon" />
              <div>
                <div className="lfm-connected-name">{config.lastfmUsername}</div>
                <div className="lfm-connected-sub">Connected to Last.fm</div>
              </div>
            </div>

            <label className="lfm-toggle-row">
              <span>Scrobbling enabled</span>
              <div
                className={`lfm-toggle${config.enabled ? ' on' : ''}`}
                onClick={handleToggleEnabled}
                role="switch"
                aria-checked={config.enabled}
              >
                <div className="lfm-toggle-thumb" />
              </div>
            </label>

            <p className="lfm-hint">
              Tracks scrobble after playing 50% of their duration (or 4 minutes).
            </p>

            <button className="lfm-btn lfm-btn-danger" onClick={handleDisconnect}>
              <i className="fas fa-unlink" />
              Disconnect
            </button>
          </div>
        ) : (
          /* ── Disconnected / setup state ── */
          <div className="lfm-form">
            <p className="lfm-hint">
              Get your API key and secret from{' '}
              <span className="lfm-link">last.fm/api/account/create</span>.
            </p>

            <div className="lfm-field">
              <label>API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="32-character hex key"
                autoComplete="off"
              />
            </div>

            <div className="lfm-field">
              <label>API Secret</label>
              <input
                type="text"
                value={apiSecret}
                onChange={e => setApiSecret(e.target.value)}
                placeholder="32-character hex secret"
                autoComplete="off"
              />
            </div>

            <div className="lfm-field">
              <label>Last.fm Username</label>
              <input
                type="text"
                value={lfmUser}
                onChange={e => setLfmUser(e.target.value)}
                placeholder="Your Last.fm username"
                autoComplete="username"
              />
            </div>

            <div className="lfm-field">
              <label>Last.fm Password</label>
              <input
                type="password"
                value={lfmPass}
                onChange={e => setLfmPass(e.target.value)}
                placeholder="Your Last.fm password"
                autoComplete="current-password"
                onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
              />
            </div>

            {status && (
              <div className={`lfm-status ${status.ok ? 'ok' : 'err'}`}>
                <i className={`fas fa-${status.ok ? 'check-circle' : 'times-circle'}`} />
                {status.msg}
              </div>
            )}

            <button className="lfm-btn" onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <><i className="fas fa-spinner fa-spin" /> Connecting…</>
              ) : (
                <><i className="fab fa-lastfm" /> Connect to Last.fm</>
              )}
            </button>
          </div>
        )}

        {status && config && (
          <div className={`lfm-status ${status.ok ? 'ok' : 'err'}`}>
            <i className={`fas fa-${status.ok ? 'check-circle' : 'times-circle'}`} />
            {status.msg}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
};

export default LastfmSettings;
