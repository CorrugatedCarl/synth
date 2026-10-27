# Stage MM: modulators on the master (IMPL-MM) — contract

ROADMAP row 22 (docs/canvas/ROADMAP.md:43 [R]). **Scope (the user, 2026-10-26 — settled, not re-asked)**: "i should be able to put lfos
on the master track to tie them to effects knobs". Today the master canvas refuses modulation (main.js:9687 `modAdd`: "no modulation
on the master canvas" [R]) and MASTER (`'synth-master'`, engine.js:5055) runs no ModCore (engine.js:5036 "no ModCore, no notes" [R]);
every Track does (mod-core.js, engine.js `Track.mc`). This stage gives the master **the tracks' modulation system, unchanged**: the
modulator tiles on the master canvas (LFO, Macro, CC, Chaos), their cables onto every knob of the master rack, the inspector / Mod
list / badges / halos / live dots as on a track panel, a ModCore in MASTER driven by the song clock, live ≡ bounce. Standing: no
artificial caps (ROADMAP 14), the performance presets are visual only, native pinch only, canvas only, browser first (CLAUDE.md: no
iPad app rebuild for this stage; its node tests stay in the sweep), no per-stage iPad session, "push it live when it's done", the
leaner multi-agent shape (CLAUDE.md: a contract first, builders in worktrees reset to the base, failing-test-first fixes, goldens
bit-identical, one test file at a time).

**Code references are to `canvas` at ba91775** (HEAD; the lanes' base is the phase-0 commit, §9.0 — done, its hash in §12). Tags as
IMPL-M / IMPL-SC: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a
[C] with a reason in §12, never an [R]). House format: IMPL-SC. **Skeptic-reviewed 2026-10-27 (§13: 3 P1 · 9 P2 · 15 P3)** — every fix
is in the text; the lead's decisions on its open items: **P1-1 (a)** the snap (`FXRack.modsJump()`, §3.4), **P1-3 the smaller design**
(an additive master: `project.master.mdev / mods / mid`, the record's `dev` a Proxy — §2, §4.1, §5), **P1-2** the mechanical
rerouting rule (§7.1). **The user's answers (the lead's first guess while the user sleeps, 2026-10-27 — the user confirms in the
morning, §10)**: the master's modulators are **LFO, Macro, CC, Chaos** — no envelope (an LFO in ENV mode already runs once from ▶),
no Mod Wheel; a hardware controller drives a master CC module whatever track is selected. ROADMAP 23 (display-rate visuals, row :44) is
**not** blocked by this stage and this stage adds nothing it would have to undo (§8).

**Invariants**
- **MM1 No master modulator = today, bit for bit.** A project whose master holds no modulator module and no master cable renders and
  posts as the base build: every frozen golden (golden-classic / -fx / -presets / -random / -graph, -drums / -606 / -909 / -sdsv,
  -moog / -moog-b / -moog-c), **ref-M's three master-output hashes** (tests/ref-M/master-out.json: `rack6`, `conv`, `offline` — frozen at
  432bd00 [R]) and its **three bounce hashes** (tests/canvas-M-bounce.test.mjs, tests/ref-M/bounce-hashes.json [R]), **canonical-stream's
  three parts** (the `synth-engine` part = main's fixture, the `synth-master` part = tests/fixtures/stream-master.json — no `{t:'mods'}`
  reaches MASTER in that session and the offline MASTER's `processorOptions` gain a `mods` key **only when the master has a payload**
  (§4.3), so its recorded sha is unchanged — and the `synth-safe` part), **ref-SC's live-p1 per-node hashes** (its line 0 is
  `synth-master` [R]) and engine-track's warm-up hash. Mechanism: `Master.mc === null` until a `{t:'mods'}` with rows arrives — the
  Track's N1 rule (IMPL-2b: "no `{t:'mods'}` message → no ModCore object, no adapter work") — one null test on the rack path, the calm
  copy path untouched (§3.2); the `smon {c:'mfx'}` message gains `mo` only with a ModCore (§3.2); mod-core.js is **not edited**; the
  schema step (§5) is the identity (an additive master).
- **MM2 Export = playback.** The offline MASTER takes the same compiled payload (`processorOptions.mods`), the same transport, the same
  pre-roll rule **and the same snap at the start** (§3.4: `FXRack.modsJump()` in the first part after a cold start or a seek puts every
  mod target at its value — no ramp from a history-dependent start): from a quantum-aligned start (`mAlign`, already on while the
  master holds an effect — main.js:2047 [R]; a cable needs an effect) after a silent history (IMPL-M M2's class), the master's output
  is **bit for bit** the bounce's for every modulator kind whose rows carry no slew (rise / fall), on every knob but two stepped
  topology knobs (Phaser POLES, Reverb TYPE under a moving source: §11, found after review); a slewed row's output is history-
  dependent for SLEW_T after ▶ (the pseudo-voice's slews are not reset by `transport`, sx-mod.js:1416–1433 [R]) and is **measured and
  recorded** (G3), not gated. Whether a FREE unsynced LFO is exact too is G3's to decide (`SxMod.transport(true)` resets every processor
  LFO, FREE included, and seeds mono chaos: sx-mod.js:1420–1424 [R] — probably exact; not pre-recorded as a limit, P3-4).
- **MM3 One modulation system.** The master's rows compile with `cv-graph.compileMods` on a **track-shaped record** (§4.1), run on
  `ModCore` as built (mod-core.js unchanged), reach the rack through `FXRack.setMods(vec, key)` exactly as a track panel's
  (engine.js:4908–4911 `chainMods` [R]) — a cable on a master knob produces the same FX-context offsets, span for span, as the same
  cable on a track panel holding the same rack (G2). No second evaluator, no master-only modulator kind.
- **MM4 Tracks untouched.** No Track message, no Track node option, no `track.*` field changes; the master's modulators live in
  `project.master` and show on the master canvas only (unlike the project Mod Wheel / Pads, which every track shows). A master-canvas
  action never edits a track's row that shares an id (G5's collision case, §7.1).
- **MM5 The display data keeps its shape and cadence.** The master's modulator bodies are fed by MASTER's `{t:'smon', mc, mcx}` on the
  `'mods'` monitor id — the Track's message, the Track's ≈ 29 Hz gate (engine.js:4737 / :5271 [R]) — so ROADMAP 23's frame clock /
  per-frame LFO computation / fast lane (docs/canvas/map-fps.md §5 D1, D4) applies to the master's bodies as to a track's with no
  second path to convert (§8).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts; "→" what they force)

| piece | where [R] | MM |
|---|---|---|
| **ModCore** (`globalThis.ModCore`): `create(T, base, sN)`; the shim reads `T.trackId` (the seed salt), `T.offline`, `T.wheel / at / bendRaw` (getters), `T.songBeat()`; `setRows(payload)` (allocation allowed; **`bpm` from the payload, default 120** — mod-core.js:189), `ctl(k, v)`, `noteOn / noteOff`, `transport(playing)`, `span(F, n, nCh)` (F unused inside: phases evolve by chunks + `SD.begin(shim, n)`'s `songBeat()` anchoring + `transport` re-seeds), `MC.fxv[chainId]` / `MC.fxKey[chainId]` (the FX-context vector per cabled chain, `MAXFX = 8 + 48·24`), `MC.live` (Float32Array(16)) / `MC.mcx` (the monitor fields, written only while `MC.mon`), `watch(on)`, `fxMon(id)`, `warmPayload(SxBase, perNote)` | mod-core.js:17–83 (the API), :131–160 (constructor: the shim :137–143), :185–291 `setRows` (:189 bpm), :302–320, :322–393 `span`, :397 `fxMon`, :418–456 `warmPayload` | MASTER feeds it a shim-compatible self: `trackId 'master'`, `wheel = at = bendRaw = 0`, `songBeat()` from its own clock (§3.1); only `fx` rows ever reach it (no Inst: `cls` / `set` rows are impossible — the compile never makes them for a record without an instrument) |
| **The payload carries no `bpm`** (cv-graph.js:767 builds `{ t, i, key, cp, ct, rows, xfer, ext, vals, keep, left, dashed, n, slots }`; main.js:446–490 adds none) → ModCore's `m.bpm` is 120 on every track; SxMod uses it for the BPM-LFO rates and the in-span beat step (`dB = dtC · bpm / 60`, sx-mod.js:1299), re-locking an ANCHORED LFO to `songBeat()` per span. **Measured (§12, the lead's script)**: on a track at 140 BPM a canvas BPM-synced GLOBAL LFO with ANCHOR on runs at the project tempo while playing (period 0.4285 s = a quarter note), with ANCHOR off while playing — and in any mode while **stopped** — at 120's rate (0.5 s) | cv-graph.js:767; main.js:446–490; mod-core.js:189; sx-mod.js:1268, 1299–1305 | **the master's payload carries `bpm` from day one** (§4.2: new code, no golden); the TRACK side is **not** changed in this stage — it changes track sound at tempos ≠ 120 (§11, §12: needs the user's OK) |
| The Track's ModCore glue: `mc` / `mcMon` fields; `modsMsg` (create on the first payload, `setRows`, `{t:'modsErr', i, key}` on a rejection, `modsOff` on `{off: true}` / an empty payload); `'mval'` → `mc.ctl`; `watch`: `mcMon = has('mods')`, `mc.watch(mcMon)`; `transportHook` → `mc.transport(playing)`; `modPre(n)` → `MC.span(spanF, n, nCh)` before any Inst; `chainMods(c, r)`: `r.setMods(MC.fxv[c.id], MC.fxKey[c.id])` with `c.mcOn = 1`, `setMods(null)` once when the rows go; `postMon`: `{t:'smon', mc: MC.live, mcx: MC.mcx}` while `mcMon`, **and `mo: mc.fxMon(c.id)` on a panel's `{c}` message** (:4998–5000); `po.mods` handled after the parts; `warmMods` (the JSC round) | engine.js:3597, 4019–4021, 4058–4081, 4100–4121, 4559–4564, 4891–4911, 4972 / 4998–5007, 3626, 3960–3985 | MASTER gets the same members, by the same names (§3) |
| **The Track's transport**: `transportMsg` keeps the whole anchor as `tp.pend = { frame, tick, fpt, loop, ls, le, seek, end, fresh }` and applies it at its frame (`songEvents`): `tp.wrap = P.loop && P.le > P.ls && P.tick < P.le` (:4575), the wrap `if (tp.wrap && t >= tp.le)` with the multi-wrap `while` (:4582–4587), the end `tp.play = false … transportHook(false)` (:4591–4592); the host posts the same object to MASTER (`postAll`) with `wrap` computed (`anchor()`, main.js:1999) | engine.js:4513–4530, 4565–4596; main.js:1399–1402, 1999 | MASTER's clock = these rules on its `tp` (§3.1) |
| **MASTER** (`class Master`): one `Chain` `c` (`id 'mfx'`, its `FXRack`), the meters, `transportMsg` reads **only `play`, `frame`, `seek`** (no tick / fpt / loop); `this.play` drives `start()`'s cold test, the stop branch's tail silencing and `M.integrate(false)`; `start()` (a seek or a cold start → `rack.transport()`); `watch(ids)` ids ⊆ `['meters', 'mfx']` and **the post gate tests `mm \|\| mx` only** (:5209, :5271); `postMon` (`mmon`, `smon {c:'mfx', gr, fxph, ftap}` — **no `mo`**); `process` (one split at a pending start, `part()` per ≤ 128 frames; the start split at `ceil((d − 0.5)/4)·4` :5260 — the Track splits at `max(4, ceil(d/4)·4)` :4731), `part()`: the **calm copy path** (`r === null \|\| (r.calm === 1 && r.nConv === 0 && wf === 0)`) else the rack path (Float64 in, `rack.sc` fields, `r.process` bracketed by the `c.t` timer :5297–5299, the A/B dry line), `preroll()` offline (`r.process` on zeros for `settleN()` frames before frame 0), `warm()` ≈ 0.25 s, `stats`; registered **before** `synth-engine` | engine.js:5033–5355 (constructor :5056–5100, `warm` :5104, `preroll` :5131, `msg` :5135–5154, `transportMsg` :5182–5195, `start` :5196, `watch` :5206, `postMon` :5211, `process` :5251–5281 (:5260, :5271), `part` :5283–5314), :5418–5420 | §3: `mc` on the rack path only; the clock from the transport message's pend; `'mods'` in `watch` and in the post gate; `mo` with a ModCore; the pre-roll runs ModCore too; the snap |
| **The FXRack ramp and transport**: every call ramps each parameter from `b0 + md` (the previous call's target) to `b1 + mdT` and only then `md ← mdT` (:3054–3056 globals, :3071–3073 units); `transport()` re-seeds LFO phases only (:2695) and never snaps `md`; `setMods(off, key)` clamps ±2, uses the vector only when `key === this.key`, clears `calm` on a change (:2655–2672) | fx-dsp.js:3040–3080, 2695, 2655–2672 | the first rack call after ▶ ramps from a history-dependent start → **`FXRack.modsJump()`** (§3.4) |
| **SxMod's transport**: `transport(true)` resets every processor LFO (`oPh = lfoStart`, FREE included), `beatClk`, `fB0`, `jmp`, seeds mono chaos and the processor LFO states; `playing = 0` on a stop; the pseudo-voice (`V.mod`) and its row slews are left alone; `begin` takes `m.bpm` from the shim | sx-mod.js:1416–1433, 1264–1310 | MM2's exactness class (§3.4, G3) |
| **The compile**: `compileMods(t, project, opts)` is pure over `t.id`, `t.dev`, `t.mods`, `project.bpm` / `project.perf` / `project.pads`; a **panel** destination compiles to `{ kind: 'fx', chain: <devId>, fx: 8 + fd.flat, key: fxLayout(fx).key }` through `rackDescs(d.fx)` / `fxDest` (`validRows`); the memo signature hashes the rows, the module states (bar macro / CC values), a panel's layout key; a row whose knob the rack no longer has is **filtered by `validRows`** at compile (never a load-time prune); `modBudget(t, dev, project)`; `modRowsFor(t, devId)`; `EXT_N 16`, `VAL_N 16`, `SYN_MAX 48` | cv-graph.js:634–643, 644–772 (the payload :767, its key :768–770, `slots` :756), 535–558 (the panel branch :548–555), 592–613, 773–785, 360, 520, 527 | a record `{ id: 'master', dev: { mfx: {kind: 'panel', fx}, … }, mods }` compiles **unchanged** (§4.1) |
| **The model API** (cv-model): `addModDev(t, kind)` writes `t.dev[id]`; `setModState`; `removeModDev` (drops its rows: `dropRows`, `dropLay`); `addMod(t, src, dst, o)` (`srcOk` → `srcDev(t, src)` / the wheel / a pad; `destOk(d, param)`; `mods(t)` = `t.mods \|\| (t.mods = [])`; **`rowId(t)` starts at `r1` from `t.mid`** — the master's `r1` and a track's `r1` collide); `setMod`; `removeMod` (**`t.mods = t.mods.filter(…)`**); `pruneRows = dropGone`; `devFull(t)` (DEV_MAX); `devKey(t, dev)` finds a device by identity | cv-model.js:398–431, 497–559, 375–385, 386–395, 112–113 | every call needs a record whose `dev` / `mods` / `mid` **writes land in the project**: the forwarding record of §4.1 |
| **The descriptors / rules** (cv-mods): `destOk(dev, id)` — a `panel` device: `rackDescs(dev.fx)` minus `nomod`; a modulator's own knobs refused (`NOMOD_MOD`); `sourcesOf(t, p)` (the wheel and the pads when the project has them, then the track's modules), `linkSources(t)` (Serums only), `modDevs(t)`, `srcDev`, `perNoteOf`, `MOD_LABEL / MOD_PREFIX / MOD_MULTI / MOD_ORDER`, `kindOfId`; **`compileMods` makes an LFO per-note when `!dev.lfo.mono`** (cv-graph.js:673) | cv-mods.js:592–609, 511–537, 466–499, 448–459; cv-graph.js:673 | the master's source list is `sourcesOf` filtered to `scope === 'track'` (no wheel, no pads: §4.4); MONO locked on the master (§7.2) |
| **The modulator bodies**: `cv-mods-ui.bodyFor(kind, o)`; LFO / ENV / Macro / Chaos are **Serum's own panels over a slot host** (`slotBody`: `o.get / edit / live / cancel / set / bpm / rows / view / storage / notify / devKey`), `update(v)` takes a level or `{ v, ph, y, out }` / `{ v, stage, t }`; **the GLOBAL / PER NOTE toggle is the MONO switch on Serum's LFO panel (sx-ui-mod.js:404) and the Chaos row (:540)**, written through `modLive` / `modEditState` → `lfo.mono = 0`; the module bar's badge only reads it (main.js `cvBadge` :7333–7338) | cv-mods-ui.js:1–36, 259–299, 313, 353, 381; sx-ui-mod.js:404, 540; IMPL-3 §2.3 | unchanged bodies; the master mounts them through `modMount` (§7.2); the MONO lock (§7.2) |
| **The mod layer** (`createModLayer(host)`): inspector / Mod list / parameter list over `host = { descs, sources, rowsOf, presetRows, budget, edit, remove, toPreset, fromPreset, connect, select, notice, step, … }`; `MAX_ROWS 64` | cv-modlayer.js:1–31, 160; main.js:10213–10242 (`modHostO`) | the host's callbacks read `trk()` → the owner indirection (§7.1) |
| **main.js — the master**: `MASTER 'master'`, `mnode`, `masterMsg` (`ready / stats / mmon / smon / fxph / ab / fxover`), `masterFx()` (`project.master.fx`, else one detached default per project `mfx0`), `hasMasterFx`, `masterN`, `masterChain(sr)` (`qr: null`), `masterSend` (deduped `{t:'chain'}` after its assets; its `go()` posts), `masterSync` (power-on, **before `syncNodes` builds any Track**, main.js:1049–1050), `masterEdit(fn, o)` (**no `fxPrune`**: "the master has no mod rows"; posts the chain synchronously), `keepMaster(p, cur)` (an undo keeps the current rack); `postTo({id: MASTER})` → MASTER; `postAll` forwards `transport` / `panic` only. **Readers of `project.master.fx` besides these**: `loadProject` (:309 `fxLoad`), `scMasterUnits` (:1255), the asset manager's `states()` (:2961), `syncPhases` (:3188), `projectFile` (:3205: the master's user IRs embedded in the Save), `bounce` (:5287 `latBound`) | main.js:1403–1510, 1387–1402, 1049–1050, 309, 1255, 2961, 3188, 3205, 5287 | **all untouched** (the additive design keeps `master.fx` where it is — §2, §5); `masterEdit` prunes and reposts the master's mods (§4.2) |
| **main.js — the master canvas**: `cvMaster`, `MASTER_SRC`, `masterRec()` (**since phase 0 the constant `MREC`, §4.1**), `cvMasterHost()` (`devices: t => cvModule.devicesOf(t)`, `bodies: { mount: mMount, unmount: mUnmount }` — **`mMount` mounts the rack's `section.fxtab` for every key ≠ `'out'`** (:6893–6905), `title` returns "Master OUT" for every key ≠ `'mfx'` (:6850), `badge: () => null`, no `cables` / `project` / `mods` members, `patch: false`), `cvRenderMaster` (**`modDrag = null`**), `renderMasterFx` (the rack's `section.fxtab` — **no `data-dev`** — `monitors.sub(MASTER, 'mfx', …)` delivering `gr / ftap` only), `mfxHost()` (`scSources(null)`), `masterOpen` (closes the mod layer) / `masterOff` (**does not**), `mMenu` (Fold / Bring to front / Tidy; the OUT: Fold), `mLay` / `mTidy` (`project.master.lay`, History steps), `mAddEffect`; the Sources tray on the master canvas shows `MASTER_SRC` alone (`srcModeUI` returns before the sections, :6017–6018; `#srcTray.cv-mside` hides `#srcLayout / #srcScroll / #srcNote`, style.css:1543) and refuses drops / picks (:6049, :6087, :7174, :8024, :8397) | main.js:6823–7045, 6017–6018, 6049, 6087, 7174, 8024, 8397; style.css:1543 | §7: the cable members, the drag, `data-dev`, the mount / title / badge routing, the Modulators tiles, the tray rule retired, `MASTER_SRC` reworded |
| **main.js — the modulation host** (the "cv MODULATION" section, :9049–≈10300): `buildMods(tr)` (the memo + `{off: true}`), `modsLast` / `modsPay`, `dashedOf`, `modsFor` (the bounce's payload), `postMods(tr, N)` (`N.modsKey`, `N.modsHold` + the 66 ms throttle whose timer re-checks **`nodes.get(tr.id) === N && project.tracks.includes(tr)`** :481, `{off: true}` once), `modVals`; `queuePatch(tr)` → `sendPatch` (`nodes.get(tr.id)`); `modMount` (`trk()` :9363, the `get` by `tid` :9377, the macro `o.set` → `modVal(trk(), …)` :9376, `mcMonitor(tid)` :9396), `modLive` (`trk()` :9407, `nodes.get(t.id)` :9411 → `N.modsHold`), `modLiveEnd` (`nodes.get(G.tid)` :9410), `modCancel` (:9417), `modRowsFrom / modRowsOps` (:9423–9431), `mcMonitor(tid)` (`monitors.sub(tid, null, { role: 'none', mods: true })`, `project.tracks.some`, `live: project.selTrack === tid …` :9440–9446), `mcMonSync` (:9447), `mcSnap(tid, mc, mcx)` (`project.selTrack !== tid`, `project.tracks.find`, `modsPay(t)`, `pay.slots` :9451–9464), `modEditState` (:9509), `modVal(t, key, port, v)` (`postTo(t, {t:'mval'})` :9518–9525), `modLearn` / `modCC` (:9527–9565: `targets(ch)` = `midiTargets(project.tracks, …)` :2358; `t === trk()` :9561), `modSpot` (**adds the project Mod Wheel's height** :9633) / `modClear` (**shifts left past instruments only** :9646–9654), `modAdd` (the master refusal :9687; `'pads'` → `padsAdd`; the Controllers tile's `ctlPick → modAdd('pads')` :6173), `modTileDrag`, `modDelete`, `modLabel(id, t0)` (:9773), `modCan` / `modMarks` / `modLeftWhy` / `modConnect` / `modSrcPick` / `modDests` / `modJackTap` (:9790–9862), **`modBypass`** (:9932–9939: `CMOD.setMod(trk(), …)`), **`modCableAct`** (:9945–9955: `CMOD.removeMod(trk(), id)` — Disconnect, the Delete key), `modPre / modUnpre / modMeta / modStep / modUnstep` (:9966–9986), `cvModAfter(t)` (:9988), `modHalos` → `fxHalos(t)` (`fxKeysOf(t)`: Serums' own FX + every `panel` device; `fxRowsOf`; `rec.ui.paintMods`), `fxMoIndex`, `fxLive(tid, key, rec, d)` (a panel: `base + d.mo[i]`), `cpHalos`, **`modEdit`** (:10124 `trk()`), **`modRemove`** (:10139), **`modDescs`** (:10172 `trk().dev[dev]`), `initModLayer` / `modHostO` (:10213–10242), `modList` (:10244), `cvModSync`, `cvModReload`; **`cvTitle` / `cvDevName`** read `trk()` (:6654–6669; `cvDevName(MREC, 'mfx')` would say "OUT"); `cvBadge(key)` (:7333–7342: the LFO's GLOBAL / PER NOTE badge, then `modCount(t, key)` on a panel); the node handler's `modsErr` (`N.modsKey = undefined` :1138) | main.js:446–504, 644–647, 690–710, 9063–9072, 9362–9431, 9440–9464, 9508–9565, 9627–9735, 9743+, 9773–9870, 9932–9955, 9966–10060, 10124, 10139, 10172, 10213–10260, 6654–6669, 7333–7342, 1138 | **the mechanical rerouting rule of §7.1** over the whole section (the sites above are the ones found at ba91775; the lane finds the rest by the rule, not by a list) |
| **Monitors**: `wanted(MASTER)` = the subscriptions' `dev`s (`'meters'`, `'mfx'`); `deliver(MASTER, d)`: `mmon` → `'meters'`, **else `'mfx'`**; a track's `'mods'` id rides `S.mods`; `postTo({id: MASTER})` reaches MASTER | main.js:3005–3076 (:3042–3045, :3064), 1388 | a `'mods'` sub on MASTER (`S.dev === 'mods'`) and `smon` carrying `mc` → the `'mods'` subs (§7.4) |
| **Bodies keyed by module key alone**: `modBodies` ('l1'); the selected track's `mcMonitor` sub tests `project.selTrack === tid` + `cvView.live(k)`; dropped at a view switch only because every track body unmounts (`mcMonSync`) before a master body mounts | main.js:9072, 9444, 9452 | gate every owner's `live` / `mcMonSync` / `mcSnap` on `shownId()` (§7.1, §7.4) |
| **The bounce**: `bounce()` builds the items (`mods: x.graph ? modsFor(tr) : null`) and `o.master = { fxr, fxrT, transport, frames, lmax, needs }`; `renderOffline` makes the offline MASTER with `processorOptions { offline, transport, frames, fxr?, fxrT? }` after the items; `po.mods` on the track nodes | main.js:5262–5300 (:5281, :5288), 3459–3517 (:3478, :3498–3506) | `o.master.mods = modsFor(MREC)` (+ `bpm`) → `processorOptions.mods` **only when non-null** (§4.3) |
| **Data**: `song.normMaster(m)` → `{ fx?, lay? }` at ba91775 — **since phase 0 `{ fx?, mdev?, mods?, mid?, lay? }`** (§5.2); `deserialize` whitelists `master`; History snapshots carry project keys in `m` and **`History.undo` is `JSON.parse`** (song.js:446 — not `deserialize`: a snapshot restores as written); `cv-migrate.SCHEMA` 16 → **17 (phase 0)**, `STEPS[16]` the identity; `toV1` `masterCount(p.master)` reads `m.fx`, `delete p.master` — **phase 0 adds the modulators' lost line**; `keepMaster` reads `cur.master.fx` — **phase 0 keeps `p.master` when `mdev` / `mods` remain** | song.js:699–732 (phase 0), 446, 765–766; cv-migrate.js:113, 159–165, 271–276, 285–295; main.js:1506–1510 | §5 |
| **Pins**: the schema pins (cv-migrate.test.mjs ×6 blocks + :32, canvas-8-sim:405 / :417–418, canvas-9-sim:436 / :446–447, canvas-M-sim:337–352; canvas-7b / 7c / WC read `SCHEMA + 1` / `CM.SCHEMA`) — **moved in phase 0**; `canvas-M-sim:400–401` pins the refusal itself (`cv.mod.add('lfo', null) === null`, the notice `^The master takes effects — add them with the rack’s \+`) — **moves in lane H**; `master-proc.test.mjs:385` ("mmon every ≥ 33 ms"; `mon` ids) and :751 (ref-M); `canonical-stream` (three parts); `golden-graph:244–263` (Track monitors only); bench rows `mc0 / mc / mt / me` (per Track, kind 'track'; **targets node / ipad only — no jsc**) and `master-empty / -meters / -rack5` (kind 'master', `env.mkMaster`) | tests/…; tests/bench-scenarios.mjs:563–566, 621–627, 694–695; tests/bench.json `targets` | §9.3 |
| **Docs that say "no modulation on the master"**: IMPL-M §1.2 (:116–117), §2.2 (:194–195), §5.2 (:282, :293), §11 (:413); main.js comments :6829, :6892; IMPL-SC §4.4 / §11 (the master's Ducker fires from any track's notes; its compressor has no key input) | docs/canvas/IMPL-M.md; main.js | updated by the lead (§9.4); the Ducker / key facts stand |

---------------------------------------------------------------------------------------------------------------------------------

## 1. Which modulators, which targets [C]

### 1.1 Sources on the master
The master has **no notes** (IMPL-M §1.2 [R]): nothing gates ModCore's pseudo-voice there, so every **per-note** source would sit at its
rest value forever — an ENV never attacks, a PER NOTE LFO never advances (mod-core.js:347–356: the pseudo-voice ticks only while `act`
[R]), Velocity / Note read the last note that never came. **The master's Modulators section offers the sources that mean something
without notes**: **LFO** (GLOBAL — the MONO lock, §7.2), **Macro**, **CC**, **Chaos** (mono — the same lock). Not offered (the lead's
first guess, §10): Mod Wheel (a performance source whose value also comes from each track's cc lane; a CC module on CC 1 *is* the
hardware wheel), Velocity, Aftertouch, Bend, Note, ENV — **an LFO in ENV (one-shot) mode already restarts at ▶ and runs once** (the
transport re-seed, sx-mod.js:1420 [R]): a "song envelope" without a new kind. **CC on the master**: a hardware controller drives a
master CC module **whatever track is selected** — the module's channel (0 = omni, else that channel) is the only filter (§7.1 `modCC`);
the body moves while the master canvas shows. The project's **Pads** mod pads are value sources ModCore could read, but a Pads module is
not on the master canvas (IMPL-M §5.2) and a cable must leave a visible jack: **not offered** in this stage (§11). The slot budgets are a
track's (10 LFOs, 2 chaos, 8 macros + 16 value sources, 48 synthetic rows, `MAX_ROWS` 64 in the Mod list): one ModCore per MASTER.

### 1.2 Targets on the master
Every **modulatable knob of the master rack**: `destOk({kind: 'panel', fx}, id)` (cv-mods.js:596 [R]) — `rackDescs(fx)` minus `nomod`,
splitter branches and the Ducker's knobs included (its NOTE / BPM switches are `nomod`, as on a track), the compressor's `schp`
(IMPL-SC §3.3 [R]); MAIN only (the master has one rack, `racks: 1` [R]). **Not targets**: the master's listening controls — Volume,
Mono, the A/B bypass (IMPL-M M2: never in a file; a modulated one would make the export differ from playback by design) — and the
Ducker's source / the compressor's KEY (switches, `nomod`). A master modulator's own knobs are not targets (`NOMOD_MOD`, cv-mods.js:591
[R]: the tracks' rule). A cable from a master modulator onto a **track's** knob, or from a track's modulator onto a master knob, is not
offered (the cable drag runs inside one canvas; a cross-node value path is a later idea: §11).

### 1.3 Why ModCore, not the rack's own LFOs or a new unit
The FX units' own LFOs (Chorus / Flanger / Phaser) stay as they are; a "master LFO" as an FX unit would be a second modulation
vocabulary with its own inspector, cables and persistence. ModCore gives the master Serum's modulators (the user's 2026-10-19 rule:
canvas modulators are Serum's own panels), the same cables, the same inspector, the same halos, with mod-core.js unchanged and a
compile that already handles a panel destination (MM3).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The master's record is track-shaped — the additive design (the one idea everything else follows) [C]

Everything that builds, draws, edits and compiles modulation takes **a track-shaped record** `{ id, dev, mods, mid, lay }` and reads
`t.dev[devId]` for destinations: `compileMods` (cv-graph.js:535–558 [R]), `addMod` / `setMod` / `removeMod` / `addModDev` /
`removeModDev` / `pruneRows` (cv-model.js [R]), `devicesOf` / `tidy` (cv-module.js [R]), `cablesOf`, `destOk`, `sourcesOf`,
`modBudget`. At ba91775 `masterRec()` faked that shape for the view (a fresh object with a `dev` getter, main.js:6841–6844 [R]) — a
write through it (`t.dev[id] = …`, `t.mods = …`) would land in a throwaway object. **The design (the skeptic's smaller one, §13 P1-3;
built in phase 0, §12)**: `project.master` stays as it is (`fx`, `lay` — every one of its eleven `master.fx` readers untouched, §0)
and gains **`mdev`** (the master's modulator modules), **`mods`** (their cables) and **`mid`** (schema 17, an identity step: §5); the
host keeps **one session constant `MREC`** whose `dev` is a **Proxy** — `'mfx'` a constant panel device whose `fx` getter reads
`masterFx()`, `'out'` a constant, every other key `project.master.mdev` (a write / delete lands there; `project.master` is made on
the first write, never on a read) — and whose `mods` / `mid` / `lay` are getters / setters over `project.master` (§4.1). Then every pure
module works on the master **without a master branch**, and the host's own master branches reduce to the owner indirection of §7.1.
What it saves over the draft's data move (`master.fx` → `dev.mfx.fx`): the eleven readers and `masterCount` untouched, `keepMaster`
as it is (the snapshot brings `mdev / mods / mid / lay` back by itself), canvas-M-sim's twelve `master.fx` pins, and the "first edit"
semantics — adding an LFO never makes the empty default rack the project's, so no empty chain post and nothing new in canonical-stream.
What it costs: one Proxy on the **compile** path, never the audio path (`compileMods` is memoised and its signature walk is tens of
reads), and the trap invariants, which phase 0's tests pin (`Object.keys`, `in`, `delete`, `getOwnPropertyDescriptor`,
`JSON.stringify(project)` never touching it).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The engine side (lane E: engine.js `Master`, fx-dsp.js `FXRack.modsJump()` only; mod-core.js untouched) [C]

### 3.1 MASTER as ModCore's host — the clock
`Master` gains the fields ModCore's shim reads (mod-core.js:137–143 [R]): **`trackId = 'master'`** (the seed salt `fnv1a32('master')`:
deterministic, the same offline — N5), **`wheel = at = bendRaw = 0`** (plain fields: the shim's getters read `+T.wheel || 0`),
`offline` (exists), and **`songBeat()`**. **The clock is the Track's, field for field**: `transportMsg` keeps today's `pF / pS` (the
pending start's frame and seek flag, which the rack and the meters read) **and stores the Track's pend** `this.tp.pend = { frame, tick,
fpt, loop, ls, le, seek, end, fresh }` (engine.js:4529 [R]); a stop clears it (`tp.pend = null`, `tp.play = false`, `mc.transport(false)`).
`start()` **applies the pend** as `songEvents` does (engine.js:4572–4577 [R]): `tp.play = true; tp.frame / tick / fpt / loop / ls / le /
end` from it, **`tp.wrap = P.loop && P.le > P.ls && P.tick < P.le`** (:4575 — a start past the loop end plays on, exactly as the tracks;
the host's `anchor()` computes the same flag, main.js:1999 [R]), then `mc.transport(true)` under the rack's condition (`pS === 1 ||
cold`). `tickAt(F) = tp.tick + (F − tp.frame) / tp.fpt`; **`songBeat()` = `tp.play ? tickAt(this.pF0) / 960 : null`** with `pF0` = the
first frame of the current part (set in `part()`), the Track's formula (engine.js:4540–4542 [R]). **The loop wrap**: at the top of
each part, `if (tp.wrap && t >= tp.le)` re-base `tp.frame / tp.tick` with the Track's multi-wrap `while` (engine.js:4582–4587 [R]).
**The song end** (`tp.end != null && t >= tp.end`): **`tp.play = false`** (never `this.play`: `start()`'s cold test, the stop branch's
tail silencing and `M.integrate(false)` read `this.play` — engine.js:5182–5201 [R] — and ref-M's offline hash runs through this code with
the bounce's `end`, main.js:5288 [R]) and `mc.transport(false)` (the Track's `transportHook(false)` at the end, :4591–4592 [R]). **No new
quantum split** for a wrap or an end (§3.2 keeps today's partition, MM1): the master's BPM-anchored LFOs re-anchor at the first part
boundary after the wrap — up to one quantum (≤ 2.7 ms at 48 kHz) after the tracks' (which split spans at the wrap frame) — recorded
in §11; audibly nothing, and identical live and offline (MM2: the same quanta both ways).

### 3.2 Messages, the span, the rack path
- `{t:'mods', …}` → **`modsMsg(d)`** — the Track's code (engine.js:4058–4074 [R]) minus `handRows` (no Insts): `MCM.create(this,
  this.base, S_N)` on the first payload with rows, `setRows` (**the master's payload carries `bpm`**, §4.2, so ModCore's shim runs
  the project tempo while stopped and with ANCHOR off — the track-side gap of §0 does not reach the master), `watch(mcMon)`; a rejection
  → `{t:'modsErr', i: 'master', key}` and the previous rows keep running; `{off: true}` or an empty payload → `modsOff()` (`mc = null`,
  `rack.setMods(null)` once when `c.mcOn`).
- `{t:'mval', k, v}` → `mc.ctl(k, v)` when `mc !== null`.
- `{t:'mon', ids}` → `watch(ids)`: ids ⊆ `['meters', 'mfx', 'mods']`; `this.mcMon = has('mods')`; `mc.watch(mcMon)`; **the post gate
  becomes `(mm || mx || mcMon)`** in `watch` (:5209) and in `process` (:5271) — an LFO body on screen with the OUT and the rack off
  screen must still get posts (P2-2); `postMon` adds **`{t:'smon', mc: MC.live, mcx: MC.mcx}`** while `mcMon && mc !== null` — the
  Track's message (engine.js:5007 [R]) at the same ≈ 29 Hz gate — and the rack's `{t:'smon', c:'mfx', gr, fxph, ftap}` gains **`mo:
  mc.fxMon('mfx')`** only while `mc !== null && fxMon('mfx') !== null` (the Track's :4998–5000 [R]: the live dots of the rack's knobs;
  the shape is unchanged without a ModCore — master-proc:385 holds). A `watch` that later carries a rate (`{t:'mon', ids, hz}`,
  map-fps.md §5 D4 (c)) is ROADMAP 23's: MASTER ignores unknown fields today, as the Track does.
- **The span**: in `part(Li, Ri, Lo, Ro, o, m, F0)` (engine.js:5283 [R]), **when `this.mc !== null` the rack path is always taken**
  (never the calm copy: a modulated knob on an off unit changes no sound, but the vector must land and the rack's own `calm` flag
  follows `setMods` — fx-dsp.js:2655–2672 [R]: a changed vector clears `calm`) and, before `r.process(L, R, m)`: `this.pF0 = F0 + o`;
  the wrap / end checks (§3.1); **`mc.span(F0 + o, m, m >> 2)`** (m is a multiple of 4: parts are 128 or the start split's 4-frame
  point, engine.js:5260 [R]); then **`chainMods`** — the Track's two lines (engine.js:4908–4911 [R]): `const v = mc.fxv['mfx']; if (v
  !== undefined) { r.setMods(v, mc.fxKey['mfx']); c.mcOn = 1; } else if (c.mcOn) { r.setMods(null); c.mcOn = 0; }`; then **the snap**
  when this part is the first after a cold start or a seek (§3.4: `r.modsJump()` once, a flag `start()` sets and the part clears).
  **The `c.t` timer brackets `mc.span` + `chainMods` + `r.process`** (today `tf` brackets `r.process` alone, :5297–5299 [R]: the `mfx`
  module's CPU slot must show the modulation's cost, P3-14). With `mc === null` the path is byte-for-byte today's: one `!== null` test
  per part (MM1).
- **Transport**: `start()` → the pend applied (§3.1), `mc.transport(true)` under the same condition as the rack's `transport()`
  (`pS === 1 || cold`), the snap flag set; a stop → `tp.play = false`, `mc.transport(false)`. `panic` / `bye` / `mreset`: nothing for
  the ModCore (no notes to release; `bye` ends the processor). The store messages: unchanged.
- **Stats**: `stats()` adds nothing new.

### 3.3 Warm-up (JSC)
MASTER is built **before** any Track (live, main.js `powerOn` [R]); the ModCore classes are warmed by the first Track's `warmMods`
(engine.js:3967–3985 [R]) in the same scope, and the shim object ModCore builds has one shape whoever its `T` is (mod-core.js:137
[R]). **But the order is not always "cables long after both warm-ups"** (P3-6): a project loaded with a master cable posts the payload
from `masterSync()` — which `powerOn` runs **before `syncNodes()` builds any Track** (main.js:1049–1050 [R]) — so MASTER's first
`{t:'mods'}` can arrive before the Track's `warmMods` ever ran. **[R?] lane E measures on jsc, in that order** (MASTER, its payload,
then a Track): the first quantum after MASTER's first payload (the G4 pattern of IMPL-M §12 lane D); if it exceeds one quantum,
`Master.warm()` runs one `warmPayload(B, false)` round (`modsMsg` → 20 spans → `modsOff`) at construction, inside the held context,
everything reset after (the `finally` of engine.js:5118 [R]). Offline: no warm-up (as today).

### 3.4 Offline: `processorOptions.mods`, the pre-roll, and the snap (MM2 — P1-1 (a))
**The problem** (§13 P1-1): every FXRack call ramps each parameter from `b0 + md` (the previous call's target) to `b1 + mdT`
(fx-dsp.js:3054–3073 [R]); `FXRack.transport()` only re-seeds LFO phases (:2695). Before ▶ the master's rows free-run (`songBeat()` null)
— live for as long as the payload has been there, offline for the pre-roll's `settleN()` frames — so the last pre-▶ value of an LFO /
chaos differs, the first rack call after ▶ ramps the cabled knob from a different start, and every IIR / delay / reverb state
downstream carries the difference for seconds: not bit-identical, even for BPM-synced and retriggered sources. **The fix — the snap**:
lane E adds **`FXRack.modsJump()`** to fx-dsp.js (≈ 10 lines, additive: `md ← mdT` for the globals and every unit, `eS / eD` recomputed
so the next call starts at the target — no ramp; **no Track calls it**, so every golden is untouched and golden-fx is re-run as the
proof; **amended after review** (reviewer 1's P1): for each running unit with an offset it then runs the enable path's recipe —
targets from `bs + mdT`, `modUpd`, `modSnap`, `mixUpd`, `gD0 / gW0 ← gD1 / gW1` — so the unit's own slews start at the target too).
**MASTER alone calls it**, once, in the first part after a cold start or a seek with `mc !== null` — after `chainMods` (the
vector for this part is in) and before `r.process` — live and offline alike (the offline MASTER's start is its frame-0 transport). A
`transport(true)` re-seeds the ModCore's LFOs / chaos (sx-mod.js:1420–1424 [R]) at the same moment both ways, so the snapped values are
the same both ways: **exact** from ▶ for every modulator kind **whose rows carry no slew** (rise / fall: the pseudo-voice's row slews are
not reset by `transport` and glide from the pre-▶ value for SLEW_T — measured and recorded, not gated; a moving source on a stepped
topology knob — Phaser POLES, Reverb TYPE — is §11's other recorded case). **`processorOptions.mods`**: the
offline MASTER's constructor handles `po.mods` after `chainMsg` (the rack exists) and **before `preroll()`**, and `preroll()`
(engine.js:5131–5134 [R]) **runs the ModCore too** — per 128-frame quantum of the pre-roll, `mc.span(0, 128, 32)` then `chainMods` then
`r.process(L, R, 128)` on zeros (`songBeat()` null: not playing) — so the offline rack's mod targets stand where a live rack's do
before ▶ (a settled rack with rows running, not a rack whose targets are 0), the snap then makes the start exact. `mlat` / `mfinal` /
the window are unchanged (the ModCore adds no latency: `pathLat()` reads the units).

---------------------------------------------------------------------------------------------------------------------------------

## 4. The host model (lane H: main.js) [C]

### 4.1 `MREC` — the master's constant record (phase 0: built, §12)
`masterRec()` returns **one session constant** `MREC = { id: MASTER, name, color, wires: M_WIRES, get dev(), get/set mods, get/set mid,
get/set lay }`: `dev` is the Proxy **`MDEV`** — `get 'mfx'` → the constant `MFX_DEV = { kind: 'panel', get fx() { return masterFx(); } }`
(the detached default while the project has none, the project's once it has), `get 'out'` → `OUT_DEV`, any other key →
`project.master.mdev[k]`; `set` / `deleteProperty` → `mBox().mdev` (a write to `'mfx'` / `'out'` is ignored); `has` / `ownKeys` /
`getOwnPropertyDescriptor` (configurable, enumerable) over `'mfx'`, `'out'` and the `mdev` keys (the target stays an empty extensible
object: the invariants hold) — `mods` / `mid` / `lay` read `project.master` live and write through **`mBox()`** (`project.master`
made on a write, never on a read: "absent = empty, no key until the first edit" — a lay write or an LFO added makes `project.master`
with that key only; **the rack is never made the project's by a modulator or lay write** — `masterEdit`'s `project.master.fx = fx` line
stays the rack's only "first edit", so `masterSend`'s `hasMasterFx()` gate (main.js:1467 [R]) posts no empty chain, P2-6). A session
constant, not "rebuilt per project": `applyRestore` replaces `project` (main.js:1918 [R]) and the getters read it live, so no closure —
an undo notice, `modG`, a `mcMonitor` sub, `cvView`'s record — ever holds a stale record (P2-6). `cvMasterHost().devices` =
`t => cvModule.devicesOf(t)` **unchanged**: `devicesOf(MREC)` lists `mfx` (kind `fx`), `out`, then the modulators (cv-module.js:313–314
[R]) — the master host never goes through `cvDevices` (no wheel, no Pads: MM4). **The owner helpers** (phase 0, used by the hooks until
lane H adopts them): `mOwn() = cvMaster ? MREC : trk()`, `ownerById(id)` (`'master'` → MREC, else the track or null), `ownerNode(t)`
(MREC → `mnode`, a track → `nodes.get`), `shownId() = cvMaster ? MASTER : project.selTrack`.

### 4.2 The payload and its posting
`buildMods(MREC)` → `CG.compileMods(MREC, project, { smooth, qr: null, ultra: 0, padVal })` (main.js:450–456 [R]: the memo keyed by the
record's identity — `MREC` is constant, so the memo holds); **the master's payload gains `bpm: project.bpm`** (the host adds it to the
compiled object before posting / before `processorOptions` — `ModCore.setRows` reads `m.bpm`, mod-core.js:189 [R]; the TRACK payloads
stay as they are, §0 / §11); `modsLast.set('master', pay)`. **`postMods(MREC, mnode)`**: `mnode` gains `modsKey / modsAt / modsHold /
modsT` (the node record's fields postMods reads, main.js:476–490 [R]); **its throttle timer's re-check becomes `ownerNode(tr) === N &&
(tr === MREC || project.tracks.includes(tr))`** (today `nodes.get(tr.id) === N && project.tracks.includes(tr)`, :481 [R] — false for
MREC: the delayed repost would be dropped and MASTER keep a stale payload, P1-2); the message goes to `mnode.node.port` with `i:
'master'`. **When**: `queuePatch(MREC)` → the rAF-coalesced queue (main.js:644–647 [R]) gains a master branch (`t.id === MASTER` →
`postMods(MREC, mnode)` instead of `sendPatch(t)`); **`masterSend`'s `go()` posts the master's mods right after the chain** (P3-9: the
rack's layout key and the rows' key must land together — between a synchronous chain post and a rAF repost the rack would run
unmodulated, `setMods`' key check, fx-dsp.js:2656 [R]); `masterSync` (a new MASTER at power-on) therefore posts the payload with the
chain (MASTER's live `processorOptions` are `{}` [R]); `applyRestore` / `loadProject` / New → `queuePatch(MREC)` (postMods dedupes by
key; `{off: true}` once when the rows went); `masterEdit` → `fxPrune(MREC, 'mfx')` (an effect removed takes its cables, main.js:3125–3133
[R]) and the repost through `go()`; `queueAll` (tempo, prefs `smooth`) → `queuePatch(MREC)` too. `masterMsg` handles **`modsErr`** as
the track handler does (main.js:1138 [R]: `mnode.modsKey = undefined`, a console warning naming the master) and **`smon` with `mc`** →
`monitors.deliver(MASTER, d)` (§7.4). `modVal(MREC, key, port, v)` → `postTo({ id: MASTER }, { t: 'mval', k, v })` (postTo's master
branch, main.js:1388 [R]).

### 4.3 The bounce
`bounce()` adds **`mods: modsFor(MREC)`** (with `bpm`) to `o.master` (main.js:5288 [R]; `modsFor` returns null for `{off}`);
`renderOffline` sets **`processorOptions.mods`** on the offline MASTER **only when `mo.mods` is non-null** (main.js:3498–3502 [R]) — an
untouched master's offline options are byte-identical (canonical-stream's `synth-master` part, MM1). The dialog's note gains nothing.
`mAlign` already rounds while `masterN() > 0` (main.js:2047 [R]) — a cable needs an effect, so a modulated master always has aligned
anchors (MM2).

### 4.4 Sources, labels, the mod layer
`modSrcList(MREC)` = `CMOD.sourcesOf(MREC, project).filter(s => s.scope === 'track')` (no wheel, no pads: §1.1) — `linkSources(MREC)`
is `[]` (no Serum). **Names**: `cvDevName(MREC, 'mfx')` would fall to `cvTitle`'s "OUT" (main.js:6669 [R]) — `cvDevName` / `cvTitle`
take the owner (§7.1): for MREC the master host's `title(key)` ("Master FX"; a modulator: `CMOD.modLabelOf(key, MREC.dev[key])`) — so
`addMod`'s `name`, `modList`'s labels and `cvModReload`'s notice read right. `modLabel(id, MREC)`: a source → `modLabelOf`, a knob
`'mfx:fx.<inst>.<pid>'` → the panel branch ("Reverb Mix", main.js:9783 [R]). **`modDescs('mfx')`** (main.js:10172 [R]: `trk().dev[dev]`)
→ `mOwn().dev[dev]` — the inspector's and the parameter list's entries for the master rack (P1-2). The mod layer's `budget('mfx')` →
`kind 'panel'` (main.js:10224 [R]); `modList()` on the master → `openList('Master', [{ id: 'mfx', label: 'Master FX' }])`;
`presetRows` → `[]` (no Serum); `hidden` → null.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Data: schema 17, an identity step (phase 0: built, §12) [C]

### 5.1 The shape
```
project.master = {
  fx:   <FX v2 state>,                                      // the master rack — as at stage M (every reader untouched)
  lay:  { mfx: {x, y, fold?}, out: {…}, l1: {…}, … },        // normLay, as today
  mdev: { l1: { kind: 'lfo', lfo: { mono: 1, … }, rate, … }, m1: { kind: 'macro', v, names }, c1: { kind: 'cc', … }, h1: { kind: 'chaos', chaos: { mono: 1, sh }, … } },
  mods: [ { id: 'r<n>', src: 'l1.out' | 'm1.k3' | 'c1.out' | 'h1.out', dst: 'mfx:fx.<inst>.<pid>', …normRow fields } ],
  mid:  <the next row number, a track's rule>
}
```
**Absent = empty** (no key until the first write: §4.1); a master holding only `lay` stays `{ lay }`; `wires` are never stored (`M_WIRES`
is the host's constant). **`SCHEMA = 17`**; **`STEPS[16]`** is the identity (`{ …p, schema: 17 }`: a new object, the input untouched —
every STEP's rule). An older build reading a 17 file: read-only (`upgrade`, the stage pattern: a schema-16 build's `normMaster`
whitelists `fx` and `lay` only — it would drop `mdev / mods / mid` and autosave the loss).

### 5.2 `song.normMaster(m)` (phase 0)
→ `{ fx?, mdev?, mods?, mid?, lay? }` or undefined when nothing is valid. **`mdev`** through **`normMasterDev(d)`**: a key under its kind's
prefix (`l<n>` / `m<n>` / `c<n>` / `h<n>`) whose `kind` is in **`MASTER_MOD_KINDS = ['lfo', 'macro', 'cc', 'chaos']`** → `normModDev(d)`
**then `lfo.mono = 1` / `chaos.mono = 1` forced** (§1.1: a per-note mode has no meaning on the master — a file edited by hand or a tap
that got through reads GLOBAL / mono); any other key or kind (`env`, `nt`, `mfx`, `out`, a wrong prefix, `__proto__`) **dropped**;
`DEV_MAX` bound as `normDev`. **`mods`** → `normMods(m.mods)` (song.js:680–696 [R]); **`mid`** as `normDev`'s rule (`max(mid, every row id
+ 1)`; a `mid` alone is kept — ids stay fresh, a track's rule); **`fx`** and **`lay`** as before. `deserialize` keeps its one line
(song.js:765–766 [R]). **No load-time prune** (P3-1): a row whose knob the rack no longer has is **filtered by `validRows` at compile**
(cv-graph.js:535 [R]) and **pruned by `fxPrune` on a rack edit** (main.js:3117 / 3125 [R]) — the tracks' rule, nothing new at load; an
undo restores snapshots through `JSON.parse` (song.js:446 [R]), never through this reader.

### 5.3 History, presets, `toV1`
**History**: `project.master` rides in the snapshot's `m` (song.js:429–434 [R]). `keepMaster(p, cur)` (main.js:1506–1510 [R]) keeps the
**rack** across an undo within the project (the knob policy, unchanged) and **the snapshot brings `mdev / mods / mid / lay` back by
itself** — a master cable, a module added / deleted / edited, a move, Tidy are History steps exactly as on a track (2b's `modPre` /
`modStep` glue, main.js:9966–9986 [R]); phase 0's one change: `keepMaster` no longer deletes `p.master` when it holds `mdev` or `mods`
(only when nothing but the dropped `fx` was there). Consequences the tests pin: an undo of a track edit leaves `project.master`
byte-identical; an undo of "Modulate Reverb Mix with LFO 1" removes the row and reposts (or `{off: true}`); an undo of a master knob
turn does not exist (no step), the rack kept; an undo of Open / New brings that project's master whole. **A restored row may dangle
against the kept rack** (an effect removed since, without a step): `validRows` filters it at compile, the next rack edit prunes it — the
tracks' class (§11, P3-15). **Presets**: a module preset / rack preset / chain preset saved from the master rack carries no cable
(cables are `project.master.mods`, not FX state — as a track panel's today); `blankSrc` (IMPL-SC) applies as it does. **`toV1`** ("Save
as classic project"): `masterCount` unchanged; a second `lost` line **"the master modulators (n modules, m cables)"** when any exists
(phase 0); `delete p.master` as today (cv-migrate.js:285–295 [R]). **Duplicate / split / `splitTracks`**: untouched.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Exactness, cost, the iPad

### 6.1 Live ≡ bounce (MM2)
Bit for bit when: the same payload (the bounce's `modsFor(MREC)` is the live `modsLast` — macro / CC values in the payload are the
modules' stored `v` (`refreshVals`, cv-graph.js:627–633 [R]); the live table was set by `{t:'mval'}` from the same `v` at each gesture's
end — a **CC's last live value is not written to the record per controller** (main.js:9535–9538 [R]: a bounce renders the stored `v`):
the tracks' existing 2b limit, §11), a quantum-aligned start (`mAlign`), a silent history (IMPL-M M2's class), the same rate /
oversampling ("Same as playback"), the pre-roll and **the snap** of §3.4, **no slewed row**. G3 asserts it on the real engine **at
140 BPM** (not 120: the ModCore default would hide a tempo path) for a 5-unit rack with four cables (a BPM-synced LFO on a Filter
cutoff, a mono chaos on a Delay feedback, a macro on a Reverb mix, a CC on a Utility level, every row rise / fall 0): the live MASTER
(its rows posted before ▶, ≥ 0.5 s of exact zeros, the transport at a quantum boundary) ≡ the offline MASTER (options), 0 samples
differ; then a FREE unsynced LFO added (exact or not: G3 decides and records), then a row with rise / fall 0.3 (measured: level and
decay, recorded).

### 6.2 No modulator = today (MM1) — the proof set
Every golden file after every engine.js / fx-dsp.js edit (fx-dsp.js gains `modsJump()`: golden-fx and master-proc prove it inert
unless called); `tests/master-proc.test.mjs` (ref-M's three hashes; **new cases**: `{t:'mods', off: true}` / an empty payload / a
payload with no rows → `mc` stays null and the output ≡ the no-message run; `{t:'mon', ids: ['mods']}` without a ModCore → no `mc`
post and no `mo` on the rack's `smon`; a payload then `{off}` → the rack's `setMods(null)` once and **every `md` / `mdT` back to 0 after
the next call** (the parameter state, P3-3 — the audio after it is not compared: a filter / delay / reverb state carries the modulated
history); `modsJump()` on a rack without mods is a no-op bit for bit); `tests/canvas-M-bounce.test.mjs` (the three bounce hashes through
schema 17); `tests/canonical-stream.test.mjs` (the three parts and both fixtures untouched: the session has no master cable; the
offline MASTER's options unchanged); `tests/ref-SC` live-p1 (lane H's sim); engine-track's warm-up hash; `tests/canvas-M-sim.test.mjs` G1
(the live output = the tracks' sum, a copy).

### 6.3 Cost
Per quantum with rows: ModCore's `span` ≈ the per-track rows `mt` 0.0013 / `mc` 0.0025 (tests/bench.json `node` [R]) — the same code
on MASTER — plus `setMods` (≤ 1 µs). **New bench row `master-mods`** (kind `'master'`, `env.mkMaster`, tests/bench-scenarios.mjs:621–627's
pattern [R]): the 5-unit rack of `master-rack5` + a payload of 4 GLOBAL LFOs, 1 chaos, 1 macro module and 8 `fx` rows (a hand-built
payload: `ModCore.warmPayload`'s shape with `dst.kind 'fx', chain 'mfx'`). **Gated two ways** (P3-5 — a difference of two noisy rows
cannot resolve 0.004): (a) the row itself ≤ `master-rack5`'s target + 0.004 (node 0.034, jsc 0.034, ipad 0.029 — `master-rack5` is
0.03 / 0.03 / 0.025); (b) **the delta measured interleaved in one process** (the scenario alternates rack5 / rack5 + mods per block and
reports the difference) ≤ 0.004 node / jsc, ≤ 0.006 ipad; the Low floor (IMPL-P's × 7 on jsc) on the delta ≤ 3 %. The master's load
joins the engine total as today (IMPL-M §2.1 [R]); the safeguard's levers never touch it (a heavy master is the user's call). UI: a
modulator module on the master canvas costs what one on a track costs (the same slot bodies, the same DOM budgets — IMPL-3 §1.4; the
S0 painted-elements notice applies).

### 6.4 The iPad / WebKit / the presets
No new worklet message type, no node option change, no new DSP file; MASTER's `{t:'mods'}` is the Track's payload (WebKit renders it
today on every track). The master canvas with modulators: the touch cable drag onto an FX-look knob (the FX look's `data-dest` parity
gate, IMPL-WC §14 [R]), two-finger cancel as on a track (2a). The performance presets: nothing here reads them (visual only). No iPad
app rebuild (browser first); the app's node tests stay in the sweep.

---------------------------------------------------------------------------------------------------------------------------------

## 7. UI (lane H: main.js; lane U: cv-tray.js, cv-mods-ui.js / sx-ui-mod.js (the MONO lock), style.css, texts) [C]

### 7.1 The owner indirection — a mechanical rule (P1-2)
Inside main.js's **cv MODULATION section** (:9049–≈10300), the cable handlers (`modCableMenu / modBypass / modCableAct`), the mod layer's
host (`modHostO`, `modEdit / modRemove / modDescs / modList / cvModReload`), the halo paths (`modHalos / fxHalos / fxRowsOf / fxMoIndex /
fxLive / cpHalos`) and `cvTitle / cvDevName / cvBadge`, **four substitutions, applied to every site, not to a list**:
1. `trk()` → **`mOwn()`** (the record the canvas shown edits);
2. `project.tracks.find / some(x => x.id === tid)` → **`ownerById(tid)`**;
3. `nodes.get(…)` → **`ownerNode(…)`** (MREC → `mnode`);
4. `project.selTrack === / !== tid` → **`shownId() === / !== tid`**.
The sites found at ba91775 — the draft's list **plus the ones it missed** (§13 P1-2): `modMount` (:9363, the `get` by `tid` :9377,
**the macro `o.set` closure `modVal(trk(), …)` :9376**, `mcMonitor(tid)` :9396), `modLive` (:9407, :9411), **`modLiveEnd` (:9410:
`nodes.get(G.tid)` → `mnode.modsHold` never cleared)**, `modCancel` (:9417), `modRowsFrom` / `modRowsOps` (:9423–9431), `mcMonitor` /
`mcMonSync` / `mcSnap` (:9440–9464), `modEditState` (:9509), `modVal` (:9519), `modLearn` / **`modCC` (:9531, :9542, the `targets(ch)`
loop and `t === trk()` :9561 — §7.5)**, `modSpot` / `modClear` (:9627 / :9646 — §7.2's placement), `modAdd` (:9686–9713), `modDelete`
(:9743+), `modLabel` (:9773), `modCan` / `modMarks` / `modLeftWhy` / `modConnect` / `modSrcPick` / `modDests` / `modJackTap`
(:9790–9862), **`modBypass` (:9932–9939) and `modCableAct` (:9945–9955)** — the cable menu's Bypass, Disconnect, the Delete key —,
`modStep` (:9975), `cvModAfter` (:9988), `modHalos` → `fxHalos` … `fxLive` (:9989–10056), **`modEdit` (:10124) and `modRemove`
(:10139)** — the layer's edit / remove —, **`modDescs` (:10172)** — the inspector's and the parameter list's entries for `'mfx'` —,
`modHostO` (:10217–10240), `modList` (:10244), `cvModReload`, **`cvTitle` / `cvDevName` (:6654–6669)** — through the owner: a track's
titles as today, MREC's from the master host's `title(key)` —, `cvBadge` (:7333–7342). **Left alone, with a reason, in §12**: the
wheel's paths (`modJump`, `modOthers`, `wheelTracks`: the project wheel never shows on the master), the Pads' (`padsAdd`, `padMods`:
not on the master), the Serum-only paths (`sxOwnSrc`, `sxOwnConnect`, `modToPreset` / `modFromPreset`, `modPresetRows`, `sxInjEnv`:
no Serum on the master — they return as for a track without one), `cvDevices` (the master host has its own `devices`), the roll /
keyboard / `bind` / `tabTrackUI` (the keys still play the track). **`cvAfter(t)`** (:7254) gains the master branch: `queuePatch(MREC)`,
no `bind` / `renderNav`, `cvRender()` (→ `cvRenderMaster`), `persist`, `updateUndoUI`; `sxFresh` keyed `'master\n' + key`; the undo
notice's lookup through `ownerById`. **`modAdd` on the master still refuses every kind ∉ `MASTER_MOD_KINDS`** (P3-8: the Controllers'
Pads tile reaches it through `ctlPick → modAdd('pads')`, main.js:6173 [R], and so do the hooks) with the §7.3 note as the notice.
**`masterOff` closes the mod layer** as `masterOpen` does (main.js:6862 [R]; P3-10: an open inspector on the master's `r1` would re-read
the track's `r1`). **Row-id collision (MM4)**: `rowId` starts at `r1` from each record's `mid` (cv-model.js:379–384 [R]) — the master's
`r1` and the selected track's `r1` coexist; **G5's collision case** runs every master-canvas action against a track holding the same id
and asserts the track's JSON and every message to its node byte-identical. **Gate**: canvas-2b-sim / canvas-3-sim / canvas-8-sim /
canvas-WC-sim unchanged in their assertions (the tracks' paths are the same code with `mOwn() === trk()`).

### 7.2 The master canvas gains the cables, the bodies, the badges
- **`cvMasterHost()`** gains **`project: () => project`, `presetRows: false`, `mods: modsMode()`** (the toolbar ∿) and **`cables: {
  onSelect: modCableSel, onAction: modCableAct, menu: modCableMenu, onHint: modHint, ignore: modAside, dashedSet: () => new Set() }`**
  (no cords members: the master draws lines); `cvRenderMaster` sets **`modDrag = cvView.cableDrag(modDragOpts)`** (today `null`,
  main.js:6887 [R]); `modDragOpts.port` / `canConnect` / `onConnect` (the Serum-internal audio side) refuse on the master as they do
  for a non-Serum jack.
- **Mount / title / badge** (P2-3): `mMount(key, b)` / `mUnmount(key)` route a modulator key (`kindOfKey(MREC, key) === 'mod'`) to
  `modMount(key, b)` / `modUnmount(key)` — as `cvMountBody` / `cvUnmountBody` do (main.js:6453, 6471 [R]) — and keep the rack's
  `section.fxtab` for `'mfx'` alone; `title(key)`: `'mfx'` → "Master FX" (as today), `'out'` → "Master OUT", a modulator → `{ title:
  CMOD.modLabelOf(key, MREC.dev[key]), sub: 'Master' }`; `badge(key)`: `'mfx'` → `modCount(MREC, 'mfx')`'s text ("mods n") or null, an
  LFO → `{ text: 'GLOBAL', tone: 'mode' }` (`cvBadge`'s branch through the owner; always GLOBAL on the master), else null.
- **The rack root gets `data-dev="mfx"`** on **`rec.ui.el`** (the FXRackUI's root — the track path's line, main.js:4005 [R]; not the
  box, P3-11; cv-cables also falls back to `data-cv-mod`, cv-cables.js:1409 [R]): the knobs' `[data-dest]` resolve for the cable's end
  (`V.destPort`), the mod layer's hit test, the FX-look faces move the same elements (IMPL-WC §14: data-dest parity). The rack's monitor
  subscription delivers `mo`: `renderMasterFx`'s `deliver` adds `fxLive(MASTER, 'mfx', rec, d)` (main.js:6948 → :4007's form [R]).
- **The MONO lock** (P2-5): the GLOBAL / PER NOTE toggle is the MONO switch on Serum's LFO panel and the Chaos row (sx-ui-mod.js:404,
  :540 [R]), reached through `modLive` / `modEditState`; a tap on the master would make the LFO per-note (cv-graph.js:673 [R]) — the
  pseudo-voice never runs there, the cable goes dead and dashed. **Lane H** (the guard): a master edit forces `lfo.mono = 1` /
  `chaos.mono = 1` back before the write lands (`modEditState` / `modLive` on MREC) and calls `B.sync()`; **lane U** (the presentation):
  a slot-host option **`lock: { mono: 1 }`** (cv-mods-ui.js `slotBody` → sx-host `slotHost(kind, o)` → sx-ui-mod.js) renders the MONO
  switch disabled with the tooltip "GLOBAL on the master (it has no notes)" and ignores its tap; G5 pins "a tap on MONO on the master
  changes nothing".
- **Placement** (P3-7): `modSpot(MREC, kind)` adds **no Mod Wheel height** (the wheel is never on the master: `kind !== 'wheel' &&
  CMOD.hasWheel(project)` → `&& t !== MREC`), the column at `modX(kind)` left of the rack as Tidy's; `modClear(MREC, …)` shifts a drop
  **left past the rack** (`'mfx'`) as it shifts past instruments on a track (its instrument set → `['mfx']` for MREC): a drop on the
  rack lands in the column, never below the rack (G6).
- `mMenu(key)`: a modulator module's menu = `cvMenu`'s mod branch (Delete, Fold, Bring to front, Tidy, the slot body's `menuItems()`)
  through the owner; the rack's and the OUT's as today. `mTidy` places the modulators in Tidy's column left of the rack
  (`cvModule.tidy(MREC, …)` does already — phase 0 pins it). `mCamRestore`'s default frame: the rack and the OUT as today (a modulator
  added lands in view: `modShow`). **Halos / live dots**: `paintMods(fxRowsOf(MREC, 'mfx'))` on the master rack's knobs (the FX look's
  arcs) and `setLive` from `mo` — as a track panel's (main.js:10015–10056 [R]).

### 7.3 The Sources tray on the master canvas (lane U, with lane H's `srcModeUI`)
Today the tray shows one line (`MASTER_SRC`) and no tiles: `srcModeUI` returns before the sections on the master (main.js:6017–6018
[R]) and **`#srcTray.cv-mside` hides `#srcLayout`, `#srcScroll` and `#srcNote`** (style.css:1543 [R]). Now: **the Modulators section**
with the master's tiles — `cv-tray` takes **`o.masterMods`** (an id list) and **`o.masterNote`**, and `tiles.setMaster(on)`: while on,
the view menu is hidden, every model tile / section and the Controllers row are `hidden`, the Modulators section shows **only the tiles
whose id is in the list** (`lfo`, `macro`, `cc`, `chaos`) under the heading "Modulators" and the note **"The master has no notes: its
modulators are LFOs, Macros, CC and Chaos. Drop one on the canvas and cable its jack to any knob of the master rack."**. **Lane U
retires the `#srcScroll` part of the `.cv-mside` rule** (P3-13: the rule becomes `#srcTray.cv-mside #srcLayout, #srcTray.cv-mside
#srcNote { display: none; }`, in place — not an appended block that would have to out-specify it); **lane H's `srcModeUI` no longer
returns early on the master** (it calls `setMaster(true)` instead; `setMaster(false)` when the master canvas is left). `MASTER_SRC`
(the refusal for an instrument drop / pick, and `modAdd`'s refusal of other kinds) reads **"The master takes effects (the rack's +)
and modulators (Sources ▸ Modulators)"**. A tile tap → `modAdd(id, null)` (the column slot), a drag → `modTileDrag` (the ghost, the
drop at the pointer) — today's calls (main.js:6170 [R]) with the refusal gone for the four kinds. The tray stays open on a drop (the
standing rule).

### 7.4 Monitors and the display data (MM5)
`mcMonitor(MASTER)` subscribes **`monitors.sub(MASTER, 'mods', { live: () => cvMaster && mcAny() && some body live, deliver: d => { if
(d.mc) mcSnap(MASTER, d.mc, d.mcx); } })`** — `wanted(MASTER)` already collects the subscriptions' `dev`s (main.js:3042–3045 [R]) → the
`{t:'mon', ids}` to MASTER carries `'mods'`; `deliver(MASTER, d)` routes **`d.t === 'smon' && d.mc` → the `'mods'` subs** (today every
`smon` → `'mfx'`, main.js:3064 [R]: the branch `k = d.t === 'mmon' ? 'meters' : d.mc ? 'mods' : 'mfx'`). **Both owners' `live` /
`mcMonSync` / `mcSnap` gate on `shownId()`** (P2-7: `modBodies` is keyed by the module key alone — `'l1'` — so a track's `smon mc`
arriving while a master body is mounted must find the track's sub not live, whatever the unmount order). `mcSnap` maps `pay.slots` →
the bodies as on a track (main.js:9451–9464 [R]): the LFO's phase dot / PATH playhead, the chaos meter, at ≈ 29 Hz. ROADMAP 23's work
(map-fps.md §5: D1 one frame clock, D4 (b) page-side interpolation / per-frame LFO computation from shape / rate / phase, D4 (c) the
opt-in fast lane `{t:'mon', ids, hz}`) applies to the master's bodies **through the same `mcSnap` / slot-host path** — this stage adds
no master-only display message, no master-only painter; MASTER's `watch` accepts and ignores `hz` until that stage reads it (§3.2).

### 7.5 CC on the master (P2-4; the lead's first guess, §10)
`modCC(ch, cc, v)` (main.js:9539–9565 [R]) feeds the CC modules of `targets(ch)` — tracks only (`midiTargets`, :2358). It **also scans
MREC's CC modules**: the master has no channel of its own, so a module with `ch` 0 (omni) takes every controller of that number, a
module with `ch` 1–16 that channel's; `modVal(MREC, id, 'out', v)` → `{t:'mval'}` to MASTER; `modCCLast` keyed `'master/' + id`; the body
updates while `cvMaster` (`mOwn() === MREC`). CC learn on the master (`modLearn` with `tid 'master'`): the next controller's number
lands in the module (one step "Learn CC"), as on a track.

### 7.6 Texts and refusals
The inspector's header budgets ("LFO 1/10 · ext 0/16") as on a track panel; the Mod list's title "Master"; `modRefusal` texts
unchanged; the undo notices "Added LFO 1 · tap to undo", "Modulate Reverb Mix with LFO 1"; `cvBadge('mfx')` "mods n" (a panel's, main.js
`modCount` [R]). Narrow widths: nothing new (the tray's existing folds).

---------------------------------------------------------------------------------------------------------------------------------

## 8. ROADMAP 23 — what this stage must not block, and does not
Row 23 (ROADMAP.md:44 [R]; map-fps.md): every animated part on one frame clock, LFO / envelope motion **computed per frame** from the
known shape / rate / phase with the worklet's posts only correcting drift, a small fast-lane post for the moving numbers, the big buffers
at ~29 Hz, default cap 120 fps. This stage: (a) keeps the `'mods'` id and the `{t:'smon', mc, mcx}` shape (MM5) so the master's bodies
are one more consumer of the same path, (b) adds no timer, no painter, no throttle constant (the master's bodies are the slot hosts,
painted by `mcSnap` as a track's), (c) leaves MASTER's monitor gate at `base · 0.033` (engine.js:5271 [R]) — a rate field is row 23's
to add to `Master.watch` as to `Track.watch`, (d) puts nothing in `master-ui.js` (the OUT's clock is row 23's). A master LFO's phase for
row 23's per-frame computation comes from the same payload (`pay.slots`, the module's `lfo` state) and the same `mcx.ph` corrections.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Gates

| gate | what | target |
|---|---|---|
| **G1 no master modulator = today (MM1)** | every golden file (13 golden-*.test.mjs) after every engine.js / fx-dsp.js edit; `master-proc` (ref-M's three hashes; the §6.2 cases incl. `modsJump()` inert on a rack without mods, no `mo` without a ModCore); `canvas-M-bounce` (ref-M's three bounce hashes through schema 17 — **phase 0: green**); `canonical-stream` (three parts, both fixtures untouched — **phase 0: green**); `ref-SC/live-p1.sha` (canvas-SC-sim — **phase 0: green**); engine-track's warm-up hash; `canvas-M-sim` G1 (the live copy); `tests/ref-MM/live-p1-mm.sha`: **recorded by the lead from the base (ba91775, the `REC=` pattern)** — a project-p1 live run's per-node outputs (MASTER's line included); the new build must reproduce it **after** a master-canvas session that adds and deletes an LFO without cabling it (impossible at the base: the payload posts `{off: true}` at most, MASTER's output byte-identical to the base's) | exact |
| **G2 one system (MM3)** | node (tests/master-mods.test.mjs, new): MASTER with a 5-unit rack and a payload (4 GLOBAL LFOs, chaos, a macro, 8 `fx` rows, `bpm` 140) vs a Track **built with `trackId: 'master'`** (the seed salt, P2-9) whose panel holds the same rack and the same rows (the same payload with `chain: 'fx1'`): **`MC.fxv` equal per span** over 10 s with a transport start and a seek **on 128-frame boundaries** (the two processors' start-split rules differ by one frame rounding, P2-9), and the rack's output ≡ a bare `FXRack` fed the recorded `setMods` sequence (+ `modsJump` at the start); `mval` moves a macro row's offset; `{off}` → `setMods(null)` once; `modsErr` on a bad CP; a wrap: `songBeat()` re-based at the first part after `le` (within one quantum of the Track's value); a start past `le` with loop on: no wrap (`tp.wrap` false, as the Track) | exact (fxv bit for bit); the wrap ≤ 128 frames |
| **G3 export = playback (MM2)** | node, **at 140 BPM**: the live MASTER (rows posted, ≥ 0.5 s of exact zeros, a quantum-aligned transport with `tick / fpt / loop`) ≡ the offline MASTER (`processorOptions.mods`, the pre-roll with ModCore, the snap at frame 0) **bit for bit** for the §6.1 rack and cables (BPM LFO anchored, chaos mono, macro, CC; rise / fall 0); the same with a FREE unsynced LFO added (exact, or the difference recorded: G3 decides); the same with one row at rise / fall 0.3 (measured: the first-second difference's level and its decay, recorded, not gated); **without `modsJump`** the first part's ramp difference is shown (the test documents why the snap exists); unaligned starts (F mod 128 ∈ {4, 60, 124}): measured, ≤ −80 dB (IMPL-M G2 (b)'s precedent); the pre-roll without `po.mods` ≡ today's (the ref-M `offline` hash) | exact / recorded |
| **G4 cost** | bench row `master-mods` (§6.3): (a) the row ≤ its targets (node 0.034, jsc 0.034, ipad 0.029 estimate), (b) the interleaved delta vs rack5 ≤ 0.004 node / jsc (0.006 ipad), the Low floor projection of the delta ≤ 3 %; no allocation per quantum with rows (the master-proc `noAlloc` pattern, the snap part included); the first quantum after MASTER's first payload on jsc **in the load order** (§3.3: MASTER, its payload, then a Track) ≤ 1 quantum, else the warm round is in and measured | within targets |
| **G5 host (sim: tests/canvas-MM-sim.test.mjs, new)** | an LFO tile tap / drag on the master canvas adds `project.master.mdev.l1` (GLOBAL) and its lay in the modulator column left of the rack (a drop on the rack lands in the column), one step "Add LFO 1" (undo removes it, `{off: true}` posted once); `project.master.fx` stays the detached default (no key, no chain post) until a rack edit; a cable drag from `l1.out` onto a master Filter cutoff writes `project.master.mods[0]` (`dst 'mfx:fx.<inst>.cutoff'`), one step, posts `{t:'mods', i: 'master', bpm}` to MASTER with one `fx` row (`chain 'mfx'`, the layout key); **[integration-time, P3-12]** the payload reaches MASTER's ModCore (`fxv['mfx']` non-zero after a span; the rack's `mdT` moves) — marked `todo` until lane E merges; a macro knob move posts `{t:'mval'}` to MASTER and no chain; **a CC module on the master learns and takes a controller whatever track is selected (omni; a channel set filters)**; **a tap on MONO on the master's LFO / Chaos changes nothing** (`lfo.mono` stays 1, no step); deleting the effect prunes the row with the notice; deleting the module drops its rows; an effect added under a running cable reposts the mods with the chain (one `go()`); the Mod list lists the row under "Master FX"; the inspector edits amount / bypass (one step each); undo of a track edit leaves `project.master` byte-identical; a master knob turn is no step; an undo whose snapshot predates the rack's first edit keeps the rack and removes the cable; `keepMaster` across Open / New; the bounce's `o.master.mods` = the live payload (+ `bpm`) and the offline MASTER's `processorOptions.mods`; an untouched master: no `mods` key in the options, `stream-master.json` holds; `mAlign` on; the `'mods'` monitor id posted to MASTER while an LFO body is live on the master canvas and dropped on leaving; `fxLive` lights the master rack's dot from `mo`; **the collision case (MM4)**: the selected track and the master both hold row `r1` — on the master canvas: cable-menu Bypass, Disconnect, the Delete key, the inspector's amount, Remove All Destinations, a module delete, a macro knob move, a CC → after each the track's JSON and every message to its node byte-identical; `masterOff` closes an open inspector; every track's JSON byte-identical through all of it | exact |
| **G6 UI (reviewer 2, Chrome for Testing — CLAUDE.md: never the browser pane for gates; 1440 × 900, 1366 × 1024 touch, 1024 × 1366 touch, dpr 2)** | the master canvas: the Modulators tiles (four, the note), a drop on the rack lands in the column left of it, the LFO's Serum panel with MONO disabled, the cable onto an FX-look knob ends at its rim (`[data-dest]` inside `[data-dev=mfx]`), the halo arc and the live dot on the master rack's knob, the long-press cable menu, the inspector, the Mod list, the badge "mods 1" and the LFO's GLOBAL badge, the touch drag with a two-finger cancel, a track canvas unchanged (its modulators, cables, halos as before: screenshots of canvas-2b-sim's scene byte-identical), the Sources tray leaving / entering the master, no console error; **a real bounce** of a project whose master has an LFO on a Filter cutoff: the file differs from the base's and its first 2 s against the live destination recording (the headless capture precedent of IMPL-SC G8) within the sum's 2-LSB class (IMPL-M §11) | pass |
| **G7 schema and files** | cv-migrate: 17, STEPS 17 (`STEPS[16]` the identity, the input untouched), "a newer file" 18; a 16 file with a master rack opens as 17 with the same rack (deep-equal) and the same bounce hashes (G1); a 17 file opens read-only in the base build; `toV1`'s lost lines (effects; modulators and cables); `normMaster` drops a foreign kind / forces GLOBAL / mono; the Proxy invariants (`Object.keys`, `in`, `delete`, `getOwnPropertyDescriptor`, `JSON.stringify(project)` Proxy-free) — **phase 0: green (tests/master-mods-model.test.mjs, canvas-M-sim)**; the schema pins moved (§9.3) | exact |

---------------------------------------------------------------------------------------------------------------------------------

## 9.0 Phase 0 — the lead (Fable 5.1): **the model commit — DONE** (its notes and hash in §12)
cv-migrate.js (`SCHEMA 17`, `STEPS[16]` the identity, the header line, the modulators' `lost` line), song.js (`normMaster` → `mdev` /
`mods` / `mid`, `MASTER_MOD_KINDS`, the mono forcing), main.js (**`MREC` + the Proxy `MDEV` + `mBox`**, `masterRec()` → the constant, the
owner helpers `mOwn / ownerById / ownerNode / shownId` — defined, reached by the hooks —, `keepMaster`'s delete condition, the
`__synthTest.master.mod` hooks; behaviour identical: `modAdd` still refuses on the master until lane H), the pins they move (§9.3),
tests/master-mods-model.test.mjs (new), canvas-M-sim's MREC test, `sw.js` (precache). Every test green, one file at a time (§12); every
frozen reference bit-identical by construction (no engine / DSP file touched) and by the run. **Not yet done by the lead**:
`tests/ref-MM/live-p1-mm.sha` from the base (G1) — recorded before lane H starts. Then the lanes, each in a worktree **reset to the
phase-0 commit**.

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **E** engine | 1 | `engine.js` (`class Master` only: §3 — the ModCore members, `tp` / the pend / `songBeat` / the wrap and end on `tp.play`, `modsMsg` / `modsOff` / `mval`, `watch` `'mods'` + the post gate + `postMon`'s `mc` and `mo`, the rack-path rule, the `c.t` bracket, `po.mods` + the pre-roll with ModCore, the snap flag, `start` / stop → `mc.transport`, the optional warm round), **`fx-dsp.js` (`FXRack.modsJump()` only, additive — golden-fx re-run)**, `tests/master-mods.test.mjs` (new: G2, G3), `tests/master-proc.test.mjs` (the §6.2 cases; its `mon` pin gains `'mods'`), `tests/bench-scenarios.mjs` + `tests/bench.json` (`master-mods` + targets, the interleaved delta); **not** mod-core.js, the Track | G1 (node part), G2, G3, G4 | **Fable 5.1** |
| **H** host | 1 (stubs: the sim needs only §3's message contract, which is the Track's; G5's engine-dependent asserts `todo` until E merges) | `main.js` (§4.2–§4.4, §7.1–§7.2, §7.4–§7.5: the mechanical rule over the section, `queuePatch`'s master branch, `postMods` on `mnode` with the re-check, the master's `bpm`, `go()`'s mods post, `masterEdit` → `fxPrune`, `applyRestore` / load posting, `masterMsg` `modsErr` + `smon mc`, `monitors.deliver`'s `'mods'`, the master host's cable members / mount routing / title / badge, `cvRenderMaster`'s drag, `renderMasterFx`'s `data-dev` on `rec.ui.el` + `fxLive`, `mMenu`'s mod branch, `modAdd`'s refusal narrowed to kinds ∉ `MASTER_MOD_KINDS`, `modSpot` / `modClear` on the master, the MONO guard, `modCC`'s master scan, `masterOff` closing the layer, `srcModeUI`'s `setMaster` calls (lane U's API), the bounce's `mods`, `renderOffline`'s conditional option, `__synthTest.master.mod` hooks extended), `tests/canvas-MM-sim.test.mjs` (new: G5), `tests/canvas-M-sim.test.mjs` (the refusal pin :400–401 moves; the §5.3 History cases) | G5, G1 (sim part: ref-MM), G7's host side | **Opus 5.5** |
| **U** tray + the MONO lock | 1 | `cv-tray.js` (`o.masterMods`, `o.masterNote`, `setMaster(on)`, §7.3), `style.css` (the `.cv-mside` rule narrowed in place; a block appended last for the master tray state), **`cv-mods-ui.js` + `sx-host.js` `slotHost` + `sx-ui-mod.js`** (the `lock: { mono: 1 }` option: the MONO switch disabled with its tooltip, the tap ignored — presentation only; a Serum's own panel unchanged without the option: its screenshot byte-identical), `tests/cv-tray.test.mjs` (the master state), `tests/serum-ui.test.mjs` or `tests/sx-ui-mod` (the option) | the tray's API with the fake DOM; the lock | **Sonnet** |
| reviewers × 2 | 2 | (1) **real engine** (Fable 5.1): MM1–MM5, G1–G4, the snap, the pre-roll, the wrap / end clock, JSC's first payload in the load order, a 100-track project with a modulated master (CPU, no throw), schema 17 round trips, History; (2) **Chrome for Testing** (Opus 5.5): G6, G7's read-only check in the base build, the FX-look halos, the iPad sizes, a power cycle and a sample-rate change keep the master's rows (re-posted with the chain) | — | Fable 5.1 / Opus 5.5 |
| fixers | after | the finding's files, failing test first | | Sonnet / Opus |

### 9.1 Interfaces (fixed here)
- **MASTER messages in**: `{t:'mods', i: 'master', cp, ct, rows, xfer, ext, vals, keep, **bpm**, key}` (the Track's payload + `bpm`; every row
  `dst.kind === 'fx'`, `dst.chain === 'mfx'`), `{t:'mods', i: 'master', off: true}`, `{t:'mval', k, v}`, `{t:'mon', ids ⊆ ['meters',
  'mfx', 'mods']}`, `{t:'transport', play, frame, seek, tick, fpt, loop, ls, le, end, fresh, wrap}` (the fields beyond `play / frame /
  seek` now read, into `tp.pend`). **Out**: `{t:'smon', mc: Float32Array(16), mcx: {ph: Float32Array(20), env: Float32Array(8)}}` (while
  `'mods'` and a ModCore), `{t:'smon', c:'mfx', gr, fxph, ftap, mo?}` (`mo` only with a ModCore), `{t:'modsErr', i: 'master', key}`.
  **Offline options**: `{ offline, transport, frames, fxr?, fxrT?, mods? }` — `mods` present only with a payload. Everything else of
  IMPL-M §12 lane D's list unchanged.
- **`Master` fields**: `mc`, `mcMon`, `trackId 'master'`, `wheel / at / bendRaw` (0), `tp` (`{ play, frame, tick, fpt, loop, ls, le, end,
  wrap, pend }`), `pF0`, the snap flag, `songBeat()`, `tickAt(F)`; `c.mcOn` on the master's `Chain`. **`FXRack.modsJump()`**: `md ← mdT`
  (globals and units), `eS / eD` recomputed; no other state touched; a no-op when every `md === mdT`.
- **The host**: `MREC` (§4.1: `id 'master'`, `dev` the Proxy, getters / setters `mods / mid / lay`), `mBox()`, `mOwn()`, `ownerById(id)`,
  `ownerNode(t)`, `shownId()`; `mnode.modsKey / modsAt / modsHold / modsT`; `queuePatch(MREC)`; `postTo({id: MASTER}, {t:'mval'})`;
  `monitors.sub(MASTER, 'mods', …)`; `cvMasterHost().cables / project / presetRows / mods / badge / title / bodies`; the rack root
  `rec.ui.el[data-dev="mfx"]`.
- **cv-tray**: `sourcesTray(o)` with `o.masterMods: ['lfo', 'macro', 'cc', 'chaos']` and `o.masterNote` → `tiles.setMaster(on)`.
- **The slot host**: `o.lock: { mono: 1 }` (cv-mods-ui `slotBody` → sx-host `slotHost` → sx-ui-mod's LFO panel / Chaos row).
- **Data**: §5.1; `song.MASTER_MOD_KINDS`; `cv-migrate.STEPS[16]`.
- **Hooks**: `__synthTest.master.mod = { rec, own, byId, node, shown, box }` (phase 0) + lane H's `{ pay: () => modsPay(MREC), post: () =>
  postMods(MREC, mnode) }`; `__synthTest.cv.mod` unchanged (its functions take the owner).

### 9.2 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time with
`--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`); builders in worktrees reset to the
phase-0 commit (`git reset --hard <phase-0>`; the harness creates worktrees from `main`); every engine.js / fx-dsp.js edit re-runs every
golden file and master-proc (bit-identical) before the lane's notes commit; browser gates with Chrome for Testing only (CLAUDE.md),
downloads blocked; no iPad app build or install in this stage.

### 9.3 Pins that change by design
**Moved in phase 0** (green): tests/cv-migrate.test.mjs:32 (16 → 17 + the MM sentence) and its six stage blocks ("through …" lists gain
17, the read-only arrays 18, `newer` 17, "a newer file" 18); canvas-8-sim:405 / :417–418, canvas-9-sim:436 / :446–447, canvas-M-sim:337–352
(16 → 17; the read-only file 18), canvas-7c-sim:643 / :655 and canvas-9b-sim:438 (16 → 17, found by the sweep; canvas-7b / WC derive). **Moves in lane H**: canvas-M-sim:400–401 (the refusal: `cv.mod.add('lfo',
null)` now adds; the notice text). **Lane E**: master-proc.test.mjs:385 (the `mon` ids list gains `'mods'`: a structural assert, not a
cadence change). **Not changed**: ref-M (both files), canonical-stream's three fixtures, every golden, the DSP lists (no new file),
app.test's module count, bench.json's existing rows, `tests/ref-SC`, canvas-M-sim's twelve `master.fx` reads (the additive design).

### 9.4 Docs (the lead, at the end)
ROADMAP row 22 (done + the user's answers), row 13's "Known limits … no modulation of master knobs" struck; HANDOVER (§4: `MREC`, schema
17, MASTER's ModCore, `modsJump`; §5: the lessons — a canvas record that pure modules write into must forward to the project's object,
not copy it; a modulated rack's first call after ▶ ramps from history unless snapped); IMPL-M §1.2 / §2.2 / §5.2 / §11 lines updated ("No
ModCore" → "a ModCore since MM"); IMPL-SC §4.4 / §11 unchanged (the Ducker / key facts stand); SPEC-canvas (the master canvas: modulators
on it); main.js comments :6829 / :6892; `tests/ref-MM/` frozen at acceptance (`live-p1-mm.sha` from the base; `master-mods-out.json`:
MASTER's output for G2 / G3's program, the moog-b `{note, commit}` way, `GOLDEN_FREEZE_MM=1`).

---------------------------------------------------------------------------------------------------------------------------------

## 10. Questions for the user — answered by the lead's first guess (2026-10-27, the user asleep); **the user confirms in the morning**
- **Q1 Envelopes on the master?** The master plays no notes, so an envelope there has nothing to start it. **Taken: (a) no envelope for
  now** — LFOs, Macros, CC and Chaos (everything that moves on its own or by hand). Worth knowing (the skeptic's point): an LFO in
  **ENV (one-shot) mode** on the master already restarts at ▶ and runs once — a "song envelope" without a new kind. The alternative (b),
  an envelope that rises at ▶ and falls at ■, stays a small switch in this design if you miss it.
- **Q2 The Mod Wheel on the master?** Today the one project Mod Wheel modulates knobs on every track and its moves are recorded per
  track. **Taken: (a) not on the master for now** (a master knob would follow the live wheel only, never a recorded lane: confusing).
  A **CC module on CC 1 is the hardware mod wheel** anyway — so a master CC module gives you the wheel on the master today.
- **Q3 CC on the master.** **Taken: a hardware knob drives a master CC module whatever track is selected** (any channel when the module
  says omni; its channel otherwise). The alternative: leave CC off the master (the request was "lfos").
- (Settled, not asked: which knobs — every knob of the master rack, not Volume / Mono / A/B (listening controls stay out of exports);
  where — the master canvas only; the look — the same Serum-style modulator panels, cables and halos as on a track.)
- **For the user's OK, not this stage (§11, §12)**: on **tracks**, a BPM-synced canvas LFO follows the tempo while playing only with
  ANCHOR on; with ANCHOR off, and whenever the song is stopped, it runs at 120 BPM whatever the project's tempo (the payload carries no
  tempo; measured). Fixing it changes how such tracks sound at tempos other than 120 — do you want it fixed (the master gets it right
  from day one)?

## 11. Known limits (recorded)
- **No notes on the master**: no ENV / Velocity / Aftertouch / Bend / Note / PER NOTE sources (Q1 (b) adds a transport-gated ENV);
  LFO GLOBAL and Chaos mono forced (the MONO switch locked; a file saying otherwise reads GLOBAL / mono); `MC.noteOn / noteOff` never
  called.
- **The listening controls are not targets** (Volume, Mono, A/B: IMPL-M M2) nor the Ducker's source / NOTE or the compressor's KEY.
- **The master's modulators modulate the master only**; a track's modulators stay on their track (a cross-node value path — a track's
  LFO on a master knob, a master LFO on a track knob — is a later idea, as IMPL-SC §11's "Trigger" modulator).
- **One ModCore per MASTER**: a track's slot budgets (10 LFOs, 2 chaos, 8 macros + 16 value sources, 48 synthetic rows, 64 rows in the
  Mod list); over them the inspector says so ("ModCore slots full", 2b's texts).
- **The loop wrap / the song end re-base the master's clock at the first part boundary after them** (≤ one quantum, ≤ 2.7 ms at
  48 kHz; the tracks split spans at the wrap frame): a BPM-anchored master LFO re-anchors that much later than a track's — the same live
  and bounced (MM2 holds); audibly nothing.
- **A slewed row** (rise / fall > 0) on the master glides from its pre-▶ value for SLEW_T after ▶: live and bounce differ there (the
  pseudo-voice's slews are not reset by `transport`; the tracks' class) — measured, recorded (G3).
- **A moving master modulator on a stepped topology knob** — the Phaser's POLES, the Reverb's TYPE — is not bit-identical live vs
  bounce for a moment after ▶ (tests/master-mods-snap, recorded and held to < 1 s: POLES under a FREE Hz LFO −11.1 dB re peak,
  0.008–0.77 s; under the BPM-anchored LFO −90.7 dB; under a chaos −117 dB; TYPE under a FREE Hz LFO −45.8 dB, 0.008–0.04 s, under the
  others exact): the unit's dormant structures — the Phaser's coefficient slots above the running pole count, the tank a TYPE change
  installs (its glides, the pre-delay's intro fade) — keep the pre-▶ trajectory, which the snap does not reach (§12, the fixer's notes:
  the causes and two candidate fixes; the lead decides). **Every other knob** of every effect type (13 types, 444 knob × source cases:
  a FREE Hz LFO, a BPM-anchored LFO, a mono chaos) **is exact**: the "smoothed-knob class" lane E measured (mix / level / width / pan /
  delay time / pre-delay — rev.pre −21.3 dB, dly.timeL −20.7 dB, bode.delay −1.7 dB on 8eb271c) is gone — `FXRack.modsJump()`'s
  unit-side snap (reviewer 1's P1).
- **The track side's tempo gap** (§0, measured §12): a track's BPM-synced canvas LFO with ANCHOR off, or any BPM-synced one while the
  song is stopped, runs at 120 BPM (the payload carries no `bpm`, ModCore's default). The master's payload carries `bpm` and has no such
  gap. **Not fixed here — needs the user's OK** (it changes track sound at tempos ≠ 120; a failing-test-first task: `bpm` in every
  payload, or derived from `tp`; golden-graph decides what moves).
- **A CC module's last live value is not in a bounce** unless written to the module (2b: `modCC` writes the meter, not the record); the
  master inherits it.
- **The Pads' mod pads and the Mod Wheel are not master sources** (no Pads module on the master canvas; Q2).
- **The master's ModCore adds to the engine total** (the safeguard's notice names the master when its share is the largest, IMPL-M
  §2.1); no lever lowers it (a heavy master is the user's call).
- **A master cable is a History step; a master knob turn is not** (the tracks' policy: `keepMaster` keeps the rack, the snapshot
  restores the cables) — a restored cable may dangle against the kept rack (an effect removed without a step): filtered at compile,
  pruned at the next rack edit (the tracks' class).
- **The iPad app is not rebuilt** for this stage (browser first); its node tests run in the sweep.

## 12. Notes (the builders fill in)

### Phase 0 — the model commit (the lead, Fable 5.1, 2026-10-27; base ba91775; the contract f62a42a, amended in the commit before this one)
- **Built, data and the record only — no behaviour change**: `cv-migrate.js` SCHEMA 17, `STEPS[16]` the identity (a copy with the
  number), the header's 17 line, `toV1`'s second lost line ("the master modulators (n modules, m cables)"); `song.js` `normMaster` →
  `{ fx?, mdev?, mods?, mid?, lay? }` through `normMasterDev` (prefix × kind, `MASTER_MOD_KINDS` exported, `lfo.mono` / `chaos.mono`
  forced 1 — `normLfoMod({})`'s own default is `mono: 0`, PER NOTE, so the forcing is load-bearing), `normMods`, `mid` as `normDev`'s
  rule; `main.js` `MREC` (one constant; `MDEV` the Proxy over an empty target: `get / has / set / deleteProperty / ownKeys /
  getOwnPropertyDescriptor`, `'mfx'` / `'out'` constants, the rest `project.master.mdev`; a `set` on `'mfx'` / `'out'` returns true and
  does nothing — a strict-mode caller never throws), `mBox()` (the project record made on a write only), `masterRec()` → `MREC`, the
  owner helpers `mOwn / ownerById / ownerNode / shownId` (reached by `__synthTest.master.mod`), `keepMaster`'s delete condition (`!lay &&
  !mdev && !mods`); `sw.js` precache rebuilt (BUILD 0917adc2fb33). Every `master.fx` reader untouched (the additive design).
- **Tests**: `tests/master-mods-model.test.mjs` (new, pure: the identity step, a 16 → 17 round trip byte for byte, an 18 read-only,
  `normMaster`'s accept / drop / force table, `deserialize`'s whitelist, `toV1`'s lines); `tests/canvas-M-sim.test.mjs` + 1 (the MREC
  contract: the constant, the Proxy's keys / `in` / descriptors / writes landing in `mdev` with the rack kept detached and no key for it,
  `mods / mid / lay` forwarding, `JSON.stringify(project)` Proxy-free, `devicesOf` / `tidy` on it — the modulator column left of the
  rack —, the owner helpers on and off the master canvas, the constant surviving a project swap, no track written). **Pins moved**: §9.3's
  phase-0 list (cv-migrate ×7 blocks incl. the WC block's `[15, false, 17, …]` and :1701's "newer" 18; canvas-8 / 9 / M-sim).
- **Measured (the skeptic's P2-8, the lead's script `scratchpad/MM/bpm-check.mjs`)**: a Juno-60 into a panel on a TRACK, a GLOBAL
  BPM-synced 1/4 canvas LFO on the panel's reverb mix, 6 s, the period from `MC.live[0]`'s peaks — **140 BPM, ANCHOR on, playing:
  0.4285 s** (a quarter note at 140 — correct: the anchored closed form follows `songBeat()` per span); **140 BPM, ANCHOR off, playing:
  0.4999 s**; **140 BPM, stopped (either anchor): 0.4999 s** (= 120 BPM's quarter); 120 BPM: 0.4999 s. `pay.bpm` undefined, `MC.shim.bpm`
  120, `sx.mod.bpm` 120 throughout. So the gap is real for ANCHOR-off and stopped LFOs on tracks — the master's payload carries `bpm`
  (§4.2); the track side waits for the user's OK (§10, §11). No test file was committed failing: the finding is this note.
- **Sweep**: every test file, one at a time (`scratchpad/MM/sweep-all.sh`, 2 GB each): **149 files green** — 147 in the first pass
  (1 418 s), the two that failed on a schema pin the draft's grep had missed (canvas-7c-sim:643 / :655 — `[16, 16]` and the schema-9
  store's `newer` —, canvas-9b-sim:438) moved 16 → 17 and re-run green (13 / 13, 14 / 14). The goldens are untouched by construction (no
  engine / DSP file in the diff) and were run; canonical-stream, canvas-M-bounce, canvas-SC-sim (ref-SC), engine-track, master-proc,
  pwa (the new BUILD) and lint green.

### Lane U — the master's Sources tray and the MONO lock (Sonnet 5.5, 2026-10-27; base 54828a3)
- **cv-tray.js**: `sourcesTray(el, o)` gains **`setMaster(on)`** / **`master()`**, `o.masterMods` (ids; default the exported `MASTER_MODS` = `lfo, macro,
  cc, chaos`) and `o.masterNote` (default `MASTER_NOTE`, §7.3's sentence word for word); new exports `MASTER_MODS`, `MASTER_NOTE`, `MASTER_SRC`. On: the
  view host (`o.layoutEl`, else `o.viewBtn`) hides and an open view menu closes; `setView` reads `master` and sees **no sections** (so every model / set
  / Moog / rig-part tile and section and the Controllers row hide through the code that hides them today); the Modulators section shows only the
  tiles in the list, in `MOD_TILES`' order, with the note `p.cv-tnote.cv-mnote` under them; `o.tray` gets `cv-mside`, the list `data-master="1"`,
  `o.noteEl` is cleared. Off: `setView(view)` again — **the view the user chose is kept underneath** (a `setView` while on records it; leaving shows it).
  `destroy` gives the host / class / attribute back. **The note is made at the first visit to the master canvas** (not at construction): the other
  canvases' tray is node for node as before, so tests/cv-tray.test.mjs's flat-list pins (2a / 8: `list.children`) did **not** move.
- **MASTER_SRC (lane H owns main.js)**: the exact string is exported as `cvTray.MASTER_SRC` =
  `The master takes effects (the rack’s +) and modulators (Sources ▸ Modulators)` (curly apostrophe, as the codebase's `’`). main.js can set
  `const MASTER_SRC = cvTray.MASTER_SRC` or copy it. **tests/canvas-M-sim.test.mjs:402** pins `/^The master takes effects — add them with the rack’s \+/`:
  it moves with the text (lane H's file; canvas-WC-sim:586's `/master takes effects/` still matches).
- **API lane H calls**: `shell.tiles.setMaster(cvMaster && mode !== 'track')` in `srcModeUI` (before / instead of the early return: keep writing
  `MASTER_SRC` into `#srcMode`; the `cv-mside` toggle there is now redundant — `setMaster` does it — but harmless); `setMaster(false)` when the master
  canvas is left is the same call with `false`. `modPick: id => modAdd(id, null)` / `modDrag: modTileDrag` are today's, unchanged.
- **style.css**: the rule is now `#srcTray.cv-mside #srcLayout, #srcTray.cv-mside #srcNote { display: none; }` **in place**; `.cv-mnote` (the
  placeholder notes' look) + `.cv-mnote[hidden]` follow it. **Deviation**: the contract (§9.0's lane table) says "a block appended last"; the skins
  must stay the last rules of the file (a pinned invariant: cv-tray.test.mjs "the skin blocks are the last rules of the file"), so the block sits
  beside the rule. The stage-M comment above it says what the tray shows now.
- **The MONO lock**: `cv-mods-ui.slotBody(kind, { …, lock: { mono: 1 } })` → `sx-host.slotHost(kind, { lock })` → the SerumHost option `monoLock: 1`
  (only when `lock.mono` is truthy; **`HOST_OPTS` is unchanged** — a Serum's own host has no such key) → sx-ui-mod's `LfoPanel` `sw('MONO', …)` and
  `ChaosRow.row`'s MONO: `get` → 1 (lit whatever the device says), `disabled` → true (`wk-dis`, `aria-disabled`; the look is the kit's: 0.4 opacity,
  default cursor), `set` ignored, `title` = the exported **`MONO_LOCK_TIP`** = "The master’s modulators are global (it has no notes)" (our words;
  §7.2's draft "GLOBAL on the master (it has no notes)" and the brief's example, merged). The unlocked path is the same calls with the same options
  (`disabled: dis` / `undefined`): the panel is node for node as before (pinned by shape in sx-host.test.mjs, for `undefined / null / {} / { mono: 0 }`).
  **Lane H must pass `lock: { mono: 1 }` in `modMount`'s body options when the owner is MREC** (the master) — nothing else reaches the slot host.
  The lock is a presentation: a Paste / Init Module from the module menu can still write `mono: 0` into `o.edit` — lane H's forcing guard
  (`modEditState` / `modLive`) catches it; I did not coerce in the slot host (the brief: presentation only).
- **Tests** (red first, then green): tests/cv-tray.test.mjs +9 (constants; setMaster on from every view; off restores every view exactly; setView while
  on; tap / drag of the master's tiles; `o.masterMods` / `o.masterNote`; open view menu closes, no `o.mods`, destroy; the flat list; the CSS rule and
  the HTML heading), tests/sx-host.test.mjs +2 (the lock on LFO and Chaos; no lock = unchanged, the lock changes the MONO switch alone, ENV / Macro
  ignore it, `HOST_OPTS` untouched), tests/cv-mods-ui.test.mjs +1 (the body forwards `lock`; proven red by removing the forward). **No pin moved.**
- **Gates** (each file alone, 2 GB): cv-tray 56/56, cv-mods-ui 13/13, sx-host 24/24, serum-ui 62/62, lint 171/171, pwa 25/25 (after `precache --write`;
  **sw.js not committed**, §9.2 — the lead's), plus canvas-M / 2b / 3 / WC / sim, m3-fixture, cv-shell-sim, app, main, app-shell, app-native green.
- **Browser** (Chrome for Testing 156, downloads denied, own profile; a harness page with index.html's real tray markup + style.css + the real
  cv-tray / cv-mods-ui, 1440 × 900, 1366 × 1024 and 1024 × 1366 at dpr 2, touch on the iPads; scripts in the lane's scratchpad, not committed):
  master: `#srcLayout` and `#srcNote` `display: none`, `#srcScroll` shown, the four tiles (106 × 77 px) and the note (11 px, inside the scroller),
  no other section; leaving: ten tiles, the view menu back, no `cv-mside`; a track's MONO enabled, the master's LFO / Chaos MONO lit, dimmed, a click
  = no call; no console message. Not checked here (needs lane H's wiring, G6): the tray inside the real app, a drop on the canvas.

### Notes — lane H (Opus 5.5, 2026-10-27; base 54828a3, fast-forwarded to d256589 = lane U merged, so the tray / the lock are wired against the real API)
- **The owner indirection, applied by the rule** over the cv MODULATION section (§7.1): `trk()` → `mOwn()` in `modMount`, `modLive`, `modRowsFrom`
  / `modRowsOps`, `modEditState`, `modLearn`, `modAdd`, `modDelete`, `modLabel`'s default, `modCan`, `modMarks`, `modConnect`, `modSrcPick`, `modDests`,
  `modJackTap`, `modCableSel` / `modCableMenu` (the stub paths: harmless on the master), `modBypass`, `modCableAct`, `modStep`, `modEdit`, `modRemove`,
  `modToPreset` / `modFromPreset` / `modSources` / `modHidden` (Serum-only: with MREC they return as for a track without a Serum — safer than reading
  the selected track's row of the same id), `modDescs`, every `modHostO` member (`rowsOf / presetRows / budget / connect`), `modList`, `cvModReload`'s
  `t === mOwn()`, `cvBadge`, `sxSettle` (a master modulator settles in its column: `sxFresh` 'master\n' + key, `cvRenderMaster` calls
  `sxSettleSoon`); a track by id → `ownerById` in `modMount`'s `get` and its macro `o.set` (**the body's owner by tid, not the canvas shown**),
  `modCancel`, `mcMonitor`, `mcSnap`, `sxInjLive` / `sxInjSnap`, `modCC`'s learn, `fxLive`, `cpSnap`; `nodes.get` → `ownerNode` in `modLive`,
  `modLiveEnd`, `postMods`' throttle re-check (`ownerNode(tr) === N && (tr === MREC || project.tracks.includes(tr))`); `selTrack ===` → `shownId()` in
  `mcMonitor` / `mcMonSync` / `mcSnap`, `sxInjLive` / `sxInjSnap`, `cpMonitor`'s `live`. `modRowsOps(key, tid)` takes the body's owner id (the
  slot host's ⋯ Bypass / Remove All Destinations act on the body's record; the hook `cv.parts.rowsOps(key)` keeps the shown one).
  **Left alone, with the reason**: the wheel's paths (`modValue`'s perf kinds, `modOthers`, `modJumpItems`, `modJump`, `cvModPlay`, the wheel branch
  of `modDelete`: the project wheel is never on the master), the Pads' (`padsAdd`, `padsNewF`, `padsDelete`, the Pads body's `track`: not on the
  master — `modAdd('pads')` is refused there before `padsAdd`), `cvModDecor` (the track tray's singleton greying; the master's tiles are lane U's),
  `cvDevices` (the master host has its own `devices`), the 900 Series / rig paths (no instrument on the master), the roll / keyboard / `bind`.
- **`cvTitle(key, t0)` / `cvDevName(t, key)`**: `cvDevName` passes its record to `cvTitle` (before, `cvTitle` read `trk()` whatever record was named
  — the same answer whenever `t` was the selected track, the only callers' case); `cvTitle` on MREC answers `mTitle(key)` (the master host's
  `title`: "Master FX", "Master OUT", a modulator "LFO 1" over "Master"). So `addMod`'s `name`, `modList`'s label, the refusal texts read right.
- **The payload**: `buildMods(MREC)` = the compile (its memo, MREC constant) + **`bpm`** on a copy (`mPayOf`: one per compiled payload and tempo —
  the memo's object is never written; `vals` shared, so `refreshVals` reaches it) **and the tempo in the key** (`key + '@' + bpm`): `compileMods`'
  signature hashes the tempo but its key does not always move with it (a CP without a BPM-dependent field), and ModCore reads `m.bpm` for
  every BPM rate and the in-span beat step — so a tempo change must repost. **Posting**: `queuePatch(MREC)`'s frame → `mModsSend()` (`postMods(MREC,
  mnode)` unless the chain waits for assets); `masterSend`'s `go()` posts the chain (when it changed) **then** `postMods(MREC, M)` every time (a
  tempo / `smooth` change through `queueAll` / `prefsChanged` lands there too); its "no rack, nothing posted" early return calls `postMods` as well
  (an off at most; N1: never posted when nothing was). `masterSync` (power-on), `applyRestore` (undo / Open / New) reach it through `masterSend`.
  `masterEdit` → `fxPrune(MREC, 'mfx')` before `masterSend` (the notice "n modulation cables removed with the effect"). `masterMsg`: `modsErr` →
  `M.modsKey = undefined` + a warning naming the master; `smon` → `monitors.deliver(MASTER, d)`, which routes `d.mc` → the `'mods'` subscriptions.
  Bounce: `o.master.mods = modsFor(MREC)`; `renderOffline` adds `processorOptions.mods` only when non-null (an untouched master's options as
  before: G5 pins `frames,offline,transport`).
- **The master canvas**: `cvMasterHost()` + `project`, `presetRows: false`, `mods` (the ∿ mode), `cables` (no cords: `dashedSet: () => new Set()` —
  GLOBAL only), `title: mTitle`, `badge: key => key === 'out' ? null : cvBadge(key)` ("mods n" on the rack, GLOBAL on an LFO); `cvRenderMaster`
  makes `modDrag = cvView.cableDrag(modDragOpts)`; `modDragOpts.canConnect / onConnect` refuse on the master (`RC.WORDS.notPatchable`: its one
  audio wire stays read-only); `mMount` / `mUnmount` route a modulator key to `modMount` / `modUnmount`; `renderMasterFx` sets **`data-dev="mfx"` on
  `rec.ui.el`**, paints `fxHalos(MREC, 'mfx')` at build and on refresh, and its monitor's `deliver` calls `fxLive(MASTER, 'mfx', rec, d)` (`mo`);
  `fxHalos` reads `mfxRec` for the master (no `trackId`); `mMenu`'s modulator branch = `cvMenu`'s (Delete, Modulation list…, Fold, Bring to front,
  Tidy); `masterOff` closes the mod layer. **The canvas Delete key** on the master (beyond §7, small): a selection holding a modulator deletes it
  through its ⋯ Delete (one step, `cvDeleteSel` with `mOwn()`), the rack and the OUT stay ("the master FX / the master OUT stay"); a selection of
  the rack / OUT alone keeps today's notice (canvas-del-sim's pin unchanged).
- **`modAdd`** refuses on the master every kind ∉ `song.MASTER_MOD_KINDS` with **`MASTER_SRC` = `cvTray.MASTER_SRC`** (lane U's export, §7.3's
  text — I took §7.3's "MASTER_SRC is modAdd's refusal of other kinds" over §7.1's "the §7.3 note"); placement: `modSpot` adds no wheel height on
  MREC, `modClear` shifts left past `'mfx'`; the undo notice's alternative re-opens the master canvas (`masterOpen`) instead of `selectTrack`.
  `cvAfter(MREC)`: `queuePatch(MREC)`, no `bind` / `renderNav` / `renderHeads`.
- **The tray**: `srcModeUI` calls `shell.tiles.setMaster(cvMaster && mode !== 'track')` every time (on and off) and still writes `MASTER_SRC` into
  `#srcMode` on the master (the old `cv-mside` toggle kept: redundant, harmless); `sourcesTray` gets `masterMods: song.MASTER_MOD_KINDS` (the data
  model's list — the tray's default is the same four) and lane U's default note.
- **The MONO lock (guard)**: `monoLock(t, key, fields)` — on MREC, an edit's `lfo` / `chaos` object keeps `mono: 1` — in `modEditState` (every
  `o.edit`: the switch, a Paste / Init Module from the panel's menu, the hooks) and `modLive`; after a forced edit `modEditState` calls the body's
  `sync()` (the switch lit again); `modStep`'s prune leaves no step for a no-op. `modMount` passes `lock: { mono: 1 }` for the master's LFO / Chaos.
- **CC on the master** (§7.5): after the track loop, `modCC` scans `project.master.mdev`'s CC modules (`d.cc === cc && (!d.ch || d.ch === ch)`) →
  `modVal(MREC, …)` → `{t: 'mval'}` to MASTER, `modCCLast` 'master/<id>', the meter while `mOwn() === MREC`; the track loop's meter test is now
  `t === mOwn()` (on the master canvas a track's CC never moves the master's same-key body). Learn on the master: `modLearnKey.tid` 'master'.
- **Tests** (red first: on the phase-0 main.js 16 of 18 fail, the live file fails; green with lane H): `tests/canvas-MM-sim.test.mjs` (new, G5: 19
  tests, 1 `todo` — MASTER's ModCore receiving the payload: lane E's, integration time; the rest: the refusals and the tray state, the tap / the drop
  on the rack (the column), the cable (one fx row, chain `mfx`, the layout key, `bpm`, a tempo change reposting), the badges / title / `data-dev` /
  the halo paint, `mval`, CC learn / omni / channel / another track selected, the MONO tap and the hook edit, the Mod list / inspector / cable menu,
  the effect prune, the module delete (off once), the effect added under a cable (`chain`, `mods` in one go()), History (a track's undo, a knob
  turn, the rack kept across an older snapshot), New / Open / their undos, a power cycle (`chain`, `mods`), `modsErr`, the bounce's options (and
  none for an untouched master), `mAlign`, the `'mods'` monitor id and MASTER's `smon mc` / `mo`, the collision, `masterOff`, the canvas Delete key); `tests/canvas-MM-live.test.mjs` (new, **G1 sim part**: project-p1's live run after a master session that adds,
  edits and deletes LFOs without cabling them ≡ `tests/ref-SC/live-p1.sha` node for node — **deviation**: §9.0 / §9.4 want a new frozen
  `tests/ref-MM/live-p1-mm.sha` recorded from ba91775; ref-SC's file is the same scene's frozen record (a87b915) that every build since reproduces —
  the base included — so it is the reference and no new frozen file is needed; the lead may still freeze one at acceptance). **Pin moved by design**:
  canvas-M-sim:401–402 (the master's refusal: `cv.mod.add('lfo')` now adds — the pin asks `'env'`; the notice text is lane U's MASTER_SRC).
- **Gates** (each file alone, 2 GB): canvas-MM-sim 18 + 1 todo, canvas-MM-live 1/1, canvas-M-sim 21/21, canvas-2b 23, canvas-3 25, canvas-8 17,
  canvas-WC 51, canvas-sim 24, canvas-1e 24, -1i 20, -2a 26, -7a 23, -7b 15, -7c 13, -9 22, -9b 14, -9c 3, -P 8, -R 28, -SC 15, canvas-SC-live 1
  (ref-SC), -del 11, -tab 8, main 47, canonical-stream 1 (its three parts), canvas-M-bounce 1 (ref-M's bounce hashes), lint 171, pwa 25 (after
  `node tools/precache.mjs --write`: BUILD 39325cd68f53 — sw.js committed with the code, lane U's tree included: the coordinator's ask), cv-tray 56,
  cv-mods-ui 13, sx-host 24, accessors 30, master-mods-model 4 — all green. No engine / DSP file touched (no golden to re-run by construction).
- **Browser** (Chrome for Testing 156, headless, a fresh browser context per size, downloads denied by `Browser.setDownloadBehavior`; the worktree
  served by a scratchpad server, `window.__synthTest = {}` pre-set for the hooks; scripts in the lane's scratchpad, not committed): 1440 × 900 (mouse),
  1366 × 1024 and 1024 × 1366 (touch, dpr 2): power on, the master canvas, a Reverb on the master rack, an LFO, **a real drag** of `l1.out` onto
  `[data-dev="mfx"] [data-dest="fx.rev.mix"]` (mouse on the desktop, touch on 1366 × 1024; on 1024 × 1366 the knob sat off the script's frame and the
  hook made the row) → `r1:l1.out>mfx:fx.rev.mix`, the cable on the view, the payload posted (`…@120`), MASTER's monitor ids `meters,mfx,mods`, the
  badges "mods 1" / "GLOBAL", the title "LFO 1 · Master", the halo arc on MIX with the "+25 %" badge, the LFO panel's MONO lit + disabled with lane
  U's tip; the cable's look on the master rack is a track panel's (screenshotted side by side: under the FX-look module, out at the knob's
  badge); the Sources tray on the master: the four tiles, the note, the `#srcMode` line, a tap on LFO adds `l1`; leaving: twelve tiles, `master()`
  false; a track's canvas after it: its own LFO cabled to the Minimoog's cutoff as before (its MONO enabled); **no console error or warning**. No live
  dot yet (it needs lane E's `mo`).

### Notes — UI fixer (Opus 5.5, 2026-10-27; worktree reset to 8eb271c; review MM-2's UI findings, failing tests first in their own commit)
- **P1-1, a badge over another control** (inherited from 2b U1; it hit every master target: the FX look packs knobs in rows, so a badge 24 px left
  of its knob lies on the NEXT one): cv-cables' badge `knob(e)` hands the press and the contextmenu over **only when the control beneath is the
  cable's own destination** — the topmost non-badge element's `[data-dest]` under its `[data-dev]` (else the module's `data-cv-mod` device:
  createCableDrag `devAt`'s rule, `devUp`) equals the cable's b end. Over any other control the badge keeps both: a tap selects (again: the
  inspector), a right-click / a touch long-press the cable's menu (Disconnect / Edit… / Bypass). Tracks get it too (the same code). Its own knob
  beneath (a classic panel zoomed in: the badge on the knob's face) still takes the press and the menu (2b U1 kept: checked in Chrome at k 2.2 on
  a Minimoog's cutoff — the knob's menu, a drag on the badge turned it 5 → 7.7). cv-cables' (U2, U4) / (2b fixer C, U1) fixtures: the knob beneath
  is now the cable's own (`i2:a.semi` under `data-dev="i2"`; it was `a.pan`, a different control — the very case that now keeps the press);
  their assertions unchanged; the new test pins a neighbour by `data-dev`, by `data-cv-mod` and the same parameter on another device.
- **P3-5, the badge's touch target, measured**: 38–39 × 18 px drawn, **38–39 × 44** to a finger (its `::before`, 44 screen px tall — a press
  20 px above / below its centre lands on it in Chrome). Not widened: style.css's U2 rule (the hit area never wider than the badge — pinned by
  cv-cables' U2 test) keeps the knobs beside it theirs, and with P1-1 a wider badge would now take more of its neighbour's presses.
- **P2-1, master halos on ↶ / ↷**: `cvRenderMaster`'s same-view branch paints `fxHalos(MREC, 'mfx')` (renderFxTab's line for a track). Chrome:
  undo of the last "Modulate … with LFO 1" → that knob's arc off (`modded` false), redo → back, at all three sizes (canvas-MM-sim also pins a
  Disconnect's undo bringing the arc back).
- **P2-2, the LFO "into the master's input"**: the master host's `devices` marks the rack's entry `noIn: true` and cv-module's `jacksOf` gives such
  an 'fx' entry no left `in` jack (its OUT alone; createTrackView's doc says so) — nothing is ever patched into the master rack, so no socket is
  left for a modulator's cable to look plugged into. The cables still pass under the rack from its left edge and come out at their badges — a
  track panel's rule (the reviewer's option (a)); options (b) / (c) (the column below that height, a ghost over the rack) not taken.
- **P2-3, a drop moved off the rack lands off screen**: `modAdd` (and `padsAdd`, tracks too) call `modShow` for a tap **or a drop `modClear`
  moved** (`at2` ≠ the dotted drop point): the camera brings it in at its zoom when it is outside the band. Chrome: a CC dropped on the rack at
  45 % moved the camera (tx 700 → 930) with the module in view; a drop already in view moves nothing (modShow's rule).
- **P3-1**: `modHostO.budget` drops `env` from the slots on MREC (a copy): the inspector header and the Mod list read "LFO 1/10 · ext 0/16"; a
  track's keep ENV. The title has its room back: "LFO 1 → Filter Cutoff" whole at 1440 × 900 and both iPad sizes (no CSS change needed).
- **P3-2**: sx-ui-mod's locked MONO (LFO, Chaos) says `MONO_LOCK_TIP` through the kit's `notify` on a tap (a click not eaten by a long-press's menu)
  — the master's notice "The master’s modulators are global (it has no notes)"; still no edit, no step.
- **P3-3**: `srcModeUI` hides `#srcMode` on the master (empty, `hidden`) — the note under the tiles says it once; `MASTER_SRC` stays the refusals'
  text (lane H's note above: "still writes MASTER_SRC into #srcMode" — no longer).
- **P3-4, the edge pan during a cable drag — it exists** (cv-cables `move` → `world.dragPointer`, wk `edgePan2`): a mouse pans only *past* the
  visible band's edge (over the keyboard tray: ty 40 → −2284 in 1.5 s), a finger inside its edge zone (1366 × 1024: ty 40 → −1791). The
  review's drag stopped inside the band, where a mouse never pans. Nothing to record in §11.
- **Tests** (red first, commit 181d964): cv-cables (the neighbour keeps the press), cv-module (`noIn`), sx-host (the MONO notice), canvas-MM-sim
  (4 tests appended after the last — the line-181 `todo` untouched: halos on ↶ / ↷ / Disconnect's ↶, no `mfx.in`, the camera following a moved
  drop on the master and on a track, the budgets / the MONO notice / the tray line). Two test-only fixes after the red run: canvas-MM-sim's
  unmoved drop point snapped to the dots, cv-cables' gestures given 1 s-apart event times (wk-dom's constant `NOW` made the right-click's native
  contextmenu look later than the next long-press's press, which wk's ctxGuard then skipped).
- **Browser** (Chrome for Testing 156, headless, its own profile, downloads denied by `Browser.setDownloadBehavior` (no download event logged), a
  no-store server on 8871, CDP 9671 — all killed after; real CDP mouse at 1440 × 900, real touch at 1366 × 1024 / 1024 × 1366 dpr 2; hooks only for
  setup (effects, camera)): every finding above re-checked; badges over WIDTH / Q / nothing: tap → the inspector, right-click / long-press → the
  cable menu; a track's fx1 Reverb MIX badge over DAMP → the inspector (it was "nothing"); no console error.
- **Gates** (each file alone, 2 GB): canvas-MM-sim 22 + 1 todo (line 181's, untouched), canvas-M-sim 21, cv-cables 69, cv-module 79, canvas-2b 23,
  -3 25, -8 17, -WC 51, canvas-sim 24, -1e 24, -1i 20, -2a 26, -7a 23, -7b 15, -7c 13, -9 22, -9b 14, -9c 3, -P 8, -R 28, -SC 15, -del 11, -tab 8,
  canvas-MM-live 1, fx-ui 74, sx-host 25, cv-mods-ui 13, cv-modlayer 12, cv-tray 56, main 47, lint 171, pwa 25 (after `node tools/precache.mjs
  --write`: BUILD 56769bd3332a) — all green. No engine / DSP file touched (fx-dsp.js is the engine fixer's).

### Notes — lane E, the engine (Fable 5.1, 2026-10-27; worktree reset to the phase-0 commit 54828a3; engine.js / fx-dsp.js / mod-core.js there = ba91775's byte for byte)
- **`tests/ref-MM/live-p1-mm.sha` — recorded from the base first, before any source change.** How: `git archive ba91775 | tar -x -C
  <scratchpad>/MM/base-ba91775` (engine.js / fx-dsp.js / mod-core.js of that tree `cmp`-identical to the worktree's), then the new
  recorder / verifier **`tests/canvas-MM-live.test.mjs`** (canvas-SC-live's scene and format: project-p1 from tests/ref-p1 opened in the
  page simulation, clock 'std', power, a 4096-frame warm-up render discarded, ▶, 192 000 frames, SHA-256 of each node's L and R as
  Float32 bytes) run as `REC=<that dir> node --max-old-space-size=2048 --test tests/canvas-MM-live.test.mjs` — the app modules and
  main-sim imported from the base tree, the file written into this tree. Its header names ba91775; its eight node lines are identical to
  tests/ref-SC/live-p1.sha's (the same engine, as it must be). Without `REC` the test runs the scene on this tree and compares — **lane H
  adds G1's master-canvas session (an LFO added on the master canvas and deleted, no cable) at the marked spot before ▶** (impossible at
  the base and at phase 0: `modAdd` refuses there); until then the plain run is the check.
- **Built — engine.js `Master` (§3, by the Track's names)**: the shim fields `trackId 'master'`, `wheel / at / bendRaw` 0, `mc` / `mcMon`;
  `tp = { play, frame, tick, fpt, loop, ls, le, end, wrap, pend }`, `pF0`, `snap`; `modsMsg` (the Track's minus `handRows`; `{t: 'modsErr',
  i: 'master', key}`), **`modsOff`** (`mc = null`, `snap = 0`, **`rack.setMods(null)` at once** while `c.mcOn` — the calm copy path may follow,
  so the Track's "at the next span's chainMods" would never get there), `chainMods` (the Track's two lines), `tickAt / songBeat()`
  (`tickAt(pF0) / 960` while `tp.play`), **`clock(F)`** (the Track's wrap with the multi-wrap `while` and the end on `tp.play` + `mc.transport
  (false)`, at part starts), `transportMsg` (the pend stored field for field; a stop: `tp.pend = null`, `tp.play = false`, `mc.transport
  (false)`), `start()` (the pend applied as `songEvents` does, `tp.wrap = P.loop && P.le > P.ls && P.tick < P.le`; the rack's re-seed
  under its own `pS || cold`; **the ModCore's under the Track's `P.seek || !tp.play`** — see the refinements — with `snap = 1`), `watch`
  (`mcMon = has('mods')`, `mc.watch(mcMon)`, the gate `mm || mx || mcMon` there and in `process`), `postMon` (`mo: mc.fxMon('mfx')` on the
  rack's smon only with a ModCore and rows; `{t: 'smon', mc, mcx}` while `mcMon && mc !== null`), `process` (`pF0 = F0 + s` before
  `start()`), **`part()`** (`r === null || (MC === null && calm…)` → the copy path; else with a ModCore: `pF0`, `clock(F)`, `MC.span(F, m, m >>
  2)`, `chainMods`, the snap once, then `r.process`, all inside the `c.t` timer), **`preroll()`** (`MC.span(0, 128, 32)` + `chainMods` per
  quantum of zeros), the constructor's `po.mods` after `chainMsg` and before `preroll`, `msg`'s `mods` / `mval` cases, the header comment.
  **fx-dsp.js `FXRack.modsJump()`**: five lines after `setMods` — `md ← mdT` for the globals and every unit. Nothing else in either file.
- **Refinements of [C] (reasons)**: (1) **`modsJump` recomputes no `eS / eD`**: `span()` derives them from `md` at the top of every call
  before any read (`paramsG / params` run inside the block loop after it), so a write there would be dead and would break "a no-op when
  every `md === mdT`" literally. (2) **The ModCore's start condition is the Track's** (`P.seek || !tp.play`), not the rack's (`pS === 1 ||
  cold`, kept for the rack — MM1): they differ only after a song end (`tp.play` false, `this.play` true), where a re-anchoring play
  transport restarts a Track's ModCore (`songEvents`: `start = P.seek || !tp.play` → `transportHook(true, cold)`) — G2 pins both ModCores
  back at `playing 1` with equal `songBeat()`. (3) **G3 (d), unaligned starts**: the contract's "≤ −80 dB" was the unmodulated rack's
  precedent; a moving knob's per-call linear ramp (fx-dsp §5.4) depends on where the calls fall, so a start at F mod 128 ≠ 0 differs from
  the frame-0 bounce by one quantum's modulation step — measured **−59.4 / −55.1 / −59.6 dB** (m = 4 / 60 / 124; a 1/4-note LFO over ±0.3 of
  a cutoff). The test now gates the exact thing: the same live run against an offline render **with the same unaligned start**
  (`transport.frame = m`, hence the same parts, spans and ramps) is **bit for bit** for all three — the partition is the only cause — and
  keeps the frame-0 comparison as a recorded measurement with a −40 dB tripwire. Never reached in the product (`mAlign` rounds while the
  master holds an effect, §4.3). (4) **Two bench rows**: `master-mods` (absolute, targets 0.034 / 0.034 / 0.029) and **`master-mods-d`**
  (the same build with `base: master5` — bench-scenarios' `measure()` already alternates row / base per 1 s block in one process and
  reports the median difference, P3-5; targets node 0.004, ipad 0.006, **jsc 0.005**: measured 0.0040–0.0043, the contract's 0.004 sits on the
  measurement — the lead decides; nothing gates jsc automatically). Both payloads are the host's compile (`cv-graph.compileMods` on a
  track-shaped record + `bpm`, `tests/bench-scenarios.mjs masterPayload`), not a hand-built CP: the bench runs what the host posts.
  `prepare()` posts `B.mods` after the chain. (5) **No warm round in `Master.warm()`** (§3.3 [R?] measured, below): the first quantum after
  MASTER's first payload in the load order is 1.40 ms, under the 2.67 ms quantum. (6) `clock()` runs only with a ModCore (nothing else
  reads `tp`; a payload arriving mid-song finds the wrap `while` catching up and the end check current). (7) `tests/canvas-MM-live.test.mjs`
  is a lane-E file (the recorder the lead owed); lane H owns the session step inside it.
- **Measured — G2 (tests/master-mods, the real engine)**: MASTER (the §6.1 rack: Filter → synced Delay → Reverb → Utility → Chorus; 4 GLOBAL
  LFOs — BPM 1/4 anchored, BPM 1/8 unanchored, Hz RETRIG, Hz FREE —, a mono chaos, a macro module, a CC; 8 fx rows; 140 BPM) against a graph
  Track with `trackId: 'master'` and the same record compiled with the panel as `fx1`: **`MC.fxv` and `MC.live` bit for bit on every one of
  3 750 spans** (10 s) through ▶ at quantum 100 and a seek to beat 8 at quantum 400 (128-aligned); MASTER's float32 output **≡ a bare FXRack
  fed its recorded sequence** (1 005 rack calls: `transport` at 100 / 400, `setMods` per part, `modsJump` once per start in its first part);
  `mval` k 0 → 0.9 moves the macro row's offset 0.200 → 0.360 on both; a CP with `ver 99` → `modsErr {i: 'master', key}` and the rows keep
  running; `{off}` → `setMods(null)` exactly once in that quantum, `mcOn 0`, every `md / mdT` 0 after the next call. **The clock**: a 4-beat
  loop from quantum 10 wraps at frame 83 565.7 — the Track re-bases in quantum 652, MASTER at 653 (the first part after `le`), `tp.frame`
  the same float, `songBeat()` equal on every quantum after, **the fxv back in step from the very next quantum** (0 differing quanta over the
  300 after); a start past `le` with loop on: `tp.wrap` false on both, no wrap; an `end` at beat 2: `tp.play` false, `songBeat()` null,
  `this.play` true, SxMod `playing 0` on both; a re-anchor after the end restarts both ModCores.
- **Measured — G3 (export = playback, 140 BPM)**: (a) the §6.1 cables (a BPM-anchored LFO on the Filter cutoff, a mono chaos on the Delay
  feedback, a macro on the Reverb mix, a CC on the Utility level; rise / fall 0): **bit for bit** at two aligned starts, the pre-roll's
  ModCore spans counted; (b) **a FREE unsynced Hz LFO is exact** (on `fil.res`); **without the snap** the four cables read −51.2 dB re peak
  from the first sample, the difference carried 4 s by the Delay / Reverb (windows −51 → −92 dB); (c) **a slewed row** (rise / fall 0.3 on the
  cutoff LFO): −38.9 dB in the first 0.25 s decaying −44.5 / −48 / −52 / −56 / −57 / −63 / −64 dB per quarter second, the tails to the end of
  the 4 s window (the contract's class, recorded); (d) as above. **A finding the contract did not predict — "the smoothed-knob class"
  (probe `scratchpad/MM/e-knobs.mjs`, one source on one knob)**: after the snap, every knob the ModCore drives is exact for a *constant*
  source (macro, CC: G3 (a)), and for a *moving* source (any LFO, chaos) on a **coefficient knob** (`fil.cutoff / res`, `dly.feed`, `rev.size`,
  `cho.depth / rate`); but a moving source on **`dly.mix` (−47…−65 dB, carried 4 s by the line), `dly.timeL` (−18…−35 dB, from ≈ 0.4–0.9 s on),
  `rev.mix` (−51…−70 dB, 0.19 s), `util.level` (−38…−57 dB, 0.16–0.22 s), `util.width` (−30…−51 dB, 0.19–0.25 s), `cho.mix` (−47…−65 dB, the
  first block)** differs live vs offline: the units' own smoothing of their gain / mix / width / time controls (not the rack's ramp, which the
  snap resets; not ModCore — its state after ▶ is identical on both sides, field for field) carries the pre-▶ trajectory, and the two
  trajectories differ (live: the payload's lifetime; offline: the pre-roll). The snap cannot reach it from the rack. **Recorded as a limit
  for §11** (the lead): "a moving master modulator on a mix / level / width / delay-time knob is not bit-identical for its unit's smoothing
  time after ▶ (≈ −45…−70 dB; the Delay's mix recirculates it); coefficient knobs and constant sources are exact". A fix would be a
  unit-side snap (each unit's smoothers to their targets, called from `modsJump`) — fx-dsp unit internals, outside this lane's scope and
  the contract's "modsJump only"; a seek while sound flows would then step those controls (as `md` already does by P1-1 (a)).
  **→ Done after review** (reviewer 1's P1: the class reached −21 dB, on `rev.pre` and `util.pan` too): the unit-side snap is in
  `modsJump`; "Notes — the MM fixer" below.
- **Measured — G4 / §3.3 on jsc** (`scratchpad/MM/e-jsc.js`, the DSP list + engine.js in the macOS JavaScriptCore shell, the bench row's FXP and
  payload revived from a tagged-JSON dump; 3 processes each): **the load order (MASTER, its payload, then a Track)**: MASTER's warm-up
  4.6–4.9 ms in its constructor; the first quantum after its first chain 1.54–1.56 ms; `setRows` 2.95–2.98 ms at message time; **the first
  quantum after the payload 1.40–1.41 ms** (0.53 of a quantum), then 0.37–0.42, ≈ 0.25…; none of the first 8 over the 2.667 ms quantum;
  steady 0.09 ms; after a Track's 1.04 s warm-up 0.15 → 0.08 ms. With a Track warmed first: `setRows` 0.56–0.60 ms, the first quantum
  0.42–0.44 ms. **The bench pair** (a Track warmed, two MASTERs, 0.25 s pre-roll, 5 alternating 1 s pairs): rack5 0.0170–0.0173, rack5 + mods
  0.0212, **delta 0.0040–0.0043** (ratio 1.23–1.25); the same payload with every row amount 0 (nothing moves): delta 0.0018–0.0027 — ModCore's
  own cost; the rest is the units recomputing coefficients per block for knobs that move (a Track's panel pays the same). Low floor × 7 on
  the delta: 2.8–3.0 %. **Node (tests/master-proc G4, calibrated)**: master-rack5 0.0168, master-mods 0.0205 (target 0.034), master-mods-d
  0.0039 (target 0.004, gated at 1.5 ×), no allocation per quantum with rows through a start and a seek (tests/master-mods G4).
- **The API as built (lane H)**: in — `{t: 'mods', i: 'master', cp, ct, rows, xfer, ext, vals, keep, bpm, key}` (every row `dst: {kind: 'fx',
  chain: 'mfx', fx, key}`; `bpm` read by `ModCore.setRows` — the master's shim runs the project tempo while stopped), `{t: 'mods', i:
  'master', off: true}` (or no rows and no ext), `{t: 'mval', k, v}`, `{t: 'mon', ids ⊆ ['meters', 'mfx', 'mods']}`, `{t: 'transport', play,
  frame, seek, tick, fpt, loop, ls, le, end, fresh, wrap}` (the host's `postAll` object as it is; `wrap` is recomputed, not read); out —
  `{t: 'smon', mc: Float32Array(16), mcx: {ph: Float32Array(20), env: Float32Array(8)}}` at the ≈ 29 Hz gate while `'mods'` is subscribed and
  a ModCore exists, `{t: 'smon', c: 'mfx', gr, fxph, ftap, mo?}` (`mo` = `fxMon('mfx')`: Float32Array(fxHi) of FX-context offsets, only
  with rows), `{t: 'modsErr', i: 'master', key}`; offline `processorOptions.mods` = the same payload object (handled after the rack, before
  the pre-roll). G5's integration-time asserts (P3-12): after a span `mnode`'s processor has `mc.fxv.mfx` non-zero and its rack's `mdT`
  moved — both hold in tests/master-mods.
- **Rules kept**: mod-core.js untouched; no Track code touched; sw.js not committed (rebuilt locally for the pwa gate, then reverted — the
  lead runs `node tools/precache.mjs --write` at integration); every golden re-run after the engine / fx-dsp edits (the sweep below).
- **Sweep** (`scratchpad/MM/e-sweep.sh`, one file at a time, 2 GB each, after the last engine edit): **28 / 28 green** — master-mods (7),
  master-proc (27: ref-M's three hashes, the §6.2 cases, G4's five rows — master-mods 0.0204, master-mods-d 0.0031 calibrated this run),
  every golden (golden-fx 3, -classic 8, -presets 8, -random 1, -graph 6, -drums 5, -606 11, -909 9, -sdsv 5, -moog 6, -moog-b 6,
  -moog-c 4: bit-identical — `modsJump` inert, no Track path touched), canonical-stream (the three parts), canvas-M-bounce (ref-M's three
  bounce hashes), canvas-SC-live (ref-SC), canvas-MM-live (ref-MM), canvas-M-sim (21, G1's live copy and the MREC contract),
  master-mods-model, engine-track (107, the warm-up cases), fx-dsp (78), fx-mods2 (28), modcore (24), bench (6: the new rows build and
  render), lint (171), pwa (25, against a locally rebuilt sw.js — reverted, not committed), app (11).

### Notes — the MM fixer (Opus 5.5, 2026-10-27; worktree reset to 8eb271c; reviewer 1's P1 and P3)
- **Tests first** (failing on 8eb271c): **`tests/master-mods-snap.test.mjs`** (new; reviewer 1's probe `r1-knobs` made a gate) — one source
  on one knob, the live MASTER vs the bounce's offline render at 140 BPM, bit for bit over 4 s, three sources (a FREE Hz LFO, the
  BPM-anchored LFO, a mono chaos): (1) the §6.1 rack's 15 knobs (reviewer 1's 13 + `fil.res`, `cho.rate`) — on 8eb271c 25 of 45 differ:
  `rev.pre` −21.3 dB (FREE) / −36.1 (BPM) / −29.7 (chaos), carried the whole window; `dly.timeL` −70.1 / **−20.7** / −59.4 from the first
  echo on; `util.width / level / pan`, `cho.mix`, `dly.mix`, `rev.mix` −35…−71 dB; `fil.mix` under the chaos −26.5 dB; (2) **every
  modulatable knob of the 13 effect types alone** (dist, flg, phs, cho, dly, cmp, rev, eq, fil, hyper, bode, util, duck; `conv` needs an
  IR, the splitters are containers; `duck.note` refused by cv-model) × the three sources = 444 cases — on 8eb271c **100 differ**, the
  worst `bode.delay` **−1.7 dB** (0.02–1.5 s), `util.lpf` −7.9 dB (chaos), a lone Delay's `timeL` −16.2 dB (to the end), `util.width`
  −17.0, `cmp.level` −19.7, `phs.freq` −20.7 dB: every
  unit's `level` / `mix` (the dry / wet ramp), the Delay's times and offsets, the Phaser's sweep, the Bode's delay. **`tests/master-mods`
  G3 (b)**: the FREE LFO on `dly.mix`, the BPM LFO on `util.level` and (new) the FREE LFO on `rev.pre` gated **exact** (were recorded);
  `rev.pre` with the rack-level snap alone (`g3(…, {snap: 'rack'})`: 8eb271c's body as a test-side `modsJump`) recorded, −21.3 dB, and
  asserted not exact (why the unit-side snap exists — the "without the snap" case's twin). **`tests/canvas-MM-sim`** (P3): the
  integration-time `todo` dropped, `proc.c.rack.U.some(u => u.mdT.some(x => x !== 0))` and `proc.c.mcOn === 1` asserted (19 / 19 at
  8eb271c already; the header updated).
- **The fix**: `FXRack.modsJump()`'s body = reviewer 1's (`scratchpad/R1b/fx-dsp.js`) code byte for byte (the header comment rewritten, two
  trailing comments from the report) — after `md ←
  mdT`, for each unit with an offset that runs (`st !== 0`, `has === 1`): `en / ev` from `bs + mdT`, `modUpd → modSnap → mixUpd`, `gD0 /
  gW0 ← gD1 / gW1` (`states()`'s 0 → 1 recipe), `u.dirty` left set. MASTER's `part()` stays its only caller (engine.js; no Track, no
  other site). With it: (1) 45 / 45 exact; (2) 438 / 444 exact — the six left are the two **stepped topology knobs** (§11): `phs.poles`
  −11.1 dB (FREE, 0.008–0.77 s) / −90.7 (BPM) / −117.3 (chaos); `rev.type` −45.8 dB (FREE, 0.008–0.04 s), BPM / chaos exact.
- **The two left, measured** (a state diff of the unit, live vs offline, quantum by quantum after the snap part): `phs.poles` — Phaser2's
  coefficient slots above the running pole count (`a0 / a1 [P, PH_MAX)`) hold the pre-▶ trajectory's values (`coefs()` writes `[0, P)`,
  `run()` copies every slot a1 → a0), so a pole count that grows after ▶ ramps its new poles from different stale slots (zeroing `a0`
  in the snap is not enough — tried: `a1` is copied back); `rev.type` — the TYPE change requested at ▶ is installed by the next
  `states()` (`topoReq`, quiet → at once), after the snap's `modSnap`: the new tank's glides (`rv.dl / dt`, `bw`) and the pre-delay's intro
  fade (`ir`) start from the install on one side and mid-way on the other. **Not fixed** (beyond the briefed port): candidates — Phaser2
  filling every slot in `coefs` / `snap` (a Track-side change: golden-fx decides), and `modsJump` installing a pending topology before
  `modSnap` (the seek reset's line, `if (u.mod.topo === 1) { u.mod.applyTopo(); this.modUpd(u); }`; the `ir` difference stays) — the lead
  decides; the test holds both to a transient (< 1 s) meanwhile.
- **Sweep** (one file at a time, 2 GB each, after `node tools/precache.mjs --write` — sw.js committed with the fix): **25 / 25 green** —
  master-mods-snap (4), master-mods (7), master-proc (27: "modsJump() on a rack without mods is a no-op bit for bit", ref-M's hashes),
  canvas-MM-sim (19, 0 todo), canvas-MM-live (1, ref-MM), golden-fx 3, -graph 6, -classic 8, -presets 8, -random 1, -drums 5, -606 11,
  -909 9, -sdsv 5, -moog 6, -moog-b 6, -moog-c 4 (bit-identical: no Track calls `modsJump`), canonical-stream (1), canvas-M-bounce (1),
  canvas-SC-live (1), fx-dsp (78), fx-mods2 (28), engine-track (107), lint (171), pwa (25).

## 13. Review log

### The skeptic review (2026-10-27, against f62a42a: 3 P1 · 9 P2 · 15 P3) — and what the lead did with each
- **P1-1** MM2 "bit for bit" was false: the first rack call after ▶ ramps every mod target from a history-dependent start (`md ← mdT`
  only after the ramp, fx-dsp.js:3054–3073; `transport()` never snaps). **Lead: option (a)** — `FXRack.modsJump()` (lane E, fx-dsp.js,
  additive, MASTER alone calls it in the first part after a cold start / seek, offline at frame 0); G3 at 140 BPM, rows without slew
  exact, slewed rows and a FREE LFO measured (§3.4, §6.1, G3). ✔ in the text.
- **P1-2** the owner-indirection list missed write paths (`modBypass`, `modCableAct`, `modEdit`, `modRemove`, `modDescs`, `modMount`'s
  `o.set`, `modLiveEnd` + `postMods`' re-check, `modCC`, `cvTitle` / `cvDevName`); row ids collide (`r1`). **Lead**: the rule is
  mechanical (four substitutions over the whole section), the missed sites listed, the leave-alone list owed in §12, G5's collision case
  (§7.1). ✔
- **P1-3** the `master.fx` move missed six readers (`loadProject`, `scMasterUnits`, `states()`, `syncPhases`, `projectFile` — the Save's
  IRs —, `bounce`'s `latBound`) and twelve canvas-M-sim pins. **Lead: the skeptic's smaller design** — additive `mdev / mods / mid`,
  schema 17 the identity, `MREC` a constant with a Proxy `dev` (§2, §4.1, §5; built in phase 0). ✔
- **P2-1** the wrap condition (`tp.wrap` as engine.js:4575, not `le > ls`), the pend stored at `transportMsg` and applied in `start()`, the
  song end on `tp.play` (never `this.play`). ✔ §3.1.
- **P2-2** `mo` missing from MASTER's `smon {c:'mfx'}`; the post gate and `watch` test `mm || mx` only. ✔ §3.2 (`mo` with a ModCore; `mcMon`
  in both gates).
- **P2-3** `mMount` would mount the rack into an LFO module; `title` says "Master OUT" for it; `badge` null for the LFO. ✔ §7.2.
- **P2-4** CC unrouted on the master. **Lead (first guess)**: a hardware controller drives a master CC module whatever track is selected
  (omni / its channel). ✔ §7.5, Q3.
- **P2-5** the MONO lock: the toggle is the panel's MONO switch, not the badge; a tap kills the cable. ✔ §7.2 (lane H forces + `B.sync()`,
  lane U the `lock: { mono: 1 }` slot-host option, G5 pins the tap).
- **P2-6** the `lay` setter would make the detached rack the project's; "rebuilt per project" is stale across undo. ✔ §4.1 (`mBox` only;
  a constant).
- **P2-7** display gating relies on unmount order. ✔ §7.4 (`shownId()` on every owner's `live` / `mcMonSync` / `mcSnap`).
- **P2-8** the payload carries no `bpm` (pre-existing). **Lead**: measured (§12: anchored LFOs follow the tempo while playing; ANCHOR off /
  stopped run at 120); the master's payload carries `bpm` from day one; the track side needs the user's OK (§0, §4.2, §10, §11); §9.1 /
  §4.2 corrected. ✔
- **P2-9** G2's seed salt and partition. ✔ (`trackId: 'master'` for the comparison Track; starts / seeks on 128-frame boundaries).
- **P3** 1 (no load prune; `History.undo` is `JSON.parse`) ✔ §5.2 · 2 (STEPS never mutate) ✔ §5.1 · 3 (assert the parameter state after
  `{off}`) ✔ §6.2 · 4 (FREE LFO: let G3 decide) ✔ MM2 · 5 (bench: jsc target, consistent iPad numbers, the interleaved delta) ✔ §6.3 ·
  6 (the load path posts the payload before any Track: measure that order) ✔ §3.3 · 7 (placement: no wheel height, clear of the rack) ✔
  §7.2 · 8 (`modAdd` refuses other kinds) ✔ §7.1 · 9 (post the mods with the chain's `go()`) ✔ §4.2 · 10 (`masterOff` closes the layer) ✔
  §7.1 · 11 (`data-dev` on `rec.ui.el`) ✔ §7.2 · 12 (G5's engine asserts integration-time) ✔ G5 · 13 (the `.cv-mside` rule: lane U narrows
  it in place) ✔ §7.3 · 14 (the `c.t` timer brackets the span) ✔ §3.2 · 15 (`keepMaster`'s dangling rows: the tracks' class) ✔ §5.3, §11.
- **Questions**: Q1 reframed with the ENV-mode LFO note; Q2 with the CC 1 note; Q3 (CC) added — all answered by the lead's first guess,
  the user confirms in the morning (§10).
