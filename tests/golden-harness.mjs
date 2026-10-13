// Golden back-compat harness (owner I; SPEC-serum2 §15.1, §0.4, §0.5 M0). Shared by the four golden shards:
//   golden-presets.test.mjs · golden-random.test.mjs · golden-classic.test.mjs · golden-fx.test.mjs
// Side (A) "ref" = the frozen Phase-1 code in tests/ref-p1/ (tag serum-p1): serum-core, wt, models (ES modules) and
// serum-dsp → fx-dsp → engine (classic scripts). Side (B) "v2" = the repository's current modules and the §0.3 script
// list (every file of the list that exists, in table order, then engine.js). Each side renders in its own node:vm
// "AudioWorkletGlobalScope" whose Math.random is mulberry32(fnv1a32(<render id>)), reseeded before every render and
// again before its first patch (engine.js Solina Divide phases, §0.4). A v1 state is fed to (A) as it is and to (B)
// through the v2 entry points (normalizeSerum / normalizeFx migrate v1 input, §2.6), then both render the same event
// script (§15.1) and are compared sample by sample.
// GOLDEN_FULL=1 runs the full sweep of every shard (≈ 3 min on an M-class laptop, budget 10 min; before each milestone
// exit and in the release checklist). GOLDEN_SEED=<n> replays the random shards of run n.
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mulberry32, fnv1a32 } from './ref-p1/wt.js';

export { mulberry32, fnv1a32 };
export const ROOT = new URL('../', import.meta.url);
export const REF = new URL('./ref-p1/', import.meta.url);
export const FULL = process.env.GOLDEN_FULL === '1';
export const SR = 48000;
export const BPM = 120;
export const PPQ = 960;
const read = u => readFileSync(u, 'utf8');

// §0.3: scripts 1–11 in table order (engine.js last). Phase 1 has only serum-dsp.js and fx-dsp.js.
export const DSP_V2 = ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js',
  'sx-seq.js', 'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js'];
export const DSP_REF = ['serum-dsp.js', 'fx-dsp.js'];
// the files frozen at M0 (only models.js's `?v=` import suffix is rewritten to the sibling path)
export const REF_FILES = ['serum-core.js', 'wt.js', 'serum-dsp.js', 'fx-dsp.js', 'engine.js', 'models.js'];

// The shared `?v=N` suffix of the site's relative imports (§0.4), read from models.js, so the v2 modules imported here
// are the instances models.js uses and a release bump of N needs no edit in the golden files.
export const SUFFIX = (() => {
  const m = /from '\.\/serum-core\.js(\?v=\d+)'/.exec(read(new URL('models.js', ROOT)));
  return m ? m[1] : '';
})();

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const refManifest = () => JSON.parse(read(new URL('MANIFEST.json', REF)));
export const refSource = f => read(new URL(f, REF));

/* ------------------------------------------------------------------ sides */
async function loadSide(name) {
  const ref = name === 'ref', base = ref ? REF : ROOT, sfx = ref ? '' : SUFFIX;
  const imp = f => import(new URL(f + sfx, base).href);
  const core = await imp('serum-core.js'), wt = await imp('wt.js'), models = await imp('models.js');
  // FX state functions: serum-core in Phase 1; fx-core.js once C1 has moved them there (M1a, §11.2)
  let fxm = core;
  if (!ref && existsSync(new URL('fx-core.js', ROOT))) {
    const f = await imp('fx-core.js');
    if (typeof f.compileFx === 'function') fxm = f;
  }
  const files = (ref ? DSP_REF : DSP_V2).filter(f => existsSync(new URL(f, base)));
  return {
    name, core, wt, models, fxm,
    dsp: files.map(f => [f, read(new URL(f, base))]),
    engine: read(new URL('engine.js', base)),
    entries: new Map(), // wavetable / noise entries built by this side's wt.js (cached by id)
    user: new Map(),    // user tables (id → Table) restored from embedded project data
    scopes: new Map(),
  };
}
let SIDES = null;
/** @returns {Promise<[object, object]>} [A (ref-p1), B (v2)] */
export function sides() { return SIDES || (SIDES = Promise.all([loadSide('ref'), loadSide('v2')])); }

/* ------------------------------------------------------------------ worklet scope */
// One AudioWorkletGlobalScope per side and sample rate, kept for the whole shard (the first processor's JIT warm-up
// runs once, as in the browser). Processors of earlier renders are dropped; currentFrame restarts at 0 per render.
// The context is created with vm.constants.DONT_CONTEXTIFY: an ordinary global object with its own intrinsics (Math,
// typed arrays) and no interceptor, so the scripts run at the speed they have in a worklet (a contextified sandbox
// object costs 5–25× on every global lookup in the DSP loops) and the timing rows of §14.1 measure the DSP. Node < 22.8
// lacks the option: a contextified object is used instead (same results, the shards then exceed 60 s).
export function scope(side, sr = SR) {
  let S = side.scopes.get(sr);
  if (S) return S;
  let Proc = null;
  const logs = [];
  const keep = (...a) => { if (logs.length < 200) logs.push(a.map(String).join(' ')); };
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn: keep, error: keep }, sampleRate: sr, currentFrame: 0, __rnd: mulberry32(1) });
  g.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
  g.registerProcessor = (n, c) => { Proc = c; };
  vm.runInContext('Math.random = function random() { return __rnd(); };', g, { filename: 'golden-random.js' });
  for (const [f, code] of side.dsp) vm.runInContext(code, g, { filename: side.name + '/' + f });
  vm.runInContext(side.engine, g, { filename: side.name + '/engine.js' });
  if (!Proc) throw new Error(side.name + ': engine.js registered no processor');
  S = { side, sr, g, logs, Proc, math: vm.runInContext('Math', g), seed(id) { g.__rnd = mulberry32(fnv1a32(String(id))); } };
  side.scopes.set(sr, S);
  return S;
}

/* ------------------------------------------------------------------ states and patches */
const clone = x => JSON.parse(JSON.stringify(x));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

// A v1 Serum state as side X stores it: (A) the Phase-1 normalisation, (B) the v2 one (v1 input ⇒ migrate1, §2.6.1)
export const serumState = (X, v1) => X.core.normalizeSerum(clone(v1));
// A v1 FX state as side X keeps it: fx-core's normalizeFx is version-preserving (a v1 state stays v1 and compileFx reads
// it as Phase 1 did, §4.3; extra args are ignored by the Phase-1 function)
export const fxState = (X, v1fx, s) => X.fxm.normalizeFx(clone(v1fx), s || undefined);
// A v1 FX state converted per §2.6.3 — migrateFx1(normalizeFxV1(v1), refs = the track's Serum state): what main.js loads
// a project with (§12.6) and what the rack and mixer UIs produce on the first v2 edit. Side A (no migrateFx1): the v1
// state as fxState.
export const fxMigrated = (X, v1fx, s) => (typeof X.fxm.migrateFx1 === 'function'
  ? X.fxm.migrateFx1(X.fxm.normalizeFxV1(clone(v1fx)), s || undefined) : fxState(X, v1fx, s));
const moddedOf = (X, s, fx) => (typeof X.core.fxModded2 === 'function' ? X.core.fxModded2(s, fx) : X.core.fxModded(s));

// The engine patch main.js builds for a track (buildPatch, §12.6): model map with the app's defaults (drift 5/10,
// hiss on, smoothing 1) + the track's FX rack + tempo. `seed` = the rack re-seed of a preset load / new track.
// (B) builds it with models.js patchFor, the function main.js's buildPatch uses (§12.7: the FX state reaches
// compileSerum, so matrix rows targeting FX parameters resolve against the rack's layout); (A) with the Phase-1 recipe.
export function trackPatch(X, model, vals, fx, { sr = SR, bpm = BPM, seed = false } = {}) {
  if (typeof X.models.patchFor === 'function') {
    return X.models.patchFor(model, vals, fx, { sr, bpm, drift: 0.5, hiss: 1, prefs: { smooth: 1, silenceTails: 1 }, seed });
  }
  const m = X.models.MODELS.find(x => x.id === model);
  if (!m) throw new Error(X.name + ': no model ' + model);
  const P = {};
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(vals[c.id]) : vals[c.id];
  const patch = m.map(P, vals, { drift: 0.5, hiss: 1, sr, bpm, smooth: 1 });
  const s = m.custom && vals.s ? vals.s : null;
  patch.fxr = X.fxm.compileFx(fx, { bpm, rate: sr, master: s ? s.p['g.master'] : undefined, bypass: s ? s.p['g.bypass'] : undefined,
    modded: s ? moddedOf(X, s, fx) : null, seed, smooth: 1, silence: 1 });
  patch.fxrT = X.fxm.compileFxT(fx);
  patch.bpm = bpm;
  return patch;
}
// panel values of a classic model with a preset applied (main.js: defaults + preset.v)
export function classicVals(X, model, preset) {
  const m = X.models.MODELS.find(x => x.id === model), v = {};
  for (const c of m.controls) v[c.id] = c.def;
  return Object.assign(v, preset ? clone(preset.v) : {});
}

// wavetable / noise entries as main.js posts them ({t: 'wt', …}), built by side X's own wt.js
export function entry(X, id) {
  let e = X.entries.get(id);
  if (e === undefined) {
    const W = X.wt;
    if (X.user.has(id)) e = W.makeEntry(id, X.user.get(id));
    else if (id.startsWith('noise:')) e = W.makeNoise(id);
    else { const t = W.factoryTable(id); e = t ? W.makeEntry(id, t) : null; }
    X.entries.set(id, e);
  }
  return e;
}
export function postTables(X, proc, needs) {
  for (const id of needs || []) { const e = entry(X, id); if (e) proc.msg(Object.assign({ t: 'wt' }, e)); }
}
// embedded user tables of a project file (main.js tables.restore → wtstore toTable → makeEntry)
export function restoreTables(X, wts) {
  const W = X.wt;
  for (const id of Object.keys(wts || {})) {
    const rec = W.decodeEmbedded(wts[id]), all = new Float32Array(rec.data), frames = [];
    for (let f = 0; f < rec.frames; f++) frames.push(all.slice(f * W.FRAME, (f + 1) * W.FRAME));
    X.user.set(id, { id, name: rec.name, frames, morph: rec.morph | 0, factory: 0 });
    X.entries.delete(id);
  }
}

/* ------------------------------------------------------------------ the event script (§15.1) */
// 4 s at 120 BPM: a chord (48, 60, 67), two legato pairs, a held note with mod wheel, aftertouch, bend moves and the
// sustain pedal, then a song-transport segment: playback from tick 0, play-with-seek to bar 2 inside a one-beat loop
// (a loop wrap, song CCs: wheel, bend), a stop and a restart from tick 0. Transport messages are posted 1024 frames
// ahead with a mid-quantum start frame, as main.js schedules them. Returns [[postFrame, msg], …] sorted by frame.
// The Phase-1 engine starts a transport (and wraps a loop) at the first 4-frame span boundary at or after its frame —
// a wrap often one span later still, as its frame is reached through rounded tick arithmetic — and re-seeks the song
// from that later position, so the notes exactly at an unaligned start tick and at the loop start are skipped (a
// Phase-1 defect reported at M0, fixed by RULINGS2 bug fix 1 in the current engine). The script keeps its renders
// unaffected by the fix (bit-identical on both sides): the start frames are multiples of 4 and the loop starts on a tick
// without song events (3880). The affected cases are the expected-different cases of golden-classic.test.mjs
// (TRANSPORT_CASES below).
export const SCRIPT_SECONDS = 4;
export const SONG = {
  notes: [ // tick, duration, note, velocity (main.js songData layout)
    0, 900, 48, 100, 0, 900, 60, 90, 960, 480, 67, 110, 1440, 400, 64, 80, 1920, 1800, 52, 100, 2880, 700, 71, 70,
    3840, 700, 55, 110, 3840, 700, 62, 100, 3900, 300, 59, 100, 4080, 200, 64, 85, 4320, 300, 69, 90, 4560, 200, 74, 60,
    4800, 900, 57, 105, 5760, 1500, 50, 95,
  ],
  cc: [3900, 1, 0.6, 4100, 0, 0.3, 4400, 0, -0.4, 4700, 0, 0, 4750, 1, 0],
};
export function script(sr = SR, { song = true } = {}) {
  const ev = [], F = t => Math.round(t * sr), fpt = sr * 60 / (BPM * PPQ);
  const at = (t, m) => ev.push([F(t), m]);
  const on = (n, v) => ({ t: 'on', n, v }), off = (n, rv) => (rv === undefined ? { t: 'off', n } : { t: 'off', n, rv });
  if (song) at(0, { t: 'song', notes: SONG.notes.slice(), cc: SONG.cc.slice() });
  at(0.00, on(48, 0.8)); at(0.00, on(60, 0.7)); at(0.00, on(67, 0.9));
  at(0.45, off(48)); at(0.45, off(60)); at(0.46, off(67, 0.4));
  at(0.55, on(55, 0.75)); at(0.80, on(57, 0.85)); at(0.85, off(55));          // legato pair 1
  at(1.05, on(59, 0.6)); at(1.10, off(57)); at(1.25, off(59));                // legato pair 2
  at(1.30, on(64, 1.0));                                                      // held note
  at(1.35, { t: 'wheel', v: 0.35 }); at(1.45, { t: 'wheel', v: 0.9 }); at(1.55, { t: 'bend', v: 0.6 });
  at(1.62, { t: 'at', v: 0.5 }); at(1.70, { t: 'bend', v: -0.8 }); at(1.78, { t: 'bend', v: 0 });
  at(1.80, { t: 'wheel', v: 0 }); at(1.82, { t: 'at', v: 0 }); at(1.84, { t: 'sus', v: true });
  at(1.86, off(64)); at(1.92, { t: 'sus', v: false });
  if (song) {
    const tp = (t, o) => ev.push([F(t) - 1024, Object.assign({ t: 'transport', play: true, frame: 4 * Math.round((F(t) + 36) / 4), fpt }, o)]);
    tp(1.95, { tick: 0, seek: true, loop: false });                            // play from tick 0
    tp(2.30, { tick: 3840, seek: true, loop: true, ls: 3880, le: 4840 });      // play with seek to bar 2, loop wraps at ≈ 2.80
    at(3.05, { t: 'transport', play: false });                                 // stop
    tp(3.25, { tick: 0, seek: true, loop: false });                            // restart
  }
  return ev.sort((a, b) => a[0] - b[0]);
}

/* ------------------------------------------------------------------ transport note-drop cases (RULINGS2 bug fix 1) */
// The expected-different golden cases: renders whose events the fix changes. The Phase-1 engine (ref-p1) drops the song
// notes exactly at the play / seek tick when the transport frame is not a multiple of 4, and loop-start notes at a wrap
// whose frame is unaligned or computed past its frame by rounding; the current engine plays them (at the span boundary
// that handles the start / wrap, ≤ 4 frames after its frame). Each case: rate, tempo, a song, its transport messages
// [frame, msg] (posted 1024 frames ahead, as main.js schedules them) and the ticks whose notes the reference drops at
// the anchor (`anchorTicks`: start / seek ticks; loop cases: the loop start at a wrap).
export const TRANSPORT_CASES = [
  { name: 'play at an unaligned frame (≡ 2 mod 4): the notes at the start tick', sr: 48000, bpm: 120, seconds: 1.5,
    notes: [0, 480, 48, 100, 0, 480, 55, 90, 960, 480, 60, 100, 1920, 480, 64, 100],
    tp: [[4802, { play: true, tick: 0, seek: true, loop: false }]], anchorTicks: [0] },
  { name: 'play with seek at an unaligned frame (≡ 1 mod 4): the notes at the seek tick', sr: 48000, bpm: 120, seconds: 2,
    notes: [0, 400, 48, 100, 960, 400, 52, 100, 1920, 400, 64, 100, 1920, 400, 67, 90, 2880, 400, 60, 100],
    tp: [[4800, { play: true, tick: 0, seek: true, loop: false }], [36001, { play: true, tick: 1920, seek: true, loop: false }]], anchorTicks: [1920] },
  { name: 'loop wraps at 44.1 kHz, 120 BPM (a beat = 22050 frames: every other wrap frame unaligned; one span overshoots)', sr: 44100, bpm: 120, seconds: 3,
    notes: [0, 240, 60, 100, 0, 240, 64, 90, 480, 240, 67, 100],
    tp: [[4800, { play: true, tick: 0, seek: true, loop: true, ls: 0, le: 960 }]], anchorTicks: [0], loop: true },
  { name: 'loop wraps at 48 kHz, 90 BPM (aligned wraps whose song position rounds short of the loop end: 959.9999999999999)', sr: 48000, bpm: 90, seconds: 3,
    notes: [0, 240, 57, 100, 480, 240, 64, 100],
    tp: [[4800, { play: true, tick: 0, seek: true, loop: true, ls: 0, le: 960 }]], anchorTicks: [0], loop: true },
];
// the events of a case (song first, transports 1024 frames ahead)
export function transportEvents(c) {
  const fpt = c.sr * 60 / (c.bpm * PPQ), ev = [[0, { t: 'song', notes: c.notes.slice(), cc: [] }]];
  for (const [f, m] of c.tp) ev.push([Math.max(0, f - 1024), Object.assign({ t: 'transport', frame: f, fpt }, m)]);
  return ev.sort((a, b) => a[0] - b[0]);
}
// renders a case on side X with the processor's note-ons logged: {L, R, log: [[frame, note], …]} (frame = the span start
// the note-on was handled at)
export function renderTransportCase(X, c, { model = 'prophet5', vals = null, fx = null, id = 'transport:' + c.name } = {}) {
  const S = scope(X, c.sr), log = [];
  const r = render(S, {
    id, seconds: c.seconds, events: transportEvents(c), po: { os: 1, hostOS: 1 },
    setup(p) {
      const v = vals || classicVals(X, model, null), F = fx || X.fxm.defaultFx();
      const patch = trackPatch(X, model, v, F, { sr: c.sr, bpm: c.bpm });
      postTables(X, p, patch.needs);
      p.msg({ t: 'patch', p: patch });
      const on = p.noteOn;
      p.noteOn = function (n, ...a) { log.push([p.spanF, n]); return on.call(this, n, ...a); };
    },
  });
  return { L: r.L, R: r.R, log };
}

/* ------------------------------------------------------------------ rendering */
// Renders `seconds` of one fresh processor of scope S: reseed, construct (processorOptions `po`), reseed, setup(p)
// (patch + tables), then the events (posted before the quantum that starts at or after their frame). Float32 output.
export function render(S, { id, po = {}, setup, events = [], seconds = SCRIPT_SECONDS }) {
  const N = Math.ceil(seconds * S.sr / 128) * 128;
  S.g.currentFrame = 0;
  S.seed(id);
  const p = new S.Proc({ processorOptions: po });
  S.seed(id);
  if (setup) setup(p);
  const L = new Float32Array(N), R = new Float32Array(N), oL = new Float32Array(128), oR = new Float32Array(128), out = [[oL, oR]];
  let e = 0;
  for (let o = 0; o < N; o += 128) {
    while (e < events.length && events[e][0] <= o) p.msg(events[e++][1]);
    p.process([], out);
    L.set(oL, o); R.set(oR, o);
    S.g.currentFrame += 128;
  }
  return { L, R, proc: p };
}
// a track render through its patch (live path: messages) with the event script
export function renderTrack(X, { id, model, vals, fx, os, hostOS = 4, seed = true, events, seconds, seq = null, sr = SR }) {
  const S = scope(X, sr);
  return render(S, {
    id, seconds, events: events || script(sr),
    po: { os: os || hostOS, hostOS },
    setup(p) {
      const patch = trackPatch(X, model, vals, fx, { sr, seed });
      postTables(X, p, patch.needs);
      p.msg({ t: 'patch', p: patch });
      if (seq) p.msg({ t: 'seq', s: clone(seq) });
    },
  });
}

/* ------------------------------------------------------------------ comparison */
// max |a − b| over both channels (Infinity when exactly one is NaN or either is ±Infinity) and where it occurs
export function compare(A, B) {
  let max = 0, at = -1, ch = '';
  for (const c of ['L', 'R']) {
    const a = A[c], b = B[c];
    if (a.length !== b.length) return { max: Infinity, at: -1, ch: 'length' };
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x === y) continue;
      const d = Number.isNaN(x) && Number.isNaN(y) ? 0 : Math.abs(x - y);
      if (!(d <= max)) { max = Number.isNaN(d) ? Infinity : d; at = i; ch = c; }
    }
  }
  return { max, at, ch };
}
export const peak = R => { let m = 0; for (const c of ['L', 'R']) for (const x of R[c]) { const a = Math.abs(x); if (a > m) m = a; } return m; };
export const finite = R => R.L.every(Number.isFinite) && R.R.every(Number.isFinite);
export const dB = x => 20 * Math.log10(Math.max(1e-30, x));
export function describe(d, sr = SR) {
  return d.at < 0 ? 'equal' : `max |A−B| ${d.max.toExponential(3)} (${dB(d.max).toFixed(1)} dB) at ${d.ch}[${d.at}] = ${(d.at / sr).toFixed(4)} s`;
}

/* ------------------------------------------------------------------ seeded random v1 states (§15.1 shards 2 and 4) */
function rng(seed) {
  const r = mulberry32(seed >>> 0);
  return { r, pick: a => a[Math.floor(r() * a.length)], chance: q => r() < q, int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)) };
}
function randomPts(R, n, lfo) {
  const pts = [[0, R.r(), 2 * R.r() - 1]];
  for (let j = 1; j < n - 1; j++) {
    const q = [R.r(), R.r(), R.chance(0.7) ? 2 * R.r() - 1 : 0];
    if (lfo && R.chance(0.1)) q.push(R.int(1, 16), R.chance(0.5) ? R.int(1, 16) : 0);
    pts.push(q);
  }
  pts.push([1, R.r(), 0]);
  return pts;
}
// "normalizeV1 of random JSON": random destinations, rows, LFO graphs, voicing and global settings over the v1 lists of
// the frozen serum-core, kept audible (OSC A on, ENV 1 sustain, level) and affordable (POLY ≤ 8, unison ≤ 8).
export function randomSerumV1(core, wt, seed, os) {
  const R = rng(seed), { r, pick, chance, int } = R;
  const D = core.DESTS, NS = core.NS, p = {};
  for (let i = 0; i < NS; i++) if (chance(0.3)) p[D[i].id] = r();
  for (const id of ['f.on', 'b.on', 's.on', 'n.on']) if (chance(0.5)) p[id] = chance(0.5) ? 1 : 0;
  Object.assign(p, {
    'a.on': 1, 'a.level': 0.5 + 0.4 * r(), 'e1.sus': 0.5 + 0.5 * r(), 'e1.att': 0.25 * r(), 'g.amp': 0.7 + 0.3 * r(),
    'a.uni': int(0, 7) / 15, 'b.uni': int(0, 7) / 15, 'g.master': 0.55 + 0.2 * r(), 'g.bypass': 0,
  });
  if (chance(0.5)) p['f.type'] = int(0, 95) / 95;
  if (chance(0.5)) { p['a.warpMode'] = int(0, 22) / 22; p['a.warp'] = r(); }
  if (chance(0.3)) { p['b.warpMode'] = int(0, 22) / 22; p['b.warp'] = r(); }
  const srcs = core.SOURCES.map(x => x.id).filter(Boolean), dsts = D.map(d => d.id).filter(id => id !== 'g.bypass');
  const matrix = [];
  for (let k = 0, n = int(0, 20); k < n; k++) {
    matrix.push({ src: pick(srcs), dst: chance(0.85) ? D[int(0, NS - 1)].id : pick(dsts), amt: 2 * r() - 1, bi: chance(0.5) ? 1 : 0,
      curve: chance(0.3) ? 2 * r() - 1 : 0, aux: chance(0.25) ? pick(srcs) : '', inv: chance(0.3) ? 1 : 0, byp: chance(0.1) ? 1 : 0,
      out: chance(0.8) ? 1 : r() });
  }
  const lfo = Array.from({ length: core.N_LFO }, () => {
    const n = int(2, 10), pts = randomPts(R, n, true);
    return { mode: pick(['trig', 'env', 'off']), bpm: chance(0.5) ? 1 : 0, dot: chance(0.2) ? 1 : 0, trip: chance(0.2) ? 1 : 0,
      anchor: chance(0.5) ? 1 : 0, pts, loop: chance(0.4) ? int(0, n - 1) : -1, start: int(0, n - 1) };
  });
  const tables = wt.FACTORY_TABLES.map(t => t.id), noises = wt.NOISES.map(x => x.id);
  const json = {
    v: 1, p,
    osc: [0, 1].map(() => ({ wt: pick(tables), remap: chance(0.3) ? randomPts(R, int(2, 6), false) : undefined,
      memSet: chance(0.2) ? Array.from({ length: 16 }, () => r()) : undefined })),
    sub: { direct: chance(0.3) ? 1 : 0 },
    noise: { src: pick(noises), oneshot: chance(0.2) ? 1 : 0, keytrack: chance(0.5) ? 1 : 0, direct: chance(0.2) ? 1 : 0 },
    filter: { keytrack: chance(0.4) ? 1 : 0 },
    lfo,
    velo: { pts: randomPts(R, int(2, 5), false), porta: chance(0.3) ? 1 : 0 },
    note: { pts: randomPts(R, int(2, 5), false), porta: chance(0.3) ? 1 : 0 },
    chaos: [0, 1].map(() => ({ mono: chance(0.5) ? 1 : 0, sh: chance(0.5) ? 1 : 0 })),
    macros: Array.from({ length: core.N_MACRO }, (_, m) => ({ name: 'Macro ' + (m + 1), v: r() })),
    matrix,
    voicing: { mono: chance(0.25) ? 1 : 0, legato: chance(0.4) ? 1 : 0, poly: int(1, 8), always: chance(0.3) ? 1 : 0,
      scaled: chance(0.3) ? 1 : 0, oneNote: chance(0.7) ? 1 : 0 },
    global: { os, a4: 430 + 20 * r(), uniRange: [48 * r(), 48 * r()], uniMode: [int(0, 4), int(0, 4)] },
  };
  return core.normalizeSerum(json);
}
// a random v1 FX rack: 1–6 modules enabled with random parameters, shuffled order, sub-states and phases
export function randomFxV1(core, seed) {
  const R = rng(seed), { r, chance, int } = R;
  const fx = core.defaultFx(), mods = fx.order.slice();
  for (let i = mods.length - 1; i > 0; i--) { const j = int(0, i); [mods[i], mods[j]] = [mods[j], mods[i]]; }
  if (chance(0.7)) fx.order = mods;
  const on = new Set(mods.slice(0, int(1, 6)));
  for (const id of Object.keys(fx.p)) {
    const m = id.split('.')[1], mod = m === 'dim' ? 'hyper' : m;
    if (!on.has(mod)) continue;
    if (id === 'fx.' + mod + '.on') fx.p[id] = 1;
    else if (chance(0.7)) fx.p[id] = r();
  }
  for (const m of fx.order) fx.byp[m] = chance(0.05) ? 1 : 0;
  fx.dist = { xa: randomPts(R, int(2, 5), false), xb: randomPts(R, int(2, 5), false) };
  fx.cho = { mono: chance(0.3) ? 1 : 0 };
  fx.rev = { type: chance(0.5) ? 1 : 0 };
  fx.phase = [r(), r(), r(), r()];
  return core.normalizeFx(fx);
}

/* ------------------------------------------------------------------ run selection and timing */
// The rotating run index (§15.1 shard 2: "seed = run index, so different runs cover different states"): GOLDEN_SEED
// when set, else the UTC day number (stable within a day, so a failure reproduces with GOLDEN_SEED=<printed value>).
export const RUN = process.env.GOLDEN_SEED != null && process.env.GOLDEN_SEED !== '' ? (+process.env.GOLDEN_SEED >>> 0) : Math.floor(Date.now() / 864e5);

export const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
// Medians of `runs` interleaved timings of fA and fB (§14.1: medians of 5 interleaved runs). Each run is a back-to-back
// pair in alternating order (AB, BA, …) and the ratio is the median of the per-pair ratios, so a stretch of machine load
// (parallel test files, a core change) slows both members of a pair instead of one side's median. A ratio above `limit`
// is measured again (up to `tries` times, default 5) before it is reported: a real regression exceeds it every time.
export function timeInterleaved(fA, fB, { runs = 5, limit = Infinity, tries = 5 } = {}) {
  const time = f => { const t0 = performance.now(); f(); return performance.now() - t0; };
  fA(); fB(); // warm
  let best = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ta = [], tb = [], q = [];
    for (let k = 0; k < runs; k++) {
      let a, b;
      if (k % 2) { b = time(fB); a = time(fA); } else { a = time(fA); b = time(fB); }
      ta.push(a); tb.push(b); q.push(b / a);
    }
    const r = { a: median(ta), b: median(tb), ratio: median(q), attempts: attempt };
    if (!best || r.ratio < best.ratio) best = Object.assign(r, { attempts: attempt });
    if (best.ratio <= limit) break;
  }
  return best;
}
export { clone, isObj };
