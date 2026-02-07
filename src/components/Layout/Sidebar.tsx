import React from 'react';

const Sidebar: React.FC = () => {
    return (
        <div className="sidebar">
            <h2>Navigation</h2>
            <ul>
                <li><a href="#library">Library</a></li>
                <li><a href="#playlists">Playlists</a></li>
                <li><a href="#settings">Settings</a></li>
            </ul>
        </div>
    );
};

export default Sidebar;