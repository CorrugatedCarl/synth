import './v8-guard.mjs';
// cv-face (IMPL-1h §3, lane F): the registry and its modes, the base texture's life with a fake gl (bytes, mips, freed on
// unmount / loss / destroy), the quads (z order, the body clip, the window above k = 1), the windows (level maths incl.
// the budget level, keep / rebuild / free, one per frame nearest first, cancelled by a burst), the budget eviction order,
// the overlap rule, the stats. Fake DOM (wk-dom), fake gl (the §2 surface), fake world (rectOf / on / onScreen / cam).
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
    set(id, rect, on = true) { items.set(id, { rect, on }); },
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
  const R = { k: 1, imgs: [], urls: new Set(), made: 0 };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  win.Image = Img; win.Blob = Bl; win.URL = { createObjectURL: b => { const u = 'blob:' + (++R.made); R.urls.add(u); R.blob = b; return u; }, revokeObjectURL: u => R.urls.delete(u) };
  const env = { win, doc: d, scale: () => R.k, raf: f => globalThis.requestAnimationFrame(f) };
  const G = fakeGL(), W = fakeWorld(o.vw, o.vh);
  const mods = [];
  // a hardware module: .cv-mod[data-cv-mod] > .cv-body > .inst.hw > .hw-decor > svg; registered with cv-face
  function panel(id, p = {}) {
    const x = p.x || 0, y = p.y || 0, w = p.w || 400, h = p.h || 200;
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-mod', id); mod.style.zIndex = String(p.z == null ? 1 : p.z); mod.style.left = x + 'px'; mod.style.top = y + 'px';
    const body = d.createElement('div'); body.className = 'cv-body';
    const root = d.createElement('div'); root.className = 'inst hw' + (p.wood ? ' hw-wood' : ''); root.style.setProperty('--hw-case', p.fill || '#222222'); if (p.wood) root.style.setProperty('--hw-wood', '#5a3218');
    const deco = d.createElement('div'); deco.className = 'hw-decor';
    const svg = d.createElementNS(SVGNS, 'svg');
    deco.append(svg); root.append(deco); body.append(root); mod.append(body);
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
  return { d, win, world, R, G, W, env, panel, land, landAll, frames, st, attach, done, mods };
}
// one queued base: a frame starts the load, the load lands (the job is re-queued at the front), a frame paints
const landBase = g => { g.frames(); g.land(); g.frames(); };
// every queued job (nearest the viewport centre first): frames and landed loads until nothing is pending
const settle = (g, max = 40) => { for (let i = 0; i < max && (FACES.stats().queued || raf.pending); i++) { g.frames(); g.landAll(); } };

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
  eq1(winRect(R, cam, 1366, 1024), { x: 0, y: 0, w: 708, h: 728 }, 'grown by WIN_MARGIN · the viewport (341.5, 256), clipped to the face, whole px');
  const z = { tx: -1500, ty: -700, k: 1.6 }; // the view at world (937.5, 437.5), 853.75 × 640: the face's top-left corner region
  const v2 = visPart(R, z, 1366, 1024);
  near(v2.x, 0); near(v2.w, (1500 + 1366) / 1.6 - 1000); near(v2.y, 0); near(v2.h, (700 + 1024) / 1.6 - 500);
  const wr = winRect(R, z, 1366, 1024);
  eq1([wr.x, wr.y, wr.w, wr.h], [0, 0, Math.ceil((1500 + 1366) / 1.6 + WIN_MARGIN * 1366 / 1.6) - 1000, Math.min(728, Math.ceil((700 + 1024) / 1.6 + WIN_MARGIN * 1024 / 1.6) - 500)], 'grown by the margin (213.4, 160 world px) past the visible part, clipped to the face');
  const win = { x: 0, y: 0, w: 708, h: 728, L: 4 };
  eq1([winKeep(win, { x: 10, y: 10, w: 600, h: 700 }, 2, 1.6), winKeep(win, { x: 10, y: 10, w: 700, h: 700 }, 2, 1.6), winKeep(win, { x: 10, y: 10, w: 600, h: 700 }, 2, 2.1), winKeep(null, { x: 0, y: 0, w: 1, h: 1 }, 2, 1), winKeep(win, null, 2, 1)],
    [true, false, false, false, false], 'kept while it covers the visible part and L ≥ dpr · k');
});

/* ---- registration, modes, the base texture */
test('1h registry: without the GL path a mounted face is the 1g tier (dom; the SVG at k ≥ 1), an unmounted one the SVG; data-cv-face on the module; attach → the base made next frame (an Image from a Blob URL, the scratch filled with the case colour, uploaded with mips at dpr × size) → gl: the SVG hidden, no .hw-bm, the tier gone', () => {
  const g = rig();
  try {
    const A = g.panel('a'), H = g.panel('h', { mount: false });
    eq1([st0(g, A), FACES.stats().faces, FACES.stats().dom], [{ mode: 'svg', svg: 'visible', attr: 'dom', bm: 0, shown: false }, 2, 1], 'mounted on the 2D path: a tier (data-cv-face dom; at k = 1 it shows the SVG)');
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
    assert.ok(ch.length >= 1, 'onChange fired');
    off();
    // at rest at 100 % a window follows (level dpr · K_MAX = 4: the whole face, no mips), then the queue drains
    g.frames(); const tw0 = g.G.ups[1];
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
    // unmount: cv-module calls wk.releaseCanvases(body) → the sentinel's hook
    A.mod.remove(); wk.releaseCanvases(A.sentinel());
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
      eq1([g.st(C).mode, g.st(C).attr, !!C.face.tier, warned], ['svg', 'dom', true, 1], 'decode failed: the tier (the SVG at k = 1), one warning');
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
    // a folded module: no quad (its body is display: none), the tier instead; unfolded: back
    A.mod.setAttribute('data-cv-fold', ''); A.face.refresh();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, g.st(A).attr, FACES.stats().base], [2, 'dom', 3], 'folded: dom (the base kept)');
    A.mod.removeAttribute('data-cv-fold'); A.face.refresh();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, g.st(A).attr, g.G.ups.length], [3, 'gl', 3], 'unfolded: gl again without a paint');
    // a face whose module the world does not know: skipped
    eq1(FACES.quads(() => null, g.W.cam).length, 0);
    // detach: everything freed, the tiers back
    FACES.detach();
    eq1([FACES.quads(g.W.rectOf, g.W.cam).length, FACES.stats().bytes, g.G.frees, g.st(A).attr, !!A.face.tier], [0, 0, 3, 'dom', true], 'detached: the 2D tiers');
  } finally { g.done(); }
});

/* ---- windows */
test('1h windows: at a zoom end above WIN_K0 an on-screen gl face gets the visible part grown by WIN_MARGIN rastered from the same Image (source rect) at min(dpr·K_MAX, dpr·WIN_HEAD·k, budget) without mips; its quad above the base only at k > 1; kept while it covers the visible part at L ≥ dpr·k; rebuilt when the view leaves it; freed below WIN_K0, off screen, on unmount, on loss; one per frame, nearest first; a burst cancels', () => {
  const g = rig({ vw: 1366, vh: 1024 });
  const last = () => g.G.ups.at(-1);
  try {
    const A = g.panel('a', { w: 2432, h: 728 }); // the CS-80's face at (0, BAR_H)
    g.attach(); landBase(g);
    eq1([g.G.ups.length, FACES.stats().windows], [1, 0]);
    // 60 %: the whole face is visible; Lw = min(4, 2 · 2 · 0.6, budget) = 2.4 > L0 = 2: made for the next zoom-in
    g.W.end({ k: 0.6 });
    eq1(g.G.ups.length, 1, 'never in the event: next frame');
    g.frames();
    let t = last();
    eq1([g.G.ups.length, FACES.stats().windows, t.mips, t.w, t.h], [2, 1, false, Math.round(2432 * 2.4), Math.round(728 * 2.4)], 'the window: the whole face (grown past it), level 2.4, no mips');
    let di = t.calls.filter(c => c[0] === 'drawImage')[0];
    eq1([di[1] === g.R.imgs[0], di.slice(2)], [true, [0, 0, 2432, 728, 0, 0, t.w, t.h]], 'a source rect of the same Image');
    eq1(FACES.quads(g.W.rectOf, g.W.cam).length, 1, 'at k ≤ 1 only the base quad');
    g.W.setCam({ k: 1.2 });
    const q = FACES.quads(g.W.rectOf, g.W.cam);
    eq1([q.length, q[1].x, q[1].y, q[1].w, q[1].h, q[1].tex === t, q[1].clip === q[0].clip], [2, 0, BAR_H, 2432, 728, true, true], 'above 1: the window quad over the base, the same clip');
    // 160 %, the view at the face's top-left: Lw = min(4, 6.4, budget) = 4 → rebuilt (2.4 < dpr · k = 3.2)
    g.W.end({ k: 1.6 }); g.frames();
    t = last();
    const R = { x: 0, y: BAR_H, w: 2432, h: 728 }, wr = winRect(R, g.W.cam, 1366, 1024);
    eq1([g.G.ups.length, FACES.stats().windows, g.G.frees, t.w, t.h], [3, 1, 1, Math.round(wr.w * 4), Math.round(wr.h * 4)], 'rebuilt at level 4, the old one freed');
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
    g.W.end({ k: 1.6 }); g.frames();
    eq1(FACES.stats().windows, 1, 'the next rest makes it');
    // off screen: freed; unmount: freed; context loss: dropped
    g.W.set('a', { x: 0, y: 0, w: 2432, h: 728 + BAR_H }, false); g.W.emit('screen', { on: [], off: ['a'] }); g.frames();
    eq1([FACES.stats().windows, FACES.stats().base], [0, 1], 'off screen: the window goes, the base stays');
    g.W.set('a', { x: 0, y: 0, w: 2432, h: 728 + BAR_H }, true); g.W.emit('screen', { on: ['a'], off: [] }); g.frames();
    eq1(FACES.stats().windows, 1, 'back on screen at a rest: made again');
    const s0 = FACES.stats();
    eq1([s0.paints, s0.paintMs >= 0, s0.paintMax >= 0], [g.G.ups.length, true, true], 'every paint measured');
    FACES.lost(); eq1([FACES.stats().windows, FACES.stats().base, FACES.stats().bytes], [0, 0, 0]);
    FACES.restored(); g.frames(); g.frames();
    eq1([FACES.stats().base, FACES.stats().windows], [1, 1], 'restored: the base, then the window');
    A.mod.remove(); wk.releaseCanvases(A.sentinel());
    eq1([FACES.stats().windows, FACES.stats().base, FACES.stats().bytes], [0, 0, 0], 'unmount frees both');
    // several faces (three CS-80s stacked): one window per frame, the nearest the viewport centre first; the budget
    // level over their window areas
    g.world.append(A.mod);
    const B = g.panel('b', { y: 800, w: 2432, h: 728 }), C = g.panel('c', { y: 1600, w: 2432, h: 728 });
    g.W.end({ k: 0.3, tx: 0, ty: 0 }); settle(g); // the three bases (C, B, A: nearest the view centre first); no windows at 30 %
    eq1([FACES.stats().base, FACES.stats().windows], [3, 0]);
    // 80 % with the view centred on B: windows for every visible face; B first (nearest), then A, then C
    const k = 0.8, cx = 1216, cy = 800 + BAR_H + 364;
    g.W.end({ k, tx: 1366 / 2 - cx * k, ty: 1024 / 2 - cy * k });
    const cam = g.W.cam, rects = { a: { x: 0, y: BAR_H, w: 2432, h: 728 }, b: { x: 0, y: 800 + BAR_H, w: 2432, h: 728 }, c: { x: 0, y: 1600 + BAR_H, w: 2432, h: 728 } };
    const wins = Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, winRect(r, cam, 1366, 1024)]));
    const sum = Object.values(wins).reduce((a, w) => a + w.w * w.h, 0), Lw = winLevel(2, k, sum), Lof = w => winLevelOf(2, k, sum, w.w, w.h);
    assert.ok(Lw < 2 * WIN_HEAD * k && Lw > 2, 'three CS-80 faces in view at 80 %: the budget level binds (' + Lw.toFixed(3) + ')');
    assert.ok(Lof(wins.b) < Lw && Lof(wins.b) > 2.9, 'B (the whole face in its window) also meets the 16 M px raster ceiling (' + Lof(wins.b).toFixed(3) + ')');
    const n1 = g.G.ups.length;
    g.frames(); eq1([g.G.ups.length, last().w, last().h], [n1 + 1, Math.round(wins.b.w * Lof(wins.b)), Math.round(wins.b.h * Lof(wins.b))], 'frame 1: B (nearest the centre) at the budget level');
    g.frames(); eq1([g.G.ups.length, last().w], [n1 + 2, Math.round(wins.a.w * Lof(wins.a))], 'frame 2: A');
    g.frames(); eq1([g.G.ups.length, last().w, FACES.stats().windows], [n1 + 3, Math.round(wins.c.w * Lof(wins.c)), 3], 'frame 3: C');
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
    // B dropped onto A (the world recached B's rect at the drag end): the screen event / a refresh finds the overlap
    g.W.set('b', { x: 200, y: 50, w: 400, h: 200 + BAR_H }); B.face.refresh();
    eq1([g.st(A).attr, g.st(B).attr, !!A.face.tier, !!B.face.tier, FACES.quads(g.W.rectOf, g.W.cam).length, FACES.stats().base, g.G.frees], ['dom', 'dom', true, true, 0, 2, 0], 'both DOM while they intersect; the bases kept');
    g.R.k = 0.5; g.frames(); g.landAll();
    eq1([A.bm(), B.bm(), g.st(A).mode, A.face.shown], [1, 1, 'dom', true], 'the tiers paint their bitmaps at 50 % as in 1g');
    g.R.k = 1;
    g.W.set('b', { x: 1000, y: 0, w: 400, h: 200 + BAR_H }); g.W.emit('screen', { on: [], off: [] });
    eq1([g.st(A).attr, g.st(B).attr, A.bm(), B.bm(), g.st(A).svg, FACES.quads(g.W.rectOf, g.W.cam).length, g.G.ups.length], ['gl', 'gl', 0, 0, 'hidden', 2, 2], 'apart: gl again without a paint, the tiers gone');
    // C's rect intersects A's but C is at home (unmounted): no overlap for A
    g.W.set('c', { x: 100, y: 0, w: 400, h: 200 + BAR_H }); g.W.emit('screen', { on: [], off: [] });
    eq1(g.st(A).attr, 'gl');
    g.world.append(C.mod); C.face.refresh();
    eq1([g.st(A).attr, g.st(C).attr], ['dom', 'dom'], 'mounted over A: both DOM');
    C.face.destroy(); FACES.recheck();
    eq1(g.st(A).attr, 'gl', 'C destroyed: A is gl again');
  } finally { g.done(); }
});
