// smpgen.js — factory content generators (owner S1; SPEC-serum2 §10.1–§10.4, §11.12). ES module, pure (imports
// smp.js and wt.js only); node-, worker- and main-thread-importable. Everything is original and deterministic: each
// generator is seeded with mulberry32(fnv1a32(<asset id>)) at 48 kHz (§0.4, §10); render-farm content comes from this
// project's own engines (smprender.js, §10.1). Nothing here is ever committed as audio: assets are generated on the
// user's device on first use and cached (lead sign-off on §0.8 item 9).
//
// Extra exports (IMPL): multiRoots(lo, hi, step) (the §10.1 root rule), rngFor(id), factoryKind(id), byId(id),
// zoneId(multiId, root, vel) / parseZoneId(id) (factory zone-sample ids `fmsmp:<Name>#<root>.<vel>`), multiBytes(res),
// keptVels(plan, renders), MULTI_BUDGET, IR_FOLDERS, SR; the generator primitives' Float64 cores are internal.
//
// Recipes (IMPL details where §10 is silent; normative for this project, GEN_VER covers them):
// - every procedural sample is normalised to −1 dBFS peak; IRs to peak 1 (they are energy-normalised again by
//   smp.irPrepare); a stereo result whose channels are bit-identical is stored mono (ch 1).
// - glottal: Rosenberg flow (opening 2/3, closing 1/3 of the open quotient) differentiated (flow derivative), vibrato
//   f0·2^(ct/1200·sin(2π·hz·t + φ)); formants: three parallel 0-dB-peak band-passes (gains 1, 0.7, 0.5, Q = F/BW),
//   coefficients every 16 samples.
// - Vowel Phrase: five 0.64 s segments a e i o u, each starting with a 0.1 s linear formant glide from the previous
//   vowel. Choir Ahh: vibrato ±12 ct, seeded rates 4.8–5.6 Hz, 0.3 s fade in/out, loop snapped to upward zero crossings
//   with a LOOP_XF crossfade baked in (smp.bakeLoop: six voices with independent vibrato do not line up at the wrap).
// - every factory loop that is not whole-length (Choir Ahh, Pad Chord, the sustain zones of FACTORY_MULTI) gets the
//   LOOP_XF (0.1 s) crossfade baked into both sides of its end, so each channel continues seamlessly at the wrap.
// - Pad Chord: loop 2–3.9 s (§10.2 says 2–5 s, which spans the chord's 4 s note-off: the loop would decay to silence
//   and jump back; table correction raised to the lead).
// - Whisper Text: syllable = (fricative 40 ms, probability 0.6) + vowel noise burst 90 ms + gap 30–120 ms, 8 ms fades.
// - Pluck Guitar: loop = delay line + averaging LP (½ sample) + first-order allpass (fraction) × 0.996; 1 ms fade-in
//   (the excitation starts on a noise sample: no step at the onset, GEN_VER 3).
// - FM Drone: 2nd-order 20 Hz high-pass (GEN_VER 3) — the 1:1, 2:1 and 3:1 ratios of the sweep put a sideband at 0 Hz.
//   Impact: the brown-noise rumble is high-passed twice at 30 Hz (4th order) before the decay and the 45 Hz thump
//   (sub-audio drift, GEN_VER 3), 0.5 ms fade-in.
// - Glass Bell: the stated decays are T60 times; Granular Bed: clusters of 5 partials, seeded pans.
// - room IRs: images with |nx| + |ny| + |nz| ≤ 3 (order 0 = direct), x_n = n even ? n·L + s : (n + 1)·L − s per axis;
//   each reflection is a one-pole LP kernel (air LP 20 kHz → 8 kHz over 0–100 m, exponential) with gain
//   √(1 − α)^order / distance; the late tail (velvet noise, 2000/s, independent L/R, split at 250 Hz / 4 kHz with
//   complementary bands decaying with RT60 × (1.2, 1, high)) fades in with a raised cosine over [0.5, 1.5]·t_mix
//   (t_mix = √V ms) while the early part fades out, its level matched to the early RMS in that window; length =
//   min(10 s, 1.25·RT60 + 0.05 s), 5 % cosine fade-out. The stated RT60 is the mid-band one (500 Hz – 2 kHz).
// - Canyon: echoes at seeded times in [0.12, 0.9] s, gains 0.8·0.82^k × U[0.7, 1], LP-dulled, alternating sides, plus an
//   8 s velvet tail with RT60 8 s; Endless Plate: velvet 6000/s, RT60 9 s (high × 0.8), no early part.
// - cab / eq / band IRs: magnitude design on a 4096-point grid → minimum phase (real cepstrum, FFT 4096) → 2048 samples
//   with a half-Hann fade over the last 512; peak Q default 1, notches Q 2; R channel of cabs = an off-axis variant
//   (LP × 0.92, presence −1 dB); Radio, Telephone, the eq IRs, Formant A and Pitched Comb C are mono (FACTORY_IRS ch).
// - Formant A: three decaying resonators (BW = F/10); comb IRs: impulses every period with gain g^k (fractional
//   positions linearly interpolated); Comb Shimmer R uses 7.3 ms; Shepard Tail: velvet tail (RT60 3 s, 4 s) through six
//   octave-spaced band-passes rising one octave per 1.5 s with a Gaussian weight around 800 Hz; Spring: three trains
//   (25/31/37 ms; R × 1.03) decaying with RT60 2.5 s through 120 allpasses a = 0.6 (R a = 0.62), 3 s.
// - render plans: zone renders `<multi id>#<root>.<vel>` (events [[0, on, root, vel], [gate, off]], frames = gate + tail);
//   Drum Loop / Break: one render per Serum preset, hits at note 60 with gates of half a step; Arp Loop: the preset's
//   own sixteenths over the held chord 57 60 64 67 for 2 bars; loop samples render one extra second whose tail is
//   folded onto the start (seamless loops); marks = the steps that start a hit (Drum Loop, Break). The farm delivers
//   each event at its frame rounded up to 4 (smprender), so hits sit on the step grid.
// - multiFromRenders: trims after the instrument gain — leading silence below −70 dBFS (1 ms kept) and, GEN_VER 3,
//   trailing material below −60 dBFS (a model's own noise floor — Juno chorus, ≈ −66 dBFS after the gain — kept the
//   renders running to their frame cap), then a 20 ms raised-cosine fade-out ends every zone (renders the cap stopped
//   while still sounding, CS-80 Brass, no longer end in a step); sustain loops by smp.loopSearch over [0.45, 0.95]·gate of the
//   raw render (or the render's precomputed `loop` {ls, le} from smpwork op 'loop'), mapped through the trim, then
//   the LOOP_XF crossfade baked in; the
//   §10.1 stereo rule halves the velocity layers keeping the extremes (keptVels; 2 layers → the loudest one). Every
//   instrument of the table renders within its budget (tests/smpgen.test.mjs: 76 MB in total at GEN_VER 3, none expected mono
//   renders in stereo), so the rule and assets.js's last-resort mono fold are safety nets.
import { LIMITS, toF32, mono, loopSearch, bakeLoop, fft } from './smp.js?v=6';
import { mulberry32, fnv1a32 } from './wt.js?v=6';

/** Generator version: part of every cache key (`gen:<asset id>@<GEN_VER>`, §9.7); bump when any output changes. */
export const GEN_VER = 3;
/** IMPL: crossfade (s) baked into every factory loop (smp.bakeLoop) on both sides of the loop end. */
export const LOOP_XF = 0.1;
/** IMPL: fade-out (s) at the end of every factory multisample zone (multiFromRenders). */
export const END_FADE = 0.02;
/** Rate of every generated asset. */
export const SR = 48000;

const deepFreeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };
const TAU = 2 * Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sec = s => Math.round(s * SR);
const dBg = db => Math.pow(10, db / 20);
const t60 = (t, T) => Math.pow(10, -3 * t / T);

/** The seeded generator of an asset id (§10): mulberry32(fnv1a32(id)). */
export const rngFor = id => mulberry32(fnv1a32(String(id)));

/**
 * §10.1 roots: from `lo` to `hi`, step 6 inside MIDI 36–84 and step 12 outside it (`step` given: that step throughout).
 * 24–96 → 24, 36, 42, …, 84, 96 (11); 24–60 → 6; 36–96 → 10; 48–96 → 8; 36–84 → 9.
 */
export function multiRoots(lo, hi, step) {
  const out = [];
  for (let r = lo; r <= hi; r += step || (r >= 36 && r < 84 ? 6 : 12)) out.push(r);
  return out;
}

// §10.1 table: [name, model, preset, lo, hi, step, velocities, gate s, tail ≤ s, loop, channels expected, MB ≤]
const MULTI_DEF = [
  ['Juno Pad', 'juno60', 'Juno Pad', 24, 96, 0, [100], 1.5, 1.5, 'sustain', 'st', 12.7],
  ['Juno Sub Bass', 'juno60', 'Sub Bass', 24, 60, 0, [100], 1.2, 0.5, 'sustain', 'st', 3.9],
  ['Square Organ', 'juno60', 'Square Organ', 36, 96, 0, [100], 1.5, 0.3, 'sustain', 'st', 6.9],
  ['Mini Lead', 'minimoog', 'Classic Lead', 36, 84, 0, [80, 127], 1.5, 0.6, 'sustain', 'mo', 7.3],
  ['Mini Bass', 'minimoog', 'Fat Bass', 24, 60, 0, [80, 127], 1.2, 0.5, 'sustain', 'mo', 3.9],
  ['DX Tine Piano', 'dx7', 'Tine E.Piano', 24, 96, 0, [50, 110], 2, 1, 'oneshot', 'mo', 12.7],
  ['DX Bass', 'dx7', 'Solid Bass', 24, 60, 0, [64, 127], 1.5, 0.5, 'oneshot', 'mo', 4.6],
  ['DX Marimba', 'dx7', 'Glass Marimba', 36, 96, 0, [100], 1.5, 0.5, 'oneshot', 'mo', 3.8],
  ['DX Bells', 'dx7', 'Tubular Bells', 36, 96, 12, [100], 4, 3, 'oneshot', 'mo', 8.1],
  ['Solina Strings', 'solina', 'Full Strings', 36, 84, 0, [100], 1.5, 2, 'sustain', 'st', 12.1],
  ['Prophet Brass', 'prophet5', 'Brass', 36, 84, 0, [64, 127], 1.5, 1, 'sustain', 'mo', 8.6],
  ['Prophet Clav', 'prophet5', 'Clav Pluck', 36, 84, 0, [64, 127], 1, 0.4, 'oneshot', 'mo', 4.8],
  ['OB Strings', 'obxa', 'Synth Strings', 36, 84, 0, [100], 1.5, 2, 'sustain', 'st', 12.1],
  ['Jupiter Pad', 'jupiter8', 'Lush Pad', 36, 84, 0, [100], 1.5, 3, 'sustain', 'st', 15.6],
  ['CS-80 Brass', 'cs80', 'Blade Brass', 36, 84, 0, [64, 127], 1.5, 0.8, 'sustain', 'st', 15.9],
  ['Acid Pluck', 'tb303', 'Squelch', 24, 60, 0, [100], 0.4, 0.3, 'oneshot', 'mo', 0.8],
  ['ARP Ring Bells', 'arp2600', 'Ring Bells', 48, 96, 0, [100], 2, 2, 'oneshot', 'mo', 6.1],
  ['Modular Harpsichord', 'modular', 'Bach Harpsichord', 36, 84, 0, [100], 1.5, 1, 'oneshot', 'mo', 4.3],
];
/**
 * §10.1 factory multisamples rendered from this project's models: {id: 'fmsmp:<name>', name, cat: model id, model,
 * preset (models.js preset name), roots, vels, gate, tail (s), loop: 'sustain' | 'oneshot', ch: 'st' | 'mo' (expected),
 * mb (worst-case MB of raw Float32 PCM)}. Every zone has vt = 1 (§10.1).
 */
export const FACTORY_MULTI = deepFreeze(MULTI_DEF.map(([name, model, preset, lo, hi, step, vels, gate, tail, loop, ch, mb]) => ({
  id: 'fmsmp:' + name, name, cat: model, model, preset, roots: multiRoots(lo, hi, step), vels: vels.slice(), gate, tail, loop, ch, mb,
})));
/** §10.1 memory budget (bytes of raw Float32 PCM): per instrument and for the whole FACTORY_MULTI set. */
export const MULTI_BUDGET = deepFreeze({ instrument: 16e6, total: 150e6 });

// §10.2 table: [name, category, seconds, root, source ('proc' = procedural generate(), 'farm' = render farm), extra]
const SAMPLE_DEF = [
  ['Vowel Phrase', 'Vocal', 3.2, 48, 'proc', {}],
  ['Choir Ahh', 'Vocal', 4, 57, 'proc', { loop: [1, 3.5] }],
  ['Whisper Text', 'Vocal', 3, 60, 'proc', {}],
  ['Pluck Guitar', 'Tonal', 3, 45, 'proc', {}],
  ['Glass Bell', 'Tonal', 4, 72, 'proc', {}],
  ['Piano Phrase', 'Tonal', 4, 60, 'farm', { model: 'dx7', preset: 'Tine E.Piano' }],
  ['Pad Chord', 'Tonal', 6, 60, 'farm', { model: 'jupiter8', preset: 'Lush Pad', loop: [2, 3.9] }],
  ['Drum Loop 120', 'Loops', 4, 60, 'farm', { model: 'serum', presets: ['Punch Kick', 'Noise Snare', 'Tight Hat', 'Electro Clap'], bpm: 120, bars: 2, stereo: 1 }],
  ['Break 96', 'Loops', 2.5, 60, 'farm', { model: 'serum', presets: ['Punch Kick', 'Noise Snare', 'Tight Hat'], bpm: 96, bars: 1, stereo: 1 }],
  ['Arp Loop 128', 'Loops', 3.75, 60, 'farm', { model: 'serum', presets: ['Octave Runner'], bpm: 128, bars: 2, stereo: 1 }],
  ['Wind Field', 'Textures', 8, 60, 'proc', { stereo: 1 }],
  ['Metal Scrape', 'Textures', 6, 60, 'proc', { stereo: 1 }],
  ['FM Drone', 'Textures', 10, 57, 'proc', { stereo: 1 }],
  ['Granular Bed', 'Textures', 12, 60, 'proc', { stereo: 1 }],
  ['Tape Melody', 'Tonal', 5, 60, 'proc', {}],
  ['Impact', 'FX', 3, 60, 'proc', {}],
  ['Riser 4 bar', 'FX', 8, 60, 'proc', {}],
];
/**
 * §10.2 factory samples (Sample / Granular / Spectral menus): {id: 'fsmp:<name>', name, cat, seconds, root, src:
 * 'proc' | 'farm', loop: [start s, end s] | null, stereo (1 = the generated record has two channels; render-farm items
 * as their renders come out, tests/smpgen.test.mjs), granFirst (§10.4: Textures, Vocal and Loops are listed first in
 * the Granular menu), and for render-farm items model, preset(s), bpm, bars}.
 */
export const FACTORY_SAMPLES = deepFreeze(SAMPLE_DEF.map(([name, cat, seconds, root, src, x]) => Object.assign({
  id: 'fsmp:' + name, name, cat, seconds, root, src, loop: x.loop ? x.loop.slice() : null, stereo: x.stereo ? 1 : 0,
  granFirst: cat === 'Textures' || cat === 'Vocal' || cat === 'Loops' ? 1 : 0,
}, src === 'farm' ? { model: x.model, preset: x.preset || null, presets: x.presets ? x.presets.slice() : null, bpm: x.bpm || 0, bars: x.bars || 0 } : {})));

// §10.3 table: [folder, name, generator, parameters] (rooms: dim [L, W, H] m, alpha, rt60 s, high = HF RT60 factor
// (default 0.6); cabs: hp, lp Hz, peaks [Hz, Q | null, dB], notch [Hz, dB], mono)
const IR_DEF = [
  ['Short', 'Small Room', 'room', { dim: [4, 3, 2.5], alpha: 0.3, rt60: 0.3 }],
  ['Short', 'Studio Booth', 'room', { dim: [2.5, 2, 2.2], alpha: 0.5, rt60: 0.15 }],
  ['Short', 'Bathroom', 'room', { dim: [3, 2, 2.4], alpha: 0.05, rt60: 0.8, high: 1 }],
  ['Medium', 'Chamber', 'room', { dim: [8, 6, 4], alpha: 0.15, rt60: 1.2 }],
  ['Medium', 'Club', 'room', { dim: [12, 10, 4], alpha: 0.25, rt60: 0.9, high: 0.4 }],
  ['Medium', 'Wood Room', 'room', { dim: [6, 5, 3], alpha: 0.2, rt60: 0.7 }],
  ['Long', 'Concert Hall', 'room', { dim: [40, 25, 18], alpha: 0.12, rt60: 2.4 }],
  ['Long', 'Church', 'room', { dim: [30, 15, 20], alpha: 0.06, rt60: 3.8 }],
  ['Long', 'Parking Garage', 'room', { dim: [50, 30, 3], alpha: 0.04, rt60: 2.8, high: 0.9 }],
  ['Massive', 'Cathedral', 'room', { dim: [60, 30, 35], alpha: 0.05, rt60: 6 }],
  ['Massive', 'Canyon', 'echoes', { n: 8, from: 0.12, to: 0.9, tail: 8 }],
  ['Massive', 'Endless Plate', 'velvet', { sec: 9, density: 6000, early: 0 }],
  ['Cab', '1x12 Open', 'cab', { hp: 80, lp: 5200, peaks: [[110, 1.2, 4], [2600, null, 3]] }],
  ['Cab', '2x12 Closed', 'cab', { hp: 90, lp: 4800, peaks: [[120, null, 6], [2200, null, 4]], notch: [4500, -8] }],
  ['Cab', '4x12 Vintage', 'cab', { hp: 70, lp: 4200, peaks: [[100, null, 5], [1800, null, 5]] }],
  ['Cab', 'Bass 1x15', 'cab', { hp: 40, lp: 3000, peaks: [[60, null, 3]] }],
  ['Cab', 'Tiny Speaker', 'cab', { hp: 300, lp: 6000, peaks: [[900, null, 6]] }],
  ['Cab', 'Radio', 'cab', { hp: 450, lp: 3200, peaks: [[1200, null, 4]], mono: 1 }],
  ['Coloration', 'Vintage EQ', 'eq', { lowShelf: [100, 3], bell: [3000, -2], highShelf: [12000, 2], minph: 1 }],
  ['Coloration', 'Tape Head', 'eq', { bell: [60, 3], highShelf: [15000, -6] }],
  ['Coloration', 'Telephone', 'band', { lo: 300, hi: 3400 }],
  ['Coloration', 'Formant A', 'formant', { vowel: 'a' }],
  ['Coloration', 'Comb Shimmer', 'comb', { ms: 7, g: 0.7, sec: 0.4 }],
  ['Weird', 'Reverse Swell', 'reverse', { of: 'fir:Long/Concert Hall', sec: 2.4 }],
  ['Weird', 'Gated Room', 'gate', { of: 'fir:Medium/Chamber', ms: 250, fadeMs: 20 }],
  ['Weird', 'Pitched Comb C', 'comb', { hz: 261.63, g: 0.97, sec: 1.5 }],
  ['Weird', 'Shepard Tail', 'shepard', {}],
  ['Weird', 'Spring', 'spring', { rt60: 2.5, spacing: [25, 31, 37], stages: 120, a: 0.6 }],
  ['Weird', 'Granular Smear', 'smear', { of: 'fir:Long/Church', grains: 40, st: 7 }],
];
// channels a generator produces (IMPL): the linear colorations (eq, band-pass, formant resonators, a single-pitch comb)
// and the cabs marked mono are one channel — the same filter on both sides of a stereo input; the rest are stereo
const irChOf = (gen, p) => (gen === 'eq' || gen === 'band' || gen === 'formant' || (gen === 'comb' && p.hz) || (gen === 'cab' && p.mono) ? 1 : 2);
/**
 * §10.3 factory impulse responses (48 kHz; Convolve folders): {id: 'fir:<Folder>/<Name>', folder, name, gen, p, ch}
 * (ch = the channels the generator produces: 1 for Radio, Vintage EQ, Tape Head, Telephone, Formant A and Pitched
 * Comb C, else 2).
 */
export const FACTORY_IRS = deepFreeze(IR_DEF.map(([folder, name, gen, p]) => ({ id: 'fir:' + folder + '/' + name, folder, name, gen, p, ch: irChOf(gen, p) })));
/** Convolve folder order (menus). */
export const IR_FOLDERS = deepFreeze(['Short', 'Medium', 'Long', 'Massive', 'Cab', 'Coloration', 'Weird']);

const BY_ID = new Map([].concat(FACTORY_MULTI, FACTORY_SAMPLES, FACTORY_IRS).map(x => [x.id, x]));
/** The catalogue entry of a factory id (FACTORY_MULTI / FACTORY_SAMPLES / FACTORY_IRS), or null. */
export const byId = id => BY_ID.get(id) || null;
/** 'multi' | 'sample' | 'ir' for a catalogue id, '' otherwise. */
export function factoryKind(id) {
  const x = BY_ID.get(id);
  return !x ? '' : id.startsWith('fmsmp:') ? 'multi' : id.startsWith('fsmp:') ? 'sample' : 'ir';
}
/** Factory zone-sample id of a multisample render: `fmsmp:<Name>#<root>.<vel>` (IMPL, §9.1 extension). */
export const zoneId = (multiId, root, vel) => multiId + '#' + root + '.' + vel;
/** {multi, root, vel} of a factory zone-sample id, or null. */
export function parseZoneId(id) {
  const m = /^(fmsmp:[^#]+)#(\d+)\.(\d+)$/.exec(String(id));
  return m && BY_ID.has(m[1]) ? { multi: m[1], root: +m[2], vel: +m[3] } : null;
}

/* ================================================================================== DSP helpers (generation only) */

class BQ { // RBJ biquad (direct form I), coefficients settable at any time
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, fc, Q, gainDb, rate = SR) {
    const w = TAU * clamp(fc, 1, rate * 0.49) / rate, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q), A = Math.pow(10, (gainDb || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else if (type === 'ls' || type === 'hs') {
      const s = 2 * Math.sqrt(A) * al, sg = type === 'ls' ? 1 : -1;
      b0 = A * ((A + 1) - sg * (A - 1) * cw + s); b1 = sg * 2 * A * ((A - 1) - sg * (A + 1) * cw); b2 = A * ((A + 1) - sg * (A - 1) * cw - s);
      a0 = (A + 1) + sg * (A - 1) * cw + s; a1 = -sg * 2 * ((A - 1) + sg * (A + 1) * cw); a2 = (A + 1) + sg * (A - 1) * cw - s;
    } else throw new Error('BQ: type ' + type);
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = Math.abs(y) < 1e-30 ? 0 : y;
    return this.y1;
  }
  // |H(e^{jw})| at f Hz
  mag(f, rate = SR) {
    const w = TAU * f / rate, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
}
const filt = (x, type, fc, Q, g) => { const q = new BQ().set(type, fc, Q, g); for (let i = 0; i < x.length; i++) x[i] = q.run(x[i]); return x; };
const sweep = (x, type, fcAt, Q) => { const q = new BQ(); for (let i = 0; i < x.length; i++) { if ((i & 15) === 0) q.set(type, fcAt(i), Q); x[i] = q.run(x[i]); } return x; };
const white = r => r() * 2 - 1;
const whiteN = (n, r) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; };
function brownN(n, r, pole) { const o = new Float64Array(n); let y = 0, m = 0; for (let i = 0; i < n; i++) { y = pole * y + white(r) * 0.05; o[i] = y; m += y; } m /= n || 1; for (let i = 0; i < n; i++) o[i] -= m; return o; }
const rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); };
const peakAbs = x => { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };
// slow smoothed random walk in [lo, hi], one control value every `step` samples, cosine-interpolated
function walk(n, r, step, lo, hi, speed) {
  const K = Math.ceil(n / step) + 2, pts = new Float64Array(K);
  let v = r();
  for (let k = 0; k < K; k++) { v = clamp(v + (r() - 0.5) * speed, 0, 1); pts[k] = v; }
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / step, k = Math.floor(p), t = 0.5 - 0.5 * Math.cos(Math.PI * (p - k));
    o[i] = lo + (hi - lo) * (pts[k] + (pts[k + 1] - pts[k]) * t);
  }
  return o;
}
function fadeEdges(x, a, b) { // raised-cosine fade-in over a samples, fade-out over b samples
  const n = x.length;
  for (let i = 0; i < a && i < n; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / a);
  for (let i = 0; i < b && i < n; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / b);
  return x;
}
// additive band-limited saw: Σ_k sin(kφ)/k for k·f < fmax
function sawAt(ph, f, fmax) { let s = 0; const K = Math.max(1, Math.floor(fmax / Math.max(1, f))); for (let k = 1; k <= K; k++) s += Math.sin(k * ph) / k; return s * (2 / Math.PI); }

// result record (sample) from Float64 channels: normalised to −1 dBFS, mono when the channels are identical
function sampleRec(name, chans, root, extra) {
  const pk = Math.max(...chans.map(peakAbs)), g = pk > 0 ? dBg(-1) / pk : 1;
  const L = Float32Array.from(chans[0], v => v * g), R0 = chans[1] ? Float32Array.from(chans[1], v => v * g) : null;
  const R = R0 && !sameBits(L, R0) ? R0 : null;
  return Object.assign({ kind: 'smp', name, rate: SR, ch: R ? 2 : 1, len: L.length, L, R, root, loop: null, odf: null, peak: Math.max(peakAbs(L), R ? peakAbs(R) : 0), folder: '' }, extra || {});
}
function irRec(name, chans) {
  const pk = Math.max(...chans.map(peakAbs)), g = pk > 0 ? 1 / pk : 1;
  const L = Float32Array.from(chans[0], v => v * g), R0 = chans[1] ? Float32Array.from(chans[1], v => v * g) : null;
  const R = R0 && !sameBits(L, R0) ? R0 : null;
  return { kind: 'ir', name, rate: SR, ch: R ? 2 : 1, len: L.length, L, R, peak: Math.max(peakAbs(L), R ? peakAbs(R) : 0) };
}
function sameBits(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
// nearest upward zero crossing of x to position p (searching ±range samples), else p
function zeroNear(x, p, range) {
  let best = p, bd = Infinity;
  for (let i = Math.max(1, p - range); i <= Math.min(x.length - 1, p + range); i++) {
    if (x[i - 1] < 0 && x[i] >= 0 && Math.abs(i - p) < bd) { bd = Math.abs(i - p); best = i; }
  }
  return best;
}

/* ================================================================================== primitives (§10.2, §10.3) */

const FORMANTS = { // Phase-1 §3.5 tables I, II, III (F1, F2, F3 Hz) for vowels a e i o u
  I: [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]],
  II: [[850, 1220, 2810], [610, 2330, 2990], [310, 2790, 3310], [590, 920, 2710], [370, 950, 2670]],
  III: [[1030, 1370, 3170], [690, 2610, 3570], [370, 3200, 3730], [680, 1060, 3180], [430, 1170, 3260]],
};
const VOWEL = { a: 0, e: 1, i: 2, o: 3, u: 4 };
const FORMANT_G = [1, 0.7, 0.5];

function glottal64(o) {
  const rate = o.rate > 0 ? o.rate : SR, n = o.n != null ? o.n : Math.round((o.sec || 1) * rate), f0 = o.f0 > 0 ? o.f0 : 130.81;
  const oq = clamp(o.oq > 0 ? o.oq : 0.6, 0.1, 1), tp = oq * 2 / 3, tn = oq / 3, vhz = o.vibHz || 0, vct = o.vibCt || 0, vph = o.vibPh || 0;
  const out = new Float64Array(n);
  let ph = o.phase || 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate, f = f0 * (vct ? Math.pow(2, vct / 1200 * Math.sin(TAU * vhz * t + vph)) : 1);
    ph += f / rate; ph -= Math.floor(ph);
    const g = ph < tp ? 0.5 - 0.5 * Math.cos(Math.PI * ph / tp) : ph < tp + tn ? Math.cos(Math.PI * (ph - tp) / (2 * tn)) : 0;
    out[i] = (g - prev) * rate / (f0 * 4); prev = g; // flow derivative, roughly unit-scaled
  }
  return out;
}
/**
 * Rosenberg glottal pulse train: {f0 Hz, sec | n, rate (48000), oq (open quotient 0.6), vibHz, vibCt (± cents), vibPh,
 * phase} → Float32Array (the flow derivative).
 */
export function glottal(o) { return Float32Array.from(glottal64(o || {})); }

// three parallel formant band-passes; F(i) → [F1, F2, F3] (re-evaluated every 16 samples), Q = F/BW = qDiv
function formantBank(x, F, qDiv, gains) {
  const q = [new BQ(), new BQ(), new BQ()], g = gains || FORMANT_G, out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) { const f = typeof F === 'function' ? F(i) : F; for (let j = 0; j < 3; j++) q[j].set('bp', f[j], qDiv); }
    let y = 0;
    for (let j = 0; j < 3; j++) y += g[j] * q[j].run(x[i]);
    out[i] = y;
  }
  return out;
}

function karplus64(o) {
  const rate = o.rate > 0 ? o.rate : SR, n = o.n != null ? o.n : Math.round((o.sec || 3) * rate), f0 = o.f0 > 0 ? o.f0 : 110;
  const r = o.rng || mulberry32(1), rho = o.decay > 0 ? o.decay : 0.996;
  const D = rate / f0, N = Math.max(2, Math.floor(D - 0.5 - 0.1)), d = D - 0.5 - N, C = (1 - d) / (1 + d);
  const P = Math.round(D), exc = new Float64Array(P);
  for (let i = 0; i < P; i++) exc[i] = white(r);
  filt(exc, 'lp', o.excLp || 6000, 0.707);
  let m = 0;
  for (let i = 0; i < P; i++) m += exc[i];
  for (let i = 0; i < P; i++) exc[i] -= m / P; // no DC in the string
  const buf = new Float64Array(N), out = new Float64Array(n);
  let idx = 0, lpPrev = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const dl = buf[idx], lp = 0.5 * (dl + lpPrev);
    lpPrev = dl;
    const ap = C * lp + apX - C * apY;
    apX = lp; apY = ap;
    const y = (i < P ? exc[i] : 0) + rho * ap;
    buf[idx] = y; idx = idx + 1 === N ? 0 : idx + 1;
    out[i] = y;
  }
  return out;
}
/**
 * Extended Karplus-Strong string: {f0, sec | n, rate, rng (seeded noise excitation, one period, LP excLp 6 kHz),
 * decay (loop loss 0.996)} → Float32Array.
 */
export function karplus(o) { return Float32Array.from(karplus64(o || {})); }

// image-source early reflections for one listener → Float64Array(n)
function imageSource64(o) {
  const rate = o.rate > 0 ? o.rate : SR, [Lx, Ly, Lz] = o.dim || [4, 3, 2.5], alpha = clamp(o.alpha == null ? 0.3 : o.alpha, 0, 1);
  const S = o.src || [0.3 * Lx, 0.4 * Ly, 1.5], Lp = o.lis || [0.6 * Lx, 0.55 * Ly, 1.6], order = o.order == null ? 3 : o.order;
  const n = o.n != null ? o.n : Math.round(0.5 * rate), out = new Float64Array(n), rg = Math.sqrt(1 - alpha), c = 343;
  const img = (k, L, s) => (k % 2 === 0 ? k * L + s : (k + 1) * L - s);
  for (let nx = -order; nx <= order; nx++) {
    for (let ny = -order; ny <= order; ny++) {
      for (let nz = -order; nz <= order; nz++) {
        const ord = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
        if (ord > order) continue;
        const dx = img(nx, Lx, S[0]) - Lp[0], dy = img(ny, Ly, S[1]) - Lp[1], dz = img(nz, Lz, S[2]) - Lp[2];
        const d = Math.max(0.1, Math.hypot(dx, dy, dz)), g = Math.pow(rg, ord) / d, pos = d / c * rate;
        const fc = 20000 * Math.pow(8000 / 20000, Math.min(1, d / 100)), p = Math.exp(-TAU * Math.min(fc, 0.45 * rate) / rate);
        const i0 = Math.floor(pos), fr = pos - i0;
        // one-pole LP kernel (1 − p)·p^k, split between two samples by the fractional position
        let a = (1 - p) * g;
        for (let k = 0; k < 64; k++) {
          const j = i0 + k;
          if (j + 1 >= n) break;
          out[j] += a * (1 - fr); out[j + 1] += a * fr;
          a *= p;
          if (a < 1e-7 * g) break;
        }
      }
    }
  }
  return out;
}
/**
 * Image-source early reflections of a shoebox room: {dim [L, W, H] m, alpha, order (3), src, lis (positions), n | sec,
 * rate} → Float32Array (one listener; the room generator calls it for L and R).
 */
export function imageSource(o) { const x = o || {}; return Float32Array.from(imageSource64(Object.assign({}, x, { n: x.n != null ? x.n : Math.round((x.sec || 0.5) * (x.rate || SR)) }))); }

// velvet-noise tail with three-band RT60 → Float64Array(n)
function velvet64(o) {
  const rate = o.rate > 0 ? o.rate : SR, n = o.n, r = o.rng, dens = o.density || 2000, rt = o.rt60 || 1;
  const low = o.low == null ? 1.2 : o.low, high = o.high == null ? 0.6 : o.high;
  const x = new Float64Array(n), cell = rate / dens;
  for (let m = 0; m * cell < n; m++) {
    const a = Math.floor(m * cell), b = Math.min(n, Math.floor((m + 1) * cell));
    if (b <= a) continue;
    x[a + Math.floor(r() * (b - a))] = r() < 0.5 ? -1 : 1;
  }
  // complementary bands: lo = LP 250, hi = x − LP 4000, mid = rest
  const lo = filt(x.slice(), 'lp', 250, Math.SQRT1_2), lp4 = filt(x.slice(), 'lp', 4000, Math.SQRT1_2);
  const out = new Float64Array(n), k = -6.907755278982137 / rate; // ln(1e-3)
  const dl = Math.exp(k / (rt * low)), dm = Math.exp(k / rt), dh = Math.exp(k / (rt * high));
  let el = 1, em = 1, eh = 1;
  for (let i = 0; i < n; i++) {
    const hi = x[i] - lp4[i], mid = lp4[i] - lo[i];
    out[i] = lo[i] * el + mid * em + hi * eh;
    el *= dl; em *= dm; eh *= dh;
  }
  return out;
}
/** Velvet-noise late tail with three-band RT60: {n | sec, rate, rng, density (2000/s), rt60, low (1.2), high (0.6)} → Float32Array. */
export function velvetTail(o) {
  const x = o || {}, rate = x.rate > 0 ? x.rate : SR;
  return Float32Array.from(velvet64(Object.assign({}, x, { n: x.n != null ? x.n : Math.round((x.sec || 1) * rate), rng: x.rng || mulberry32(1) })));
}

// magnitude design on an N-point grid → minimum phase (real cepstrum of log|H|) → `len` samples with a half-Hann fade
// over the last quarter
function designIR(magAt, len, N) {
  const re = new Float64Array(N), im = new Float64Array(N), h = N >> 1;
  for (let k = 0; k <= h; k++) { re[k] = Math.log(Math.max(1e-10, magAt(k * SR / N))); if (k > 0 && k < h) re[N - k] = re[k]; }
  fft(re, im, N, true);                      // real cepstrum
  for (let i = 1; i < h; i++) { re[i] *= 2; re[N - i] = 0; }
  im.fill(0);
  fft(re, im, N, false);
  for (let k = 0; k < N; k++) { const a = Math.exp(re[k]), p = im[k]; re[k] = a * Math.cos(p); im[k] = a * Math.sin(p); }
  fft(re, im, N, true);
  const out = new Float64Array(len), F = Math.floor(len / 4);
  for (let i = 0; i < len; i++) out[i] = re[i] * (i < len - F ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (i - (len - F)) / F));
  return out;
}
const butterLP = (f, fc, order) => 1 / Math.sqrt(1 + Math.pow(f / fc, 2 * order));
const butterHP = (f, fc, order) => (f <= 0 ? 0 : 1 / Math.sqrt(1 + Math.pow(fc / f, 2 * order)));
function cabMag(p, variant) {
  const bands = (p.peaks || []).map(([f, Q, db], j) => new BQ().set('peak', f, Q || 1, db - (variant && j === p.peaks.length - 1 && p.peaks.length > 1 ? 1 : 0)));
  if (p.notch) bands.push(new BQ().set('peak', p.notch[0], 2, p.notch[1]));
  const lp = p.lp * (variant ? 0.92 : 1);
  return f => { let m = butterHP(f, p.hp, 2) * butterLP(f, lp, 4); for (const b of bands) m *= b.mag(f); return m; };
}
/**
 * Cabinet IR: {hp, lp (Hz), peaks [[Hz, Q | null, dB]…], notch [Hz, dB] | null, variant (off-axis R)} → magnitude design
 * → minimum phase (real cepstrum, FFT 4096) → Float32Array(2048) with a half-Hann tail.
 */
export function cabIR(o) { return Float32Array.from(designIR(cabMag(o || { hp: 80, lp: 5000 }, !!(o && o.variant)), 2048, 4096)); }

function springTrain64(o) {
  const rate = o.rate > 0 ? o.rate : SR, n = Math.round((o.sec || 3) * rate), rt = o.rt60 || 2.5, sp = o.spacing || [25, 31, 37];
  const stages = o.stages || 120, a = o.a == null ? 0.6 : o.a, x = new Float64Array(n);
  sp.forEach((ms, j) => {
    const P = ms * 1e-3 * rate * (o.stretch || 1);
    for (let k = 1; ; k++) {
      const pos = k * P - P * 0.5 * j / sp.length;
      if (pos >= n - 1) break;
      const i0 = Math.floor(pos), fr = pos - i0, g = t60(pos / rate, rt) * (k % 2 ? 1 : -0.8);
      x[i0] += g * (1 - fr); x[i0 + 1] += g * fr;
    }
  });
  // dispersion: cascade of first-order allpasses y = a·x + x1 − a·y1
  for (let s = 0; s < stages; s++) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < n; i++) { const v = x[i], y = a * v + x1 - a * y1; x1 = v; y1 = y; x[i] = y; }
  }
  return x;
}
/** Spring reverb IR: {rt60 2.5, spacing [25, 31, 37] ms, stages 120, a 0.6, sec 3, stretch 1} → Float32Array. */
export function spring(o) { return Float32Array.from(springTrain64(o || {})); }

/* ================================================================================== §10.3 IR generators */

function roomIR(id, p) {
  const r = rngFor(id), [Lx, Ly, Lz] = p.dim, rt = p.rt60, high = p.high == null ? 0.6 : p.high;
  const n = Math.round(Math.min(LIMITS.irSec, 1.25 * rt * Math.max(1, high) + 0.05) * SR);
  const lis = [0.6 * Lx, 0.55 * Ly, 1.6], tdir = Math.hypot(0.3 * Lx - lis[0], 0.4 * Ly - lis[1], 1.5 - lis[2]) / 343;
  const tmix = Math.sqrt(Lx * Ly * Lz) * 1e-3, m0 = Math.max(Math.round(0.5 * tmix * SR), Math.round((tdir + 0.002) * SR));
  const m1 = Math.max(m0 + Math.round(0.002 * SR), Math.round(1.5 * tmix * SR));
  const early = [imageSource64({ dim: p.dim, alpha: p.alpha, lis, n }), imageSource64({ dim: p.dim, alpha: p.alpha, lis: [lis[0] + 0.17, lis[1], lis[2]], n })];
  // early level around the mixing time (fallback: the early part up to 2·t_mix)
  const win = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  let er = 0.5 * (win(early[0], m0, m1) + win(early[1], m0, m1));
  if (!(er > 0)) er = 0.5 * (win(early[0], 0, 2 * m1) + win(early[1], 0, 2 * m1));
  const chans = early.map(e => {
    const tail = velvet64({ n, rng: r, density: 2000, rt60: rt, low: 1.2, high });
    // tail RMS at the mixing time: velvet RMS √(density/rate) × the decay there
    const tr = Math.sqrt(2000 / SR) * t60(tmix, rt);
    const g = tr > 0 ? er / tr : 0, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = i <= m0 ? 0 : i >= m1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (i - m0) / (m1 - m0));
      out[i] = e[i] * (1 - w) + g * tail[i] * w;
    }
    return fadeEdges(out, 0, Math.round(0.05 * n));
  });
  return chans;
}
function velvetIR(id, p) { // Endless Plate
  const r = rngFor(id), n = Math.round(Math.min(LIMITS.irSec, p.sec) * SR);
  return [0, 1].map(() => fadeEdges(velvet64({ n, rng: r, density: p.density || 6000, rt60: p.sec, low: 1, high: 0.8 }), 0, Math.round(0.05 * n)));
}
function echoesIR(id, p) { // Canyon
  const r = rngFor(id), n = Math.round(Math.min(LIMITS.irSec, p.tail) * SR), L = new Float64Array(n), R = new Float64Array(n);
  L[0] = 1; R[0] = 1;
  const times = [];
  for (let k = 0; k < p.n; k++) times.push(p.from + (p.to - p.from) * r());
  times.sort((a, b) => a - b);
  times.forEach((t, k) => {
    const g = 0.8 * Math.pow(0.82, k) * (0.7 + 0.3 * r()), i = Math.round(t * SR), dull = Math.exp(-TAU * (6000 - 4000 * (k / p.n)) / SR);
    const side = k % 2 ? R : L, other = k % 2 ? L : R;
    let a = (1 - dull) * g;
    for (let j = 0; j < 400 && i + j < n; j++) { side[i + j] += a; other[i + j] += 0.35 * a; a *= dull; }
  });
  const tails = [velvet64({ n, rng: r, density: 2000, rt60: p.tail, low: 1.2, high: 0.5 }), velvet64({ n, rng: r, density: 2000, rt60: p.tail, low: 1.2, high: 0.5 })];
  const on = Math.round(0.12 * SR);
  for (let i = 0; i < n; i++) {
    const w = i < on ? 0.5 - 0.5 * Math.cos(Math.PI * i / on) : 1;
    L[i] += 0.12 * w * tails[0][i]; R[i] += 0.12 * w * tails[1][i];
  }
  return [fadeEdges(L, 0, Math.round(0.05 * n)), fadeEdges(R, 0, Math.round(0.05 * n))];
}
function cabChans(p) {
  const L = designIR(cabMag(p, false), 2048, 4096);
  return p.mono ? [L] : [L, designIR(cabMag(p, true), 2048, 4096)];
}
function eqChans(p) {
  const bands = [];
  if (p.lowShelf) bands.push(new BQ().set('ls', p.lowShelf[0], Math.SQRT1_2, p.lowShelf[1]));
  if (p.bell) bands.push(new BQ().set('peak', p.bell[0], 1, p.bell[1]));
  if (p.highShelf) bands.push(new BQ().set('hs', p.highShelf[0], Math.SQRT1_2, p.highShelf[1]));
  return [designIR(f => { let m = 1; for (const b of bands) m *= b.mag(f); return m; }, 2048, 4096)];
}
function bandChans(p) { return [designIR(f => butterHP(f, p.lo, 4) * butterLP(f, p.hi, 4), 2048, 4096)]; }
function formantChans(p) {
  const F = FORMANTS.I[VOWEL[p.vowel] || 0], n = Math.round(0.15 * SR), x = new Float64Array(n);
  for (let j = 0; j < 3; j++) {
    const bw = F[j] / 10, d = Math.exp(-Math.PI * bw / SR), w = TAU * F[j] / SR;
    let a = FORMANT_G[j] * (1 - d);
    for (let i = 0; i < n; i++) { x[i] += a * Math.sin(w * i); a *= d; }
  }
  return [fadeEdges(x, 0, Math.round(0.1 * n))];
}
function combChans(p) {
  const n = Math.round(p.sec * SR), mk = per => {
    const x = new Float64Array(n);
    for (let k = 0; ; k++) {
      const pos = k * per;
      if (pos >= n - 1) break;
      const i0 = Math.floor(pos), fr = pos - i0, g = Math.pow(p.g, k);
      x[i0] += g * (1 - fr); x[i0 + 1] += g * fr;
    }
    return fadeEdges(x, 0, Math.round(0.05 * n));
  };
  if (p.hz) return [mk(SR / p.hz)];
  return [mk(p.ms * 1e-3 * SR), mk((p.ms + 0.3) * 1e-3 * SR)];
}
function shepardChans(id) {
  const r = rngFor(id), n = Math.round(4 * SR);
  return [0, 1].map(c => {
    const src = velvet64({ n, rng: r, density: 3000, rt60: 3, low: 1, high: 0.8 }), out = new Float64Array(n);
    for (let b = 0; b < 6; b++) {
      const q = new BQ();
      for (let i = 0; i < n; i++) {
        const oct = (b + i / SR / 1.5 + 0.25 * c) % 6, f = 50 * Math.pow(2, oct), wgt = Math.exp(-Math.pow((Math.log2(f) - Math.log2(800)) / 1.5, 2));
        if ((i & 15) === 0) q.set('bp', f, 4);
        out[i] += wgt * q.run(src[i]);
      }
    }
    return fadeEdges(out, Math.round(0.005 * SR), Math.round(0.2 * SR));
  });
}
function springChans(p) {
  return [springTrain64(p), springTrain64(Object.assign({}, p, { stretch: 1.03, a: (p.a || 0.6) + 0.02 }))].map(x => fadeEdges(x, 0, Math.round(0.1 * x.length)));
}
function smearChans(id, p) {
  const src = irChans(p.of), r = rngFor(id), n = Math.round(3 * SR), out = [new Float64Array(n), new Float64Array(n)];
  const s0 = Math.round(0.15 * SR);
  for (let gI = 0; gI < p.grains; gI++) {
    const len = Math.round((0.05 + 0.15 * r()) * SR), at = Math.floor(r() * (n - len)), ch = src[Math.floor(r() * src.length)];
    const from = s0 + Math.floor(r() * Math.max(1, ch.length - s0 - 2 * len)), ratio = Math.pow(2, (2 * r() - 1) * p.st / 12), pan = r();
    const amp = Math.pow(1 - at / n, 1.5), gl = Math.cos(pan * Math.PI / 2) * amp, gr = Math.sin(pan * Math.PI / 2) * amp;
    for (let i = 0; i < len; i++) {
      const pos = from + i * ratio, k = Math.floor(pos), t = pos - k;
      const v = k + 1 < ch.length ? ch[k] + (ch[k + 1] - ch[k]) * t : 0, w = Math.sin(Math.PI * i / len) ** 2;
      out[0][at + i] += gl * w * v; out[1][at + i] += gr * w * v;
    }
  }
  return out.map(x => fadeEdges(x, 0, Math.round(0.05 * n)));
}
// Float64 channels of a factory IR (before the record's peak normalisation)
function irChans(id) {
  const x = BY_ID.get(id);
  if (!x || factoryKind(id) !== 'ir') throw new Error('smpgen: unknown IR ' + id);
  const p = x.p;
  switch (x.gen) {
    case 'room': return roomIR(id, p);
    case 'velvet': return velvetIR(id, p);
    case 'echoes': return echoesIR(id, p);
    case 'cab': return cabChans(p);
    case 'eq': return eqChans(p);
    case 'band': return bandChans(p);
    case 'formant': return formantChans(p);
    case 'comb': return combChans(p);
    case 'reverse': return irChans(p.of).map(c => { const n = Math.min(c.length, Math.round(p.sec * SR)), o = c.slice(0, n).reverse(); return fadeEdges(o, Math.round(0.01 * SR), 64); });
    case 'gate': return irChans(p.of).map(c => { const n = Math.min(c.length, Math.round(p.ms * 1e-3 * SR)); return fadeEdges(c.slice(0, n), 0, Math.round(p.fadeMs * 1e-3 * SR)); });
    case 'shepard': return shepardChans(id);
    case 'spring': return springChans(p);
    case 'smear': return smearChans(id, p);
    default: throw new Error('smpgen: generator ' + x.gen);
  }
}

/* ================================================================================== §10.2 procedural samples */

function genSample(id) {
  const x = BY_ID.get(id), r = rngFor(id), n = sec(x.seconds), extra = {};
  let chans;
  switch (x.name) {
    case 'Vowel Phrase': {
      const seg = n / 5, glide = sec(0.1), src = glottal64({ f0: 130.81, n, oq: 0.6, vibHz: 5.5, vibCt: 15 });
      const F = i => {
        const k = Math.min(4, Math.floor(i / seg)), into = i - k * seg, cur = FORMANTS.I[k];
        if (k === 0 || into >= glide) return cur;
        const prev = FORMANTS.I[k - 1], t = into / glide;
        return [0, 1, 2].map(j => prev[j] + (cur[j] - prev[j]) * t);
      };
      chans = [fadeEdges(formantBank(src, F, 8), sec(0.02), sec(0.05))];
      break;
    }
    case 'Choir Ahh': {
      const det = [-9, -5, -2, 2, 5, 9], sum = new Float64Array(n);
      for (const d of det) {
        const v = glottal64({ f0: 220 * Math.pow(2, d / 1200), n, oq: 0.6, vibHz: 4.8 + 0.8 * r(), vibCt: 12, vibPh: TAU * r(), phase: r() });
        for (let i = 0; i < n; i++) sum[i] += v[i];
      }
      const br = whiteN(n, r), g = rms(sum) * dBg(-30) / (rms(br) || 1);
      for (let i = 0; i < n; i++) sum[i] += br[i] * g;
      const y = fadeEdges(formantBank(sum, FORMANTS.II[0], 8), sec(0.3), sec(0.3));
      const a = zeroNear(y, sec(1), sec(0.01)), b = Math.max(a + 1, zeroNear(y, sec(3.5), sec(0.01)));
      extra.loop = { start: a, end: b };
      chans = [Float64Array.from(bakeLoop(Float32Array.from(y), null, a, b, sec(LOOP_XF)).L)];
      break;
    }
    case 'Whisper Text': {
      const y = new Float64Array(n), vowels = ['a', 'e', 'i', 'o', 'u'];
      let t = sec(0.15);
      const burst = (len, fn) => {
        const z = new Float64Array(len);
        for (let i = 0; i < len; i++) z[i] = white(r);
        const w = fn(z);
        fadeEdges(w, sec(0.008), sec(0.008));
        for (let i = 0; i < len && t + i < n; i++) y[t + i] += w[i];
        t += len;
      };
      for (let s = 0; s < 9 && t < n; s++) {
        if (r() < 0.6) burst(sec(0.04), z => { filt(z, 'hp', 4000, 0.707); filt(z, 'hp', 4000, 0.707); for (let i = 0; i < z.length; i++) z[i] *= 0.6; return z; });
        const v = vowels[Math.floor(r() * 5)];
        burst(sec(0.09), z => formantBank(z, FORMANTS.I[VOWEL[v]], 8));
        t += sec(0.03 + 0.09 * r());
      }
      chans = [y];
      break;
    }
    case 'Pluck Guitar': chans = [fadeEdges(karplus64({ f0: 110, n, rng: r, decay: 0.996 }), sec(0.001), sec(0.05))]; break;
    case 'Glass Bell': {
      const R = [1, 2.76, 5.40, 8.93, 13.34, 19.2], A = [1, 0.6, 0.4, 0.25, 0.15, 0.1], T = [3, 2.2, 1.5, 1.1, 0.8, 0.5], y = new Float64Array(n);
      R.forEach((ratio, j) => {
        const f = 523.25 * ratio, ph = TAU * r();
        if (f >= 0.45 * SR) return;
        for (let i = 0; i < n; i++) { const t = i / SR; y[i] += A[j] * Math.sin(TAU * f * t + ph) * t60(t, T[j]) * Math.min(1, t / 0.002); }
      });
      chans = [fadeEdges(y, 0, sec(0.05))];
      break;
    }
    case 'Wind Field': {
      chans = [0, 1].map(() => {
        const fc = walk(n, r, 4800, Math.log(300), Math.log(1500), 0.4), am = walk(n, r, 7200, 0.3, 1, 0.5);
        const y = sweep(whiteN(n, r), 'bp', i => Math.exp(fc[i]), 2);
        for (let i = 0; i < n; i++) y[i] *= am[i];
        return fadeEdges(y, sec(0.05), sec(0.05));
      });
      break;
    }
    case 'Metal Scrape': {
      const src = new Float64Array(n);
      for (let t = 0; t < n;) {
        t += Math.max(1, Math.round(-Math.log(1 - r()) / 6 * SR)); // Poisson, 6 bursts/s
        const len = sec(0.04 + 0.16 * r()), a = 0.4 + 0.6 * r();
        for (let i = 0; i < len && t + i < n; i++) src[t + i] += a * white(r) * Math.sin(Math.PI * i / len);
      }
      chans = [0, 1].map(() => {
        const y = new Float64Array(n);
        for (let b = 0; b < 6; b++) {
          const w = walk(n, r, 2400, Math.log(800), Math.log(6000), 0.3), q = new BQ();
          for (let i = 0; i < n; i++) { if ((i & 15) === 0) q.set('bp', Math.exp(w[i]), 40); y[i] += q.run(src[i]); }
        }
        return fadeEdges(y, sec(0.01), sec(0.1));
      });
      break;
    }
    case 'FM Drone': {
      chans = [-3, 3].map(ct => {
        const fc = 220 * Math.pow(2, ct / 1200), y = new Float64Array(n);
        let pc = 0, pm = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR, ratio = 1 + 2.5 * t / x.seconds, I = 2 + 1.5 * Math.sin(TAU * 0.07 * t);
          pc += TAU * fc / SR; pm += TAU * fc * ratio / SR;
          y[i] = Math.sin(pc + I * Math.sin(pm));
        }
        filt(y, 'hp', 20, Math.SQRT1_2); // the 1:1 … 3:1 ratios put sidebands at 0 Hz: no DC / sub-audio drift
        return fadeEdges(y, sec(0.5), sec(0.5));
      });
      break;
    }
    case 'Granular Bed': {
      chans = [new Float64Array(n), new Float64Array(n)];
      for (let c = 0; c < 8; c++) {
        const dur = sec(2 + 3 * r()), at = Math.floor(r() * (n - dur)), pan = r(), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
        for (let k = 0; k < 5; k++) {
          const f = 200 * Math.pow(15, r()), a = (0.4 + 0.6 * r()) / (1 + k), ph = TAU * r();
          for (let i = 0; i < dur; i++) {
            const w = Math.sin(Math.PI * i / dur) ** 2, v = a * w * Math.sin(TAU * f * i / SR + ph);
            chans[0][at + i] += gl * v; chans[1][at + i] += gr * v;
          }
        }
      }
      break;
    }
    case 'Tape Melody': {
      const scale = [60, 62, 64, 67, 69, 72, 74], step = sec(0.3), y = new Float64Array(n);
      let k = 3, ph = 0;
      const notes = [];
      for (let s = 0; s * step < n; s++) { k = clamp(k + Math.floor(r() * 5) - 2, 0, scale.length - 1); notes.push(scale[k]); }
      for (let i = 0; i < n; i++) {
        const s = Math.floor(i / step), into = i - s * step, t = i / SR;
        const cents = 8 * Math.sin(TAU * 0.5 * t) + 2 * Math.sin(TAU * 7 * t);
        const f = 440 * Math.pow(2, (notes[s] - 69) / 12 + cents / 1200);
        ph += TAU * f / SR;
        const env = Math.min(1, into / sec(0.005)) * (into < step - sec(0.03) ? 0.7 + 0.3 * Math.exp(-into / sec(0.08)) : 0.7 * Math.max(0, (step - into) / sec(0.03)));
        y[i] = env * (0.6 * Math.sin(ph) + 0.4 * sawAt(ph, f, 5000));
      }
      filt(y, 'lp', 5000, Math.SQRT1_2);
      chans = [fadeEdges(y, 0, sec(0.05))];
      break;
    }
    case 'Impact': {
      const y = brownN(n, r, 0.995), w = whiteN(sec(0.01), r);
      for (let i = 0; i < w.length; i++) y[i] += w[i] * 0.5 * (1 - i / w.length);
      sweep(y, 'lp', i => 8000 * Math.pow(200 / 8000, i / n), Math.SQRT1_2);
      filt(filt(y, 'hp', 30, Math.SQRT1_2), 'hp', 30, Math.SQRT1_2); // brown noise drifts below the audio band
      for (let i = 0; i < n; i++) y[i] *= t60(i / SR, 2.5);
      const tp = peakAbs(y) || 1;
      for (let i = 0; i < n; i++) { const t = i / SR; y[i] += 0.8 * tp * Math.sin(TAU * 45 * t) * t60(t, 0.4) * Math.min(1, t / 0.002); }
      chans = [fadeEdges(y, sec(0.0005), sec(0.05))];
      break;
    }
    case 'Riser 4 bar': {
      const y = whiteN(n, r);
      sweep(y, 'bp', i => 200 * Math.pow(50, i / n), 3);
      for (let i = 0; i < n; i++) { const t = i / n; y[i] *= t * t; }
      const pk = peakAbs(y) || 1;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const f = 110 * Math.pow(8, i / n);
        ph += TAU * f / SR;
        y[i] += pk * dBg(-12) * sawAt(ph, f, 12000) * Math.min(1, i / sec(0.05));
      }
      chans = [fadeEdges(y, 0, sec(0.02))];
      break;
    }
    default: throw new Error('smpgen: no procedural recipe for ' + id);
  }
  return sampleRec(x.name, chans, x.root, extra);
}

/**
 * The record of a procedural factory sample ('fsmp:' with src 'proc') or IR ('fir:'), same shape as an smpstore
 * record (§9.2; Float32Array channels) — deterministic per id and GEN_VER. Render-farm items, multisamples and unknown
 * ids: null.
 */
export function generate(id) {
  const k = factoryKind(id);
  if (k === 'ir') { const x = BY_ID.get(id); return Object.assign(irRec(x.name, irChans(id)), { folder: x.folder, factory: 1 }); }
  if (k === 'sample' && BY_ID.get(id).src === 'proc') return Object.assign(genSample(id), { factory: 1 });
  return null;
}

/* ================================================================================== §10.1 render farm plans */

const stepFrames = (bpm, steps) => Math.round(steps * 60 / bpm / 4 * SR);
/**
 * The render-farm plan of a factory multisample or render-farm sample: {id, kind: 'multi' | 'sample', model, preset |
 * presets, bpm, mix: 'zones' | 'phrase' | 'loop', notes: [{rid, model, preset, root?, vel?, events, frames}], …} —
 * the requests to smprender (one per (root, velocity) zone of a multisample; one per preset of a loop/phrase sample)
 * and how they are combined (multiFromRenders / sampleFromRenders). Unknown or procedural ids: null.
 */
export function renderPlan(id) {
  const k = factoryKind(id), x = BY_ID.get(id);
  if (k === 'multi') {
    const notes = [], gate = sec(x.gate), frames = sec(x.gate + x.tail);
    for (const root of x.roots) for (const vel of x.vels) {
      notes.push({ rid: zoneId(id, root, vel), model: x.model, preset: x.preset, root, vel, events: [[0, 1, root, vel], [gate, 0, root, 0]], frames });
    }
    return { id, kind: 'multi', name: x.name, model: x.model, preset: x.preset, bpm: 120, mix: 'zones', loop: x.loop, gate: x.gate, tail: x.tail, ch: x.ch, roots: x.roots.slice(), vels: x.vels.slice(), notes };
  }
  if (k !== 'sample' || x.src !== 'farm') return null;
  const base = { id, kind: 'sample', name: x.name, model: x.model, root: x.root, seconds: x.seconds, frames: sec(x.seconds) };
  if (x.model !== 'serum') {
    let events;
    if (x.name === 'Piano Phrase') events = [60, 64, 67, 72].flatMap((nn, j) => [[sec(0.5 * j), 1, nn, 90], [sec(0.5 * j + 0.45), 0, nn, 0]]);
    else events = [48, 55, 60, 64].map(nn => [0, 1, nn, 100]).concat([48, 55, 60, 64].map(nn => [sec(4), 0, nn, 0]));
    return Object.assign(base, { preset: x.preset, bpm: 120, mix: 'phrase', loopSec: x.loop, notes: [{ rid: id, model: x.model, preset: x.preset, events, frames: sec(x.seconds) }] });
  }
  const r = rngFor(id), bpm = x.bpm, steps = 16 * x.bars, half = stepFrames(bpm, 0.5), extra = sec(1);
  const hits = {};
  const add = (preset, step, vel) => { (hits[preset] = hits[preset] || []).push([step, vel]); };
  if (x.name === 'Drum Loop 120') {
    for (let bar = 0; bar < x.bars; bar++) {
      const o = 16 * bar;
      for (const s of [0, 4, 8, 10, 12]) add('Punch Kick', o + s, 110);
      for (const s of [4, 12]) add('Noise Snare', o + s, 105);
      for (let s = 0; s < 16; s += 2) add('Tight Hat', o + s, (s / 2) % 2 ? 100 : 70);
      add('Electro Clap', o + 12, 100);
    }
  } else if (x.name === 'Break 96') {
    for (const s of [0, 7, 10]) add('Punch Kick', s, 110);
    add('Noise Snare', 4, 105); add('Noise Snare', 12, 105); add('Noise Snare', 15, 60);
    for (let s = 0; s < 16; s++) add('Tight Hat', s, 60 + Math.round(50 * r()));
  }
  let notes;
  if (x.name === 'Arp Loop 128') {
    const chord = [57, 60, 64, 67], end = stepFrames(bpm, steps);
    notes = [{ rid: id + '/Octave Runner', model: 'serum', preset: 'Octave Runner', events: chord.map(nn => [0, 1, nn, 100]).concat(chord.map(nn => [end, 0, nn, 0])), frames: sec(x.seconds) + extra }];
  } else {
    notes = x.presets.map(pr => ({
      rid: id + '/' + pr, model: 'serum', preset: pr, frames: sec(x.seconds) + extra,
      events: (hits[pr] || []).flatMap(([s, v]) => [[stepFrames(bpm, s), 1, 60, v], [stepFrames(bpm, s) + half, 0, 60, 0]]),
    }));
  }
  const used = new Set();
  for (const pr of Object.keys(hits)) for (const [s] of hits[pr]) used.add(s);
  const marks = x.name === 'Arp Loop 128' ? null : [...used].filter(s => s > 0).sort((a, b) => a - b).map(s => stepFrames(bpm, s) / sec(x.seconds));
  return Object.assign(base, { presets: x.presets.slice(), bpm, mix: 'loop', marks, notes });
}

/** Σ bytes of raw Float32 PCM (level 0) of a multiFromRenders result (or of a list of sample records). */
export function multiBytes(res) {
  const list = Array.isArray(res) ? res : res && Array.isArray(res.samples) ? res.samples.map(s => s.rec) : [];
  return list.reduce((a, r) => a + (r ? r.len * (r.ch === 2 ? 2 : 1) * 4 : 0), 0);
}

/**
 * The velocity layers a multisample keeps (§10.1 budget rule): all of them, except that an instrument expected mono
 * (plan.ch 'mo') whose renders come out stereo (some render with L ≠ R bit for bit) halves its layers keeping the
 * extremes — ⌈n/2⌉ layers at evenly spaced indices including the first and the last; a single kept layer is the
 * loudest (IMPL for n = 2).
 */
export function keptVels(plan, renders) {
  const v = plan && Array.isArray(plan.vels) ? plan.vels.slice() : [];
  if (!plan || plan.ch !== 'mo' || v.length < 2 || !Array.isArray(renders)) return v;
  if (!renders.some(r => r && r.R != null && !sameBits(toF32(r.L), toF32(r.R)))) return v;
  const n = v.length, k = Math.ceil(n / 2);
  if (k === 1) return [v[n - 1]];
  const idx = new Set();
  for (let j = 0; j < k; j++) idx.add(Math.round(j * (n - 1) / (k - 1)));
  return [...idx].sort((a, b) => a - b).map(i => v[i]);
}

/**
 * §10.1 post-processing of the zone renders of a plan → {rec: multi record {kind: 'multi', name, zones, factory: 1},
 * samples: [{id, rec}]} (zone samples `fmsmp:<Name>#<root>.<vel>`). `renders[i]` = {L, R, loop?: {ls, le}} for
 * plan.notes[i] (loop: a precomputed smpwork op 'loop' result over the raw render). One gain per instrument (−1 dBFS
 * peak), leading silence below −70 dBFS trimmed (1 ms kept), trailing material below −60 dBFS trimmed (END_FADE kept),
 * a raised-cosine END_FADE fade-out at the end of every zone, identical channels stored mono, sustain loops in
 * [0.45, 0.95]·gate, zone key ranges at the midpoints between roots (first from 0, last to 127), velocity layers
 * (keptVels: halved when an instrument expected mono renders in stereo) split at the midpoints of their velocities;
 * every zone vt = 1. Renders of dropped layers are ignored.
 */
export function multiFromRenders(plan, renders) {
  if (!plan || plan.kind !== 'multi' || !Array.isArray(plan.notes)) throw new Error('smpgen.multiFromRenders: not a multisample plan');
  if (!Array.isArray(renders) || renders.length !== plan.notes.length) throw new Error('smpgen.multiFromRenders: one render per plan note');
  const all = renders.map(r => ({ L: toF32(r.L), R: r.R != null ? toF32(r.R) : null, loop: r.loop || null }));
  const vels = keptVels(plan, all), use = plan.notes.map(nt => vels.includes(nt.vel));
  let pk = 0;
  all.forEach((r, i) => { if (use[i]) pk = Math.max(pk, peakAbs(r.L), r.R ? peakAbs(r.R) : 0); });
  const g = pk > 0 ? dBg(-1) / pk : 1, thr = dBg(-70), keep = sec(0.001), gate = sec(plan.gate), tthr = dBg(-60), fade = sec(END_FADE);
  const roots = plan.roots, zones = [], samples = [], rs = all;
  const keyRange = j => [j === 0 ? 0 : roots[j] - Math.floor((roots[j] - roots[j - 1]) / 2), j === roots.length - 1 ? 127 : roots[j] + Math.ceil((roots[j + 1] - roots[j]) / 2) - 1];
  const velRange = j => [j === 0 ? 0 : Math.floor((vels[j - 1] + vels[j]) / 2) + 1, j === vels.length - 1 ? 127 : Math.floor((vels[j] + vels[j + 1]) / 2)];
  plan.notes.forEach((nt, i) => {
    if (!use[i]) return;
    const r = rs[i], n = r.L.length;
    let first = 0;
    while (first < n && Math.abs(r.L[first] * g) < thr && !(r.R && Math.abs(r.R[first] * g) >= thr)) first++;
    const s = Math.max(0, Math.min(first, n - 1) - keep);
    // trailing material below −60 dBFS (after the gain: a model's noise floor, the last of a release) is cut, END_FADE
    // after the last sample above it
    let last = n - 1;
    while (last > s && Math.abs(r.L[last] * g) < tthr && !(r.R && Math.abs(r.R[last] * g) >= tthr)) last--;
    const e = Math.max(s + 1, Math.min(n, last + 1 + fade));
    const L = new Float32Array(e - s), R = r.R ? new Float32Array(e - s) : null;
    for (let k = s; k < e; k++) { L[k - s] = r.L[k] * g; if (R) R[k - s] = r.R[k] * g; }
    const stereo = R && !sameBits(L, R);
    const rec = { kind: 'smp', name: plan.name + ' ' + nt.root + (vels.length > 1 ? ' v' + nt.vel : ''), rate: SR, ch: stereo ? 2 : 1, len: L.length, L, R: stereo ? R : null, root: nt.root, loop: null, odf: null, peak: 0, folder: '', factory: 1 };
    let mode = 'oneshot', ls = 0, le = rec.len;
    if (plan.loop === 'sustain') {
      const lp = r.loop && r.loop.le > r.loop.ls ? r.loop : loopSearch(r.L, r.R, SR, Math.round(0.45 * gate), Math.min(n, Math.round(0.95 * gate)), 0);
      const a = lp.ls - s, b = lp.le - s;
      if (a >= 0 && b > a && b <= rec.len) {
        mode = 'sustain'; ls = a; le = b; rec.loop = { start: a, end: b };
        const bk = bakeLoop(rec.L, rec.R, a, b, sec(LOOP_XF)); // every channel continues at the wrap (the DSP has no zone crossfade)
        rec.L = bk.L; rec.R = bk.R;
      }
    }
    // every zone ends silent: a raised-cosine fade over its last END_FADE (not into a sustain loop), so a render the
    // frame cap stopped while it still sounded, or a cut noise floor, never ends in a step
    const fl = Math.min(fade, Math.floor(rec.len / 4), mode === 'sustain' ? rec.len - le : rec.len);
    for (const x of [rec.L, rec.R]) if (x) for (let i = 0; i < fl; i++) x[rec.len - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fl);
    rec.peak = Math.max(peakAbs(rec.L), rec.R ? peakAbs(rec.R) : 0);
    const [lo, hi] = keyRange(roots.indexOf(nt.root)), [vlo, vhi] = velRange(vels.indexOf(nt.vel));
    const sid = zoneId(plan.id, nt.root, nt.vel);
    zones.push({ lo, hi, vlo, vhi, root: nt.root, tune: 0, gain: 0, pan: 0, smp: sid, mode, ls, le, off: 0, env: null, rr: [1, 1], vt: 1 });
    samples.push({ id: sid, rec });
  });
  return { rec: { kind: 'multi', name: plan.name, zones, factory: 1 }, samples };
}

/**
 * Post-processing of a render-farm sample's renders → sample record: renders summed (mix 'loop': into the loop length
 * with the tail beyond it folded onto the start; 'phrase': cut at the sample length), −1 dBFS peak, mono when the
 * channels are identical; loop (Loops: the whole sample; Pad Chord: its seconds snapped to upward zero crossings),
 * marks (step grid of the hits), root.
 */
export function sampleFromRenders(plan, renders) {
  if (!plan || plan.kind !== 'sample' || !Array.isArray(plan.notes)) throw new Error('smpgen.sampleFromRenders: not a sample plan');
  if (!Array.isArray(renders) || renders.length !== plan.notes.length) throw new Error('smpgen.sampleFromRenders: one render per plan note');
  const n = plan.frames, L = new Float64Array(n), R = new Float64Array(n);
  for (const r of renders) {
    const a = toF32(r.L), b = r.R != null ? toF32(r.R) : a;
    for (let i = 0; i < a.length; i++) {
      if (i >= n && plan.mix !== 'loop') break;
      const j = i % n;
      L[j] += a[i]; R[j] += b[i];
    }
  }
  const extra = { marks: plan.marks ? plan.marks.slice() : null };
  if (plan.mix === 'loop') extra.loop = { start: 0, end: n };
  let chans = [L, R];
  if (plan.mix !== 'loop' && plan.loopSec) {
    const m = mono(Float32Array.from(L), Float32Array.from(R)), a = zeroNear(m, sec(plan.loopSec[0]), sec(0.01)), b = Math.max(a + 1, zeroNear(m, sec(plan.loopSec[1]), sec(0.01)));
    extra.loop = { start: a, end: b };
    const bk = bakeLoop(Float32Array.from(L), Float32Array.from(R), a, b, sec(LOOP_XF));
    chans = [Float64Array.from(bk.L), Float64Array.from(bk.R)];
  }
  const rec = sampleRec(plan.name, chans, plan.root, extra);
  rec.factory = 1;
  return rec;
}
