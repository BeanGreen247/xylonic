import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { usePlayer } from '../../context/PlayerContext';
import './SpeedSelector.css';

const SPEEDS = [
  { value: 0.5,  label: '0.5×', desc: 'Half speed'     },
  { value: 0.75, label: '0.75×', desc: 'Slow'           },
  { value: 1.0,  label: '1×',    desc: 'Normal'         },
  { value: 1.25, label: '1.25×', desc: 'Slightly fast'  },
  { value: 1.5,  label: '1.5×',  desc: 'Fast'           },
  { value: 1.75, label: '1.75×', desc: 'Very fast'      },
  { value: 2.0,  label: '2×',    desc: 'Double speed'   },
];

const SpeedSelector: React.FC = () => {
  const { playbackSpeed, setPlaybackSpeed } = usePlayer();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const label = SPEEDS.find(s => s.value === playbackSpeed)?.label ?? `${playbackSpeed}×`;

  return (
    <>
      <button
        className="speed-selector-btn"
        onClick={() => setOpen(true)}
        title="Playback speed"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <i className="fas fa-bolt" />
        <span>{label}</span>
      </button>

      {open && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setOpen(false)} />
          <div className="quality-picker-modal" role="listbox" aria-label="Select playback speed">
            <div className="quality-picker-header">
              <span className="quality-picker-title">
                <i className="fas fa-bolt" />
                Playback Speed
              </span>
              <button className="quality-picker-close" onClick={() => setOpen(false)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="quality-picker-list">
              {SPEEDS.map(opt => {
                const active = opt.value === playbackSpeed;
                return (
                  <button
                    key={opt.value}
                    className={`quality-picker-item${active ? ' active' : ''}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => { setPlaybackSpeed(opt.value); setOpen(false); }}
                  >
                    <div className="speed-picker-icon">
                      <span>{opt.label}</span>
                    </div>
                    <div className="quality-picker-info">
                      <span className="quality-picker-name">{opt.label}</span>
                      <span className="quality-picker-desc">{opt.desc}</span>
                    </div>
                    {active && <i className="fas fa-check quality-picker-check" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
};

export default SpeedSelector;
