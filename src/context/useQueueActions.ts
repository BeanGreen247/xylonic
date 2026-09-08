import { useCallback, Dispatch, MutableRefObject, SetStateAction } from 'react';

interface QueueActionsParams<S> {
  playlistRef: MutableRefObject<S[]>;
  currentIndexRef: MutableRefObject<number>;
  setPlaylist: Dispatch<SetStateAction<S[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
}

export interface QueueActions<S> {
  addToQueue: (song: S) => void;
  insertNext: (song: S) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
}

/**
 * The queue-mutation callbacks lifted from PlayerContext. Each one is pure
 * array/index bookkeeping against `playlistRef` / `currentIndexRef` (kept in
 * lock-step with the corresponding state) — no coupling to the audio element,
 * play history, shuffle queue or media session, which is what makes this a
 * clean extraction. Behaviour is unchanged from the inline versions.
 */
export function useQueueActions<S>({
  playlistRef,
  currentIndexRef,
  setPlaylist,
  setCurrentIndex,
}: QueueActionsParams<S>): QueueActions<S> {
  const addToQueue = useCallback((song: S) => {
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertNext = useCallback((song: S) => {
    const list = [...playlistRef.current];
    const insertAt = currentIndexRef.current + 1;
    list.splice(insertAt, 0, song);
    playlistRef.current = list;
    setPlaylist(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const next = [...playlistRef.current];
    next.splice(index, 1);
    playlistRef.current = next;
    setPlaylist(next);
    const currentIdx = currentIndexRef.current;
    if (index < currentIdx) {
      const newIdx = currentIdx - 1;
      currentIndexRef.current = newIdx;
      setCurrentIndex(newIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveInQueue = useCallback((from: number, to: number) => {
    if (from === to) return;
    const next = [...playlistRef.current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    playlistRef.current = next;
    setPlaylist(next);
    const currentIdx = currentIndexRef.current;
    let newIdx = currentIdx;
    if (currentIdx === from) {
      newIdx = to;
    } else if (from < to) {
      if (currentIdx > from && currentIdx <= to) newIdx = currentIdx - 1;
    } else {
      if (currentIdx >= to && currentIdx < from) newIdx = currentIdx + 1;
    }
    if (newIdx !== currentIdx) {
      currentIndexRef.current = newIdx;
      setCurrentIndex(newIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearQueue = useCallback(() => {
    const currentIdx = currentIndexRef.current;
    const current = playlistRef.current[currentIdx];
    if (current) {
      playlistRef.current = [current];
      currentIndexRef.current = 0;
      setPlaylist([current]);
      setCurrentIndex(0);
    } else {
      playlistRef.current = [];
      currentIndexRef.current = 0;
      setPlaylist([]);
      setCurrentIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { addToQueue, insertNext, removeFromQueue, moveInQueue, clearQueue };
}
