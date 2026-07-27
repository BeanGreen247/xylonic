import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { testConnection } from '../../services/subsonicApi';
import { getConnectionHistory, removeConnection, ConnectionProfile } from '../../services/connectionHistoryService';
import { getDecryptedPassword, deleteCredentials, isSecureStorageAvailable } from '../../services/secureCredentialService';
import { offlineCacheService } from '../../services/offlineCacheService';
import XylonicLogo from '../common/XylonicLogo';
import './LoginForm.css';

const LoginForm: React.FC = () => {
    const { login } = useAuth();
    const [serverUrl, setServerUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);
    const [connectionHistory, setConnectionHistory] = useState<ConnectionProfile[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<string>('');
    const [offlineMode, setOfflineMode] = useState(false);
    const [secureStorageAvailable, setSecureStorageAvailable] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    // Check secure storage availability on mount
    useEffect(() => {
        const checkSecureStorage = async () => {
            const available = await isSecureStorageAvailable();
            setSecureStorageAvailable(available);
        };
        checkSecureStorage();
    }, []);

    // Load connection history on mount
    useEffect(() => {
        const history = getConnectionHistory();
        setConnectionHistory(history);
    }, []);

    useEffect(() => {
        if (!pickerOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pickerOpen]);

    // Handle connection selection from modal picker
    const handleConnectionSelect = async (connectionId: string) => {
        setSelectedConnection(connectionId);
        setPickerOpen(false);
        
        if (connectionId) {
            const connection = connectionHistory.find(c => c.id === connectionId);
            if (connection) {
                setServerUrl(connection.serverUrl);
                setUsername(connection.username);
                setTestResult(null);
                
                // In offline mode, check if cache exists and try to auto-fill password
                if (offlineMode) {
                    // Check if cache exists for this user
                    const hasCache = await offlineCacheService.hasCacheForUser(connection.username, connection.serverUrl);
                    
                    if (!hasCache) {
                        setTestResult({
                            success: false,
                            message: 'No cached data found for this connection. Please login online first to download some songs.'
                        });
                        setPassword('');
                        return;
                    }
                    
                    // Try to get password from secure storage
                    if (secureStorageAvailable) {
                        const decryptedPassword = await getDecryptedPassword(connection.serverUrl, connection.username);
                        if (decryptedPassword) {
                            setPassword(decryptedPassword);
                            setTestResult({
                                success: true,
                                message: 'Offline mode: Using cached data and stored credentials'
                            });
                        } else {
                            setPassword('');
                            setTestResult({
                                success: false,
                                message: 'Cache available but no stored credentials found. Please enter your password.'
                            });
                        }
                    } else {
                        setPassword('');
                        setTestResult({
                            success: false,
                            message: 'Cache available but secure storage not available. Please enter your password.'
                        });
                    }
                } else {
                    setPassword(''); // Don't auto-fill password in online mode
                }
            }
        } else {
            // "New Connection" selected
            setServerUrl('');
            setUsername('');
            setPassword('');
            setTestResult(null);
        }
    };

    const handleEditConnection = async (conn: ConnectionProfile) => {
        setPickerOpen(false);
        setSelectedConnection(conn.id);
        setServerUrl(conn.serverUrl);
        setUsername(conn.username);
        setTestResult(null);
        if (secureStorageAvailable) {
            const pwd = await getDecryptedPassword(conn.serverUrl, conn.username);
            setPassword(pwd ?? '');
        } else {
            setPassword('');
        }
    };

    const handleDeleteConnection = async (id: string) => {
        const conn = connectionHistory.find(c => c.id === id);
        if (!conn) return;
        if (!window.confirm(`Remove saved connection "${conn.displayName}"?`)) return;
        removeConnection(id);
        if (secureStorageAvailable) await deleteCredentials(conn.serverUrl, conn.username);
        const updated = getConnectionHistory();
        setConnectionHistory(updated);
        if (selectedConnection === id) {
            setSelectedConnection('');
            setServerUrl('');
            setUsername('');
            setPassword('');
            setTestResult(null);
        }
    };

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
        // In offline mode, check cache availability
        if (offlineMode) {
            // Validate all fields are filled
            if (!serverUrl || !username || !password) {
                setTestResult({
                    success: false,
                    message: 'Please fill in all fields'
                });
                return;
            }
            
            // Verify cache exists
            const hasCache = await offlineCacheService.hasCacheForUser(username, serverUrl);
            if (!hasCache) {
                setTestResult({
                    success: false,
                    message: 'No cached data available for offline mode. Please login online first to download some songs.'
                });
                return;
            }
        } else {
            // In online mode, test connection must be successful
            if (!testResult?.success) {
                setTestResult({
                    success: false,
                    message: 'Please test connection first'
                });
                return;
            }
        }

        setLoggingIn(true);
        
        try {
            console.log('Logging in with credentials:', { serverUrl, username, offlineMode });
            
            // Call AuthContext login
            login(serverUrl, username, password, offlineMode);
            
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
                <div className="login-logo-area">
                    <XylonicLogo size={72} />
                    <h1>Xylonic</h1>
                </div>

                <div className="login-form-columns">
                    <div className="login-column-left">
                        <div className="form-group">
                            <label>
                                <i className="fas fa-history"></i>
                                Previous Connections
                            </label>

                            {/* Trigger — same visual as the text inputs */}
                            <button
                                type="button"
                                className={`connection-select conn-picker-trigger${connectionHistory.length === 0 ? ' disabled' : ''}`}
                                onClick={() => connectionHistory.length > 0 && setPickerOpen(true)}
                                disabled={connectionHistory.length === 0}
                                aria-haspopup="listbox"
                                aria-expanded={pickerOpen}
                            >
                                <i className="fas fa-plug" style={{ color: 'var(--primary-color)', marginRight: 6 }}></i>
                                <span style={{ flex: 1, textAlign: 'left' }}>
                                    {selectedConnection
                                        ? (connectionHistory.find(c => c.id === selectedConnection)?.displayName ?? 'Unknown')
                                        : 'New Connection'}
                                </span>
                                <i className="fas fa-chevron-down" style={{ fontSize: 11, opacity: 0.6 }}></i>
                            </button>

                            <small>Select a saved connection or create a new one</small>

                            {/* Modal picker — portal into body */}
                            {pickerOpen && ReactDOM.createPortal(
                                <>
                                    <div className="quality-picker-backdrop" onClick={() => setPickerOpen(false)} />
                                    <div className="quality-picker-modal" role="listbox" aria-label="Select connection">
                                        <div className="quality-picker-header">
                                            <span className="quality-picker-title">
                                                <i className="fas fa-history" />
                                                Previous Connections
                                            </span>
                                            <button className="quality-picker-close" onClick={() => setPickerOpen(false)} aria-label="Close">
                                                <i className="fas fa-times" />
                                            </button>
                                        </div>
                                        <p className="quality-picker-hint">
                                            Select a saved connection or start a new one.
                                        </p>

                                        <div className="quality-picker-list">
                                            {/* New Connection option */}
                                            <button
                                                className={`quality-picker-item${!selectedConnection ? ' active' : ''}`}
                                                role="option"
                                                aria-selected={!selectedConnection}
                                                onClick={() => handleConnectionSelect('')}
                                            >
                                                <div className="conn-picker-icon">
                                                    <i className="fas fa-plus-circle" />
                                                </div>
                                                <div className="quality-picker-info">
                                                    <span className="quality-picker-name">New Connection</span>
                                                    <span className="quality-picker-desc">Enter server details manually</span>
                                                </div>
                                                {!selectedConnection && <i className="fas fa-check quality-picker-check" />}
                                            </button>

                                            {connectionHistory.map(conn => {
                                                const active = selectedConnection === conn.id;
                                                return (
                                                    <div
                                                        key={conn.id}
                                                        className={`quality-picker-item conn-item-row${active ? ' active' : ''}`}
                                                        role="option"
                                                        aria-selected={active}
                                                        tabIndex={0}
                                                        onClick={() => handleConnectionSelect(conn.id)}
                                                        onKeyDown={e => e.key === 'Enter' && handleConnectionSelect(conn.id)}
                                                    >
                                                        <div className="conn-picker-icon">
                                                            <i className="fas fa-server" />
                                                        </div>
                                                        <div className="quality-picker-info">
                                                            <span className="quality-picker-name">{conn.displayName}</span>
                                                            <span className="quality-picker-desc">
                                                                {conn.username} · {conn.serverUrl}
                                                            </span>
                                                        </div>
                                                        {active && <i className="fas fa-check quality-picker-check" />}
                                                        <button
                                                            className="conn-item-action"
                                                            aria-label="Edit credentials"
                                                            title="Edit credentials"
                                                            onClick={e => { e.stopPropagation(); handleEditConnection(conn); }}
                                                        >
                                                            <i className="fas fa-pen" />
                                                        </button>
                                                        <button
                                                            className="conn-item-action conn-item-delete"
                                                            aria-label="Remove connection"
                                                            title="Remove saved connection"
                                                            onClick={e => { e.stopPropagation(); handleDeleteConnection(conn.id); }}
                                                        >
                                                            <i className="fas fa-trash" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>

                        <div className="form-group offline-mode-toggle">
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={offlineMode}
                                    onChange={async (e) => {
                                        const newOfflineMode = e.target.checked;
                                        setOfflineMode(newOfflineMode);
                                        setTestResult(null);
                                        
                                        // If turning on offline mode and a connection is selected, check cache
                                        if (newOfflineMode && selectedConnection) {
                                            const connection = connectionHistory.find(c => c.id === selectedConnection);
                                            if (connection) {
                                                const hasCache = await offlineCacheService.hasCacheForUser(connection.username, connection.serverUrl);
                                                
                                                if (!hasCache) {
                                                    setTestResult({
                                                        success: false,
                                                        message: 'No cached data found for this connection. Please login online first to download some songs.'
                                                    });
                                                    setPassword('');
                                                } else if (secureStorageAvailable) {
                                                    // Try to get password from secure storage
                                                    const decryptedPassword = await getDecryptedPassword(connection.serverUrl, connection.username);
                                                    if (decryptedPassword) {
                                                        setPassword(decryptedPassword);
                                                        setTestResult({
                                                            success: true,
                                                            message: 'Offline mode: Using cached data and stored credentials'
                                                        });
                                                    } else {
                                                        setTestResult({
                                                            success: true,
                                                            message: 'Cache available. Please enter your password to continue.'
                                                        });
                                                    }
                                                } else {
                                                    setTestResult({
                                                        success: true,
                                                        message: 'Cache available. Please enter your password to continue.'
                                                    });
                                                }
                                            }
                                        }
                                    }}
                                    disabled={!secureStorageAvailable || connectionHistory.length === 0}
                                />
                                <i className={`fas fa-${offlineMode ? 'wifi-slash' : 'wifi'}`}></i>
                                Enter Offline Mode
                            </label>
                            <small>
                                {!secureStorageAvailable 
                                    ? 'Secure storage not available on this system'
                                    : connectionHistory.length === 0
                                    ? 'No saved connections available for offline mode'
                                    : 'Use stored credentials without network connection'
                                }
                            </small>
                        </div>
                    </div>

                    <div className="login-column-right">
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
                                autoCapitalize="none"
                                autoCorrect="off"
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
                                autoCapitalize="none"
                                autoCorrect="off"
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <i className="fas fa-lock"></i>
                                Password
                            </label>
                            <div className="password-input-wrap">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Your password"
                                    autoCapitalize="none"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(v => !v)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    tabIndex={-1}
                                >
                                    <i className={`fas fa-eye${showPassword ? '-slash' : ''}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    className="test-button"
                    onClick={handleTestConnection}
                    disabled={testing || !serverUrl || !username || !password || offlineMode}
                >
                    {testing ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Testing...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-plug"></i>
                            {offlineMode ? 'Connection Test Disabled (Offline Mode)' : 'Test Connection'}
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
                    disabled={
                        loggingIn || 
                        (!offlineMode && !testResult?.success) ||
                        (offlineMode && (!selectedConnection || !password))
                    }
                >
                    {loggingIn ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Logging in...
                        </>
                    ) : (
                        <>
                            <i className={`fas fa-${offlineMode ? 'wifi-slash' : 'sign-in-alt'}`}></i>
                            {offlineMode ? 'Enter Offline' : 'Login'}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default LoginForm;