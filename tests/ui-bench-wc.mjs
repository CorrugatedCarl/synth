// tests/ui-bench-wc.mjs — stage WC's frame-cost harness (docs/canvas/IMPL-WC.md §9, G7; lane C), opened as tests/ui-bench.html?wc=1.
// It replaces ui-bench-m3's S0 real scene (p1x-real asked for the Show-parts hook, removed with Show parts): a Wavecraft canvas is made the way
// the user makes one — the Wavecraft tile (A.shell.srcPick('rig', 'track'): the starter rig), modules added and cords plugged through
// the app's own hooks (lane H's __synthTest.cv.rig when the build has it: add / plug / wires; before it, stage 3's cv.parts add /
// connect, whose first add shows the modules) — and measured with the app's own cord layer (A.cv.cords(): cv-cords at the device's
// preset). A test page only: the app runs unchanged in an iframe (same origin, the test hooks on); nothing the bench does is stored
// (the app's store writes are switched off for the run; the user's project, prefs and cameras stay as they were).
//   Scenes: juno (a Juno-60 track: the layer allocates nothing there — buffer 0 × 0, W7 / G7), rig1 (the (complete)-sized rig: the
//   tile's starter — Oscillator → Filter → Amplifier, Envelope 1 on LEVEL — and the FX panel), rigX (§9's full WC-1 rig: Amplifier,
//   3 Oscillators, Sub, Noise, 2 Filters, 4 Envelopes, 2 LFOs, Macros, the FX with 4 effects, its own rows, + 6 canvas modulators with
//   8 mod cords onto its knobs, OUT).
//   (DM G9) kitS / kitX: a kit track — the kit tile's action on a new track (cv.kit.add: the Starter's 8 voices; kitX adds 8 more, types cycling), the fixture
//   groove (tests/kit-fixtures.mjs) painted through cv.kit.cell (kitX: every one of the 16 lanes painted), Tidied, 128 BPM, the engine on, the
//   transport playing — pan / pinch / a voice module dragged (phase `drag`) / rest; painted elements against IMPL-DM §7.3 (KIT.bar).
//   Phases (M0 + G7's list), each analysed as IMPL-3 §1.5 (bursts median / p95 / max / > 33 ms, firstMove, settle → P / P+): idle,
//   pan (a 300 px sine), pinch 25–200 % (about the view's centre), settle, amp (the Amplifier dragged on the dots: its cords awake),
//   sway (every cord plucked, a pan over it), sweep (rigX: 60 s of k 0.25 ↔ 2 with the cords plucked — context losses, the buffer).
//   Per phase cords().stats(true): the awake maximum, step / draw ms (mean, max), uploads; per scene the painted elements (the
//   heavy notice's count) and canvases, the buffer, the mode (cords / lines: the hook's wires(), else the records' claims).
//   &auto=1: the CDP harness (no taps; window.__wc = { state, result }); &scenes=juno,rig1: a subset; &sweep=0: no 60 s sweep;
//   &wires=lines: the rigs' canvas in lines mode (the regret path, when the hook has wires). One JSON (Copy results) → kind
//   "ui-WC-mac" (tests/bench.json, informational: Chrome is not WebKit; the iPad joins IMPL-WC's consolidated pass).
// Node imports the pure part (q, analyse, verdict, RIGX, BAR): no DOM at module top level (tests/ui-bench-wc.test.mjs).

/* ------------------------------------------------------------------------------------------------ the pure part */
import { GROOVE } from './kit-fixtures.mjs'; // ((DM G9) the tests' fixture groove: plain data, never shipped)
/** IMPL-3 §1.5's bars (G7 uses them): P (opt-in) and P+ (on by default), ms. */
export const BAR = Object.freeze({
  P: Object.freeze({ med: 17.5, p95: 25, max: 50, first: 100, settle: 100 }),
  Pp: Object.freeze({ med: 17.0, p95: 20, max: 33, first: 80, settle: 80 }),
});
/** G7's cord budget on the M4 (ms; ≤ 0.25 / 0.06 projected to the iPad by ui-m9's ratio) for 40 awake cords. */
export const CORD_BAR = Object.freeze({ awake: 40, step: 0.35, draw: 0.08 });
/** §9's budgets: painted elements (+ 6 a jack) and the heavy notice's count (main.js SX_HEAVY). */
export const DOM_BAR = Object.freeze({ complete: 1650, full: 5000, perJack: 6, heavy: 1866 });
/** §9's full WC-1 rig: the modules added to the tile's starter (Oscillator 1, Filter 1, Envelope 1 on LEVEL, the Amplifier), the cords
 * plugged (sx-edges ENDs), its own rows (Serum matrix sources → destinations), the canvas modulators and their 8 rows, the effects. */
export const RIGX = Object.freeze({
  add: Object.freeze([['osc', 'oscB'], ['osc', 'oscC'], ['sub', 'sub'], ['noise', 'noise'], ['filter', 'filter2'], ['env', 'env2'], ['env', 'env3'], ['env', 'env4'],
    ['lfo', 'lfo1'], ['lfo', 'lfo2'], ['macros', 'macros']]),
  // ((fixer B2, P3-9) none already made by AUTOPLUG (Oscillator 2 into Filter 1, Filter 2 into the Amplifier): Oscillator 2 forked into Filter 2
  // too (its BAL), Filter 2 moved to DIRECT)
  cords: Object.freeze([['oscB.out', 'filter2.in'], ['oscC.out', 'filter2.in'], ['noise.out', 'filter2.in'], ['sub.out', 'voice.main'], ['filter2.out', 'voice.direct']]),
  // ((fixer B2, review 2 P3-9) 32 own rows: with the rig's ≈ 10 edges the scene holds ≥ 40 cords — G7's "40 awake" in the sway phase)
  own: Object.freeze([['lfo1', 'a.wt'], ['lfo1', 'b.wt'], ['lfo2', 'f.cutoff'], ['lfo2', 'f2.cutoff'], ['env2', 'f.cutoff'], ['env3', 'f2.cutoff'], ['env4', 'c.wt'], ['macro1', 'a.level'],
    ['lfo1', 'c.wt'], ['lfo1', 'a.pan'], ['lfo2', 'b.pan'], ['lfo2', 'c.pan'], ['env2', 'f.res'], ['env3', 'f2.res'], ['env4', 'f.drive'], ['env2', 'a.det'],
    ['env3', 'b.det'], ['env4', 'c.det'], ['lfo1', 'f.mix'], ['lfo2', 'f2.mix'], ['macro1', 'b.level'], ['macro2', 'c.level'], ['macro3', 's.level'], ['macro4', 'n.level'],
    ['macro5', 'a.blend'], ['macro6', 'b.blend'], ['macro7', 'c.blend'], ['macro8', 'f.var'], ['lfo1', 'a.fine'], ['lfo2', 'b.fine'], ['env2', 'n.pan'], ['env3', 's.pan']]),
  canvas: Object.freeze([['l1', 'lfo'], ['l2', 'lfo'], ['e1', 'env'], ['e2', 'env'], ['m1', 'macro'], ['h1', 'chaos']]),
  rows: Object.freeze([['l1', 'b.semi'], ['l1', 'c.pan'], ['l2', 'f.res'], ['l2', 'f2.res'], ['e1', 'a.pan'], ['e2', 'b.pan'], ['m1', 's.level'], ['h1', 'n.level']]),
  effects: 4,
});
/** (DM G9) The kit scenes: kitS = the Starter's 8 voices on the fixture groove, kitX = 8 more voices (types, KIT.TYPES values) on a grid painted in every
 * one of its 16 lanes; both playing at KIT.bpm. `bar` IMPL-DM §7.3: the Starter scene's painted elements under the touch notice's line, a 16-voice kit
 * under PT_HEAVY's 2 048 (lane F measured ≈ 1 600). */
export const SCENES = Object.freeze(['juno', 'rig1', 'rigX', 'kitS', 'kitX']); // ((DM G9) + kitS, kitX)
export const KIT = Object.freeze({ bpm: 128, voices: Object.freeze({ kitS: 8, kitX: 16 }), types: Object.freeze([1, 2, 3, 4, 5, 6, 1, 2]), bar: Object.freeze({ kitS: 1500, kitX: 2048 }) });
/** (DM G9) The cells a kit scene paints, [{ l, s, v }]: the fixture groove (lanes 0–7: kick, clap, closed / open hat, rim), and every lane of the first `n` that
 * the groove leaves empty (the Starter's snare and toms, kitX's lanes 8–15) four hits a bar from an offset of its own. Pure. */
export function kitCells(n) {
  const cells = GROOVE.cells.filter(c => c.l < n).map(c => ({ l: c.l, s: c.s, v: c.v }));
  for (let l = 0; l < n; l++) if (!cells.some(c => c.l === l)) for (let k = 0; k < 4; k++) cells.push({ l, s: (l * 3 + 4 * k) % 16, v: 90 });
  return cells.sort((a, b) => a.s - b.s || a.l - b.l);
}
/** (DM G9) The kit scenes' verdicts at a CPU throttle → [{ id, pass, note }]: the camera bursts (pan, pinch) P+ at 1 × and 4 × (median ≤ 17 ms, p95 ≤ 20, no
 * frame > 33), P at 6 × (IMPL-DM §8 G9; IMPL-3 §1.5); the module drag's frames (phase `drag`: the nudge starts no camera burst, so all of its frames) within the
 * same bar; the painted elements within KIT.bar; the scene as asked (voices, lanes, playing, no note); the heavy notice not fired by the kit alone. Pure. */
export function kitGate(res, throttle) {
  const out = [], B = throttle >= 6 ? BAR.P : BAR.Pp, name = throttle >= 6 ? 'P' : 'P+', K = (res && res.kit) || {}, m0 = (res && res.m0) || {};
  const want = KIT.voices[res && res.id];
  out.push({ id: 'scene', pass: !!res && !res.error && !(res.notes || []).length && K.voices === want && K.lanes === want && K.playing === true, note: res && res.error ? res.error : (res.notes || []).join(' | ') || (K.voices + ' voices, ' + K.lanes + ' lanes painted, playing ' + K.playing) });
  out.push({ id: 'painted', pass: !!res && !!res.painted && res.painted.ok && !res.painted.heavy, note: res && res.painted ? res.painted.n + ' ≤ ' + res.painted.bar : '–' });
  const v = m0.total && m0.total.verdict, ok = v === 'P+' || (throttle >= 6 && v === 'P');
  out.push({ id: 'camera ' + name, pass: !!ok, note: 'verdict ' + v + (m0.total ? ' · bursts ' + m0.total.burst.med + ' / ' + m0.total.burst.p95 + ' / ' + m0.total.burst.max + ' ms (med / p95 / max), ' + m0.total.burst.over33 + ' > 33' : '') });
  for (const ph of ['pan', 'pinch']) { const x = m0[ph]; out.push({ id: ph + ' ' + name, pass: !!x && x.burstMed <= B.med && x.burstP95 <= B.p95 && x.burstMax <= B.max && x.over33 <= (throttle >= 6 ? 1 : 0), note: x ? 'burst ' + x.burstMed + ' / ' + x.burstP95 + ' / ' + x.burstMax + ' ms, ' + x.over33 + ' > 33' : '–' }); }
  const d = m0.drag;
  out.push({ id: 'module drag ' + name, pass: !!d && !m0.dragNote && d.n > 30 && d.med <= B.med && d.p95 <= B.p95 && d.max <= B.max, note: d ? d.n + ' frames ' + d.med + ' / ' + d.p95 + ' / ' + d.max + ' ms, ' + d.over33 + ' > 33' + (m0.dragNote ? ' · ' + m0.dragNote : '') : '–' });
  out.push({ id: 'heavy notice not fired', pass: !!K.heavy && K.heavy.done === false, note: JSON.stringify(K.heavy) });
  return out;
}
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
/** A list of frame intervals → { n, med, p95, max, over33 }. Pure. */
export function q(a) {
  const s = (Array.isArray(a) ? a : []).filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  const at = p => r1(s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  return { n: s.length, med: at(0.5), p95: at(0.95), max: r1(s.length ? s[s.length - 1] : 0), over33: s.filter(x => x > 33).length };
}
/** A recording { f: [dt, t, …] (frame intervals and their times), ev: [1, t | 2, t, …] (movestart / cameraend) } within [a, b] → the
 * bursts' frames (the first 100 ms of each: firstMove), the 800 ms after each cameraend (settle), the rest. Pure. */
export function analyse(R, a = -Infinity, b = Infinity) {
  const bursts = [];
  for (let i = 0; i + 1 < R.ev.length; i += 2) {
    if (R.ev[i] === 1) bursts.push({ s: R.ev[i + 1], e: Infinity, first: [], settle: [] });
    else { const B = bursts[bursts.length - 1]; if (B && B.e === Infinity) B.e = R.ev[i + 1]; }
  }
  const inB = bursts.filter(B => B.e > a && B.s < b), burst = [], first = [], settle = [], rest = [];
  for (let i = 0; i + 1 < R.f.length; i += 2) {
    const dt = R.f[i], t = R.f[i + 1];
    if (t < a || t > b) continue;
    let cls = 'rest';
    for (const B of inB) {
      if (t > B.s && t <= B.s + 100) { cls = 'first'; B.first.push(dt); break; }
      if (t > B.s && t <= B.e) { cls = 'burst'; break; }
      if (t > B.e && t <= B.e + 800) { cls = 'settle'; B.settle.push(dt); }
    }
    (cls === 'first' ? first : cls === 'burst' ? burst : cls === 'settle' ? settle : rest).push(dt);
  }
  const mx = L => (L.length ? r1(Math.max(...L)) : 0), multi = k => inB.filter(B => B[k].filter(x => x > 33).length > 1).length;
  return { bursts: inB.length, burst: q(burst), first: { max: mx(first), n: first.length, multi: multi('first') }, settle: { max: mx(settle), n: settle.length, multi: multi('settle') },
    rest: q(rest), all: q([...burst, ...first, ...settle, ...rest]) };
}
/** IMPL-3 §1.5's verdict of an analysis: 'P+' | 'P' | 'fail' | 'no bursts' (o.lost: a context loss / tab loss fails it). Pure. */
export function verdict(x, o = {}) {
  if (!x || !x.burst || !x.burst.n) return 'no bursts';
  const ok = B => x.burst.med <= B.med && x.burst.p95 <= B.p95 && x.burst.max <= B.max && x.first.max <= B.first && x.settle.max <= B.settle && !o.lost;
  return ok(BAR.Pp) && !x.first.multi && !x.settle.multi ? 'P+' : ok(BAR.P) ? 'P' : 'fail';
}

/* ------------------------------------------------------------------------------------------------ the page */
const A = {}; // the app frame: win, doc, api, cv, shell, W, mod, rig (lane H's hook or null)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => A.win.requestAnimationFrame(r));
const now = () => A.win.performance.now();
const $ = s => document.querySelector(s);
let Q = null, AUTO = false;
const say = t => { const e = $('#status'); if (e) e.textContent = t; if (AUTO) console.log('[wc] ' + t); };
const trk = () => { const P = A.api.project(); return P.tracks.find(t => t.id === P.selTrack); };

/** A fixed busy loop (3 × ≈ 25 ms unthrottled: longer than a throttle slice), the median wall ms: the CPU throttle's own evidence. */
const spin = () => { const L = []; for (let k = 0; k < 3; k++) { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x += Math.sqrt(i); L.push(performance.now() - t + (x < 0 ? 1 : 0)); } return r1(L.sort((a, b) => a - b)[1]); };
async function boot() { // the app in the iframe with the test hooks (as ui-bench.html's own boot), the store's writes switched off
  const FR = await import('./ui-bench-frame.mjs?t=' + Date.now());
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  const doc = html.replace(/<head>/i, '<head><base href="' + new URL('../', location.href).href + '"><script>window.__synthTest = {};<\/script>');
  const f = $('#frame');
  await FR.mountFrame(f, doc, FR.frameQuery(location.search), location.href);
  let win = null;
  for (let i = 0; i < 600 && !win; i++) { await sleep(50); const w = f.contentWindow; if (w && w.__synthTest && w.__synthTest.cv && w.__synthTest.api && w.__synthTest.shell && w.document.querySelector('#world') && w.__synthTest.cv.world()) win = w; }
  if (!win) throw new Error('the app did not start in the frame');
  const T = win.__synthTest;
  Object.assign(A, { win, doc: win.document, api: T.api, cv: T.cv, shell: T.shell, W: T.cv.world(), FR });
  A.rig = T.cv.rig && typeof T.cv.rig === 'object' ? T.cv.rig : null; // (lane H's host hooks; null before them)
  const st = A.api.store; A.blocked = 0;
  for (const m of ['set', 'setRaw', 'saveProject', 'saveNow']) if (st && typeof st[m] === 'function') st[m] = () => { A.blocked++; };
  A.dialogs = [];
  win.confirm = msg => { A.dialogs.push('confirm: ' + String(msg).slice(0, 160)); return true; };
  win.alert = msg => { A.dialogs.push('alert: ' + String(msg).slice(0, 160)); };
  A.errs = [];
  win.addEventListener('error', e => A.errs.push(String(e.message || e)));
  const imp = u => win.Function('u', 'return import(u)')(new URL(u, new URL('../', location.href)).href);
  A.mod = { CORE: await imp('serum-core.js?v=9'), SE: await imp('sx-edges.js?v=9') };
  try { const kr = A.doc.querySelector('#kbrow'), kh = A.doc.querySelector('#kbHide'); if (kr && !kr.hidden && kh) kh.click(); } catch (e) { console.error(e); }
  try { A.shell.topSet(0, 'end'); } catch (e) { console.error(e); }
  try { if (A.W.lockOn && A.W.lockOn()) A.W.setLock(false); } catch (e) { /* older world */ }
  await sleep(300);
}
const mounted = async () => { await sleep(250); for (let i = 0; i < 80 && A.cv.mount(); i++) await raf(); await sleep(400); };
const cords = () => { try { return A.cv.cords ? A.cv.cords() : null; } catch (e) { return null; } };
const stats = reset => { const L = cords(); return L && typeof L.stats === 'function' ? L.stats(reset) : null; };

/* ---- the scenes, through the app's hooks (lane H's rig hook first; stage 3's parts hooks before it) */
async function newTrack(model) { A.shell.srcPick(model, 'track'); await mounted(); return trk(); }
function addPart(dev, kind, part) {
  if (A.rig && typeof A.rig.add === 'function') return A.rig.add(dev, kind, part);
  return A.cv.parts.add(dev, kind, null, part);
}
function plug(dev, a, b) {
  if (A.rig && typeof A.rig.plug === 'function') return A.rig.plug(dev, a, b);
  const J = e => A.mod.SE.jackOf(dev, e);
  return A.cv.parts.connect(J(a), J(b));
}
async function rigScene(full) {
  const t = await newTrack('rig'), dev = t.prim || Object.keys(t.dev).find(k => t.dev[k].kind === 'synth'), notes = [];
  const wm = Q.get('wires');
  if (wm && A.rig && typeof A.rig.wires === 'function') { try { A.rig.wires(wm); } catch (e) { notes.push('wires(' + wm + '): ' + e.message); } }
  if (full) {
    for (const [kind, part] of RIGX.add) { try { if (!addPart(dev, kind, part)) notes.push('add ' + part + ': refused'); } catch (e) { notes.push('add ' + part + ': ' + e.message); } }
    await mounted();
    for (const [a, b] of RIGX.cords) { try { if (plug(dev, a, b) === false) notes.push('plug ' + a + ' → ' + b + ': refused'); } catch (e) { notes.push('plug ' + a + ' → ' + b + ': ' + e.message); } }
    // its own rows (the panel's matrix: Envelopes / LFOs / Macros onto its knobs — cords on a rig canvas)
    try {
      const H = A.api.sxHost(trk(), dev), { CORE } = A.mod;
      H.edit(s => { const fx = H.fx(); for (const [src, dst] of RIGX.own) CORE.addMod(s, fx, src, dst, { amt: 0.4 }); }, { label: 'ui-wc' });
    } catch (e) { notes.push('own rows: ' + e.message); }
    // the canvas modulators and their 8 rows (lines on the rig canvas: their own records)
    const made = {};
    RIGX.canvas.forEach(([want, kind], i) => { try { const k = A.cv.mod.add(kind, null); if (k) made[want] = k; } catch (e) { notes.push('mod ' + kind + ': ' + e.message); } });
    for (const [w, pid] of RIGX.rows) {
      const src = made[w] ? (/^m/.test(w) ? made[w] + '.k1' : made[w] + '.out') : null, dst = dev + ':' + pid;
      if (!src) { notes.push('row ' + w + ': no module'); continue; }
      try { if (!A.cv.mod.connect(src, dst)) notes.push('row ' + src + ' → ' + dst + ': refused'); } catch (e) { notes.push('row ' + src + ' → ' + dst + ': ' + e.message); }
    }
    try {
      const items = (A.cv.fx.items || []).filter(x => x.group === 'Effects');
      for (const x of items.slice(0, RIGX.effects)) A.cv.fx.addEffect(dev + '/fx', x.type);
    } catch (e) { notes.push('effects: ' + e.message); }
  }
  await mounted();
  try { A.cv.tidy(); } catch (e) { notes.push('tidy: ' + e.message); }
  await mounted();
  return { t: trk(), dev, notes };
}
/** (DM G9) A kit track, made as the user makes one — the kit tile's action on a new track (cv.kit.add: the Starter, 8 voices), kitX: 8 voices more —, the
 * groove painted cell by cell (cv.kit.cell: one History step each), Tidied (the voices in rows of four under the Sequencer), the engine on, 128 BPM, ▶. */
async function kitScene(full) {
  const K = A.cv.kit, notes = [];
  if (!K || typeof K.add !== 'function') throw new Error('no __synthTest.cv.kit (a build before stage DM)');
  const id = K.add(null);
  if (!id) throw new Error('cv.kit.add refused');
  await mounted();
  if (full) for (const ty of KIT.types) { try { if (!K.voice(id, 'add', ty)) notes.push('voice add ' + ty + ': refused'); } catch (e) { notes.push('voice add ' + ty + ': ' + e.message); } await sleep(60); }
  await mounted();
  const n = full ? KIT.voices.kitX : KIT.voices.kitS, cells = kitCells(n);
  for (const c of cells) { try { if (!K.cell(id, c.l, c.s, c.v)) notes.push('cell ' + c.l + '/' + c.s + ': refused'); } catch (e) { notes.push('cell ' + c.l + '/' + c.s + ': ' + e.message); } }
  try { A.cv.tidy(); } catch (e) { notes.push('tidy: ' + e.message); }
  await mounted();
  const st = K.state(id), lanes = new Set(cells.map(c => c.l)), have = st ? st.voices.length : 0;
  if (have !== n) notes.push('the kit has ' + have + ' voices, not ' + n);
  for (const v of st ? st.voices : []) if (!Object.keys(v.cells).length) notes.push('lane ' + v.slot + ' (' + v.name + ') is empty');
  const fc = K.faces(), seqKey = Array.from(fc.seqs.keys())[0], drag = Array.from(fc.voices.keys())[0];
  A.cv.setProjectBpm(KIT.bpm);
  try { await A.api.powerOn(); } catch (e) { notes.push('powerOn: ' + e.message); }
  for (let i = 0; i < 40; i++) { const c = A.api.ctx(); if (c && c.state === 'running') break; await sleep(100); }
  if (!A.api.transport().playing) A.doc.querySelector('#tPlay').click();
  for (let i = 0; i < 30 && !A.api.transport().playing; i++) await sleep(100);
  await sleep(500);
  if (!A.api.transport().playing) notes.push('the transport did not start');
  return { t: trk(), dev: seqKey ? seqKey.slice(seqKey.indexOf('/') + 1) : null, notes, kit: id, drag, lanes: lanes.size, voices: have };
}
// the scene's numbers at rest: modules, painted elements (main.js's heavy count when the build has it, else a layout-box count),
// canvases, the cord layer (its cords, mode, buffer), the drawing mode
function sceneInfo(dev) {
  const V = A.cv.view(), mods = V ? [...V.modules.values()] : [];
  let painted = 0, canvases = 0, jacks = 0;
  try { painted = A.cv.parts && typeof A.cv.parts.painted === 'function' ? A.cv.parts.painted() : 0; } catch (e) { painted = 0; }
  for (const m of mods) {
    canvases += m.el.getElementsByTagName('canvas').length;
    jacks += m.el.querySelectorAll('[data-cv-jack]').length;
    if (!painted) for (const n of m.el.getElementsByTagName('*')) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) painted++; }
  }
  const s = stats(false) || {}, V2 = A.cv.view();
  const claimed = V2 && V2.cables && typeof V2.cables.cordList === 'function' ? V2.cables.cordList().length : 0;
  let wires = null;
  try { wires = A.rig && typeof A.rig.wires === 'function' ? A.rig.wires() : null; } catch (e) { wires = null; }
  return { modules: mods.length, painted, canvases, jacks, cords: s.cords || 0, claimed, mode: wires || (claimed ? 'cords' : 'lines'), layer: s.mode || null,
    buffer: s.buffer || '0×0', bufferMB: r1((s.bytes || 0) / 1048576), alloc: !!s.alloc, perf: s.perf || null, dev };
}

/* ---- the phases */
function recorder() { // frame intervals in the app frame + the world's bursts
  const { win, W } = A, R = { f: [], ev: [] };
  let last = -1, on = true;
  const tick = t => { if (last >= 0) R.f.push(t - last, t); last = t; if (on) win.requestAnimationFrame(tick); };
  win.requestAnimationFrame(tick);
  const offs = [W.on('movestart', () => R.ev.push(1, now())), W.on('cameraend', () => R.ev.push(2, now()))];
  return { R, stop() { on = false; for (const f of offs) f(); return R; } };
}
async function drive(kind, ms, F = 1.6) { // pan: a 300 px sine; zoom: k × F and back about the centre
  const W = A.W, vp = A.doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const t0 = now(); let lastX = 0, lastK = 1;
  while (now() - t0 < ms) {
    await raf();
    const ph = (now() - t0) / ms * 2 * Math.PI;
    if (kind === 'pan') { const x = 300 * Math.sin(ph); W.panBy(x - lastX, 0); lastX = x; }
    else { const k = Math.pow(F, 0.5 - 0.5 * Math.cos(ph)); W.zoomAt(k / lastK, cx, cy); lastK = k; }
  }
}
async function pinch(ms) { // 25 % ↔ 200 % about the centre (one cosine: down, up, back)
  const W = A.W, vp = A.doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2, k0 = W.k;
  const t0 = now(); let lastK = k0;
  while (now() - t0 < ms) {
    await raf();
    const ph = (now() - t0) / ms, k = ph < 0.5 ? k0 * Math.pow(0.25 / k0, Math.sin(Math.PI * ph)) : k0 * Math.pow(2 / k0, Math.sin(Math.PI * (ph - 0.5)));
    W.zoomAt(k / lastK, cx, cy); lastK = k;
  }
  W.zoomAt(k0 / lastK, cx, cy);
}
async function ampDrag(dev, ms) { // the Amplifier moved on the dots, 32 px a frame, out and back (its cords awake)
  const V = A.cv.view(), m = V && V.modules.get(dev);
  if (!m || typeof m.nudge !== 'function') return false;
  const t0 = now(); let i = 0;
  while (now() - t0 < ms) { await raf(); m.nudge(i++ % 16 < 8 ? 32 : -32, 0); }
  return true;
}
async function measure(S) {
  A.W.fit({ animate: false }); await sleep(500);
  const rec = recorder(), win = [], out = {};
  const phase = async (name, run) => {
    stats(true);
    const a = now(); await run(); win.push([name, a, now()]);
    const s = stats(false);
    out['cords:' + name] = s ? { awakeMax: s.awakeMax, stepMs: r3(s.stepMs), stepMax: r3(s.stepMax), drawMs: r3(s.drawMs), drawMax: r3(s.drawMax), uploads: s.uploads, KB: r1((s.uploadBytes || 0) / 1024), lost: s.lost } : null;
  };
  await phase('idle', () => sleep(1000));
  await phase('pan', () => drive('pan', 2000));
  await phase('pinch', () => pinch(3000));
  await phase('settle', () => sleep(900));
  if (S.rig && !S.kit) await phase('amp', async () => { if (!(await ampDrag(S.dev, 1500))) out.ampNote = 'no module to drag'; await sleep(600); });
  if (S.kit) await phase('drag', async () => { if (!(await ampDrag(S.drag, 1500))) out.dragNote = 'no module to drag (' + S.drag + ')'; await sleep(600); }); // ((DM G9) a voice face moved on the dots: its module's own drag, the Sequencer and the others still)
  if (S.rig) await phase('sway', async () => { const L = cords(); if (L && typeof L.pluck === 'function') L.pluck(); await drive('pan', 2000); });
  await phase('rest', () => sleep(1200));
  const R = rec.stop();
  for (const [name, a, b] of win) { const x = analyse(R, a, b); out[name] = Object.assign({}, x.all, { burstMed: x.burst.med, burstP95: x.burst.p95, burstMax: x.burst.max, firstMove: x.first.max, settle: x.settle.max, bursts: x.bursts }); }
  const tot = analyse(R);
  out.total = { burst: tot.burst, first: tot.first, settle: tot.settle, verdict: verdict(tot) };
  return out;
}
async function sweep(ms) { // 60 s of k 0.25 ↔ 2 (with a pan) and the cords plucked: context losses, the buffer, the frames
  const W = A.W, vp = A.doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const L = cords(), s0 = stats(true) || {}, rec = recorder(), t0 = now();
  let lastK = W.k, lastX = 0, gl = 0;
  if (L && typeof L.pluck === 'function') L.pluck();
  while (now() - t0 < ms) {
    await raf();
    const t = (now() - t0) / 1000, k = 0.25 * Math.pow(8, 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 7.5)), x = 160 * Math.sin(2 * Math.PI * t / 5);
    W.zoomAt(k / lastK, cx, cy); lastK = k; W.panBy(x - lastX, 0); lastX = x;
    if (L && (t | 0) % 6 === 0 && typeof L.pluck === 'function') L.pluck();
    try { const g = W.glStats(); if (g) gl = Math.max(gl, g.bytes || 0); } catch (e) { /* 2D */ }
  }
  await sleep(1200);
  const R = rec.stop(), a = analyse(R), s = stats(false) || {};
  return { ms, frames: a.all, burst: a.burst, verdict: verdict(a, { lost: (s.lost || 0) > (s0.lost || 0) }), lost: s.lost || 0, mode: s.mode || null, buffer: s.buffer || '0×0', glMB: r1(gl / 1048576) };
}

/* ---- the run */
async function runScene(id) {
  say(id + ': building');
  const kit = id === 'kitS' || id === 'kitX', S = { id, rig: id !== 'juno' && !kit };
  if (id === 'juno') { const t = await newTrack('juno60'); S.dev = t.prim; S.notes = []; }
  else if (kit) Object.assign(S, await kitScene(id === 'kitX'));
  else Object.assign(S, await rigScene(id === 'rigX'));
  const info = sceneInfo(S.dev);
  const bar = id === 'rigX' ? DOM_BAR.full + DOM_BAR.perJack * info.jacks : id === 'rig1' ? DOM_BAR.complete : kit ? KIT.bar[id] : null;
  const res = { id, info, notes: S.notes, kit: kit ? { id: S.kit, voices: S.voices, lanes: S.lanes, drag: S.drag, heavy: (() => { try { return A.cv.kit.heavy(); } catch (e) { return null; } })(), playing: !!A.api.transport().playing } : undefined, painted: { n: info.painted, bar, ok: bar == null || info.painted <= bar, heavy: info.painted > DOM_BAR.heavy } };
  if (id === 'juno') res.w7 = { buffer: info.buffer, alloc: info.alloc, ok: info.buffer === '0×0' && !info.alloc && info.claimed === 0 };
  say(id + ': measuring');
  res.m0 = await measure(S);
  if (S.rig) { // ((fixer B2, P3-9) rigX: the 40-awake budget reached — its sway's awake maximum ≥ CORD_BAR.awake)
    const awake = res.m0['cords:sway'] || {};
    res.cordBar = { awakeMax: awake.awakeMax, stepMs: awake.stepMs, drawMs: awake.drawMs, reached: id !== 'rigX' || awake.awakeMax >= CORD_BAR.awake,
      ok: !!awake.awakeMax && awake.stepMs <= CORD_BAR.step && awake.drawMs <= CORD_BAR.draw && (id !== 'rigX' || awake.awakeMax >= CORD_BAR.awake) };
  }
  if (id === 'rigX' && Q.get('sweep') !== '0') { say(id + ': 60 s sweep'); res.sweep = await sweep(60000); }
  return res;
}
export async function main() {
  Q = new URLSearchParams(location.search); AUTO = Q.get('auto') === '1';
  document.title = 'SYNTH — Wavecraft frame cost (ui-bench ?wc=1)';
  document.body.innerHTML = '<h1>Wavecraft canvas: frame cost (IMPL-WC G7)</h1><p>Builds a Juno track, the starter rig and the full WC-1 rig with the app\'s own hooks and cord layer, then pans, pinches 25–200 %, drags the Amplifier, sways every cord and (on the full rig) sweeps the zoom for 60 s. Leave the page alone while it runs.</p>'
    + '<p><button id="run" type="button">Run</button> <button id="copy" type="button" disabled>Copy results</button> <span id="status"></span></p><iframe id="frame" title="SYNTH Canvas" style="width:1440px;height:900px;border:0"></iframe><textarea id="out" readonly style="width:100%;height:240px"></textarea>';
  const W = window.__wc = { state: 'loading', result: null };
  const run = async () => {
    W.state = 'running'; $('#run').disabled = true;
    try {
      await boot();
      const scenes = (Q.get('scenes') ? Q.get('scenes').split(',') : SCENES.slice()).filter(x => SCENES.includes(x));
      const out = { kind: 'ui-WC-mac', when: new Date().toISOString(), ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
        env: { host: A.rig ? 'cv.rig (lane H)' : 'stage 3 hooks (cv.parts): the rigs as stage 3 drew them — informational', preset: A.FR.presetInfo(A.W, location.search), wiresAsked: Q.get('wires') || null }, scenes: {} };
      out.spinMs = spin(); // ((DM G9) a fixed JS loop's time: ×1 the machine's, ×N under a CDP CPU throttle of N — the proof the throttle reached the page)
      for (const id of scenes) { try { out.scenes[id] = await runScene(id); } catch (e) { out.scenes[id] = { error: String(e && e.message || e) }; } }
      out.blocked = A.blocked; out.dialogs = A.dialogs; out.errors = A.errs.slice(0, 20);
      W.result = out; W.state = 'done';
      $('#out').value = JSON.stringify(out, null, 1); $('#copy').disabled = false;
      say('done');
    } catch (e) { W.state = 'error'; W.error = String(e && e.message || e); say('error: ' + W.error); }
  };
  $('#run').addEventListener('click', run);
  $('#copy').addEventListener('click', () => { const t = $('#out'); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } });
  W.state = 'ready';
  if (AUTO) run();
}

/* ------------------------------------------------------------------------------------------------ the driver (node) */
/** argv → { scenes, throttles, out, profile, sweep, errors }. Pure. */
export function parseArgs(argv) {
  const o = { scenes: SCENES.slice(), throttles: [1, 4, 6], out: null, profile: null, sweep: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--scenes') { const l = String(v || '').split(',').filter(Boolean); if (l.length && l.every(x => SCENES.includes(x))) o.scenes = l; else o.errors.push('--scenes: ' + v); i++; }
    else if (a === '--throttle') { const l = String(v || '').split(',').map(Number); if (l.length && l.every(x => x >= 1 && x <= 20)) o.throttles = l; else o.errors.push('--throttle: ' + v); i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--profile') { o.profile = v; i++; }
    else if (a === '--sweep') o.sweep = true;
  }
  return o;
}
const isMain = typeof process !== 'undefined' && process.versions && process.versions.node && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) await cli();
/** node --max-old-space-size=2048 tests/ui-bench-wc.mjs [--scenes juno,rig1,rigX,kitS,kitX] [--throttle 1,4,6] [--out report.json] [--profile dir] [--sweep]
 *  Serves the repo, opens tests/ui-bench.html?wc=1&auto=1 in Chrome for Testing ($CHROME, else the repo's .claude/test-browser; its own --user-data-dir,
 *  downloads denied, killed at the end) once per CPU throttle (CDP Emulation.setCPUThrottlingRate on the page; the 60 s sweep off unless --sweep), reads
 *  window.__wc, prints the kit scenes' verdicts (kitGate: P+ at 1 × / 4 ×, P at 6 ×) and exits 1 when one fails. The report: { kind, runs: [{ throttle, result }] }. */
async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.errors.length) { console.error('bad arguments: ' + o.errors.join(' · ')); process.exit(2); }
  const [http, fs, path, os, url, cp] = await Promise.all(['node:http', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:child_process'].map(m => import(m)));
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const findChrome = () => {
    if (process.env.CHROME) return process.env.CHROME;
    for (let dir = ROOT, i = 0; i < 5; i++, dir = path.dirname(dir)) {
      const tb = path.join(dir, '.claude', 'test-browser');
      if (!fs.existsSync(tb)) continue;
      for (const v of fs.readdirSync(tb).sort().reverse()) { const exe = path.join(tb, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'); if (fs.existsSync(exe)) return exe; }
    }
    throw new Error('no Chrome for Testing: set $CHROME');
  };
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port, prof = fs.mkdtempSync(path.join(o.profile || os.tmpdir(), 'wc-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--use-angle=metal',
    '--force-device-scale-factor=2', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'];
  const ch = cp.spawn(findChrome(), flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const bye = () => { try { ch.kill(); } catch (e) { /* gone */ } };
  process.once('exit', bye); process.once('SIGINT', () => { bye(); process.exit(130); }); process.once('SIGTERM', () => { bye(); process.exit(143); });
  const rep = { kind: 'ui-WC-mac-runs', when: new Date().toISOString(), config: { scenes: o.scenes, throttles: o.throttles, sweep: o.sweep }, runs: [], gates: [] };
  let bad = 0;
  try {
    const wsUrl = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 30000); ch.stderr.on('data', x => { b += x; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) { clearTimeout(t); res(m[1]); } }); ch.on('exit', () => rej(new Error('Chrome exited'))); });
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('devtools socket')); });
    let id = 0; const pend = new Map();
    ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { const { r, j } = pend.get(x.id); pend.delete(x.id); x.error ? j(new Error(x.error.message || JSON.stringify(x.error))) : r(x.result); } };
    const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {}))); });
    await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // never a file in the user's folders
    rep.chrome = (await send('Browser.getVersion')).product;
    for (const th of o.throttles) {
      const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
      await send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId });
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId), ev = async expr => { const v = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (v.exceptionDetails) throw new Error((v.exceptionDetails.exception || {}).description || v.exceptionDetails.text); return v.result.value; };
      await s('Runtime.enable'); await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      await s('Emulation.setCPUThrottlingRate', { rate: th });
      console.log('== ' + th + '× CPU: ' + o.scenes.join(', '));
      await s('Page.navigate', { url: base + '/tests/ui-bench.html?wc=1&auto=1&scenes=' + o.scenes.join(',') + (o.sweep ? '' : '&sweep=0') });
      let st = '';
      for (let i = 0; i < 4000 && st !== 'done' && st !== 'error'; i++) { await new Promise(r => setTimeout(r, 500)); try { st = await ev('window.__wc ? window.__wc.state : "none"'); } catch (e) { /* navigating */ } }
      const w = JSON.parse(await ev('JSON.stringify(window.__wc)'));
      rep.runs.push({ throttle: th, state: w.state, error: w.error || null, result: w.result || null });
      if (!w.result) { console.log('   ' + w.state + (w.error ? ': ' + w.error : '')); bad++; }
      else {
        const R = w.result;
        console.log('   spin ' + R.spinMs + ' ms · errors ' + JSON.stringify(R.errors) + ' · dialogs ' + JSON.stringify(R.dialogs));
        for (const sid of o.scenes) {
          const S = R.scenes[sid];
          if (!S) continue;
          if (S.error) { console.log('   ' + sid + ': ERROR ' + S.error); bad++; continue; }
          console.log('   ' + sid + ': painted ' + S.painted.n + (S.painted.bar ? ' / ' + S.painted.bar : '') + ' · camera ' + (S.m0.total ? S.m0.total.verdict : '–') + ' (bursts ' + (S.m0.total ? S.m0.total.burst.med + ' / ' + S.m0.total.burst.p95 + ' / ' + S.m0.total.burst.max : '–') + ' ms)' + (S.sweep ? ' · sweep ' + S.sweep.verdict : ''));
          if (sid === 'kitS' || sid === 'kitX') for (const g of kitGate(S, th)) { rep.gates.push(Object.assign({ scene: sid, throttle: th }, g)); console.log('     ' + (g.pass ? 'ok  ' : 'FAIL') + ' ' + g.id + ' — ' + g.note); if (!g.pass) bad++; }
        }
        if ((R.errors || []).length) bad++;
      }
      try { await send('Target.closeTarget', { targetId }); await send('Target.disposeBrowserContext', { browserContextId }); } catch (e) { /* gone */ }
    }
    ws.close();
  } finally { bye(); srv.close(); await new Promise(r => setTimeout(r, 700)); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* busy */ } }
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(rep, null, 1));
  console.log('\nui-bench-wc: ' + rep.runs.length + ' run(s), ' + bad + ' failed check(s)');
  process.exit(bad ? 1 : 0);
}
