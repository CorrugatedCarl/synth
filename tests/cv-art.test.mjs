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
  assert.deepEqual([...A.GLYPHS].sort(), ['env', 'filter', 'fx', 'lfo', 'macro', 'noise', 'osc', 'out', 'sub', 'velo', 'voice', 'wheel']);
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
  assert.deepEqual(A.tileMeta('nope'), { id: 'nope', name: 'nope', year: 0, maker: '', label: 'nope' });
});
