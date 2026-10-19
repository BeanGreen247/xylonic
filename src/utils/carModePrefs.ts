/** How Car Mode lays itself out: 'auto' goes minimal on very small screens, the others force a layout. */
export type CarLayout = 'auto' | 'minimal' | 'full';

export const CAR_LAYOUT_KEY = 'xylonic_car_mode_layout';
export const CAR_LAYOUT_ORDER: CarLayout[] = ['auto', 'minimal', 'full'];

export function readCarLayout(): CarLayout {
  try {
    const value = localStorage.getItem(CAR_LAYOUT_KEY);
    if (value === 'minimal' || value === 'full') return value;
  } catch { /* storage unavailable */ }
  return 'auto';
}

export function writeCarLayout(layout: CarLayout): void {
  try { localStorage.setItem(CAR_LAYOUT_KEY, layout); } catch { /* storage unavailable */ }
}

/** Keep the screen on (no sleep, no auto-lock) while Car Mode is open. On unless switched off. */
export const CAR_KEEP_AWAKE_KEY = 'xylonic_car_mode_keep_awake';

export function readKeepAwake(): boolean {
  try { return localStorage.getItem(CAR_KEEP_AWAKE_KEY) !== 'false'; } catch { return true; }
}

export function writeKeepAwake(enabled: boolean): void {
  try { localStorage.setItem(CAR_KEEP_AWAKE_KEY, String(enabled)); } catch { /* storage unavailable */ }
}
