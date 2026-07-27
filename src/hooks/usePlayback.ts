import { useCallback } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { useRemoteMode } from '../context/RemoteModeContext';
import { Song } from '../types';

/**
 * Drop-in replacement for usePlayer()'s playSong / playPlaylist.
 * When in remote mode, commands are forwarded to the paired device instead of
 * playing locally. All other PlayerContext values are passed through unchanged.
 */
export function usePlayback() {
  const player = usePlayer();
  const { isRemoteMode, sendRemoteCommand } = useRemoteMode();

  const playSong = useCallback((song: Song) => {
    if (isRemoteMode) {
      sendRemoteCommand('playSong', song);
    } else {
      player.playSong(song);
    }
  }, [isRemoteMode, sendRemoteCommand, player.playSong]); // eslint-disable-line react-hooks/exhaustive-deps

  const playPlaylist = useCallback((songs: Song[], startIndex = 0) => {
    if (isRemoteMode) {
      sendRemoteCommand('playPlaylist', { songs, startIndex });
    } else {
      player.playPlaylist(songs, startIndex);
    }
  }, [isRemoteMode, sendRemoteCommand, player.playPlaylist]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...player, playSong, playPlaylist };
}
