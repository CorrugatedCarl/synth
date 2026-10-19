// The classic adapter of stage 2b (IMPL-2b §5, SPEC-canvas §7.8; lane A2): transfer tables (cv-mods xferOf / targetsOf /
// knobOf), the Inst's slot offsets (modRows / modSpan), the span setters, the eff snapshot; the N3 oracle, noise from
// zero, the fade-out, setter quantisation, no allocation per span, the N4 rows mk (cutoff cable ≤ 8 % over the row
// without) and ms (setters ≤ 1 µs per call per voice).
// Run: node --max-old-space-size=2048 --test tests/classic-mod.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as V from '../cv-mods.js?v=9';
import { MODELS, patchFor } from '../models.js?v=9';
import { defaultFx2 } from '../serum-core.js?v=9';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import { timeInterleaved } from './golden-harness.mjs';
import * as CPU from './cpu-gate.mjs';

const SR = 48000, CLASSIC = MODELS.filter(m => !m.custom), quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const S = V.SLOT;
const vals = (id, o) => { const m = MODELS.find(x => x.id === id); return Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}); };
const patch = (id, o, drift = 0.5) => patchFor(id, vals(id, o), defaultFx2(), { sr: SR, bpm: 120, drift, hiss: 1 });

/* ------------------------------------------------------------------ transfer tables (§5.3) */
test('SLOT mirrors engine.js S_* (the slot numbering of modRows / MC.cls)', () => {
  const src = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
  const m = /const S_VO = 0,([\s\S]*?)S_N = 29;/.exec(src);
  assert.ok(m, 'the S_* line');
  const eng = Object.fromEntries([...('S_VO = 0,' + m[1] + 'S_N = 29').matchAll(/S_(\w+) = (\d+)/g)].map(x => [x[1], +x[2]]));
  assert.deepEqual(eng, S);
  assert.equal(Object.keys(S).length, 24);
});

test('every sm / apply / proc control of the twelve models has a target (slot or field); classes agree', () => {
  const un = [], wrong = [];
  let slots = 0, fields = 0;
  for (const m of CLASSIC) for (const c of m.controls) {
    const cls = V.classOf(m.id, c.id), T = V.targetsOf(m, c.id);
    if (cls === 'none' && T.length) wrong.push(m.id + '.' + c.id + ': none with targets');
    if (cls !== 'sm' && cls !== 'apply' && cls !== 'proc') continue; // (chunk: stage 5; struct / none: never)
    if (!T.length) { un.push(m.id + '.' + c.id); continue; }
    for (const t of T) {
      if (t.kind === 'slot') { slots++; if (!(t.slot >= 0 && t.slot < S.BEND)) wrong.push(m.id + '.' + c.id + ': slot ' + t.slot); }
      else { fields++; if (V.FIELD_CLASS[t.field] !== 'apply' && V.FIELD_CLASS[t.field] !== 'proc') wrong.push(m.id + '.' + c.id + ': ' + t.field); }
    }
    if (cls === 'sm' && T.some(t => t.kind !== 'slot')) wrong.push(m.id + '.' + c.id + ': sm with a field');
    if (cls !== 'sm' && !T.some(t => t.kind === 'field')) wrong.push(m.id + '.' + c.id + ': ' + cls + ' without a field');
  }
  assert.deepEqual(un, []);
  assert.deepEqual(wrong, []);
  assert.ok(slots >= 129 && fields >= 107, `${slots} slot targets, ${fields} field targets`);
  // a master tune moves three TU slots, Brilliance both filters, a filter-revision switch character fields and the drive slot
  assert.deepEqual(V.targetsOf('minimoog', 'tune').map(t => t.slot), [S.TU, S.TU + 1, S.TU + 2]);
  assert.deepEqual(V.targetsOf('cs80', 'br').map(t => t.slot), [S.VO, S.DO]);
  assert.deepEqual(V.targetsOf('prophet5', 'rev').map(t => t.kind + ':' + (t.slot ?? t.field)), ['slot:' + S.DRV, 'field:vcf.comp', 'field:vcf.fbSat']);
  assert.deepEqual(V.slotOf('juno60', 'cf'), { kind: 'slot', slot: S.VO, field: 'vcf.oct' });
  assert.deepEqual(V.slotOf('dx7', 'vol'), { kind: 'slot', slot: S.LEV, field: 'level' });
  assert.equal(V.slotOf('juno60', 'lr').field, 'lfo.rate');
  assert.equal(V.slotOf('minimoog', 'mm'), null, 'a knob that changes nothing');
  assert.equal(V.slotOf('prophet5', 'un').slot, S.LEV, 'a struct knob still reports what it touches (destOk refuses it by class)');
  assert.equal(V.xferOf('serum', {}, 'x'), null);
});

// exact for the linear laws (a + b·x against map() at points off the grid), bounded for the others: the engine interpolates
// the 129-point table linearly, so between two points an exponential law (time, rate, glide: ex = lo·(hi/lo)^(v/10)) is off
// by at most (ln(hi/lo))² / (8·128²) of the value — 0.063 % for the widest, 0.004…35 s — and the test holds every table to
// 0.1 % of its range at the mid-points; selector and toggle tables are stepped (exact at the points, the step inside one
// 1/128 cell)
test('xferOf: linear knobs exact, exponential ones within 0.1 % of the range between table points; the inverse round-trips', () => {
  let lin = 0, tabs = 0, worst = 0;
  const bad = [];
  for (const m of CLASSIC) {
    const v = vals(m.id);
    for (const c of m.controls) {
      const cls = V.classOf(m.id, c.id);
      if (cls !== 'sm' && cls !== 'apply' && cls !== 'proc') continue;
      const T = V.targetsOf(m, c.id);
      for (const t of T) {
        const xf = V.xferOf(m, v, c.id, t), lo = c.t === 'k' ? c.min : 0, hi = c.t === 'k' ? c.max : c.t === 's' ? c.opts.length - 1 : 1;
        const at = x => { const w = Object.assign({}, v, { [c.id]: c.t === 'k' ? lo + (hi - lo) * x : Math.round(lo + (hi - lo) * x) }), p = V.patchOf(m, w); return t.kind === 'slot' ? V.slotValue(p, t.slot) : +t.field.split('.').reduce((o, k) => (o ? o[k] : undefined), p) || 0; };
        assert.ok(xf && xf.x0 >= 0 && xf.x0 <= 1, m.id + '.' + c.id);
        if (xf.tab) {
          tabs++;
          const range = Math.max(...xf.tab) - Math.min(...xf.tab);
          if (c.t === 'k') for (let k = 0; k < 128; k++) {
            if (k === 0 && xf.tab[0] === 0 && xf.tab[1] !== 0) continue; // (glide: off below 0.05 of the dial, 12 ms above — the jump sits in cell 0)
            const e = Math.abs((xf.tab[k] + xf.tab[k + 1]) / 2 - at((k + 0.5) / 128)) / (range || 1);
            if (e > worst) worst = e;
            if (e > 1e-3) { bad.push(`${m.id}.${c.id}/${t.field} ${e.toExponential(2)} at ${k}`); break; }
          } else for (let k = 0; k <= 128; k++) if (xf.tab[k] !== at(k / 128)) { bad.push(`${m.id}.${c.id} step table at ${k}`); break; }
          if (range > 0 && c.t === 'k') { // the inverse at the points of a monotonic table (a selector's steps: the step's first point)
            const mono = xf.tab.every((y, k) => k === 0 || (xf.tab[128] >= xf.tab[0] ? y >= xf.tab[k - 1] : y <= xf.tab[k - 1]));
            if (mono) for (const k of [0, 37, 100, 128]) { const x = V.xferInv(xf, xf.tab[k]); if (Math.abs(x - k / 128) > 1e-12 && !(xf.tab[k] === xf.tab[0] && x === 0)) { bad.push(`${m.id}.${c.id} inverse at ${k}: ${x}`); break; } }
          }
        } else {
          lin++;
          for (const x of [0.3137, 0.77, 1]) if (Math.abs(xf.a + xf.b * x - at(x)) > 1e-9) { bad.push(`${m.id}.${c.id}/${t.kind === 'slot' ? t.slot : t.field} not linear at ${x}`); break; }
          if (xf.b !== 0) assert.ok(Math.abs(V.xferInv(xf, xf.a + xf.b * 0.42) - 0.42) < 1e-12, m.id + '.' + c.id + ' inverse');
          else assert.equal(V.xferInv(xf, xf.a), xf.x0, m.id + '.' + c.id + ' inert: the knob stays');
        }
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(lin >= 120 && tabs >= 90, `${lin} linear, ${tabs} tables (worst mid-point error ${worst.toExponential(2)} of the range)`);
  assert.ok(worst < 1e-3);
});

test('knobOf: engine value → panel units (the eff snapshot\'s halos); the transfer follows the neighbours', () => {
  const v = vals('juno60');
  const cf = V.xferOf('juno60', v, 'cf');
  assert.ok(!cf.tab && Math.abs(cf.a - Math.log2(30)) < 1e-12 && Math.abs(cf.b - Math.log2(18000 / 30)) < 1e-12 && cf.x0 === 0.6, 'cutoff: lg(ex()) is linear in the dial');
  assert.ok(Math.abs(V.knobOf('juno60', v, 'cf', cf.a + cf.b * 0.6) - 6) < 1e-9);
  assert.ok(Math.abs(V.knobOf('juno60', v, 'cf', 1000) - 10) < 1e-12 && V.knobOf('juno60', v, 'cf', -5) === 0, 'clamped');
  const a = V.xferOf('juno60', v, 'a');
  assert.ok(a.tab && a.tab[0] === 0.0015 && Math.abs(a.tab[128] - 3) < 1e-12 && a.x0 === 0.05);
  assert.ok(Math.abs(V.knobOf('juno60', v, 'a', 0.0015 * Math.pow(2000, 0.5)) - 5) < 1e-3, 'an exponential time knob at 5');
  assert.equal(V.knobOf('juno60', v, 'ch', 2), 2, 'a selector');
  // the Minimoog noise level through the mixer switch: inert while the switch is off, live when on
  assert.deepEqual(V.xferOf('minimoog', vals('minimoog'), 'nz'), { a: 0, b: 0, x0: 0 });
  const nz = V.xferOf('minimoog', vals('minimoog', { mn: 1, nz: 2 }), 'nz');
  assert.ok(Math.abs(nz.b - 0.8) < 1e-12 && nz.x0 === 0.2);
  // the level of a switched-off oscillator: its slot value is 0 whatever the knob (2b: nomod, destOk's live check)
  assert.equal(V.slotValue({ osc: [{ on: 0, lev: 0.7 }] }, S.OL), 0);
  assert.equal(V.slotValue({ osc: [{}, { on: 1, lev: 0.7, oct: 12, fine: 50, pw: 0.3 }] }, S.OL + 1), 0.7);
  assert.equal(V.slotValue({ osc: [{}, { on: 1, lev: 0.7, oct: 12, fine: 50, pw: 0.3 }] }, S.TU + 1), 12.5);
  assert.equal(V.slotValue({ osc: [{}, { on: 1, lev: 0.7, oct: 12, fine: 50, pw: 0.3 }] }, S.PW + 1), 0.3);
  assert.equal(V.slotValue({ level: 0.3, engine: 'fm' }, S.LEV), 0.3);
});

/* ------------------------------------------------------------------ the engine (§5.1, §5.2) */
function proc(D, p, os = 2) {
  const P = new D.Proc({ processorOptions: { os, hostOS: os } });
  P.msg({ t: 'patch', p });
  return P;
}
// renders `frames` (whole quanta) of P into L; `hook(F, n)` (optional) runs before each span's render with the span start
// frame and length (the Track's call site of modSpan, IMPL-2b §2.4, stubbed on the Inst)
function run(D, P, frames, L, at, hook) {
  const I = P.i0, out = [[new Float32Array(128), new Float32Array(128)]];
  if (hook && !I.__hook) { const rs = I.renderSpan; I.__hook = 1; I.renderSpan = function (n) { hook(P.spanF, n); return rs.call(this, n); }; }
  for (let o = 0; o < frames; o += 128) {
    P.process([], out);
    if (L) L.set(out[0][0], at + o);
    D.ctx.currentFrame += 128;
  }
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; };
const peak = a => { let m = 0; for (const x of a) if (Math.abs(x) > m) m = Math.abs(x); return m; };
const fresh = (seed = 'classic-mod') => dspScope({ engine: true, fast: true, console: quiet, seed });
const seconds = n => Math.round(n * SR / 128) * 128;

test('N3 oracle: a GLOBAL LFO on the Juno-60 cutoff through modSpan equals an oracle that sets the slot per span from smTargets, ≤ 1e-9 over 2 s with a note-on while modulated', () => {
  const lfo = F => 1.5 * Math.sin(2 * Math.PI * 0.7 * F / SR); // octaves
  const c0 = new Float64Array(S.N), c1 = new Float64Array(S.N);
  const ev = P => ({ 0: () => { for (const n of [48, 55, 60]) P.msg({ t: 'on', n, v: 0.8 }); }, [seconds(0.5)]: () => { for (const n of [48, 55, 60]) P.msg({ t: 'off', n }); },
    [seconds(1)]: () => P.msg({ t: 'on', n: 64, v: 0.9 }), [seconds(1.6)]: () => P.msg({ t: 'off', n: 64 }) });
  const render = (D, P, hook) => {
    const N = seconds(2), L = new Float32Array(N), E = ev(P);
    for (let o = 0; o < N; o += 128) { if (E[o]) E[o](); run(D, P, 128, L, o, hook); }
    return L;
  };
  // (A) the adapter
  const D = fresh('n3'), A = proc(D, patch('juno60'));
  A.i0.modRows([{ slot: S.VO }]);
  const LA = render(D, A, (F, n) => { c0[S.VO] = lfo(F); c1[S.VO] = lfo(F + n); A.i0.modSpan(c0, c1, null); });
  // (B) the oracle: the slot's start / end values set per span from smTargets' target plus the LFO
  const D2 = fresh('n3'), B = proc(D2, patch('juno60')), I = B.i0, st = I.smStep;
  let last = I.smT[S.VO] + lfo(0), cur = null;
  I.smStep = function (n) {
    st.call(this, n);
    const a = this.smA, b = this.smB, d = this.smD;
    a[S.VO] = last; b[S.VO] = this.smT[S.VO] + cur; d[S.VO] = b[S.VO] - a[S.VO]; last = b[S.VO]; this.smMv = true;
  };
  const LB = render(D2, B, (F, n) => { cur = lfo(F + n); });
  // (C) no cable
  const D3 = fresh('n3'), C = proc(D3, patch('juno60'));
  const LC = render(D3, C, null);
  assert.ok(peak(LA) > 1e-2 && peak(LC) > 1e-2);
  assert.ok(maxDiff(LA, LC) > 1e-3, 'the cable is heard');
  const d = maxDiff(LA, LB);
  assert.ok(d <= 1e-9, `oracle: max |A − B| = ${d}`);
  assert.equal(A.i0.smB[S.VO], A.i0.smT[S.VO], 'smB restored by copy: settled at the target');
  assert.equal(A.i0.smMv, true);
});

test('noise from zero: a cable on the noise slot of a Juno whose Noise is at 0 produces noise — the same as the knob at that level', () => {
  const p0 = patch('juno60'), pK = patch('juno60', { nz: 4 });
  assert.equal(p0.noise, 0);
  const off = pK.noise, c = new Float64Array(S.N); c[S.NZ] = off;
  const N = seconds(0.5), LA = new Float32Array(N), LK = new Float32Array(N), L0 = new Float32Array(N);
  const DA = fresh('nz'), A = proc(DA, p0); A.i0.modRows([{ slot: S.NZ }]); A.msg({ t: 'on', n: 52, v: 0.8 });
  run(DA, A, N, LA, 0, () => A.i0.modSpan(c, c, null));
  const DK = fresh('nz'), K = proc(DK, pK); K.msg({ t: 'on', n: 52, v: 0.8 }); run(DK, K, N, LK, 0);
  const D0 = fresh('nz'), Z = proc(D0, p0); Z.msg({ t: 'on', n: 52, v: 0.8 }); run(D0, Z, N, L0, 0);
  assert.ok(maxDiff(LA, L0) > 1e-3, 'noise is heard from a knob at 0');
  assert.ok(maxDiff(LA, LK) <= 1e-9, 'as the knob at that level (' + maxDiff(LA, LK) + ')');
  assert.equal(A.i0.smB[S.NZ], 0, 'the slot itself stays at the knob');
});

test('fade-out during modulation keeps the modulated level: the de-click tail of a cabled cutoff equals the tail of the knob at that value', () => {
  const p0 = patch('juno60'), pK = patch('juno60'); pK.vcf.oct += 3;
  const c = new Float64Array(S.N); c[S.VO] = 3;
  const N1 = seconds(0.3), N2 = seconds(0.1), LA = new Float32Array(N1 + N2), LK = new Float32Array(N1 + N2), L0 = new Float32Array(N1 + N2);
  const go = (D, P, L, hook) => { for (const n of [48, 55, 60]) P.msg({ t: 'on', n, v: 0.8 }); run(D, P, N1, L, 0, hook); P.i0.allOff(true); run(D, P, N2, L, N1, hook); };
  const DA = fresh('fade'), A = proc(DA, p0); A.i0.modRows([{ slot: S.VO }]); go(DA, A, LA, () => A.i0.modSpan(c, c, null));
  const DK = fresh('fade'), K = proc(DK, pK); go(DK, K, LK);
  const D0 = fresh('fade'), Z = proc(D0, p0); go(D0, Z, L0);
  assert.ok(A.i0.tailN === 0 && peak(LA.subarray(N1)) > 1e-4, 'the tail was rendered and heard');
  assert.ok(maxDiff(LA.subarray(N1), L0.subarray(N1)) > 1e-4, 'the tail differs from the unmodulated one');
  assert.ok(maxDiff(LA, LK) <= 1e-9, 'tail and note as the knob at the modulated value (' + maxDiff(LA, LK) + ')');
});

test('span setters: a slow LFO on an envelope time costs a handful of Env.set calls (1/512 quantisation); the field is in the patch; the voices follow', () => {
  const D = fresh('set'), P = proc(D, patch('juno60')), I = P.i0;
  const xf = V.xferOf('juno60', vals('juno60'), 'a', { kind: 'field', field: 'fenv.a' });
  I.modRows([{ field: 'fenv.a', xfer: xf }]);
  let calls = 0;
  for (const v of I.voices) { const e = v.fenv, set = e.set; e.set = function () { calls++; return set.apply(this, arguments); }; }
  for (const n of [48, 55, 60]) P.msg({ t: 'on', n, v: 0.8 });
  const base = I.p.fenv.a, sv = [{ field: 'fenv.a', v: base }];
  const N = seconds(2), vf = F => base + 0.05 * Math.sin(2 * Math.PI * 0.5 * F / SR);
  let spans = 0;
  run(D, P, N, null, 0, (F) => { sv[0].v = vf(F); I.modSpan(null, null, sv); spans++; });
  // 0.1 s of swing on a 0.0015…3 s field: 17 grid steps, crossed twice per cycle, ×3 voices; unquantised it would be every span
  assert.ok(spans >= 700, spans + ' spans');
  assert.ok(calls >= 3 * 10 && calls <= 3 * 48, `${calls} Env.set calls over ${spans} spans × 3 voices`);
  const vLast = vf(N - 128);
  assert.ok(Math.abs(I.p.fenv.a - vLast) <= (3 - 0.0015) / 512 + 1e-12, 'the patch field holds the effective value within one grid step');
  const tf = 1 + 0.07 * I.voices[0].tolE * I.p.drift, ta = Math.max(I.p.fenv.a * tf, 0.0002) / Math.log(1.3 / 0.3);
  assert.ok(Math.abs(I.voices[0].fenv.ca - (1 - Math.exp(-1 / (ta * I.fs / I.CH)))) < 1e-15, 'the voice\'s attack coefficient follows');
  assert.equal(I.modEff()[0], Math.fround(I.p.fenv.a), 'the eff snapshot: the effective field value');
  // the row goes: the base is back in the patch and in every voice
  I.modRows(null);
  assert.equal(I.p.fenv.a, base);
  const ta0 = Math.max(base * tf, 0.0002) / Math.log(1.3 / 0.3);
  assert.ok(Math.abs(I.voices[0].fenv.ca - (1 - Math.exp(-1 / (ta0 * I.fs / I.CH)))) < 1e-15);
  assert.equal(I.modEff(), null);
});

test('span setters: proc fields (lfo.rate, bendRange, unisonDetune, fx.chorus) take effect within one span; unknown / non-numeric fields are ignored; setPatch refreshes the bases', () => {
  const D = fresh('proc'), P = proc(D, patch('prophet5', { un: 1 })), I = P.i0;
  I.modRows([{ field: 'lfo.rate' }, { field: 'bendRange' }, { field: 'unisonDetune' }, { field: 'fx.chorus' }, { field: 'prio' }, { field: 'nope.x' }, { slot: S.VR }]);
  assert.deepEqual([I.moN, I.moFN, I.moVK], [1, 4, 0]);
  const base = I.p.lfo.rate, sv = [{ field: 'lfo.rate', v: 20 }, { field: 'bendRange', v: 12 }, { field: 'unisonDetune', v: 30 }, { field: 'fx.chorus', v: 1 }, { field: 'prio', v: 1 }];
  P.msg({ t: 'bend', v: 0.5 });
  for (const n of [48, 55]) P.msg({ t: 'on', n, v: 0.8 });
  run(D, P, 128, null, 0, () => I.modSpan(null, null, sv));
  const ph0 = I.lfoPh;
  run(D, P, 128, null, 0);
  assert.equal(I.p.lfo.rate, 20);
  assert.ok(Math.abs(((I.lfoPh - ph0) % 1 + 1) % 1 - (20 * 128 / SR) % 1) < 1e-9, 'the LFO ran at the cabled rate this span');
  assert.equal(I.bend, 0.5 * 12, 'bend range: bend = bendRaw × range');
  assert.ok(I.voices.length > 1 && Math.abs(I.voices[0].det - (-0.3)) < 1e-12 && I.voices[0].target === I.voices[0].note - 0.3, 'unison spread re-targets sounding notes');
  assert.equal(I.chorus.mode, 1);
  assert.equal(I.p.prio, 'last', 'a non-numeric field is never written');
  assert.deepEqual([...I.modEff()], [20, 12, 30, 1, 0, 0, Math.fround(I.smB[S.VR])]);
  // a new patch: its lfo.rate is the base; the cabled value is applied again at the next span
  const p2 = patch('prophet5', { un: 1, lr: 2 });
  P.msg({ t: 'patch', p: p2 });
  assert.equal(I.p.lfo.rate, p2.lfo.rate);
  assert.equal(I.moF[0].base, p2.lfo.rate);
  run(D, P, 128, null, 0);
  assert.equal(I.p.lfo.rate, 20);
  I.modRows(null);
  assert.equal(I.p.lfo.rate, p2.lfo.rate, 'base restored when the rows go');
  assert.equal(I.bend, 0.5 * p2.bendRange);
  assert.equal(I.chorus.mode, 0);
  assert.equal(base, patch('prophet5').lfo.rate);
});

test('modSpan: the two-argument form, null offsets, NaN guarded; a Solina level cable and a DX7 level cable (level is their only slot)', () => {
  const D = fresh('forms'), P = proc(D, patch('juno60')), I = P.i0;
  I.modRows([{ slot: S.VO }, { slot: S.VO }, { slot: S.VR }, { slot: S.BEND }, null]);
  assert.deepEqual([I.moN, [...I.moSlots.subarray(0, 2)], [...I.moRow]], [2, [S.VO, S.VR], [S.VO, S.VO, S.VR, -1, -1]]);
  const off = new Float64Array(S.N); off[S.VO] = 2; off[S.VR] = NaN;
  I.modSpan(off, [{ field: 'x', v: 1 }]);
  assert.deepEqual([I.moEnd[S.VO], I.moEnd[S.VR]], [2, 0]);
  I.modSpan(off);
  assert.equal(I.moEnd[S.VO], 2);
  I.modSpan(null, null, null);
  assert.equal(I.moEnd[S.VO], 0, 'null: no offset this span');
  for (const [id, pr, n] of [['solina', null, 8], ['dx7', 'Brass Ensemble', 8]]) {
    const m = MODELS.find(x => x.id === id), v = vals(id, pr ? m.presets.find(x => x.name === pr).v : null);
    const p = patchFor(m, v, defaultFx2(), { sr: SR, bpm: 120, drift: 0.5, hiss: 1 });
    const c = new Float64Array(S.N); c[S.LEV] = -p.level * 0.5;
    const N = seconds(0.25), LA = new Float32Array(N), L0 = new Float32Array(N);
    const DA = fresh(id), A = proc(DA, p, 1); A.i0.modRows([{ slot: S.LEV }]); for (let k = 0; k < n; k++) A.msg({ t: 'on', n: 48 + 3 * k, v: 0.8 });
    run(DA, A, N, LA, 0, () => A.i0.modSpan(c, c, null));
    const D0 = fresh(id), Z = proc(D0, p, 1); for (let k = 0; k < n; k++) Z.msg({ t: 'on', n: 48 + 3 * k, v: 0.8 });
    run(D0, Z, N, L0, 0);
    assert.ok(peak(LA) > 1e-3 && peak(LA) < peak(L0) * 0.6, `${id}: the level cable halves the output (${peak(LA)} vs ${peak(L0)})`);
  }
});

test('no allocation per span: modSpan + the Track\'s process under throwing constructors (slots and fields cabled)', () => {
  const D = fresh('alloc'), P = proc(D, patch('juno60')), I = P.i0;
  I.modRows([{ slot: S.VO }, { slot: S.NZ }, { field: 'fenv.a', lo: 0.0015, hi: 3 }, { field: 'lfo.rate' }]);
  for (const n of [48, 55, 60]) P.msg({ t: 'on', n, v: 0.8 });
  const c0 = new Float64Array(S.N), c1 = new Float64Array(S.N), sv = [{ field: 'fenv.a', v: 0.01 }, { field: 'lfo.rate', v: 3 }];
  const out = [[new Float32Array(128), new Float32Array(128)]];
  let k = 0;
  const rs = I.renderSpan;
  I.renderSpan = function (n) { c0[S.VO] = Math.sin(k); c1[S.VO] = Math.sin(k + 0.1); c1[S.NZ] = 0.2; sv[0].v = 0.01 + 0.001 * (k & 7); sv[1].v = 3 + (k & 1); I.modSpan(c0, c1, sv); return rs.call(this, n); };
  P.process([], out); D.ctx.currentFrame += 128;
  noAlloc(D, () => { for (k = 1; k < 60; k++) { P.process([], out); D.ctx.currentFrame += 128; } });
  assert.ok(peak(out[0][0]) > 1e-4);
});

/* ------------------------------------------------------------------ N4 rows mk and ms (bench-scenarios.mjs, bench.json) */
// row mk: an 8-voice Juno-60 (OS 2, as measure()'s voice rows) with one cutoff cable ≤ 8 % over the same row without —
// the cost is smMv every span (per-chunk interpolation and setRes in every voice); medians of interleaved pairs, re-measured
// while over the gate (RULINGS2 Performance)
test('N4 row mk: an 8-voice Juno-60 with one cutoff cable renders within 8 % of the row without', async (t) => {
  const mk = () => { const D = fresh('mk'), p = patch('juno60'); p.poly = 8; const P = proc(D, p); for (let k = 0; k < 8; k++) P.msg({ t: 'on', n: 48 + 3 * k, v: 0.8 }); return { D, P }; };
  const A = mk(), B = mk();
  A.P.i0.modRows([{ slot: S.VO }]);
  const c0 = new Float64Array(S.N), c1 = new Float64Array(S.N), lfo = F => 2 * Math.sin(2 * Math.PI * 2 * F / SR);
  const out = [[new Float32Array(128), new Float32Array(128)]];
  const rs = A.P.i0.renderSpan;
  A.P.i0.renderSpan = function (n) { const F = A.P.spanF; c0[S.VO] = lfo(F); c1[S.VO] = lfo(F + n); this.modSpan(c0, c1, null); return rs.call(this, n); };
  const sec = X => () => { for (let k = 0; k < SR / 128; k++) { X.P.process([], out); X.D.ctx.currentFrame += 128; } };
  const fA = sec(A), fB = sec(B);
  fA(); fB(); // (warm; both sound)
  assert.ok(A.P.i0.act === 8 && B.P.i0.act === 8, '8 voices on both');
  const r = timeInterleaved(fB, fA, { runs: 5, limit: 1.08, tries: 5 });
  t.diagnostic(`row mk: without ${r.a.toFixed(1)} ms/s, with the cable ${r.b.toFixed(1)} ms/s, ratio ${r.ratio.toFixed(3)} (attempt ${r.attempts})`);
  assert.ok(r.ratio <= 1.08, `mk: ${r.ratio.toFixed(3)} > 1.08`);
});

// row ms: 4 envelope fields cabled on 8 active voices, the values changing every call (every call runs Env.set on every
// voice for every field): ≤ 1 µs per call per voice, calibrated by t_ref(calib) / t(calib) as the other node gates
test('N4 row ms: span setters ≤ 1 µs per call per voice (4 envelope fields × 8 voices, every call a change)', async (t) => {
  const D = fresh('ms'), p = patch('juno60'); p.poly = 8;
  const P = proc(D, p), I = P.i0;
  for (let k = 0; k < 8; k++) P.msg({ t: 'on', n: 48 + 3 * k, v: 0.8 });
  const out = [[new Float32Array(128), new Float32Array(128)]];
  P.process([], out); D.ctx.currentFrame += 128;
  assert.equal(I.act, 8);
  const F = ['fenv.a', 'fenv.r', 'aenv.a', 'aenv.r'];
  I.modRows(F.map(f => ({ field: f, lo: 0.001, hi: 10 })));
  const sv = F.map(f => ({ field: f, v: 0.1 }));
  const CALLS = 2000;
  let j = 0;
  const fn = () => { for (let k = 0; k < CALLS; k++) { const v = 0.1 + 0.05 * ((j++) & 1); for (const e of sv) e.v = v; I.modSpan(null, null, sv); } };
  fn();
  assert.equal(I.moGen > 1 && I.voices.filter(v => v.active).length, 8);
  const calib = CPU.T_REF_CALIB > 0 ? await CPU.calibRowB() : null;
  const time = f => { const t0 = performance.now(); f(); return performance.now() - t0; };
  let best = Infinity, kBest = 1;
  for (let a = 0; a < 5; a++) {
    const tc = calib ? time(calib) : 0, tf = time(fn), tc2 = calib ? time(calib) : 0;
    const k = calib ? CPU.T_REF_CALIB / ((tc + tc2) / 2) : 1, us = tf * 1000 / (CALLS * F.length * 8) * k;
    if (us < best) { best = us; kBest = k; }
    if (best <= 1) break;
  }
  t.diagnostic(`row ms: ${best.toFixed(3)} µs per call per voice (calibrated ×${kBest.toFixed(2)})`);
  assert.ok(best <= 1, `ms: ${best.toFixed(3)} µs > 1 µs`);
});
