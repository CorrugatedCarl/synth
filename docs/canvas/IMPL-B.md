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
  // a NEW MIDIAccess per call with its own port objects, as Chrome (review 2 N4 — fixer S: a second caller's handlers never replace
  // midi.js's); ONE post { t: 'midi', on: true } per page (§3.1): calls in flight share it, later calls post nothing and resolve from the
  // known ports; opts.sysex === true → reject DOMException('…', 'SecurityError') (SYNTH never asks — midi.js:354; honest refusal beats a
  // silent lie); opts.software ignored. A refused reply → reject (midi.js shows 'MIDI blocked — click to retry') and is never kept: the
  // next call posts again (midi.js's retry button, :367–371 / :397, must work).
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
at the start of `midiIn`, keeps `off` = **the minimum of `recv − h` over every sample so far** (the `midi` reply's `h` the first, §3.1;
then one per batch) and stamps **`timeStamp = h − age + off`, clamped to `[recv − 2 000, recv]`**. `recv − h` = the clock offset + that
batch's transit; its minimum is the offset + the *fastest* transit (≈ the IPC alone), so a batch that waited for a busy page (a pinch, a
cold face raster at 100+ ms, a dialog) is stamped at its **arrival**, not its delivery — as Chrome stamps it.
**Amended after review 2 (F1, the lead's decision, 2026-10-23)** — the draft's 2 s sliding window emptied after any 2 s without MIDI, so
the first note of a phrase, the first after the access and any batch held > 2 s were stamped at their delivery (the page's stall folded
in, B6 broken on its commonest case). Now:
- **the minimum is kept across silence** (no window): a quiet spell changes nothing; a faster sample lowers it at once (a sample more than
  2 s *below* is simply a new minimum);
- **it reseeds only when a sample is more than 2 000 ms above it** — the clocks moved apart (a WebKit `performance.now()` that kept
  counting through a device sleep while `mach_absolute_time` stopped [R?]; if both are mach-based, as WebKit's MonotonicTime is on
  Darwin [R?], never). The batch that reseeds is **itself stamped against the kept minimum** (then clamped): one sample cannot tell a
  clock jump from a page held > 2 s (a dialog), so it takes the bound the two share — at most 2 s off, once (a 3 s dialog: its note
  stamped `recv − 2 000`, 1 s late, not 3; a jump: the first batch ≤ 2 s early, the next ones exact on the new seed). A later faster
  sample undoes a stall's reseed at once (it is a new minimum);
- **every stamp is clamped to `[recv − 2 000, recv]`**: never after the page received it (a future stamp, quantisation), never more than
  the 2 s the age clamp already allows before it (a batch held 1.5 s whose message was 1 s old natively → `recv − 2 000`, 500 ms late);
- **the first note after the access**: the reply's sample is `recv − h` of the reply itself — the offset + the reply's own transit,
  including any wait for a page busy at boot: an upper bound, never below the truth. The first batch is stamped from the better of the
  reply's sample and its own, so its error ≤ min(the reply's wait, its own) − the fastest transit (0 when either came promptly); the first
  prompt batch makes every later stamp exact. A later `requestMIDIAccess()` posts nothing, so samples nothing (§1.2, N4).
Within a page nothing drifts if both clocks are monotonic on one timebase; a page clock running *faster* than the host's would be followed
only by a reseed (≤ 2 s) — not expected on Darwin [R?]. Error ≈ the fastest transit (≤ 1 ms expected) + WebKit's `performance.now()`
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
Forward only while **`ready && midiOpen && (onScreen || (backgroundAudio && !backgroundExpired))`**:
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
| **B1 the shim alone** | `MidiShim.js`'s text evaluated (`node:vm`) against a fake window: `navigator` (no `permissions`), `performance.now` (settable), `EventTarget` / `Event` (node's), `SYNTH_SHELL` with a recording `post` that replies `{ ok, ports, gen, h }` a tick later. Cases: `requestMIDIAccess()` posts `{ t: 'midi', on: true }` **once** and resolves a **distinct** access per call, each with its own port objects (N4 — fixer S; the draft's "the same access twice" amended); after a **refused** reply (rejects) the next call **posts again** and can resolve; `{ sysex: true }` rejects a `SecurityError`; `inputs` / `outputs` Maps keyed by `String(uid)` with the record fields, in first-seen order; "From other apps" is an input and never an output; `midiPorts(list, gen)` diff → one `statechange` per changed port on the access **and** the port (`event.port`), a port absent from a list becomes `'disconnected'` and stays in its Map, the same id back flips the **same object**; a list with an older `gen` than the reply's is ignored, and one that lands before the reply is applied silently; **connection**: setting `onmidimessage` on a connected input → `'open'` and one `statechange` **after** the setter returns (a microtask — the event never runs inside the setter), on a disconnected input → `'pending'`, which turns `'open'` when it comes back; a stub `hook` that re-sets every handler on each `statechange` (midi.js's shape) runs exactly 1 + (inputs) times and terminates; `midiIn([h, 0, uid, age, 0x91, 60, 100, uid, 0, 0xd1, 7, 0, uid, 0, 0xf6, 0, 0])` → three `midimessage`s with `data` `[0x91,60,100]`, `[0xd1,7]`, `[0xf6]`; **timestamps** (§1.3) with a settable `performance.now` and chosen `h`: a fast batch then a batch delivered 150 ms late (`recv − h` + 150) → the late batch's `timeStamp` = its arrival + the fast batch's offset (error 0, not 150), `timeStamp ≤ recv` always, the minimum kept across silence and reseeded only by a sample > 2 000 ms above it, every stamp in `[recv − 2 000, recv]` (§1.3 as amended by review 2 F1 — fixer S's cases: after silence, at the access, under a 3 s stall, across a clock jump); `onmidimessage` and `addEventListener` both fire, in order; a throwing listener does not stop the rest of the batch (`dispatchEvent` reports it — node's `EventTarget` re-throws on `process`: the test installs an `uncaughtException` catcher for that case only); a closed port (`close()`, or no handler) gets nothing; a `'disconnected'` input with a handler still gets its messages; an unknown uid is ignored; `dropped > 0` warns once; `output.send([0x90,36,127])` → `{ t: 'midi-send', id, b: [144,36,127], delay: 0 }` with `b` a plain Array, `send(Uint8Array.of(0x90,36,127,0x80,36,0))` → two posts, `send(d, now + 20)` → `delay ≈ 20`, a data byte ≥ 128 / an empty array → `TypeError`, `0xF0…` → `InvalidAccessError`; `permissions.query({ name: 'midi' })` → `granted`, `{ name: 'geolocation' }` → the original; the file is `'use strict'`, has no `import` / `export`, no `fetch` / `XMLHttpRequest` / `WebSocket` (B3 on the page side) | `tests/app-midi.test.mjs` (S) |
| **B2 midi.js unchanged on the shim** | the same file: `createMidi(host)` with `nav` = the shimmed navigator and a fake button → `wire()` → **auto-enable** (the button 'MIDI: KeyStep, From other apps', title 'Connected MIDI inputs'); a batch note-on → `host.noteOn(60, 100/127, 1, ts)` with the shim's ts; a hot-plug list → `ports(names)` and the button; `send('Pad A', bytes)` → one `midi-send` per output of that name; midi.test.mjs's IMPL-8 rig cases (per-port handlers, `padIn`, `learnPad`, `outputs` / `send`) re-run on the shim instead of the stub access; `midi.js`'s source hash equals d461f7d's (the lead's sweep: `git diff --quiet d461f7d -- midi.js`) | `tests/app-midi.test.mjs` (S) |
| **B3 the page as the app** | `bootMain` as the WKWebView (app-shell.test's `WK` UA, `synth://app`, `o.win = { SYNTH_SHELL }`) **with the shim evaluated against the sim's window before boot** — through a new additive main-sim option **`o.beforeImport(G)`**, called once right after the navigator is defined (main-sim.mjs:337) and before `await import(url)` (:358); inert for every existing caller (lane S owns that one line, §10): the posts in order **`{ t: 'ready' }` then `{ t: 'midi', on: true }`**, both during boot's settle, no tap (§0 [R] — the draft's "before ready" could not pass: `boot()` is synchronous and `wire()`'s permission promise resolves after it); the `#midi` button 'MIDI: Pad Box, From other apps' (not disabled, no `unsup`); a note-on batch → `probe().held` 1 and the track's node got `{ t: 'on', n: 60 }`; a note-off clears it; CC 1 → the track's node got `{ t: 'wheel', v: 1 }`, bend `E0 7F 7F` → `{ t: 'bend' }` ≈ 1 (the messages, not `probe().midi` — W's, absent at d461f7d); a Pads module: `learn` → a note from the port named 'Pad Box' → `hw = { port: 'Pad Box', ch, n, cc: 0 }`, its light-back → `midi-send` to the 'Pad Box' output id (canvas-8-sim's scenario on the real shim); a Serum MIDI learn → CC 74 → `s.midi['74']` set and `writeCC` moved the knob's value; `midiOk()` true → the pads' hardware row present and the menu item enabled; **B5's page half**: CC 64 127, a note-on, then the release triple (`B0 40 00`, `E0 00 40`, `B0 7B 00`) → the node got `{ t: 'sus', v: false }` before the note's `{ t: 'off' }`, `held` 0. **Not here** (W's, in app-shell.test.mjs, so S never waits on W): the ⚙ Bluetooth row and `probe().midi` | `tests/app-midi-sim.test.mjs` (S; its own boot — one boot per file) + the `beforeImport` line in `tests/main-sim.mjs` (S) |
| **B4 browsers unchanged** | app-shell.test.mjs (W, the marker without the shim): ⚙'s rows after the canvas lines `['H3:App', 'DIV:Sound in backgroundOn', 'P:Keep playing when you switch apps', 'DIV:Bluetooth MIDIPair a device…', 'P:Pair a Bluetooth keyboard …']` (the exact tail at :184 is W's to extend) and the button posts `{ t: 'midi-bt' }`; `api.midi.message([0xb0, 1, 127])` / `([0xe0, 0x7f, 0x7f])` / a note → `probe().midi` `{ n: 3, wheel: 1, bend: ≈ 1 }`; app-shell-web (no marker): no Bluetooth row, `navigator.requestMIDIAccess` undefined, `midiOk()` false, `probe` absent; `tests/midi.test.mjs`, `canvas-8-sim`, `pads-core.test`, `cv-pads.test` pass untouched; lint (no new site import); pwa.test's index.html case with the new help sentence; the goldens / canonical-stream by construction (no DSP file in the diff — the lead's `git diff --stat`) | existing + `tests/app-shell-web.test.mjs` (W: one case) |
| **B5 the app's static contract** | app-native.test — additive cases **plus two deliberate edits of stage A's assertions, which this contract amends** (named so no reviewer reads them as a weakened test): :152's absent-keys list loses `NSBluetoothAlwaysUsageDescription` (now a required key with its text; the list keeps ATS, `UIRequiresFullScreen`, `NSPhotoLibraryUsageDescription`, `WKAppBoundDomains`), and :158's exact Swift list gains `Midi.swift`, `MidiBluetooth.swift`, `SmokeMidi.swift` (the A2 / A6 greps then cover them too). Info.plist has `NSBluetoothAlwaysUsageDescription`; the Swift: `MIDIInputPortCreateWithProtocol(` with `._1_0`, `MIDIDestinationCreateWithProtocol(`, no `MIDIClientDispose`, no `MIDINetworkSession`, no `import CoreBluetooth`, no `MIDIBluetoothDriver`, no `evaluateJavaScript(`, the frozen messages `"midi"`, `"midi-send"`, `"midi-bt"`, `"midi-clock"` in Bridge.swift, `midiIn(` / `midiPorts(` called through `call(` with `["b": …]` / `["list": …, "gen": …]`, the gate expression `ready && midiOpen && (onScreen || (backgroundAudio && !backgroundExpired))` (or its named equivalent — the test greps the four names in one condition, and **not** `foreground` in it), `onScreen` assigned in `sceneBackground`, `midiOpen = false` in `webViewWebContentProcessDidTerminate` **and** in `didCommit`, the release triple present (`64`, `0x40` / centre, `123`), the 2 048 / 4 096 caps and the 2 ms interval as named constants, no `isMainThread` assertion in the notify path, `presentationControllerDidDismiss` in `MidiBluetooth.swift`; `Midi.swift` imports CoreMIDI, Foundation and `os` only (UIKit only in the file that presents the sheet); `MidiShim.js` referenced as a Resource, **not** in `EXCLUDED_SOURCE_FILE_NAMES`, added by `installUserScripts` **after** the marker (regex: marker `addUserScript` precedes the shim's in the function body); `SmokeMidi.swift` / the MIDI smoke steps under `#if SMOKE` and `Smoke.drives` (IMPL-A's rule: the user's Debug build does nothing without `-smoke`) | `tests/app-native.test.mjs` (M) |
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
installs; the gate `ready && midiOpen && (onScreen || (backgroundAudio && !backgroundExpired))`, decided at arrival; the release triple (CC 64 = 0, bend centre,
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
- **Background suspension with Sound in background on (review 1 F1; fixer M)**: in the simulator (iOS 27.0) CoreMIDI deliveries to the
  hidden app stop **≈ 30 s after `sceneDidEnterBackground`** whether the engine is off, running silent or sounding — the server does not
  queue them (`dropped` stays 0, nothing arrives on return) — while the process itself keeps answering native timers (the simulator does
  not truly suspend it). The shell now holds a `beginBackgroundTask` from the background transition while `midiOpen && backgroundAudio`;
  its **expiration handler** (the live process, ≈ 25–30 s in) runs the gate's release path — the triple reaches the still-live page — and
  shuts the gate until the foreground, so a note straddling the edge is released, never stuck; messages past the edge are lost (counted,
  reported in the next batch, the shim warns once). **The device question** (the one iPad pass): whether a *sounding* SYNTH (the audio
  background mode with real output) keeps receiving past the task's expiry — WebKit attributes its audio to the app, so iPadOS may keep
  it running, in which case the expiry shuts MIDI while the sound goes on (the gate reopens at the foreground; a note held across the
  expiry is released by design). No host-side silent-audio keep-alive (the lead's decision: the device may not need it; it would mask
  the measurement). The how-to's first line stands: a MIDI app **beside** SYNTH in Split View never leaves the screen.
- **A release arriving mid-learn** (review 1 F9; fixer M — recorded, not fixed: midi.js and the shim are closed to the native fixer):
  the triple's CC 64 = 0 is a controller < 120, so a *pending Serum MIDI Learn* learns CC 64 if the pedal was down when the gate shut (a
  Home press with Sound in background off, an unplug, an overflow); a *canvas CC module in learn mode* learns CC 64 or CC 123 (main.js's
  `modCC` learns every controller). Needs the user mid-learn at the instant of a gate close — rare; the fix would be a page-side skip:
  native marks the release batch (e.g. a reserved value the shim turns into a flag on the event, or a `release: true` field beside `dropped`
  in §3.1's array — a protocol amendment for the lead) and the shim / midi.js skip learn for it; recorded in §12.
- **Background with the engine off** (§3.4, §8 step 11): whether a note can start a never-started AudioContext in a hidden WKWebView [R?] —
  the how-to sidesteps it (play one key in SYNTH first, or Split View / Slide Over).
- **Other apps**: an app that quits or is switched away mid-note without sending its note-off leaves the note sounding (nothing tells SYNTH)
  — Panic clears it; an app publishing its own output **and** pointed at "SYNTH" doubles every note (a retrigger, never a stuck note).
- **Future-stamped events**: into "SYNTH" the server delivers them on time [R: MIDIServices.h:926–931]; from another app's virtual source
  (§1.3) they are held natively until due — the main-thread timer's granularity (≈ 1 ms) and a stall (a dialog) add to their error; a
  sequencer sending clock (F8) gets no sync from SYNTH (dropped, §2.3) — SYNTH has no MIDI clock in or out in any build.
- **`performance.now()` coarseness** in WebKit (≈ 1 ms [R: HANDOVER §5]) bounds the timestamp precision below Chrome's; recording quantize covers it.
- **The simulator's MIDI server** ([R?] → R, §8 / §12 lane M): it runs (its own `MIDIServer`), not shared with the Mac — the smoke's in-app
  loopback is the proof; **the simulator's only "other app"** is `tools/midi-sender.swift` (reviewer 1's probe), a process spawned into
  the simulator that sends into "SYNTH" (it cannot create endpoints there: `kMIDINotPermitted`).
- **The "page zoomed · 1:1" chip after a Home round trip** (review 1 F3; stage A's R1-F1 symptom back on iOS 27.0 with the edge deferral
  already `[]`): WebKit leaves `visualViewport.scale` at 1.333 (= 1376 / 1032, the device's aspect) with the visual viewport's **width still
  the window's** — a state no real pinch produces (a zoom shrinks the width to `innerWidth / scale`). cv-world.js's one scale read now
  treats that state as 1 (the A1-safe guard; a real zoom still hands over); the native cause as far as the bisect reached is in §12.
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

- **(The lead, after the reviews.)** A MIDI learn pending when the gate's release triple arrives (the user mid-learn, the pedal down, at a
  background expiry / an unplug / an overflow) could learn CC 64 (midi.js:326) or, in a canvas CC module, CC 64 / 123 (main.js's `modCC`):
  rare; midi.js stays byte-identical (B1) and a marker would change the frozen protocol — recorded, not fixed. `gesture.js`'s `perPt()`
  reads the same stale `visualViewport.scale` (1.333 after a Home round trip on iOS 27.0) and narrows its edge band until the next viewport
  event — recorded (cv-world's guard covers the canvas pinch, the user-visible part).

## 12. Notes (the builders fill in)

### Lane M

**Built (worktree from 6a45072; commits cfcf3dd, 59349be, fdba8ac, the notes)**: `app/ios/SYNTH/Midi.swift` (≈ 370 lines; CoreMIDI,
Foundation, os only): the client created lazily at the page's first `{ t: 'midi', on: true }` (never disposed), `MIDIInputPortCreateWithProtocol`
`._1_0` on every listed source (private and offline skipped — offline read endpoint → entity → device), `MIDIOutputPortCreate`, the virtual
destination **"SYNTH"** (uid persisted in `UserDefaults` `midiDestUID`, re-set at creation, the assigned one kept on a failure), "From other
apps" last in the list, never an output; the receive block (CoreMIDI's thread) parses the whole event list to `(uid, at, st, d1, d2)` **outside**
the lock (every UMP type sized by a 16-entry table; F8 / FE dropped; CV2 counted `unexpected`), then **one lock per event list** for the gate at
arrival (`gateOpen`, `openedAt`), the masks, the append and the thinner (a refinement of §2.2's "append under the lock" per message — the same
rule, one lock instead of n; also what keeps the `@Sendable` closure free of mutable captures); the main-thread `flush` (a `DispatchSourceTimer`,
leeway 0, for the 2 ms interval and for held future stamps) → `pump` → **one `callAsyncJavaScript` per queue item**, the flat `[h, dropped, uid,
age, st, d1, d2 …]` array **built at the call** (so `h` is the host time of the call itself even when a port list sits ahead in the queue —
§3.1's letter); one ordered queue for batches and lists, one in flight, every completion clears it, `pageGen` ignores a late completion from a
reset page; the release triple built from the masks into `pending` (past the gate) on gate close / a gone port / a never-thinned overflow, then
a forced flush — so the releases are the batch before the list; thinning as §3.2 (a key per (uid, ch, kind, data); walked from the end, the
first-seen kept at its position; `nextThin` re-arms 256 past the current count so a stall is O(n), not O(n²)). `MidiBluetooth.swift`: a
`UINavigationController` subclass that is its own `UIAdaptivePresentationControllerDelegate` (keeps the delegate alive), Done + `presentationControllerDidDismiss`
+ the smoke's auto-dismiss + `cancel` all run the one `settle`; `preferredContentSize` 360 × 480; a popover from the web view's top centre.
`Bridge.swift`: the four messages (+ the Debug `-smoke`-only `smoke-midi` behind `case … where Smoke.on` — `__smoke.midiNote(n, v)` /
`midiCC(cc, v)` for reviewer R1's by-hand runs); `ShellViewController`: `MidiHost.midiCall` (every completion reaches Midi), the shim user script
right after the marker (both installs, through the one `installUserScripts`), `didCommit` → `midi.pageReset()`, termination → `midi.ready =
false; midi.pageReset()`, `sceneBackground` → `midi.onScreen`, `bridgeBackgroundAudio` → `midi.backgroundAudio`. `Info.plist`:
`NSBluetoothAlwaysUsageDescription`. `project.pbxproj`: the three Swift files + `MidiShim.js` as a Resource (ids `…1C–1F` / `…2C–2F`).
`SmokeMidi.swift` + `Smoke.js` `__smoke.midi*` + `tools/app-smoke.sh`: §8's steps (below) and their gates; `-smokeMode midicold`;
the script drives the background round trips on the log's `"step":"ready"` / `"bgdone"` lines (behind Safari, then `simctl launch` back).
`tests/app-native.test.mjs`: B5 (one test, ≈ 60 assertions) + the two amended stage-A assertions (recorded in IMPL-A §12).
**MidiShim.js**: lane S's shipped on `wt-B` mid-lane; the smoke below ran against **S's real shim** (copied into the tree, uncommitted here — S's file
to merge), not the recorder stub (kept at `scratchpad/midi/m/MidiShim.stub.js`, never committed). The web side is 6a45072's: `probe().midi` and the
⚙ row (lane W) are the smoke's two `pend` lines until integration.

**Day 1 (in this order, §10)**. (1) **CoreMIDI runs in the simulator** — [R? → R]: the iOS 27.0 runtime has its own `MIDIServer`
(`…/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/System/Library/Frameworks/CoreMIDI.framework/MIDIServer`, a child of `launchd_sim`,
launched on demand); in the app `MIDIClientCreateWithBlock` → 0 in **12 ms**, the input / output ports 0, `MIDIDestinationCreateWithProtocol`
0, the smoke's `MIDISourceCreateWithProtocol` / destination 0 — **the smoke runs in server mode (the in-app loopback); the below-the-server
fallback was not built**. A bare `simctl spawn` process (no app sandbox) also creates a client (0, but ≈ 700 ms) and sees 2 devices, 0 sources /
0 destinations, yet gets **`kMIDINotPermitted` (−10844)** for virtual endpoints — the sandbox, not the server. **Not shared with the Mac**
[R? → R]: with a Mac-side virtual source live ("SYNTH Mac probe", `swift` on the Mac) the simulator client saw 0 sources, and the Mac saw none
of the simulator's — so `tools/midi-probe.swift` is **dropped** (§8's rule; the two probes stay in the scratchpad, not the repo) and the Mac's
devices never appear in the smoke's lists; the loopback is the proof, the real server path with another app waits for the iPad pass.
(2) **The per-call cost** of a tiny `callAsyncJavaScript` (1 000 sequential calls, a 12-number array, the same body as a batch): **mean 0.12 ms,
p50 0.085, p90 0.21, p99 0.45, max 2.8 ms** (two runs, identical) — far under §3.2's 5 ms line: **no streaming fallback**. (3) Sharing: above.
Also pinned: `MIDIReceivedEventList` takes **no "0 = now"** (MIDIServices.h:2517 — the smoke's source stamps `mach_absolute_time()`; a 0 stamp
from a virtual source is a 1970 arrival, clamped to age 2 000 by the shim); `MIDIEventPacketNext` + the raw `words` offset walk the list fine
from Swift (no overlay helpers used).

**Smoke (`tools/app-smoke.sh`, three full runs m1 → m3 on cfcf3dd / 59349be / fdba8ac; S's shim; m3 = `0 failing, 2 pending` (W's);
the stage-A gates all still green; 0 console errors; 135 requests all `synth://app/`; the `.app` 10.1 MB; WebContent at the engine step
582–585 MB, the MIDI steps add nothing visible; the run 62–66 s)**. Every native MIDI gate green from the first run (the five m1 FAILs were the
evaluator's: two log-kind collisions, a wait race, the re-created source's new uid, `Smoke.log`'s `at` key overwriting a JS field named `at`).
Numbers (m2 / m3; m1 in brackets where different): step 1 the button "MIDI: SYNTH smoke in, From other apps" by itself at boot (`ready` 903 /
896 ms, the page's `midi on` 915 / 909 ms, `createMs` 12.2 / 12.3 — m1: 1187 → 1877, the first launch of a CoreMIDI build in that simulator
session; a one-off); step 2 the note sounds (held 1, peak 0.155) and the note-off → held 0; step 3 CC 1 / bend in order; step 4 the common
clock: best rtt 0 ms at WebKit's **1 ms `performance.now()` quantum** (offset ± 0.5 ms — the floor of every transit figure below); **step 5,
1 kHz × 1 000 CC 74**: 1 000 / 1 000 in order, **450 / 451 calls** (sizes 1–4, p50 2 — the 2 ms interval holds), **0 dropped**, one-way
transit **p50 0.77–1.24 / p99 1.8–2.26 / max 2.8–4.2 ms** [1.36 / 2.42 / 5.36], timestamp error **p50 −0.55…−0.76, p95 |e| 0.55–0.76 ms**
[0.30] (B6; the shim's minimum filter; the sign: the stamp a little before the clock step's estimate — the step's own ± 0.5); **step 5b** the
page spun 150 ms: the 5 notes' transit 150 / 134 / 114 / 94 / 74 ms (delayed as Chrome would), their **timestamp error −0.75 ms each** (B6
under load — the draft's scheme would have read ≈ 150 / 130 / …); **step 6 hot-plug**: dispose → the source's **CC 123 then its disconnect,
in that order** (one queue), `held` 0, the button "MIDI: From other apps"; the notification reaches the app **≈ 300 ms** after the dispose
(≈ 250 ms the server's + the 50 ms debounce), the same after the re-creation, which lists a **new uid** for the same name (the old entry
stays `disconnected` in the Map, Chrome's way); **step 7** the page's `send` to "SYNTH smoke out" → `90 24 7F` in the destination's block
**0.75 ms** after the page's `send`; **step 7b future stamps — [R?] → R, both ways**: a **virtual source's** note stamped 300 ms ahead
reached our input port **0.28 ms after its stamp, no `midiHeld` line — the server holds a source's future stamps too** (§1.3's "delivered
as sent" is not what this server does; the native hold in `flush` is a safety net that never ran, kept: ≈ 10 lines, correct if a server
ever delivers early); a note sent **into "SYNTH"** 300 ms ahead arrived from "From other apps" **−0.04 ms** after its stamp (advance schedule
0 — §2.4's [R] confirmed on this server), one stamped 0 at once (0.9 ms); the shim's stamps on both within 0.23 ms; **step 8 the gate**: Sound in background off, pedal + note down,
behind Safari: `open: false` at `sceneDidEnterBackground` with **released 2** (CC 64 = 0, CC 123 on ch 1 — the pedal case of review #4),
the 3 sends while hidden **dropped at arrival** (`dropped 0 → 3`, rode in the next batch; the shim warned once), back on screen the gate
reopens and the next note plays; the page saw `B0 40 7F · 90 3E 64 · B0 40 00 · B0 7B 00` — the closing batch carries what was pending,
then the releases; **the app kept running hidden** (native timers fired; the simulator does not suspend it); **step 9** the scene inactive
with Sound in background off: nothing released, nothing dropped, the CC delivered (the gate follows `onScreen`, review #5); **step 10 lone
notes** (50 × 200 ms): transit **p50 0.0–0.5, p90 0.5–0.9, p99 0.7–1.05, max 1.05 ms** [1.11 / 1.12 / 1.12] (the quantum is the
floor), 50 batches of 1 — **no coalescing delay on a lone note** (B4); **the stall** (a `confirm()` held the page 1.04 s while native
streamed 4 kHz × 4 000 with a note pair every 40): the in-flight call completed after 975 ms, then **one batch of 2 001–2 050** (1 945
thinned, CC 74 at its latest value, **all 200 notes intact**), then 8–9 per 2 ms call — exactly §3.2 (no overflow, no CV2 word); **step 12** `{ t: 'midi-bt' }` replies in
4–92 ms, the sheet shown ≈ 0.5 s later (the Presenter's animation), auto-dismissed at 2 s, **the Save sheet right after it presented** (the
settle rule; no `scene inactive` while it was up — the simulator shows no Bluetooth permission alert). **`-smokeMode midicold`** (§8 step 11,
recorded — [R?] pinned): no key played, Sound in background on, behind Safari, one note from the smoke source → the page's `powerOn()` ran
in the hidden page (`{ t: 'engine', on: true }` 45 ms later; the first batch's rtt 89 ms — the engine's start) but **WebKit left the new
AudioContext `suspended`** (`midiColdBg`: ctx "suspended", held 1, peak 0); back on screen: ctx running, **peak 0.155 — the held note
sounds on return**. So the how-to's "play one key in SYNTH first (or Split View / Slide Over)" is necessary, not cautious: a never-started
engine stays silent while SYNTH is hidden, and the note arrives when it comes forward.

**Refinements of the contract's text (reasons)**: the UMP word for `send` is composed by shifts (`0x2 << 28 | st << 16 | d1 << 8 | d2`,
system `0x1 << 28`) — the same bits as `MIDI1UPChannelVoiceMessage`, no inline C helper needed; the walk sizes types by its own table rather
than `MIDIEventListForEachEvent` (the bytes out are §2.3's; B5 greps the table); the smoke's MIDI steps run **after the files steps** (the
sheet totals are absolute, and the Bluetooth step's Save sheet needs a known count) with the engine still on — not right after the engine
step; the transit gates are **2× the §9 targets** (the contract's own "recorded, gated loosely"; the measured values are 2–4× under the
targets); a port's **relist at boot** (gen 2, one redundant `midiPorts`) follows from our own endpoint creations' notifications — the shim's
`gen` rule makes it a no-op; `Smoke.log` owns the `at` key, so a JS step's time field is `sentAt`; the `midicold` round trip and the gate
step are driven by the script from the log, not by a timer (the simulator's `simctl launch` brings the running app back). **Not done /
pending**: lane W's `probe().midi` (two `pend` lines) and the ⚙ row, at integration (W is on `wt-B`); the one iPad pass (another app →
"SYNTH", Bluetooth, a USB keyboard — §11); `tools/midi-probe.swift` dropped. Not touched: engine / DSP / model files, midi.js, main.js,
index.html, cv-pads.js, sw.js, `MidiShim.js` (S's).

### Lane S

(2026-10-23, Opus 5.5; worktree reset to 6a45072 — d461f7d's site, this contract. Commits: `8236b3d` the tests first, red (no
`MidiShim.js`: ENOENT) + main-sim's line, `33fccc1` the shim, then these notes. Not pushed; `sw.js` untouched — nothing of S is in the site.)
**As built — `app/ios/SYNTH/MidiShim.js`** (215 lines, a classic IIFE, `'use strict'`; no import / export, no fetch / XHR / WebSocket,
no timers, nothing logged per message):
- Runs only with the marker (`window.SYNTH_SHELL` an object) and only where `navigator.requestMIDIAccess` is absent — so lane M's
  `installUserScripts` must add it **after** the marker (a shim injected first stands aside: nothing defined, no harm).
- `navigator.requestMIDIAccess(opts)` (own, non-enumerable, like a method): `opts.sysex` → `SecurityError`, nothing posted; the
  first call posts `{ t: 'midi', on: true }` — calls in flight share it — and resolves on `{ ok: true, ports, gen, h }` with the
  one `MIDIAccess` (later calls: the same object, no post); `{ ok: false, error }` → `InvalidStateError` (the spec's "the underlying
  system raised an error"), a `post` that throws / rejects → `NotSupportedError`; a rejection is never kept (the next call posts again).
- `MIDIAccess` (EventTarget): `inputs` / `outputs` plain Maps keyed `String(uniqueID)`, first-seen order; `sysexEnabled` false;
  `onstatechange`. `MIDIPort`: read-only `id name manufacturer version('') type state connection`, `open()` / `close()` → `Promise<port>`,
  `onstatechange`; `MIDIInput`: `onmidimessage` + `addEventListener('midimessage')` (each set / add opens: 'open' on a connected port,
  'pending' on a disconnected one); `MIDIOutput`: `send(data, timestamp?)`, `clear()` (no-op). Handler attributes are real listeners
  (one per attribute, swappable, a non-function removes it). Every state / connection change: one `statechange` (`event.port`) on the
  port, then the access, in **one microtask** (never in the setter, never a timer); none before the access reached the page.
- `SYNTH_SHELL.midiPorts(list, gen)`: applied only if `gen` is newer than the last applied (a non-finite `gen`: applied); records with an
  id and type `input` / `output` make or update their port (same object per id; `name` / `manufacturer` follow the list), absent ones
  (or a record `state: 'disconnected'`) → `'disconnected'`, kept; open ↔ pending follows. `SYNTH_SHELL.midiIn(b)`: `recv` once, the
  §1.3 sliding minimum (a monotonic deque of `[recv, recv − h]` over 2 000 ms, the reply's `h` the first sample), per message: input by
  `String(uid)` (unknown → skipped), skipped if its connection is `'closed'`, `data` a `Uint8Array` sized by the status (2 for Cn / Dn,
  F1, F3; 3 for 8n–Bn, En, F2; 1 for F6, F8, FA–FC, FE, FF; F0 / F7 / reserved F4 F5 F9 FD / a non-status → skipped), age clamped
  0…2 000 page-side too, `timeStamp = min(recv, h − age + off)` (no finite `h`: `recv`), dispatched with `dispatchEvent` in order;
  `dropped > 0` → one `console.warn` per page.
- `send`: Chrome's checks in the spec's order before anything is posted — values as `unsigned long` (> 0xFF a `TypeError`), running
  status / a reserved status / an incomplete message / a data byte ≥ 0x80 / nothing → `TypeError`, F0 / F7 → `InvalidAccessError`, a
  disconnected port → `InvalidStateError`; the implicit open (one `statechange`: midi.js re-hooks once, as in Chrome); one
  `{ t: 'midi-send', id, b: [st, d1?, d2?], delay }` per message, `b` a plain Array, `delay = max(0, timestamp − now)` (0 when absent,
  0 or past); the reply and any throw swallowed.
- `navigator.permissions.query`: `{ name: 'midi' }` → a `granted` status (`sysex: true` → `denied`) — an EventTarget with `name`, `state`,
  `onchange: null`; every other name → WebKit's own `query` (its `this`); no `navigator.permissions` (the node sim) → one is made, other
  names reject a `TypeError`.
**[C] refinements (reasons)**: (1) main-sim's `o.beforeImport(G)` sits after `G.__synthTest` (the finished fake window — `performance` of
an `o.clock` boot, the Fullscreen API), not straight after :337 — still before the import, one line, inert without the option; a
document-start script sees the whole window too. (2) The stand-aside rule above (a future WebKit with Web MIDI keeps its own; native
then never gets `midi on`). (3) The two refusal names; midi.js reads neither. (4) A rename updates silently (the spec fires
`statechange` for state / connection only). (5) `permissions.query` with `sysex` answers `denied` — honest, SYNTH never asks.
**Tests** (one file at a time, `--max-old-space-size=2048`): `tests/app-midi.test.mjs` **14 / 14** — B1 (11: the file's rules + the
stand-aside; the access once / shared / SysEx; a refusal not kept, NotSupported on a missing bridge; the Maps and records; lists, gen,
the silent early list, events port-then-access; connection incl. the hook shape = 4 runs for 3 inputs; midiIn sizes; the timestamps —
the 150 ms late batch stamped at its arrival, the clamps, the window recovering upward at 2 001 ms; delivery incl. a throwing listener
via node's `uncaughtException` with the harness's listeners set aside; send; permissions), B2 (3: midi.js sha-256 `3b1664ed…0919` =
d461f7d's; `wire()` → auto-enable 'MIDI: KeyStep, From other apps', `ports()` 1 + 2 times, `noteOn(60, 100 / 127, 1, 1197)` with the shim's
stamp, hot-plug, `send` to both outputs named 'Pad A'; the IMPL-8 rig cases incl. a refusal then the button's retry). `tests/app-midi-sim.test.mjs`
**6 / 6** — B3: posts `bg`, `ready`, then `midi` during boot's settle (no tap); '#midi' 'MIDI: Pad Box, From other apps', enabled, no `unsup`;
`inputs()` / `outputs()` ('From other apps' never an output); note on / off → `held` 1 / 0 and the node's `on` / `off` (also from 'From
other apps'); CC 1 → `wheel` 0, 1; bend → ≈ 1, centre 0; B5's page half: `sus:true, on:62, bend, sus:false, bend:0, off:62`, `held` 0; Pads:
the 'Hardware controller…' item enabled and the inspector's learn row (midiOk()), learn → `{"port":"Pad Box","ch":10,"n":100,"cc":0}` (one
step 'Learn pad 3'), a hit plays the pad's note (not 100), the light-back `{ t: 'midi-send', id: '201', b: [153, 100, 127], delay: 0 }`; a
hot-plug off / on through `midiPorts` (the same port object, re-opened); a Serum learn `a.wt` ← CC 74, then CC 74 writes it (> 0.99, < 0.01).
**B1 proof** (at `33fccc1`): midi 34 / 34, main 47, canonical-stream 1, golden-classic 8, lint 165, canvas-8-sim 17, pads-core 23,
app-shell 17, app-shell-web 4, app-native 10 — all green; `git diff --quiet d461f7d -- midi.js` true; `git diff 6a45072 --stat`: the shim,
the two test files, main-sim's one line. No site file touched (so no BUILD change from S).
**Noted**: app-midi-sim's Serum step logs `TypeError: doc.getElementById is not a function` — wk.js `injectStyles` on the DOM stub's
`ownerDocument` while main.js mounts the Serum panel (caught there; any sim that mounts a Serum panel does it) — not MIDI.
**Not pinned here** (lane S runs no simulator): WebKit's own answer to `permissions.query({ name: 'midi' })` [R?] — moot for the app (the
wrap answers before WebKit sees it); R1 can confirm `'geolocation'` still reaches WebKit's. **For lane M** (the protocol as the shim
reads it): a record's `id` and a batch's `uid` must agree as `String(uid)` (`String(Int32)` in Swift prints the same as JS's); the reply
needs `ok: true` (exactly), an Array `ports`, a Number `gen`, a Number `h`; `midiIn`'s array is flat, 2 + 5 × n numbers; M's recorder stub is
superseded by this file (same name, same Resource).

### Lane W

Built on `6a45072` (worktree branch `worktree-agent-a1180e0297fd1e8b7`; code + tests `37f0a45`). Files touched, exactly §10 row W:
`main.js` (+23 / −6), `index.html` (the one sentence), `cv-pads.js` (the one string), `tests/app-shell.test.mjs`,
`tests/app-shell-web.test.mjs`. midi.js byte-identical (`git diff 6a45072 -- midi.js` empty); no DSP / engine / model file; sw.js untouched
(the lead runs `node tools/precache.mjs --write`: main.js / index.html / cv-pads.js moved → pwa.test's precache case is red until then, as
expected). The W diff is inside §9's ≤ 40 lines.

**The strings as shipped** (the whole web-side visible diff — the three of §6 plus the lead's fourth):
1. index.html:291, only this sentence on the line (a word-diff shows the single changed token, `Firefox)` → the longer parenthesis, so the
   other builder's **Delete / Backspace** edit in the same paragraph merges by hand without overlap): "Or plug in a MIDI controller (Chrome, Edge, Firefox — and the SYNTH app on iPad: USB, Bluetooth, or another MIDI app sending to it) — each track listens on its MIDI channel."
2. cv-pads.js `NO_MIDI`: "Hardware pad controllers need a browser with Web MIDI — Chrome or Edge on a Mac, or the SYNTH app on iPad. iPad browsers have none."
   (no test pinned the old text — grep of tests/ and docs: only IMPL-8.md §8 quotes it as history).
3. ⚙ → App, after "Sound in background" (inside the existing `if (SHELL)` block): a field row **Bluetooth MIDI** + button **"Pair a device…"**
   (`#cvBt`, class `tt`, `aria-describedby` → the hint `#cvBtHint`), hint "Pair a Bluetooth keyboard or pad controller (USB and other apps
   need no pairing)"; the click is `shellPost({ t: 'midi-bt' })` — fire-and-forget (shellPost never throws; a refused or missing handler is
   swallowed by `quiet`, so an older app build on this site does nothing visible). Button title: "Opens Apple’s list of nearby Bluetooth MIDI
   devices to pair one with this iPad. USB controllers and other music apps need no pairing". Exposed as `shell.bt` beside `shell.bg`.
4. The fourth string (lead's decision #5 / #16): the ⚙ Sound in background hint — "Keep playing when you switch apps — so a MIDI app in
   front can play SYNTH" (was "Keep playing when you switch apps"). The button's title (On / Off semantics) is unchanged and still true.

**`probe().midi` = `{ n, wheel, bend }`** (`midiSeen`, three assignments in the `createMidi({…})` host lambdas, read only through
`SHELL.probe`; the counters tick in browsers too, nobody reads them there). The contract's wording ("incremented in noteOn / noteOff / ctl for
src 1–16 and in modCC") would count a CC 1 **twice** (midi.js calls `modCC` for every CC, then `ctl('wheel')`), which contradicts §7 B4's own
expectation (CC 1 + bend + a note → `n: 3`); refined [C]: **`n` counts notes on / off (host noteOn / noteOff), every CC once (modCC — the
wheel and the pedal ride their CC, so `ctl('wheel' | 'sus')` do not count), bend and channel pressure (`ctl('bend' | 'at')`)**; poly pressure and
program change are not counted (their host callbacks are not in the contract's list); real-time / system bytes decode to nothing and are
not counted. `wheel` = the last `ctl('wheel')` value (0…1), `bend` = the last `ctl('bend')` (−1…1; `E0 7F 7F` reads 0.99988, `E0 00 00` −1).
The host lambdas still return what the underlying call returns. Only the host lambdas count (src 1–16 = MIDI channels): the on-screen
wheels, keys and pads call `ctl` / `noteOn` directly and are not counted.

**Tests (red first for the ⚙ rows and the probe; run one file at a time, `--max-old-space-size=2048`)**
- `tests/app-shell.test.mjs`: the exact tail at :184 extended to `['H3:App', 'DIV:Sound in backgroundOn', 'P:Keep playing when you switch apps —
  so a MIDI app in front can play SYNTH', 'DIV:Bluetooth MIDIPair a device…', 'P:Pair a Bluetooth keyboard or pad controller (USB and other apps
  need no pairing)']`; new **B4 ⚙ Bluetooth MIDI** (id / type / class / text / describedby, one `{ t: 'midi-bt' }` per tap and nothing else,
  a rejecting native is quiet); new **B4 probe().midi** (zero before any message; CC 1 127 → `{ n: 1, wheel: 1 }`; bend; note on holds the
  key; note off; CC 64 on / off count once each; channel pressure; bend −1 and wheel 0 take over; JSON-clean; F8 / FE not counted) driven by
  `api.midi.message` — no shim needed; the existing "probe() before power-on" test asserts `midi` is `{ n: 0, wheel: 0, bend: 0 }`.
  Red before the code: 4 failures (the two edited, the two new); green after: 19 / 19.
- `tests/app-shell-web.test.mjs` (browsers, no marker): **B4** no Bluetooth / Pair / "MIDI app in front" row, `shell.bt` undefined,
  `navigator.requestMIDIAccess` undefined, no `SYNTH_SHELL` ever created (so nothing can be posted or probed) — passes before and after, as
  a guard; **B1** the two visible strings read from index.html and cv-pads.js (the help sentence once, the old wording gone; `NO_MIDI` exact)
  — verified red with both strings temporarily reverted, green restored: 6 / 6. (`sim.$()` returns a stub element for any selector, never
  null, so the "no `#cvBt`" check goes through the rows and `shell.bt`, never an `assert` on a node.)
- Gates, each file alone: main 47 / 47, lint 165 / 165, midi 34 / 34, pads-core 23 / 23, cv-pads 31 / 31, canvas-8-sim 17 / 17,
  cv-shell-sim 17 / 17, canvas-P-sim 8 / 8 (both read ⚙'s rows), canonical-stream 1 / 1, app-shell-web 6 / 6, app-shell 19 / 19;
  pwa 24 / 25 — the one red is the precache BUILD hash ("a site file changed since `node tools/precache.mjs --write`"), the lead's step.
  Goldens not run here (no DSP file in the diff — `git diff --stat` shows main.js, index.html, cv-pads.js and two tests).

### Reviews and fixes

**Fixer S — review 2's F1, N4 and F5's shim half** (2026-10-23, Opus 5.5; worktree reset to d705713. Commits: `d5f4736` the tests,
red — app-midi 5 failing, app-midi-sim 2 —, `5ae350e` the shim + §1.3, then these notes. Not pushed; `sw.js` untouched — the shim is
an app resource, not in the precache.)
- **F1 (major) — the lead's decision, §1.3 amended in place**: the offset estimate keeps its minimum across silence (the 2 s window is
  gone), is lowered at once by a faster sample, **reseeds only on a sample more than 2 000 ms above it** (that batch stamped against the
  kept minimum), and **every stamp is clamped to `[recv − 2 000, recv]`**. `MidiShim.js`: `base(t, h)` replaces `sample` (`off` starts
  `NaN`: the reply's sample seeds it). Review 2's repro (`r2/repro-shim.mjs`) after the fix: 1c 7150 → **7000**, 2 3500 → **3300**,
  3 4100 → **2100** (the clamp's bound; 1 s late, not 3); 1a / 1b / 1d / 1e unchanged. **Tests** (`tests/app-midi.test.mjs`): the
  timestamp case's `at(3401, 7391, [0])` **amended on purpose** `'3401'` → `'3391'` (it pinned F1: one sample 2 s after the minimum
  lifted it — named in the test as the amendment, not a weakened gate) and `at(3500, 7480)` → `'3480'`; a new case "after silence, at the
  access, under a stall, across a clock jump", each sub-case seen red / green with `fxS/f1-cases.mjs` against the old / new shim — red
  before: silence + 150 ms (7150), the first note 2.3 s after the access (3500), the 3 s dialog (4100), a +10 s clock jump's first batch
  (20000 → now 18000: the decision's trade, once, ≤ 2 s), the clamp (`'1200 200 -800'` → `'1200 700 700'`); guards (green before and
  after): a slow reply (120 ms) with the first note held 50 → 1550 then exact, a 20 ms reply → 1520, the fast batch after the dialog
  (4110: the reseed undone), the jump's later batches (20100, 20200 with a 150 ms wait), a −10 s jump (a new minimum at once: 5000).
- **N4 (nit) — a new `MIDIAccess` per `requestMIDIAccess()`, Chrome's way**: checked in Chromium (`midi_access_initializer.cc`
  `StartSession` → a new `MIDIDispatcher`; `DidStartSession` → `new MIDIAccess(…)`; `midi_access.cc`'s constructor makes its **own**
  `MIDIInput` / `MIDIOutput` per access, and "open" status is managed per MIDIAccess instance) — so the shim now gives each call its own
  access **and its own port objects** (not shared: Chrome shares none). The known ports are shared records (id, type, name, manufacturer,
  state — native's truth); `connection`, the handlers and listeners belong to each port object; a hot-plug flips every access's port
  (statechange on each port, then its access); a new id appears in every access; `midiIn` delivers each message to every access's port
  of that id that is not `'closed'` (one stamp, a new `data` per event). One post per page: calls in flight share it, later calls post
  nothing and resolve at once from the known ports (a gone one `'disconnected'`, all `'closed'`); a refusal is still never kept. Every
  access is kept for the page's life (midi.js asks once, Smoke.js once). **Tests**: app-midi's "requestMIDIAccess" case now asserts
  three distinct accesses for three calls (one post) — the contract's old "the same access twice" amended by N4; a new "several
  accesses" case (own ports / connection / statechange; a second caller's `onmidimessage` never replaces the first's, both get every
  message; hot-plug and a new port in each; a closed port in one, pending in the other; a later access); the IMPL-8 rig case reads
  midi.js's own access through a recording navigator (a second `requestMIDIAccess()` there now shows none of midi.js's handlers —
  asserted). app-midi-sim's hot-plug case: the test's own access has its ports `'closed'`, `onmidimessage` null; its handler and
  midi.js's both get a note from the re-plugged port (held 1 → 0) — red before (the shared access handed it midi.js's open port).
- **F5 (the shim half)** — `tests/app-midi-sim.test.mjs` **B6**: recording armed (count-in 0), 2 s of song rendered, a settable page
  clock (the real one continued; main.js, the shim and the test read `performance.now()` at call time): a prompt note with age 30 →
  recorded at `round(curTick(recv − 30))` (3657 — a guard, green before); then 5 s without MIDI and a note native dispatched 150 ms
  before the busy page ran it → recorded at `round(curTick(dispatch))` = 3811, ≈ 288 ticks (150 ms at 120 BPM) before its delivery's
  4099 — **red before** (recorded 4099: F1 through midi.js's real `noteOn(…, ts)` → `recStart` → `recTick(ts)` path).
- **Gates** (one file at a time, `--max-old-space-size=2048`): app-midi 16 / 16, app-midi-sim 7 / 7, midi 34 / 34, main 47 / 47,
  app-shell 19 / 19, app-shell-web 6 / 6, canonical-stream 1 / 1, lint 165 / 165, app-native 11 / 11. midi.js byte-identical (app-midi's
  hash case). `MidiShim.js` 226 lines (≤ 300).
- **Left for the lead (outside S's sections)**: §1.2's line "one shared MIDIAccess per page (a second call resolves the same object)"
  → "a new MIDIAccess per call with its own port objects, as Chrome; one post per page (calls in flight share it; later calls post
  nothing); only a fulfilled access is cached …" (N4); §7 B1's "resolves the **same** access twice" and "the offset recovers upward
  after the 2 s window" → this section's cases; `Smoke.js:131`'s comment "listeners on every input of the shared MIDIAccess" — the smoke
  now hooks its **own** access (it works unchanged: its listeners open its own ports, which logs a few `{ k: 'state', state: 'connected' }`
  entries at `midiOpen`; the step-6 gate reads only `'disconnected'` entries, and a disconnect still reaches every access); §9's
  timestamp budget stands (5b's 150 ms spin is inside the minimum either way).

**Fixer M (native) — review 1's F1, F2, F3, F4, F5 (text), F6, F8, F9; review 2's F2, F3, F4, N1, N2, N3, N5** (2026-10-24, Fable 5.1;
worktree reset to 223335e. Commits: `1b5bd38` the code, the tools, the tests; the notes commit. Not pushed; `sw.js` untouched on the
branch — main.js, index.html and cv-world.js changed, so **the lead runs `node tools/precache.mjs --write`**; the smoke ran on a
throwaway commit carrying only the rebuilt BUILD hash, dropped afterwards — the app bundle never contains sw.js.)
- **Failing tests first** (all seen red at 223335e, outputs in `scratchpad/midi/fxM/red-*.out`): app-native 10 / 12 (the two MIDI
  cases), cv-world 76 / 77, app-shell 18 / 19, app-shell-web 5 / 6; **the harness** — `tools/midi-harness/run.sh`, reviewer 2's macOS
  harness made a repeatable gate: the REAL `Midi.swift` + `Smoke.swift` compiled with `main.swift`'s fake host and 21 cases, exit = the
  failure count — against the old `Midi.swift` (a scratch variant for the old API) **10 of 21 red**: 2 / 2b (R2-F2: CC 64 = 0 / bend
  centre "NONE" after the overflow), 3a / 3b (R2-F4: 3D and 3F dropped), 7b / 7d (R2-F3: "DEAF" at every gap ≤ 200 ms), 8 (R1-F2:
  `3:B0 7B 00 | 3:E1 00 40 | 9:B0 40 00 | 9:B0 7B 00`), 9 (R1-F9: three stale CC 123s), 10b / 10d (R1-F1: no `backgroundExpired`,
  no `gateChanged`). Green after: **21 / 21 in three consecutive runs** (`harness-green.out`); it writes nothing outside its build
  directory (`Midi.defaults` is swapped for an in-memory `UserDefaults` subclass — review 2's `~/Library/Preferences/midiharness.plist`
  cannot recur).
- **R1-F1 (major) — the background task, the lead's decision (a) / (b) / (c)**: `ShellViewController.sceneBackground(true)` with
  `midi.midiOpen && backgroundAudio` takes `UIApplication.shared.beginBackgroundTask(withName: "synth.midi", expirationHandler:)`; the
  handler `midiBackgroundExpired()` sets the new gate input `midi.backgroundExpired = true` — the gate is now `ready && midiOpen &&
  (onScreen || (backgroundAudio && !backgroundExpired))` (§3.4's frozen expression **amended**, the lead's) — so the close path runs in
  the live process: the triple per sounding channel is flushed to the page (still alive at that moment), arrivals are dropped until the
  foreground; the task ends in the handler, at the foreground (`backgroundExpired = false`, the gate reopens with `openedAt` = now) and
  whenever the gate shuts for any other reason (`Midi.gateChanged`). No silent-audio keep-alive (app-native greps `AVAudioPlayer /
  AVAudioEngine / AVAudioSourceNode` absent). The harness's case 10 (the native half: hidden + on → open; expired → `B0 40 00`, `B0 7B
  00`, shut, drops; foreground → open, the drop reported) and the smoke's new **step 8b** (Sound in background on, pedal + note, hidden
  → the task held; the Debug shell runs the expiration path itself as iPadOS would ≈ 30 s in → the triple reaches the hidden page, 3
  sends dropped, the task ended; the foreground reopens, the next note plays, held 0) are the repeatable proofs; the sender's run is the
  real one (below). The simulator measurement and the device question are in §11.
- **R1-F2 (major) + R1-F9 — three passes, note-offs clear the masks, the per-kind evaluator**: `releases()` walks the selected ports
  three times — every CC 64 = 0, then every bend centre, then every CC 123 — so the order holds across ports (the page's `held` /
  sustain are per channel); the masks' note bit is now a **128-bit set per channel** (`held[32]`): a note-off or a velocity-0 note-on
  clears its note, CC 120 / 123 the channel, a channel sounds while any note is set — "From other apps"' stale ch-1 bit (set by step
  7b's notes, never cleared) is gone, so the smoke's closing batch no longer carries its CC 123 (released 2, as lane M measured). The
  evaluator checks **per kind**: every `bn 40 00` before any `bn 7B 00` (`pedalFirst`), for step 8 and 8b. **The learn question** (the
  brief's): checked in midi.js / main.js — a pending Serum learn *would* learn the triple's CC 64 (`cc < 120 && pending`, midi.js:326;
  CC 123 is ≥ 120 and safe there), and a canvas CC module in learn mode learns CC 64 **and** CC 123 (`modCC` learns every controller,
  main.js:7979–7990); nothing cancels a learn on `hidden` / `blur`, and an unplug or overflow has no visibility change at all. Not
  fixable natively without a protocol change the shim and the page must read (both closed to this lane) — **recorded in §11 with the
  proposed marker** for the lead; the native side sends nothing it does not have to (CC 64 = 0 only where the pedal was down).
- **R1-F4 (major) — a form sheet**: `MidiBluetoothSheet` presents `.formSheet` (centred, the surround dimmed — the outside tap is
  consumed by the dimming view, never by the page); the popover's anchor code is gone (`present(via:autoDismiss:shown:closed:)`);
  `presentationControllerDidDismiss` still settles the Presenter on a swipe-down or a tap on the surround; Done and the smoke's
  auto-dismiss unchanged. By hand below.
- **R1-F3 (major) — the stale `visualViewport.scale`**: the A1-safe guard in `cv-world.js`'s one scale read (`vvScale`): a `scale > 1`
  with `visualViewport.width >= innerWidth − 1` is read as 1 — a real pinch zoom shrinks the visual viewport to `innerWidth / scale`,
  so this state never occurs in a correct browser (WebKit with the Visual Viewport API, iOS 13+, reports `innerWidth` as the layout
  viewport's). cv-world.test: a new case (a fake vv at scale 1.333, width = innerWidth, after a `resize` → `native` false, no chip,
  the hooks still the canvas's; width 1279.5 still the window's; then scale 1.5 at width 1280 / 1.5 → hands over; back to 1 → the
  camera) — red before (the chip showed); and the existing hand-over case **amended on purpose** (its fake now shrinks the width on
  the zoom, as a browser does — named in the test). `gesture.js`'s own `perPt()` scale read (an edge threshold) is outside this
  lane's lines: the stale 1.333 would narrow the edge band by 25 % until the next real viewport event — noted for the lead. The
  native bisect (the smoke's new `layout` / `vv` log lines) is below.
- **R2-F2 (major)**: the overflow branch marks every (port, channel) in the buffer it drops as owing the whole triple (`Masks.dirty`)
  before `removeAll` — harness 2 / 2b: `B0 40 00` at 0 and `E0 00 40` at 1, `B0 7B 00` at 2 after the stall.
- **R2-F3 (major)**: `connected` is `[Int32: MIDIEndpointRef]`; a uid whose ref changed is disconnected, released and reconnected in
  one relist — harness 7b (at once: reconnected, its held note released 1) and 7d (20 / 50 / 100 / 200 / 300 ms gaps: every one
  plays; the old code was DEAF up to 200 ms). The page's list is unchanged (same id, `connected`).
- **R2-F4 (minor)**: `closedAt` recorded at each close; dropped at arrival only `closedAt != 0 && closedAt ≤ at < openedAt` — harness
  3a (stamp 0, −1 s, −5 ms, stamp 1: all delivered) and 3b (a stamp inside the shut window dropped, one older than it delivered).
- **N1 / N5 — the client off the main thread, retried endpoints**: `Midi.prepare()` at launch (right after the page load starts) and
  `Midi.open(done:)` (the bridge's reply handler waits; `bridgeMidiOpen(_:)` is now asynchronous) share `createClient()`; the ports and
  the "SYNTH" destination are made when missing at every open (`createEndpoints()` — a failed input port is retried, never left 0
  behind a live client; the smoke endpoints once). **Found on the way**: a client made on a **GCD utility worker** while the main
  thread ran its run loop **missed every notification in two of three harness runs** (`notified` never called; the probe with main
  blocked during the create always delivered — CoreMIDI appears to bind the block's delivery to the creating thread's run loop,
  which a worker never runs), so the client is made on a **dedicated utility `Thread` whose run loop is kept alive** for the app's life
  (`RunLoop.current.add(Foundation.Port(), …)`, `run(mode:before:)` forever; the notify block still only hops to main) — three
  harness runs green after. `relist()` waits for `midiOpen` (the page's open rebuilds the tables itself).
- **N2**: termination runs `midi.pageReset()` before `midi.ready = false` (harness 6: 0 calls to the dead page). **N3**: `oneList`
  builds and uses the list inside one `withUnsafeMutablePointer` scope. **R1-F6**: the relaunch half runs on `-smokeMode relaunch`
  (`launch_wait "${RUN}b" 40 -smokeMode relaunch`), never on the label's last letter. **R1-F8**: a `ports` call's `midiBatch` line
  carries the drops waiting to ride; every `midiGate` line carries the counters and `backgroundExpired`. `Smoke.js:131`'s comment
  names the smoke's own access. **R1-F5**: the ⚙ hint reads "Keep playing when you switch apps (iPadOS may pause it after a while —
  for a MIDI app, use Split View)", the help sentence "… or another MIDI app sending to it; put that app beside SYNTH in Split View)
  …" — pinned in app-shell / app-shell-web (red first).
- **Tools**: `tools/midi-sender.swift` (reviewer 1's probe — the simulator's only "other app": build for the simulator SDK, `simctl
  spawn` it; `list / send / hold / chord / stream`, `--wait` for the Home-press timing); `tools/midi-harness/{run.sh, main.swift}`
  (above; `$SYNTH_HARNESS_DIR`, default `$TMPDIR/synth-midi-harness`). The smoke script counts the `"step":"ready"` / `"bgdone"`
  lines (several round trips per run: 8, 8b, 11).
- **Budgets**: `Midi.swift` is **456 lines (§9 said ≤ 400)** — the asynchronous client (+ 45), the masks' bitmap and three passes (+ 15),
  the per-fix comments; recorded, not trimmed (a trim would re-run the smoke on a changed binary).
- **Gates** (one file at a time, `--max-old-space-size=2048`): the harness 21 / 21 ×3, app-native 12 / 12, cv-world 77 / 77,
  app-shell 19 / 19, app-shell-web 6 / 6, app-midi 16 / 16, app-midi-sim 7 / 7, main 47 / 47, lint 165 / 165. midi.js and
  `MidiShim.js` untouched (byte-identical: app-midi's hash case; `git diff 223335e -- midi.js app/ios/SYNTH/MidiShim.js` empty).
- **The smoke** (`tools/app-smoke.sh` on the committed bundle, two runs `fxm1` / `fxm2`, `scratchpad/midi/fxM/smoke-fxm*.out`): **PASS,
  91 / 91 gates each**, 0 pending, 0 FAIL — step 8 now `released 2` (the stale "From other apps" CC 123 gone — F2's flake is gone with
  it), its closing batch `b0407f 903e64 b04000 b07b00`; step 8b `bgTask true` at the background (the simulator's `backgroundTimeRemaining`
  reads ∞ — it never expires a task by itself), the expiry path `released 2`, 3 hidden sends dropped, the task ended, the triple at the
  hidden page `b0407f 903d64 b04000 b07b00`, the foreground reopened (`903b64 803b00`), held 0; the client made at t = 182–202 ms
  (91–93 ms, off the main thread — the simulator's MIDIServer already up) before the page's `ready` (989–1086 ms), the access reply
  in 0–1 ms; the 1 kHz burst 421 calls, transit p50 0.47 / p99 2.5 ms, stamp error p95 0.88 ms; 0 console errors, the one expected
  warn; `.app` 10.2 MB. Each run had **two background round trips** (the counted `ready` / `bgdone` lines) and the relaunch half ran
  on `-smokeMode relaunch`.
- **By hand** (`-smokeMode log`, the Simulator tool, `scratchpad/midi/fxM/byhand-*`): **R1-F4** — ⚙ → App → Pair a device… → the form
  sheet centred over the dimmed page ("Bluetooth MIDI", ✓, "No devices found"); a tap on the surround at key C5's spot: `btmidi closed`
  logged (the settle path ran), **0 `engine` lines**, "Engine off" still, the ⚙ popover beneath untouched — before the fix that tap
  played C5. **R1-F3** — three Home round trips (the HOME button, back by the icon): the toolbar read "82 %" with **no chip** after
  every one; a two-finger pinch on the canvas then zoomed the camera 82 → 200 % (the top bar and tray unscaled — no page zoom).
  **The native cause (the bisect, new `layout` / `vv` log lines)**: ≈ 150 ms after `sceneDidEnterBackground` UIKit rotates the scene to
  **landscape (1376 × 1032) and 120 ms later back to portrait (1032 × 1376)** — `viewWillTransition(to:)` twice, both before the page's
  `hidden` — the other-orientation snapshot for the app switcher; WebKit lays the page out at 1376 wide and back while going hidden and
  leaves `visualViewport.scale` at **1.333 = 1376 / 1032** with the width still 1032 on every return (`scroll` / `window` / `resize`
  events at the foreground, all with that scale; the page itself renders 1 : 1). Same for `simctl launch` of Safari (the smoke's round
  trips) and for the HOME button; nothing in the shell's code is involved (stage A's `.all` deferral merely made the same WebKit state
  more frequent). No native fix taken: a zoom reset at the foreground (`scrollView.setZoomScale`) would undo a user's real pinch, and
  an orientation lock while hidden is the user's rotation lost; the page-side guard is exact (the stale state has the window's width;
  a real pinch never does) and costs browsers nothing.
- **R1-F1 by hand** (`tools/midi-sender.swift` spawned into the simulator — the only "other app" it has —, `byhand-f1*.sh / .out`; the
  engine on by a key, Sound in background on, Home pressed as the sender starts): **run 1** — Home at 04:19:09, `bgTask true`; the
  task's **expiration handler fired at +26.5 s** (`remaining 4.05 s` — the simulator does expire it, ≈ 30 s budget, although
  `backgroundTimeRemaining` read ∞ at the background transition), the gate shut (`released 0`: nothing was held); the sender's note-on
  at +28.3 s **still reached the process and was dropped at the shut gate** (`dropped 1`), its note-off at +33.3 s and the probes at
  +45 / +46 / +60 / +61 s **never arrived** (the counter stayed 1 — CoreMIDI deliveries to the hidden process end between +28 and +33 s,
  reviewer 1's ≈ 30 s edge); back at +87 s the gate reopened, 0 voices, nothing lit. **Run 2, the exact edge** — CC 64 127 + a note-on
  at +19.3 s: **delivered to the hidden page** (two batches, rtt 7–9 ms; the note sounding under the pedal), the expiry at **+26.5 s** →
  **`released 2`** (CC 64 = 0, then CC 123), the release batch completed by the hidden page in 48 ms; the note-off + pedal-up sent at
  +32.3 s never reached the process; the foreground at +47 s: masks 0, 0 voices, no lit key — **the note that would have droned until
  Panic (reviewer 1's shot 04) is released ≈ 3.5 s before the deliveries stop**. So in the simulator the order is: the expiry handler
  (+26.5 s) → the last deliveries (≈ +28–30 s) → silence; messages sent past the edge are lost (the shim warns once about the drops
  that arrived). **The device question stands** (§11): whether a sounding iPad app keeps its deliveries past the expiry — then the
  expiry shuts MIDI while the sound goes on until the foreground; the Split View advice holds either way.

### Acceptance
- Holding branch `wt-B` (M 30204ab, S 8edaa19, W 55f00e7; canvas's Delete / Tab keys merged in; fixers S 5ab14cd, M 84f67ea), from
  6a45072. Two reviews: **1 (the simulator, Fable 5.1)** 4 major · 3 minor · 2 nits — a `simctl spawn` sender as "another app"
  (kept as `tools/midi-sender.swift`), a 5-min 1 kHz stream with 0 dropped and flat memory, the WebContent kill mid-stream;
  **2 (code, Opus 5.5)** 3 major · 2 minor · 5 nits — the real Midi.swift compiled for macOS against a fake host (kept as
  `tools/midi-harness/`, 21 cases). Fixed: the release before the background expiry (`beginBackgroundTask`), the triple across ports,
  the Bluetooth form sheet, the pinch guard (iOS 27.0 rotates the scene for the app-switcher snapshot and leaves
  `visualViewport.scale` 1.333), the overflow's releases, a re-created source, stale stamps, the timestamps across silence + the clamp,
  one access per call, the off-main client, the texts. The smoke PASS (91 gates incl. 8b), the harness PASS, the sweep green; squashed
  onto `canvas` as "B", the web side deployed, the app installed on the user's iPad.

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
