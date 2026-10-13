// Golden shard 1 (owner I; SPEC-serum2 §15.1 items 1, 5, 6, 7): Serum v1 factory presets, table entries, filterImpulse,
// migration, a Phase-1 project file and the timing rows a–c of §14.1 — (A) tests/ref-p1 vs (B) the current code.
// A merge gate from M1a on. GOLDEN_FULL=1: every preset at OS 1, 2 and 4 and every setS1 round trip rendered.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as H from './golden-harness.mjs';

const [A, B] = await H.sides();
const S = await import(new URL('song.js' + H.SUFFIX, H.ROOT).href); // the project format (song.js, not part of the freeze)
const TOL = 1e-6;
// FACTORY_PRESETS_V1: the 48 Phase-1 presets, read from the frozen serum-core (v2 may append S2 presets, §10.11)
const PRESETS = A.core.FACTORY_PRESETS;
const OSES = H.FULL ? [1, 2, 4] : [2];
const RENAME1 = { 'fx.dim.size': 'fx.hyper.dsize', 'fx.dim.mix': 'fx.hyper.dmix', 'fx.dim.level': 'fx.hyper.dlevel' };

// a preset as a Phase-1 track holds it (main.js sxLoad from Init), at oversampling `os`
function presetV1(pr, os) {
  const s = A.core.applyPreset(A.core.defaultSerum(), pr);
  s.global.os = os;
  return { s, fx: A.core.applyPresetFx(A.core.defaultFx(), pr.fx, []) };
}
const renderV1 = (X, id, v1, os, events, conv = H.fxState) => {
  const s = H.serumState(X, v1.s);
  return H.renderTrack(X, { id, model: 'serum', vals: { s }, fx: conv(X, v1.fx, s), os, events });
};
// presets whose matrix modulates FX parameters: also rendered with the §2.6.3 migrated rack (its instances kept by the
// rows as refs, the rows compiled against the v2 layout) — what a project load or the first rack edit produces
const fxRows = pr => (pr.v.s.matrix || []).some(m => m && /^fx\./.test(m.dst));
// first difference between two structured values whose typed arrays must match bit for bit ('' when equal)
function bitDiff(a, b, path = '') {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor.name !== b.constructor.name || a.length !== b.length) return path + ': type/length';
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${path}[${Math.floor(i / a.BYTES_PER_ELEMENT)}]: ${a[Math.floor(i / a.BYTES_PER_ELEMENT)]} vs ${b[Math.floor(i / b.BYTES_PER_ELEMENT)]}`;
    return '';
  }
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) return bitDiff(new Uint8Array(a), new Uint8Array(b), path);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return path + ': keys ' + ka.join(',') + ' vs ' + kb.join(',');
    for (const k of ka) { const d = bitDiff(a[k], b[k], path + '.' + k); if (d) return d; }
    return '';
  }
  return Object.is(a, b) ? '' : `${path}: ${a} vs ${b}`;
}

/* ------------------------------------------------------------------ the freeze */
test('tests/ref-p1 holds the frozen Phase-1 code (tag serum-p1, MANIFEST.json hashes)', () => {
  const m = H.refManifest();
  assert.equal(m.tag, 'serum-p1');
  assert.deepEqual(Object.keys(m.files).sort(), [...H.REF_FILES].sort());
  for (const f of H.REF_FILES) assert.equal(H.sha256(H.refSource(f)), m.files[f].sha256, 'tests/ref-p1/' + f + ' was edited');
  for (const f of Object.keys(m.data)) assert.equal(H.sha256(H.refSource(f)), m.data[f].sha256, 'tests/ref-p1/' + f + ' was edited');
  assert.doesNotMatch(H.refSource('models.js'), /\?v=/, 'ref-p1 imports its siblings without the suffix');
  assert.equal(PRESETS.length, 48, 'FACTORY_PRESETS_V1.length');
  if (B.core.FACTORY_PRESETS_V1) assert.deepEqual(B.core.FACTORY_PRESETS_V1.map(p => p.name), PRESETS.map(p => p.name));
  assert.ok(A.dsp.length === 2 && B.dsp.some(([f]) => f === 'serum-dsp.js') && B.dsp.some(([f]) => f === 'fx-dsp.js'));
});

/* ------------------------------------------------------------------ item 1: factory presets */
for (const os of OSES) {
  test(`Serum v1 factory presets (${PRESETS.length}) at OS ${os}: (A) vs (B) with the migrated state (and, for FX-row presets, the migrated rack), max |A − B| ≤ 1e-6`, () => {
    const bad = [];
    let migrated = 0;
    for (const pr of PRESETS) {
      const v1 = presetV1(pr, os), id = `preset:${pr.name}:${os}`;
      const a = renderV1(A, id, v1, os), b = renderV1(B, id, v1, os);
      if (!H.finite(a) || !(H.peak(a) > 1e-3)) bad.push(`${pr.name}: reference render silent or not finite`);
      const d = H.compare(a, b);
      if (!(d.max <= TOL)) bad.push(`${pr.name}: ${H.describe(d)}`);
      if (fxRows(pr)) {
        migrated++;
        const m = H.compare(a, renderV1(B, id, v1, os, undefined, H.fxMigrated));
        if (!(m.max <= TOL)) bad.push(`${pr.name}, migrated rack: ${H.describe(m)}`);
      }
    }
    assert.ok(migrated >= 8, 'presets with FX rows rendered with the migrated rack too: ' + migrated);
    assert.deepEqual(bad, []);
  });
}

test('wavetable, noise and sub entries of every Phase-1 table id are bit-identical between (A) and (B)', () => {
  const ids = [...A.wt.FACTORY_TABLES.map(t => t.id), ...A.wt.SUB_TABLES, ...A.wt.NOISES.map(n => n.id)];
  assert.equal(ids.length, 27 + 5 + 41);
  const bad = [];
  for (const id of ids) {
    const a = H.entry(A, id), b = H.entry(B, id);
    if (!a) { bad.push(id + ': no Phase-1 entry'); continue; }
    const d = bitDiff(a, b, id);
    if (d) bad.push(d);
  }
  assert.deepEqual(bad, []);
});

test('filterImpulse(t, …) for every type 0–95 at 3 cutoff/res settings is bit-identical between (A) and (B)', () => {
  const SA = H.scope(A).g.SerumDSP, SB = H.scope(B).g.SerumDSP;
  const settings = [[180, 0.1, 0, 0, 96000], [1800, 0.6, 0.3, 0.5, 48000], [9000, 0.97, 0.8, 1, 48000]];
  const bad = [];
  for (let t = 0; t < 96; t++) {
    for (const [fc, res, drive, vr, fs] of settings) {
      const d = bitDiff(SA.filterImpulse(t, fc, res, drive, vr, fs, 2048), SB.filterImpulse(t, fc, res, drive, vr, fs, 2048), `type ${t} @${fc}`);
      if (d) bad.push(d);
    }
  }
  assert.deepEqual(bad, []);
});

/* ------------------------------------------------------------------ item 5: migration (needs C1's M1a API) */
const HAS_MIGRATE = typeof B.core.migrate1 === 'function', HAS_S1 = typeof B.core.setS1 === 'function';
const migrationStates = () => [
  ...PRESETS.map(pr => ({ name: pr.name, v1: presetV1(pr, 2) })),
  ...Array.from({ length: 8 }, (_, i) => ({ name: 'random ' + i, v1: { s: H.randomSerumV1(A.core, A.wt, 0xA11CE + i, 2), fx: H.randomFxV1(A.core, 0xF00D + i) } })),
];
test('migration is lossless: normalizeSerum(migrate1(v1)) is stable and keeps every v1 row (RENAME1)', { skip: !HAS_MIGRATE && 'pending M1a (C1): serum-core has no migrate1 yet' }, () => {
  const ren = B.core.RENAME1 || RENAME1;
  for (const { name, v1 } of migrationStates()) {
    const m = B.core.normalizeSerum(B.core.migrate1(H.clone(v1.s)));
    assert.deepEqual(B.core.normalizeSerum(H.clone(m)), m, name + ': re-normalised is stable');
    assert.deepEqual(B.core.normalizeSerum(H.clone(v1.s)), m, name + ': normalizeSerum(v1) = normalizeSerum(migrate1(v1))');
    v1.s.matrix.forEach((r, k) => {
      const q = m.matrix[k];
      for (const f of ['src', 'amt', 'bi', 'curve', 'aux', 'inv', 'byp', 'out']) assert.equal(q[f], r[f], `${name}: row ${k} ${f}`);
      assert.equal(q.dst, ren[r.dst] || r.dst, `${name}: row ${k} dst`);
    });
  }
});

test('setS1(s, 0) then setS1(·, 1) returns s and renders bit-identically; S2 rendition within −60 dB (informative)', { skip: !(HAS_MIGRATE && HAS_S1) && 'pending M1a (C1): serum-core has no setS1 yet' }, (t) => {
  const states = migrationStates(), step = H.FULL ? 1 : 6;
  for (let i = 0; i < states.length; i++) {
    const { name, v1 } = states[i];
    const s = H.serumState(B, v1.s), off = B.core.setS1(s, 0), back = B.core.setS1(off, 1);
    assert.deepEqual(back, s, name + ': round trip');
    if (i % step) continue;
    const fx = H.fxState(B, v1.fx, s), id = 'setS1:' + name;
    const r = vals => H.renderTrack(B, { id, model: 'serum', vals: { s: vals }, fx, os: 2 });
    const ref = r(s), d = H.compare(ref, r(back));
    assert.equal(d.max, 0, name + ': round trip renders bit-identically (' + H.describe(d) + ')');
    const w2 = ['a.warpMode', 'b.warpMode'].some(k => Math.round(22 * v1.s.p[k]) === 2);
    if (!w2) t.diagnostic(`${name}: S2 rendition ${(H.dB(H.compare(ref, r(off)).max / Math.max(1e-9, H.peak(ref)))).toFixed(1)} dB from the S1 one`);
  }
});

/* ------------------------------------------------------------------ item 6: a Phase-1 project file */
// main.js loadProject (§12.6): song.js deserialize + the side's normalizeSerum and FX normalisation — v2: §2.6.3 (a v1
// rack migrated with the track's Serum state as refs, H.fxMigrated; a v2 rack normalised); Phase 1: normalizeFx
function loadProject(X, json) {
  const p = S.deserialize(json), o = typeof json === 'string' ? JSON.parse(json) : json;
  const byId = new Map((o.tracks || []).map(t => [t && t.id, t]));
  for (const t of p.tracks) {
    const r = byId.get(t.id);
    if (r && r.seq && Array.isArray(r.seq.pat)) t.seq = r.seq;
    const s = t.model === 'serum' ? X.core.normalizeSerum(t.vals && t.vals.s) : null;
    t.fx = r && H.isObj(r.fx) ? (r.fx.v >= 2 ? H.fxState(X, r.fx, s) : H.fxMigrated(X, r.fx, s)) : X.fxm.defaultFx();
    if (s) t.vals = { s };
  }
  return p;
}
// main.js bounce() of one track: everything through processorOptions, transport from tick 0, offline
function bounceTrack(X, p, tr, secs) {
  const sr = H.SR, fpt = sr * 60 / (p.bpm * H.PPQ), sx = tr.model === 'serum';
  const patch = H.trackPatch(X, tr.model, tr.vals, tr.fx, { sr, bpm: p.bpm });
  const synced = tr.model === 'tb303' && tr.seq && tr.seq.sync;
  const notes = [], cc = [], CCK = { bend: 0, wheel: 1, sus: 2, at: 3 };
  for (const n of tr.notes) notes.push(n.t, n.d, n.n, n.v);
  for (const c of tr.cc) cc.push(c.t, CCK[c.k] ?? 1, c.v);
  const seq = synced ? { pat: tr.seq.pat, len: 16, bpm: tr.seq.bpm, swing: tr.seq.swing / 100 * 0.5, root: 48, sync: true, run: false } : null;
  return H.render(H.scope(X, sr), {
    id: 'project:' + tr.id, seconds: secs,
    po: { os: sx ? tr.vals.s.global.os : 4, hostOS: 4, offline: true, patch, wts: (patch.needs || []).map(id => H.entry(X, id)).filter(Boolean),
      song: { notes, cc }, transport: { play: true, frame: 0, tick: 0, fpt, loop: false }, seq },
  });
}
const stripIds = p => JSON.parse(JSON.stringify(p, (k, v) => (k === 'id' && typeof v === 'number' ? undefined : v))); // note ids are per session

test('a Phase-1 project file loads, plays, saves as v2 and reloads identically', () => {
  const file = readFileSync(new URL('project-p1.json', H.REF), 'utf8'), o = JSON.parse(file);
  assert.ok(o.wts && Object.keys(o.wts).length === 1 && new Set(o.tracks.map(t => t.id)).size === 7, 'fixture: 7 tracks, one embedded user table');
  for (const X of [A, B]) H.restoreTables(X, o.wts);
  const pa = loadProject(A, file), pb = loadProject(B, file), secs = 4.5, first = new Map();
  for (const tr of pb.tracks) {
    const ta = pa.tracks.find(x => x.id === tr.id), a = bounceTrack(A, pa, ta, secs), b = bounceTrack(B, pb, tr, secs);
    assert.ok(H.finite(a) && H.peak(a) > 1e-3, `${tr.name}: the reference plays (peak ${H.peak(a)}, finite ${H.finite(a)})`);
    const d = H.compare(a, b);
    if (tr.model === 'serum') assert.ok(d.max <= TOL, `${tr.name} (Serum): ${H.describe(d)}`);
    else assert.equal(d.max, 0, `${tr.name} (${tr.model}): ${H.describe(d)}`);
    first.set(tr.id, b);
  }
  // save (main.js projectFile: serialize, embedded tables unchanged) and reload with the current code
  const saved = JSON.parse(S.serialize(pb));
  saved.wts = o.wts;
  for (const tr of saved.tracks) if (tr.model === 'serum') assert.equal(tr.vals.s.v, B.core.VERSION, tr.name + ': saved in the current state version');
  for (const tr of saved.tracks) assert.ok(tr.fx && tr.fx.v >= 2, tr.name + ': its rack saved as a v2 state (§2.6.3 migration on load)');
  const pc = loadProject(B, JSON.stringify(saved));
  assert.deepEqual(stripIds(pc), stripIds(pb), 'reloaded project equals the loaded one');
  for (const tr of pc.tracks) assert.equal(H.compare(first.get(tr.id), bounceTrack(B, pc, tr, secs)).max, 0, tr.name + ': renders identically after the reload');
});

/* ------------------------------------------------------------------ item 7: timing rows a–c (§14.1) */
// Phase-1 §8.4.3 budgets with v1 states through each side's whole engine: (a) OS 2, 8 voices × unison 16 × 2 oscillators,
// no warp, 1-frame table, MG Low 24; (b) as (a) with a 256-frame table, WT POS by LFO 1 at 2 Hz, Bend + 50 % on both;
// (c) begin + fxMods only. Medians of 5 interleaved runs; target ≤ 1.15 × ref-p1, the test fails above 1.3×.
function benchState(scen) {
  const s = A.core.defaultSerum();
  Object.assign(s.p, { 'a.uni': 1, 'b.uni': 1, 'b.on': 1, 'f.on': 1, 'f.type': 3 / 95, 'f.routeA': 1, 'f.routeB': 1, 'a.det': 0.5, 'b.det': 0.5 });
  s.voicing.poly = 8; s.global.os = 2;
  if (scen === 'b') {
    s.osc[0].wt = s.osc[1].wt = 'factory:Harmonic Sweep';
    Object.assign(s.p, { 'a.warpMode': 4 / 22, 'b.warpMode': 4 / 22, 'a.warp': 0.5, 'b.warp': 0.5, 'l1.rate': Math.pow(2 / 100, 0.25) });
    s.lfo[0].mode = 'off'; s.lfo[0].bpm = 0;
    s.matrix[0] = { src: 'lfo1', amt: 1, dst: 'a.wt', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
    s.matrix[1] = { src: 'lfo1', amt: 1, dst: 'b.wt', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
  }
  return A.core.normalizeSerum(s);
}
function bench(X, v1) {
  const Sc = H.scope(X);
  Sc.g.currentFrame = 0; Sc.seed('bench');
  const p = new Sc.Proc({ processorOptions: { os: 2, hostOS: 4 } });
  const s = H.serumState(X, v1), patch = H.trackPatch(X, 'serum', { s }, H.fxState(X, A.core.defaultFx(), s));
  H.postTables(X, p, patch.needs);
  p.msg({ t: 'patch', p: patch });
  for (let i = 0; i < 8; i++) p.msg({ t: 'on', n: 48 + 3 * i, v: 0.8 });
  const out = [[new Float32Array(128), new Float32Array(128)]], SD = Sc.g.SerumDSP;
  const second = () => { for (let k = 0; k < H.SR / 128; k++) { p.process([], out); Sc.g.currentFrame += 128; } };
  const begins = () => { for (let k = 0; k < 40 * H.SR / 128; k++) { SD.begin(p, 128 * p.OS); SD.fxMods(p); } }; // 40 s of spans
  second();
  return { second, begins, voices: p.voices.filter(v => v.active).length };
}
test('timing rows a–c (§14.1): v1 states through the current code ≤ 1.3 × ref-p1 (target 1.15×)', (t) => {
  const res = [];
  for (const scen of ['a', 'b']) {
    const v1 = benchState(scen), a = bench(A, v1), b = bench(B, v1);
    assert.equal(a.voices, 8); assert.equal(b.voices, 8);
    const r = H.timeInterleaved(a.second, b.second, { limit: 1.3 });
    res.push([scen, r]);
    if (scen === 'a') res.push(['c', H.timeInterleaved(a.begins, b.begins, { limit: 1.3 })]);
  }
  for (const [k, r] of res) t.diagnostic(`(${k}) ref-p1 ${r.a.toFixed(1)} ms, current ${r.b.toFixed(1)} ms per ${k === 'c' ? '40 s of spans' : 's of audio'}: ${r.ratio.toFixed(3)}× (attempt ${r.attempts})`);
  for (const [k, r] of res) assert.ok(r.ratio <= 1.3, `(${k}) ${r.ratio.toFixed(2)}× ref-p1 (fails above 1.3×)`);
});
