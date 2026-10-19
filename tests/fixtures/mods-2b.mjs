// Stage 2b fixture (IMPL-2b §3.1, §3.3, §7.5; lane B for the lead, lanes A1 / A2 / D): hand-built v2 tracks with modulator
// modules and cables to every destination kind, and the {t: 'mods'} payload cv-graph compileMods makes of the three-row
// track, written out (tests/cv-graph.test.mjs checks the compile against it). Every track: a default Serum i1 → OUT and a
// default Juno-60 i2 → the shared panel fx1 (a reverb 'rev' in its Main rack) → OUT.
//   tracks()   fresh copies (tests mutate them)
//     0  'trk_b1'  THE THREE-ROW TRACK: one GLOBAL LFO module l1 cabled to the Serum's cutoff (an ext row), the Juno's
//                  cutoff (a cls row) and the reverb's mix (an fx row)
//     1  'trk_b2'  every source kind: l1 GLOBAL, l2 PER NOTE, e1, m1 (named knobs), c1, h1, nt + the wheel; rows to the
//                  Serum (ext, slot injection, a value source), the Juno (cls, set, a linked Serum LFO, a note row) and
//                  the panel (a macro knob)
//     2  'trk_b3'  budgets: 11 LFO modules on Juno knobs (the 11th: 'slots'); 17 global sources on Serum knobs (8 macro
//                  knobs, 8 CCs, l1: the 17th ext: 'ext')
//     3  'trk_b4'  a Serum whose 10 LFO slots are all in use (a preset row each) and a PER NOTE LFO l1 → its cutoff (the
//                  ext fallback, dashed) + an ENV e1 → its wavetable position (slot injection into env2)
//   PAY1       the payload of track 0 without cp / ct (compileMods with the identity transfer stub XFER): rows, xfer, ext,
//              vals, keep, left, dashed, n
//   CP1        the synthetic CP's matrix fields of track 0 (mN; mSlot / mSrc / mDst / mAmt / mBi / mCtx over mN) and the
//              LFO slot flags (lfoMono / lfoMode), its voice section (a.on base, poly)
//   XFER       the transfer stub (lane A2's xferOf is stubbed here): the identity { a: 0, b: 1 } tagged with the call
import { defaultSerum, normalizeSerum, defaultFx2, newInstance, normRow, vi } from '../../serum-core.js?v=9';
import { normModDev } from '../../song.js?v=9';

const ROW = { amt: 0, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 };
const row = (id, src, dst, o) => Object.assign({ id, src, dst }, ROW, o);
const serum = () => ({ kind: 'synth', model: 'serum', vals: { s: normalizeSerum(defaultSerum()) }, preset: null, fx: defaultFx2() });
const juno = () => ({ kind: 'synth', model: 'juno60', vals: {}, preset: null });
const mod = (kind, o) => normModDev(Object.assign({ kind }, o));
function track(id, name, extra, mods) {
  const fx = defaultFx2(), rev = newInstance(fx, 'rev', { rack: 0 });
  if (rev !== 'rev') throw new Error('mods-2b: the reverb instance id is ' + rev);
  return {
    id, name, color: '#4fb3ff', ch: 0, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, notes: [], cc: [],
    prim: 'i1', nid: 3, mid: mods.length + 1, dev: Object.assign({ i1: serum(), i2: juno(), fx1: { kind: 'panel', fx }, out: { kind: 'out' } }, extra),
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }], mods,
  };
}
export function tracks() {
  const t1 = track('trk_b1', 'Three rows', { l1: mod('lfo', { lfo: { mono: 1 } }) }, [
    row('r1', 'l1.out', 'i1:f.cutoff', { amt: 0.5 }),
    row('r2', 'l1.out', 'i2:cf', { amt: 0.25, bi: 1, curve: 0.3 }),
    row('r3', 'l1.out', 'fx1:fx.rev.mix', { amt: -0.2, rise: 0.1, fall: 0.1, slink: 1 }),
  ]);
  const t2 = track('trk_b2', 'Every kind', {
    l1: mod('lfo', { lfo: { mono: 1 }, rate: 0.3 }), l2: mod('lfo', { lfo: { mono: 0, mode: 'env', pts: [[0, 1, 0], [1, 0, 0]] } }),
    e1: mod('env', { att: 0.2, dec: 0.4, sus: 0.6, rel: 0.3, crv: [0.4] }), m1: mod('macro', { v: [0.5, 0, 0.25, 0, 0, 0, 0, 1], names: ['Cut', '', 'Mix'] }),
    c1: mod('cc', { cc: 74, v: 0.5 }), h1: mod('chaos', { rate: 0.4 }), nt: mod('note'),
  }, [
    row('r1', 'l1.out', 'i1:f.cutoff', { amt: 0.5 }),            // GLOBAL LFO → Serum: ext
    row('r2', 'l2.out', 'i1:a.wt', { amt: 0.4 }),                 // PER NOTE LFO → Serum: slot injection
    row('r3', 'l1.out', 'i2:cf', { amt: 0.25 }),                  // → Juno cutoff: cls
    row('r4', 'e1.out', 'i2:a', { amt: 0.25 }),                   // ENV → Juno attack: set, per note
    row('r5', 'm1.k3', 'fx1:fx.rev.mix', { amt: 0.25 }),          // macro knob → panel: fx
    row('r6', 'i1/lfo2.out', 'i2:rs', { amt: 0.25 }),             // the Serum's LFO 2 (poly) → Juno resonance: linked
    row('r7', 'c1.out', 'i1:a.level', { amt: 0.25 }),             // CC → Serum: ext from a value source
    row('r8', 'nt.out', 'i2:lv', { amt: 0.25 }),                  // note → Juno level: per note
    row('r9', 'wheel', 'i2:cf', { amt: 0.25 }),                   // the wheel → Juno cutoff
    row('r10', 'h1.out', 'i2:cf', { amt: 0.1, bi: 1 }),           // chaos → Juno cutoff
    row('r11', 'i1/lfo1.out', 'i1:a.pan', { amt: 0.3 }),          // the Serum's own LFO 1 → its own pan: native
  ]);
  const ex3 = {}, rows3 = [];
  for (let k = 1; k <= 11; k++) { ex3['l' + k] = mod('lfo', { lfo: { mono: 1 } }); rows3.push(row('r' + k, 'l' + k + '.out', 'i2:cf', { amt: 0.1 })); }
  ex3.m1 = mod('macro', { v: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
  for (let k = 1; k <= 8; k++) { ex3['c' + k] = mod('cc', { cc: k }); }
  let n = 12;
  for (let k = 1; k <= 8; k++) rows3.push(row('r' + n++, 'm1.k' + k, 'i1:f.cutoff', { amt: 0.1 }));
  for (let k = 1; k <= 8; k++) rows3.push(row('r' + n++, 'c' + k + '.out', 'i1:f.res', { amt: 0.1 }));
  rows3.push(row('r' + n++, 'l1.out', 'i1:a.wt', { amt: 0.1 }));
  const t3 = track('trk_b3', 'Budgets', ex3, rows3);
  const t4 = track('trk_b4', 'No free slot', { l1: mod('lfo', { lfo: { mono: 0 } }), e1: mod('env', { att: 0.3 }) }, [
    row('r1', 'l1.out', 'i1:f.cutoff', { amt: 0.5 }),
    row('r2', 'e1.out', 'i1:a.wt', { amt: 0.4 }),
  ]);
  for (let k = 0; k < 10; k++) t4.dev.i1.vals.s.matrix[k] = normRow({ src: 'lfo' + (k + 1), amt: 0.01, dst: 'a.pan' });
  return [t1, t2, t3, t4];
}

// lane A2's cv-mods xferOf / targetsOf stubbed (compileMods opts): the identity transfer tagged with the call; the
// targets of a knob — the Juno's Env A knob moves two fields (as A2's table), everything else one
export const XFER = (model, vals, ctl, T) => ({ a: 0, b: 1, x0: typeof vals[ctl] === 'number' ? vals[ctl] / 10 : 0.5, of: model + '.' + ctl + ':' + (T.kind === 'slot' ? T.slot : T.field) });
export const TARGETS = (model, ctl) => (model === 'juno60' && ctl === 'a' ? [{ kind: 'field', field: 'fenv.a' }, { kind: 'field', field: 'aenv.a' }] : null);
// (src 5 = lfo1 of the synthetic CP: the module in LFO slot 1; vi 0 = a.level, 1 = a.pan: the first two scratch
// destinations; dst.slot 0 = engine.js S_VO, the Juno's VCF cutoff slot; fx 29 = the reverb's mix in the chain's layout: FX-context 8 + its flat parameter index 21)
export const PAY1 = {
  rows: [
    { id: 'r2', src: 5, dst: { kind: 'cls', inst: 'i2', slot: 0 }, amt: 0.25, bi: 1, curve: 0.3, crv: null, aux: 0, inv: 0, rise: 0, fall: 0, byp: 0, out: 1, perNote: false, vi: 0, slot: 0, tgt: 0 },
    { id: 'r3', src: 5, dst: { kind: 'fx', chain: 'fx1', fx: 29, key: '' }, amt: -0.2, bi: 0, curve: 0, crv: null, aux: 0, inv: 0, rise: 0.1, fall: 0.1, byp: 0, out: 1, perNote: false, vi: 1, slot: 1, tgt: 0 },
  ],
  xfer: [{ a: 0, b: 1, x0: 0.5, of: 'juno60.cf:0' }, null],
  ext: [{ k: 1, src: 5, id: 'l1.out' }],
  vals: [],
  keep: [5], // (fixer B, C1: an ext-listed source always gets a keep-alive row — a bypassed synthetic row must not starve the Serum's ext feed)
  left: [],
  dashed: [],
  n: { lfo: 1, env: 0, chaos: 0, macro: 0, vals: 0, ext: 1, rows: 2 },
  slots: { l1: { kind: 'lfo', i: 0 } }, // (the module's ModCore slot in the live-meter order: lfo 0…9, env 2 3 4 1 → 10…13, chaos 14…15)
};
export const KEEP_VI = vi('f2.level'); // (cv-graph KEEP_ID: the shared keep-alive scratch destination)
export const CP1 = {
  mN: 3, mSlot: [0, 1, 2], mSrc: [5, 5, 5], mDst: [0, 1, KEEP_VI], mAmt: [0.25, -0.2, 1], mBi: [1, 0, 0], mCtx: [1, 1, 1], // (row 3: l1's keep-alive)
  lfoMono: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], lfoMode: [0, 2, 2, 2, 2, 2, 2, 2, 2, 2], // (slot 1: the module, RETRIG; the rest parked FREE + MONO)
  aOn: 0, poly: 1,
};
