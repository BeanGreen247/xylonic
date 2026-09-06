import { credentialsService } from '../services/credentialsService';
import { logger } from './logger';

export const handleApiError = (error: unknown, requestReauth: () => void) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    // Check if it's an auth error
    if (status === 401 || status === 403) {
        logger.error('Authentication error detected, requesting reauth');
        requestReauth();
        return;
    }

    // Check for missing credentials
    const { serverUrl, username, password } = credentialsService.getCached();

    if (!serverUrl || !username || !password) {
        logger.error('Missing credentials detected, requesting reauth');
        requestReauth();
        return;
    }

    // Other errors - throw to be handled by component
    throw error;
};
