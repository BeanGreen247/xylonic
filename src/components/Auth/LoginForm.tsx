import React, { useState } from 'react';
import { authenticateUser } from '../../services/subsonicApi';
import { saveToStorage } from '../../utils/storage';
import ConnectionTest from './ConnectionTest';

const LoginForm: React.FC = () => {
    const [serverUrl, setServerUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showTest, setShowTest] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const isValid = await authenticateUser(username, password, serverUrl);
            
            if (isValid) {
                saveToStorage(username, password, serverUrl);
                window.location.reload();
            } else {
                setError('Authentication failed. Please check your credentials.');
            }
        } catch (err) {
            setError('Failed to connect to server. Please check your settings.');
            console.error('Login error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-header">
                    <h1>Subsonic Music Player</h1>
                    <p className="login-subtitle">Connect to your Subsonic server</p>
                </div>

                {error && (
                    <div className="error-message">
                        <i className="fas fa-exclamation-circle"></i>
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="serverUrl">
                            <i className="fas fa-server"></i>
                            <span>Server URL</span>
                        </label>
                        <input
                            type="text"
                            id="serverUrl"
                            value={serverUrl}
                            onChange={(e) => setServerUrl(e.target.value)}
                            placeholder="http://your-server:4533"
                            required
                            autoComplete="url"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="username">
                            <i className="fas fa-user"></i>
                            <span>Username</span>
                        </label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Your username"
                            required
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">
                            <i className="fas fa-lock"></i>
                            <span>Password</span>
                        </label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Your password"
                            required
                            autoComplete="current-password"
                        />
                    </div>

                    <button type="submit" className="login-button" disabled={isLoading}>
                        <i className={isLoading ? "fas fa-spinner fa-spin" : "fas fa-sign-in-alt"}></i>
                        <span>{isLoading ? 'Connecting...' : 'Connect'}</span>
                    </button>

                    <button 
                        type="button" 
                        className="test-button"
                        onClick={() => setShowTest(!showTest)}
                    >
                        <i className="fas fa-vial"></i>
                        <span>{showTest ? 'Hide' : 'Show'} Connection Test</span>
                    </button>
                </form>

                {showTest && (
                    <ConnectionTest 
                        username={username}
                        password={password}
                        serverUrl={serverUrl}
                    />
                )}
            </div>
        </div>
    );
};

export default LoginForm;