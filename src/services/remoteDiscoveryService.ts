import { Capacitor, registerPlugin } from '@capacitor/core';

export interface RemoteDevice {
  id: string;
  name: string;
  host: string;
  cmdPort: number;
  platform: 'android' | 'electron';
  /** ID of the controller that has locked this device, or null if free */
  pairedWith: string | null;
  /** ID of the device this device is currently controlling, or null if not acting as controller */
  controllingId: string | null;
  /** md5(username:serverUrl) for account-scoped pairing; null if the peer hasn't set one */
  accountId: string | null;
}

export interface RemoteCommandResult {
  ok: boolean;
  reason?: string;
}

export interface RemotePlayerState {
  id: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  stateTs: number;
  song: {
    id: string;
    title: string;
    artist: string;
    album?: string;
    coverArt?: string;
    duration?: number;
  } | null;
}

interface RemoteDiscoveryPlugin {
  startBroadcast(opts: { deviceId: string; deviceName: string }): Promise<void>;
  stopBroadcast(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  setControllerTarget(opts: { id: string | null }): Promise<void>;
  updatePlayerState(opts: { playerStateJson: string }): Promise<void>;
  sendCommand(opts: {
    host: string; port: number; action: string; data: string; controllerId: string;
  }): Promise<RemoteCommandResult>;
  isOnWifi(): Promise<{ onWifi: boolean }>;
  addListener(event: 'deviceFound',          handler: (d: RemoteDevice) => void): Promise<{ remove(): void }>;
  addListener(event: 'deviceLost',           handler: (d: { id: string }) => void): Promise<{ remove(): void }>;
  addListener(event: 'devicePairingChanged', handler: (d: { id: string; pairedWith: string | null }) => void): Promise<{ remove(): void }>;
  addListener(event: 'remoteCommand',        handler: (d: { action: string; data: string }) => void): Promise<{ remove(): void }>;
  addListener(event: 'pairingEstablished',   handler: (d: { controllerId: string; controllerName: string }) => void): Promise<{ remove(): void }>;
  addListener(event: 'pairingCleared',       handler: (d: {}) => void): Promise<{ remove(): void }>;
  addListener(event: 'playerStateUpdate',    handler: (d: RemotePlayerState) => void): Promise<{ remove(): void }>;
}

const RemoteDiscovery = registerPlugin<RemoteDiscoveryPlugin>('RemoteDiscovery');

type DeviceListCallback    = (devices: RemoteDevice[]) => void;
type CommandCallback       = (action: string, data: any) => void;
type PairingCallback       = (info: { controllerId: string; controllerName: string } | null) => void;
type PlayerStateCallback   = (state: RemotePlayerState) => void;

const DEVICE_ID_KEY              = '_xylonic_remote_device_id';
const REMOTE_ENABLED_KEY         = 'xylonic_remote_control_enabled';
const REMOTE_CONTROLLER_KEY      = 'xylonic_remote_controller_enabled';

function genUUID(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = genUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

class RemoteDiscoveryService {
  private deviceId   = '';
  private deviceName = 'Xylonic';
  private accountId  = '';

  private devices             = new Map<string, RemoteDevice>();
  private deviceListeners     = new Set<DeviceListCallback>();
  private commandListeners    = new Set<CommandCallback>();
  private pairingListeners    = new Set<PairingCallback>();
  private playerStateListeners = new Set<PlayerStateCallback>();

  private initialized    = false;
  private pluginCleanups: Array<() => void> = [];

  getRemoteControlEnabled(): boolean {
    return localStorage.getItem(REMOTE_ENABLED_KEY) !== 'false';
  }

  getRemoteControllerEnabled(): boolean {
    return localStorage.getItem(REMOTE_CONTROLLER_KEY) !== 'false';
  }

  setRemoteControllerEnabled(enabled: boolean): void {
    localStorage.setItem(REMOTE_CONTROLLER_KEY, enabled ? 'true' : 'false');
  }

  setAccountId(id: string): void {
    this.accountId = id;
    if (Capacitor.isNativePlatform() && this.getRemoteControlEnabled()) {
      RemoteDiscovery.startBroadcast({ deviceId: this.deviceId, deviceName: this.deviceName, accountId: id }).catch(() => {});
    } else if (typeof window !== 'undefined' && (window as any).electron?.remoteSetAccountId) {
      (window as any).electron.remoteSetAccountId(id).catch(() => {});
    }
  }

  async setRemoteControlEnabled(enabled: boolean): Promise<void> {
    localStorage.setItem(REMOTE_ENABLED_KEY, enabled ? 'true' : 'false');
    if (Capacitor.isNativePlatform()) {
      if (enabled) {
        await RemoteDiscovery.startBroadcast({ deviceId: this.deviceId, deviceName: this.deviceName, accountId: this.accountId });
        await RemoteDiscovery.startDiscovery();
      } else {
        await RemoteDiscovery.stopBroadcast();
        await RemoteDiscovery.stopDiscovery();
        this.devices.clear();
        this.notifyDeviceListeners();
      }
    } else if (typeof window !== 'undefined' && (window as any).electron) {
      await (window as any).electron.remoteSetControlEnabled(enabled);
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.deviceId   = getOrCreateDeviceId();
    this.deviceName = this.buildDeviceName();

    if (Capacitor.isNativePlatform()) {
      await this.initCapacitor();
    } else if (typeof window !== 'undefined' && (window as any).electron) {
      await this.initElectron();
    }
  }

  private buildDeviceName(): string {
    if (Capacitor.isNativePlatform()) {
      const ua = navigator.userAgent;
      const m  = ua.match(/;\s*([^)]+)\s*Build\//);
      return m ? m[1].trim() : 'Android Device';
    }
    return 'Desktop';
  }

  private static normStr(v: any): string | null {
    return (v && v !== 'null') ? String(v) : null;
  }

  private async initCapacitor(): Promise<void> {
    const foundH = await RemoteDiscovery.addListener('deviceFound', (dev) => {
      this.devices.set(dev.id, {
        ...dev,
        pairedWith:    RemoteDiscoveryService.normStr(dev.pairedWith),
        controllingId: RemoteDiscoveryService.normStr((dev as any).controllingId),
        accountId:     RemoteDiscoveryService.normStr((dev as any).accountId),
      });
      this.notifyDeviceListeners();
    });
    const lostH = await RemoteDiscovery.addListener('deviceLost', ({ id }) => {
      this.devices.delete(id);
      this.notifyDeviceListeners();
    });
    const pairChangedH = await RemoteDiscovery.addListener('devicePairingChanged', (ev: any) => {
      const existing = this.devices.get(ev.id);
      if (existing) {
        existing.pairedWith    = RemoteDiscoveryService.normStr(ev.pairedWith);
        existing.controllingId = RemoteDiscoveryService.normStr(ev.controllingId);
        this.notifyDeviceListeners();
      }
    });
    const cmdH = await RemoteDiscovery.addListener('remoteCommand', ({ action, data }) => {
      let parsed: any = {};
      try { parsed = JSON.parse(data); } catch {}
      this.notifyCommandListeners(action, parsed);
    });
    const pairedH = await RemoteDiscovery.addListener('pairingEstablished', (info) => {
      this.notifyPairingListeners(info);
    });
    const clearedH = await RemoteDiscovery.addListener('pairingCleared', () => {
      this.notifyPairingListeners(null);
    });
    const stateH = await RemoteDiscovery.addListener('playerStateUpdate', (state) => {
      this.playerStateListeners.forEach(cb => cb(state));
    });

    this.pluginCleanups.push(
      () => foundH.remove(), () => lostH.remove(), () => pairChangedH.remove(),
      () => cmdH.remove(),   () => pairedH.remove(), () => clearedH.remove(),
      () => stateH.remove(),
    );

    if (this.getRemoteControlEnabled()) {
      await RemoteDiscovery.startBroadcast({ deviceId: this.deviceId, deviceName: this.deviceName, accountId: this.accountId });
      await RemoteDiscovery.startDiscovery();
    }
  }

  private async initElectron(): Promise<void> {
    const el = (window as any).electron;

    // Sync device ID and name from the main process
    try {
      const mainId = await el.remoteGetDeviceId();
      if (mainId) { this.deviceId = mainId; localStorage.setItem(DEVICE_ID_KEY, mainId); }
    } catch {}
    try {
      const mainName = await el.remoteGetDeviceName();
      if (mainName) { this.deviceName = mainName; }
    } catch {}

    const removeFound = el.onRemoteDeviceFound((dev: RemoteDevice) => {
      this.devices.set(dev.id, { ...dev, controllingId: dev.controllingId ?? null, accountId: (dev as any).accountId ?? null });
      this.notifyDeviceListeners();
    });
    const removeLost = el.onRemoteDeviceLost(({ id }: { id: string }) => {
      this.devices.delete(id);
      this.notifyDeviceListeners();
    });
    const removePairChanged = el.onRemoteDevicePairingChanged(
      (ev: { id: string; pairedWith?: string | null; controllingId?: string | null }) => {
        const existing = this.devices.get(ev.id);
        if (existing) {
          existing.pairedWith    = ev.pairedWith    ?? null;
          existing.controllingId = ev.controllingId ?? null;
          this.notifyDeviceListeners();
        }
      },
    );
    const removeCmd = el.onRemoteCommand(({ action, data }: { action: string; data: any }) => {
      this.notifyCommandListeners(action, data || {});
    });
    const removePaired = el.onRemotePairingEstablished(
      (info: { controllerId: string; controllerName: string }) => {
        this.notifyPairingListeners(info);
      },
    );
    const removeCleared = el.onRemotePairingCleared(() => {
      this.notifyPairingListeners(null);
    });

    const removeStateUpdate = el.onRemotePlayerStateUpdate((state: RemotePlayerState) => {
      this.playerStateListeners.forEach(cb => cb(state));
    });

    this.pluginCleanups.push(
      removeFound, removeLost, removePairChanged, removeCmd, removePaired, removeCleared,
      removeStateUpdate,
    );

    // Seed device list with any devices already discovered before the renderer loaded
    try {
      const snapshot: RemoteDevice[] = await el.remoteGetDevices();
      for (const dev of snapshot) {
        if (dev.id !== this.deviceId) {
          this.devices.set(dev.id, { ...dev, controllingId: dev.controllingId ?? null });
        }
      }
      if (snapshot.length > 0) this.notifyDeviceListeners();
    } catch {}

    // Sync persisted preference to main process so the pair handler honours it
    try {
      await el.remoteSetControlEnabled(this.getRemoteControlEnabled());
    } catch {}
  }

  // ── Device list ───────────────────────────────────────────────────────────

  onDevicesChanged(cb: DeviceListCallback): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }
  getDevices(): RemoteDevice[] { return Array.from(this.devices.values()); }
  private notifyDeviceListeners(): void {
    const list = this.getDevices();
    this.deviceListeners.forEach(cb => cb(list));
  }

  // ── Incoming commands ─────────────────────────────────────────────────────

  onRemoteCommand(cb: CommandCallback): () => void {
    this.commandListeners.add(cb);
    return () => this.commandListeners.delete(cb);
  }
  private notifyCommandListeners(action: string, data: any): void {
    this.commandListeners.forEach(cb => cb(action, data));
  }

  // ── Pairing state (this device being controlled) ──────────────────────────

  onPairingChanged(cb: PairingCallback): () => void {
    this.pairingListeners.add(cb);
    return () => this.pairingListeners.delete(cb);
  }
  private notifyPairingListeners(info: { controllerId: string; controllerName: string } | null): void {
    this.pairingListeners.forEach(cb => cb(info));
  }

  // ── Remote player state (controller sees target's playback) ──────────────

  onRemotePlayerState(cb: PlayerStateCallback): () => void {
    this.playerStateListeners.add(cb);
    return () => this.playerStateListeners.delete(cb);
  }

  // ── Outgoing commands ─────────────────────────────────────────────────────

  async sendCommand(target: RemoteDevice, action: string, data?: any): Promise<RemoteCommandResult> {
    const payload = action === 'pair'
      ? { ...(data || {}), controllerAccountId: this.accountId }
      : (data || {});
    if (Capacitor.isNativePlatform()) {
      try {
        return await RemoteDiscovery.sendCommand({
          host:         target.host,
          port:         target.cmdPort,
          action,
          data:         JSON.stringify(payload),
          controllerId: this.deviceId,
        });
      } catch {
        return { ok: false, reason: 'network_error' };
      }
    }
    const el = typeof window !== 'undefined' ? (window as any).electron : null;
    if (el?.remoteSendCommand) {
      return el.remoteSendCommand({
        host:         target.host,
        port:         target.cmdPort,
        action,
        data:         JSON.stringify(payload),
        controllerId: this.deviceId,
      });
    }
    return { ok: false, reason: 'controller_not_allowed' };
  }

  // ── Player state broadcast (target → controller) ─────────────────────────

  async updatePlayerState(state: {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    song: { id: string; title: string; artist: string; album: string; coverArt: string; duration: number } | null;
  }): Promise<void> {
    const playerStateJson = JSON.stringify(state);
    if (Capacitor.isNativePlatform()) {
      try { await RemoteDiscovery.updatePlayerState({ playerStateJson }); } catch {}
    }
    // Electron already broadcasts lastPlayerState from the main process — no action needed there
  }

  // ── Controller state ──────────────────────────────────────────────────────

  async setControllerTarget(id: string | null): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try { await RemoteDiscovery.setControllerTarget({ id }); } catch {}
    } else if (typeof window !== 'undefined' && (window as any).electron) {
      try { await (window as any).electron.remoteSetControllerTarget(id); } catch {}
    }
  }

  // ── WiFi check ────────────────────────────────────────────────────────────

  async isOnWifi(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try { return (await RemoteDiscovery.isOnWifi()).onWifi; } catch { return false; }
    }
    return true; // Electron/desktop: always assume LAN available
  }

  getDeviceId():   string { return this.deviceId; }
  getDeviceName(): string { return this.deviceName; }

  destroy(): void {
    this.pluginCleanups.forEach(fn => { try { fn(); } catch {} });
    this.pluginCleanups = [];
    if (Capacitor.isNativePlatform()) {
      RemoteDiscovery.stopBroadcast().catch(() => {});
      RemoteDiscovery.stopDiscovery().catch(() => {});
    }
    this.initialized = false;
  }
}

export const remoteDiscoveryService = new RemoteDiscoveryService();
