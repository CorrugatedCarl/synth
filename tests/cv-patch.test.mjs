import './v8-guard.mjs';
// cv-patch.js (IMPL-9 §4.1–§4.5, §8.6; lane U9): ends ↔ jack keys, faceJacks (every face: ids, points, labels, hit), cordList, the
// host's module entries; the plug drag over a real cv-module track view of the Model 15 set (Classic bass) on tests/wk-dom.mjs
// with a scripted world and a stub cord layer (§7.4's API, lane C9's later): a new cord from an empty jack (live, the marks with
// canPlug's reasons, the target chip, one "Patch cord" step), released nowhere (it vanishes), near a refused jack (its reason, no
// step), a pulled plug (grab / move / drop: out with "tap to undo", re-patched, back on its own jack: nothing), a second finger /
// Escape / pointercancel (cancelled, nothing written); a tap → the cord's menu on a plug (eight swatches, Remove) or Connect to…
// on an empty jack; the keyboard path; the jacks asleep below READ_K; add / delete (cords out, one step, tap to undo) / duplicate /
// driver / presets (the knobs' back meta) / Init / Tidy; the ⋯ items, titles, members; a module's face over vals.p (a knob: a
// `knob` call, no step; data-nomod); DOM counts per module (§4.1). The user's rule (§12): a cord's body takes no press — nothing
// here listens for one. Never passes fake-DOM nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, all, ptr, fire, key, Ev, place } from './wk-dom.mjs';
import * as CP from '../cv-patch.js?v=9';
import * as PT from '../patch-core.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as M from '../cv-module.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';
import { READ_K } from '../cv-world.js?v=9';

const M900 = MODELS.find(m => m.id === 'm900');
const KIT = { track() {}, pressOrTap() {}, noMenu() {}, hoverable() {}, wheelIn: () => null, wheelStep: () => 0, tip() {}, untip() {} };
const cls = e => e.getAttribute('class') || '';
const menus = doc => all(doc.body).filter(n => n.getAttribute && /wk-ctx/.test(cls(n)));
const menuLabels = doc => { const m = menus(doc).at(-1); return m ? all(m).filter(n => cls(n) === 'wk-cl').map(n => n.textContent) : []; };
const cmenu = doc => all(doc.body).find(n => n.getAttribute && cls(n) === 'cv-cmenu') || null;

// a scripted cv-world: camera k (client = world · k + t), the module layer, #overlay, events, edit state
function fakeWorld(doc, k = 1) {
  const subs = {}, el = doc.createElement('div'), overlay = doc.createElement('div');
  el.setAttribute('data-cv-world', '');
  doc.body.append(el, overlay);
  const W = {
    el, overlay, k, edit: null, cam: { tx: 0, ty: 0 }, items: new Map(), ptrs: [], snap: true, selection: [],
    toWorld: (x, y) => ({ x: (x - W.cam.tx) / W.k, y: (y - W.cam.ty) / W.k }), toClient: (x, y) => ({ x: x * W.k + W.cam.tx, y: y * W.k + W.cam.ty }),
    dragPointer: p => W.ptrs.push(p ? Math.round(p.x) + ',' + Math.round(p.y) : null), snapOn: () => W.snap,
    add(it) { W.items.set(it.id, it); }, remove(id) { W.items.delete(id); }, update() {}, clear() {}, focusItem() {},
    select(id) { W.selected = id; W.emit('select', { id }); },
    on(t, f) { (subs[t] || (subs[t] = [])).push(f); return () => { subs[t] = subs[t].filter(g => g !== f); }; },
    emit(t, d) { for (const f of (subs[t] || []).slice()) f(d); },
  };
  return W;
}
// the stub cord layer (IMPL-9 §7.4: lane C9 builds cv-cords): every call recorded
function stubCords() {
  const log = [];
  const r1 = p => (p ? Math.round(p.x) + ',' + Math.round(p.y) : 'null');
  return {
    log, list: [], anchors: null,
    set(L) { this.list = L.map(c => Object.assign({}, c)); log.push('set ' + L.length); },
    anchors(P) { this.anchors = P; log.push('anchors'); },
    live(s) { log.push(s ? 'live ' + r1(s.a) + '>' + r1(s.b) + ' c' + s.c + ' s' + s.s : 'live null'); },
    grab(id, end, p) { log.push('grab ' + id + ' ' + end + ' ' + r1(p)); }, move(p) { log.push('move ' + r1(p)); }, drop() { log.push('drop'); },
    sel(id) { log.push('sel ' + id); },
  };
}
// the Model 15 set patched as Classic bass on track 1's 900 Series (i1), shown through a real cv-module track view
function rig(o = {}) {
  const doc = fresh(), W = fakeWorld(doc, o.k || 1), L = stubCords(), edits = [], notes = [], knobs = [];
  W.cam.ty = 1300; // (the rack lies above the console, y < 0: the camera puts it on screen)
  place(W.overlay, 0, 0, 3000, 2000);
  const m = MG.model15({});
  const t = { id: 'trk_1', name: 'Bass', color: '#c9a45c', prim: 'i1', nid: 2, lay: {},
    dev: { i1: { kind: 'synth', model: 'm900', vals: m.vals, patch: m.rec }, fx1: { kind: 'panel' }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] };
  let V = null;
  const ctlL = cvPanel.usable('m900', M900), ctlJacks = CP.faceJacks(ctlL, M900, 'Controller');
  const H = CP.patchHost(Object.assign({
    doc, world: W, kit: KIT,
    cur: () => ({ t, dev: 'i1' }), rec: (tt, dev) => tt.dev[dev].patch, vals: (tt, dev) => tt.dev[dev].vals,
    edit: (tt, dev, label, r) => {
      edits.push({ label, r });
      tt.dev[dev].patch = r.rec;
      if (r.vals) tt.dev[dev].vals = r.vals;
      if (r.lay) for (const k of Object.keys(r.lay)) { if (r.lay[k]) tt.lay[k] = r.lay[k]; else delete tt.lay[k]; }
      if (V) V.sync(tt);
      return true;
    },
    knob: (tt, dev, mid, id, v, ph) => { knobs.push(mid + '.' + id + '=' + v + (ph ? ' ' + ph : '')); tt.dev[dev].vals = PT.setKnob(tt.dev[dev].vals, tt.dev[dev].patch, mid, id, v); },
    view: () => V, cords: () => L, notice: (text, ms, tap) => notes.push(text + (tap ? ' [tap]' : '')), undo: () => notes.push('UNDO'),
  }, o.deps || {}));
  const bodies = new Map();
  const host = {
    root: W.el, doc, patch: false,
    devices: tt => M.devicesOf(tt).map(d => (d.key === 'i1' ? Object.assign({}, d, { jacks: ctlJacks, nofold: true }) : d)).concat(H.devices(tt, 'i1')),
    size: k => (k === 'i1' ? { fixed: cvPanel.sizeOf(ctlL, M900) } : H.size(t, 'i1', k)),
    title: k => { const mid = CP.midOf('i1', k); return mid && mid !== 'c' ? H.title(t, 'i1', mid) : { title: k === 'i1' ? '900 Series' : k.toUpperCase() }; },
    menu: k => { const mid = CP.midOf('i1', k); return mid ? H.items(t, 'i1', mid) : []; },
    bodies: { mount: (k, b) => { const mid = CP.midOf('i1', k); if (!mid || mid === 'c') return; const B = CP.moduleBody({ host: H, t, dev: 'i1', mid, type: t.dev.i1.patch.mods[mid].t, doc }); b.append(B.el); bodies.set(k, B); }, unmount: k => { const B = bodies.get(k); if (B) B.destroy(); bodies.delete(k); } },
    rackLayout: k => H.rack(t, k), members: k => H.members(t, 'i1', k), onRelay: P => { if (L) L.anchors(P); },
    lay: (k, e, ph) => { if (ph === 'end' && e) t.lay[k] = e; },
  };
  V = M.createTrackView(W, t, host);
  H.sync();
  const port = jk => V.ports().get(jk);
  const el = end => { const k = CP.jackKey('i1', end), i = k.lastIndexOf('.'), md = V.modules.get(k.slice(0, i)); return md ? md.jack(k.slice(i + 1)) : null; };
  const at = end => { const p = port(CP.jackKey('i1', end)); return W.toClient(p.x, p.y); };
  let pid = 10;
  const press = (end, o2 = {}) => { const c = at(end), e = new Ev('pointerdown', Object.assign({ bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, pointerId: ++pid, pointerType: 'touch', button: 0 }, o2)); return H.press(e, el(end)); };
  const mv = (x, y, o2 = {}) => ptr(doc.body, 'pointermove', x, y, Object.assign({ pointerId: pid, pointerType: 'touch' }, o2));
  const up = (x, y, o2 = {}) => ptr(doc.body, 'pointerup', x, y, Object.assign({ pointerId: pid, pointerType: 'touch' }, o2));
  const to = end => { const c = at(end); mv(c.x, c.y); return c; };
  const rec = () => t.dev.i1.patch, chip = () => all(W.overlay).find(n => cls(n) === 'cv-plugchip') || null;
  return { doc, W, L, H, V, t, edits, notes, knobs, bodies, port, el, at, press, mv, up, to, rec, chip, ctlL, ctlJacks, pid: () => pid };
}
const cordOf = (rec, a, b) => rec.cords.find(c => (c.a === a && c.b === b) || (c.a === b && c.b === a)) || null;

/* ---------------------------------------------------------------- pure */
test('ends ↔ jack keys: the controller is its instrument\'s module (iN), a module iN/m<k>; a cord jack\'s id is j-<port> (MAIN OUT never meets the instrument\'s own audio out); anything else is no end', () => {
  assert.deepEqual([CP.JACK_PRE, CP.keyOf('i1', 'c'), CP.keyOf('i1', 'm7'), CP.midOf('i1', 'i1'), CP.midOf('i1', 'i1/m12'), CP.midOf('i1', 'i2/m1'), CP.midOf('i1', 'i1/fx'), CP.midOf('i1', 'fx1')],
    ['j-', 'i1', 'i1/m7', 'c', 'm12', null, null, null]);
  assert.deepEqual([CP.jackKey('i1', 'm3.saw'), CP.jackKey('i2', 'c.out'), CP.endOf('i1', 'i1/m3.j-saw'), CP.endOf('i2', 'i2.j-out')], ['i1/m3.j-saw', 'i2.j-out', 'm3.saw', 'c.out']);
  for (const bad of ['i1.out', 'i1/m3.saw', 'i2/m3.j-saw', 'i1/fx.j-out', 'i1/m3.j-', 'i1/m3.j-Saw', '', null, 'i1/m3']) assert.equal(CP.endOf('i1', bad), null, String(bad));
  for (const end of PT.jacksOf(MG.model15({}).rec, 'moog').map(j => j.end)) assert.equal(CP.endOf('i1', CP.jackKey('i1', end)), end, end);
  assert.deepEqual([CP.TAP_TOUCH, CP.TAP_MOUSE, CP.SNAP_PX], [8, 4, 32]);
});

test('faceJacks: every face (the nine modules and the console) — one spec per jack of its type, id j-<port>, module-local (geometry\'s body px + BAR_H), "<title> · <legend>", sig / dir from the table, its hit circle ≤ the pitch; [] without a layout', () => {
  for (const ty of MG.ORDER) {
    const L = cvPanel.moduleLayout(ty), model = cvPanel.moduleModel(ty), g = cvPanel.geometry(L, model), J = CP.faceJacks(L, model, ty.toUpperCase() + ' 1'), T = MG.TYPES[ty];
    assert.deepEqual(J.map(j => j.id).sort(), T.jacks.map(j => CP.JACK_PRE + j.id).sort(), ty);
    for (const j of J) {
      const gj = g.jacks.find(x => CP.JACK_PRE + x.port === j.id), tj = T.jacks.find(x => CP.JACK_PRE + x.id === j.id);
      assert.deepEqual([j.side, j.kind, j.x, j.y, j.sig, j.dir, j.label, j.hit], ['face', 'cord', gj.x, gj.y + M.BAR_H, tj.sig, tj.dir, ty.toUpperCase() + ' 1 · ' + tj.label, gj.hit], ty + ' ' + j.id);
      assert.ok(j.hit >= 28 && j.x > 0 && j.x < T.w && j.y > M.BAR_H && j.y < T.h, ty + ' ' + j.id + ': inside its module, a 14 mm circle at least');
    }
  }
  const C = CP.faceJacks(cvPanel.usable('m900', M900), M900, 'Controller');
  assert.deepEqual([C.length, C.filter(j => j.sig === 's').map(j => j.id), C.find(j => j.id === 'j-out').label, C.filter(j => j.dir === 'any').length], [27, ['j-ks1', 'j-ks2', 'j-vo', 'j-si'], 'Controller · MAIN OUT', 8]);
  assert.deepEqual([CP.faceJacks(null, M900, 'x'), CP.faceJacks(cvPanel.moduleLayout('921b'), null, 'x')], [[], []]);
  assert.equal(CP.faceJacks(cvPanel.moduleLayout('911'), cvPanel.moduleModel('911'), '')[0].label.startsWith(' · '), false, 'no title: the legend alone');
});

test('cordList: the record\'s cords as the cord layer\'s list — jack keys, the colour index, an S-trigger cord marked; a matrix pin is no cord; no record → []', () => {
  const { rec } = MG.model15({}), L = CP.cordList('i1', rec);
  assert.equal(L.length, 15);
  assert.deepEqual(L[0], { id: 'c1', a: 'i1.j-kp1', b: 'i1/m2.j-f1', c: 0, s: 0 });
  assert.deepEqual(L.filter(c => c.s).map(c => c.a + '>' + c.b), ['i1.j-ks1>i1/m9.j-trg', 'i1.j-ks2>i1/m10.j-trg']);
  const pin = Object.assign({}, rec, { cords: rec.cords.concat([{ id: 'c99', a: 'm1.saw', b: 'm7.c3', via: 'pin' }]) });
  assert.equal(CP.cordList('i1', pin).length, 15);
  assert.deepEqual([CP.cordList('i1', null), CP.cordList('i1', { f: 'nope', cords: [] })], [[], []]);
});

/* ---------------------------------------------------------------- the view */
test('devices / size / title / members: one \'pm\' entry per module (number order) — compact, nofold, its type\'s fixed size, its face\'s jacks titled; a driven module\'s sub names its driver; the view lays them out in Tidy\'s rows over the controller', () => {
  const R = rig(), D = R.H.devices(R.t, 'i1');
  assert.deepEqual(D.map(d => d.key + ':' + d.type + ':' + d.fixed.w + 'x' + d.fixed.h), ['i1/m1:921:224x512', 'i1/m2:921a:128x512', 'i1/m3:921b:128x512', 'i1/m4:921b:128x512', 'i1/m5:923:128x512',
    'i1/m6:995:128x512', 'i1/m7:904a:128x512', 'i1/m8:907a:352x512', 'i1/m9:911:128x512', 'i1/m10:911:128x512', 'i1/m11:902:128x512', 'i1/m12:902:128x512']);
  const d3 = D[2];
  assert.deepEqual([d3.kind, d3.dev, d3.mid, d3.model, d3.title, d3.sub, d3.compact, d3.nofold, d3.jacks.length, d3.jacks[0].label.startsWith('921B 1 · ')], ['pm', 'i1', 'm3', 'm900', '921B 1', 'on 921A 1', true, true, 7, true]);
  assert.deepEqual([R.H.size(R.t, 'i1', 'i1/m8'), R.H.size(R.t, 'i1', 'i1'), R.H.size(R.t, 'i1', 'i1/m99')], [{ fixed: { w: 352, h: 512 } }, null, null]);
  assert.deepEqual([R.H.title(R.t, 'i1', 'm7'), R.H.members(R.t, 'i1', 'i1/m2'), R.H.members(R.t, 'i1', 'i1/m7'), R.H.chip(R.t, 'i1')], [{ title: '904A 1', sub: '' }, ['i1/m3', 'i1/m4'], [], 'Classic bass']);
  const xy = k => { const m = R.V.modules.get(k); return m.x + ',' + m.y; };
  assert.deepEqual(['i1', 'i1/m1', 'i1/m2', 'i1/m6', 'i1/m7', 'i1/m8', 'i1/m12'].map(xy), ['0,0', '0,-1024', '224,-1024', '736,-1024', '0,-512', '128,-512', '864,-512'], 'two rows flush above the console');
  assert.deepEqual([R.V.modules.get('i1/m3').compact, R.V.modules.get('i1/m3').title, R.V.modules.get('i1').nofold, R.V.modules.get('i1').jackIds().length], [true, '921B 1', true, 28]);
  assert.deepEqual(R.L.log.slice(0, 1).concat(R.L.list.length), ['anchors', 15], 'the view\'s relay fed the anchors; sync set the cords');
  R.W.select('i1/m2');
  assert.deepEqual(['i1/m3', 'i1/m4', 'i1/m1'].map(k => R.V.modules.get(k).el.hasAttribute('data-cv-member')), [true, true, false], 'the 921A outlines its 921Bs');
  R.V.destroy(); R.H.destroy();
});

/* ---------------------------------------------------------------- the plug drag */
test('a new cord from an empty jack: past the slop the live cord leaves it (the least-used colour); the patch\'s jacks marked — the source cv-from, compatible cv-ok, the rest cv-no titled with the reason; the snapped jack cv-hot, named in the chip beside the finger; release → ONE "Patch cord" step, the cords set, every trace cleared', () => {
  const R = rig(), src = 'm4.sin', E = e => R.el(e);
  const h = R.press(src);
  assert.equal(typeof h.cancel, 'function', 'taken: {cancel} (cv-world\'s jackStop calls it)');
  const c0 = R.at(src);
  R.mv(c0.x + 5, c0.y + 3);
  assert.deepEqual([R.L.log.includes('live null'), cls(E(src)), R.W.el.hasAttribute('data-cv-patching')], [false, 'cv-jack cv-fjack', false], 'within the slop: nothing yet');
  R.mv(c0.x + 60, c0.y - 200);
  assert.equal(R.W.el.getAttribute('data-cv-patching'), 'cord');
  const mark = e => cls(E(e)).replace('cv-jack cv-fjack', '').trim();
  assert.deepEqual([mark(src), mark('m7.c3'), mark('c.m4'), mark('m11.i1'), mark('m1.cs'), mark('m4.tri'), mark('m3.dc')], ['cv-from', 'cv-ok', 'cv-ok', 'cv-no', 'cv-no', 'cv-no', 'cv-ok']);
  assert.deepEqual([E('m11.i1').title, E('m1.cs').title, E('m4.tri').title], ['This jack has a cord — pull it first', 'An S-trigger socket — use the controller’s trigger converter', 'Two outputs — connect an output to an input']);
  const live = R.L.log.filter(s => s.startsWith('live')).at(-1), p0 = R.port(CP.jackKey('i1', src));
  assert.equal(live, 'live ' + Math.round(p0.x) + ',' + Math.round(p0.y) + '>' + Math.round(p0.x + 60) + ',' + Math.round(p0.y - 200) + ' c' + PT.nextColor(R.rec()) + ' s0', 'from its jack to the finger (world px)');
  assert.equal(R.W.ptrs.at(-1), Math.round(c0.x + 60) + ',' + Math.round(c0.y - 200), 'edge auto-pan follows');
  // near a compatible jack: snapped, named beside the finger
  const t = R.at('m7.c3');
  R.mv(t.x + 12, t.y - 9);
  assert.deepEqual([mark('m7.c3'), R.chip().textContent, R.chip().hidden, R.chip().hasAttribute('data-no'), R.chip().style.transform],
    ['cv-ok cv-hot', '904A 1 · CONTROL INPUT 3', false, false, 'translate(' + Math.round(t.x + 12 + CP.CHIP_DX) + 'px, ' + Math.round(t.y - 9 + CP.CHIP_DY) + 'px)']);
  R.mv(t.x + 40, t.y + 40);
  assert.equal(mark('m7.c3'), 'cv-ok', 'out of reach: no target');
  R.mv(t.x + 12, t.y - 9);
  R.up(t.x + 12, t.y - 9);
  assert.deepEqual(R.edits.map(e => e.label), ['Patch cord']);
  const c = cordOf(R.rec(), 'm4.sin', 'm7.c3');
  assert.ok(c && c.a === 'm4.sin' && c.b === 'm7.c3' && c.c === PT.nextColor(MG.model15({}).rec), 'the cord, source → destination');
  assert.deepEqual([R.L.list.length, R.L.log.slice(-1)[0], R.W.el.hasAttribute('data-cv-patching'), mark(src), mark('m7.c3'), E('m11.i1').title, R.chip().hidden, R.W.ptrs.at(-1)],
    [16, 'live null', false, '', '', '902 1 · SIGNAL INPUT UPPER', true, null], 'set, then the live rope goes; marks and titles back');
  R.V.destroy(); R.H.destroy();
});

test('the target chip has its own class (cv-plugchip), not the top row\'s track chip\'s (#trkChip.cv-tchip: flex, 38 px, a background — its rules reached the chip): host, stylesheet and page agree; the track chip\'s rules stay as they were', () => {
  const R = rig(), css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  R.press('m4.sin'); R.mv(10, 10); R.to('m7.c3');
  assert.deepEqual(all(R.W.overlay).map(cls).filter(c => /chip/.test(c)), ['cv-plugchip']);
  R.up(R.at('m7.c3').x, R.at('m7.c3').y);
  R.V.destroy(); R.H.destroy();
  assert.doesNotMatch(css, /#overlay \.cv-tchip/, 'no rule of the overlay names the track chip\'s class');
  for (const sel of ['#overlay .cv-plugchip {', '#overlay .cv-plugchip[data-no] {', '#overlay .cv-plugchip[hidden] {']) assert.ok(css.includes('\n' + sel), sel);
  assert.match(css, /\n#overlay \.cv-plugchip \{ position: absolute;[^}]*pointer-events: none;/);
  assert.match(html, /<button id="trkChip" class="cv-tchip"/, 'the top row\'s chip keeps its class');
  assert.ok(css.includes('\n.cv-tchip { --tc: #f2a33a; display: flex; align-items: center; gap: 8px; height: 38px; min-width: 0; max-width: 250px; padding: 0 9px 0 5px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg2);'), 'the track chip\'s base rule unchanged');
});

test('released away from any jack a new cord vanishes; near a refused jack only: its reason (a muted chip, then a notice), nothing written; a second finger (the press\'s cancel), Escape and a pointercancel cancel mid-drag', () => {
  const R = rig();
  R.press('m4.sin'); R.mv(10, 10); R.mv(-3000, 900); R.up(-3000, 900);
  assert.deepEqual([R.edits.length, R.L.log.at(-1), R.notes], [0, 'live null', []], 'vanished');
  R.press('m4.sin'); R.mv(10, 10);
  const q = R.to('m11.i1');
  assert.deepEqual([R.chip().textContent, R.chip().hasAttribute('data-no')], ['902 1 · SIGNAL INPUT UPPER — This jack has a cord — pull it first', true]);
  R.up(q.x, q.y);
  assert.deepEqual([R.edits.length, R.notes], [0, ['902 1 · SIGNAL INPUT UPPER: This jack has a cord — pull it first']]);
  for (const how of ['finger', 'escape', 'pcancel']) {
    const h = R.press('m4.sin'), n = R.L.log.length;
    R.mv(10, 10); R.to('m7.c3');
    assert.equal(R.H.active(), true, how + ': in flight');
    if (how === 'finger') h.cancel();
    else if (how === 'escape') key(R.doc.body, 'Escape');
    else { fire(R.doc.body, 'pointercancel', { pointerId: 999, pointerType: 'touch' }); assert.equal(R.H.active(), true, 'another pointer\'s: not ours'); fire(R.doc.body, 'pointercancel', { pointerId: R.pid(), pointerType: 'touch' }); }
    assert.deepEqual([R.H.active(), R.edits.length, R.L.log.slice(n).at(-1), R.W.el.hasAttribute('data-cv-patching'), cls(R.el('m7.c3')), R.chip().hidden], [false, 0, 'live null', false, 'cv-jack cv-fjack', true], how);
  }
  // a pulled plug springs back (the layer's drop), nothing written
  const h = R.press('m7.c1');
  R.mv(10, 10); R.mv(-4000, 0); h.cancel();
  assert.deepEqual([R.L.log.at(-1), R.edits.length, R.rec().cords.some(c => c.b === 'm7.c1')], ['drop', 0, true]);
  R.V.destroy(); R.H.destroy();
});

test('review 2 F3: the jack under the finger decides first (its hit circle on the glass: clamp(28, 44 px, --jp · k) / 2) — a refused one is refused (its reason, nothing written) however near a compatible neighbour is, at the fit zoom (k 0.6: neighbours 26–30 px apart, inside SNAP_PX) as at 1; a free one is plugged; over none the nearest compatible within SNAP_PX still snaps; the finger back on the cord\'s own start is no target (no neighbour taken, a pulled plug springs back)', () => {
  for (const k of [0.6, 1]) {
    const R = rig({ k }), mark = e => cls(R.el(e)).replace('cv-jack cv-fjack', '').trim(), why = 'This jack has a cord — pull it first';
    // an occupied jack (902 1 CONTROL INPUT 1) under the finger; the free CONTROL INPUT 3 is 29 px away at k 0.6
    R.press('c.kv'); R.mv(10, 10);
    const o = R.to('m11.c1');
    assert.deepEqual([mark('m11.c3'), mark('m11.c1'), R.chip().textContent, R.chip().hasAttribute('data-no')], ['cv-ok', 'cv-no', '902 1 · CONTROL INPUT 1 — ' + why, true], 'k ' + k + ': refused, not its neighbour');
    R.up(o.x, o.y);
    assert.deepEqual([R.edits.length, R.notes.at(-1), mark('m11.c3')], [0, '902 1 · CONTROL INPUT 1: ' + why, ''], 'k ' + k + ': nothing written, the reason said');
    // over no jack: the nearest compatible within SNAP_PX still snaps (902 2's free CONTROL INPUT 3, a little below it: past its hit circle)
    R.press('c.kv'); R.mv(10, 10);
    const i = R.at('m12.c3'), gap = k === 1 ? 28 : 20;
    R.mv(i.x, i.y + gap);
    assert.deepEqual([mark('m12.c3'), R.chip().textContent], ['cv-ok cv-hot', '902 2 · CONTROL INPUT 3'], 'k ' + k + ': ' + gap + ' px off a free jack: snapped');
    R.mv(i.x, i.y + 40);
    assert.deepEqual([mark('m12.c3'), R.chip().hidden], ['cv-ok', true], 'k ' + k + ': out of reach');
    R.H.cancel();
    // the free jack under the finger: plugged there
    R.press('c.kv'); R.mv(10, 10);
    const f = R.to('m11.c3');
    assert.deepEqual([mark('m11.c3'), R.chip().textContent], ['cv-ok cv-hot', '902 1 · CONTROL INPUT 3'], 'k ' + k);
    R.up(f.x, f.y);
    assert.deepEqual([R.edits.map(e => e.label), !!cordOf(R.rec(), 'c.kv', 'm11.c3')], [['Patch cord'], true], 'k ' + k);
    // the finger back on the new cord\'s own start: no target — the neighbour (k 0.6: 902 2's SIGNAL INPUT UPPER, 30 px off) is not taken
    const n = R.edits.length;
    R.press('m12.o1'); R.mv(10, 10);
    const s0 = R.to('m12.o1');
    assert.deepEqual([mark('m12.i1'), R.chip().hidden], ['cv-ok', true], 'k ' + k + ': held on its start');
    R.up(s0.x + 2, s0.y);
    assert.deepEqual([R.edits.length, R.L.log.at(-1)], [n, 'live null'], 'k ' + k + ': the cord vanishes');
    // a pulled plug let go on its cord\'s other end: it springs back (not pulled out, not a neighbour's)
    const id = cordOf(R.rec(), 'm9.out', 'm7.c1').id, nn = R.notes.length;
    R.press('m7.c1'); R.mv(10, 10);
    const e0 = R.to('m9.out');
    assert.equal(R.chip().hidden, true, 'k ' + k + ': no verdict on the other end');
    R.up(e0.x, e0.y);
    assert.deepEqual([R.edits.length, R.L.log.at(-1), R.rec().cords.some(x => x.id === id), R.notes.length], [n, 'drop', true, nn], 'k ' + k + ': stays plugged');
    R.V.destroy(); R.H.destroy();
  }
});

test('a plugged jack\'s plug is pulled (grab / move / drop): let go away from any jack the cord comes out (one "Pull cord" step, "Cord pulled · tap to undo"); onto a compatible empty jack it is re-patched (its id and colour kept); back on its own jack: nothing', () => {
  const R = rig(), id = cordOf(R.rec(), 'm9.out', 'm7.c1').id, col = cordOf(R.rec(), 'm9.out', 'm7.c1').c;
  // re-patch: m7.c1's plug onto m7.c3
  R.press('m7.c1'); R.mv(0, 0);
  assert.ok(R.L.log.some(s => s.startsWith('grab ' + id + ' b ')), 'its end b grabbed');
  assert.deepEqual([cls(R.el('m9.out')).replace('cv-jack cv-fjack', '').trim(), cls(R.el('m7.c1')).replace('cv-jack cv-fjack', '').trim()], ['cv-from', 'cv-ok'], 'the cord\'s other end fixed; its own jack free');
  const t = R.to('m7.c3');
  assert.ok(R.L.log.at(-1).startsWith('move '), 'the plug follows the finger');
  R.up(t.x, t.y);
  const c = R.rec().cords.find(x => x.id === id);
  assert.deepEqual([R.edits.map(e => e.label), c.a, c.b, c.c, R.L.log.at(-1)], [['Re-patch cord'], 'm9.out', 'm7.c3', col, 'drop']);
  // back on its own jack: nothing
  R.press('m7.c3'); R.mv(0, 0);
  const o = R.to('m7.c3'); R.up(o.x, o.y);
  assert.deepEqual([R.edits.length, R.L.log.at(-1)], [1, 'drop']);
  // away: out
  R.press('m7.c3'); R.mv(0, 0); R.mv(-4000, 2000); R.up(-4000, 2000);
  assert.deepEqual([R.edits.map(e => e.label), R.rec().cords.some(x => x.id === id), R.notes], [['Re-patch cord', 'Pull cord'], false, ['Cord pulled · tap to undo [tap]']]);
  R.V.destroy(); R.H.destroy();
});

test('a tap: on an empty jack "Connect to…" (its compatible jacks by module; a pick is one "Patch cord" step); on a plug the cord\'s menu — its ends, eight swatches (its colour checked), Remove; a swatch recolours (one step; the same colour none), Remove pulls it ("tap to undo"); the cord outlined while the menu is open', () => {
  const R = rig();
  let c = R.at('m4.sin');
  R.press('m4.sin'); R.up(c.x + 2, c.y + 1);
  const L = menuLabels(R.doc);
  assert.equal(L[0], 'Connect 921B 2 · SINE OUT to…');
  assert.ok(L.includes('Controller') && L.includes('904A 1') && L.includes('921B 2'), L.join('|') + ' (feedback into its own module is allowed)');
  assert.ok(!L.includes('911 1') && L.includes('921A 1'), 'a module with no free compatible jack is not listed (the 911: its S-trigger input holds a cord)');
  const ctx = menus(R.doc).at(-1), items = all(ctx).filter(n => cls(n).split(' ').includes('wk-ci'));
  assert.equal(R.edits.length, 0);
  // the 904A's submenu: its free inputs (CONTROL INPUT 3 — c1 / c2 / in hold cords)
  const i904 = items.find(n => n.textContent.includes('904A 1'));
  ptr(i904, 'pointerdown', 0, 0, { pointerId: 7 }); i904.dispatchEvent(new Ev('click', { bubbles: true }));
  const sub = menus(R.doc).at(-1), subL = all(sub).filter(n => cls(n) === 'wk-cl').map(n => n.textContent);
  assert.deepEqual(subL, ['CONTROL INPUT 3']);
  const it = all(sub).find(n => cls(n).split(' ').includes('wk-ci'));
  ptr(it, 'pointerdown', 0, 0, { pointerId: 7 }); it.dispatchEvent(new Ev('click', { bubbles: true }));
  assert.deepEqual([R.edits.map(e => e.label), !!cordOf(R.rec(), 'm4.sin', 'm7.c3')], [['Patch cord'], true]);
  for (const m of menus(R.doc)) m.remove();
  // a plug: the cord's menu
  const cord = cordOf(R.rec(), 'm3.saw', 'c.m1');
  c = R.at('c.m1');
  R.press('c.m1'); R.up(c.x, c.y);
  const box = cmenu(R.doc);
  const sw = all(box).filter(n => cls(n) === 'cv-cm-c'), rm = all(box).find(n => cls(n) === 'cv-cm-x');
  assert.deepEqual([box.getAttribute('role'), all(box).find(n => cls(n) === 'cv-cm-t').textContent, sw.length, sw.map(b => b.getAttribute('aria-checked')).indexOf('true'), sw.map(b => b.getAttribute('aria-label')).join(), sw[2].style.getPropertyValue('--cc'), rm.textContent, R.L.log.at(-1)],
    ['menu', '921B 1 · SAWTOOTH OUT → Controller · MIXER INPUT 1', 8, cord.c, 'Red,Yellow,Blue,Green,Cream,Orange,Violet,Black', '#3f80d8', 'Remove cord', 'sel ' + cord.id]);
  sw[cord.c].click();
  assert.deepEqual([R.edits.length, cmenu(R.doc), R.L.log.at(-1)], [1, null, 'sel null'], 'the same colour: no step; closed');
  R.press('c.m1'); R.up(c.x, c.y);
  all(cmenu(R.doc)).filter(n => cls(n) === 'cv-cm-c')[6].click();
  assert.deepEqual([R.edits.map(e => e.label).at(-1), R.rec().cords.find(x => x.id === cord.id).c, R.L.list.find(x => x.id === cord.id).c], ['Cord colour', 6, 6]);
  R.press('c.m1'); R.up(c.x, c.y);
  all(cmenu(R.doc)).find(n => cls(n) === 'cv-cm-x').click();
  assert.deepEqual([R.edits.map(e => e.label).at(-1), R.rec().cords.some(x => x.id === cord.id), R.notes.at(-1)], ['Pull cord', false, 'Cord pulled · tap to undo [tap]']);
  // a press outside closes it; nothing written
  R.press('c.m2'); const c2 = R.at('c.m2'); R.up(c2.x, c2.y);
  assert.ok(cmenu(R.doc));
  ptr(R.doc.body, 'pointerdown', 1, 1, { pointerId: 50 });
  assert.deepEqual([cmenu(R.doc), R.edits.length], [null, 3]);
  R.V.destroy(); R.H.destroy();
});

test('the keyboard: Enter / Space / the ContextMenu key on a focused cord jack opens its menu (on a plug the cord\'s, focus on its colour; the arrows move along the swatches and Remove; Escape closes it, focus back on the jack); a right-click opens it at the pointer; an empty jack: Connect to…', () => {
  const R = rig(), j = R.el('c.m1'), cord = cordOf(R.rec(), 'm3.saw', 'c.m1');
  j.focus();
  let e = key(j, 'Enter');
  const box = cmenu(R.doc), sw = all(box).filter(n => cls(n) === 'cv-cm-c');
  assert.deepEqual([e.defaultPrevented, R.doc.activeElement === sw[cord.c]], [true, true]);
  key(R.doc.activeElement, 'ArrowRight');
  assert.equal(R.doc.activeElement === sw[cord.c + 1], true);
  key(R.doc.activeElement, 'End');
  assert.equal(cls(R.doc.activeElement), 'cv-cm-x');
  key(R.doc.activeElement, 'ArrowDown');
  assert.equal(R.doc.activeElement === sw[0], true, 'wraps');
  key(R.doc.activeElement, 'Escape');
  assert.deepEqual([cmenu(R.doc), R.doc.activeElement === j], [null, true]);
  for (const k of [' ', 'ContextMenu']) { key(j, k); assert.ok(cmenu(R.doc), k); key(R.doc.activeElement, 'Escape'); }
  fire(j, 'contextmenu', { clientX: 300, clientY: 200 });
  assert.ok(cmenu(R.doc), 'a right-click');
  key(R.doc.activeElement, 'Escape');
  const ej = R.el('m4.sin');
  ej.focus(); key(ej, 'Enter');
  assert.equal(menuLabels(R.doc)[0], 'Connect 921B 2 · SINE OUT to…');
  assert.equal(R.edits.length, 0);
  R.V.destroy(); R.H.destroy();
});

test('review 2 F1: a History move closes the menus (cancel() — undo / redo / applyRestore / a track switch call it first), and a pick re-reads the shown patch: a cord that is gone writes nothing (no step: redo survives), a record replaced under the menu is written on its current self, never the one seen at open', () => {
  let shown = null;
  const R = rig({ deps: { cur: () => shown } }), id = cordOf(R.rec(), 'm3.saw', 'c.m1').id, c = R.at('c.m1'), rec0 = R.rec();
  shown = { t: R.t, dev: 'i1' };
  R.H.sync();
  const open = () => { R.press('c.m1'); R.up(c.x, c.y); const b = cmenu(R.doc); return { sw: all(b).filter(n => cls(n) === 'cv-cm-c'), rm: all(b).find(n => cls(n) === 'cv-cm-x') }; };
  // an undo ran under the open menu: cancel() is the host's first call, and the record then lacks the cord
  let M = open();
  assert.equal(R.H.stats().menu, true);
  R.t.dev.i1.patch = PT.pull(rec0, id).rec;
  R.H.cancel();
  assert.deepEqual([R.H.stats().menu, !!cmenu(R.doc), R.L.log.at(-1)], [false, false, 'sel null'], 'closed');
  M.sw[3].click(); M.rm.click();
  assert.deepEqual([R.edits.length, R.notes, R.rec().cords.some(x => x.id === id)], [0, [], false], 'a pick on the buttons it kept: nothing written, the cord not back');
  // belt and braces (a path that does not call cancel): the cord gone → nothing; the record replaced, the cord still there → the pick lands on the current record
  R.t.dev.i1.patch = rec0;
  M = open();
  R.t.dev.i1.patch = PT.pull(rec0, id).rec;
  M.rm.click(); M.sw[2].click();
  assert.deepEqual([R.edits.length, R.notes, !!cmenu(R.doc)], [0, [], false], 'Remove / a swatch of a cord that is gone');
  R.t.dev.i1.patch = rec0;
  M = open();
  const other = PT.plug(rec0, 'm4.sin', 'm7.c3').rec;
  R.t.dev.i1.patch = other;
  M.sw[3].click();
  const w = R.rec();
  assert.deepEqual([R.edits.map(e => e.label), w.cords.find(x => x.id === id).c, !!cordOf(w, 'm4.sin', 'm7.c3')], [['Cord colour'], 3, true], 'recoloured on the current record: the cord plugged since is still there');
  // another track shown (the host's selectTrack calls cancel; a pick on a button kept anyway checks the track by id): nothing is written; the same track as a new object (an undo's restore) is the same track
  R.t.dev.i1.patch = rec0;
  M = open();
  shown = { t: Object.assign({}, R.t, { id: 'trk_2' }), dev: 'i1' };
  M.sw[1].click();
  assert.equal(R.edits.length, 1, 'another track: nothing written');
  shown = { t: Object.assign({}, R.t), dev: 'i1' };
  M = open();
  M.sw[1].click();
  assert.deepEqual([R.edits.length, R.rec().cords.find(x => x.id === id).c], [2, 1], 'the same track (a new object): written');
  // Connect to… closes at cancel() too
  const e = R.at('m4.sin');
  R.press('m4.sin'); R.up(e.x, e.y);
  assert.equal(menus(R.doc).length, 1);
  R.H.cancel();
  assert.equal(menus(R.doc).length, 0, 'Connect to… closed');
  R.H.cancel(); // (nothing open: a no-op)
  R.V.destroy(); R.H.destroy();
});

test('below READ_K the cord jacks sleep: a press is not taken (a press pans: the world\'s) unless the module is in edit state; #world[data-cv-cordsleep] follows the zoom\'s end (style.css: they let a press through)', () => {
  const R = rig({ k: READ_K - 0.1 });
  assert.equal(R.W.el.hasAttribute('data-cv-cordsleep'), true, 'at the host\'s start');
  assert.equal(R.press('m4.sin'), false, 'asleep');
  R.V.modules.get('i1/m4').el.setAttribute('data-cv-edit', '');
  const h = R.press('m4.sin');
  assert.equal(typeof h.cancel, 'function', 'in edit state: awake');
  h.cancel();
  R.V.modules.get('i1/m4').el.removeAttribute('data-cv-edit');
  R.W.edit = 'i1/m4';
  assert.equal(typeof R.press('m4.sin').cancel, 'function', 'the world\'s edit id');
  R.H.cancel();
  R.W.edit = null;
  R.W.k = 1; R.W.emit('cameraend', {});
  assert.equal(R.W.el.hasAttribute('data-cv-cordsleep'), false);
  assert.equal(typeof R.press('m4.sin').cancel, 'function');
  R.H.cancel();
  R.W.k = 0.3; R.W.emit('cameraend', {});
  assert.equal(R.W.el.hasAttribute('data-cv-cordsleep'), true);
  R.H.destroy();
  R.W.k = 1; R.W.emit('cameraend', {});
  assert.equal(R.W.el.hasAttribute('data-cv-cordsleep'), true, 'destroyed: its listener gone');
  R.V.destroy();
});

/* ---------------------------------------------------------------- modules */
test('add (a tap: its row\'s first free slot; a drop: where released, on the dots) / delete (its cords out, a driver\'s modules undriven, one step, "tap to undo", its lay entry gone, its knobs kept) / duplicate (its values, no cords, beside it) / driver — one step each, numbered past every module and orphan', () => {
  const R = rig();
  const pos0 = Object.fromEntries([...R.V.modules].map(([k, m]) => [k, m.x + ',' + m.y]));
  let mid = R.H.add('911');
  const lay = R.edits.at(-1).r.lay;
  assert.deepEqual([mid, R.edits.at(-1).label, lay['i1/m13']], ['m13', 'Add 911', { x: 0, y: -1536 }], 'both rows full: a row above');
  assert.deepEqual(Object.keys(lay).sort(), Object.keys(R.rec().mods).map(k => 'i1/' + k).sort(), 'the modules Tidy placed: pinned in the same step');
  assert.deepEqual(Object.fromEntries([...R.V.modules].filter(([k]) => k !== 'i1/m13').map(([k, m]) => [k, m.x + ',' + m.y])), pos0, 'nothing moved under it');
  assert.deepEqual([R.V.modules.get('i1/m13').x, R.V.modules.get('i1/m13').y, R.V.modules.get('i1/m13').kind], [0, -1536, 'pm']);
  mid = R.H.add('995', { x: 1003, y: -610 });
  assert.deepEqual([mid, R.edits.at(-1).r.lay], ['m14', { 'i1/m14': { x: 992, y: -608 } }], 'dropped: on the dots (the rest pinned already)');
  R.W.snap = false;
  R.H.add('995', { x: 1003.4, y: -610 });
  assert.deepEqual(R.edits.at(-1).r.lay['i1/m15'], { x: 1003, y: -610 }, 'Snap off');
  // knobs on m7 (the 904A), then delete it: three cords out, one step, its knobs kept (an orphan for undo)
  R.t.dev.i1.vals = PT.setKnob(R.t.dev.i1.vals, R.rec(), 'm7', 're', 6);
  const n0 = R.rec().cords.length;
  assert.equal(R.H.remove('m7'), true);
  assert.deepEqual([R.edits.at(-1).label, R.rec().cords.length, R.rec().mods.m7, R.t.lay['i1/m7'], R.V.modules.has('i1/m7'), R.t.dev.i1.vals.p.m7.re, R.notes.at(-1)],
    ['Delete 904A 1', n0 - 4, undefined, undefined, false, 6, 'Deleted 904A 1 and 4 cords · tap to undo [tap]']);
  R.H.remove('m2');
  assert.deepEqual([R.rec().mods.m3.drv, R.rec().mods.m4.drv, R.H.title(R.t, 'i1', 'm3').sub], [undefined, undefined, ''], 'the 921Bs undriven');
  assert.equal(R.H.remove('c'), false, 'the controller has no Delete');
  // a new module: never an orphan's number (m7's knobs live on)
  assert.equal(R.H.add('911'), 'm16');
  R.V.destroy(); R.H.destroy();
  // duplicate: its values, no cords — beside it when that room is free, else its row's first free slot
  const D = rig();
  D.t.dev.i1.vals = PT.setKnob(D.t.dev.i1.vals, D.rec(), 'm12', 'fc', 2.5);
  let d = D.H.duplicate('m12');
  assert.deepEqual([d, D.edits.at(-1).label, D.edits.at(-1).r.lay['i1/m13'], D.t.dev.i1.vals.p[d].fc, D.rec().cords.filter(c => c.a.startsWith(d + '.') || c.b.startsWith(d + '.')).length],
    ['m13', 'Duplicate 902 2', { x: 992, y: -512 }, 2.5, 0]);
  d = D.H.duplicate('m11');
  assert.deepEqual([d, D.edits.at(-1).r.lay], ['m14', { 'i1/m14': { x: 0, y: -1536 } }], 'beside it taken: the row above');
  assert.equal(D.H.duplicate('c'), null, 'the controller: none');
  // the driver: a step; the same again none; none
  const a = D.H.add('921a');
  assert.equal(D.H.driver('m3', a), true);
  assert.deepEqual([D.rec().mods.m3.drv, D.edits.at(-1).label, D.H.driver('m3', a), D.H.title(D.t, 'i1', 'm3').sub, D.V.modules.get('i1/m3').title], [a, 'Driver', false, 'on 921A 2', '921B 1'], 'the same driver again: no step');
  D.H.driver('m3', null);
  assert.deepEqual([D.rec().mods.m3.drv, D.H.driver('m7', 'm2'), D.notes.at(-1)], [undefined, false, 'This module takes no driver']);
  D.V.destroy(); D.H.destroy();
});

test('presets / Init / Tidy: Patches… (each a step "Load <name>" carrying the knobs\' back meta, missing modules added in free slots, "tap to undo"); Init patch (every cord out, every knob at its default); Tidy patch (every module to its rack place, one step; already tidy: none); the ⋯ items', () => {
  const R = rig();
  assert.deepEqual(R.H.items(R.t, 'i1', 'c').map(i => i.label), ['Patches', 'Tidy patch']);
  assert.deepEqual(R.H.items(R.t, 'i1', 'c')[0].sub.map(i => i.label || '—'), ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells', '—', 'Init patch']);
  assert.deepEqual(R.H.items(R.t, 'i1', 'c')[0].sub.filter(i => i.checked).map(i => i.label), ['Classic bass']);
  assert.deepEqual(R.H.items(R.t, 'i1', 'm3').map(i => i.label || '—'), ['Duplicate', 'Driver', '—', 'Delete']);
  assert.deepEqual(R.H.items(R.t, 'i1', 'm3')[1].sub.map(i => i.label + (i.checked ? '*' : '')), ['921A 1*', 'None']);
  assert.deepEqual(R.H.items(R.t, 'i1', 'm7').map(i => i.label || '—'), ['Duplicate', '—', 'Delete'], 'no driver for an unlinked type');
  assert.equal(R.H.tidy(), false, 'already tidy: no step');
  R.H.items(R.t, 'i1', 'c')[0].sub.find(i => i.label === 'Drone').action();
  const e = R.edits.at(-1);
  assert.deepEqual([e.label, R.rec().name, R.rec().cords.length, Array.isArray(e.r.back.f) && e.r.back.f.length > 0, R.notes.at(-1)], ['Load Drone', 'Drone', 8, true, 'Loaded Drone · tap to undo [tap]']);
  assert.equal(R.t.dev.i1.vals.x4, MG.PRESETS.find(p => p.name === 'Drone').v.c.x4, 'its knobs written (the preset\'s own value: K9 retuned the levels after this test was written)');
  // a patch without the modules a preset needs: added, placed in free slots
  R.H.remove('m8');
  R.H.preset('Bells');
  const b = R.edits.at(-1);
  assert.deepEqual([b.label, Object.keys(b.r.lay || {}), R.rec().mods.m13 && R.rec().mods.m13.t], ['Load Bells', ['i1/m13'], '907a']);
  R.H.init();
  assert.deepEqual([R.edits.at(-1).label, R.rec().cords.length, R.notes.at(-1)], ['Init patch', 0, 'Init patch · tap to undo [tap]']);
  R.t.lay['i1/m1'] = { x: 3000, y: 3000 }; R.V.sync(R.t);
  assert.equal(R.H.tidy(), true);
  assert.deepEqual([R.edits.at(-1).label, R.t.lay['i1/m1']], ['Tidy patch', { x: 0, y: -1024 }]);
  R.V.destroy(); R.H.destroy();
});

/* ---------------------------------------------------------------- the faces */
test('moduleBody: a module\'s face over vals.p[mid] — one control per param, read through getKnob (an entry of another type reads the defaults), a write the host\'s knob policy (no step), data-nomod on every control, data-dev the module\'s key; refresh() after an outside change; destroy; a type this build lacks: an honest blank', () => {
  const R = rig(), B = R.bodies.get('i1/m7'), root = B.el;
  const ctl = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
  const dests = all(root).filter(n => n.getAttribute && n.getAttribute('data-dest') != null);
  assert.deepEqual([ctl, root.getAttribute('data-dev'), dests.length, dests.filter(n => n.getAttribute('data-nomod') !== '1').length], [['fc', 'rg', 're'], 'i1/m7', 3, 0], 'its params in the Tab order; no canvas modulation into them');
  const rgW = all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === 'rg').childNodes[0];
  assert.equal(rgW.getAttribute('aria-valuenow'), '1', 'FREQUENCY RANGE 2 (index 1)');
  R.t.dev.i1.vals = PT.setKnob(R.t.dev.i1.vals, R.rec(), 'm7', 'rg', 0);
  B.refresh();
  assert.equal(rgW.getAttribute('aria-valuenow'), '0');
  const n0 = R.edits.length;
  B.panel.set('re', 7.5);
  assert.deepEqual([R.knobs.at(-1), R.t.dev.i1.vals.p.m7.re, R.edits.length], ['m7.re=7.5', 7.5, n0], 'the knob policy: no step');
  B.panel.set('re', 8, 'end');
  assert.deepEqual(R.knobs.slice(-2), ['m7.re=8', 'm7.re=8 end'], 'a drag\'s lift: its end');
  // `_t` checked: an entry of another type reads the defaults
  R.t.dev.i1.vals = Object.assign({}, R.t.dev.i1.vals, { p: Object.assign({}, R.t.dev.i1.vals.p, { m7: { _t: '911', re: 9, fc: 5 } }) });
  B.refresh();
  assert.deepEqual([R.H.knobGet(R.t, 'i1', 'm7', 're'), R.H.knobGet(R.t, 'i1', 'm7', 'fc')], [0, 0]);
  const nb = R.H.bodies.size;
  B.destroy();
  assert.deepEqual([R.H.bodies.size, root.parentNode], [nb - 1, null]);
  const X = CP.moduleBody({ host: R.H, t: R.t, dev: 'i1', mid: 'm99', type: 'zz9', doc: R.doc });
  assert.deepEqual([cls(X.el), X.el.textContent, X.panel], ['cv-pmissing', 'This module needs a newer version of the app', null]);
  R.V.destroy(); R.H.destroy();
});

test('DOM per module (§4.1): a 1 MU patch module ≤ 90 elements outside its face\'s art (bar ≤ 6, its controls, a span per jack); the 907A and the 921 too; the controller\'s jacks ≤ 160 with its bar', () => {
  const R = rig();
  const count = k => { const m = R.V.modules.get(k), deco = new Set(); for (const d of all(m.el).filter(n => cls(n).split(' ').includes('hw-decor'))) for (const n of all(d)) deco.add(n); return all(m.el).filter(n => !deco.has(n)).length; };
  const counts = Object.fromEntries(['i1/m2', 'i1/m3', 'i1/m5', 'i1/m6', 'i1/m7', 'i1/m9', 'i1/m11', 'i1/m1', 'i1/m8'].map(k => [k, count(k)]));
  for (const [k, n] of Object.entries(counts)) assert.ok(n <= 90, k + ': ' + n);
  assert.ok(count('i1') <= 160, 'the controller: ' + count('i1'));
  assert.equal(all(R.V.modules.get('i1/m3').bar).length, 6);
  R.V.destroy(); R.H.destroy();
});

test('the user\'s rule (§12): only the plug ends take presses — the host listens for no press on the cord layer or the canvas; a non-cord jack and a jack of another instrument are not its', () => {
  const R = rig(), out = R.V.modules.get('i1').jack('out');
  const e = new Ev('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, pointerId: 3, pointerType: 'touch', button: 0 });
  assert.equal(R.H.press(e, out), false, 'the instrument\'s audio out');
  const fake = R.doc.createElement('span');
  fake.setAttribute('data-cv-jack', 'i2/m3.j-saw'); fake.setAttribute('data-kind', 'cord');
  assert.equal(R.H.press(e, fake), false, 'another instrument\'s');
  assert.equal(R.H.press(new Ev('pointerdown', { button: 2, pointerId: 4 }), R.el('m4.sin')), false, 'a right button');
  // nothing on the world but its keys and right-click: a pointerdown on the canvas or a module's art starts nothing here
  ptr(R.W.el, 'pointerdown', 50, 50, { pointerId: 9 }); ptr(R.doc.body, 'pointermove', 200, 50, { pointerId: 9 }); ptr(R.doc.body, 'pointerup', 200, 50, { pointerId: 9 });
  assert.deepEqual([R.H.active(), R.H.stats().drag, R.edits.length, R.L.log.some(s => /^(live|grab) /.test(s))], [false, null, 0, false]);
  R.V.destroy(); R.H.destroy();
});

test('without a cord layer (lane C9 not there yet, or a world without one) the drag, the marks, the chip, the menus and the edits work the same; a layer that throws never breaks a drag', () => {
  for (const cords of [() => null, () => ({ set() { throw new Error('x'); }, live() { throw new Error('x'); }, anchors() {}, grab() { throw new Error('x'); } })]) {
    const R = rig({ deps: { cords } }), err = console.error;
    console.error = () => {};
    try {
      R.press('m4.sin'); R.mv(10, 10);
      const t = R.to('m7.c3');
      assert.equal(R.chip().textContent, '904A 1 · CONTROL INPUT 3');
      R.up(t.x, t.y);
      R.press('m9.out'); R.mv(10, 10); R.mv(-4000, 0); R.up(-4000, 0);
      assert.deepEqual([R.edits.map(e => e.label), !!cordOf(R.rec(), 'm4.sin', 'm7.c3'), R.rec().cords.some(c => c.a === 'm9.out')], [['Patch cord', 'Pull cord'], true, false]);
    } finally { console.error = err; }
    R.V.destroy(); R.H.destroy();
  }
});
