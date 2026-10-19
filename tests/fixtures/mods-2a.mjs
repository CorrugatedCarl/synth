// Stage 2a fixture (IMPL-2a §2.1, §5; lane A for the lead and lane D): three hand-built Serum tracks with canvas mod rows
// (track.mods), the exact merged matrices cv-graph injectMods makes of them, and the matrix fields of the compiled patch
// ({t: 'patch', p}: p.serum) the host posts — written out here, not computed (tests/cv-graph.test.mjs checks the compile
// against them, and that the same rows written by serum-core addMod compile identically).
//   tracks()   fresh copies (tests mutate them): v2 tracks with prim / nid / mid / dev / wires / mods
//     0  'trk_m1'  a default Serum + Velocity (ve): a wheel row → f.cutoff and a velocity row → a.level
//     1  'trk_m2'  a Serum whose own matrix (its preset) already holds a wheel row → f.res (slot 0) + Aftertouch (at): a
//                  canvas aftertouch row → its own reverb's mix (fx.rev.mix) — slot 1
//     2  'trk_m3'  a Serum with 64 preset rows (lfo1 → f.cutoff) and one canvas wheel row → left (not compiled)
//   MERGED[i]  { placed, left, rows: { slot: native row } } — the slots the canvas rows take and the rows there
//   CP[i]      the compiled matrix fields of the merged state (p.serum: mN; mSlot / mSrc / mDst / mAmt / mBi / mCtx / mCrv
//              over the first mN entries) at { sr: 48000, bpm: 120 }
//   cpOf(p)    those fields of a compiled patch (p.serum), as plain arrays, for a deepEqual with CP[i]
import { defaultSerum, normalizeSerum, defaultFx2, newInstance } from '../../serum-core.js?v=9';

const ROW = { src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 };
const row = o => Object.assign({}, ROW, o);
const crow = o => Object.assign({ id: 'r1' }, ROW, { src: 'wheel', dst: 'i1:f.cutoff' }, o);
const serum = (s, fx) => ({ kind: 'synth', model: 'serum', vals: { s }, preset: null, fx });
const track = (id, name, i1, extra, mods) => ({
  id, name, color: '#4fb3ff', ch: 0, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, notes: [], cc: [],
  prim: 'i1', nid: 2, mid: mods.length + 1, dev: Object.assign({ i1, out: { kind: 'out' } }, extra), wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods,
});

export function tracks() {
  const s1 = normalizeSerum(defaultSerum());
  const t1 = track('trk_m1', 'Mods 1', serum(s1, defaultFx2()), { ve: { kind: 'velo' } }, [
    crow({ id: 'r1', amt: 0.5 }),
    crow({ id: 'r2', src: 've.out', dst: 'i1:a.level', amt: 0.35, curve: -0.4, crv: [[0, 0, 0], [0.6, 0.25, 0.3], [1, 1, 0]] }),
  ]);
  const s2 = normalizeSerum(defaultSerum()), fx2 = defaultFx2(), rev = newInstance(fx2, 'rev', { rack: 0 });
  if (rev !== 'rev') throw new Error('mods-2a: the reverb instance id is ' + rev);
  s2.matrix[0] = row({ src: 'wheel', amt: 0.3, dst: 'f.res' });
  const t2 = track('trk_m2', 'Mods 2', serum(s2, fx2), { at: { kind: 'at' } }, [
    crow({ id: 'r1', src: 'at.out', dst: 'i1:fx.rev.mix', amt: 0.6, rise: 0.25, fall: 0.25, slink: 1 }),
  ]);
  const s3 = normalizeSerum(defaultSerum());
  for (let k = 0; k < 64; k++) s3.matrix[k] = row({ src: 'lfo1', amt: (k + 1) / 100, dst: 'f.cutoff' });
  const t3 = track('trk_m3', 'Mods 3', serum(s3, defaultFx2()), {}, [crow({ id: 'r1', amt: 0.2 })]);
  return [t1, t2, t3];
}

export const MERGED = [
  { placed: [{ id: 'r1', slot: 0 }, { id: 'r2', slot: 1 }], left: [], rows: {
    0: row({ src: 'wheel', amt: 0.5, dst: 'f.cutoff' }),
    1: row({ src: 'velo', amt: 0.35, dst: 'a.level', curve: -0.4, crv: [[0, 0, 0], [0.6, 0.25, 0.3], [1, 1, 0]] }),
  } },
  { placed: [{ id: 'r1', slot: 1 }], left: [], rows: {
    0: row({ src: 'wheel', amt: 0.3, dst: 'f.res' }), // (the preset's own row, untouched)
    1: row({ src: 'at', amt: 0.6, dst: 'fx.rev.mix', rise: 0.25, fall: 0.25, slink: 1 }),
  } },
  { placed: [], left: ['r1'], rows: {} }, // (the merged state is vals.s itself)
];

const R64 = Array.from({ length: 64 }, (_, k) => k), all = v => R64.map(() => v);
export const CP = [
  // (mSrc: serum-core SOURCES — 1 wheel, 5 lfo1, 13 velo, 15 at; mDst: the voice slot vi — 42 f.cutoff, 43 f.res, 0 a.level —
  // or −1 − (8 + flat) for an FX parameter: −30 = fx.rev.mix; mCtx 1 voice, 4 FX; mCrv: the slot of a custom curve, −1 none)
  { mN: 2, mSlot: [0, 1], mSrc: [1, 13], mDst: [42, 0], mAmt: [0.5, 0.35], mBi: [0, 0], mCtx: [1, 1], mCrv: [-1, 1] },
  { mN: 2, mSlot: [0, 1], mSrc: [1, 15], mDst: [43, -30], mAmt: [0.3, 0.6], mBi: [0, 0], mCtx: [1, 4], mCrv: [-1, -1] },
  { mN: 64, mSlot: R64, mSrc: all(5), mDst: all(42), mAmt: R64.map(k => (k + 1) / 100), mBi: all(0), mCtx: all(1), mCrv: all(-1) }, // (the preset's rows alone)
];

const F = ['mSlot', 'mSrc', 'mDst', 'mAmt', 'mBi', 'mCtx', 'mCrv'];
export function cpOf(p) {
  const c = p && p.serum ? p.serum : p, o = { mN: c.mN };
  for (const k of F) o[k] = Array.from(c[k].slice(0, c.mN));
  return o;
}
