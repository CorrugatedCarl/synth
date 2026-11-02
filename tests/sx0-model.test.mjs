import './v8-guard.mjs';
// Stage SX0 (docs/canvas/IMPL-SX0.md §6.2, S1): the Wavecraft compiles every sound Serum complete reached byte for byte. tests/ref-SX0/base.json
// was recorded once from the pristine ⟨B⟩ as record('serum') (every factory preset as program change loads it and as stored, the default
// state plain / at odd options / with the GLOBAL preferences, the three render-farm loops' patches, cv-cost's measure row): record(RIG.ID)
// must give the same hashes — from phase 0 on, so the rig is proven while `serum` is still a model. The `farm:` / `cost:` entries are
// built as the site builds them (smpgen's plan note's model, cv-cost's row): they pin the re-point of those two files too.
// tests/fixtures/sx0-dests.json (the stage-3 views' data-dest sets, recorded from the same tree): its shape is pinned here; the faces are
// compared against it by rig-ui.test, ui-layout-wc and m3-fixture. ref-WC's rename (its Serum fixtures are rigs; base.json is not re-recorded):
// back() is the only transform.
// Run alone: node --max-old-space-size=2048 --test tests/sx0-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RIG } from '../rig-core.js?v=9';
import { FACTORY_PRESETS } from '../serum-core.js?v=9';
import { record } from './ref-SX0/record.mjs';
import * as WC from './ref-WC/record.mjs';
import * as G from '../cv-graph.js?v=9';

// (tests/ref-SX0/dests.mjs's lists: not imported — that script registers the UI stubs' hooks)
const PARTS = ['oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env1', 'env2', 'env3', 'env4', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7',
  'lfo8', 'lfo9', 'lfo10', 'macros', 'voicing', 'chaos1', 'chaos2', 'velo', 'note', 'voice', 'arp', 'clip'];

const BASE = JSON.parse(readFileSync(new URL('./ref-SX0/base.json', import.meta.url), 'utf8'));
const DESTS = JSON.parse(readFileSync(new URL('./fixtures/sx0-dests.json', import.meta.url), 'utf8'));

test('ref-SX0: record(RIG.ID) equals the frozen patchFor(\'serum\', …) hashes — every factory preset (loaded and stored), the defaults, the farm loops, cv-cost\'s row e', () => {
  const now = record(RIG.ID), was = BASE.hashes;
  assert.equal(BASE.from, 'b82067c');
  assert.equal(Object.keys(was).length, BASE.n);
  assert.equal(BASE.n, 2 * FACTORY_PRESETS.length + 3 + 2 * 8 + 1, 'presets × 2, three defaults, eight farm patches × 2, cost:e');
  assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort(), 'the same entries');
  assert.deepEqual(Object.keys(now).filter(k => now[k] !== was[k]), [], 'every hash exact');
  assert.ok(new Set(Object.values(was)).size >= 180, 'a real record: the entries differ from each other (farm / farmId pairs alike)');
});

test('ref-WC\'s rename (IMPL-SX0 §6.2, §11.7): the 94 fixtures that held a Serum hold a rig; back() — the base\'s model id on the track / graph columns — changes a synth device\'s, a v1\'s or a patch\'s `model` RIG.ID → \'serum\' and nothing else', () => {
  const F = WC.fixtures(), rigs = Object.keys(F).filter(k => WC.holdsRig(F[k]));
  assert.equal(rigs.length, 94);
  assert.deepEqual(rigs.filter(k => !/^serum:/.test(k)), ['1e:b', '2a:0', '2a:1', '2a:2', '2b:0', '2b:1', '2b:2', '2b:3']);
  assert.ok(Object.keys(F).every(k => rigs.includes(k) || !Object.values(F[k].dev).some(d => d && d.model === 'serum')), 'no fixture holds a Serum');
  const flat = (x, at = '', out = new Map()) => { if (x && typeof x === 'object' && !ArrayBuffer.isView(x)) for (const k of Object.keys(x)) flat(x[k], at + '/' + k, out); else out.set(at, x); return out; };
  for (const k of rigs) for (const fn of [G.compileTrack, G.compileGraph]) {
    const a = flat(fn(F[k])), b = flat(WC.back(fn(F[k]), ''));
    assert.deepEqual([...a.keys()], [...b.keys()], k + ': the same paths');
    const d = [...a.keys()].filter(p => a.get(p) !== b.get(p));
    assert.ok(d.length >= 1, k + ': the id is echoed');
    for (const p of d) assert.ok(/^\/(v1|patches\/[a-z]+\d+)\/model$/.test(p) && a.get(p) === RIG.ID && b.get(p) === 'serum', k + ' ' + p);
  }
  const x = { model: 'rig', a: { model: 'rig' }, v1: { model: 'rig', vals: { model: 'rig' } }, patches: { i1: { model: 'rig', fx: { model: 'rig' } } }, dev: { i1: { kind: 'synth', model: 'rig' }, i2: { kind: 'panel', model: 'rig' } },
    list: [{ kind: 'synth', model: 'rig' }, { model: 'rig' }], other: { model: 'juno60', kind: 'synth' } };
  const y = WC.back(x, '');
  assert.deepEqual(y, Object.assign(JSON.parse(JSON.stringify(x)), { v1: { model: 'serum', vals: { model: 'rig' } }, patches: { i1: { model: 'serum', fx: { model: 'rig' } } },
    dev: { i1: { kind: 'synth', model: 'serum' }, i2: { kind: 'panel', model: 'rig' } }, list: [{ kind: 'synth', model: 'serum' }, { model: 'rig' }] }));
  assert.equal(x.v1.model, 'rig', 'a new object: the input untouched');
});

test('sx0-dests.json: four states × every part a view kind takes, four slot panels — sorted, unique data-dest ids', () => {
  assert.deepEqual(Object.keys(DESTS.parts), ['rig', 'sample', 'wc', 'm3']);
  for (const [st, R] of Object.entries(DESTS.parts)) {
    assert.deepEqual(Object.keys(R), PARTS, st);
    for (const [part, ids] of Object.entries(R)) {
      assert.ok(Array.isArray(ids) && ids.every(x => typeof x === 'string'), st + ' ' + part);
      assert.deepEqual(ids, [...new Set(ids)].sort(), st + ' ' + part + ': sorted, unique');
    }
  }
  assert.deepEqual(Object.keys(DESTS.slots), ['lfo', 'env', 'macro', 'chaos']);
  assert.deepEqual([DESTS.parts.rig.oscA.length, DESTS.parts.wc.oscC.length, DESTS.parts.rig.voice.length, DESTS.slots.env.length], [22, 36, 20, 10]);
});
