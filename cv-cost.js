// cv-cost.js — CPU cost estimates of the canvas devices, "Measure this device" and the soft caps (SPEC-canvas §9.1, §9.2;
// contract: docs/canvas/IMPL-1e.md §4.6, lane D). Plain ES module: no DOM; the measurement runs in a Worker (the
// smprender.js pattern). Node-tested: tests/cv-cost.test.mjs.
//
//   COST                          the cost table (loads on the reference machine, below); every model of models.js, every
//                                 effect type of fx-core FXTYPES
//   estimate(x, factor = 1, {notes = 8})  → load (fraction of one core's real time). x: a device of track.dev
//                                 ({kind: 'synth', model, vals[, fx], on} | {kind: 'panel', fx | rack}), a model id, an effect
//                                 type id or 'panel'. Instruments are costed playing a `notes`-note chord (the bench chord),
//                                 capped by their polyphony; a powered-off instrument costs COST.off
//   estimateTrack(track, factor)  the powered instruments and the panels of a track (a v1 track: its instrument + rack)
//   label(load)                   '~3 %' ('<1 %' under 0.5 %) — the tray tiles' text
//   softCap(track, adding, {touch, factor}) → {warn, confirm}: §9.2 on touch devices — a 4th instrument warns, a second
//                                 heavy Serum (> HEAVY on this device) asks first; else nulls
//   measureDevice({progress, signal, runs = 3, seconds = 1, runner, rows}) → Promise<factor>: renders the rows c1 (Prophet-5,
//                                 8 notes, OS 4), j (Convolve, 4 s IR) and e (light Serum: 16 voices Multisample) for
//                                 `seconds` each, median of `runs`, in a Worker; factor = median over the rows of load / REF
//                                 (the node reference). The caller stores it in prefs (PREF). Rejects with a clear Error when
//                                 Workers or AudioWorklet are missing, with name 'AbortError' when the signal aborts
//   factorOf(loads) → {factor, ratios}, supported(g) → null | reason, workerRunner(o) → runner, deviceRows() → rows,
//   workerMain                    the Worker's body (stringified into a Blob; exported for the tests)
//
// Units: every number below is a load on the reference machine of tests/bench.json (Apple M4 Max, node v24.21.0, 48 kHz),
// measured 2026-10-18 through tests/bench-scenarios.mjs measure() (median of 5 × 1 s) — the classic rows with
// tests/bench.html's CLASSIC builder (default panel, OS 4, the DX7's Brass Ensemble), 1 note and 8 notes; the Serum
// voice terms fitted to variations of the default patch (OS 2) and the rows d–h' of bench.json; the effects one
// instance on the bench noise (mix 50 %). The device factor scales them (iPad Pro of bench.json "ipad1d": ≈ 0.85).
// estimate = base + voice × min(poly, notes) for a classic (the iPad c-rows of bench.json "ipad1d" ≈ 0.85–0.95 × the
// 8-note column; bench.json has no node c-rows, so these node columns are their reference):
//
//   model     family / anchor row            poly   base    voice   8 notes  (ipad1d)
//   prophet5  CEM VCO + 4-pole OTA   c1        5    0.0054  0.0066  0.0384   (c1 0.036)
//   juno60    DCO + IR3109 + BBD     c2        6    0.0068  0.0072  0.0500   (c2 0.044)
//   jupiter8  IR3109 OTA poly        c6        8    0.0055  0.0068  0.0599   (c6 0.054)
//   obxa      SVF poly ≈ c6 family   —         8    0.0056  0.0034  0.0328
//   cs80      2 channels, 12 dB SK ≈ c1 fam.   8    0.0055  0.0040  0.0375
//   dx7       6-op FM                c4       16    0.0079  0.0025  0.0279   (c4 0.026)
//   solina    divide-down + ensemble c5        keys 0.0110  0.0021  0.0278   (c5 0.021; a "voice" = a held key)
//   minimoog  transistor ladder      c3        1    0.0055  0.0063  0.0118   (c3 0.010)
//   modular   ladder ≈ c3            —         1    0.0055  0.0063  0.0118
//   arp2600   4072 ladder ≈ c3       —         1    0.0055  0.0059  0.0114
//   ms20      Korg 35 SK ≈ c3        —         1    0.0055  0.0089  0.0144
//   tb303     diode ladder + seq ≈ c3 —        1    0.0055  0.0137  0.0192
//   tr808     12 voice circuits      d8p       1    0.0175  0.0030  0.0205   (IMPL-7a §2.6: the machine playing its typical
//             pattern — "notes" do not apply, base + voice = bench row d8p, 0.0205 (the gate's 0.0211 calibrated); voice =
//             one circuit retriggered (lane V's 0.003, RD §1.3); d8x 0.037, d8m 0.017, d8s 0.0055, idle d8i 0.0002)
//   tr606     5 voice circuits       d6p       1    0.0143  0.0030  0.0173   (IMPL-7b §2.6: as the 808, its row d6p — the
//             gate's 0.0173 calibrated (measure() 0.0152–0.0165 beside d8p's 0.0177–0.0183); d6x 0.0192, d6m 0.0137, idle
//             d6i 0.0002; JSC steady d6p 0.014, d6x 0.014, d6m 0.0096)
//   tr909     7 circuits + 3 ROM     d9p       1    0.0142  0.0030  0.0172   (IMPL-7c §2.7: as the 808, its row d9p — the
//             gate's 0.0171–0.0173 calibrated (beside d8p 0.0199, d6p 0.0173 in the same runs); d9x 0.0209, d9m 0.0096,
//             idle d9i 0.0002; its house pattern keeps nearly every circuit awake, yet ten voices cost the 606's five's)
//   sdsv      5 voice cards          dvp       1    0.0101  0.0030  0.0131   (IMPL-8 §12.7: as the 808, its row dvp — roll
//             notes, no sequencer; the gate's 0.0131 calibrated (V5's machine 0.0065 + the Track); dvx 0.0194, dvm 0.0092,
//             idle dvi 0.0002)
//   m900      patched modules        m9p       1    0.0055  0         —        (IMPL-9 §3.8: no voices — base = the Inst's
//             decimators + the Track (spike (a); V9b ≈ 0.0053), + COST.patch[type] per live node — a module (section) MAIN
//             OUT is reachable from; the engine runs no other — + COST.loop (≈ 6–9 ns a sample) per member of a loop step,
//             MAIN OUT silent = idle (COST.off); no record = the Model 15 set as Classic bass leaves it, the tile's and a new
//             device's; the rows' gate measured m9p 0.0185 / m9x 0.0372 / m9d 0.0186 calibrated against these estimates'
//             0.0202 / 0.0345 / 0.0215 — m9x's three loop members included, review 1 F5)
//
// Serum (OS 2; ×0.68 at OS 1, ×1.59 at OS 4): base 0.0063 (default 1 / 4 / 8 voices = 0.0100 / 0.0209 / 0.0356) + per
// voice 0.00245 + per oscillator on [first unison voice, each further one]: Wavetable [0.0012, 0.00042] · Multisample
// [0.0023, 0.0015] (row e) · Sample [0.0023, 0.0015] (rows f, f') · Spectral [0.0074, 0.0037] (h, h') · Granular
// 0.0035 + 0.0006 per grain sounding (density × length, ≤ 256, ≤ 512 per processor: g, g', g") + 0.00075 per warp slot
// per unison voice (d) + 0.0039 per filter + 0.0016 for sub / noise each + 0.00012 per matrix row (i). Within ±15 % of
// the node rows d–h' (tests). "Heavy" (§9.2) = estimate × factor > HEAVY (0.15): row d (0.40) is, the default (0.036) not.
//
// Effects (one instance): Convolve 0.026 (row j: the 4 s bench IR, an upper bound) · Reverb by type Plate / Hall /
// Vintage / Nitrous / Basin 0.008 / 0.005 / 0.006 / 0.009 / 0.007 (rows k0–k4) · Bode 0.003 (row l, with blur) · the
// splitters 0.0011 (L/H) / 0.0020 (L/M/H, row m with its EQs) / 0.0004 (M/S) without their branches · Distortion 0.0039
// · Compressor 0.0043 · Chorus 0.0024 · Filter 0.0021 · Flanger 0.0018 · Phaser 0.0018 · Delay 0.0017 · Hyper 0.0015 ·
// EQ 0.0009 · Utility 0.0003; a panel 0.0001 (§9.1 "extra empty rack"); bypassed / disabled instances cost nothing.
import { MODELS, patchFor } from './models.js?v=9';
import * as core from './serum-core.js?v=9';
import * as W from './wt.js?v=9';
import { lawNorm } from './laws.js?v=9';
import { playbackEntry, irEntry } from './smpwork.js?v=9';
import { convShapeOf } from './assets.js?v=9';
import * as MG from './moog-core.js?v=9';
import * as PT from './patch-core.js?v=9';

/** prefs key of the measured device factor (the caller's prefs; absent = 1). */
export const PREF = 'cv.devFactor';
/** §9.2: a Serum is "heavy" above this load on this device. */
export const HEAVY = 0.15;
/** The chord an instrument is costed with (the bench chord). */
export const CHORD = 8;

const C = (row, family, poly, base, voice) => Object.freeze({ row, family, poly, base, voice });
export const COST = Object.freeze({
  os: 4, chord: CHORD, off: 0.0005, panel: 0.0001,
  synth: Object.freeze({
    prophet5: C('c1', 'CEM VCO + 4-pole OTA', 5, 0.0054, 0.0066), juno60: C('c2', 'DCO + IR3109 + BBD chorus', 6, 0.0068, 0.0072),
    jupiter8: C('c6', 'IR3109 OTA poly', 8, 0.0055, 0.0068), obxa: C('c6', 'SVF poly', 8, 0.0056, 0.0034),
    cs80: C('c1', '2 channels, 12 dB HPF + LPF', 8, 0.0055, 0.0040), dx7: C('c4', '6-operator FM', 16, 0.0079, 0.0025),
    solina: C('c5', 'divide-down + ensemble', Infinity, 0.0110, 0.0021), minimoog: C('c3', 'transistor ladder', 1, 0.0055, 0.0063),
    modular: C('c3', 'transistor ladder', 1, 0.0055, 0.0063), arp2600: C('c3', '4072 ladder', 1, 0.0055, 0.0059),
    ms20: C('c3', 'Korg 35 Sallen-Key', 1, 0.0055, 0.0089), tb303: C('c3', 'diode ladder + sequencer', 1, 0.0055, 0.0137),
    tr808: C('d8p', 'drums', 1, 0.0175, 0.0030), tr606: C('d6p', 'drums', 1, 0.0143, 0.0030),
    tr909: C('d9p', 'drums', 1, 0.0142, 0.0030), sdsv: C('dvp', 'drums', 1, 0.0101, 0.0030),
    m900: C('m9p', 'patch', 1, 0.0055, 0),
    serum: Object.freeze({ row: 'e', family: 'Serum (terms in COST.serum)', poly: 32, base: 0.0063, voice: 0.00245 }),
  }),
  serum: Object.freeze({
    base: 0.0063, voice: 0.00245, os: Object.freeze({ 1: 0.68, 2: 1, 4: 1.59 }),
    osc: Object.freeze({ wt: [0.0012, 0.00042], multi: [0.0023, 0.0015], sample: [0.0023, 0.0015], spec: [0.0074, 0.0037] }),
    gran: 0.0035, grain: 0.0006, grainsMax: 256, grainsProc: 512, warp: 0.00075, filter: 0.0039, src: 0.0016, row: 0.00012,
  }),
  fx: Object.freeze({
    dist: 0.0039, flg: 0.0018, phs: 0.0018, cho: 0.0024, dly: 0.0017, cmp: 0.0043, rev: 0.0075, eq: 0.0009, fil: 0.0021,
    hyper: 0.0015, bode: 0.003, conv: 0.026, util: 0.0003, split2: 0.0011, split3: 0.002, splitms: 0.0004,
  }),
  rev: Object.freeze([0.008, 0.005, 0.006, 0.009, 0.007]),   // bench.json node k0–k4 (REV_TYPES2 order)
  // IMPL-9 §3.8: a patch family's modules by type — lane V9b's node column (§12: OS 4, a module's ctl + run alone; the 921
  // masked, the 904A at k 0, the 902 in LIN): a number per module, or per section (an array by moog-core's sec: the 995's three
  // attenuators; the controller's KBD, MIX, the multiples, V→S, S→V and OUT — the converters [C] ≤ the 911's) where one counts
  // only when one of its jacks has a cord
  patch: Object.freeze({ 921: 0.0016, '921a': 0.0005, '921b': 0.0016, 923: 0.0016, '904a': 0.0053, '907a': 0.0075, 911: 0.0006, 902: 0.0009,
    995: Object.freeze([0.0004, 0.0004, 0.0004]), ctl: Object.freeze([0.0004, 0.0012, 0, 0, 0.0002, 0.0002, 0]) }),
  // a loop step's member: ≈ 6–9 ns a sample at OS 4 (spike (a), V9a: 7.5 ns × 192 000 samples a second) on top of its block cost
  loop: 0.00144,
});

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, d) => (Number.isFinite(+x) && x !== null && x !== '' ? +x : d);
const on = x => num(x, 0) >= 0.5;

/* ------------------------------------------------------------------ estimates */
// classic voices sounding for an n-note chord: the model's polyphony, a 'poly' value when the vals carry one, the
// Jupiter-8's Solo assign mode (as = 2: mono); unison modes keep every voice busy (Prophet-5 / OB-Xa un, Jupiter-8 as 1)
function classicVoices(model, vals, n) {
  const c = COST.synth[model], v = isObj(vals) ? vals : {};
  let poly = Number.isFinite(+v.poly) && +v.poly > 0 ? Math.round(+v.poly) : c.poly;
  if (model === 'jupiter8' && Math.round(num(v.as, 0)) === 2) poly = 1;
  if (poly === 1) return 1;
  const uni = (model === 'prophet5' || model === 'obxa') && on(v.un) || model === 'jupiter8' && Math.round(num(v.as, 0)) === 1;
  return uni ? poly : Math.min(poly, n);
}
// grains sounding per granular oscillator: density × length (free-running Hz; a synced density counts as 8)
function grains(p, k, voices, nGran, smpo) {
  const val = (id, re) => { const m = re.exec(core.fmtParam(id, num(p[id], 0))); return m ? +m[1] * (m[2] === 'kHz' ? 1000 : m[2] === 'ms' ? 0.001 : 1) : NaN; };
  const hz = smpo && smpo.dens && smpo.dens.mode ? NaN : val(k + '.dens', /([\d.]+)\s*(kHz|Hz)\b/), sec = val(k + '.glen', /([\d.]+)\s*(ms|s)\b/);
  const S = COST.serum, max = smpo && smpo.dens && Number.isFinite(+smpo.dens.max) ? Math.min(S.grainsMax, +smpo.dens.max) : S.grainsMax;
  const g = Number.isFinite(hz) && Number.isFinite(sec) ? hz * sec : 8;
  return Math.max(1, Math.min(g, max, S.grainsProc / Math.max(1, voices * nGran)));
}
let DEF_SX = null;
// a Serum state's load (OS of its Global page) for an n-note chord, without its own FX
function serumLoad(s, n) {
  if (!isObj(s)) s = DEF_SX || (DEF_SX = core.normalizeSerum(core.defaultSerum()));
  const S = COST.serum, p = isObj(s.p) ? s.p : {}, vo = isObj(s.voicing) ? s.voicing : {}, osc = Array.isArray(s.osc) ? s.osc : [];
  const os = isObj(s.global) && S.os[s.global.os] ? S.os[s.global.os] : 1;
  const voices = vo.mono ? 1 : Math.max(1, Math.min(32, Math.round(num(vo.poly, 8)) || 1, n));
  const ks = ['a', 'b', 'c'].filter(k => on(p[k + '.on'])), nGran = ks.filter(k => (osc['abc'.indexOf(k)] || {}).type === 'gran').length;
  let per = S.voice;
  for (const k of ks) {
    const O = osc['abc'.indexOf(k)] || {}, uni = 1 + Math.round(Math.min(1, Math.max(0, num(p[k + '.uni'], 0))) * 15);
    const g = O.type === 'gran' ? S.gran + S.grain * grains(p, k, voices, nGran, O.smpo) : 0, t = S.osc[O.type] || S.osc.wt;
    per += O.type === 'gran' ? g * (1 + 0.5 * (uni - 1)) : t[0] + t[1] * (uni - 1);
    per += S.warp * uni * ((num(p[k + '.w1'], 0) > 0) + (num(p[k + '.w2'], 0) > 0));
  }
  per += S.filter * (on(p['f.on']) + on(p['f2.on'])) + S.src * (on(p['s.on']) + on(p['n.on']));
  if (Array.isArray(s.matrix)) per += S.row * s.matrix.filter(r => isObj(r) && r.src && r.dst && !r.byp).length;
  return S.base + os * voices * per;
}
// one effect instance (its splitter branches included); bypassed or disabled: nothing
function fxLoad(I) {
  if (!isObj(I) || I.byp || (isObj(I.p) && I.p.on !== undefined && !on(I.p.on))) return 0;
  let x = I.type === 'rev' ? COST.rev[Math.max(0, Math.min(4, Math.round(num(I.p && I.p.type, 0) * 4)))] : num(COST.fx[I.type], 0);
  if (Array.isArray(I.br)) for (const b of I.br) x += rackLoad(b);
  return x;
}
const rackLoad = mods => (Array.isArray(mods) ? mods.reduce((a, I) => a + fxLoad(I), 0) : 0);
// an FX state's effects (v2: its racks; v1 / none: nothing — a v1 rack is the classic default, empty) or a single rack
const fxStateLoad = fx => (isObj(fx) && Array.isArray(fx.racks) ? fx.racks.reduce((a, r) => a + (isObj(r) ? rackLoad(r.mods) : 0), 0) : 0);
const panelLoad = d => COST.panel + (isObj(d.fx) ? fxStateLoad(d.fx) : isObj(d.rack) ? rackLoad(d.rack.mods) : 0);
// a patch (IMPL-9 §3.8): base + every live node — the (module, section) pairs MAIN OUT is reachable from (patch-core liveNodes: the
// engine runs nothing else; a per-section cost: each live section) — + COST.loop per member of a loop step (the per-sample step
// beyond the table's block figures); MAIN OUT silent → idle (COST.off); no record → the Model 15 set as Classic bass (MG.model15:
// the tile's, a new device's)
let M15 = null;
function patchLoad(cs, rec) {
  const P = COST.patch, F = MG.FAMILY, r = isObj(rec) && isObj(rec.mods) && Array.isArray(rec.cords) ? rec : (M15 || (M15 = MG.model15().rec));
  const L = PT.liveNodes(r, F.id);
  if (L === null) return COST.off;
  let x = cs.base + COST.loop * L.loop;
  for (const mid of Object.keys(L.sec)) {
    const m = mid === 'c' ? { t: F.ctl } : r.mods[mid], c = isObj(m) ? P[m.t] : undefined;
    if (Array.isArray(c)) for (const s of L.sec[mid]) x += num(c[s], 0); else x += num(c, 0);
  }
  return x;
}

/** Estimated load of a device, a model id, an effect type id or 'panel', on a device of the given factor. */
export function estimate(x, factor = 1, o = {}) {
  const f = Number.isFinite(+factor) && +factor > 0 ? +factor : 1, n = Math.max(1, Math.round(num(o && o.notes, CHORD)));
  let load = 0;
  if (typeof x === 'string') {
    if (x === 'panel') load = COST.panel;
    else if (x === 'serum') load = serumLoad(null, n);
    else if (COST.synth[x] && COST.synth[x].family === 'patch') load = patchLoad(COST.synth[x], null);
    else if (COST.synth[x]) load = COST.synth[x].base + COST.synth[x].voice * classicVoices(x, null, n);
    else if (x in COST.fx) load = fxLoad({ type: x, p: {} });
  } else if (isObj(x) && x.kind === 'panel') load = panelLoad(x);
  else if (isObj(x) && x.kind === 'synth' && COST.synth[x.model]) { const cs = COST.synth[x.model];
    if (x.on === false) load = COST.off;
    else if (x.model === 'serum') load = serumLoad(isObj(x.vals) ? x.vals.s : null, n) + fxStateLoad(x.fx);
    else if (cs.family === 'patch') load = patchLoad(cs, x.patch);
    else load = COST.synth[x.model].base + COST.synth[x.model].voice * classicVoices(x.model, x.vals, n);
  }
  return load * f;
}
/** A track's estimated load: its devices (v2) or its one instrument and rack (v1). */
export function estimateTrack(t, factor = 1) {
  if (!isObj(t)) return 0;
  if (!isObj(t.dev)) { // v1: a Serum's FX are its own; a classic's rack is its panel
    if (!t.model) return 0;
    const f = Number.isFinite(+factor) && +factor > 0 ? +factor : 1, sx = t.model === 'serum';
    return estimate({ kind: 'synth', model: t.model, vals: t.vals, fx: sx ? t.fx : null }, f) + (sx ? 0 : panelLoad({ fx: t.fx }) * f);
  }
  return Object.values(t.dev).reduce((a, d) => a + (isObj(d) && (d.kind === 'synth' || d.kind === 'panel') ? estimate(d, factor) : 0), 0);
}
/** '~3 %'; under 0.5 %: '<1 %'. */
export function label(load) {
  const pc = num(load, 0) * 100;
  return pc < 0.5 ? '<1 %' : '~' + Math.round(pc) + ' %';
}

/* ------------------------------------------------------------------ soft caps (§9.2) */
const instsOf = t => (!isObj(t) ? [] : isObj(t.dev) ? Object.values(t.dev).filter(d => isObj(d) && d.kind === 'synth')
  : t.model ? [{ kind: 'synth', model: t.model, vals: t.vals, fx: t.fx }] : []);
const devOf = a => (typeof a === 'string' ? { kind: 'synth', model: a, vals: a === 'serum' ? { s: null } : null } : a);
/** {warn, confirm} for adding `adding` (a device or model id) to track t on this device (touch devices only). */
export function softCap(t, adding, { touch = false, factor = 1 } = {}) {
  const r = { warn: null, confirm: null }, a = devOf(adding);
  if (!touch || !isObj(a) || a.kind !== 'synth') return r;
  const ins = instsOf(t), f = Number.isFinite(+factor) && +factor > 0 ? +factor : 1;
  if (ins.length + 1 >= 4) {
    r.warn = `This track now has ${ins.length + 1} instruments (about ${label(estimateTrack(t, f) + estimate(a, f))} of this device’s audio time). ` +
      'More can cause dropouts here: power off the ones you aren’t playing.';
  }
  const heavy = d => d.model === 'serum' && d.on !== false && estimate(d, f) > HEAVY;
  if (heavy(a) && ins.some(heavy)) {
    r.confirm = `This Serum patch is heavy (about ${label(estimate(a, f))} of this device’s audio time) and the track already has a heavy Serum. ` +
      'Two may cause dropouts on this device. Add it anyway?';
  }
  return r;
}

/* ------------------------------------------------------------------ measuring this device (§9.1) */
/** The node reference loads of the measured rows (tests/bench.json "node" rows; c1: see below). */
export const REF = Object.freeze({
  c1: 0.0382,   // no node c-row in bench.json (c1–c6 are iPad rows): bench.html's c1 through measure(), reference machine, 2026-10-18
  j: 0.026,     // bench.json node.rows.j (Convolve, 4 s stereo IR)
  e: 0.083,     // bench.json node.rows.e (16 voices Multisample, unison 1)
});
const SR = 48000;
const chord = (k, base = 48, step = 3) => Array.from({ length: k }, (_, i) => [base + step * i, 0.8]);
const tables = patch => (patch.needs || []).filter(id => !/^(smp|msmp|spec|wtsmp|fsmp|fmsmp):/.test(id))
  .map(id => Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id) || W.factoryTable('factory:Default')), { id }));
// the bench rows (tests/bench-scenarios.mjs / bench.html, built the same way; the tests compare them)
function rowC1() {
  const m = MODELS.find(x => x.id === 'prophet5'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const patch = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 120, drift: 0.5, hiss: 1 });
  return { id: 'c1', kind: 'voice', os: 4, patch, tables: tables(patch), notes: chord(8) };
}
const tone = (n, hz, ph) => Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * hz * j / SR + ph) + 0.1 * Math.sin(2 * Math.PI * 3.01 * hz * j / SR));
const fRoot = n => 440 * Math.pow(2, (n - 69) / 12);
function rowE() {
  const assets = {}, zones = [];
  for (let k = 0; k < 8; k++) for (let v = 0; v < 2; v++) {
    const id = `smp:benchz${k}${v}`, root = 24 + 12 * k;
    assets[id] = playbackEntry(id, { rate: SR, ch: 1, len: SR, L: tone(SR, fRoot(root), v), R: null, root, loop: null }, null, 2);
    zones.push({ lo: k ? root - 6 : 0, hi: k < 7 ? root + 5 : 127, vlo: v ? 80 : 1, vhi: v ? 127 : 79, root, tune: 0, gain: 0, pan: 0, smp: id,
      mode: 'sustain', ls: 12000, le: 36000, off: 0, env: [0, 0.002, 0, 2, 0.3, 0.4], rr: [1, 1], vt: 1 });
  }
  assets['msmp:bench'] = { id: 'msmp:bench', v: 1, kind: 'multi', bytes: 0, zones };
  const s = core.defaultSerum();
  Object.assign(s.p, { 'a.rand': 0, 'b.rand': 0, 'c.rand': 0 });
  s.global.os = 2; s.osc[0].type = 'multi'; s.osc[0].multi = 'msmp:bench'; s.voicing.poly = 16;
  const patch = patchFor('serum', { s: core.normalizeSerum(s) }, core.defaultFx2(), { sr: SR, bpm: 120 });
  return { id: 'e', kind: 'voice', os: 2, patch, tables: tables(patch), notes: chord(16, 36), assets };
}
function rowJ() {
  const fx = core.defaultFx2(), id = core.newInstance(fx, 'conv', { rack: 0 }), I = fx.racks[0].mods.find(x => x.id === id);
  const r = (core.FXP_TAB.conv['2'] || core.FXP_TAB.conv['1']).find(x => x.pid === 'mix');
  I.p.mix = lawNorm(r.law, r.lo, r.hi, 0.5);
  I.sub = { ir: 'ir:bench' };
  const fxp = core.compileFx(fx, { bpm: 120, rate: SR }), fxt = core.compileFxT(fx), aid = fxp.needs[0];
  const n = 4 * SR, rnd = W.mulberry32(W.fnv1a32('bench-ir')), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const e = Math.exp(-i / (0.6 * SR)); L[i] = (2 * rnd() - 1) * e; R[i] = (2 * rnd() - 1) * e; }
  const ir = irEntry(aid, { rate: SR, ch: 2, len: n, L, R, hash: 'bench-ir' }, SR, convShapeOf(I.p));
  return { id: 'j', kind: 'fx', fxp, fxt, assets: { [aid]: ir } };
}
/** The rows measureDevice renders (structured-clonable). */
export function deviceRows() { return [rowC1(), rowJ(), rowE()]; }

/** factor = the median over the measured rows of load / REF (rounded to 0.001, within [0.05, 20]). */
export function factorOf(loads) {
  const ratios = {};
  for (const id of Object.keys(REF)) if (isObj(loads) && Number.isFinite(+loads[id]) && +loads[id] > 0) ratios[id] = +loads[id] / REF[id];
  const v = Object.values(ratios).sort((a, b) => a - b);
  if (!v.length) throw new Error('Measuring gave no usable result');
  const m = v.length & 1 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { factor: Math.round(Math.min(20, Math.max(0.05, m)) * 1000) / 1000, ratios };
}
/** null when this browser can measure, else why not. */
export function supported(g = globalThis) {
  if (typeof g.Worker !== 'function' || typeof g.Blob !== 'function' || !g.URL || typeof g.URL.createObjectURL !== 'function') {
    return 'Measuring needs Web Workers, which this browser does not offer';
  }
  const aw = typeof g.AudioWorkletNode === 'function' || typeof g.OfflineAudioContext === 'function' && 'audioWorklet' in g.OfflineAudioContext.prototype;
  return aw ? null : 'Measuring needs AudioWorklet, which this browser does not offer';
}
const abortErr = () => { const e = new Error('Measuring was cancelled'); e.name = 'AbortError'; return e; };

// The Worker's body (a classic worker made from a Blob: no imports; stringified, so it may use nothing outside itself).
// Scope set-up as smprender.js: the AudioWorklet stand-ins, then the §0.3 DSP scripts and engine.js from `base` with the
// page's `?v=` (importScripts needs absolute URLs in a Blob worker). Protocol:
//   in  {t: 'run', base, sfx, rows: deviceRows(), runs, seconds}
//   out {t: 'progress', done, total} after each timed run · {t: 'done', loads: {id: median load}} · {t: 'error', err}
// A row: 0.25 s warm-up, then `runs` × `seconds` timed (fraction of real time); a silent run is an error (bench rule).
export function workerMain(G) {
  'use strict';
  const DSP = ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js', 'sx-seq.js',
    'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js', 'dr-808.js', 'dr-seq.js', 'mod-core.js'];
  const SR = 48000, Q = 128;
  let Proc = null;
  function load(base, sfx) {
    if (Proc) return;
    G.sampleRate = SR; G.currentFrame = 0;
    G.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
    G.registerProcessor = (name, cls) => { if (name === 'synth-engine') Proc = cls; };
    for (const f of DSP.concat('engine.js')) G.importScripts(base + f + sfx);
    if (!Proc) throw new Error('engine.js registered no processor');
  }
  function noiseOf() { // wt.js fnv1a32('bench-noise') → mulberry32: the bench FX rows' input
    let h = 0x811c9dc5;
    for (const c of 'bench-noise') { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
    let a = h >>> 0;
    const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return Float64Array.from({ length: 4096 }, () => 0.25 * (2 * r() - 1));
  }
  function prep(row) {
    if (row.assets) for (const id of Object.keys(row.assets)) G.SxBase.storeAsset(id, row.assets[id]);
    let pk = 0;
    const peak = (L, n) => { for (let i = 0; i < n; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > pk) pk = a; } };
    const runPeak = () => { const r = pk; pk = 0; return r; };
    if (row.kind === 'voice') {
      const p = new Proc({ processorOptions: { os: row.os || 2, hostOS: 4, offline: true } });
      p.msg({ t: 'patch', p: row.patch });
      for (const e of row.tables || []) p.msg(e);
      for (const [n, v] of row.notes) p.msg({ t: 'on', n, v });
      const L = new Float32Array(Q), R = new Float32Array(Q), out = [[L, R]];
      return { q() { p.process([], out); G.currentFrame += Q; peak(L, Q); }, runPeak };
    }
    const rack = new G.FXDSP.FXRack(SR), noise = noiseOf(), L = new Float64Array(Q), R = new Float64Array(Q);
    rack.set(row.fxp, row.fxt);
    if (typeof rack.assets === 'function') rack.assets();
    let pos = 0;
    return { q() {
      for (let i = 0; i < Q; i++) { L[i] = noise[(pos + i) & 4095]; R[i] = noise[(pos + 2048 + i) & 4095]; }
      pos = (pos + Q) & 4095; rack.process(L, R, Q); peak(L, Q);
    }, runPeak };
  }
  G.onmessage = ev => {
    const r = (ev && ev.data) || {};
    if (r.t !== 'run') return;
    try {
      load(String(r.base || ''), String(r.sfx || ''));
      const rows = Array.isArray(r.rows) ? r.rows : [], runs = Math.max(1, r.runs | 0 || 3), sec = +r.seconds > 0 ? +r.seconds : 1;
      const loads = {}, total = rows.length * runs, nq = Math.max(1, Math.round(sec * SR / Q));
      let done = 0;
      for (const row of rows) {
        const X = prep(row), t = [];
        for (let k = 0; k < Math.round(0.25 * SR / Q); k++) X.q();
        X.runPeak();
        for (let k = 0; k < runs; k++) {
          const t0 = G.performance.now();
          for (let i = 0; i < nq; i++) X.q();
          t.push((G.performance.now() - t0) / 1000 / (nq * Q / SR));
          if (!(X.runPeak() > 1e-4)) throw new Error('row ' + row.id + ' rendered silence');
          G.postMessage({ t: 'progress', done: ++done, total });
        }
        t.sort((a, b) => a - b);
        loads[row.id] = t[t.length >> 1];
        if (row.assets) for (const id of Object.keys(row.assets)) G.SxBase.dropAsset(id);
      }
      G.postMessage({ t: 'done', loads });
    } catch (err) {
      G.postMessage({ t: 'error', err: String((err && err.message) || err) });
    }
  };
}

/** A runner: (req, {progress, signal}) → Promise<loads>, rendering req in a fresh Worker made from workerMain. */
export function workerRunner(o = {}) {
  const g = o.global || globalThis;
  return (req, { progress, signal } = {}) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortErr()); return; }
    let url = null, w = null, over = false;
    const end = (fn, x) => {
      if (over) return;
      over = true;
      try { if (w) w.terminate(); } catch { /* gone */ }
      try { if (url) g.URL.revokeObjectURL(url); } catch { /* revoked */ }
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(x);
    };
    const onAbort = () => end(reject, abortErr());
    try {
      url = g.URL.createObjectURL(new g.Blob(['(' + String(workerMain) + ')(self);'], { type: 'text/javascript' }));
      w = new g.Worker(url);
    } catch (err) { end(reject, new Error('Measuring could not start a Worker: ' + ((err && err.message) || err))); return; }
    if (signal) signal.addEventListener('abort', onAbort);
    w.onmessage = ev => {
      const m = (ev && ev.data) || {};
      if (m.t === 'progress') { if (typeof progress === 'function') progress(m.done / Math.max(1, m.total)); } else if (m.t === 'done') end(resolve, m.loads || {});
      else if (m.t === 'error') end(reject, new Error('Measuring failed: ' + m.err));
    };
    w.onerror = ev => { if (ev && typeof ev.preventDefault === 'function') ev.preventDefault(); end(reject, new Error('Measuring failed: the audio engine did not load in a Worker' + (ev && ev.message ? ' (' + ev.message + ')' : ''))); };
    w.postMessage(req);
  });
}

// where the DSP scripts are (this module's directory) and the ?v= they carry (this module's own)
const HERE = (() => { try { const u = new URL(import.meta.url); return { base: new URL('./', u).href, sfx: u.search }; } catch { return { base: '', sfx: '' }; } })();
/** Measures this device → Promise<factor> (see the header). */
export async function measureDevice({ progress, signal, runs = 3, seconds = 1, runner, rows } = {}) {
  const prog = x => { if (typeof progress === 'function') progress(Math.min(1, Math.max(0, x))); };
  const why = runner ? null : supported();
  if (why) throw new Error(why);
  if (signal && signal.aborted) throw abortErr();
  const run = runner || workerRunner();
  prog(0);
  await null;
  const R = rows || deviceRows();   // (~0.1 s of main thread: the 4 s IR and the 16 zones)
  if (signal && signal.aborted) throw abortErr();
  prog(0.1);
  const loads = await run({ t: 'run', base: HERE.base, sfx: HERE.sfx, rows: R, runs, seconds }, { progress: x => prog(0.1 + 0.9 * x), signal });
  const { factor } = factorOf(loads);
  prog(1);
  return factor;
}
