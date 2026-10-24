# Stage B: hardware MIDI in the iPad app — CoreMIDI behind a Web MIDI shim (IMPL-B) — contract

ROADMAP row 12, stage B of the standalone app. **Scope (the user's decisions, 2026-10-23 — settled, not re-asked)**: "do the midi. no need
for a mac version"; Apple Pencil haptics **dropped**. So stage B = **MIDI controllers and other MIDI apps play SYNTH in the iPad app**: the
WKWebView has no Web MIDI (`navigator.requestMIDIAccess` undefined — spike §1, confirmed [R: spike-app.md:36]; midi.js shows "MIDI: not
supported in this browser" [R: midi.js:349]), so the app bridges **CoreMIDI** into the page behind a **Web MIDI polyfill** that midi.js
runs on **unchanged**. Everything stage A settled stands (IMPL-A: the scheme, A1–A7, the bridge, `ready`, the smoke, the free-team install,
no per-stage iPad session — one real-device pass after the features). No Mac shell, no haptics, no App Store work.

**Code references are to `canvas` at d461f7d** (the builders' base; line numbers move, names don't). Tags: **[R]** a fact (file:line or
SDK header), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an
[R]). SDK = `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk`, cited "MIDIServices.h:n"
(CoreMIDI.framework/Headers) etc. Process (the user's lean shape): this contract → skeptic review → the user's §Q → three builders in
worktrees reset to d461f7d with exclusive files (§10) → integration on `wt-B` → two reviewers → failing-test-first fixers → one sweep (node,
one file at a time, `--max-old-space-size=2048`) → one squashed commit "B" on `canvas` → `tools/deploy-canvas.sh` (the web side: three
strings) → the app built from that commit, smoke-green on the simulator, installed on the user's iPad at their next cable session.

**One fact that shapes the stage**: the user **has no MIDI controller yet** (ROADMAP.md:69 "CC + MIDI learn not tried (no controller)";
ROADMAP.md:29 "the user's hands-on once they have a controller" [R]). So the proof is the simulator's **virtual ports** (§8) and, on the
iPad, **another app sending MIDI to SYNTH** (§2.4, **Q2**) — a free MIDI-keyboard app is the user's first controller.

**The user's answers (2026-10-23 — settled)**: Q1 MIDI gear: **none yet** — the first test is a MIDI-keyboard app on the iPad (the
"From other apps" path), hardware later; Q2 **yes** — other apps may send MIDI into SYNTH (the virtual destination "SYNTH", the input
"From other apps"); Q3 **yes** — in-app Bluetooth pairing (⚙ → App → "Pair a Bluetooth MIDI device…").
**The lead's decisions on the skeptic's open items (2026-10-23)**: #16 the first-test how-to goes in HANDOVER and the lead's message to
the user (Split View / Slide Over or a key played in SYNTH first; pick SYNTH as the keyboard app's output, not both; Panic for a stuck
note); #10 lane S owns the one `o.beforeImport` line in `tests/main-sim.mjs`; #11 lane M amends the two stage-A app-native assertions
(the Bluetooth key, the Swift file list) and records them in IMPL-A §12; #5 / #16 **a fourth web string**: the ⚙ "Sound in background"
hint gains other apps (lane W); #7 if day 1 finds no MIDI server in the simulator, the below-the-server smoke is accepted and the server
path moves to the iPad pass.

**Invariants**
- **B1 Browsers untouched** (IMPL-A's A1 continued): `midi.js` is **byte-identical** (the shim lives in the app bundle, not in the site —
  §1.1); the site changes are exactly **three strings** (index.html's help sentence, cv-pads.js's `NO_MIDI`, main.js's ⚙ row + `probe().midi`,
  the ⚙ row and the `probe()` field inert without `SHELL`, the counters behind it harmless in browsers — §6) and nothing else; no DSP / engine / model file is touched (engine.js, `*-dsp.js`, `sx-*.js`,
  `*-core.js`, song.js, cv-*.js except the one cv-pads.js string): every golden and canonical-stream bit-identical by construction and
  still run in the sweep. tests/midi.test.mjs, canvas-8-sim and pads-core.test pass untouched.
- **B2 Web MIDI semantics, no more.** The shim implements what the Web MIDI spec says for the surface SYNTH uses (§1.2) — ids, names, state,
  statechange, `midimessage` with `data` + `timeStamp` in the page's `performance.now()` clock, `send` — so that a future Chrome-tested
  midi.js change works in the app without a shim change. **No SysEx** (SYNTH never asks: midi.js:354 "no options: no SysEx" [R]; refused if
  asked, §1.2), no MIDI clock to the page (§2.3), no new app-only API in the page.
- **B3 Offline stays absolute** (A2): no Network MIDI session, no `import Network`, no CoreBluetooth code of ours (the system's pairing sheet
  only, §4); G-tests grep for it. CoreMIDI, CoreAudioKit, UIKit, WebKit, Foundation, os — Apple's frameworks only (A6).
- **B4 One call per batch, never per message.** Native → page MIDI goes through **one** `callAsyncJavaScript` per coalesced batch (§3.2); a
  lone note is not delayed by the coalescing; a 1 kHz stream never makes 1 000 calls a second; backpressure thins controllers, never notes.
- **B5 Nothing stuck.** Every path that stops delivery (the app leaving the screen with Sound in background off, a port unplugged or
  offline, a WebContent restart, a buffer overflow) releases what it was holding — per sounding channel **sustain up (CC 64 = 0) if it was
  down, the bend centred if it was bent, then CC 123** (§3.4 / §5.1) — a MIDI key held when the cable comes out must not drone, **with the
  pedal down too** (review #4).
- **B6 Timestamps are the page's.** `MIDIMessageEvent.timeStamp` is in the page's `performance.now()` domain, within the budget of §9
  (recording places a MIDI note where Chrome would: main.js `recTick(ts)` → `outFrame(ts)` [R: main.js:1684, 1693–1698, 1870]) — **a busy
  page delays the delivery, never the stamp** (Chrome's stamp is CoreMIDI's packet time, untouched by the renderer's main thread; review #3).
  The host clock enters the page only as each batch's dispatch time `h`, read by the shim's offset estimate (§1.3) and nothing else.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists

| piece | where [R] | B |
|---|---|---|
| **Web MIDI in the site = midi.js's adapter, three seams**: `learnPad` :247 (`!nav.requestMIDIAccess` → null at once), `enable()` :347–372 (:349 the unsupported button; :354 `await nav.requestMIDIAccess()` — **no options**; :356–365 `hook()`: `for (const inp of m.inputs.values()) { inp.onmidimessage = e => message(e.data, e.timeStamp, portName(inp)); if (inp.state !== 'disconnected') names.push(inp.name); }`, the button text / title, `H.ports(live(m.inputs).map(portName))`; :366 `hook(); m.onstatechange = hook;`; :367–371 a rejection → 'MIDI blocked — click to retry'), `wire()` :394–406 (:396 unsupported → `enable()` once; :397 the button's click; :399–403 `nav.permissions.query({ name: 'midi' })` → `granted` → `enable()`, `s.onchange`, `.catch(() => {})`); `live(m)` :211 keeps ports whose `state !== 'disconnected'` (Chrome keeps an unplugged input in the map, R2-F11); `navOf` :203 reads `globalThis.navigator` **lazily**; `inputs()` / `outputs()` :377–378 names; `send(port, bytes)` :379–393 validates (status ≥ 0x80, not 0xF0, data < 128) and calls `o.send(b)` **without a timestamp** on every output of that **name** | midi.js | §1: the shim implements exactly this surface; midi.js unchanged (B1) |
| What SYNTH does with a message: `decode` :32–43 — note on / off (velocity 0 = off), poly pressure, CC, bend, channel pressure, program change; **system and real-time messages → null** (no clock, no SPP, no sysex); `message()` :304–342 — pad learn / `padIn` first, then notes → `H.noteOn / noteOff(n, …, ch, ts)`, CC → learn / `modCC` / wheel (1) / sustain (64) / All Notes Off (120, 123) / MPE 74 · 10 / `mapCC`, bend / pressure → MPE or `ctl`, PC → `programChange` | midi.js:32–43, 304–342 | the shim forwards channel voice + the rare system commons; drops F8 clock and FE active sensing natively (§2.3) |
| The host (main.js): `createMidi({…})` :2941–2963 — `noteOn(n, v, src, ts)` → :1928 `noteOn(n, v, src = 0, ts = performance.now(), …)`, `noteOff` :1945, `ctl` :1965; **`ts` is used for recording only**: `recStart(tr, key, n, v, ts)` :1870 → `recTick(ts)` :1693 → `outFrame(perfTs)` :1684 (`AC.outFrame(CLK, ctx, perfTs, now)` — the song position heard at perf time ts), `recCC` :1890–1892, the Serum clip recorder `(ts - g.t0) / 1000` :2012–2020, the Pads host's `inputSubs` :2005; sound is **not** scheduled by ts (a note plays on arrival); `heldNotes(src)` :1958; `releaseKeys()` :4809 (finger-held keys only — "a MIDI or tray note still sounds" :2298); `blur` :5139 and `visibilitychange` :8766–8769 release the on-screen holds; `midiOk()` :2219 = `typeof navigator.requestMIDIAccess === 'function'`; the Pads host :2256–2257 `learnPad / midiOk / inputs / outputs / hwOut → midi.send`; `midi.wire()` at the end of `boot()` :8810, **before** `{ t: 'bg' }` + `{ t: 'ready' }` :8828 — but `boot()` is synchronous (:8730, called
at :8869) and `wire()`'s `permissions.query(…).then(… enable())` runs only after it returns, so the page posts **`ready` first, then the
shim's `{ t: 'midi', on: true }`** [R]; `noteOn` of a key already held = its note-off first, then the note-on (a doubled note
retriggers, never sticks — :1931); `held` is keyed `src:n` with src = the **channel** (:1917), so CC 123 on a channel releases that channel's notes
from **every** port [R]; `ctl('sus')` posts `{ t: 'sus', v }` and the engine holds released voices while it is down; `setModUI` / `setBendUI` :5187, :8798–8799 (the tray wheels) | main.js | §1.3 timestamps; §3.4 the release rule; §6 `probe().midi` |
| The UI: `#midi` "Enable MIDI" (title "Ask the browser for access to your MIDI controllers") index.html:274; "Assign MIDI channels" :166; the Controllers view (Pads) :231–233; the help: "Or plug in a MIDI controller **(Chrome, Edge, Firefox)** — each track listens on its MIDI channel." :291; cv-pads.js: `NO_MIDI` :64 "Hardware pad controllers need a browser with Web MIDI — Chrome or Edge on a Mac. iPad browsers have none.", the learn row hidden without `HS.midi()` :1021, the menu item disabled :1167, `inputs()` for the footers' dots :752, `outputs()` :1143, `hwOut` :396 (lights), `ports(names)` :432; pads bind hardware by **port name** + ch + n (`p.hw.port`, pads-core.js:471) — persisted in the project | index.html; cv-pads.js; pads-core.js | §6: the three strings; the hardware UI appears in the app by itself (`midiOk()` true) |
| Tests: midi.test.mjs — the adapter on stub navigators (:714–747 hot-plug re-hook; :844–860 `rig()` with `inputs` / `outputs` Maps + `onstatechange`; :1062 outputs / send; :1093 no Web MIDI; **:1120 `assert.doesNotMatch(code, /requestMIDIAccess\([^)]/)`** — midi.js must never pass options); canvas-8-sim.test.mjs:282–293 `fakeMidi()` (`navigator.requestMIDIAccess = async () => F.A`, `inp.onmidimessage({ data, timeStamp })`); main-sim.mjs:328 `o.win` merged into the fake window (the marker), :333–336 the fake navigator (**no `permissions`**) — defined **after**
the `o.win` merge (:337) and followed by `await import(main.js)` (:358): **no caller hook runs between the navigator and the boot**
(canvas-8-sim installs its fake after boot and calls `api.midi.enable()` itself, :293) [R]; app-shell.test.mjs:179–192 reads ⚙'s rows
(`'H3:App', 'DIV:Sound in backgroundOn', 'P:Keep playing when you switch apps'` — an exact `deepEqual` of the tail, :184); app-native.test.mjs:152
asserts **`NSBluetoothAlwaysUsageDescription` absent** from Info.plist and :158 the **exact** Swift file list [R] | tests/ | §7: the new files reuse these fakes and patterns |
| The shell (stage A): the marker `window.SYNTH_SHELL = Object.assign({…}, { post })` as a `WKUserScript` at document start, main frame, plus Smoke.js under `-smoke` (`installUserScripts`, both the `restarted: false / true` installs); the bridge `webkit.messageHandlers.synth` with reply (`Bridge.swift` :31–80 — `file / chunk / end / abort / engine / ready / bg / log`, replies `{ ok: true, … }` / `{ ok: false, error }`; a script message carries no ArrayBuffer — IMPL-A §4.1); native → web only through `call(body, args)` = `callAsyncJavaScript(_, arguments:, in: nil, in: .page)` :249–251, queued by `whenReady` :248 (`ready` set by `{ t: 'ready' }` :239–244); `foreground` + `backgroundAudio` :26–27, :279–289 — **`foreground` is the scene's *active* state** (`sceneActive` ← App.swift:34–35
`sceneDidBecomeActive` / `sceneWillResignActive`: false under Control Center, a notification pull, the app switcher's drag, a system
alert), the background state is a separate call (`sceneBackground` ← App.swift:36–37) that the page's `hidden` follows [R]; termination → `ready = false`, `pending.removeAll()`, reload with `restarted: true` :146–167; the Presenter (one queue for sheets and dialogs; a popover from the web view's top centre) FileExport.swift:8–23, :93–99; Smoke: `Smoke.on` / `drives`, `js(k, body, args)` steps logging `ms` per call, `__smoke.*` in Smoke.js | app/ios/SYNTH/ShellViewController.swift:68, 87–98, 146–167, 239–252, 279–289; Bridge.swift; FileExport.swift; Smoke.swift:12–23; SmokeSteps.swift:21–54; Smoke.js:55–120 | §3 the new messages ride the same bridge; §8 the smoke's MIDI steps |
| **Measured in stage A** (IMPL-A §12 N): backgrounded with Sound in background on, **WebKit keeps rendering**, the page's main thread runs (native → web `callAsyncJavaScript` kept answering; `DSP load` kept updating), **timers throttle to ≈ 1 Hz**, `visibilitychange` fires; the bridge moved 100 MB in 50 chunks in ≈ 200 ms page-side (≈ 4 ms per 2 MiB web → native → web round trip incl. base64 decode); a WebContent `kill -9` → the page back in 405 ms; a JS dialog **holds the page's thread** until answered (§6.4) — every `callAsyncJavaScript` waits meanwhile | IMPL-A.md §12 "Lane N" (§5.2 measured, §4.1 the bridge, §5.4), §6.4 | §3.2 the batch design; §5 the background rule; the per-call cost of a **tiny** native → web call is **[R?]** — lane M pins it day 1 (§3.2) |
| Info.plist / build: `UIBackgroundModes [audio]` :46–47; usage keys camera :67, microphone :70; **no Bluetooth key**; `IPHONEOS_DEPLOYMENT_TARGET = 17.5` (Config.xcconfig:14); `-DSMOKE` Debug only :29; `EXCLUDED_SOURCE_FILE_NAMES[config=Release] = Smoke.js` :31; the pbxproj's Frameworks phase is empty :41 (Swift auto-links imported frameworks); Smoke.js a Resource :20, :37; app-native.test's Swift greps (no URLSession / Network / http / KVC; the three shared files UIKit-free) :158–168, the frozen interfaces :171–227, the pbxproj :232–247 | app/ios/SYNTH/Info.plist; app/ios/Config.xcconfig; app/ios/SYNTH.xcodeproj/project.pbxproj; tests/app-native.test.mjs | §4.1 the plist key; §7 B5 |
| **CoreMIDI (iOS SDK)**: `MIDIClientCreateWithBlock` (ios 9) MIDIServices.h:1437–1458 — "notifyBlock is called **on a thread chosen by
the implementation**. Thread-safety is the block's responsibility" (:1451; the run-loop promise is `MIDIClientCreate`'s proc only, :1426);
a virtual destination whose `kMIDIPropertyAdvanceScheduleTimeMuSec` is 0 (the default) "**receives its messages at their scheduled delivery
time**" — the server holds a future-stamped send to it (:914–931); `MIDIReceiveBlock`'s `srcConnRefCon` is the refCon given to
`MIDIPortConnectSource` (:350–367) — a virtual destination's block gets none (its closure must carry the id); `MIDIInputPortCreateWithProtocol(client, name, protocol, &port, receiveBlock)` (ios 14) :1485–1516 — "The system will **automatically convert to this protocol** as needed"; "readBlock will be called on a **separate high-priority thread owned by CoreMIDI**"; `MIDIReceiveBlock(evtlist, srcConnRefCon)` :350–367; `MIDIPortConnectSource(port, source, refCon)` :1632–1647; `MIDIGetNumberOfSources / MIDIGetSource` :1828–1850, destinations :1862–1876; `MIDIOutputPortCreate` :1586–1609, `MIDISendEventList(port, dest, evtlist)` :2401–2406; virtual endpoints `MIDIDestinationCreateWithProtocol(client, name, protocol, &dest, readBlock)` :1931–1935, `MIDISourceCreateWithProtocol` :2052 + `MIDIReceivedEventList(src, evtlist)` :2521–2525, `MIDIEndpointDispose` :2101; `MIDIClientDispose` **can make later client creates fail** :1462–1479 (never called); properties `kMIDIPropertyName / Manufacturer / Model / UniqueID` :812–860, `kMIDIPropertyDisplayName` :1341–1350 ("the Apple-recommended user-visible name … combining the device and endpoint names"), `kMIDIPropertyOffline` :992–1000, `kMIDIPropertyPrivate` :1003–1011, `kMIDIPropertyProtocolID` :1353–1361; `MIDIObjectGetStringProperty` :2201, `…IntegerProperty` :2159, `MIDIEndpointGetEntity` :1892, `MIDIEntityGetDevice` :1811–1821; notifications `kMIDIMsgSetupChanged / ObjectAdded / ObjectRemoved / PropertyChanged` :694–717, `MIDIObjectAddRemoveNotification { parent, parentType, child, childType }` :762–771; `MIDIUniqueID` = SInt32 :291; **`MIDITimeStamp` = host clock, `mach_absolute_time()`** :253–263 | MIDIServices.h | §2 |
| UMP event lists: `MIDIEventPacket { timeStamp, wordCount, words[64] }` :481–487, `MIDIEventList { protocol, numPackets, packet[] }` :522–528, `MIDIEventPacketNext` :2600–2605, `MIDIEventListInit(evtlist, protocol)` :2619–2620, `MIDIEventListAdd(evtlist, listSize, curPacket, time, wordCount, words)` :2655–2660; message types `Utility 0x0 (1 word), System 0x1 (1), ChannelVoice1 0x2 (1), SysEx 0x3 (2), ChannelVoice2 0x4 (2), Data128 0x5 (4)` MIDIMessages.h:32–37
**and `FlexData 0xD (4)`, `Stream 0xF (4)` :38–40** (a packet may carry several UMPs of mixed sizes), `MIDIMessageTypeForUPWord` :259, `MIDI1UPChannelVoiceMessage(group, status, channel, d1, d2)` :276–277 (+ NoteOn / ControlChange … :281–308; a system word :312), `MIDIEventListForEachEvent` + `MIDIUniversalMessage` :590–776 (an alternative to hand-parsing) | MIDIServices.h; MIDIMessages.h | §2.3 the UMP → bytes rule |
| Bluetooth / network: `CABTMIDICentralViewController : UITableViewController` (ios 8, unavailable macOS) — the system's BLE MIDI pairing list; `MIDIBluetoothDriverActivateAllConnections` (ios 16) is the CoreBluetooth-driven route (steps 1–6: scan / connect with CoreBluetooth yourself) — **not used** (B3); `MIDINetworkSession.defaultSession.enabled` **default NO** :113, `connectionPolicy` :117 — never touched (B3) | CoreAudioKit/CABTMIDICentralViewController.h; CoreMIDI/MIDIBluetoothConnection.h; MIDINetworkSession.h:110–117 | §4 |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The shim — a Web MIDI polyfill in the shell only (lane S)

### 1.1 Where it runs [C]: a `WKUserScript` from the bundle, not a site module
`app/ios/SYNTH/MidiShim.js` — a classic script (an IIFE, `'use strict'`, no `import`), added by `installUserScripts` **after the marker and
in both installs** (`restarted` false / true), `.atDocumentStart`, `forMainFrameOnly: true`; a bundle **Resource in Release too** (unlike
Smoke.js — not in `EXCLUDED_SOURCE_FILE_NAMES`). Why not W-lane code in midi.js gated on `SYNTH_SHELL`:
- **B1 by construction**: midi.js stays byte-identical (midi.test.mjs:1120's rule, the adapter tests, canvas-8-sim's fake all untouched);
  the web precache does not grow by an app-only module (the IMPL-A §3.3 (b) argument: the site would precache a file it never runs, or the
  lists grow a third kind);
- **one version pair**: the shim ships with the native half it talks to (the protocol of §3 is frozen between two files in one folder —
  `MidiShim.js` ↔ `Midi.swift`); a site build from any commit runs on it, since the site only sees `navigator.requestMIDIAccess`;
- **it runs before any module**: `midiOk()` (main.js:2219) and midi.js's lazy `navOf()` (:203) see `requestMIDIAccess` whenever they look —
  a document-start script is the one place that is true for every reader; and workers / worklets never see it (they don't need to).
Cost: the shim is tested in node by **evaluating the file's text** against a fake window (§7 B1) — as app-native tests the Swift by grep.

### 1.2 The surface [C], faithful to Web MIDI where SYNTH touches it (B2)
```js
navigator.requestMIDIAccess(opts?) → Promise<MIDIAccess>
  // one shared MIDIAccess per page (a second call resolves the same object); opts.sysex === true → reject DOMException('…', 'SecurityError')
  // (SYNTH never asks — midi.js:354; honest refusal beats a silent lie); opts.software ignored. The first call posts { t: 'midi', on: true }
  // (§3.1) and resolves on its reply (the current port list); a refused reply → reject (midi.js shows 'MIDI blocked — click to retry').
  // Only a FULFILLED access is cached: after a rejection the next call posts again (midi.js's retry button, :367–371 / :397, must work).
MIDIAccess extends EventTarget: inputs: Map<id, MIDIInput>, outputs: Map<id, MIDIOutput> (plain Maps — midi.js:211 reads `.values()`;
  insertion = first-seen order, which is the order midi.js names the ports on the button), sysexEnabled: false, onstatechange
  (+ addEventListener('statechange')): a MIDIConnectionEvent { port } per changed port — a `state` change OR a `connection` change
MIDIPort extends EventTarget: id (String(uniqueID)), name (kMIDIPropertyDisplayName), manufacturer, version: '', type 'input' | 'output',
  state 'connected' | 'disconnected', connection 'closed' | 'open' | 'pending' (the spec's: onmidimessage set, a 'midimessage' listener
  added, or open() → 'open' on a connected port, 'pending' on a disconnected one — midi.js's hook() re-sets onmidimessage on disconnected
  inputs too, :360 —; a pending port that comes back → 'open'; an open port that goes away → 'pending'; close() → 'closed' and stops
  delivery to this port), open() / close() → Promise<this>, onstatechange. Every state / connection change fires `statechange` on the port
  and on the access **queued (`queueMicrotask`), never inside the setter** — Chrome posts the implicit open as a task, and a synchronous
  event would re-enter midi.js's hook() mid-loop; so midi.js runs hook() 1 + (inputs) times after enable, as in Chrome [C] (a microtask,
  not `setTimeout`: a hidden WKWebView throttles timers to ≈ 1 Hz, IMPL-A §12 N)
MIDIInput: onmidimessage (+ addEventListener('midimessage')): an Event 'midimessage' with own props data (Uint8Array, 1–3 bytes) and
  timeStamp (DOMHighResTimeStamp, §1.3) — Object.defineProperty on the instance (Event.prototype.timeStamp is a getter); dispatched with
  `dispatchEvent` (the handler property is a listener like any other), so a throwing listener is reported and never cuts the rest of
  the batch short
MIDIOutput: send(data, timestamp?) — validates as the spec (a TypeError for a byte > 255 / a data byte ≥ 0x80 / a missing status; a
  DOMException 'InvalidAccessError' for 0xF0 / 0xF7 — no sysex); `data` may hold several complete messages (the spec's sequence) — split
  by status length, one post each; posts { t: 'midi-send', id, b: Array.from(bytes), delay } (§3.1 — a plain Array: a script message
  carries no typed array, IMPL-A §4.1; delay = max(0, timestamp - performance.now()) ms, 0 when absent — midi.js:390 passes none); errors
  in the reply are swallowed (a light is only a light, midi.js:374–376); clear() is a no-op
navigator.permissions.query({ name: 'midi' }) → Promise<{ state: 'granted', onchange: null, addEventListener() {} }>; every other name
  → the original query (created if navigator.permissions is absent — the node sim). WebKit rejects the 'midi' name [R?: WebKit's
  Permissions API knows no 'midi'; lane S pins in the simulator] → without this wrap midi.js:399–403 never auto-enables and the user would
  tap "Enable MIDI" every launch. With it: boot → wire() → granted → enable() → the button reads "MIDI: <names>" by itself (no permission
  exists for CoreMIDI; Bluetooth asks its own, §4.1).
SYNTH_SHELL.midiIn(b), SYNTH_SHELL.midiPorts(list, gen)   // native → page entry points (§3.1), defined by the shim on the marker object
```
Port objects are **stable per id**: a port that goes away stays in its Map with `state: 'disconnected'` (Chrome's behaviour, which midi.js
:211 / :360 already handle); the same id coming back flips the same object to `'connected'`. **A list is the whole truth: a known id absent
from it is `'disconnected'`** (native never has to report a removal "once"; a restarted page simply never sees it). Lists carry native's
`gen` (a counter); the shim applies a list only if its `gen` is newer than the last one applied — the `midi` reply and a hot-plug
`midiPorts` travel on different channels (§3.1), so either may land first. A list that arrives before the access resolves updates the Maps
silently (no events: nobody can listen yet). An unknown id in a batch is ignored (a hot-plug list is on its way). Delivery honours
`connection` and the handlers, **not `state`**: a port the page closed, or whose `onmidimessage` is null and has no listener, drops its
messages in the shim (native forwards everything at once — §3.2); a `'disconnected'` input that still has its handler **does** get the
releases native injects for it (§3.4 — they are ordered before the list that disconnects it anyway). Group nibbles do not exist in Web
MIDI; dropped.

### 1.3 Timestamps [C] — the page's clock by a one-way minimum filter (review #3)
A batch carries `h`, native's host time at dispatch (ms, Double — `MIDITimeStamp` is `mach_absolute_time` [R: MIDIServices.h:253–263],
converted through `mach_timebase_info`), and per message its **age** `h − arrival` (ms, clamped to 0…2 000: a 0 packet timestamp means
"now" → age 0; a future one → 0; an absurd past one — another app's stale stamp — → 2 000). The shim, with `recv = performance.now()` once
at the start of `midiIn`, keeps `off` = **the minimum of `recv − h` over the batches of the last 2 s** (a sliding window of (time, sample),
pruned per batch; the first batch seeds it) and stamps **`timeStamp = min(recv, h − age + off)`**. `recv − h` = the clock offset + that
batch's transit; its minimum is the offset + the *fastest* transit (≈ the IPC alone), so a batch that waited for a busy page (a pinch, a
cold face raster at 100+ ms, a dialog) is stamped at its **arrival**, not its delivery — as Chrome stamps it. The window lets `off` rise
again if the clocks move apart (a WebKit `performance.now()` that keeps counting through a device sleep while `mach_absolute_time` stops
[R?]); within a window nothing drifts (both are monotonic). Error ≈ the fastest transit (≤ 1 ms expected) + WebKit's `performance.now()`
quantum (1 ms on iOS [R: HANDOVER §5 "1 ms timer resolution"; the smoke's §8 step 5 reads the effective resolution]). The draft's
`recv − age − lag` (an EMA of the round trip) folded every page stall into the stamp — 100 ms late under a raster — and contradicted B6.
What it feeds (§0: `recTick` → the recorded position, then `inputQuantize`; the Pads / clip recorders — sx-ui-seq.js:15–17): a note
recorded in the app lands where Chrome on a Mac would put it to within the §9 budget. **Future-stamped messages**: the virtual destination
"SYNTH" needs nothing — the server delivers a send to it at its timestamp [R: MIDIServices.h:926–931, the default advance schedule time 0;
§2.4 never sets it]; another app's **virtual source** (`MIDIReceived…` with timestamps ahead, a sequencer's schedule-ahead) is delivered
to our input port as sent [R?: the server schedules destinations, not sources] — those are **held natively until due** (a main-thread
timer heap, ≤ 2 s ahead; beyond that delivered at once, age 0) [C].

---------------------------------------------------------------------------------------------------------------------------------

## 2. The native side — `Midi.swift` (lane M)

### 2.1 Client, ports, lifetime [C]
- `MIDIClientCreateWithBlock("SYNTH", &client, notifyBlock)` **once, lazily**, at the first `{ t: 'midi', on: true }` (a page that never
  asks costs nothing); **never disposed** (MIDIServices.h:1462–1479 [R]: a dispose can make later creates fail). Created on the main
  thread; **the notify block runs on a thread the implementation chooses** [R: :1451 — the draft's "the creating thread's run loop" is
  `MIDIClientCreate`'s proc, :1426]: it only does `DispatchQueue.main.async { scheduleRelist() }` and touches nothing else — **no
  `Thread.isMainThread` assertion** (the user's device build is Debug — IMPL-A #20 —: an assertion that fires there is a crash on the iPad).
  A failed create (`OSStatus ≠ 0` — e.g. no MIDI server) → the reply `{ ok: false, error }`, retried on the page's next request.
- **One input port** `MIDIInputPortCreateWithProtocol(client, "SYNTH in", ._1_0, &inPort, receiveBlock)` [R: :1485–1516 — the system
  converts MIDI 2.0 sources to 1.0 for us] connected to **every source** (`MIDIGetNumberOfSources / MIDIGetSource`, `MIDIPortConnectSource(inPort,
  src, refCon = UnsafeMutableRawPointer(bitPattern: uniqueID))` — USB class-compliant, Bluetooth LE MIDI once paired (§4), other apps'
  virtual sources (a sequencer app's output), network sessions if the system has one (we never create one — B3)); skipped:
  `kMIDIPropertyPrivate` endpoints and `kMIDIPropertyOffline` ones (left out of the list → the shim marks a known one `'disconnected'`;
  the property is inherited from the device, :992–1000). **Our own endpoints are not skipped wholesale**: the one exclusion is the
  "SYNTH" virtual destination (§2.4), left out of the **destination** table by its `MIDIEndpointRef` (it is never a source); the smoke's
  "SYNTH smoke in" / "SYNTH smoke out" (§8) are listed like anyone's — the draft's "skipped: our own endpoints" would have failed §8
  steps 1 and 7. Under Q2 = (b) ("hardware only"), virtual sources — endpoints with no entity ("Virtual sources and destinations don't have entities", `MIDIEndpointGetEntity` :1882–1892 [R]) —
  are skipped too, except the smoke's under `-smoke`; under (a) they are connected (an app that publishes its own MIDI output plays SYNTH
  with no setup, under its own name).
- **One output port** `MIDIOutputPortCreate(client, "SYNTH out", &outPort)`; `send` (§3.1) → `MIDISendEventList(outPort, dest, &list)` with a
  one-packet MIDI 1.0 list (`MIDIEventListInit(&list, ._1_0)`, `MIDIEventListAdd(…, time, 1, &word)`, `word = MIDI1UPChannelVoiceMessage(0,
  st >> 4, st & 0xf, d1, d2)` [R: MIDIMessages.h:276–277]; a system common (F1–F6) through the system word form [R: :312]); `time = 0` for
  `delay == 0` (now), else `mach_absolute_time() + delay` in host ticks; the destination found by uniqueID (`MIDIObjectFindByUniqueID` :2375,
  or the list's cached refs); unknown / offline → `{ ok: false, error }`.
- **Hot-plug**: `kMIDIMsgObjectAdded / Removed` (an endpoint, entity or device: `childType`) and `kMIDIMsgSetupChanged` / `kMIDIMsgPropertyChanged`
  (an offline flip, a rename) → **relist** (debounced 50 ms — a device plugs in as several notifications): rebuild the source / destination
  tables, connect new sources, disconnect gone ones (`MIDIPortDisconnectSource`), queue the releases of a vanished **or offline** input
  (§3.4), then queue `SYNTH_SHELL.midiPorts(list, ++gen)` — **both on the one ordered native → page queue** (§3.1), so the releases
  reach the page before the list that disconnects their port. The list is the whole truth each time (the shim diffs; an id absent from it is
  `'disconnected'` — §1.2); no "report once" bookkeeping.
- **Port record**: `id = String(uniqueID)`, `name = kMIDIPropertyDisplayName` (falls back to `kMIDIPropertyName`) [C: Chrome on macOS shows the
  same display names for the same device [R?: unverifiable without hardware — §11]: a project's pad bindings (`p.hw.port` by name,
  pads-core.js:471) made in Chrome on the Mac then follow the controller into the app], `manufacturer` = the first non-empty of the endpoint's,
  its entity's, its device's `kMIDIPropertyManufacturer` (`MIDIEndpointGetEntity` → `MIDIEntityGetDevice`), `type`, `state`.

### 2.2 Threads [C]
The receive block runs on CoreMIDI's high-priority thread [R: MIDIServices.h:1509]: it **parses the UMP words to bytes (§2.3), appends
`(uid, hostTs, st, d1, d2)` to a pending array under the lock, and schedules the flush** (`DispatchQueue.main.async` once while a
flush is not already scheduled — a flag under the same lock). The lock is an **`OSAllocatedUnfairLock`** (ios 16; `import os` — a bare
`os_unfair_lock` stored in a Swift property and passed `&` has no stable address guarantee). **The gate is decided here, at arrival**
(§3.4): the main thread mirrors `open` and `openedAt` (host ticks) into the locked state; while closed, an arrival is dropped (counted)
on the spot, and an arrival whose packet timestamp precedes `openedAt` is dropped too — so what a suspended app's receive thread hands
over on resume (stamped while the gate was shut) never plays as a burst once the main thread has reopened the gate [C; whether the server
queues to a suspended client at all is R?]. The receive block also keeps the per-port release masks (§3.4). No allocation per message
beyond the array's growth; no logging; no WebKit call off the main thread (WKWebView is main-thread-only). The flush (main) builds the
batch and calls `callAsyncJavaScript` (§3.2). The notify hop, the port tables, the gate flags, the in-flight state: main thread only.

### 2.3 UMP (MIDI 1.0 protocol) → MIDI 1.0 bytes [C]
Per `MIDIEventPacket` (`MIDIEventPacketNext` to walk; `timeStamp` per packet), per word by `MIDIMessageTypeForUPWord` [R: MIDIMessages.h:259]:
| type | bytes | rule |
|---|---|---|
| 0x2 ChannelVoice1 (1 word) | `st = (w >> 16) & 0xff, d1 = (w >> 8) & 0x7f, d2 = w & 0x7f`; **2 bytes for 0xC0 / 0xD0**, else 3 | forwarded |
| 0x1 System (1 word) | `st = (w >> 16) & 0xff`: F1 / F3 → 2 bytes, F2 → 3, F6 and F8–FF → 1 | forwarded **except F8 (clock) and FE (active sensing)** — the two periodic ones; SYNTH decodes none of them (midi.js:42 → null) and a sequencer app's 24 ppqn × 300 bpm = 120 Hz plus 3 Hz sensing would otherwise cross the bridge for nothing. A `wantClock` flag (false, never set this stage) is the seam for a clock-sync stage |
| 0x3 SysEx7, 0x5 Data128 | — | dropped (B2: no sysex permission; midi.js:354) — **no reassembly needed** |
| 0x0 Utility (JR clock / timestamp, NOOP) | — | dropped |
| 0x4 ChannelVoice2 | — | must not appear on a `._1_0` port [R: :1494–1495]; dropped and counted (`unexpected`) if it does |
| 0xD FlexData, 0xF Stream, the reserved 0x6–0xC | — | dropped — **skipped by their size**: a packet's `wordCount` may hold several UMPs, so the walk advances by the type's length (0x0–0x2, 0x6, 0x7 → 1 word; 0x3, 0x4, 0x8–0xA → 2; 0xB, 0xC → 3; 0x5, 0xD–0xF → 4) — a hand parser that steps one word at a time reads a 4-word message's tail as messages |
UMP has **no running status** — every UMP is a complete message; the group nibble `(w >> 24) & 0xf` is ignored. Lane M may use
`MIDIEventListForEachEvent` + `MIDIUniversalMessage` [R: :755–776, ios 15] instead of the shifts (it sizes every type itself); the bytes
out are the same and B-tests check them. The release masks (§3.4) are fed from the same parse: **0x9n with d2 > 0** sets the port's
note bit for n's channel (a velocity-0 note-on is a note-off), **0xBn 64** sets / clears its sustain bit (≥ 64 / < 64), **0xEn** sets
its bend bit when not centre (0x2000), clears it at centre.

### 2.4 Our own endpoints [C] — **Q2**
- A **virtual destination "SYNTH"** (`MIDIDestinationCreateWithProtocol(client, "SYNTH", ._1_0, &dest, block)` [R: :1931–1935] — a
  block that calls the **same** parse-and-append function with the destination's own uniqueID captured (a virtual destination's block
  gets no `srcConnRefCon` — §0 [R]); that uniqueID is the page's id for "From other apps"; `kMIDIPropertyAdvanceScheduleTimeMuSec` left
  at 0, so the server delivers future-stamped sends on time [R: :926–931]) so every other MIDI app on the iPad (a keyboard app, a sequencer, AUM, a drum app) lists
  SYNTH as a destination and can play it. In the page it is the **input named "From other apps"** (always `connected` while the client
  lives) — so the MIDI button reads "MIDI: From other apps" when nothing else is plugged in, and 'MIDI: no devices' never shows in the app
  (accepted: it is a true input). **Recommended** — with no controller in the house it is the one way the user plays SYNTH over MIDI on the
  iPad (a free MIDI-keyboard app), and it is how iPad music apps expect to talk to each other. Excluded from `outputs` (never a destination
  the page can send to — no self-loop). Persisted uniqueID (`kMIDIPropertyUniqueID` set from `UserDefaults` on creation, MIDIServices.h:2045–
  2048's advice) so other apps' saved routings keep pointing at SYNTH; the set may fail with `kMIDIIDNotUnique` (:142–164 — "be prepared
  for this to fail") → keep the assigned id and store it instead.
- **Doubles** (§11): an app that both publishes its own output (connected by §2.1) **and** is pointed at "SYNTH" sends each note twice —
  SYNTH retriggers (main.js:1931: a held key's second note-on = its note-off first), nothing sticks; the how-to says pick one.
- **No virtual source** ("SYNTH → other apps"): SYNTH's only MIDI out is lighting pads on the controller that sent them (IMPL-8 §8.4,
  midi.js:373–393, cv-pads.js:396) — nothing to send to other apps; a MIDI-out-to-apps feature is its own stage. Listed in §11.
- The smoke's Debug endpoints (§8) are the same two calls under `-smoke` only.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The bridge protocol and the delivery path (lanes M + S; frozen in §10)

### 3.1 Messages [C]
Web → native (`SYNTH_SHELL.post`, each replied `{ ok: true, … }` or `{ ok: false, error }` — Bridge.swift's shape):
```
{ t: 'midi', on: true }                   the page opened Web MIDI (the shim's first requestMIDIAccess) → the client exists from now, forwarding
                                          starts once ready (§3.4); reply { ok, ports: [PortRecord…], gen, h } (h: host ms now — the shim's
                                          first offset sample, §1.3). At boot it arrives AFTER { t: 'ready' } (§0: boot() is synchronous)
{ t: 'midi-send', id, b: [st, d1?, d2?], delay }   one message to the destination `id` (uniqueID string); delay ms ≥ 0 (0 = now); reply { ok }
{ t: 'midi-bt' }                          present the Bluetooth MIDI pairing sheet (§4.1); reply { ok } once queued on the Presenter (the page
                                          waits for nothing — a share sheet up first is not a hang); the smoke logs `btmidi` when shown / closed
{ t: 'midi-clock' }                       reply { ok, host }: mach_absolute_time in ms (Double) — the smoke's common clock (§8); harmless in Release
```
Native → web (through `call()` = `callAsyncJavaScript` with **arguments**, never a built string — app-native.test:203–204 [R]; gated
by §3.4; **one ordered queue for both kinds, one call in flight** (§3.2) — a relist's releases and its list go out in that order, never
overtaking a batch in flight):
```
SYNTH_SHELL.midiPorts(list, gen)   list: [{ id, name, manufacturer, type: 'input' | 'output', state: 'connected' }] — the whole list of the
                              present ports (offline / gone ones are simply absent, §1.2); gen: native's list counter (also in the reply)
SYNTH_SHELL.midiIn(b)         b: a flat Array of numbers: [h, dropped, uid, age, st, d1, d2, uid, age, st, d1, d2, …] — 5 per message
                              (d1 / d2 = 0 when the status has fewer data bytes: the shim sizes `data` by the status — §2.3's table);
                              h: host ms at the `callAsyncJavaScript` call itself (§1.3); uid the SInt32 uniqueID as a number (the shim keys its Maps by String(uid));
                              age ms (Double, 0…2 000); dropped: messages thinned or dropped since the last batch (the shim
                              console.warns once per run when > 0)
```
Called as `"if (window.SYNTH_SHELL && SYNTH_SHELL.midiIn) SYNTH_SHELL.midiIn(b)"` with `["b": …]` (resp. `midiPorts` with `["list": …,
"gen": …]`) — a page without the shim (a future site build that polyfills itself) just ignores them. **Every completion, success or
error, clears the in-flight flag** (`callAsyncJavaScript` fails a call whose frame went away or whose page navigated — WKWebView.h:329–333
[R]); termination and every main-frame commit also clear it and drop the queue (and bump a page generation: a late completion from the
old page is ignored, never clearing the new page's flag) — a stuck flag would end MIDI until relaunch.
A script-message array of ≤ 10 000 numbers is well inside WebKit's serialisation comfort; a base64 `Uint8Array` would save bytes and cost a decode per batch — numbers chosen [C] (a batch is usually 5–50 numbers).

### 3.2 Batching, latency, backpressure [C] (B4)
- **A minimum interval, not a phase-dependent wait** (review #9): a flush starts **at once** when the last flush started ≥ **2 ms**
  ago (a lone key press — and a chord's first note — adds no coalescing delay: the hop to the main queue + one `callAsyncJavaScript`);
  otherwise it is scheduled for `lastFlushStart + 2 ms` (`DispatchSource` timer, leeway 0) and takes everything that arrived meanwhile.
  A hard cap of **500 calls / s** whatever the stream's phase — the draft's "≥ 5 ms idle → now, else wait ≤ 1 ms" could make 1 000 calls
  from a 1 kHz stream whenever its 1 ms timer fired just before the next message (two 1 ms clocks racing), so the smoke's "≤ 600 calls"
  gate depended on luck. A stream message waits ≤ 2 ms. **One call in flight**: while a call has not completed, arrivals accumulate and
  go out in the next batch on its completion (the IMPL-A §4.1 "one chunk in flight" rule — self-clocking to WebKit's actual pace; a JS
  dialog holding the page (§6.4) simply makes one big batch when it closes).
- No transit estimate in native (the draft's `lag` EMA is gone — the shim's minimum filter, §1.3, replaces it); native still times every
  call (`t_call → completion`) for the smoke's `midiBatch` lines.
- **The per-call cost** of a tiny `callAsyncJavaScript` is **[R?]** (IMPL-A measured only 2 MiB chunks, ≈ 4 ms each incl. decode): **lane M
  pins it on day 1** (1 000 calls with a 10-number array on the simulator: mean / p99 of the completion; expected ≈ 0.3–2 ms). If the p99 is
  above 5 ms, the fallback — **not built unless needed** — is a streaming response over the scheme handler (`fetch('synth://app/__midi')`
  held open, `urlSchemeTask.didReceive(data)` per batch — `didReceiveData` may be called repeatedly, each call appended [R:
  WKURLSchemeTask.h:48–57]; today's handler answers in **one** piece, SchemeHandler.swift:34 — the draft's "already answers in parts" was
  wrong; whether `fetch`'s body stream surfaces each piece promptly is [R?]); noted in §12 with numbers if taken.
- **Backpressure / thinning**: the pending buffer is capped at **2 048 messages** (≈ 2 s of a 1 kHz stream — a dialog or a background stall,
  §3.4): above it, **controllers are thinned** — for CC 0–119 except 64–69 (per port, ch, cc), channel pressure (per port, ch), poly
  pressure (per port, ch, note), bend (per port, ch) only the **latest value** is kept, **at its latest position** (a kept value never
  moves ahead of a later note); **never thinned**: note on / off, program change, the pedal switches CC 64–69 and the channel-mode CCs
  120–127 (a CC 123 moved after a later note-on would kill that note). **If the never-thinned messages alone exceed 4 096**, native takes
  the gate-close path (§3.4) instead of dropping the oldest (an oldest-dropped note-off is a stuck note — B5): the buffer is emptied (counted
  as dropped), then the releases are queued for every port's sounding channels. `dropped` rides in the next batch; the smoke logs it (§8).
- Per-message work on the receive thread: a few shifts and an array append; per batch on main: one array build and one call. Nothing is
  logged per message outside `-smoke`.

### 3.3 Order and pairing
Messages keep CoreMIDI's order per port and across ports in arrival order (one buffer); a note-off is never reordered before its note-on
(thinning touches controllers only); a held future-stamped event (§1.3) is inserted when due. Port lists and batches share the one
ordered queue (§3.1). The shim dispatches a batch synchronously in order on the page's main thread (`midimessage` events are sync
dispatches; midi.js's `message()` runs inline, as in Chrome). **No frame is added on the page side**: `noteOn` → `postTo` → the node's
`port.postMessage` → the worklet's next quantum (≤ 2.67 ms at 128 / 48 kHz) — no `requestAnimationFrame` on the path [R: main.js:1928–1944];
a busy page main thread (a pinch, a cold face raster) delays delivery exactly as it does in Chrome, whose MIDI events are dispatched on
the same thread.

### 3.4 The gate — when native forwards, and what it releases first (B5)
Forward only while **`ready && midiOpen && (onScreen || backgroundAudio)`**:
- `midiOpen` = the page posted `{ t: 'midi', on: true }` since the last main-frame commit (reset by `webViewWebContentProcessDidTerminate`
  and by `webView(_:didCommit:)` — every `load()` **and** a page-initiated `location.reload()` (the read-only notice's Reload, an update)
  that native never started — a restarted page re-opens by itself: `midi.wire()` runs at every boot, main.js:8810; its reply carries the
  current ports, so a plug made during a restart is not missed; no re-announce dance);
- `onScreen` is **new**: false at `sceneDidEnterBackground`, true at `sceneWillEnterForeground` (the existing `sceneBackground` call,
  App.swift:36–37) — the state the page's `hidden` and its context suspension follow (IMPL-A §12 N: hidden 140 ms after
  didEnterBackground). **Not the shell's `foreground`**: that one is the scene's *active* state (§0) and goes false under Control Center,
  a notification pull, the first Bluetooth permission alert (§4.1) — with Sound in background off the draft's gate would have cut every
  held MIDI note (and dropped the pedal / key-ups that followed) when the user merely pulled Control Center down, while the page, still
  visible, kept its context running. `backgroundAudio` is the shell's existing flag (ShellViewController.swift:26, :245 [R]). **Sound in background on**:
  MIDI keeps flowing while the app is behind another app or the screen is locked — WebKit renders and the page's main thread runs (IMPL-A §12
  N measured), a MIDI key is not a timer (`noteOn` runs inline in the event — the ≈ 1 Hz timer throttle does not touch it): the natural iPad
  setup of **a keyboard app in front, SYNTH behind** works (once SYNTH's engine has started — the last bullet). **Off**: the page suspends its context on `hidden` (main.js:8772); forwarding
  would queue note-ons into a suspended worklet and release them in a burst on return — so native **closes the gate**.
- **On every gate close** (the setting off + background; a page commit; termination) **, on an input's removal or offline flip, and on a
  never-thinned overflow (§3.2)**: native queues, per port and channel, from three 16-bit masks per port kept by the parse (§2.3): **CC 64
  = 0 if its sustain is down** (midi.js:329 → `ctl('sus', 0)` — without it a note released under a held pedal keeps sounding: the engine
  holds released voices while sustain is on — engine.js:2995 `if (this.sustain) x.sus = true; else x.noteOff(rv)` [R] — and the pedal-up
  will never arrive), **the bend centred (`En 00 40`) if it is bent** (a
  spring-loaded wheel's return to centre is exactly what a closed gate drops; on a member channel of an MPE target midi.js turns it into
  the per-note `b = 0`), then **CC 123 (All Notes Off) if it has sent a note-on since the last release** — **into the ordered queue**,
  with the gate's own pass (the closing batch is delivered although the gate is now shut; so the page's midi.js releases them — `allOff(ch)`
  → `heldNotes(ch)` → `noteOff`, midi.js:296–299, 329–330 [R]); on a termination there is no page to release — the new page starts with
  nothing held (main.js's `held` is per page). The masks are then cleared. While the gate is closed, arrivals are **dropped** at arrival
  (§2.2, counted). `held` is per channel, not per port (§0), so a port's CC 123 also releases another port's notes on the same channel —
  accepted (a cable pulled mid-chord is rare; Chrome releases nothing at all).
- The release order matters only under sustain: CC 64 = 0 first lets the voices already off decay; CC 123 then sends the note-offs, which
  release at once (sustain is up). B3's page half checks both messages reach the track's node.
- The engine itself: with Sound in background on and **0 voices**, whether iPadOS keeps the app alive long enough for a later MIDI note to
  sound is device-only (IMPL-A §12 N "Device confirmation") — §11. **And the engine off** (no `ctx` yet: SYNTH launched, never played, then
  the keyboard app brought to the front): the first MIDI note calls `powerOn()` (main.js:1936) **in a hidden page** — whether WebKit starts
  an AudioContext for a page in the background is **[R?]** (IMPL-A measured a context that was already running) — the most likely way the
  user's first test is silent. §8 step 11 records it on the simulator; the how-to (§10 docs) has the user play one key in SYNTH first, or
  keep the keyboard app in **Split View / Slide Over** (both apps on screen and active: no background at all).

---------------------------------------------------------------------------------------------------------------------------------

## 4. Bluetooth MIDI and network MIDI (lanes M, W)

### 4.1 Bluetooth LE MIDI pairing in the app [C] — **Q3**
iPadOS has **no system-wide pairing UI for BLE MIDI** (Settings → Bluetooth does not pair MIDI peripherals; every app offers Apple's sheet);
once an app connects a device it is a CoreMIDI source for every app until it disconnects [R?: device-only, as is whether it reconnects by
itself after the device or the iPad sleeps — §11]. So the app offers the sheet: `CABTMIDICentralViewController`
(CoreAudioKit [R: CABTMIDICentralViewController.h — ios 8, a `UITableViewController`]) in a `UINavigationController` with a Done button, **presented
through the Presenter queue** as a popover from the web view's top centre (FileExport.swift:93–99's anchor rule [R]; one sheet at a time with
the share sheets and dialogs — IMPL-A §4.1), `preferredContentSize` ≈ 360 × 480 pt. **The Presenter item must `settle` on every way the
sheet can close** (review #2): Done; **a tap outside the popover** (the nav controller's `presentationController.delegate` →
`presentationControllerDidDismiss`, UIKit's call for a user dismissal — iOS 13); the smoke's auto-dismiss (`dismiss { settle }`, as
FileExport.swift:103–106); `abandonAll` (cancel: nothing to answer). The Presenter advances only on `settle` (FileExport.swift:32–40 [R]):
a popover closed by a tap outside with only Done wired leaves `current` set for good — every later share sheet waits forever, and the
next JS `confirm()` / `prompt()` is never presented, so WebKit holds the page's main thread until the app is killed (IMPL-A §6.4) — a
frozen app. **`NSBluetoothAlwaysUsageDescription`** in Info.plist: "SYNTH connects to Bluetooth MIDI
keyboards and pads you pair here." — without it the system kills the app when the sheet starts CoreBluetooth [R: iOS 13+ rule; device-only,
the simulator has no Bluetooth — the sheet presents and lists nothing]. The first open shows the system's Bluetooth permission alert (the
scene resigns active meanwhile — harmless now that the gate follows `onScreen`, §3.4; in the simulator the alert may appear too [R?] and no
`simctl privacy` service covers Bluetooth — hence §8's sheet step runs last). Our code never imports CoreBluetooth (B3; `MIDIBluetoothDriverActivateAllConnections`'s
own-scan route is not taken). Pairing done → `kMIDIMsgObjectAdded` → §2.1's relist → the page's `statechange` → "MIDI: <the device>".
**Where** (lane W, main.js's ⚙ App section — the `if (SHELL)` block, main.js:5629–5642 [R]): after "Sound in background", a row
`Bluetooth MIDI` with a button **"Pair a device…"** (`#cvBt`, `.tt`), hint "Pair a Bluetooth keyboard or pad controller (USB and other apps need no
pairing)"; click → `shellPost({ t: 'midi-bt' })`. Recommended: one plist line and ≈ 25 lines of Swift for the only way a Bluetooth
controller ever reaches the app.

### 4.2 Network MIDI — out [C]
`MIDINetworkSession` (RTP-MIDI over Wi-Fi: a Mac's Audio MIDI Setup "Network" session could drive the iPad) is a **network connection** — A2
says the app opens none, ever; the default session is disabled unless enabled [R: MIDINetworkSession.h:113]. Not enabled, not mentioned in
the UI; app-native greps `MIDINetworkSession` absent (B3). A user who asks later gets a setting in a later stage, with A2 amended knowingly.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Lifecycle (lane M) and the latency / jitter budget

### 5.1 States
| event | native | page |
|---|---|---|
| launch | nothing (the client is created on the page's `midi on`) | boot → `midi.wire()` → `{ t: 'ready' }` (boot returns) → `permissions.query('midi')` granted → `enable()` → `requestMIDIAccess()` → `{ t: 'midi', on: true }` → the access with the ports → "MIDI: …" (no tap) |
| plug / unplug / pair / offline | relist (debounced), the releases (§3.4) for a gone or offline input's channels, then `midiPorts(list, gen)` — in that order on the one queue | `statechange` → midi.js re-hooks every input, the button, `H.ports(names)` (pads' hardware dots, a gone pad port's notes end — IMPL-8) |
| Control Center, a notification pull, a system alert (scene inactive, still on screen) | nothing — the gate follows `onScreen` (§3.4) | nothing (no `hidden`) |
| app → background, Sound in background **on** | forwarding continues (§3.4) | notes sound; the on-screen holds are released by the page's own `hidden` rule (main.js:8766–8769) — MIDI-held notes are not (by design: :2298) |
| app → background, **off** | gate closed at `sceneDidEnterBackground`: the releases (sustain up, bend centre, CC 123) per sounding channel, then drop at arrival | the page suspends its context (main.js:8772); the releases reach the worklet's queue and act when it resumes, before any new note |
| back to the foreground | gate open (`openedAt` = now: anything stamped earlier that a resumed receive thread hands over is dropped, §2.2); nothing re-sent (a key still held on the controller has no note until the next press — accepted) | `wake()` |
| a page-initiated reload (`location.reload()`) | `didCommit` → `midiOpen = false`, the queue and in-flight flag cleared, masks cleared | the new page opens access at boot |
| WebContent termination (IMPL-A §5.4) | `midiOpen = false`, masks cleared, pending and the queue dropped, in-flight cleared; the client and ports stay; the restart re-injects the shim with the page | the new page opens access at boot → the list arrives in the reply |
| JS dialog up (§6.4 holds the page's thread) | the in-flight call waits; arrivals accumulate (≤ 2 048, thinned above; the never-thinned past 4 096 → the release path) | one batch on close, in order; its notes stamped at their arrival (§1.3) |
| app suspended by the system (Sound in background off, ≈ 30 s after leaving the screen) | CoreMIDI deliveries stop with the process; the client survives suspension [R?: a client is per process; whether the server queues to a suspended client is unknown — §2.2's `openedAt` rule covers both] | — |
| another app that was sending to "SYNTH" quits mid-note | nothing tells SYNTH (the destination is ours; no port vanishes) | the note sounds until its key is played again or **Panic** (the top bar's) — said in the how-to |

### 5.2 Latency and jitter — what is measured where
The played-key path in the app: controller → CoreMIDI (USB class driver ≈ 0.3–1 ms; BLE MIDI 7.5–15 ms by its own connection interval
[R?: BLE MIDI spec; device-only]) → the receive thread → main-queue hop → **`callAsyncJavaScript` IPC** → the shim → midi.js → `noteOn` →
`postMessage` to the worklet → the next render quantum (≤ 2.67 ms at 128 / 48 kHz) → the output buffer (device-only: IMPL-A §11). The
baseline is **Chrome on the Mac** (Safari has no Web MIDI at all — neither on the Mac nor the iPad): its browser process owns the CoreMIDI
client, one IPC to the renderer (≈ 1 ms [R?]), then the same page path on the same main thread, stamping each event with CoreMIDI's packet
time. The app's path has the same shape (CoreMIDI → one hop → one IPC → the page's main thread); a stream adds ≤ 2 ms of coalescing
(§3.2). **The app must not add more than the IPC and that window**: the budget (§9)
is measured on the simulator by §8 step 5 with the `midi-clock` common clock (one-way transit p50 / p99, the timestamp error p95, the batch
counts); what the simulator cannot give — the feel on the user's controller, Bluetooth's interval, the device's output latency — is the
one iPad pass (§11), read from `probe().midi` and Help & about's "Audio now" line (IMPL-A §12 W1 (2)).

---------------------------------------------------------------------------------------------------------------------------------

## 6. What the user sees (lane W; the shell-only parts inert in browsers — B1)
- The existing MIDI UI **works in the app as on a Mac**: the `#midi` button connects by itself at boot and names the ports ("MIDI: From other
  apps" alone; "MIDI: KeyStep 37, From other apps" with a keyboard there at launch — native lists sources in `MIDIGetSource` order, "From
  other apps" last; the Maps keep first-seen order, so one plugged later reads "MIDI: From other apps, KeyStep 37"); "Assign MIDI channels"; MIDI learn on Serum / FX / classic controls and
  the 2b CC modules; the Pads' hardware learn row and "Hardware controller…" menu item appear (`midiOk()` true, cv-pads.js:1021, :1167);
  pad light-back on controllers that take notes as lights. No new MIDI UI beyond the ⚙ row (§4.1).
- **Three strings** (the whole web-side diff):
  1. index.html:291 — "Or plug in a MIDI controller (Chrome, Edge, Firefox) — each track listens on its MIDI channel." → "Or plug in a MIDI
     controller (Chrome, Edge, Firefox — **and the SYNTH app on iPad: USB, Bluetooth, or another MIDI app sending to it**) — each track listens
     on its MIDI channel." (pwa.test's index.html assertions name other sentences [R: tests/pwa.test.mjs:89]; lane W re-runs it.)
  2. cv-pads.js:64 `NO_MIDI` — "… Chrome or Edge on a Mac, **or the SYNTH app on iPad**. iPad browsers have none." (shown only where Web MIDI is
     absent — browsers on the iPad; no test asserts the text [R: grep of tests/]).
  3. main.js: the ⚙ App **Bluetooth MIDI** row (§4.1, inside the existing `if (SHELL)` block :5629–5642) and **`probe().midi`** = `{ n, wheel,
     bend }` — `n` the count of MIDI messages the host callbacks received (incremented in the `createMidi` host's `noteOn / noteOff / ctl` for
     `src` 1–16 and in `modCC` — main.js:2943–2945, :2959), `wheel` / `bend` the last values the host saw (0…1 / −1…1) — the smoke's and the
     user's window (§8). ≤ 20 lines; nothing behavioural (the counters tick in browsers too — three assignments in the host's lambdas,
     read only through `SHELL.probe`; not "inert", harmless). W tests the row and `probe().midi` in its own `app-shell.test.mjs` by
     driving `api.midi.message(…)` (exported, midi.js:409) — no shim needed on W's side.
- The `#midi` button's committed title ("Ask the browser for access…", index.html:274) is overwritten by midi.js at enable (:362) within
  the first second — left as is.
- Help & about gains nothing (the build line already exists); the notice bar nothing.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Tests and gates (node: one file at a time, `--max-old-space-size=2048`; `import './v8-guard.mjs'` first; `?v=9` imports; never a fake-DOM node in `assert.*`)

| gate | what | file (lane) |
|---|---|---|
| **B1 the shim alone** | `MidiShim.js`'s text evaluated (`node:vm`) against a fake window: `navigator` (no `permissions`), `performance.now` (settable), `EventTarget` / `Event` (node's), `SYNTH_SHELL` with a recording `post` that replies `{ ok, ports, gen, h }` a tick later. Cases: `requestMIDIAccess()` posts `{ t: 'midi', on: true }` **once** and resolves the **same** access twice; after a **refused** reply (rejects) the next call **posts again** and can resolve; `{ sysex: true }` rejects a `SecurityError`; `inputs` / `outputs` Maps keyed by `String(uid)` with the record fields, in first-seen order; "From other apps" is an input and never an output; `midiPorts(list, gen)` diff → one `statechange` per changed port on the access **and** the port (`event.port`), a port absent from a list becomes `'disconnected'` and stays in its Map, the same id back flips the **same object**; a list with an older `gen` than the reply's is ignored, and one that lands before the reply is applied silently; **connection**: setting `onmidimessage` on a connected input → `'open'` and one `statechange` **after** the setter returns (a microtask — the event never runs inside the setter), on a disconnected input → `'pending'`, which turns `'open'` when it comes back; a stub `hook` that re-sets every handler on each `statechange` (midi.js's shape) runs exactly 1 + (inputs) times and terminates; `midiIn([h, 0, uid, age, 0x91, 60, 100, uid, 0, 0xd1, 7, 0, uid, 0, 0xf6, 0, 0])` → three `midimessage`s with `data` `[0x91,60,100]`, `[0xd1,7]`, `[0xf6]`; **timestamps** (§1.3) with a settable `performance.now` and chosen `h`: a fast batch then a batch delivered 150 ms late (`recv − h` + 150) → the late batch's `timeStamp` = its arrival + the fast batch's offset (error 0, not 150), `timeStamp ≤ recv` always, the offset recovers upward after the 2 s window; `onmidimessage` and `addEventListener` both fire, in order; a throwing listener does not stop the rest of the batch (`dispatchEvent` reports it — node's `EventTarget` re-throws on `process`: the test installs an `uncaughtException` catcher for that case only); a closed port (`close()`, or no handler) gets nothing; a `'disconnected'` input with a handler still gets its messages; an unknown uid is ignored; `dropped > 0` warns once; `output.send([0x90,36,127])` → `{ t: 'midi-send', id, b: [144,36,127], delay: 0 }` with `b` a plain Array, `send(Uint8Array.of(0x90,36,127,0x80,36,0))` → two posts, `send(d, now + 20)` → `delay ≈ 20`, a data byte ≥ 128 / an empty array → `TypeError`, `0xF0…` → `InvalidAccessError`; `permissions.query({ name: 'midi' })` → `granted`, `{ name: 'geolocation' }` → the original; the file is `'use strict'`, has no `import` / `export`, no `fetch` / `XMLHttpRequest` / `WebSocket` (B3 on the page side) | `tests/app-midi.test.mjs` (S) |
| **B2 midi.js unchanged on the shim** | the same file: `createMidi(host)` with `nav` = the shimmed navigator and a fake button → `wire()` → **auto-enable** (the button 'MIDI: KeyStep, From other apps', title 'Connected MIDI inputs'); a batch note-on → `host.noteOn(60, 100/127, 1, ts)` with the shim's ts; a hot-plug list → `ports(names)` and the button; `send('Pad A', bytes)` → one `midi-send` per output of that name; midi.test.mjs's IMPL-8 rig cases (per-port handlers, `padIn`, `learnPad`, `outputs` / `send`) re-run on the shim instead of the stub access; `midi.js`'s source hash equals d461f7d's (the lead's sweep: `git diff --quiet d461f7d -- midi.js`) | `tests/app-midi.test.mjs` (S) |
| **B3 the page as the app** | `bootMain` as the WKWebView (app-shell.test's `WK` UA, `synth://app`, `o.win = { SYNTH_SHELL }`) **with the shim evaluated against the sim's window before boot** — through a new additive main-sim option **`o.beforeImport(G)`**, called once right after the navigator is defined (main-sim.mjs:337) and before `await import(url)` (:358); inert for every existing caller (lane S owns that one line, §10): the posts in order **`{ t: 'ready' }` then `{ t: 'midi', on: true }`**, both during boot's settle, no tap (§0 [R] — the draft's "before ready" could not pass: `boot()` is synchronous and `wire()`'s permission promise resolves after it); the `#midi` button 'MIDI: Pad Box, From other apps' (not disabled, no `unsup`); a note-on batch → `probe().held` 1 and the track's node got `{ t: 'on', n: 60 }`; a note-off clears it; CC 1 → the track's node got `{ t: 'wheel', v: 1 }`, bend `E0 7F 7F` → `{ t: 'bend' }` ≈ 1 (the messages, not `probe().midi` — W's, absent at d461f7d); a Pads module: `learn` → a note from the port named 'Pad Box' → `hw = { port: 'Pad Box', ch, n, cc: 0 }`, its light-back → `midi-send` to the 'Pad Box' output id (canvas-8-sim's scenario on the real shim); a Serum MIDI learn → CC 74 → `s.midi['74']` set and `writeCC` moved the knob's value; `midiOk()` true → the pads' hardware row present and the menu item enabled; **B5's page half**: CC 64 127, a note-on, then the release triple (`B0 40 00`, `E0 00 40`, `B0 7B 00`) → the node got `{ t: 'sus', v: false }` before the note's `{ t: 'off' }`, `held` 0. **Not here** (W's, in app-shell.test.mjs, so S never waits on W): the ⚙ Bluetooth row and `probe().midi` | `tests/app-midi-sim.test.mjs` (S; its own boot — one boot per file) + the `beforeImport` line in `tests/main-sim.mjs` (S) |
| **B4 browsers unchanged** | app-shell.test.mjs (W, the marker without the shim): ⚙'s rows after the canvas lines `['H3:App', 'DIV:Sound in backgroundOn', 'P:Keep playing when you switch apps', 'DIV:Bluetooth MIDIPair a device…', 'P:Pair a Bluetooth keyboard …']` (the exact tail at :184 is W's to extend) and the button posts `{ t: 'midi-bt' }`; `api.midi.message([0xb0, 1, 127])` / `([0xe0, 0x7f, 0x7f])` / a note → `probe().midi` `{ n: 3, wheel: 1, bend: ≈ 1 }`; app-shell-web (no marker): no Bluetooth row, `navigator.requestMIDIAccess` undefined, `midiOk()` false, `probe` absent; `tests/midi.test.mjs`, `canvas-8-sim`, `pads-core.test`, `cv-pads.test` pass untouched; lint (no new site import); pwa.test's index.html case with the new help sentence; the goldens / canonical-stream by construction (no DSP file in the diff — the lead's `git diff --stat`) | existing + `tests/app-shell-web.test.mjs` (W: one case) |
| **B5 the app's static contract** | app-native.test — additive cases **plus two deliberate edits of stage A's assertions, which this contract amends** (named so no reviewer reads them as a weakened test): :152's absent-keys list loses `NSBluetoothAlwaysUsageDescription` (now a required key with its text; the list keeps ATS, `UIRequiresFullScreen`, `NSPhotoLibraryUsageDescription`, `WKAppBoundDomains`), and :158's exact Swift list gains `Midi.swift`, `MidiBluetooth.swift`, `SmokeMidi.swift` (the A2 / A6 greps then cover them too). Info.plist has `NSBluetoothAlwaysUsageDescription`; the Swift: `MIDIInputPortCreateWithProtocol(` with `._1_0`, `MIDIDestinationCreateWithProtocol(`, no `MIDIClientDispose`, no `MIDINetworkSession`, no `import CoreBluetooth`, no `MIDIBluetoothDriver`, no `evaluateJavaScript(`, the frozen messages `"midi"`, `"midi-send"`, `"midi-bt"`, `"midi-clock"` in Bridge.swift, `midiIn(` / `midiPorts(` called through `call(` with `["b": …]` / `["list": …, "gen": …]`, the gate expression `ready && midiOpen && (onScreen || backgroundAudio)` (or its named equivalent — the test greps the four names in one condition, and **not** `foreground` in it), `onScreen` assigned in `sceneBackground`, `midiOpen = false` in `webViewWebContentProcessDidTerminate` **and** in `didCommit`, the release triple present (`64`, `0x40` / centre, `123`), the 2 048 / 4 096 caps and the 2 ms interval as named constants, no `isMainThread` assertion in the notify path, `presentationControllerDidDismiss` in `MidiBluetooth.swift`; `Midi.swift` imports CoreMIDI, Foundation and `os` only (UIKit only in the file that presents the sheet); `MidiShim.js` referenced as a Resource, **not** in `EXCLUDED_SOURCE_FILE_NAMES`, added by `installUserScripts` **after** the marker (regex: marker `addUserScript` precedes the shim's in the function body); `SmokeMidi.swift` / the MIDI smoke steps under `#if SMOKE` and `Smoke.drives` (IMPL-A's rule: the user's Debug build does nothing without `-smoke`) | `tests/app-native.test.mjs` (M) |
| **B6 the smoke** | §8 on the simulator — the lead's gate at integration; lane M's `--base`-style partial on d461f7d's site with **M's uncommitted recorder stub** for `MidiShim.js` (§8 "Lane M's partial": the native half only — the loopback, the batch counts, the call cost, the common clock, `dropped`; the button, midi.js, the engine, `probe().midi` and the ⚙ row pending S / W) | `tools/app-smoke.sh` (M) |
| **B7 the web suite** | every existing test file in the sweep; lint; the goldens bit-identical | existing (the lead) |

---------------------------------------------------------------------------------------------------------------------------------

## 8. The smoke's MIDI steps — `tools/app-smoke.sh` (lane M; Debug `-DSMOKE` **and** `-smoke <run>` only)

**The simulator has no MIDI hardware; whether CoreMIDI's server runs there at all is [R?]** (nothing in stage A touched CoreMIDI; the draft
asserted it untagged). **Lane M's day-1 probe** (before any other MIDI work): on the simulator, `MIDIClientCreateWithBlock` → OSStatus,
`MIDISourceCreateWithProtocol` + `MIDIDestinationCreateWithProtocol` → OSStatus, the source count, and one note looped from the own source
to the own input port within 1 s. **If it works**: under `-smoke` the Debug shell creates a **virtual source "SYNTH smoke in"**
(`MIDISourceCreateWithProtocol`, sending with `MIDIReceivedEventList` [R: MIDIServices.h:2042–2052, 2521]) and a **virtual destination "SYNTH
smoke out"** (its receive block logs the bytes) in the app's own process — a loopback through the MIDI server, so the whole path (CoreMIDI
→ receive thread → batch → `callAsyncJavaScript` → shim → midi.js → engine) is exercised with no hardware and no Swift test target.
**If it does not** (the honest fallback, decided on day 1 and written in §12): a Debug-only `-smoke` seam **below** the server — the smoke
builds real `MIDIEventList`s (`MIDIEventListInit` / `MIDIEventListAdd` are plain functions over a buffer, no server needed [R:
MIDIServices.h:2619–2660]) and hands them to the very parse-and-append function the receive block calls, with a fake endpoint table for the
lists — so the UMP parse, the gate, the masks, batching, the bridge, the shim, midi.js and the engine are all still the real code; steps
6 (hot-plug) and 7 (MIDI out) then run on the fake table / a send recorder and are marked "server not exercised", and the real server path
moves to the one iPad pass (a MIDI-keyboard app — §11). The B6 gate lists which mode ran.
**[R?] whether the simulator shares the Mac's MIDI server** (the Mac's own virtual sources and IAC buses visible in the app): lane M pins
it on day 1 with a 20-line `tools/midi-probe.swift` (run by `swift`, creates a virtual source on the Mac, sends a note) — if shared, it is
reviewer 1's stand-in for a controller and a second smoke path (and the Mac's own devices then appear in the smoke's lists — the gates
match by name, never by count); if not, the in-app loopback is the proof and the Mac tool is dropped.
**Lane M's partial** (before S lands): the bundle carries M's **uncommitted recorder stub** `MidiShim.js` — `navigator.requestMIDIAccess`
that posts `{ t: 'midi', on: true }`, and `SYNTH_SHELL.midiIn` / `midiPorts` that only push their arguments and `performance.now()` into
`window.__midiRec` — enough for the native half's gates (the loopback, batch sizes and call counts, the call cost, the common clock,
`dropped`, the gate's counters); every page-side gate (the button, midi.js, the engine, `probe().midi`) is `pend` until integration.
Steps (after the existing engine step and its `keyUp`; `__smoke.midi*` in Smoke.js, Swift in `SmokeMidi.swift`; native's own senders
run on a **separate high-priority queue**, never the main queue the flush runs on):
1. **Ports**: `__smoke.midiStatus()` → `{ button: #midi's text, inputs, outputs, ok: typeof navigator.requestMIDIAccess, enabled }` — gate: the
   button starts with 'MIDI: ' and lists 'SYNTH smoke in' and 'From other apps'; `outputs` lists 'SYNTH smoke out' and **not** 'From other apps'.
2. **A note sounds**: native sends `90 3C 64` from the virtual source (time 0) → `__smoke.midiWait(3000)` polls `probe()` → `held ≥ 1`,
   `peak > 0.01`, `midi.n ≥ 1`; then `80 3C 00` → `held` back to its previous value.
3. **Controls**: CC 1 = 0 then 127 → `probe().midi.wheel` 0 then 1; bend `E0 00 40` → `bend ≈ 0`, `E0 7F 7F` → `≈ 1`.
4. **The common clock**: `__smoke.midiClock()` — 20 × `post({ t: 'midi-clock' })`, the sample with the smallest round trip gives `offset =
   host − page` (ms) ± rtt / 2 (recorded).
5. **A 1 kHz burst**: native sends 1 000 CC 74 messages (values cycling 0…127, a 1 ms `DispatchSourceTimer`), logging `(seq, hostSend)` per
   message and per batch `(size, rtt)`; the page's listener on the shim's input (`addEventListener('midimessage')`) records `(value, ts,
   recv)`. Gates: 1 000 received in order; **calls ≤ 520** (the 2 ms interval's hard cap of 500 / s + timer slop — §3.2), `dropped = 0`;
   **transit** `recv − (hostSend − offset)`: p50 ≤ 3 ms, p99 ≤ 8 ms (recorded, gated loosely — the simulator is a Mac); **timestamp error**
   `ts − (hostSend − offset)`: p95 ≤ 2 ms (the `performance.now()` quantum is read from the distinct `recv` values and recorded).
5b. **A busy page** (B6, review #3): `__smoke.busy(150)` spins the page's main thread 150 ms while native sends 5 notes 20 ms apart → their
   transit up to ≈ 150 ms (recorded), their **timestamp error p95 still ≤ 2 ms** (the minimum filter, §1.3) — the draft's scheme would show
   ≈ 150 / 130 / 110 … ms here.
6. **Hot-plug**: the virtual source disposed → `statechange` → the button no longer lists it, `inputs()` without it; a note held on it
   first → released (`held` back) before the list arrives (the ordered queue, §3.1); re-created → listed again.
7. **MIDI out**: the page sends `[0x90, 36, 127]` to 'SYNTH smoke out' through the shim's output → the destination's receive block logs
   `90 24 7F` within 50 ms.
8. **The gate**: `__smoke.click('cvBg')` turns Sound in background off through the real ⚙ button (the store key + `{ t: 'bg', on: false }`),
   native sends CC 64 127 and a note-on, then the script backgrounds the app (`simctl launch … com.apple.mobilesafari`); within the first
   second after `sceneDidEnterBackground` (before the system may suspend the app — its session is let go, ShellViewController.swift:288)
   native sends a note-off, CC 64 0 and a note-on → log: the release triple queued on ch 1 at the gate close, 3 dropped (the log records
   whether the process kept running); foreground → `held` 0 (nothing stuck), the next note sounds. (`--mode bg` style; gated on the log's
   counters.) Then Sound in background back on.
9. **Inactive is not hidden**: native (Debug, `-smoke`) calls the shell's `sceneActive(false)` path as Control Center would (simctl
   cannot pull it down) with Sound in background off → no release, nothing dropped (the gate follows
   `onScreen`, §3.4); `sceneActive(true)`.
10. **Lone-note latency**: 50 single notes 200 ms apart → per-note transit p50 / p99 (no coalescing delay: the batch size is 1 for all 50).
11. **Engine off, app hidden** (records — the user's first test, §3.4 / §11): a separate launch (`-smokeMode midicold`, IMPL-A's `--mode` pattern), no key played (the
   engine never started), Sound in background on → the app backgrounded → one note from the smoke source → after 2 s: `probe()` `ctx`,
   `peak`, `held` logged as `midiColdBg`; foreground → the same. Recorded, not gated (the simulator need not match the iPad).
12. **Bluetooth sheet — last** (a Bluetooth permission alert, if the simulator shows one, cannot be dismissed by the script and would
   leave the scene inactive for every later step): `post({ t: 'midi-bt' })` → `{ k: 'btmidi', shown: true }`; auto-dismissed after 2 s under
   `Smoke.drives` → `{ k: 'btmidi', closed: true }` and the Presenter free again (a share sheet queued right after it shows — the settle
   rule of §4.1); the log records whether a system alert appeared (a `scene` → `inactive` line with no sheet of ours).
Log kinds (`k`): `midi` (client / ports, the day-1 mode), `midiPorts`, `midiBatch` (size, rtt, dropped), `midiOut`, `midiClock`, `btmidi`, `midiGate`, `midiColdBg`. The
evaluator joins the native and page records by `seq` / value. Pass adds to IMPL-A §9.2's list: every gate above; 0 console errors still;
every request still `synth://app/`; the `.app` ≤ 16.5 MB.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Budgets
| what | target | how |
|---|---|---|
| a lone MIDI note, CoreMIDI → the page's handler (transit) | p50 ≤ 3 ms, p99 ≤ 8 ms on the simulator (recorded; the bridge's share = the IPC) | §8 steps 5, 10 |
| `MIDIMessageEvent.timeStamp` error vs the true arrival | p95 ≤ 2 ms — **also with the page's main thread blocked 150 ms** | §8 steps 5, 5b |
| a 1 kHz controller stream | 1 000 / 1 000 in order, ≤ 520 calls, 0 dropped | §8 step 5 |
| a stall (a dialog) at 1 kHz | notes intact, controllers thinned to their last values (never CC 64–69 / 120–127), the batch ≤ 2 048 + the never-thinned; past 4 096 never-thinned → the release path, nothing stuck | B1 (the shim side) + lane M's check of the thinner (the Debug step `__smoke.midiStall()` opens a `confirm()`, which IMPL-A's smoke answers after 1 s, while native streams) — optional, recorded |
| per-call cost of a tiny `callAsyncJavaScript` | measured day 1 (mean / p99); > 5 ms p99 → the §3.2 fallback is considered | lane M |
| code | `Midi.swift` ≤ 400 lines, `MidiShim.js` ≤ 300 lines, the W diff ≤ 40 lines | review |
| the device (the one iPad pass) | key-to-sound feel no worse than **Chrome** + the same controller on the Mac (Safari has no Web MIDI — the draft's baseline did not exist); Bluetooth adds its interval | §11 |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Lanes, interfaces, docs

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **M** native CoreMIDI + bridge | 1 | `app/ios/SYNTH/Midi.swift` (new: client, ports, UMP → bytes, batching, gate, send, the relist), `app/ios/SYNTH/MidiBluetooth.swift` (new, UIKit: the pairing sheet through the Presenter), `Bridge.swift` (+ the four messages; `BridgeHost` gains `bridgeMidiOpen / bridgeMidiSend / bridgeMidiBluetooth / bridgeMidiClock`), `ShellViewController.swift` (the shim user script in `installUserScripts`, the gate flags wired to `Midi` — the new `onScreen` from `sceneBackground` —, `midiOpen` / the queue / in-flight reset on termination and `didCommit`), `App.swift` (nothing expected — `sceneBackground` already reaches the shell; listed so a change stays M's), `Info.plist` (the Bluetooth key), `project.pbxproj` (Midi.swift, MidiBluetooth.swift, SmokeMidi.swift, `MidiShim.js` as a Resource — built with M's **uncommitted recorder stub** `MidiShim.js` (§8) until S's lands; the icon pattern of IMPL-A §1.4), `SmokeSteps.swift` + `SmokeMidi.swift` (new) + `Smoke.js` (the §8 steps), `tools/app-smoke.sh` (the §8 gates and the evaluator's joins), `tools/midi-probe.swift` (if kept), `tests/app-native.test.mjs` (B5, incl. the two amended stage-A assertions) | B5, B6 (partial on the base site), **day-1 pins, in this order**: CoreMIDI in the simulator at all (§8's probe → the smoke's mode), the per-call cost, the simulator's MIDI-server sharing | Fable 5.1 |
| **S** the page shim | 1 | `app/ios/SYNTH/MidiShim.js` (new), `tests/app-midi.test.mjs` (new), `tests/app-midi-sim.test.mjs` (new), **`tests/main-sim.mjs` — the one additive `o.beforeImport` line only** (B3; owner I's file, inert for every existing caller; the lead checks the diff is that line) — **S never touches midi.js** | B1, B2, B3 | Opus 5.5 |
| **W** web seams | 1 | `main.js` (§6 item 3 only: the ⚙ row inside the existing `if (SHELL)` block, `probe().midi`, the three counters), `index.html:291` (the sentence), `cv-pads.js:64` (the string), `tests/app-shell.test.mjs` (+ the ⚙ row — the exact tail at :184 extended — and `probe().midi` cases), `tests/app-shell-web.test.mjs` (+ one case) | B4 (the ⚙ row and `probe().midi` are W's alone — S's B3 asserts neither, so no lane waits on another) | Sonnet |
| lead | 0, 2 | integration on holding branch `wt-B` (worktrees reset to d461f7d), `node tools/precache.mjs --write` (main.js / index.html / cv-pads.js moved → BUILD), **a commit on `wt-B` before the full smoke** (A3), the full smoke, ROADMAP / HANDOVER / CLAUDE.md | B7, B6 (full) | — |
| reviewers × 2 | 3 | **R1 (the simulator, Fable 5.1)**: the smoke green; by hand with `--mode log`: Pads learn from the Mac's virtual source (if shared) or the in-app smoke source via a Debug `-smokeMode log` helper (`__smoke.midiNote(n, v)` lane M adds for by-hand runs), MIDI learn on a Serum knob and a classic knob, "Assign MIDI channels" with two channels, the ⚙ Bluetooth sheet opens and dismisses **by Done and by a tap outside, then a Save still shows its sheet and ≡ → New still asks** (the Presenter not stuck, §4.1), Sound in background on → Home → notes from the Mac source still sound (if shared), off → nothing stuck on return (a held note **with the pedal down** too), Control Center pulled down (the simulator's own menu, if it offers one) with a note held → nothing released, `kill -9` WebContent → the ports re-listed on the new page, 20 min with a 100 Hz CC stream (memory flat, `dropped` 0), the WebContent RSS; **R2 (the web + node, Opus 5.5)**: the browser build unchanged but for the two visible strings (headless Chrome: the help sheet, the pads' NO_MIDI text where Web MIDI is absent, `midi.js` byte-identical, every existing test), the Swift against B3 / A6 (no network / Bluetooth / private API), the shim against the Web MIDI spec for the surface of §1.2 (ids stable, events, `connection`), the protocol between `MidiShim.js` and `Midi.swift` as frozen below | — | Fable 5.1 / Opus 5.5 |
| fixers | after | the finding's files, failing test first | | Sonnet / Opus |
| sweep → one squashed commit **"B"** on `canvas` → `tools/deploy-canvas.sh` → the app built from that commit, smoke-green, installed on the simulator; the user's next cable session installs it (IMPL-A §7.2; re-sign by 2026-10-30) | 4 | | | |

**Interfaces (frozen by this contract)**: the bridge messages `midi` / `midi-send` / `midi-bt` / `midi-clock` with their reply shapes (§3.1);
`SYNTH_SHELL.midiIn(b)` (`[h, dropped, uid, age, st, d1, d2 …]`, 5 per message) and `SYNTH_SHELL.midiPorts(list, gen)` (the record fields;
absent = disconnected); the one ordered native → page queue, one call in flight, the 2 ms minimum interval; the shim's timestamp rule
(§1.3: `min(recv, h − age + off)`, `off` the 2 s minimum of `recv − h`); the port names "From other apps" (the virtual destination as an
input) and the smoke's "SYNTH smoke in" / "SYNTH smoke out"; the shim's file name `MidiShim.js`, injected after the marker in both
installs; the gate `ready && midiOpen && (onScreen || backgroundAudio)`, decided at arrival; the release triple (CC 64 = 0, bend centre,
CC 123) on gate close / port removal or offline / overflow; the drop and thinning rules (§3.2); `main-sim`'s `o.beforeImport(G)`; `probe().midi = { n, wheel, bend }` (additive to IMPL-A's frozen `probe()`); the ⚙ row's ids
(`#cvBt`); the smoke log kinds (§8). Rules as every stage: `?v=9` on every new site import (none expected); no lane commits sw.js's lists (the
lead); no lane touches engine / DSP / model files; S and W never edit the same file; M and S share only `app/ios/SYNTH/` with disjoint files.

**Docs to update (the lead, at the end)**: ROADMAP row 12 (stage B done: CoreMIDI behind the Web MIDI shim, "From other apps", Bluetooth
pairing, the user's §Q answers; stage C = nothing planned — the Mac dropped, haptics dropped); HANDOVER §1 (the app has MIDI; **how to try
it with a MIDI-keyboard app**, written for the user's first test (review #16): ① open SYNTH first and play one key on its own keyboard
(the engine on — §3.4: a note may not start a powered-off engine while SYNTH is hidden); ② open the keyboard app **in Split View or Slide
Over** beside SYNTH (both on screen — the surest), or full screen with ⚙ → App → **Sound in background On** (the default); ③ in the
keyboard app pick the MIDI output **"SYNTH"** — or, if the app has its own "virtual MIDI output", leave that on instead: SYNTH listens to
it by its name; not both (each note would play twice); ④ SYNTH's MIDI button shows "MIDI: From other apps" (plus the app's name); notes go
to the track listening on their channel, else the selected track; ⑤ a note left sounding after switching apps → **Panic**), §2 (the
user's MIDI decisions), §3 item 15, §6 (the smoke's MIDI steps, `tools/midi-probe.swift` if kept);
CLAUDE.md's app paragraph (one line: the shim is a bundle user script; Release ships `MidiShim.js`, never `Smoke.js`); IMPL-A §11's "Not in
stage A: CoreMIDI" line → a pointer here.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Known limits (recorded)

Only the real iPad answers (the one consolidated pass; `probe().midi`, Help & about's "Audio now" line and `-smokeMode log` exist for it):
- **The user's gear** (**Q1**): none today (ROADMAP.md:69). Until a controller arrives, the device pass uses a MIDI-keyboard app sending to
  "SYNTH" (Q2). Then: a USB class-compliant keyboard over the iPad's USB-C (bus-powered ones may need a powered hub — iPadOS's limit, not ours),
  a Bluetooth one through ⚙ → App → Pair a device…; the feel (latency, velocity, aftertouch, wheels), MPE if the controller has it, pad light-back.
- **Bluetooth**: pairing, reconnection after sleep, the BLE interval's latency, `NSBluetoothAlwaysUsageDescription`'s prompt — the simulator
  has no Bluetooth (the sheet presents empty).
- **MIDI 2.0 devices**: the system's conversion to MIDI 1.0 on our `._1_0` port is the header's promise [R: MIDIServices.h:1494–1495]; untested
  without such a device. High-resolution velocity / per-note controllers are reduced as the system does it.
- **Port names across Chrome and the app** (pads' `hw.port`): `kMIDIPropertyDisplayName` is expected to match Chrome on macOS for the same
  device [R?]; if a project's pad bindings made in Chrome do not follow, the pad is re-learned in the app (one tap each) — recorded, not fixed.
- **Background with 0 voices**: whether iPadOS keeps the app alive with the engine on but silent until a MIDI note arrives (IMPL-A §12 N's
  open device check); Sound in background **off** + a keyboard app in front = no sound by design (the gate, §3.4).
- **Background with the engine off** (§3.4, §8 step 11): whether a note can start a never-started AudioContext in a hidden WKWebView [R?] —
  the how-to sidesteps it (play one key in SYNTH first, or Split View / Slide Over).
- **Other apps**: an app that quits or is switched away mid-note without sending its note-off leaves the note sounding (nothing tells SYNTH)
  — Panic clears it; an app publishing its own output **and** pointed at "SYNTH" doubles every note (a retrigger, never a stuck note).
- **Future-stamped events**: into "SYNTH" the server delivers them on time [R: MIDIServices.h:926–931]; from another app's virtual source
  (§1.3) they are held natively until due — the main-thread timer's granularity (≈ 1 ms) and a stall (a dialog) add to their error; a
  sequencer sending clock (F8) gets no sync from SYNTH (dropped, §2.3) — SYNTH has no MIDI clock in or out in any build.
- **`performance.now()` coarseness** in WebKit (≈ 1 ms [R: HANDOVER §5]) bounds the timestamp precision below Chrome's; recording quantize covers it.
- **The simulator's MIDI server** ([R?], §8): running at all, and shared with the Mac or not — the smoke's in-app loopback is the proof if
  it runs, the below-the-server injection (§8) if not; the server path then waits for the iPad pass.
- **The per-call cost** of `callAsyncJavaScript` on the device vs the simulator (the simulator is an M4 Max): `probe().midi` has no transit
  figure; the device pass reads the feel; a `-smokeMode log` run on the device logs `midiBatch` rtts if the user plugs the iPad into the Mac.
- Not in stage B (by scope): the Mac (dropped by the user), haptics (dropped), SysEx (B2 — no caller; patch dumps / editor features would need
  it), MIDI clock / SPP / transport in or out (SYNTH decodes none — midi.js:42), a virtual **source** (SYNTH → other apps; §2.4), network MIDI
  (§4.2), MIDI thru, MIDI-CI / Property Exchange, per-port enable toggles (every connected input plays, as in Chrome), a MIDI monitor page.
  By design: the "From other apps" input makes the button never read 'MIDI: no devices' in the app; a key held on the controller across a
  gate close is released (the release triple) and not re-struck on return; a port's release also ends another port's notes on the same
  channel (`held` is per channel, §0).

---------------------------------------------------------------------------------------------------------------------------------

## Questions for the user (§Q — recommended option first, ≤ 4)

- **Q1 What will you play SYNTH with?** (a) **Nothing yet** — recommended path: we prove MIDI with the app's own test ports and you try it with
  a free MIDI-keyboard app on the iPad that sends to SYNTH (Q2); tell us when a keyboard or pad controller arrives and whether it is **USB-C
  (cable)** or **Bluetooth**, and its name — the one iPad pass then covers it. (b) You already have one: say which (name; USB or Bluetooth).
- **Q2 Let other iPad apps send MIDI to SYNTH?** (a) **Yes** — recommended: SYNTH appears as a MIDI destination in every music app (a keyboard
  app, a sequencer, AUM, a drum app), so they can play it — today the only way to play SYNTH over MIDI without hardware; in SYNTH it shows as
  an input called "From other apps" (so the MIDI button always lists at least that). (b) No — hardware controllers only.
- **Q3 Pair Bluetooth MIDI devices inside SYNTH?** (a) **Yes** — recommended: ⚙ → App → Bluetooth MIDI → "Pair a device…" opens Apple's pairing
  list (iPadOS has no other way to pair a Bluetooth MIDI keyboard; the app asks for Bluetooth permission the first time you open it). (b) Not
  now — USB and other apps only (a Bluetooth controller would need another app to pair it first).

(Settled, not asked: no Mac version and no Pencil haptics (the user); no network MIDI (your offline rule); no SysEx and no MIDI clock (SYNTH
uses neither); MIDI out stays what it is — pad lights back to the controller; the MIDI button connects by itself in the app, no prompt.)

---------------------------------------------------------------------------------------------------------------------------------

## 12. Notes (the builders fill in)

### Lane M

### Lane S

### Lane W

### Reviews and fixes

### Acceptance

## 13. Review log

### The skeptic review (2026-10-23, against the draft)

Every claim about existing code was read at d461f7d (`canvas`, read only): midi.js whole, main.js's MIDI host / recording / boot /
lifecycle, cv-pads.js's seams, the Swift of `app/ios/SYNTH/`, tests/midi.test.mjs, canvas-8-sim's fake, main-sim.mjs, app-shell.test,
app-native.test, lint's file walk; API facts from the iOS 27.1 SDK headers (CoreMIDI, CoreAudioKit, WebKit) only; no test, build or
simulator run. Severity as IMPL-A §13: **P1** a contract contradiction, an impossible / vacuous gate, a crash / freeze or a broken
invariant; **P2** a gap a builder would trip on; **P3** a correction. **Settled and not reopened**: the scope paragraph, the shim as a
bundle user script, no SysEx / clock / network MIDI / virtual source, the three web strings. §Q unchanged (Q1–Q3 as drafted, none added).

**The brief's nine questions, answered.** (1) **Fidelity**: midi.js reads little and the surface covers it (#35); what was missing is the
spec's `connection` life (implicit open, `pending`, queued `statechange` — #17), a list race (#18), a cached rejection (#19), typed arrays
over the bridge (#20) and listener errors (#21). (2) **Latency / jitter**: the IPC cost stays [R?] for day 1; the page path adds no frame
and a busy page delays Chrome the same way — but the draft's stamp folded that delay in, breaking B6 (#3); the coalescing gate was luck
(#9). midi.js uses `timeStamp` for recording and input quantise only. (3) **Correctness**: the byte rule is right for every type SYNTH
decodes; the walk must size unknown UMP types (#22); future stamps into our destination are the server's job (#23). (4) **Lifecycle**:
the gate keyed on the wrong flag (#5), released notes but not the pedal (#4), could stall for good (#13), and its releases could lose the
race with the port list (#14). (5) **Bluetooth**: the sheet can freeze the app through the Presenter (#2); the key collides with a stage-A
assertion (#11). (6) **The smoke**: CoreMIDI in the simulator was untagged (#7); the own-endpoint rule failed two steps (#8). (7) **A1**:
holds — midi.js untouched, the shim never reaches the site or lint (#36). (8) **Lanes**: an unowned test file (#10), cross-lane gates
(#12), an impossible order gate (#1). (9) **The first real test**: a keyboard app works through "SYNTH" or its own output, but a
never-started engine in a hidden page may stay silent and nothing told the user how to set it up (#16).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **B3's "`{ t: 'midi', on: true }` before `{ t: 'ready' }`" cannot pass.** `boot()` is synchronous; `wire()` only starts `permissions.query`, whose `.then(… enable())` → `requestMIDIAccess` → the post runs after `boot()` has posted `ready` | main.js:8730, 8810, 8828, 8869; midi.js:399–403 | **fixed in §0, §3.1, §5.1, §7 B3**: `ready` then `midi on`, both during boot's settle, no tap |
| 2 · P1 | **The Bluetooth sheet could freeze the app.** A popover dismissed by a tap outside never runs Done; the Presenter advances only on `settle` — `current` stays set, every later share sheet waits, and the next JS `confirm()` / `prompt()` is never presented, so WebKit holds the page's main thread for good | FileExport.swift:27–41; ShellViewController.swift:201–217; IMPL-A §6.4 | **fixed in §4.1, §7 B5 (grep `presentationControllerDidDismiss`), §8 step 12, R1**: settle on Done, tap-outside, auto-dismiss, abandon |
| 3 · P1 | **The draft's timestamps break B6 under load.** `recv − age − lag` puts the page's own wait (a pinch, a 100+ ms face raster, a dialog) into the stamp; Chrome stamps CoreMIDI's packet time, untouched by the renderer's thread — recorded notes would land up to 100+ ms late exactly when the page is busy | draft §1.3, §3.2 (`lag` EMA); main.js:1684, 1693, 1870 | **fixed in B6, §1.3, §3.1 (`h` replaces `lag` in the frozen batch), §3.2, §7 B1, §8 step 5b, §9**: a one-way minimum filter `off` over 2 s, `ts = min(recv, h − age + off)` |
| 4 · P1 | **B5's own case drones with the pedal down.** CC 123 → `noteOff`, but the engine holds released voices while sustain is on and the pedal-up is exactly what a pulled cable / closed gate never delivers; a spring-loaded bend's return to centre likewise | midi.js:329–330; main.js:1965–1970; engine.js:2815–2823, 2995 | **fixed in B5, §2.3 (three masks), §3.4 (CC 64 = 0 → bend centre → CC 123), §5.1, §7 B3, R1** |
| 5 · P2 | **The gate keyed on the scene's *active* state.** `foreground` goes false under Control Center, a notification pull, the first Bluetooth alert; with Sound in background off the draft cut every held MIDI note (and dropped the key-ups) while the page, still visible, kept its context running | App.swift:34–37; ShellViewController.swift:27, 279–289; main.js:8766–8772 | **fixed in §0, §3.4 (`onScreen` from `sceneBackground`), §5.1, §7 B5, §8 step 9, §10** |
| 6 · P2 | **"The notify block runs on the creating thread's run loop" is false for the block API** — the header says a thread the implementation chooses (the run-loop rule is `MIDIClientCreate`'s proc); the draft's Debug `assert(Thread.isMainThread)` would ship in the user's Debug build | MIDIServices.h:1426, 1451; IMPL-A #20 | **fixed in §0, §2.1, §7 B5**: the block only hops to main; no assertion |
| 7 · P2 | **"CoreMIDI runs there" was untagged** and the smoke had no plan if the simulator has no MIDI server | §8 (draft); nothing in stage A touched CoreMIDI | **fixed in §8, §10, §11**: a day-1 probe first; fallback = real `MIDIEventList`s injected below the server (parse → gate → batch → bridge → shim → midi.js → engine all real), steps 6–7 marked, the server path to the iPad pass |
| 8 · P2 | **"Skipped: our own endpoints" fails smoke steps 1 and 7** — "SYNTH smoke in" / "out" are our own endpoints and must be listed; the one exclusion is the "SYNTH" destination (never a source) | draft §2.1, §8 steps 1, 7 | **fixed in §2.1** (by `MIDIEndpointRef`, destinations only) |
| 9 · P2 | **"≤ 600 calls" for a 1 kHz stream depended on phase.** "≥ 5 ms idle → now, else wait ≤ 1 ms" races two 1 ms clocks: when the wait fires just before the next message every batch holds one → ≈ 1 000 calls | draft §3.2, §8 step 5, §9 | **fixed in §3.2, §8 step 5, §9**: a 2 ms minimum interval between flush starts — a hard 500 / s cap, a lone note still at once; gate ≤ 520 |
| 10 · P2 | **B3 needs a file no lane owned.** main-sim defines `navigator` after merging `o.win` and imports main.js right after — no hook can install the shim before boot (canvas-8-sim installs after boot and calls `enable()` itself, skipping `wire()`'s path) | main-sim.mjs:328, 337, 358; canvas-8-sim.test.mjs:293 | **fixed in §0, §7 B3, §10**: `o.beforeImport(G)`, one additive line, owned by S — **left for the lead**: owner I's nod on that line |
| 11 · P2 | **app-native.test cannot be "additive"**: :152 asserts `NSBluetoothAlwaysUsageDescription` **absent**, :158 the exact Swift file list — a builder either fails the suite or quietly edits stage A's assertions (read as a weakened test) | tests/app-native.test.mjs:152, 158 | **fixed in §0, §7 B5, §10**: two named, deliberate amendments of IMPL-A's static contract — **left for the lead**: confirm the amendment in IMPL-A's §13 when B lands |
| 12 · P2 | **Lanes waited on each other.** S's B3 asserted W's ⚙ row and `probe().midi` (absent at d461f7d); M's partial smoke listed "ports listed by the shim" with only a stub | draft §7 B3, B6; §10 | **fixed in §7 B3 / B4 / B6, §8 "Lane M's partial", §10**: the row and `probe().midi` are W's (via `api.midi.message`); B3 asserts node messages; M's stub is a recorder, page gates `pend` |
| 13 · P2 | **One call in flight could stall for good**, and a page-initiated reload kept `midiOpen`: `callAsyncJavaScript` fails calls whose frame / page went away; only a termination reset `ready` | WKWebView.h:329–333; ShellViewController.swift:146–167, 239–244 | **fixed in §3.1, §3.4, §5.1, §7 B5**: every completion clears in-flight; `didCommit` and termination reset `midiOpen`, the queue, the flag |
| 14 · P2 | **Unplug releases could lose the race with the list.** The draft sent `midiPorts` straight through `call()` while the CC 123 waited behind the in-flight batch; a shim filtering by `state` would then drop the release — a stuck note on the most common unplug | draft §2.1, §3.1, §1.2 | **fixed in §1.2 (deliver by handler, not state), §2.1, §3.1, §3.3 (one ordered queue), §8 step 6** |
| 15 · P2 | **Overflow broke B5.** "Notes past 4 096: the oldest dropped" can drop a note-off; "latest value per CC" thinned CC 64 and CC 123 too — a kept CC 123 moved after a later note-on kills it | draft §3.2 | **fixed in §3.2**: never thin CC 64–69 / 120–127; a kept value at its latest position; never-thinned overflow → the release path |
| 16 · P2 | **The user's first test may be silent, and nothing says how to run it.** With a keyboard app in front, a note into a never-started SYNTH calls `powerOn()` in a hidden page — [R?] whether WebKit starts a context there (stage A measured a running one); and the two routes (pick "SYNTH" vs the app's own output) double if both are on | main.js:1931, 1936; IMPL-A §12 N | **fixed in §3.4, §8 step 11 (recorded), §10 docs (a five-step how-to), §11** — **left for the lead**: the HANDOVER how-to and telling the user (Split View / Slide Over or play one key first; one route, not both; Panic) |
| 17 · P3 | `connection` was two-state and its events unspecified: the spec / Chrome open a port implicitly when `onmidimessage` is set (`pending` on a disconnected one) and fire `statechange` asynchronously — midi.js re-hooks on each (1 + inputs runs); a synchronous event would re-enter `hook()` mid-loop; Map order = the button's name order | midi.js:356–366 | **fixed in §1.2, §7 B1** (queued via `queueMicrotask`, not throttled timers) |
| 18 · P3 | The `midi` reply and a hot-plug `midiPorts` ride different channels; "reported once as disconnected" needed bookkeeping a restarted page never sees | draft §2.1, §3.1 | **fixed**: `gen` on both, newer wins; absent = disconnected (§1.2, §2.1, §3.1) |
| 19 · P3 | "A second call resolves the same object" would cache a rejection — midi.js's retry button could never succeed | midi.js:367–371, 397 | **fixed in §1.2, §7 B1** |
| 20 · P3 | `send(b)` gets a `Uint8Array` (midi.js:381–390) — a script message carries no typed array; the spec's `data` may hold several messages | IMPL-A §4.1 | **fixed in §1.2, §7 B1**: `Array.from`, split by status |
| 21 · P3 | A throwing `midimessage` listener must not cut the rest of a batch | — | **fixed in §1.2, §7 B1** (`dispatchEvent` reports; node's `EventTarget` re-throws on `process` — the test catches) |
| 22 · P3 | The walk must size every UMP type (FlexData 0xD, Stream 0xF, reserved) — a packet may carry several; a velocity-0 note-on must not mark a channel sounding | MIDIMessages.h:32–40 | **fixed in §0, §2.3** |
| 23 · P3 | "A sequencer sending ahead into the virtual destination is held natively" — the server already delivers sends to a destination at their time (advance schedule time 0); only other apps' virtual **sources** need the heap [R?] | MIDIServices.h:914–931 | **fixed in §0, §1.3, §2.4, §11** |
| 24 · P3 | "The same receive block, refCon = a reserved uid" — a virtual destination's block gets no refCon; the persisted uniqueID may collide | MIDIServices.h:350–367, 142–164, 2045–2048 | **fixed in §2.4** (a closure carrying the uid; keep the assigned id on `kMIDIIDNotUnique`) |
| 25 · P3 | `os_unfair_lock` as a Swift stored property has no stable-address guarantee | — | **fixed in §2.2, §7 B5**: `OSAllocatedUnfairLock` (ios 16, `import os` — already used by Smoke.swift:2) |
| 26 · P3 | Events a resumed receive thread hands over could slip through once main reopens the gate | draft §2.2 / §3.4 | **fixed in §2.2, §5.1**: the gate decided at arrival; stamps before `openedAt` dropped |
| 27 · P3 | Another app's absurd past stamp would date a note seconds early | draft §1.3 | **fixed in §1.3**: age clamped 0…2 000 ms |
| 28 · P3 | "The handler already answers in parts, SchemeHandler.swift:34" — it answers in one `didReceive(data)`; repeated calls are allowed by the API | SchemeHandler.swift:34; WKURLSchemeTask.h:48–57 | **fixed in §3.2** |
| 29 · P3 | "No worse than Safari + a USB keyboard on the Mac" — Safari has no Web MIDI; the baseline is Chrome | §5.2, §9 (draft) | **fixed in §5.2, §9** |
| 30 · P3 | Q2 (b) "hardware only" was not implementable as drafted (§2.1 connects every app's virtual source); (a) also means an app's own output plays SYNTH under its name, and both routes at once double | draft §2.1, §2.4 | **fixed in §2.1, §2.4, §11** (Q2's text unchanged) |
| 31 · P3 | `held` is per channel: a port's CC 123 also ends another port's notes on that channel | main.js:1917, 1958 | **recorded in §0, §3.4, §11** (accepted) |
| 32 · P3 | Smoke details: the Bluetooth step could leave an undismissable permission alert over every later step (no `simctl privacy` service for Bluetooth); the gate step's hidden sends must come within ≈ 1 s (the app may be suspended with its session let go); Sound in background through `#cvBg`, not the store; native's 1 kHz sender off the main queue the flush uses; the Mac's own devices if the server is shared; "inactive is not hidden" untested | ShellViewController.swift:285–289; IMPL-A §9.2 | **fixed in §8** (steps 8, 9, 12, the sender queue, match by name) |
| 33 · P3 | `probe().midi`'s counters are not "inert without SHELL" — they tick in browsers (harmless) | draft §6 | **fixed in §6** |
| 34 · P3 | WebKit's 1 ms `performance.now()` is a known fact here, not [R?] | HANDOVER §5 | **fixed in §1.3, §11** |
| 35 · fine | **midi.js runs unchanged on the surface**: it reads `navigator.requestMIDIAccess` lazily (:203, :247, :348, :395), `permissions.query` (:399–403), `inputs` / `outputs` `.values()` (:211, :360), `state`, `name`, the `onmidimessage` and `onstatechange` properties, `send(b)` with no timestamp — never `connection`, `id`, `manufacturer`, `open()`; :1120's no-options rule holds. Every type it decodes (note on / off incl. velocity 0, poly / channel pressure, CC, 14-bit bend with d1 = LSB as in the UMP word, PC) survives the byte rule; MPE member bends keep their per-(port, ch) thinning key; nothing in SYNTH wants clock (decode → null for every system message, :42) | midi.js; MIDIMessages.h:276–310 | — |
| 36 · fine | **A1 holds**: the shim never enters the site, its precache or lint (lint walks the root and `panels/` only — tests/lint.test.mjs:18; Smoke.js is the precedent); `midiOk()` / `navOf()` read lazily, so a document-start script reaches every reader; the three strings are the whole site diff | tests/lint.test.mjs:18; main.js:2219; midi.js:203 | — |

**Counts**: 4 P1 · 12 P2 · 18 P3 · 2 fine. Every P1–P3 is fixed in the text above. **Left for the lead**: the first-test how-to in
HANDOVER and telling the user (#16); owner I's nod on main-sim's one `o.beforeImport` line (#10); recording IMPL-A's two amended
app-native assertions (#11); whether the ⚙ "Sound in background" hint should also say it lets other apps play SYNTH (a fourth string,
outside B1's three — #5 / #16); if day 1 finds no MIDI server in the simulator, accepting the below-the-server smoke and moving the
server path to the iPad pass (#7).
