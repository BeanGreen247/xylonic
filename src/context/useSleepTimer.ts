import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sleep-timer slice of the player (WS-ARCH — extracted from `PlayerContext`).
 *
 * Owns the target timestamp + the 1 Hz countdown. `onExpire` is invoked once
 * when the timer reaches zero (the provider passes a pause callback); it is held
 * in a ref so a changing callback identity doesn't restart the interval.
 */
export function useSleepTimer(onExpire: () => void) {
  const [sleepTimerEnd, setSleepTimerEnd] = useState<number | null>(null);
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);

  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    if (!sleepTimerEnd) { setSleepTimerRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
      setSleepTimerRemaining(rem);
      if (rem === 0) {
        onExpireRef.current();
        setSleepTimerEnd(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepTimerEnd]);

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepTimerEnd(minutes === null ? null : Date.now() + minutes * 60 * 1000);
  }, []);

  return { sleepTimerRemaining, setSleepTimer };
}
