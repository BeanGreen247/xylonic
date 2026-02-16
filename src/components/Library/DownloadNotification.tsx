import React, { useEffect, useState } from 'react';
import { downloadManager, DownloadTask } from '../../services/downloadManager';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
}

interface DownloadNotificationProps {
    songs: Song[];
}

const DownloadNotification: React.FC<DownloadNotificationProps> = ({ songs }) => {
    const [downloads, setDownloads] = useState<DownloadTask[]>([]);
    const [showPanel, setShowPanel] = useState(false);

    useEffect(() => {
        const updateDownloads = () => {
            const tasks = downloadManager.getAllTasks();
            setDownloads(tasks);
            
            // Auto-show panel when downloads are active
            const hasActive = tasks.some(t => t.status === 'downloading' || t.status === 'pending');
            if (hasActive && !showPanel) {
                setShowPanel(true);
            }
        };

        // Initial load
        updateDownloads();

        // Poll for updates (in production, use events)
        const interval = setInterval(updateDownloads, 1000);

        return () => clearInterval(interval);
    }, [showPanel]);

    const activeDownloads = downloads.filter(d => d.status === 'downloading' || d.status === 'pending');
    const completedDownloads = downloads.filter(d => d.status === 'completed');
    const failedDownloads = downloads.filter(d => d.status === 'failed');

    if (downloads.length === 0) {
        return null;
    }

    return (
        <div className="download-notification">
            <button 
                className="download-toggle"
                onClick={() => setShowPanel(!showPanel)}
                title="Downloads"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
                {activeDownloads.length > 0 && (
                    <span className="download-badge">{activeDownloads.length}</span>
                )}
            </button>

            {showPanel && (
                <div className="download-panel">
                    <div className="download-panel-header">
                        <h3>Downloads</h3>
                        <button onClick={() => setShowPanel(false)}>✕</button>
                    </div>

                    {activeDownloads.length > 0 && (
                        <div className="download-section">
                            <h4>Downloading ({activeDownloads.length})</h4>
                            {activeDownloads.map(task => (
                                <div key={task.id} className="download-item">
                                    <div className="download-item-info">
                                        <div className="download-item-title">{task.title}</div>
                                        <div className="download-item-artist">{task.artist}</div>
                                    </div>
                                    <div className="download-item-progress">
                                        <div 
                                            className="download-progress-bar"
                                            style={{ width: `${task.progress}%` }}
                                        />
                                    </div>
                                    <div className="download-item-status">
                                        {Math.round(task.progress)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {completedDownloads.length > 0 && (
                        <div className="download-section">
                            <h4>Completed ({completedDownloads.length})</h4>
                            {completedDownloads.slice(0, 5).map(task => (
                                <div key={task.id} className="download-item completed">
                                    <div className="download-item-info">
                                        <div className="download-item-title">{task.title}</div>
                                        <div className="download-item-artist">{task.artist}</div>
                                    </div>
                                    <div className="download-item-status">Done</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {failedDownloads.length > 0 && (
                        <div className="download-section">
                            <h4>Failed ({failedDownloads.length})</h4>
                            {failedDownloads.map(task => (
                                <div key={task.id} className="download-item failed">
                                    <div className="download-item-info">
                                        <div className="download-item-title">{task.title}</div>
                                        <div className="download-item-artist">{task.artist}</div>
                                    </div>
                                    <button 
                                        className="download-retry"
                                        onClick={() => downloadManager.retryDownload(task.id)}
                                    >
                                        Retry
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DownloadNotification;