# Xylonic Cache v2.0 - Testing Guide

## Overview
This guide helps you test the new multi-user cache system with hash-based storage and configurable cache location.

## Prerequisites
- Subsonic server running and accessible
- Valid credentials for testing
- Sufficient disk space for downloads

---

## Test 1: Cache Location Configuration

### Steps:
1. **Start the application**
   ```powershell
   npm run dev
   ```

2. **Login to your Subsonic server**
   - Enter server URL, username, password
   - Click "Test Connection", then "Login"

3. **Open Download Manager**
   - Look for download icon in the UI
   - Click to open Download Manager window

4. **View Current Cache Location**
   - Click "Manage" button in the Cache Statistics section
   - You should see "Cache Location" section displaying current path
   - Default: `C:\Users\{username}\AppData\Roaming\xylonic\permanent_cache`

5. **Change Cache Location**
   - Click "Change Location" button
   - Select a new folder (e.g., `D:\MusicCache` or desktop test folder)
   - Wait for success message: "Cache location updated successfully..."
   - Verify the displayed path updates to your new location
   - Note: App restart recommended for full effect

6. **Verify Settings Persistence**
   - Close the app completely
   - Check `settings.cfg` file exists:
     ```powershell
     Get-Content "$env:APPDATA\xylonic\settings.cfg"
     ```
   - Should contain line: `cache_location=YOUR_NEW_PATH`
   - Restart app and verify location is still the new path

### Expected Results:
- Path changes immediately in UI
- Directory picker shows proper dialog
- Success/error messages display correctly
- Settings persist across app restarts
- New downloads go to new location

---

## Test 2: Multi-User Cache Storage

### Steps:
1. **Download a song**
   - Navigate to Artists → Select an artist → Select an album
   - Find a song and click download button (if available)
   - Or use "Download Album" button
   - Wait for download to complete

2. **Verify Hash-Based Storage**
   - Open the cache directory in File Explorer
   - Navigate to: `{cache_location}/permanent_cache/`
   - Check directory structure:
     ```
     permanent_cache/
     ├── users/
     │   └── {username}@{host}:{port}/
     │       ├── cache_index.json
     │       └── metadata.json
     ├── audio/
     │   └── {hash}/
     │       ├── audio.mp3 (or .flac, etc.)
     │       └── cover.jpg
     └── registry.json
     ```

3. **Inspect User Cache Index**
   - Open: `users/{username}@{server}/cache_index.json`
   - Verify structure:
     ```json
     {
       "version": "2.0.0",
       "userId": "alice@server.com:4533",
       "songs": {
         "song-id-123": {
           "songId": "...",
           "title": "...",
           "artist": "...",
           "audioHash": "abc123...",
           "coverArtHash": "def456...",
           "format": "mp3",
           "bitrate": 320,
           "fileSize": 5242880,
           "cachedAt": 1708012800000
         }
       },
       "totalSize": 5242880,
       "lastModified": 1708012800000
     }
     ```

4. **Inspect Audio Registry**
   - Open: `registry.json` (at root of permanent_cache/)
   - Verify structure:
     ```json
     {
       "version": "2.0.0",
       "audioFiles": {
         "abc123...": {
           "hash": "abc123...",
           "filename": "audio.mp3",
           "size": 5242880,
           "format": "mp3",
           "refCount": 1,
           "addedBy": ["alice@server.com:4533"],
           "createdAt": 1708012800000
         }
       },
       "coverArtFiles": {
         "def456...": {
           "hash": "def456...",
           "filename": "cover.jpg",
           "size": 102400,
           "refCount": 1,
           "addedBy": ["alice@server.com:4533"],
           "createdAt": 1708012800000
         }
       },
       "totalSize": 5345280
     }
     ```

### Expected Results:
- Files stored in `audio/{hash}/` directories
- User-specific cache_index.json created
- Global registry.json created and updated
- Reference counting set to 1 for first download
- Hash format matches md5(serverUrl:songId)

---

## Test 3: Cache Statistics & Display

### Steps:
1. **Open Download Manager** (if not already open)

2. **View Cache Statistics**
   - Look at "Cache Statistics" section
   - Should display:
     - **Songs**: Number of songs in your cache
     - **Albums**: Number of unique albums
     - **Your Cache**: Your personal cache size
     - **Total Shared**: Total cache size across all users

3. **Download Multiple Songs**
   - Download 2-3 songs from different albums
   - Watch statistics update in real-time

4. **Test Cache Size Calculation**
   - Note the "Your Cache" size
   - Calculate manually: Open cache_index.json, sum all fileSizes
   - Values should match

### Expected Results:
- Statistics update after each download
- Album count increases with unique albums
- Your Cache shows user-specific size
- Total Shared shows global cache size (may be same as "Your Cache" if only user)

---

## Test 4: Reference Counting (Multi-User Simulation)

### Steps (Manual Simulation):
1. **Download a song as User A**
   - Download a song
   - Note the audioHash from cache_index.json
   - Check registry.json: refCount should be 1

2. **Simulate User B downloading same song**
   - Manually edit `users/` folder to create a second user:
     - Copy `users/alice@server:4533/` to `users/bob@server:4533/`
     - Edit the new cache_index.json to change userId
   - Manually update registry.json:
     - Increment refCount to 2
     - Add "bob@server:4533" to addedBy array

3. **Delete song from User A's cache**
   - Remove song entry from User A's cache_index.json
   - Simulate decrementing refCount in registry.json
   - File should NOT be deleted (refCount = 1 remaining)

4. **Delete song from User B's cache**
   - Remove song from User B's cache_index.json
   - Decrement refCount to 0
   - Now audio directory should be deleted

### Expected Results:
- Files persist while refCount > 0
- Files deleted only when refCount reaches 0
- Multiple users can reference same audio file

---

## Test 5: Error Handling & Edge Cases

### Test 5a: Permission Errors
1. Create a folder with no write permissions
2. Try to set it as cache location
3. Should show error message

### Test 5b: Invalid Path
1. Try to set non-existent path
2. System should create directory or show error

### Test 5c: Disk Space
1. Download songs until near disk limit
2. Check for warnings/errors

### Test 5d: Corrupted Cache Index
1. Manually corrupt cache_index.json (invalid JSON)
2. Restart app
3. Should recreate cache index or show error

### Test 5e: Missing Audio Files
1. Delete an audio file from `audio/{hash}/`
2. Try to play the song
3. Should handle gracefully

---

## Test 6: Cache Management Features

### Steps:
1. **View Cached Albums**
   - In Download Manager, click "Manage"
   - See list of all cached albums

2. **Remove Single Album**
   - Click Delete button next to an album
   - Confirm deletion
   - Verify:
     - Songs removed from cache_index.json
     - Reference counts decremented in registry.json
     - Files deleted if refCount reaches 0

3. **Clear All Cache**
   - Click "Clear All Cache" button
   - Confirm deletion
   - Verify:
     - cache_index.json reset to empty
     - All references removed from registry
     - Audio files deleted (if no other users reference them)

### Expected Results:
- Album list shows all cached albums
- Individual album removal works
- Clear all cache empties user's cache
- Reference counting properly maintained

---

## Test 7: Integration with Player (Offline Playback)

### Steps:
1. **Download some songs**

2. **Disconnect from internet** (disable Wi-Fi/unplug)

3. **Try to play cached song**
   - Song should play from cache
   - No network requests

4. **Try to play non-cached song**
   - Should show error or fallback behavior

5. **Reconnect and sync**
   - Enable internet
   - Verify sync works

---

## Common Issues & Troubleshooting

### Issue: Cache location not persisting
**Solution**: Check that settings.cfg is being created in `%APPDATA%\xylonic\`

### Issue: Downloads fail with permission error
**Solution**: Ensure cache directory has write permissions

### Issue: Cache statistics show wrong size
**Solution**: Delete cache_index.json and re-download to recalculate

### Issue: Audio files not playing
**Solution**: Check that audio/{hash}/audio.{ext} exists and is valid

### Issue: Registry not updating
**Solution**: Check registry.json for syntax errors, delete to recreate

---

## Developer Debugging

### Enable Detailed Logging:
```typescript
// In offlineCacheService.ts, logger.log() should show all operations
// Check browser console (F12) and Electron main process console
```

### Inspect IPC Calls:
```javascript
// In browser console:
await window.electron.getCacheLocation()
await window.electron.readUserCacheIndex('alice@server:4533')
await window.electron.readAudioRegistry()
```

### Check File System:
```powershell
# View cache structure
Get-ChildItem -Recurse "$env:APPDATA\xylonic\permanent_cache"

# Check settings
Get-Content "$env:APPDATA\xylonic\settings.cfg"

# View cache index
Get-Content "$env:APPDATA\xylonic\permanent_cache\users\*\cache_index.json" | ConvertFrom-Json
```

---

## Performance Testing

### Test Large Downloads:
1. Download 50+ songs
2. Monitor CPU and memory usage
3. Check download speed consistency
4. Verify UI remains responsive

### Test Large Cache:
1. Accumulate 1GB+ of cached music
2. Check cache statistics calculation time
3. Verify album list loads quickly
4. Test search in large cache

---

## Success Criteria

**All Priority 1 Tests Pass**:
- Cache location configuration works
- Hash-based storage structure correct
- Multi-user support functional
- Statistics display accurately

**No Compilation Errors**

**No Runtime Errors** in normal usage

**UI Responsive** and intuitive

**Data Persistence** across restarts

---

## Next Steps After Testing

1. Document any bugs found
2. Test v1→v2 migration (if implemented)
3. Performance optimizations if needed
4. User experience improvements
5. Prepare for production release

---

**Happy Testing!**
