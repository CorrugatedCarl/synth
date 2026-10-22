# Stage 9b: the System 35 and System 55 sets (IMPL-9b) — contract

The next step of ROADMAP row 9 ("Moog Modular, module by module"; HANDOVER §3 item 9: "Next: System 35 / 55 modules"). **Scope (the
lead's choice, 2026-10-22)**: the **System 35 and System 55 deltas together** — every module type the reissue System 35 and System 55
add over the Model 15 (RM §2.2, corrected in §2.5 below): **904B** high-pass, **914** fixed filter bank, **911A** dual trigger delay,
**903A** random signal, **960** sequential controller, **961** interface, **962** sequential switch, **992 / 993 / 994** panels, the
**console panels** **CP2, CP3A, CP4A, CP35, CP8A** — plus **System 35** and **System 55** set tiles beside the Model 15 tile, each the full
set patched as a starting sound. **Out (stage 9c)**: the 1960s extras (901 family, 904C, 905, 912, 984, 991, CP3). This contract builds on
stage 9's framework as built and designs to the user's settled decisions (not re-asked): mono (LOW / LAST); physics cords as built (the
Studio preset; only the plug ends take touches; a tap on a plug = colour / remove); the "Moog modules" Sources view; today's Moog Modular
untouched; original art only (our own drawings in the house style, **no photograph fetched or viewed**, no logo, no manual prose); the
canvas always snaps to the grid; canvas only (synth.domlavin.com is obsolete); **every frozen golden stays bit-identical, `tests/ref-9`
included** — stage 9's six presets and the Model 15 sound do not change.

Design inputs, cited as: **I9 §n** [IMPL-9.md](IMPL-9.md) (the framework's contract, its §12 notes, its reviews); **RM §n**
[research-moog-modules.md](research-moog-modules.md) (its §9 source codes: VK-35, VK-55, MS-960 / 961 / 962 / 911A / 992 / 993 /
CPANELS55 / S55, CH-903 / 911a / 914 / 960 / 962, ZB-900, BON …); this contract's own research pass (2026-10-22, text pages only, read for
the facts below, no prose copied): **VK-35 / VK-55** (the reissue lists and spec lines: the 904B's ranges, the 914's 12 dB/oct, the 960's
ninth stage, two parallel outputs per row, octave + vernier clock, the 961's four circuits, the CP3A's routing / splitter / trunks),
**MS-960 / 961 / 962 / 911A / 992 / 993 / CPANELS55 / S55**, **CH-903 / 911a / 914 / 960 / 962**, and two search excerpts tagged [R?]:
**BEH-960** (Behringer's 960 manual as excerpted: stage 9 turns the oscillator off) and **MG-960** (ModularGrid: the Behringer 960 is
56 HP). Lane V9c adds the new codes to RM §9. **Code references are to `canvas` at 8f6c716** (stage 9's squashed commit; lines drift,
names do not). §0 what exists; §1 data; §2 the modules; §3 the engine; §4 the canvas; §5 phase 0; §6 host wiring; §7 lanes; §8 tests;
§9 bench and the iPad; §10 docs; §11 questions; §12 notes (builders); §13 review log.

**Every number is tagged** as in I9: **[R]** research (RM section / source code; an engine fact cited by file:line), **[R?]** secondary
or conflicting (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an [R]).

**Invariants of the stage** (I9's D1–D9, restated for 9b)
- **D1 Old sound bit-identical**: every golden shard (`golden-classic`, `-fx`, `-presets`, `-random`, `-graph`), `canonical-stream`,
  `golden-drums` (ref-7a), `-606` (ref-7b), `-909` (ref-7c), `-sdsv` (ref-7d) **and `golden-moog` (ref-9)** against their frozen refs,
  untouched, their `PIN`s unchanged. `golden-moog`'s side B is the 9b tree with ref-9's `patch-dsp.js` / `moog-dsp.js` / `engine.js` on
  side A (I9 §3.7): it is the proof that the Model 15 types, the controller and the six presets render bit for bit as at 53b7e88. So in
  `moog-dsp.js` the ten existing classes, the shared helpers (`ex2`, `tanp`, `tr`, `rail`, `knee`, `psin`, `base`, `drift`, the `SPEC`
  rows of the existing types) are **not edited** — 9b appends rows and classes; `patch-dsp.js` gains only paths reached by a payload
  that names a new capability (§3.2); `engine.js` only lines behind `kind === 'patch'` / `s.pe !== undefined` / `pm !== null` (§3.1).
- **D2 New sound frozen**: the new types, the bus rows and the new presets are pinned at 9b's acceptance by **`tests/ref-9b/`**
  (verbatim `patch-dsp.js`, `moog-dsp.js`, `engine.js` + `MANIFEST.json`, ref-9's mechanism) rendered by a new
  **`tests/golden-moog-b.test.mjs`**; from then on ref-9 guards the Model 15 cases and ref-9b the 9b cases.
- **D3 One instrument per track, one output** (unchanged): a System 35 / 55 is the same `m900` device ("900 Series") holding more
  modules; its sound leaves through the controller's MAIN OUT. **No new model** (§1.1).
- **D4 Original content**: module numbers and function names are facts; every face is our own drawing in the house style of
  `panels/m900.js` (no photograph viewed; layouts from the control and jack lists below and the MU widths); where a panel's contents are
  unknown (CP4A, CP35, the CP2's details, the CP8A) the face is an **honest stand-in** whose plate says so, as the controller's does
  (I9 §2.4); our **Song clock** is ours and says so; no maker word on any face or tile (cv-panel `MAKERS`, cv-panel.js:65).
- **D5 Generic engine and cord layer**: `patch-core.js`, `patch-dsp.js`, `cv-patch.js`, `cv-cords.js` still hold no Moog name, number
  or constant. 9b's new *capabilities* — **sets**, **rear jacks**, **bus rows**, **momentary events**, **live lamps**, **console-row
  modules in Tidy** — are generic (a family table declares them); the Moog rows live in `moog-core.js` / `moog-dsp.js` /
  `panels/m900b.js`.
- **D6 Mono** (unchanged): the controller is not edited (review 1's F6 — LOW priority + MULTIPLE retriggers on a higher key — stays as
  decided, I9 §13 Acceptance).
- **D7 Determinism**: a patch renders as a function of the absolute frame clock, the graph payload (bus rows included), the values,
  the salt **and the song transport's anchor** (the 960's song clock, §3.4); control work per absolute 4-base-frame chunk; offline
  bounce = live; **span invariance holds with the transport running** (the Song clock reads the continuous tick expression per absolute
  chunk, never the roll-note path whose tick → frame rounding is a known issue, ROADMAP "Known engine issues").
- **D8 Budgets**: §3.7's CPU rows (V8, JSC, iPad); no allocation in a render path (events and lamps included); §4.2's DOM / GL budget for
  a System 55-sized rack, gated by the iPad session of §5.
- **D9 Cords never steal; the old cables never change; bus rows are never drawn**: a bus connection (rear wiring behind a panel's
  switch) is not a cord — no plug, no colour, outside the one-plug rule, invisible except as the switch's position and tip.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists, and what 9b does with it (read at 8f6c716)

| piece | where | 9b |
|---|---|---|
| the family table: `TYPES` (10 types incl. the controller `ctl`), `ORDER` (tray), `ROWS` (Tidy), `GROUPS`, `M15`, `PRESETS` (six), `FAMILY` with **one** `set` / `starter`, `model15(vals)` | moog-core.js:175–181, 186, 188–231, 234–238, 245–265 | 16 new `TYPES`; `ORDER` / `ROWS` extended, a `CONSOLE` row; `FAMILY.sets` = { m15, s35, s55 } (`set` / `starter` kept = m15's: moog-core.test:169 pins them); `makeSet(id, vals)` with `model15 = v => makeSet('m15', v)` (bit-identical output); 7 new presets (§2.6) |
| a type's params: "≤ 16" and "≥ 1" pinned | moog-core.js:10; tests/moog-core.test.mjs:38–41 | the 960 has 40 params; the 903A / 962 / 993 / 994 / CP8A none — the pin becomes 0 … 48 with the list of types over 16 pinned (§8.8) |
| patch-core: `FAMILIES` (one import), `MAX_MODS 48`, `normPatch` keeps an unknown type as data (silent), `jacksOf` / `canPlug` (every jack of a type), `loadPreset(…, { ensure })`, `loadSet` = `fam.starter` on `fam.set`, `payload(rec, f)` (cords only), `wiring` / `live` / `liveNodes` (cords, normals, links), `rackLayout` (`fam.rows`, `fam.rackW` 1024, wrap upward), `freeSlot` | patch-core.js:40, 48, 111–162, 247–289, 417–471, 498–516, 520–588, 600–636 | `loadSet(rec, vals, id)`; **rear jacks** excluded from every cord path; **bus rows** resolved into the payload and `live` / `liveNodes` (with `vals`); the console row and the cabinet width in `rackLayout` / `freeSlot` (§1, §4.4) |
| the evaluator: payload ≤ 64 modules (`MAXM`), ≤ 16 sections a type (`MAXSEC`), ≤ 30 outputs a type (`om` a 31-bit mask), 'any' jacks = passive multiples (averaged when several drive), an input sums every source (`Σ g · source`) | patch-dsp.js:82, 84, 132; header 36–46 | unchanged in what it computes; gains `ev(n, k)` and `lamps()` (§3.2). The largest new type (960: 16 outputs, 1 section; CP35: 6 sections) fits |
| the family's DSP: its own copy of the table (`SPEC`, `ORDER`), one class per type, the `T` map; a 911 reads an S line as `> 0.5` (two S sources summed = OR) | moog-dsp.js:124–160, 643, 800–807 | 16 `SPEC` rows + classes appended, `EV` / `LAMPS` tables; nothing existing edited (D1) |
| the Inst's transport: `this.tp = T.tp` (the Track's `{ play, frame, tick, fpt, loop, ls, le, wrap, end }`); `drClock(F)` (ticks at an absolute frame: the song's while playing, the patch's bpm stopped); P-2 `ptFresh` at Play from a stop | engine.js:1653, 3474, 2428–2436, 3079, 3084–3089 | the 960's song clock (our `clk` module) reads `inst.tp` per absolute chunk (§3.4) |
| a patch payload routed by shape: `seqMsg` → `ptMsg` (`s.pg`) | engine.js:3093–3094, 2529–2533 | + `s.pe` (a momentary event, §3.1) |
| the monitor: every ≈ 33 ms (`postMon`); a drum machine's lights ride it as `dr: { lit, act, F }`, the host queues them by frame `F` | engine.js:4555, 4720, 4737; main.js:3695–3703; cv-drum.js:357, 387 | a patch's lamps ride it as `pt: { F, l }` (§3.1, §4.5) — the drums' frame-queued form |
| the warm-up: `PT_FAM`, `warmPatch` generic over the family's table ("a new type is warmed with no edit") | engine.js:1530–1531, 3753–3790; I9 §12 lane E9 choice 5 | holds for the 16 new classes; 9b also takes the JIT warm-up fixer's leftovers (§3.1, §0.2) |
| faces: `panels/m900.js` (the console + `MODULES`, 9 faces), `PATCH_FAMS`, live patch jacks (15 mm pitch, 9 mm clearance, `geometry().jacks`), `KINDS` incl. `button`, `buttons`, `lamp` | panels/m900.js:521; cv-panel.js:65, 67–71, 90, 96–97 | a new file `panels/m900b.js` (16 faces); cv-panel learns **event buttons**, **live lamps**, **rear jacks** (not drawn), faces with no params / no jacks (§4.1) |
| the tray: view `moog` = `[{ id: 'm15', models: PATCH }, { id: 'moog' }]`, `MOOG_TILES` from `ORDER`, `MOOG_GLYPH`, group headings | cv-tray.js:363–365, 369–386, 532–590 | set tiles **System 35 / System 55** in the m15 section (not model tiles: cv-tray.test:293 / 796 keep "one tile per MODELS id"); two new groups; 16 glyphs (§4.3) |
| host: `patchNew` (Model 15 or one module), `ptSet` (`fam.starter` / `fam.set`), `moogPick` / `moogDrag`, `ptTray` (48), `ptKnob` (vals, throttled `{t:'patch'}`), `patchPayload` (rec only), `syncedOf` (`PT.live(rec)`), `PT_HEAVY = SX_HEAVY` (1 866) | main.js:175–180, 6785–6790, 6791–6825, 6758–6768, 3475–3476, 4269, 6317 | `patchNew(…, set)`, `ptSet(id)`, `setPick` / `setDrag`, `ptKnob` reposts the graph on a bus switch, the payload and `live` take `vals`, `ptEv`, the lamp monitor; `PT_HEAVY` from §5's measure (§6) |
| cost: `COST.patch[type]` (per section where sectioned), `patchLoad` over `liveNodes` | cv-cost.js:103, 184–194 | the new types' costs; `patchLoad(cs, rec, vals)` (bus rows make nodes live) |
| bench: rows m9p / m9x / m9d (node 0.0185 / 0.0372 / 0.0186; targets 0.025 / 0.05 / 0.03); `ui-m9-mac` (headless Chrome: m13 509, m20 836, m30 1 226 painted without the face SVG, all P+; faces 20.4 / 31.7 / 47.7 MB) — **`ui-m9` (the iPad) still pending** | tests/bench.json `m9`, `targets`, `ui-m9-mac` | rows **m9q** (a sequencer patch) and **m9s** (a System 55 classic patch) (§3.7); the iPad session of §5 measures a System 55-sized rack first |
| the S0 iPad envelope: sx1 1 866 painted P+, hw5 ≈ 2.8 k borderline, p1x 3 176 one frame over, t2 ≈ 6 k fail | bench.json `ui-m3`; I9 §0 | §4.2's budget sits under sx1's line; §5 measures it |

**The lead's figures for this contract (the brief)**: stage 9 measured the Model 15 set at **408 painted elements** and **48 modules at
1 332** in the real app. (P9's estimate was ≈ 570, I9 §12 lane P9; the stand-in faces of `ui-m9-mac` 509 for 13.)

### 0.1 I9 §2.6 "adding a module is a table entry + its DSP class + its face" — verified against the code as built

| step (I9 §2.6) | as built | holds? |
|---|---|---|
| (1) a `TYPE` entry | moog-core.js:89–171 — but a type must also join `ORDER` (175, the tray) and a Tidy row `ROWS` (179): moog-core.test:130 pins `ROWS.flat()` = `ORDER`, and `rackLayout` places a type no row names as an "extra" (patch-core.js:604–607) | **held, with two more lines** (ORDER, ROWS) — 9b writes the checklist as "TYPE + ORDER + a row" |
| (2) its DSP class, the same jack order, compared by a test | moog-dsp.js keeps its **own copy** of the table — a `SPEC` row (124–158), the `ORDER` list (160), the `T` map (800) — three edits in the script, compared with moog-core by moog-core.test:233 | **held** (three edits, one file, a test guards them) |
| (3) its layout in `panels/m900.js` (ports checked) | `MODULES` (panels/m900.js:521); cv-panel's validate requires every table jack placed (I9 §12 lane P9); moog-core.test requires a face for every type | **held** — 9b's faces go in `panels/m900b.js` (one more line in `panels/index.js`'s merge) |
| (4) a tile glyph in `MOOG_GLYPH` | cv-tray.js:374; a fallback glyph exists (386) but cv-tray.test:1161 checks each type's glyph (its knobs / jacks) | **held** (required by the test) |
| (5) golden cases, its cost | `COST.patch[type]` (cv-cost.js) — a file the checklist's "nothing changes" list does not name | **held** |
| "nothing in patch-core, patch-dsp, cv-patch, cv-cords, engine.js or main.js changes" | true for a **plain** type (a 904B, a 914, a 903A, a 994: knobs, jacks, sections): `warmPatch` is generic (engine.js:3753–3790), `moduleBody` / `moogPick` / `moogCost` / Tidy are table-driven | **held for plain types; not for new capabilities.** 9b needs, once, generically: **momentary buttons** (the 960's SET / SHIFT, the 962's SET: no value to store — an event message), **live lamps** (the 960 / 962: engine → face), **rear jacks + bus rows** (the 992 / 993 / CP3A / CP4A / CP2 route behind the panel, no jack), **console-height module types** (Tidy's console row), **sets** (one `set` / `starter` per family today, patch-core.js:468–471, main.js:6785–6790), **a module reading the transport** (the Song clock), and the param-count pin. After 9b a later type that uses none of these new capabilities is again table + class + face + glyph + cost |

Other pins a new type trips (each gets its rule in §8.8, none weakened): moog-core.test:127–133 (ORDER / groups / tiles / shorts exact),
:38–41 (params 1…16), :130 (ROWS = ORDER); **tests/patch-core.test.mjs:156 uses `'914'` as an unknown type** in its hostile-input case
— 914 becomes real, so that case takes `'999'`; cv-tray.test's Moog row counts; cv-patch.test:538 (DOM per module: the 960 needs its own
line); cv-panel.test (module faces 10 → 26); canvas-9-sim ("the nine modules").

### 0.2 Stage 9's open items, carried

| item | where it goes |
|---|---|
| the user's **pending iPad session** (`canvas.domlavin.com/tests/ui-bench.html?m9=1` → `"ui-m9"`; the `?cords=under` fallback ready) | **folded into 9b's phase 0** (§5): one visit runs stage 9's scenes and 9b's new System 55-sized scenes; its decision table decides both stage 9's open glue / hold questions and 9b's DOM line. If the glue fails on the device, `?cords=under` becomes the default (the switch exists, I9 §12 lane C9) |
| review 1's **F6** (LOW priority + MULTIPLE retrigger on a higher key — kept) | unchanged: 9b does not edit the controller (D6); listed again in §11's "things you will notice" |
| the JIT warm-up fixer's **engine-side leftovers** (`ptRamp` / `outStage` / `renderPatch` still interpreted at the end of the warm-up; a sparse warm graph tried and dropped) | lane **E9b** (§3.1): enough warm rounds that those three reach the optimising tier on V8 and JSC (measured, not assumed), and a gate on the scope's warm-up time now that the warm graph holds 25 types (§8.3) |
| known engine issue: **the drum-switch click** | **not 9b**: its fix changes rendered sound pinned by ref-7a…7d and ref-p1 — a dedicated engine-issues stage re-freezes them; 9b touches no classic or drum path (D1) |
| known engine issue: **quantum-dependent note rounding** (tick → frame) | **not fixed in 9b** (every instrument's sound, new refs) — **avoided by construction** in the 960's song clock: it reads the continuous tick expression per absolute chunk with the loop folded in the module (§3.4), never `songEvents`' rounded note frames; golden-moog-b renders the clocked *Sequence* at spans 4 / 128 / random with the transport running, bit for bit |
| `classic-mod` N4 row mk (marginal 1.074–1.082) | not 9b's (no classic path touched); the sweep notes it if it recurs |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The data model

### 1.1 No new model, no schema bump (decided)

- A System 35 / 55 is the **same instrument** (`m900`, family `'patch'`): a patch holding more modules [C]. A model per set would break
  `familyOf` (one model per family, patch-core.js:73–78), add MODELS-iterating churn (I9 §0's list) and three Hardware-only rules for
  nothing. `models.js` is **not edited**.
- **Schema stays 12** [C]: 9b adds module types (`dev.patch.mods[m].t` — a string `normPatch` already keeps when unknown: patch-core.js:118,
  140–148 keep a module of an unknown type and its cords, `payload` leaves them out, 503, 510; I9 §1.2 "an unknown type is kept as data
  and renders silent — a newer file"), values in `vals.p` (plain numbers; a schema-12 build's `pruneVals` keeps an unknown type's numbers,
  patch-core.js:176) and **nothing stored that is new in kind**: sets are not stored (a tile is an action), bus rows are derived from
  switch values (§1.4), events are not stored, lamps are engine state. A 9b file opened by a 9 build therefore keeps everything and plays
  the Model 15 types it knows (the rest "needs a newer version of the app", cv-patch.js:621–624). A test pins that a record holding every
  9b type round-trips `normPatch` / `pruneVals` unchanged (§8.2).

### 1.2 Sets (generic: `FAMILY.sets`)

```
FAMILY.sets = { m15: { name: 'Model 15', set: M15, starter: 'Classic bass' },
                s35: { name: 'System 35', set: S35, starter: 'Swept band' },
                s55: { name: 'System 55', set: S55, starter: 'Sequence' } }      FAMILY.set / starter = sets.m15's (kept: moog-core.test:169)
```
- `MG.makeSet(id, vals)` (moog-core, a leaf: builds the record itself, as `model15` does, moog-core.js:245–265) → `{ rec, vals }`: the
  set's modules numbered past every `m<k>` of `vals.p` (I9 §1.5), in the set's order, a linked type driven by the first driver with room,
  the starter's roles bound and its cords coloured i % 8; **`model15(v) = makeSet('m15', v)`, bit-identical** (the existing tests compare
  it with `loadPreset`, tests/patch-core.test.mjs:626–628).
- `PT.loadSet(rec, vals, id = 'm15')` = `loadPreset(rec, vals, sets[id].starter, { ensure: sets[id].set })` (patch-core.js:468–471
  generalised); `PT.setNeeds(rec, id)` → how many modules the ensure would add (the tile greys when the patch cannot hold them, §4.3).
- **Tiles** (§4.3): System 35 / System 55 on another track (or + Track) → Replace with a 900 Series holding the set and its starter
  (`patchNew(t, dev, null, id)`); on a 900 Series → `loadSet(id)` as a preset step (missing modules added, the topology replaced, its
  knobs back on undo through `ptBack`: I9 §1.5's rule for the Model 15 tile, main.js:6785–6790); modules the set does not name stay,
  unpatched (patch-core.js:445). The Model 15 tile is unchanged.

### 1.3 Rear jacks (generic)

A jack may carry **`rear: 1`**: a rear edge-connector terminal (RM §1.1: every module's 22-pin connector carries signals; §1.6: "CP and
992 / 993 panels route controller outputs through trunk lines and rear bus wiring (jack-less)"). It is in the type's table (a payload port,
`PatchMoog.JACKS` in order), **never on a face** (cv-panel's "every jack placed" rule skips it), **never a cord's end** (`jacksOf`,
`canPlug`, `targets`, `cordAt`, `normPatch` treat it as absent: "No such jack"), reachable only by bus rows (§1.4). The evaluator needs no
change: it is an ordinary `in` / `out` slot (patch-dsp.js:114–121).

### 1.4 Bus rows (generic; the 992, 993, CP2, CP3A, CP4A)

The System 35 / 55 route keyboard voltages and triggers behind their panels with lighted switches [R VK-35 / VK-55 CP3A, 992, 993; R
MS-993 "simply switch wiring to the rear connector"; R MS-CPANELS55]. We model a routing switch as what it is — **a switch (a value in
`vals`, the knob policy: no History step, never reverted by undo, I9 §1.5) that closes a hidden connection** — and keep the topology record
for cords.

- A type may declare `bus: [{ sw: [<switch param ids>] (all on = active; [] = always), a: <end>, b: <end>, g?: 0…4 (1) }]` with
  `<end>` = `c.<port>` (the controller) · `.<port>` (this panel's own jack, rear or front) · `<types>#<k>.<port>` (the k-th module by
  number among the listed types, `921a|921` = 921As by number, then 921s) · `<types>#=.<port>` (k = this panel's ordinal among its
  own type). `a` is an output (or rear output), `b` an input (or rear input) of the same plug kind; moog-core.test checks every row.
- **Resolution** (`patch-core`, pure): a row is a connection when its switches are on in `vals` and both ends resolve; else it is
  skipped (the switch still moves; its tip says "No 911 3 in this patch"). Resolved rows join the payload after the cords:
  **`payload(rec, f, vals)`** — `pk` therefore changes when a bus switch flips; `live(rec, f, vals)`, `liveNodes(rec, f, vals)` and
  `wiring` read them too (a 993-routed envelope makes its 911 live). `vals` absent → no bus rows (every stage-9 caller's result unchanged:
  the Model 15 types declare none).
- In the evaluator a bus connection is a cord: an input **sums** its sources (patch-dsp.js header 59–64), so a bus row into a jack that
  also has a cord adds to it (on the hardware the rear bus feeds the summer, not the front jack); two S sources sum and a receiver reads
  `> 0.5` (moog-dsp.js:643): an **OR**, as wired S-triggers are [R RM §1.5]. A flip crossfades over the evaluator's 2 ms ramp (an S input
  switches at its midpoint), so it never clicks (I9 §12 lane V9a choice 1).
- **Positions are ordinals** [C]: "the left / centre / right 911" of the 993 [R MS-993] = 911 1 / 2 / 3 by number; deleting 911 1 makes
  the old 911 2 the first (as a cabinet slot would). Said in §11.
- Host: `ptKnob` (main.js:6758) writes the value and, **when the param is a bus switch of its type** (`PT.isBusKnob(rec, mid, id)`), posts
  the graph at once (`patchSend`; a flip is discrete, not a drag) beside the throttled `{t: 'patch'}`. A preset that names a switch writes
  it with its `back` meta (I9 §1.5).

### 1.5 Momentary events (generic)

The 960's SET 1…9 and SHIFT buttons and the 962's SET 1…3 store nothing [R VK-55 "manual shift button and manual trigger buttons for each
of the 8 stages"; R VK-55 962 "manual switch buttons"]. A type may declare **`ev: [{ id, label }]`**; the face's `{ kind: 'button', ev:
'<id>' }` posts **`{t: 'seq', i, s: { pe: [n, k] }}`** (n the module number, k the event's index) — routed by shape like `pg` (engine.js:
3093–3094), handed to `pm.ev(n, k)`, applied by the module at its **next chunk's `ctl`** (deterministic per chunk). Live only: not
recorded in the song, not in a bounce, no History, not in `vals` [C]. An event for a module that no longer exists is dropped.

### 1.6 Live lamps (generic)

A type may declare **`lamps: [{ id, label }]`**; its class keeps `lamp` (an int, bit i = lamp i lit). `pm.lamps(F)` → `{ F, l: [n, bits,
…] }` for the live modules with lamps, posted in the patch Inst's `smon` (the drums' `dr: { lit, act, F }` form, engine.js:4720, 4737),
queued by frame on the host and shown when the audio clock reaches F (cv-drum.js:357, 387's method). A lamp of a frozen (not live)
module stays as it was. The lit routing switches of the 992 / 993 / CP3A / CP4A are **not** lamps: they show their own value.

### 1.7 Counts, the 48-module cap

| set | modules (+ the controller) | live jacks | 5U modules · console panels | fits 48 |
|---|---|---|---|---|
| Model 15 (unchanged) | 12 | 97 (I9 §2.2) | 15 MU · — | ✓ |
| System 35 | 22 | ≈ 162 | 20 MU · 17 MU | ✓ |
| System 55 (+ our Song clock) | 37 | ≈ 293 | 41 MU (+ the original's 3 MU blank = two 22 MU cabinets) · 22 MU | ✓ (11 spare: the Sequencer Complement B's 6 more — 2 × 960, 961, 2 × 962, 994, RM §2.2 — fit) |

`MAX_MODS` stays **48** (Q3); the payload's 64 (patch-dsp.js:82) is untouched. Loading System 55 over a Model 15 patch: 12 + 27 = 39 ✓;
over a System 35: 22 + 19 = 41 ✓.

---------------------------------------------------------------------------------------------------------------------------------

## 2. The modules

### 2.1 Conventions added to I9 §2.1

| convention | value | tag |
|---|---|---|
| V-trigger outputs of the 960 / 962 (RTL logic) | **+3.6 V** while true; the one threshold everywhere stays +1.5 V up / +1.0 V re-arm (3.6 > 1.5) | [R RM §1.3 MS-960; I9 §2.1] |
| the 961's S → V and audio → V outputs | 4 V | [R RM §1.5 MS-961] |
| our Song clock's outputs | 0 / +5 V (as the controller's GATE) | [C] |
| a passive pair of inputs on one module (the 914's two inputs) | one patched: as is; both: averaged (I9 review 1 F2's tied-outputs rule) | [C on R? CH-914 "identical"] |
| a pair of outputs on one jack signal (960 rows, 961 audio → V, 914, 903A, 962) | two jacks, one buffer (moog-dsp's shared `outs`, as the 923's WHITE 1 / 2) | [R VK-55 "two parallel outputs per row"; R? CH] |
| sizes | 5U module = `ceil32(mu × 107.95)` × 512: 1 MU 128 · 2 MU 224 · 3 MU 352 · **4 MU 448** · **8 MU 864**; console panel × 352 (moog-core `sizeOf`, moog-core.js:57–60) | [R I9 §2.2] |

### 2.2 The 5U modules (MU = 2⅛ in) — params `K(id, label, min, max, def)` / `S(id, label, opts, def)`; jacks `id (dir, sig)`

| type | MU | params | jacks (secs) · events · lamps | behaviour (§3.3 has the DSP) | tags |
|---|---|---|---|---|---|
| **904B** High pass filter | 1 | `fc` FIXED CONTROL VOLTAGE −6…+6 V (0) · `rg` FREQUENCY RANGE [LOW HIGH] 0 | `in` SIGNAL INPUT · `c1 c2 c3` CONTROL INPUT · `out` SIGNAL OUTPUT — **5** (the 904A's order) | 24 dB/oct high-pass, 1 V/oct, **no regeneration**; f_c (per-stage corner, −12 dB) = f₀ · 2^(fc + 6 + ΣV), f₀ = 4 Hz (LOW) / 4 · 2^1.5 = 11.3 Hz (HIGH): the knob's 12 oct give 4 Hz–16.4 kHz / 11.3 Hz–46.3 kHz, RM's tops (20 / 50 kHz) at +0.3 V on an input (the 904A's convention, I9 §2.2); ≤ 0.46 · fs | [R VK-35, VK-55 (ranges, 1½ oct, 24 dB/oct), PAT / TIL-P (complementary buffered ladder, s⁴ / (s + ω)⁴); RM §8's "1.32 oct" superseded by VK's 1½ twice; C the law's f₀] |
| **914** Fixed filter bank | 4 | `lo` LOW · `b1 … b12` (125, 175, 250, 350, 500, 700, 1k, 1.4k, 2k, 2.8k, 4k, 5.6k) · `hi` HIGH — each 0…10 (10) — **14** | `i1 i2` SIGNAL INPUT 1 / 2 · `o1 o2` SIGNAL OUTPUT 1 / 2 (one buffer) — **4** | twelve band-passes at 125 · √2^k Hz (125 … 5 657), each **two stagger-tuned 2nd-order sections: 12 dB/oct skirts**; a low section (2nd-order low-pass, 88.4 Hz) and a high (2nd-order high-pass, 8 kHz); 26 sections fused per band at the OS rate; all at 10: flat ± 2 dB, unity; pots (v / 10)³ (0 = off); no CV | [R VK-55 (14 controls, 12 bands, 12 dB/oct, no CV), MS-914 (12 + 2 sections, unity); R? CH-914 (2 in, 2 out identical; "medium-Q four-pole dual stagger-tuned"; 90 / 8 000 Hz), SOS-914, RM §8 (88 / 8 000; 5 657); C the 4 MU (§2.5), the alignment] |
| **911A** Dual trigger delay | 1 | `d1` DELAY 1 · `d2` DELAY 2 — 0…10 → 2 ms · 1000^(v / 10) (2 ms … 2 s) (3 ≈ 16 ms) · `md` MODE [OFF PARALLEL SERIES] 0 | `i1` (in s) INPUT 1 · `o1` (out s) OUTPUT 1 · `i2` (in s) INPUT 2 · `o2` (out s) OUTPUT 2 — **4**, one section | each output **closes `delay` after its start closes and opens when its start opens** (an opening before the delay ends cancels it); OFF: 1 → 1, 2 → 2; PARALLEL: INPUT 1 starts both; SERIES: OUTPUT 1's closure starts delay 2; INPUT 2 ignored in PARALLEL / SERIES | [R VK-55 (OFF / PARALLEL / SERIES), MS-911A (S in / outs; 2 ms … 2 s spec, a bench unit to 10 s; series adds), RM §8 (2 ms … 2 s); R? CH-911a; C the release rule, one section (the mode couples the halves: OUT 1 → IN 2 is a one-member loop step, cheap)] |
| **903A** Random signal | 1 | — | `wh1 wh2` WHITE (one buffer) · `pk1 pk2` PINK (one buffer) — **4** | the 923's noise section re-written (white 0.5 V RMS at the density rule, Kellett pink 0.5 V RMS in band), its own seed | [R VK-55 (white / pink); R? CH-903 (two jacks each), RM §8 (white to ≥ 20 kHz, 1/f pink); C "selectable" read as both outputs] |
| **960** Sequential controller | **8** | stage knobs `a1…a8` (row A) · `b1…b8` · `c1…c8` 0…10 (0) · modes `s1…s8` [STOP NORMAL SKIP] 1 · `s9` [STOP SKIP] 1 · row ranges `ga gb gc` [×1 ×2 ×4] 0 · clock `rg` RANGE [0.1 0.4 1.6 6.4 26 100 410 Hz] 2 · `vn` VERNIER 0…10 (2) · `cc` ROW C → CLOCK [OFF ON] 0 · `os` OSCILLATOR [OFF ON] 1 — **40** | `on` OSC ON · `off` OSC OFF · `sh` SHIFT · `ci` CONTROL INPUT (in v) · `co` OUTPUT (out v) · `i1…i9` stage IN (in v) · `o1…o9` stage OUT (out v) · `ra1 ra2` ROW A · `rb1 rb2` · `rc1 rc2` (out v, pairs one buffer) — **29**, one section · events `sh` SHIFT, `e1…e9` SET — **10** · lamps `l1…l9`, `lo` OSC — **10** | §3.4 (the clock, the stage logic, the transport) | [R VK-55 (3 × 8, per-stage normal / skip / stop, a ninth stop / skip position, ×1 / ×2 / ×4 = 2 / 4 / 8 V, shift input + button, manual buttons per stage, clock 0.1 Hz … 1 kHz with octave + vernier, one control input, one ≈ 90 / 10 rectangular output, trigger ins / outs below each column, two parallel outputs per row, row 3 → clock), MS-960 (column outs +3.6 V; a set resets the others; power-on reset to column 1 on later units; 90 % duty; row 3 "can be switched" to the clock); R? CH-960 (stage 9's jacks, OSC ON / OFF jacks, gates while active, stop holds), BEH-960 (stage 9 turns the oscillator off), MG-960 (56 HP ≈ 7 MU); C 8 MU (§2.5), the RANGE detents, the defaults] |
| **962** Sequential switch | 1 | — | `i1 i2 i3` SIGNAL INPUT (in v) · `q1 q2` OUTPUT (out v, one buffer) · `t1 t2 t3` TRIGGER IN (in v) · `o1 o2 o3` TRIGGER OUT (out v) · `sh` SHIFT (in v) — **11**, one section · events `e1 e2 e3` SET · lamps `l1 l2 l3` | one input at a time to the output; SHIFT steps 1 → 2 → 1 …, or 1 → 2 → 3 when INPUT 3 is patched; TRIGGER IN k / SET k selects k; TRIGGER OUT k +3.6 V while k is selected; a negative excursion clipped at −1 V (built for positive CVs: bipolar passes under 2 Vpp) | [R VK-55 (2 or 3 inputs, a plug in 3 adds the third, V-trigger in / out per stage, buttons, a light per stage), MS-962 (positive-only, the 2 Vpp / negative clip; 1 MU); R? CH-962 (two output jacks, 5 V gates); C the clip shape, 3.6 V] |
| **992** Control voltages | 1 | `s1 s2 s3 s4` KEYBOARD · WHEEL · PRESSURE · EXT [OFF ON] 0 · `at` EXT ATTENUATOR −10…+10 (0) | `x4` (in v) EXT IN · `xr` (out v, **rear**) — **1** on the face | bus rows → the 904B's control (§2.4); `xr` = x4 · at / 10 (reversible) | [R VK-55 ("routes up to four control voltages to the 904B; the fourth input has an inverting attenuator"); R? MS-992 (the 904A), C our controller's three CVs for "keyboard, ribbon …"] |
| **993** Trigger and envelope voltages | 1 | `f1 f2` FROM 1 / FROM 2 · `t1 t2 t3` TRIGGERS · `e1 e2 e3` ENVELOPES [OFF ON] 0 — **8** | — (no jack) | bus rows only (§2.4); no DSP (a class with no slots: never scheduled) | [R MS-993 (8 switches, no jacks, three 100 kΩ in the envelope paths), VK-55; C g 1 for the resistors] |
| **994** Dual multiples | 1 | — | `a1…a4` (any) · `b1…b4` (any) — **8**, two sections | passive: the evaluator's multiples (I9 §1.3; review 1 F2) | [R MS-994 (two groups of four)] |

### 2.3 The console panels (console height 142.875 mm; trunks drawn, not emulated) and our Song clock

| type | MU | params | jacks (secs) | behaviour | tags |
|---|---|---|---|---|---|
| **CP3A** Mixer and routing | 4 | `x1…x4` LEVEL 0…10 (7) · `ms` MASTER 0…10 (5: ×1; 10: ×2) · `r1…r4` ROUTING KEYBOARD · WHEEL · PRESSURE · EXT [OFF ON] 0 · `ra` EXT LEVEL 0…10 (10 = unity) | MIX `m1…m4` (in) · `mo` MIX + · `mn` MIX − (out) — sec 0 · ROUTE `x4` EXT IN (in) · `xr` (rear out) — sec 1 · MULTIPLE `a1…a4` (any) — sec 2 — **11** + 4 trunks inert | mix = Σ m_i · x_i / 10 × ms / 5, + and − railed; bus rows r1…r4 → its driver's `f3` (§2.4) | [R VK-35 / VK-55 (4 × 1 mixer, ± outputs, max ×2, four routing switches to "the oscillator drivers above", the fourth with a jack and an attenuator — at 10 = direct —, a one-to-three splitter, trunks), MS-CPANELS55 (master gain, lit switches); R? RM §3.4 "click filter" (not in the texts read: omitted); C per-input levels, 4 MU] |
| **CP4A** Routing (System 35; **an honest stand-in**) | 3 | `c1…c4` CV ROUTING KEYBOARD · WHEEL · PRESSURE · CV IN [OFF ON] 0 · `t1 t2 t3` TRIGGER ROUTING [OFF ON] 0 | `ti` (in s) TRIGGER IN · `tr` (rear out s) — sec 0 · `ci` (in v) CV IN · `cr` (rear out v) — sec 1 — **2** + 4 trunks inert | bus rows: CVs → the 904A, triggers → 911 1 / 2 / 3 (§2.4); the plate: "CP4A · OURS — ITS ROUTING STANDS IN FOR THE ORIGINAL'S" | [R MS-CPANELS1 / ZB-900 (four controller-CV routing switches, trigger routing switches, trigger and CV input jacks, four trunks); C what they route to] |
| **CP35** Attenuators and sources (System 35; **an honest stand-in**) | 4 | `a1…a4` ATTENUATOR 0…10 (0) | `p6` +6 V · `m6` −6 V (out) — sec 0 · `i_k` / `o_k` (k 1…4) — secs 1…4, `i1 i2` normalled to `p6`, `i3 i4` to `m6` · MULTIPLE `u1…u4` (any) — sec 5 — **14** + 4 trunks inert | o_k = i_k · a_k / 10 (passive); unpatched inputs make adjustable ±6 V sources | [R? ZB-900, BON (normalled attenuators, CV sources incl. +6 / −6 V, multiples, trunks); C the normals, 4 MU] |
| **CP2** Filters, multiples, keyboard outputs (System 55; **a stand-in on a short list**) | 3 | `lp` LOW PASS · `hp` HIGH PASS 0…10 (5) (10 Hz · 1000^(v / 10)) | `li lo` — sec 0 · `hi ho` — sec 1 · `u1…u4` (any) — sec 2 · `po` PITCH OUT (out v) · `so` S-TRIG OUT (out s) · `kpr` / `ksr` (rear in) — sec 3 — **10** | one-pole passive LP / HP (the 923's sections); PITCH / S-TRIG = the controller's, by two always-on bus rows | [R MS-CPANELS55 (passive LP and HP, multiples, pitch and trigger outputs from the controller jacks); C the rest] |
| **CP8A** Power | 2 | — | — | drawn only: POWER switch, PILOT lamp (lit), FUSES — "not emulated" (the 1b+ rule); a class with no slots | [R MS-CPANELS55 (power switch, light, fuses; CP8A = CP8 rewired); C one type for both sets' CP8 / CP8A] |
| **961** Interface (**the 961CP console format**) | 3 | `t1 t2` SWITCH ON TIME 1 / 2 — 0…10 → 40 ms · 100^(v / 10) (40 ms … 4 s) (5: 400 ms) · `se` SENSITIVITY 0…10 (5) | V→S 1: `a11…a16` A INPUTS, `b11…b16` B INPUTS (in v), `s1` S-TRIG OUT (out s) — sec 0 · V→S 2: `a21…a26`, `b21…b26`, `s2` — sec 1 · S→V: `v1i` (in s) / `v1o` (out v) — sec 2, `v2i` / `v2o` — sec 3 · AUDIO→V: `ai` (in v), `ao1 ao2` (out v, one buffer) — sec 4 — **33** | V→S: closed while any A input is high, or while the B one-shot runs (a rising edge on any B input (re)starts it for SWITCH ON TIME); S→V: 4 V while closed; audio → V: a comparator, on above θ = 5 · 0.01^(v / 10) V, off below θ / 2, out 4 V | [R VK-55 (four circuits, columns of six A / B jacks, one S out each, A passes the duration, B the switch-on time 40 ms … 4 s, sensitivity, two parallel V outs), MS-961 (3 MU; level-sensitive A, UJT one-shot B, 50 ms … 4 s spec, 37 ms … 5 s bench; **two** S → V — VK says one: we build two), MS-S55 (961CP in the System 55's console row); C the comparator, θ's law] |
| **Song clock** (`clk`; **ours**) | 2 | `dv` STEP [1/4 1/8 1/16 1/32 1/8T 1/16T] 2 · `md` MODE [SONG ALWAYS] 0 | `ck` CLOCK · `rn` RUN · `rs` RESTART (out v) — **3** · lamp `lr` RUN | §3.4: the song's steps as a 50 % gate, RUN high while running, RESTART a 5 ms pulse at a start, a loop wrap or a seek; ALWAYS: at the project tempo while stopped too; the plate "SONG CLOCK · OURS — THE SONG'S TEMPO AS PULSES" | [C, Q1] |

### 2.4 The bus rows

| panel | switches (all on) | connection | tags |
|---|---|---|---|
| 993 | `f1` / `f2` | `c.ks1` / `c.ks2` → `911a#1.i1` (the 911A's input) | [R MS-993 "from 1 / from 2 connect the controllers' triggers to the 911A"; C our mono controller's two S-TRIG jacks] |
| 993 | `f1 t1` / `f2 t1` | `c.ks1` / `c.ks2` → `911#1.trg` | [R "top: the left 911, no delay"] |
| 993 | `t2` · `t3` | `911a#1.o1` → `911#2.trg` · `911a#1.o2` → `911#3.trg` | [R "centre / right, delayed by the top / bottom 911A"] |
| 993 | `e1` · `e2` · `e3` | `911#k.out` → `902#k.c3` (k = 1, 2, 3) | [R "each 911's control voltage to the 902 in the same position"; C g 1] |
| 992 | `s1` · `s2` · `s3` · `s4` | `c.kp1` · `c.kw` · `c.ka` · `.xr` → `904b#1.c3` | [R VK-55; R? MS-992 (the 904A)] |
| CP3A | `r1` · `r2` · `r3` · `r4` | `c.kp1` · `c.kw` · `c.ka` · `.xr` → `921a\|921#=.f3` (CP3A k → the k-th oscillator driver: 921As by number, then the 921) | [R VK-35 / VK-55; C the binding] |
| CP4A | `c1` · `c2` · `c3` · `c4` | `c.kp1` · `c.kw` · `c.ka` · `.cr` → `904a#1.c3` | [C] |
| CP4A | `t_k` (k 1…3) | `c.ks1` → `911#k.trg` and `.tr` → `911#k.trg` | [C] |
| CP2 | — (always) | `c.kp1` → `.kpr` · `c.ks1` → `.ksr` | [C] |

### 2.5 The sets [R VK-35, VK-55 — RM §2.2 corrected]

- **System 35** (22 + the controller): 921 · 921A × 2 · 921B × 4 · 923 · 904A · 904B · 907A · 911 × 3 · 902 × 3 · CP3A × 2 · CP4A ·
  CP35 · CP8A. **No 995** (VK-35's list; RM §2.2's 995 in its System 35 column is corrected — the CP35's attenuators play that part).
- **System 55** (36 + our Song clock + the controller): 921 · 921A × 2 · 921B × 6 · 903A · 995 · 994 · 960 · 962 · 904A · 904B · 914 ·
  911 × 5 · 911A · 902 × 5 · 992 · 993 · 961 · CP2 · CP3A × 3 · CP8A · Song clock. VK-55 counts 36 "modules and panels" incl. the 961;
  MS-S55 puts a 961CP in the console row — one type, the console face [C].
- **Widths** [C on R]: the bottom cabinet is 22 MU and holds 921A × 2, 921B × 6, 921 (2), 995, 903A, 994, 960, 962 (RM §2.3, MS-S55):
  with the 1 MU ones at 1 the 960 is **8 MU** (2 + 6 + 2 + 4 + 8 = 22; MG-960's 56 HP ≈ 7 is a scaled clone); the top cabinet holds 914,
  904B, 904A, 992, 993, 902 × 5, 911 × 5, 911A + a blank in 22 MU → 914 + blank = 7: the **914 at 4 MU** (the 907 was 4, RM §3.3); the
  console panels CP3A 4, CP35 4, CP2 3, CP4A 3, 961 3, CP8A 2, Song clock 2 — every one checked by panel-check against its controls
  (15 mm jack pitch, 14 mm hits).
- `S35`, `S55` are the sets' numbering orders (sources, then modifiers, then the console row: §4.4's rows); a 921B is driven by the first
  921A with room (≤ 3: three on each driver in the 55, two each after the 35's starter rebinds them).

### 2.6 Starting patches (ours; `PRESETS`, Patches… lists all thirteen) [C]

Each is a whole sound (I9 §12 lane K9: roles bind to the lowest-numbered free modules, missing ones added, every param written); K9b
writes them, V9c proves each sounds and peaks −12 … −3 dBFS at 48 kHz × 4 (the clocked ones with the transport running), the listening
renders may retune them before the freeze.
- **Swept band** (the System 35 tile's; keyboard-played): KBD PITCH → multiple A → both 921As (921B 1 / 2 on driver 1: 8′ saw, 8′
  rectangle +3 ct; 921B 3 / 4 on driver 2: 16′ saw, 4′ triangle) and a CP35 attenuator (half) → 904A `c2`; the four 921Bs → CP3A 1
  `m1…m4`, `mo` → **904B** → 904A → 902 1 → MAIN OUT; S-TRIG 1 → 911 1 → 904A `c1`; S-TRIG 2 → 911 2 → 902 1; GATE → the controller's
  GATE IN → S-TRIG OUT → **911 3 → 904B `c1`** (the high-pass opens over a slow attack: the swept band). ≈ 20 cords.
- **Sequence** (the System 55 tile's; Q1 / Q2): Song clock CLOCK (1/16) → 994 A; A → 960 SHIFT, A → 961 V→S 1 `a11`; S-TRIG OUT 1 →
  **911A** (PARALLEL, delays ≈ 2 ms) → OUT 1 → 911 1, OUT 2 → 911 2; 960 ROW A → 921A 1 `f1` and ROW A's second jack → 921 `f1` (16′);
  KBD PITCH 1 / 2 → 921A 1 `f2` / 921 `f2` (hold a key to transpose; C4 = none); 921B 1 saw, 921B 2 rectangle, the 921 saw → CP3A 1 →
  904A → 902 1 → MAIN OUT; 911 1 → 904A `c1`, 911 2 → 902 1 `c1`; ROW B → 904A `c2` (a filter step per stage). The 960's oscillator OFF
  (`os` 0), ROW A ×1: an 8-step minor riff (C C E♭ G C′ B♭ G F = 0, 0, 1.25, 2.92, 5, 4.17, 2.92, 2.08 on the dials). 19 cords.
- **Twenty-four steps**: as *Sequence*, with ROWS A / B / C → **962** inputs 1 / 2 / 3, its OUTPUT → 921A 1 `f1`, the 960's stage 8 OUT →
  962 SHIFT (`s9` SKIP): 24 notes before it repeats.
- **Echo strikes**: S-TRIG 1 → 911 1 (direct), S-TRIG 2 → **911A** (SERIES, delays ≈ 150 ms each) → OUT 1 → 911 2, OUT 2 → 911 3; three
  921Bs on one driver (root, fifth, octave) → three 902s, each opened by its 911 → CP3A 1 → MAIN OUT: a strum per key.
- **Vowel**: two 921B saws → **914** (bands 500 / 1k / 2.8k up, the rest low) → 902 (a slow 911) → MAIN OUT: a vowel-like pad.
- **Step bass**: the **960 as an oscillator** — its own clock at audio rate (RANGE 410 Hz), KBD PITCH → its CONTROL INPUT (the clock
  tracks the keys: the fundamental = clock / 8, ≤ 125 Hz at the 1 kHz top), ROW A (×4) → 904A → 902 (911) → MAIN OUT; the eight stage
  knobs draw the wave.
- **Routed**: the System 55 played as it was built to be — CP3A 1 KEYBOARD (`r1`) routes the pitch to 921A 1, the 993 (`f1 t1 t2 e1`)
  triggers 911 1 and, through the 911A, 911 2, and sends 911 1 to 902 1; only the audio is corded (921B saws → CP3A 1 → 904A → 902 1 →
  MAIN OUT; 911 2 → 904A `c1`): six cords, five lit switches.

### 2.7 Adding a module, as 9b leaves it (D5)

A **plain** type: (1) its `TYPE` + its place in `ORDER` and a Tidy row (`ROWS` or `CONSOLE`); (2) its `SPEC` row, class and `T` entry in
`moog-dsp.js`; (3) its face in `panels/m900b.js` (or a later file joined in `panels/index.js`); (4) its `MOOG_GLYPH`; (5) its golden
cases and `COST.patch` figure. A type that needs **events**, **lamps**, **rear jacks** or **bus rows** declares them in its `TYPE` (the
generic paths of §1.3–§1.6 exist after 9b); a **set** is a `FAMILY.sets` entry; nothing else changes. moog-core.test cross-checks the
three tables (moog-core.test:233), now including `ev`, `lamps` and `rear`.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The engine

### 3.1 `engine.js` (lane E9b) — every line behind the patch guards (D1)

| site | change |
|---|---|
| `seqMsg` (3093–3094) | the routing line learns events: `if (s && (s.pg !== undefined \|\| s.pe !== undefined)) { this.ptMsg(s); return; }` |
| `ptMsg` (2529–2533) | `s.pe` → `this.pm.ev(s.pe[0], s.pe[1])` while the kind is `'patch'` and the machine exists; else dropped (an event never waits in `pmPend`) |
| `postMon` (4737, the graphed branch — a patch track is always graphed, I9 §12 lane H9 P-1) | a patch Inst posts `pt: I.pm.lamps(this.frames)` beside its `smon` when its machine has lamp modules (`pm.lampN > 0`) |
| `warmPatch` / `warmPatchOn` (3753–3790) | generic already (the 16 classes join through `PatchMoog.T`); **the leftovers** (§0.2): enough rounds that `ptRamp`, `outStage` and `renderPatch` reach the optimising tier on V8 (checked with `--trace-opt` in a scratch script) and on JSC (the first quanta measured); the warm graph keeps one module per type (25: a sparse graph was tried and dropped, I9 §12 lane E9 choice 5) plus one event and one lamp read; the gate of §8.3 |
No other Track, Chain, graph, ModCore or protocol code changes; `Ladder`, `Env`, `HP4`, `AVoice` stay untouched.

### 3.2 `patch-dsp.js` (lane V9c) — generic, additive

- `ev(n, k)`: the module numbered n gets event k in a fixed pending queue (8 slots a module, allocated with the module in `graph()`; an
  overflow drops the oldest); the evaluator calls the class's `ev(k)` before its `ctl` at the next chunk; `reset()` clears the queues.
- `lamps(F)` → `{ F, l }` from a preallocated array of the live modules whose type declares lamps (`lampN` their count); `l` a copy
  (the message handler allocates, never `render`).
- Nothing else: rear jacks are ordinary slots; bus rows arrive as cords; a type with no slots (993, CP8A) is never scheduled; the 960 /
  962 / 911A are one-section types (a loop through one of them is a loop step, I9 §3.3).

### 3.3 `moog-dsp.js`: the new circuits (lane V9c; every class written out — the megamorphic lesson, moog-dsp.js:20)

- **904B** — the 904A's control law (moog-dsp's `ex2` of the summed volts, `tanp`, the 0.46 · fs clamp, the input scale 0.25 / output
  × 4: shared helpers, read not edited) and **none of its feedback**: the complementary ladder's stages are buffered [R PAT], so the
  filter is **four independent one-pole TPT high-pass stages** with g per sample (no k, no secant iteration, no second pass); the first
  stage's input through the ladder's soft compression `tr` [C]; railed. Its own class `M904B`. Target cost ≤ 0.003 (the 904A at k 0 is
  0.0051, I9 §12 lane V9b).
- **914** — the 907A's fused form (sections share coefficients, state in registers, OS rate: I9 §12 spike (a) decision 2): 12 bands × 2
  stagger-tuned 2nd-order band-passes at f · 2^(±δ) with Q_s, the low (88.4 Hz) and high (8 kHz) sections 2nd-order: **26 sections** (the
  907A has 36: ≈ 0.0054 expected); δ, Q_s and the polarity fitted by the lane for "flat ± 2 dB at 10" (the 907A's method, RM §10).
  Inputs: the passive pair rule (§2.1: the module knows a patched input from the evaluator's zero buffer, moog-dsp's `zb`). Railed.
- **911A** — two delay timers per sample on the S lines (the 911's `> 0.5` read), coefficients per chunk; S outputs 0 / 1.
- **903A** — `M923`'s noise code copied into its own class (xorshift white at `√(fs / 192 000)` density, Kellett pink), seed `seedOf(salt,
  n)`; its outputs mask-gated (an unread pink is never computed).
- **960** — §3.4. **962** — a selection per sample (edges on SHIFT / TRIGGER IN; events at `ctl`), the output a copy of the selected input
  with `x < −1 → −1`; TRIGGER OUTs constant fills; lamps. **961** — five small sections (§2.3); the one-shot counts samples (40 ms … 4 s
  from `t1` / `t2` per chunk); the comparator's θ per chunk.
- **992 / CP2 / CP4A** pass-throughs (an attenuated copy, a copy); **CP3A** the controller's MIX code re-written (four inputs, master,
  railed ±) plus its ROUTE copy; **CP35** constants + four passive attenuators; **993 / CP8A** classes with no slots; **994** none (the
  evaluator's multiples).
- **Song clock** — §3.4.

### 3.4 The 960, the song's transport and tempo, determinism (D7)

**The 960 (one section).** Per sample, only for patched inputs (the `zb` rule): rising edges (+1.5 V / +1.0 V) on OSC ON / OSC OFF set /
clear the oscillator flip-flop; on SHIFT or the oscillator's wrap → **a shift**; on IN k → **stage k**. Pending events at `ctl`: SHIFT →
a shift, SET k → stage k; a change of the `os` value (the OSC ON / OFF buttons write it: the face's `buttons` pair) sets the flip-flop.
- **The clock**: f = 0.1 · 4^RANGE · 4^(VERNIER / 10) · 2^(CONTROL INPUT + (ROW C → CLOCK ? row C's volts : 0)) Hz, clamped to 0.1 … 1 000
  Hz [R VK-55 range, "1 V = ×2" RM §1.4; C the detents]; a phase per sample while the flip-flop is set; OUTPUT +3.6 V for 90 % of the
  period [R MS-960]; the shift at the rise.
- **A shift**: on a STOP stage → ignored (the sequence holds; SET / IN leave it) [R? CH-960]; else the next stage, passing SKIP stages; after
  stage 8: stage 9 when `s9` is STOP — the flip-flop cleared (the clock stops) [R? BEH-960, CH-960] — else stage 1; all of 1…8 SKIP →
  stays. From stage 9 a shift goes to stage 1. SET k / IN k reach k whatever its mode [C].
- **Outputs**: ROW X = (dial / 10) × 2 · 2^range V of the active stage (stage 9: 0 V) [R VK-55 2 / 4 / 8 V; C stage 9], a step at the
  sample (no BLEP: the RTL steps of the original are not band-limited either; *Step bass* runs through the 904A) [C]; stage OUT k +3.6 V
  while k is active [R MS-960 levels; R? CH gates]; lamps `l_k` and `lo`. Fresh (`reset`, Play from a stop, panic, power-on): stage 1
  [R MS-960 later units' power-on reset], the flip-flop = `os`, the clock's phase 0.
- **Cost**: per sample an edge test per patched input and the phase; outputs written only when read (`om`): ≤ 0.0015.

**The song.** A real 960 free-runs on its own oscillator [R]; the app's other sequencers follow the song (the user's 7a decision: "the
808 follows the song's play button and tempo"). 9b keeps the 960 as the original and adds **our Song clock** module (Q1):
- **SONG** (default): while the transport plays, CLOCK is a 50 % gate on every step (STEP: 1/4 = 960 ticks … 1/16 = 240, 1/32 = 120, 1/8T =
  320, 1/16T = 160 at 960 a quarter); RUN +5 V; RESTART a 5 ms pulse at the first playing chunk after a reset, at a loop wrap and at a seek.
  Stopped: all low (a 960 clocked by it holds its stage). **ALWAYS**: stopped, the same steps at the project tempo (`inst.bpm`'s
  stopped rule, engine.js:3079) from the absolute frame — a free clock aligned to frame 0; playing, the song's.
- **How it reads the song** (span-invariant by construction): its `ctl(cc)` takes the absolute chunk F = 4 · cc and the Inst's transport
  `inst.tp` (engine.js:1653) and computes the tick at the chunk's two ends with the **continuous expression** `t(F) = tp.tick + (F −
  tp.frame) / tp.fpt` (the one `drClock` uses, engine.js:2428–2436), **folding the loop itself** (`tp.wrap` and t ≥ `tp.le` → ls + (t −
  ls) mod (le − ls)) and stopping at `tp.end`; each step boundary k · tps inside the chunk lands on the OS sample `⌈(k · tps − t₀) · tp.fpt ·
  OS − 1e-9⌉`. It never reads `songEvents`' rounded note frames (the known quantum-dependent rounding, §0.2), and because the fold is its
  own, a wrap that the Track handles up to 128 frames late (engine.js:4406–4415 runs at span starts) changes nothing it outputs. A tempo
  change re-anchors `tp` at the current tick: t stays continuous, no RESTART (a jump detector compares t(F) with the previous chunk's end
  tick, ± 1e-6).
- **Play / Stop / tempo, summed up**: Play from a stop **resets the patch** (P-2, engine.js:3089) — the 960 at stage 1, its flip-flop =
  `os`, the clock's state fresh — then a clocked sequence starts on the song's first step; Stop leaves a free-running 960 running (a patched
  MAIN OUT is never quiet, I9 §3.6) and holds a song-clocked one; tempo moves a song-clocked one only. Mute / solo-out powers the patch off
  (P-1): an unmuted sequence restarts at stage 1.
- **Deterministic**: the bounce starts at frame 0 with the transport anchored there (processorOptions), live starts at Play's reset — the
  same chunks either way; golden-moog-b renders *Sequence* live and offline (bit for bit) and at spans 4 / 128 / random with a loop wrap
  mid-span and a tempo change (bit for bit).

### 3.5 Rates, idle, power, panic

As I9 §3.6 for every new type: OS = the track's; a patched MAIN OUT keeps the patch live; panic and Play-from-stop reset every module
(the 960 to stage 1, the 962 to input 1, the 911A's timers and the 961's one-shots to 0, the Song clock to "not started"); events pending
at a reset are dropped.

### 3.6 Old sound bit-identical — how

`golden-moog` (ref-9) is the proof for the Model 15 (D1); the new classes are appended after the existing ones in `moog-dsp.js` (their
`SPEC` rows after `995`, the `ORDER` and `T` entries after the existing ones), the shared helpers unchanged; `patch-dsp.js`'s new paths
are reached only by a type that declares events / lamps; `engine.js`'s by `s.pe` or a lamp module. ref-p1 / 1c / 7a…7d are untouched by
construction (no classic or drum path in the diff); E9b runs every golden after each commit.

### 3.7 CPU: per type and the bench rows

Per type alone (OS 4, 48 kHz, node; JSC within × 1.5; V9c records the measured column in §12 and `COST.patch` takes it) [C, on I9 §12
lane V9b's measures]:

| type | expected | limit | note |
|---|---|---|---|
| 904B | 0.0025 | ≤ 0.003 | 4 one-pole stages + per-sample g (the 904A at k 0: 0.0051) |
| 914 | 0.0054 | ≤ 0.007 | 26 fused sections (907A: 36 → 0.0075) |
| 960 | 0.0008 | ≤ 0.0015 | free clock, rows masked |
| 961 | 0.0003 / section | ≤ 0.0005 / section | |
| 962 · 911A | 0.0004 | ≤ 0.001 | |
| 903A | 0.0010 (JSC ≈ 0.002: the xorshift) | ≤ 0.002 | |
| CP3A mix | 0.0012 | ≤ 0.0015 | the controller's MIX: 0.0011–0.0012 |
| 992 / CP2 / CP4A / CP35 / clk | 0.0002 / section | ≤ 0.0005 / section | |
| 993 · 994 · CP8A | 0 | 0 | never scheduled / the evaluator's |

**New bench rows** (kind `track`, OS 4, 48 kHz, every timed run audible; `bench-scenarios`, `bench.html`'s list, `bench.json` targets):

| row | node | jsc | ipad | what | estimate |
|---|---|---|---|---|---|
| **m9q** | 0.03 | 0.025 | 0.025 | *Sequence* (a sequencer patch) — the Song clock in ALWAYS at 120 BPM (no transport needed in the harness; the same work), 14 live modules | 0.021 (0.0055 base + the modules) |
| **m9s** | 0.055 | 0.05 | 0.05 | a System 55 classic patch: all seven oscillators (6 921Bs on 2 drivers + the 921) → two CP3As → 914 → 904B → 904A (regeneration 6) → two 902s; five 911s routed by the 993's bus rows (two through the 911A); a mono note line | 0.041 |
Targets ≈ 1.3 × the estimate, the I9 spike (a) rule; **JSC A/B** (the lead; `engine.js` changed): c1, d, e, mc0, mt, d8p, d9p, dvp, m9p,
m9x, m9d within 3 %; **V8**: every existing row within 2 % (`cpu-gate`). `cv-cost`: `COST.patch[type]` for every new type (sectioned ones
per section), `patchLoad(cs, rec, vals)` over `liveNodes(rec, f, vals)`.

### 3.8 `graph()` at System 55 scale

`graph()` runs on the audio thread at a plug / pull / switch flip (I9 §12 spike (a) decision 5): V9a measured 0.08–0.11 ms warm (13
modules), max 0.4 ms with a transition plan. A System 55 holds ≈ 3 × the modules: expected ≈ 0.25 ms median, ≈ 1 ms worst. Spike (a2)
(§5) measures it over the real `patch-dsp.js`; **rule**: warm median ≤ 0.5 ms and max ≤ 1 ms on JSC → as built; else V9c keeps the
schedule when a change touches no edge class (a value-only bus flip that adds / removes one input's source re-wires that input and
leaves the order — the transition plan only for real topology changes) and re-measures. A set tile's first `graph()` (37 modules built
cold) is a one-off at a Replace, under its crossfade.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The canvas

### 4.1 Faces (`panels/m900b.js`, lane P9b)

- Sixteen layouts in `panels/m900.js`'s house treatment (black panels inset in a silver frame, cream legends, the number at the foot,
  knurled knobs; I9 §12 lane P9), keyed by `TYPES[t].layout`, merged into `MODULE_LAYOUTS` by `panels/index.js`. **No photograph
  fetched or viewed**: every face from §2's control and jack lists and widths; the stand-ins' plates say so (CP4A, CP35, CP2, the Song
  clock: "OURS"); the trunk jacks and the CP8A's controls drawn at the inert contrast ("not emulated", the 1b+ rule).
- **cv-panel** (generic): a `{ kind: 'button', ev: '<id>' }` control = an event button (validated against the type's `ev`, ≥ 14 mm hit, no
  value, listed in `geometry().evs` with its hit box); a `{ kind: 'lamp', lamp: '<id>' }` = a live lamp (validated against `lamps`, in
  `geometry().lamps`, drawn unlit in the art); `rear` jacks never placed and skipped by "every jack placed"; faces with no params or no
  jacks valid. Routing switches are ordinary `S` params on a lit-switch style (their value shows; P9b's style).
- **The 960's face** (8 MU, 431.8 × 222.25 mm): a clock column (OSC ON / OFF buttons + lamp, RANGE, VERNIER, ROW C → CLOCK, SHIFT button,
  jacks ON · OFF · SHIFT · CONTROL INPUT · OUTPUT), nine stage columns of ≈ 37.8 mm (lamp, three knobs, mode switch, SET, IN, OUT; stage 9
  without knobs), a row column (three range switches, six jacks): every rule met (the 15 mm jack pitch, the 9 mm clearance, 14 mm hits).
  **The 961** (console 3 MU): two 6 × 2 jack blocks with their S outputs and SWITCH ON TIME knobs, the S → V pairs, the audio comparator.
- Sizes: §2.1's rule; module + bar (I9 §2.2).

### 4.2 DOM and GL budget for a System 55-sized rack

| measure | anchor (measured) | System 55 (estimate, §5 measures) |
|---|---|---|
| painted elements (live layer, no face SVG) | Model 15 set 408; 48 small modules 1 332 (the lead's figures); `ui-m9-mac` m30 1 226 | 33 plain modules × ≈ 28 + 960 ≈ 140 + 961 ≈ 70 + 914 ≈ 45 + CP3A × 3 ≈ 120 ≈ **1 300** (gate ≤ 1 700) |
| per module | I9 §4.1: a 1 MU module ≤ 90, the controller ≤ 160 (cv-patch.test:538) | the 960 ≤ 220 (40 controls, 10 buttons, 10 lamps, 29 jack spans, bar); the 961 ≤ 120; the 914 ≤ 100; a console panel ≤ 90 |
| GL face textures (dpr 2) | 1 MU 1.29 MB, the console (8 MU) 5.75 MB (I9 §12 P9); m30 47.7 MB; hw5 171.7 MB | 27 1 MU + 921 + 914 + 960 ≈ 52 MB; seven console faces ≈ 22 MB: **≈ 74 MB** (`FACE_BUDGET_BYTES` 384 MB, cv-face.js:23) |
| cords | the buffer is the viewport's (13.4 MB at 1440 × 900); ≤ 128 cords | *Sequence* 19 cords |
| the S0 iPad envelope | sx1 1 866 P+ · hw5 ≈ 2.8 k borderline · p1x 3 176 one frame over (`ui-m3`); `PT_HEAVY` = 1 866 (main.js:6317) | under sx1's line on paper — **but no scene ≥ 20 patch modules has run on the iPad** (`ui-m9` pending): §5 gates the UI lanes on it |

### 4.3 The tray

- The **m15** section of the Moog view holds the Model 15 model tile (unchanged) and **two set tiles, System 35 and System 55** (a `sets`
  row of their own: cv-tray `o.sets`, `o.setPick(id, mode)`, `o.setDrag`, `setSetPlaced(id, why)`; not model tiles — `tiles()` stays the
  synths, cv-tray.test:293 / 796). Their art: cv-art `SET_ART.s35` (a wedge cabinet: two tiers of module faces over a console strip) and
  `SET_ART.s55` (two cabinets: sixteen faces over fourteen, the 960 wide among them, a console strip; a few cords) — ours, no text, no
  logo; `SIL` keys stay = MODELS ids (cv-art.test:25–80). Labels "System 35 · 22 modules", "System 55 · 37 modules"; a set tile greys with
  its reason when the shown patch cannot take it ("This set needs N more modules than the patch can hold").
- The module row: groups **Sources** (921, 921A, 921B, 923, 903A) · **Modifiers** (904A, 904B, 907A, 914, 902) · **Control** (911, 911A,
  995, 994) · **Sequencing** (960, 961, 962, Song clock) · **Console & routing** (CP2, CP3A, CP4A, CP35, CP8A, 992, 993) — 25 tiles, each
  with its `MOOG_GLYPH` (ours, from our faces) and its load label. The view's note: "Model 15, System 35 and System 55 bring a whole set,
  patched. Drop a module onto a 900 Series track to add it. The Moog Modular (a fixed patch) stays in Hardware."

### 4.4 Tidy: two cabinets and a console row; the camera

- `ROWS[0]` (sources and sequencing) = 921 · 921A · 921B · 923 · 903A · 995 · 994 · 960 · 962; `ROWS[1]` (modifiers and envelopes) = 904A ·
  904B · 907A · 914 · 911 · 911A · 902 · 992 · 993 (the Model 15 types keep their relative order: a Model 15 Tidy is unchanged);
  **`CONSOLE`** = CP2 · CP3A · CP4A · CP35 · 961 · Song clock · CP8A — console-height modules, **in a row flush above the controller** (dy
  −352), the two cabinet rows above it; the controller stays the instrument module at the foot, so the FX panel and OUT keep their place
  to its right (cv-module tidy, I9 §4.5).
- **The width**: `fam.rackW` 1024 while the patch holds ≤ 16 modules and no console module (the Model 15: unchanged, the existing
  rackLayout tests hold); else **`fam.rackWide` = 2 816** (a 22 MU cabinet row at 128 px a 1 MU module [R RM §1.1]): the System 55's rows
  (2 624, 2 368, the console 2 496 px) and the System 35's (1 120, 1 376, 1 920) each fit one line. `freeSlot` places a console module in
  the console row's first free place. Tidy's pinning (I9 §12 lane U9: an add pins the rest) keeps a rack still when the 17th module
  changes the width.
- **The camera**: I9's top-anchored rule (review 2 F2: k = max(READ_K, fit), the rack's top at the band's top + 24) frames a 2 816 × 1 728
  System 55 rack at k 0.5 — the source row whole on a 1440 × 900 window, the iPad's landscape band showing row 1 and part of row 2; the
  minimap and Fit as stage 9.

### 4.5 Buttons and lamps on the canvas (lane U9b)

- An event button is a transparent `button.cv-pev` over the face (the face jacks' form, I9 §4.2): it fires on **release** of a tap (≤
  TAP_PX, no second finger — a second finger cancels it and pinches, gesture.js's rule); Enter / Space fire it; it sleeps below READ_K like
  the controls; `aria-label` "960 1 · SET 3". The OSC ON / OFF pair writes `os` (the knob policy).
- A lamp is a `span.cv-plamp[data-on]` over the face, lit from the monitor's frame queue (the drums' `mq`, cv-drum.js:357, 387); reduced
  motion: no glow; lamps of an off-screen module are not updated (the monitor's on-screen rule).

### 4.6 Notices

The patch line of I9 §4.7 at §5's measured count (`PT_HEAVY`); the System 55 tile (Q2's default, the Song clock in SONG): once, "The
sequence starts when you press ▶" .

### 4.7 What 9b does not do

The 1960s modules (9c); per-voice patches; canvas modulators into a patch (a "CV IN" module later); the duophonic 953 (our controller stays
mono: "FROM 2" / PITCH 2 carry the same voice); trunk lines (drawn, not emulated); the CP3A's click filter (not confirmed); a quantiser on
the 960's rows (the original has none; RM §8's emulation half-volt steps not built); BLEP on the 960's steps.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Phase 0

| spike | builds | measures | decides |
|---|---|---|---|
| **(a2) the evaluator at System 55 scale** (lane A2, the lead's scratchpad `9b/a2/`) | the real `patch-dsp.js` over stub classes of the right cost (the patch-dsp.test stub family) on a 37-module payload (*Sequence*, m9s), with a bus-row flip and a cord plug | `graph()` cold / warm / with a transition (V8 and JSC); the first quantum after a set tile's graph; a 960-like one-section class in a 3-member loop per sample | §3.8's rule; m9q / m9s targets confirmed |
| **(b2) a System 55 rack on the iPad** (lane S9b: `tests/ui-bench.html?m9=1` + `tests/ui-bench-m9.mjs`) | scenes **`s55`** (37 stand-in faces at their 9b sizes — a 960-sized 8 MU face with 40 knob widgets, 10 button and 10 lamp spans, 29 jack spans; seven console-height faces —, 40 cords asleep), **`s55w`** (a module drag waking 8 cords, then all swaying, pinching 25–200 %), **`s55h`** (s55 with the hidden face SVGs dropped) beside stage 9's scenes | M0 / M1 as I9 §5 (b) / (c); painted counts, GL MB, glue | §4.7's notice line; the hidden-SVG hygiene for `'pm'` faces; whether the UI lanes proceed |

**The user's session** (≤ 30 minutes, plugged in, other apps closed; after the CDP run records `"ui-m9b-mac"`): **the pending stage-9
session and 9b's in one visit** — `canvas.domlavin.com/tests/ui-bench.html?m9=1`: the hand protocol on `hw5`, `m13`, `m13w`, `m20`, `m30`,
**`s55`, `s55w`** (and `m30h`, `s55h`, `m13s` if the others fail), Copy results → `tests/bench.json` `"ui-m9"`.

| (b2) on the iPad | decision |
|---|---|
| `s55` and `s55w` P+, glue ≤ 1 device px | as contracted; `PT_HEAVY` = the largest P+ scene's painted count |
| `s55` P, `s55h` P+ | the hidden-SVG hygiene for `'pm'` faces joins P9b / U9b |
| `s55` fails, `m30` passes | the 960 face's live layer is profiled first (its 80 + elements) and cut (lamps as one GL quad set?) before U9b |
| `m20` / `m30` already fail | stop: the many-modules question reopens (the IMPL-3 "opacity0" probe) before any 9b UI lane |
| glue fails | `?cords=under` becomes the default (the switch exists); the look trade told to the user |

---------------------------------------------------------------------------------------------------------------------------------

## 6. Host wiring (`main.js`, lane H9b)

| site | change |
|---|---|
| `patchNew` (175–180) | `(t, dev, type, set)`: a set id → `MG.makeSet(set, d.vals)` (the Model 15 path = `makeSet('m15')`, bit-identical) |
| `ptSet` (6785–6790) | `ptSet(id = 'm15')` → `PATCH.preset(fam.sets[id].starter, { ensure: fam.sets[id].set })` |
| the tray (5075; `moogPick` / `moogDrag` 6791–6820) | `sets: cvTray.SET_TILES`, `setPick(id, mode)` (a 900 Series shown: `ptSet(id)`; else Replace / + Track with `{ set: id }`), `setDrag` (as `moogDrag`, its ghost the set's rack outline), `setSetPlaced` from `PT.setNeeds` at each render (`ptTray`) |
| `srcModeUI` moog branch (4929) | the text names the set tiles (I9 review 2 F4's form) |
| `patchPayload` (3475), `syncedOf` (4269), `costLabels` | `PT.payload(rec, rec.f, vals)`, `PT.live(rec, f, vals)`, `COSTM` with vals |
| `ptKnob` (6758–6768) | after the write: `if (PT.isBusKnob(rec, mid, id)) patchSend(t, dev)` (at once; `pk` changes) |
| `applyRestore` (its `ptBack`, I9 §12 lane H9) | after `ptBack` puts knobs back, `patchSend(t, dev)` (pk-guarded): a preset step's bus switches change the graph too |
| `ptEv(t, dev, mid, id)` (new; cv-patch's `H.ev`) | the node's `{t: 'seq', i, s: { pe: [n, k] }}` (k from the type's `ev`); nothing when no node |
| the lamp monitor (beside `drumMonitor`, 3695–3703) | `monitors.sub` for a shown 900 Series whose on-screen modules declare lamps; `deliver: d => d.pt && PATCH.lamps(t, dev, d.pt)` |
| `PT_HEAVY` (6317) | §5's measured line (else stays sx1's) |
| a System 55 load (Q2) | the notice of §4.6, once a session |
| `__synthTest.cv` (7815) | `setPick`, `setDrag`, `ptEv`, `ptLamps` for the sims |
| `keepDevs`, the History, `cvCamRestore`, `cvFitHook` | **unchanged** (switches are knobs; the camera rule holds for a bigger rack) |

---------------------------------------------------------------------------------------------------------------------------------

## 7. Lanes, schedule, interfaces

### 7.1 Lanes (the leaner shape: contract → skeptic review → builders in worktrees reset to the base → two reviewers → failing-test-first fixers → one sweep)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **A2** spike | 0 | the lead's scratchpad `9b/a2/` (nothing committed but §12's report) | §5 (a2) | cheaper |
| **S9b** iPad page | 0 | `tests/ui-bench.html` (the `?m9=1` route's new scenes), `tests/ui-bench-m9.mjs` | §5 (b2); CDP → `"ui-m9b-mac"` | cheaper |
| **K9b** tables + core | 1a, **first** (its tables commit lands before V9c / P9b / U9b start) | `moog-core.js` (16 types, `ORDER` / `ROWS` / `CONSOLE` / `GROUPS`, `FAMILY.sets`, `S35` / `S55`, `makeSet`, the 7 presets, `bus` / `ev` / `lamps` / `rear`), `patch-core.js` (rear jacks out of cord paths, bus rows in `payload` / `live` / `liveNodes` / `wiring` with `vals`, `isBusKnob`, `loadSet(id)`, `setNeeds`, `rackLayout` / `freeSlot` console row + width), `tests/moog-core.test.mjs`, `tests/patch-core.test.mjs` | §8.2 | standard |
| **V9c** circuits + evaluator | 1a | `moog-dsp.js` (16 `SPEC` rows, classes, `T`, `EV`, `LAMPS`), `patch-dsp.js` (`ev`, `lamps`), `tests/moog-dsp.test.mjs`, `tests/patch-dsp.test.mjs`, RM (§2.2 corrections, §8 updates, §9 new codes, §10 rows) | §8.1 | standard |
| **E9b** engine + plumbing | 1a (after V9c's first commit; stubs before) | `engine.js` (§3.1), `cv-cost.js` + `tests/cv-cost.test.mjs`, `tests/bench-scenarios.mjs`, `tests/bench.json` (targets), `tests/bench.html`, `tests/engine-track.test.mjs`, `tests/golden-moog-b.test.mjs` (new) | §8.3 | standard |
| **P9b** faces | 1a (after K9b's tables) | `panels/m900b.js` (new), `panels/index.js`, `cv-panel.js` (event buttons, live lamps, rear jacks, empty faces), `tools/panel-check.mjs`, `tests/cv-panel.test.mjs`, `tests/cv-face.test.mjs` | §8.4 | standard |
| **X9b** set art | 1a | `cv-art.js` (`SET_ART`), `tests/cv-art.test.mjs` | the art tests | cheaper |
| **U9b** canvas UI | 1b (after §5's session and K9b's merge) | `cv-patch.js` (event buttons, lamps + their frame queue, the bus switch tip), `cv-tray.js` (set tiles, groups, 16 glyphs, the note), `style.css` (lamps, buttons, set tiles), `tests/cv-patch.test.mjs`, `tests/cv-tray.test.mjs`, `tests/canvas-sim.test.mjs` | §8.5 | standard |
| **H9b** host | 2 | `main.js` (§6), `tests/canvas-9b-sim.test.mjs` (new, accessor-free), `tests/canvas-9-sim.test.mjs` (its tile list), `tests/main.test.mjs` | §8.6 | standard |
| reviewers × 2 | 3 | (1) **real engine**: D1 (every ref incl. ref-9), D2 / D7 (the clocked *Sequence* bounced = live, spans 4 / 128 / random with a wrap and a tempo change), every new type against §2's targets, bus rows (ordinals after a delete, flips click-free, OR on S inputs), events at chunk boundaries, presets' headroom, `graph()` at S55 scale; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the System 35 / 55 tiles, the S55 rack (DOM, GL MB, the default camera, Fit), the 960 running with lamps in step, SET / SHIFT by touch and two-finger cancel, bus switches, Tidy, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

No lane touches `cv-cords.js` / `cv-world.js` / `cv-module.js` (cords, the world and module chrome are unchanged: console-height `'pm'`
modules take their size from `host.size`, cv-module.js:146, 304).

### 7.2 Schedule

- **Phase 0**: A2 ∥ S9b; base = `canvas` at this contract's commit. A2's report → the lead fixes §3.7 / §3.8; S9b's CDP run, then **the
  user's session** (§5).
- **Phase 1a**: K9b's tables (one commit) → then K9b ∥ V9c ∥ P9b ∥ X9b ∥ E9b on the holding branch **`wt-9b`**. **Phase 1b** (after the
  session and K9b's merge): U9b.
- **Phase 2**: H9b, the lead's fixture check first (a page sim: the System 55 tile on track 1 → 37 modules, the payload with the bus rows
  of none (all switches off), a note transposes, ▶ starts the sequence: `{t: 'seq', s: { pg }}` then the song; a 993 switch → a new `pk`
  posted, no History step).
- **Phase 3**: two reviewers → fixers → **one sweep** (every test file, one at a time; `golden-*` once) → **listening renders** (each new
  preset, the 904B / 914 / 960 alone; short files) to the user — optional, not blocking (drum-feedback rule) → the lead freezes
  `tests/ref-9b/` → docs (§10) → **one squashed commit "9b"** on `canvas` → `tools/deploy-canvas.sh` → the iPad (§9).
- **Known windows on `wt-9b`**: moog-core / cv-tray / cv-panel / canvas-9-sim pins until their owners extend them; `pwa.test` until the
  lead's `node tools/precache.mjs --write` (new files: `panels/m900b.js`).

### 7.3 Rules for every builder

I9 §7.3, unchanged: `git reset --hard <base>` first and check `git log -1`; `?v=9` on every import; new test files `import
'./v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time (`node --max-old-space-size=2048 --test
tests/<file>.test.mjs`); dense comments in the existing voice; no Moog material and **no photograph viewed**; no lane commits `sw.js`;
report the commit hash and the gates measured. **D1 is every builder's gate**: after any commit touching `moog-dsp.js`, `patch-dsp.js` or
`engine.js`, `golden-moog` (ref-9) and the I9 goldens pass bit for bit.

### 7.4 Interfaces (each lane stubs the other side)

- **moog-core (K9b ↔ all)**: `TYPES[t]` + `ev: [{ id, label }]`, `lamps: [{ id, label }]`, `bus: [{ sw, a, b, g? }]`, jacks' `rear: 1`;
  `ORDER`, `ROWS`, `CONSOLE`, `GROUPS` (+ `seq`, `cp`); `FAMILY.sets`, `rackWide`, `rackN`; `S35`, `S55`; `makeSet(id, vals)`.
- **patch-core (K9b ↔ U9b / H9b / E9b)**: `payload(rec, f, vals)`, `live(rec, f, vals)`, `liveNodes(rec, f, vals)`, `busRows(rec, f,
  vals) → [{ a, b, g, panel, sw }]` (resolved, for tips and tests), `isBusKnob(rec, mid, id)`, `loadSet(rec, vals, id)`, `setNeeds(rec,
  id)`, `rackLayout` / `freeSlot` (console row, width); everything else as I9 §7.4.
- **patch-dsp / moog-dsp (V9c ↔ E9b)**: the machine's `ev(n, k)`, `lamps(F) → { F, l }`, `lampN`; a class's `ev(k)`, `lamp`; `PatchMoog.EV
  [t]`, `LAMPS[t]` (ids in order, = moog-core's); the Song clock reads `h.inst.tp` and `h.inst.bpm` in `ctl(cc)`.
- **cv-panel (P9b ↔ U9b)**: `geometry(L, model).evs` / `.lamps` → `[{ id, x, y, w, h, hit }]` in body px (+ `BAR_H` by the host, I9
  review #27); `moduleModel(type)` carries `ev` / `lamps`.
- **cv-patch (U9b ↔ H9b)**: the host deps gain `ev(t, dev, mid, id)`; `PATCH.lamps(t, dev, { F, l })`; `moduleBody` mounts buttons and
  lamps; the tray gains `o.sets`, `o.setPick`, `o.setDrag`, `SET_TILES`, `setSetPlaced`.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Tests and gates

### 8.1 Circuits (`tests/moog-dsp.test.mjs`, `tests/patch-dsp.test.mjs`, V9c; 48 kHz × 4 and 44.1 kHz × 2)

- **904B** (T-VCF2): 24 dB/oct below f_c ± 1 dB/oct (two octaves under), −12 dB at f_c on both ranges' ends, HIGH = LOW + 1.5 oct ± 1 %, 1
  V/oct tracking, unity passband ± 0.2 dB, no resonance peak (≤ +0.1 dB anywhere).
- **914** (T-FFB2): centres ± 2 %, skirts 12 dB/oct ± 1.5 (2–3 oct out), the 88 / 8 000 Hz sections, all at 10 flat ± 2 dB 20 Hz–20 kHz,
  a band at 0 off (≤ −60 dB at its centre with its neighbours at 0), the input pair rule.
- **960** (T-SEQ1): the clock 0.1 Hz … 1 kHz ± 1 % over RANGE × VERNIER, 1 V/oct on CONTROL INPUT and ROW C → CLOCK, 90 % duty, row maxima
  2 / 4 / 8 V ± 0.1 %, SKIP / STOP / stage 9 (STOP clears the clock, SKIP wraps), SET / IN / SHIFT / OSC ON / OFF (jacks and the `os`
  change), stage OUTs and lamps, fresh = stage 1 with the flip-flop = `os`.
- **961** (T-TRG1): A follows, B one-shot 40 ms … 4 s ± 5 % and retriggered, S → V 4 V, the comparator's θ law; **962**: 2:1 / 3:1 by
  INPUT 3, TRIGGER IN / SET select, OUTs and lamps, the −1 V clip; **911A**: delays 2 ms … 2 s ± 5 %, OFF / PARALLEL / SERIES, an early
  opening cancels; **903A**: white 0.5 V RMS flat ± 1.5 dB, pink −3 dB/oct ± 1; **CP3A** ×2 max, ± outputs, EXT at 10 = unity; **CP35**
  ±6 V, normals; **CP2** one-pole sections; **992** reversible attenuator.
- **The Song clock**: edges on the song's steps at the exact OS sample from the tick expression (hand-computed cases incl. a step on a
  chunk boundary and 1/8T), RUN, RESTART at start / wrap / seek and not at a tempo change; ALWAYS at the project tempo; **span invariance
  with the transport running** (spans 4 / 128 / random, a loop wrap inside a 128-frame span, a tempo change: bit for bit).
- **Events and lamps** (patch-dsp): an event lands at the next chunk whatever the span split; the queue's overflow; `reset()` clears;
  lamps reflect state at F; no allocation in `render` over 200 spans with events posted between them.
- Shared contracts (I9 §8.1): determinism; no NaN / Inf / subnormal (every new knob at its ends, a 960 → 962 → 960 loop at audio rate, a
  961 audio trigger fed by an oscillator into the 960's SHIFT for 10 s); per-type costs (§3.7).

### 8.2 Core (`tests/patch-core.test.mjs`, `tests/moog-core.test.mjs`, K9b)

The tables (ids, sections, defaults, plugs, `rear`, `ev`, `lamps` = PatchMoog's and the faces'; every bus row's ends typed and of one
plug; ≤ 48 params; ≤ 30 outputs; ≤ 16 sections); sets (S35 / S55 lists as §2.5; `makeSet('m15')` = `model15` = loadPreset — the existing
test; `makeSet('s55')` fits 48; loadSet over M15 / S35 adds 27 / 19); **rear jacks** never plugged, never targets, dropped by normPatch
from a cord; **bus rows** (resolved by ordinals; unresolved skipped; a delete shifts them; `payload` with / without vals — without = the
stage-9 payload byte for byte; `pk` changes with a flip only for a bus switch; `live` / `liveNodes` with a 993-routed envelope); the 7
presets (normPatch-valid, headroom −12 … −3 dBFS over PatchDSP + PatchMoog, *Sequence* with a fake transport); `rackLayout` (the
Model 15 cases unchanged; S35 / S55 rows and the console row flush above the controller, width 2 816, every rect on the dots, no overlap);
`freeSlot` for a console module; **a record holding every 9b type round-trips `normPatch` / `pruneVals` unchanged** (§1.1).

### 8.3 Engine, goldens, bench (E9b)

- **D1**: every I9 golden and **golden-moog (ref-9)** bit-identical after every E9b commit.
- `engine-track`: `{t: 'seq', s: { pe }}` reaches the machine (and is dropped for a non-patch Inst, and for a module gone); the `pt` lamps
  in the graphed monitor; the warm-up covers every new class (`warmPatch`'s generic graph), **the scope's warm-up time ≤ 1.15 × stage 9's**
  (V8 ≈ 776 ms → ≤ 893; JSC ≈ 925 → ≤ 1 064) and **each first quantum ≤ ¼ of the deadline** for a System 55 set arriving on a new Track
  (I9's gate extended); `graph()` per §3.8's rule.
- **D2 / D7**: `tests/golden-moog-b.test.mjs` (ref-7d's form): side A = the tree with `tests/ref-9b/`'s copies; cases — each new type
  alone at three settings, the 960 free / song-clocked / at audio rate, the 962 2:1 and 3:1, the 961's four circuits, the 911A's modes,
  every bus row, each new preset with its note line (and the transport for the clocked ones), a graph change mid-sequence, OS 2, 44.1 kHz;
  **D7** (*Sequence* bounced offline = live), **span invariance** (§8.1's clock cases through the whole Track); gate `max |A − B| === 0`;
  freeze `GOLDEN_FREEZE_9B=1 node --max-old-space-size=2048 --test tests/golden-moog-b.test.mjs` by the lead after the listening renders.
- Bench: m9q / m9s (V8; JSC by the lead), cv-cost (`COST.patch` coverage, `patchLoad` with bus rows).

### 8.4 Faces (P9b)

`validate` (one mutation per new rule: an `ev` button not in the type's list, a lamp twice, a rear jack placed, a face with no params);
`panel-check` on every new type (the 14 mm rule, 15 mm pitch, no maker word); `geometry().evs` / `.lamps`; sizes (4 MU 448 × 512, 8 MU 864
× 512, console 2 / 3 / 4 MU × 352); every existing panel and module face unchanged (P9's snapshot method, I9 §12 lane P9: hash before /
after).

### 8.5 UI (U9b)

Event buttons (a tap fires on release; a second pointer cancels; Enter fires; asleep below READ_K; no History step); lamps (lit from a
queued `pt` message at its frame; reduced motion); set tiles (tap / drag paths, greyed with the reason); the Moog row (25 tiles, five
groups, glyphs); DOM per module (§4.2: the 960 ≤ 220, the 961 ≤ 120, the 914 ≤ 100, a console panel ≤ 90; the existing ≤ 90 / ≤ 160).

### 8.6 Host (`tests/canvas-9b-sim.test.mjs`, H9b, accessor-free)

System 35 / 55 tiles on another track (Replace, tap to undo, the rack laid out: console row above the controller) and on a 900 Series
(a preset step; undo gives the topology and the knobs back); a set tile greyed at the cap; a bus switch → `pk` posted, no History step,
undo of a cord pull keeps the switch; a SET tap → `{t: 'seq', s: { pe }}`; lamps delivered to the 960's face; ▶ starts *Sequence* (the
song's transport into the node), ■ holds it; mute → off (P-1) and back at stage 1; save / reload identical (schema 12); a bounce of
*Sequence* includes it; a project without a 900 Series posts exactly today's messages (`canonical-stream`).

### 8.7 Rendering and the iPad (reviewer 2, the user)

The System 55 rack GL vs `?nogl`; G1 `equalPx` with the 960's lamps lit (lamps are DOM: they follow the compositor as the jacks do); the
painted count ≤ 1 700; GL ≤ 90 MB; a pan / pinch at 60 fps on the Mac with 20 cords; the default camera and Fit; no console error.

### 8.8 Pins that change (none weakened; each extended to the new truth)

moog-core.test:38–41 → params 0 … 48, the list of types over 16 pinned (`['960']`) and of types with none (`['903a', '962', '993', '994',
'cp8a']`); :127–133 → the new `ORDER` / groups / tiles / shorts; :130 → `ROWS` + `CONSOLE` = `ORDER`; :168–169 unchanged (the m15 set);
patch-core.test:156 → an unknown type `'999'` (914 is real now); cv-tray.test (the Moog row: 25 tiles, five groups; :1161 glyphs);
cv-patch.test:538 (+ the 960 / 961 / 914 lines); cv-panel.test (module faces 10 → 26); cv-face.test (new sizes); canvas-9-sim (the
view's tiles: + the set tiles and 16 modules); cv-cost.test (coverage). No MODELS-iterating test changes (no new model).

---------------------------------------------------------------------------------------------------------------------------------

## 9. Bench rows and the iPad (after deploy)

`canvas.domlavin.com/tests/bench.html` five passes → `tests/bench.json` `"ipad9b"`: c1–c6 and the engine rows within 5 % of the newest
valid run, **m9p / m9x / m9d** and **m9q / m9s ≤ their iPad targets**, `stale: false`, the deployed build (it also records stage 9's and
the drums' rows if still missing — IMPL-8 §15.11's rule). **Hands-on**: the System 35 tile (play *Swept band*), the System 55 tile (▶:
*Sequence* runs in time; hold a key to transpose; turn a stage knob; SET / SHIFT; a 993 switch; the 962 in *Twenty-four steps*), a pinch over
the whole rack, *Step bass*.

## 10. Docs to update (the lead, at the end)

ROADMAP row 9 (9b's status, the answers to §11) and the feedback table; HANDOVER §3 (the 9b row), §4 (sets, rear jacks, bus rows,
events, lamps, the Song clock, `panels/m900b.js`), §5 (lessons); RM §2.2 (the System 35 without a 995; the 961 as 961CP), §3 (the new
facts above), §8 (904B 1½ oct; the 960's two jacks per row parallel; the 961's S → V count), §9 (the new source codes), §10 (as modelled:
V9c's rows); SUMMARY.md (plain language); this file's §12 / §13.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Questions for the user

Each has the answer the build uses until you say otherwise.

1. **Should the 960 sequencer play in time with your song?** *Recommended:* the 960 keeps its own clock knob like the original (it runs
   at its own speed when you press its OSC ON), and we add a small **Song clock** panel of ours that sends your song's beat as pulses —
   one every 16th note (or 8th, quarter …) while the song plays, plus a "running" signal and a "restart" pulse at the loop start. Patch it
   into the 960 and the sequence follows ▶ / ■ and your tempo, and a recording or bounce comes out exactly as you heard it. The System 55
   comes patched that way. *Alternative A:* a SYNC switch on the 960 itself — one less cord, but it puts a control on the 960 that the
   original never had. *Alternative B:* the 960 free-running only, as in 1973 — authentic, but its steps never line up with bars, so it is
   hard to use in a song.
2. **What should the System 55 tile sound like?** *Recommended:* an **8-step sequenced bass** (*Sequence*) that starts when you press ▶ and
   follows the tempo; hold a key to transpose it; a one-time note says "The sequence starts when you press ▶". *Alternative A:* the Song
   clock on ALWAYS, so the sequence starts the moment you add the System 55 — instant sound, but it keeps playing until you stop or mute
   the track, even while the song is stopped. *Alternative B:* a keyboard-played sound like the Model 15's *Classic bass* — plays at once
   from the keys, but doesn't show the sequencer (it's one tap away in Patches… either way). (The System 35 tile plays *Swept band* from the
   keys — no question needed.)
3. **Is 48 modules per patch enough?** *Recommended:* **keep 48**. A System 55 uses 37 (with the Song clock); Moog's extra sequencer
   cabinet (two more 960s, a 961, two 962s, multiples) still fits. *Alternative:* raise it to 63 (the engine's own ceiling) — nothing we
   ship needs it yet, and every module past what the iPad session measures risks stutter when zooming.

**Things you will notice (no decision needed)**: two new tiles, **System 35** and **System 55**, beside Model 15; sixteen new module tiles
in five groups; a big System 55 rack (two cabinet rows, the console panels in a row above our controller) that opens at 50 % with the top
row in view. **Routing switches**: the 992, 993 and the CP3A / CP4A panels route the keyboard and the envelopes **behind the panel** like
the originals — a lit switch is a connection, **no cord is drawn**; they follow positions ("the second 911"), so deleting a 911 moves the
routing to the next one. Trunk jacks and the CP8A's power switch are drawn but not working (as on today's hardware panels: "not
emulated"). The CP4A, CP35 and CP2 are **our stand-ins** where no source says exactly what is on them, and say so. The 960's lamps follow
the music; SET and SHIFT act when you lift your finger (a second finger cancels, as everywhere); its knobs are plain voltages, as on the
original — on ×1 a semitone is about 0.42 of a dial number (the starting patches are tuned for you). Pressing ▶ restarts a sequence at
stage 1; ■ leaves a free-running 960 running (mute or ⏻ silences it); unmuting restarts it at stage 1. The 962 clips large negative
voltages (built for positive control voltages). The controller is unchanged (with LOW priority and MULTIPLE triggering a higher key still
retriggers the envelopes — as decided in stage 9). A 9b project opened by an older build keeps every module but plays only the Model 15
ones.

## 12. Notes (the builders fill in)

### Spike (a2)
### Spike (b2) / the user's session
### Lane K9b
### Lane V9c
### Lane E9b
### Lane P9b
### Lane X9b
### Lane U9b
### Lane H9b
### Reviews and fixes
### Acceptance

## 13. Review log

### The skeptic review
