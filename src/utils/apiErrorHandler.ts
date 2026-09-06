import { useAuth } from '../context/AuthContext';
import { credentialsService } from '../services/credentialsService';

export const handleApiError = (error: any, requestReauth: () => void) => {
    // Check if it's an auth error
    if (error.response?.status === 401 || error.response?.status === 403) {
        console.error('Authentication error detected, requesting reauth');
        requestReauth();
        return;
    }

    // Check for missing credentials
    const { serverUrl, username, password } = credentialsService.getCached();

    if (!serverUrl || !username || !password) {
        console.error('Missing credentials detected, requesting reauth');
        requestReauth();
        return;
    }

    // Other errors - throw to be handled by component
    throw error;
};
