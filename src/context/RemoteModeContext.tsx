import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import md5 from 'md5';
import { remoteDiscoveryService, RemoteDevice, RemoteCommandResult, RemotePlayerState } from '../services/remoteDiscoveryService';
import { useAuth } from './AuthContext';

interface RemoteModeContextType {
  /** True on Android and Electron. False in plain browser. */
  isRemoteModeAvailable: boolean;
  /** Target mode: this device can be discovered and controlled by others */
  remoteControlEnabled: boolean;
  /** Persist the target-mode toggle; stops/starts broadcast and command server immediately */
  setRemoteControlEnabled(enabled: boolean): Promise<void>;
  /** Controller mode: this device can discover and control other Xylonic instances */
  remoteControllerEnabled: boolean;
  setRemoteControllerEnabled(enabled: boolean): void;
  /** True when on WiFi — remote mode requires local network */
  isOnWifi: boolean;
  /** Discovered peers (excludes self) */
  availableDevices: RemoteDevice[];
  /** Device currently being controlled by this device, or null */
  remoteTarget: RemoteDevice | null;
  /** True when actively controlling a remote device */
  isRemoteMode: boolean;
  /** True when this device is being controlled by someone else */
  isBeingControlled: boolean;
  /** Name of the controller when this device is being controlled */
  controllerName: string | null;
  /** Non-null when a pair attempt was rejected */
  pairingError: string | null;
  /** md5 account identifier for the currently logged-in user; empty string if not authenticated */
  myAccountId: string;
  /** Live player state mirrored from the remote target, or null when not available */
  remotePlayerState: RemotePlayerState | null;
  /** Estimated current playback time on the remote target (ticks every 500ms) */
  remoteCurrentTime: number;
  /** Connect to a remote device — sends pair command; resolves false if rejected */
  connectToDevice(device: RemoteDevice): Promise<boolean>;
  /** Disconnect from the current remote target (sends disconnect command) */
  disconnectRemote(): Promise<void>;
  /** Send a playback command to the remote target */
  sendRemoteCommand(action: string, data?: any): Promise<RemoteCommandResult>;
  /** Register a listener for incoming remote commands (when this device is being controlled) */
  onRemoteCommand(cb: (action: string, data: any) => void): () => void;
  clearPairingError(): void;
}

const RemoteModeContext = createContext<RemoteModeContextType | undefined>(undefined);

export const useRemoteMode = () => {
  const ctx = useContext(RemoteModeContext);
  if (!ctx) throw new Error('useRemoteMode must be used within RemoteModeProvider');
  return ctx;
};

export const RemoteModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { username, serverUrl } = useAuth();
  const isRemoteModeAvailable = Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' && !!(window as any).electron);

  const [remoteControlEnabled, setRemoteControlEnabledState] = useState(() =>
    remoteDiscoveryService.getRemoteControlEnabled()
  );
  const [remoteControllerEnabled, setRemoteControllerEnabledState] = useState(() =>
    remoteDiscoveryService.getRemoteControllerEnabled()
  );
  const [isOnWifi,           setIsOnWifi]           = useState(false);
  const [availableDevices,   setAvailableDevices]   = useState<RemoteDevice[]>([]);
  const [remoteTarget,       setRemoteTarget]       = useState<RemoteDevice | null>(null);
  const [pairingError,       setPairingError]       = useState<string | null>(null);
  const [isBeingControlled,  setIsBeingControlled]  = useState(false);
  const [controllerName,     setControllerName]     = useState<string | null>(null);
  const [remotePlayerState,  setRemotePlayerState]  = useState<RemotePlayerState | null>(null);
  const [remoteCurrentTime,  setRemoteCurrentTime]  = useState(0);
  const remoteTargetRef = useRef<RemoteDevice | null>(null);
  remoteTargetRef.current = remoteTarget;

  const myAccountId = useMemo(
    () => (username && serverUrl ? md5(username + ':' + serverUrl) : ''),
    [username, serverUrl],
  );

  // Push account identity into the discovery service whenever auth changes
  useEffect(() => {
    remoteDiscoveryService.setAccountId(myAccountId);
  }, [myAccountId]);

  // Initialise once
  useEffect(() => {
    remoteDiscoveryService.init().catch(() => {});

    const unsubDevices = remoteDiscoveryService.onDevicesChanged(setAvailableDevices);

    const unsubPairing = remoteDiscoveryService.onPairingChanged((info) => {
      if (info) {
        setIsBeingControlled(true);
        setControllerName(info.controllerName || 'Unknown Device');
      } else {
        setIsBeingControlled(false);
        setControllerName(null);
      }
    });

    const checkWifi = async () => setIsOnWifi(await remoteDiscoveryService.isOnWifi());
    checkWifi();
    const wifiTimer = setInterval(checkWifi, 10000);

    const unsubState = remoteDiscoveryService.onRemotePlayerState((state) => {
      if (remoteTargetRef.current?.id === state.id) {
        setRemotePlayerState(state);
        // Snap current time immediately on state update
        const elapsed = (Date.now() - state.stateTs) / 1000;
        setRemoteCurrentTime(Math.min(state.currentTime + (state.isPlaying ? elapsed : 0), state.duration));
      }
    });

    return () => {
      unsubDevices();
      unsubPairing();
      unsubState();
      clearInterval(wifiTimer);
    };
  }, []);

  // Tick estimated current time every 500ms while remote is playing
  useEffect(() => {
    if (!remotePlayerState?.isPlaying) return;
    const id = setInterval(() => {
      const elapsed = (Date.now() - remotePlayerState.stateTs) / 1000;
      setRemoteCurrentTime(Math.min(remotePlayerState.currentTime + elapsed, remotePlayerState.duration));
    }, 500);
    return () => clearInterval(id);
  }, [remotePlayerState]);

  // Clear remote state when disconnecting
  useEffect(() => {
    if (!remoteTarget) {
      setRemotePlayerState(null);
      setRemoteCurrentTime(0);
    }
  }, [remoteTarget]);

  // Drop remote target if the target device disappears from the network
  useEffect(() => {
    if (remoteTarget && !availableDevices.find(d => d.id === remoteTarget.id)) {
      setRemoteTarget(null);
    }
  }, [availableDevices, remoteTarget]);

  const connectToDevice = useCallback(async (device: RemoteDevice): Promise<boolean> => {
    setPairingError(null);
    const result = await remoteDiscoveryService.sendCommand(device, 'pair', {
      controllerName: remoteDiscoveryService.getDeviceName(),
    });

    if (result.ok) {
      setRemoteTarget(device);
      remoteDiscoveryService.setControllerTarget(device.id).catch(() => {});
      return true;
    }

    const msg =
      result.reason === 'already_paired'          ? 'That device is already controlled by another Xylonic.' :
      result.reason === 'remote_control_disabled' ? 'That device has disabled remote control.' :
      result.reason === 'account_mismatch'        ? 'That device is signed into a different Navidrome account.' :
      result.reason === 'network_error'           ? 'Could not reach that device.' :
      'Could not pair with that device.';
    setPairingError(msg);
    return false;
  }, []);

  const disconnectRemote = useCallback(async (): Promise<void> => {
    if (!remoteTarget) return;
    await remoteDiscoveryService.sendCommand(remoteTarget, 'disconnect').catch(() => {});
    remoteDiscoveryService.setControllerTarget(null).catch(() => {});
    setRemoteTarget(null);
  }, [remoteTarget]);

  const sendRemoteCommand = useCallback(async (action: string, data?: any): Promise<RemoteCommandResult> => {
    if (!remoteTarget) return { ok: false, reason: 'no_target' };
    return remoteDiscoveryService.sendCommand(remoteTarget, action, data);
  }, [remoteTarget]);

  const onRemoteCommand = useCallback(
    (cb: (action: string, data: any) => void) => remoteDiscoveryService.onRemoteCommand(cb),
    [],
  );

  const setRemoteControlEnabled = useCallback(async (enabled: boolean) => {
    setRemoteControlEnabledState(enabled);
    if (!enabled && remoteTarget) {
      await remoteDiscoveryService.sendCommand(remoteTarget, 'disconnect').catch(() => {});
      remoteDiscoveryService.setControllerTarget(null).catch(() => {});
      setRemoteTarget(null);
    }
    await remoteDiscoveryService.setRemoteControlEnabled(enabled);
  }, [remoteTarget]);

  const setRemoteControllerEnabled = useCallback((enabled: boolean) => {
    setRemoteControllerEnabledState(enabled);
    remoteDiscoveryService.setRemoteControllerEnabled(enabled);
    if (!enabled && remoteTarget) {
      remoteDiscoveryService.sendCommand(remoteTarget, 'disconnect').catch(() => {});
      remoteDiscoveryService.setControllerTarget(null).catch(() => {});
      setRemoteTarget(null);
    }
  }, [remoteTarget]);

  const clearPairingError = useCallback(() => setPairingError(null), []);

  return (
    <RemoteModeContext.Provider value={{
      isRemoteModeAvailable,
      remoteControlEnabled,
      setRemoteControlEnabled,
      remoteControllerEnabled,
      setRemoteControllerEnabled,
      isOnWifi,
      availableDevices,
      remoteTarget,
      isRemoteMode:      remoteTarget !== null,
      isBeingControlled,
      controllerName,
      pairingError,
      myAccountId,
      remotePlayerState,
      remoteCurrentTime,
      connectToDevice,
      disconnectRemote,
      sendRemoteCommand,
      onRemoteCommand,
      clearPairingError,
    }}>
      {children}
    </RemoteModeContext.Provider>
  );
};
