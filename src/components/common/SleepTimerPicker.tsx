import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { usePlayer } from '../../context/PlayerContext';
import './SleepTimerPicker.css';

const SLEEP_OPTIONS = [
  { min: 15, label: '15 minutes', desc: 'Quick listen' },
  { min: 30, label: '30 minutes', desc: 'Half hour' },
  { min: 45, label: '45 minutes', desc: 'Wind down session' },
  { min: 60, label: '1 hour',     desc: 'Full hour' },
];

export function fmtSleepRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  onClose?: () => void;
  triggerClassName?: string;
  children?: React.ReactNode;
}

const SleepTimerPicker: React.FC<Props> = ({
  onClose,
  triggerClassName = 'sleep-timer-trigger',
  children,
}) => {
  const { sleepTimerRemaining, setSleepTimer } = usePlayer();
  const [open, setOpen] = useState(false);

  const isActive = sleepTimerRemaining !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => { setOpen(false); onClose?.(); };
  const handleSelect = (min: number) => { setSleepTimer(min); close(); };
  const handleCancel = () => { setSleepTimer(null); close(); };

  return (
    <>
      <button
        className={triggerClassName}
        onClick={() => setOpen(true)}
        title={isActive ? `Sleep timer — stops in ${fmtSleepRemaining(sleepTimerRemaining!)}` : 'Set sleep timer'}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {children ?? (
          <>
            <i className="fas fa-moon" />
            <span>{isActive ? `Stops in ${fmtSleepRemaining(sleepTimerRemaining!)}` : 'Sleep Timer'}</span>
            <i className="fas fa-chevron-down" style={{ fontSize: 10, opacity: 0.6 }} />
          </>
        )}
      </button>

      {open && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={close} />
          <div className="quality-picker-modal" role="listbox" aria-label="Sleep Timer">
            <div className="quality-picker-header">
              <span className="quality-picker-title">
                <i className="fas fa-moon" />
                Sleep Timer
              </span>
              <button className="quality-picker-close" onClick={close} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>

            <p className={`quality-picker-hint${isActive ? ' sleep-timer-hint--active' : ''}`}>
              {isActive
                ? <><i className="fas fa-moon" /> Stops in <strong>{fmtSleepRemaining(sleepTimerRemaining!)}</strong></>
                : 'Playback stops automatically after the selected time.'}
            </p>

            <div className="quality-picker-list">
              {isActive && (
                <button
                  className="quality-picker-item sleep-timer-item--cancel"
                  onClick={handleCancel}
                >
                  <div className="sleep-timer-item-icon sleep-timer-item-icon--cancel">
                    <i className="fas fa-times-circle" />
                  </div>
                  <div className="quality-picker-info">
                    <span className="quality-picker-name">Cancel Timer</span>
                    <span className="quality-picker-desc">Stop the countdown, keep playing</span>
                  </div>
                </button>
              )}

              {SLEEP_OPTIONS.map(option => (
                <button
                  key={option.min}
                  className="quality-picker-item"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelect(option.min)}
                >
                  <div className="sleep-timer-item-icon">
                    <i className="fas fa-moon" />
                  </div>
                  <div className="quality-picker-info">
                    <span className="quality-picker-name">{option.label}</span>
                    <span className="quality-picker-desc">{option.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default SleepTimerPicker;
