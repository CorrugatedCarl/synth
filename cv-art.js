// cv-art.js — procedural instrument illustrations (SPEC-canvas §3; contract: docs/canvas/IMPL-1b.md §4.7): small
// original SVG drawings made from models.js theme data plus a silhouette descriptor per model. No logos, wordmarks, maker
// typefaces, traced photos or <text>: names are plain text in the UI font next to the drawing. One drawing path, cached
// as strings, reused by tray tiles, track-row chips and module cards. Owner: SHELL lane.
// Every drawing is laid out in a 96 × 56 design box and scaled (uniformly, centred) into the requested viewBox; below
// 48 px wide a simpler level of detail (no knobs or caps, fewer keys) keeps the chips crisp. Flat fills only (no gradient
// or pattern ids: the same string appears many times in one document).
// Rules: plain ES module, no DOM at module top level (pure strings: node-tested); imports carry ?v=9 (models.js, read only).
import { MODELS } from './models.js?v=9';

/** Default tile drawing size and the track-row chip size (px). */
export const TILE = Object.freeze({ w: 96, h: 56 }), CHIP = Object.freeze({ w: 28, h: 18 });

/**
 * @typedef {{
 *   body: 'keyboard' | 'desktop' | 'cabinet' | 'box',
 *   keys?: number, cheeks?: boolean, tilt?: number, screen?: boolean, steps?: number,
 * }} Silhouette
 */

/** Silhouette descriptors by model id (models.js MODELS ids). keys: white keys drawn; cheeks: wooden end cheeks; tilt: the
 * front panel leans back (0…1); screen: an LCD / display; steps: step buttons. @type {Object<string, Silhouette>} */
export const SIL = Object.freeze({
  modular: Object.freeze({ body: 'cabinet', cheeks: true }),
  minimoog: Object.freeze({ body: 'keyboard', keys: 15, cheeks: true, tilt: 0.6 }),
  arp2600: Object.freeze({ body: 'cabinet', keys: 16 }),
  solina: Object.freeze({ body: 'keyboard', keys: 22, cheeks: true }),
  cs80: Object.freeze({ body: 'keyboard', keys: 25, cheeks: true }),
  prophet5: Object.freeze({ body: 'keyboard', keys: 17, cheeks: true, tilt: 0.2 }),
  ms20: Object.freeze({ body: 'keyboard', keys: 18 }),
  tb303: Object.freeze({ body: 'desktop', steps: 16 }),
  obxa: Object.freeze({ body: 'keyboard', keys: 22 }),
  jupiter8: Object.freeze({ body: 'keyboard', keys: 25 }),
  juno60: Object.freeze({ body: 'keyboard', keys: 22 }),
  dx7: Object.freeze({ body: 'keyboard', keys: 25, screen: true }),
  serum: Object.freeze({ body: 'box', screen: true }),
  tr808: Object.freeze({ body: 'box', steps: 16 }), // (7a) a drum machine: a wide low case, 12 knob columns, 16 step keys in four colours
  tr606: Object.freeze({ body: 'desktop', steps: 16 }), // (7b) the TB-303's body family: a silver case, six knobs, a dark programming panel over 16 grey keys
  tr909: Object.freeze({ body: 'box', steps: 16 }), // (7c) the 808's body family: a wide low light case, nine blocks of dark knobs, a red display, 16 cream step keys
});

const W0 = 96, H0 = 56; // the design box
const f = n => Math.round(n * 100) / 100;
const R = (x, y, w, h, fill, ex = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${ex}/>`;
const RR = (x, y, w, h, rx, fill, ex = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${fill}"${ex}/>`;
const C = (cx, cy, r, fill, ex = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${ex}/>`;
const P = (d, fill, ex = '') => `<path d="${d}" fill="${fill}"${ex}/>`;
const S = (d, stroke, w, ex = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${f(w)}" stroke-linecap="round"${ex}/>`;
const POLY = (pts, fill, ex = '') => `<polygon points="${pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="${fill}"${ex}/>`;
const OP = o => ` opacity="${o}"`;
const rnd = (i, s = 1) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); }; // deterministic
const IVORY = '#efebe2', KEYLINE = '#8d887e', EBONY = '#151515';
const WOOD = '#74421f', GRAIN = '#4c2a12', WOODHI = '#9a5a2c';

/* ---------------------------------------------------------------- parts */
// a keyboard of n white keys in (x, y, w, h); start: the first key's place in the octave (0 = C)
function keys(x, y, w, h, n, o = {}) {
  const ww = w / n, out = [R(x, y, w, h, o.white || IVORY)];
  let d = '';
  for (let i = 1; i < n; i++) d += `M${f(x + i * ww)} ${f(y)}V${f(y + h)}`;
  out.push(S(d, o.line || KEYLINE, Math.max(0.25, ww * 0.1)));
  const bw = ww * 0.6, bh = h * 0.6, st = o.start || 0;
  let bd = '';
  for (let i = 0; i < n - 1; i++) {
    const k = (i + st) % 7;
    if (k === 2 || k === 6) continue; // no black key after E and B
    const bx = x + (i + 1) * ww - bw / 2;
    bd += `M${f(bx)} ${f(y)}h${f(bw)}v${f(bh)}h${f(-bw)}z`;
  }
  out.push(P(bd, o.black || EBONY));
  out.push(R(x, y, w, Math.max(0.6, h * 0.07), '#000', OP(0.35))); // the key slip's shadow
  return out.join('');
}
// a wooden block with grain
function wood(x, y, w, h, n = 3) {
  let d = '';
  for (let i = 0; i < n; i++) { const gx = x + w * (0.2 + 0.6 * rnd(i + x, 3)); d += `M${f(gx)} ${f(y + 1)}V${f(y + h - 1)}`; }
  return R(x, y, w, h, WOOD) + S(d, GRAIN, 0.5, OP(0.7)) + R(x, y, Math.max(0.6, w * 0.18), h, WOODHI, OP(0.45));
}
// a row of n knobs centred across [x, x + w] at y
function knobRow(x, y, w, n, r, o = {}) {
  const gap = w / n;
  let s = '', ind = '';
  for (let i = 0; i < n; i++) {
    const cx = x + gap * (i + 0.5);
    if (o.skirt) s += C(cx, y, r, o.skirt);
    s += C(cx, y, o.skirt ? r * 0.66 : r, o.cap || '#151515');
    if (o.ind) { const a = -2.4 + 4.8 * rnd(i + n, o.seed || 2), rr = (o.skirt ? r * 0.66 : r) * 0.9; ind += `M${f(cx)} ${f(y)}L${f(cx + Math.sin(a) * rr)} ${f(y - Math.cos(a) * rr)}`; }
  }
  return s + (ind ? S(ind, o.ind, Math.max(0.35, r * 0.28)) : '');
}
// a row of n vertical sliders (grooves + caps at deterministic positions)
function sliderRow(x, y, w, h, n, o = {}) {
  const gap = w / n, cw = Math.min(gap * 0.7, 2.6), ch = Math.max(1, h * 0.16);
  let g = '', caps = '';
  for (let i = 0; i < n; i++) {
    const cx = x + gap * (i + 0.5);
    g += `M${f(cx)} ${f(y)}V${f(y + h)}`;
    const cy = y + (h - ch) * rnd(i, o.seed || 5);
    const col = o.colors ? o.colors[Math.floor(i / Math.max(1, Math.ceil(n / o.colors.length))) % o.colors.length] : o.cap || '#eee';
    caps += R(cx - cw / 2, cy, cw, ch, col);
    if (o.line) caps += R(cx - cw / 2, cy + ch * 0.42, cw, Math.max(0.25, ch * 0.16), o.line);
  }
  return S(g, o.groove || '#050505', Math.max(0.5, gap * 0.16)) + caps;
}
// a row of n small buttons
function buttonRow(x, y, w, h, n, colors, o = {}) {
  const gap = w / n, bw = gap * (o.fill || 0.72);
  let s = '';
  for (let i = 0; i < n; i++) s += RR(x + gap * i + (gap - bw) / 2, y, bw, h, Math.min(0.6, h * 0.2), colors[(o.pick ? o.pick(i) : i) % colors.length]);
  return s;
}
const shadow = (x0 = 6, x1 = 90, y = 53.2) => `<ellipse cx="${f((x0 + x1) / 2)}" cy="${f(y)}" rx="${f((x1 - x0) / 2)}" ry="1.9" fill="#000" opacity="0.4"/>`;
// two pitch / mod wheel slots
const wheels = (x, y, h) => R(x, y, 2.4, h, '#050505') + R(x + 3.4, y, 2.4, h, '#050505') + R(x + 0.3, y + h * 0.45, 1.8, h * 0.2, '#3a3b40') + R(x + 3.7, y + h * 0.7, 1.8, h * 0.2, '#3a3b40');

/* ---------------------------------------------------------------- the instruments (96 × 56 design box) */
const DRAW = {
  // a wooden cabinet of module columns, knobs, jacks and a few patch cords
  modular(th, lo) {
    let s = shadow(5, 91) + RR(5, 3, 86, 50, 2, WOOD) + wood(5, 3, 4, 50, 2) + wood(87, 3, 4, 50, 2);
    const tiers = [[7, 24], [30, 21]];
    for (const [ty, th2] of tiers) {
      s += R(9, ty, 78, th2, th.panel);
      if (lo) continue;
      let div = '';
      for (let i = 1; i < 8; i++) div += `M${f(9 + i * 78 / 8)} ${f(ty)}V${f(ty + th2)}`;
      s += S(div, '#2c2a27', 0.45);
      for (let i = 0; i < 8; i++) {
        const mx = 9 + i * 78 / 8, rows = 2 + (i % 2);
        for (let r = 0; r < rows; r++) { const ky = ty + 4 + r * (th2 - 8) / Math.max(1, rows - 1) * 0.7; s += C(mx + 4.9, ky, 1.85, '#bdb6a6') + C(mx + 4.9, ky, 1.45, '#101010') + S(`M${f(mx + 4.9)} ${f(ky)}l${f(0.9 * Math.sin(r + i))} ${f(-0.9 * Math.cos(r + i))}`, '#e9e4d8', 0.4); }
        s += C(mx + 2.6, ty + th2 - 2.6, 0.75, '#d9d2bf') + C(mx + 7.2, ty + th2 - 2.6, 0.75, '#d9d2bf');
      }
    }
    const cords = [['#d8452f', 14, 28, 40, 49, 9], ['#e6b422', 31, 28, 64, 49, 12], ['#3b82c4', 50, 28, 23, 49, 10], ['#3fae5a', 72, 28, 82, 49, 7]];
    for (const [col, x1, y1, x2, y2, sag] of cords) s += S(`M${x1} ${y1}C${x1} ${y1 + sag} ${x2} ${y2 - 4 + sag} ${x2} ${y2 - 1}`, col, lo ? 2.2 : 0.9);
    return s + R(9, 28, 78, 1.5, '#1e1c1a');
  },
  // wood cheeks, a dark front panel leaning back over a short keyboard, blue rockers, the wheels at the left
  minimoog(th, lo) {
    let s = shadow(3, 93);
    s += POLY([[3, 52], [3, 30], [9, 6], [14, 6], [14, 52]], WOOD) + POLY([[93, 52], [93, 30], [87, 6], [82, 6], [82, 52]], WOOD);
    s += POLY([[4.2, 50], [4.2, 31], [9.6, 8], [10.8, 8], [6.2, 31], [6.2, 50]], WOODHI, OP(0.5));
    s += R(14, 5, 68, 2.6, WOOD) + POLY([[14, 7.6], [82, 7.6], [82, 31], [14, 31]], th.panel) + R(14, 7.6, 68, 0.8, '#fff', OP(0.08));
    if (!lo) {
      for (const [y, n] of [[12.4, 11], [19, 12], [25.6, 11]]) s += knobRow(16, y, 64, n, 2.2, { skirt: '#d4cfc4', cap: '#121212', ind: '#f2efe6', seed: y });
      s += buttonRow(36, 21.6, 22, 2.9, 5, [th.accent], { fill: 0.5 }) + buttonRow(62, 28.2, 16, 1.8, 4, [th.accent], { fill: 0.55 });
    } else s += R(17, 14, 62, 2, '#cfc9b8', OP(0.6)) + R(17, 22, 62, 2, '#cfc9b8', OP(0.6)) + R(40, 18.5, 14, 1.4, th.accent);
    s += R(14, 31, 68, 1.6, '#000', OP(0.65)) + R(14, 32.6, 68, 19.4, '#0f0f0f');
    s += lo ? '' : wheels(16, 37, 12);
    s += keys(lo ? 16 : 24.5, 35.5, lo ? 64 : 56, 15.6, lo ? 8 : 15);
    return s + R(14, 51.1, 68, 1.4, '#262626');
  },
  // a grey cabinet of slider columns with two speaker grilles, the keyboard as a separate unit
  arp2600(th, lo) {
    let s = shadow(6, 90) + RR(8, 2, 80, 36, 2, '#353b42') + R(11, 4, 74, 32, th.panel) + R(11, 4, 74, 0.8, '#fff', OP(0.25));
    if (!lo) {
      let div = '';
      for (let i = 1; i < 7; i++) div += `M${f(11 + i * 74 / 7)} ${f(5)}V${f(35)}`;
      s += S(div, '#8f999e', 0.4);
      s += sliderRow(20, 7, 58, 9, 15, { cap: th.cap, groove: '#26323a', seed: 7 }) + sliderRow(20, 19, 58, 9, 15, { cap: th.cap, groove: '#26323a', seed: 9 });
      s += R(20, 5.2, 58, 0.7, th.accent) + R(20, 17.4, 58, 0.7, th.accent);
      let jacks = '';
      for (let i = 0; i < 20; i++) jacks += C(20.5 + i * 2.9, 32, 0.75, '#1d2a33');
      s += jacks;
    } else s += R(20, 8, 58, 2, th.accent, OP(0.7)) + R(20, 18, 58, 2, th.accent, OP(0.7));
    for (const cx of [15.5, 80.5]) { s += C(cx, 28, 3.6, '#2a3036'); if (!lo) s += C(cx, 28, 2.4, 'none', ' stroke="#4a545c" stroke-width="0.5"') + C(cx, 28, 1.1, 'none', ' stroke="#4a545c" stroke-width="0.5"'); }
    s += RR(12, 40, 72, 12.6, 1.5, '#2c3036') + (lo ? '' : knobRow(13.5, 46, 6, 1, 1.6, { skirt: '#bfc6c9', cap: '#1d2a33' }));
    return s + keys(lo ? 14 : 21, 41.5, lo ? 68 : 61.5, 10, lo ? 9 : 16, { start: 0 });
  },
  // a long, low cabinet: a row of coloured tab switches and a few knobs above a full keyboard
  solina(th, lo) {
    let s = shadow(2, 94) + wood(2.5, 18, 4.5, 34) + wood(89, 18, 4.5, 34) + R(7, 18, 82, 34, th.panel) + R(7, 18, 82, 0.8, '#fff', OP(0.1));
    const tabs = ['#eee5d0', '#eee5d0', '#f2a33a', '#f2a33a', '#f5d13a', '#eee5d0', '#c9783a', '#eee5d0'];
    s += buttonRow(10, 21.4, 40, lo ? 4 : 5.4, 8, tabs, { fill: 0.78 });
    if (!lo) s += R(10, 24.2, 40, 0.6, '#000', OP(0.35)) + knobRow(58, 24, 28, 4, 2.1, { skirt: '#c9c4b8', cap: '#1b1714', ind: th.accent, seed: 4 });
    s += R(7, 29.4, 82, 1.2, '#000', OP(0.55));
    return s + keys(8.5, 31, 79, 20, lo ? 11 : 22) + R(7, 51, 82, 1.2, '#1b1511');
  },
  // a long body: rows of short coloured levers, a ribbon strip above a long keyboard, wood ends
  cs80(th, lo) {
    let s = shadow(1, 95) + wood(2, 9, 4.5, 43) + wood(89.5, 9, 4.5, 43) + R(6.5, 7.5, 83, 2.2, WOOD) + R(6.5, 9.7, 83, 23, th.panel);
    const cols = th.capColors || ['#e24b2c', '#f2c12e', '#2f8fd8', '#ece6d6', '#3fae5a'];
    if (!lo) {
      s += sliderRow(9, 12, 78, 8.5, 26, { colors: cols, groove: '#0c0b0b', seed: 11 });
      s += buttonRow(9, 23.6, 78, 2.8, 24, cols, { fill: 0.7, pick: i => Math.floor(i / 5) });
      s += buttonRow(9, 28, 78, 2.2, 16, ['#2a2826', '#d7d1c4'], { fill: 0.6, pick: i => (i % 5 === 0 ? 1 : 0) });
    } else s += buttonRow(9, 13, 78, 6, 5, cols, { fill: 0.86 }) + buttonRow(9, 22, 78, 3, 5, cols, { fill: 0.86 });
    s += R(9.5, 33.4, 77, 1.7, '#a29c91') + R(6.5, 32.7, 83, 0.7, '#000', OP(0.5));
    return s + keys(7.5, 36, 81, 15.5, lo ? 12 : 25, { start: 0 }) + R(6.5, 51.2, 83, 1.2, '#2a2826');
  },
  // a wooden frame round a black panel: two rows of knobs with silver caps, a row of program buttons
  prophet5(th, lo) {
    let s = shadow(3, 93) + wood(3.5, 6, 6.5, 46) + wood(86, 6, 6.5, 46) + R(10, 5, 76, 3, WOOD);
    s += R(10, 8, 76, 23.5, th.panel) + R(10, 8, 76, 0.6, '#fff', OP(0.1));
    if (!lo) {
      s += knobRow(12, 13.2, 72, 13, 2.25, { skirt: '#0b0b0b', cap: '#9fa2a5', ind: '#111', seed: 3 });
      s += knobRow(12, 20.4, 72, 12, 2.25, { skirt: '#0b0b0b', cap: '#9fa2a5', ind: '#111', seed: 5 });
      s += buttonRow(30, 26.4, 54, 2.5, 12, ['#3a3a3a', '#3a3a3a', '#3a3a3a', '#d9302c'], { fill: 0.62, pick: i => (i === 4 ? 3 : 0) });
      s += R(12, 26.6, 14, 0.6, th.accent);
    } else s += R(13, 12, 70, 2.4, '#9fa2a5', OP(0.75)) + R(13, 19, 70, 2.4, '#9fa2a5', OP(0.75)) + R(30, 25.5, 30, 1.6, th.accent);
    s += R(10, 31.5, 76, 1.6, '#000', OP(0.6)) + R(10, 33.1, 76, 18.9, '#0e0e0e');
    s += lo ? '' : wheels(12, 37, 12);
    return s + keys(lo ? 12 : 19.5, 35, lo ? 72 : 65, 16, lo ? 9 : 17) + R(10, 51, 76, 1.4, '#262626');
  },
  // metal end caps, a black panel with a blue stripe, knob rows with light indicators, a button strip
  obxa(th, lo) {
    let s = shadow(3, 93) + RR(3.5, 10, 5, 42, 1, '#2b2f33') + RR(87.5, 10, 5, 42, 1, '#2b2f33') + R(8.5, 10, 79, 22.5, th.panel);
    s += R(8.5, 10, 79, 0.6, '#fff', OP(0.12)) + R(8.5, 24.6, 79, 0.9, th.accent);
    if (!lo) {
      s += knobRow(10, 14.4, 75, 13, 2, { skirt: '#0a0a0a', cap: '#1c2024', ind: '#58b2ff', seed: 6 });
      s += knobRow(10, 20.6, 75, 12, 2, { skirt: '#0a0a0a', cap: '#1c2024', ind: '#58b2ff', seed: 8 });
      s += buttonRow(10, 27.6, 75, 2.6, 18, ['#c7d2db', '#3a4048', '#3a4048'], { fill: 0.62, pick: i => (i % 6 === 2 ? 0 : 1) });
    } else s += R(11, 14, 73, 2, '#58b2ff', OP(0.5)) + R(11, 19.5, 73, 2, '#58b2ff', OP(0.5));
    s += R(8.5, 32.5, 79, 1.6, '#000', OP(0.6));
    return s + keys(9.5, 34.4, 77, 16.6, lo ? 11 : 22) + R(8.5, 51, 79, 1.4, '#1f2328');
  },
  // a long black panel: short sliders, a few knobs, the long row of coloured buttons
  jupiter8(th, lo) {
    let s = shadow(1, 95) + RR(2, 12, 4, 40, 1, '#3a3d42') + RR(90, 12, 4, 40, 1, '#3a3d42') + R(6, 12, 84, 21, th.panel) + R(6, 12, 84, 0.6, '#fff', OP(0.12));
    const cols = th.capColors || ['#ff8a1c', '#f5d22e', '#e2402f', '#3b8fe0'];
    if (!lo) {
      s += sliderRow(8, 14.6, 54, 8.4, 22, { cap: th.cap || '#262626', line: th.capLine || '#f0f0f0', groove: '#050505', seed: 13 });
      s += knobRow(64, 18.4, 24, 4, 2.1, { skirt: '#0b0b0b', cap: '#262626', ind: '#f0f0f0', seed: 9 });
      s += buttonRow(8, 27.4, 80, 3, 28, cols, { fill: 0.72, pick: i => Math.floor(i / 7) });
    } else s += R(9, 15, 52, 6, '#262626') + buttonRow(8, 26, 80, 3.4, 4, cols, { fill: 0.92 });
    s += R(6, 33, 84, 1.4, '#000', OP(0.6));
    return s + keys(7, 34.6, 82, 16.4, lo ? 12 : 25, { start: 0 }) + R(6, 51, 84, 1.4, '#222');
  },
  // a grey panel with the warm stripes, white-capped sliders and a few cream buttons
  juno60(th, lo) {
    let s = shadow(3, 93) + RR(3.5, 14, 4, 38, 1, '#141414') + RR(88.5, 14, 4, 38, 1, '#141414') + R(7.5, 14, 81, 19.5, th.panel);
    const st = th.stripes || ['#e9522c', '#f3a43b', '#f5d13a'];
    s += R(7.5, 14, 81, 1, st[0]) + R(7.5, 15.2, 81, 1, st[1]) + R(7.5, 16.4, 81, 1, st[2]);
    if (!lo) {
      s += sliderRow(10, 19.6, 56, 9.6, 16, { cap: th.cap || '#ececec', line: th.capLine || '#222', groove: '#111', seed: 17 });
      s += buttonRow(68, 21, 18, 2.6, 4, ['#e8e1cf'], { fill: 0.6 }) + buttonRow(68, 26, 18, 2.6, 4, ['#e8e1cf', '#f3a43b'], { fill: 0.6, pick: i => (i === 1 ? 1 : 0) });
    } else s += R(10, 21, 56, 6, '#ececec', OP(0.55));
    s += R(7.5, 33.5, 81, 1.4, '#000', OP(0.6));
    return s + keys(8.5, 35, 79, 16, lo ? 11 : 22) + R(7.5, 51, 81, 1.4, '#1a1a1b');
  },
  // a compact black body: knobs at the left, the patch panel of jacks (with two cords) at the right, a short keyboard
  ms20(th, lo) {
    let s = shadow(8, 88) + RR(9, 7, 78, 45, 1.6, th.panel) + R(11, 9, 74, 25.6, th.face) + R(11, 34.6, 74, 0.9, th.accent);
    if (!lo) {
      for (const [y, seed] of [[13.4, 2], [20.6, 4], [27.8, 6]]) s += knobRow(12, y, 46, 7, 2.3, { skirt: '#3a3a3a', cap: '#0d0d0d', ind: '#f4f4f4', seed });
      let jacks = '';
      for (let c = 0; c < 4; c++) for (let r = 0; r < 6; r++) jacks += C(62.5 + c * 5.6, 11.6 + r * 4.2, 1.25, '#9a9a9a') + C(62.5 + c * 5.6, 11.6 + r * 4.2, 0.6, '#050505');
      s += R(60, 9.6, 0.5, 23.6, '#3a3a3a') + jacks;
      s += S('M62.5 15.8C62 26 74 24 73.7 32.6', th.accent, 0.9) + S('M68.1 11.6C70 19 80 15 79.3 24.2', '#e8e8e8', 0.9);
    } else s += R(13, 12, 44, 2, '#f4f4f4', OP(0.4)) + R(13, 22, 44, 2, '#f4f4f4', OP(0.4)) + R(61, 11, 22, 21, '#9a9a9a', OP(0.35));
    return s + keys(lo ? 12 : 13, 37, lo ? 72 : 70, 14, lo ? 9 : 18, { start: 5 });
  },
  // a silver desktop box: knobs along the top, the small step keyboard below, the run / pattern buttons
  tb303(th, lo) {
    let s = shadow(5, 91, 50.6) + RR(6, 13, 84, 36, 2.4, '#8f9292') + RR(6, 12, 84, 35, 2.4, th.panel) + R(8, 12.6, 80, 0.8, '#fff', OP(0.55));
    if (!lo) {
      s += knobRow(10, 20.4, 60, 6, 3, { skirt: '#1a1a1a', cap: '#2a2a2a', ind: '#f2f2f2', seed: 21 });
      s += C(80.4, 20.4, 4.2, '#1a1a1a') + C(80.4, 20.4, 2.9, '#2a2a2a') + S('M80.4 20.4L82.2 18', '#f2f2f2', 0.8);
      // the 13-key step keyboard (white buttons with the black ones above them) and the step LEDs
      let wb = '', bb = '', led = '';
      for (let i = 0; i < 8; i++) wb += RR(18 + i * 7.2, 36.6, 5.8, 6.4, 0.7, '#f2f2ee');
      for (const i of [0, 1, 3, 4, 5]) bb += RR(21.4 + i * 7.2, 29.6, 4.6, 5.2, 0.7, '#1c1c1c');
      for (let i = 0; i < 16; i++) led += C(18.6 + i * 3.62, 45.2, 0.55, i % 4 === 0 ? th.accent : '#6b6e6e');
      s += wb + bb + led;
      s += RR(9, 36.6, 6.2, 6.4, 0.7, th.accent) + RR(9, 29.6, 6.2, 5.2, 0.7, '#e8e8e4') + RR(78.6, 33, 7.4, 4.4, 0.7, '#1c1c1c') + RR(78.6, 39, 7.4, 4.4, 0.7, '#1c1c1c');
    } else s += R(10, 18, 62, 4, '#1a1a1a', OP(0.8)) + R(14, 33, 62, 7, '#f2f2ee') + R(9, 33, 4, 7, th.accent);
    return s;
  },
  // a long brown-grey body: the LCD, the data-entry slider, two rows of membrane buttons over a long keyboard
  dx7(th, lo) {
    let s = shadow(1, 95) + RR(2, 9, 92, 43, 1.4, th.panel) + R(2, 9, 92, 0.7, '#fff', OP(0.12));
    s += RR(7, 13.2, 21, 6, 0.6, '#0b1513') + R(8.2, 14.6, 18.6, 3.2, th.accent, OP(0.22));
    if (!lo) {
      let seg = '';
      for (let i = 0; i < 10; i++) seg += R(8.8 + i * 1.8, 15.4, 1.2, 1.6, '#8ff5e3', OP(0.7));
      s += seg + S('M33 12.6V24', '#1d1917', 1.3) + R(31.4, 17, 3.2, 2, '#cfc6bb');
      s += buttonRow(38, 12.8, 52, 3.2, 16, ['#2f8f83', '#2f8f83', '#2f8f83', '#2f8f83', '#8a3b3b', '#cfc6bb'], { fill: 0.76, pick: i => (i < 6 ? 0 : i < 12 ? 4 : 5) });
      s += buttonRow(38, 18.6, 52, 3.2, 16, ['#2f8f83', '#8a3b3b', '#cfc6bb'], { fill: 0.76, pick: i => (i < 6 ? 0 : i < 12 ? 1 : 2) });
      s += R(7, 24.6, 83, 0.6, th.accent, OP(0.6)) + buttonRow(7, 26.4, 21, 2.2, 4, ['#cfc6bb'], { fill: 0.7 });
    } else s += R(38, 13, 52, 3, '#2f8f83') + R(38, 19, 52, 3, '#8a3b3b');
    s += R(2, 30.6, 92, 1.4, '#000', OP(0.5));
    return s + keys(4.5, 32.4, 87, 18.6, lo ? 12 : 25) + R(2, 51, 92, 1.2, '#2c2725');
  },
  // a wide, low case with dark cheeks: twelve columns of knobs (orange level discs on top, white ones below), cream name plates,
  // an orange rule, and the run of sixteen step keys in four colour groups (red, orange, yellow, white)
  tr808(th, lo) {
    let s = shadow(4, 92, 50.6) + R(4, 7, 88, 43, th.face) + R(4, 7, 5, 43, '#131315') + R(87, 7, 5, 43, '#131315') + R(9, 7, 78, 43, th.panel) + R(9, 7, 78, 0.9, '#fff', OP(0.1));
    const A = th.accent || '#f0862a', cols = [1, 3, 3, 2, 2, 2, 1, 1, 1, 3, 2, 1], gap = 6.2, x0 = 11.4 + gap / 2;
    if (!lo) {
      for (let c = 0; c < 12; c++) for (let r = 0; r < cols[c]; r++) {
        const cx = x0 + c * gap - gap / 2 + 0.2, cy = 12.2 + r * 6.6;
        s += C(cx, cy, 2, '#0b0b0c') + C(cx, cy, 1.05, r ? '#f1efe8' : A);
      }
      s += buttonRow(11.2, 32.4, 74.4, 2.3, 12, ['#e6e2b6'], { fill: 0.82 }) + R(11.2, 36, 74.4, 0.45, A);
      let led = '';
      for (let i = 0; i < 16; i++) led += C(11.2 + 4.65 * (i + 0.5), 39, 0.5, '#1a0b09');
      s += buttonRow(11.2, 37.8, 74.4, 8.2, 16, ['#e8402c', '#f4893c', '#f5dc4e', '#f4f3ee'], { fill: 0.7, pick: i => i >> 2 }) + led;
    } else {
      s += R(12, 11, 72, 2.6, '#0b0b0c') + R(12, 17, 72, 2.2, '#f1efe8', OP(0.8)) + R(12, 22, 72, 2.2, '#f1efe8', OP(0.8));
      s += R(12, 11, 72, 1.6, A) + buttonRow(11.2, 34, 74.4, 9, 4, ['#e8402c', '#f4893c', '#f5dc4e', '#f4f3ee'], { fill: 0.9 });
    }
    return s + R(9, 46.4, 78, 3.6, '#17171a');
  },
  // a silver desktop box like the 303's (its partner): six knobs along the top; TEMPO, two selectors and VOLUME below them; a dark
  // programming panel with the scale rows over sixteen grey keys (red LEDs above, the step numbers as a red rule), the run, group
  // and tap keys round them. No text (a model name is a plain rule).
  tr606(th, lo) {
    let s = shadow(5, 91, 50.6) + RR(6, 13, 84, 36, 2.4, '#8f9292') + RR(6, 12, 84, 35, 2.4, th.panel) + R(8, 12.6, 80, 0.8, '#fff', OP(0.55));
    const DK = '#1a1b1b', CAP = '#c9cbc8', STRIP = '#d9dad7';
    s += RR(7.6, 31.6, 80.8, 14.4, 1, DK);
    if (!lo) {
      s += knobRow(27, 16.6, 48, 6, 2.5, { skirt: '#2a2c2d', cap: '#d3d5d5', ind: '#262626', seed: 31 }) + R(8, 21.6, 80, 0.5, '#8b8d8d');
      s += C(15, 26.8, 3.3, '#2a2c2d') + C(15, 26.8, 2.5, '#d3d5d5') + S('M15 26.8L16.6 24.6', '#262626', 0.7);
      s += C(34, 26.8, 3, '#a9abab') + C(34, 26.8, 1.1, '#7f8181') + S('M34 26.8L31.8 27.6', '#5b5d5d', 0.8);
      s += C(48, 26.8, 3, '#a9abab') + C(48, 26.8, 1.1, '#7f8181') + S('M48 26.8L50.4 25.4', '#5b5d5d', 0.8);
      s += R(58, 26, 14, 0.6, '#1a1a1a', OP(0.7)) + R(60, 28.2, 10, 0.4, '#1a1a1a', OP(0.5));
      s += C(81, 26.8, 3.3, '#2a2c2d') + C(81, 26.8, 2.5, '#d3d5d5') + S('M81 26.8L79.6 24.8', '#262626', 0.7);
      for (let i = 0; i < 4; i++) s += R(19.4, 32.6 + i * 0.9, 51.2, 0.45, '#e8e8e6', OP(0.8));
      let led = '';
      for (let i = 0; i < 16; i++) led += C(21 + 3.2 * i, 36.9, 0.5, i % 4 === 0 ? th.accent : '#5a1812');
      s += led + R(19.4, 37.8, 51.2, 6.4, STRIP) + buttonRow(19.4, 38.6, 51.2, 4.8, 16, ['#a7a9a7'], { fill: 0.62 });
      s += R(19.4, 44.5, 51.2, 0.6, th.accent, OP(0.9)) + R(19.4, 45.2, 51.2, 0.5, '#eee', OP(0.5));
      s += RR(9, 33.2, 6.4, 2.4, 0.5, CAP) + C(12.2, 37.5, 0.6, th.accent) + RR(9, 39.6, 6.4, 5.2, 0.6, CAP);
      s += R(16.9, 32.8, 0.9, 5.4, '#050505') + RR(16.5, 34.2, 1.7, 1.6, 0.4, '#c4c4c4') + RR(16.4, 39.6, 1.8, 5.2, 0.4, CAP);
      s += C(76.4, 34.2, 0.7, th.accent) + C(80.2, 34.2, 0.7, '#5a1812') + RR(74.4, 35.8, 7.6, 2, 0.5, CAP) + RR(74.4, 39.6, 8.8, 5.2, 0.6, CAP);
    } else s += R(27, 15, 48, 3.6, '#1a1a1a', OP(0.8)) + R(19.4, 36.5, 51.2, 6.6, STRIP) + R(9, 34, 8, 9, CAP) + R(74.4, 36.5, 9, 6.6, th.accent);
    return s;
  },
  // a wide, low light case (the 808's body family): nine blocks of dark navy knobs under slate header bars, a middle band (two cream
  // keys, a red three-digit display, TEMPO, a row of small keys, ENTER, VOLUME), the four scale rows over sixteen cream step keys with a
  // red LED each (every fourth lit), a slate legend strip and the dark instrument boxes. No text (a model name is a plain rule).
  tr909(th, lo) {
    const A = th.accent || '#f28c28', INK = th.ink || '#2c3550', SLATE = th.label || '#5b6580', CREAM = '#fffddc', CAP = '#d9cca8', STEPC = '#f3ebcf', LIT = '#ff3b2a', DIM = '#4b1812';
    let s = shadow(4, 92, 50.6) + R(4, 7, 88, 43, '#bdbdb4') + R(5, 7.6, 86, 41.8, th.panel) + R(5, 7.6, 86, 0.8, '#fff', OP(0.55));
    if (!lo) {
      const blk = [[0, 1], [2, 2], [2, 2], [2, 1], [2, 1], [2, 1], [2, 0], [1, 2], [2, 2]], bw = 84 / 9; // knobs [top row, bottom row] per block
      let ind = '';
      blk.forEach(([t, b], i) => {
        const x0 = 6 + bw * i;
        s += R(x0 + 0.3, 9, bw - 0.6, 1.5, SLATE);
        [[t, 14.2], [b, 19.4]].forEach(([n, cy], r) => {
          for (let k = 0; k < n; k++) {
            const cx = n === 1 ? x0 + bw / 2 : x0 + bw * (0.3 + 0.4 * k), a = -2.4 + 4.8 * rnd(i * 4 + r * 2 + k, 9);
            s += C(cx, cy, 1.55, INK);
            ind += `M${f(cx)} ${f(cy)}L${f(cx + Math.sin(a) * 1.35)} ${f(cy - Math.cos(a) * 1.35)}`;
          }
        });
      });
      s += S(ind, A, 0.4) + R(6, 23.4, 84, 0.4, SLATE, OP(0.6));
      s += RR(6.6, 25.8, 5.6, 6, 0.7, CREAM) + RR(13, 25.8, 5.6, 6, 0.7, CREAM) + RR(20, 25.4, 11, 6.8, 0.8, '#262b3d') + R(21.2, 26.6, 8.6, 4.4, '#140606');
      for (let i = 0; i < 3; i++) s += R(22.3 + i * 2.8, 27.6, 1.7, 2.4, LIT, OP(0.9));
      s += C(38.5, 29, 2.6, INK) + C(38.5, 29, 1.7, '#3b476b') + S('M38.5 29L39.6 27.2', A, 0.5);
      let kd = '';
      for (let i = 0; i < 14; i++) kd += C(46.6 + 2.2 * i, 27.5, 0.35, DIM);
      s += buttonRow(45.4, 26.6, 31, 3.6, 14, [CAP], { fill: 0.66 }) + kd;
      s += RR(78.4, 25.8, 5.4, 6, 0.7, CREAM) + C(88, 29, 2.4, INK) + C(88, 29, 1.6, '#3b476b') + S('M88 29L87 27.4', A, 0.5);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) s += RR(7 + c * 5.2, 35 + r * 4.2, 3.6, 3, 0.5, CAP);
      for (let i = 0; i < 4; i++) s += R(19, 34.6 + i * 1.1, 71.4, 0.8, SLATE);
      let led = '';
      for (let i = 0; i < 16; i++) led += C(19 + 4.46 * (i + 0.5), 41.5, 0.5, i % 4 === 0 ? LIT : DIM);
      s += R(19, 39.6, 71.4, 6, '#b9b4a2') + buttonRow(19, 40.2, 71.4, 4.8, 16, [STEPC], { fill: 0.72 }) + led + R(19, 45.6, 71.4, 1, SLATE) + R(19, 46.9, 71.4, 1.3, INK);
    } else {
      s += R(6, 9, 84, 1.6, SLATE) + knobRow(8, 15, 80, 9, 1.6, { cap: INK }) + knobRow(8, 19.6, 80, 7, 1.6, { cap: INK });
      s += RR(7, 25.8, 12, 6, 0.7, CREAM) + R(21, 25.6, 11, 6.4, '#262b3d') + R(19, 34.6, 71.4, 4, SLATE) + R(19, 39.6, 71.4, 6, '#b9b4a2') + buttonRow(19, 40.4, 71.4, 5, 8, [STEPC], { fill: 0.8 }) + R(19, 46.9, 71.4, 1.3, INK);
    }
    return s;
  },
  // an abstract software instrument: a stacked wavetable, knob rings and a filter curve on a dark panel
  serum(th, lo) {
    const A = th.accent || '#4fb3ff';
    let s = shadow(5, 91, 52) + RR(6, 5, 84, 45, 4, th.panel, ' stroke="#2a333d" stroke-width="0.8"') + RR(6, 5, 84, 7, 4, th.face) + R(6, 9, 84, 3, th.face);
    s += R(10, 7.6, 14, 1.8, A, OP(0.65)) + R(27, 7.6, 10, 1.8, '#7f8b98', OP(0.5));
    const waves = lo ? 3 : 7;
    for (let k = 0; k < waves; k++) {
      const ox = 12 + k * 2.6, oy = 40 - k * 3, amp = 6 - k * 0.35, ph = k * 0.5;
      let d = `M${f(ox)} ${f(oy)}`;
      for (let i = 1; i <= 24; i++) { const t = i / 24; d += `L${f(ox + t * 34)} ${f(oy - amp * Math.sin(t * Math.PI * 2 + ph) * (0.6 + 0.4 * Math.sin(t * Math.PI * 4 + k)))}`; }
      s += S(d, A, lo ? 1.1 : 0.7, OP(f(0.35 + 0.65 * (k + 1) / waves)));
    }
    if (!lo) {
      for (let i = 0; i < 6; i++) {
        const cx = 66 + (i % 3) * 8, cy = 20 + Math.floor(i / 3) * 9, a = 0.6 + 3.6 * rnd(i, 31);
        const arc = (r, a1) => `M${f(cx + r * Math.sin(-2.4))} ${f(cy - r * Math.cos(-2.4))}A${r} ${r} 0 ${a1 > Math.PI ? 1 : 0} 1 ${f(cx + r * Math.sin(a1 - 2.4))} ${f(cy - r * Math.cos(a1 - 2.4))}`;
        s += S(arc(3.1, 4.8), '#2a333d', 0.8) + S(arc(3.1, a), A, 0.9) + C(cx, cy, 2.1, '#1c232b') + S(`M${f(cx)} ${f(cy)}L${f(cx + 1.8 * Math.sin(a - 2.4))} ${f(cy - 1.8 * Math.cos(a - 2.4))}`, '#dfe6ee', 0.5);
      }
      s += S('M62 44C70 44 74 44 77 38.6C79 35 81 42 86 46', '#ff8a5b', 0.9) + R(62, 46, 26, 0.5, '#2a333d');
    } else s += C(70, 22, 3, A, OP(0.6)) + C(80, 22, 3, A, OP(0.6));
    return s;
  },
};

/* ---------------------------------------------------------------- glyphs (32 × 32 design box, currentColor strokes) */
const G = {
  osc: '<path d="M4 22l6-12 6 12 6-12 6 12" stroke-width="2.2"/><path d="M7 26l6-12 6 12 6-12" opacity="0.45"/>',
  filter: '<path d="M3 11h14c5 0 6-3 8-1 2 3 2 9 4 15" stroke-width="2.2"/>',
  sub: '<path d="M3 16c3.3-11 9.7-11 13 0s9.7 11 13 0" stroke-width="2.2"/>',
  noise: '<path d="M3 16l2-6 2 11 2-9 2 7 2-12 2 14 2-8 2 5 2-10 2 9 2-4 2 3 2-5" stroke-width="1.8"/>',
  voice: '<path d="M4 26l5-17 5 7h7l7 10" stroke-width="2.2"/><path d="M4 26h24" opacity="0.4"/>',
  lfo: '<path d="M3 16c3.3-9 6.7-9 10 0s6.7 9 10 0 4-7 6-7" stroke-width="2.2"/><circle cx="23" cy="16" r="2.2" fill="currentColor" stroke="none"/>',
  env: '<path d="M3 27L9 6l6 11h8l6 10" stroke-width="2.2"/>',
  wheel: '<rect x="11" y="3" width="10" height="26" rx="3" stroke-width="2"/><path d="M11 13h10M11 17h10" opacity="0.5"/>',
  velo: '<rect x="9" y="12" width="14" height="17" rx="1.5" stroke-width="2"/><path d="M16 9V2M12.5 5.5L16 2l3.5 3.5" stroke-width="2"/>',
  macro: '<circle cx="6" cy="10" r="3"/><circle cx="16" cy="10" r="3"/><circle cx="26" cy="10" r="3"/><circle cx="11" cy="22" r="3"/><circle cx="21" cy="22" r="3"/><path d="M6 10V7.5M16 10l2-1.5M26 10l-1.8-2M11 22l1.8 1.5M21 22V19.5"/>',
  fx: '<rect x="7" y="3" width="18" height="26" rx="3" stroke-width="2"/><circle cx="12" cy="10" r="2.2"/><circle cx="20" cy="10" r="2.2"/><rect x="11" y="18" width="10" height="6" rx="1.2" fill="currentColor" stroke="none" opacity="0.6"/>',
  out: '<path d="M5 12h5l7-6v20l-7-6H5z" stroke-width="2" stroke-linejoin="round"/><path d="M21 11c2 2.7 2 7.3 0 10M24.6 7.6c4 4.6 4 12.2 0 16.8"/>',
};
/** The glyph kinds (non-instrument modules and later tray sections). */
export const GLYPHS = Object.freeze(Object.keys(G));

/* ---------------------------------------------------------------- public */
const cache = new Map();
const byId = id => MODELS.find(m => m.id === id) || null;
const wrap = (w, h, inner, label) => {
  const s = Math.min(w / W0, h / H0), tx = (w - W0 * s) / 2, ty = (h - H0 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" role="img" aria-hidden="true" focusable="false" class="cv-art-svg" data-art="${label}"><g transform="translate(${f(tx)} ${f(ty)}) scale(${f(s * 1000) / 1000})">${inner}</g></svg>`;
};
/** The drawing of model `id` as an SVG string (viewBox 0 0 w h, role=img, aria-hidden); cached per id + size. An unknown id
 * gets a plain keyboard.
 * @param {string} id @param {{w?: number, h?: number}} [o] @returns {string} */
export function art(id, o) {
  const w = Math.max(8, Math.round(+(o && o.w) || TILE.w)), h = Math.max(6, Math.round(+(o && o.h) || TILE.h)), k = id + ':' + w + 'x' + h;
  let s = cache.get(k);
  if (s) return s;
  const m = byId(id), th = (m && m.theme) || { panel: '#1a1a1a', face: '#222', accent: '#f2a33a' }, lo = w < 48;
  const draw = DRAW[id] || ((t, l) => shadow(3, 93) + R(6, 14, 84, 18, t.panel) + keys(7, 33, 82, 18, l ? 10 : 22));
  s = wrap(w, h, draw(th, lo), DRAW[id] ? id : 'keyboard');
  cache.set(k, s);
  return s;
}
/** The track-row chip drawing (CHIP size). @param {string} id @returns {string} */
export function chip(id) { return art(id, CHIP); }
/** Abstract glyphs for non-instrument modules and later trays: 'osc' | 'filter' | 'sub' | 'noise' | 'voice' | 'lfo' |
 * 'env' | 'wheel' | 'velo' | 'macro' | 'fx' | 'out' (strokes in currentColor). @param {string} kind @param {{w?: number, h?: number}} [o] @returns {string} */
export function glyph(kind, o) {
  const w = Math.max(8, Math.round(+(o && o.w) || 32)), h = Math.max(8, Math.round(+(o && o.h) || 32)), k = 'g:' + kind + ':' + w + 'x' + h;
  let s = cache.get(k);
  if (s) return s;
  const s0 = Math.min(w, h) / 32, tx = (w - 32 * s0) / 2, ty = (h - 32 * s0) / 2;
  s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true" focusable="false" class="cv-glyph" data-glyph="${G[kind] ? kind : 'fx'}"><g transform="translate(${f(tx)} ${f(ty)}) scale(${f(s0 * 1000) / 1000})" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${G[kind] || G.fx}</g></svg>`;
  cache.set(k, s);
  return s;
}
/** Tile text from models.js: {id, name, year, maker, label} (label: the tray's name, 'Serum (complete)' for serum).
 * @param {string} id @returns {{id: string, name: string, year: number, maker: string, label: string}} */
export function tileMeta(id) {
  const m = byId(id) || { id, name: String(id), year: 0, maker: '' };
  return { id: m.id, name: m.name, year: m.year, maker: m.maker, label: m.id === 'serum' ? 'Serum (complete)' : m.name };
}
