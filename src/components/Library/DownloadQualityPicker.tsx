import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { DownloadQuality } from '../../types/offline';

interface QualityOption {
  value: DownloadQuality;
  label: string;
  desc: string;
  bars: number;
}

const DOWNLOAD_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'original', label: 'Original (Raw)', desc: 'No transcoding · Best quality',   bars: 6 },
  { value: '320',      label: '320 kbps',       desc: 'Excellent · Recommended',          bars: 6 },
  { value: '256',      label: '256 kbps',       desc: 'High quality · Good balance',      bars: 5 },
  { value: '128',      label: '128 kbps',       desc: 'Good quality · Smaller files',     bars: 3 },
  { value: '64',       label: '64 kbps',        desc: 'Low · Minimum storage',            bars: 2 },
];

interface Props {
  value: DownloadQuality;
  onChange: (quality: DownloadQuality) => void;
  /** When provided an extra confirm button is shown inside the modal */
  onConfirm?: () => void;
  confirmLabel?: string;
  /** Override the trigger button content */
  triggerContent?: React.ReactNode;
  triggerClassName?: string;
  disabled?: boolean;
}

const DownloadQualityPicker: React.FC<Props> = ({
  value,
  onChange,
  onConfirm,
  confirmLabel = 'Confirm',
  triggerContent,
  triggerClassName = 'dqp-trigger',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSelect = (option: QualityOption) => {
    onChange(option.value);
    if (!onConfirm) setOpen(false); // auto-close only when no confirm step
  };

  const handleConfirm = () => {
    onConfirm?.();
    setOpen(false);
  };

  const current = DOWNLOAD_QUALITY_OPTIONS.find(o => o.value === value) ?? DOWNLOAD_QUALITY_OPTIONS[1];

  return (
    <>
      {/* ── Trigger ─────────────────────────── */}
      <button
        className={triggerClassName}
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        title="Select download quality"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {triggerContent ?? (
          <>
            <i className="fas fa-download" />
            <span>{current.label}</span>
            <i className="fas fa-chevron-down" style={{ fontSize: 10, opacity: 0.6 }} />
          </>
        )}
      </button>

      {/* ── Modal (Portal) ──────────────────── */}
      {open && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setOpen(false)} />

          <div className="quality-picker-modal" role="listbox" aria-label="Select download quality">
            <div className="quality-picker-header">
              <span className="quality-picker-title">
                <i className="fas fa-download" />
                Download Quality
              </span>
              <button className="quality-picker-close" onClick={() => setOpen(false)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>

            <p className="quality-picker-hint">
              Choose quality for offline storage. Higher quality uses more space.
            </p>

            <div className="quality-picker-list">
              {DOWNLOAD_QUALITY_OPTIONS.map(option => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    className={`quality-picker-item${active ? ' active' : ''}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => handleSelect(option)}
                  >
                    <div className="quality-picker-bars">
                      {[1, 2, 3, 4, 5, 6].map(b => (
                        <div
                          key={b}
                          className={`quality-picker-bar${b <= option.bars ? ' active' : ''}`}
                          style={{ height: `${b * 4 + 2}px` }}
                        />
                      ))}
                    </div>
                    <div className="quality-picker-info">
                      <span className="quality-picker-name">{option.label}</span>
                      <span className="quality-picker-desc">{option.desc}</span>
                    </div>
                    {active && <i className="fas fa-check quality-picker-check" />}
                  </button>
                );
              })}
            </div>

            {/* Confirm button (for SongList two-step flow) */}
            {onConfirm && (
              <div className="quality-picker-confirm-row">
                <button className="quality-picker-cancel" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="quality-picker-confirm" onClick={handleConfirm}>
                  <i className="fas fa-download" />
                  {confirmLabel}
                </button>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default DownloadQualityPicker;
export { DOWNLOAD_QUALITY_OPTIONS };
