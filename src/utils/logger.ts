const isDevelopment = process.env.NODE_ENV === 'development';
const enableLogs = isDevelopment;

// Force logout in dev mode on app start to ensure fresh state
if (isDevelopment && typeof window !== 'undefined') {
  const hasLoggedDevWarning = sessionStorage.getItem('dev_logout_warning');
  
  if (!hasLoggedDevWarning) {
    // Clear all stored credentials on first dev load
    localStorage.clear();
    sessionStorage.setItem('dev_logout_warning', 'true');
    console.warn('DEV MODE: All sessions cleared. You will need to log in again.');
  }
}

// Simple logger; no-op in production
export const logger = {
  log: (...args: any[]) => {
    if (!enableLogs) return;
    console.log(...args);
  },
  error: (...args: any[]) => {
    if (!enableLogs) return;
    console.error(...args);
  },
  warn: (...args: any[]) => {
    if (!enableLogs) return;
    console.warn(...args);
  },
  info: (...args: any[]) => {
    if (!enableLogs) return;
    console.info(...args);
  }
};
