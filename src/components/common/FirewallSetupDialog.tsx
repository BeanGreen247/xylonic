import React, { useState, useEffect } from 'react';
import './FirewallSetupDialog.css';

interface Props {
  onClose(): void;
}

type LinuxTool = 'ufw' | 'firewalld' | 'nftables' | 'iptables';

const LINUX_SECTIONS: { id: LinuxTool; label: string; commands: string }[] = [
  {
    id: 'ufw',
    label: 'ufw (Ubuntu / Debian)',
    commands:
      'sudo ufw allow 7766/udp comment \'Xylonic Remote Discovery\'\n' +
      'sudo ufw allow 7767/tcp comment \'Xylonic Remote Control\'\n' +
      'sudo ufw reload',
  },
  {
    id: 'firewalld',
    label: 'firewalld (Fedora / RHEL / Arch)',
    commands:
      'sudo firewall-cmd --permanent --add-port=7766/udp\n' +
      'sudo firewall-cmd --permanent --add-port=7767/tcp\n' +
      'sudo firewall-cmd --reload',
  },
  {
    id: 'nftables',
    label: 'nftables',
    commands:
      'sudo nft add rule inet filter input udp dport 7766 accept\n' +
      'sudo nft add rule inet filter input tcp dport 7767 accept',
  },
  {
    id: 'iptables',
    label: 'iptables',
    commands:
      'sudo iptables -I INPUT -p udp --dport 7766 -j ACCEPT\n' +
      'sudo iptables -I INPUT -p tcp --dport 7767 -j ACCEPT\n' +
      '# Persist on Debian/Ubuntu:\n' +
      'sudo iptables-save | sudo tee /etc/iptables/rules.v4\n' +
      '# Persist on RHEL/Fedora:\n' +
      'sudo service iptables save',
  },
];

const WIN_CMD =
  'netsh advfirewall firewall add rule name="Xylonic Remote Discovery" dir=in action=allow protocol=udp localport=7766\n' +
  'netsh advfirewall firewall add rule name="Xylonic Remote Control" dir=in action=allow protocol=tcp localport=7767';

const WIN_PS =
  'New-NetFirewallRule -DisplayName "Xylonic Remote Discovery" -Direction Inbound -Protocol UDP -LocalPort 7766 -Action Allow\n' +
  'New-NetFirewallRule -DisplayName "Xylonic Remote Control" -Direction Inbound -Protocol TCP -LocalPort 7767 -Action Allow';

const FirewallSetupDialog: React.FC<Props> = ({ onClose }) => {
  const [platform, setPlatform]         = useState<string>('');
  const [detected, setDetected]         = useState<LinuxTool[]>([]);
  const [activeTab, setActiveTab]       = useState<LinuxTool | 'cmd' | 'ps'>('ufw');
  const [copiedKey, setCopiedKey]       = useState<string>('');

  useEffect(() => {
    const el = (window as any).electron;
    if (!el) return;

    el.getOsPlatform().then((p: string) => {
      setPlatform(p);
      if (p === 'linux') {
        el.detectLinuxFirewall().then((tools: LinuxTool[]) => {
          setDetected(tools);
          if (tools.length > 0) setActiveTab(tools[0]);
        });
      } else if (p === 'win32') {
        setActiveTab('cmd');
      }
    }).catch(() => {});
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    }).catch(() => {});
  };

  const isLinux   = platform === 'linux';
  const isWindows = platform === 'win32';

  const linuxTabs = LINUX_SECTIONS.map(s => ({
    ...s,
    installed: detected.includes(s.id),
  }));

  return (
    <div className="fwd-overlay" onClick={onClose}>
      <div className="fwd-modal" onClick={e => e.stopPropagation()}>
        <div className="fwd-header">
          <span className="fwd-title">
            <i className="fas fa-shield-alt" />
            Firewall Setup
          </span>
          <button className="fwd-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="fwd-body">
          <p className="fwd-intro">
            Remote mode uses <strong>UDP 7766</strong> (LAN discovery) and{' '}
            <strong>TCP 7767</strong> (command channel). Open both inbound ports
            on this machine so other devices on the same network can reach it.
          </p>

          {!platform && (
            <p className="fwd-detecting">Detecting platform…</p>
          )}

          {/* ── Linux ── */}
          {isLinux && (
            <>
              <div className="fwd-tabs">
                {linuxTabs.map(s => (
                  <button
                    key={s.id}
                    className={`fwd-tab ${activeTab === s.id ? 'active' : ''} ${s.installed ? 'installed' : ''}`}
                    onClick={() => setActiveTab(s.id)}
                  >
                    {s.label}
                    {s.installed && <span className="fwd-installed-dot" title="Detected on this system" />}
                  </button>
                ))}
              </div>

              {linuxTabs.map(s => activeTab === s.id && (
                <div key={s.id} className="fwd-block">
                  {s.installed && (
                    <div className="fwd-detected-badge">
                      <i className="fas fa-check-circle" /> Detected on this system
                    </div>
                  )}
                  <pre className="fwd-code">{s.commands}</pre>
                  <button className="fwd-copy-btn" onClick={() => copy(s.commands, s.id)}>
                    <i className={`fas fa-${copiedKey === s.id ? 'check' : 'copy'}`} />
                    {copiedKey === s.id ? 'Copied!' : 'Copy commands'}
                  </button>
                </div>
              ))}

              <p className="fwd-note">
                Run the commands in a terminal. If none of the above tools are installed,
                your distribution may not have a firewall enabled by default — remote mode
                should already work.
              </p>
            </>
          )}

          {/* ── Windows ── */}
          {isWindows && (
            <>
              <div className="fwd-tabs">
                <button className={`fwd-tab ${activeTab === 'cmd' ? 'active' : ''}`} onClick={() => setActiveTab('cmd')}>
                  Command Prompt (Admin)
                </button>
                <button className={`fwd-tab ${activeTab === 'ps' ? 'active' : ''}`} onClick={() => setActiveTab('ps')}>
                  PowerShell (Admin)
                </button>
              </div>

              {activeTab === 'cmd' && (
                <div className="fwd-block">
                  <pre className="fwd-code">{WIN_CMD}</pre>
                  <button className="fwd-copy-btn" onClick={() => copy(WIN_CMD, 'cmd')}>
                    <i className={`fas fa-${copiedKey === 'cmd' ? 'check' : 'copy'}`} />
                    {copiedKey === 'cmd' ? 'Copied!' : 'Copy commands'}
                  </button>
                </div>
              )}
              {activeTab === 'ps' && (
                <div className="fwd-block">
                  <pre className="fwd-code">{WIN_PS}</pre>
                  <button className="fwd-copy-btn" onClick={() => copy(WIN_PS, 'ps')}>
                    <i className={`fas fa-${copiedKey === 'ps' ? 'check' : 'copy'}`} />
                    {copiedKey === 'ps' ? 'Copied!' : 'Copy commands'}
                  </button>
                </div>
              )}

              <p className="fwd-note">
                Open an elevated prompt: press <kbd>Win+R</kbd>, type{' '}
                <code>cmd</code> or <code>powershell</code>, then{' '}
                <kbd>Ctrl+Shift+Enter</kbd> to run as Administrator.
                Alternatively, search <em>Windows Defender Firewall with Advanced
                Security</em> and add two inbound rules manually (UDP 7766 and TCP 7767).
              </p>
            </>
          )}

          {/* Unknown platform fallback */}
          {platform && !isLinux && !isWindows && (
            <p className="fwd-note">
              Firewall setup instructions are available for Linux and Windows.
              Open UDP port 7766 and TCP port 7767 inbound using your system's
              firewall manager.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default FirewallSetupDialog;
