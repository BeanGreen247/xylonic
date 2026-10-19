import { describe, it, expect } from 'vitest';
import { contrastRatio, ensureContrast, onColor } from './colorContrast';

describe('colorContrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('leaves already-readable colours alone', () => {
    expect(ensureContrast('#4caf50', '#2a2a2a', 4.5)).toBe('#4caf50');
  });

  it('darkens a light-mode accent until it reaches the target', () => {
    const fixed = ensureContrast('#00bcd4', '#f0f0f2', 4.5);
    expect(fixed).not.toBe('#00bcd4');
    expect(contrastRatio(fixed, '#f0f0f2')).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a dark-mode accent until it reaches the target', () => {
    const fixed = ensureContrast('#9c27b0', '#2a2a2a', 4.5);
    expect(contrastRatio(fixed, '#2a2a2a')).toBeGreaterThanOrEqual(4.5);
  });

  it('picks the more readable text colour', () => {
    expect(onColor('#ffeb3b')).toBe('#000000');
    expect(onColor('#1a237e')).toBe('#ffffff');
  });
});

import { blend, deriveNeutrals } from './colorContrast';
import { presetThemes } from '../types/theme';

describe('deriveNeutrals — every preset, both modes', () => {
  const surfaces = {
    dark: { surface: '#1e1e1e', variant: '#2a2a2a' },
    light: { surface: '#ffffff', variant: '#f0f0f2' },
  } as const;

  for (const mode of ['dark', 'light'] as const) {
    for (const [key, theme] of Object.entries(presetThemes)) {
      it(`${key} / ${mode}`, () => {
        const n = deriveNeutrals(mode, theme.primaryColor);
        const s = surfaces[mode];
        const tinted = [blend(theme.primaryColor, s.surface, 0.16), blend(theme.primaryColor, s.variant, 0.22)];
        const bgs = [s.surface, s.variant, ...tinted];
        for (const bg of bgs) {
          expect(contrastRatio(n.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(n.textSecondary, bg)).toBeGreaterThanOrEqual(contrastRatio(n.textMuted, bg) - 0.01);
          expect(contrastRatio(n.accent, bg)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
