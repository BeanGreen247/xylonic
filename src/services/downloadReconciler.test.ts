import { describe, it, expect } from 'vitest';
import {
  planOrphanReconciliation,
  mergePendingBatch,
  parsePendingBatch,
  pendingBatchFromQueueArray,
  type CompletionEntry,
  type PendingItem,
} from './downloadReconciler';

const song = (id: string) => ({ id, title: `t-${id}`, artist: 'a', album: 'al', albumId: 'al1' });
const pending = (id: string, extra: Partial<PendingItem> = {}): PendingItem => ({
  song: song(id) as never,
  quality: 'original',
  ...extra,
});
const entry = (id: string): CompletionEntry => ({
  songId: id,
  hash: `h_${id}`,
  extension: '.mp3',
  fileSize: 1000,
});

describe('planOrphanReconciliation', () => {
  it('returns registrations for orphans present in both the log and the pending map', () => {
    const plan = planOrphanReconciliation(
      [entry('s1'), entry('s2')],
      { s1: pending('s1', { artistId: 'ar1' }), s2: pending('s2') },
      () => false,
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      hash: 'h_s1',
      extension: '.mp3',
      fileSize: 1000,
      quality: 'original',
      artistId: 'ar1',
    });
  });

  it('skips entries already in the cache', () => {
    const plan = planOrphanReconciliation([entry('s1'), entry('s2')], { s1: pending('s1'), s2: pending('s2') }, (id) => id === 's1');
    expect(plan.map((p) => p.song.id)).toEqual(['s2']);
  });

  it('skips log entries with no matching pending record', () => {
    const plan = planOrphanReconciliation([entry('ghost')], { s1: pending('s1') }, () => false);
    expect(plan).toEqual([]);
  });

  it('is empty when the log is empty', () => {
    expect(planOrphanReconciliation([], { s1: pending('s1') }, () => false)).toEqual([]);
  });
});

describe('mergePendingBatch', () => {
  it('adds new items without dropping existing ones', () => {
    const out = mergePendingBatch({ s1: pending('s1') }, [
      { song: song('s2') as never, quality: '320' },
    ]);
    expect(Object.keys(out).sort()).toEqual(['s1', 's2']);
    expect(out.s2.quality).toBe('320');
  });

  it('overwrites an item with the same id', () => {
    const out = mergePendingBatch({ s1: pending('s1', { artistId: 'old' }) }, [
      { song: song('s1') as never, quality: 'original', artistId: 'new' },
    ]);
    expect(out.s1.artistId).toBe('new');
  });

  it('does not mutate the input', () => {
    const existing = { s1: pending('s1') };
    mergePendingBatch(existing, [{ song: song('s2') as never, quality: 'original' }]);
    expect(Object.keys(existing)).toEqual(['s1']);
  });
});

describe('parsePendingBatch', () => {
  it('parses a keyed object', () => {
    expect(parsePendingBatch('{"s1":{"quality":"original"}}')).toEqual({ s1: { quality: 'original' } });
  });
  it('returns {} for null, corrupt JSON or an array', () => {
    expect(parsePendingBatch(null)).toEqual({});
    expect(parsePendingBatch('{bad')).toEqual({});
    expect(parsePendingBatch('[1,2,3]')).toEqual({});
  });
});

describe('pendingBatchFromQueueArray', () => {
  it('reduces a queue array to an id-keyed map', () => {
    const raw = JSON.stringify([
      { song: { id: 's1' }, quality: 'original' },
      { song: { id: 's2' }, quality: '128' },
      { nope: true },
    ]);
    const map = pendingBatchFromQueueArray(raw);
    expect(Object.keys(map).sort()).toEqual(['s1', 's2']);
  });
  it('returns {} for null / non-array / corrupt', () => {
    expect(pendingBatchFromQueueArray(null)).toEqual({});
    expect(pendingBatchFromQueueArray('{"a":1}')).toEqual({});
    expect(pendingBatchFromQueueArray('nope')).toEqual({});
  });
});
