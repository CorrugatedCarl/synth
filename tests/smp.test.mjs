// Sample / IR pipeline tests (owner S1; SPEC-serum2 §9, §4.5, §8.4, §11.12, §15.11): smp.js, smpstore.js, smpwork.js.
// The export surface of §11.12, every helper (decoding: readAiff round trips, sniff, roots from names and WAV chunks;
// resample passband / stopband; SFZ fixture; ZIP stored / deflated; ops order; levels; onset function and slicing;
// spectral analysis of a sine; IR preparation / shaping incl. minimum phase / partitioning; loop search; displays;
// 24-bit files; hashes), smpstore (memory and IndexedDB backends, row / cache indexes, quota) and the smpwork protocol
// (every op, transfer lists, entries ≤ 48 kHz, the 20 s spectral cap); entries are checked against SxBase.storeAsset's
// §4.5 validation.
// Run: node --test tests/smp.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dspScope } from './dsp-scope.mjs';
import { wavFile, smplChunk, instChunk, acidChunk, aiffFile, zipFile } from './smp-files.mjs';

// the site's shared `?v=N` suffix (§0.4): the same module instances the site modules import
const V = '?v=' + /const VERSION = '(\d+)'/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1];
const imp = f => import(new URL('../' + f + V, import.meta.url).href);
const smp = await imp('smp.js');
const store = await imp('smpstore.js');
const work = await imp('smpwork.js');
const wt = await imp('wt.js');

const SxBase = (() => { const S = dspScope({ files: ['sx-base.js'] }); return S.global('SxBase'); })();
const valid = e => { const ok = SxBase.storeAsset(e.id, e); if (ok) SxBase.dropAsset(e.id); return ok; };
const sine = (n, f, rate, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / rate));

/* ------------------------------------------------------------------ smp.js surface (§11.12) */
test('§11.12: smp.js exports every helper with its final arity; LIMITS deep-frozen', () => {
  const ARITY = { sniff: 1, readAiff: 1, resample: 4, rootFromName: 1, rootFromWav: 1, parseSfz: 1, zipEntries: 2, applyOps: 2,
    sampleLevels: 4, odf: 3, slicesFromOdf: 4, specAnalyse: 3, irPrepare: 2, irShape: 3, irPartition: 3, wtAsSample: 1,
    loopSearch: 6, encodeAsset: 1, decodeAsset: 1, assetHash: 2, fileRate: 1 };
  for (const [k, n] of Object.entries(ARITY)) {
    assert.equal(typeof smp[k], 'function', k);
    assert.equal(smp[k].length, n, k + ' arity');
  }
  assert.ok(Object.isFrozen(smp.LIMITS));
  assert.deepEqual([smp.LIMITS.sampleSec, smp.LIMITS.zoneSec, smp.LIMITS.irSec, smp.LIMITS.maxRate, smp.LIMITS.playRate,
    smp.LIMITS.levels, smp.LIMITS.zones, smp.LIMITS.slices, smp.LIMITS.specSec], [60, 30, 10, 96000, 48000, 8, 512, 256, 20]);
  assert.ok(Number.isInteger(smp.SPEC_VER) && smp.SPEC_VER >= 1);
});

/* ------------------------------------------------------------------ sniff (§9.3 step 1) */
test('§9.3: sniff recognises every format by its magic bytes, SFZ by its headers, else null', () => {
  const b = (...parts) => { const out = []; for (const p of parts) for (const c of (typeof p === 'string' ? Array.from(p, ch => ch.charCodeAt(0)) : p)) out.push(c); while (out.length < 16) out.push(0); return Uint8Array.from(out); };
  const cases = [
    [b('RIFF', [1, 2, 3, 4], 'WAVE'), 'wav'], [b('FORM', [0, 0, 0, 9], 'AIFF'), 'aiff'], [b('FORM', [0, 0, 0, 9], 'AIFC'), 'aiff'],
    [b('fLaC'), 'flac'], [b('OggS'), 'ogg'], [b('ID3', [4, 0]), 'mp3'], [b([0xff, 0xfb, 0x90]), 'mp3'], [b([0, 0, 0, 32], 'ftypM4A '), 'm4a'],
    [b('PK', [3, 4]), 'zip'], [b([0x89], 'PNG', [13, 10, 26, 10]), 'png'],
    [new TextEncoder().encode('// a bank\n<group> lovel=0\n<region> sample=a.wav key=60\n'), 'sfz'],
    [new TextEncoder().encode('<control>\ndefault_path=x/\n'), 'sfz'],
    [new TextEncoder().encode('just some text without headers'), null],
    [b('RIFF', [1, 2, 3, 4], 'AVI '), null], [b([0xff, 0x00]), null], [new Uint8Array(0), null],
  ];
  for (const [bytes, want] of cases) assert.equal(smp.sniff(bytes), want, String(want));
  assert.equal(smp.sniff(b('fLaC').buffer), 'flac', 'ArrayBuffer input');
  assert.equal(smp.sniff(null), null);
});

/* ------------------------------------------------------------------ root from the file name (§9.3 step 4) */
test('§9.3: rootFromName — `[ _]<Note><Octave>` before the extension, C3 = MIDI 60, octave −2…8', () => {
  const cases = [['Bass F2.wav', 53], ['Pad Eb3.aif', 63], ['Lead D#3.wav', 63], ['Kick_C-1.wav', 12], ['x_C3.flac', 60],
    ['Low_C-2.wav', 0], ['Hi G8.wav', 127], ['Top A8.wav', null], ['dir/Sub_A1.wav', 45], ['C:\\samples\\Bell_Bb4.wav', 82],
    ['Saw_e2.wav', 52], ['NoNote.wav', null], ['PianoC3.wav', null], ['Cb3 piano.wav', null], ['Pad Cb3.wav', 59], ['Organ E#3.wav', 65],
    ['Vox_C3', 60], [42, null]];
  for (const [name, want] of cases) assert.equal(smp.rootFromName(name), want, String(name));
});

/* ------------------------------------------------------------------ levels, entries (§9.4.3, §4.5) */
test('§9.4.3: sampleLevels halves each level (⌈len/2⌉), stops at maxLevels or len < 64; entries validate in SxBase', () => {
  const L = sine(48000, 440, 48000), R = sine(48000, 220, 48000);
  const lv = smp.sampleLevels(L, R, 48000, 8);
  assert.ok(lv.length >= 6 && lv.length <= 8, 'levels ' + lv.length);
  lv.forEach((l, i) => {
    assert.equal(l.len, i === 0 ? 48000 : Math.ceil(lv[i - 1].len / 2));
    assert.ok(l.L instanceof Float32Array && l.R instanceof Float32Array && l.L.length === l.len && l.R.length === l.len);
  });
  assert.deepEqual(Array.from(lv[0].L), Array.from(L), 'level 0 is the data');
  assert.equal(smp.sampleLevels(L, null, 48000, 2).length, 2);
  assert.equal(smp.sampleLevels(L, null, 48000, 2)[1].R, null, 'mono: R null');
  assert.equal(smp.sampleLevels(L.subarray(0, 100), null, 100, 8).length, 1, '100 samples: one level (the next would be < 64)');
  // level 1 of a 440 Hz sine keeps it (passband), a 20 kHz sine is removed (stopband of the half-band at 24 kHz → 12 kHz)
  const pk = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(Math.abs(pk(smp.sampleLevels(L, null, 48000, 2)[1].L.subarray(100, -100)) - 0.5) < 0.01);
  assert.ok(pk(smp.sampleLevels(sine(48000, 20000, 48000), null, 48000, 2)[1].L.subarray(100, -100)) < 0.01);
  const e = work.playbackEntry('smp:test', { kind: 'smp', rate: 44100, ch: 2, len: 48000, L, R, root: 57.5, loop: { start: 100, end: 40000 } }, null);
  assert.deepEqual([e.id, e.v, e.kind, e.rate, e.ch, e.len, e.root], ['smp:test', 1, 'smp', 44100, 2, 48000, 57.5]);
  assert.deepEqual(e.loop, { start: 100, end: 40000 });
  assert.ok(Math.abs(e.peak - 0.5) < 1e-6);
  assert.equal(e.bytes, e.levels.reduce((a, l) => a + l.L.byteLength + l.R.byteLength, 0));
  assert.ok(valid(e), 'SxBase.storeAsset accepts the playback entry');
  const m = work.playbackEntry('smp:mono', { kind: 'smp', rate: 48000, ch: 1, L: L.buffer.slice(0), R: null, root: 60, loop: null }, { fade: 0, trim: null, rev: 1, norm: 1 }, 3);
  assert.equal(m.levels.length, 3, 'maxLevels (zone entries)');
  assert.ok(valid(m), 'mono entry from an ArrayBuffer record (rev/norm are CP flags: not baked, no ENOTIMPL)');
});

test('§9.4.8: wtAsSample — frames concatenated at 48 kHz, root 69 + 12·log2(48000/(2048·440)), whole-table loop', () => {
  const t = wt.factoryTable('factory:Basic Shapes'), R = t.frames.length;
  const a = smp.wtAsSample(t.frames), flat = new Float32Array(R * 2048);
  t.frames.forEach((f, i) => flat.set(f, i * 2048));
  const b = smp.wtAsSample(flat);
  assert.deepEqual([a.kind, a.rate, a.ch, a.len, a.R], ['smp', 48000, 1, R * 2048, null]);
  assert.ok(Math.abs(a.root - 18.232) < 0.001 && a.root === smp.WT_ROOT);
  assert.deepEqual(a.loop, { start: 0, end: R * 2048 });
  assert.deepEqual(a.marks, Array.from({ length: R - 1 }, (_, i) => (i + 1) / R));
  assert.deepEqual(Array.from(a.L), Array.from(b.L));
  assert.deepEqual(Array.from(a.L.subarray(2048, 4096)), Array.from(t.frames[1]));
  // one cycle per frame at the root: 48000 / 2048 Hz = MIDI root
  assert.ok(Math.abs(440 * Math.pow(2, (a.root - 69) / 12) - 48000 / 2048) < 1e-9);
  const e = work.playbackEntry('wtsmp:factory:Basic Shapes', a, null);
  assert.ok(valid(e), 'the wavetable-as-sample playback entry validates');
  assert.throws(() => smp.wtAsSample(new Float32Array(100)), /no frames/);
});

/* ------------------------------------------------------------------ files (§9.8) */
test('§9.8: encodeAsset / decodeAsset — 24-bit PCM base64 round trip (error ≤ 2⁻²³), multi and IR kinds', () => {
  const r = wt.mulberry32(7), n = 3001;
  const L = Float32Array.from({ length: n }, () => 1.98 * r() - 0.99), R = Float32Array.from({ length: n }, () => 1.98 * r() - 0.99);
  L[5] = 1.5; L[6] = -2; L[7] = NaN; // clipped, clipped, → 0
  const rec = { kind: 'smp', name: 'Test', rate: 44100, ch: 2, len: n, L, R: R.buffer, root: 61.25, loop: { start: 10, end: 2000 } };
  const enc = smp.encodeAsset(rec);
  assert.deepEqual([enc.kind, enc.name, enc.rate, enc.ch, enc.len, enc.root, enc.enc], ['smp', 'Test', 44100, 2, n, 61.25, 'pcm24']);
  assert.deepEqual(enc.loop, { start: 10, end: 2000 });
  assert.match(enc.L, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(enc.L.length, Math.ceil(n * 3 / 3) * 4);
  const back = JSON.parse(JSON.stringify(enc)), dec = smp.decodeAsset(back);
  assert.deepEqual([dec.kind, dec.rate, dec.ch, dec.len, dec.root], ['smp', 44100, 2, n, 61.25]);
  assert.ok(dec.L instanceof Float32Array && dec.R instanceof Float32Array);
  let err = 0;
  for (let i = 0; i < n; i++) {
    if (i >= 5 && i <= 7) continue;
    err = Math.max(err, Math.abs(dec.L[i] - L[i]), Math.abs(dec.R[i] - R[i]));
  }
  assert.ok(err <= Math.pow(2, -23), 'max error ' + err);
  assert.ok(Math.abs(dec.L[5] - (1 - Math.pow(2, -23))) < 1e-9 && dec.L[6] === -1 && dec.L[7] === 0, 'clip / NaN');
  const mono = smp.decodeAsset(smp.encodeAsset({ kind: 'smp', rate: 48000, ch: 1, L: new Float32Array([0, 0.5, -0.5]), R: null, root: 60, loop: null }));
  assert.deepEqual([mono.ch, mono.R, Array.from(mono.L)], [1, null, [0, 0.5, -0.5]]);
  const ir = smp.decodeAsset(smp.encodeAsset({ kind: 'ir', name: 'Hall', rate: 48000, ch: 1, L: new Float32Array([1, 0.25]) }));
  assert.deepEqual([ir.kind, ir.name, 'root' in ir, Array.from(ir.L)], ['ir', 'Hall', false, [Math.fround(1 - Math.pow(2, -23)), 0.25]], 'full scale clips to the largest 24-bit code');
  const zones = [{ lo: 0, hi: 127, vlo: 0, vhi: 127, root: 60, smp: 'smp:a' }];
  assert.deepEqual(smp.decodeAsset(smp.encodeAsset({ kind: 'multi', name: 'Keys', zones })), { kind: 'multi', name: 'Keys', zones });
  assert.throws(() => smp.decodeAsset({ kind: 'smp', enc: 'mp3', L: '' }), /encoding/);
  assert.throws(() => smp.encodeAsset({ kind: 'wt' }), /kind/);
});

test('§9.3 step 8: assetHash — two FNV-1a-32 over the LE Float32 PCM, 16 hex digits, any input form', () => {
  const L = sine(1000, 100, 48000), R = sine(1000, 50, 48000);
  const h = smp.assetHash(L, R);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(smp.assetHash(L.buffer.slice(0), Array.from(R)), h, 'ArrayBuffer / array input');
  assert.notEqual(smp.assetHash(L, null), h, 'mono differs');
  const L2 = L.slice(); L2[500] += 1e-6;
  assert.notEqual(smp.assetHash(L2, R), h, 'one sample changed');
  // reference FNV-1a over the bytes, both offset bases
  const bytes = new Uint8Array(new Float32Array([0.5, -1]).buffer);
  let a = 0x811c9dc5, b = 0x01000193;
  for (const x of bytes) { a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x01000193); }
  assert.equal(smp.assetHash(new Float32Array([0.5, -1]), null), (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'));
});

/* ------------------------------------------------------------------ smpstore (§9.2) */
async function storeSuite(st, clock) {
  const L = sine(4800, 440, 48000), R = sine(4800, 220, 48000);
  const id1 = await st.put({ kind: 'smp', name: 'Kick C3', rate: 44100, ch: 2, L, R, root: 60, loop: { start: 10, end: 4000 }, src: { file: 'Kick C3.wav', type: 'audio/wav', bytes: 1234 }, hash: 'abc' }, {});
  assert.match(id1, /^smp:[0-9a-f-]{36}$/);
  const g = await st.get(id1);
  assert.deepEqual([g.kind, g.name, g.rate, g.ch, g.len, g.root, g.folder, g.hash, g.odf], ['smp', 'Kick C3', 44100, 2, 4800, 60, '', 'abc', null]);
  assert.deepEqual(g.loop, { start: 10, end: 4000 });
  assert.deepEqual(g.src, { file: 'Kick C3.wav', type: 'audio/wav', bytes: 1234 });
  assert.ok(g.L instanceof ArrayBuffer && g.R instanceof ArrayBuffer);
  assert.deepEqual(new Float32Array(g.L), L);
  assert.ok(Math.abs(g.peak - 0.5) < 1e-6, 'peak computed');
  new Float32Array(g.L)[0] = 9;
  assert.notEqual(new Float32Array((await st.get(id1)).L)[0], 9, 'returned objects are copies');
  clock.t += 1000;
  const id2 = await st.put({ kind: 'multi', name: 'Keys', zones: [{ lo: 0, hi: 200, vlo: 0, vhi: 127, root: 60, smp: id1, mode: 'sustain', ls: 10, le: 4000, rr: [2, 3] }, null], src: { sfz: '<region>' } }, {});
  assert.match(id2, /^msmp:/);
  const m = await st.get(id2);
  assert.equal(m.zones.length, 1);
  assert.deepEqual(m.zones[0], { lo: 0, hi: 127, vlo: 0, vhi: 127, root: 60, tune: 0, gain: 0, pan: 0, smp: id1, mode: 'sustain', ls: 10, le: 4000, off: 0, env: null, rr: [2, 2], vt: 1 });
  assert.deepEqual(m.src, { sfz: '<region>' });
  clock.t += 1000;
  const id3 = await st.put({ kind: 'ir', name: 'Hall', rate: 48000, ch: 1, L: [1, 0.5, 0.25] }, {});
  assert.match(id3, /^ir:/);
  const id4 = await st.put({ kind: 'smp', name: 'Render 1', folder: 'Renders', L, ch: 1 }, { name: 'alpha' });
  // list: sorted by name, kind filter, rows
  const rows = await st.list();
  assert.deepEqual(rows.map(r => r.name), ['alpha', 'Hall', 'Keys', 'Kick C3']);
  assert.deepEqual((await st.list({ kind: 'smp' })).map(r => [r.id, r.folder, r.ch]), [[id4, 'Renders', 1], [id1, '', 2]]);
  assert.ok(Math.abs(rows.find(r => r.id === id1).seconds - 4800 / 44100) < 1e-12);
  assert.equal(rows.find(r => r.id === id2).zones, 1);
  // explicit id overwrites (created kept), record-form id kept, rename, del
  clock.t += 1000;
  const created = (await st.get(id1)).created;
  assert.equal(await st.put(Object.assign(await st.get(id1), { name: 'Kick 2' }), {}), id1);
  const g2 = await st.get(id1);
  assert.deepEqual([g2.name, g2.created, g2.modified > created], ['Kick 2', created, true]);
  assert.equal(await st.put({ kind: 'smp', L: [0.1] }, { id: 'smp:fixed' }), 'smp:fixed');
  const other = await st.put({ kind: 'smp', id: 'fsmp:Glass Bell', L: [0.1] }, {});
  assert.ok(other.startsWith('smp:') && other !== 'fsmp:Glass Bell', 'a foreign id is not taken over');
  await st.del(other);
  assert.equal(await st.rename(id3, 'Big Hall'), true);
  assert.equal((await st.get(id3)).name, 'Big Hall');
  assert.equal(await st.rename('smp:none', 'x'), false);
  await st.del('smp:fixed');
  assert.equal(await st.get('smp:fixed'), null);
  await assert.rejects(st.put({ kind: 'noise', L: [1] }), /unknown kind/);
  await assert.rejects(st.put({ kind: 'smp', L: [] }), /no samples/);
  // gc: unreferenced and not modified for a week
  clock.t += 8 * 86400000;
  await st.put(Object.assign(await st.get(id4), {}), {});
  assert.equal(await st.gc([id1]), 2, 'id2 and id3 removed; id1 kept, id4 recent');
  assert.deepEqual((await st.list()).map(r => r.id).sort(), [id1, id4].sort());
  // cache: LRU trim by bytes
  const big = n => ({ N: 8, mag: new Float32Array(n), ph: new Float32Array(n), trans: new Uint8Array(4) });
  assert.equal(await st.cachePut('spec:a@1', big(256)), 2052);
  clock.t += 1; await st.cachePut('spec:b@1', big(256));
  clock.t += 1; await st.cachePut('gen:fsmp:X@1', { kind: 'smp', L: new Float32Array(512).buffer, R: null });
  clock.t += 1;
  const a = await st.cacheGet('spec:a@1'); // a becomes the most recently used
  assert.ok(a.mag instanceof Float32Array && a.mag.length === 256 && a.N === 8);
  assert.equal(await st.cacheGet('spec:none'), null);
  assert.equal(await st.cacheTrim(4200), 1, 'one entry over the budget: the least recently used (b)');
  assert.equal(await st.cacheGet('spec:b@1'), null);
  assert.ok(await st.cacheGet('spec:a@1') && await st.cacheGet('gen:fsmp:X@1'));
  assert.equal(await st.cacheTrim(), 0, 'default budget 512 MB');
}

test('§9.2: smpstore memory store — records, rows, ids, rename, del, gc, LRU cache', async () => {
  const clock = { t: 1e12 };
  await storeSuite(store.memoryStore({ now: () => clock.t }), clock);
});

test('§9.2: smpstore quota errors reject with the notice text and store nothing', async () => {
  const st = store.memoryStore({ quota: 40000 });
  await st.put({ kind: 'smp', L: new Float32Array(4000) }, { id: 'smp:a' });
  await assert.rejects(st.put({ kind: 'smp', L: new Float32Array(8000) }, { id: 'smp:b' }), e => e.quota === true && e.message === store.QUOTA_TEXT && e.message === 'Storage full — remove unused samples');
  assert.equal(await st.get('smp:b'), null);
  await assert.rejects(st.cachePut('k', { L: new Float32Array(10000) }), e => e.quota === true);
});

test('§9.2: smpstore on IndexedDB (`synth-smp` v1: assets with index kind, cache) — same suite on a fake', async () => {
  await assert.rejects(store.openStore(), /IndexedDB unavailable/);
  const idb = fakeIDB(), clock = { t: 1e12 };
  globalThis.indexedDB = idb;
  try {
    const st = await store.openStore({ now: () => clock.t });
    const db = idb.dbs.get('synth-smp');
    assert.ok(db && db.version === 1 && db.stores.get('assets').keyPath === 'id' && db.stores.get('assets').indexes.get('kind') === 'kind' && db.stores.get('cache').keyPath === 'key');
    await storeSuite(st, clock);
    st.close();
  } finally { delete globalThis.indexedDB; }
});

test('§9.2: two tabs on one database — rows and cache index changes are deltas, nothing of the other tab is lost; has / ensureRow / cacheTouch / cacheTrim keep', async () => {
  const idb = fakeIDB(), clock = { t: 1e12 };
  globalThis.indexedDB = idb;
  try {
    const A = await store.openStore({ now: () => clock.t }), B = await store.openStore({ now: () => clock.t });
    assert.deepEqual(await A.list(), []);
    assert.deepEqual(await B.list(), []);
    const a = await A.put({ kind: 'smp', name: 'From A', L: sine(100, 440, 48000) }, {});
    const b = await B.put({ kind: 'smp', name: 'From B', L: sine(100, 220, 48000) }, {});
    const m = await B.put({ kind: 'multi', name: 'Keys', zones: [{ lo: 0, hi: 63, smp: a }, { lo: 64, hi: 127, smp: b }, { lo: 64, hi: 127, vlo: 100, smp: a }] }, {});
    await A.flush(); await B.flush();
    for (const S of [A, B]) assert.deepEqual((await S.list()).map(r => r.name), ['From A', 'From B', 'Keys'], 'both tabs see both imports');
    assert.deepEqual((await A.list({ kind: 'multi' }))[0].smps, [a, b], 'multisample rows name their zone samples');
    await A.del(b);
    assert.deepEqual((await B.list()).map(r => r.name), ['From A', 'Keys']);
    // existence without PCM; a lost row comes back
    assert.deepEqual([await A.has(a), await A.has(b), await A.has('#rows')], [true, false, false]);
    const raw = idb.dbs.get('synth-smp').stores.get('assets').data.get('#rows');
    delete raw.rows[a];
    assert.deepEqual((await B.list()).map(r => r.name), ['Keys']);
    assert.equal(await B.ensureRow(a), true);
    assert.equal(await B.ensureRow('smp:none'), false);
    assert.deepEqual((await A.list()).map(r => r.name), ['From A', 'Keys']);
    // cache: entries of both tabs counted; touch; keep
    await A.cachePut('gen:x@1', { L: new Float32Array(256).buffer });
    clock.t += 1; await B.cachePut('spec:y@1', { mag: new Float32Array(256) });
    clock.t += 1; await A.cachePut('spec:z@1', { mag: new Float32Array(256) });
    await A.flush(); await B.flush();
    assert.equal(await B.cacheBytes(), 3 * 1024);
    clock.t += 1;
    assert.equal(await B.cacheTouch('gen:x@1'), true);
    assert.equal(await B.cacheTouch('gen:none@1'), false);
    assert.equal(await A.cacheTrim(2048), 1, 'least recently used first: y (x was touched)');
    assert.equal(await A.cacheGet('spec:y@1'), null);
    assert.equal(await B.cacheTrim(0, new Set(['gen:x@1'])), 1, 'kept keys are never evicted');
    assert.ok(await A.cacheGet('gen:x@1'));
    assert.equal(await B.cacheBytes(), 1024);
    A.close(); B.close();
  } finally { delete globalThis.indexedDB; }
});

/* ------------------------------------------------------------------ decoding (§9.3 step 2) */
test('§9.3: readAiff round trips — AIFF 8/16/24/32-bit, AIFC NONE / sowt / fl32 / fl64, > 2 channels, INST + MARK loop', () => {
  const n = 1500, a = sine(n, 440, 44100, 0.7), b = sine(n, 220, 44100, -0.4), c = sine(n, 100, 44100, 0.2);
  const cases = [[null, 8], [null, 16], [null, 24], [null, 32], ['NONE', 16], ['NONE', 24], ['sowt', 16], ['sowt', 24], ['sowt', 32], ['fl32', 32], ['fl64', 64]];
  for (const [comp, bits] of cases) {
    const f = aiffFile({ rate: 44100, ch: [a, b], bits, comp });
    const r = smp.readAiff(f);
    assert.deepEqual([r.rate, r.ch, r.len, r.root, r.loop], [44100, 2, n, null, null], comp + '/' + bits);
    const tol = comp === 'fl32' || comp === 'fl64' ? 1e-7 : Math.pow(2, 1 - Math.min(bits, 24)) + 1e-7;
    let err = 0;
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(r.L[i] - a[i]), Math.abs(r.R[i] - b[i]));
    assert.ok(err <= tol, comp + '/' + bits + ' error ' + err);
    assert.ok(r.L instanceof Float32Array && r.R instanceof Float32Array);
    assert.equal(smp.sniff(f), 'aiff');
  }
  // the first two of three channels; mono; ArrayBuffer input; INST base note and the sustain loop through its MARKs
  const three = smp.readAiff(aiffFile({ rate: 48000, ch: [a, b, c], bits: 16 }).buffer);
  assert.ok(three.ch === 2 && Math.abs(three.R[100] - b[100]) < 1e-4);
  const looped = smp.readAiff(aiffFile({ rate: 22050, ch: [a], bits: 16, inst: { base: 57, mode: 1, begin: 1, end: 2 }, marks: [[1, 100, 'beg'], [2, 900, 'end loop']] }));
  assert.deepEqual([looped.ch, looped.R, looped.rate, looped.root, looped.loop], [1, null, 22050, 57, { start: 100, end: 900 }]);
  const off = smp.readAiff(aiffFile({ rate: 22050, ch: [a], bits: 16, inst: { base: 40, mode: 0, begin: 1, end: 2 }, marks: [[1, 100, 'b'], [2, 900, 'e']] }));
  assert.deepEqual([off.root, off.loop], [40, null], 'play mode 0: no loop');
  // 192 kHz rate in the 80-bit extended field
  assert.equal(smp.readAiff(aiffFile({ rate: 192000, ch: [a], bits: 24 })).rate, 192000);
  assert.throws(() => smp.readAiff(new Uint8Array(40)), /Not an AIFF/);
  const bad = aiffFile({ rate: 44100, ch: [a], bits: 16, comp: 'NONE' });
  bad.set([0x75, 0x6c, 0x61, 0x77], 12 + 8 + 18); // compression 'ulaw'
  assert.throws(() => smp.readAiff(bad), /Unsupported AIFF compression/);
});

test('§9.3: resample — windowed sinc (32 taps, Kaiser β 8): passband ±0.01 dB to 0.84·Nyquist, ≥ 80 dB stopband, length round(len·to/from)', () => {
  const pkDb = (x, f) => 20 * Math.log10(x.subarray(500, -500).reduce((m, v) => Math.max(m, Math.abs(v)), 0) / f);
  for (const [from, to, f] of [[44100, 48000, 1000], [44100, 48000, 18000], [96000, 48000, 20000], [48000, 44100, 18000], [192000, 96000, 40000]]) {
    const r = smp.resample(sine(from, f, from), null, from, to);
    assert.equal(r.L.length, to);
    assert.equal(r.R, null);
    assert.ok(Math.abs(pkDb(r.L, 0.5)) < 0.01, from + '→' + to + ' ' + f + ' Hz: ' + pkDb(r.L, 0.5));
  }
  for (const [from, to, f] of [[96000, 48000, 30000], [96000, 48000, 26000], [48000, 44100, 23000], [192000, 96000, 60000]]) {
    const r = smp.resample(sine(from, f, from), null, from, to);
    assert.ok(pkDb(r.L, 0.5) < -80, from + '→' + to + ' ' + f + ' Hz: ' + pkDb(r.L, 0.5));
  }
  const s = smp.resample(sine(1001, 300, 44100), sine(1001, 300, 44100), 44100, 48000);
  assert.ok(s.L.length === Math.round(1001 * 48000 / 44100) && s.R.length === s.L.length);
  const same = smp.resample([0.25, NaN, -0.5], null, 48000, 48000);
  assert.deepEqual(Array.from(same.L), [0.25, 0, -0.5], 'same rate: a (finite) copy');
  assert.throws(() => smp.resample([0], null, 0, 48000), /rates/);
});

test('§9.3 steps 4–5: rootFromWav — smpl (unity + fraction, first loop end + 1) → inst (note + fine cents) → acid (flag 0x02)', () => {
  const ch = [sine(400, 100, 48000)];
  const wav = extra => wavFile({ rate: 48000, ch, extra });
  assert.deepEqual(smp.rootFromWav(wav([['smpl', smplChunk(57, 0x80000000, [10, 299])]])), { root: 57.5, loop: { start: 10, end: 300 } });
  assert.deepEqual(smp.rootFromWav(wav([['inst', instChunk(62, -25)], ['acid', acidChunk(2, 40)]])), { root: 61.75, loop: null });
  assert.deepEqual(smp.rootFromWav(wav([['acid', acidChunk(2, 40)]])), { root: 40, loop: null });
  assert.deepEqual(smp.rootFromWav(wav([['acid', acidChunk(1, 40)]])), { root: null, loop: null }, 'acid without the root flag');
  assert.deepEqual(smp.rootFromWav(wav([['inst', instChunk(62, 0)], ['smpl', smplChunk(48, 0, null)]])), { root: 48, loop: null }, 'smpl first');
  assert.deepEqual(smp.rootFromWav(wav([])), { root: null, loop: null });
  const f = wav([['smpl', smplChunk(70, 0, [0, 99])]]);
  assert.deepEqual(smp.rootFromWav({ buf: f.buffer }), smp.rootFromWav(f), 'object with the file bytes');
  assert.deepEqual(smp.rootFromWav({ chunks: [{ id: 'inst', data: instChunk(30, 10) }] }), { root: 30.1, loop: null });
  assert.deepEqual(smp.wavChunks(f).map(c => c.id), ['fmt ', 'smpl', 'data']);
  // the rate SFZ frame positions refer to, from the headers: WAV, AIFF, FLAC STREAMINFO, Ogg Vorbis / Opus
  const flac = new Uint8Array(42); flac.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0, 0, 34]); flac[18] = 0x0a; flac[19] = 0xc4; flac[20] = 0x42; // 44100 << 4
  const ogg = (pk) => { const b = new Uint8Array(80); b.set([0x4f, 0x67, 0x67, 0x53]); b[26] = 1; b[27] = 30; b.set(pk, 28); return b; };
  const vorbis = ogg([1, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73, 0, 0, 0, 0, 2, 0x22, 0x56, 0, 0]); // 22050
  const opus = ogg(Array.from('OpusHead', c => c.charCodeAt(0)));
  assert.deepEqual([smp.fileRate(f), smp.fileRate(aiffFile({ rate: 22050, ch: [ch[0]], bits: 16 })), smp.fileRate(flac), smp.fileRate(vorbis), smp.fileRate(opus),
    smp.fileRate(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0])), smp.fileRate(null)], [48000, 22050, 44100, 22050, 48000, null, null]);
  // wt.readWav decodes the same file (the importer's WAV path)
  const w = wt.readWav(f.buffer.slice(0));
  assert.ok(w.sr === 48000 && w.ch.length === 1 && Math.abs(w.ch[0][50] - ch[0][50]) < 1e-4);
});

/* ------------------------------------------------------------------ SFZ (§9.3 step 7) */
const SFZ = `// a test bank
#define $X 1
<control> default_path=Samples\\Piano/ note_offset=0 octave_offset=0
<global> volume=-3 amp_veltrack=50 ampeg_release=0.4
<group> lovel=0 hivel=63 loop_mode=loop_continuous
<region> sample=a.wav lokey=c3 hikey=e3 pitch_keycenter=d3 tune=-10 transpose=1 pan=-50 loop_start=100 loop_end=999
<region> sample=b.wav key=f#3 offset=20 end=4999 seq_length=2 seq_position=2
<group> lovel=64 hivel=127
<region> sample=c.wav lokey=48 hikey=60 amp_veltrack=-20 loop_mode=one_shot cutoff=500
<region> sample=d.wav trigger=release key=60
<master> /* block
comment */ ampeg_attack=0.01 ampeg_sustain=50
<region> sample=e.wav key=c4 amp_veltrack=100
<curve> v000=0
<region> sample=f.wav lokey=a0 hikey=b0 loop_mode=loop_sustain
`;
test('§9.3: parseSfz — headers and inheritance, note names c4 = 60, opcodes, loop modes, round robin, vt, warnings', () => {
  const { regions, warnings } = smp.parseSfz(SFZ);
  assert.deepEqual(regions.map(r => r.sample), ['Samples/Piano/a.wav', 'Samples/Piano/b.wav', 'Samples/Piano/c.wav', 'Samples/Piano/e.wav', 'Samples/Piano/f.wav']);
  const [a, b, c, e, f] = regions;
  assert.deepEqual([a.lo, a.hi, a.root, a.vlo, a.vhi, a.gain, a.pan, a.mode, a.ls, a.le, a.tune], [48, 52, 50, 0, 63, -3, -0.5, 'loop', 100, 1000, -90]);
  assert.deepEqual([a.vt, a.env, a.rr, a.off, a.end], [0.5, [0, 0, 0, 0, 1, 0.4], [1, 1], 0, null], 'global amp_veltrack and ampeg_release inherited');
  assert.deepEqual([b.lo, b.hi, b.root, b.off, b.end, b.rr, b.mode, b.vlo, b.vhi], [54, 54, 54, 20, 5000, [2, 2], 'loop', 0, 63]);
  assert.deepEqual([c.lo, c.hi, c.vlo, c.vhi, c.vt, c.mode], [48, 60, 64, 127, 0, 'oneshot'], 'negative amp_veltrack → 0');
  assert.deepEqual([e.lo, e.root, e.vt, e.vlo, e.env, e.mode], [60, 60, 1, 0, [0, 0.01, 0, 0, 0.5, 0.4], null], '<master> resets the group; amp_veltrack=100 → 1');
  assert.deepEqual([f.lo, f.hi, f.mode, f.ls, f.le], [21, 23, 'sustain', null, null], 'loop_sustain; open loop points');
  // a region without amp_veltrack anywhere: vt = 1 (the SFZ default of 100 %)
  assert.equal(smp.parseSfz('<region> sample=x.wav').regions[0].vt, 1);
  assert.deepEqual(smp.parseSfz('<region> sample=x.wav amp_veltrack=50').regions[0].vt, 0.5);
  assert.ok(warnings.some(w => /Ignored SFZ opcodes: .*cutoff/.test(w)), 'unsupported opcodes listed once');
  assert.ok(warnings.some(w => /<curve>/.test(w)), 'other headers listed');
  assert.ok(warnings.some(w => /1 release-trigger region ignored/.test(w)));
  assert.ok(warnings.some(w => /#define/.test(w)));
  assert.ok(warnings.some(w => /Negative amp_veltrack/.test(w)));
  // note names and offsets
  assert.deepEqual(['c4', 'C4', 'c#4', 'db4', 'a-1', 'g9', '60', ' 61 ', 'x', 'c'].map(smp.sfzNote), [60, 60, 61, 61, 9, 127, 60, 61, null, null]);
  const o = smp.parseSfz('<control> note_offset=2 octave_offset=-1\n<region> sample=y.wav key=c4');
  assert.deepEqual([o.regions[0].lo, o.regions[0].root], [50, 50]);
  assert.deepEqual(smp.parseSfz('').regions, []);
});

/* ------------------------------------------------------------------ ZIP (§9.3 step 6) */
test('§9.3: zipEntries — stored entries as views, deflated ones through the inflater, skipped otherwise; junk left out', async () => {
  const enc = new TextEncoder(), A = enc.encode('<region> sample=x.wav'), B = Uint8Array.from([1, 2, 3, 4, 5]);
  const zip = zipFile([{ name: 'kit/kit.sfz', data: A }, { name: 'kit/x.wav', data: B, method: 8, raw: Uint8Array.from([9, 9]) },
    { name: '__MACOSX/kit/._x.wav', data: B }, { name: 'kit/._y.wav', data: B }, { name: 'kit/', data: new Uint8Array(0) }]);
  assert.equal(smp.sniff(zip), 'zip');
  const noInflate = smp.zipEntries(zip);
  assert.deepEqual(noInflate.map(e => e.name), ['kit/kit.sfz']);
  assert.deepEqual(noInflate.skipped, ['kit/x.wav']);
  assert.deepEqual(Array.from(await noInflate[0].data()), Array.from(A));
  const raw = [];
  const ents = smp.zipEntries(zip.buffer, bytes => { raw.push(Array.from(bytes)); return Promise.resolve(B); });
  assert.deepEqual(ents.map(e => [e.name, e.size, e.method]), [['kit/kit.sfz', A.length, 0], ['kit/x.wav', 5, 8]]);
  assert.deepEqual(Array.from(await ents[1].data()), [1, 2, 3, 4, 5]);
  assert.deepEqual(raw, [[9, 9]], 'the inflater receives the raw deflate bytes');
  assert.throws(() => smp.zipEntries(new Uint8Array(100)), /Not a ZIP/);
});

/* ------------------------------------------------------------------ non-destructive ops (§9.4.2) */
test('§9.4.2: applyOps — trim → reverse → normalize → fade; loop points through trim and reverse; inputs untouched', () => {
  const n = 48000, L = Float32Array.from({ length: n }, (_, i) => 0.5 * (i / n)), R = Float32Array.from({ length: n }, (_, i) => -0.25 * (i / n));
  const rec = { kind: 'smp', rate: 48000, ch: 2, len: n, L, R, root: 60, loop: { start: 12000, end: 36000 }, odf: new Float32Array(10), marks: [0.5] };
  const t = smp.applyOps(rec, { trim: [0.25, 0.75], fade: 0, norm: 0, rev: 0 });
  assert.deepEqual([t.len, t.loop, t.odf, t.marks], [24000, { start: 0, end: 24000 }, null, null]);
  assert.equal(t.L[0], L[12000]);
  const r = smp.applyOps(rec, { trim: [0.25, 0.75], rev: 1 });
  assert.equal(r.L[0], L[35999], 'reversed after trimming');
  const r2 = smp.applyOps(Object.assign({}, rec, { loop: { start: 20000, end: 30000 } }), { trim: [0.25, 0.75], rev: 1 });
  assert.deepEqual(r2.loop, { start: 24000 - 18000, end: 24000 - 8000 }, 'loop mapped through trim, then mirrored');
  const nm = smp.applyOps(rec, { trim: [0, 0.5], norm: 1 });
  assert.ok(Math.abs(nm.L.reduce((m, v) => Math.max(m, Math.abs(v)), 0) - 1) < 1e-6 && Math.abs(nm.R[23999] / nm.L[23999] + 0.5) < 1e-6, 'one gain for both channels');
  const fd = smp.applyOps(rec, { fade: 4 }); // FADE_MS[4] = 8 ms = 384 samples
  assert.deepEqual([fd.len, fd.L[0], fd.L[n - 1]], [n, 0, 0]);
  assert.ok(fd.L[384] === L[384] && fd.L[200] < L[200] && fd.L[200] > 0 && fd.L[n - 385] === L[n - 385]);
  assert.ok(fd.odf instanceof Float32Array, 'fade alone keeps the onset function');
  const id = smp.applyOps(rec, { trim: [0, 1], fade: 0 });
  assert.ok(id.len === n && id.L !== L && id.L[100] === L[100], 'neutral ops: a copy');
  assert.equal(L[0], 0, 'input untouched');
  assert.deepEqual(smp.FADE_MS, [0, 1, 2, 4, 8, 16, 32, 64, 128]);
  assert.throws(() => smp.applyOps(null, {}), /no record/);
});

/* ------------------------------------------------------------------ onset function, slices (§9.4.5) */
test('§9.4.5: odf peaks for a click train at the click positions (±1 hop); slicesFromOdf keeps ≥ 50 ms, ≤ 256 marks', () => {
  const rate = 48000, n = 2 * rate, x = new Float32Array(n), clicks = [3000, 15000, 27500, 40100, 52000, 70000, 85000];
  for (const c of clicks) for (let i = 0; i < 64; i++) x[c + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 20);
  const o = smp.odf(x, null, rate);
  assert.equal(o.length, Math.ceil(n / 256));
  assert.ok(o.every(v => v >= 0 && v <= 1) && Math.max(...o) === 1);
  const marks = smp.slicesFromOdf(o, 0.3, rate, n);
  assert.equal(marks.length, clicks.length);
  marks.forEach((m, i) => assert.ok(Math.abs(m * n - clicks[i]) <= 256, 'mark ' + i + ': ' + m * n + ' vs ' + clicks[i]));
  assert.ok(smp.odf(new Float32Array(5000), null, rate).every(v => v === 0), 'silence: zeros');
  // minimum distance 50 ms and the cap
  const dense = Float32Array.from({ length: 4000 }, (_, t) => (t % 2 ? 1 : 0));
  const dm = smp.slicesFromOdf(dense, 0.5, rate, 4000 * 256);
  assert.ok(dm.length <= 256);
  for (let i = 1; i < dm.length; i++) assert.ok((dm[i] - dm[i - 1]) * 4000 * 256 >= 0.05 * rate - 1e-6);
  assert.deepEqual(smp.slicesFromOdf(o, 2, rate, n), [], 'nothing above the threshold');
  assert.deepEqual(smp.slicesFromOdf(null, 0.5, rate, n), []);
});

/* ------------------------------------------------------------------ spectral analysis (§9.4.6) */
test('§9.4.6: specAnalyse — a full-scale sine reads 1 at its bin, phase advances by 2π·f·hop/rate, frames, caps', () => {
  const rate = 48000, n = rate, f = 1000; // between bins (bin width 23.4 Hz): peak bin 43
  const a = smp.specAnalyse(sine(n, f, rate, 1), null, rate);
  assert.deepEqual([a.rate, a.len, a.N, a.hop, a.frames], [rate, n, 2048, 512, Math.floor(n / 512) + 1]);
  const nb = 1025, k = Math.round(f * 2048 / rate);
  assert.ok(a.mag.length === a.frames * nb && a.ph.length === a.mag.length && a.trans.length === a.frames);
  const c = sine(n, 937.5, rate, 1), b = smp.specAnalyse(c, null, rate); // bin-centred (bin 40)
  for (const t of [10, 40, 80]) assert.ok(Math.abs(b.mag[t * nb + 40] - 1) < 0.01, 'bin-centred magnitude ' + b.mag[t * nb + 40]);
  for (const t of [10, 40, 80]) {
    const m = a.mag.subarray(t * nb, (t + 1) * nb);
    let best = 0; for (let j = 1; j < nb; j++) if (m[j] > m[best]) best = j;
    assert.equal(best, k);
    const d = a.ph[(t + 1) * nb + k] - a.ph[t * nb + k], want = 2 * Math.PI * f * 512 / rate;
    const wrap = v => v - 2 * Math.PI * Math.round(v / (2 * Math.PI));
    assert.ok(Math.abs(wrap(d - want)) < 1e-3, 'phase advance ' + wrap(d - want));
    assert.ok(a.ph[t * nb + k] > -Math.PI - 1e-9 && a.ph[t * nb + k] <= Math.PI + 1e-9);
  }
  assert.ok(Math.abs(a.peak - 1) < 1e-6);
  // transients: a click in silence is flagged, the steady sine is not
  const x = new Float32Array(n);
  for (let i = 0; i < 32; i++) x[24000 + i] = 0.9 * (i % 2 ? -1 : 1);
  const tr = smp.specAnalyse(x, null, rate);
  assert.ok(tr.trans.some(v => v === 1) && tr.trans.slice(0, 40).every(v => v === 0));
  assert.ok(a.trans.slice(8, 80).every(v => v === 0), 'no transient inside a steady sine');
  // > 48 kHz input is analysed at 48 kHz; the first 20 s only (≤ 16 MB per analysis)
  const hi = smp.specAnalyse(sine(96000, 1000, 96000, 1), null, 96000);
  assert.deepEqual([hi.rate, hi.len], [48000, 48000]);
  const long = smp.specAnalyse(new Float32Array(25 * rate), null, rate);
  assert.equal(long.len, 20 * rate);
  assert.ok(long.mag.byteLength + long.ph.byteLength + long.trans.byteLength <= 16e6, 'analysis bytes ' + (long.mag.byteLength * 2));
  // stereo → mono sum
  const st = smp.specAnalyse(sine(n, 937.5, rate, 1), sine(n, 937.5, rate, -1), rate);
  assert.ok(st.mag[40 * nb + 40] < 1e-6, 'L + R cancel');
});

/* ------------------------------------------------------------------ impulse responses (§9.4.7, §8.4, §4.5) */
const noiseIr = (len, decay, seed, delay = 0) => { const r = wt.mulberry32(seed); return Float32Array.from({ length: len }, (_, i) => (i < delay ? 0 : (2 * r() - 1) * Math.exp(-(i - delay) / decay))); };
test('§9.4.7: irPrepare — resampled, leading (< −60 dB, 1 ms kept) and trailing (< −90 dB) trimmed, larger channel energy 1, ≤ 10 s', () => {
  const n = 30000, L = noiseIr(n, 2000, 1, 2000), R = noiseIr(n, 2000, 2, 2000);
  R[1000] = 1e-4; // −80 dB re the peak: below the −60 dB head threshold
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const head = pk * 1e-3, tail = pk * Math.pow(10, -90 / 20);
  let first = 0, last = n - 1;
  while (Math.abs(L[first]) <= head && Math.abs(R[first]) <= head) first++;
  while (Math.abs(L[last]) <= tail && Math.abs(R[last]) <= tail) last--;
  assert.ok(first >= 2000 && first < 2010 && last < n - 1000, 'fixture: ' + first + ' … ' + last);
  const p = smp.irPrepare({ kind: 'ir', name: 'Hall', rate: 48000, ch: 2, len: n, L, R }, 48000);
  assert.deepEqual([p.kind, p.name, p.rate, p.ch], ['ir', 'Hall', 48000, 2]);
  const s = first - 48; // 1 ms kept before the first louder sample
  assert.equal(p.len, last + 1 - s, 'head and tail trimmed');
  const g = p.L[200] / L[s + 200];
  for (const i of [0, 48, 1000, p.len - 1]) { assert.ok(Math.abs(p.L[i] - g * L[s + i]) < 1e-6 && Math.abs(p.R[i] - g * R[s + i]) < 1e-6, 'one gain, sample ' + i); }
  const e = x => x.reduce((a, v) => a + v * v, 0);
  assert.ok(Math.abs(Math.max(e(p.L), e(p.R)) - 1) < 1e-5, 'the larger channel energy is 1');
  assert.ok(Math.abs(p.peak - Math.max(...Array.from(p.L, Math.abs), ...Array.from(p.R, Math.abs))) < 1e-9);
  // rate change (44.1 → 48 kHz), mono, cap 10 s
  const q = smp.irPrepare({ kind: 'ir', rate: 44100, ch: 1, L: noiseIr(44100, 40000, 3) }, 48000);
  assert.ok(q.rate === 48000 && q.ch === 1 && q.R === null && Math.abs(q.len - 48000) < 4, 'len ' + q.len);
  const big = smp.irPrepare({ kind: 'ir', rate: 48000, ch: 1, L: Float32Array.from({ length: 12 * 48000 }, (_, i) => (i % 7 ? 0.5 : -0.5)) }, 48000);
  assert.equal(big.len, 10 * 48000);
  assert.throws(() => smp.irPrepare({ kind: 'ir', rate: 48000, L: new Float32Array(100) }, 48000), /silent/);
});

test('§8.4: irShape — neutral identity, SIZE / TONE / ATTACK / DECAY / DAMP, MIN PHASE keeps |H| (±0.1 dB) and front-loads the energy', () => {
  const n = 4800, L = noiseIr(n, 800, 7), R = noiseIr(n, 800, 8), rec = { kind: 'ir', rate: 48000, ch: 2, len: n, L, R };
  const id = smp.irShape(rec, {}, 10);
  assert.ok(id.L.every((v, i) => v === L[i]) && id.R.every((v, i) => v === R[i]), 'neutral shape: bit-identical');
  assert.deepEqual(Object.keys(smp.irShape(rec, { size: 1, tone: 0, minph: 0, att: 0, dec: 1, damp: 0 }, 10)), ['L', 'R']);
  assert.equal(smp.irShape(rec, { size: 2 }, 10).L.length, 2 * n);
  assert.equal(smp.irShape(rec, { size: 0.5 }, 10).L.length, n / 2);
  assert.equal(smp.irShape(rec, { size: 10 }, 0.5).L.length, 24000, 'convMax caps the stretched length');
  assert.equal(smp.irShape(rec, { dec: 0.25 }, 10).L.length, 1200);
  const d = smp.irShape(rec, { dec: 0.5 }, 10).L;
  assert.ok(d[0] === L[0] && Math.abs(d[2399]) < Math.abs(L[2399]) * 0.01 + 1e-9, 'half-cosine fade over the last 30 %');
  const at = smp.irShape(rec, { att: 1 }, 10).L;
  assert.ok(at[0] === 0 && at[2400] === L[2400] && Math.abs(at[1200]) < Math.abs(L[1200]), 'raised-cosine fade-in over half the IR');
  const band = (x, lo, hi) => { const N = 8192, re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < x.length; i++) re[i] = x[i]; smp.fft(re, im, N, false); let s = 0; for (let k = Math.round(lo * N / 48000); k < Math.round(hi * N / 48000); k++) s += re[k] * re[k] + im[k] * im[k]; return s; };
  const lp = smp.irShape(rec, { tone: -0.5 }, 10).L, hp = smp.irShape(rec, { tone: 0.5 }, 10).L;
  assert.ok(band(lp, 8000, 20000) < 0.2 * band(L, 8000, 20000) && band(lp, 50, 200) > 0.8 * band(L, 50, 200), 'tone < 0: one-pole low-pass at 20000·2^(8·tone) = 1250 Hz');
  assert.ok(band(hp, 20, 200) < 0.5 * band(L, 20, 200) && band(hp, 5000, 20000) > 0.95 * band(L, 5000, 20000), 'tone > 0: high-pass at 20·2^(8·tone) = 320 Hz');
  const dm = smp.irShape(rec, { damp: 1 }, 10).L, late = x => x.subarray(3000);
  assert.ok(band(late(dm), 6000, 20000) < 0.1 * band(late(L), 6000, 20000) && band(late(dm), 50, 500) > 0.7 * band(late(L), 50, 500), 'DAMP: highs decay across the IR');
  // MIN PHASE: |H| in third-octave bands ±0.1 dB; a delayed decaying pulse becomes the undelayed one (every bin)
  const mp = smp.irShape(rec, { minph: 1 }, 10).L;
  for (let b = 0; b < 30; b++) {
    const f0 = 20 * Math.pow(2, b / 3), f1 = f0 * Math.pow(2, 1 / 3);
    const db = 10 * Math.log10(band(mp, f0, f1) / band(L, f0, f1));
    assert.ok(Math.abs(db) < 0.1, 'band ' + f0.toFixed(0) + ' Hz: ' + db);
  }
  const cum = x => { let t = 0, h = 0; for (let i = 0; i < x.length; i++) { t += x[i] * x[i]; if (i < x.length / 10) h += x[i] * x[i]; } return h / t; };
  assert.ok(cum(mp) > cum(L) + 0.05, 'energy front-loaded: ' + cum(mp) + ' vs ' + cum(L));
  const pulse = new Float32Array(n); for (let i = 300, v = 1; i < n; i++, v *= 0.995) pulse[i] = v;
  const pm = smp.irShape({ kind: 'ir', rate: 48000, ch: 1, L: pulse }, { minph: 1 }, 10);
  assert.ok(pm.R === null && Math.abs(pm.L[0] - 1) < 1e-4 && Math.abs(pm.L[1] - 0.995) < 1e-4);
  assert.throws(() => smp.irShape(null, {}, 10), /no record/);
});

test('§4.5: irPartition — head taps [0, 128), FFT-256 spectra of [128, 8192), FFT-8192 spectra from 8192; SxBase accepts the entry', () => {
  const n = 20000, L = noiseIr(n, 6000, 11), R = noiseIr(n, 6000, 12);
  const p = smp.irPartition(L, R, 48000);
  assert.deepEqual([p.len, p.ch, p.rate, p.head.length, p.hp.length, p.tp.length], [n, 2, 48000, 2, 2, 2]);
  assert.deepEqual([p.hp[0].n, p.hp[0].re.length, p.tp[0].n, p.tp[0].re.length], [63, 63 * 129, 3, 3 * 4097]);
  assert.ok(p.head[1].every((v, i) => v === R[i]));
  // each partition's half spectrum is the unscaled FFT of the zero-padded slice: the inverse gives the slice back
  const back = (P, j, B) => {
    const N = 2 * B, re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k <= B; k++) { re[k] = P.re[j * (B + 1) + k]; im[k] = P.im[j * (B + 1) + k]; if (k > 0 && k < B) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
    smp.fft(re, im, N, true);
    return re;
  };
  for (const [c, x] of [[0, L], [1, R]]) {
    for (const j of [0, 31, 62]) { const y = back(p.hp[c], j, 128); for (let i = 0; i < 256; i++) assert.ok(Math.abs(y[i] - (i < 128 ? x[128 + 128 * j + i] : 0)) < 1e-6); }
    const y = back(p.tp[c], 2, 4096);
    for (let i = 0; i < 8192; i += 7) assert.ok(Math.abs(y[i] - (i < 4096 && 16384 + i < n ? x[16384 + i] : 0)) < 1e-5);
  }
  const e = Object.assign({ id: 'ir:t@48000~00000000', v: 1, kind: 'ir', bytes: 0 }, p);
  assert.ok(valid(e), 'stereo shaped-IR entry');
  const short = smp.irPartition(new Float32Array(100).fill(0.1), null, 44100);
  assert.deepEqual([short.ch, short.hp[0].n, short.tp[0].n, short.rate], [1, 0, 0, 44100]);
  assert.ok(valid(Object.assign({ id: 'ir:s', v: 1, kind: 'ir', bytes: 0 }, short)), 'an IR shorter than the head');
});

/* ------------------------------------------------------------------ loop search (§10.1) */
test('§10.1: loopSearch — upward zero crossings, a multiple (≥ 0.25 s) of the period, seam error small for a sawtooth', () => {
  const rate = 48000, f0 = 110, n = 2 * rate;
  const saw = Float32Array.from({ length: n }, (_, i) => { const ph = (i * f0 / rate + 0.25) % 1; return 0.8 * (2 * ph - 1); });
  const from = Math.round(0.45 * 1.5 * rate), to = Math.round(0.95 * 1.5 * rate);
  for (const f of [f0, 0]) {
    const lp = smp.loopSearch(saw, null, rate, from, to, f);
    assert.ok(lp.ls >= from && lp.le <= to && lp.le > lp.ls, JSON.stringify(lp));
    for (const p of [lp.ls, lp.le]) assert.ok(saw[p - 1] < 0 && saw[p] >= 0, 'upward zero crossing at ' + p);
    const periods = (lp.le - lp.ls) * f0 / rate;
    assert.ok(lp.le - lp.ls >= 0.25 * rate - rate / f0 && Math.abs(periods - Math.round(periods)) < 0.02, 'periods ' + periods);
    assert.ok(lp.err < 0.02, 'seam error ' + lp.err);
  }
  assert.ok(Math.abs(smp.yinF0(Float64Array.from(saw), rate, from, to) - f0) < 0.5);
  const none = smp.loopSearch(new Float32Array(1000), null, rate, 0, 1000, 0);
  assert.deepEqual([none.ls, none.le], [0, 1000], 'no crossings: the region');
});

/* ------------------------------------------------------------------ displays */
test('overview (min/max columns over both channels), spectrogram (log-frequency dB image), irRT60', () => {
  const L = Float32Array.from([0, 1, -1, 0.5, 0, 0, 0, 0.25]), R = Float32Array.from([0, 0, 0, 0, -0.5, 0, 0, 0]);
  assert.deepEqual(Array.from(smp.overview(L, R, 2)), [-1, 1, -0.5, 0.25]);
  assert.deepEqual(Array.from(smp.overview(L, null, 4)), [0, 1, -1, 0.5, 0, 0, 0, 0.25]);
  assert.equal(smp.overview(new Float32Array(0), null, 3).length, 6);
  const sp = smp.spectrogram(sine(48000, 1000, 48000, 1), null, 48000, 16, 32);
  assert.ok(sp.w === 16 && sp.h === 32 && sp.data.length === 512);
  const row = Math.round((Math.log(1000 / 20) / Math.log(24000 / 20)) * 32), y = 32 - 1 - row;
  assert.ok(sp.data[y * 16 + 8] > 240 || sp.data[(y + 1) * 16 + 8] > 240 || sp.data[(y - 1) * 16 + 8] > 240, 'the 1 kHz row is near 0 dB');
  assert.ok(sp.data[0 * 16 + 8] < 60, 'the top row (≈ 20 kHz) is quiet');
  const r = wt.mulberry32(5), ir = Float32Array.from({ length: 96000 }, (_, i) => (2 * r() - 1) * Math.pow(10, -3 * i / 48000 / 1.2));
  assert.ok(Math.abs(smp.irRT60(ir, 48000) - 1.2) < 0.06 && Math.abs(smp.irRT60(ir, 48000, [500, 2000]) - 1.2) < 0.08);
  assert.ok(Number.isNaN(smp.irRT60(new Float32Array(10), 48000)));
});

/* ------------------------------------------------------------------ smpwork protocol (§9.4.1) */
test('§9.4.1: smpwork.handle — every op answers {q, ok, …} with its buffers in the transfer list; errors {ok: false, err}; never rejects', async () => {
  assert.deepEqual(work.OPS, ['resample', 'odf', 'entry', 'spec', 'ir', 'irshape', 'wtsmp', 'multi', 'gen', 'loop', 'spectrogram', 'irview', 'farm']);
  const bad = await work.handle({ q: 1, op: 'nope' });
  assert.deepEqual([bad.msg.q, bad.msg.ok, bad.transfer.length], [1, false, 0]);
  assert.match(bad.msg.err, /unknown op/);
  assert.equal((await work.handle(null)).msg.ok, false);
  assert.equal((await work.handle({ q: 2, op: 'entry', id: 'smp:x', rec: null })).msg.ok, false, 'a failing helper → ok: false');
  const bufsOf = v => { const s = new Set(); (function walk(x) { if (x && typeof x === 'object') { if (ArrayBuffer.isView(x)) s.add(x.buffer); else Object.values(x).forEach(walk); } })(v); return s; };
  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const L = sine(20000, 300, 32000), R = sine(20000, 150, 32000);
  const call = async (op, req) => {
    const r = await work.handle(Object.assign({ q: op, op }, req));
    assert.equal(r.msg.ok, true, op + ': ' + r.msg.err);
    assert.equal(r.msg.q, op);
    const { q, ok, ...payload } = r.msg;
    assert.ok(sameSet(new Set(r.transfer), bufsOf(payload)), op + ': every buffer of the reply is transferred once');
    return r.msg;
  };
  // resample, odf, loop, spectrogram
  const rs = await call('resample', { L, R, rate: 32000, to: 48000 });
  assert.deepEqual([rs.rate, rs.L.length, rs.R.length], [48000, 30000, 30000]);
  assert.equal((await call('odf', { L, R: null, rate: 32000 })).odf.length, Math.ceil(20000 / 256));
  const lp = await call('loop', { L, R: null, rate: 32000, from: 0, to: 20000, f0: 300 });
  assert.ok(lp.le > lp.ls && L[lp.ls - 1] < 0 && L[lp.ls] >= 0);
  const sg = await call('spectrogram', { L, R, rate: 32000, w: 8, h: 4 });
  assert.ok(sg.w === 8 && sg.h === 4 && sg.data.length === 32);
  // playback entries: trim and fade baked, rev / norm not (CP flags), > 48 kHz resampled with the loop scaled
  const rec = { kind: 'smp', rate: 32000, ch: 2, len: 20000, L, R, root: 64, loop: { start: 2000, end: 18000 } };
  const e0 = (await call('entry', { id: 'smp:x', rec, ops: { trim: null, fade: 0, norm: 1, rev: 1 } })).entry;
  assert.ok(valid(e0) && e0.len === 20000 && e0.levels[0].L[5] === L[5], 'rev / norm are not baked');
  const e1 = (await call('entry', { id: 'smp:x~1', rec, ops: { trim: [0.1, 0.9], fade: 3 } })).entry;
  assert.ok(valid(e1));
  assert.deepEqual([e1.len, e1.loop, Math.abs(e1.levels[0].L[0])], [16000, { start: 0, end: 16000 }, 0], 'trimmed, faded, loop mapped');
  assert.ok(Math.abs(e1.levels[0].L[8000] - L[10000]) < 1e-7, 'the middle is the trimmed data');
  const hiRec = { kind: 'smp', rate: 96000, ch: 1, len: 96000, L: sine(96000, 1000, 96000), R: null, root: 60, loop: { start: 9600, end: 86400 } };
  const e2 = (await call('entry', { id: 'smp:hi', rec: hiRec, ops: null })).entry;
  assert.deepEqual([e2.rate, e2.len, e2.loop, e2.ch], [48000, 48000, { start: 4800, end: 43200 }, 1], 'entries are ≤ 48 kHz');
  assert.ok(valid(e2));
  assert.equal((await call('entry', { id: 'smp:z', rec, ops: null, maxLevels: 2 })).entry.levels.length, 2, 'maxLevels (zone entries)');
  // spectral analysis entry: the playback data (reversed for rev), the record's root, validated by SxBase
  const s0 = (await call('spec', { id: 'spec:smp:x', rec, ops: null })).entry;
  assert.ok(valid(s0) && s0.root === 64 && s0.rate === 32000 && !s0.capped);
  const s1 = (await call('spec', { id: 'spec:smp:x~r', rec, ops: { rev: 1 } })).entry;
  const nb = s0.N / 2 + 1;
  assert.ok(Math.abs(s1.mag[(s1.frames - 1 - 10) * nb + 10] - s0.mag[10 * nb + 10]) < 0.02, 'reversed analysis');
  const s2 = (await call('spec', { id: 'spec:smp:hi', rec: hiRec, ops: null })).entry;
  assert.deepEqual([s2.rate, s2.len], [48000, 48000]);
  const longRec = { kind: 'smp', rate: 48000, ch: 1, len: 21 * 48000, L: new Float32Array(21 * 48000).fill(0.1), R: null, root: 60 };
  const s3 = (await call('spec', { id: 'spec:smp:long', rec: longRec, ops: null })).entry;
  assert.ok(s3.capped === 1 && s3.len === 20 * 48000 && s3.bytes <= 16e6 && valid(s3), 'the 20 s cap (≤ 16 MB)');
  // IRs: prepared record; shaped entry at the requested rate (validated); convMax caps the shaped length
  const irRec = { kind: 'ir', rate: 44100, ch: 2, len: 20000, L: noiseIr(20000, 4000, 1), R: noiseIr(20000, 4000, 2), hash: 'h1' };
  const ir = (await call('ir', { rec: irRec, rate: 48000 })).rec;
  assert.ok(ir.kind === 'ir' && ir.rate === 48000 && ir.ch === 2);
  const sh = (await call('irshape', { id: 'ir:h1@48000~0a0b0c0d', rec: irRec, rate: 48000, shape: { size: 1, dec: 0.5 } })).entry;
  assert.ok(valid(sh) && sh.rate === 48000 && sh.id === 'ir:h1@48000~0a0b0c0d' && Math.abs(sh.len - ir.len / 2) <= 1);
  const sh2 = (await call('irshape', { id: 'ir:h1@48000~1', rec: irRec, rate: 48000, shape: { size: 10 }, convMax: 1 })).entry;
  assert.equal(sh2.len, 48000);
  const iv = await call('irview', { id: 'ir:h1@48000~0a0b0c0d', rec: irRec, rate: 48000, shape: { dec: 0.5 }, n: 16 });
  assert.ok(iv.ov.length === 32 && iv.len === sh.len && iv.ov[1] > 0 && iv.ov[0] < 0, 'overview of the shaped IR (its own length)');
  const full = await call('irview', { id: 'ir:h1@48000~00000000', rec: irRec, rate: 48000, shape: {}, n: 16 });
  assert.ok(full.len === ir.len && full.ov.some((v, i) => v !== iv.ov[i]), 'neutral shape: the prepared IR');
  // a wavetable played as a sample: playback + spectral entries (root 18.232 on both)
  const frames = new Float32Array(3 * 2048).map((_, i) => Math.sin(2 * Math.PI * (i % 2048) / 2048));
  const ws = await call('wtsmp', { id: 'factory:X', frames });
  assert.deepEqual(ws.entries.map(e => e.id), ['wtsmp:factory:X', 'spec:wtsmp:factory:X']);
  assert.ok(ws.entries.every(valid) && ws.entries.every(e => Math.abs(e.root - smp.WT_ROOT) < 1e-12));
  assert.deepEqual(ws.entries[0].loop, { start: 0, end: 6144 });
  const wv = await call('wtsmp', { id: 'wtsmp:factory:X', playId: 'wtsmp:factory:X~0f0f0f0f', frames: frames.slice(), ops: { trim: [0, 0.5], fade: 0, rev: 1 }, want: ['spec'] });
  assert.deepEqual(wv.entries.map(e => [e.id, e.len]), [['spec:wtsmp:factory:X~0f0f0f0f~r', 3072]]);
  // multisample entry: zones copied; ls / le / off of a > 48 kHz zone sample scaled; vt defaults to 1
  const zones = [{ lo: 0, hi: 63, vlo: 0, vhi: 127, root: 48, tune: 0, gain: 0, pan: 0, smp: 'smp:a', mode: 'loop', ls: 960, le: 9600, off: 96, env: null, rr: [1, 1] },
    { lo: 64, hi: 127, vlo: 0, vhi: 127, root: 72, tune: -5, gain: -3, pan: 0.5, smp: 'smp:b', mode: 'sustain', ls: 5, le: 5, off: 0, env: [0, 0.01, 0, 0.2, 0.5, 0.3], rr: [2, 1], vt: 0.5 }];
  const m = (await call('multi', { id: 'msmp:k', rec: { kind: 'multi', zones }, rates: { 'smp:a': 96000 } })).entry;
  assert.ok(valid(m));
  assert.deepEqual([m.zones[0].ls, m.zones[0].le, m.zones[0].off, m.zones[0].vt], [480, 4800, 48, 1]);
  assert.deepEqual([m.zones[1].mode, m.zones[1].vt, m.zones[1].env], ['oneshot', 0.5, [0, 0.01, 0, 0.2, 0.5, 0.3]], 'an empty loop plays one-shot');
  // generated factory records
  const g = await call('gen', { id: 'fir:Cab/Radio' });
  assert.ok(g.rec.kind === 'ir' && g.rec.ch === 1 && g.rec.len === 2048 && g.rec.factory === 1);
  assert.equal((await call('gen', { id: 'fsmp:Nothing' })).rec, null, 'unknown factory id → null record');
  assert.equal((await call('gen', { id: 'fmsmp:Juno Pad' })).rec, null, 'render-farm content is not generated here');
  // (M4) farm: the render-farm post-processing off the main thread — the result of smpgen's multiFromRenders /
  // sampleFromRenders for the same plan and renders
  const gen = await imp('smpgen.js');
  for (const id of ['fmsmp:Juno Pad', 'fsmp:Piano Phrase']) {
    const plan = gen.renderPlan(id), mk = () => plan.notes.map((nt, i) => ({ L: sine(9600, 110 + 7 * i, 48000), R: sine(9600, 113 + 7 * i, 48000) }));
    const want = plan.kind === 'multi' ? gen.multiFromRenders(plan, mk()) : gen.sampleFromRenders(plan, mk());
    const fm = await call('farm', { plan, renders: mk() });
    assert.deepEqual(plan.kind === 'multi' ? fm.res : fm.rec, want, id + ': the same records');
  }
});

/* ------------------------------------------------------------------ minimal fake IndexedDB (as tests/wtstore.test.mjs) */
function fakeIDB() {
  const dbs = new Map();
  const later = fn => setTimeout(fn, 0);
  class Req { constructor(tx) { this.transaction = tx; this.result = undefined; this.error = null; } }
  function makeTx(db, names) {
    const tx = { error: null, pending: 0, oncomplete: null, onerror: null, onabort: null };
    const settle = () => { if (--tx.pending === 0) later(() => tx.oncomplete && tx.oncomplete()); };
    const run = fn => { const r = new Req(tx); tx.pending++; later(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } settle(); }); return r; };
    tx.objectStore = name => {
      if (!names.includes(name)) throw new Error('NotFoundError');
      const st = db.stores.get(name);
      return {
        get: k => run(() => (st.data.has(k) ? structuredClone(st.data.get(k)) : undefined)),
        put: v => run(() => { st.data.set(v[st.keyPath], structuredClone(v)); return v[st.keyPath]; }),
        delete: k => run(() => { st.data.delete(k); }),
        count: k => run(() => (st.data.has(k) ? 1 : 0)),
        getAll: () => run(() => Array.from(st.data.values(), v => structuredClone(v))),
        index: n => ({ getAll: q => run(() => Array.from(st.data.values()).filter(v => v[st.indexes.get(n)] === q).map(v => structuredClone(v))) }),
      };
    };
    return tx;
  }
  return {
    dbs,
    open(name, version) {
      const r = new Req(null);
      later(() => {
        let d = dbs.get(name);
        const upgrade = !d || d.version < version;
        if (!d) { d = { version, stores: new Map() }; dbs.set(name, d); }
        const db = {
          objectStoreNames: { contains: n => d.stores.has(n) },
          createObjectStore(n, o) {
            const st = { keyPath: o.keyPath, indexes: new Map(), data: new Map() };
            d.stores.set(n, st);
            return { createIndex: (iname, kp) => { st.indexes.set(iname, kp); } };
          },
          transaction: (names, mode) => makeTx(d, [].concat(names), mode),
          close() { this.closed = true; },
        };
        r.result = db;
        if (upgrade) { d.version = version; r.onupgradeneeded && r.onupgradeneeded(); }
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
}

/* ------------------------------------------------------------------ review round (S1 fixes) */
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
test('§9.4.3 (IMPL): loop-aware levels — a whole-length loop is decimated circularly, an inner loop wraps the taps that leave it', () => {
  // a wavetable played as a sample (whole-table loop) = wt.noiseLevels' circular levels, at every level
  for (const id of ['factory:Default', 'factory:Basic Shapes']) {
    const rec = smp.wtAsSample(wt.factoryTable(id).frames), e = work.playbackEntry('wtsmp:' + id, rec, null, 8);
    const c = wt.noiseLevels(rec.L, null, rec.len, 0, rec.len, true, 8);
    assert.equal(e.levels.length, c.length);
    e.levels.forEach((l, i) => assert.ok(same(l.L, c[i].L), id + ' level ' + i));
  }
  // a cosine cycle looped whole: no jump at the wrap at any level (linear decimation zero-pads the ends)
  const n = 8192, cyc = 8, x = Float32Array.from({ length: n }, (_, i) => Math.cos(2 * Math.PI * cyc * i / n));
  const lin = smp.sampleLevels(x, null, n, 4), circ = smp.sampleLevels(x, null, n, 4, { start: 0, end: n });
  const wrapJump = l => Math.abs(l.L[0] - l.L[l.len - 1]);
  assert.ok(wrapJump(circ[3]) < 0.1 && wrapJump(lin[3]) > 0.3, 'wrap step at level 3: ' + wrapJump(circ[3]) + ' vs linear ' + wrapJump(lin[3]));
  // an inner loop [a, b): outputs inside it see the loop's continuation; outputs outside are the linear ones
  const m = 20000, y = Float32Array.from({ length: m }, (_, i) => Math.sin(2 * Math.PI * 300 * i / 48000) * (i < 15000 ? 1 : 0.2));
  const a = 4000, b = 12000, lv = smp.sampleLevels(y, null, m, 2, { start: a, end: b })[1].L, ln = smp.sampleLevels(y, null, m, 2)[1].L;
  const H = wt.HALFBAND, at = i => (i >= b ? y[a + ((i - b) % (b - a))] : i < a ? y[b - 1 - ((a - 1 - i) % (b - a))] : y[i]);
  for (const c of [a, a + 2, b - 2, b - 32]) {
    let acc = H[31] * y[c];
    for (let k = 1; k <= 31; k += 2) acc += H[31 + k] * (at(c - k) + at(c + k));
    assert.ok(Math.abs(lv[c / 2] - acc) < 1e-6, 'wrapped taps at ' + c);
  }
  for (const c of [0, a - 40, b, m - 2]) assert.equal(lv[c / 2], ln[c / 2], 'outside the loop: linear at ' + c);
  // playback entries use their loop
  const e = work.playbackEntry('smp:l', { kind: 'smp', rate: 48000, ch: 1, len: m, L: y, R: null, root: 60, loop: { start: a, end: b } }, null, 2);
  assert.ok(same(e.levels[1].L, lv));
});

test('§10.1 (IMPL): loopSearch judges every channel; bakeLoop makes the wrap continuous per channel and leaves periodic material alone', () => {
  const sr = 48000, n = 2 * sr, f = 200, P = sr / f;
  // mono part periodic at the period; the side part a slow sweep that never repeats
  const mid = i => 0.5 * Math.sin(2 * Math.PI * f * i / sr), side = i => 0.3 * Math.sin(2 * Math.PI * (3 + 4 * i / n) * i / sr * 50);
  const L = Float32Array.from({ length: n }, (_, i) => mid(i) + side(i)), R = Float32Array.from({ length: n }, (_, i) => mid(i) - side(i));
  const lp = smp.loopSearch(L, R, sr, 0.4 * sr, 1.6 * sr, f);
  const seam = (x, a, b) => { let e = 0; for (let j = -16; j < 16; j++) e += (x[a + j] - x[b + j]) ** 2; return Math.sqrt(e / 32); };
  assert.ok(Math.abs(lp.err - Math.sqrt((seam(L, lp.ls, lp.le) ** 2 + seam(R, lp.ls, lp.le) ** 2) / 2)) < 1e-9, 'err = RMS seam over both channels');
  const bk = smp.bakeLoop(L, R, lp.ls, lp.le, 4800);
  assert.ok(bk.pre === 4800 && bk.post === 4800 && bk.L !== L && L[lp.le - 1] !== bk.L[lp.le - 1], 'fresh arrays, inputs untouched');
  for (const [x, y] of [[L, bk.L], [R, bk.R]]) {
    assert.equal(y[lp.le - 1], x[lp.ls - 1], 'the last frame before the end continues into the loop start');
    assert.equal(y[lp.le], x[lp.ls], 'a wrap and a release both continue');
    assert.ok(seam(y, lp.ls, lp.le) < 1e-3 * 0.5, 'per-channel seam after the bake: ' + seam(y, lp.ls, lp.le));
    for (let i = 0; i < lp.ls - 1; i++) if (y[i] !== x[i]) { assert.fail('data before the crossfade changed at ' + i); break; }
  }
  // perfectly periodic material (loop = whole periods): the crossfade changes nothing (equal-amplitude gains for r = 1)
  const s = Float32Array.from({ length: n }, (_, i) => mid(i)), ls = 40 * P, le = ls + 100 * P;
  const pk = smp.bakeLoop(s, null, ls, le, 2400);
  assert.ok(pk.R === null && pk.L.every((v, i) => Math.abs(v - s[i]) < 1e-6));
  assert.deepEqual([smp.bakeLoop(s, null, 100, 300, 4800).pre, smp.bakeLoop(s, null, 1000, 600, 10).pre], [100, 0], 'clamped to the room before ls / half the loop; no loop: nothing');
});

test('§8.4 (IMPL): an IR cut by the length cap ends with a half-cosine fade over its last 10 %', () => {
  const rate = 8000, len = 4000, x = Float32Array.from({ length: len }, () => 0.5);
  const a = smp.irShape({ rate, ch: 1, L: x, R: null }, { size: 10 }, 1); // 40000 frames stretched, cut at 1 s
  assert.equal(a.L.length, 8000);
  assert.ok(a.L[7999] === 0 && Math.abs(a.L[7200] - 0.5) < 1e-3 && a.L[7600] < 0.3 && a.L[7600] > 0.2, 'faded over the last 800 frames');
  const b = smp.irShape({ rate, ch: 1, L: x, R: null }, {}, 0.25); // SIZE 1, convMax 0.25 s
  assert.ok(b.L.length === 2000 && b.L[1999] === 0 && b.L[1700] === 0.5);
  const c = smp.irShape({ rate, ch: 1, L: x, R: null }, {}, 1);
  assert.ok(c.L.length === 4000 && c.L[3999] === 0.5, 'not cut: unchanged');
});

test('§9.4.5 (IMPL): odf[0] = 0 — material sounding from the file start does not swamp the onsets (all hits of a phrase found)', () => {
  const r = wt.mulberry32(7), sr = 48000, n = 4 * sr, x = new Float32Array(n), hits = [];
  for (let i = 0; i < n; i++) x[i] = 0.25 * Math.sin(2 * Math.PI * 220 * i / sr) + 0.15 * Math.sin(2 * Math.PI * 331 * i / sr) + 0.05 * (r() * 2 - 1);
  for (let k = 1; k < 16; k++) { const at = Math.round(k * 0.25 * sr); hits.push(at); for (let i = 0; i < 4800 && at + i < n; i++) x[at + i] += 0.6 * (r() * 2 - 1) * Math.exp(-i / 800); }
  const o = smp.odf(x, null, sr);
  assert.equal(o[0], 0);
  const marks = smp.slicesFromOdf(o, 0.5, sr, n);
  assert.equal(marks.length, 15);
  marks.forEach((m, i) => assert.ok(Math.abs(m * n - hits[i]) <= 512, 'hit ' + i));
});

test('§9.4.6 / §9.4.3: records above 48 kHz — the spectral analysis resamples only its 20 s; trim variants reuse one resampled record', () => {
  const rate = 96000, n = 21 * rate, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate) * (1 + 0.3 * Math.sin(2 * Math.PI * 0.5 * i / rate));
  const a = smp.specAnalyse(L, null, rate), full = smp.resample(L, null, rate, 48000).L.subarray(0, 20 * 48000);
  const b = smp.specAnalyse(full, null, 48000);
  assert.ok(a.len === 20 * 48000 && a.frames === b.frames && same(a.mag, b.mag) && same(a.ph, b.ph), 'identical to analysing the fully resampled data');
  const rec = { kind: 'smp', rate, ch: 1, len: 2 * rate, L: L.slice(0, 2 * rate), R: null, root: 60, loop: { start: 9600, end: 182400 }, hash: 'hi96' };
  const t0 = work.playbackEntry('smp:hi96~a', rec, { trim: [0.25, 0.75], fade: 0 }), r48 = smp.resample(rec.L, null, rate, 48000).L;
  assert.deepEqual([t0.rate, t0.len, t0.loop], [48000, 48000, { start: 0, end: 48000 }], 'trimmed after resampling, loop mapped');
  assert.ok(same(t0.levels[0].L, r48.subarray(24000, 72000)), 'the trimmed part of the resampled record');
  const t1 = work.playbackEntry('smp:hi96~b', rec, { trim: [0.5, 1], fade: 0 });
  assert.ok(same(t1.levels[0].L, r48.subarray(48000)));
  const s = work.specEntry('spec:smp:hi96', rec, { rev: 1 });
  assert.ok(s.rate === 48000 && s.len === 2 * 48000 && !s.capped && valid(s));
});

test('smpwork: the Convolve display (irview) draws the shape the last irshape built', async () => {
  const L = Float32Array.from({ length: 20000 }, (_, i) => (i % 7 ? 0.01 : 1) * Math.exp(-i / 4000));
  const rec = { kind: 'ir', rate: 48000, ch: 1, len: 20000, L, R: null, hash: 'v1' };
  const shape = { size: 1.3, dec: 0.7, minph: 1 };
  const e = (await work.handle({ q: 1, op: 'irshape', id: 'ir:v1@48000~11111111', rec, rate: 48000, shape })).msg;
  const v = (await work.handle({ q: 2, op: 'irview', id: 'ir:v1@48000~11111111', rec, rate: 48000, shape, n: 32 })).msg;
  const sh = smp.irShape(smp.irPrepare(rec, 48000), shape, 10), ov = smp.overview(sh.L, sh.R, 32);
  assert.ok(e.ok && v.ok && v.len === e.entry.len && same(v.ov, ov));
});
