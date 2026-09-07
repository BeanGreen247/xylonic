import { describe, it, expect } from 'vitest';
import {
  qualityToBitrate,
  formatSpeed,
  sanitizeFilename,
  computeSpeedBps,
  filterUnqueuedSongs,
  computeProgress,
} from './downloadManagerHelpers';

describe('qualityToBitrate', () => {
  it('maps presets and treats original / unknown as no transcode', () => {
    expect(qualityToBitrate('320')).toBe(320);
    expect(qualityToBitrate('64')).toBe(64);
    expect(qualityToBitrate('original')).toBeUndefined();
    expect(qualityToBitrate('weird' as never)).toBeUndefined();
  });
});

describe('formatSpeed', () => {
  it('uses KB/s below 1 MB/s and MB/s above', () => {
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s');
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s');
  });
});

describe('sanitizeFilename', () => {
  it('replaces illegal characters, collapses whitespace and caps at 100', () => {
    expect(sanitizeFilename('a/b:c*d')).toBe('a_b_c_d');
    expect(sanitizeFilename('na<me>?"|')).toBe('na_me____');
    expect(sanitizeFilename('  x   y  ')).toBe('x y');
    expect(sanitizeFilename('z'.repeat(200))).toHaveLength(100);
  });
});

describe('computeSpeedBps', () => {
  it('returns 0 until there are two samples in the window', () => {
    const { bps, samples } = computeSpeedBps([], 1000, 0);
    expect(bps).toBe(0);
    expect(samples).toHaveLength(1);
  });

  it('computes bytes/sec across the retained window', () => {
    const first = computeSpeedBps([], 0, 0).samples;
    const { bps } = computeSpeedBps(first, 2000, 2_000_000); // 2 MB in 2 s
    expect(bps).toBe(1_000_000);
  });

  it('drops samples older than the window', () => {
    const old = [{ time: 0, bytes: 0 }];
    const { samples } = computeSpeedBps(old, 5000, 10, 3000);
    expect(samples).toEqual([{ time: 5000, bytes: 10 }]);
  });
});

describe('filterUnqueuedSongs', () => {
  it('drops cached and already-active songs', () => {
    const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = filterUnqueuedSongs(songs, (id) => id === 'a', new Set(['b']));
    expect(out.map((s) => s.id)).toEqual(['c']);
  });
});

describe('computeProgress', () => {
  it('pending = total - completed - failed', () => {
    expect(computeProgress({ sessionTotal: 10, sessionCompleted: 3, sessionFailed: 2, downloadingProgress: [] }))
      .toMatchObject({ pendingSongs: 5, overallProgress: 30 });
  });

  it('folds in-flight item progress into overallProgress, capped at 100', () => {
    const p = computeProgress({ sessionTotal: 4, sessionCompleted: 2, sessionFailed: 0, downloadingProgress: [50, 50] });
    // (2*100 + 100) / 4 = 75
    expect(p.overallProgress).toBe(75);
  });

  it('is 0% overall with no songs and never negative pending', () => {
    expect(computeProgress({ sessionTotal: 0, sessionCompleted: 0, sessionFailed: 0, downloadingProgress: [] }))
      .toMatchObject({ overallProgress: 0, pendingSongs: 0 });
    expect(computeProgress({ sessionTotal: 1, sessionCompleted: 5, sessionFailed: 0, downloadingProgress: [] }).pendingSongs)
      .toBe(0);
  });
});
