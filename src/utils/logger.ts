const isDevelopment = process.env.NODE_ENV === 'development';

// Check if we're in Electron renderer process
const isElectron = typeof window !== 'undefined' && window.electron;

// Check if logging is enabled (disabled by default)
let loggingEnabled = false;

// Initialize logging preference
const initLoggingPreference = async () => {
  if (isElectron && window.electron?.getLoggingEnabled) {
    try {
      loggingEnabled = await window.electron.getLoggingEnabled();
    } catch (error) {
      console.error('Failed to get logging preference:', error);
      loggingEnabled = false;
    }
  }
};

// Initialize on module load
initLoggingPreference();

// Write to log file via IPC if in Electron
const writeToFile = async (message: string, level: string) => {
  if (!loggingEnabled) return;
  if (isElectron && window.electron?.writeLog) {
    try {
      await window.electron.writeLog({ message, level });
    } catch (error) {
      // Silently fail if logging fails
    }
  }
};

// Format log message with timestamp
const formatMessage = (...args: any[]): string => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  return `[${timestamp}] ${message}`;
};

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

// Enhanced logger with file support (disabled by default)
export const logger = {
  log: (...args: any[]) => {
    if (!loggingEnabled) return;
    const message = formatMessage(...args);
    console.log(message);
    writeToFile(message, 'INFO');
  },
  error: (...args: any[]) => {
    if (!loggingEnabled) return;
    const message = formatMessage(...args);
    console.error(message);
    writeToFile(message, 'ERROR');
  },
  warn: (...args: any[]) => {
    if (!loggingEnabled) return;
    const message = formatMessage(...args);
    console.warn(message);
    writeToFile(message, 'WARN');
  },
  info: (...args: any[]) => {
    if (!loggingEnabled) return;
    const message = formatMessage(...args);
    console.info(message);
    writeToFile(message, 'INFO');
  },
  // Get log file path (for opening in file manager)
  getLogPath: async (): Promise<string | null> => {
    if (isElectron && window.electron?.getLogPath) {
      try {
        return await window.electron.getLogPath();
      } catch (error) {
        console.error('Failed to get log path:', error);
        return null;
      }
    }
    return null;
  },
  // Check if logging is enabled
  isEnabled: (): boolean => {
    return loggingEnabled;
  },
  // Set logging enabled status
  setEnabled: async (enabled: boolean): Promise<boolean> => {
    loggingEnabled = enabled;
    if (isElectron && window.electron?.setLoggingEnabled) {
      try {
        const success = await window.electron.setLoggingEnabled(enabled);
        if (success) {
          // Reinitialize preference
          await initLoggingPreference();
        }
        return success;
      } catch (error) {
        console.error('Failed to set logging preference:', error);
        return false;
      }
    }
    return false;
  }
};
