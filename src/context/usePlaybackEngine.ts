import { useEffect, MutableRefObject } from 'react';
import { logger } from '../utils/logger';

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

    let pendingTime: number | null = null;
    let rafId: number | null = null;

    const handleTimeUpdate = () => {
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

    const handleEnded = () => {
      logger.log('Song ended, calling playNext');
      onEnded.current();
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => { setIsPlaying(false); setIsLoading(false); };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleError = () => setIsLoading(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
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
