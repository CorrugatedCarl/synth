// sx-mod.js unit tests (owner D2; SPEC-serum2 §11.6, §15.6 — M1a scope). Run: node --test tests/sx-mod.test.mjs
//
// M1a moved the Phase-1 modulation code out of serum-dsp.js verbatim (§0.5 step 2). The central test here drives the
// frozen Phase-1 serum-dsp (tests/ref-p1, CP v1) and the current §0.3 scripts sx-base → sx-mod → serum-dsp (CP v2 of the
// migrated state) with the same seeded event scripts — notes, steals, legato, performance controls, transport starts and
// seeks, idle spans, panics, monitor on/off, varying span sizes, and patch edits WHILE VOICES SOUND (base values, rows
// added/removed/bypassed/zeroed, LFO graph edits, macros) — and requires bit-identical audio, FX offsets and snapshots.
// Rows to dynamic FX parameters are left out of the random states (they resolve through F1's fxDest, M1a step 3);
// rows to g.master / g.bypass are kept (FX-context 0 / 1 vs the v1 FX indices 0 / 86).
// The M2 rows of §15.6 (ENV 4, Start/End, LFO 9/10, types, directions, HOST in Hz, swing, ×10, macros as destinations,
// MPE, VC, randd, slew, editable/aux curves and their neutral-term tests) are added with those features.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as H from './golden-harness.mjs';
import * as REF from './ref-p1/serum-core.js';
import * as REFWT from './ref-p1/wt.js';

const CORE = await import(new URL('serum-core.js' + H.SUFFIX, H.ROOT).href);
const WT = await import(new URL('wt.js' + H.SUFFIX, H.ROOT).href);
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { base: read('../sx-base.js'), mod: read('../sx-mod.js'), dsp: read('../serum-dsp.js'), ref: read('./ref-p1/serum-dsp.js') };
const NSV = 429, NSRC = 62, MAXFX = 8 + 48 * 24;

function recorder() {
  const msgs = [];
  const rec = (level) => (...a) => msgs.push({ level, text: a.map(String).join(' ') });
  return { log: rec('log'), info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error'), msgs };
}
// a worklet-like scope: an ordinary global object (fast) when node has DONT_CONTEXTIFY, else a contextified one
function scope(files, con = recorder()) {
  const ctx = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  ctx.console = con;
  for (const [name, code] of files) vm.runInContext(code, ctx, { filename: name });
  return ctx;
}
const v2Files = () => [['sx-base.js', SRC.base], ['sx-mod.js', SRC.mod], ['serum-dsp.js', SRC.dsp]];
function makeProc(base = 48000, OS = 2) {
  const proc = { base, OS, fs: base * OS, CH: 4 * OS, p: null, ct: null, bendRaw: 0, wheel: 0, at: 0, pat: new Float64Array(128),
    patSeen: false, bpm: 120, beat: null, held: [], voices: [], sx: null };
  proc.songBeat = () => proc.beat;
  return proc;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ shape and loading */

test('SxMod loads in a bare scope, publishes the frozen §11.6 API and reads no other global at load', () => {
  const con = recorder();
  const ctx = vm.createContext({ console: con });
  const before = new Set(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)));
  vm.runInContext(SRC.mod, ctx, { filename: 'sx-mod.js' });                     // without sx-base: loads anyway
  const M = ctx.SxMod;
  assert.ok(M && Object.isFrozen(M));
  assert.deepEqual(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)).filter((k) => !before.has(k)), ['SxMod']);
  assert.deepEqual([M.VER, M.NSV, M.NSRC, M.NROW, M.MAXCH, M.MAXFX], [1, NSV, NSRC, 64, 32, MAXFX]);
  const fns = { attach: 2, sync: 3, syncCT: 4, begin: 3, idle: 3, transport: 3, reset: 2, fxMods: 2, snap: 3, ModV: 1 };
  for (const [k, n] of Object.entries(fns)) { assert.equal(typeof M[k], 'function', k); assert.equal(M[k].length, n, k + ' arity'); }
  const mv = { noteOn: 7, noteOff: 1, kill: 0, follow: 1, sources: 1, matrix: 1, advance: 1, envVal: 1, lfoVal: 1, post: 0, stop: 0, setDt: 2 };
  for (const [k, n] of Object.entries(mv)) assert.equal(M.ModV.prototype[k].length, n, 'ModV.' + k);
  for (const [k, n] of [['lfoTab', 10 * 1025], ['lfoPtsOff', 11], ['lfoPmAny', 10], ['lfoStart', 10], ['veloTab', 129], ['crv', 64 * 129]]) {
    assert.equal(M.DEF_CT[k].length, n, 'DEF_CT.' + k);
  }
  // without SxBase: attach refuses (one warning per script per scope, §0.3) and serum-dsp's voices stay silent without
  // throwing
  vm.runInContext(SRC.dsp, ctx, { filename: 'serum-dsp.js' });
  const S = ctx.SerumDSP, proc = makeProc();
  const sx = S.attach(proc);
  assert.equal(sx.mod, null);
  const pr2 = makeProc(); S.attach(pr2);
  assert.equal(con.msgs.filter((m) => m.level === 'warn' && m.text.includes('sx-mod: SxBase missing')).length, 1, 'sx-mod warns once per scope');
  assert.equal(con.msgs.filter((m) => m.level === 'warn' && m.text.includes('SxMod unavailable')).length, 1, 'serum-dsp warns once per scope');
  const s = CORE.normalizeSerum(REF.normalizeSerum(REF.defaultSerum()));
  proc.p = CORE.compileSerum(s, { bpm: 120 }); proc.ct = proc.p.serumT;
  const v = new S.SerumVoice(proc, 0);
  proc.voices = [v];
  v.apply(proc.p); v.noteOn(60, 1, false, 1);
  const L = new Float64Array(256), R = new Float64Array(256);
  S.begin(proc, 256); v.render(L, R, 256);
  assert.equal(v.active, false);
  assert.ok(L.every((x) => x === 0) && S.fxMods(proc).every((x) => x === 0));
  assert.ok(S.snapshot(proc));
});

test('a throwing body leaves SxMod = null without throwing; re-evaluation gives a new frozen object', () => {
  const con = recorder();
  const ctx = scope(v2Files(), con);
  const M1 = ctx.SxMod;
  vm.runInContext(SRC.mod, ctx, { filename: 'sx-mod.js' });
  assert.ok(ctx.SxMod && ctx.SxMod !== M1);
  vm.runInContext(SRC.mod.replace('try {', "try {\n    throw new Error('boom');"), ctx, { filename: 'sx-mod.js' });
  assert.equal(ctx.SxMod, null);
  assert.ok(con.msgs.some((m) => m.level === 'error' && m.text.includes('sx-mod: load failed')));
});

test('source follows the DSP script rules (IIFE, environment neutrality, lazy SxBase, no eval/instanceof/Math.random)', () => {
  const code = SRC.mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = code.trim();
  assert.match(body, /^\(function \(\) \{\s*'use strict';/);
  assert.ok(body.endsWith('})();'));
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window', 'document',
    'self', 'eval', 'instanceof', 'import', 'export', 'with', 'SerumDSP', 'FXDSP']) assert.doesNotMatch(code, new RegExp('\\b' + w + '\\b'), w);
  assert.doesNotMatch(code, /Math\.random/);
  // SxBase is read in attach only (once per processor)
  assert.equal((code.match(/globalThis\.SxBase/g) || []).length, 1);
  assert.match(code, /function attach\(sx, proc\) \{[^]*?globalThis\.SxBase/);
});

test('the smoothing law table (SxBase.LAW_TAB2.cont) and source polarity equal Phase 1 on the v1 slots', () => {
  const A = scope([['ref-p1/serum-dsp.js', SRC.ref]]).SerumDSP, B = scope(v2Files());
  assert.deepEqual(Array.from(B.SxBase.LAW_TAB2.cont.subarray(0, 148)), Array.from(A.LAW_TAB.cont.subarray(0, 148)));
  assert.deepEqual(Array.from(B.SxBase.SRC_POL2.subarray(0, 34)), Array.from(A.SRC_POL));
  // and the indices the modulation code uses (vi = Phase-1 DEST idx below 148, §3.11.1)
  const D = B.SxBase.DIDX2;
  assert.deepEqual([D.E1_ATT, D.L1_RATE, D.C1_RATE, D.G_PORTA, D.G_CURVE, D.BUS1, D.E1_CA, D.C1_BPM, D.G_WHEEL, D.G_BEND],
    [48, 63, 95, 97, 98, 103, 135, 144, 146, 147]);
  const I = B.SxBase.SIDX2;
  assert.deepEqual([I.WHEEL, I.ENV1, I.LFO1, I.VELO, I.NOTE, I.AT, I.PAT, I.CHAOS1, I.NOISE, I.RAND1, I.RAND2, I.ALT1, I.ALT2, I.MACRO1,
    I.BEND, I.MPEX, I.RELVEL, I.FIXED], [1, 2, 5, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 28, 29, 32, 33]);
});

/* ------------------------------------------------------------------ CP v2 rows: voice / mono / FX contexts */

test('rows by CP v2 index space: vi rows modulate eff, FX rows (mDst = −1 − k) write fxMods[k], invalid rows are inert', () => {
  const ctx = scope(v2Files()), S = ctx.SerumDSP;
  const s = CORE.normalizeSerum(REF.normalizeSerum(REF.defaultSerum()));
  const p = CORE.compileSerum(s, { bpm: 120 }), cp = p.serum;
  const row = (r, src, dst, amt, cx) => { cp.mSrc[r] = src; cp.mDst[r] = dst; cp.mAmt[r] = amt; cp.mCtx[r] = cx; cp.srcUsed[src] = 1; };
  row(0, 33, -1 - 0, 0.25, 4);           // fixed → g.master (FX ctx 0)
  row(1, 33, -1 - 1, -0.5, 4);           // fixed → g.bypass (FX ctx 1)
  row(2, 33, -1 - 900, 0.125, 4);        // fixed → FX ctx 900 (a flat FX parameter)
  row(3, 33, -1 - MAXFX, 0.5, 4);        // out of range: amount 0
  row(4, 33, NSV, 0.5, 1);               // vi out of range: amount 0
  row(5, 33, 42, 0.1, 1);                // fixed → f.cutoff (voice)
  row(6, 33, 146, 0.3, 2);               // fixed → g.wheel (mono)
  row(7, 33, 300, 0.2, 1);               // fixed → a SYN2 slot (vi 300): evaluated, not used by the M1a voice
  cp.modded[42] = 1; cp.modded[300] = 1; cp.mN = 8;
  const proc = makeProc();
  proc.p = p; proc.ct = p.serumT;
  const v = new S.SerumVoice(proc, 0);
  proc.voices = [v];
  v.apply(p); v.noteOn(60, 1, false, 1);
  const L = new Float64Array(256), R = new Float64Array(256);
  for (let k = 0; k < 4; k++) { S.begin(proc, 256); v.render(L, R, 256); }
  const off = S.fxMods(proc), m = proc.sx.mod;
  assert.equal(off.length, MAXFX);
  assert.deepEqual([off[0], off[1], off[900]], [0.25, -0.5, 0.125]);
  assert.equal(off.reduce((a, x) => a + (x !== 0 ? 1 : 0), 0), 3, 'nothing else');
  assert.equal(m.fxN, 5, 'FX rows counted, incl. the two inert ones (Phase 1: an invalid destination is an FX row of amount 0)');
  assert.equal(m.mAmt[3], 0); assert.equal(m.mAmt[4], 0);
  assert.ok(Math.abs(v.eff[42] - (cp.base[42] + 0.1)) < 1e-12, 'voice row');
  assert.ok(Math.abs(v.eff[300] - Math.min(1, cp.base[300] + 0.2)) < 1e-12, 'SYN2 slot row');
  assert.ok(Math.abs(m.monoOff[146] - 0.3) < 1e-12 && Math.abs(m.monoEff[146] - Math.min(1, cp.base[146] + 0.3)) < 1e-12, 'mono row');
  // the FX clear covers the extent written before: a CP without FX rows leaves an all-zero vector
  const p2 = CORE.compileSerum(s, { bpm: 120 });
  proc.p = p2; v.apply(p2);
  S.begin(proc, 256); v.render(L, R, 256);
  assert.ok(S.fxMods(proc).every((x) => x === 0));
});

/* ------------------------------------------------------------------ Phase-1 equivalence (the verbatim move) */

const SYNTH = REF.DESTS.slice(0, 148).map((d) => d.id);
const SRCS = REF.SOURCES.map((x) => x.id).filter(Boolean);
const EMPTY = { src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
// v1 state without rows to dynamic FX parameters (F1, M1a step 3); g.master / g.bypass rows stay
const noFxParams = (s) => { s.matrix = s.matrix.map((r) => (r && /^fx\./.test(r.dst) ? { ...EMPTY } : r)); return s; };
function mutate(s, r) {
  const t = clone(s), pick = (a) => a[Math.floor(r() * a.length)];
  for (let i = 0, n = 1 + Math.floor(r() * 4); i < n; i++) t.p[pick(SYNTH)] = r();
  t.p['a.on'] = 1; t.p['g.amp'] = Math.max(t.p['g.amp'], 0.5);
  if (r() < 0.6) {
    const j = Math.floor(r() * t.matrix.length), q = t.matrix[j];
    if (q.src && r() < 0.6) {
      const how = Math.floor(r() * 4);
      if (how === 0) t.matrix[j] = { ...EMPTY }; else if (how === 1) q.byp = 1; else if (how === 2) q.amt = 0; else q.dst = pick(SYNTH);
    } else {
      t.matrix[j] = { src: pick(SRCS), dst: r() < 0.9 ? pick(SYNTH) : pick(['g.master', 'g.bypass']), amt: 2 * r() - 1, bi: r() < 0.5 ? 1 : 0,
        curve: r() < 0.3 ? 2 * r() - 1 : 0, aux: r() < 0.25 ? pick(SRCS) : '', inv: r() < 0.3 ? 1 : 0, byp: 0, out: 1 };
    }
  }
  if (r() < 0.3) {
    const L = t.lfo[Math.floor(r() * 8)];
    if (L.pts.length > 2) { const k = 1 + Math.floor(r() * (L.pts.length - 2)); L.pts[k][1] = r(); }
    else L.pts[0][1] = r();
  }
  if (r() < 0.2) t.macros[Math.floor(r() * 4)].v = r();
  return noFxParams(REF.normalizeSerum(t));
}
function entryOf(W, id) {
  if (id.startsWith('noise:')) return W.makeNoise(id);
  const t = W.factoryTable(id);
  return t ? W.makeEntry(id, t) : null;
}
// one side: Phase-1 (ref) or v2 — tables, processor, voices, patch application as the engine does it (setSerum → apply)
function side(v2, base, OS, nv) {
  const ctx = scope(v2 ? v2Files() : [['ref-p1/serum-dsp.js', SRC.ref]]), S = ctx.SerumDSP, W = v2 ? WT : REFWT, stored = new Set();
  const proc = makeProc(base, OS), vs = [];
  for (let i = 0; i < nv; i++) vs.push(new S.SerumVoice(proc, i));
  proc.voices = vs;
  return {
    S, proc, vs, ctx,
    patch(s1) {
      const p = v2 ? CORE.compileSerum(CORE.normalizeSerum(clone(s1)), { bpm: proc.bpm }) : REF.compileSerum(s1, { bpm: proc.bpm });
      for (const id of p.needs || []) if (!stored.has(id)) { const e = entryOf(W, id); if (e) S.storeWT(id, e); stored.add(id); }
      proc.p = p; if (p.serumT) proc.ct = p.serumT;
      for (const v of vs) v.apply(p);
      return p;
    },
    direct() { const c = proc.p.serum; return v2 ? (c.outMask & 2) !== 0 : !!c.direct; },
  };
}
function sameBits(a, b, what) {
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}[${i}]: ${a[i]} vs ${b[i]}`);
}
function sameSnap(sa, sb, what) {
  const sub = (x, n) => Array.from(x.subarray(0, n));
  assert.deepEqual(sub(sb.eff, 148), sub(sa.eff, 148), what + ' eff');
  assert.equal(sb.eff[NSV + 0], sa.eff[148 + 0], what + ' eff g.master');
  assert.equal(sb.eff[NSV + 1], sa.eff[148 + 86], what + ' eff g.bypass');
  for (const [k, n] of [['lfoPh', 8], ['lfoOut', 8], ['env', 3], ['envStage', 3], ['envT', 3], ['wtPos', 2], ['memNow', 32], ['filtTap', 1024]]) {
    assert.deepEqual(sub(sb[k], n), sub(sa[k], n), what + ' ' + k);
  }
  for (const k of ['noisePos', 'notes', 'oscVoices', 'maxVoices', 'tapRate']) assert.equal(sb[k], sa[k], what + ' ' + k);
}
// a seeded session on both sides, compared span by span
function session(seed, s0, { base = 48000, OS = 2, nv = 4, spans = 500, edits = 0.015 } = {}) {
  const r = H.mulberry32(seed), A = side(false, base, OS, nv), B = side(true, base, OS, nv);
  let s = s0;
  A.patch(s); B.patch(s);
  const NMAX = 128 * OS, buf = () => Array.from({ length: 4 }, () => new Float64Array(NMAX));
  const ba = buf(), bb = buf();
  let stamp = 0, playing = false, held = [];
  const pickVoice = () => {                                // the engine's allocation (inactive, not gated, oldest), on A
    const vs = A.vs;
    let best = -1;
    for (let i = 0; i < nv; i++) if (!vs[i].active && (best < 0 || vs[i].stamp < vs[best].stamp)) best = i;
    if (best < 0) for (let i = 0; i < nv; i++) if (!vs[i].gate && (best < 0 || vs[i].stamp < vs[best].stamp)) best = i;
    if (best < 0) for (let i = 0; i < nv; i++) if (best < 0 || vs[i].stamp < vs[best].stamp) best = i;
    return best;
  };
  const both = (f) => { f(A); f(B); };
  for (let sp = 0; sp < spans; sp++) {
    if (r() < edits) {                                     // patch edit while voices sound (smoothing in flight)
      s = mutate(s, r);
      both((X) => X.patch(s));
    }
    const x = r();
    if (x < 0.06) {                                        // note on (steal / legato in mono)
      const n = 30 + Math.floor(r() * 60), vel = r(), mono = A.proc.p.serum.mono;
      const i = mono ? 0 : pickVoice(), leg = mono ? held.length > 0 && r() < 0.7 : r() < 0.05;
      held.push(n);
      stamp++;
      both((X) => { X.proc.held = held.slice(); X.vs[i].stamp = stamp; X.vs[i].noteOn(n, vel, leg, 1); });
    } else if (x < 0.1) {                                  // note off (release velocity sometimes)
      const i = Math.floor(r() * nv), rv = r() < 0.5 ? r() : undefined;
      held = held.slice(1);
      both((X) => { X.proc.held = held.slice(); X.vs[i].noteOff(rv); });
    } else if (x < 0.13) {                                 // performance controls, poly pressure
      const w = r(), bd = 2 * r() - 1, at = r(), pn = Math.floor(r() * 128), pv = r(), ps = r() < 0.5;
      both((X) => { X.proc.wheel = w; X.proc.bendRaw = bd; X.proc.at = at; X.proc.pat[pn] = pv; X.proc.patSeen = X.proc.patSeen || ps; });
    } else if (x < 0.137) {                                // transport start / seek / stop, tempo
      playing = r() < 0.7;
      const b = playing ? r() * 16 : null, bpm = 60 + Math.floor(r() * 120);
      both((X) => { X.proc.beat = b; X.proc.bpm = bpm; X.S.transport(X.proc, playing); });
    } else if (x < 0.14) {                                 // snapshot subscription
      const on = r() < 0.5 ? 1 : 0;
      both((X) => { X.proc.sx.mon = on; });
    } else if (x < 0.142) {                                // panic: processor reset, voices killed
      held = [];
      both((X) => { X.S.reset(X.proc); for (const v of X.vs) v.kill(); X.proc.held = []; });
    }
    if (!A.vs.some((v) => v.active) && r() < 0.5) {        // the engine's silent path
      const n = 4 * (1 + Math.floor(r() * 64));
      both((X) => X.S.idle(X.proc, n));
      if (playing) { A.proc.beat += n / base * A.proc.bpm / 60; B.proc.beat = A.proc.beat; }
      continue;
    }
    const n = 4 * (1 + Math.floor(r() * 32)), N = n * OS, dir = A.direct();
    assert.equal(B.direct(), dir, 'direct pair in use');
    for (const [X, bf] of [[A, ba], [B, bb]]) {
      for (const a of bf) a.fill(0, 0, N);
      X.S.begin(X.proc, N);
      for (const v of X.vs) if (v.active) { if (dir) v.render(bf[0], bf[1], N, bf[2], bf[3]); else v.render(bf[0], bf[1], N); }
    }
    for (let k = 0; k < 4; k++) sameBits(bb[k].subarray(0, N), ba[k].subarray(0, N), `seed ${seed} span ${sp} out${k}`);
    const fa = A.S.fxMods(A.proc), fb = B.S.fxMods(B.proc);
    assert.equal(fb[0], fa[0], `seed ${seed} span ${sp} FX g.master`);
    assert.equal(fb[1], fa[86], `seed ${seed} span ${sp} FX g.bypass`);
    if (sp % 7 === 0) sameSnap(A.S.snapshot(A.proc), B.S.snapshot(B.proc), `seed ${seed} span ${sp}`);
    for (let k = 0; k < nv; k++) assert.equal(B.vs[k].active, A.vs[k].active, `seed ${seed} span ${sp} voice ${k} active`);
    if (playing) { A.proc.beat += n / base * A.proc.bpm / 60; B.proc.beat = A.proc.beat; }
  }
  return { A, B };
}

test('Phase-1 equivalence: random v1 states, seeded sessions with patch edits mid-note — audio, FX offsets, snapshots bit-identical', () => {
  const COUNT = H.FULL ? 60 : 16;
  let audible = 0;
  for (let i = 0; i < COUNT; i++) {
    const seed = (0x5D1 + 7919 * i) >>> 0, OS = [1, 2, 4][i % 3], base = i % 4 === 3 ? 44100 : 48000;
    const s0 = noFxParams(H.randomSerumV1(REF, REFWT, seed, OS));
    const { A } = session(seed, s0, { base, OS, nv: 3 + (i % 3), spans: OS === 4 ? 260 : 420 });
    if (A.proc.sx.recent) audible++;
  }
  assert.ok(audible >= COUNT / 2, 'the sessions play notes');
});

test('Phase-1 equivalence: dense patch edits (a third of the spans) on short spans with sustained notes', () => {
  for (let i = 0; i < (H.FULL ? 24 : 8); i++) {
    const seed = (0xDE5E + 31 * i) >>> 0, s0 = noFxParams(H.randomSerumV1(REF, REFWT, seed, 2));
    s0.p['e1.sus'] = 1; s0.p['e1.rel'] = 0.5;
    session(seed, s0, { OS: 1 + (i % 2), nv: 4, spans: 260, edits: 0.33 });
  }
});

test('Phase-1 equivalence: every factory preset with patch edits mid-note (OS 2, 4 voices)', () => {
  const step = H.FULL ? 1 : 4;
  for (let k = 0; k < REF.FACTORY_PRESETS.length; k += step) {
    const pr = REF.FACTORY_PRESETS[k], s0 = noFxParams(REF.applyPreset(REF.defaultSerum(), pr));
    session((0xF00 + k) >>> 0, s0, { OS: 2, nv: 4, spans: 300 });
  }
});

/* ------------------------------------------------------------------ allocation-free (§0.3) */

test('allocation-free: CP changes (sync), CT part merges, begin / voices / fxMods / snap while voices sound', () => {
  const ctx = scope(v2Files()), S = ctx.SerumDSP;
  const s1 = noFxParams(H.randomSerumV1(REF, REFWT, 0xA110C, 2)), states = [s1];
  for (let k = 1; k < 6; k++) states.push(mutate(states[k - 1], H.mulberry32(k)));
  const patches = states.map((s) => CORE.compileSerum(CORE.normalizeSerum(clone(s)), { bpm: 120 }));
  const proc = makeProc(48000, 2), vs = [0, 1, 2].map((i) => new S.SerumVoice(proc, i));
  proc.voices = vs;
  for (const p of patches) for (const id of p.needs) { const e = entryOf(WT, id); if (e && !S.tables.has(id)) S.storeWT(id, e); }
  proc.p = patches[0]; proc.ct = patches[0].serumT;
  for (const v of vs) v.apply(proc.p);
  proc.sx.mon = 1;
  const N = 256, L = new Float64Array(N), R = new Float64Array(N);
  const span = () => { S.begin(proc, N); for (const v of vs) v.render(L, R, N); S.fxMods(proc); S.snapshot(proc); };
  vs[0].noteOn(48, 1, false, 1); vs[1].noteOn(55, 0.7, false, 1);
  for (let k = 0; k < 8; k++) span();
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Set', 'Object'];
  const saved = {};
  for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
  try {
    for (let k = 0; k < 300; k++) {
      if (k % 50 === 25) { const p = patches[1 + ((k / 50) | 0) % 5]; proc.p = p; proc.ct = p.serumT; for (const v of vs) v.apply(p); }
      if (k === 120) vs[2].noteOn(60, 0.9, false, 1);
      if (k === 200) vs[0].noteOff(0.3);
      span();
    }
  } finally {
    for (const k of names) ctx[k] = saved[k];
  }
  assert.ok(L.every(Number.isFinite));
});

/* ================================================================== M2: the v2 modulation system (§15.6) */
//
// A modulation-only rig: SxBase + SxMod in a vm scope, a processor stub and a stub voice (TV) that drives ModV exactly as
// serum-dsp's SerumVoice does (noteOn protocol and PRNG re-seeding of §6.2, chunk order follow → sources → matrix →
// render → advance of §6.1, post() for the recent voice). States are v2 Serum states compiled by serum-core (C1), the CT
// is the full CT v2 assembled from the parts (assembleCT). Times are measured in chunks (4 base frames).

const MODF = () => [['sx-base.js', SRC.base], ['sx-mod.js', SRC.mod]];
const XS = (s) => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
const SIX = CORE.SRC_INDEX, VI = (id) => CORE.vi(CORE.DEST_INDEX[id]);
const PSEED = 0x2545F491;
function st(fn) { const s = CORE.defaultSerum(); if (fn) fn(s); return s; }
const mrow = (src, dst, amt = 1, x = {}) => ({ src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null,
  rise: 0, fall: 0, slink: 0, ...x });
const hzN = (hz, x10 = false) => Math.pow(hz / (x10 ? 1000 : 100), 0.25);          // LFO rate n for a frequency (pow4 law)
const timeN = (sec) => Math.pow(sec / 32, 0.2);                                    // envelope time n (pow5 law, 0–32 s)
// one Phase-2 draw sequence of a voice: the r2 seed of §6.2 for processor stream value `rng` and voice index i
function r2Seq(rng, i, n) {
  const seed = rng ^ (0x9E3779B9 * (i + 1));
  let r = XS((seed ^ 0x85EBCA6B) >>> 0) || 1;
  const out = [];
  for (let k = 0; k < n; k++) { r = XS(r) || 1; out.push(r / 4294967296); }
  return out;
}
class TV {
  constructor(R, i) {
    this.R = R; this.proc = R.proc; this.i = i; this.dt = this.proc.CH / this.proc.fs;
    this.r = 1; this.r2 = 1; this.gate = false; this.active = false; this.note = 60; this.vel = 0; this.onN = 0; this.nLast = 0;
    this.stamp = 0; this.fresh = 0; this.r2At = 0;
    this.mod = new R.M.ModV(this);
  }
  rnd() { this.r = XS(this.r) || 1; return this.r / 4294967296; }
  rnd2() { this.r2 = XS(this.r2) || 1; return this.r2 / 4294967296; }
  noteOn(n, vel, legato = false, ch = 0, ex = null) {
    const proc = this.proc, sx = proc.sx, m = sx.mod, wasActive = this.active;
    if (m.cp === null) this.R.sync();                       // serum-dsp syncs the CP at a note-on before the first begin
    this.note = n; this.vel = vel; this.gate = true;
    legato = !!legato && wasActive;
    let R = null, other = false;
    for (const w of proc.voices) {
      if (!w || w === this || !w.gate || !w.active) continue;
      other = true;
      if (!R || w.stamp > R.stamp) R = w;
    }
    if (!(!legato && m.cLegato === 1 && m.cMono === 0 && R !== null)) R = null;
    sx.alt = sx.alt ? 0 : 1;
    if (!legato) {
      this.rngAt = sx.rng = XS(sx.rng) || 1;
      const seed = sx.rng ^ (0x9E3779B9 * (this.i + 1));
      this.r = XS(seed) || 1;
      this.r2 = this.r2At = XS((seed ^ 0x85EBCA6B) >>> 0) || 1;
    }
    this.mod.noteOn(n, vel, legato, R !== null ? R.mod : null, ch, ex, other);
    this.active = true; this.played = 1; this.fresh = 1; this.stamp = ++this.R.stampN;
  }
  noteOff(rv) { this.gate = false; this.mod.noteOff(rv); }
  chunk(gc, fr, each, t) {
    const mv = this.mod;
    if (!this.gate && this.fresh === 0 && mv.eV[0] <= 1e-5) { this.active = false; mv.stop(); return false; }
    mv.follow(fr); mv.sources(gc); mv.matrix(fr);
    if (each) each(this, gc, t);
    mv.advance(gc);
    this.fresh = 0;
    return true;
  }
}
function rig(s, { base = 48000, OS = 1, nv = 2, bpm = 120, ctx = {}, files = MODF(), mon = 0 } = {}) {
  const sc = scope(files), M = sc.SxMod, proc = makeProc(base, OS);
  proc.bpm = bpm; proc.mpe = new Float64Array(17 * 4); proc.seqMacro = new Float64Array(8).fill(NaN);
  const sx = { mod: null, mon, alt: 0, ok: 1, seed: PSEED, rng: PSEED, span: 0, nCh: 0 };
  proc.sx = sx;
  const R = { M, proc, sx, sc, m: M.attach(sx, proc), vs: [], ct: null, gen: 0, t: 0, stampN: 0, cctx: ctx };
  R.patch = (st2, c = {}) => {
    const p = CORE.compileSerum(CORE.normalizeSerum(clone(st2)), { bpm: proc.bpm, ...R.cctx, ...c });
    proc.p = p; R.ct = CORE.assembleCT(p.serumT); R.gen++;
    return p;
  };
  R.patch(s);
  for (let i = 0; i < nv; i++) R.vs.push(new TV(R, i));
  proc.voices = R.vs;
  R.dtC = proc.CH / proc.fs;
  R.sync = () => { M.sync(proc, sx, proc.p.serum); M.syncCT(proc, sx, R.ct, R.gen); };
  R.begin = (nCh) => { sx.span++; sx.nCh = nCh; R.sync(); M.begin(proc, sx, nCh); };
  // one span of nCh chunks; each(v, c, t) after the matrix of every chunk of every active voice (t = chunk start)
  R.span = (nCh = 32, each = null) => {
    R.begin(nCh);
    for (const v of R.vs) {
      if (!v.active) continue;
      for (let c = 0; c < nCh; c++) if (!v.chunk(c, (c + 1) / nCh, each, R.t + c * R.dtC)) break;
      if (sx.mod.recent === v) v.mod.post();
    }
    M.fxMods(proc, sx);
    if (proc.beat !== null) proc.beat += nCh * R.dtC * proc.bpm / 60;
    R.t += nCh * R.dtC;
  };
  R.run = (sec, each = null, nCh = 32) => { const end = R.t + sec - 1e-12; while (R.t < end) R.span(nCh, each); };
  R.snap = () => {
    const s2 = { eff: new Float32Array(NSV + MAXFX), lfoPh: new Float32Array(10), lfoOut: new Float32Array(10), lfoY: new Float32Array(10),
      env: new Float32Array(4), envStage: new Float32Array(4), envT: new Float32Array(4), mOut: new Float32Array(64) };
    M.snap(proc, sx, s2);
    return s2;
  };
  return R;
}
// the value of a CT table at x (linear interpolation, as SxMod's tabAt)
function tabAt(T, b, n, x) {
  if (!(x > 0)) return T[b];
  if (x >= 1) return T[b + n];
  const p = x * n, i = p | 0;
  return T[b + i] + (p - i) * (T[b + i + 1] - T[b + i]);
}
const bendK = (t, k) => (Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k)));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);

/* ------------------------------------------------------------------ the Phase-1 tests, ported (identical expectations) */

test('ported: matrix rows (bipolar, unipolar, aux inv, curve, clamping, amount × output) through compileSerum v2', () => {
  const effOf = (p, rows, vel = 1) => {
    const R = rig(st((s) => { Object.assign(s.p, p); rows.forEach((r, j) => { s.matrix[j] = r; }); }));
    R.vs[0].noteOn(60, vel);
    R.span(); R.span();
    return R.vs[0].mod.eff;
  };
  const C = VI('f.cutoff');
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [mrow('fixed', 'f.cutoff', 0.5)])[C], 0.75);
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [mrow('fixed', 'f.cutoff', 1, { aux: 'fixed', inv: 1 })])[C], 0.25);
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [mrow('fixed', 'f.cutoff', 0.5, { aux: 'velo' })], 0.5)[C], 0.5);
  assert.equal(effOf({ 'f.cutoff': 0.5 }, [mrow('fixed', 'f.cutoff', 1)])[C], 1, 'clamped at 1');
  assert.equal(effOf({ 'f.cutoff': 0.5 }, [mrow('fixed', 'f.cutoff', -1)])[C], 0, 'clamped at 0');
  const e = effOf({ 'f.cutoff': 0.1 }, [mrow('velo', 'f.cutoff', 0.5, { curve: 0.5 })], 0.5)[C];
  near(e, 0.1 + 0.5 * bendK(0.5, 3), 1e-6, 'curve bends the source');
  near(effOf({ 'f.cutoff': 0.5 }, [mrow('velo', 'f.cutoff', 0.4, { bi: 1 })], 0.25)[C], 0.5 + 0.4 * (0.25 - 0.5), 1e-6, 'bipolar row');
  assert.equal(effOf({ 'f.cutoff': 0.5 }, [mrow('bend', 'f.cutoff', 0.4)])[C], 0.5, 'bipolar source at 0 adds nothing');
  near(effOf({ 'f.cutoff': 0.2 }, [mrow('fixed', 'f.cutoff', 0.6, { out: 0.5 })])[C], 0.5, 1e-6, 'amount × output');
});

test('ported: envelopes (linear attack at curve 0.5, decay curves, hold, sustain laws, envT, release) for ENV 1–4', () => {
  const trace = (p, sec = 1) => {
    const R = rig(st((s) => Object.assign(s.p, p)));
    const tr = [];
    R.vs[0].noteOn(60, 1);
    R.run(sec, (v, c, t) => tr.push([t, ...v.mod.eV, ...v.mod.eSt, ...v.mod.eT]));
    return { R, tr };
  };
  const at = (tr, t, k = 1) => tr.reduce((a, r) => (Math.abs(r[0] - t) < Math.abs(a[0] - t) ? r : a))[k];
  for (const e of [1, 2, 3, 4]) {
    const k = e;                                                      // column of ENV e's value
    const a = trace({ [`e${e}.att`]: timeN(0.5), [`e${e}.ca`]: 0.5 }).tr;
    near(at(a, 0.25, k), 0.5, 0.02, `ENV ${e} linear attack mid value`);
    near(at(a, 0.25, 8 + k), 0.25, 1e-3, `ENV ${e} envT`);
    assert.equal(at(a, 0.25, 4 + k), 1, `ENV ${e} attack stage`);
    const d = trace({ [`e${e}.att`]: 0, [`e${e}.dec`]: timeN(0.5), [`e${e}.sus`]: 0, [`e${e}.cd`]: 0.666 }).tr;
    assert.ok(at(d, 0.25, k) < 0.4, `ENV ${e} decay below linear at curve 0.666`);
    const dl = trace({ [`e${e}.att`]: 0, [`e${e}.dec`]: timeN(0.5), [`e${e}.sus`]: 0, [`e${e}.cd`]: 0.5 }).tr;
    near(at(dl, 0.25, k), 0.5, 0.02, `ENV ${e} linear decay`);
    const s = trace({ [`e${e}.att`]: 0, [`e${e}.dec`]: 0.1, [`e${e}.sus`]: 0.5, [`e${e}.hold`]: timeN(0.1) }, 0.6);
    near(at(s.tr, 0.05, k), 1, 1e-12, `ENV ${e} hold`);
    assert.equal(at(s.tr, 0.05, 4 + k), 2);
    near(at(s.tr, 0.5, k), e === 1 ? 0.25 : 0.5, 1e-9, `ENV ${e} sustain law (ENV 1: n², else linear)`);
    const v = s.R.vs[0];
    v.noteOff();
    assert.equal(v.mod.eSt[e - 1], 5);
  }
});

test('ported: LFOs — BPM ladder period, FREE+MONO anchored to the song beat, ENVELOPE hold/loop, delay + rise, smooth, rate 0', () => {
  // RETRIG (per voice), BPM 120, 1/4 → period 0.5 s (± one chunk), first wrap after one period from the start point
  {
    const R = rig(st((s) => { s.lfo[0] = { ...s.lfo[0], bpm: 1, anchor: 0 }; s.p['l1.rate'] = 0.5; }));
    const v = R.vs[0], wraps = [];
    v.noteOn(60, 1);
    let last = v.mod.lPh[0];
    R.run(2.2, (w, c, t) => { if (w.mod.lPh[0] < last) wraps.push(t); last = w.mod.lPh[0]; });
    const per = (wraps[wraps.length - 1] - wraps[0]) / (wraps.length - 1);
    near(per, 0.5, R.dtC, 'period');
    near(wraps[0], 0.5, 2 * R.dtC, 'first cycle');
  }
  // FREE + MONO (Phase-1 Off) + BPM + HOST while the transport plays: φ = frac(lfoStart + beat/beats)
  {
    const R = rig(st((s) => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 1, anchor: 1, pts: [[0, 0, 0], [0.25, 1, 0], [1, 0, 0]], start: 1 }; s.p['l1.rate'] = 0.5; }), { nv: 0 });
    for (const beat of [0, 3.3, 17.81]) {
      R.proc.beat = beat;
      R.begin(32);
      const b = beat + 31 * R.dtC * 2, want = (0.25 + b) % 1;
      near(R.m.oPh[0], want, 1e-9, `beat ${beat}`);
    }
    R.proc.beat = null;
    const b0 = R.m.beatClk;
    R.begin(32);
    near(R.m.beatClk, b0 + 32 * R.dtC * 2, 1e-9, 'stopped: the processor beat clock carries on');
  }
  // ENVELOPE: one pass, holds y(1); with a loop point: loops while gated, runs out after note-off
  for (const loop of [-1, 1]) {
    const R = rig(st((s) => { s.lfo[0] = { ...s.lfo[0], mode: 'env', bpm: 0, pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.3, 0]], loop }; s.p['l1.rate'] = 0.6; }), { mon: 1 });
    const v = R.vs[0];
    v.noteOn(60, 1);
    let minPh = 1;
    R.run(1, (w, c, t) => { if (t > 0.3) minPh = Math.min(minPh, w.mod.lPh[0]); });
    if (loop < 0) { assert.equal(v.mod.lPh[0], 1); near(R.snap().lfoOut[0], 0.3, 1e-6, 'holds y(1)'); continue; }
    assert.ok(minPh >= 0.5 && v.mod.lPh[0] < 1, 'loops between the loop point and the end while gated');
    v.noteOff();
    R.run(0.3);
    assert.equal(v.mod.lPh[0], 1, 'runs out after note-off');
  }
  // delay 0.1 s then rise 0.2 s; rate 0 holds the phase; smooth τ = 0.5·smooth³
  {
    const R = rig(st((s) => {
      s.lfo[0] = { ...s.lfo[0], bpm: 0, pts: [[0, 0.2, 0], [0.001, 1, 0], [0.5, 1, 0], [1, 1, 0]], start: 2 };
      Object.assign(s.p, { 'l1.rate': 0, 'l1.delay': 0.1 / 4, 'l1.rise': 0.2 / 4 }); s.matrix[0] = mrow('lfo1', 'f.res', 0.1);
    }));
    const v = R.vs[0];
    v.noteOn(60, 1);
    R.run(0.5, (w, c, t) => {
      const want = t < 0.1 ? 0.2 : t < 0.3 ? 0.2 + 0.8 * (t - 0.1) / 0.2 : 1;
      near(w.mod.src[SIX.lfo1], want, 1e-9 + 0.8 * R.dtC / 0.2, `delay/rise at ${t.toFixed(4)}`);
    });
    assert.equal(v.mod.lPh[0], 0.5, 'rate 0 holds the phase');
    const sm = 0.6, tau = 0.5 * sm ** 3;
    const W = rig(st((s) => {
      s.lfo[0] = { ...s.lfo[0], bpm: 0, pts: [[0, 0, 0], [0.001, 1, 0], [0.5, 1, 0], [1, 1, 0]], start: 2 };
      Object.assign(s.p, { 'l1.rate': 0, 'l1.delay': 0.1 / 4, 'l1.smooth': sm }); s.matrix[0] = mrow('lfo1', 'f.res', 0.1);
    }));
    W.vs[0].noteOn(60, 1);
    let hit = null;
    W.run(0.6, (w, c, t) => { if (hit === null && t > 0.1 && w.mod.src[SIX.lfo1] >= 1 - Math.exp(-1)) hit = t; });
    near(hit - 0.1, tau, 0.1 * tau, 'smooth τ');
  }
});

test('ported: S1 chaos sources bounded at the maximum rate, deterministic, BPM-snapped S&H period (both S1 and S2 mode, deviation 22)', () => {
  for (const s1 of [0, 1]) {
    const mono = () => {
      const R = rig(st((s) => { s.global.s1 = s1; Object.assign(s.p, { 'c1.rate': 1, 'c2.rate': 1 }); s.chaos = [{ mono: 1, sh: 0 }, { mono: 1, sh: 0 }]; }), { nv: 0 });
      const out = [];
      for (let k = 0; k < Math.ceil(20 * 48000 / 128); k++) {
        R.begin(32);
        if (k % 50 === 0) out.push(R.m.g[17 * 32 + 5], R.m.g[18 * 32 + 9]);
        for (let c = 0; c < 32; c++) if (!(Math.abs(R.m.g[17 * 32 + c]) <= 1 && Math.abs(R.m.g[18 * 32 + c]) <= 1)) assert.fail('chaos out of range');
      }
      return out;
    };
    const m1 = mono(), m2 = mono();
    assert.deepEqual(m1, m2, 'deterministic');
    assert.ok(new Set(m1.map((x) => x.toFixed(3))).size > 50, 'moving');
    // S&H + BPM: 2.3 Hz snaps to 2 Hz (1/4 at 120 BPM) → updates every 0.5 s
    const R = rig(st((s) => { s.global.s1 = s1; Object.assign(s.p, { 'c1.rate': Math.pow(2.3 / 1000, 0.2), 'c1.bpm': 1 }); s.chaos = [{ mono: 1, sh: 1 }, { mono: 0, sh: 0 }]; }), { nv: 0 });
    const ch = [];
    let prev = null, t = 0;
    for (let k = 0; k < Math.ceil(3 * 48000 / 128); k++) {
      R.begin(32);
      for (let c = 0; c < 32; c++) { const y = R.m.g[17 * 32 + c]; if (prev !== null && y !== prev) ch.push(t); prev = y; t += R.dtC; }
    }
    const gaps = ch.slice(1).map((x, i) => x - ch[i]);
    assert.ok(gaps.length >= 4 && gaps.every((g) => Math.abs(g - 0.5) <= R.dtC + 1e-9), 'S&H every 0.5 s: ' + gaps);
  }
});

/* ------------------------------------------------------------------ envelopes v2 (§6.14) */

test('ENV 4 runs the ENV 2 code; ENV 2–4 Start/End levels: attack from Start, release to End, then holds End', () => {
  const E = { att: timeN(0.1), hold: 0, dec: timeN(0.1), sus: 0.6, rel: timeN(0.2), ca: 0.5, cd: 0.5, cr: 0.5 };
  const R = rig(st((s) => {
    for (const e of [2, 4]) for (const [k, x] of Object.entries(E)) s.p[`e${e}.${k}`] = x;
    for (const [k, x] of Object.entries(E)) s.p[`e3.${k}`] = x;
    Object.assign(s.p, { 'e2.start': 0.25, 'e2.end': 0.1, 'e4.start': 0.25, 'e4.end': 0.1, 'e1.rel': timeN(4) });   // ENV 1 keeps the voice
    s.matrix[0] = mrow('env4', 'f.res', 0.2); s.matrix[1] = mrow('env2', 'f.var', 0.2);
  }));
  const v = R.vs[0], mv = v.mod;
  v.noteOn(60, 1);
  assert.equal(mv.src[SIX.env2], 0.25, 'note-on evaluation sees the Start level');
  assert.equal(mv.src[SIX.env4], 0.25);
  assert.equal(mv.src[SIX.env3], 0, 'Start 0');
  const A = 32 * E.att ** 5;
  R.run(0.3, (w, c, t) => {
    assert.ok(Object.is(w.mod.eV[1], w.mod.eV[3]) && w.mod.eSt[1] === w.mod.eSt[3] && Object.is(w.mod.eT[1], w.mod.eT[3]), 'ENV 4 ≡ ENV 2');
    if (t < A - R.dtC) near(w.mod.eV[1], 0.25 + 0.75 * t / A, 1e-9, `linear attack from Start at ${t}`);
  });
  near(mv.eV[1], 0.6, 1e-12, 'sustain');
  v.noteOff();
  const Rt = 32 * E.rel ** 5, t0 = R.t;
  R.run(0.4, (w, c, t) => {
    const q = t - t0;
    if (q < Rt - R.dtC) near(w.mod.eV[1], 0.1 + (0.6 - 0.1) * (1 - q / Rt), 1e-9, `release to End at ${q}`);
    if (q > Rt + R.dtC) { assert.equal(w.mod.eV[1], 0.1, 'holds End'); assert.equal(w.mod.eSt[1], 0); assert.equal(w.mod.eV[2], 0, 'End 0'); }
    assert.ok(Object.is(w.mod.eV[1], w.mod.eV[3]));
  }, 8);
  assert.ok(R.vs[0].active && mv.eSt[1] === 0 && mv.eV[1] === 0.1, 'checked while the voice sounds');
  assert.equal(mv.eSt[0], 5, 'ENV 1 still releasing (4 s)');
  assert.equal(mv.envsIdle(), false, 'rule (b): an envelope still in its release keeps the voice');
  // (ticked directly: the stub voice would end by rule (a) once ENV 1 is done)
  for (let k = 0; k < Math.ceil(4.2 / (32 * R.dtC)); k++) { R.begin(32); for (let c = 0; c < 32; c++) { mv.follow(1); mv.sources(c); mv.matrix(1); mv.advance(c); } }
  assert.deepEqual(Array.from(mv.eSt), [0, 0, 0, 0]);
  assert.equal(mv.eV[1], 0.1, 'ENV 2 holds End');
  assert.equal(mv.envsIdle(), true, 'rule (b): every release finished — idle although ENV 2 holds End 0.1 (inv B13)');
  mv.stop();
  assert.equal(mv.envsIdle(), true);
  // ENV 4 differs from ENV 2 once its parameters differ
  const Q = rig(st((s) => { s.p['e4.att'] = timeN(0.3); s.p['e2.att'] = timeN(0.05); }));
  Q.vs[0].noteOn(60, 1);
  Q.run(0.1);
  assert.ok(Q.vs[0].mod.eV[1] > Q.vs[0].mod.eV[3] + 0.3);
});

test('ENV MS/BPM units: A/H/D/R step through ENV_LADDER at the tempo (1/4 at 120 BPM = 0.5 s, at 60 BPM = 1 s)', () => {
  const lad = CORE.ENV_LADDER, i4 = lad.findIndex((e) => e.label === '1/4');
  assert.equal(lad[i4].beats, 1);
  assert.equal(lad.length, 16);
  for (const [bpm, sec] of [[120, 0.5], [60, 1]]) {
    for (const nudge of [0, 0.02, -0.02]) {                       // stepped: round(n·15)
      const R = rig(st((s) => { s.env[0].bpm = 1; s.env[2].bpm = 1; Object.assign(s.p, { 'e1.att': i4 / 15 + nudge, 'e3.att': i4 / 15 + nudge, 'e3.dec': 0 }); }), { bpm });
      R.vs[0].noteOn(60, 1);
      let end = null;
      R.run(sec + 0.1, (w, c, t) => { if (end === null && w.mod.eSt[0] > 1) end = t; }, 8);
      near(end, sec, R.dtC + 1e-9, `attack end at ${bpm} BPM (n ${nudge})`);
      near(R.vs[0].mod.eT[2] + 0, R.vs[0].mod.eT[2], 0, '');
    }
  }
  // index 0 = 0 s: the stage is skipped
  const Z = rig(st((s) => { s.env[1].bpm = 1; Object.assign(s.p, { 'e2.att': 0.01, 'e2.dec': 0.01, 'e2.sus': 0.3 }); }));
  Z.vs[0].noteOn(60, 1);
  Z.span(1);
  assert.equal(Z.vs[0].mod.eV[1], 0.3);
});

test('Legato Inverted and Voice Steal Retrigger (§6.2 envelopes row, §6.14)', () => {
  const base = (s) => {
    for (const e of [1, 2, 3, 4]) Object.assign(s.p, { [`e${e}.att`]: timeN(0.05), [`e${e}.dec`]: timeN(0.05), [`e${e}.sus`]: 0.5 });
    Object.assign(s.p, { 'e2.start': 0.2, 'e3.start': 0.3 });
  };
  // mono legato: no retrigger, except ENV 2 (legInv: from its current level) and ENV 3 (legInv + stealRe: from Start)
  {
    const R = rig(st((s) => { base(s); s.voicing.mono = 1; s.voicing.legato = 1; s.env[1].legInv = 1; s.env[2].legInv = 1; s.env[2].stealRe = 1; }), { nv: 1 });
    const v = R.vs[0], mv = v.mod;
    v.noteOn(60, 1);
    R.run(0.3);
    const before = Array.from(mv.eV), st0 = Array.from(mv.eSt);
    assert.deepEqual(st0, [4, 4, 4, 4]);
    v.noteOn(64, 1, true);
    assert.deepEqual(Array.from(mv.eSt), [4, 1, 1, 4], 'only the Legato Inverted envelopes restart');
    assert.equal(mv.eV0[1], before[1], 'ENV 2 restarts from its current level (as on a steal)');
    assert.equal(mv.eV0[2], 0.3, 'ENV 3 (Voice Steal Retrigger) restarts from its Start level');
    assert.equal(mv.eV[0], before[0]); assert.equal(mv.eV[3], before[3]);
  }
  // steal (non-legato note-on of a sounding voice): from the current level, Voice Steal Retrigger from Start (ENV 1: 0)
  {
    const R = rig(st((s) => { base(s); s.env[0].stealRe = 1; s.env[1].stealRe = 1; }), { nv: 1 });
    const v = R.vs[0], mv = v.mod;
    v.noteOn(60, 1);
    R.run(0.3);
    const before = Array.from(mv.eV);
    v.noteOn(67, 1);
    assert.deepEqual(Array.from(mv.eSt), [1, 1, 1, 1]);
    assert.deepEqual([mv.eV0[0], mv.eV0[1], mv.eV0[2], mv.eV0[3]], [0, 0.2, before[2], before[3]]);
    assert.deepEqual([mv.src[SIX.env1], mv.src[SIX.env2], mv.src[SIX.env3], mv.src[SIX.env4]], [0, 0.2, before[2], before[3]],
      'the note-on evaluation sees the restart levels');
    // fresh voice: Start levels
    const F = rig(st(base), { nv: 1 });
    F.vs[0].noteOn(60, 1);
    assert.deepEqual(Array.from(F.vs[0].mod.eV0), [0, 0.2, 0.3, 0]);
  }
});

test('poly legato (LEGATO without MONO): the new voice copies ENV 1–4, LFO 1–10 and the glide start of the most recent gated voice; envLegInv restarts', () => {
  const R = rig(st((s) => {
    s.voicing.legato = 1; s.voicing.mono = 0;
    for (const e of [1, 2, 3, 4]) Object.assign(s.p, { [`e${e}.att`]: timeN(0.05 * e), [`e${e}.dec`]: timeN(0.1), [`e${e}.sus`]: 0.4 });
    s.env[2].legInv = 1;
    for (let l = 0; l < 10; l++) { s.lfo[l] = { ...s.lfo[l], bpm: 0, anchor: 0, type: ['normal', 'sh', 'lorenz', 'rossler', 'path'][l % 5], dir: ['fwd', 'pp'][l % 2] }; s.p[`l${l + 1}.rate`] = hzN(1 + l); }
    s.p['l1.delay'] = 0.05; s.p['g.porta'] = 0.6;
    for (let l = 0; l < 10; l++) s.matrix[l] = mrow(`lfo${l + 1}`, 'f.res', 0.01);
  }), { nv: 3 });
  const [a, b] = R.vs;
  a.noteOn(48, 1);
  R.run(0.12);
  const A = a.mod;
  b.noteOn(55, 1);
  const B = b.mod;
  for (const e of [0, 1, 3]) {
    assert.deepEqual([B.eSt[e], B.eQ[e], B.eV[e], B.eT[e]], [A.eSt[e], A.eQ[e], A.eV[e], A.eT[e]], `ENV ${e + 1} copied`);
  }
  assert.equal(B.eSt[2], 1, 'ENV 3 (Legato Inverted) restarts');
  for (let l = 0; l < 10; l++) {
    assert.deepEqual([B.lPh[l], B.lCy[l], B.lSH[l], B.lCh[3 * l], B.lCh[3 * l + 2]], [A.lPh[l], A.lCy[l], A.lSH[l], A.lCh[3 * l], A.lCh[3 * l + 2]], `LFO ${l + 1} state copied`);
    assert.equal(B.src[SIX['lfo' + (l + 1)]], A.lVal[l], `LFO ${l + 1} value at the note-on`);
  }
  assert.equal(B.tau, A.tau, 'delay/rise time copied');
  assert.equal(B.gS, A.nP, 'glide starts at the reference voice\'s current pitch');
  // both run identically from here (same state, same rates)
  R.span();
  for (const l of [0, 1, 4]) assert.equal(B.lVal[l], A.lVal[l]);
});

/* ------------------------------------------------------------------ LFOs v2 (§6.15) */

const RAMP = [[0, 0, 0], [1, 1, 0]];
// a state with LFO 1 = ramp 0→1 at `hz` (Hz units) read by a row, plus extra LFO fields
const lfoSt = (hz, f = {}, more = null) => st((s) => {
  s.lfo[0] = { ...s.lfo[0], bpm: 0, anchor: 0, pts: RAMP, ...f };
  s.p['l1.rate'] = hzN(hz, !!f.x10);
  s.matrix[0] = mrow('lfo1', 'f.res', 0.1); s.matrix[1] = mrow('lfo1y', 'f.var', 0.1);
  if (more) more(s);
});
const frac = (x) => x - Math.floor(x);

test('LFO MODE × MONO (§6.15.1): per-voice RETRIG/ENVELOPE, per-voice FREE on the processor clock, processor FREE/RETRIG/ENVELOPE', () => {
  const hz = 2, dt = 4 / 48000;
  // RETRIG, per voice: each voice from its own note-on
  {
    const R = rig(lfoSt(hz));
    R.vs[0].noteOn(60, 1); R.run(0.1, null, 8); R.vs[1].noteOn(64, 1); R.run(0.1, null, 8);
    near(R.vs[0].mod.lPh[0], 0.4, 2 * hz * dt, 'A'); near(R.vs[1].mod.lPh[0], 0.2, 2 * hz * dt, 'B');
  }
  // ENVELOPE, per voice: one pass, then holds
  {
    const R = rig(lfoSt(hz, { mode: 'env' }));
    R.vs[0].noteOn(60, 1); R.run(0.6, null, 8);
    assert.equal(R.vs[0].mod.lPh[0], 1); assert.equal(R.vs[0].mod.lVal[0], 1);
  }
  // FREE, per voice: the processor clock's phase, but DELAY/RISE per voice (from each voice's note-on)
  {
    const R = rig(lfoSt(hz, { mode: 'free', mono: 0 }, (s) => { s.p['l1.delay'] = 0.05 / 4; }));
    R.vs[0].noteOn(60, 1); R.run(0.2, null, 8); R.vs[1].noteOn(64, 1);
    assert.equal(R.m.lKind[0], 2);
    let both = 0;
    R.run(0.2, (v, c, t) => {
      const a = R.vs[0].mod, b = R.vs[1].mod;
      if (v === R.vs[1]) {
        assert.equal(b.lRp[0], a.lRp[0], 'one processor phase');
        if (b.tau < 0.05 - dt) assert.equal(b.src[SIX.lfo1], 0, 'B in its own delay: the value at φ = 0');
        else if (b.tau > 0.05 + dt) { assert.equal(b.src[SIX.lfo1], a.src[SIX.lfo1]); both++; }
      }
    }, 1);
    assert.ok(both > 100);
  }
  // FREE + MONO = Phase-1 Off: one value in g for every voice
  {
    const R = rig(lfoSt(hz, { mode: 'free', mono: 1 }));
    R.vs[0].noteOn(60, 1); R.run(0.13, null, 8); R.vs[1].noteOn(64, 1);
    assert.equal(R.m.lKind[0], 1);
    R.run(0.1, (v, c) => assert.equal(v.mod.src[SIX.lfo1], R.m.g[SIX.lfo1 * 32 + c]), 8);
  }
  // RETRIG + MONO: one processor phase, restarted by every note-on of the processor
  {
    const R = rig(lfoSt(hz, { mono: 1 }));
    R.vs[0].noteOn(60, 1); R.run(0.2, null, 8);
    assert.equal(R.m.lKind[0], 3);
    near(R.m.P.lPh[0], 0.4, 2 * hz * dt, 'running');
    R.vs[1].noteOn(64, 1);
    assert.equal(R.m.P.lPh[0], 0, 'restarted by the note-on');
    R.run(0.1, (v, c) => assert.equal(v.mod.src[SIX.lfo1], R.m.g[SIX.lfo1 * 32 + c], 'both voices read the processor value'), 8);
    near(R.m.P.lPh[0], 0.2, 2 * hz * dt, 'from the last note-on');
  }
  // ENVELOPE + MONO with a loop point: loops while any voice is gated, runs out when none is
  {
    const R = rig(lfoSt(hz, { mono: 1, mode: 'env', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.25, 0]], loop: 1 }));
    R.vs[0].noteOn(60, 1); R.run(1.2, null, 8);
    assert.ok(R.m.P.lPh[0] >= 0.5 && R.m.P.lPh[0] < 1 && R.m.P.lDone[0] === 0, 'looping');
    R.vs[0].noteOff(); R.run(0.6, null, 8);
    assert.equal(R.m.P.lPh[0], 1, 'runs out after the last gate');
  }
});

test('HOST (§6.15.1): BPM anchors (also MONO); Hz in S2 mode follows the song clock while playing, S1 mode free-runs', () => {
  const hz = 3, rate = (s1, f) => lfoSt(hz, { anchor: 1, ...f }, (s) => { s.global.s1 = s1; });
  // RETRIG Hz at a note-on during playback: φ₀ = frac(start + songSeconds·rate)
  for (const s1 of [0, 1]) {
    const R = rig(rate(s1, {}));
    R.proc.beat = 3.3;
    R.span(); R.span();
    const sec = R.proc.beat * 60 / 120;
    R.vs[0].noteOn(60, 1);
    if (s1) assert.equal(R.vs[0].mod.lPh[0], 0, 'S1: free accumulation from the start point');
    else near(R.vs[0].mod.lPh[0], frac(sec * hz), 1e-9, 'S2: anchored to the song clock');
    // stopped transport: no anchoring in either mode
    const Q = rig(rate(s1, {}));
    Q.span(); Q.vs[0].noteOn(60, 1);
    assert.equal(Q.vs[0].mod.lPh[0], 0);
  }
  // FREE + MONO Hz: S2 follows φ = frac(start + songSeconds·rate) through a seek, S1 accumulates
  for (const s1 of [0, 1]) {
    const R = rig(rate(s1, { mode: 'free', mono: 1 }), { nv: 0, mon: 1 });
    R.proc.beat = 0;
    for (let k = 0; k < 40; k++) R.span();
    const p1 = R.m.oPh[0];
    R.proc.beat = 17.25;                                         // seek
    R.span();
    const sec = (17.25 + 31 * R.dtC * 2) * 60 / 120;
    if (!s1) near(R.m.oRp[0], frac(sec * hz), 1e-9, 'S2: song clock after the seek');
    else near(R.m.oPh[0], frac(p1 + 32 * R.dtC * hz), 1e-9, 'S1: free accumulation ignores the seek');
  }
  // BPM + HOST on a MONO RETRIG LFO: Phase-1 Anchor (lfoStart + Δbeat/beats since the note-on)
  {
    const R = rig(lfoSt(hz, { mono: 1, bpm: 1, anchor: 1 }, (s) => { s.p['l1.rate'] = 0.5; }));
    R.proc.beat = 1;
    R.span(); R.vs[0].noteOn(60, 1);
    const b0 = R.proc.beat;
    for (let k = 0; k < 20; k++) R.span();
    near(R.m.P.lPh[0], frac(R.proc.beat - b0), 1e-9, 'anchored to the beats since the note-on (1/4 = 1 beat)');
  }
});

test('DIRECTION (Forward / Reverse / Ping Pong period 2 cycles), PHASE offset, start phase pts[start].x incl. x = 1, ×10', () => {
  const hz = 4, dt = 4 / 48000;
  const trace = (f, more, sec = 1.1) => {
    const R = rig(lfoSt(hz, f, more), { nv: 1 });
    const tr = [];
    R.vs[0].noteOn(60, 1);
    R.run(sec, (v, c, t) => tr.push([t, v.mod.src[SIX.lfo1], v.mod.lCy[0]]), 8);
    return tr;
  };
  for (const [t, y] of trace({ dir: 'rev' })) if (frac(t * hz) > 0.01 && frac(t * hz) < 0.99) near(y, 1 - frac(t * hz), 2 * hz * dt, `reverse at ${t}`);
  const pp = trace({ dir: 'pp' });
  for (const [t, y] of pp) {
    const x = t * hz, f = frac(x), odd = Math.floor(x + 1e-9) % 2 === 1;
    if (f > 0.01 && f < 0.99) near(y, odd ? 1 - f : f, 2 * hz * dt, `ping pong at ${t}`);
  }
  const peaks = [];
  for (let i = 1; i < pp.length - 1; i++) if (pp[i][1] >= pp[i - 1][1] && pp[i][1] > pp[i + 1][1]) peaks.push(pp[i][0]);
  const per = (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1);
  near(per, 2 / hz, 2 * dt, 'ping pong period = 2 cycles');
  // PHASE 90° on start 0.875 → 0.125; PHASE 0 on start x = 1 (ENVELOPE) holds y(1) from the note-on
  {
    const R = rig(lfoSt(hz, { pts: [[0, 0, 0], [0.875, 0.5, 0], [1, 0.75, 0]], start: 1 }, (s) => { s.p['l1.phase'] = 0.25; }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    assert.equal(R.vs[0].mod.lPh[0], 0.125);
    const Q = rig(lfoSt(hz, { mode: 'env', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.75, 0]], start: 2 }), { nv: 1 });
    Q.vs[0].noteOn(60, 1);
    assert.equal(Q.vs[0].mod.lPh[0], 1, 'start = pts[start].x = 1 exactly (no frac)');
    assert.equal(Q.vs[0].mod.src[SIX.lfo1], 0.75);
    Q.run(0.2, (v) => assert.equal(v.mod.src[SIX.lfo1], 0.75), 8);
    const P = rig(lfoSt(hz, { mode: 'env', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.75, 0]], start: 2 }, (s) => { s.p['l1.phase'] = 0.25; }), { nv: 1 });
    P.vs[0].noteOn(60, 1);
    assert.equal(P.vs[0].mod.lPh[0], 0.25, 'frac(1 + 0.25)');
  }
  // ×10: the Hz law reaches 1000 Hz (rate n for 30 Hz with ×10 = n for 3 Hz without)
  {
    const R = rig(lfoSt(3, { x10: 1 }), { nv: 1 });
    assert.equal(R.proc.p.serum.lfoX10[0], 1);
    R.vs[0].noteOn(60, 1);
    let wraps = 0, last = 0;
    R.run(1, (v) => { if (v.mod.lPh[0] < last) wraps++; last = v.mod.lPh[0]; }, 8);
    assert.ok(Math.abs(wraps - 3) <= 1, '×10 at the 0.3 Hz knob position: ' + wraps);
    const Q = rig(lfoSt(30, { x10: 1 }), { nv: 1 });
    Q.vs[0].noteOn(60, 1);
    wraps = 0; last = 0;
    Q.run(1, (v) => { if (v.mod.lPh[0] < last) wraps++; last = v.mod.lPh[0]; }, 8);
    assert.ok(Math.abs(wraps - 30) <= 1, '30 Hz: ' + wraps);
  }
});

test('swing (BPM LFOs, kbd.swing s): even cycles ×(1 + 0.75s), odd ×(1 − 0.75s); per-voice, anchored and processor clocks', () => {
  const sw = 0.5, beats = 0.25, per = beats * 0.5;                // 1/16 at 120 BPM = 0.125 s
  const i16 = CORE.lfoLadder(0, 0).findIndex((e) => e.label === '1/16');
  for (const [f, label] of [[{ anchor: 0 }, 'RETRIG'], [{ anchor: 1 }, 'RETRIG + HOST'], [{ mode: 'free', mono: 1, anchor: 0 }, 'FREE + MONO'],
    [{ mode: 'free', mono: 1, anchor: 1 }, 'FREE + MONO + HOST']]) {
    const R = rig(lfoSt(1, { bpm: 1, swing: 1, ...f }, (s) => { s.kbd.swing = sw; s.p['l1.rate'] = i16 / 14; }), { nv: 1, mon: 1 });
    assert.equal(R.proc.p.seq.kbd[3], sw);
    const wraps = [];
    let last = -1;
    const look = (y) => { if (last >= 0 && y < last - 0.5) wraps.push(R.t); last = y; };
    R.proc.beat = f.mode ? 0 : null;
    if (!f.mode) { R.vs[0].noteOn(60, 1); R.run(1.2, (v, c, t) => { if (v.mod.lPh[0] < last - 0.5) wraps.push(t); last = v.mod.lPh[0]; }, 1); }
    else for (let k = 0; k < 1.2 / R.dtC; k++) { R.begin(1); look(R.m.oRp[0]); R.t += R.dtC; if (R.proc.beat !== null) R.proc.beat += R.dtC * 2; }
    const d = wraps.slice(1).map((x, i) => x - wraps[i]);
    assert.ok(d.length >= 6, label);
    const lo = per * (1 - 0.75 * sw), hi = per * (1 + 0.75 * sw);
    for (let i = 0; i < d.length; i++) {
      const want = Math.abs(d[i] - lo) < Math.abs(d[i] - hi) ? lo : hi;
      near(d[i], want, 2 * R.dtC, `${label} cycle ${i}`);
      if (i > 0) assert.ok(Math.abs(d[i] - d[i - 1]) > 0.5 * (hi - lo), `${label}: alternating`);
    }
  }
  // s = 0 or the LFO's swing flag off: no swing
  const R = rig(lfoSt(1, { bpm: 1, swing: 0 }, (s) => { s.kbd.swing = sw; s.p['l1.rate'] = i16 / 14; }), { nv: 1 });
  assert.equal(R.m.lSw[0], 0);
});

test('types: Path X/Y equal the CT tables; Chaos Lorenz/Rossler bounded, moving, deterministic, per-voice seeds; S&H steps once per cycle', () => {
  // Path: lfoN = pathX[φ], lfoNy = pathY[φ] (incl. delay value and smoothing rules)
  {
    const R = rig(lfoSt(2.5, { type: 'path', path: [[0.5, 1, 0], [1, 0.5, 0.3], [0.5, 0, 0], [0, 0.5, -0.4], [0.5, 1, 0]] }), { nv: 1 });
    const v = R.vs[0];
    v.noteOn(60, 1);
    let n = 0;
    R.run(0.8, (w) => {
      const rp = w.mod.lRp[0];
      assert.equal(w.mod.src[SIX.lfo1], tabAt(R.ct.pathX, 0, 1024, rp));
      assert.equal(w.mod.src[SIX.lfo1y], tabAt(R.ct.pathY, 0, 1024, rp));
      n++;
    }, 8);
    assert.ok(n > 1000);
    const xs = new Set();
    for (let j = 0; j <= 1024; j += 64) xs.add(R.ct.pathY[j].toFixed(3));
    assert.ok(xs.size > 5, 'a real path table');
    // other types: Y output 0
    const Q = rig(lfoSt(2.5), { nv: 1 });
    Q.vs[0].noteOn(60, 1); Q.run(0.1, (w) => assert.equal(w.mod.src[SIX.lfo1y], 0), 8);
  }
  // Chaos
  for (const type of ['lorenz', 'rossler']) {
    const run = (mono) => {
      const R = rig(lfoSt(800, { type, x10: 1, mono, mode: mono ? 'free' : 'retrig' }), { nv: 2 });
      R.vs[0].noteOn(60, 1); R.vs[1].noteOn(64, 1);
      const out = [];
      R.run(4, (v, c, t) => {
        const y = v.mod.src[SIX.lfo1];
        if (!(y >= 0 && y <= 1)) assert.fail(`${type} out of [0, 1]: ${y}`);
        if (c === 0) out.push(v.i, y);
      }, 32);
      return out;
    };
    for (const mono of [0, 1]) {
      const a = run(mono), b = run(mono);
      assert.deepEqual(a, b, `${type} deterministic`);
      const v0 = a.filter((x, i) => i % 4 === 1), v1 = a.filter((x, i) => i % 4 === 3);
      assert.ok(new Set(v0.map((x) => x.toFixed(3))).size > 50, `${type} moving`);
      if (mono) assert.deepEqual(v0, v1, 'MONO: one generator');
      else assert.notDeepEqual(v0, v1, 'per voice: seeded per voice');
    }
  }
  // S&H: a new value exactly at each cycle wrap, constant in between (4 Hz → 8 values in 2 s)
  {
    const R = rig(lfoSt(4, { type: 'sh' }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    let prev = R.vs[0].mod.src[SIX.lfo1], lastPh = 0, changes = 0;
    R.run(2, (v) => {
      const y = v.mod.src[SIX.lfo1], ph = v.mod.lPh[0];
      if (y !== prev) { changes++; assert.ok(ph < lastPh, 'changes only at a wrap'); }
      assert.ok(y >= 0 && y < 1);
      prev = y; lastPh = ph;
    }, 1);
    assert.ok(Math.abs(changes - 8) <= 1, 'one step per cycle: ' + changes);
  }
});

test('Voice Control LFO scaling: % mode scales the rate by the eff vc.lscale value; Rate mode snaps to VC_RATES (nearest in log2, ties to the smaller)', () => {
  const nOf = (v) => Math.log2(v * 4) / 4;                         // exp law 0.25…4
  const incOf = (lmode, n) => {
    const R = rig(lfoSt(2, {}, (s) => { s.vc.lmode = lmode; s.p['vc.lscale'] = n; }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    R.span(1);
    const a = R.vs[0].mod.lPh[0];
    R.span(1);
    return (R.vs[0].mod.lPh[0] - a) / (R.dtC * 2);
  };
  const base = incOf(0, 0.5);
  near(base, 1, 1e-9, 'neutral');
  near(incOf(0, nOf(1.4)) / base, 1.4, 1e-9, '% mode');
  near(incOf(1, nOf(1.4)) / base, 4 / 3, 1e-9, 'Rate mode: 1.4 → 4/3');
  near(incOf(1, nOf(3.6)) / base, 4, 1e-9, 'Rate mode: 3.6 → 4');
  near(incOf(1, 0.375) / base, 2 / 3, 1e-9, 'Rate mode: tie between 2/3 and 3/4 (log2 midpoint) → the smaller');
  // mono LFOs read the mono-context eff (V*M)
  const R = rig(lfoSt(2, { mode: 'free', mono: 1 }, (s) => { s.p['vc.lscale'] = nOf(2); s.p['l1.phase'] = 0.1; }), { nv: 0 });
  R.begin(1); const a = R.m.oPh[0]; R.begin(1);
  near(frac(R.m.oPh[0] - a) / R.dtC, 4, 1e-9, 'processor LFO × 2');
});

/* ------------------------------------------------------------------ matrix v2 (§5.2) */

test('matrix v2: editable curve (CT.crv, uni and bi sources), aux curve, amount × curve for voice, mono and FX contexts', () => {
  const crv = [[0, 0, 0], [0.5, 0.9, 0.4], [1, 1, 0]];
  const R = rig(st((s) => {
    Object.assign(s.p, { 'f.cutoff': 0.1, 'f.res': 0.5, 'f.var': 0.1, 'f.drive': 0.5 });
    s.matrix[0] = mrow('velo', 'f.cutoff', 0.5, { crv });
    s.matrix[1] = mrow('bend', 'f.res', 0.4, { crv });
    s.matrix[2] = mrow('fixed', 'f.var', 0.6, { aux: 'velo', acurve: 0.7 });
    s.matrix[3] = mrow('fixed', 'f.drive', 0.4, { aux: 'velo', acurve: -0.5, inv: 1 });
    s.matrix[5] = mrow('fixed', 'g.wheel', 0.5, { crv: [[0, 0.2, 0], [1, 0.2, 0]] });
    s.matrix[6] = mrow('fixed', 'g.master', 0.5, { crv: [[0, 0.3, 0], [1, 0.3, 0]] });
  }), { nv: 1 });
  const cp = R.proc.p.serum;
  assert.deepEqual(Array.from(cp.mCrv.subarray(0, 6)), [0, 1, -1, -1, 5, 6], 'CP.mCrv: slot of the row curve');
  assert.ok(cp.use & 4096);
  const vel = 0.3, v = R.vs[0];
  R.proc.bendRaw = 0.5;
  v.noteOn(60, vel);
  for (let k = 0; k < 40; k++) R.span();
  const T = R.ct.crv, u = tabAt(T, 0, 128, vel);
  near(u, CORE.evalPts(crv, vel), 1e-6, 'the CT curve is the edited graph');
  near(v.mod.eff[VI('f.cutoff')], 0.1 + 0.5 * u, 1e-12, 'uni source through the curve');
  const b = R.m.g[SIX.bend * 32 + 31], ub = tabAt(T, 129, 128, (b + 1) / 2);
  near(v.mod.eff[VI('f.res')], 0.5 + 0.4 * (2 * ub - 1), 1e-12, 'bi source: u = (s+1)/2 through the curve, back to 2u − 1');
  near(v.mod.eff[VI('f.var')], 0.1 + 0.6 * bendK(vel, 6 * 0.7), 1e-12, 'aux curve');
  near(v.mod.eff[VI('f.drive')], Math.max(0, 0.5 + 0.4 * (1 - bendK(vel, -3))), 1e-12, 'aux curve, inverted');
  near(R.m.monoOff[VI('g.wheel')], 0.5 * 0.2, 1e-7, 'mono context (Float32 CT)');
  near(R.M.fxMods(R.proc, R.sx)[0], 0.5 * 0.3, 1e-7, 'FX context');
});

test('matrix v2: RISE / FALL slew (time = 4n³ s per full uni swing, ±1 chunk; bipolar sources swing 2), voice and mono contexts', () => {
  const rise = Math.cbrt(0.1 / 4), fall = Math.cbrt(0.2 / 4);
  // voice: VELO re-captured on mono legato notes (velo.porta) steps the source at a chunk boundary 0 → 1 → 0
  {
    const R = rig(st((s) => { Object.assign(s.p, { 'f.res': 0 }); s.voicing.mono = 1; s.voicing.legato = 1; s.velo.porta = 1;
      s.matrix[3] = mrow('velo', 'f.res', 1, { rise, fall }); }), { nv: 1 });
    near(R.proc.p.serum.mRise[0], 0.1, 1e-12, 'CP seconds'); near(R.proc.p.serum.mFall[0], 0.2, 1e-12, 'CP seconds');
    const v = R.vs[0], C = VI('f.res');
    v.noteOn(60, 0);
    R.run(0.05, null, 1);
    assert.equal(v.mod.eff[C], 0);
    v.noteOn(62, 1, true);
    let t0 = R.t, up = null, dn = null;
    R.run(0.2, (w, c, t) => { if (up === null && w.mod.eff[C] >= 1) up = t - t0; }, 1);
    near(up, 0.1, 2 * R.dtC, 'rise time');
    v.noteOn(64, 0, true);
    t0 = R.t;
    R.run(0.3, (w, c, t) => { if (dn === null && w.mod.eff[C] <= 0) dn = t - t0; }, 1);
    near(dn, 0.2, 2 * R.dtC, 'fall time');
    // a new (non-legato) note restarts the slew at the source
    v.noteOn(65, 1);
    R.span(1);
    assert.equal(v.mod.eff[C], 1, 'z = s at the first evaluation after a note-on');
  }
  // bipolar source: −1 → +1 is a swing of 2 and takes the RISE time (R = 2 per §5.2); a zero FALL is instantaneous
  {
    const R = rig(st((s) => { Object.assign(s.p, { 'f.res': 0.5 }); s.matrix[0] = mrow('noise', 'f.res', 0.25, { rise, fall: 0 }); }), { nv: 1 });
    const v = R.vs[0], C = VI('f.res');
    v.onN = 1; v.nLast = -1;
    v.noteOn(60, 1);
    R.span(1);
    assert.equal(v.mod.eff[C], 0.25, 'starts at the source (z = s at the first evaluation)');
    v.nLast = 1;
    let t1 = null;
    const t0 = R.t;
    R.run(0.2, (w, c, t) => { if (t1 === null && w.mod.eff[C] >= 0.75) t1 = t - t0; }, 1);
    near(t1, 0.1, 2 * R.dtC, 'bipolar rise');
    v.nLast = -1;
    R.span(1);
    assert.equal(v.mod.eff[C], 0.25, 'FALL 0: instantaneous');
  }
  // mono context: wheel → g.bend with RISE, per processor, span duration steps
  {
    const R = rig(st((s) => { s.matrix[0] = mrow('wheel', 'm2', 1, { rise }); }), { nv: 0 });
    R.span(); R.span();
    R.proc.wheel = 1;
    const t0 = R.t, M2 = VI('m2');
    let t1 = null;
    for (let k = 0; k < 60; k++) { R.span(); if (t1 === null && R.m.monoOff[M2] >= 1 - 1e-9) t1 = R.t - t0; }
    near(t1, 0.1 + 128 / 48000, 3 * 128 / 48000, 'mono rise (± one span, one span of lag)');
  }
});

test('matrix v2: randd — one r2 draw per slot at note-on, distinct per row, stable across edits; no r2 draws without mRd; the Phase-1 stream r is untouched', () => {
  const play = (rows) => {
    const R = rig(st((s) => { Object.assign(s.p, { 'f.cutoff': 0, 'f.res': 0, 'f.var': 0 }); for (const [j, r] of rows) s.matrix[j] = r; }), { nv: 1 });
    const v = R.vs[0];
    v.noteOn(60, 1);
    R.span(4);
    return { R, v, eff: (id) => v.mod.eff[VI(id)], rd: Array.from(v.mod.rd), r2: v.r2, r2At: v.r2At, vR: [v.mod.vR1, v.mod.vR2, ...v.mod.ch] };
  };
  const draws = r2Seq(XS(PSEED) || 1, 0, 64);
  const a = play([[2, mrow('randd', 'f.cutoff', 1)], [7, mrow('fixed', 'f.res', 1, { aux: 'randd' })]]);
  assert.deepEqual(Array.from(a.R.proc.p.serum.mSlot.subarray(0, 3)), [2, 7, 0], 'CP.mSlot: slots of the compacted rows, then the idle slots');
  assert.deepEqual(a.rd, draws, '64 draws from the voice r2 stream, slot order');
  near(a.eff('f.cutoff'), draws[2], 1e-15, 'the row in slot 2 reads draw 2');
  near(a.eff('f.res'), draws[7], 1e-15, 'slot 7 (as aux) reads draw 7');
  assert.notEqual(a.eff('f.cutoff'), a.eff('f.res'), 'distinct per row');
  // edits: amounts, rows added before and after, a third randd row — every row keeps its slot's draw
  const b = play([[0, mrow('fixed', 'f.var', 0.1)], [2, mrow('randd', 'f.cutoff', 0.5)], [7, mrow('fixed', 'f.res', 1, { aux: 'randd' })],
    [40, mrow('randd', 'f.drive', 1)]]);
  assert.deepEqual(b.rd, a.rd);
  near(b.eff('f.cutoff'), 0.5 * a.eff('f.cutoff'), 1e-15, 'same draw');
  assert.equal(b.eff('f.res'), a.eff('f.res'));
  near(b.eff('f.drive') - b.R.proc.p.serum.base[VI('f.drive')], draws[40], 1e-15, 'slot 40');
  // the slot mapping drives the slew state and the snapshot's mOut too (mOut[slot])
  const sn = b.R.snap();
  near(sn.mOut[2], 0.5 * draws[2], 1e-7, 'mOut by slot'); assert.equal(sn.mOut[0], Math.fround(0.1)); assert.equal(sn.mOut[1], 0);
  // no row reads randd: no r2 draw at all (VC off, no S&H / chaos LFO)
  const d = play([[2, mrow('velo', 'f.cutoff', 1)]]);
  assert.equal(d.r2, d.r2At, 'r2 untouched');
  assert.equal(d.rd.every((x) => x === 0), true);
  assert.notEqual(a.r2, a.r2At);
  // the Phase-1 stream: rand1, rand2 and the chaos start values are the same with and without randd rows
  assert.deepEqual(a.vR, d.vR);
});

test('randd rows leave the Phase-1 voice stream r of serum-dsp untouched: rand1/rand2, chaos, unison table, start phases, noise start (§6.2)', () => {
  const run = (withRd) => {
    const ctx = scope(v2Files()), S = ctx.SerumDSP;
    const s = st((x) => {
      Object.assign(x.p, { 'a.uni': 0.4, 'b.on': 1, 'b.uni': 0.6, 'a.rand': 0.7, 'b.rand': 0.3, 'n.on': 1, 'n.rand': 0.8 });
      x.matrix[0] = mrow('rand1', 'f.res', 0.1); x.matrix[1] = mrow('rand2', 'f.var', 0.1);
      if (withRd) { x.matrix[9] = mrow('randd', 'f.cutoff', 0.3); x.matrix[20] = mrow('velo', 'f.drive', 0.2, { aux: 'randd' }); }
    });
    const p = CORE.compileSerum(CORE.normalizeSerum(s), { bpm: 120 });
    const proc = makeProc(48000, 2);
    for (const id of p.needs) { const e = entryOf(WT, id); if (e) S.storeWT(id, e); }
    proc.p = p; proc.ct = p.serumT;
    const vs = [0, 1].map((i) => new S.SerumVoice(proc, i));
    proc.voices = vs;
    for (const v of vs) v.apply(p);
    const out = [];
    const L = new Float64Array(256), R = new Float64Array(256);
    for (let k = 0; k < 6; k++) {
      const v = vs[k % 2];
      v.noteOn(48 + 5 * k, 0.8, false, 1);
      out.push(v.mod.vR1, v.mod.vR2, ...v.mod.ch, ...v.uRnd.subarray(0, 32), ...v.uPh.subarray(0, 32), v.nPos);
      S.begin(proc, 256); for (const w of vs) if (w.active) w.render(L, R, 256);
    }
    return out;
  };
  assert.deepEqual(run(true), run(false));
});

/* ------------------------------------------------------------------ macros, MPE, Voice Control, new sources */

test('macros 1–8: sources smoothed on the eff macro value; macros as destinations (mono context, one span per hop, clamped); clip lanes override the base', () => {
  const R = rig(st((s) => {
    s.macros[0].v = 1; s.macros[6].v = 0.25;
    s.matrix[0] = mrow('macro1', 'm2', 0.5);                  // macro1 → macro2
    s.matrix[1] = mrow('macro2', 'm3', 1);                    // → macro3 (a second hop)
    s.matrix[2] = mrow('macro4', 'm4', 1);                    // self-modulation stays bounded
    s.matrix[3] = mrow('macro7', 'f.res', 1); s.matrix[4] = mrow('macro8', 'f.var', 1);
  }), { nv: 0 });
  const g = (src, c = 31) => R.m.g[SIX[src] * 32 + c];
  R.span();
  // span 1: macro1 jumped to its base at the first sync (snapshot of the bases); macro2's target saw the previous span's
  // macro1 (0 before the first span): one span of lag per hop
  assert.equal(g('macro1'), 1);
  assert.equal(g('macro7'), 0.25);
  assert.equal(g('macro2'), 0, 'm2 lags one span');
  R.span();
  near(g('macro2'), 0.5 * (1 - Math.exp(-128 / 48000 / 0.006)), 1e-3, 'm2 moving towards 0.5 (smoothed, τ 6 ms)');
  assert.equal(g('macro3'), 0, 'm3 one more span behind');
  for (let k = 0; k < 400; k++) R.span();
  near(g('macro2'), 0.5, 1e-9, 'macro2 = clamp(0 + 0.5·macro1)');
  near(g('macro3'), 0.5, 1e-9, 'second hop');
  assert.equal(g('macro4'), 0, 'self-modulation from 0 stays at 0');
  // a clip lane replaces the base while it plays (NaN = no lane)
  R.proc.seqMacro.set([NaN, NaN, NaN, NaN, NaN, NaN, 0.75, NaN]);
  for (let k = 0; k < 400; k++) R.span();
  near(g('macro7'), 0.75, 1e-9, 'clip lane');
  R.proc.seqMacro[6] = NaN;
  for (let k = 0; k < 400; k++) R.span();
  near(g('macro7'), 0.25, 1e-9, 'back to the base');
  // the self-modulated macro is bounded by the clamp
  const Q = rig(st((s) => { s.macros[3].v = 0.6; s.matrix[0] = mrow('macro4', 'm4', 1); }), { nv: 0 });
  for (let k = 0; k < 400; k++) { Q.span(); const x = Q.m.g[SIX.macro4 * 32 + 31]; assert.ok(x >= 0 && x <= 1); }
  near(Q.m.g[SIX.macro4 * 32 + 31], 1, 1e-6, 'runs to the clamp');
  // smoothing τ = 6 ms (Phase 1) on the eff macro value: macro5–8 like macro1–4
  // (a CP change while no voice sounds snaps the bases, Phase 1: the step comes from a clip lane)
  const P = rig(st((s) => { s.matrix[0] = mrow('macro5', 'f.res', 1); }), { nv: 0 });
  P.span();
  P.proc.seqMacro[4] = 1;
  let t63 = null;
  for (let k = 0; k < 200 && t63 === null; k++) { P.begin(1); if (P.m.g[SIX.macro5 * 32] >= 1 - Math.exp(-1)) t63 = (k + 1) * P.dtC; }
  near(t63, 0.006, P.dtC, 'τ 6 ms');
});

test('MPE sources (§6.17): member-channel X (CC10) / Y / Z, bend → mpeSt, mpeBendX, mpeYBi, generated-note expression, XYZ → macros per voice, Y → wheel', () => {
  const mk = (xyz, ctx = {}) => {
    const R = rig(st((s) => { s.global.mpe = { on: 1, bend: 24, xyz }; s.matrix[0] = mrow('mpex', 'f.res', 0.1); s.matrix[1] = mrow('mpey', 'f.var', 0.1);
      s.matrix[2] = mrow('mpez', 'f.drive', 0.1); s.matrix[3] = mrow('macro1', 'f.cutoff', 0.1); s.matrix[4] = mrow('wheel', 'f.mix', 0.1); }), { nv: 3, ctx });
    assert.ok(R.proc.p.serum.use & 256);
    return R;
  };
  const set = (R, ch, b, y, z, x) => { const P = R.proc.mpe; P[ch * 4] = b; P[ch * 4 + 1] = y; P[ch * 4 + 2] = z; P[ch * 4 + 3] = x; };
  {
    const R = mk(0);
    set(R, 2, 0.5, 0.25, 0.75, -1);
    const v = R.vs[0];
    v.noteOn(60, 1, false, 2);
    const s = v.mod.src;
    assert.deepEqual([s[SIX.mpex], s[SIX.mpey], s[SIX.mpez]], [-1, 0.25, 0.75], 'note-on: the channel values (no smoothing lag)');
    assert.equal(v.mod.mpeSt, 0.5 * 24, 'per-note bend × CP.mpeBend');
    set(R, 2, -1, 1, 0, 1);
    R.run(0.03);
    near(s[SIX.mpex], 1, 1e-6, 'X smoothed to CC10'); near(s[SIX.mpey], 1, 1e-6, 'Y'); near(s[SIX.mpez], 0, 1e-6, 'Z');
    near(v.mod.mpeSt, -24, 1e-4, 'bend');
    // τ 1.5 ms per chunk
    set(R, 2, 0, 0, 0, 0);
    let t = null; const t0 = R.t;
    R.run(0.01, (w, c, tt) => { if (w === v && t === null && w.mod.src[SIX.mpey] <= Math.exp(-1)) t = tt - t0; }, 1);
    near(t, 0.0015, 2 * R.dtC, 'τ 1.5 ms');
    // channel 1 (master) and channel 0: no member expression
    v.noteOn(62, 1, false, 1);
    assert.equal(v.mod.mpeCh, 0);
    assert.deepEqual([v.mod.src[SIX.mpex], v.mod.src[SIX.mpey], v.mod.mpeSt], [0, 0, 0]);
    // generated note (ch 0) with expression x, y, z ∈ [0, 1] as stored in clips (§2.4.2): X = 2x − 1 (x 0.5 neutral)
    R.vs[1].noteOn(64, 1, false, 0, Float64Array.of(0.75, 0.25, 0.125));
    assert.deepEqual([R.vs[1].mod.src[SIX.mpex], R.vs[1].mod.src[SIX.mpey], R.vs[1].mod.src[SIX.mpez]], [0.5, 0.25, 0.125]);
    R.vs[2].noteOn(65, 1, false, 0, Float64Array.of(0.5, 0.5, 0));
    assert.deepEqual([R.vs[2].mod.src[SIX.mpex], R.vs[2].mod.src[SIX.mpey], R.vs[2].mod.src[SIX.mpez]], [0, 0.5, 0], 'neutral clip note');
    R.vs[2].noteOn(66, 1, false, 0, Float64Array.of(0, 1, 1));
    assert.equal(R.vs[2].mod.src[SIX.mpex], -1, 'x 0 → X −1');
  }
  // mpeBendX: X follows the per-note bend; mpeYBi: Y reported bipolar
  {
    const R = mk(0, { mpeBendX: 1, mpeYBi: 1 });
    set(R, 3, 0.4, 0.25, 0, -0.9);
    R.vs[0].noteOn(60, 1, false, 3);
    assert.equal(R.vs[0].mod.src[SIX.mpex], 0.4);
    assert.equal(R.vs[0].mod.src[SIX.mpey], -0.5);
  }
  // XYZ → macros 1–3 per voice ((x+1)/2, y, z); the mono context uses the recent voice; Y → wheel
  {
    const R = mk(1);
    set(R, 2, 0, 0.3, 0.6, 0.5); set(R, 4, 0, 0.8, 0.1, -0.5);
    R.vs[0].noteOn(60, 1, false, 2); R.vs[1].noteOn(64, 1, false, 4);
    R.run(0.15);
    near(R.vs[0].mod.src[SIX.macro1], 0.75, 1e-6, 'voice 0 macro1 = (x+1)/2'); near(R.vs[0].mod.src[SIX.macro2], 0.3, 1e-6, '');
    near(R.vs[1].mod.src[SIX.macro1], 0.25, 1e-6, 'voice 1 macro1'); near(R.vs[1].mod.src[SIX.macro3], 0.1, 1e-6, '');
    near(R.m.g[SIX.macro2 * 32 + 31], 0.8, 1e-6, 'mono context: the recent voice');
    const W = mk(3);
    set(W, 2, 0, 0.7, 0, 0);
    W.vs[0].noteOn(60, 1, false, 2); W.run(0.03);
    near(W.vs[0].mod.src[SIX.wheel], 0.7, 1e-6, 'Y → wheel');
  }
  // MPE off: channels ignored (Phase-1 behaviour)
  {
    const R = rig(st((s) => { s.matrix[0] = mrow('mpex', 'f.res', 0.1); }), { nv: 1 });
    set(R, 2, 0.5, 0.5, 0.5, 0.5);
    R.vs[0].noteOn(60, 1, false, 2);
    R.run(0.01);
    assert.deepEqual([R.vs[0].mod.mpeCh, R.vs[0].mod.xpOn, R.vs[0].mod.src[SIX.mpex], R.vs[0].mod.mpeSt], [0, 0, 0, 0]);
  }
});

test('Voice Control (§6.2, §6.16): step k = vcN mod len, vidx/vmod1/vmod2, per-note offsets with r2 draws, envS scales envelope times, transport resets vcN', () => {
  const steps = [[0.5, -0.25, 0.4, 1, 0.3, -0.6], [-1, 0.5, -0.2, -1, 0.9, 0.1], [0, 0, 0, 0, -0.5, 0.5]];
  const R = rig(st((s) => {
    s.vc.len = 3; steps.forEach((x, j) => { s.vc.steps[j] = x; });
    Object.assign(s.p, { 'vc.pan': 0.5, 'vc.det': 0.25, 'vc.cut': 1, 'vc.env': 0.5, 'e2.att': timeN(0.2) });
    s.matrix[0] = mrow('vidx', 'f.res', 0.1); s.matrix[1] = mrow('vmod1', 'f.var', 0.1); s.matrix[2] = mrow('vmod2', 'f.drive', 0.1);
  }), { nv: 1 });
  assert.ok(R.proc.p.serum.use & 1024);
  const v = R.vs[0], mv = v.mod;
  let rng = PSEED;
  for (let n = 0; n < 7; n++) {
    v.noteOn(60 + n, 1);
    rng = XS(rng) || 1;
    const k = n % 3, S = steps[k], u = r2Seq(rng, 0, 4).map((x) => 2 * x - 1);
    assert.equal(R.proc.vcN, n + 1);
    assert.deepEqual([mv.src[SIX.vidx], mv.src[SIX.vmod1], mv.src[SIX.vmod2]], [k / 3, S[4], S[5]], `note ${n}: step ${k}`);
    near(mv.vc[0], S[0] + 0.5 * u[0], 1e-12, 'panO'); near(mv.vc[1], 100 * (S[1] + 0.25 * u[1]), 1e-9, 'detO (cents)');
    near(mv.vc[2], 0.5 * S[2] + 0.25 * 1 * u[2], 1e-12, 'cutO'); near(mv.vc[3], Math.pow(2, S[3] + 0.5 * u[3]), 1e-12, 'envS');
    R.span();
  }
  // envS × eff vc.escale scale the envelope times
  const att = (p, vc) => {
    const Q = rig(st((s) => { Object.assign(s.p, { 'e2.att': timeN(0.2), ...p }); if (vc) { s.vc.len = 1; s.vc.steps[0] = [0, 0, 0, vc, 0, 0]; } }), { nv: 1 });
    Q.vs[0].noteOn(60, 1);
    let end = null;
    Q.run(1, (w, c, t) => { if (end === null && w.mod.eSt[1] > 1) end = t; }, 4);
    return end;
  };
  near(att({}, 0), 0.2, 2 * R.dtC, 'neutral');
  near(att({}, 1), 0.4, 2 * R.dtC, 'envS = 2');
  near(att({ 'vc.escale': Math.log2(4 * 0.5) / 4 }, 0), 0.1, 2 * R.dtC, 'escale 0.5');
  near(att({ 'vc.escale': Math.log2(4 * 0.5) / 4 }, 1), 0.2, 2 * R.dtC, 'both');
  // transport (play) resets the step counter; legato notes do not advance it
  R.proc.beat = 0; R.M.transport(R.proc, R.sx, true);
  assert.equal(R.proc.vcN, 0);
  // VC inactive: no draws, neutral offsets
  const N = rig(st(), { nv: 1 });
  N.vs[0].noteOn(60, 1);
  assert.deepEqual(Array.from(N.vs[0].mod.vc), [0, 0, 0, 1]);
  assert.equal(N.vs[0].r2, N.vs[0].r2At);
  assert.equal(N.proc.vcN, 0);
});

test('new sources: env4, lfo9/10, actv (active ÷ POLY, end of the previous span), audio taps zeroed at a fresh note-on and never computed', () => {
  const R = rig(st((s) => {
    s.voicing.poly = 4;
    s.matrix[0] = mrow('actv', 'f.res', 0.1); s.matrix[1] = mrow('lfo9', 'f.var', 0.1); s.matrix[2] = mrow('lfo10', 'f.drive', 0.1);
    s.matrix[3] = mrow('env4', 'f.mix', 0.1); s.matrix[4] = mrow('osca', 'f.cutoff', 0.1);
    s.lfo[8] = { ...s.lfo[8], bpm: 0, pts: RAMP }; s.p['l9.rate'] = hzN(2);
    s.lfo[9] = { ...s.lfo[9], bpm: 0, pts: [[0, 1, 0], [1, 0, 0]] }; s.p['l10.rate'] = hzN(2);
  }), { nv: 4 });
  assert.ok(R.proc.p.serum.use & 2048);
  R.vs[0].noteOn(60, 1); R.vs[1].noteOn(62, 1); R.vs[2].noteOn(64, 1);
  R.span();
  R.span(32, (v) => assert.equal(v.mod.src[SIX.actv], 3 / 4));
  const v = R.vs[0];
  R.run(0.1);
  const ph = 2 * (R.t - R.dtC);
  near(v.mod.src[SIX.lfo9], ph, 2 * 2 * R.dtC, 'LFO 9'); near(v.mod.src[SIX.lfo10], 1 - ph, 2 * 2 * R.dtC, 'LFO 10');
  assert.equal(v.mod.src[SIX.env4], v.mod.eV[3]);
  // taps: written by the voice, read by the next matrix, zeroed at a fresh note-on, kept on a steal
  v.mod.src[SIX.osca] = 0.5;
  R.span(1);
  assert.equal(v.mod.src[SIX.osca], 0.5, 'SxMod never computes a tap');
  v.noteOn(65, 1);
  assert.equal(v.mod.src[SIX.osca], 0.5, 'steal: kept');
  R.vs[3].mod.src[SIX.osca] = 0.25;
  R.vs[3].noteOn(67, 1);
  for (let k = 52; k <= 57; k++) assert.equal(R.vs[3].mod.src[k], 0, 'fresh voice: 0');
  // mono: active ÷ 1, clamped
  const M = rig(st((s) => { s.voicing.mono = 1; s.matrix[0] = mrow('actv', 'f.res', 0.1); }), { nv: 2 });
  M.vs[0].noteOn(60, 1); M.vs[1].noteOn(62, 1); M.span(); M.span();
  assert.equal(M.m.g[SIX.actv * 32], 1);
});

test('snapshot (§6.20): eff by vi then FX-context eff, LFO 1–10 phase/out/Y, ENV 1–4, mOut per row slot', () => {
  const R = rig(st((s) => {
    s.lfo[1] = { ...s.lfo[1], type: 'path', bpm: 0 }; s.p['l2.rate'] = hzN(1);
    s.matrix[0] = mrow('fixed', 'f.res', 0.25); s.matrix[1] = mrow('lfo2y', 'f.var', 0.5); s.matrix[2] = mrow('fixed', 'g.master', 0.125);
  }), { nv: 1, mon: 1 });
  R.vs[0].noteOn(60, 1);
  R.run(0.2);
  const s = R.snap(), mv = R.vs[0].mod;
  for (let i = 0; i < NSV; i++) assert.equal(s.eff[i], Math.fround(mv.eff[i]));
  assert.equal(s.lfoY[1], Math.fround(mv.lY[1]));
  assert.ok(s.lfoY[1] > 0);
  for (let e = 0; e < 4; e++) assert.equal(s.env[e], Math.fround(mv.eV[e]));
  assert.equal(s.mOut[0], 0.25); assert.equal(s.mOut[1], Math.fround(0.5 * mv.lY[1])); assert.equal(s.mOut[2], 0.125);
  assert.equal(s.eff[NSV], 0.125, 'FX-context eff (no FXP: base 0 + offset)');
});

/* ------------------------------------------------------------------ §0.7 neutral terms, allocation-free */

// SxMod source with a term's code removed (each replacement must match exactly once)
function without(pairs) {
  let code = SRC.mod;
  for (const [a, b] of pairs) {
    const n = code.split(a).length - 1;
    assert.equal(n, 1, 'transform anchor found once: ' + a);
    code = code.replace(a, () => b);
  }
  return code;
}
// a seeded session on a rig built from `modSrc`: notes (steal, legato, MPE channels), performance controls, transport,
// span sizes; returns the trace of every chunk's eff / src / envelopes / LFO outputs and the per-span mono / FX vectors
function trace(modSrc, s, seed, { OS = 2, nv = 3, spans = 260 } = {}) {
  const R = rig(s, { OS, nv, files: [['sx-base.js', SRC.base], ['sx-mod.js', modSrc]], mon: 1 });
  const r = H.mulberry32(seed), out = [];
  const push = (a) => { for (let i = 0; i < a.length; i++) out.push(a[i]); };
  for (let sp = 0; sp < spans; sp++) {
    const x = r();
    if (x < 0.08) { const i = Math.floor(r() * nv), v = R.vs[i]; v.noteOn(36 + Math.floor(r() * 48), r(), v.active && r() < 0.2, r() < 0.5 ? 2 + i : 0); }
    else if (x < 0.12) { const v = R.vs[Math.floor(r() * nv)]; if (v.gate) v.noteOff(r()); }
    else if (x < 0.15) {
      R.proc.wheel = r(); R.proc.bendRaw = 2 * r() - 1; R.proc.at = r();
      const P = R.proc.mpe, c = 2 + Math.floor(r() * nv);                    // MPE member channel state (§6.17)
      P[c * 4] = 2 * r() - 1; P[c * 4 + 1] = r(); P[c * 4 + 2] = r(); P[c * 4 + 3] = 2 * r() - 1;
    }
    else if (x < 0.16) { R.proc.beat = r() < 0.7 ? 16 * r() : null; R.proc.bpm = 70 + Math.floor(100 * r()); R.M.transport(R.proc, R.sx, R.proc.beat !== null); }
    R.span(1 + Math.floor(r() * 32), (v) => { push(v.mod.eff); push(v.mod.src); push(v.mod.eV); push(v.mod.lVal); push(v.mod.lY); });
    push(R.m.monoEff); push(R.m.g); push(R.M.fxMods(R.proc, R.sx).subarray(0, 16));
  }
  return out;
}
function sameTrace(a, b, what) {
  assert.equal(a.length, b.length, what + ' trace length');
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}: first difference at ${i}: ${a[i]} vs ${b[i]}`);
}
// an S2-mode state with many v2 features on (each test leaves its own term neutral)
function busy(s, keep = {}) {
  s.global.s1 = 0;
  const kinds = [['retrig', 0], ['env', 0], ['free', 0], ['free', 1], ['retrig', 1], ['env', 1]];
  for (let l = 0; l < 10; l++) {
    const [mode, mono] = kinds[l % 6];
    s.lfo[l] = { ...s.lfo[l], mode, mono, bpm: l % 3 === 0 ? 1 : 0, anchor: l % 2, pts: [[0, 0.2, 0], [0.3, 1, 0.5], [0.7, 0.1, -0.3], [1, 0.6, 0]], loop: mode === 'env' ? 1 : -1, start: l % 4 };
    if (!keep.lfoNeutral) Object.assign(s.lfo[l], { type: ['normal', 'path', 'lorenz', 'rossler', 'sh'][l % 5], dir: ['fwd', 'rev', 'pp'][l % 3], x10: l % 4 === 1 ? 1 : 0, swing: 1 });
    s.p[`l${l + 1}.rate`] = 0.3 + 0.05 * l; s.p[`l${l + 1}.delay`] = l % 2 ? 0.01 : 0; s.p[`l${l + 1}.smooth`] = l % 3 === 2 ? 0.3 : 0;
    if (!keep.phase0) s.p[`l${l + 1}.phase`] = 0.1 * l;
  }
  if (!keep.lfoNeutral) s.kbd.swing = 0.4;
  for (const e of [2, 3, 4]) Object.assign(s.p, { [`e${e}.att`]: timeN(0.05), [`e${e}.dec`]: timeN(0.1), [`e${e}.sus`]: 0.4 });
  if (!keep.startEnd0) Object.assign(s.p, { 'e2.start': 0.3, 'e3.end': 0.2, 'e4.start': 0.1, 'e4.end': 0.05 });
  if (!keep.vcOff) { s.vc.len = 3; s.vc.steps[0] = [0.2, 0.1, 0.3, keep.envS1 ? 0 : 0.5, 0.4, -0.2]; s.vc.steps[1] = [-0.2, 0, 0.1, keep.envS1 ? 0 : -0.5, 0.1, 0.9];
    Object.assign(s.p, { 'vc.pan': 0.3, 'vc.det': 0.2, 'vc.cut': 0.4, 'vc.env': keep.envS1 ? 0 : 0.3 }); }
  if (!keep.scale05) Object.assign(s.p, { 'vc.escale': 0.6, 'vc.lscale': 0.4 });
  if (!keep.mpeOff) s.global.mpe = { on: 1, bend: 12, xyz: 1 };
  s.env[1].legInv = 1; s.env[2].stealRe = 1; s.env[3].bpm = 1; s.voicing.legato = 1;
  const srcs = ['env1', 'env2', 'env3', 'env4', 'lfo1', 'lfo2', 'lfo2y', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'lfo9', 'lfo10', 'velo',
    'note', 'mpex', 'mpey', 'macro1', 'macro5', keep.vcOff ? 'rand2' : 'vidx', keep.vcOff ? 'alt1' : 'vmod1', 'actv', 'rand1', 'wheel'];
  const dsts = ['f.cutoff', 'f.res', 'f.var', 'a.wt', 'b.wt', 'l3.rate', keep.phase0 ? 'l1.smooth' : 'l1.phase', 'e2.att', 'm2', 'g.wheel',
    keep.scale05 ? 'f.mix' : 'vc.lscale', 'g.master', keep.startEnd0 ? 'e2.sus' : 'e2.start'];
  for (let j = 0; j < 30; j++) {
    const x = keep.plainRows ? {} : { crv: j % 4 === 0 ? [[0, 0, 0], [0.4, 0.8, 0.3], [1, 1, 0]] : null, rise: j % 5 === 1 ? 0.2 : 0, fall: j % 5 === 2 ? 0.3 : 0, acurve: j % 3 === 0 ? 0.4 : 0 };
    s.matrix[2 * j] = mrow(srcs[j % srcs.length], dsts[j % dsts.length], (j % 2 ? -1 : 1) * (0.1 + 0.02 * j), { bi: j % 2, aux: j % 7 === 3 ? 'velo' : '', ...x });
  }
  if (!keep.plainRows) s.matrix[61] = mrow('randd', 'f.drive', 0.3);
  s.macros[0].v = 0.4; s.macros[4].v = 0.7;
  return s;
}

test('§0.7 neutral terms (D2 rows): each term at its neutral value renders bit-identically to the same patch with its code removed', () => {
  const cases = [
    ['VC per-note offsets (use & 1024 = 0)', { vcOff: 1 }, [['m.vcOn = use & 1024 ? 1 : 0;', 'm.vcOn = 0;'], ['let s = this.vc[3];', 'let s = 1;']]],
    ['vc.escale / vc.lscale at n 0.5', { scale05: 1 }, [['if (n !== 0.5) s *= 0.25 * pow(16, n);', ''], ['if (n === 0.5) return 1;', 'return 1;']]],
    ['lN.phase = 0 (start = pts[start].x)', { phase0: 1 }, [['if (d === 0) return s;', 'return s;'],
      ['if (d !== 0) { const u = ph + d, f = floor(u); rp = u - f; cr = cy + f; }', ''],
      ['if (d !== 0) { const u = p + d, f = floor(u); p = u - f; c += f; }', ''], ['return d !== 0 ? c + floor(m.fPh[j] + d) : c;', 'return c;']]],
    ['ENV 2–4 Start / End = 0', { startEnd0: 1 }, [['return e > 0 ? this.eff[ESTART[e]] : 0;', 'return 0;'], ['E0 = e === 0 ? 0 : eff[EEND[e]];', 'E0 = 0;']]],
    ['matrix crv / acurve / rise / fall / randd absent', { plainRows: 1 }, [['m.mX[r] = x;', 'm.mX[r] = 0;'], ['m.anyRd = anyRd;', 'm.anyRd = 0;']]],
    ['MPE off (use & 256 = 0)', { mpeOff: 1 }, [['this.xpOn = this.mpeCh > 0 || this.exOn ? 1 : 0;', 'this.xpOn = 0;']]],
    ['LFO direction / swing / ×10 / types neutral: the general path equals the Phase-1 fast path', { lfoNeutral: 1, phase0: 1, scale05: 1 },
      [['m.lExt[l] = dir !== 0 || ty !== 0 || (x10 && !bpm) || m.lSw[l] !== 0 || m.hostHz[l] !== 0 ? 1 : 0;', 'm.lExt[l] = 1;']]],
  ];
  for (const [what, keep, pairs] of cases) {
    const s = busy(st(), keep), cut = without(pairs);
    for (const seed of [11, 12]) sameTrace(trace(SRC.mod, s, seed), trace(cut, s, seed), what);
  }
  // and the terms are live when not neutral (the transforms are not no-ops)
  const s = busy(st());
  for (const [what, , pairs] of cases.slice(0, 6)) {
    const a = trace(SRC.mod, s, 11), b = trace(without(pairs), s, 11);
    assert.ok(a.some((x, i) => !Object.is(x, b[i])), what + ': the removed code matters off-neutral');
  }
});

// fn() with the allocating constructors of the vm context replaced by throwing stubs (code inside the scope looks them up)
function noAllocIn(ctx, fn) {
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Set', 'Object'];
  const saved = {};
  for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
  try { fn(); } finally { for (const k of names) ctx[k] = saved[k]; }
}
test('allocation-free with every v2 modulation feature: sync of new CPs, CT changes, begin, notes (steal, legato, MPE, VC, randd), matrix, fxMods, snap', () => {
  const states = [busy(st()), busy(st(), { vcOff: 1 }), busy(st(), { mpeOff: 1, plainRows: 1 })];
  const R = rig(states[0], { OS: 2, nv: 4, mon: 1 });
  const pats = states.map((s) => { const p = CORE.compileSerum(CORE.normalizeSerum(s), { bpm: 120 }); return [p, CORE.assembleCT(p.serumT)]; });
  const snapObj = { eff: new Float32Array(NSV + MAXFX), lfoPh: new Float32Array(10), lfoOut: new Float32Array(10), lfoY: new Float32Array(10),
    env: new Float32Array(4), envStage: new Float32Array(4), envT: new Float32Array(4), mOut: new Float32Array(64) };
  const ex = Float64Array.of(0.2, 0.4, 0.6);
  R.proc.seqMacro[1] = 0.5;
  for (let k = 0; k < 30; k++) { if (k % 7 === 0) R.vs[k % 4].noteOn(40 + k, 0.7, false, 2 + (k % 4)); R.span(); }
  const r = H.mulberry32(77);
  noAllocIn(R.sc, () => {
    for (let k = 0; k < 400; k++) {
      if (k % 60 === 30) { const [p, ct] = pats[(k / 60 | 0) % 3]; R.proc.p = p; R.ct = ct; R.gen++; }
      const x = r();
      if (x < 0.1) { const v = R.vs[Math.floor(r() * 4)]; v.noteOn(36 + Math.floor(r() * 40), r(), v.active && r() < 0.3, Math.floor(r() * 3) ? 2 + v.i : 0, r() < 0.5 ? ex : null); }
      else if (x < 0.15) R.vs[Math.floor(r() * 4)].noteOff(r());
      if (k === 200) { R.proc.beat = 3; R.M.transport(R.proc, R.sx, true); }
      R.span(1 + Math.floor(r() * 32));
      R.M.snap(R.proc, R.sx, snapObj);
    }
  });
  assert.ok(R.vs.some((v) => v.active));
});

/* ------------------------------------------------------------------ review round (M2 fixes) */

test('note-on pre-restart pass (§6.2): rows into eN.start, lN.phase and vc.* take this note\'s sources on fresh and stolen voices', () => {
  const R = rig(st((s) => {
    Object.assign(s.p, { 'e2.att': timeN(1), 'e2.start': 0, 'vc.pan': 0, 'vc.det': 0, 'vc.cut': 0, 'vc.env': 0 });
    s.env[1].stealRe = 1;
    s.lfo[0] = { ...s.lfo[0], bpm: 0, anchor: 0, pts: RAMP }; s.p['l1.rate'] = hzN(0.5);
    s.vc.steps[0] = [0.1, -0.2, 0.3, 0.25, 0, 0];
    s.matrix[0] = mrow('velo', 'e2.start', 1); s.matrix[1] = mrow('rand1', 'l1.phase', 1);
    for (const [j, d] of [[2, 'vc.pan'], [3, 'vc.det'], [4, 'vc.cut'], [5, 'vc.env']]) s.matrix[j] = mrow('velo', d, 1);
    s.matrix[6] = mrow('lfo1', 'f.res', 0.1); s.matrix[7] = mrow('env2', 'f.var', 0.1);
  }), { nv: 2 });
  const cp = R.proc.p.serum, S = cp.vcSteps;
  assert.ok(cp.use & 1024, 'Voice Control active');
  const check = (v, what) => {
    const mv = v.mod, vel = mv.vVelo, u = mv.vcU, k6 = mv.vK * 6;
    assert.equal(mv.eV0[1], vel, what + ': ENV 2 restarts from the Start level of this note');
    assert.equal(mv.src[SIX.env2], vel, what + ': the note-on evaluation sees it');
    near(mv.lPh[0], frac(mv.vR1), 1e-15, what + ': LFO 1 starts at this note\'s rand1');
    near(mv.vc[0], S[k6] + vel * u[0], 1e-15, what + ': panO'); near(mv.vc[1], 100 * (S[k6 + 1] + vel * u[1]), 1e-12, what + ': detO');
    near(mv.vc[2], 0.5 * S[k6 + 2] + 0.25 * vel * u[2], 1e-15, what + ': cutO'); near(mv.vc[3], Math.pow(2, S[k6 + 3] + vel * u[3]), 1e-15, what + ': envS');
  };
  R.vs[0].noteOn(60, 0.9); check(R.vs[0], 'fresh voice 0');
  R.vs[1].noteOn(62, 0.3); check(R.vs[1], 'fresh voice 1');
  R.run(0.2);
  for (const v of R.vs) v.noteOff();
  R.vs[0].noteOn(70, 0.1); check(R.vs[0], 'stolen voice (never the previous note\'s eff)');
  R.vs[1].noteOn(72, 0.6); check(R.vs[1], 'stolen voice 1');
  // the first chunk continues from the restart: LFO 1 and ENV 2 without a step
  const x0 = R.vs[0].mod.src[SIX.lfo1];
  R.span(1);
  near(R.vs[0].mod.src[SIX.lfo1], x0, 1e-12, 'LFO 1 at chunk 0 = its note-on value');
  // BPM + HOST (the S2 default LFO): no jump in the first chunks after the note-on
  {
    const Q = rig(st((s) => { s.lfo[1] = { ...s.lfo[1], pts: RAMP }; s.matrix[0] = mrow('rand1', 'l2.phase', 1); s.matrix[1] = mrow('lfo2', 'f.res', 0.2); }), { nv: 1 });
    Q.span(8);
    Q.vs[0].noteOn(60, 1);
    const seq = [Q.vs[0].mod.src[SIX.lfo2]];
    Q.span(4, (v) => seq.push(v.mod.src[SIX.lfo2]));
    near(seq[0], frac(Q.vs[0].mod.vR1), 1e-3, 'starts at rand1');
    for (let i = 1; i < seq.length; i++) assert.ok(Math.abs(seq[i] - seq[i - 1]) < 1e-3, 'continuous: ' + seq.map((x) => x.toFixed(4)));
  }
  // per-voice Hz-HOST LFO during playback: the restart phase uses this note's modulated rate
  {
    const Q = rig(st((s) => {
      s.lfo[2] = { ...s.lfo[2], bpm: 0, anchor: 1, pts: RAMP }; s.p['l3.rate'] = hzN(2);
      s.matrix[0] = mrow('velo', 'l3.rate', 0.1); s.matrix[1] = mrow('lfo3', 'f.res', 0.2);
    }), { nv: 1 });
    Q.proc.beat = 5;
    Q.span(); Q.span();
    Q.vs[0].noteOn(60, 0.7);
    const n = Q.proc.p.serum.base[VI('l3.rate')] + 0.1 * Q.vs[0].mod.vVelo, hz = 100 * n ** 4, sec = Q.proc.beat * 60 / 120;
    near(Q.vs[0].mod.lPh[2], frac(sec * hz), 1e-9, 'frac(start + songSeconds·rate(eff))');
  }
  // legato with Legato Inverted + Voice Steal Retrigger: the Start level follows the new note's velocity (velo.porta)
  {
    const Q = rig(st((s) => { s.voicing.mono = 1; s.voicing.legato = 1; s.velo.porta = 1; s.env[1].legInv = 1; s.env[1].stealRe = 1;
      s.p['e2.att'] = timeN(0.5); s.matrix[0] = mrow('velo', 'e2.start', 1); s.matrix[1] = mrow('env2', 'f.res', 0.1); }), { nv: 1 });
    Q.vs[0].noteOn(60, 0.2); Q.run(0.05);
    Q.vs[0].noteOn(64, 0.8, true);
    assert.equal(Q.vs[0].mod.eV0[1], Q.vs[0].mod.vVelo, 'legato restart from the new note\'s Start');
  }
});

test('no draw and no state depends on the monitor (sx.mon): S&H and chaos LFOs (processor, per-voice FREE, RETRIG) — mon 0 ≡ mon 1', () => {
  const s = st((s) => {
    const L = (l, f, hz) => { s.lfo[l] = { ...s.lfo[l], bpm: 0, anchor: 0, ...f }; s.p[`l${l + 1}.rate`] = hzN(hz); };
    L(0, { type: 'sh', mode: 'free', mono: 1 }, 7);             // processor FREE S&H, read by a row
    L(1, { type: 'sh', mode: 'free', mono: 1 }, 11);            // processor FREE S&H, read by nothing (same stream r2p)
    L(2, { type: 'sh', mode: 'free', mono: 0 }, 9);             // per-voice FREE S&H, read by nothing (voice stream r2)
    L(3, { type: 'sh', mode: 'retrig', mono: 0 }, 6);           // per-voice RETRIG S&H, read
    L(4, { type: 'rossler', mode: 'free', mono: 1 }, 3);        // processor chaos, read by nothing
    L(5, { type: 'lorenz', mode: 'retrig', mono: 1 }, 2);       // processor RETRIG chaos, read by nothing
    L(6, { type: 'sh', mode: 'retrig', mono: 1 }, 5);           // processor RETRIG S&H, read by nothing
    s.matrix[0] = mrow('lfo1', 'f.res', 0.3); s.matrix[1] = mrow('lfo4', 'f.cutoff', 0.3);
  });
  const run = (mon) => {
    const R = rig(s, { nv: 2, mon }), out = [];
    R.vs[0].noteOn(60, 1);
    for (let k = 0; k < 300; k++) {
      if (k === 100) R.vs[1].noteOn(64, 0.5);
      if (k === 150) R.sx.mon = 1 - mon;                        // the panel opens / closes mid-session
      if (k === 200) R.vs[0].noteOn(67, 0.7);
      R.span(32, (v) => { out.push(v.mod.src[SIX.lfo1], v.mod.src[SIX.lfo4], v.mod.eff[VI('f.res')], v.mod.eff[VI('f.cutoff')]); });
      out.push(R.m.r2p, R.vs[0].r2, R.vs[1].r2);
    }
    out.push(...R.m.oCh, ...R.m.oSH, ...R.vs[0].mod.lSH, ...R.vs[1].mod.lSH);
    return out;
  };
  const a = run(0), b = run(1);
  assert.ok(new Set(a.filter((x, i) => i % 4 === 0).slice(0, 2000)).size > 5, 'the S&H moves');
  sameTrace(a, b, 'monitor off/on');
});

test('per-voice FREE LFOs add their own PHASE to the processor clock (§6.15.1, §6.15.2)', () => {
  const R = rig(st((s) => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 0, bpm: 0, anchor: 0, pts: RAMP }; s.p['l1.rate'] = hzN(1);
    s.vc.len = 4; s.matrix[0] = mrow('vidx', 'l1.phase', 1); s.matrix[1] = mrow('lfo1', 'f.cutoff', 0.5);
  }), { nv: 4, mon: 1 });
  R.begin(32);
  assert.equal(R.m.lKind[0], 2);
  for (let i = 0; i < 4; i++) R.vs[i].noteOn(60 + i, 1);
  const at0 = R.vs.map((v) => v.mod.src[SIX.lfo1]);
  R.run(0.3, (v, c) => {
    const d = v.mod.eff[VI('l1.phase')];
    assert.equal(d, v.i / 4, 'eff PHASE = vidx');
    near(v.mod.lRp[0], frac(R.m.fPh[c] + d), 1e-12, `voice ${v.i}: clock + its PHASE`);
  }, 8);
  for (let i = 1; i < 4; i++) near(frac(at0[i] - at0[0]), i / 4, 1e-9, `note-on value of voice ${i}`);
  near(R.snap().lfoPh[0], Math.fround(R.vs[3].mod.lRp[0]), 0, 'the monitor shows the recent voice\'s phase');
});

test('MPE → macro maps are per voice: a voice without expression maps its zero expression, never another voice\'s (§6.17)', () => {
  const R = rig(st((s) => { s.global.mpe = { on: 1, bend: 48, xyz: 1 }; s.macros[0].v = 0.9; s.macros[1].v = 0.2; s.macros[3].v = 0.6;
    s.matrix[0] = mrow('macro2', 'f.res', 0.5); s.matrix[1] = mrow('macro1', 'f.var', 0.5); s.matrix[2] = mrow('macro4', 'f.drive', 0.5); }), { nv: 2 });
  R.proc.mpe[2 * 4 + 1] = 0.9; R.proc.mpe[2 * 4 + 3] = 0.5;      // channel 2: Y 0.9, X +0.5
  R.begin(32);
  R.vs[1].noteOn(64, 1, false, 0, null);                        // keyboard note: no channel, no expression
  R.vs[0].noteOn(60, 1, false, 2, null);                        // member channel 2 (the recent voice)
  R.run(0.1);
  const a = R.vs[0].mod.src, b = R.vs[1].mod.src;
  near(a[SIX.macro2], 0.9, 1e-9, 'MPE voice: its Y'); near(a[SIX.macro1], 0.75, 1e-9, 'MPE voice: (x + 1)/2');
  assert.equal(b[SIX.macro2], 0, 'no-expression voice: its own Y = 0 (not the other voice\'s 0.9, not the knob)');
  assert.equal(b[SIX.macro1], 0.5, 'no-expression voice: X 0 → 0.5');
  near(b[SIX.macro4], 0.6, 1e-9, 'unmapped macros keep the knob');
  near(R.m.g[SIX.macro2 * 32 + 31], 0.9, 1e-6, 'mono context: the recent voice');
  // the expression smoothers flush to exact zero (denormal rule)
  R.proc.mpe.fill(0);
  R.run(0.3);
  assert.deepEqual([R.vs[0].mod.xS, R.vs[0].mod.yS, R.vs[0].mod.zS], [0, 0, 0]);
});

test('swing on ENVELOPE LFOs and anchored restarts (§6.15.2): pass ×(1 + 0.75s), loop cycles alternate, no step at the restart', () => {
  const sw = 0.5, a = 1 + 0.75 * sw;
  const quarter = (f, more) => {
    const s = st((s) => { s.lfo[0] = { ...s.lfo[0], bpm: 1, swing: 1, pts: RAMP, ...f }; s.kbd.swing = sw; s.matrix[0] = mrow('lfo1', 'f.cutoff', 0.5); if (more) more(s); });
    const R = rig(s, { nv: 1 });
    R.sync();
    const L = R.m.lfoLadN[0];
    let n = -1;
    for (let j = 0; j < L; j++) if (R.m.lfoLad[j] === 1) n = j / (L - 1);
    s.p['l1.rate'] = n;
    R.patch(s);
    return R;                                                    // 1 beat = 0.5 s at 120 BPM
  };
  for (const anchor of [0, 1]) {
    // single pass: ends after 0.5·a s
    const R = quarter({ mode: 'env', anchor });
    R.vs[0].noteOn(60, 1);
    let end = null;
    R.run(1.2, (v, c, t) => { if (end === null && v.mod.lDone[0]) end = t; }, 1);
    near(end, 0.5 * a, 2 * R.dtC, `anchor ${anchor}: ENVELOPE pass ×(1 + 0.75s)`);
    // with a loop point 0.5: loop cycles of 0.25 s alternate ×(2 − a) / ×a while gated
    const Q = quarter({ mode: 'env', anchor, loop: 1, pts: [[0, 0, 0], [0.5, 0.2, 0], [1, 1, 0]] });
    Q.vs[0].noteOn(60, 1);
    const wraps = [];
    let last = 0;
    Q.run(2.5, (v, c, t) => { const p = v.mod.lPh[0]; if (p < last - 0.2) wraps.push(t); last = p; }, 1);
    const d = wraps.slice(1).map((x, i) => x - wraps[i]);
    assert.ok(d.length >= 5, `anchor ${anchor}: loops`);
    near(wraps[0], 0.5 * a, 2 * Q.dtC, `anchor ${anchor}: the pass (cycle 0, even) ×a, then into the loop`);
    for (let i = 0; i < d.length; i++) near(d[i], 0.25 * (i % 2 === 0 ? 2 - a : a), 2 * Q.dtC, `anchor ${anchor}: loop cycle ${i + 1}`);
  }
  // anchored RETRIG with start point x = 0.5: continuous at the restart, first wrap after (1 − 0.5)·a cycles
  const R = quarter({ anchor: 1, pts: [[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]], start: 1 });
  R.vs[0].noteOn(60, 1);
  const seq = [R.vs[0].mod.lPh[0]];
  let wrap = null, last = 0.5;
  R.run(0.6, (v, c, t) => { const p = v.mod.lPh[0]; if (seq.length < 4) seq.push(p); if (wrap === null && p < last - 0.5) wrap = t; last = p; }, 1);
  assert.equal(seq[0], 0.5);
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1] && seq[i] - seq[i - 1] < 1e-3, 'no step: ' + seq);
  near(wrap, 0.5 * 0.5 * a, 2 * R.dtC, 'first (partial, even) cycle ×(1 + 0.75s)');
});

test('MONO RETRIG / ENVELOPE LFOs restart at every note-on of the processor, legato and poly-legato ones included (§6.15.1)', () => {
  const hz = 2, dt = 4 / 48000;
  for (const [voicing, nv] of [[{ mono: 1, legato: 1 }, 1], [{ mono: 0, legato: 1 }, 2]]) {
    const R = rig(lfoSt(hz, { mono: 1 }, (s) => { Object.assign(s.voicing, voicing); s.p['l1.delay'] = 0.05 / 4; }), { nv });
    R.vs[0].noteOn(60, 1);
    assert.equal(R.m.lKind[0], 3);
    R.run(0.2, null, 8);
    near(R.m.P.lPh[0], 0.4, 2 * hz * dt, 'running');
    const v = voicing.mono ? R.vs[0] : R.vs[1], st0 = [R.vs[0].mod.eSt[0], R.vs[0].mod.eQ[0]];
    v.noteOn(64, 1, !!voicing.mono);
    if (voicing.mono) assert.deepEqual([v.mod.eSt[0], v.mod.eQ[0]], st0, 'mono legato: the envelopes do not restart');
    else assert.equal(v.mod.eSt[0], R.vs[0].mod.eSt[0], 'poly legato: ENV 1 copied');
    assert.equal(R.m.P.lPh[0], 0, 'the processor LFO restarted');
    assert.equal(R.m.oTau, 0, 'DELAY measured from this note-on');
    R.run(0.1, null, 8);
    near(R.m.P.lPh[0], 0.2, 2 * hz * dt, 'from the legato note-on');
  }
});

test('use & 2048 bypass (§4.1, §14.1): unused LFO 9/10 run on the most recent voice only; ENV 4 runs on every voice and always counts for lifetime rule (b)', () => {
  const E = (s) => { Object.assign(s.p, { 'e4.att': timeN(0.3), 'e4.rel': timeN(2) }); s.lfo[8] = { ...s.lfo[8], bpm: 0, anchor: 0 }; s.p['l9.rate'] = hzN(3); };
  const tick = (R, n) => { for (let k = 0; k < n; k++) { R.begin(32); for (const v of R.vs) for (let c = 0; c < 32; c++) { v.mod.follow(1); v.mod.sources(c); v.mod.matrix(1); v.mod.advance(c); } } };
  const life = {};
  for (const rows of [0, 1]) {                                     // the same envelopes without / with a row reading env4
    const R = rig(st((s) => { E(s); s.matrix[0] = mrow('env2', 'f.res', 0.1); if (rows) s.matrix[1] = mrow('env4', 'f.var', 0.1); }), { nv: 2 });
    assert.equal((R.proc.p.serum.use & 2048) !== 0, !!rows);
    R.vs[0].noteOn(60, 1);
    assert.equal(R.m.x4On, rows);
    R.run(0.05); R.vs[1].noteOn(64, 1);
    const e4 = R.vs[0].mod.eV[3], p9 = R.vs[0].mod.lPh[8];
    R.run(0.1);
    assert.ok(R.vs[0].mod.eV[3] > e4, 'older voice: ENV 4 runs');
    if (!rows) assert.equal(R.vs[0].mod.lPh[8], p9, 'older voice: unused LFO 9 frozen');
    assert.ok(R.vs[1].mod.eV[3] > 0 && R.vs[1].mod.lPh[8] > 0, 'recent voice: running (monitor)');
    for (const v of R.vs) v.noteOff();
    // ENV 1–3 end after their default releases; ENV 4 (2 s release) keeps rule (b) open, with or without the row
    let t = 0;
    while (!R.vs[0].mod.envsIdle() && t < 1500) { tick(R, 1); t++; }
    life[rows] = t;
    assert.equal(R.vs[0].mod.eSt[3], 0);
  }
  assert.equal(life[0], life[1], 'an unrelated env4 row does not change how long rule (b) keeps the voice');
  near(life[0] * 32 * (4 / 48000), 2, 0.05, 'rule (b) ends with ENV 4\'s release (2 s)');
  // LFO 9 read by a row: every voice runs it
  const Q = rig(st((s) => { E(s); s.matrix[0] = mrow('lfo9', 'f.var', 0.1); }), { nv: 2 });
  assert.ok(Q.proc.p.serum.use & 2048);
  Q.vs[0].noteOn(60, 1); Q.run(0.05); Q.vs[1].noteOn(64, 1);
  assert.equal(Q.m.x4On, 1);
  const q9 = Q.vs[0].mod.lPh[8];
  Q.run(0.1);
  assert.ok(Q.vs[0].mod.lPh[8] !== q9, 'older voice runs LFO 9');
});

test('HOST in Hz (FREE, S2): anchored at play / seek / loop wrap, integrated in between — a modulated rate does not race (§6.15.1, IMPL)', () => {
  const mk = (anchor, modAmt) => st((s) => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor, pts: RAMP }; s.p['l1.rate'] = hzN(2);
    s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l2.rate'] = hzN(0.5);
    s.matrix[0] = mrow('lfo1', 'f.res', 0.5);
    if (modAmt) s.matrix[1] = mrow('lfo2', 'l1.rate', modAmt, { bi: 1 });
  });
  const wrapsIn = (R, sec) => {
    let w = 0, prev = null;
    for (let i = 0; i < Math.round(sec / (32 * R.dtC)); i++) {
      R.span(32);
      for (let c = 0; c < 32; c++) { const y = R.m.g[SIX.lfo1 * 32 + c]; if (prev !== null && y < prev - 0.5) w++; prev = y; }
    }
    return w;
  };
  for (const beat of [2, 240]) {
    const R = rig(mk(1, 0.02), { nv: 0 });
    R.proc.beat = beat;
    const w = wrapsIn(R, 4);
    assert.ok(Math.abs(w - 8) <= 1, `song at ${beat / 2} s: ${w} wraps in 4 s (2 Hz ± 1 %)`);
  }
  // constant rate: equals the closed form φ = frac(start + songSeconds·rate) after long playback, a seek and a loop wrap
  const R = rig(mk(1, 0), { nv: 0, mon: 1 });
  const closed = (c) => frac((R.proc.beat - 32 * R.dtC * 2 + c * R.dtC * 2) * 0.5 * 2);
  R.proc.beat = 100;
  for (let i = 0; i < 400; i++) R.span(32);
  near(R.m.oRp[0], closed(31), 1e-9, 'after 400 spans');
  R.proc.beat = 37.3;                                            // a loop wrap / seek without transport()
  R.span(32);
  near(R.m.oRp[0], closed(31), 1e-9, 're-anchored after the jump');
  R.proc.beat = 12; R.M.transport(R.proc, R.sx, true);
  R.span(32);
  near(R.m.oRp[0], closed(31), 1e-9, 'transport start');
});

test('a patch edit while no voice sounds keeps a modulated macro at its target (no dip to the base, §5.6)', () => {
  const mk = (cut) => st((s) => { s.macros[0].v = 0; s.p['f.cutoff'] = cut; s.matrix[0] = mrow('fixed', 'm1', 0.8); s.matrix[1] = mrow('macro1', 'g.master', 0.5); });
  const R = rig(mk(0.5), { nv: 0 });
  for (let i = 0; i < 40; i++) R.span(32);
  near(R.m.g[SIX.macro1 * 32 + 31], 0.8, 1e-9, 'settled');
  R.patch(mk(0.6));
  R.span(32);
  for (let c = 0; c < 32; c++) near(R.m.g[SIX.macro1 * 32 + c], 0.8, 1e-9, 'no dip after the edit');
  near(R.m.fxOff[0], 0.4, 1e-9, 'FX offset unchanged');
  // an unmodulated macro still jumps to a new base (Phase 1)
  const Q = rig(st((s) => { s.macros[2].v = 0.3; s.matrix[0] = mrow('macro3', 'f.res', 0.5); }), { nv: 0 });
  Q.span(); Q.patch(st((s) => { s.macros[2].v = 0.7; s.matrix[0] = mrow('macro3', 'f.res', 0.5); })); Q.span();
  assert.equal(Q.m.g[SIX.macro3 * 32], 0.7);
});

test('chaos LFOs: at most 4 RK2 sub-steps per chunk — the integration saturates above the cap, bounded and cheap (§14.1)', () => {
  const run = (hz, type) => {
    const R = rig(lfoSt(hz, { type, x10: 1 }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    const out = [];
    R.run(0.5, (v, c) => { if (c === 0) out.push(v.mod.src[SIX.lfo1]); }, 32);
    return out;
  };
  // Rössler: h = rate·6.07·dt ≥ 0.4 from ≈ 791 Hz at 48 kHz: 900 Hz and 1000 Hz integrate identically
  assert.deepEqual(run(900, 'rossler'), run(1000, 'rossler'));
  for (const y of run(1000, 'lorenz')) assert.ok(y >= 0 && y <= 1);
  // CPU: 8 voices × 10 Rössler LFOs at 1000 Hz cost at most 2.5 × the same with Normal LFOs (was ≈ 3×)
  const mk = (type) => {
    const R = rig(st((s) => { for (let l = 0; l < 10; l++) { s.lfo[l] = { ...s.lfo[l], type, x10: 1, bpm: 0, anchor: 0 }; s.p[`l${l + 1}.rate`] = 1; s.matrix[l] = mrow(`lfo${l + 1}`, 'f.res', 0.05); } }), { nv: 8, OS: 2 });
    R.vs.forEach((v, i) => v.noteOn(48 + 3 * i, 0.8));
    R.run(0.2);
    return () => { const t0 = performance.now(); R.run(0.3); return performance.now() - t0; };
  };
  // back-to-back pairs in alternating order, the median of the per-pair ratios, up to 5 attempts while over the bound (a
  // stretch of machine load slows both members of a pair; RULINGS2 Performance)
  const tN = mk('normal'), tR = mk('rossler'), med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  let best = Infinity;
  for (let attempt = 0; attempt < 5 && !(best <= 2.5); attempt++) {
    const q = [];
    for (let k = 0; k < 5; k++) { let a, b; if (k & 1) { b = tR(); a = tN(); } else { a = tN(); b = tR(); } q.push(b / a); }
    best = Math.min(best, med(q));
  }
  assert.ok(best <= 2.5, `Rössler ${best.toFixed(2)} × Normal`);
});

test('interface details: reset(sx) without proc keeps the rates (§11.6); proc.seqMacro created late is picked up by transport', () => {
  const R = rig(st(), { nv: 1 });
  const before = [R.m.CH, R.m.fs, R.m.base, R.m.dtC];
  R.M.reset(R.sx);
  assert.deepEqual([R.m.CH, R.m.fs, R.m.base, R.m.dtC], before);
  R.vs[0].noteOn(60, 1); R.run(0.05);
  // clip-lane array created after the CP was synced (§7.5.5)
  const Q = rig(st((s) => { s.macros[4].v = 0.25; s.matrix[0] = mrow('macro5', 'f.res', 0.5); }), { nv: 0 });
  delete Q.proc.seqMacro;
  Q.span();
  Q.proc.seqMacro = new Float64Array(8).fill(NaN); Q.proc.seqMacro[4] = 0.75;
  Q.span();
  assert.equal(Q.m.g[SIX.macro5 * 32 + 31], 0.25, 'not seen before the next resolve');
  Q.proc.beat = 0; Q.M.transport(Q.proc, Q.sx, true);
  for (let k = 0; k < 200; k++) Q.span();
  near(Q.m.g[SIX.macro5 * 32 + 31], 0.75, 1e-9, 'the lane after transport');
});

/* ------------------------------------------------------------------ review round (D2 fixes) */

// the eff n of a BPM-ladder entry of `beats` for LFO l of state s (the compiled ladder of that LFO)
function ladN(s, beats, l = 0) {
  const R = rig(s, { nv: 0 });
  R.sync();
  const L = R.m.lfoLadN[l];
  for (let j = 0; j < L; j++) if (R.m.lfoLad[l * 43 + j] === beats) return j / (L - 1);
  throw new Error('no ladder entry of ' + beats + ' beats');
}
const cyc = (a, b) => { const d = Math.abs(a - b); return d < 0.5 ? d : 1 - d; };   // step on a phase circle

test('HOST at note-ons in engine order (transport start / loop wrap / stop, then the note-on, then begin): Hz starts on the song clock (§6.15.1)', () => {
  const hz = 3.3;
  for (const mono of [0, 1]) {
    const R = rig(lfoSt(hz, { anchor: 1, mono }, (s) => { s.global.s1 = 0; }));
    const ph = () => (mono ? R.m.P.lPh[0] : R.vs[0].mod.lPh[0]);
    R.span(); R.span();
    // play with seek to beat 8.3: the engine applies the transport, then fires the note-ons of that frame, then begins
    R.proc.beat = 8.3; R.M.transport(R.proc, R.sx, true);
    R.vs[0].noteOn(60, 1);
    near(ph(), frac(8.3 * 0.5 * hz), 1e-9, `mono ${mono}: note at the play position`);
    // loop wrap: the song position jumps back (no transport call), the note at the loop start comes before begin
    R.run(0.4);
    R.proc.beat = 2;
    R.vs[0].noteOn(62, 1);
    near(ph(), frac(2 * 0.5 * hz), 1e-9, `mono ${mono}: note at the loop start after a wrap`);
    // a live note between two quanta: songBeat() still reports the previous span's start, the processor clock is exact
    R.run(0.2);
    const clk = R.m.beatClk;
    R.proc.beat -= 32 * R.dtC * 2;
    R.vs[0].noteOn(63, 1);
    near(ph(), frac(clk * 0.5 * hz), 1e-9, `mono ${mono}: live note on the processor clock`);
    R.proc.beat += 32 * R.dtC * 2;
    // stop: a note after the stop is not anchored to the stale song position
    R.run(0.1);
    R.proc.beat = null; R.M.transport(R.proc, R.sx, false);
    R.vs[0].noteOn(64, 1);
    assert.equal(ph(), 0, `mono ${mono}: stopped → the start point`);
  }
});

test('BPM + HOST restarts anchor at the note\'s song beat: after a loop wrap ENVELOPE / RETRIG LFOs start each pass alike (MONO always, per voice in S2 mode)', () => {
  for (const [s1, mono] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
    const s = st((s) => { s.global.s1 = s1; s.lfo[0] = { ...s.lfo[0], mode: 'env', mono, bpm: 1, anchor: 1, pts: RAMP }; s.matrix[0] = mrow('lfo1', 'f.res', 0.1); });
    s.p['l1.rate'] = ladN(s, 1);                                   // 1/4 = 1 beat
    const R = rig(s, { nv: 1 });
    const ph = () => (mono ? R.m.P.lPh[0] : R.vs[0].mod.lPh[0]);
    R.proc.beat = 2; R.M.transport(R.proc, R.sx, true);            // loop [2, 4)
    const pass = [];
    for (let k = 0; k < 2; k++) {
      R.vs[0].noteOn(60, 1);
      if (s1 && !mono) assert.equal(R.vs[0].mod.lB0[0], R.m.beatClk, 'S1 mode, per voice: the Phase-1 beat clock (golden equivalence)');
      for (let i = 0; i < 20; i++) R.span();
      pass.push(ph());
      R.vs[0].noteOff();
      while (R.proc.beat < 4) R.span();
      R.proc.beat = 2;                                             // the wrap: song notes at the loop start follow at once
    }
    if (s1 && !mono) continue;
    near(pass[0], 20 * 32 * R.dtC * 2, 1e-9, `s1 ${s1} mono ${mono}: first pass`);
    near(pass[1], pass[0], 1e-9, `s1 ${s1} mono ${mono}: the pass after the wrap starts like the first`);
  }
});

test('PHASE on FREE LFOs shifts phase and cycle together: Ping Pong stays continuous, S&H draws where the read position wraps (§6.15.2)', () => {
  for (const mono of [1, 0]) {
    const R = rig(lfoSt(2, { mode: 'free', mono, dir: 'pp' }, (s) => { s.p['l1.phase'] = 0.3; }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    let prev = null, maxStep = 0, lo = 1, hi = 0;
    R.run(2, (v) => { const y = v.mod.src[SIX.lfo1]; if (prev !== null) maxStep = Math.max(maxStep, Math.abs(y - prev)); prev = y; lo = Math.min(lo, y); hi = Math.max(hi, y); }, 8);
    assert.ok(maxStep < 1e-3, `mono ${mono}: Ping Pong + PHASE continuous (max step ${maxStep})`);
    assert.ok(lo < 0.01 && hi > 0.99, `mono ${mono}: full swing`);
  }
  // S&H: with PHASE 0.3 the values change 0.3 cycles (0.15 s at 2 Hz) before the PHASE-0 changes
  for (const mono of [1, 0]) {
    const changes = (phase) => {
      const R = rig(lfoSt(2, { mode: 'free', mono, type: 'sh' }, (s) => { s.p['l1.phase'] = phase; }), { nv: 1 });
      R.vs[0].noteOn(60, 1);
      const out = [];
      let prev = null;
      R.run(2, (v, c, t) => { const y = v.mod.src[SIX.lfo1]; if (prev !== null && y !== prev) out.push(t); prev = y; }, 1);
      return out;
    };
    const a = changes(0), b = changes(0.3);
    assert.ok(a.length >= 3 && Math.abs(a.length - b.length) <= 1, `mono ${mono}: one draw per cycle`);
    for (const t of b) near(frac((a[0] - t) / 0.5 + 1e-9) , 0.3, 4 / 48000 * 2 / 0.5 + 1e-6, `mono ${mono}: S&H step at ${t}`);
  }
});

test('Ping Pong on ENVELOPE loop passes mirrors inside the loop region: continuous, never outside it (IMPL, §6.15.2 gap)', () => {
  const RAMP3 = [[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]];
  for (const mono of [0, 1]) {
    const R = rig(lfoSt(4, { mode: 'env', mono, pts: RAMP3, loop: 1, dir: 'pp' }), { nv: 1 });
    R.vs[0].noteOn(60, 1);
    let prev = null, maxStep = 0, lo = 1, hi = 0;
    R.run(1.5, (v, c, t) => {
      const y = v.mod.src[SIX.lfo1];
      if (t > 0.3) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      if (prev !== null) maxStep = Math.max(maxStep, Math.abs(y - prev));
      prev = y;
    }, 8);
    assert.ok(lo >= 0.5 - 1e-9 && hi <= 1 && hi > 0.99 && lo < 0.51, `mono ${mono}: inside the loop region [0.5, 1]: ${lo}…${hi}`);
    assert.ok(maxStep < 0.01, `mono ${mono}: no step at the pass boundaries (${maxStep})`);
  }
});

test('vc.escale is sampled at note-on (§6.16): rows from note-on sources apply, a row moving it during the note leaves the times alone', () => {
  const C = VI('vc.escale');
  const R = rig(st((s) => {
    s.p['e2.att'] = timeN(0.2);
    s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 0, anchor: 0, pts: RAMP }; s.p['l2.rate'] = hzN(4);
    s.matrix[0] = mrow('lfo2', 'vc.escale', 0.3); s.matrix[1] = mrow('velo', 'vc.escale', 0.2); s.matrix[2] = mrow('env2', 'f.res', 0.1);
  }), { nv: 1 });
  R.span();
  const v = R.vs[0], mv = v.mod;
  for (const vel of [1, 0]) {
    v.noteOn(60, vel);
    const n0 = mv.eff[C], e0 = mv.eScale;
    near(e0, 0.25 * Math.pow(16, n0), 1e-12, 'eScale from the note-on eff (pre-restart pass)');
    const seen = new Set();
    R.run(0.3, (w) => { seen.add(w.mod.eScale); }, 4);
    assert.deepEqual([...seen], [e0], 'constant for the note');
    assert.ok(Math.abs(mv.eff[C] - n0) > 1e-3, 'while the row moves eff vc.escale');
    v.noteOff(); R.run(0.05);
  }
});

test('MPE Y → wheel replaces the wheel of every voice: no expression → 0 (§6.17); generated-note expression with MPE off (§7.1)', () => {
  const W = rig(st((s) => { s.global.mpe = { on: 1, bend: 48, xyz: 3 }; s.matrix[0] = mrow('wheel', 'f.mix', 0.1); }), { nv: 3 });
  W.proc.wheel = 0.8; W.proc.mpe[2 * 4 + 1] = 0;
  W.vs[0].noteOn(60, 1, false, 0, null); W.vs[1].noteOn(64, 1, false, 2); W.vs[2].noteOn(67, 1, false, 0, Float64Array.of(0.5, 0.4, 0));
  assert.deepEqual([W.vs[0].mod.src[SIX.wheel], W.vs[1].mod.src[SIX.wheel], W.vs[2].mod.src[SIX.wheel]], [0, 0, 0.4], 'note-on');
  W.run(0.05);
  assert.equal(W.vs[0].mod.src[SIX.wheel], 0, 'no channel, no expression: Y 0, not the global wheel');
  assert.equal(W.vs[1].mod.src[SIX.wheel], 0, 'member channel, Y 0');
  near(W.vs[2].mod.src[SIX.wheel], 0.4, 1e-12, 'generated note: its Y');
  // MPE off: the global wheel (Phase 1)
  const P = rig(st((s) => { s.global.mpe = { on: 0, bend: 48, xyz: 3 }; s.matrix[0] = mrow('wheel', 'f.mix', 0.1); }), { nv: 1 });
  P.proc.wheel = 0.8; P.vs[0].noteOn(60, 1); P.run(0.05);
  near(P.vs[0].mod.src[SIX.wheel], 0.8, 1e-6, 'MPE off');
  // a clip / arp note's expression is used by a voice without an MPE channel also with MPE off (§7.1, §6.17; the §0.7
  // MPE row gates member-channel expression — pending the lead's wording)
  const Q = rig(st((s) => { s.matrix[0] = mrow('mpey', 'f.res', 0.1); }), { nv: 1 });
  assert.equal(Q.proc.p.serum.use & 256, 0);
  Q.vs[0].noteOn(60, 1, false, 0, Float64Array.of(0.5, 0.6, 0.2));
  assert.equal(Q.vs[0].mod.src[SIX.mpey], 0.6);
});

test('LFO scale changes keep BPM + HOST LFOs continuous (re-based anchors): per chunk |Δφ| ≤ max scale × the nominal step — per voice, MONO, FREE', () => {
  const nOf = (v) => Math.log2(v * 4) / 4;
  const mk = (f, rows) => {
    const s = st((s) => {
      s.global.s1 = 0;
      s.lfo[0] = { ...s.lfo[0], bpm: 1, anchor: 1, pts: RAMP, ...f };
      s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 0, anchor: 0, pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]] }; s.p['l2.rate'] = hzN(0.25);
      s.matrix[0] = mrow('lfo1', 'f.res', 0.1);
      if (rows) s.matrix[1] = mrow('lfo2', 'vc.lscale', 0.2, { bi: 1 });
    });
    s.p['l1.rate'] = ladN(s, 1);                                   // 1 beat = 2 Hz at 120 BPM
    return s;
  };
  const nominal = 2 * 4 / 48000;
  for (const f of [{}, { mono: 1 }, { mode: 'free', mono: 1 }, { mode: 'free', mono: 0 }]) {
    const what = JSON.stringify(f);
    // (a) vc.lscale modulated by a bipolar row ±0.1 n (scale 0.76…1.32) during 30 s of song
    {
      const R = rig(mk(f, 1), { nv: 1 });
      R.proc.beat = 0; R.M.transport(R.proc, R.sx, true);
      R.vs[0].noteOn(60, 1);
      let prev = null, maxStep = 0, maxSc = 1;
      R.run(30, (v) => {
        const y = v.mod.src[SIX.lfo1], sc = 0.25 * Math.pow(16, f.mode || f.mono ? R.m.monoEff[VI('vc.lscale')] : v.mod.eff[VI('vc.lscale')]);
        if (prev !== null) maxStep = Math.max(maxStep, cyc(y, prev));
        prev = y; maxSc = Math.max(maxSc, sc);
      }, 32);
      assert.ok(maxSc > 1.3, what + ': the scale moved');
      assert.ok(maxStep <= maxSc * nominal * 1.02 + 1e-12, `${what}: max step ${maxStep} vs ${maxSc * nominal}`);
    }
    // (b) the LFO SCALING knob moved from 100 % to 115 % after 30 s: no burst
    {
      const s = mk(f, 0), R = rig(s, { nv: 1 });
      R.proc.beat = 0; R.M.transport(R.proc, R.sx, true);
      R.vs[0].noteOn(60, 1);
      R.run(30);
      s.p['vc.lscale'] = nOf(1.15); R.patch(s);
      let prev = null, maxStep = 0;
      R.run(0.5, (v) => { const y = v.mod.src[SIX.lfo1]; if (prev !== null) maxStep = Math.max(maxStep, cyc(y, prev)); prev = y; }, 32);
      assert.ok(maxStep <= 1.15 * nominal * 1.02, `${what}: knob move, max step ${maxStep}`);
    }
  }
  // a constant scale stays the closed form; FREE re-locks to the song at a seek / loop wrap
  {
    const s = mk({ mode: 'free', mono: 1 }, 0);
    s.p['vc.lscale'] = nOf(1.5);
    const R = rig(s, { nv: 0, mon: 1 });
    R.proc.beat = 0; R.M.transport(R.proc, R.sx, true);
    for (let i = 0; i < 200; i++) R.span();
    const closed = () => frac((R.proc.beat - 32 * R.dtC * 2 + 31 * R.dtC * 2) * 1.5);
    near(R.m.oRp[0], closed(), 1e-9, 'constant scale 1.5: frac(start + beat·1.5/beats)');
    s.p['vc.lscale'] = nOf(1.2); R.patch(s);
    for (let i = 0; i < 100; i++) R.span();
    R.proc.beat = 3.25;                                            // a loop wrap
    R.span();
    near(R.m.oRp[0], frac((R.proc.beat - R.dtC * 2) * 1.2), 1e-9, 'loop wrap: the closed form at the new scale');
  }
});

test('MONO RETRIG / ENVELOPE restarts keep SMOOTH: the shared value glides at a new note-on instead of stepping in sounding voices', () => {
  const run = (sm, mono) => {
    const R = rig(st((s) => { s.lfo[0] = { ...s.lfo[0], mode: 'retrig', mono, bpm: 0, anchor: 0, pts: RAMP }; s.p['l1.rate'] = hzN(1); s.p['l1.smooth'] = sm; s.matrix[0] = mrow('lfo1', 'f.res', 0.1); }));
    R.vs[0].noteOn(60, 1);
    R.run(0.7, null, 8);
    const v0 = R.vs[0];
    let prev = v0.mod.src[SIX.lfo1], maxStep = 0;
    R.vs[1].noteOn(64, 1);
    R.run(0.05, (v) => { if (v !== v0) return; const x = v.mod.src[SIX.lfo1]; maxStep = Math.max(maxStep, Math.abs(x - prev)); prev = x; }, 1);
    return { R, maxStep };
  };
  const k = 1 - Math.exp(-(4 / 48000) / (0.5 * 0.5 ** 3));
  assert.ok(run(0.5, 1).maxStep <= k + 1e-4, 'SMOOTH 0.5: within the smoothing slope');
  assert.ok(run(0, 1).maxStep > 0.5, 'SMOOTH 0: the restart value at once');
  const { R } = run(0, 1);
  assert.equal(R.m.P.lPh[0] > 0, true);
});

test('a processor LFO\'s Y output returns to 0 when its type leaves Path (§3.10), also with no voice sounding', () => {
  const mk = (type) => st((s) => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0, type }; s.p['l1.rate'] = hzN(2);
    s.matrix[0] = mrow('lfo1', 'f.res', 0.1); s.matrix[1] = mrow('lfo1y', 'm2', 0.5); s.matrix[2] = mrow('lfo1y', 'f.var', 0.5);
  });
  const Q = rig(mk('path'), { nv: 1 });
  Q.run(0.3);
  assert.ok(Math.abs(Q.m.monoSrc[SIX.lfo1y]) > 0.01, 'Path: Y moves');
  Q.patch(mk('normal'));
  Q.run(0.3);
  assert.equal(Q.m.monoSrc[SIX.lfo1y], 0); assert.equal(Q.m.monoOff[VI('m2')], 0);
  near(Q.m.macro[1], Q.m.macB[1], 1e-12, 'macro 2 back to its base');
  assert.ok(Q.m.g.subarray(SIX.lfo1y * 32, SIX.lfo1y * 32 + 32).every((x) => x === 0));
  Q.vs[0].noteOn(60, 1); Q.run(0.05);
  assert.equal(Q.vs[0].mod.src[SIX.lfo1y], 0);
});

test('hidden warm-up note-ons (voice.hid > 0) touch no processor LFO state: MONO LFOs, r2p, oTau, the recent voice (vcN: serum-dsp restores it)', () => {
  const R = rig(st((s) => {
    s.lfo[0] = { ...s.lfo[0], mode: 'retrig', mono: 1, bpm: 0, anchor: 0, type: 'sh' }; s.p['l1.rate'] = hzN(2);
    s.matrix[0] = mrow('lfo1', 'g.master', 0.2);
  }), { nv: 2 });
  R.vs[0].noteOn(60, 1); R.run(0.2);
  const m = R.m, before = [m.r2p, m.P.lPh[0], m.P.lCy[0], m.oSH[0], m.oTau, m.recent];
  R.vs[1].hid = 1;
  R.vs[1].noteOn(67, 0.6);
  assert.deepEqual([m.r2p, m.P.lPh[0], m.P.lCy[0], m.oSH[0], m.oTau, m.recent], before);
  R.vs[1].hid = 0;
  R.vs[1].noteOn(69, 0.6);
  assert.notEqual(m.r2p, before[0], 'a real note-on restarts it (draw from r2p)');
  assert.equal(m.P.lPh[0], 0); assert.equal(m.recent, R.vs[1]);
});
