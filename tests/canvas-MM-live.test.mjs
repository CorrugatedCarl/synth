// Stage MM G1 (docs/canvas/IMPL-MM.md §9 G1, §9.0; lane E records, lane H extends): the base build's LIVE run of project-p1, per
// node, frozen — a build whose master holds no modulator module and no master cable must render every Track node and MASTER byte
// for byte as the base did (MM1), through MASTER's new ModCore members, its song clock and the rack-path rule. The scene is
// tests/canvas-SC-live's (one scripted page session in the page simulation, clock 'std': open project-p1, power, a warm-up render,
// ▶ from the start, FRAMES frames through sim.run, each worklet node's output hashed — SHA-256 of L, of R, as Float32 bytes —, nodes
// in creation order with their processor name and track id); tests/ref-MM/live-p1-mm.sha holds the reference (a header line, one
// line per node `<i> <name> <trackId> <shaL> <shaR>`, then `frames <N> sr <rate> peak <p>`). **Lane H** adds the master-canvas
// session G1 names before ▶ — an LFO added on the master canvas and deleted again without cabling it (impossible at the base:
// `modAdd` refuses there) — at the marked spot: the payload posts `{off: true}` at most and MASTER's output stays the base's.
// Accessor-free like the other canvas sims; strings and numbers only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-MM-live.test.mjs
// Re-record (ONLY from the base tree, ba91775 — IMPL-MM's base; never from MM-stage code, or the proof is circular): extract it into
// the scratchpad (git archive ba91775 | tar -x -C <dir>), then
//   REC=<dir> node --max-old-space-size=2048 --test tests/canvas-MM-live.test.mjs
// (the app modules and main-sim are imported from <dir>; this file only writes tests/ref-MM/live-p1-mm.sha).
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HERE = new URL('../', import.meta.url);
const FIX = new URL('./ref-MM/live-p1-mm.sha', import.meta.url);
const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8');
const FRAMES = 48000 * 4;                                      // 4 s from ▶ (bar 1 of p1 is 1.94 s at 124 bpm: two bars and a tail)
const f32 = a => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

async function scene(root, rec) {
  const { bootMain } = await import(new URL('tests/main-sim.mjs', root));
  const { fakeStorage, fakeIDB } = await import(new URL('tests/fakes.mjs', root));
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
  const $ = s.$, step = async (n) => { s.raf(2); await s.settle(2); s.raf(); return s.run(n); };
  const file = { name: 'project-p1.synth.json', type: 'application/json', text: async () => P1 };
  await $('#fFile').onchange({ target: { files: [file], value: '' } });
  await s.settle(30);
  await s.power(); await s.settle(30);
  await step(4096);                                            // the warm-up render (the first quanta of a fresh node), discarded
  if (!rec) {
    // lane H (G1): the master-canvas session here — open the master canvas, add an LFO (no cable), delete it, leave — through
    // the page's own handlers / __synthTest.master.mod; then `await s.settle(…)` so the `{off: true}` (if any) is posted before ▶
  }
  $('#tPlay').onclick();
  const out = await step(FRAMES), ctx = s.ctx();
  const lines = [], safe = [];
  let i = 0, peak = 0;
  for (const [n, o] of out) {
    if (n.name === 'synth-safe') { safe.push(o); continue; }
    lines.push([i++, n.name, (n.po && n.po.trackId) || '-', f32(o.L), f32(o.R)].join(' '));
    for (let k = 0; k < o.L.length; k++) peak = Math.max(peak, Math.abs(o.L[k]), Math.abs(o.R[k]));
  }
  assert.ok(peak > 1e-3, 'it sounds (peak ' + peak.toFixed(4) + ')');
  return { lines, frames: FRAMES, sr: ctx.sampleRate, peak: +peak.toFixed(6), safe }; // (peak: for the eye; it follows from the hashes)
}
const text = r => ['v 1 from ba91775 (the IMPL-MM base; engine.js / fx-dsp.js / mod-core.js as at the phase-0 commit 54828a3): project-p1, ▶ from the start, per node SHA-256 of L and R',
  ...r.lines, 'frames ' + r.frames + ' sr ' + r.sr + ' peak ' + r.peak].join('\n') + '\n';

test('MM G1: the base build\'s live run of project-p1 — every node\'s output (the Tracks and MASTER), hash for hash', async () => {
  const rec = process.env.REC;
  if (rec) { // (recording: the base tree only)
    const r = await scene(pathToFileURL(rec.endsWith('/') ? rec : rec + '/'), true);
    mkdirSync(new URL('./ref-MM/', import.meta.url), { recursive: true });
    writeFileSync(FIX, text(r));
    return;
  }
  const ref = readFileSync(FIX, 'utf8').split('\n').filter(Boolean), r = await scene(HERE, false), got = text(r).split('\n').filter(Boolean);
  assert.ok(ref.length >= 4, 'the reference holds the header, at least two nodes and the footer');
  assert.equal(got[0], ref[0], 'the header');
  assert.equal(got.at(-1), ref.at(-1), 'frames, rate and peak');
  assert.deepEqual(got.slice(1, -1).map(l => l.split(' ').slice(0, 3).join(' ')), ref.slice(1, -1).map(l => l.split(' ').slice(0, 3).join(' ')), 'the nodes: creation order, processor name, track id');
  for (let k = 1; k < ref.length - 1; k++) assert.equal(got[k], ref[k], 'node ' + ref[k].split(' ').slice(0, 3).join(' ') + ': L and R bit for bit');
  let sp = 0;
  for (const o of r.safe) for (let k = 0; k < o.L.length; k++) sp = Math.max(sp, Math.abs(o.L[k]), Math.abs(o.R[k]));
  assert.deepEqual([r.safe.length, sp > 0.5, sp <= Math.fround(Math.pow(10, -1 / 20))], [1, true, true], 'one safety limiter, nothing out of it over −1 dBFS (' + sp + ')');
});
