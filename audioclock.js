// audioclock.js — the audible clock of the live AudioContext (pure: no DOM; main.js passes the context, performance.now()
// and the transport anchors). The playhead, recording (curTick of an event's timeStamp) and Serum's clip recorder
// (host.latency) all read the song position that is *heard* at a performance.now() time from here.
//
// getOutputTimestamp(): Chromium / Firefox stamp it at the speaker (frames − device delay: audio_destination.cc), so
// contextTime is already the heard time. WebKit (Safari, every iPad browser, the Home-Screen app) stamps it where the
// frame is rendered (AudioDestinationResampler / RemoteAudioDestinationProxy: sampleTime at render, nothing subtracted):
// the hardware / Bluetooth latency (outputLatency, iPadOS 18.4+, 0 before), the IO buffer and the GPU-process ring are
// still ahead of it. And every render stall on WebKit stays as latency for the context's life: the missed frames are
// rendered late (currentTime catches up) but the GPU side never skips them (RemoteAudioDestinationManager does not
// advance its read position on an underrun), so the ring lead grows to the largest stall seen. The stall meter below
// measures those catch-ups from the main thread.
//   delay = WebKit: outputLatency (smoothed) + RING + stalls (+ baseLatency when unstamped) ; other: 0 stamped, else
//           outputLatency + baseLatency (the Phase-1 fallback) — both + the graph's own delay after the engine (C.pipe, s: the
//           safety limiter's look-ahead, main.js) + the user's "Output latency" offset (settings.lat)

export const RING = 256;        // frames: WebKit's IO buffer + GPU-process ring lead — a guess (not measurable from JS)
export const STAMP_CAP = 100;   // ms a timestamp is extrapolated at most (a stale stamp: suspended, interrupted, GPU process gone)
export const DRIFT = 0.06;      // s of stall growth in a session that asks for a resync (main.js notice)
const DECAY = 1e-3;             // s/s the meter's recent lag maximum sinks (above any clock drift, far below a stall's 1 s/s)
const WIN = 0.25, WARM = 5;     // s per jitter window; windows seen before a stall is counted

export function createClock(webkit, user = 0) { return resetClock({ webkit: !!webkit, user: +user || 0 }); }
// a new context: no stalls, no smoothed latency yet, no graph delay (the host sets C.pipe once its output stage is built)
export function resetClock(C) {
  C.outLat = 0; C.outLatT = -Infinity; C.stall = 0; C.stall0 = 0; C.warnAt = DRIFT; C.settled = false; C.pipe = 0;
  C.M = { pw: null, top: 0, ws: 0, hi: 0, lo: 0, wn: 0, rs: [], J: -1, cand: 0 };
  return C;
}
// the session baseline once the engine is up (a power-on's own stalls are compensated, never reported as drift)
export function settle(C) { C.stall0 = C.stall; C.warnAt = C.stall + DRIFT; C.settled = true; }
// the stall growth since settle() passed DRIFT (WebKit only); arms the next notice DRIFT further on
export function driftDue(C) {
  if (!C.webkit || !C.settled || C.stall < C.warnAt) return false;
  C.warnAt = C.stall + DRIFT;
  return true;
}

// [context time at performance time ts, stamped]: from getOutputTimestamp (capped extrapolation; a stamp more than 1 s
// off currentTime — a GPU-process reconnect restarts WebKit's frame count — is ignored), else from currentTime
export function renderTime(ctx, ts, now) {
  const back = ctx.currentTime - (now - ts) / 1000;
  const o = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  if (o && o.performanceTime > 0 && o.contextTime > 0) {
    const t = o.contextTime + Math.min(ts - o.performanceTime, STAMP_CAP) / 1000;
    if (Math.abs(t - back) < 1) return [t, true];
  }
  return [back, false];
}
// s between the rendered time renderTime gives and the heard one (+ the user offset)
export function outDelay(C, ctx, stamped, now) {
  const base = +ctx.baseLatency || 0;
  let auto;
  if (!C.webkit) auto = stamped ? 0 : (+ctx.outputLatency || 0) + base;
  else {
    // outputLatency jitters (AirPods) and reads 0 while the context is not running: a slow average of running reads
    if (ctx.state === 'running' && now - C.outLatT >= 250) {
      C.outLatT = now;
      const v = +ctx.outputLatency || 0;
      C.outLat += C.outLat ? 0.2 * (v - C.outLat) : v;
    }
    auto = C.outLat + RING / ctx.sampleRate + C.stall + (stamped ? 0 : base);
  }
  return auto + C.pipe + C.user / 1000;
}
// the frame heard at performance time ts
export function outFrame(C, ctx, ts, now) {
  const [t, s] = renderTime(ctx, ts, now);
  return (t - outDelay(C, ctx, s, now)) * ctx.sampleRate;
}

// song position of an anchor {frame, tick, fpt, wrap, ls, le} at frame F (extrapolated either way)
export function tickAt(F, a) {
  let t = a.tick + (F - a.frame) / a.fpt;
  if (a.wrap && t >= a.le) t = a.ls + (t - a.le) % (a.le - a.ls);
  return t;
}
// the tick heard at frame F on the anchors still sounding, oldest first (the play() start, then each seek / tempo / loop
// change while playing): the latest one heard by F, on its line — a burst of re-anchors (a loop drag, a held BPM
// spinner) is followed exactly, a seek's target shows once it is heard; before the first, its own tick (a start: nothing
// heard yet — never ticks before it)
export function heardTick(F, as) {
  for (let i = as.length - 1; i >= 0; i--) if (F >= as[i].frame) return tickAt(F, as[i]);
  return as[0].tick;
}

// One sample of the stall meter (wall = performance.now()/1000, ctxT = currentTime). lag = wall − ctxT: steady it is a
// sawtooth (currentTime moves in IO-buffer steps) J high — the median of the lag's range over the last WIN-long windows
// (a window with a stall in it is an outlier); a stall lifts it at 1 s/s and the catch-up drops it back. Only the drop
// from the recent top counts — a suspension, an interruption or a slow start lifts it for good (no catch-up, no latency
// added) — less 1.5 J + 3 ms; drops before J is known are kept (cand) and counted once it is. A stall's end falls between
// two samples: it is under-read by up to one sampling interval. Not running: the next sample starts afresh. Returns
// true when C.stall grew.
export function meterSample(C, wall, ctxT, running) {
  const M = C.M;
  if (!running) { M.pw = null; return false; }
  const lag = wall - ctxT;
  if (M.pw == null) { M.pw = M.ws = wall; M.top = M.hi = M.lo = lag; M.wn = 1; return false; }
  const top = M.top - Math.max(0, wall - M.pw) * DECAY, drop = top - lag;
  M.pw = wall; M.top = Math.max(top, lag);
  if (wall - M.ws >= WIN) {
    if (M.wn >= 3) { M.rs.push(M.hi - M.lo); if (M.rs.length > 9) M.rs.shift(); }
    M.ws = wall; M.hi = M.lo = lag; M.wn = 1;
    if (M.rs.length >= WARM) { const r = M.rs.slice().sort((a, b) => a - b); M.J = r[r.length >> 1]; }
  } else { if (lag > M.hi) M.hi = lag; if (lag < M.lo) M.lo = lag; M.wn++; }
  if (M.J < 0) { if (drop > M.cand) M.cand = drop; return false; }
  const s = Math.max(drop, M.cand) - (1.5 * M.J + 0.003);
  M.cand = 0;
  if (s <= C.stall) return false;
  C.stall = s;
  return true;
}

// the readout (s): engine, outputLatency (null: not reported), baseLatency, ring estimate (WebKit), stalls, the graph's delay, render →
// stamp (currentTime − contextTime), the automatic delay, the user offset, the total, the meter's currentTime step
// jitter J (≈ the IO buffer when that is longer than the sampling interval; null: not measured yet)
export function clockInfo(C, ctx, now) {
  const o = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  const stamped = renderTime(ctx, now, now)[1], total = outDelay(C, ctx, stamped, now);
  return {
    webkit: C.webkit, out: typeof ctx.outputLatency === 'number' ? ctx.outputLatency : null, base: +ctx.baseLatency || 0,
    ring: C.webkit ? RING / ctx.sampleRate : 0, stall: C.stall, pipe: C.pipe, stamp: o && o.contextTime > 0 ? ctx.currentTime - o.contextTime : null,
    stamped, auto: total - C.user / 1000, user: C.user / 1000, total, io: C.M.J >= 0 ? C.M.J : null,
  };
}
