// laws.js unit tests (SPEC-serum2 §11.1b, §15.2; owner C1): the leaf knob-law, curve and format engine shared by serum-core
// and fx-core. Run: node --test tests/laws.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../laws.js?v=9';
import * as P1 from './ref-p1/serum-core.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const prng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

test('leaf module: no imports, no environment access, deep-frozen constants', () => {
  const src = readFileSync(new URL('../laws.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'laws.js imports nothing');
  assert.doesNotMatch(src, /\b(window|document|navigator|localStorage|globalThis|process)\b/, 'no environment access');
  assert.deepEqual([...L.LAWS], ['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch']);
  assert.ok(Object.isFrozen(L.LAWS) && Object.isFrozen(L.LAW));
  assert.equal(L.LAW.npitch, 11);
  assert.equal(L.CURVE_K, 10);
  for (const k of ['lawValue', 'lawNorm', 'gridOf', 'snapN', 'bend', 'evalPts', 'renderPts', 'fmtCore', 'parseCore', 'fmtHz', 'fmtTime', 'parseDb', 'toF',
    'prepText', 'eqGainDb']) assert.equal(typeof L[k], 'function', k);
});

test('laws: values, inverses, clamping, names or indices; grids', () => {
  // the 248 Phase-1 destinations evaluate exactly as the Phase-1 serum-core did
  const R = prng(5);
  for (const d of P1.DESTS) {
    for (let k = 0; k < 40; k++) {
      const n = k < 11 ? k / 10 : 1.4 * R() - 0.2;
      assert.equal(L.lawValue(d.law, d.lo, d.hi, n), P1.lawValue(d.id, n), `${d.id} n=${n}`);
      assert.equal(L.lawValue(L.LAW[d.law], d.lo, d.hi, n), P1.lawValue(d.id, n), 'by index');
      const v = P1.lawValue(d.id, R());
      assert.equal(L.lawNorm(d.law, d.lo, d.hi, v, d.def), P1.lawNorm(d.id, v), `${d.id} v=${v}`);
    }
    for (const x of [true, false, NaN, 'x', undefined]) assert.equal(L.lawNorm(d.law, d.lo, d.hi, x, d.def), P1.lawNorm(d.id, x), d.id + ' ' + x);
  }
  assert.equal(L.lawValue('nope', 0, 1, 0.3), 0.3, 'unknown law → n');
  assert.equal(L.lawValue('lin', -1, 1, 7), 1, 'n clamped');
  assert.equal(L.lawNorm('lin', 0, 1, NaN), 0, 'default def 0');
  assert.deepEqual([L.gridOf('int', -12, 12), L.gridOf('enum', 0, 81), L.gridOf('bool', 0, 1), L.gridOf('lin', 0, 1), L.gridOf('exp', 1, 2)], [24, 81, 1, 0, 0]);
  assert.deepEqual([L.snapN('int', -12, 12, 0.52), L.snapN('enum', 0, 4, 0.3), L.snapN('lin', 0, 1, 0.52)], [12 / 24, 1 / 4, 0.52]);
  close(L.lawValue('exp', 0.0625, 16, 0.5), 1, 1e-15, 'Serum 2 ratio law');
  close(L.lawValue('exp', 0.25, 4, 0.5), 1, 1e-15, 'VC scaling law');
});

test('curves: bend, evalPts, renderPts (the shared §4.4 maths)', () => {
  for (const [t, k] of [[0.3, 5], [0.7, -3], [0.5, 0]]) assert.equal(L.bend(t, k), P1.bend(t, k));
  const pts = [[0, 0.2, 0.5], [0.4, 0.9, -0.3], [0.4, 0.1, 0], [1, 0.6, 0]];
  for (let j = 0; j <= 100; j++) assert.equal(L.evalPts(pts, j / 100), P1.evalPts(pts, j / 100));
  assert.deepEqual(L.renderPts(pts, 64), P1.renderPts(pts, 64));
  assert.equal(L.evalPts(null, 0.5), 0);
  assert.equal(L.renderPts(pts, NaN).length, 2);
});

test('fmtCore: every format code with an explicit format context', () => {
  const F = L.fmtCore;
  const cases = [
    ['pct', 0, 0.75, null, '75%'], ['pct1', 0.95, 0, null, '95%'], ['pan', -0.5, 0, null, 'L25'], ['pan', 0, 0, null, 'C'], ['fpan', 0, 0.7, null, 'R40'],
    ['oct', 1, 0, null, '+1 oct'], ['st', -2, 0, null, '-2 st'], ['st2', 0.5, 0, null, '+0.50 st'], ['ct', 7.2, 0, null, '+7 ct'], ['crs', 0.001, 0, null, '--'],
    ['int', 4, 0, null, '4'], ['det', 0.25, 0, null, '0.25'], ['phase', 180, 0.5, null, '180°'], ['phase', 360, 1, null, 'Mem'], ['phase', 360, 1, { mem: false }, '360°'],
    ['deg', 90, 0.25, null, '90°'], ['frame', 0, 0.5, { F: 6, discrete: true }, '4'], ['frame', 0, 1, null, '256'], ['bip100', -0.35, 0, null, '-35%'],
    ['hz', 424.6, 0, null, '425 Hz'], ['time', 1, 0, null, '1.00 s'], ['ms', 5, 0, null, '5.00 ms'], ['msFloor', 0, 0, null, '0.10 ms'],
    ['cmpAtt', 90, 0.3, null, '90.0 ms'], ['cmpAtt', 90, 0.3, { limit: true }, '0.90 ms'], ['db', 1e-7, 0, null, '-inf dB'], ['db', 1, 0, null, '0.0 dB'],
    ['dbv', 3, 0, null, '+3.0 dB'], ['dbtrim', 0, 0.5, null, '0.0 dB'], ['dbtrim', 0, 0, null, '-inf dB'], ['bool', 1, 1, null, 'On'],
    ['ratio', 4, 0.75, null, '4:1'], ['ratio', 1e9, 1, null, 'Limit'], ['xoff', 1.5, 1, null, 'DOT'], ['q01', 2, 0, null, '2.00'], ['q2', 6.8, 0, null, '6.8'],
    ['lbh', 0, 0.5, null, 'BP 50'], ['var', 0, 0.3, null, '30%'], ['var', 0, 1, { eq: true }, '+24.0 dB'], ['npitch', -100, 0, { key: true }, '-100 st'],
    ['npitch', 24, 0, null, '+24.0 st'], ['lfoRate', 6.25, 0.5, null, '6.25 Hz'], ['lfoRate', 6.25, 0.5, { sync: true, ladder: P1.lfoLadder(0, 0) }, '1/4'],
    ['lfoRate', 6.25, 0.5, { mul: 10 }, '62.5 Hz'],
    ['lfoTime', 0.5, 0, { sync: true }, '1.00 beats'], ['lfoTime', 0.5, 0, null, '500 ms'], ['chaosRate', 2, 0, { sync: true, ladder: P1.LFO_LADDER, bpm: 120 }, '1/4'],
    ['modRate', 0.08, 21 / 30, { sync: true, ladder: P1.MODFX_LADDER }, '1/4'], ['dlyTime', 77.3, 7 / 11, { sync: true, ladder: P1.DLY_LADDER }, '1/4'],
    ['revT', 0, 0.12, null, '2.1 s'], ['revT', 0, 0.12, { plate: true }, '24 ms'], ['enum:X', 1, 0, { list: ['a', { name: 'B', nameB: 'b' }] }, 'B'],
    ['enum:X', 1, 0, { list: ['a', { name: 'B', nameB: 'b' }], nameIdx: 1 }, 'b'], ['enum:X', 0, 0, { list: [{ name: 'F', nameO: ['A', 'B', 'C'] }], nameIdx: 2 }, 'C'],
    ['enum:X', 5, 0, { list: ['a'] }, '5'], ['enum:X', 0, 0, { list: [{ label: '1 bar', beats: 4 }] }, '1 bar'],
    ['ratio2', 1, 0.5, null, '×1.000'], ['hzoff', -12.345, 0, null, '-12.35 Hz'], ['hzoff', 0, 0.5, null, '0.00 Hz'], ['st1', 32, 0, null, '+32.0 st'],
    ['xmul', 1.5, 0, null, '×1.50'], ['smpPos', 0.25, 0.25, null, '25.0%'], ['smpPos', 0.25, 0.25, { len: 2 }, '500 ms'], ['scan', 0.5, 0.75, null, '100%'],
    ['scan', 0.5, 0.75, { R: 8 }, '400%'], ['vcScale', 2, 0.75, null, '200%'], ['vcScale', 1.45, 0, { rates: [0.25, 1, 1.5, 2] }, '3/2'],
    ['semiH', 1, 0, { pmode: 'harm' }, '×2'], ['semiH', -1, 0, { pmode: 'harm' }, '÷2'], ['semiH', 3, 0, { pmode: 'step' }, '3 steps'],
    ['slice', 0, 0, null, 'Slice 1'], ['dens', 0, 0.6, null, '22.0 Hz'], ['dens', 0, 0.5, { mode: 2 }, '33 grains'],
    ['dens', 0, 0, { mode: 1, ladder: [{ label: '4 bar', beats: 16 }, { label: '1/4', beats: 1 }] }, '4 bar'], ['glen', 0, 0.5, null, '100 ms'],
    ['glen', 0, 1, { mode: 2 }, '800%'], ['fbal', 0, 0, null, 'F1'], ['fbal', 0, 1, null, 'F2'], ['fbal', 0, 0.5, null, 'F1 50 / F2 50'],
    ['fbal', 0, 0.998, null, 'F2'], ['fbal', 0, 0.002, null, 'F1'], ['fbal', 0, 0.004, null, 'F1 100 / F2 0'], ['fbal', 0, 0.996, null, 'F1 0 / F2 100'],
    ['fbal', 0, 0.3, null, 'F1 70 / F2 30'], ['arpRate', 0, 0.5, null, '5.00 Hz'],
    ['arpRate', 0, 0.5, { sync: true, ladder: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }, 'b'], ['inf0', 0, 0, null, '∞'], ['inf0', 3, 0, null, '3'],
    ['nope', 1, 0.3, null, '0.3'],
    // time in BPM units (envelopes / multisample delay, SPEC-serum2 §6.14): the ladder entry round(n·(L − 1))
    ['time', 3, 8 / 14, { sync: true, ladder: P1.LFO_LADDER }, P1.LFO_LADDER[8].label], ['time', 3, 8 / 15, { sync: true }, '3.00 s'],
  ];
  for (const [fmt, v, n, ctx, want] of cases) assert.equal(F(fmt, v, n, ctx), want, `${fmt} ${v} ${n}`);
  // never throws
  for (const fmt of ['enum:X', 'hz', 'frame', 'lfoRate', 'dens', 'vcScale', 'semiH', 'x']) {
    for (const ctx of [null, 5, 'x', { list: 7, ladder: 'q', F: NaN, rates: [], R: 'x' }]) assert.equal(typeof F(fmt, NaN, NaN, ctx), 'string');
  }
});

test('parseCore: inverse of fmtCore, clamped and grid-snapped through the law in ctx; never throws', () => {
  const P = L.parseCore;
  const lin = (lo, hi, o) => Object.assign({ law: 'lin', lo, hi }, o);
  assert.equal(P('pct', '50%', lin(0, 1)), 0.5);
  assert.equal(P('st', '+7', { law: 'int', lo: -12, hi: 12 }), 19 / 24);
  assert.equal(P('st', '+7.4', { law: 'int', lo: -12, hi: 12 }), 19 / 24, 'snapped');
  close(P('hz', '1,2 kHz', { law: 'exp', lo: P1.MIDI0, hi: 22050 }), P1.lawNorm('f.cutoff', 1200), 1e-12);
  close(P('time', '500', { law: 'pow5', lo: 0, hi: 32, base: 0.11 }), P1.lawNorm('e1.att', 0.5), 1e-12, 'bare = the unit shown at the base');
  close(P('time', '2', { law: 'pow5', lo: 0, hi: 32, base: 0.5 }), P1.lawNorm('e1.att', 2), 1e-12);
  assert.equal(P('phase', 'mem', lin(0, 360)), 1);
  assert.equal(P('phase', 'mem', lin(0, 360, { mem: false })), null);
  assert.equal(P('phase', '360', lin(0, 360)), 0.9994);
  assert.equal(P('phase', '360', lin(0, 360, { mem: false })), 1);
  assert.equal(P('enum:X', 'b', { law: 'enum', lo: 0, hi: 2, list: ['a', 'b', 'c'] }), 0.5);
  assert.equal(P('enum:X', 'f', { law: 'enum', lo: 0, hi: 1, list: [{ name: 'FM (B)', nameO: ['FM (B)', 'FM (A)', 'FM (A)'], id: 'f' }, 'x'], nameIdx: 1 }), 0);
  assert.equal(P('enum:X', 'FM (B)', { law: 'enum', lo: 0, hi: 1, list: [{ name: 'FM (B)', nameO: ['FM (B)', 'FM (A)', 'FM (A)'] }, 'x'], nameIdx: 1 }), null,
    'per-oscillator labels: only the owning oscillator\'s');
  assert.equal(P('lfoRate', '1/8T', { law: 'pow4', lo: 0, hi: 100, sync: true, ladder: P1.lfoLadder(0, 1) }), P1.lfoLadder(0, 1).findIndex(e => e.label === '1/8T') / 28);
  assert.equal(P('ratio2', '3:2', { law: 'exp', lo: 0.0625, hi: 16 }), Math.log(24) / Math.log(256));
  assert.equal(P('fbal', 'F1 30 / F2 70', lin(-1, 1)), 0.7);
  assert.deepEqual(['F1', 'F2', 'F1 100', 'F1 100 / F2 0', 'F1 0 / F2 100', 'F2 25'].map(x => P('fbal', x, lin(-1, 1))), [0, 1, 0, 0.004, 0.996, 0.25]);
  assert.equal(P('inf0', '∞', { law: 'int', lo: 0, hi: 16 }), 0);
  // time in BPM units: ladder labels and exact beat values only (§6.14)
  const lad = [{ label: '0', beats: 0 }, { label: '1/16', beats: 0.25 }, { label: '1/4', beats: 1 }, { label: '1 bar', beats: 4 }];
  const tb = { law: 'pow5', lo: 0, hi: 32, sync: true, ladder: lad };
  assert.deepEqual(['0', '1/4', '1 bar', '4 beats', '0.25 beats', '500 ms', 'x'].map(t => P('time', t, tb)), [0, 2 / 3, 1, 1, 1 / 3, null, null]);
  assert.equal(P('semiH', '÷3', { law: 'int', lo: -12, hi: 12, pmode: 'harm' }), 10 / 24);
  close(P('dens', '22 Hz', lin(0, 1)), Math.log(220) / Math.log(8000), 1e-12);
  assert.equal(P('dens', '33 grains', lin(0, 1, { mode: 2 })), 0.5079365079365079);
  close(P('glen', '100 ms', lin(0, 1)), 0.5, 1e-12);
  assert.equal(P('vcScale', '3/2', { law: 'exp', lo: 0.25, hi: 4, rates: [1, 1.5, 2] }), Math.log(6) / Math.log(16));
  // fmt ∘ parse ∘ fmt is stable over random values for the formats without state
  const R = prng(9);
  for (const [fmt, law, lo, hi] of [['ratio2', 'exp', 0.0625, 16], ['hzoff', 'lin', -50, 50], ['st1', 'lin', -64, 64], ['fbal', 'lin', -1, 1],
    ['scan', 'lin', -1, 1], ['vcScale', 'exp', 0.25, 4], ['slice', 'int', 0, 255], ['dens', 'lin', 0, 1], ['glen', 'lin', 0, 1], ['inf0', 'int', 0, 16],
    ['arpRate', 'lin', 0, 1], ['smpPos', 'lin', 0, 1], ['hz', 'exp', P1.MIDI0, 22050], ['time', 'pow5', 0, 32], ['bip100', 'lin', -1, 1]]) {
    for (let k = 0; k < 300; k++) {
      const n = k < 11 ? k / 10 : R(), c = { law, lo, hi }, t = L.fmtCore(fmt, L.lawValue(law, lo, hi, n), n, c), p = P(fmt, t, c);
      assert.notEqual(p, null, `${fmt} '${t}'`);
      assert.equal(L.fmtCore(fmt, L.lawValue(law, lo, hi, p), p, c), t, `${fmt} n=${n} '${t}' → ${p}`);
    }
  }
  // hostile input: null or n ∈ [0, 1], never −0
  const chars = 'abcdefhiklmnoprstxz0123456789 .,-+/%:°∞×÷LRCTdk−', fmts = ['pct', 'hz', 'time', 'enum:X', 'fbal', 'semiH', 'ratio2', 'dens', 'xoff', 'lbh', 'phase'];
  for (let k = 0; k < 20000; k++) {
    let t = '';
    for (let c = 1 + Math.floor(R() * 9); c > 0; c--) t += chars[Math.floor(R() * chars.length)];
    const p = P(fmts[k % fmts.length], t, k & 1 ? { law: 'lin', lo: -1, hi: 1, list: ['a'] } : null);
    if (p !== null) assert.ok(p >= 0 && p <= 1 && !Object.is(p, -0), `'${t}' → ${p}`);
  }
  for (const x of [undefined, null, {}, [], NaN, true]) assert.equal(P('pct', x, null), null);
  assert.equal(P('pct', 'x'.repeat(80), null), null);
});

test('display helpers: fmtHz / fmtTime boundaries, toF, parseDb, prepText, eqGainDb', () => {
  assert.deepEqual([L.fmtHz(9.996), L.fmtHz(99.99999999999997), L.fmtHz(999.97), L.fmtHz(22050)], ['10.0 Hz', '100 Hz', '1.00 kHz', '22.1 kHz']);
  assert.deepEqual([L.fmtTime(0.009996), L.fmtTime(0.9996), L.fmtTime(9.996)], ['10.0 ms', '1.00 s', '10.0 s']);
  assert.deepEqual([L.toF(-0.0001, 2), L.toF(1.234, 1)], ['0.00', '1.2']);
  assert.deepEqual([L.parseDb('-3 dB'), L.parseDb('+12'), L.parseDb('3 Hz'), L.parseDb('−6,5 db')], [-3, 12, null, -6.5]);
  assert.equal(L.prepText('  1,5  KHz '), '1.5 khz');
  for (const v of [0, 0.25, 0.5, 0.75, 1]) assert.equal(L.eqGainDb(v), P1.eqGainDb(v));
});
