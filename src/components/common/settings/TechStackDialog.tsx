import React from 'react';
import ReactDOM from 'react-dom';
import { Capacitor } from '@capacitor/core';

interface BuildDeps {
  react?: string;
  typescript?: string;
  vite?: string;
  axios?: string;
  fontawesome?: string;
  electron?: string;
  electronBuilder?: string;
  capacitor?: string;
  androidMinSdk?: string | null;
  androidTargetSdk?: string | null;
}

interface TechStackDialogProps {
  open: boolean;
  onClose: () => void;
  deps: BuildDeps | undefined;
}

/** The Tech Stack modal, lifted out of SettingsView (WS-ARCH). */
const TechStackDialog: React.FC<TechStackDialogProps> = ({ open, onClose, deps: d }) => {
  if (!open) return null;

  const isAndroid = Capacitor.isNativePlatform();
  const items: { label: string; value: string | null }[] = [
    ...(isAndroid
      ? [{ label: 'Capacitor', value: d?.capacitor ?? null }]
      : [
          { label: 'Electron', value: d?.electron ?? null },
          { label: 'electron-builder', value: d?.electronBuilder ?? null },
        ]),
    { label: 'React', value: d?.react ?? null },
    { label: 'TypeScript', value: d?.typescript ?? null },
    { label: 'Vite', value: d?.vite ?? null },
    { label: 'Axios', value: d?.axios ?? null },
    { label: 'FontAwesome', value: d?.fontawesome ?? null },
    ...(isAndroid
      ? [
          { label: 'Android minSdk', value: d?.androidMinSdk ?? null },
          { label: 'Android targetSdk', value: d?.androidTargetSdk ?? null },
        ]
      : []),
  ];

  return ReactDOM.createPortal(
    <>
      <div className="quality-picker-backdrop" onClick={onClose} />
      <div className="quality-picker-modal" role="dialog" aria-label="Tech Stack">
        <div className="quality-picker-header">
          <span className="quality-picker-title">
            <i className={`fas fa-${isAndroid ? 'mobile-alt' : 'desktop'}`} /> Tech Stack
          </span>
          <button className="quality-picker-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="quality-picker-list">
          {items.map(({ label, value }) => (
            <div key={label} className="quality-picker-item" style={{ cursor: 'default' }}>
              <div className="quality-picker-info">
                <span className="quality-picker-name">{label}</span>
                <span className="quality-picker-desc">{value ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
};

export default TechStackDialog;
