import React, { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { ThemeType } from '../../types/theme';
import CustomThemeEditor from './CustomThemeEditor';
import './ThemeSelector.css';

const ThemeSelector: React.FC = () => {
  const { currentTheme, setTheme, getAllThemes, resetCustomTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const handleThemeChange = (theme: ThemeType) => {
    setTheme(theme);
    setIsOpen(false);
  };

  const handleDeleteCustomTheme = (slot: 'custom1' | 'custom2' | 'custom3' | 'custom4', e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent theme selection when clicking delete
    
    // Switch to default theme if deleting the current theme
    if (currentTheme === slot) {
      setTheme('cyan');
    }
    
    resetCustomTheme(slot);
  };

  const allThemes = getAllThemes();
  const presetKeys = ['cyan', 'purple', 'green', 'red', 'blue', 'orange', 'pink', 'teal'];
  const customKeys = ['custom1', 'custom2', 'custom3', 'custom4'];

  return (
    <>
      <button 
        className="theme-selector-button"
        onClick={() => setIsOpen(true)}
        title="Change theme"
      >
        <i className="fas fa-palette"></i>
        <span>Theme</span>
      </button>

      {isOpen && (
        <>
          <div className="theme-modal-overlay" onClick={() => setIsOpen(false)} />
          <div className="theme-modal">
            <div className="theme-modal-header">
              <h2>
                <i className="fas fa-palette"></i>
                Choose Theme
              </h2>
              <button className="close-button" onClick={() => setIsOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="theme-modal-content">
              <div className="theme-section">
                <div className="theme-section-title">Preset Themes</div>
                <div className="theme-grid">
                  {presetKeys.map((themeKey) => (
                    <button
                      key={themeKey}
                      className={`theme-card ${currentTheme === themeKey ? 'active' : ''}`}
                      onClick={() => handleThemeChange(themeKey as ThemeType)}
                    >
                      <div 
                        className="theme-card-preview"
                        style={{ backgroundColor: allThemes[themeKey].primaryColor }}
                      >
                        {currentTheme === themeKey && (
                          <i className="fas fa-check theme-card-check"></i>
                        )}
                      </div>
                      <span className="theme-card-name">{allThemes[themeKey].name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="theme-section">
                <div className="theme-section-title">Custom Themes</div>
                <div className="theme-grid">
                  {customKeys.map((themeKey) => (
                    <div
                      key={themeKey}
                      className={`theme-card theme-card-deletable ${currentTheme === themeKey ? 'active' : ''}`}
                      onClick={() => handleThemeChange(themeKey as ThemeType)}
                    >
                      <button
                        className="theme-card-delete"
                        onClick={(e) => handleDeleteCustomTheme(themeKey as 'custom1' | 'custom2' | 'custom3' | 'custom4', e)}
                        title="Reset to default"
                        type="button"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                      <div 
                        className="theme-card-preview"
                        style={{ backgroundColor: allThemes[themeKey].primaryColor }}
                      >
                        {currentTheme === themeKey && (
                          <i className="fas fa-check theme-card-check"></i>
                        )}
                      </div>
                      <span className="theme-card-name">{allThemes[themeKey].name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                className="create-theme-button"
                onClick={() => {
                  setIsOpen(false);
                  setShowEditor(true);
                }}
              >
                <i className="fas fa-palette"></i>
                Edit Custom Themes
              </button>
            </div>
          </div>
        </>
      )}

      <CustomThemeEditor 
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
      />
    </>
  );
};

export default ThemeSelector;
