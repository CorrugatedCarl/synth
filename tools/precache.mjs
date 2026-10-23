// The service worker's precache list (sw.js ASSETS / STATIC), derived from the sources so it cannot drift from what the
// page actually requests:
//   index.html     the stylesheet, module script and modulepreloads (?v=N), the manifest and the icons it links;
//   manifest       its icons;
//   ES modules     from main.js and the modulepreloads, every relative import / export-from / import() (static
//                  './x.js?v=N', dynamic './x.js?v=' + VERSION; resolved against the importing file's directory:
//                  panels/<model>.js) and every 'x.js?v=' + VERSION string (AudioWorklet modules, Workers: against the
//                  page), followed through the files they name;
//   main.js        DSP_FILES (the AudioWorklet scripts, addModule(f + '?v=' + VERSION), also injected by wk.loadDSP);
//   smprender.js   its DSP list and engine.js (importScripts with the worker's own ?v=);
//   stylesheets    every relative url(…) of a versioned .css (fonts/fonts.css → the woff2 files) is a static, resolved against the
//                  stylesheet's directory — not data: URIs (style.css's select arrow), fragments (url(#knobShine)) or other schemes;
//                  a url(…) naming a file that is not in the site is a problem (an install would fail on its 404);
//   licences       the OFL-*.txt texts beside a bundled font (the SIL OFL wants the licence with every copy; the iPad app's bundle
//                  is these lists, so it carries them): statics too — licenceFiles().
// sw.js BUILD is a hash of those files' contents (buildHash): its precache is a cache of that build, so a change deployed
// without a VERSION bump still reaches the installed app (a new worker, a new precache, the update toast).
//   node tools/precache.mjs           prints the lists and the build
//   node tools/precache.mjs --write   rewrites sw.js's lists, its BUILD (and its VERSION = main.js VERSION)
// tests/pwa.test.mjs checks sw.js against appRequests() and buildHash(), and every site script against the crawl.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const read = (f, root = ROOT) => readFileSync(new URL(f, root), 'utf8');
const versionOf = src => (/const VERSION = '(\d+)'/.exec(src) || [])[1] || null;
const arrayOf = (src, name) => {
  const m = new RegExp('const ' + name + ' = \\[([^\\]]*)\\]').exec(src);
  if (!m) throw new Error('precache: no ' + name + ' list');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
};

// the files a stylesheet's url(…) names, as written (quoted or not; comments skipped). A data: URI (style.css's select arrow),
// another scheme, //host and a #fragment (url(#knobShine) in an SVG fill) are not files of ours.
export function cssUrls(css) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/g)) {
    const spec = (m[1] ?? m[2] ?? m[3]).trim();
    if (spec && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(spec)) out.push(spec);
  }
  return out;
}

// The SIL OFL asks every copy of a font to carry the licence, and the iPad app's bundle is exactly sw.js's lists: the OFL texts
// (OFL-*.txt, OFL.txt) in the directory of a listed font file are statics too — the page never requests them; the web worker caches
// them with the fonts. [statics] → ['fonts/OFL-Inter.txt', …], sorted; none for a directory with no font listed.
export function licenceFiles(statics, root = ROOT) {
  const out = new Set();
  for (const dir of new Set(statics.filter(s => /\.(?:woff2?|ttf|otf)$/i.test(s) && s.includes('/')).map(s => s.slice(0, s.lastIndexOf('/'))))) {
    if (!existsSync(new URL(dir + '/', root))) continue; // (a missing font is a problem of the url() crawl)
    for (const n of readdirSync(new URL(dir + '/', root))) if (/^OFL(?:-.+)?\.txt$/.test(n)) out.add(dir + '/' + n);
  }
  return [...out].sort();
}

// { version, versioned: [files requested at ?v=version], statics: [unversioned local URLs, './' first], problems: [] }
export function appRequests(root = ROOT) {
  const N = versionOf(read('main.js', root)), problems = [];
  const versioned = new Set(), statics = new Set(['./']), queue = [];
  const addV = (file, v, from) => {
    const f = file.replace(/^\.\//, '');
    if (v !== N) problems.push(from + ': ' + f + '?v=' + v + ' (the site is ?v=' + N + ')');
    if (!versioned.has(f)) { versioned.add(f); if (f.endsWith('.js')) queue.push(f); }
  };
  // index.html
  const html = read('index.html', root);
  for (const m of html.matchAll(/<(?:link|script)\b[^>]*>/g)) {
    const ref = (/\s(?:href|src)="([^"]+)"/.exec(m[0]) || [])[1];
    if (!ref || /^(data:|[a-z]+:|\/\/|#)/i.test(ref)) continue;
    const [file, q] = ref.split('?');
    if (q) { const v = (/^v=(\d+)$/.exec(q) || [])[1]; if (v) addV(file, v, 'index.html'); else problems.push('index.html: ' + ref); }
    else statics.add(file);
  }
  // the manifest's icons
  if (statics.has('manifest.webmanifest')) {
    const man = JSON.parse(read('manifest.webmanifest', root));
    for (const i of man.icons || []) statics.add(i.src);
  }
  // the module graph, worklets and workers
  // an ES import resolves against the importing file's directory (panels/index.js → panels/minimoog.js); worklet and
  // worker URLs ('x.js?v=' + VERSION) against the page, as the browser does
  const rel = (spec, from) => new URL(spec, 'file:///' + from).pathname.slice(1);
  while (queue.length) {
    const f = queue.shift(), src = read(f, root), V = versionOf(src);
    for (const m of src.matchAll(/\b(?:import|export)\s*(?:[\w*{}\s,$]*?\sfrom\s*)?(['"])(\.{1,2}\/[^'"?]+)\?v=(\d+)\1/g)) addV(rel(m[2], f), m[3], f);
    for (const m of src.matchAll(/\bimport\(\s*(['"])(\.{1,2}\/[^'"?]+)\?v=(\d+)\1\s*\)/g)) addV(rel(m[2], f), m[3], f);
    for (const m of src.matchAll(/(['"])((?:\.\/)?[\w.-]+\.js)\?v=\1\s*\+\s*VERSION\b/g)) {
      if (!V) { problems.push(f + ": '" + m[2] + "?v=' + VERSION without a VERSION constant"); continue; }
      addV(m[2], V, f);
    }
    if (f === 'main.js') {
      if (!/DSP_FILES\.map\(f => f \+ '\?v=' \+ VERSION\)/.test(src)) problems.push('main.js: DSP_FILES are no longer requested as f + \'?v=\' + VERSION');
      for (const d of arrayOf(src, 'DSP_FILES')) addV(d, V, f + ' DSP_FILES');
    }
    if (f === 'smprender.js') { // importScripts(f + location.search): this worker's own ?v= (assets.js creates it as smprender.js?v=N)
      if (!/importScripts\(f \+ sfx\)/.test(src) || !/importScripts\('engine\.js' \+ sfx\)/.test(src)) problems.push('smprender.js: its DSP scripts are no longer loaded with the worker\'s own query');
      for (const d of arrayOf(src, 'DSP').concat('engine.js')) addV(d, N, f);
    }
  }
  // the stylesheets' url(…): the bundled fonts. Unversioned like the icons (content, revalidated at install); a ?v=N query stays versioned.
  for (const f of [...versioned].filter(x => x.endsWith('.css'))) {
    for (const spec of cssUrls(read(f, root))) {
      const [path, q] = spec.split('#')[0].split('?'), file = rel(path, f), v = (/^v=(\d+)$/.exec(q || '') || [])[1];
      if (!existsSync(new URL(file, root))) problems.push(f + ': url(' + spec + ') names ' + file + ', which is not in the site');
      if (v) addV(file, v, f); else statics.add(file);
    }
  }
  for (const f of licenceFiles([...statics], root)) statics.add(f); // the OFL texts beside the fonts (the app bundle = the lists)
  return { version: N, versioned: [...versioned].sort(), statics: ['./', ...[...statics].filter(s => s !== './').sort()], problems };
}

// the build: 12 hex digits of a SHA-256 over every precached file (name and contents; './' is index.html)
export function buildHash(R = appRequests(), root = ROOT) {
  const h = createHash('sha256');
  for (const f of [...R.versioned, ...R.statics].sort()) {
    const bytes = readFileSync(new URL(f === './' ? 'index.html' : f, root));
    h.update(f + '\0' + createHash('sha256').update(bytes).digest('hex') + '\n');
  }
  return h.digest('hex').slice(0, 12);
}

// sw.js's VERSION, BUILD, ASSETS and STATIC (as written)
export function swLists(src) {
  return { version: versionOf(src), build: (/const BUILD = '([0-9a-f]+)'/.exec(src) || [])[1] || null, assets: arrayOf(src, 'ASSETS'), statics: arrayOf(src, 'STATIC') };
}

const wrap = (items, indent) => {
  const lines = [];
  let cur = indent;
  for (const it of items.map(x => "'" + x + "',")) {
    if (cur.length + it.length + 1 > 120 && cur.trim()) { lines.push(cur.replace(/\s+$/, '')); cur = indent; }
    cur += it + ' ';
  }
  if (cur.trim()) lines.push(cur.replace(/\s+$/, ''));
  return lines.join('\n');
};
// sw.js as --write would leave it: { src, R } (nothing written — tests/fonts.test.mjs compares it with the committed file)
export function renderSw(root = ROOT) {
  const R = appRequests(root);
  if (R.problems.length) throw new Error('precache:\n  ' + R.problems.join('\n  '));
  let src = read('sw.js', root);
  R.build = buildHash(R, root);
  if (!/const BUILD = '[0-9a-f]+';/.test(src)) throw new Error('precache: sw.js has no BUILD');
  src = src.replace(/const VERSION = '\d+';/, "const VERSION = '" + R.version + "';");
  src = src.replace(/const BUILD = '[0-9a-f]+';/, "const BUILD = '" + R.build + "';");
  src = src.replace(/const ASSETS = \[[^\]]*\];/, 'const ASSETS = [\n' + wrap(R.versioned, '  ') + '\n];');
  src = src.replace(/const STATIC = \[[^\]]*\];/, 'const STATIC = [\n' + wrap(R.statics, '  ') + '\n];');
  return { src, R };
}
export function writeSw(root = ROOT) {
  const { src, R } = renderSw(root);
  writeFileSync(new URL('sw.js', root), src);
  return R;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) {
    const R = writeSw();
    console.log('sw.js: VERSION ' + R.version + ', BUILD ' + R.build + ', ' + R.versioned.length + ' versioned files, ' + R.statics.length + ' others');
  } else {
    const R = appRequests();
    if (!R.problems.length) R.build = buildHash(R);
    console.log(JSON.stringify(R, null, 2));
  }
}
