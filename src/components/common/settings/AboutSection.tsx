import React, { useEffect, useState } from 'react';
import LicensesDialog from './LicensesDialog';
import TechStackDialog from './TechStackDialog';

interface BuildInfo {
  version: string;
  buildType: string;
  buildNumber: string | null;
  builtAt: string | null;
  deps?: {
    react: string; typescript: string; vite: string; axios: string; fontawesome: string;
    electron: string; electronBuilder: string; capacitor: string;
    androidMinSdk: string | null; androidTargetSdk: string | null;
  };
}

/**
 * Settings → About. Self-contained: owns the build-info / licenses fetch and the
 * Tech Stack + Licenses dialogs. No props — split out of `SettingsView` (WS-ARCH).
 */
const AboutSection: React.FC = () => {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [showTechStack, setShowTechStack] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [licTab, setLicTab] = useState('xylonic');
  const [licenses, setLicenses] = useState<Record<string, { spdx: string; text: string }> | null>(null);

  useEffect(() => {
    fetch('./build-info.json')
      .then(r => r.json())
      .then(setBuildInfo)
      .catch(() => {});
    fetch('./licenses.json')
      .then(r => r.json())
      .then(setLicenses)
      .catch(() => {});
  }, []);

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">About</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-info-circle" /></span>
            <span className="settings-row-label">Version</span>
            <span className="settings-row-action">
              <span className="settings-badge">{buildInfo?.version ?? '—'}</span>
            </span>
          </div>
          {buildInfo && (
            <>
              <div className="settings-divider" />
              <div className="settings-row non-interactive">
                <span className="settings-row-icon">
                  <i className={`fas fa-${buildInfo.buildType === 'debug' ? 'bug' : 'box'}`} />
                </span>
                <span className="settings-row-label">
                  Build Type
                  {buildInfo.buildNumber && (
                    <span className="settings-row-sub">#{buildInfo.buildNumber}</span>
                  )}
                </span>
                <span className="settings-row-action">
                  <span className={`settings-badge ${buildInfo.buildType === 'debug' ? '' : 'on'}`}>
                    {buildInfo.buildType === 'debug' ? 'Debug' : 'Release'}
                  </span>
                </span>
              </div>
              {buildInfo.builtAt && (
                <>
                  <div className="settings-divider" />
                  <div className="settings-row non-interactive">
                    <span className="settings-row-icon"><i className="fas fa-calendar-alt" /></span>
                    <span className="settings-row-label">
                      Built
                      <span className="settings-row-sub">{new Date(buildInfo.builtAt).toLocaleString()}</span>
                    </span>
                  </div>
                </>
              )}
            </>
          )}
          <div className="settings-divider" />
          <button className="settings-row" onClick={() => setShowTechStack(true)}>
            <span className="settings-row-icon"><i className="fas fa-layer-group" /></span>
            <span className="settings-row-label">Tech Stack</span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </button>
          <div className="settings-divider" />
          <button className="settings-row" onClick={() => { setLicTab('xylonic'); setShowLicenses(true); }}>
            <span className="settings-row-icon"><i className="fas fa-balance-scale" /></span>
            <span className="settings-row-label">Licenses</span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </button>
        </div>
      </section>

      <LicensesDialog
        open={showLicenses}
        onClose={() => setShowLicenses(false)}
        activeTab={licTab}
        onTabChange={setLicTab}
        licenses={licenses}
      />

      <TechStackDialog
        open={showTechStack}
        onClose={() => setShowTechStack(false)}
        deps={buildInfo?.deps}
      />
    </>
  );
};

export default AboutSection;
