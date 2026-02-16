import React from 'react';
import './KeyboardHelp.css';

interface KeyboardHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardHelp: React.FC<KeyboardHelpProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', action: 'Play / Pause' },
    { key: 'Shift + →', action: 'Next Track' },
    { key: 'Shift + ←', action: 'Previous Track' },
    { key: '→', action: 'Seek Forward 5s' },
    { key: '←', action: 'Seek Backward 5s' },
    { key: 'Shift + ↑', action: 'Volume Up 10%' },
    { key: 'Shift + ↓', action: 'Volume Down 10%' },
    { key: 'S', action: 'Toggle Shuffle' },
    { key: 'R', action: 'Toggle Repeat' },
    { key: 'M', action: 'Mute / Unmute' },
    { key: 'Ctrl + M', action: 'Toggle Mini Player' },
  ];

  return (
    <>
      <div className="keyboard-help-overlay" onClick={onClose} />
      <div className="keyboard-help-modal">
        <div className="keyboard-help-header">
          <h2>
            <i className="fas fa-keyboard"></i>
            Keyboard Shortcuts
          </h2>
          <button className="close-button" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="keyboard-help-content">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="shortcut-row">
              <kbd className="shortcut-key">{shortcut.key}</kbd>
              <span className="shortcut-action">{shortcut.action}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default KeyboardHelp;
