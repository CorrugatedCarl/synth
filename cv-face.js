// cv-face.js — the hardware faces as GPU textures (IMPL-1h §3; lane F). A registry of the hardware front panels' static
// art (cv-panel render's .hw-decor: the SVG markup, w × h world px, one per mounted panel) and the texture policy over it:
// a mipmapped base texture at L0 = min(dpr, 3) device px per world px (k ≤ 1) and, above k = 1, a finer window of the
// visible part — both composited by cv-gl under #world, which draws FACES.quads(rectOf, cam) every frame, so nothing of a
// face re-rasters at a zoom end (G1) and a face is never sampled below 1 device px per on-screen px (G2).
// Modes: 'gl' (the textures; the SVG visibility: hidden, no .hw-bm), 'dom' (the 1g faceTier: the 2D fallback, a folded or an
// overlapping module — §3.5), 'svg' (the SVG: at home / the base pending; the tier itself shows the SVG at k ≥ 1 on the 2D
// path). Rules: no layout read in a burst (the deco's offset measured at mount / refresh / a rest), one paint + upload per
// animation frame at a rest, nearest the viewport centre first, cancelled by a burst; textures under FACE_BUDGET_BYTES,
// freed on unmount (wk.releaseCanvases through a 0 × 0 sentinel canvas), context loss (FACES.lost) and destroy (G6).
// Plain ES module; node imports it (tests: a fake gl of the §2 surface, a fake world of rectOf / on / onScreen / ids / cam).
import * as wk from './wk.js?v=9';
import { K_MAX, visibleRect, intersects, toWorld } from './cv-world.js?v=9';
import { BAR_H } from './cv-module.js?v=9';

/** Windows (§3.3): none at k ≤ WIN_K0; the visible part grown by WIN_MARGIN of the viewport each side; level ≤ dpr · WIN_HEAD · k
 * (a 2× zoom-in from a rest stays ≥ 1:1); all windows together ≤ WIN_BUDGET_PX device px (≈ 160 MB). */
export const WIN_K0 = 0.5, WIN_MARGIN = 0.25, WIN_HEAD = 2, WIN_BUDGET_PX = 40e6;
/** The budget (§3.4) for base + window textures together; over it the off-screen faces' windows, then bases, go. */
export const FACE_BUDGET_BYTES = 384e6;
/** The base texture (§3.2): L0 = min(dpr, BASE_L_MAX) device px per world px, ≤ BASE_MAX_PX px (the iOS 2D canvas ceiling). */
export const BASE_L_MAX = 3, BASE_MAX_PX = 16e6;
/** A window raster ≤ WIN_MAX_PX px (the same ceiling: a whole CS-80 at level 4 would be 24 M px); no texture side over
 * TEX_MAX_DIM (8192: the smallest MAX_TEXTURE_SIZE the site meets) — the level drops to fit, §8 records the cost. */
export const WIN_MAX_PX = 16e6, TEX_MAX_DIM = 8192;
/** The module body's bottom radii (world px; style.css .cv-body) the quads are clipped to. */
export const BODY_R = 12;
/** A powered-off module's body is drawn at this opacity (style.css [data-off] > .cv-body); the quads take it as alpha. */
export const OFF_ALPHA = 0.45;

const fin = v => typeof v === 'number' && isFinite(v);
const msNow = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());
const EPS = 1e-6;

/* ---------------------------------------------------------------- the maths (pure, node-tested) */
/** The base level for a dpr and a face: min(dpr, BASE_L_MAX), reduced so w·h·L² ≤ BASE_MAX_PX. */
export function baseLevel(d, w, h) {
  let L = Math.min(BASE_L_MAX, Math.max(1, +d || 1));
  if (w * h * L * L > BASE_MAX_PX) L = Math.sqrt(BASE_MAX_PX / Math.max(1, w * h));
  return Math.min(L, TEX_MAX_DIM / Math.max(1, w, h));
}
/** The window level: min(dpr · K_MAX, dpr · WIN_HEAD · k, the budget level √(WIN_BUDGET_PX / Σ window world area)). */
export function winLevel(d, k, sumArea) {
  const b = sumArea > 0 ? Math.sqrt(WIN_BUDGET_PX / sumArea) : Infinity;
  return Math.min(d * K_MAX, d * WIN_HEAD * k, b);
}
/** One window's level: winLevel, then the raster ceilings (WIN_MAX_PX px, TEX_MAX_DIM a side) for its w × h world px. */
export function winLevelOf(d, k, sumArea, w, h) {
  return Math.min(winLevel(d, k, sumArea), Math.sqrt(WIN_MAX_PX / Math.max(1, w * h)), TEX_MAX_DIM / Math.max(1, w, h));
}
/** The visible part of a face rect R (world) in a vw × vh viewport: face-local world px, or null off screen. */
export function visPart(R, cam, vw, vh) {
  const V = visibleRect(cam, vw, vh, 0);
  const x0 = Math.max(R.x, V.x), y0 = Math.max(R.y, V.y), x1 = Math.min(R.x + R.w, V.x + V.w), y1 = Math.min(R.y + R.h, V.y + V.h);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0 - R.x, y: y0 - R.y, w: x1 - x0, h: y1 - y0 };
}
/** The window of a face rect R: the visible part grown by WIN_MARGIN · the viewport on each side (world px), clipped to the
 * face, on whole world px; face-local; null off screen. */
export function winRect(R, cam, vw, vh) {
  if (!visPart(R, cam, vw, vh)) return null;
  const V = visibleRect(cam, vw, vh, 0), mx = WIN_MARGIN * vw / cam.k, my = WIN_MARGIN * vh / cam.k;
  const x0 = Math.max(R.x, Math.floor(V.x - mx)), y0 = Math.max(R.y, Math.floor(V.y - my));
  const x1 = Math.min(R.x + R.w, Math.ceil(V.x + V.w + mx)), y1 = Math.min(R.y + R.h, Math.ceil(V.y + V.h + my));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0 - R.x, y: y0 - R.y, w: x1 - x0, h: y1 - y0 };
}
/** Is a window ({x, y, w, h, L}, face-local) kept: it still covers the visible part `vis` and its level ≥ dpr · k. */
export function winKeep(win, vis, d, k) {
  if (!win || !vis) return false;
  return win.L >= d * k - EPS && vis.x >= win.x - EPS && vis.y >= win.y - EPS && vis.x + vis.w <= win.x + win.w + EPS && vis.y + vis.h <= win.y + win.h + EPS;
}
const texBytes = (w, h, mips) => Math.round(w * h * 4 * (mips ? 4 / 3 : 1));

/* ---------------------------------------------------------------- the background fill of a face's uncovered parts */
// Every panel's SVG leaves parts of its box open (the centring strip offX, the extras strip, gaps between areas): the
// scratch canvas is first filled as the .inst.hw's background — its computed colour, or for a wood case (a gradient
// background, computed colour transparent) the stripes of style.css .inst.hw.hw-wood from --hw-wood (color-mix as maths),
// so a GL face matches the DOM one. Decided once per face from the root's inline custom properties / computed style.
const hex = c => { const m = /^#([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? parseInt(m[1], 16) : null; };
const mix = (c, f, to) => { // color-mix(in srgb, c f%, to): c toward black (to = 0) or white (to = 255)
  const n = hex(c); if (n == null) return c;
  const ch = s => Math.round(((n >> s) & 255) * f + to * (1 - f));
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
};
const isClear = c => !c || c === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c);
function bgOf(root, win) {
  const cs = win && typeof win.getComputedStyle === 'function' ? (() => { try { return win.getComputedStyle(root); } catch (err) { return null; } })() : null;
  const prop = k => { let v = cs && typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(k) : ''; if (!v && root.style && typeof root.style.getPropertyValue === 'function') v = root.style.getPropertyValue(k); return String(v || '').trim(); };
  const wood = !!(root.classList && root.classList.contains('hw-wood'));
  let color = cs ? cs.backgroundColor : '';
  if (isClear(color)) color = prop('--hw-case') || prop('--hw-panel') || '#151515';
  if (!wood) return { color, wood: null };
  return { color: prop('--hw-wood') || color, wood: prop('--hw-wood') || '#5a3218' };
}
/** Fills the scratch (W × H device px at level L, its origin at face-local (ox, oy) world px) as the face's background. */
function fillBg(bg, ctx, W, H, L, ox, oy, doc) {
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, W, H);
  if (!bg.wood) return;
  try { // the stripes: a 14 world px period along 177deg (3° off vertical), then the 90deg sheen across the face
    const w = bg.wood, P = 14 * L, tile = doc.createElement('canvas');
    tile.width = Math.max(1, Math.round(16 * L)); tile.height = Math.max(1, Math.round(P));
    const t = tile.getContext('2d');
    for (const [a, b, c] of [[0, 3, mix(w, 0.86, 0)], [3, 7, mix(w, 0.88, 255)], [7, 9, mix(w, 0.74, 0)], [9, 14, w]]) { t.fillStyle = c; t.fillRect(0, a * L, tile.width, (b - a) * L); }
    const pat = ctx.createPattern(tile, 'repeat');
    if (pat && typeof pat.setTransform === 'function' && typeof globalThis.DOMMatrix === 'function') pat.setTransform(new globalThis.DOMMatrix().translate(-ox * L, -oy * L).rotate(-3));
    ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(-ox * L, 0, (bg.faceW - ox) * L, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(0.45, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    tile.width = 0; tile.height = 0;
  } catch (err) { /* the flat wood colour stays */ }
}

/* ---------------------------------------------------------------- the registry */
const faces = []; // registration order (the z tie-break)
let seq = 0, GL = null, WD = null, HOOK = null, ATT = null, CAM = null, VP = { w: 0, h: 0 }, bytes = 0, scratch = null, LOST = false, BURST = false;
const subs = new Set(), S = { paints: 0, paintMs: 0, paintMax: 0 };
let Q = [], pumping = false, pumpGen = 0, QUAD = []; // the paint queue (one job per frame); the reused quad list
const emit = () => { for (const f of [...subs]) { try { f(); } catch (err) { console.error(err); } } };
const raf = f => (HOOK && typeof HOOK.raf === 'function' ? HOOK.raf(f) : wk.frame(f));
const now = () => (HOOK && typeof HOOK.now === 'function' ? HOOK.now() : msNow());
const dprOf = F => Math.max(1, +((F.env && F.env.win) || F.wnd || {}).devicePixelRatio || 1);
function size() { // the viewport (CSS px): a layout read at a rest only
  if (HOOK && typeof HOOK.size === 'function') { const s = HOOK.size(); return { w: +s.w || 0, h: +s.h || 0 }; }
  const v = WD && WD.viewport;
  if (!v) return { w: 0, h: 0 };
  const w = +v.clientWidth || 0, h = +v.clientHeight || 0;
  if (w > 0 && h > 0) return { w, h };
  try { const r = v.getBoundingClientRect(); return { w: +r.width || 0, h: +r.height || 0 }; } catch (err) { return { w, h }; }
}
const cam = () => CAM || (WD && WD.cam) || { tx: 0, ty: 0, k: 1 };
// mounted and showing: connected, in the world, no [hidden] ancestor (#cvParts at home) — no layout read (as the tier)
function live(deco) {
  if (deco.isConnected === false) return false;
  for (let n = deco; n && n.nodeType === 1; n = n.parentNode) { if (n.hasAttribute && n.hasAttribute('hidden')) return false; if (n.hasAttribute && n.hasAttribute('data-cv-world')) return true; }
  return false;
}
function modEl(deco) { for (let n = deco; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-mod')) return n; return null; }
const rectOf = id => { if (!WD || typeof WD.rectOf !== 'function') return null; const r = WD.rectOf(id); return r && fin(r.x) && fin(r.y) && fin(r.w) && fin(r.h) ? r : null; };
const faceRect = F => { const r = rectOf(F.mid); return r ? { x: r.x + F.ox, y: r.y + F.oy, w: F.w, h: F.h } : null; };
const onScreen = F => !WD || typeof WD.onScreen !== 'function' || WD.onScreen(F.mid);
function dist2(F) { // the face's centre to the viewport's, world px²; off-screen faces sort after every on-screen one
  const R = faceRect(F); if (!R) return Infinity;
  const c = cam(), p = toWorld(c, VP.w / 2, VP.h / 2), dx = R.x + R.w / 2 - p.x, dy = R.y + R.h / 2 - p.y;
  return dx * dx + dy * dy + (onScreen(F) ? 0 : 1e18);
}
// the module element's attributes the quads depend on (no layout read): z, fold, power, the live drag offset, the position
function attrs(F) {
  const el = F.el, st = (el && el.style) || {}, has = k => !!(el && el.hasAttribute && el.hasAttribute(k));
  const z = parseFloat(st.zIndex), m = /translate3d\(\s*([-+\d.e]+)px\s*,\s*([-+\d.e]+)px/.exec(st.transform || '');
  const n = { z: fin(z) ? z : 0, folded: has('data-cv-fold'), alpha: has('data-off') ? OFF_ALPHA : 1, dx: m ? +m[1] || 0 : 0, dy: m ? +m[2] || 0 : 0, pos: (st.left || '') + '|' + (st.top || '') };
  const o = F.a, moved = o && o.pos !== n.pos, vis = !o || o.z !== n.z || o.alpha !== n.alpha || o.dx !== n.dx || o.dy !== n.dy, fold = !o || o.folded !== n.folded;
  F.a = n;
  return { moved, vis, fold };
}
function observe(F, el) {
  if (F.mo) { try { F.mo.disconnect(); } catch (err) { /* gone */ } F.mo = null; }
  const MO = ((F.env && F.env.win) || F.wnd || globalThis).MutationObserver || globalThis.MutationObserver;
  if (!el || typeof MO !== 'function') return;
  try {
    F.mo = new MO(() => { // a drag frame (transform), a drop (left / top), z, fold, power
      if (F.dead || F.el !== el) return;
      const c = attrs(F);
      if (c.fold) sync(F, 'attrs'); else if (c.vis) emit();
      if (c.moved) recheckLater();
    });
    F.mo.observe(el, { attributes: true, attributeFilter: ['style', 'data-cv-fold', 'data-off'] });
  } catch (err) { F.mo = null; }
}
let rcDue = false;
function recheckLater() { if (rcDue) return; rcDue = true; raf(() => { rcDue = false; recheck(); }); }
function free(F, which) {
  const t = F[which];
  if (!t) return;
  F[which] = null;
  bytes -= t.tex.bytes || 0;
  if (GL && typeof GL.free === 'function') { try { GL.free(t.tex); } catch (err) { /* dead context */ } }
  if (bytes < 0) bytes = 0;
}
function unqueue(F, kind) { Q = Q.filter(j => j.F !== F || (kind && j.kind !== kind)); }
function setMode(F, m) {
  if (F.mode === m && F.attrEl === F.el) return false;
  const was = F.mode;
  F.mode = m;
  // the SVG: hidden under a GL face; shown in 'svg' and when the tier takes over from 'gl' (it hides it again once its
  // bitmap lands; in 'dom' it owns the visibility)
  try { if (m === 'gl') F.svg.style.visibility = 'hidden'; else if (m === 'svg' || was === 'gl') F.svg.style.visibility = ''; } catch (err) { /* inert */ }
  if (F.attrEl && F.attrEl !== F.el) { try { F.attrEl.removeAttribute('data-cv-face'); } catch (err) { /* gone */ } }
  F.attrEl = F.el;
  if (F.el) { try { F.el.setAttribute('data-cv-face', m); } catch (err) { /* inert */ } }
  return true;
}
function tierOn(F) { if (F.tier || typeof F.mkTier !== 'function') return; try { F.tier = F.mkTier(F.deco, F.svg, F.markup, F.w, F.h, F.env); } catch (err) { console.warn('cv-face: no tier', err); F.tier = null; } }
function tierOff(F) { if (!F.tier) return; const t = F.tier; F.tier = null; try { t.destroy(); } catch (err) { /* gone */ } }
// the state machine: mounted? → 'gl' (attached, unfolded, no overlap, the base landed) | 'svg' (the base pending) | 'dom'
function sync(F, why) {
  if (F.dead) return;
  const mid = F.moduleOf(), el = mid != null ? modEl(F.deco) : null, mounted = mid != null && !!el && live(F.deco);
  let ch = false;
  if (!mounted) { // at home or detached: the textures go, the tier too; the SVG shows (hidden with its ancestors)
    if (F.el) { observe(F, null); F.el = null; F.a = null; }
    F.mid = null; F.mounted = false; F.failed = false; unqueue(F);
    if (F.base || F.win) ch = true;
    free(F, 'base'); free(F, 'win'); tierOff(F);
    if (setMode(F, 'svg')) ch = true;
    if (ch) emit();
    return;
  }
  if (F.el !== el) { F.el = el; F.a = null; observe(F, el); F.bg = null; why = 'mount'; }
  F.mid = String(mid); F.mounted = true;
  if (attrs(F).vis) ch = true;
  if (why === 'mount' || why === 'refresh') { // the offset inside the module: a layout read, never in a burst
    let o = null; try { o = F.offset(); } catch (err) { o = null; }
    const ox = o && fin(o.x) ? o.x : 0, oy = o && fin(o.y) ? o.y : BAR_H;
    if (ox !== F.ox || oy !== F.oy) { F.ox = ox; F.oy = oy; ch = true; }
  }
  const glOk = !!GL && !F.a.folded && !F.overlap && !F.failed;
  if (glOk && F.base) { tierOff(F); if (setMode(F, 'gl')) ch = true; }
  else if (glOk) { tierOff(F); if (setMode(F, 'svg')) ch = true; needBase(F); }
  else {
    if (!GL) { if (F.base || F.win) ch = true; free(F, 'base'); free(F, 'win'); unqueue(F); }
    else if (F.a.folded) { if (F.win) ch = true; free(F, 'win'); unqueue(F, 'win'); }
    if (setMode(F, 'dom')) ch = true;
    tierOn(F);
  }
  if (ch) emit();
}
/* ---- the paint queue: one job (a base or a window) per animation frame at a rest, nearest the viewport centre first */
function needBase(F) {
  if (!GL || LOST || F.base || F.failed || Q.some(j => j.F === F && j.kind === 'base')) return;
  Q.push({ F, kind: 'base', dist: dist2(F) });
  pump();
}
function pump() {
  if (pumping || !Q.length) return;
  const g = ++pumpGen;
  pumping = true;
  raf(() => {
    if (g !== pumpGen) return; // a detach in between (its frame never ran in a test's manual queue)
    pumping = false;
    const j = Q.shift();
    if (j) { try { run(j); } catch (err) { console.error(err); } }
    if (Q.length) pump(); else if (scratch) { scratch.width = 0; scratch.height = 0; } // released when the queue drains
  });
}
function scratchFor(doc, W, H) {
  if (!scratch || scratch.ownerDocument !== doc) scratch = doc.createElement('canvas');
  scratch.width = W; scratch.height = H;
  return scratch;
}
function loadImg(F, cb) { // the markup as an Image (a Blob URL, as 1g), retained for the face's life (windows draw from it)
  if (F.img) { cb(); return; }
  if (F.imgCb) { F.imgCb.push(cb); return; }
  const w = (F.env && F.env.win) || F.wnd || globalThis;
  const Img = (F.env && F.env.Image) || w.Image || globalThis.Image, Bl = (F.env && F.env.Blob) || w.Blob || globalThis.Blob, U = (F.env && F.env.URL) || w.URL || globalThis.URL;
  if (typeof Img !== 'function' || typeof Bl !== 'function' || !U || typeof U.createObjectURL !== 'function') { fail(F, 'no Image / Blob URL'); return; }
  let url = '', img = null;
  try { url = U.createObjectURL(new Bl([F.markup], { type: 'image/svg+xml' })); img = new Img(); } catch (err) { fail(F, err); return; }
  F.imgCb = [cb];
  const done = ok => {
    try { U.revokeObjectURL(url); } catch (err) { /* gone */ }
    img.onload = img.onerror = null;
    const cbs = F.imgCb || []; F.imgCb = null;
    if (F.dead) return;
    if (!ok) { fail(F, 'the SVG did not decode as an image'); return; }
    F.img = img;
    for (const f of cbs) f();
  };
  img.onload = () => done(true);
  img.onerror = () => done(false);
  img.src = url;
}
function fail(F, err) { // no texture for this face while mounted: the 1g tier takes over (a decode failure keeps the SVG there too)
  if (!F.failed) console.warn('cv-face: the face texture could not be made — the DOM face stays', err);
  F.failed = true; unqueue(F);
  sync(F, 'fail');
}
function run(j) {
  const F = j.F;
  if (F.dead || !F.mounted || !GL || LOST || F.failed) return;
  if (j.kind === 'base' && F.base) return;
  if (!F.img) { loadImg(F, () => { if (!F.dead && F.mounted && GL && !LOST) { Q.unshift(j); pump(); } }); return; } // (this frame starts the load)
  const d = dprOf(F), doc = F.doc;
  if (!F.bg) { F.bg = bgOf(F.root, (F.env && F.env.win) || F.wnd); F.bg.faceW = F.w; }
  const t0 = now();
  let W, H, L, win = null;
  if (j.kind === 'base') { L = baseLevel(d, F.w, F.h); W = Math.max(1, Math.round(F.w * L)); H = Math.max(1, Math.round(F.h * L)); }
  else { win = j.win; L = win.L; W = Math.max(1, Math.round(win.w * L)); H = Math.max(1, Math.round(win.h * L)); }
  if (!enforce(texBytes(W, H, !win), F)) return; // an off-screen face over the budget: skipped (re-planned when it comes on)
  const c = scratchFor(doc, W, H), x = c.getContext('2d');
  if (!x) { fail(F, 'no 2D context'); return; }
  fillBg(F.bg, x, W, H, L, win ? win.x : 0, win ? win.y : 0, doc);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  if (win) x.drawImage(F.img, win.x, win.y, win.w, win.h, 0, 0, W, H); else x.drawImage(F.img, 0, 0, W, H);
  let tex = null;
  try { tex = GL.upload(c, { mips: !win }); } catch (err) { tex = null; }
  const ms = now() - t0; S.paints++; S.paintMs += ms; S.paintMax = Math.max(S.paintMax, ms);
  if (!tex) { fail(F, 'upload failed'); return; }
  if (win) { free(F, 'win'); F.win = { tex, x: win.x, y: win.y, w: win.w, h: win.h, L }; } else { free(F, 'base'); F.base = { tex, L }; }
  bytes += tex.bytes || 0;
  sync(F, 'paint'); // (the base landing: 'svg' → 'gl')
  emit();
  if (!win && !BURST) plan(); // a base landed at a rest: its window (a face mounted zoomed in) joins the queue
}
// the budget (§3.4): room for `need` bytes — off-screen faces' windows first, then their bases farthest from the viewport
// centre; the on-screen ones are never evicted, and an off-screen face only evicts faces farther out than itself (no
// thrash between two off-screen faces). False when an off-screen face's paint would still not fit (it is skipped).
function enforce(need, forF) {
  if (bytes + need <= FACE_BUDGET_BYTES) return true;
  const on = onScreen(forF), d0 = on ? -1 : dist2(forF);
  const off = faces.filter(F => !F.dead && F !== forF && F.mounted && !onScreen(F) && (F.win || F.base)).map(F => ({ F, d: dist2(F) })).filter(v => v.d > d0).sort((a, b) => b.d - a.d);
  for (const pass of ['win', 'base']) for (const { F } of off) {
    if (bytes + need <= FACE_BUDGET_BYTES) break;
    if (!F[pass]) continue;
    free(F, pass);
    if (pass === 'base') sync(F, 'evict');
  }
  return bytes + need <= FACE_BUDGET_BYTES || on;
}
/* ---- a rest (cameraend / screen / attach / restored): the missing bases, the windows (§3.3), the queue nearest-first */
function plan(c) {
  if (!GL || !WD || LOST || BURST) return; // (never in a burst: the cameraend clears it first)
  CAM = c ? { tx: +c.tx || 0, ty: +c.ty || 0, k: +c.k || 1 } : (WD.cam ? WD.cam : CAM);
  VP = size();
  const C = cam(), jobs = [], cands = [];
  for (const F of faces) {
    if (F.dead) continue;
    sync(F, 'plan');
    if (!F.mounted) continue;
    const d = dprOf(F), glOk = !!GL && !F.a.folded && !F.overlap && !F.failed;
    if (glOk && !F.base) jobs.push({ F, kind: 'base', dist: dist2(F) });
    const R = faceRect(F);
    if (!glOk || !R || !onScreen(F) || !(C.k > WIN_K0) || !(VP.w > 0 && VP.h > 0)) { if (F.win) { free(F, 'win'); emit(); } continue; }
    const vis = visPart(R, C, VP.w, VP.h), wr = vis ? winRect(R, C, VP.w, VP.h) : null;
    if (!wr) { if (F.win) { free(F, 'win'); emit(); } continue; }
    cands.push({ F, vis, wr, d, dist: dist2(F) });
  }
  let sum = 0;
  for (const c2 of cands) sum += c2.wr.w * c2.wr.h;
  for (const { F, vis, wr, d, dist } of cands) {
    const Lw = winLevelOf(d, C.k, sum, wr.w, wr.h), L0 = F.base ? F.base.L : baseLevel(d, F.w, F.h);
    if (Lw <= L0 + EPS) { if (F.win) { free(F, 'win'); emit(); } continue; } // the base is as fine already
    if (winKeep(F.win, vis, d, C.k)) continue;
    jobs.push({ F, kind: 'win', win: Object.assign({ L: Lw }, wr), dist });
  }
  jobs.sort((a, b) => a.dist - b.dist || (a.kind === 'base' ? -1 : 1) - (b.kind === 'base' ? -1 : 1));
  Q = jobs;
  pump();
}
/* ---- overlap (§3.5): a mounted hardware module intersecting another's rect uses the DOM face while they intersect */
function recheck() {
  const M = faces.filter(F => !F.dead && F.mounted && F.mid != null && !!rectOf(F.mid));
  for (const F of M) {
    const r = rectOf(F.mid);
    const ov = M.some(G => G !== F && G.mid !== F.mid && intersects(r, rectOf(G.mid)));
    if (ov !== F.overlap) { F.overlap = ov; sync(F, 'overlap'); }
  }
}

/* ---------------------------------------------------------------- the api */
export const FACES = {
  /**
   * Registers a hardware face: `deco` the .hw-decor (its first child the SVG built from `markup`, w × h world px);
   * o: { markup, w, h, img? (a decoded Image to draw from, else loaded from the markup), moduleOf() → the .cv-mod ancestor's
   * data-cv-mod (null unmounted), offset() → {x, y} of the deco inside the module (world px; a layout read: called at mount /
   * refresh / a rest only), tip?, tier (the 1g faceTier factory: 'dom' mode and the 2D fallback), env (the tier's / the
   * image's test env) }. @returns {{refresh, drop, destroy, readonly mode, readonly tier, readonly shown}}
   */
  register(deco, o) {
    o = o || {};
    const doc = deco.ownerDocument || globalThis.document, win = (o.env && o.env.win) || (doc && doc.defaultView) || globalThis;
    const F = {
      seq: ++seq, deco, svg: deco.firstChild, root: deco.parentNode || deco, doc, wnd: win, env: o.env || null, markup: String(o.markup || ''), w: +o.w || 1, h: +o.h || 1,
      img: o.img || null, imgCb: null, moduleOf: typeof o.moduleOf === 'function' ? o.moduleOf : () => (modEl(deco) ? modEl(deco).getAttribute('data-cv-mod') : null),
      offset: typeof o.offset === 'function' ? o.offset : () => ({ x: 0, y: BAR_H }), tip: o.tip || null, mkTier: typeof o.tier === 'function' ? o.tier : null,
      el: null, attrEl: null, mid: null, mounted: false, a: null, ox: 0, oy: BAR_H, overlap: false, failed: false, mode: '', tier: null, base: null, win: null, bg: null, mo: null, dead: false,
      q0: { tex: null, x: 0, y: 0, w: 0, h: 0, clip: null, alpha: 1 }, q1: { tex: null, x: 0, y: 0, w: 0, h: 0, clip: null, alpha: 1 }, clip: { x: 0, y: 0, w: 0, h: 0, r: [0, 0, BODY_R, BODY_R] },
    };
    // unmount reaches us through wk.releaseCanvases (cv-module unmount): a 0 × 0 sentinel canvas inside the deco
    let offR = () => {};
    try {
      const s = doc.createElement('canvas');
      s.width = 0; s.height = 0; s.hidden = true; s.className = 'hw-rel'; s.setAttribute('aria-hidden', 'true');
      deco.append(s);
      F.sentinel = s;
      offR = typeof wk.onRelease === 'function' ? wk.onRelease(s, () => sync(F, 'release')) : () => {};
    } catch (err) { /* a stub DOM */ }
    const offS = typeof wk.onRescale === 'function' ? wk.onRescale(deco, () => { sync(F, 'rescale'); }) : () => {}; // (a zoom end: a re-mount at home → here)
    faces.push(F);
    sync(F, 'mount');
    if (WD) recheckLater();
    const api = {
      refresh() { if (F.dead) return; sync(F, 'refresh'); recheck(); if (GL && WD) plan(); },
      drop() { if (F.dead) return; const had = !!(F.base || F.win); free(F, 'base'); free(F, 'win'); unqueue(F); if (F.tier) F.tier.drop(); if (F.mode === 'gl') setMode(F, 'svg'); if (had) emit(); },
      destroy() {
        if (F.dead) return;
        F.dead = true; offS(); offR(); observe(F, null); unqueue(F);
        const had = !!(F.base || F.win) || F.mode === 'gl';
        free(F, 'base'); free(F, 'win'); tierOff(F); F.img = null;
        try { F.svg.style.visibility = ''; } catch (err) { /* inert */ }
        if (F.attrEl) { try { F.attrEl.removeAttribute('data-cv-face'); } catch (err) { /* gone */ } F.attrEl = null; }
        if (F.sentinel) { try { F.sentinel.remove(); } catch (err) { /* gone */ } }
        const i = faces.indexOf(F); if (i >= 0) faces.splice(i, 1);
        if (had) emit();
      },
      /** 'gl' | 'dom' (the 1g tier; its bitmap or, at k ≥ 1, the SVG) | 'svg' */
      get mode() { return F.mode === 'dom' && F.tier && !F.tier.shown ? 'svg' : F.mode; },
      get tier() { return F.tier; },
      /** the SVG is replaced (a texture or the tier's bitmap shows): a data-tip tap hit-tests the SVG for that one point */
      get shown() { return F.mode === 'gl' || !!(F.tier && F.tier.shown); },
      get id() { return F.seq; },
    };
    F.api = api;
    return api;
  },
  /** The GL path: o.gl (cv-gl's §2 surface), o.world (rectOf / on / onScreen / cam / viewport); tests: raf, size, now.
   * A second attach after a detach (the world's context loss / restore) starts from nothing: every texture is gone, the
   * bases are rebuilt lazily (next frame, one per frame, nearest first), the windows at the rest. */
  attach(o) {
    if (GL) this.detach();
    o = o || {};
    ATT = o;
    GL = o.gl || null; WD = o.world || null; LOST = false;
    HOOK = { raf: o.raf, size: o.size, now: o.now, offs: [] };
    if (WD && typeof WD.on === 'function') {
      HOOK.offs.push(WD.on('cameraend', e => { BURST = false; plan(e && e.cam); }));
      HOOK.offs.push(WD.on('screen', () => { recheck(); plan(); }));
      HOOK.offs.push(WD.on('movestart', () => { BURST = true; Q = []; }));
    }
    for (const F of faces) sync(F, 'mount');
    recheck(); plan();
  },
  detach() {
    if (!GL) return;
    for (const f of HOOK.offs) { try { f(); } catch (err) { /* gone */ } }
    Q = []; pumping = false; pumpGen++;
    for (const F of faces) { free(F, 'base'); free(F, 'win'); }
    GL = null; WD = null; HOOK = null; ATT = null; CAM = null; LOST = false; BURST = false;
    if (scratch) { scratch.width = 0; scratch.height = 0; }
    for (const F of faces) sync(F, 'detach');
    emit();
  },
  /** Context loss: every texture is dead (nothing goes through the GL); the faces show their SVG until restored() rebuilds
   * the bases lazily (one per frame, nearest first). */
  lost() {
    LOST = true; Q = [];
    for (const F of faces) { F.base = null; F.win = null; }
    bytes = 0;
    for (const F of faces) sync(F, 'lost');
    emit();
  },
  restored() { LOST = false; recheck(); plan(); },
  /**
   * The quads to draw this frame, in order (the modules' z, then registration): a face's base, then its window at k > 1.
   * Pure over the registry (no DOM read); the array and its quads are reused between frames (the GL draws them at once).
   */
  quads(rectOf2, c) {
    QUAD.length = 0;
    const list = faces.filter(F => !F.dead && F.mode === 'gl' && F.base).sort((a, b) => a.a.z - b.a.z || a.seq - b.seq);
    for (const F of list) {
      const R = typeof rectOf2 === 'function' ? rectOf2(F.mid) : null;
      if (!R) continue;
      const x = R.x + F.a.dx, y = R.y + F.a.dy, cl = F.clip;
      cl.x = x; cl.y = y + BAR_H; cl.w = R.w; cl.h = Math.max(0, R.h - BAR_H);
      const fx = x + F.ox, fy = y + F.oy, q = F.q0;
      q.tex = F.base.tex; q.x = fx; q.y = fy; q.w = F.w; q.h = F.h; q.clip = cl; q.alpha = F.a.alpha;
      QUAD.push(q);
      if (F.win && c && c.k > 1) { const w = F.q1, W2 = F.win; w.tex = W2.tex; w.x = fx + W2.x; w.y = fy + W2.y; w.w = W2.w; w.h = W2.h; w.clip = cl; w.alpha = F.a.alpha; QUAD.push(w); }
    }
    return QUAD;
  },
  onChange(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
  /** The overlap rule and the offsets re-read (a re-mount main.js made without a camera move): a rest-time call. */
  recheck() { for (const F of faces) sync(F, 'refresh'); recheck(); if (GL && WD) plan(); },
  stats(reset) {
    let gl = 0, dom = 0, base = 0, windows = 0;
    for (const F of faces) { if (F.dead) continue; if (F.mode === 'gl') gl++; else if (F.tier) dom++; if (F.base) base++; if (F.win) windows++; }
    const s = { faces: faces.length, gl, dom, bytes, base, windows, paints: S.paints, paintMs: S.paintMs, paintMax: S.paintMax, queued: Q.length };
    if (reset) { S.paints = 0; S.paintMs = 0; S.paintMax = 0; }
    return s;
  },
  get attached() { return !!GL; },
  /** The { gl, world } object attach() was given; null while detached. */
  attachment() { return ATT; },
};
// (integration) the same surface as named exports: cv-world imports the namespace (`import * as FACES`), cv-panel the object
export const register = (deco, o) => FACES.register(deco, o), attach = o => FACES.attach(o), detach = () => FACES.detach(),
  lost = () => FACES.lost(), restored = () => FACES.restored(), quads = (rectOf, cam) => FACES.quads(rectOf, cam),
  onChange = fn => FACES.onChange(fn), stats = reset => FACES.stats(reset), attachment = () => FACES.attachment();
export { recheck };
