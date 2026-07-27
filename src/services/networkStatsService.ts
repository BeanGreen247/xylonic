export interface NetworkStats {
  // Images served without any network request
  imageMemoryHits: number;  // in-RAM blob URL
  imageDiskHits:   number;  // read from IndexedDB

  // Images that caused a network request
  imageSubsonicFetches:  number; // fetched from the Subsonic server
  imageInternetFetches:  number; // fetched from an external art service (MusicBrainz etc.)

  // Library metadata — always a network request
  metadataFetches: number; // getArtists / getArtist / getAlbum / search calls
}

class NetworkStatsService {
  private s: NetworkStats = {
    imageMemoryHits:       0,
    imageDiskHits:         0,
    imageSubsonicFetches:  0,
    imageInternetFetches:  0,
    metadataFetches:       0,
  };

  recordImageMemoryHit()      { this.s.imageMemoryHits++; }
  recordImageDiskHit()        { this.s.imageDiskHits++; }
  recordImageSubsonicFetch()  { this.s.imageSubsonicFetches++; }
  recordImageInternetFetch()  { this.s.imageInternetFetches++; }
  recordMetadataFetch()       { this.s.metadataFetches++; }

  getStats(): NetworkStats { return { ...this.s }; }

  reset() {
    this.s = {
      imageMemoryHits:      0,
      imageDiskHits:        0,
      imageSubsonicFetches: 0,
      imageInternetFetches: 0,
      metadataFetches:      0,
    };
  }
}

export const networkStatsService = new NetworkStatsService();
