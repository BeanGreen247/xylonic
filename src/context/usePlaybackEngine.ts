import { useEffect, MutableRefObject } from 'react';
import { logger } from '../utils/logger';
import { serverAllowsCors } from './audioCors';

interface PlaybackEngineParams {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  setIsLoading: (l: boolean) => void;
  /** Ref to the "advance to next track" callback — invoked on the audio `ended`
   *  event. A ref (not a direct fn) so the engine stays decoupled from the
   *  queue logic that owns playNext. */
  onEnded: MutableRefObject<() => void>;
}

/**
 * Owns the single <audio> element for the player: creates it once, wires media
 * events to player state (timeupdate is throttled to one setState per animation
 * frame so render rate is capped by the RAF throttle, not the ~4×/s timeupdate
 * event), and tears it down on unmount. Lifted verbatim from PlayerContext.
 */
export function usePlaybackEngine({
  audioRef,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  setIsLoading,
  onEnded,
}: PlaybackEngineParams): void {
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    // When the server sends CORS headers, mark the element crossOrigin so the
    // Car Mode analyser can read streamed audio. If a load then fails, drop the
    // attribute and retry the same source so playback is never the casualty.
    let corsEnabled = false;
    void serverAllowsCors().then(ok => {
      if (ok && audioRef.current === audio) { audio.crossOrigin = 'anonymous'; corsEnabled = true; }
    });

    let pendingTime: number | null = null;
    let rafId: number | null = null;

    const handleTimeUpdate = () => {
      // Real playback progress is the ground truth that a load finished — iOS
      // WebKit sometimes never fires 'playing' (e.g. play() resolves silently,
      // or the app regained focus mid-load), which would otherwise leave the
      // loading spinner stuck forever.
      if (audio.currentTime > 0 && !audio.paused) setIsLoading(false);
      pendingTime = audio.currentTime;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingTime !== null) setCurrentTime(pendingTime);
          pendingTime = null;
          rafId = null;
        });
      }
    };
    const handleDurationChange = () => setDuration(audio.duration);
    const handleLoadedData = () => setIsLoading(false);
    const handleCanPlay = () => setIsLoading(false);

    const handleEnded = () => {
      logger.log('Song ended, calling playNext');
      onEnded.current();
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => { setIsPlaying(false); setIsLoading(false); };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleError = () => {
      if (corsEnabled && audio.src && audio.error) {
        corsEnabled = false;
        audio.removeAttribute('crossorigin');
        const resumeAt = audio.currentTime;
        audio.addEventListener('loadedmetadata', () => { if (resumeAt > 0) audio.currentTime = resumeAt; }, { once: true });
        audio.load();
        audio.play().catch(() => {});
        return;
      }
      setIsLoading(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('error', handleError);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
