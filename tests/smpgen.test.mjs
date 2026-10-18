// Factory content tests (owner S1; SPEC-serum2 §10, §11.12, §15.11): smpgen.js catalogues and the render farm
// (smprender.js, run in a node:vm "worker" whose importScripts reads the repository files).
// Catalogue ids, roots, budgets and references; the generator primitives; every procedural sample and IR
// (deterministic, finite, peak ≤ 1, duration, RT60 ±20 %); render plans and post-processing on synthetic renders (gain,
// trim, mono, sustain loops in the gate, zone map, the stereo layer rule); the render farm (deterministic with seeded
// Math.random, Solina included; stops on silence; transfers; self-contained) and the whole factory set through it (both
// budgets, zone coverage, loops, vt = 1, the render-farm samples); patchFor ≡ main.js buildPatch minus live fields.
// Run: node --test tests/smpgen.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DSP_FILES, dspScope } from './dsp-scope.mjs';

const ROOT = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const MAIN = read('main.js');
const V = '?v=' + /const VERSION = '(\d+)'/.exec(MAIN)[1];
const imp = f => import(new URL(f + V, ROOT).href);
const gen = await imp('smpgen.js');
const models = await imp('models.js');
const core = await imp('serum-core.js');
const wt = await imp('wt.js');
const smp = await imp('smp.js');
const work = await imp('smpwork.js');
const A = await imp('assets.js');
const CG = await imp('cv-graph.js'), CM = await imp('cv-migrate.js'), CMOD = await imp('cv-model.js'); // (main.js buildPatch: the canonical compile, stage 1c)
const notImpl = fn => assert.throws(fn, e => e && e.code === 'ENOTIMPL');

/* ------------------------------------------------------------------ catalogues (§10.1–§10.3) */
test('§10.1: FACTORY_MULTI — 18 instruments, roots by the step rule, budgets 16 MB / 150 MB, real models and presets', () => {
  const M = gen.FACTORY_MULTI;
  assert.equal(M.length, 18);
  assert.ok(Object.isFrozen(M) && Object.isFrozen(M[0]) && Object.isFrozen(M[0].roots));
  assert.equal(new Set(M.map(m => m.id)).size, 18);
  assert.deepEqual(gen.multiRoots(24, 96), [24, 36, 42, 48, 54, 60, 66, 72, 78, 84, 96]);
  assert.deepEqual([gen.multiRoots(24, 60).length, gen.multiRoots(36, 96).length, gen.multiRoots(48, 96).length, gen.multiRoots(36, 84).length], [6, 10, 8, 9]);
  assert.deepEqual(M.find(m => m.name === 'DX Bells').roots, [36, 48, 60, 72, 84, 96]);
  let total = 0;
  for (const m of M) {
    assert.ok(m.id === 'fmsmp:' + m.name && gen.factoryKind(m.id) === 'multi');
    const mdl = models.MODELS.find(x => x.id === m.model);
    assert.ok(mdl && mdl.presets.some(p => p.name === m.preset), m.name + ': ' + m.model + ' / ' + m.preset);
    // the table's MB column = worst case for the expected channel count (decimal MB)
    const bytes = m.roots.length * m.vels.length * (m.gate + m.tail) * 48000 * (m.ch === 'st' ? 2 : 1) * 4;
    assert.ok(Math.abs(bytes / 1e6 - m.mb) < 0.06, m.name + ' ' + (bytes / 1e6).toFixed(2) + ' MB vs ' + m.mb);
    assert.ok(bytes <= gen.MULTI_BUDGET.instrument, m.name + ' ≤ 16 MB');
    assert.ok(['sustain', 'oneshot'].includes(m.loop) && m.vels.every(v => v >= 1 && v <= 127));
    total += bytes;
  }
  assert.ok(total <= gen.MULTI_BUDGET.total && total > 140e6, 'total ' + (total / 1e6).toFixed(1) + ' MB');
});

test('§10.2–§10.4: FACTORY_SAMPLES and FACTORY_IRS — ids, categories, roots, render-farm references, folders', () => {
  const S = gen.FACTORY_SAMPLES;
  assert.equal(S.length, 17);
  assert.equal(new Set(S.map(s => s.id)).size, 17);
  for (const s of S) {
    assert.ok(s.id === 'fsmp:' + s.name && gen.factoryKind(s.id) === 'sample');
    assert.ok(['Vocal', 'Tonal', 'Loops', 'Textures', 'FX'].includes(s.cat) && s.seconds > 0 && s.root >= 0 && s.root <= 127);
    assert.equal(s.granFirst, ['Textures', 'Vocal', 'Loops'].includes(s.cat) ? 1 : 0);
    if (s.src === 'farm') {
      if (s.model === 'serum') {
        const v1 = core.FACTORY_PRESETS_V1.map(p => p.name);
        for (const p of s.presets) assert.ok(v1.includes(p), s.name + ': Phase-1 Serum preset ' + p);
        assert.ok(Math.abs(s.bars * 4 * 60 / s.bpm - s.seconds) < 1e-9, s.name + ' length = bars at the tempo');
      } else {
        const mdl = models.MODELS.find(x => x.id === s.model);
        assert.ok(mdl && mdl.presets.some(p => p.name === s.preset), s.name);
      }
    } else assert.equal(s.src, 'proc');
  }
  assert.deepEqual(S.filter(s => s.root !== 60).map(s => [s.name, s.root]), [['Vowel Phrase', 48], ['Choir Ahh', 57], ['Pluck Guitar', 45], ['Glass Bell', 72], ['FM Drone', 57]]);
  assert.deepEqual(S.find(s => s.name === 'Choir Ahh').loop, [1, 3.5]);
  const I = gen.FACTORY_IRS;
  assert.equal(I.length, 29);
  assert.equal(new Set(I.map(x => x.id)).size, 29);
  for (const x of I) {
    assert.ok(x.id === 'fir:' + x.folder + '/' + x.name && gen.IR_FOLDERS.includes(x.folder) && gen.factoryKind(x.id) === 'ir');
    if (x.p.of) assert.ok(I.some(y => y.id === x.p.of), x.name + ' derives from ' + x.p.of);
  }
  assert.deepEqual(gen.IR_FOLDERS.map(f => I.filter(x => x.folder === f).length), [3, 3, 3, 3, 6, 5, 6]);
  assert.equal(gen.factoryKind('fsmp:Nope'), '');
});

test('§11.12: generate / renderPlan / post-processing / primitives — signatures, seeding, ids without content', () => {
  assert.ok(Number.isInteger(gen.GEN_VER) && gen.GEN_VER >= 1);
  const ARITY = { generate: 1, renderPlan: 1, multiFromRenders: 2, sampleFromRenders: 2, keptVels: 2, glottal: 1, karplus: 1, imageSource: 1, velvetTail: 1, cabIR: 1, spring: 1 };
  for (const [k, n] of Object.entries(ARITY)) assert.ok(typeof gen[k] === 'function' && gen[k].length === n, k);
  assert.equal(gen.generate('fsmp:Nope'), null);
  assert.equal(gen.generate('fmsmp:Juno Pad'), null, 'multisamples come from the render farm');
  assert.equal(gen.generate('fsmp:Drum Loop 120'), null, 'render-farm samples too');
  assert.equal(gen.renderPlan('fsmp:Glass Bell'), null, 'procedural samples have no render plan');
  assert.equal(gen.renderPlan('fir:Short/Small Room'), null);
  assert.equal(gen.renderPlan('nope'), null);
  assert.throws(() => gen.multiFromRenders({}, []), /not a multisample plan/);
  assert.throws(() => gen.multiFromRenders(gen.renderPlan('fmsmp:Acid Pluck'), []), /one render per plan note/);
  assert.throws(() => gen.sampleFromRenders(gen.renderPlan('fmsmp:Acid Pluck'), []), /not a sample plan/);
  // seeding rule (§10): mulberry32(fnv1a32(id))
  const a = gen.rngFor('fsmp:Wind Field'), b = wt.mulberry32(wt.fnv1a32('fsmp:Wind Field'));
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  // zone-sample ids
  assert.equal(gen.zoneId('fmsmp:Mini Lead', 48, 127), 'fmsmp:Mini Lead#48.127');
  assert.deepEqual(gen.parseZoneId('fmsmp:Mini Lead#48.127'), { multi: 'fmsmp:Mini Lead', root: 48, vel: 127 });
  assert.equal(gen.parseZoneId('fmsmp:Nope#48.127'), null);
  // primitives: deterministic Float32Arrays of the requested length
  const prim = [
    () => gen.glottal({ f0: 130.81, sec: 0.25, vibHz: 5.5, vibCt: 15 }), () => gen.karplus({ f0: 110, sec: 0.5, rng: wt.mulberry32(3) }),
    () => gen.imageSource({ dim: [4, 3, 2.5], alpha: 0.3, sec: 0.2 }), () => gen.velvetTail({ sec: 0.5, rng: wt.mulberry32(4), rt60: 0.4 }),
    () => gen.cabIR({ hp: 80, lp: 5200, peaks: [[110, 1.2, 4]] }), () => gen.spring({ sec: 1 }),
  ];
  const lens = [12000, 24000, 9600, 24000, 2048, 48000];
  prim.forEach((f, i) => {
    const x = f(), y = f();
    assert.ok(x instanceof Float32Array && x.length === lens[i] && x.every(Number.isFinite), 'primitive ' + i);
    assert.ok(same(x, y), 'deterministic ' + i);
    assert.ok(peak(x) > 0, 'not silent ' + i);
  });
  // the image source: direct sound first, at distance / c
  const im = gen.imageSource({ dim: [4, 3, 2.5], alpha: 0.3, sec: 0.2, order: 0 });
  const d = Math.hypot(0.3 * 4 - 0.6 * 4, 0.4 * 3 - 0.55 * 3, 0.1), first = im.findIndex(v => v !== 0);
  assert.ok(Math.abs(first - d / 343 * 48000) <= 1, 'direct path at ' + first);
  // Karplus-Strong pitch: the period of the string
  const ks = gen.karplus({ f0: 220, sec: 1, rng: wt.mulberry32(9) });
  assert.ok(Math.abs(smp.yinF0(Float64Array.from(ks), 48000, 12000, 36000) - 220) < 1, 'string pitch');
});

/* ------------------------------------------------------------------ procedural content (§10.2, §10.3) */
// expected IR lengths (s) where §10.3 states them (rooms: min(10, 1.25·RT60·max(1, high) + 0.05), IMPL)
const IR_SEC = { 'Massive/Canyon': 8, 'Massive/Endless Plate': 9, 'Coloration/Comb Shimmer': 0.4, 'Weird/Reverse Swell': 2.4, 'Weird/Gated Room': 0.25,
  'Weird/Pitched Comb C': 1.5, 'Weird/Shepard Tail': 4, 'Weird/Spring': 3, 'Weird/Granular Smear': 3, 'Coloration/Formant A': 0.15 };
// a looped factory sample / zone: every channel continues at the wrap (seam error over x[ls + j] − x[le + j], j = −16 …
// 15, ≤ −40 dB re the loop's RMS, and the step from x[le − 1] to x[ls] no larger than the largest step inside the loop),
// and the loop sustains (every 100 ms window within ±8 dB of the loop's RMS: no decay into silence and back; the
// models' own envelopes move by up to ≈ 6.5 dB inside the §10.1 region, CS-80 Brass)
function assertLoop(r, what, ls = r.loop.start, le = r.loop.end) {
  const rms = (x, a, n) => { let t = 0; for (let i = a; i < a + n; i++) t += x[i] * x[i]; return Math.sqrt(t / n); };
  for (const x of r.R ? [r.L, r.R] : [r.L]) {
    const ref = rms(x, ls, le - ls);
    let e = 0, mx = 0;
    for (let j = -16; j < 16; j++) e += (x[ls + j] - x[le + j]) ** 2;
    for (let k = ls + 1; k < le; k++) mx = Math.max(mx, Math.abs(x[k] - x[k - 1]));
    assert.ok(20 * Math.log10(Math.sqrt(e / 32) / ref) <= -40, what + ': seam ' + (20 * Math.log10(Math.sqrt(e / 32) / ref)).toFixed(1) + ' dB');
    assert.ok(Math.abs(x[ls] - x[le - 1]) <= mx + 1e-9, what + ': wrap step');
    const w = 4800;
    for (let p = ls; p + w <= le; p += w) {
      const d = 20 * Math.log10(rms(x, p, w) / ref);
      assert.ok(Math.abs(d) <= 8, what + ': loop level at ' + (p / 48000).toFixed(2) + ' s ' + d.toFixed(1) + ' dB re the loop');
    }
  }
}
test('§10.2–§10.3: every procedural sample and IR is deterministic, finite, peak ≤ 1, of its duration; IR RT60 within ±20 %', () => {
  const gens = [...gen.FACTORY_SAMPLES.filter(s => s.src === 'proc'), ...gen.FACTORY_IRS];
  assert.equal(gens.length, 12 + 29);
  for (const x of gens) {
    const a = gen.generate(x.id), b = gen.generate(x.id), what = x.id;
    assert.ok(a && a.factory === 1 && a.rate === 48000 && (a.ch === 1 || a.ch === 2), what);
    assert.ok(same(a.L, b.L) && (a.R === null ? b.R === null : same(a.R, b.R)), what + ': deterministic');
    assert.ok(a.L.length === a.len && (a.R === null || a.R.length === a.len) && a.ch === (a.R ? 2 : 1), what);
    assert.ok(a.L.every(Number.isFinite) && (!a.R || a.R.every(Number.isFinite)), what + ': finite');
    const pk = Math.max(peak(a.L), a.R ? peak(a.R) : 0);
    assert.ok(pk <= 1 && pk > 0.5 && Math.abs(a.peak - pk) < 1e-9, what + ': peak ' + pk);
    if (a.R) assert.ok(!same(a.L, a.R), what + ': stereo channels differ (identical ones are stored mono)');
    if (x.id.startsWith('fsmp:')) {
      assert.equal(a.kind, 'smp');
      assert.ok(Math.abs(a.len - x.seconds * 48000) <= 1, what + ': ' + a.len + ' samples');
      assert.ok(Math.abs(pk - Math.pow(10, -1 / 20)) < 1e-6, what + ': −1 dBFS');
      assert.equal(a.root, x.root);
      assert.equal(a.ch, x.stereo ? 2 : 1, what + ': channels');
      assert.equal(a.folder, '');
      // renders cleanly (M3): starts and ends at silence (no step when a one-shot starts or runs out), no DC — over the
      // whole sample ≤ −36 dB re its RMS, and in every 100 ms window that carries the sound (RMS ≥ 0.1 × the sample's)
      // ≤ −18 dB re the window's RMS (sub-audio drift: FM Drone's 0 Hz sidebands, Impact's rumble, GEN_VER 3)
      for (const c of a.R ? [a.L, a.R] : [a.L]) {
        assert.ok(Math.abs(c[0]) <= 0.01 * pk && Math.abs(c[c.length - 1]) <= 0.003 * pk, what + ': starts and ends at silence');
        let m = 0, q = 0;
        for (const v of c) { m += v; q += v * v; }
        const rms = Math.sqrt(q / c.length);
        assert.ok(Math.abs(m / c.length) <= rms * Math.pow(10, -36 / 20), what + ': DC ' + (20 * Math.log10(Math.abs(m / c.length) / rms)).toFixed(1) + ' dB re RMS');
        for (let w = 0; w + 4800 <= c.length; w += 2400) {
          let wm = 0, wq = 0;
          for (let i = w; i < w + 4800; i++) { wm += c[i]; wq += c[i] * c[i]; }
          const wr = Math.sqrt(wq / 4800);
          if (wr >= 0.1 * rms) assert.ok(Math.abs(wm / 4800) <= wr * Math.pow(10, -18 / 20), what + ': DC at ' + (w / 48000).toFixed(2) + ' s ' + (20 * Math.log10(Math.abs(wm / 4800) / wr)).toFixed(1) + ' dB re RMS');
        }
      }
    } else {
      assert.ok(a.kind === 'ir' && a.name === x.name && a.folder === x.folder && Math.abs(pk - 1) < 1e-6, what);
      const key = x.folder + '/' + x.name;
      const sec = IR_SEC[key] != null ? IR_SEC[key] : x.gen === 'room' ? Math.min(10, 1.25 * x.p.rt60 * Math.max(1, x.p.high == null ? 0.6 : x.p.high) + 0.05) : 2048 / 48000;
      assert.ok(Math.abs(a.len - sec * 48000) <= 1, what + ': ' + a.len + ' vs ' + sec * 48000);
      assert.equal(a.ch, x.p.mono || x.gen === 'eq' || x.gen === 'band' || x.gen === 'formant' || (x.gen === 'comb' && x.p.hz) ? 1 : 2, what + ': channels');
      assert.equal(a.ch, x.ch, what + ': FACTORY_IRS ch (host.smp.list) = the generated channels');
      const rt = x.gen === 'room' ? x.p.rt60 : x.gen === 'spring' ? x.p.rt60 : x.gen === 'velvet' ? x.p.sec : x.gen === 'echoes' ? x.p.tail : 0;
      if (rt) {
        const m = smp.irRT60(a.L, 48000, [500, 2000]);
        assert.ok(Math.abs(m / rt - 1) <= 0.2, what + ': RT60 ' + m.toFixed(3) + ' s vs ' + rt);
      }
    }
  }
  // Choir Ahh loops between upward zero crossings near 1 s and 3.5 s, its crossfade baked in: seamless at the wrap
  const ch = gen.generate('fsmp:Choir Ahh');
  assert.ok(Math.abs(ch.loop.start - 48000) <= 480 && Math.abs(ch.loop.end - 168000) <= 480 && ch.L[ch.loop.start - 1] < 0 && ch.L[ch.loop.start] >= 0);
  assertLoop(ch, 'Choir Ahh');
  // the cab IRs are minimum phase (energy in the first few ms) and band-limited by their design
  const cab = gen.generate('fir:Cab/4x12 Vintage');
  let e5 = 0, et = 0;
  for (let i = 0; i < cab.len; i++) { et += cab.L[i] * cab.L[i]; if (i < 240) e5 += cab.L[i] * cab.L[i]; }
  assert.ok(e5 / et > 0.9, 'cab energy in the first 5 ms: ' + e5 / et);
  // FM Drone's channels are detuned ±3 ct; Glass Bell decays
  const bell = gen.generate('fsmp:Glass Bell');
  assert.ok(peak(bell.L.subarray(0, 4800)) > 10 * peak(bell.L.subarray(-4800)));
});

/* ------------------------------------------------------------------ render plans and post-processing (§10.1) */
test('§10.1: render plans — one request per (root, velocity) zone; phrases and loops of the render-farm samples', () => {
  for (const m of gen.FACTORY_MULTI) {
    const p = gen.renderPlan(m.id);
    assert.deepEqual([p.id, p.kind, p.mix, p.loop, p.ch, p.notes.length], [m.id, 'multi', 'zones', m.loop, m.ch, m.roots.length * m.vels.length]);
    const g = Math.round(m.gate * 48000);
    for (const nt of p.notes) {
      assert.ok(m.roots.includes(nt.root) && m.vels.includes(nt.vel) && nt.model === m.model && nt.preset === m.preset);
      assert.equal(nt.rid, gen.zoneId(m.id, nt.root, nt.vel));
      assert.deepEqual(nt.events, [[0, 1, nt.root, nt.vel], [g, 0, nt.root, 0]]);
      assert.equal(nt.frames, Math.round((m.gate + m.tail) * 48000));
    }
  }
  const pp = gen.renderPlan('fsmp:Piano Phrase');
  assert.deepEqual([pp.kind, pp.mix, pp.frames, pp.notes.length, pp.notes[0].model, pp.notes[0].preset], ['sample', 'phrase', 192000, 1, 'dx7', 'Tine E.Piano']);
  assert.deepEqual(pp.notes[0].events.filter(e => e[1]).map(e => [e[0], e[2], e[3]]), [[0, 60, 90], [24000, 64, 90], [48000, 67, 90], [72000, 72, 90]]);
  assert.deepEqual(pp.notes[0].events.filter(e => !e[1]).map(e => e[0]), [21600, 45600, 69600, 93600], 'gates 0.45 s');
  const pc = gen.renderPlan('fsmp:Pad Chord');
  assert.deepEqual([pc.notes[0].events.length, pc.loopSec, pc.notes[0].events.filter(e => !e[1])[0][0]], [8, [2, 3.9], 192000], 'loop before the 4 s note-off');
  const dl = gen.renderPlan('fsmp:Drum Loop 120'), st = 6000; // a sixteenth at 120 BPM
  assert.deepEqual([dl.mix, dl.bpm, dl.frames, dl.notes.map(n => n.preset)], ['loop', 120, 192000, ['Punch Kick', 'Noise Snare', 'Tight Hat', 'Electro Clap']]);
  const on = (p, name) => p.notes.find(n => n.preset === name).events.filter(e => e[1]).map(e => [e[0] / st, e[3]]);
  assert.deepEqual(on(dl, 'Punch Kick').map(e => e[0]), [0, 4, 8, 10, 12, 16, 20, 24, 26, 28]);
  assert.deepEqual(on(dl, 'Noise Snare').map(e => e[0]), [4, 12, 20, 28]);
  assert.deepEqual(on(dl, 'Tight Hat').slice(0, 4), [[0, 70], [2, 100], [4, 70], [6, 100]]);
  assert.deepEqual(on(dl, 'Electro Clap').map(e => e[0]), [12, 28]);
  assert.ok(dl.notes.every(n => n.events.every(e => e[2] === 60) && n.frames === 192000 + 48000), 'hits at note 60; one extra second folded onto the start');
  assert.deepEqual(dl.marks.map(m => Math.round(m * 32)), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], 'marks at the steps that start a hit');
  const br = gen.renderPlan('fsmp:Break 96'), st96 = 60 / 96 / 4 * 48000;
  assert.deepEqual(on(br, 'Punch Kick').map(e => e[0] * st / st96), [0, 7, 10]);
  assert.deepEqual(on(br, 'Noise Snare').map(e => [e[0] * st / st96, e[1]]), [[4, 105], [12, 105], [15, 60]]);
  const hats = on(br, 'Tight Hat');
  assert.ok(hats.length === 16 && hats.every(e => e[1] >= 60 && e[1] <= 110) && new Set(hats.map(e => e[1])).size > 4, 'seeded hat velocities 60–110');
  assert.deepEqual(gen.renderPlan('fsmp:Break 96'), br, 'deterministic');
  const ar = gen.renderPlan('fsmp:Arp Loop 128');
  assert.deepEqual([ar.notes.length, ar.notes[0].preset, ar.notes[0].events.filter(e => e[1]).map(e => e[2]), ar.marks, ar.bpm], [1, 'Octave Runner', [57, 60, 64, 67], null, 128]);
});

// synthetic renders: a decaying sine per zone (L ≡ R unless `stereo`), `lead` silent samples first
const synth = (plan, { stereo = false, lead = 480, amp = vel => vel / 127 } = {}) => plan.notes.map(nt => {
  const n = nt.frames, f = 440 * Math.pow(2, (nt.root - 69) / 12), L = new Float32Array(n);
  for (let i = lead; i < n; i++) L[i] = 0.3 * amp(nt.vel) * Math.sin(2 * Math.PI * f * (i - lead) / 48000) * Math.exp(-(i - lead) / 96000);
  const R = stereo ? L.map((v, i) => (i % 3 ? v : 0.9 * v)) : L.slice();
  return { L, R };
});
test('§10.1: multiFromRenders — one gain (−1 dBFS), trimmed lead-in, mono when L ≡ R, sustain loops in the gate, zone map, vt = 1', () => {
  const plan = gen.renderPlan('fmsmp:Mini Lead'), renders = synth(plan);
  const res = gen.multiFromRenders(plan, renders), { rec, samples } = res;
  assert.deepEqual([rec.kind, rec.name, rec.factory, rec.zones.length, samples.length], ['multi', 'Mini Lead', 1, 18, 18]);
  const pk = Math.max(...samples.map(z => z.rec.peak));
  assert.ok(Math.abs(pk - Math.pow(10, -1 / 20)) < 1e-6, 'one instrument gain to −1 dBFS');
  const soft = samples.find(z => z.id === gen.zoneId(plan.id, 60, 80)).rec, loud = samples.find(z => z.id === gen.zoneId(plan.id, 60, 127)).rec;
  assert.ok(Math.abs(soft.peak / loud.peak - 80 / 127) < 0.01, 'velocity layers keep their relative level');
  const g = Math.round(1.5 * 48000);
  for (const [i, z] of rec.zones.entries()) {
    const s = samples[i].rec;
    assert.ok(s.ch === 1 && s.R === null && s.rate === 48000 && s.root === z.root && s.factory === 1, 'identical channels → mono');
    // the first sample at or above −70 dBFS is the lead's second one (481): 1 ms (48 samples) kept before it
    assert.equal(s.len, plan.notes[i].frames - 433, 'lead-in trimmed (1 ms kept)');
    assert.ok(z.mode === 'sustain' && z.ls >= Math.round(0.45 * g) - 433 && z.le <= Math.round(0.95 * g) - 433 && z.le > z.ls, 'loop inside the gate region');
    assert.deepEqual(s.loop, { start: z.ls, end: z.le });
    assert.ok(s.L[z.ls - 1] < 0 && s.L[z.ls] >= 0 && s.L[z.le - 1] < 0 && s.L[z.le] >= 0, 'loop ends at upward zero crossings');
    const P = 48000 / (440 * Math.pow(2, (z.root - 69) / 12));
    assert.ok(z.le - z.ls >= 0.25 * 48000 - P / 2 && Math.abs((z.le - z.ls) / P - Math.round((z.le - z.ls) / P)) < 0.05, 'loop: whole periods, ≥ 0.25 s');
    assert.deepEqual([z.vt, z.tune, z.gain, z.pan, z.off, z.env, z.rr], [1, 0, 0, 0, 0, null, [1, 1]]);
    assert.equal(z.smp, samples[i].id);
  }
  // the zone map: every (key, velocity) pair in exactly one zone; key splits at the root midpoints
  const hit = new Uint8Array(128 * 128);
  for (const z of rec.zones) for (let k = z.lo; k <= z.hi; k++) for (let v = z.vlo; v <= z.vhi; v++) hit[k * 128 + v]++;
  assert.ok(hit.every(h => h === 1), 'no gaps, no overlaps');
  assert.deepEqual(rec.zones.filter(z => z.vlo === 0).map(z => [z.root, z.lo, z.hi]),
    [[36, 0, 38], [42, 39, 44], [48, 45, 50], [54, 51, 56], [60, 57, 62], [66, 63, 68], [72, 69, 74], [78, 75, 80], [84, 81, 127]]);
  assert.deepEqual([...new Set(rec.zones.map(z => z.vlo + '-' + z.vhi))], ['0-103', '104-127'], 'velocity split at the midpoint 103.5');
  // GEN_VER 3: every zone ends with the END_FADE raised-cosine fade-out (here the renders still sound at their end: no
  // trailing trim); material below −60 dBFS after the last louder sample is cut END_FADE after it
  const F = Math.round(gen.END_FADE * 48000);
  for (const z of samples) {
    const x = z.rec.L, n = x.length;
    assert.ok(x[n - 1] === 0, 'ends at silence');
    assert.ok(Math.abs(x[n - 1 - F / 2]) <= 0.5 * 0.4 && x.subarray(n - F, n).every(Number.isFinite), 'faded');
  }
  const quiet = synth(plan).map(r => {
    const L = r.L.slice(), e = L.length - 24000;
    for (let i = e; i < L.length; i++) L[i] = 1e-5 * Math.sin(i);    // a noise-floor-like tail far below −60 dBFS
    return { L, R: L };
  });
  const qr = gen.multiFromRenders(plan, quiet);
  qr.samples.forEach((z, i) => assert.equal(z.rec.len, plan.notes[i].frames - 24000 - 433 + F, 'trailing trim keeps END_FADE'));
  // oneshot instruments: no loops; stereo renders stay stereo
  const op = gen.renderPlan('fmsmp:Acid Pluck'), o = gen.multiFromRenders(op, synth(op, { stereo: true }));
  assert.ok(o.rec.zones.every(z => z.mode === 'oneshot' && z.ls === 0 && z.le === o.samples.find(s => s.id === z.smp).rec.len));
  assert.ok(o.samples.every(s => s.rec.ch === 2 && s.rec.R instanceof Float32Array && s.rec.loop === null));
  assert.equal(gen.multiBytes(o), o.samples.reduce((a, s) => a + s.rec.len * 8, 0));
  // a precomputed loop (smpwork op 'loop' over the raw render) is used as given
  const withLoop = synth(plan).map(r => Object.assign(r, { loop: { ls: 40000, le: 60000 } }));
  assert.ok(gen.multiFromRenders(plan, withLoop).rec.zones.every(z => z.ls === 40000 - 433 && z.le === 60000 - 433));
  // §10.1 budget rule: an instrument expected mono that renders in stereo halves its velocity layers (2 → the loudest)
  assert.deepEqual(gen.keptVels(plan, synth(plan)), [80, 127]);
  const half = gen.multiFromRenders(plan, synth(plan, { stereo: true }));
  assert.deepEqual([half.rec.zones.length, [...new Set(half.rec.zones.map(z => z.vlo + '-' + z.vhi))]], [9, ['0-127']]);
  assert.ok(half.samples.every(s => s.id.endsWith('.127') && s.rec.ch === 2));
  assert.deepEqual(gen.keptVels({ ch: 'mo', vels: [20, 40, 60, 80, 100, 127] }, [{ L: [1, 0], R: [0, 1] }]), [20, 80, 127], '⌈n/2⌉ evenly spaced incl. the extremes');
  assert.deepEqual(gen.keptVels({ ch: 'st', vels: [64, 127] }, [{ L: [1, 0], R: [0, 1] }]), [64, 127], 'expected stereo: kept');
});

test('§10.1: sampleFromRenders — loops fold their tail onto the start, phrases are cut, −1 dBFS, marks and loop points', () => {
  const plan = gen.renderPlan('fsmp:Break 96'), n = plan.frames;
  const renders = plan.notes.map((nt, j) => {
    const L = new Float32Array(nt.frames);
    for (const [t, on] of nt.events) if (on) for (let i = 0; i < 2000; i++) L[t + i] += (j + 1) * 0.1 * Math.exp(-i / 300) * (i % 2 ? 1 : -1);
    L[n + 10] = 0.05; // the extra second: folded onto the start
    return { L, R: L };
  });
  const rec = gen.sampleFromRenders(plan, renders);
  assert.deepEqual([rec.kind, rec.name, rec.rate, rec.ch, rec.len, rec.root, rec.loop, rec.factory], ['smp', 'Break 96', 48000, 1, n, 60, { start: 0, end: n }, 1]);
  assert.ok(Math.abs(peak(rec.L) - Math.pow(10, -1 / 20)) < 1e-6);
  const g = rec.L[1] / renders.reduce((a, r) => a + r.L[1], 0);
  assert.ok(Math.abs(rec.L[10] - g * renders.reduce((a, r) => a + r.L[10] + r.L[n + 10], 0)) < 1e-6, 'tail folded onto the start');
  assert.deepEqual(rec.marks, plan.marks);
  const pc = gen.renderPlan('fsmp:Pad Chord');
  const tone = Float32Array.from({ length: pc.notes[0].frames + 1000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 130.81 * i / 48000));
  const pr = gen.sampleFromRenders(pc, [{ L: tone, R: tone.map(v => -v) }]);
  assert.deepEqual([pr.len, pr.ch, pr.marks], [6 * 48000, 2, null], 'phrase cut at its length');
  assert.ok(Math.abs(pr.loop.start - 96000) < 480 && Math.abs(pr.loop.end - 187200) < 480, 'loop 2–3.9 s (snapped to upward zero crossings of the mono sum when there are any)');
  for (const x of [pr.L, pr.R]) assert.ok(x[pr.loop.end - 1] === x[pr.loop.start - 1] && x[pr.loop.end] === x[pr.loop.start], 'crossfade baked: the wrap continues exactly');
});

/* ------------------------------------------------------------------ render farm (§10.1) */
function farm() {
  const posted = [], logs = [];
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  const keep = (...a) => logs.push(a.map(String).join(' '));
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn: keep, error: keep }, location: { search: V } });
  g.self = g;
  g.importScripts = (...urls) => {
    for (const u of urls) {
      assert.ok(u.endsWith(V), 'script URL carries the worker\'s query: ' + u);
      const f = u.slice(0, -V.length);
      vm.runInContext(read(f), g, { filename: 'farm/' + f });
    }
  };
  g.postMessage = (m, t) => posted.push([m, t]);
  vm.runInContext(read('smprender.js'), g, { filename: 'smprender.js' });
  return { g, posted, logs, F: g.__smprender };
}
const valsOf = (model, preset) => {
  const m = models.MODELS.find(x => x.id === model), v = {};
  for (const c of m.controls) v[c.id] = c.def;
  return Object.assign(v, JSON.parse(JSON.stringify(m.presets.find(p => p.name === preset).v)));
};
const patchOf = (model, preset) => models.patchFor(model, valsOf(model, preset), null, { sr: 48000, bpm: 120, drift: 0, hiss: 0 });
const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

test('§10.1: the render farm loads the §0.3 list (= main.js DSP_FILES) then engine.js; PRNG copies equal wt.js', () => {
  const { F, logs } = farm();
  const m = /const DSP_FILES = \[([^\]]*)\]/.exec(MAIN);
  assert.deepEqual(Array.from(F.DSP), m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
  assert.deepEqual(Array.from(F.DSP), Array.from(DSP_FILES));
  assert.equal(F.ready(), true);
  assert.deepEqual(logs, []);
  // the embedded fnv1a32 / mulberry32 are wt.js's code (only indentation and `export` differ)
  const body = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    let d = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
    return src.slice(i, j + 1).split('\n').map(l => l.trim()).join('\n');
  };
  for (const fn of ['fnv1a32', 'mulberry32']) assert.equal(body(read('smprender.js'), fn), body(read('wt.js'), fn), fn);
});

test('§10.1: renders are deterministic (Solina included), stop after 2048 frames below −80 dBFS, reply transfers', () => {
  const { F, g, posted } = farm();
  const req = (id, model, preset, gate, frames, extra) => Object.assign({ q: id, id, patch: patchOf(model, preset), events: [[0, 1, 60, 100], [Math.round(gate * 48000), 0, 60, 0]], frames: Math.round(frames * 48000), os: 2 }, extra);
  // a sustained pad: renders the gate and the release, then stops once silent
  const a = F.render(req('fmsmp:Solina Strings/60/100', 'solina', 'Full Strings', 0.5, 6));
  const b = F.render(req('fmsmp:Solina Strings/60/100', 'solina', 'Full Strings', 0.5, 6));
  assert.ok(peak(a.L) > 0.01 && a.L.every(Number.isFinite) && a.R.every(Number.isFinite), 'audible, finite');
  assert.ok(same(a.L, b.L) && same(a.R, b.R), 'same id → bit-identical (seeded Math.random: Solina divider phases)');
  assert.ok(a.L.length < 6 * 48000 && a.L.length > 0.5 * 48000, 'stopped early: ' + a.L.length);
  const tail = (x, n) => peak(x.subarray(x.length - n));
  assert.ok(tail(a.L, 2048) < 1e-4 && tail(a.R, 2048) < 1e-4, 'the last 2048 frames are below −80 dBFS');
  const c = F.render(req('fmsmp:Solina Strings/60/100#other', 'solina', 'Full Strings', 0.5, 6));
  assert.ok(!same(a.L.subarray(0, 4800), c.L.subarray(0, 4800)), 'another render id draws other divider phases');
  // `frames` caps the render (no early stop while notes sound)
  const d = F.render(req('cap', 'juno60', 'Juno Pad', 2, 1));
  assert.equal(d.L.length, 48000);
  // a frame count that is not a multiple of 128
  assert.equal(F.render(req('odd', 'dx7', 'Tine E.Piano', 0.1, 0.01)).L.length, 480);
  // the worker protocol: {q, ok, L, R} with both buffers transferred; errors → {ok: false, err}
  g.onmessage({ data: req(7, 'dx7', 'Glass Marimba', 0.2, 2) });
  const [m, t] = posted.pop();
  assert.deepEqual([m.q, m.ok, t.length, t[0] === m.L.buffer, t[1] === m.R.buffer], [7, true, 2, true, true]);
  assert.ok(peak(m.L) > 0.001);
  g.onmessage({ data: { q: 8, id: 'bad', patch: { engine: 'nope' }, events: 'x', frames: 256 } });
  const [m2] = posted.pop();
  assert.equal(m2.q, 8);
  assert.ok(m2.ok === true || (m2.ok === false && typeof m2.err === 'string'), 'never throws out of onmessage');
});

test('§10.1: a Serum render takes its wavetables from the request and leaves none behind (self-contained)', () => {
  const { F, g } = farm();
  F.ready();
  const p = core.FACTORY_PRESETS_V1.find(x => x.name === 'Octave Runner') || core.FACTORY_PRESETS_V1[0];
  const sx = models.MODELS.find(m => m.id === 'serum');
  const vals = { s: core.normalizeSerum(JSON.parse(JSON.stringify(p.v.s))) };
  const patch = models.patchFor(sx, vals, core.normalizeFx(JSON.parse(JSON.stringify(p.fx || core.defaultFx())), vals.s), { sr: 48000, bpm: 128 });
  const entryOf = id => { if (id.startsWith('noise:')) return wt.makeNoise(id); const t = wt.factoryTable(id); return t ? wt.makeEntry(id, t) : null; };
  const wts = (patch.needs || []).map(entryOf).filter(Boolean);
  assert.ok(wts.length >= 1, 'the preset needs wavetables');
  const ev = [[0, 1, 57, 100], [6000, 0, 57, 0], [6000, 1, 60, 100], [12000, 0, 60, 0]];
  const a = F.render({ id: 'fsmp:Arp Loop 128', patch, wts, events: ev, frames: 48000 });
  assert.ok(peak(a.L) > 0.001, 'audible with its tables');
  assert.equal(g.SerumDSP.tables.size, 0, 'tables dropped after the render');
  const b = F.render({ id: 'fsmp:Arp Loop 128', patch, wts: [], events: ev, frames: 48000 });
  assert.ok(peak(b.L) < peak(a.L), 'without its tables the oscillators are silent (nothing left from the previous request)');
  const c = F.render({ id: 'fsmp:Arp Loop 128', patch, wts: (patch.needs || []).map(entryOf).filter(Boolean), events: ev, frames: 48000 });
  assert.ok(same(a.L, c.L) && same(a.R, c.R), 'deterministic');
});

test('§10.1: events start at their own frame (rounded up to 4), not at the next 128-frame quantum; the step grid of the loops is kept', () => {
  const { F } = farm();
  const patch = patchOf('dx7', 'Glass Marimba');
  const onset = x => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-3) return i; return -1; };
  const at = f => onset(F.render({ id: 'timing', patch, events: [[f, 1, 72, 110], [f + 4800, 0, 72, 0]], frames: 9600 }).L);
  const o0 = at(0);
  for (const f of [1000, 1003, 6000, 7500, 3750]) {
    const d = at(f) - o0;
    assert.ok(d >= f && d <= f + 3, 'event at ' + f + ': sounds from ' + d);
  }
  // Drum Loop / Break steps (6000 / 7500 frames) are multiples of 4: hits land exactly on the grid
  for (const id of ['fsmp:Drum Loop 120', 'fsmp:Break 96']) {
    const p = gen.renderPlan(id);
    assert.ok(p.notes.every(n => n.events.filter(e => e[1]).every(e => e[0] % 4 === 0)), id);
  }
});

/* ------------------------------------------------------------------ the whole factory set through the render farm */
const entryOf = id => { if (id.startsWith('noise:')) return wt.makeNoise(id); const t = wt.factoryTable(id); return t ? wt.makeEntry(id, t) : null; };
// the asset manager's render-farm path (assets.js generateFactory: farmPatch per preset, its wavetables as `wts`, one
// request per plan note, then smpgen's post-processing) on a farm scope
function farmBuild(F, id) {
  const plan = gen.renderPlan(id), patches = new Map(), renders = [];
  for (const nt of plan.notes) {
    const key = nt.model + '/' + nt.preset;
    if (!patches.has(key)) patches.set(key, A.farmPatch(nt.model, nt.preset, plan.bpm));
    const { patch, wtIds } = patches.get(key);
    const r = F.render({ id: nt.rid, patch, wts: wtIds.map(entryOf).filter(Boolean), smps: null, events: nt.events, frames: nt.frames, os: 2 });
    renders.push({ L: r.L, R: r.R });
  }
  return { plan, renders, res: plan.kind === 'multi' ? gen.multiFromRenders(plan, renders) : gen.sampleFromRenders(plan, renders) };
}
const hashMulti = res => res.samples.map(z => z.id + ':' + smp.assetHash(z.rec.L, z.rec.R)).join('|') + JSON.stringify(res.rec.zones);

test('§10.1: every FACTORY_MULTI instrument renders deterministically (two farms), ≤ 16 MB each and ≤ 150 MB in total; zone map, loops, vt', () => {
  const SB = (() => { const S = dspScope({ files: ['sx-base.js'] }); return S.global('SxBase'); })();
  const runs = [farm(), farm()];
  let total = 0;
  for (const m of gen.FACTORY_MULTI) {
    const [a, b] = runs.map(r => farmBuild(r.F, m.id));
    assert.equal(hashMulti(a.res), hashMulti(b.res), m.name + ': bit-identical between runs (seeded Math.random)');
    const { rec, samples } = a.res, bytes = gen.multiBytes(a.res);
    total += bytes;
    assert.ok(bytes <= gen.MULTI_BUDGET.instrument, m.name + ': ' + (bytes / 1e6).toFixed(2) + ' MB');
    const worst = m.roots.length * m.vels.length * Math.round((m.gate + m.tail) * 48000) * (m.ch === 'st' ? 2 : 1) * 4;
    assert.ok(bytes <= worst, m.name + ': within the table\'s worst case for its expected channels');
    assert.deepEqual([rec.kind, rec.name, rec.factory, rec.zones.length], ['multi', m.name, 1, m.roots.length * gen.keptVels(a.plan, a.renders).length]);
    const hit = new Uint8Array(128 * 128), g = Math.round(m.gate * 48000);
    // the instrument gain and each zone's lead-in trim (−70 dBFS after the gain, 1 ms kept): zone frame k = raw k + off
    const kept = gen.keptVels(a.plan, a.renders), use = a.plan.notes.map(nt => kept.includes(nt.vel));
    const gain = Math.pow(10, -1 / 20) / Math.max(...a.renders.filter((r, j) => use[j]).map(r => Math.max(peak(r.L), r.R ? peak(r.R) : 0)));
    const leadOf = r => { let k = 0; while (k < r.L.length && Math.abs(r.L[k] * gain) < Math.pow(10, -70 / 20) && !(r.R && Math.abs(r.R[k] * gain) >= Math.pow(10, -70 / 20))) k++; return Math.max(0, Math.min(k, r.L.length - 1) - 48); };
    rec.zones.forEach((z, i) => {
      for (let k = z.lo; k <= z.hi; k++) for (let v = z.vlo; v <= z.vhi; v++) hit[k * 128 + v]++;
      const s = samples[i].rec, rr = a.renders[a.plan.notes.findIndex(nt => gen.zoneId(m.id, nt.root, nt.vel) === z.smp)], off = leadOf(rr);
      assert.ok(z.vt === 1 && z.smp === samples[i].id && s.rate === 48000 && s.root === z.root, m.name + ' zone ' + i);
      assert.ok(s.L.every(Number.isFinite) && (!s.R || s.R.every(Number.isFinite)) && s.peak <= Math.pow(10, -1 / 20) + 1e-6 && s.peak > 1e-3, m.name + ' zone ' + i + ': finite, audible, ≤ −1 dBFS');
      // M3 (GEN_VER 3): every zone ends silent (the END_FADE fade-out), its trailing material below −60 dBFS cut, and
      // carries no DC (≤ −30 dB re its RMS; the engine's output DC block runs in the farm as in a bounce)
      let last = s.len - 1;
      while (last > 0 && Math.abs(s.L[last]) < Math.pow(10, -60 / 20) && !(s.R && Math.abs(s.R[last]) >= Math.pow(10, -60 / 20))) last--;
      if (s.len + off < rr.L.length) assert.ok(s.len - 1 - last <= Math.round(gen.END_FADE * 48000), m.name + ' zone ' + i + ': trailing trim');
      for (const c of s.R ? [s.L, s.R] : [s.L]) {
        assert.ok(c[c.length - 1] === 0, m.name + ' zone ' + i + ': ends at silence');
        let mm = 0, q = 0;
        for (const v of c) { mm += v; q += v * v; }
        assert.ok(Math.abs(mm / c.length) <= Math.sqrt(q / c.length) * Math.pow(10, -30 / 20), m.name + ' zone ' + i + ': DC');
      }
      if (m.loop === 'sustain') {
        assert.equal(z.mode, 'sustain', m.name + ' zone ' + i + ': a sustain loop was found');
        assert.ok(z.ls + off >= Math.round(0.45 * g) && z.le + off <= Math.round(0.95 * g) && z.le - z.ls >= 0.2 * 48000, m.name + ' zone ' + i + ': loop inside the gate region');
        assertLoop(s, m.name + ' zone ' + i + (s.R ? ' (stereo)' : ''), z.ls, z.le); // each channel, not only the mono sum
      } else assert.ok(z.mode === 'oneshot' && s.loop === null);
    });
    assert.ok(hit.every(h => h === 1), m.name + ': every key and velocity in exactly one zone');
    // zone sample entries validate (levels up to the zone's upward transposition, §9.4.3)
    const z0 = rec.zones[rec.zones.length - 1], up = z0.hi - z0.root + 12, lv = Math.ceil(Math.log2(Math.pow(2, up / 12) * 48000 / 44100)) + 1;
    const e = work.playbackEntry(z0.smp, samples[samples.length - 1].rec, null, lv);
    assert.ok(SB.storeAsset(e.id, e) && e.levels.length === Math.min(lv, e.levels.length), m.name + ': zone entry');
    SB.dropAsset(e.id);
  }
  assert.ok(total <= gen.MULTI_BUDGET.total, 'FACTORY_MULTI total ' + (total / 1e6).toFixed(1) + ' MB');
  for (const r of runs) assert.deepEqual(r.logs, [], 'no warnings from the farm scope');
});

test('§10.2: the render-farm samples are deterministic, of their length, −1 dBFS, with their loops and slice marks', () => {
  const F1 = farm().F, F2 = farm().F;
  for (const s of gen.FACTORY_SAMPLES.filter(x => x.src === 'farm')) {
    const a = farmBuild(F1, s.id).res, b = farmBuild(F2, s.id).res;
    assert.ok(same(a.L, b.L) && (a.R ? same(a.R, b.R) : b.R === null), s.name + ': deterministic');
    assert.ok(a.kind === 'smp' && a.factory === 1 && a.rate === 48000 && a.root === s.root && a.name === s.name, s.name);
    assert.ok(Math.abs(a.len - s.seconds * 48000) <= 1, s.name + ': ' + a.len);
    assert.ok(a.L.every(Number.isFinite) && (!a.R || a.R.every(Number.isFinite)), s.name + ': finite');
    assert.ok(Math.abs(a.peak - Math.pow(10, -1 / 20)) < 1e-6, s.name + ': −1 dBFS');
    assert.equal(a.ch, s.stereo ? 2 : 1, s.name + ': channels as the catalogue (host.smp.list) states');
    if (s.cat === 'Loops') assert.deepEqual(a.loop, { start: 0, end: a.len }, s.name + ': loops whole');
    if (s.name === 'Pad Chord') {
      assert.ok(Math.abs(a.loop.start - 96000) < 480 && Math.abs(a.loop.end - 187200) < 480, 'loop 2–3.9 s: inside the chord\'s 4 s gate');
      assertLoop(a, s.name);
    }
    if (s.name === 'Drum Loop 120' || s.name === 'Break 96') {
      assert.ok(a.marks.length >= 8 && a.marks.every((m, i) => m > 0 && m < 1 && (i === 0 || m > a.marks[i - 1])), s.name + ': marks');
      // every marked step starts a hit: more energy in the 20 ms after the mark than in the 20 ms before
      const M = x => 0.5 * (a.L[x] + (a.R ? a.R[x] : a.L[x])), en = (p, q) => { let t = 0; for (let i = Math.max(0, p); i < q; i++) t += M(i) * M(i); return t; };
      const hits = a.marks.filter(m => { const p = Math.round(m * a.len); return en(p, p + 960) > en(p - 960, p); }).length;
      assert.ok(hits >= 0.75 * a.marks.length, s.name + ': ' + hits + ' of ' + a.marks.length + ' marks start a hit');
    } else assert.equal(a.marks, null);
  }
});

// a function's source from main.js (brace matching; buildPatch has no braces in strings)
function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'main.js defines ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(i, j + 1);
}
test('§10.1: patchFor — main.js buildPatch adds only live-session fields; farmPatch = patchFor(drift 0, hiss 0, default rack)', () => {
  const make = new Function('modelById', 'fxOf', 'ctx', 'project', 'settings', 'sxUni', 'prefs', 'seedPend', 'sxCap', 'core', 'patchFor', 'CG', 'CM', fnSource(MAIN, 'buildPatch') + '\nreturn buildPatch;');
  const prefs = { smooth: 1, silenceTails: 1 };
  const buildPatch = make(id => models.MODELS.find(m => m.id === id), t => t.fx, null, { bpm: 97 }, { drift: 0 }, 16, prefs, new Set(), 8, core, models.patchFor, CG, CM);
  for (const m of models.MODELS) {
    const p = m.presets[Math.min(1, m.presets.length - 1)];
    const vals = m.custom ? JSON.parse(JSON.stringify(p.v)) : valsOf(m.id, p.name), fx = m.custom && p.fx ? JSON.parse(JSON.stringify(p.fx)) : core.defaultFx();
    const tr = { id: 't1', model: m.id, vals, fx };
    const live = buildPatch(tr, 44100, true);
    assert.ok('osCap' in live === !!m.custom, m.id + ': osCap only for Serum');
    delete live.osCap;
    const pure = models.patchFor(m.id, vals, fx, { sr: 44100, bpm: 97, drift: 0, hiss: 1, qr: null, prefs, seed: false });
    assert.deepEqual(live, pure, m.id + ': buildPatch = patchFor + live-session fields');
    // the same track in its v2 form (stage 1c: cv-model adopt, the canonical compile) builds the same patch
    const t2 = CMOD.adopt({ tracks: [{ id: 't1', model: m.id, vals: JSON.parse(JSON.stringify(vals)), fx: JSON.parse(JSON.stringify(fx)) }] }).tracks[0];
    assert.equal(CMOD.isAdopted(t2) && CG.compileTrack(t2).canonical, true, m.id + ': v2, canonical');
    const live2 = buildPatch(t2, 44100, true);
    delete live2.osCap;
    assert.deepEqual(live2, pure, m.id + ': the v2 track compiles to the same patch');
    if (!m.custom) {
      const f = A.farmPatch(m.id, p.name, 97);
      assert.deepEqual(f.patch, models.patchFor(m.id, valsOf(m.id, p.name), null, { sr: 48000, bpm: 97, drift: 0, hiss: 0 }), m.id + ': farm patch');
      assert.deepEqual(f.wtIds, []);
    }
  }
  const sx = A.farmPatch('serum', 'Punch Kick', 120);
  assert.ok(sx.patch.engine === 'serum' && sx.wtIds.length >= 1 && sx.wtIds.every(id => /^(factory|noise|sub):/.test(id)), 'Serum: the migrated preset with its tables');
  const pk = models.MODELS.find(m => m.id === 'serum').presets.find(p => p.name === 'Punch Kick');
  assert.deepEqual(sx.patch, models.patchFor('serum', JSON.parse(JSON.stringify(pk.v)), null, { sr: 48000, bpm: 120, drift: 0, hiss: 0 }), 'Serum: the default rack too (§10.1 FX defaultFx())');
  assert.throws(() => A.farmPatch('dx7', 'Nope', 120), /unknown preset/);
});
