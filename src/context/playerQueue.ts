/**
 * Pure queue math for the player — extracted from PlayerContext as the first
 * slice of the WS-ARCH `useQueue` split. No React, no audio side-effects, so it
 * can be unit-tested directly. PlayerContext keeps ownership of the refs/state;
 * it just routes "what plays next" through here.
 */

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Fisher-Yates shuffle of the indices [0, length) with `currentIdx` removed
 * (the current track never repeats immediately). `rnd` is injectable for tests.
 */
export function buildShuffleQueue(
  length: number,
  currentIdx: number,
  rnd: () => number = Math.random,
): number[] {
  const indices = Array.from({ length }, (_, i) => i).filter((i) => i !== currentIdx);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export interface NextIndexInput {
  currentIndex: number;
  playlistLength: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** current Fisher-Yates queue (indices still to play this cycle) */
  shuffleQueue: number[];
  /** read cursor into shuffleQueue */
  shuffleQueuePos: number;
}

export interface NextIndexResult {
  /** 'replay' → repeat-one: caller restarts the current track, index unchanged.
   *  'noop'   → empty playlist, nothing to do.
   *  'advance'→ move to `nextIndex`. */
  action: 'advance' | 'replay' | 'noop';
  nextIndex: number;
  shuffleQueue: number[];
  shuffleQueuePos: number;
}

/**
 * Decide the next index. Mirrors the original PlayerContext logic exactly,
 * including the fact that sequential playback wraps to 0 at the end regardless
 * of `repeat` ('off' does not currently stop at the end — preserved on purpose;
 * fixing that is a behaviour change for a later task).
 */
export function computeNextIndex(
  input: NextIndexInput,
  rnd: () => number = Math.random,
): NextIndexResult {
  const { currentIndex, playlistLength, repeat, shuffle } = input;
  let { shuffleQueue, shuffleQueuePos } = input;

  if (playlistLength === 0) {
    return { action: 'noop', nextIndex: currentIndex, shuffleQueue, shuffleQueuePos };
  }
  if (repeat === 'one') {
    return { action: 'replay', nextIndex: currentIndex, shuffleQueue, shuffleQueuePos };
  }

  let nextIndex: number;
  if (shuffle) {
    if (shuffleQueuePos >= shuffleQueue.length) {
      shuffleQueue = buildShuffleQueue(playlistLength, currentIndex, rnd);
      shuffleQueuePos = 0;
    }
    nextIndex = shuffleQueue[shuffleQueuePos];
    shuffleQueuePos += 1;
  } else {
    nextIndex = currentIndex + 1;
    if (nextIndex >= playlistLength) nextIndex = 0;
  }

  return { action: 'advance', nextIndex, shuffleQueue, shuffleQueuePos };
}
