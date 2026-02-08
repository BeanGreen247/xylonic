import React, { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import './CustomThemeEditor.css';

interface CustomThemeEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

const CustomThemeEditor: React.FC<CustomThemeEditorProps> = ({ isOpen, onClose }) => {
  const { customThemes, updateCustomTheme, setTheme } = useTheme();
  const [selectedSlot, setSelectedSlot] = useState<'custom1' | 'custom2' | 'custom3' | 'custom4'>('custom1');
  const [themeName, setThemeName] = useState(customThemes[selectedSlot].name);
  const [color, setColor] = useState(customThemes[selectedSlot].primaryColor);

  if (!isOpen) return null;

  const handleSlotChange = (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4') => {
    setSelectedSlot(slot);
    setThemeName(customThemes[slot].name);
    setColor(customThemes[slot].primaryColor);
  };

  const handleSave = () => {
    updateCustomTheme(selectedSlot, color, themeName);
    setTheme(selectedSlot);
    onClose();
  };

  const handlePreview = () => {
    updateCustomTheme(selectedSlot, color, themeName);
    setTheme(selectedSlot);
  };

  return (
    <>
      <div className="custom-theme-overlay" onClick={onClose} />
      <div className="custom-theme-editor">
        <div className="custom-theme-header">
          <h2>
            <i className="fas fa-paint-brush"></i>
            Create Custom Theme
          </h2>
          <button className="close-button" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="custom-theme-content">
          <div className="theme-slot-selector">
            <label>Theme Slot:</label>
            <div className="slot-buttons">
              {(['custom1', 'custom2', 'custom3', 'custom4'] as const).map(slot => (
                <button
                  key={slot}
                  className={`slot-button ${selectedSlot === slot ? 'active' : ''}`}
                  onClick={() => handleSlotChange(slot)}
                >
                  {customThemes[slot].name}
                </button>
              ))}
            </div>
          </div>

          <div className="theme-editor-form">
            <div className="form-field">
              <label>Theme Name:</label>
              <input
                type="text"
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                placeholder="My Awesome Theme"
              />
            </div>

            <div className="form-field">
              <label>Primary Color:</label>
              <div className="color-picker-group">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="color-input"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#00bcd4"
                  className="color-hex-input"
                />
                <div 
                  className="color-preview"
                  style={{ backgroundColor: color }}
                />
              </div>
              <small>Other colors will be generated automatically</small>
            </div>

            <div className="theme-preview-section">
              <h3>Preview</h3>
              <div className="preview-swatches">
                <div className="swatch" style={{ backgroundColor: color }}>
                  <span>Primary</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="custom-theme-actions">
          <button className="preview-button" onClick={handlePreview}>
            <i className="fas fa-eye"></i>
            Preview
          </button>
          <button className="save-button" onClick={handleSave}>
            <i className="fas fa-save"></i>
            Save & Apply
          </button>
        </div>
      </div>
    </>
  );
};

export default CustomThemeEditor;
