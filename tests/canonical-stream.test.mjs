// The canonical-compile contract (SPEC-canvas §5.5, stage 1c): a track of today's shape — one instrument → its panel →
// OUT, a Serum with its own FX → OUT — posts exactly the message stream main posts. A scripted page session (main-sim:
// open project-p1, power, play, select tracks, knobs on a classic and a Serum track, a classic and a Serum preset, notes,
// effects added and removed, model changes classic → classic and classic ↔ Serum (the FX kept), undo / redo, the
// oversampling, an engine power cycle) records every node's processorOptions and every postMessage to every node (order,
// type, the SHA-1 and length of the structured clone's canonical text — key order, types (typed array kinds, -0, NaN,
// undefined) and values; not v8.serialize's bytes, whose Smi / double encoding of the same number follows V8's object-shape
// history, not the data). The reference was recorded once from main's code at the merge base a02ab5d
// (tests/fixtures/stream-main.json); the canvas build must reproduce it exactly.
// Left out of the comparison, by design: the monitor subscriptions ({t: 'smon'}; on the canvas from stage 1d
// {t: 'mon', ids}, §6.8) and the FX phase read-backs they replace ({t: 'fxph'}) — which displays are live is UI (main:
// the tab shown; canvas: the module on screen).
// Stage M (IMPL-M §7.3, the lead's decision): the record is PARTITIONED BY PROCESSOR NAME — the 'synth-engine' part (its nodes
// re-indexed among themselves in creation order, the messages to them) equals main's fixture exactly, as before; the
// 'synth-master' part (the master: its nodes, their options' hashes, every message to them but the same three monitor types)
// equals tests/fixtures/stream-master.json (recorded from the Master stage's build: STREAM_REC_MASTER=1 — never from main,
// which has no master); any other processor name fails. Compared separately, not left out. Structural, with no fixture: one
// live MASTER per live context, made before that context's first track node; its transport / panic stream is the one the
// context's first track node received (postAll's forwarding: the same anchors, the same order).
// Run: node --max-old-space-size=2048 --test tests/canonical-stream.test.mjs
// Re-record (only from main's tree, never from canvas code): extract the merge base into the scratchpad
// (git archive a02ab5d | tar -x -C <dir>), then STREAM_REC=<dir> node --max-old-space-size=2048 --test tests/canonical-stream.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HERE = new URL('../', import.meta.url);
const FIX = new URL('./fixtures/stream-main.json', import.meta.url), FIX_M = new URL('./fixtures/stream-master.json', import.meta.url);
const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8');
const SKIP = new Set(['smon', 'mon', 'fxph']);
// the canonical text of a structured-cloneable value (what a postMessage carries, independent of V8's representation)
function canon(x) {
  if (x === null) return 'null';
  switch (typeof x) {
    case 'undefined': return 'u';
    case 'number': return Object.is(x, -0) ? '-0' : String(x);
    case 'string': return JSON.stringify(x);
    case 'boolean': case 'bigint': return String(x);
    default: break;
  }
  if (ArrayBuffer.isView(x)) { let s = x.constructor.name + '('; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + canon(x[i]); return s + ')'; }
  if (x instanceof ArrayBuffer) return 'AB(' + Array.from(new Uint8Array(x)).join(',') + ')';
  if (x instanceof Map) return 'Map(' + [...x].map(([k, v]) => canon(k) + '=>' + canon(v)).join(',') + ')';
  if (x instanceof Set) return 'Set(' + [...x].map(canon).join(',') + ')';
  if (Array.isArray(x)) { let s = '['; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + (i in x ? canon(x[i]) : '_'); return s + ']'; }
  return '{' + Object.keys(x).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const sha = m => { const c = canon(m); return createHash('sha1').update(c).digest('hex').slice(0, 16) + ':' + c.length; };

async function session(root) {
  const { bootMain } = await import(new URL('tests/main-sim.mjs', root));
  const { fakeStorage, fakeIDB } = await import(new URL('tests/fakes.mjs', root));
  const FC = await import(new URL('fx-core.js?v=9', root));
  const { MODELS } = await import(new URL('models.js?v=9', root));
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
  // processorOptions hashed as the node is built (the processor reads and may consume them while it runs)
  const AWN = globalThis.AudioWorkletNode, born = new Map();
  globalThis.AudioWorkletNode = class extends AWN { constructor(c, n, o) { const h = sha(structuredClone((o && o.processorOptions) || {})); super(c, n, o); born.set(this, h); } };
  const api = s.api, $ = s.$, tr = id => api.project().tracks.find(t => t.id === id);
  const I = t => (t.dev ? t.dev[t.prim] : t); // (a track's instrument: canvas milestone 3 R7 — no v1 fields — and main's v1 tracks alike)
  const step = async (n = 1024) => { s.raf(2); await s.settle(2); s.raf(); s.run(n); };
  const file = { name: 'project-p1.synth.json', type: 'application/json', text: async () => P1 };
  await $('#fFile').onchange({ target: { files: [file], value: '' } });
  await s.settle(30);
  await s.power(); await s.settle(30); await step(4096);
  $('#tPlay').onclick(); await step(24000);
  for (const id of ['trk_3', 'trk_1', 'trk_4', 'trk_5', 'trk_2']) { api.selectTrack(id); await step(2048); }
  { const t = tr('trk_3'); for (const v of [2, 4.5, 7]) { I(t).vals.fc = v; api.queuePatch(t); await step(); } } // a classic knob
  { const t = tr('trk_1'); for (const v of [0.2, 0.6]) { api.sxHost(t).edit(st => { st.p['f.cutoff'] = v; }); await step(); } } // a Serum knob
  api.selectTrack('trk_5'); await step();
  s.key('KeyA', true); await step(2048); s.key('KeyA', false); await step(2048);
  { // a classic preset (applyPreset's data: the defaults with the preset's values, its name) and a Serum one
    const t = tr('trk_5'), m = MODELS.find(x => x.id === 'juno60'), p = m.presets[2];
    I(t).vals = Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), p.v); I(t).preset = p.name; api.sendPatch(t); await step();
    const sx = MODELS.find(x => x.id === 'serum');
    api.sxLoad(tr('trk_2'), 'f:' + sx.presets[3].name); await step();
  }
  { // effects added and removed (the FX module's host on a classic track, the Serum panel's on a Serum one)
    const c = tr('trk_6'), x = tr('trk_1');
    let id = null;
    api.fxHost(c).editFx(fx => { id = FC.newInstance(fx, 'dly', { rack: 0 }); }); await step();
    api.fxHost(c).editFx(fx => { FC.removeInstance(fx, typeof id === 'string' ? id : id && id.id); }); await step();
    api.sxHost(x).editFx(fx => { FC.newInstance(fx, 'rev', { rack: 0 }); }); await step();
  }
  // model changes: classic → classic, classic → Serum → classic (today: the rack is kept), then undo / redo
  api.setTrackModel(tr('trk_5'), 'prophet5'); await step();
  api.setTrackModel(tr('trk_3'), 'serum'); await step();
  api.setTrackModel(tr('trk_3'), 'minimoog'); await step();
  for (const b of ['#tUndo', '#tUndo', '#tRedo', '#tUndo']) { $(b).onclick(); await step(); }
  $('#os').value = '2'; $('#os').onchange(); await step();
  $('#tPlay').onclick(); await step();
  $('#power').onclick(); await s.settle(30); await s.power(); await s.settle(30); await step(4096);
  // the record: nodes in creation order (every context), then the posted messages — partitioned by processor name (stage M):
  // each part's nodes indexed among themselves, its messages those posted to them
  const all = [];
  for (const c of [...s.live, ...s.offline]) for (const n of c.nodes) if (n.kind === 'worklet') all.push(n);
  const part = name => {
    const nodes = all.filter(n => n.name === name), ix = new Map(nodes.map((n, i) => [n, i]));
    return {
      nodes: nodes.map((n, i) => [i, n.name, n.po.trackId || '', born.get(n) || '']),
      stream: s.posted.filter(x => ix.has(x.node) && !(x.m && SKIP.has(x.m.t))).map(x => [ix.get(x.node), x.m && x.m.t, sha(x.m)]),
    };
  };
  // (structural, stage M) per live context: its MASTER(s), the index of its first track node, the transport / panic streams
  const ctxs = s.live.map(c => {
    const ws = c.nodes.filter(n => n.kind === 'worklet'), m = ws.filter(n => n.name === 'synth-master'), t0 = ws.findIndex(n => n.name === 'synth-engine');
    const tp = n => (n ? n.posted.map(x => x.m).filter(q => q && (q.t === 'transport' || q.t === 'panic')).map(sha) : null);
    return { masters: m.length, mFirst: m.length ? ws.indexOf(m[0]) : -1, t0, mTp: tp(m[0]), tTp: tp(ws[t0]) };
  });
  return { engine: part('synth-engine'), master: part('synth-master'), names: [...new Set(all.map(n => n.name))].sort(), ctxs };
}

test('a canonical track posts exactly main\'s message stream (§5.5): the scripted p1 session, node for node, message for message', async () => {
  const rec = process.env.STREAM_REC;
  if (rec) { // (recording: main's tree only — every node of it is 'synth-engine')
    const r = (await session(pathToFileURL(rec.endsWith('/') ? rec : rec + '/'))).engine;
    writeFileSync(FIX, JSON.stringify({ v: 1, from: 'a02ab5d (main, the merge base)', skip: [...SKIP], nodes: r.nodes, stream: r.stream }) + '\n');
    return;
  }
  const ref = JSON.parse(readFileSync(FIX, 'utf8')), R = await session(HERE), r = R.engine;
  // (stage M) the partition: no processor name but the two; the master part = its own fixture; the structure
  assert.deepEqual(R.names, ['synth-engine', 'synth-master'], 'only the Track and the master (any other processor name fails)');
  if (process.env.STREAM_REC_MASTER) writeFileSync(FIX_M, JSON.stringify({ v: 1, from: 'the Master stage (IMPL-M lane A)', skip: [...SKIP], nodes: R.master.nodes, stream: R.master.stream }) + '\n');
  const refM = JSON.parse(readFileSync(FIX_M, 'utf8'));
  assert.deepEqual(R.master.nodes, refM.nodes, 'the master part: its nodes and processorOptions');
  assert.deepEqual(R.master.stream, refM.stream, 'the master part: every message to it');
  assert.ok(R.ctxs.length >= 2, 'the session powers twice');
  for (const [k, c] of R.ctxs.entries()) {
    if (c.t0 < 0) continue; // (a probe context: no track node)
    assert.deepEqual([c.masters, c.mFirst < c.t0], [1, true], 'live context ' + k + ': one MASTER, made before its first track node');
    assert.deepEqual(c.mTp, c.tTp, 'live context ' + k + ': MASTER\'s transport / panic stream = its first track\'s');
  }
  assert.ok(ref.stream.length > 100, 'the reference holds a real session: ' + ref.stream.length);
  assert.deepEqual(r.nodes, ref.nodes, 'every node and its processorOptions (the initial patch, song, sequencer)');
  const n = Math.min(r.stream.length, ref.stream.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(r.stream[i]) !== JSON.stringify(ref.stream[i])) {
      assert.fail(`message ${i} differs: canvas ${JSON.stringify(r.stream[i])} vs main ${JSON.stringify(ref.stream[i])}; before it: ${JSON.stringify(ref.stream.slice(Math.max(0, i - 3), i).map(x => x[1]))}`);
    }
  }
  assert.equal(r.stream.length, ref.stream.length, 'as many messages');
});
