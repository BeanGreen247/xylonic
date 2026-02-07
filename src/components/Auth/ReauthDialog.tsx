import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { testConnection } from '../../services/subsonicApi';

const ReauthDialog: React.FC = () => {
    const { login } = useAuth();
    
    // Pre-fill with existing credentials if available
    const [serverUrl, setServerUrl] = useState(localStorage.getItem('serverUrl') || '');
    const [username, setUsername] = useState(localStorage.getItem('username') || '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);

    const handleReauth = async () => {
        setError(null);
        setTesting(true);

        try {
            // Validate inputs
            if (!serverUrl || !username || !password) {
                setError('Please fill in all fields');
                setTesting(false);
                return;
            }

            console.log('Testing connection for reauth...');
            
            const response = await testConnection(serverUrl, username, password);

            if (response.data['subsonic-response']?.status === 'ok') {
                setLoggingIn(true);
                console.log('Reauth successful, logging in...');
                login(serverUrl, username, password);
            } else {
                setError(response.data['subsonic-response']?.error?.message || 'Authentication failed');
            }
        } catch (error) {
            console.error('Reauth error:', error);
            setError('Failed to connect to server. Please check your credentials.');
        } finally {
            setTesting(false);
            setLoggingIn(false);
        }
    };

    const handleCancel = () => {
        // Clear all storage and force logout
        localStorage.clear();
        window.location.reload();
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
        }}>
            <div className="login-box" style={{ maxWidth: '450px', width: '100%', margin: '20px' }}>
                <h1 style={{ textAlign: 'center', marginBottom: '16px', fontSize: '24px' }}>
                    <i className="fas fa-lock" style={{ marginRight: '12px' }}></i>
                    Session Expired
                </h1>
                
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '32px' }}>
                    Your session has expired or credentials are missing. Please log in again to continue.
                </p>

                <div className="form-group">
                    <label>
                        <i className="fas fa-server"></i>
                        Server URL
                    </label>
                    <input
                        type="text"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        placeholder="http://192.168.1.100:4040"
                        disabled={testing || loggingIn}
                    />
                </div>

                <div className="form-group">
                    <label>
                        <i className="fas fa-user"></i>
                        Username
                    </label>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Your username"
                        disabled={testing || loggingIn}
                    />
                </div>

                <div className="form-group">
                    <label>
                        <i className="fas fa-lock"></i>
                        Password
                    </label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Your password"
                        disabled={testing || loggingIn}
                        onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                                handleReauth();
                            }
                        }}
                    />
                </div>

                {error && (
                    <div className="test-result error" style={{ marginBottom: '16px' }}>
                        <i className="fas fa-times-circle"></i>
                        {error}
                    </div>
                )}

                <button
                    className="login-button"
                    onClick={handleReauth}
                    disabled={testing || loggingIn || !serverUrl || !username || !password}
                >
                    {testing || loggingIn ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            {testing ? 'Authenticating...' : 'Logging in...'}
                        </>
                    ) : (
                        <>
                            <i className="fas fa-sign-in-alt"></i>
                            Log In
                        </>
                    )}
                </button>

                <button
                    className="test-button"
                    onClick={handleCancel}
                    disabled={testing || loggingIn}
                    style={{ marginTop: '12px' }}
                >
                    <i className="fas fa-times"></i>
                    Cancel & Logout
                </button>
            </div>
        </div>
    );
};

export default ReauthDialog;
