import { useEffect, useRef } from 'react';
import { usePlayer, usePlayerTime } from '../context/PlayerContext';
import { useAuth } from '../context/AuthContext';
import { serverUpdateNowPlaying, serverScrobble } from '../services/subsonicApi';

// Scrobbling is delegated entirely to the server via the Subsonic /scrobble
// endpoint. The server forwards plays to Last.fm, ListenBrainz, etc. based
// on its own configuration — no credentials needed in the app.
export function useScrobbler() {
  const { currentSong, isPlaying } = usePlayer();
  const { currentTime, duration }  = usePlayerTime();
  const { username, serverUrl } = useAuth();

  const scrobbledIdRef    = useRef<string | null>(null);
  const startTimestampRef = useRef<number>(0);

  // On song change: reset scrobble guard and fire "now playing"
  useEffect(() => {
    if (!currentSong || !username || !serverUrl) return;
    scrobbledIdRef.current  = null;
    startTimestampRef.current = Math.floor(Date.now() / 1000);
    const password = localStorage.getItem('password') || '';
    serverUpdateNowPlaying(serverUrl, username, password, currentSong.id);
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Submit scrobble once the listen threshold is reached
  useEffect(() => {
    if (!currentSong || !username || !serverUrl || !isPlaying) return;
    if (scrobbledIdRef.current === currentSong.id) return;
    if (!duration || duration < 30) return;

    const threshold = Math.min(duration * 0.5, 240);
    if (currentTime >= threshold) {
      scrobbledIdRef.current = currentSong.id;
      const password = localStorage.getItem('password') || '';
      serverScrobble(serverUrl, username, password, currentSong.id, startTimestampRef.current);
    }
  }, [currentTime]); // eslint-disable-line react-hooks/exhaustive-deps
}
