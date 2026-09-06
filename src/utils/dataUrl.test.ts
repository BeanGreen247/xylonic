import { describe, it, expect } from 'vitest';
import { blobToDataUrl, bytesToBase64, chunksToDataUrl } from './dataUrl';

describe('bytesToBase64', () => {
  it('matches Node Buffer base64 for small input', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('handles input larger than the 8192-byte chunk without overflow', () => {
    const bytes = new Uint8Array(20000).map((_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('returns empty string for empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});

describe('chunksToDataUrl', () => {
  it('concatenates chunks and prefixes the mime type', () => {
    const url = chunksToDataUrl([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 'image/png');
    expect(url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`);
  });
});

describe('blobToDataUrl', () => {
  it('reads a blob into a data: URL', async () => {
    const url = await blobToDataUrl(new Blob(['hi'], { type: 'text/plain' }));
    expect(url).toBe(`data:text/plain;base64,${Buffer.from('hi').toString('base64')}`);
  });
});
