# Streaming Quality Verification Guide

## How to Verify Your Streaming Quality is Actually Applied

### For Users

#### Method 1: Visual Indicator (Easiest)
- Look at the **quality indicator badge** below the streaming quality dropdown
- It shows your current active quality (e.g., "320 kbps" or "Original")
- This updates instantly when you change quality

#### Method 2: Browser DevTools - Console
1. Press **F12** or **Ctrl+Shift+I** to open DevTools
2. Go to **Console** tab
3. Select a quality from the dropdown
4. Play a song
5. Look for these messages:
   ```
   [STREAMING QUALITY] Changed to: 320 kbps
   [STREAMING QUALITY] Saved to settings for user: yourname
   [STREAM URL] Generating stream with maxBitRate=320 for song abc123
   [STREAM URL] http://yourserver/rest/stream.view?...&maxBitRate=320...
   [PLAYBACK] Streaming song abc123 at quality: 320 kbps
   ```

#### Method 3: Browser DevTools - Network Tab (Most Accurate)
1. Press **F12** or **Ctrl+Shift+I** to open DevTools
2. Go to **Network** tab
3. Play a song
4. Look for `stream.view` request
5. Click on it and check:
   - **Headers** tab → **Request URL** should contain `&maxBitRate=320` (or your selected value)
   - **Size** column shows actual download size
   - **Time** column shows download duration
   
**What to expect:**
- **Original**: No `maxBitRate` parameter, largest file size
- **320 kbps**: `maxBitRate=320`, ~2.4 MB per minute
- **128 kbps**: `maxBitRate=128`, ~960 KB per minute
- **64 kbps**: `maxBitRate=64`, ~480 KB per minute

---

### For Developers

#### Method 1: Console Logs (Already Implemented)
The app logs every quality change and stream URL generation:
```javascript
console.log('[STREAMING QUALITY] Changed to:', bitrate);
console.log('[STREAM URL] Generating stream with maxBitRate=320');
console.log('[STREAM URL]', fullUrl);
```

#### Method 2: Electron DevTools Network Monitor
Electron includes Chromium DevTools with full network inspection:

**Enable in Development:**
```javascript
// Already enabled in electron.js with mainWindow.webContents.openDevTools()
```

**View Network Traffic:**
1. Open app with `npm run electron:serve`
2. DevTools opens automatically in dev mode
3. Go to **Network** tab
4. Filter by `stream.view`
5. Inspect request headers and query parameters

#### Method 3: Electron Net Module (Advanced)
If you need programmatic monitoring, Electron's `net` module can track requests:

```javascript
// In main process (electron.js)
const { net } = require('electron');

// Intercept requests
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  if (details.url.includes('stream.view')) {
    console.log('[NETWORK] Stream request:', details.url);
    // Check for maxBitRate parameter
    const url = new URL(details.url);
    const bitrate = url.searchParams.get('maxBitRate');
    console.log('[BITRATE]', bitrate || 'Original (no transcoding)');
  }
  callback({});
});
```

#### Method 4: Network Traffic Analysis

**Using Electron's Built-in Tools:**
1. Press **Ctrl+Shift+I** in Electron app
2. Network tab → Enable "Preserve log"
3. Play multiple songs at different qualities
4. Compare transfer sizes:
   - Right-click on Size column → Sort by Size
   - Verify higher bitrates = larger transfers

**Using External Tools:**
- **Wireshark**: Packet-level analysis (overkill but accurate)
- **Fiddler**: HTTP/HTTPS proxy debugging
- **Charles Proxy**: Request/response inspection

#### Method 5: File Size Verification

**Calculate Expected Size:**
```javascript
// For a 3-minute song at 320 kbps:
// 320 kbps x 60 seconds x 3 minutes / 8 bits/byte = ~7.2 MB

function calculateExpectedSize(bitrate, durationSeconds) {
  return (bitrate * durationSeconds) / 8 / 1024; // Returns KB
}

// Example:
console.log(calculateExpectedSize(320, 180)); // ~7200 KB for 3 min song
console.log(calculateExpectedSize(128, 180)); // ~2880 KB for 3 min song
```

**Verify in Network Tab:**
- Size transferred should match expected size ±10% (container overhead)

---

### Expected Bitrates & File Sizes

| Quality | Bitrate | MB per Minute | 3-Min Song | 5-Min Song |
|---------|---------|---------------|------------|------------|
| Original | Variable | 5-15 MB | 15-45 MB | 25-75 MB |
| 320 kbps | 320 kbps | ~2.4 MB | ~7.2 MB | ~12 MB |
| 256 kbps | 256 kbps | ~1.9 MB | ~5.7 MB | ~9.5 MB |
| 192 kbps | 192 kbps | ~1.4 MB | ~4.3 MB | ~7.2 MB |
| 128 kbps | 128 kbps | ~0.96 MB | ~2.9 MB | ~4.8 MB |
| 64 kbps | 64 kbps | ~0.48 MB | ~1.4 MB | ~2.4 MB |

*Note: Actual sizes may vary due to VBR encoding and container overhead*

---

### 🎬 Quick Test Procedure

1. **Setup**: Open DevTools (F12) → Network tab
2. **Baseline**: Select "Original", play 30 seconds of a song, note size
3. **Test**: Select "64 kbps", play same song for 30 seconds
4. **Verify**: Size should be ~12x smaller than Original
5. **Confirm**: Check URL contains `maxBitRate=64`

If the size difference matches expectations, quality control is working!

---

### 🐛 Troubleshooting

**Issue**: Quality selector changes but file size stays the same
- **Check**: Server supports transcoding (`/rest/stream.view?maxBitRate=X`)
- **Verify**: Subsonic API version >= 1.9.0
- **Test**: Try different server (Navidrome, Airsonic, Gonic)

**Issue**: No `maxBitRate` parameter in URL
- **Check**: Console logs show quality change
- **Verify**: `getStreamUrl()` receives bitrate parameter
- **Debug**: Add breakpoint in `subsonicApi.ts` line 174

**Issue**: Server ignores `maxBitRate`
- **Check**: Server logs for transcoding activity
- **Verify**: FFmpeg/transcoding enabled in server config
- **Test**: Manually access URL with `maxBitRate` parameter

---

### Technical References

- **Subsonic API Docs**: [stream.view](http://www.subsonic.org/pages/api.jsp#stream)
- **Electron DevTools**: [Debugging](https://www.electronjs.org/docs/latest/tutorial/application-debugging)
- **Network Inspection**: [Chrome DevTools Network](https://developer.chrome.com/docs/devtools/network/)
- **Bitrate Calculator**: `(bitrate_kbps * duration_seconds) / 8 / 1024` = MB

---

**Last Updated**: February 13, 2026  
**Version**: 26.2.8-dev
