# Build Process & Cache Management

### Pre-Build Cleanup

**Script:** `scripts/clean-appdata-prebuild.js`

Automatically runs before all build commands to ensure clean builds:

```json
// package.json
{
  "scripts": {
    "prebuild:clean": "node scripts/clean-appdata-prebuild.js",
    "electron:build": "npm run prebuild:clean && npm run build && electron-builder",
    "electron:build:win": "npm run prebuild:clean && npm run build && electron-builder --win",
    // ... all build scripts include prebuild:clean
  }
}
```

**What Gets Cleaned:**

- ✅ Project build artifacts: `build/`, `dist/`
- ✅ AppData/xylonic directory:
  - ❌ **Removed**: `settings.cfg`, `app.log`, temporary files
  - ✅ **Preserved**: `permanent_cache/` (offline songs), `color_settings/` (custom themes)

**Example Output:**

```
╔════════════════════════════════════════╗
║     PRE-BUILD CLEANUP SCRIPT           ║
╚════════════════════════════════════════╝

CLEANING PROJECT BUILD ARTIFACTS
✓ Removed: build/
✓ Removed: dist/

CLEANING APPDATA DIRECTORY
Target directory: C:\Users\..\AppData\Roaming\xylonic

Preserving folders:
  - color_settings
  - permanent_cache

Cleaning...
  ✗ Removed file: settings.cfg
  ✗ Removed file: app.log
  ✓ Preserved: color_settings
  ✓ Preserved: permanent_cache

Removed: 2 item(s)
Preserved: 2 folder(s)
✓ AppData cleanup completed successfully
```

### Runtime Cache Management

**UI Button:** Hamburger Menu → "Clear All Caches"

**Location:** `src/components/common/HamburgerMenu.tsx`

**Functionality:**

```typescript
const handleClearAllCaches = async () => {
  // 1. Confirm with user (shows detailed warning)
  const confirmed = window.confirm(
    '⚠️ Clear All Caches?\n\n' +
    'This will:\n' +
    '• Delete all cached album artwork (IndexedDB)\n' +
    '• Delete all offline cache data (permanent_cache)\n' +
    '• Reset all precache completion flags\n' +
    '• Force complete re-download and re-index on restart\n\n' +
    'Continue?'
  );
  
  if (!confirmed) return;
  
  // 2. Clear offline cache (permanent_cache folder)
  await offlineCacheService.clearAllCache();
  
  // 3. Clear image cache (IndexedDB database)
  await imageCacheService.clearAllCacheAndReset();
  
  // 4. Reload app to trigger CachePreloadDialog
  window.location.reload();
};
```

**What Gets Cleared:**

| Cache Type | Storage Location | Impact |
|------------|------------------|--------|
| **Image Cache** | IndexedDB (`XylonicImageCache`) | All album artwork (all users) |
| **Offline Songs** | `permanent_cache/*.mp3` | All downloaded songs |
| **Precache Flags** | `localStorage.precacheComplete` | Forces CachePreloadDialog on restart |
| **Memory Cache** | Blob URLs (RAM) | All in-memory image references revoked |

**Use Cases:**

- 🔄 **Switching servers**: Clear old server's cached images
- 🗑️ **Reclaim disk space**: Remove large offline cache (GB of data)
- 🔧 **Troubleshooting**: Reset corrupted cache after failed preload
- 📊 **Testing**: Benchmark fresh precache performance

**Safety Features:**

- ⚠️ **Confirmation dialog** with detailed warning
- 🔒 **Preserves color_settings**: Custom themes NOT deleted
- 🔄 **Automatic rebuild**: CachePreloadDialog reopens on reload
- 📝 **Logging**: All operations logged to `app.log`

### Library Pagination

**Components:** `ArtistList.tsx`, `AlbumList.tsx`

**Configuration:**

```typescript
const artistsPerPage = 50;  // Max artists per page
const albumsPerPage = 50;   // Max albums per page
```

**Why Pagination Matters:**

For large libraries (1000+ albums, 300+ artists), rendering all items at once:
- ❌ Creates 1000+ blob URLs simultaneously → Memory exhaustion
- ❌ Causes `ERR_FILE_NOT_FOUND` errors (blob URL limit exceeded)
- ❌ Slow initial render (processing 1000+ DOM nodes)
- ❌ Poor scroll performance (large virtual DOM)

With pagination:
- ✅ Only 50 blob URLs created per page
- ✅ Fast page rendering (<100ms)
- ✅ Smooth navigation between pages
- ✅ Works with libraries of any size

**UI Features:**

```
┌─────────────────────────────────────────┐
│  Artists          Showing 1-50 of 315   │
├─────────────────────────────────────────┤
│  [Artist 1]  [Artist 2]  [Artist 3]     │
│  [Artist 4]  [Artist 5]  [Artist 6]     │
│  ...                                    │
├─────────────────────────────────────────┤
│  < Previous  [1] [2] [3] ... [7]  Next >│
└─────────────────────────────────────────┘
```

- **Page navigation**: Previous/Next buttons + direct page selection
- **Current page indicator**: Active page highlighted
- **Item counter**: "Showing X-Y of Z" header
- **Resets on filter**: Searching/filtering resets to page 1
- **Preserves state**: Page number maintained during navigation

**Implementation:**

```typescript
// State management
const [currentPage, setCurrentPage] = useState(1);
const artistsPerPage = 50;

// Pagination calculation
const totalPages = Math.ceil(filteredArtists.length / artistsPerPage);
const startIndex = (currentPage - 1) * artistsPerPage;
const endIndex = startIndex + artistsPerPage;
const paginatedArtists = filteredArtists.slice(startIndex, endIndex);

// Reset to page 1 when filter changes
useEffect(() => {
  setCurrentPage(1);
}, [filterText]);

// Render only current page
return paginatedArtists.map(artist => (
  <ArtistCard key={artist.id} artist={artist} />
));
```

**CSS Styling:**

```css
/* index.css */
.pagination-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
}

.pagination-page.active {
  background-color: var(--primary-color);
  color: white;
  font-weight: bold;
}
```

---
