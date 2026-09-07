import React from 'react';
import ReactDOM from 'react-dom';
import { Capacitor } from '@capacitor/core';

interface LicensesDialogProps {
  open: boolean;
  onClose: () => void;
  activeTab: string;
  onTabChange: (key: string) => void;
  licenses: Record<string, { spdx: string; text: string }> | null;
}

/** The Licenses modal, lifted out of SettingsView (WS-ARCH). */
const LicensesDialog: React.FC<LicensesDialogProps> = ({
  open,
  onClose,
  activeTab,
  onTabChange,
  licenses,
}) => {
  if (!open) return null;

  const isAndroid = Capacitor.isNativePlatform();
  const tabs: { key: string; label: string }[] = [
    { key: 'xylonic', label: 'Xylonic' },
    ...(isAndroid
      ? [{ key: 'capacitor', label: 'Capacitor' }]
      : [
          { key: 'electron', label: 'Electron' },
          { key: 'electronBuilder', label: 'electron-builder' },
        ]),
    { key: 'react', label: 'React' },
    { key: 'typescript', label: 'TypeScript' },
    { key: 'vite', label: 'Vite' },
    { key: 'axios', label: 'Axios' },
    { key: 'fontawesome', label: 'FontAwesome' },
  ];
  const entry = licenses?.[activeTab];

  return ReactDOM.createPortal(
    <>
      <div className="quality-picker-backdrop" onClick={onClose} />
      <div className="quality-picker-modal lic-modal" role="dialog" aria-label="Licenses">
        <div className="quality-picker-header">
          <span className="quality-picker-title">
            <i className="fas fa-balance-scale" /> Licenses
          </span>
          <button className="quality-picker-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="lic-layout">
          <div className="lic-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`lic-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="lic-body">
            {entry ? (
              <>
                <span className="lic-spdx">{entry.spdx}</span>
                <pre className="lic-text">{entry.text}</pre>
              </>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default LicensesDialog;
