import './v8-guard.mjs';
// cv-art.js (stage 1b SHELL lane; docs/canvas/IMPL-1b.md §8.1): a drawing for every MODELS id, cached and
// deterministic, no <text> / <image> / href / maker names in the SVG, chip and glyph sizes, tileMeta from models.js.
// Run alone: node --max-old-space-size=2048 --test tests/cv-art.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../cv-art.js?v=9';
import { MODELS } from '../models.js?v=9';

// a tiny well-formedness check: every opened element is closed in order (self-closing ones skipped)
function balanced(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , self] = m;
    if (self) continue;
    if (!close) stack.push(tag);
    else if (stack.pop() !== tag) return false;
  }
  return stack.length === 0;
}
const count = (s, re) => (s.match(re) || []).length;

test('art(): every MODELS id has its own drawing — an <svg> with the requested viewBox and size, well formed, cached per id + size', () => {
  const seen = new Set();
  for (const m of MODELS) {
    const s = A.art(m.id, { w: 96, h: 56 });
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 56" width="96" height="56" role="img" aria-hidden="true"/, m.id);
    assert.ok(s.endsWith('</svg>'), m.id + ': closed');
    assert.ok(balanced(s), m.id + ': well formed');
    assert.equal(A.art(m.id, { w: 96, h: 56 }), s, m.id + ': the same string again (cached)');
    assert.equal(A.art(m.id), s, m.id + ': TILE is the default size');
    assert.match(s, new RegExp(`data-art="${m.id}"`), m.id + ': its own drawing (not the fallback)');
    assert.ok(!seen.has(s), m.id + ': differs from the others');
    seen.add(s);
    const big = A.art(m.id, { w: 288, h: 168 });
    assert.match(big, /viewBox="0 0 288 168" width="288" height="168"/, m.id + ': any size');
    assert.ok(count(s, /<(rect|circle|path|polygon|ellipse)\b/g) >= 12, m.id + ': a drawing with some detail');
  }
  assert.equal(seen.size, MODELS.length);
  // an odd aspect is fitted (uniform scale, centred), an unknown id gets a plain keyboard
  assert.match(A.art('minimoog', { w: 200, h: 56 }), /translate\(52 0\) scale\(1\)/);
  assert.match(A.art('nope', { w: 96, h: 56 }), /data-art="keyboard"/);
});

test('rules (SPEC-canvas §3): no <text>, <image>, links, scripts, fonts or gradient ids — and no maker or wordmark in any drawing', () => {
  const makers = [...new Set(MODELS.filter(m => m.maker).map(m => m.maker.toLowerCase()))]; // ((WC) a maker-less model — the rig is ours — names none
  for (const m of MODELS) for (const sz of [A.TILE, A.CHIP, { w: 300, h: 120 }, { w: 40, h: 40 }]) {
    const s = A.art(m.id, sz), lo = s.toLowerCase(), at = `${m.id} ${sz.w}×${sz.h}`;
    for (const bad of ['<text', '<image', '<use', '<script', '<foreignobject', 'href', 'xlink', 'url(', 'font', '<lineargradient', '<pattern', ' id="'])
      assert.ok(!lo.includes(bad), at + ': no ' + bad);
    for (const mk of makers) assert.ok(!lo.includes(mk), at + ': no maker name ' + mk);
  }
});

test('chip(): the CHIP size and a simpler level of detail than the tile; glyph(): every kind in currentColor strokes, sized, cached', () => {
  assert.deepEqual([A.CHIP.w, A.CHIP.h, A.TILE.w, A.TILE.h], [28, 18, 96, 56]);
  for (const m of MODELS) {
    const c = A.chip(m.id), t = A.art(m.id);
    assert.match(c, /viewBox="0 0 28 18" width="28" height="18"/, m.id);
    assert.equal(c, A.art(m.id, A.CHIP));
    assert.ok(count(c, /<[a-z]+ /g) < count(t, /<[a-z]+ /g), m.id + ': fewer elements than the tile');
    assert.ok(balanced(c), m.id + ': well formed');
  }
  assert.deepEqual([...A.GLYPHS].sort(), ['env', 'filter', 'fx', 'lfo', 'macro', 'noise', 'osc', 'out', 'pads', 'sub', 'velo', 'voice', 'wheel']);
  for (const k of A.GLYPHS) {
    const g = A.glyph(k, { w: 40, h: 24 });
    assert.match(g, /^<svg [^>]*viewBox="0 0 40 24" width="40" height="24"/, k);
    assert.match(g, new RegExp(`data-glyph="${k}"`));
    assert.match(g, /stroke="currentColor"/);
    assert.ok(balanced(g), k + ': well formed');
    assert.equal(A.glyph(k, { w: 40, h: 24 }), g, k + ': cached');
    assert.ok(!/<text|href|url\(/.test(g));
  }
  assert.match(A.glyph('osc'), /viewBox="0 0 32 32"/, 'default 32 × 32');
  assert.match(A.glyph('nope'), /data-glyph="fx"/, 'an unknown kind: the FX glyph');
});

test('SIL describes every model; tileMeta() is models.js (Serum: "Serum (complete)")', () => {
  assert.deepEqual(Object.keys(A.SIL).sort(), MODELS.map(m => m.id).sort());
  for (const m of MODELS) {
    const s = A.SIL[m.id];
    assert.ok(['keyboard', 'desktop', 'cabinet', 'box'].includes(s.body), m.id);
    assert.ok(Object.isFrozen(s));
    const t = A.tileMeta(m.id);
    assert.deepEqual([t.id, t.name, t.year, t.maker], [m.id, m.name, m.year, m.maker]);
    assert.equal(t.label, m.id === 'serum' ? 'Serum (complete)' : m.id === 'm900' ? 'Model 15' : m.name);
  }
  assert.equal(A.SIL.tb303.body, 'desktop');
  assert.equal(A.SIL.tb303.steps, 16);
  assert.equal(A.SIL.minimoog.cheeks, true);
  assert.equal(A.SIL.dx7.screen, true);
  // (7a, IMPL-7a §8.2) the TR-808's tile: a wide low case with sixteen step keys, drawn without text (the rules above), its own drawing
  assert.deepEqual([A.SIL.tr808.body, A.SIL.tr808.steps, A.SIL.tr808.keys], ['box', 16, undefined]);
  const t808 = A.art('tr808'), chip808 = A.chip('tr808');
  assert.match(t808, /data-art="tr808"/);
  for (const col of ['e8402c', 'f4893c', 'f5dc4e', 'f4f3ee']) {
    assert.equal(count(t808, new RegExp(`fill="#${col}"`, 'g')), 4, col + ': four step keys of the colour (red 1–4, orange 5–8, yellow 9–12, off-white 13–16)');
    assert.ok(count(chip808, new RegExp(`fill="#${col}"`, 'g')) >= 1, col + ': kept at chip size');
  }
  assert.equal(count(t808, /r="2" fill="#0b0b0c"/g), 22, 'the 22 voice knobs of the twelve columns (MASTER VOLUME is not drawn)');
  // (7b, IMPL-7b §8.2) the TR-606's tile: the TB-303's body family (a silver desktop case), six knobs, sixteen grey keys under red LEDs on a dark panel, no text
  assert.deepEqual([A.SIL.tr606.body, A.SIL.tr606.steps, A.SIL.tr606.keys], ['desktop', 16, undefined]);
  const t606 = A.art('tr606'), chip606 = A.chip('tr606');
  assert.match(t606, /data-art="tr606"/);
  assert.equal(count(t606, /r="2.5" fill="#2a2c2d"/g), 6, 'the six level knobs along the top');
  assert.equal(count(t606, /fill="#a7a9a7"/g), 16, 'the sixteen step keys');
  assert.equal(count(t606, /r="0.5" fill="(#d8371f|#5a1812)"/g), 16, 'a red LED over each key (every fourth lit)');
  assert.ok(count(chip606, /fill="#d9dad7"/g) >= 1 && count(chip606, /<[a-z]+ /g) < count(t606, /<[a-z]+ /g), 'the chip keeps the key strip, with fewer elements');
  assert.notEqual(t606, A.art('tb303'));
  // (7c, IMPL-7c §8.2) the TR-909's tile: the 808's body family (a wide low case, here light), nine blocks of dark knobs under slate bars, a red
  // three-digit display, sixteen cream step keys under a red LED each (every fourth lit), no text; its meta is "1983 · drum machine" (cv-tray)
  assert.deepEqual([A.SIL.tr909.body, A.SIL.tr909.steps, A.SIL.tr909.keys], ['box', 16, undefined]);
  const t909 = A.art('tr909'), chip909 = A.chip('tr909');
  assert.match(t909, /data-art="tr909"/);
  assert.equal(count(t909, /r="1.55" fill="#2c3550"/g), 27, 'the 27 voice knobs of the nine blocks (TEMPO and VOLUME are the larger two)');
  assert.equal(count(t909, /fill="#5b6580"/g), 9 + 1 + 4 + 1, 'nine header bars, the rule under the knobs, the four scale rows, the legend strip');
  assert.equal(count(t909, /fill="#f3ebcf"/g), 16, 'the sixteen step keys');
  assert.equal(count(t909, /r="0.5" fill="(#ff3b2a|#4b1812)"/g), 16, 'a red LED over each key (every fourth lit)');
  assert.equal(count(t909, /fill="#fffddc"/g), 3, 'START, STOP/CONT and ENTER');
  assert.ok(count(t909, /fill="#ff3b2a" opacity="0.9"/g) === 3, 'the three red digits');
  assert.ok(count(chip909, /fill="#f3ebcf"/g) >= 1 && count(chip909, /<[a-z]+ /g) < count(t909, /<[a-z]+ /g), 'the chip keeps the step keys, with fewer elements');
  assert.ok(!/roland/i.test(t909 + chip909), 'no maker name');
  assert.notEqual(t909, A.art('tr808'));
  // (8, IMPL-8 §13.4) the SDS-V's tile: a dark rack box — five voice cards (a name bar, two columns of three light-grey knobs, a 2 × 2 square of cream
  // memory keys with key 2 lit, two rows of small trimmers), two blank plates, the mixer's ten small knobs — and three hexagonal pads in front (no
  // sequencer: no step keys); no text; its meta is "1981 · drum synth" (cv-tray)
  assert.deepEqual([A.SIL.sdsv.body, A.SIL.sdsv.steps, A.SIL.sdsv.keys], ['box', undefined, undefined]);
  const tsv = A.art('sdsv'), chipsv = A.chip('sdsv');
  assert.match(tsv, /data-art="sdsv"/);
  assert.equal(count(tsv, /r="1.35" fill="#c8cac6"/g), 30, 'the thirty voice knobs of the five cards');
  assert.equal(count(tsv, /r="0.7" fill="#c8cac6"/g), 10, 'the mixer\'s ten knobs');
  assert.equal(count(tsv, /fill="#efe6cf"/g), 20, 'the twenty cream memory keys (four a card)');
  assert.equal(count(tsv, /r="0.4" fill="#e0281e"/g), 5, 'the lit LED of memory 2 on each card');
  assert.equal(count(tsv, /fill="#141517"/g), 2, 'the two blank plates (HI-HAT, CYMBAL)');
  assert.equal(count(tsv, /<polygon/g), 7, 'three hexagonal pads (fill + rim each) and the bass drum\'s lit centre');
  assert.ok(count(chipsv, /fill="#efe6cf"/g) >= 1 && count(chipsv, /<polygon/g) >= 1 && count(chipsv, /<[a-z]+ /g) < count(tsv, /<[a-z]+ /g), 'the chip keeps a key and the pad, with fewer elements');
  assert.ok(!/simmons|SDS-V/i.test(tsv + chipsv), 'no maker name, no model name in the drawing (the data-art id is plain)');
  assert.notEqual(tsv, A.art('tr909'));
  // (8, IMPL-8 §1.2) the Controllers view's Pads tile glyph: a 3 × 3 of rounded squares, one lit (filled), in currentColor
  const gp = A.glyph('pads');
  assert.equal(count(gp, /<rect /g), 9, 'nine pads');
  assert.equal(count(gp, /fill="currentColor"/g), 1, 'one lit');
  assert.deepEqual(A.tileMeta('sdsv'), { id: 'sdsv', name: 'SDS-V', year: 1981, maker: 'Simmons', label: 'SDS-V' });
  // (9, IMPL-9 §4.6) the 900 Series' tile, "Model 15": a small dark case with a handle and two latches, two tiers of narrow module faces (eight over six; the
  // wide lower one a filter bank of ten small knobs) over a console strip, five coloured cords hanging with a plug at both ends; no keys, no steps, no text
  assert.deepEqual([A.SIL.m900.body, A.SIL.m900.keys, A.SIL.m900.steps], ['cabinet', undefined, undefined]);
  const tm = A.art('m900'), chipm = A.chip('m900');
  assert.match(tm, /data-art="m900"/);
  assert.equal(count(tm, /fill="#2b2926"/g), 14, 'the fourteen module faces (eight over six)');
  assert.equal(count(tm, /r="1.85" fill="#d4cfc4"/g), 24 + 13, 'the big knobs: 24 on the upper tier (3 2 4 2 3 6 2 2), 13 on the lower (4 · the bank · 2 2 3 2)');
  assert.equal(count(tm, /r="1.05" fill="#d4cfc4"/g), 10, 'the filter bank\'s ten small knobs');
  assert.equal(count(tm, /r="0.5" fill="#050505"/g), 20 + 16 + 1, 'a jack\'s hole: 20 on the upper tier, 16 on the lower, the main output\'s (the console\'s multiples are smaller)');
  for (const col of ['d8452f', 'e6b422', '3b82c4', '3fae5a', 'b06ad9']) {
    assert.equal(count(tm, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': one cord');
    assert.equal(count(tm, new RegExp(`r="0.8" fill="#${col}"`, 'g')), 2, col + ': a plug at each end');
    assert.equal(count(chipm, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': kept at chip size');
  }
  assert.ok(count(chipm, /fill="#2b2926"/g) === 14 && count(chipm, /<[a-z]+ /g) < count(tm, /<[a-z]+ /g) / 2, 'the chip keeps the faces and the cords, with far fewer elements');
  assert.ok(!/moog|900 series|model 15/i.test((tm + chipm).replaceAll('data-art="m900"', '')), 'no maker name, no model name in the drawing (the data-art id is plain)');
  assert.notEqual(tm, A.art('modular'));
  assert.deepEqual(A.tileMeta('m900'), { id: 'm900', name: '900 Series', year: 1973, maker: 'R.A. Moog', label: 'Model 15' });
  assert.deepEqual(A.tileMeta('nope'), { id: 'nope', name: 'nope', year: 0, maker: '', label: 'nope' });
});

// (9b, IMPL-9b §4.3) the set tiles beside the Model 15's: System 35 (one wood wedge: nine narrow faces over eight, a console strip of five panels, no cords) and System 55
// (two wood-ended cabinets, the upper narrower: sixteen faces — one a sequencer — over fourteen, a console strip of seven panels, four coloured cords). (9c, IMPL-9c §2) The System
// IIIc: a wide wood cabinet under a narrow tower — sixteen faces over fifteen, a console strip of five panels, three coloured cords. Ours, no text, no logo.
test('set tiles (IMPL-9b §4.3; IMPL-9c §2): SET_ART s35 / s55 / s3c — tile and chip render, their own drawings with the contract\'s module counts, distinct silhouettes, no text', () => {
  const SIZES = [A.TILE, A.CHIP, { w: 300, h: 120 }, { w: 40, h: 40 }], IDS = ['s35', 's55', 's3c'];
  assert.deepEqual(Object.keys(A.SET_ART), IDS, 'one descriptor per set tile (SIL keys stay the MODELS ids)');
  assert.ok(!('s35' in A.SIL) && !('s55' in A.SIL) && !('s3c' in A.SIL));
  const mine = [A.SET_ART.s35.name, A.SET_ART.s35.modules, [...A.SET_ART.s35.rows], A.SET_ART.s35.console, A.SET_ART.s55.name, A.SET_ART.s55.modules, [...A.SET_ART.s55.rows], A.SET_ART.s55.console];
  assert.deepEqual(mine, ['System 35', 22, [9, 8], 5, 'System 55', 37, [16, 14], 7], 'the labels\' counts: 17 + 5 = 22, 30 + 7 = 37 (the controller not counted)');
  assert.deepEqual([A.SET_ART.s3c.name, A.SET_ART.s3c.modules, [...A.SET_ART.s3c.rows], A.SET_ART.s3c.console, A.SET_ART.s3c.body], ['System IIIc', 36, [16, 15], 5, 'tower'], '31 + 5 = 36: the IIIc\'s two Tidy rows and its console row');
  for (const id of IDS) {
    const d = A.SET_ART[id];
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.rows) && Object.isFrozen(d.outline) && d.outline.every(p => Object.isFrozen(p)), id + ': frozen');
    assert.equal(d.rows.reduce((a, b) => a + b, 0) + d.console, d.modules, id + ': modules = faces + console panels');
    // the tile: an <svg> of the requested size, well formed, cached per id + size, its own drawing, with the detail of a tile
    const s = A.setArt(id);
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 56" width="96" height="56" role="img" aria-hidden="true"/, id);
    assert.ok(s.endsWith('</svg>') && balanced(s), id + ': closed, well formed');
    assert.equal(A.setArt(id, { w: 96, h: 56 }), s, id + ': the same string again (TILE is the default, cached)');
    assert.match(s, new RegExp(`data-art="${id}"`));
    assert.match(A.setArt(id, { w: 288, h: 168 }), /viewBox="0 0 288 168" width="288" height="168"/, id + ': any size');
    assert.ok(count(s, /<(rect|circle|path|polygon|ellipse)\b/g) >= 300, id + ': a tile with a module\'s worth of detail');
    // the chip: CHIP size, simpler, well formed, cached
    const c = A.setChip(id);
    assert.match(c, /viewBox="0 0 28 18" width="28" height="18"/, id);
    assert.equal(c, A.setArt(id, A.CHIP));
    assert.ok(balanced(c) && count(c, /<[a-z]+ /g) < count(s, /<[a-z]+ /g) / 2, id + ': the chip has far fewer elements');
    // no text, no logo, no maker, no model name (the data-art id is plain)
    for (const sz of SIZES) {
      const lo = A.setArt(id, sz).toLowerCase().replace(`data-art="${id}"`, ''), at = `${id} ${sz.w}×${sz.h}`;
      for (const bad of ['<text', '<image', '<use', '<script', '<foreignobject', 'href', 'xlink', 'url(', 'font', '<lineargradient', '<pattern', ' id="', 'moog', 'system', 'model', '900']) assert.ok(!lo.includes(bad), at + ': no ' + bad);
    }
  }
  const T = { s35: A.setArt('s35'), s55: A.setArt('s55'), s3c: A.setArt('s3c') }, C = { s35: A.setChip('s35'), s55: A.setChip('s55'), s3c: A.setChip('s3c') }, m15 = A.art('m900'), m15c = A.chip('m900');
  // the faces and the console panels, counted: 17 + 5 on the wedge, 30 + 7 on the stack (the chip keeps them as blocks)
  const faces = g => count(g, /<polygon points="[^"]*" fill="#2b2926"/g), panels = g => count(g, /<polygon points="[^"]*" fill="#383430"/g);
  assert.deepEqual([faces(T.s35), panels(T.s35), faces(C.s35), panels(C.s35)], [17, 5, 17, 5], 's35: 9 + 8 faces, 5 console panels (tile and chip)');
  assert.deepEqual([faces(T.s55), panels(T.s55), faces(C.s55), panels(C.s55)], [30, 7, 30, 7], 's55: 16 + 14 faces, 7 console panels (tile and chip)');
  assert.deepEqual([faces(T.s3c), panels(T.s3c), faces(C.s3c), panels(C.s3c)], [31, 5, 31, 5], 's3c: 16 + 15 faces, 5 console panels (tile and chip)');
  assert.equal(count(T.s3c, /r="0.62" fill="#d4cfc4"/g) + count(T.s3c, /r="0.32" fill="#f2a33a"/g), 0, 's3c: no sequencer');
  assert.equal(count(T.s3c, /r="0.7" fill="#d4cfc4"/g), 14, 's3c: one wide filter bank, two rows of seven small knobs');
  assert.equal(count(T.s55, /r="0.32" fill="#f2a33a"/g), 8, 's55: the sequencer\'s lamp row (eight)');
  assert.equal(count(T.s55, /r="0.62" fill="#d4cfc4"/g), 24, 's55: the sequencer\'s three rows of eight dots');
  assert.equal(count(T.s35, /r="0.62" fill="#d4cfc4"/g) + count(T.s35, /r="0.32" fill="#f2a33a"/g), 0, 's35: no sequencer');
  assert.deepEqual([count(T.s35, /r="0.7" fill="#d4cfc4"/g), count(T.s55, /r="0.7" fill="#d4cfc4"/g)], [14, 14], 'a wide filter bank on each: two rows of seven small knobs');
  // the cords: four on the System 55 (a plug at each end, kept at chip size), none on the System 35
  for (const col of ['d8452f', 'e6b422', '3b82c4', '3fae5a']) {
    assert.equal(count(T.s55, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': one cord');
    assert.equal(count(T.s55, new RegExp(`r="0.72" fill="#${col}"`, 'g')), 2, col + ': a plug at each end');
    assert.equal(count(C.s55, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': kept at chip size');
    assert.equal(count(T.s35 + C.s35, new RegExp(`#${col}`, 'g')), 0, col + ': the wedge has no cords');
  }
  assert.equal(count(T.s55, /stroke="#b06ad9"/g), 0, 'the Model 15\'s fifth (purple) cord is not on the System 55');
  assert.deepEqual([A.SET_ART.s35.cords, A.SET_ART.s55.cords, A.SET_ART.s3c.cords], [0, 4, 3]);
  for (const col of ['d8452f', 'e6b422', '3b82c4']) assert.deepEqual([count(T.s3c, new RegExp(`stroke="#${col}"`, 'g')), count(T.s3c, new RegExp(`r="0.72" fill="#${col}"`, 'g')), count(C.s3c, new RegExp(`stroke="#${col}"`, 'g'))], [1, 2, 1], 's3c ' + col + ': a cord, a plug each end, kept at chip size');
  assert.equal(count(T.s3c, /#3fae5a/g), 0, 's3c: three cords, not four');
  // wood: the System 35 is one wooden polygon (its outline, drawn), the System 55 two wooden cabinets (the outline's rectangles); the Model 15 is a dark case with no wood
  const WOODFILL = '#74421f';
  assert.ok(T.s35.includes(`<polygon points="${A.SET_ART.s35.outline.map(p => p.join(',')).join(' ')}" fill="${WOODFILL}"`), 's35: its outline is the wooden body');
  assert.ok(T.s55.includes('<rect x="7" y="2" width="82" height="27.4" fill="#74421f"/>') && T.s55.includes('<rect x="3" y="29.4" width="90" height="23.6" fill="#74421f"/>'), 's55: its outline is the two cabinets');
  assert.ok(T.s3c.includes('<rect x="24" y="3.5" width="48" height="25.5" fill="#74421f"/>') && T.s3c.includes('<rect x="3" y="29" width="90" height="24" fill="#74421f"/>'), 's3c: its outline is the cabinet and its tower');
  assert.ok(!m15.includes(WOODFILL) && !m15c.includes(WOODFILL) && [T.s35, C.s35, T.s55, C.s55, T.s3c, C.s3c].every(g => g.includes(WOODFILL)), 'the sets are wood, the Model 15 is not');
  // distinct silhouettes: the System 35 a wedge (wider at every step down), the System 55 a step (two cabinets, constant width within each, the upper a step narrower), four corners vs eight
  const wAt = (poly, y) => { const xs = []; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; if ((p[1] - y) * (q[1] - y) < 0) xs.push(p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1])); }); return Math.max(...xs) - Math.min(...xs); };
  const O = i => A.SET_ART[i].outline, bb = p => [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[0])), Math.max(...p.map(q => q[1]))];
  assert.deepEqual([O('s35').length, O('s55').length], [4, 8], 'a wedge\'s four corners, a stack\'s eight');
  assert.ok(wAt(O('s35'), 8) < wAt(O('s35'), 20) && wAt(O('s35'), 20) < wAt(O('s35'), 35) && wAt(O('s35'), 35) < wAt(O('s35'), 50), 's35: wider at every step down');
  assert.ok(wAt(O('s35'), 8) / wAt(O('s35'), 50) < 0.85, 's35: the top is under 85 % of the foot');
  assert.equal(wAt(O('s55'), 5), wAt(O('s55'), 25), 's55: the upper cabinet keeps its width');
  assert.equal(wAt(O('s55'), 35), wAt(O('s55'), 50), 's55: the lower cabinet keeps its width');
  const step = wAt(O('s55'), 25) / wAt(O('s55'), 35);
  assert.ok(step < 0.95 && step > 0.85, 's55: the upper one a step narrower');
  assert.ok(bb(O('s55'))[3] - bb(O('s55'))[1] > bb(O('s35'))[3] - bb(O('s35'))[1], 'the stack is the taller');
  // the System IIIc: eight corners, a cabinet 90 wide and a tower 48 wide centred on it (a half; the System 55's upper is 82 of 90), the tower the taller part
  assert.equal(O('s3c').length, 8);
  assert.equal(wAt(O('s3c'), 40), 90); assert.equal(wAt(O('s3c'), 10), 48); assert.equal(wAt(O('s3c'), 20), 48);
  const mid = (poly, y) => { const xs = []; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; if ((p[1] - y) * (q[1] - y) < 0) xs.push(p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1])); }); return (Math.max(...xs) + Math.min(...xs)) / 2; };
  assert.equal(mid(O('s3c'), 10), mid(O('s3c'), 40), 's3c: the tower is centred on the cabinet');
  assert.ok(wAt(O('s3c'), 10) / wAt(O('s3c'), 40) < 0.6 && bb(O('s3c'))[3] - bb(O('s3c'))[1] > bb(O('s35'))[3] - bb(O('s35'))[1], 's3c: a narrow tower (under 60 %) and taller than the wedge');
  for (const i of IDS) { const b = bb(O(i)); assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= 96 && b[3] <= 56, i + ': inside the design box'); }
  // three tiles, three chips, all different from each other and from the other wooden cabinets
  assert.equal(new Set([m15, T.s35, T.s55, T.s3c, A.art('modular'), A.art('minimoog')]).size, 6);
  assert.equal(new Set([m15c, C.s35, C.s55, C.s3c]).size, 4);
  // an unknown set id: the Model 15's tile (the 900 Series' own), not a new drawing; that tile is untouched (its fourteen faces, stage 9's pin)
  assert.equal(A.setArt('nope'), m15);
  assert.equal(A.setArt('m15', A.CHIP), m15c);
  assert.equal(count(m15, /fill="#2b2926"/g), 14);
});

// (WC, IMPL-WC §7; lane U) the rig's tile and chip — ours, the cord lab's look in miniature: three charcoal faces side by side on a dark rack (an
// oscillator's with its little screen and wave, a filter's with one big knob over two, an amplifier's with four), four screws in every face's corners, a
// cream rule where a name would be engraved (never text), black knobs with cream pointers, two cream-ringed jacks at each face's foot, and two cords —
// yellow from the first face's OUT into the second's IN, blue from the second's OUT into the third's IN — sagging between them, a plug at each end.
test('rig art (IMPL-WC §7): SIL.rig + its own tile and chip — three charcoal faces with screws, knobs, cream-ringed jacks and two sagging cords; no text, no name, no maker', () => {
  assert.deepEqual([A.SIL.rig.body, A.SIL.rig.keys, A.SIL.rig.steps, Object.isFrozen(A.SIL.rig)], ['cabinet', undefined, undefined, true]);
  const t = A.art('rig'), c = A.chip('rig');
  assert.match(t, /data-art="rig"/);
  assert.ok(balanced(t) && balanced(c), 'well formed');
  assert.equal(count(t, /fill="#1f2023"/g), 3, 'three faces');
  assert.equal(count(t, /r="0.9" fill="#9c978a"/g), 12, 'four screws on each');
  assert.equal(count(t, /fill="#ebe6d8" opacity="0.85"/g), 3, 'a cream name rule on each face (no text)');
  assert.equal(count(t, /<rect [^>]*fill="#141518"/g), 1, 'the oscillator face\'s screen');
  assert.equal(count(t, /<circle [^>]*fill="#141518"/g), 2 + 3 + 4, 'nine black knob caps: two, one big and two, four');
  assert.equal(count(t, /<circle [^>]*r="4.2" fill="#141518"/g), 1, 'the filter\'s big one');
  assert.equal(count(t, /stroke="#ebe6d8" stroke-width="0.7"/g), 1, 'the knobs\' cream pointers (one path)');
  assert.equal(count(t, /stroke="#ebe6d8" stroke-width="0.6"/g), 1, 'the screen\'s cream wave');
  assert.deepEqual([count(t, /r="2.3" fill="#ebe6d8"/g), count(t, /r="0.95" fill="#0b0b0c"/g)], [6, 6], 'six cream-ringed jacks, two at each face\'s foot');
  for (const col of ['e6b83a', '3f80d8']) {
    assert.equal(count(t, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': one cord');
    assert.equal(count(t, new RegExp(`r="1" fill="#${col}"`, 'g')), 2, col + ': a plug at each end');
    assert.equal(count(c, new RegExp(`stroke="#${col}"`, 'g')), 1, col + ': kept at chip size');
  }
  // the cords sag: each path's two control points sit below its two ends, which are at one height (a hanging cord, not a straight line)
  const cords = [...t.matchAll(/<path d="M([\d.]+) ([\d.]+)C([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)" fill="none" stroke="#(e6b83a|3f80d8)"/g)];
  assert.equal(cords.length, 2);
  for (const m of cords) assert.ok(+m[4] > +m[2] + 4 && +m[6] > +m[8] + 4 && m[2] === m[8], m[9] + ': sags between jacks at one height');
  // the chip: the three faces and both cords kept, far fewer elements, no screws or pointers
  assert.equal(count(c, /fill="#1f2023"/g), 3, 'the chip keeps the faces');
  assert.ok(count(c, /<[a-z]+ /g) < count(t, /<[a-z]+ /g) / 2, 'far fewer elements');
  assert.equal(count(c, /fill="#9c978a"/g) + count(c, /stroke-width="0.7"/g), 0, 'no screws, no pointers at chip size');
  // ours: not the 900 Series' case, not the Serum's box; no name (the data-art id is plain), no Serum / Xfer word
  assert.notEqual(t, A.art('m900')); assert.notEqual(t, A.art('serum'));
  assert.notEqual(c, A.chip('m900')); assert.notEqual(c, A.chip('serum'));
  for (const s of [t, c, A.art('rig', { w: 300, h: 120 }), A.art('rig', { w: 40, h: 40 })]) {
    const lo = s.toLowerCase().replace('data-art="rig"', '');
    for (const bad of ['<text', 'href', 'font', 'serum', 'xfer', 'wavecraft', 'rig']) assert.ok(!lo.includes(bad), 'no ' + bad);
  }
});

// (WC pre-deploy [chip-art]) the rig's chip (the top bar's track chip, the track row's instrument button) was nearly invisible — its #17181a
// rack on the chrome's #141518 (contrast 1.06), black knob caps on charcoal faces — so only the cream jacks and the two cords showed: stray
// dots. At chip size the rack is the silhouette now: a lighter case with two rails, the three charcoal faces dark against it, light marks on
// every face (a cream rule, cream knob discs, the screen's amber wave, the jacks), the cords drawn thick enough to read
const lumOf = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrastOf = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
test('(WC pre-deploy [chip-art]) the rig\'s chip reads on the dark chrome: its case stands out (≥ 2:1 on #141518), the three charcoal faces against it (≥ 1.8:1), light marks on every face, cords ≥ 2.2 design px — the tile as it was', () => {
  const c = A.chip('rig'), CHROME = '#141518', FACE = '#1f2023';
  const rects = [...c.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: rx="[\d.]+")? fill="(#[0-9a-f]{6})"/g)].map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] }));
  const big = rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  assert.ok(big.w >= 85 && big.h >= 45, 'the case is the biggest shape');
  assert.ok(contrastOf(big.fill, CHROME) >= 2, `the case stands out from the chrome: ${big.fill} ${contrastOf(big.fill, CHROME).toFixed(2)}:1`);
  assert.ok(contrastOf(FACE, big.fill) >= 1.8, `the faces stand out from the case: ${contrastOf(FACE, big.fill).toFixed(2)}:1`);
  assert.equal(rects.filter(r => r.fill === FACE).length, 3, 'three faces');
  // light marks (≥ 0.4 luminance: cream, the amber wave) on every face, each a disc of r ≥ 2.4 or a bar ≥ 10 wide or a stroke ≥ 1.4
  const marks = [...rects.filter(r => lumOf(r.fill) >= 0.4 && r.w >= 10).map(r => r.x + r.w / 2),
    ...[...c.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="([\d.]+)" fill="(#[0-9a-f]{6})"/g)].filter(m => +m[2] >= 2.4 && lumOf(m[3]) >= 0.4).map(m => +m[1]),
    ...[...c.matchAll(/<path d="M([\d.]+)[^"]*" fill="none" stroke="(#[0-9a-f]{6})" stroke-width="([\d.]+)"/g)].filter(m => +m[3] >= 1.4 && lumOf(m[2]) >= 0.4 && !/e6b83a|3f80d8/.test(m[2])).map(m => +m[1] + 8)];
  for (const [l, r] of [[6, 32], [35, 61], [64, 90]]) assert.ok(marks.filter(x => x >= l && x <= r).length >= 3, `light marks on the face at ${l}: ${marks.filter(x => x >= l && x <= r).length}`);
  for (const col of ['e6b83a', '3f80d8']) { const m = new RegExp(`stroke="#${col}" stroke-width="([\\d.]+)"`).exec(c); assert.ok(m && +m[1] >= 2.2, col + ': the cord reads (' + (m && m[1]) + ')'); }
  // the 900 Series' chip and the Serum's: their own (unchanged by it)
  assert.ok(A.chip('m900').includes('fill="#1e1c19"') && A.chip('serum').includes('data-art="serum"'));
  // the tile (≥ 48 px wide) keeps its drawing: the rack th.panel, black knob caps with cream pointers
  assert.equal(count(A.art('rig'), /fill="#17181a"/g), 1);
  assert.equal(count(A.art('rig'), /<circle [^>]*fill="#141518"/g), 9);
});
