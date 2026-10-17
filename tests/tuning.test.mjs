// tuning.js unit tests (SPEC-serum2 §11.4, §6.18, §15.2; owner C1): .scl / .kbm / .tun parsing, tuning tables, Step mode
// data, descriptions. Run: node --test tests/tuning.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../tuning.js?v=8';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const cents = r => 1200 * Math.log2(r);

// original test files (written for this project)
const TET12 = ['! tet12.scl', '!', '12 equal steps per octave', ' 12', '!', ...Array.from({ length: 11 }, (_, k) => ` ${(k + 1) * 100}.0`), ' 2/1', ''].join('\n');
const JUST7 = ['! just7.scl — a 7-limit just scale for the tests', 'Seven-limit just chromatic', '12',
  '15/14', '8/7   seventh-harmonic whole tone', '6/5', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8', '2'].join('\r\n');
const JUST7_R = [15 / 14, 8 / 7, 6 / 5, 5 / 4, 4 / 3, 7 / 5, 3 / 2, 8 / 5, 5 / 3, 7 / 4, 15 / 8, 2];
const EDO19 = ['19-EDO', '19', ...Array.from({ length: 19 }, (_, k) => (1200 * (k + 1) / 19).toFixed(6))].join('\n');

test('leaf module: no imports, no environment access; the §11.4 exports', () => {
  const src = readFileSync(new URL('../tuning.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'tuning.js imports nothing');
  assert.doesNotMatch(src, /\b(window|document|navigator|localStorage|globalThis|process)\b/, 'no environment access');
  assert.deepEqual(Object.keys(T).sort(), ['TET12_SCL', 'describe', 'parseKbm', 'parseScl', 'parseTun', 'stepTable', 'tabJson', 'tableFrom', 'tuningState']);
});

test('.scl: 12-TET (cents and ratio forms) → identity table within 1e-12', () => {
  const p = T.parseScl(TET12);
  assert.equal(p.n, 12);
  assert.equal(p.name, '12 equal steps per octave');
  assert.deepEqual(p.cents, [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]);
  for (const src of [{ scl: p }, { scl: TET12 }, { scl: TET12, kbm: '' }, { scl: TET12, kbm: null }]) {
    const tab = T.tableFrom(src);
    assert.ok(tab instanceof Float64Array && tab.length === 128);
    for (let k = 0; k < 128; k++) close(tab[k], k, 1e-12, 'key ' + k);
  }
  // integer ratios and cents with a sign; trailing text after the first token is ignored
  const q = T.parseScl('x\n3\n+100.  a\n3/2 fifth\n2');
  assert.deepEqual(q.cents.map(c => Math.round(c * 1e9) / 1e9), [100, 701.955000865, 1200]);
  assert.equal(T.parseScl('!c\n\n2\n100.0\n2/1').name, '', 'an empty description line is the description');
});

test('.scl: a 7-limit just scale — degrees within 1e-9 cents; the table follows the linear mapping (60 = degree 0, 69 → 440 Hz)', () => {
  const p = T.parseScl(JUST7);
  assert.equal(p.n, 12);
  assert.equal(p.name, 'Seven-limit just chromatic');
  p.cents.forEach((c, k) => close(c, cents(JUST7_R[k]), 1e-9, 'degree ' + (k + 1)));
  const tab = T.tableFrom({ scl: p });
  const c9 = cents(5 / 3);
  close(tab[69], 69, 1e-12, 'reference key');
  close(tab[60], 69 - c9 / 100, 1e-12, 'middle key = degree 0');
  close(tab[64], 69 + (cents(5 / 4) - c9) / 100, 1e-12, 'major third above the middle note');
  close(tab[72], 69 + (1200 - c9) / 100, 1e-12, 'one period above the middle note');
  close(tab[59], 69 + (cents(15 / 8) - 1200 - c9) / 100, 1e-12, 'below the middle note wraps one period down');
  assert.deepEqual(Array.from(T.tableFrom({ scl: JUST7 })), Array.from(tab), 'text and parsed input agree');
});

test('.kbm: unmapped keys (x, entries left out) → NaN; first/last; reference frequency; size 0; octave degree', () => {
  const kbm = ['! white keys only, A = 432 Hz', '12', '0', '127', '60', '69', '432.0', '7',
    '0', 'x', '1', 'x', '2', '3', 'x', '4', 'x', '5', 'x', '6'].join('\n');
  const k = T.parseKbm(kbm);
  assert.deepEqual(k, { size: 12, first: 0, last: 127, middle: 60, refNote: 69, refFreq: 432, octDegree: 7, map: [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6] });
  const diat = T.parseScl('C major, just\n7\n9/8\n5/4\n4/3\n3/2\n5/3\n15/8\n2/1');
  const tab = T.tableFrom({ scl: diat, kbm: k });
  const r = 69 + 12 * Math.log2(432 / 440), cA = cents(5 / 3);
  close(tab[69], r, 1e-12, 'reference key at 432 Hz');
  close(tab[60], r - cA / 100, 1e-12, 'C');
  close(tab[64], r + (cents(5 / 4) - cA) / 100, 1e-12, 'E');
  close(tab[72], r + (1200 - cA) / 100, 1e-12, 'C one formal octave up (degree 7)');
  close(tab[48], r + (-1200 - cA) / 100, 1e-12, 'C one formal octave down');
  for (const black of [61, 63, 66, 68, 70, 1, 126]) assert.ok(Number.isNaN(tab[black]), 'unmapped key ' + black);
  // entries left out at the end are unmapped; keys outside [first, last] keep 12-TET
  const k2 = T.parseKbm('4\n50\n80\n60\n60\n261.6255653006\n0\n0\n1\n');
  assert.deepEqual(k2.map, [0, 1, null, null]);
  const t2 = T.tableFrom({ scl: TET12, kbm: k2 });
  assert.equal(t2[49], 49);
  assert.equal(t2[81], 81);
  close(t2[60], 60, 1e-9, 'C4 at 261.63 Hz');
  close(t2[61], 61, 1e-9);
  assert.ok(Number.isNaN(t2[62]) && Number.isNaN(t2[63]));
  close(t2[64], 72, 1e-9, 'pattern repeats every 4 keys, one octave (octave degree 0 = the scale size) up');
  // size 0: linear mapping from the middle note (here key 62 = degree 0, key 69 = 440 Hz)
  const t3 = T.tableFrom({ scl: TET12, kbm: '0\n0\n127\n62\n69\n440\n12\n' });
  for (let n = 0; n < 128; n++) close(t3[n], n, 1e-12, 'linear 12-TET mapping ' + n);
  // a 19-EDO scale on a full keyboard: one key per step
  const t19 = T.tableFrom({ scl: EDO19 });
  close(t19[60 + 19] - t19[60], 12, 1e-9, '19 keys span one octave');
  close(t19[61] - t19[60], 12 / 19, 1e-7, 'one step (cents written with 6 decimals)');
});

test('.tun: [Tuning] cents re 8.1757989156 Hz, [Exact Tuning] with BaseFreq overriding it, periodic continuation, name', () => {
  const lines = ['; test tuning', '[Scale Begin]', 'Format= "AnaMark-TUN"', 'FormatVersion= 200', '', '[Info]', 'Name= "Quarter; test"', '',
    '[Tuning]'];
  for (let k = 0; k < 128; k++) lines.push(`note ${k}=${50 * k}`);
  lines.push('[Exact Tuning]', 'BaseFreq= 8.1757989156');
  for (let k = 0; k < 128; k++) lines.push(`note ${k}= ${(100 * k + (k % 12 === 4 ? -13.686 : 0)).toFixed(6)}`);
  lines.push('[Scale End]');
  const t = T.parseTun(lines.join('\n'));
  assert.equal(t.name, 'Quarter; test');
  assert.ok(t.hz instanceof Float64Array && t.hz.length === 128);
  for (let k = 0; k < 128; k++) close(t.hz[k], 8.1757989156 * Math.pow(2, (100 * k + (k % 12 === 4 ? -13.686 : 0)) / 1200), 1e-9, 'note ' + k);
  const tab = T.tableFrom({ tun: t });
  close(tab[69], 69, 1e-8, 'A4 ≈ 440 Hz');
  close(tab[64], 64 - 0.13686, 1e-8, 'just-ish major third');
  assert.deepEqual(Array.from(T.tableFrom({ tun: lines.join('\n') })), Array.from(tab), 'text input');
  // v0/v1: [Tuning] only (integer cents re MIDI note 0); missing notes are 12-TET
  const v0 = T.parseTun('[Tuning]\nnote 0=0\nnote 1=150\nNOTE 2 = 210\n');
  close(v0.hz[1], 8.175798915643707 * Math.pow(2, 1.5 / 12), 1e-12);
  close(v0.hz[60], 261.6255653005986, 1e-9, 'unspecified notes keep 100·k cents');
  assert.equal(v0.name, '');
  // [Exact Tuning] for notes 0…k only: repeated with the period cents[k] − cents[0]
  const part = T.parseTun('[Exact Tuning]\nbasefreq = 10\nnote 0 = 0\nnote 1 = 300\nnote 2 = 700\nnote 3 = 1200\n');
  const want = [0, 300, 700, 1200, 1500, 1900, 2400];
  want.forEach((c, k) => close(part.hz[k], 10 * Math.pow(2, c / 1200), 1e-9, 'note ' + k));
  close(part.hz[127], 10 * Math.pow(2, (42 * 1200 + 300) / 1200), 1e-6, 'note 127 = 42 periods + degree 1');
});

test('malformed files → {error}; invalid parsed input → identity table / no Step data', () => {
  const bad = [
    T.parseScl(null), T.parseScl(42), T.parseScl(''), T.parseScl('! only a comment\n'), T.parseScl('desc\n'), T.parseScl('desc\ntwelve\n'),
    T.parseScl('desc\n0\n'), T.parseScl('desc\n3\n100.0\n200.0\n'), T.parseScl('desc\n2\n100.0\nabc\n'), T.parseScl('desc\n2\n-3/2\n2/1'),
    T.parseScl('desc\n2\n3/0\n2/1'), T.parseScl('desc\n2\n100.0\n-1200.0'), T.parseScl('desc\n1\n0/1'), T.parseScl('desc\n1\n1.2.3'),
    T.parseScl('d\n1025\n' + '1.0\n'.repeat(1025)), T.parseScl('d\n1\n2/1\n' + '!'.repeat(16400)),
    T.parseKbm(null), T.parseKbm('12\n0\n127\n60\n'), T.parseKbm('12\n0\n128\n60\n69\n440\n12\n'), T.parseKbm('0\n90\n10\n60\n69\n440\n12\n'),
    T.parseKbm('0\n0\n127\n60\n69\n-440\n12\n'), T.parseKbm('0\n0\n127\n60\n69\nabc\n12\n'), T.parseKbm('2\n0\n127\n60\n69\n440\n12\n0\ny\n'),
    T.parseKbm('2\n0\n127\n60\n61\n440\n12\n0\nx\n'), T.parseKbm('-1\n0\n127\n60\n69\n440\n12\n'),
    T.parseTun(null), T.parseTun('no sections here\nnote 0=0'), T.parseTun('[Tuning]\nnote 3 = abc\n'), T.parseTun('[Exact Tuning]\nBaseFreq = -2\n'),
    T.parseTun('[Functional Tuning]\nnote 1="#>-1 % 100.0 ~999"\n'), T.parseTun('[Tuning]\n' + ';'.repeat(16400)),
  ];
  bad.forEach((r, i) => assert.ok(r && typeof r.error === 'string' && r.error.length > 0, 'case ' + i + ': ' + JSON.stringify(r)));
  assert.match(T.parseKbm('2\n0\n127\n60\n61\n440\n12\n0\nx\n').error, /reference note is unmapped/);
  const ident = Array.from({ length: 128 }, (_, k) => k);
  for (const src of [null, {}, { scl: 'garbage' }, { scl: { n: 2, cents: [100] } }, { scl: TET12, kbm: 'garbage' }, { tun: 'garbage' },
    { tun: { hz: new Float64Array(5) } }, { tun: { hz: new Float64Array(128) } }]) {
    assert.deepEqual(Array.from(T.tableFrom(src)), ident, JSON.stringify(src));
  }
  for (const x of [null, 'garbage', { n: 0, cents: [] }]) {
    const st = T.stepTable(x);
    assert.equal(st.sclN, 0);
    assert.equal(st.sclPer, 0);
    assert.ok(st.sclSteps instanceof Float64Array && st.sclSteps.length === 128 && st.sclSteps.every(v => v === 0));
  }
});

test('stepTable: degrees per period, period and degree offsets in semitones (§6.3.3); > 128 degrees → none', () => {
  const s19 = T.stepTable(EDO19);
  assert.equal(s19.sclN, 19);
  close(s19.sclPer, 12, 1e-9);
  assert.equal(s19.sclSteps[0], 0);
  for (let k = 1; k < 19; k++) close(s19.sclSteps[k], 12 * k / 19, 1e-8, 'degree ' + k);
  for (let k = 19; k < 128; k++) assert.equal(s19.sclSteps[k], 0);
  const sj = T.stepTable(T.parseScl(JUST7));
  assert.equal(sj.sclN, 12);
  close(sj.sclSteps[7], cents(3 / 2) / 100, 1e-12);
  // sclSemis(d) = floor(d / sclN)·sclPer + sclSteps[mod(d, sclN)]
  const semis = (st, d) => Math.floor(d / st.sclN) * st.sclPer + st.sclSteps[((d % st.sclN) + st.sclN) % st.sclN];
  close(semis(sj, -5), -12 + cents(3 / 2) / 100, 1e-12);
  close(semis(sj, 17), 12 + cents(4 / 3) / 100, 1e-12);
  const big = 'big\n129\n' + Array.from({ length: 129 }, (_, k) => (1200 * (k + 1) / 129).toFixed(4)).join('\n');
  assert.equal(T.parseScl(big).n, 129);
  assert.equal(T.stepTable(big).sclN, 0, 'CP.sclSteps holds 128 degrees');
});

test('describe: 12-TET for none / identity tables; mapped keys and reference pitches otherwise', () => {
  assert.equal(T.describe(null), '12-TET (A4 = 440 Hz)');
  assert.equal(T.describe(Array.from({ length: 128 }, (_, k) => k)), '12-TET (A4 = 440 Hz)');
  assert.equal(T.describe(T.tableFrom({ scl: TET12 })), '12-TET (A4 = 440 Hz)');
  const d = T.describe(T.tableFrom({ scl: JUST7 }));
  assert.match(d, /^Microtuning: 128 keys · C4 = 2\d\d\.\d\d Hz · A4 = 440\.00 Hz · range /);
  const tab = Array.from(T.tableFrom({ scl: TET12, kbm: '4\n50\n80\n59\n60\n261.6255653006\n0\n0\n1\n' }), v => (Number.isNaN(v) ? null : v));
  const nMapped = tab.filter(v => v !== null).length;
  assert.equal(nMapped, 128 - 15);
  assert.equal(T.describe(tab), `Microtuning: ${nMapped} of 128 keys mapped · C4 = 261.63 Hz · A4 unmapped · range 8.18 Hz – 12543.9 Hz`);
  assert.equal(T.describe(new Array(128).fill(null)), 'Microtuning: no key mapped');
});

test('tuningState: the global.tun record of loaded files (.tun, .scl ± .kbm, .kbm alone), names, errors', () => {
  const TUN = '[Info]\nName = "Quarter shift"\n[Tuning]\n' + Array.from({ length: 128 }, (_, k) => `note ${k} = ${100 * k + 50}`).join('\n') + '\n';
  const KBM = ['! white keys', '12', '0', '127', '60', '69', '432.0', '7', '0', 'x', '1', 'x', '2', '3', 'x', '4', 'x', '5', 'x', '6'].join('\n');
  // .tun: replaces everything; tab in JSON form; name from files.name, else [Info]
  const t = T.tuningState({ tun: TUN });
  assert.deepEqual([t.name, t.kind, t.scl, t.kbm, t.tab.length], ['Quarter shift', 'tun', '', '', 128]);
  t.tab.forEach((v, k) => close(v, k + 0.5, 1e-9, 'key ' + k));
  assert.equal(T.tuningState({ tun: TUN, name: 'my file' }).name, 'my file');
  // .scl alone: linear mapping; the texts are kept (Step mode, re-normalisation)
  const j = T.tuningState({ scl: JUST7 });
  assert.deepEqual([j.name, j.kind, j.scl, j.kbm], ['Seven-limit just chromatic', 'scl', JUST7, '']);
  assert.deepEqual(j.tab, Array.from(T.tableFrom({ scl: JUST7 })));
  // .scl + .kbm: unmapped keys → null; a .kbm alone maps the current .scl (keeps its name) …
  const jk = T.tuningState({ scl: JUST7, kbm: KBM });
  assert.deepEqual(jk.tab, T.tabJson(T.tableFrom({ scl: JUST7, kbm: KBM })));
  assert.equal(jk.tab[61], null);
  const k2 = T.tuningState({ kbm: KBM }, j);
  assert.deepEqual([k2.name, k2.kind, k2.scl, k2.kbm, k2.tab], [j.name, 'scl', JUST7, KBM, jk.tab]);
  // … or 12-TET when no scale is loaded (or the current tuning is a .tun)
  for (const cur of [undefined, null, t, { kind: 'none' }]) {
    const k3 = T.tuningState({ kbm: KBM }, cur);
    assert.deepEqual([k3.kind, k3.scl, k3.tab], ['scl', T.TET12_SCL, T.tabJson(T.tableFrom({ scl: TET12, kbm: KBM }))]);
  }
  assert.equal(T.parseScl(T.TET12_SCL).n, 12);
  // a new .scl alone keeps the loaded .kbm (scale and mapping are two files): the reference key stays at the .kbm's
  // frequency; {kbm: null} drops the mapping (Clear Mapping), also without a new .scl
  const A432 = ['! A = 432', '0', '0', '127', '60', '69', '432.0', '0'].join('\n');
  const a = T.tuningState({ kbm: A432 }, T.tuningState({ scl: TET12 }));
  close(440 * Math.pow(2, (a.tab[69] - 69) / 12), 432, 1e-9, 'kbm alone: A4 = 432 Hz');
  const e = T.tuningState({ scl: EDO19 }, a);
  assert.deepEqual([e.kind, e.scl, e.kbm, e.tab], ['scl', EDO19, A432, T.tabJson(T.tableFrom({ scl: EDO19, kbm: A432 }))]);
  close(440 * Math.pow(2, (e.tab[69] - 69) / 12), 432, 1e-9, 'the mapping survives the scale change');
  assert.equal(T.tuningState({ scl: EDO19 }, jk).kbm, KBM);
  assert.equal(T.tuningState({ scl: EDO19, kbm: null }, jk).kbm, '', 'explicit drop');
  const cm = T.tuningState({ kbm: null }, jk);
  assert.deepEqual([cm.kind, cm.scl, cm.kbm, cm.name, cm.tab], ['scl', JUST7, '', jk.name, j.tab], 'Clear Mapping keeps the scale');
  assert.ok(T.tuningState({ kbm: null }, t).error, 'nothing to re-map (.tun)');
  assert.equal(T.tuningState({ scl: EDO19 }, t).kbm, '', 'a .tun has no mapping to keep');
  // errors leave nothing to apply
  assert.ok(T.tuningState({}).error && T.tuningState(null).error && T.tuningState({ scl: '' }).error);
  assert.match(T.tuningState({ scl: 'x\n3\n100.0' }).error, /expected 3 pitches/);
  assert.match(T.tuningState({ scl: JUST7, kbm: '1\n0\n127\n60\n69\n440\n0\nx\n' }).error, /reference note is unmapped/);
  assert.ok(T.tuningState({ tun: '[Nothing]\n' }).error);
  assert.equal(T.tuningState({ scl: JUST7, name: 'n'.repeat(80) }).name.length, 64);
  // tabJson: NaN → null
  assert.deepEqual(T.tabJson(Float64Array.from([1, NaN, 2.5])), [1, null, 2.5]);
});
