import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { testConnection } from '../../services/subsonicApi';

const LoginForm: React.FC = () => {
    const { login } = useAuth();
    const [serverUrl, setServerUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);

        try {
            // Validate inputs
            if (!serverUrl || !username || !password) {
                setTestResult({
                    success: false,
                    message: 'Please fill in all fields'
                });
                setTesting(false);
                return;
            }

            console.log('Testing connection to:', serverUrl);
            
            const response = await testConnection(serverUrl, username, password);
            
            console.log('Connection test response:', response);

            if (response.data['subsonic-response']?.status === 'ok') {
                setTestResult({
                    success: true,
                    message: 'Connection successful! You can now login.'
                });
            } else {
                setTestResult({
                    success: false,
                    message: response.data['subsonic-response']?.error?.message || 'Connection failed'
                });
            }
        } catch (error) {
            console.error('Connection test error:', error);
            setTestResult({
                success: false,
                message: (error as Error).message || 'Failed to connect to server'
            });
        } finally {
            setTesting(false);
        }
    };

    const handleLogin = async () => {
        if (!testResult?.success) {
            setTestResult({
                success: false,
                message: 'Please test connection first'
            });
            return;
        }

        setLoggingIn(true);
        
        try {
            console.log('Logging in with credentials:', { serverUrl, username });
            
            // Call AuthContext login
            login(serverUrl, username, password);
            
            console.log('Login successful, credentials stored');
        } catch (error) {
            console.error('Login error:', error);
            setTestResult({
                success: false,
                message: 'Login failed: ' + (error as Error).message
            });
        } finally {
            setLoggingIn(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <h1>
                    <i className="fas fa-music"></i>
                    Xylonic
                </h1>

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
                    />
                    <small>Include http:// or https:// and port number</small>
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
                    />
                </div>

                <button
                    className="test-button"
                    onClick={handleTestConnection}
                    disabled={testing || !serverUrl || !username || !password}
                >
                    {testing ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Testing...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-plug"></i>
                            Test Connection
                        </>
                    )}
                </button>

                {testResult && (
                    <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                        <i className={`fas fa-${testResult.success ? 'check-circle' : 'times-circle'}`}></i>
                        {testResult.message}
                    </div>
                )}

                <button
                    className="login-button"
                    onClick={handleLogin}
                    disabled={!testResult?.success || loggingIn}
                >
                    {loggingIn ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Logging in...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-sign-in-alt"></i>
                            Login
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default LoginForm;