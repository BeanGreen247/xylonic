import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
    isAuthenticated: boolean;
    requiresReauth: boolean;
    login: (serverUrl: string, username: string, password: string) => void;
    logout: () => void;
    requestReauth: () => void;
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
    const [requiresReauth, setRequiresReauth] = useState(false);

    // This runs ONCE when the app loads
    useEffect(() => {
        const auth = localStorage.getItem('auth');
        const serverUrl = localStorage.getItem('serverUrl');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        
        console.log('AuthContext: Checking existing credentials', {
            hasAuth: !!auth,
            hasServerUrl: !!serverUrl,
            hasUsername: !!username,
            hasPassword: !!password,
            serverUrl: serverUrl,
            username: username
        });
        
        // ✅ ALL credentials present → Set authenticated to true
        if (auth && serverUrl && username && password) {
            setIsAuthenticated(true);
        } else if (auth || serverUrl || username || password) {
            // ⚠️ Only SOME credentials → Request reauth
            console.log('AuthContext: Partial credentials found, requesting reauth');
            setRequiresReauth(true);
        }
        // ❌ NO credentials → Stay unauthenticated (show login form)
    }, []);

    const login = (serverUrl: string, username: string, password: string) => {
        console.log('AuthContext: Logging in', { serverUrl, username });
        
        // Store all credentials
        localStorage.setItem('auth', 'true');
        localStorage.setItem('serverUrl', serverUrl);
        localStorage.setItem('username', username);
        localStorage.setItem('password', password);
        
        // Verify storage
        console.log('AuthContext: Credentials stored', {
            auth: localStorage.getItem('auth'),
            serverUrl: localStorage.getItem('serverUrl'),
            username: localStorage.getItem('username'),
            hasPassword: !!localStorage.getItem('password')
        });
        
        setIsAuthenticated(true);
        setRequiresReauth(false);
    };

    const logout = () => {
        console.log('AuthContext: Logging out');
        localStorage.clear();
        setIsAuthenticated(false);
        setRequiresReauth(false);
        
        // Force reload to clear any cached state
        window.location.reload();
    };

    const requestReauth = () => {
        console.log('AuthContext: Requesting reauth');
        setRequiresReauth(true);
        setIsAuthenticated(false);
    };

    const value: AuthContextType = {
        isAuthenticated,
        requiresReauth,
        login,
        logout,
        requestReauth,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};