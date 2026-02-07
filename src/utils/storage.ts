import { useEffect } from 'react';

const STORAGE_KEY = 'subsonic_credentials';

// Save credentials
export const saveToStorage = (username: string, password: string, serverUrl: string): void => {
    try {
        const credentials = { username, password, serverUrl };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    } catch (error) {
        console.error('Failed to save to storage:', error);
    }
};

// Get credentials as object
export const getFromStorage = () => {
    try {
        const credentials = localStorage.getItem(STORAGE_KEY);
        if (!credentials) return { username: '', password: '', serverUrl: '' };
        return JSON.parse(credentials);
    } catch (error) {
        console.error('Failed to get from storage:', error);
        return { username: '', password: '', serverUrl: '' };
    }
};

// Clear all storage
export const clearStorage = (): void => {
    try {
        localStorage.clear();
    } catch (error) {
        console.error('Failed to clear storage:', error);
    }
};

// Generic get/set for other uses
export const getItem = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.error('Failed to get item from storage:', error);
        return null;
    }
};

export const setItem = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.error('Failed to set item in storage:', error);
    }
};

export const useCredentials = () => {
    useEffect(() => {
        const credentials = getFromStorage();
        if (credentials) {
            // Optionally, you can handle the retrieved credentials here
        }
    }, []);
};