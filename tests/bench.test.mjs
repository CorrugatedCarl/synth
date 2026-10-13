// The §14.1 bench (owner I): tests/bench-scenarios.mjs builds every row d–m and renders it through the engine (node smoke
// test: each scenario plays, finite, short); tests/bench.json holds the calibration of the node CPU gates and the
// recorded loads. The gated CPU rows themselves live with their owners' tests (§15).
// Run: node --test tests/bench.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { scenarios, measure } from './bench-scenarios.mjs';
import { dspScope } from './dsp-scope.mjs';
import * as CPU from './cpu-gate.mjs';

test('§14.1 bench: every scenario d–m builds and renders audibly through the engine / FXRack', () => {
  const D = dspScope({ fast: true, engine: true });
  const env = { mk: po => new D.Proc({ processorOptions: po }), advance: n => { D.ctx.currentFrame += n; }, FXDSP: D.global('FXDSP'), SxBase: D.global('SxBase') };
  const ids = [];
  for (const s of scenarios()) {
    const r = measure(s, env, { runs: 1, seconds: 0.05 });
    ids.push(s.id);
    assert.ok(Number.isFinite(r.load) && r.load >= 0, s.id + ': a load');
    assert.ok(r.peak > 1e-4 && Number.isFinite(r.peak), s.id + ': audible (' + r.peak + ')');
    assert.ok(s.ipad <= 0.6 && s.node > 0, s.id + ': targets');
  }
  for (const id of ['d', 'e', 'f', "f'", 'g', "g'", 'g"', 'h', "h'", 'i', 'j', 'k0', 'k4', 'l', 'm']) assert.ok(ids.includes(id), 'row ' + id);
});

test('§14.1 bench: every timed run must be audible — a run past the end of its source (or without notes) throws instead of timing silence; the sample rows loop', () => {
  const D = dspScope({ fast: true, engine: true });
  const env = { mk: po => new D.Proc({ processorOptions: po }), advance: n => { D.ctx.currentFrame += n; }, FXDSP: D.global('FXDSP'), SxBase: D.global('SxBase') };
  const S = scenarios(), d = S.find(s => s.id === 'd');
  assert.throws(() => measure(Object.assign({}, d, { build: () => Object.assign(d.build(), { notes: [] }) }), env, { runs: 1, seconds: 0.05 }), /silent/);
  // the Granular and Spectral rows read the 2 s bench sample in a loop: still sounding (and spawning grains) after it
  for (const id of ['g', 'h']) {
    const s = S.find(x => x.id === id), r = measure(s, env, { runs: 3, seconds: 0.75 });
    assert.ok(r.peak > 1e-4 && r.worst > 0, id + ' sounds past the end of the source');
  }
});

// §0.4 hot paths never allocate — including heap numbers: a double passed to (or returned by) a call that V8 does not
// inline is boxed. Rows d (WT, two warp slots, unison) and g" (3 × Granular) render 1 s after a 0.5 s warm-up in a child
// node with a 1 MB young generation; the minor GCs it triggers stay a few dozen per second of audio (M4: ≈ 460 / s before
// the kernels took their amounts from arrays and the per-grain reads their doubles from a scratch array; ≈ 20 / s now).
test('§0.4 / M4: rows d and g" allocate (almost) nothing per sample — minor GCs per second of audio with a 1 MB young generation', () => {
  const here = new URL('./', import.meta.url).href, V = /const VERSION = '(\d+)'/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1];
  const code = `
    import { PerformanceObserver, constants } from 'node:perf_hooks';
    import { scenarios } from '${here}bench-scenarios.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as W from '${here}../wt.js?v=${V}';
    const out = {};
    for (const id of ['d', 'g"']) {
      const S = scenarios().find(s => s.id === id), D = dspScope({ fast: true, engine: true }), B = S.build();
      if (B.assets) for (const [k, e] of Object.entries(B.assets)) D.global('SxBase').storeAsset(k, e);
      const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, offline: true } });
      p.msg({ t: 'patch', p: B.patch });
      for (const k of B.patch.needs || []) if (!/^(smp|msmp|spec|wtsmp|fsmp|fmsmp):/.test(k)) p.msg(Object.assign({ t: 'wt' }, k.startsWith('noise:') ? W.makeNoise(k) : W.makeEntry(k, W.factoryTable(k) || W.factoryTable('factory:Default')), { id: k }));
      for (const [n, v] of B.notes) p.msg({ t: 'on', n: n | 0, v });
      const L = new Float32Array(128), R = new Float32Array(128), o = [[L, R]];
      const q = k => { for (let i = 0; i < k; i++) { p.process([], o); D.ctx.currentFrame += 128; } };
      q(188);
      let minor = 0;
      const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) if ((e.detail ? e.detail.kind : e.kind) === constants.NODE_PERFORMANCE_GC_MINOR) minor++; });
      obs.observe({ entryTypes: ['gc'] });
      q(375);
      await new Promise(r => setTimeout(r, 50));
      obs.disconnect();
      out[id] = minor;
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--max-semi-space-size=1', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const id of ['d', 'g"']) assert.ok(got[id] <= 80, `row ${id}: ${got[id]} minor GCs per second of audio (heap numbers on the render path)`);
});

test('§14.1 bench.json: the calibration t_ref(calib) and the targets of every row', () => {
  const B = JSON.parse(readFileSync(new URL('./bench.json', import.meta.url), 'utf8'));
  assert.ok(B.calib > 0 && B.refMachine.calib === B.calib);
  for (const id of ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']) assert.ok(B.targets[id] && B.targets[id].node > 0, id);
  for (const s of scenarios()) {
    const t = B.targets[s.id] || B.targets[s.id[0]];
    assert.ok(t && t.node === s.node && (s.id.startsWith('g"') || t.ipad === s.ipad), s.id + ': bench.json targets match the scenarios');
  }
});

/* ------------------------------------------------------------------ row p: the engine's idle path (owner I) */
// §14.1 node gate through tests/cpu-gate.mjs: load × k ≤ 1.5 × target, k = t_ref(calib) / t(calib) with calib = row (b)
// through tests/ref-p1 measured in the same run (bench.json calib = t_ref(calib)); pairs in alternating order, the median of
// the per-pair ratios, re-measured (≤ 5 attempts) while over the gate (RULINGS2 Performance).
test('§14.1 row p (node gate): an idle Serum v2 track (default patch, no notes) after the 2 s quiet window ≤ 1.5 × 0.002 — the skip path', async (t) => {
  const core = await import('../serum-core.js?v=6'), { patchFor } = await import('../models.js?v=6'), W = await import('../wt.js?v=6');
  const D = dspScope({ engine: true });
  const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, trackId: 'idle' } });
  const s = core.defaultSerum(), patch = patchFor('serum', { s }, core.defaultFx2(), { sr: 48000, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } });
  p.msg({ t: 'patch', p: patch });
  for (const id of patch.needs) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))));
  const out = [[new Float32Array(128), new Float32Array(128)]];
  const sec = () => { for (let k = 0; k < 48000 / 128; k++) { p.process([], out); D.ctx.currentFrame += 128; } };
  sec(); sec(); sec(); // past the 2 s quiet window (and the first Serum patch's warm-up voices)
  assert.ok(p.quietF > 2 * 48000 && p.act === 0 && p.sxW === 0, 'the skip path is taken');
  assert.ok(out[0][0].every(x => x === 0), 'silent');
  const target = CPU.BENCH.targets.p.node, best = await CPU.gateLoad(sec, target);
  t.diagnostic(`row p: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * target, `row p: ${best.load.toFixed(5)} (raw ${best.raw.toFixed(5)}, calib ${best.calib.toFixed(0)} ms) > 1.5 × ${target}`);
});

/* ------------------------------------------------------------------ tests/bench.html wiring (node stand-in for the page) */
// The page itself only runs in a browser (the iPad record is taken by hand, §14.1); this checks what node can: its
// classic scripts are the §0.3 list in table order + engine.js, they evaluate together in ONE global scope as a page's
// classic scripts do (top-level declarations must not collide), the inline stand-ins register the processor, and its
// module's env (BenchProc, globals, performance.now) runs a scenario of each kind through measure().
test('§14.1 tests/bench.html: its scripts load in one page scope after the stand-ins and its env renders scenarios', async () => {
  const vm = await import('node:vm');
  const html = readFileSync(new URL('./bench.html', import.meta.url), 'utf8');
  const srcs = [...html.matchAll(/<script src="\.\.\/([^"?]+)\?v=(\d+)"><\/script>/g)];
  const { DSP_FILES } = await import('./dsp-scope.mjs');
  assert.deepEqual(srcs.map(m => m[1]), [...DSP_FILES, 'engine.js'], 'the §0.3 list in table order, then engine.js');
  const lint = readFileSync(new URL('../main.js', import.meta.url), 'utf8').match(/const VERSION = '(\d+)'/);
  assert.ok(srcs.every(m => m[2] === lint[1]), 'the release ?v= suffix');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, performance, setTimeout });
  vm.runInContext('globalThis.window = globalThis;', ctx);
  vm.runInContext(inline, ctx, { filename: 'bench.html#inline' });
  for (const m of srcs) vm.runInContext(readFileSync(new URL('../' + m[1], import.meta.url), 'utf8'), ctx, { filename: m[1] });
  for (const g of ['SxBase', 'SxMod', 'SerumDSP', 'FXDSP', 'BenchProc']) assert.ok(ctx[g] || vm.runInContext('typeof ' + g + ' !== "undefined" && ' + g, ctx), g + ' defined');
  const BP = vm.runInContext('BenchProc', ctx);
  const env = { mk: po => new BP({ processorOptions: po }), advance: n => { ctx.currentFrame += n; }, FXDSP: vm.runInContext('FXDSP', ctx), SxBase: vm.runInContext('SxBase', ctx), now: () => performance.now() };
  const kinds = new Set();
  for (const s of scenarios()) {
    if (kinds.has(s.kind)) continue;
    kinds.add(s.kind);
    const r = measure(s, env, { runs: 1, seconds: 0.05 });
    assert.ok(Number.isFinite(r.load) && r.peak > 1e-4, s.id + ' renders on the page env');
  }
  assert.ok(kinds.size >= 2, 'voice and FX scenarios');
});
