import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { initializeStarredCache } from '../services/likedSongsService';
import { saveConnection } from '../services/connectionHistoryService';
import { saveCredentials, isSecureStorageAvailable, migratePlaintextCredentials } from '../services/secureCredentialService';

interface AuthContextType {
    isAuthenticated: boolean;
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
      
      // Only initialize starred songs cache in online mode
      if (!savedOfflineMode) {
        initializeStarredCache().catch((error) => {
          console.error('Failed to initialize starred cache on load:', error);
        });
      }
    }
    
    // Attempt to migrate plaintext credentials to encrypted storage
    migratePlaintextCredentials().catch((error) => {
      console.error('Failed to migrate credentials:', error);
    });
  }, []);

  const login = async (server: string, user: string, password: string, offlineMode: boolean = false) => {
    console.log('AuthContext: Logging in', { serverUrl: server, user, offlineMode });
    
    // Store authentication state
    localStorage.setItem('auth', 'true');
    localStorage.setItem('serverUrl', server);
    localStorage.setItem('username', user);
    localStorage.setItem('password', password); // Keep plaintext for compatibility
    localStorage.setItem('offlineMode', offlineMode.toString());
    
    // ALSO try to save credentials securely (encrypted) for future use
    const secureStorageAvailable = await isSecureStorageAvailable();
    if (secureStorageAvailable) {
      const saved = await saveCredentials(server, user, password);
      if (saved) {
        console.log('AuthContext: Credentials saved securely (encrypted) - also keeping plaintext for compatibility');
      } else {
        console.warn('AuthContext: Failed to save securely, using plaintext only');
      }
    } else {
      console.warn('AuthContext: Secure storage not available, using plaintext only');
    }
    
    // Save to connection history (doesn't store password)
    saveConnection(server, user);
    
    // Verify storage
    console.log('AuthContext: Credentials stored', {
        auth: localStorage.getItem('auth'),
        serverUrl: localStorage.getItem('serverUrl'),
        username: localStorage.getItem('username'),
        offlineMode: localStorage.getItem('offlineMode'),
        hasPassword: !!localStorage.getItem('password')
    });
    
    setIsAuthenticated(true);
    setUsername(user);
    setServerUrl(server);
    setIsOfflineMode(offlineMode);

    // Only initialize starred songs cache in online mode
    if (!offlineMode) {
      initializeStarredCache().catch((error) => {
        console.error('Failed to initialize starred cache:', error);
      });
    }

    // Notify listeners that auth/user changed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-changed'));
    }
  };

  const logout = () => {
    // Only remove auth-related keys, keep themes intact
    localStorage.removeItem('auth');
    localStorage.removeItem('serverUrl');
    localStorage.removeItem('password');
    localStorage.removeItem('offlineMode');
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
    <AuthContext.Provider value={{ isAuthenticated, username, serverUrl, isOfflineMode, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};