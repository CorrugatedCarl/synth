// The TR-909's source material (stage 7c lane R9; IMPL-7c §2.4, §12.2): tools/rom909.mjs's three ROM images — our own
// struck-plate sounds (hats open / closed, crash, ride), never any machine's recording (D4) — in the chip's format (32 768
// six-bit words each, the hats' open region 0–24 575 and closed 24 576–32 767, 30 kHz nominal), the generated block between
// dr-808.js's ROM909 markers (--check), the decoder's view of it, determinism (two builds, a fresh process, and the static
// proof that the tool's maths is exactly specified), the D4 guard (static) and the sound's sanity and character gates.
// Known window (IMPL-7c §11): the --check and decoder tests fail on every branch until lane V9's frame is merged and the
// lead has run `node tools/rom909.mjs --write`. The spectral measures here use the engine's Math (they gate, they do not
// make bytes) and are independent of the tool's own statistics.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dspScope, source } from './dsp-scope.mjs';
import * as T from '../tools/rom909.mjs';

const TOOL = new URL('../tools/rom909.mjs', import.meta.url);
const W = T.WORD_HZ;
let BUILT = null;
const built = () => BUILT || (BUILT = T.build());
const REG = B => ({ oh: [B.hh, 0, T.OPEN_N], ch: [B.hh, T.OPEN_N, T.CLOSED_N], cr: [B.cr, 0, T.N_IMG], rd: [B.rd, 0, T.N_IMG] });
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const lib = () => { const sc = dspScope({ files: ['dr-808.js'] }); return sc.global('Dr808'); };

// ---- measures (Math.*: gates only)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let j = 0; j < len / 2; j++) {
      const wr = Math.cos(a * j), wi = Math.sin(a * j), u = i + j, v = u + len / 2;
      const tr = re[v] * wr - im[v] * wi, ti = re[v] * wi + im[v] * wr;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
}
function pspec(y, a, N) {   // power spectrum of y[a … a + N) (Hann), bins of W / N Hz
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (y[a + i] || 0) * 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
function centroidOf(p, N) { let s = 0, w = 0; for (let k = 1; k < N / 2; k++) { s += p[k]; w += p[k] * k * W / N; } return w / s; }
const rms = (y, a, b) => { let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i]; return Math.sqrt(s / (b - a)); };
const dB = x => 20 * Math.log10(x);
// a region as signed codes, and as played: the cymbals' codes × their staircase (step = word >> 9), the hats' as stored
const signed = (c, a, n) => Float64Array.from(c.subarray(a, a + n), v => v - 32);
function played(B, k) { const [c, a, n] = REG(B)[k], y = signed(c, a, n), st = B.stairs[k]; return st ? y.map((v, i) => v * st[i >> 9]) : y; }
// the last time (s) a 5 ms window's RMS is within `db` of the loudest window
function lastAbove(y, db) {
  const e = [];
  for (let i = 0; i + 150 <= y.length; i += 30) e.push(rms(y, i, i + 150));
  const m = Math.max(...e), k = m * 10 ** (-db / 20);
  let t = 0;
  e.forEach((v, i) => { if (v > k) t = i * 30 / W; });
  return t;
}
// the centroid of a whole region: its 1024-word blocks' power spectra summed
function centroidAll(y) {
  const P = new Float64Array(512);
  for (let s = 0; s + 1024 <= y.length; s += 512) { const p = pspec(y, s, 1024); for (let q = 0; q < 512; q++) P[q] += p[q]; }
  return centroidOf(P, 1024);
}

test('the format (§2.4): three images of 32 768 six-bit words; a 64-symbol alphabet that needs no escapes; each sound at its −1 dB peak', () => {
  const B = built();
  for (const k of ['hh', 'cr', 'rd']) {
    assert.equal(B[k].length, 32768, k);
    assert.ok(B[k].every(v => v >= 0 && v <= 63), k + ': codes 0–63');
    const s = T.encode(B[k]);
    assert.equal(s.length, 32768, k + ': one character a word');
    assert.ok([...s].every(ch => T.ALPHABET.includes(ch)), k + ': alphabet');
    assert.ok(sameBytes(T.decode(s), B[k]), k + ': decode(encode) = the codes');
  }
  assert.equal(T.OPEN_N + T.CLOSED_N, 32768);
  assert.equal(T.ALPHABET.length, 64);
  assert.equal(new Set(T.ALPHABET).size, 64, 'distinct symbols');
  assert.ok(![...'\\\'"`${'].some(ch => T.ALPHABET.includes(ch)), 'no backslash, quote, backquote, $ or {');
  assert.equal([...T.ALPHABET].sort().join(''), T.ALPHABET, 'ASCII order: the symbols sort as their codes');
  for (const [k, [c, a, n]] of Object.entries(REG(B))) {
    let pk = 0;
    for (let i = a; i < a + n; i++) pk = Math.max(pk, Math.abs(c[i] - 32));
    assert.equal(pk, 28, k + ': peak ±28 codes about mid-scale (−1 dB re ±31.5): the level the playback is calibrated on');
    assert.equal(c[a + n - 1], 32, k + ': the region ends at mid-scale (the latch holds a silent word)');
  }
});

test('the block: the generated lines parse to ROM909 { hh, cr, rd } and ROM909_A and decode to the tool\'s codes; the frame rules (a synthetic dr-808.js)', () => {
  const B = built(), lines = T.blockLines(B);
  const ctx = vm.createContext({});
  vm.runInContext(lines.join('\n') + '\n;globalThis.__R = { A: ROM909_A, R: ROM909 };', ctx);
  const { A, R } = ctx.__R;
  assert.equal(A, T.ALPHABET);
  assert.deepEqual(Object.keys(R), ['hh', 'cr', 'rd']);
  for (const k of ['hh', 'cr', 'rd']) {
    const o = new Uint8Array(R[k].length);
    for (let i = 0; i < o.length; i++) o[i] = A.indexOf(R[k][i]);
    assert.ok(sameBytes(o, B[k]), k + ': the block decodes to the tool\'s codes');
  }
  assert.ok(lines.every(l => !l.includes(T.MARK_A) && !l.includes(T.MARK_B)), 'the markers never appear inside the block');
  // a stand-in dr-808.js: V9's frame (indented, inside an IIFE), the tool's lines between
  const src = '(function () {\n  const x = 1;\n  ' + T.MARK_A + '\n  // stale\n  ' + T.MARK_B + '\n  const y = 2;\n})();\n';
  const r0 = T.check(src, B);
  assert.equal(r0.ok, false);
  assert.match(r0.why, /stale or hand-edited/);
  const w = T.withBlock(src, B);
  assert.deepEqual(T.check(w, B), { ok: true, why: 'current' });
  assert.ok(w.startsWith('(function () {\n  const x = 1;\n  ' + T.MARK_A + '\n  // recipes v'), 'lines written with the marker\'s indent');
  assert.ok(w.endsWith('  ' + T.MARK_B + '\n  const y = 2;\n})();\n'), 'nothing outside the frame changes');
  assert.equal(T.withBlock(w, B), w, '--write is idempotent');
  const at = w.indexOf("  hh: '") + 9, ch = w[at] === 'A' ? 'B' : 'A';
  assert.equal(T.check(w.slice(0, at) + ch + w.slice(at + 1), B).ok, false, 'one hand-edited word fails');
  const none = T.check('const x = 1;\n', B);
  assert.equal(none.ok, false);
  assert.match(none.why, /frame is missing from dr-808\.js \(lane V9 adds the two marker lines/);
  assert.match(T.check(src + T.MARK_A + '\n', B).why, /malformed ROM909 frame/);
  assert.throws(() => T.withBlock('const x = 1;\n', B), /frame is missing/);
});

test('--check (§12.2): the ROM909 block in dr-808.js equals a fresh build — known window until lane V9\'s frame and the lead\'s --write (IMPL-7c §11)', () => {
  const r = T.check(source('dr-808.js'), built());
  assert.ok(r.ok, 'rom909 --check: ' + r.why);
  const D = lib();
  assert.ok(D && D.mach && D.mach.tr909, 'dr-808.js has the 909 (lane V9)');
  assert.equal(built().env, 'model', 'the cymbals pre-compensated by the model\'s own staircase (Dr808.proto.tr909.ENV9), not the stand-in');
});

test('Dr808\'s decoder (§12.2): proto.tr909.rom9() → { hh, cr, rd } equal to the tool\'s codes — known window until lane V9 and the lead\'s --write', () => {
  const D = lib(), P = D && D.proto && D.proto.tr909;
  assert.ok(P && typeof P.rom9 === 'function', 'Dr808.proto.tr909.rom9 (lane V9\'s decoder; IMPL-7c §14 lane R9)');
  const R = P.rom9(), B = built();
  for (const k of ['hh', 'cr', 'rd']) assert.ok(R[k] && R[k].length === 32768 && sameBytes(R[k], B[k]), k + ': decoded = the tool\'s codes');
  assert.equal(P.rom9(), R, 'decoded once, shared');
});

test('determinism (§12.2, D7): two builds in one process and a fresh process byte-identical; only exactly specified maths makes a code', () => {
  const A = built(), B = T.build();
  for (const k of ['hh', 'cr', 'rd']) assert.ok(sameBytes(A[k], B[k]), k + ': two builds');
  const H = T.hashes(A);
  const out = execFileSync(process.execPath, ['--max-old-space-size=1024', fileURLToPath(TOOL), '--hash'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { env: A.env, hh: H.hh, cr: H.cr, rd: H.rd }, 'a fresh process');
  // the static proof: no engine-approximated function (sin, exp, pow, sqrt …, ECMAScript's "implementation-approximated"),
  // no ** and no Math.random in the tool — its sin / cos / exp / log are fixed series on + − × ÷ (IEEE 754, round to nearest)
  const code = readFileSync(TOOL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bad = code.match(/Math\.(sin|cos|tan|exp|expm1|log|log1p|log2|log10|pow|sqrt|cbrt|hypot|atan|atan2|asin|acos|sinh|cosh|tanh|asinh|acosh|atanh|random)\b|\*\*/g);
  assert.equal(bad, null, 'engine-dependent maths in tools/rom909.mjs: ' + (bad || []).join(', '));
  // the one input from elsewhere, the model's staircase, enters quantised to 2⁻³²: every gain far from a rounding tie (a
  // last-bit change in the model's own maths moves it by ≈ 2⁻²⁰ of a quantum at most)
  for (const k of ['cr', 'rd']) for (const g of A.stairs[k]) {
    const v = g * 4294967296;
    assert.equal(v, Math.round(v), k + ': staircase gains on the 2⁻³² grid');
  }
  // and every word's value before rounding sits ≥ 1e-9 LSB from a tie: a perturbation of the order of an ulp (≤ 1e-14 LSB)
  // cannot move a code (IMPL-7c §14 lane R9)
  const R = T.report(A);
  for (const [k, s] of Object.entries(R)) assert.ok(s.margin >= 1e-9, k + ': rounding margin ' + s.margin);
  console.log('rom909 rounding margins (LSB):', Object.entries(R).map(([k, s]) => k + ' ' + s.margin.toExponential(2)).join(', '));
});

test('D4 guard (§12.2): the tool reads no file but dr-808.js and fetches nothing (static)', () => {
  const src = readFileSync(TOOL, 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const imports = [...code.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)].map(m => [m[2], m[1]]);
  assert.deepEqual(imports.map(m => m[0]).sort(), ['../tests/dsp-scope.mjs', '../wt.js?v=9', 'node:fs', 'node:path', 'node:url']);
  assert.equal(Object.fromEntries(imports)['node:fs'], '{ writeFileSync, mkdirSync }', 'node:fs: writing only (--write, --wav)');
  assert.doesNotMatch(code, /\bimport\s*\(|\brequire\s*\(|readFile|readdir|createReadStream|openSync|\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(https?|net|tls|dgram|child_process|http2)/,
    'no other reads, no network');
  // dr-808.js reaches it through tests/dsp-scope.mjs, which reads the repo's own DSP scripts only (dsp-scope.mjs `source`,
  // review #25): every call names dr-808.js
  const calls = [...code.matchAll(/\b(source|dspScope)\(([^)]*)\)/g)].map(m => m[1] + '(' + m[2] + ')');
  assert.ok(calls.length >= 3);
  for (const c of calls) assert.match(c, /^source\('dr-808\.js'\)$|^dspScope\(\{ files: \['dr-808\.js'\](, sampleRate: SR)? \}\)$/, c);
});

test('sanity (§12.2): no clipping, the strike first, the hats decaying, the crash\'s cascade, the ride\'s bell throughout, no DC', () => {
  const B = built(), out = {};
  for (const [k, [c, a, n]] of Object.entries(REG(B))) {
    let clip = 0, sum = 0;
    for (let i = a; i < a + n; i++) { if (c[i] === 0 || c[i] === 63) clip++; sum += c[i] - 32; }
    assert.ok(clip <= 0.001 * n, k + ': clipped codes ' + clip);
    assert.ok(Math.abs(sum / n) < 1, k + ': DC ' + sum / n + ' LSB');
    for (let s = 0; s + 4096 <= n; s += 4096) { let d = 0; for (let i = a + s; i < a + s + 4096; i++) d += c[i] - 32; assert.ok(Math.abs(d / 4096) < 1, k + ': DC of block ' + s); }
    // the strike (as played: the cymbals through their staircase): ≥ 50 % of the largest |code − 32| within the first 2 ms,
    // the largest itself within the first 5 ms
    const y = played(B, k);
    let mx = 0, mi = 0, m2 = 0;
    for (let i = 0; i < n; i++) { const v = Math.abs(y[i]); if (v > mx) { mx = v; mi = i; } if (i < 60) m2 = Math.max(m2, v); }
    assert.ok(m2 >= 0.5 * mx, k + ': the first 2 ms reach ' + (m2 / mx).toFixed(2) + ' of the peak');
    assert.ok(mi < 150, k + ': the peak at ' + (mi / 30).toFixed(2) + ' ms');
    out[k] = { clip, dc: +(sum / n).toFixed(4), first2ms: +(m2 / mx).toFixed(2), peakMs: +(mi / 30).toFixed(2) };
  }
  // the open hat 300 ms in: its RMS over 250–350 ms ≥ 20 dB below its peak |code − 32| (and ≥ 6 dB below its 20–50 ms RMS:
  // the compression keeps the sizzle, not the level)
  const oh = signed(...REG(B).oh), pk = Math.max(...Array.from(oh, Math.abs)), l300 = rms(oh, 7500, 10500);
  assert.ok(dB(l300 / pk) <= -20, 'open hat 300 ms in: ' + dB(l300 / pk).toFixed(1) + ' dB re its peak');
  assert.ok(dB(l300 / rms(oh, 600, 1500)) <= -6, 'open hat 300 ms in re 20–50 ms: ' + dB(l300 / rms(oh, 600, 1500)).toFixed(1) + ' dB');
  // the crash's centroid rises over its first 100 ms (the cascade) and falls after
  const cr = signed(...REG(B).cr), cen = t => centroidOf(pspec(cr, Math.max(0, Math.round(t * W) - 512), 1024), 1024);
  const c0 = centroidOf(pspec(cr, 0, 1024), 1024), c1 = cen(0.1), c5 = cen(0.5), c8 = cen(0.8);
  assert.ok(c1 > c0 * 1.2, `crash centroid 0–34 ms ${c0.toFixed(0)} → 100 ms ${c1.toFixed(0)} Hz: rises`);
  assert.ok(c5 < c1 && c8 < c5, `crash centroid 100 / 500 / 800 ms ${c1.toFixed(0)} / ${c5.toFixed(0)} / ${c8.toFixed(0)} Hz: falls`);
  // the ride's bell: its three lowest partials ≥ 10 dB over the spectrum's median within ±400 Hz, from the ping to the fade
  const rd = signed(...REG(B).rd), Bl = T.SOUNDS.rd.bell, N = 4096, prom = [];
  for (const t of [0.05, 0.2, 0.4, 0.6, 0.8, 0.9]) {
    const p = pspec(rd, Math.round(t * W), N), row = [];
    for (const r of Bl.ratios.slice(0, 3)) {
      const k0 = Math.round(r * Bl.f * N / W), loc = [];
      let pp = 0;
      for (let q = k0 - 2; q <= k0 + 2; q++) pp = Math.max(pp, p[q]);
      for (let q = k0 - 55; q <= k0 + 55; q++) if (Math.abs(q - k0) > 4) loc.push(p[q]);
      loc.sort((u, v) => u - v);
      row.push(10 * Math.log10(pp / loc[loc.length >> 1]));
    }
    prom.push(row.map(v => Math.round(v)));
    assert.ok(row.every(v => v >= 10), `ride bell partials at ${t} s: ${row.map(v => v.toFixed(1)).join(' / ')} dB`);
  }
  console.log('rom909 sanity:', JSON.stringify(out), '· open hat 300 ms', dB(l300 / pk).toFixed(1), 'dB · crash centroid',
    [c0, c1, c5, c8].map(v => v.toFixed(0)).join(' → '), 'Hz · ride bell dB', JSON.stringify(prom));
});

test('character [C] (§14 lane R9): decay times as played at the nominal clock, centroids, the hats\' images longer than the circuit\'s defaults', () => {
  const B = built(), m = {};
  for (const k of ['oh', 'ch', 'cr', 'rd']) { const y = played(B, k); m[k] = { t14: lastAbove(y, 14), t20: lastAbove(y, 20), cen: centroidAll(y) }; }
  // R9 §9's scope readings (± 15 %): the crash −14 dB at ≈ 0.91 s, the ride at ≈ 0.30 s (the playback's staircase restores
  // our design: these are the image × the staircase)
  assert.ok(m.cr.t14 >= 0.77 && m.cr.t14 <= 1.05, 'crash −14 dB at ' + m.cr.t14);
  assert.ok(m.rd.t14 >= 0.255 && m.rd.t14 <= 0.345, 'ride −14 dB at ' + m.rd.t14);
  // the hats: the image's own −14 dB later than the circuit's at its default panel (OH ≈ 0.29 s, CH ≈ 87 ms unaccented), so
  // the RC envelope shapes the played decay and DECAY up reveals more; the open image fading by its end
  assert.ok(m.oh.t14 >= 0.25 && m.oh.t20 <= 0.75, 'open hat −14 / −20 dB at ' + m.oh.t14 + ' / ' + m.oh.t20);
  assert.ok(m.ch.t14 >= 0.087 && m.ch.t20 <= 0.25, 'closed hat −14 / −20 dB at ' + m.ch.t14 + ' / ' + m.ch.t20);
  // brightness (the whole sound, 0–15 kHz): the closed hat brightest, then the open one; the crash and the ride darker
  assert.ok(m.ch.cen >= 7500 && m.ch.cen <= 10000, 'closed hat centroid ' + m.ch.cen);
  assert.ok(m.oh.cen >= 6000 && m.oh.cen <= 9000, 'open hat centroid ' + m.oh.cen);
  assert.ok(m.cr.cen >= 3500 && m.cr.cen <= 6000, 'crash centroid ' + m.cr.cen);
  assert.ok(m.rd.cen >= 3000 && m.rd.cen <= 5500, 'ride centroid ' + m.rd.cen);
  assert.ok(m.ch.cen > m.oh.cen, 'the clamped pair brighter than the open one');
  console.log('rom909 character:', Object.entries(m).map(([k, v]) => `${k} −14 ${(v.t14 * 1000).toFixed(0)} ms, −20 ${(v.t20 * 1000).toFixed(0)} ms, centroid ${v.cen.toFixed(0)} Hz`).join(' · '));
});
