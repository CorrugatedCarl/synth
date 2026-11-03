/*
 * kit-core.js — our drum machine's main-side model (docs/canvas/IMPL-DM.md §2.2, §3, §5; stage DM). Leaf ES module: no
 * imports, no DOM / timers / storage (node-tested: tests/kit-core.test.mjs). drum-core dispatches a record with m 'kit' here
 * (the 7b / 7c / 8 pattern: the four older machines' code untouched); the worklet side is kit-dsp.js (`DrKit`, which embeds an
 * identical copy of KIT.TYPES / KIT.LAW, compared by a test) and dr-seq.js's `vl` branch.
 *
 * KIT — every flippable choice as data ("cheap to reverse", IMPL-DM's header):
 *   WORD 'Drums' (the display name is models.js's one line: the rig's name + ' ' + WORD) · ID 'kit' (the model, the family's
 *   machine, the file / CSS / test stem — never the name) · SLOTS 16 · CODES ka…kp (slot j's code: the map's keys, the lay keys
 *   iN/ka…iN/kp, the control-id stem) · FIELDS t u d l c 1 2 3 4 (§5.2: TYPE, TUNE, DECAY, LEVEL, CHOKE, k1–k4) · IDS the 144
 *   control ids, slot-major (models.js's order, the engine's KitP order) · TYPES [7] by TYPE value (0 empty: null) — §2.2 as
 *   data: { n, id, label, u, d, k: [4 knobs], bright (the k index velocity brightens, §2.1), blk (the type's block constants) },
 *   each knob { id, label, law, lo, hi, unit, def } (def a position 0…1; lawVal reads it) · LAW the common laws of §2.1 ·
 *   STARTER (the tile's eight voices, §5.7) · DEMO null (the user: an empty grid) · KITS (four presets, full value sets) ·
 *   VEL (soft · normal · accent) · NOTES [7] by type (§3.5) + NOTE_FREE · CHOKE_MS · TINT [7] by type (§4.8).
 * Laws (lawVal(L, x), x the knob position 0…1, clamped; NaN → the default): exp lo·(hi/lo)^x · lin lo + (hi − lo)·x · int
 *   lo + round((hi − lo)·x) · bal x·π/2 (the Snare's TONE: body cos, noise sin) · drive g = g0 + g2·x² (LAW.drive). Times are
 *   seconds, frequencies Hz, bends semitones, levels fractions.
 *
 * The record (dev.drum of a kit, §5.3), normKit(d): exact lengths, every field bounded, unknown fields dropped, idempotent,
 * never throws (a hostile getter: the empty record):
 *   { v: 1, m: 'kit', pat: [8 × { len 1–16, sc 3, cells: [≤ 256 × { l 0–15, s 0–15, v 1–127, c? 0–100, r? 1–4, n? −120…120,
 *     p? −24…24 }] }], ui: { pat 0–7 }, x: { sync: true, swing 50–75, mute, solo (16 bits), rec: false }, keys: [] (main's drumOf
 *     and the drum host's mem gate read a record by it: the SDS-V's precedent), ty: [16 × 0–6] (the TYPEs' mirror: reconcile
 *     writes it), map: { ka…kp: [primary, …aliases] } (notes 0–127, unique across the map, ≤ 8 a slot), nm: [16 × ≤ 16
 *     characters], tr: [16 × row → voice mask] (the identity in cut 1), smp: { <code>: { id, name, on } } (cut 2's slots) }
 *   cells sparse, sorted by (s, l), unique per (l, s) (the first kept); c / r / n / p absent = neutral (100 / 1 / 0 / 0) — a
 *   neutral value is dropped, so the canonical form is unique. sc is 3 (16ths) in cut 1: cut 2 widens it (no stored 1 / 2 / 4
 *   plays as a 16th meanwhile).
 *
 * The sequencer (§3, §5.2–§5.4, §9.2; lane S): presence, names and notes travel with the record (ty, nm, map: no vals argument) —
 * starter() (the tile's machine) · typesOf(vals) · reconcile(vals, D) (ty = the vals' TYPEs, notes for new voices) · noteFor(type,
 * map) · names(D) / rows(D) (the roll's { n, s, name }) · audible(D) · compilePlan(D, S) (one measure + vl: DrSeq's kit branch, the
 * family's shape) · payload(D, S, at) · toNotes(plan, opts) (steps ≡ notes) · initState() · press(S, D, input) → { state, mem, cmds }
 * (the family's pure state machine; its inputs and commands at press) · leds(S, D) → { step, lit }.
 */

/* ================================================================ helpers */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;    // (NaN → lo; + 0: no −0 in saved state)
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const at = (a, i) => (Array.isArray(a) ? a[i] : undefined);
const mask16 = (x, d) => (fin(x) && x === Math.floor(x) && x >= 0 ? x & 0xFFFF : d);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ================================================================ the laws (§2.1, §2.2) */

// a knob: id, label, law, lo, hi, unit, def (position 0…1)
const kb = (id, label, law, lo, hi, unit, def) => ({ id, label, law, lo, hi, unit, def });
const TUNE = (lo, hi, def) => kb('tune', 'Tune', 'exp', lo, hi, 'Hz', def);
const DECAY = (lo, hi, def) => kb('decay', 'Decay', 'exp', lo, hi, 's', def);
const DRIVE = kb('drive', 'Drive', 'drive', 0, 1, '', 0);              // (§2.1: one block for the Kick and the Tom)

// §2.2's table: TUNE (u), DECAY (d, a T60) and k1–k4; bright = the k velocity brightens; blk = the block's own constants
const TYPES = [
  null,
  { n: 1, id: 'kick', label: 'Kick', u: TUNE(30, 120, 0.5), d: DECAY(0.08, 2.4, 0.55), bright: 2,
    k: [kb('punch', 'Punch', 'exp', 1, 16, 'x', 0.5),                  // r = 2^(4k): the sweep's start ratio
      kb('sweep', 'Sweep', 'exp', 0.002, 0.08, 's', 0.4),               // τ of f(t) = f·(1 + (r − 1)·e^(−t/τ))
      kb('click', 'Click', 'lin', 0, 0.6, '', 0.3),                     // the burst's peak × the body's
      DRIVE],
    blk: { clickS: 0.004, clickHp: 2000 } },                            // a 4 ms Hann noise burst through a 1-pole high-pass
  { n: 2, id: 'snare', label: 'Snare', u: TUNE(120, 360, 0.5), d: DECAY(0.06, 0.78, 0.4), bright: 1,
    k: [kb('tone', 'Tone', 'bal', 0, 1, '', 0.55),                     // body : noise = cos : sin(k·π/2)
      kb('color', 'Color', 'exp', 1000, 8000, 'Hz', 0.5),               // the noise's 2-pole high-pass
      kb('snap', 'Snap', 'exp', 0.05, 0.6, 's', 0.45),                  // the noise's T60
      kb('body', 'Body', 'lin', 0, 1, '', 0.5)],                        // the second mode's level
    blk: { ratio: 1.594, drop: 0.12, dropS: 0.008 } },                  // a circular membrane's first two modes, dropping 12 % over 8 ms
  { n: 3, id: 'hat', label: 'Hi-hat', u: TUNE(200, 800, 0.5), d: DECAY(0.02, 1.5, 0.3), bright: 0,
    k: [kb('tone', 'Tone', 'exp', 3000, 12000, 'Hz', 0.5),             // the 2-pole high-pass
      kb('metal', 'Metal', 'lin', 0, 1, '', 0.6),                       // squares : noise
      kb('ring', 'Ring', 'exp', 0.7, 8, 'Q', 0.3),                      // the band-pass's Q
      kb('spread', 'Spread', 'lin', 0.5, 1.5, 'x', 0.5)],               // the ratios as 1 + (r − 1)·(0.5 + k)
    blk: { ratios: [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637], bp: 1.5 } }, // ours (D7); the band-pass at 1.5 × the high-pass
  { n: 4, id: 'clap', label: 'Clap', u: kb('tune', 'Tune', 'exp', 600, 2400, 'Hz', 0.5), d: DECAY(0.08, 0.8, 0.4), bright: 2,
    k: [kb('spread', 'Spread', 'exp', 0.004, 0.016, 's', 0.5),         // the bursts' spacing
      kb('count', 'Count', 'int', 2, 6, '', 0.5),                       // n = 2 + round(4k)
      kb('tone', 'Tone', 'exp', 2000, 16000, 'Hz', 0.6),                // a 1-pole low-pass
      kb('tail', 'Tail', 'lin', 0, 1, '', 0.6)],                        // the tail's level × the burst peak
    blk: { q: 1.4, upS: 0.0002, tauS: 0.0025 } },                       // the band-pass's Q; each burst 0.2 ms up, τ 2.5 ms down
  { n: 5, id: 'tom', label: 'Tom', u: TUNE(60, 480, 0.4), d: DECAY(0.08, 1.6, 0.5), bright: 2,
    k: [kb('bend', 'Bend', 'lin', 0, 12, 'st', 0.3),                   // f·2^((b/12)·e^(−t/τ))
      kb('sweep', 'Sweep', 'exp', 0.01, 0.12, 's', 0.4),
      kb('noise', 'Noise', 'lin', 0, 0.4, '', 0.2),                     // × the body's peak
      DRIVE],
    blk: { noiseAt: 2, noiseT60: 0.25 } },                              // the burst's band-pass at 2f, its T60 a quarter of the body's
  { n: 6, id: 'perc', label: 'Perc', u: TUNE(150, 4800, 0.6), d: DECAY(0.005, 1, 0.3), bright: 2,
    k: [kb('ratio', 'Ratio', 'lin', 1, 3, 'x', 0.4),                   // the second resonator at f·(1 + 2k)
      kb('tone', 'Tone', 'lin', 0, 1, '', 0.5),                         // the second mode's level
      kb('click', 'Click', 'lin', 0, 1, '', 0.3),                       // impulse ↔ noise burst
      kb('bend', 'Bend', 'lin', 0, 7, 'st', 0)],                        // both bend down over bendS
    blk: { burstS: 0.001, bendS: 0.015 } },                             // resonators Q = π·f·T60 / ln 1000
];
// §2.1: the paths' attacks, velocity (gain (v/127)^vPow, the bright knob + vBright·(v − 100)/127), LEVEL ((l / lRef)²), the drive
// block y = A·tanh(g·x) / tanh(g·A), the sleep / flush thresholds, the control-rate chunk in base frames
const LAW = { att: 0.0003, vPow: 2, vBright: 0.2, lRef: 0.7, drive: { A: 0.8, g0: 0.01, g2: 6 }, sleep: 1e-5, sleepChunks: 4, flush: 1e-30, chunk: 4 };

/** A knob's law at position x (0…1, clamped; not a number → the knob's default). */
export function lawVal(L, x) {
  const p = fin(x) ? clamp(x, 0, 1) : L.def;
  switch (L.law) {
    case 'exp': return L.lo * Math.pow(L.hi / L.lo, p);
    case 'int': return L.lo + Math.round((L.hi - L.lo) * p);
    case 'bal': return p * Math.PI / 2;
    case 'drive': return LAW.drive.g0 + LAW.drive.g2 * p * p;
    default: return L.lo + (L.hi - L.lo) * p;
  }
}

/* ================================================================ KIT */

const CODES = 'abcdefghijklmnop'.split('').map(c => 'k' + c);
const FIELDS = ['t', 'u', 'd', 'l', 'c', '1', '2', '3', '4'];
// a voice of type t at its type's defaults, then o's positions: { t, n (its note), nm, c (choke), u, d, l, k: [4] }
const voice = (t, n, nm, o = {}) => ({ t, n, nm, c: o.c || 0, u: o.u ?? TYPES[t].u.def, d: o.d ?? TYPES[t].d.def, l: o.l ?? LAW.lRef,
  k: TYPES[t].k.map((q, i) => (o.k && o.k[i] != null ? o.k[i] : q.def)) });
// §5.7: Kick, Snare, Clap, Closed hat, Open hat (choke 1 with the closed hat), Low tom, High tom, Rim (a Perc); notes fixed here
const STARTER = [
  voice(1, 36, ''), voice(2, 38, ''), voice(4, 39, ''), voice(3, 42, 'Closed hat', { c: 1 }), voice(3, 46, 'Open hat', { c: 1, d: 0.6 }),
  voice(5, 45, 'Low tom', { u: 0.3 }), voice(5, 50, 'High tom', { u: 0.55 }), voice(6, 37, 'Rim', { d: 0.15, k: [null, null, 0.6] }),
];
// a kit's full value set (vals units: knobs 0–10 = position · 10, TYPE / CHOKE indices); an empty slot: TYPE 0, the knobs mid, LEVEL 7
const r2 = x => Math.round(x * 1000) / 100;                            // position → knob value (two decimals)
function kitVals(list) {
  const v = {};
  CODES.forEach((s, j) => {
    const e = list[j];
    v[s + 't'] = e ? e.t : 0; v[s + 'u'] = e ? r2(e.u) : 5; v[s + 'd'] = e ? r2(e.d) : 5; v[s + 'l'] = r2(e ? e.l : LAW.lRef); v[s + 'c'] = e ? e.c : 0;
    for (let i = 0; i < 4; i++) v[s + (i + 1)] = e ? r2(e.k[i]) : 5;
  });
  return v;
}
// the starter with some voices' positions changed: [slot, { u, d, k }] (k: [4] with nulls kept)
const vary = mods => STARTER.map((e, j) => { const m = mods[j]; return m ? { ...e, u: m.u ?? e.u, d: m.d ?? e.d, k: e.k.map((x, i) => (m.k && m.k[i] != null ? m.k[i] : x)) } : e; });
const KITS = [
  { name: 'Starter', v: kitVals(STARTER) },
  // a lower, longer kick; darker hats
  { name: 'Deep', v: kitVals(vary({ 0: { u: 0.3, d: 0.65, k: [0.6, 0.55] }, 3: { k: [0.25] }, 4: { k: [0.25] }, 5: { u: 0.2 }, 6: { u: 0.45 } })) },
  // short decays, a snappy snare
  { name: 'Tight', v: kitVals(vary({ 0: { d: 0.3 }, 1: { d: 0.25, k: [0.65, 0.65, 0.25] }, 2: { d: 0.25 }, 3: { d: 0.18 }, 4: { d: 0.45 }, 5: { d: 0.35 }, 6: { d: 0.35 }, 7: { d: 0.08 } })) },
  // drive on the kick and the toms, bright hats
  { name: 'Crunch', v: kitVals(vary({ 0: { k: [null, null, 0.45, 0.6] }, 3: { k: [0.8, 0.75] }, 4: { k: [0.8, 0.75] }, 5: { k: [null, null, null, 0.5] }, 6: { k: [null, null, null, 0.5] } })) },
];

export const KIT = deepFreeze({
  WORD: 'Drums',       // the display word: models.js's name is the rig's name + ' ' + WORD (one line; a rename renames it)
  ID: 'kit',           // the model id, the machine, the stem of every file / key / CSS class — never the name
  SLOTS: 16,           // the family's payload is 16 sounds wide (a structural bound, not a performance cap)
  CODES,               // slot j's code ka…kp
  FIELDS,              // §5.2's nine per slot
  IDS: CODES.flatMap(s => FIELDS.map(f => s + f)),
  TYPES,
  LAW,
  STARTER,
  DEMO: null,          // the user (2026-11-01): a new machine opens on an empty grid; a beat later = data here
  KITS,
  VEL: { soft: 64, normal: 100, accent: 127 },
  NOTES: [[], [36, 35], [38, 40], [42, 44, 46], [39], [45, 41, 48, 43, 47, 50], [37, 56, 75, 76, 77]], // a new voice: its type's first free note
  NOTE_FREE: 60,       // …else the first free note from here
  CHOKE_MS: 3,         // a choke's raised-cosine fade
  // the type colours (LC's list rule, IMPL-LC R2-5): each ≥ 3 : 1 on the charcoal, ivory and glass screens (style.css --rig-screen)
  TINT: [null, '#e0533d', '#5a6fe0', '#b07a10', '#d6528f', '#2a8f4c', '#9b5fd6'],
});

/* ================================================================ normKit (§5.3) */

const N_PAT = 8, N_CELLS = 256, SWING_LO = 50, SWING_HI = 75, NM_MAX = 16, MAP_MAX = 8;
const SMP_ID = /^smp:[0-9a-f]{16}$/;
function normCells(a) {
  const out = [], seen = new Set();
  if (!Array.isArray(a)) return out;
  for (let i = 0; i < a.length && out.length < N_CELLS; i++) {
    const e = a[i];
    if (!isObj(e)) continue;
    const l = e.l, s = e.s, v = intIn(e.v, 0, 0, 127);
    if (!Number.isInteger(l) || l < 0 || l > 15 || !Number.isInteger(s) || s < 0 || s > 15 || v < 1 || seen.has(s * 16 + l)) continue;
    seen.add(s * 16 + l);
    const c = { l, s, v }, ch = intIn(e.c, 100, 0, 100), r = intIn(e.r, 1, 1, 4), n = intIn(e.n, 0, -120, 120), p = intIn(e.p, 0, -24, 24);
    if (ch !== 100) c.c = ch;                                          // (neutral values absent: one canonical form)
    if (r !== 1) c.r = r;
    if (n !== 0) c.n = n;
    if (p !== 0) c.p = p;
    out.push(c);
  }
  return out.sort((x, y) => x.s - y.s || x.l - y.l);
}
function normPat(e) {
  e = isObj(e) ? e : {};
  return { len: intIn(e.len, 16, 1, 16), sc: 3, cells: normCells(e.cells) };
}
function normMapK(m) {
  const out = {}, used = new Set();
  m = isObj(m) ? m : {};
  for (const s of CODES) {
    const a = own(m, s) ? m[s] : null, l = [];
    if (Array.isArray(a)) for (let i = 0; i < a.length && l.length < MAP_MAX; i++) {
      const n = a[i];
      if (Number.isInteger(n) && n >= 0 && n <= 127 && !used.has(n)) { used.add(n); l.push(n); } // (later duplicates dropped)
    }
    out[s] = l;
  }
  return out;
}
function normSmpK(o) {
  const out = {};
  if (!isObj(o)) return out;
  for (const s of CODES) {
    const e = own(o, s) ? o[s] : null;
    if (!isObj(e) || typeof e.id !== 'string' || !SMP_ID.test(e.id)) continue;
    out[s] = { id: e.id, name: typeof e.name === 'string' ? e.name.slice(0, 64) : '', on: e.on === true };
  }
  return out;
}
/** dev.drum of a kit, normalised (§5.3): exact lengths, every field bounded, unknown fields dropped; idempotent; never throws. */
export function normKit(d) {
  try {
    d = isObj(d) ? d : {};
    const pat = [], ty = [], nm = [], tr = [];
    for (let p = 0; p < N_PAT; p++) pat.push(normPat(at(d.pat, p)));
    const ui = isObj(d.ui) ? d.ui : {}, x = isObj(d.x) ? d.x : {};
    for (let j = 0; j < 16; j++) {
      ty.push(intIn(at(d.ty, j), 0, 0, 6));
      const s = at(d.nm, j);
      nm.push(typeof s === 'string' ? s.slice(0, NM_MAX) : '');
      tr.push(mask16(at(d.tr, j), 1 << j));
    }
    return { v: 1, m: 'kit', pat, ui: { pat: intIn(ui.pat, 0, 0, N_PAT - 1) },
      x: { sync: true, swing: intIn(x.swing, SWING_LO, SWING_LO, SWING_HI), mute: mask16(x.mute, 0), solo: mask16(x.solo, 0), rec: false },
      keys: [], ty, map: normMapK(d.map), nm, tr, smp: normSmpK(d.smp) };
  } catch (e) {
    return normKit(undefined);                                         // (a hostile getter: the empty record)
  }
}

/* ================================================================ the sequencer (§3, §5.2–§5.4; lane S) */

const STEP_T = [0, 320, 160, 240, 120], SWUNG = [0, 0, 0, 1, 1];       // (= drum-core / DrSeq) step code → ticks, swung; a kit plays code 3
const SC = 3, STEP = STEP_T[SC], FREE_BPM = 120;                       // 16ths (240 ticks at 960 PPQ); the payload's free tempo (never read: synced)
const swingTicks = (pct, T) => Math.round((2 * pct - 100) * T / 100);  // (= drum-core / DrSeq) the odd step's whole-tick delay
const idx = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : -1);
const J = JSON.stringify;
// FNV-1a 32 (= drum-core / seq-core) over numbers and typed arrays
function fnvNum(h, v) { h ^= v & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 8) & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 16) & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 24) & 255; return Math.imul(h, 0x01000193); }
function fnvArr(h, ta) { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } return h; }
const hex = h => (h >>> 0).toString(16).padStart(8, '0');
// a record as normKit makes it (a cheap shape check), else normKit's (hostile input: the empty record)
function okRec(D) {
  try { return isObj(D) && D.m === 'kit' && Array.isArray(D.pat) && D.pat.length === N_PAT && isObj(D.ui) && isObj(D.x) && Array.isArray(D.ty) && D.ty.length === 16
    && isObj(D.map) && Array.isArray(D.nm) && Array.isArray(D.tr) && D.pat.every(p => isObj(p) && Array.isArray(p.cells)); } catch (e) { return false; }
}
const rec = D => (okRec(D) ? D : normKit(D));
const present = D => { let m = 0; for (let j = 0; j < 16; j++) if (D.ty[j] > 0) m |= 1 << j; return m; };
const DEF_TY = CODES.map(s => KITS[0].v[s + 't']);                    // the model's defaults (the Starter kit's TYPEs)

/** The tile's machine (§1.2, §5.7): KIT.STARTER's types, notes and names on an empty grid, pattern A — a fresh record each call. */
export function starter() {
  const ty = [], map = {}, nm = [];
  CODES.forEach((s, j) => { const e = STARTER[j]; ty.push(e ? e.t : 0); map[s] = e ? [e.n] : []; nm.push(e ? e.nm : ''); });
  return normKit({ ty, map, nm });
}
/** The 16 TYPEs of vals (rounded, 0–6); a missing / bad one the model's default (the Starter kit's: the model wrapper's fill). */
export function typesOf(vals) {
  try {
    const v = isObj(vals) ? vals : {};
    return CODES.map((s, j) => { const x = v[s + 't']; return fin(x) ? clamp(Math.round(x), 0, 6) : DEF_TY[j]; });
  } catch (e) { return DEF_TY.slice(); }
}
/** A new voice's note (§3.5): its type's first free note (KIT.NOTES), else the first free from NOTE_FREE up, then down; −1 none. A
 *  note any slot holds is taken (an empty slot's kept note too: freed only by Remove). */
export function noteFor(type, map) {
  if (!Number.isInteger(type) || type < 1 || type > 6) return -1;
  const used = new Set();
  try {
    if (isObj(map)) for (const s of CODES) { const a = own(map, s) ? map[s] : null; if (Array.isArray(a)) for (const n of a) if (Number.isInteger(n) && n >= 0 && n <= 127) used.add(n); }
  } catch (e) { /* (a hostile map holds nothing) */ }
  for (const n of KIT.NOTES[type]) if (!used.has(n)) return n;
  for (let n = KIT.NOTE_FREE; n <= 127; n++) if (!used.has(n)) return n;
  for (let n = KIT.NOTE_FREE - 1; n >= 0; n--) if (!used.has(n)) return n;
  return -1;
}
/** 16 names from the record (§5.2; read with bounds — a raw record works): nm when set, else the type's label + an ordinal among
 *  the same type's automatic names ("Tom", "Tom 2"); '' for an empty slot. */
export function names(D) {
  const out = new Array(16).fill('');
  try {
    if (!isObj(D)) return out;
    const n = [0, 0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 16; j++) {
      const t = intIn(at(D.ty, j), 0, 0, 6), s = at(D.nm, j);
      if (!t) continue;
      if (typeof s === 'string' && s) { out[j] = s.slice(0, NM_MAX); continue; }
      const k = ++n[t];
      out[j] = TYPES[t].label + (k > 1 ? ' ' + k : '');
    }
    return out;
  } catch (e) { return new Array(16).fill(''); }
}
/** The roll's rows (§5.2): { n: the primary, s: the slot, name } of the present voices with a note, in slot order. */
export function rows(D) {
  D = rec(D);
  const N = names(D), out = [];
  for (let j = 0; j < 16; j++) { const a = D.map[CODES[j]]; if (D.ty[j] > 0 && a.length) out.push({ n: a[0], s: j, name: N[j] }); }
  return out;
}
/** The 16-bit mask of the present (ty > 0), unmuted voices — the soloed ones when any solo; a muted voice stays muted soloed (§3.4). */
export function audible(D) {
  D = rec(D);
  const so = D.x.solo & 0xFFFF;
  return present(D) & ~D.x.mute & (so || 0xFFFF);
}
/** vals → the record (§5.4; pure, idempotent): ty = the vals' TYPEs; a voice made present without a note gets noteFor's (slot
 *  order); a voice made empty keeps its cells and note (inert); names untouched. The same object when nothing changes. */
export function reconcile(vals, D) {
  const R = rec(D), ty = typesOf(vals);
  let map = null;
  const same = ty.every((t, j) => t === R.ty[j]);
  for (let j = 0; j < 16; j++) {
    const s = CODES[j], m = map || R.map;
    if (!(ty[j] > 0) || m[s].length) continue;
    const n = noteFor(ty[j], m);
    if (n >= 0) { map = map || { ...R.map }; map[s] = [n]; }
  }
  if (same && !map && R === D) return D;
  return { ...R, ty: same ? R.ty : ty, map: map || R.map };
}

/* ---------------------------------------------------------------- the plan, the payload, the notes (§3.6, §3.7) */

let memo = null;
/** The family's plan shape (drum-core.js compilePlan) for one measure of the selected pattern + `vl` (§3.6): { key, shape, n 1, intro
 *  0, loopFrom 0, mKey [pattern], mVar [0], mPre [3], mL1 [len], mOff [0, len], mT [0, len · 240], st Uint16Array(len) — lane j =
 *  slot j, no accent bit —, vl Uint8Array(16 · len) — slot j's velocity at step s in vl[16 s + j] (0 where st has no bit) —, fill
 *  null }. A cell plays when its row is present; the row → voice matrix `tr` (the identity in cut 1) picks the voices, the audible
 *  ones only (mute / solo recompile: the same shape, DrSeq swaps in place). key over everything, shape over the timing (= the
 *  family's). Memoised (one entry: the pattern's, ty's and tr's identity, the pattern index, the audible mask). S: unread (the
 *  family's signature; the kit's plan needs no session). */
export function compilePlan(D, S) {
  D = rec(D);
  const p = D.ui.pat, P = D.pat[p], A = audible(D), M = memo;
  if (M && M.P === P && M.ty === D.ty && M.tr === D.tr && M.p === p && M.A === A) return M.plan;
  const L = P.len, st = new Uint16Array(L), vl = new Uint8Array(16 * L);
  for (const c of P.cells) {
    if (c.s >= L || !(D.ty[c.l] > 0)) continue;
    const to = D.tr[c.l] & A;
    for (let j = 0; j < 16; j++) if (to >> j & 1) { const o = 16 * c.s + j; st[c.s] |= 1 << j; if (c.v > vl[o]) vl[o] = c.v; }
  }
  const mKey = Int8Array.of(p), mVar = new Int8Array(1), mPre = Uint8Array.of(SC), mL1 = Uint8Array.of(L), mOff = Int32Array.of(0, L), mT = Int32Array.of(0, L * STEP);
  let h = fnvNum(0x811c9dc5 | 0, 1); h = fnvNum(h, 0); h = fnvNum(h, 0);
  h = fnvArr(h, mPre); h = fnvArr(h, mL1); h = fnvArr(h, mOff);
  const shape = hex(h);
  h = fnvArr(h, mKey); h = fnvArr(h, mVar); h = fnvArr(h, st); h = fnvArr(h, vl);
  const plan = { key: hex(h), shape, n: 1, intro: 0, loopFrom: 0, mKey, mVar, mPre, mL1, mOff, mT, st, vl, fill: null };
  memo = { P, ty: D.ty, tr: D.tr, p, A, plan };
  return plan;
}
// the payload's content key: the plan's + FNV over the rest (drum-core pkOf's fields, m 'kit')
function pkOf(s) {
  let h = fnvNum(0x811c9dc5 | 0, 1); h = fnvNum(h, 0); h = fnvNum(h, Math.round(s.bpm * 100));
  h = fnvNum(h, s.swing); h = fnvNum(h, s.tap); h = fnvNum(h, s.mute); h = fnvArr(h, s.map); h = fnvArr(h, s.prim);
  for (let i = 0; i < s.m.length; i++) h = fnvNum(h, s.m.charCodeAt(i));
  return s.plan.key + hex(h);
}
/** The family's {t:'seq'} payload (§3.7): { plan, sync: true, run: false, bpm 120 (a synced machine never reads it: the project's tempo
 *  never moves pk), swing, at, tap 0, map (note → slot) and prim (slot → primary) of the present voices only — an empty slot's kept
 *  note plays nothing —, mute = mute | ~solo when any solo (16 bits), smp null (cut 1), m 'kit', pk }; pk the content, not at or the
 *  session. */
export function payload(D, S, at = 'now') {
  D = rec(D);
  const plan = compilePlan(D, S), P = present(D), map = new Int8Array(128).fill(-1), prim = new Int8Array(16).fill(-1);
  for (let j = 0; j < 16; j++) {
    if (!(P >> j & 1)) continue;
    const a = D.map[CODES[j]];
    for (const n of a) map[n] = j;
    if (a.length) prim[j] = a[0];
  }
  const so = D.x.solo & 0xFFFF;
  const s = { plan, sync: true, run: false, bpm: FREE_BPM, swing: D.x.swing, at, tap: 0, map, prim, mute: (D.x.mute | (so ? ~so : 0)) & 0xFFFF, smp: null, m: 'kit' };
  s.pk = pkOf(s);
  return s;
}
// the 16 primaries of a map object (toNotes' opts.map)
function primOf(map) {
  const p = new Int8Array(16).fill(-1);
  try { if (isObj(map)) CODES.forEach((s, j) => { const a = own(map, s) ? map[s] : null, n = Array.isArray(a) ? a[0] : -1; if (Number.isInteger(n) && n >= 0 && n <= 127) p[j] = n; }); } catch (e) { /* none */ }
  return p;
}
/** A kit plan's hits in [t0, t1) as roll notes (§3.6, D3): the plan anchored at tick 0, its steps at the family's whole-tick swung
 *  positions (drum-core toNotes' rule) — { t, d: 120, n: prim[j], v: vl[16 o + j] } per sounding lane, sorted by t then n; a lane
 *  without a primary skipped. opts { t0, t1, swing (%), prim (16) | map }. A plan without vl: none. */
export function toNotes(plan, opts) {
  const out = [];
  if (!plan || !(plan.n > 0) || !plan.vl) return out;
  const o = isObj(opts) ? opts : {};
  const t0 = Math.max(0, fin(o.t0) ? Math.round(o.t0) : 0), t1 = fin(o.t1) ? Math.round(o.t1) : t0;
  const pct = intIn(o.swing, SWING_LO, SWING_LO, SWING_HI), prim = o.prim && o.prim.length === 16 ? o.prim : primOf(o.map);
  const T = plan.mT, n = plan.n, lf = plan.loopFrom | 0, cyc = T[n] - T[lf];
  if (!(cyc > 0) || !(t1 > t0)) return out;
  let off = 0;
  if (t0 >= T[n]) off = T[n] - T[lf] + Math.floor((t0 - T[n]) / cyc) * cyc;      // (whole cycles behind: drum-core measureAt)
  let m = off ? lf : 0, hi = n - 1;
  while (m < hi) { const q = (m + hi + 1) >> 1; if (T[q] + off <= t0) m = q; else hi = q - 1; }
  let start = T[m] + off;
  while (start < t1) {
    const pre = plan.mPre[m], Ts = STEP_T[pre], w = SWUNG[pre] ? swingTicks(pct, Ts) : 0;
    for (let s = 0, k = plan.mOff[m]; k < plan.mOff[m + 1]; s++, k++) {
      const t = start + s * Ts + (s & 1 ? w : 0), mask = plan.st[k];
      if (t < t0 || t >= t1 || !mask) continue;
      for (let j = 0; j < 16; j++) if (mask >> j & 1 && prim[j] >= 0) out.push({ t, d: 120, n: prim[j], v: plan.vl[16 * k + j] });
    }
    start += T[m + 1] - T[m];
    m = m + 1 < n ? m + 1 : lf;
  }
  return out.sort((a, b) => a.t - b.t || a.n - b.n);
}

/* ---------------------------------------------------------------- the session, the press state machine, the LEDs (§3.8) */

/** A fresh session (never saved): the song's transport (play; run is always false — the kit has no free run), pos (the last
 *  {t:'step'} heard: { s, m, k, o, M, F }), the project tempo, hits ([[lane, slot]] the HIT auditions sounding: the 909's idiom). */
export function initState() { return { m: 'kit', run: false, play: false, pos: null, bpm: 120, hits: [] }; }
// a kit session; another machine's (a Replace under the same view) keeps its transport and tempo only
function sess(S) {
  try {
    if (isObj(S) && S.m === 'kit') return Array.isArray(S.hits) ? S : { ...S, hits: [] };
    return { ...initState(), play: isObj(S) && !!S.play, bpm: isObj(S) && fin(S.bpm) ? S.bpm : 120 };
  } catch (e) { return initState(); }
}
const setAt = (a, j, v) => { if (a[j] === v) return a; const b = a.slice(); b[j] = v; return b; };
const withPat = (D, p, P) => { const pat = D.pat.slice(); pat[p] = P; return { ...D, pat }; };
const withX = (D, o) => ({ ...D, x: { ...D.x, ...o } });
// lane l of pattern p at `steps` to velocity v (0 off); the cut-2 fields of a cell kept; the same record when nothing changes
function setCells(D, p, l, steps, v) {
  const P = D.pat[p], want = new Set(steps), cells = [];
  let ch = false;
  for (const c of P.cells) {
    if (c.l !== l || !want.has(c.s)) { cells.push(c); continue; }
    want.delete(c.s);
    if (v > 0) cells.push(c.v === v ? c : { ...c, v });
    if (c.v !== v) ch = true;
  }
  if (v > 0) for (const s of want) { cells.push({ l, s, v }); ch = true; }
  if (!ch) return D;
  return withPat(D, p, { ...P, cells: cells.sort((a, b) => a.s - b.s || a.l - b.l) });
}
// every pattern's cells of lane j gone (the patterns without one shared)
function clearLane(D, j) {
  if (!D.pat.some(P => P.cells.some(c => c.l === j))) return D;
  return { ...D, pat: D.pat.map(P => (P.cells.some(c => c.l === j) ? { ...P, cells: P.cells.filter(c => c.l !== j) } : P)) };
}
/**
 * The Sequencer's pure state machine (§3.8, the family's press: drum-core.js): (session, dev.drum, input) → { state, mem, cmds }; both
 * treated as immutable (a changed one comes back new, structurally shared; an unchanged one the same reference). cmds:
 *   { c: 'send', at: 'now' | 'bar' }   post payload(mem, state, at) (one per input, exactly when the record changed)
 *   { c: 'hit', sound: slot, v } / { c: 'hit', sound: slot, off: true }   a HIT audition through the host's note path (the 909's)
 *   { c: 'play' } / { c: 'stop' }      the song's ▶ / ■ (start)
 * Inputs (`k`; lane / slot 0–15, step 0–15 inside the pattern's LENGTH, v 0 off · 1–127):
 *   cell { lane, step, v } · paint { lane, steps[], v } (one gesture) — the selected pattern, a present voice's row; 'now' (the same
 *   shape: in place) · pat { p 0–7 } · len { n 1–16 } — 'bar' while playing (the measure's end), else 'now' · swing { v 50–75 } ·
 *   clear (the selected pattern's cells; its LENGTH kept) · clearAll · demo (KIT.DEMO into the selected pattern; inert while null) ·
 *   mute / solo { lane } (a toggle; the plan recompiles) · hit { lane, v } (a present voice with a note; v default 100) / hit { lane,
 *   off: true } · voice { slot, op: 'add', type 1–6 } (an empty slot: its TYPE mirrored, its kept note or noteFor's, its lane cleared
 *   in every pattern, its name automatic, its mute / solo off) / voice { slot, op: 'remove' } (ty 0, the note freed, the lane cleared,
 *   the name reset, mute / solo off) — the record's half; the vals' half is the host's (§4.6) · start · the host's notifications:
 *   transport { play } (a start forgets the heard step), heard { post }, bpm { v }, panic / release (the auditions let go).
 */
export function press(state, drum, input) {
  let S = sess(state), D = rec(drum), at = 'now';
  const i = isObj(input) ? input : {}, cmds = [], run = !!S.play, p = D.ui.pat, P = D.pat[p];
  const vIn = v => (fin(v) ? clamp(Math.round(v), 0, 127) : -1);
  switch (i.k) {
    case 'cell': {
      const l = idx(i.lane, 0, 15), s = idx(i.step, 0, 15), v = vIn(i.v);
      if (l >= 0 && s >= 0 && v >= 0 && D.ty[l] > 0 && s < P.len) D = setCells(D, p, l, [s], v);
      break;
    }
    case 'paint': {
      const l = idx(i.lane, 0, 15), v = vIn(i.v), st = Array.isArray(i.steps) ? i.steps.filter(s => idx(s, 0, P.len - 1) >= 0) : [];
      if (l >= 0 && v >= 0 && D.ty[l] > 0 && st.length) D = setCells(D, p, l, st, v);
      break;
    }
    case 'pat': { const q = idx(i.p, 0, N_PAT - 1); if (q >= 0 && q !== p) { D = { ...D, ui: { ...D.ui, pat: q } }; at = run ? 'bar' : 'now'; } break; }
    case 'len': { if (!fin(i.n)) break; const n = clamp(Math.round(i.n), 1, 16); if (n !== P.len) { D = withPat(D, p, { ...P, len: n }); at = run ? 'bar' : 'now'; } break; }
    case 'swing': { if (!fin(i.v)) break; const w = clamp(Math.round(i.v), SWING_LO, SWING_HI); if (w !== D.x.swing) D = withX(D, { swing: w }); break; }
    case 'clear': if (P.cells.length) D = withPat(D, p, { ...P, cells: [] }); break;
    case 'clearAll': if (D.pat.some(q => q.cells.length)) D = { ...D, pat: D.pat.map(q => (q.cells.length ? { ...q, cells: [] } : q)) }; break;
    case 'demo': { // (inert while KIT.DEMO is null: the user's empty grid; a beat later = data)
      if (!KIT.DEMO) break;
      const q = normPat(KIT.DEMO);
      if (J(q) !== J(P)) D = withPat(D, p, q);
      break;
    }
    case 'mute': case 'solo': { const l = idx(i.lane, 0, 15); if (l >= 0) D = withX(D, { [i.k]: D.x[i.k] ^ (1 << l) }); break; }
    case 'hit': {
      const l = idx(i.lane, 0, 15);
      if (l < 0) break;
      if (i.off === true) { if (S.hits.some(h => h[0] === l)) { S = { ...S, hits: S.hits.filter(h => h[0] !== l) }; cmds.push({ c: 'hit', sound: l, off: true }); } break; }
      if (!(D.ty[l] > 0) || !D.map[CODES[l]].length) break;
      const v = fin(i.v) ? clamp(Math.round(i.v), 1, 127) : KIT.VEL.normal;
      S = { ...S, hits: [...S.hits.filter(h => h[0] !== l), [l, l]] };
      cmds.push({ c: 'hit', sound: l, v });
      break;
    }
    case 'voice': {
      const j = idx(i.slot, 0, 15), s = CODES[j], b = ~(1 << j);
      if (j < 0) break;
      if (i.op === 'add') {
        const t = idx(i.type, 1, 6);
        if (t < 0 || D.ty[j] > 0) break;
        const n = D.map[s].length ? null : noteFor(t, D.map);
        D = clearLane({ ...D, ty: setAt(D.ty, j, t), map: n === null ? D.map : { ...D.map, [s]: n >= 0 ? [n] : [] }, nm: setAt(D.nm, j, '') }, j);
        D = withX(D, { mute: D.x.mute & b, solo: D.x.solo & b });
      } else if (i.op === 'remove') {
        let R = clearLane({ ...D, ty: setAt(D.ty, j, 0), map: D.map[s].length ? { ...D.map, [s]: [] } : D.map, nm: setAt(D.nm, j, '') }, j);
        if ((R.x.mute | R.x.solo) & ~b) R = withX(R, { mute: R.x.mute & b, solo: R.x.solo & b });
        if (J(R) !== J(D)) D = R;
      }
      break;
    }
    case 'start': cmds.push({ c: run ? 'stop' : 'play' }); break; // (always synced: START / STOP is the song's ▶)
    case 'transport': { const pl = !!i.play; S = pl ? { ...S, play: true, pos: null } : S.play ? { ...S, play: false } : S; break; }
    case 'heard': {
      const q = i.post;
      if (isObj(q)) S = { ...S, pos: { s: q.s | 0, m: q.m | 0, k: q.k | 0, o: q.o | 0, M: q.M | 0, F: fin(q.F) ? q.F : -1 } };
      break;
    }
    case 'bpm': if (fin(i.v) && i.v > 0 && i.v !== S.bpm) S = { ...S, bpm: i.v }; break;
    case 'panic': if (S.run || S.hits.length) S = { ...S, run: false, hits: [] }; break;
    case 'release': if (S.hits.length) S = { ...S, hits: [] }; break; // (a cancelled hold / the host's release-all: the auditions end)
    default: break;
  }
  if (D !== drum) cmds.push({ c: 'send', at });
  return { state: S, mem: D, cmds };
}
/** The Sequencer's lights (§3.8): { step: the heard step while the song plays | −1, lit: the 16-bit mask of the heard step's audible
 *  voices in the heard pattern (pos.k; the row lamps between the monitor's posts) }. */
export function leds(S, D) {
  try {
    if (!isObj(S) || !S.play || !isObj(S.pos)) return { step: -1, lit: 0 };
    D = rec(D);
    const s = S.pos.s | 0, k = idx(S.pos.k, 0, N_PAT - 1) >= 0 ? S.pos.k : D.ui.pat, P = D.pat[k], A = audible(D);
    let lit = 0;
    for (const c of P.cells) if (c.s === s && s < P.len && D.ty[c.l] > 0) lit |= D.tr[c.l] & A;
    return { step: s, lit };
  } catch (e) { return { step: -1, lit: 0 }; }
}
