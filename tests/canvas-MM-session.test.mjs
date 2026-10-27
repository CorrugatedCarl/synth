// Stage MM G1 (sim part, docs/canvas/IMPL-MM.md MM1, §9 G1): no master modulator = today, bit for bit — after a master-canvas session
// that adds an LFO, edits it, deletes it, adds another and undoes it (never cabled: no payload, at most an {off: true} — none here, N1),
// project-p1's LIVE run renders every Track node and the master byte for byte as the base did. The reference is the frozen
// tests/ref-SC/live-p1.sha (a87b915, reproduced by every build since — the base of this stage included: canvas-SC-live, phase 0's
// sweep), so no new frozen file is needed: the same scene (tests/canvas-SC-live.test.mjs: open project-p1, power, a warm-up render,
// ▶ from the start, FRAMES frames through sim.run, each worklet node's L / R hashed in creation order) with the master session
// before the warm-up. Accessor-free like the other canvas sims; strings and numbers only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-MM-session.test.mjs (lane H; lane E owns canvas-MM-live, the ref-MM recorder)
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { bootMain } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';

const FIX = new URL('./ref-SC/live-p1.sha', import.meta.url);
const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8');
const FRAMES = 48000 * 4;
const f32 = a => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

test('MM G1 (sim): a master-canvas session that adds, edits and deletes LFOs without cabling them leaves project-p1\'s live run hash for hash (ref-SC/live-p1.sha: every Track node and the master)', async () => {
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
  const $ = s.$, step = async (n) => { s.raf(2); await s.settle(2); s.raf(); return s.run(n); };
  const file = { name: 'project-p1.synth.json', type: 'application/json', text: async () => P1 };
  await $('#fFile').onchange({ target: { files: [file], value: '' } });
  await s.settle(30);
  await s.power(); await s.settle(30);
  // the master session: an LFO added, edited (its rate), deleted; another added and undone — never cabled
  const M = globalThis.__synthTest.master, X = globalThis.__synthTest.cv.mod, U = globalThis.__synthTest.modUI, cv = globalThis.__synthTest.cv;
  const MN = () => M.rec().node, mods = () => MN().posted.filter(x => x.m.t === 'mods' || x.m.t === 'mval').length;
  M.open(); s.raf(2); await s.settle(3);
  assert.equal(X.add('lfo', null), 'l1');
  assert.equal(U.editState('l1', { rate: 0.31 }), true);
  assert.equal(X.del('l1'), true);
  assert.equal(X.add('chaos', null), 'h1');
  cv.undo(); s.raf(2); await s.settle(3);
  M.off(); s.raf(2); await s.settle(3);
  const pm = JSON.stringify(api().project().master || null);
  assert.deepEqual([mods(), 'mdev' in (api().project().master || {}) ? Object.keys(api().project().master.mdev).length : 0], [0, 0], 'nothing for MASTER\'s ModCore (no rows: N1); no modulator left: ' + pm);
  await step(4096); // the warm-up render, discarded
  $('#tPlay').onclick();
  const out = await step(FRAMES);
  const lines = [], safe = [];
  let i = 0;
  for (const [n, o] of out) {
    if (n.name === 'synth-safe') { safe.push(o); continue; }
    lines.push([i++, n.name, (n.po && n.po.trackId) || '-', f32(o.L), f32(o.R)].join(' '));
  }
  const ref = readFileSync(FIX, 'utf8').split('\n').filter(Boolean).slice(1, -1);
  assert.deepEqual(lines.map(l => l.split(' ').slice(0, 3).join(' ')), ref.map(l => l.split(' ').slice(0, 3).join(' ')), 'the nodes: creation order, processor name, track id');
  for (let k = 0; k < ref.length; k++) assert.equal(lines[k], ref[k], 'node ' + ref[k].split(' ').slice(0, 3).join(' ') + ': L and R bit for bit');
  assert.equal(safe.length, 1);
  function api() { return s.api; }
});
