# MAP — the Master canvas (ROADMAP row 13): what exists, with file:line (read-only; tree at 16a01e7, branch canvas, v=9)

Facts only. "→" marks a consequence the facts force, not a proposal. Paths are repo-relative; `main.js:N` = /Users/dom/Documents/Claude - Synth Synth/main.js.
Row 13 text: docs/canvas/ROADMAP.md:34. Schema in the tree is **12** (cv-migrate.js:102); IMPL-P plans 12 → 13 with an identity step (docs/canvas/IMPL-P.md:251),
so the Master stage is 13 or 14 depending on whether P lands first.

---------------------------------------------------------------------------------------------------------------------------------
## 1. The mix today

### 1.1 Where tracks are summed: Web Audio, on the main thread's graph — NOT in the worklet
- One `AudioWorkletNode('synth-engine')` per track (`numberOfInputs: 0`, `outputChannelCount: [2]`) — main.js:1047-1050; SPEC-canvas.md:636 states the intent.
- Per track: `node → GainNode(gain) → StereoPannerNode(pan) → master` (+ two AnalyserNodes off `pan`) — main.js:1051-1054.
- `master` is ONE `GainNode` created in `powerOn`: `master = c.createGain(); master.gain.value = settings.master` — main.js:990. It sums every track's `pan` (float32,
  Web Audio's implicit input sum) and feeds `c.destination` directly: `master.connect(c.destination); master.connect(an)` — main.js:992.
- `settings.master` default **0.8** (main.js:109); the slider `#master` is 0…1 (index.html:107, second copy `#masterG` index.html:136); handler `master.gain.setTargetAtTime(...)` main.js:8029.
- Fader/mute/solo are Web Audio params, smoothed 15 ms: `mix()` main.js:1154-1163 (`N.gain.gain.setTargetAtTime(audible(t) ? t.vol : 0, …, 0.015)`, `audible` main.js:1150).
- Other sources into the destination: the **metronome** goes `osc → gain → metroBus → c.destination` (main.js:993, 1649-1658), i.e. it bypasses `master` (gain) and the master `an`;
  the **preset preview** node goes `node → gain → master` (main.js:2979-2985, so it IS in the sum).
- Nothing else connects to `destination` (grep of every `.js`: only main.js:992-993, 2801 (offline)).
- `syncNodes()` (main.js:1139-1149) deletes any `nodes` entry whose id is not a project track id (`ids.has(id)` at :1143) and `powerOff` clears `nodes`, `an`, `master`, `metroBus`
  (main.js:1002, 1019-1020). → a Master record kept in the `nodes` Map would be torn down by syncNodes; `statsText` also counts `nodes.size` as "tracks" (main.js:1245-1247).

### 1.2 Channel layout
- Everything is stereo: the engine writes `out[0]`, `out[1]` (engine.js:4611); `outputChannelCount: [2]`; offline context `numberOfChannels: 2` (main.js:2792). Mono output falls back to `Ro = out[0]` (engine.js:4611).
- AudioContext options: `latencyHint: 'interactive'`, `sampleRate: settings.sr` if set else the device rate (main.js:965-966).

### 1.3 Gain / limiter / clip / dither / master FX that exist
- **Per-track output stage only** (`Track.outStage`, engine.js:4852-4867): 4 Hz one-pole DC block (`Rdc = 1 − TAU·4/base`, :4854) → stereo-linked look-ahead peak **limiter**
  (`class Limiter`, engine.js:1213-1243: threshold −1 dBFS :1220, look-ahead ≈1 ms, release 120 ms) → hard clip ±1 (:4863-4866). Float64 inside, float32 out (`Lo[…]` is the Web Audio buffer).
  SPEC-canvas.md:253: "OUT … is where today's limiter lives".
- **Nothing after the sum**: no master limiter, no clip, no dither, no master FX. The summed signal can exceed ±1 (only the output device's own clamp stops it; nothing in the app does). `master` is a plain gain.
- **Dither exists only in the file writer**: `encodeWAV` TPDF ±1 LSB for 16/24-bit, fixed xorshift seed `0x9E3779B9` (song.js:946-953); 32-bit float is written undithered (:952).
- "g.master"/"g.bypass" in fx-dsp.js are per-RACK slots (FX-context [0]/[1], fx-dsp.js:1978-1981), not a project master.

### 1.4 The per-track OUT scope (changed in 5bd814c) and meters
- Each node gets two analysers off `pan`: `a` fftSize 512 (the head meter) and `sc` fftSize 8192, smoothing 0.75 (the OUT scope) — main.js:1051-1054, N record :1055. So both are post-rack, post-fader/mute, post-pan.
- `scopeSource()` returns `nodes.get(cvView.trackId).sc` or null (main.js:4753-4756); its comment says "A Master canvas returns `an` here". `drawScope()` (main.js:4757-4798) reads it each
  frame: wave = `getFloatTimeDomainData(td[8192])`, span ≤ 2048 samples (25 ms), rising-zero-crossing trigger; spectrum = `getFloatFrequencyData(fd[4096])`, 20 Hz…24 kHz log axis,
  −130 dB floor. 2D canvas, `shadowBlur 6` (:4769), store sized by `fitCanvas` (dpr ≤ 2 and the camera zoom, comment :4760-4763). It returns early unless the OUT module is live
  (`cvView.live(ID.out)` = on screen and not folded: cv-module.js:1313; main.js:4759).
- The OUT module is a canvas device `{kind:'out'}` per track (cv-migrate.js:179-184); its body is ONE shared DOM node `.scope` (index.html:201-207) moved in and out of the module
  by `cvMountBody/cvUnmountBody` (main.js:5284-5314, `cvBodyEl` returns `P.scope` for kind 'out' :5269). Size W_OUT 280 (cv-module.js:66). Its title fallback is "OUT / master output" (main.js:5488).
- Head meters: `frame()` (main.js:4801-4824) runs every rAF, per track `document.querySelector('.head[data-id=…] .hmeter i')`, `N.an.getFloatTimeDomainData(512)`, abs-max, decay ×0.88,
  `log10` width, `clip` class > 0.98. No gap-free metering anywhere on the main thread (a 512-sample snapshot per frame).
- Test pin: tests/canvas-sim.test.mjs:604-650 asserts topology `pan.outs` ∋ a **gain** node (master) whose `.outs` ∋ an 8192 analyser (:610-611), `own(id)` analysers `[512, 8192]`
  (:626), the kept 8192 master analyser (:623) and `scopeSource()` identity (:631, 639, 646).

### 1.5 The master analyser that already exists (unread)
- `an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.75` fed by `master.connect(an)` — main.js:991-992 (post-master-gain). Comment: "no reader until the Master canvas's OUT".
  Nothing calls `an.get…` (grep: only main.js:111, 991, 1002, 1019).

### 1.6 How data reaches the UI (no SharedArrayBuffer anywhere — grep `SharedArrayBuffer|Atomics`: none)
- **AnalyserNode snapshots polled in rAF** (meters, scopes) — §1.4.
- **Worklet → main `port.postMessage`**: `{t:'smon', …}` every ≥ 33 ms of audio while subscribed (engine.js:4644 `monF += n >= base·0.033` → `postMon` :4796-4850; carries Serum
  snapshot, `gr` (compressor GR Float32Array 4·48), `fxph` (LFO phases), `ftap` (1024-frame mono tap), `mo`, `mc`); `{t:'stats', load, voices, os, per:[{id,load}]}` every 0.25 s
  (engine.js:4647, 4772-4789); `{t:'ready'}` (engine.js:3576); `{t:'fxover'}` (engine.js:2335-2340); `{t:'step'}` etc. Host handler: `node.port.onmessage` main.js:1066-1091.
- Subscription registry `monitors` (main.js:2382-2423): `sub(trackId, dev, {role, live(), deliver})`, `wanted(id)`, `sync()` posts `{t:'mon', ids}` to the NODE of that track id.
- In-worklet peak meters precedent: `peak2` (engine.js:3411-3413, 3428) → `mixPk` → posted in `smon` as dBFS (engine.js:4803-4806).
- GitHub Pages cannot send COOP/COEP headers, so SAB (which needs cross-origin isolation) is not available to this deploy — an inference, not tested here.

### 1.7 Offline topology (bounce, resample, render-last)
- `renderOffline(sr, frames, items, at)` main.js:2790-2816: `OfflineAudioContext({numberOfChannels: 2, length, sampleRate: sr})`, same `addModules` (main.js:2793), one `synth-engine` node per item
  with `processorOptions {offline: true, …}`, each `node → g(it.gain) → pn(it.pan) → bus` where `bus = oc.createGain()` (gain 1, **no `settings.master`**) `→ oc.destination` (main.js:2801, 2811-2813).
  Wavetable/sample assets go to the FIRST node only (`n === 0`, :2803-2804; engine.js:3558-3561: stores are shared per global scope).
- Callers: `bounce()` main.js:4297; `resampleTo` :2840; `renderLast` :2903. Resample/render-last render ONE Serum through its own FX into a sample — they must stay pre-master.

---------------------------------------------------------------------------------------------------------------------------------
## 2. The FX rack

### 2.1 Host data model
- A rack is the FX state **v2**: `{ v: 2, racks: [ {mods:[instances…], byp, lock, route} ×3 ], ui:{rack, sel, expand, br} }` (fx-core.js:663-669; MAX_INST 48 per state, fx-core.js:554).
  MAIN / BUS 1 / BUS 2; instances any type, splitters hold branch lists (fx-core.js:14-35).
- Where a track's rack lives: **a Serum's own FX = `t.dev.<iN>.fx`; a classic's = the shared panel device `t.dev.fx1 = {kind:'panel', fx}`** (cv-migrate.js:174-184; main.js:222-230 `fxOfDev(t, id)`;
  main.js:236-249 `normDevs`). Classic panels show MAIN only (`racks: 1`), a Serum's own FX three (`racks: 3`) — main.js:3278, 3151.
- Edits: `fxHost(t0, rec)` (main.js:3143-3170) → `editFx → fxEditDev(t, dev, fn, o)` (main.js:2460-2469: mutate the live state, `fxPrune`, `queuePatch(t)`, `persist()`); **not in the undo
  history** (knob-tweak policy, comment main.js:2455).
- State → engine payload: `CG.chainPatch(fx, opts)` = `{fxr: compileFx(fx, {bpm, rate: sr, master/bypass/direct/bus*: undefined, modded: null, seed, smooth, silence, qr}), fxrT: compileFxT(fx)}`
  (cv-graph.js:350-357); host wrapper `buildChain` main.js:505; graph form `graphParts` :508-520; posting: `sendPatch` :656 → `sendGraph` :737 → `postChain` :729-736 (`{t:'chain', c, fxr, fxrT?}`,
  deduped by `sameVal`/`xsKey`). Tempo: `setProjectBpm` → `queueAll()` (main.js:3514-3521, 778); history restore: `applyRestore` re-sends every track (main.js:1476).
- `fxr` carries the master-ish/bypass numbers as `base[0]` g.master (default 1) and `base[1]` g.bypass (default 0); a RACK bypass is `racks[k].byp` (fx-core.js:973-976 → `rByp`).
- Convolve IRs / assets: `tables.ensure(needs, {trackId, node, s, fx, convMax})` per track node (main.js:1094-1095, 669-672); offline: `needs` unioned into one `tables.entries` call (main.js:2795-2803).

### 2.2 UI and the "+" menu
- `FXRackUI` (fx-ui.js; header :1-70): list + rack views, "+" add menu (13 effects + 3 splitters) with a per-type load estimate when `opts.cost` is given (fx-ui.js:13, 40).
  Mounted by `renderFxTab(t, key)` (main.js:3261-3290): `new M.fxui.FXRackUI(box, fxHost(t, rec), {embedded:false, dsp: FXDSP, racks, v2Fx:true, cost: fxCost})` (:3278); sets `data-dev` on the
  root for the mod layer (:3279); subscribes `monitors.sub(t.id, dev, {role:'fx', live: cvLive(key), deliver: gr/ftap/fxLive})` (:3281).
- The estimates: `fxCost = type => COSTM.label(COSTM.estimate(type, devFactor()))` (main.js:5952) → cv-cost.js:206-214 (`COST.fx[type]`, cv-cost.js:111), label `'~3 %'` / `'<1 %'` (cv-cost.js:235-238).
  Item list `FX_ITEMS` main.js:5923; `cvAddEffect(t, key, type)` :5937; wired at main.js:7935 (`fx: {items, cost, addEffect}`).
- Host members the UI needs (fx-ui.js:27-35): `fx()`, `editFx`, `bpm`, `gr`, `tap/setTap`, `locked`, `racks`, `irs`, `storage`, `notify`, optional `state/edit` (Serum), `extraRows`.
- The mod layer is **track-keyed**: rows live in `track.mods` with `dst '<dev>:<param>'` (cv-graph.js:360-362 `modRowsFor(t, devId)`), FX knobs carry `data-dest = fx.<inst>.<pid>` + root `data-dev`.

### 2.3 DSP side
- File `fx-dsp.js` (IIFE, global `FXDSP`, :96-110; `FXRack` :2094) + `fx-mods2.js` (Bode, Convolve, Utility, splitters; global `FXMods2`). Both are in `DSP_FILES` (main.js:847-848), loaded by `addModules(c)`
  (main.js:850-854) into the context's one AudioWorkletGlobalScope, before `engine.js`.
- Instantiated per track: `class Chain { … this.rack = new FX.FXRack(base) … }` (engine.js:3459-3470), `new Chain(this.base)` in the Track constructor (engine.js:3545, c0) and per panel in `graphMsg`
  (c.id = cid, engine.js ~4143). A Serum Inst's rack is its own `fxc.rack` (engine.js:1815, 3427).
- Calling convention: `rack.process(L, R, n, dL, dR, b1L, b1R, b2L, b2R)` on **Float64Array** L/R in place (fx-dsp.js:2749-2754); n ≤ 128 per call, internally `SPAN 128`, `BLK 16` (fx-dsp.js:108, 2753, 2813).
  An empty/calm rack returns at once (**O(1), leaves L/R untouched**): `if (this.calm === 1 && !dL && !b1L && !b2L && …) return` (fx-dsp.js:2751); `calm` set in `post()` (:3150-3151).
- Rack bypass (`racks[0].byp`): input kept, 5 ms crossfade, units frozen when fully bypassed; fully bypassed → `rackRun` returns with X/Y = input (fx-dsp.js:2872-2890); `out()` early-returns at unity
  (fx-dsp.js:3102-3117).
- Rate/oversampling: the rack is built at the context rate (`new FXRack(base)`, `base = sampleRate`, engine.js:3464, 3512) and is **independent of the track's oversampling** (the Inst decimates to base before the rack:
  engine.js:3400-3432). Distortion runs a 2× internal shaper with 15-sample latency, dry path delayed to match (fx-dsp.js:49-55, 465); Delay > 96 kHz runs half-rate lines (+30) (fx-dsp.js:64, 850);
  splitters align branch latencies (fx-dsp.js:39-41, 1874-1894). Compressor Limit mode look-ahead `La = round(10·n²·fs/1000)` ≤ 10 ms (fx-dsp.js:1023).
  `rack.latency` is computed (fx-dsp.js:2659, 2869) but **read by nobody** (grep `\.latency` over engine.js/main.js/fx-*.js: none outside fx-dsp.js) — no plugin-delay compensation exists.
- Per-rack memory cap 32 MB (`CAP_BYTES`, fx-dsp.js:1984): an instance over the cap stays unallocated + bypassed, listed in `rack.over`; the Inst posts `{t:'fxover', ids}` (engine.js:2335-2340), host notice names the
  track (main.js:1086-1090).
- JIT warm-up: ONE per AudioWorkletGlobalScope, in the first non-offline Track constructor, including `I.rack.warmUp()` (engine.js:3550, 3592-3609; fx-dsp.js:3155-3190; "same classes ⇒ JIT state shared", fx-dsp.js:93).
  Offline processors never warm up (engine.js:3550). A later processor in the same scope skips it. HANDOVER.md:144-145: warm-up stalls permanently add output latency on iOS → the engine is built with the context suspended (main.js:983-989, 995-997).
- State messages to a rack: `{t:'chain', c, fxr, fxrT}` (engine.js:4263-4272, :3568 for processorOptions), `{t:'fxtap', id, c|i}` (:3984), `{t:'fxph', c|i}` ↔ `{t:'fxph', v, c}` (:4037-4042),
  `{t:'mon', ids}` → `{t:'smon', c, gr, fxph, ftap, mo}` (:4839-4843), `transport` → `rack.transport()` / `reset(true)` when `fxr.silence` (engine.js:4427-4440, 4477), `rack.trigger()` per note (Hyper/Bode RETRIG),
  `rack.setNote(pitch)` key-tracking (fx-dsp.js:2464; engine.js:4721-4725), `rack.setMods(vec, key)` from ModCore (fx-dsp.js:2443; engine.js:4752-4755).
- Re-seed rule: a transport start / re-seed is immediate only when nothing audible is in the lines; "renders after a silent history are bit-identical to a fresh rack's" (fx-dsp.js:69-77, 87-90, §10.7f).

### 2.4 What running one more rack on the SUM would touch (couplings, all by file:line)
- Engine: `Chain`/`FXRack` are self-contained and take a Float64 stereo block; the Track-only parts are the Inst feed, `setNote` (`c.drive`), `chainMods` (ModCore `MC.fxv[c.id]`, engine.js:4752), `PROCS`/`ALL`
  registries (`ALL.add(this)` engine.js:3555; announces smp stores to every rack, engine.js:1675) and the output stage. Nothing keyed by a track INDEX; rack ids are device ids ('fx1', 'i1/fx').
- Host, keyed by track: `nodes` Map (main.js:1141-1147), `N.chains/N.fxph/N.phWait` (main.js:1055-1065), `rackKey(t,N,d)` (main.js:1125), `postTo(tr, m, dev)` (main.js:1166-1175, adds `c` for `kind==='panel'`),
  `monitors` (trackId-keyed), `fxHost.T()` = `project.tracks.find` (main.js:3144), `fxOfDev(t,dev)` = `t.dev[dev]`, `fxPrune` → `CMOD.pruneRows(t, dev)` (main.js:2472), `tables.ensure({trackId})`, `fxover` notice text.
- Per-track modulation (LFO/ENV/macro cables onto FX knobs: ModCore is per Track node, mod-core.js; `track.mods`) has no master equivalent.
- `compileFx` options `master/bypass/direct/bus*` are `undefined` for panel chains (cv-graph.js:353) → defaults base[0]=1, base[1]=0.

---------------------------------------------------------------------------------------------------------------------------------
## 3. Export / bounce / record

- **Only one audio export path: Bounce WAV** (`#fBounce` → `openBounce` main.js:4252; `bounce()` main.js:4297-4338). No stems, no freeze, no live audio recorder (grep `MediaRecorder|createMediaStreamDestination|ScriptProcessor`: none).
  "Recording" (`T.rec`) is MIDI. Sample producers: `resampleTo` (main.js:2835) and `renderLast` (:2886) → `renderOffline` + `encodeWAV` 24-bit; `smprender.js` (Worker, factory content; captures `synth-engine` BY NAME, smprender.js:60).
- `bounce()`: `bounceSet(sr)` (main.js:4278-4296) = every audible track with notes/synced (+ MIDI-OUT graph at gain 0), each `{tr, patch|graph…, gain: tr.vol or 0, pan}` → `renderOffline` → host-side post:
  peak scan; `norm` ⇒ scale to −0.3 dBFS, else scale to 0.999 if peak > 0.999 (main.js:4321-4324) → `encodeWAV(chs, sr, bits)` (4325). Defaults (index.html:303-307): **48 kHz, 24-bit dithered, OS 8×**, tail 2 s, Normalise off.
- So today "export = playback" is **not bit-exact end to end by design**, only per node: (a) offline `bus` has no `settings.master` (live 0.8 default) (main.js:2801 vs 990); (b) offline OS = dialog (8×) vs live `settings.os` (default 4×) (main.js:4299, 798);
  (c) offline sr = dialog vs the live device rate; (d) post-render peak scaling and dither exist only offline; (e) fader changes are constants offline, `setTargetAtTime` live; (f) Serum quality caps differ (`offline` flags, main.js:830, 481);
  (g) the metronome is not in the bounce and not in the master sum.
- Release tail is a fixed 0/2/5 s appended to the song length (main.js:4304); `tailEnd()` (main.js:2818) is used only by resample/render-last. A long master reverb tail is cut at that length.
- Bit-exactness live ≡ offline is asserted PER PROCESSOR, never on a summed mix: integration.test.mjs:438 ("offline from tick T ≡ live after 1 s pre-roll (−80 dB)"), :1132, :864-876 (MIDI OUT live+offline);
  golden-moog.test.mjs / golden-moog-b.test.mjs D7 (bounce = live bit for bit, span invariance); canvas-7a/7c-sim "the notes bounce bit-identically to the synced pattern" (canvas-7a-sim.test.mjs:268-287; 7c :314-338);
  golden-sdsv D7. None sums tracks.
- Renderers that sum: ONLY `main-sim.mjs` `OfflineAudioContext.startRendering` (tests/main-sim.mjs:248-267): gets each worklet node's output with `process([], [[bL,bR]])` and mixes through the **gain/pan chain
  to destination found by `paths(n)`** (:160-171, :253-259). It ignores worklet→worklet edges and any node other than `gain|pan`. Live sim `run()` (main-sim.mjs:330-345) does not sum at all (per-node output map).
- Several sim tests rely on `sim.lastOffline.nodes[0]` being the first TRACK node (accessors.test.mjs:141, 152, 155; canvas-7a-sim:577-583; canvas-8-sim:524) and on `sim.lastOffline.L` = the sim's mix (canvas-7a-sim:259-265).

---------------------------------------------------------------------------------------------------------------------------------
## 4. The track list, the canvas, the schema

### 4.1 The track list
- `#heads` + `#lanes` are siblings in one `.arrwrap` (index.html:183-185). `renderHeads()` (main.js:3721-3779): `.hruler "N tracks"` then ONE `.head` per `project.tracks` (56 px: style.css:207, `data-id`, M/S/arm, `.hmeter`, instrument chip, MIDI ch,
  vol, pan, ⧉, ✕), `.last` on the final one, `shell.nTr = project.tracks.length` for the tray (main.js:3777). Lanes: arrange.js draws one lane per track (`h = RULER + p.tracks.length·rh` arrange.js:338; loops :376-449).
- Tray stops are whole rows of the track count: `cvTray.topSnaps(n)` = `[TOP_ROW 48, 48+ARR_BAR 32+RULER 24+ROW_H 56·i …]` (cv-tray.js:26, 56-62), used at main.js:4845, 4848, 5079.
- Other lists of tracks: `trkDotsUI` (main.js:4900), `trkListUI` popover (main.js:4915-4930, uses `instOf(t).model`), `tabTrackUI` "Track: name · voice" (main.js:603), `instChip(t)` (main.js:4950).
- Selection: `project.selTrack` (song.js:68, 721); `trk()` = selected or `tracks[0]` (main.js:319); `selectTrack(id)` (main.js:1924-1944: releases pads/drums/PERF, `bind`, `renderNav/Views/Heads`, roll, arrangement, `ptShow`).
  Keyboard/MIDI/roll all follow `trk()`/`midiTargets(project.tracks, project.selTrack, src)` (main.js:1734). → a Master selection must leave `selTrack` on a real track or the keyboard has no target.

### 4.2 How a track opens its canvas
- `cvRender()` (main.js:5334-5361): `cvView = cvModule.createTrackView(W, t, cvHost())`, view key `project.uid + '/' + t.id`, camera `CM.camKey(uid, trackId)` (cv-migrate.js camKey, 'synth.cam.<uid>.<trackId>' in the ONE LRU record `synth.cam`).
  `cvHost()` (main.js:5440-5466) closes over `trk()`: `devices: t => cvDevices(t)`, `bodies {mount, unmount}`, `size`, `title: cvTitle`, `menu: cvMenu`, `badge`, `select`, `lay: cvLay`.
- Device list = `cvModule.devicesOf(track)` (cv-module.js:270-282): instruments (primary first), each Serum's own FX 'iN/fx', panels, `out`, then modulators; `cvDevices` (main.js:6680-6697) adds the **project Mod Wheel and every Pads module to every track**
  (main.js:6682-6685), Serum parts, 900-Series modules. `kindOfKey` (main.js:5257-5265) maps panel → 'fx', out → 'out'. OUT is "exactly one per track" (SPEC-canvas.md:253).
- Layout per track: `track.lay` (song.js `normLay` :523, ≤ 256 entries), Tidy columns instrument → FX → OUT (cv-module.js:296+). Sources-tray drops REPLACE the instrument (`cvDropInstrument`, `cvOpenSources('replace')`); the FX "+" is the rack's own menu (main.js:7935).

### 4.3 Project data and where a Master would persist
- `song.js deserialize` (song.js:666-725) rebuilds the project from a WHITELIST: name, bpm, sig, bars, loop, metronome, rec, snap, quantize, tracks, selTrack, and optional `perf` (:722) and `pads` (:723). Any new project key must be added there or it is
  dropped at load. Precedent for project-level non-track state: `project.perf` (song.js:664 normPerf; cv-model.js:380-445), `project.pads` (pads-core normPads).
- History: `_snap` stores `{m: JSON(project without tracks), t: [track JSON]}` (song.js:429-434) → a project-level `master` key rides in `m` automatically; undo/redo = `applyRestore(p)` replaces `project` wholesale (main.js:1455-1484).
- Schema gate: `SCHEMA = 12` (cv-migrate.js:102), `STEPS[n]` (cv-migrate.js:102-146); a project newer than SCHEMA opens read-only (`upgrade`, cv-migrate.js:148-157); `toV1` ("Save as classic project") drops `perf`/`pads` with a `lost` line
  (cv-migrate.js:233-235) — the pattern for a new project-level field. `mirror(o)` / file save: cv-migrate header.
- Autosave/IndexedDB: `save()` main.js:372-384 → `store.saveProject(project)`.

### 4.4 Every place that assumes "a row is a track with an instrument" (non-exhaustive; 117 `project.tracks` uses in main.js)
- renderHeads/instChip/trkListUI/trkDotsUI/tabTrackUI (above); `frame()` meters (main.js:4812-4822); arrange.js lanes; `roll.setTrack`; `bounceSet` (`instOf(tr)`, main.js:4282); `mix()`/`audible()` (solo is project-wide: main.js:1151);
  `statsText` (`nodes`, main.js:1245); `lowerOS`/safeguard sums `N.load` over tracks (main.js:1301-1333, 1250-1252: levers are OS/quality, none lowers an FX rack); `syncNodes`; `makeNode`; `selectTrack`; `deleteTrack` ("a project needs at least one track", main.js:3815);
  `exportMIDI`/`songEnd`; `CM.splitTracks`/`toV1`; `midiTargets`. The cv canvas side: `cvRender`, `cvHost`, `cvDevices`, `cvLay`, camera keys, `cvTitle`'s "OUT / master output" fallback (main.js:5488), the Sources tray tiles.

---------------------------------------------------------------------------------------------------------------------------------
## 5. Golden / test harness (what freezes the final mix — nothing sums tracks)

- All goldens render ONE `Track` processor in a node:vm AudioWorkletGlobalScope and compare its Float32 L/R: `tests/golden-harness.mjs` `scope()` (:77-102: **`g.registerProcessor = (n, c) => { Proc = c; }`** — last registration wins),
  `render()` (:258-274: `p.process([], [[oL,oR]])` per 128), `compare()` (:292). Side A = frozen copies, side B = current tree.
  · golden-classic / golden-presets / golden-random / golden-fx (ref-p1/: engine, fx-dsp, serum-dsp, models, serum-core); golden-graph (ref-1c/engine.js, REF_SHA golden-graph.test.mjs:21); golden-drums (ref-7a), golden-606 (7b), golden-909 (7c), golden-sdsv
    (7d), golden-moog (ref-9, + ref-9-core), golden-moog-b (ref-9b): PIN sha256 of the frozen files; every case `max|A−B| === 0` (random: ≤ 1e-6, golden-random.test.mjs:12).
  · canonical-stream.test.mjs: a scripted `main.js` session on main-sim; records **every `kind==='worklet'` node of every live and offline context** `[i, name, trackId, sha(processorOptions)]` (:88-94) and every posted message except
    `smon|mon|fxph` (:26, 95); fixture tests/fixtures/stream-main.json; `assert.deepEqual(r.nodes, ref.nodes)` and equal message count. → any ALWAYS-created extra worklet node (or any message to it) changes this record.
- Harnesses that capture "the" processor as the LAST `registerProcessor` call: tests/golden-harness.mjs:86, tests/dsp-scope.mjs:99, tests/main-sim.mjs:104, tests/integration.test.mjs:40 and :706, tests/engine-track.test.mjs:2758.
  (by name: smprender.js:60, cv-cost.js:344.) → a second `registerProcessor` placed AFTER `registerProcessor('synth-engine', Track)` (engine.js:4870) replaces `Proc` in six harnesses; placed before it, `Track` stays last.
- The DSP script list is replicated in: main.js:847 (`DSP_FILES`), smprender.js:30, wk.js:3189 (global names), tests/dsp-scope.mjs `DSP_TABLE` (:36-44), tests/golden-harness.mjs:28-29, tests/wk.test.mjs:2235, tests/sx-base.test.mjs:428,
  tests/bench.html:79, sw.js:48 (generated by `tools/precache.mjs`, which reads main.js `DSP_FILES`). A new worklet file = a new row in all of them.
- main-sim cannot run a worklet with an input: live `run()` and offline loop call `proc.process([], [[L,R]])` (main-sim.mjs:256-258, 336-337); `paths()` follows only gain/pan nodes to destination (main-sim.mjs:160-171).
- Pinned graph shape: canvas-sim.test.mjs:610-611 (pan → GainNode master → analyser 8192).
- Bench: tests/bench.json `targets` (rows d … d8i), `node`/`jsc`/`ipad`; row kinds voice/switch/track (tests/bench-scenarios.mjs:9-16, 419+). No row for a summed mix or a rack on a sum.
- Frozen-ref rule: every change to engine.js/dr-*.js keeps all of ref-7a…7d, ref-9, ref-9b, ref-1c, ref-p1 bit-identical (HANDOVER.md:99-101). An empty-Master "bit-identical" claim has **no existing test that could
  observe the summed signal**: the final mix is an unfrozen Web Audio sum (float32) of N processors' outputs.
- What an "empty master = bit-identical" claim can be OBSERVED against today: (i) the node list + every posted message of a scripted session (canonical-stream.test.mjs:88-95); (ii) the sim graph topology (canvas-sim.test.mjs:610-611);
  (iii) each processor's Float32 output block (all goldens); (iv) `sim.lastOffline.L/R` of the one summing renderer (main-sim.mjs:248-267, gain/pan only). NOT observable in node: the real Web Audio sum, the master `GainNode`, the AnalyserNodes —
  only a browser run (CLAUDE.md: a reviewer in headless Chrome; the iPad bench page tests/bench.html).
- Memory rule for tests: one file at a time, `node --max-old-space-size=2048 --test tests/<file>.test.mjs`; no fake-DOM nodes in `assert.*` (CLAUDE.md).

---------------------------------------------------------------------------------------------------------------------------------
## 6. Analysis prior art

- **None** for LUFS, K-weighting, true peak, loudness gating, stereo correlation / phase scope, goniometer (grep `LUFS|K-weight|true.?peak|correlation|1770|loudness` over *.js/*.mjs: only unrelated hits — Serum noise "−12 dBFS RMS" calibrations
  serum-dsp.js:92-96, 2070-2076; wt.js `rms` :692; smp.js YIN "correlation"; moog-dsp.js "RMS" for noise).
- Peak/RMS-ish: head meter (abs-max of 512 samples, main.js:4817-4821); in-worklet `peak2`/`mixPk` dBFS since the last message (engine.js:3411-3428, 4803-4806); bounce peak scan (main.js:4321); compressor GR meter `mod.meter` (fx-dsp.js:1144, 3141-3144, `gr()` :2535).
- Spectrum: analyser FFT (8192, 4096 bins) drawn log-frequency in `drawScope` (main.js:4783-4795); the Delay display's own in-UI Hann 1024 FFT of the rack tap (`fft1`, fx-ui.js:76-82, 1555-1562; tap = `tapPush` fx-dsp.js:2551-2556,
  `tapOut` :2545, posted in `smon.ftap`); wavetable editor FFT (wtedit.js); sx-spec.js (spectral oscillator FFT); fx-dsp.js `eqResponse`/`splitResponse` display helpers.
- Sample-rate conversion / oversampling building blocks: `Halfband` polyphase FIR (127/35 taps, Kaiser) + `decChain` decimators (engine.js:1071-1101, 1677-1682); fx-dsp.js Distortion 2× 31-tap half-bands (fx-dsp.js:49-50) and Delay half-rate
  converters. No pure interpolating 4× upsampler exists as a reusable function.
- Where existing patterns run: sample-accurate per-quantum work lives in the worklet and posts a SUMMARY on `port` (smon at ≥ 33 ms, stats at 0.25 s); the main thread only gets analyser snapshots (512/8192-sample windows, polled per rAF — not gap-free,
  so an integrating loudness measure cannot be exact there). BS.1770 coefficients are specified at 48 kHz; the context rate here is whatever the device gives (`settings.sr` 0 = device) and the bounce offers 44.1/48/88.2/96 (index.html:303).
- Display plumbing available for a Master canvas: `monitors.sub(...)` (needs a non-track key, §2.4), `fitCanvas` (wk.js) density rule, `cvView.live(key)` cull (cv-module.js:1313), `wk` widgets.

---------------------------------------------------------------------------------------------------------------------------------
## 7. Risks and the iPad / performance-preset angle

### 7.1 "Empty master rack = bit-identical"
- **Position in the graph is a fork with test consequences.** Today the sum is `pan → master(GainNode) → destination` + `an`. (A) A worklet after `master` sees the post-fader signal (the thing heard; the `an` tap point) but export has no master gain
  (§3) so live and file disagree by the fader unless the bounce adds the same gain. (B) A worklet between `pan` and `master` breaks canvas-sim.test.mjs:610-611 as written and puts a new node under every `pan.outs`. (C) Not creating the node while the rack is
  empty keeps canonical-stream and every sim test untouched (no node, no message) but creates it mid-session on the first effect — the iOS warm-up-stall pattern (HANDOVER.md:144-145; engine.js:3550: later processors skip the warm-up, but `set()` still
  allocates on the audio thread).
- float32 boundaries: tracks → GainNode/Panner → sum are float32; the rack is Float64 (engine.js:3466 `Chain.oL/oR`); float32 → float64 → float32 is exact, so an untouched pass-through is exact; `rack.process` early-returns when calm (fx-dsp.js:2751).
  A worklet that copies input to output with no arithmetic keeps every bit. Any gain, DC block, limiter or clip on the master (copying `outStage`) would NOT be identity (engine.js:4854-4866: the DC block alone changes samples).
- Web Audio's own input summing order is implementation-defined and untested anywhere; adding a node at the sum changes nothing numerically only if the sum happens once, at the same input.
- `inputs[0]` may be absent/empty when nothing is connected; main-sim passes `[]` (main-sim.mjs:256, 336) → a processor reading `inputs[0][0]` throws in every sim.
- Idle/skip: tracks skip silent spans after 2 s (engine.js:4651-4653); a master would run every quantum.

### 7.2 "Export = playback"
- Same processor class + same message stream + same 128-frame quanta gives the same numbers. Master quanta are never split by song events (tracks split spans at 4-frame grid points, engine.js:4638), so the rack's per-call parameter smoothing
  `a = 1 − exp(−n/τ)` (fx-dsp.js:2769) sees n = 128 live and offline. A master LFO/phase needs the same transport anchoring both ways: live `transport` is posted as an anchor frame `F = round((currentTime + 0.05)·sr)` (main.js:1547-1549, `anchor` :1500, `postTransport` :1520) and the engine
  applies it at the first 4-frame span boundary ≥ F (golden-harness.mjs:201, "posted … as main.js schedules them" :196); offline it is `processorOptions.transport` at frame 0 (main.js:4315); `rack.transport()` re-seeds LFO phases (engine.js:3136, 4477) only if told. A reverb/delay tail still sounding at a live re-seed differs from the offline fresh start (fx-dsp.js:69-77).
- Sample rate and `bounce` OS differ from live by default (§3): a master rack renders at the context rate, so a 96 kHz bounce differs numerically from a 48 kHz session even with identical settings.
- `rack.latency` (Limit look-ahead ≤ 10 ms, dist 15 samples) is not compensated anywhere: a live master Limit compressor delays the whole mix vs the playhead/metronome (the metronome bypasses the mix, §1.1); offline it delays the file vs the song grid.
- The bounce tail (§3) and the post-render peak scale/dither (main.js:4321-4325) sit after any master rack and exist only offline.
- `renderOffline` has three callers (bounce, resample, render-last); only the bounce should add the master, and its `needs` (Convolve IRs) must join the `ids` union (main.js:2795-2799).

### 7.3 Engine/test plumbing risks
- Registering a second processor (§5) hijacks `Proc` in six harnesses unless it is registered before `synth-engine`; a new script file must be added to ≥ 9 lists (§5). Reusing `FXRack` needs no new DSP file (engine.js already has `Chain`).
- `nodes`/`syncNodes`/`monitors`/`statsText`/`postAll` iterate tracks' node records (§1.1, §2.4); `postAll` (main.js:1176) would also reach a master node stored in `nodes`.
- `queueAll` (tempo, drift), `applyRestore`, `loadProject`/`freshProject`/`normDevs`, `powerOn/powerOff`, `whenReady` (waits for `N.ready` of every node in `nodes`, main.js:934) are the lifecycle hooks a master must join.
- The 85 % safeguard sums `N.load` and lowers oversampling/quality (main.js:1250-1252, 1301-1333): a heavy master rack adds to the sum but none of the levers touches it.
- One audio thread for all nodes on WebKit/Chrome (SPEC-canvas.md:636); a master rack costs what a panel costs (`COST.panel`, cv-cost.js:208-209) on the same thread.

### 7.4 iPad / performance presets (IMPL-P)
- The presets are visual only — "only the patch cords' physics and the panel face textures" (ROADMAP.md:35; IMPL-P §1.3 docs/canvas/IMPL-P.md:147-151: "meters, scopes … unchanged" at every preset). The optional O1 "meters and OUT scope at 30 Hz on Low"
  was offered and answered "none added" (IMPL-P.md:373, 380). → nothing in P throttles analysis drawing; the Master canvas's drawing must be cheap enough for Low by itself, and any lever for it is a new user decision.
- What exists to budget against: `drawScope` redraws every frame with `shadowBlur 6` and a store that scales with zoom (main.js:4760-4769); OUT draws only while live/on-screen (main.js:4759); the head meters query the DOM per track per frame (main.js:4814).
  P's own Low gates simulate with CDP CPU throttling 4–6× and list "tapping a tile freezes a frame 283/433 ms" as a known limit (IMPL-P.md:266-296, ROADMAP.md:35).
- Worklet side: bench rows are per Track node; no row exists for a master rack; the iPad bench runs on canvas.domlavin.com/tests/bench.html (CLAUDE.md). A summary posted at 33 ms (like smon) keeps the main thread to O(1) work per frame; per-sample
  K-weighting + 4× true peak in the worklet adds per-quantum cost on the same audio thread whose limit is 2.67 ms/quantum at 48 kHz (IMPL-P.md:304).
- Android/WebKit timing: WebKit's 1 ms timer quantizes "worst" columns (CLAUDE.md); `getOutputTimestamp` is render-stamped on WebKit (HANDOVER.md:144) — a meter synced to what is HEARD must go through `outFrame()` (main.js:1503-1506).

---------------------------------------------------------------------------------------------------------------------------------
## Appendix — quick index of the lines most likely to change
main.js: 109 settings · 111 ctx/an/master/metroBus · 797-798 osCap/osFor · 847-854 DSP_FILES/addModules · 959-1034 powerOn/Off · 990-993 audio graph · 1035-1099 makeNode · 1139-1163 syncNodes/audible/mix · 1176 postAll ·
1240-1253 statsText · 1301 lowerOS · 1455-1484 applyRestore · 2382-2423 monitors · 2460 fxEditDev · 2790-2816 renderOffline · 3143 fxHost · 3258-3290 renderFxTab · 3514 setProjectBpm · 3721 renderHeads · 4278-4338 bounceSet/bounce ·
4753-4824 scopeSource/drawScope/frame · 4900-4930 dots/list · 5257-5334 kindOfKey/cvBodyEl/cvMountBody · 5334 cvRender · 5440 cvHost · 5488 cvTitle OUT · 5923-5952 FX_ITEMS/fxCost · 6680 cvDevices · 7935 fx host entry.
engine.js: 1213 Limiter · 3459 Chain · 3506 Track · 3550 warm-up · 3576 ready · 4263 chainMsg · 4427 transportMsg · 4609 process · 4852 outStage · 4870 registerProcessor.
fx-dsp.js: 2094 FXRack · 2133 set · 2443 setMods · 2749 process · 2872 rackRun · 3102 out · 3155 warmUp.  song.js: 424 History · 666 deserialize · 929 encodeWAV.  cv-migrate.js: 102 SCHEMA · 148 upgrade · 233 toV1 lost.
