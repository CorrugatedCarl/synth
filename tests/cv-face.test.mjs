import './v8-guard.mjs';
// cv-face (IMPL-1h §3, lane F): the registry and its modes, the base texture's life with a fake gl (bytes, mips, freed on
// unmount / loss / destroy), the quads (z order, the body clip, the window above k = 1), the windows (level maths incl.
// the budget level, keep / rebuild / free, one per frame nearest first, cancelled by a burst), the budget eviction order,
// the overlap rule, the stats. Fake DOM (wk-dom), fake gl (the §2 surface), fake world (rectOf / on / onScreen / cam).
// (1i, IMPL-1i §3.3) the keyboard faces: 1:1 at dpr 2, ≤ 58 MB each, the recorded exemption at dpr 2.5 / 3 pinned.
// (9, IMPL-9 §2.2) the 900 Series faces: the module and console sizes (= moog-core's), 1:1 at dpr 2, the Model 15 set's bytes.
// Only strings / numbers / booleans go into assert (never a fake-DOM node).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as CF from '../cv-face.js?v=9';
import { faceTier } from '../cv-panel.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { K_MAX } from '../cv-world.js?v=9';
import * as wk from '../wk.js?v=9';
import { fresh, raf } from './wk-dom.mjs';

const { FACES, WIN_K0, WIN_MARGIN, WIN_HEAD, WIN_BUDGET_PX, WIN_MAX_PX, TEX_MAX_DIM, FACE_BUDGET_BYTES, BASE_MAX_PX, OFF_ALPHA, baseLevel, winLevel, winLevelOf, visPart, winRect, winKeep } = CF;
const eq1 = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, (m || '') + ' ' + a + ' ≈ ' + b);
const SVGNS = 'http://www.w3.org/2000/svg';

/* ---- the fakes */
function fakeGL() {
  const G = {
    texes: new Set(), ups: [], frees: 0, fail: false,
    upload(src, o) {
      if (G.fail) return null;
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
  const done = () => { for (const M of mods) M.face.destroy(); FACES.detach(); raf.uninstall(); };
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

/* ---- (9, IMPL-9 §2.2, §8.4) the 900 Series faces: the console and the nine module faces (outer px, the 40 px bar included) */
const FACES_9 = { ctl: [864, 352], 921: [224, 512], '921a': [128, 512], '921b': [128, 512], 923: [128, 512], '904a': [128, 512], '907a': [352, 512], 911: [128, 512], 902: [128, 512], 995: [128, 512] };
test('9 faces: §2.2\'s sizes (1 MU 128 × 512, 2 MU 224 × 512, 3 MU 352 × 512, the console 864 × 352) = moog-core\'s w / h; each 1:1 at rest at dpr 2 (baseLevel 2) in ≤ 6 MB of base + mips; the Model 15 set\'s thirteen faces ≈ 24.4 MB, under a fifteenth of FACE_BUDGET_BYTES', async () => {
  const P = await import('../cv-panel.js?v=9'), MG = await import('../moog-core.js?v=9'), { MODELS } = await import('../models.js?v=9');
  const bytes = (w, H) => w * (H - BAR_H) * 4 * 4 * 4 / 3; // dpr 2: 4 device px a world px, RGBA, + mips
  eq1(MG.ORDER_ALL.slice().sort(), Object.keys(FACES_9).sort(), 'every type');
  for (const t of MG.ORDER_ALL) {
    const L = t === 'ctl' ? P.layoutOf('m900') : P.moduleLayout(t), m = t === 'ctl' ? MODELS.find(x => x.id === 'm900') : P.moduleModel(t), s = P.sizeOf(L, m);
    eq1([s.w, s.h], FACES_9[t], t + ': §2.2');
    eq1([s.w, s.h], [MG.TYPES[t].w, MG.TYPES[t].h], t + ': moog-core\'s w / h');
    eq1(baseLevel(2, s.w, s.h - BAR_H), 2, t + ': L0 = 2 at dpr 2');
    assert.ok(bytes(s.w, s.h) <= 6e6, t + ': ' + (bytes(s.w, s.h) / 1e6).toFixed(2) + ' MB');
  }
  const M15 = ['ctl', '902', '902', '904a', '907a', '911', '911', '921', '921a', '921b', '921b', '923', '995'], total = M15.reduce((a, t) => a + bytes(...FACES_9[t]), 0);
  assert.ok(total <= 25e6 && total <= FACE_BUDGET_BYTES / 15, 'the Model 15 set: ' + (total / 1e6).toFixed(1) + ' MB');
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
