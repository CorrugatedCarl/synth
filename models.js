/*
 * Instrument definitions: front-panel layout, factory presets and the
 * mapping from panel controls to the engine's circuit parameters.
 * Dial values are stored in panel units (mostly 0–10, like the hardware);
 * `conv` turns a dial position into a physical quantity.
 * Models with `custom` (Serum) bring their own panel and state ({ s } from serum-core.js) instead of sections.
 * patchFor(model, vals, fx, opts) = the complete engine patch of a track (SPEC-serum2 §12.7): the model's map + the
 * track's FX rack (FXP v2) — shared by main.js (which adds only live-session fields), bounces and the tests.
 */
import * as SC from './serum-core.js?v=10';

const { defaultSerum, compileSerum, FACTORY_PRESETS } = SC;

const lg = Math.log2;
const ex = (v, lo, hi) => lo * Math.pow(hi / lo, v / 10);
const dial = (x, lo, hi) => +(10 * Math.log(x / lo) / Math.log(hi / lo)).toFixed(2);
const fmtT = s => s < 1 ? (s * 1000).toFixed(s < 0.01 ? 1 : 0) + ' ms' : s.toFixed(2) + ' s';
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : f.toFixed(f < 100 ? 1 : 0) + ' Hz';
const T = (lo, hi) => ({ conv: v => ex(v, lo, hi), fmt: v => fmtT(ex(v, lo, hi)) });
const F = (lo, hi) => ({ conv: v => ex(v, lo, hi), fmt: v => fmtHz(ex(v, lo, hi)) });
const ST = { fmt: v => (v > 0 ? '+' : '') + (+v).toFixed(Math.abs(v - Math.round(v)) > 0.001 ? 2 : 0) + ' st' };
const CT = { fmt: v => (v > 0 ? '+' : '') + Math.round(v) + ' ct' };
const PCT = { fmt: v => Math.round(v * 100) + '%' };
const INT = { step: 1, fmt: v => String(Math.round(v)) };
const K = (id, label, min, max, def, o) => Object.assign({ t: 'k', id, label, min, max, def }, o);
const S = (id, label, opts, def, o) => Object.assign({ t: 's', id, label, opts, def: def || 0 }, o);
const B = (id, label, def, o) => Object.assign({ t: 'b', id, label, def: def ? 1 : 0 }, o);

const osc = o => Object.assign({ on: 0, lev: 0, oct: 0, fine: 0, saw: 0, pulse: 0, tri: 0, sine: 0, pw: 0.5, pwLfo: 0, pwEnv: 0, kbd: 1, envPitch: 0, lfoPitch: 0, wheelPitch: 0, wheelPw: 0 }, o);
function base(G) {
  return {
    engine: 'analog', mode: 'poly', poly: 8, prio: 'last', legato: true, glide: 0, glideLegato: false,
    unison: 1, unisonDetune: 0, bendRange: 2, drift: G.drift, envOv: 1.3, sawBow: 0, bw: 24000, level: 0.4,
    osc: [osc(), osc(), osc()], sub: 0, noise: 0, pink: 0, ring: 0, ext: 0, sync: 0, fm01: 0, fm10: 0, polyOscPw: 0, polyOscFilt: 0,
    hpf: { type: 'none', oct: 4, res: 0, env: 0, kbd: 0, lfo: 0 },
    vcf: { type: 'moog', oct: 10, res: 0, env: 0, envOff: 0, kbd: 0, lfo: 0, vel: 0, drive: 1, comp: 0, fbSat: 0, poles: 4, mode: 0, at: 0 },
    dual: null, mod3: null, tb: null, velAmp: 0, atPitch: 0,
    fenv: { a: 0.01, d: 0.3, s: 0.5, r: 0.3 }, aenv: { a: 0.005, d: 0.3, s: 1, r: 0.3 },
    lfo: { rate: 5, wave: 0, delay: 0, pitch: 0, amp: 0, wheelPitch: 0.5, wheelFilter: 0 },
    fx: { chorus: 0, ensemble: 0, hiss: 0 }, dac: 0,
  };
}
const glideT = v => v > 0.05 ? ex(v, 0.012, 4) : 0;
const GLIDE = { fmt: v => v > 0.05 ? fmtT(ex(v, 0.012, 4)) : 'off' };
const FEET = ['32\'', '16\'', '8\'', '4\'', '2\''];
const FEET_ST = [-24, -12, 0, 12, 24];

/* ================================================================ 1965 */
const modular = {
  id: 'modular', name: 'Moog Modular', model: 'System 55', maker: 'R.A. Moog', year: 1965,
  tag: 'Mono · 3× 921 VCO · 904A ladder LPF · 904B HPF · 911 envelopes',
  about: 'The cabinet that started it — Switched-On Bach, Tangerine Dream, Emerson. Modelled as a fixed patch: three 921 oscillators into the 904A transistor-ladder low-pass (the original Moog ladder), a 904B high-pass, and two 911 envelope generators. The 901-series oscillators were famously unstable, so analog drift is scaled up here.',
  theme: { ctl: 'knob', knob: 'moog', panel: '#121110', face: '#0b0b0b', ink: '#e9e4d8', label: '#bdb6a6', accent: '#d9d2bf', wood: 1, font: 'helvetica' },
  sections: [1, 2, 3].map(i => ({
    title: `921 Oscillator ${i}`, c: [
      S(`r${i}`, 'Range', FEET, i === 3 ? 1 : 2),
      K(`t${i}`, 'Frequency', -7, 7, i === 2 ? 0.08 : 0, ST),
      S(`w${i}`, 'Output', ['Sine', 'Triangle', 'Sawtooth', 'Rectangular'], i === 3 ? 3 : 2),
      K(`pw${i}`, 'Width', 0.05, 0.5, 0.5, PCT),
      K(`l${i}`, 'Level', 0, 10, i === 3 ? 0 : i === 2 ? 6 : 8),
    ],
  })).concat([
    { title: '923 Noise', c: [K('nz', 'Level', 0, 10, 0), S('nc', 'Colour', ['White', 'Pink'], 0)] },
    { title: '904A Low Pass', c: [K('fc', 'Fixed CV', 0, 10, 5, F(30, 18000)), K('rg', 'Regeneration', 0, 10, 2), K('ea', 'Env Amount', 0, 10, 6), B('kb', 'Kbd CV', 1)] },
    { title: '904B High Pass', c: [K('hp', 'Cutoff', 0, 10, 0, F(16, 2000))] },
    { title: '911 → 904A', c: [K('a1', 'T1 Attack', 0, 10, 2, T(0.002, 10)), K('b1', 'T2 Decay', 0, 10, 5, T(0.004, 10)), K('s1', 'E sus', 0, 10, 4), K('c1', 'T3 Release', 0, 10, 4, T(0.004, 10))] },
    { title: '911 → 902 VCA', c: [K('a2', 'T1 Attack', 0, 10, 1.5, T(0.002, 10)), K('b2', 'T2 Decay', 0, 10, 5, T(0.004, 10)), K('s2', 'E sus', 0, 10, 8), K('c2', 'T3 Release', 0, 10, 4, T(0.004, 10))] },
    { title: 'Controller', c: [K('gl', 'Portamento', 0, 10, 0, GLIDE), K('vol', 'Output', 0, 10, 7)] },
  ]),
  presets: [
    { name: 'Switched-On Lead', v: { w1: 2, w2: 2, t2: 0.1, l3: 3, r3: 3, w3: 3, fc: dial(1400, 30, 18000), rg: 3, ea: 5, gl: 3, a1: 2.5, b1: 5.5, s1: 3 } },
    { name: 'Cathedral Bass', v: { r1: 1, r2: 1, r3: 0, w3: 2, l3: 6, t2: -0.1, fc: dial(300, 30, 18000), rg: 2, ea: 6, b1: 4, s1: 2, a2: 1, b2: 5, s2: 10, c2: 3, vol: 4.7 } },
    { name: 'Bach Harpsichord', v: { w1: 3, pw1: 0.2, w2: 2, r2: 3, l2: 4, fc: dial(800, 30, 18000), rg: 1, ea: 8, a1: 0.5, b1: 4, s1: 0, c1: 4, a2: 0.5, b2: 5.8, s2: 0, c2: 4.5, vol: 9 } },
    { name: 'Sine Choir', v: { w1: 0, w2: 0, w3: 0, l3: 6, r3: 3, t2: 0.12, t3: -0.1, l2: 7, fc: dial(5000, 30, 18000), rg: 0, ea: 0, a2: 6, b2: 6, s2: 10, c2: 6.5, gl: 1.5, vol: 2.1 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'mono'; p.prio = 'low'; p.legato = true; p.glide = glideT(v.gl);
    p.drift = G.drift * 1.6; p.sawBow = 0.05; p.bw = 26000; p.level = v.vol / 10 * 1.09;
    for (let i = 0; i < 3; i++) {
      const n = i + 1, w = v[`w${n}`], lev = v[`l${n}`] / 10 * 0.75;
      p.osc[i] = osc({ on: lev > 0 ? 1 : 0, lev, oct: FEET_ST[v[`r${n}`]], fine: v[`t${n}`] * 100, sine: w === 0 ? 1 : 0, tri: w === 1 ? 1 : 0, saw: w === 2 ? 1 : 0, pulse: w === 3 ? 1 : 0, pw: v[`pw${n}`] });
    }
    p.noise = v.nz / 10 * 0.7; p.pink = v.nc;
    Object.assign(p.vcf, { type: 'moog', oct: lg(P.fc), res: v.rg / 10, env: v.ea / 10 * 5, kbd: v.kb ? 1 : 0, drive: 0.9 });
    if (v.hp > 0.05) p.hpf = { type: '4p', oct: lg(P.hp), res: 0 }; // 904B: 24 dB/oct ladder HP, no regeneration
    p.fenv = { a: P.a1, d: P.b1, s: v.s1 / 10, r: P.c1 };
    p.aenv = { a: P.a2, d: P.b2, s: v.s2 / 10, r: P.c2 };
    p.lfo.rate = 5.5; p.lfo.wheelPitch = 0.6;
    return p;
  },
};

/* ================================================================ 1970 */
const MOOG_W = [{ tri: 1 }, { tri: 0.6, saw: 0.55 }, { saw: 1 }, { pulse: 1, pw: 0.5 }, { pulse: 1, pw: 0.3 }, { pulse: 1, pw: 0.14 }];
const MOOG_W3 = [{ tri: 1 }, { saw: -1 }, { saw: 1 }, { pulse: 1, pw: 0.5 }, { pulse: 1, pw: 0.3 }, { pulse: 1, pw: 0.14 }];
const MINI_R = ['LO', '32\'', '16\'', '8\'', '4\'', '2\''];
const MINI_RS = [-60, -24, -12, 0, 12, 24];
const minimoog = {
  id: 'minimoog', name: 'Minimoog', model: 'Model D', maker: 'Moog Music', year: 1970,
  tag: 'Mono · 3 VCO · 24 dB/oct transistor ladder · low-note priority',
  about: 'The voice of 70s prog, funk and electro. Three free-running VCOs into the mixer, which overdrives the ladder filter when pushed — and the external input can take the output back in, the famous feedback trick for extra grit. Single-trigger, low-note priority, as on the original keyboard.',
  theme: { ctl: 'knob', knob: 'moog', panel: '#141414', face: '#0d0d0d', ink: '#f2efe6', label: '#cfc9b8', accent: '#3b82c4', wood: 1, font: 'helvetica' },
  sections: [
    { title: 'Controllers', c: [K('tune', 'Tune', -1, 1, 0, ST), K('gl', 'Glide', 0, 10, 0, GLIDE), K('mm', 'Mod Mix', 0, 10, 0, { fmt: v => v < 0.5 ? 'Osc 3' : v > 9.5 ? 'Noise' : v.toFixed(1) })] },
    {
      title: 'Oscillator Bank', wide: 1, c: [
        S('r1', 'Osc 1 Range', MINI_R, 3), S('w1', 'Osc 1 Wave', ['Tri', 'Tri-Saw', 'Saw', 'Square', 'Wide', 'Narrow'], 2),
        S('r2', 'Osc 2 Range', MINI_R, 3), K('f2', 'Osc 2 Freq', -7, 7, 0.07, ST), S('w2', 'Osc 2 Wave', ['Tri', 'Tri-Saw', 'Saw', 'Square', 'Wide', 'Narrow'], 2),
        S('r3', 'Osc 3 Range', MINI_R, 2), K('f3', 'Osc 3 Freq', -7, 7, -0.05, ST), S('w3', 'Osc 3 Wave', ['Tri', 'Rev Saw', 'Saw', 'Square', 'Wide', 'Narrow'], 2),
        B('om', 'Osc Mod', 0), B('o3k', 'Osc 3 Ctrl', 1),
      ],
    },
    {
      title: 'Mixer', c: [
        K('v1', 'Osc 1', 0, 10, 8), B('m1', 'On', 1), K('v2', 'Osc 2', 0, 10, 6), B('m2', 'On', 1), K('v3', 'Osc 3', 0, 10, 4), B('m3', 'On', 1),
        K('ext', 'External', 0, 10, 0), B('me', 'On', 0), K('nz', 'Noise', 0, 10, 0), B('mn', 'On', 0), S('nc', 'Noise', ['White', 'Pink'], 0),
      ],
    },
    {
      title: 'Modifiers · Filter', c: [
        K('fc', 'Cutoff', 0, 10, 5, F(20, 20000)), K('em', 'Emphasis', 0, 10, 3), K('ca', 'Contour Amt', 0, 10, 5),
        B('fm', 'Filter Mod', 0), B('k1', 'Kbd Ctrl 1', 0), B('k2', 'Kbd Ctrl 2', 1),
        K('fa', 'Attack', 0, 10, 1, T(0.001, 10)), K('fd', 'Decay', 0, 10, 5, T(0.004, 35)), K('fs', 'Sustain', 0, 10, 4),
      ],
    },
    { title: 'Loudness Contour', c: [K('la', 'Attack', 0, 10, 0.5, T(0.001, 10)), K('ld', 'Decay', 0, 10, 5, T(0.004, 35)), K('ls', 'Sustain', 0, 10, 10), B('dk', 'Decay', 0)] },
    { title: 'Output', c: [K('vol', 'Volume', 0, 10, 5)] },
  ],
  presets: [
    { name: 'Classic Lead', v: { w1: 2, w2: 2, w3: 2, r3: 4, v3: 3, f2: 0.1, fc: dial(900, 20, 20000), em: 4, ca: 6, fa: 2, fd: 5.5, fs: 4, gl: 2, vol: 6.4 } },
    { name: 'Fat Bass', v: { r1: 2, r2: 2, r3: 1, w2: 3, w3: 2, v3: 6, f2: -0.08, fc: dial(260, 20, 20000), em: 3, ca: 6, fa: 0, fd: 4.2, fs: 2, la: 0, ld: 4.5, ls: 10, dk: 1, vol: 4.3 } },
    { name: 'Lucky Lead', v: { w1: 3, w2: 2, w3: 4, r3: 4, v2: 7, v3: 3, f2: 0.12, fc: dial(1500, 20, 20000), em: 6, ca: 4, fa: 2.5, fd: 6, fs: 6, gl: 4.5, vol: 5.4 } },
    { name: 'Feedback Growl', v: { r1: 2, w2: 3, r3: 2, w3: 5, ext: 6, me: 1, fc: dial(650, 20, 20000), em: 5, ca: 5, fd: 5, fs: 3, vol: 4.4 } },
    { name: 'Funk Pluck', v: { r1: 2, r2: 2, w1: 4, w2: 2, m3: 0, f2: 0.05, fc: dial(320, 20, 20000), em: 7, ca: 7, fa: 0, fd: 3.6, fs: 0, ld: 4.4, ls: 0, dk: 1, vol: 10 } },
    { name: 'Whistle (self-osc)', v: { vol: 10, m1: 0, m2: 0, m3: 0, nz: 1.5, mn: 1, fc: 3.764, em: 10, ca: 0, k1: 1, k2: 1, gl: 2.5, la: 1.5, ld: 6, ls: 10 } }, // fc: self-oscillates on the played key (C4 → C4); a breath of noise starts it
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'mono'; p.prio = 'low'; p.legato = true; p.glide = glideT(v.gl);
    p.drift = G.drift; p.sawBow = 0.07; p.bw = 30000; p.level = v.vol / 10 * 1.14;
    const ws = [MOOG_W[v.w1], MOOG_W[v.w2], MOOG_W3[v.w3]];
    const rs = [v.r1, v.r2, v.r3], fr = [0, v.f2, v.f3], vl = [v.v1 * v.m1, v.v2 * v.m2, v.v3 * v.m3];
    for (let i = 0; i < 3; i++) {
      const lev = vl[i] / 10 * 0.9;
      p.osc[i] = osc(Object.assign({ on: lev > 0 || i === 2 ? 1 : 0, lev, oct: MINI_RS[rs[i]] + fr[i] + v.tune, kbd: i === 2 ? v.o3k : 1 }, ws[i]));
    }
    p.noise = v.mn ? v.nz / 10 * 0.8 : 0; p.pink = v.nc;
    p.ext = v.me ? v.ext / 10 * 1.6 : 0;
    p.mod3 = (v.om || v.fm) ? { mix: v.mm / 10, osc: v.om, filt: v.fm } : null;
    const kbd = (v.k1 ? 1 / 3 : 0) + (v.k2 ? 2 / 3 : 0);
    Object.assign(p.vcf, { type: 'moog', oct: lg(P.fc), res: v.em / 10 * 1.02, env: v.ca / 10 * 4.5, kbd, drive: 0.75 });
    p.fenv = { a: P.fa, d: P.fd, s: v.fs / 10, r: v.dk ? P.fd : 0.012 };
    p.aenv = { a: P.la, d: P.ld, s: v.ls / 10, r: v.dk ? P.ld : 0.012 };
    p.lfo.rate = 5.5;
    p.lfo.wheelPitch = p.mod3 ? 0 : 0.5; // the Model D wheel only scales the mod bus when a Mod switch is on
    return p;
  },
};

/* ================================================================ 1971 */
const arp2600 = {
  id: 'arp2600', name: 'ARP 2600', model: '2600', maker: 'ARP Instruments', year: 1971,
  tag: 'Mono · 3 VCO · 4072 ladder VCF · S&H · ring mod',
  about: 'Semi-modular classroom legend (and R2-D2’s voice). Presented with its normalled signal path: three VCOs, ring modulator and noise into the 4072 four-pole filter, ADSR and AR envelopes, and the sample-and-hold driven by the internal clock.',
  theme: { ctl: 'slider', knob: 'arp', panel: '#bfc6c9', face: '#d9dee0', ink: '#1d2a33', label: '#24343f', accent: '#1f5f8b', cap: '#f4f4f0', font: 'helvetica' },
  sections: [
    { title: 'VCO-1', c: [K('c1', 'Coarse', -24, 24, 0, Object.assign({}, ST, { step: 1 })), K('f1', 'Fine', -50, 50, 0, CT), S('w1', 'Wave', ['Saw', 'Square'], 0), K('l1', 'Level', 0, 10, 8)] },
    { title: 'VCO-2', c: [K('c2', 'Coarse', -24, 24, 0, Object.assign({}, ST, { step: 1 })), K('f2', 'Fine', -50, 50, 7, CT), S('w2', 'Wave', ['Saw', 'Pulse', 'Tri', 'Sine'], 0), K('pw2', 'PW', 0.05, 0.95, 0.3, PCT), K('fm', 'FM ← 1', 0, 10, 0), K('fe2', 'FM ← ADSR', 0, 10, 0), B('sy', 'Sync', 0), K('l2', 'Level', 0, 10, 6)] },
    { title: 'VCO-3', c: [K('c3', 'Coarse', -24, 24, -12, Object.assign({}, ST, { step: 1 })), K('f3', 'Fine', -50, 50, -5, CT), S('w3', 'Wave', ['Saw', 'Pulse'], 1), K('l3', 'Level', 0, 10, 0)] },
    { title: 'Noise · Ring', c: [K('nz', 'Noise', 0, 10, 0), S('nc', 'Colour', ['White', 'Pink'], 0), K('rm', 'Ring Mod', 0, 10, 0)] },
    { title: '4072 VCF', c: [K('fc', 'Cutoff', 0, 10, 5, F(20, 16000)), K('rs', 'Resonance', 0, 10, 3), K('ea', 'ADSR', 0, 10, 5), K('lf', 'S&H / LFO', 0, 10, 0), B('kb', 'Kbd CV', 1)] },
    { title: 'Clock · S&H', c: [K('lr', 'Rate', 0, 10, 6, { conv: v => ex(v, 0.1, 30), fmt: v => fmtHz(ex(v, 0.1, 30)) }), S('lw', 'Source', ['Sine', 'Tri', 'Square', 'S&H'], 3), K('lp', '→ Pitch', 0, 10, 0)] },
    { title: 'ADSR', c: [K('a', 'Attack', 0, 10, 1, T(0.001, 8)), K('d', 'Decay', 0, 10, 5, T(0.004, 10)), K('s', 'Sustain', 0, 10, 5), K('r', 'Release', 0, 10, 4, T(0.004, 10))] },
    { title: 'AR', c: [K('ara', 'Attack', 0, 10, 0.5, T(0.001, 8)), K('arr', 'Release', 0, 10, 4, T(0.004, 10))] },
    { title: 'VCA', c: [S('src', 'Control', ['AR', 'ADSR'], 1), K('gl', 'Portamento', 0, 10, 0, GLIDE), K('vol', 'Output', 0, 10, 7)] },
  ],
  presets: [
    { name: 'Droid Bleeps', v: { l1: 0, w2: 3, l2: 8, c2: 12, fc: dial(9000, 20, 16000), rs: 2, ea: 0, lr: 7.5, lw: 3, lp: 7, src: 0, ara: 0, arr: 3, gl: 1, vol: 3.4 } },
    { name: 'Sync Sweep', v: { w2: 0, sy: 1, c2: 7, fe2: 6, l1: 0, l2: 8, fm: 0, fc: dial(3000, 20, 16000), rs: 3, ea: 4, a: 0, d: 6.8, s: 2, src: 0, vol: 4.4 } },
    { name: 'Ring Bells', v: { l1: 0, l2: 0, rm: 8, w1: 1, w2: 3, c2: 7, f2: 20, fc: dial(6000, 20, 16000), rs: 1, ea: 2, src: 0, ara: 0, arr: 6, vol: 3.1 } },
    { name: 'Growl Bass', v: { c1: -12, c2: -12, f2: -6, w2: 1, pw2: 0.35, c3: -24, l3: 5, fc: dial(280, 20, 16000), rs: 5, ea: 6, a: 0, d: 4.3, s: 2, r: 3, src: 1, vol: 5.4 } },
    { name: 'FM Clang', v: { l1: 0, w2: 0, l2: 8, fm: 6, c1: 7, fc: dial(5000, 20, 16000), rs: 2, ea: 3, a: 0, d: 5, s: 0, r: 5, src: 1, vol: 9.3 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'mono'; p.prio = 'last'; p.legato = true; p.glide = glideT(v.gl);
    p.drift = G.drift * 1.2; p.sawBow = 0.03; p.bw = 25000; p.level = v.vol / 10 * 1.33;
    const W2 = [{ saw: 1 }, { pulse: 1 }, { tri: 1 }, { sine: 1 }][v.w2];
    p.osc[0] = osc(Object.assign({ on: 1, lev: v.l1 / 10 * 0.85, oct: v.c1, fine: v.f1 }, v.w1 ? { pulse: 1, pw: 0.5 } : { saw: 1 }));
    p.osc[1] = osc(Object.assign({ on: 1, lev: v.l2 / 10 * 0.85, oct: v.c2, fine: v.f2, pw: v.pw2, envPitch: v.fe2 / 10 * 36 }, W2)); // fenv is the ADSR
    p.osc[2] = osc(Object.assign({ on: v.l3 > 0 ? 1 : 0, lev: v.l3 / 10 * 0.85, oct: v.c3, fine: v.f3 }, v.w3 ? { pulse: 1, pw: 0.5 } : { saw: 1 }));
    p.sync = v.sy; p.fm01 = v.fm / 10 * 2.5;
    p.noise = v.nz / 10 * 0.8; p.pink = v.nc; p.ring = v.rm / 10 * 0.9;
    Object.assign(p.vcf, { type: 'moog', oct: lg(P.fc), res: v.rs / 10, env: v.ea / 10 * 5, kbd: v.kb ? 1 : 0, lfo: v.lf / 10 * 4, drive: 0.8, comp: 0.35 });
    p.fenv = { a: P.a, d: P.d, s: v.s / 10, r: P.r };
    p.aenv = v.src ? { a: P.a, d: P.d, s: v.s / 10, r: P.r } : { a: P.ara, d: 1, s: 1, r: P.arr };
    p.lfo = { rate: P.lr, wave: [1, 0, 4, 5][v.lw], delay: 0, pitch: v.lp / 10 * 24, amp: 0, wheelPitch: 0.5, wheelFilter: 0 };
    return p;
  },
};

/* ================================================================ 1974 */
const solina = {
  id: 'solina', name: 'Solina', model: 'String Ensemble', maker: 'ARP / Eminent', year: 1974,
  tag: 'Fully polyphonic divide-down · MK50240 top-octave generator · 3-phase BBD ensemble',
  about: 'Every key sounds: a 2.00024 MHz master clock is divided by the real MK50240 integer divisors (so tuning is very slightly off equal temperament, exactly like the chip), then by flip-flops down the octaves — every C on the keyboard is phase-locked to every other C. The magic is the ensemble: three delay lines swept by slow and fast LFOs 120° apart.',
  theme: { ctl: 'knob', knob: 'solina', panel: '#2a211b', face: '#1b1511', ink: '#f3e7cf', label: '#e0cfae', accent: '#f2a33a', wood: 1, font: 'helvetica' },
  sections: [
    { title: 'Bass', c: [B('cb', 'Contrabass', 0), B('ce', 'Cello', 1)] },
    { title: 'Orchestra', c: [B('va', 'Viola', 1), B('vn', 'Violin', 1), B('tp', 'Trumpet', 0), B('hn', 'Horn', 0)] },
    { title: 'Envelope', c: [K('cr', 'Crescendo', 0, 10, 4, T(0.005, 2.5)), K('su', 'Sustain', 0, 10, 5, T(0.05, 5))] },
    { title: 'Ensemble', c: [B('en', 'Ensemble', 1), K('tn', 'Tone', 0, 10, 5), K('vol', 'Volume', 0, 10, 5)] },
  ],
  presets: [
    { name: 'Full Strings', v: {} },
    { name: 'Violins Only', v: { ce: 0, va: 0, vn: 1, tn: 6.5, vol: 7.1 } },
    { name: 'Dark Cellos', v: { ce: 1, cb: 1, va: 0, vn: 0, tn: 3.5, cr: 5, su: 6, vol: 5.2 } },
    { name: 'Brass Section', v: { ce: 0, va: 0, vn: 0, tp: 1, hn: 1, en: 1, cr: 2.5, vol: 7.8 } },
    { name: 'Dry Organ', v: { en: 0, va: 1, vn: 1, hn: 1, cr: 0.5, su: 2, vol: 7.7 } },
  ],
  map(P, v, G) {
    return {
      engine: 'divide', mode: 'poly', poly: 0, bendRange: 2, drift: 0,
      reg: { bass: v.cb, cello: v.ce, viola: v.va, violin: v.vn, trumpet: v.tp, horn: v.hn },
      attack: P.cr, release: P.su, tone: (v.tn - 5) / 5, level: v.vol / 10 * 0.042,
      lfo: { rate: 1, wave: 0, delay: 0, pitch: 0, amp: 0, wheelPitch: 0, wheelFilter: 0 },
      fx: { chorus: 0, ensemble: v.en, hiss: 0 }, dac: 0,
    };
  },
};

/* ================================================================ 1977 */
const csLayer = (n, d) => ({
  title: `Channel ${n === 1 ? 'I' : 'II'}`, c: [
    S(`ft${n}`, 'Feet', ['16\'', '8\'', '4\''], 1), K(`sw${n}`, 'Saw', 0, 10, d.sw), K(`sq${n}`, 'Square', 0, 10, d.sq), K(`pw${n}`, 'PW', 0.05, 0.5, 0.5, PCT),
    K(`sn${n}`, 'Sine', 0, 10, 0), K(`hp${n}`, 'HPF', 0, 10, 0, F(20, 3000)), K(`hr${n}`, 'HPF Res', 0, 10, 0),
    K(`lp${n}`, 'LPF', 0, 10, d.lp, F(60, 18000)), K(`lr${n}`, 'LPF Res', 0, 10, d.lr), K(`lv${n}`, 'Level', 0, 10, d.lv),
  ].concat(n === 2 ? [K('dt', 'Detune', 0, 10, 3, { fmt: v => '+' + (v * 2.5).toFixed(1) + ' ct' })] : []),
});
const cs80 = {
  id: 'cs80', name: 'CS-80', model: 'Polyphonic Synthesizer', maker: 'Yamaha', year: 1977,
  tag: '8-voice · 2 layered channels · 12 dB HPF + LPF per channel · touch response',
  about: 'Vangelis’ Blade Runner brass. Each voice is two complete synth channels in parallel, each with its own resonant 12 dB high-pass and low-pass filters, sharing the IL/AL filter envelope and the ring modulator. Velocity opens the brilliance; channel aftertouch (MIDI) does too.',
  theme: { ctl: 'slider', knob: 'yamaha', panel: '#1e1d1c', face: '#2a2826', ink: '#f0ece4', label: '#d7d1c4', accent: '#e24b2c', cap: '#e8e2d2', capColors: ['#e24b2c', '#f2c12e', '#2f8fd8', '#ece6d6', '#3fae5a'], wood: 1, font: 'helvetica' },
  sections: [
    csLayer(1, { sw: 8, sq: 0, lp: 5, lr: 2, lv: 8 }),
    csLayer(2, { sw: 6, sq: 3, lp: 4.5, lr: 1, lv: 7 }),
    { title: 'Noise · Ring', c: [K('nz', 'Noise', 0, 10, 0), K('rms', 'RM Speed', 0, 10, 5, F(0.5, 2000)), K('rmd', 'RM Depth', 0, 10, 0)] },
    { title: 'Filter EG', c: [K('il', 'IL', -5, 5, 0), K('al', 'AL', -5, 5, 3), K('fa', 'Attack', 0, 10, 4, T(0.002, 6)), K('fd', 'Decay', 0, 10, 5, T(0.01, 8)), K('fr', 'Release', 0, 10, 4, T(0.01, 8))] },
    { title: 'Amp EG', c: [K('aa', 'Attack', 0, 10, 3, T(0.002, 6)), K('ad', 'Decay', 0, 10, 5, T(0.01, 8)), K('as', 'Sustain', 0, 10, 8), K('ar', 'Release', 0, 10, 5, T(0.01, 8))] },
    { title: 'Brilliance · Touch', c: [K('br', 'Brilliance', -5, 5, 0), K('tv', 'Touch→Brill', 0, 10, 4), K('ta', 'Touch→Level', 0, 10, 5), K('at', 'After→Brill', 0, 10, 3)] },
    { title: 'Sub Oscillator', c: [K('ss', 'Speed', 0, 10, 5.5, { conv: v => ex(v, 0.1, 25), fmt: v => fmtHz(ex(v, 0.1, 25)) }), S('sf', 'Function', ['Sine', 'Saw↓', 'Saw↑', 'Square', 'Random'], 0), K('sv', 'VCO', 0, 10, 0), K('sfl', 'VCF', 0, 10, 0), K('sa', 'VCA', 0, 10, 0)] },
    { title: 'Performance', c: [K('gl', 'Portamento', 0, 10, 0, GLIDE), K('vol', 'Volume', 0, 10, 4.6)] },
  ],
  presets: [
    { name: 'Blade Brass', v: { sw1: 9, sw2: 8, sq2: 0, dt: 4, lp1: 3.6, lp2: 3.3, lr1: 3, lr2: 2, il: -1, al: 3.5, fa: 5, fd: 6, fr: 5, aa: 3.2, ad: 5, as: 9, ar: 5.8, tv: 6, sv: 1.2, ss: 5.2, vol: 3.8 } },
    { name: 'Wurlitzer Pad', v: { sw1: 0, sq1: 7, pw1: 0.3, sw2: 6, ft2: 0, lp1: 4.2, lp2: 3.8, al: 1, aa: 5.5, ad: 6, as: 9, ar: 6.5, dt: 5, sv: 1, sfl: 2, ss: 4, vol: 4.6 } },
    { name: 'Crystal Bell', v: { sw1: 0, sn1: 8, sw2: 0, sq2: 0, sn2: 6, ft2: 2, rmd: 6, rms: 9.43, lp1: 8, lp2: 8, al: 0, aa: 0, ad: 6.8, as: 0, ar: 7, vol: 7 } },
    { name: 'Resonant Sweep', v: { sw1: 9, sw2: 0, sq2: 6, lr1: 7, lr2: 6, lp1: 2, lp2: 3, hp1: 2, hr1: 3, il: 0, al: 5, fa: 6.5, fd: 7, aa: 4, as: 10, ar: 6, vol: 2.5 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'poly'; p.poly = 8; p.glide = glideT(v.gl);
    p.drift = G.drift * 1.1; p.sawBow = 0.04; p.bw = 24000; p.level = v.vol / 10 * 0.57;
    const fs = [-12, 0, 12];
    p.osc[0] = osc({ on: 1, lev: v.lv1 / 10 * 0.8, oct: fs[v.ft1], saw: v.sw1 / 10, pulse: v.sq1 / 10, sine: v.sn1 / 10, pw: v.pw1 });
    p.osc[1] = osc({ on: 1, lev: v.lv2 / 10 * 0.8, oct: fs[v.ft2], fine: v.dt * 2.5, saw: v.sw2 / 10, pulse: v.sq2 / 10, sine: v.sn2 / 10, pw: v.pw2 });
    p.noise = v.nz / 10 * 0.7;
    // ring modulator section: a free-running sine (not keyboard-tracked) on the voice output. Depth is 'rmd', not the old
    // osc x osc 'rm' amount, so patches saved before keep a dry voice instead of gaining a 31.6 Hz tremolo
    p.rm = v.rmd > 0 ? { rate: P.rms, depth: v.rmd / 10 } : null;
    const br = v.br * 0.5;
    Object.assign(p.vcf, { type: 'svf', mode: 0, sat: 0.7, oct: lg(P.lp1) + br, res: v.lr1 / 10 * 0.95, envOff: v.il * 0.7, env: (v.al - v.il) * 0.7, kbd: 0.5, vel: v.tv / 10 * 3.5, at: v.at / 10 * 2, lfo: v.sfl / 10 * 2, drive: 0.8 });
    p.hpf = { type: 'svf', oct: lg(P.hp1), res: v.hr1 / 10 * 0.9 };
    p.dual = { oct: lg(P.lp2) + br, res: v.lr2 / 10 * 0.95, hoct: lg(P.hp2), hres: v.hr2 / 10 * 0.9 };
    // IL/AL filter EG: IL → AL over Attack, → 0 (the LPF sliders) over Decay, back to IL over Release (envOff/env are only a fallback)
    p.fenvIL = { il: v.il * 0.7, al: v.al * 0.7 };
    p.fenv = { a: P.fa, d: P.fd, s: 0, r: P.fr };
    p.aenv = { a: P.aa, d: P.ad, s: v.as / 10, r: P.ar };
    p.velAmp = v.ta / 10;
    p.lfo = { rate: P.ss, wave: [1, 3, 2, 4, 5][v.sf], delay: 0, pitch: v.sv / 10 * 1.5, amp: v.sa / 10 * 0.5, wheelPitch: 0.4, wheelFilter: 0 };
    return p;
  },
};

/* ================================================================ 1978 */
const prophet5 = {
  id: 'prophet5', name: 'Prophet-5', model: 'Rev 3', maker: 'Sequential Circuits', year: 1978,
  tag: '5-voice · CEM3340 VCOs · CEM3320 / SSM2040 4-pole filter · Poly-Mod',
  about: 'The first fully programmable polysynth. Oscillator A can be hard-synced to B; Poly-Mod routes the filter envelope and Osc B into Osc A’s pitch and width or the filter, per voice, at audio rate. Switch between the Rev 3 (CEM3320) and earlier Rev 2 (SSM2040) filter.',
  theme: { ctl: 'knob', knob: 'prophet', panel: '#151515', face: '#0f0f0f', ink: '#f1f1f1', label: '#d8d8d8', accent: '#d9302c', wood: 1, font: 'helvetica' },
  sections: [
    { title: 'Poly-Mod', c: [K('pmf', 'Filt Env', 0, 10, 0), K('pmo', 'Osc B', 0, 10, 0), B('pdf', 'Freq A', 0), B('pdp', 'PW A', 0), B('pdl', 'Filter', 0)] },
    { title: 'LFO', c: [K('lr', 'Frequency', 0, 10, 5, { conv: v => ex(v, 0.05, 25), fmt: v => fmtHz(ex(v, 0.05, 25)) }), S('lw', 'Shape', ['Tri', 'Saw', 'Square'], 0), K('li', 'Initial Amt', 0, 10, 0)] },
    { title: 'Wheel-Mod', c: [B('wfa', 'Freq A', 1), B('wfb', 'Freq B', 1), B('wpa', 'PW A', 0), B('wpb', 'PW B', 0), B('wfl', 'Filter', 0)] },
    { title: 'Oscillator A', c: [K('fa', 'Frequency', -24, 24, 0, Object.assign({}, ST, { step: 1 })), B('asw', 'Saw', 1), B('asq', 'Pulse', 0), K('apw', 'PW', 0.05, 0.95, 0.5, PCT), B('sy', 'Sync', 0)] },
    { title: 'Oscillator B', c: [K('fb', 'Frequency', -24, 24, 0, Object.assign({}, ST, { step: 1 })), K('fbf', 'Fine', -50, 50, 6, CT), B('bsw', 'Saw', 1), B('btr', 'Tri', 0), B('bsq', 'Pulse', 0), K('bpw', 'PW', 0.05, 0.95, 0.5, PCT), B('blo', 'Lo Freq', 0), B('bkb', 'Kbd', 1)] },
    { title: 'Mixer', c: [K('ma', 'Osc A', 0, 10, 8), K('mb', 'Osc B', 0, 10, 7), K('mn', 'Noise', 0, 10, 0)] },
    { title: 'Filter', c: [K('cf', 'Cutoff', 0, 10, 5, F(20, 18000)), K('rs', 'Resonance', 0, 10, 2), K('fe', 'Env Amt', 0, 10, 5), S('fk', 'Keyboard', ['Off', 'Half', 'Full'], 2), S('rev', 'Filter', ['Rev 2 · SSM', 'Rev 3 · CEM'], 1)] },
    { title: 'Filter Envelope', c: [K('eA', 'Attack', 0, 10, 1, T(0.001, 10)), K('eD', 'Decay', 0, 10, 5, T(0.004, 10)), K('eS', 'Sustain', 0, 10, 4), K('eR', 'Release', 0, 10, 5, T(0.004, 10))] },
    { title: 'Amplifier Envelope', c: [K('aA', 'Attack', 0, 10, 0.5, T(0.001, 10)), K('aD', 'Decay', 0, 10, 5, T(0.004, 10)), K('aS', 'Sustain', 0, 10, 9), K('aR', 'Release', 0, 10, 5, T(0.004, 10))] },
    { title: 'Performance', c: [K('gl', 'Glide', 0, 10, 0, GLIDE), B('un', 'Unison', 0), K('ud', 'Uni Detune', 0, 10, 3), K('vol', 'Volume', 0, 10, 7)] },
  ],
  presets: [
    { name: 'Brass', v: { asw: 1, bsw: 1, fbf: 8, cf: dial(700, 20, 18000), rs: 1.5, fe: 5.5, eA: 4.8, eD: 6, eS: 6, eR: 5, aA: 3.5, aS: 10, aR: 5.2, vol: 5.8 } },
    { name: 'Sync Lead', v: { sy: 1, fa: 12, bsw: 0, bsq: 0, mb: 0, pmf: 6, pdf: 1, cf: dial(4000, 20, 18000), rs: 1, fe: 3, eA: 0, eD: 6.5, eS: 2, aS: 10, gl: 2, un: 1, ud: 2 } },
    { name: 'Poly Strings', v: { asw: 1, bsw: 1, fbf: 9, li: 1.5, lr: 4.2, cf: dial(1600, 20, 18000), rs: 0.5, fe: 2, eA: 6, eD: 6, eS: 6, aA: 6, aD: 6, aS: 10, aR: 6.5, vol: 5 } },
    { name: 'Poly-Mod Bell', v: { asw: 0, asq: 1, apw: 0.5, bsw: 0, btr: 1, fb: 19, mb: 0, pmo: 5, pdf: 1, cf: dial(5000, 20, 18000), fe: 0, aA: 0, aD: 6.5, aS: 0, aR: 6.5, vol: 8.4 } },
    { name: 'Unison Bass', v: { fa: -12, fb: -12, fbf: 4, bsq: 1, bsw: 0, bpw: 0.4, cf: dial(280, 20, 18000), rs: 3, fe: 5.5, eA: 0, eD: 4.3, eS: 1, aD: 5, aS: 10, aR: 3, un: 1, ud: 3, rev: 0, vol: 5.8 } },
    { name: 'Clav Pluck', v: { asw: 0, asq: 1, apw: 0.15, bsw: 0, bsq: 1, bpw: 0.25, fb: 12, mb: 4, cf: dial(500, 20, 18000), rs: 3, fe: 6, eA: 0, eD: 3.5, eS: 0, aA: 0, aD: 4.5, aS: 0, aR: 3.5, vol: 6.3 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = v.un ? 'unison' : 'poly'; p.poly = 5; p.unison = 5; p.unisonDetune = v.ud * 3;
    p.glide = glideT(v.gl); p.drift = G.drift; p.sawBow = 0.03; p.level = v.vol / 10 * (v.un ? 0.31 : 0.38);
    const levB = v.mb / 10 * 0.8;
    // Wheel-Mod destinations: the shared lfo.wheelPitch moves every keyboard-tracked oscillator, so it is used only
    // when both Freq A and Freq B are selected; otherwise each oscillator takes the wheel through its own wheelPitch.
    const wShared = v.wfa && v.wfb && v.bkb ? 1 : 0;
    const bnorm = Math.max(1, v.bsw + v.btr + v.bsq);
    p.osc[0] = osc({ on: 1, lev: levB, oct: v.fb + (v.blo ? -60 : 0), fine: v.fbf, saw: v.bsw / bnorm, tri: v.btr / bnorm, pulse: v.bsq / bnorm, pw: v.bpw, kbd: v.bkb, lfoPitch: v.wfb ? v.li / 10 * 2 : 0, pwLfo: v.wpb ? v.li / 10 * 0.4 : 0, wheelPitch: v.wfb && !wShared ? 1 : 0, wheelPw: v.wpb ? 0.4 : 0 });
    const anorm = Math.max(1, v.asw + v.asq);
    p.osc[1] = osc({ on: 1, lev: v.ma / 10 * 0.8, oct: v.fa, saw: v.asw / anorm, pulse: v.asq / anorm, pw: v.apw, lfoPitch: v.wfa ? v.li / 10 * 2 : 0, pwLfo: v.wpa ? v.li / 10 * 0.4 : 0, wheelPitch: v.wfa && !wShared ? 1 : 0, wheelPw: v.wpa ? 0.4 : 0, envPitch: v.pdf ? v.pmf / 10 * 36 : 0, pwEnv: v.pdp ? v.pmf / 10 * 0.45 : 0 });
    p.sync = v.sy;
    p.fm01 = v.pdf ? v.pmo / 10 * 3 : 0; p.polyOscPw = v.pdp ? v.pmo / 10 * 0.45 : 0; p.polyOscFilt = v.pdl ? v.pmo / 10 * 3 : 0;
    p.noise = v.mn / 10 * 0.7;
    const rev3 = v.rev === 1;
    Object.assign(p.vcf, {
      type: 'ota', oct: lg(P.cf), res: v.rs / 10 * 1.01, env: v.fe / 10 * 5 + (v.pdl ? v.pmf / 10 * 4 : 0), kbd: [0, 0.5, 1][v.fk],
      lfo: v.wfl ? v.li / 10 * 3 : 0, comp: rev3 ? 0.25 : 0.05, fbSat: rev3 ? 0.35 : 0.8, drive: rev3 ? 0.8 : 1.25,
    });
    p.fenv = { a: P.eA, d: P.eD, s: v.eS / 10, r: P.eR };
    p.aenv = { a: P.aA, d: P.aD, s: v.aS / 10, r: P.aR };
    p.lfo = { rate: P.lr, wave: [0, 2, 4][v.lw], delay: 0, pitch: 0, amp: 0, wheelPitch: wShared, wheelFilter: v.wfl ? 2 : 0 };
    return p;
  },
};

const ms20 = {
  id: 'ms20', name: 'MS-20', model: 'MS-20', maker: 'Korg', year: 1978,
  tag: 'Mono · 2 VCO · Korg 35 Sallen-Key HPF + LPF with diode-clipped resonance',
  about: 'Aggressive, screaming, gloriously dirty. The Korg 35 filters are Sallen-Key topologies whose resonance passes through diode clippers — so self-oscillation is loud and stable but the peak distorts and fights the input. Both the high-pass and the low-pass resonate.',
  theme: { ctl: 'knob', knob: 'korg', panel: '#0f0f0f', face: '#161616', ink: '#f4f4f4', label: '#d0d0d0', accent: '#ff6a13', font: 'helvetica' },
  sections: [
    { title: 'VCO 1', c: [S('w1', 'Waveform', ['Tri', 'Saw', 'Pulse', 'Noise'], 1), K('pw1', 'PW', 0.05, 0.5, 0.5, PCT), S('sc1', 'Scale', ['32\'', '16\'', '8\'', '4\''], 2)] },
    { title: 'VCO 2', c: [S('w2', 'Waveform', ['Saw', 'Square', 'Narrow', 'Ring'], 0), S('sc2', 'Scale', ['32\'', '16\'', '8\'', '4\''], 2), K('pt', 'Pitch', -12, 12, 0, ST)] },
    { title: 'Mixer', c: [K('l1', 'VCO 1', 0, 10, 8), K('l2', 'VCO 2', 0, 10, 0)] },
    { title: 'High Pass', c: [K('hc', 'Cutoff', 0, 10, 0, F(15, 4000)), K('hpk', 'Peak', 0, 10, 0)] },
    { title: 'Low Pass', c: [K('lc', 'Cutoff', 0, 10, 6, F(40, 18000)), K('lpk', 'Peak', 0, 10, 3)] },
    { title: 'Modulation', c: [K('mr', 'MG Freq', 0, 10, 4, { conv: v => ex(v, 0.1, 40), fmt: v => fmtHz(ex(v, 0.1, 40)) }), S('mw', 'MG Wave', ['Tri', 'Saw', 'Square'], 0), K('mp', 'MG→Pitch', 0, 10, 0), K('mc', 'MG→Cutoff', 0, 10, 0), K('ec', 'EG2→LPF', 0, 10, 5), K('eh', 'EG2→HPF', 0, 10, 0)] },
    { title: 'EG 2', c: [K('a', 'Attack', 0, 10, 0.5, T(0.001, 8)), K('d', 'Decay', 0, 10, 5, T(0.004, 10)), K('s', 'Sustain', 0, 10, 6), K('r', 'Release', 0, 10, 3, T(0.004, 10))] },
    { title: 'Control', c: [K('pr', 'Portamento', 0, 10, 0, GLIDE), K('mt', 'Master Tune', -1, 1, 0, ST), K('vol', 'Volume', 0, 10, 7)] },
  ],
  presets: [
    { name: 'Scream Lead', v: { w1: 1, w2: 0, l2: 6, pt: 0.1, lc: dial(1200, 40, 18000), lpk: 8.5, hc: dial(150, 15, 4000), hpk: 4, ec: 4, a: 1, d: 6, s: 6, vol: 6.2 } },
    { name: 'Acid Squelch', v: { w1: 2, pw1: 0.4, lc: dial(400, 40, 18000), lpk: 7.5, ec: 7, a: 0, d: 4.5, s: 1, r: 3, vol: 7.8 } },
    { name: 'Ring Metal', v: { w1: 2, pw1: 0.3, w2: 3, sc2: 3, pt: 5, l1: 3, l2: 8, lc: dial(5000, 40, 18000), lpk: 3, ec: 2, a: 0, d: 6, s: 0, r: 6, vol: 6.5 } },
    { name: 'Wind Noise', v: { w1: 3, lc: dial(900, 40, 18000), lpk: 9, hc: dial(400, 15, 4000), hpk: 6, mc: 4, mr: 2, ec: 0, a: 6, d: 6, s: 10, r: 7, vol: 6.2 } },
    { name: 'Wobble Bass', v: { sc1: 1, w1: 1, w2: 1, sc2: 1, l2: 6, lc: dial(250, 40, 18000), lpk: 6, mc: 6, mr: 4.4, mw: 0, ec: 3, a: 0, s: 10, vol: 2.6 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'mono'; p.prio = 'low'; p.legato = true; p.glide = glideT(v.pr);
    p.drift = G.drift * 1.1; p.sawBow = 0.05; p.bw = 22000; p.level = v.vol / 10 * 0.86;
    const sc = [-24, -12, 0, 12];
    const W1 = [{ tri: 1 }, { saw: 1 }, { pulse: 1, pw: v.pw1 }, {}][v.w1];
    const l1 = v.l1 / 10 * 0.9, l2 = v.l2 / 10 * 0.9;
    p.osc[0] = osc(Object.assign({ on: 1, lev: v.w1 === 3 ? 0 : l1, oct: sc[v.sc1] + v.mt }, W1));
    if (v.w1 === 3) p.noise = l1;
    const W2 = [{ saw: 1 }, { pulse: 1, pw: 0.5 }, { pulse: 1, pw: 0.1 }, { pulse: 1, pw: 0.5 }][v.w2];
    p.osc[1] = osc(Object.assign({ on: l2 > 0 ? 1 : 0, lev: v.w2 === 3 ? 0 : l2, oct: sc[v.sc2] + v.pt + v.mt }, W2));
    if (v.w2 === 3) { p.ring = l2; if (v.w1 === 3) p.osc[0] = osc({ on: 1, lev: 0, pulse: 1, oct: sc[v.sc1] + v.mt }); }
    p.osc[0].lfoPitch = v.mp / 10 * 12; p.osc[1].lfoPitch = v.mp / 10 * 12;
    p.hpf = { type: 'sk', oct: lg(P.hc), res: v.hpk / 10, env: v.eh / 10 * 5, clip: 1.4 };
    Object.assign(p.vcf, { type: 'sk', oct: lg(P.lc), res: v.lpk / 10, env: v.ec / 10 * 6, kbd: 0.3, lfo: v.mc / 10 * 4, drive: 1, clip: 1.4 });
    p.fenv = { a: P.a, d: P.d, s: v.s / 10, r: P.r };
    p.aenv = { a: P.a, d: P.d, s: v.s / 10, r: P.r };
    p.lfo = { rate: P.mr, wave: [0, 2, 4][v.mw], delay: 0, pitch: 0, amp: 0, wheelPitch: 0.6, wheelFilter: 0 };
    return p;
  },
};

/* ================================================================ 1981 */
const tb303 = {
  id: 'tb303', name: 'TB-303', model: 'Bass Line', maker: 'Roland', year: 1981,
  tag: 'Mono · 1 VCO · diode ladder · accent sweep circuit · slide',
  about: 'Acid house by accident. The diode-ladder filter is solved as four coupled capacitor nodes; its resonance limit is derived from the circuit itself. Accent shortens the filter envelope and charges the accent-sweep capacitor, so consecutive accents “wow” higher — turn up Resonance to hear it. Overlap notes to slide; velocity above 100 (or the latch) accents.',
  theme: { ctl: 'knob', knob: 'tb', panel: '#c4c6c6', face: '#d4d6d5', ink: '#1a1a1a', label: '#222', accent: '#d8371f', font: 'helvetica' },
  sections: [
    { title: 'Tuning', c: [K('tu', 'Tuning', -12, 12, 0, ST), S('wf', 'Waveform', ['Saw', 'Square'], 0)] },
    { title: 'VCF · VCA', wide: 1, c: [K('cf', 'Cut Off Freq', 0, 10, 4), K('rs', 'Resonance', 0, 10, 6), K('em', 'Env Mod', 0, 10, 5), K('dc', 'Decay', 0, 10, 4, T(0.2, 2.5)), K('ac', 'Accent', 0, 10, 6)] },
    { title: 'Performance', c: [B('al', 'Accent Latch', 0), K('vol', 'Volume', 0, 10, 7)] },
  ],
  presets: [
    { name: 'Squelch', v: { cf: 3.2, rs: 8.5, em: 7, dc: 3.5, ac: 8, vol: 5.6 } },
    { name: 'Deep Square', v: { wf: 1, cf: 2.5, rs: 5, em: 4, dc: 5, ac: 5, vol: 6.4 } },
    { name: 'Rubber', v: { cf: 1.5, rs: 9.5, em: 8.5, dc: 2.5, ac: 9, vol: 5.1 } },
    { name: 'Open Saw', v: { cf: 7, rs: 3, em: 2, dc: 6, ac: 4, vol: 9.5 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'mono'; p.prio = 'last'; p.legato = true; p.glide = 0.2; p.glideLegato = true;
    p.drift = G.drift * 0.4; p.sawBow = 0.03; p.bw = 20000; p.level = v.vol / 10 * 0.51;
    p.osc[0] = osc(Object.assign({ on: 1, lev: 0.9, oct: v.tu - 12 }, v.wf ? { pulse: 1, saw: 0.22, pw: 0.5 } : { saw: 1 }));
    const em = v.em / 10;
    Object.assign(p.vcf, { type: 'diode', oct: lg(ex(v.cf, 150, 3000)) - em * 0.6, res: v.rs / 10 * 0.985, env: em * 4.6, kbd: 0, drive: 1.2 });
    p.fenv = { a: 0.003, d: P.dc, s: 0, r: P.dc };
    p.aenv = { a: 0.002, d: 3.5, s: 0, r: 0.012 };
    const cr = (G.sr || 48000) / 4;
    p.tb = { accent: v.ac / 10, latch: v.al, chg: 1 - Math.exp(-1 / ((0.012 + v.rs / 10 * 0.05) * cr)), dis: 1 - Math.exp(-1 / ((0.08 + v.rs / 10 * 0.25) * cr)) };
    p.lfo.wheelPitch = 0.3;
    return p;
  },
};

const obxa = {
  id: 'obxa', name: 'OB-Xa', model: 'OB-Xa', maker: 'Oberheim', year: 1981,
  tag: '8-voice · 2 VCO · switchable 2-pole state-variable / 4-pole filter',
  about: 'The wall-of-brass polysynth (Jump, 1999). Two oscillators per voice with sync, a 12 dB filter with the open, resonant state-variable character of the SEM heritage, or a 4-pole mode. Unison stacks all eight voices.',
  theme: { ctl: 'knob', knob: 'ob', panel: '#101214', face: '#16191c', ink: '#eef3f7', label: '#c7d2db', accent: '#2c8be8', font: 'helvetica' },
  sections: [
    { title: 'Modulation', c: [K('lr', 'LFO Rate', 0, 10, 5, { conv: v => ex(v, 0.1, 20), fmt: v => fmtHz(ex(v, 0.1, 20)) }), S('lw', 'Wave', ['Sine', 'Square', 'S&H'], 0), K('lf', '→ Freq', 0, 10, 0), K('lp', '→ PWM', 0, 10, 0), K('lc', '→ Filter', 0, 10, 0)] },
    { title: 'Oscillator 1', c: [K('o1f', 'Frequency', -24, 24, 0, Object.assign({}, ST, { step: 1 })), B('o1s', 'Saw', 1), B('o1p', 'Pulse', 0)] },
    { title: 'Oscillator 2', c: [K('o2f', 'Frequency', -24, 24, 0, Object.assign({}, ST, { step: 1 })), K('o2d', 'Detune', -50, 50, 8, CT), B('o2s', 'Saw', 1), B('o2p', 'Pulse', 0), B('sy', 'Sync', 0)] },
    { title: 'Pulse Width', c: [K('pw', 'Width', 0.05, 0.5, 0.5, PCT)] },
    { title: 'Filter', c: [K('cf', 'Frequency', 0, 10, 5, F(30, 18000)), K('rs', 'Resonance', 0, 10, 2), K('fm', 'Modulation', 0, 10, 5), S('kb', 'Kbd Track', ['Off', 'Half', 'Full'], 1), S('pl', 'Slope', ['2-pole', '4-pole'], 0)] },
    { title: 'Filter Envelope', c: [K('fA', 'Attack', 0, 10, 1, T(0.001, 10)), K('fD', 'Decay', 0, 10, 5, T(0.004, 10)), K('fS', 'Sustain', 0, 10, 5), K('fR', 'Release', 0, 10, 5, T(0.004, 10))] },
    { title: 'Amp Envelope', c: [K('aA', 'Attack', 0, 10, 0.5, T(0.001, 10)), K('aD', 'Decay', 0, 10, 5, T(0.004, 10)), K('aS', 'Sustain', 0, 10, 9), K('aR', 'Release', 0, 10, 5, T(0.004, 10))] },
    { title: 'Control', c: [K('gl', 'Portamento', 0, 10, 0, GLIDE), B('un', 'Unison', 0), K('ud', 'Spread', 0, 10, 3), K('vol', 'Volume', 0, 10, 5.6)] },
  ],
  presets: [
    { name: 'Jump Brass', v: { o1s: 1, o2s: 1, o2d: 7, cf: dial(1300, 30, 18000), rs: 1.5, fm: 4.5, fA: 2, fD: 5.5, fS: 6, aA: 0.5, aS: 10, aR: 4.8, vol: 5.7 } },
    { name: 'Synth Strings', v: { o1s: 1, o2s: 1, o2d: 12, lf: 0.6, lr: 4.5, cf: dial(2200, 30, 18000), rs: 0.5, fm: 2, fA: 6, fS: 7, aA: 6, aD: 6, aS: 10, aR: 6.5, vol: 5.5 } },
    { name: 'Sync Stab', v: { o1s: 0, o1p: 1, o2s: 1, o2f: 7, sy: 1, cf: dial(3000, 30, 18000), rs: 2, fm: 5, fA: 0, fD: 4.5, fS: 2, aA: 0, aD: 5, aS: 6, aR: 4, vol: 6 } },
    { name: 'Unison Lead', v: { un: 1, ud: 4, o2d: 10, pl: 1, cf: dial(1000, 30, 18000), rs: 3, fm: 5, fA: 1, fD: 6, fS: 4, gl: 2, vol: 7 } },
    { name: 'PWM Pad', v: { o1s: 0, o1p: 1, o2s: 0, o2p: 1, pw: 0.35, lp: 4, lr: 3.5, o2d: 6, cf: dial(1800, 30, 18000), fm: 1.5, aA: 5.5, aD: 6, aS: 10, aR: 6.5, vol: 3.1 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = v.un ? 'unison' : 'poly'; p.poly = 8; p.unison = 8; p.unisonDetune = v.ud * 3;
    p.glide = glideT(v.gl); p.drift = G.drift; p.sawBow = 0.03; p.level = v.vol / 10 * (v.un ? 0.24 : 0.22);
    const n1 = Math.max(1, v.o1s + v.o1p), n2 = Math.max(1, v.o2s + v.o2p);
    const pwl = v.lp / 10 * 0.4;
    p.osc[0] = osc({ on: 1, lev: (v.o1s || v.o1p) ? 0.75 : 0, oct: v.o1f, saw: v.o1s / n1, pulse: v.o1p / n1, pw: v.pw, pwLfo: pwl, lfoPitch: v.lf / 10 * 3 });
    p.osc[1] = osc({ on: 1, lev: (v.o2s || v.o2p) ? 0.75 : 0, oct: v.o2f, fine: v.o2d, saw: v.o2s / n2, pulse: v.o2p / n2, pw: v.pw, pwLfo: pwl, lfoPitch: v.lf / 10 * 3 });
    p.sync = v.sy;
    const two = v.pl === 0;
    Object.assign(p.vcf, two
      ? { type: 'svf', mode: 0, sat: 0.9, oct: lg(P.cf), res: v.rs / 10 * 0.96, env: v.fm / 10 * 5.5, kbd: [0, 0.5, 1][v.kb], lfo: v.lc / 10 * 3, drive: 0.7 }
      : { type: 'ota', oct: lg(P.cf), res: v.rs / 10 * 1.01, env: v.fm / 10 * 5.5, kbd: [0, 0.5, 1][v.kb], lfo: v.lc / 10 * 3, comp: 0.25, fbSat: 0.4, drive: 0.8 });
    p.fenv = { a: P.fA, d: P.fD, s: v.fS / 10, r: P.fR };
    p.aenv = { a: P.aA, d: P.aD, s: v.aS / 10, r: P.aR };
    p.lfo = { rate: P.lr, wave: [1, 4, 5][v.lw], delay: 0, pitch: 0, amp: 0, wheelPitch: 0.6, wheelFilter: 0 };
    return p;
  },
};

const JUP_R = ['64\'', '32\'', '16\'', '8\'', '4\'', '2\''];
const jupiter8 = {
  id: 'jupiter8', name: 'Jupiter-8', model: 'JP-8', maker: 'Roland', year: 1981,
  tag: '8-voice · 2 VCO · cross-mod & sync · IR3109 12/24 dB OTA filter',
  about: 'Roland’s flagship: lush, wide and precise. VCO-2 can cross-modulate VCO-1 at audio rate and VCO-2 syncs to VCO-1. The IR3109 OTA cascade filter switches between 12 and 24 dB, preceded by a non-resonant high-pass.',
  theme: { ctl: 'slider', knob: 'roland', panel: '#141414', face: '#1b1b1b', ink: '#f0f0f0', label: '#cfcfcf', accent: '#ff8a1c', cap: '#262626', capLine: '#f0f0f0', capColors: ['#ff8a1c', '#f5d22e', '#e2402f', '#3b8fe0'], font: 'helvetica' },
  sections: [
    { title: 'LFO', c: [K('lr', 'Rate', 0, 10, 5, { conv: v => ex(v, 0.1, 25), fmt: v => fmtHz(ex(v, 0.1, 25)) }), K('ld', 'Delay', 0, 10, 0, { conv: v => v * 0.3, fmt: v => fmtT(v * 0.3) }), S('lw', 'Wave', ['Sine', 'Saw', 'Square', 'Random'], 0)] },
    { title: 'VCO Modulation', c: [K('vl', 'LFO Mod', 0, 10, 0), K('ve', 'Env-1 Mod', 0, 10, 0), S('vd', 'Dest', ['VCO-2', 'Both', 'VCO-1'], 1)] },
    { title: 'VCO-1', c: [K('xm', 'Cross Mod', 0, 10, 0), S('r1', 'Range', JUP_R, 3), S('w1', 'Wave', ['Tri', 'Saw', 'Pulse', 'Square'], 1)] },
    { title: 'VCO-2', c: [B('sy', 'Sync', 0), S('r2', 'Range', JUP_R, 3), K('ft', 'Fine', -50, 50, 6, CT), S('w2', 'Wave', ['Sine', 'Saw', 'Pulse', 'Noise'], 1), B('lo', 'Low Freq', 0)] },
    { title: 'Pulse Width', c: [K('pw', 'PW', 0.05, 0.5, 0.5, PCT), K('pwm', 'PWM', 0, 10, 0), S('pws', 'Source', ['LFO', 'Env-1'], 0)] },
    { title: 'Source Mix', c: [K('mx', 'VCO-1 ↔ 2', 0, 10, 5)] },
    { title: 'HPF', c: [K('hp', 'Cutoff', 0, 10, 0, F(18, 1500))] },
    { title: 'VCF', c: [K('cf', 'Cutoff', 0, 10, 5, F(30, 18000)), K('rs', 'Resonance', 0, 10, 2), S('sl', 'Slope', ['12 dB', '24 dB'], 1), K('fe', 'Env Mod', 0, 10, 5), K('fl', 'LFO Mod', 0, 10, 0), K('fk', 'Key Follow', 0, 10, 5)] },
    { title: 'VCA', c: [K('vlf', 'LFO Mod', 0, 10, 0), K('lvl', 'Level', 0, 10, 5.7)] },
    { title: 'Env-1', c: [K('e1a', 'A', 0, 10, 1, T(0.001, 10)), K('e1d', 'D', 0, 10, 5, T(0.004, 10)), K('e1s', 'S', 0, 10, 5), K('e1r', 'R', 0, 10, 5, T(0.004, 10))] },
    { title: 'Env-2', c: [K('e2a', 'A', 0, 10, 0.5, T(0.001, 10)), K('e2d', 'D', 0, 10, 5, T(0.004, 10)), K('e2s', 'S', 0, 10, 9), K('e2r', 'R', 0, 10, 5, T(0.004, 10))] },
    { title: 'Assign', c: [S('as', 'Mode', ['Poly', 'Unison', 'Solo'], 0), K('gl', 'Portamento', 0, 10, 0, GLIDE)] },
  ],
  presets: [
    { name: 'Lush Pad', v: { w1: 1, w2: 1, ft: 9, vl: 0.4, lr: 4.5, cf: dial(2000, 30, 18000), rs: 1, fe: 2, e1a: 6, e1d: 6, e1s: 6, e2a: 6, e2d: 6, e2s: 10, e2r: 6.5, lvl: 4.5 } },
    { name: 'Sync Brass', v: { w1: 1, w2: 1, sy: 1, r2: 4, ve: 3, vd: 0, cf: dial(1200, 30, 18000), rs: 1.5, fe: 5, e1a: 3.5, e1d: 6, e1s: 5, e2a: 3, e2s: 10, lvl: 3.7 } },
    { name: 'Cross-Mod Bell', v: { w1: 3, w2: 0, r2: 4, xm: 6, mx: 2, cf: dial(6000, 30, 18000), fe: 0, e2a: 0, e2d: 6.5, e2s: 0, e2r: 6.5, lvl: 3.8 } },
    { name: 'Funk Bass', v: { r1: 2, r2: 2, w1: 2, w2: 2, pw: 0.25, ft: 5, cf: dial(300, 30, 18000), rs: 3.5, fe: 6, e1a: 0, e1d: 4.2, e1s: 1, e2a: 0, e2d: 5, e2s: 8, e2r: 3, as: 2, lvl: 9.3 } },
    { name: 'Unison Lead', v: { as: 1, w1: 1, w2: 2, pw: 0.3, ft: 7, cf: dial(1500, 30, 18000), rs: 2.5, fe: 4, e1a: 1, e1d: 6, e1s: 4, gl: 2, lvl: 7 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = ['poly', 'unison', 'mono'][v.as]; p.poly = 8; p.unison = v.as === 1 ? 8 : 1; p.unisonDetune = 8;
    p.glide = glideT(v.gl); p.drift = G.drift * 0.8; p.sawBow = 0.02; p.level = v.lvl / 10 * (v.as === 1 ? 0.24 : 0.58);
    const rs = [-36, -24, -12, 0, 12, 24];
    const W1 = [{ tri: 1 }, { saw: 1 }, { pulse: 1 }, { pulse: 1, pw: 0.5 }][v.w1];
    const W2 = [{ sine: 1 }, { saw: 1 }, { pulse: 1 }, {}][v.w2];
    const pwl = v.pws === 0 ? v.pwm / 10 * 0.43 : 0, pwe = v.pws === 1 ? v.pwm / 10 * 0.43 : 0;
    const to1 = v.vd >= 1, to2 = v.vd <= 1;
    p.osc[0] = osc(Object.assign({ on: 1, lev: (10 - v.mx) / 10 * 0.85, oct: rs[v.r1], pw: v.pw, pwLfo: pwl, pwEnv: pwe, lfoPitch: to1 ? v.vl / 10 * 6 : 0, envPitch: to1 ? v.ve / 10 * 24 : 0 }, W1));
    if (v.w1 === 3) { p.osc[0].pwLfo = 0; p.osc[0].pwEnv = 0; }
    p.osc[1] = osc(Object.assign({ on: 1, lev: v.w2 === 3 ? 0 : v.mx / 10 * 0.85, oct: rs[v.r2] + (v.lo ? -48 : 0), fine: v.ft, pw: v.pw, pwLfo: pwl, pwEnv: pwe, kbd: v.lo ? 0 : 1, lfoPitch: to2 ? v.vl / 10 * 6 : 0, envPitch: to2 ? v.ve / 10 * 24 : 0 }, W2));
    if (v.w2 === 3) p.noise = v.mx / 10 * 0.7;
    p.sync = v.sy; p.fm10 = v.xm / 10 * 3;
    if (v.hp > 0.05) p.hpf = { type: '1p', oct: lg(P.hp) };
    Object.assign(p.vcf, { type: 'ota', oct: lg(P.cf), res: v.rs / 10 * 1.01, poles: v.sl === 0 ? 2 : 4, env: v.fe / 10 * 6, lfo: v.fl / 10 * 3, kbd: v.fk / 10, comp: 0.15, fbSat: 0.5, drive: 0.8 });
    p.fenv = { a: P.e1a, d: P.e1d, s: v.e1s / 10, r: P.e1r };
    p.aenv = { a: P.e2a, d: P.e2d, s: v.e2s / 10, r: P.e2r };
    p.lfo = { rate: P.lr, wave: [1, 2, 4, 5][v.lw], delay: P.ld, pitch: 0, amp: v.vlf / 10 * 0.6, wheelPitch: 0.6, wheelFilter: 0 };
    return p;
  },
};

/* ================================================================ 1982 */
const juno60 = {
  id: 'juno60', name: 'Juno-60', model: 'Juno-60', maker: 'Roland', year: 1982,
  tag: '6-voice · crystal-clocked DCO · sub-osc · IR3109 VCF · BBD chorus I / II',
  about: 'Warm, stable, instantly recognisable. One DCO per voice (so almost no drift — it’s clocked, not free-running) with saw, PWM pulse, sub-octave square and noise, into the IR3109 four-pole filter. The secret sauce is the MN3009 bucket-brigade chorus — hiss included, if you want it.',
  theme: { ctl: 'slider', knob: 'roland', panel: '#2a2b2d', face: '#323336', ink: '#f2f2f2', label: '#d9d9d9', accent: '#f3a43b', cap: '#ececec', capLine: '#222', stripes: ['#e9522c', '#f3a43b', '#f5d13a'], font: 'helvetica' },
  sections: [
    { title: 'LFO', c: [K('lr', 'Rate', 0, 10, 5, { conv: v => ex(v, 0.1, 20), fmt: v => fmtHz(ex(v, 0.1, 20)) }), K('ld', 'Delay', 0, 10, 0, { conv: v => v * 0.3, fmt: v => fmtT(v * 0.3) })] },
    { title: 'DCO', wide: 1, c: [K('dl', 'LFO', 0, 10, 0), K('pwm', 'PWM', 0, 10, 0), S('pm', 'PWM Mode', ['LFO', 'Manual'], 1), S('rg', 'Range', ['16\'', '8\'', '4\''], 1), B('pu', 'Pulse', 0), B('sw', 'Saw', 1), K('sb', 'Sub Osc', 0, 10, 0), K('nz', 'Noise', 0, 10, 0)] },
    { title: 'HPF', c: [K('hp', 'Freq', 0, 10, 0, F(8, 900))] },
    { title: 'VCF', c: [K('cf', 'Freq', 0, 10, 6, F(30, 18000)), K('rs', 'Res', 0, 10, 0), S('ep', 'Env', ['+', '−'], 0), K('en', 'Env Amt', 0, 10, 3), K('fl', 'LFO', 0, 10, 0), K('fk', 'Kybd', 0, 10, 5)] },
    { title: 'VCA', c: [S('vm', 'Mode', ['Env', 'Gate'], 0), K('lv', 'Level', 0, 10, 4)] },
    { title: 'ENV', c: [K('a', 'A', 0, 10, 0.5, T(0.0015, 3)), K('d', 'D', 0, 10, 5, T(0.002, 12)), K('s', 'S', 0, 10, 7), K('r', 'R', 0, 10, 4, T(0.002, 12))] },
    { title: 'Chorus', c: [S('ch', 'Chorus', ['Off', 'I', 'II', 'I+II'], 1), B('hs', 'BBD Hiss', 1)] },
  ],
  presets: [
    { name: 'Juno Pad', v: { sw: 1, pu: 1, pm: 0, pwm: 5, lr: 3.5, cf: 5.2, rs: 1.5, en: 2, a: 6, d: 6, s: 8, r: 6, ch: 2, lv: 9.7 } },
    { name: 'Hoover-ish Brass', v: { sw: 1, sb: 6, cf: 4.5, rs: 2, en: 5, a: 3, d: 5, s: 6, r: 4, ch: 2, lv: 5.7 } },
    { name: 'Sub Bass', v: { rg: 0, sw: 1, sb: 8, cf: 3, rs: 2.5, en: 4.5, a: 0, d: 4.5, s: 3, r: 3, ch: 0, lv: 6.2 } },
    { name: 'Square Organ', v: { sw: 0, pu: 1, pwm: 0, pm: 1, sb: 5, cf: 7, en: 0, vm: 1, ch: 1, lv: 1.7 } },
    { name: 'Resonant Pluck', v: { sw: 1, cf: 3.4, rs: 7, en: 5, a: 0, d: 6, s: 0, r: 5.5, ch: 1, lv: 10 } },
    { name: 'Noise Sweep', v: { sw: 0, nz: 10, cf: 4.5, rs: 8, en: 7, a: 7.5, d: 7, s: 4, r: 7, ch: 3, lv: 9.5 } },
  ],
  map(P, v, G) {
    const p = base(G);
    p.mode = 'poly'; p.poly = 6; p.drift = G.drift * 0.12; p.sawBow = 0; p.bw = 22000; p.level = v.lv / 10 * 0.59;
    const pwBase = v.pm === 1 ? 0.5 - v.pwm / 10 * 0.45 : 0.5 - v.pwm / 10 * 0.22;
    const n = Math.max(1, v.sw + v.pu);
    p.osc[0] = osc({ on: 1, lev: (v.sw || v.pu) ? 0.8 : 0, oct: [-12, 0, 12][v.rg], saw: v.sw / n * (v.pu ? 1.2 : 1), pulse: v.pu / n * (v.sw ? 1.2 : 1), pw: pwBase, pwLfo: v.pm === 0 ? v.pwm / 10 * 0.22 : 0, lfoPitch: v.dl / 10 * 3 });
    if (!v.sw && !v.pu) p.osc[0].lev = 0;
    p.sub = v.sb / 10 * 0.7; p.noise = v.nz / 10 * 1.1;
    p.hpf = { type: '1p', oct: lg(P.hp) };
    Object.assign(p.vcf, { type: 'ota', oct: lg(P.cf), res: v.rs / 10 * 1.02, env: (v.ep ? -1 : 1) * v.en / 10 * 6, lfo: v.fl / 10 * 3, kbd: v.fk / 10, comp: 0, fbSat: 0.7, drive: 0.75 });
    p.fenv = { a: P.a, d: P.d, s: v.s / 10, r: P.r };
    p.aenv = v.vm ? { a: 0.0015, d: 0.05, s: 1, r: 0.004 } : { a: P.a, d: P.d, s: v.s / 10, r: P.r };
    p.lfo = { rate: P.lr, wave: 0, delay: P.ld, pitch: 0, amp: 0, wheelPitch: 0.5, wheelFilter: 0 };
    p.fx = { chorus: v.ch, ensemble: 0, hiss: v.hs };
    return p;
  },
};

/* ================================================================ 1983 */
const DX_EP = {
  alg: 5, fb: 6,
  ops: [
    { r: 1, f: 0, d: 3, l: 99, R: [96, 25, 25, 67], L: [99, 75, 0, 0], v: 2, s: 3 },
    { r: 1, f: 0, d: 0, l: 72, R: [95, 50, 35, 78], L: [99, 75, 0, 0], v: 7, s: 3 },
    { r: 1, f: 0, d: 0, l: 99, R: [95, 20, 20, 50], L: [99, 95, 0, 0], v: 2, s: 3 },
    { r: 14, f: 0, d: 0, l: 70, R: [95, 29, 20, 50], L: [99, 95, 0, 0], v: 6, s: 3 },
    { r: 1, f: 0, d: -2, l: 90, R: [95, 20, 20, 50], L: [99, 95, 0, 0], v: 0, s: 3 },
    { r: 1, f: 0, d: 2, l: 62, R: [95, 29, 20, 50], L: [99, 95, 0, 0], v: 0, s: 3 },
  ],
};
function dxVals(x) {
  const o = { alg: x.alg, fb: x.fb };
  if (x.vol !== undefined) o.vol = x.vol;
  x.ops.forEach((op, i) => {
    const k = i + 1;
    o[`r${k}`] = op.r; o[`f${k}`] = op.f; o[`d${k}`] = op.d; o[`l${k}`] = op.l; o[`v${k}`] = op.v; o[`s${k}`] = op.s;
    op.R.forEach((r, j) => { o[`R${j + 1}_${k}`] = r; });
    op.L.forEach((l, j) => { o[`L${j + 1}_${k}`] = l; });
  });
  return o;
}
const DX_DEF = dxVals(DX_EP);
const dx7 = {
  id: 'dx7', name: 'DX7', model: 'Digital Programmable Algorithm Synthesizer', maker: 'Yamaha', year: 1983,
  tag: '16-voice · 6-operator phase modulation · 32 algorithms · 4-rate/4-level EGs',
  about: 'The sound of the 80s: tine pianos, slap bass, bells. Six sine operators per voice in any of the 32 original algorithms, each with its own frequency ratio, output level and rate/level envelope, velocity sensitivity and rate scaling. Operators key-sync on every note. “Vintage DAC” reproduces the original 49.096 kHz floating-point 12-bit converter with its zero-order hold — turn it off for a pristine modern render.',
  theme: { ctl: 'num', knob: 'dx', panel: '#3a3431', face: '#2c2725', ink: '#efe9e2', label: '#cfc6bb', accent: '#22b5a3', font: 'helvetica' },
  sections: [
    { title: 'Voice', c: [K('alg', 'Algorithm', 1, 32, DX_DEF.alg, INT), K('fb', 'Feedback', 0, 7, DX_DEF.fb, INT), K('tr', 'Transpose', -24, 24, 0, INT), B('dac', 'Vintage DAC', 1), K('ls', 'LFO Speed', 0, 10, 5, { conv: v => ex(v, 0.5, 12), fmt: v => fmtHz(ex(v, 0.5, 12)) }), K('pmd', 'Wheel→Vib', 0, 10, 5), K('vol', 'Volume', 0, 10, 2.7)] },
  ].concat([1, 2, 3, 4, 5, 6].map(k => ({
    title: `Operator ${k}`, op: k, c: [
      K(`r${k}`, 'Ratio', 0, 31, DX_DEF[`r${k}`], { step: 1, fmt: v => v === 0 ? '0.50' : String(v) }),
      K(`f${k}`, 'Fine', 0, 99, DX_DEF[`f${k}`], INT), K(`d${k}`, 'Detune', -7, 7, DX_DEF[`d${k}`], INT), K(`l${k}`, 'Level', 0, 99, DX_DEF[`l${k}`], INT),
      K(`R1_${k}`, 'R1', 0, 99, DX_DEF[`R1_${k}`], INT), K(`R2_${k}`, 'R2', 0, 99, DX_DEF[`R2_${k}`], INT), K(`R3_${k}`, 'R3', 0, 99, DX_DEF[`R3_${k}`], INT), K(`R4_${k}`, 'R4', 0, 99, DX_DEF[`R4_${k}`], INT),
      K(`L1_${k}`, 'L1', 0, 99, DX_DEF[`L1_${k}`], INT), K(`L2_${k}`, 'L2', 0, 99, DX_DEF[`L2_${k}`], INT), K(`L3_${k}`, 'L3', 0, 99, DX_DEF[`L3_${k}`], INT), K(`L4_${k}`, 'L4', 0, 99, DX_DEF[`L4_${k}`], INT),
      K(`v${k}`, 'Vel', 0, 7, DX_DEF[`v${k}`], INT), K(`s${k}`, 'Rate Scl', 0, 7, DX_DEF[`s${k}`], INT),
    ],
  }))),
  presets: [
    { name: 'Tine E.Piano', v: DX_DEF },
    {
      name: 'Solid Bass', v: dxVals({
        alg: 16, fb: 5, vol: 4, ops: [
          { r: 0, f: 0, d: 0, l: 99, R: [99, 40, 30, 70], L: [99, 85, 70, 0], v: 2, s: 2 },
          { r: 0, f: 0, d: 1, l: 84, R: [99, 60, 40, 70], L: [99, 60, 40, 0], v: 5, s: 2 },
          { r: 1, f: 0, d: 0, l: 76, R: [99, 70, 35, 70], L: [99, 50, 0, 0], v: 4, s: 2 },
          { r: 3, f: 0, d: 0, l: 62, R: [99, 75, 35, 70], L: [99, 40, 0, 0], v: 3, s: 2 },
          { r: 1, f: 0, d: -1, l: 70, R: [99, 50, 30, 70], L: [99, 60, 0, 0], v: 3, s: 2 },
          { r: 1, f: 0, d: 0, l: 58, R: [99, 50, 30, 70], L: [99, 60, 0, 0], v: 0, s: 2 },
        ],
      }),
    },
    {
      name: 'Brass Ensemble', v: dxVals({
        alg: 22, fb: 7, vol: 2.1, ops: [
          { r: 1, f: 0, d: 0, l: 99, R: [72, 30, 20, 60], L: [99, 92, 88, 0], v: 1, s: 2 },
          { r: 1, f: 0, d: 0, l: 82, R: [60, 35, 25, 60], L: [99, 85, 80, 0], v: 4, s: 2 },
          { r: 1, f: 0, d: 2, l: 97, R: [70, 30, 20, 60], L: [99, 92, 88, 0], v: 1, s: 2 },
          { r: 1, f: 0, d: -2, l: 97, R: [70, 30, 20, 60], L: [99, 92, 88, 0], v: 1, s: 2 },
          { r: 1, f: 0, d: 4, l: 95, R: [70, 30, 20, 60], L: [99, 92, 88, 0], v: 1, s: 2 },
          { r: 1, f: 0, d: 0, l: 76, R: [55, 40, 25, 60], L: [99, 80, 75, 0], v: 4, s: 2 },
        ],
      }),
    },
    {
      name: 'Tubular Bells', v: dxVals({
        alg: 5, fb: 0, vol: 5.3, ops: [
          { r: 1, f: 0, d: 0, l: 99, R: [96, 30, 22, 35], L: [99, 60, 0, 0], v: 2, s: 1 },
          { r: 3, f: 50, d: 0, l: 78, R: [96, 32, 24, 35], L: [99, 50, 0, 0], v: 3, s: 1 },
          { r: 2, f: 0, d: 2, l: 92, R: [96, 28, 22, 35], L: [99, 60, 0, 0], v: 2, s: 1 },
          { r: 7, f: 0, d: 0, l: 72, R: [96, 35, 25, 35], L: [99, 40, 0, 0], v: 3, s: 1 },
          { r: 1, f: 41, d: -2, l: 84, R: [96, 30, 22, 35], L: [99, 60, 0, 0], v: 2, s: 1 },
          { r: 5, f: 0, d: 0, l: 66, R: [96, 40, 25, 35], L: [99, 40, 0, 0], v: 3, s: 1 },
        ],
      }),
    },
    {
      name: 'Glass Marimba', v: dxVals({
        alg: 5, fb: 0, vol: 10, ops: [
          { r: 1, f: 0, d: 0, l: 99, R: [99, 45, 40, 50], L: [99, 0, 0, 0], v: 3, s: 3 },
          { r: 4, f: 0, d: 0, l: 80, R: [99, 70, 50, 60], L: [99, 0, 0, 0], v: 5, s: 3 },
          { r: 4, f: 0, d: 0, l: 82, R: [99, 55, 40, 55], L: [99, 0, 0, 0], v: 3, s: 3 },
          { r: 10, f: 0, d: 0, l: 66, R: [99, 75, 50, 60], L: [99, 0, 0, 0], v: 5, s: 3 },
          { r: 0, f: 0, d: 0, l: 0, R: [99, 50, 50, 50], L: [99, 0, 0, 0], v: 0, s: 0 },
          { r: 1, f: 0, d: 0, l: 0, R: [99, 50, 50, 50], L: [99, 0, 0, 0], v: 0, s: 0 },
        ],
      }),
    },
  ],
  map(P, v, G) {
    const ops = [];
    for (let k = 1; k <= 6; k++) {
      const r = v[`r${k}`];
      ops.push({
        ratio: (r === 0 ? 0.5 : r) * (1 + v[`f${k}`] / 100), det: Math.pow(2, v[`d${k}`] * 0.9 / 1200), fixed: 0, hz: 0, out: v[`l${k}`],
        R: [v[`R1_${k}`], v[`R2_${k}`], v[`R3_${k}`], v[`R4_${k}`]], L: [v[`L1_${k}`], v[`L2_${k}`], v[`L3_${k}`], v[`L4_${k}`]],
        vel: v[`v${k}`], rs: v[`s${k}`],
      });
    }
    return {
      engine: 'fm', mode: 'poly', poly: 16, prio: 'last', legato: false, glide: 0, glideLegato: false, unison: 1, unisonDetune: 0,
      bendRange: 2, drift: 0, alg: Math.round(v.alg), fb: Math.round(v.fb), ops, transpose: v.tr, level: v.vol / 10 * 0.36, dac: v.dac,
      lfo: { rate: P.ls, wave: 0, delay: 0, pitch: 0, amp: 0, wheelPitch: v.pmd / 10 * 0.7, wheelFilter: 0 },
      fx: { chorus: 0, ensemble: 0, hiss: 0 },
    };
  },
};

// DX7 algorithm table (mirrors engine.js) for the panel diagram
export const DX_ALGS = [
  [[[2, 1], [6, 5], [5, 4], [4, 3]], [1, 3], [6, 6]],
  [[[2, 1], [6, 5], [5, 4], [4, 3]], [1, 3], [2, 2]],
  [[[3, 2], [2, 1], [6, 5], [5, 4]], [1, 4], [6, 6]],
  [[[3, 2], [2, 1], [6, 5], [5, 4]], [1, 4], [4, 6]],
  [[[2, 1], [4, 3], [6, 5]], [1, 3, 5], [6, 6]],
  [[[2, 1], [4, 3], [6, 5]], [1, 3, 5], [5, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [4, 4]],
  [[[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], [2, 2]],
  [[[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], [3, 3]],
  [[[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], [6, 6]],
  [[[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [2, 2]],
  [[[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [6, 6]],
  [[[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], [2, 2]],
  [[[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [6, 6]],
  [[[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], [2, 2]],
  [[[2, 1], [3, 1], [4, 1], [5, 4], [6, 5]], [1], [3, 3]],
  [[[3, 2], [2, 1], [6, 4], [6, 5]], [1, 4, 5], [6, 6]],
  [[[3, 1], [3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]],
  [[[3, 1], [3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [3, 3]],
  [[[2, 1], [6, 3], [6, 4], [6, 5]], [1, 3, 4, 5], [6, 6]],
  [[[3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [6, 6]],
  [[[6, 3], [6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[[6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[[3, 2], [5, 4], [6, 4]], [1, 2, 4], [6, 6]],
  [[[3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]],
  [[[2, 1], [4, 3], [5, 4]], [1, 3, 6], [5, 5]],
  [[[4, 3], [6, 5]], [1, 2, 3, 5], [6, 6]],
  [[[4, 3], [5, 4]], [1, 2, 3, 6], [5, 5]],
  [[[6, 5]], [1, 2, 3, 4, 5], [6, 6]],
  [[], [1, 2, 3, 4, 5, 6], [6, 6]],
];

/* ================================================================ 2014 */
// Wavetable synth with its own panel (serum-ui.js) and voice engine (serum-dsp.js and the sx-* scripts). The state lives
// at vals.s (serum-core.js defaultSerum); map() compiles it for the engine (SPEC-serum §4.1, §11.7; SPEC-serum2 §12.7).
const serum = {
  id: 'serum', name: 'Serum', model: 'Wavetable Synthesizer', maker: 'Xfer Records', year: 2014, custom: true,
  tag: 'Poly · 3 oscillators (wavetable, multisample, sample, granular, spectral) · 2 filters · mixer & buses · 13 FX + splitters · 10 LFOs · 64-slot matrix · arp & clips',
  about: 'The software wavetable synth that shaped a decade of electronic production, rebuilt here from its documented behaviour together with the second generation of its design. Three oscillators each play a wavetable, a multisampled instrument, a single sample, a granular cloud or a spectral resynthesis, with two warp slots per oscillator (frequency, phase and amplitude modulation, sync, bending, distortion and filter warps) and up to 16-voice unison. A sub and a colour-noise oscillator, two filters with over a hundred types, a mixer that routes every source to the filters, the main output, a direct output or two effect buses, four envelopes, ten LFOs (drawn, path, chaos and sample-and-hold), a 64-slot modulation matrix with curves and slew, voice control, MPE and microtuning. An arpeggiator and a clip player with piano roll sit in front of the voices, and an effect rack of thirteen module types — reverbs, convolution, frequency shifting and band splitters among them — runs on the main output and on both buses. Every wavetable, sample, impulse response and preset here is original, generated by this project or rendered from its own instruments.',
  theme: { ctl: 'knob', knob: 'serum', panel: '#0f1216', face: '#161b21', ink: '#dfe6ee', label: '#7f8b98', accent: '#4fb3ff' },
  sections: [],
  // new tracks and Init: defaults with the GLOBAL preferences applied (default oversampling, author, 3D view, MPE enabled
  // by default; §2.1, SPEC-serum2 §12.7, §13.10)
  defaults(prefs) {
    const s = defaultSerum();
    if (prefs) {
      if (prefs.defOs === 1 || prefs.defOs === 2 || prefs.defOs === 4) s.global.os = prefs.defOs;
      if (typeof prefs.author === 'string') s.author = prefs.author.slice(0, 64);
      if (prefs.view3d) s.ui.view3d = s.ui.view3d.map(() => 1);
      if (prefs.mpeDefault && s.global.mpe) s.global.mpe.on = 1;
    }
    return { s };
  },
  // G.fx = the track's FX state: compileSerum resolves the matrix rows that target FX parameters against its layout
  // (SPEC-serum2 §4.1; without it those rows are inactive); qr = quality-reduction caps, the rest app preferences
  map(P, v, G) {
    return compileSerum(v && v.s, { bpm: G.bpm, smooth: G.smooth, fx: G.fx, qr: G.qr, ultra: G.ultra, mpeBendX: G.mpeBendX, mpeYBi: G.mpeYBi });
  },
  presets: FACTORY_PRESETS,
};

export const MODELS = [modular, minimoog, arp2600, solina, cs80, prophet5, ms20, tb303, obxa, jupiter8, juno60, dx7, serum];
for (const m of MODELS) {
  m.controls = [];
  for (const s of m.sections) for (const c of s.c) m.controls.push(c);
  // vals saved before a control existed (other tracks, imports, undo, bounces) lack its id: map it at its default, not NaN
  const map = m.map;
  m.map = (P, v, G) => {
    if (m.controls.some(c => v[c.id] == null)) {
      v = Object.assign({}, v); P = Object.assign({}, P);
      for (const c of m.controls) if (v[c.id] == null) { v[c.id] = c.def; P[c.id] = c.conv ? c.conv(c.def) : c.def; }
    }
    return map.call(m, P, v, G);
  };
}

// The complete engine patch of a track (SPEC-serum2 §12.7, §10.1): the model's map (Serum: compileSerum with the FX
// state, the quality caps and the app preferences) + the track's FX rack (compileFx → FXP v2, compileFxT) + tempo. Pure
// and deterministic; main.js's buildPatch adds only live-session fields (rack re-seed, oversampling cap, CPU caps), the
// bounces, the render farm and the tests call it as it is.
//   model  model id or MODELS entry          vals  the track's panel values ({s} for Serum)
//   fx     the track's FX state (any version; default defaultFx())
//   opts   {sr = 48000, bpm = 120, drift = 0, hiss = 0, qr = null, prefs = {}, seed = false}; prefs: smooth (1),
//          silenceTails (1), ultra, mpeBendX, mpeYBi (the app preferences, §13.10)
export function patchFor(model, vals, fx, opts) {
  const m = typeof model === 'string' ? MODELS.find(x => x.id === model) : model;
  if (!m || !m.map) throw new Error('patchFor: unknown model ' + model);
  const o = opts || {}, pr = o.prefs || {}, v = vals || {}, P = {};
  const sr = o.sr > 0 ? +o.sr : 48000, bpm = o.bpm > 0 ? +o.bpm : 120, smooth = pr.smooth > 0 ? +pr.smooth : 1;
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(v[c.id]) : v[c.id];
  const rack = fx || SC.defaultFx();
  const patch = m.map(P, v, { drift: o.drift || 0, hiss: o.hiss || 0, sr, bpm, smooth, fx: rack, qr: o.qr || null,
    ultra: pr.ultra ? 1 : 0, mpeBendX: pr.mpeBendX ? 1 : 0, mpeYBi: pr.mpeYBi ? 1 : 0 });
  // Serum's master volume, Bypass and output levels belong to the rack's output stage (FX-context [0…4], §4.2)
  const s = m.custom && v.s ? v.s : null, sp = s && s.p ? s.p : null;
  patch.fxr = SC.compileFx(rack, {
    bpm, rate: sr,
    master: sp ? sp['g.master'] : undefined, bypass: sp ? sp['g.bypass'] : undefined,
    direct: sp ? sp['g.direct'] : undefined, bus1v: sp ? sp['g.bus1v'] : undefined, bus2v: sp ? sp['g.bus2v'] : undefined,
    modded: s ? (typeof SC.fxModded2 === 'function' ? SC.fxModded2(s, rack) : SC.fxModded(s)) : null,
    seed: !!o.seed, smooth, silence: pr.silenceTails === undefined ? 1 : pr.silenceTails ? 1 : 0,
    qr: o.qr || null, // §14.3 Q3: FXP.convMax
  });
  patch.fxrT = SC.compileFxT(rack);
  patch.bpm = bpm;
  // assets the rack needs (shaped Convolve IRs, §4.3) join the instrument's needs
  const fn = patch.fxr && Array.isArray(patch.fxr.needs) ? patch.fxr.needs : [];
  if (fn.length) { const nd = patch.needs ? patch.needs.slice() : []; for (const id of fn) if (nd.indexOf(id) < 0) nd.push(id); patch.needs = nd; }
  return patch;
}

// The song data of a played note group (SPEC-serum2 §12.6, §13.2.5 render-last): notes {n, vel 0–1, on, off} in seconds
// from the group's first note-on → the engine's song format {notes: flat [tick, length, note, velocity 1–127], cc: []} at
// `bpm` (960 ticks per quarter), sorted by start. Rendered from tick 0 with the transport playing, a group plays exactly as
// a bounce of the same notes (the sequencer then runs on the song clock from beat 0, as it does from idle live).
export function groupSong(notes, bpm) {
  const tps = (bpm > 0 ? bpm : 120) * 960 / 60, out = [];
  const L = (Array.isArray(notes) ? notes : []).filter(x => x && x.n >= 0 && x.n <= 127 && x.on >= 0)
    .map(x => ({ t: x.on * tps, d: Math.max(1e-6, (x.off > x.on ? x.off - x.on : 0) * tps), n: Math.round(x.n), v: Math.min(127, Math.max(1, (+x.vel || 0) * 127)) }))
    .sort((a, b) => a.t - b.t || a.n - b.n);
  for (const x of L) out.push(x.t, x.d, x.n, x.v);
  return { notes: out, cc: [] };
}
