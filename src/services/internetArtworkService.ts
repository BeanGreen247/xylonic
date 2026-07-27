const artCache = new Map<string, string | null>();

export const fetchArtFromInternet = async (artist: string, album: string): Promise<string | null> => {
    if (!artist && !album) return null;

    const cacheKey = `${artist}::${album}`.toLowerCase();
    if (artCache.has(cacheKey)) return artCache.get(cacheKey)!;

    try {
        const term = encodeURIComponent(`${artist} ${album}`.trim());
        const url = `https://itunes.apple.com/search?term=${term}&entity=album&media=music&limit=5`;

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            artCache.set(cacheKey, null);
            return null;
        }

        const data = await response.json();
        const result = data.results?.[0];
        if (!result?.artworkUrl100) {
            artCache.set(cacheKey, null);
            return null;
        }

        const artUrl = result.artworkUrl100.replace('100x100bb', '600x600bb');
        artCache.set(cacheKey, artUrl);
        return artUrl;
    } catch {
        artCache.set(cacheKey, null);
        return null;
    }
};
