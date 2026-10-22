// cv-patch.js — patching on the canvas (IMPL-9 §4.1–§4.5, §7.4; lane U9): the patch modules' faces (moduleBody), their face
// jacks' specs and keys, the plug drag over the world's jack hook, the menus (Connect to…, the cord menu, the modules' ⋯ items,
// Patches…), the target chip, add / delete / duplicate / driver / presets / Init / Tidy. Generic (D5): no family's name, number or
// constant here — every type, jack, label and reason is patch-core's (FAMILIES[rec.f]); a family is its table, its DSP and its
// faces. Plain ES module, no DOM at module top level (node imports it); imports carry ?v=9.
//
// Ends and jacks: a patch end is '<mid>.<port>' (mid 'c' = the controller, patch-core CTL); its canvas jack is a span of the
//   module `keyOf(dev, mid)` ('iN' for the controller — the instrument's own module —, 'iN/m<k>' for a module) whose jack id is
//   JACK_PRE + port ('j-out': the controller's MAIN OUT never meets the instrument's own audio 'out' jack), so the jack key is
//   'i1/m3.j-saw' (jackKey(dev, end) / endOf(dev, jackKey)). faceJacks(L, model, title) → the cv-module specs { id, side: 'face',
//   x, y (module-local: geometry's body px + BAR_H, one owner), kind: 'cord', sig, dir, label: '<title> · <legend>', hit }.
// The user's rule (§12, 2026-10-21): a cord's body is not interactive — only its plug ends (the jacks) take presses. A press on a
//   cord jack (cv-cables press → o.cordPress → host.press) past TAP_PX (8 touch / 4 mouse): from an empty jack a new cord leaves
//   it (its free plug follows the finger: cords.live), from a plugged one that plug is pulled (cords.grab / move); the patch's
//   jacks are marked (.cv-ok / .cv-no with canPlug's reason as the title / .cv-from), the jack under the finger (its hit circle)
//   decides — compatible: the target (.cv-hot; its name in the chip beside the finger), refused: its reason in a muted chip, the
//   cord's own start: none —, over none the nearest compatible one within SNAP_PX screen px is (else a refused one's reason); release
//   there → plug (one step "Patch cord") / re-patch ("Re-patch cord"; on its own jack again: nothing); released away from any
//   jack a new cord vanishes and a pulled one comes out ("Pull cord", "Cord pulled · tap to undo"); near a refused jack only:
//   the reason, nothing changes. A tap: a plugged jack opens its cord's menu (eight colour swatches, Remove), an empty one
//   "Connect to…" (its compatible jacks by module); Enter / Space / the ContextMenu key on a focused jack (and a right-click) do
//   the same. A second finger (cv-world jackStop → the press's cancel), Escape, a pointercancel cancel: a new cord vanishes, a
//   pulled plug springs back. Below READ_K a jack whose module is not in edit state takes no press (it sleeps like a control:
//   #world[data-cv-cordsleep] lets a press through to the face, which pans — style.css). Edge auto-pan: world.dragPointer.
// patchHost(deps) → the host's handle (H9: PATCH; the interface in IMPL-9 §12 "Lane U9"):
//   press(e, el) → false | { cancel }   cancel()   active()   sync()   menu(jackKey | el, x?, y?)   chip(t, dev) → patch name
//   add(type, at?)   remove(mid)   duplicate(mid)   driver(mid, drv | null)   preset(name)   init()   tidy()
//   title(t, dev, mid) → { title, sub }   items(t, dev, mid) → ⋯ menu items   devices(t, dev) → cvDevices entries ('pm')
//   size(t, dev, key) → { fixed }   rack(t, dev) → { key: {x, y} } (Tidy, relative to the controller)   members(t, dev, key)
//   knobGet / knobSet (the faces' api)   bodies (the mounted faces)   stats()   destroy()
// deps: { doc, world (World | () => World), cur() → { t, dev } | null (the shown track's patch instrument), rec(t, dev) → the
//   record (normalised), vals(t, dev) → the device's vals, edit(t, dev, label, r) → bool (ONE History step: r = { rec, vals?,
//   back?, lay?: { key: {x, y} | null } } — write dev.patch, dev.vals, the lay entries, post the payload, re-render; back = the
//   knobs a step wrote (patch-core ptBack meta)), knob(t, dev, mid, id, v, ph) (the knob policy: the value written synchronously,
//   queuePatch throttled, no step), view() → the track view (ports, jacks, modules), cords() → the cord layer | null, notice(text,
//   ms, onTap?), undo(), kit (classic-panel's kit for the faces), menu?(x, y, items, opts) (wk.contextMenu) }.
// The cord layer (cv-cords, lane C9; stubbed here per §7.4): set([{ id, a, b, c, s }]) (a / b jack keys, c the colour index, s 1
//   for an S-trigger cord), anchors(Map jackKey → {x, y}), live({ a: {x, y}, b: {x, y}, c, s } | null), grab(id, end 'a' | 'b',
//   p) / move(p) / drop(), sel(id | null).
import * as wk from './wk.js?v=9';
import * as PT from './patch-core.js?v=9';
import * as cvPanel from './cv-panel.js?v=9';
import { ClassicPanel } from './classic-panel.js?v=9';
import { READ_K, DOT } from './cv-world.js?v=9';
import { BAR_H } from './cv-module.js?v=9';
import { SNAP_PX, TAP_PX } from './cv-cables.js?v=9';

/** A cord jack's id on its module: JACK_PRE + the port. */
export const JACK_PRE = 'j-';
/** The drag's tap slop (screen px): a finger's (cv-cables TAP_PX), a mouse's. */
export const TAP_TOUCH = TAP_PX, TAP_MOUSE = 4;
export { SNAP_PX };
/** The chip's place beside the finger (client px: right of it and above, clear of the fingertip). */
export const CHIP_DX = 26, CHIP_DY = -54;

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
const at = (p, k) => (p && (typeof p.get === 'function' ? p.get(k) : p[k])) || null;

/* ---------------------------------------------------------------- ends ↔ jacks (pure) */
/** The canvas module key of patch module `mid` of instrument `dev`: the controller is the instrument's own module. */
export const keyOf = (dev, mid) => (mid === PT.CTL ? dev : dev + '/' + mid);
/** The patch module of a canvas module key ('c' for the instrument's own), else null. */
export function midOf(dev, key) {
  if (key === dev) return PT.CTL;
  return typeof key === 'string' && key.startsWith(dev + '/') && /^m\d{1,4}$/.test(key.slice(dev.length + 1)) ? key.slice(dev.length + 1) : null;
}
/** A patch end's jack key ('m3.saw' → 'i1/m3.j-saw', 'c.out' → 'i1.j-out'). */
export function jackKey(dev, end) { const i = String(end).indexOf('.'); return keyOf(dev, end.slice(0, i)) + '.' + JACK_PRE + end.slice(i + 1); }
/** A jack key's patch end, or null (not a cord jack of `dev`). */
export function endOf(dev, jk) {
  const i = typeof jk === 'string' ? jk.lastIndexOf('.') : -1;
  if (i < 1 || jk.slice(i + 1, i + 1 + JACK_PRE.length) !== JACK_PRE) return null;
  const mid = midOf(dev, jk.slice(0, i)), port = jk.slice(i + 1 + JACK_PRE.length);
  return mid && /^[a-z][a-z0-9]{0,7}$/.test(port) ? mid + '.' + port : null;
}
/** The cv-module jack specs of a face (cv-panel geometry().jacks): module-local (body px + BAR_H), named '<title> · <legend>',
 * each its widest hit circle (`hit`: the CSS clamp's --jp). [] without a layout. */
export function faceJacks(L, model, title) {
  if (!L || !model) return [];
  let g = null;
  try { g = cvPanel.geometry(L, model); } catch (err) { console.error(err); return []; }
  return (g.jacks || []).map(j => ({ id: JACK_PRE + j.port, side: 'face', x: j.x, y: j.y + BAR_H, kind: 'cord', sig: j.sig === 's' ? 's' : 'v',
    dir: j.dir === 'in' || j.dir === 'out' || j.dir === 'any' ? j.dir : 'any', label: (title ? title + ' · ' : '') + j.label, hit: j.hit }));
}
/** The cord layer's list from a record: [{ id, a, b, c, s }] (jack keys; a matrix pin is no cord). */
export function cordList(dev, rec) {
  const fam = isObj(rec) ? PT.FAMILIES[rec.f] : null, out = [];
  if (!fam || !Array.isArray(rec.cords)) return out;
  const sig = new Map(PT.jacksOf(rec, rec.f).map(j => [j.end, j.sig]));
  for (const c of rec.cords) if (!c.via) out.push({ id: c.id, a: jackKey(dev, c.a), b: jackKey(dev, c.b), c: c.c | 0, s: sig.get(c.a) === 's' ? 1 : 0 });
  return out;
}

/* ---------------------------------------------------------------- the host */
export function patchHost(deps) {
  const P = deps || {};
  const doc = () => P.doc || globalThis.document;
  const world = () => (typeof P.world === 'function' ? call(P.world) : P.world) || null;
  const view = () => call(P.view) || null;
  const cordsL = () => call(P.cords) || null;
  // a call into the cord layer (its own `this`; a throw logged, never the drag's)
  const layer = (name, ...a) => { const L = cordsL(); if (!L || typeof L[name] !== 'function') return undefined; try { return L[name](...a); } catch (err) { console.error(err); return undefined; } };
  const notice = (t, ms, tap) => call(P.notice, t, ms, tap);
  const undoTap = () => call(P.undo);
  let dead = false, D = null, CM = null, XM = null, chipEl = null, offW = null;
  const bodies = new Set();
  /* ---- the context: the shown track's patch instrument */
  function ctxOf(t, dev) {
    if (!t || typeof dev !== 'string') return null;
    const rec = call(P.rec, t, dev), fam = isObj(rec) ? PT.FAMILIES[rec.f] : null;
    if (!fam) return null;
    const vals = call(P.vals, t, dev);
    return { t, dev, rec, vals: isObj(vals) ? vals : {}, f: rec.f, fam };
  }
  function ctx() { const c = call(P.cur); return c ? ctxOf(c.t, c.dev) : null; }
  const jinfo = new WeakMap(); // rec → Map(end → jacksOf entry)
  function infoOf(C, end) {
    let m = jinfo.get(C.rec);
    if (!m) { m = new Map(PT.jacksOf(C.rec, C.f).map(j => [j.end, j])); jinfo.set(C.rec, m); }
    return m.get(end) || null;
  }
  const modTitle = (C, mid) => PT.title(C.rec, mid, C.f) || mid;
  const endLabel = (C, end) => { const j = infoOf(C, end); return j ? modTitle(C, j.mid) + ' · ' + j.label : end; };
  // the patch's cord jacks shown now: [{ jk, end, el }] (the view's, else every [data-kind="cord"] jack in the world)
  function jackEls(C) {
    const V = view(), out = [];
    let L = V && typeof V.jacks === 'function' ? call(V.jacks) : null;
    if (!Array.isArray(L)) {
      L = [];
      const W = world(), walk = n => { for (const c of n.children || []) { const id = c.getAttribute && c.getAttribute('data-cv-jack'); if (id) L.push({ id, el: c }); else walk(c); } };
      if (W && W.el) walk(W.el);
    }
    for (const j of L) {
      if (!j || !j.el || typeof j.el.getAttribute !== 'function' || j.el.getAttribute('data-kind') !== 'cord') continue;
      const end = endOf(C.dev, j.id);
      if (end && infoOf(C, end)) out.push({ jk: j.id, end, el: j.el });
    }
    return out;
  }
  const portsNow = () => { const V = view(); return V && typeof V.ports === 'function' ? call(V.ports) || new Map() : new Map(); };
  const modEl = el => { for (let n = el; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute('data-cv-mod') != null) return n; return null; };
  function awake(el) { // (§4.2) below READ_K a jack sleeps unless its module is in edit state
    const W = world();
    if (!W || !(W.k < READ_K - 1e-9)) return true;
    const m = modEl(el);
    return !!m && (m.hasAttribute('data-cv-edit') || (W.edit != null && W.edit === m.getAttribute('data-cv-mod')));
  }

  /* ---- the target chip (#overlay, beside the finger) */
  function chip(text, no, x, y) {
    const W = world(), d = doc();
    if (!text) { if (chipEl) chipEl.hidden = true; return; }
    if (!chipEl) {
      if (!d) return;
      chipEl = d.createElement('div');
      chipEl.className = 'cv-plugchip'; // (not cv-tchip: the top row's track chip's class, #trkChip)
      chipEl.setAttribute('aria-hidden', 'true'); // (the target's name is the jack's own aria-label; the live region is the notice)
      (W && W.overlay ? W.overlay : d.body).append(chipEl);
    }
    if (chipEl.textContent !== text) chipEl.textContent = text;
    if (no) chipEl.setAttribute('data-no', ''); else chipEl.removeAttribute('data-no');
    chipEl.hidden = false;
    const o = D && D.ov ? D.ov : { left: 0, top: 0, width: 1e4 }, wEst = Math.min(320, 20 + 7.6 * text.length);
    let cx = x - o.left + CHIP_DX, cy = y - o.top + CHIP_DY;
    if (cx + wEst > o.width - 4) cx = x - o.left - CHIP_DX - wEst; // (no room right of the finger: left of it)
    chipEl.style.transform = 'translate(' + Math.round(Math.max(4, cx)) + 'px, ' + Math.round(Math.max(4, cy)) + 'px)';
  }

  /* ---- the drag */
  function press(e, el) {
    if (dead || D || !el || typeof el.getAttribute !== 'function' || (e.button != null && e.button !== 0)) return false;
    const C = ctx();
    if (!C) return false;
    const jk = el.getAttribute('data-cv-jack'), end = endOf(C.dev, jk);
    if (!end || !infoOf(C, end) || !awake(el)) return false;
    closeMenu();
    D = { pid: e.pointerId, type: e.pointerType || 'mouse', el, jk, end, C, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false,
      offs: [], marks: new Map(), tgt: null, near: null, mode: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    const d = doc();
    if (d) D.offs.push(listen(d, 'pointermove', move, { passive: true }), listen(d, 'pointerup', up), listen(d, 'pointercancel', pcancel), listen(d, 'keydown', key, true));
    D.offs.push(listen(el, 'lostpointercapture', lost));
    return { cancel };
  }
  function move(e) {
    if (!D || e.pointerId !== D.pid) return;
    if (D.type === 'mouse' && e.buttons === 0) { up(e); return; } // (a swallowed pointerup)
    D.x = e.clientX; D.y = e.clientY;
    if (!D.on) {
      if (Math.hypot(D.x - D.x0, D.y - D.y0) <= (D.type === 'mouse' ? TAP_MOUSE : TAP_TOUCH)) return;
      begin();
    }
    follow();
    const W = world();
    if (W && typeof W.dragPointer === 'function') W.dragPointer({ x: D.x, y: D.y, pointerType: D.type });
  }
  function begin() {
    const C = D.C, rec = C.rec, cd = PT.cordAt(rec, D.end), W = world();
    D.on = true;
    if (cd) { // a plugged jack: its plug is pulled (the cord's other end stays)
      const cord = rec.cords.find(c => c.id === cd.id);
      Object.assign(D, { mode: 'pull', id: cd.id, which: cd.which, fixed: cd.which === 'a' ? cord.b : cord.a, c: cord.c | 0, recX: Object.assign({}, rec, { cords: rec.cords.filter(c => c.id !== cd.id) }) });
    } else Object.assign(D, { mode: 'new', fixed: D.end, c: PT.nextColor(rec), recX: rec });
    D.sig = (infoOf(C, D.fixed) || {}).sig === 's' ? 1 : 0;
    for (const J of jackEls(C)) { // (only the patch's jacks: ≤ ~100 class writes)
      let cls = 'cv-no', why = '';
      if (J.end === D.fixed) cls = 'cv-from';
      else { const r = PT.canPlug(D.recX, D.fixed, J.end, C.f); if (r.ok) cls = 'cv-ok'; else why = r.why || 'Not compatible'; }
      D.marks.set(J.end, { J, cls, why, title: J.el.getAttribute('title'), jp: hitOf(J.el) });
      J.el.classList.add(cls);
      if (why) J.el.setAttribute('title', why);
    }
    D.ports = portsNow(); // (world px: read once — the camera moves, the modules do not)
    if (W && W.el) W.el.setAttribute('data-cv-patching', 'cord');
    let ov = null;
    try { ov = W && W.overlay && W.overlay.getBoundingClientRect ? W.overlay.getBoundingClientRect() : null; } catch (err) { ov = null; } // (one layout read: the chip's frame)
    D.ov = ov && fin(ov.left) ? ov : null;
    if (W && typeof W.on === 'function') D.offs.push(W.on('camera', () => { if (D && D.on) follow(); })); // (an edge pan under a still finger)
    if (D.mode === 'pull') layer('grab', D.id, D.which, fingerW());
  }
  // a face jack's hit circle (style.css: clamp(28px, 44px · --ik, --jp) in world px) on the glass at zoom k: its radius, screen px
  const JACK_MIN = 28, JACK_HIT = 44;
  const hitOf = el => { const v = el && el.style && typeof el.style.getPropertyValue === 'function' ? parseFloat(el.style.getPropertyValue('--jp')) : NaN; return fin(v) && v > 0 ? v : 36; };
  const hitR = (m, k) => Math.max(JACK_MIN * k, Math.min(JACK_HIT, m.jp * k)) / 2;
  const fingerW = () => { const W = world(); return W && typeof W.toWorld === 'function' ? W.toWorld(D.x, D.y) : { x: D.x, y: D.y }; };
  // The target — the jack under the finger decides first (review 2 F3: at the fit zoom the neighbours sit 26–30 px apart, inside
  // SNAP_PX): its hit circle holds the finger → compatible: the target; refused: its reason, no target; the cord's own start: none
  // (nothing is taken). Over no jack: the nearest compatible within SNAP_PX screen px (else the nearest refused one: its reason).
  function follow() {
    const W = world(), toC = (x, y) => (W && typeof W.toClient === 'function' ? W.toClient(x, y) : { x, y }), k = W && fin(W.k) && W.k > 0 ? W.k : 1;
    let best = null, bd = SNAP_PX + 1e-9, near = null, nd = SNAP_PX + 1e-9, under = null, ud = Infinity;
    for (const [end, m] of D.marks) {
      const p = at(D.ports, m.J.jk);
      if (!p) continue;
      const c = toC(p.x, p.y), dd = Math.hypot(c.x - D.x, c.y - D.y);
      if (dd <= hitR(m, k) && dd < ud) { ud = dd; under = end; }
      if (m.cls === 'cv-from') continue;
      if (m.cls === 'cv-ok') { if (dd < bd) { bd = dd; best = end; } } else if (dd < nd) { nd = dd; near = end; }
    }
    D.held = false;
    if (under) { // (it decides: only its own verdict stands)
      const m = D.marks.get(under);
      best = m.cls === 'cv-ok' ? under : null; near = m.cls === 'cv-no' ? under : null; D.held = m.cls === 'cv-from';
    }
    if (best !== D.tgt) {
      const a = D.tgt && D.marks.get(D.tgt), b = best && D.marks.get(best);
      if (a) a.J.el.classList.remove('cv-hot');
      if (b) b.J.el.classList.add('cv-hot');
      D.tgt = best;
    }
    D.near = best ? null : near;
    const C = D.C;
    if (best) chip(endLabel(C, best), false, D.x, D.y);
    else if (near) chip(endLabel(C, near) + ' — ' + D.marks.get(near).why, true, D.x, D.y);
    else chip(null);
    if (!cordsL()) return;
    const fw = fingerW();
    if (D.mode === 'pull') layer('move', fw);
    else { const F = at(D.ports, jackKey(C.dev, D.fixed)); if (F) layer('live', { a: { x: F.x, y: F.y }, b: fw, c: D.c, s: D.sig }); }
  }
  function finish() { // every trace of the drag goes (the cord layer's live / grab is the caller's: done() after a commit) → the drag
    const d = D;
    if (!d) return null;
    D = null;
    for (const f of d.offs) f();
    for (const m of d.marks.values()) {
      m.J.el.classList.remove(m.cls, 'cv-hot');
      if (m.why) { if (m.title == null) m.J.el.removeAttribute('title'); else m.J.el.setAttribute('title', m.title); }
    }
    chip(null);
    if (d.on) {
      const W = world();
      if (W && W.el) W.el.removeAttribute('data-cv-patching');
      if (W && typeof W.dragPointer === 'function') W.dragPointer(null);
    }
    try { d.el.releasePointerCapture(d.pid); } catch (err) { /* released */ }
    return d;
  }
  // the cord layer after a drag: a new cord's live rope goes, a pulled plug is let go (it springs to its end's anchor)
  function done(d) { if (!d || !d.on) return; if (d.mode === 'pull') layer('drop'); else layer('live', null); }
  function up(e) {
    if (!D || e.pointerId !== D.pid) return;
    D.x = e.clientX; D.y = e.clientY;
    if (!D.on) { // a tap: the cord's menu on a plug, else Connect to…
      const d = finish();
      if (Math.hypot(d.x - d.x0, d.y - d.y0) <= (d.type === 'mouse' ? TAP_MOUSE : TAP_TOUCH)) openAt(d.C, d.end, d.el, e.clientX, e.clientY, false);
      return;
    }
    follow();
    const d = finish(), C = d.C, t = d.tgt;
    if (t) {
      if (d.mode === 'new') commit(C, 'Patch cord', PT.plug(C.rec, d.fixed, t, d.c));
      else if (t !== d.end) commit(C, 'Re-patch cord', PT.repatch(C.rec, d.id, d.which, t));
    } else if (d.near) notice(endLabel(C, d.near) + ': ' + d.marks.get(d.near).why, 3500); // (near a refused jack only: nothing changes)
    else if (d.mode === 'pull' && !d.held && commit(C, 'Pull cord', PT.pull(C.rec, d.id))) notice('Cord pulled · tap to undo', 6000, undoTap); // (Q6; let go on its cord's other end: it springs back)
    done(d);
  }
  // (review 2 F1) cancel also closes the menus: the host calls it first in undo / redo / applyRestore / a track switch, and a menu
  // that outlived one would write the record it saw at open (a pick of a cord's colour brought an undone cord back)
  function cancel() { const d = finish(); done(d); closeMenu(); if (XM) { const m = XM; XM = null; call(m.close); } }
  function pcancel(e) { if (D && e.pointerId === D.pid) cancel(); } // (a second finger's flagged cancel, the browser's)
  function lost(e) { if (D && e.pointerId === D.pid && !D.on) finish(); } // (the jack went: its module was made again)
  function key(e) {
    if (!D || e.key !== 'Escape') return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    cancel();
  }

  /* ---- edits: one History step each (the host's), then the cords and the faces follow */
  function commit(C, label, r) {
    if (!r || !r.rec || r.why) { if (r && r.why) notice(r.why, 3500); return false; }
    if (r.rec === C.rec && !r.vals && !r.lay) return false; // (nothing changed: no step)
    const o = { rec: r.rec };
    if (r.vals) o.vals = r.vals;
    if (r.back && Array.isArray(r.back.f) && r.back.f.length) o.back = r.back;
    if (r.lay) { // (the module set changed: the modules Tidy still places are pinned where they stand, in this step — else the rack re-flows under them)
      const lay = o.lay = Object.assign({}, r.lay);
      for (const mid of Object.keys(C.rec.mods)) {
        const k = keyOf(C.dev, mid), e = C.t && isObj(C.t.lay) ? C.t.lay[k] : null;
        if (k in lay || (isObj(e) && fin(e.x) && fin(e.y))) continue;
        const p = posOf(C, k);
        if (p) lay[k] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
    }
    const ok = call(P.edit, C.t, C.dev, label, o) !== false;
    if (ok) sync();
    return ok;
  }
  /** The cords and the mounted faces from the shown record (after an edit, an undo / redo, a track switch). */
  function sync() {
    if (dead) return;
    const C = ctx();
    if (cordsL()) { layer('set', C ? cordList(C.dev, C.rec) : []); if (C) layer('anchors', portsNow()); }
    for (const b of bodies) b.refresh();
  }

  /* ---- menus */
  const ctxMenu = (x, y, items, opts) => (typeof P.menu === 'function' ? call(P.menu, x, y, items, opts) : wk.contextMenu(x, y, items, opts));
  function openAt(C, end, el, x, y, kb) {
    const cd = PT.cordAt(C.rec, end);
    if (cd) return cordMenu(C, cd.id, el, x, y, kb);
    return connectMenu(C, end, el, x, y);
  }
  // Connect to…: the compatible jacks of the patch, a submenu per module (jacksOf order: the controller first, then by number)
  function connectMenu(C, end, el, x, y) {
    const items = [{ label: 'Connect ' + endLabel(C, end) + ' to…', disabled: true }], by = new Map();
    for (const T of PT.targets(C.rec, end, C.f)) { if (!T.ok) continue; if (!by.has(T.mid)) by.set(T.mid, []); by.get(T.mid).push(T); }
    for (const [mid, L] of by) items.push({ label: modTitle(C, mid), sub: L.map(T => ({ label: T.label, action: () => { const N = again(C); if (N) commit(N, 'Patch cord', PT.plug(N.rec, end, T.end)); } })) });
    if (!by.size) items.push({ label: 'Nothing to connect to', disabled: true });
    const r = rectOf(el);
    return (XM = ctxMenu(x != null ? x : r ? r.left + r.width / 2 : 0, y != null ? y : r ? r.bottom + 4 : 0, items, el ? { anchor: el } : undefined) || null);
  }
  // (review 2 F1) a pick acts on the shown patch as it is now, not as the menu saw it: the same track and instrument (the track by id:
  // an undo's restore makes new objects), else null — nothing written
  const again = C => { const N = ctx(); return N && N.t && C.t && N.t.id === C.t.id && N.dev === C.dev ? N : null; };
  // the cord's menu (a tap on its plug): its two ends, eight colour swatches (the current checked), Remove — a popover in the top
  // layer at the jack; a press outside, Escape, a camera move or a pick closes it
  function cordMenu(C, id, el, x, y, kb) {
    closeMenu();
    const d = doc(), cord = C.rec.cords.find(c => c.id === id);
    if (!d || !cord) return null;
    const box = d.createElement('div'), mk = (tag, cls, txt) => { const n = d.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    const name = endLabel(C, cord.a) + ' → ' + endLabel(C, cord.b);
    box.className = 'cv-cmenu'; box.setAttribute('role', 'menu'); box.setAttribute('aria-label', 'Cord: ' + name); box.tabIndex = -1;
    const sw = mk('div', 'cv-cm-sw'), btns = [];
    const mine = () => { const N = again(C), cd = N && N.rec.cords.find(c => c.id === id); return cd && cd.a === cord.a && cd.b === cord.b ? N : null; }; // (the cord as it was, in the patch as it is)
    sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Colour');
    PT.PALETTE.forEach((p, i) => {
      const b = mk('button', 'cv-cm-c');
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(i === (cord.c | 0)));
      b.setAttribute('aria-label', p.name); b.title = p.name; b.setAttribute('data-c', String(i)); b.style.setProperty('--cc', p.hex);
      b.addEventListener('click', ev => { if (ev.stopPropagation) ev.stopPropagation(); closeMenu(); const N = mine(); if (N) commit(N, 'Cord colour', PT.setColor(N.rec, id, i)); });
      sw.append(b); btns.push(b);
    });
    const rm = mk('button', 'cv-cm-x', 'Remove cord');
    rm.type = 'button'; rm.setAttribute('role', 'menuitem');
    rm.addEventListener('click', ev => { if (ev.stopPropagation) ev.stopPropagation(); closeMenu(); const N = mine(); if (N && commit(N, 'Pull cord', PT.pull(N.rec, id))) notice('Cord pulled · tap to undo', 6000, undoTap); });
    btns.push(rm);
    box.append(mk('div', 'cv-cm-t', name), sw, rm);
    d.body.append(box); // (the top layer, as wk.contextMenu's)
    const r = rectOf(el), win = d.defaultView || globalThis, vw = win.innerWidth || 1e4, vh = win.innerHeight || 1e4;
    let px = x != null ? x : r ? r.left + r.width / 2 : 0, py = y != null ? y + 12 : r ? r.bottom + 6 : 0;
    const br = rectOf(box), bw = br && br.width > 0 ? br.width : 248, bh = br && br.height > 0 ? br.height : 116;
    px = Math.max(4, Math.min(px - bw / 2, vw - 4 - bw)); if (py + bh > vh - 4) py = Math.max(4, (r ? r.top - 6 : py - 24) - bh);
    box.style.left = Math.round(px) + 'px'; box.style.top = Math.round(py) + 'px';
    layer('sel', id);
    const focusAt = i => { const b = btns[(i + btns.length) % btns.length]; if (b && b.focus) b.focus(); };
    const onKey = ev => {
      const i = btns.indexOf(d.activeElement), k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation(); closeMenu(true); return; }
      const dx = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[k];
      if (dx) { ev.preventDefault(); focusAt(i < 0 ? 0 : i + dx); } else if (k === 'Home' || k === 'End') { ev.preventDefault(); focusAt(k === 'Home' ? 0 : btns.length - 1); }
    };
    const onDown = ev => { if (!box.contains(ev.target)) closeMenu(); };
    const offs = [listen(box, 'keydown', onKey), listen(d, 'pointerdown', onDown, true), typeof wk.addTransient === 'function' ? wk.addTransient(() => closeMenu()) : () => {}];
    CM = { box, el, offs, id };
    if (kb) focusAt(cord.c | 0); else try { box.focus({ preventScroll: true }); } catch (err) { /* no focus */ }
    return { el: box, close: () => closeMenu() };
  }
  function closeMenu(focusBack) {
    if (!CM) return false;
    const m = CM;
    CM = null;
    for (const f of m.offs) f();
    m.box.remove();
    layer('sel', null);
    if (focusBack && m.el && m.el.focus) { try { m.el.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
    return true;
  }
  const rectOf = el => { try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (err) { return null; } };
  /** The jack's menu (a key or a right-click): the cord's menu on a plug, else Connect to…; jk a jack key or its element. */
  function menu(jk, x, y) {
    const C = ctx(), el = jk && typeof jk === 'object' ? jk : null, k = el ? el.getAttribute('data-cv-jack') : jk, end = C ? endOf(C.dev, k) : null;
    if (!C || !end || !infoOf(C, end)) return null;
    let je = el;
    if (!je) for (const J of jackEls(C)) if (J.jk === k) { je = J.el; break; }
    return openAt(C, end, je, x, y, x == null);
  }
  // the keyboard path and a right-click on a cord jack (cv-cables leaves cord jacks alone)
  const cordJack = t => { for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) { if (n.getAttribute('data-cv-jack') != null) return n.getAttribute('data-kind') === 'cord' ? n : null; if (n.getAttribute('data-cv-mod') != null) return null; } return null; };
  function onKeyW(e) {
    const k = e.key, je = (k === 'Enter' || k === ' ' || k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) ? cordJack(e.target) : null;
    if (!je || je !== e.target || D) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    menu(je);
  }
  function onCtxW(e) {
    const je = cordJack(e.target);
    if (!je || D) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    menu(je, e.clientX, e.clientY);
  }
  // below READ_K the cord jacks sleep: #world[data-cv-cordsleep] (style.css: a press goes through them to the face, which pans)
  function sleepAttr() { const W = world(); if (W && W.el) { if (W.k < READ_K - 1e-9) W.el.setAttribute('data-cv-cordsleep', ''); else W.el.removeAttribute('data-cv-cordsleep'); } }
  function hookWorld() {
    if (offW) return;
    const W = world();
    if (!W || !W.el) return;
    offW = [listen(W.el, 'keydown', onKeyW), listen(W.el, 'contextmenu', onCtxW)];
    if (typeof W.on === 'function') offW.push(W.on('cameraend', sleepAttr));
    sleepAttr();
  }
  hookWorld();

  /* ---- modules: add / delete / duplicate / driver / presets / Init / Tidy */
  const snap = v => Math.round(v / DOT) * DOT;
  const typeOf = (C, mid) => (mid === PT.CTL ? C.fam.ctl : (C.rec.mods[mid] || {}).t);
  const sizeOfT = (C, t) => { const T = C.fam.types[t]; return T && fin(T.w) && fin(T.h) ? [T.w, T.h] : [128, 512]; };
  function posOf(C, key) { // a module's top-left (world px): its module's, else its lay entry
    const V = view(), m = V && V.modules && typeof V.modules.get === 'function' ? V.modules.get(key) : null;
    if (m && fin(m.x) && fin(m.y)) return { x: m.x, y: m.y };
    const e = C.t && isObj(C.t.lay) ? C.t.lay[key] : null;
    return isObj(e) && fin(e.x) && fin(e.y) ? { x: e.x, y: e.y } : null;
  }
  const ctlPos = C => posOf(C, C.dev) || { x: 0, y: 0 };
  function placedRel(C, rec) { // the modules' places relative to the controller (Tidy's frame)
    const c0 = ctlPos(C), o = {};
    for (const mid of Object.keys(rec.mods)) { const p = posOf(C, keyOf(C.dev, mid)); if (p) o[mid] = { x: p.x - c0.x, y: p.y - c0.y }; }
    return o;
  }
  // the first free slot of mid's row (patch-core freeSlot) in world px, each placed one taken into account
  function slot(C, rec, mid, rel) { const c0 = ctlPos(C), s = PT.freeSlot(rec, C.f, mid, rel); rel[mid] = { x: s.x, y: s.y }; return { x: c0.x + s.x, y: c0.y + s.y }; }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  /** A module of `type` (a tap: the first free slot of its row; a drop: at = its top-left, world px, on the dots when Snap is on). */
  function add(type, atP) {
    const C = ctx();
    if (!C) return null;
    const r = PT.addModule(C.rec, C.vals, type);
    if (!r.mid) { notice(r.why || 'No such module', 3500); return null; }
    const W = world(), sn = !W || typeof W.snapOn !== 'function' || W.snapOn();
    const p = atP && fin(atP.x) && fin(atP.y) ? { x: sn ? snap(atP.x) : Math.round(atP.x), y: sn ? snap(atP.y) : Math.round(atP.y) } : slot(C, r.rec, r.mid, placedRel(C, C.rec));
    const T = C.fam.types[type];
    return commit(C, 'Add ' + (T ? T.short : type), { rec: r.rec, lay: { [keyOf(C.dev, r.mid)]: p } }) ? r.mid : null;
  }
  /** Delete a module with its cords (one step, no prompt — Q4; a driver's driven modules undriven), "tap to undo". */
  function remove(mid) {
    const C = ctx();
    if (!C || mid === PT.CTL) return false;
    const name = modTitle(C, mid), r = PT.removeModule(C.rec, mid);
    if (r.rec === C.rec) return false;
    const ok = commit(C, 'Delete ' + name, { rec: r.rec, lay: { [keyOf(C.dev, mid)]: null } });
    if (ok) notice('Deleted ' + name + (r.cords.length ? ' and ' + plural(r.cords.length, 'cord') : '') + ' · tap to undo', 6000, undoTap);
    return ok;
  }
  /** Duplicate a module (its values, no cords), beside it when that room is free, else its row's first free slot. */
  function duplicate(mid) {
    const C = ctx();
    if (!C || mid === PT.CTL) return null;
    const r = PT.duplicateModule(C.rec, C.vals, mid);
    if (!r.mid) { notice(r.why || 'No such module', 3500); return null; }
    const rel = placedRel(C, C.rec), src = rel[mid], [w, h] = sizeOfT(C, typeOf(C, mid));
    let p = null;
    if (src) {
      const q = { x: src.x + w, y: src.y }, free = Object.keys(rel).every(k => { const o = rel[k], [kw, kh] = sizeOfT(C, typeOf(C, k)); return q.x >= o.x + kw || q.x + w <= o.x || q.y >= o.y + kh || q.y + h <= o.y; });
      if (free) { const c0 = ctlPos(C); p = { x: c0.x + q.x, y: c0.y + q.y }; }
    }
    if (!p) p = slot(C, r.rec, r.mid, rel);
    return commit(C, 'Duplicate ' + modTitle(C, mid), { rec: r.rec, vals: r.vals, lay: { [keyOf(C.dev, r.mid)]: p } }) ? r.mid : null;
  }
  /** A linked module's driver (null: none). */
  function driver(mid, drv) { const C = ctx(); return !!C && commit(C, 'Driver', PT.setDriver(C.rec, mid, drv == null ? null : drv)); }
  /** A starting patch (Patches…): the topology replaced, its knobs written (the step's meta puts them back), missing modules
   * added in their rows' free slots; "tap to undo". */
  function preset(name, opts) {
    const C = ctx();
    if (!C) return false;
    const r = PT.loadPreset(C.rec, C.vals, name, opts);
    if (r.why) { notice(r.why, 3500); return false; }
    const rel = placedRel(C, C.rec), lay = {};
    for (const mid of r.added || []) lay[keyOf(C.dev, mid)] = slot(C, r.rec, mid, rel);
    const ok = commit(C, 'Load ' + name, Object.assign({}, r, Object.keys(lay).length ? { lay } : {}));
    if (ok) notice('Loaded ' + name + ' · tap to undo', 6000, undoTap);
    return ok;
  }
  /** Init patch: every cord out, every knob at its default; the modules stay. */
  function init() {
    const C = ctx();
    if (!C) return false;
    const ok = commit(C, 'Init patch', PT.initPatch(C.rec, C.vals));
    if (ok) notice('Init patch · tap to undo', 6000, undoTap);
    return ok;
  }
  /** Tidy's places of the modules (patch-core rackLayout: rows above the controller), relative to its top-left. */
  function rack(t, dev) { const C = t ? ctxOf(t, dev) : ctx(); if (!C) return {}; const R = PT.rackLayout(C.rec, C.f), o = {}; for (const mid of Object.keys(R)) o[keyOf(C.dev, mid)] = R[mid]; return o; }
  /** Tidy patch (one step): every module to its rack place. */
  function tidy() {
    const C = ctx();
    if (!C) return false;
    const c0 = ctlPos(C), R = rack(C.t, C.dev), lay = {};
    let moved = false;
    for (const k of Object.keys(R)) { const p = { x: c0.x + R[k].x, y: c0.y + R[k].y }, q = posOf(C, k); lay[k] = p; if (!q || q.x !== p.x || q.y !== p.y) moved = true; }
    return moved && commit(C, 'Tidy patch', { rec: C.rec, lay });
  }

  /* ---- the modules' bars, menus and entries */
  /** A module's bar: { title ('<short> <ordinal>': patch-core title), sub (a linked module's driver: 'on <its title>') }. */
  function title(t, dev, mid) {
    const C = ctxOf(t, dev);
    if (!C) return { title: '', sub: '' };
    const m = C.rec.mods[mid], T = m && C.fam.types[m.t];
    return { title: modTitle(C, mid), sub: T && T.link && m.drv ? 'on ' + modTitle(C, m.drv) : '' };
  }
  /** The ⋯ items of a patch module (Duplicate, Driver ▸, Delete) or of the controller (Patches ▸ the presets and Init patch, Tidy patch). */
  function items(t, dev, mid) {
    const C = ctxOf(t, dev);
    if (!C) return [];
    if (mid === PT.CTL) {
      const names = PT.presetNames(C.f);
      const sub = names.map(n => ({ label: n, checked: C.rec.name === n, action: () => preset(n) }));
      sub.push({ sep: true }, { label: 'Init patch', action: () => init() });
      return [{ label: 'Patches', sub }, { label: 'Tidy patch', action: () => tidy() }];
    }
    const m = C.rec.mods[mid];
    if (!m) return [];
    const T = C.fam.types[m.t], out = [{ label: 'Duplicate', action: () => duplicate(mid) }];
    if (T && T.link) {
      const ds = Object.keys(C.rec.mods).filter(k => C.rec.mods[k].t === T.link.to).sort((a, b) => +a.slice(1) - +b.slice(1));
      out.push({ label: 'Driver', sub: ds.map(k => ({ label: modTitle(C, k), checked: m.drv === k, action: () => driver(mid, k) })).concat([{ label: 'None', checked: !m.drv, action: () => driver(mid, null) }]) });
    }
    out.push({ sep: true }, { label: 'Delete', action: () => remove(mid) });
    return out;
  }
  /** The track view's entries for the patch modules (main.js cvDevices, after the instrument's): one 'pm' module each — compact
   * bar, no fold, its fixed size and its face's jacks. */
  function devices(t, dev) {
    const C = ctxOf(t, dev);
    if (!C) return [];
    return Object.keys(C.rec.mods).sort((a, b) => +a.slice(1) - +b.slice(1)).map(mid => {
      const ty = C.rec.mods[mid].t, T = C.fam.types[ty], [w, h] = sizeOfT(C, ty), tt = title(t, dev, mid);
      return { key: keyOf(dev, mid), kind: 'pm', dev, mid, type: ty, model: C.fam.model, title: tt.title, sub: tt.sub, fixed: { w, h }, nofold: true, compact: true,
        jacks: T ? faceJacks(cvPanel.moduleLayout(ty), cvPanel.moduleModel(ty), tt.title) : [] };
    });
  }
  function size(t, dev, key) { const C = ctxOf(t, dev), mid = C ? midOf(dev, key) : null; if (!mid || mid === PT.CTL || !C.rec.mods[mid]) return null; const [w, h] = sizeOfT(C, C.rec.mods[mid].t); return { fixed: { w, h } }; }
  /** Selecting a driver outlines the modules it drives (cv-module host.members). */
  function members(t, dev, key) {
    const C = ctxOf(t, dev), mid = C ? midOf(dev, key) : null;
    if (!mid || mid === PT.CTL) return [];
    return Object.keys(C.rec.mods).filter(k => C.rec.mods[k].drv === mid).map(k => keyOf(dev, k));
  }
  /* ---- the faces' api (moduleBody): a knob's value through patch-core (`_t` checked), its write the host's knob policy */
  function knobGet(t, dev, mid, id) { const C = ctxOf(t, dev); return C ? PT.getKnob(C.vals, C.rec, mid, id) : undefined; }
  function knobSet(t, dev, mid, id, v, ph) { if (!dead) call(P.knob, t, dev, mid, id, v, ph); }

  const H = {
    press, cancel, active: () => !!(D && D.on), sync, menu, closeMenu,
    add, remove, duplicate, driver, preset, init, tidy, rack,
    title, items, devices, size, members, chip: (t, dev) => { const C = ctxOf(t, dev); return C ? C.rec.name || '' : ''; },
    knobGet, knobSet, kit: () => P.kit || null, doc, bodies,
    stats: () => ({ drag: D ? D.mode || 'press' : null, marks: D ? D.marks.size : 0, bodies: bodies.size, menu: !!CM, chip: !!chipEl && !chipEl.hidden }),
    /** (the world made later than the host, or again) its key / right-click listeners and the sleep attribute */
    attach: hookWorld,
    destroy() {
      if (dead) return;
      cancel(); closeMenu();
      dead = true;
      if (offW) { for (const f of offW) f(); offW = null; }
      if (chipEl) { chipEl.remove(); chipEl = null; }
      for (const b of [...bodies]) b.destroy();
    },
  };
  return H;
}

/* ---------------------------------------------------------------- a module's face */
/**
 * A patch module's body (IMPL-9 §4.1): its face (cv-panel moduleLayout / moduleModel through a ClassicPanel: the classic knob kit,
 * the GL face path) over a per-instance view of vals.p[mid] — a read is patch-core's getKnob (`_t` checked), a write the host's
 * knob policy (no History step). Its controls carry data-nomod (no canvas modulation into a module's knob: §4.8).
 * o: { host (patchHost), t, dev, mid, type, doc? } → { el (append it to the module's body), panel, refresh(), destroy() }.
 */
export function moduleBody(o) {
  const H = o.host, doc = o.doc || (H && H.doc && H.doc()) || globalThis.document, mid = o.mid, key = keyOf(o.dev, mid);
  const root = doc.createElement('div'), L = cvPanel.moduleLayout(o.type), model = cvPanel.moduleModel(o.type);
  if (!H || !L || !model) { // (a type this build lacks, a face that does not validate: an honest blank)
    root.className = 'cv-pmissing';
    root.textContent = 'This module needs a newer version of the app';
    return { el: root, panel: null, refresh() {}, destroy() { root.remove(); } };
  }
  const vals = {};
  for (const c of model.controls) Object.defineProperty(vals, c.id, { enumerable: true, get: () => H.knobGet(o.t, o.dev, mid, c.id), set: v => H.knobSet(o.t, o.dev, mid, c.id, v) });
  const tr = { id: o.t && o.t.id, prim: key, name: model.name, preset: '', vals };
  const kit = (H.kit && H.kit()) || {};
  const host = { doc, kit: kit.kit || kit, changed: (t, id, ph) => { if (ph === 'end') H.knobSet(o.t, o.dev, mid, id, H.knobGet(o.t, o.dev, mid, id), 'end'); }, modMenu: { canMod: () => false } };
  const panel = new ClassicPanel(root, { track: tr, model, layout: L, host });
  const st = [root];
  while (st.length) { const n = st.pop(); for (const c of n.children || []) { if (c.getAttribute && c.getAttribute('data-dest') != null) c.setAttribute('data-nomod', '1'); st.push(c); } }
  let dead = false;
  const B = {
    el: root, panel,
    refresh() { if (!dead) panel.refresh(); },
    destroy() { if (dead) return; dead = true; H.bodies.delete(B); panel.destroy(); root.remove(); },
  };
  H.bodies.add(B);
  return B;
}
