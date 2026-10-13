/*
 * smprender.js — the render farm (owner S1; SPEC-serum2 §10.1, §0.3, §0.4). A classic Worker (no imports/exports): it
 * hosts this project's own engines outside any AudioContext to render factory content (multisample zones, phrases,
 * loops) deterministically, exactly as a bounce would.
 *
 * Scope set-up (first request): the AudioWorklet globals are defined as stubs — `sampleRate` = 48000, `currentFrame`,
 * `AudioWorkletProcessor` (with a fake port), `registerProcessor` (captures the engine's processor class) — then the
 * 11 DSP scripts of §0.3 are imported in table order (a failing one is logged and its feature degrades, §0.3), then
 * engine.js. Script URLs carry this worker's own `?v=` query (assets.js creates it as `smprender.js?v=N`).
 * `Math.random` is replaced by mulberry32(fnv1a32(<render id>)) (engine.js Solina `Divide` is its one consumer, §0.4),
 * reseeded before the processor is built and again before its first event (the golden harness order, §15.1).
 *
 * Request {q, id, patch, wts, smps, events: [[frame, on, n, vel127]], frames, os = 2} → one fresh
 * SynthProcessor({processorOptions: {os, offline: true, patch, wts, smps}}) renders the whole event list in 128-frame
 * quanta for `frames` frames (capped at 60 s), or until the output stays below −80 dBFS for 2048 frames after the last
 * note-off (the last event when there is none) → reply {q, ok: true, L, R} (Float32Arrays, transferred; length = the
 * frames rendered); failure → {q, ok: false, err}.
 * IMPL details fixed here: a quantum is rendered in spans split at its events (process() on sub-spans, the engine's
 * 4-frame granularity as its own song / sequencer events in a bounce): an event is delivered before the span that
 * starts at its frame rounded up to a multiple of 4 (≤ 3 frames late, not up to a quantum, so loop hits sit on their
 * step grid); velocity v = vel127/127; note-offs carry no release velocity; the
 * wavetable / asset entries of a request are dropped from the scope's shared stores after the render, so every
 * request is self-contained. `self.__smprender` exposes {DSP, render(req), ready()} for the node tests.
 */
(function () {
  'use strict';
  const G = typeof self !== 'undefined' ? self : globalThis;
  // §0.3 scripts 1–11 in table order (= main.js DSP_FILES; engine.js is loaded last)
  const DSP = ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js', 'sx-seq.js',
    'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js'];
  const SR = 48000, Q = 128, MAX_FRAMES = 60 * SR, THR = Math.pow(10, -80 / 20), HOLD = 2048;

  // wt.js fnv1a32 / mulberry32 (identical code; compared by tests/smpgen.test.mjs)
  function fnv1a32(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let rnd = mulberry32(1), Proc = null, loaded = false, loadErr = null;
  const seed = id => { rnd = mulberry32(fnv1a32(String(id))); };

  function load() {
    if (loaded) { if (loadErr) throw loadErr; return; }
    loaded = true;
    G.sampleRate = SR;
    G.currentFrame = 0;
    G.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
    G.registerProcessor = (name, cls) => { if (name === 'synth-engine') Proc = cls; };
    Math.random = function random() { return rnd(); };
    const sfx = (G.location && typeof G.location.search === 'string' && G.location.search) || '';
    for (const f of DSP) {
      try { G.importScripts(f + sfx); } catch (err) { console.warn('render farm: ' + f + ' not loaded', err); }
    }
    try { G.importScripts('engine.js' + sfx); } catch (err) { loadErr = err; throw err; }
    if (!Proc) { loadErr = new Error('render farm: engine.js registered no processor'); throw loadErr; }
  }

  function render(req) {
    load();
    const r = req || {};
    const ev = (Array.isArray(r.events) ? r.events : []).filter(e => Array.isArray(e) && e.length >= 3 && Number.isFinite(e[0]))
      .map((e, i) => [Math.max(0, Math.round(e[0])), e[1] ? 1 : 0, e[2] | 0, Number.isFinite(e[3]) ? e[3] : 100, i])
      .sort((a, b) => a[0] - b[0] || a[4] - b[4]);
    const max = Math.max(0, Math.min(MAX_FRAMES, Math.floor(+r.frames || 0)));
    const offs = ev.filter(e => !e[1]), last = (offs.length ? offs : ev).reduce((m, e) => Math.max(m, e[0]), 0);
    const silentFrom = Math.ceil(last / Q) * Q; // the quantum the last note-off (or event) is delivered before
    const wts = Array.isArray(r.wts) ? r.wts : null, smps = Array.isArray(r.smps) ? r.smps : null;
    G.currentFrame = 0;
    seed(r.id);
    const p = new Proc({ processorOptions: { os: r.os > 0 ? r.os : 2, offline: true, patch: r.patch || null, wts, smps } });
    seed(r.id);
    const L = new Float32Array(max), R = new Float32Array(max), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
    const deliver = x => p.msg(x[1] ? { t: 'on', n: x[2], v: x[3] / 127 } : { t: 'off', n: x[2] });
    let e = 0, quiet = 0, end = max;
    try {
      for (let o = 0; o < max; o += Q) {
        oL.fill(0); oR.fill(0);
        // the quantum is split at its events (at the engine's 4-frame span granularity, as a bounce's song events):
        // every event starts sounding at its own frame rounded up to a multiple of 4
        let a = 0;
        for (;;) {
          while (e < ev.length && ev[e][0] <= o + a) deliver(ev[e++]);
          let b = Q;
          if (e < ev.length && ev[e][0] < o + Q) b = Math.min(Q, Math.ceil((ev[e][0] - o) / 4) * 4);
          if (b <= a) b = Math.min(Q, a + 4);
          G.currentFrame = o + a;
          p.process([], a === 0 && b === Q ? out : [[oL.subarray(a, b), oR.subarray(a, b)]]);
          a = b;
          if (a >= Q) break;
        }
        G.currentFrame = o;
        const n = Math.min(Q, max - o);
        L.set(n === Q ? oL : oL.subarray(0, n), o); R.set(n === Q ? oR : oR.subarray(0, n), o);
        G.currentFrame += Q;
        if (e >= ev.length && o >= silentFrom) {
          for (let i = 0; i < n; i++) {
            if (Math.abs(oL[i]) < THR && Math.abs(oR[i]) < THR) quiet++; else quiet = 0;
          }
          if (quiet >= HOLD) { end = o + n; break; }
        }
      }
    } finally {
      // every request is self-contained: drop its tables / assets from the scope's shared stores
      const SD = G.SerumDSP, SB = G.SxBase;
      if (SD && wts) for (const w of wts) if (w && w.id) { try { SD.dropWT(w.id); } catch { /* not stored */ } }
      if (SB && smps) for (const a of smps) if (a && a.id) SB.dropAsset(a.id);
    }
    return end === max ? { L, R } : { L: L.slice(0, end), R: R.slice(0, end) };
  }

  G.onmessage = (msg) => {
    const req = (msg && msg.data) || {};
    let reply, transfer = [];
    try {
      const { L, R } = render(req);
      reply = { q: req.q, ok: true, L, R };
      transfer = [L.buffer, R.buffer];
    } catch (err) {
      reply = { q: req.q, ok: false, err: String((err && err.message) || err) };
    }
    G.postMessage(reply, transfer);
  };
  G.__smprender = Object.freeze({ DSP: Object.freeze(DSP.slice()), render, ready: () => { load(); return true; } });
})();
