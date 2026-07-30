import React from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/index.css';
import App from './App';
import { initPerformanceMode } from './services/performanceModeService';
import { initPowerSaverMode } from './services/powerSaverService';

// Fire a global event on any axios network-level failure so App.tsx can offer
// offline mode regardless of which library component triggered the request.
axios.interceptors.response.use(
  r => r,
  err => {
    if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
      window.dispatchEvent(new CustomEvent('app:connectivity-error'));
    }
    return Promise.reject(err);
  }
);

// Power saver takes precedence: run it last so it wins if somehow both are saved.
initPerformanceMode();
initPowerSaverMode();

if (Capacitor.getPlatform() === 'ios') {
  document.body.classList.add('ios-platform');
  console.log(`[Xylonic] iOS viewport ${window.innerWidth}×${window.innerHeight} dpr=${window.devicePixelRatio}`);

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

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);