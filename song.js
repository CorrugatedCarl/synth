/*
 * SYNTH Studio — song data model and pure editing logic (no DOM).
 * Ticks are integers at PPQ resolution. Note: { id, t, d, n, v }; controller event: { t, k, v }.
 * Note edit operations work in place on the array they are given and return it.
 * (SYNTH Canvas 2b: the modulator modules' LFO / ENV / chaos states are bounded by serum-core's own normalisers — the one
 * import of this module; song.js stays the base of everything else. 7a: a drum machine's memory by drum-core's normDrum, a
 * leaf module. Stage 8: project.pads by pads-core's normPads, also a leaf (it imports only drum-core). Stage 9: a 900 Series
 * device's `patch` by patch-core's normPatch, a leaf too (it imports only the family's table).)
 */
import { normLfoMod, normEnvMod, normChaosMod } from './serum-core.js?v=9';
import { normDrum, mapTable, DEFAULT_MAP, PERS } from './drum-core.js?v=9'; // (7a: a drum machine's record, its channel 10)
import { normPads } from './pads-core.js?v=9'; // (stage 8, schema 11: project.pads — a leaf, as drum-core: it imports only drum-core)
import { normPatch, familyOf, isPatchModel } from './patch-core.js?v=9'; // (stage 9, schema 12: a 900 Series device's `patch` — a leaf: it imports only the family's table, moog-core)

export const PPQ = 960;
export const TRACK_COLORS = ['#f2a33a', '#3b82c4', '#e2402f', '#3fae5a', '#b06ad9', '#2bb3a3', '#f5d22e', '#ff6a13', '#58b2ff', '#e86aa8', '#9bd16a', '#c9a227'];
export const GRIDS = [
  { label: '1/1', t: PPQ * 4 }, { label: '1/2', t: PPQ * 2 }, { label: '1/4', t: PPQ }, { label: '1/8', t: PPQ / 2 },
  { label: '1/16', t: PPQ / 4 }, { label: '1/32', t: PPQ / 8 }, { label: '1/64', t: PPQ / 16 },
  { label: '1/4T', t: PPQ * 2 / 3 }, { label: '1/8T', t: PPQ / 3 }, { label: '1/16T', t: PPQ / 6 }, { label: '1/32T', t: PPQ / 12 },
  { label: '1/8.', t: PPQ * 3 / 4 }, { label: '1/16.', t: PPQ * 3 / 8 },
];
export const CC_KINDS = ['bend', 'wheel', 'sus', 'at'];

const MAXT = 2 ** 28 - 1;          // largest tick (also the largest 4-byte MIDI delta)
const MAXBARS = 9999;
const SIG_DEN = [2, 4, 8, 16];
const R = Math.round;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d) => {
  const v = typeof x === 'string' && x.trim() ? +x : typeof x === 'boolean' ? +x : x;
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
const bool = (x, d) => (typeof x === 'boolean' ? x : x === 1 || x === 0 ? !!x : x === 'true' ? true : x === 'false' ? false : d);
const str = (x, d, max = 200) => (typeof x === 'string' && x ? x.slice(0, max) : d);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const idSet = ids => (ids == null ? null : new Set(typeof ids === 'string' ? [ids] : [...ids]));
const pickTracks = (p, ids) => { const s = idSet(ids); return s ? p.tracks.filter(t => s.has(t.id)) : p.tracks; };
const allTracks = (p, ids) => { const s = idSet(ids); return !s || p.tracks.every(t => s.has(t.id)); };
const keep = (a, f) => { let j = 0; for (const x of a) if (f(x)) a[j++] = x; const n = a.length - j; a.length = j; return n; };
const sortCC = cc => cc.sort((a, b) => a.t - b.t);
const validId = id => typeof id === 'string' && id !== '__proto__' && /^[\w.:-]{1,64}$/.test(id);
// highest k among 'trk_<k>' ids; huge k is ignored so the k + 1 counter can't stall at 2^53
const maxTrk = ids => { let n = 0; for (const id of ids) { const m = /^trk_(\d{1,9})$/.exec(id); if (m) n = Math.max(n, +m[1]); } return n; };

export function mulberry32(a) {
  a = a >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idSeq = 0;
export function newId() { return ++idSeq; }

/* ----------------------------------------------------------- project */
export function newProject(opts = {}) {
  const p = {
    version: 1, name: str(opts.name, 'Untitled'), bpm: 120, sig: [4, 4], bars: 16,
    loop: { on: true, start: 0, end: 0 },
    metronome: { on: true, countIn: 1, vol: 0.6 },
    rec: { mode: 'overdub', inputQuantize: false },
    snap: PPQ / 4,
    quantize: { grid: PPQ / 4, strength: 100, swing: 0, starts: true, ends: false },
    selTrack: null, tracks: [],
  };
  p.loop.end = barTicks(p) * 4;
  const t = newTrack(p, { model: opts.model, vals: opts.vals, preset: opts.preset, modelName: opts.modelName, name: opts.trackName });
  p.tracks.push(t); p.selTrack = t.id;
  return p;
}

export function newTrack(project, opts = {}) {
  const trs = (project && Array.isArray(project.tracks)) ? project.tracks : [];
  const ids = new Set(trs.map(t => t.id));
  let n = maxTrk(ids);
  do n++; while (ids.has('trk_' + n));
  const used = new Set(trs.map(t => t.color));
  const color = str(opts.color, null) || TRACK_COLORS.find(c => !used.has(c)) || TRACK_COLORS[trs.length % TRACK_COLORS.length];
  let name = str(opts.name, '');
  if (!name) {
    const base = str(opts.modelName, 'Track'), names = new Set(trs.map(t => t.name));
    let k = 1; while (names.has(base + ' ' + k)) k++;
    name = base + ' ' + k;
  }
  return {
    id: validId(opts.id) && !ids.has(opts.id) ? opts.id : 'trk_' + n, name, color,
    model: str(opts.model, 'minimoog'), vals: isObj(opts.vals) ? plain(opts.vals) : {}, preset: str(opts.preset, null),
    ch: clamp(R(num(opts.ch, 0)), 0, 16), mute: false, solo: false, arm: false,
    vol: clamp(num(opts.vol, 0.8), 0, 1.25), pan: clamp(num(opts.pan, 0), -1, 1),
    notes: [], cc: [],
  };
}

export function findTrack(project, id) { return project.tracks.find(t => t.id === id) || null; }

/* -------------------------------------------------------------- time */
export function barTicks(project) { return PPQ * 4 * project.sig[0] / project.sig[1]; }
export function beatTicks(project) { return PPQ * 4 / project.sig[1]; }
export function fmtBBT(project, t) {
  const bt = barTicks(project), be = beatTicks(project);
  t = R(num(t, 0));
  const b = Math.floor(t / bt), r = t - b * bt, beat = Math.floor(r / be), tk = r - beat * be;
  return `${b >= 0 ? b + 1 : b}.${beat + 1}.${String(tk).padStart(3, '0')}`;
}
export function ticksToSec(project, t) { return t * 60 / (project.bpm * PPQ); }
export function secToTicks(project, s) { return s * project.bpm * PPQ / 60; }
export function snapTick(t, grid, mode = 'round') {
  if (!(grid > 0)) return R(t);
  const q = t / grid;
  const k = mode === 'floor' ? Math.floor(q + 1e-9) : mode === 'ceil' ? Math.ceil(q - 1e-9) : Math.round(q);
  return R(k * grid) + 0;
}
export function sortNotes(notes) { return notes.sort((a, b) => a.t - b.t || a.n - b.n); }
export function songEnd(project) {
  let e = project.bars * barTicks(project);
  for (const tr of project.tracks) for (const x of tr.notes) if (x.t + x.d > e) e = x.t + x.d;
  return e;
}
function contentEnd(project) {
  let e = 0;
  for (const tr of project.tracks) {
    for (const x of tr.notes) if (x.t + x.d > e) e = x.t + x.d;
    for (const c of tr.cc) if (c.t + 1 > e) e = c.t + 1;
  }
  return e;
}
export function cloneNotes(notes) { return notes.map(x => ({ ...x, id: newId() })); }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(n) { return NAMES[n % 12] + (Math.floor(n / 12) - 1); }

/* ------------------------------------------------------- validation */
function plain(x, depth = 0) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string') return x.slice(0, 2000);
  if (typeof x === 'boolean' || x === null) return x;
  if (depth > 8 || typeof x !== 'object') return undefined;
  if (Array.isArray(x)) return x.slice(0, 100000).map(v => { const c = plain(v, depth + 1); return c === undefined ? null : c; });
  const o = {};
  for (const k of Object.keys(x)) { if (k === '__proto__') continue; const c = plain(x[k], depth + 1); if (c !== undefined) o[k] = c; }
  return o;
}
function mkNote(x, off = 0) {
  if (!isObj(x)) return null;
  const t = num(x.t, NaN), n = num(x.n, NaN);
  if (Number.isNaN(t) || Number.isNaN(n)) return null;
  return { id: newId(), t: clamp(R(t + off), 0, MAXT), d: clamp(R(num(x.d, PPQ / 4)), 1, MAXT), n: clamp(R(n), 0, 127), v: clamp(R(num(x.v, 100)), 1, 127) };
}
function mkCC(x, off = 0) {
  if (!isObj(x) || !CC_KINDS.includes(x.k)) return null;
  const t = num(x.t, NaN);
  if (Number.isNaN(t)) return null;
  const v = num(x.v, 0);
  return { t: clamp(R(t + off), 0, MAXT), k: x.k, v: x.k === 'bend' ? clamp(v, -1, 1) : x.k === 'sus' ? (v >= 0.5 ? 1 : 0) : clamp(v, 0, 1) };
}

/* ------------------------------------------------- note operations */
function qTarget(p, grid, sw) {
  const k0 = Math.floor(p / grid);
  let best = 0, bd = Infinity;
  for (let k = Math.max(0, k0 - 1); k <= k0 + 2; k++) {
    const g = k * grid + (k & 1 ? sw : 0), e = Math.abs(g - p);
    if (e <= bd) { bd = e; best = g; }
  }
  return best;
}
function qNext(x, grid, sw) {
  for (let k = Math.max(0, Math.floor(x / grid) - 1); ; k++) { const g = k * grid + (k & 1 ? sw : 0); if (g > x + 1e-9) return g; }
}
export function quantize(notes, { grid, strength = 100, swing = 0, starts = true, ends = false } = {}) {
  grid = num(grid, 0);
  if (!(grid > 0)) return notes;
  const s = clamp(num(strength, 100), 0, 100) / 100, sw = clamp(num(swing, 0), 0, 100) / 100 * grid / 3;
  for (const x of notes) {
    const d0 = x.d;
    let t = x.t;
    if (starts) t = Math.max(0, R(t + (qTarget(t, grid, sw) - t) * s));
    if (ends) {
      const e = t + d0;
      let g = qTarget(e, grid, sw);
      if (g <= t) g = qNext(t, grid, sw);
      x.d = Math.max(1, Math.min(d0, R(grid / 8)), R(e + (g - e) * s) - t);
    }
    x.t = t;
  }
  return sortNotes(notes);
}
export function humanize(notes, { timing = 10, velocity: vr = 8, seed = 1 } = {}) {
  const rnd = mulberry32(num(seed, 1)), tr = Math.max(0, num(timing, 0)), vv = Math.max(0, num(vr, 0));
  for (const x of notes) {
    const dt = (rnd() * 2 - 1) * tr, dv = (rnd() * 2 - 1) * vv;
    x.t = Math.max(0, R(x.t + dt));
    x.v = clamp(R(x.v + dv), 1, 127);
  }
  return sortNotes(notes);
}
export function transpose(notes, semis) {
  semis = R(num(semis, 0));
  for (const x of notes) x.n = clamp(x.n + semis, 0, 127);
  return sortNotes(notes);
}
export function velocity(notes, { mode = 'set', value, seed } = {}) {
  let f;
  if (mode === 'ramp') {
    const [a, b] = Array.isArray(value) ? [num(value[0], 100), num(value[1], num(value[0], 100))] : [num(value, 100), num(value, 100)];
    let t0 = Infinity, t1 = -Infinity;
    for (const x of notes) { if (x.t < t0) t0 = x.t; if (x.t > t1) t1 = x.t; }
    f = x => (t1 > t0 ? a + (b - a) * (x.t - t0) / (t1 - t0) : a);
  } else {
    const k = num(value, mode === 'add' || mode === 'random' ? 0 : 100), rnd = seed == null ? Math.random : mulberry32(num(seed, 1));
    f = mode === 'scale' ? x => x.v * k / 100
      : mode === 'add' ? x => x.v + k
      : mode === 'compress' ? x => 64 + (x.v - 64) * k / 100
      : mode === 'random' ? x => x.v + (rnd() * 2 - 1) * k
      : () => k;
  }
  for (const x of notes) x.v = clamp(R(f(x)), 1, 127);
  return notes;
}
export function legato(notes, { gap = 0 } = {}) {
  gap = R(num(gap, 0));
  const st = [...new Set(notes.map(x => x.t))].sort((a, b) => a - b);
  for (const x of notes) {
    let lo = 0, hi = st.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (st[m] <= x.t) lo = m + 1; else hi = m; }
    if (lo < st.length) x.d = Math.max(1, st[lo] - x.t - gap);
  }
  return notes;
}
export function setLength(notes, d) {
  d = clamp(R(num(d, PPQ / 4)), 1, MAXT);
  for (const x of notes) x.d = d;
  return notes;
}
export function scaleTime(notes, factor, anchor) {
  factor = num(factor, 1);
  if (!(factor > 0) || !notes.length) return notes;
  anchor = num(anchor, NaN);
  if (Number.isNaN(anchor)) anchor = notes.reduce((a, x) => (x.t < a ? x.t : a), Infinity);   // no spread: large arrays overflow the stack
  for (const x of notes) { x.t = clamp(R(anchor + (x.t - anchor) * factor), 0, MAXT); x.d = Math.max(1, R(x.d * factor)); }
  return sortNotes(notes);
}
export function reverse(notes) {
  if (!notes.length) return notes;
  let a = Infinity, b = -Infinity;
  for (const x of notes) { if (x.t < a) a = x.t; if (x.t + x.d > b) b = x.t + x.d; }
  for (const x of notes) x.t = a + b - (x.t + x.d);
  return sortNotes(notes);
}
// Duplicates are removed from `notes` only. When `notes` is a selection or a copy, pass the track
// (or track.notes) as `pool` so they are also removed from the track: fixOverlaps(sel, track).
export function fixOverlaps(notes, pool = null) {
  if (isObj(pool) && Array.isArray(pool.notes)) pool = pool.notes;
  const by = new Map(), dead = new Set();
  for (const x of notes) { let g = by.get(x.n); if (!g) by.set(x.n, g = []); g.push(x); }
  for (const g of by.values()) {
    g.sort((a, b) => a.t - b.t || b.d - a.d);
    let prev = null;
    for (const x of g) {
      if (prev && x.t === prev.t) { dead.add(x); continue; }
      if (prev && prev.t + prev.d > x.t) prev.d = x.t - prev.t;
      prev = x;
    }
  }
  if (dead.size) {
    keep(notes, x => !dead.has(x));
    if (Array.isArray(pool) && pool !== notes) keep(pool, x => !dead.has(x));
  }
  return sortNotes(notes);
}
// returns the new right-hand parts; the caller adds them to the track
export function splitAt(notes, tick) {
  tick = R(num(tick, 0));
  const out = [];
  for (const x of notes) {
    if (x.t < tick && x.t + x.d > tick) { out.push({ ...x, id: newId(), t: tick, d: x.t + x.d - tick }); x.d = tick - x.t; }
  }
  return out;
}

/* --------------------------------------------------------- clipboard */
export function copyNotes(notes) {
  const s = sortNotes([...notes]), base = s.length ? s[0].t : 0;
  return { kind: 'notes', base, notes: s.map(x => ({ t: x.t - base, d: x.d, n: x.n, v: x.v })) };
}
function clipNotes(clip) {
  if (!isObj(clip)) return [];
  if (Array.isArray(clip.notes)) return clip.notes;
  if (isObj(clip.tracks)) { const f = Object.values(clip.tracks).find(v => isObj(v) && Array.isArray(v.notes) && v.notes.length); return f ? f.notes : []; }
  return [];
}
export function pasteNotes(track, clip, at) {
  if (at == null) at = isObj(clip) ? num(clip.base, 0) : 0;
  at = clamp(R(num(at, 0)), 0, MAXT);
  const out = [];
  for (const x of clipNotes(clip)) { const c = mkNote(x, at); if (c) out.push(c); }
  for (const c of out) track.notes.push(c);
  sortNotes(track.notes);
  return out;
}
const span = (start, end) => [Math.max(0, R(num(start, 0))), R(num(end, 0))];
// Controller state just before tick t, per CC_KINDS index (0 = neutral when no earlier event).
// Range edits use it so a sustain/bend/wheel/aftertouch change is never cut off at a range edge.
function ccAt(cc, t) {
  const v = [0, 0, 0, 0], at = [-1, -1, -1, -1];
  for (const c of cc) { const i = CC_KINDS.indexOf(c.k); if (i >= 0 && c.t < t && c.t >= at[i]) { v[i] = c.v; at[i] = c.t; } }
  return v;
}
const ccHas = (cc, k, t) => cc.some(c => c.t === t && c.k === k);
export function copyRange(project, start, end, trackIds = null) {
  [start, end] = span(start, end);
  const clip = { kind: 'range', len: Math.max(0, end - start), tracks: {} };
  for (const tr of pickTracks(project, trackIds)) {
    // the clip opens with the state at `start` of every controller kind the track uses
    const s0 = ccAt(tr.cc, start), used = new Set(tr.cc.map(c => c.k)), cc = [];
    CC_KINDS.forEach((k, i) => { if (used.has(k) && !ccHas(tr.cc, k, start)) cc.push({ t: 0, k, v: s0[i] }); });
    for (const c of tr.cc) if (c.t >= start && c.t < end) cc.push({ t: c.t - start, k: c.k, v: c.v });
    clip.tracks[tr.id] = {
      notes: tr.notes.filter(x => x.t >= start && x.t < end).map(x => ({ t: x.t - start, d: Math.min(x.d, end - x.t), n: x.n, v: x.v })),
      cc,
    };
  }
  return clip;
}
// Removed controller events: where the state at `end` differed from the state before `start`,
// that end state is written at `start`, so everything outside the range keeps its controller state.
export function clearRange(project, start, end, trackIds = null) {
  [start, end] = span(start, end);
  if (!(end > start)) return 0;
  let n = 0;
  for (const tr of pickTracks(project, trackIds)) {
    n += keep(tr.notes, x => x.t < start || x.t >= end);
    const a = ccAt(tr.cc, start), b = ccAt(tr.cc, end), seam = [];
    CC_KINDS.forEach((k, i) => { if (a[i] !== b[i] && !ccHas(tr.cc, k, end)) seam.push({ t: start, k, v: b[i] }); });
    n += keep(tr.cc, c => c.t < start || c.t >= end);
    if (seam.length) { for (const c of seam) tr.cc.push(c); sortCC(tr.cc); }
  }
  return n;
}
export function deleteTime(project, start, end, trackIds = null) {
  [start, end] = span(start, end);
  const len = end - start;
  if (!(len > 0)) return 0;
  const n = clearRange(project, start, end, trackIds);
  for (const tr of pickTracks(project, trackIds)) {
    for (const x of tr.notes) {
      if (x.t >= end) x.t -= len;
      else if (x.t + x.d > start) x.d = Math.max(1, x.d - (Math.min(x.t + x.d, end) - start));   // straddles start: remove the deleted part
    }
    for (const c of tr.cc) if (c.t >= end) c.t -= len;
    sortNotes(tr.notes); sortCC(tr.cc);
  }
  if (allTracks(project, trackIds)) {
    const L = project.loop, mv = p => (p >= end ? p - len : p > start ? start : p);
    L.start = mv(L.start); L.end = mv(L.end);
    if (L.end <= L.start) L.end = L.start + barTicks(project);
  }
  project.bars = clamp(Math.max(project.bars, Math.ceil(contentEnd(project) / barTicks(project))), 1, MAXBARS);
  return n;
}
export function insertTime(project, at, len, trackIds = null) {
  at = Math.max(0, R(num(at, 0))); len = R(num(len, 0));
  if (!(len > 0)) return 0;
  let n = 0;
  for (const tr of pickTracks(project, trackIds)) {
    for (const x of tr.notes) if (x.t >= at) { x.t = Math.min(MAXT, x.t + len); n++; }
    for (const c of tr.cc) if (c.t >= at) { c.t = Math.min(MAXT, c.t + len); n++; }
    sortNotes(tr.notes); sortCC(tr.cc);
  }
  project.bars = clamp(project.bars + Math.ceil(len / barTicks(project)), 1, MAXBARS);
  if (allTracks(project, trackIds)) {
    const L = project.loop;
    if (L.start >= at) L.start += len;
    if (L.end > at) L.end += len;
  }
  return n;
}
// opts.to: paste a single-track clip into this track id instead of its source track.
// insert: time is inserted on ALL tracks (keeps them aligned), as insertTime(project, at, clip.len).
// After merging controller events, each target track's own controller state is restored at at + len.
export function pasteRange(project, clip, at, { insert = false, to = null } = {}) {
  if (!isObj(clip) || !isObj(clip.tracks)) return 0;
  at = clamp(R(num(at, 0)), 0, MAXT);
  let src = Object.keys(clip.tracks).filter(id => id !== '__proto__' && isObj(clip.tracks[id]));
  const map = new Map(src.map(id => [id, id]));
  if (to != null && src.length === 1) map.set(src[0], to);
  src = src.filter(id => project.tracks.some(t => t.id === map.get(id)));
  if (!src.length) return 0;
  const len = clamp(R(num(clip.len, 0)), 0, MAXT), e = Math.min(MAXT, at + len);
  if (insert && len > 0) insertTime(project, at, len);
  let count = 0, end = 0;
  for (const id of src) {
    const tr = findTrack(project, map.get(id)), c = clip.tracks[id];
    const before = e > at ? ccAt(tr.cc, e) : null;
    let nc = 0;
    for (const x of Array.isArray(c.notes) ? c.notes : []) { const o = mkNote(x, at); if (o) { tr.notes.push(o); count++; end = Math.max(end, o.t + o.d); } }
    for (const x of Array.isArray(c.cc) ? c.cc : []) { const o = mkCC(x, at); if (o) { tr.cc.push(o); count++; nc++; end = Math.max(end, o.t + 1); } }
    sortNotes(tr.notes); sortCC(tr.cc);
    if (before && nc) {
      const after = ccAt(tr.cc, e); let add = false;
      CC_KINDS.forEach((k, i) => { if (after[i] !== before[i] && !ccHas(tr.cc, k, e)) { tr.cc.push({ t: e, k, v: before[i] }); add = true; } });
      if (add) sortCC(tr.cc);
    }
  }
  project.bars = clamp(Math.max(project.bars, Math.ceil(end / barTicks(project))), 1, MAXBARS);
  return count;
}
export function duplicateRange(project, start, end, trackIds = null) {
  [start, end] = span(start, end);
  if (!(end > start)) return 0;
  const clip = copyRange(project, start, end, trackIds);
  insertTime(project, end, end - start, trackIds);
  return pasteRange(project, clip, end);
}

/* ----------------------------------------------------------- history */
// Snapshots are stored per track ({ m: project JSON without tracks, t: [track JSON] }) and every string is
// interned in a ref-counted pool, so tracks an edit didn't touch are shared between snapshots.
// `maxChars` caps the pool (oldest snapshots are dropped first; one undo and one redo level always kept).
const snapSame = (a, b) => a.m === b.m && (a.t === b.t || (!!a.t && !!b.t && a.t.length === b.t.length && a.t.every((s, i) => s === b.t[i])));
export class History {
  constructor(limit = 200, maxChars = 64e6) {
    this.limit = Math.max(1, R(num(limit, 200))); this.max = Math.max(0, num(maxChars, 64e6));
    this.u = []; this.r = []; this.pool = new Map(); this.size = 0; this.noop = false;
  }
  _snap(project) {
    const js = x => { const s = JSON.stringify(x); return s === undefined ? 'null' : s; };
    if (!isObj(project) || !Array.isArray(project.tracks)) return { m: js(project), t: null };
    const { tracks, ...rest } = project;
    return { m: js(rest), t: Array.from(tracks, js) };
  }
  _ref(s) {
    let e = this.pool.get(s);
    if (!e) { this.pool.set(s, e = { s, n: 0 }); this.size += s.length; }
    e.n++; return e.s;
  }
  _unref(s) { const e = this.pool.get(s); if (e && !--e.n) { this.pool.delete(s); this.size -= s.length; } }
  // meta: a step's own data (a caller sets entry.meta after record), carried with its label across undo / redo
  _hold(sn, label, meta) { const e = { m: this._ref(sn.m), t: sn.t && sn.t.map(s => this._ref(s)), label }; if (meta !== undefined) e.meta = meta; return e; }
  _drop(e) { this._unref(e.m); if (e.t) for (const s of e.t) this._unref(s); }
  _load(e) { const p = JSON.parse(e.m); if (e.t) p.tracks = e.t.map(s => JSON.parse(s)); return p; }
  _trim() {
    while (this.u.length > this.limit) this._drop(this.u.shift());
    while (this.size > this.max) {
      if (this.u.length > 1) this._drop(this.u.shift());
      else if (this.r.length > 1) this._drop(this.r.shift());
      else break;
    }
  }
  record(project, label = '') {
    const sn = this._snap(project), top = this.u[this.u.length - 1];
    for (const e of this.r) this._drop(e);
    this.r.length = 0;
    if (top && snapSame(top, sn)) return false;
    this.u.push(this._hold(sn, label));
    this._trim();
    return true;
  }
  // A step carrying meta is never skipped as a no-op: what it did lives partly outside the snapshot (a canvas cable's
  // Serum fields, written back from its meta — knob tweaks are kept across undo), so a step another undo already reverted
  // there looks like nothing; the ↶ that names it consumes it alone (this.noop says so) instead of undoing the step
  // before it (canvas milestone 3, review 1 F3)
  undo(project) {
    const cur = this._snap(project);
    while (this.u.length && this.u[this.u.length - 1].meta === undefined && snapSame(this.u[this.u.length - 1], cur)) this._drop(this.u.pop());   // skip snapshots of edits that changed nothing
    if (!this.u.length) return null;
    const e = this.u.pop(), out = this._load(e);
    this.noop = e.meta !== undefined && snapSame(e, cur);
    this.r.push(this._hold(cur, e.label, e.meta)); this._drop(e);
    this._trim();
    return out;
  }
  redo(project) {
    const cur = this._snap(project);
    while (this.r.length && this.r[this.r.length - 1].meta === undefined && snapSame(this.r[this.r.length - 1], cur)) this._drop(this.r.pop());
    if (!this.r.length) return null;
    const e = this.r.pop(), out = this._load(e);
    this.noop = e.meta !== undefined && snapSame(e, cur);
    this.u.push(this._hold(cur, e.label, e.meta)); this._drop(e);
    this._trim();
    return out;
  }
  // drops the newest steps equal to project (edits that changed nothing: a refusal after record); how many
  prune(project) {
    const cur = this._snap(project);
    let n = 0;
    while (this.u.length && snapSame(this.u[this.u.length - 1], cur)) { this._drop(this.u.pop()); n++; }
    return n;
  }
  // canUndo/canRedo only look at the stacks: right after record() the top snapshot may turn out to be a
  // no-op (the edit changed nothing), and undo() then returns null. The *From(project) forms are exact.
  get canUndo() { return this.u.length > 0; }
  get canRedo() { return this.r.length > 0; }
  canUndoFrom(project) { return this._can(this.u, project); }
  canRedoFrom(project) { return this._can(this.r, project); }
  _can(st, project) {
    const n = st.length;
    if (n > 1 && !snapSame(st[n - 1], st[n - 2])) return true;   // cheap: two different states can't both equal the current one
    if (!n) return false;
    const cur = this._snap(project);
    return st.some(e => e.meta !== undefined || !snapSame(e, cur));   // (a meta step is never skipped: undo / redo takes it)
  }
  get undoLabel() { return this.u.length ? this.u[this.u.length - 1].label : ''; }
  get redoLabel() { return this.r.length ? this.r[this.r.length - 1].label : ''; }
  clear() { this.u.length = 0; this.r.length = 0; this.pool.clear(); this.size = 0; }
}

/* ------------------------------------------------------- persistence */
export function serialize(project) { return JSON.stringify(project); }

// SYNTH Canvas stage 1b (SPEC-canvas §5.1, IMPL-1b §4.9): a track's module layout, view only (never compiled, never in
// presets): { [module id]: { x, y, fold?: 1, z?, ui?: 'flow' } } in world px. Invalid entries are dropped; nothing valid →
// undefined (deserialize then adds no key: an old track's History snapshot stays byte-identical). A width (w, from before
// the no-resizing rule of 2026-10-18) is dropped: every module has one fixed width now; no schema bump.
// Milestone 3 (schema 7, IMPL-3 §3): a Serum's parts are modules 'iN/<part>' (serum-core module names: 'oscA', 'filter2' —
// the key's second part as PORT_ID's), up to LAY_MAX entries (a Serum in parts is up to 25 modules; a patch's modules are '<dev>/<mid>' keys), and a Serum's entry
// may say ui 'parts' (its parts view; absent = the whole panel, as 'flow' marks a classic's Simple layout)
// IMPL-P §3.1: the bounds below are safety bounds against a corrupt or hostile file, not product caps — a person adds until their system lags (9dde7e6: 64 devices,
// 256 wires / mod rows / layout entries; a track's 65th device was dropped silently at the next load). LAY_MAX holds 512 patch modules + 1024 devices + a Serum's parts.
export const DEV_MAX = 1024, WIRE_MAX = 4096, MODROW_MAX = 4096, LAY_MAX = 4096;
const LAY_KEY = /^[a-z][a-z0-9]{0,15}(\/[a-z][a-zA-Z0-9]{0,15})?$/, LAY_UI = ['flow', 'parts'];
const finN = x => typeof x === 'number' && Number.isFinite(x);
export function normLay(lay) {
  if (!isObj(lay)) return undefined;
  const out = {};
  let n = 0;
  for (const k of Object.keys(lay)) {
    if (n >= LAY_MAX) break;
    const e = lay[k];
    if (k === '__proto__' || !LAY_KEY.test(k) || !isObj(e) || !finN(e.x) || !finN(e.y)) continue;
    const o = { x: clamp(R(e.x), -1e6, 1e6), y: clamp(R(e.y), -1e6, 1e6) };
    if (e.fold) o.fold = 1;
    if (finN(e.z)) o.z = clamp(R(e.z), 1, 1e6);
    if (LAY_UI.includes(e.ui)) o.ui = e.ui; // a classic instrument's Simple layout (IMPL-panels §7.1; absent = Hardware), a Serum's parts view (schema 7); view only
    if (e.auto) o.auto = 1; // a Serum part's place written by the rule, not the user (a load prunes it once the part is off and unread; IMPL-3 §3)
    out[k] = o; n++;
  }
  return n ? out : undefined;
}

// SYNTH Canvas stage 1c (SPEC-canvas §5.1, §5.4): a v2 track's devices and cables. Plain data, validated like the v1
// fields they replace (an instrument's vals as v1 vals; its seq / fx and a panel's fx as they were read before: raw, the
// page normalises them); the primary must be an instrument; stage 1e (schema 4) keeps an instrument's on / solo / zone /
// name and a cable's level g (0…4; 1 = absent). Nothing valid → null (the track is read as v1: a file's
// mirror, else the defaults). The in-memory accessors are cv-model.js adopt's (the page), never song.js's.
// Stage 2a (schema 5, IMPL-2a §2.3): the track's mod cables `mods` (normMods) and the next row number `mid` (absent when
// the track never had one: an old track's record and History snapshot stay byte-identical).
// Stage 7a (IMPL-7a §6, schema 8): a drum machine (a model drum-core has a personality for: tr808; 7b, schema 9: tr606; 7c, schema 10: tr909; stage 8, schema 11: sdsv) keeps
// its device's `drum` — the pattern memory, panel state, extras, note map and sample slots — as normDrum(d, model) bounds it
// (exact lengths, every field in range, unknown ones dropped; idempotent); `drum` on any other model's device is dropped.
export const isDrum = m => typeof m === 'string' && Object.prototype.hasOwnProperty.call(PERS, m);
const DEV_ID = /^[a-z][a-z0-9]{0,15}$/, PORT_ID = /^[a-z][a-z0-9]{0,15}(\/[a-z][a-zA-Z0-9]{0,15})?\.[a-z][a-z0-9]{0,7}$/;
export function normDev(r) {
  if (!isObj(r) || !isObj(r.dev)) return null;
  const dev = {};
  let n = 0, top = 0;
  for (const k of Object.keys(r.dev)) {
    if (n >= DEV_MAX) break;
    const d = r.dev[k];
    if (k === '__proto__' || !DEV_ID.test(k) || !isObj(d) || typeof d.kind !== 'string' || !/^[a-z]{1,12}$/.test(d.kind)) continue;
    let o;
    if (d.kind === 'synth') {
      o = { kind: 'synth', model: typeof d.model === 'string' && /^[\w-]{1,32}$/.test(d.model) ? d.model : 'minimoog', vals: isObj(d.vals) ? plain(d.vals) : {}, preset: str(d.preset, null, 100) };
      if (isObj(d.seq) && Array.isArray(d.seq.pat)) o.seq = d.seq;
      if (isObj(d.fx)) o.fx = d.fx;
      if (d.on === false) o.on = false;
      if (d.solo === true) o.solo = true; // (stage 1e: solo in track, the key zone — absent = 0…127, no transpose)
      const z = isObj(d.zone) ? { lo: clamp(R(num(d.zone.lo, 0)), 0, 127), hi: clamp(R(num(d.zone.hi, 127)), 0, 127), xp: clamp(R(num(d.zone.xp, 0)), -48, 48) } : null;
      if (z && z.lo > z.hi) [z.lo, z.hi] = [z.hi, z.lo];
      if (z && (z.lo !== 0 || z.hi !== 127 || z.xp !== 0)) o.zone = z;
      if (typeof d.name === 'string' && d.name) o.name = str(d.name, null, 100);
      if (typeof d.fxId === 'string' && /^fx\d{1,6}$/.test(d.fxId)) o.fxId = d.fxId; // (a Serum's folded-in panel id, cv-model reshape)
      if (isDrum(o.model) && d.drum != null) o.drum = normDrum(d.drum, o.model); // (7a: a drum machine's memory, map, slots — IMPL-7a §6; another model's is dropped; 7b: by the model's own record shape)
      if (isPatchModel(o.model) && d.patch != null) o.patch = normPatch(d.patch, familyOf(o.model)); // (9, schema 12: a patchable instrument's modules and cords — IMPL-9 §1.2, §1.6; another model's is dropped. vals.p's orphans are pruned at load by the host, never here: an undo restores snapshots through this reader and must find them, §1.5)
    } else if (d.kind === 'panel') {
      o = { kind: 'panel' };
      if (isObj(d.fx)) o.fx = d.fx;
      if (typeof d.name === 'string' && d.name) o.name = str(d.name, null, 100);
    } else if (d.kind === 'out') o = { kind: 'out' };
    else o = normModDev(d); // (the modulator modules, 2a / 2b: their states bounded; an unknown kind: plain data)
    dev[k] = o; n++;
    const m = /(\d+)$/.exec(k); if (m) top = Math.max(top, +m[1]);
  }
  const ins = Object.keys(dev).filter(k => dev[k].kind === 'synth');
  if (!ins.length) return null;
  const prim = typeof r.prim === 'string' && dev[r.prim] && dev[r.prim].kind === 'synth' ? r.prim : ins[0];
  const wires = [], wids = new Set();
  for (const w of Array.isArray(r.wires) ? r.wires.slice(0, WIRE_MAX) : []) {
    if (!isObj(w) || typeof w.a !== 'string' || typeof w.b !== 'string' || !PORT_ID.test(w.a) || !PORT_ID.test(w.b)) continue;
    let id = typeof w.id === 'string' && /^w\d{1,6}$/.test(w.id) && !wids.has(w.id) ? w.id : '';
    for (let i = 1; !id; i++) if (!wids.has('w' + i)) id = 'w' + i;
    wids.add(id);
    const o = { id, a: w.a, b: w.b };
    if (typeof w.g === 'number' && Number.isFinite(w.g) && w.g !== 1) o.g = clamp(w.g, 0, 4);
    wires.push(o);
  }
  const out = { prim, nid: clamp(Math.max(R(num(r.nid, 1)), top + 1), 1, 1e6), dev, wires }, mods = normMods(r.mods);
  if (mods.length) out.mods = mods;
  if (mods.length || (finN(r.mid) && r.mid >= 1)) out.mid = clamp(Math.max(R(num(r.mid, 1)), ...mods.map(x => +x.id.slice(1) + 1), 1), 1, 1e6);
  return out;
}
// Stage 2b (IMPL-2b §1.1, §1.4): a modulator module's device record, its state bounded — lfo { kind, lfo: normLfo's
// object, rate, rise, delay, smooth, phase } (serum-core normLfoMod), env { kind, env: { bpm, legInv, stealRe }, att, hold,
// dec, sus, rel, crv: [a, d, r], start, end } (normEnvMod), chaos { kind, chaos: { mono, sh }, rate, bpm, smooth }
// (normChaosMod), macro { kind, v: [8 × 0…1], names: [8 strings ≤ 16; blank → 'Macro n'] }, cc { kind, cc: 0…127, ch: 0 (omni) … 16, v:
// 0…1 }, note / velo / at / bend { kind }; a name (≤ 32) is kept on any of them; an unknown kind stays plain data (a later
// stage's module reads as it was saved)
const MOD_KINDS = ['lfo', 'env', 'macro', 'cc', 'chaos', 'note', 'velo', 'at', 'bend'];
export function normModDev(d) {
  if (!isObj(d) || typeof d.kind !== 'string') return null;
  if (!MOD_KINDS.includes(d.kind)) return Object.assign(plain(d), { kind: d.kind });
  const o = { kind: d.kind }, v01 = x => clamp(num(x, 0), 0, 1);
  if (d.kind === 'lfo') Object.assign(o, normLfoMod(d));
  else if (d.kind === 'env') Object.assign(o, normEnvMod(d));
  else if (d.kind === 'chaos') Object.assign(o, normChaosMod(d));
  else if (d.kind === 'macro') {
    const v = Array.isArray(d.v) ? d.v : [], nm = Array.isArray(d.names) ? d.names : [];
    o.v = Array.from({ length: 8 }, (_, k) => v01(v[k]));
    o.names = Array.from({ length: 8 }, (_, k) => (typeof nm[k] === 'string' && nm[k].trim() ? nm[k].slice(0, 16) : 'Macro ' + (k + 1))); // (an unnamed knob: the default name, review U8)
  } else if (d.kind === 'cc') { o.cc = clamp(R(num(d.cc, 1)), 0, 127); o.ch = clamp(R(num(d.ch, 0)), 0, 16); o.v = v01(d.v); }
  if (typeof d.name === 'string' && d.name) o.name = str(d.name, null, 32);
  return o;
}
// Stage 2a: a track's mod cables (SPEC-canvas §5.1, IMPL-2a §1): { id: 'r<n>', src, dst, then serum-core normRow's fields in
// its order and by its rules (amt / curve / acurve −1…1, out / rise / fall 0…1 (fall = rise when slink), bits, crv: ≤ 64
// points [x, y, c] repaired as normRow's normPts, or null) }. src 'wheel' or '<device>.<port>', dst '<device>:<param>',
// aux '' or a source id; ids unique; at most MODROW_MAX (4096) rows; a row failing any check is dropped. (Which sources, devices and
// params exist — and Serum's own aux ids — the page checks: cv-model, cv-graph nativeRow.)
const MROW_ID = /^r\d{1,6}$/, MSRC = /^(wheel|[a-z][a-z0-9]{0,15}(\/[a-z][a-zA-Z0-9]{0,15})?\.[a-z][a-z0-9]{0,7})$/;
const MDST = /^[a-z][a-z0-9]{0,15}:[A-Za-z][\w.]{0,47}$/, MAUX = /^[a-z][a-z0-9]{0,15}$/;
const fn = (x, d, a, b) => (finN(x) ? clamp(x, a, b) + 0 : d), bitOf = (x, d) => (typeof x === 'boolean' ? (x ? 1 : 0) : finN(x) ? (x >= 0.5 ? 1 : 0) : d);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
function crvOf(raw) { // (= serum-core normPts(raw, null, false, 64))
  if (!Array.isArray(raw)) return null;
  let out = [];
  for (let i = 0, n = Math.min(raw.length, 65536); i < n; i++) {
    const q = raw[i];
    if (!Array.isArray(q) || !finN(q[0]) || !finN(q[1])) continue;
    out.push([r5(clamp(q[0], 0, 1)), r5(clamp(q[1], 0, 1)), finN(q[2]) ? r5(clamp(q[2], -1, 1)) : 0]);
  }
  if (!out.length) return null;
  out.sort((a, b) => a[0] - b[0]);
  if (out.length > 64) out = out.slice(0, 64);
  if (out.length === 1) out.push([1, out[0][1], 0]);
  out[0][0] = 0; out[out.length - 1][0] = 1;
  return out;
}
export function normMods(list) {
  const out = [], ids = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (out.length >= MODROW_MAX) break;
    if (!isObj(r) || typeof r.id !== 'string' || !MROW_ID.test(r.id) || ids.has(r.id) || typeof r.src !== 'string' || !MSRC.test(r.src)
      || typeof r.dst !== 'string' || !MDST.test(r.dst)) continue;
    const aux = r.aux === undefined || r.aux === null ? '' : r.aux;
    if (typeof aux !== 'string' || (aux && !MAUX.test(aux))) continue;
    const rise = fn(r.rise, 0, 0, 1), slink = bitOf(r.slink, 0);
    ids.add(r.id);
    out.push({ id: r.id, src: r.src, dst: r.dst, amt: fn(r.amt, 0, -1, 1), bi: bitOf(r.bi, 0), curve: fn(r.curve, 0, -1, 1), aux, inv: bitOf(r.inv, 0),
      byp: bitOf(r.byp, 0), out: fn(r.out, 1, 0, 1), acurve: fn(r.acurve, 0, -1, 1), crv: crvOf(r.crv), rise, fall: slink ? rise : fn(r.fall, 0, 0, 1), slink });
  }
  return out;
}
// Stage 2a: project.perf, the project's performance modules (D9): { wheel: { v: 1 } | null } — anything else null
export const normPerf = x => ({ wheel: isObj(x) && isObj(x.wheel) ? { v: 1 } : null });

export function deserialize(json) {
  let o = json;
  if (typeof json === 'string') {
    try { o = JSON.parse(json); } catch { throw new Error('Not a valid project file'); }
  }
  if (!isObj(o) || (!Array.isArray(o.tracks) && o.version == null)) throw new Error('Not a SYNTH project');
  const sg = Array.isArray(o.sig) ? o.sig : [];
  const sd = num(sg[1], 4);
  const p = {
    version: 1, name: str(o.name, 'Untitled'), bpm: clamp(num(o.bpm, 120), 20, 300),
    sig: [clamp(R(num(sg[0], 4)), 1, 16), SIG_DEN.includes(sd) ? sd : 4],
    bars: clamp(R(num(o.bars, 16)), 1, MAXBARS),
    loop: null, metronome: null, rec: null, snap: 0, quantize: null, selTrack: null, tracks: [],
  };
  const bt = barTicks(p), L = isObj(o.loop) ? o.loop : {};
  const ls = clamp(R(num(L.start, 0)), 0, MAXT);
  let le = clamp(R(num(L.end, ls + bt * 4)), 0, MAXT + bt);
  if (le <= ls) le = ls + bt;
  p.loop = { on: bool(L.on, true), start: ls, end: le };
  const M = isObj(o.metronome) ? o.metronome : {};
  p.metronome = { on: bool(M.on, true), countIn: clamp(R(num(M.countIn, 1)), 0, 2), vol: clamp(num(M.vol, 0.6), 0, 1) };
  const RC = isObj(o.rec) ? o.rec : {};
  p.rec = { mode: RC.mode === 'replace' ? 'replace' : 'overdub', inputQuantize: bool(RC.inputQuantize, false) };
  p.snap = clamp(R(num(o.snap, PPQ / 4)), 0, PPQ * 16);
  const Q = isObj(o.quantize) ? o.quantize : {}, qg = num(Q.grid, PPQ / 4);
  p.quantize = {
    grid: qg >= 1 ? clamp(R(qg), 1, PPQ * 16) : PPQ / 4, strength: clamp(num(Q.strength, 100), 0, 100), swing: clamp(num(Q.swing, 0), 0, 100),
    starts: bool(Q.starts, true), ends: bool(Q.ends, false),
  };
  const raws = (Array.isArray(o.tracks) ? o.tracks : []).filter(isObj);
  const taken = new Set(), ids = raws.map(r => { const ok = validId(r.id) && !taken.has(r.id); if (ok) taken.add(r.id); return ok ? r.id : null; });
  let k = maxTrk(taken);
  raws.forEach((r, i) => {
    let id = ids[i];
    if (!id) { do k++; while (taken.has('trk_' + k)); id = 'trk_' + k; taken.add(id); }
    const notes = [], cc = [];
    if (Array.isArray(r.notes)) for (const x of r.notes) { const c = mkNote(x); if (c) notes.push(c); }
    if (Array.isArray(r.cc)) for (const x of r.cc) { const c = mkCC(x); if (c) cc.push(c); }
    const v2 = normDev(r); // (canvas stage 1c: the instrument lives in dev; a file's v1 mirror is then ignored)
    const tr = {
      id, name: str(r.name, 'Track ' + (i + 1), 100),
      color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : TRACK_COLORS[i % TRACK_COLORS.length],
      model: typeof r.model === 'string' && /^[\w-]{1,32}$/.test(r.model) ? r.model : 'minimoog',
      vals: isObj(r.vals) ? plain(r.vals) : {}, preset: str(r.preset, null, 100),
      ch: clamp(R(num(r.ch, 0)), 0, 16), mute: bool(r.mute, false), solo: bool(r.solo, false), arm: bool(r.arm, false),
      vol: clamp(num(r.vol, 0.8), 0, 1.25), pan: clamp(num(r.pan, 0), -1, 1),
      notes: sortNotes(notes), cc: sortCC(cc),
    };
    if (v2) { delete tr.model; delete tr.vals; delete tr.preset; }
    const lay = normLay(r.lay); // (canvas stage 1b; absent = Tidy)
    if (lay) tr.lay = lay;
    if (v2) Object.assign(tr, v2);
    p.tracks.push(tr);
  });
  if (!p.tracks.length) p.tracks.push(newTrack(p));
  p.selTrack = p.tracks.some(t => t.id === o.selTrack) ? o.selTrack : p.tracks[0].id;
  if (isObj(o.perf)) p.perf = normPerf(o.perf); // (stage 2a; absent: no key, an old project reads as before)
  if (Array.isArray(o.pads)) p.pads = normPads(o.pads); // (stage 8, schema 11: the Pads modules, bounded by pads-core; absent: no key, a project without them reads as before)
  return p;
}

/* ------------------------------------------------ Standard MIDI File */
const AUTO_CH = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
let DRUM_KEYS = null; // (7a: the default note map's 128-entry table, made at the first channel-10 import)
function vlq(out, n) {
  n = clamp(R(n), 0, MAXT);
  const b = [n & 0x7f];
  while ((n >>>= 7)) b.unshift((n & 0x7f) | 0x80);
  for (const x of b) out.push(x);
}
function metaEv(type, data) { const o = [0xFF, type]; vlq(o, data.length); for (const x of data) o.push(x); return o; }
const utf8 = s => [...new TextEncoder().encode(String(s || '').slice(0, 256))];
function trackChunk(evs, endT = 0) {
  const out = [];
  let last = 0;
  for (const e of evs) { vlq(out, e.t - last); last = e.t; for (const x of e.b) out.push(x); }
  vlq(out, Math.max(0, endT - last)); out.push(0xFF, 0x2F, 0x00);
  return chunk('MTrk', out);
}
function chunk(id, data) {
  const n = data.length;
  return [...id].map(c => c.charCodeAt(0)).concat([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255], data);
}
function ccBytes(c, ch) {
  const v = num(c.v, 0);
  if (c.k === 'wheel') return [0xB0 | ch, 1, clamp(R(v * 127), 0, 127)];
  if (c.k === 'sus') return [0xB0 | ch, 64, v >= 0.5 ? 127 : 0];
  if (c.k === 'at') return [0xD0 | ch, clamp(R(v * 127), 0, 127)];
  const b = clamp(8192 + R(v >= 0 ? v * 8191 : v * 8192), 0, 16383);
  return [0xE0 | ch, b & 127, b >> 7];
}
// One MIDI channel can't express two overlapping notes of the same pitch (readers pair note-offs FIFO and
// would swap their lengths). Works on copies and matches the engine's song playback, where a new note of a
// sounding pitch takes it over: the earlier note ends where the later one starts; exact duplicates (same
// start) collapse into the longest one.
function midiNotes(notes) {
  const by = new Map(), out = [];
  for (const x of notes) {
    const t = clamp(R(x.t), 0, MAXT), n = clamp(R(x.n), 0, 127);
    const o = { t, e: Math.min(MAXT, t + Math.max(1, R(x.d))), n, v: clamp(R(x.v), 1, 127) };
    let g = by.get(n); if (!g) by.set(n, g = []); g.push(o);
  }
  for (const g of by.values()) {
    g.sort((a, b) => a.t - b.t || b.e - a.e);
    let prev = null;
    for (const o of g) {
      if (prev && o.t === prev.t) continue;
      if (prev && prev.e > o.t) prev.e = o.t;
      out.push(prev = o);
    }
  }
  return out;
}
// the instrument name a track's MIDI file chunk carries: its primary instrument's model (cv-model instOf's rule — the prim
// device, else the first instrument; song.js cannot import cv-model); a track without devices (main's): its own
function instModel(tr) {
  const D = isObj(tr.dev) ? tr.dev : null, d = D ? (isObj(D[tr.prim]) && D[tr.prim].kind === 'synth' ? D[tr.prim] : Object.values(D).find(x => isObj(x) && x.kind === 'synth')) : tr;
  return d && typeof d.model === 'string' ? d.model : '';
}
// 7a (IMPL-7a §4.5): a drum machine's track on omni goes out on channel 10 (AUTO_CH never hands it to another track); a
// channel-10 track of a file comes in as a TR-808 track (`model: 'tr808'`, its notes as they are, `unmapped`: how many
// of them sit on keys the default map leaves silent — the importer's notice)
export function exportMIDI(project, { trackIds = null } = {}) {
  const trs = pickTracks(project, trackIds);
  const sn = clamp(R(project.sig[0]), 1, 255), sd = project.sig[1], us = clamp(R(60e6 / project.bpm), 1, 0xFFFFFF);
  const cond = [
    { t: 0, b: metaEv(0x03, utf8(project.name)) },
    { t: 0, b: [0xFF, 0x51, 3, us >> 16 & 255, us >> 8 & 255, us & 255] },
    { t: 0, b: [0xFF, 0x58, 4, sn, Math.round(Math.log2(sd)), clamp(R(96 / sd), 1, 255), 8] },
  ];
  const end = Math.min(MAXT, songEnd(project));
  const out = [chunk('MThd', [0, 1, (trs.length + 1) >> 8, (trs.length + 1) & 255, PPQ >> 8, PPQ & 255])];
  out.push(trackChunk(cond, end));
  trs.forEach((tr, i) => {
    const im = instModel(tr), ch = tr.ch >= 1 && tr.ch <= 16 ? tr.ch - 1 : isDrum(im) ? 9 : AUTO_CH[i % AUTO_CH.length];
    const evs = [{ t: 0, p: -1, b: metaEv(0x03, utf8(tr.name)) }, { t: 0, p: -1, b: metaEv(0x04, utf8(im)) }];
    for (const x of midiNotes(tr.notes)) evs.push({ t: x.t, p: 2, b: [0x90 | ch, x.n, x.v] }, { t: x.e, p: 0, b: [0x80 | ch, x.n, 64] });
    for (const c of tr.cc) evs.push({ t: clamp(R(c.t), 0, MAXT), p: 1, b: ccBytes(c, ch) });
    evs.sort((a, b) => a.t - b.t || a.p - b.p);
    out.push(trackChunk(evs));
  });
  const bytes = new Uint8Array(out.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of out) { bytes.set(c, o); o += c.length; }
  return bytes;
}

function text(d) {
  d = d.subarray(0, 256);
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(d); } catch { s = String.fromCharCode(...d); }
  return s.replace(/[\0-\x1f]/g, ' ').trim();
}
export function importMIDI(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Array.isArray(bytes) ? Uint8Array.from(bytes) : null;
  if (!b) throw new Error('No MIDI data');
  const s4 = i => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  const u32 = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u16 = i => (b[i] << 8) | b[i + 1];
  let pos = 0;
  if (b.length >= 12 && s4(0) === 'RIFF' && s4(8) === 'RMID') {   // RIFF-wrapped MIDI
    for (let i = 12; i + 8 <= b.length;) {
      const len = (b[i + 4] | b[i + 5] << 8 | b[i + 6] << 16 | b[i + 7] << 24) >>> 0;   // unsigned: a signed size could step i backwards forever
      if (s4(i) === 'data') { pos = i + 8; break; }
      if (len > b.length - i - 8) break;
      i += 8 + len + (len & 1);
    }
  }
  if (b.length < pos + 14 || s4(pos) !== 'MThd') {
    let i = pos; const lim = Math.min(b.length - 14, pos + 1024);
    while (i <= lim && s4(i) !== 'MThd') i++;
    if (i > lim) throw new Error('Not a Standard MIDI File');
    pos = i;
  }
  const fmt = u16(pos + 8), div = u16(pos + 12);
  if (div & 0x8000) throw new Error('SMPTE timing not supported');
  if (!div) throw new Error('Invalid MIDI time division');
  pos += 8 + Math.max(6, u32(pos + 4));
  const chunks = [];
  while (pos + 8 <= b.length) {
    const len = u32(pos + 4), s = pos + 8;
    if (s4(pos) === 'MTrk') chunks.push([s, Math.min(b.length, s + len)]);
    pos = s + len;
  }
  if (!chunks.length) throw new Error('MIDI file has no tracks');
  const sc = t => Math.min(MAXT, R(t * PPQ / div));
  let tempo = null, sig = null, name = '';
  const tracks = [];
  chunks.forEach(([s, e], ti) => {
    let p = s, t = 0, rs = 0, last = 0, tname = '', inst = '';
    const q = new Map(), byCh = new Map();
    const get = ch => { let o = byCh.get(ch); if (!o) byCh.set(ch, o = { raw: [], cc: [], prog: null }); return o; };
    const rd = () => {
      let v = 0, k = 0, c;
      do { if (p >= e) return -1; c = b[p++]; v = v * 128 + (c & 127); } while (c & 128 && ++k < 4);
      return v;
    };
    const off = (ch, n) => { const a = q.get(ch * 128 + n); if (a && a.length) { const o = a.shift(); get(ch).raw.push({ t0: o.t, t1: t, n, v: o.v }); } };
    while (p < e) {
      const dt = rd();
      if (dt < 0) break;
      t += dt;
      let st = b[p];
      if (st >= 0x80) p++;
      else if (rs) st = rs;
      else { p++; continue; }   // stray data byte without running status
      if (st === 0xFF) {
        if (p >= e) break;
        const ty = b[p++], len = rd();
        if (len < 0) break;
        const d = b.subarray(p, Math.min(e, p + len));
        p += len; last = t;
        if (ty === 0x2F) break;
        if (ty === 0x51 && d.length >= 3 && (!tempo || t < tempo.t)) tempo = { t, us: d[0] << 16 | d[1] << 8 | d[2] };
        else if (ty === 0x58 && d.length >= 2 && (!sig || t < sig.t)) sig = { t, n: d[0], d: 2 ** Math.min(d[1], 6) };
        else if (ty === 0x03 && !tname) tname = text(d);
        else if (ty === 0x04 && !inst) inst = text(d);
        continue;
      }
      if (st === 0xF0 || st === 0xF7) { const len = rd(); if (len < 0) break; p += len; last = t; continue; }
      if (st > 0xF0) { p += st === 0xF2 ? 2 : st === 0xF1 || st === 0xF3 ? 1 : 0; continue; }
      rs = st;
      const ty = st & 0xF0, ch = st & 15, two = ty !== 0xC0 && ty !== 0xD0;
      if (p + (two ? 2 : 1) > e) break;
      const d1 = b[p++] & 127, d2 = two ? b[p++] & 127 : 0;
      last = t;
      if (ty === 0x90 && d2 > 0) {
        const k = ch * 128 + d1; let a = q.get(k);
        if (!a) q.set(k, a = []);
        a.push({ t, v: d2 }); get(ch);
      } else if (ty === 0x80 || ty === 0x90) off(ch, d1);
      else if (ty === 0xB0) {
        if (d1 === 1) get(ch).cc.push({ t, k: 'wheel', v: d2 / 127 });
        else if (d1 === 64) get(ch).cc.push({ t, k: 'sus', v: d2 >= 64 ? 1 : 0 });
      } else if (ty === 0xE0) {
        const v = (d2 << 7 | d1) - 8192;
        get(ch).cc.push({ t, k: 'bend', v: v >= 0 ? Math.min(1, v / 8191) : v / 8192 });
      } else if (ty === 0xD0) get(ch).cc.push({ t, k: 'at', v: d1 / 127 });
      else if (ty === 0xC0) { const o = get(ch); if (o.prog == null) o.prog = d1; }
    }
    for (const [k, a] of q) for (const o of a) get(k >> 7).raw.push({ t0: o.t, t1: Math.max(last, o.t), n: k & 127, v: o.v });
    if (ti === 0) name = tname;
    const used = [...byCh].filter(([, o]) => o.raw.length || o.cc.length), split = used.length > 1 || fmt === 0;
    for (const [ch, o] of used) {
      const notes = sortNotes(o.raw.map(x => { const t0 = sc(x.t0); return { id: newId(), t: t0, d: Math.max(1, sc(x.t1) - t0), n: x.n, v: x.v }; }));
      const cc = sortCC(o.cc.map(c => ({ t: sc(c.t), k: c.k, v: c.v })));
      const nm = split ? (tname && fmt !== 0 ? `${tname} (Ch ${ch + 1})` : `Channel ${ch + 1}`) : tname || inst || `Track ${tracks.length + 1}`;
      const it = { name: nm, ch: ch + 1, inst, prog: o.prog, notes, cc };
      if (ch === 9) { const M = DRUM_KEYS || (DRUM_KEYS = mapTable(DEFAULT_MAP)); it.model = 'tr808'; it.unmapped = notes.filter(x => M[x.n] < 0).length; }
      tracks.push(it);
    }
  });
  const nearestDen = d => SIG_DEN.reduce((a, x) => (Math.abs(x - d) < Math.abs(a - d) ? x : a), 4);
  return {
    bpm: tempo && tempo.us > 0 ? clamp(+(60e6 / tempo.us).toFixed(3), 20, 300) : 120,
    sig: sig ? [clamp(sig.n, 1, 16), nearestDen(sig.d)] : [4, 4],
    name, tracks, format: fmt, division: div,
  };
}

/* -------------------------------------------------------- audio file */
export function encodeWAV(channels, sampleRate, bitDepth = 24) {
  const nc = channels ? channels.length : 0;
  if (!nc) throw new Error('No audio channels');
  const len = Math.max(...Array.from(channels, c => (c ? c.length : 0)));
  const bits = bitDepth === 16 || bitDepth === 32 ? bitDepth : 24, fl = bits === 32, bps = bits / 8, ba = nc * bps;
  const sr = Math.max(1, R(num(sampleRate, 48000)));
  const dataLen = len * ba, pad = dataLen & 1, fmtLen = fl ? 18 : 16, head = 12 + 8 + fmtLen + (fl ? 12 : 0) + 8;
  const buf = new ArrayBuffer(head + dataLen + pad), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) u8[o + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, buf.byteLength - 8, true); w4(8, 'WAVE');
  w4(12, 'fmt '); dv.setUint32(16, fmtLen, true);
  dv.setUint16(20, fl ? 3 : 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ba, true); dv.setUint16(32, ba, true); dv.setUint16(34, bits, true);
  let o = 36;
  if (fl) { dv.setUint16(36, 0, true); o = 38; w4(o, 'fact'); dv.setUint32(o + 4, 4, true); dv.setUint32(o + 8, len, true); o += 12; }
  w4(o, 'data'); dv.setUint32(o + 4, dataLen, true); o += 8;
  const full = bits === 16 ? 32768 : 8388608, hi = full - 1;
  let seed = 0x9E3779B9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const chs = Array.from(channels, c => c || []);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nc; c++) {
      let x = +chs[c][i] || 0;
      if (fl) { dv.setFloat32(o, x > 1e30 ? 1 : x < -1e30 ? -1 : x, true); o += 4; continue; }
      if (x !== 0) x = x * full + rnd() - rnd();   // TPDF dither, ±1 LSB; exact silence stays silent
      let s = R(x);
      s = s < -full ? -full : s > hi ? hi : s;
      if (bits === 16) { dv.setInt16(o, s, true); o += 2; }
      else { u8[o] = s & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = (s >> 16) & 255; o += 3; }
    }
  }
  return buf;
}
