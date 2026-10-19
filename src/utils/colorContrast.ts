/** WCAG contrast helpers used to keep theme accents readable in both light and dark mode. */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 21;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Returns `hex` unchanged when it already reaches `min` contrast against `bg`;
 * otherwise walks its lightness (keeping hue and saturation) away from the
 * background until it does — lighter on dark backgrounds, darker on light ones.
 */
export function ensureContrast(hex: string, bg: string, min: number): string {
  const rgb = parseHex(hex);
  if (!rgb || contrastRatio(hex, bg) >= min) return hex;
  const bgRgb = parseHex(bg);
  if (!bgRgb) return hex;
  const [h, s, l] = rgbToHsl(rgb);
  const lighten = luminance(bgRgb) < 0.4;
  let best = hex;
  for (let step = 1; step <= 100; step += 1) {
    const nl = lighten ? Math.min(1, l + step / 100) : Math.max(0, l - step / 100);
    best = toHex(...hslToRgb(h, s, nl));
    if (contrastRatio(best, bg) >= min) return best;
    if (nl === 0 || nl === 1) break;
  }
  return best;
}

/** Text colour (black or white) that reads best on top of `hex`. */
export function onColor(hex: string): '#000000' | '#ffffff' {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

export function hexToRgbTriplet(hex: string): string {
  const c = parseHex(hex);
  return c ? c.join(', ') : '0, 188, 212';
}

// ── Theme-aware neutrals ─────────────────────────────────────────────────────

const MODE_SURFACES = {
  dark: { surface: '#1e1e1e', variant: '#2a2a2a', bg: '#121212', ink: '#ffffff' },
  light: { surface: '#ffffff', variant: '#f0f0f2', bg: '#f7f7f8', ink: '#1b1b1f' },
} as const;

/** Mixes `fg` over `bg` at `alpha` (0..1) and returns the resulting solid colour. */
export function blend(fg: string, bg: string, alpha: number): string {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return bg;
  return toHex(a[0] * alpha + b[0] * (1 - alpha), a[1] * alpha + b[1] * (1 - alpha), a[2] * alpha + b[2] * (1 - alpha));
}

/** Every background grey text / borders can land on: the plain surfaces plus accent-tinted hover/selected fills. */
function backdrops(mode: 'light' | 'dark', accent: string): string[] {
  const m = MODE_SURFACES[mode];
  return [
    m.surface, m.variant, m.bg,
    blend(accent, m.surface, 0.16), blend(accent, m.variant, 0.22),
  ];
}

const worstContrast = (fg: string, bgs: string[]) => Math.min(...bgs.map(b => contrastRatio(fg, b)));

export interface ThemeNeutrals {
  /** Accent shade readable on plain *and* accent-tinted surfaces (selected rows, active chips). */
  accent: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
}

/**
 * Derives the neutral tokens for a theme colour in a mode. The greys are mixed
 * from the mode's ink colour towards the surface just far enough that they meet
 * their target against the worst backdrop that colour creates, so a bright
 * orange or a deep red never leaves muted text or borders unreadable.
 *   secondary text ≥ 7:1 (best effort), muted text ≥ 4.5:1,
 *   border ≥ 1.8:1, strong border ≥ 3:1 (best effort).
 */
export function deriveNeutrals(mode: 'light' | 'dark', accentHex: string): ThemeNeutrals {
  const m = MODE_SURFACES[mode];
  // Tinted fills (hover/selected) keep the theme's own hue — they are built from
  // the original colour, not the adjusted one — so they are a fixed target the
  // accent shade is pushed against, with no feedback loop.
  const bgs = backdrops(mode, accentHex);
  let accent = ensureContrast(accentHex, m.variant, 4.5);
  for (const bg of bgs) accent = ensureContrast(accent, bg, 4.5);

  const ink = (floor: number, target: number): string => {
    for (let t = floor; t <= 1.0001; t += 0.02) {
      const c = blend(m.ink, m.surface, Math.min(1, t));
      if (worstContrast(c, bgs) >= target) return c;
    }
    return m.ink;
  };
  const edge = (floor: number, target: number): string => {
    for (let a = floor; a <= 0.6; a += 0.01) {
      if (Math.min(...bgs.map(b => contrastRatio(blend(m.ink, b, a), b))) >= target) {
        const [r, g, b] = parseHex(m.ink) as [number, number, number];
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
      }
    }
    const [r, g, b] = parseHex(m.ink) as [number, number, number];
    return `rgba(${r}, ${g}, ${b}, 0.6)`;
  };

  return {
    accent,
    textSecondary: ink(0.7, 7),
    textMuted: ink(0.55, 4.5),
    border: edge(0.2, 1.8),
    borderStrong: edge(0.32, 3),
  };
}
