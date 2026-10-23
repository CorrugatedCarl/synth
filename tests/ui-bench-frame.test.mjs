import './v8-guard.mjs';
// tests/ui-bench-frame.mjs (IMPL-P §4, review 2 F6): the bench pages' app frame carries the bench URL's test switches. The frame
// is a srcdoc iframe, whose location.search is empty — so ?perf= / ?texmax= / ?nogl (cv-world's readers) never reached the app;
// with a switch in the bench URL the frame is now a real page (ui-bench-frame.html?perf=…) the bench then writes the app into
// (document.open / write / close inside the frame: its URL, query included, stays). Pure parts and the handshake on stand-in
// windows; the app itself runs in a browser only (tests/ui-bench.html?m9=1&s55=1&perf=low). Strings, numbers and booleans only
// into assert. Run alone: node --max-old-space-size=2048 --test tests/ui-bench-frame.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameOpts, frameQuery, mountFrame, installMount, presetInfo, presetNote, SWITCH_RE, FRAME_PAGE } from './ui-bench-frame.mjs?v=9';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');

test('frameOpts / frameQuery: only the switches the app reads (perf high|medium|low, texmax 1…6 digits > 0, nogl / nogl=1) pass, in a fixed order; the bench\'s own switches stay on the bench', () => {
  assert.deepEqual(frameOpts(''), { perf: null, texmax: 0, nogl: false });
  assert.deepEqual(frameOpts('?m9=1&s55=1&perf=low&texmax=4096&nogl'), { perf: 'low', texmax: 4096, nogl: true });
  assert.equal(frameQuery('?m9=1&s55=1&perf=low&texmax=4096&nogl'), '?perf=low&texmax=4096&nogl=1');
  assert.equal(frameQuery('?texmax=4096&perf=medium'), '?perf=medium&texmax=4096', 'a fixed order');
  assert.equal(frameQuery('?m9=1&s55=1&hand=1&gl=off&run=1&auto=1&scenes=s55w&gltest=1'), '', 'the bench\'s own switches (gl=off, gltest, scenes …) are not the app\'s');
  assert.equal(frameQuery(''), '');
  assert.equal(frameQuery('?perf=high'), '?perf=high', 'High asked is still asked (the result says so)');
  // what the app would not take is not forwarded (nor claimed in the results)
  for (const bad of ['?perf=ultra', '?perf=', '?perf=LOW', '?texmax=0', '?texmax=', '?texmax=1234567', '?texmax=40x', '?nogl=0', '?xperf=low', '?perf=lowx']) assert.equal(frameQuery(bad), '', bad);
  assert.equal(frameQuery('?nogl=1&perf=low'), '?perf=low&nogl=1');
  assert.deepEqual(frameOpts('?perf=low&perf=high'), { perf: 'low', texmax: 0, nogl: false }, 'the first, as cv-world\'s regexp');
});

test('the readers are cv-world\'s own: SWITCH_RE is the very regexps cv-world.js reads the URL with (a drift fails here)', () => {
  const src = read('../cv-world.js');
  for (const k of ['perf', 'texmax', 'nogl']) assert.ok(src.includes(String(SWITCH_RE[k])), k + ': ' + SWITCH_RE[k]);
});

// a stand-in browser: two windows (the bench page and the frame's) and an iframe element between them, delivering postMessage as a task
const stand = (benchHref = 'http://127.0.0.1:8817/tests/ui-bench.html?m9=1&s55=1&perf=low&texmax=4096') => {
  const log = [], ORIGIN = new URL(benchHref).origin;
  const mk = href => ({ href, ls: new Map(), location: { href, origin: ORIGIN, get search() { return new URL(this.href).search; } } });
  const bench = mk(benchHref), inner = mk('about:blank');
  inner.location.origin = ORIGIN; inner.parent = bench;
  const L = (w, t, f) => { if (!w.ls.has(t)) w.ls.set(t, []); w.ls.get(t).push(f); };
  for (const w of [bench, inner]) w.addEventListener = (t, f) => L(w, t, f);
  const deliver = (to, from, data) => Promise.resolve().then(() => { for (const f of (to.ls.get('message') || []).slice()) f({ data, source: from, origin: ORIGIN }); });
  bench.postMessage = (d, o) => { log.push('bench.postMessage ' + JSON.stringify(d).slice(0, 60) + ' ' + o); return deliver(bench, inner, d); };
  inner.postMessage = (d, o) => { log.push('frame.postMessage ' + (d && d.t) + ' ' + o); return deliver(inner, bench, d); };
  inner.document = { open: () => { log.push('open'); inner.ls.clear(); }, write: h => log.push('write ' + h.length), close: () => log.push('close') };
  const frame = { _src: '', _srcdoc: null, contentWindow: inner, get src() { return this._src; }, set src(v) { this._src = v; log.push('src ' + v); Promise.resolve().then(() => { inner.href = v; inner.location.href = v; installMount(inner); }); },
    get srcdoc() { return this._srcdoc; }, set srcdoc(v) { this._srcdoc = v; log.push('srcdoc ' + String(v).length); }, removeAttribute(k) { if (k === 'srcdoc') this._srcdoc = null; } };
  return { bench, inner, frame, log };
};

test('mountFrame without a switch: the srcdoc as ever (no new page, no message, the bench\'s numbers stay comparable)', async () => {
  const s = stand('http://127.0.0.1:8817/tests/ui-bench.html?m9=1&s55=1');
  const how = await mountFrame(s.frame, '<html>app</html>', '', s.bench.location.href, s.bench);
  assert.deepEqual([how, s.frame.srcdoc, s.frame.src, s.log.length], ['srcdoc', '<html>app</html>', '', 1]);
});

test('mountFrame with a switch: the frame loads ui-bench-frame.html?perf=…, answers ready, is sent the app\'s page and writes it inside itself — its location.search keeps the query the app\'s cv-world reads', async () => {
  const s = stand(), q = frameQuery(s.bench.location.href.slice(s.bench.location.href.indexOf('?')));
  assert.equal(q, '?perf=low&texmax=4096');
  const how = await mountFrame(s.frame, '<html>the app, 20 chars</html>', q, s.bench.location.href, s.bench);
  assert.equal(how, 'url');
  assert.equal(s.frame.src, 'http://127.0.0.1:8817/tests/' + FRAME_PAGE + '?perf=low&texmax=4096', 'beside the bench page, the query on it');
  assert.equal(s.frame.srcdoc, null, 'no srcdoc (it would win over the src)');
  assert.deepEqual(s.log, ['src http://127.0.0.1:8817/tests/' + FRAME_PAGE + '?perf=low&texmax=4096', 'bench.postMessage {"t":"ui-bench-frame-ready"} http://127.0.0.1:8817',
    'frame.postMessage ui-bench-mount http://127.0.0.1:8817', 'open', 'write 30', 'close'], 'the page, its ready to the bench, the app\'s page to it (both to the origin only), then open / write / close once');
  assert.equal(s.inner.location.search, '?perf=low&texmax=4096', 'the app\'s cv-world reads this');
});

test('installMount: a message from anywhere else, from another origin or of another kind writes nothing', async () => {
  const s = stand();
  s.inner.location.href = 'http://127.0.0.1:8817/tests/' + FRAME_PAGE + '?perf=low'; installMount(s.inner);
  const fire = (data, source, origin) => { for (const f of s.inner.ls.get('message')) f({ data, source, origin }); };
  fire({ t: 'ui-bench-mount', html: '<x>' }, {}, 'http://127.0.0.1:8817');
  fire({ t: 'ui-bench-mount', html: '<x>' }, s.bench, 'http://evil.example');
  fire({ t: 'other', html: '<x>' }, s.bench, 'http://127.0.0.1:8817');
  fire({ t: 'ui-bench-mount', html: 5 }, s.bench, 'http://127.0.0.1:8817');
  fire(null, s.bench, 'http://127.0.0.1:8817');
  assert.deepEqual(s.log.filter(l => /^(open|write|close)/.test(l)), []);
  fire({ t: 'ui-bench-mount', html: '<ok>' }, s.bench, 'http://127.0.0.1:8817');
  assert.deepEqual(s.log.filter(l => /^(open|write|close)/.test(l)), ['open', 'write 4', 'close']);
});

test('mountFrame: a frame page that never answers rejects (the bench says so instead of waiting forever)', async () => {
  const s = stand();
  const dead = { removeAttribute() {}, set src(v) { /* never loads */ }, get src() { return ''; }, contentWindow: s.inner };
  await assert.rejects(() => mountFrame(dead, '<x>', '?perf=low', s.bench.location.href, s.bench, 30), /did not answer/);
});

test('presetInfo: what was asked and what the world runs — the results say whether the switch reached the app (ok), with the face budget and the texture side limit', () => {
  const world = (perf, g) => ({ perf, glStats: () => g });
  const g = { faceBudget: 96e6, texSide: 4096 };
  assert.deepEqual(presetInfo(world('low', g), '?perf=low&texmax=4096'), { asked: 'low', world: 'low', texmaxAsked: 4096, texSide: 4096, faceBudget: 96e6, nogl: false, ok: true });
  assert.deepEqual(presetInfo(world('high', { faceBudget: 384e6, texSide: 16384 }), '?m9=1'), { asked: null, world: 'high', texmaxAsked: null, texSide: 16384, faceBudget: 384e6, nogl: false, ok: true });
  const miss = presetInfo(world('high', { faceBudget: 384e6, texSide: 16384 }), '?perf=low&texmax=4096');
  assert.deepEqual([miss.ok, miss.asked, miss.world], [false, 'low', 'high'], 'asked Low, the world runs High: the switch did not reach the app');
  assert.equal(presetInfo(world('low', { faceBudget: 96e6, texSide: 16384 }), '?perf=low&texmax=4096').ok, false, 'texmax asked, the side limit above it');
  assert.equal(presetInfo(world('low', { faceBudget: 96e6, texSide: 2048 }), '?perf=low&texmax=4096').ok, true, 'a GPU below the ask keeps its own (never a raise)');
  assert.deepEqual(presetInfo(null, '?perf=low'), { asked: 'low', world: null, texmaxAsked: null, texSide: null, faceBudget: null, nogl: false, ok: false }, 'no world (2D path / not yet): not ok when something was asked');
  assert.equal(presetNote(presetInfo(world('high', { faceBudget: 384e6, texSide: 16384 }), '?perf=low')), 'the preset asked for (low) did not reach the app frame: it runs high');
  assert.equal(presetNote(miss), 'the preset asked for (low) did not reach the app frame: it runs high; texmax 4096 did not reach the app frame (texture side limit 16384)');
  assert.equal(presetNote(presetInfo(world('low', g), '?perf=low&texmax=4096')), '');
  assert.match(presetNote(presetInfo(world('low', { faceBudget: 96e6, texSide: 16384 }), '?texmax=4096')), /texmax 4096 did not reach the app frame/);
});

test('wiring: both bench pages build their app frame through mountFrame and write the preset into their results; ui-bench-frame.html carries the handshake page; ui-bench-m9\'s auto runs can use the app\'s own cord layer', () => {
  const html = read('ui-bench.html'), m9 = read('ui-bench-m9.mjs'), page = read(FRAME_PAGE);
  for (const [name, src] of [['ui-bench.html', html], ['ui-bench-m9.mjs', m9]]) {
    assert.ok(/mountFrame\(/.test(src), name + ': mountFrame');
    assert.ok(/presetInfo\(/.test(src), name + ': presetInfo into the results');
    assert.equal(/\.srcdoc\s*=/.test(src), false, name + ': no direct srcdoc assignment left (mountFrame owns it)');
  }
  assert.ok(/installMount/.test(page) && /ui-bench-frame\.mjs/.test(page), 'the frame page installs the handshake');
  assert.ok(/world\.cords\(\)|W\.cords\(\)/.test(m9) && /function realCords\(/.test(m9), 'the app\'s own cord layer behind the bench\'s cord calls');
});
