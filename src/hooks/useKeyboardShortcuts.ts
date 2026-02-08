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
          // M: Mute/Unmute
          logger.log('Keyboard: M - Toggle Mute');
          setVolume(volume === 0 ? 0.7 : 0);
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
