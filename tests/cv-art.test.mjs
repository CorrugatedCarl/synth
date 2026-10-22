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
  const makers = [...new Set(MODELS.map(m => m.maker.toLowerCase()))];
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
    assert.equal(t.label, m.id === 'serum' ? 'Serum (complete)' : m.name);
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
  assert.deepEqual(A.tileMeta('nope'), { id: 'nope', name: 'nope', year: 0, maker: '', label: 'nope' });
});
