# Stage A: the iPad app (IMPL-A) — contract

ROADMAP row 12, stage A of the standalone app. **Scope (the user's decisions, 2026-10-22 / 23 — settled, not re-asked)**: SYNTH as its
own installed app, **iPad first, then Mac**; **completely offline** (every file bundled, the fonts too, no network at all); the app
**owns the whole screen** (never move layout to dodge browser / iPadOS chrome); **install path now: a free Apple ID + a USB cable**
(personal team, 7-day re-sign; the paid Developer Program "once the app is near complete") — no TestFlight / App Store packaging here,
nothing that blocks it later; the web site (canvas.domlavin.com) **keeps working exactly as today**; synth.domlavin.com untouched; haptics
(Apple Pencil Pro) and CoreMIDI are **stage B**; a one-time purchase someday (no subscriptions) — not this stage. Standing: native pinch
only (the canvas handles its own pinch), the performance presets visual only, no per-stage iPad session (the real-device pass waits for
the user's cable session; the reviewers and the lead work on the simulator **SYNTH iPad Pro 13**, UDID 6F9F14F6-CF76-4FDF-95BD-6890E098069B,
iPad Pro 13-inch M5, iOS 27.0, booted).

**The spike** (`scratchpad/app-spike/SPIKE.md`, 2026-10-23, cited "spike §n" / "spike out/<file>") settled the loading strategy: a
`WKURLSchemeHandler` custom scheme **`synth://app/`** serving a `git archive` snapshot of the site from the bundle — fully offline, a
secure context, `?v=9` modules, module and classic Workers, all 18 worklet scripts direct, the engine renders, WebGL2, IndexedDB
persisting across relaunch and reinstall, a bundled `@font-face`, the real `index.html` booting in ≈ 1 s full screen (spike §1 table,
§2). `file://` is dead (CORS), a loopback HTTP server has a port in its origin (spike §2). Its Swift files are the template for §1.

**Code references are to `canvas` at 0dd10f5** (the builders' base; line numbers move, names don't). Tags: **[R]** a fact (file:line or
spike evidence), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12,
never an [R]). Process (the user's lean shape): this contract → skeptic review → the user's questions (§Q) → builders in worktrees reset to
0dd10f5 with exclusive files (§10) → two reviewers → failing-test-first fixers → one sweep (node, one file at a time,
`--max-old-space-size=2048`) → one squashed commit "A" on `canvas` → deploy the web side; the app is built from the committed tree and
installed on the simulator by the reviewers / the lead.

**The user's answers (2026-10-23 — settled)**: Q1 not asked — the home-screen name is **"SYNTH"** (the default); **Q2 a setting** —
"lets have a sound in background option in the settings that lets the user decide": `UIBackgroundModes [audio]` is always in Info.plist;
a **"Sound in background"** toggle in ⚙ Settings (shown in the shell only, W1 appends it at init beside the existing appended lines, no
index.html edit), **default on** [C, the lead], per device (the settings store); off → the page suspends its AudioContext on `hidden`
and resumes on `visible` (W1), on → §5.2's measured behaviour; the toggle posts `{ t: 'bg', on }` (native records it for the
session / interruption handling); **Q3 yes** — the bundled fonts on the web too (§3.3 (a)); **Q4 yes** — the screen stays awake while
the engine is on. **The fonts are downloaded** (the user's OK): `scratchpad/app/fonts-dl/inter/InterVariable.woff2` (352 240 B),
`…/jbm/JetBrainsMono-Regular.woff2` (92 380 B), `…/jbm/JetBrainsMono-SemiBold.woff2` (94 484 B), both OFL texts — from the official
GitHub repos (rsms/inter `docs/font-files/`, JetBrains/JetBrainsMono `fonts/webfonts/`), each a valid `wOF2`.
**The lead's decisions on the skeptic's open items (2026-10-23)**: §3.3 — **the variable Inter file, not the five statics** (the
approved download; Google's `wght`-only request pins `opsz` at its default 14): `fonts/fonts.css` carries `:root { font-optical-sizing:
none; }` so no size drives `opsz` (no style.css edit); W2 proves the headings unchanged against the Google-served build in headless Chrome
(a screenshot diff at the type sizes style.css uses) — if they differ, W2 stops and the lead asks the user for the statics; G4 counts
**three** woff2. The three extra savers (wk.js, sx-host.js, wtedit.js): lane N measures whether `WKDownload` takes their `blob:` saves;
if not, W1 adds the one-line `SYNTH_SHELL.save` seams there (W1 owns those three lines). `UIRequiresFullScreen`: reviewer 1 checks whether
iPadOS's window controls cover ≡ in a windowed scene; if they do, the lead sets it (full screen only). The bundle id stays
`com.domlavin.synth` (a free team may need a suffix — `Local.xcconfig` overrides it). Before any move to the paid Program the lead tells
the user to Save every project to Files first (the free-team app and its data are deleted on a team switch — §11).

**Invariants**
- **A1 The web build is unchanged for browsers** except the agreed bits: the shell seams are dormant without `window.SYNTH_SHELL`
  (§3.1–3.2) and the fonts move (§3.3, **Q3**). No DSP / engine / model file is touched (engine.js, `*-dsp.js`, `sx-*.js`, `*-core.js`,
  song.js, cv-*.js): every golden (golden-classic / -fx / -presets / -random / -graph / -drums / -606 / -909 / -sdsv / -moog / -moog-b /
  -moog-c, ref-P, ref-M) and canonical-stream are bit-identical by construction and still run in the sweep.
- **A2 Offline, absolutely.** The app opens no network connection, ever: every resource is `synth://app/…`, `blob:synth://app/…` or
  `data:`; enforced twice (a `WKContentRuleList` blocking `http(s)` / `ws(s)` + the navigation policy cancelling any other scheme, §2.4),
  the bundle carries the fonts (§3.3), the smoke proves it (§2.4 item 4, §9.2: only `synth://` in the scheme log, failed-load capture,
  an active negative probe that must fail — the page's console cannot see WebKit's own block messages).
- **A3 One source.** The bundled site is the **committed** tree (`git archive HEAD` of exactly the files the page requests) copied at build
  time by a script — never a second copy in git; uncommitted site changes refuse the build (the deploy-canvas rule, §1.5).
- **A4 The app owns the whole screen.** Status bar hidden, home indicator auto-hidden, no safe-area insets, every orientation; no layout
  moved for chrome (the web's `env(safe-area-inset-*)` rules stay and read 0 — spike §1 "Owns the whole screen"); WebKit's page pinch
  stays WebKit's, the canvas's pinch the canvas's (§6).
- **A5 Its own storage.** `synth://app` is an origin of its own: the app's `synth-canvas` / `-wt` / `-smp` databases are separate from
  canvas.domlavin.com's and from Safari's (appstore.js:92, 104 [R]; spike §3.5). Nothing migrates by itself; projects cross by file (§4.4).
- **A6 Nothing blocks the store later.** No private API (spike §2: the `filex` KVC path is not used), bundle id `com.domlavin.synth`, an
  opaque 1024 px icon, Automatic signing with the team in a gitignored xcconfig, every entitlement absent; the free-team limits are
  recorded (§7, §11), not designed around.
- **A7 Sound as in Safari.** The shell adds no audio processing and no second output path: WebKit's AudioContext is the engine's output;
  the native session only sets the category (§5.1 — whether WebKit's own session honours it is [R?], device-only). What the app sounds
  like = what Safari on the iPad sounds like, latency aside (§11).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists

| piece | where [R] | A |
|---|---|---|
| The site: 113 committed files outside tests / docs / tools, 8.5 MB (`git archive HEAD`, du -k 8492; main.js 611 KB the largest); the page requests 98 of them at boot (95 js, index.html, style.css, manifest; 8 065 036 bytes; the handler ≤ 1 ms per file) | repo at 0dd10f5; spike out/spike-scheme-app.jsonl (`"k":"req"` × 98, all 200) | the bundle = the request list (§1.5) |
| The request list = sw.js's precache: `tools/precache.mjs appRequests()` crawls index.html's `<link>` / `<script>` href / src (query `?v=N` → versioned, none → static), the manifest's icons, every module import / dynamic import / `'x.js?v=' + VERSION` string, main.js `DSP_FILES`, smprender.js's `DSP`; **no CSS `url()` crawl**; `writeSw` rewrites sw.js ASSETS / STATIC / BUILD; pwa.test asserts sw.js's lists equal the crawl and every site .js is reached | tools/precache.mjs:30–74, 77–84, 101–113; sw.js:39–61; tests/pwa.test.mjs:123–147 | the bundle script reads sw.js's two lists (no node in the Xcode build); fonts need the `url()` crawl (§3.3) |
| Deploy: a throwaway commit on a detached worktree of `canvas` (CNAME, the manifest's name, the Apple title, `precache --write`), force-pushed — **the whole tree, tests/ included** (canvas.domlavin.com/tests/bench.html is live); committed work only | tools/deploy-canvas.sh:9–18 | the app excludes tests / docs / tools (§1.5) |
| Fonts: Google Fonts preconnect + preload + print-swap stylesheet + noscript for Inter 400–800 and JetBrains Mono 400 / 600; style.css names `'Inter'` / `'JetBrains Mono'` with system fallbacks; sw.js caches them in `synth-fonts-v1` (precached at install, stale-while-revalidate, an empty stylesheet offline); pwa.test asserts the three CORS links and the SW's font behaviour; offline in the app the links fail silently and the fallbacks render (the simulator had network, so the spike's `index.html` showed `Inter:loaded` from Google) | index.html:28–34; style.css:8–9; sw.js:13–15, 62–64, 117–128; tests/pwa.test.mjs:84–86, 259–292, 437–464; spike §1 "Google Fonts in the real app", §3.1 | §3.3 |
| pwa.js: `platform()` (a WKWebView's UA is a Mac's with touch → `ios` / `ipad` true, `browser: 'other'`), `sheetFor` true for iOS, `appButtons` hides Install / Full screen only when `standalone`; `isStandalone` = `navigator.standalone` or the display modes (both false in the shell: `display-mode: browser`); `swAllowed` https / localhost only; the SW block guards `navigator.serviceWorker` (absent in a WKWebView) | pwa.js:24–48, 121–126, 146–158, 308–340; spike §1 (Service worker), §3.2 | §3.2: a shell counts as installed |
| main.js `download(blob, name, later)`: `shareable()` → the share sheet only when `app.platform.ios && navigator.standalone === true`, else `saveLink` (an `<a download>` of a blob: URL — a WKWebView does nothing useful with it [R?: a blob: navigation → `WKDownload` or a blank page]); callers: Save (`.synth.json`), Save as classic, Export MIDI, Bounce WAV (with `later` → "Save WAV…"), render-last (`renderLast` → `.wav`), Serum preset / pack exports, the Serum host's `download`, the recovered-project notice. **Three more savers bypass it** with their own `<a download>` of a `blob:` URL: wk.js `saveFile` (FX rack / chain exports, fx-ui.js:2290, 2366, 2368; Serum shapes, graph.js:483), sx-host.js's `download` (effect chains 3667, shapes 4039), wtedit.js's `download` (wavetable WAV / single-cycle zip / .256, 1212–1217) — 9 export actions | main.js:4424–4457; 4390–4394, 4643–4647, 3134, 2865, 2872, 3118, 3355, 8692; wk.js:2925–2941; sx-host.js:1218–1227; wtedit.js:1221–1232 | §4.1: the bridge pre-empts `shareable`; **`WKDownload` takes the other three** (§2.4, §4.1) |
| File inputs: `#fFile` (accept `.json,.mid,.midi,…`, Open / Import…), tuning `.scl/.kbm/.tun` (multiple), drum samples `audio/*,…`, the wavetable editor's pickers (`.png,image/png`, WAV, `.txt`), the FX rack's IR picker (`audio/*`), the JSON pickers of wk.js / sx-host.js (presets, chains, shapes), sx-ui-osc's `pickFiles`, `cancel` listeners; the `#fFile` handler parses MIDI or JSON, `restoreEmbedded`, `loadProject` | index.html:62; main.js:4395–4414, 3240–3250, 3908–3914; wtedit.js:1074–1090; fx-ui.js:1858, 2293, 2370; wk.js:2943–2959; sx-host.js:1230; sx-ui-osc.js:210 | §4.2–4.3: WebKit's picker (an image accept offers the camera on a device — §1.3); `openFile()` factored out |
| JS dialogs (native `alert` / `confirm` / `prompt`; sx-host's `K.prompt` is an in-page dialog, not one of them): main.js `confirm` 2439, 2450, 2748, 2919, 4051, 4282, 4383, 6461, 7944, 7961 + the hosts' `confirm` (2190 cv-drum, 2249 cv-pads, 8429 cv-modlayer.js:567), `prompt` 2436, 4163, `alert` 4050, 4391, 4393, 4411, 4460, 4570; fx-ui.js:2133 `confirm`; sx-host.js:1274 and sx-ui-osc.js:194 `w.confirm`; wtedit.js:951, 968, 1047 `win.prompt`; wk.js:2962 `prompt` — **a WKWebView shows none of them without a `WKUIDelegate`** (`confirm()` returns false: New would do nothing; `prompt()` null) | as listed | §6.4 (one delegate covers every site) |
| Audio start: `audioProblem()` (secure context, AudioWorklet), `playbackSession(true)` sets `navigator.audioSession.type = 'playback'` inside the gesture (present in the WKWebView), `powerOn` builds the graph with the context held suspended on WebKit and resumes at `ready`; `wake()` resumes a suspended / interrupted context on every gesture; the WebKit clock path (`isIOS()` true in the shell); `platformProblem()` quiet in the shell | main.js:880–893, 903–927, 933, 966–1030; spike §1 (AudioContext, UA / `platformProblem()` quiet) | §5 |
| Autosave: `persist()` 400 ms after a change → IndexedDB; `visibilitychange` hidden → release keys / pads, `saveNow()`; `pagehide` / `beforeunload` → `saveNow`; `relayout` on `resize` (rotation, Split View) | main.js:376–393, 8624–8626, 8659–8661, 8663–8664 | §5.4, §6.3 |
| Boot's early notices (`early`, `platformProblem`, the recovered project), `notice()` on `#notice`, the help sheet moves `#helpParts` (its "App:" sentence describes Install app / Add to Home Screen; pwa.test asserts "installed app keeps its own projects" in index.html) | main.js:8670–8680, 1354, 5401–5407; index.html:293–299; tests/pwa.test.mjs:89 | §3.2, §7 |
| MIDI: `requestMIDIAccess` checked in three places; undefined in a WKWebView → "MIDI: not supported in this browser" | midi.js:247, 349, 396; spike §1 | stage B (CoreMIDI); unchanged here |
| Workers: `wtwork.js` / `smpwork.js` (module), `smprender.js` (classic, `importScripts(f + sfx)` with the worker's own `?v=`); the addModule blob fallback (dormant under the scheme) | assets.js:154–158, 427–428; main.js:854–873; spike §1 (Workers, blob fallback) | served by the handler as any file |
| Media: no `<audio>` / `<video>` and no media files in the site; the only element is `playbackSession`'s silent `<audio>` fallback, created only when `navigator.audioSession` is absent (it is present in the WKWebView) | main.js:903–915; grep of the site; spike §1 | no Range support needed (§2.2) |
| Icons: five PNGs (192 / 512 / maskable 512 / apple 180 / favicon 32) rendered deterministically by `tools/make-icons.mjs` (RGBA PNGs, `encodePng` ctype 6; `decodePng` reads ctype 6 only); pwa.test decodes and compares | tools/make-icons.mjs:17–23, 46, 117, 137–151; icons/; tests/pwa.test.mjs:45–72 | §1.4: a 1024 px opaque app icon from the same artwork |
| Versions: `VERSION = '9'` in main.js / assets.js / sw.js (lint.test:70–87); sw.js BUILD = the precache hash | main.js:58; sw.js:39–40 | §7 |
| Test harness for the page: `bootMain(o)` fakes `navigator` (ua, platform, touch, `navStandalone`), `location` (protocol / hostname), the display modes (`window === globalThis` in the sim; one boot per test file); app-ios.test covers the share-sheet path in the home-screen app; **`tests/app.test.mjs` already exists** (331 lines, owner I: the desktop installed-app layer — Full screen, beforeinstallprompt, the SW update flow) | tests/main-sim.mjs:16–19, 318–330, 332; tests/app-ios.test.mjs:1–26; tests/app.test.mjs:1–8 | §9 G1–G3; the native test file is `tests/app-native.test.mjs` (§9.1 G5) |
| The Mac: Xcode 27.1 (27A9275) at `xcode-select`; `xcodebuild`, `xcrun`, `swift` present; **no xcodegen / tuist**; the iOS 27.0 runtime holds the iPads; the spike's hand-written `project.pbxproj` (objectVersion 56, 269 lines, `ENABLE_USER_SCRIPT_SANDBOXING = NO`, `TARGETED_DEVICE_FAMILY = 2`, `SUPPORTS_MACCATALYST = NO`, signing off) built with `xcodebuild … -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO` | `which`; spike SYNTHSpike.xcodeproj/project.pbxproj:6, 159, 167, 203–218; spike §6; HANDOVER.md:130–133 | §1.2 |

---------------------------------------------------------------------------------------------------------------------------------

## 1. Where it lives (lane N)

### 1.1 Layout [C]
```
app/ios/
  SYNTH.xcodeproj/project.pbxproj          hand-written (from the spike's), fixed object ids A000…, one target, Debug / Release
  Config.xcconfig                          every build setting the project needs, readable in a diff (the pbxproj has none)
  Local.xcconfig                           gitignored (DEVELOPMENT_TEAM = <the user's personal team>); Config.xcconfig #include?s it
  SYNTH/
    App.swift                              @main AppDelegate + SceneDelegate (one window, one scene; openURLContexts → §4.4)
    ShellViewController.swift              the WKWebView, its configuration, the user script, WKNavigationDelegate / WKUIDelegate,
                                           full-screen flags (§6), lifecycle hooks (§5), process termination (§5.4)
    SchemeHandler.swift                    WKURLSchemeHandler for synth:// (§2) — WebKit + Foundation only (shared with the Mac later, §8)
    SiteBundle.swift                       path → (URL, Data), the MIME table, app-build.json (§2.1) — Foundation only
    Bridge.swift                           webkit.messageHandlers.synth (with reply): files out (§4.1), engine state (§5.3), smoke (§9)
    FileExport.swift                       tmp file → UIActivityViewController (Save to Files / AirDrop / …) (§4.1)
    AudioSession.swift                     AVAudioSession category / activation / interruption observers (§5)
    Info.plist                             hand-written (GENERATE_INFOPLIST_FILE = NO), §1.3
    Assets.xcassets/AppIcon.appiconset/     icon-1024.png + Contents.json (§1.4; lane W2 writes the PNG)
    Assets.xcassets/LaunchBackground.colorset/Contents.json   #0c0d0f (the site's --bg)
tools/app-bundle.sh                        the Run Script phase (§1.5)
tools/app-smoke.sh                         build → install → launch → read the status → screenshot (§9.2)
```
≈ 400 lines of Swift. No Swift packages, no CocoaPods, no third-party code (the house rule and A6).

### 1.2 The Xcode project [C]
A **hand-written `project.pbxproj`** (the spike's is the working template [R: spike §4, built by Xcode 27.1]): xcodegen / tuist are not on
the Mac [R] and would add a generator the lanes cannot diff. Rules that keep it reviewable: fixed 24-hex object ids in sequence
(`A000…0001` …), one file reference per source, **no build settings in the pbxproj** — every setting in `Config.xcconfig`
(`baseConfigurationReference` for both configurations), so a settings change is a one-line diff:
```
PRODUCT_NAME = SYNTH                      PRODUCT_BUNDLE_IDENTIFIER = com.domlavin.synth
MARKETING_VERSION = 0.1                   CURRENT_PROJECT_VERSION = 1          // the script phase stamps the real build number (§7)
IPHONEOS_DEPLOYMENT_TARGET = 17.5         TARGETED_DEVICE_FAMILY = 2           // iPad only; 17.5: Pencil Pro haptics (stage B), isInspectable 16.4, WKDownload 14.5
SUPPORTED_PLATFORMS = iphoneos iphonesimulator   SUPPORTS_MACCATALYST = NO    SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES   // §8
SWIFT_VERSION = 5.0                       SWIFT_STRICT_CONCURRENCY = minimal
CODE_SIGN_STYLE = Automatic               CODE_SIGN_IDENTITY = Apple Development      // DEVELOPMENT_TEAM from Local.xcconfig
ENABLE_USER_SCRIPT_SANDBOXING = NO        // the bundle phase reads the repo and writes a dynamic file set (spike pbxproj:159)
GENERATE_INFOPLIST_FILE = NO              INFOPLIST_FILE = SYNTH/Info.plist
ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon   DEBUG_INFORMATION_FORMAT = dwarf   DEBUG_INFORMATION_FORMAT[config=Release] = dwarf-with-dsym
OTHER_SWIFT_FLAGS[config=Debug] = -DSMOKE  // the smoke / console hooks compile into Debug only (§9.2) — and act only with the -smoke launch argument
```
(**The user's device build is Debug**: Xcode's Run uses the scheme's Debug configuration — so every `-DSMOKE` behaviour is gated at run
time on the `-smoke` launch argument, never on the compile flag alone: no log, no auto-dismissed sheet, no probe on the user's iPad.)
Build phases in order: Sources → Resources (the asset catalog only — Info.plist is processed from `INFOPLIST_FILE`, never a bundle
resource) → **Run Script "Bundle the site"** (`"$SRCROOT/../../tools/app-bundle.sh"`, quoted: the repo path has spaces; input file
`$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)` declared so the build-number stamp (§1.5 step 5) is ordered after ProcessInfoPlistFile; no outputs,
`alwaysOutOfDate = 1` ("based on dependency analysis" off: the site must be re-copied whenever HEAD moves), "run for install builds" on). Simulator builds: `xcodebuild -project app/ios/SYNTH.xcodeproj -scheme SYNTH -configuration
Debug -sdk iphonesimulator -destination 'id=6F9F14F6-CF76-4FDF-95BD-6890E098069B' CODE_SIGNING_ALLOWED=NO SYMROOT=<scratch> build` (the
spike's form, spike §6 [R]); a shared scheme `SYNTH.xcscheme` under `xcshareddata` so the command line and Xcode agree. Device builds:
**the team is never picked in Xcode's Signing UI** — that writes `DEVELOPMENT_TEAM` into `project.pbxproj` (a dirty, team-specific
project file), not into `Local.xcconfig`. The user's one step is Xcode › Settings › Accounts › add their Apple ID (a password: theirs to
type, never an agent's); the lead then reads the personal team's id (`defaults read com.apple.dt.Xcode IDEProvisioningTeams` — the entry with
`isFreeProvisioningTeam = 1` [R?: lane N pins the key name]) and writes `Local.xcconfig` (`DEVELOPMENT_TEAM = <id>`, gitignored). With the
iPad on the cable: `xcodebuild … -configuration Debug -destination 'id=<device udid>' -allowProvisioningUpdates build` (registers the device,
makes the profile) + `xcrun devicectl device install app --device <udid> <SYNTH.app>` [R?: both with a personal team — the lead's first
cable session pins them], or the user presses Run in Xcode (§7.2). Should Xcode offer "Update to recommended settings", decline (pbxproj
churn). A `git diff app/ios/SYNTH.xcodeproj` showing `DEVELOPMENT_TEAM` is reverted, never committed.

### 1.3 Info.plist [C] (hand-written; every key a reason)
`CFBundleDisplayName` **Q1** (default "SYNTH"); `CFBundleShortVersionString $(MARKETING_VERSION)`; `CFBundleVersion
$(CURRENT_PROJECT_VERSION)` (stamped, §7.1); `LSRequiresIPhoneOS`; `UIApplicationSceneManifest` (one scene, `UIApplicationSupportsMultipleScenes`
false); `UILaunchScreen { UIColorName: LaunchBackground }` (§1.4); `UIStatusBarHidden` true + `UIViewControllerBasedStatusBarAppearance`
true; `UISupportedInterfaceOrientations~ipad` all four (spike Info.plist:19–25 [R]); **no `UIRequiresFullScreen`** (§6.3: every window size,
Stage Manager and Split View included — the page already relayouts); `UIBackgroundModes [audio]` **only if Q2 = yes** (§5.2);
`UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` true (the app's Documents appear in Files under On My iPad › SYNTH — §4.1, §9.2);
`CFBundleDocumentTypes` for `public.json` and `public.midi-audio`, `LSHandlerRank Alternate` (§4.4); `NSAppTransportSecurity` **absent**
(the spike's `NSAllowsLocalNetworking` served the http mode; nothing here may load from the network — A2). **`NSCameraUsageDescription`**
("SYNTH can use a photo you take as a wavetable image.") — the one usage key, and not optional: an `<input type=file>` whose accept names
an image (wtedit.js:1079 `.png,image/png`) makes WebKit's iOS upload menu offer *Take Photo*, and a camera access without this key is killed
by the system (TCC) [R?: WebKit's menu; the simulator has no camera, so neither reviewer can see it — the key is added on principle, G5
asserts it]. No microphone / photos / Bluetooth keys (the photo library goes through the system picker, no permission; CoreMIDI over
Bluetooth is stage B).

### 1.4 Icon and launch screen [C]
- **AppIcon**: one **1024 × 1024 opaque PNG** (`AppIcon.appiconset/Contents.json`: `{"images":[{"filename":"icon-1024.png","idiom":"universal",
  "platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}` — Xcode's single-size app icon [R?: Xcode 14+; lane W2 confirms
  Xcode 27 builds it]) rendered by `tools/make-icons.mjs` from the same artwork as the PWA icons (the mark on the dark gradient, the
  `apple` kind: full bleed, iOS rounds the corners; make-icons.mjs:17–23, 46 [R]) — original art, no logos. The App Store rejects an icon
  with an alpha channel (ITMS-90717 [R?]); so `encodePng` gains an opaque mode (colour type 2, RGB) and `decodePng` reads it, the new
  `ICONS` entry `{ file: 'app/ios/SYNTH/Assets.xcassets/AppIcon.appiconset/icon-1024.png', kind: 'apple', size: 1024, opaque: true }`, the
  committed PNG checked by pwa.test's icon test like the five others (pwa.test.mjs:45–72 iterates `ICONS`; `decodePng` expands ctype 2 to
  RGBA with A = 255 so its comparisons stand; the test adds "colour type 2 when `opaque`") (A6). **Ownership**: lane N writes
  `AppIcon.appiconset/Contents.json` (it names `icon-1024.png`) — its builds need the set to exist (`ASSETCATALOG_COMPILER_APPICON_NAME`);
  until W2's PNG lands N builds with an **uncommitted placeholder** PNG in its worktree; W2 writes only `icon-1024.png` (+ make-icons). iOS 26's layered "Liquid Glass" icons (Icon Composer `.icon`) are optional;
  a flat PNG renders with the system's glass [R?] — not this stage.
- **Launch screen**: `UILaunchScreen` with the background colour only (`LaunchBackground` = #0c0d0f = style.css `--bg` [R: style.css:2]).
  The page paints in ≈ 1 s (spike §1); a logo that then jumps would be worse than a plain dark screen. The web view's `isOpaque = false`,
  `backgroundColor` the same colour, `view.backgroundColor` the same (spike SpikeViewController.swift:15, 32–33 [R]): no white flash.

### 1.5 How the site gets into the bundle: `tools/app-bundle.sh` [C]
A Run Script phase, zsh, `set -euo pipefail`, `ROOT = $SRCROOT/../..` = the repo root (`--root <dir>` overrides it, for the test); every
path quoted (the repo folder is "Claude - Synth Synth"):
1. **Refuse uncommitted site work** (A3; deploy-canvas.sh deploys the committed HEAD only [R:9–18]): compute the file list (step 2), then
   `git diff --quiet HEAD -- <list> sw.js` must pass and `git ls-files --others --exclude-standard -- ':(glob)*.js' ':(glob)panels/*.js'
   ':(glob)fonts/**' index.html style.css` must be empty (`:(glob)`: a bare `'*.js'` pathspec also matches tests/ and tools/ files); else
   `error: uncommitted site changes — commit first` and a non-zero exit (Xcode shows it as a build error).
   `SYNTH_ALLOW_DIRTY=1` in the environment skips the check for a **local try only**; the build is then marked `"dirty": true` in
   app-build.json and the smoke fails on it (§9.2) — a build handed to the user is never dirty.
2. **The file list = HEAD's sw.js precache** (`git show HEAD:sw.js`; `const ASSETS = […]` + `const STATIC = […]`, `'…'` strings parsed by the
   script; `./` → `index.html`; sw.js:42–61 [R]) — tested by pwa.test to equal the page's request crawl [R: pwa.test.mjs:123–130], so **the
   bundle is exactly what the page can request**, no more (tests / docs / tools / app / CNAME / .nojekyll / .gitignore / sw.js / CLAUDE.md /
   README.md never ship — sw.js is excluded on purpose: nothing may register it, and `navigator.serviceWorker` does not exist in the shell
   anyway [R: spike §1]). The fonts join the list through §3.3's `url()` crawl. No node in the Xcode build (Xcode's PATH has no Homebrew /
   nvm): the parse is sed / awk; `tests/app-native.test.mjs` (§9.1 G5) runs the same parse over sw.js and asserts it equals `appRequests()`.
   **Stale lists refuse the build**: pwa.test catches a missed `node tools/precache.mjs --write` only in the sweep, and a stale list here is
   a silent 404 in the app (a new module missing). The script recomputes sw.js's `BUILD` from HEAD — `buildHash`'s formula
   (precache.mjs:77–84 [R]): for each listed name in byte order (`LC_ALL=C sort`; `./` hashes index.html's bytes), the line
   `name \0 sha256hex(git cat-file -p HEAD:<file>) \n`, the whole stream through `shasum -a 256`, the first 12 hex digits — and refuses on a
   mismatch ("sw.js is stale — run node tools/precache.mjs --write and commit"). Any change to a listed file (an added import is one) moves
   the hash, so a missed `--write` cannot pass. `/usr/bin/shasum` and `git` are on Xcode's PATH [R].
3. `rm -rf "$DEST"; mkdir -p "$DEST"; git -C "$ROOT" archive HEAD <list> | tar -x -C "$DEST"` with `DEST =
   $TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/site` — content from HEAD, reproducible (the same commit → the same bytes; `git
   archive` stamps the commit time, so the bundle's mtimes are stable too). Not a blue folder reference (the spike's shortcut needs the
   files on disk next to the project — spike §4 [R]).
4. **`site/app-build.json`**: `{ "sha", "short", "date" (the commit's ISO time), "version" (main.js VERSION, sed), "build" (the commit count,
   `git rev-list --count HEAD`), "dirty" }` — read by Help & about (§7.3) and the smoke.
5. **Stamp the build number**: `/usr/libexec/PlistBuddy -c "Set :CFBundleVersion <count>" "$TARGET_BUILD_DIR/$INFOPLIST_PATH"` (the Info.plist is
   already processed when this phase runs; §7.1). `CFBundleShortVersionString` stays `MARKETING_VERSION` (the user's number).
6. Prints one line: `site: 115 files, 9.0 MB, 0dd10f5 (v9, build 412)`.
Run outside Xcode for a check: `tools/app-bundle.sh --dry-run <dir> [--root <repo>]` lists and copies into `<dir>` (no Info.plist stamp;
used by the test against a throwaway repo, §9.1 G5, and by the smoke).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The scheme handler (lane N)

### 2.1 Resolution [C] (the spike's `Site.resolve` + `MIME.of`, hardened — spike Report.swift:45–81 [R])
- `synth://app/<path>?<query>`: the **query is ignored** for the lookup (`?v=9`, `?run=`, `?dev=1`, `?perf=` …: `url.path` has none; the page
  sees them in `location.search` as today — main.js:107 `?dev=1` works [R]). Percent-decoding once; `/` or an empty path → `index.html`;
  **any other directory path → 404** (no implicit index: `panels/` is not a page). **Resolution is a lookup, not a file-system walk**:
  at launch `SiteBundle` enumerates `site/` once into a `[relative path: URL]` map (≈ 115 entries); a request resolves only to a key of
  that map, **exactly as cased** — so `..`, symlinks and escapes cannot resolve by construction, and the simulator is as strict as the
  device: iOS's file system is case-sensitive while the Mac's (the simulator's) is not by default [R?], so a wrong-case path that the
  simulator's `fileExists` would forgive 404s on the iPad (and on GitHub Pages) — the map makes it 404 everywhere. Lane N's test:
  `Index.html` and `panels/../index.html` → 404.
- Host: `app` only; any other host (`synth://x/…`) → 404. (One origin: A5.)
- **MIME table** (the spike's, `Content-Type` with charset for text): html, js / mjs (`text/javascript`), css, json / map, webmanifest
  (`application/manifest+json`), svg, png, jpg, ico, **woff2 / woff / ttf** (`font/woff2` …), wasm, txt / md, wav, mid; else
  `application/octet-stream`. `index.html` and every `.js` must be exact: WebKit refuses a module or a worklet script with a wrong type.
- Headers: `Content-Type`, `Content-Length`, `Cache-Control: no-store` (the spike's; WebKit's memory cache would otherwise keep a stale copy
  across a Debug relaunch — offline there is nothing to gain from caching), `Access-Control-Allow-Origin: *` (the spike's; harmless, same
  origin anyway). **No `Range`**: nothing in the site needs it (§0 Media) — a request with a `Range` header gets the full 200 (HTTP allows
  it; the handler logs it in Debug so a future media file is noticed).
- 404: `text/plain` "not found", logged (Debug: the smoke counts them — the real page makes none: 98 / 98 were 200, spike out/spike-scheme-app.jsonl).
- `index.html` is served **as committed** (no rewriting: the Apple title / manifest edits are deploy-canvas's for the web, inert here). The
  marker comes from a `WKUserScript`, not from an HTML edit (§3.1).
- `app-build.json` is one more file of the site folder (served by the same rule).

### 2.2 Threading and tasks [C]
The spike answered synchronously on the main thread (fine at 8 MB, spike §2 caveat). The stage: `start(task)` records the task in a
`live` set keyed by `ObjectIdentifier` (as the spike) and dispatches the read to a serial utility queue; the response is delivered back on
the main queue **only if the task is still live** (`stop(task)` removes it: WebKit's contract forbids calling a stopped task — spike
SchemeHandler.swift:7–27 [R] does this synchronously); `Data(contentsOf:)` of ≤ 611 KB files (`.mappedIfSafe`). One `didReceive(response)`,
one `didReceive(data)`, `didFinish()`; errors → `didFailWithError`. Debug (`-DSMOKE`) with the `-smoke` argument: every request appended to the smoke log
(`{ k: 'req', url, status, mime, bytes, ms }`, the spike's shape) — the smoke's "no network" and "no 404" counts read it.

### 2.3 Configuration (verified by the spike, SpikeViewController.swift:16–34 [R])
`setURLSchemeHandler(_, forURLScheme: "synth")`; `websiteDataStore = .default()` (persistent: IndexedDB survived relaunch and reinstall, spike
§1); `allowsInlineMediaPlayback = true`; `mediaTypesRequiringUserActionForPlayback = []` (an AudioContext resumes without a tap; the
page's own "Press Power or play a key" flow is unchanged — spike §3.7); `preferences.isElementFullscreenEnabled` left false (the page's Full
screen button is hidden in the shell anyway); `limitsNavigationsToAppBoundDomains` **never** set, no `WKAppBoundDomains` (spike §2); the
user script of §3.1 at `.atDocumentStart`, `forMainFrameOnly: true`; the message handler `synth` with reply
(`addScriptMessageHandler(_:contentWorld: .page, name:)`, `WKScriptMessageHandlerWithReply` — the page world, where the user script runs;
§4.1); `isInspectable = true` in **Debug only** (Safari's Web Inspector from the Mac over the cable — the user's iPad pass can use it);
`allowsLinkPreview = false`; `allowsBackForwardNavigationGestures = false` (the default; said); `preferences.isFraudulentWebsiteWarningEnabled
= false` (WKPreferences.h:53 [R]: no Safe Browsing lookups — moot for `synth:`, said for A2); `underPageBackgroundColor` = #0c0d0f
(WKWebView.h:629 [R]: a zoomed-out page shows the site's colour, not white); `WKUIDelegate.webView(_:createWebViewWith:for:windowFeatures:)`
returns nil (no `window.open` / `target=_blank` window, none in the site). Load: `webView.load(URLRequest(url: "synth://app/index.html"))`.

### 2.4 No network, enforced [C] (A2)
1. **`WKContentRuleList`** compiled once at launch (`WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "synth-offline-1",
   encodedContentRuleList:)`, cached by the store across launches) and added to `userContentController`:
   `[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]` —
   every page-initiated load to the network is blocked before it leaves WebKit (fetch, XHR, `<link>`, `<img>`, `<script>`, workers' fetches
   [R?: content rules apply to worker loads — lane N pins with a Debug-only probe]; WebSocket [R?: the `websocket` resource type exists in
   recent WebKit — pinned the same way]). If compilation fails the app **does not load the page** (a native alert "SYNTH could not start
   its offline guard" — it never happened in the spike's WebKit, but a silent fallback would break A2).
2. **Navigation policy** (`WKNavigationDelegate.decidePolicyFor navigationAction`), in this order: **(i)** `navigationAction.shouldPerformDownload`
   (an `<a download>` click — WKNavigationAction.h:83, iOS 14.5 [R]) → `.download` (WKNavigationDelegate.h:52 [R]) → `navigationAction(_:didBecome:)`
   sets the `WKDownloadDelegate` (§4.1) — for `blob:` / `data:` / `synth:` URLs only (`blob:` from the three module savers, §0; an
   `http(s):` download is cancelled like any network navigation — a download is not a page load a content rule is sure to see, A2); **(ii)** `.allow` for `synth:`
   main-frame loads and `blob:` / `data:` / `about:blank` sub-frames; **(iii)** `.cancel` for everything else (an `https://` link, `mailto:`,
   `tel:`, a `blob:` / `data:` main-frame navigation — the classic WKWebView failure where Save replaces the app with the file's text and no
   way back) — logged, no Safari hand-off (the help text has no links; the only `https://` in index.html are `<link rel=canonical>` and the
   og / fonts metas, never navigated [R: index.html:17–34]). `decidePolicyFor navigationResponse`: `!canShowMIMEType` → `.download` too.
3. **No ATS exception, no `NSAllowsArbitraryLoads`, no URLSession in the app** (grep-tested by §9 G6: the Swift sources contain no `URLSession`,
   `NWConnection`, `NWListener`, `http://`, `https://` outside comments).
4. **Measured** (§9.2) — not by the console: WebKit's own messages (a content-blocker block, a CORS refusal, a failed resource load) go to
   Web Inspector, **never through the page's `console.error`**, so the spike's hook (SpikeViewController.swift:108–116 [R]: wrapped
   `console.error` / `warn`, a bubble-phase `window` `error` listener — resource errors do not bubble) cannot see a blocked load. The smoke
   proves the guard instead: (a) the scheme log has only `synth://` requests and no 404; (b) the hook adds a **capture-phase**
   `window.addEventListener('error', …, true)` (an element's failed load: its `src` / `href`); (c) an **active negative probe** under `-smoke`:
   `fetch('https://canvas.domlavin.com/manifest.webmanifest')` from the page and from a module Worker, an `Image` with an `http://` src, a
   `WebSocket('wss://…')` — each must fail (recorded with `navigator.onLine`: with the Mac online, a pass proves the block); (d) on the base
   tree (index.html:28–34's Google links) the capture listener records the blocked Google stylesheet loads (the preload and the print-swap link; the noscript copy is inert) — the natural positive control.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The web side's shell seams (lanes W1, W2) — dormant in every browser (A1)

### 3.1 The marker [C] (lane N injects; W1 reads)
A `WKUserScript` at document start, main frame only (Workers and worklets never see it — they don't need to):
```js
window.SYNTH_SHELL = { os: 'ipados', idiom: 'pad', app: '<CFBundleShortVersionString>', build: '<CFBundleVersion>',
  sha: '<app-build.json short>', site: '<VERSION>', restarted: <true after a WebContent reload, §5.4>,
  post: m => webkit.messageHandlers.synth.postMessage(m) };   // (with reply: a Promise of the native answer)
```
A plain object (main.js adds `openFile`, `probe`, `on`, `save` to it — §3.2); `location.protocol === 'synth:'` is the second, script-free
sign. `restarted` is **one-shot**: the user script is fixed per load, so after a restart's `ready` (§3.2 item 4) native swaps the user
scripts back to `restarted: false` (`removeAllUserScripts` + re-add, the Debug console hook included) — else every later `location.reload()`
(the read-only notice's Reload, main.js:99) would show the restart notice again.
pwa.js: `export const inShell = (win, loc) => !!(win && win.SYNTH_SHELL && typeof win.SYNTH_SHELL === 'object') || !!(loc && loc.protocol === 'synth:')`.

### 3.2 pwa.js and main.js in the shell [C] (lane W1)
- **pwa.js**: `isStandalone(win, nav, fsActive, loc)` returns true when `inShell(win, loc)` (one place: `appButtons` then hides Install app
  and Full screen, the sheet never opens, `beforeinstallprompt` is moot, `persistOnce()` runs — `persist()` is denied in a WKWebView, spike
  §1, harmless). The SW block is already dead in the shell (`navigator.serviceWorker` absent [R: spike §1], `swAllowed('synth:')` false
  [R: pwa.js:126]) — an explicit `if (inShell(win, loc)) skip` guard is added anyway so the toast can never show on a future WebKit that
  exposes SW to custom schemes (A1 for browsers: the guard is false there). `initApp` returns `shell: inShell(...)` in its controller.
- **main.js**: `const SHELL = inShell(globalThis, globalThis.location) ? globalThis.SYNTH_SHELL : null` after the imports (main.js:14 imports
  pwa.js [R]; `globalThis.location`, as main.js:107 reads it — a harness without `location` must not throw). Seams, each a few lines, each
  inert when `SHELL` is null (W1 owns exactly items 1–9):
  1. `download()` (4424): `if (SHELL) return shellSave(blob, name)` before `shareable()` (§4.1).
  2. `openFile(f)`: the body of `#fFile`'s `onchange` (4396–4414) factored into `async function openFile(f)` (a `File` / `Blob` with `.name`;
     `e.target.value = ''` stays in the handler); `SHELL.openFile = (name, b64) => openFile(new File([bytesOf(b64)], name))` (§4.4).
  3. `SHELL.probe()` → `{ ctx: ctx ? ctx.state : null, sr, baseLatency, outputLatency, nodes: nodes.size, master: !!mnode, peak: anPeak(), held: held.size,
     cpu: $('#cpu').textContent, store: store.mode, bootMs }` where `anPeak()` reads `an.getFloatTimeDomainData` once (max |x|; `an` exists while
     the engine is on, main.js:1003 [R]) and `bootMs` is `performance.now()` at the end of `boot()` — the smoke's and the user's pass's
     window into the engine (§9.2). ≤ 12 lines; no behaviour.
  4. `SHELL.post({ t: 'engine', on })` from `powerUI()` (main.js:1356) **whenever `!!(ctx || pendCtx)` changes** — powerUI runs on every
     power transition, so powerOn's failure path (main.js:1016–1027), `powerOff` and `resync` are covered without one post per site (§5.3's
     idle timer); `SHELL.post({ t: 'ready' })` at the end of `boot()` (§4.3's queued open, §3.1's one-shot `restarted`; the smoke's boot mark).
  5. `SHELL.restarted` → one early notice: "SYNTH restarted (the system reclaimed memory) — the project came back from its last autosave"
     (`early.push`, main.js:8674–8677 [R]).
  6. Help & about (5401–5407): in the shell the "App:" sentence of `#helpParts` is replaced at open by "App: this is the SYNTH app, build
     <sha> (<date>) · site v<VERSION>. Projects saved in Safari or Chrome are separate: Save the file there and Open / Import… it here (or
     open it from the Files app)." — the committed index.html text is untouched (pwa.test.mjs:89 [R] keeps asserting it); the build line is
     read from `fetch('app-build.json')` (same origin, served by §2.1) once, cached.
  7. `shareable()` untouched (`navigator.standalone` is undefined in a WKWebView, so it would fall to `saveLink` — the shell path comes first).
  8. `SHELL.on = m => { if (m && m.t === 'resume') wake(); }` (§5.3's interruption end; unknown `t` ignored).
  9. `SHELL.save = (blob, name) => shellSave(blob, name)` — the bridge by itself, for the smoke's integrity step and lane N's 100 MB measure
     (§9.2 step 5); no caller in the page.
- Not changed: `platformProblem()` (quiet in the shell: UA without `Version/…Safari/` → `safariIOS` false [R: 889; spike §1]), `isIOS()` (true →
  the WebKit clock, held power-on — right for the same WebKit [R: 893, 933]), midi.js (stage B), `audioProblem()` (secure context true).

### 3.3 Fonts bundled (lane W2) — **Q3 decides the web**
The user's rule: every file bundled, no network at all — so the two faces must come from the repo. Files (the lead downloads them after
the user's OK; the lane never fetches — A6's "no third-party code" is about code, fonts under the OFL are content we may ship):
| file in repo | source (release zip) | licence | size [R?] |
|---|---|---|---|
| `fonts/Inter-Regular.woff2`, `-Medium`, `-SemiBold`, `-Bold`, `-ExtraBold` | github.com/rsms/inter/releases — Inter 4.1, `web/` (the static **text** instances, weights 400 / 500 / 600 / 700 / 800) | SIL OFL 1.1, `LICENSE.txt` in the zip | ≈ 110 KB each [R?] |
| `fonts/JetBrainsMono-Regular.woff2`, `fonts/JetBrainsMono-SemiBold.woff2` | github.com/JetBrains/JetBrainsMono/releases — 2.304, `fonts/webfonts/` | SIL OFL 1.1, `OFL.txt` in the zip | ≈ 90 KB each |
| `fonts/OFL-Inter.txt`, `fonts/OFL-JetBrainsMono.txt` | the two licence texts, verbatim (the OFL requires the licence with every copy; the Reserved Font Names stay inside the files — we rename nothing inside) | — | 4 KB each |
[C] Inter's five **static text instances**, not `InterVariable.woff2`: Inter 4's variable file carries an `opsz` axis (14–32) besides
`wght` [R?: Inter 4.0's release notes; W2 confirms from the file's `fvar` or the release notes], which WebKit's default
`font-optical-sizing: auto` drives from the font size — style.css sets text at 15–34 px (26 and 34 px among them) — so headings would
take the Display shapes, while Google's `wght`-only request serves the opsz-14 instances: the statics are what the site shows today (the
alternative, the variable file + `font-optical-sizing: none` in style.css, touches a file no lane owns). JetBrains Mono's two static weights
(as Google serves, 400 / 600). Google serves latin subsets (≈ 25 KB a face): the full files are bigger and render the same glyphs for our
text (a few symbols outside Google's latin ranges — ≡ ⋯ ✕ ♯ — may now come from Inter instead of the system fallback: reviewer 2's diff
says). `fonts/fonts.css?v=9`:
```css
@font-face { font-family: 'Inter'; font-weight: 400; font-display: swap; src: url(Inter-Regular.woff2) format('woff2'); }
/* … 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold: one rule each */
@font-face { font-family: 'JetBrains Mono'; font-weight: 400; font-display: swap; src: url(JetBrainsMono-Regular.woff2) format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 600; font-display: swap; src: url(JetBrainsMono-SemiBold.woff2) format('woff2'); }
```
(relative `url()`s resolve against `fonts/`; style.css's family names are unchanged — style.css:8–9 [R].) The lead downloads the files
(after the user's OK) **before phase 1** and drops them into W2's worktree (G4 needs them); the lane never fetches.

**The two ways** (the lead weighs; the recommendation is a question because it changes the web site):
- **(a) The web too — recommended.** index.html:28–34's four Google lines → one `<link rel="stylesheet" href="fonts/fonts.css?v=9">` (+ a
  `<link rel="preload" as="font" crossorigin href="fonts/Inter-Regular.woff2">` so the first paint has the body face). One path for the site and
  the app; **the offline PWA gets the real fonts** (today an installed PWA opened offline before the SW cached Google's files shows system
  fonts — sw.js:13–15 [R]); **no third-party request from the site** (privacy: Google Fonts sees every visitor's IP today); sw.js loses
  `FONTS` / `FONT_HOSTS` / `FONT_*` / `precacheFonts` / `font()` and the activate rule's `k !== FONTS` (sw.js:13–15, 27–28 (header),
  62–64, 95–120, 124, 141, 195–210 [R]) — so the next activation **deletes `synth-fonts-v1`** (deliberate: the PREFIX rule, sw.js:124); the woff2 files are
  STATIC precache entries, fetched once with the shell (`cache: 'no-cache'`: a 304 on later updates); ≈ +730 KB in the precache (one-time;
  the page's 8 MB of scripts dwarf it); pwa.test's font assertions (84–86, 238–258 — line 245's `synth-fonts-v1` at install —, 259–292,
  293–300 — "the fonts cache stays" at activate —, 437–464, and the header's line 4 [R]) become "no Google Fonts anywhere; fonts.css + the
  seven files precached; `synth-fonts-v1` goes at activate"; deploy-canvas untouched. Risk: none to sound or layout
  (same families, metrics within the same typeface — Google serves Inter's variable build too for weight ranges; the static instances it
  serves for `wght@400;500;…` are instances of the same design [R?: a visual diff of the top bar at 1440 × 900 before / after, reviewer 2]).
- **(b) App only.** index.html unchanged for the web; in the shell the Google `<link>`s are blocked by §2.4 (silently: `onload` never fires,
  `media="print"` stays, the noscript line is inert) and `fonts.css` must be injected — by the user script (`document.head.append(link)`
  at document start) or by the page (`if (SHELL) …`). Two paths; the web's offline PWA keeps system fonts; the precache crawl still needs
  the `url()` rule for the files to be bundled (they must be in sw.js's lists for §1.5 — then the web site precaches files it never
  uses, or the lists grow a third kind); and the two `<link rel=preconnect>` (index.html:28–29) open sockets to Google that a content
  rule list may not cover (a preconnect is not a resource load [R?]) — against A2. More code, two behaviours, the fonts tested twice. Not
  recommended.
Either way: **`tools/precache.mjs` gains a CSS `url()` crawl** — for every versioned `.css` the crawl lists, `url(<rel>)` with or without
quotes and without a scheme (not `data:` — style.css:1061's `url("data:image/svg+xml,…")` [R] carries an `http://www.w3.org` namespace that
must not be mistaken for a load —, not `#…` — style.css:433 `url(#knobShine)` [R] is a fragment) → resolved against the stylesheet's directory → **STATIC**
(unversioned, like the icons: fonts are content, fetched `no-cache`-revalidated as the icons are — sw.js:10 [R]); `buildHash` covers them
(it hashes STATIC too, precache.mjs:77–84 [R]); pwa.test:123's "every site .js is reached" is unaffected; the lead runs `--write`.
`sw.js`'s `other()` already serves unversioned same-origin GETs network-first with the precache offline (sw.js:26; pwa.test.mjs:424 [R]) —
the woff2 files take that path on the web.

---------------------------------------------------------------------------------------------------------------------------------

## 4. Downloads and files (lanes N, W1)

### 4.1 Files out: the bridge, chunked, and `WKDownload` [C]
**Two paths, one sheet.** (i) main.js's `download()` (every caller in §0's first list) → the bridge below. (ii) The three module savers
(wk.js `saveFile`, sx-host.js `download`, wtedit.js `download` — §0) click an `<a download>` of a `blob:` URL: §2.4 (i) turns it into a
`WKDownload` (`decideDestinationUsing response:suggestedFilename:` → `tmp/<uuid>/<sanitised name>`, `downloadDidFinish` → the sheet) —
**mandatory, not a fallback**: without it nine export actions silently do nothing. A `blob:` download through `WKDownload` is [R?] (the
spike did not test downloads): lane N pins it on day 1 with a 1 KB and a 100 MB `blob:` link; should WebKit refuse `blob:` downloads, the
three savers each get a one-line `globalThis.SYNTH_SHELL?.save` branch (files no lane owns — left for the lead to assign).
The bridge (`shellSave(blob, name)`):
```
await SHELL.post({ t: 'file', id, name, type: blob.type, size: blob.size })        // native: a FileHandle in tmp/<id>/<name>; refuses if free space < size
for each 2 MiB slice: await SHELL.post({ t: 'chunk', id, at, b64: base64(slice) }) // backpressure: one chunk in flight (the reply); native checks `at`
const r = await SHELL.post({ t: 'end', id })                                       // native: close, present the sheet; replies when the sheet closes
// on any error: SHELL.post({ t: 'abort', id }) (native deletes tmp/<id>), then the saveLink fallback below
```
(`WKScriptMessageHandlerWithReply`, iOS 14+ [R]: `postMessage` returns a promise of the native reply. A script message carries strings,
numbers, arrays, dictionaries — **not** an ArrayBuffer / typed array [R: WKScriptMessage bridging], hence base64. `base64(slice)`:
`new Uint8Array(await slice.arrayBuffer())` → `String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))` per 32 KiB → `btoa` (a spread
or one `apply` over 2 MiB overflows JSC's argument limit; no FileReader in node, so G2 runs the same code); `Uint8Array.prototype.toBase64`
when present. An error reply → `shellSave` falls back to `saveLink`, which §2.4 (i) routes to `WKDownload`.) Why a bridge for `download()`
and not `WKDownload` alone: the bridge is deterministic, testable in node (G2) and in the smoke (§9.2 step 5 hashes the received bytes),
and it needs no user activation (the bounce's "Save WAV…" extra tap exists only because `navigator.share` needs a fresh gesture —
main.js:4421–4423, 4643–4647 [R]; in the shell the sheet appears when the render ends; shareFile's "ready — tap here" notice,
main.js:4439–4446, is never reached). **`end`'s reply waits for the sheet's `completionWithItemsHandler`**: `{ ok: true, done }` — `done`
false (the user closed the sheet without saving) → `shellSave` calls `later(go)` when the caller gave one (`go` re-sends the same blob):
the bounce keeps today's "Save WAV…" retry without a second render (main.js:4643–4647). Cost: base64 inflates 4/3 and a 100 MB bounce
(32-bit float, 96 kHz, ≈ 2 min 10 s) crosses the bridge in 50 chunks — lane N measures a 100 MB file on the simulator (time ≤ 5 s, the
WebContent process's peak ≤ +150 MB over its level before the save; §9.4) and, if either fails, routes `download()` through `saveLink` →
`WKDownload` too — a [C] refinement, noted in §12. (The page's own peak for a long bounce — the render buffer, the encoded WAV, the Blob,
each the file's size — is today's in Safari too; the bridge adds ≈ 3 slices.) Native rules: the file name is sanitised (`lastPathComponent`,
no `/` `:` NUL, ≤ 200 bytes) — it is page-controlled and becomes a path; ids are per transfer; a WebContent termination mid-transfer closes
and deletes every open `tmp/<id>` (§5.4). **One sheet at a time**: presentations queue (an Export All, a double tap, a `WKDownload` landing
while a sheet is up — UIKit refuses a second `present` and the file would be lost), each presented from the topmost presented controller.
The sheet: `UIActivityViewController(activityItems: [fileURL])` as a popover from a rect at the top centre of the web view (arrow up; an
iPad requires an anchor; the tap's point is unknown to native) with "Save to Files", AirDrop (the user's Mac is one AirDrop away), Mail,
Messages, Shortcuts…; `completionWithItemsHandler` deletes `tmp/<id>` (also at launch: a sweep of `tmp/` older than a day). This matches
the PWA's behaviour (`navigator.share({ files })`, app-ios.test [R]) and beats `UIDocumentPickerViewController(forExporting:)` (Files only,
no AirDrop).

### 4.2 Files in: `<input type="file">` [R? → lane N / reviewer 1 pin]
A WKWebView presents iOS's own document picker (Files, iCloud Drive, On My iPad…) for `<input type=file>`; `accept` maps to UTTypes
(`.json` → `public.json`, `.mid` / `.midi` → `public.midi-audio`, `audio/*` → audio, `.png` → image, `.scl` / `.kbm` / `.tun` / `text/plain`
→ plain text — an extension iOS does not know maps to a dynamic type [R?: whether `x.scl` is then selectable — reviewer 1 pins]);
`multiple` works (the tuning and wavetable pickers); the `cancel` event (main.js:3912 [R]) [R?]. An image accept (wtedit.js:1079) makes
WebKit offer a menu first — Photo Library / **Take Photo** / Choose File — on a device: `NSCameraUsageDescription` (§1.3) keeps Take Photo
from killing the app [R?: device-only]. Nothing to change in the page; reviewer 1 opens a project, imports a MIDI file, a WAV drum sample,
an IR (fx-ui.js:1858), a `.scl`, a PNG wavetable on the simulator (files put into the simulator's Files app with `xcrun simctl addmedia`? — no: `addmedia` takes
photos / videos only; the reviewer writes test files into the app's Documents container, visible in Files under On My iPad › SYNTH thanks
to `UIFileSharingEnabled`, §1.3). The page's text fields keep iOS's keyboard; nothing else.

### 4.3 Open a project from the Files app [C] (in scope, small)
`CFBundleDocumentTypes` (§1.3) puts SYNTH in Files' "Share → SYNTH" / "Open in" for JSON and MIDI files. `scene(_:openURLContexts:)` (and
`connectionOptions.urlContexts` at a cold start): `startAccessingSecurityScopedResource`, read the bytes (≤ 64 MB, else a native alert),
`SYNTH_SHELL.openFile(name, b64)` via **`callAsyncJavaScript("return SYNTH_SHELL.openFile(name, b64)", arguments: ["name": …, "b64": …],
in: nil, in: .page)`** (WKWebView.h:363, iOS 14 [R]) — never a JS string built from the file name (a name is user-controlled: `a'); …`
would run as code) nor an 85 MB string literal for the parser — **queued until the page has posted `{ t: 'ready' }`** (§3.2 item 4) so a
cold start works (every native → web call waits for `ready` the same way — `SYNTH_SHELL.on` too); the page runs the same `openFile()` as Open / Import… (MIDI or project, `restoreEmbedded`, the schema gate's read-only
notice — main.js:4396–4414 [R]). Not in stage A: a document browser (`UISupportsDocumentBrowser`), iCloud, "Save" writing back in place
(a project is always exported through §4.1 — a copy, as the PWA does).

### 4.4 Migration — said plainly for the user
The app keeps its own projects, separate from Safari's and Chrome's (and from the installed web app's): nothing you saved in the browser
appears in the app by itself. To bring a project over: in the browser, ≡ → **Save** (it goes to Files, or to the share sheet in the
home-screen app); in the app, ≡ → **Open / Import…** and pick the file (or in the Files app, tap the file → Share → SYNTH). Sounds you saved
as presets and your own wavetables / samples travel inside the project file when it holds them (main.js:4407 `restoreEmbedded` [R]);
device settings (volume, latency, performance preset) are per app. The web site keeps working as before — the app is a second home,
not a move.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Audio session and app lifecycle (lane N; W1 for the two seams)

### 5.1 The session [C]
`AVAudioSession.sharedInstance()`: `setCategory(.playback, mode: .default, options: [.mixWithOthers])`, `setActive(true)` at launch (before the
page loads, as the spike — SpikeViewController.swift:67–73 [R]) and again on `sceneDidBecomeActive`. `.playback`: the Ring / Silent switch
does not mute, the app may play with the screen locked (if Q2); `.mixWithOthers` [C]: a synth is played along with other apps' music and a
metronome app — it does not pause the user's Music app; the silent switch is still ignored with it [R: AVAudioSession docs — only
`.ambient` / `.soloAmbient` follow the switch]. No `setPreferredSampleRate` (WebKit creates the AudioContext at the hardware rate or
resamples; `settings.sr` stays the page's business, main.js:973 [R]); no `setPreferredIOBufferDuration` by default — **Debug only**
`-iobuf <seconds>` (launch argument) sets it so the device pass can measure whether it reaches WebKit's `baseLatency` (spike §5: the
simulator's 2.67 ms / 128 frames are meaningless). [R?] **Whether the host's session governs WebKit's output at all**: WebKit renders
Web Audio in its own GPU process and sets the session from the page's `navigator.audioSession.type` — the page sets `'playback'` at
power-on (main.js:905 [R]) and `'auto'` at power-off (main.js:1050 [R]); WebKit's public headers have no audio-session API for the host
(WebKit.framework/Headers: none [R]). So `.mixWithOthers` may be dropped by WebKit's `'playback'` (other apps' music pausing when the
engine starts), and the app process's `AVAudioSession` reading may not even reflect WebKit's session. The smoke records `category` /
`categoryOptions` / `mode` before and **after** the engine is on (§9.2 step 2's `avsession` lines) — indicative only; the behaviour
(the Ring / Silent switch on silent → SYNTH still sounds; Music keeps playing when the engine starts) is device-only (§11). If the
app-process reading shows the options dropped, the lane re-applies them once on `{ t: 'engine', on: true }` and notes it in §12; otherwise
native **never re-sets the category while the engine is on** (a category change mid-render can reconfigure the route — a click).

### 5.2 Background audio — **Q2**
`UIBackgroundModes [audio]` keeps the app running while audio plays after the user switches apps or locks the screen [R: iOS]. Whether
**WebKit's AudioContext keeps rendering** inside a backgrounded WKWebView is **[R?]** (Safari pauses Web Audio in the background; a
WKWebView with the audio background mode may not — lane N measures on the simulator: a held note / a playing sequence, Home, 10 s,
foreground, `probe().ctx` and the clock's advance). The page already treats `hidden` as a stop for keys and pads (main.js:8624–8626 [R]) —
with Q2 = yes the sequencer and held notes would carry on by the engine's own state while the page is hidden [R?: `visibilitychange` fires
in a backgrounded WKWebView — pinned the same way]. What lives on the main thread does not carry on reliably: the **metronome** is a
`setInterval(…, 25)` scheduler (main.js:1819 [R]) — throttled or stopped in the background even while the worklet renders; the song's
notes are the engine's (`songData`), the Hold-sustained notes too (`releaseKeys` lets go of finger-held keys only, main.js:4682 [R]). The
lane's measure records the click as well as the clock. Q2 = no: the key is absent, iOS suspends the app ≈ 30 s after it leaves the screen;
sound stops, the project is autosaved (`saveNow()` on `hidden`), everything resumes on return (`wake()` on the first gesture, main.js:8624–8626 [R]).

### 5.3 Interruptions, routes, the idle timer [C]
- **Interruption** (a call, Siri, another app taking the session): WebKit moves the context to `'interrupted'`; the page's `wake()` resumes it
  on the next gesture (main.js:921–927 [R]). Native observes `AVAudioSession.interruptionNotification` and, on `.ended` with `.shouldResume`,
  `setActive(true)` and `SYNTH_SHELL.on({t:"resume"})` (queued until `ready`, §4.3) → main.js `wake()` (§3.2 item 8) — so a
  phone call does not leave the synth silent until the next tap. Reviewer 1 simulates with a second audio app? The simulator cannot ring;
  [R?] device-only (§11).
- **Route change** (headphones in / out, Bluetooth): WebKit follows the route; the output latency changes → the audible clock's drift notice
  ("Audio timing drifted — tap to resync", main.js:959–963 [R]) already covers a mismatch; native does nothing. Device-only (§11).
- **Idle timer** — **Q4**: `UIApplication.shared.isIdleTimerDisabled = true` while the engine is on (`{ t: 'engine', on }`, §3.2 item 4), false
  when off or when the app leaves the foreground. Recommended: a synth whose screen sleeps mid-pad is wrong; the engine-on rule means an
  idle app (powered off) still sleeps normally.
- **Memory warning** (`applicationDidReceiveMemoryWarning` / `UIApplication.didReceiveMemoryWarningNotification`): logged (Debug: to the smoke
  log) — the page keeps its own budgets (cv-face's texture budget, the Serum caps); nothing native to free. Recorded in §11 (jetsam of the
  WebContent process is the real risk, device-only).

### 5.4 Suspend, resume, and the WebContent process [C]
- Backgrounding: the page gets `visibilitychange` → `saveNow()` (400 ms-debounced edits land at once) [R: 8624–8626]; nothing native needed.
  `sceneWillResignActive` / `DidBecomeActive`: the session re-activated (5.1); no reload.
- **WebContent process termination** (`webViewWebContentProcessDidTerminate`, iOS kills it under memory pressure — most often while the
  app sits in the background): the shell dismisses a JS dialog it was showing (calling its completion), closes and deletes open bridge
  transfers (§4.1), reloads `synth://app/index.html` with the marker's `restarted: true` (the user scripts re-injected with the flag, swapped
  back after `ready` — one-shot, §3.1); the page restores the autosave
  (at most the last 400 ms of edits lost — `persist()` main.js:392 [R]) and shows §3.2 item 5's notice. The spike logged this event
  (SpikeViewController.swift:87 [R]) and never saw it on the simulator. Twice within a minute → the shell stops reloading and shows a native
  alert ("SYNTH keeps running out of memory — a smaller project or a lower performance preset may help") with a Reload button.
- The IO buffer / sample rate the device offers → [R?] device-only; recorded by `probe()` (baseLatency / outputLatency / sampleRate) and
  the native `AVAudioSession` numbers in the smoke log and in Help & about's build line (§7.3) so the user's pass reads them without tools.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Full screen, gestures, dialogs (lane N)

### 6.1 Full screen [R: spike §1 "Owns the whole screen" — 1032 × 1376 pt, insets 0, no top blur]
`prefersStatusBarHidden = true` (+ `UIStatusBarHidden`), `prefersHomeIndicatorAutoHidden = true`, `preferredScreenEdgesDeferringSystemGestures
= .all` [C] (the first edge swipe shows the indicator / a hint, the second acts — the Sources pull tab at the left edge, the keyboard's
fold tab at the bottom, the top tray's grip at the top all sit on edges), `scrollView.contentInsetAdjustmentBehavior = .never`,
`scrollView.bounces = false` (no rubber band on the fixed page), the web view pinned to the view's edges (not the safe area). The page's
`env(safe-area-inset-*)` read 0 (spike §1), so the shell's layout equals the Safari page minus the chrome — nothing moves (A4).

### 6.2 Gestures [C]
- **WebKit's page pinch stays** (the viewport meta allows it — index.html:5 `initial-scale=1`, no `user-scalable=no` [R]; the user's rule, the
  Z1 ruling pwa.test.mjs:106–121 [R]): `scrollView.pinchGestureRecognizer` and `isScrollEnabled` untouched (a zoomed page pans as in Safari).
  `gesture.js`'s two-finger layer keeps winning on the canvas (its listeners are the page's, unchanged). Reviewer 1 checks on the simulator
  (`touch2_path` pinch on the canvas → the camera zooms; a pinch on the top tray → WebKit's page zoom, as in Safari).
- `allowsBackForwardNavigationGestures = false`; `allowsLinkPreview = false`; no `UIKeyCommand`s; the web view is first responder after
  load (`becomeFirstResponder()` in `didFinish`) so a hardware keyboard's notes (main.js's `keydown` by code) and ⌘Z reach the page; a
  trackpad's pointer (`pointerType: 'mouse'`, hover) and an Apple Pencil (`'pen'`, pressure → aftertouch, IMPL-1i) are WebKit's own
  pointer events — the same engine as Safari [R?: pressure in a WKWebView — device-only for the Pencil; the trackpad on the simulator's
  Mac pointer counts as a mouse].
- Text selection / loupe / callout: the page's CSS and `selectstart` guard (main.js:8596 [R]) apply unchanged.

### 6.3 Rotation, window sizes [C]
All four orientations (`supportedInterfaceOrientations = .all`, Info.plist §1.3). **No `UIRequiresFullScreen`**: iPadOS 26+ resizes app
windows (Stage Manager, Split View, Slide Over) and the page already relayouts on `resize` (main.js:8659–8661 [R]); "owns the whole screen"
means no browser chrome, not a refusal of multitasking. Reviewer 1 checks 1032 × 1376 both ways and a half-width Split View on the
simulator; sizes below ≈ 700 px wide are the web's responsibility (as narrow browser windows are today).
**The window controls** [R: UIWindowScene.h:115, UISceneWindowingControlStyle.h — iPadOS 26]: a windowed scene (Stage Manager / windowed
apps) shows the system's close / minimise / tile controls at its **top-left — where the ≡ menu button sits** (`#appMenuBtn`,
index.html:53); A4's "insets read 0" holds full screen only. The scene delegate answers `preferredWindowingControlStyle(for:)` with
`.minimal` ("as little of the scene's space as possible"; `if #available(iOS 26, *)`). Whether WebKit then reports the controls through
`env(safe-area-inset-*)` is [R?]; the user's rule forbids moving layout for chrome, so nothing in the page moves. Reviewer 1 records, in a
windowed scene: where the controls sit, whether ≡ can still be tapped, the inset values. If ≡ is covered, the fallback is the spike's
`UIRequiresFullScreen` (spike Info.plist:16 [R]; no windowing — and deprecated for iPadOS 26+ apps [R?]) — **left for the lead**.

### 6.4 JavaScript dialogs [R: §0 — ≈ 30 `alert` / `confirm` / `prompt` sites in seven files; a WKWebView drops them without a delegate]
`WKUIDelegate`: `runJavaScriptAlertPanelWithMessage` / `…ConfirmPanel…` / `…TextInputPanelWithPrompt…` → `UIAlertController(style: .alert)`
with Cancel / OK (the prompt with a text field and the default text; title nil — not the `synth://app` origin). **The completion handler
is called on every path**: WebKit holds the page's main thread until it is (that is what makes `confirm()` synchronous for the page — the
blocking the sites expect), so a missing call freezes the page for good. Presented from the topmost presented controller; when nothing
can present (a share sheet mid-dismissal, the scene not active) it waits in §4.1's presentation queue, and if the web view's process
terminates meanwhile the alert is dismissed with the default answer (alert: done; confirm: false; prompt: nil). While a dialog is up the
page's timers and `evaluateJavaScript` calls wait; the worklet keeps rendering (its own thread).
G8 (reviewer 1): ≡ → New shows the confirm, Cancel keeps the project, OK clears it; a sound's Save asks for a name; an invalid file alerts;
a wavetable's Rename (wtedit.js `win.prompt`) and the reverb conversion (fx-ui.js:2133) answer; the smoke's two back-to-back saves (§9.2
step 5) show two sheets one after the other, nothing lost.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Versioning and updates

### 7.1 Numbers [C]
`CFBundleShortVersionString` = `MARKETING_VERSION` (0.1 for stage A; the user's number from here — bumped by hand in Config.xcconfig when a
build goes to the user); `CFBundleVersion` = the commit count of HEAD stamped by §1.5 step 5 (monotonic across commits — TestFlight needs a
rising integer later, A6); the site's `VERSION` (9) and the commit sha in `app-build.json`. Help & about's line (§3.2 item 6) shows
"SYNTH app 0.1 (412) · site v9 · 0dd10f5 · 2026-10-23" — what the user quotes back.

### 7.2 How a new build reaches the iPad (the free Apple ID) [R: Apple's personal-team rules]
Xcode → the SYNTH scheme → the iPad as destination (cable; the first time: trust the computer on the iPad, and on the iPad Settings → General →
VPN & Device Management → trust the developer certificate; **iPadOS 16+ also requires Developer Mode**: Settings → Privacy & Security →
Developer Mode → on, restart, confirm [R: Apple — without it a development-signed app will not launch]; the Apple ID is added once in
Xcode › Settings › Accounts by the user, §1.2) → Run. The build is **re-signed for 7 days**: after that the icon shows the app
but it will not launch until Xcode runs it again (plug in, Run — ≈ 1 min); **the app's data survives** every reinstall signed by the same
team (IndexedDB across `simctl install` over an existing app, spike §1 — the same container rule on a device [R?]). Free-team limits: ≤ 3
apps installed this way, ≤ 10 app ids a week, no push / iCloud / background-audio *entitlement* needed (background audio is an Info.plist
mode, not an entitlement [R]). The lead's standing step after a web deploy: nothing — the app is updated only when the user rebuilds (or
asks the lead to, with the iPad plugged into the Mac). The paid Program later: TestFlight (90-day builds) / the App Store — the project
changes only in `MARKETING_VERSION` and the team, **but the iPad's copy does not carry over**: the signature's application-identifier is
`<team id>.com.domlavin.synth`, the paid team's id is not the personal team's [R?], and iOS refuses to install a build of another team over
the installed app (MismatchedApplicationIdentifierEntitlement [R]) — the free-team app must be deleted first, **and its projects with it**.
Said to the user before that switch: Save every project to Files first, Open them in the new app (§4.4's path). Whether the paid team can
register `com.domlavin.synth` once a personal team has used it is [R?] — `Local.xcconfig` may override `PRODUCT_BUNDLE_IDENTIFIER` for the
free team should it matter (left for the lead).

### 7.3 In-app updates: off
The web's "Update available — Reload" flow is the service worker's (pwa.js:243–340 [R]); in the shell there is no worker and §3.2's guard
makes it explicit. The app's site is frozen at the commit it was built from — Help & about says which (7.1).

---------------------------------------------------------------------------------------------------------------------------------

## 8. The Mac ("then Mac") — what it costs, and what stage A keeps possible

| route | what runs | cost | verdict |
|---|---|---|---|
| **(a) "Designed for iPad"** on Apple-silicon Macs | the very same iPad app binary in the iOS runtime on the Mac (`SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES`, a "My Mac (Designed for iPad)" run destination) | ≈ 0: the same build; menus / window chrome are the system's; `AVAudioSession` exists in that runtime; touch becomes mouse; pinch = trackpad pinch | **stage A keeps it possible** (the setting on, nothing iPad-only without an availability check); [R?] a personal team may run it on the Mac from Xcode — the lead tries once after the device pass |
| (b) Mac Catalyst | the iPad app recompiled as a Mac app (`SUPPORTS_MACCATALYST = YES`), Mac idiom optional | medium: a second platform in every API call (`UIApplication` idle timer, popovers, the share sheet become Mac-flavoured), signing / notarisation for a Mac build, two test matrices | not recommended |
| (c) a native AppKit shell | `app/mac/` target: `NSWindow` + `WKWebView` + the **shared** `SchemeHandler.swift` / `SiteBundle.swift` / the bridge protocol (WebKit + Foundation only, by design §1.1) + a Mac `FileExport` (`NSSavePanel`) and no AVAudioSession | ≈ 150 lines + the same `app-bundle.sh`; a real Mac app (menu bar, ⌘-keys, Dock, full screen) | **the Mac stage's recommendation**; stage A's rule: the three shared files import nothing from UIKit |
Stage A does (a)'s setting and (c)'s file discipline; nothing else.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Tests, gates, budgets

### 9.1 Node tests (one file at a time, `--max-old-space-size=2048`; new files `import './v8-guard.mjs'` first; `?v=9` imports; never a fake-DOM node in `assert.*`)
| gate | what | file (lane) |
|---|---|---|
| **G1 the shell marker** | `bootMain({ location: { protocol: 'synth:', hostname: 'app', href: 'synth://app/index.html' }, win: { SYNTH_SHELL: {…} } })` (main-sim gains a `win` extra merged into the fake window): Install app and Full screen hidden, the sheet never opens, no `register` call on a fake `navigator.serviceWorker` that **does** exist, no toast after a fake `updatefound`, `app().shell === true`, `persist()` asked once; `SYNTH_SHELL.openFile`, `.probe`, `.on` installed; `probe()` before power-on → `{ ctx: null, nodes: 0, … }`; `early` holds the restart notice when `restarted: true`; the help sheet's App sentence swapped in the shell; `{ t: 'engine', on }` posted once per change (power on, off, a failed power-on); `SHELL.on({ t: 'resume' })` calls `wake()` (a suspended fake context resumed) | `tests/app-shell.test.mjs` (W1) |
| **G1′ the browser half** | the same boot without the marker (`http:`): no `SYNTH_SHELL` member added, the App sentence as committed, `download()` → `saveLink` (one boot per file: a second file) | `tests/app-shell-web.test.mjs` (W1) |
| **G2 files out** | `download()` in the shell posts `file` → n × `chunk` (2 MiB slices with `at`, base64 round-trips to the same bytes, one in flight) → `end` through a fake `SHELL.post`; a rejected `file` / `chunk` reply posts `abort` and falls back to `saveLink`; every main.js caller (Save, Save as classic, Export MIDI, a bounce via `bounceSet` in the sim, render-last, the recovered notice) goes through it; `end` replying `{ ok: true, done: false }` hands the bounce's `later` its retry (the dialog's button reads "Save WAV…"), `done: true` leaves it unused; `SHELL.save` = the same path | `tests/app-shell.test.mjs` (W1) |
| **G3 unchanged for browsers** | app-ios.test, **app.test** (the desktop installed-app layer) and pwa.test's pure-part tests as today (A1): `isStandalone` false for every existing case (pwa.test.mjs:558–568 call it with three arguments), `inShell` false without the marker and for `https:`; `appButtons` unchanged; `tests/app-ios.test.mjs` and `tests/app.test.mjs` pass untouched | existing + `tests/pwa.test.mjs` pure parts (W1 appends cases) |
| **G4 fonts** | `fonts/fonts.css` names the seven files, each present, each a valid woff2 (`wOF2` signature, the length field) and ≤ 400 KB; both OFL texts present and containing "SIL Open Font License"; index.html has **no** `fonts.googleapis.com` / `fonts.gstatic.com` (Q3 (a)); `appRequests().statics` lists the seven woff2 files and `fonts/fonts.css` is versioned; the `url()` crawl skips `url("data:…")` (style.css:1061) and `url(#…)` (433); sw.js has no `FONTS` / `FONT_HOSTS` / `precacheFonts` / `font(`; activate deletes `synth-fonts-v1`; the precache `--write` output equals the committed sw.js (BUILD) | `tests/fonts.test.mjs` (W2) + pwa.test.mjs's font assertions rewritten (W2: 84–86, 238–258, 259–292, 293–300, 437–464) |
| **G5 the app's static contract** | the shell parse of sw.js's two lists (the script's sed / awk, run on the working tree's sw.js) equals `appRequests()` versioned + statics (`./` → index.html); **the git behaviour on a throwaway repo** (`git init` in the scratch dir: a fake sw.js with two lists and a matching BUILD, index.html, two .js — committed): `--dry-run --root` copies exactly the list + `app-build.json` (nothing else of the repo), refuses a dirty listed file, an untracked `x.js`, and a stale BUILD (a listed file edited and committed without the lists' hash), and `SYNTH_ALLOW_DIRTY=1` marks `dirty: true` — independent of the real tree's state (a builder's uncommitted work, the lead's pre-commit sweep); `Info.plist` has the §1.3 keys (`NSCameraUsageDescription` among them) and **not** `NSAppTransportSecurity` / `UIRequiresFullScreen`, `UIBackgroundModes` matches Q2; the Swift sources contain no `URLSession` / `NWListener` / `NWConnection` / `http://` / `https://` outside comments and no KVC `setValue(_:forKey:)` / `value(forKey:)` on WebKit objects (A6); the pbxproj references every `.swift` under `app/ios/SYNTH/` and the Run Script phase calls `tools/app-bundle.sh`; `Config.xcconfig` holds the §1.2 settings and the pbxproj no `DEVELOPMENT_TEAM`; `Local.xcconfig` is gitignored; `Contents.json` names `icon-1024.png` (the PNG itself: pwa.test's icon test, W2) | `tests/app-native.test.mjs` (N) — **not** `tests/app.test.mjs`, which exists (§0) |
| **G6 the web suite** | every existing test file passes in the sweep; the goldens and canonical-stream bit-identical (no engine file touched — A1); lint (every new import `?v=9`; `v8-guard` first) | existing (the lead's sweep) |

### 9.2 The headless smoke: `tools/app-smoke.sh` [C] (lane N; the reviewers and the lead run it; the user never needs it)
```
tools/app-smoke.sh [--udid 6F9F…] [--no-build] [--run <label>] [--base]
```
`--base` (lane N, on 0dd10f5's site: no `SYNTH_SHELL.probe` / `save`, no shell-aware pwa.js, Google Fonts links): only the **native half**
is gated — launch, the request log, the guard (§2.4 item 4, the blocked Google stylesheet loads its positive control), the storage round-trip,
`WKDownload` via an injected `<a download>` of a 1 KB and a 100 MB `blob:`, the bridge via N's own Debug JS implementing §4.1's messages,
the screenshot; the W1 / W2 criteria are reported, not gated. **Full green is the integration's** (the lead's `wt-A` commit).
1. `xcodebuild … -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO SYMROOT=<scratch>/app-build build` (§1.2; ≈ 1 min cold);
   `xcrun simctl boot` if needed (the spike's note: a stale `CoreSimulatorService` can refuse the 27.0 runtime — `killall
   com.apple.CoreSimulator.CoreSimulatorService` fixes it, spike §6 [R]); `simctl install`; `simctl terminate`; `simctl launch <udid>
   com.domlavin.synth -smoke <run>` (Debug reads the launch argument from `UserDefaults`, the spike's `Config` [R: Report.swift:5–11]).
2. The Debug shell, **with `-smoke` only**, appends JSON lines to `Library/Caches/smoke/<run>.jsonl` (not `Documents`: §1.3's
   `UIFileSharingEnabled` shows Documents in the Files app; the smoke reads the file through `simctl get_app_container … data`; the spike's
   `Report`, Report.swift:15–37 [R]): `launch`, every `req` (§2.2), `nav` (didFinish, fails, process termination), `console` (the spike's hook
   as a user script — `console.error` / `warn`, `unhandledrejection` — **plus a capture-phase `error` listener** for failed element loads;
   §2.4 item 4), `guard` (§2.4 item 4 (c)'s negative probe: each attempt and its failure), `avsession` before and after the engine (§5.1),
   `bridge` / `download` (every `file` / `end` / `WKDownload` with the size and the SHA-256 of the received bytes), and `probe`s: at
   didFinish + 2 s, + 6 s, + 15 s the shell runs **`callAsyncJavaScript`** (it awaits; `evaluateJavaScript` cannot return a Promise) for a
   status object: `SYNTH_SHELL.probe()` (§3.2) + `{ secure: isSecureContext, protocol: location.protocol, shell: !!SYNTH_SHELL, keys: #keys
   [data-note] count, install: #install.hidden, fs: #fullscreen.hidden, toast: #update.hidden, fonts: [...document.fonts].map(f => f.family +
   ':' + f.status), interW: a span's width in Inter vs the fallback, resources: performance.getEntriesByType('resource').map(e =>
   e.name).filter(n => !/^(synth:|blob:|data:)/.test(n)) (recorded: WebKit may make no entries for a custom scheme or a blocked load — not
   the guard's proof), build: await (await fetch('app-build.json')).json() }`.
3. **The engine**: synthetic **pointer** events cannot play a key — `#keys`'s `pointerdown` calls `setPointerCapture(e.pointerId)` before
   `noteOn` (main.js:4916–4918 [R]), which throws for a pointer id the browser does not know (Pointer Events: NotFoundError [R?: WebKit
   follows the spec]), and an immediate `pointerup` would release the note before the probe. The smoke uses the computer-keyboard path
   instead: at + 2 s it dispatches `keydown` `{ code: 'KeyA', key: 'a' }` on `window` (the page's listener, main.js:4936 [R], plays by
   `code`; `noteOn` powers the engine itself, main.js:1924 [R]; `resume()` needs no gesture in the shell — spike §1 AudioContext), **holds it**,
   reads `probe()` 1.0 s later → `ctx === 'running'`, `nodes ≥ 1`, `held ≥ 1`, `peak > 0.01` (the held note sounding), `cpu` matches `/DSP load
   \d+%/` (the spike's real tap reached "DSP load 2 % · 0 voices · 1 track" — out/spike-scheme-tap.jsonl [R]), then dispatches `keyup`.
4. **Storage round-trip**: the smoke writes `localStorage.__smoke = run` and an IndexedDB record in a `smoke-db` via `callAsyncJavaScript`,
   then `simctl terminate` + relaunch with `-smoke <run>b` and reads them back (the spike's run-2-reads-run-1 pattern [R]); this second
   launch is the one timed for `nav.finished` (the first after an install also spawns WebKit's processes cold — recorded, not gated).
5. **Files out**: (a) `document.getElementById('fSave').click()` → the bridge → native checks the received file **structurally** (the
   announced size; it parses as JSON with a `tracks` array) — not by re-serialising the project, which is not deterministic (`projectFile()`
   asks a running engine for LFO phases, main.js:2725–2726 [R], and schedules an autosave); (b) **integrity**: the page builds a deterministic
   100 MB blob (`(i * 7) & 255`), digests it with `crypto.subtle`, calls `SYNTH_SHELL.save(blob, 'smoke-100.bin')` (§3.2 item 9) — native's
   SHA-256 of the received file must equal it; time and the WebContent peak recorded (§9.4); (c) two `SYNTH_SHELL.save` calls back to back
   → two sheets in turn (§4.1's queue); (d) a `WKDownload`: an `<a download>` of a small `blob:` (wk.js `saveFile`'s shape) → the sheet. The
   Debug shell auto-dismisses each sheet after 2 s when `-smoke` is set (`simctl` cannot tap), reporting `done: false`.
6. `xcrun simctl io <udid> screenshot <scratch>/app-smoke/<run>.png` (the keyboard, the canvas, no status bar: compared by eye in review; its
   size 2064 × 2752 or 2752 × 2064 — the simulator keeps whatever orientation a reviewer left); the script prints PASS / FAIL with the
   failing keys and the log's path.
**Pass** (full, at integration): `nav.finished` ≤ 2 000 ms after `launch` on the relaunch (spike: ≈ 1 s [R]); 0 `console` / capture-phase
errors (the spike's real-page run had none of the former [R]); every `guard` attempt failed; every `req` 200, all `synth://`, ≥ 98 of them;
`secure` true, `protocol` `synth:`, `shell` true, `keys` ≥ 24 (49 in portrait at 1032 pt; the count follows the window width); `install` /
`fs` / `toast` hidden; `fonts` include `Inter:loaded` and `JetBrains Mono:loaded` and `interW` differs from the fallback (the spike's harness
check [R]); the engine step; the storage step; the files steps; `build.dirty` false and `build.sha` = HEAD; the `.app` ≤ 16 MB; the
WebContent RSS after the engine step ≤ 600 MB — WebKit's XPC services are children of the device's `launchd_sim`, not of the app, and a
prewarmed spare may exist: the **max** RSS over `com.apple.WebKit.WebContent` processes under this UDID's `launchd_sim` (other simulator
apps terminated first) — recorded, gated loosely: jetsam is device-only, §11.

### 9.3 Reviewers (phase 3)
- **Reviewer 1 — the simulator** (the iOS Simulator tool: attach, tap, swipe, two-finger paths, HOME, rotate, screenshot): the smoke green,
  then by hand: a 900 Series preset plays; a pinch on the canvas zooms the canvas and a pinch on the top tray zooms the page as in Safari;
  Sources pull tab at the left edge, the keyboard fold at the bottom, the top grip — each works on the first swipe or shows the system's
  edge hint once; rotation both ways and a Split View width (Stage Manager on the simulator) — **in a windowed scene: where the window
  controls sit relative to ≡, whether ≡ still opens, the `env(safe-area-inset-*)` values** (§6.3); ≡ → New confirm (6.4), Save → the share
  sheet → Save to Files (On My iPad › SYNTH) → Open / Import… → the same project; Export MIDI, Bounce WAV (24-bit, the sheet appears at the
  end without an extra tap; closing it unsaved offers "Save WAV…" without a re-render), render-last; **one export of each module saver
  through `WKDownload`**: an FX rack's Export (wk.js `saveFile`), a Serum shapes / effect-chains export (sx-host.js), a wavetable's Export as
  WAV (wtedit.js) — each reaches the sheet and the app stays on its page; an IR import (fx-ui.js:1858); a `.synth.json` tapped in Files →
  SYNTH opens it (4.3), and one named `it's "x".synth.json` (the name reaches the page intact); Home for 10 s with a sequence playing and the
  click on (Q2's answer confirmed either way), relaunch after terminate → the project restored; kill the WebContent process — **`kill -9`
  of its pid from the Mac** (the max-RSS `com.apple.WebKit.WebContent` under this UDID's `launchd_sim`, §9.2) — **never an allocation loop**:
  in the simulator the WebContent process is a macOS process with no jetsam limit, and the user's Mac has crashed twice from test memory
  blowups (CLAUDE.md) → reload + the notice, the project intact, a second `location.reload()` (the read-only notice's path) without it;
  Help & about shows the build line; `isInspectable` works from Safari on the Mac; **no network**: Debug's request log
  has only `synth://` lines after every flow above; the app's `.app` size; 20 min of play without a reload.
- **Reviewer 2 — the web, unchanged** (headless Chrome at 1440 × 900 / 1366 × 1024 / 1024 × 1366 against the lead's integration tree served by
  `.claude/serve.mjs`, and the node suite's shell files): the fonts render Inter / JetBrains Mono from `fonts/` (no request to Google in the
  network log), the top bar's pixel diff vs the base at 1440 × 900 (the same typeface — a diff ≤ the anti-aliasing noise, recorded); Install
  app / Full screen / the sheet / the SW's update toast exactly as today in a browser (the SW registered, `synth-shell-v9-<BUILD>` precache
  lists the woff2 files, offline reload shows the fonts); `download()` in a browser still `saveLink`s; app-ios.test's standalone share path
  untouched; the goldens and canonical-stream (one file at a time); the bench rows (node) within noise; a review of the Swift sources
  against §2.4 / A6 (no network API, no private API) and of the pbxproj / xcconfig for stray settings.

### 9.4 Budgets
| what | target | how |
|---|---|---|
| launch → `didFinish` | ≤ 2 s on the M4 Max simulator (spike ≈ 1 s) | smoke |
| `didFinish` → 49 keys + `ready` | ≤ 3 s (`probe().bootMs`) | smoke |
| the `.app` | ≤ 16 MB (site 8.5 MB + fonts ≈ 0.73 MB + icon ≈ 0.3 MB + binary) | smoke, `du` |
| WebContent RSS after the engine step | ≤ 600 MB, recorded (the max over the device's WebContent processes, §9.2) | smoke (loose: jetsam is device-only) |
| 100 MB file over the bridge | ≤ 5 s, WebContent peak ≤ +150 MB | lane N measures (§4.1); else the WKDownload refinement |
| a key tap → sound | the same WebKit as Safari: no shell cost; `baseLatency` / `outputLatency` recorded (simulator numbers are not the device's) | probe |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Lanes, schedule, interfaces, docs

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **N** native shell | 1 | `app/ios/**` except `Assets.xcassets/AppIcon.appiconset/icon-1024.png` (W2) — N writes that set's `Contents.json` and builds with an uncommitted placeholder PNG (§1.4); `tools/app-bundle.sh`, `tools/app-smoke.sh`; `tests/app-native.test.mjs` (new — `tests/app.test.mjs` exists and is not N's); `.gitignore` (+ `app/ios/Local.xcconfig`, `app/ios/*.xcodeproj/xcuserdata`, `app/ios/*.xcodeproj/project.xcworkspace/xcuserdata`) | G5, the smoke **`--base`** green on the simulator (§9.2: the native half — W1's seams and W2's fonts do not exist at 0dd10f5), day 1: `WKDownload` of a `blob:` (§4.1), §4.1's 100 MB measure (N's Debug JS), §5.1's category record, §5.2's background measure (both Q2 outcomes tried, the plist set per the answer) | Fable 5.1 |
| **W1** web shell seams | 1 | `pwa.js`, `main.js` (only §3.2's items 1–9), `tests/app-shell.test.mjs`, `tests/app-shell-web.test.mjs` (new), `tests/main-sim.mjs` (the `win` extra, additive and inert when absent — every sim file uses it; §9.1 G1), the pure-part cases appended to `tests/pwa.test.mjs` after line 618 (not its font or icon tests) | G1, G1′, G2, G3 | Opus 5.5 |
| **W2** fonts + icon | 1 | `fonts/**` (the lead drops the seven woff2 + two licence files in **before the lane starts**, after Q3; the lane writes `fonts.css`), `index.html:28–34` (Q3 (a): the fonts lines only), `sw.js` (the fonts code removal only, §3.3; the lead runs `precache --write` at integration), `tools/precache.mjs` (the `url()` crawl), `tools/make-icons.mjs` (opaque PNG mode, the 1024 entry, `decodePng` ctype 2), `app/ios/SYNTH/Assets.xcassets/AppIcon.appiconset/icon-1024.png`, `tests/fonts.test.mjs` (new), `tests/pwa.test.mjs`'s font assertions (line 4 of the header, 84–86 within the index.html test, 238–258's line 245, 259–292, 293–300, 437–464) and its icon test (45–72: the 1024 icon joins `ICONS`) | G4, the icon in pwa.test | Sonnet |
| lead | 0, 2 | before phase 1: the font files into W2's worktree (§3.3); integration on a holding branch `wt-A` (worktrees reset to 0dd10f5), `node tools/precache.mjs --write`, **a commit on `wt-A` before the full smoke** (the bundle is HEAD's, §1.5; a fix round commits again), the full smoke, ROADMAP / HANDOVER | G6, the smoke (full) | — |
| reviewers × 2 | 3 | §9.3 | — | Fable 5.1 (simulator), Opus 5.5 (web) |
| fixers | after | the finding's files, failing test first | | Sonnet / Opus |
| sweep → one squashed commit **"A"** on `canvas` → `tools/deploy-canvas.sh` (the web side: fonts, dormant seams) → the app built from that commit, installed on the simulator by the lead; the user's cable session installs it on the iPad (§7.2) | 4 | | | |

Interfaces (frozen by this contract): the marker's shape (§3.1; `restarted` one-shot); the bridge messages `file` / `chunk` (with `at`) /
`end` / `abort` / `engine` / `ready` (web → native, each replied `{ ok: true }` or `{ ok: false, error }`; `end`'s reply after the sheet
closes: `{ ok: true, done }`), `SYNTH_SHELL.on({ t: 'resume' })` and `SYNTH_SHELL.openFile(name, b64)` (native → web, through
`callAsyncJavaScript` arguments, queued until `ready`); `SYNTH_SHELL.save(blob, name)` (the smoke's); `SYNTH_SHELL.probe()`'s fields (§3.2
item 3, `held` included; no `projectHash`); the navigation policy's order (§2.4: download, allow, cancel); the scheme's map / 404 / query /
MIME rules (§2.1); `app-build.json`'s keys (§1.5); the smoke log's `k` values (§9.2). Rules as every stage: `?v=9` on every import; no
lane commits `sw.js`'s lists (the lead); no lane touches engine / DSP files; W1 and W2 never edit the same lines of pwa.test.mjs (W1
appends after line 618, the file's end; W2 edits inside 1–4, 45–72, 84–86, 238–300 and 437–464).

**Docs to update (the lead, at the end)**: ROADMAP row 12 (stage A done; stage B's list: CoreMIDI, Pencil Pro haptics, the Mac shell;
the user's answers to §Q); HANDOVER §1 (the app exists: `app/ios`, how to build / install, the 7-day rhythm), §2 (the user's app decisions),
§6 (the simulator, the smoke, `Local.xcconfig`); CLAUDE.md (one paragraph: the app is built from the committed tree, `tools/app-smoke.sh`,
never commit `Local.xcconfig`; the fonts are local; `node tools/precache.mjs --write` now covers `fonts/`); SPEC-canvas (a line under §9.4
platform: the app shell).

---------------------------------------------------------------------------------------------------------------------------------

## 11. Known limits (recorded)

Only the real iPad answers (the one consolidated pass; the probe and the Debug log exist for it):
- **Audio latency and buffer**: the simulator's `baseLatency` 2.67 ms / `outputLatency` 0.08 ms and the session's 2.67 ms IO buffer are not
  the device's (spike §5); whether `setPreferredIOBufferDuration` reaches WebKit's AudioContext; speakers / wired / Bluetooth; the Latency
  popover's presets re-measured in the shell.
- **Jetsam**: the WebContent process's memory limit in a WKWebView differs from Safari's (spike §5) — a System 55 at High, a heavy Serum
  project, 20 min of play; the restart path (§5.4) is the net.
- **Storage eviction** with `navigator.storage.persist()` denied (spike §1): the default data store survived relaunch and reinstall on the
  simulator; a device under storage pressure is untested. A native export / backup of the data store is a stage-B option if it bites.
- **Background audio** (§5.2) and `visibilitychange` in a backgrounded WKWebView: measured on the simulator, confirmed on the device.
- **Interruptions and route changes** (§5.3): a real call, real headphones, real Bluetooth.
- **The audio session in WebKit's hands** (§5.1): with the Ring / Silent switch on silent SYNTH still sounds; Music (or a metronome app)
  keeps playing when SYNTH's engine starts (`.mixWithOthers` honoured or not); the `avsession` lines vs what is heard.
- **The camera path** (§1.3, §4.2): the wavetable editor's image import → Take Photo → the permission prompt, no crash.
- **The window controls** (§6.3) in a windowed scene on the real iPad, if the simulator's answer was unclear.
- **The team switch** (§7.2): moving to the paid Program deletes the free-team app and its projects — said to the user before it happens.
- **Apple Pencil**: pressure / hover / aftertouch in a WKWebView (the simulator has no Pencil); haptics are stage B.
- **The edge gestures' feel** with the status bar hidden (`.all` deferral: the first swipe from an edge shows the system's hint); the home
  indicator over the keyboard tray's bottom row.
- **Performance** in the shell vs Safari (the same JavaScriptCore with the JIT, spike §5): `tests/bench.html` is not bundled (§1.5); a shell
  bench is a stage-B item if the user's pass feels different.
Not in stage A (by scope): CoreMIDI (midi.js shows "not supported" — stage B feeds `window.SYNTH_SHELL.midi` through midi.js:247 / 349 / 396
[R]); Pencil Pro haptics (stage B: `UICanvasFeedbackGenerator`, iPadOS 17.5+, the deployment target already allows it); the Mac (§8);
iPhone (`TARGETED_DEVICE_FAMILY = 2`); a document browser, iCloud, in-place saving (§4.3); several windows (`UIApplicationSupportsMultipleScenes`
false); a shell bench page; TestFlight / App Store packaging (nothing blocks it: A6). By design: projects saved in Safari are not in the
app (§4.4); the 7-day re-sign of a free-team build (§7.2); `isInspectable` in Debug only; the Google Fonts request disappears from the web
site only with Q3 (a).

---------------------------------------------------------------------------------------------------------------------------------

## Questions for the user (§Q — recommended option first, ≤ 4)

- **Q1 The app's name under its icon.** (a) **SYNTH** — recommended (short, the site's name; the home screen cuts names past ≈ 12
  characters); (b) another name (e.g. "SYNTH Canvas", as the installed web app is called today).
- **Q2 Keep playing when you leave the app?** (a) **Yes** — recommended: a held drone or a running sequence keeps sounding when you switch to
  another app or lock the screen (the app declares background audio; whether WebKit keeps rendering is measured first — if it cannot,
  nothing changes and we say so); (b) No — the sound stops when the app leaves the screen, as the web page does today.
- **Q3 The fonts on the web site too?** (a) **Yes** — recommended: the two typefaces move into the site's own files (they are open-licensed), so
  canvas.domlavin.com stops asking Google for them (faster first paint on a slow connection, no third-party request, the installed web app
  shows the real fonts offline) and the app and the site share one path; the look is the same typeface. (b) No — only the app bundles
  them; the web keeps Google Fonts (two code paths to maintain).
- **Q4 Keep the screen awake while the engine is on?** (a) **Yes** — recommended: the iPad does not dim or lock while SYNTH's power is on
  (an idle, powered-off app still sleeps normally); (b) No — the iPad's own auto-lock applies, as in Safari.

(Settled, not asked: the custom scheme, the whole-screen shell, no network, no TestFlight yet, the bridge for files, Open from Files, the
Mac via a native shell later, haptics / CoreMIDI in stage B, `.mixWithOthers` (best effort: WebKit may override it, §5.1), no
`UIRequiresFullScreen` (unless the window controls cover ≡ — the lead's call, §6.3).)

---------------------------------------------------------------------------------------------------------------------------------

## 12. Notes (the builders fill in)

### Lane N

### Lane W1

### Lane W2

### Reviews and fixes

### Acceptance

## 13. Review log

### The skeptic review (2026-10-23, against the draft)

Every claim about existing code was read at 0dd10f5 (`canvas`, read only); the spike's Swift, Info.plist and jsonl were read, not re-run;
API existence checked in the Xcode 27.1 SDK headers (WebKit, UIKit) only; no test, build or simulator run. Severity as IMPL-M §13: **P1** a
contract contradiction, an impossible / vacuous gate, a crash or a risk to the user's machine; **P2** a gap a builder would trip on;
**P3** a correction. **Settled and not reopened**: the scope paragraph, the custom scheme, the whole-screen shell, no network, the bridge
for `download()`, Open from Files, the Mac route, stage B's list. §Q unchanged (Q1–Q4 as drafted, none added).

**The brief's ten questions, answered.** (1) **The web build**: the seams stay dormant in every browser (#41); the leaks were in the
tests, not the page — an existing `tests/app.test.mjs` the draft would overwrite (#2), pwa.test font assertions nobody owned (#16).
(2) **The bundle**: the sed / awk parse is sound (writeSw's own format, and a node test of the same parse), but a missed `precache
--write` was a silent 404 in the app (#8), the dry-run test depended on the tree being committed (#9), and the run-script details (#35).
(3) **Offline**: the two guards are right; the *proof* was vacuous — WebKit's block messages never reach `console.error` (#7); nothing
the app needs is blocked (#41). (4) **Files**: three module savers bypass `download()` and would have been cancelled (#4); the camera
crash (#5); sheets and dialogs need one queue (#19); base64 / back-pressure / size are fine with the details of #29, #30. (5) **Dialogs**:
the delegate covers every site (≈ 30, not 24, #23) and WebKit's completion handler *is* the page's synchronous return — the risk is a
completion never called (#19). (6) **Audio / lifecycle**: whether the host's category reaches WebKit's output is unknowable on the
simulator and has no public API (#12); background keeps the engine's notes, not the main thread's metronome (#31); `restarted` must be
one-shot (#22). (7) **Gestures**: as drafted, plus iPadOS 26's window controls over ≡ (#13). (8) **Signing**: the Xcode UI writes the team
into the pbxproj, Developer Mode was missing (#11), a team switch costs the iPad's projects (#10). (9) **Gates**: the engine step could not
pass (#1), the base-site gate could not pass (#3), the file hash was not deterministic (#15), the RSS / orientation / timing details
(#33, #34). (10) **Lanes**: the test-file collision (#2), the icon set needed by N's builds (#21), W1's seam list one short (#27), the
fonts needed before W2 starts (#38).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **The smoke's engine step cannot pass.** A synthetic `pointerdown` reaches `#keys`'s listener, which calls `setPointerCapture(e.pointerId)` before `noteOn` — a pointer id the browser never saw throws (Pointer Events: NotFoundError [R?: WebKit follows the spec]); and `pointerup` at once releases the note before the 1.5 s probe reads `peak` (the spike's "DSP load" came from a *real* tap) | main.js:4912–4918; spike out/spike-scheme-tap.jsonl | **fixed in §9.2 step 3**: `keydown KeyA` on `window` (main.js:4936, plays by `code`; `noteOn` powers on, 1924), held, probed after 1 s (`held` joins `probe()`), then `keyup` |
| 2 · P1 | **`tests/app.test.mjs` already exists** (331 lines, owner I: the desktop installed-app layer); the draft gave lane N a "new" file of that name — an overwrite or a merge conflict, and G3 never listed it | tests/app.test.mjs:1–8 | **fixed in §0, §1.5, §9.1 G3 / G5, §10**: N's file is `tests/app-native.test.mjs`; app.test joins G3 (passes untouched) |
| 3 · P1 | **Lane N's gate "the smoke green with the base site" is impossible**: the pass list needs W1's `SYNTH_SHELL.probe()` and shell-aware pwa.js (Install hidden) and W2's local fonts — none exist at 0dd10f5, whose index.html still asks Google | §9.2 pass list (draft); index.html:28–34; pwa.js:121–124 | **fixed in §9.2, §10**: `--base` gates the native half (log, guard — the blocked Google loads its positive control —, storage, `WKDownload`, a bridge driven by N's Debug JS); full green is the integration's, after a `wt-A` commit |
| 4 · P1 | **Nine export actions bypass `download()`**: wk.js `saveFile` (FX rack / chain exports, Serum shapes), sx-host.js's `download` (chains, shapes), wtedit.js's `download` (wavetable WAV / zip / .256) each click their own `<a download>` of a `blob:` — §2.4's draft policy cancels a non-`synth:` main-frame navigation, so in the shell they silently do nothing; G2's "every caller goes through it" was false | wk.js:2925–2941 (fx-ui.js:2290, 2366, 2368; graph.js:483); sx-host.js:1218–1227 (3667, 4039); wtedit.js:1212–1232 | **fixed in §0, §2.4, §4.1, §9.2 step 5 (d), §9.3**: `shouldPerformDownload` → `.download` first (WKNavigationAction.h:83, WKNavigationDelegate.h:52 — iOS 14.5), `WKDownload` mandatory → the same sheet; N pins `blob:` downloads on day 1 — **left for the lead**: one-line seams in the three files if WebKit refuses them |
| 5 · P1 | **A camera crash the simulator cannot show**: the wavetable editor's image picker (`.png,image/png`) makes WebKit's iOS upload menu offer *Take Photo*; without `NSCameraUsageDescription` (the draft: "no usage-description keys") the system kills the app on that tap [R?: device-only; the simulator has no camera] | wtedit.js:1079; §1.3 (draft) | **fixed in §1.3, §4.2, §9.1 G5, §11**: the key added, G5 asserts it, the device pass tries it |
| 6 · P1 | **Reviewer 1's `SYNTH_SHELL.crash()` "allocation loop"** runs in the simulator's WebContent process — a macOS process with no jetsam limit: an unbounded allocation on the user's Mac, which has crashed twice from test memory blowups | CLAUDE.md (tests: memory safety); §9.3 (draft) | **fixed in §9.3**: `kill -9` of the device's WebContent pid from the Mac; never an allocation loop |
| 7 · P2 | **The "no network" proof was vacuous.** WebKit's own messages (a content-blocker block, CORS, a failed load) go to Web Inspector, never through the page's `console.error`; the spike's hook wraps `console.*` and listens for `error` in the bubble phase (element load errors do not bubble); WebKit may make no resource-timing entry for a blocked or custom-scheme load. "Blocked → console error → FAIL" could never fire | SpikeViewController.swift:108–116; §2.4 item 4, A2, §9.2 (draft) | **fixed in A2, §2.4 item 4, §9.2**: the scheme log (only `synth://`), a capture-phase `error` listener, an active negative probe under `-smoke` (page + Worker `fetch`, an `http://` image, a `wss://` socket — each must fail), the base tree's blocked Google links as the positive control; `resources` recorded only |
| 8 · P2 | **A missed `precache --write` is a silent 404 in the app**: the build has no node, pwa.test catches stale lists only in the sweep, and the bundle copies exactly sw.js's lists | §1.5 (draft); tests/pwa.test.mjs:123–130; precache.mjs:77–84 | **fixed in §1.5 step 2**: the lists from `git show HEAD:sw.js`; `BUILD` recomputed with `shasum -a 256` by `buildHash`'s formula over HEAD's bytes — a mismatch refuses the build (an added import changes a listed file, so it cannot slip by) |
| 9 · P2 | **G5's dry-run depended on the real tree being committed**: it fails on every builder's uncommitted work and on the lead's pre-commit sweep; "dirties a scratch worktree" adds a worktree of the whole repo per run | §9.1 G5 (draft) | **fixed in §1.5, §9.1 G5**: the parse equality on the working tree's sw.js (pure); the git behaviours (copy set, dirty, untracked, stale BUILD, `SYNTH_ALLOW_DIRTY`) on a throwaway `git init` repo via `--root` |
| 10 · P2 | **A team switch deletes the iPad's projects**: the signature's application-identifier is `<team>.com.domlavin.synth`; iOS refuses to install another team's build over it (MismatchedApplicationIdentifierEntitlement), so the paid Program's first build means deleting the free-team app and its IndexedDB. The draft said "nothing changes except the team" | §7.2 (draft); A5 | **fixed in §7.2, §11** (said to the user before the switch: Save every project first) — **left for the lead**: whether `com.domlavin.synth` stays registrable by the paid team once a personal team used it [R?] (`Local.xcconfig` may override the id for the free team) |
| 11 · P2 | **Signing as drafted needs Xcode clicks that dirty the repo**: picking the team in Signing & Capabilities writes `DEVELOPMENT_TEAM` into `project.pbxproj`, not `Local.xcconfig`; iPadOS 16+ will not launch a development build without **Developer Mode**; the Apple ID sign-in is the user's (a password) | §1.2, §7.2 (draft) | **fixed in §1.2, §7.2, §9.1 G5**: the user adds the Apple ID once; the lead reads the team id (`defaults read com.apple.dt.Xcode IDEProvisioningTeams` [R?]) into `Local.xcconfig`; `xcodebuild -allowProvisioningUpdates` + `xcrun devicectl device install app` [R?]; Developer Mode in the steps; G5: no `DEVELOPMENT_TEAM` in the pbxproj |
| 12 · P2 | **The host's audio session may not govern WebKit's output**: WebKit renders Web Audio in its own process and drives the session from `navigator.audioSession.type` — the page sets `'playback'` at power-on and `'auto'` at power-off; WebKit has no public audio-session API; so `.mixWithOthers` may be dropped and the app-process `AVAudioSession` reading may not reflect WebKit's session at all. The spike read the session before any audio | main.js:903–907, 1050; WebKit.framework/Headers (no audio-session API); spike out/spike-scheme-3.jsonl (`avsession` at launch) | **fixed in A7, §5.1, §11, the settled list**: [R?] said; the smoke's record is indicative; the silent-switch and Music checks are device-only; native never re-sets the category while the engine is on |
| 13 · P2 | **iPadOS 26's window controls sit at a windowed scene's top-left — over the ≡ button**; without `UIRequiresFullScreen` the app can be windowed, and A4's "insets read 0" holds full screen only | UIWindowScene.h:115; UISceneWindowingControlStyle.h; index.html:53 | **fixed in §6.3, §9.3, §11**: `preferredWindowingControlStyle(for:)` → `.minimal`; reviewer 1 records the controls, ≡ and the insets in a windowed scene — **left for the lead**: `UIRequiresFullScreen` (the spike's, Info.plist:16) if ≡ is covered (nothing in the page moves: the user's rule) |
| 14 · P2 | **Case sensitivity was inverted**: the iPad's file system is case-sensitive, the Mac's (the simulator's) is not by default [R?] — a wrong-case path the simulator forgives 404s on the device | §2.1 (draft); spike Report.swift:71–80 (`fileExists`) | **fixed in §2.1**: resolution through a map of `site/` built once at launch — exact case everywhere; traversal impossible by construction |
| 15 · P2 | **The smoke's file hash was not deterministic**: `projectFile()` asks a running engine for LFO phases (the engine is on since step 3) and schedules an autosave; two serialisations need not match. And `probe().projectHash` froze a field for it | main.js:2725–2726, syncPhases; §9.2 step 5 (draft) | **fixed in §3.2 item 9, §9.2 step 5, §10**: Save checked structurally; integrity by `SYNTH_SHELL.save` of a deterministic 100 MB blob, the page's `crypto.subtle` digest vs native's SHA-256; `projectHash` dropped |
| 16 · P2 | **pwa.test font assertions nobody owned** break under Q3 (a): the install test's `synth-fonts-v1` (245) and the activate test's "the fonts cache stays" (293–300), plus the header; removing `FONTS` also makes activation delete `synth-fonts-v1` (the PREFIX rule) — fine, but it must be said and tested | tests/pwa.test.mjs:4, 238–258, 293–300; sw.js:62, 124 | **fixed in §3.3, §9.1 G4, §10**: W2 owns those lines; the cleanup is deliberate and asserted |
| 17 · P2 | **The variable Inter is not Google's Inter at large sizes**: Inter 4's variable file carries an `opsz` axis (14–32) [R?] that `font-optical-sizing: auto` drives from the font size; style.css sets 15–34 px text; Google's `wght`-only request serves opsz-14 instances | style.css (font-size 15–34 px, 26 / 34 px); index.html:32 | **fixed in §3.3, §9.1 G4, §9.4**: the five static text instances (`Inter-Regular` … `-ExtraBold`), seven woff2 in all, ≈ 0.73 MB (the variable file + `font-optical-sizing: none` in style.css is the alternative — a file no lane owns) |
| 18 · P2 | **Open in SYNTH built JS from a file name**: `evaluateJavaScript('SYNTH_SHELL.openFile(…)')` with a user-controlled name runs a quote in the name as code, and puts up to 85 MB of base64 into the parser as a literal | §4.3 (draft) | **fixed in §4.3, §5.3, §10**: `callAsyncJavaScript` with arguments (WKWebView.h:363, iOS 14); every native → web call queued until `ready`; reviewer 1 opens a file named with quotes |
| 19 · P2 | **One presentation at a time, and a completion on every path**: a second share sheet (Export All, a double tap, a `WKDownload` landing) is refused by UIKit and the file lost; a JS dialog that cannot present never calls its completion — WebKit then holds the page's main thread for good | §4.1, §6.4 (draft) | **fixed in §4.1, §6.4, §5.4**: a presentation queue from the topmost controller; defaults on termination; the smoke's two back-to-back saves |
| 20 · P2 | **The user's device build is Debug** (Xcode's Run), so compile-flag-only smoke behaviour would ship to the iPad — and the draft's log lived in `Documents`, which `UIFileSharingEnabled` shows in the Files app | §1.2, §1.3, §9.2 step 2 (draft) | **fixed in §1.2, §2.2, §9.2**: every `-DSMOKE` behaviour also needs the `-smoke` argument; the log in `Library/Caches/smoke/` |
| 21 · P2 | **N's builds need the AppIcon set W2 owned**: with `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` and no set, every N build fails in actool [R?]; and W2's "append after N lands" serialised two parallel lanes | §1.4, §10 (draft) | **fixed in §1.4, §9.1 G5, §10**: N writes `Contents.json` and builds with an uncommitted placeholder; W2 writes only the PNG and checks it in pwa.test's icon test (45–72, `ICONS` gains the 1024 entry) |
| 22 · P2 | **`restarted` stuck on**: a user script is fixed per load, so after a WebContent restart every later `location.reload()` — the read-only notice's Reload — would announce a restart again | main.js:99; §3.1, §5.4 (draft) | **fixed in §3.1, §5.4**: one-shot — native swaps the user scripts back after `ready` |
| 23 · P3 | The dialog sites: ≈ 30 in seven files, not 24 in two (main.js 4460, 4570, 6461, 7944, 7961; fx-ui.js:2133; sx-host.js:1274; sx-ui-osc.js:194; wtedit.js:951, 968, 1047; wk.js:2962; the hosts' `confirm` 2190, 2249, 8429); the file-input list likewise | grep of the site | **fixed in §0, §6.4** (G8 adds a wtedit prompt and the reverb confirm) |
| 24 · P3 | §5.1 cited "(G4)" (the fonts gate) for the session record | §5.1 (draft) | **fixed**: §9.2 step 2's `avsession` lines |
| 25 · P3 | `{ t: 'engine', on }` posted at two sites misses powerOn's failure path and `resync` | main.js:1016–1027, 1356, 964 | **fixed in §3.2 item 4**: from `powerUI()` on a change of `!!(ctx \|\| pendCtx)` |
| 26 · P3 | `inShell(globalThis, location)` throws in a harness without `location` | main.js:107 (the guarded form) | **fixed in §3.2** |
| 27 · P3 | W1 owned "§3.2's seven items", but §5.3's `SHELL.on` resume needed an eighth seam (and #15 a ninth) | §3.2, §5.3, §10 (draft) | **fixed**: items 8 (`on`), 9 (`save`); W1 owns 1–9 |
| 28 · P3 | G1's "and not in a browser" needs a second boot (one boot per test file) | tests/main-sim.mjs:28 | **fixed in §9.1**: G1′ in `tests/app-shell-web.test.mjs` |
| 29 · P3 | Bridge details: a script message cannot carry an ArrayBuffer (base64 is forced); `String.fromCharCode(...)` over 2 MiB overflows JSC's argument limit and node has no FileReader; no offset check, no `abort` flow, a page-controlled name used as a path, no free-space check, no cleanup on termination | §4.1 (draft) | **fixed in §4.1, §5.4, §10** (32 KiB `apply` + `btoa`, `toBase64` when present; `at`; `abort`; `lastPathComponent`; space; cleanup) |
| 30 · P3 | A sheet closed unsaved after a long bounce meant a re-render (the PWA keeps "Save WAV…"); and "100 MB ≈ 4 min" at 96 kHz / 32-bit float is ≈ 2 min 10 s (768 kB/s) | main.js:4643–4647; §4.1 (draft) | **fixed in §4.1, G2**: `end` replies after the sheet closes, `{ ok, done }`; `done: false` → `later(go)` |
| 31 · P3 | Q2's background measure: the metronome is a main-thread `setInterval` — throttled in the background even if the worklet renders; Hold-sustained notes and the song are the engine's | main.js:1819, 4682, 8624 | **fixed in §5.2** (the measure records the click) |
| 32 · P3 | The smoke's status object awaited `fetch` — `evaluateJavaScript` cannot return a Promise | §9.2 step 2 (draft) | **fixed**: `callAsyncJavaScript` |
| 33 · P3 | "`ps` of the WebContent child of the app": WebKit's XPC services are children of the device's `launchd_sim`, and a prewarmed spare may exist | §9.2 (draft) | **fixed in §9.2, §9.4**: the max over this UDID's WebContent processes |
| 34 · P3 | `keys 49` and the 2064 × 2752 screenshot hold in portrait only (the simulator keeps a reviewer's rotation); the first launch after an install spawns WebKit cold | §9.2 (draft) | **fixed in §9.2**: `keys ≥ 24`, either size; the relaunch is timed |
| 35 · P3 | Run Script details: `mkdir -p` after `rm -rf`; every path quoted (the repo folder has spaces); a bare `'*.js'` pathspec also matches tests/ and tools/; the Info.plist stamp needs the processed plist as a declared input to be ordered; Info.plist is not a bundle resource; Release wants `dwarf-with-dsym` | §1.2, §1.5 (draft) | **fixed in §1.2, §1.5** |
| 36 · P3 | WKWebView details: the reply handler in the `.page` world; `isFraudulentWebsiteWarningEnabled = false`; `underPageBackgroundColor`; `createWebViewWith` → nil; `navigationResponse` `!canShowMIMEType` → download | WKPreferences.h:53; WKWebView.h:629 | **fixed in §2.3, §2.4** |
| 37 · P3 | The `url()` crawl must read quoted forms and skip style.css:1061's `url("data:…")` (its SVG namespace is an `http://` string, not a load) | style.css:433, 1061 | **fixed in §3.3, G4** |
| 38 · P3 | W2 cannot run G4 without the font files, and the draft dropped them in "after Q3" with no phase | §3.3, §10 (draft) | **fixed**: the lead's phase 0 puts them in W2's worktree |
| 39 · P3 | Q3 (b) also keeps two `preconnect`s, sockets a content rule may not cover (a preconnect is not a resource load [R?]) — one more reason for (a) | index.html:28–29 | **fixed in §3.3** (Q3's text unchanged) |
| 40 · P3 | Pickers: an unknown extension (`.scl`) maps to a dynamic type — selectable or not is [R?]; the IR picker was missing from the review list | fx-ui.js:1858; main.js:3243 | **fixed in §4.2, §9.3** |
| 41 · fine | **The web side holds A1**: `inShell` needs the marker or `synth:`; pwa.test.mjs:558–568's three-argument `isStandalone` calls stay false; app.test / app-ios.test unaffected; main-sim's `location.protocol 'http:'` keeps `SHELL` null in every sim; lint's one-`?v=` rule takes `fonts/fonts.css?v=9`; pwa.test's every-site-`.js` rule ignores woff2; no engine / DSP file → the goldens and canonical-stream by construction. The content-rule JSON contains no literal `http://` / `https://` (G5's grep stands); the site navigates nowhere external (only index.html:17–34's metas name a host); the handler's ignored query keeps `?v=`, `?dev=1`, `?run=` | pwa.js:121–126, 308–309; tests/main-sim.mjs:318; tests/lint.test.mjs:85; tests/pwa.test.mjs:133–135; grep of the site | — |
| 42 · fine | Open from Files is small and serves §4.4's migration; `public.json` is the right claim (a `.synth.json` cannot get its own UTI — the last extension decides); the scheme handler's threading and `stop` rule; the free-team limits and background audio as an Info.plist mode | §4.3; spike SchemeHandler.swift:7–27 | — |

**Counts**: 6 P1 · 16 P2 · 18 P3 · 2 fine. Every P1–P3 is fixed in the text above. **Left for the lead**: the three module savers'
seams if `WKDownload` refuses `blob:` downloads (#4); `UIRequiresFullScreen` if the window controls cover ≡ (#13); the free-team bundle
id (#10); telling the user, before any paid-Program switch, that the iPad's app projects must be saved to Files first (#10).
