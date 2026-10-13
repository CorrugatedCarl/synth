/*
 * tuning.js — microtuning files (SPEC-serum2 §11.4, §6.18; owner C1). Leaf module: pure, no imports, no DOM, no timers;
 * importable from the browser, node and Workers. serum-core re-exports it (§11.1).
 *
 * Tables: tab[n] (n = MIDI key 0–127) = the pitch of key n in fractional MIDI semitones relative to A4 = 440 Hz, i.e.
 * 69 + 12·log2(f / 440 Hz); the identity table (tab[n] = n) is 12-TET at 440 Hz. NaN marks a key that a .kbm leaves
 * unmapped ('x'): the allocator ignores its note-ons (§6.18). The concert-pitch knob (global.a4) scales the result in
 * the DSP (× a4/440). The state keeps the table as global.tun.tab (JSON: NaN → null), compileSerum turns it into CP.tune.
 *
 * Formats (limits: text ≤ 16 KB, ≤ 1024 scale degrees):
 *   .scl (Scala): lines starting with '!' are comments. The first other line is the description (may be empty), the
 *     next the number of degrees n (1–1024), then n pitches, one per line; only the first whitespace-separated token
 *     counts: a token containing '.' is cents, otherwise a ratio 'p/q' or an integer 'p' (= p/1) with p, q > 0. Degree 0
 *     (1/1) is implicit; the last pitch is the period (> 0 cents). Blank lines after the description are skipped.
 *   .kbm (Scala keyboard mapping): '!' comments; then size, first, last, middle, reference note, reference frequency,
 *     octave degree, and `size` mapping entries (a degree ≥ 0 or 'x'; trailing entries may be left out = unmapped).
 *   .tun (AnaMark v0/v1/v2): sections in brackets, `key = value` lines, ';' comments, keys case-insensitive.
 *     [Tuning] `note k = cents` relative to 8.1757989156 Hz (MIDI note 0; missing notes 100·k); [Exact Tuning]
 *     `BaseFreq = f` (default 8.1757989156) and `note k = cents` relative to BaseFreq, overriding [Tuning] note by note;
 *     [Info] `Name = "…"`. [Functional Tuning] (v2) is not evaluated: v2 writers also emit [Exact Tuning].
 *
 * Mapping rules (normative for this project; IMPL where Scala/AnaMark leave a choice):
 *   - without a .kbm: linear mapping, key 60 = degree 0, key 69 sounds at 440 Hz (§11.4);
 *   - .kbm size 0: linear mapping from the middle note (key n → degree n − middle);
 *   - .kbm size > 0: key n → i = n − middle, q = floor(i / size), entry e = map[i − q·size] ('x' or left out ⇒ NaN),
 *     degree d = e + q·D with D = the octave degree (0 ⇒ the scale's own degree count n);
 *   - pitch of degree d: cents(d) = floor(d / n)·period + cents[d mod n] (cents[0] = 0);
 *   - key n sounds at refFreq · 2^((cents(d_n) − cents(d_ref)) / 1200); a reference note that the mapping leaves
 *     unmapped is a .kbm error;
 *   - keys outside the .kbm's [first, last] range are not retuned: tab[n] = n (12-TET);
 *   - [Exact Tuning] giving notes 0…k only (k ≥ 1, contiguous): notes above k repeat the given notes with the period
 *     cents[k] − cents[0] (AnaMark rule); other missing notes keep the [Tuning] / default value.
 *
 * State record (§2.2.2 global.tun): tuningState(files, cur) builds {name, kind, scl, kbm, tab} for loaded files (texts
 * kept for Step mode and re-normalisation; tab in JSON form, null = unmapped), tabJson(tab) converts a table, TET12_SCL is
 * the 12-TET .scl a lone .kbm maps when no scale is loaded.
 *
 * Functions never throw. Invalid input gives {error: '<message>'} (parsers, tuningState) or the identity table
 * (tableFrom), no Step data (stepTable: sclN 0) and the 12-TET description (describe).
 */

const MAX_TEXT = 16384;
const MAX_DEG = 1024;
const MIDI0 = 440 * Math.pow(2, -69 / 12);          // 8.175798915643707 Hz (MIDI note 0, the AnaMark base)
const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const err = msg => ({ error: msg });

// text → lines (any line ending); null for non-text and texts over the limit (reported by the caller)
function linesOf(text) {
  if (typeof text !== 'string') return null;
  return text.split(/\r\n|\r|\n/);
}
const firstTok = line => line.trim().split(/\s+/)[0] || '';
const INT_RE = /^\d+$/;
const CENTS_RE = /^[+-]?(\d+\.\d*|\.\d+)$/;
const RATIO_RE = /^(\d+)(?:\/(\d+))?$/;

// one .scl pitch token → cents, or null
function pitchCents(tok) {
  if (tok.indexOf('.') >= 0) {
    if (!CENTS_RE.test(tok)) return null;
    const c = Number(tok);
    return fin(c) ? c : null;
  }
  const m = RATIO_RE.exec(tok);
  if (!m) return null;
  const p = Number(m[1]), q = m[2] === undefined ? 1 : Number(m[2]);
  if (!(p > 0) || !(q > 0) || !fin(p) || !fin(q)) return null;
  const c = 1200 * Math.log2(p / q);
  return fin(c) ? c : null;
}

/* ================================================================ .scl */

// → {name, cents: number[] (degree 1…n; the last = the period), n} | {error}
export function parseScl(text) {
  const lines = linesOf(text);
  if (!lines) return err('not a text');
  if (text.length > MAX_TEXT) return err('file too large (over 16 KB)');
  let j = 0;
  const next = blankOk => {                         // next non-comment line (blank lines skipped unless blankOk)
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*!/.test(l)) continue;
      if (!blankOk && !l.trim()) continue;
      j++;
      return l;
    }
    return null;
  };
  const desc = next(true);
  if (desc === null) return err('empty scale file');
  const cnt = next(false);
  if (cnt === null) return err('missing number of notes');
  const ct = firstTok(cnt);
  if (!INT_RE.test(ct)) return err('invalid number of notes: ' + ct.slice(0, 16));
  const n = Number(ct);
  if (n < 1) return err('the scale has no notes');
  if (n > MAX_DEG) return err('too many notes (over ' + MAX_DEG + ')');
  const cents = [];
  for (let k = 0; k < n; k++) {
    const l = next(false);
    if (l === null) return err('expected ' + n + ' pitches, found ' + k);
    const tok = firstTok(l), c = pitchCents(tok);
    if (c === null) return err('invalid pitch on degree ' + (k + 1) + ': ' + tok.slice(0, 24));
    cents.push(c);
  }
  if (!(cents[n - 1] > 0)) return err('the period (last pitch) must be above 1/1');
  return { name: desc.trim().slice(0, 64), cents, n };
}

/* ================================================================ .kbm */

// → {size, first, last, middle, refNote, refFreq, octDegree, map: (number | null)[]} | {error}
export function parseKbm(text) {
  const lines = linesOf(text);
  if (!lines) return err('not a text');
  if (text.length > MAX_TEXT) return err('file too large (over 16 KB)');
  const toks = [];
  for (const l of lines) if (!/^\s*!/.test(l) && l.trim()) toks.push(firstTok(l));
  if (toks.length < 7) return err('incomplete keyboard mapping (7 header values expected)');
  const ints = [];
  for (let k = 0; k < 7; k++) {
    if (k === 5) continue;
    if (!INT_RE.test(toks[k])) return err('invalid value on line ' + (k + 1) + ': ' + toks[k].slice(0, 16));
    ints[k] = Number(toks[k]);
  }
  const size = ints[0], first = ints[1], last = ints[2], middle = ints[3], refNote = ints[4], octDegree = ints[6];
  const refFreq = Number(toks[5]);
  if (size > MAX_DEG) return err('mapping too large (over ' + MAX_DEG + ' keys)');
  for (const [v, what] of [[first, 'first note'], [last, 'last note'], [middle, 'middle note'], [refNote, 'reference note']]) {
    if (v > 127) return err(what + ' out of range 0–127');
  }
  if (first > last) return err('first note above last note');
  if (!fin(refFreq) || !(refFreq > 0) || !/^[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(toks[5])) return err('invalid reference frequency');
  if (octDegree > MAX_DEG) return err('octave degree out of range');
  const map = [];
  for (let k = 0; k < size && 7 + k < toks.length; k++) {
    const t = toks[7 + k];
    if (t === 'x' || t === 'X') map.push(null);
    else if (INT_RE.test(t)) map.push(Number(t));
    else return err('invalid mapping entry ' + (k + 1) + ': ' + t.slice(0, 16));
  }
  while (map.length < size) map.push(null);
  if (size > 0) {
    const i = refNote - middle, r = i - Math.floor(i / size) * size;
    if (map[r] === null) return err('the reference note is unmapped');
  }
  return { size, first, last, middle, refNote, refFreq, octDegree, map };
}

/* ================================================================ .tun */

// a line without its ';' comment (outside double quotes)
function stripComment(l) {
  let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l.charAt(i);
    if (ch === '"') q = !q;
    else if (ch === ';' && !q) return l.slice(0, i);
  }
  return l;
}
const unquote = v => { const t = v.trim(); return t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"' ? t.slice(1, -1) : t; };

// → {name, hz: Float64Array(128)} | {error}
export function parseTun(text) {
  const lines = linesOf(text);
  if (!lines) return err('not a text');
  if (text.length > MAX_TEXT) return err('file too large (over 16 KB)');
  const tun = new Float64Array(128), ex = new Float64Array(128), exSet = new Uint8Array(128);
  for (let k = 0; k < 128; k++) tun[k] = 100 * k;
  let sec = '', hasTun = 0, hasExact = 0, hasFunc = 0, base = MIDI0, name = '';
  for (const raw of lines) {
    const l = stripComment(raw).trim();
    if (!l) continue;
    const s = /^\[(.+)\]$/.exec(l);
    if (s) {
      sec = s[1].trim().toLowerCase();
      if (sec === 'tuning') hasTun = 1;
      else if (sec === 'exact tuning') hasExact = 1;
      else if (sec === 'functional tuning') hasFunc = 1;
      continue;
    }
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const key = l.slice(0, eq).trim().toLowerCase(), val = l.slice(eq + 1).trim();
    if (sec === 'info' && key === 'name') { name = unquote(val).slice(0, 64); continue; }
    if (sec !== 'tuning' && sec !== 'exact tuning') continue;
    if (sec === 'exact tuning' && key === 'basefreq') {
      const f = Number(val);
      if (!fin(f) || !(f > 0) || val === '') return err('invalid BaseFreq');
      base = f;
      continue;
    }
    const m = /^note\s*(\d+)$/.exec(key);
    if (!m) continue;
    const k = Number(m[1]), c = Number(val);
    if (val === '' || !fin(c)) return err('invalid value for ' + key.slice(0, 16));
    if (k > 127) continue;
    if (sec === 'tuning') tun[k] = c;
    else { ex[k] = c; exSet[k] = 1; }
  }
  if (!hasTun && !hasExact) return err(hasFunc ? 'unsupported: only a [Functional Tuning] section' : 'no [Tuning] or [Exact Tuning] section');
  const hz = new Float64Array(128);
  for (let k = 0; k < 128; k++) hz[k] = MIDI0 * Math.pow(2, tun[k] / 1200);
  if (hasExact) {
    let top = -1;
    while (top < 127 && exSet[top + 1]) top++;
    let given = 0;
    for (let k = 0; k < 128; k++) given += exSet[k];
    if (top >= 1 && top < 127 && given === top + 1) {          // notes 0…top only: periodic continuation
      const per = ex[top] - ex[0];
      for (let k = top + 1; k < 128; k++) { ex[k] = ex[k - top] + per; exSet[k] = 1; }
    }
    for (let k = 0; k < 128; k++) if (exSet[k]) hz[k] = base * Math.pow(2, ex[k] / 1200);
  }
  for (let k = 0; k < 128; k++) if (!fin(hz[k]) || !(hz[k] > 0)) return err('note ' + k + ' has no valid frequency');
  return { name, hz };
}

/* ================================================================ tables */

const identity = () => { const t = new Float64Array(128); for (let k = 0; k < 128; k++) t[k] = k; return t; };
const sclOk = p => isObj(p) && Array.isArray(p.cents) && Number.isInteger(p.n) && p.n >= 1 && p.n <= MAX_DEG && p.cents.length === p.n
  && p.cents.every(fin) && p.cents[p.n - 1] > 0;
const kbmOk = k => isObj(k) && [k.size, k.first, k.last, k.middle, k.refNote, k.octDegree].every(v => Number.isInteger(v) && v >= 0)
  && fin(k.refFreq) && k.refFreq > 0 && Array.isArray(k.map) && k.map.every(e => e === null || (Number.isInteger(e) && e >= 0));
const asScl = x => (typeof x === 'string' ? parseScl(x) : x);

// {scl, kbm} (parsed objects or texts; kbm optional) or {tun} (parsed or text) → Float64Array(128): fractional MIDI
// pitch per key relative to A4 = 440 Hz, NaN for unmapped keys. Invalid input → the identity table.
export function tableFrom(src) {
  const o = isObj(src) ? src : {};
  if (o.tun !== undefined && o.tun !== null && o.tun !== '') {
    const t = typeof o.tun === 'string' ? parseTun(o.tun) : o.tun;
    if (!isObj(t) || !t.hz || t.hz.length !== 128) return identity();
    const out = new Float64Array(128);
    for (let k = 0; k < 128; k++) {
      const f = t.hz[k];
      if (!fin(f) || !(f > 0)) return identity();
      out[k] = 69 + 12 * Math.log2(f / 440);
    }
    return out;
  }
  const scl = asScl(o.scl);
  if (!sclOk(scl)) return identity();
  let kbm = null;
  if (o.kbm !== undefined && o.kbm !== null && o.kbm !== '') {
    kbm = typeof o.kbm === 'string' ? parseKbm(o.kbm) : o.kbm;
    if (!kbmOk(kbm)) return identity();
  }
  const N = scl.n, per = scl.cents[N - 1];
  const cents = d => { const q = Math.floor(d / N), r = d - q * N; return q * per + (r === 0 ? 0 : scl.cents[r - 1]); };
  const size = kbm ? kbm.size : 0, middle = kbm ? kbm.middle : 60, refNote = kbm ? kbm.refNote : 69, refFreq = kbm ? kbm.refFreq : 440;
  const first = kbm ? kbm.first : 0, last = kbm ? kbm.last : 127, oct = kbm && kbm.octDegree > 0 ? kbm.octDegree : N;
  const degOf = key => {
    const i = key - middle;
    if (size === 0) return i;
    const q = Math.floor(i / size), e = kbm.map[i - q * size];
    return e === null || e === undefined ? null : e + q * oct;
  };
  const dRef = degOf(refNote);
  if (dRef === null) return identity();
  const off = 69 + 12 * Math.log2(refFreq / 440), cRef = cents(dRef), out = new Float64Array(128);
  for (let k = 0; k < 128; k++) {
    if (k < first || k > last) { out[k] = k; continue; }
    const d = degOf(k);
    out[k] = d === null ? NaN : off + (cents(d) - cRef) / 100;
  }
  return out;
}

/* ================================================================ the state's tuning record (GLOBAL > TUNING, §13.10) */

// The 12-TET scale as a .scl text: the scale a .kbm loaded on its own maps (no scale loaded yet)
export const TET12_SCL = '! 12-TET.scl\n12-tone equal temperament\n12\n'
  + Array.from({ length: 12 }, (_, k) => (100 * (k + 1)).toFixed(1)).join('\n') + '\n';
// Float64Array(128) → the state's JSON form (NaN, i.e. unmapped keys → null)
export const tabJson = tab => Array.from(tab, v => (fin(v) ? v : null));
const given = x => typeof x === 'string' && x !== '';

// The record global.tun = {name, kind, scl, kbm, tab} (§2.2.2) for files loaded by the user, or {error}. files = {scl?,
// kbm?, tun? (texts), name? (the file's base name, shown as the tuning name)}; cur = the current global.tun (optional).
// Rules (IMPL): a .tun replaces everything (kind 'tun'; tab from the file, texts ''); the scale and the keyboard mapping
// are kept independently, as two files: a .scl replaces the scale and keeps the current .kbm (kind 'scl' with a valid
// .kbm; else the linear mapping of §11.4), a .scl + .kbm in one load replace both, a .kbm on its own maps the current
// .scl (kind 'scl'), or 12-TET (TET12_SCL) when none is loaded; files.kbm === null drops the mapping (GLOBAL > TUNING
// "Clear Mapping": with no .scl given, the current .scl is re-mapped linearly). Name: files.name, else the .scl
// description / the .tun [Info] name, else the current name (no new .scl), else 'Tuning'; ≤ 64 characters. Never throws.
export function tuningState(files, cur) {
  const f = isObj(files) ? files : {}, c = isObj(cur) ? cur : {};
  const fname = typeof f.name === 'string' ? f.name.trim() : '';
  if (given(f.tun)) {
    const t = parseTun(f.tun);
    if (t.error) return t;
    return { name: (fname || t.name || 'Tuning').slice(0, 64), kind: 'tun', scl: '', kbm: '', tab: tabJson(tableFrom({ tun: t })) };
  }
  const isScl = c.kind === 'scl', curScl = isScl && given(c.scl) && !parseScl(c.scl).error ? c.scl : '';
  const curKbm = isScl && given(c.kbm) && !parseKbm(c.kbm).error ? c.kbm : '', clearKbm = f.kbm === null;
  if (!given(f.scl) && !given(f.kbm) && !(clearKbm && curScl)) return err('no tuning file');
  const scl = given(f.scl) ? f.scl : curScl || TET12_SCL, kbm = given(f.kbm) ? f.kbm : clearKbm ? '' : curKbm;
  const p = parseScl(scl);
  if (p.error) return p;
  const k = kbm ? parseKbm(kbm) : null;
  if (k && k.error) return k;
  const name = fname || (given(f.scl) ? p.name : (typeof c.name === 'string' && curScl ? c.name : p.name)) || 'Tuning';
  return { name: name.slice(0, 64), kind: 'scl', scl, kbm, tab: tabJson(tableFrom({ scl: p, kbm: k })) };
}

// Step pitch mode data (§6.3.3): sclN degrees per period, sclPer = period in semitones, sclSteps[k] = degree k in
// semitones (k < sclN; sclSteps[0] = 0). Scales of more than 128 degrees (CP.sclSteps holds 128) and invalid input
// give sclN 0 (Step mode then acts as Semitones).
export function stepTable(scl) {
  const p = asScl(scl), out = { sclN: 0, sclPer: 0, sclSteps: new Float64Array(128) };
  if (!sclOk(p) || p.n > 128) return out;
  out.sclN = p.n;
  out.sclPer = p.cents[p.n - 1] / 100;
  for (let k = 1; k < p.n; k++) out.sclSteps[k] = p.cents[k - 1] / 100;
  return out;
}

/* ================================================================ display */

const hzOf = p => 440 * Math.pow(2, (p - 69) / 12);
const fmtHz = f => (f >= 1000 ? f.toFixed(1) : f.toFixed(2)) + ' Hz';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = k => NOTE_NAMES[k % 12] + (Math.floor(k / 12) - 1);

// One-line description of a tuning table (Float64Array or the state's JSON array with null for unmapped keys), for the
// GLOBAL page: '12-TET (A4 = 440 Hz)' for none / identity tables, else the mapped key count and a few reference pitches.
export function describe(tab) {
  const STD = '12-TET (A4 = 440 Hz)';
  if (!tab || typeof tab.length !== 'number' || tab.length !== 128) return STD;
  let mapped = 0, ident = true, lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 128; k++) {
    const v = tab[k];
    if (!fin(v)) { ident = false; continue; }
    mapped++;
    if (Math.abs(v - k) > 1e-9) ident = false;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (ident) return STD;
  if (!mapped) return 'Microtuning: no key mapped';
  const at = k => (fin(tab[k]) ? keyName(k) + ' = ' + fmtHz(hzOf(tab[k])) : keyName(k) + ' unmapped');
  const keys = mapped === 128 ? '128 keys' : mapped + ' of 128 keys mapped';
  return 'Microtuning: ' + keys + ' · ' + at(60) + ' · ' + at(69) + ' · range ' + fmtHz(hzOf(lo)) + ' – ' + fmtHz(hzOf(hi));
}
