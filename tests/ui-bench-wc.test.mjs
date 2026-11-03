import './v8-guard.mjs';
// tests/ui-bench-wc.mjs's pure part (stage WC, IMPL-WC G7; lane C): the frame statistics, the burst analysis and IMPL-3 §1.5's P / P+
// verdict on synthetic recordings; §9's full rig as data (the module counts, 8 canvas mod cords); the page module imports with no DOM
// (its DOM work only inside main()); tests/ui-bench.html routes ?wc=1 to it.
// Run alone: node --max-old-space-size=2048 --test tests/ui-bench-wc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from './ui-bench-wc.mjs';

const rec = (dts, bursts) => { // frames every dt (ms) from t 0; bursts [[s, e]] → movestart / cameraend events
  const R = { f: [], ev: [] };
  let t = 0;
  for (const dt of dts) { t += dt; R.f.push(dt, t); }
  for (const [s, e] of bursts) R.ev.push(1, s, 2, e);
  return R;
};

test('q: n, median, p95, max, frames over 33 ms; not-numbers dropped', () => {
  assert.deepEqual(B.q([16.7, 16.6, 16.8, 40, 'x', NaN, 16.7]), { n: 5, med: 16.7, p95: 40, max: 40, over33: 1 });
  assert.deepEqual(B.q([]), { n: 0, med: 0, p95: 0, max: 0, over33: 0 });
});

test('analyse: burst frames (movestart … cameraend), the first 100 ms of each (firstMove), 800 ms after (settle), the rest; within a window', () => {
  const R = rec(Array(120).fill(16.7), [[500, 1500]]);
  const x = B.analyse(R);
  assert.equal(x.bursts, 1);
  assert.equal(x.first.n, 6, 'the first 100 ms: 6 frames');
  assert.equal(x.burst.n + x.first.n, 60, 'a 1 s burst at 60 Hz');
  assert.equal(x.settle.n, 31, 'after it (the recording ends at 2 004 ms: 31 frames of its 800 ms)');
  assert.equal(x.all.n, 120);
  assert.equal(B.analyse(R, 0, 400).bursts, 0, 'a window before it: none');
});

test('verdict (IMPL-3 §1.5): P+ at 60 Hz; one 40 ms burst frame → P; a 60 ms one → fail; two slow first frames in a burst → not P+; a context loss fails; no bursts said', () => {
  const smooth = rec(Array(120).fill(16.7), [[500, 1500]]);
  assert.equal(B.verdict(B.analyse(smooth)), 'P+');
  const d = Array(120).fill(16.7); d[50] = 40;
  assert.equal(B.verdict(B.analyse(rec(d, [[500, 1500]]))), 'P', 'one frame over 33 ms in the burst');
  const e = Array(120).fill(16.7); e[50] = 60;
  assert.equal(B.verdict(B.analyse(rec(e, [[500, 1500]]))), 'fail');
  const f = Array(120).fill(16.7); f[31] = 34; f[32] = 34;
  const fx = B.analyse(rec(f, [[500, 1500]]));
  assert.deepEqual([fx.first.multi, B.verdict(fx)], [1, 'P'], 'two first-move frames over 33 ms');
  assert.equal(B.verdict(B.analyse(smooth), { lost: true }), 'fail');
  assert.equal(B.verdict(B.analyse(rec(Array(30).fill(16.7), []))), 'no bursts');
  assert.deepEqual([B.BAR.Pp.med, B.BAR.Pp.p95, B.BAR.Pp.max, B.BAR.P.med, B.CORD_BAR.awake, B.DOM_BAR.full, B.DOM_BAR.heavy], [17, 20, 33, 17.5, 40, 5000, 1866]);
});

test('RIGX = §9\'s full WC-1 rig on the starter (Oscillator 1, Filter 1, Envelope 1): 3 Oscillators, Sub, Noise, 2 Filters, 4 Envelopes, 2 LFOs, Macros, 4 effects; 6 canvas modulators with 8 rows; its own rows from its modules', () => {
  const parts = ['oscA', 'filter', 'env1', ...B.RIGX.add.map(x => x[1])];
  const n = re => parts.filter(p => re.test(p)).length;
  assert.deepEqual([n(/^osc/), n(/^sub$/), n(/^noise$/), n(/^filter/), n(/^env/), n(/^lfo/), n(/^macros$/), B.RIGX.effects], [3, 1, 1, 2, 4, 2, 1, 4]);
  assert.deepEqual([B.RIGX.canvas.length, B.RIGX.rows.length], [6, 8]);
  assert.ok(B.RIGX.rows.every(([w]) => B.RIGX.canvas.some(([k]) => k === w)), 'every row from a canvas modulator the scene makes');
  assert.ok(B.RIGX.own.every(([src]) => /^(lfo[12]|env[234]|macro[1-8])$/.test(src)), 'its own rows from its own modules');
  assert.ok(B.RIGX.own.length >= 30 && new Set(B.RIGX.own.map(r => r.join('>'))).size === B.RIGX.own.length, '(fixer B2, review 2 P3-9) ≥ 30 distinct own rows: with the rig\'s ≈ 10 edges ≥ ' + B.CORD_BAR.awake + ' cords, all awake in the sway');
});

test('the page: ?wc=1 in tests/ui-bench.html loads it (not with ?m3 / ?m9, not the 1h run=1); main() is its only DOM work', () => {
  const html = readFileSync(new URL('./ui-bench.html', import.meta.url), 'utf8');
  assert.match(html, /const WC = !M3 && !M9 && \/\[\?&\]wc=1\/\.test\(location\.search\)/);
  assert.match(html, /import\('\.\/ui-bench-wc\.mjs\?t=' \+ Date\.now\(\)\)\.then\(m => m\.main\(\)/);
  assert.match(html, /!M3 && !M9 && !WC\) \$\('#run'\)\.click\(\)/);
  assert.equal(typeof B.main, 'function');
  const src = readFileSync(new URL('./ui-bench-wc.mjs', import.meta.url), 'utf8');
  assert.equal(/cv\.parts\.show|parts\.show\(/.test(src), false, 'never the removed Show parts hook');
});

test('(DM G9) kitS / kitX: the scene data — the Starter\'s 8 voices on the fixture groove, 16 voices with every lane painted; the bars (§7.3)', () => {
  assert.deepEqual([B.SCENES.slice(), B.KIT.bpm, B.KIT.voices.kitS, B.KIT.voices.kitX, B.KIT.bar.kitS, B.KIT.bar.kitX], [['juno', 'rig1', 'rigX', 'kitS', 'kitX'], 128, 8, 16, 1500, 2048]);
  assert.equal(B.KIT.types.length, 8, 'eight voices added to the Starter\'s eight');
  assert.ok(B.KIT.types.every(t => Number.isInteger(t) && t >= 1 && t <= 6), 'KIT.TYPES values 1–6');
  const s = B.kitCells(8), x = B.kitCells(16), lanes = L => new Set(L.map(c => c.l));
  assert.deepEqual([lanes(s).size, Math.max(...s.map(c => c.l)), lanes(x).size, Math.max(...x.map(c => c.l))], [8, 7, 16, 15], 'every lane of the kit painted');
  assert.ok(x.length > s.length && s.length > 20, s.length + ' / ' + x.length + ' cells');
  for (const L of [s, x]) {
    assert.equal(new Set(L.map(c => c.l + '/' + c.s)).size, L.length, 'a cell once');
    assert.ok(L.every(c => c.l >= 0 && c.l < 16 && c.s >= 0 && c.s < 16 && c.v > 0 && c.v <= 127), 'lane, step and velocity in range');
  }
  // the groove itself is kept (kick 1 · 5 · 9 · 13 at 100): the lanes it paints are not repainted
  assert.deepEqual(s.filter(c => c.l === 0).map(c => c.s), [0, 4, 8, 12]);
  assert.ok(s.filter(c => c.l === 1).length === 4 && s.filter(c => c.l === 5).length === 4, 'the Starter\'s snare and toms (empty in the groove) get hits of their own');
});

test('(DM G9) kitGate: P+ at 1 × and 4 × (median ≤ 17, p95 ≤ 20, no frame > 33), P at 6 ×; the drag\'s frames inside the same bar; painted within the bar; the scene as asked; the heavy notice quiet', () => {
  const ph = (med, p95, max, over) => ({ n: 120, med, p95, max, over33: over, burstMed: med, burstP95: p95, burstMax: max, firstMove: 16.7, settle: 16.7, bursts: 1 });
  const res = (o = {}) => Object.assign({ id: 'kitS', notes: [], painted: { n: 873, bar: 1500, ok: true, heavy: false }, kit: { voices: 8, lanes: 8, playing: true, heavy: { kind: 'kit', line: 2048, done: false } },
    m0: { total: { burst: { n: 300, med: 16.7, p95: 16.7, max: 16.7, over33: 0 }, verdict: 'P+' }, pan: ph(16.7, 16.7, 16.7, 0), pinch: ph(16.7, 16.7, 16.7, 0), drag: { n: 90, med: 16.7, p95: 16.7, max: 16.7, over33: 0 } } }, o);
  const bad = (r, th) => B.kitGate(r, th).filter(g => !g.pass).map(g => g.id);
  assert.deepEqual([bad(res(), 1), bad(res(), 4), bad(res(), 6)], [[], [], []]);
  const slow = res({ m0: { total: { burst: { n: 300, med: 18, p95: 30, max: 40, over33: 2 }, verdict: 'P' }, pan: ph(18, 30, 40, 2), pinch: ph(16.7, 16.7, 16.7, 0), drag: { n: 90, med: 18, p95: 25, max: 40, over33: 2 } } });
  assert.deepEqual(bad(slow, 4), ['camera P+', 'pan P+', 'module drag P+'], 'P is not P+ at 4 ×');
  assert.deepEqual(bad(slow, 6), ['pan P', 'module drag P'], 'at 6 × the camera verdict P passes; the pan\'s median 18 (> 17.5) and its two frames over 33, the drag\'s median 18, are over P\'s bar');
  assert.deepEqual(bad(res({ painted: { n: 1600, bar: 1500, ok: false, heavy: false } }), 1), ['painted']);
  assert.deepEqual(bad(res({ notes: ['lane 3 (Closed hat) is empty'] }), 1), ['scene']);
  assert.deepEqual(bad(res({ kit: { voices: 8, lanes: 8, playing: false, heavy: { done: false } } }), 1), ['scene']);
  assert.deepEqual(bad(res({ kit: { voices: 8, lanes: 8, playing: true, heavy: { kind: 'kit', done: true } } }), 1), ['heavy notice not fired']);
  assert.deepEqual(bad(res({ error: 'boom' }), 1).includes('scene'), true);
  const nodrag = res(); nodrag.m0.dragNote = 'no module to drag (i1/ka)'; assert.deepEqual(bad(nodrag, 1), ['module drag P+']);
  assert.equal(B.kitGate(res({ id: 'kitX', kit: { voices: 16, lanes: 16, playing: true, heavy: { done: false } } }), 1).every(g => g.pass), true, 'kitX wants 16 voices and 16 painted lanes');
  assert.equal(B.kitGate(res({ id: 'kitX' }), 1)[0].pass, false, 'kitX with 8 voices is not the scene');
});

test('(DM G9) the page: kitScene makes the kit through cv.kit (add, voice, cell), Tidies, powers the engine, plays at KIT.bpm; the drag phase moves a voice module; the node driver (CLI) uses Chrome for Testing with its own profile and denies downloads', () => {
  const src = readFileSync(new URL('./ui-bench-wc.mjs', import.meta.url), 'utf8'), at = src.indexOf('async function kitScene'), body = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(at > 0, 'kitScene');
  assert.ok(/K\.add\(null\)/.test(body) && /K\.voice\(id, 'add', ty\)/.test(body) && /K\.cell\(id, c\.l, c\.s, c\.v\)/.test(body) && /kitCells\(n\)/.test(body), 'a new kit track, voices and cells through the app\'s own hook');
  assert.ok(/A\.cv\.tidy\(\)/.test(body) && /setProjectBpm\(KIT\.bpm\)/.test(body) && /powerOn\(\)/.test(body) && /#tPlay/.test(body), 'Tidied, 128 BPM, the engine on, ▶');
  assert.ok(/if \(S\.kit\) await phase\('drag'/.test(src) && /S\.rig && !S\.kit/.test(src), 'the drag phase for a kit; the rig\'s Amplifier drag and sway only for rigs');
  assert.ok(/'kitS', 'kitX'/.test(src) && /SCENES\.includes\(x\)/.test(src), 'the scene whitelist');
  assert.ok(/Browser\.setDownloadBehavior/.test(src) && /behavior: 'deny'/.test(src) && /--user-data-dir=/.test(src) && /Google Chrome for Testing/.test(src) && !/\/Applications\/Google Chrome\.app/.test(src.replace(/never the user's[^\n]*/g, '')), 'Chrome for Testing, its own profile, downloads denied');
  assert.deepEqual(B.parseArgs(['--scenes', 'kitS,kitX', '--throttle', '1,4', '--out', 'r.json', '--sweep']), { scenes: ['kitS', 'kitX'], throttles: [1, 4], out: 'r.json', profile: null, sweep: true, errors: [] });
  assert.equal(B.parseArgs(['--scenes', 'nope']).errors.length, 1);
  assert.equal(B.parseArgs(['--throttle', '99']).errors.length, 1);
});
