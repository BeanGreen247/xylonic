import { logger } from './logger';

interface UserSettings {
  theme: string;
  customThemes: Record<string, any>;
}

interface AllSettings {
  [username: string]: UserSettings;
}

/**
 * Parse CFG file to settings object
 * 
 * Format:
 * [kenny]
 * theme=custom1
 * 
 * [kenny.custom1]
 * name=kenny1
 * primaryColor=#d60072
 * ...
 */
export const parseCfg = (content: string): AllSettings => {
  console.log('=== CFG PARSING START ===');
  console.log('Content length:', content.length);
  console.log('Content:', content);
  
  const settings: AllSettings = {};
  const lines = content.split('\n');
  
  console.log('Total lines:', lines.length);
  
  let currentSection = '';
  let currentUser = '';
  let currentThemeSlot = '';
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    
    // Section header [username] or [username.themeSlot]
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      console.log(`Line ${i}: Section [${currentSection}]`);
      
      if (currentSection.includes('.')) {
        // [kenny.custom1]
        const parts = currentSection.split('.');
        currentUser = parts[0];
        currentThemeSlot = parts[1];
        
        console.log(`  Theme section: user=${currentUser}, slot=${currentThemeSlot}`);
        
        if (!settings[currentUser]) {
          settings[currentUser] = { theme: 'cyan', customThemes: {} };
        }
        if (!settings[currentUser].customThemes[currentThemeSlot]) {
          settings[currentUser].customThemes[currentThemeSlot] = { isCustom: true };
        }
      } else {
        // [kenny]
        currentUser = currentSection;
        currentThemeSlot = '';
        
        console.log(`  User section: ${currentUser}`);
        
        if (!settings[currentUser]) {
          settings[currentUser] = { theme: 'cyan', customThemes: {} };
        }
      }
      continue;
    }
    
    // Key=value pair
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    
    const key = line.substring(0, eqIndex).trim();
    const value = line.substring(eqIndex + 1).trim();
    
    console.log(`Line ${i}: ${key}=${value} (user=${currentUser}, slot=${currentThemeSlot})`);
    
    if (!currentUser) continue;
    
    if (currentThemeSlot) {
      // Theme property
      settings[currentUser].customThemes[currentThemeSlot][key] = value;
    } else {
      // User-level property
      if (key === 'theme') {
        settings[currentUser].theme = value;
        console.log(`  Set theme for ${currentUser}: ${value}`);
      }
    }
  }
  
  console.log('=== CFG PARSING END ===');
  console.log('Final settings:', JSON.stringify(settings, null, 2));
  return settings;
};

/**
 * Convert settings object to CFG format
 */
export const stringifyCfg = (settings: AllSettings): string => {
  let content = '# Xylonic Settings File\n';
  content += '# Generated automatically - edit with care\n\n';
  
  for (const username of Object.keys(settings)) {
    const userSettings = settings[username];
    
    // User section
    content += `[${username}]\n`;
    content += `theme=${userSettings.theme}\n\n`;
    
    // Custom themes sections
    for (const themeSlot of ['custom1', 'custom2', 'custom3', 'custom4']) {
      if (userSettings.customThemes[themeSlot]) {
        const theme = userSettings.customThemes[themeSlot];
        content += `[${username}.${themeSlot}]\n`;
        content += `name=${theme.name}\n`;
        content += `primaryColor=${theme.primaryColor}\n`;
        content += `primaryLight=${theme.primaryLight}\n`;
        content += `primaryDark=${theme.primaryDark}\n`;
        content += `secondaryColor=${theme.secondaryColor}\n`;
        content += `secondaryLight=${theme.secondaryLight}\n`;
        content += `secondaryDark=${theme.secondaryDark}\n`;
        content += `accentColor=${theme.accentColor}\n`;
        content += `accentLight=${theme.accentLight}\n`;
        content += `isCustom=${theme.isCustom}\n\n`;
      }
    }
  }
  
  return content;
};
