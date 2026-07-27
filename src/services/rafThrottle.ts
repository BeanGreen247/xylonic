// Single shared RAF throttle — replaces window.requestAnimationFrame with a
// pure-setTimeout implementation so frame intervals are consistent across
// all three modes (normal / performance / power-saver).
//
// IMPORTANT: callbacks always fire asynchronously (never synchronously inside
// the requestAnimationFrame call) to match native RAF semantics.  Firing
// inline breaks caller deduplication patterns like:
//   rafId = requestAnimationFrame(() => { rafId = null; });
// where the inner assignment would run before the outer one.

const MAX_FPS = 60;

let _origRAF: typeof window.requestAnimationFrame | null = null;
let _origCAF: typeof window.cancelAnimationFrame   | null = null;

let _active     = false;
let _currentFps = MAX_FPS;
let _lastFrame  = 0;

// pending throttled id → underlying setTimeout id (negative-encoded so 0 is never valid)
let _pending: Map<number, number>;
let _counter: number;

function _fire(cb: FrameRequestCallback, id: number): void {
    _lastFrame = performance.now();
    _pending.delete(id);
    cb(_lastFrame);
}

function _schedule(cb: FrameRequestCallback, id: number): void {
    const frameMs = 1000 / _currentFps;
    const elapsed = performance.now() - _lastFrame;
    // Always fire via setTimeout so the callback is always async.
    // delay=0 fires on the very next task-queue opportunity (≥1 ms in practice).
    const delay = Math.max(0, frameMs - elapsed);
    const tid   = window.setTimeout(() => _fire(cb, id), delay) as unknown as number;
    _pending.set(id, -(tid + 1));
}

function _install(): void {
    if (_active) return;
    _active    = true;
    _lastFrame = performance.now();
    _pending   = new Map();
    _counter   = 1;
    _origRAF   = window.requestAnimationFrame.bind(window);
    _origCAF   = window.cancelAnimationFrame.bind(window);

    (window as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
        const id = _counter++;
        _schedule(cb, id);
        return id;
    };

    (window as any).cancelAnimationFrame = (id: number) => {
        const h = _pending.get(id);
        if (h === undefined) return;
        clearTimeout(-(h + 1));
        _pending.delete(id);
    };
}

/**
 * Install (or update) the throttle.  Hard ceiling: MAX_FPS (60).
 *
 * We do NOT cancel in-flight timeouts here.  Cancelling them would kill any
 * continuous RAF loop (e.g. the FPS counter) because its queued next-frame
 * timeout would be wiped and the loop would never reschedule itself.
 * Instead we just reset _lastFrame so that when the already-queued timeout
 * fires it immediately schedules the NEXT frame at the new rate.
 */
export function setThrottleFps(fps: number): void {
    _currentFps = Math.min(MAX_FPS, Math.max(1, fps));
    _lastFrame  = performance.now();
    _install();
}

export function getThrottleFps(): number    { return _currentFps; }
export function isThrottleActive(): boolean { return _active; }
