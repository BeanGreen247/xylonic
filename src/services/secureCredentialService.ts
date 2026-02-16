/**
 * Secure Credential Service
 * 
 * Handles encrypted storage of user credentials using Electron's safeStorage API.
 * Credentials are encrypted at rest using OS-native keychains:
 * - Windows: Credential Manager
 * - macOS: Keychain
 * - Linux: Secret Service API / libsecret
 */

import { logger } from '../utils/logger';

export interface StoredCredential {
  serverUrl: string;
  username: string;
  encryptedPassword: string; // Base64-encoded encrypted buffer
  savedAt: number; // Timestamp
}

const CREDENTIALS_KEY = 'secure_credentials';

/**
 * Check if secure storage is available on this platform
 */
export async function isSecureStorageAvailable(): Promise<boolean> {
  try {
    return await window.electron?.safeStorageAvailable() ?? false;
  } catch (error) {
    logger.log('[SecureCredentials] Failed to check availability:', error);
    return false;
  }
}

/**
 * Save credentials securely
 */
export async function saveCredentials(
  serverUrl: string,
  username: string,
  password: string
): Promise<boolean> {
  try {
    const available = await isSecureStorageAvailable();
    if (!available) {
      logger.log('[SecureCredentials] Secure storage not available, cannot save');
      return false;
    }

    // Encrypt password
    const encryptedPassword = await window.electron?.encryptCredential(password);
    if (!encryptedPassword) {
      logger.log('[SecureCredentials] Failed to encrypt password');
      return false;
    }

    // Load existing credentials
    const existingCreds = await getAllCredentials();
    
    // Check if this server+username combo already exists
    const existingIndex = existingCreds.findIndex(
      c => c.serverUrl === serverUrl && c.username === username
    );

    const newCred: StoredCredential = {
      serverUrl,
      username,
      encryptedPassword,
      savedAt: Date.now()
    };

    if (existingIndex >= 0) {
      // Update existing
      existingCreds[existingIndex] = newCred;
    } else {
      // Add new
      existingCreds.push(newCred);
    }

    // Save to localStorage as JSON
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(existingCreds));
    logger.log(`[SecureCredentials] Saved credentials for ${username}@${serverUrl}`);
    return true;

  } catch (error) {
    logger.log('[SecureCredentials] Failed to save credentials:', error);
    return false;
  }
}

/**
 * Get all stored credentials (passwords still encrypted)
 */
export async function getAllCredentials(): Promise<StoredCredential[]> {
  try {
    const json = localStorage.getItem(CREDENTIALS_KEY);
    if (!json) return [];
    return JSON.parse(json);
  } catch (error) {
    logger.log('[SecureCredentials] Failed to load credentials:', error);
    return [];
  }
}

/**
 * Get decrypted password for a specific server+username
 */
export async function getDecryptedPassword(
  serverUrl: string,
  username: string
): Promise<string | null> {
  try {
    const creds = await getAllCredentials();
    const match = creds.find(
      c => c.serverUrl === serverUrl && c.username === username
    );

    if (!match) {
      logger.log(`[SecureCredentials] No credentials found for ${username}@${serverUrl}`);
      return null;
    }

    // Decrypt password
    const password = await window.electron?.decryptCredential(match.encryptedPassword);
    if (!password) {
      logger.log('[SecureCredentials] Failed to decrypt password');
      return null;
    }

    return password;

  } catch (error) {
    logger.log('[SecureCredentials] Failed to get decrypted password:', error);
    return null;
  }
}

/**
 * Delete credentials for a specific server+username
 */
export async function deleteCredentials(
  serverUrl: string,
  username: string
): Promise<boolean> {
  try {
    const creds = await getAllCredentials();
    const filtered = creds.filter(
      c => !(c.serverUrl === serverUrl && c.username === username)
    );

    if (filtered.length === creds.length) {
      logger.log(`[SecureCredentials] No credentials to delete for ${username}@${serverUrl}`);
      return false;
    }

    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(filtered));
    logger.log(`[SecureCredentials] Deleted credentials for ${username}@${serverUrl}`);
    return true;

  } catch (error) {
    logger.log('[SecureCredentials] Failed to delete credentials:', error);
    return false;
  }
}

/**
 * Clear all stored credentials
 */
export async function clearAllCredentials(): Promise<void> {
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
    logger.log('[SecureCredentials] Cleared all credentials');
  } catch (error) {
    logger.log('[SecureCredentials] Failed to clear credentials:', error);
  }
}

/**
 * Migrate plaintext credentials to encrypted storage
 */
export async function migratePlaintextCredentials(): Promise<boolean> {
  try {
    const available = await isSecureStorageAvailable();
    if (!available) {
      logger.log('[SecureCredentials] Secure storage not available, skipping migration');
      return false;
    }

    // Check for old plaintext credentials
    const serverUrl = localStorage.getItem('serverUrl');
    const username = localStorage.getItem('username');
    const password = localStorage.getItem('password');

    if (!serverUrl || !username || !password) {
      logger.log('[SecureCredentials] No plaintext credentials to migrate');
      return false;
    }

    // Save securely
    const success = await saveCredentials(serverUrl, username, password);
    
    if (success) {
      // Keep plaintext password for now - services still need it
      // TODO: Remove after updating all services to use getPassword()
      logger.log('[SecureCredentials] Successfully migrated plaintext credentials (keeping plaintext for compatibility)');
      return true;
    }

    return false;

  } catch (error) {
    logger.log('[SecureCredentials] Failed to migrate credentials:', error);
    return false;
  }
}

/**
 * Get password for current session (tries encrypted first, falls back to plaintext)
 * This is the main function services should use to get passwords
 */
export async function getPassword(): Promise<string | null> {
  try {
    const serverUrl = localStorage.getItem('serverUrl');
    const username = localStorage.getItem('username');
    
    if (!serverUrl || !username) {
      logger.log('[SecureCredentials] No server/username in localStorage');
      return null;
    }

    // Try to get from secure storage first
    const available = await isSecureStorageAvailable();
    if (available) {
      const decrypted = await getDecryptedPassword(serverUrl, username);
      if (decrypted) {
        return decrypted;
      }
    }

    // Fall back to plaintext (for systems without secure storage or offline mode)
    const plaintext = localStorage.getItem('password');
    if (plaintext) {
      logger.log('[SecureCredentials] Using plaintext password (fallback)');
      return plaintext;
    }

    logger.log('[SecureCredentials] No password found');
    return null;

  } catch (error) {
    logger.log('[SecureCredentials] Failed to get password:', error);
    return null;
  }
}
