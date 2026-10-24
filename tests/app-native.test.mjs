// The iPad app's static contract (owner N; IMPL-A §9.1 G5): tools/app-bundle.sh's shell parse of sw.js's lists equals the
// precache crawl; its git behaviour on a throwaway repo (the copy set, a dirty listed file, an untracked script, a stale BUILD,
// SYNTH_ALLOW_DIRTY) — independent of the real tree's state; Info.plist's keys (§1.3); the Swift sources free of network and
// private API (A2, A6); the pbxproj (every .swift referenced, the Run Script phase, no DEVELOPMENT_TEAM, no build settings);
// Config.xcconfig's settings (§1.2); Local.xcconfig gitignored; the icon set and the launch colour. The smoke (tools/app-smoke.sh)
// is the dynamic half. Run: node --test tests/app-native.test.mjs  (macOS: plutil, git, zsh)
// Stage B (IMPL-B §7 B5, lane M): CoreMIDI behind the page's Web MIDI shim — the client / ports / destination, the frozen bridge
// messages, the gate, the release triple, the caps, the shim as a Resource after the marker, the Bluetooth sheet's settle, the smoke
// under SMOKE. Two of stage A's assertions are AMENDED by that contract (named so no reviewer reads them as a weakened test):
// Info.plist now REQUIRES NSBluetoothAlwaysUsageDescription (§4.1), and the exact Swift list gains Midi.swift, MidiBluetooth.swift,
// SmokeMidi.swift (the A2 / A6 greps cover them too). Recorded in IMPL-A §12 (the lead's decision #11).
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
  // (IMPL-B §4.1 — an amendment of stage A's absent-keys list) the Bluetooth MIDI pairing sheet starts CoreBluetooth: without the key
  // the system kills the app when it opens; the text names what it is for
  assert.match(plist.NSBluetoothAlwaysUsageDescription, /^SYNTH connects to Bluetooth MIDI keyboards and pads you pair here\.$/);
  for (const k of ['NSAppTransportSecurity', 'UIRequiresFullScreen', 'NSPhotoLibraryUsageDescription', 'WKAppBoundDomains']) assert.equal(k in plist, false, k);
});

/* ------------------------------------------------------------------ the Swift (A2, A6, the frozen interfaces) */
// code only: block comments and // comments gone (a // after a ':' is a URL inside a string and stays — it must be caught)
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('the Swift sources: no URLSession / Network / http(s) literal / KVC on WebKit (A2, A6); UIKit only outside the three shared files (§8)', () => {
  // (IMPL-B §10 — an amendment of stage A's exact list) + Midi.swift, MidiBluetooth.swift, SmokeMidi.swift
  assert.deepEqual(SWIFT, ['App.swift', 'AudioSession.swift', 'Bridge.swift', 'FileExport.swift', 'Midi.swift', 'MidiBluetooth.swift', 'SchemeHandler.swift', 'ShellViewController.swift', 'SiteBundle.swift', 'Smoke.swift', 'SmokeMidi.swift', 'SmokeSteps.swift']);
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

/* ------------------------------------------------------------------ stage B (IMPL-B §7 B5): CoreMIDI behind the shim */
test('IMPL-B B5: Midi.swift (CoreMIDI, Foundation, os only) — one client never disposed, a 1.0 input port, the "SYNTH" destination; no network MIDI / CoreBluetooth / own BLE driver; the four bridge messages; midiIn / midiPorts through call() with arguments; the gate on the four names (not foreground), decided at arrival; onScreen from sceneBackground; pageReset on termination and didCommit; the release triple; the caps and the interval named; no isMainThread; the shim a Resource after the marker, in Release; the sheet settles on presentationControllerDidDismiss; the smoke under SMOKE', () => {
  const midi = read(SRC + 'Midi.swift'), bt = read(SRC + 'MidiBluetooth.swift'), vc = read(SRC + 'ShellViewController.swift'), br = read(SRC + 'Bridge.swift'), sm = read(SRC + 'SmokeMidi.swift');
  const all = SWIFT.map(f => code(read(SRC + f))).join('\n'), cm = code(midi), cv = code(vc);
  // §2.1 / §2.4
  assert.match(cm, /MIDIClientCreateWithBlock\("SYNTH" as CFString, &c\)/);
  assert.match(cm, /MIDIInputPortCreateWithProtocol\(client, "SYNTH in" as CFString, \._1_0, &inPort\)/);
  assert.match(cm, /MIDIOutputPortCreate\(client, "SYNTH out" as CFString, &outPort\)/);
  assert.match(cm, /MIDIDestinationCreateWithProtocol\(client, "SYNTH" as CFString, \._1_0, &appDest\)/);
  assert.match(cm, /MIDISendEventList\(outPort, dest\.ref/);
  assert.match(cm, /kMIDIPropertyUniqueID, saved\)/, 'the destination\'s uid persisted (kMIDIIDNotUnique → the assigned one kept)');
  assert.match(cm, /static let otherApps = "From other apps"/);
  assert.match(cm, /kMIDIPropertyDisplayName/); assert.match(cm, /kMIDIPropertyOffline/); assert.match(cm, /kMIDIPropertyPrivate/);
  assert.doesNotMatch(all, /MIDIClientDispose/, 'never disposed (MIDIServices.h:1462–1479)');
  // B3 / A6
  for (const re of [/MIDINetworkSession/, /import CoreBluetooth/, /MIDIBluetoothDriver/, /evaluateJavaScript\(/, /kMIDIPropertyAdvanceScheduleTimeMuSec/]) assert.doesNotMatch(all, re, String(re));
  assert.deepEqual(midi.match(/^import \w+$/gm).sort(), ['import CoreMIDI', 'import Foundation', 'import os']);
  assert.doesNotMatch(midi, /^import UIKit/m);
  assert.match(cm, /OSAllocatedUnfairLock/);
  assert.doesNotMatch(all, /isMainThread/, 'no main-thread assertion (the user\'s device build is Debug)');
  // §3.1 the frozen messages and their replies
  for (const t of ['"midi"', '"midi-send"', '"midi-bt"', '"midi-clock"']) assert.ok(br.includes('case ' + t), 'bridge handles ' + t);
  assert.match(br, /ok\(\["host": host\?\.bridgeMidiClock\(\) \?\? 0\]\)/);
  assert.match(code(br), /case "smoke-midi" where Smoke\.on:/, 'the by-hand helper message exists only while the smoke is on');
  assert.match(cv, /func bridgeSmokeMidi\(_ bytes: \[UInt8\]\) \{\s*#if SMOKE\s*if Smoke\.on,/);
  assert.match(br, /func bridgeMidiSend\(id: String, bytes: \[UInt8\], delay: Double\) -> String\?/);
  // native → web: the two entry points through call() with arguments, one ordered queue, one in flight
  assert.match(cm, /"if \(window\.SYNTH_SHELL && SYNTH_SHELL\.midiIn\) SYNTH_SHELL\.midiIn\(b\)"; args = \["b": b\]/);
  assert.match(cm, /"if \(window\.SYNTH_SHELL && SYNTH_SHELL\.midiPorts\) SYNTH_SHELL\.midiPorts\(list, gen\)"; args = \["list": list, "gen": g\]/);
  assert.match(cm, /guard !inFlight, !queue\.isEmpty, let host else \{ return \}/);
  assert.match(cm, /guard let self, gen == self\.pageGen else \{ return \}/, 'a late completion from the old page ignored');
  assert.match(cv, /func midiCall\(_ body: String, _ args: \[String: Any\], _ done: @escaping \(Bool, String\?\) -> Void\) \{\s*call\(body, args\)/);
  // §3.4 the gate: the four names in one condition, never `foreground`; decided at arrival. (fix R1-F1 — an amendment of the frozen
  // expression) a fifth input, `backgroundExpired`: the shell's background task expired behind another app with Sound in background
  // on → shut until the foreground (iPadOS suspends the process right after; the triple must reach the page before — the sender's proof)
  const gateLine = cm.split('\n').find(l => /let open = /.test(l));
  assert.match(gateLine, /let open = ready && midiOpen && \(onScreen \|\| \(backgroundAudio && !backgroundExpired\)\)/); assert.doesNotMatch(gateLine, /foreground/);
  assert.match(cm, /var backgroundExpired = false \{ didSet \{ updateGate\(\) \} \}/);
  // (fix R2-F4) drop at arrival only what was stamped while the gate was shut — [closedAt, openedAt) —, never an older or absurd stamp
  // (another app's stale stamp is delivered with age 2 000, §1.3)
  assert.match(cm, /guard s\.gateOpen, !\(s\.closedAt != 0 && m\.at >= s\.closedAt && m\.at < s\.openedAt\) else \{ s\.dropped \+= 1; return \}/);
  assert.match(cm, /var closedAt: UInt64 = 0/); assert.match(cm, /s\.closedAt = now/);
  const sb = cv.slice(cv.indexOf('func sceneBackground('), cv.indexOf('func sceneBackground(') + 1800);
  assert.match(sb, /midi\.onScreen = !background/, 'onScreen assigned in sceneBackground');
  // (fix R1-F1) the background task: taken at sceneDidEnterBackground when midiOpen && backgroundAudio; its expiration handler runs the
  // gate's release path (midiBackgroundExpired → midi.backgroundExpired = true) and ends the task; ended at the foreground and whenever
  // the gate shuts (gateChanged); the foreground clears the flag. No silent-audio keep-alive anywhere (the lead's decision (b))
  assert.match(sb, /if midi\.midiOpen && backgroundAudio && midiTask == \.invalid \{\s*midiTask = UIApplication\.shared\.beginBackgroundTask\(withName: "synth\.midi"\) \{ \[weak self\] in self\?\.midiBackgroundExpired\(\) \}/);
  assert.match(sb, /else \{\s*midi\.backgroundExpired = false\s*endMidiTask\(\)/);
  assert.match(cv, /func midiBackgroundExpired\(\) \{[\s\S]*?midi\.backgroundExpired = true[\s\S]*?endMidiTask\(\)\s*\n\s*\}/);
  assert.match(cv, /private func endMidiTask\(\) \{ if midiTask != \.invalid \{ UIApplication\.shared\.endBackgroundTask\(midiTask\); midiTask = \.invalid \} \}/);
  assert.match(cv, /midi\.gateChanged = \{ \[weak self\] open in if !open \{ self\?\.endMidiTask\(\) \} \}/);
  assert.match(cm, /var gateChanged: \(\(Bool\) -> Void\)\?/); assert.match(cm, /gateChanged\?\(open\)/);
  assert.doesNotMatch(all, /AVAudioPlayer|AVAudioEngine|AVAudioSourceNode|keepAlive|keep_alive/, 'no host-side silent-audio keep-alive');
  assert.match(cm, /func pageReset\(\) \{[\s\S]*?midiOpen = false\s*\n\s*\}/);
  // (fix R2-N2) termination: pageReset FIRST (the masks and the queue cleared, nothing built for the dead page), then ready = false
  assert.match(cv.slice(cv.indexOf('func webViewWebContentProcessDidTerminate('), cv.indexOf('private func restart(')), /midi\.pageReset\(\); midi\.ready = false/, 'termination resets midi, pageReset first');
  assert.match(cv.slice(cv.indexOf('didCommit n: WKNavigation!'), cv.indexOf('func webView(_ w: WKWebView, didFinish')), /midi\.pageReset\(\)/, 'didCommit resets midi');
  assert.match(cv, /func bridgeReady\(\) \{\s*ready = true\s*midi\.ready = true/); assert.match(cv, /midi\.backgroundAudio = on/);
  // the release triple (CC 64 = 0, bend centre, CC 123) — (fix R1-F2) in THREE PASSES over every selected port, so the order holds across
  // ports and channels (the page's held / sustain are per channel: another port's CC 123 must never precede this port's CC 64 = 0) —,
  // the caps and the interval as named constants, the thinner's exemptions
  assert.match(cm, /d1: 64, d2: 0\)/); assert.match(cm, /d1: 0, d2: 0x40\)/); assert.match(cm, /d1: 123, d2: 0\)/);
  assert.ok(cm.indexOf('d1: 64, d2: 0)') < cm.indexOf('d1: 0, d2: 0x40)') && cm.indexOf('d1: 0, d2: 0x40)') < cm.indexOf('d1: 123, d2: 0)'), 'sustain up, bend centre, then All Notes Off');
  const rel = cm.slice(cm.indexOf('private func releases('), cm.indexOf('// MARK: receive'));
  assert.equal((rel.match(/for \(uid, m\) in sel \{/g) || []).length, 3, 'three passes over the selected ports');
  assert.ok(rel.indexOf('d1: 64, d2: 0)') < rel.indexOf('for (uid, m) in sel {', rel.indexOf('for (uid, m) in sel {') + 1) && rel.lastIndexOf('for (uid, m) in sel {') < rel.indexOf('d1: 123, d2: 0)'), 'the sustain pass first, the All Notes Off pass last');
  assert.match(rel, /for \(uid, _\) in sel \{ s\.masks\.removeValue\(forKey: uid\) \}/);
  // (fix R1-F9) the notes on since the last release are a 128-bit set per channel: a note-off (or a velocity-0 note-on) clears its note,
  // CC 120 / 123 the channel; a channel sounds while any note is set — so a port that played and released sends no stale CC 123
  assert.match(cm, /var held = \[UInt64\]\(repeating: 0, count: 32\)/);
  assert.match(cm, /case 0x90 where d2 > 0: s\.masks\[uid, default: Masks\(\)\]\.note\(ch, d1, on: true\)/);
  assert.match(cm, /case 0x80, 0x90: s\.masks\[uid\]\?\.note\(ch, d1, on: false\)/, 'a velocity-0 note-on is a note-off for the masks');
  assert.match(cm, /else if d1 == 120 \|\| d1 == 123 \{ s\.masks\[uid\]\?\.allOff\(ch\) \}/);
  // (fix R2-F2) a never-thinned overflow: every (port, channel) in the dropped buffer owes the whole triple — a pedal-up / bend centre /
  // note-off inside it already cleared its bit — marked BEFORE the buffer is emptied
  const ov = cm.slice(cm.indexOf('if s.pending.count > Self.neverThinnedCap {'), cm.indexOf('s.nextThin = max('));
  assert.match(ov, /for m in s\.pending where m\.st < 0xF0 \{ s\.masks\[m\.uid, default: Masks\(\)\]\.dirty\(Int\(m\.st & 0x0f\)\) \}/);
  assert.ok(ov.indexOf('.dirty(') < ov.indexOf('s.pending.removeAll()') && ov.indexOf('s.pending.removeAll()') < ov.indexOf('releases(&s, ports: nil, at: now)'), 'dirty → empty → release');
  assert.match(cm, /mutating func dirty\(_ ch: Int\) \{ let b = UInt16\(1 << ch\); sus \|= b; bend \|= b; held\[2 \* ch\] \|= 1 \}/);
  // (fix R2-F3) connections keyed uid → endpoint ref: a source re-created under the same uniqueID is a new ref → disconnect the dead
  // one, release its channels, connect the new one (the page's list unchanged)
  assert.match(cm, /private var connected: \[Int32: MIDIEndpointRef\] = \[:\]/);
  assert.match(cm, /for p in src \{ if let old = connected\[p\.uid\], old != p\.ref \{ dead\.insert\(p\.uid\) \} \}/); assert.match(cm, /let stale = dead/);
  assert.match(cm, /for \(uid, ref\) in connected where stale\.contains\(uid\) \{ _ = MIDIPortDisconnectSource\(inPort, ref\); connected\.removeValue\(forKey: uid\) \}/);
  assert.match(cm, /for p in src where connected\[p\.uid\] == nil \{ if MIDIPortConnectSource\(inPort, p\.ref, UnsafeMutableRawPointer\(bitPattern: Int\(p\.uid\)\)\) == noErr \{ connected\[p\.uid\] = p\.ref \} \}/);
  assert.doesNotMatch(cm, /connected = ids/);
  // (fix R2-N1 / N5) the client is made on a utility queue — at launch (prepare, from the shell after the page starts loading) and for
  // the page's { t: 'midi' } (open replies when it exists: the bridge's reply handler waits); the ports and the destination are made
  // when missing at EVERY open (a failed input port is retried, never left 0 behind a live client)
  assert.match(cm, /func prepare\(\) \{ if client == 0 \{ createClient\(\) \} \}/);
  assert.match(cm, /func open\(_ done: @escaping \(\[String: Any\]\) -> Void\) \{/);
  // (a dedicated utility Thread whose run loop stays alive, not a GCD worker: made on a worker, the client missed its notifications in
  // two of three harness runs — CoreMIDI may bind them to the creating thread's run loop)
  assert.match(cm, /let t = Thread \{ \[weak self\] in\s*var c = MIDIClientRef\(\)/); assert.match(cm, /t\.qualityOfService = \.utility/);
  assert.match(cm, /RunLoop\.current\.add\(Foundation\.Port\(\), forMode: \.default\)/);
  assert.match(cm, /if inPort == 0 \{/); assert.match(cm, /if outPort == 0 \{/); assert.match(cm, /if appDest == 0 \{/);
  assert.match(cm, /\["ports": portList\(\), "gen": gen, "h": Self\.hostMs\]/);
  assert.match(cv, /startGuarded\(\)\s*midi\.prepare\(\)/, 'the client prepared right after the page load starts');
  assert.match(br, /host\.bridgeMidiOpen \{ r in if let e = r\["error"\] as\? String \{ no\(e\) \} else \{ ok\(r\) \} \}/);
  assert.match(br, /func bridgeMidiOpen\(_ done: @escaping \(\[String: Any\]\) -> Void\)/);
  // (fix R2-N3) oneList: one withUnsafeMutablePointer scope — the packet pointer MIDIEventListInit returns is used only inside it
  const ol = cm.slice(cm.indexOf('static func oneList('), cm.indexOf('/// The shared counters'));
  assert.match(ol, /withUnsafeMutablePointer\(to: &list\) \{ lp in/); assert.match(ol, /MIDIEventListInit\(lp, \._1_0\)/); assert.match(ol, /MIDIEventListAdd\(lp, /);
  assert.doesNotMatch(ol, /MIDIEventListInit\(&list|MIDIEventListAdd\(&list/);
  // (fix R1-F8) a `ports` call's line carries the drops waiting to ride; the gate lines carry the counters (a log-mode reader sees a drop at once)
  assert.match(cm, /case \.ports\(let list, let g\):[\s\S]*?dropped = lock\.withLock \{ \$0\.dropped \}/);
  assert.match(cm, /Smoke\.log\(\["k": "midiGate", "open": open, "released": n, [^\n]*"backgroundExpired": backgroundExpired, [^\n]*"counters": counters\]\)/);
  assert.match(cm, /static let flushIntervalMs: Double = 2\b/); assert.match(cm, /static let pendingCap = 2048\b/); assert.match(cm, /static let neverThinnedCap = 4096\b/); assert.match(cm, /static let maxAgeMs: Double = 2000\b/);
  assert.match(cm, /guard m\.d1 < 120, !\(64\.\.\.69\)\.contains\(m\.d1\) else \{ return nil \}/, 'CC 64–69 and 120–127 never thinned');
  // §2.3 the UMP walk sizes every type; F8 / FE dropped; CV2 counted
  assert.match(cm, /umpWords = \[1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4\]/);
  assert.match(cm, /st != 0xF8 && st != 0xFE/); assert.match(cm, /else if type == 0x4 \{ cv2 \+= 1 \}/);
  // §1.1 the shim: a Resource (Release too), injected after the marker in installUserScripts (both installs go through it)
  const pb = read(IOS + 'SYNTH.xcodeproj/project.pbxproj');
  assert.match(pb, /path = MidiShim\.js;/); assert.match(pb, /MidiShim\.js in Resources \*\/,/);
  assert.doesNotMatch(read(IOS + 'Config.xcconfig'), /EXCLUDED_SOURCE_FILE_NAMES[^\n]*MidiShim/);
  const ius = cv.slice(cv.indexOf('private func installUserScripts('), cv.indexOf('private func startGuarded('));
  const marker = ius.indexOf('uc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))'), shim = ius.indexOf('forResource: "MidiShim", withExtension: "js"');
  assert.ok(marker > 0 && shim > marker, 'the shim after the marker');
  assert.match(ius, /uc\.addUserScript\(WKUserScript\(source: shim, injectionTime: \.atDocumentStart, forMainFrameOnly: true\)\)/);
  assert.ok(shim < ius.indexOf('forResource: "Smoke"'), 'the shim before the smoke hook');
  assert.equal((cv.match(/installUserScripts\(/g) || []).length, 4, 'declared + the two installs + the one-shot swap');
  // §4.1 the Bluetooth sheet: CoreAudioKit's controller through the Presenter; settle on Done, a user dismissal, the auto-dismiss, abandon.
  // (fix R1-F4) a FORM SHEET, not a popover: a popover's outside tap also reached the page (a Serum matrix cell edited, a key played);
  // the form sheet's dimmed surround consumes it (and dismisses the sheet — presentationControllerDidDismiss still settles)
  assert.match(bt, /^import UIKit/m); assert.match(bt, /^import CoreAudioKit/m);
  assert.match(bt, /CABTMIDICentralViewController\(\)/); assert.match(bt, /presenter\.enqueue\(cancel: closed\)/);
  assert.match(bt, /nav\.modalPresentationStyle = \.formSheet/); assert.doesNotMatch(code(bt), /\.popover|popoverPresentationController|sourceView|sourceRect/);
  assert.match(bt, /nav\.presentationController\?\.delegate = nav/); assert.match(bt, /func presentationControllerDidDismiss\(_ presentationController: UIPresentationController\) \{ onClose\?\(\) \}/);
  assert.match(bt, /nav\.onClose = \{ settle\(closed\) \}/);
  assert.match(cv, /MidiBluetoothSheet\.present\(via: presenter, autoDismiss: Smoke\.drives \? 2 : nil/);
  // §8 the smoke's MIDI half: Debug SMOKE and Smoke.drives only (the user's Debug build does nothing without -smoke)
  assert.match(sm, /^#if SMOKE/m); assert.match(code(sm), /func smokeMidiSteps\(sheetsSoFar: Int\)/);
  assert.match(code(read(SRC + 'SmokeSteps.swift')), /\] \+ smokeMidiSteps\(sheetsSoFar: 6\) \+ \[/);
  assert.match(midi, /#if SMOKE\s+if Smoke\.on, smokeSrc == 0 \{ line\["smoke"\] = smokeCreateEndpoints\(\) \}\s+#endif/);
  assert.match(code(sm), /"SYNTH smoke in" as CFString/); assert.match(code(sm), /"SYNTH smoke out" as CFString/); assert.match(code(sm), /MIDIReceivedEventList\(smokeSrc/);
  assert.doesNotMatch(code(read(SRC + 'SmokeSteps.swift')), /if Smoke\.mode == "midicold" \{ smokeMidiCold\(\); return \}[\s\S]*?guard Smoke\.drives/, 'the modes are checked after Smoke.drives');
  assert.match(read(SRC + 'Smoke.js'), /midiOpen: async function/); assert.match(read(SRC + 'Smoke.js'), /midiStall: function/);
  assert.match(read('tools/app-smoke.sh'), /"step":"ready"/); assert.match(read('tools/app-smoke.sh'), /--mode midicold/);
});

test('B fixes (reviews 1 and 2, fixer M): the smoke — the relaunch by -smokeMode relaunch (R1-F6: a label ending in "b" is a label), several background round trips per run, step 8b (the background task\'s expiry), the release order checked per kind; Smoke.js\'s comment (own accesses); the harness and the sender tools exist', () => {
  const steps = code(read(SRC + 'SmokeSteps.swift')), sm = code(read(SRC + 'SmokeMidi.swift')), sh = read('tools/app-smoke.sh'), js = read(SRC + 'Smoke.js');
  // (fix R1-F6) the relaunch half runs on `-smokeMode relaunch`, never on the label's last letter (`--run r1b` ran it with 50 FAILs)
  assert.doesNotMatch(steps, /hasSuffix\("b"\)/);
  assert.match(steps, /if Smoke\.mode == "relaunch" \{/);
  assert.match(sh, /launch_wait "\$\{RUN\}b" 40 -smokeMode relaunch/);
  // the script counts the `"step":"ready"` / `"step":"bgdone"` lines: a round trip per pair (steps 8, 8b, 11), not one per run
  assert.match(sh, /r=\$\(grep -c '"step":"ready"' "\$log"\); d=\$\(grep -c '"step":"bgdone"' "\$log"\)/);
  assert.match(sh, /if \(\( r > bg \)\); then bg=\$r;/); assert.match(sh, /if \(\( d > fg \)\); then fg=\$d;/);
  // (fix R1-F1) step 8b: Sound in background on, pedal + note down, hidden → the shell's background task; the Debug shell runs the
  // expiration path itself (as iPadOS does ≈ 30 s later) → the triple to the still-live page, 3 hidden sends dropped, the foreground reopens
  assert.match(sm, /func bgTaskStep\(\) -> Step/); assert.match(sm, /self\.midiBackgroundExpired\(\)/);
  assert.match(sm, /Smoke\.log\(\["k": "midiBgTask", "step": "ready"/); assert.match(sm, /"k": "midiBgTask", "step": "bgdone"/);
  assert.match(sm, /js\("midiBgTaskTake", "return __smoke\.midiTake\(\)"\)/);
  // (fix R1-F2) the evaluator: every pedal-up (bn 40 00) before any All Notes Off (bn 7B 00) in the closing batch, whatever the ports' uids
  assert.match(sh, /const pedalFirst = l => \{ const u = kinds\(l, \/\^b\[0-9a-f\]4000\$\/\), a = kinds\(l, \/\^b\[0-9a-f\]7b00\$\/\);/);
  assert.match(sh, /gate\(pedalFirst\(gt\)/); assert.match(sh, /gate\(pedalFirst\(b8t\)/);
  assert.match(sh, /midiBgTask/);
  // Smoke.js hooks its OWN MIDIAccess (one per requestMIDIAccess() since fixer S's N4), not "the shared" one
  assert.match(js, /a recorder on the page side of the shim — listeners on every input of the smoke's OWN MIDIAccess/);
  assert.doesNotMatch(js, /the shared MIDIAccess/);
  // the tools: the macOS harness around the real Midi.swift (review 2's, made a repeatable gate) and reviewer 1's sender (the simulator's only "other app")
  assert.ok(existsSync(new URL('tools/midi-harness/run.sh', ROOT)) && existsSync(new URL('tools/midi-harness/main.swift', ROOT)), 'tools/midi-harness/');
  assert.match(read('tools/midi-harness/run.sh'), /app\/ios\/SYNTH\/Midi\.swift/);
  assert.match(read('tools/midi-harness/main.swift'), /MemoryDefaults/, 'the harness writes no plist (review 2 found ~/Library/Preferences/midiharness.plist)');
  assert.match(read('tools/midi-sender.swift'), /xcrun simctl spawn/);
});

/* ------------------------------------------------------------------ the project, the xcconfig, the ignore rules, the assets */
test('project.pbxproj: every .swift referenced and compiled, Smoke.js and MidiShim.js resources, the Run Script phase calls tools/app-bundle.sh, no build settings, no DEVELOPMENT_TEAM', () => {
  const pb = read(IOS + 'SYNTH.xcodeproj/project.pbxproj');
  for (const f of SWIFT) {
    assert.match(pb, new RegExp(`isa = PBXFileReference; lastKnownFileType = sourcecode\\.swift; path = ${f.replace('.', '\\.')};`), f + ' referenced');
    assert.match(pb, new RegExp(`/\\* ${f.replace('.', '\\.')} in Sources \\*/,`), f + ' compiled');
  }
  assert.match(pb, /path = Smoke\.js;/); assert.match(pb, /Smoke\.js in Resources \*\/,/); assert.match(pb, /Assets\.xcassets in Resources \*\/,/);
  assert.match(pb, /path = MidiShim\.js;/); assert.match(pb, /MidiShim\.js in Resources \*\/,/);
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
