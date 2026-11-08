import './v8-guard.mjs';
// kit-ui.js (stage DM lane F; docs/canvas/IMPL-DM.md §4, §7.3, §9.2): our drum machine's faces on the RIG grid — the Sequencer (19
// columns, 1248 px: the head of segs and boxes, the step grid as one canvas + one hit layer + one playhead + a lamp a row, the row
// headers, "+ ADD DRUM") and the voice faces (4 columns, 288 × 236: TYPE, HIT, two knob rows of KIT.IDS' controls), every control
// driven against FAKES of lane S's side (kit-core's record through normKit, a drum api with step / lit / on / pads) and lane H's (vals,
// set, edit = one History step, menu, notice): taps, paints, velocity drags, the step menu, the keyboard cursor, mute / solo, the
// pattern seg, LENGTH / SWING / CLEAR, "+ ADD DRUM", TYPE, Remove / Reset, the HIT pad as the one music zone (velocity by height, two
// fingers two hits, the off at the last lift), the two-finger cancel, the heard time (≤ 1 transform + ≤ 16 flips a step, no canvas repaint, nothing created,
// nothing queued while stopped, nothing written off screen), kitHost's size / rack / devices / cellRect, the rig-grid numbers (the two
// additive ones; every existing output byte for byte), KIT.TINT on the skins' screens, D6's imports. The browser's boxes (G8) are
// tests/ui-layout-kit.mjs. Never passes fake-DOM nodes to assert (safeAssert: nodes become tags).
// Run alone: node --max-old-space-size=2048 --test tests/kit-ui.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const D = await import('./serum-ui-stubs/dom.js');
const assert = D.safeAssert(assertBase);
const RG = await import('../rig-grid.js?v=9');
const KC = await import('../kit-core.js?v=9');
const UI = await import('../kit-ui.js?v=9');
const CM = await import('../cv-mods-ui.js?v=9');
const { KEY_VEL } = await import('../cv-keys.js?v=9');
const { KIT } = KC, { GRID } = RG;

const SRC = readFileSync(new URL('../kit-ui.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const code = s => KIT.CODES[s];
const id = (s, f) => code(s) + f;

/* ---------------------------------------------------------------- the fakes: S's record and drum api, H's vals / set / edit / menu */
// the Starter kit's eight voices on a record (S's normKit), cells [[slot, step, v], …] in pattern o.pat (A)
function mkRec(vals, cells = [], o = {}) {
  const ty = KIT.CODES.map(c => vals[c + 't'] | 0), nm = KIT.CODES.map((c, j) => (KIT.STARTER[j] ? KIT.STARTER[j].nm : ''));
  const map = {}; KIT.CODES.forEach((c, j) => { map[c] = KIT.STARTER[j] ? [KIT.STARTER[j].n] : []; });
  const pat = []; for (let p = 0; p < 8; p++) pat.push({ len: p === (o.pat || 0) ? (o.len || 16) : 16, cells: p === (o.pat || 0) ? cells.map(([l, s, v]) => ({ l, s, v })) : [] });
  return KC.normKit({ ty, nm, map, pat, ui: { pat: o.pat || 0 }, x: { swing: o.swing || 50, mute: o.mute || 0, solo: o.solo || 0 } });
}
function env(o = {}) {
  const d = D.fresh(), vals = Object.assign({}, KIT.KITS[0].v, o.vals || {});
  let rec = o.rec ? o.rec(vals) : mkRec(vals, o.cells || [], o);
  const log = [], menus = [], subs = { step: new Set(), lit: new Set(), on: new Set() }, led = { step: -1 };
  const sub = (S, f) => { S.add(f); return () => S.delete(f); };
  const api = {
    state: () => ({ D: rec, S: KC.initState(), run: led.step >= 0 }),
    step: f => sub(subs.step, f), lit: f => sub(subs.lit, f), on: f => sub(subs.on, f),
    pads: { on(s, v, ts) { log.push(['pad', s, Math.round(v * 1000) / 1000]); return true; }, off(s) { log.push(['off', s]); } },
  };
  const deps = {
    doc: d, barH: 40,
    get: (t, dev, k) => vals[k],
    set: (t, dev, k, v, ph) => { vals[k] = v; log.push(['set', k, v, ph]); },
    drum: () => api,
    leds: () => ({ step: led.step, lit: 0 }),
    edit: (t, dev, label, r) => { log.push(['edit', label, JSON.parse(JSON.stringify(r))]); if (r.vals) Object.assign(vals, r.vals); return true; },
    menu: (x, y, items) => { menus.push(items); return { close() {} }; },
    notice: t => log.push(['notice', t]),
    raf: f => d.defaultView.requestAnimationFrame(f),
  };
  const K = UI.kitHost(deps);
  const E = { d, vals, log, menus, subs, led, api, deps, K, get rec() { return rec; }, set rec(r) { rec = r; for (const f of [...subs.on]) f(); } };
  E.edits = () => log.filter(x => x[0] === 'edit');
  return E;
}
const T = { id: 'trk_1' };
function seq(E, o = {}) {
  const root = E.d.createElement('div'); E.d.body.appendChild(root);
  const V = E.K.face('seq', root, Object.assign({ t: T, dev: 'i1' }, o));
  const hit = V.el.querySelector('.kit-hits');
  const n = V.el.querySelectorAll('.kit-rh').length;
  if (hit) hit._rect = { left: 0, top: 0, width: 16 * GRID.col, height: Math.max(1, n) * GRID.steps.cell };
  return { V, root, hit };
}
const at = (s, r) => [s * GRID.col + GRID.col / 2, r * GRID.steps.cell + GRID.steps.cell / 2];
const els = el => { let n = 0; const w = e => { n++; for (const c of e.children) w(c); }; w(el); return n; };
const lastEdit = E => { const e = E.edits().at(-1); return e ? [e[1], e[2]] : null; };

/* ================================================================ D6 / D7: the imports, the words, no layout literal */
test('(G11, D6) kit-ui.js imports only rig-grid.js, wk.js and kit-core.js, each with ?v=9; no other machine\'s or maker\'s name, no "Serum" / "Wavecraft" literal; no layout number outside rig-grid (no 48 / 24 / 1248 / 288 / 236 in its code)', () => {
  const imps = [...SRC.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm), ...SRC.matchAll(/import\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(imps.slice().sort(), ['./kit-core.js?v=9', './rig-grid.js?v=9', './wk.js?v=9']);
  assert.doesNotMatch(SRC, /Serum|Wavecraft|Xfer|\bTR-?\d|\b808\b|\b909\b|\b606\b|Roland|Linn|Simmons|Oberheim/);
  const body = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(body, /(^|[^\w.])(48|24|1248|288|236|1216|276)(?![\w.])/);
});

/* ================================================================ §4.1 rig-grid: the two additive numbers; everything else exact */
test('(§4.1) GRID.steps — the step row 48, the ruler 24 (a sibling of GRID.rows: rig-ui.test pins GRID.rows whole); GRID.rows, gridVars, cssText and layoutOf byte for byte as at phase 0', () => {
  assert.deepEqual(GRID.steps, { cell: 48, ruler: 24 });
  assert.ok(Object.isFrozen(GRID.steps));
  assert.deepEqual(GRID.rows, { head: 32, screen: 112, screenL: 128, knobs: 76, switches: 32, jacks: 56 });
  const h = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const recs = [...Object.values(CM.MOD_FACE), ...[0, 1, 4, 12].map(n => CM.combRecipe(n)), { cols: 5, mid: true, rows: [{ t: 'knobs', items: ['a', 'b', 'c'] }, { t: 'switches', items: ['x:2', 'y'] }, { t: 'screen', h: 'S', items: ['#s'] }, { t: 'jacks', items: ['<i', '>o', '>p'] }] }];
  assert.deepEqual({ css: h(RG.cssText()), vars: h(RG.gridVars()), lay: h(JSON.stringify(recs.map(r => RG.layoutOf(r)))) }, { css: '72411c62ce0decc8', vars: '8e1589f4574ecc46', lay: '92c691e6e469eb22' }); // ((ARP) cssText re-pinned: the Arpeggiator face's rules joined it — gridVars and layoutOf as at phase 0
});

/* ================================================================ §4.2–§4.3 the recipes */
test('(§4.2–4.3) FACE: the voice 4 columns (288 × 236: head · TUNE DECAY LEVEL CHOKE · k1–k4), the Sequencer 19 columns (1248 = four voices + three gaps), its grid row ruler + cell × (rows + the add row; none at 16); frozen', () => {
  const V = UI.FACE.voice, LV = RG.layoutOf(V);
  assert.deepEqual([V.cols, LV.w, LV.h, V.rows.map(r => r.t)], [4, 288, 236, ['head', 'knobs', 'knobs']]);
  assert.deepEqual(V.rows[1].items, ['u', 'd', 'l', '#c']);
  assert.deepEqual(V.rows[2].items, ['1', '2', '3', '4']);
  assert.equal(UI.VOICE_COLS, 4); assert.equal(UI.SEQ_COLS, 19);
  for (const n of [0, 1, 4, 8, 15, 16]) {
    const R = UI.seqRecipe(n), L = RG.layoutOf(R), gh = GRID.steps.ruler + GRID.steps.cell * (n + (n < 16 ? 1 : 0));
    assert.deepEqual([R.cols, L.w, R.rows.map(r => r.t), R.rows[1].h, L.h], [19, 1248, ['head', 'grid'], gh, GRID.top + GRID.rows.head + GRID.gap + gh + GRID.bottom], 'n ' + n);
    assert.equal(UI.seqH(n), L.h);
  }
  assert.equal(RG.faceW(19), 4 * RG.faceW(4) + 3 * UI.RACK_GAP);
  assert.equal(UI.RACK_GAP, 32);
  assert.equal(UI.voiceH, 236);
  assert.ok(Object.isFrozen(UI.FACE) && Object.isFrozen(UI.FACE.voice.rows) && Object.isFrozen(UI.seqRecipe(3)));
  assert.equal(UI.seqRecipe(3), UI.seqRecipe(3), 'one recipe per n');
});

/* ================================================================ §4.5–§4.6 kitHost: size, rack, devices, cellRect */
test('(§4.5) size / rack / devices: the Sequencer 1248 × (its face + the bar), a voice 288 × (236 + the bar); Tidy\'s rows of four under the Sequencer, 32 px apart in slot order; one \'pm\' entry a present voice (key iN/k<s>, compact, no fold, its name, its type, its tint)', () => {
  const E = env();
  assert.deepEqual(E.K.size(T, 'i1', 'i1'), { fixed: { w: 1248, h: UI.seqH(8) + 40 } });
  assert.deepEqual(E.K.size(T, 'i1', 'i1/kc'), { fixed: { w: 288, h: 236 + 40 } });
  assert.equal(E.K.size(T, 'i1', 'i1/kp'), null, 'an empty slot: no module');
  assert.equal(E.K.size(T, 'i1', 'i2'), null);
  const R = E.K.rack(T, 'i1'), y0 = UI.seqH(8) + 40 + 32;
  assert.deepEqual(Object.keys(R), ['ka', 'kb', 'kc', 'kd', 'ke', 'kf', 'kg', 'kh'].map(c => 'i1/' + c));
  assert.deepEqual(R['i1/ka'], { x: 0, y: y0 }); assert.deepEqual(R['i1/kd'], { x: 3 * 320, y: y0 });
  assert.deepEqual(R['i1/ke'], { x: 0, y: y0 + 276 + 32 }); assert.deepEqual(R['i1/kh'], { x: 3 * 320, y: y0 + 276 + 32 });
  const L = E.K.devices(T, 'i1');
  assert.deepEqual(L.map(x => [x.key, x.kind, x.dev, x.slot, x.type, x.title, x.fixed.w, x.fixed.h, x.compact, x.nofold]).slice(0, 4),
    [['i1/ka', 'pm', 'i1', 0, 1, 'Kick', 288, 276, true, true], ['i1/kb', 'pm', 'i1', 1, 2, 'Snare', 288, 276, true, true], ['i1/kc', 'pm', 'i1', 2, 4, 'Clap', 288, 276, true, true], ['i1/kd', 'pm', 'i1', 3, 3, 'Closed hat', 288, 276, true, true]]);
  assert.deepEqual(L.map(x => x.title), ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim']);
  assert.deepEqual([L[0].sub, L[0].color, L[3].sub, L[3].color], ['', KIT.TINT[1], 'Hi-hat', KIT.TINT[3]], 'the type as the sub when the name is another');
  // an empty kit: the Sequencer alone (its add row)
  const E0 = env({ vals: Object.fromEntries(KIT.CODES.map(c => [c + 't', 0])) });
  assert.deepEqual([E0.K.devices(T, 'i1').length, E0.K.size(T, 'i1', 'i1').fixed.h, Object.keys(E0.K.rack(T, 'i1')).length], [0, UI.seqH(0) + 40, 0]);
});

test('(§6.1) cellRect(t, dev, lane, step): a cell\'s box from the Sequencer module\'s top-left (the bar included) — the row of its present voice, the step\'s column; null for an absent voice or a step outside 0–15', () => {
  const E = env();
  const y0 = 40 + GRID.top + GRID.rows.head + GRID.gap + GRID.steps.ruler, x0 = GRID.pad + 2 * GRID.col;
  assert.deepEqual(E.K.cellRect(T, 'i1', 0, 0), { x: x0, y: y0, w: 64, h: 48 });
  assert.deepEqual(E.K.cellRect(T, 'i1', 3, 15), { x: x0 + 15 * 64, y: y0 + 3 * 48, w: 64, h: 48 });
  assert.equal(E.K.cellRect(T, 'i1', 9, 0), null);
  assert.equal(E.K.cellRect(T, 'i1', 0, 16), null);
  E.vals.kbt = 0; // (slot 1 gone: slot 3 moves up a row)
  assert.deepEqual(E.K.cellRect(T, 'i1', 3, 0).y, y0 + 2 * 48);
});

/* ================================================================ §4.2 the Sequencer face */
test('(§4.2) the Sequencer: section.rig-face[data-kit=seq] of 19 columns — the head (KIT ▾, PATTERN A–H, LENGTH, SWING, CLEAR), the grid row (one canvas, one hit layer, one playhead, the ruler 1 5 9 13, a header and a lamp a present voice in slot order, "+ ADD DRUM"); its face size follows the rows; ≤ 160 elements at 16 voices', () => {
  const E = env(), { V } = seq(E), el = V.el;
  assert.deepEqual([el.tagName, el.classList.contains('rig-face'), el.getAttribute('data-kit'), el.getAttribute('data-rig-kind'), el.style['--rig-n']], ['SECTION', true, 'seq', 'kit-seq', '19']);
  const rows = el.children.filter(n => n.classList.contains('rig-row'));
  assert.deepEqual(rows.map(r => r.className), ['rig-row rig-head', 'rig-row rig-kgrid']);
  assert.equal(rows[1].style.height, UI.seqRecipe(8).rows[1].h + 'px');
  assert.deepEqual(V.face, { kind: 'kit-seq', variant: 'kit-seq', cols: 19, w: 1248, h: UI.seqH(8) });
  const pats = el.querySelectorAll('[data-kit="pat"]');
  assert.deepEqual(pats.map(b => [b.textContent, b.getAttribute('data-p'), b.getAttribute('aria-checked')]), 'ABCDEFGH'.split('').map((c, i) => [c, String(i), i ? 'false' : 'true']));
  assert.ok(el.querySelector('[data-kit="swing"]') && el.querySelector('[data-kit="len"]') && el.querySelector('.kit-clear') && el.querySelector('.kit-kit'));
  assert.equal(el.querySelectorAll('canvas').length, 1);
  assert.deepEqual([el.querySelectorAll('.kit-hits').length, el.querySelectorAll('.kit-ph').length, el.querySelectorAll('.kit-cur').length], [1, 1, 1]);
  assert.deepEqual(el.querySelectorAll('.kit-rul').map(x => x.textContent), ['1', '5', '9', '13']);
  const hd = el.querySelectorAll('.kit-rh');
  assert.deepEqual(hd.map(h => [h.textContent, h.getAttribute('data-slot'), h.style.top]), ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim'].map((t, j) => [t, String(j), (GRID.steps.ruler + j * GRID.steps.cell) + 'px']));
  assert.equal(hd[0].style['--kit-c'], KIT.TINT[1]);
  assert.equal(el.querySelectorAll('.kit-lamp').length, 8);
  const add = el.querySelector('[data-kit="add"]');
  assert.deepEqual([add.textContent, add.hidden, add.style.top], ['+ Add drum', false, (GRID.steps.ruler + 8 * GRID.steps.cell) + 'px']);
  assert.equal(V.jacks.size, 0);
  assert.equal(V.value(), null);
  // 16 voices: no add row; the element budget
  const E16 = env({ vals: Object.fromEntries(KIT.CODES.map(c => [c + 't', 3])) }), S16 = seq(E16);
  assert.deepEqual([S16.V.el.querySelectorAll('.kit-rh').length, S16.V.el.querySelector('[data-kit="add"]').hidden, S16.V.face.h], [16, true, UI.seqH(16)]);
  assert.ok(els(S16.V.el) <= 160, els(S16.V.el) + ' elements');
});

test('(§4.4) a tap toggles a cell — ONE edit "Edit pattern" with S\'s press { k: cell, lane (the slot), step, v }: on at the row\'s last-used velocity (else 100), off at 0; steps past LENGTH are inert; the hit layer never takes the world\'s press', () => {
  const E = env({ cells: [[1, 4, 64]], len: 12 }), { V, hit } = seq(E);
  const tap = (s, r, o = {}) => { const [x, y] = at(s, r); const dn = D.ptr(hit, 'pointerdown', x, y, Object.assign({ pointerId: 7, pointerType: 'touch' }, o)); D.ptr(hit, 'pointerup', x, y, Object.assign({ pointerId: 7, pointerType: 'touch' }, o)); return dn; };
  const e = tap(2, 0);
  assert.ok(e._stop, 'a control: stopPropagation');
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'cell', lane: 0, step: 2, v: 100 } }]);
  tap(4, 1);
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'cell', lane: 1, step: 4, v: 0 } }]);
  E.rec = mkRec(E.vals, [[1, 4, 64]], { len: 12 });
  tap(6, 1); // (the row's last used: 64 → the new cell at 64)
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 1, step: 6, v: 64 });
  const n = E.edits().length;
  tap(13, 0);
  assert.equal(E.edits().length, n, 'past LENGTH: inert');
  assert.equal(V.el.querySelector('.kit-hits').getAttribute('data-gesture'), null, 'the grid is no music zone');
});

test('(§4.4) a sideways drag paints the first cell\'s new state along the row (ONE edit, press { k: paint, steps }); a vertical drag from an on-cell sets its velocity (up louder; the readout follows); the first 6 px decide; Shift-drag (mouse) sets velocity from any cell', async () => {
  const E = env({ cells: [[0, 0, 100]] }), { V, hit } = seq(E), [x0, y0] = at(1, 0);
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 3, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 4, y0, { pointerId: 3, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 2 * GRID.col, y0 + 3, { pointerId: 3, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 4 * GRID.col, y0 + 3, { pointerId: 3, pointerType: 'touch' });
  assert.equal(E.edits().length, 0, 'nothing written while painting');
  D.ptr(hit, 'pointerup', x0 + 4 * GRID.col, y0, { pointerId: 3, pointerType: 'touch' });
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'paint', lane: 0, steps: [1, 2, 3, 4, 5], v: 100 } }]);
  // velocity: up 20 px on the on-cell at step 0
  const [x1, y1] = at(0, 0);
  D.ptr(hit, 'pointerdown', x1, y1, { pointerId: 4, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x1, y1 - 8, { pointerId: 4, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x1 + 1, y1 - 20, { pointerId: 4, pointerType: 'touch' });
  const vr = V.el.querySelector('.kit-vr');
  assert.deepEqual([vr.hidden, vr.textContent], [false, '120']);
  D.ptr(hit, 'pointerup', x1, y1 - 20, { pointerId: 4, pointerType: 'touch' });
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'cell', lane: 0, step: 0, v: 120 } }]);
  assert.equal(vr.hidden, true);
  // Shift (mouse) from an off cell: a velocity from the row's last used, down = softer
  const [x2, y2] = at(7, 0);
  D.ptr(hit, 'pointerdown', x2, y2, { pointerId: 1, shiftKey: true });
  D.ptr(hit, 'pointermove', x2, y2 + 30, { pointerId: 1, shiftKey: true });
  D.ptr(hit, 'pointerup', x2, y2 + 30, { pointerId: 1, shiftKey: true });
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 0, step: 7, v: 90 });
});

test('(§4.4, D8) a second finger cancels a paint or a velocity drag (gesture.js\'s flagged pointercancel): the cells revert, no edit; a plain pointercancel ends and keeps', () => {
  const E = env(), { V, hit } = seq(E), [x0, y0] = at(0, 2);
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 5, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 3 * GRID.col, y0, { pointerId: 5, pointerType: 'touch' });
  assert.ok(V.pending(), 'a paint pending');
  D.fire(hit, 'pointercancel', { pointerId: 5, pointerType: 'touch', gesture: 'two-finger' });
  assert.deepEqual([E.edits().length, V.pending()], [0, null]);
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 6, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 2 * GRID.col, y0, { pointerId: 6, pointerType: 'touch' });
  D.fire(hit, 'pointercancel', { pointerId: 6, pointerType: 'touch' });
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'paint', lane: 2, steps: [0, 1, 2], v: 100 } }]);
  // a tap ended by a plain cancel: nothing
  const n = E.edits().length;
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 8, pointerType: 'touch' });
  D.fire(hit, 'pointercancel', { pointerId: 8, pointerType: 'touch' });
  assert.equal(E.edits().length, n);
});

test('(review R2-2) the step menu\'s close gives the focus back to the grid without a reveal: that one focusin stops at the hit layer (the canvas would pan to the grid\'s top); a later focus (Tab) reaches the canvas as before', () => {
  const E = env({ cells: [[2, 3, 127]] }), { root, hit } = seq(E), [x, y] = at(3, 2);
  let seen = 0; root.addEventListener('focusin', () => { seen++; });
  D.fire(hit, 'focusin'); assert.equal(seen, 1, 'a Tab focus: the canvas hears it');
  D.fire(hit, 'contextmenu', { clientX: x, clientY: y });
  D.fire(hit, 'focusin'); // (wk's close(true): the anchor focused again, then the item's action)
  E.menus.at(-1).find(i => i.label === 'Soft').action();
  assert.equal(seen, 1, 'the menu\'s focus restore: no reveal');
  D.fire(hit, 'focusin'); assert.equal(seen, 2, 'the next focus: heard again');
  D.fire(hit, 'contextmenu', { clientX: x, clientY: y });
  E.menus.at(-1).find(i => i.label === 'Off').action(); // (a pick whose restore went elsewhere: the guard ends with it)
  D.fire(hit, 'focusin'); assert.equal(seen, 3);
});

test('(review R2-5) a second finger landing on the face late in a paint / a velocity drag (past gesture.js\'s pairing: no flagged cancel comes) reverts it — the cells back, no edit at the lifts; on the grid or the head alike', () => {
  const E = env({ cells: [[1, 5, 100]] }), { V, hit } = seq(E), [x0, y0] = at(0, 2);
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 5, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x0 + 3 * GRID.col, y0, { pointerId: 5, pointerType: 'touch' });
  assert.ok(V.pending(), 'a paint pending');
  D.ptr(hit, 'pointerdown', x0 + 6 * GRID.col, y0 + GRID.steps.cell, { pointerId: 6, pointerType: 'touch' });
  assert.equal(V.pending(), null, 'reverted at the second finger');
  D.ptr(hit, 'pointerup', x0 + 3 * GRID.col, y0, { pointerId: 5, pointerType: 'touch' });
  D.ptr(hit, 'pointerup', x0 + 6 * GRID.col, y0, { pointerId: 6, pointerType: 'touch' });
  assert.equal(E.edits().length, 0, 'no edit');
  const [x1, y1] = at(5, 1), head = V.el.querySelector('.kit-pat');
  D.ptr(hit, 'pointerdown', x1, y1, { pointerId: 7, pointerType: 'touch' });
  D.ptr(hit, 'pointermove', x1, y1 - 30, { pointerId: 7, pointerType: 'touch' });
  assert.ok(V.pending(), 'a velocity drag pending');
  D.ptr(head, 'pointerdown', 4, 4, { pointerId: 8, pointerType: 'touch' });
  D.ptr(hit, 'pointerup', x1, y1 - 30, { pointerId: 7, pointerType: 'touch' });
  assert.deepEqual([E.edits().length, V.pending()], [0, null], 'the head too');
  D.ptr(head, 'pointerup', 4, 4, { pointerId: 8, pointerType: 'touch' });
  D.ptr(hit, 'pointerdown', x0, y0, { pointerId: 9, pointerType: 'touch' }); // (one finger again: a paint commits as ever)
  D.ptr(hit, 'pointermove', x0 + 2 * GRID.col, y0, { pointerId: 9, pointerType: 'touch' });
  D.ptr(hit, 'pointerup', x0 + 2 * GRID.col, y0, { pointerId: 9, pointerType: 'touch' });
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'paint', lane: 2, steps: [0, 1, 2], v: 100 } }]);
});

test('(review R2-12) the LENGTH and SWING spinbuttons are named "Length" / "Swing" (never wk\'s "Value"), after every update too; their labels hidden by KIT_CSS (the group caption shows)', async () => {
  const E = env(), { V } = seq(E), lab = () => ['len', 'swing'].map(k => V.el.querySelector('[data-kit="' + k + '"]').getAttribute('aria-label'));
  assert.deepEqual(lab(), ['Length', 'Swing']);
  E.rec = mkRec(E.vals, [], { len: 12, swing: 62 }); V.sync(); await D.flush(E.d, 2);
  assert.deepEqual(lab(), ['Length', 'Swing'], 'after a sync');
  assert.match(UI.KIT_CSS, /\.kit-hg > \.wk-nb > \.wk-lab \{ display: none; \}/);
});

test('(§4.4) the step menu — a right-click or a touch long-press (500 ms, ≤ 8 px): Soft · Normal · Accent · Off (KIT.VEL), the current one checked; a pick is ONE edit; the press it came from writes nothing', async () => {
  const E = env({ cells: [[2, 3, 127]] }), { hit } = seq(E), [x, y] = at(3, 2);
  D.fire(hit, 'contextmenu', { clientX: x, clientY: y });
  const M = E.menus.at(-1);
  assert.deepEqual(M.filter(i => !i.sep).map(i => [i.label, !!i.checked]), [['Soft', false], ['Normal', false], ['Accent', true], ['Off', false]]);
  M.find(i => i.label === 'Soft').action();
  assert.deepEqual(lastEdit(E), ['Edit pattern', { press: { k: 'cell', lane: 2, step: 3, v: KIT.VEL.soft } }]);
  // a touch long-press (wk.longPress → contextmenu at the cell)
  const n = E.menus.length, [x2, y2] = at(9, 0);
  D.ptr(hit, 'pointerdown', x2, y2, { pointerId: 11, pointerType: 'touch' });
  await new Promise(r => setTimeout(r, 560));
  assert.equal(E.menus.length, n + 1, 'the menu opened');
  E.menus.at(-1).find(i => i.label === 'Accent').action();
  const k = E.edits().length;
  D.ptr(hit, 'pointerup', x2, y2, { pointerId: 11, pointerType: 'touch' });
  assert.equal(E.edits().length, k, 'the long press itself toggles nothing');
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 0, step: 9, v: 127 });
});

test('(§4.4, G10) the keyboard grid: one focusable element with a cursor — arrows move it (its aria-label "Kick, step 1, off"), Space / Enter toggle, + / − ±8, Delete off, M mute, S solo; every key one edit; the cursor element moved, the canvas not repainted', () => {
  const E = env({ cells: [[0, 1, 100]] }), { V, hit } = seq(E);
  assert.equal(hit.tabIndex, 0);
  hit.focus();
  assert.match(hit.getAttribute('aria-label'), /^Kick, step 1, off$/);
  const g0 = UI.kitStats.grid;
  D.fire(hit, 'keydown', { key: 'ArrowRight' });
  assert.equal(hit.getAttribute('aria-label'), 'Kick, step 2, on, velocity 100');
  assert.equal(V.cursor().step, 1);
  assert.match(V.el.querySelector('.kit-cur').style.transform, /translate\(64px, 0px\)/);
  D.fire(hit, 'keydown', { key: '+' });
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 0, step: 1, v: 108 });
  D.fire(hit, 'keydown', { key: '-' });
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 0, step: 1, v: 92 });
  D.fire(hit, 'keydown', { key: 'Delete' });
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 0, step: 1, v: 0 });
  D.fire(hit, 'keydown', { key: 'ArrowDown' });
  D.fire(hit, 'keydown', { key: ' ' });
  assert.deepEqual(lastEdit(E)[1].press, { k: 'cell', lane: 1, step: 1, v: 100 });
  D.fire(hit, 'keydown', { key: 'm' });
  assert.deepEqual(lastEdit(E), ['Mute Snare', { press: { k: 'mute', lane: 1 } }]);
  D.fire(hit, 'keydown', { key: 'S' });
  assert.deepEqual(lastEdit(E), ['Solo Snare', { press: { k: 'solo', lane: 1 } }]);
  for (let i = 0; i < 20; i++) D.fire(hit, 'keydown', { key: 'ArrowDown' });
  assert.equal(V.cursor().row, 7, 'clamped to the rows');
  const e = D.fire(hit, 'keydown', { key: 'ArrowLeft' });
  assert.ok(e.defaultPrevented && e._stop, 'never a canvas nudge');
  assert.equal(UI.kitStats.grid, g0, 'the cursor is an element: no canvas repaint');
});

test('(§3.4) a row header: a tap mutes (ONE edit), a long press (≥ 500 ms) or a right-click solos — never both; muted / soloed from the record (data-muted / data-solo)', () => {
  const E = env({ mute: 1 << 1, solo: 1 << 3 }), { V } = seq(E), hd = V.el.querySelectorAll('.kit-rh');
  assert.deepEqual(hd.slice(0, 4).map(h => [h.hasAttribute('data-muted'), h.hasAttribute('data-solo')]), [[false, false], [true, false], [false, false], [false, true]]);
  D.ptr(hd[0], 'pointerdown', 4, 4, { pointerId: 2, timeStamp: 5000, pointerType: 'touch' });
  D.ptr(hd[0], 'pointerup', 4, 4, { pointerId: 2, timeStamp: 5100, pointerType: 'touch' });
  hd[0].click();
  assert.deepEqual(lastEdit(E), ['Mute Kick', { press: { k: 'mute', lane: 0 } }]);
  D.ptr(hd[1], 'pointerdown', 4, 4, { pointerId: 2, timeStamp: 6000, pointerType: 'touch' });
  D.ptr(hd[1], 'pointerup', 4, 4, { pointerId: 2, timeStamp: 6600, pointerType: 'touch' });
  hd[1].click();
  assert.deepEqual(lastEdit(E), ['Solo Snare', { press: { k: 'solo', lane: 1 } }]);
  const n = E.edits().length;
  D.ptr(hd[3], 'pointerdown', 4, 4, { pointerId: 2, timeStamp: 7000, pointerType: 'touch' });
  D.fire(hd[3], 'contextmenu', { clientX: 4, clientY: 4 });
  D.ptr(hd[3], 'pointerup', 4, 4, { pointerId: 2, timeStamp: 7700, pointerType: 'touch' });
  hd[3].click();
  assert.equal(E.edits().length, n + 1, 'one solo');
  assert.deepEqual(lastEdit(E), ['Unsolo Closed hat', { press: { k: 'solo', lane: 3 } }]);
  hd[1].click();
  assert.deepEqual(lastEdit(E)[0], 'Unmute Snare');
  assert.ok(hd[0].getAttribute('aria-label').startsWith('Kick'));
});

test('(§4.2) the head: PATTERN A–H (one edit, press { k: pat }), LENGTH (press { k: len, n }), SWING 50–75 % (press { k: swing, v }), CLEAR (press { k: clear }: "Clear pattern A"), KIT ▾ (the host\'s presets, else KIT.KITS: one edit with the kit\'s vals)', () => {
  const E = env({ swing: 62 }), { V } = seq(E), el = V.el;
  el.querySelectorAll('[data-kit="pat"]')[3].click();
  assert.deepEqual(lastEdit(E), ['Pattern D', { press: { k: 'pat', p: 3 } }]);
  const n0 = E.edits().length;
  el.querySelectorAll('[data-kit="pat"]')[0].click();
  assert.equal(E.edits().length, n0, 'the selected one: nothing');
  const len = el.querySelector('[data-kit="len"]'), sw = el.querySelector('[data-kit="swing"]');
  assert.deepEqual([len.querySelector('.wk-nbt').textContent, sw.querySelector('.wk-nbt').textContent], ['16', '62 %']);
  D.fire(len, 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(lastEdit(E), ['Length 15', { press: { k: 'len', n: 15 } }]);
  D.fire(sw, 'keydown', { key: 'ArrowUp' });
  assert.deepEqual(lastEdit(E), ['Swing 63 %', { press: { k: 'swing', v: 63 } }]);
  el.querySelector('.kit-clear').click();
  assert.deepEqual(lastEdit(E), ['Clear pattern A', { press: { k: 'clear' } }]);
  el.querySelector('.kit-kit').click();
  const M = E.menus.at(-1);
  assert.deepEqual(M.map(i => i.label), KIT.KITS.map(k => k.name));
  M[1].action();
  assert.deepEqual(lastEdit(E), ['Load kit Deep', { vals: KIT.KITS[1].v, kit: 'Deep' }]);
  // the host's own preset menu wins
  const E2 = env(); E2.deps.presets = () => [{ label: 'Mine', action() {} }]; E2.deps.presetName = () => 'Mine';
  const S2 = seq(E2);
  assert.equal(S2.V.el.querySelector('.kit-kit').textContent, 'Mine ▾');
  S2.V.el.querySelector('.kit-kit').click();
  assert.deepEqual(E2.menus.at(-1).map(i => i.label), ['Mine']);
});

test('(§1.2) "+ ADD DRUM": the six types; a pick adds in the first empty slot — ONE edit with the slot\'s vals (its type\'s defaults, LEVEL 7, CHOKE 0) and S\'s press { k: voice, slot, op: add, type }', () => {
  const E = env(), { V } = seq(E);
  V.el.querySelector('[data-kit="add"]').click();
  const M = E.menus.at(-1);
  assert.deepEqual(M.map(i => i.label), ['Kick', 'Snare', 'Hi-hat', 'Clap', 'Tom', 'Perc']);
  M[4].action();
  const [label, r] = lastEdit(E), Tt = KIT.TYPES[5], v10 = x => Math.round(x * 1000) / 100;
  assert.equal(label, 'Add Tom');
  assert.deepEqual(r.press, { k: 'voice', slot: 8, op: 'add', type: 5 });
  assert.deepEqual(r.vals, { kit: 5, kiu: v10(Tt.u.def), kid: v10(Tt.d.def), kil: 7, kic: 0, ki1: v10(Tt.k[0].def), ki2: v10(Tt.k[1].def), ki3: v10(Tt.k[2].def), ki4: v10(Tt.k[3].def) });
});

test('(§4.2, §7.3) the heard time: a step post → ONE frame: the playhead moved by a transform (no layout, no canvas repaint, nothing created); the monitor\'s lit mask flashes those rows\' lamps; ≤ 1 transform + ≤ 16 flips a step; stopped: no frame asked, nothing painted', async () => {
  const E = env(), { V } = seq(E);
  await D.flush(E.d);
  assert.equal(E.d.defaultView.raf.length, 0, 'idle: nothing queued');
  const p0 = UI.kitStats.paints, g0 = UI.kitStats.grid;
  await D.flush(E.d, 3);
  assert.deepEqual([UI.kitStats.paints, UI.kitStats.grid], [p0, g0], 'stopped: nothing painted');
  assert.equal(E.subs.step.size + E.subs.lit.size + E.subs.on.size, 3);
  const mk0 = E.d.createElement.bind(E.d); let made = 0; E.d.createElement = t => { made++; return mk0(t); };
  const ph = V.el.querySelector('.kit-ph'), lamps = V.el.querySelectorAll('.kit-lamp');
  E.led.step = 4;
  for (const f of E.subs.step) f({ F: 1000 });
  for (const f of E.subs.lit) f((1 << 0) | (1 << 3));
  assert.equal(E.d.defaultView.raf.length, 1, 'one frame asked for both');
  await D.flush(E.d, 1);
  assert.equal(ph.style.transform, 'translateX(' + 4 * GRID.col + 'px)');
  assert.ok(ph.hasAttribute('data-on'));
  assert.deepEqual(lamps.map(l => l.getAttribute('data-hit')), ['1', null, null, '1', null, null, null, null]);
  for (const f of E.subs.lit) f(1);
  await D.flush(E.d, 1);
  assert.equal(lamps[0].getAttribute('data-hit'), '0', 'a second hit restarts the flash (the other keyframes)');
  assert.deepEqual([made, UI.kitStats.grid], [0, g0], 'nothing created, no canvas repaint');
  E.led.step = -1;
  for (const f of E.subs.step) f({ F: 2000 });
  await D.flush(E.d, 1);
  assert.ok(!ph.hasAttribute('data-on'), 'stopped: the playhead hidden');
  assert.equal(E.d.defaultView.raf.length, 0);
});

test('(review R2-3, lane G findings 1–2) stopped, the monitor\'s activity posts (a lit mask of 0) ask the Sequencer no frame; a notify with the same record asks a voice face no frame; a changed record does, once', async () => {
  const E = env(), { V } = seq(E), W = voice(E, 2);
  await D.flush(E.d);
  assert.equal(E.d.defaultView.raf.length, 0);
  for (let i = 0; i < 3; i++) for (const f of E.subs.lit) f(0);
  assert.equal(E.d.defaultView.raf.length, 0, 'a zero mask: no frame');
  const E2 = env(), W2 = voice(E2, 2);
  await D.flush(E2.d);
  for (let i = 0; i < 3; i++) for (const f of [...E2.subs.on]) f();
  assert.equal(E2.d.defaultView.raf.length, 0, 'the same record: no frame');
  E2.rec = mkRec(E2.vals, [], { mute: 1 << 2 });
  assert.equal(E2.d.defaultView.raf.length, 1, 'a new record: one frame');
  await D.flush(E2.d, 1);
  assert.equal(W2.el.hasAttribute('data-muted'), true, 'read on that frame');
  V.destroy(); W.destroy(); W2.destroy();
});

test('(§4.2) off screen ([data-cv-off] on an ancestor): a post writes nothing; shown(true) catches up; an edit repaints the canvas once; sync() (an undo, a skin) repaints once', async () => {
  const E = env(), { V, root } = seq(E);
  await D.flush(E.d);
  root.setAttribute('data-cv-off', '');
  E.led.step = 2;
  for (const f of E.subs.step) f({});
  for (const f of E.subs.lit) f(1);
  await D.flush(E.d, 2);
  const ph = V.el.querySelector('.kit-ph');
  assert.deepEqual([ph.style.transform || '', V.el.querySelectorAll('.kit-lamp')[0].getAttribute('data-hit')], ['', null]);
  root.removeAttribute('data-cv-off');
  V.shown(true);
  await D.flush(E.d, 2);
  assert.equal(ph.style.transform, 'translateX(' + 2 * GRID.col + 'px)');
  const g0 = UI.kitStats.grid;
  E.rec = mkRec(E.vals, [[0, 0, 100]]); // (the record changed: the host's notify)
  await D.flush(E.d, 2);
  assert.equal(UI.kitStats.grid, g0 + 1, 'one repaint for the edit');
  for (const f of [...E.subs.on]) f(); // (a notify with the same record: change-gated)
  await D.flush(E.d, 2);
  assert.equal(UI.kitStats.grid, g0 + 1);
  V.sync();
  await D.flush(E.d, 2);
  assert.equal(UI.kitStats.grid, g0 + 2, 'sync: once');
});

test('(§4.2) rows follow the vals: a voice added / removed by an undo (sync) adds / drops its header and lamp; the face height follows; a muted voice\'s cells draw dimmed (the canvas), its header data-muted', async () => {
  const E = env(), { V } = seq(E);
  E.vals.kjt = 6; E.vals.kbt = 0;
  V.sync();
  await D.flush(E.d);
  assert.deepEqual(V.el.querySelectorAll('.kit-rh').map(h => h.getAttribute('data-slot')), ['0', '2', '3', '4', '5', '6', '7', '9']);
  assert.equal(V.el.querySelectorAll('.kit-lamp').length, 8);
  E.vals.kkt = 1; V.sync(); await D.flush(E.d);
  assert.deepEqual([V.el.querySelectorAll('.kit-rh').length, V.face.h, V.el.querySelector('.rig-kgrid').style.height], [9, UI.seqH(9), UI.seqRecipe(9).rows[1].h + 'px']);
  assert.match(V.el.querySelectorAll('.kit-rh').at(-2).textContent, /^Perc/, 'an automatic name from its type');
});

test('(§4.8) the canvas reads the skin\'s tokens (getComputedStyle: --rig-screen, --sx-ink) and paints the cells in KIT.TINT; every KIT.TINT ≥ 3 : 1 on each skin\'s --rig-screen (style.css\'s blocks)', async () => {
  const lum = h => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const n = parseInt(h.slice(1, 7), 16); return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const screens = {};
  for (const sk of ['charcoal', 'ivory', 'glass']) { const m = new RegExp('\\[data-cv-skin="' + sk + '"\\][^{]*\\{[^}]*--rig-screen:\\s*(#[0-9a-fA-F]{6})').exec(CSS); assert.ok(m, sk); screens[sk] = m[1]; }
  for (const [sk, s] of Object.entries(screens)) for (let t = 1; t <= 6; t++) assert.ok(cr(KIT.TINT[t], s) >= 3, sk + ' ' + KIT.TINT[t] + ' ' + cr(KIT.TINT[t], s).toFixed(2));
  const E = env({ cells: [[0, 0, 127], [3, 2, 64]] });
  E.d.defaultView.getComputedStyle = () => ({ getPropertyValue: k => ({ '--rig-screen': '#141518', '--sx-ink': '#ebe6d8', '--sx-mute': '#9c978a' })[k] || '' });
  globalThis.getComputedStyle = E.d.defaultView.getComputedStyle;
  const { V } = seq(E), cv = V.el.querySelector('canvas'), g = cv.getContext('2d'), styles = [];
  cv._g = new Proxy(g, { set(t, k, v) { if (k === 'fillStyle') styles.push(String(v)); t[k] = v; return true; } }); // (the fake's getContext hands this back)
  await D.flush(E.d);
  assert.ok(g.calls.length > 0, 'painted');
  assert.ok(styles.includes(KIT.TINT[1]) && styles.includes(KIT.TINT[3]), 'the tints: ' + [...new Set(styles)].join(' '));
  assert.ok(styles.includes('#ebe6d8'), 'the ink (the cells\' ground) from the skin');
  delete globalThis.getComputedStyle;
});

/* ================================================================ §4.3 the voice faces */
function voice(E, slot = 0) {
  const root = E.d.createElement('div'); E.d.body.appendChild(root);
  return E.K.face('voice', root, { t: T, dev: 'i1', slot });
}
test('(§4.3) a voice face: section.rig-face[data-kit=voice][data-slot] of 4 columns (288 × 236) — the head (its tint, TYPE ▾, HIT), TUNE DECAY LEVEL CHOKE, k1–k4 of its type (KIT.TYPES\' labels), every control data-ctl / data-dest = the model\'s id; ≤ 150 elements', () => {
  const E = env(), V = voice(E, 1), el = V.el;
  assert.deepEqual([el.getAttribute('data-kit'), el.getAttribute('data-slot'), el.getAttribute('data-rig-kind'), el.style['--rig-n'], el.style['--kit-c']], ['voice', '1', 'kit-voice', '4', KIT.TINT[2]]);
  assert.deepEqual(V.face, { kind: 'kit-voice', variant: 'kit-voice', cols: 4, w: 288, h: 236 });
  const rows = el.children.filter(n => n.classList.contains('rig-row'));
  assert.deepEqual(rows.map(r => r.className), ['rig-row rig-head', 'rig-row rig-knobs', 'rig-row rig-knobs']);
  assert.ok(rows[0].querySelector('.kit-tint') && rows[0].querySelector('.wk-menu'));
  const hit = el.querySelector('[data-kit="hit"]');
  assert.deepEqual([hit.getAttribute('data-gesture'), hit.textContent, hit.getAttribute('role')], ['music', 'HIT', 'button']);
  const dests = el.querySelectorAll('[data-dest]').map(x => x.getAttribute('data-dest'));
  assert.deepEqual(dests.slice().sort(), KIT.FIELDS.filter(f => f !== 't').map(f => id(1, f)).concat([id(1, 't')]).sort());
  for (const x of el.querySelectorAll('[data-dest]')) assert.equal(x.getAttribute('data-ctl'), x.getAttribute('data-dest'));
  const labs = el.querySelectorAll('.wk-knob').map(k => k.querySelector('.wk-lab').textContent);
  assert.deepEqual(labs, ['Tune', 'Decay', 'Level', 'Tone', 'Color', 'Snap', 'Body']);
  assert.equal(el.querySelector('.wk-nb').querySelector('.wk-lab').textContent, 'Choke');
  assert.ok(els(el) <= 150, els(el) + ' elements');
  assert.deepEqual(V.jacks.size, 0);
});

test('(§4.3) the knobs write through the host\'s set (vals 0–10; \'move\' during a drag, \'end\' at a key or the end) — never an edit; readouts by the laws (Hz, ms / s, dB, –/1–4); CHOKE a num cell 0–4', () => {
  const E = env(), V = voice(E, 0), el = V.el;
  const kn = el.querySelectorAll('.wk-knob'), num = t => t.querySelector('.wk-num').textContent;
  assert.deepEqual(kn.slice(0, 3).map(num), ['60 Hz', '519 ms', '0.0 dB']);
  D.fire(kn[0], 'keydown', { key: 'ArrowUp' });
  assert.deepEqual(E.log.filter(x => x[0] === 'set').at(-1), ['set', 'kau', 5.1, 'end']);
  assert.equal(E.edits().length, 0);
  const ch = el.querySelector('.wk-nb');
  assert.equal(ch.querySelector('.wk-nbt').textContent, '–');
  D.fire(ch, 'keydown', { key: 'ArrowUp' });
  assert.deepEqual(E.log.filter(x => x[0] === 'set').at(-1), ['set', 'kac', 1, 'end']);
  assert.equal(ch.querySelector('.wk-nbt').textContent, '1');
  assert.deepEqual([UI.fmtLevel(1), UI.fmtLevel(0), UI.fmtChoke(4)], ['+6.2 dB', '−∞ dB', '4']);
  assert.equal(UI.fmtKnob(KIT.TYPES[6].u, 1), '4.80 kHz');
  assert.equal(UI.fmtKnob(KIT.TYPES[1].d, 1), '2.40 s');
  assert.equal(UI.fmtKnob(KIT.TYPES[4].k[1], 0.5), '4');
  assert.equal(UI.fmtKnob(KIT.TYPES[1].k[0], 0.5), '4.00×');
});

test('(review R2-4) a voice knob\'s typed value reads in its readout\'s unit (the unit optional: a bare number in the unit shown): DECAY "519 ms" / "250" / "250 ms" / "1.2 s", TUNE "60 Hz" / "80" / "1.2 kHz", LEVEL "-6 dB" / "+3" / "-inf", a % knob "40"; garbage refused', () => {
  const E = env(), V = voice(E, 0), el = V.el, kn = el.querySelectorAll('.wk-knob'), num = k => k.querySelector('.wk-num').textContent;
  const type = (k, txt) => { D.fire(k, 'keydown', { key: 'Enter' }); const inp = k.querySelector('.wk-in'); if (!inp) return 'no entry'; inp.value = txt; D.fire(inp, 'keydown', { key: 'Enter' }); return k.classList.contains('wk-bad') ? 'refused' : num(k); };
  const [tu, de, le] = kn;
  assert.deepEqual([type(de, '519 ms'), type(de, '250'), type(de, '250 ms'), type(de, '1.2 s'), type(de, '1.5'), type(de, '80ms')], ['519 ms', '250 ms', '250 ms', '1.20 s', '1.50 s', '80 ms'], 'DECAY');
  assert.deepEqual([type(tu, '60 Hz'), type(tu, '80'), type(tu, '45hz')], ['60 Hz', '80 Hz', '45 Hz'], 'TUNE');
  assert.deepEqual([type(le, '-6 dB'), type(le, '−3'), type(le, '+3 dB'), type(le, '0'), type(le, '-inf')], ['−6.0 dB', '−3.0 dB', '+3.0 dB', '0.0 dB', '−∞ dB'], 'LEVEL');
  const ck = kn[6]; // (k3: the Kick's CLICK, a lin knob read in %)
  assert.deepEqual([num(ck).endsWith(' %'), type(ck, '40'), type(ck, '20 %')], [true, '40 %', '20 %'], 'a % knob');
  assert.equal(type(de, 'loud'), 'refused');
  assert.deepEqual([UI.parseKnob(KIT.TYPES[6].u, '1.2 kHz', '150 Hz'), UI.parseKnob(KIT.TYPES[6].u, '2', '2.40 kHz')].map(p => UI.fmtKnob(KIT.TYPES[6].u, p)), ['1.20 kHz', '2.00 kHz'], 'kHz, bare in kHz');
  for (const T of KIT.TYPES.slice(1)) for (const L of [T.u, T.d, ...T.k]) for (const x of [0, 0.25, 0.5, 0.777, 1]) { const f = UI.fmtKnob(L, x); assert.equal(UI.fmtKnob(L, UI.parseKnob(L, f, f)), f, T.label + ' ' + L.id + ' ' + f); }
  for (const x of [0, 0.1, 0.5, 0.7, 1]) assert.equal(UI.fmtLevel(UI.parseLevel(UI.fmtLevel(x))), UI.fmtLevel(x));
});

test('(§1.2) TYPE ▾ changes the type: ONE edit — TYPE, TUNE, DECAY and k1–k4 to the new type\'s defaults, LEVEL / CHOKE kept; the face relabels on sync', () => {
  const E = env(), V = voice(E, 3), btn = V.el.querySelector('.wk-mbtn');
  assert.match(btn.getAttribute('aria-label'), /Hi-hat/);
  D.fire(btn, 'keydown', { key: 'ArrowRight' }); // (the next type: Clap)
  const [label, r] = lastEdit(E), Tt = KIT.TYPES[4], v10 = x => Math.round(x * 1000) / 100;
  assert.equal(label, 'Closed hat → Clap');
  assert.deepEqual(r, { vals: { kdt: 4, kdu: v10(Tt.u.def), kdd: v10(Tt.d.def), kd1: v10(Tt.k[0].def), kd2: v10(Tt.k[1].def), kd3: v10(Tt.k[2].def), kd4: v10(Tt.k[3].def) } });
  V.sync();
  assert.deepEqual(V.el.querySelectorAll('.wk-knob').slice(3).map(k => k.querySelector('.wk-lab').textContent), ['Spread', 'Count', 'Tone', 'Tail']);
  assert.equal(V.el.style['--kit-c'], KIT.TINT[4]);
});

test('(§4.3, D8) the HIT pad — the one music zone: velocity by the press\'s height (cv-keys KEY_VEL\'s curve over its 44 px band: the front edge loudest), every finger its own hit, an off at its lift; Space / Enter at 100; it flashes on the monitor\'s lit bit of its slot only', async () => {
  const E = env(), V = voice(E, 2), hit = V.el.querySelector('[data-kit="hit"]');
  hit._rect = { left: 0, top: 0, width: 56, height: 28 };
  for (const f of [0, 0.5, 1]) assert.equal(UI.padVel(f), Math.min(1, KEY_VEL.lo + KEY_VEL.span * f));
  D.ptr(hit, 'pointerdown', 20, 28 + 8, { pointerId: 1, pointerType: 'touch' });
  D.ptr(hit, 'pointerdown', 30, -8, { pointerId: 2, pointerType: 'touch' });
  assert.deepEqual(E.log.filter(x => x[0] === 'pad'), [['pad', 'kc', 1], ['pad', 'kc', 0.3]]);
  assert.ok(hit.hasAttribute('data-held'));
  D.ptr(hit, 'pointerup', 20, 30, { pointerId: 1, pointerType: 'touch' });
  assert.ok(hit.hasAttribute('data-held'), 'still one finger');
  D.ptr(hit, 'pointerup', 30, 0, { pointerId: 2, pointerType: 'touch' });
  assert.deepEqual([E.log.filter(x => x[0] === 'off').length, hit.hasAttribute('data-held')], [1, false], 'the off at the last lift (the family\'s pads)');
  D.fire(hit, 'keydown', { key: ' ' });
  D.fire(hit, 'keyup', { key: ' ' });
  assert.deepEqual(E.log.filter(x => x[0] === 'pad').at(-1), ['pad', 'kc', Math.round(100 / 127 * 1000) / 1000]);
  assert.equal(E.edits().length, 0, 'an audition: no History');
  for (const f of E.subs.lit) f(1 << 0);
  await D.flush(E.d, 1);
  assert.equal(hit.getAttribute('data-hit'), null, 'another slot\'s hit: dark');
  for (const f of E.subs.lit) f(1 << 2);
  await D.flush(E.d, 1);
  assert.equal(hit.getAttribute('data-hit'), '1');
});

test('(§1.2) ⋯ items: a voice — Remove (ONE edit: TYPE 0 + S\'s press { k: voice, op: remove }), Reset sound (its type\'s defaults, CHOKE kept); the Sequencer — Clear all patterns (press { k: clearAll }), no Demo beat while KIT.DEMO is null', () => {
  const E = env(), V = voice(E, 4);
  const it = V.menuItems();
  assert.deepEqual(it.map(i => i.label), ['Reset sound', 'Remove']);
  it[1].action();
  assert.deepEqual(lastEdit(E), ['Remove Open hat', { vals: { ket: 0 }, press: { k: 'voice', slot: 4, op: 'remove' } }]);
  E.vals.ket = 3; E.vals.ke1 = 9; E.vals.kec = 1;
  it[0].action();
  const [label, r] = lastEdit(E), Tt = KIT.TYPES[3], v10 = x => Math.round(x * 1000) / 100;
  assert.equal(label, 'Reset Open hat');
  assert.deepEqual(r, { vals: { keu: v10(Tt.u.def), ked: v10(Tt.d.def), kel: 7, ke1: v10(Tt.k[0].def), ke2: v10(Tt.k[1].def), ke3: v10(Tt.k[2].def), ke4: v10(Tt.k[3].def) } });
  const S = seq(E);
  assert.equal(KIT.DEMO, null);
  assert.deepEqual(S.V.menuItems().map(i => i.label), ['Clear all patterns']);
  S.V.menuItems()[0].action();
  assert.deepEqual(lastEdit(E), ['Clear all patterns', { press: { k: 'clearAll' } }]);
});

test('(§4.3) a muted voice\'s face dims (data-muted on the section, from the record\'s mute | another\'s solo)', async () => {
  const E = env({ mute: 1 << 1 }), V1 = voice(E, 1), V0 = voice(E, 0);
  assert.deepEqual([V1.el.hasAttribute('data-muted'), V0.el.hasAttribute('data-muted')], [true, false]);
  E.rec = mkRec(E.vals, [], { solo: 1 << 1 });
  await D.flush(E.d, 2);
  assert.deepEqual([V1.el.hasAttribute('data-muted'), V0.el.hasAttribute('data-muted')], [false, true]);
});

test('destroy: every subscription off (step / lit / on), the element gone, a later post harmless; kitHost.destroy ends every face', async () => {
  const E = env(), S = seq(E), V = voice(E, 0);
  assert.ok(E.subs.on.size >= 2 && E.subs.lit.size >= 2);
  S.V.destroy();
  assert.equal(S.V.el.parentNode, null);
  E.K.destroy();
  assert.deepEqual([E.subs.step.size, E.subs.lit.size, E.subs.on.size, V.el.parentNode], [0, 0, 0, null]);
  for (const f of E.subs.step) f({});
  await D.flush(E.d, 1);
});

test('(§4.8) KIT_CSS: injected once per document (#kit-css, beside rig-grid\'s), colours only from the existing tokens (--rig-* / --sx-* / --sxd-* / --kit-c), its sizes from GRID; every hit ≥ 44 (an ::after band); no animation while nothing is hit', () => {
  const d = D.fresh();
  UI.ensureKitCSS(d); UI.ensureKitCSS(d);
  assert.equal(d.head.querySelectorAll('#kit-css').length, 1);
  const css = UI.KIT_CSS;
  assert.doesNotMatch(css.replace(/rgba\(0, 0, 0, [\d.]+\)/g, ''), /#[0-9a-fA-F]{3,8}\b(?![^(]*\))/, 'no colour literal outside a var() fallback');
  for (const v of css.match(/var\(--[\w-]+/g)) assert.match(v, /var\(--(rig|sx|sxd|kit|ui|mono)-?/);
  assert.match(css, /\.kit-lamp\[data-hit="0"\]/);
  assert.doesNotMatch(css, /infinite/);
  assert.match(css, new RegExp('height: ' + GRID.hit + 'px|height: var\\(--rig-hit\\)'));
});
