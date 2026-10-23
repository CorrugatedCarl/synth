// Master stage G0 (docs/canvas/IMPL-M.md M1, §4, §6): the base build's Bounce output, frozen, so the Master stage can prove an
// empty master changes nothing. Three short bounces through the app's real bounce() path in the page simulation
// (tests/main-sim.mjs) at EXPLICIT dialog settings — project-p1 (tests/ref-p1), a TR-808 playing its demo pattern, a 900 Series
// (the Model 15) playing notes — each hashed twice: (a) SHA-256 of the WAV file bytes the page hands to download() (the Blob
// URL.createObjectURL receives, as tests/app-ios.test.mjs reads it), (b) SHA-256 of sim.lastOffline.L / .R (the offline render
// as Float32 bytes, before bounce()'s peak scaling). tests/ref-M/bounce-hashes.json holds the reference; the tree under test must
// reproduce it exactly — a Bounce of an existing project at the same settings is byte-identical (M1: the dither seed is fixed
// and exact silence is never dithered, so one different sample shifts every later dither value; only an exact copy passes).
// The settings are set explicitly (never the dialog's defaults: the Master stage adds a "Same as playback" default).
// Accessor-free like the other canvas sims: the app runs as a guard build (a track's v1 keys throw) — instruments read as devices
// (cv-model instOf), hosts through the __synthTest hooks; strings and numbers only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-M-bounce.test.mjs
// Re-record (ONLY from the base tree, f78cc81 — never from Master-stage code, or the proof is circular): extract it into the
// scratchpad (git archive f78cc81 | tar -x -C <dir>), then
//   REC=<dir> node --max-old-space-size=2048 --test tests/canvas-M-bounce.test.mjs
// (the app modules and main-sim are imported from <dir>; this file only writes tests/ref-M/bounce-hashes.json).
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HERE = new URL('../', import.meta.url);
const FIX = new URL('./ref-M/bounce-hashes.json', import.meta.url);
const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8');
const sha = b => createHash('sha256').update(b).digest('hex');
const f32 = a => sha(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

// the three scenes: the dialog's settings (set explicitly) and what is built before the bounce. 1 bar = 3840 ticks.
const SCENES = {
  'project-p1': { settings: { range: 'loop', sr: 48000, bits: 24, os: 2, tail: 0, norm: false }, loop: [0, 3840] },        // 7 tracks (two Serums, a 303), as the file is: bar 1 (1.9 s at 124 bpm)
  'drums-808': { settings: { range: 'loop', sr: 44100, bits: 16, os: 4, tail: 2, norm: true }, loop: [0, 3840] },           // a TR-808, SYNC, the demo pattern, panned right: 1 bar (2 s) + 2 s tail, normalised
  'm900-model15': { settings: { range: 'loop', sr: 48000, bits: 32, os: 2, tail: 0, norm: false }, loop: [0, 7680] },      // a 900 Series (Model 15, Classic bass), five notes, panned left, fader 0.7: 2 bars (4 s)
};
const NOTES_900 = [[0, 720, 48], [960, 720, 55], [1920, 960, 51], [3840, 1440, 43], [5760, 960, 58]];

async function scene(root, name) {
  const { bootMain } = await import(new URL('tests/main-sim.mjs', root));
  const { fakeStorage, fakeIDB } = await import(new URL('tests/fakes.mjs', root));
  const CMOD = await import(new URL('cv-model.js?v=9', root));
  const { MODELS } = await import(new URL('models.js?v=9', root));
  const { settings: st, loop } = SCENES[name];
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
  const api = s.api, $ = s.$, cv = globalThis.__synthTest.cv;
  const blobs = [], realURL = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try {
    if (name === 'project-p1') {
      const file = { name: 'project-p1.synth.json', type: 'application/json', text: async () => P1 };
      await $('#fFile').onchange({ target: { files: [file], value: '' } });
      await s.settle(30);
    }
    await s.power(); await s.settle(30);
    const p = api.project(), t = p.tracks.find(x => x.id === p.selTrack) || p.tracks[0];
    if (name === 'drums-808') {
      api.selectTrack(t.id); api.setTrackModel(t, 'tr808');
      for (let i = 0; i < 4; i++) { s.raf(); await s.settle(3); }
      assert.equal(CMOD.instOf(t).model, 'tr808');
      cv.drum.api(cv.view1e(CMOD.primId(t))).demo(); // its notice's undo is not taken: the demo's A / B and fill 1, SYNC on (a new machine's default)
      t.pan = 0.25;
    } else if (name === 'm900-model15') {
      // the 900 Series goes on a second track, the first (a silent Minimoog) staying shown: a shown 900's cord layer is WebGL, which the node page cannot draw
      const u = api.addTrack(MODELS.find(x => x.id === 'minimoog'));
      api.selectTrack(t.id); api.setTrackModel(u, 'm900');
      for (let i = 0; i < 4; i++) { s.raf(); await s.settle(3); }
      assert.equal(CMOD.instOf(u).model, 'm900');
      u.notes = NOTES_900.map(([a, d, n], i) => ({ id: 'n-m' + i, t: a, d, n, v: 100 }));
      u.pan = -0.35; u.vol = 0.7;
    }
    for (let i = 0; i < 4; i++) { s.raf(); await s.settle(3); }
    p.loop.on = true; p.loop.start = loop[0]; p.loop.end = loop[1];
    $('#fBounce').click(); // the dialog opens (its fields are the page's, then set explicitly below)
    for (const [k, v] of [['#bRange', st.range], ['#bSr', String(st.sr)], ['#bBits', String(st.bits)], ['#bOs', String(st.os)], ['#bTail', String(st.tail)]]) $(k).value = v;
    $('#bNorm').checked = st.norm;
    s.lastOffline = null;
    await $('#bGo').onclick();
    for (let i = 0; i < 40 && !s.lastOffline; i++) await s.settle(5);
    const note = $('#bNote').textContent;
    assert.match(note, /^Done: /, name + ': rendered (' + note + ')');
    assert.ok(s.lastOffline, name + ': an offline render');
    assert.equal(blobs.length, 1, name + ': one file handed to download()');
    const wav = new Uint8Array(await blobs[0].arrayBuffer()), L = s.lastOffline.L, R = s.lastOffline.R;
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)) + String.fromCharCode(...wav.subarray(8, 12)), 'RIFFWAVE');
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    assert.ok(peak > 1e-3, name + ': it sounds (peak ' + peak.toFixed(4) + ')');
    return { wav: sha(wav), L: f32(L), R: f32(R), frames: L.length, wavBytes: wav.length, peak: +peak.toFixed(6), settings: Object.assign({ loop }, st) }; // (peak: for the eye; it follows from L / R)
  } finally { URL.createObjectURL = realURL; }
}

test('Master G0: the base build\'s Bounce of project-p1, a TR-808 and a 900 Series — the WAV bytes and the offline render, hash for hash', async () => {
  const rec = process.env.REC;
  if (rec) { // (recording: the base tree only)
    const root = pathToFileURL(rec.endsWith('/') ? rec : rec + '/'), out = {};
    for (const name of Object.keys(SCENES)) out[name] = await scene(root, name);
    writeFileSync(FIX, JSON.stringify(out, null, 2) + '\n');
    return;
  }
  const ref = JSON.parse(readFileSync(FIX, 'utf8'));
  assert.deepEqual(Object.keys(ref), Object.keys(SCENES), 'the reference holds the three scenes');
  for (const name of Object.keys(SCENES)) assert.ok(ref[name].peak > 1e-3 && ref[name].frames > 40000, name + ': the reference holds a real render');
  for (const name of Object.keys(SCENES)) {
    const r = await scene(HERE, name), w = ref[name];
    assert.equal(JSON.stringify(r.settings), JSON.stringify(w.settings), name + ': the dialog settings');
    assert.equal(r.frames, w.frames, name + ': frames rendered');
    assert.equal(r.L, w.L, name + ': the offline render, left (Float32 bytes)');
    assert.equal(r.R, w.R, name + ': the offline render, right');
    assert.equal(r.peak, w.peak, name + ': the peak');
    assert.equal(r.wavBytes, w.wavBytes, name + ': the WAV file\'s length');
    assert.equal(r.wav, w.wav, name + ': the WAV file bytes');
  }
});
