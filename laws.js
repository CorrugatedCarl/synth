/*
 * laws.js — the knob-law, curve and display engine shared by serum-core.js and fx-core.js (SPEC-serum2 §11.1b; the
 * Phase-1 code of SPEC-serum §3.1, §3.2, §4.4 and §8.1, moved out of serum-core so that fx-core does not import
 * serum-core). Leaf module: pure, no imports, no DOM, no timers; importable from the browser, node and Workers.
 *
 * Laws (§3.1): lawValue(law, lo, hi, n) / lawNorm(law, lo, hi, v, def) with `law` a LAWS name or index; gridOf(law, lo,
 * hi) = grid steps of a stepped law (0 = continuous); snapN(law, lo, hi, n) snaps n to that grid.
 * Curves (§4.4): CURVE_K, bend, evalPts, renderPts.
 * Formats (§3.2 of both specs): fmtCore(fmt, v, n, ctx) → display text of engine value v at knob position n;
 * parseCore(fmt, text, ctx) → clamped, grid-snapped n or null (typed entry, §8.1). Neither throws. The format context
 * `ctx` carries everything a format needs that is not the value itself; the callers (serum-core fmtParam/parseParam,
 * fx-core parameter tables) resolve it from their states:
 *   law, lo, hi        the destination's law (parseCore: conversions and grid snapping)
 *   base               current base n of the control (parseCore: bare numbers on time controls are read in the unit the
 *                      control shows at that base, s or ms)
 *   bpm                tempo (default 120): beat divisions typed on time controls, chaos ladder labels
 *   list, nameIdx      enum:* entries (strings or objects with name / nameB / nameO[] / label / id) and the name variant
 *                      (0 = name, 1 = nameB, k = nameO[k]) — WARPS OSC B labels, WARPS2 o1/o2 per oscillator
 *   F, discrete        frame: frame count of the table (default 256) and discrete (non-interpolating) reading
 *   mem                phase: the knob end n ≥ 0.9995 reads 'Mem' (S1 knob-end phase memory; default true)
 *   limit              cmpAtt: the compressor ratio is at Limit (attack becomes the 0–10 ms look-ahead)
 *   eq                 var: the filter type is an EQ-family type (Var shows its gain in dB)
 *   key                npitch: noise keytracking on (whole semitones)
 *   sync, ladder       lfoRate, lfoTime, chaosRate, modRate, dlyTime, arpRate, dens, glen, time: BPM switch and
 *                      [{label, beats}] (time: envelope / multisample-delay BPM units, the ENV_LADDER entry round(n·(L−1)))
 *   mul                lfoRate in Hz: rate multiplier (the LFO's ×10 switch; default 1)
 *   plate             revT: Plate reverb (pre-delay ms) instead of Hall (decay s)
 *   len                smpPos: sample length in seconds (absent: percent display)
 *   R                  scan: SCAN range factor 2 / 4 / 8 (default 2)
 *   rates              vcScale: VC_RATES when the LFO scaling is in Rate mode (snapped ratio display)
 *   pmode              semiH: 'harm' (×h / ÷k) or 'step' (n steps)
 *   mode               dens / glen: 0 Free, 1 BPM (ladder), 2 Grains / Percent
 * Display rules (Phase-1 RULINGS (a)–(e)): precision, unit and sign come from the printed value; thresholds allow 1e-9
 * relative, so fmt ∘ parse ∘ fmt is stable.
 */

/* ================================================================ small helpers */

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fin = x => typeof x === 'number' && isFinite(x);
// clamp; NaN → lo; '+ 0' turns −0 into 0
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const sgn = v => (v > 0 ? '+' : '');

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/* ================================================================ §3.1 laws */

export const LAWS = deepFreeze(['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch']);
export const LAW = deepFreeze(LAWS.reduce((o, n, i) => { o[n] = i; return o; }, {}));
const lawIdx = law => (typeof law === 'number' ? (law >= 0 && law < LAWS.length && (law | 0) === law ? law : -1)
  : typeof law === 'string' && own(LAW, law) ? LAW[law] : -1);

function lawV(law, lo, hi, n) {
  switch (law) {
    case 0: return lo + (hi - lo) * n;
    case 1: return Math.round(lo + (hi - lo) * n);
    case 2: return Math.round(hi * n);
    case 3: return n >= 0.5 ? 1 : 0;
    case 4: return lo * Math.pow(hi / lo, n);
    case 5: return lo + (hi - lo) * n * n;
    case 6: return lo + (hi - lo) * n * n * n;
    case 7: { const n2 = n * n; return lo + (hi - lo) * n2 * n2; }
    case 8: { const n2 = n * n; return lo + (hi - lo) * n2 * n2 * n; }
    case 9: { const u = 1 - n; return Math.max(lo, hi * u * u * u); }
    case 10: return n >= 0.9825 ? 1e9 : Math.min(hi, 1 / (1 - n));
    case 11: return n >= 0.5 ? 2 * hi * (n - 0.5) : Math.max(lo, 100 * Math.log2(2 * n));
    default: return n;
  }
}

function lawN(law, lo, hi, v) {
  switch (law) {
    case 0: return (clamp(v, lo, hi) - lo) / (hi - lo);
    case 1: return (Math.round(clamp(v, lo, hi)) - lo) / (hi - lo);
    case 2: return Math.round(clamp(v, 0, hi)) / hi;
    case 3: return v ? 1 : 0;
    case 4: return Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo);
    case 5: return Math.sqrt((clamp(v, lo, hi) - lo) / (hi - lo));
    case 6: return Math.cbrt((clamp(v, lo, hi) - lo) / (hi - lo));
    case 7: return Math.pow((clamp(v, lo, hi) - lo) / (hi - lo), 1 / 4);
    case 8: return Math.pow((clamp(v, lo, hi) - lo) / (hi - lo), 1 / 5);
    case 9: return 1 - Math.cbrt(clamp(v, lo, hi) / hi);
    case 10: return v >= 1e6 ? 1 : Math.min(0.9824, 1 - 1 / clamp(v, lo, hi));
    case 11: { const x = clamp(v, lo, hi); return x >= 0 ? 0.5 + x / (2 * hi) : Math.pow(2, x / 100) / 2; }
    default: return v;
  }
}

// Engine value of law `law` (name or index) over [lo, hi] at normalised n (clamped to [0, 1]); unknown law → n
export function lawValue(law, lo, hi, n) {
  const x = clamp01(n);
  return lawV(lawIdx(law), lo, hi, x);
}

// Normalised n of engine value v (clamped to the law's value range); booleans count as 0/1; a non-number or NaN
// gives `def` (default 0)
export function lawNorm(law, lo, hi, v, def) {
  if (typeof v === 'boolean') v = v ? 1 : 0;
  if (typeof v !== 'number' || v !== v) return fin(def) ? def : 0;
  return clamp01(lawN(lawIdx(law), lo, hi, v)) + 0;
}

// Grid steps of a stepped law (int, enum, bool: hi − lo, i.e. k/(hi − lo) exactly); 0 for continuous laws
export function gridOf(law, lo, hi) {
  const l = lawIdx(law);
  return l === 1 || l === 2 || l === 3 ? hi - lo : 0;
}

// n snapped to the grid of a stepped law; continuous laws unchanged
export function snapN(law, lo, hi, n) {
  const m = gridOf(law, lo, hi);
  return m > 0 ? Math.round(n * m) / m : n;
}

/* ================================================================ §4.4 curves */

export const CURVE_K = 10;

export function bend(t, k) {
  return Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k));
}

// pts = [[x, y, c(, mx, my)], …] (§2.3); an empty or missing graph evaluates to 0
export function evalPts(pts, x) {
  if (!pts || !pts.length) return 0;
  const last = pts.length - 1;
  if (x <= 0 || x < pts[0][0]) return pts[0][1];
  if (x >= 1) return pts[last][1];
  let lo = 0, hi = last;               // largest j with pts[j].x ≤ x (equal x: the later point wins)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid - 1;
  }
  if (lo === last) return pts[last][1];
  const p = pts[lo], q = pts[lo + 1], dx = q[0] - p[0];
  if (dx <= 1e-9) return q[1];
  return p[1] + (q[1] - p[1]) * bend((x - p[0]) / dx, CURVE_K * (p[2] || 0));
}

export function renderPts(pts, n) {
  n = fin(n) && n >= 1 ? Math.floor(n) : 1;
  const out = new Float32Array(n + 1);
  for (let j = 0; j <= n; j++) out[j] = evalPts(pts, j / n);
  return out;
}

/* ================================================================ §3.2 display */

// Display precision is chosen from the value as printed, and thresholds allow 1e-9 relative, so a value typed exactly
// at a boundary (100 Hz, 1 s; stored through its law as 99.99999999999997) or rounding up to it (999.97 Hz) prints in
// the next range ('100 Hz', '1.00 kHz'); signs come from the printed value as well ('0 ct', never '+0 ct'; '0.0 dB',
// never '-0.0 dB'). This keeps fmt ∘ parse ∘ fmt stable.
const up = x => x * (1 + 1e-9);
const below = (x, dp, lim) => up(x) < lim && +x.toFixed(dp) < lim;
export const toF = (x, dp) => { const t = x.toFixed(dp); return +t === 0 ? (0).toFixed(dp) : t; };
export const sgnF = (x, dp) => (+x.toFixed(dp) > 0 ? '+' : '');
export function fmtHz(f) {
  if (below(f, 2, 10)) return f.toFixed(2) + ' Hz';
  if (below(f, 1, 100)) return f.toFixed(1) + ' Hz';
  if (below(f, 0, 1000)) return f.toFixed(0) + ' Hz';
  const k = f / 1000;
  return k.toFixed(below(k, 2, 10) ? 2 : 1) + ' kHz';
}
export function fmtTime(s) {
  const ms = 1000 * s;
  if (below(ms, 2, 10)) return toF(ms, 2) + ' ms';
  if (below(ms, 1, 100)) return ms.toFixed(1) + ' ms';
  if (below(ms, 0, 1000)) return ms.toFixed(0) + ' ms';
  return s.toFixed(below(s, 2, 10) ? 2 : 1) + ' s';
}
export const fmtDbv = v => sgnF(v, 1) + toF(v, 1) + ' dB';
// EQ-family Var gain in dB (filters whose family is 'eq'): −96 dB … 0 dB … +24 dB
export const eqGainDb = v => (v < 0.5 ? Math.max(-96, 40 * Math.log10(2 * v)) : 48 * (v - 0.5));

const ctxBpm = c => (c && fin(c.bpm) && c.bpm > 0 ? c.bpm : 120);
const ladOf = c => (c && Array.isArray(c.ladder) && c.ladder.length ? c.ladder : null);
const ladLabel = (L, n) => L[Math.round(clamp01(n) * (L.length - 1))].label;
const entryName = (e, k) => (typeof e === 'string' ? e
  : k === 1 && typeof e.nameB === 'string' ? e.nameB
    : k > 0 && Array.isArray(e.nameO) && typeof e.nameO[k] === 'string' ? e.nameO[k]
      : Array.isArray(e.nameO) && typeof e.nameO[0] === 'string' && k === 0 ? e.nameO[0]
        : typeof e.name === 'string' ? e.name : typeof e.label === 'string' ? e.label : String(e.id));
const RATE_EPS = 1e-9;
// VC_RATES entry nearest to v in log2 (ties to the smaller), §2.2.6
function snapRate(rates, v) {
  let best = rates[0], bd = Infinity;
  const lv = Math.log2(v > 0 ? v : 1e-9);
  for (const r of rates) { const d = Math.abs(Math.log2(r) - lv); if (d < bd - RATE_EPS) { bd = d; best = r; } }
  return best;
}
// '3/2', '1', '1/4' (denominators 1–12)
function ratioLabel(r) {
  for (let d = 1; d <= 12; d++) { const k = Math.round(r * d); if (Math.abs(k - r * d) < 1e-9) return d === 1 ? String(k) : k + '/' + d; }
  return r.toFixed(3);
}

// Display text of format `fmt` for engine value v at knob position n (§3.2). Never throws; unknown format → String(n).
export function fmtCore(fmt, v, n, ctx) {
  try {
    return fmtCase(String(fmt), v, n, ctx && typeof ctx === 'object' ? ctx : {});
  } catch (err) {
    return String(n);
  }
}

function fmtCase(fmt, v, n, c) {
  if (fmt.slice(0, 5) === 'enum:') {
    const list = Array.isArray(c.list) ? c.list : null, e = list ? list[v] : undefined;
    if (e === undefined || e === null) return String(v);
    return entryName(e, fin(c.nameIdx) ? c.nameIdx : 0);
  }
  switch (fmt) {
    case 'pct': return Math.round(n * 100) + '%';
    case 'pct1': return Math.round(v * 100) + '%';
    case 'pan': { const k = Math.round(Math.abs(v) * 50); return k === 0 ? 'C' : (v < 0 ? 'L' : 'R') + k; }
    case 'fpan': { const k = Math.round(Math.abs(n - 0.5) * 200); return k === 0 ? 'C' : (n < 0.5 ? 'L' : 'R') + k; }
    case 'oct': return sgn(v) + (v + 0) + ' oct';
    case 'st': return sgn(v) + (v + 0) + ' st';
    case 'st2': return sgnF(v, 2) + toF(v, 2) + ' st';
    case 'ct': { const r = Math.round(v) + 0; return sgn(r) + r + ' ct'; }
    case 'crs': return Math.abs(v) < 0.005 ? '--' : sgnF(v, 2) + toF(v, 2) + ' st';
    case 'int': return String(v + 0);
    case 'det': return toF(v, 2);
    case 'phase': return c.mem !== false && n >= 0.9995 ? 'Mem' : Math.round(v) + '°';
    case 'deg': return Math.round(v) + '°';
    case 'frame': {
      const F = fin(c.F) && c.F >= 1 ? Math.round(c.F) : 256;
      return String(c.discrete ? 1 + Math.min(F - 1, Math.floor(n * F)) : 1 + Math.round(n * (F - 1)));
    }
    case 'bip100': { const r = Math.round(v * 100) + 0; return sgn(r) + r + '%'; }
    case 'hz': return fmtHz(v);
    case 'time': { const L = ladOf(c); return c.sync && L ? ladLabel(L, n) : fmtTime(v); }
    case 'ms': return fmtTime(v / 1000);
    case 'msFloor': return fmtTime(Math.max(0.1, v) / 1000);
    case 'cmpAtt': return c.limit ? (10 * n * n).toFixed(2) + ' ms' : fmtTime(Math.max(0.1, v) / 1000);
    case 'db': return v <= 1e-6 ? '-inf dB' : toF(20 * Math.log10(v), 1) + ' dB';
    case 'dbv': return fmtDbv(v);
    case 'dbtrim': return n <= 0 ? '-inf dB' : toF(40 * Math.log10(2 * n), 1) + ' dB';
    case 'bool': return v ? 'On' : 'Off';
    case 'ratio': return v >= 1e6 ? 'Limit' : below(v, 1, 2) ? v.toFixed(1) + ':1' : Math.round(v) + ':1';
    case 'xoff': {        // §3.2 ±0.01 windows applied to the printed value, compared in exact hundredths
      const h = Math.round(+v.toFixed(2) * 100);        // printed 1.49 → 149 (no 1.5 − 1.49 > 0.01 float error)
      if (Math.abs(h - 400 / 3) <= 1) return 'TRIP';     // printed 1.33, 1.34 (1.32 is 0.0133 away)
      if (Math.abs(h - 150) <= 1) return 'DOT';          // printed 1.49 … 1.51
      if (Math.abs(h - 75) <= 1) return 'Dot 1/2';       // printed 0.74 … 0.76
      return 'x' + v.toFixed(2);
    }
    case 'q01': return v.toFixed(2);
    case 'q2': return v.toFixed(1);
    case 'lbh': return (n < 0.25 ? 'LP' : n <= 0.75 ? 'BP' : 'HP') + ' ' + Math.round(n * 100);
    case 'var': return c.eq ? fmtDbv(eqGainDb(n)) : Math.round(n * 100) + '%';
    case 'npitch': { const r = Math.round(v) + 0; return c.key ? sgn(r) + r + ' st' : sgnF(v, 1) + toF(v, 1) + ' st'; }
    case 'lfoRate': { const L = ladOf(c); return c.sync && L ? ladLabel(L, n) : fmtHz(v * mulOf(c)); }
    case 'lfoTime': return c.sync ? (v * 2).toFixed(2) + ' beats' : fmtTime(v);
    case 'chaosRate': {
      const L = ladOf(c);
      if (!c.sync || !L) return fmtHz(v);
      const beats = ctxBpm(c) / 60 / v;
      const k = Math.round(Math.log2(L[0].beats / beats));
      return L[k > 0 ? (k < L.length - 1 ? k : L.length - 1) : 0].label;
    }
    case 'modRate': case 'dlyTime': {
      const L = ladOf(c);
      if (c.sync && L) return ladLabel(L, n);
      return fmt === 'modRate' ? fmtHz(v) : fmtTime(v / 1000);
    }
    case 'revT':
      if (c.plate) return Math.round(200 * n) + ' ms';
      return n >= 0.999 ? 'inf' : (0.8 + 11.2 * n).toFixed(1) + ' s';
    /* ---- Phase 2 (SPEC-serum2 §3.2) */
    case 'ratio2': return '×' + v.toFixed(3);
    case 'hzoff': return sgnF(v, 2) + toF(v, 2) + ' Hz';
    case 'st1': return sgnF(v, 1) + toF(v, 1) + ' st';
    case 'xmul': return '×' + v.toFixed(2);
    case 'smpPos': return fin(c.len) && c.len > 0 ? fmtTime(v * c.len) : toF(100 * v, 1) + '%';
    case 'scan': return (Math.round(v * rangeOf(c) * 100) + 0) + '%';
    case 'vcScale': {
      if (Array.isArray(c.rates) && c.rates.length) return ratioLabel(snapRate(c.rates, v));
      return Math.round(100 * v) + '%';
    }
    case 'semiH': {
      const k = Math.round(v) + 0;
      if (c.pmode === 'step') return k + ' steps';
      return k >= 0 ? '×' + (k + 1) : '÷' + (1 - k);
    }
    case 'slice': return 'Slice ' + (Math.round(v) + 1);
    case 'dens': {
      const L = ladOf(c);
      if (c.mode === 1 && L) return ladLabel(L, n);
      if (c.mode === 2) return Math.round(1 + 63 * n) + ' grains';
      return fmtHz(0.1 * Math.pow(8000, n));
    }
    case 'glen': {
      const L = ladOf(c);
      if (c.mode === 1 && L) return ladLabel(L, n);
      if (c.mode === 2) return Math.round(Math.pow(800, n)) + '%';
      return fmtTime(0.001 * Math.pow(10, 4 * n));
    }
    case 'fbal': {        // §3.2 verbatim: v = 2n − 1; F1 for v ≤ −0.995, F2 for v ≥ 0.995, else both shares in percent
      const b = 2 * clamp01(n) - 1;
      if (b <= -0.995) return 'F1';
      if (b >= 0.995) return 'F2';
      return 'F1 ' + (Math.round(50 * (1 - b)) + 0) + ' / F2 ' + (Math.round(50 * (1 + b)) + 0);
    }
    case 'arpRate': { const L = ladOf(c); return c.sync && L ? ladLabel(L, n) : fmtHz(0.5 * Math.pow(100, n)); }
    case 'inf0': return v === 0 ? '∞' : String(v + 0);
    default: return String(n);
  }
}
const rangeOf = c => (c && (c.R === 4 || c.R === 8) ? c.R : 2);
const mulOf = c => (c && fin(c.mul) && c.mul > 0 ? c.mul : 1);      // LFO RATE ×10 (Hz, §6.15.2)

/* ================================================================ §8.1 typed entry */

// Canonical unit tokens accepted after a number (case-insensitive; '' = bare number)
const UNIT_ALIAS = {
  '': '', hz: 'hz', k: 'khz', khz: 'khz', ms: 'ms', msec: 'ms', s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  '%': '%', db: 'db', st: 'st', semi: 'st', semis: 'st', semitone: 'st', semitones: 'st', ct: 'ct', c: 'ct', cent: 'ct', cents: 'ct',
  oct: 'oct', octave: 'oct', octaves: 'oct', '°': 'deg', deg: 'deg', beat: 'beats', beats: 'beats', ':1': 'ratio',
};
// formats whose own display unit is '%' (elsewhere '%' means knob position, n·100)
const PCT_OWN = { pct: 1, pct1: 1, bip100: 1, var: 1, lbh: 1, smpPos: 1, scan: 1, vcScale: 1, glen: 1, fbal: 1 };
const NUM_RE = /^([+-]?)\s*(inf(?:inity)?|∞|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/;
const NUM = '(\\d+(?:\\.\\d*)?|\\.\\d+)';
const LR_PRE = new RegExp('^([lr]) ?' + NUM + '$'), LR_POST = new RegExp('^' + NUM + ' ?([lr])$');
const LBH_RE = new RegExp('^(lp|bp|hp)? ?' + NUM + '? ?%?$');

// lower case, ASCII minus, decimal comma → point, single spaces
export const prepText = text => String(text).trim().toLowerCase().replace(/[−‒–—]/g, '-')
  .replace(/,(?=\d)/g, '.').replace(/\s+/g, ' ');

// "<number> <unit>" → { x, u } (u canonical, '' = bare), else null; 'inf' parses as Infinity
function numUnit(t) {
  const m = NUM_RE.exec(t);
  if (!m || !own(UNIT_ALIAS, m[3])) return null;
  const u = UNIT_ALIAS[m[3]];
  const mag = /^[\d.]/.test(m[2]) ? parseFloat(m[2]) : Infinity;
  return { x: m[1] === '-' ? -mag : mag, u };
}

// Beat count of a division ('1/8', '1/4.', '1/8T', '1/4d', '2 bar', '4 bar T') or '<n> beats'; else null
function beatsOf(t) {
  const k = t.replace(/ /g, '');
  let m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)([.dt]?)$/.exec(k), b, suf;
  if (m) { b = 4 * m[1] / m[2]; suf = m[3]; } else if ((m = /^(\d+(?:\.\d+)?)bars?([.dt]?)$/.exec(k))) { b = 4 * m[1]; suf = m[2]; } else {
    const q = numUnit(t);
    return q && q.u === 'beats' && q.x >= 0 && isFinite(q.x) ? q.x : null;
  }
  if (suf === '.' || suf === 'd') b *= 1.5; else if (suf === 't') b *= 2 / 3;
  return isFinite(b) && b > 0 ? b : null;
}

// Index of a ladder entry by label (case and spaces ignored) or by an exactly equal beat value; −1 if none
const ladKey = s => s.toLowerCase().replace(/\s+/g, '').replace(/d$/, '.');
function ladderIdx(L, t) {
  const k = ladKey(t);
  for (let j = 0; j < L.length; j++) if (ladKey(L[j].label) === k) return j;
  const b = beatsOf(t);
  if (b !== null) for (let j = 0; j < L.length; j++) if (Math.abs(L[j].beats - b) <= 1e-9 * b) return j;
  return -1;
}

// seconds from '<n> ms|s', a beat division or '<n> beats' (at ctx.bpm, not re-synced); bare numbers in `bare`
function parseSec(t, c, bare) {
  const b = beatsOf(t);
  if (b !== null) return b * 60 / ctxBpm(c);
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || bare;
  return u === 's' ? q.x : u === 'ms' ? q.x / 1000 : null;
}
function parseHz(t) {
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || 'hz';
  return u === 'hz' ? q.x : u === 'khz' ? 1000 * q.x : null;
}
// rate in Hz, or a beat division converted at ctx.bpm (one cycle per division)
function parseRate(t, c) {
  const f = parseHz(t);
  if (f !== null) return f;
  const b = beatsOf(t);
  return b === null ? null : ctxBpm(c) / 60 / b;
}
// pitch in `unit` ('st' | 'oct' | 'ct'); other pitch units converted, bare numbers in `unit`
function parsePitch(t, unit) {
  const q = numUnit(t);
  if (!q) return null;
  const u = q.u || unit;
  const st = u === 'st' ? q.x : u === 'oct' ? 12 * q.x : u === 'ct' ? q.x / 100 : null;
  return st === null ? null : unit === 'st' ? st : unit === 'oct' ? st / 12 : 100 * st;
}
// dB from '<n> dB' or a bare number
export function parseDb(t) {
  const q = numUnit(prepText(t));
  return q && (q.u === '' || q.u === 'db') ? q.x : null;
}
// 'C' → 0; 'L12' / '12 L' → −12; 'R40' → 40; bare signed numbers as they are
function parseLR(t) {
  if (/^(c|center|centre|mid)$/.test(t)) return 0;
  let m = LR_PRE.exec(t);
  if (m) return m[1] === 'l' ? -m[2] : +m[2];
  if ((m = LR_POST.exec(t))) return m[2] === 'l' ? -m[1] : +m[1];
  const q = numUnit(t);
  return q && q.u === '' ? q.x : null;
}
function parseEnum(t, c) {
  const list = Array.isArray(c.list) ? c.list : null, hi = fin(c.hi) ? c.hi : list ? list.length - 1 : 0;
  if (!list || !(hi > 0)) return null;
  const tight = s => String(s).toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
  const k0 = fin(c.nameIdx) ? c.nameIdx : 0;
  // only the labels an entry has (FILTERS / SUB_SHAPES have no nameB: never match the text 'undefined'); entries with
  // per-oscillator labels (WARPS2 nameO) answer to the owning oscillator's label and their id only
  const names = e => (typeof e === 'string' ? [e] : !e || typeof e !== 'object' ? []
    : (Array.isArray(e.nameO) ? [e.nameO[k0], e.id] : [e.name, e.nameB, e.label, e.id]).filter(x => typeof x === 'string' && x !== ''));
  const k = tight(t), n = Math.min(list.length, hi + 1);
  for (let j = 0; j < n; j++) if (names(list[j]).some(x => tight(x) === k)) return j / hi;
  let hit = -1;                                    // unique prefix
  for (let j = 0; j < n; j++) {
    if (!names(list[j]).some(x => tight(x).indexOf(k) === 0)) continue;
    if (hit >= 0) return null;
    hit = j;
  }
  return hit >= 0 ? hit / hi : null;
}
// '1.5', 'x1.5', '×1.5', '3:2', '3/2' → ratio
function parseRatio(t) {
  const k = t.replace(/ /g, '').replace(/^[x×*]/, '').replace(/x$/, '');
  let m = /^(\d+(?:\.\d*)?|\.\d+)$/.exec(k);
  if (m) return +m[1];
  if ((m = /^(\d+(?:\.\d*)?)[:/](\d+(?:\.\d*)?)$/.exec(k))) return +m[2] > 0 ? m[1] / m[2] : null;
  return null;
}

// Typed entry (§8.1): accepts what fmtCore prints plus comma decimals, case-insensitive units, bare numbers in display
// units (time: the unit the control shows at its current base, s or ms), beat divisions for time controls, ladder
// labels for synced rates/times, enum labels (exact or unique prefix). Returns the clamped (stepped: grid-snapped) n,
// or null. Never throws.
export function parseCore(fmt, text, ctx) {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const t = prepText(text);
  if (!t || t.length > 64) return null;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  let n;
  try {
    n = parseCase(String(fmt), t, c);
  } catch (err) {
    return null;
  }
  if (typeof n !== 'number' || n !== n) return null;
  return snapN(c.law, c.lo, c.hi, clamp01(n)) + 0;
}

function parseCase(fmt, t, c) {
  const q = numUnit(t), law = c.law, lo = fin(c.lo) ? c.lo : 0, hi = fin(c.hi) ? c.hi : 1;
  const norm = v => (v === null || v !== v ? null : lawNorm(law, lo, hi, v));
  // Display unit ('s' | 'ms') of a time control at its current base (its default when no state is known)
  const shownUnit = () => {
    const b = fin(c.base) ? clamp01(c.base) : 0;
    return / s$/.test(fmtCore(fmt, lawValue(law, lo, hi, b), b, c)) ? 's' : 'ms';
  };
  if (fmt.slice(0, 5) === 'enum:') return parseEnum(t, c);
  if (q && q.u === '%' && !PCT_OWN[fmt]) return q.x / 100;          // knob position
  const bare = q && q.u === '' ? q.x : null;
  switch (fmt) {
    case 'pct': return q && (q.u === '' || q.u === '%') ? q.x / 100 : null;
    case 'pct1': case 'bip100': return q && (q.u === '' || q.u === '%') ? norm(q.x / 100) : null;
    case 'pan': { const x = parseLR(t); return x === null ? null : norm(x / 50); }
    case 'fpan': { const x = parseLR(t); return x === null ? null : 0.5 + x / 200; }
    case 'oct': return norm(parsePitch(t, 'oct'));
    case 'st': case 'st2': case 'st1': case 'npitch': return norm(parsePitch(t, 'st'));
    case 'crs': return /^-+$/.test(t) ? norm(0) : norm(parsePitch(t, 'st'));
    case 'ct': return norm(parsePitch(t, 'ct'));
    case 'int': case 'det': case 'q01': case 'q2': return norm(bare);
    case 'phase': case 'deg': {
      const mem = fmt === 'phase' && c.mem !== false;
      if (mem && /^mem/.test(t)) return 1;
      const x = q && (q.u === '' || q.u === 'deg') ? norm(q.x) : null;
      return mem && x !== null ? Math.min(x, 0.9994) : x;     // degrees never select Mem
    }
    case 'frame': {
      if (bare === null) return null;
      const F = fin(c.F) && c.F >= 1 ? Math.round(c.F) : 256;
      return F > 1 ? (clamp(Math.round(bare), 1, F) - 1) / (F - 1) : 0;
    }
    case 'hz': return norm(parseHz(t));
    case 'time': {         // BPM units (§6.14): ladder labels or exact beat values only
      const L = ladOf(c);
      if (c.sync && L) { const j = ladderIdx(L, t); return j < 0 ? null : j / (L.length - 1); }
      return norm(parseSec(t, c, shownUnit()));
    }
    case 'ms': case 'msFloor': { const s = parseSec(t, c, shownUnit()); return s === null ? null : norm(1000 * s); }
    case 'cmpAtt': {
      const s = parseSec(t, c, shownUnit());
      if (s === null) return null;
      return c.limit ? Math.sqrt(clamp(1000 * s, 0, 10) / 10) : norm(1000 * s);   // Limit: look-ahead 0–10 ms
    }
    case 'db': {          // '-inf' (≤ −120 dB) → the knob end with the smallest amplitude (threshold: n = 1)
      const q2 = numUnit(t), x = q2 && (q2.u === '' || q2.u === 'db') ? q2.x : null;
      if (x === null) return null;
      return x <= -120 ? (lawValue(law, lo, hi, 1) < lawValue(law, lo, hi, 0) ? 1 : 0) : norm(Math.pow(10, x / 20));
    }
    case 'dbv': { const q2 = numUnit(t); return norm(q2 && (q2.u === '' || q2.u === 'db') ? q2.x : null); }
    case 'dbtrim': { const q2 = numUnit(t), x = q2 && (q2.u === '' || q2.u === 'db') ? q2.x : null; return x === null ? null : Math.pow(10, x / 40) / 2; }
    case 'bool':
      if (/^(on|true|yes|1)$/.test(t)) return 1;
      return /^(off|false|no|0)$/.test(t) ? 0 : null;
    case 'ratio':
      if (/^(limit|lim)$/.test(t)) return 1;
      return q && (q.u === '' || q.u === 'ratio') ? norm(q.x) : null;
    case 'xoff': {
      const k = t.replace(/ /g, '');
      if (k === 'trip') return norm(4 / 3);
      if (k === 'dot') return norm(1.5);
      if (k === 'dot1/2') return norm(0.75);
      const m = /^x?(\d+(?:\.\d*)?|\.\d+)x?$/.exec(k);
      return m ? norm(+m[1]) : null;
    }
    case 'lbh': {          // 'LP 0' … 'HP 100'; the band word keeps n inside its band
      const m = LBH_RE.exec(t);
      if (!m || (!m[1] && m[2] === undefined)) return null;
      const x = m[2] !== undefined ? m[2] / 100 : m[1] === 'lp' ? 0 : m[1] === 'bp' ? 0.5 : 1;
      return m[1] === 'lp' ? Math.min(x, 0.249999) : m[1] === 'bp' ? clamp(x, 0.25, 0.75) : m[1] === 'hp' ? Math.max(x, 0.750001) : x;
    }
    case 'var': {          // percent, or dB of the EQ gain law for eq-family filter types (§6.11)
      if (q && q.u === '%') return q.x / 100;
      if (c.eq) {
        const q2 = numUnit(t), x = q2 && (q2.u === '' || q2.u === 'db') ? q2.x : null;
        return x === null ? null : x >= 0 ? 0.5 + x / 48 : x <= -96 ? 0 : Math.pow(10, x / 40) / 2;
      }
      return bare === null ? null : bare / 100;
    }
    case 'lfoRate': {
      const L = ladOf(c);
      if (!c.sync || !L) { const f = parseRate(t, c); return f === null ? null : norm(f / mulOf(c)); }
      const j = ladderIdx(L, t);
      return j < 0 ? null : j / (L.length - 1);
    }
    case 'lfoTime': {      // BPM on: value = beats / 2 (display), absolute times are made tempo-relative
      if (!c.sync) return norm(parseSec(t, c, shownUnit()));
      const b = beatsOf(t);
      if (b !== null) return norm(b / 2);
      if (bare !== null) return norm(bare / 2);
      const s = parseSec(t, c, 'ms');
      return s === null ? null : norm(s * ctxBpm(c) / 120);
    }
    case 'chaosRate': {
      const L = ladOf(c);
      if (c.sync && L) {
        const j = ladderIdx(L, t);
        if (j >= 0) return norm(ctxBpm(c) / 60 / L[j].beats);
      }
      return norm(parseRate(t, c));
    }
    case 'modRate': {
      const L = ladOf(c);
      if (!c.sync || !L) return norm(parseRate(t, c));
      const j = ladderIdx(L, t);
      return j < 0 ? null : j / (L.length - 1);
    }
    case 'dlyTime': {
      const L = ladOf(c);
      if (c.sync && L) { const j = ladderIdx(L, t); return j < 0 ? null : j / (L.length - 1); }
      const s = parseSec(t, c, shownUnit());
      return s === null ? null : norm(1000 * s);
    }
    case 'revT': {         // Plate: pre-delay ms (n·200); Hall: decay s (0.8 + 11.2·n)
      const s = parseSec(t, c, c.plate ? 'ms' : 's');
      if (s === null) return null;
      return c.plate ? 1000 * s / 200 : s === Infinity ? 1 : Math.min((s - 0.8) / 11.2, 0.9989);   // finite: never 'inf'
    }
    /* ---- Phase 2 (SPEC-serum2 §3.2) */
    case 'ratio2': case 'xmul': return norm(parseRatio(t));
    case 'hzoff': { const f = parseHz(t); return norm(f); }
    case 'smpPos': {       // percent of the sample; with a known length also times (bare = the unit shown)
      if (q && q.u === '%') return norm(q.x / 100);
      if (fin(c.len) && c.len > 0) { const s = parseSec(t, c, shownUnit()); return s === null ? null : norm(s / c.len); }
      return bare === null ? null : norm(bare / 100);
    }
    case 'scan': return q && (q.u === '' || q.u === '%') ? norm(q.x / 100 / rangeOf(c)) : null;
    case 'vcScale': {
      if (Array.isArray(c.rates) && c.rates.length) { const r = parseRatio(t); return r === null ? null : norm(snapRate(c.rates, r)); }
      return q && (q.u === '' || q.u === '%') ? norm(q.x / 100) : null;
    }
    case 'semiH': {         // Harmonics: '×h' / '÷k', a bare number in the unit shown (×: a positive integer); 'n st' = the SEM index
      if (c.pmode === 'step') { const m = /^([+-]?\d+) ?(steps?)?$/.exec(t); return m ? norm(+m[1]) : null; }
      let m = /^[x×*] ?(\d+)$/.exec(t);
      if (m) return +m[1] >= 1 ? norm(+m[1] - 1) : null;
      if ((m = /^[÷/] ?(\d+)$/.exec(t))) return +m[1] >= 1 ? norm(1 - +m[1]) : null;
      if (bare !== null) return Number.isInteger(bare) && bare >= 1 ? norm(bare - 1) : null;
      return norm(parsePitch(t, 'st'));
    }
    case 'slice': { const m = /^(?:slice ?)?(\d+)$/.exec(t); return m ? norm(+m[1] - 1) : null; }
    case 'dens': {
      const L = ladOf(c);
      if (c.mode === 1 && L) { const j = ladderIdx(L, t); return j < 0 ? null : j / (L.length - 1); }
      if (c.mode === 2) { const m = /^(\d+(?:\.\d*)?) ?(grains?)?$/.exec(t); return m ? (+m[1] - 1) / 63 : null; }
      const f = parseRate(t, c);
      return f === null ? null : f > 0.1 ? Math.log(f / 0.1) / Math.log(8000) : 0;
    }
    case 'glen': {
      const L = ladOf(c);
      if (c.mode === 1 && L) { const j = ladderIdx(L, t); return j < 0 ? null : j / (L.length - 1); }
      if (c.mode === 2) return q && (q.u === '' || q.u === '%') ? (q.x > 0 ? Math.log(q.x) / Math.log(800) : 0) : null;
      const s = parseSec(t, c, 'ms');
      return s === null ? null : s > 0 ? Math.log10(s / 0.001) / 4 : 0;
    }
    case 'fbal': {
      if (t === 'f1') return 0;
      if (t === 'f2') return 1;
      let m = /^f1 ?(\d+(?:\.\d*)?) ?%?(?: ?\/ ?f2 ?(\d+(?:\.\d*)?) ?%?)?$/.exec(t);
      // both shares typed: a mixed balance — 'F1 100 / F2 0' (printed for n in (0.0025, 0.005)) reads back inside that range
      if (m) return m[2] === undefined ? 1 - m[1] / 100 : Math.min(Math.max(1 - m[1] / 100, 0.004), 0.996);
      if ((m = /^f2 ?(\d+(?:\.\d*)?) ?%?$/.exec(t))) return m[1] / 100;
      return q && (q.u === '' || q.u === '%') ? norm(q.x / 100) : null;
    }
    case 'arpRate': {
      const L = ladOf(c);
      if (c.sync && L) { const j = ladderIdx(L, t); return j < 0 ? null : j / (L.length - 1); }
      const f = parseRate(t, c);
      return f === null || !(f > 0) ? null : Math.log(f / 0.5) / Math.log(100);
    }
    case 'inf0': return /^(∞|inf(inity)?)$/.test(t) ? norm(0) : norm(bare);
    default: return null;
  }
}
