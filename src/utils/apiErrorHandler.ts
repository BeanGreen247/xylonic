import { useAuth } from '../context/AuthContext';

export const handleApiError = (error: any, requestReauth: () => void) => {
    // Check if it's an auth error
    if (error.response?.status === 401 || error.response?.status === 403) {
        console.error('Authentication error detected, requesting reauth');
        requestReauth();
        return;
    }

    // Check for missing credentials
    const serverUrl = localStorage.getItem('serverUrl');
    const username = localStorage.getItem('username');
    const password = localStorage.getItem('password');
    
    if (!serverUrl || !username || !password) {
        console.error('Missing credentials detected, requesting reauth');
        requestReauth();
        return;
    }

    // Other errors - throw to be handled by component
    throw error;
};
