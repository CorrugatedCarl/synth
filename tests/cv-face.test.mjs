import './v8-guard.mjs';
// cv-face (IMPL-1h §3, lane F): the registry and its modes, the base texture's life with a fake gl (bytes, mips, freed on
// unmount / loss / destroy), the quads (z order, the body clip, the window above k = 1), the windows (level maths incl.
// the budget level, keep / rebuild / free, one per frame nearest first, cancelled by a burst), the budget eviction order,
// the overlap rule, the stats. Fake DOM (wk-dom), fake gl (the §2 surface), fake world (rectOf / on / onScreen / cam).
// (1i, IMPL-1i §3.3) the keyboard faces: 1:1 at dpr 2, ≤ 58 MB each, the recorded exemption at dpr 2.5 / 3 pinned.
// (9, IMPL-9 §2.2) the 900 Series faces: the module and console sizes (= moog-core's), 1:1 at dpr 2, the Model 15 set's bytes.
// (9b, IMPL-9b §4.2) the System 35 / 55 faces: 4 / 8 MU and the console-height sizes, the 960 ≤ 9 MB, the sets' bytes (S55 ≈ 72.6 MB).
// Only strings / numbers / booleans go into assert (never a fake-DOM node).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as CF from '../cv-face.js?v=9';
import { faceTier } from '../cv-panel.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { K_MAX } from '../cv-world.js?v=9';
import * as wk from '../wk.js?v=9';
import { fresh, raf } from './wk-dom.mjs';
import { createHash } from 'node:crypto';

const { FACES, WIN_K0, WIN_MARGIN, WIN_HEAD, WIN_BUDGET_PX, WIN_MAX_PX, TEX_MAX_DIM, FACE_BUDGET_BYTES, BASE_MAX_PX, OFF_ALPHA, baseLevel, winLevel, winLevelOf, visPart, winRect, winKeep } = CF;
const eq1 = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, (m || '') + ' ' + a + ' ≈ ' + b);
const SVGNS = 'http://www.w3.org/2000/svg';

/* ---- the fakes */
function fakeGL() {
  const G = {
    texes: new Set(), ups: [], frees: 0, fail: false, tries: 0, // (P: fail may be a predicate of the source; maxTex / ready set by a test)
    upload(src, o) {
      G.tries++;
      if (G.fail === true || (typeof G.fail === 'function' && G.fail(src))) return null;
      const t = { w: src.width, h: src.height, bytes: Math.round(src.width * src.height * 4 * (o && o.mips ? 4 / 3 : 1)), mips: !!(o && o.mips), src: src.localName, calls: src.getContext('2d').calls.splice(0) }; // (the scratch is reused: this paint's calls)
      G.texes.add(t); G.ups.push(t);
      return t;
    },
    free(t) { if (G.texes.delete(t)) G.frees++; },
    stats() { let b = 0; for (const t of G.texes) b += t.bytes; return { bytes: b, texes: G.texes.size }; },
  };
  return G;
}
function fakeWorld(vw = 1366, vh = 1024) {
  const items = new Map(), subs = new Map();
  let cam = { tx: 0, ty: 0, k: 0.3 }; // (at rest below WIN_K0: no window until a test zooms in)
  const W = {
    viewport: { clientWidth: vw, clientHeight: vh },
    get cam() { return Object.assign({}, cam); },
    rectOf: id => (items.has(id) ? Object.assign({}, items.get(id).rect) : null),
    onScreen: id => (items.has(id) ? items.get(id).on : false),
    ids: () => [...items.keys()],
    on(t, f) { let s = subs.get(t); if (!s) subs.set(t, s = new Set()); s.add(f); return () => s.delete(f); },
    emit(t, d) { for (const f of [...(subs.get(t) || [])]) f(d); },
    set(id, rect, on = true) { items.set(id, { rect, on }); }, del(id) { items.delete(id); },
    setCam(c) { cam = Object.assign({}, cam, c); },
    end(c) { if (c) W.setCam(c); W.emit('cameraend', { cam: W.cam, zoomed: true }); },
  };
  return W;
}
// a document with the canvas world, Image / Blob / URL stubs (loads landed by hand), manual animation frames
function rig(o = {}) {
  const d = fresh(), win = d.defaultView;
  raf.install();
  win.devicePixelRatio = o.dpr == null ? 2 : o.dpr;
  const world = d.createElement('div'); world.setAttribute('data-cv-world', ''); d.body.append(world);
  const home = d.createElement('div'); home.id = 'cvParts'; home.setAttribute('hidden', ''); d.body.append(home); // (main.js: the device elements' home)
  const R = { k: 1, imgs: [], urls: new Set(), made: 0 };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  win.Image = Img; win.Blob = Bl; win.URL = { createObjectURL: b => { const u = 'blob:' + (++R.made); R.urls.add(u); R.blob = b; return u; }, revokeObjectURL: u => R.urls.delete(u) };
  // rig({ mo: true }): a MutationObserver FACES can take (the module's style / class / fold / power, #world's data-cv-patching);
  // a test fires one by hand with mo(el) after writing the attribute (the browsers deliver it at the task's end)
  const MOS = [];
  if (o.mo) win.MutationObserver = class { constructor(cb) { this.cb = cb; MOS.push(this); } observe(el, opt) { this.el = el; this.opt = opt; } disconnect() { this.el = null; } };
  const mo = el => { for (const m of MOS) if (m.el === el) m.cb([]); };
  const env = { win, doc: d, scale: () => R.k, raf: f => globalThis.requestAnimationFrame(f) };
  const G = fakeGL(), W = fakeWorld(o.vw, o.vh);
  const mods = [];
  // a module shell alone (a main.js re-home puts a device's .inst into a new one)
  function shell(id, p = {}) {
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-mod', id); mod.style.zIndex = String(p.z == null ? 1 : p.z); mod.style.left = (p.x || 0) + 'px'; mod.style.top = (p.y || 0) + 'px';
    if (p.fold) mod.setAttribute('data-cv-fold', '');
    const body = d.createElement('div'); body.className = 'cv-body'; mod.append(body);
    return { mod, body };
  }
  // a hardware module: .cv-mod[data-cv-mod] > .cv-body > .inst.hw > .hw-decor > svg; registered with cv-face
  function panel(id, p = {}) {
    const x = p.x || 0, y = p.y || 0, w = p.w || 400, h = p.h || 200;
    const { mod, body } = shell(id, Object.assign({ x, y }, p));
    const root = d.createElement('div'); root.className = 'inst hw' + (p.wood ? ' hw-wood' : ''); root.style.setProperty('--hw-case', p.fill || '#222222'); if (p.wood) root.style.setProperty('--hw-wood', '#5a3218');
    const deco = d.createElement('div'); deco.className = 'hw-decor';
    const svg = d.createElementNS(SVGNS, 'svg');
    deco.append(svg); root.append(deco); body.append(root);
    if (p.mount !== false) world.append(mod);
    W.set(id, { x, y, w, h: h + BAR_H }, p.on !== false);
    const moduleOf = () => { for (let n = deco; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute('data-cv-mod')) return n.getAttribute('data-cv-mod'); return null; };
    const face = FACES.register(deco, { markup: `<svg xmlns="${SVGNS}" width="${w}" height="${h}"></svg>`, w, h, moduleOf, offset: () => ({ x: 0, y: BAR_H }), tier: faceTier, env });
    const M = { id, mod, body, root, deco, svg, face, w, h, sentinel: () => deco.childNodes.find(n => n.localName === 'canvas' && n.className === 'hw-rel') || null, bm: () => deco.childNodes.filter(n => n.localName === 'canvas' && n.className === 'hw-bm').length };
    mods.push(M);
    return M;
  }
  FACES.stats(true);
  const land = (good = true) => { const i = R.imgs.at(-1); if (good) i.onload(); else i.onerror(); };
  const landAll = () => { for (const i of R.imgs) if (i.onload) i.onload(); };
  const frames = n => raf.flush(n || 1);
  const st = M => ({ mode: M.face.mode, svg: M.svg.style.visibility || 'visible', attr: M.mod.getAttribute('data-cv-face'), bm: M.bm(), shown: M.face.shown });
  const attach = () => FACES.attach({ gl: G, world: W });
  const done = () => { for (const M of mods) M.face.destroy(); FACES.detach(); FACES.setPerf('high'); raf.uninstall(); }; // (P: the preset is module state)
  return { d, win, world, home, R, G, W, env, panel, shell, mo, land, landAll, frames, st, attach, done, mods };
}
// one queued base: a frame starts the load, the load lands (the job is re-queued at the front), a frame paints
const landBase = g => { g.frames(); g.land(); g.frames(); };
// every queued job (nearest the viewport centre first): frames and landed loads until nothing is pending
const settle = (g, max = 40) => { for (let i = 0; i < max && (FACES.stats().queued || raf.pending); i++) { g.frames(); g.landAll(); } };

/* ---- (1i, IMPL-1i §3.3) the keyboard faces: the §1.2 module sizes (outer px, the 40 px bar included) */
const FACES_1I = { modular: [2176, 1280], minimoog: [1408, 736], arp2600: [1856, 1344], solina: [1984, 448], cs80: [2432, 1024], prophet5: [1920, 864],
  ms20: [1120, 704], tb303: [608, 608], obxa: [2048, 928], jupiter8: [2144, 928], juno60: [2144, 800], dx7: [2048, 800] };
// the recorded exemption above dpr 2 (the 16 M px base ceiling, iOS's 2D canvas limit): baseLevel / dpr, three decimals
const BELOW_1 = { 2.5: { modular: 0.974 }, 3: { modular: 0.812, arp2600: 0.857, cs80: 0.862, jupiter8: 0.966, obxa: 0.989 } };
test('1i faces: every keyboard face ≤ 10.8 M px at dpr 2 (< BASE_MAX_PX) — baseLevel(2) = 2, 1:1 at rest to k = 1 — and ≤ 58 MB of base + mips; at dpr 2.5 the modular 0.974 of 1:1, the rest 1.000; at dpr 3 the §3.3 numbers (pinned: a change is visible); the authored layouts with a bed too', async () => {
  const P = await import('../cv-panel.js?v=9'), { MODELS } = await import('../models.js?v=9');
  for (const [id, [w, H]] of Object.entries(FACES_1I)) {
    const h = H - BAR_H;
    assert.ok(w * h * 4 <= 10.8e6 + 5e4 && w * h * 4 < BASE_MAX_PX, id + ': ' + w * h * 4 + ' px');
    eq1(baseLevel(2, w, h), 2, id + ': L0 = 2 at dpr 2');
    assert.ok(w * h * 4 * 4 * 4 / 3 <= 58e6, id + ': base + mips ' + (w * h * 4 * 4 * 4 / 3 / 1e6).toFixed(1) + ' MB');
    for (const d of [2.5, 3]) eq1(Math.round(baseLevel(d, w, h) / d * 1000) / 1000, BELOW_1[d][id] || 1, `${id} at dpr ${d}`);
  }
  for (const id of P.HW_IDS) { // (lane K2's layouts: once a model has its bed, its real face)
    const L = P.layoutOf(id), m = MODELS.find(x => x.id === id);
    if (!L || !(L.controls || []).some(c => c && c.id === 'perf:keys')) continue;
    const s = P.sizeOf(L, m);
    eq1(baseLevel(2, s.w, s.h - BAR_H), 2, id + ' (authored): L0 = 2 at dpr 2');
  }
});

/* ---- (9, IMPL-9 §2.2, §8.4) the 900 Series faces: the console and the nine module faces (outer px, the 40 px bar included);
   (9b, IMPL-9b §2.1, §4.2, §8.4) + the sixteen System 35 / 55 faces: 4 MU 448 × 512, 8 MU 864 × 512, console height × 352;
   (9c, IMPL-9c §1.0, §3 G6) + the ten 1960s faces: the 901 3 MU 352 × 512, the 904C / 905 2 MU, the 984 4 MU 448 × 512, the CP3 console 448 × 352 */
const FACES_9 = { ctl: [864, 352], 921: [224, 512], '921a': [128, 512], '921b': [128, 512], 923: [128, 512], '904a': [128, 512], '907a': [352, 512], 911: [128, 512], 902: [128, 512], 995: [128, 512],
  '904b': [128, 512], 914: [448, 512], '911a': [128, 512], '903a': [128, 512], 960: [864, 512], 962: [128, 512], 992: [128, 512], 993: [128, 512], 994: [128, 512],
  cp2: [352, 352], cp3a: [448, 352], cp4a: [352, 352], cp35: [448, 352], cp8a: [224, 352], 961: [352, 352], clk: [224, 352],
  901: [352, 512], '901a': [128, 512], '901b': [128, 512], '901c': [128, 512], '904c': [224, 512], 905: [224, 512], 912: [128, 512], 984: [448, 512], 991: [128, 512], cp3: [448, 352] };
// the System IIIc's modules in their numbering order (IMPL-9c §2: 36 + the controller; `S3C` in moog-core must agree once K lands it)
const S3C_FACES = ['901', '901a', '901a', '901a', ...Array(9).fill('901b'), '903a', '994', '912', '904a', '904b', '904c', '905', '914', '911', '911', '911', '911a', '902', '902', '902', '984', '992', '993', 'cp3', 'cp3', 'cp3', 'cp3', 'cp8a'];
test('9 / 9b / 9c faces: §2.2\'s sizes (1 MU 128 × 512 … 8 MU 864 × 512; console height 224 / 352 / 448 × 352; the console 864 × 352) = moog-core\'s w / h; each 1:1 at rest at dpr 2 (baseLevel 2) in ≤ 6 MB of base + mips (the 960 ≤ 9 MB); the Model 15 set ≈ 24.4 MB, under a fifteenth of FACE_BUDGET_BYTES; the System 35 ≈ 43.7 MB, the System 55 ≈ 72.6 MB (IMPL-9b §4.2: ≈ 74), under a fifth; (9c) the System IIIc\'s 36 modules + the controller ≈ 69.8 MB, under the System 55\'s and a fifth', async () => {
  const P = await import('../cv-panel.js?v=9'), MG = await import('../moog-core.js?v=9'), { MODELS } = await import('../models.js?v=9');
  const bytes = (w, H) => w * (H - BAR_H) * 4 * 4 * 4 / 3; // dpr 2: 4 device px a world px, RGBA, + mips
  eq1(MG.ORDER_ALL.slice().sort(), Object.keys(FACES_9).sort(), 'every type');
  for (const t of MG.ORDER_ALL) {
    const L = t === 'ctl' ? P.layoutOf('m900') : P.moduleLayout(t), m = t === 'ctl' ? MODELS.find(x => x.id === 'm900') : P.moduleModel(t), s = P.sizeOf(L, m);
    eq1([s.w, s.h], FACES_9[t], t + ': §2.2');
    eq1([s.w, s.h], [MG.TYPES[t].w, MG.TYPES[t].h], t + ': moog-core\'s w / h');
    eq1(baseLevel(2, s.w, s.h - BAR_H), 2, t + ': L0 = 2 at dpr 2');
    assert.ok(bytes(s.w, s.h) <= (t === '960' ? 9e6 : 6e6), t + ': ' + (bytes(s.w, s.h) / 1e6).toFixed(2) + ' MB');
  }
  const M15 = ['ctl', '902', '902', '904a', '907a', '911', '911', '921', '921a', '921b', '921b', '923', '995'], total = M15.reduce((a, t) => a + bytes(...FACES_9[t]), 0);
  assert.ok(total <= 25e6 && total <= FACE_BUDGET_BYTES / 15, 'the Model 15 set: ' + (total / 1e6).toFixed(1) + ' MB');
  const set = ts => ['ctl', ...ts].reduce((a, t) => a + bytes(...FACES_9[t]), 0), s35 = set(MG.S35), s55 = set(MG.S55);
  eq1([Math.round(s35 / 1e5) / 10, Math.round(s55 / 1e5) / 10], [43.7, 72.6], 'the sets\' faces (MB)');
  assert.ok(s55 <= 74e6 && s55 <= FACE_BUDGET_BYTES / 5, 'the System 55: ' + (s55 / 1e6).toFixed(1) + ' MB');
  // (9c) each 9c face (a 1 MU 1.29 MB … the 984 4.51 MB) and the System IIIc (the literal numbering list; the table's S3C, when it has one, the same modules)
  eq1(['901', '901a', '901b', '901c', '904c', '905', '912', '984', '991', 'cp3'].map(t => Math.round(bytes(...FACES_9[t]) / 1e4) / 100), [3.54, 1.29, 1.29, 1.29, 2.26, 2.26, 1.29, 4.51, 1.29, 2.98], 'the 9c faces (MB)');
  const s3c = set(S3C_FACES);
  eq1([S3C_FACES.length, Math.round(s3c / 1e5) / 10], [36, 69.8], 'the System IIIc\'s faces (MB)');
  assert.ok(s3c <= s55 && s3c <= FACE_BUDGET_BYTES / 5, 'the System IIIc: ' + (s3c / 1e6).toFixed(1) + ' MB');
  if (MG.S3C) eq1(MG.S3C.slice().sort(), S3C_FACES.slice().sort(), 'moog-core\'s S3C = the IIIc\'s modules');
});

/* ---- the maths */
test('1h maths: the base level (min(dpr, 3), ≤ BASE_MAX_PX), the window level (dpr·K_MAX, dpr·WIN_HEAD·k, the budget level), the visible part, the window rect, keep', () => {
  eq1([baseLevel(1, 400, 200), baseLevel(2, 400, 200), baseLevel(3, 2432, 728), baseLevel(4, 400, 200)], [1, 2, 3, 3], 'min(dpr, 3)');
  near(baseLevel(3, 4000, 2000), Math.sqrt(BASE_MAX_PX / 8e6), 'capped at BASE_MAX_PX');
  near(baseLevel(2, 4000, 2000), Math.sqrt(BASE_MAX_PX / 8e6), '4000 × 2000 at dpr 2 (32 M px) capped too');
  near(winLevel(2, 1.6, 1e5), 2 * K_MAX, 'dpr · K_MAX wins at 160 %');
  near(winLevel(2, 0.6, 1e5), 2 * WIN_HEAD * 0.6, 'dpr · WIN_HEAD · k wins at 60 %');
  near(winLevel(2, 1.6, WIN_BUDGET_PX / 4), 2, 'the budget level √(WIN_BUDGET_PX / Σ area)');
  near(winLevel(2, 1.6, 0), 2 * K_MAX, 'no area: no budget bound');
  near(winLevelOf(2, 1.6, 0, 1068, 728), 4, 'a window within the raster ceilings: the level as is');
  near(winLevelOf(2, 1, 0, 2050, 728), Math.sqrt(WIN_MAX_PX / (2050 * 728)), 'a whole CS-80 width at level 4 (24 M px) drops to the 16 M px ceiling');
  near(winLevelOf(2, 1, 0, 2432, 100), TEX_MAX_DIM / 2432, 'no side over TEX_MAX_DIM');
  near(baseLevel(3, 3000, 100), TEX_MAX_DIM / 3000, 'the base too');
  const cam = { tx: 0, ty: 0, k: 1 }, R = { x: 1000, y: 500, w: 2432, h: 728 };
  eq1(visPart(R, cam, 1366, 1024), { x: 0, y: 0, w: 366, h: 524 }, 'the visible part, face-local');
  eq1(visPart({ x: 2000, y: 0, w: 100, h: 100 }, cam, 1366, 1024), null, 'off screen');
  const S = CF.WIN_SNAP, up = v => Math.ceil(v / S) * S;
  eq1(winRect(R, cam, 1366, 1024), { x: 0, y: 0, w: up(708), h: 728 }, 'grown by WIN_MARGIN · the viewport (341.5, 256) to the WIN_SNAP stride, clipped to the face');
  const z = { tx: -1500, ty: -700, k: 1.6 }; // the view at world (937.5, 437.5), 853.75 × 640: the face's top-left corner region
  const v2 = visPart(R, z, 1366, 1024);
  near(v2.x, 0); near(v2.w, (1500 + 1366) / 1.6 - 1000); near(v2.y, 0); near(v2.h, (700 + 1024) / 1.6 - 500);
  const wr = winRect(R, z, 1366, 1024);
  eq1([wr.x, wr.y, wr.w, wr.h], [0, 0, up((1500 + 1366) / 1.6 + WIN_MARGIN * 1366 / 1.6 - 1000), Math.min(728, up((700 + 1024) / 1.6 + WIN_MARGIN * 1024 / 1.6 - 500))], 'grown by the margin (213.4, 160 world px) past the visible part, on the stride, clipped to the face');
  const win = { x: 0, y: 0, w: 708, h: 728, L: 4 };
  eq1([winKeep(win, { x: 10, y: 10, w: 600, h: 700 }, 2, 1.6), winKeep(win, { x: 10, y: 10, w: 700, h: 700 }, 2, 1.6), winKeep(win, { x: 10, y: 10, w: 600, h: 700 }, 2, 2.1), winKeep(null, { x: 0, y: 0, w: 1, h: 1 }, 2, 1), winKeep(win, null, 2, 1)],
    [true, false, false, false, false], 'kept while it covers the visible part and L ≥ dpr · k');
});

/* ---- registration, modes, the base texture */
test('1h registry: without the GL path a mounted face is the 1g tier (dom; the SVG at k ≥ 1), an unmounted one the SVG; data-cv-face on the module; attach → the base made next frame (an Image from a Blob URL, the scratch filled with the case colour, uploaded with mips at dpr × size) → gl: the SVG hidden, no .hw-bm, the tier gone', () => {
  const g = rig();
  try {
    const A = g.panel('a'), H = g.panel('h', { x: 5000, mount: false }); // (apart: a world item's rect counts for the overlap rule)
    eq1([st0(g, A), FACES.stats().faces, FACES.stats().dom], [{ mode: 'dom', svg: 'visible', attr: 'dom', bm: 0, shown: false }, 2, 1], 'mounted on the 2D path: a tier (mode = data-cv-face = dom; at k = 1 it shows the SVG: shown false)');
    assert.ok(A.face.tier && typeof A.face.tier.refresh === 'function', 'the 1g tier object');
    eq1(st0(g, H), { mode: 'svg', svg: 'visible', attr: null, bm: 0, shown: false }, 'unmounted: the SVG, no attribute');
    g.R.k = 0.5; g.frames(); g.land(); // the tier paints at 50 %
    eq1([st0(g, A).mode, st0(g, A).bm, st0(g, A).svg, A.face.shown], ['dom', 1, 'hidden', true], 'the tier bitmap below 100 %: mode dom, shown');
    g.R.k = 1;
    const ch = []; const off = FACES.onChange(() => ch.push(1));
    const n0 = g.R.imgs.length; // (the tier loaded one)
    g.W.setCam({ k: 1 }); // at rest at 100 %: the base, then (k > WIN_K0) a window at level 4 for the next zoom-in
    g.attach();
    eq1([st0(g, A), g.G.ups.length, A.bm()], [{ mode: 'svg', svg: 'visible', attr: 'svg', bm: 0, shown: false }, 0, 0], 'attached: the base pending → the SVG (the tier destroyed with its bitmap)');
    assert.ok(A.sentinel(), 'the 0 × 0 sentinel canvas (the unmount hook) inside the deco');
    eq1([A.sentinel().width, A.sentinel().height, A.sentinel().hidden], [0, 0, true]);
    g.frames();
    eq1([g.R.imgs.length, g.R.blob.type, g.R.blob.text.startsWith('<svg'), g.R.urls.size, g.G.ups.length], [n0 + 1, 'image/svg+xml', true, 1, 0], 'next frame: the markup loads as an image');
    g.land(); eq1([g.R.urls.size, g.G.ups.length], [0, 0], 'landed (URL revoked): painted on the next frame, not in the load callback');
    g.frames();
    const t = g.G.ups[0];
    eq1([g.G.ups.length, t.w, t.h, t.mips, t.src, t.bytes], [1, 800, 400, true, 'canvas', Math.round(800 * 400 * 4 * 4 / 3)], 'dpr 2 × 400 × 200, mips');
    const fills = t.calls.filter(c => c[0] === 'fillRect'), di = t.calls.filter(c => c[0] === 'drawImage');
    eq1([fills.length, fills[0].slice(1), di.length, di[0][1] === g.R.imgs[n0], di[0].slice(2)], [1, [0, 0, 800, 400], 1, true, [0, 0, 800, 400]], 'filled with the case colour first, then the image at the base level');
    eq1(st0(g, A), { mode: 'gl', svg: 'hidden', attr: 'gl', bm: 0, shown: true }, 'gl: the SVG hidden, no bitmap canvas');
    const s = FACES.stats();
    eq1([s.faces, s.gl, s.dom, s.bytes, s.base, s.windows, s.paints], [2, 1, 0, t.bytes, 1, 0, 1], 'stats');
    // at rest at 100 % a window follows (level dpr · K_MAX = 4: the whole face, no mips), then the queue drains
    g.frames(); const tw0 = g.G.ups[1];
    assert.ok(ch.length >= 1, 'onChange fired (a frame later: coalesced)');
    off();
    eq1([g.G.ups.length, tw0.w, tw0.h, tw0.mips, FACES.stats().windows], [2, 1600, 800, false, 1], 'the window at k = 1');
    g.frames(2); eq1(g.G.ups.length, 2, 'nothing more to paint');
    // a wood case: the wood colour, then the stripes / sheen (pattern + gradient: the recording context takes them)
    const Wd = g.panel('w', { wood: true, x: 1000 });
    landBase(g); g.frames();
    const tw = g.G.ups[2], fw = tw.calls.filter(c => c[0] === 'fillRect');
    eq1([g.G.ups.length, tw.mips, fw.length >= 1, st0(g, Wd).mode], [4, true, true, 'gl'], 'the wood face painted (fill + stripes + sheen on a stub context: at least the fill), then its window');
    // the bases, once landed, stay through zoom ends: no re-raster at rest (G1); only the windows come and go
    g.W.end({ k: 0.4 }); g.frames(3);
    eq1([g.G.ups.length, FACES.stats().base, FACES.stats().windows], [4, 2, 0], 'zoomed out: the windows freed, the bases kept');
    g.W.end({ k: 1 }); g.frames(3);
    eq1([g.G.ups.length, FACES.stats().base, FACES.stats().windows, g.G.texes.has(g.G.ups[0]), g.G.texes.has(g.G.ups[2])], [6, 2, 2, true, true], 'back at 100 %: the windows again, the same base textures');
  } finally { g.done(); }
});
const st0 = (g, M) => g.st(M);

test('1h base life: freed on unmount (wk.releaseCanvases through the sentinel), re-made on a re-mount (refresh / a rest); on context loss every texture is dropped without a free, the SVG shows, restored() rebuilds from the retained Image (no new load); destroy frees and removes the attribute; a failed decode / upload → the DOM tier', () => {
  const g = rig();
  try {
    const A = g.panel('a');
    g.attach(); landBase(g);
    const t0 = g.G.ups[0];
    eq1([g.st(A).mode, FACES.stats().bytes], ['gl', t0.bytes]);
    // unmount: cv-module calls wk.releaseCanvases(body) → the sentinel's hook (the body still connected), then the module goes
    wk.releaseCanvases(A.sentinel()); A.mod.remove(); g.frames();
    eq1([g.st(A), g.G.frees, FACES.stats().bytes, FACES.stats().base], [{ mode: 'svg', svg: 'visible', attr: null, bm: 0, shown: false }, 1, 0, 0], 'unmounted: freed through the GL, the SVG, no attribute (the module is gone)');
    g.frames(3); eq1(g.G.ups.length, 1, 'nothing re-made while unmounted');
    // re-mount (main.js re-homes the same .inst into a new module): a rest / refresh finds it
    g.world.append(A.mod); A.face.refresh();
    eq1(g.st(A).attr, 'svg', 'mounted again: the base pending');
    g.frames(); eq1(g.R.imgs.length, 1, 'the Image is retained: no new load');
    eq1([g.G.ups.length, g.st(A).mode], [2, 'gl'], 're-made from the retained image in one frame');
    // context loss (B far to the right: A is the nearer the viewport centre, world (2277, 1707) at 30 %)
    const B = g.panel('b', { x: 5000 }); landBase(g);
    eq1([FACES.stats().base, g.G.ups.length], [2, 3]);
    FACES.lost();
    eq1([g.st(A).mode, g.st(B).mode, FACES.stats().bytes, FACES.stats().base, g.G.frees], ['svg', 'svg', 0, 0, 1], 'lost: dropped (the GL freed nothing more), the SVGs show');
    g.frames(3); eq1(g.G.ups.length, 3, 'nothing painted while lost');
    FACES.restored();
    g.frames(); eq1([g.G.ups.length, g.st(A).mode, g.st(B).mode], [4, 'gl', 'svg'], 'restored: one base per frame, nearest first');
    g.frames(); eq1([g.G.ups.length, g.st(B).mode, g.R.imgs.length], [5, 'gl', 2], 'the other; no new loads');
    // the world's own loss / restore: detach (the faces fall to their DOM tiers; attachment() null) and a second attach
    // (every texture gone: the bases rebuilt lazily, one per frame, from the retained images)
    const att = FACES.attachment();
    eq1([!!att, att && att.gl === g.G, att && att.world === g.W], [true, true, true], 'attachment(): the { gl, world } given');
    FACES.detach();
    eq1([FACES.attachment(), FACES.stats().bytes, g.st(A).attr, g.st(B).attr, !!A.face.tier, g.G.frees], [null, 0, 'dom', 'dom', true, 3], 'detached: the tiers, everything freed');
    const n5 = g.G.ups.length;
    g.attach();
    eq1([!!FACES.attachment(), g.st(A).attr, g.G.ups.length], [true, 'svg', n5], 'attached again: the bases pending (the SVGs), nothing painted in the call');
    g.frames(); g.frames();
    eq1([g.G.ups.length, FACES.stats().base, g.R.imgs.length, g.st(A).attr, g.st(B).attr], [n5 + 2, 2, 2, 'gl', 'gl'], 'rebuilt one per frame from the retained images');
    // destroy
    const before = FACES.stats();
    B.face.destroy();
    eq1([FACES.stats().faces, FACES.stats().bytes, g.G.frees, B.mod.getAttribute('data-cv-face'), B.svg.style.visibility || 'visible', !!B.sentinel()], [before.faces - 1, before.bytes - g.G.ups.at(-1).bytes, 4, null, 'visible', false], 'destroy: freed, the attribute and the sentinel gone');
    B.face.destroy(); eq1(FACES.stats().faces, before.faces - 1, 'idempotent');
    // a failed decode: the DOM tier takes over (the SVG, as 1g)
    const warn = console.warn; let warned = 0; console.warn = () => warned++;
    try {
      const C = g.panel('c', { x: 1000 });
      g.frames(); g.land(false);
      eq1([g.st(C).mode, g.st(C).attr, !!C.face.tier, warned], ['dom', 'dom', true, 1], 'decode failed: the tier (the SVG at k = 1), one warning');
      g.frames(3); eq1(g.R.imgs.length, 3, 'never re-tried while mounted');
      const D = g.panel('d', { x: 1500 });
      g.G.fail = true; landBase(g); g.G.fail = false;
      eq1([g.st(D).attr, !!D.face.tier, warned], ['dom', true, 2], 'upload failed: the tier');
    } finally { console.warn = warn; }
  } finally { g.done(); }
});

/* ---- quads */
test('1h quads: base quads in the modules\' z order then registration, each clipped to the body (below the bar, 12 px bottom radii), the face rect = rectOf + offset; a window quad only above k = 1; alpha from [data-off]; a live drag transform moves the quads; detach / a 2D world: none', () => {
  const g = rig();
  try {
    const A = g.panel('a', { z: 3 }), B = g.panel('b', { x: 600, y: 100, z: 1, w: 300, h: 100 }), C = g.panel('c', { x: 1200, z: 3 });
    eq1(FACES.quads(g.W.rectOf, g.W.cam).length, 0, 'the 2D path: no quads');
    g.attach(); settle(g);
    const q = FACES.quads(g.W.rectOf, g.W.cam).map(x => ({ x: x.x, y: x.y, w: x.w, h: x.h, alpha: x.alpha, clip: x.clip, mips: x.tex.mips }));
    eq1(q, [
      { x: 600, y: 100 + BAR_H, w: 300, h: 100, alpha: 1, clip: { x: 600, y: 100 + BAR_H, w: 300, h: 100, r: [0, 0, 12, 12] }, mips: true },
      { x: 0, y: BAR_H, w: 400, h: 200, alpha: 1, clip: { x: 0, y: BAR_H, w: 400, h: 200, r: [0, 0, 12, 12] }, mips: true },
      { x: 1200, y: BAR_H, w: 400, h: 200, alpha: 1, clip: { x: 1200, y: BAR_H, w: 400, h: 200, r: [0, 0, 12, 12] }, mips: true },
    ], 'z 1 first, then the two z 3 in registration order; the body clip; the offset (0, BAR_H)');
    // the list and its quads are reused between frames (no per-frame allocation)
    const q0 = FACES.quads(g.W.rectOf, g.W.cam), q1 = FACES.quads(g.W.rectOf, g.W.cam);
    eq1([q0 === q1, q0[0] === q1[0]], [true, true]);
    // z changes and power are read at a refresh (a MutationObserver in the browsers)
    B.mod.style.zIndex = '9'; B.mod.setAttribute('data-off', ''); B.face.refresh();
    eq1(FACES.quads(g.W.rectOf, g.W.cam).map(x => [x.x, x.alpha]), [[0, 1], [1200, 1], [600, OFF_ALPHA]], 'B on top, dimmed as its body');
    B.mod.removeAttribute('data-off'); B.mod.style.zIndex = '1'; B.face.refresh();
    // a live module drag: translate3d on the module moves the face and its clip with it
    A.mod.style.transform = 'translate3d(50px, -20px, 0)'; A.face.refresh();
    const qa = FACES.quads(g.W.rectOf, g.W.cam)[1];
    eq1([qa.x, qa.y, qa.clip.x, qa.clip.y], [50, BAR_H - 20, 50, BAR_H - 20], 'the drag offset applied');
    A.mod.style.transform = ''; A.face.refresh();
    // a folded module: no quad (its body is display: none), gl kept (no tier painting into a hidden body); unfolded: back
    A.mod.setAttribute('data-cv-fold', ''); A.face.refresh();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, g.st(A).attr, FACES.stats().base, !!A.face.tier], [2, 'gl', 3, false], 'folded: gl, no quad (the base kept), no tier');
    A.mod.removeAttribute('data-cv-fold'); A.face.refresh();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, g.st(A).attr, g.G.ups.length], [3, 'gl', 3], 'unfolded: the quad again without a paint');
    // a face whose module the world does not know: skipped
    eq1(FACES.quads(() => null, g.W.cam).length, 0);
    // detach: everything freed, the tiers back
    FACES.detach();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, FACES.stats().bytes, g.G.frees, g.st(A).attr, !!A.face.tier], [0, 0, 3, 'dom', true], 'detached: the 2D tiers');
  } finally { g.done(); }
});

/* ---- windows */
test('1h windows: at a zoom end above WIN_K0 an on-screen gl face gets the visible part grown by WIN_MARGIN rastered from the same Image (source rect) at min(dpr·K_MAX, dpr·WIN_HEAD·k, budget) without mips, only when that beats the base by WIN_GAIN; a big one over two frames (raster, upload); its quad above the base only at k > 1; kept while it covers the visible part at L ≥ min(dpr·k, the level planned now); rebuilt when the view leaves it; freed below WIN_K0, off screen, on unmount, on loss; one job per frame, nearest first; a burst cancels', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  const last = () => g.G.ups.at(-1);
  try {
    const A = g.panel('a', { w: 2432, h: 728 }); // the CS-80's face at (0, BAR_H)
    const R = { x: 0, y: BAR_H, w: 2432, h: 728 }, wrAt = () => winRect(R, g.W.cam, 1366, 1024), big = w => Math.round(w.w * w.L) * Math.round(w.h * w.L) > WIN_SPLIT_PX;
    g.attach(); landBase(g);
    eq1([g.G.ups.length, FACES.stats().windows], [1, 0]);
    // 60 %: Lw = min(4, 2 · 2 · 0.6, budget) = 2.4 ≤ L0 · WIN_GAIN = 3: the base is as fine already — no window (M2)
    g.W.end({ k: 0.6 }); g.frames(2);
    eq1([g.G.ups.length, FACES.stats().windows], [1, 0], '60 %: no near-duplicate of the base');
    // 80 %: the visible 1707 × 1280 world px grown by the margin: a 2176 × 728 window (the stride) at the 16 M px cap (3.18 > 3)
    g.W.end({ k: 0.8 });
    eq1(g.G.ups.length, 1, 'never in the event: next frame');
    let wr = wrAt(), L1 = winLevelOf(2, 0.8, wr.w * wr.h, wr.w, wr.h);
    eq1([wr.x, wr.y, wr.w, wr.h, L1 > 3 && L1 < 3.2, big({ w: wr.w, h: wr.h, L: L1 })], [0, 0, 2176, 728, true, true], 'the window rect and level (' + L1.toFixed(3) + '); over WIN_SPLIT_PX');
    g.frames();
    eq1([g.G.ups.length, FACES.stats().queued, FACES.stats().windows], [1, 1, 0], 'frame 1: rastered, the upload waits');
    g.frames();
    let t = last();
    eq1([g.G.ups.length, FACES.stats().windows, t.mips, t.w, t.h], [2, 1, false, Math.round(wr.w * L1), Math.round(wr.h * L1)], 'frame 2: the window uploaded, no mips');
    let di = t.calls.filter(c => c[0] === 'drawImage')[0];
    eq1([di[1] === g.R.imgs[0], di.slice(2)], [true, [0, 0, wr.w, wr.h, 0, 0, t.w, t.h]], 'a source rect of the same Image');
    eq1(FACES.quads(g.W.rectOf, g.W.cam).length, 1, 'at k ≤ 1 only the base quad');
    g.W.setCam({ k: 1.2 });
    const q = FACES.quads(g.W.rectOf, g.W.cam);
    eq1([q.length, q[1].x, q[1].y, q[1].w, q[1].h, q[1].tex === t, q[1].clip === q[0].clip], [2, 0, BAR_H, wr.w, wr.h, true, true], 'above 1: the window quad over the base, the same clip');
    // 160 %, the view at the face's top-left: Lw = min(4, 6.4, budget) = 4 → rebuilt (3.18 < min(dpr · k = 3.2, 4)); two frames
    g.W.end({ k: 1.6 }); g.frames(2);
    t = last(); wr = wrAt();
    eq1([g.G.ups.length, FACES.stats().windows, g.G.frees, t.w, t.h, wr.w, wr.h], [3, 1, 1, Math.round(wr.w * 4), Math.round(wr.h * 4), 1088, 728], 'rebuilt at level 4, the old one freed');
    di = t.calls.filter(c => c[0] === 'drawImage')[0];
    eq1(di.slice(2, 6), [wr.x, wr.y, wr.w, wr.h], 'the source rect = the window (face-local world px)');
    eq1(FACES.stats().bytes, g.G.ups[0].bytes + t.bytes);
    // a pan inside the margin: kept; a pan past it: rebuilt; zooming in to 200 % (dpr · k = 4 = L): kept while covered
    g.W.end({ tx: -100, ty: -50 }); g.frames(2);
    eq1(g.G.ups.length, 3, 'a pan within the margin: kept');
    g.W.end({ k: 2, tx: -200, ty: -100 }); g.frames(2);
    eq1(g.G.ups.length, 3, 'zoomed in to 200 % inside the window: kept (L 4 ≥ dpr · k 4)');
    g.W.end({ k: 1.6, tx: -1500 }); g.frames(2);
    eq1([g.G.ups.length, FACES.stats().windows], [4, 1], 'the view left the window: rebuilt');
    // zooming out keeps it while it covers; below WIN_K0 it is freed; a burst start cancels a planned paint
    g.W.end({ k: 1.6, tx: 0, ty: 0 }); g.frames(2);
    const n0 = g.G.ups.length;
    g.W.end({ k: 1.4 }); g.frames(2);
    eq1(g.G.ups.length, n0, 'zooming out a little (the visible part still inside, L ≥ dpr · k): kept');
    g.W.end({ k: 0.4 }); g.frames(2);
    eq1([g.G.ups.length, FACES.stats().windows, FACES.stats().base], [n0, 0, 1], 'k ≤ WIN_K0: freed, the base stays');
    g.W.end({ k: 1.6 }); g.W.emit('movestart', {}); g.frames(3);
    eq1([g.G.ups.length, FACES.stats().queued], [n0, 0], 'a new burst cancels the queue');
    g.W.end({ k: 1.6 }); g.frames(2);
    eq1(FACES.stats().windows, 1, 'the next rest makes it');
    // off screen: freed; unmount: freed; context loss: dropped
    g.W.set('a', { x: 0, y: 0, w: 2432, h: 728 + BAR_H }, false); g.W.emit('screen', { on: [], off: ['a'] }); g.frames();
    eq1([FACES.stats().windows, FACES.stats().base], [0, 1], 'off screen: the window goes, the base stays');
    g.W.set('a', { x: 0, y: 0, w: 2432, h: 728 + BAR_H }, true); g.W.emit('screen', { on: ['a'], off: [] }); g.frames(2);
    eq1(FACES.stats().windows, 1, 'back on screen at a rest: made again');
    const s0 = FACES.stats();
    eq1([s0.paints, s0.paintMs >= 0, s0.paintMax >= 0], [g.G.ups.length, true, true], 'every paint measured (a split one once)');
    FACES.lost(); eq1([FACES.stats().windows, FACES.stats().base, FACES.stats().bytes], [0, 0, 0]);
    FACES.restored(); g.frames(); eq1([FACES.stats().base, FACES.stats().windows], [1, 0], 'restored: the base first'); g.frames(2);
    eq1([FACES.stats().base, FACES.stats().windows], [1, 1], 'then the window');
    A.mod.remove(); wk.releaseCanvases(A.sentinel());
    eq1([FACES.stats().windows, FACES.stats().base, FACES.stats().bytes], [0, 0, 0], 'unmount frees both');
    // several faces (three CS-80s stacked): one job per frame, the nearest the viewport centre first; the budget
    // level over their window areas
    g.world.append(A.mod);
    const B = g.panel('b', { y: 800, w: 2432, h: 728 }), C = g.panel('c', { y: 1600, w: 2432, h: 728 });
    g.W.end({ k: 0.3, tx: 0, ty: 0 }); settle(g); // the three bases (C, B, A: nearest the view centre first); no windows at 30 %
    eq1([FACES.stats().base, FACES.stats().windows], [3, 0]);
    // 90 % with the view centred on B: windows for every visible face; B first (nearest), then A, then C — each two frames
    const k = 0.9, cx = 1216, cy = 800 + BAR_H + 364;
    g.W.end({ k, tx: 1366 / 2 - cx * k, ty: 1024 / 2 - cy * k });
    const cam = g.W.cam, rects = { a: { x: 0, y: BAR_H, w: 2432, h: 728 }, b: { x: 0, y: 800 + BAR_H, w: 2432, h: 728 }, c: { x: 0, y: 1600 + BAR_H, w: 2432, h: 728 } };
    const wins = Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, winRect(r, cam, 1366, 1024)]));
    const sum = Object.values(wins).reduce((a, w) => a + w.w * w.h, 0), Lw = winLevel(2, k, sum), Lof = w => winLevelOf(2, k, sum, w.w, w.h);
    assert.ok(Lw < 2 * WIN_HEAD * k && Lw > 3, 'three CS-80 faces in view at 90 %: the budget level binds (' + Lw.toFixed(3) + ')');
    assert.ok(Lof(wins.b) < Lw && Lof(wins.b) > 3, 'B (the whole face in its window) also meets the 16 M px raster ceiling, above the gain (' + Lof(wins.b).toFixed(3) + ')');
    const n1 = g.G.ups.length;
    g.frames(2); eq1([g.G.ups.length, last().w, last().h], [n1 + 1, Math.round(wins.b.w * Lof(wins.b)), Math.round(wins.b.h * Lof(wins.b))], 'frames 1–2: B (nearest the centre) at the budget level');
    g.frames(2); eq1([g.G.ups.length, last().w], [n1 + 2, Math.round(wins.a.w * Lof(wins.a))], 'frames 3–4: A');
    g.frames(2); eq1([g.G.ups.length, last().w, FACES.stats().windows], [n1 + 3, Math.round(wins.c.w * Lof(wins.c)), 3], 'frames 5–6: C');
    let px = 0; for (const t2 of g.G.ups.slice(-3)) px += t2.w * t2.h;
    assert.ok(px <= WIN_BUDGET_PX * 1.001, 'all windows together ≤ WIN_BUDGET_PX device px (' + px + ')');
    void B; void C;
  } finally { g.done(); }
});

/* ---- the budget */
test('1h budget: over FACE_BUDGET_BYTES the off-screen faces\' windows go first, then their bases farthest from the viewport centre; an on-screen face is painted regardless; an off-screen face that would not fit is skipped (its SVG) until it comes on screen', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    // 4000 × 2000 faces at dpr 2: the base is capped at BASE_MAX_PX (16 M px → 64 MB + ⅓ mips ≈ 85 MB); four fit, five do not
    const per = Math.round(Math.round(4000 * baseLevel(2, 4000, 2000)) * Math.round(2000 * baseLevel(2, 4000, 2000)) * 4 * 4 / 3);
    assert.ok(per * 4 < FACE_BUDGET_BYTES && per * 5 > FACE_BUDGET_BYTES, 'the fixture straddles the budget: ' + per);
    const P = [], mk = (id, x, on) => P.push(g.panel(id, { x, w: 4000, h: 2000, on })); // (apart: no overlap)
    mk('a', 0, true); mk('b', 4100, true); mk('c', 8200, true); mk('d', 20000, false); mk('e', 40000, false);
    g.attach();
    settle(g); // on-screen first (a, b, c), then d, then e — e's paint is skipped: it would not fit and it is off screen
    g.frames(4);
    const s = FACES.stats();
    eq1([s.base, s.bytes <= FACE_BUDGET_BYTES, g.st(P[0]).mode, g.st(P[1]).mode, g.st(P[2]).mode], [4, true, 'gl', 'gl', 'gl'], 'four bases under the budget; the on-screen three have theirs');
    const m = P.map(p => g.st(p).mode);
    eq1(m.slice(3).sort().join(), 'gl,svg', 'of the two off-screen faces one has a base, the farther one (e) was skipped');
    eq1(g.st(P[4]).mode, 'svg', 'the farthest (e) shows its SVG');
    // e comes on screen: its base is painted and the off-screen d loses its base (the only off-screen victim)
    g.W.set('e', { x: 40000, y: 0, w: 4000, h: 2000 + BAR_H }, true); g.W.emit('screen', { on: ['e'], off: [] });
    g.frames(2);
    eq1([g.st(P[4]).mode, g.st(P[3]).mode, FACES.stats().base, FACES.stats().bytes <= FACE_BUDGET_BYTES], ['gl', 'svg', 4, true], 'e painted, d evicted (farthest off screen)');
    // every face on screen: the budget cannot evict; the on-screen paint goes ahead
    g.W.set('d', { x: 20000, y: 0, w: 4000, h: 2000 + BAR_H }, true); g.W.emit('screen', { on: ['d'], off: [] });
    g.frames(2);
    eq1([FACES.stats().base, FACES.stats().bytes > FACE_BUDGET_BYTES], [5, true], 'all five on screen: over the budget, nothing evictable');
  } finally { g.done(); }
});

/* ---- overlap */
test('1h overlap: a mounted hardware module intersecting another uses the DOM face (the 1g tier) while they intersect — evaluated on the world\'s screen event and on refresh, never per frame; apart again: gl at once (the base kept); an unmounted module does not count', () => {
  const g = rig();
  try {
    const A = g.panel('a', { x: 0, y: 0 }), B = g.panel('b', { x: 1000, y: 0 }), C = g.panel('c', { x: 2000, y: 0, mount: false });
    g.attach(); settle(g);
    eq1([g.st(A).attr, g.st(B).attr, g.st(C).attr], ['gl', 'gl', null]);
    // B dropped onto A (its left / top written, the world's rect recached at the drag end): a refresh / the screen event finds the overlap
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
    eq1([g.st(A).attr, g.st(B).attr, !!A.face.tier, !!B.face.tier, FACES.quads(g.W.rectOf, g.W.cam).length, FACES.stats().base, g.G.frees], ['dom', 'dom', true, true, 0, 2, 0], 'both DOM while they intersect; the bases kept');
    g.R.k = 0.5; g.frames(); g.landAll();
    eq1([A.bm(), B.bm(), g.st(A).mode, A.face.shown], [1, 1, 'dom', true], 'the tiers paint their bitmaps at 50 % as in 1g');
    g.R.k = 1;
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); B.mod.style.left = '1000px'; B.mod.style.top = '0px'; g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).attr, g.st(B).attr, A.bm(), B.bm(), g.st(A).svg, FACES.quads(g.W.rectOf, g.W.cam).length, g.G.ups.length], ['gl', 'gl', 0, 0, 'hidden', 2, 2], 'apart: gl again without a paint, the tiers gone');
    // C (at home so far, apart from A) mounted over A: both DOM
    eq1(g.st(A).attr, 'gl');
    g.W.set('c', { x: 100, y: 0, w: 400, h: 200 + BAR_H }); C.mod.style.left = '100px';
    g.world.append(C.mod); C.face.refresh();
    eq1([g.st(A).attr, g.st(C).attr], ['dom', 'dom'], 'mounted over A: both DOM');
    C.face.destroy(); g.W.del('c'); FACES.recheck();
    eq1(g.st(A).attr, 'gl', 'C destroyed (its world item gone): A is gl again');
  } finally { g.done(); }
});

// ---- 1h fixes A (the reviews' findings, docs/canvas/IMPL-1h.md §8: scratchpad maps/findings-1h.md). Unmount in cv-module's real
// order; a re-mount without an event; the quads on the committed left / top; no paint in a burst; one onChange a frame; no sort per
// frame; gl → dom without a raw SVG below 100 %; mode = data-cv-face; a folded module keeps gl; the overlap rule live and against
// every world item; the patching dim
const NODEST_ALPHA = CF.NODEST_ALPHA, OFF_GRAY = CF.OFF_GRAY, NODEST_GRAY = CF.NODEST_GRAY;
const quadsOf = g => FACES.quads(g.W.rectOf, g.W.cam).map(q => [q.x, q.y, q.alpha, q.gray]);

test('1h fix 1: cv-module\'s unmount order — wk.releaseCanvases(body) runs while the body is still connected: the textures go at once (the SVG back, no quad), the mode follows a frame later (at home: nothing re-made, the dead module\'s attribute gone)', () => {
  const g = rig();
  try {
    const A = g.panel('a');
    g.attach(); landBase(g); g.W.end({ k: 1 }); settle(g);
    eq1([g.st(A).mode, FACES.stats().base, FACES.stats().windows], ['gl', 1, 1]);
    wk.releaseCanvases(A.sentinel()); // (cv-module.unmount: the deco still under [data-cv-world])
    eq1([FACES.stats().bytes, FACES.stats().base, FACES.stats().windows, g.G.frees, g.st(A).mode, g.st(A).svg, FACES.quads(g.W.rectOf, g.W.cam).length, FACES.stats().queued], [0, 0, 0, 2, 'svg', 'visible', 0, 0], 'freed now: the SVG, no quad, nothing queued');
    g.home.append(A.root); A.mod.remove(); // (main.js cvUnmountBody: the device element to #cvParts[hidden]; the module removed)
    g.frames(3);
    eq1([g.G.ups.length, A.mod.getAttribute('data-cv-face'), g.st(A).mode, FACES.stats().queued, g.R.imgs.length], [2, null, 'svg', 0, 1], 'at home a frame later: nothing re-made, the attribute gone, the Image retained');
  } finally { g.done(); }
});

test('1h fix 2: a re-mount without a camera move — (a) main.js cvKeep: released and re-homed into a new module in one task → found next frame (the attribute on the new module, the base from the retained Image, its quad); (b) a track switched back (re-homed long after): FACES.recheck() (cvMountBody) finds it', () => {
  const g = rig();
  try {
    const A = g.panel('a');
    g.attach(); landBase(g); g.frames(2);
    // (a) cvView.destroy() → unmount (release while connected), the module removed; createTrackView → a new module 'a',
    // cvMountBody appends the element; the world's item 'a' keeps its rect; no event at all
    wk.releaseCanvases(A.sentinel()); A.root.remove(); A.mod.remove();
    const N = g.shell('a'); N.body.append(A.root); g.world.append(N.mod);
    g.frames();
    eq1([N.mod.getAttribute('data-cv-face'), A.mod.getAttribute('data-cv-face'), g.st(A).mode, FACES.stats().queued], ['svg', null, 'svg', 1], 'next frame: the new module is its home (the base pending)');
    g.frames();
    eq1([N.mod.getAttribute('data-cv-face'), g.st(A).mode, g.G.ups.length, g.R.imgs.length, quadsOf(g)], ['gl', 'gl', 2, 1, [[0, BAR_H, 1, 0]]], 'the base re-made from the retained Image (no load), the quad drawn');
    // (b) released, at home for a while (the deferred sync found it there), then into another new module: nothing fires
    wk.releaseCanvases(A.sentinel()); g.home.append(A.root); N.mod.remove(); g.frames(2);
    eq1([g.st(A).mode, FACES.stats().base], ['svg', 0]);
    const N2 = g.shell('a'); N2.body.append(A.root); g.world.append(N2.mod);
    g.frames(3);
    eq1([N2.mod.getAttribute('data-cv-face'), g.G.ups.length], [null, 2], 'nothing reaches FACES by itself');
    FACES.recheck(); // (main.js cvMountBody after the append of a built panel)
    eq1([N2.mod.getAttribute('data-cv-face'), g.st(A).mode], ['svg', 'svg'], 'found: the base pending');
    g.frames();
    eq1([N2.mod.getAttribute('data-cv-face'), g.st(A).mode, g.G.ups.length, quadsOf(g).length], ['gl', 'gl', 3, 1], 'gl a frame later');
  } finally { g.done(); }
});

test('1h fix 3: the quads sit on the module\'s committed left / top plus the live translate3d — a recache during a drag (an edge pan\'s end) does not double the delta; the drop lands them on the new left / top', () => {
  const g = rig();
  try {
    const A = g.panel('a', { x: 100, y: 100 });
    g.attach(); landBase(g); g.frames(2);
    A.mod.style.transform = 'translate3d(50px, 30px, 0)'; A.face.refresh();
    let q = FACES.quads(g.W.rectOf, g.W.cam)[0];
    eq1([q.x, q.y, q.clip.x], [150, 100 + BAR_H + 30, 150], 'the drag: left + dx');
    g.W.set('a', { x: 150, y: 130, w: 400, h: 200 + BAR_H }); g.W.emit('cameraend', { cam: g.W.cam, zoomed: false }); // the world recached the live position mid-drag
    q = FACES.quads(g.W.rectOf, g.W.cam)[0];
    eq1([q.x, q.y, q.clip.x, q.clip.y], [150, 130 + BAR_H, 150, 130 + BAR_H], 'still where the module is (not 200)');
    A.mod.style.left = '150px'; A.mod.style.top = '130px'; A.mod.style.transform = ''; A.face.refresh(); // the drop
    q = FACES.quads(g.W.rectOf, g.W.cam)[0];
    eq1([q.x, q.y], [150, 130 + BAR_H], 'dropped');
    // a module without an inline left / top (a stub): the world's rect
    A.mod.style.left = ''; A.mod.style.top = ''; A.face.refresh();
    eq1([FACES.quads(g.W.rectOf, g.W.cam)[0].x, FACES.quads(g.W.rectOf, g.W.cam)[0].y], [150, 130 + BAR_H]);
  } finally { g.done(); }
});

test('1h fix 5: never a paint inside a burst — an Image load landing mid-burst is not re-queued (the rest\'s plan brings the base back), a base needed mid-burst waits, the queue runs in order (push, not unshift)', () => {
  const g = rig();
  try {
    const A = g.panel('a');
    g.attach(); g.frames(); // the load starts
    g.W.emit('movestart', {});
    g.land(); // the decode lands inside the pinch
    eq1([FACES.stats().queued, g.G.ups.length], [0, 0], 'not re-queued');
    g.frames(3);
    eq1([g.G.ups.length, g.st(A).mode], [0, 'svg'], 'nothing painted in the burst');
    const B = g.panel('b', { x: 1000 }); // mounted mid-burst: its base waits too
    g.frames(3);
    eq1([g.G.ups.length, g.R.imgs.length], [0, 1], 'no load, no paint');
    g.W.end({ k: 0.3 }); settle(g);
    eq1([g.G.ups.length, g.st(A).mode, g.st(B).mode], [2, 'gl', 'gl'], 'at the rest: both bases');
    // a window's job before its base is never run: a face mounted at k = 1 gets its base first, then (plan) its window
    g.W.end({ k: 1 }); settle(g);
    const C = g.panel('c', { x: 0, y: 400 }); // (in view at 100 %, apart from A)
    g.frames(); g.land(); g.frames();
    eq1([g.G.ups.at(-1).mips, g.st(C).mode], [true, 'gl'], 'the base');
    g.frames();
    eq1([g.G.ups.at(-1).mips, FACES.stats().windows], [false, 3], 'then the window');
  } finally { g.done(); }
});

test('1h fix 6: onChange is one call a frame — a plan freeing four windows, a landed base, a landed window: one each; a module\'s style change in a camera burst: none (the world draws every frame); outside: one a frame', () => {
  const g = rig({ mo: true, vw: 1366, vh: 1024 });
  try {
    const P = []; for (let i = 0; i < 4; i++) P.push(g.panel('p' + i, { x: 0, y: i * 300, w: 1000, h: 200 }));
    g.attach(); settle(g);
    g.W.end({ k: 1 }); settle(g);
    eq1(FACES.stats().windows, 4);
    let n = 0; const off = FACES.onChange(() => n++);
    g.W.end({ k: 0.3 });
    eq1([n, FACES.stats().windows], [0, 0], 'in the event: nothing yet');
    g.frames(); eq1(n, 1, 'one change for the four windows freed');
    g.frames(2); eq1(n, 1);
    const E = g.panel('e', { x: 1200, y: 0 });
    g.frames(); g.land(); n = 0; g.frames(); // the paint frame: sync('paint') + emit → one
    eq1([g.st(E).mode, n], ['gl', 0]); g.frames(); eq1(n, 1, 'a landed base: one');
    n = 0; g.W.end({ k: 1 }); g.frames(); // (one window a frame)
    g.frames(); eq1(n, 1, 'a landed window: one');
    settle(g); n = 0;
    g.W.emit('movestart', {});
    E.mod.style.transform = 'translate3d(10px, 0px, 0)'; g.mo(E.mod);
    g.frames(2);
    eq1([n, quadsOf(g).find(q => q[0] === 1210) !== undefined], [0, true], 'a drag frame in a camera burst: no change (the quad follows)');
    g.W.end({ k: 1 }); settle(g); n = 0;
    E.mod.style.transform = 'translate3d(20px, 0px, 0)'; g.mo(E.mod);
    E.mod.style.transform = 'translate3d(30px, 0px, 0)'; g.mo(E.mod);
    eq1(n, 0); g.frames(); eq1(n, 1, 'two drag ticks in one frame: one change');
    g.frames(3); eq1(n, 1);
    off();
  } finally { g.done(); }
});

test('1h fix 7: quads() sorts nothing per frame — the order is kept and re-sorted only when a face registers / goes, a mode or z changes or a module folds', () => {
  const g = rig();
  const sort0 = Array.prototype.sort; let sorts = 0;
  try {
    const A = g.panel('a', { z: 2 }), B = g.panel('b', { x: 600, z: 1 });
    g.attach(); settle(g);
    eq1(quadsOf(g).map(q => q[0]), [600, 0]);
    Array.prototype.sort = function (...a) { sorts++; return sort0.apply(this, a); };
    for (let i = 0; i < 50; i++) FACES.quads(g.W.rectOf, g.W.cam);
    eq1(sorts, 0, 'fifty frames: no sort');
    // (a refresh plans — its queue sort is a rest-time one: counted from the first quads() after it)
    A.mod.style.zIndex = '0'; A.face.refresh(); sorts = 0; FACES.quads(g.W.rectOf, g.W.cam); FACES.quads(g.W.rectOf, g.W.cam);
    eq1([sorts, quadsOf(g).map(q => q[0])], [1, [0, 600]], 'a z change: one sort');
    B.mod.setAttribute('data-cv-fold', ''); B.face.refresh(); sorts = 0; FACES.quads(g.W.rectOf, g.W.cam); FACES.quads(g.W.rectOf, g.W.cam);
    eq1([sorts, quadsOf(g).length], [1, 1], 'a fold: one');
    B.face.destroy(); sorts = 0; FACES.quads(g.W.rectOf, g.W.cam); FACES.quads(g.W.rectOf, g.W.cam);
    eq1([sorts, quadsOf(g).length], [1, 1], 'a face gone: one');
    A.mod.style.transform = 'translate3d(5px, 0px, 0)'; A.face.refresh(); sorts = 0; FACES.quads(g.W.rectOf, g.W.cam);
    eq1([sorts, quadsOf(g)[0][0]], [0, 5], 'a drag: none');
  } finally { Array.prototype.sort = sort0; g.done(); }
});

test('1h fix 10 + 11: gl → dom below 100 % never shows the raw SVG — the base quad and the gl attribute stay (the SVG hidden) until the tier\'s bitmap lands, then dom; at 100 % dom at once (the SVG, 1:1); Face.mode always equals data-cv-face', () => {
  const g = rig();
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 }), H = g.panel('h', { x: 2000, mount: false });
    eq1([g.st(A).mode, g.st(A).attr, g.st(H).mode, g.st(H).attr], ['dom', 'dom', 'svg', null], 'the 2D path: mode = attribute');
    g.attach(); settle(g);
    g.R.k = 0.5; g.W.end({ k: 0.5 }); settle(g);
    eq1([g.st(A).mode, g.st(A).attr, g.st(A).svg], ['gl', 'gl', 'hidden']);
    // B dropped onto A at 50 %
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
    const held = [g.st(A), g.st(B)];
    eq1(held.map(s => [s.mode, s.attr, s.svg, s.bm, s.shown]), [['gl', 'gl', 'hidden', 0, true], ['gl', 'gl', 'hidden', 0, true]], 'held: still gl (the quads drawn, the SVGs hidden) while the tiers raster');
    eq1([!!A.face.tier, !!B.face.tier, A.face.tier && A.face.tier.shown, quadsOf(g).length], [true, true, false, 2], 'the tiers exist, pending');
    g.frames(); // the tiers' loads start
    eq1([g.st(A).svg, g.st(B).svg, g.st(A).attr], ['hidden', 'hidden', 'gl'], 'loading: still hidden');
    g.landAll(); // the bitmaps land
    eq1([g.st(A), g.st(B)].map(s => [s.mode, s.attr, s.svg, s.bm, s.shown]), [['dom', 'dom', 'hidden', 1, true], ['dom', 'dom', 'hidden', 1, true]], 'the bitmaps: dom, the SVGs still hidden');
    eq1([quadsOf(g).length, FACES.stats().base], [0, 2], 'no quad (the bases kept)');
    // apart: gl again (no paint)
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); B.mod.style.left = '1000px'; B.mod.style.top = '0px'; g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).mode, g.st(A).attr, g.st(A).svg, A.bm(), quadsOf(g).length], ['gl', 'gl', 'hidden', 0, 2]);
    // at 100 %: dom at once, the SVG shown (the tier shows it at k ≥ 1: native resolution)
    g.R.k = 1; g.W.end({ k: 1 }); settle(g);
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
    eq1([g.st(A).mode, g.st(A).attr, g.st(A).svg, g.st(A).shown, quadsOf(g).length], ['dom', 'dom', 'visible', false, 0]);
    // a failed tier below 100 %: the SVG (as 1g), dom
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); B.mod.style.left = '1000px'; B.mod.style.top = '0px'; g.W.emit('screen', { on: [], off: [] });
    g.R.k = 0.5; g.W.end({ k: 0.5 }); settle(g);
    const warn = console.warn; console.warn = () => {};
    try {
      g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
      eq1(g.st(A).attr, 'gl');
      g.frames(); g.land(false); // the last tier load's decode fails
      const f = [A, B].find(M => M.face.tier && M.face.tier.failed);
      eq1([!!f, g.st(f).mode, g.st(f).attr, g.st(f).svg], [true, 'dom', 'dom', 'visible'], 'failed: dom, the SVG stays');
    } finally { console.warn = warn; }
  } finally { g.done(); }
});

test('9b fix R2a (F2): a face in gl ends with its SVG hidden whatever order the tier and the overlap come in — held (gl, the tier pending below 100 %) then the overlap cleared before the bitmap decodes: the tier is destroyed (its drop shows the SVG), mode stays gl, the SVG hidden again; a late decode shows nothing', () => {
  const g = rig();
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 });
    g.attach(); settle(g);
    g.R.k = 0.5; g.W.end({ k: 0.5 }); settle(g);
    eq1([g.st(A).mode, g.st(A).svg, g.st(B).mode, g.st(B).svg], ['gl', 'hidden', 'gl', 'hidden']);
    // B dropped onto A (a set load: the overlap holds the quads, the tiers wait on their decodes) …
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
    eq1([g.st(A).mode, !!A.face.tier, A.face.tier && A.face.tier.shown, g.st(A).svg], ['gl', true, false, 'hidden'], 'held: the tier pending');
    // … and cleared again before any decode lands (the step's next layout)
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); B.mod.style.left = '1000px'; B.mod.style.top = '0px'; g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).mode, g.st(A).attr, !!A.face.tier, g.st(A).svg, g.st(B).mode, !!B.face.tier, g.st(B).svg, quadsOf(g).length], ['gl', 'gl', false, 'hidden', 'gl', false, 'hidden', 2], 'cleared: gl, the tiers gone, the SVGs hidden under the quads');
    g.frames(); g.landAll(); // (the stale loads land on dead tiers: nothing changes)
    eq1([g.st(A).svg, g.st(B).svg, A.bm(), B.bm()], ['hidden', 'hidden', 0, 0], 'a late decode does not show anything');
    // again, with the tier already shown below 100 % (dom), then apart: gl, hidden (the old path, kept)
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.mod.style.left = '200px'; B.mod.style.top = '50px'; B.face.refresh();
    g.frames(); g.landAll();
    eq1([g.st(A).mode, g.st(A).svg, g.st(A).shown], ['dom', 'hidden', true]);
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); B.mod.style.left = '1000px'; B.mod.style.top = '0px'; g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).mode, g.st(A).svg, g.st(B).svg], ['gl', 'hidden', 'hidden']);
    // never a gl face with its SVG showing: the invariant after every step
    const bad = [A, B].filter(M => M.face.mode === 'gl' && M.svg.style.visibility !== 'hidden').length;
    eq1(bad, 0);
  } finally { g.done(); }
});

test('1h fix 12: a folded module keeps gl and emits no quad (no tier painting into its display: none body), its window freed and none planned; a module mounted folded gets no base until it unfolds; folded over another module: no overlap switch', () => {
  const g = rig();
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 });
    g.attach(); g.W.end({ k: 1 }); settle(g);
    eq1([FACES.stats().base, FACES.stats().windows], [2, 2]);
    A.mod.setAttribute('data-cv-fold', ''); A.face.refresh();
    eq1([g.st(A).mode, g.st(A).attr, !!A.face.tier, quadsOf(g).length, FACES.stats().base, FACES.stats().windows], ['gl', 'gl', false, 1, 2, 1], 'folded: gl, no tier, no quad, its window freed, the base kept');
    g.W.end({ k: 1 }); settle(g);
    eq1(FACES.stats().windows, 1, 'no window planned for a folded face');
    // folded onto B: the folded one keeps gl (nothing of its body shows); B, under A's bar, goes dom
    g.W.set('a', { x: 900, y: 0, w: 400, h: BAR_H }); A.mod.style.left = '900px'; A.face.refresh();
    eq1([g.st(A).mode, g.st(B).mode], ['gl', 'dom']);
    g.W.set('a', { x: 0, y: 0, w: 400, h: BAR_H }); A.mod.style.left = '0px'; A.face.refresh();
    eq1(g.st(B).mode, 'gl');
    A.mod.removeAttribute('data-cv-fold'); A.face.refresh();
    eq1([quadsOf(g).length, g.G.ups.length], [2, 4], 'unfolded: the quad back without a paint');
    g.frames(2); eq1(FACES.stats().windows, 2, 'its window (and B\'s, freed while under A\'s bar) at that rest, one a frame');
    // mounted folded: no base paint while folded
    const n0 = g.G.ups.length, C = g.panel('c', { x: 2000, fold: true });
    g.frames(3);
    eq1([g.G.ups.length, g.R.imgs.length, g.st(C).mode, g.st(C).attr, !!C.face.tier], [n0, 2, 'svg', 'svg', false], 'no load, no paint, no tier');
    C.mod.removeAttribute('data-cv-fold'); C.face.refresh(); landBase(g);
    eq1([g.G.ups.length, g.st(C).mode], [n0 + 1, 'gl'], 'unfolded: the base');
  } finally { g.done(); }
});

test('1h fix R1: the overlap rule applies during a live drag — the observer\'s translate3d moves the face\'s rect, the next frame switches both to dom while they intersect and back to gl when they part, before the drop', () => {
  const g = rig({ mo: true });
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 });
    g.attach(); settle(g);
    B.mod.style.transform = 'translate3d(-700px, 0px, 0)'; g.mo(B.mod); // B dragged over A (the world's rect still at 1000)
    eq1([g.st(A).attr, g.st(B).attr], ['gl', 'gl'], 'in the tick: nothing yet');
    g.frames();
    eq1([g.st(A).attr, g.st(B).attr, g.W.rectOf('b').x], ['dom', 'dom', 1000], 'next frame: both dom (the cached rect untouched)');
    B.mod.style.transform = 'translate3d(-100px, 0px, 0)'; g.mo(B.mod); g.frames();
    eq1([g.st(A).attr, g.st(B).attr], ['gl', 'gl'], 'parted mid-drag: gl again');
    B.mod.style.transform = 'translate3d(-650px, 10px, 0)'; g.mo(B.mod); g.frames();
    eq1([g.st(A).attr, g.st(B).attr], ['dom', 'dom']);
    // the drop onto A: left / top written, the transform gone, the world recached
    B.mod.style.left = '350px'; B.mod.style.top = '10px'; B.mod.style.transform = ''; g.W.set('b', { x: 350, y: 10, w: 400, h: 200 + BAR_H }); g.mo(B.mod); g.frames();
    eq1([g.st(A).attr, g.st(B).attr, quadsOf(g).length], ['dom', 'dom', 0]);
  } finally { g.done(); }
});

test('1h fix R2: the overlap rule counts every mounted world item — an OUT / FX / Serum / mod module intersecting a hardware module (in front of it or behind) puts that face on the DOM tier while they intersect', () => {
  const g = rig();
  try {
    const A = g.panel('a', { z: 5 });
    g.attach(); settle(g);
    eq1(g.st(A).attr, 'gl');
    g.W.set('out', { x: 300, y: 100, w: 200, h: 100 }); g.W.emit('screen', { on: [], off: [] }); // (the world: an OUT module behind A)
    eq1([g.st(A).attr, quadsOf(g).length], ['dom', 0], 'intersecting a non-hardware item: dom');
    g.W.set('out', { x: 900, y: 100, w: 200, h: 100 }); g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).attr, quadsOf(g).length], ['gl', 1], 'apart: gl');
    g.W.set('out', { x: 399, y: 0, w: 200, h: 100 }); FACES.recheck();
    eq1(g.st(A).attr, 'dom', 'any intersection (a recheck)');
  } finally { g.done(); }
});

test('1h fix 9: the patching dim — #world[data-cv-patching="mod"] + .cv-nodest on the module → the quads at alpha 0.35 / gray 0.8 (over a powered-off module\'s 0.45 / 0.7); off again: 1 / 0; through the observers (the class, #world\'s attribute) or a refresh', () => {
  const g = rig({ mo: true });
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 });
    g.attach(); settle(g);
    eq1([NODEST_ALPHA, OFF_GRAY, NODEST_GRAY], [0.35, 0.7, 0.8]);
    eq1(quadsOf(g), [[0, BAR_H, 1, 0], [1000, BAR_H, 1, 0]]);
    B.mod.setAttribute('data-off', ''); g.mo(B.mod);
    eq1(quadsOf(g)[1], [1000, BAR_H, OFF_ALPHA, OFF_GRAY], 'powered off: 0.45, grayscale 0.7');
    g.world.setAttribute('data-cv-patching', 'mod'); A.mod.classList.add('cv-nodest'); B.mod.classList.add('cv-nodest'); // (cv-cables: a mod drag)
    g.mo(g.world); g.mo(A.mod); g.mo(B.mod);
    eq1(quadsOf(g), [[0, BAR_H, NODEST_ALPHA, NODEST_GRAY], [1000, BAR_H, NODEST_ALPHA, NODEST_GRAY]], 'no destination: 0.35 / 0.8 (over the power dim)');
    let n = 0; const off = FACES.onChange(() => n++);
    g.world.removeAttribute('data-cv-patching'); g.mo(g.world); // the drop: the classes go too
    A.mod.classList.remove('cv-nodest'); B.mod.classList.remove('cv-nodest'); g.mo(A.mod); g.mo(B.mod);
    eq1(quadsOf(g), [[0, BAR_H, 1, 0], [1000, BAR_H, OFF_ALPHA, OFF_GRAY]], 'patching over: back');
    g.frames(); eq1(n, 1, 'one change');
    off();
    // without observers (a refresh reads both)
    g.world.setAttribute('data-cv-patching', 'mod'); A.mod.classList.add('cv-nodest'); A.face.refresh();
    eq1(quadsOf(g)[0], [0, BAR_H, NODEST_ALPHA, NODEST_GRAY]);
    g.world.removeAttribute('data-cv-patching'); A.face.refresh();
    eq1(quadsOf(g)[0], [0, BAR_H, 1, 0], 'the class alone (no mod drag): nothing');
  } finally { g.done(); }
});

// ---- 1h fixes B (review round: code 4, M1, M2, M3, R3, R4, R5)
const { WIN_GAIN, WIN_SNAP, WIN_MIN_PX, WIN_SPLIT_PX, PAINT_SLOW_MS, WIN_PX_KEY, sheenStops, woodBands } = CF;
const CS80 = { x: 0, y: BAR_H, w: 2432, h: 728 };
// a fake storage on the rig's window (the cap pref), and a `now` that advances `step` ms per call (a paint = 2 calls per frame)
const storage = (init = {}) => ({ d: Object.assign({}, init), getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); } });
const clock = () => { const c = { t: 0, step: 0, now() { c.t += c.step; return c.t; } }; return c; };

test('1h fix code 4: a window whose level the raster ceilings cap below dpr·k is kept — winKeep compares against min(dpr·k, the level the planner would make now); three rests at one camera → one raster; stats report the soft windows (L < dpr·k) and the worst ratio', () => {
  const g = rig({ vw: 1920, vh: 1080 });
  try {
    const A = g.panel('a', { w: 2432, h: 728 });
    g.attach(); landBase(g); g.frames(2);
    g.W.setCam({ k: 2, tx: -1000, ty: -300 });
    const wr = winRect(CS80, g.W.cam, 1920, 1080), Lw = winLevelOf(2, 2, wr.w * wr.h, wr.w, wr.h), vis = visPart(CS80, g.W.cam, 1920, 1080);
    assert.ok(Lw < 4 && Lw > 3.5, 'the 16 M px ceiling caps the level below dpr · k = 4: ' + Lw.toFixed(3));
    g.W.end(); settle(g);
    const n0 = g.G.ups.length, f0 = g.G.frees;
    eq1([FACES.stats().windows, g.G.ups.length], [1, 2]);
    const w = L => Object.assign({}, wr, { L });
    eq1([winKeep(w(Lw), vis, 2, 2), winKeep(w(Lw), vis, 2, 2, Lw), winKeep(w(Lw - 0.1), vis, 2, 2, Lw), winKeep(w(4), vis, 2, 2, Lw), winKeep(w(Lw), vis, 2, 1.5, 4)],
      [false, true, false, true, true], 'kept at L ≥ min(dpr · k, the level the planner would make now)');
    for (let i = 0; i < 3; i++) { g.W.end(); settle(g); } // three rests at the same camera (a tap, a selection…)
    eq1([g.G.ups.length - n0, g.G.frees - f0, FACES.stats().windows], [0, 0, 1], 'no re-raster at the same camera');
    const s = FACES.stats();
    eq1([s.soft, +s.softMin.toFixed(4)], [1, +(Lw / 4).toFixed(4)], 'one soft window: L / (dpr · k)');
    g.W.end({ k: 1.5 }); settle(g); // dpr · k = 3 ≤ the level of whatever window covers now
    eq1([FACES.stats().soft, FACES.stats().softMin, FACES.stats().windows], [0, 1, 1], 'not soft at 150 %');
    void A;
  } finally { g.done(); }
});

test('1h fix M1: the window cap adapts — a window paint (raster + upload) over PAINT_SLOW_MS halves the effective cap (stats().winPx) down to WIN_MIN_PX when the halved cap would have bound it, persisted in localStorage; read at attach (clamped; a throwing storage ignored); base paints never halve it', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  const ls = storage(), ck = clock();
  g.win.localStorage = ls;
  try {
    eq1([WIN_MIN_PX, WIN_SPLIT_PX, PAINT_SLOW_MS, WIN_PX_KEY], [4e6, 8e6, 30, 'synth.cv.winpx']);
    const A = g.panel('a', { w: 2432, h: 728 }), B = g.panel('b', { x: 10000, w: 1000, h: 500 }), C = g.panel('c', { x: 20000, w: 600, h: 300 });
    ck.step = 20; // every paint measures 40 ms (two now() calls per frame)
    FACES.attach({ gl: g.G, world: g.W, now: ck.now, win: g.win });
    settle(g);
    eq1([FACES.stats().base, FACES.stats().winPx, ls.getItem(WIN_PX_KEY), FACES.stats().paintMax >= 40], [3, WIN_MAX_PX, null, true], 'three slow base paints: the cap untouched');
    // A at 100 %: the whole face at the 16 M px cap → slow → 8e6, persisted
    g.W.end({ k: 1, tx: 0, ty: 0 }); settle(g);
    eq1([FACES.stats().windows, g.G.ups.at(-1).w * g.G.ups.at(-1).h > 15e6, FACES.stats().winPx, ls.getItem(WIN_PX_KEY)], [1, true, 8e6, '8000000'], 'halved after a 40 ms 16 M px window, persisted');
    // B at 100 %: 4000 × 2000 = 8 M px under the new cap, slow again → 4e6 (the floor)
    g.W.end({ k: 1, tx: -10000 + 100, ty: 0 }); settle(g);
    const tb = g.G.ups.at(-1);
    eq1([tb.w, tb.h, FACES.stats().winPx, ls.getItem(WIN_PX_KEY)], [4000, 2000, 4e6, '4000000'], 'halved again to the floor');
    // C at 100 %: 2400 × 1200 (under the cap), slow: the floor holds
    g.W.end({ k: 1, tx: -20000 + 100, ty: 0 }); settle(g);
    eq1([g.G.ups.at(-1).w, FACES.stats().winPx, ls.getItem(WIN_PX_KEY)], [2400, 4e6, '4000000'], 'the floor');
    // a fast paint never raises it; a fresh attach reads the pref (clamped), a throwing storage is ignored
    ck.step = 0;
    FACES.attach({ gl: g.G, world: g.W, now: ck.now, win: g.win }); eq1(FACES.stats().winPx, 4e6, 'read at attach');
    ls.d[WIN_PX_KEY] = '1e6'; FACES.attach({ gl: g.G, world: g.W, win: g.win }); eq1(FACES.stats().winPx, WIN_MIN_PX, 'clamped up');
    ls.d[WIN_PX_KEY] = '9e9'; FACES.attach({ gl: g.G, world: g.W, win: g.win }); eq1(FACES.stats().winPx, WIN_MAX_PX, 'clamped down');
    ls.d[WIN_PX_KEY] = 'x'; FACES.attach({ gl: g.G, world: g.W, win: g.win }); eq1(FACES.stats().winPx, WIN_MAX_PX, 'garbage: the start value');
    g.win.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    FACES.attach({ gl: g.G, world: g.W, win: g.win }); eq1(FACES.stats().winPx, WIN_MAX_PX, 'a throwing storage: ignored');
    eq1(winLevelOf(2, 1, 0, 2432, 728, 8e6) < winLevelOf(2, 1, 0, 2432, 728, 16e6), true, 'winLevelOf takes the cap');
    void A; void B; void C;
  } finally { g.win.localStorage = ls; g.done(); }
});

test('1h fix M1 split: a window over WIN_SPLIT_PX px rasters on one frame (the scratch kept) and uploads on the next — still one job per frame, nearest first; a burst between the two frames drops it (the next rest re-plans); the stats count one paint with both parts', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  const ck = clock();
  try {
    const A = g.panel('a', { w: 2432, h: 728 }), B = g.panel('b', { x: 2000, y: 800, w: 400, h: 200 });
    FACES.attach({ gl: g.G, world: g.W, now: ck.now, win: g.win }); settle(g);
    FACES.stats(true);
    // 100 %, both on screen (the view at world 1000..2366 × 0..1024): A's window (16 M px) is the nearer: raster, then upload; B's (1.28 M px) in one frame
    g.W.end({ k: 1, tx: -1000, ty: 0 });
    ck.step = 5;
    g.frames(); eq1([g.G.ups.length, FACES.stats().queued, FACES.stats().paints], [2, 2, 0], 'frame 1: A rastered, not uploaded (the job waits at the front)');
    g.frames(); let t = g.G.ups.at(-1);
    eq1([g.G.ups.length, t.w * t.h > WIN_SPLIT_PX, t.calls.filter(c => c[0] === 'drawImage').length, FACES.stats().paints, FACES.stats().paintMs], [3, true, 1, 1, 10], 'frame 2: uploaded from the retained scratch; one paint of raster + upload (5 ms each)');
    g.frames(); t = g.G.ups.at(-1);
    eq1([g.G.ups.length, t.w, t.h, FACES.stats().queued, FACES.stats().paints], [4, 1600, 800, 0, 2], 'frame 3: B in one frame');
    // a burst between A's two frames: the staged raster is dropped, the next rest makes it again (B off screen now: its window freed)
    g.W.end({ k: 1.2, tx: -200, ty: 0 }); // (the view at 167..1305, above 100 %: past A's window's margin → rebuilt; at k = 1 M3 would keep the stale one)
    g.frames(); eq1([g.G.ups.length, FACES.stats().queued, FACES.stats().windows], [4, 1, 1], 'rastered');
    g.W.emit('movestart', {}); g.frames(2);
    eq1([g.G.ups.length, FACES.stats().queued], [4, 0], 'the burst dropped the upload');
    g.W.end(); g.frames(2);
    eq1([g.G.ups.length, FACES.stats().windows], [5, 1], 'the next rest: two frames again');
    void A; void B;
  } finally { g.done(); }
});

test('1h fix M2: no near-duplicate window — planned only when its level beats the base by WIN_GAIN (at dpr 2 none until k > 0.75); M3: at a rest with dpr·k ≤ L0 the base is ≥ 1:1 and a stale window (the view left it) is not rebuilt for coverage; the next rest above k = 1 rebuilds it', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    eq1(WIN_GAIN, 1.5);
    const A = g.panel('a', { w: 400, h: 200 });
    g.attach(); landBase(g);
    g.W.end({ k: 0.6 }); g.frames(2); eq1([g.G.ups.length, FACES.stats().windows], [1, 0], '60 %: level 2.4 ≤ 2 × 1.5 — no window');
    g.W.end({ k: 0.75 }); g.frames(2); eq1(FACES.stats().windows, 0, '75 %: level 3 — not yet');
    g.W.end({ k: 0.76 }); g.frames(2); eq1([FACES.stats().windows, +g.G.ups.at(-1).w.toFixed(0)], [1, Math.round(400 * 2 * WIN_HEAD * 0.76)], '76 %: level 3.04 — made');
    A.face.destroy(); g.W.del('a'); // (fix R2: a lingering world item would count as an overlap)
    // M3 on a CS-80: the window at 160 % at the top-left; out to 100 % and past the margin: kept (stale, undrawn), no paint
    const B = g.panel('b', { w: 2432, h: 728 });
    landBase(g);
    g.W.end({ k: 1.6, tx: 0, ty: 0 }); settle(g);
    const n0 = g.G.ups.length, w0 = g.G.ups.at(-1);
    eq1([FACES.stats().windows, w0.w < 2432 * 4], [1, true], 'a strip window at 160 %');
    g.W.end({ k: 1, tx: -1500, ty: 0 }); settle(g);
    eq1([g.G.ups.length, FACES.stats().windows, g.G.texes.has(w0), FACES.quads(g.W.rectOf, g.W.cam).length], [n0, 1, true, 1], '100 % past the margin: the base is 1:1 — the stale window stays, undrawn, nothing painted');
    g.W.end({ k: 1.6, tx: -2000, ty: 0 }); settle(g);
    eq1([g.G.ups.length, FACES.stats().windows, g.G.texes.has(w0)], [n0 + 1, 1, false], 'back above 100 % where it does not cover: rebuilt');
    void B;
  } finally { g.done(); }
});

test('1h fix R3: the wood sheen composites as CSS does (premultiplied interpolation): the gradient stops fillBg draws, lerped unpremultiplied as a 2D gradient does, match the CSS result over the wood within 2 levels at every band centre (the 3-stop gradient was ~17 levels too light)', () => {
  const K = [[0, 0, 0.32], [0.45, 255, 0.05], [1, 0, 0.28]]; // style.css .inst.hw.hw-wood: 90deg black .32 → white .05 at 45 % → black .28
  const seg = t => { const s = t <= 0.45 ? 0 : 1, [t0, c0, a0] = K[s], [t1, c1, a1] = K[s + 1]; return { f: (t - t0) / (t1 - t0), c0, a0, c1, a1 }; };
  const css = t => { const { f, c0, a0, c1, a1 } = seg(t); return { p: c0 * a0 + (c1 * a1 - c0 * a0) * f, a: a0 + (a1 - a0) * f }; }; // premultiplied lerp
  const old = t => { const { f, c0, a0, c1, a1 } = seg(t); const a = a0 + (a1 - a0) * f; return { p: (c0 + (c1 - c0) * f) * a, a }; }; // the 2D gradient's lerp of the 3 stops
  const stops = sheenStops();
  assert.ok(Array.isArray(stops) && stops.length >= 20 && stops[0][0] === 0 && stops.at(-1)[0] === 1, 'stops [t, grey, alpha] from 0 to 1');
  const drawn = t => { let i = 0; while (i + 1 < stops.length && stops[i + 1][0] <= t) i++; const [t0, v0, a0] = stops[i], [t1, v1, a1] = stops[Math.min(i + 1, stops.length - 1)], f = t1 > t0 ? (t - t0) / (t1 - t0) : 0; const a = a0 + (a1 - a0) * f; return { p: (v0 + (v1 - v0) * f) * a, a }; };
  const wood = [0x5a, 0x32, 0x18], over = (c, w) => c.p + (1 - c.a) * w;
  let worst = 0, worstOld = 0;
  for (const t of [...[0, 200, 400, 600, 800, 1000, 1200].map(x => (x + 75) / 1400), ...Array.from({ length: 701 }, (_, i) => i / 700)]) {
    for (const w of wood) { worst = Math.max(worst, Math.abs(over(css(t), w) - over(drawn(t), w))); worstOld = Math.max(worstOld, Math.abs(over(css(t), w) - over(old(t), w))); }
  }
  assert.ok(worst <= 2, 'within 2 levels of CSS: ' + worst.toFixed(2));
  assert.ok(worstOld > 10, 'the old 3-stop gradient was off by ' + worstOld.toFixed(1));
  for (const [, v, a] of stops) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255 && a > 0 && a <= 1, 'whole grey levels, alpha (0, 1]');
});

test('1h fix R4: the wood stripes are rotated rects (crisp edges), not a bilinear pattern tile — the 14 world px period at the raster level, the four bands of --hw-wood, rotated 3°; the sheen after them', () => {
  const g = rig();
  try {
    const Wd = g.panel('w', { wood: true, w: 400, h: 200 });
    g.attach(); landBase(g);
    const t = g.G.ups[0], L = 2, c = t.calls, names = c.map(x => x[0]);
    eq1([t.w, t.h, names.includes('createPattern'), names.includes('rotate'), names.includes('save'), names.includes('restore')], [800, 400, false, true, true, true]);
    const rot = c.find(x => x[0] === 'rotate');
    near(rot[1], -3 * Math.PI / 180, 'rotated −3° (177deg)');
    const fr = c.filter(x => x[0] === 'fillRect'), bands = woodBands('#5a3218');
    eq1(bands.map(b => [b[0], b[1]]), [[0, 3], [3, 7], [7, 9], [9, 14]], 'the bands');
    eq1(bands.map(b => b[2]), ['#4d2b15', '#6e4b34', '#432512', '#5a3218'], 'color-mix as maths (86 % + black, 88 % + white, 74 % + black, the wood)');
    const hs = new Set(fr.slice(1).map(x => x[4])); // the stripe rects (after the fill): heights = the band heights + the overlap
    const rows = Math.ceil(400 / (14 * L)) + 2;
    assert.ok(fr.length >= 1 + 4 * (rows - 2) && fr.length <= 2 + 4 * (rows + 2), 'a rect per band per row: ' + fr.length);
    eq1([...hs].sort((a, b) => a - b).length, 4, 'four band heights');
    const ri = names.indexOf('restore'), si = names.indexOf('createLinearGradient');
    assert.ok(si > ri && names.lastIndexOf('fillRect') < ri, 'the sheen (a gradient; the stub makes none, so no fill) after the stripes');
    void Wd;
  } finally { g.done(); }
});

test('1h fix R5: the window origin snaps to WIN_SNAP world px (face-local) so a rebuilt window keeps the texel phase of the kept region; clipped to the face', () => {
  eq1(WIN_SNAP, 64);
  const cam = { tx: -1500, ty: -700, k: 1.6 }, w1 = winRect(CS80, cam, 1366, 1024), w2 = winRect(CS80, { tx: -1700, ty: -800, k: 1.6 }, 1366, 1024);
  eq1([w1.x % WIN_SNAP, w1.y % WIN_SNAP, (w1.x + w1.w) % WIN_SNAP, w1.y + w1.h, w2.x % WIN_SNAP, w2.y % WIN_SNAP, (w2.x - w1.x) % WIN_SNAP], [0, 0, 0, 728, 0, 0, 0], 'edges on the stride, clipped to the face');
  const v = visPart(CS80, cam, 1366, 1024);
  assert.ok(w1.x <= v.x && w1.y <= v.y && w1.x + w1.w >= v.x + v.w && w1.y + w1.h >= v.y + v.h, 'covers the visible part');
  assert.ok(w1.x <= v.x - WIN_MARGIN * 1366 / 1.6 + 1e-9 && w1.x + w1.w >= v.x + v.w + WIN_MARGIN * 1366 / 1.6 - 1e-9, 'and the margin');
});

/* ---- (P, IMPL-P §1.1, lane T) High = today: a scripted scene (real face sizes, a wood case, an off-screen face, zooms 30 → 200 %,
   pans, a loss / restore, then five 4000 × 2000 faces over the budget) traced at dpr 1 / 1.5 / 2 / 2.5 / 3 / 4 — every upload (size,
   mips, the drawImage source / dest), the frees, the stats, the modes — hashed; the hashes were taken at 4cc0936 (before P) */
function trace(dpr, pre) {
  const g = rig({ dpr, vw: 1366, vh: 1024 });
  const out = [], seen = { u: 0, f: 0 };
  try {
    if (pre) pre(g);
    const P = [g.panel('cs', { w: 2432, h: 984 }), g.panel('mod', { x: 2600, w: 2176, h: 1240 }), g.panel('960', { y: 1100, w: 864, h: 472 }), g.panel('m1', { x: 1000, y: 1100, w: 128, h: 472 }),
      g.panel('wd', { x: 1300, y: 1400, w: 1408, h: 696, wood: true }), g.panel('far', { x: 20000, w: 1856, h: 1304, on: false })];
    let L = P;
    const rec = tag => {
      const ups = g.G.ups.slice(seen.u).map(t => { const di = t.calls.filter(c => c[0] === 'drawImage')[0]; return [t.w, t.h, t.mips ? 1 : 0, di ? di.slice(2).map(v => +(+v).toFixed(4)) : null]; });
      seen.u = g.G.ups.length;
      const s = FACES.stats(), fr = g.G.frees - seen.f; seen.f = g.G.frees;
      out.push([tag, ups, fr, [s.faces, s.gl, s.dom, s.bytes, s.base, s.windows, s.soft, +s.softMin.toFixed(6), s.winPx, s.queued], L.map(M => M.face.mode + (M.svg.style.visibility === 'hidden' ? 'h' : ''))]);
    };
    FACES.attach({ gl: g.G, world: g.W, now: () => 0, win: g.win }); settle(g); rec('attach');
    for (const c of [{ k: 0.6 }, { k: 0.8 }, { k: 1 }, { k: 1.25, tx: -300, ty: -100 }, { k: 1.6, tx: 0, ty: 0 }, { k: 2, tx: -900, ty: -400 }, { k: 2, tx: -2400, ty: -400 }, { k: 1.4, tx: -3000, ty: -200 }, { k: 0.4, tx: 0, ty: 0 }, { k: 1.1, tx: -500, ty: -900 }]) {
      g.W.end(c); settle(g); rec('cam ' + JSON.stringify(c));
    }
    g.W.set('far', { x: 20000, y: 0, w: 1856, h: 1304 + BAR_H }, true); g.W.emit('screen', { on: ['far'], off: [] }); settle(g); rec('far on');
    FACES.lost(); rec('lost'); FACES.restored(); settle(g); rec('restored');
    for (const M of P) { M.face.destroy(); g.W.del(M.id); }
    g.W.end({ k: 0.3, tx: 0, ty: 0 }); settle(g); rec('gone');
    const B = L = []; for (const [id, x, on] of [['a', 0, true], ['b', 4100, true], ['c', 8200, true], ['d', 20000, false], ['e', 40000, false]]) B.push(g.panel(id, { x, w: 4000, h: 2000, on }));
    settle(g); g.frames(4); rec('budget');
    g.W.set('e', { x: 40000, y: 0, w: 4000, h: 2000 + BAR_H }, true); g.W.emit('screen', { on: ['e'], off: [] }); settle(g); rec('e on');
    for (const M of B) M.face.destroy();
  } finally { g.done(); }
  return out;
}
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const HIGH_TODAY = { 1: '3dcb43782d4cb7a8', 1.5: '1491d63848fb4daa', 2: 'a9562aafb819e37a', 2.5: '6f3ccc7ed3b42917', 3: '8ea1db0fcbef5bff', 4: 'ba6c603915adbad2' };
test('P High = today: the scripted scene\'s trace at dpr 1 / 1.5 / 2 / 2.5 / 3 / 4 hashes as at 4cc0936 (the uploads, frees, stats, modes)', () => {
  const got = {};
  for (const d of Object.keys(HIGH_TODAY)) { const t = trace(+d); got[d] = hash(t); if (process.env.TRACE) console.log(d, JSON.stringify(t)); }
  if (process.env.TRACE) console.log(JSON.stringify(got));
  eq1(got, HIGH_TODAY);
});

/* ---- (P, IMPL-P §1.1 / §7 T) the presets: the table, dE, the bases × (dE / dpr)², Low's no windows, Medium's windows, the budgets,
   the live switch (the stale-level re-raster and its rules (a)–(c)), the side limit (4096), the loss path, a device-ratio change,
   under / soft, the at-size timings */
const { TEX_Q, perfId, dEOf } = CF;
const PERFS = ['high', 'medium', 'low'];
const bad = g => g.mods.filter(M => M.face.mode === 'gl' && M.svg.style.visibility !== 'hidden').map(M => M.id); // R2a: never a gl face with its SVG
test('P presets: TEX_Q — High (R ∞: the device\'s own ratio; windows; 40e6 px; 384 MB) · Medium (R 1.5; windows; 22.5e6 px; 216 MB) · Low (R 1; no windows; 96 MB); perfId (else high); dE = min(dpr, R) at dpr 1 / 1.5 / 2 / 3 — pure and in the registry (stats: perf, dE, budget), live or detached, through FACES and the named export', () => {
  eq1([TEX_Q.high.R === Infinity, TEX_Q.high.win, TEX_Q.high.winBudget, TEX_Q.high.budget], [true, true, WIN_BUDGET_PX, FACE_BUDGET_BYTES]);
  eq1([TEX_Q.medium.R, TEX_Q.medium.win, TEX_Q.medium.winBudget, TEX_Q.medium.budget], [1.5, true, 22.5e6, 216e6]);
  eq1([TEX_Q.low.R, TEX_Q.low.win, TEX_Q.low.budget], [1, false, 96e6]);
  near(TEX_Q.medium.winBudget, WIN_BUDGET_PX * (1.5 / 2) ** 2, 'Medium\'s window px = 40e6 · (1.5 / 2)²');
  eq1(['high', 'medium', 'low', 'auto', '', null, undefined, 'LOW'].map(perfId), ['high', 'medium', 'low', 'high', 'high', 'high', 'high', 'high']);
  const tab = d => PERFS.map(p => dEOf(d, p));
  eq1([1, 1.5, 2, 3].map(tab), [[1, 1, 1], [1.5, 1.5, 1], [2, 1.5, 1], [3, 1.5, 1]], 'dE at dpr 1 / 1.5 / 2 / 3 (high, medium, low)');
  eq1([dEOf(0.5, 'high'), dEOf(4, 'high'), dEOf('x', 'medium')], [1, 4, 1], '≥ 1; High uncapped');
  for (const d of [1, 1.5, 2, 3]) {
    const g = rig({ dpr: d });
    try {
      g.panel('a');
      eq1([FACES.perf, FACES.stats().perf, FACES.stats().dE], ['high', 'high', d], 'dpr ' + d + ': High to start');
      eq1([FACES.setPerf('medium'), FACES.stats().dE, FACES.stats().budget, FACES.setPerf('medium')], [true, Math.min(d, 1.5), 216e6, false], 'detached: taken; the same id: no change');
      g.attach(); settle(g);
      eq1([CF.setPerf('low'), FACES.perf, FACES.stats().dE, FACES.stats().budget], [true, 'low', 1, 96e6], 'live, the named export');
      eq1([FACES.setPerf('nonsense'), FACES.stats().perf, FACES.stats().dE, FACES.stats().budget], [true, 'high', d, 384e6], 'anything else: High');
    } finally { g.done(); }
  }
});

test('P bases per preset: the base level is baseLevel(dE) — its bytes × (dE / dpr)² of High\'s (BASE_MAX_PX binding only the biggest faces); a scene started at a preset paints each base once, at that level (dpr 1 / 1.5 / 2 / 3)', () => {
  const S = [['a', 400, 200], ['cs', 2432, 984], ['mod', 2176, 1240], ['big', 4000, 2000]];
  for (const d of [1, 1.5, 2, 3]) {
    const hi = {};
    for (const p of PERFS) {
      const g = rig({ dpr: d });
      try {
        FACES.setPerf(p);
        S.forEach(([id, w, h], i) => g.panel(id, { x: i * 5000, w, h }));
        g.attach(); settle(g);
        const L = S.map(([, w, h]) => baseLevel(dEOf(d, p), w, h)), want = S.map(([, w, h], i) => [Math.round(w * L[i]), Math.round(h * L[i])]);
        eq1(g.G.ups.map(t => [t.w, t.h]), want, `dpr ${d} ${p}: one base each at baseLevel(dE ${dEOf(d, p)})`);
        const by = g.G.ups.map(t => t.bytes);
        if (p === 'high') S.forEach(([id], i) => { hi[id] = by[i]; });
        S.forEach(([id, w, h], i) => { if (w * h * Math.max(d, 1) ** 2 <= BASE_MAX_PX && d <= 3) assert.ok(Math.abs(by[i] / hi[id] - (dEOf(d, p) / d) ** 2) < 0.01, `${id} dpr ${d} ${p}: × ${(by[i] / hi[id]).toFixed(3)} ≈ (dE / dpr)²`); });
        eq1(FACES.stats().bytes, by.reduce((a, b) => a + b, 0));
      } finally { g.done(); }
    }
  }
  const s55 = ['ctl', ...(['902', '902', '902', '902', '904a', '904b', '907a', '911', '911', '911', '911', '911a', '914', '921', '921', '921', '921', '921', '921a', '921a', '921b', '921b', '921b', '923', '995', '960', '962', '992', '993', '994', '903a', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '961'])];
  const mb = (p, d) => s55.reduce((a, t) => { const [w, H] = FACES_9[t], h = H - BAR_H, L = baseLevel(dEOf(d, p), w, h); return a + Math.round(w * L) * Math.round(h * L) * 4 * 4 / 3; }, 0);
  const r = [mb('medium', 2) / mb('high', 2), mb('low', 2) / mb('high', 2)];
  assert.ok(r[0] <= 0.6 && r[1] <= 0.27, 'a System-55-sized set at dpr 2: Medium × ' + r[0].toFixed(3) + ' (G2 ≤ 0.6), Low × ' + r[1].toFixed(3) + ' (≤ 0.27)');
});

test('P windows: Low makes none at any zoom (no paint at a rest after a zoom-in — it never re-sharpens; its quads the bases alone); Medium\'s at ≤ dE · K_MAX, ≤ dE · WIN_HEAD · k, all together within 22.5e6 px (its budget level), only when they beat the base by WIN_GAIN', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    FACES.setPerf('low');
    const A = g.panel('a', { w: 2432, h: 728 }), B = g.panel('b', { y: 800, w: 2432, h: 728 }), C = g.panel('c', { y: 1600, w: 2432, h: 728 });
    g.attach(); settle(g);
    eq1([g.G.ups.length, g.G.ups.map(t => t.w)], [3, [2432, 2432, 2432]], 'three bases at level 1');
    const p0 = FACES.stats().paints;
    for (const c of [{ k: 0.6 }, { k: 0.8 }, { k: 1 }, { k: 1.25, tx: -300 }, { k: 1.6, tx: 0 }, { k: 2, tx: -900, ty: -400 }, { k: 0.4, tx: 0, ty: 0 }, { k: 2 }]) {
      g.W.end(c); settle(g);
      eq1([FACES.stats().windows, FACES.stats().paints - p0, FACES.quads(g.W.rectOf, g.W.cam).length], [0, 0, 3], 'Low at ' + JSON.stringify(c) + ': no window, no paint');
    }
    void A; void B; void C;
  } finally { g.done(); }
  const h = rig({ vw: 1366, vh: 1024 });
  try {
    FACES.setPerf('medium');
    const A = h.panel('a', { w: 2432, h: 728 }), B = h.panel('b', { y: 800, w: 2432, h: 728 }), C = h.panel('c', { y: 1600, w: 2432, h: 728 });
    h.attach(); settle(h);
    eq1(h.G.ups.map(t => t.w), [3648, 3648, 3648], 'bases at 1.5');
    h.W.end({ k: 0.7 }); settle(h);
    eq1(FACES.stats().windows, 0, '70 %: 1.5 · 2 · 0.7 = 2.1 ≤ 1.5 · WIN_GAIN — none');
    const k = 0.9, cx = 1216, cy = 800 + BAR_H + 364;
    h.W.end({ k, tx: 1366 / 2 - cx * k, ty: 1024 / 2 - cy * k }); settle(h);
    const cam = h.W.cam, rects = [0, 800, 1600].map(y => ({ x: 0, y: y + BAR_H, w: 2432, h: 728 })), wins = rects.map(r => winRect(r, cam, 1366, 1024));
    const sum = wins.reduce((a, w) => a + w.w * w.h, 0), Lw = winLevel(1.5, k, sum, 22.5e6);
    assert.ok(Lw < 1.5 * WIN_HEAD * k && Lw > 2.25, 'three CS-80s at 90 %: Medium\'s budget level binds (' + Lw.toFixed(3) + ' < ' + (1.5 * WIN_HEAD * k) + ')');
    const ws = h.G.ups.filter(t => !t.mips);
    let px = 0; for (const t of ws) px += t.w * t.h;
    eq1(ws.length, 3);
    assert.ok(px <= 22.5e6 * 1.001, 'all windows within 22.5e6 px: ' + px);
    const want = wins.map(w => { const L = winLevelOf(1.5, k, sum, w.w, w.h, undefined, TEX_MAX_DIM, 22.5e6); assert.ok(L <= Lw + 1e-9 && L <= 1.5 * K_MAX, 'L ' + L); return [Math.round(w.w * L), Math.round(w.h * L)].join('x'); }).sort();
    eq1(ws.map(t => t.w + 'x' + t.h).sort(), want, 'each window at winLevelOf(dE 1.5, …, 22.5e6) — ≤ the budget level, ≤ dE · K_MAX');
    h.W.end({ k: 2, tx: -300, ty: -100 }); settle(h);
    const w2 = h.G.ups.at(-1);
    eq1([w2.mips, FACES.stats().windows >= 1, w2.w <= Math.ceil(winRect(rects[0], h.W.cam, 1366, 1024).w * 1.5 * K_MAX) + 1], [false, true, true], '200 %: the window at ≤ dE · K_MAX = 3');
    void A; void B; void C;
  } finally { h.done(); }
});

test('P budgets: each preset\'s FACE_BUDGET (384 / 216 / 96 MB) — over it the off-screen faces are skipped / evicted farthest first, an on-screen face painted regardless', () => {
  for (const p of PERFS) {
    const g = rig({ vw: 1366, vh: 1024 });
    try {
      FACES.setPerf(p);
      const L = baseLevel(dEOf(2, p), 4000, 2000), per = Math.round(Math.round(4000 * L) * Math.round(2000 * L) * 4 * 4 / 3), fit = Math.floor(TEX_Q[p].budget / per);
      const P = [];
      [['a', 0, true], ['b', 8000, false], ['c', 16000, false], ['d', 24000, false], ['e', 32000, false]].forEach(([id, x, on]) => P.push(g.panel(id, { x, w: 4000, h: 2000, on })));
      g.attach(); settle(g); g.frames(4);
      const s = FACES.stats(), want = P.map((M, i) => (i < fit ? 'gl' : 'svg'));
      eq1([s.base, s.bytes <= TEX_Q[p].budget, P.map(M => g.st(M).mode)], [Math.min(fit, 5), true, want], `${p}: ${fit} of ${(per / 1e6).toFixed(1)} MB fit (nearest first), the rest skipped`);
      // the farthest comes on screen: painted; the farthest off-screen face with a base evicted
      g.W.set('e', { x: 32000, y: 0, w: 4000, h: 2000 + BAR_H }, true); g.W.emit('screen', { on: ['e'], off: [] }); settle(g);
      const m = P.map(M => g.st(M).mode);
      eq1([m[4], FACES.stats().bytes <= TEX_Q[p].budget || fit >= 5], ['gl', true], p + ': e on screen: painted');
      if (fit < 5) eq1(m[fit - 1], 'svg', p + ': the farthest off-screen face with a base evicted');
    } finally { g.done(); }
  }
});

test('P live switch High → Low → Medium → High (§1.1): the windows go, every stale drawable base re-rastered one a frame, nearest the centre first, its old texture drawn until the new one lands — never a gl face with its SVG showing (a folded, an overlapped pair, a decode-failed and a stale-failing face in the set); a folded / overlapped face keeps its stale base until drawable, then its first rest; a burst defers; a stale upload that fails keeps its base (no fail) and is not re-queued; ≤ the preset\'s budget once drained; back at High = the start', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    const at = {}, mk = (id, p) => { at[id] = [p.x || 0, (p.y || 0) + BAR_H]; return g.panel(id, p); };
    const B = mk('b', { x: 480, y: 380 }), Xs = mk('xs', { x: 100, y: 700, w: 300, h: 150 }), A = mk('a', { x: 950, y: 0 }), F = mk('f', { x: 0, y: 0 }),
      O1 = mk('o1', { x: 0, y: 300 }), O2 = mk('o2', { x: 1000, y: 300 }), C = mk('c', { x: 20000, y: 0, on: false });
    const qw = M => { const q = FACES.quads(g.W.rectOf, { k: 0.5 }).find(x => x.x === at[M.id][0] && x.y === at[M.id][1]); return q ? q.tex.w : 0; }; // its drawn base's width (0: no quad)
    g.W.setCam({ k: 1, tx: 0, ty: 0 }); g.attach(); settle(g);
    const warn = console.warn; console.warn = () => {};
    let Xd;
    try { Xd = mk('xd', { x: 500, y: 700 }); g.frames(); g.land(false); } finally { console.warn = warn; } // (its decode fails: the tier for good)
    settle(g);
    const s0 = FACES.stats();
    eq1([s0.base, s0.windows, s0.gl, g.st(Xd).mode, qw(A), qw(B), qw(Xs), qw(C), bad(g)], [7, 6, 7, 'dom', 800, 800, 600, 800, []], 'High at 100 %: seven bases at L 2, a window for each on-screen face');
    F.mod.setAttribute('data-cv-fold', ''); F.face.refresh();
    g.W.set('o2', { x: 50, y: 320, w: 400, h: 200 + BAR_H }); O2.mod.style.left = '50px'; O2.mod.style.top = '320px'; at.o2 = [50, 320 + BAR_H]; O2.face.refresh();
    settle(g);
    eq1([g.st(F).mode, g.st(O1).mode, g.st(O2).mode, FACES.stats().base, FACES.stats().windows, bad(g)], ['gl', 'dom', 'dom', 7, 3, []], 'folded (gl, no quad); the pair overlapping (dom, the bases kept)');
    // → Low: the windows go at once, nothing painted in the call; the stale drawable faces queued: B, Xs, A, then C (off screen)
    g.G.fail = src => src.width === 300; // (Xs's level-1 raster: 300 × 150 — its upload fails)
    let u = g.G.ups.length, t = g.G.tries;
    const f0 = g.G.frees;
    eq1(FACES.setPerf('low'), true);
    eq1([FACES.stats().windows, FACES.stats().queued, g.G.ups.length - u, g.G.frees - f0, qw(B), qw(A), bad(g)], [0, 4, 0, 3, 800, 800, []], 'Low: the windows freed, four stale bases queued, the old textures drawn');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const n = g.G.ups.length, tr = g.G.tries;
      g.frames();
      eq1([g.G.tries - tr, bad(g)], [1, []], 'frame ' + i + ': one raster, no gl face with its SVG showing');
      seen.push(g.G.ups.length > n ? g.G.ups.at(-1).w : 'failed');
      if (i === 0) eq1([qw(B), qw(Xs), qw(A)], [400, 600, 800], 'B swapped; the others still on their old textures');
      if (i === 1) eq1([qw(Xs), g.st(Xs).mode, !!Xs.face.tier], [600, 'gl', false], 'Xs\'s re-raster failed: its old base kept, still gl (no fail, no tier)');
    }
    eq1(seen, [400, 'failed', 400, 400], 'B (nearest the centre), Xs, A, then C (off screen)');
    let s = FACES.stats();
    eq1([s.queued, s.base, s.windows, qw(B), qw(Xs), qw(A), qw(C), s.bytes <= TEX_Q.low.budget, bad(g)], [0, 7, 0, 400, 600, 400, 400, true, []], 'drained: within Low\'s budget; Xs on its level-2 base');
    t = g.G.tries;
    for (const k of [1, 1.6, 2, 0.6, 1]) { g.W.end({ k }); settle(g); }
    eq1([g.G.tries - t, FACES.stats().windows], [0, 0], 'rests and a zoom-in at Low: nothing rastered (no window; Xs\'s level tried, not re-queued)');
    // the folded face unfolds: its stale base drawn at once, re-rastered at its rest; the pair parts: likewise
    F.mod.removeAttribute('data-cv-fold'); F.face.refresh();
    eq1([g.st(F).mode, qw(F), bad(g)], ['gl', 800, []], 'unfolded: the stale base drawn (no SVG)');
    g.frames(); eq1([qw(F), bad(g)], [400, []], 'its rest: re-rastered');
    g.W.set('o2', { x: 1000, y: 300, w: 400, h: 200 + BAR_H }); O2.mod.style.left = '1000px'; O2.mod.style.top = '300px'; at.o2 = [1000, 300 + BAR_H]; g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(O1).mode, g.st(O2).mode, qw(O1), qw(O2), bad(g)], ['gl', 'gl', 800, 800, []], 'apart: gl at once on the stale bases');
    g.frames(2); eq1([qw(O1), qw(O2), FACES.stats().queued, bad(g)], [400, 400, 0, []], 'their rest: one a frame');
    // → Medium, a pinch starting mid-queue: deferred to the rest
    u = g.G.ups.length;
    FACES.setPerf('medium'); g.frames();
    eq1([g.G.ups.length - u, g.G.ups.at(-1).w], [1, 600], 'Medium: B first, at L 1.5');
    g.W.emit('movestart', {}); g.frames(3); g.landAll();
    eq1([g.G.ups.length - u, FACES.stats().queued, bad(g)], [1, 0, []], 'a burst: nothing more (the queue dropped)');
    t = g.G.tries;
    g.W.end({ k: 1 }); settle(g);
    s = FACES.stats();
    eq1([qw(B), qw(Xs), qw(A), qw(F), qw(O1), qw(O2), qw(C), s.windows, s.queued, s.bytes <= TEX_Q.medium.budget, g.G.tries - t, bad(g)], [600, 450, 600, 600, 600, 600, 600, 6, 0, true, 12, []], 'drained at the rest: every base at L 1.5 (Xs too: a new level is tried again), a window per on-screen face — 6 bases + 6 windows, no more');
    eq1(g.G.ups.filter(x => !x.mips).slice(-6).every(x => x.w <= 1200 && x.h <= 600), true, 'the windows at ≤ dE · K_MAX = 3');
    // → High: as at the start
    t = g.G.tries;
    FACES.setPerf('high'); settle(g);
    s = FACES.stats();
    eq1([qw(B), qw(Xs), qw(A), qw(F), qw(C), s.windows, s.bytes, g.G.tries - t, bad(g)], [800, 600, 800, 800, 800, 6, s0.bytes, 13, []], 'High: every base at L 2, the windows at L 4 — the bytes of the start; 7 bases + 6 windows');
  } finally { g.done(); }
});

test('P the budget counts every stale base at its new level (§1.1 (a)): High → Low over an off-screen face evicts none it would shrink (crediting only the job\'s own base, the first swap would have); Low → High grows within the budget; a High set too big for Low ends as a cold Low load — the nearest kept, the farther off-screen evicted, never an on-screen one', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    const P = [], mk = (id, x, on) => P.push(g.panel(id, { x, w: 4000, h: 2000, on }));
    const per = Lv => Math.round(Math.round(4000 * Lv) * Math.round(2000 * Lv) * 4 * 4 / 3), Lh = baseLevel(2, 4000, 2000);
    mk('a', 0, true); mk('b', 8000, false);
    g.attach(); settle(g);
    eq1([FACES.stats().bytes, FACES.stats().base], [2 * per(Lh), 2]);
    assert.ok(2 * per(Lh) - per(Lh) + per(1) > TEX_Q.low.budget && 2 * per(1) <= TEX_Q.low.budget, 'the fixture: a\'s swap with b still at its High level is over 96 MB; both shrunk are not');
    let f0 = g.G.frees;
    FACES.setPerf('low'); settle(g);
    eq1([FACES.stats().base, g.G.frees - f0, P.map(M => g.st(M).mode), FACES.stats().bytes], [2, 2, ['gl', 'gl'], 2 * per(1)], 'both re-rastered, nothing evicted (the two frees: their own old bases)');
    mk('c', 16000, false); mk('d', 24000, false); settle(g);
    eq1([P.map(M => g.st(M).mode), FACES.stats().bytes], [['gl', 'gl', 'svg', 'svg'], 2 * per(1)], 'at Low the two farther off-screen faces do not fit');
    FACES.setPerf('high'); settle(g);
    eq1([FACES.stats().base, FACES.stats().bytes, P.map(M => g.st(M).mode)], [4, 4 * per(Lh), ['gl', 'gl', 'gl', 'gl']], 'Low → High: two grow, two come (≤ 384 MB)');
    f0 = g.G.frees;
    FACES.setPerf('low'); settle(g);
    eq1([FACES.stats().base, FACES.stats().bytes, P.map(M => g.st(M).mode), g.G.frees - f0], [2, 2 * per(1), ['gl', 'gl', 'svg', 'svg'], 4], 'High → Low with four: a cold Low load — a, b shrunk; c, d evicted at a\'s job (four frees), never re-made');
  } finally { g.done(); }
});

test('P the loss path: an upload that returns null with the context not ready (cv-gl: lost under the upload) is no fail — a cold face stays on its SVG (no tier), a stale one keeps its base — and the next rest after the restore makes them', () => {
  const g = rig();
  try {
    const A = g.panel('a');
    g.attach(); settle(g);
    g.G.fail = true; g.G.ready = false;
    const B = g.panel('b', { x: 1000 }); settle(g); // B's cold base: lost under the upload
    eq1([g.st(A).mode, g.st(B).mode, !!B.face.tier, FACES.stats().base, g.G.tries], ['gl', 'svg', false, 1, 2], 'cold: no fail (no tier), the SVG');
    FACES.setPerf('low'); g.frames(2); // A's stale re-raster: lost too
    eq1([g.st(A).mode, !!A.face.tier, g.G.ups.at(-1).w, bad(g)], ['gl', false, 800, []], 'stale: the base kept, no fail');
    g.G.fail = false; g.G.ready = true;
    FACES.restored(); settle(g);
    eq1([g.st(A).mode, g.st(B).mode, g.G.ups.slice(-2).map(x => x.w).sort().join()], ['gl', 'gl', '400,400'], 'restored: both made at Low');
  } finally { g.done(); }
});

test('P the side limit (G3): every real face (the keyboards, the 900 Series / System 55 modules, the authored layouts) through baseLevel(dE, w, h, 4096) at each preset × dpr 1 / 1.5 / 2 / 3 — every side ≤ 4096 (the wide four at dpr 2 a level lower, the OB-Xa / DX7 exactly 4096); through a fake gl whose maxTex is 4096 every upload (bases, windows) ≤ 4096; texSide = min(TEX_MAX_DIM, maxTex)', async () => {
  const P = await import('../cv-panel.js?v=9'), { MODELS } = await import('../models.js?v=9');
  const all = [...Object.entries(FACES_1I), ...Object.entries(FACES_9)].map(([id, [w, H]]) => [id, w, H - BAR_H]);
  for (const id of P.HW_IDS) { const L = P.layoutOf(id), m = MODELS.find(x => x.id === id); if (L && m) { const s = P.sizeOf(L, m); all.push([id + ' (authored)', s.w, s.h - BAR_H]); } }
  for (const [id, w, h] of all) for (const d of [1, 1.5, 2, 3]) for (const p of PERFS) {
    const L = baseLevel(dEOf(d, p), w, h, 4096);
    assert.ok(Math.round(w * L) <= 4096 && Math.round(h * L) <= 4096, `${id} at dpr ${d} ${p}: ${Math.round(w * L)} × ${Math.round(h * L)}`);
  }
  const at2 = id => { const [w, H] = FACES_1I[id]; return [Math.round(w * 2), +baseLevel(2, w, H - BAR_H, 4096).toFixed(4), Math.round(w * baseLevel(2, w, H - BAR_H, 4096))]; };
  eq1(['modular', 'cs80', 'jupiter8', 'juno60', 'obxa', 'dx7'].map(at2), [[4352, 1.8824, 4096], [4864, 1.6842, 4096], [4288, 1.9104, 4096], [4288, 1.9104, 4096], [4096, 2, 4096], [4096, 2, 4096]], 'the wide four a level lower; OB-Xa / DX7 exactly 4096');
  eq1([baseLevel(2, 2176, 1240), baseLevel(2, 2176, 1240, 0), baseLevel(2, 2176, 1240, 'x')], [2, 2, 2], 'no side limit given: TEX_MAX_DIM (today)');
  near(winLevelOf(2, 2, 0, 2432, 300, 16e6, 4096), 4096 / 2432, 'a window\'s side too');
  for (const p of PERFS) {
    const g = rig({ vw: 1366, vh: 1024 });
    try {
      FACES.setPerf(p);
      g.G.maxTex = 4096;
      Object.entries(FACES_1I).forEach(([id, [w, H]], i) => g.panel(id, { x: (i % 3) * 3000, y: Math.floor(i / 3) * 1600, w, h: H - BAR_H }));
      g.attach(); settle(g);
      eq1([FACES.stats().base, FACES.stats().texSide, g.G.ups.every(t => t.w <= 4096 && t.h <= 4096)], [12, 4096, true], p + ': twelve bases, every side ≤ 4096');
      for (const c of [{ k: 1, tx: 0, ty: 0 }, { k: 2, tx: -100, ty: -100 }, { k: 1.3, tx: -3000, ty: -200 }]) { g.W.end(c); settle(g); }
      eq1(g.G.ups.every(t => t.w <= 4096 && t.h <= 4096), true, p + ': the windows too (' + g.G.ups.filter(t => !t.mips).length + ')');
      g.G.maxTex = 16384; eq1(FACES.stats().texSide, TEX_MAX_DIM, 'a 16384 device: still TEX_MAX_DIM');
    } finally { g.done(); }
  }
});

test('P a device-ratio change (cv-world\'s watchDpr → FACES.recheck()) re-rasters every stale base at the new ratio, one a frame (today a face kept the ratio it was made at); a level that failed is tried again only when the preset or the level changes', () => {
  const g = rig({ dpr: 2 });
  try {
    const A = g.panel('a'), B = g.panel('b', { x: 1000 });
    g.attach(); settle(g);
    eq1(g.G.ups.map(t => t.w), [800, 800]);
    g.win.devicePixelRatio = 1; FACES.recheck();
    g.frames(); eq1(g.G.ups.length, 3, 'one a frame');
    g.frames(); eq1([g.G.ups.slice(2).map(t => t.w), FACES.stats().bytes, bad(g)], [[400, 400], 2 * Math.round(400 * 200 * 4 * 4 / 3), []], 'both at level 1');
    FACES.setPerf('medium'); g.win.devicePixelRatio = 3; FACES.recheck(); settle(g);
    eq1(g.G.ups.slice(4).map(t => t.w), [600, 600], 'dpr 3 at Medium: dE 1.5');
    g.G.fail = true; FACES.setPerf('high'); settle(g);
    eq1([FACES.stats().queued, g.st(A).mode, g.G.ups.length], [0, 'gl', 6], 'level 3 fails: the level-1.5 bases kept');
    g.G.fail = false; g.W.end({ k: 0.3 }); settle(g); FACES.recheck(); settle(g);
    eq1(g.G.ups.length, 6, 'tried: not re-queued at a rest or a recheck');
    g.win.devicePixelRatio = 2; FACES.recheck(); settle(g);
    eq1(g.G.ups.slice(6).map(t => t.w), [800, 800], 'a new ratio, a new level: made');
    void B;
  } finally { g.done(); }
});

test('P stats: under / underMin count the textures below the screen\'s own 1:1 (a base at L < dpr · min(k, 1), a window at L < dpr · k): none at High, Medium / Low by design; soft / softMin stay relative to dE (the raster ceilings only)', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    g.panel('a'); g.panel('b', { x: 600 });
    g.attach(); settle(g);
    for (const k of [0.3, 1, 1.6]) { g.W.end({ k }); settle(g); const s = FACES.stats(); eq1([s.under, s.underMin, s.soft], [0, 1, 0], 'High at ' + k); }
    FACES.setPerf('low'); g.W.end({ k: 0.3 }); settle(g);
    eq1([FACES.stats().under, FACES.stats().underMin], [0, 1], 'Low at 30 %: 1 / (2 · 0.3) ≥ 1');
    g.W.end({ k: 1 }); settle(g);
    eq1([FACES.stats().under, FACES.stats().underMin, FACES.stats().soft], [2, 0.5, 0], 'Low at 100 %: both bases at half the screen\'s ratio');
    FACES.setPerf('medium'); g.W.end({ k: 2 }); settle(g);
    const s = FACES.stats();
    eq1([s.windows, s.soft, s.under, s.underMin], [2, 0, 4, 0.75], 'Medium at 200 %: the windows at dE · k = 3 (not soft), under the screen\'s 4 (0.75), the bases 1.5 / 2');
  } finally { g.done(); }
});

/* ---- (P review 2, F1) a rack whose faces exceed the budget settles. The review's repro (200 modules, dpr 2, every preset): an
   off-screen face that cannot fit — even with every farther face freed — evicted the farther ones anyway, they re-queued, fitted
   again in their own freed room, and each landing re-planned the face that cannot fit: ≈ 7 rasters, uploads and frees a second, forever.
   The fixture at Low (96 MB; dE 1 at dpr 2): two on-screen faces of 25.6 MB, X (nearer, off screen, 46.1 MB: 51.2 + 46.1 > 96 even
   with every farther face gone) and S (farther, 5.3 MB, fits beside the two) — the cycle's exact shape */
const idle = (g, n = 120) => { // n quiet frames (loads landed): what the page does at a rest — the counters must not move
  const a = [FACES.stats().paints, g.G.ups.length, g.G.frees, g.G.tries];
  for (let i = 0; i < n; i++) { g.frames(); g.landAll(); }
  const b = [FACES.stats().paints, g.G.ups.length, g.G.frees, g.G.tries];
  return b.map((v, i) => v - a[i]);
};
function rackF1(g) {
  FACES.setPerf('low');
  const P = { o1: g.panel('o1', { x: 0, w: 2400, h: 2000 }), o2: g.panel('o2', { x: 3000, w: 2400, h: 2000 }), x: g.panel('x', { x: 6000, w: 3600, h: 2400, on: false }), s: g.panel('s', { x: 40000, w: 1000, h: 1000, on: false }) };
  const by = (w, h) => Math.round(w * h * 4 * 4 / 3);
  assert.ok(2 * by(2400, 2000) + by(1000, 1000) <= TEX_Q.low.budget && 2 * by(2400, 2000) + by(3600, 2400) > TEX_Q.low.budget, 'the fixture: O1 + O2 + S fit, O1 + O2 + X do not (even without S)');
  return P;
}
test('R2-F1 a rack past the face budget goes idle: an off-screen face that cannot fit frees nothing and is not re-queued — after the queue drains, 120 frames make 0 paints / 0 uploads / 0 frees and S keeps its base; a rest re-asks without a paint; a bigger budget (setPerf) brings X, then back to Low it ends as it started; a free (O2 unmounted) brings it too', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    const P = rackF1(g), modes = () => Object.values(P).map(M => g.st(M).mode).join();
    g.attach(); settle(g, 60);
    eq1([modes(), FACES.stats().queued, FACES.stats().base], ['gl,gl,svg,gl', 0, 3], 'o1, o2, s have their bases; x (it cannot fit) shows its SVG');
    eq1(idle(g), [0, 0, 0, 0], 'a rest: no paint, no upload, no free, no try');
    eq1([modes(), FACES.stats().queued, !raf.pending], ['gl,gl,svg,gl', 0, true], 'S kept its base; nothing queued, no frame pending');
    // a camera rest: the plan asks again — still no room: still nothing made (S not freed for an X that cannot fit)
    g.W.end({ k: 0.3, tx: -20 }); settle(g, 20);
    eq1([idle(g), modes()], [[0, 0, 0, 0], 'gl,gl,svg,gl'], 'a camera rest: idle again');
    // a budget change: High (384 MB, dE 2) — every base re-rastered at its new level and X now fits
    FACES.setPerf('high'); settle(g, 60);
    eq1([modes(), FACES.stats().base, FACES.stats().queued], ['gl,gl,gl,gl', 4, 0], 'High: all four');
    eq1(idle(g), [0, 0, 0, 0], 'and idle');
    // back to Low: the two on-screen faces shrink (their job frees the farther ones: the budget), S fits again, X does not
    FACES.setPerf('low'); settle(g, 60);
    eq1([modes(), FACES.stats().base, FACES.stats().bytes <= TEX_Q.low.budget], ['gl,gl,svg,gl', 3, true], 'Low again: as at the start');
    eq1(idle(g), [0, 0, 0, 0], 'idle');
    // a free: O2 unmounted (no camera move, no preset change) — X fits beside O1 and S
    P.o2.face.destroy(); g.W.del('o2'); settle(g, 60);
    eq1([g.st(P.x).mode, g.st(P.s).mode, g.st(P.o1).mode, FACES.stats().bytes <= TEX_Q.low.budget], ['gl', 'gl', 'gl', true], 'a free brings X');
    eq1(idle(g), [0, 0, 0, 0], 'idle');
  } finally { g.done(); }
});

test('R2-F1 enforce frees only when the freeing makes the room (the guard under the plan): X\'s image lands after the plan left it out — its job re-queues itself from the load — S keeps its base, nothing is freed, X waits on its SVG; and no re-queue after', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  try {
    const P = rackF1(g);
    g.attach();
    g.frames(4); // the four loads start, one a frame, nearest first: o1, o2, x, s
    eq1(g.R.imgs.length, 4, 'four images pending');
    for (const i of [0, 1, 3]) g.R.imgs[i].onload(); // x's stays pending
    g.frames(12);
    eq1([g.st(P.o1).mode, g.st(P.o2).mode, g.st(P.s).mode, g.st(P.x).mode, FACES.stats().base], ['gl', 'gl', 'gl', 'svg', 3], 'o1, o2, s landed; x waits for its image');
    const f0 = g.G.frees, p0 = FACES.stats().paints;
    g.R.imgs[2].onload(); // the late image: x's job (queued before the plan excluded it) runs into the budget
    g.frames(6);
    eq1([g.G.frees - f0, FACES.stats().paints - p0, g.st(P.s).mode, g.st(P.x).mode, FACES.stats().base], [0, 0, 'gl', 'svg', 3], 'nothing freed for an x that cannot fit; s keeps its base');
    eq1(idle(g), [0, 0, 0, 0], 'idle');
  } finally { g.done(); }
});

/* ---- (P review 2, F5) the side limit shrinks a window, never drops it: ?texmax=4096 on High — a wide face at 150 % had no window
   (the 25 % margin pushed its side past 4096: 4096 / 1440 = 2.84 ≤ 1.5 × the base) and sat at 0.67 of 1:1 with under = 0 */
test('R2-F5 a 4096-texture device at High (dpr 2): every real face (the keyboards, the 900 Series / System 55 modules) gets a window at k = 1.5 with the camera on the middle of the face (1366 × 1024 and 1440 × 900 viewports: the 25 % margin both sides) — every side ≤ 4096, its level ≥ dpr · k (1:1) — where it was none for the wide faces', () => {
  const all = [...Object.entries(FACES_1I), ...Object.entries(FACES_9)].map(([id, [w, H]]) => [id, w, H - BAR_H]);
  const lvlOf = t => { const di = t.calls.find(c => c[0] === 'drawImage'); return t.w / +di[4]; }; // (the window raster: drawImage(img, sx, sy, sw, sh, 0, 0, W, H))
  const miss = [];
  for (const [vw, vh] of [[1366, 1024], [1440, 900]]) for (const [id, w, h] of all) {
    const g = rig({ vw, vh });
    try {
      g.G.maxTex = 4096;
      const M = g.panel(id, { w, h });
      g.attach(); settle(g);
      g.W.end({ k: 1.5, tx: vw / 2 - 1.5 * w / 2, ty: vh / 2 - 1.5 * (BAR_H + h / 2) }); settle(g); // (the middle of the face at the middle of the viewport)
      const s = FACES.stats(), wins = g.G.ups.filter(t => !t.mips);
      const ok1 = s.windows === 1 && wins.length >= 1 && g.G.ups.every(t => t.w <= 4096 && t.h <= 4096) && lvlOf(wins.at(-1)) >= 3 - 1e-9 && g.st(M).mode === 'gl';
      if (!ok1) miss.push(`${id} ${vw}×${vh}: windows ${s.windows}, ${wins.length ? 'L ' + lvlOf(wins.at(-1)).toFixed(3) : 'none'}`);
    } finally { g.done(); }
  }
  eq1(miss, [], 'every face has its window');
});

test('R2-F5 maths: winRect takes a margin (default WIN_MARGIN); winFit shrinks it — in WIN_SHRINK steps toward the visible part — only when the side limit alone holds the level below min(what the other limits allow, dpr · k), else it is winRect + winLevelOf as before; the review\'s Prophet-5 (1920 × 824, 1440 × 900, k 1.5, dpr 2, 4096): the 25 % window is 1536 wide (2.67 < 3), the fit 1280 wide at 3.2; winOwed waives the gain rule only for a side-limited window that brings a sub-1:1 base to 1:1', () => {
  const R = { x: 0, y: 0, w: 1920, h: 824 }, cam = { tx: 720 - 1.5 * 960, ty: 450 - 1.5 * 412, k: 1.5 }, VW = 1440, VH = 900;
  const w0 = winRect(R, cam, VW, VH), w1 = winRect(R, cam, VW, VH, WIN_MARGIN), w2 = winRect(R, cam, VW, VH, 0.15), w3 = winRect(R, cam, VW, VH, 0);
  eq1([w0.w, w1.w, w2.w, w3.w], [1536, 1536, 1280, 1024], 'the margin: default = WIN_MARGIN; 0.15; none (the visible part snapped outward)');
  eq1(winRect(R, cam, VW, VH, -1).w, 1536, 'a negative / garbage margin: the default');
  const sum = w0.w * w0.h, f = CF.winFit(R, cam, VW, VH, 2, sum, undefined, 4096, WIN_BUDGET_PX);
  assert.ok(winLevelOf(2, 1.5, sum, w0.w, w0.h, undefined, 4096, WIN_BUDGET_PX) < 3, 'before: the 25 % window\'s level 2.67 < 1:1 (3) and ≤ 1.5 × the base (3)');
  eq1([f.wr.w, +f.L.toFixed(4), f.bound, Math.round(f.wr.w * f.L) <= 4096, f.L >= 3], [1280, 3.2, true, true, true], 'after: the margin shrunk to 0.15, level 4096 / 1280');
  assert.ok(CF.winOwed(f, 2, 2, 1.5), 'a side-limited window bringing the 2.0 base to 1:1 (3.0): worth its paint although 3.2 ≤ 1.5 × 2');
  assert.ok(!CF.winOwed(f, 2, 2, 1), 'at k = 1 the base is 1:1 already (L0 ≥ d · k): the gain rule decides');
  assert.ok(!CF.winOwed(CF.winFit(R, cam, VW, VH, 2, sum, undefined, 8192, WIN_BUDGET_PX), 2, 2, 1.5), 'not bound at 8192: no waiver');
  // nothing binds (8192, none): exactly as before — the same rect, the same level, not bound
  for (const max of [8192, undefined, 0]) {
    const u = CF.winFit(R, cam, VW, VH, 2, sum, undefined, max, WIN_BUDGET_PX);
    eq1([u.wr, u.L === winLevelOf(2, 1.5, sum, w0.w, w0.h, undefined, max, WIN_BUDGET_PX), u.bound], [w0, true, false], 'max ' + max + ': winRect + winLevelOf as before');
  }
  // a viewport too wide for any window to reach 1:1 (2400 css px: 1600 world px visible = 4800 device px): the margin gone, as high as the limit lets it
  const cam2 = { tx: 1200 - 1.5 * 1000, ty: 0, k: 1.5 }, R2 = { x: 0, y: 0, w: 2000, h: 400 }, n = winRect(R2, cam2, 2400, 1000, 0), s2 = n.w * n.h;
  const g = CF.winFit(R2, cam2, 2400, 1000, 2, s2, undefined, 4096, WIN_BUDGET_PX);
  eq1([g.wr, g.bound, g.L < 3, Math.round(g.wr.w * g.L) <= 4096], [n, true, true, true], 'no margin reaches 1:1: the visible part alone, as high as the side limit lets it');
  eq1(CF.winFit(R, { tx: 1e6, ty: 0, k: 1.5 }, VW, VH, 2, 1, undefined, 4096, WIN_BUDGET_PX), null, 'off screen: null');
});

test('R2-F5 under counts a base drawn above k = 1 with no window (L < dpr · k): High on a viewport too wide for the side limit (2400 css px: the visible part at 150 % is 4800 device px > 4096, so no window reaches 1:1 or the base\'s 1.5 ×) at 150 % — the face sits at 0.67 of 1:1 and under / underMin say so; an off-screen face is not counted; at 100 % the base is 1:1: not under', () => {
  const g = rig({ vw: 2400, vh: 1000 });
  try {
    g.G.maxTex = 4096;
    g.panel('a', { w: 2000, h: 400 }); g.panel('b', { x: 20000, w: 2000, h: 400, on: false });
    g.attach(); settle(g);
    g.W.end({ k: 1.5, tx: 0, ty: 0 }); settle(g);
    const s = FACES.stats();
    eq1([s.windows, s.under, +s.underMin.toFixed(3)], [0, 1, 0.667], 'a: no window worth its paint (the visible part alone is 1600 world px: level 2.56 < 3); under 1 (b is off screen), 2 / 3 of 1:1');
    g.W.end({ k: 1 }); settle(g);
    eq1([FACES.stats().under, FACES.stats().underMin], [0, 1], 'at 100 % the base is 1:1: not under');
  } finally { g.done(); }
});

test('P at size (§3.2, recorded): 512 faces — a cold load through the queue (a plan after every landing), recheck() (the overlap pass), FACES.recheck() (refresh + overlap + plan), a High → Low switch drained; timed (ms), reported past a frame', (t) => {
  const g = rig({ vw: 1440, vh: 900 });
  try {
    const N = 512, cols = 32;
    for (let i = 0; i < N; i++) g.panel('m' + i, { x: (i % cols) * 140, y: Math.floor(i / cols) * 520, w: 128, h: 472, on: Math.floor(i / cols) < 2 });
    const T = f => { const t0 = performance.now(); f(); return performance.now() - t0; };
    let cold = 0, frames = 0;
    cold = T(() => { g.attach(); for (; frames < 4 * N && (FACES.stats().queued || raf.pending); frames++) { g.frames(); g.landAll(); } });
    const nb = FACES.stats().base;
    assert.ok(nb >= 2 * cols && FACES.stats().bytes <= FACE_BUDGET_BYTES, 'the on-screen bases, the rest to the budget: ' + nb);
    const rc = T(() => CF.recheck()), frc = T(() => FACES.recheck());
    const f1 = T(() => { g.frames(); });
    FACES.setPerf('low');
    let sw = 0, sf = 0; for (; sf < 4 * N && FACES.stats().queued; sf++) sw += T(() => { g.frames(); });
    eq1([FACES.stats().queued, FACES.stats().bytes <= TEX_Q.low.budget], [0, true], 'the switch drained');
    const r = { faces: N, bases: nb, coldMs: +cold.toFixed(1), coldFrames: frames, perLanding: +(cold / N).toFixed(3), recheckMs: +rc.toFixed(2), facesRecheckMs: +frc.toFixed(2), frameMs: +f1.toFixed(2), switchMs: +sw.toFixed(1), switchFrames: sf, switchPerFrame: +(sw / Math.max(1, sf)).toFixed(3) };
    t.diagnostic('P at size: ' + JSON.stringify(r));
    if (process.env.TRACE) console.log(JSON.stringify(r));
    assert.ok(isFinite(r.coldMs) && isFinite(r.switchMs), 'recorded');
  } finally { g.done(); }
});
