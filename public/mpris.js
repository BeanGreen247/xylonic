'use strict';

/**
 * Native MPRIS2 D-Bus service for Linux desktop integration.
 * Bypasses Chromium's broken MPRIS artwork bridge by owning the D-Bus
 * interface directly in the main process.
 */

const { sessionBus, Variant } = require('dbus-next');
const { Interface, ACCESS_READ, ACCESS_READWRITE } = require('dbus-next').interface;

const SERVICE_NAME = 'org.mpris.MediaPlayer2.xylonic';
const OBJECT_PATH  = '/org/mpris/MediaPlayer2';

// ── helpers ──────────────────────────────────────────────────────────────────

function safeBigInt(n) {
    try { return BigInt(Math.round(Number(n))); } catch { return BigInt(0); }
}

function buildMetadata(state) {
    const { currentSong, duration, coverArtUrl } = state || {};
    if (!currentSong) return {};

    const safeId = String(currentSong.id || '').replace(/[^a-zA-Z0-9_]/g, '_');
    const meta = {
        'mpris:trackid': new Variant('o', `/org/xylonic/track/${safeId || 'unknown'}`),
        'xesam:title':   new Variant('s', currentSong.title  || ''),
        'xesam:artist':  new Variant('as', [currentSong.artist || '']),
        'xesam:album':   new Variant('s', currentSong.album  || ''),
    };

    if (typeof duration === 'number' && isFinite(duration) && duration > 0) {
        meta['mpris:length'] = new Variant('x', safeBigInt(duration * 1e6));
    }

    if (coverArtUrl && typeof coverArtUrl === 'string') {
        meta['mpris:artUrl'] = new Variant('s', coverArtUrl);
    }

    return meta;
}

// ── org.mpris.MediaPlayer2 ────────────────────────────────────────────────────

class MediaPlayer2 extends Interface {
    constructor(mainWindow) {
        super('org.mpris.MediaPlayer2');
        this._win = mainWindow;
    }

    get Identity()            { return 'Xylonic'; }
    get CanQuit()             { return false; }
    get CanRaise()            { return true; }
    get HasTrackList()        { return false; }
    get SupportedUriSchemes() { return []; }
    get SupportedMimeTypes()  { return []; }

    Raise() {
        const w = this._win;
        if (w && !w.isDestroyed()) { w.show(); w.focus(); }
    }
    Quit() {}
}

MediaPlayer2.configureMembers({
    properties: {
        Identity:            { signature: 's',  access: ACCESS_READ },
        CanQuit:             { signature: 'b',  access: ACCESS_READ },
        CanRaise:            { signature: 'b',  access: ACCESS_READ },
        HasTrackList:        { signature: 'b',  access: ACCESS_READ },
        SupportedUriSchemes: { signature: 'as', access: ACCESS_READ },
        SupportedMimeTypes:  { signature: 'as', access: ACCESS_READ },
    },
    methods: {
        Raise: { inSignature: '', outSignature: '' },
        Quit:  { inSignature: '', outSignature: '' },
    },
    signals: {},
});

// ── org.mpris.MediaPlayer2.Player ─────────────────────────────────────────────

class MediaPlayer2Player extends Interface {
    constructor(cb) {
        super('org.mpris.MediaPlayer2.Player');
        this._cb       = cb;
        this._status   = 'Stopped';
        this._meta     = {};
        this._volume   = 1.0;
        this._shuffle  = false;
        this._loop     = 'None';
        this._rate     = 1.0;
        this._position = 0; // microseconds
        this._hasSong  = false;
    }

    get PlaybackStatus() { return this._status; }

    get LoopStatus() { return this._loop; }
    set LoopStatus(v) {
        this._loop = String(v);
        const map = { None: 'repeat_off', Track: 'repeat_one', Playlist: 'repeat_all' };
        if (map[this._loop]) this._cb(map[this._loop]);
    }

    get Rate() { return this._rate; }
    set Rate(v) { this._rate = Number(v) || 1.0; }

    get Shuffle() { return this._shuffle; }
    set Shuffle(v) {
        this._shuffle = !!v;
        this._cb('setShuffle', this._shuffle);
    }

    get Metadata() { return this._meta; }

    get Volume() { return this._volume; }
    set Volume(v) {
        this._volume = Math.max(0, Math.min(1, Number(v) || 0));
        this._cb('setVolume', this._volume);
    }

    get Position()    { return safeBigInt(this._position); }
    get MinimumRate() { return 1.0; }
    get MaximumRate() { return 1.0; }
    get CanGoNext()   { return this._hasSong; }
    get CanGoPrevious(){ return this._hasSong; }
    get CanPlay()     { return this._hasSong; }
    get CanPause()    { return this._hasSong; }
    get CanSeek()     { return true; }
    get CanControl()  { return true; }

    Next()        { this._cb('playNext'); }
    Previous()    { this._cb('playPrevious'); }
    Pause()       { this._cb('pause'); }
    PlayPause()   { this._cb('togglePlayPause'); }
    Stop()        { this._cb('pause'); }
    Play()        { this._cb('play'); }

    Seek(offset) {
        this._cb('seekRelative', Number(offset) / 1e6);
    }

    SetPosition(_trackId, position) {
        this._cb('seekAbsolute', Number(position) / 1e6);
    }

    OpenUri(_uri) {}

    // Signal — wrapped by configureMembers to emit on the bus
    Seeked(position) { return safeBigInt(position); }
}

MediaPlayer2Player.configureMembers({
    properties: {
        PlaybackStatus:  { signature: 's',    access: ACCESS_READ },
        LoopStatus:      { signature: 's',    access: ACCESS_READWRITE },
        Rate:            { signature: 'd',    access: ACCESS_READWRITE },
        Shuffle:         { signature: 'b',    access: ACCESS_READWRITE },
        Metadata:        { signature: 'a{sv}',access: ACCESS_READ },
        Volume:          { signature: 'd',    access: ACCESS_READWRITE },
        Position:        { signature: 'x',    access: ACCESS_READ },
        MinimumRate:     { signature: 'd',    access: ACCESS_READ },
        MaximumRate:     { signature: 'd',    access: ACCESS_READ },
        CanGoNext:       { signature: 'b',    access: ACCESS_READ },
        CanGoPrevious:   { signature: 'b',    access: ACCESS_READ },
        CanPlay:         { signature: 'b',    access: ACCESS_READ },
        CanPause:        { signature: 'b',    access: ACCESS_READ },
        CanSeek:         { signature: 'b',    access: ACCESS_READ },
        CanControl:      { signature: 'b',    access: ACCESS_READ },
    },
    methods: {
        Next:        { inSignature: '',   outSignature: '' },
        Previous:    { inSignature: '',   outSignature: '' },
        Pause:       { inSignature: '',   outSignature: '' },
        PlayPause:   { inSignature: '',   outSignature: '' },
        Stop:        { inSignature: '',   outSignature: '' },
        Play:        { inSignature: '',   outSignature: '' },
        Seek:        { inSignature: 'x',  outSignature: '' },
        SetPosition: { inSignature: 'ox', outSignature: '' },
        OpenUri:     { inSignature: 's',  outSignature: '' },
    },
    signals: {
        Seeked: { signature: 'x' },
    },
});

// ── public API ────────────────────────────────────────────────────────────────

let _player = null;

async function initMpris(mainWindow, controlCallback) {
    if (process.platform !== 'linux') return;
    try {
        const bus = sessionBus();
        await bus.requestName(SERVICE_NAME, 0);

        const iface  = new MediaPlayer2(mainWindow);
        const player = new MediaPlayer2Player(controlCallback);

        bus.export(OBJECT_PATH, iface);
        bus.export(OBJECT_PATH, player);

        _player = player;
        console.log('[MPRIS] Registered:', SERVICE_NAME);
    } catch (err) {
        console.warn('[MPRIS] Failed to initialise:', err.message);
    }
}

function updateMprisState(state) {
    if (!_player) return;
    try {
        const changed = {};

        // PlaybackStatus
        const newStatus = state.currentSong
            ? (state.isPlaying ? 'Playing' : 'Paused')
            : 'Stopped';
        if (_player._status !== newStatus) {
            _player._status = newStatus;
            changed.PlaybackStatus = newStatus;
        }

        // Metadata — rebuild when song or art URL changes
        const newMeta  = buildMetadata(state);
        const oldTrack = _player._meta['mpris:trackid']?.value;
        const newTrack = newMeta['mpris:trackid']?.value;
        const oldArt   = _player._meta['mpris:artUrl']?.value;
        const newArt   = newMeta['mpris:artUrl']?.value;
        if (oldTrack !== newTrack || oldArt !== newArt) {
            _player._meta = newMeta;
            changed.Metadata = newMeta;
        }

        // Volume
        const vol = typeof state.volume === 'number' ? state.volume : 1.0;
        if (Math.abs(_player._volume - vol) > 0.001) {
            _player._volume = vol;
            changed.Volume = vol;
        }

        // Shuffle
        const shuffle = !!state.shuffle;
        if (_player._shuffle !== shuffle) {
            _player._shuffle = shuffle;
            changed.Shuffle = shuffle;
        }

        // LoopStatus
        const loopMap = { off: 'None', all: 'Playlist', one: 'Track' };
        const loop = loopMap[state.repeat] || 'None';
        if (_player._loop !== loop) {
            _player._loop = loop;
            changed.LoopStatus = loop;
        }

        // Can* caps
        const has = !!state.currentSong;
        if (_player._hasSong !== has) {
            _player._hasSong = has;
            changed.CanPlay      = has;
            changed.CanPause     = has;
            changed.CanGoNext    = has;
            changed.CanGoPrevious= has;
        }

        // Position — update internally, no PropertiesChanged (changes too often)
        if (typeof state.currentTime === 'number') {
            _player._position = Math.round(state.currentTime * 1e6);
        }

        if (Object.keys(changed).length > 0) {
            Interface.emitPropertiesChanged(_player, changed, []);
        }
    } catch (err) {
        console.error('[MPRIS] updateMprisState error:', err.message);
    }
}

module.exports = { initMpris, updateMprisState };
