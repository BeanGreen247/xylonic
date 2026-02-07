import { Song } from '../types/player';

class AudioPlayerService {
    public audio: HTMLAudioElement;

    constructor() {
        this.audio = new Audio();
    }

    play(track: Song): void {
        this.audio.src = track.url;
        this.audio.play();
    }

    pause(): void {
        this.audio.pause();
    }

    setVolume(volume: number): void {
        this.audio.volume = volume;
    }

    setCurrentTime(time: number): void {
        this.audio.currentTime = time;
    }

    getCurrentTime(): number {
        return this.audio.currentTime;
    }

    getDuration(): number {
        return this.audio.duration;
    }

    isPaused(): boolean {
        return this.audio.paused;
    }

    addEventListener(event: string, handler: () => void): void {
        this.audio.addEventListener(event, handler);
    }

    removeEventListener(event: string, handler: () => void): void {
        this.audio.removeEventListener(event, handler);
    }
}

export const AudioPlayer = new AudioPlayerService();
export default AudioPlayer;