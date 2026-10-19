import { useCallback, useEffect, useRef, useState } from 'react';

export const EQ_RANGE_DB = 12;

export interface SongEq { bass: number; treble: number; }
export type EqStatus = 'flat' | 'active' | 'pending' | 'unsupported';

type CapturableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/** Same-origin, blob, data and file sources are never CORS-tainted, so a captured stream carries real audio. */
function isLocalSource(src: string): boolean {
  if (!src) return false;
  if (/^(blob|data|file):/i.test(src)) return true;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Per-song bass/treble EQ for cached/offline tracks.
 *
 * The shared audio element is never rerouted. While a non-flat EQ is engaged
 * the element's audio is captured with captureStream(), run through shelving
 * filters and played from a separate AudioContext, with the element muted.
 * Revert, song change, leaving the page or Car Mode closing tears the graph
 * down and unmutes the element, restoring its native output path.
 * Streamed (cross-origin) tracks are not eligible: their captured stream would
 * be silent.
 */
export function useSongEq(
  getAudioElement: () => HTMLAudioElement | null,
  songId: string | undefined,
  isPlaying: boolean,
  volume: number,
  muted: boolean,
) {
  const [eq, setEq] = useState<SongEq>({ bass: 0, treble: 0 });
  const [status, setStatus] = useState<EqStatus>('flat');
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const levelRef = useRef({ volume, muted });
  levelRef.current = { volume, muted };
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  const captureBreaksOnMuteRef = useRef(false);

  const graphRef = useRef<{
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    bass: BiquadFilterNode;
    treble: BiquadFilterNode;
    output: GainNode;
    probe: AnalyserNode;
    stream: MediaStream;
    audio: HTMLAudioElement;
    timer: number;
  } | null>(null);

  const teardown = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graphRef.current = null;
    window.clearInterval(graph.timer);
    graph.source.disconnect();
    graph.output.disconnect();
    graph.stream.getTracks().forEach(track => track.stop?.());
    graph.context.close().catch(() => {});
    // Hand the element back exactly as the player context expects it.
    graph.audio.muted = levelRef.current.muted;
  }, []);

  const energy = (probe: AnalyserNode): number => {
    const data = new Uint8Array(probe.frequencyBinCount);
    probe.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i];
    return sum / data.length;
  };

  // (Re)build or retune the graph whenever the requested EQ or playback state changes.
  useEffect(() => {
    const flat = eq.bass === 0 && eq.treble === 0;
    const graph = graphRef.current;
    if (flat) { teardown(); setStatus('flat'); return; }
    if (graph) {
      graph.bass.gain.value = eq.bass;
      graph.treble.gain.value = eq.treble;
      setStatus('active');
      return;
    }
    if (!isPlaying) { setStatus('pending'); return; }

    const audio = getAudioElement() as CapturableAudio | null;
    const capture = audio?.captureStream ?? audio?.mozCaptureStream;
    const Ctor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audio || !capture || !Ctor || captureBreaksOnMuteRef.current || !isLocalSource(audio.currentSrc)) {
      setStatus('unsupported');
      return;
    }

    let cancelled = false;
    let probeTimer = 0;
    const abort = () => { setStatus('unsupported'); };
    try {
      const stream = capture.call(audio);
      const context = new Ctor();
      const source = context.createMediaStreamSource(stream);
      const bass = context.createBiquadFilter();
      bass.type = 'lowshelf'; bass.frequency.value = 160; bass.gain.value = eqRef.current.bass;
      const treble = context.createBiquadFilter();
      treble.type = 'highshelf'; treble.frequency.value = 5000; treble.gain.value = eqRef.current.treble;
      const output = context.createGain();
      const probe = context.createAnalyser();
      probe.fftSize = 256;
      source.connect(bass); bass.connect(treble); treble.connect(output);
      source.connect(probe);
      context.resume().catch(() => {});

      // Phase 1: confirm the captured stream carries sound while the element is still audible.
      let waited = 0;
      probeTimer = window.setInterval(() => {
        waited += 150;
        if (cancelled) return;
        if (energy(probe) > 1) {
          window.clearInterval(probeTimer);
          // Phase 2: take over output, then confirm the capture survives muting the element.
          output.connect(context.destination);
          audio.muted = true;
          const timer = window.setInterval(() => {
            if (!audio.muted) audio.muted = true; // the player context re-applies mute state on track loads
            output.gain.value = levelRef.current.muted ? 0 : levelRef.current.volume;
          }, 200);
          graphRef.current = { context, source, bass, treble, output, probe, stream, audio, timer };
          window.setTimeout(() => {
            if (graphRef.current && energy(probe) <= 1 && playingRef.current) {
              captureBreaksOnMuteRef.current = true;
              teardown();
              abort();
            }
          }, 900);
          setStatus('active');
        } else if (waited >= 3000) {
          window.clearInterval(probeTimer);
          source.disconnect(); output.disconnect();
          stream.getTracks().forEach(track => track.stop?.());
          context.close().catch(() => {});
          abort();
        }
      }, 150);
    } catch {
      abort();
    }
    return () => { cancelled = true; window.clearInterval(probeTimer); };
  }, [eq, isPlaying, getAudioElement, teardown]);

  // New song → flat EQ ("just for this song").
  useEffect(() => { teardown(); setEq({ bass: 0, treble: 0 }); }, [songId, teardown]);

  // Never leave the element muted behind a suspended background context.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) teardown(); else setEq(prev => ({ ...prev })); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); teardown(); };
  }, [teardown]);

  const setBand = useCallback((band: keyof SongEq, db: number) => {
    const value = Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, Math.round(db * 2) / 2));
    setEq(prev => (prev[band] === value ? prev : { ...prev, [band]: value }));
  }, []);
  const revert = useCallback(() => { setEq({ bass: 0, treble: 0 }); }, []);

  return { eq, status, setBand, revert };
}
