import './v8-guard.mjs';
// rig-ui.js (stage WC lane F, docs/canvas/IMPL-WC.md §3.0–§3.2, §3.8, §11.1): the RIG grid's numbers in one place, the row recipes
// (FACE) and their geometry (layoutOf: the module widths 64·n + 32 on the 32 px dots, the row tops and heights, every knob and jack on
// a column centre, a short row centred at the column pitch), the injected CSS carrying GRID's numbers as custom properties, every WC-1
// face mounted by rigHost on a real SerumHost (the fake DOM; graph.js / wt.js / fx-ui.js / wtedit.js the serum-ui stubs): its rows and
// cells as the recipe says, the data-dest parity with the stage-3 panel of the same part (⊇), the jacks and their labels (Σ, the
// LEVEL's KEYS normal struck while an Envelope holds it), the ⏻ handed to the bar, the drawer kept on the face, an oscillator's type
// switch re-laying it, Envelope 1's variant, the dim policy; the jack row's tap menu over stubbed rules (Connect to…, the plug menu,
// "Which cord?", Pull, a refusal, a read-only jack, the amp slot from an Envelope); applySkin. G11 itself (the browser's boxes) is tests/ui-layout-wc.mjs. Never passes fake-DOM nodes to
// assert (safeAssert: nodes become tags).
// Run alone: node --max-old-space-size=2048 --test tests/rig-ui.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirect } from './serum-ui.hooks.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);
globalThis.SerumDSP = null;   // (wk.loadDSP resolves at once: no script injection into the fake DOM)
globalThis.FXDSP = null;

const RU = await import('../rig-ui.js?v=9');
const RC = await import('../rig-core.js?v=9');
const H = await import('../sx-host.js?v=9');
const M = await import('../sx-ui-mod.js?v=9');
const core = await import('../serum-core.js?v=9');
const D = await import('./serum-ui-stubs/dom.js');
const assert = D.safeAssert(assertBase);
const { GRID, FACE, layoutOf } = RU;

const KINDS = ['amp', 'osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros'];
const ITEM = /^(<|>)[a-z][a-zA-Z0-9]*$|^((#[a-zA-Z][a-zA-Z0-9]*)|(@?\.?[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)?))(\|((#[a-zA-Z][a-zA-Z0-9]*)|(@?\.?[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)?)))*(:[1-9])?\*?$/;
const ids = el => new Set(el.querySelectorAll('[data-dest]').map(e => e.getAttribute('data-dest')));
// the fake DOM's selectors are compound only: a descendant query in two steps
const within = (el, a, b) => el.querySelectorAll(a).flatMap(x => x.querySelectorAll(b));
// a rig over the blank with every WC-1 part on (Oscillator 2 a sample), Envelope 1 a real envelope; its host in a fresh document
function rig(edit) {
  const s = RC.rigBlank();
  for (const id of ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on']) s.p[id] = 1;
  if (edit) edit(s);
  const doc = D.fresh(), store = new Map(), st = { s, fx: core.defaultFx2() }, log = [];
  const host = { st, log, state: () => st.s, fx: () => st.fx, edit: (fn, o) => { fn(st.s); log.push(['edit', o && o.label]); }, editFx: fn => fn(st.fx), bpm: () => 120, dev: 'i1',
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) }, notify: t => log.push(['notify', t]) };
  const X = H.createHost(host, { doc });
  return { doc, host, X, s: () => st.s };
}
// a face and the stage-3 panel of the same part (a second host over a copy of the state)
async function both(kind, part, edit) {
  const R = rig(edit), box = R.doc.createElement('div');
  R.doc.body.appendChild(box);
  const rh = RU.rigHost({ doc: R.doc }), V = rh.face(kind, box, { host: R.X, part, dev: 'i1' });
  const st3 = { s: JSON.parse(JSON.stringify(R.s())), fx: core.defaultFx2() };
  const X3 = H.createHost({ state: () => st3.s, fx: () => st3.fx, edit: fn => fn(st3.s), editFx: fn => fn(st3.fx), bpm: () => 120, dev: 'i9', storage: { get: (k, d) => d, set() {} }, notify() {} }, { doc: R.doc });
  const b3 = R.doc.createElement('div');
  R.doc.body.appendChild(b3);
  M.mountPart(X3, part, b3);
  await D.flush(R.doc);
  return Object.assign(R, { V, b3, box, rh });
}

/* ================================================================ the grid and the recipes */
test('GRID: the §3.8 numbers — unit 8, column 64, padding 16 (12 top, 16 bottom), gap 12, rows head 32 · screen 112 | 128 · knobs 76 · switches 32 · jacks 56, the knob cell (40 px knob 4 px down, 6, 14 px label line, 12 px value line), boxes 28, hits 44, the font minima, the fill band', () => {
  assert.deepEqual([GRID.u, GRID.col, GRID.pad, GRID.top, GRID.bottom, GRID.gap], [8, 64, 16, 12, 16, 12]);
  assert.deepEqual(GRID.rows, { head: 32, screen: 112, screenL: 128, knobs: 76, switches: 32, jacks: 56 });
  assert.equal(GRID.knobTop + GRID.knob + GRID.labGap + GRID.lab + GRID.val, GRID.rows.knobs, 'the knob cell fills its row exactly');
  assert.equal(GRID.knob, 40);
  assert.equal(GRID.jackTop + GRID.jack + GRID.jackGap + GRID.jackLab + 6, GRID.rows.jacks, 'the jack cell: 4 · 28 · 6 · 12 · 6');
  assert.ok(GRID.jackGap >= GRID.margin, 'a jack\'s label sits ≥ 6 px under it (§3.8 text margins)');
  assert.ok(GRID.labGap >= GRID.margin, 'a knob\'s label sits ≥ 6 px under its SVG');
  assert.deepEqual(GRID.font, { lab: 11, val: 10, sw: 11, head: 12, jack: 10 });
  assert.deepEqual([GRID.box, GRID.hit, GRID.margin, GRID.textGap], [28, 44, 6, 8]);
  assert.deepEqual(GRID.fill, [0.55, 0.85]);
  assert.ok(Object.isFrozen(GRID) && Object.isFrozen(GRID.rows) && Object.isFrozen(FACE) && Object.isFrozen(FACE.osc.rows[0].items));
  assert.equal(RU.faceW(3), 224); assert.equal(RU.faceW(4), 288); assert.equal(RU.faceW(5), 352); assert.equal(RU.faceW(8), 544);
});

test('FACE: the eight WC-1 kinds and the variants; columns = MODULES\'; a head first, the jack row last (Macros: its tiles are its jacks); every height GRID\'s; no pixel in a recipe (items are names, ids, spans)', () => {
  assert.deepEqual(RU.KINDS, KINDS);
  assert.deepEqual(Object.keys(FACE).sort(), ['amp', 'env', 'env.amp', 'filter', 'lfo', 'macros', 'noise', 'osc', 'osc.kit', 'osc.sample', 'sub'].sort());
  for (const [k, F] of Object.entries(FACE)) {
    const kind = k.split('.')[0];
    assert.equal(F.cols, RC.MODULES[kind].cols, k + ': columns = MODULES');
    assert.equal(F.rows[0].t, 'head', k + ': the head first');
    if (kind === 'macros') assert.ok(!F.rows.some(r => r.t === 'jacks'), 'macros: no jack row');
    else assert.equal(F.rows[F.rows.length - 1].t, 'jacks', k + ': the jack row last');
    for (const r of F.rows) {
      assert.ok(['head', 'screen', 'knobs', 'switches', 'jacks'].includes(r.t), k + ': row kind ' + r.t);
      if (r.h != null) assert.equal(r.h, RU.rowH(r.t, r.h === GRID.rows.screenL ? 'L' : 'S'), k + ': ' + r.t + ' height from GRID');
      for (const it of r.items) assert.ok(ITEM.test(it), k + ': item ' + it + ' is a name / id / span (no pixel number)');
    }
  }
  assert.equal(FACE['osc.kit'].rows[1].h, null, 'the kit interior (WC-2) has its natural height');
});

test('layoutOf: widths 64·n + 32 on the dots; row tops cumulative (12 + rows + 12 gaps); every full or even-short knob / switch row on the column centres; jacks inputs left, outputs right; the same rows give the same height', () => {
  for (const [k, F] of Object.entries(FACE)) {
    const L = layoutOf(F);
    assert.equal(L.w, 64 * F.cols + 32, k);
    assert.equal(L.w % 32, 0, k + ': on the 32 px dots');
    let y = GRID.top;
    L.rows.forEach((r, i) => {
      if (i) y += GRID.gap;
      assert.equal(r.top, y, k + ' row ' + i + ' top');
      y += r.h;
      if (r.t === 'knobs' || r.t === 'switches') {
        const S = r.cells.reduce((a, c) => a + c.span, 0);
        assert.ok(S <= F.cols && (F.cols - S) % 2 === 0, k + ' row ' + i + ': ' + S + ' of ' + F.cols + ' columns centre on the column pitch');
        for (const c of r.cells) if (c.span === 1) assert.equal((c.cx - GRID.pad - GRID.col / 2) % GRID.col, 0, k + ': a cell centre on a column centre');
      }
      if (r.t === 'jacks') {
        const ins = r.cells.filter(c => c.jack.dir === 'in').map(c => c.col), outs = r.cells.filter(c => c.jack.dir === 'out').map(c => c.col);
        assert.deepEqual(ins, ins.map((_, j) => j), k + ': inputs from the left');
        assert.deepEqual(outs, outs.map((_, j) => F.cols - outs.length + j), k + ': outputs at the right');
        for (const c of r.cells) {
          const M = RC.MODULES[k.split('.')[0]], all = M.jacks.in.concat(M.jacks.out);
          assert.ok(all.some(j => j.id === c.jack.port && (c.jack.dir === 'in') === M.jacks.in.includes(j)), k + ': jack ' + c.jack.port + ' is a MODULES jack of its side');
        }
      }
    });
    assert.equal(L.h, y + GRID.bottom, k + ': height');
  }
  const h = k => layoutOf(FACE[k]).h;
  assert.deepEqual([h('osc'), h('osc.sample'), h('filter'), h('amp'), h('sub'), h('noise'), h('env'), h('env.amp'), h('lfo'), h('macros')], [532, 620, 472, 348, 392, 392, 428, 428, 400, 236]);
  assert.equal(h('env') - h('lfo'), GRID.rows.knobs - GRID.rows.switches + GRID.rows.screen - GRID.rows.screenL, 'Envelope vs LFO: one row kind and the screen differ');
  assert.equal(h('sub'), h('noise'), 'the same rows: the same height');
  // the Amplifier: its four inputs fill its four columns (its OUT is cv-module's edge jack: the line to the FX panel)
  const amp = layoutOf(FACE.amp).rows.find(r => r.t === 'jacks');
  assert.deepEqual(amp.cells.map(c => c.jack.port), ['main', 'direct', 'note', 'level']);
  assert.deepEqual(RU.sizeOf('env', 'env1'), { w: 352, h: 428 });
  assert.deepEqual(RU.sizeOf('osc', 'oscB'), { w: 352, h: 532 });
  assert.equal(RU.variantOf('osc', { type: 'sample' }), 'osc.sample');
  assert.equal(RU.variantOf('osc', { type: 'gran' }), 'osc.kit');
  assert.equal(RU.variantOf('env', { k: 0 }), 'env.amp');
});

test('the grid CSS: injected once per document, every --rig-* layout property is GRID\'s number (one place)', () => {
  const doc = D.fresh();
  RU.ensureRigCSS(doc); RU.ensureRigCSS(doc);
  assert.equal(doc.head.querySelectorAll('#' + RU.CSS_ID).length, 1);
  const css = RU.cssText(), want = { u: 8, col: 64, pad: 16, top: 12, bottom: 16, gap: 12, 'row-head': 32, 'row-screen': 112, 'row-screenL': 128, 'row-knobs': 76, 'row-switches': 32, 'row-jacks': 56, knob: 40, 'knob-top': 4, 'lab-gap': 6, lab: 14, val: 12, box: 28, jack: 28, 'jack-top': 4, 'jack-gap': 6, 'jack-lab': 12, hit: 44, 'f-lab': 11, 'f-val': 10, 'f-sw': 11, 'f-head': 12, 'f-jack': 10 };
  for (const [k, v] of Object.entries(want)) assert.ok(css.includes('--rig-' + k + ': ' + v + 'px;'), '--rig-' + k + ' = ' + v);
  assert.ok(/\.rig-face, \.rig-drawer \{ --rig-u: 8px;/.test(css), 'the variables on the face and its drawer');
  assert.ok(!/--sx-[a-z0-9-]+\s*:/.test(css), 'no colour token is set here (a skin\'s, §5.1)');
});

test('(WC, fixer K; review P2-3 / B5 and its skeptics) a jack\'s own hit is the grid\'s 44 world px circle — never zoom-scaled (a face clips it at its edge, and a bigger one stole the switch / knob row above at 50–60 %): its reach never passes the 12 px gap to the row above, and alone it is no wider than its column (neighbours\' circles never overlap: lines mode has no nearest rule); a fanned jack\'s stretched sideways over its plugs (--rig-fw the fan\'s span, --rig-fx its centre\'s offset, the host\'s) — the rest of P2-3\'s reach (22 screen px at Fit, outside the face too) is the world\'s near hook (main.js rigNearJack)', () => {
  const css = RU.cssText(), rule = (css.match(/\.rig-face \.rig-jack::before \{[^}]*\}/) || [''])[0];
  assert.match(rule, /width: calc\(var\(--rig-hit\) \+ var\(--rig-fw, 0px\)\);/, 'the width: the grid\'s hit, plus the fan');
  assert.match(rule, /height: var\(--rig-hit\);/, 'the height: the grid\'s hit');
  assert.doesNotMatch(rule, /--ik|--rig-col|max\(/, 'never zoom-scaled, never a column tall');
  assert.match(rule, /transform: translate\(calc\(-50% \+ var\(--rig-fx, 0px\)\), -50%\);/, 'centred on the fan');
  assert.ok(GRID.hit / 2 < GRID.jackTop + GRID.jack / 2 + GRID.gap, 'its reach up (' + GRID.hit / 2 + ') short of the row above (' + (GRID.jackTop + GRID.jack / 2 + GRID.gap) + ')');
  assert.ok(GRID.hit <= GRID.col, 'no wider than its column alone');
});

/* ================================================================ the faces */
const RECIPE_IDS = (v, prefix) => FACE[v].rows.flatMap(r => r.items).filter(s => !/^[<>#]/.test(s)).flatMap(s => s.replace(/\*$/, '').replace(/:\d$/, '').split('|')).filter(x => x[0] !== '#').map(x => x.replace(/^@/, prefix));
for (const [kind, part, prefix, variant] of [['osc', 'oscA', 'a', 'osc'], ['sub', 'sub', 's', 'sub'], ['noise', 'noise', 'n', 'noise'], ['filter', 'filter2', 'f2.', 'filter'], ['env', 'env3', 'e3', 'env'], ['env', 'env1', 'e1', 'env.amp'], ['lfo', 'lfo7', 'l7', 'lfo'], ['macros', 'macros', '', 'macros'], ['amp', 'voice', '', 'amp']]) {
  test('face ' + kind + ' (' + part + '): its rows and cells as the recipe says, every id of the recipe on it, ⊇ the stage-3 panel\'s data-dest ids, the jacks and their labels, the drawer kept on the face', async () => {
    const R = await both(kind, part);
    const V = R.V, el = V.el;
    assert.ok(el && el.classList.contains('rig-face') && el.getAttribute('data-rig-kind') === kind, 'the face root');
    assert.equal(V.face.variant, variant);
    assert.equal(V.face.w, RU.faceW(FACE[variant].cols));
    assert.equal(el.parentNode && el.parentNode.classList.contains('sx-root'), true, 'inside its host view root');
    const rows = el.children.filter(e => e.classList.contains('rig-row'));
    assert.deepEqual(rows.map(r => r.className.replace('rig-row rig-', '')), FACE[variant].rows.map(r => r.t));
    rows.forEach((re, i) => {
      const r = FACE[variant].rows[i];
      if (r.t === 'knobs' || r.t === 'switches' || r.t === 'jacks') assert.equal(re.children.filter(c => c.classList.contains('rig-cell')).length, r.items.length, variant + ' row ' + i + ' cells');
    });
    const mine = ids(el), theirs = ids(R.b3);
    for (const id of RECIPE_IDS(variant, prefix)) if (core.DEST_INDEX[id] !== undefined) assert.ok(mine.has(id), variant + ': ' + id + ' on the face');
    if (kind === 'amp') for (const x of Array.from(theirs)) if (/^e\d\./.test(x)) theirs.delete(x); // (ENV 1 is Envelope 1's module now)
    assert.deepEqual(Array.from(theirs).filter(x => !mine.has(x)), [], 'every stage-3 data-dest id on the face');
    assert.deepEqual(V.dests().sort(), Array.from(mine).sort());
    // jacks: cv-module's inline anchors, labelled
    const jr = FACE[variant].rows.find(r => r.t === 'jacks');
    const js = el.querySelectorAll('.rig-jack');
    assert.deepEqual(js.map(j => j.getAttribute('data-jack')), jr ? jr.items.map(s => s.slice(1)) : []);
    assert.ok(js.every(j => j.classList.contains('cv-jack') && j.classList.contains('cv-fjack')), 'the face-jack look and hit rule');
    for (const j of js) assert.equal(V.jacks.get(j.getAttribute('data-jack')) === j, true);
    if (kind === 'filter') assert.equal(el.querySelectorAll('.rig-jl')[0].textContent, 'IN Σ');
    // the ⏻ is the bar's, with its data-dest
    const pw = { osc: 'a.on', sub: 's.on', noise: 'n.on', filter: 'f2.on' }[kind];
    if (pw) assert.equal(V.power && V.power.getAttribute('data-dest'), pw); else assert.equal(V.power, null);
    // the drawer's controls are on the face (hidden), its parked widgets too
    if (V.drawer && V.drawer.el.firstChild) assert.equal(el.contains(V.drawer.el), true);
    assert.equal(el.querySelectorAll('.rig-park').length, 1);
    V.destroy();
  });
}

test('the Amplifier: VOICES, GLIDE (g.porta), CURVE, LEVEL (g.amp, fresh); MONO · LEGATO · ALWAYS · SCALED; MAIN · DIRECT · BUS 1 · BUS 2; LEVEL\'s normal KEYS struck while an Envelope holds the level, plain while the keys gate it', async () => {
  const R = await both('amp', 'voice');
  const el = R.V.el, rows = el.children.filter(e => e.classList.contains('rig-row'));
  assert.equal(rows[1].children[0].querySelector('.sx-nfl').textContent, 'VOICES');
  assert.deepEqual(rows[1].children.slice(1).map(c => c.children[0].getAttribute('data-dest')), ['g.porta', 'g.curve', 'g.amp']);
  assert.equal(rows[1].children[1].querySelector('.wk-lab').getAttribute('data-l'), 'GLIDE');
  assert.deepEqual(rows[2].children.map(c => c.children[0].textContent.trim()), ['MONO', 'LEGATO', 'ALWAYS', 'SCALED']);
  assert.deepEqual(rows[3].children.map(c => c.children[0].getAttribute('data-dest')), ['g.master', 'g.direct', 'g.bus1v', 'g.bus2v']);
  const jr = rows[4], lvl = jr.querySelectorAll('.rig-jl')[3];
  assert.equal(lvl.textContent, 'LEVELKEYS');
  assert.equal(lvl.querySelector('.rig-nrm').textContent, 'KEYS');
  assert.equal(jr.hasAttribute('data-plugged'), false, 'the blank: ENV 1 is the gate');
  R.host.st.s.p['e1.att'] = 0.3;
  R.X.paint(true);
  assert.equal(jr.hasAttribute('data-plugged'), true, 'not the gate: an Envelope holds LEVEL');
  assert.ok(/an Envelope shapes the level/.test(R.V.jacks.get('level').title));
  assert.equal(R.X.vcEl || null, null, 'no voice counter in its head (lane H: the kit\'s "0 / 400" is an engine number); the meter is');
  assert.deepEqual([rows[0].children.length, rows[0].children.some(c => c.classList.contains('sx-vc'))], [4, false], 'the head: undo · redo · the meter · ⚙');
  assert.ok(R.V.menuItems().some(i => i.label === 'Preferences…'));
  // (review 1 P2-3, the lead: MPE is the Serum's in WC-1) the drawer's MPE… is disabled, its words beside it — no Serum word
  const btns = R.V.drawer ? R.V.drawer.el.querySelectorAll('.sx-hbtn') : [], mpe = btns.find(b => b.textContent === 'MPE…');
  assert.deepEqual([!!mpe, !!(mpe && mpe.disabled), mpe ? mpe.title : null], [true, true, RC.WORDS.mpeLater]);
  assert.deepEqual(R.V.drawer.el.querySelectorAll('.rig-dhint').map(e => e.textContent), [RC.WORDS.mpeLater]);
  const folds = btns.filter(b => /^(Quality|Tuning|Voice control|Velocity|Note)…$/.test(b.textContent));
  assert.deepEqual([folds.length, folds.every(b => !b.disabled)], [5, true], 'the other fold-outs open');
  R.V.destroy();
  assert.equal(R.X.vcEl || null, null, 'its head kit goes with it');
  assert.equal(R.X.meter || null, null, 'its meter too');
});

test('an Envelope\'s ⋯ (§8.2; review 1 P3-1): the kit\'s module items — Lock · Init · Copy · Swap with ▸ — then its own (Legato Inverted, Grid, Voice Steal Retrigger), Lock once, no doubled separator', async () => {
  for (const part of ['env1', 'env3']) {
    const R = await both('env', part), L = R.V.menuItems(), labels = L.map(i => (i.sep ? '|' : i.label));
    for (const x of ['Lock Module', 'Init Module', 'Copy', 'Swap with', 'Legato Inverted', 'Grid', 'Voice Steal Retrigger']) assert.ok(labels.includes(x), part + ': ' + x);
    assert.deepEqual([labels.filter(x => x === 'Lock Module').length, /\|\|/.test(labels.join('')), labels[0] !== '|', labels.at(-1) !== '|'], [1, false, true, true], part + ': ' + labels.join(' '));
    R.V.destroy();
  }
});

test('an Oscillator re-lays on a type switch (Wavetable → Sample: the sample row, its ids; → Granular: the kit interior in the screen); the warp menus in the screen strip; the drawer keeps Unison… / Pitch… and the sends', async () => {
  const R = await both('osc', 'oscA');
  const V = R.V, el = V.el;
  assert.equal(within(el, '.rig-strip', '.wk-menu').filter(m => m.getAttribute('data-dest') === 'a.w1' || m.getAttribute('data-dest') === 'a.w2').length, 2);
  assert.deepEqual(['a.fbal', 'a.bus1', 'a.bus2'].map(id => V.drawer.el.querySelectorAll('[data-dest="' + id + '"]').length), [1, 1, 1]);
  assert.ok(V.drawer.el.querySelectorAll('.sx-hbtn').some(b => b.textContent === 'Unison…'));
  R.host.st.s.osc[0].type = 'sample';
  R.X.paint(true);
  assert.equal(V.face.variant, 'osc.sample');
  assert.equal(el.getAttribute('data-rig-variant'), 'osc.sample');
  for (const id of ['a.sstart', 'a.send', 'a.lstart', 'a.lend', 'a.xfade', 'a.slice', 'a.scan', 'a.lenrate']) assert.ok(ids(el).has(id), id);
  assert.equal(within(el, '.rig-park', '[data-dest="a.wt"]').length, 1, 'the wavetable\'s WT POS parked (kept, hidden)');
  assert.equal(el.querySelectorAll('.rig-cap').map(c => c.textContent).includes('LOOP'), true);
  R.host.st.s.osc[0].type = 'gran';
  R.X.paint(true);
  assert.equal(V.face.variant, 'osc.kit');
  assert.equal(el.querySelectorAll('.rig-screen')[0].getAttribute('data-h'), 'K');
  R.host.st.s.osc[0].type = 'wt';
  R.X.paint(true);
  assert.equal(V.face.variant, 'osc');
  assert.equal(within(el, '.rig-park', '[data-dest="a.wt"]').length, 0, 'back on the grid');
  V.destroy();
});

test('the dim policy: a cell whose every member the kit hides shows its first one dimmed (never a hole); a visible one clears it', async () => {
  const R = await both('osc', 'oscA', s => { s.osc[0].type = 'sample'; });
  const el = R.V.el, cell = el.querySelector('[data-dest="a.xfade"]').parentNode;
  assert.equal(cell.classList.contains('rig-cell'), true);
  assert.equal(cell.hasAttribute('data-dim'), true, 'X-FADE is hidden by the kit at loop mode off: dimmed');
  R.host.st.s.osc[0].smpo.loop = 1;
  R.X.paint(true);
  assert.equal(cell.hasAttribute('data-dim'), false, 'a loop mode with a crossfade: shown');
  R.V.destroy();
});

test('the Filter: its display in a screen, our words on the input switches (data-pdest kept), KEY in a cell, CLEAN in the head, X / Y dimmed below the new types', async () => {
  const R = await both('filter', 'filter');
  const el = R.V.el;
  assert.equal(within(el, '.rig-screen', '.sx-disp').length, 1);
  const sw = within(el, '.rig-switches', '.wk-tog');
  assert.deepEqual(sw.map(e => e.textContent.trim()), ['OSC 1', 'OSC 2', 'OSC 3', 'NOISE', 'SUB']);
  assert.deepEqual(sw.map(e => e.getAttribute('data-pdest')), ['f.routeA', 'f.routeB', 'f.routeC', 'f.routeN', 'f.routeS']);
  assert.equal(sw.some(e => e.getAttribute('data-dest')), false, 'no modulation target (the kit\'s rule, 2b)');
  sw[1].click();
  assert.equal(R.host.log.some(x => x[0] === 'edit' && /Filter 1 routing/.test(x[1])), true, 'a switch is the kit\'s routeTap');
  assert.ok(within(el, '.rig-head', '.wk-tog').some(e => e.textContent.trim() === 'CLEAN'));
  assert.ok(within(el, '.rig-knobs', '.wk-tog').some(e => e.textContent.trim() === 'KEY'));
  assert.equal(el.querySelector('[data-dest="f.x"]').classList.contains('wk-dis'), true, 'X dimmed below type 96');
  R.V.destroy();
});

test('Envelope 1 (the amp slot): its curves row centred on columns 2–4, ENV 2\'s START / END parked as the kit keeps them; a free Envelope has five', async () => {
  const A = await both('env', 'env1');
  const r1 = A.V.el.children.filter(e => e.classList.contains('rig-knobs'))[1];
  assert.deepEqual(r1.children.map(c => c.style.gridColumn), ['2 / span 1', '3 / span 1', '4 / span 1']);
  assert.equal(within(A.V.el, '.rig-park', '[data-dest="e2.start"]').length, 1);
  A.V.destroy();
  const B = await both('env', 'env2');
  assert.equal(B.V.el.children.filter(e => e.classList.contains('rig-knobs'))[1].children.length, 5);
  assert.equal(within(B.V.el, '.rig-row', '.wk-knob[data-dest="e2.start"]').length, 1);
  B.V.destroy();
});

test('a face\'s bar title reads the fixed display ordinal (args.n, dev.rig.n): Envelope 2 in slot 4 stays "Envelope 2"', async () => {
  const R = rig(), box = R.doc.createElement('div');
  R.doc.body.appendChild(box);
  const V = RU.rigHost({ doc: R.doc }).face('env', box, { host: R.X, part: 'env4', n: 2, dev: 'i1' });
  assert.equal(V.el.getAttribute('aria-label'), 'Envelope 2');
  assert.equal(V.jacks.get('out').getAttribute('aria-label'), 'Envelope 2 · OUT');
  V.destroy();
});

test('rigHost.face refuses without a host or for an unknown kind; the Macros\' tiles are its jacks (k1…k8)', async () => {
  const rh = RU.rigHost({});
  assert.throws(() => rh.face('osc', null, {}), /SerumHost/);
  const R = rig(), box = R.doc.createElement('div');
  R.doc.body.appendChild(box);
  assert.throws(() => rh.face('arp', box, { host: R.X }), /no face/);
  const V = rh.face('macros', box, { host: R.X, part: 'macros', dev: 'i1' });
  await D.flush(R.doc);
  assert.deepEqual(V.el.querySelectorAll('[data-jack]').map(e => e.getAttribute('data-jack')), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  assert.equal(V.el.querySelectorAll('.rig-jack').length, 0, 'no jack row');
  V.destroy();
});

/* ================================================================ the jack row's tap menu (the drag is cv-cables', lane C) */
// a world of rig jacks: two oscillator outs, the Amplifier's IN (Σ) and LEVEL, a filter IN (Σ), the Oscillator's read-only WARP, an
// Envelope's OUT (mod) and an LFO's OUT (mod); stubbed rules; the menus recorded
function patchWorld(over) {
  const doc = D.fresh(), wEl = doc.createElement('div');
  doc.body.appendChild(wEl);
  const J = (jk, dir, o) => { const e = doc.createElement('span'); e.setAttribute('data-cv-jack', jk); e.setAttribute('data-kind', 'cord'); e.setAttribute('data-dir', dir); if (o && o.ro) e.setAttribute('data-ro', ''); if (o && o.sum) e.setAttribute('data-sum', ''); if (o && o.mod) e.setAttribute('data-cord', 'mod'); wEl.appendChild(e); return e; };
  const els = { a: J('i1/oscA.out', 'out'), b: J('i1/oscB.out', 'out'), main: J('i1.main', 'in', { sum: true }), level: J('i1.level', 'in'), fin: J('i1/filter.in', 'in', { sum: true }), warp: J('i1/oscA.warp', 'in', { ro: true }),
    env: J('i1/env2.out', 'out', { mod: true }), lfo: J('i1/lfo1.out', 'out', { mod: true }) };
  const edits = [], notes = [], menus = [], colours = [];
  const st = { recs: [] };
  const audio = e => /^(osc[ABC]|sub|noise|filter2?)\.out$/.test(e), ins = e => /^(voice\.(main|direct)|filter2?\.in)$/.test(e);
  const P = Object.assign({ doc, world: { el: wEl }, cur: () => ({ t: { id: 't1' }, dev: 'i1', s: { p: {} }, fx: {}, rig: {} }), rec: () => st.recs,
    edit: (t, dev, label, r) => { edits.push([label, r]); return true; }, notice: (t, ms, tap) => notes.push([t, !!tap]), undo: () => {}, menu: (x, y, items) => { menus.push(items); return { close() {} }; },
    can: (s, fx, a, b) => (a === 'oscB.out' && b === 'filter.in' ? { ok: false, why: 'Two filters at most' } : audio(a) && ins(b) ? { ok: true } : a === 'env2.out' && b === 'voice.level' ? { ok: true } : { ok: false, why: 'no' }),
    plug: (s, fx, a, b) => ({ f: [['x', 0, 1]], why: '', notes: [], a, b }), pull: (s, fx, id) => ({ f: [['y', 1, 0]], why: '', notes: [], id }),
    repatch: (s, fx, id, end, b) => ({ f: [['z', 0, 1]], why: '', notes: [], id, end, b }), colour: (t, dev, src, c) => { colours.push([src, c]); return true; } }, over);
  return { doc, els, edits, notes, menus, colours, st, P, G: RU.rigHost(P) };
}
const labels = items => items.map(i => (i.sep ? '—' : i.label));

test('jack menu: endOf / jackKey round trip ("i1/oscA.out" ↔ "oscA.out", "i1.main" ↔ "voice.main"); foreign keys are null; press declines every press (the drag is cv-cables\')', () => {
  const G = RU.rigHost({});
  assert.equal(G.endOf('i1', 'i1/oscA.out'), 'oscA.out');
  assert.equal(G.endOf('i1', 'i1.level'), 'voice.level');
  assert.equal(G.endOf('i1', 'i2/oscA.out'), null);
  assert.equal(G.endOf('i1', 'i1/m3.j-saw'), null, 'a patch cord jack is no rig end');
  for (const e of ['oscA.out', 'voice.main', 'filter2.in', 'env3.out', 'macros.k4']) assert.equal(G.endOf('i1', G.jackKey('i1', e)), e);
  assert.equal(G.press({ button: 0 }, null), false);
  assert.equal(typeof G.jackMenu, 'function');
});

test('jack menu: an empty jack → "Connect to…" (the jacks `can` accepts, a read-only one never; a pick plugs: one edit, rig-core\'s result); a refused pick says why and writes nothing', () => {
  const W = patchWorld(), { els, G } = W;
  assert.ok(G.jackMenu('i1/oscA.out', els.a, 10, 20), 'handled (cv-cables\' call: the jack key and its element)');
  assert.deepEqual(labels(W.menus[0]), ['Connect Oscillator 1 · OUT to…', 'Amplifier · IN', 'Filter 1 · IN']);
  W.menus[0][1].action();
  assert.equal(W.edits[0][0], 'Plug Oscillator 1 · OUT → Amplifier · IN');
  assert.deepEqual([W.edits[0][1].a, W.edits[0][1].b], ['oscA.out', 'voice.main']);
  assert.deepEqual(W.notes[0], ['Plug Oscillator 1 · OUT → Amplifier · IN · tap to undo', true], '(review 2 P3-4) a menu plug says "tap to undo", as a drag does');
  // from an input: its outputs (a refused one is not offered)
  G.jackMenu(els.fin, { clientX: 5, clientY: 5 });
  assert.deepEqual(labels(W.menus[1]), ['Connect Filter 1 · IN to…', 'Oscillator 1 · OUT'], '(jackEl, event) works too; Oscillator 2 refused: not listed');
  W.menus[1][1].action();
  assert.deepEqual([W.edits[1][1].a, W.edits[1][1].b], ['oscA.out', 'filter.in']);
  const W2 = patchWorld({ plug: () => ({ f: [], why: 'A rig plugs into its own modules', notes: [] }) });
  W2.G.jackMenu('i1/oscA.out', W2.els.a);
  W2.menus[0][1].action();
  assert.equal(W2.edits.length, 0);
  assert.deepEqual(W2.notes[0], ['A rig plugs into its own modules', false]);
  const W3 = patchWorld({ plug: () => ({ f: [['x', 0, 1]], why: '', notes: ['Envelope 2 shapes the level'] }) });
  W3.G.jackMenu('i1/oscA.out', W3.els.a);
  W3.menus[0][1].action();
  assert.deepEqual(W3.notes, [['Envelope 2 shapes the level · tap to undo', true]], 'its notes, when it has some, say it');
});

test('jack menu: a plugged jack → its plug menu (the cord, Pull · Re-patch to ▸ · Colour ▸ eight swatches), several cords → "Which cord?" (the most recent first), an output or a Σ input adds "Connect to"; Pull, Re-patch say "tap to undo" (review 2 P3-4: every menu edit)', () => {
  const W = patchWorld(), { els, G } = W;
  W.st.recs = [{ id: 'r1', a: 'oscB.out', b: 'voice.main', c: 3 }, { id: 'r2', a: 'oscA.out', b: 'voice.main', c: 2 }, { id: 'w1', a: 'oscB.out', b: 'oscA.warp', ro: true, label: 'FM' }];
  G.jackMenu('i1/oscA.out', els.a, 0, 0);
  const m0 = W.menus[0];
  assert.deepEqual(labels(m0), ['Oscillator 1 · OUT → Amplifier · IN', 'Pull', 'Re-patch to', 'Colour', '—', 'Connect to']);
  assert.deepEqual(labels(m0[2].sub), ['Filter 1 · IN'], 're-patch the plug to the other inputs');
  assert.equal(m0[3].sub.length, 8);
  assert.equal(m0[3].sub[2].checked, true, 'its colour checked');
  m0[3].sub[5].action();
  assert.deepEqual(W.colours[0], ['oscA.out', 5], 'the colour by the source end (dev.rig.cc)');
  m0[2].sub[0].action();
  assert.equal(W.edits[0][0], 'Re-patch Oscillator 1 · OUT → Filter 1 · IN');
  assert.deepEqual([W.edits[0][1].id, W.edits[0][1].end, W.edits[0][1].b], ['r2', 'b', 'filter.in']);
  assert.deepEqual(W.notes[0], ['Re-patch Oscillator 1 · OUT → Filter 1 · IN · tap to undo', true]);
  G.jackMenu('i1.main', els.main, 0, 0);
  const m1 = W.menus[1];
  assert.deepEqual(labels(m1), ['Which cord?', 'Oscillator 1 · OUT', 'Oscillator 2 · OUT', '—', 'Connect to']);
  assert.deepEqual(labels(m1[1].sub), ['Pull', 'Re-patch to', 'Colour']);
  m1[1].sub[0].action();
  assert.equal(W.edits[1][0], 'Pull Oscillator 1 · OUT → Amplifier · IN');
  assert.equal(W.edits[1][1].id, 'r2');
  assert.deepEqual(W.notes.slice(1), [['Cord pulled · tap to undo', true]], 'once');
});

test('jack menu: a read-only jack lists what reaches it; an Envelope\'s OUT offers the Amplifier\'s LEVEL (the amp slot\'s menu path); a modulator with nothing to reach → null (cv-cables\' own tap); not this rig\'s jack → null', () => {
  const W = patchWorld(), { els, G } = W;
  W.st.recs = [{ id: 'w1', a: 'oscB.out', b: 'oscA.warp', ro: true, label: 'FM' }];
  G.jackMenu('i1/oscA.warp', els.warp, 0, 0);
  assert.deepEqual(labels(W.menus[0]), ['Oscillator 1 · WARP', 'Oscillator 2 · OUT (FM)']);
  assert.ok(W.menus[0].every(i => i.disabled));
  G.jackMenu('i1/env2.out', els.env, 0, 0);
  assert.deepEqual(labels(W.menus[1]), ['Connect Envelope 2 · OUT to…', 'Amplifier · LEVEL']);
  W.menus[1][1].action();
  assert.deepEqual([W.edits[0][1].a, W.edits[0][1].b], ['env2.out', 'voice.level']);
  assert.equal(G.jackMenu('i1/lfo1.out', els.lfo, 0, 0), null, 'an LFO\'s targets are knobs');
  assert.equal(G.jackMenu('i2/oscA.out', els.a, 0, 0), null);
  assert.equal(RU.rigHost(Object.assign({}, W.P, { cur: () => null })).jackMenu('i1/oscA.out', els.a), null, 'no rig shown');
  assert.equal(W.menus.length, 2);
});

test('applySkin: one attribute on the world (an unknown id → the default skin)', () => {
  const doc = D.fresh(), w = doc.createElement('div');
  assert.equal(RU.rigHost({}).applySkin(w, 'charcoal'), 'charcoal');
  assert.equal(w.getAttribute('data-cv-skin'), 'charcoal');
  assert.equal(RU.applySkin(w, 'neon'), RC.SKIN_DEFAULT);
  assert.equal(RU.applySkin(null, 'charcoal'), 'charcoal');
});
