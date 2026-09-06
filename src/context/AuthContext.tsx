import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { initializeStarredCache } from '../services/likedSongsService';
import { saveConnection } from '../services/connectionHistoryService';
import { migratePlaintextCredentials } from '../services/secureCredentialService';
import { credentialsService } from '../services/credentialsService';
import { metadataCache } from '../services/metadataCache';

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    username: string | null;
    serverUrl: string | null;
    isOfflineMode: boolean;
    login: (serverUrl: string, username: string, password: string, offlineMode?: boolean) => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // This runs ONCE when the app loads
  useEffect(() => {
    const auth = localStorage.getItem('auth');
    const savedUsername = localStorage.getItem('username');
    const savedServerUrl = localStorage.getItem('serverUrl');
    const savedOfflineMode = localStorage.getItem('offlineMode') === 'true';

    if (auth === 'true' && savedUsername) {
      setIsAuthenticated(true);
      setUsername(savedUsername);
      setServerUrl(savedServerUrl);
      setIsOfflineMode(savedOfflineMode);

      // Always initialize: loads pending offline changes from localStorage even
      // when starting in offline mode so they survive app restarts.
      initializeStarredCache().catch((error) => {
        console.error('Failed to initialize starred cache on load:', error);
      });
    }

    setIsLoading(false);

    // Migrate any plaintext credentials into the encrypted backend, then refresh
    // the credentialsService cache from it.
    migratePlaintextCredentials()
      .catch((error) => console.error('Failed to migrate credentials:', error))
      .finally(() => { credentialsService.hydrate().catch(() => {}); });
  }, []);

  const login = async (server: string, user: string, password: string, offlineMode: boolean = false) => {
    metadataCache.invalidate();
    console.log('AuthContext: Logging in', { serverUrl: server, user, offlineMode });
    
    // Store authentication state
    localStorage.setItem('auth', 'true');
    localStorage.setItem('offlineMode', offlineMode.toString());

    // Single authoritative credential path: writes the encrypted backend where
    // available and keeps the sync cache (+ legacy localStorage) in step.
    await credentialsService.set({ serverUrl: server, username: user, password });

    // Save to connection history (doesn't store password)
    saveConnection(server, user);

    setIsAuthenticated(true);
    setUsername(user);
    setServerUrl(server);
    setIsOfflineMode(offlineMode);

    initializeStarredCache().catch((error) => {
      console.error('Failed to initialize starred cache:', error);
    });

    // Notify listeners that auth/user changed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-changed'));
    }
  };

  const logout = () => {
    metadataCache.invalidate();
    // Only remove auth-related keys, keep themes intact
    localStorage.removeItem('auth');
    localStorage.removeItem('serverUrl');
    localStorage.removeItem('offlineMode');
    credentialsService.clear().catch(() => {});
    // Cache keys are now user+server specific, so they won't conflict between users
    // Keep 'username' so themes can still load!
    // Keep any other user data

    setIsAuthenticated(false);
    setUsername(null);
    setServerUrl(null);
    setIsOfflineMode(false);

    // Notify listeners (ThemeContext, PlayerContext, etc) that auth/user changed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-changed'));
      window.dispatchEvent(new Event('logout')); // Specific event for logout
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, username, serverUrl, isOfflineMode, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};