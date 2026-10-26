// The bundled fonts (IMPL-A §3.3, gate G4): Inter (variable) and JetBrains Mono 400 / 600 as woff2 files in fonts/, named by
// fonts/fonts.css, linked from index.html at ?v=N; the SIL OFL texts beside them; tools/precache.mjs's CSS url() crawl putting
// the files in sw.js's STATIC list (so the service worker and the iPad app's bundle carry them); sw.js with no Google Fonts code.
// Pure file checks — no browser; the glyph-for-glyph comparison with the Google-served build was a headless-Chrome screenshot diff
// (docs/canvas/IMPL-A.md §12, lane W2). (WC, IMPL-WC §5.3; lane U) Archivo Narrow, the rig skins' narrow face: one variable Latin
// file (wght 400–700, Google Fonts v35's latin subset, the cord lab's face), its OFL text beside it, no request leaves the site.
// Run: node --max-old-space-size=2048 --test tests/fonts.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appRequests, cssUrls, licenceFiles, renderSw } from '../tools/precache.mjs';

const ROOT = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const N = /const VERSION = '(\d+)'/.exec(read('main.js'))[1];
const CSS = read('fonts/fonts.css'), HTML = read('index.html'), SW = read('sw.js');
const WOFF2 = ['InterVariable.woff2', 'JetBrainsMono-Regular.woff2', 'JetBrainsMono-SemiBold.woff2', 'ArchivoNarrowVariable.woff2'];
// (WC) Google's latin subset of Archivo Narrow, as the cord lab's request got it (Google Fonts v35): its unicode-range, verbatim
const AN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// the tables of a WOFF2 file (w3.org/TR/WOFF2): a 48-byte header, the table directory, one brotli stream. Only the tables the format
// leaves untransformed (fvar, OS/2, name, cmap, head …) are read; glyf / loca / hmtx come out in their transformed form.
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp',
  'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ',
  'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar'];
function woff2(buf) {
  const head = { sig: buf.toString('latin1', 0, 4), flavor: buf.readUInt32BE(4), length: buf.readUInt32BE(8), n: buf.readUInt16BE(12), packed: buf.readUInt32BE(20) };
  let p = 48;
  const u128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = buf[p++]; v = v * 128 + (c & 0x7f); if (!(c & 0x80)) break; } return v; };
  const dir = [];
  for (let i = 0; i < head.n; i++) {
    const flags = buf[p++], xf = flags >> 6;
    let tag = flags & 63;
    if (tag === 63) { tag = buf.toString('latin1', p, p + 4); p += 4; } else tag = TAGS[tag];
    const orig = u128(), transformed = tag === 'glyf' || tag === 'loca' ? xf !== 3 : xf !== 0;
    dir.push({ tag, size: transformed ? u128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + head.packed)), tables = {};
  let off = 0;
  for (const t of dir) { tables[t.tag] = data.subarray(off, off + t.size); off += t.size; }
  return { ...head, tables, rest: data.length - off }; // (rest: the stream's bytes past the directory's tables — 0 in a valid file)
}
const names = tab => { // name table records (Windows platform) → { id: string }
  const out = {}, cnt = tab.readUInt16BE(2), str = tab.readUInt16BE(4);
  for (let i = 0; i < cnt; i++) {
    const r = 6 + i * 12;
    if (tab.readUInt16BE(r) !== 3) continue;
    out[tab.readUInt16BE(r + 6)] = Buffer.from(tab.subarray(str + tab.readUInt16BE(r + 10), str + tab.readUInt16BE(r + 10) + tab.readUInt16BE(r + 8))).swap16().toString('utf16le');
  }
  return out;
};
const axes = fvar => { // [{ tag, min, def, max }]
  const o = fvar.readUInt16BE(4), cnt = fvar.readUInt16BE(8), sz = fvar.readUInt16BE(10);
  return Array.from({ length: cnt }, (_, i) => ({ tag: fvar.toString('latin1', o + i * sz, o + i * sz + 4), min: fvar.readInt32BE(o + i * sz + 4) / 65536,
    def: fvar.readInt32BE(o + i * sz + 8) / 65536, max: fvar.readInt32BE(o + i * sz + 12) / 65536 }));
};
const codepoints = cmap => { // the cmap's Unicode code points that have a glyph (formats 4 and 12, which every subtable of these files is)
  const set = new Set();
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const off = cmap.readUInt32BE(8 + i * 8), fmt = cmap.readUInt16BE(off);
    if (fmt === 4) {
      const sc = cmap.readUInt16BE(off + 6) / 2, ends = off + 14, starts = ends + sc * 2 + 2, deltas = starts + sc * 2, ro = deltas + sc * 2;
      for (let s = 0; s < sc; s++) {
        const e = cmap.readUInt16BE(ends + s * 2), b = cmap.readUInt16BE(starts + s * 2), d = cmap.readInt16BE(deltas + s * 2), r = cmap.readUInt16BE(ro + s * 2);
        for (let c = b; c <= e && c < 0xffff; c++) {
          const g = r === 0 ? (c + d) & 0xffff : (x => (x ? (x + d) & 0xffff : 0))(cmap.readUInt16BE(ro + s * 2 + r + (c - b) * 2));
          if (g) set.add(c);
        }
      }
    } else if (fmt === 12) {
      for (let g = 0, ng = cmap.readUInt32BE(off + 12); g < ng; g++) {
        const b = cmap.readUInt32BE(off + 16 + g * 12), e = cmap.readUInt32BE(off + 20 + g * 12), gl = cmap.readUInt32BE(off + 24 + g * 12);
        for (let c = b; c <= e; c++) if (gl + c - b) set.add(c);
      }
    }
  }
  return set;
};
// a unicode-range descriptor → [[lo, hi], …] (U+41, U+4?? and U+0025-00FF forms); no descriptor = the whole of Unicode
const rangesOf = v => v === undefined ? [[0, 0x10ffff]] : v.split(',').map(s => {
  const t = s.trim().replace(/^U\+/i, '');
  if (t.includes('?')) return [parseInt(t.replace(/\?/g, '0'), 16), parseInt(t.replace(/\?/g, 'F'), 16)];
  const [a, b] = t.split('-');
  return [parseInt(a, 16), parseInt(b === undefined ? a : b, 16)];
});
const inRanges = (R, cp) => R.some(([a, b]) => cp >= a && cp <= b);

test('fonts/fonts.css: Inter (one variable file, weights 400–800 as the site always asked), JetBrains Mono 400 and 600, (WC) Archivo Narrow 400–700 (one variable file); swap; relative urls; font-optical-sizing off', () => {
  const faces = [...noComments(CSS).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
    const get = k => (new RegExp('(?:^|;|\\s)' + k + ':\\s*([^;]+)').exec(m[1]) || [])[1];
    return { family: get('font-family').replace(/['"]/g, ''), style: get('font-style'), weight: get('font-weight'), display: get('font-display'), src: get('src') };
  });
  assert.deepEqual(faces.map(f => [f.family, f.weight, /url\(([^)]+)\) format\('woff2'\)$/.exec(f.src)[1]]), [
    ['Inter', '400 800', 'InterVariable.woff2'],
    ['JetBrains Mono', '400', 'JetBrainsMono-Regular.woff2'],
    ['JetBrains Mono', '600', 'JetBrainsMono-SemiBold.woff2'],
    ['Archivo Narrow', '400 700', 'ArchivoNarrowVariable.woff2'],
  ]);
  for (const f of faces) assert.deepEqual([f.style, f.display], ['normal', 'swap'], f.family + ' ' + f.weight);
  assert.deepEqual(cssUrls(CSS), WOFF2, 'the seven-file plan became three: the variable Inter and two JetBrains Mono; (WC) the narrow face one more — one variable file, not IMPL-WC §5.3\'s three weights');
  // (WC) the rig skins' face font (IMPL-WC §5.3): Archivo Narrow first, Inter its fallback, then the UI stack — so a face reads the same without it
  assert.match(read('style.css'), /--rig-font: 'Archivo Narrow', Inter, var\(--ui\);/);
  // font-optical-sizing: auto (the default) would draw style.css's 14–34 px text with Inter's Display shapes; Google's wght-only request never did.
  // A `font:` shorthand resets it to auto, so the rule is on every element and !important (a :root rule missed the --ik-scaled labels;
  // IMPL-A §12, lane W2). Canvas ctx.font text above 14 px still takes opsz — a known limit.
  assert.match(noComments(CSS), /\*,\s*\*::before,\s*\*::after\s*\{\s*font-optical-sizing:\s*none\s*!important;\s*\}/);
  assert.doesNotMatch(noComments(CSS), /:root\s*\{[^}]*font-optical-sizing/);
  // style.css asks for these two families by these names, first in the stacks, and for no weight the faces do not have
  const css = read('style.css');
  assert.match(css, /--ui: 'Inter', system-ui/);
  assert.match(css, /--mono: 'JetBrains Mono', ui-monospace/);
  assert.doesNotMatch(css, /font(?:-weight)?:\s*(?:[1-3]00|900)\b/, 'no weight below 400 or above 800 (Inter would now be lighter than the Google-served build)');
});

test('the woff2 files: all present, valid WOFF2 (signature, the length field, TrueType outlines, the stream exactly the tables), each ≤ 400 KB, together ≤ 600 KB; nothing else in fonts/', () => {
  assert.deepEqual(readdirSync(new URL('fonts/', ROOT)).sort(), ['InterVariable.woff2', 'JetBrainsMono-Regular.woff2', 'JetBrainsMono-SemiBold.woff2',
    'ArchivoNarrowVariable.woff2', 'OFL-Inter.txt', 'OFL-JetBrainsMono.txt', 'OFL-ArchivoNarrow.txt', 'fonts.css'].sort());
  let total = 0;
  for (const f of WOFF2) {
    const path = 'fonts/' + f, buf = readFileSync(new URL(path, ROOT));
    assert.ok(existsSync(new URL(path, ROOT)), path);
    const W = woff2(buf);
    assert.equal(W.sig, 'wOF2', path);
    assert.equal(W.length, buf.length, path + ': the length field is the file\'s size');
    assert.equal(W.flavor, 0x00010000, path + ': TrueType outlines');
    assert.ok(W.n > 8 && W.tables['OS/2'] && W.tables.name && W.tables.cmap, path + ': its tables');
    assert.equal(W.rest, 0, path + ': the brotli stream holds exactly the directory\'s tables');
    assert.ok(buf.length <= 400 * 1024, path + ' is ' + buf.length + ' bytes');
    total += buf.length;
  }
  assert.ok(total <= 600 * 1024, 'the four files are ' + total + ' bytes');
  // (WC) the narrow face is small: one Latin subset, every weight in one file (IMPL-WC §5.3's budget: ≤ 150 KB in all)
  const an = readFileSync(new URL('fonts/ArchivoNarrowVariable.woff2', ROOT)), A = woff2(an);
  assert.ok(an.length <= 24 * 1024, 'Archivo Narrow is ' + an.length + ' bytes');
  assert.deepEqual([A.n, Object.keys(A.tables).sort().join(' ')], [19, 'GDEF GPOS GSUB HVAR OS/2 STAT avar cmap fvar gasp glyf gvar head hhea hmtx loca maxp name post'], 'its tables (a variable TrueType font: fvar / gvar / avar / HVAR / STAT)');
});

test('the files are what fonts.css says: Inter Variable has wght 100–900 and opsz 14–32 (default 14, so none = the Google-served shapes); JetBrains Mono\'s two files are its Regular and SemiBold; (WC) Archivo Narrow\'s wght 400–700', () => {
  const inter = woff2(readFileSync(new URL('fonts/InterVariable.woff2', ROOT)));
  const A = Object.fromEntries(axes(inter.tables.fvar).map(a => [a.tag, a]));
  assert.deepEqual(Object.keys(A).sort(), ['opsz', 'wght']);
  assert.ok(A.wght.min <= 400 && A.wght.max >= 800 && A.wght.def === 400, 'wght covers the declared 400 800');
  assert.deepEqual([A.opsz.min, A.opsz.def, A.opsz.max], [14, 14, 32], 'opsz: unset (font-optical-sizing: none) stays at its default, 14');
  assert.match(names(inter.tables.name)[1], /^Inter/);
  // (JetBrains Mono's SemiBold has usWeightClass 472, its designspace coordinate rather than 600: the browser takes the @font-face weight
  // descriptor, so only the order is checked here — the glyphs were compared with Google's 600 in a screenshot diff)
  const mono = f => woff2(readFileSync(new URL('fonts/' + f, ROOT))).tables;
  assert.equal(names(mono('JetBrainsMono-Regular.woff2').name)[4], 'JetBrains Mono Regular');
  assert.equal(names(mono('JetBrainsMono-SemiBold.woff2').name)[4], 'JetBrains Mono SemiBold');
  assert.equal(mono('JetBrainsMono-Regular.woff2')['OS/2'].readUInt16BE(4), 400);
  assert.ok(mono('JetBrainsMono-SemiBold.woff2')['OS/2'].readUInt16BE(4) > 400);
  // (WC) Archivo Narrow: one wght axis 400–700 (default 400) — the declared `400 700`: the faces' 600 labels are an instance of it, no
  // synthesis; its names (version 3.002, Omnibus-Type's)
  const an = woff2(readFileSync(new URL('fonts/ArchivoNarrowVariable.woff2', ROOT))).tables, N2 = names(an.name);
  assert.deepEqual(axes(an.fvar).map(a => [a.tag, a.min, a.def, a.max]), [['wght', 400, 400, 700]]);
  assert.deepEqual([N2[1], N2[4], N2[5], N2[6]], ['Archivo Narrow', 'Archivo Narrow Regular', 'Version 3.002', 'ArchivoNarrow-Regular']);
  assert.deepEqual([an['OS/2'].readUInt16BE(4), an['OS/2'].readUInt16BE(8)], [400, 0], 'usWeightClass 400 (the default instance); fsType 0: installable embedding, no restriction');
});

test('licences: the OFL texts beside the files (verbatim, with their copyright lines), and each woff2 carries the notice in its own name table (the app bundle ships the woff2 only); (WC) Archivo Narrow\'s text is the same OFL 1.1 under its project\'s copyright', () => {
  const inter = read('fonts/OFL-Inter.txt'), mono = read('fonts/OFL-JetBrainsMono.txt');
  for (const t of [inter, mono]) assert.match(t, /SIL Open Font License/);
  assert.match(inter, /Copyright .*The Inter Project Authors/);
  assert.match(mono, /Copyright .*The JetBrains Mono Project Authors/);
  for (const f of WOFF2) {
    const n = names(woff2(readFileSync(new URL('fonts/' + f, ROOT))).tables.name);
    assert.match(n[0], /Copyright .*Project Authors/, f + ': copyright (name 0)');
    if (f.startsWith('Archivo')) assert.equal(n[14], 'https://scripts.sil.org/OFL', f + ': the licence URL (name 14; Google\'s subset carries no name 13 — the OFL text beside it ships in every copy, the R2-F4 test below)');
    else assert.match(n[13], /SIL Open Font License, Version 1\.1/, f + ': licence notice (name 13)');
  }
  // (WC) Archivo Narrow's: the project's copyright line, then the SIL OFL 1.1 — word for word the licence Inter and JetBrains Mono carry (the
  // official text: "PERMISSION & CONDITIONS" where Inter's copy spells "AND", https where it has http, the FAQ at scripts.sil.org where
  // JetBrains Mono's points to openfontlicense.org; spacing aside), no Reserved Font Name; the file as distributed (its CRLF line ends kept)
  const an = read('fonts/OFL-ArchivoNarrow.txt'), an0 = woff2(readFileSync(new URL('fonts/ArchivoNarrowVariable.woff2', ROOT))).tables.name, lines = an.split(/\r?\n/);
  assert.equal(lines[0], 'Copyright 2019 The Archivo Narrow Project Authors (https://github.com/Omnibus-Type/ArchivoNarrow)');
  assert.equal(lines[0], names(an0)[0], 'the text\'s copyright line is the font\'s own (name 0)');
  assert.ok(!/Reserved Font Name/.test(lines.slice(0, 3).join('\n')), 'no Reserved Font Name declared');
  const body = t => t.slice(t.indexOf('This Font Software is licensed')).replace(/PERMISSION AND CONDITIONS/, 'PERMISSION & CONDITIONS').replace(/http:\/\//g, 'https://')
    .replace('https://openfontlicense.org', 'https://scripts.sil.org/OFL').replace(/\s+/g, ' ').trim();
  assert.ok(body(an) === body(inter) && body(an) === body(mono), 'the OFL 1.1 text, the same as the other two'); // (not assert.equal: 4 KB of text)
  assert.ok(body(an).endsWith('OTHER DEALINGS IN THE FONT SOFTWARE.') && body(an).includes('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007'));
});

test('index.html: no Google Fonts host, preconnect or noscript stylesheet; fonts.css at ?v=N before style.css; Inter preloaded as a CORS font', () => {
  assert.doesNotMatch(HTML, /fonts\.googleapis\.com|fonts\.gstatic\.com|rel="preconnect"|<noscript><link/);
  const i = HTML.indexOf('<link rel="stylesheet" href="fonts/fonts.css?v=' + N + '">');
  assert.ok(i > 0 && i < HTML.indexOf('<link rel="stylesheet" href="style.css?v=' + N + '">'));
  assert.ok(HTML.includes('<link rel="preload" as="font" type="font/woff2" crossorigin href="fonts/InterVariable.woff2">'));
});

test('the precache crawl: fonts/fonts.css is a versioned file, its four woff2 files are statics (found by the CSS url() crawl, not only the preload); data: URIs and fragments are not loads', () => {
  const R = appRequests();
  assert.deepEqual(R.problems, []);
  assert.ok(R.versioned.includes('fonts/fonts.css') && R.versioned.includes('style.css'));
  for (const f of WOFF2) assert.ok(R.statics.includes('fonts/' + f), f + ' in STATIC');
  assert.equal(R.statics.filter(s => s.endsWith('.woff2')).length, 4); // (and their three licence texts: the test below; (WC) the narrow face found by the crawl, never preloaded)
  // the preload names only Inter: the two JetBrains Mono files can come from the stylesheet crawl alone
  assert.deepEqual([...HTML.matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map(m => m[1]), ['fonts/InterVariable.woff2']);
  // style.css has url(#knobShine) and an inline data: SVG (whose xmlns is an http:// URL): neither is a file
  const style = read('style.css');
  assert.ok(style.includes('url(#knobShine)') && style.includes('url("data:image/svg+xml,'), 'style.css still has both kinds');
  assert.deepEqual(cssUrls(style), []);
  assert.deepEqual(cssUrls(`a { fill: url(#x) } b { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E") url(data:image/png;base64,AAAA) }
    /* url(commented.woff2) */ @font-face { src: url( "f.woff2?v=2" ) format('woff2'), url('g.woff2#frag'), url(h.woff2), url(https://x.test/i.woff2), url(//x.test/j.woff2) }`),
  ['f.woff2?v=2', 'g.woff2#frag', 'h.woff2']);
});

test('sw.js: no Google Fonts code (no FONTS cache, FONT_HOSTS, FONT_KEEP / FONT_WAIT, precacheFonts, font()), and its activate no longer spares synth-fonts-v1 — the retired cache goes with the other synth-* ones', () => {
  const code = noComments(SW);
  assert.doesNotMatch(code, /\bFONTS\b|FONT_HOSTS|FONT_KEEP|FONT_WAIT|precacheFonts|\bfont\(|synth-fonts|googleapis|gstatic/);
  assert.match(code, /k\.startsWith\(PREFIX\) && k !== SHELL\) await caches\.delete\(k\)/);
  // (the worker's behaviour — the three woff2 files precached and served offline, synth-fonts-v1 deleted at activate, the font hosts left alone —
  // runs in tests/pwa.test.mjs)
});

test('precache --write is a no-op on the committed sw.js: its lists and BUILD are the crawl\'s (run node tools/precache.mjs --write after any change to a precached file, the fonts included)', () => {
  const { src, R } = renderSw();
  assert.ok(src === SW, 'sw.js differs from what node tools/precache.mjs --write would write (VERSION ' + R.version + ', BUILD ' + R.build + ')'); // (not assert.equal: a 20 KB diff)
});

test('licence texts ship with the fonts (R2-F4): the precache lists fonts/OFL-*.txt whenever it lists woff2 files — the web worker caches them, the iPad app\'s bundle (= sw.js\'s lists) carries the SIL OFL with every copy; licenceFiles() takes OFL texts beside a bundled font only', () => {
  const R = appRequests();
  assert.deepEqual(R.problems, []);
  const fonts = R.statics.filter(s => /\.woff2$/.test(s)), lic = R.statics.filter(s => /^fonts\/OFL-[^/]+\.txt$/.test(s));
  assert.equal(fonts.length, 4);
  assert.deepEqual(lic, ['fonts/OFL-ArchivoNarrow.txt', 'fonts/OFL-Inter.txt', 'fonts/OFL-JetBrainsMono.txt'], 'the three licence texts, in STATIC');
  assert.deepEqual(R.statics.filter(s => s.startsWith('fonts/')), [...fonts, ...lic].sort(), 'nothing else of fonts/ is a static (fonts.css is the versioned one)');
  for (const f of lic) assert.match(read(f), /SIL Open Font License/, f);
  // the rule, on a scratch tree: OFL texts in the directory of a font (OFL-*.txt, OFL.txt), no other text, nothing where no font is listed
  const dir = mkdtempSync(join(tmpdir(), 'synth-fonts-lic-')), root = pathToFileURL(dir + '/');
  try {
    for (const d of ['a', 'b', 'c', 'd']) mkdirSync(join(dir, d));
    for (const f of ['a/F.woff2', 'a/OFL-X.txt', 'a/OFL-Y.txt', 'a/OFL.txt', 'a/notes.txt', 'a/OFLX.txt', 'b/G.woff2', 'c/OFL-Z.txt', 'd/H.ttf', 'd/OFL-H.txt']) writeFileSync(join(dir, f), 'x');
    assert.deepEqual(licenceFiles(['./', 'a/F.woff2', 'b/G.woff2', 'icons/i.png'], root), ['a/OFL-X.txt', 'a/OFL-Y.txt', 'a/OFL.txt'], 'beside a listed font; none in b (no licence there), none in c (no font listed)');
    assert.deepEqual(licenceFiles(['a/F.woff2', 'a/OFL-X.txt', 'd/H.ttf'], root), ['a/OFL-X.txt', 'a/OFL-Y.txt', 'a/OFL.txt', 'd/OFL-H.txt'], 'also .ttf; a listed text is not doubled');
    assert.deepEqual(licenceFiles(['./', 'icons/i.png'], root), [], 'no font, no licence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('♭ ♮ ♯ stay with the system face as before the fonts were bundled (R2): JetBrains Mono draws U+266D and U+266F, which read close to "#" beside the TB-303\'s note names, so its @font-face rules carry a unicode-range that leaves exactly U+266D–266F out; Inter has none of the three in its cmap and keeps the fallback', () => {
  const faces = [...noComments(CSS).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
    const get = k => (new RegExp('(?:^|;|\\s)' + k + ':\\s*([^;]+)').exec(m[1]) || [])[1];
    return { family: get('font-family').replace(/['"]/g, ''), file: /url\(([^)]+)\)/.exec(get('src'))[1], range: rangesOf(get('unicode-range')) };
  });
  assert.equal(faces.length, 4);
  const MUSIC = [0x266d, 0x266e, 0x266f]; // ♭ ♮ ♯
  for (const f of faces) {
    const cps = codepoints(woff2(readFileSync(new URL('fonts/' + f.file, ROOT))).tables.cmap);
    const drawn = MUSIC.filter(c => cps.has(c)), lost = [...cps].filter(c => !inRanges(f.range, c)).sort((a, b) => a - b);
    if (f.family === 'Archivo Narrow') { // ((WC) the narrow face: Google's latin range verbatim; no music signs, so it never takes them)
      assert.deepEqual([drawn, cps.size], [[], 232], f.file + ': no ♭ ♮ ♯; 232 code points (the latin subset)');
      assert.deepEqual(f.range, rangesOf(AN_RANGE), f.file + ': the latin unicode-range, as Google served it');
      assert.deepEqual(lost, [0x102, 0x300, 0x301, 0x303, 0x309, 0x323], f.file + ': the range leaves out only Ă and five combining marks the subset keeps for its composites');
      assert.ok([0x20, 0x41, 0x5a, 0x7e, 0xe9, 0x2013, 0x2026, 0x2212].every(c => cps.has(c) && inRanges(f.range, c)) && !inRanges(f.range, 0x266d), f.file + ': ASCII, é, – … − drawn; ♭ to the fallback');
      continue;
    }
    if (f.family === 'Inter') {
      assert.deepEqual(drawn, [], f.file + ': Inter has no ♭ ♮ ♯ (its ♪ ♫ at U+266A–266B are a different matter), so it needs no range');
      assert.deepEqual(lost, [], f.file + ': and loses no glyph');
    } else {
      assert.deepEqual(drawn, [0x266d, 0x266f], f.file + ': JetBrains Mono draws ♭ and ♯ (no ♮) — the rule is not vacuous');
      assert.deepEqual(lost, drawn, f.file + ': its unicode-range leaves out exactly those glyphs and no other the font has');
    }
    for (const c of MUSIC) assert.ok(f.family !== 'JetBrains Mono' || !inRanges(f.range, c), f.file + ': U+' + c.toString(16) + ' goes to the fallback');
    assert.ok([0x20, 0x41, 0x7e, 0x266c, 0x2670, 0x2192, 0x10ffff].every(c => inRanges(f.range, c)), f.file + ': the range around the three is open');
  }
});
