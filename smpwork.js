// smpwork.js — module Worker of the sample / IR pipeline (owner S1; SPEC-serum2 §9.4, §11.12): decoding helpers,
// analysis and entry building off the main thread. The same `handle` runs on the main thread when module workers are
// unavailable (assets.js imports this module there; the worker registration below only happens inside a worker).
//
// Protocol (§9.4.1): request {q, op, …} → reply {q, ok: true, …} or {q, ok: false, err, code}; ArrayBuffers are
// transferred both ways.
//   op           request                                   reply payload
//   resample     {L, R, rate, to}                          {L, R, rate}
//   odf          {L, R, rate}                              {odf}
//   entry        {id, rec, ops, maxLevels?}                {entry}            playback entry (§4.5); bakes trim + fade only
//   spec         {id, rec, ops}                            {entry}            spectral analysis entry (reversed data for ops.rev;
//                                                                             + root, capped: IMPL, see specEntry)
//   ir           {id, rec, rate}                           {rec}              prepared IR record at `rate` (§9.4.7)
//   irshape      {id, rec, rate, shape, convMax?}          {entry}            shaped-IR entry (§4.5, §8.4)
//   wtsmp        {id, frames: Float32Array(R·2048), ops?, want?}
//                                                          {entries: [playback, spec]}   (§9.4.8; id = 'wtsmp:<table id>')
//   multi        {id, rec, rates?}                         {entry}            multisample entry (zone samples are separate)
//   gen          {id}                                      {rec}              generated factory record (smpgen)
//   loop         {L, R, rate, from, to, f0}                {ls, le}
//   farm         {plan, renders: [{L, R, loop?}]}          {res} | {rec}      (M4) the render-farm post-processing of a
//                                                                             factory multisample (smpgen.multiFromRenders
//                                                                             → {rec, samples}) or sample (sampleFromRenders
//                                                                             → rec), off the main thread
//   spectrogram  {L, R, rate, w, h}                        {w, h, data}       (IMPL: host.smp.spectrogram image, smp.spectrogram)
//   irview       {id, rec, rate, shape, convMax?, n}       {ov, len}          (IMPL: min/max overview of the shaped IR, the
//                                                                             Convolve display; same preparation cache)
// IMPL details fixed here: `maxLevels` (multisample zone entries, §9.4.3; default 8), `convMax` (s; the Q3 hook of
// §14.3, default 10), `rates` ({zone sample id: record rate}: zone ls / le / off are scaled into ≤ 48 kHz entry
// frames), `ops` / `want` of wtsmp (a table played with trim / fade: the playback id is `<id>~<opsKey>`, given as
// `playId`; want = ['play', 'spec'] by default), the reply payload keys above, and `code` ('ENOTIMPL' for an op whose
// helper is missing, never the case from M2 on). Prepared IRs are kept per (IR, rate, length, hash) for the next
// `irshape` of the same IR (4 most recent), so dragging a shaping knob does not re-run §9.4.7; shaped IRs per (id,
// rate, convMax, shape) (2 most recent), so `irview` of the shape just built does not shape again; records above
// 48 kHz resampled once per record (2 most recent), so their trim / fade variants only trim (§9.4.3).
import * as smp from './smp.js?v=10';
import * as gen from './smpgen.js?v=10';

export const OPS = Object.freeze(['resample', 'odf', 'entry', 'spec', 'ir', 'irshape', 'wtsmp', 'multi', 'gen', 'loop', 'spectrogram', 'irview', 'farm']);

const peakOf = (...xs) => { let p = 0; for (const x of xs) if (x) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };
const bytesOf = v => (v == null || typeof v !== 'object' ? 0 : ArrayBuffer.isView(v) ? v.byteLength : Object.values(v).reduce((a, x) => a + bytesOf(x), 0));
const ch2 = rec => (rec.ch !== 1 && rec.R != null ? smp.toF32(rec.R) : null);
const entryOps = ops => (ops && typeof ops === 'object' ? { trim: Array.isArray(ops.trim) ? ops.trim.slice(0, 2) : null, fade: ops.fade | 0 } : { trim: null, fade: 0 });

// records above 48 kHz resampled to 48 kHz (whole record, both channels, loop scaled), kept for the next build of the
// same record (a trim / fade drag rebuilds its variants from this; 2 most recent)
const DOWN = new Map();
function down48(rec, id) {
  const rate = +rec.rate, base = String(id || '').replace(/~[0-9a-f]{8}$/, '');
  const key = base + '|' + rate + '|' + (rec.len | 0) + '|' + (rec.ch | 0) + '|' + (rec.hash || '');
  let d = base ? DOWN.get(key) : null;
  if (d) { DOWN.delete(key); DOWN.set(key, d); return d; }
  let L = smp.toF32(rec.L), R = ch2(rec);
  if (R && R.length !== L.length) { const r = new Float32Array(L.length); r.set(R.subarray(0, L.length)); R = r; }
  const k = smp.LIMITS.playRate / rate, r = smp.resample(L, R, rate, smp.LIMITS.playRate);
  let loop = null;
  if (rec.loop) { const n = r.L.length, s0 = Math.min(n - 1, Math.round(rec.loop.start * k)), e0 = Math.min(n, Math.max(s0 + 1, Math.round(rec.loop.end * k))); loop = { start: s0, end: e0 }; }
  d = Object.assign({}, rec, { rate: smp.LIMITS.playRate, ch: r.R ? 2 : 1, len: r.L.length, L: r.L, R: r.R || null, loop });
  if (base) { DOWN.set(key, d); while (DOWN.size > 2) DOWN.delete(DOWN.keys().next().value); }
  return d;
}

// processed level-0 data of a record: ≤ 48 kHz (§9.4.3; a record above is resampled whole once, then trimmed: the
// variants of one record share that work), then trim and fade baked (§9.4.2)
function processed(rec, ops, id) {
  if (!rec || typeof rec !== 'object') throw new Error('no record');
  const op = entryOps(ops), src = rec.rate > smp.LIMITS.playRate ? down48(rec, id) : rec;
  const p = op.trim || op.fade ? smp.applyOps(src, op) : src;
  let L = smp.toF32(p.L), R = ch2(p), rate = p.rate > 0 ? +p.rate : 48000, loop = p.loop ? { start: p.loop.start, end: p.loop.end } : null;
  if (!L || !L.length) throw new Error('record has no samples');
  for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i])) L[i] = 0;
  if (R && R.length !== L.length) { const r = new Float32Array(L.length); r.set(R.subarray(0, L.length)); R = r; }
  if (loop && !(loop.start >= 0 && loop.start < loop.end && loop.end <= L.length)) loop = null;
  return { L, R, rate, len: L.length, root: Number.isFinite(p.root) ? +p.root : 60, loop };
}

/** Playback entry (§4.5 kind 'smp') of a record with its entry-changing ops (levels loop-aware, smp.sampleLevels). */
export function playbackEntry(id, rec, ops, maxLevels) {
  const d = processed(rec, ops, id), levels = smp.sampleLevels(d.L, d.R, d.len, maxLevels || smp.LIMITS.levels, d.loop);
  const e = { id, v: 1, kind: 'smp', rate: d.rate, ch: d.R ? 2 : 1, len: d.len, root: d.root, loop: d.loop, levels, peak: peakOf(levels[0].L, levels[0].R) };
  e.bytes = bytesOf(levels);
  return e;
}

/**
 * Spectral analysis entry (§4.5 kind 'spec'): built from the playback data, reversed when ops.rev (§9.4.2). It carries
 * the analysed record's `root` (IMPL extension of §4.5 read by SxSpec: 18.232 for a wavetable played as a sample) and
 * `capped` = 1 when the record was longer than the 20 s analysis cap (§9.4.6; the host shows the notice). Trim / fade
 * apply at the record's rate; smp.specAnalyse mixes to mono and resamples only the first 20 s (no full resampling).
 */
export function specEntry(id, rec, ops) {
  if (!rec || typeof rec !== 'object') throw new Error('no record');
  const op = entryOps(ops), p = op.trim || op.fade ? smp.applyOps(rec, op) : rec;
  const L = smp.toF32(p.L), R = ch2(p), rate = p.rate > 0 ? +p.rate : 48000;
  if (!L || !L.length) throw new Error('record has no samples');
  if (ops && ops.rev) { L.reverse(); if (R) { if (R.length !== L.length) throw new Error('channel lengths differ'); R.reverse(); } }
  const a = smp.specAnalyse(L, R, rate);
  const e = { id, v: 1, kind: 'spec', ch: 1, rate: a.rate, len: a.len, N: a.N, hop: a.hop, frames: a.frames, mag: a.mag, ph: a.ph, trans: a.trans, peak: a.peak, root: Number.isFinite(p.root) ? +p.root : 60 };
  if (L.length > Math.round(smp.LIMITS.specSec * rate)) e.capped = 1;
  e.bytes = bytesOf({ m: a.mag, p: a.ph, t: a.trans });
  return e;
}

// prepared IRs of the most recent irshape requests (worker memory; the main thread has its own copy of this module)
const PREP = new Map();
function prepared(id, rec, rate) {
  if (!id) return smp.irPrepare(rec, rate); // nothing to key the cache on
  const base = String(id).split('@')[0], key = base + '|' + rate + '|' + (rec && rec.len) + '|' + (rec && rec.hash || '');
  let p = PREP.get(key);
  if (p) { PREP.delete(key); PREP.set(key, p); return p; }
  p = smp.irPrepare(rec, rate);
  PREP.set(key, p);
  while (PREP.size > 4) PREP.delete(PREP.keys().next().value);
  return p;
}

// shaped IRs of the most recent irshape / irview requests (the Convolve display reuses the build's shaping)
const SHAPED = new Map();
function shaped(id, rec, rate, shape, convMax) {
  const cm = convMax > 0 ? +convMax : smp.LIMITS.irSec, key = id ? String(id) + '|' + rate + '|' + cm + '|' + (rec && rec.len) + '|' + (rec && rec.hash || '') + '|' + JSON.stringify(shape || {}) : '';
  let sh = key ? SHAPED.get(key) : null;
  if (sh) { SHAPED.delete(key); SHAPED.set(key, sh); return sh; }
  sh = smp.irShape(prepared(id, rec, rate), shape || {}, cm);
  if (key) { SHAPED.set(key, sh); while (SHAPED.size > 2) SHAPED.delete(SHAPED.keys().next().value); }
  return sh;
}
/** Shaped-IR entry (§4.5 kind 'ir') of an IR record at `rate`. */
export function irEntry(id, rec, rate, shape, convMax) {
  const sh = shaped(id, rec, rate, shape, convMax);
  const p = smp.irPartition(sh.L, sh.R, rate);
  const e = { id, v: 1, kind: 'ir', rate, ch: p.ch, len: p.len, head: p.head, hp: p.hp, tp: p.tp, peak: p.peak };
  e.bytes = bytesOf({ h: p.head, a: p.hp, b: p.tp });
  return e;
}

/**
 * Multisample entry (§4.5 kind 'multi'): the record's zones; their `smp` ids name separate playback entries. `rates`
 * ({zone sample id: record rate}) scales ls / le / off of zones whose sample is above 48 kHz into entry frames.
 */
export function multiEntry(id, rec, rates) {
  const zones = (rec && Array.isArray(rec.zones) ? rec.zones : []).slice(0, smp.LIMITS.zones).map(z => {
    const r = rates && rates[z.smp] > smp.LIMITS.playRate ? smp.LIMITS.playRate / rates[z.smp] : 1, sc = v => (Number.isFinite(v) ? Math.round(v * r) : 0);
    const mode = z.mode === 'loop' || z.mode === 'sustain' ? z.mode : 'oneshot';
    let ls = sc(z.ls), le = sc(z.le);
    if (mode !== 'oneshot' && !(le > ls)) { ls = 0; le = 0; }
    return {
      lo: z.lo, hi: z.hi, vlo: z.vlo, vhi: z.vhi, root: z.root, tune: Number.isFinite(z.tune) ? z.tune : 0, gain: Number.isFinite(z.gain) ? z.gain : 0,
      pan: Number.isFinite(z.pan) ? z.pan : 0, smp: z.smp, mode: le > ls || mode === 'oneshot' ? mode : 'oneshot',
      ls, le: Math.max(ls, le), off: sc(z.off), env: Array.isArray(z.env) ? z.env.slice() : null, rr: Array.isArray(z.rr) ? z.rr.slice() : [1, 1],
      vt: Number.isFinite(z.vt) ? z.vt : 1,
    };
  });
  return { id, v: 1, kind: 'multi', zones, bytes: 0 };
}

const RUN = {
  resample: r => { const x = smp.resample(r.L, r.R, r.rate, r.to); return { L: x.L, R: x.R || null, rate: r.to }; },
  odf: r => ({ odf: smp.odf(r.L, r.R, r.rate) }),
  entry: r => ({ entry: playbackEntry(r.id, r.rec, r.ops, r.maxLevels) }),
  spec: r => ({ entry: specEntry(r.id, r.rec, r.ops) }),
  ir: r => { const p = prepared(r.id, r.rec, r.rate); return { rec: Object.assign({}, p, { L: p.L.slice(), R: p.R ? p.R.slice() : null }) }; },
  irshape: r => ({ entry: irEntry(r.id, r.rec, r.rate, r.shape, r.convMax) }),
  wtsmp: r => {
    const id = String(r.id).startsWith('wtsmp:') ? String(r.id) : 'wtsmp:' + r.id, rec = smp.wtAsSample(r.frames);
    const play = typeof r.playId === 'string' && r.playId ? r.playId : id, want = Array.isArray(r.want) ? r.want : ['play', 'spec'], out = [];
    if (want.includes('play')) out.push(playbackEntry(play, rec, r.ops || null));
    if (want.includes('spec')) out.push(specEntry('spec:' + play + (r.ops && r.ops.rev ? '~r' : ''), rec, r.ops || null));
    return { entries: out };
  },
  multi: r => ({ entry: multiEntry(r.id, r.rec, r.rates) }),
  gen: r => ({ rec: gen.generate(r.id) }),
  loop: r => { const x = smp.loopSearch(r.L, r.R, r.rate, r.from, r.to, r.f0); return { ls: x.ls, le: x.le }; },
  farm: r => (r.plan && r.plan.kind === 'multi' ? { res: gen.multiFromRenders(r.plan, r.renders) } : { rec: gen.sampleFromRenders(r.plan, r.renders) }),
  spectrogram: r => smp.spectrogram(r.L, r.R, r.rate, r.w, r.h),
  irview: r => {
    const sh = shaped(r.id, r.rec, r.rate, r.shape, r.convMax);
    return { ov: smp.overview(sh.L, sh.R, r.n | 0), len: sh.L.length };
  },
};

// every ArrayBuffer behind the typed arrays of a reply (deduplicated; a buffer may back several views)
function transferables(v, out = new Set(), depth = 0) {
  if (v == null || typeof v !== 'object' || depth > 8) return out;
  if (ArrayBuffer.isView(v)) { out.add(v.buffer); return out; }
  if (v instanceof ArrayBuffer) { out.add(v); return out; }
  for (const k of Object.keys(v)) transferables(v[k], out, depth + 1);
  return out;
}

/** One request → {msg, transfer} (never rejects). */
export async function handle(req) {
  const q = req && req.q;
  try {
    const op = req && req.op;
    if (!OPS.includes(op)) throw new Error('unknown op ' + op);
    const out = await RUN[op](req);
    return { msg: Object.assign({ q, ok: true }, out), transfer: [...transferables(out)] };
  } catch (err) {
    return { msg: { q, ok: false, err: String((err && err.message) || err), code: (err && err.code) || '' }, transfer: [] };
  }
}

// inside a worker only (a module worker's global scope); on the main thread and in node this module only exports
const G = globalThis;
if (typeof G.WorkerGlobalScope === 'function' && G instanceof G.WorkerGlobalScope && typeof G.postMessage === 'function') {
  G.onmessage = e => { handle(e.data).then(({ msg, transfer }) => G.postMessage(msg, transfer)); };
}
