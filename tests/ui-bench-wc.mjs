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
  if (S.rig) await phase('amp', async () => { if (!(await ampDrag(S.dev, 1500))) out.ampNote = 'no module to drag'; await sleep(600); });
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
  const S = { id, rig: id !== 'juno' };
  if (id === 'juno') { const t = await newTrack('juno60'); S.dev = t.prim; S.notes = []; }
  else Object.assign(S, await rigScene(id === 'rigX'));
  const info = sceneInfo(S.dev);
  const bar = id === 'rigX' ? DOM_BAR.full + DOM_BAR.perJack * info.jacks : id === 'rig1' ? DOM_BAR.complete : null;
  const res = { id, info, notes: S.notes, painted: { n: info.painted, bar, ok: bar == null || info.painted <= bar, heavy: info.painted > DOM_BAR.heavy } };
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
      const scenes = (Q.get('scenes') ? Q.get('scenes').split(',') : ['juno', 'rig1', 'rigX']).filter(x => ['juno', 'rig1', 'rigX'].includes(x));
      const out = { kind: 'ui-WC-mac', when: new Date().toISOString(), ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
        env: { host: A.rig ? 'cv.rig (lane H)' : 'stage 3 hooks (cv.parts): the rigs as stage 3 drew them — informational', preset: A.FR.presetInfo(A.W, location.search), wiresAsked: Q.get('wires') || null }, scenes: {} };
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
