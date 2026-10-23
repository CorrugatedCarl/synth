# SPIKE — the standalone iPad app (ROADMAP 12): which loading strategy, and what it proves

2026-10-23. A throwaway UIKit app (`SYNTHSpike`, bundle `com.domlavin.synth.spike`, this folder) wraps a `git archive canvas`
snapshot of the site (87 files, 8.9 MB, tests / docs / tools removed) in one full-screen `WKWebView` and loads it three ways,
chosen by a launch argument. A harness page in the bundle (`site/__spike/harness.html`) probes every capability the app needs
and posts each result to native (`webkit.messageHandlers.spike`), which appends it to `Documents/spike-<mode>-<run>.jsonl`
(copies in `out/`; screenshots in `shots/`). Built with Xcode 27.1 for the simulator "SYNTH iPad Pro 13" (iPad Pro 13-inch M5,
iOS 27.0), unsigned (`CODE_SIGNING_ALLOWED=NO`). Nothing in the repo was changed.

## 1. Results — strategy × capability

Modes: **(a) scheme** = `WKURLSchemeHandler`, `synth://app/<path>?v=9` (query ignored for the lookup, real MIME types);
**(b) file** = `loadFileURL(_:allowingReadAccessTo:)`; **(c) http** = `NWListener` HTTP/1.1 file server on `127.0.0.1:47123`;
plus **(b′) filex** = (b) with WebKit's private `allowFileAccessFromFileURLs` / `allowUniversalAccessFromFileURLs` (KVC — not
App Store safe), run once to know whether the usual workaround helps.

| Capability | (a) scheme `synth://app` | (b) file `file://` | (b′) filex | (c) http `127.0.0.1:47123` |
|---|---|---|---|---|
| `window.isSecureContext` | **true** | true | true | **true** |
| `location.origin` (the storage key) | `synth://app` (stable) | `file://` | `file://` | `http://127.0.0.1:47123` (**the port is part of it**) |
| ES module `import()` with `?v=9` (tuning, appstore, fx-core → laws, seq-core, patch-core → moog-core) | **pass** (0–10 ms each) | **FAIL** — "Cross-origin script load denied by CORS" (file: is an opaque origin) | pass | **pass** |
| `fetch()` of bundle files (+ `Content-Type`, 404) | **pass** — text/javascript, text/css, image/png, manifest+json; 404 for a missing file | **FAIL** — "Load failed" | caveat — status 0, no content-type; a missing file throws | **pass** (same as a) |
| Workers (`wtwork.js` / `smpwork.js` module, `smprender.js` classic, `?v=9`) | **pass** | FAIL (worker error) | pass | **pass** |
| `audioWorklet.addModule` — the 17 DSP scripts + engine.js, direct, in main.js's order | **pass, all 18 direct**, 57–74 ms total | pass (!) — WebKit fetches worklet scripts from file: | pass | **pass**, 97–104 ms total |
| The engine renders (`synth-engine` node, DEFAULT_PATCH shape, two notes, AnalyserNode) | **pass** — `ready` 1.23 s (JIT warm-up), peak 0.67, RMS −10.1 dBFS, 24/24 windows non-silent, stats voices 2, load 7 % | pass — −10.0 dBFS, 24/24 (the engine runs; the page around it does not) | pass — −10.1 dBFS | **pass** — −10.2 dBFS, 24/24 |
| main.js's blob fallback (`addModule(blob:)`, `new Worker(blob:)`) | **pass** (`blob:synth://app/…`) — dormant, never needed | n/a (fetch fails) | — | **pass** |
| WebGL2 | **pass** — "Apple GPU", GLSL ES 3.00, max texture 8192, EXT_color_buffer_float | pass | pass | **pass** |
| IndexedDB write / read-back (`spike-db`) | **pass** | pass | pass | **pass** |
| IndexedDB after terminate + relaunch (run 2 reads run 1's stamp) | **pass** | pass | — | **pass** |
| IndexedDB after an app reinstall (`simctl install` over it; the data container's UUID changed twice) | **pass** (run 3 read run 2, run 4 read run 3) | pass | — | **pass** |
| localStorage across relaunch | **pass** | pass | pass | **pass** |
| `navigator.storage.persist()` | not granted (false; data persisted anyway) | false | false | false |
| A bundled font via `@font-face` (`__spike/fonts/test.ttf`) | **pass** — `document.fonts.load` 1 face, width differs from the fallback | pass | pass | **pass** |
| Inter / JetBrains Mono available without the Google CSS | **absent** (system fallbacks render) | absent | absent | absent |
| Service worker | `navigator.serviceWorker` **absent** — pwa.js skips registration, no toast, nothing breaks | absent | absent | absent (a WKWebView only exposes SW to app-bound domains) |
| `navigator.requestMIDIAccess` | **undefined** (midi.js shows "MIDI: not supported in this browser") | undefined | undefined | undefined |
| AudioContext (no gesture — `mediaTypesRequiringUserActionForPlayback = []`) | **new → suspended, `resume()` → running**; 48 000 Hz, `baseLatency` 2.67 ms (128 frames), `outputLatency` 0.083 ms (simulator) | same | same | same |
| AVAudioSession (native, `.playback`, preferred IO buffer 5 ms) | 48 000 Hz, ioBuffer 2.67 ms, outputLatency 0.1 ms, route Speaker (simulator numbers) | same | same | same |
| The real `index.html` | **boots**: 98 requests, all 200 (95 js, 1 html, 1 css, 1 manifest), 8.07 MB, launch → didFinish ≈ 1 s, keyboard 49 keys, no console errors; a real key tap powered the engine ("DSP load 2 % · 0 voices · 1 track") | shell paints, **main.js's module graph never loads** (0 keys) | not run | **boots** (same as a) |
| Owns the whole screen | **yes** — 1032 × 1376 pt, safe-area insets 0, status bar hidden, no top-edge blur (shots/scheme-app.png, scheme-3.png) | yes | yes | yes |
| Google Fonts in the real app | fetched live from fonts.gstatic.com (the simulator has network) — bypasses the handler, so **offline = fallbacks** | same | same | same |

Evidence: `out/spike-scheme-{1,2,3,4,app,app2,tap}.jsonl`, `out/spike-file-{1,2,3,app}.jsonl`, `out/spike-filex-3.jsonl`,
`out/spike-http-{1,2,3,4,app}.jsonl`; `shots/*.png`. Runs 1–2 had a partial patch (PatchP zeroes `poly`, `level`, `bw` → silent);
runs 3–4 send the engine's full default shape. Other environment facts (all modes): UA
`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` (no `Version/… Safari/`), `platform`
MacIntel, `maxTouchPoints` 5 (so pwa.js `platform()` → ios / ipad true, browser 'other'; main.js `isIOS()` true), `navigator.audioSession`
present, `SharedArrayBuffer` undefined, `crossOriginIsolated` false, Fullscreen API absent, `display-mode: browser`, `wakeLock` present,
storage estimate quota 10.3 GB, CSS `overflow: clip` / `container-type` / `dvh` all supported (`platformProblem()` is quiet).

## 2. Recommendation: (a) the custom scheme `synth://app/`

Reasons:
- Everything the app needs passes, identically to http — modules with `?v=`, fetch with MIME types, module + classic Workers,
  all 18 worklet scripts direct (no fallback ever taken), the engine renders, WebGL2, IndexedDB persisting across relaunch and
  reinstall, bundled fonts.
- **A stable origin**: `synth://app` never changes, so appstore's `synth-canvas` / `-wt` / `-smp` databases live under one origin
  for the life of the app. With (c) the port is part of the origin: the port must be fixed forever and can collide (a port in use
  → either a different origin = all projects "gone", or no app) — a real risk on a Mac, and on iPadOS another app could hold it.
- **No process to keep alive**: a scheme handler is called by WebKit on demand; an `NWListener` has to be up before the first load
  and across every background / foreground cycle (iPadOS may tear down sockets of a suspended app → a reload while suspended
  fails), and plain-HTTP traffic on loopback is visible to other apps on the Mac.
- No private API (unlike filex) and no service-worker surprises (none in a WKWebView unless `WKAppBoundDomains` is set — don't).
- The handler sees every request (the spike's request log) — a free place to count / time / add headers; the http server is more code
  (a 60-line HTTP parser) for no gain. (b) `file://` is dead: CORS kills every module import, fetch and Worker; the filex workaround
  needs private preferences and still returns status-0 fetches.

Risks / caveats of (a): `blob:synth://app/…` and `URL.createObjectURL` work, but exotic APIs may treat a custom scheme as
non-HTTP(S) (none hit so far; `isSecureContext` is true). The spike's handler is synchronous on the main thread (fine at 8 MB; the
stage should answer from a background queue and honour `stop`). Downloads (`<a download>` for Save / Save as classic / Export MIDI /
Bounce WAV) were **not tested** and need native handling in any strategy (`WKDownloadDelegate` → Files / share sheet); `<input
type="file">` (Open / Import…) is WebKit's document picker (untested here).

## 3. What must change in the web code for the app

1. **Fonts offline** (the user's requirement). `index.html` :28–34 preconnects to fonts.googleapis.com / fonts.gstatic.com and loads
   `css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600` three ways (preload, print-swap stylesheet,
   noscript); `style.css` :8–9 names `'Inter'` / `'JetBrains Mono'` with system fallbacks. Offline the links fail silently and the
   fallbacks render (the harness: Inter / JetBrains Mono absent). For the app: add the OFL woff2 files to the repo (e.g.
   `fonts/inter-{400,500,600,700,800}.woff2`, `fonts/jetbrains-mono-{400,600}.woff2`, latin at least) and a local `fonts.css?v=N`
   with `@font-face` rules (`font-display: swap`), and point index.html at it. The web site can use the same local files (one less
   third-party origin, sw.js's `synth-fonts-v1` cache becomes unnecessary) — the lead's call; the spike did not download fonts
   (no permission to fetch files), only proved that a bundled `@font-face` file loads under each scheme.
2. **A shell marker and the install buttons.** In the shell pwa.js's `appButtons` leaves **"Install app" visible** in the ≡ menu
   (`installHidden: false`: `sheetFor(platform)` is true for an iPad, `standalone` is false — `display-mode` is `browser` and
   `navigator.standalone` false); "Full screen" is hidden (no Fullscreen API). The native shell should declare itself — a
   `WKUserScript` at document start setting e.g. `window.SYNTH_SHELL = { os: 'ipados', version }` (and/or the page checks
   `location.protocol === 'synth:'`) — and pwa.js treats a shell as installed (`standalone: true` → no Install / Full screen, no
   install sheet, no `beforeinstallprompt`, no update toast; app updates arrive as app releases).
3. **Service worker**: nothing to change — `navigator.serviceWorker` does not exist in a WKWebView and pwa.js already guards
   `swc && typeof swc.register === 'function' && swAllowed(loc)` (`swAllowed` is false for `synth:` anyway). Keep it that way: never
   set `WKAppBoundDomains`.
4. **addModule's blob fallback**: leave as is — never taken under (a); it works if ever needed (`blob:synth://app/…`).
5. **Storage / origin naming**: no rename needed. `synth://app` is its own origin, so the app's `synth-canvas` databases are separate
   from canvas.domlavin.com's and from Safari's (projects cross over by Save / Open, as the install sheet's note already says).
   `navigator.storage.persist()` is not granted in a WKWebView: the default `WKWebsiteDataStore` is persistent and survived
   relaunches and reinstalls here, but **eviction policy on a device is an open question** (§5) — the app could add a native
   export / backup of the data store later if needed.
6. **MIDI**: `requestMIDIAccess` is undefined (confirmed) — midi.js's existing "not supported" path shows. A CoreMIDI bridge is
   native work (§5); midi.js's host shape (`nav.requestMIDIAccess` checked in three places: :247, :349, :396) is the seam to feed a
   shim through `window.SYNTH_SHELL.midi` later.
7. **Audio start**: with `mediaTypesRequiringUserActionForPlayback = []` an AudioContext resumes without a gesture; the app's own
   "Press Power or play a key" flow keeps working unchanged (a real tap powered the engine). The native side sets
   `AVAudioSession` `.playback` (+ `UIBackgroundModes audio`) — sound with the mute switch on and in the background, which the
   web app cannot do; `navigator.audioSession` exists too.
8. **Downloads / files**: Save, Save as classic, Export MIDI, Bounce WAV are `<a download>`-style — they need the shell's
   `WKDownloadDelegate` (iOS 14.5+) writing to the app's Documents (visible in Files with `UIFileSharingEnabled` +
   `LSSupportsOpeningDocumentsInPlace`) or a share sheet. Untested in the spike.
9. Cosmetic: `apple-mobile-web-app-*` metas, the manifest and `theme-color` are inert in the shell; `viewport-fit=cover` is already
   there (insets are 0 with the status bar hidden). `CNAME` and `sw.js` can stay in the bundle (harmless) or be excluded.

## 4. The Xcode project shape for the real stage

- **Where**: `app/ios/SYNTH.xcodeproj` (+ `app/ios/SYNTH/` sources, ~200 lines of Swift: AppDelegate / SceneDelegate, one
  view controller, the scheme handler, a message bridge, later CoreMIDI + haptics). UIKit (a scene-based app with
  `UIApplicationSceneManifest`; the spike's files are a working template: `SYNTHSpike/*.swift`, `Info.plist`, `project.pbxproj`).
  Bundle id `com.domlavin.synth`; iPad only (`TARGETED_DEVICE_FAMILY = 2`), `IPHONEOS_DEPLOYMENT_TARGET` 17.5 (Pencil Pro haptics
  need 17.5; `isInspectable` 16.4). A Mac target later shares the sources (a native macOS `WKWebView` app, or Catalyst).
- **How the site gets in**: never a second copy in git. A **Run Script build phase** `tools/app-bundle.sh` (with
  `ENABLE_USER_SCRIPT_SANDBOXING = NO` or declared inputs) that copies the **committed** site — `git -C "$SRCROOT/../.." archive HEAD`
  minus `tests/ docs/ tools/ .github CLAUDE.md README.md` (the same "committed only" rule as `tools/deploy-canvas.sh`) — into
  `$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/site`, and writes `site/app-build.json` (`{ sha, date, version }`) for Help
  & about. The spike used a blue folder reference (`site` in Resources) instead — fine for a throwaway, wrong for the repo (it
  needs the files on disk next to the project). A lint/test can assert the bundled list equals sw.js's precache list.
- **WKWebView configuration** (all verified here): `setURLSchemeHandler(_, forURLScheme: "synth")`, `websiteDataStore = .default()`,
  `allowsInlineMediaPlayback = true`, `mediaTypesRequiringUserActionForPlayback = []`, `scrollView.contentInsetAdjustmentBehavior =
  .never`, `bounces = false`, `isInspectable = true` in Debug; `prefersStatusBarHidden`, `prefersHomeIndicatorAutoHidden`,
  `UIRequiresFullScreen`, all iPad orientations; `UIBackgroundModes: audio`; `AVAudioSession` `.playback`. Add
  `preferredScreenEdgesDeferringSystemGestures` (top / bottom) so the first edge swipe doesn't fire system gestures over the trays.
- **Distribution** (its own scoping, as the ROADMAP says): a free Apple ID installs to the user's own iPad for 7 days at a time;
  a paid developer account gives TestFlight (90-day builds) and the App Store. Signing was out of scope here.

## 5. Open questions only a real iPad can answer

- **Audio latency**: the simulator reports `baseLatency` 2.67 ms / `outputLatency` 0.08 ms and an AVAudioSession IO buffer of
  2.67 ms — meaningless for the device. Measure on the iPad: `baseLatency` + `outputLatency`, the session's `outputLatency` /
  `ioBufferDuration` with speakers, wired and Bluetooth, and whether `setPreferredIOBufferDuration` / `setPreferredSampleRate`
  from the shell change what WebKit's AudioContext gets (the web app can't ask for either).
- **Performance / thermal**: a WKWebView uses the same JavaScriptCore with the JIT as Safari, so the bench rows should match the
  Safari `"ipad…"` rows — run `tests/bench.html` inside the shell to confirm, and watch the WebContent process's memory limit
  (jetsam differs from Safari's) on a System 55 patch at High.
- **Apple Pencil Pro haptics**: `UICanvasFeedbackGenerator` (iPadOS 17.5+) from a JS → native message on key / pad / long-press
  when `pointerType === 'pen'` — the bridge's round-trip latency and whether the feel is right.
- **CoreMIDI**: a native client + input port posting packets to the page (a `window.SYNTH_SHELL.midi` shim behind midi.js's three
  `requestMIDIAccess` checks); Bluetooth MIDI pairing UI; whether `evaluateJavaScript` per packet is fast enough or a batched
  `MessagePort` is needed.
- **Storage eviction** with `persist()` denied, background audio really continuing, the edge-gesture / home-indicator behaviour
  with the status bar hidden, and the device's real GPU limits (max texture 8192 in the simulator).

## 6. How to rerun

`./run.sh <scheme|file|filex|http> <run> [page] [wait s]` (builds not included): installs nothing — build with
`xcodebuild -project SYNTHSpike.xcodeproj -target SYNTHSpike -sdk iphonesimulator -arch arm64 CODE_SIGNING_ALLOWED=NO
SYMROOT=$PWD/build OBJROOT=$PWD/build/obj build`, then `xcrun simctl install 6F9F14F6-… build/Debug-iphonesimulator/SYNTHSpike.app`.
The app is still installed on the simulator (`xcrun simctl uninstall 6F9F14F6-CF76-4FDF-95BD-6890E098069B com.domlavin.synth.spike`
removes it). Note: `simctl boot` failed at first ("iOS 27.0 runtime not available / runtime path not found") because a stale
user-level CoreSimulatorService held an old cryptex mount path; `killall com.apple.CoreSimulator.CoreSimulatorService` fixed it.
