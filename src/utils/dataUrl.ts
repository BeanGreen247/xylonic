/**
 * Small shared helpers for turning binary blobs/bytes into `data:` URLs.
 * Both patterns were duplicated 3–4× across PlayerContext (media-session /
 * foreground-service artwork) and capacitorBridge.
 */

/** Read a Blob into a `data:` URL. Resolves null on read error. */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Base64-encode a byte array without blowing the call stack on large inputs
 * (`btoa(String.fromCharCode(...huge))` throws "Maximum call stack size").
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

/** Assemble streamed chunks into one `data:<mime>;base64,…` URL. */
export function chunksToDataUrl(chunks: Uint8Array[], mime: string): string {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    bytes.set(c, pos);
    pos += c.length;
  }
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
