// The iPad app's static contract (owner N; IMPL-A §9.1 G5): tools/app-bundle.sh's shell parse of sw.js's lists equals the
// precache crawl; its git behaviour on a throwaway repo (the copy set, a dirty listed file, an untracked script, a stale BUILD,
// SYNTH_ALLOW_DIRTY) — independent of the real tree's state; Info.plist's keys (§1.3); the Swift sources free of network and
// private API (A2, A6); the pbxproj (every .swift referenced, the Run Script phase, no DEVELOPMENT_TEAM, no build settings);
// Config.xcconfig's settings (§1.2); Local.xcconfig gitignored; the icon set and the launch colour. The smoke (tools/app-smoke.sh)
// is the dynamic half. Run: node --test tests/app-native.test.mjs  (macOS: plutil, git, zsh)
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { appRequests } from '../tools/precache.mjs';

const ROOT = new URL('../', import.meta.url);
const P = f => fileURLToPath(new URL(f, ROOT));
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const IOS = 'app/ios/', SRC = IOS + 'SYNTH/';
const SWIFT = readdirSync(new URL(SRC, ROOT)).filter(f => f.endsWith('.swift')).sort();
const bundle = (args, opts = {}) => spawnSync(P('tools/app-bundle.sh'), args, { encoding: 'utf8', ...opts });
const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

/* ------------------------------------------------------------------ the bundle list */
test('app-bundle.sh --list-from: the awk / grep parse of sw.js equals appRequests() (versioned + statics, ./ → index.html)', () => {
  const r = bundle(['--list-from', P('sw.js')]);
  assert.equal(r.status, 0, r.stderr);
  const got = r.stdout.trim().split('\n').sort(), R = appRequests();
  const want = [...R.versioned, ...R.statics].map(f => f === './' ? 'index.html' : f).sort();
  assert.deepEqual(got, want);
  assert.ok(got.length >= 98 && !got.includes('sw.js') && got.includes('index.html') && got.includes('main.js'));
});

// precache.mjs buildHash's formula over a file map (name → bytes), as the script recomputes it with shasum
const hashOf = files => {
  const h = createHash('sha256');
  for (const n of Object.keys(files).sort()) h.update(n + '\0' + createHash('sha256').update(files[n]).digest('hex') + '\n');
  return h.digest('hex').slice(0, 12);
};
const swOf = (assets, statics, build) => `'use strict';\nconst VERSION = '9';\nconst BUILD = '${build}';\nconst ASSETS = [\n  ${assets.map(a => `'${a}'`).join(', ')},\n];\nconst STATIC = [\n  ${statics.map(a => `'${a}'`).join(', ')},\n];\n`;
// a throwaway site repo in `repo` (an existing empty directory): index.html, main.js, a.js, panels/x.js listed in a matching
// sw.js; tests/, tools/ and CLAUDE.md never shipped; one commit
const makeRepo = repo => {
  const F = { 'index.html': '<!doctype html><script type="module" src="main.js?v=9"></script>\n', 'main.js': "const VERSION = '9';\nimport './a.js?v=9';\n", 'a.js': 'export const a = 1;\n', 'panels/x.js': 'export default {};\n' };
  const assets = ['a.js', 'main.js', 'panels/x.js'], statics = ['./'];
  const files = Object.fromEntries([...assets, ...statics].map(n => [n, F[n === './' ? 'index.html' : n]]));
  mkdirSync(join(repo, 'panels')); mkdirSync(join(repo, 'tests')); mkdirSync(join(repo, 'tools'));
  for (const [n, s] of Object.entries(F)) writeFileSync(join(repo, n), s);
  writeFileSync(join(repo, 'sw.js'), swOf(assets, statics, hashOf(files)));
  writeFileSync(join(repo, 'tests/t.test.mjs'), '// never shipped\n');
  writeFileSync(join(repo, 'tools/x.mjs'), '// never shipped\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '# never shipped\n');
  git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'one');
  return { F, assets, statics, files };
};

test('app-bundle.sh --dry-run --root on a throwaway repo: exactly the list + app-build.json; refuses a dirty listed file, an untracked script and a stale BUILD; SYNTH_ALLOW_DIRTY marks dirty', () => {
  const repo = mkdtempSync(join(tmpdir(), 'synth-app-native-'));
  try {
    const { F, assets, statics, files } = makeRepo(repo);
    const out = join(repo, 'out'), run = (env = {}) => bundle(['--dry-run', out, '--root', repo], { env: { ...process.env, ...env } });
    // the copy set
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^site: 4 files, [\d.]+ MB, [0-9a-f]{7,} \(v9, build 1\)$/m);
    const walk = (d, pre = '') => readdirSync(join(d, pre), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d, pre + e.name + '/') : [pre + e.name]).sort();
    assert.deepEqual(walk(out), ['a.js', 'app-build.json', 'index.html', 'main.js', 'panels/x.js']);
    assert.equal(readFileSync(join(out, 'a.js'), 'utf8'), F['a.js']);
    const B = JSON.parse(readFileSync(join(out, 'app-build.json'), 'utf8'));
    assert.deepEqual(Object.keys(B).sort(), ['build', 'date', 'dirty', 'sha', 'short', 'version']);
    assert.equal(B.sha, git(repo, 'rev-parse', 'HEAD')); assert.equal(B.short, git(repo, 'rev-parse', '--short', 'HEAD'));
    assert.deepEqual([B.version, B.build, B.dirty], ['9', 1, false]);
    assert.match(B.date, /^\d{4}-\d\d-\d\dT/);
    // a dirty listed file
    appendFileSync(join(repo, 'a.js'), '// edit\n');
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /uncommitted site changes/);
    // SYNTH_ALLOW_DIRTY: a local try, marked dirty, still HEAD's bytes
    r = run({ SYNTH_ALLOW_DIRTY: '1' }); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DIRTY/);
    assert.equal(JSON.parse(readFileSync(join(out, 'app-build.json'), 'utf8')).dirty, true);
    assert.equal(readFileSync(join(out, 'a.js'), 'utf8'), F['a.js']);
    git(repo, 'checkout', '--', 'a.js');
    // an untracked script at the root (and one under panels/) — tests/ and tools/ files never count
    writeFileSync(join(repo, 'x.js'), '');
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /untracked site files.*x\.js/);
    rmSync(join(repo, 'x.js'));
    writeFileSync(join(repo, 'panels/y.js'), '');
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /untracked site files.*panels\/y\.js/);
    rmSync(join(repo, 'panels/y.js'));
    writeFileSync(join(repo, 'tools/y.js'), ''); writeFileSync(join(repo, 'tests/y.js'), '');
    r = run(); assert.equal(r.status, 0, r.stderr);
    rmSync(join(repo, 'tools/y.js')); rmSync(join(repo, 'tests/y.js'));
    // a stale BUILD: a listed file changed and committed without the lists' hash
    writeFileSync(join(repo, 'a.js'), 'export const a = 2;\n'); git(repo, 'commit', '-q', '-am', 'two');
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /sw\.js is stale/);
    files['a.js'] = 'export const a = 2;\n';
    writeFileSync(join(repo, 'sw.js'), swOf(assets, statics, hashOf(files))); git(repo, 'commit', '-q', '-am', 'three');
    r = run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /build 3\)/);
    // a listed file that is not committed
    writeFileSync(join(repo, 'sw.js'), swOf([...assets, 'ghost.js'], statics, 'abcdefabcdef')); git(repo, 'commit', '-q', '-am', 'four');
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /ghost\.js is listed in sw\.js but not committed/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// (fix R2-F3) the dry run empties <dir> before the copy: it must never wipe a folder that is not a bundle of its own
test('app-bundle.sh --dry-run refuses a folder it would wipe — not empty and no app-build.json, a file, the repo itself, a folder holding the repo — and leaves it as it was; an empty, a new or a previous bundle\'s folder is fine', () => {
  const wrap = mkdtempSync(join(tmpdir(), 'synth-app-native-'));
  try {
    const repo = join(wrap, 'repo'); mkdirSync(repo); makeRepo(repo);
    const run = d => bundle(['--dry-run', d, '--root', repo]);
    const refused = (d, why) => { const r = run(d); assert.notEqual(r.status, 0, why + ' accepted: ' + r.stdout); assert.match(r.stderr, /refusing to empty/, why); };
    const mine = join(wrap, 'mine'), sentinel = join(mine, 'sentinel.txt');
    mkdirSync(mine); writeFileSync(sentinel, 'keep me\n');
    refused(mine, 'a folder holding a file of its own');
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep me\n');
    refused(sentinel, 'a file');
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep me\n');
    // the repo and a folder holding it are refused even when an app-build.json lies in them
    writeFileSync(join(repo, 'app-build.json'), '{}\n'); writeFileSync(join(wrap, 'app-build.json'), '{}\n');
    refused(repo, 'the repo'); refused(repo + '/panels/../', 'the repo, spelt another way'); refused(wrap, 'a folder holding the repo');
    assert.ok(existsSync(join(repo, 'sw.js')) && existsSync(join(repo, '.git')) && existsSync(sentinel), 'nothing removed');
    // fine: an empty folder, the same folder again (a previous bundle: its app-build.json), a new path
    const empty = join(wrap, 'empty'); mkdirSync(empty);
    for (const d of [empty, empty, join(wrap, 'new', 'deep')]) { const r = run(d); assert.equal(r.status, 0, r.stderr); assert.ok(existsSync(join(d, 'app-build.json'))); }
  } finally { rmSync(wrap, { recursive: true, force: true }); }
});

/* ------------------------------------------------------------------ Info.plist (§1.3) */
test('Info.plist: the §1.3 keys, Q2\'s background mode, the document types, the camera and microphone texts; no ATS, no UIRequiresFullScreen', () => {
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', P(SRC + 'Info.plist')], { encoding: 'utf8' }));
  assert.equal(plist.CFBundleDisplayName, 'SYNTH');
  assert.equal(plist.CFBundleShortVersionString, '$(MARKETING_VERSION)');
  assert.equal(plist.CFBundleVersion, '$(CURRENT_PROJECT_VERSION)');
  assert.equal(plist.CFBundleIdentifier, '$(PRODUCT_BUNDLE_IDENTIFIER)');
  assert.equal(plist.LSRequiresIPhoneOS, true);
  assert.equal(plist.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(plist.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).SceneDelegate');
  assert.deepEqual(plist.UILaunchScreen, { UIColorName: 'LaunchBackground' });
  assert.equal(plist.UIStatusBarHidden, true);
  assert.equal(plist.UIViewControllerBasedStatusBarAppearance, true);
  assert.deepEqual(plist['UISupportedInterfaceOrientations~ipad'].slice().sort(), ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight', 'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']);
  assert.deepEqual(plist.UIBackgroundModes, ['audio']);
  assert.equal(plist.UIFileSharingEnabled, true);
  assert.equal(plist.LSSupportsOpeningDocumentsInPlace, true);
  const types = plist.CFBundleDocumentTypes.map(t => [t.LSItemContentTypes.join(), t.LSHandlerRank]).sort();
  assert.deepEqual(types, [['public.json', 'Alternate'], ['public.midi-audio', 'Alternate']]);
  assert.match(plist.NSCameraUsageDescription, /wavetable/);
  // (fix R1-F2) an audio/* accept makes WebKit's upload menu offer Take Video, which records sound: without this key the system
  // kills the app on that tap (a device-only kill, as the camera's)
  assert.match(plist.NSMicrophoneUsageDescription, /^SYNTH does not record audio\b.*Take Video/);
  for (const k of ['NSAppTransportSecurity', 'UIRequiresFullScreen', 'NSPhotoLibraryUsageDescription', 'NSBluetoothAlwaysUsageDescription', 'WKAppBoundDomains']) assert.equal(k in plist, false, k);
});

/* ------------------------------------------------------------------ the Swift (A2, A6, the frozen interfaces) */
// code only: block comments and // comments gone (a // after a ':' is a URL inside a string and stays — it must be caught)
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('the Swift sources: no URLSession / Network / http(s) literal / KVC on WebKit (A2, A6); UIKit only outside the three shared files (§8)', () => {
  assert.deepEqual(SWIFT, ['App.swift', 'AudioSession.swift', 'Bridge.swift', 'FileExport.swift', 'SchemeHandler.swift', 'ShellViewController.swift', 'SiteBundle.swift', 'Smoke.swift', 'SmokeSteps.swift']);
  const bad = [];
  for (const f of SWIFT) {
    const c = code(read(SRC + f));
    for (const re of [/URLSession/, /NWListener/, /NWConnection/, /import Network\b/, /https?:\/\//, /wss?:\/\//, /setValue\(.*forKey/, /value\(forKey/, /performSelector/, /_WK|WKWebView\.\w*_|allowFileAccessFromFileURLs/, /loadFileURL/, /limitsNavigationsToAppBoundDomains/]) {
      if (re.test(c)) bad.push(f + ': ' + re);
    }
  }
  assert.deepEqual(bad, []);
  for (const f of ['SchemeHandler.swift', 'SiteBundle.swift', 'Bridge.swift']) assert.doesNotMatch(read(SRC + f), /^import UIKit/m, f + ' is shared with the Mac shell: no UIKit');
});

test('the shell: the marker, the offline guard, the navigation policy, the bridge messages, the dialogs, the restart — as §10 froze them', () => {
  const vc = read(SRC + 'ShellViewController.swift'), br = read(SRC + 'Bridge.swift'), sh = read(SRC + 'SchemeHandler.swift'), sb = read(SRC + 'SiteBundle.swift');
  // §3.1 the marker (document start, main frame only), one-shot restarted
  assert.match(vc, /window\.SYNTH_SHELL = Object\.assign\(/);
  for (const k of ['"os": "ipados"', '"idiom": "pad"', '"app":', '"build":', '"sha":', '"site":', '"restarted": restarted']) assert.ok(vc.includes(k), k);
  assert.match(vc, /post: m => webkit\.messageHandlers\.synth\.postMessage\(m\)/);
  assert.match(vc, /injectionTime: \.atDocumentStart, forMainFrameOnly: true/);
  assert.match(vc, /if restarted \{ restarted = false; installUserScripts\(/);
  // §2.4 the guard: both rules, no page without the list; the policy's order: download → allow → cancel
  assert.match(vc, /"url-filter":"\^https\?:\/\/"/); assert.match(vc, /"url-filter":"\^wss\?:\/\/"/);
  assert.match(vc, /compileContentRuleList\(forIdentifier: "synth-offline-1"/);
  assert.ok(vc.indexOf('shouldPerformDownload') < vc.indexOf('decisionHandler(.allow)') && vc.indexOf('decisionHandler(.allow)') < vc.indexOf('decisionHandler(.cancel)'));
  assert.match(vc, /canShowMIMEType \? \.allow : \.download/);
  // §2.3
  for (const s of ['forURLScheme: "synth"', 'websiteDataStore = .default()', 'allowsInlineMediaPlayback = true', 'mediaTypesRequiringUserActionForPlayback = []', 'isFraudulentWebsiteWarningEnabled = false',
    'contentInsetAdjustmentBehavior = .never', 'bounces = false', 'allowsLinkPreview = false', 'allowsBackForwardNavigationGestures = false', 'underPageBackgroundColor', 'addScriptMessageHandler(bridge, contentWorld: .page, name: "synth")']) assert.ok(vc.includes(s), s);
  assert.match(vc, /#if DEBUG\s+if #available\(iOS 16\.4, \*\) \{ wv\.isInspectable = true \}/);
  // §6: full screen, every orientation; the JS dialogs; no new windows
  for (const s of ['prefersStatusBarHidden: Bool { true }', 'prefersHomeIndicatorAutoHidden: Bool { true }', 'supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }',
    'runJavaScriptAlertPanelWithMessage', 'runJavaScriptConfirmPanelWithMessage', 'runJavaScriptTextInputPanelWithPrompt', 'createWebViewWith', 'override var safeAreaInsets: UIEdgeInsets { .zero }']) assert.ok(vc.includes(s), s);
  // (fix R1-F1) no edge deferral: with .all, a Home / app-switcher round trip left WebKit's visualViewport.scale at 1.333 (width
  // unchanged) — the page's "page zoomed" state for good, the canvas's pinch lost to the page zoom; the deferral bought nothing
  // (the first edge swipe acted anyway). The home indicator stays auto-hidden (above).
  assert.ok(vc.includes('preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [] }'), 'the edges not deferred');
  assert.doesNotMatch(code(vc), /preferredScreenEdgesDeferringSystemGestures[^\n]*\.all/);
  // (fix R1-F4) a JS dialog suspends WebKit's AudioContext: its close (the answer, once) resumes the page as an interruption's end
  // does (SYNTH_SHELL.on({ t: 'resume' }) → wake(); the page keeps its Sound-in-background rule)
  assert.match(code(vc), /let done: \(Bool\) -> Void = \{ ok in settle \{[^}\n]*answer\(ok, [^;\n]*\); self\?\.resumePage\(\) \} \}/);
  // (fix R2-F5) Open from Files reads a file URL only (a URL type added later must not become a synchronous native fetch, A2)
  const od = code(vc).slice(code(vc).indexOf('func openDocument('));
  assert.ok(/guard url\.isFileURL else/.test(od) && od.indexOf('isFileURL') < od.indexOf('Data(contentsOf: url)'), 'openDocument: isFileURL before the read');
  // §4.3 arguments, never a built string; queued until ready
  assert.match(vc, /call\("return SYNTH_SHELL\.openFile[^"]*", \["name": name, "b64": b64\]\)/);
  assert.doesNotMatch(vc, /evaluateJavaScript\(/);
  assert.match(vc, /func whenReady\(/);
  // §5.4
  assert.match(vc, /webViewWebContentProcessDidTerminate/); assert.match(vc, /keeps running out of memory/);
  // the bridge: the frozen messages, the reply shapes, the sanitised name
  for (const t of ['"file"', '"chunk"', '"end"', '"abort"', '"engine"', '"ready"', '"bg"']) assert.ok(br.includes('case ' + t), 'bridge handles ' + t);
  assert.match(br, /r\["ok"\] = true/); assert.match(br, /\["ok": false, "error": e\]/); assert.match(br, /ok\(\["done": done\]\)/);
  assert.match(read(SRC + 'FileExport.swift'), /lastPathComponent/);
  // §2.1 the scheme: a map lookup, no-store, exact types, 404 text
  assert.match(sb, /files\[p\] != nil \? p : nil/); assert.match(sb, /case "js", "mjs": return "text\/javascript; charset=utf-8"/); assert.match(sb, /case "woff2": return "font\/woff2"/);
  assert.match(sh, /"Cache-Control": "no-store"/); assert.match(sh, /statusCode: 404/); assert.match(sh, /func webView\(_ webView: WKWebView, stop task: WKURLSchemeTask\) \{ live\.remove/);
  // the Smoke hooks only under -smoke; the page script only in Debug builds
  assert.match(vc, /if Smoke\.on, let u = Bundle\.main\.url\(forResource: "Smoke", withExtension: "js"\)/);
  const sm = read(SRC + 'Smoke.swift'), steps = read(SRC + 'SmokeSteps.swift');
  assert.match(sm, /#if SMOKE[\s\S]*static let run: String\? = UserDefaults\.standard\.string\(forKey: "smoke"\)[\s\S]*#else[\s\S]*static let run: String\? = nil/);
  assert.match(steps, /^#if SMOKE/m);
  // (fix R1-F5) -smokeMode log: the log (requests, console, scene, dialogs, sheets) for a by-hand review, nothing driven — the steps,
  // the sheets' auto-dismiss and the dialogs' auto-answer act only while the smoke drives (Smoke.drives), never on Smoke.on alone
  assert.match(sm, /#if SMOKE[\s\S]*static let mode: String = UserDefaults\.standard\.string\(forKey: "smokeMode"\) \?\? ""[\s\S]*#else[\s\S]*static let mode = ""/);
  assert.match(sm, /static var drives: Bool \{ on && mode != "log" \}/);
  assert.match(code(vc), /if Smoke\.drives \{ DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 1\) \{ ac\.dismiss/);
  assert.match(code(vc), /autoDismiss: Smoke\.drives \? 2 : nil/);
  assert.match(code(steps), /guard Smoke\.drives, let run = Smoke\.run else \{ return \}/);
  assert.doesNotMatch(code(vc) + code(steps), /if Smoke\.on \{ DispatchQueue|autoDismiss: Smoke\.on|guard Smoke\.on, let run/);
  assert.ok(existsSync(new URL(SRC + 'Smoke.js', ROOT)));
});

/* ------------------------------------------------------------------ the project, the xcconfig, the ignore rules, the assets */
test('project.pbxproj: every .swift referenced and compiled, Smoke.js a resource, the Run Script phase calls tools/app-bundle.sh, no build settings, no DEVELOPMENT_TEAM', () => {
  const pb = read(IOS + 'SYNTH.xcodeproj/project.pbxproj');
  for (const f of SWIFT) {
    assert.match(pb, new RegExp(`isa = PBXFileReference; lastKnownFileType = sourcecode\\.swift; path = ${f.replace('.', '\\.')};`), f + ' referenced');
    assert.match(pb, new RegExp(`/\\* ${f.replace('.', '\\.')} in Sources \\*/,`), f + ' compiled');
  }
  assert.match(pb, /path = Smoke\.js;/); assert.match(pb, /Smoke\.js in Resources \*\/,/); assert.match(pb, /Assets\.xcassets in Resources \*\/,/);
  assert.match(pb, /shellScript = "\\"\$SRCROOT\/\.\.\/\.\.\/tools\/app-bundle\.sh\\"\\n";/);
  assert.match(pb, /shellPath = \/bin\/zsh;/); assert.match(pb, /alwaysOutOfDate = 1;/); assert.match(pb, /"\$\(TARGET_BUILD_DIR\)\/\$\(INFOPLIST_PATH\)",/);
  assert.match(pb, /buildPhases = \(\s*A\w+ \/\* Sources \*\/,\s*A\w+ \/\* Frameworks \*\/,\s*A\w+ \/\* Resources \*\/,\s*A\w+ \/\* Bundle the site \*\/,\s*\);/);
  assert.doesNotMatch(pb, /DEVELOPMENT_TEAM/);
  assert.equal((pb.match(/baseConfigurationReference = A00000000000000000000007 \/\* Config\.xcconfig \*\/;/g) || []).length, 4);
  assert.equal((pb.match(/buildSettings = \{\s*\};/g) || []).length, 4, 'no build settings in the pbxproj');
  assert.match(pb, /productType = "com\.apple\.product-type\.application";/);
  assert.ok(existsSync(new URL(IOS + 'SYNTH.xcodeproj/xcshareddata/xcschemes/SYNTH.xcscheme', ROOT)), 'the shared scheme');
  assert.match(read(IOS + 'SYNTH.xcodeproj/xcshareddata/xcschemes/SYNTH.xcscheme'), /BlueprintIdentifier = "A00000000000000000000002"/);
});

test('Config.xcconfig: the §1.2 settings, the optional Local.xcconfig include LAST (a later assignment wins: the team and a free team\'s bundle id override), the team absent', () => {
  const x = read(IOS + 'Config.xcconfig'), lines = x.split('\n').filter(l => !/^\s*\/\//.test(l));
  const has = s => assert.ok(lines.some(l => l.trim() === s), s);
  // (fix R2-F1) the include is the last line that is not blank or a comment; nothing is assigned after it
  const live = lines.filter(l => l.trim() !== '');
  assert.equal(live[live.length - 1], '#include? "Local.xcconfig"');
  assert.equal(live.filter(l => /#include/.test(l)).length, 1, 'one include');
  for (const s of ['PRODUCT_NAME = SYNTH', 'PRODUCT_BUNDLE_IDENTIFIER = com.domlavin.synth', 'MARKETING_VERSION = 0.1', 'CURRENT_PROJECT_VERSION = 1', 'IPHONEOS_DEPLOYMENT_TARGET = 17.5',
    'TARGETED_DEVICE_FAMILY = 2', 'SUPPORTED_PLATFORMS = iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST = NO', 'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES', 'SWIFT_VERSION = 5.0',
    'SWIFT_STRICT_CONCURRENCY = minimal', 'CODE_SIGN_STYLE = Automatic', 'CODE_SIGN_IDENTITY = Apple Development', 'ENABLE_USER_SCRIPT_SANDBOXING = NO', 'GENERATE_INFOPLIST_FILE = NO',
    'INFOPLIST_FILE = SYNTH/Info.plist', 'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon', 'DEBUG_INFORMATION_FORMAT = dwarf', 'DEBUG_INFORMATION_FORMAT[config=Release] = dwarf-with-dsym',
    'OTHER_SWIFT_FLAGS[config=Debug] = -DSMOKE', 'EXCLUDED_SOURCE_FILE_NAMES[config=Release] = Smoke.js', 'SDKROOT = iphoneos']) has(s);
  assert.ok(!lines.some(l => /^\s*DEVELOPMENT_TEAM/.test(l)), 'no team in Config.xcconfig');
  assert.ok(!lines.some(l => /NSAllowsArbitraryLoads|WKAppBoundDomains/.test(l)));
});

test('.gitignore: Local.xcconfig, xcuserdata and build output ignored; the icon PNG and the sources not', () => {
  const ignored = p => spawnSync('git', ['-C', P('.'), 'check-ignore', '-q', p]).status === 0;
  for (const p of ['app/ios/Local.xcconfig', 'app/ios/SYNTH.xcodeproj/xcuserdata/dom.xcuserdatad/x', 'app/ios/SYNTH.xcodeproj/project.xcworkspace/xcuserdata/x', 'app/ios/build/x', 'app/ios/DerivedData/x']) assert.ok(ignored(p), p + ' ignored');
  for (const p of ['app/ios/SYNTH/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 'app/ios/SYNTH/App.swift', 'app/ios/Config.xcconfig', 'app/ios/SYNTH.xcodeproj/project.pbxproj', 'app/ios/SYNTH.xcodeproj/xcshareddata/xcschemes/SYNTH.xcscheme']) assert.ok(!ignored(p), p + ' not ignored');
});

test('the asset catalog: AppIcon names icon-1024.png (one universal 1024 entry); LaunchBackground is style.css --bg', () => {
  const icon = JSON.parse(read(SRC + 'Assets.xcassets/AppIcon.appiconset/Contents.json'));
  assert.deepEqual(icon.images, [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }]);
  const c = JSON.parse(read(SRC + 'Assets.xcassets/LaunchBackground.colorset/Contents.json')).colors[0].color;
  assert.equal(c['color-space'], 'srgb');
  const hex = [c.components.red, c.components.green, c.components.blue].map(v => parseInt(v, 16).toString(16).padStart(2, '0')).join('');
  assert.equal('#' + hex, (/--bg:\s*(#[0-9a-f]{6})/i.exec(read('style.css')) || [])[1].toLowerCase());
  assert.equal(c.components.alpha, '1.000');
});
