import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
    isAuthenticated: boolean;
    username: string | null;
    login: (serverUrl: string, username: string, password: string) => void;
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

  // This runs ONCE when the app loads
  useEffect(() => {
    const auth = localStorage.getItem('auth');
    const savedUsername = localStorage.getItem('username');
    if (auth === 'true' && savedUsername) {
      setIsAuthenticated(true);
      setUsername(savedUsername);
    }
  }, []);

  const login = (serverUrl: string, user: string, password: string) => {
    console.log('AuthContext: Logging in', { serverUrl, user });
    
    // Store all credentials
    localStorage.setItem('auth', 'true');
    localStorage.setItem('serverUrl', serverUrl);
    localStorage.setItem('username', user);
    localStorage.setItem('password', password);
    
    // Verify storage
    console.log('AuthContext: Credentials stored', {
        auth: localStorage.getItem('auth'),
        serverUrl: localStorage.getItem('serverUrl'),
        username: localStorage.getItem('username'),
        hasPassword: !!localStorage.getItem('password')
    });
    
    setIsAuthenticated(true);
    setUsername(user);

    // Notify ThemeContext (and anything else) that auth/user changed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-changed'));
    }
  };

  const logout = () => {
    // Only remove auth-related keys, keep themes intact
    localStorage.removeItem('auth');
    localStorage.removeItem('serverUrl');
    localStorage.removeItem('password');
    // Keep 'username' so themes can still load!
    // Keep any other user data
    
    setIsAuthenticated(false);
    setUsername(null);

    // Notify ThemeContext that auth/user changed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-changed'));
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};