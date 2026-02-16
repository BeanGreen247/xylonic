import { useEffect } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { logger } from '../utils/logger';

export const useKeyboardShortcuts = () => {
  const { 
    togglePlayPause, 
    playNext, 
    playPrevious, 
    seek, 
    setVolume, 
    volume,
    currentTime,
    duration,
    toggleShuffle,
    toggleRepeat,
    currentSong
  } = usePlayer();

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Prevent default for our shortcuts
      const shortcuts = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (shortcuts.includes(e.code)) {
        e.preventDefault();
      }

      switch (e.code) {
        case 'Space':
          // Only allow play/pause if a song is loaded
          if (currentSong) {
            logger.log('Keyboard: Space - Toggle Play/Pause');
            togglePlayPause();
          }
          break;

        case 'ArrowRight':
          if (e.shiftKey) {
            // Shift + Right Arrow: Next track (only if song loaded)
            if (currentSong) {
              logger.log('Keyboard: Shift+Right - Next Track');
              playNext();
            }
          } else {
            // Right Arrow: Seek forward 5 seconds (only if song loaded)
            if (currentSong) {
              logger.log('Keyboard: Right - Seek +5s');
              seek(Math.min(currentTime + 5, duration));
            }
          }
          break;

        case 'ArrowLeft':
          if (e.shiftKey) {
            // Shift + Left Arrow: Previous track (only if song loaded)
            if (currentSong) {
              logger.log('Keyboard: Shift+Left - Previous Track');
              playPrevious();
            }
          } else {
            // Left Arrow: Seek backward 5 seconds (only if song loaded)
            if (currentSong) {
              logger.log('Keyboard: Left - Seek -5s');
              seek(Math.max(currentTime - 5, 0));
            }
          }
          break;

        case 'ArrowUp':
          if (e.shiftKey) {
            // Shift + Up Arrow: Volume up 10%
            logger.log('Keyboard: Shift+Up - Volume +10%');
            setVolume(Math.min(volume + 0.1, 1));
          }
          break;

        case 'ArrowDown':
          if (e.shiftKey) {
            // Shift + Down Arrow: Volume down 10%
            logger.log('Keyboard: Shift+Down - Volume -10%');
            setVolume(Math.max(volume - 0.1, 0));
          }
          break;

        case 'KeyS':
          // S: Toggle shuffle
          logger.log('Keyboard: S - Toggle Shuffle');
          toggleShuffle();
          break;

        case 'KeyR':
          // R: Toggle repeat
          logger.log('Keyboard: R - Toggle Repeat');
          toggleRepeat();
          break;

        case 'KeyM':
          if (e.ctrlKey) {
            // Ctrl+M: Toggle mini player (only if song loaded)
            if (currentSong) {
              logger.log('Keyboard: Ctrl+M - Toggle Mini Player');
              e.preventDefault();
              if (window.electron?.toggleMiniPlayer) {
                window.electron.toggleMiniPlayer();
              }
            } else {
              logger.log('Keyboard: Ctrl+M - Mini Player disabled (no song loaded)');
              e.preventDefault();
            }
          } else {
            // M: Mute/Unmute
            logger.log('Keyboard: M - Toggle Mute');
            setVolume(volume === 0 ? 0.7 : 0);
          }
          break;

        case 'Delete':
          if (e.ctrlKey && e.shiftKey) {
            // Ctrl+Shift+Delete: Wipe all cache except permanent offline cache
            e.preventDefault();
            logger.log('Keyboard: Ctrl+Shift+Delete - Wiping all cache (except permanent)');
            
            const confirmWipe = window.confirm(
              'Clear All Cache?\n\n' +
              'This will wipe:\n' +
              '• Image cache (artists & albums)\n' +
              '• Search index cache\n' +
              '• Pre-cache timestamp\n\n' +
              'Permanent offline cache will NOT be affected.\n\n' +
              'Continue?'
            );
            
            if (confirmWipe) {
              (async () => {
                try {
                  console.log('%cWIPING ALL CACHE (except permanent)', 'background: red; color: white; font-size: 14px; font-weight: bold; padding: 4px;');
                  
                  // Clear image cache
                  const { imageCacheService } = await import('../services/imageCacheService');
                  await imageCacheService.clearCache();
                  console.log('%cImage cache cleared', 'color: green; font-weight: bold');
                  
                  // Clear search cache
                  const { searchCacheService } = await import('../services/searchCacheService');
                  await searchCacheService.clearCache();
                  console.log('%cSearch cache cleared', 'color: green; font-weight: bold');
                  
                  // Clear pre-cache timestamp to trigger re-indexing on next launch
                  localStorage.removeItem('cachePreloaded');
                  localStorage.removeItem('cachePreloadTimestamp');
                  console.log('%cPre-cache timestamp cleared', 'color: green; font-weight: bold');
                  
                  console.log('%cALL CACHE WIPED! Reload app to rebuild.', 'background: green; color: white; font-size: 14px; font-weight: bold; padding: 4px;');
                  
                  alert('Cache Cleared!\n\nReload the app to rebuild the cache.');
                  
                  // Reload the app
                  window.location.reload();
                } catch (error) {
                  console.error('Failed to wipe cache:', error);
                  alert('ERROR: Error clearing cache. Check console for details.');
                }
              })();
            }
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [
    togglePlayPause,
    playNext,
    playPrevious,
    seek,
    setVolume,
    volume,
    currentTime,
    duration,
    toggleShuffle,
    toggleRepeat,
    currentSong
  ]);
};

export default useKeyboardShortcuts;
