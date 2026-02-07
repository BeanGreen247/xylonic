import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { getFromStorage } from '../utils/storage';

interface AuthContextType {
    isAuthenticated: boolean;
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

    useEffect(() => {
        // Check if user is authenticated on mount
        const { username, password, serverUrl } = getFromStorage();
        
        console.log('Auth check:', { username, password, serverUrl }); // DEBUG
        
        if (username && password && serverUrl) {
            setIsAuthenticated(true);
        }
    }, []);

    const logout = () => {
        setIsAuthenticated(false);
        localStorage.clear();
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, logout }}>
            {children}
        </AuthContext.Provider>
    );
};