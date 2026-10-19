import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayer, usePlayerTime } from '../../context/PlayerContext';
import { Capacitor } from '@capacitor/core';
import { currentLandscape, setImmersive, setOrientation } from '../../platform/screenOrientation';
import { EQ_RANGE_DB, useSongEq } from './useSongEq';
import { readCarLayout, readKeepAwake, writeCarLayout, writeKeepAwake, type CarLayout } from '../../utils/carModePrefs';
import { acquireKeepAwake } from '../../platform/keepAwake';
import AlbumArt from '../common/AlbumArt';
import FlowingBackdrop from '../common/FlowingBackdrop';
import './CarMode.css';

interface CarModeProps { onClose: () => void; startInTeku?: boolean; }

const BAR_COUNT = 24;
const MIN_HZ = 40;
const MAX_HZ = 16000;
const BAR_SCALE = 0.8; // bars never use the full panel height

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

/** Centre frequency of a log-spaced band, as a short label (every 4th bar is labelled). */
const BAND_LABELS = Array.from({ length: BAR_COUNT }, (_, i) => {
  if (i % 4 !== 0) return '';
  const hz = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 0.5) / BAR_COUNT);
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
});

type CapturableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type BatteryManagerLike = EventTarget & { level: number; charging: boolean };

/** Battery level via the Battery Status API; null where the WebView lacks it. */
function useBattery(): { level: number; charging: boolean } | null {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return;
    let manager: BatteryManagerLike | null = null;
    let cancelled = false;
    const update = () => {
      if (manager) setBattery({ level: Math.round(manager.level * 100), charging: manager.charging });
    };
    nav.getBattery().then(m => {
      if (cancelled) return;
      manager = m;
      update();
      m.addEventListener('levelchange', update);
      m.addEventListener('chargingchange', update);
    }).catch(() => {});
    return () => {
      cancelled = true;
      manager?.removeEventListener('levelchange', update);
      manager?.removeEventListener('chargingchange', update);
    };
  }, []);
  return battery;
}

/**
 * Drives the Pulse Deck bars. Reads the shared audio element through
 * captureStream() so the element's own output path is never touched (unlike
 * createMediaElementSource, which permanently reroutes it). When no real
 * spectrum is available (no captureStream, cross-origin silence, suspended
 * context) the bars fall back to a local animation while playing.
 */
function usePulseDeckBars(
  active: boolean,
  isPlaying: boolean,
  getAudioElement: () => HTMLAudioElement | null,
  fillRefs: React.MutableRefObject<(HTMLSpanElement | null)[]>,
  capRefs: React.MutableRefObject<(HTMLSpanElement | null)[]>,
  beatRef: React.RefObject<HTMLElement | null>,
  onSlow: () => void,
): void {
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  const onSlowRef = useRef(onSlow);
  onSlowRef.current = onSlow;
  // Lets a play/pause change restart the draw loop after it has parked itself.
  const wakeRef = useRef<(() => void) | null>(null);
  useEffect(() => { wakeRef.current?.(); }, [isPlaying]);

  useEffect(() => {
    if (!active) return;
    const audio = getAudioElement() as CapturableAudio | null;
    const capture = audio?.captureStream ?? audio?.mozCaptureStream;
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array | null = null;
    const sources: MediaStreamAudioSourceNode[] = [];
    const streams: MediaStream[] = [];
    let attachedSrc = '';

    // One context + analyser for the whole session. A feed made with a *fresh*
    // captureStream() delivers reliably, but one made earlier can go silent when
    // the element moves on to another song, so the draw loop swaps in a fresh
    // feed whenever the current one is quiet while playing. Replaced streams are
    // kept (not stopped) until teardown or until more than a few pile up.
    const connect = (): boolean => {
      if (!audio || !capture || !AudioContextCtor) return false;
      try {
        const stream = capture.call(audio);
        const track = stream.getAudioTracks()[0];
        if (!track) return false; // tracks appear once media is loaded; the loop retries
        if (!context) {
          context = new AudioContextCtor();
          analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.35;
          analyser.minDecibels = -78; // default -100..-30 squashes music into the top of the range
          analyser.maxDecibels = -22;
          data = new Uint8Array(analyser.frequencyBinCount);
        }
        const node = context.createMediaStreamSource(new MediaStream([track]));
        node.connect(analyser as AnalyserNode); // deliberately not connected to destination
        sources.splice(0).forEach(old => old.disconnect());
        sources.push(node);
        streams.push(stream);
        while (streams.length > 6) streams.shift()?.getTracks().forEach(t => t.stop?.());
        attachedSrc = audio.currentSrc;
        context.resume().catch(() => {});
        return true;
      } catch {
        // WebView refuses capture: the bars fall back to the local animation.
        return false;
      }
    };

    const edges: number[] = [];
    const level = new Float32Array(BAR_COUNT);
    const peak = new Float32Array(BAR_COUNT);
    const raw = new Float32Array(BAR_COUNT);
    let beat = 0;
    let frame = 0;
    let lastRetry = 0;
    let silentSince = 0;
    // Frame-rate guard: while audio is really playing, a device that cannot hold ~30 fps
    // (software rendering, a weak GPU) gets the visualizer switched off for good measure.
    let lastFrameTs = 0;
    let warmup = 45;
    let deltaSum = 0;
    let deltaCount = 0;
    let slowStrikes = 0;
    let retriedSrc = '';
    let retries = 0;
    const draw = (now: number) => {
      // The element hands out an empty capture while a song is still loading, so
      // keep trying (no cap) until the current song has a feed.
      if (audio && now - lastRetry > 400 && audio.currentSrc && audio.currentSrc !== attachedSrc && audio.readyState >= 2) {
        lastRetry = now;
        connect();
      }
      // Loading a song is not playing it: bars rest until audio is really flowing.
      const audible = !!audio && !audio.paused && audio.readyState >= 3 && playingRef.current;
      if (audible) {
        const delta = lastFrameTs ? now - lastFrameTs : 0;
        lastFrameTs = now;
        if (delta > 0 && delta < 400) {
          if (warmup > 0) warmup -= 1;
          else {
            deltaSum += delta; deltaCount += 1;
            if (deltaCount >= 90) {
              slowStrikes = deltaSum / deltaCount > 34 ? slowStrikes + 1 : 0;
              deltaSum = 0; deltaCount = 0;
              if (slowStrikes >= 2) { onSlowRef.current(); return; }
            }
          }
        }
      } else {
        lastFrameTs = 0;
      }
      const live = !!(analyser && data && context?.state === 'running' && audible && sources.length);
      let energy = 0;
      if (live && analyser && data && context) {
        if (!edges.length) {
          const hzPerBin = context.sampleRate / analyser.fftSize;
          for (let i = 0; i <= BAR_COUNT; i += 1) {
            edges.push(Math.min(data.length, Math.max(i + 1, Math.round(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / BAR_COUNT) / hzPerBin))));
          }
        }
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < BAR_COUNT; i += 1) {
          const start = edges[i];
          const end = Math.max(start + 1, edges[i + 1]);
          let top = 0;
          for (let j = start; j < end && j < data.length; j += 1) top = Math.max(top, data[j]);
          // Gentle tilt so the (naturally quieter) highs stay visible, then a
          // power curve so quiet bands drop low and the loud ones stand out.
          raw[i] = Math.min(1, Math.pow((top / 255) * (0.85 + 0.6 * (i / BAR_COUNT)), 1.7));
          energy += raw[i];
        }
      }
      // Real silence (a quiet intro, a gap) just lowers the bars. Only a stream
      // that stays *exactly* silent for a few seconds while playing (a CORS-tainted
      // source) switches to the local animation, and real data wins back instantly.
      if (live && energy > 0.02) silentSince = 0;
      else if (live && !silentSince) silentSince = now;
      else if (!live) silentSince = 0;
      // Quiet while playing: swap in a fresh capture feed (up to 5 tries per song).
      if (audio && audio.currentSrc !== retriedSrc) { retriedSrc = audio.currentSrc; retries = 0; silentSince = 0; }
      if (live && silentSince && attachedSrc === audio?.currentSrc && now - silentSince > 900 * (retries + 1) && retries < 4) {
        retries += 1;
        connect();
      }
      const useReal = live && (energy > 0.02 || now - silentSince < 4500);
      for (let i = 0; i < BAR_COUNT; i += 1) {
        let target: number;
        if (useReal) target = raw[i];
        else target = audible ? 0.42 + 0.34 * Math.sin(now / 150 + i * 0.7) + 0.2 * Math.sin(now / 70 + i * 1.9) : 0.05;
        // Snap up fast, fall back slower: the punchy bounce of the Teku-style spectrum.
        level[i] += (target - level[i]) * (target > level[i] ? (useReal ? 0.75 : 0.5) : (useReal ? 0.16 : 0.14));
      }
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const value = Math.min(1, Math.max(0.03, level[i]));
        peak[i] = value >= peak[i] ? value : Math.max(value, peak[i] - 0.012);
        const fill = fillRefs.current[i];
        if (fill) fill.style.transform = `scaleY(${(value * BAR_SCALE).toFixed(3)})`;
        const cap = capRefs.current[i];
        if (cap) cap.style.bottom = `${(peak[i] * BAR_SCALE * 100).toFixed(1)}%`;
      }
      // Bass energy drives a beat pulse in the backdrop glow and bar halos.
      let bass = 0;
      for (let i = 0; i < 5; i += 1) bass += level[i];
      bass /= 5;
      beat += (bass - beat) * (bass > beat ? 0.6 : 0.1);
      beatRef.current?.style.setProperty('--beat', beat.toFixed(3));
      // Nothing playing and everything has settled to rest: stop drawing until woken.
      let moving = beat > 0.004;
      for (let i = 0; i < BAR_COUNT && !moving; i += 1) moving = Math.abs(level[i] - 0.05) > 0.004 || peak[i] > 0.06;
      if (!playingRef.current && !audible && !moving) { frame = 0; return; }
      frame = requestAnimationFrame(draw);
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(draw); };
    wakeRef.current = start;
    frame = requestAnimationFrame(draw);

    return () => {
      wakeRef.current = null;
      cancelAnimationFrame(frame);
      sources.forEach(node => node.disconnect());
      analyser?.disconnect();
      streams.forEach(stream => stream.getTracks().forEach(track => track.stop?.()));
      context?.close().catch(() => {});
    };
  }, [active, getAudioElement, fillRefs, capRefs, beatRef]);
}

/** True while the viewport is taller than wide. */
function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return portrait;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const CarMode: React.FC<CarModeProps> = ({ onClose, startInTeku = false }) => {
  const {
    currentSong, isPlaying, isLoading, isLiked, shuffle, repeat,
    togglePlayPause, playNext, playPrevious, toggleShuffle, toggleRepeat, toggleLike, seek, getAudioElement, volume, muted,
  } = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const [flipped, setFlipped] = useState(false);
  const [autoDisabled, setAutoDisabled] = useState(() => {
    try { return localStorage.getItem('xylonic_pulse_deck_auto_disabled') === 'true'; } catch { return false; }
  });
  const [pulseDeck, setPulseDeck] = useState(startInTeku && !autoDisabled);
  const [slowNotice, setSlowNotice] = useState(false);
  const smallScreen = useMediaQuery('(max-height: 420px)');
  const [layoutPref, setLayoutPref] = useState<CarLayout>(readCarLayout);
  const minimal = layoutPref === 'minimal' || (layoutPref === 'auto' && smallScreen);
  // The in-mode switch pins a layout (and remembers it); Settings can put it back on Auto.
  const toggleLayout = () => {
    const next: CarLayout = minimal ? 'full' : 'minimal';
    setLayoutPref(next);
    writeCarLayout(next);
  };
  const [nativeLandscape, setNativeLandscape] = useState(false);
  const [eqNotice, setEqNotice] = useState(false);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const capRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const deckRef = useRef<HTMLElement | null>(null);
  const eqPointersRef = useRef(new Map<number, 'bass' | 'treble' | 'both'>());
  const battery = useBattery();
  const portrait = usePortrait();
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const { eq, status: eqStatus, setBand, revert: revertEq } = useSongEq(getAudioElement, currentSong?.id, isPlaying, volume, muted);
  const eqFlat = eq.bass === 0 && eq.treble === 0;

  const handleSlow = useCallback(() => {
    setPulseDeck(false);
    setAutoDisabled(true);
    setSlowNotice(true);
    try { localStorage.setItem('xylonic_pulse_deck_auto_disabled', 'true'); } catch { /* storage unavailable */ }
  }, []);
  usePulseDeckBars(pulseDeck, isPlaying, getAudioElement, barRefs, capRefs, deckRef, handleSlow);
  useEffect(() => {
    if (!slowNotice) return;
    const timer = window.setTimeout(() => setSlowNotice(false), 5000);
    return () => window.clearTimeout(timer);
  }, [slowNotice]);
  // Tapping the icon again is an explicit retry, so it clears the automatic switch-off.
  const togglePulseDeck = () => {
    if (!pulseDeck && autoDisabled) {
      setAutoDisabled(false);
      try { localStorage.removeItem('xylonic_pulse_deck_auto_disabled'); } catch { /* storage unavailable */ }
    }
    setSlowNotice(false);
    setPulseDeck(v => !v);
  };

  // Optional: keep the screen on (no sleep or auto-lock) while Car Mode is open.
  const [keepAwake, setKeepAwake] = useState(readKeepAwake);
  useEffect(() => {
    if (!keepAwake) return;
    let release: (() => void) | null = null;
    let cancelled = false;
    acquireKeepAwake().then(fn => { if (cancelled) fn(); else release = fn; });
    return () => { cancelled = true; release?.(); };
  }, [keepAwake]);
  const toggleKeepAwake = () => {
    const next = !keepAwake;
    setKeepAwake(next);
    writeKeepAwake(next);
  };

  // Car Mode is a full-screen display: hide Android's status/navigation bars while it is open.
  useEffect(() => {
    void setImmersive(true);
    return () => { void setImmersive(false); };
  }, []);

  // EQ only works on downloaded/cached tracks; tell the user, then drop the pending change.
  useEffect(() => {
    if (eqStatus !== 'unsupported') return;
    setEqNotice(true);
    const timer = window.setTimeout(() => { setEqNotice(false); revertEq(); }, 2600);
    return () => window.clearTimeout(timer);
  }, [eqStatus, revertEq]);

  // Car Mode is widescreen-only: request landscape (sensor-driven, so the
  // accelerometer picks the side) and hand control back on exit. Where the
  // platform cannot lock, the CSS fallback below rotates the layout instead.
  useEffect(() => {
    let alive = true;
    setOrientation('landscape').then(ok => { if (alive) setNativeLandscape(ok); });
    return () => { alive = false; void setOrientation('default'); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Flip: with a native lock, pin the opposite landscape (a second press hands
  // control back to the accelerometer); otherwise rotate the layout 180°.
  const handleFlip = useCallback(() => {
    const next = !flipped;
    setFlipped(next);
    if (!nativeLandscape) return;
    const current = currentLandscape();
    const opposite = current === 'landscape-secondary' ? 'landscape-primary' : 'landscape-secondary';
    void setOrientation(next ? opposite : 'landscape');
  }, [flipped, nativeLandscape]);

  // Dragging the spectrum shapes the EQ. Each finger owns a zone fixed where it
  // lands: left third = bass, right third = treble, middle = both together, so
  // two fingers can work bass and treble at once and one finger in the middle
  // lifts everything. Vertical position = gain (centre is flat).
  const applyEqPointer = (event: React.PointerEvent<HTMLDivElement>, zone: 'bass' | 'treble' | 'both') => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) return;
    const y = (event.clientY - rect.top) / rect.height;
    let db = (0.5 - Math.min(1, Math.max(0, y))) * 2 * EQ_RANGE_DB;
    if (Math.abs(db) < 0.75) db = 0;
    if (zone !== 'treble') setBand('bass', db);
    if (zone !== 'bass') setBand('treble', db);
  };
  const onEqDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    const zone = x < 0.35 ? 'bass' : x > 0.65 ? 'treble' : 'both';
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    eqPointersRef.current.set(event.pointerId, zone);
    applyEqPointer(event, zone);
  };
  const onEqMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const zone = eqPointersRef.current.get(event.pointerId);
    if (zone) applyEqPointer(event, zone);
  };
  const onEqEnd = (event: React.PointerEvent<HTMLDivElement>) => { eqPointersRef.current.delete(event.pointerId); };

  const eqCurve = Array.from({ length: BAR_COUNT }, (_, i) => {
    const low = 1 / (1 + Math.exp((i - 6) / 1.5));
    const high = 1 / (1 + Math.exp((17 - i) / 1.5));
    const gain = eq.bass * low + eq.treble * high;
    return `${(((i + 0.5) / BAR_COUNT) * 100).toFixed(2)},${(50 - (gain / EQ_RANGE_DB) * 46).toFixed(2)}`;
  }).join(' ');
  const formatDb = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db)} dB`;

  // Rotating the layout is only for phones that cannot be locked (iOS); a tall desktop window just reflows.
  const forceLandscape = !nativeLandscape && portrait && Capacitor.isNativePlatform();
  const rootClass = `car-mode${flipped && !nativeLandscape ? ' is-flipped' : ''}${pulseDeck ? ' is-pulse-deck' : ''}${forceLandscape ? ' force-landscape' : ''}`;

  const shuffleButton = (
    <button className={`npo-ctrl secondary${shuffle ? ' active' : ''}`} onClick={toggleShuffle} aria-label="Shuffle">
      <i className="fas fa-random" />
    </button>
  );
  const repeatButton = (
    <button className={`npo-ctrl secondary${repeat !== 'off' ? ' active' : ''}`} onClick={toggleRepeat} aria-label={`Repeat: ${repeat}`}>
      <i className="fas fa-redo" />
      {repeat === 'one' && <span className="npo-repeat-badge">1</span>}
    </button>
  );
  const likeButton = (
    <button className={`npo-ctrl secondary${isLiked ? ' active' : ''}`} onClick={toggleLike} disabled={!currentSong} aria-label={isLiked ? 'Unlike' : 'Like'}>
      <i className={`fa${isLiked ? 's' : 'r'} fa-heart`} />
    </button>
  );

  // Pulse Deck keeps the full Now Playing row (shuffle · prev · play · next · repeat);
  // the plain player shows shuffle/like/repeat on their own row below instead.
  const transport = (withModes: boolean) => (
    <div className="car-transport">
      {withModes && shuffleButton}
      <button className="npo-ctrl" onClick={playPrevious} aria-label="Previous">
        <i className="fas fa-step-backward" />
      </button>
      <button className="npo-ctrl primary" onClick={togglePlayPause} disabled={!currentSong} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isLoading ? <span className="npo-spinner" /> : <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />}
      </button>
      <button className="npo-ctrl" onClick={playNext} aria-label="Next">
        <i className="fas fa-step-forward" />
      </button>
      {withModes && repeatButton}
    </div>
  );

  const progressBar = (
    <footer className="car-progress">
      <span className="car-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={duration || 1}
        step="0.1"
        value={Math.min(currentTime, duration || 1)}
        onChange={event => seek(Number(event.target.value))}
        style={{ '--progress': `${progress}%` } as React.CSSProperties}
        aria-label="Song progress"
      />
      <span className="car-time">{formatTime(duration)}</span>
    </footer>
  );

  const playButton = (
    <button className="npo-ctrl primary" onClick={togglePlayPause} disabled={!currentSong} aria-label={isPlaying ? 'Pause' : 'Play'}>
      {isLoading ? <span className="npo-spinner" /> : <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />}
    </button>
  );
  // Minimal layout: the four main controls in a fixed order (previous/next flank the seek bar).
  const miniControls = (
    <div className="cm-controls">
      {shuffleButton}
      {playButton}
      {repeatButton}
      {likeButton}
    </div>
  );
  const seekRow = (
    <div className="cm-seek-row">
      <button className="npo-ctrl" onClick={playPrevious} aria-label="Previous"><i className="fas fa-step-backward" /></button>
      <span className="car-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={duration || 1}
        step="0.1"
        value={Math.min(currentTime, duration || 1)}
        onChange={event => seek(Number(event.target.value))}
        style={{ '--progress': `${progress}%` } as React.CSSProperties}
        aria-label="Song progress"
      />
      <span className="car-time">{formatTime(duration)}</span>
      <button className="npo-ctrl" onClick={playNext} aria-label="Next"><i className="fas fa-step-forward" /></button>
    </div>
  );
  const eqIcon = (
    <svg className="car-eq-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="12" width="3.5" height="9" rx="1.75" />
      <rect x="8.5" y="5" width="3.5" height="16" rx="1.75" />
      <rect x="14" y="9" width="3.5" height="12" rx="1.75" />
      <rect x="19.5" y="14" width="3" height="7" rx="1.5" />
    </svg>
  );
  const chromeButtons = (
    <>
      {pulseDeck && !eqFlat && (
        <button className="car-eq-reset" onClick={revertEq} aria-label="Reset EQ">
          <i className="fas fa-undo" /><span>Reset EQ</span>
        </button>
      )}
      <button className="car-icon-btn" onClick={handleFlip} aria-label="Flip display" aria-pressed={flipped}>
        <i className="fas fa-sync" />
      </button>
      <button className={`car-icon-btn${minimal ? ' active' : ''}`} onClick={toggleLayout} aria-label={minimal ? 'Show full layout' : 'Show minimal layout'} aria-pressed={minimal}>
        <i className={`fas fa-${minimal ? 'expand' : 'compress'}`} />
      </button>
      <button className={`car-icon-btn${keepAwake ? ' active' : ''}`} onClick={toggleKeepAwake} aria-label={keepAwake ? 'Let the screen sleep' : 'Keep the screen on'} aria-pressed={keepAwake}>
        <i className="fas fa-lightbulb" />
      </button>
      <button className={`car-icon-btn${pulseDeck ? ' active' : ''}`} onClick={togglePulseDeck} aria-label="Pulse Deck visualization" aria-pressed={pulseDeck}>
        {eqIcon}
      </button>
      {battery && (
        <span className="car-battery" aria-label={`Battery ${battery.level}%${battery.charging ? ', charging' : ''}`}>
          {battery.charging && <i className="fas fa-bolt" />}{battery.level}%
        </span>
      )}
    </>
  );
  const closeButton = (
    <button className="car-icon-btn" onClick={onClose} aria-label="Exit Car Mode"><i className="fas fa-times" /></button>
  );
  const slowToast = slowNotice && (
    <div className="car-toast" role="status">Pulse Deck turned off — this device is too slow for it. Tap the bars icon to try again.</div>
  );
  const albumArt = currentSong?.coverArt
    ? <AlbumArt coverArtId={currentSong.coverArt} alt="Album art" hiRes />
    : <i className="fas fa-music" />;

  const pulseDeckMain = (
  <main className={`pulse-deck${isPlaying ? ' is-live' : ''}`} aria-label="Pulse Deck visualization" ref={deckRef}>
    <FlowingBackdrop coverArtId={currentSong?.coverArt} live={isPlaying} />
    {minimal && <div className="cm-chrome cm-chrome--bar">{closeButton}{chromeButtons}</div>}
    <div className="pd-stage">
      <div
        className="pd-spectrum"
        onPointerDown={onEqDown}
        onPointerMove={onEqMove}
        onPointerUp={onEqEnd}
        onPointerCancel={onEqEnd}
        role="group"
        aria-label="Drag to adjust bass (left), treble (right) or both (middle) for this song"
      >
        <div className="pd-bars">
          {BAND_LABELS.map((label, i) => (
            <div className="pd-bar" key={i}>
              <div className="pd-bar-track">
                <span className="pd-bar-fill" ref={el => { barRefs.current[i] = el; }} />
                <span className="pd-bar-cap" ref={el => { capRefs.current[i] = el; }} />
              </div>
              <span className="pd-bar-label">{label}</span>
            </div>
          ))}
        </div>
        <svg className="pd-eq-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="50" x2="100" y2="50" className="pd-eq-zero" />
          <polyline points={eqCurve} className={eqFlat ? 'pd-eq-line flat' : 'pd-eq-line'} />
        </svg>
        <span className="pd-eq-chip left">Bass {formatDb(eq.bass)}</span>
        <span className="pd-eq-chip right">Treble {formatDb(eq.treble)}</span>
        <span className="pd-eq-chip mid">Both</span>
        {eqNotice && <span className="pd-eq-notice">EQ works on downloaded tracks only</span>}
      </div>
    </div>
    <div className="pd-dock">
      {minimal ? miniControls : transport(true)}
      <div className="pd-track">
        {!minimal && likeButton}
        <div className="pd-track-text">
          <h1>{currentSong?.title || 'Nothing playing'}</h1>
          <h2>{currentSong?.artist || ''}</h2>
        </div>
        <div className="pd-track-art">
          {currentSong?.coverArt
            ? <AlbumArt coverArtId={currentSong.coverArt} alt="Album art" />
            : <i className="fas fa-music" />}
        </div>
      </div>
    </div>
  </main>
  );

  if (minimal) {
    return (
      <div className={`${rootClass} car-minimal`} role="dialog" aria-label="Car Mode">
        <div className="car-mode-frame">
          {seekRow}
          {pulseDeck ? (
            pulseDeckMain
          ) : (
            <main className="cm-main">
              <section className="cm-center">
                <div className="car-track-text">
                  <h1>{currentSong?.title || 'Nothing playing'}</h1>
                  <h2>{currentSong?.artist || ''}</h2>
                </div>
                {miniControls}
              </section>
              <div className="cm-chrome">{closeButton}{chromeButtons}</div>
            </main>
          )}
          {slowToast}
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass} role="dialog" aria-label="Car Mode">
      <div className="car-mode-frame">
        <header className="car-header">
          <button className="car-icon-btn" onClick={onClose} aria-label="Exit Car Mode"><i className="fas fa-times" /></button>
          <div className="car-header-actions">
            {pulseDeck && !eqFlat && (
              <button className="car-eq-reset" onClick={revertEq} aria-label="Reset EQ">
                <i className="fas fa-undo" /><span>Reset EQ</span>
              </button>
            )}
            <button className="car-icon-btn" onClick={handleFlip} aria-label="Flip display" aria-pressed={flipped}>
              <i className="fas fa-sync" />
            </button>
            <button className={`car-icon-btn${minimal ? ' active' : ''}`} onClick={toggleLayout} aria-label={minimal ? 'Show full layout' : 'Show minimal layout'} aria-pressed={minimal}>
              <i className={`fas fa-${minimal ? 'expand' : 'compress'}`} />
            </button>
            <button className={`car-icon-btn${keepAwake ? ' active' : ''}`} onClick={toggleKeepAwake} aria-label={keepAwake ? 'Let the screen sleep' : 'Keep the screen on'} aria-pressed={keepAwake}>
              <i className="fas fa-lightbulb" />
            </button>
            <button className={`car-icon-btn${pulseDeck ? ' active' : ''}`} onClick={() => setPulseDeck(v => !v)} aria-label="Pulse Deck visualization" aria-pressed={pulseDeck}>
              <svg className="car-eq-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="12" width="3.5" height="9" rx="1.75" />
                <rect x="8.5" y="5" width="3.5" height="16" rx="1.75" />
                <rect x="14" y="9" width="3.5" height="12" rx="1.75" />
                <rect x="19.5" y="14" width="3" height="7" rx="1.5" />
              </svg>
            </button>
            {battery && (
              <span className="car-battery" aria-label={`Battery ${battery.level}%${battery.charging ? ', charging' : ''}`}>
                {battery.charging && <i className="fas fa-bolt" />}{battery.level}%
              </span>
            )}
          </div>
        </header>

        {pulseDeck ? pulseDeckMain : (
          <main className="car-main">
            <section className="car-left">
              <div className="car-track-text">
                <h1>{currentSong?.title || 'Nothing playing'}</h1>
                <h2>{currentSong?.artist || ''}</h2>
              </div>
              {transport(false)}
              <div className="car-extra-controls">
                {shuffleButton}
                {likeButton}
                {repeatButton}
              </div>
            </section>
            <section className="car-art-frame">{albumArt}</section>
          </main>
        )}

        {progressBar}
        {slowToast}
      </div>
    </div>
  );
};

export default CarMode;
