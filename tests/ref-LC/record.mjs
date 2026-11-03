// tests/ref-LC/record.mjs — the frozen ref of stage LC (docs/canvas/IMPL-LC.md §10; lane E writes it, the lead records it ONCE at
// integration, on the merged tree, after the Chrome smoke): a fixed project with combiners rendered live and bounced through the page
// simulation (tests/main-sim.mjs, clock 'std'), every worklet node's output hashed.
//   the project (built here from a fresh page's own tracks, then saved and opened through the app's file path, as a user's save is):
//     trk 1  a Juno-60 (i1 → fx1 → OUT) with three track LFOs — l1 BPM ¼ anchored, l2 Hz 0.7 FREE (no ANCHOR), l3 a Path LFO with
//            SMOOTH 0.3 — into Combiner 1 (Add; +100 / −50 / +30 %) → its cutoff; a note a beat, 8 bars
//     trk 2  a Wavecraft (the rig, its own LFO 1–3 per voice: FREE BPM ⅛ anchored, RETRIG Hz 3, ENVELOPE; a Utility on its own FX (a
//            rig track keeps i1 → OUT on load)), its three LFOs into Combiner 2 (Multiply; +100 / +60 / −40 %) → its filter cutoff and the Utility's pan;
//            a chord every two beats, 8 bars
//     master a Delay (mix 0.3) on its rack, two LFOs (BPM ½ anchored, Hz 0.4 FREE) into a combiner (Add; +80 / +50 %) → the Delay's mix
//     128 BPM, 4/4
//   live    ▶ from bar 1 with the loop on bars 3–4: 5 bars of frames through sim.run (the loop wraps once, at bar 5), per node the
//           SHA-256 of L and of R (Float32 bytes), nodes in creation order with their processor name and track id → live.sha
//   bounce  the app's bounce() (range loop = bars 1–8, 48 kHz, 24 bit, OS 2, no tail, no normalising): SHA-256 of the offline render's
//           L / R and of the WAV bytes the page hands to download() → bounce.sha
// Usage (one process, 2 GB):
//   node --max-old-space-size=2048 tests/ref-LC/record.mjs --write     records live.sha and bounce.sha (the lead, at integration ONLY)
//   node --max-old-space-size=2048 tests/ref-LC/record.mjs             compares (prints each differing line; exit 1 on one)
// tests/golden-lc.test.mjs imports record() and compares exact from then on. Accessor-free like the canvas sims (strings and numbers
// out); downloads never touch the disk (URL.createObjectURL is captured).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = new URL('../../', import.meta.url);
export const FILES = { live: new URL('./live.sha', import.meta.url), bounce: new URL('./bounce.sha', import.meta.url) };
const sha = b => createHash('sha256').update(b).digest('hex');
const f32 = a => sha(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const BPM = 128, BAR = 3840, SR = 48000;
const say = process.env.LCDBG ? (...a) => console.error('[ref-LC]', ...a) : () => {}; // (LCDBG=1: the steps)

// the project, from a booted page's own save (its tracks, ids and defaults) with the combiners written in through cv-model
async function project(root, api) {
  const MO = await import(new URL('cv-model.js?v=9', root)), S = await import(new URL('song.js?v=9', root)), C = await import(new URL('serum-core.js?v=9', root));
  const P = JSON.parse(S.serialize(api.project()));
  P.bpm = BPM; P.sig = [4, 4];
  const [t1, t2] = P.tracks;
  P.selTrack = t1.id;                                          // (the Juno shown on open: see open())
  const hzN = hz => Math.pow(hz / 100, 0.25), lad = label => C.LFO_LADDER.findIndex(x => x.label === label) / (C.LFO_LADDER.length - 1);
  const inst = t => Object.keys(t.dev).find(k => t.dev[k] && t.dev[k].kind === 'synth');
  const ok = r => { if (!r || r.ok === false) throw new Error('ref-LC: ' + (r && r.why)); return r; };
  const add = (t, src, dst, amt) => { const r = ok(MO.addMod(t, src, dst, { project: P })); ok(MO.setMod(t, r.row.id, { amt })); return r.row; };
  const lfo = (t, st) => { const id = MO.addModDev(t, 'lfo'); ok(MO.setModState(t, id, st)); return id; };
  // trk 1: the Juno
  const j = inst(t1);
  const a1 = lfo(t1, { lfo: { mode: 'free', mono: 1, bpm: 1, anchor: 1 }, rate: lad('1/4') }), a2 = lfo(t1, { lfo: { mode: 'free', mono: 1, bpm: 0, anchor: 0 }, rate: hzN(0.7) });
  const a3 = lfo(t1, { lfo: { mode: 'free', mono: 1, bpm: 0, anchor: 0, type: 'path' }, rate: hzN(1.3), smooth: 0.3 }), x1 = MO.addModDev(t1, 'comb');
  add(t1, a1 + '.out', x1 + ':in', 1); add(t1, a2 + '.out', x1 + ':in', -0.5); add(t1, a3 + '.out', x1 + ':in', 0.3); add(t1, x1 + '.out', j + ':cf', 0.5);
  t1.notes = Array.from({ length: 32 }, (_, k) => ({ id: 'lc1-' + k, t: k * 960, d: 600, n: [45, 52, 57, 48][k & 3], v: 100 }));
  // trk 2: the Wavecraft, a Utility on its own FX; its own LFOs per voice
  const w = inst(t2), s = t2.dev[w].vals.s, fx = t2.dev[w].fx, util = C.newInstance(fx, 'util', { rack: 0 });
  Object.assign(s.lfo[0], { mode: 'free', mono: 0, bpm: 1, anchor: 1 }); s.p['l1.rate'] = lad('1/8');
  Object.assign(s.lfo[1], { mode: 'retrig', mono: 0, bpm: 0, anchor: 0 }); s.p['l2.rate'] = hzN(3);
  Object.assign(s.lfo[2], { mode: 'env', mono: 0, bpm: 1, anchor: 0 }); s.p['l3.rate'] = lad('1/2');
  // (the Utility on the Wavecraft's own FX rack: a rig track keeps i1 → OUT on load — a panel after it is re-shaped away)
  const x2 = MO.addModDev(t2, 'comb');
  ok(MO.setModState(t2, x2, { mode: 'mul' }));
  add(t2, w + '/lfo1.out', x2 + ':in', 1); add(t2, w + '/lfo2.out', x2 + ':in', 0.6); add(t2, w + '/lfo3.out', x2 + ':in', -0.4);
  add(t2, x2 + '.out', w + ':f.cutoff', 0.4); add(t2, x2 + '.out', w + ':fx.' + util + '.pan', 0.5);
  t2.notes = Array.from({ length: 16 }, (_, k) => [60, 64, 67].map((n, i) => ({ id: 'lc2-' + k + '-' + i, t: k * 1920, d: 1500, n: n + (k & 1 ? 2 : 0), v: 90 }))).flat();
  // the master
  const mfx = C.defaultFx2(), dly = C.newInstance(mfx, 'dly', { rack: 0 }), R = (id, src, dst, amt) => ({ id, src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  P.master = Object.assign(P.master || {}, { fx: mfx, mid: 4,
    mdev: { l1: S.normModDev({ kind: 'lfo', lfo: { mode: 'free', mono: 1, bpm: 1, anchor: 1 }, rate: lad('1/2') }), l2: S.normModDev({ kind: 'lfo', lfo: { mode: 'free', mono: 1, bpm: 0, anchor: 0 }, rate: hzN(0.4) }), x1: S.normModDev({ kind: 'comb' }) },
    mods: [R('r1', 'l1.out', 'x1:in', 0.8), R('r2', 'l2.out', 'x1:in', 0.5), R('r3', 'x1.out', 'mfx:fx.' + dly + '.mix', 0.3)] });
  if (process.env.LCDBG) { const G = await import(new URL('cv-graph.js?v=9', root)); for (const t of [t1, t2]) { const q = G.compileMods(t, P, {}); say(t.id, JSON.stringify(q.cmb), 'left', JSON.stringify(q.left), 'rows', q.rows.length, 'ext', q.ext.length); } }
  return S.serialize(P);
}

async function open(root) {
  const { bootMain } = await import(new URL('tests/main-sim.mjs', root));
  const { fakeStorage, fakeIDB } = await import(new URL('tests/fakes.mjs', root));
  const { MODELS } = await import(new URL('models.js?v=9', root)), { RIG } = await import(new URL('rig-core.js?v=9', root));
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' }), $ = s.$, api = s.api;
  { // (the modulator faces animate through wk.clock, which asks getClientRects: the stub DOM's elements answer one box — canvas-2b-sim's way)
    const D = globalThis.document, ce = D.createElement, cn = D.createElementNS;
    D.createElement = tag => { const e = ce(tag); e.getClientRects = () => [{}]; return e; };
    D.createElementNS = (ns, tag) => { const e = cn(ns, tag); e.getClientRects = () => [{}]; return e; };
  }
  // (the Wavecraft on a second track, the Juno staying shown: a shown rig's cord layer is WebGL, which the node page cannot draw)
  const t0 = api.project().tracks[0];
  api.setTrackModel(t0, 'juno60');
  const u = api.addTrack(MODELS.find(x => x.id === 'minimoog'));
  api.selectTrack(t0.id); api.setTrackModel(u, RIG.ID);
  for (let i = 0; i < 4; i++) { s.raf(); await s.settle(3); }
  say('tracks', api.project().tracks.map(t => t.dev && Object.keys(t.dev).join(',')).join(' | '));
  const text = await project(root, api);
  say('project', text.length);
  await $('#fFile').onchange({ target: { files: [{ name: 'lc.synth.json', type: 'application/json', text: async () => text }], value: '' } });
  await s.settle(30); say('opened', s.api.project().tracks.length);
  if (process.env.LCDBG) { const t = s.api.project().tracks[1], q = globalThis.__synthTest.modUI.pay(t); say('opened trk 2', Object.keys(t.dev).join(','), JSON.stringify(t.wires), q && JSON.stringify(q.rows.map(r => r.dst)), q && q.key); }
  await s.power(); await s.settle(30);
  return s;
}

async function live(root) {
  const s = await open(root), $ = s.$, p = s.api.project();
  const step = async n => { s.raf(2); await s.settle(2); s.raf(); return s.run(n); };
  await step(4096);                                            // the warm-up render, discarded
  p.loop.on = true; p.loop.start = 2 * BAR; p.loop.end = 4 * BAR;
  $('#tPlay').onclick();
  const frames = Math.round(5 * 4 * 60 / BPM * SR), out = await step(frames), lines = [];
  let i = 0, peak = 0;
  for (const [n, o] of out) {
    if (n.name === 'synth-safe') continue;
    lines.push([i++, n.name, (n.po && n.po.trackId) || '-', f32(o.L), f32(o.R)].join(' '));
    for (let k = 0; k < o.L.length; k++) peak = Math.max(peak, Math.abs(o.L[k]), Math.abs(o.R[k]));
  }
  if (!(peak > 1e-3)) throw new Error('ref-LC live: silent');
  return ['v 1 (IMPL-LC §10): the combiners project, ▶ from bar 1, the loop bars 3–4 wrapping once, 5 bars; per node SHA-256 of L and R', ...lines,
    'frames ' + frames + ' sr ' + s.ctx().sampleRate + ' peak ' + peak.toFixed(6)].join('\n') + '\n';
}

async function bounce(root) {
  const s = await open(root), $ = s.$, p = s.api.project(), blobs = [], realURL = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try {
    for (let i = 0; i < 4; i++) { s.raf(); await s.settle(3); }
    p.loop.on = true; p.loop.start = 0; p.loop.end = 8 * BAR;
    $('#fBounce').click();
    for (const [k, v] of [['#bRange', 'loop'], ['#bSr', '48000'], ['#bBits', '24'], ['#bOs', '2'], ['#bTail', '0']]) $(k).value = v;
    $('#bNorm').checked = false;
    s.lastOffline = null;
    await $('#bGo').onclick();
    for (let i = 0; i < 60 && !s.lastOffline; i++) await s.settle(5);
    if (!s.lastOffline || blobs.length !== 1) throw new Error('ref-LC bounce: no render (' + $('#bNote').textContent + ')');
    const wav = new Uint8Array(await blobs[0].arrayBuffer()), L = s.lastOffline.L, R = s.lastOffline.R;
    let peak = 0;
    for (let k = 0; k < L.length; k++) peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
    if (!(peak > 1e-3)) throw new Error('ref-LC bounce: silent');
    return ['v 1 (IMPL-LC §10): the combiners project, bounced: bars 1–8, 48 kHz, 24 bit, OS 2, no tail, not normalised',
      'L ' + f32(L), 'R ' + f32(R), 'wav ' + sha(wav) + ' ' + wav.length, 'frames ' + L.length + ' peak ' + peak.toFixed(6)].join('\n') + '\n';
  } finally { URL.createObjectURL = realURL; }
}

/** the two records of the tree at `root` (default: this checkout) → { live, bounce } (texts) */
export async function record(root = HERE) {
  const keep = setInterval(() => {}, 1 << 30); // (the page simulation's awaits hold no handle of their own: keep the loop alive, as node:test does)
  try { return { live: await live(root), bounce: await bounce(root) }; } finally { clearInterval(keep); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await record(), write = process.argv.includes('--write');
  let bad = 0;
  for (const k of ['live', 'bounce']) {
    if (write) { writeFileSync(FILES[k], r[k]); console.log('wrote ' + fileURLToPath(FILES[k]) + '\n' + r[k]); continue; }
    say(r[k]);
    if (!existsSync(FILES[k])) { console.log(k + ': no recording (tests/ref-LC/' + k + '.sha) — record at integration with --write'); bad++; continue; }
    const a = readFileSync(FILES[k], 'utf8').split('\n'), b = r[k].split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log(k + ' line ' + i + ':\n  ref ' + a[i] + '\n  got ' + b[i]); bad++; }
  }
  if (!write) console.log(bad ? bad + ' difference(s)' : 'ref-LC: exact');
  process.exit(bad ? 1 : 0);
}
