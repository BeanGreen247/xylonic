import { getBridge } from '../platform/bridge';

let loggingEnabled = false;

const initLoggingPreference = async () => {
  try {
    loggingEnabled = await getBridge().getLoggingEnabled();
  } catch {
    loggingEnabled = false;
  }
};

initLoggingPreference();

const writeToFile = async (message: string, level: string) => {
  if (!loggingEnabled) return;
  try {
    await getBridge().writeLog({ message, level });
  } catch { /* silently ignore */ }
};

// Format log message with timestamp
const formatMessage = (...args: any[]): string => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  return `[${timestamp}] ${message}`;
};

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
  getLogPath: async (): Promise<string | null> => {
    try { return await getBridge().getLogPath(); } catch { return null; }
  },
  isEnabled: (): boolean => loggingEnabled,
  setEnabled: async (enabled: boolean): Promise<boolean> => {
    loggingEnabled = enabled;
    try {
      const success = await getBridge().setLoggingEnabled(enabled);
      if (success) await initLoggingPreference();
      return success;
    } catch { return false; }
  },
};
