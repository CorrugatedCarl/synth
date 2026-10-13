// Asset manager tests (owner S1; SPEC-serum2 §9.5, §9.6, §11.12, §11.15, §14.2, §15.11): assets.js on stubs — fake
// AudioContexts and worklet ports, manual timers and clock, the real wt.js / wtstore memory store, fake workers.
// The Phase-1 wavetable manager and host.wt moved out of main.js unchanged (posting once per context, worker protocol
// and main-thread fallback, 10 s GC, keepBytes trim, live edits, embed/restore, delete), and the v2 manager: §9 entries
// for the ids compileSerum / compileFx emit (posted once per context with their buffers transferred; zone samples
// first), superseded `~opsKey` / `~shapeKey` variants dropped right after the replacing patch, the preview node's needs,
// the §14.2 asset meter (imports and selections over budget refused), navigator.storage.persist once, the §9.3 import
// pipeline (WAV / AIFF / decoder, roots, loops, caps, dedupe, ZIP, SFZ, IRs, relink), factory generation (progress,
// cache, cancel, the render farm in a vm "worker"), entries() for processorOptions, §9.8 files, host.smp, convMax;
// review-round fixes: content-addressed relink, rows after a reload, v2 table references, sticky cancel / failure,
// one build in flight per variant, gapless variant swaps (ready), budget memo, zone level caps, persistence, one-write
// imports, IR rate in bounces, spectral cache keys and variants, zone-sample users.
// Run: node --test tests/assets.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dspScope } from './dsp-scope.mjs';
import { wavFile, smplChunk, aiffFile, zipFile } from './smp-files.mjs';

const ROOT = new URL('../', import.meta.url);
const V = '?v=' + /const VERSION = '(\d+)'/.exec(readFileSync(new URL('main.js', ROOT), 'utf8'))[1];
const imp = f => import(new URL(f + V, ROOT).href);
const A = await imp('assets.js');
const wt = await imp('wt.js');
const wtstore = await imp('wtstore.js');
const smpstore = await imp('smpstore.js');
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// A test rig: one "AudioContext" at a time, nodes with recording ports, manual timers and clock, Serum tracks.
function rig(opts = {}) {
  const posts = [], nodes = new Map();
  const clock = { t: 1000 }, pending = new Map();
  let tid = 0, ctx = { n: 1 };
  const timers = { set: (f, ms) => { const id = ++tid; pending.set(id, { f, at: clock.t + ms }); return id; }, clear: id => { pending.delete(id); } };
  const runTimers = (ms = 0) => { clock.t += ms; for (const [id, x] of [...pending]) if (x.at <= clock.t) { pending.delete(id); x.f(); } };
  const node = name => ({ name, port: { postMessage: (m, tr) => posts.push({ node: name, ctx: ctx && ctx.n, m, tr: tr || [] }) } });
  const tracks = [];
  const edits = [], refreshes = [];
  const st = wtstore.memoryStore();
  const M = A.createAssetManager(Object.assign({
    ctxOf: () => ctx, post: A.portPoster(nodes), tracks: () => tracks, now: () => clock.t, timers,
    worker: () => null, stores: { wt: () => st, smp: () => smpstore.memoryStore() }, wt: () => Promise.resolve(wt),
    edit: (t, fn, o) => { fn(t.vals.s); edits.push([t.id, o.label]); }, editFx: (t, fn, o) => { fn(t.fx); edits.push([t.id, o.label]); },
    defaultState: () => ({ osc: [{ wt: 'factory:Default', smp: '' }, { wt: 'factory:Default', smp: '' }, { wt: 'factory:Default', smp: '' }], noise: { src: 'noise:White', oneshot: 0 } }),
    refresh: () => refreshes.push(1), persist: () => Promise.resolve(true),
  }, opts));
  return {
    M, posts, nodes, clock, pending, runTimers, node, tracks, edits, refreshes, st,
    get ctx() { return ctx; }, set ctx(c) { ctx = c; },
    addNode(trackId, name = 'n' + trackId) { const n = node(name); nodes.set(trackId, { node: n }); return n; },
    wtPosts: () => posts.filter(p => /^wt/.test(p.m.t)).map(p => [p.node, p.m.t, p.m.id].concat(p.m.t === 'wtf' ? [p.m.frame] : [])),
  };
}
const sxTrack = (id, s) => ({ id, name: 'Track ' + id, vals: { s: Object.assign({ osc: [{ wt: 'factory:Default' }, { wt: 'factory:Default' }], noise: { src: 'noise:White', oneshot: 0 } }, s || {}) } });

/* ------------------------------------------------------------------ surface */
test('§11.12: assets.js exports and the manager surface (Phase-1 `tables` + v2 entry points + host.wt / host.smp)', () => {
  assert.equal(A.KEEP_BYTES, 32 * 1048576, 'Phase-1 budget kept in M1b');
  assert.deepEqual(A.KEEP_BYTES_V2, { desktop: 64 * 1048576, touch: 32 * 1048576 });
  assert.deepEqual(A.WORKLET_BUDGET, { desktop: 192 * 1048576, touch: 128 * 1048576 });
  assert.deepEqual(Object.fromEntries(Object.entries(A.WORKERS).map(([k, w]) => [k, [w.url, w.type]])),
    { wt: ['wtwork.js' + V, 'module'], smp: ['smpwork.js' + V, 'module'], render: ['smprender.js' + V, 'classic'] });
  const { M } = rig();
  for (const k of ['ensure', 'entries', 'release', 'meter', 'drop', 'entry', 'build', 'source', 'gc', 'gcSoon', 'trim', 'update', 'list', 'embed', 'restore', 'wtMod', 'wtStore', 'smpStore',
    'ready', 'listSmp', 'saveRecord', 'relink', 'retry', 'cancelGen', 'record', 'embedSmps', 'restoreSmps']) assert.equal(typeof M[k], 'function', k);
  for (const k of ['needs', 'sent', 'pend', 'unref', 'bytes', 'user', 'saveT']) assert.ok(M[k] instanceof Map || M[k] instanceof Set, k);
  assert.deepEqual([M.rows, M.gcT, M.WT], [[], 0, null]);
  for (const k of ['list', 'get', 'saveNew', 'update', 'rename', 'noises', 'saveNoise', 'users', 'del']) assert.equal(typeof M.host.wt[k], 'function', 'host.wt.' + k);
  for (const k of ['list', 'import', 'overview', 'spectrogram', 'odf', 'record', 'pcm', 'rename', 'del', 'users', 'saveFrom', 'cancel', 'retry', 'usage']) assert.equal(typeof M.host.smp[k], 'function', 'host.smp.' + k);
  assert.deepEqual(['factory:Default', 'user:x', 'nzuser:y', 'noise:White', 'sub:Sine', 'fsmp:Glass Bell', 'smp:1', 'fmsmp:Juno Pad', 'msmp:2',
    'fir:Short/Small Room', 'ir:3@48000~ab', 'wtsmp:factory:Default', 'spec:smp:1~r', '', null].map(A.idKind),
  ['wt', 'wt', 'wt', 'wt', 'wt', 'smp', 'smp', 'multi', 'multi', 'ir', 'ir', 'wtsmp', 'spec', '', '']);
  assert.deepEqual(A.userIdsOf({ osc: [{ wt: 'user:a' }, { wt: 'factory:Default' }], noise: { src: 'nzuser:n' } }), ['user:a', 'nzuser:n'], 'Phase 1: OSC A, OSC B, noise');
  assert.deepEqual(A.userIdsOf({ osc: [{ wt: 'user:a', smp: 'user:d' }, { wt: 'factory:Default', smp: 'smp:1', spec: { filt: { kind: 'wt', wt: 'user:e' } } }, { wt: 'user:c' }], noise: { src: 'nzuser:n' } }),
    ['user:a', 'user:d', 'user:e', 'user:c', 'nzuser:n'], 'v2: OSC C, tables played as samples, spectral-filter tables (= serum-core tableNeeds)');
  assert.deepEqual(A.userIdsOf({ osc: [{ wt: 'user:a' }, { wt: 'user:a' }], noise: {} }), ['user:a'], 'each id once');
});

test('portPoster: the track\'s node, else the given node, else any node; false without nodes', () => {
  const nodes = new Map(), got = [];
  const mk = name => ({ port: { postMessage: (m, t) => got.push([name, m.t, t.length]) } });
  const post = A.portPoster(nodes);
  assert.equal(post({ t: 'x' }, [], 'a', null), false);
  assert.equal(post({ t: 'x' }, [], 'a', mk('given')), true);
  nodes.set('b', { node: mk('B') }); nodes.set('a', { node: mk('A') });
  post({ t: 'y' }, [new ArrayBuffer(1)], 'a', mk('given'));
  post({ t: 'z' }, undefined, 'none', null);
  post({ t: 'w' }, [], null, mk('given2'));
  assert.deepEqual(got, [['given', 'x', 0], ['A', 'y', 1], ['B', 'z', 0], ['given2', 'w', 0]]);
});

/* ------------------------------------------------------------------ posting (Phase 1 §7.5) */
test('ensure: each id posted once per context ({t: "wt", …entry} with its level buffers transferred), needs recorded', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const t1 = sxTrack('t1'); R.tracks.push(t1);
  const done = M.ensure(['factory:Default', 'noise:White'], { trackId: 't1' });
  assert.ok(done instanceof Promise);
  assert.deepEqual([...M.needs.get('t1')], ['factory:Default', 'noise:White']);
  await done;
  assert.deepEqual(R.wtPosts(), [['nt1', 'wt', 'factory:Default'], ['nt1', 'wt', 'noise:White']]);
  const p = R.posts[0];
  assert.equal(p.m.levels.length, 11);
  assert.deepEqual(new Set(p.tr), new Set(p.m.levels.map(l => l.data.buffer)));
  assert.equal(M.bytes.get('factory:Default'), A.levelBufs(wt.makeEntry('factory:Default', wt.factoryTable('factory:Default'))).reduce((a, b) => a + b.byteLength, 0));
  assert.ok(M.sent.has('factory:Default') && M.sent.has('noise:White') && M.pend.size === 0);
  await M.ensure(['factory:Default'], { trackId: 't1' });
  assert.equal(R.wtPosts().length, 2, 'not posted again');
  // a new node (not yet registered) receives what it needs through the given node; the manager is per context
  R.ctx = { n: 2 };
  const fresh = R.node('fresh');
  await M.ensure(['factory:Default'], { trackId: 't2', node: fresh });
  assert.deepEqual(R.wtPosts().slice(2), [['fresh', 'wt', 'factory:Default']], 'a new context re-posts');
  assert.equal(M.sent.size, 1, 'sent set reset with the context');
  // no context: the needs are kept, nothing is posted
  R.ctx = null;
  await M.ensure(['factory:Basic Shapes'], { trackId: 't3' });
  assert.deepEqual([R.wtPosts().length, M.needs.has('t3')], [3, true]);
  // unknown ids fail quietly (Phase 1: a warning), nothing posted
  R.ctx = { n: 2 };
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try { await M.ensure(['factory:Nope'], { trackId: 't1' }); } finally { console.warn = warn; }
  assert.equal(R.wtPosts().length, 3);
  assert.ok(!M.sent.has('factory:Nope'));
  assert.equal(warned, 0, 'a null entry is not an error (factoryTable returns null)');
});

test('ensure: a context change while an entry is being built drops it; a missing port posts nothing', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const p = M.ensure(['factory:Default'], { trackId: 't1' });
  R.ctx = { n: 9 };
  await p;
  assert.equal(R.wtPosts().length, 0);
  assert.ok(!M.sent.has('factory:Default'));
  const R2 = rig();
  await R2.M.ensure(['factory:Default'], { trackId: 't1' });
  assert.ok(!R2.M.sent.has('factory:Default') && R2.M.bytes.size === 0, 'no node: not marked sent');
});

/* ------------------------------------------------------------------ worker protocol (wtwork.js) */
function fakeWorker(mode) {
  const w = { posted: [], terminated: false, onmessage: null, onerror: null };
  w.postMessage = req => {
    w.posted.push(req);
    setImmediate(async () => {
      if (mode === 'error') { w.onerror && w.onerror({ preventDefault() {} }); return; }
      // the wtwork.js reply: {q, entry} or {q, err}
      const { q, id, table, rec } = req;
      let entry = null;
      if (table) entry = wt.makeEntry(id, table);
      else if (rec) entry = wt.noiseEntry(Object.assign({}, rec, { id }));
      else if (id.startsWith('noise:')) entry = wt.makeNoise(id);
      else { const t = wt.factoryTable(id); entry = t ? wt.makeEntry(id, t) : null; }
      w.onmessage({ data: entry ? { q, entry } : { q, err: 'unknown table ' + id } });
    });
  };
  w.terminate = () => { w.terminated = true; };
  return w;
}
test('build: entries come from the wt worker ({q, id, table?, rec?}); a worker error falls back to the main thread for good', async () => {
  const workers = [];
  const R = rig({ worker: kind => { assert.equal(kind, 'wt'); const w = fakeWorker('ok'); workers.push(w); return w; } });
  R.addNode('t1');
  await R.M.ensure(['factory:Default', 'factory:Basic Shapes'], { trackId: 't1' });
  assert.equal(workers.length, 1, 'one worker');
  assert.deepEqual(workers[0].posted.map(r => [r.q, r.id]), [[1, 'factory:Default'], [2, 'factory:Basic Shapes']]);
  assert.equal(R.wtPosts().length, 2);
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try { await R.M.ensure(['factory:Nope'], { trackId: 't1' }); } finally { console.warn = warn; }
  assert.equal(warned, 1, 'a worker error reply is logged (Phase 1)');
  // a failing worker: queued requests are rebuilt on the main thread, no worker from then on
  const R2 = rig({ worker: () => { const w = fakeWorker('error'); workers.push(w); return w; } });
  R2.addNode('t1');
  await R2.M.ensure(['factory:Default'], { trackId: 't1' });
  await flush();
  assert.ok(R2.M.wbad && workers[workers.length - 1].terminated);
  assert.deepEqual(R2.wtPosts(), [['nt1', 'wt', 'factory:Default']]);
  const n = workers.length;
  await R2.M.ensure(['factory:Basic Shapes'], { trackId: 't1' });
  assert.equal(workers.length, n, 'no new worker after a failure');
  // a factory that throws marks workers unusable
  const R3 = rig({ worker: () => { throw new Error('no module workers'); } });
  R3.addNode('t1');
  await R3.M.ensure(['factory:Default'], { trackId: 't1' });
  assert.ok(R3.M.wbad && R3.wtPosts().length === 1);
});

/* ------------------------------------------------------------------ GC and budget */
test('gc: an id no track needs is freed ({t: "wtdel"}) after 10 s; used ids stay; release re-arms the GC', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  R.tracks.push(sxTrack('t1'));
  await M.ensure(['factory:Default', 'factory:Basic Shapes'], { trackId: 't1' });
  assert.ok(M.gcT, 'GC armed by ensure');
  R.runTimers(2500);
  assert.equal(R.posts.filter(p => p.m.t === 'wtdel').length, 0, 'both used');
  M.ensure(['factory:Default'], { trackId: 't1' });
  await flush();
  R.runTimers(2500); // first pass: Basic Shapes unreferenced since now
  R.runTimers(2500); R.runTimers(2500); R.runTimers(2500);
  assert.equal(R.posts.filter(p => p.m.t === 'wtdel').length, 0, 'not before 10 s');
  R.runTimers(2500);
  assert.deepEqual(R.posts.filter(p => p.m.t === 'wtdel').map(p => p.m.id), ['factory:Basic Shapes']);
  assert.ok(!M.sent.has('factory:Basic Shapes') && M.sent.has('factory:Default'));
  M.release('t1');
  assert.ok(!M.needs.has('t1') && M.gcT, 'release drops the needs and arms the GC');
  R.runTimers(2500); R.runTimers(10000); R.runTimers(2500);
  assert.deepEqual(R.posts.filter(p => p.m.t === 'wtdel').map(p => p.m.id), ['factory:Basic Shapes', 'factory:Default']);
  // drop = release (Phase-1 name)
  M.needs.set('t9', ['x']);
  M.drop('t9');
  assert.ok(!M.needs.has('t9'));
});

test('trim: above keepBytes the longest-unreferenced entries go at once (never the one just posted)', async () => {
  const one = A.levelBufs(wt.makeEntry('factory:Default', wt.factoryTable('factory:Default'))).reduce((a, b) => a + b.byteLength, 0);
  const R = rig({ keepBytes: 2.5 * one }), { M } = R;
  R.addNode('t1');
  R.tracks.push(sxTrack('t1'));
  await M.ensure(['factory:Default'], { trackId: 't1' });
  await M.ensure(['factory:Basic Shapes'], { trackId: 't1' }); // Default unreferenced now (t1 needs only Basic Shapes)
  await M.ensure(['factory:Default'], { trackId: 't1' });
  assert.equal(R.posts.filter(p => p.m.t === 'wtdel').length, 0, 'within the budget');
  const ids = wt.FACTORY_TABLES.map(t => t.id).filter(id => id !== 'factory:Default' && id !== 'factory:Basic Shapes').slice(0, 3);
  for (const id of ids) await M.ensure([id], { trackId: 't1' });
  const freed = R.posts.filter(p => p.m.t === 'wtdel').map(p => p.m.id);
  assert.ok(freed.length >= 1 && !freed.includes(ids[ids.length - 1]) && !freed.includes(ids[ids.length - 1]), 'freed: ' + freed);
  let idle = 0;
  for (const id of M.sent) if (id !== ids[ids.length - 1]) idle += M.bytes.get(id);
  assert.ok(idle <= 2.5 * one, 'unreferenced bytes back under the budget');
  const m = M.meter();
  assert.deepEqual(m, { bytes: M.bytes.get(ids[ids.length - 1]), budget: A.WORKLET_BUDGET.desktop }, 'meter: referenced entries');
  assert.equal(rig({ touch: true }).M.meter().budget, A.WORKLET_BUDGET.touch);
});

/* ------------------------------------------------------------------ live edits, store, files (host.wt) */
test('host.wt: saveNew / list / get / rename / update (frames → wtf, else whole entry; saved after 0.5 s) / users / del', async () => {
  const R = rig(), { M } = R, H = M.host.wt;
  R.addNode('t1');
  assert.deepEqual(H.list(), [], 'wt.js not loaded yet: no factory rows (Phase 1)');
  await M.wtMod();
  assert.equal(M.WT, wt);
  assert.equal(H.list().length, wt.FACTORY_TABLES.length);
  const sine = new Float32Array(2048).map((x, i) => Math.sin(2 * Math.PI * i / 2048));
  const id = await H.saveNew({ name: 'Mine', frames: [sine, sine.map(x => x * 0.5)], morph: 1 }, 'Mine');
  assert.match(id, /^user:/);
  await flush();
  assert.deepEqual(R.wtPosts(), [['nt1', 'wt', id]], 'a new table is posted to the running context');
  assert.ok(H.list().some(r => r.id === id && r.user && r.cat === 'User') && R.refreshes.length >= 1);
  const t = await H.get(id);
  assert.equal(t.frames.length, 2);
  assert.ok((await H.get('factory:Default')).frames.length >= 1);
  await H.rename(id, 'Renamed');
  assert.equal((await R.st.get(id)).name, 'Renamed');
  // frame edit of a sent table: {t: 'wtf'} per changed frame
  t.frames[1] = t.frames[1].map(x => x * 0.25);
  H.update(id, t, { frames: [1, 7] });
  assert.deepEqual(R.wtPosts().slice(1), [['nt1', 'wtf', id, 1]]);
  assert.equal(R.posts[R.posts.length - 1].m.levels.length, 11);
  // whole re-post for a morph ≥ 2 partial table
  H.update(id, Object.assign({}, t, { morph: 2 }), { frames: [1] });
  await flush();
  assert.deepEqual(R.wtPosts().slice(2), [['nt1', 'wt', id]]);
  // saved after 0.5 s of quiet
  assert.equal(R.pending.size >= 1, true);
  R.runTimers(500);
  await flush();
  assert.equal((await R.st.get(id)).morph, 2);
  // noises
  const nid = await H.saveNoise({ kind: 'noise', name: 'Kick', rate: 48000, ch: 1, root: 60, len: 4800, loopStart: 0, loopEnd: 4800, oneshot: 1, L: new Float32Array(4800).fill(0.1), R: null }, 'Kick');
  await M.list();
  assert.ok(H.noises().some(r => r.id === nid && r.oneshot === 1 && r.user));
  assert.ok((await H.get(nid)).L);
  // users / del: the sounds switch to the defaults, the store forgets, the menus refresh
  const t1 = sxTrack('t1', { osc: [{ wt: id }, { wt: 'factory:Default' }], noise: { src: nid, oneshot: 1 } }), t2 = sxTrack('t2');
  R.tracks.push(t1, t2);
  assert.deepEqual(H.users(id), ['Track t1']);
  assert.equal(await H.del('factory:Default'), false);
  assert.equal(await H.del(id), true);
  assert.equal(await H.del(nid), true);
  assert.deepEqual([t1.vals.s.osc[0].wt, t1.vals.s.noise.src, t1.vals.s.noise.oneshot], ['factory:Default', 'noise:White', 0]);
  assert.deepEqual(R.edits, [['t1', 'Delete wavetable'], ['t1', 'Delete wavetable']]);
  assert.equal(await R.st.get(id), null);
  assert.ok(!H.list().some(r => r.id === id));
});

test('embed / restore: user tables and noises travel in files (encodeEmbedded) and come back into the store', async () => {
  const R = rig(), { M } = R;
  const id = await M.host.wt.saveNew({ name: 'Mine', frames: [new Float32Array(2048).fill(0.5)], morph: 0 }, 'Mine');
  const nid = await M.host.wt.saveNoise({ kind: 'noise', name: 'Hiss', rate: 44100, ch: 2, root: 60, len: 100, loopStart: 0, loopEnd: 100, L: new Float32Array(100).fill(0.2), R: new Float32Array(100).fill(-0.2) }, 'Hiss');
  const out = await M.embed([id, nid, 'user:missing']);
  assert.deepEqual(Object.keys(out).sort(), [id, nid].sort());
  assert.equal(out[id].frames, 1);
  const R2 = rig();
  await R2.M.restore(JSON.parse(JSON.stringify(Object.assign({ 'evil:x': {}, 'user:../../x': {} }, out))));
  const back = await R2.st.get(id), nb = await R2.st.get(nid);
  assert.ok(back && back.frames.length === 1 && Math.abs(back.frames[0][7] - 0.5) < 1e-7);
  assert.ok(nb && nb.ch === 2 && nb.rate === 44100);
  assert.deepEqual((await R2.st.list()).map(r => r.id).sort(), [id, nid].sort(), 'only valid user ids restored');
  assert.ok(R2.M.rows.length === 2, 'rows refreshed');
});

/* ------------------------------------------------------------------ v2 entry points: the lazy surface */
test('entries(ids, rate) for processorOptions; host.smp answers before its modules are loaded; smpStore loads', async () => {
  const R = rig(), { M } = R;
  const es = await M.entries(['factory:Default', 'factory:Nope', 'noise:White'], 44100);
  assert.deepEqual(es.map(e => e.id), ['factory:Default', 'noise:White']);
  const S = M.host.smp;
  assert.equal(M.WT, wt, 'building entries on the main thread loaded wt.js');
  const rows = S.list('sample');
  assert.equal(rows.length, wt.FACTORY_TABLES.length);
  assert.ok(rows.every(r => r.cat.startsWith('Wavetables/') && 'seconds' in r && 'ch' in r && 'folder' in r));
  assert.deepEqual([S.list('multi'), S.list('ir')], [[], []]);
  assert.equal(await S.import([], { kind: 'sample', osc: 0 }), null);
  const ov = await S.overview('fsmp:Glass Bell', 16);
  assert.ok(ov instanceof Float32Array && ov.length === 32);
  const sp = await S.spectrogram('fsmp:Glass Bell', 8, 4);
  assert.ok(sp.w === 8 && sp.h === 4 && sp.data instanceof Uint8ClampedArray && sp.data.length === 32);
  assert.ok((await S.odf('x')) instanceof Float32Array);
  assert.deepEqual([await S.del('smp:x'), S.users('smp:x'), await S.saveFrom(0, 'sample')], [false, [], null]);
  const st = await M.smpStore();
  const sid = await st.put({ kind: 'smp', name: 'Kick', rate: 48000, ch: 1, L: new Float32Array(10).fill(0.5), root: 48 }, {});
  const rec = await S.record(sid);
  assert.ok(rec && rec.root === 48 && !('L' in rec) && !('R' in rec), 'record without PCM');
  const pcm = await S.pcm(sid);
  assert.ok(pcm.rate === 48000 && pcm.ch === 1 && pcm.L instanceof Float32Array && pcm.L[3] === 0.5 && pcm.R === null);
  await S.rename(sid, 'Kick 2');
  assert.equal((await st.get(sid)).name, 'Kick 2');
  assert.deepEqual([await S.record('noise:White'), await S.pcm('user:x'), await S.record('smp:none')], [null, null, null]);
});

test('defaults: browser stores and loaders are lazy (nothing is loaded or opened until first used)', async () => {
  let n = 0;
  const M = A.createAssetManager({ wt: () => { n++; return Promise.resolve(wt); }, stores: { wt: () => { n++; return wtstore.memoryStore(); } } });
  assert.equal(n, 0);
  await M.ensure(['factory:Default']); // no context: nothing built
  assert.equal(n, 0);
  await M.wtMod(); await M.wtMod();
  await M.wtStore(); await M.wtStore();
  assert.equal(n, 2, 'each loaded once');
  // a failed wt.js load is retried (Phase 1)
  let k = 0;
  const M2 = A.createAssetManager({ wt: () => (++k === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(wt)) });
  await assert.rejects(M2.wtMod(), /offline/);
  await flush();
  assert.equal(await M2.wtMod(), wt);
});

test('work(op, req): smpwork requests through the module worker, else the same handler on the main thread', async () => {
  const work = await imp('smpwork.js');
  const zones = [{ lo: 0, hi: 127, vlo: 0, vhi: 127, root: 60, tune: 0, gain: 0, pan: 0, smp: 'smp:a', mode: 'oneshot', ls: 0, le: 0, off: 0, env: null, rr: [1, 1], vt: 1 }];
  // no workers: main thread
  const R = rig({ worker: () => null });
  const a = await R.M.work('multi', { id: 'msmp:k', rec: { kind: 'multi', zones } });
  assert.ok(a.ok && a.entry.kind === 'multi' && a.entry.zones.length === 1 && Number.isInteger(a.q));
  assert.deepEqual([(await R.M.work('nope', {})).ok], [false]);
  // a worker running smpwork's handler (structured-clone stand-in: the request object itself)
  const made = [];
  const smpWorker = mode => {
    const w = { posted: [], onmessage: null, onerror: null, terminated: false, terminate() { this.terminated = true; } };
    w.postMessage = (m, tr) => { w.posted.push([m, tr]); setImmediate(() => (mode === 'die' ? w.onerror({ preventDefault() {} }) : work.handle(m).then(r => w.onmessage({ data: r.msg })))); };
    made.push(w);
    return w;
  };
  const R2 = rig({ worker: kind => (kind === 'smp' ? smpWorker('ok') : null) });
  const buf = new Float32Array(8).buffer;
  const [b, c] = await Promise.all([R2.M.work('multi', { id: 'msmp:1', rec: { kind: 'multi', zones } }, [buf]), R2.M.work('gen', { id: 'fsmp:Nope' })]);
  assert.ok(b.ok && b.entry.id === 'msmp:1' && c.ok && c.rec === null);
  assert.equal(made.length, 1, 'one worker');
  assert.deepEqual(made[0].posted.map(([m, tr]) => [m.op, tr.length]), [['multi', 1], ['gen', 0]], 'transfer list passed on');
  // a dying worker: its requests fail, later ones run on the main thread
  const R3 = rig({ worker: kind => (kind === 'smp' ? smpWorker('die') : null) });
  const d = await R3.M.work('multi', { id: 'msmp:2', rec: { kind: 'multi', zones } });
  assert.deepEqual([d.ok, d.code], [false, 'EWORKER']);
  const e = await R3.M.work('multi', { id: 'msmp:3', rec: { kind: 'multi', zones } });
  assert.ok(e.ok && e.entry.id === 'msmp:3' && made[made.length - 1].terminated);
});

test('render(req): render-farm requests to the classic worker by q; failures answer {ok: false}', async () => {
  const R = rig({ worker: () => null });
  assert.deepEqual(await R.M.render({ id: 'x' }), { q: 1, ok: false, err: 'workers unavailable' });
  const ws = [];
  const farmWorker = die => {
    const w = { posted: [], onmessage: null, onerror: null, terminate() { this.terminated = true; } };
    w.postMessage = m => { w.posted.push(m); setImmediate(() => (die ? w.onerror({ preventDefault() {} }) : w.onmessage({ data: { q: m.q, ok: true, L: new Float32Array(4), R: new Float32Array(4) } }))); };
    ws.push(w);
    return w;
  };
  const R2 = rig({ worker: kind => (assert.equal(kind, 'render'), farmWorker(false)) });
  const [a, b] = await Promise.all([R2.M.render({ id: 'a', frames: 4 }), R2.M.render({ id: 'b', frames: 4 })]);
  assert.deepEqual([a.ok, b.ok, a.q !== b.q, ws.length, ws[0].posted.map(m => m.id)], [true, true, true, 1, ['a', 'b']]);
  const R3 = rig({ worker: () => farmWorker(true) });
  const c = await R3.M.render({ id: 'c' });
  assert.deepEqual([c.ok, c.err], [false, 'render farm failed']);
  const d = R3.M.render({ id: 'd' });
  assert.equal(ws.length, 3, 'a new worker after a failure');
  assert.equal((await d).ok, false);
});

/* ------------------------------------------------------------------ v2 entry points (§9.5, §9.6, §11.15) */
const core = await imp('serum-core.js');
const models = await imp('models.js');
const smp = await imp('smp.js');
const gen = await imp('smpgen.js');
const SxBase = (() => { const S = dspScope({ files: ['sx-base.js'] }); return S.global('SxBase'); })();
const valid = e => { const ok = SxBase.storeAsset(e.id, e); if (ok) SxBase.dropAsset(e.id); return ok; };
const sine = (n, f, rate, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / rate));
const noise = (n, seed, decay = 0) => { const r = wt.mulberry32(seed); return Float32Array.from({ length: n }, (_, i) => (2 * r() - 1) * (decay ? Math.exp(-i / decay) : 0.5)); };
const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const valsOf = id => { const m = models.MODELS.find(x => x.id === id), v = {}; for (const c of m.controls) v[c.id] = c.def; return v; };
// a render-farm "worker": smprender.js in a vm scope (the same scope as tests/smpgen.test.mjs), answering asynchronously
function farmWorker(log) {
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, location: { search: V } });
  g.self = g;
  g.importScripts = (...urls) => { for (const u of urls) { const f = u.slice(0, -V.length); vm.runInContext(readFileSync(new URL(f, ROOT), 'utf8'), g, { filename: 'farm/' + f }); } };
  const w = { onmessage: null, onerror: null, terminate() { this.dead = true; } };
  g.postMessage = m => setImmediate(() => w.onmessage && w.onmessage({ data: m }));
  vm.runInContext(readFileSync(new URL('smprender.js', ROOT), 'utf8'), g, { filename: 'smprender.js' });
  w.postMessage = m => { if (log) log.push(m.id); setImmediate(() => g.onmessage({ data: m })); };
  return w;
}
// a Serum state and FX rack using a sample (with trim / fade), a wavetable as a Spectral source, a multisample and a
// Convolve IR; its needs as compileSerum / compileFx emit them
function sxState(sid, mid, iid) {
  const s = core.defaultSerum();
  s.osc[0].type = 'sample'; s.osc[0].smp = sid; s.osc[0].smpo.ops = { trim: [0.1, 0.9], fade: 2, norm: 0, rev: 0 };
  s.osc[1].type = 'spec'; s.osc[1].smp = 'factory:Basic Shapes'; s.p['b.on'] = 1;
  s.osc[2].type = 'multi'; s.osc[2].multi = mid; s.p['c.on'] = 1;
  const fx = core.defaultFx2(), cid = core.newInstance(fx, 'conv', { rack: 0 });
  fx.racks[0].mods.find(I => I.id === cid).sub.ir = iid;
  return { s, fx, conv: fx.racks[0].mods.find(I => I.id === cid) };
}
const needsOf = (s, fx, sr = 48000) => models.patchFor('serum', { s }, fx, { sr }).needs;
// user assets in the manager's store: a stereo sample, a 96 kHz zone sample + multisample, a stereo IR
async function userAssets(M) {
  const sid = await M.saveRecord({ kind: 'smp', name: 'Tone', rate: 44100, ch: 2, len: 22050, L: sine(22050, 220, 44100), R: sine(22050, 330, 44100), root: 57, loop: { start: 1000, end: 20000 } }, { name: 'Tone' });
  const zid = await M.saveRecord({ kind: 'smp', name: 'Zone', rate: 96000, ch: 1, len: 19200, L: sine(19200, 440, 96000), R: null, root: 69, loop: null });
  const mid = await (await M.smpStore()).put({ kind: 'multi', name: 'Keys', zones: [{ lo: 0, hi: 72, vlo: 0, vhi: 127, root: 69, smp: zid, mode: 'loop', ls: 960, le: 19200 }] }, {});
  const iid = await M.saveRecord({ kind: 'ir', name: 'Room', rate: 44100, ch: 2, len: 9000, L: noise(9000, 1, 2000), R: noise(9000, 2, 2000) }, { name: 'Room' });
  return { sid, zid, mid, iid };
}

test('ensure: §9 entries for the ids compileSerum / compileFx emit — {t: "smp", …entry} once per context, buffers transferred, zone samples first', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const { sid, zid, mid, iid } = await userAssets(M);
  assert.match(sid, /^smp:[0-9a-f]{16}$/);
  assert.match(iid, /^ir:[0-9a-f]{16}$/);
  const { s, fx, conv } = sxState(sid, mid, iid), needs = needsOf(s, fx);
  const key = A.opsKeyOf(s.osc[0].smpo.ops), shape = A.convKeyOf(conv.p);
  assert.equal(key, core.opsKey(s.osc[0].smpo.ops), 'opsKey ≡ serum-core');
  assert.deepEqual(needs, [sid + '~' + key, 'spec:wtsmp:factory:Basic Shapes', mid, iid + '@48000~' + shape], 'shapeKey ≡ fx-core');
  assert.deepEqual(A.parseIrId(needs[3]), { ir: iid, rate: 48000, key: shape });
  await M.ensure(needs, { trackId: 't1', s, fx });
  const got = R.posts.filter(p => p.m.t === 'smp');
  assert.deepEqual(got.map(p => p.m.id).sort(), [needs[0], needs[1], zid, mid, needs[3]].sort());
  assert.ok(got.findIndex(p => p.m.id === zid) < got.findIndex(p => p.m.id === mid), 'the zone sample before its multisample');
  for (const p of got) {
    assert.equal(p.node, 'nt1');
    assert.ok(valid(Object.assign({}, p.m)), p.m.id + ' validates in SxBase');
    assert.deepEqual(new Set(p.tr), A.entryBufs(p.m), p.m.id + ': every buffer transferred');
  }
  const by = id => got.find(p => p.m.id === id).m;
  assert.deepEqual([by(needs[0]).rate, by(needs[0]).len, by(needs[0]).ch], [44100, Math.round(0.9 * 22050) - Math.round(0.1 * 22050), 2], 'trim baked');
  assert.ok(Math.abs(by(needs[1]).root - smp.WT_ROOT) < 1e-12 && by(needs[1]).kind === 'spec', 'spectral entry of the table with its root');
  assert.deepEqual([by(zid).rate, by(zid).len, by(mid).zones[0].ls, by(mid).zones[0].le], [48000, 9600, 480, 9600], '96 kHz zone sample: entry at 48 kHz, zone frames scaled');
  assert.equal(by(zid).levels.length, Math.ceil(Math.log2(Math.pow(2, (72 - 69 + 12) / 12) * 48000 / 44100)) + 1, '§9.4.3 zone levels');
  assert.equal(by(needs[3]).rate, 48000);
  const n = R.posts.length;
  await M.ensure(needs, { trackId: 't1', s, fx });
  assert.equal(R.posts.length, n, 'nothing posted twice');
  assert.deepEqual(M.meter(), { bytes: got.reduce((a, p) => a + p.m.bytes, 0), budget: A.WORKLET_BUDGET.desktop });
  assert.deepEqual(M.host.smp.usage(), M.meter());
  R.ctx = { n: 2 };
  await M.ensure(needs, { trackId: 't1', s, fx });
  assert.equal(R.posts.filter(p => p.m.t === 'smp' && p.ctx === 2).length, 5, 'a new context gets every entry again');
});

test('ensure: a superseded `~opsKey` / `~shapeKey` variant is dropped right after the patch that replaced it is posted (unless another track plays it)', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1'); R.addNode('t2');
  const { sid, mid, iid } = await userAssets(M);
  const A1 = sxState(sid, mid, iid);
  await M.ensure(needsOf(A1.s, A1.fx), { trackId: 't1', s: A1.s, fx: A1.fx });
  const old = needsOf(A1.s, A1.fx);
  // edit: other trim, other Convolve size → new ids; main.js posts the patch right after ensure()
  A1.s.osc[0].smpo.ops = { trim: [0.2, 0.8], fade: 2, norm: 0, rev: 0 };
  A1.conv.p.size = 0.75;
  const now = needsOf(A1.s, A1.fx);
  assert.ok(now[0] !== old[0] && now[3] !== old[3] && now[1] === old[1] && now[2] === old[2]);
  assert.ok(M.ready(old), 'nothing pending');
  const pend = M.ensure(now, { trackId: 't1', s: A1.s, fx: A1.fx });
  assert.equal(M.ready(now), false, 'replacements of posted variants under way: the patch waits for ensure()');
  assert.ok(M.ready([old[1], old[2]]), 'a patch without them can go at once');
  // (main.js: the patch is posted when ensure() resolves) — until then the old variants stay in the worklet
  await flush(1);
  assert.ok(M.sent.has(old[0]) && M.sent.has(old[3]), 'the old variants keep playing while the new ones are built');
  await pend;
  assert.ok(M.ready(now));
  assert.ok(M.sent.has(now[0]) && M.sent.has(now[3]) && M.sent.has(old[0]), 'replacement posted; the old one not yet freed');
  R.posts.push({ node: 'nt1', m: { t: 'patch' }, tr: [] });
  R.runTimers(0);
  const seq = R.posts.map(p => p.m.t + ' ' + (p.m.id || ''));
  const n0 = seq.indexOf('smp ' + now[0]), pi = seq.indexOf('patch '), d0 = seq.indexOf('smpdel ' + old[0]), d3 = seq.indexOf('smpdel ' + old[3]);
  assert.ok(n0 >= 0 && n0 < pi && pi >= 0 && d0 > pi && d3 > pi, 'new entry, then the patch, then the old one dropped: ' + JSON.stringify(seq.slice(n0)));
  assert.ok(M.sent.has(now[0]) && M.sent.has(now[3]) && !M.sent.has(old[0]) && !M.sent.has(old[3]));
  assert.ok(!seq.includes('smpdel ' + old[1]), 'unchanged ids stay');
  // a variant another track still plays is kept
  await M.ensure(now, { trackId: 't2', s: A1.s, fx: A1.fx });
  A1.s.osc[0].smpo.ops = { trim: null, fade: 0, norm: 0, rev: 0 };
  const third = needsOf(A1.s, A1.fx);
  assert.equal(third[0], sid, 'neutral ops: the plain sample id');
  await M.ensure(third, { trackId: 't1', s: A1.s, fx: A1.fx });
  R.runTimers(0);
  assert.ok(M.sent.has(now[0]) && !R.posts.some(p => p.m.t === 'smpdel' && p.m.id === now[0]), 't2 still plays ' + now[0]);
  // a variant superseded while it was being built is never posted
  A1.s.osc[0].smpo.ops = { trim: [0.3, 0.6], fade: 0, norm: 0, rev: 0 };
  const v1 = needsOf(A1.s, A1.fx);
  const p1 = M.ensure(v1, { trackId: 't1', s: A1.s, fx: A1.fx });
  A1.s.osc[0].smpo.ops = { trim: [0.3, 0.7], fade: 0, norm: 0, rev: 0 };
  const v2 = needsOf(A1.s, A1.fx);
  await Promise.all([p1, M.ensure(v2, { trackId: 't1', s: A1.s, fx: A1.fx })]);
  R.runTimers(0);
  assert.ok(!M.sent.has(v1[0]) && M.sent.has(v2[0]), 'the intermediate variant is gone');
  assert.ok(!M.sent.has(third[0]), 'the variant before it went once the new one was posted');
});

test('preview: the preview node\'s needs go through the manager (shared ids not re-posted, new ones to its node), released like a track', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const { sid, mid, iid } = await userAssets(M);
  const A1 = sxState(sid, mid, iid), needs = needsOf(A1.s, A1.fx);
  await M.ensure(needs, { trackId: 't1', s: A1.s, fx: A1.fx });
  const pv = R.node('preview'), n = R.posts.length;
  const s2 = core.defaultSerum();
  s2.osc[0].type = 'sample'; s2.osc[0].smp = sid; // the plain sample: a new id; the multisample is shared
  s2.osc[2].type = 'multi'; s2.osc[2].multi = mid; s2.p['c.on'] = 1;
  const pn = needsOf(s2, core.defaultFx2());
  await M.ensure(pn, { trackId: 'preview', node: pv, s: s2 });
  const fresh = R.posts.slice(n).filter(p => p.m.t === 'smp');
  assert.deepEqual(fresh.map(p => [p.node, p.m.id]), [['preview', sid]], 'only the id not yet sent, to the preview node');
  M.release('preview');
  R.runTimers(2500); R.runTimers(2500); R.runTimers(10000); R.runTimers(2500);
  assert.ok(R.posts.some(p => p.m.t === 'smpdel' && p.m.id === sid) && M.sent.has(mid), 'the preview\'s own id freed after 10 s; shared ones stay');
});

test('§14.2 / §9.3: the asset meter refuses imports and selections over the device budget; storage persistence requested once', async () => {
  const notes = [];
  let asked = 0;
  const R = rig({ budget: 200000, notify: t => notes.push(t), persist: () => { asked++; return Promise.resolve(false); } }), { M } = R, S = M.host.smp;
  R.addNode('t1');
  const small = wavFile({ rate: 8000, ch: [sine(8000, 300, 8000)] }), big = wavFile({ rate: 48000, ch: [sine(48000, 300, 48000), sine(48000, 200, 48000)] });
  const a = await S.import([file('Small C3.wav', small)], { kind: 'sample', osc: 0 });
  assert.match(a, /^smp:/);
  assert.equal(await S.import([file('Big.wav', big)], { kind: 'sample', osc: 0 }), null, 'over the budget');
  assert.ok(notes.includes(A.TEXT.memory));
  assert.equal((await (await M.smpStore()).list()).length, 1, 'nothing stored');
  assert.equal(asked, 1, 'navigator.storage.persist() once per session');
  assert.equal(notes.filter(t => t === A.TEXT.persist).length, 1, 'a refusal is announced once');
  // a selection (e.g. a factory sound) whose entry would exceed the budget is not posted
  const gid = await M.saveRecord({ kind: 'smp', name: 'Long', rate: 48000, ch: 2, len: 30000, L: sine(30000, 100, 48000), R: sine(30000, 150, 48000), root: 60 });
  notes.length = 0;
  await M.ensure([a], { trackId: 't1' });
  await M.ensure([a, gid], { trackId: 't1' });
  assert.ok(M.sent.has(a) && !M.sent.has(gid) && notes.filter(t => t === A.TEXT.memory).length === 1);
  await M.ensure([a, gid], { trackId: 't1' });
  assert.equal(notes.filter(t => t === A.TEXT.memory).length, 1, 'announced once per id');
  assert.ok(M.meter().bytes <= 200000);
  // an SFZ counts all its zone samples: refused as a whole once they add up beyond the budget (one notice)
  notes.length = 0;
  const z = n => wavFile({ rate: 48000, ch: [sine(n, 300, 48000)] });
  const kit = await S.import([file('Kit.sfz', new TextEncoder().encode('<region> sample=a.wav key=60\n<region> sample=b.wav key=62\n<region> sample=c.wav key=64')),
    file('a.wav', z(8000)), file('b.wav', z(8001)), file('c.wav', z(8002))], { kind: 'multi' });
  assert.deepEqual([kit, notes.filter(t => t === A.TEXT.memory).length], [null, 1]);
  // a full store: the import fails cleanly with the storage notice
  const qn = [], Q = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => smpstore.memoryStore({ quota: 1000 }) }, notify: t => qn.push(t), persist: () => Promise.resolve(true) });
  assert.equal(await Q.M.host.smp.import([file('Small C3.wav', small)], { kind: 'sample' }), null);
  assert.deepEqual(qn, [smpstore.QUOTA_TEXT]);
});

test('§9.3 import: WAV / AIFF / other audio, roots and loops, > 96 kHz, length caps, dedupe, ZIP, SFZ multisamples, IRs, relink', async () => {
  const notes = [], decoded = [];
  const R = rig({ notify: t => notes.push(t), persist: () => Promise.resolve(true), decode: async b => { decoded.push(b.byteLength); return { rate: 44100, ch: 1, L: sine(4410, 100 * decoded.length, 44100), R: null }; }, inflate: async raw => raw.subarray(1) }), { M } = R, S = M.host.smp;
  const st = await M.smpStore(), get = id => st.get(id);
  // file-name root wins over smpl; smpl loop (end + 1)
  const w1 = wavFile({ rate: 44100, ch: [sine(4410, 100, 44100), sine(4410, 150, 44100)], extra: [['smpl', smplChunk(57, 0x80000000, [100, 3999])]] });
  const id1 = await S.import([file('Bass F2.wav', w1)], { kind: 'sample', osc: 0 });
  const r1 = await get(id1);
  assert.deepEqual([r1.kind, r1.name, r1.rate, r1.ch, r1.len, r1.root, r1.loop, r1.folder, r1.src.file, r1.src.type], ['smp', 'Bass F2', 44100, 2, 4410, 53, { start: 100, end: 4000 }, '', 'Bass F2.wav', 'wav']);
  assert.ok(r1.odf instanceof ArrayBuffer && r1.odf.byteLength === 4 * Math.ceil(4410 / 256), 'onset function stored');
  assert.equal(r1.hash, smp.assetHash(new Float32Array(r1.L), new Float32Array(r1.R)));
  assert.equal(id1, 'smp:' + r1.hash, 'content-addressed id');
  const id1b = await S.import([file('Bass F2 copy.wav', w1)], { kind: 'sample' });
  assert.equal(id1b, id1, 'identical PCM: the existing id');
  const plain = wavFile({ rate: 44100, ch: [sine(4410, 120, 44100)], extra: [['smpl', smplChunk(57, 0x80000000, null)]] });
  assert.equal((await get(await S.import([file('Tone.wav', plain)], {}))).root, 57.5, 'smpl root without a name note');
  // AIFF with INST; > 96 kHz → 96 kHz with the loop scaled
  const ai = await get(await S.import([file('Pad.aif', aiffFile({ rate: 48000, ch: [sine(4800, 200, 48000)], bits: 24, inst: { base: 50, mode: 1, begin: 1, end: 2 }, marks: [[1, 100, 'a'], [2, 4000, 'b']] }))], {}));
  assert.deepEqual([ai.root, ai.loop, ai.rate, ai.src.type], [50, { start: 100, end: 4000 }, 48000, 'aiff']);
  const hi = await get(await S.import([file('Air.wav', wavFile({ rate: 192000, ch: [sine(19200, 1000, 192000)], extra: [['smpl', smplChunk(60, 0, [1920, 9599])]] }))], {}));
  assert.deepEqual([hi.rate, hi.len, hi.loop], [96000, 9600, { start: 960, end: 4800 }]);
  // other audio through the decoder (canonical 48 kHz context), caps with a notice
  const og = new Uint8Array(64); og.set([0x4f, 0x67, 0x67, 0x53]);
  assert.equal((await get(await S.import([file('Loop.ogg', og)], {}))).rate, 44100);
  assert.deepEqual(decoded, [64]);
  const adpcm = wavFile({ rate: 8000, ch: [sine(800, 50, 8000)], extra: [['smpl', smplChunk(40, 0, null)]] });
  adpcm[20] = 2; // an encoding wt.readWav does not read: the browser's decoder, the smpl root kept
  const ad = await get(await S.import([file('Odd.wav', adpcm)], {}));
  assert.deepEqual([ad.rate, ad.root, decoded.length], [44100, 40, 2]);
  const long = await get(await S.import([file('Long.wav', wavFile({ rate: 8000, ch: [noise(61 * 8000, 5)] }))], {}));
  assert.ok(long.len === 60 * 8000 && notes.includes(A.TEXT.truncated + ': Long.wav'), '60 s cap');
  assert.equal(await S.import([file('notes.txt', new TextEncoder().encode('hello'))], {}), null);
  assert.ok(notes.includes(A.TEXT.unsupported + ': notes.txt'));
  // ZIP: stored and deflated (stub inflater) entries; every audio file imports
  const z1 = wavFile({ rate: 22050, ch: [sine(2205, 300, 22050)] }), z2 = wavFile({ rate: 22050, ch: [sine(2205, 400, 22050)] });
  const zip = zipFile([{ name: 'pack/One.wav', data: z1 }, { name: 'pack/Two.wav', data: z2, method: 8, raw: Uint8Array.from([0, ...z2]) }, { name: '__MACOSX/pack/._One.wav', data: z1 }]);
  const zid = await S.import([file('pack.zip', zip)], {});
  assert.equal((await get(zid)).name, 'One');
  assert.ok((await st.list({ kind: 'smp' })).some(r => r.name === 'Two'), 'the deflated entry too');
  // SFZ with its samples (as separate files): a multisample of user zone samples
  const sfz = '<group> loop_mode=loop_continuous amp_veltrack=50\n<region> sample=samples/one.wav lokey=0 hikey=59 pitch_keycenter=c4\n<region> sample=Two.wav lokey=60 hikey=127 pitch_keycenter=72 loop_mode=no_loop';
  const k1 = wavFile({ rate: 22050, ch: [sine(2205, 500, 22050)] }), k2 = wavFile({ rate: 22050, ch: [sine(2205, 600, 22050)] });
  const mid = await S.import([file('kit/Kit.sfz', new TextEncoder().encode(sfz)), file('kit/samples/One.wav', k1), file('elsewhere/two.WAV', k2)], { kind: 'multi', osc: 2 });
  assert.match(mid, /^msmp:/);
  const m = await get(mid);
  assert.deepEqual(m.zones.map(z => [z.lo, z.hi, z.root, z.mode, z.ls, z.le, z.vt]), [[0, 59, 60, 'loop', 0, 2205, 0.5], [60, 127, 72, 'oneshot', 0, 2205, 0.5]]);
  assert.ok(m.zones.every(z => /^smp:/.test(z.smp)) && m.src.sfz === sfz);
  assert.equal((await get(m.zones[1].smp)).root, 72, 'zone sample root = pitch_keycenter');
  // a ZIP holding an .sfz imports it with its samples
  const kz = zipFile([{ name: 'Kit/Kit.sfz', data: new TextEncoder().encode('<region> sample=One.wav key=60') }, { name: 'Kit/One.wav', data: z1 }]);
  const kid = await S.import([file('Kit.zip', kz)], { kind: 'multi' });
  assert.ok(/^msmp:/.test(kid) && (await get(kid)).zones[0].vt === 1);
  // SFZ points refer to the file's rate (a 192 kHz file is stored at 96 kHz); `end` plays a copy cut there
  const hz = wavFile({ rate: 192000, ch: [sine(19200, 700, 192000)] });
  const hm = await get(await S.import([file('Hi.sfz', new TextEncoder().encode('<region> sample=hi.wav key=60 loop_mode=loop_continuous loop_start=1920 loop_end=9599 offset=192\n<region> sample=hi.wav key=61 end=3839')), file('hi.wav', hz)], { kind: 'multi' }));
  assert.deepEqual(hm.zones.map(z => [z.mode, z.ls, z.le, z.off]), [['loop', 960, 4800, 96], ['oneshot', 0, 1920, 0]]);
  const cut = await get(hm.zones[1].smp);
  assert.ok(hm.zones[0].smp !== hm.zones[1].smp && cut.len === 1920 && cut.rate === 96000, 'the cut copy');
  // a Multisample oscillator given plain samples: one zone per root, split at the midpoints
  const ms = await get(await S.import([file('Lo C2.wav', wavFile({ rate: 8000, ch: [sine(800, 65, 8000)] })), file('Hi C4.wav', wavFile({ rate: 8000, ch: [sine(800, 261, 8000)], extra: [['smpl', smplChunk(72, 0, [100, 699])]] }))], { kind: 'multi', osc: 2 }));
  assert.deepEqual(ms.zones.map(z => [z.lo, z.hi, z.root, z.mode, z.ls, z.le, z.vt]), [[0, 59, 48, 'oneshot', 0, 800, 1], [60, 127, 72, 'loop', 100, 700, 1]]);
  assert.equal(ms.name, 'Lo C2');
  // impulse responses: 'ir:' ids, 10 s cap
  const irId = await S.import([file('Hall.wav', wavFile({ rate: 8000, ch: [noise(11 * 8000, 7, 8000)] }))], { kind: 'ir' });
  const ir = await get(irId);
  assert.ok(/^ir:/.test(irId) && ir.kind === 'ir' && ir.len === 80000 && !('root' in ir));
  assert.deepEqual(S.list('ir').filter(x => x.user).map(x => x.id), [irId]);
  // relink a missing id (§9.9): the new file keeps its content address; every sound using the missing id switches to it
  const bad = 'smp:0000000000000bad', badIr = 'ir:00000000000000ba';
  const fxr = core.defaultFx2(), cid = core.newInstance(fxr, 'conv', { rack: 0 });
  fxr.racks[0].mods.find(I => I.id === cid).sub.ir = badIr;
  const tl = sxTrack('t9', { osc: [{ wt: 'factory:Default', smp: bad }, { wt: 'factory:Default', smp: 'smp:other' }, { wt: 'factory:Default', smp: bad }] });
  tl.fx = fxr;
  R.tracks.push(tl);
  const fixWav = wavFile({ rate: 8000, ch: [sine(800, 50, 8000)] });
  const rl = await S.import([file('Fix.wav', fixWav)], { kind: 'sample', replace: bad });
  assert.match(rl, /^smp:[0-9a-f]{16}$/);
  assert.ok(rl !== bad && rl === 'smp:' + (await get(rl)).hash, 'stored under its own content address');
  assert.equal((await get(rl)).name, 'Fix');
  assert.equal(await get(bad), null, 'nothing stored under the missing id');
  assert.deepEqual(tl.vals.s.osc.map(O => O.smp), [rl, 'smp:other', rl], 'every oscillator using it relinked');
  assert.deepEqual(R.edits.filter(e => e[0] === 't9'), [['t9', 'Relink sample']]);
  assert.equal(await S.import([file('Fix again.wav', fixWav)], { kind: 'sample' }), rl, 'importing that file again: the same id and content');
  const rir = await S.import([file('Room.wav', wavFile({ rate: 8000, ch: [noise(4000, 11, 1000)] }))], { kind: 'ir', replace: badIr });
  assert.ok(/^ir:/.test(rir) && rir !== badIr && fxr.racks[0].mods.find(I => I.id === cid).sub.ir === rir, 'Convolve relinked through editFx');
  // a user multisample whose zone sample went missing: its zones are relinked too
  const lostZone = 'smp:00000000000000aa', km = await st.put({ kind: 'multi', name: 'Lost', zones: [{ lo: 0, hi: 127, root: 60, smp: lostZone, mode: 'oneshot', ls: 0, le: 100 }] }, {});
  await M.listSmp();
  assert.deepEqual(S.users(lostZone), [], 'no track plays it yet');
  const zl = await S.import([file('Zone.wav', wavFile({ rate: 8000, ch: [sine(800, 77, 8000)] }))], { kind: 'sample', replace: lostZone });
  assert.equal((await get(km)).zones[0].smp, zl);
});

test('§9.3: files the readers cannot decode keep their WAV smpl / AIFF INST root and loop (scaled to the decoded rate)', async () => {
  let calls = 0;
  const R = rig({ decode: async b => ({ rate: 48000, ch: 1, L: sine(9600, 300 + 100 * calls++, 48000), R: null }) }), { M } = R, S = M.host.smp, st = await M.smpStore();
  const w = wavFile({ rate: 24000, ch: [sine(4800, 300, 24000)], extra: [['smpl', smplChunk(62, 0, [480, 3999])]] });
  w[20] = 2; // ADPCM: wt.readWav refuses it
  const a = await st.get(await S.import([file('Odd.wav', w)], {}));
  assert.deepEqual([a.rate, a.root, a.loop], [48000, 62, { start: 960, end: 8000 }]);
  const ai = aiffFile({ rate: 24000, ch: [sine(4800, 200, 24000)], bits: 16, inst: { base: 50, mode: 1, begin: 1, end: 2 }, marks: [[1, 100, 'a'], [2, 4000, 'b']] });
  const ab = new Uint8Array(ai.length + 4); ab.set(ai); // an AIFC whose compression no reader knows
  const v = new DataView(ab.buffer);
  assert.equal(String.fromCharCode(...ab.subarray(8, 12)), 'AIFF');
  ab.set([0x41, 0x49, 0x46, 0x43], 8); // FORM type AIFC
  for (let pos = 12; pos + 8 <= ab.length;) { // COMM gets compression 'ulaw' (4 more bytes)
    const id = String.fromCharCode(...ab.subarray(pos, pos + 4)), len = v.getUint32(pos + 4);
    if (id === 'COMM') {
      const rest = ab.slice(pos + 8 + len);
      v.setUint32(pos + 4, len + 4);
      ab.set([0x75, 0x6c, 0x61, 0x77], pos + 8 + len);
      ab.set(rest.subarray(0, ab.length - (pos + 12 + len)), pos + 12 + len);
      break;
    }
    pos += 8 + len + (len & 1);
  }
  assert.throws(() => smp.readAiff(ab), /Unsupported AIFF compression/);
  assert.deepEqual(smp.aiffInfo(ab), { rate: 24000, ch: 1, frames: 4800, comp: 'ulaw', root: 50, loop: { start: 100, end: 4000 } });
  const b = await st.get(await S.import([file('Old.aifc', ab)], {}));
  assert.deepEqual([b.rate, b.root, b.loop], [48000, 50, { start: 200, end: 8000 }]);
});

test('§9.7 / §10: factory content generated on demand (progress, cache gen:<id>@GEN_VER, cancel); render-farm multisamples; no workers ⇒ notice', async () => {
  const shared = smpstore.memoryStore(), prog = [], notes = [], farmLog = [];
  const R = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => shared }, progress: p => prog.push(p && [p.id, p.done, p.total]), notify: t => notes.push(t),
    worker: kind => (kind === 'render' ? farmWorker(farmLog) : null) }), { M } = R;
  const bell = await M.record('fsmp:Glass Bell');
  assert.ok(bell && bell.kind === 'smp' && bell.len === 4 * 48000 && bell.factory === 1);
  assert.deepEqual(prog, [['fsmp:Glass Bell', 0, 1], ['fsmp:Glass Bell', 1, 1], null]);
  const cached = await shared.cacheGet('gen:fsmp:Glass Bell@' + gen.GEN_VER);
  assert.ok(cached && cached.len === bell.len && same(new Float32Array(cached.L.buffer || cached.L), bell.L));
  // another manager (a reload) reads the cache: no generation
  const prog2 = [];
  // (an identical zone sample of another SFZ reuses the stored id and its root: zones carry their own root, §9.3 step 8)
  const M2 = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => shared }, progress: p => prog2.push(p) }).M;
  assert.equal((await M2.record('fsmp:Glass Bell')).len, bell.len);
  assert.deepEqual(prog2, []);
  // a factory multisample from the render farm: one request per zone, progress per zone, zones cached
  R.addNode('t1');
  prog.length = 0;
  await M.ensure(['fmsmp:Acid Pluck'], { trackId: 't1' });
  const plan = gen.renderPlan('fmsmp:Acid Pluck');
  assert.deepEqual(farmLog, plan.notes.map(n => n.rid));
  assert.deepEqual(prog.filter(Boolean).map(p => p[1]), [0, 1, 2, 3, 4, 5, 6]);
  const posted = R.posts.filter(p => p.m.t === 'smp');
  assert.deepEqual(posted.map(p => p.m.id), plan.notes.map(n => n.rid).concat('fmsmp:Acid Pluck'), 'zone samples, then the multisample');
  assert.ok(posted.every(p => valid(Object.assign({}, p.m))));
  const multi = posted[posted.length - 1].m;
  assert.ok(multi.zones.every(z => z.vt === 1) && multi.zones.length === 6);
  for (const p of posted.slice(0, -1)) {
    const z = multi.zones.find(q => q.smp === p.m.id), up = z.hi - z.root + 12;
    assert.equal(p.m.levels.length, Math.min(8, Math.ceil(Math.log2(Math.pow(2, up / 12) * 48000 / 44100)) + 1), '§9.4.3 levels of ' + p.m.id);
  }
  assert.ok(await shared.cacheGet('gen:fmsmp:Acid Pluck@' + gen.GEN_VER) && await shared.cacheGet('gen:' + plan.notes[0].rid + '@' + gen.GEN_VER));
  // cancel (host.smp.cancel): the generation stops, nothing is cached, progress ends
  prog.length = 0;
  const p = M.record('fmsmp:DX Bells');
  while (!prog.some(x => x && x[0] === 'fmsmp:DX Bells')) await flush(1);
  M.host.smp.cancel();
  await assert.rejects(p, e => e.code === 'ECANCEL');
  assert.equal(await shared.cacheGet('gen:fmsmp:DX Bells@' + gen.GEN_VER), null);
  assert.equal(prog[prog.length - 1], null);
  assert.deepEqual(notes, [], 'a cancel is no failure');
  // without workers the farm cannot run: one notice, the id stays unposted
  const R3 = rig({ notify: t => notes.push(t) }), warn = console.warn, warned = [];
  R3.addNode('t1');
  console.warn = (...a) => warned.push(a.map(String).join(' '));
  try { await R3.M.ensure(['fmsmp:Acid Pluck'], { trackId: 't1' }); } finally { console.warn = warn; }
  assert.deepEqual([notes, R3.posts.length, warned.length], [[A.TEXT.noWorkers], 0, 1], 'one notice, one console warning');
});

test('entries(ids, rate) for processorOptions (§9.6): IRs at the bounce rate, spectral entries with their root, zone samples, generation awaited', async () => {
  const R = rig(), { M } = R;
  const { sid, zid, mid, iid } = await userAssets(M);
  const A1 = sxState(sid, mid, iid), needs = needsOf(A1.s, A1.fx, 44100).concat(['fsmp:Glass Bell', 'fir:Cab/Radio@44100~' + A.convKeyOf(null), 'factory:Default']);
  const es = await M.entries(needs, 44100, { s: A1.s, fx: A1.fx });
  assert.deepEqual(es.map(e => e.id), [needs[0], needs[1], zid, mid, needs[3], 'fsmp:Glass Bell', needs[5], 'factory:Default']);
  for (const e of es.slice(0, 7)) assert.ok(valid(e), e.id);
  assert.deepEqual([es[4].rate, es[6].rate, es[6].ch], [44100, 44100, 1], 'IRs prepared for 44.1 kHz');
  assert.ok(Math.abs(es[1].root - smp.WT_ROOT) < 1e-12);
  assert.equal(R.posts.length, 0, 'nothing posted: the render owns its copies');
  const again = await M.entries(needs.slice(0, 1), 44100, { s: A1.s });
  assert.ok(again[0] !== es[0] && again[0].levels[0].L !== es[0].levels[0].L, 'fresh entries every time');
  // the 20 s spectral cap is announced once
  const notes = [], R2 = rig({ notify: t => notes.push(t) });
  const lid = await R2.M.saveRecord({ kind: 'smp', name: 'Long', rate: 8000, ch: 1, len: 21 * 8000, L: noise(21 * 8000, 3), R: null, root: 60 });
  await R2.M.entries(['spec:' + lid], 48000);
  await R2.M.entries(['spec:' + lid + '~r'], 48000);
  assert.deepEqual(notes, [A.TEXT.specCap]);
});

test('§9.8: embedSmps / restoreSmps — user samples, multisamples with their zone samples and IRs travel as 24-bit PCM; factory ids never', async () => {
  const R = rig(), { M } = R;
  const { sid, zid, mid, iid } = await userAssets(M);
  const A1 = sxState(sid, mid, iid);
  assert.deepEqual(A.userAssetIds(A1.s, A1.fx), [sid, mid, iid]);
  const emb = await M.embedSmps([mid, iid, sid, 'fsmp:Glass Bell', 'fir:Cab/Radio', 'msmp:missing']);
  assert.deepEqual(Object.keys(emb).sort(), [sid, zid, mid, iid].sort());
  assert.equal(emb[sid].enc, 'pcm24');
  const json = JSON.parse(JSON.stringify(emb));
  const R2 = rig(), st2 = await R2.M.smpStore();
  assert.equal(await R2.M.restoreSmps(Object.assign({ 'fsmp:Glass Bell': json[sid], 'smp:bad id': json[sid] }, json)), 4);
  const a = await (await M.smpStore()).get(sid), b = await st2.get(sid);
  assert.deepEqual([b.kind, b.rate, b.ch, b.len, b.root, b.loop], [a.kind, a.rate, a.ch, a.len, a.root, a.loop]);
  const fa = new Float32Array(a.L), fb = new Float32Array(b.L);
  assert.ok(fa.every((v, i) => Math.abs(v - fb[i]) <= Math.pow(2, -23)));
  assert.deepEqual((await st2.get(mid)).zones, (await (await M.smpStore()).get(mid)).zones);
  assert.equal((await st2.get(iid)).kind, 'ir');
  assert.equal(await R2.M.restoreSmps(json), 0, 'identical ids are skipped');
  assert.ok(R2.M.smpRows.length === 4, 'menus refreshed');
});

test('host.smp (§11.15): list, record / pcm (wavetables as samples), overview, odf, users, del ("Missing sample"), rename, saveFrom', async () => {
  const R = rig({ zoneOf: o => (o === 1 ? 'smp:abc' : null) }), { M } = R, S = M.host.smp;
  R.addNode('t1');
  const { sid, mid, iid } = await userAssets(M);
  const rid = await M.saveRecord({ kind: 'smp', name: 'Render 1', rate: 48000, ch: 1, len: 4800, L: sine(4800, 200, 48000), R: null, root: 60 }, { name: 'Render 1', folder: 'Renders' });
  await M.listSmp();
  const samples = S.list('sample');
  assert.deepEqual(samples.filter(x => !x.user && /^fsmp:/.test(x.id)).map(x => x.id), gen.FACTORY_SAMPLES.map(x => x.id));
  assert.ok(samples.find(x => x.id === rid).cat === 'Renders' && samples.find(x => x.id === rid).folder === 'Renders');
  assert.ok(samples.find(x => x.id === sid).cat === 'User' && samples.filter(x => x.cat.startsWith('Wavetables/')).length === wt.FACTORY_TABLES.length);
  assert.ok(samples.find(x => x.id === 'fsmp:Wind Field').gran === 1 && samples.find(x => x.id === 'fsmp:Glass Bell').gran === 0, '§10.4 Granular order');
  assert.deepEqual(S.list('multi').map(x => x.id), gen.FACTORY_MULTI.map(x => x.id).concat(mid));
  assert.deepEqual(S.list('ir').map(x => x.id), gen.FACTORY_IRS.map(x => x.id).concat(iid));
  assert.deepEqual(S.list('nope'), []);
  // record / pcm: user, factory, variants, wavetables as samples (frame-boundary marks, no odf)
  const rec = await S.record(sid + '~0a0b0c0d');
  assert.ok(rec.root === 57 && rec.len === 22050 && !('L' in rec));
  const wr = await S.record('factory:Basic Shapes');
  const R0 = wt.factoryTable('factory:Basic Shapes').frames.length;
  assert.ok(Math.abs(wr.root - smp.WT_ROOT) < 1e-12 && wr.len === R0 * 2048 && wr.marks.length === R0 - 1 && !('L' in wr));
  const pc = await S.pcm('spec:wtsmp:factory:Basic Shapes');
  assert.ok(pc.rate === 48000 && pc.ch === 1 && pc.L.length === R0 * 2048);
  assert.equal((await S.odf('factory:Basic Shapes')).length, 0);
  assert.equal((await S.odf(sid)).length, Math.ceil(22050 / 256));
  assert.deepEqual([await S.record('noise:White'), await S.pcm('sub:Sine'), await S.record('')], [null, null, null]);
  assert.equal((await S.record(iid + '@48000~00000000')).kind, 'ir');
  assert.equal((await S.overview(iid, 8)).length, 16);
  // the Convolve display: a shaped-IR id draws the shaped IR (DECAY 0.25: the first quarter, faded) — the plain id the IR
  const sx = sxState(sid, mid, iid);
  sx.conv.p.dec = 0.25;
  M.learn({ fx: sx.fx });
  const shaped = await S.overview(iid + '@48000~' + A.convKeyOf(sx.conv.p), 8), plain = await S.overview(iid, 8);
  assert.ok(shaped.length === 16 && shaped[1] > 0 && !same(Array.from(shaped), Array.from(plain)), 'shaped ≠ plain');
  assert.ok(Math.abs(shaped[15]) < 0.2 * shaped[1] && plain[15] > 0, 'faded at its end');
  assert.ok((await S.overview('fsmp:Glass Bell', 4)).some(v => v !== 0), 'factory content generated for the display');
  // users / del: the sounds keep the id (silent, badge), derived entries leave the worklet
  const A1 = sxState(sid, mid, iid);
  R.tracks.push({ id: 't1', name: 'Lead', vals: { s: A1.s }, fx: A1.fx }, { id: 't2', name: 'Drums', vals: { a: 1 }, fx: A1.fx });
  assert.deepEqual([S.users(sid), S.users(iid), S.users('smp:none')], [['Lead'], ['Lead', 'Drums'], []]);
  await M.ensure(needsOf(A1.s, A1.fx), { trackId: 't1', s: A1.s, fx: A1.fx });
  await M.entries(['spec:' + sid], 48000);
  const sst = await M.smpStore();
  assert.ok(await sst.cacheGet('spec:' + sid + '@' + smp.SPEC_VER), 'spectral analysis cached');
  assert.equal(await S.del('smp:0000000000000000'), false, 'nothing to delete');
  assert.equal(await S.del(sid), true);
  assert.ok(R.posts.some(p => p.m.t === 'smpdel' && p.m.id.startsWith(sid + '~')) && ![...M.sent].some(x => x.startsWith(sid)));
  assert.equal(await S.record(sid), null, 'missing → the panel shows its badge');
  assert.equal(await sst.cacheGet('spec:' + sid + '@' + smp.SPEC_VER), null, 'its cached analyses go too');
  assert.ok(S.list('sample').every(x => x.id !== sid));
  await S.rename(iid, 'Big Room');
  assert.equal((await S.record(iid)).name, 'Big Room');
  // Switch to Single Sample: the voice's zone sample becomes a user sample (a user zone sample is used as it is)
  assert.equal(await S.saveFrom(1, 'sample'), 'smp:abc');
  assert.equal(await S.saveFrom(0, 'sample'), null);
});

test('§9.4.8: a user table edited in the WT editor while it plays as a sample: its sample / spectral entries are rebuilt', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const t0 = wt.factoryTable('factory:Basic Shapes'), table = { name: 'Mine', morph: 0, frames: t0.frames.map(f => f.slice()) };
  const uid = await M.host.wt.saveNew(table, 'Mine');
  const ids = ['wtsmp:' + uid, 'spec:wtsmp:' + uid];
  await M.ensure(ids, { trackId: 't1' });
  const first = R.posts.filter(p => p.m.t === 'smp' && ids.includes(p.m.id));
  assert.equal(first.length, 2);
  const edited = { name: 'Mine', morph: 0, frames: table.frames.map(f => f.map(v => 0.5 * v)) };
  M.update(uid, edited, { frames: [0] });
  R.runTimers(500);
  await flush(8);
  const after = R.posts.filter(p => ids.includes(p.m.id)).slice(2);
  assert.deepEqual(after.map(p => p.m.t).sort(), ['smp', 'smp', 'smpdel', 'smpdel']);
  const play = after.find(p => p.m.t === 'smp' && p.m.id === ids[0]).m;
  assert.ok(Math.abs(play.peak - 0.5 * first.find(p => p.m.id === ids[0]).m.peak) < 1e-6, 'the edited frames');
});

test('§14.3 Q3: a Convolve length cap (convMax) rebuilds the posted shaped IRs at that length', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const iid = await M.saveRecord({ kind: 'ir', name: 'Long', rate: 8000, ch: 1, len: 5 * 8000, L: noise(5 * 8000, 9, 20000), R: null });
  const fx = core.defaultFx2(), cid = core.newInstance(fx, 'conv', { rack: 0 });
  fx.racks[0].mods.find(I => I.id === cid).sub.ir = iid;
  const needs = models.patchFor('minimoog', valsOf('minimoog'), fx, { sr: 48000 }).needs.filter(id => A.idKind(id) === 'ir');
  assert.equal(needs.length, 1, 'a classic model\'s rack needs its IR too');
  await M.ensure(needs, { trackId: 't1', fx });
  const len0 = R.posts.find(p => p.m.t === 'smp').m.len;
  assert.ok(len0 > 4 * 48000);
  await M.ensure(needs, { trackId: 't1', fx, convMax: 2 });
  const ps = R.posts.filter(p => p.m.id === needs[0]);
  assert.deepEqual(ps.map(p => p.m.t), ['smp', 'smpdel', 'smp']);
  assert.equal(ps[2].m.len, 2 * 48000);
  await M.ensure(needs, { trackId: 't1', fx, convMax: 2 });
  assert.equal(R.posts.filter(p => p.m.id === needs[0]).length, 3, 'unchanged cap: nothing rebuilt');
});

/* ------------------------------------------------------------------ review round (S1 fixes) */
const sw = await imp('smpwork.js');
// an smpwork "worker" that logs its ops and answers asynchronously with the real handler
function opsWorker(log) {
  const w = { onmessage: null, onerror: null, terminate() {} };
  w.postMessage = m => { log.push(m.op); sw.handle(m).then(({ msg }) => setImmediate(() => w.onmessage && w.onmessage({ data: msg }))); };
  return w;
}
const smpRig = (log, opts) => rig(Object.assign({ worker: k => (k === 'smp' ? opsWorker(log) : null) }, opts || {}));
const tone = (len, f, rate = 48000) => ({ kind: 'smp', name: 'T' + f, rate, ch: 1, len, L: sine(len, f, rate), R: null, root: 60 });

test('host.smp.list: user rows stored by an earlier session appear once the modules load; renders refresh the menus', async () => {
  const shared = smpstore.memoryStore();
  const R1 = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => shared } });
  const old = await R1.M.saveRecord(tone(4800, 220), { name: 'Old' });
  const R2 = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => shared } }), S2 = R2.M.host.smp;
  assert.deepEqual(S2.list('sample').filter(x => x.user), [], 'nothing before the modules are here');
  await R2.M.smpMods(); await flush(4);
  assert.ok(S2.list('sample').some(x => x.id === old && x.user && x.cat === 'User'), 'the stored sample is listed after a reload');
  const n = R2.refreshes.length;
  const rid = await R2.M.saveRecord(tone(4800, 330), { name: 'Render 1', folder: 'Renders' });
  assert.ok(S2.list('sample').find(x => x.id === rid).cat === 'Renders' && R2.refreshes.length > n, 'a render is listed under Renders at once');
});

test('host.wt users / del (§8.8 on v2 states): OSC C, a table played as a sample, a spectral-filter table', async () => {
  const R = rig(), { M } = R, W = M.host.wt;
  const t0 = wt.factoryTable('factory:Default');
  const id = await W.saveNew({ frames: t0.frames, morph: 0, name: 'Mine' }, 'Mine');
  const pts = [[0, 1, 0], [0.5, 0.2, 0], [1, 1, 0]];
  const T1 = sxTrack('a', { osc: [{ wt: 'factory:Default' }, { wt: 'factory:Default' }, { wt: id, smp: '' }] });
  const T2 = sxTrack('b', { osc: [{ wt: 'factory:Default', smp: id }, { wt: 'factory:Default' }, { wt: 'factory:Default' }] });
  const T3 = sxTrack('c', { osc: [{ wt: 'factory:Default' }, { wt: 'factory:Default', spec: { filt: { kind: 'wt', wt: id, pts } } }, { wt: 'factory:Default' }] });
  R.tracks.push(T1, T2, T3, sxTrack('d'));
  assert.deepEqual(W.users(id), ['Track a', 'Track b', 'Track c']);
  await W.del(id);
  assert.equal(T1.vals.s.osc[2].wt, 'factory:Default', 'OSC C back to the default table');
  assert.equal(T2.vals.s.osc[0].smp, '', 'the sample source back to the default (none)');
  assert.deepEqual(T3.vals.s.osc[1].spec.filt, { kind: 'curve', wt: '', pts }, 'the filter keeps its curve, the table reference goes');
  assert.deepEqual(R.edits.map(e => e[0]), ['a', 'b', 'c']);
});

test('factory generation: a cancel or a failure sticks for live use (no restart per patch post, one notice) until retry / reselection; bounces still generate', async () => {
  const prog = [], farmLog = [], notes = [];
  const R = rig({ worker: kind => (kind === 'render' ? farmWorker(farmLog) : null), progress: p => prog.push(p && p.done), notify: t => notes.push(t) }), { M } = R;
  R.addNode('t1');
  const id = 'fmsmp:Acid Pluck', p = M.ensure([id], { trackId: 't1' });
  while (!prog.some(x => x === 1)) await flush(1);
  M.host.smp.cancel();
  await p;
  const n = farmLog.length;
  assert.ok(n < gen.renderPlan(id).notes.length && !M.sent.has(id));
  prog.length = 0;
  for (let i = 0; i < 3; i++) await M.ensure([id], { trackId: 't1' });
  assert.equal(await M.host.smp.record(id), null, 'a panel read does not restart it either');
  await flush(4);
  assert.deepEqual([farmLog.length, prog.filter(x => x != null).length, M.sent.has(id)], [n, 0, false], 'nothing restarted by later patch posts');
  // a bounce generates it (and caches it: live use works from the cache)
  const es = await M.entries([id], 48000);
  assert.equal(es[es.length - 1].id, id);
  await M.ensure([id], { trackId: 't1' });
  assert.ok(M.sent.has(id), 'cached by the bounce: posted');
  // retry after a cancel; reselection after a cancel
  prog.length = 0;
  const id2 = 'fmsmp:Juno Sub Bass', p2 = M.ensure([id, id2], { trackId: 't1' });
  while (!prog.some(x => x === 1)) await flush(1);
  M.host.smp.cancel();
  await p2;
  await M.ensure([id, id2], { trackId: 't1' });
  assert.ok(!M.sent.has(id2));
  await M.ensure([id], { trackId: 't1' }); // another sound selected …
  const p3 = M.ensure([id, id2], { trackId: 't1' }); // … and this one again: generated
  await p3;
  assert.ok(M.sent.has(id2), 'reselected → generated');
  // a failing farm: one attempt and one notice however often the patch is posted; retry tries again
  let fails = 0;
  const bad = { onmessage: null, onerror: null, terminate() {}, postMessage(m) { fails++; setImmediate(() => this.onmessage({ data: { q: m.q, ok: false, err: 'boom' } })); } };
  const F = rig({ worker: kind => (kind === 'render' ? bad : null), notify: t => notes.push(t) });
  F.addNode('t1');
  notes.length = 0;
  for (let i = 0; i < 4; i++) await F.M.ensure([id], { trackId: 't1' });
  assert.deepEqual([fails, notes.length], [1, 1]);
  F.M.host.smp.retry(id);
  await flush(6);
  assert.deepEqual([fails, notes.length], [2, 2], 'retry: a new attempt (and its notice)');
});

test('§8.4: one build in flight per variant base — a trim drag or a Convolve shaping drag builds the first and the last target only', async () => {
  const log = [], R = smpRig(log), { M } = R;
  R.addNode('t1');
  const { sid, mid, iid } = await userAssets(M);
  const A1 = sxState(sid, mid, iid);
  await M.ensure(needsOf(A1.s, A1.fx), { trackId: 't1', s: A1.s, fx: A1.fx });
  log.length = 0;
  const ps = [];
  for (let k = 1; k <= 6; k++) { // one patch post per frame while two handles move
    A1.s.osc[0].smpo.ops = { trim: [0.1 + 0.02 * k, 0.9], fade: 2, norm: 0, rev: 0 };
    A1.conv.p.size = 0.5 + 0.05 * k;
    ps.push(M.ensure(needsOf(A1.s, A1.fx), { trackId: 't1', s: A1.s, fx: A1.fx }));
  }
  await Promise.all(ps);
  await M.ensure(needsOf(A1.s, A1.fx), { trackId: 't1', s: A1.s, fx: A1.fx });
  R.runTimers(0);
  assert.deepEqual([log.filter(o => o === 'entry').length, log.filter(o => o === 'irshape').length], [2, 2], 'first + last: ' + log.join(' '));
  const last = needsOf(A1.s, A1.fx);
  assert.ok(M.sent.has(last[0]) && M.sent.has(last[3]));
  assert.deepEqual([...M.sent].filter(x => x.startsWith(sid + '~') || x.startsWith(iid + '@')).sort(), [last[0], last[3]].sort(), 'only the current variants stay posted');
});

test('§14.2: a refused selection is not rebuilt while it does not fit; it is built once the meter has room', async () => {
  const log = [], notes = [], R = smpRig(log, { budget: 300000, notify: t => notes.push(t) }), { M } = R;
  R.addNode('t1'); R.addNode('t2');
  const a = await M.saveRecord(tone(12000, 220)), big = await M.saveRecord(tone(30000, 110));
  await M.ensure([a], { trackId: 't2' });
  log.length = 0;
  for (let i = 0; i < 5; i++) await M.ensure([big], { trackId: 't1' });
  assert.deepEqual([log.filter(o => o === 'entry').length, M.sent.has(big), notes.filter(t => t === A.TEXT.memory).length], [1, false, 1]);
  M.release('t2');
  R.runTimers(2500); R.runTimers(10000); R.runTimers(2500); // a's entry freed
  assert.ok(!M.sent.has(a));
  await M.ensure([big], { trackId: 't1' });
  assert.ok(M.sent.has(big) && log.filter(o => o === 'entry').length === 2, 'room now: built and posted');
});

test('§9.4.3: zone level caps apply to zone entries only — a sample also played directly (or bounced) gets every level', async () => {
  const R = rig(), { M } = R;
  R.addNode('t1');
  const z = await M.saveRecord(tone(48000, 220));
  const m = await (await M.smpStore()).put({ kind: 'multi', name: 'K', zones: [{ lo: 60, hi: 61, vlo: 0, vhi: 127, root: 60, smp: z, mode: 'oneshot', ls: 0, le: 48000 }] }, {});
  const lv = id => R.posts.filter(p => p.m.t === 'smp' && p.m.id === id).map(p => p.m.levels.length);
  await M.ensure([m], { trackId: 't1' });
  assert.deepEqual(lv(z), [3], 'zone entry: transposition levels only (ceil(log2(2^(13/12)·48000/44100)) + 1)');
  await M.ensure([m, z], { trackId: 't1' }); // a Sample oscillator on the same sample
  assert.deepEqual(lv(z), [3, 8], 'played directly: rebuilt in full (it serves the zone too)');
  await M.ensure([m, z], { trackId: 't1' });
  assert.equal(lv(z).length, 2, 'once');
  M.release('t1');
  const es = await M.entries([z], 48000);
  assert.equal(es[0].levels.length, 8, 'a bounce of the sample: every level');
  const both = await M.entries([m, z], 48000);
  assert.deepEqual(both.map(e => [e.id, e.levels ? e.levels.length : 0]), [[m, 0], [z, 8]], 'multisample and the same sample directly: one full entry');
  // touch devices (§14.2 budget): headroom = the default bend range (ZONE_HEADROOM.touch = 2) instead of TIMBRE's 12
  assert.deepEqual({ ...A.ZONE_HEADROOM }, { desktop: 12, touch: 2 });
  const T = rig({ touch: true });
  T.addNode('t1');
  const zt = await T.M.saveRecord(tone(48000, 220));
  const mt = await (await T.M.smpStore()).put({ kind: 'multi', name: 'K', zones: [{ lo: 60, hi: 65, vlo: 0, vhi: 127, root: 60, smp: zt, mode: 'oneshot', ls: 0, le: 48000 }] }, {});
  await T.M.ensure([mt], { trackId: 't1' });
  const want = Math.ceil(Math.log2(Math.pow(2, (65 - 60 + 2) / 12) * 48000 / 44100)) + 1;
  assert.deepEqual(T.posts.filter(p => p.m.t === 'smp' && p.m.id === zt).map(p => p.m.levels.length), [want], 'touch: ' + want + ' levels');
  assert.equal(want, 2);
});

test('§9.3 step 9: persistence is requested by the first stored user asset of any kind (import, project file, render)', async () => {
  let asked = 0;
  const persist = () => { asked++; return Promise.resolve(true); };
  const R = rig({ persist }), { M } = R;
  const { sid } = await userAssets(M);
  const emb = await M.embedSmps([sid]);
  const R2 = rig({ persist: () => { asked += 10; return Promise.resolve(true); } });
  assert.equal(await R2.M.restoreSmps(emb), 1);
  await flush(2);
  assert.equal(asked, 1 + 10, 'saveRecord (R) and restoreSmps (R2): once per manager');
  await R2.M.saveRecord(tone(480, 500), { folder: 'Renders' });
  await flush(2);
  assert.equal(asked, 11, 'once per session');
});

test('§9.3: an import writes its record once (onset function computed before the put; existence without reading PCM)', async () => {
  const base = smpstore.memoryStore(), calls = [];
  const st = Object.assign({}, base, {
    put: (o, x) => { calls.push('put'); return base.put(o, x); },
    get: id => { calls.push('get'); return base.get(id); },
    has: id => { calls.push('has'); return base.has(id); },
  });
  const R = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => st } }), S = R.M.host.smp;
  const w = wavFile({ rate: 8000, ch: [sine(8000, 300, 8000), sine(8000, 200, 8000)] });
  const id = await S.import([file('Pad.wav', w)], { kind: 'sample' });
  assert.deepEqual(calls, ['has', 'put'], 'one existence check, one write, no PCM read back: ' + calls.join(' '));
  const r = await base.get(id);
  assert.ok(r.odf instanceof ArrayBuffer && r.odf.byteLength === 4 * Math.ceil(8000 / 256), 'odf stored with the record');
  calls.length = 0;
  assert.equal(await S.import([file('Pad copy.wav', w)], { kind: 'sample' }), id);
  assert.deepEqual(calls, ['has'], 'an identical file: no PCM read, nothing written');
});

test('§14.3 Q3 while an IR is being built; entries(ids, rate) builds IRs for the render rate', async () => {
  const log = [], R = smpRig(log), { M } = R;
  R.addNode('t1');
  const iid = await M.saveRecord({ kind: 'ir', name: 'Long', rate: 8000, ch: 1, len: 5 * 8000, L: noise(5 * 8000, 9, 20000), R: null });
  const fx = core.defaultFx2(), cid = core.newInstance(fx, 'conv', { rack: 0 });
  fx.racks[0].mods.find(I => I.id === cid).sub.ir = iid;
  const needs = models.patchFor('minimoog', valsOf('minimoog'), fx, { sr: 48000 }).needs.filter(id => A.idKind(id) === 'ir');
  const p = M.ensure(needs, { trackId: 't1', fx });
  M.ensure(needs, { trackId: 't1', fx, convMax: 2 }); // Q3 fires while the first build is under way
  await p; await flush(8);
  const ps = R.posts.filter(x => x.m.id === needs[0]);
  assert.deepEqual(ps.map(x => x.m.t), ['smp', 'smpdel', 'smp']);
  assert.equal(ps[2].m.len, 2 * 48000, 'rebuilt at the new cap');
  // a bounce at 44.1 kHz given ids compiled at 48 kHz: prepared for 44.1 kHz under the requested id (and a warning)
  const warn = console.warn, w = [];
  console.warn = (...a) => w.push(a.join(' '));
  let es;
  try { es = await M.entries(needs, 44100, { fx }); } finally { console.warn = warn; }
  assert.deepEqual([es[0].id, es[0].rate, w.length], [needs[0], 44100, 1]);
});

test('§9.2 / §14.2 cache: factory spectral keys carry GEN_VER; intermediate variants are not cached; a superseded variant\'s analysis goes', async () => {
  const shared = smpstore.memoryStore(), R = rig({ stores: { wt: () => wtstore.memoryStore(), smp: () => shared } }), { M } = R;
  R.addNode('t1');
  const f = 'fsmp:Glass Bell';
  await M.entries(['spec:' + f], 48000);
  assert.ok(await shared.cacheGet('spec:' + f + '@' + smp.SPEC_VER + '.' + gen.GEN_VER), 'factory: spec:<id>@SPEC_VER.GEN_VER');
  assert.equal(await shared.cacheGet('spec:' + f + '@' + smp.SPEC_VER), null);
  const sid = await M.saveRecord(tone(9600, 300));
  const s = core.defaultSerum();
  s.osc[0].type = 'spec'; s.osc[0].smp = sid;
  const ids = [];
  for (const k of [1, 2, 3]) {
    s.osc[0].smpo.ops = { trim: [0.1 * k, 0.9], fade: 0, norm: 0, rev: 0 };
    const nd = needsOf(s, core.defaultFx2());
    ids.push(nd.find(x => x.startsWith('spec:')));
    M.ensure(nd, { trackId: 't1', s });
  }
  await M.ensure(needsOf(s, core.defaultFx2()), { trackId: 't1', s });
  R.runTimers(0); await flush(4);
  const keys = ids.map(x => 'spec:' + x.slice(5) + '@' + smp.SPEC_VER);
  const got = await Promise.all(keys.map(k => shared.cacheGet(k)));
  assert.deepEqual(got.map(Boolean), [false, false, true], 'only the variant still in use is cached (the first one was dropped when superseded)');
});

test('§9.9: users() names the tracks playing a sample through a user multisample; the multisample record lists deleted zone samples', async () => {
  const R = rig(), { M } = R, S = M.host.smp;
  const { zid, mid } = await userAssets(M);
  await M.listSmp();
  const s = core.defaultSerum();
  s.osc[2].type = 'multi'; s.osc[2].multi = mid;
  R.tracks.push({ id: 'k', name: 'Keys', vals: { s } });
  assert.deepEqual(S.users(zid), ['Keys']);
  assert.deepEqual((await S.record(mid)).missing, []);
  await S.del(zid);
  assert.deepEqual((await S.record(mid)).missing, [zid], 'the panel can show the multisample\'s badge');
});
