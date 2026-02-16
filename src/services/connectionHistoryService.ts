/**
 * Connection History Service
 * Manages saved server connections for quick login
 */

import { logger } from '../utils/logger';

export interface ConnectionProfile {
  id: string;                    // Unique identifier
  serverUrl: string;             // Server URL
  username: string;              // Username
  lastUsed: number;              // Timestamp
  displayName: string;           // "username@server" for display
}

const STORAGE_KEY = 'connectionHistory';
const MAX_CONNECTIONS = 10;      // Keep last 10 connections

/**
 * Load connection history from localStorage
 */
export const getConnectionHistory = (): ConnectionProfile[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const history: ConnectionProfile[] = JSON.parse(stored);
    // Sort by lastUsed descending (most recent first)
    return history.sort((a, b) => b.lastUsed - a.lastUsed);
  } catch (error) {
    logger.error('[ConnectionHistory] Failed to load history:', error);
    return [];
  }
};

/**
 * Save a connection to history
 */
export const saveConnection = (serverUrl: string, username: string): void => {
  try {
    const history = getConnectionHistory();
    
    // Generate ID from serverUrl + username
    const id = `${serverUrl}::${username}`;
    const displayName = `${username}@${serverUrl.replace(/^https?:\/\//, '')}`;
    
    // Check if connection already exists
    const existingIndex = history.findIndex(c => c.id === id);
    
    if (existingIndex >= 0) {
      // Update lastUsed timestamp
      history[existingIndex].lastUsed = Date.now();
    } else {
      // Add new connection
      history.push({
        id,
        serverUrl,
        username,
        lastUsed: Date.now(),
        displayName
      });
    }
    
    // Keep only MAX_CONNECTIONS most recent
    const trimmed = history
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, MAX_CONNECTIONS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    logger.log('[ConnectionHistory] Saved connection:', displayName);
  } catch (error) {
    logger.error('[ConnectionHistory] Failed to save connection:', error);
  }
};

/**
 * Remove a connection from history
 */
export const removeConnection = (id: string): void => {
  try {
    const history = getConnectionHistory();
    const filtered = history.filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    logger.log('[ConnectionHistory] Removed connection:', id);
  } catch (error) {
    logger.error('[ConnectionHistory] Failed to remove connection:', error);
  }
};

/**
 * Clear all connection history
 */
export const clearConnectionHistory = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    logger.log('[ConnectionHistory] Cleared all connection history');
  } catch (error) {
    logger.error('[ConnectionHistory] Failed to clear history:', error);
  }
};

/**
 * Get a specific connection profile by ID
 */
export const getConnectionById = (id: string): ConnectionProfile | null => {
  const history = getConnectionHistory();
  return history.find(c => c.id === id) || null;
};
