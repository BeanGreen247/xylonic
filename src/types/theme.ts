export type ThemeType = 'cyan' | 'purple' | 'green' | 'red' | 'blue' | 'orange' | 'pink' | 'teal' | 'custom1' | 'custom2' | 'custom3' | 'custom4';

export interface Theme {
  name: string;
  primaryColor: string;
  primaryLight: string;
  primaryDark: string;
  secondaryColor: string;
  secondaryLight: string;
  secondaryDark: string;
  accentColor: string;
  accentLight: string;
  isCustom?: boolean;
}

export const presetThemes: Record<string, Theme> = {
  cyan: {
    name: 'Cyan Wave',
    primaryColor: '#00bcd4',
    primaryLight: '#4dd0e1',
    primaryDark: '#0097a7',
    secondaryColor: '#03a9f4',
    secondaryLight: '#4fc3f7',
    secondaryDark: '#0288d1',
    accentColor: '#00e5ff',
    accentLight: '#84ffff',
  },
  purple: {
    name: 'Purple Dream',
    primaryColor: '#9c27b0',
    primaryLight: '#ba68c8',
    primaryDark: '#7b1fa2',
    secondaryColor: '#ab47bc',
    secondaryLight: '#ce93d8',
    secondaryDark: '#8e24aa',
    accentColor: '#e040fb',
    accentLight: '#ea80fc',
  },
  green: {
    name: 'Forest Green',
    primaryColor: '#4caf50',
    primaryLight: '#81c784',
    primaryDark: '#388e3c',
    secondaryColor: '#66bb6a',
    secondaryLight: '#a5d6a7',
    secondaryDark: '#43a047',
    accentColor: '#69f0ae',
    accentLight: '#b9f6ca',
  },
  red: {
    name: 'Crimson Fire',
    primaryColor: '#f44336',
    primaryLight: '#e57373',
    primaryDark: '#d32f2f',
    secondaryColor: '#ef5350',
    secondaryLight: '#ef9a9a',
    secondaryDark: '#c62828',
    accentColor: '#ff5252',
    accentLight: '#ff8a80',
  },
  blue: {
    name: 'Ocean Blue',
    primaryColor: '#2196f3',
    primaryLight: '#64b5f6',
    primaryDark: '#1976d2',
    secondaryColor: '#42a5f5',
    secondaryLight: '#90caf9',
    secondaryDark: '#1565c0',
    accentColor: '#448aff',
    accentLight: '#82b1ff',
  },
  orange: {
    name: 'Sunset Orange',
    primaryColor: '#ff9800',
    primaryLight: '#ffb74d',
    primaryDark: '#f57c00',
    secondaryColor: '#ffa726',
    secondaryLight: '#ffcc80',
    secondaryDark: '#ef6c00',
    accentColor: '#ffab40',
    accentLight: '#ffd180',
  },
  pink: {
    name: 'Bubblegum Pink',
    primaryColor: '#e91e63',
    primaryLight: '#f06292',
    primaryDark: '#c2185b',
    secondaryColor: '#ec407a',
    secondaryLight: '#f48fb1',
    secondaryDark: '#ad1457',
    accentColor: '#ff4081',
    accentLight: '#ff80ab',
  },
  teal: {
    name: 'Tropical Teal',
    primaryColor: '#009688',
    primaryLight: '#4db6ac',
    primaryDark: '#00796b',
    secondaryColor: '#26a69a',
    secondaryLight: '#80cbc4',
    secondaryDark: '#00695c',
    accentColor: '#64ffda',
    accentLight: '#a7ffeb',
  },
};

// Helper to generate lighter/darker variants from a base color
export const generateColorVariants = (baseColor: string): { light: string; dark: string } => {
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const light = `#${Math.min(255, r + 50).toString(16).padStart(2, '0')}${Math.min(255, g + 50).toString(16).padStart(2, '0')}${Math.min(255, b + 50).toString(16).padStart(2, '0')}`;
  const dark = `#${Math.max(0, r - 50).toString(16).padStart(2, '0')}${Math.max(0, g - 50).toString(16).padStart(2, '0')}${Math.max(0, b - 50).toString(16).padStart(2, '0')}`;

  return { light, dark };
};
