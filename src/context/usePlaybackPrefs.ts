import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { logger } from '../utils/logger';
import { getUserSettings, readSettings, writeSettings } from '../utils/settingsManager';
import { getFromStorage } from '../utils/storage';

/**
 * Per-user playback preferences — streaming bitrate + playback speed (WS-ARCH,
 * extracted from `PlayerContext`). Both load together from the user's settings
 * on mount; speed also writes back and is applied to the live `<audio>` element.
 *
 * `speedRef` mirrors `playbackSpeed` synchronously so callers that set a fresh
 * audio element's `playbackRate` before React re-renders (e.g. on track change)
 * read the current value.
 */
export function usePlaybackPrefs(audioRef: RefObject<HTMLAudioElement | null>) {
  const [bitrate, setBitrateState] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1.0);
  const speedRef = useRef(1.0);

  // Load saved streaming quality + playback speed on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { username } = getFromStorage();
        if (!username) return;
        const userSettings = await getUserSettings(username);
        if (userSettings?.streamingQuality !== undefined) {
          logger.log('Loading saved streaming quality:', userSettings.streamingQuality);
          setBitrateState(userSettings.streamingQuality);
        }
        if (userSettings?.playbackSpeed !== undefined) {
          setPlaybackSpeedState(userSettings.playbackSpeed);
          speedRef.current = userSettings.playbackSpeed;
        }
      } catch (error) {
        logger.error('Failed to load settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Apply playback speed whenever it changes
  useEffect(() => {
    speedRef.current = playbackSpeed;
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, audioRef]);

  const setBitrate = useCallback((newBitrate: number | null) => {
    setBitrateState(newBitrate);
  }, []);

  const setPlaybackSpeed = useCallback(async (speed: number) => {
    setPlaybackSpeedState(speed);
    speedRef.current = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
    try {
      const { username } = getFromStorage();
      if (username) {
        const allSettings = await readSettings();
        if (!allSettings[username]) allSettings[username] = { theme: 'cyan-wave', customThemes: {} };
        allSettings[username].playbackSpeed = speed;
        await writeSettings(allSettings);
      }
    } catch { /* best-effort persist */ }
  }, [audioRef]);

  return { bitrate, setBitrate, playbackSpeed, setPlaybackSpeed, speedRef };
}
