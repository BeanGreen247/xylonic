import { credentialsService } from '../services/credentialsService';
import { logger } from './logger';

// Save credentials
export const saveToStorage = (username: string, password: string, serverUrl: string): void => {
    try {
        // Store as individual keys to match AuthContext
        localStorage.setItem('username', username);
        localStorage.setItem('password', password);
        localStorage.setItem('serverUrl', serverUrl);
    } catch (error) {
        logger.error('Failed to save to storage:', error);
    }
};

// Get credentials as object — delegates to the single authoritative
// credentialsService (WS-SEC); still synchronous for existing call sites.
export const getFromStorage = () => {
    const { username, password, serverUrl } = credentialsService.getCached();
    return { username, password, serverUrl };
};

// Clear all storage
export const clearStorage = (): void => {
    try {
        localStorage.clear();
    } catch (error) {
        logger.error('Failed to clear storage:', error);
    }
};

// Generic get/set for other uses
export const getItem = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        logger.error('Failed to get item from storage:', error);
        return null;
    }
};

export const setItem = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        logger.error('Failed to set item in storage:', error);
    }
};