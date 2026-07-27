// Search worker — runs 3 filter passes off the main thread.
// Receives 'init' once with the full index, then answers 'search' requests.

interface Artist { id: string; name: string; }
interface Album  { id: string; name: string; artist?: string; }
interface SearchResultSong { id: string; title: string; artist: string; album: string; }

interface SearchIndex {
  artists: Artist[];
  albums:  Album[];
  songs:   SearchResultSong[];
}

type InMsg =
  | { type: 'init';   index: SearchIndex }
  | { type: 'search'; id: number; query: string };

let index: SearchIndex | null = null;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    index = msg.index;
    return;
  }

  if (msg.type === 'search') {
    if (!index) {
      self.postMessage({ type: 'result', id: msg.id, artists: [], albums: [], songs: [] });
      return;
    }
    const q = msg.query.toLowerCase().trim();
    if (!q) {
      self.postMessage({ type: 'result', id: msg.id, artists: [], albums: [], songs: [] });
      return;
    }
    const artists = index.artists.filter(a => a.name.toLowerCase().includes(q)).slice(0, 20);
    const albums  = index.albums.filter(a =>
      a.name.toLowerCase().includes(q) || a.artist?.toLowerCase().includes(q)
    ).slice(0, 20);
    const songs   = index.songs.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.album.toLowerCase().includes(q)
    ).slice(0, 50);
    self.postMessage({ type: 'result', id: msg.id, artists, albums, songs });
  }
};
