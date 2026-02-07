import { getStreamUrl } from './subsonicApi';
import { localStorageService } from './localStorageService';
import { getFromStorage } from '../utils/storage';

export interface DownloadTask {
    id: string;
    title: string;
    artist: string;
    album: string;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    progress: number;
    bitrate: number;
    error?: string;
}

interface DownloadOptions {
    bitrate?: number;
    onProgress?: (progress: number) => void;
}

class DownloadManager {
    private tasks: Map<string, DownloadTask> = new Map();
    private activeDownloads = 0;
    private maxConcurrent = 3;
    private queue: DownloadTask[] = [];

    async downloadSong(
        username: string,
        password: string,
        serverUrl: string,
        songId: string,
        title: string,
        artist: string,
        album: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const taskId = `${songId}-${options.bitrate || 0}`;
        
        // Check if already downloaded
        if (localStorageService.isSongDownloaded(songId, options.bitrate || 0)) {
            console.log('Song already downloaded:', title);
            return;
        }

        // Check if already in tasks
        if (this.tasks.has(taskId)) {
            console.log('Download already in progress:', title);
            return;
        }

        const task: DownloadTask = {
            id: taskId,
            title,
            artist,
            album,
            status: 'pending',
            progress: 0,
            bitrate: options.bitrate || 0,
        };

        this.tasks.set(taskId, task);
        this.queue.push(task);
        
        this.processQueue(username, password, serverUrl, songId, options);
    }

    private async processQueue(
        username: string,
        password: string,
        serverUrl: string,
        songId: string,
        options: DownloadOptions
    ) {
        if (this.activeDownloads >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const task = this.queue.shift();
        if (!task) return;

        this.activeDownloads++;
        task.status = 'downloading';
        
        try {
            const streamUrl = getStreamUrl(username, password, serverUrl, songId, options.bitrate || undefined);
            
            const response = await fetch(streamUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No reader available');

            const chunks: Uint8Array[] = [];
            let receivedLength = 0;

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                chunks.push(value);
                receivedLength += value.length;
                
                if (total > 0) {
                    const progress = (receivedLength / total) * 100;
                    task.progress = progress;
                    options.onProgress?.(progress);
                }
            }

            // Combine chunks
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);

            // Save to localStorage
            localStorageService.addDownloadedSong({
                id: songId,
                title: task.title,
                artist: task.artist,
                album: task.album,
                localPath: url,
                bitrate: task.bitrate,
                downloadedAt: new Date().toISOString(),
            });

            task.status = 'completed';
            task.progress = 100;
            options.onProgress?.(100);
            
            console.log('Download completed:', task.title);
        } catch (error) {
            console.error('Download failed:', error);
            task.status = 'failed';
            task.error = (error as Error).message;
        } finally {
            this.activeDownloads--;
            this.processQueue(username, password, serverUrl, songId, options);
        }
    }

    getAllTasks(): DownloadTask[] {
        return Array.from(this.tasks.values());
    }

    getTask(taskId: string): DownloadTask | undefined {
        return this.tasks.get(taskId);
    }

    cancelDownload(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (task && task.status === 'downloading') {
            task.status = 'failed';
            task.error = 'Cancelled by user';
        }
    }

    async retryDownload(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'failed') return;

        const { username, password, serverUrl } = getFromStorage();
        const songId = task.id.split('-')[0]; // Extract song ID from task ID
        
        // Remove failed task
        this.tasks.delete(taskId);
        
        // Re-download
        await this.downloadSong(
            username,
            password,
            serverUrl,
            songId,
            task.title,
            task.artist,
            task.album,
            { bitrate: task.bitrate }
        );
    }

    clearCompleted(): void {
        for (const [taskId, task] of this.tasks.entries()) {
            if (task.status === 'completed') {
                this.tasks.delete(taskId);
            }
        }
    }

    clearAll(): void {
        this.tasks.clear();
        this.queue = [];
    }
}

export const downloadManager = new DownloadManager();