// The app icons (web app manifest, Apple touch icon, PNG favicon), drawn from the site's mark — the orange zig-zag of
// index.html's header and SVG favicon — on the site's dark background, with no dependencies: every pixel is computed
// from signed distances (rounded square, the mark's polyline with round caps and joins) with a one-pixel anti-aliasing
// ramp, composited in premultiplied RGBA, and written as an 8-bit RGBA PNG (per-row filter choice, node:zlib deflate).
//   node tools/make-icons.mjs          writes icons/*.png (deterministic: the same pixels on every run)
// The tests (tests/pwa.test.mjs) decode the committed files with decodePng and compare them with renderIcon.
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ the artwork */
// The mark: index.html's path, in its 32 × 32 viewBox (stroke 2.4, round joins and caps).
export const MARK = [[5, 21], [11, 9], [11, 21], [17, 9], [17, 21], [23, 9], [23, 21], [27, 13]];
const MARK_STROKE = 2.4;
const BG = [0x0c, 0x0d, 0x0f], BG_TOP = [0x19, 0x1b, 0x20], HOT = [0xf2, 0xa3, 0x3a];
// kind: 'any' (manifest icon: a rounded square, transparent corners), 'maskable' (full bleed; the mark inside the
// central 80 % safe circle), 'apple' (full bleed: iOS rounds the corners itself), 'favicon' (the SVG favicon at 32 px)
export const ICONS = Object.freeze([
  { file: 'icons/icon-192.png', kind: 'any', size: 192 },
  { file: 'icons/icon-512.png', kind: 'any', size: 512 },
  { file: 'icons/icon-maskable-512.png', kind: 'maskable', size: 512 },
  { file: 'icons/apple-touch-icon-180.png', kind: 'apple', size: 180 },
  { file: 'icons/favicon-32.png', kind: 'favicon', size: 32 },
]);
// per kind: corner radius (× size; 0 = full bleed), mark width (× size), glow and graticule on/off
const LOOK = {
  any: { r: 0.21, w: 0.6, glow: 1, grid: 1 },
  maskable: { r: 0, w: 0.5, glow: 1, grid: 1 },
  apple: { r: 0, w: 0.6, glow: 1, grid: 1 },
  favicon: { r: 7 / 32, w: 22 / 32, glow: 0, grid: 0 },
};

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay, L = vx * vx + vy * vy;
  const t = L > 0 ? clamp01((wx * vx + wy * vy) / L) : 0, dx = wx - t * vx, dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}
function roundRectDist(px, py, cx, cy, hw, hh, r) { // signed: < 0 inside
  const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// RGBA (straight alpha, 8 bits) of one icon
export function renderIcon(kind, size) {
  const L = LOOK[kind];
  if (!L) throw new Error('unknown icon kind ' + kind);
  const S = size, out = new Uint8Array(S * S * 4);
  // the mark: scaled to L.w × size, centred on its bounding box (the favicon keeps the SVG's own placement)
  const k = L.w * S / 22, fav = kind === 'favicon';
  const ox = fav ? 0 : S / 2 - 16 * k, oy = fav ? 0 : S / 2 - 15 * k;
  const pts = MARK.map(([x, y]) => [ox + x * (fav ? S / 32 : k), oy + y * (fav ? S / 32 : k)]);
  const hw = MARK_STROKE * (fav ? S / 32 : k) / 2;
  const sigma = 1.3 * hw, grid = S / 8, gridW = Math.max(1, S / 320);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      // background shape and colour: a vertical gradient, a faint scope graticule, a warm glow behind the mark
      const aBg = L.r > 0 ? clamp01(0.5 - roundRectDist(px, py, S / 2, S / 2, S / 2, S / 2, L.r * S)) : 1;
      const v = py / S;
      let r = BG_TOP[0] + (BG[0] - BG_TOP[0]) * v, g = BG_TOP[1] + (BG[1] - BG_TOP[1]) * v, b = BG_TOP[2] + (BG[2] - BG_TOP[2]) * v;
      if (L.grid) {
        const gx = Math.abs(((px + grid / 2) % grid) - grid / 2), gy = Math.abs(((py + grid / 2) % grid) - grid / 2);
        const line = Math.max(clamp01(gridW / 2 + 0.5 - gx), clamp01(gridW / 2 + 0.5 - gy)) * 0.05;
        r += (255 - r) * line; g += (255 - g) * line; b += (255 - b) * line;
      }
      if (L.glow) {
        const dx = (px - S / 2) / S, dy = (py - S / 2) / S, warm = 0.11 * Math.exp(-(dx * dx + dy * dy) / 0.045);
        r += (HOT[0] - r) * warm; g += (HOT[1] - g) * warm; b += (HOT[2] - b) * warm;
      }
      // premultiplied: background, then the mark's glow (inside the shape), then the mark
      let A = aBg, R = r * A, G = g * A, B = b * A;
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      if (L.glow) {
        const e = Math.max(d - hw, 0), ga = 0.34 * Math.exp(-(e * e) / (2 * sigma * sigma)) * aBg;
        R = HOT[0] * ga + R * (1 - ga); G = HOT[1] * ga + G * (1 - ga); B = HOT[2] * ga + B * (1 - ga); A = ga + A * (1 - ga);
      }
      const c = clamp01(0.5 - (d - hw));
      R = HOT[0] * c + R * (1 - c); G = HOT[1] * c + G * (1 - c); B = HOT[2] * c + B * (1 - c); A = c + A * (1 - c);
      const o = (y * S + x) * 4;
      if (A > 0) { out[o] = Math.round(R / A); out[o + 1] = Math.round(G / A); out[o + 2] = Math.round(B / A); }
      out[o + 3] = Math.round(A * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ PNG */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf, crc = 0xffffffff) {
  for (let i = 0; i < buf.length; i++) crc = CRC[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
function chunk(type, data) {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4), t = Buffer.from(type, 'latin1');
  head.writeUInt32BE(data.length, 0); t.copy(head, 4);
  tail.writeUInt32BE((crc32(data, crc32(t)) ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
// the five PNG filters of one row (bpp 4): filtered bytes of `type`
function filterRow(type, row, prev, out) {
  for (let i = 0; i < row.length; i++) {
    const a = i >= 4 ? row[i - 4] : 0, b = prev ? prev[i] : 0, c = prev && i >= 4 ? prev[i - 4] : 0;
    const p = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[i] = (row[i] - p) & 0xff;
  }
  return out;
}
export const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function encodePng(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), tmp = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride), prev = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestSum = Infinity;
    for (let t = 0; t < 5; t++) { // minimum sum of absolute differences (the usual heuristic)
      filterRow(t, row, prev, tmp);
      let s = 0; for (let i = 0; i < stride; i++) s += tmp[i] < 128 ? tmp[i] : 256 - tmp[i];
      if (s < bestSum) { bestSum = s; best = t; }
    }
    raw[y * (stride + 1)] = best;
    raw.set(filterRow(best, row, prev, tmp), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA, deflate, adaptive filtering, no interlace
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// The decoder the tests use (8-bit RGBA, non-interlaced — what encodePng writes): { w, h, rgba, chunks: [types] };
// throws on a bad signature or chunk CRC.
export function decodePng(buf) {
  if (!Buffer.from(buf.subarray(0, 8)).equals(PNG_SIG)) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0;
  const idat = [], chunks = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + n);
    const crc = buf.readUInt32BE(p + 8 + n);
    if (((crc32(data, crc32(Buffer.from(type, 'latin1'))) ^ 0xffffffff) >>> 0) !== crc) throw new Error('bad CRC in ' + type);
    chunks.push(type);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + n;
  }
  if (depth !== 8 || ctype !== 6 || inter !== 0) throw new Error('decodePng reads 8-bit RGBA non-interlaced PNGs only');
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, rgba = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const t = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[o + i - 4] : 0, b = y ? rgba[o - stride + i] : 0, c = y && i >= 4 ? rgba[o - stride + i - 4] : 0;
      const pr = t === 0 ? 0 : t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : t === 4 ? paeth(a, b, c) : NaN;
      if (Number.isNaN(pr)) throw new Error('bad filter type ' + t);
      rgba[o + i] = (src[i] + pr) & 0xff;
    }
  }
  return { w, h, rgba, chunks };
}

/* ------------------------------------------------------------------ CLI */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = new URL('../', import.meta.url);
  mkdirSync(new URL('icons/', ROOT), { recursive: true });
  for (const I of ICONS) {
    const png = encodePng(I.size, I.size, renderIcon(I.kind, I.size));
    writeFileSync(new URL(I.file, ROOT), png);
    console.log(I.file + '  ' + I.size + '×' + I.size + '  ' + png.length + ' bytes');
  }
}
