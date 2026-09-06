import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { searchCacheService } from './searchCacheService';

// Force the main-thread fallback path (no Web Worker in jsdom anyway) and inject
// a synthetic index so we exercise the filter logic without IndexedDB.
function setIndex(partial: {
  artists?: { id: string; name: string }[];
  albums?: { id: string; name: string; artist?: string }[];
  songs?: { id: string; title: string; artist: string; album: string }[];
}) {
  (searchCacheService as unknown as { worker: unknown }).worker = null;
  (searchCacheService as unknown as { searchIndex: unknown }).searchIndex = {
    artists: partial.artists ?? [],
    albums: partial.albums ?? [],
    songs: partial.songs ?? [],
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  (searchCacheService as unknown as { searchIndex: unknown }).searchIndex = null;
  (searchCacheService as unknown as { worker: unknown }).worker = null;
});

describe('searchCacheService.search (main-thread fallback)', () => {
  it('resolves null when no index is loaded', async () => {
    expect(await searchCacheService.search('anything')).toBeNull();
  });

  it('returns empty buckets for a blank query', async () => {
    setIndex({ songs: [{ id: '1', title: 'x', artist: 'y', album: 'z' }] });
    expect(await searchCacheService.search('   ')).toEqual({ artist: [], album: [], song: [] });
  });

  it('matches artists, albums (by name or album-artist) and songs, case-insensitively', async () => {
    setIndex({
      artists: [{ id: 'a1', name: 'Radiohead' }, { id: 'a2', name: 'Blur' }],
      albums: [
        { id: 'al1', name: 'In Rainbows', artist: 'Radiohead' },
        { id: 'al2', name: 'Parklife', artist: 'Blur' },
      ],
      songs: [
        { id: 's1', title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows' },
        { id: 's2', title: 'Girls & Boys', artist: 'Blur', album: 'Parklife' },
      ],
    });
    const r = await searchCacheService.search('radiohead');
    expect(r!.artist!.map((a) => a.id)).toEqual(['a1']);
    expect(r!.album!.map((a) => a.id)).toEqual(['al1']); // matched via album.artist
    expect(r!.song!.map((s) => s.id)).toEqual(['s1']);
  });

  it('matches a song by its album title', async () => {
    setIndex({
      songs: [{ id: 's1', title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows' }],
    });
    const r = await searchCacheService.search('rainbows');
    expect(r!.song!.map((s) => s.id)).toEqual(['s1']);
  });

  it('caps results at 20 artists / 20 albums / 50 songs', async () => {
    setIndex({
      artists: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, name: `match ${i}` })),
      albums: Array.from({ length: 40 }, (_, i) => ({ id: `al${i}`, name: `match ${i}` })),
      songs: Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, title: `match ${i}`, artist: 'x', album: 'y' })),
    });
    const r = await searchCacheService.search('match');
    expect(r!.artist).toHaveLength(20);
    expect(r!.album).toHaveLength(20);
    expect(r!.song).toHaveLength(50);
  });
});
