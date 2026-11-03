// (AUTO, IMPL-AUTO §5) The roll's automation lane: the strip's chooser chip (its corner) and one curve at a time in place of the
// velocity lane — host.autoLane(t) names it ('vel': the velocity lane as before; a host without autoLane: the roll at ⟨B⟩). Every
// edit is one host.autoEdit(t, key, 'Automation: <short>', fn): fn gets a copy of the points and returns the new ones, the host
// records History. A drag previews on the gesture's own copy (g.apts) and commits at the release — a second finger (a pinch)
// drops the preview, so two fingers never edit. Points are [tick, v] sorted, one per tick, v in the control's own domain
// (autoRange's lo…hi). Functions of the PianoRoll (R): roll.js calls them from its region, pointer, scene and overlay paths.
import { snapTick } from './song.js?v=9';

const FONT = "'JetBrains Mono', ui-monospace, Menlo, monospace", F11 = `600 11px ${FONT}`, F10 = `10px ${FONT}`, BG = '#0c0d0f', TEXT = '#e9e7e2', MUTE = '#8d8b86', ACC = '#f2a33a';
// PAD: the curve's inset in the strip (a dot's radius + 3); reach (px) of a point / a segment per pointer kind; the time
// hysteresis of a point drag (touch: a sideways move this far before time follows, so a value drag keeps its tick); LONG: a
// held point is deleted (touch / pen), as the grid's chord hold
const PAD = 7, RP = { touch: 16, pen: 9, mouse: 6 }, RS = { touch: 14, pen: 8, mouse: 5 }, DT_ON = { touch: 10, pen: 6, mouse: 4 }, LONG = 500;
export const TYPES = new Set(['apt', 'aseg', 'apend']);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** (P0M lands S.autoAt; swap at merge) The curve's value at `tick` (IMPL-AUTO §2.3): no points → undefined; before the first
 * its value, after the last the last's; between, linear; a binary search. */
export function autoAt(pts, tick) {
  const n = pts ? pts.length : 0;
  if (!n) return undefined;
  if (!(tick > pts[0][0])) return pts[0][1];
  if (tick >= pts[n - 1][0]) return pts[n - 1][1];
  let lo = 0, hi = n - 1; // (pts[lo][0] ≤ tick < pts[hi][0])
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= tick) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi];
  return a[1] + (b[1] - a[1]) * (tick - a[0]) / (b[0] - a[0]);
}
// the first index whose tick is ≥ t
const lower = (P, t) => { let lo = 0, hi = P.length; while (lo < hi) { const m = (lo + hi) >> 1; if (P[m][0] < t) lo = m + 1; else hi = m; } return lo; };
// sorted, integer ticks ≥ 0, one point per tick (the last wins), finite values only
function norm(P) {
  const L = (Array.isArray(P) ? P : []).filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map(p => [Math.max(0, Math.round(+p[0])), +p[1]]);
  L.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of L) { if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p; else out.push(p); }
  return out;
}
// a point set at tick t (replacing one there) / removed from a copy
const put = (P, t, v) => { const i = lower(P, t); if (i < P.length && P[i][0] === t) P[i] = [t, v]; else P.splice(i, 0, [t, v]); return P; };
const cut = (P, t) => { const i = lower(P, t); if (i < P.length && P[i][0] === t) P.splice(i, 1); return P; };

/* ---------------------------------------------------------- the lane */
export const on = R => typeof R.host.autoLane === 'function';
// the shown lane's key: 'vel' (the velocity lane) unless the host names one
export function key(R) {
  if (!on(R)) return 'vel';
  const tr = R.host.getTrack(), k = tr ? R.host.autoLane(tr) : 'vel';
  return typeof k === 'string' && k && k !== 'vel' ? k : 'vel';
}
// the shown automation lane (null: the velocity lane): its track, key, labels, range and points; ok false for a key with no
// control (inert, or no usable range): drawn greyed, never edited
export function lane(R) {
  const k = key(R);
  if (k === 'vel') return null;
  const h = R.host, tr = h.getTrack(), lab = (h.autoLabel && h.autoLabel(tr, k)) || {}, rg = (h.autoRange && h.autoRange(tr, k)) || {};
  const lo = +rg.lo, hi = +rg.hi, L = h.autoLanes ? h.autoLanes(tr) : null, e = Array.isArray(L) ? L.find(x => x && x.key === k) : null;
  const ok = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && !(e && e.inert), pts = h.autoPts ? h.autoPts(tr, k) : null;
  return { tr, key: k, short: String(lab.short || k), long: String(lab.long || lab.short || k), lo: ok ? lo : 0, hi: ok ? hi : 1, ok, pts: Array.isArray(pts) ? pts : [] };
}
const pts = (R, L) => (R.g && R.g.apts) || L.pts;
// value ↔ y in the strip (R.vt its top, R.H its bottom); y2a rounds to 1e-4 of the range (IMPL-AUTO §2.1) and clamps
export const a2y = (R, L, v) => R.vt + PAD + (1 - (v - L.lo) / (L.hi - L.lo)) * (R.H - R.vt - 2 * PAD);
const raw = (R, L, y) => L.lo + (1 - (y - R.vt - PAD) / (R.H - R.vt - 2 * PAD)) * (L.hi - L.lo);
const q = (L, v) => { const s = (L.hi - L.lo) * 1e-4; return clamp(+(L.lo + Math.round((v - L.lo) / s) * s).toPrecision(12), L.lo, L.hi); };
export const y2a = (R, L, y) => q(L, raw(R, L, y));
// the family's formatter, the last one kept (the readout draws every frame: a still playhead asks for no string)
export function fmt(R, L, v) {
  if (v === undefined || !Number.isFinite(v)) return '';
  if (R.afk === L.key && R.afv === v && R.aft === L.tr) return R.afs;
  let s;
  try { s = String(R.host.autoFmt ? R.host.autoFmt(L.tr, L.key, v) : +v.toFixed(3)); } catch { s = String(+v.toFixed(3)); }
  R.afk = L.key; R.afv = v; R.aft = L.tr; R.afs = s;
  return s;
}

/* ---------------------------------------------------------- hits */
// the point under (x, y) — the nearest within reach — else the segment (between two points, off both, near the line): { kind:
// 'pt' | 'seg', i, t } | null
export function hit(R, L, x, y, pk) {
  const P = pts(R, L), r = RP[pk] || RP.mouse, rs = RS[pk] || RS.mouse;
  if (!L.ok || !P.length) return null;
  let best = null, bd = Infinity;
  for (let i = lower(P, R.x2t(x - r)); i < P.length; i++) {
    const px = R.t2x(P[i][0]);
    if (px > x + r) break;
    const d = Math.hypot(px - x, a2y(R, L, P[i][1]) - y);
    if (d <= r && d <= bd) { bd = d; best = { kind: 'pt', i, t: P[i][0] }; }
  }
  if (best) return best;
  const i = lower(P, R.x2t(x) + 1e-9) - 1;
  if (i < 0 || i >= P.length - 1) return null;
  const xa = R.t2x(P[i][0]), xb = R.t2x(P[i + 1][0]);
  if (x - xa < r || xb - x < r) return null;
  const ly = a2y(R, L, P[i][1] + (P[i + 1][1] - P[i][1]) * (x - xa) / (xb - xa));
  return Math.abs(y - ly) <= rs ? { kind: 'seg', i, t: P[i][0] } : null;
}
// a press's double-tap target: the point's tick, else the lane
export function tgt(R, x, y, pk) { const L = R.al = lane(R), h = L && hit(R, L, x, y, pk); return h && h.kind === 'pt' ? 'ap' + h.t : 'auto'; }
// the cursor over the lane (a mouse / a hovering pen)
export function hover(R, hv, x, y, pk) {
  const L = R.al;
  hv.t = Math.max(0, R.x2t(x)); hv.ahit = L ? hit(R, L, x, y, pk === 'pen' ? 'pen' : 'mouse') : null;
  return !L || !L.ok ? 'default' : hv.ahit ? (hv.ahit.kind === 'pt' ? 'move' : 'ns-resize') : 'crosshair';
}

/* ---------------------------------------------------------- edits */
// one History step: the host's autoEdit with the lane's label; fn maps a copy of the points
function edit(R, tr, k, short, fn) {
  R.host.autoEdit(tr, k, 'Automation: ' + short, P => norm(fn(norm(P))));
  R.render();
}
// a point selected (the note selection cleared: Delete has one meaning)
function select(R, t) { R.asel = t; if (R.sel.size) { R.sel.clear(); R._notify(); } }
function del(R, L, t) { if (R.asel === t) R.asel = null; edit(R, L.tr, L.key, L.short, P => cut(P, t)); }
// Delete / Backspace (main's key → roll.deleteSelected): the selected point → 1, else 0 (nothing selected, or it is gone)
export function delSel(R) {
  const L = lane(R), t = R.asel;
  if (!L || !L.ok || t == null) return 0;
  if (lower(L.pts, t) >= L.pts.length || L.pts[lower(L.pts, t)][0] !== t) { R.asel = null; R._view(); return 0; }
  del(R, L, t);
  return 1;
}

/* ---------------------------------------------------------- gestures */
export function down(R, g, x, y, dbl) {
  const L = R.al = lane(R), pk = g.touch ? 'touch' : g.pen ? 'pen' : 'mouse';
  if (!L || !L.ok) { g.type = 'none'; return; }
  g.lane = L; g.pk = pk;
  const h = hit(R, L, x, y, pk);
  if (h && h.kind === 'pt') {
    if (dbl) { g.type = 'none'; del(R, L, h.t); return; }
    select(R, h.t);
    g.type = 'apt'; g.i = h.i; g.p0 = L.pts[h.i].slice(); g.dx0 = h.t - R.x2t(x); g.dy0 = a2y(R, L, g.p0[1]) - y; g.av = g.p0[1];
    // a finger / pen held still on a point deletes it (the ring shows the hold)
    if (g.touch || g.pen) g.timer = setTimeout(() => { if (R.g === g && !g.moved) { g.type = 'none'; g.lp = now(); R.lastTap = null; del(R, L, g.p0[0]); } }, LONG);
    R._cursor('move');
  } else if (h) {
    g.type = 'aseg'; g.i = h.i; g.a0 = L.pts[h.i].slice(); g.b0 = L.pts[h.i + 1].slice(); g.r0 = raw(R, L, y); g.av = autoAt(L.pts, R.x2t(x));
    R._cursor('ns-resize');
  } else { g.type = 'apend'; g.av = y2a(R, L, y); R._cursor('crosshair'); }
  R._view();
}
export function apply(R) {
  const g = R.g, L = g.lane, P = L.pts;
  if (g.type === 'apend') {
    if (!g.moved) { g.av = y2a(R, L, g.y); R._req(); return; }
    // a drag off every point: a finger scrolls time (the lane scrolls with the grid), a mouse does nothing
    if (g.touch) { R._panStart(g); g.xonly = true; R._apply(); } else g.type = 'none';
    return;
  }
  if (!g.moved) return;
  if (g.type === 'apt') {
    const i = g.i, snap = g.sh ? 0 : R._snap(), rt = R.x2t(g.x) + g.dx0;
    if (!g.dtOn && Math.abs(g.x - g.x0) >= DT_ON[g.pk]) g.dtOn = true;
    let t = g.p0[0];
    if (g.dtOn) t = Math.max(0, snap ? snapTick(rt, snap) : Math.round(rt));
    t = clamp(t, i > 0 ? P[i - 1][0] + 1 : 0, i < P.length - 1 ? P[i + 1][0] - 1 : Infinity); // (never past a neighbour)
    const v = y2a(R, L, g.y + g.dy0), A = P.slice();
    A[i] = [t, v]; g.apts = A; g.av = v; R.asel = t;
  } else if (g.type === 'aseg') {
    const dv = raw(R, L, g.y) - g.r0, A = P.slice(), a = q(L, g.a0[1] + dv), b = q(L, g.b0[1] + dv);
    A[g.i] = [g.a0[0], a]; A[g.i + 1] = [g.b0[0], b]; g.apts = A; g.av = autoAt(A, R.x2t(g.x));
  }
  R._view();
}
// the gesture's end: a click / drag commits (one autoEdit); an abort (a second finger, pointercancel) drops the preview
export function finish(R, g, click, abort) {
  const L = g.lane, A = g.apts;
  g.apts = null;
  if (abort || !L) { if (g.type === 'apt' && A) R.asel = g.p0[0]; R._view(); return; }
  if (g.type === 'apt' && A && g.moved) {
    const [t, v] = A[g.i], [t0, v0] = g.p0;
    if (t !== t0 || v !== v0) edit(R, L.tr, L.key, L.short, P => put(cut(P, t0), t, v));
    R.asel = t;
  } else if (g.type === 'aseg' && A && g.moved) {
    const a = A[g.i], b = A[g.i + 1];
    if (a[1] !== g.a0[1] || b[1] !== g.b0[1]) edit(R, L.tr, L.key, L.short, P => { for (const [t, v] of [a, b]) { const i = lower(P, t); if (i < P.length && P[i][0] === t) P[i] = [t, v]; } return P; });
  } else if (g.type === 'apend' && click && !g.moved) {
    const snap = g.sh ? 0 : R._snap(), t0 = Math.max(0, R.x2t(g.x0)), t = Math.max(0, snap ? snapTick(t0, snap) : Math.round(t0)), v = y2a(R, L, g.y0);
    select(R, t);
    edit(R, L.tr, L.key, L.short, P => put(P, t, v));
  }
  R._view();
}
// the readout drawn in the lane: the value under the finger while dragging, else the heard value at the playhead
export function readout(R) {
  const L = R.al, g = R.g;
  if (!L || !L.ok) return '';
  if (g && TYPES.has(g.type) && g.av !== undefined) return fmt(R, L, g.av);
  return fmt(R, L, autoAt(L.pts, R.ph));
}

/* ---------------------------------------------------------- the chooser */
// the corner chip (roll px): the strip's corner less a 4 px margin; ≥ 44 px tall on touch
export function chip(R) { const t = R._touch(); return { x: 4, y: R.vt + 4, w: R.gut - 9, h: t ? 44 : 20 }; }
// "▾ Vel" / "▾ <short>", fitted to the chip (10 px, then 9 px, then cut with an ellipsis): { text, font, tw }
export function chipText(R, c) {
  const L = R.al, s = '▾ ' + (L ? L.short : 'Vel'), C = chip(R), room = C.w - 10;
  for (const px of [10, 9]) { c.font = `600 ${px}px ${FONT}`; const tw = c.measureText(s).width; if (tw <= room) return { text: s, font: c.font, tw }; }
  let n = s.length - 1, t = s;
  for (; n > 3; n--) { t = s.slice(0, n) + '…'; if (c.measureText(t).width <= room) break; }
  return { text: t, font: c.font, tw: c.measureText(t).width };
}
export function drawChip(R, c, tint) {
  const C = chip(R), T = R.chipT = chipText(R, c), L = R.al;
  c.beginPath(); rr(c, C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1, 5);
  c.fillStyle = L ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.045)'; c.fill();
  c.lineWidth = 1; c.strokeStyle = L ? tint : 'rgba(255,255,255,0.16)'; c.stroke();
  c.font = T.font; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = L && !L.ok ? MUTE : TEXT;
  c.fillText(T.text, C.x + 5, C.y + C.h / 2 + 0.5);
}
// the chooser (host.menu(items, x, y): the wk context-menu items, x / y client px under the chip): Velocity, the track's
// automated keys (inert ones greyed, each with a Delete), a separator, Add… — every automatable control, grouped by module
export function menu(R) {
  const h = R.host, tr = h.getTrack();
  if (!on(R) || !tr || typeof h.menu !== 'function') return false;
  const cur = key(R), set = k => () => { if (R.dead) return; h.setAutoLane(tr, k); R.asel = null; R.render(); };
  const items = [{ label: 'Velocity', checked: cur === 'vel', action: set('vel') }], has = new Set();
  for (const e of (h.autoLanes && h.autoLanes(tr)) || []) {
    if (!e || typeof e.key !== 'string') continue;
    has.add(e.key);
    const long = String(e.long || e.short || e.key), short = String(e.short || e.key);
    if (e.inert) items.push({ label: long + ' (no such control)', disabled: true }, { label: 'Delete ' + short + ' automation', action: () => { if (R.asel != null && cur === e.key) R.asel = null; edit(R, tr, e.key, short, () => []); } });
    else items.push({ label: long, checked: cur === e.key, action: set(e.key) });
  }
  if (cur !== 'vel' && !has.has(cur)) { const L = lane(R); items.push({ label: L.long, checked: true, action: set(cur) }); } // (a lane just added: no points yet)
  const groups = new Map();
  for (const e of (h.autoOkList && h.autoOkList(tr)) || []) {
    if (!e || typeof e.key !== 'string' || has.has(e.key)) continue;
    const gname = String(e.group || 'Controls');
    if (!groups.has(gname)) groups.set(gname, []);
    groups.get(gname).push({ label: String(e.short || e.key), action: set(e.key) });
  }
  const subs = [...groups].map(([label, sub]) => ({ label, sub }));
  items.push({ sep: true }, subs.length ? { label: 'Add…', sub: subs.length === 1 ? subs[0].sub : subs } : { label: 'Add…', disabled: true });
  const r = R.el.getBoundingClientRect(), C = chip(R);
  h.menu(items, r.left + C.x, r.top + C.y + C.h);
  return true;
}

/* ---------------------------------------------------------- drawing */
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
// the curve (the scene; the strip clipped by the caller): a faint fill under it, 1.5 px segments, flat before the first point and
// after the last, the points as 8 px dots in the track's tint (only while they stand ≥ 6 px apart: a recorded take is a line), the
// selected point white; R.adraw: what was drawn (tests)
export function drawLane(R, c, L, pal) {
  const P = pts(R, L), G = R.gut, W = R.W, x0 = R.x2t(G), x1 = R.x2t(W), out = R.adraw = { dots: 0, segs: 0, col: pal.head, ok: L.ok };
  if (!P.length) {
    c.font = `11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = MUTE; // ((fix round) ≥ 4.5 : 1 on the lane
    c.fillText(!L.ok ? 'No such control' : R.coarse ? 'Tap to add a point' : 'Click to add a point', G + R.gw / 2, (R.vt + R.H) / 2);
    return;
  }
  const a = Math.max(0, lower(P, x0) - 1), b = Math.min(P.length, lower(P, x1) + 1);
  c.globalAlpha = L.ok ? (L.tr && L.tr.mute ? 0.5 : 1) : 0.35;
  c.beginPath(); c.moveTo(G - 2, a2y(R, L, P[a][1])); // (flat before the first point in view)
  let px = -1e9;
  for (let i = a; i < b; i++) { const x = R.t2x(P[i][0]); c.lineTo(x, a2y(R, L, P[i][1])); out.segs++; px = x; }
  c.lineTo(W + 2, a2y(R, L, P[b - 1][1]));
  c.lineWidth = 1.5; c.strokeStyle = pal.head; c.lineJoin = 'round'; c.stroke();
  c.lineTo(W + 2, R.H); c.lineTo(G - 2, R.H); c.closePath(); c.fillStyle = `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},0.1)`; c.fill();
  if (px > -1e9 && (b - a) * 6 <= R.gw + 12) {
    c.beginPath();
    for (let i = a; i < b; i++) { if (P[i][0] === R.asel) continue; const x = R.t2x(P[i][0]), y = a2y(R, L, P[i][1]); c.moveTo(x + 4, y); c.arc(x, y, 4, 0, Math.PI * 2); out.dots++; }
    c.fillStyle = pal.head; c.fill(); c.lineWidth = 1; c.strokeStyle = BG; c.stroke();
    const k = R.asel == null ? -1 : lower(P, R.asel);
    if (k >= a && k < b && P[k][0] === R.asel) { const x = R.t2x(P[k][0]), y = a2y(R, L, P[k][1]); c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = pal.head; c.stroke(); out.dots++; out.sel = 1; }
  }
  c.globalAlpha = 1;
}
// the frame's part (the strip clipped by the caller): the hovered point's ring, the heard value as a lit dot on the playhead, the
// readout at the lane's top-left (the value, then the control's long name, muted); R.aread: its box (roll px; tests)
export function overlay(R, c, L, pal) {
  const P = pts(R, L), g = R.g, hv = R.hover;
  if (hv && !g && hv.reg === 'auto' && hv.ahit && hv.ahit.kind === 'pt' && P[hv.ahit.i]) {
    const p = P[hv.ahit.i]; c.beginPath(); c.arc(R.t2x(p[0]), a2y(R, L, p[1]), 7, 0, Math.PI * 2); c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.6)'; c.stroke();
  }
  if (hv && !g && hv.reg === 'auto' && hv.ahit && hv.ahit.kind === 'seg' && P[hv.ahit.i + 1]) {
    const p = P[hv.ahit.i], n = P[hv.ahit.i + 1]; c.beginPath(); c.moveTo(R.t2x(p[0]), a2y(R, L, p[1])); c.lineTo(R.t2x(n[0]), a2y(R, L, n[1])); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.35)'; c.stroke();
  }
  const v = P.length ? autoAt(P, R.ph) : undefined, px = Math.round(R.t2x(R.ph));
  if (v !== undefined && L.ok && px >= R.gut && px <= R.W) {
    const y = a2y(R, L, v);
    c.beginPath(); c.arc(px + 0.5, y, 4.5, 0, Math.PI * 2); c.fillStyle = ACC; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#ffffff'; c.stroke();
  }
  const s = readout(R);
  if (!s) { R.aread = null; return; }
  const x0 = R.gut + 6, y = R.vt + 4, lab = L.long, gw = R.gw;
  let B = R.aread;
  if (!B || B.text !== s || B.lab !== lab || B.gw !== gw || B.y !== y) { // (measured when the text or the room changes)
    c.font = F11;
    const w1 = c.measureText(s).width, room = gw - 12 - w1 - 24;
    c.font = F10;
    const w2 = lab && room > 30 ? c.measureText(lab).width : 0, show = w2 > 0 && w2 <= room;
    B = R.aread = { x: x0, y, w: Math.ceil(w1 + (show ? 10 + w2 : 0) + 12), h: 18, text: s, lab, gw, w1, show };
  }
  const x = B.x = px >= x0 - 8 && px <= x0 + B.w + 8 && R.W - 6 - B.w > px + 8 ? R.W - 6 - B.w : x0; // ((fix round) away from the playhead: never over the heard dot
  c.beginPath(); rr(c, x, y, B.w, 18, 4); c.fillStyle = 'rgba(12,13,15,0.82)'; c.fill();
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.font = F11; c.fillStyle = TEXT; c.fillText(s, x + 6, y + 9.5);
  if (B.show) { c.font = F10; c.fillStyle = MUTE; c.fillText(lab, x + 6 + B.w1 + 10, y + 9.5); }
}
