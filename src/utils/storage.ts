// Save credentials
export const saveToStorage = (username: string, password: string, serverUrl: string): void => {
    try {
        // Store as individual keys to match AuthContext
        localStorage.setItem('username', username);
        localStorage.setItem('password', password);
        localStorage.setItem('serverUrl', serverUrl);
    } catch (error) {
        console.error('Failed to save to storage:', error);
    }
};

// Get credentials as object
export const getFromStorage = () => {
    try {
        // Read from individual keys that AuthContext uses
        const username = localStorage.getItem('username') || '';
        const password = localStorage.getItem('password') || '';
        const serverUrl = localStorage.getItem('serverUrl') || '';
        return { username, password, serverUrl };
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