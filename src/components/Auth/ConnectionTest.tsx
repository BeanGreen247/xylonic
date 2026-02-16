import React, { useState } from 'react';
import { testConnection } from '../../services/subsonicApi';

interface ConnectionTestProps {
    username: string;
    password: string;
    serverUrl: string;
}

const ConnectionTest: React.FC<ConnectionTestProps> = ({ username, password, serverUrl }) => {
    const [status, setStatus] = useState<string>('');
    const [testing, setTesting] = useState(false);

    const handleTest = async () => {
        setTesting(true);
        setStatus('Testing connection...');
        try {
            const response = await testConnection(username, password, serverUrl);
            if (response.data['subsonic-response']?.status === 'ok') {
                setStatus('Connection successful!');
            } else {
                setStatus('Connection failed');
            }
        } catch (error) {
            setStatus('Connection failed: ' + (error as Error).message);
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="connection-test">
            <button onClick={handleTest} disabled={testing || !username || !password || !serverUrl}>
                {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {status && <div className={`status ${status.includes('successful') ? 'success' : 'error'}`}>{status}</div>}
        </div>
    );
};

export default ConnectionTest;