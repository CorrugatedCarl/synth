// cv-face.js — the hardware faces as GPU textures (IMPL-1h §3; lane F). A registry of the hardware front panels' static
// art (cv-panel render's .hw-decor: the SVG markup, w × h world px, one per mounted panel) and the texture policy over it:
// a mipmapped base texture at L0 = min(dpr, 3) device px per world px (k ≤ 1) and, above k = 1, a finer window of the
// visible part — both composited by cv-gl under #world, which draws FACES.quads(rectOf, cam) every frame, so nothing of a
// face re-rasters at a zoom end (G1) and a face is never sampled below 1 device px per on-screen px (G2).
// Modes: 'gl' (the textures; the SVG visibility: hidden, no .hw-bm; a folded module keeps it and draws no quad), 'dom' (the 1g
// faceTier: the 2D fallback, a module intersecting any other world item — §3.5; from 'gl' below 100 % only once the tier's
// bitmap shows: the quad stays until then, never the raw SVG), 'svg' (the SVG: at home / the base pending; the tier itself
// shows the SVG at k ≥ 1). data-cv-face on the module = the mode. Rules: no layout read in a burst (the deco's offset measured
// at mount / refresh / a rest), one paint + upload per animation frame at a rest, nearest the viewport centre first, none in a
// burst; one onChange a frame; textures under FACE_BUDGET_BYTES, freed on unmount (wk.releaseCanvases through a 0 × 0 sentinel
// canvas, at once), context loss (FACES.lost) and destroy (G6). The quads sit on the module's own left / top (+ a drag's
// translate3d) and carry the body's dim (alpha / gray: [data-off], a mod drag's .cv-nodest).
// (P, IMPL-P §1.1) The performance presets (visual only): FACES.setPerf('high' | 'medium' | 'low') runs the whole policy at the
// effective ratio dE = min(dpr, TEX_Q[id].R) — High the device's own (= today), Medium ≤ 1.5, Low 1 with no windows (it never
// re-sharpens) — under the preset's budget; applied live: the windows freed and re-planned, every base at a stale level (a preset,
// a device-ratio change through recheck(), the side limit) re-rastered one a frame, nearest first, its old texture drawn until the
// new one lands (never a gl face with its SVG showing); the budget counts every stale base at its new level. Every texture side ≤
// min(TEX_MAX_DIM, cv-gl's maxTex: the context's MAX_TEXTURE_SIZE).
// (P review 2) F1: the budget is decided before anything is freed — an off-screen face that would not fit even with every farther face
// freed is left out of the queue (F.blk: its tier stays, nothing is freed, no re-queue) until a rest finds room: a rack past the budget
// goes idle. F5: a window whose margin the side limit pushed past maxTex shrinks its margin (winFit) instead of being dropped.
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
/** A window raster ≤ WIN_MAX_PX px to start (the same ceiling: a whole CS-80 at level 4 would be 24 M px); no texture side
 * over TEX_MAX_DIM (8192: the smallest MAX_TEXTURE_SIZE the site meets) — the level drops to fit, §8 records the cost. The
 * effective cap (stats().winPx) halves, down to WIN_MIN_PX, whenever a window paint (raster + upload) over PAINT_SLOW_MS
 * would have been bound by the halved cap, and is kept in localStorage WIN_PX_KEY (read at attach; a slow device settles
 * there once). A window over WIN_SPLIT_PX px rasters on one frame and uploads on the next (the scratch waits in between). */
export const WIN_MAX_PX = 16e6, WIN_MIN_PX = 4e6, WIN_SPLIT_PX = 8e6, PAINT_SLOW_MS = 30, WIN_PX_KEY = 'synth.cv.winpx', TEX_MAX_DIM = 8192;
/** A window is only worth its paint when its level beats the base's by WIN_GAIN (at dpr 2: none until k > 0.75 — the base is
 * ≥ 1:1 up to k = 1 anyway); its edges snap to WIN_SNAP world px (face-local) so a rebuilt window keeps the texel phase of the
 * region it shares with the old one (exact when WIN_SNAP · L is whole: the level-4 windows above 100 %). */
export const WIN_GAIN = 1.5, WIN_SNAP = 64;
/** (P, IMPL-P §1.1) The presets' texture policy: R caps the ratio the policy runs at (dE = min(dpr, R); High ∞: the device's own at
 * any dpr — today, the base still ≤ BASE_L_MAX), win: windows at all (Low: none — it never re-sharpens), winBudget: all windows
 * together (device px; Medium 40e6 · (1.5 / 2)²), budget: base + window bytes (the off-screen faces evicted over it). */
export const TEX_Q = Object.freeze({
  high: Object.freeze({ R: Infinity, win: true, winBudget: WIN_BUDGET_PX, budget: FACE_BUDGET_BYTES }),
  medium: Object.freeze({ R: 1.5, win: true, winBudget: 22.5e6, budget: 216e6 }),
  low: Object.freeze({ R: 1, win: false, winBudget: 0, budget: 96e6 }),
});
/** A preset id: 'high' | 'medium' | 'low'; anything else 'high' (every device starts there, IMPL-P §2). */
export const perfId = id => (id === 'medium' || id === 'low' ? id : 'high');
/** The effective ratio the policy runs at: min(the device's (≥ 1), the preset's R). */
export const dEOf = (dpr, id) => Math.min(Math.max(1, +dpr || 1), TEX_Q[perfId(id)].R);
/** The module body's bottom radii (world px; style.css .cv-body) the quads are clipped to. */
export const BODY_R = 12;
/** A powered-off module's body is drawn at this opacity and grayscale (style.css [data-off] > .cv-body); the quads take them as
 * alpha / gray. A mod-cable drag (#world[data-cv-patching="mod"]) dims a module without a destination (.cv-nodest) harder. */
export const OFF_ALPHA = 0.45, OFF_GRAY = 0.7, NODEST_ALPHA = 0.35, NODEST_GRAY = 0.8;

const fin = v => typeof v === 'number' && isFinite(v);
const msNow = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());
const EPS = 1e-6;

/* ---------------------------------------------------------------- the maths (pure, node-tested) */
const sideOf = max => (+max > 0 ? +max : TEX_MAX_DIM); // (P) the texture side limit given (the registry's side(): ≤ TEX_MAX_DIM), else TEX_MAX_DIM
/** The base level for a dpr and a face: min(dpr, BASE_L_MAX), reduced so w·h·L² ≤ BASE_MAX_PX and no side over `max` (P: the
 * side limit in force — min(TEX_MAX_DIM, the context's MAX_TEXTURE_SIZE); default TEX_MAX_DIM). */
export function baseLevel(d, w, h, max) {
  let L = Math.min(BASE_L_MAX, Math.max(1, +d || 1));
  if (w * h * L * L > BASE_MAX_PX) L = Math.sqrt(BASE_MAX_PX / Math.max(1, w * h));
  return Math.min(L, sideOf(max) / Math.max(1, w, h));
}
/** The window level: min(dpr · K_MAX, dpr · WIN_HEAD · k, the budget level √(budget / Σ window world area)); budget (P: the
 * preset's window px) default WIN_BUDGET_PX. */
export function winLevel(d, k, sumArea, budget) {
  const b = sumArea > 0 ? Math.sqrt((fin(budget) ? budget : WIN_BUDGET_PX) / sumArea) : Infinity;
  return Math.min(d * K_MAX, d * WIN_HEAD * k, b);
}
/** One window's level: winLevel, then the raster ceilings (`cap` px — the effective WIN_MAX_PX — and `max` a side, default
 * TEX_MAX_DIM) for its w × h world px. */
export function winLevelOf(d, k, sumArea, w, h, cap, max, budget) {
  return Math.min(winLevel(d, k, sumArea, budget), Math.sqrt((fin(cap) ? cap : winPx) / Math.max(1, w * h)), sideOf(max) / Math.max(1, w, h));
}
/** The visible part of a face rect R (world) in a vw × vh viewport: face-local world px, or null off screen. */
export function visPart(R, cam, vw, vh) {
  const V = visibleRect(cam, vw, vh, 0);
  const x0 = Math.max(R.x, V.x), y0 = Math.max(R.y, V.y), x1 = Math.min(R.x + R.w, V.x + V.w), y1 = Math.min(R.y + R.h, V.y + V.h);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0 - R.x, y: y0 - R.y, w: x1 - x0, h: y1 - y0 };
}
/** The window of a face rect R: the visible part grown by `margin` (default WIN_MARGIN) · the viewport on each side (world px), its
 * edges on the WIN_SNAP stride (face-local: the texel phase survives a rebuild), clipped to the face; face-local; null off screen. */
export function winRect(R, cam, vw, vh, margin) {
  if (!visPart(R, cam, vw, vh)) return null;
  const m = fin(margin) && margin >= 0 ? margin : WIN_MARGIN;
  const V = visibleRect(cam, vw, vh, 0), mx = m * vw / cam.k, my = m * vh / cam.k, S = WIN_SNAP;
  const x0 = Math.max(0, Math.floor((V.x - mx - R.x) / S) * S), y0 = Math.max(0, Math.floor((V.y - my - R.y) / S) * S);
  const x1 = Math.min(R.w, Math.ceil((V.x + V.w + mx - R.x) / S) * S), y1 = Math.min(R.h, Math.ceil((V.y + V.h + my - R.y) / S) * S);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** (R2-F5) The window of a face rect R and its level when the texture side limit `max` may bind (winRect at WIN_MARGIN, then winLevelOf).
 * A window whose 25 % margin pushed a side past `max` used to be dropped (a wide face stuck at 0.67 of 1:1 from 100 % to 190 % on a
 * 4096-texture device): when `max` alone holds the level below what the other limits allow, the margin shrinks — WIN_SHRINK steps
 * toward the visible part — until the level reaches min(that, d · k), the 1:1 of this zoom, or the margin is gone and the level is as
 * high as the side limit lets it. sumArea / cap / budget as winLevelOf's. → { wr, L, free (the level without the side limit), bound
 * (the side limit holds L below free) } or null off screen. */
export const WIN_SHRINK = 5;
export function winFit(R, cam, vw, vh, d, sumArea, cap, max, budget) {
  let wr = winRect(R, cam, vw, vh);
  if (!wr) return null;
  const free = winLevelOf(d, cam.k, sumArea, wr.w, wr.h, cap, Infinity, budget);
  let L = winLevelOf(d, cam.k, sumArea, wr.w, wr.h, cap, max, budget);
  if (L < free - EPS) {
    const want = Math.min(free, d * cam.k);
    for (let i = 1; i <= WIN_SHRINK && L < want - EPS; i++) {
      const w2 = winRect(R, cam, vw, vh, WIN_MARGIN * (1 - i / WIN_SHRINK));
      if (!w2) break;
      wr = w2; L = winLevelOf(d, cam.k, sumArea, wr.w, wr.h, cap, max, budget);
    }
  }
  return { wr, L, free, bound: L < free - EPS };
}
/** (R2-F5) A window the gain rule (WIN_GAIN) would drop is still worth its paint when the side limit is what holds it down and it
 * brings a base that is below 1:1 at this zoom (L0 < d · k) up to 1:1 (or to all the other limits allow). */
export const winOwed = (fit, L0, d, k) => !!fit && fit.bound && L0 < d * k - EPS && fit.L >= Math.min(fit.free, d * k) - EPS && fit.L > L0 + EPS;
/** Is a window ({x, y, w, h, L}, face-local) kept: it still covers the visible part `vis` and its level ≥ min(dpr · k, Lw) —
 * Lw the level the planner would make now, so a window the raster ceilings capped below dpr · k is not remade for a level it
 * cannot get (it is reported `soft` instead). */
export function winKeep(win, vis, d, k, Lw) {
  if (!win || !vis) return false;
  const need = fin(Lw) ? Math.min(d * k, Lw) : d * k;
  return win.L >= need - EPS && vis.x >= win.x - EPS && vis.y >= win.y - EPS && vis.x + vis.w <= win.x + win.w + EPS && vis.y + vis.h <= win.y + win.h + EPS;
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
/** The four stripe bands of .inst.hw.hw-wood from --hw-wood: [from, to] world px of the 14 px period and the colour. */
export const woodBands = w => [[0, 3, mix(w, 0.86, 0)], [3, 7, mix(w, 0.88, 255)], [7, 9, mix(w, 0.74, 0)], [9, 14, w]];
/** The sheen of .inst.hw.hw-wood (style.css: 90deg, rgba(0,0,0,.32) → rgba(255,255,255,.05) at 45 % → rgba(0,0,0,.28)) as
 * CSS composites it — its stops interpolated premultiplied — pre-sampled into SHEEN_N stops per segment for a 2D gradient,
 * which lerps its stops unpremultiplied (the 3-stop gradient was up to 17 levels too light mid-face). [t, grey, alpha] each. */
export const SHEEN_N = 24;
export function sheenStops(n = SHEEN_N) {
  const K = [[0, 0, 0.32], [0.45, 255, 0.05], [1, 0, 0.28]], out = [];
  for (let s = 0; s + 1 < K.length; s++) {
    const [t0, c0, a0] = K[s], [t1, c1, a1] = K[s + 1];
    for (let i = s ? 1 : 0; i <= n; i++) { const f = i / n, a = a0 + (a1 - a0) * f, p = c0 * a0 + (c1 * a1 - c0 * a0) * f; out.push([t0 + (t1 - t0) * f, Math.round(p / a), +a.toFixed(4)]); }
  }
  return out;
}
/** Fills the scratch (W × H device px at level L, its origin at face-local (ox, oy) world px) as the face's background. */
function fillBg(bg, ctx, W, H, L, ox, oy) {
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, W, H);
  if (!bg.wood) return;
  try { // the stripes: a 14 world px period along 177deg (3° off vertical) as rects in a frame rotated about the face's origin
    // (crisp edges; a pattern tile is bilinear-blurred), each run 2 px into the next so no seam shows; then the 90deg sheen
    const P = 14 * L, th = -3 * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), bands = woodBands(bg.wood), OV = 2;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; // the canvas's corners in the stripes' frame
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { const px = x + ox * L, py = y + oy * L, u = c * px + s * py, v = c * py - s * px; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    ctx.save(); ctx.translate(-ox * L, -oy * L); ctx.rotate(th);
    for (let n = Math.floor(v0 / P) - 1, N = Math.ceil(v1 / P); n <= N; n++) for (const [a, b, col] of bands) { ctx.fillStyle = col; ctx.fillRect(u0 - 1, n * P + a * L, u1 - u0 + 2, (b - a) * L + OV); }
    ctx.restore();
    const g = ctx.createLinearGradient(-ox * L, 0, (bg.faceW - ox) * L, 0);
    if (!g || typeof g.addColorStop !== 'function') return; // (a stub context)
    for (const [t, v, a] of sheenStops()) g.addColorStop(t, 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } catch (err) { /* the flat wood colour stays */ }
}

/* ---------------------------------------------------------------- the registry */
const faces = []; // registration order (the z tie-break)
let seq = 0, GL = null, WD = null, HOOK = null, ATT = null, CAM = null, VP = { w: 0, h: 0 }, bytes = 0, scratch = null, LOST = false, BURST = false;
const subs = new Set(), S = { paints: 0, paintMs: 0, paintMax: 0 };
let Q = [], pumping = false, pumpGen = 0, QUAD = []; // the paint queue (one job per frame); the reused quad list
let ORD = [], ordDirty = true; // the drawn faces in order (z, then registration): re-sorted on a registration / mode / z / fold change only
let WEL = null, WMO = null; // #world (the deco's [data-cv-world]) and the observer of its data-cv-patching
let winPx = WIN_MAX_PX, STAGE = null; // the effective window cap (px); a split window's raster waiting in the scratch { j, ms }
let PERF = 'high', TQ = TEX_Q.high; // (P) the preset and its policy (module state: kept through a detach / an attach)
const winOf = () => (ATT && ATT.win) || (WD && WD.viewport && WD.viewport.ownerDocument && WD.viewport.ownerDocument.defaultView) || globalThis;
function winPxRead() { // the persisted cap (clamped); an absent / throwing storage or garbage: the start value
  winPx = WIN_MAX_PX;
  try { const w = winOf(), v = parseFloat(w.localStorage && w.localStorage.getItem(WIN_PX_KEY)); if (fin(v)) winPx = Math.min(WIN_MAX_PX, Math.max(WIN_MIN_PX, v)); } catch (err) { /* no storage */ }
}
function slowPaint(px, ms) { // a window paint over PAINT_SLOW_MS: halve the cap (to the floor) when the halved cap would have bound it
  if (!(ms > PAINT_SLOW_MS) || winPx <= WIN_MIN_PX || px <= winPx / 2) return;
  winPx = Math.max(WIN_MIN_PX, winPx / 2);
  try { const w = winOf(); if (w.localStorage) w.localStorage.setItem(WIN_PX_KEY, String(winPx)); } catch (err) { /* no storage */ }
}
const raf = f => (HOOK && typeof HOOK.raf === 'function' ? HOOK.raf(f) : wk.frame(f));
// onChange: one call a frame however many textures land / windows go / modes change in a task (the world draws per call)
let emDue = false;
const fire = () => { for (const f of [...subs]) { try { f(); } catch (err) { console.error(err); } } };
const emit = () => { if (emDue) return; emDue = true; raf(() => { emDue = false; fire(); }); };
const now = () => (HOOK && typeof HOOK.now === 'function' ? HOOK.now() : msNow());
const dprOf = F => Math.max(1, +((F.env && F.env.win) || F.wnd || {}).devicePixelRatio || 1);
const dE = F => Math.min(dprOf(F), TQ.R); // (P) the ratio the policy runs at for this face
const side = () => { const m = GL ? +GL.maxTex : 0; return m > 0 ? Math.min(TEX_MAX_DIM, m) : TEX_MAX_DIM; }; // (P) every texture side ≤ this
const lvl = F => baseLevel(dE(F), F.w, F.h, side()); // (P) the base level the face should have now
// (P) a stale base (made at another preset / ratio / side limit): re-rastered at a rest unless that level already failed (lvlTry)
const stale = F => !!F.base && Math.abs(F.base.L - lvl(F)) > EPS;
const tried = F => F.lvlTry != null && Math.abs(F.lvlTry - lvl(F)) <= EPS;
const drawable = F => !F.failed && !(F.a && F.a.folded) && !F.overlap; // (plan's glOk: a folded / overlapped / failed face gets no job, §1.1 (c))
// (P) a base's bytes once the queue drains — a stale one that will be re-rastered at its new level: the budget credits the base being
// replaced, so a switch down never evicts a face its own swap would shrink, and a switch up counts the growth
function projB(F) {
  if (!F.base) return 0;
  const b = F.base.tex.bytes || 0;
  if (!stale(F) || tried(F) || !drawable(F)) return b;
  const L = lvl(F);
  return texBytes(Math.max(1, Math.round(F.w * L)), Math.max(1, Math.round(F.h * L)), true);
}
function size() { // the viewport (CSS px): a layout read at a rest only
  if (HOOK && typeof HOOK.size === 'function') { const s = HOOK.size(); return { w: +s.w || 0, h: +s.h || 0 }; }
  const v = WD && WD.viewport;
  if (!v) return { w: 0, h: 0 };
  const w = +v.clientWidth || 0, h = +v.clientHeight || 0;
  if (w > 0 && h > 0) return { w, h };
  try { const r = v.getBoundingClientRect(); return { w: +r.width || 0, h: +r.height || 0 }; } catch (err) { return { w, h }; }
}
const cam = () => CAM || (WD && WD.cam) || { tx: 0, ty: 0, k: 1 };
// mounted and showing: connected, in the world, no [hidden] ancestor (#cvParts at home) — no layout read (as the tier);
// the world element, or null
function worldOf(deco) {
  if (deco.isConnected === false) return null;
  for (let n = deco; n && n.nodeType === 1; n = n.parentNode) { if (n.hasAttribute && n.hasAttribute('hidden')) return null; if (n.hasAttribute && n.hasAttribute('data-cv-world')) return n; }
  return null;
}
const patching = () => !!(WEL && typeof WEL.getAttribute === 'function' && WEL.getAttribute('data-cv-patching') === 'mod'); // (a getAttribute: no layout)
function watchWorld(el, F) { // #world's data-cv-patching (a mod-cable drag): every face's dim re-read
  if (WEL === el) return;
  if (WMO) { try { WMO.disconnect(); } catch (err) { /* gone */ } WMO = null; }
  WEL = el;
  const MO = ((F.env && F.env.win) || F.wnd || globalThis).MutationObserver || globalThis.MutationObserver;
  if (!el || typeof MO !== 'function') return;
  try {
    WMO = new MO(() => { let ch = false; for (const G of faces) if (!G.dead && G.el && attrs(G).vis) ch = true; if (ch) emit(); });
    WMO.observe(el, { attributes: true, attributeFilter: ['data-cv-patching'] });
  } catch (err) { WMO = null; }
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
// the module element's attributes the quads depend on (no layout read): z, fold, power / the patching dim (alpha, gray), the
// live drag offset (translate3d), the committed position (left / top: the world's cached rect lags a drag, cv-module's rect()
// leads it — the style is what the module shows)
function attrs(F) {
  const el = F.el, st = (el && el.style) || {}, has = k => !!(el && el.hasAttribute && el.hasAttribute(k));
  const z = parseFloat(st.zIndex), m = /translate3d\(\s*([-+\d.e]+)px\s*,\s*([-+\d.e]+)px/.exec(st.transform || ''), lx = parseFloat(st.left), ly = parseFloat(st.top);
  const off = has('data-off'), nd = patching() && !!(el && el.classList && el.classList.contains('cv-nodest'));
  const n = { z: fin(z) ? z : 0, folded: has('data-cv-fold'), alpha: nd ? NODEST_ALPHA : off ? OFF_ALPHA : 1, gray: nd ? NODEST_GRAY : off ? OFF_GRAY : 0, dx: m ? +m[1] || 0 : 0, dy: m ? +m[2] || 0 : 0, x: fin(lx) ? lx : null, y: fin(ly) ? ly : null };
  const o = F.a, moved = !!o && (o.x !== n.x || o.y !== n.y), drag = !!o && (o.dx !== n.dx || o.dy !== n.dy), fold = !o || o.folded !== n.folded;
  const vis = !o || o.z !== n.z || o.alpha !== n.alpha || o.gray !== n.gray || drag;
  if (!o || o.z !== n.z || fold) ordDirty = true;
  F.a = n;
  return { moved, drag, vis, fold };
}
function observe(F, el) {
  if (F.mo) { try { F.mo.disconnect(); } catch (err) { /* gone */ } F.mo = null; }
  const MO = ((F.env && F.env.win) || F.wnd || globalThis).MutationObserver || globalThis.MutationObserver;
  if (!el || typeof MO !== 'function') return;
  try {
    F.mo = new MO(() => { // a drag frame (transform), a drop (left / top), z, fold, power, the patching class
      if (F.dead || F.el !== el) return;
      const c = attrs(F);
      if (c.fold) sync(F, 'attrs'); else if (c.vis && !BURST) emit(); // (in a camera burst the world draws every frame anyway)
      if (c.moved || c.drag) recheckLater(); // (the overlap rule follows the drag live)
    });
    F.mo.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'data-cv-fold', 'data-off'] });
  } catch (err) { F.mo = null; }
}
let rcDue = false;
function recheckLater() { if (rcDue) return; rcDue = true; raf(() => { rcDue = false; recheck(); }); }
// (R2-F1) textures left with no camera move or preset change (a module unmounted, a face dropped / destroyed): a face the budget turned
// away (blk) may fit now — one re-plan a frame later (coalesced; none while nothing waits)
let plDue = false;
function freed() {
  if (plDue || !GL || !WD) return;
  let w = false;
  for (const G of faces) if (!G.dead && G.blk) { w = true; break; }
  if (w) { plDue = true; raf(() => { plDue = false; plan(); }); }
}
function free(F, which) {
  const t = F[which];
  if (!t) return;
  F[which] = null;
  if (which === 'base') { ordDirty = true; F.lvlTry = null; }
  bytes -= t.tex.bytes || 0;
  if (GL && typeof GL.free === 'function') { try { GL.free(t.tex); } catch (err) { /* dead context */ } }
  if (bytes < 0) bytes = 0;
}
function unqueue(F, kind) { Q = Q.filter(j => j.F !== F || (kind && j.kind !== kind)); }
function setMode(F, m) {
  // (9b R2a) a gl face's SVG is hidden whatever got there first: a tier destroyed under a held quad (tierOff → drop) shows it, and the mode
  // stays gl — so the rule runs before the no-change return
  if (m === 'gl') { try { if (F.svg.style.visibility !== 'hidden') F.svg.style.visibility = 'hidden'; } catch (err) { /* inert */ } }
  if (F.mode === m && F.attrEl === F.el) return false;
  const was = F.mode;
  F.mode = m; ordDirty = true;
  // the SVG: hidden under a GL face; shown in 'svg' and when the tier takes over from 'gl' at k ≥ 1 (below, the tier's bitmap
  // replaces the quad: the SVG stays hidden — never the raw vector under 1:1; in 'dom' the tier owns the visibility)
  try { if (m === 'gl') F.svg.style.visibility = 'hidden'; else if (m === 'svg' || (was === 'gl' && !(F.tier && F.tier.shown))) F.svg.style.visibility = ''; } catch (err) { /* inert */ }
  if (F.attrEl && F.attrEl !== F.el) { try { F.attrEl.removeAttribute('data-cv-face'); } catch (err) { /* gone */ } }
  F.attrEl = F.el;
  if (F.el) { try { F.el.setAttribute('data-cv-face', m); } catch (err) { /* inert */ } }
  return true;
}
// the 1g tier's zoom (wk.canvasScale: the k at the last zoom end; the test env's scale): at k ≥ 1 it shows the SVG at once
const tierK = F => { try { const s = F.env && typeof F.env.scale === 'function' ? F.env.scale() : wk.canvasScale(F.deco); return +s || 1; } catch (err) { return 1; } };
function tierOn(F) {
  if (F.tier || typeof F.mkTier !== 'function') return;
  const env = Object.assign({}, F.env, { onChange: () => { if (!F.dead && F.tier) sync(F, 'tier'); } }); // (its bitmap landed / its load failed: the held quad goes)
  try { F.tier = F.mkTier(F.deco, F.svg, F.markup, F.w, F.h, env); } catch (err) { console.warn('cv-face: no tier', err); F.tier = null; }
}
function tierOff(F) { if (!F.tier) return; const t = F.tier; F.tier = null; try { t.destroy(); } catch (err) { /* gone */ } }
// the state machine: mounted? → 'gl' (attached, no overlap (or folded: nothing of the body shows), the base landed) | 'svg'
// (the base pending) | 'dom' (the tier; from 'gl' below 100 % only once its bitmap shows: the quad stays until then)
function sync(F, why) {
  if (F.dead) return;
  const mid = F.moduleOf(), el = mid != null ? modEl(F.deco) : null, wel = mid != null && el ? worldOf(F.deco) : null, mounted = !!wel;
  let ch = false;
  if (!mounted) { // at home or detached: the textures go, the tier too; the SVG shows (hidden with its ancestors)
    if (F.el) { observe(F, null); F.el = null; F.a = null; }
    F.mid = null; F.mounted = false; F.failed = false; F.blk = false; unqueue(F);
    const had = !!(F.base || F.win);
    if (had) ch = true;
    free(F, 'base'); free(F, 'win'); tierOff(F);
    if (setMode(F, 'svg')) ch = true;
    if (ch) emit();
    if (had) freed();
    return;
  }
  if (WEL !== wel) watchWorld(wel, F);
  if (F.el !== el) { F.el = el; F.a = null; observe(F, el); F.bg = null; why = 'mount'; }
  F.mid = String(mid); F.mounted = true;
  if (attrs(F).vis) ch = true;
  if (why === 'mount' || why === 'refresh') { // the offset inside the module: a layout read, never in a burst
    let o = null; try { o = F.offset(); } catch (err) { o = null; }
    const ox = o && fin(o.x) ? o.x : 0, oy = o && fin(o.y) ? o.y : BAR_H;
    if (ox !== F.ox || oy !== F.oy) { F.ox = ox; F.oy = oy; ch = true; }
  }
  const glOk = !!GL && !F.failed && (!F.overlap || F.a.folded);
  if (glOk && F.base) { tierOff(F); if (setMode(F, 'gl')) ch = true; if (F.a.folded && F.win) { ch = true; free(F, 'win'); unqueue(F, 'win'); } }
  else if (glOk) { tierOff(F); if (setMode(F, 'svg')) ch = true; if (F.a.folded) unqueue(F); else needBase(F); } // (folded: the base waits for the unfold)
  else {
    if (!GL) { if (F.base || F.win) ch = true; free(F, 'base'); free(F, 'win'); unqueue(F); }
    else { if (F.win) ch = true; free(F, 'win'); unqueue(F, 'win'); }
    tierOn(F);
    const hold = F.mode === 'gl' && !!F.base && !!F.tier && !F.tier.shown && !F.tier.failed && tierK(F) < 1 - 1e-6;
    if (!hold && setMode(F, 'dom')) ch = true;
  }
  if (ch) emit();
}
/* ---- the paint queue: one job (a base or a window) per animation frame at a rest, nearest the viewport centre first */
function needBase(F) {
  if (!GL || LOST || F.base || F.failed || F.blk || Q.some(j => j.F === F && j.kind === 'base')) return; // (R2-F1: blk — no room last asked: it waits for the next plan)
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
    if (BURST) return; // never a paint in a burst: the rest's plan rebuilds the queue
    const j = Q.shift();
    if (j) { try { run(j); } catch (err) { console.error(err); } }
    if (EVD && !BURST && !STAGE) { try { plan(); } catch (err) { console.error(err); } } // (R2-F1) the job freed faces for itself: they ask again, now, for what is left (not between the two frames of a split window: its raster waits in the scratch)
    if (Q.length) pump(); else if (scratch) { scratch.width = 0; scratch.height = 0; } // released when the queue drains
  });
}
function scratchFor(doc, W, H) {
  if (!scratch || scratch.ownerDocument !== doc) scratch = doc.createElement('canvas');
  scratch.width = W; scratch.height = H;
  STAGE = null; // (a staged raster, if any, is gone with the resize: its job rasters again)
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
  if (j.kind === 'base' ? !!F.base && !stale(F) : !F.base) return; // (a window before its base: never — the base's landing plans it; P: a stale base is re-made)
  // (this frame starts the load; the job returns to the queue when it lands — not in a burst: the rest's plan re-adds it)
  if (!F.img) { loadImg(F, () => { if (!F.dead && F.mounted && (!F.base || stale(F)) && GL && !LOST && !BURST) { Q.push(j); pump(); } }); return; }
  const d = dE(F), doc = F.doc, re = j.kind === 'base' && !!F.base; // (P) re: a stale base re-rastered — the old one drawn until the swap
  if (!F.bg) { F.bg = bgOf(F.root, (F.env && F.env.win) || F.wnd); F.bg.faceW = F.w; }
  let W, H, L, win = null, ms = 0, c = null;
  if (j.kind === 'base') { L = baseLevel(d, F.w, F.h, side()); W = Math.max(1, Math.round(F.w * L)); H = Math.max(1, Math.round(F.h * L)); }
  else { win = j.win; L = win.L; W = Math.max(1, Math.round(win.w * L)); H = Math.max(1, Math.round(win.h * L)); }
  if (STAGE && STAGE.j === j) { c = scratch; ms = STAGE.ms; STAGE = null; } // the second frame of a split window: the raster waits in the scratch
  else {
    if (!enforce(texBytes(W, H, !win) - (win ? 0 : projB(F)), F)) { if (!win) F.blk = true; return; } // an off-screen face over the budget: skipped, nothing freed for it (re-planned when room comes — R2-F1: not by itself; P: a stale one keeps its base)
    const t0 = now(), x = (c = scratchFor(doc, W, H)).getContext('2d');
    if (!x) { if (re) { F.lvlTry = L; return; } fail(F, 'no 2D context'); return; }
    fillBg(F.bg, x, W, H, L, win ? win.x : 0, win ? win.y : 0);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (win) x.drawImage(F.img, win.x, win.y, win.w, win.h, 0, 0, W, H); else x.drawImage(F.img, 0, 0, W, H);
    ms = now() - t0;
    if (win && W * H > WIN_SPLIT_PX && !j.split) { j.split = true; STAGE = { j, ms }; Q.unshift(j); return; } // a big window: the upload next frame (one job per frame)
  }
  const t1 = now();
  let tex = null;
  try { tex = GL.upload(c, { mips: !win }); } catch (err) { tex = null; }
  ms += now() - t1; S.paints++; S.paintMs += ms; S.paintMax = Math.max(S.paintMax, ms);
  if (win) slowPaint(W * H, ms);
  if (!tex) {
    if (GL.ready === false) return; // (P) the context went under the upload: the loss path (the world's onLost detaches FACES, the restore re-makes every base) — never a fail
    if (re) { F.lvlTry = L; return; } // (P) a stale re-raster that fails keeps its old base (no fail: still gl) and is not re-queued at this level
    fail(F, 'upload failed'); return;
  }
  if (win) { free(F, 'win'); F.win = { tex, x: win.x, y: win.y, w: win.w, h: win.h, L }; } else { free(F, 'base'); F.base = { tex, L }; ordDirty = true; }
  bytes += tex.bytes || 0;
  sync(F, 'paint'); // (the base landing: 'svg' → 'gl')
  emit();
  if (!win && !BURST) plan(); // a base landed at a rest: its window (a face mounted zoomed in) joins the queue
}
// the budget (§3.4; P: the preset's): room for `need` bytes — off-screen faces' windows first, then their bases farthest from the
// viewport centre; the on-screen ones are never evicted, and an off-screen face only evicts faces farther out than itself (no
// thrash between two off-screen faces). False when an off-screen face's paint would still not fit (it is skipped). (P) Counted
// as the set will be once the queue drains (D: every stale base at its new level, projB) — `need` is net of the job's own.
// (R2-F1) Decided BEFORE anything is freed: the review's thrash was an off-screen face that freed the farther faces one by one and
// then found it still did not fit — they re-queued, fitted again in their own room, landed, and each landing re-planned the face
// that cannot fit, ≈ 7 rasters, uploads and frees a second, forever. pool() is the budget's view of the set: T (bytes as the set will be
// once the queue drains) and the off-screen faces' evictable bytes (a window + a base at its projected level) farthest first with
// running sums, so "would `need` fit if every face farther out than F were freed" (roomFor) is a lookup: the plan uses it to leave
// such a face out of the queue (F.blk: kept in its tier — no job, no frees — until a rest finds room); enforce frees only when it can.
function pool() { // T now (O(faces)); the sorted off-screen list only when a paint does not fit as is (offs)
  let T = bytes;
  for (const F of faces) if (!F.dead && F.base) T += projB(F) - (F.base.tex.bytes || 0);
  return { T, off: null, pre: null };
}
function offs(P) {
  if (P.off) return P;
  const off = [];
  for (const F of faces) if (!F.dead && F.mounted && (F.win || F.base) && !onScreen(F)) off.push({ F, d: dist2(F), b: (F.win ? F.win.tex.bytes || 0 : 0) + (F.base ? projB(F) : 0) });
  off.sort((a, b) => b.d - a.d);
  const pre = [0];
  for (const v of off) pre.push(pre[pre.length - 1] + v.b);
  P.off = off; P.pre = pre;
  return P;
}
function roomFor(P, need, F) { // would `need` bytes fit for F: as the set is, or (off screen) with every face farther out than F freed; an on-screen paint always goes ahead (the soft bound)
  if (P.T + need <= TQ.budget || onScreen(F)) return true;
  const d0 = dist2(F), off = offs(P).off;
  let lo = 0, hi = off.length; // the faces farther than F: a prefix of the far-to-near list
  while (lo < hi) { const m = (lo + hi) >> 1; if (off[m].d > d0) lo = m + 1; else hi = m; }
  return P.T + need - P.pre[lo] <= TQ.budget;
}
// the bytes a base job adds once it lands: its new level's, net of the base it replaces (projB counts a stale one at its new level: 0)
const baseNeed = F => { const L = lvl(F); return texBytes(Math.max(1, Math.round(F.w * L)), Math.max(1, Math.round(F.h * L)), true) - projB(F); };
let EVD = false; // an enforce freed a base: the queue re-plans after the job (the freed faces re-ask; room may be left)
function enforce(need, forF) {
  const B = TQ.budget, P = pool(), on = onScreen(forF);
  if (P.T + need <= B) return true;
  if (!on && !roomFor(P, need, forF)) return false; // (R2-F1) nothing freed for a paint that still would not fit
  const d0 = on ? -1 : dist2(forF), out = [];
  let T = P.T;
  for (const pass of ['win', 'base']) for (const v of offs(P).off) {
    if (T + need <= B) break;
    if (v.F === forF || v.d <= d0 || !v.F[pass]) continue;
    T -= pass === 'win' ? v.F.win.tex.bytes || 0 : projB(v.F);
    out.push([v.F, pass]);
  }
  for (const [F, pass] of out) {
    free(F, pass);
    if (pass === 'base') { F.blk = true; EVD = true; sync(F, 'evict'); } // (it lost its room to a nearer face: it re-asks at the next plan, not by itself)
  }
  return true;
}
/* ---- a rest (cameraend / screen / attach / restored): the missing bases, the windows (§3.3), the queue nearest-first */
function plan(c) {
  if (!GL || !WD || LOST || BURST) return; // (never in a burst: the cameraend clears it first)
  EVD = false;
  CAM = c ? { tx: +c.tx || 0, ty: +c.ty || 0, k: +c.k || 1 } : (WD.cam ? WD.cam : CAM);
  VP = size();
  const C = cam(), jobs = [], cands = [];
  let P = null; // (R2-F1) the budget's view of the set, built when a base job first asks
  for (const F of faces) {
    if (F.dead) continue;
    sync(F, 'plan');
    if (!F.mounted) continue;
    const d = dE(F), glOk = !!GL && !F.failed && !F.a.folded && !F.overlap; // (a folded face: no base, no window — its unfold brings them)
    F.blk = false;
    if (glOk && (!F.base || (stale(F) && !tried(F)))) { // (its window once the base lands: run() plans again; P: a stale level too)
      // (R2-F1) a base that would not fit even with every farther face freed is not queued (and nothing is freed for it): its tier / its stale
      // base stays until a rest finds room — the camera, a screen change, a preset, a free (freed), a landing's own re-plan
      if (onScreen(F) || roomFor(P || (P = pool()), baseNeed(F), F)) jobs.push({ F, kind: 'base', dist: dist2(F) }); else F.blk = true;
      continue;
    }
    const R = faceRect(F);
    if (!glOk || !R || !onScreen(F) || !TQ.win || !(C.k > WIN_K0) || !(VP.w > 0 && VP.h > 0)) { if (F.win) { free(F, 'win'); emit(); } continue; } // (P: Low has none)
    const vis = visPart(R, C, VP.w, VP.h), wr = vis ? winRect(R, C, VP.w, VP.h) : null;
    if (!wr) { if (F.win) { free(F, 'win'); emit(); } continue; }
    cands.push({ F, R, vis, wr, d, dist: dist2(F) });
  }
  let sum = 0;
  for (const c2 of cands) sum += c2.wr.w * c2.wr.h;
  for (const { F, R, vis, d, dist } of cands) {
    const fit = winFit(R, C, VP.w, VP.h, d, sum, undefined, side(), TQ.winBudget), wr = fit.wr, Lw = fit.L, L0 = F.base ? F.base.L : baseLevel(d, F.w, F.h, side()); // (R2-F5: the margin shrunk to fit the side limit, not the window dropped)
    if (Lw <= L0 * WIN_GAIN + EPS && !winOwed(fit, L0, d, C.k)) { if (F.win) { free(F, 'win'); emit(); } continue; } // the base is as fine already (within WIN_GAIN; unless the side limit holds a base below 1:1 and the window brings it there)
    if (winKeep(F.win, vis, d, C.k, Lw)) continue;
    if (F.win && d * C.k <= L0 + EPS) continue; // at or below 1:1 from the base: a window the view left is not remade for coverage (the next rest above k = 1 does)
    jobs.push({ F, kind: 'win', win: Object.assign({ L: Lw }, wr), dist });
  }
  jobs.sort((a, b) => a.dist - b.dist || (a.kind === 'base' ? -1 : 1) - (b.kind === 'base' ? -1 : 1));
  Q = jobs;
  pump();
}
/* ---- overlap (§3.5): a mounted hardware module intersecting any other mounted world item's rect (OUT / FX / Serum / simple /
   mod modules too: in front or behind, its DOM would show through the GL face) uses the DOM face while they intersect. A
   face's rect is live (the committed left / top + a drag's translate3d: the world's cached rect lags a drag), the others'
   the world's cached ones; run at a rest, on 'screen' and once a frame of a module drag — never per camera frame */
function liveRect(F) {
  const r = rectOf(F.mid); if (!r) return null;
  const a = F.a || {};
  return { x: (a.x != null ? a.x : r.x) + (a.dx || 0), y: (a.y != null ? a.y : r.y) + (a.dy || 0), w: r.w, h: r.h };
}
function recheck() {
  const M = faces.filter(F => !F.dead && F.mounted && F.mid != null), live = new Map();
  let ch = false;
  for (const F of M) { if (F.el && attrs(F).vis) ch = true; const r = liveRect(F); if (r) live.set(F.mid, r); } // (the style read now: a drop's left / top before its observer delivers; node has none)
  if (ch) emit();
  const ids = WD && typeof WD.ids === 'function' ? WD.ids() : [...live.keys()];
  for (const F of M) {
    const r = live.get(F.mid);
    if (!r) continue;
    let ov = false;
    for (const id of ids) { const k = String(id); if (k === F.mid) continue; const o = live.get(k) || rectOf(k); if (o && intersects(r, o)) { ov = true; break; } }
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
      el: null, attrEl: null, mid: null, mounted: false, a: null, ox: 0, oy: BAR_H, overlap: false, failed: false, blk: false, mode: '', tier: null, base: null, win: null, bg: null, mo: null, dead: false,
      q0: { tex: null, x: 0, y: 0, w: 0, h: 0, clip: null, alpha: 1, gray: 0 }, q1: { tex: null, x: 0, y: 0, w: 0, h: 0, clip: null, alpha: 1, gray: 0 }, clip: { x: 0, y: 0, w: 0, h: 0, r: [0, 0, BODY_R, BODY_R] },
    };
    // unmount reaches us through wk.releaseCanvases (cv-module unmount): a 0 × 0 sentinel canvas inside the deco. The hook
    // runs while the body is still connected (the element goes home after): the textures go now, the mode follows next
    // frame — at home 'svg'; re-homed into a new module by then (main.js cvKeep, no event) the base is re-made there
    const release = () => {
      if (F.dead) return;
      const had = !!(F.base || F.win);
      free(F, 'base'); free(F, 'win'); unqueue(F);
      if (setMode(F, 'svg') || had) emit();
      raf(() => sync(F, 'release'));
      if (had) freed();
    };
    let offR = () => {};
    try {
      const s = doc.createElement('canvas');
      s.width = 0; s.height = 0; s.hidden = true; s.className = 'hw-rel'; s.setAttribute('aria-hidden', 'true');
      deco.append(s);
      F.sentinel = s;
      offR = typeof wk.onRelease === 'function' ? wk.onRelease(s, release) : () => {};
    } catch (err) { /* a stub DOM */ }
    const offS = typeof wk.onRescale === 'function' ? wk.onRescale(deco, () => { sync(F, 'rescale'); }) : () => {}; // (a zoom end: a re-mount at home → here)
    faces.push(F);
    sync(F, 'mount');
    if (WD) recheckLater();
    const api = {
      refresh() { if (F.dead) return; sync(F, 'refresh'); recheck(); if (GL && WD) plan(); },
      drop() { if (F.dead) return; const had = !!(F.base || F.win); free(F, 'base'); free(F, 'win'); unqueue(F); if (F.tier) F.tier.drop(); if (F.mode === 'gl') setMode(F, 'svg'); if (had) { emit(); freed(); } },
      destroy() {
        if (F.dead) return;
        F.dead = true; offS(); offR(); observe(F, null); unqueue(F);
        const had = !!(F.base || F.win) || F.mode === 'gl';
        free(F, 'base'); free(F, 'win'); tierOff(F); F.img = null;
        try { F.svg.style.visibility = ''; } catch (err) { /* inert */ }
        if (F.attrEl) { try { F.attrEl.removeAttribute('data-cv-face'); } catch (err) { /* gone */ } F.attrEl = null; }
        if (F.sentinel) { try { F.sentinel.remove(); } catch (err) { /* gone */ } }
        const i = faces.indexOf(F); if (i >= 0) faces.splice(i, 1);
        if (had) { emit(); freed(); }
      },
      /** 'gl' | 'dom' (the 1g tier: its bitmap below 100 %, the SVG at / above — `shown` tells) | 'svg'; = data-cv-face */
      get mode() { return F.mode; },
      get tier() { return F.tier; },
      /** the SVG is replaced (a texture or the tier's bitmap shows): a data-tip tap hit-tests the SVG for that one point */
      get shown() { return F.mode === 'gl' || !!(F.tier && F.tier.shown); },
      get id() { return F.seq; },
    };
    F.api = api;
    return api;
  },
  /** The GL path: o.gl (cv-gl's §2 surface), o.world (rectOf / on / onScreen / cam / viewport), o.win (the window whose
   * localStorage keeps the window cap; else the viewport's); tests: raf, size, now.
   * A second attach after a detach (the world's context loss / restore) starts from nothing: every texture is gone, the
   * bases are rebuilt lazily (next frame, one per frame, nearest first), the windows at the rest. */
  attach(o) {
    if (GL) this.detach();
    o = o || {};
    ATT = o;
    GL = o.gl || null; WD = o.world || null; LOST = false; emDue = false; rcDue = false; plDue = false; // (a frame queue dropped between: nothing owed)
    HOOK = { raf: o.raf, size: o.size, now: o.now, offs: [] };
    winPxRead(); // (o.win, else the viewport's window: the persisted window cap)
    if (WD && typeof WD.on === 'function') {
      HOOK.offs.push(WD.on('cameraend', e => { BURST = false; recheck(); plan(e && e.cam); })); // (a drop inside an edge pan: the overlap at its rest)
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
    for (const F of faces) { free(F, 'base'); free(F, 'win'); F.blk = false; }
    GL = null; WD = null; HOOK = null; ATT = null; CAM = null; LOST = false; BURST = false; STAGE = null; EVD = false;
    if (scratch) { scratch.width = 0; scratch.height = 0; }
    for (const F of faces) sync(F, 'detach');
    emDue = false; rcDue = false; plDue = false; emit();
  },
  /** Context loss: every texture is dead (nothing goes through the GL); the faces show their SVG until restored() rebuilds
   * the bases lazily (one per frame, nearest first). */
  lost() {
    LOST = true; Q = [];
    for (const F of faces) { F.base = null; F.win = null; F.lvlTry = null; F.blk = false; }
    EVD = false;
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
    if (ordDirty) { ordDirty = false; ORD = faces.filter(F => !F.dead && F.mode === 'gl' && !!F.base && !(F.a && F.a.folded)).sort((a, b) => a.a.z - b.a.z || a.seq - b.seq); }
    for (const F of ORD) {
      const R = typeof rectOf2 === 'function' ? rectOf2(F.mid) : null;
      if (!R) continue;
      const a = F.a, x = (a.x != null ? a.x : R.x) + a.dx, y = (a.y != null ? a.y : R.y) + a.dy, cl = F.clip; // (the module's own left / top: a drag's recache never doubles the delta)
      cl.x = x; cl.y = y + BAR_H; cl.w = R.w; cl.h = Math.max(0, R.h - BAR_H);
      const fx = x + F.ox, fy = y + F.oy, q = F.q0;
      q.tex = F.base.tex; q.x = fx; q.y = fy; q.w = F.w; q.h = F.h; q.clip = cl; q.alpha = a.alpha; q.gray = a.gray;
      QUAD.push(q);
      if (F.win && c && c.k > 1) { const w = F.q1, W2 = F.win; w.tex = W2.tex; w.x = fx + W2.x; w.y = fy + W2.y; w.w = W2.w; w.h = W2.h; w.clip = cl; w.alpha = a.alpha; w.gray = a.gray; QUAD.push(w); }
    }
    return QUAD;
  },
  onChange(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
  /** The overlap rule and the offsets re-read (a re-mount main.js made without a camera move): a rest-time call. */
  recheck() { for (const F of faces) sync(F, 'refresh'); recheck(); if (GL && WD) plan(); },
  /** + soft: windows sampled below 1:1 at the current camera (L < dE · k: the raster ceilings), softMin their worst L / (dE · k)
   * (1 when none); winPx the effective window cap. (P) perf, dE (the effective ratio), budget (bytes), texSide (the side limit);
   * under / underMin: textures below the screen's own 1:1 (Medium / Low by design; a window at L < dpr · k, a base at
   * L < dpr · min(k, 1); R2-F5: above k = 1 an on-screen base with no window is held to L < dpr · k — what the screen shows) and
   * their worst ratio (1 when none). */
  stats(reset) {
    let gl = 0, dom = 0, base = 0, windows = 0, soft = 0, softMin = 1, under = 0, underMin = 1;
    const k = cam().k, low = r => { if (r < 1 - EPS) { under++; underMin = Math.min(underMin, r); } };
    for (const F of faces) {
      if (F.dead) continue;
      if (F.mode === 'gl') gl++; else if (F.tier) dom++;
      // (R2-F5) a base drawn above k = 1 with no window is what the screen shows: L < dpr · k counts (the side limit that dropped
      // the window, a viewport too wide for any, Low / Medium by design) — only a face the world shows (gl, unfolded, on screen)
      if (F.base) { base++; low(F.base.L / (dprOf(F) * (!F.win && k > 1 + EPS && F.mode === 'gl' && !(F.a && F.a.folded) && onScreen(F) ? k : Math.min(k, 1)))); }
      if (F.win) { windows++; const r = F.win.L / (dE(F) * k); if (r < 1 - EPS) { soft++; softMin = Math.min(softMin, r); } low(F.win.L / (dprOf(F) * k)); }
    }
    const F0 = faces.find(F => !F.dead), w0 = winOf();
    const s = { faces: faces.length, gl, dom, bytes, base, windows, soft, softMin, winPx, paints: S.paints, paintMs: S.paintMs, paintMax: S.paintMax, queued: Q.length,
      perf: PERF, dE: F0 ? dE(F0) : dEOf(w0 && w0.devicePixelRatio, PERF), budget: TQ.budget, texSide: side(), under, underMin };
    if (reset) { S.paints = 0; S.paintMs = 0; S.paintMax = 0; }
    return s;
  },
  /**
   * (P, IMPL-P §1.1) The preset, live: 'high' | 'medium' | 'low' (else 'high'). The windows go (Low: for good; else re-planned at
   * the new level), the budget becomes the preset's, and the rest's plan queues every mounted, drawable face whose base is at a
   * stale level — one a frame, nearest the viewport centre first, none in a burst; its old texture drawn until the new one lands
   * (still gl, the SVG hidden). A folded / overlapped / failed face keeps its stale base until drawable (then its first rest).
   * Detached: taken by the next attach. @returns {boolean} changed
   */
  setPerf(id) {
    const p = perfId(id);
    if (p === PERF) return false;
    PERF = p; TQ = TEX_Q[p];
    for (const F of faces) { F.lvlTry = null; F.blk = false; } // (the budget changed: every face asks again)
    if (!GL || !WD || LOST) return true;
    let ch = false;
    STAGE = null;
    for (const F of faces) if (F.win) { free(F, 'win'); unqueue(F, 'win'); ch = true; }
    if (ch) emit();
    if (BURST) Q = []; else plan(); // (in a burst: the rest's plan)
    return true;
  },
  /** (P) the preset in force */
  get perf() { return PERF; },
  get attached() { return !!GL; },
  /** The { gl, world } object attach() was given; null while detached. */
  attachment() { return ATT; },
};
// (integration) the same surface as named exports: cv-world imports the namespace (`import * as FACES`), cv-panel the object
export const register = (deco, o) => FACES.register(deco, o), attach = o => FACES.attach(o), detach = () => FACES.detach(),
  lost = () => FACES.lost(), restored = () => FACES.restored(), quads = (rectOf, cam) => FACES.quads(rectOf, cam),
  onChange = fn => FACES.onChange(fn), stats = reset => FACES.stats(reset), attachment = () => FACES.attachment(), setPerf = id => FACES.setPerf(id);
export { recheck };
