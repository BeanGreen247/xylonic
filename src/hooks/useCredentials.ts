import { useSyncExternalStore } from 'react';
import { credentialsService, Credentials } from '../services/credentialsService';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('auth-changed', onChange);
  window.addEventListener('logout', onChange);
  return () => {
    window.removeEventListener('auth-changed', onChange);
    window.removeEventListener('logout', onChange);
  };
}

/**
 * Reactive view of the current credentials. Re-renders on `auth-changed` /
 * `logout` (the events AuthContext already dispatches). For non-React code use
 * `credentialsService.getCached()` directly.
 */
export function useCredentials(): Credentials {
  return useSyncExternalStore(subscribe, credentialsService.getCached, credentialsService.getCached);
}
