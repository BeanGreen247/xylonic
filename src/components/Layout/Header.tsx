import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { getFromStorage } from '../../utils/storage';

const Header: React.FC = () => {
    const { logout } = useAuth();
    const { username, serverUrl } = getFromStorage();

    return (
        <header className="header">
            <div className="header-left">
                <h1 className="app-title">Xylonic</h1>
            </div>
            
            <div className="header-center">
                <div className="server-info">
                    <span className="username">
                        <i className="fas fa-user"></i> {username}
                    </span>
                    <span className="server-url">
                        <i className="fas fa-server"></i> {serverUrl}
                    </span>
                </div>
            </div>

            <div className="header-right">
                <button className="help-button" title="Help">
                    <i className="fas fa-question-circle"></i> Help
                </button>
                <button className="logout-button" onClick={logout}>
                    <i className="fas fa-sign-out-alt"></i> Logout
                </button>
            </div>
        </header>
    );
};

export default Header;