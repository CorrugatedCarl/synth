# Stage SC: sidechain ducking (IMPL-SC) — contract

ROADMAP row 17 (docs/canvas/ROADMAP.md:38 [R]). **Scope (the user, 2026-10-24 — settled, not re-asked)**: "we need sidechaining capability
so i can have tracks duck with the kick" — **both kinds**: (1) a **sidechain key on the Compressor** (any track's rack compressor keyed
by another track's audio: classic level-dependent pumping) and (2) a **Ducker** effect (a new FX unit: a **shaped gain dip triggered by
a chosen track's notes**, drawable curve, depth, length in ms or tempo-synced, attack — tight, the same every hit); **the ghost kick**:
the ducking listens to the source **before its fader and mute** — a muted (or faded-out) kick still drives the ducking, live and in the
bounce. Standing: no artificial caps (ROADMAP 14), the performance presets are visual only, native pinch only, canvas only, no per-stage
iPad session (one consolidated pass later), "push it live when it's done".

**Code references are to `canvas` at 96409fa** (= HEAD 91a859a for every `.js` file: the six commits since touch CLAUDE.md / ROADMAP only
[R: `git log 96409fa..HEAD --stat`]); the builders' base is the lead's phase-0 commit (§9.0). Tags as IMPL-M: **[R]** a fact (file:line),
**[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an [R]).
House format: IMPL-M (docs/canvas/IMPL-M.md); its map (map-master.md) is cited "map §n" where a fact is unchanged since.

**The user's answers (2026-10-24 — settled)**: Q1 the Ducker triggers on **every note of the chosen track, with an optional NOTE filter**
(e.g. a drum machine's kick lane); Q2 default length **1/8 note, tempo-synced**; Q3 default depth **100 %**; Q4 **yes — Serum complete's
own FX rack** gets the Ducker and the keyed Compressor too.
**The lead's decisions on the skeptic's open items (2026-10-24)**: (a) **`nv`** confirmed — a new Compressor stays v2 ("Key: none ▾" on its
panel) and becomes v3 only when a source is picked, in the same edit; (b) the **WebKit gate** (Safari on the Mac, 64 tracks, engine load
≤ +2 % vs the base) stands, with its fallback (inputs only on keyed nodes, a node rebuild at the first source pick) if it fails; (c) a drum
machine's own **lane MUTE does not trigger** a Ducker (the lane plays no note — recorded in §11; the ghost kick is the *track's* mute /
fader); (d) **the Serum panel's FX page gets the source menus** (Q4) — the one adapter line in `serum-ui.js` is lane U's.

**Invariants**
- **S1 No sidechain = today, bit for bit.** A project with no Ducker and no keyed compressor renders every sample as the base build:
  every frozen golden (golden-classic / -fx / -presets / -random / -graph, -drums / -606 / -909 / -sdsv, -moog / -moog-b / -moog-c,
  ref-M's master refs), **canonical-stream's two parts exactly** (the Track node's `processorOptions` gain no key — the sidechain
  lives inside the compiled racks, `fxr`, and only in projects that use it; node *options* are not in the record:
  tests/canonical-stream.test.mjs:93–100 records `[i, name, trackId, sha(processorOptions)]` and `sha(message)` [R]), **ref-M's
  three bounce hashes** (tests/canvas-M-bounce.test.mjs:1–35 [R]) and engine-track's warm-up hash. Giving every Track node one
  input (§1) changes no sample: an unconnected input is `[]` / `[[]]` and nothing reads it unless a unit asks (§1.2). **Three
  conditions make S1 true (skeptic #1, #2)**: new compressors and every factory payload stay **v2** (`nv`, §5.1 — "the highest
  variant" would build v3 compressors into 6 factory Serum presets through `recipe2` → `newInstance`, canonical-stream's
  'Thru-Zero Growl' among them, and into the factory module / rack / chain presets through `fxI`); the FXP's `iSrc`, the FXT's
  `cv` and the FXT key's Ducker terms exist **only in racks holding a unit** (§5.2); no node option but the input changes.
- **S2 Pre-fader, pre-mute, same quantum.** The key signal is the source Track node's **own output** (post its rack and output stage,
  before its GainNode / panner: main.js:1082 `node → gain → pan → MASTER` [R]) connected straight into the keyed Track node's input —
  Web Audio renders a node's sources before it in the same quantum (the spec's rendering algorithm orders every node after the
  nodes connected to its inputs; Chromium and WebKit pull inputs first, `processIfNecessary` [R: W3C Web Audio 1.0 §"Rendering an
  audio graph"]), so the key arrives with **zero latency**, and mute / solo / fader (`mix()` writes `N.gain.gain`, main.js:1182–1192
  [R]) never touch it — **except one engine-side mute path**: a muted / soloed-out track's 900 Series is powered off on the live node
  (`ptPower`, main.js:540–546, re-posted by `mix()` at :1189 [R]) — a sidechain source is spared (§1.3, skeptic #4). Offline the
  same edge is built (§7).
- **S3 Export = playback.** The bounce builds the same graph (the same edges, every source rendered — at gain 0 when it is muted or
  note-less-but-keyed-from: the MIDI-OUT precedent `want.set(tr, 0)`, main.js:4674–4681 [R]); the Ducker fires from the same note
  frames (the registry is per scope, keyed by track id, offline ids = live ids: main.js:3020 `trackId: it.tr.id` [R]); a start is
  quantum-aligned while any sidechain unit exists (IMPL-M P-1 (b)'s `mAlign`, main.js:1705 [R], extended §7.1) — exact from a silent
  history, as IMPL-M M2.
- **S4 Identical every hit.** The Ducker's dip is a function of the hit's frame alone (no velocity, no level, no history once the
  previous dip has recovered): a trigger at frame f and one at f + Δ produce shifted-identical gain curves; the restart is
  **sample-exact** (an in-call offset, never a span split — §2.3); the recovery's end is per sample too (§4.2: never snapped at a
  call boundary, whose phase relative to the hit differs hit to hit).
- **S5 Cycles refused, never muted.** A keying graph with a loop (A keys B keys A, a self-key) would need a DelayNode in Web Audio
  (a cycle without one is muted [R? Web Audio spec §"Cycles"; the lane cites it in §12]); the host refuses the edge with a plain notice
  before any connection is made (§1.4).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts; "→" what they force)

| piece | where [R] | SC |
|---|---|---|
| One `synth-engine` node per track, **`numberOfInputs: 0`**, `outputChannelCount [2]`; `node → gain → pan → MASTER` (+ two analysers); offline the same options, `node → g → pn → bus` | main.js:1075–1082, 3022–3031 | every Track node gets **one stereo input** (§1.1); the key edge `src.node → keyed.node` beside the existing ones |
| `syncNodes` builds / drops nodes by id; `mix()` fader / mute / solo on `N.gain`; `postTo` / `postAll` | main.js:1167–1176, 1178–1192, 1194–1209 | `scAll()` after the creation loop, incoming edges cut in the drop loop (§1.1); `mix()`'s gains untouched (S2), its `ptHeard` reads `scKeyed` (§1.3) |
| MASTER: `numberOfInputs: 1`, `channelCount 2 / explicit / speakers`, `inputs[0]` `[]` when unfed — **an input-bearing worklet runs on WebKit**: M deployed 2026-10-23, the iPad app installed from HEAD the same day, "feeling great" | main.js:1216–1219; engine.js:4907–4955; docs/HANDOVER.md:122–141 | the Track takes the same input options; `[]` / `[[]]` handled |
| `Track.process(inputs, outputs)` ignores `inputs`; spans split on the 4-frame grid at song / sequencer events (`len = ceil(d / 4)·4`); `renderSpan` → `r.process(this.Lb, this.Rb, n)` (span-relative buffers, offset 0); graph racks in `chainSpan`; a Serum's own rack inside the Inst (`this.rack.process(Lb, Rb, n, …)`) | engine.js:4626–4665, 4676, 4744, 3434–3436 | the key copied per span into `this.kL / kR`; the rack's own `sc` fields written before each rack call (§1.2) |
| `rack.process(L, R, n, dL, dR, b1L, b1R, b2L, b2R)`: **dL/dR = the Serum "direct" pair, b1*/b2* = BUS 1 / BUS 2 inputs — none is a sidechain**; the calm early return `if (calm && !dL && !b1L && !b2L …) return` | fx-dsp.js:2796–2802, 2857–2879 | signature unchanged; the key rides on a rack **field** `rack.sc` (§1.2); the calm return untouched |
| The Compressor (`Comp`, S1 kind 6 / S2 kind 14): stereo-linked peak detector on **its own input** `a = max(|xl|, |xr|)`, look-ahead line (Limit), three band detectors (Multiband); `meter(gr, o)` 4 slots; `dd = 1` (supplies its dry) | fx-dsp.js:977–1157 (1067–1082 detector, 1096–1102 single band, 1153–1157 meter), 3005 | v3 adds the key path (§3) |
| FX types: `TYPES` 16 ids in FXP `iType` order (fx-dsp) = `FXTYPES` (fx-core) = `FXMods2.TYPES`; `ROWS[t][v]` v ∈ {1, 2}; `TAB` exported for `[1, 2]`; `MIXK_T` 16 entries; kinds 0–21 (`K_S2`); `newMod` / `kindOf`; the tables **embedded identically** in three files and compared by tests | fx-dsp.js:1913–1990, 2168–2195; fx-core.js:570–578, 609–666; fx-mods2.js:151–181; tests/fx-dsp.test.mjs:254, 2187–2193; tests/fx-mods2.test.mjs:212–226 | `'duck'` appended at index 16 (existing `iType`s unchanged); cmp gains variant **3** (§5.1) |
| FXP v2 (`compile2`): `base` + per-instance side arrays `iType iVar … iRev iCho iIr`, `needs`, `xsKey`; `okGraph` requires each side array; FXT v2 `{key, xs: [{id, xsA, xsB}]}` keyed by `fxtKeyOf` (Distortion points only); `setXS` by instance id | fx-core.js:916–990, 1015–1024; fx-dsp.js:2143, 2161, 2391–2400, 3290–3297 | `iSrc` (optional in `okGraph`), FXT `cv` tables, the key covers Ducker points (§5.2) |
| `sub` = per-type non-row data (`dist` points, `cho.mono`, `conv.ir`), `normSub(type, v, raw)`; `upgradeInstance` S1 → S2 only; `applyModulePreset` upgrades fv 1 → 2 | fx-core.js:671–681, 1292–1323, 1095–1097 | `sub.src` (a track id) for cmp v3 and duck; `sub.cv` (points) for duck; v2 → v3 upgrade (§5.1) |
| The "+" menu: `addMenuItems` from `ADD_EFFECTS` (13) + splitters, `opts.cost(type)`; `FX_ITEMS` sorted by id; `fxCost` = cv-cost `COST.fx[type]`; panels built by `this['mod_' + type]` | fx-ui.js:444–454, 944–983; main.js:6762–6791; cv-cost.js:111–114 | `'duck'` everywhere (§6); pins §9.3 |
| `fxHost` members (`fx, editFx, racks, gr, tap, setTap, locked, storage, notify, extraRows`); the master's `mfxHost`; FX edits are **not History** (knob policy), `fxEditDev` → `fxPrune`, `queuePatch`, `persist` | main.js:3395–3418, 6347–6356, 2657–2667 | `scSources()` added to both hosts (§6.1); `sendPatch` → `scSync(t)` (§1.1) |
| Note-ons reach a sound at four leaves: `Inst.noteOn` (song, live keys, MIDI OUT `ext`, the 303's `seqFire`), `drHit` (a drum note through its map, after the mute check), `drStep` (a DrSeq pattern step, the step's lowest primary note), `sxNote(on)` (a Serum: `sxIn` and the arp / clip's generated notes); the 900 Series' `pm.note` (the controller's keys) | engine.js:2862–2908, 2456–2462, 2499–2508, 2929–2970, 3177–3191; dr-seq.js:20–22, 239, 388 | the registry hooks (§2.1: `drHit` stores the sound's primary, pattern steps per sound through `drNote`); the 960's own steps are not notes (§11) |
| A scope-level processor registry already exists for cross-node events: `PROCS` by track id, `extNote(F + 128, …)` — **one quantum late because node order is not guaranteed without an edge** | engine.js:1685–1691, 4596–4612 | the sidechain edge *is* the ordering guarantee: same-quantum reads (§2.1) |
| Track ids `'trk_<n>'`, names free text; `deleteTrack` keeps dangling targets for undo (PADS precedent) | song.js:76–90; main.js:4079–4097 | `sub.src` dangles (ids are reused: fresh ids, §1.3); names resolved at display time |
| Schema 14 (`project.master`), `STEPS[13]` identity, `upgrade` opens a newer file read-only, `toV1` `lost` lines; `normalizeFx2` drops an unknown type and reads an unknown variant as the highest known | cv-migrate.js:105, 147–165, 245–250; fx-core.js:737–739 | **SCHEMA 15** (§5.3): an older build would drop a Ducker, downgrade a v3 compressor and autosave the loss |
| main-sim: `AudioWorkletNode.nIn` from `numberOfInputs` (default 1), `paths()` stops at an input-bearing worklet, `procOrder` topological, `quantum()` feeds `[[Float32 sum]]` / `[[]]`, processors built **by node name**; `connect(n)` adds to a Set, **`disconnect()` clears every edge** (no selective form) | tests/main-sim.mjs:137–138, 171–220, 249–270, 298–317, 378–392 | selective `disconnect(n, o, i)` (§9.1 lane H); the rest already models the key edge |
| The bounce: `bounceSet` (audible + notes / synced; MIDI-OUT targets and their sources at gain 0), `renderOffline(sr, frames, items, at, {master})`, `mAlign` only while the master holds an effect | main.js:4666–4683, 3003–3045, 1705 | sources added transitively at gain 0; items carry `sc`; `mAlign` extended (§7) |
| Shape library: `shapeLib` (`synth.sx.shapes`) with a factory **'Sidechain'** shape; `CurveEditor` kinds `lfo / remap / xshape / curve / mcurve / spec`, a `ph` marker field; the X-Shaper popover edits `sub.xa / xb` through it; `evalPts` / `renderPts` (`[[x, y, c], …]`, c = curvature) | graph.js:284, 613–626; fx-ui.js:629, 1937–1968; laws.js:127–153 | the Ducker's curve = the same editor on `sub.cv` (§6.2) |
| ModCore: a track's modulators gate from **its own** notes (`MC.noteOn` in `Track.noteOn`), rows read at span ends ("every such target is span-rate"), fx rows glide linearly across a call; a track without rows has no ModCore | mod-core.js:1–60; engine.js:4331–4350 | a Ducker-as-modulator was weighed and rejected (§4.0) |
| Drum note maps: `DEFAULT_MAP` (bd [36, 35] …), `SOUND_NAMES`, **`drumRows(map, model)`** → `[{n, s, name}]` (n = the sound's primary; main.js already has roll.js's `drumRowsOf(dev)`); DrSeq `DEF_PRIM`, `prim` per payload | drum-core.js:91, 115, 271–281; roll.js:11; main.js:3, 4178; dr-seq.js:112, 182 | the Ducker's NOTE filter menu names a drum source's lanes (§6.2); the registry stores a drum hit as its sound's primary (§2.1) |
| DrSeq hands the Inst **one note per step**: `drStep(n, v)` with n = the **lowest** primary of the step's sounds (808 / 606 `fire`, the 909's `hook`, a flam's second hit too) | dr-seq.js:331–343, 376–387 | a per-sound hook `I.drNote(q, v)` beside it (§2.1, dr-seq.js → lane D) |
| **`FXRack.graph()` keeps a unit by kind and type only** (`u.k !== k \|\| u.t !== t`); a `Unit` sizes `tgt / en / ev …` by its rows at construction and copies rack references (`dyL`, `cf` …) then | fx-dsp.js:2223–2227, Unit (`class Unit`) | a v2 → v3 compressor upgraded in place would keep its 18-row Unit (§3.1) |
| Units in a **BUS rack** and in a **splitter branch** run at `o = 0` on block scratch (main rack: `oo`, the block's offset in the call) | fx-dsp.js:2862–2868, 2956, 3025, 3031 | the key / frame index is the block offset `sc.b`, never the unit's `o` (§1.2) |
| `kindOf(t, v)`: −1 unless v is 1 or 2; `k < 18` → k; **every k > 20 falls through to the splitter kind 21** | fx-dsp.js:2170–2181 | v3 and kind 22 need explicit cases (lane D); phase 0 must not add `K_S2.duck` (§5.1) |
| "The highest variant": `newInstance`, the factory builder `fxI`, `normalizeFx2` / `payloadPS` fallbacks; `recipe2` builds the factory Serum presets' FX with `newInstance` (6 build a v2 compressor so — Sub Foundation, Thru-Zero Growl, Break Chopper, Exp FM Reese, Linear Rubber, Break Kit; 9 more hold S1 ones; canonical-stream loads 'Thru-Zero Growl') | fx-core.js:739, 1095, 1114, 1345, 1473; serum-core.js:4463; tests/canonical-stream.test.mjs:72 | `nv` (§5.1) |
| A module preset read back is forced to `fv: x.fv === 1 ? 1 : 2`; `applyModulePreset` writes `I.sub = cloneJ(src.sub)`; rack presets double as the rack clipboard; Serum / classic user presets carry FX states | fx-ui.js:302–304; fx-core.js:1356, 1222–1225; main.js:2417, 2820 | v3 kept; `sub.src` kept by apply, blanked on the way out (§5.1) |
| Names taken: **`N.sc`** = a track node's OUT-scope AnalyserNode; **`Track.sc`** = the song's cc lanes | main.js:1079–1083, 5213–5216; engine.js:3535, 4441, 4528 | the edge map is `N.scIn`, the Track's key fields `kL / kR` (§1.1–§1.2) |
| `ptPower`: a muted / soloed-out track's 900 Series is **off on the live node** (offline never) | main.js:540–546, 1189 | a sidechain source is spared (§1.3) |
| Track ids are **reused**: `newTrack` takes `max(trk_n of the tracks present) + 1`; a valid unused `opts.id` is honoured; three callers in main.js | song.js:44, 76–90; main.js:4047, 4064, 4607 | fresh ids past every named `sub.src` (§1.3) |
| `deleteTrack` → `syncNodes` drops the node: `N.node.disconnect()` removes its **outputs** only; a processor whose `process()` returned false is still called while a source feeds its input (Web Audio lifetime) | main.js:4079–4097, 1170–1173; engine.js:4630–4633 | the drop loop disconnects incoming key edges first (§1.1) |
| The bounce needs **no power** (`bounce()` builds its items from `bounceSet` without `powerOn`; `nodes` may be empty) and copies **named fields** of each `bounceSet` entry into its items | main.js:4703–4728 (items 4714–4721) | `scWant` is power-independent; the item builder forwards `sc` (§7.2) |

---------------------------------------------------------------------------------------------------------------------------------

## 1. Routing the key (lane H: main.js) [C]

### 1.1 The graph
Every Track node is built with **`numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode:
'explicit', channelInterpretation: 'speakers'`** (MASTER's input options, main.js:1217–1219 [R]) — live (`makeNode`, main.js:1075) and
offline (`renderOffline`, main.js:3022) alike. Reasons: (a) `numberOfInputs` is fixed at construction, and rebuilding a node mid-session
when a sidechain is first assigned would cut its sound and lose its state (tails, phases, a running drum pattern, held keys); (b) an
unconnected input reads `[]` / `[[]]` and should cost nothing (measured on WebKit before it is trusted, §7.4 — the fallback is there);
(c) canonical-stream does not record node options (S1); (d) WebKit renders an input-bearing worklet (MASTER, §0). Not several inputs (a
slot per source): `numberOfInputs` cannot grow, so slots would be a cap — against ROADMAP 14 — and a key input in hardware is one jack.
**One key input per track = the sum of every source its compressors name** (§11; a Ducker's edge adds silence).

The key edge: for every track t, **`scWant(t)`** = the set of track ids named by `sub.src` of every **Ducker** and every **compressor
v3** in every rack of the track (every panel device's `fx` and every Serum device's own `fx`: `fxOfDev(t, dev)`, main.js:237–247 [R];
racks 0–2, splitter branches included) minus t itself, minus ids that are not tracks of the project, minus edges that would close a cycle
(§1.4) — a function of the project alone (the bounce uses it with the power off, §7.2; skeptic #7); **`scSrcs(t)`** = `scWant(t)` ∩ the
ids with a node. **Every edge goes through its own GainNode** `kg`: `src.node → kg → N.node` (skeptic #11). `kg.gain.value` = **1** when a
compressor v3 of t names src (its audio is the key), **0** when only Duckers do — the edge is then there for the processing order alone (a
gain-0 node still pulls its input in Chromium and WebKit, so the order holds) and nothing of a Ducker's source enters the key a compressor
of the same track hears. **`N.scIn`** (a Map id → `{ s, kg }`, s = the source's AudioWorkletNode) holds the edges made — never `N.sc`, the
OUT scope's AnalyserNode (main.js:1079–1083, 5213–5216 [R]; skeptic #9). **`scSync(t)`**: an id of `scSrcs(t)` without an edge →
`kg = ctx.createGain(); s.connect(kg); kg.connect(N.node, 0, 0)`; an edge whose id left `scSrcs(t)`, or whose `s` is no longer
`nodes.get(id).node` (a source rebuilt under its id) → `s.disconnect(kg); kg.disconnect()` (try / catch); every `kg.gain.value` set at
once (0 ↔ 1 moves only a compressor's key). **`scAll()`** = `scSync` for every track, at the end of `syncNodes()` (after the creation loop,
main.js:1174); and **`sendPatch(t)`** (main.js:672 [R]) calls `scSync(t)` before it posts — every FX state reaches the node through it
(`fxEditDev`, a device added / removed, a model change, a Serum or chain or rack preset, undo's `keepDevs`, a load), so the edges never go
stale (a stale edge would sum a source no unit names into a compressor's key) and an edge exists before the FXP naming its source lands
(skeptic #10). **`syncNodes`'s drop loop** (main.js:1170–1173) first drops the edges **into** the node it drops (`for (const e of
N.scIn.values()) { e.s.disconnect(e.kg); e.kg.disconnect(); }`): `N.node.disconnect()` removes its outputs only, and a processor whose
`process()` returned false keeps being called — and is never collected — while a live source feeds its input (skeptic #8). A power cycle
/ sample-rate change rebuilds every node and `syncNodes` re-wires. The connection follows **`sub.src` non-empty**, not the compressor's KEY
switch: toggling INT / EXT is then glitch-free (the edge already exists) and a Ducker needs the edge only for ordering (§2.1).

### 1.2 Inside the Track (lane D: engine.js)
`process(inputs, outputs)`: `const In = inputs[0]; const fed = In !== undefined && In.length > 0 ? 1 : 0` (both `[]` and `[[]]`
read unfed; main-sim passes `[]` today and `[[]]` to an input-bearing node, tests/main-sim.mjs:203–206 [R]; should WebKit hand an
unconnected explicit-2 input as two zero channels [R?], `fed` reads 1 and the copy runs on zeros — the same sound, a 2 × 128 copy). Per
span (`off, len`): when `fed`, copy `In[0][off + i], In[1][off + i]` (`In[1] || In[0]`) into `this.kL / kR` (Float64Array(128), indices
0 … len − 1 — a loop, never `subarray`: no allocation on the audio thread). **The key context is the rack's own object** (skeptic #5,
#12): `FXRack`'s constructor makes `this.sc = { q: 0, F: 0, b: 0, reg: null, kL: null, kR: null }` (never replaced: a `Unit` copies the
reference at construction as it copies `dyL`, fx-dsp.js `class Unit` [R]). Before every rack call the Track writes `q` (F0 of this
quantum), `F` (the absolute frame of the call's sample 0, `this.spanF`), `reg` (**`SCREG` when the Track has a `trackId`, else null**: a
preview / resample / render-farm node's units idle, §4.3) and `kL / kR` (this span's copies when `fed`, else null) — for `c0`
(`renderSpan`, before engine.js:4676), every chain (`chainSpan`, before :4744), every powered Serum Inst's `fxc.rack` (before its
`renderSpan`, which runs the rack inside `renderSerum`, engine.js:3434–3436 [R]) and the dying parts' racks (`dyI` / `dyC`) — six field
writes per rack per span. **The rack writes `b`** (the block's offset in the call, `oo`, fx-dsp.js:2862 [R]) before each block. A unit's
absolute frame of block sample j is `sc.F + sc.b + j` and its key sample `sc.kL[sc.b + j]` — **never from its own `o`**: a BUS rack and
a splitter branch run their units at `o = 0` on block scratch (fx-dsp.js:2956, 3025, 3031 [R]). No Track field is named `sc` (the song's
cc lanes, engine.js:3535, 4441 [R]). Nothing else in the Track changes for the key. When no sidechain unit exists anywhere the copy still
happens only if something is connected (never: no edge without a unit, §1.1) → S1.

### 1.3 Lifecycle
A deleted source: its node goes (`syncNodes`; `N.node.disconnect()` cuts `s → kg`), `scAll` drops its edge from every `N.scIn`; the keyed
units keep `sub.src` (undo brings the track back, the PADS precedent main.js:4088 [R]); the UI shows the name as "— (track gone)" and the
unit idles (a Ducker never fires, a keyed compressor hears silence — §3.2). A deleted **keyed** track: its incoming edges are cut in the
drop loop (§1.1). A renamed track: names are looked up by id at display time. A duplicated track (`duplicateTrack` clones `dev`,
main.js:4071 [R]) keys from the same sources. Undo / redo: FX states ride with `keepDevs` (not History); `applyRestore` / `loadProject` /
New go through `syncNodes` → `scAll`, every FX change through `sendPatch` → `scSync`. Power off clears everything with the nodes.

**Track ids are reused** (song.js:44 / 79 [R]: a new track takes `max(trk_n present) + 1`): delete the highest-numbered track, add one,
and a `sub.src` kept dangling for undo would silently re-bind to the unrelated newcomer. Lane H's three `S.newTrack` callers (main.js:4047,
4064, 4607 [R]) pass `id: 'trk_' + (the max n over the tracks **and every `sub.src` named in the project, the master's included** + 1)`
(song.js honours a valid unused `opts.id`); undo still restores the original id (skeptic #13).

**The 900 Series as a source** (skeptic #4): `ptPower` (main.js:540–546 [R]) switches a muted / soloed-out track's 900 Series off on the
live node (no notes, no audio) and never offline — the ghost kick would be silent live and present in the bounce. `ptPower` and `mix()`'s
`ptHeard` test (main.js:1189) read **`audible(t) || scKeyed(t)`** — `scKeyed(t)`: t is in `scWant` of an audible track or of the master,
transitively (the bounce's closure, §7.2) — so a keying 900 Series stays on at gain 0 as any other source; its cords' dimming (`ptDim`)
follows `audible` as today (the UI says muted).

**Payloads that leave the project carry no track id** (skeptic #14): a `trk_n` names a different track in another project. fx-core's
`blankSrc(x)` (phase 0: an FX state, a rack or a module payload → a copy with every `sub.src` = '') is applied by every path that stores
or exports FX: module presets and the module default (`modulePresetPayload`; fx-ui's store paths fx-ui.js:2162–2194), rack presets saved
to the library, chain presets, Serum user presets (`sxSave`, main.js:2820) and classic user presets holding FX; the **rack clipboard**
(`rackPresetPayload`, fx-core.js:1222) keeps `src` within the project (its uid) and blanks it on a paste into another. Applying a preset
never clears the instance's own `sub.src` (§5.1).

### 1.4 Cycles and the self-key
`scCycle(t, src)` → true when `src === t.id` or `t` is reachable from `src` over the edges already accepted — `scWant` is built in a fixed
order (project order of the keyed track, then its units' walk order), an edge refused when it would close a cycle with those before it,
so the result never depends on node state or call order (a DFS over `project.tracks`; ≤ 1024
devices a track, trivially fast). The UI's source menu disables such tracks with the reason as tooltip (`scSources().ok(id)`, §6.1):
"Bass already ducks with Kick — a loop would need a delay. Pick another source." The host guards too: `scWant(t)` drops a cyclic id (a
pasted preset or a hand-edited file) and `scSync` posts the notice once per (t, src) per session. A refused edge leaves the unit idle
(§3.2 / §4.3) — by the registry's stamp rule (§2.0: the refused reader runs before its would-be writer, which is downstream of it through
the other edge, so the ring is never stamped for its quantum), not by luck: nothing is ever muted by Web Audio. Mutual Duckers (A ducks
from B, B from A) are refused alike — one order exists per quantum (§11).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The trigger registry (lane D: engine.js) [C]

### 2.0 Choice
(a) **A scope-level note registry** read in the same quantum through the audio edge — chosen. (b) The host passing the source's song
notes as data: misses live keys, MIDI OUT, drum patterns, the arp (the user: "however they're produced"). (c) An envelope follower on the
key with a threshold: level-dependent, not "the same every hit"; that is what the keyed compressor is for. (a)'s ordering: the Web Audio
rendering graph processes a node after every node connected into it (the edge of §1.1 exists for every Ducker: the host connects the
source whenever `sub.src` is set, Ducker or compressor), so the source Track has written this quantum's note frames before the keyed
Track reads them. Without an edge (a Ducker on MASTER, §4.4) the reader is downstream of every track anyway. In main-sim `procOrder`
is topological (tests/main-sim.mjs:184–193 [R]). **If the order were ever wrong** (a browser bug, a sim without the edge, a refused cycle,
the few quanta between a source's change and its FXP landing) the reader **trusts a ring only once its writer has stamped it for the
reader's own quantum** (`ring.q === sc.q`, §2.1 — skeptic #12): a ring not yet stamped is empty to it, so every hit of that quantum is
**dropped** — song and message-time notes alike (a message-time entry is written between quanta, before any process: without the stamp a
reader running first would see it and miss the song notes, an order-dependent mix) — never played a quantum late (deterministic; G4
asserts the order).

### 2.1 The registry
`const SCREG = new Map()` beside `PROCS` (engine.js:1687 [R]): track id → ring `{ q, n, f: Float64Array(SC_N), note: Uint8Array(SC_N),
vel: Float32Array(SC_N) }` (`q` = the F0 its writer last stamped, −1 at birth), `SC_N = 64` (note-ons per quantum per track; beyond:
dropped). Created with `PROCS.set` in the Track constructor when `po.trackId` is a non-empty string (engine.js:3567–3571 [R]: the warm-up
runs before it — no ring during warm-up, the warm-up hash unchanged; preview / render-farm / resample nodes have no id and write nothing),
`this.scR = ring`; deleted in `end()` **only when `SCREG.get(id) === this.scR`** (PROCS's identity rule, engine.js:4401 [R]: a node
rebuilt under the same id — delete then undo — keeps its new ring). One registry per AudioWorkletGlobalScope = per context: a bounce
never sees the live rings.

**Writer** `Track.scOn(n, v)`: `if (this.scR === null || !(v > 0)) return;` frame `F = this.inSpan === 1 ? this.spanF : this.frames`
(a span event fires at the span start; a message-time note-on — live keys, MIDI — at the next quantum's first frame: `this.frames` =
F0 + n of the last quantum, engine.js:4635 [R]); append `(F, n & 127, v)` (a full ring compacts first: message-time entries arrive
before the next compaction). At the top of `process` (after F0): compact the ring to the entries with `f >= F0` (the previous quantum's are
gone; message-time entries for F0 stay) and **stamp `ring.q = F0`** — before `songEvents`, so a reader downstream sees the stamp and this
quantum's span notes. **Hooks** (each `this.T.scOn(…)` from the Inst): `Inst.noteOn` after `if (this.rack) this.rack.trigger()`
(engine.js:2877) and **only for kinds other than 'drums'** (a Serum returned earlier: its leaf is `sxNote`; the 900 Series' controller
keys `pm.note` and the 303's `seqFire` → `this.noteOn` are covered here); **`drHit`** after its map / mute check (:2460) with **the
sound's primary note** (`q !== null ? q.prim[s] : DS.DEF_PRIM[s]`), not the played n — a note 35 and a step both read 36 for the 808's
BD, so the NOTE filter's "Kick" catches either path (skeptic #6); **drum pattern steps per sound**: DrSeq's `fire` (dr-seq.js:331–343)
and the 909's `hook` (:376–387, flams' second hits included) call an optional **`I.drNote(q, v)`** once per sounding lane with that lane's
primary `q` (inside the loops they already run for `drStep`, lane-muted lanes are already out of the plan's mask), `Inst.drNote(q, v)` =
`this.T.scOn(q, v)` — `drStep`'s single lowest note keeps its RETRIG / ModCore meaning but cannot drive a per-lane filter (a snare struck
with a kick reads 36: NOTE 38 would never fire on that step; a user map putting a sound below the BD hides the kick); `sxNote` on-branch
after `this.rack.trigger()` (:2932, n = the transposed note). A legato / tied 303 step (`v.noteOn(…, true, …)` directly, :3184) is not a
new hit — by design. `aud` previews count (they sound). The Track's own `noteOn` is not hooked (every path ends in an Inst leaf; MASTER
has no Insts). Several Insts of one track hit by one note write one entry each (harmless: the same frame).

### 2.2 The reader
A unit reads `sc.reg.get(R.src)` (`sc` = the rack's object the Unit copied, §1.2; the Unit's `src` from FXP `iSrc`, §5.2) once per
`run` call — nothing when `sc.reg` is null or the ring's `q !== sc.q` (§2.0) — and scans its ≤ 64 entries for `d = f − (sc.F + sc.b)`
with `0 ≤ d < m`: a trigger at sample offset `d` of this block (m ≤ 16: fx-dsp `BLK`). Cost: `Map.get` + a scan of n entries (usually 0)
per block → O(1) per span in practice; G7 measures. The note filter (§4.2) applies here.

### 2.3 Why an in-call offset, not a span split
Splitting the keyed track's spans at the source's note frames (as `extEvents` does for MIDI OUT, engine.js:4651–4655 [R]) would change
the keyed track's own partition (its racks' per-call smoothing and 16-sample blocks, fx-dsp.js:2815–2829 [R]) whenever a sidechain is
active and cost a `renderSpan` per hit; the in-call offset keeps the Track's loop untouched, is exact for any frame (the source's hits
are 4-aligned today — live MIDI need not stay so) and lives in one place, the Duck's `run`.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The Compressor's key — variant 3 (lanes D / U) [C]

### 3.1 Why a variant
Appending rows to cmp v2 would shift the FX-context layout of every later instance in every rack holding an S2 compressor
(`layoutOf`, fx-core.js:842–855 [R]) and change the `fxr` payload canonical-stream hashes (its session loads Serum presets with racks)
— provable-neutral only by argument. **Variant 3** = the house mechanism for "a module gains controls" (S1 → S2, fx-ui.js:2124–2147 [R]):
existing v2 instances compile byte-identically. **New compressors stay v2** (`nv: 2`, §5.1 — skeptic #1: "new instances get the highest"
would make every factory compressor a v3, canonical-stream's 'Thru-Zero Growl' and 5 more Serum presets through `recipe2`, the factory
module / rack / chain presets through `fxI`; in phase 0, before lane D's `kindOf(t, 3)`, they would even pass their input). An instance
becomes v3 **the moment it is keyed** — the panel's **from ▾** (§6.3) or its ▾ menu's "Add a sidechain key" — through `upgradeInstance`
(§5.1); the layout changes only in the projects that key. **The unit carries over the upgrade** (skeptic #3): `FXRack.graph()` keeps a
unit by kind and type only (fx-dsp.js:2223 [R]) — a v2 compressor upgraded in place (kind 14 and type 5 both ways) would keep its
18-row Unit, the three v3 rows would never land (`u.tgt` is sized 18, typed-array writes past it vanish) and **the key would never engage
live until a reload**, while a bounce (fresh units) keys. Lane D **grows the Unit in place** when `u.v !== v` with the same kind
(`graph()` runs at set time, allocation allowed): `v`, `n` and the per-row arrays (`law lo hi cont tgt bs md mdT eS eD en ev`) re-made at
the new length with the shared rows' state copied, the module and the enable state (`st`, `xf`, `gD0 / gW0`) kept — a fresh Unit would
start at `st 0` and reset + fade the compressor (fx-dsp.js `states()`): no reset, no glitch at the upgrade. A v3 at `ext 0` renders
**bit-identically to the same v2** (the key path is never entered; the extra rows are read only when `ext`): tested as the S2-equivalence
tests are (tests/fx-dsp.test.mjs, the "S2 at S1-equivalent settings" pattern), and the in-place upgrade is tested live (G2).

### 3.2 DSP (fx-dsp.js `Comp2 extends Comp`, :1647 / :985 [R] — kind 14 for v2 and v3; `kindOf(t, 3)` → 14 for cmp, −1 for every other type)
Rows appended (fx-core / fx-dsp tables, verbatim §5.1): **`ext`** (bool, KEY INT / EXT, nomod), **`schp`** (exp 20 … 2000 Hz, def n 0 =
20 Hz = **off**), **`listen`** (bool, nomod). `upd(R)`: `this.ext = R.n > N_CMP2 && ev[iExt] >= 0.5`, `this.hpOn = ext && en[iHp] > 0`
(the minimum is off: a filter at 20 Hz would still move the detector — v3 at defaults must equal v2), SVF coefficients for `schp`
(`svfC`, the Utility's HPF pattern fx-mods2.js:899–910 [R]), `this.listen`. `run(R, L, Rc, o, m)`: when `ext`, the detector reads the key
at the block offset (§1.2): `kl = sc.kL ? sc.kL[sc.b + j] : 0, kr = …` through the HPF when `hpOn` (two SVF HP states, flushed in
`flush()`, cleared when `hpOn` turns on — `schp` modulated off its minimum and back would otherwise resume a stale state), `a = max(|kl|,
|kr|)` replaces fx-dsp.js:1083's `a` (`a = al > ar ? al : ar` [R]) for the **single-band detector and the Limit deque**; the look-ahead
line still carries the audio (`la[w] = xl`); the **Multiband band detectors keep reading the audio's bands** (§11: a keyed multiband is unusual, its crossover cost doubles; the UI dims
KEY in MULTIBAND). `ext` with `sc.kL === null` (no source connected: deleted, cyclic, the master) → the key is **silence** → no gain
reduction (never a fall-back to the audio: "no key = nothing to key" — Ableton's "No Input" and Pro Tools' empty key input behave so; the
"use my own signal" case is KEY INT, which the UI returns to when the source is set to none, §6.3 — a fall-back would make a deleted
source's compressor silently change character instead of visibly going idle). `listen`: the output is the (filtered) key × makeup, the
dry unchanged (MIX works). Mode crossfades (fx-dsp.js:1027–1032 [R]) unchanged. `meter` unchanged. No latency added. The key branch is
hoisted per block (`const K = this.ext === 1 ? sc : null`), so a v1 / v2 compressor's per-sample loop pays one predictable test at most;
G7 keeps the `cmp` bench row inside its existing target.

### 3.3 Persistence and the matrix
`sub.src` = the source track id (`''` none), `normSub('cmp', 3, S)` → `{ src }` (a string matching `/^trk_\d{1,9}$/` or `''`; v1 / v2
keep `{}`). `ext` / `listen` are `nomod: true` (switches); `schp` is a modulation destination like any knob (`fx.<inst>.schp`). Presets:
a module preset never carries a track id (`modulePresetPayload` → `blankSrc`, as the IR of a Convolve is kept but a track id is
meaningless in another project; every outbound path §1.3) and **applying one never clears the instance's own `sub.src`** (§5.1).

---------------------------------------------------------------------------------------------------------------------------------

## 4. The Ducker — type `'duck'`, variant 2, kind 22 (lanes D / U) [C]

### 4.0 Why an FX unit, not a modulator
A ModCore ENV cabled to a Utility's level would need another track's notes to gate this track's pseudo-voice (`MC.noteOn`, engine.js:4331
[R]), its output reaches a rack as a span-rate offset glided linearly across the call (mod-core.js:35–45; fx-dsp.js:2815–2829 [R]) — a
≤ 128-sample-quantised attack, no drawable curve, and only on tracks that have rows (ModCore is created on the first `{t:'mods'}`). The
unit is sample-exact, self-contained, works in every rack (a classic panel, a Serum's own FX, the master) and persists as FX state. A
"Trigger" modulator (another track's notes gating a per-note ENV) is a later idea, not this stage (§11).

### 4.1 Parameters (both tables verbatim, §5.1): on · **depth** (0 … 100 %, def 100 % — Q3) · **len** (10 … 4000 ms, pow2, def
≈ 250 ms) · **bpm** (bool, def on — Q2) · **lad** (DLY_LADDER 'fast' … '4 bar', def '1/8') · **att** (0 … 50 ms, def 1 ms) · **smooth**
(0 … 20 ms, def 2 ms) · **note** (enum 0 … 128: 0 = Any, k = MIDI note k − 1; def Any — Q1; nomod) · **level** (LVL2). `sub`: **`src`**
(the trigger track id, `''` none) and **`cv`** (the curve: a point list `[[x, y, c], …]` as the X-Shaper's, `normPts(S.cv, DUCK_DEFAULT,
false)`, ≤ 480 points, x = time 0 … 1 over `len`, y = gain 0 … 1 before depth). Shape presets `DUCK_SHAPES` (fx-core, exported for the
UI): **Classic** `[[0, 0, 0], [0.08, 0.04, 0], [1, 1, 0.55]]` (a hard dip, exponential-feel recovery — the default `DUCK_DEFAULT`),
**Linear** `[[0, 0, 0], [1, 1, 0]]`, **Hold** `[[0, 0, 0], [0.6, 0, 0], [1, 1, 0.3]]`, **Smooth** `[[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]]`
with c −0.4 / 0.4 on the two segments (an S), **Pump** `[[0, 0, 0], [0.3, 0.9, 0.7], [1, 1, 0]]`. (`bend(t, k)`, laws.js:127: c > 0 =
fast start.) No MIX row: depth is the mix. No velocity (S4).

### 4.2 DSP (`FXMods2.Duck`, fx-mods2.js, the module protocol fx-mods2.js:29–57 [R]; `kindOf` → 22 when `typeof M2.Duck === 'function'`)
State: **`pos`** (NaN idle, else the position 0 … 1 — not `ph`: the module protocol's `ph` is the Bode's phase field, "NaN for the
others", fx-mods2.js:53 [R]; it stays NaN and kind 22 is not in `phases()`, fx-dsp.js `phases()` [R]), `len` (samples, captured at the
trigger: a tempo change applies to the next hit), `g` (the current gain, 1 at rest), `tab` Float32Array(1025) (the FXT `cv` table, §5.2;
all 1 — no dip — until one arrives; the FXT travels with the FXP that creates the unit), `depth, attN, as` (the smoothing coefficient
`1 − exp(−1000 / (smooth · fs))`, 1 when smooth = 0), `noteF` (0 any / 1 + note), `lvl`. `upd(R)`: depth, `len = bpm ? beats(lad) · 60 /
R.bpm · fs : ms · fs / 1000` (the Delay's `R.bpm` pattern), attN, as, noteF, lvl (ramped per block as LEVEL is elsewhere). `run(R, L, Rc,
o, m)`: read the ring (§2.2; offsets from `sc.F + sc.b`); per sample j: a trigger at j → `g0 = g; a = 0; pos = 0; aN = attN` (a retrigger
restarts: S4); target `T = aN > 0 && a < aN ? g0 + (c0 − g0) · a++ / aN : pos < 1 ? 1 − depth · (1 − tabAt(pos)) : 1` with `c0 = 1 −
depth · (1 − tab[0])` and `pos += 1 / len` once the attack ramp is done (pos ≥ 1 → NaN); `g += (T − g) · as`, then **`if (pos !== pos &&
1 − g < 1e-9) g = 1` per sample** (skeptic #17: the one-pole never reaches 1 exactly, and a snap in `flush()` — at the call's end, whose
phase relative to the hit differs hit to hit — would leave G3's shifted hits different in their last ulps); `L[o + j] *= g · lv; Rc[o + j]
*= g · lv`. `tabAt(pos)` = linear interpolation of `tab` at `1024 · pos`. `meter(gr, o)`: `gr[o] = −20 · log10(max(g, 1e-6))` (reduction
dB), `gr[o + 1] = pos === pos ? pos : −1` (the playhead; `gr` is display-only — never saved, unlike `phases()` → `storePhases`,
main.js:2708 [R]), `gr[o + 2] = gr[o + 3] = 0`. `post()` writes the slots for `u.k === 22` as for 6 / 14 (fx-dsp.js:3189–3192 [R]).
`flush()`: nothing to flush (no feedback state). `tail()` → 0. `bytes()`: the table. Mix kind **0** (the unit produces its final output,
like EQ: `MIXK_T` gains a 0). No `idle()` — it is not in the module protocol (fx-mods2.js:29–57 [R]): the rack's quiet counter covers it
(a Ducker outputs zero for zero input; an enabled unit keeps the rack from `calm`, fx-dsp.js:3198 [R]). `reset()`: `pos` NaN, `g = 1`.
`seed()`: nothing. Latency 0 (`pathLat` unchanged).

### 4.3 Behaviour at the edges
No `src` / a gone or cyclic source / no registry (`sc.reg` null: resample, render-last, the preview) / a ring its writer has not stamped
this quantum: the unit passes its input (× level). A hit while a dip runs: restart from the current gain (no jump). `len` shorter than
`att`: the ramp still completes, then the curve. Depth 0: identity. A trigger exactly on a span boundary lands on offset 0 of the next
block — the same frame either way (the frame is absolute). **A skipped span hears nothing**: a track quiet for ≥ 2 s with its rack idle
skips the Inst and its rack (engine.js:3265–3279 [R]) — a hit inside a skipped span is not seen, so a note entering ≥ 3 s after the
track's last sound and *after* the hit, inside its dip, plays undipped (the same live and bounced; a note on the hit's frame starts the
span the hit is read in) — §11.

### 4.4 Where it lives
Every FX rack: a classic's panel, **a Serum's own FX (Q4, recommended yes: the same `FXRackUI`, the same compile, `rack.sc` set for the
Serum's rack too)**, and the **master rack** (MASTER writes its rack's `sc` per `part` — `q` = F0, `F` = F0 + o, `reg` = SCREG, `kL / kR`
null, engine.js:5136–5150 [R]: its Ducker fires from any track's notes — "the whole mix pumps with the kick" — and needs no edge: MASTER
is downstream of every track, every ring is stamped before it runs; a muted source of the master's Ducker is bounced at gain 0, §7.2). The
master's compressor has no key input: its KEY switch is disabled ("the master hears the whole mix"; `kL` null → silence anyway).

---------------------------------------------------------------------------------------------------------------------------------

## 5. Model, tables, persistence (phase 0: the lead; lane H keeps it) [C]

### 5.1 The tables — verbatim in all three files (tests compare them: tests/fx-dsp.test.mjs:2187–2193, fx-mods2.test.mjs:212–226 [R])
fx-core.js `FXTYPES` (:570–578): append `['duck', 'Ducker', [2], 'none', 0]` (index **16**); `cmp` → `['cmp', 'Compressor', [1, 2, 3],
'sin2', 0, 2]` — a sixth tuple element, field **`nv`** = the variant a new instance gets (default the highest; cmp's **2**; skeptic #1).
**Every place that picks "the highest" today picks `T.nv`**: `newInstance` (fx-core.js:1114), the factory builder `fxI` (:1473 — Glue /
Three Band Lift / Punch, the rack 'Mid / Side Width', the chain 'Vintage Space' stay v2), the unknown-variant fallbacks of `normalizeFx2`
(:739) and `payloadPS` / `applyModulePreset` (:1095, :1345) — so `recipe2` (serum-core.js:4463, through `newInstance`; 6 factory Serum
presets build a v2 compressor so) and every factory payload compile as today (no serum-core.js edit). `newInstance` with a preset whose `fv` is a
known variant above `nv` makes that variant (the factory 'Keyed Pump' → a v3: tests/fx-core.test.mjs:580–591 asserts that `newInstance`
applies every factory preset). `FXP_TAB.cmp[3] = s2Of('cmp', {…the v2 swap…}, [...the v2 extra six rows, R2('ext', 'Key External',
'bool', 0, 1, 0, 'bool', 0, true), R2('schp', 'Key HPF', 'exp', 20, 2000, 0, 'hz'), R2('listen', 'Key Listen', 'bool', 0, 1, 0, 'bool', 0,
true)])` — i.e. the v2 rows then the three. `FXP_TAB.duck = { 2: [ON2(), PCT2('depth', 'Depth', 1), R2('len', 'Length', 'pow2', 10, 4000, 0.2453, 'ms'), BOOL2('bpm',
'Length BPM', 1), R2('lad', 'Sync', 'enum', 0, 11, 6 / 11, 'enum:DLY_LADDER'), R2('att', 'Attack', 'lin', 0, 50, 0.02, 'ms'), R2('smooth',
'Smooth', 'lin', 0, 20, 0.1, 'ms'), R2('note', 'Note', 'enum', 0, 128, 0, 'enum:DUCK_NOTES', 0, true), LVL2()] }` (0.2453 → 250.1 ms; 0.02 →
1 ms; 0.1 → 2 ms; 6/11 → '1/8'). `DUCK_NOTES` exported: `['Any', 'C-1 (0)', … 'G9 (127)']` (129 labels) [R: fx-ui's `enumLabel` reads
`core[name]`, serum-core re-exporting fx-core — fx-ui.js:396–400, serum-core.js:94]. `DUCK_SHAPES`, `DUCK_DEFAULT`
(§4.1). `normSub`: `'cmp'` → `v === 3 ? { src: idOrEmpty(S.src) } : {}`; `'duck'` → `{ src: idOrEmpty(S.src), cv: normPts(S.cv,
DUCK_DEFAULT, false) }`. `upgradeInstance`: v1 → 2 as today; **`I.v === 2 && T.variants.indexOf(3) >= 0` → v3** (rows by pid: the same law
→ the value as it is; new rows their defaults; `sub = normSub(T.id, 3, S)`; a v1 still goes to 2 — one step a call; the test that a v2
of a type without v3 returns null, tests/fx-core.test.mjs:491, holds), used by the UI's from ▾ / "Add a sidechain key" and by
`applyModulePreset`: a v2 instance receiving an fv 3 payload upgrades first (as v1 + fv 2 today, fx-core.js:1346–1350 [R]); an fv 2
payload onto a v3 instance is upgraded (`payloadPS` want 3, :1095–1097); **the instance keeps its own `sub.src`** — today's `I.sub =
cloneJ(src.sub)` (:1356) would blank the key of a keyed compressor (and a Ducker's trigger) at every preset load (skeptic #14). The
module's `ext` follows the preset (a dynamics preset may be INT or EXT; the source stays). **`blankSrc(x)`** exported (an FX state, a rack
or a module payload → a copy with every `sub.src` = '', §1.3). Factory presets (tests/fx-core.test.mjs:595 asks ≥ 3 per type [R]):
`duck`: 'Kick Pump' (bpm 1, lad 1/8, depth 1, Classic), 'Gentle Side' (1/4, depth 0.6, Smooth), 'Gate Stab' (len 120 ms, bpm 0,
depth 1, Hold); `cmp` gains 'Keyed Pump' (fv 3, ext 1, schp 80 Hz, thr −20 dB, ratio 6, att 1 ms, rel 90 ms — `src` blank).
fx-dsp.js: `TYPES` + `'duck'` (:1913); `ROWS = TYPES.map(() => [null, null, null, null])`; `ROWS[T_.cmp][3] = ROWS[T_.cmp][2].concat([BOOL2('ext',
0), R2('schp', EXP, 20, 2000, 0), BOOL2('listen', 0)])`; `ROWS[T_.duck][2] = [ON2(), PCT2('depth', 1), R2('len', POW2, 10, 4000, 0.2453),
BOOL2('bpm', 1), R2('lad', ENUM, 0, 11, 6 / 11), R2('att', LIN, 0, 50, 0.02), R2('smooth', LIN, 0, 20, 0.1), R2('note', ENUM, 0, 128, 0),
LVL2()]`; `TAB` iterates `[1, 2, 3]`; `MIXK_T` + `0`; `MOD_OF_TYPE` gives −1 for duck (no S1); **`K_S2.duck = 22` is lane D's, not
phase 0's** (skeptic #15): `kindOf` returns `k` below 18 and lets every k above 20 fall through to the splitter kind (fx-dsp.js:2180 [R]:
`return typeof M2.XoverLH … ? 21 : −1`) — a phase-0 `K_S2.duck` would build a Ducker as a `SplitMod`; without it `K2` is −1 → `kindOf` −1.
Lane D adds `K_S2.duck = 22` with its case (`k === 22 → typeof M2.Duck === 'function' ? 22 : −1`) before the fall-through, and `v === 3 &&
t === T_.cmp → 14`. fx-mods2.js: `TYPES` + `'duck'`; `TAB.duck` = the same nine rows with `nomod: true` on `note`; `PIDX` follows.
`cv-cost.js` `COST.fx.duck = 0.0006` (a gain multiply and a table read per sample ≈ 2 × Utility; G7 calibrates). All of this is **phase 0**
(§9.0): data only, every pin green after it (a 'duck' instance before lane D passes its input: `kindOf` −1 → "kinds that cannot run pass
their input", fx-dsp.js:27–30 [R]; no v3 instance exists before lane D but one made from the factory 'Keyed Pump', which passes its input
too).

### 5.2 The compiled forms
`compile2` (fx-core.js:924–990 [R]): a new side array **`iSrc`** (`string[nI]`: `S.src` for cmp v3 and duck, `''` else) in the returned FXP
**only when some instance is a Ducker or a v3 compressor** — absent otherwise, so every other rack's `fxr` is today's object, key for key
(S1; an always-present `iSrc` would change the `chain` / `patch` payload of every rack canonical-stream hashes — skeptic #2); `okGraph`
(fx-dsp.js:3290–3297) treats a missing `iSrc` as all `''`; `graph()` sets `u.src = String(P.iSrc ? P.iSrc[i] : '')`. **FXT v2** gains
**`cv: [{ id, tab: Float32Array(1025) }]`** **only when the rack holds a Ducker** (`renderPts(I.sub.cv, 1024)`, the X-Shaper's renderer
laws.js:148 [R]); `fxtKeyOf` hashes Ducker points into the same running hash in walk order (`fnvPts(fnvStr(h, I.id), S.cv)`) and folds
their count in **only when there is one** (`nk ? fnv(fnv(h, nd), nk) : fnv(h, nd)`, fx-core.js:916–921) — a rack without Duckers keeps
today's key (it is in the FXP as `xsKey` and in the FXT) — so `postChain`'s `xsKey` dedupe (main.js:747–749 [R]) resends the FXT on a
curve edit; `rack.set(fxp, fxt)` calls `setCV(fxt.cv)` beside `setXS` (:2161): by instance id, kind 22 only, copied into the unit's table.
A `chain` message's `fxr` then carries `iSrc` (strings) — `sameVal` compares arrays of strings (main.js:653–666 [R]) so dedupe still works.

### 5.3 Schema 15 (cv-migrate.js)
`SCHEMA = 15`, `STEPS[14]` = the identity (`{…p, schema: 15}`) with the header line "15 stage SC: a 'duck' FX type and the compressor's
variant 3 (its sidechain key) in any rack's FX state — additive; a schema-14 build's `normalizeFx2` drops an unknown type (a Ducker:
fx-core.js:737 [R]) and reads an unknown variant as the highest it knows (fx-core.js:739 [R]: a v3 compressor becomes a v2, its key
rows and `sub.src` gone) and would autosave the loss: it opens a 15 read-only". `toV1`: Ducker instances removed and v3 compressors
written as v2 (the key dropped), one `lost` line per track "“<track>”: its sidechain (n Ducker(s), m keyed compressor(s)) — the live site
has no sidechain" (main's fx-core knows neither). Nothing new in `project` or a track: the sidechain is FX state (`deserialize`'s
whitelist untouched; History's `keepDevs` keeps it).

---------------------------------------------------------------------------------------------------------------------------------

## 6. UI (lane U: fx-ui.js; lane H: the hosts) [C]

### 6.1 The host member
`fxHost` (main.js:3395–3418) and `mfxHost` (:6347–6356) gain **`scSources()`** → `{ self: trackId | null, list: [{ id, name, drum: bool }]
(project order; two tracks of one name are told apart by their number in the list, "Kick · 3"), notes(id) → [{ n, name }] | null (a drum
machine source: `drumRowsOf(dev)` (roll.js; main.js:3 [R]) → its lanes' primaries and names, e.g. "Kick (36)" — the same primaries the
registry stores, §2.1; else null → the 128 notes with their names), ok(id) → '' | reason }` (`ok`: §1.4 `scCycle`, `self`); fx-ui treats
the member as optional (absent — serum-ui's embedded rack or a test host: the Key / Trigger selectors read "set it in the track's FX
module", disabled).
`host.gr()` is unchanged (the Ducker's slots §4.2).

### 6.2 The Ducker panel (`mod_duck(c, b)`)
Row 1: **TRIGGER** — a menu button "from ▾ <track name>" (`menu`/`contextMenu` from wk.js, the `instMenu` pattern) listing `scSources()`
with disabled entries and tooltips (`ok`), "— none —" first; **NOTE** — a menu "Any ▾" or the drum lane names when `notes(src)` gives
them (else octave-grouped notes); the two write `sub.src` / `p.note` through `this.edit` (knob policy, phase 'set'). Row 2: **DEPTH** knob,
**LENGTH** knob (ms; `steps: () => (c.on('bpm') ? 11 : 0)` and the SYNC ladder label when BPM — the Delay's `rate(c)` pattern,
fx-ui.js:1151 [R]: when BPM is on the knob edits `lad`, else `len`), **BPM** toggle, **ATTACK**, **SMOOTH**, **LEVEL**. Row 3: the **curve**
— a `CurveEditor` (graph.js:613; kind `'curve'`, height 96, `get` → `sub.cv`, `set` → `this.edit` on `sub.cv`, `shapes: this.shapes` — the
shared library, fx-ui.js:629 [R]) inline (not a popover: it is the module's face), a **SHAPE ▾** menu (Classic / Linear / Hold / Smooth /
Pump → writes `sub.cv`; "Custom" shown when the points match none), a **playhead** (the editor's own option: `playhead: () => phase |
null` draws a vertical marker on its overlay canvas, graph.js:598, 657–658, 1187–1191 [R] — no graph.js change; the panel passes it **and
drives the redraw from the rack's 30 fps `grLoop`** (`ed.drawOverlay()` on each tick) rather than starting the editor's own per-frame
animator for every Ducker shown) and a **GR bar** (`grCv`, drawn by `drawGr` as a single-band compressor's: the panel joins `grPanels()`,
the `grLoop` ticker, fx-ui.js:1921–1934 [R], drives both the bar and the playhead; nothing drawn while the rack is hidden). The editor gets
**no `zoom` option** (off by default, graph.js:567–569 [R]: native pinch only). The NOTE row's `enum:DUCK_NOTES` labels resolve through
fx-ui's `enumLabel` → `core[name]` (serum-core re-exports fx-core, serum-core.js:94; fx-ui.js:396–400 [R]). Width ≈ the Delay panel's. A
gone source: the button reads "— (track gone)" in the warning colour.

### 6.3 The Compressor v3 additions (`mod_cmp`, fx-ui.js:1167–1193 [R])
**A v2 panel** (every compressor until it is keyed — `nv`, §5.1) shows only the **from ▾** track menu after MODE ("Key: none ▾"); picking
a source upgrades the instance to v3 **in the same edit** (`upgradeInstance`, then `sub.src` = id and `ext` = 1; one `this.edit`, knob
policy) — the panel then rebuilds as v3. **A v3 panel**, row 0 after MODE: **KEY** seg `INT | EXT` (`c.sg('ext', …)`), the **from ▾** menu
(as §6.2), **KEY HPF** knob (`schp`, size sm), **LISTEN** toggle; picking "— none —" sets `ext` 0 (INT), so "EXT with no source" is
reached only when a source vanishes (then the menu reads "— (track gone)" in the warning colour and the GR bar stays flat, §3.2). The menu
is disabled when `scSources` is absent or `self === null` (the master: tooltip "the master hears the whole mix"); the group dims in
MULTIBAND (`c.vis(group, () => !c.on('mb'))`). v1 panels unchanged. The instance ▾ menu gains **"Add a sidechain key"** for `I.type ===
'cmp' && I.v === 2` (→ `upgradeInstance` v2 → v3, src empty, ext 0; the `upgrade(id)` path with a v3 check, fx-ui.js:2129–2147 [R]). A
module preset read back keeps fv 3 (fx-ui.js:304 [R] forces `fv: x.fv === 1 ? 1 : 2` today: a saved keyed-compressor preset would come
back a v2 — lane U accepts every known variant). Notices (`host.notify`): "Kick now keys Bass's Compressor", "Not connected: Bass already
ducks with Kick — a loop would need a delay".

### 6.4 The "+" menu and estimates
`addMenuItems` reads a **hard-coded list**, `ADD_EFFECTS` (fx-ui.js:234 [R], 13 ids sorted by id) — phase 0 inserts `'duck'` after
`'dist'` → "Ducker" between Distortion and Equalizer, in a rack and in a branch (the pin tests/fx-ui.test.mjs:181–190 → 14 effects, §9.3);
main.js's `FX_ITEMS` / `fxName` / `fxCost` do derive from `FXTYPES` (main.js:6762–6791 [R]: nothing to do there); the estimate reads
`COST.fx.duck` ("<1 %"). The Serum panel's own FX page (serum-ui.js:395–417, its adapter has no `scSources`) shows the selectors disabled
with the hint "set it in the track's FX module" — the canvas's FX module of a Serum (its own FX: `fxHost`, main.js:3530) carries them.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Export = playback, the bounce, the iPad (lane H; lane D for the engine side) [C]

### 7.1 Live
`mAlign(F)` (main.js:1705 [R]) rounds the anchor up to a quantum boundary while **the master holds an effect OR any rack holds a Ducker
or a v3 compressor with a source** (`scAny()`: computed on demand at the three anchor sites — a walk of the project's racks, negligible at
a ▶ — not a counter kept by `scSync`, which undo / load / a device removal would bypass). An empty project moves nothing (canonical-stream
unchanged). With it, a live start from a silent history is on the bounce's partition for the keyed tracks too (IMPL-M M2's reasoning: the
same call partition relative to the song).

### 7.2 The bounce (`bounceSet`, main.js:4666–4683 [R])
After the MIDI-OUT pass, a **closure pass** (skeptic #7) over two kinds of edge until stable, seeded by every `tr` in `want` **and by the
master** (its rack's Ducker sources — a muted kick driving the master's Ducker is a ghost too): (a) for every `src` of **`scWant(x)`** — the
model-level set (§1.1), never `scSrcs`, whose "has a node" term would be empty with the power off (`bounce()` never powers on,
main.js:4703–4728 [R]) — not yet in `want`; (b) for a source so added that has no notes of its own, every track whose MIDI OUT targets it
and has notes (the MIDI-OUT pass adds only *audible* targets, main.js:4678 [R]: a muted kick driven by a sequencer track's MIDI OUT was
never there). Each is added `want.set(x, audible(x) ? x.vol : 0)` when it can sound or send notes (`x.notes.length || syncedOf(x)` or
(b)) — **the ghost kick renders at gain 0** (muted or unsoloed), audible sources at their fader as today. Each item carries **`sc:
scWant(tr) ∩ want`** with each edge's gain (1 / 0 as §1.1), and `bounce()`'s item builder (main.js:4714–4721 [R]: it copies named
fields) forwards `sc`. `renderOffline` (main.js:3003–3045): after the item loop, for each item with `sc`, `byId.get(src).node →
kg → node` (nodes exist by then; `byId` built in the loop), and its `numberOfInputs: 1` options (§9.1). `processorOptions` unchanged.
Resample / render-last (one Serum alone) pass no items with `sc`: a Ducker there idles (§11). The dialog's note gains nothing; the
user's standing "Same as playback" default applies.

### 7.3 Exactness
Live ≡ offline bit for bit for a keyed / ducked track when: the same source items, a quantum-aligned start (§7.1), a silent history
(IMPL-M §11's class: ≥ 0.25 s of exact zeros; a compressor's release not running; **no Ducker dip running** — a live key hit just before
▶ leaves one running into the song, the bounce starts idle), the same rate / oversampling ("Same as playback"). The
key arrives in the same quantum both ways (S2); the Ducker's offsets are absolute frames relative to the shared anchor (S3). G5 asserts
it on the sim; reviewer 2 in Chrome.

### 7.4 The iPad / WebKit / the presets
WebKit renders an input-bearing worklet (§0: MASTER in the installed app); a **worklet → worklet edge among Track nodes** is not yet
exercised on WebKit [R?] — reviewer 2 also opens the local preview in Safari on the Mac (WebKit) and plays a keyed project (the lead's
check if Safari is not scriptable; the user's consolidated iPad pass later). Cost per keyed track: the browser's input mix (a 2 × 128 add)
+ the key copy (2 × 128 doubles) + the unit (§4.2 ≈ 2 × Utility; a keyed compressor ≈ the compressor + an SVF pair) — G7's rows; no
performance-preset lever (visual only, ROADMAP 14). **The input is on every Track node, keyed or not** (skeptic #16): one MASTER with an
input proves WebKit renders it, not what 100 input-bearing nodes cost there (the per-quantum input marshalling of WebKit's
AudioWorkletProcessor — empty or zero-filled, arrays reused or not [R?]). Reviewer 2 measures it in Safari on the Mac: a 64-track project
(p1's tracks duplicated), no sidechain unit, the engine's summed `stats.load` on this build vs the base (91a859a), three runs each —
**gate: ≤ +2 % relative**, and one GC-free minute (no audible drop). **Fallback if it fails** [C]: inputs only on the nodes that need one
(`scWant` non-empty, or keyed in the bounce) — a node gaining its first key is rebuilt by `syncNodes` (bye + a fresh node: its tails and
held keys go, one click, at the moment a source is first picked; the bounce builds every node fresh anyway); the lead decides with the
numbers.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Gates

| gate | what | target |
|---|---|---|
| **G1 no sidechain = today (S1)** | every golden file (13 golden-*.test.mjs) after every engine.js / fx-dsp.js / fx-mods2.js edit; canonical-stream (both parts, the fixtures untouched); canvas-M-bounce (ref-M's three hashes, through the new main-sim and Track inputs); engine-track's warm-up hash; node: a Track with `inputs` `[]`, `[[]]`, `[[L, R]]` (connected, no unit asking) → output identical to the base's for the same program (30 s random notes on a classic / a Serum / a drum machine); a project-p1 live run (`sim.run`) per-node outputs byte-identical to the base build's (recorded by the lead from 91a859a into `tests/ref-SC/live-p1.sha`, the ref-M `REC=` pattern); **the factory content unchanged** (`FACTORY_FX_PRESETS` but the new entries, `FACTORY_RACKS`, `FACTORY_CHAINS2` and every `FACTORY_PRESETS` FX state deep-equal to the base's — no v3 compressor from `nv`); `compileFx` / `compileFxT` of every factory state and of p1's racks → objects with no `iSrc` / `cv` key and today's `xsKey` / FXT key (S1 #2) | exact |
| **G2 the key (S2)** | node, two Tracks in one scope (tests/sidechain-dsp.test.mjs): a cmp v3 `ext` on a steady −12 dBFS tone keyed by a kick track → GR follows the kick (≥ 6 dB dips at the hits, < 0.1 dB between); `ext 0` ≡ the same v2 instance bit for bit (random programs × 100, the S2-equivalence pattern); `schp` at its minimum ≡ no filter bit for bit, at 200 Hz a 50 Hz key tone compresses > 12 dB less than a 1 kHz one; `listen` outputs the key; MULTIBAND ignores `ext`; `sc.kL === null` with `ext` → no GR; the key edge reaches `inputs[0]` as `[L, R]` in the sim; **a v2 compressor upgraded in place while running** (the from ▾ edit → `{t:'chain'}` on the same node) keys from the next call and its state carries over (no reset: the output before the upgrade ≡ the v2 reference, after it the GR follows the key), and a bounce of the same project keys identically (skeptic #3); a keyed compressor **in a splitter branch and on a Serum's BUS 1** reads the key at its block offset (a key impulse at frame f moves its GR at f, not at the call's first block, skeptic #5); the stated-dB cases give thr / ratio (a −6 dBFS key, thr −20 dB, ratio 4) | exact / stated dB |
| **G3 the Ducker (S4)** | node (fx-mods2.test): a trigger at frame f with att 0, smooth 0 → `g` leaves 1 at sample f exactly and equals `1 − depth·(1 − tab(pos))` per sample (≤ 1e-6 of the table's float32); shift invariance (a trigger at f and at f + 1000 → shifted-identical outputs, 0 samples differ); every hit identical over 16 hits ≥ len apart; `bpm` on → `len = beats · 60 / bpm · fs` ± 1 sample for '1/8' at 90 / 124 / 174 bpm; a retrigger mid-dip restarts; NOTE filter (36 passes, 38 dropped); velocity ignored (v 0.1 ≡ v 1.0); depth 0 = identity; no allocation per quantum; `gr[4i]` / `gr[4i + 1]` as §4.2; shift invariance **with smooth 2 ms and att 1 ms** (the defaults: the recovery's per-sample snap, skeptic #17), the two triggers 1000 frames apart in different call phases; a Ducker in a splitter branch and on a BUS rack triggers at its frame (skeptic #5); `sc.reg` null → identity × level | exact |
| **G4 the registry and ordering (S3)** | node, two Tracks: the source's song note at frame f → the keyed Ducker triggers at offset f − F0 of the same quantum (both orders of construction; processed source-first); a message-time `{t:'on'}` on the source → the next quantum's offset 0; no `trackId` → no ring; `bye` removes it; a Serum arp's generated note, a 303 synced step (not a tie), an 808 pattern step (per sound through `drNote`, the BD's primary 36) and a drum note through its map (a muted lane: no trigger) each fire once; 65 note-ons in a quantum → 64 kept; a reader processed **before** its source in a quantum (the sim's order forced wrong) drops the hit — never a quantum late; **an 808 step with BD + SD → entries 36 and 38: NOTE 38 fires on it** (per-sound hook), a 909 flam's second hit fires again, a piano-roll note 35 on the 808 is stored as 36 (skeptic #6); a reader before its writer drops message-time and song hits alike (`ring.q`, skeptic #12); a node rebuilt under the same id (bye of the old after the new's constructor) keeps its ring | exact |
| **G5 export = playback (S3) and the ghost kick (S2)** | sim (tests/canvas-SC-sim.test.mjs): a 2-track project (an 808 with its demo pattern keying a Juno bass through a Ducker and a keyed v3 compressor): live run from a quantum-aligned ▶ after 0.5 s of silence ≡ the bounce, per-node, bit for bit; the bass's node output identical with the 808 **muted** / soloed-out / fader 0 (live: `mix()`; offline: `bounceSet` adds it at gain 0) and the bounce's mix equals the unmuted one minus the kick's own audio within one float32 rounding; `bounceSet` with A keys B keys C (C muted, B muted): both come at gain 0; `renderOffline` builds the edges; `mAlign` only with a sidechain unit; a source deleted / undone: no throw, the edge back after undo; **a muted 900 Series kick** keys live (its patch stays on: `ptPower`, skeptic #4) and in the bounce, identically; **the bounce with the power off** keeps the ghost kick (`scWant`); a muted kick **driven only by another track's MIDI OUT** and a muted kick driving **the master's Ducker** are bounced at gain 0 (skeptic #7); main-sim's offline render records per-node outputs for this comparison (lane H: `sim.lastOffline.out`, the live run's `out(n, …)` hook) | exact |
| **G6 cycles (S5)** | sim: A → B → A refused in `scSources().ok` and by `scSync` (notice text, no `connect` call); a self-key refused; A → B → C allowed and ordered; the sim's `disconnect(n, 0, 0)` removes one edge only; **a deleted keyed track leaves no edge into its node** (`s.outs` has no `kg` to it) and its processor ends (skeptic #8); a Ducker-only edge has gain 0 and a compressor on the same track hears only its own source (skeptic #11); an FX change through any path (device removed, model change, Serum preset, undo) re-syncs edges via `sendPatch` (skeptic #10); deleting the highest-numbered source then adding a track gives the newcomer a fresh id (skeptic #13) | exact |
| **G7 CPU** | bench rows (kind 'fx', bench-scenarios.mjs:508–519's pattern): `sc-duck` (one Ducker on noise, a trigger every 0.25 s from a hand-filled ring), `sc-key` (a cmp v3 ext on noise with a key buffer) — node / jsc, targets in bench.json: `sc-duck` ≤ 0.002, `sc-key` ≤ 1.1 × the cmp row; the registry read with 0 / 8 / 64 entries ≤ 1 µs / 2 µs / 8 µs per block (node); the per-span key copy ≤ 0.2 µs; the existing `cmp` row unchanged within its target (the key branch, §3.2); the floor projection (IMPL-P's factor) for `sc-duck` / `sc-key`; the warm-up covers the new paths (FXRack.warmUp: a Ducker with a hand-filled ring, a v3 compressor with a key — the 2b JSC-tiering lesson; engine-track's "the warmed-up first Track = a fresh one" still holds) | recorded, within targets |
| **G8 UI (reviewer 2, headless Chrome 1440 × 900 / 1366 × 1024 / 1024 × 1366 touch dpr 2)** | the Ducker panel (menus, the inline curve editable by touch-emulated drags, SHAPE presets, the playhead moving at ▶, the GR bar), the compressor's KEY group and its dimming in MULTIBAND, "Add a sidechain key", the "+" menu's "Ducker <1 %", a Ducker in a Serum's own FX rack and on the master, a refused source (disabled item + notice), the muted kick still pumping (the destination's recorded signal: the bass envelope dips at the kick times within 2 samples), a real bounce with the kick muted containing the dips, a power cycle and a sample-rate change keep the edges, no console error; Safari on the Mac plays a keyed project (§7.4); **Safari on the Mac, 64 tracks, no unit: engine load ≤ +2 % vs the base** (§7.4, skeptic #16); a v2 compressor's "Key: none ▾" → a source → v3 with EXT on; a saved keyed-compressor preset comes back v3 (fx-ui.js:304) | pass |
| **G9 schema and files** | cv-migrate: 15, STEPS 15, "a newer file" 16; a project with a Ducker saved by this build opens read-only in the base build (the stage-P / M pattern); `toV1` lost lines; a 14 file opens unchanged; the fx-core pins (variants, ≥ 3 presets, tables); **outbound payloads carry no `sub.src`** (module / rack / chain presets, a Serum user preset, the module default; the rack clipboard keeps it within a project and blanks it in another), applying a preset keeps the instance's `sub.src` (skeptic #14) | exact |

---------------------------------------------------------------------------------------------------------------------------------

## 9. Lanes, interfaces, pins

### 9.0 Phase 0 — the lead (Fable 5.1), before the builders: **the model commit** (≈ 200 lines, data and fx-core rules)
fx-core.js (§5.1: FXTYPES with **`nv`** and every "highest" site → `T.nv` (:739, 1095, 1114, 1345, 1473), FXP_TAB cmp[3] / duck[2],
DUCK_NOTES / DUCK_SHAPES / DUCK_DEFAULT, normSub, `upgradeInstance` v2 → v3, `applyModulePreset` (fv 3 onto v2, want 3, **the instance's
`sub.src` kept**), **`blankSrc`**, `compile2` iSrc **when a unit exists**, `compileFxT` cv + `fxtKeyOf` **with the no-Ducker key
unchanged**, the four factory presets), fx-dsp.js tables only (TYPES, ROWS incl. `[null × 4]`, TAB `[1, 2, 3]`, MIXK_T — **not `K_S2.duck`**,
§5.1 — no behaviour), fx-mods2.js tables only (TYPES, TAB.duck, PIDX), cv-cost.js (`COST.fx.duck`), cv-migrate.js (SCHEMA 15, STEPS[14],
toV1), **fx-ui.js's `ADD_EFFECTS` + `'duck'`** (one data line, fx-ui.js:234: the pin below moves with it; a Ducker added before lane U
shows "This module type has no panel", fx-ui.js `buildPanel`, and passes its input), and the pins they move: tests/fx-core.test.mjs (:28 the
17 ids; the factory loop :580–591 with 'Keyed Pump'), tests/fx-dsp.test.mjs:254 / 2187 (derived — green), tests/fx-mods2.test.mjs (TAB keys:
`RUN_HERE` + 'duck'), tests/cv-cost.test.mjs (derived), tests/cv-migrate.test.mjs (**every** 14 / 15 pin of the six stage blocks —
:32, :1056–1069, :1147–1160, :1233–1247, :1330–1345, :1474–1489: SCHEMA / STEPS.length 14 → 15, the "through …" upgrade lists gain 15,
the read-only arrays gain 16), the schema pins **canvas-8-sim:418, canvas-9-sim:447, canvas-M-sim:334 / 348** (canvas-7b / 7c read
`SCHEMA + 1`: derived; canvas-9b-sim has none), tests/fx-ui.test.mjs:181–190 (14 effects: 'Ducker' after 'Distortion'; a branch menu 14).
Every test green after phase 0 (a 'duck' instance passes its input until lane D; no compressor becomes v3 by itself). Then:
`tests/ref-SC/live-p1.sha` recorded **from 91a859a** (the pre-phase-0 tree, extracted to the scratchpad: the REC= pattern; G1).

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **D** DSP + engine | 1 | `fx-dsp.js` (Comp's key path §3.2; `kindOf(t, 3)`; `newMod` 22 → `M2.Duck`; `runMod` case 22; `post()` gr for 22; `setCV`; `okGraph` iSrc optional; `graph()` `u.src`; the rack-owned `sc` object, §1.2), `fx-mods2.js` (`Duck` §4.2), `engine.js` (SCREG, `scR`, `scOn`, the hooks §2.1 incl. `drHit`'s primary and `Inst.drNote`, the ring compaction and `q` stamp, the key copy, the rack's `sc` fields per span incl. Serum / dying racks and MASTER's, `end()`'s identity check), **`dr-seq.js`** (the per-sound `I.drNote(q, v)` call in `fire` and `hook`, §2.1 — hooks only, the drum goldens bit-identical), fx-dsp's `graph()` growing a Unit in place v2 → v3 (§3.1), the rack's `sc` object and `b` per block (§1.2), `kindOf` cases for v3 and 22, `tests/sidechain-dsp.test.mjs` (new), `tests/fx-dsp.test.mjs` (G2 cases), `tests/fx-mods2.test.mjs` (G3), `tests/engine-track.test.mjs` (G1 inputs cases), `tests/bench-scenarios.mjs` + `tests/bench.json` (G7 rows / targets) | G1 (node part), G2, G3, G4, G7 | Fable 5.1 |
| **U** UI | 1 | `fx-ui.js` (§6.2–§6.4; the v2 panel's from ▾ upgrade; fx-ui.js:304 keeps fv 3; `blankSrc` on the module / rack / chain store paths fx-ui.js:2162–2194; `ADD_EFFECTS` is phase 0's), `style.css` (a block appended last: `.fxr-m-duck …`), `tests/fx-ui.test.mjs` (the panel with a stub `scSources`; `mod_cmp` v3; the menu item; no fake-DOM nodes in `assert`) | the panel's API, the menus' disabled items, the GR / playhead draw path with a fake `gr()` | Opus 5.5 |
| **H** host | 2 (after D's `sc` / registry contract — stubs allowed earlier: the sim needs only the processor's behaviour) | `main.js` (§1.1 node options live + offline, `N.scIn`, `scWant` / `scSrcs` / `scSync` / `scAll` / `scCycle` / `scKeyed` / `scAny`, `syncNodes` → `scAll`, `sendPatch` → `scSync` (§1.1), the GainNode edges, `syncNodes`'s drop loop cutting incoming edges, `ptPower` / `mix()`'s `ptHeard` with `scKeyed` (§1.3), fresh track ids at the three `S.newTrack` callers, `blankSrc` in `sxSave` / classic presets / the rack clipboard across projects, `mAlign` §7.1 with `scAny()` on demand, `bounceSet`'s closure + `bounce()`'s items forwarding `sc` §7.2, `renderOffline` edges, `fxHost` / `mfxHost` `scSources()`, notices, `__synthTest.sc` hooks), `tests/main-sim.mjs` (`connect(n, o, i)` args accepted; **selective `disconnect(n, o, i)`** removing one edge, `disconnect()` all as today; the offline render's per-node outputs recorded for G5), `tests/canvas-SC-sim.test.mjs` (new: G5, G6, the §1.3 lifecycle), `tests/main.test.mjs` / other sims if a pin reads `numberOfInputs: 0` (by design → 1) | G5, G6, G1 (sim part) | Opus 5.5 |
| reviewers × 2 | 3 | (1) **real engine**: S1–S5, G1–G7, the goldens, a 100-track project with 20 keyed tracks (CPU, no throw), the ghost kick, an unaligned start (measured, the IMPL-M G2 (b) class); (2) **headless Chrome**: G8, G9's read-only check in the base build, Safari on the Mac if available | — | Fable 5.1 / Opus 5.5 |
| fixers | after | the finding's files, failing test first | | Sonnet / Opus |

### 9.1 Interfaces (fixed here)
- Node options (every Track node, live + offline): `{ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
  channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions }` — `processorOptions` **unchanged** (S1).
- Edges (live + offline): `src.node → kg (GainNode) → keyed.node` (input 0); `kg.gain.value` 1 when a v3 compressor of the keyed track
  names src, else 0 (ordering only). Live record `N.scIn: Map<srcId, { s, kg }>`.
- Registry: `SCREG: Map<trackId, { q, n, f: Float64Array(64), note: Uint8Array(64), vel: Float32Array(64) }>` (engine.js scope level);
  `Track.scR`, `Track.scOn(n, v)`; entries `f` absolute frames; compacted to `f ≥ F0` and stamped `q = F0` at the top of each `process`;
  deleted by `end()` only when still its own. Drum hits are stored as their sound's primary note; DrSeq calls the optional
  `I.drNote(q, v)` per sounding lane (dr-seq.js `fire` / `hook`).
- The key context: **`rack.sc`, an object each `FXRack` owns from construction** `{ q, F, b, reg, kL, kR }` — `q` F0 of the quantum, `F` the
  absolute frame of the call's sample 0, `b` the current block's offset in the call (the rack writes it per block), `reg` SCREG or null
  (no `trackId`), `kL / kR` Float64Array(128) | null (`kL[c]` aligned with the call's sample c). The Track (and MASTER, `kL` null) writes
  `q F reg kL kR` before every rack call (c0, chains, Serum `fxc.rack`, dying racks); a `Unit` copies the reference at construction. A
  unit's block sample j is frame `F + b + j`, key `kL[b + j]` — never via its own `o`.
- FXP: `iSrc: string[nI]` **only when a Ducker or a v3 compressor exists**; FXT: `cv: [{ id, tab: Float32Array(1025) }]` **only when a
  Ducker exists**, `key` covering Ducker points (unchanged without one). `FXRack.setCV(cv)`.
- fx-core: `FXTYPES[i].nv`; `blankSrc(x)`; `upgradeInstance` one step (1 → 2, 2 → 3).
- `gr` slots for kind 22: `[4i]` reduction dB, `[4i + 1]` position 0 … 1 or −1, `[4i + 2..3]` 0.
- Host ↔ UI: `host.scSources()` (§6.1), optional. Hooks: `__synthTest.sc = { want(t), srcs(t), sync(t), all(), cycle(t, id), keyed(t),
  any(), edges(t) }` (`edges`: `[[id, gain]]` of `N.scIn`).
- Messages: none new. `{t:'chain'}` / `{t:'patch'}` payloads carry `iSrc` / `cv` inside `fxr` / `fxrT` only when a rack holds a unit (S1).

### 9.2 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time with
`--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`); builders in worktrees reset to the
phase-0 commit; every engine.js / fx-dsp.js / fx-mods2.js / dr-seq.js edit re-runs every golden file (bit-identical) before the lane's notes
commit; no iPad app build or install in this stage (browser first, CLAUDE.md) — the app's node tests stay in the sweep.

### 9.3 Pins that change by design
tests/fx-ui.test.mjs:181–190 (13 → 14 effects, the branch menu 14, 'Ducker' between 'Distortion' and 'Equalizer'); tests/cv-migrate.test.mjs
(every 14 / 15 pin of its six stage blocks, §9.0); tests/fx-core.test.mjs:28 (16 → 17 ids); tests/fx-mods2.test.mjs `RUN_HERE` + 'duck';
canvas-8-sim:418, canvas-9-sim:447, canvas-M-sim:334 / 348 (14 → 15, "a newer file" 15 → 16; canvas-7b / 7c read `SCHEMA + 1`). No test
pins a Track node's `numberOfInputs` (canvas-M-sim:103, 219 pin MASTER's) — none moves. **Not changed**: canonical-stream's two
fixtures, ref-M, every golden, the factory content (`nv`), app.test's 18 modules (no new DSP file), the DSP lists.

### 9.4 Docs (the lead, at the end)
ROADMAP row 17 (done + the user's answers); HANDOVER (§4: the registry, `rack.sc`, the key edge, schema 15, S1's proof set, `nv`; §5:
the lessons — `graph()` keeps a unit by kind and type, so a variant that keeps its kind must grow its Unit; units in BUS racks and branches
run at `o = 0`; a factory payload built with "the highest variant" moves when a variant is added); SPEC-canvas
(the FX panel: the Ducker, the compressor's key, one key input per track); `tests/ref-SC/` frozen at acceptance (G1's live-p1 from the
base; the Ducker's and the keyed compressor's outputs for fixed programs, the moog-b `{note, commit}` way, `GOLDEN_FREEZE_SC=1`).

---------------------------------------------------------------------------------------------------------------------------------

## 10. Questions for the user (plain words; the recommended option first)
- **Q1 Which notes trigger the Ducker?** (a) **Any note of the chosen track**, with a NOTE setting you can narrow to one drum (e.g. only the
  808's kick lane — the menu names the lanes) — recommended: a dedicated kick track just works, a full kit is one tap away; (b) when the
  source is a drum machine, start on its kick lane automatically.
- **Q2 The default dip length**: (a) **tempo-synced, an eighth note** (it follows the song's tempo; still switchable to milliseconds) —
  recommended; (b) a fixed 250 ms.
- **Q3 The default dip**: (a) **100 % with the Classic shape** (the track drops out fully at the hit and swells back — the classic pump) —
  recommended; (b) 60 % (a gentler default; 100 % stays one knob away).
- **Q4 Serum's own FX rack too?** (a) **Yes** — the Ducker and the compressor key in a Serum's own effects as in a classic's panel (the same
  rack, no extra cost) — recommended; (b) classic panels and the master only.

## 11. Known limits (recorded)
- **One key input per track**: a compressor's external key is the **sum** of every source the track's **compressors** name (a Ducker's
  source enters through a gain-0 edge: order only, §1.1); two keyed compressors in one track that name different tracks both hear the sum
  (a cap-free alternative to input slots, §1.1). The Ducker is per-unit exact (the registry is per source).
- **MULTIBAND ignores the external key** (its bands read the audio); the UI dims KEY in that mode.
- **No key input on the master rack**: its compressor is INT only; its Ducker works (the registry).
- **A 900 Series' own 960 sequencer steps** are not note-ons (the controller's keys and the piano roll are); a TB-303 tied step (legato)
  is not a new hit; a Serum step that re-holds a held key is not a new hit (sx-seq's rule).
- **Live keys / MIDI** trigger at the start of the next quantum (≤ 2.7 ms at 48 kHz); the bounce has none.
- **Exactness** live ≡ bounce needs a quantum-aligned start (`mAlign`, automatic while a sidechain unit exists) and a silent history
  (IMPL-M §11's class); a compressor still releasing at a seek differs (the IMPL-M R1-2 class).
- **No velocity, no MIX** on the Ducker (S4: the same every hit; DEPTH is the mix). A tempo change applies from the next hit.
- **Resample / render-last** render one Serum alone: a Ducker in its own FX rack idles there (no source track in that context).
- **64 note-ons per quantum per track** are kept (a 65th is dropped) — a hand on 64 keys inside 2.7 ms.
- **A worklet → worklet edge among Track nodes on WebKit** is proven indirectly (MASTER's input) and by Safari on the Mac (G8: a keyed
  project plays, 64 input-bearing tracks cost ≤ +2 %) until the consolidated iPad pass [R?].
- **Cycles** are refused (Web Audio needs a DelayNode in a feedback cycle); "A keys B and B keys A" is not offered — mutual Duckers
  (A ducks from B's notes, B from A's) included: each quantum has one order.
- **A muted lane of a kit drives nothing**: the drum machine's own MUTE / SOLO take the lane out of the plan (drum-core.js `audible`) and
  `drHit` returns before the hook — the ghost kick is the **track's** mute / fader / solo; a kit whose kick must stay silent but duck keeps
  the kick on its own track. (Left for the lead: whether a lane mute should still trigger — a DrSeq `prim` pass over the unmasked step.)
- **The Ducker follows the source's notes, not its delayed audio**: a source whose own rack has latency (a Limit look-ahead ≤ 10 ms, a
  Distortion's 15 samples) sounds that much after its dip starts (SYNTH has no per-track delay compensation); the keyed compressor hears the
  source's audio as it leaves its node, latency included.
- **A skipped span hears nothing** (§4.3): a note entering ≥ 3 s after its track's last sound, after a hit and inside its dip, plays
  undipped — live and bounced alike.
- **A source change** (a pick in the menu) takes effect when the new FXP lands (the next frame); for those few quanta the old source's hits
  are dropped, never misplaced (`ring.q`, §2.0).
- **Which note-ons are hits**: every note a sound starts — a mono / legato Serum note included (its allocator restarts the note); a TB-303
  tied step is not (it never reaches `noteOn`).
- **A later idea, not here**: a "Trigger" modulator (another track's notes gating a per-note ENV on any knob); a dedicated multi-input
  key bus; velocity-scaled depth.

## 12. Notes (the builders fill in)

## 13. Review log

### The skeptic review (2026-10-24, against the draft)

Every claim about existing code was read at 91a859a (`canvas`, read only); one read-only script listed the factory Serum presets'
compressors (`node --max-old-space-size=1024`, scratchpad); no test was run. Severity as IMPL-M §13: **P1** a contract contradiction or
an impossible / circular gate, **P2** a gap a builder would trip on, **P3** a correction. **Settled and not reopened**: the scope paragraph
(both kinds, the ghost kick), no artificial caps, visual-only presets, canvas only, browser first (no iPad app work; its node tests stay in
the sweep), Q1–Q4 (being asked — untouched).

**The questions, answered.** (1) **Bit-identity** as drafted was false twice over: "new instances get the highest" puts a v3 compressor
into every factory payload — 6 Serum presets (canonical-stream loads 'Thru-Zero Growl'), the module / rack / chain presets — and in phase 0
those v3s would even pass their input (#1); `iSrc` / FXT `cv` / the key's count were unconditional in §5.2 against §9.1's "only when a
project uses the units" (#2). Fixed with `nv` and conditional fields; the input on every Track node changes no sample (unconnected `[]` /
`[[]]`; main-sim's `paths()` / `procOrder` / `quantum()` already model the edge; no test pins a Track's `numberOfInputs`; canonical-stream
records no node options). (2) **Routing**: the same-quantum order is the spec's and both engines' (pull-first) — fine; but a deleted keyed
node stays fed and alive (#8), the edge sync missed every FX path but `fxEditDev` (#10), a Ducker-only edge polluted a compressor's key
(#11), `N.sc` was taken (#9). Cycles: the DFS is right; the refused reader is now provably idle (#12). (3) **The registry**: one scope per
context — fine (main-sim mirrors it); the four leaves cover piano roll / keys / MIDI / MIDI OUT / the arp / the 303 / the 900 Series'
keys, but a drum step reports one lowest note and `drHit` the played note — the NOTE filter could not name a lane (#6); the 900 Series is
powered off when muted (#4); order guard (#12). (4) **DSP**: the Ducker's flush-time snap breaks its own shift-invariance gate (#17); a unit
in a BUS rack or a splitter branch reads the key and frame at the wrong block (#5); v2 → v3 in place never engages (#3). **"No key =
silence"**: kept — it is Ableton's "No Input" and Pro Tools' empty key; "use my own signal" is KEY INT, which picking "none" now selects
(§6.3); a fall-back would hide a deleted source behind a changed sound. (5) **Export = playback**: the bounce's closure missed the power-off
case, MIDI-OUT-driven sources and the master's Ducker, and `bounce()` drops unknown item fields (#7); `mAlign`'s counter → on demand (#23).
(6) **CPU**: the DSP rows are fine; the untested cost is WebKit's input marshalling on every Track node (#16). (7) **UI**: `ADD_EFFECTS` is
hard-coded (#18); the playhead / enum hooks exist (#20); duplicate names, "none" → INT (#29). (8) **Lanes**: dr-seq.js was unowned (#6),
phase 0 had a `K_S2` trap (#15), its pin list was short (#21).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **"New instances get the highest" makes every factory compressor a v3.** `newInstance` and the factory builder `fxI` take `T.variants[last]`; `recipe2` builds the factory Serum presets' FX through `newInstance` — 6 of 86 build a v2 compressor that way (9 more hold S1 ones), among them 'Thru-Zero Growl', the preset canonical-stream's session loads (its `fxr` / CP `fxKey` would change: main's fixture fails); the module presets Glue / Three Band Lift / Punch, the rack 'Mid / Side Width' and the chain 'Vintage Space' too. In phase 0 (`kindOf(t, 3)` −1) those compressors would pass their input — a sound change (tests/presets2.test.mjs renders those presets; golden-graph compares two forms of one build and would not see it); and `normalizeFx2`'s unknown-variant fallback moves too | fx-core.js:739, 1095, 1114, 1345, 1473, 1511–1513, 1563, 1572; serum-core.js:4463, 4561–5012; tests/canonical-stream.test.mjs:72 (`sx.presets[3]` = 'Thru-Zero Growl', its FX `split2, cmp v2`); tests/fx-core.test.mjs:580–591 | **fixed in S1, §0, §3.1, §5.1, §6.3, §9.0, G1**: `FXTYPES[i].nv` (cmp 2) at every "highest" site; a compressor becomes v3 when keyed (the v2 panel's from ▾ upgrades in one edit); a preset of a higher known `fv` makes that variant ('Keyed Pump') |
| 2 · P1 | **§5.2 contradicted S1 / §9.1**: `iSrc` in every FXP, `cv` in every FXT and a Ducker count folded into every `fxtKeyOf` would change the `chain` / `patch` payload (and `xsKey`) of every rack canonical-stream hashes | fx-core.js:916–921 (`hex(fnv(h, nd))`), 924–990, 1015–1024; main.js:747–749 | **fixed in §5.2, §9.1, G1**: each only when the rack holds a unit; the key's count folded only when nk > 0; G1 asserts factory / p1 compiles carry no new key |
| 3 · P1 | **A v2 compressor upgraded in place never keys live.** `graph()` keeps a unit by kind and type (`u.k !== k \|\| u.t !== t`): v2 → v3 is kind 14 → 14, type 5 → 5, so the 18-row Unit survives; its typed arrays cannot hold rows 18–20, `ext` never reaches `ev`; a reload or a bounce (fresh units) keys — export ≠ playback. With #1's fix every keyed compressor takes this path; G2 built v3s fresh and could not see it | fx-dsp.js:2223–2227, `class Unit` (arrays sized by `rows.length`), `states()` (a fresh Unit at `st 0` resets + fades) | **fixed in §3.1, §9 D, G2**: the Unit grows in place when `u.v !== v` with the same kind — arrays re-made, shared rows' state, module and enable state kept; G2 upgrades a running compressor |
| 4 · P2 | **A muted 900 Series source is switched off live** (`ptPower`: no notes, no audio) but rendered offline — the ghost kick fails for the Moog modular, export ≠ playback; S2 said mute never touches the source | main.js:540–546, 1189, 7670 | **fixed in S2, §0, §1.3, G5**: `ptPower` / `ptHeard` read `audible(t) \|\| scKeyed(t)`; cords still dim as muted |
| 5 · P2 | **BUS racks and splitter branches run units at `o = 0`** on block scratch: a keyed compressor / Ducker there would read `kL[o + j]` and frames `F + o` of the call's first block — wrong for every block but the first (§1.1 promised splitter branches; Q4 brings the Serum buses) | fx-dsp.js:2862–2868, 2956, 3025, 3031 | **fixed in §1.2, §2.2, §3.2, §4.2, §9.1, G2 / G3**: the rack writes `sc.b` (the block's call offset) per block; units index `F + b + j`, `kL[b + j]` |
| 6 · P2 | **The NOTE filter could not name a drum lane.** DrSeq hands `drStep` one note per step — the lowest primary of its sounds — so a snare struck with a kick reads 36 (NOTE 38 never fires there) and a user map with a sound below the BD hides the kick; `drHit` stored the played note (35 ≠ the kick lane's 36). dr-seq.js had no owner | dr-seq.js:331–343, 376–387; engine.js:2455–2462, 2499–2508; drum-core.js:115, 271–281 | **fixed in §0, §2.1, §6.1, §9 D, G4**: `drHit` stores `prim[s]`; DrSeq calls an optional `I.drNote(q, v)` per sounding lane; dr-seq.js → lane D (hooks only, drum goldens bit-identical) |
| 7 · P2 | **The bounce's source pass**: "minus ids with no node" empties `scSrcs` with the power off (`bounce()` never powers on); a muted kick fed only by another track's MIDI OUT is never in `want` (the MIDI-OUT pass adds audible targets only); the master's Ducker sources were not seeded; `bounce()` copies named fields of each entry, so `sc` would be lost | main.js:4666–4683 (4678), 4703–4728 (items 4714–4721) | **fixed in §1.1, §7.2, G5**: `scWant` (model-level) vs `scSrcs` (∩ nodes); a closure over key and MIDI-OUT edges seeded by the master too; the item builder forwards `sc` |
| 8 · P2 | **A deleted keyed track leaks**: `syncNodes` disconnects the dropped node's outputs, not the sources' edges into it; a processor whose `process()` returned false is still called — and kept — while a live source feeds it | main.js:1170–1173; engine.js:4630–4633; Web Audio AudioWorkletNode lifetime | **fixed in §1.1, G6**: the drop loop cuts `N.scIn`'s edges first |
| 9 · P2 | **Name collisions**: `N.sc` is the track's OUT-scope AnalyserNode (`scopeSource` returns it); `Track.sc` holds the song's cc lanes — a builder following the draft breaks the scope or the cc lanes | main.js:1079–1083, 5213–5216; engine.js:3535, 4441, 4528 | **fixed in §0, §1.1, §1.2, §9**: `N.scIn`; no Track field named `sc` |
| 10 · P2 | **Edges synced only from `fxEditDev`**: a device removed, a model change, a Serum / chain / rack preset, undo's `keepDevs`, a load all change FX states without it — a stale edge sums an unnamed source into a compressor's key, a missing one leaves a Ducker unordered | main.js:626–628, 672, 2657–2667 | **fixed in §1.1, §1.3, G6**: `scSync(t)` in `sendPatch` (every FX state passes there), before the post |
| 11 · P2 | **A Ducker's edge feeds audio into the key**: the edge exists for ordering, but Web Audio sums the source into the keyed node's one input — a compressor of the same track keyed from the vocal would pump on the kick the Ducker names | §1.1, §11 (draft) | **fixed in §1.1, §9.1, §11, G6**: every edge through its own GainNode, gain 1 only when a v3 compressor names the source (a gain-0 node still pulls its input: the order holds) |
| 12 · P2 | **Reads without an edge were order-dependent, not "dropped"**: a message-time entry is written between quanta, so a reader running first saw it and missed the song notes; a refused cycle's unit read its would-be source's ring; K's `reg` was SCREG on a preview / resample node too (a preset audition through a Ducker would read the live rings) | §2.0–§2.2, §4.3 (draft); engine.js:3567–3571 | **fixed in §1.2, §1.4, §2.0–§2.2, §4.3, G4**: the writer stamps `ring.q = F0` before its events, the reader trusts only `q === sc.q`; `sc.reg` null without a `trackId` |
| 13 · P2 | **Track ids are reused**: delete the highest-numbered source, add a track — the newcomer takes its id and a Ducker kept dangling for undo keys from it, silently | song.js:44, 76–90; main.js:4047, 4064, 4607 | **fixed in §1.3, G6**: lane H passes `id` past every `sub.src` named in the project |
| 14 · P2 | **Track ids travel and get wiped**: rack presets / the rack clipboard, chain presets, Serum and classic user presets carry FX states (a `trk_n` names a different track in another project); `applyModulePreset` writes `I.sub = cloneJ(src.sub)` (a preset load blanks the key); fx-ui reads a module preset back as `fv` 1 or 2 (a saved keyed preset returns a v2) | fx-core.js:1222–1225, 1329–1358; fx-ui.js:302–304, 2162–2194; main.js:2417, 2820 | **fixed in §1.3, §3.3, §5.1, §6.3, §9 U / H, G9**: `blankSrc` on every outbound path, the clipboard blanks across projects; apply keeps the instance's `sub.src`; fx-ui keeps fv 3 |
| 15 · P2 | **Phase 0's `K_S2.duck = 22` would build a Ducker as a splitter**: `kindOf` returns `k < 18` as is and sends every k > 20 to kind 21 (`SplitMod`) — phase 0 not green, possibly a throw in `runSplit` | fx-dsp.js:2170–2181, 2182–2196 | **fixed in §0, §5.1, §9.0**: `K_S2.duck` and the `kindOf` cases (22, v3) are lane D's |
| 16 · P2 | **The input on every Track node is unmeasured where it matters**: MASTER proves WebKit renders one input-bearing worklet, not what 100 of them cost per quantum (input marshalling, array reuse [R?]) on the user's main platform | §7.4 (draft); docs/HANDOVER.md §5 (WebKit warm-up stalls) | **fixed in §1.1, §7.4, §11, G8**: Safari, 64 tracks, ≤ +2 % vs the base; a [C] fallback (inputs only where keyed, a rebuild at the first pick) — **left for the lead** with the numbers |
| 17 · P2 | **G3's "0 samples differ" would fail**: the Ducker snapped `g` to 1 in `flush()`, i.e. at the call's end — at a different sample relative to each hit (calls are 128-aligned, hits are not), so two shifted hits differ in their last ulps | §4.2, G3 (draft); fx-dsp.js `post()` → `modFlush` per call | **fixed in S4, §4.2, G3**: the snap is per sample (`pos` NaN and `1 − g < 1e-9`) |
| 18 · P3 | `addMenuItems` does not derive from `FXTYPES`: `ADD_EFFECTS` is a hard-coded list; phase 0 moved the fx-ui pin without the list (red after phase 0) | fx-ui.js:234, 444–454 | **fixed in §6.4, §9.0**: phase 0 adds `'duck'` to `ADD_EFFECTS` with its pin |
| 19 · P3 | `DC.rollRows` does not exist: `drumRows(map, model)`; main.js already has roll.js's `drumRowsOf(dev)` | drum-core.js:271–281; roll.js:11; main.js:3, 4178 | **fixed in §0, §6.1** |
| 20 · P3 | Two [R?] are facts: CurveEditor's `playhead` option draws the marker (no graph.js change; its own animator would run per Ducker — drive it from `grLoop`), and `enum:DUCK_NOTES` resolves through `core[name]` (serum-core re-exports fx-core); zoom is off unless asked (native pinch only) | graph.js:567–569, 598, 657–658, 1187–1191; fx-ui.js:396–400; serum-core.js:94 | **fixed in §6.2** |
| 21 · P3 | Pins and citations: canvas-M-sim:334 / 348 missing, canvas-9b-sim has none, canvas-7b / 7c derive; cv-migrate's pins span six blocks (not six lines); fx-core.test.mjs:28 (the id list); the chainSpan rack call is :4744; live-p1 "from the base tree" named 91a859a | tests/canvas-8-sim:418, canvas-9-sim:447, canvas-M-sim:334, 348, canvas-7c-sim:657, canvas-7b-sim:520; tests/cv-migrate.test.mjs:1056–1069 …; engine.js:4744 | **fixed in §0, §1.2, §9.0, §9.3** |
| 22 · P3 | Ducker vs the module protocol: its state was named `ph` (the protocol's Bode-phase field, "NaN for the others"); `idle()` is not in the protocol; `tail()` / `flush()` unspecified; the "identity" table undefined | fx-mods2.js:29–57 (53); fx-dsp.js `phases()` | **fixed in §4.2**: `pos`; no `idle()` (the rack's quiet counter); `tail()` 0; table all 1 until the FXT |
| 23 · P3 | `scN` as a counter kept by `scSync` goes stale through undo / load / device removal | §7.1 (draft) | **fixed in §7.1**: `scAny()` on demand at the anchor sites |
| 24 · P3 | G5's per-node live ≡ offline needs per-node offline outputs; main-sim's offline `quantum` passes `out = null` | tests/main-sim.mjs:298–313 (307: `out` null) | **fixed in §9 H, G5** |
| 25 · P3 | Known limits unsaid: a lane mute in a kit drives nothing (the plan masks it); the Ducker follows notes, not the source's rack latency (no per-track delay compensation); a skipped span (≥ 2 s quiet + idle rack) hears no hit; a dip running at ▶; the source-change transient; legato Serum vs tied 303 | drum-core.js:483–492, 530; engine.js:3265–3279; fx-dsp.js:49–50 (Distortion 15), Limit look-ahead | **fixed in §4.3, §7.3, §11** — the lane-mute behaviour **left for the lead** |
| 26 · P3 | Registry details: `end()` must keep PROCS's identity rule (delete → undo rebuilds a node under the same id); an append to a full ring should compact first (message-time entries precede the next compaction); the stamp goes before `songEvents` | engine.js:4401; §2.1 (draft) | **fixed in §2.1, §9.1, G4** |
| 27 · P3 | Compressor key details: `schp` modulated off its minimum resumes stale HP states; the key branch should be hoisted per block (the `cmp` bench row must not move); G2's dB cases lacked thr / ratio | fx-dsp.js:1067–1102 | **fixed in §3.2, G2, G7** |
| 28 · P3 | The new paths are not in any warm-up — the 2b JSC-tiering lesson (cold code on the audio thread) | docs/HANDOVER.md §5; fx-dsp.js:3203; engine.js:3567, 3609–3626 | **fixed in G7** (FXRack.warmUp covers a Ducker with a hand-filled ring and a keyed v3; the warmed-first-Track test holds) |
| 29 · P3 | UI: two tracks with one name are indistinguishable in the menu; "EXT with no source" was reachable by hand; the Serum panel's own FX page has no `scSources` (its adapter, serum-ui.js:398–412 — unowned, left as is: the canvas's Serum FX module carries the selectors) | serum-ui.js:395–417; main.js:3530 | **fixed in §6.1, §6.3, §6.4** — a one-line adapter forward **left for the lead** |
| 30 · fine | Checked and fine: the same-quantum order (spec + Chromium / WebKit pull-first); one SCREG per context (each `BaseAudioContext` its own global scope; main-sim builds one scope per context); the warm-up runs before registration; `'duck'` at index 16 keeps every `iType` (Uint8); cmp v3 rows appended at 18–20 (`ext 0` ≡ v2 by construction, `Comp.upd` reads rows ≤ 17); `upgradeInstance` one step keeps tests/fx-core.test.mjs:491; `paths()` / `procOrder` / `quantum()` already model a key edge (and a gain-0 one) with one Float32 rounding; no test pins a Track's `numberOfInputs`; hooks cover piano roll / keys / MIDI / MIDI OUT (`extEvents` fires in span) / Serum arp and clips (`sxSeq.fire` at span starts) / the 303 / the 900 Series' keys; note frames are absolute (the 4-frame grid is quantum-aligned); a Ducker-enabled rack is never `calm`; `mAlign`'s extension is ≤ 2.7 ms | fx-core.js:570–578, 1292–1323; fx-dsp.js:1647–1660, 3196–3199; tests/main-sim.mjs:171–220; engine.js:4636–4665 | — |

**Counts**: 3 P1 · 14 P2 · 12 P3 · 1 fine. Every P1–P3 is fixed in the text above. **Left for the lead**: (a) **`nv`** — new compressors
stay v2 and become v3 when keyed (the v2 panel's "Key: none ▾"), replacing the draft's "new compressors get v3"; the review recommends it
(S1 by construction, no factory payload moves) — confirm the UX; (b) **the WebKit input-cost gate** (§7.4, ≤ +2 % at 64 tracks in Safari)
and, should it fail, the fallback (inputs only on keyed nodes, a rebuild at the first pick); (c) **a drum lane mute** — no trigger (the
plan masks the lane; the ghost kick is the track's mute) or a trigger anyway (a DrSeq pass over the unmasked step); recommended: as now,
recorded in §11; (d) **the Serum panel's own FX page** — selectors disabled with a hint (as written) or one adapter line in serum-ui.js
forwarding the host's `scSources`.
