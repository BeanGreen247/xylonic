import React from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
// Only the solid family is used (`fas fa-*`); the two brand glyphs the app needs
// (github, lastfm) are inlined in `components/common/BrandGlyph` and the regular
// family has zero call sites — so we skip `all.min.css` and drop the
// fa-brands-400 (110 kB) + fa-regular-400 (19 kB) webfonts (WS-PERF).
// `fa-solid-subset.css` replaces FA's `solid.min.css`: same @font-face rule but
// pointing at a ~8 kB subset (~104 glyphs the app references) instead of the
// full 112 kB fa-solid-900 webfont. Regenerate with `npm run fa:subset`.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css';
import './styles/fa-solid-subset.css';
import './styles/index.css';
import App from './App';
import { initPerfMode } from './services/perfModeService';
import { persistentCache } from './services/persistentCache';
import { logger } from './utils/logger';

// Bound every request so a hung socket (common in WKWebView right after an
// offline→online transition) rejects instead of leaving a view spinning forever.
axios.defaults.timeout = 15000;

// Fire a global event on any axios network-level failure so App.tsx can offer
// offline mode regardless of which library component triggered the request.
axios.interceptors.response.use(
  r => r,
  err => {
    // ECONNABORTED = the timeout above fired on a hung request; treat it like a
    // network failure so App.tsx re-checks connectivity and offers offline mode.
    if (err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED' || err?.message === 'Network Error') {
      window.dispatchEvent(new CustomEvent('app:connectivity-error'));
    }
    return Promise.reject(err);
  }
);

initPerfMode();

if (Capacitor.getPlatform() === 'ios') {
  document.body.classList.add('ios-platform');
  logger.log(`[Xylonic] iOS viewport ${window.innerWidth}×${window.innerHeight} dpr=${window.devicePixelRatio}`);

  // WKWebView respects maximum-scale=1 in the viewport meta (unlike Safari browser),
  // but gesture events can still fire before the meta is parsed. Belt-and-suspenders:
  // block all multi-touch zoom gestures at the JS level too.
  const blockZoom = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart',  blockZoom, { passive: false });
  document.addEventListener('gesturechange', blockZoom, { passive: false });
  document.addEventListener('gestureend',    blockZoom, { passive: false });
}

const container = document.getElementById('root');
const root = createRoot(container!);

// Hydrate the persistent metadata cache (IndexedDB → memory) before first paint
// so library views render from disk instead of skeletons on a warm launch.
// Capped so a slow IDB can never stall startup by more than 200 ms.
Promise.race([
  persistentCache.init(),
  new Promise((resolve) => setTimeout(resolve, 200)),
]).finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});