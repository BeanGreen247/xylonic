import { describe, it, expect } from 'vitest';
import {
  generateAudioHash,
  generateCoverArtHash,
  generateUserId,
  sanitizeUserIdForFilesystem,
  getFileExtension,
  formatBytes,
  getFormatFromExtension,
} from './cacheHelpers';

describe('generateAudioHash / generateCoverArtHash', () => {
  it('is deterministic for the same inputs', () => {
    expect(generateAudioHash('http://s:4533', 'song1')).toBe(generateAudioHash('http://s:4533', 'song1'));
  });

  it('ignores a trailing slash on the server URL', () => {
    expect(generateAudioHash('http://s:4533', 'song1')).toBe(generateAudioHash('http://s:4533/', 'song1'));
  });

  it('differs by song id and by server', () => {
    expect(generateAudioHash('http://s:4533', 'a')).not.toBe(generateAudioHash('http://s:4533', 'b'));
    expect(generateAudioHash('http://s1:4533', 'a')).not.toBe(generateAudioHash('http://s2:4533', 'a'));
  });

  it('audio and cover-art hashes for the same id do not collide', () => {
    expect(generateAudioHash('http://s:4533', 'x')).not.toBe(generateCoverArtHash('http://s:4533', 'x'));
  });
});

describe('generateUserId', () => {
  it('formats as username@host:port', () => {
    expect(generateUserId('kenny', 'https://music.example:4533')).toBe('kenny@music.example:4533');
  });
  it('omits the port when there is none', () => {
    expect(generateUserId('kenny', 'https://music.example')).toBe('kenny@music.example');
  });
  it('falls back gracefully on an unparseable URL', () => {
    expect(generateUserId('kenny', 'not-a-url/')).toBe('kenny@not-a-url');
  });
});

describe('sanitizeUserIdForFilesystem', () => {
  it('replaces colons with dashes', () => {
    expect(sanitizeUserIdForFilesystem('kenny@100.74.4.30:4533')).toBe('kenny@100.74.4.30-4533');
  });
});

describe('getFileExtension', () => {
  it('maps common audio content types', () => {
    expect(getFileExtension('audio/mpeg')).toBe('.mp3');
    expect(getFileExtension('audio/flac')).toBe('.flac');
    expect(getFileExtension('audio/ogg')).toBe('.ogg');
  });
  it('defaults unknown audio content types to .mp3', () => {
    expect(getFileExtension('audio/weird')).toBe('.mp3');
  });
  it('extracts the extension from a filename', () => {
    expect(getFileExtension('track.FLAC')).toBe('.FLAC');
    expect(getFileExtension('noext')).toBe('.mp3');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 Bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1048576, '1 MB'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe('getFormatFromExtension', () => {
  it('strips the dot and lowercases', () => {
    expect(getFormatFromExtension('.MP3')).toBe('mp3');
    expect(getFormatFromExtension('flac')).toBe('flac');
  });
});
