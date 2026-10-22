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
  rows of the existing types) are **not edited** — 9b appends rows and classes; `patch-dsp.js`'s chunk loop and every stage-9 path
  compute as before — its additions (`ev`, `lamps`) run in the message handler and the monitor (§3.2); `engine.js` only lines behind
  `kind === 'patch'` / `s.pe !== undefined` / `pm !== null` (§3.1). **ref-9 freezes the three DSP files only**: golden-moog's side A
  takes the *current* `moog-core.js` / `patch-core.js` (tests/golden-moog.test.mjs:1–6, 31–32, 86), so K9b's edits to `model15` /
  `loadPreset` / `payload` would change both sides alike — the Model 15 **records** are pinned separately (§8.2's frozen-record pin,
  skeptic #1).
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
  the Model 15 types it knows (the rest "needs a newer version of the app", cv-patch.js:621–624). **Verified by reading** (the skeptic):
  stage 9's `TYPE_RE` (patch-core.js:54) takes every new id (`cp35`, `clk` included), an unknown type's cords are kept by port shape
  (:96, :143–149), its sizes fall back to 1 MU (cv-patch.js:454) — a 960 sits 128 wide in an old build, cosmetic. A test pins it **with
  stage 9's own `patch-core.js` / `moog-core.js`** (`tests/ref-9-core/`, §8.2) — run through the new code, where every type is known,
  it would prove nothing.

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
  unpatched (patch-core.js:445). **A System 35 / 55 tile on a 900 Series also lays the whole rack out (Tidy: every module's lay entry
  replaced by `rackLayout`) in the same step** — up to 27 added modules "in free slots" beside a Model 15's pinned 1 024-wide rows
  is not a System 55 rack (skeptic #12); undo gives the old places back (lay is History's). The Model 15 tile is unchanged.

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
  the old 911 2 the first (as a cabinet slot would). Said in §11. **Selecting a routing panel outlines the modules its lit, resolved
  rows reach** (cv-patch `members`, cv-patch.js:582–586 — today a 921A's 921Bs; skeptic #25): the hidden connections and their
  ordinal binding are visible on demand (what to draw beyond that is **P-1**).
- **A preset (and a set tile) replaces the bus rows with the cords** (skeptic #6): `loadPreset` writes **every bus switch of every
  module in the patch** — the preset's value on the panels it binds, off on the rest — and puts them in `back`; else a 993 left lit
  routes 911 1 into the preset's 902 1 (`loadPreset` writes bound modules only, patch-core.js:455–464) and a preset is no longer "a
  whole sound" (I9 §12 lane K9). `initPatch` already writes every knob.
- **Bounds** [C]: cords + resolved rows ≤ 256 (the evaluator's `MAXC`, patch-dsp.js:82, 201 — beyond it the evaluator drops
  connections in payload order, cords included): rows past the bound are skipped, their switch's tip says so (a hostile record of 40
  992s × 4 rows would reach it). **No bus row ends on a normalled input** (moog-core.test checks): a row arrives as a cord and the
  evaluator marks the slot plugged (patch-dsp.js:203), which breaks the normal — the rear bus does not on the hardware (skeptic #33).
- Host: `ptKnob` (main.js:6758) writes the value and, **when the param is a bus switch of its type** (`PT.isBusKnob(rec, mid, id)`), posts
  the graph at once (`patchSend`; a flip is discrete, not a drag) beside the throttled `{t: 'patch'}`. A preset that names a switch writes
  it with its `back` meta (I9 §1.5).

### 1.5 Momentary events (generic)

The 960's SET 1…9, SHIFT and **OSC ON / OSC OFF** buttons and the 962's SET 1…3 store nothing [R VK-55 "manual shift button and
manual trigger buttons for each of the 8 stages"; R VK-55 962 "manual switch buttons"; R? CH-960 OSC ON / OFF]. A type may declare
**`ev: [{ id, label }]`**; the face's `{ kind: 'button', ev: '<id>' }` posts **`{t: 'seq', i, s: { pe: [n, k] }}`** (n the module number,
k the event's index) — routed by shape like `pg` (engine.js:3093–3094), handed to `pm.ev(n, k)`, **which calls the module's own
`ev(k)` at once** (the class keeps it in a fixed ring, 8 slots, overflow drops the oldest) and the module applies it at its **next
chunk's `ctl`** — messages are handled between quanta, so that is the next quantum's first chunk: deterministic per chunk with no
queue and no per-chunk check in the evaluator (skeptic #17). Live only: not recorded in the song, not in a bounce, no History, not in
`vals` [C]. An event for a module that no longer exists is dropped; `reset()` clears the ring. **OSC ON / OFF are events, not a
stored `os` value** (skeptic #5): a stored value that "sets the flip-flop when it changes" could not restart a clock that stage 9's
STOP or an OFF jack cleared while `os` still read ON (writing ON again is no change), and its lit button would contradict the stopped
clock.

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
| **960** Sequential controller | **8** | stage knobs `a1…a8` (row A) · `b1…b8` · `c1…c8` 0…10 (0) · modes `s1…s8` [STOP NORMAL SKIP] 1 · `s9` [STOP SKIP] 1 · row ranges `ga gb gc` [×1 ×2 ×4] 0 · clock `rg` RANGE [0.1 0.4 1.6 6.4 26 100 410 Hz] 2 · `vn` VERNIER 0…10 (2) · `cc` ROW C → CLOCK [OFF ON] 0 · `os` CLOCK AT START [STOPPED RUNNING] 1 (the flip-flop's fresh state: reset, Play from a stop, power-on — a small switch; skeptic #5) — **40** | `on` OSC ON · `off` OSC OFF · `sh` SHIFT · `ci` CONTROL INPUT (in v) · `co` OUTPUT (out v) · `i1…i9` stage IN (in v) · `o1…o9` stage OUT (out v) · `ra1 ra2` ROW A · `rb1 rb2` · `rc1 rc2` (out v, pairs one buffer) — **29**, one section · events `on` OSC ON, `off` OSC OFF, `sh` SHIFT, `e1…e9` SET — **12** · lamps `l1…l9`, `lo` OSC (the flip-flop) — **10** | §3.4 (the clock, the stage logic, the transport) | [R VK-55 (3 × 8, per-stage normal / skip / stop, a ninth stop / skip position, ×1 / ×2 / ×4 = 2 / 4 / 8 V, shift input + button, manual buttons per stage, clock 0.1 Hz … 1 kHz with octave + vernier, one control input, one ≈ 90 / 10 rectangular output, trigger ins / outs below each column, two parallel outputs per row, row 3 → clock), MS-960 (column outs +3.6 V; a set resets the others; power-on reset to column 1 on later units; 90 % duty; row 3 "can be switched" to the clock); R? CH-960 (stage 9's jacks, OSC ON / OFF jacks, gates while active, stop holds), BEH-960 (stage 9 turns the oscillator off), MG-960 (56 HP ≈ 7 MU); C 8 MU (§2.5), the RANGE detents, the defaults] |
| **962** Sequential switch | 1 | — | `i1 i2 i3` SIGNAL INPUT (in v) · `q1 q2` OUTPUT (out v, one buffer) · `t1 t2 t3` TRIGGER IN (in v) · `o1 o2 o3` TRIGGER OUT (out v) · `sh` SHIFT (in v) — **11**, one section · events `e1 e2 e3` SET · lamps `l1 l2 l3` | one input at a time to the output; SHIFT steps 1 → 2 → 1 …, or 1 → 2 → 3 when INPUT 3 is patched; TRIGGER IN k / SET k selects k; TRIGGER OUT k +3.6 V while k is selected; a negative excursion clipped at −1 V (built for positive CVs: bipolar passes under 2 Vpp) | [R VK-55 (2 or 3 inputs, a plug in 3 adds the third, V-trigger in / out per stage, buttons, a light per stage), MS-962 (positive-only, the 2 Vpp / negative clip; 1 MU); R? CH-962 (two output jacks, 5 V gates); C the clip shape, 3.6 V] |
| **992** Control voltages | 1 | `s1 s2 s3 s4` KEYBOARD · WHEEL · PRESSURE · EXT [OFF ON] 0 · `at` EXT ATTENUATOR −10…+10 (0) | `x4` (in v) EXT IN · `xr` (out v, **rear**) — **1** on the face | bus rows → the 904B's control (§2.4); `xr` = x4 · at / 10 (reversible) | [R VK-55 ("routes up to four control voltages to the 904B; the fourth input has an inverting attenuator"); R? MS-992 (the 904A), C our controller's three CVs for "keyboard, ribbon …"] |
| **993** Trigger and envelope voltages | 1 | `f1 f2` FROM 1 / FROM 2 · `t1 t2 t3` TRIGGERS · `e1 e2 e3` ENVELOPES [OFF ON] 0 — **8** | — (no jack) | bus rows only (§2.4); no DSP (a class with no slots: never scheduled — but a class, §3.3) | [R MS-993 (8 switches, no jacks, three 100 kΩ in the envelope paths), VK-55; C g 1 for the resistors] |
| **994** Dual multiples | 1 | — | `a1…a4` (any) · `b1…b4` (any) — **8**, two sections | passive: the evaluator's multiples (I9 §1.3; review 1 F2) — its class has no slots but **must exist** (§3.3) | [R MS-994 (two groups of four)] |

### 2.3 The console panels (console height 142.875 mm; trunks drawn, not emulated) and our Song clock

| type | MU | params | jacks (secs) | behaviour | tags |
|---|---|---|---|---|---|
| **CP3A** Mixer and routing | 4 | `x1…x4` LEVEL 0…10 (7) · `ms` MASTER 0…10 (5: ×1; 10: ×2) · `r1…r4` ROUTING KEYBOARD · WHEEL · PRESSURE · EXT [OFF ON] 0 · `ra` EXT LEVEL 0…10 (10 = unity) | MIX `m1…m4` (in) · `mo` MIX + · `mn` MIX − (out) — sec 0 · ROUTE `x4` EXT IN (in) · `xr` (rear out) — sec 1 · MULTIPLE `a1…a4` (any) — sec 2 — **11** + 4 trunks inert | mix = Σ m_i · x_i / 10 × ms / 5, + and − railed; bus rows r1…r4 → its driver's `f3` (§2.4) | [R VK-35 / VK-55 (4 × 1 mixer, ± outputs, max ×2, four routing switches to "the oscillator drivers above", the fourth with a jack and an attenuator — at 10 = direct —, a one-to-three splitter, trunks), MS-CPANELS55 (master gain, lit switches); R? RM §3.4 "click filter" (not in the texts read: omitted); C per-input levels, 4 MU] |
| **CP4A** Routing (System 35; **an honest stand-in**) | 3 | `c1…c4` CV ROUTING KEYBOARD · WHEEL · PRESSURE · CV IN [OFF ON] 0 · `t1 t2 t3` TRIGGER ROUTING [OFF ON] 0 | `ti` (in s) TRIGGER IN · `tr` (rear out s) — sec 0 · `ci` (in v) CV IN · `cr` (rear out v) — sec 1 — **2** + 4 trunks inert | bus rows: CVs → the 904A, triggers → 911 1 / 2 / 3 (§2.4); the plate: "CP4A · OURS — ITS ROUTING STANDS IN FOR THE ORIGINAL'S" | [R MS-CPANELS1 / ZB-900 (four controller-CV routing switches, trigger routing switches, trigger and CV input jacks, four trunks); C what they route to] |
| **CP35** Attenuators and sources (System 35; **an honest stand-in**) | 4 | `a1…a4` ATTENUATOR 0…10 (0) | `p6` +6 V · `m6` −6 V (out) — sec 0 · `i_k` / `o_k` (k 1…4) — secs 1…4, `i1 i2` normalled to `p6`, `i3 i4` to `m6` · MULTIPLE `u1…u4` (any) — sec 5 — **14** + 4 trunks inert | o_k = i_k · a_k / 10 (passive); unpatched inputs make adjustable ±6 V sources | [R? ZB-900, BON (normalled attenuators, CV sources incl. +6 / −6 V, multiples, trunks); C the normals, 4 MU] |
| **CP2** Filters, multiples, keyboard outputs (System 55; **a stand-in on a short list**) | 3 | `lp` LOW PASS · `hp` HIGH PASS 0…10 (5) (10 Hz · 1000^(v / 10)) | `li lo` — sec 0 · `hi ho` — sec 1 · `u1…u4` (any) — sec 2 · `po` PITCH OUT (out v) · `so` S-TRIG OUT (out s) · `kpr` / `ksr` (rear in) — sec 3 — **10** | one-pole passive LP / HP (the 923's sections); PITCH / S-TRIG = the controller's, by two always-on bus rows | [R MS-CPANELS55 (passive LP and HP, multiples, pitch and trigger outputs from the controller jacks); C the rest] |
| **CP8A** Power | 2 | — | — | drawn only: POWER switch, PILOT lamp (lit), FUSES — "not emulated" (the 1b+ rule); a class with no slots | [R MS-CPANELS55 (power switch, light, fuses; CP8A = CP8 rewired); C one type for both sets' CP8 / CP8A] |
| **961** Interface (**the 961CP console format**) | 3 | `t1 t2` SWITCH ON TIME 1 / 2 — 0…10 → 40 ms · 100^(v / 10) (40 ms … 4 s) (5: 400 ms) · `se` SENSITIVITY 0…10 (5) | V→S 1: `a11…a16` A INPUTS, `b11…b16` B INPUTS (in v), `s1` S-TRIG OUT (out s) — sec 0 · V→S 2: `a21…a26`, `b21…b26`, `s2` — sec 1 · S→V: `v1i` (in s) / `v1o` (out v) — sec 2, `v2i` / `v2o` — sec 3 · AUDIO→V: `ai` (in v), `ao1 ao2` (out v, one buffer) — sec 4 — **33** | V→S: closed while any A input is high, or while the B one-shot runs (a rising edge on any B input (re)starts it for SWITCH ON TIME); S→V: 4 V while closed; audio → V: a comparator, on above θ = 5 · 0.01^(v / 10) V, off below θ / 2, out 4 V | [R VK-55 (four circuits, columns of six A / B jacks, one S out each, A passes the duration, B the switch-on time 40 ms … 4 s, sensitivity, two parallel V outs), MS-961 (3 MU; level-sensitive A, UJT one-shot B, 50 ms … 4 s spec, 37 ms … 5 s bench; **two** S → V — VK says one: we build two), MS-S55 (961CP in the System 55's console row); C the comparator, θ's law] |
| **Song clock** (`clk`; **ours**) | 2 | `dv` STEP [1/4 1/8 1/16 1/32 1/8T 1/16T] 2 · `md` MODE [SONG ALWAYS] 0 (+ `ln` LENGTH if **P-2** is taken) | `ck` CLOCK · `rn` RUN · `rs` RESTART (out v) — **3** · lamp `lr` RUN | §3.4: the song's steps as a 50 % gate **defined by the song position** (high while frac(t / step) < ½), RUN high while running, RESTART a 5 ms pulse at a start, a loop wrap or a seek; nothing during a count-in (t < 0); ALWAYS: at the project tempo while stopped too; the plate "SONG CLOCK · OURS — THE SONG'S TEMPO AS PULSES" | [C, Q1] |

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
- **Sequence** (the System 55 tile's; Q1 / Q2): Song clock CLOCK (1/16) → 994 A; A → 960 SHIFT, A → 961 V→S 1 `a11`; **RESTART → 994
  B → 960 IN 1** (stage 1 on the first step and at every loop wrap / seek — without it the clock's first edge shifts the fresh 960 to
  stage 2 on the downbeat, skeptic #2); the 961's S-TRIG OUT 1 (`s1`) → **911A** (PARALLEL, delays ≈ 2 ms) → OUT 1 → 911 1, OUT 2 → 911
  2; 960 ROW A → 921A 1 `f1` and ROW A's second jack → 921 `f1` (16′); KBD PITCH 1 / 2 → 921A 1 `f2` / 921 `f2` (a key transposes;
  C4 = none — the controller's pitch latches on release, as the original keyboard's: **P-3**); 921B 1 saw, 921B 2 rectangle, the 921
  saw → CP3A 1 → 904A → 902 1 → MAIN OUT; 911 1 → 904A `c1`, 911 2 → 902 1 `c1`; ROW B → 904A `c2` (a filter step per stage). The 960's
  clock stopped at start (`os` 0), ROW A ×1: an 8-step minor riff (C C E♭ G C′ B♭ G F = 0, 0, 1.25, 2.92, 5, 4.17, 2.92, 2.08 on the
  dials). 20 cords. Its first note is stage 1's, live (any anchor offset) and bounced (§8.1, §8.3).
- **Twenty-four steps**: as *Sequence*, with ROWS A / B / C → **962** inputs 1 / 2 / 3, its OUTPUT → 921A 1 `f1`, **the 960's stage 1 OUT
  → 962 SHIFT** (the 962 moves as a new cycle starts: A1…A8, B1…B8, C1…C8 — stage 8's OUT would shift it one step early, playing
  B on A's stage 8) and RESTART → 994 B → 962 TRIGGER IN 1 as well (`s9` SKIP): 24 notes before it repeats.
- **Echo strikes**: S-TRIG 1 → 911 1 (direct), S-TRIG 2 → **911A** (SERIES, delays ≈ 150 ms each) → OUT 1 → 911 2, OUT 2 → 911 3; three
  921Bs on one driver (root, fifth, octave) → three 902s, each opened by its 911 → CP3A 1 → MAIN OUT: a strum per key.
- **Vowel**: two 921B saws → **914** (bands 500 / 1k / 2.8k up, the rest low) → 902 (a slow 911) → MAIN OUT: a vowel-like pad.
- **Step bass**: the **960 as an oscillator** — its own clock at audio rate (RANGE 410 Hz), KBD PITCH → its CONTROL INPUT (the clock
  tracks the keys: the fundamental = clock / 8, ≤ 125 Hz at the 1 kHz top), ROW A (×4) → 904A → 902 (911) → MAIN OUT; the eight stage
  knobs draw the wave. **Its playable range is bounded by the clock's 1 kHz clamp** (skeptic #28): at RANGE 410 Hz, VERNIER 2 the
  clock is 541 Hz at 0 V (a 67.6 Hz fundamental at C4) and every key above ≈ A4 plays 125 Hz; K9b tunes VERNIER so the keys from C3
  give ≈ two octaves (C1 … B2 fundamentals) before the clamp, says the range in its `about`, and V9c pins the fundamental at two keys
  and the clamp.
- **Routed**: the System 55 played as it was built to be — CP3A 1 KEYBOARD (`r1`) routes the pitch to 921A 1, the 993 (`f1 t1 t2 e1`)
  triggers 911 1 and, through the 911A, 911 2, and sends 911 1 to 902 1; only the audio is corded (921B saws → CP3A 1 → 904A → 902 1 →
  MAIN OUT; 911 2 → 904A `c1`): six cords, five lit switches.

### 2.7 Adding a module, as 9b leaves it (D5)

A **plain** type: (1) its `TYPE` + its place in `ORDER` and a Tidy row (`ROWS` or `CONSOLE`); (2) its `SPEC` row, class and `T` entry in
`moog-dsp.js`; (3) its face in `panels/m900b.js` (or a later file joined in `panels/index.js`); (4) its `MOOG_GLYPH`; (5) its golden
cases and `COST.patch` figure. A type that needs **events**, **lamps**, **rear jacks** or **bus rows** declares them in its `TYPE` (the
generic paths of §1.3–§1.6 exist after 9b); a **set** is a `FAMILY.sets` entry; nothing else changes. moog-core.test cross-checks the
three tables (moog-core.test:233), now including `ev` and `lamps` (= PatchMoog's `EV` / `LAMPS`); **`rear` is checked against the
faces only** (never placed): the evaluator needs no `rear` (an ordinary slot), and moog-dsp's jack rows `[id, d, s, sec, norm, ac]`
and their `JACKS` builder (moog-dsp.js:124–175) are shared code that would otherwise need an edit (skeptic #15). A type needs a
class even with no slots (§3.3).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The engine

### 3.1 `engine.js` (lane E9b) — every line behind the patch guards (D1)

| site | change |
|---|---|
| `seqMsg` (3093–3094) | the routing line learns events: `if (s && (s.pg !== undefined \|\| s.pe !== undefined)) { this.ptMsg(s); return; }` |
| `ptMsg` (2529–2533) | `s.pe` → `this.pm.ev(s.pe[0], s.pe[1])` while the kind is `'patch'`, the patch is powered **on** and the machine exists; else dropped (an event never waits in `pmPend`, nor through a power-off: review 1 F2) |
| `postMon` (4737, the graphed branch — a patch track is always graphed, I9 §12 lane H9 P-1) | a patch Inst posts `pt: I.pm.lamps(this.frames)` beside its `smon` when its machine has lamp modules (`pm.lampN > 0`) |
| `warmPatch` / `warmPatchOn` (3753–3790) | generic already (the 16 classes join through `PatchMoog.T`) **but its graphs outgrow the payload** (skeptic #7): `ptWarm` (engine.js:1542–1614) feeds every input and sinks every 1/4" output — with the 9b table graph a holds 211 connections, **b 298 and c 286 > the evaluator's 256** (patch-dsp.js:82, 201; `scratchpad/9b/skeptic/warmcount.mjs` over the real `ptWarm` and §2's jack lists) → `'limit'`, swallowed by the warm port (engine.js:3756): b's tail is dropped — **its two loop cords (the per-sample loop path stage 9 warmed) and the 921Bs' sync chain** (integer-like keys enumerate first: `ctl 902 911 914 921 923 960 961 962 992 993 994 995 921a …`, the 921Bs last). E9b splits each warm graph into payloads ≤ 256 (the types in two halves, the loop and sync cords in both) and a test asserts every warm payload analyses with no `why`; **the leftovers** (§0.2): more rounds so `ptRamp`, `outStage` and `renderPatch` reach the optimising tier on V8 (`--trace-opt`, scratch) and JSC (the first quanta measured) **within §8.3's warm-up time cap — the cap wins** (rounds cost time; E9b reports what tiers); one module per type (a sparse graph was tried and dropped, I9 §12 lane E9 choice 5), one event and one lamp read, and **one round under a playing anchor with a loop wrap** (the drums' `ck` form, engine.js:3601: the Song clock's SONG branch and its fold never run with the stopped `tp`; skeptic #24); the gate of §8.3 |
No other Track, Chain, graph, ModCore or protocol code changes; `Ladder`, `Env`, `HP4`, `AVoice` stay untouched.

### 3.2 `patch-dsp.js` (lane V9c) — generic, additive

- `ev(n, k)` (the message handler): the module numbered n → its class's `ev(k)` at once (the class's own fixed ring, §1.5; it applies
  the event at its next `ctl`); no module n, one **outside the latest plan** (not live: no `ctl` runs, the event would wait for a cord —
  review 1 F2), or a class without `ev` → dropped. **No evaluator queue and nothing new in the chunk
  loop** (skeptic #17: messages arrive between quanta, so "the next chunk" is the next quantum's first either way; a per-module
  pending check in the loop would run for every stage-9 patch).
- `lamps(F)` → `{ F, l }` from a preallocated array of the live modules whose type declares lamps (`lampN` their count, set in
  `graph()`); `l` a copy (called from the monitor, never from `render`).
- Nothing else: rear jacks are ordinary slots; bus rows arrive as cords; a type with no slots (993, 994, CP8A) is never scheduled; the
  960 / 962 / 911A are one-section types (a loop through one of them is a loop step, I9 §3.3).

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
  railed ±) plus its ROUTE copy; **CP35** constants + four passive attenuators; **993 / 994 / CP8A** classes with no slots (the base
  shape, `ctl` / `run` no-ops) — **required**: without a `T` entry `typeInfo` returns null (patch-dsp.js:112) and `analyse` drops the
  module as `'type'` with its cords (patch-dsp.js:175, 194), so a classless 994's multiples would be dead (skeptic #16).
- **The patched test** (`zb`, moog-dsp.js:193–196) is learned only from a whole `ins` array of **≥ 2** slots: every 9b class that uses
  it (914, 960, 961, 962, CP2, CP35) has ≥ 2; a later one-input type needing it takes the evaluator's zero buffer as `h.Z` (I9 §12
  lane V9b choice 6) [skeptic #34].
- **Song clock** — §3.4.

### 3.4 The 960, the song's transport and tempo, determinism (D7)

**The 960 (one section).** Per sample, only for patched inputs (the `zb` rule): rising edges (+1.5 V / +1.0 V) on OSC ON / OSC OFF set /
clear the oscillator flip-flop; on SHIFT or the oscillator's wrap → **a shift**; on IN k → **stage k**. **In one sample a select wins:
IN k (and SET k) is applied after a shift of the same sample** (skeptic #2: RESTART → IN 1 and CLOCK → SHIFT rise together on the
first step and at a wrap; the 962's TRIGGER IN k likewise wins over its SHIFT). Pending events at `ctl`: OSC ON / OSC OFF → set /
clear the flip-flop, SHIFT → a shift, SET k → stage k (in that order). `os` is only the flip-flop's fresh state (§2.2).
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
- **Cost**: per sample an edge test per patched input and the phase; outputs written only when read (`om`): ≤ 0.0015. **Patched into
  itself** — OUT k → IN 1 (a shorter cycle), a stage OUT → OSC OFF (stop at k), the instrument's everyday patches — the one-section
  960 is a one-member **loop step, run per sample** (I9 §3.3; ≈ 6–9 ns a member-sample on top of its work): measured by V9c (≤ 0.004
  at OS 4) and in §8.1 (skeptic #29). Through such a loop OUT k reaches IN 1 one sample late, so stage k lasts one OS sample (its row
  voltage a 5 µs blip) — the hardware's own reset behaviour, said in §11.

**The song.** A real 960 free-runs on its own oscillator [R]; the app's other sequencers follow the song (the user's 7a decision: "the
808 follows the song's play button and tempo"). 9b keeps the 960 as the original and adds **our Song clock** module (Q1):
- **SONG** (default): while the transport plays, CLOCK is a 50 % gate on every step (STEP: 1/4 = 960 ticks … 1/16 = 240, 1/32 = 120, 1/8T =
  320, 1/16T = 160 at 960 a quarter) **defined as a level of the song position**: high while t ≥ 0 and frac(t / step) < ½, low else,
  evaluated per OS sample (its rises and falls placed from the boundaries below; fresh = low). So the first playing chunk after a reset
  rises at its sample 0 whenever the position is in a step's first half — **not only when a boundary falls inside the chunk**: live,
  Play posts an integer frame (main.js:1520) that the Track applies at the first 4-frame span start at or after it (engine.js:
  4395–4399), so tick 0 lies 0–3 frames *before* the patch's first chunk and "a boundary inside the chunk" would miss the first step
  three times in four while the bounce (anchored at frame 0) catches it — D7 broken and the riff rotated (skeptic #2). RUN +5 V;
  RESTART a 5 ms pulse at the first playing chunk after a reset, at a loop wrap and at a seek. **A count-in** (`play(from, countBars)`
  anchors at a negative tick, main.js:1521): CLOCK, RUN and RESTART stay low while t < 0 and tick 0 counts as the start (RESTART), so
  the count-in never advances a 960 (skeptic #4). Stopped: all low (a 960 clocked by it holds its stage). **ALWAYS**: stopped, the same
  steps at the project tempo (`inst.bpm`'s stopped rule, engine.js:3079) from the absolute frame — a free clock aligned to frame 0
  (two ALWAYS clocks stay in phase); a tempo change while stopped jumps its phase (and fires RESTART), as `drClock`'s stopped clock
  does (engine.js:2433–2435) — said; playing, the song's.
- **How it reads the song** (span-invariant by construction): its `ctl(cc)` takes the absolute chunk F = 4 · cc and the Inst's transport
  `inst.tp` (engine.js:1653) and computes the tick at the chunk's two ends with the **continuous expression** `t(F) = tp.tick + (F −
  tp.frame) / tp.fpt` (the one `drClock` uses, engine.js:2428–2436), **folding the loop itself** (`tp.wrap` and t ≥ `tp.le` → ls + (t −
  ls) mod (le − ls)) and stopping at `tp.end`; each step boundary k · tps inside the chunk lands on the OS sample `⌈(k · tps − t₀) · tp.fpt ·
  OS − 1e-9⌉`. It never reads `songEvents`' rounded note frames (the known quantum-dependent rounding, §0.2), and because the fold is its
  own, a wrap that the Track handles late (engine.js:4406–4415 runs at span starts; songEvents cuts the span at the wrap, so ≤ 4 frames
  late, and re-anchors at the exact wrap frame, :4409–4411) changes nothing it outputs. A tempo change re-anchors `tp` at the current
  tick: t stays continuous **to within the anchor's lateness** — main.js's reanchor posts {F, t(F)} (main.js:1544–1545), applied at
  the first span start ≥ F, so the 0–4 frames between run at the old tempo and the new anchor disagrees with the old expression by up
  to 4 · |1 / fpt₁ − 1 / fpt₀| ticks (120 → 130 BPM ≈ 0.013 tick) — so **a jump is |Δt| > 0.5 tick** (a seek moves by ≥ 1 tick: seek
  rounds to whole ticks, main.js:1556), never ± 1e-6, which would fire RESTART at every tempo change (skeptic #3).
- **Play / Stop / tempo, summed up**: Play from a stop **resets the patch** (P-2, engine.js:3089) — the 960 at stage 1, its flip-flop =
  `os`, the clock's state fresh — then a clocked sequence starts on the song's first step; Stop leaves a free-running 960 running (a patched
  MAIN OUT is never quiet, I9 §3.6) and holds a song-clocked one; tempo moves a song-clocked one only. Mute / solo-out powers the patch off
  (P-1): an unmuted sequence restarts at stage 1 — wherever the song is (out of phase with the bar; likewise after a panic, a seek, or
  a loop whose length is not a whole number of cycles): **P-2**.
- **Deterministic**: the bounce starts at frame 0 with the transport anchored there (processorOptions), live starts at Play's reset — the
  same chunks either way **when the live anchor is on the 4-frame span grid** (as I9's roll-note D7 case; an off-grid anchor shifts
  every edge by its 0–3 frames, exactly as it shifts every instrument's roll notes, RULINGS2, engine.js:4424–4436); golden-moog-b
  renders *Sequence* live and offline (bit for bit, the anchor on the grid), live with off-grid anchors (its first note stage 1's), and
  at spans 4 / 128 / random with a loop wrap mid-span and a tempo change (bit for bit) (skeptic #23).

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
| **m9s** | 0.055 | 0.05 | 0.05 | a System 55 classic patch: all seven oscillators (6 921Bs on 2 drivers + the 921) → two CP3As → 914 → 904B → 904A (regeneration 6) → two 902s; five 911s — **three routed by the 993's bus rows** (two through the 911A; the 993 routes three: t1…t3, e1…e3), two by cords (skeptic #20); a mono note line | 0.041 |
Targets ≈ 1.3 × the estimate, the I9 spike (a) rule; **JSC A/B** (the lead; `engine.js` changed): c1, d, e, mc0, mt, d8p, d9p, dvp, m9p,
m9x, m9d within 3 %; **V8**: every existing row within 2 % (`cpu-gate`). `cv-cost`: `COST.patch[type]` for every new type (sectioned ones
per section), `patchLoad(cs, rec, vals)` over `liveNodes(rec, f, vals)`.

### 3.8 `graph()` at System 55 scale

`graph()` runs on the audio thread at a plug / pull / switch flip (I9 §12 spike (a) decision 5): V9a measured 0.08–0.11 ms warm (13
modules), max 0.4 ms with a transition plan. A System 55 holds ≈ 3 × the modules: expected ≈ 0.25 ms median, ≈ 1 ms worst. Spike (a2)
(§5) measures it over the real `patch-dsp.js`; **rule**: warm median ≤ 0.5 ms and max ≤ 1 ms on JSC → as built; else V9c keeps the
schedule when a change cannot alter it — a flip that adds or removes one source of one input **whose two nodes are already live, the
source already before the destination in the running order and no component changed** re-wires that input (its ramp) and leaves the
order; anything else (a node joining or leaving the live set, a new cycle) compiles in full (skeptic #22: a flip adds an edge, it is
not "value-only") — and re-measures. Note that **every** bus flip into a live input builds a transition plan (its ramp) — the
measured max is the typical flip, not a rare one. A set tile's first `graph()` (37 modules built cold) is a one-off at a Replace,
under its crossfade.

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
- **The 960's face** (8 MU, 431.8 × 222.25 mm): a clock column (OSC ON / OFF event buttons + lamp, CLOCK AT START, RANGE, VERNIER, ROW C → CLOCK, SHIFT button,
  jacks ON · OFF · SHIFT · CONTROL INPUT · OUTPUT), nine stage columns of ≈ 37.8 mm (lamp, three knobs, mode switch, SET, IN, OUT; stage 9
  without knobs), a row column (three range switches, six jacks): every rule met (the 15 mm jack pitch, the 9 mm clearance, 14 mm hits).
  **The 961** (console 3 MU): two 6 × 2 jack blocks with their S outputs and SWITCH ON TIME knobs, the S → V pairs, the audio comparator.
- Sizes: §2.1's rule; module + bar (I9 §2.2).

### 4.2 DOM and GL budget for a System 55-sized rack

| measure | anchor (measured) | System 55 (estimate, §5 measures) |
|---|---|---|
| painted elements (live layer, no face SVG) | Model 15 set 408; 48 small modules 1 332 (the lead's figures); `ui-m9-mac` m30 1 226 | from the Model 15's own ratio — 408 painted over 56 controls, 97 jack spans and 13 bars (≈ 6 each) → **≈ 4.2 per control** — the System 55's 186 controls ≈ 780 + ≈ 293 jack spans + 38 bars ≈ 230 + 15 buttons and 14 lamps ≈ **1 330**; by module: 31 plain × ≈ 28 + 960 ≈ 225 + 914 ≈ 69 + 961 ≈ 54 + CP3A × 3 ≈ 177 ≈ **1 390** (the sum's 960 ≈ 140 / CP3A ≈ 40 were low; skeptic #18): **≈ 1 400** (gate ≤ 1 700) |
| per module | I9 §4.1: a 1 MU module ≤ 90, the controller ≤ 160 (cv-patch.test:538) | the 960 ≤ 240 (40 controls ≈ 168, 29 jack spans, 12 buttons, 10 lamps, bar ≈ 225: ≤ 220 would sit on the edge — S9b's real-count scene confirms it); the 961 ≤ 120; the 914 ≤ 100; a console panel ≤ 90 |
| GL face textures (dpr 2) | 1 MU 1.29 MB, the console (8 MU) 5.75 MB (I9 §12 P9); m30 47.7 MB; hw5 171.7 MB | 27 1 MU + 921 + 914 + 960 ≈ 52 MB; seven console faces ≈ 22 MB: **≈ 74 MB** (`FACE_BUDGET_BYTES` 384 MB, cv-face.js:23) |
| cords | the buffer is the viewport's (13.4 MB at 1440 × 900); ≤ 128 cords | *Sequence* 20 cords |
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
  (2 624, 2 368, the console 2 496 px) and the System 35's (1 120, 1 376, 1 920) each fit one line. **An empty console row takes no
  height** (a Model 15 Tidy is unchanged: the rows stay at −1 024 / −512, tests/patch-core.test.mjs:545–568). `freeSlot` places a
  console module in the console row's first free place, and **derives every row's line from `rackLayout`'s stacking** — today it
  uses −(rows − r) · 512 (patch-core.js:627–634): with a console module present the cabinet rows sit 352 higher, a tapped 921B's
  line at −1 024 would overlap row 2 (−864 … −352) along its whole width and land above the rack (skeptic #13); a Model 15's freeSlot
  is unchanged (:571–579). Tidy's pinning (I9 §12 lane U9: an add pins the rest) keeps a rack still when the 17th module changes the
  width.
- **The camera**: I9's top-anchored rule (review 2 F2: k = max(READ_K, fit), the rack's top at the band's top + 24) frames a 2 816 × 1 728
  System 55 rack at k 0.5 — the source row whole on a 1440 × 900 window, the iPad's landscape band showing row 1 and part of row 2; the
  minimap and Fit as stage 9.

### 4.5 Buttons and lamps on the canvas (lane U9b)

- An event button is a transparent `button.cv-pev` over the face (the face jacks' form, I9 §4.2): it fires on **release** of a tap (≤
  TAP_PX, no second finger — a second finger cancels it and pinches, gesture.js's rule); Enter / Space fire it; it sleeps below READ_K like
  the controls; `aria-label` "960 1 · SET 3". OSC ON / OFF are event buttons too (§1.5); the CLOCK AT START switch `os` is an ordinary switch (the knob policy).
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
| **(b2) a System 55 rack on the iPad** (lane S9b: `tests/ui-bench.html?m9=1` + `tests/ui-bench-m9.mjs`) | scenes **`s55`** (37 faces at their 9b sizes — the 21 modules of Model 15 types and the controller with stage 9's **real** faces (`panels/m900.js`), stand-ins for the rest: a 960-sized 8 MU face with 40 knob widgets, 12 button and 10 lamp spans, 29 jack spans; seven console-height faces —, 40 cords asleep, **the lamps toggling as *Sequence* runs them: the 960's ten at 8 Hz (1/16 at 120 BPM), the 962's**), **`s55w`** (a module drag waking 8 cords, then all swaying, pinching 25–200 % **with the lamps still toggling** — the hands-on case of §9, which a lamp-less sway would not measure; skeptic #10), **`s55h`** (s55 with the hidden face SVGs dropped), **`s55c`** (cold: the System 55 tile's 38 faces through the raster queue — one job a frame, the 960's ≈ 1 728 × 1 024 device px — the time until every face is a texture and the worst frame; skeptic #30) beside stage 9's scenes | M0 / M1 as I9 §5 (b) / (c); painted counts, GL MB, glue | §4.7's notice line; the hidden-SVG hygiene for `'pm'` faces; whether the UI lanes proceed |

**The user's session** (≤ 30 minutes, plugged in, other apps closed; after the CDP run records `"ui-m9b-mac"`): **the pending stage-9
session and 9b's in one visit** — `canvas.domlavin.com/tests/ui-bench.html?m9=1`: the hand protocol on `hw5`, `m13`, `m13w`, `m20`, `m30`,
**`s55`, `s55w`, `s55c`** (and `m30h`, `s55h`, `m13s` if the others fail), Copy results → `tests/bench.json` `"ui-m9"`.

| (b2) on the iPad | decision |
|---|---|
| `s55` and `s55w` P+, glue ≤ 1 device px | as contracted; `PT_HEAVY` = the largest P+ scene's painted count |
| `s55` P, `s55h` P+ | the hidden-SVG hygiene for `'pm'` faces joins P9b / U9b |
| `s55` fails, `m30` passes | the 960 face's live layer is profiled first (its 80 + elements) and cut (lamps as one GL quad set?) before U9b |
| `s55` P+, `s55w` fails | the lamps' deliveries are held while the camera moves (the world's burst) and drawn as solid fills (no blurred glow), then re-measured; the hold rule (I9 §4.3) as stage 9's `m13w` row |
| `m20` / `m30` already fail | stop: the many-modules question reopens (the IMPL-3 "opacity0" probe) before any 9b UI lane |
| glue fails | `?cords=under` becomes the default (the switch exists); the look trade told to the user |

---------------------------------------------------------------------------------------------------------------------------------

## 6. Host wiring (`main.js`, lane H9b)

| site | change |
|---|---|
| `patchNew` (175–180) | `(t, dev, type, set)`: a set id → `MG.makeSet(set, d.vals)` (the Model 15 path = `makeSet('m15')`, bit-identical) |
| `ptSet` (6785–6790) | `ptSet(id = 'm15')` → `PATCH.preset(fam.sets[id].starter, { ensure: fam.sets[id].set })`; for `s35` / `s55` the same step also Tidies the rack (§1.2; cv-patch's preset takes `{ tidy: true }`: every module's lay entry from `rackLayout`) |
| the tray (5075; `moogPick` / `moogDrag` 6791–6820) | `sets: cvTray.SET_TILES`, `setPick(id, mode)` (a 900 Series shown: `ptSet(id)`; else Replace / + Track with `{ set: id }`), `setDrag` (as `moogDrag`, its ghost the set's rack outline), `setSetPlaced` from `PT.setNeeds` at each render (`ptTray`) |
| `srcModeUI` moog branch (4929) | the text names the set tiles (I9 review 2 F4's form) |
| `patchPayload` (3475), `syncedOf` (4269), `costLabels` | `PT.payload(rec, rec.f, vals)`, `PT.live(rec, f, vals)`, `COSTM` with vals |
| `ptKnob` (6758–6768) | after the write: `if (PT.isBusKnob(rec, mid, id)) patchSend(t, dev)` (at once; `pk` changes) |
| `applyRestore` (its `ptBack`, I9 §12 lane H9) | **nothing to add** (skeptic #21): `ptBackApply` runs inside `applyRestore` (main.js:1461) before its loop posts every 900 Series' payload (`patchSend`, pk-guarded, main.js:1472) — once `patchPayload` reads `vals`, a preset step's bus switches reach the graph there; a test proves it (§8.6) |
| `ptEv(t, dev, mid, id)` (new; cv-patch's `H.ev`) | the node's `{t: 'seq', i, s: { pe: [n, k] }}` (k from the type's `ev`); nothing when no node |
| the lamp monitor (beside `drumMonitor`, 3695–3703) | `monitors.sub` for a shown 900 Series whose on-screen modules declare lamps; `deliver: d => d.pt && PATCH.lamps(t, dev, d.pt)` (held while the camera moves if §5's `s55w` row says so) |
| `cvHost().members` | a routing panel's key → the keys its lit, resolved rows reach (`PT.busRows`), beside a 921A's 921Bs (§1.4) |
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
| **K9b** tables + core | 1a, **first** (its tables commit lands before V9c / P9b / U9b start) | `moog-core.js` (16 types, `ORDER` / `ROWS` / `CONSOLE` / `GROUPS`, `FAMILY.sets`, `S35` / `S55`, `makeSet`, the 7 presets, `bus` / `ev` / `lamps` / `rear`), `patch-core.js` (rear jacks out of cord paths, bus rows in `payload` / `live` / `liveNodes` / `wiring` with `vals`, `isBusKnob`, `loadSet(id)`, `setNeeds`, `rackLayout` / `freeSlot` console row + width, `loadPreset` writing every bus switch, the rows' bound), `tests/moog-core.test.mjs`, `tests/patch-core.test.mjs`, **`tests/ref-9-core/`** (new: verbatim copies of stage 9's `patch-core.js` / `moog-core.js` from the base, taken before any edit, for §8.2's old-build test; their `MANIFEST.json`) | §8.2 | standard |
| **V9c** circuits + evaluator | 1a | `moog-dsp.js` (16 `SPEC` rows, classes, `T`, `EV`, `LAMPS`), `patch-dsp.js` (`ev`, `lamps`), `tests/moog-dsp.test.mjs`, `tests/patch-dsp.test.mjs`, RM **§9 new codes and §10 rows** (the lead writes §2.2, §3 and §8 at the end, §10 — one owner a section) | §8.1 | standard |
| **E9b** engine + plumbing | 1a (after V9c's first commit; stubs before) | `engine.js` (§3.1), `cv-cost.js` + `tests/cv-cost.test.mjs`, `tests/bench-scenarios.mjs`, `tests/bench.json` (targets), `tests/bench.html`, `tests/engine-track.test.mjs`, `tests/golden-moog-b.test.mjs` (new), **`tests/golden-moog.test.mjs`** (after the lead's phase-0 pin of its preset cases to stage 9's six names, §7.2 / §8.3 — a pin to stage 9's truth, never a weakening), `tests/golden-harness.mjs` (only if golden-moog-b needs a transported patch case it lacks) | §8.3 | standard |
| **P9b** faces | 1a (after K9b's tables) | `panels/m900b.js` (new), `panels/index.js`, `cv-panel.js` (event buttons, live lamps, rear jacks, empty faces), `tools/panel-check.mjs`, `tests/cv-panel.test.mjs`, `tests/cv-face.test.mjs` | §8.4 | standard |
| **X9b** set art | 1a | `cv-art.js` (`SET_ART`), `tests/cv-art.test.mjs` | the art tests | cheaper |
| **U9b** canvas UI | 1b (after §5's session and K9b's merge) | `cv-patch.js` (event buttons, lamps + their frame queue, the bus switch tip, a routing panel's `members`, the set preset's Tidy), `cv-tray.js` (set tiles, groups, 16 glyphs, the note), `style.css` (lamps, buttons, set tiles), `tests/cv-patch.test.mjs`, `tests/cv-tray.test.mjs`, `tests/canvas-sim.test.mjs` | §8.5 | standard |
| **H9b** host | 2 | `main.js` (§6), `tests/canvas-9b-sim.test.mjs` (new, accessor-free), `tests/canvas-9-sim.test.mjs` (its tile list), `tests/main.test.mjs` | §8.6 | standard |
| reviewers × 2 | 3 | (1) **real engine**: D1 (every ref incl. ref-9), D2 / D7 (the clocked *Sequence* bounced = live, spans 4 / 128 / random with a wrap and a tempo change), every new type against §2's targets, bus rows (ordinals after a delete, flips click-free, OR on S inputs), events at chunk boundaries, presets' headroom, `graph()` at S55 scale; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the System 35 / 55 tiles, the S55 rack (DOM, GL MB, the default camera, Fit), the 960 running with lamps in step, SET / SHIFT by touch and two-finger cancel, bus switches, Tidy, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

No lane touches `cv-cords.js` / `cv-world.js` / `cv-module.js` (cords, the world and module chrome are unchanged: console-height `'pm'`
modules take their size from `host.size`, cv-module.js:146, 304).

### 7.2 Schedule

- **Phase 0**: A2 ∥ S9b; base = `canvas` at this contract's commit **plus the lead's one-line pin of golden-moog's preset cases to stage
  9's six names** (tests/golden-moog.test.mjs:159 / :218; run once: 6 / 6, bit-identical — skeptic #1). A2's report → the lead fixes
  §3.7 / §3.8; S9b's CDP run, then **the user's session** (§5).
- **Phase 1a**: K9b's **first** act, before any edit: `tests/ref-9-core/` (stage 9's `patch-core.js` / `moog-core.js` verbatim) and
  the frozen-record hashes of §8.2 computed from the base tree; then K9b's tables (one commit) → then K9b ∥ V9c ∥ P9b ∥ X9b ∥ E9b on
  the holding branch **`wt-9b`**. **Phase 1b** (after the
  session and K9b's merge): U9b.
- **Phase 2**: H9b, the lead's fixture check first (a page sim: the System 55 tile on track 1 → 37 modules, the payload with the bus rows
  of none (all switches off), a note transposes, ▶ starts the sequence: `{t: 'seq', s: { pg }}` then the song; a 993 switch → a new `pk`
  posted, no History step).
- **Phase 3**: two reviewers → fixers → **one sweep** (every test file, one at a time; `golden-*` once) → **listening renders** (each new
  preset, the 904B / 914 / 960 alone; short files) to the user — optional, not blocking (drum-feedback rule) → the lead freezes
  `tests/ref-9b/` → docs (§10) → **one squashed commit "9b"** on `canvas` → `tools/deploy-canvas.sh` → the iPad (§9).
- **Known windows on `wt-9b`**: moog-core / cv-tray / cv-panel / canvas-9-sim pins until their owners extend them; `pwa.test` until the
  lead's `node tools/precache.mjs --write` (new files: `panels/m900b.js`); moog-dsp.test / engine-track's preset loops until V9c / E9b
  extend them. **No golden window**: golden-moog's case list is fixed to stage 9's six presets **by the lead in phase 0, on the base**
  (a one-line pin, before K9b adds a preset; E9b owns the file after), so it never sees a 9b preset (§8.3).

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

- **904B** (T-VCF2): 24 dB/oct below f_c ± 1 dB/oct **between three and two octaves under** (four buffered one-poles reach 24 only
  asymptotically: 22.7 dB/oct locally at two octaves, 4 × 6.02 / (1 + 1/16); 23.3 averaged over the third octave — the 904A's form,
  skeptic #9), −12 dB at f_c on both ranges' ends, HIGH = LOW + 1.5 oct ± 1 %, 1
  V/oct tracking, unity passband ± 0.2 dB, no resonance peak (≤ +0.1 dB anywhere).
- **914** (T-FFB2): centres ± 2 %, skirts 12 dB/oct ± 1.5 (2–3 oct out), the 88 / 8 000 Hz sections, all at 10 flat ± 2 dB 20 Hz–20 kHz,
  a band at 0 contributes nothing (pots (v / 10)³: every band and both sections at 0 → silence, ≤ −120 dB) and **one band alone's
  rejection an octave away measured and recorded** — not "≤ −60 dB at its centre with its neighbours at 0": with 12 dB/oct skirts the
  bands an octave away (two stagger-tuned 2nd-order sections at Q ≈ 2: ≈ −10 dB each there) leak ≈ −14 dB into it, an impossible gate
  (skeptic #8); the input pair rule.
- **960** (T-SEQ1): the clock 0.1 Hz … 1 kHz ± 1 % over RANGE × VERNIER, 1 V/oct on CONTROL INPUT and ROW C → CLOCK, 90 % duty, row maxima
  2 / 4 / 8 V ± 0.1 %, SKIP / STOP / stage 9 (STOP clears the clock, SKIP wraps), SET / IN / SHIFT / OSC ON / OFF (jacks and events —
  **OSC ON restarts a clock that stage 9's STOP cleared**, skeptic #5), **a select in the same sample as a shift wins** (IN 1 + SHIFT
  together → stage 1; the 962's TRIGGER IN likewise), stage OUTs and lamps, fresh = stage 1 with the flip-flop = `os`; **a 960 patched
  into itself** (OUT 5 → IN 1: a 4-stage cycle; OUT 8 → OSC OFF) as a loop step, its cost recorded (§3.4).
- **961** (T-TRG1): A follows, B one-shot 40 ms … 4 s ± 5 % and retriggered, S → V 4 V, the comparator's θ law; **962**: 2:1 / 3:1 by
  INPUT 3, TRIGGER IN / SET select, OUTs and lamps, the −1 V clip; **911A**: delays 2 ms … 2 s ± 5 %, OFF / PARALLEL / SERIES, an early
  opening cancels; **903A**: white 0.5 V RMS flat ± 1.5 dB, pink −3 dB/oct ± 1; **CP3A** ×2 max, ± outputs, EXT at 10 = unity; **CP35**
  ±6 V, normals; **CP2** one-pole sections; **992** reversible attenuator.
- **The Song clock**: edges on the song's steps at the exact OS sample from the tick expression (hand-computed cases incl. a step on a
  chunk boundary and 1/8T), **the level rule** (an anchor 0–3 frames before the first chunk, a start mid-step in either half: the
  clock high from sample 0 exactly when the position is in a step's first half; skeptic #2), RUN, RESTART at start / wrap / seek and
  **not at a tempo change with a late-handled anchor** (the re-anchor 1–3 frames after its frame; skeptic #3), **a count-in** (t < 0:
  all low; RESTART at tick 0; skeptic #4); ALWAYS at the project tempo; **span invariance with the transport running** (spans 4 / 128 /
  random, a loop wrap inside a 128-frame span, a tempo change: bit for bit).
- **Events and lamps** (patch-dsp, moog-dsp): an event lands at the next chunk whatever the span split; a class's ring overflow; `reset()` clears;
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
`freeSlot` for a console module (and a 5U one with a console row present: its own row's line, skeptic #13); **a preset loaded over
lit routing panels it does not bind turns their switches off, in `back`** (skeptic #6); the rows' bound (cords + rows ≤ 256) and no
row into a normalled input; **the old build** (§1.1; skeptic #11): a record holding every 9b type — modules, cords to their jacks,
`vals.p` — through **stage 9's** `normPatch` / `pruneVals` / `payload` (`tests/ref-9-core/`, verbatim from the base) is kept whole
and its payload is the Model 15 part (the new code knows every type, so it proves nothing about an older build); **the Model 15
records frozen** (skeptic #1): `model15({})`, `makeSet('m15', {})` and each of the six stage-9 presets loaded on a fresh record with
`{ ensure: M15 }` → `payload(rec).pk` and `JSON` of `pvOf(vals)` equal hashes K9b computes **from the base tree before its first
edit** and writes into the test (golden-moog shares moog-core / patch-core between its sides, so it cannot see these); the 9b presets
pinned the same way by the lead at ref-9b's freeze.

### 8.3 Engine, goldens, bench (E9b)

- **D1**: every I9 golden and **golden-moog (ref-9)** bit-identical after every E9b commit. **golden-moog's preset cases are fixed to
  stage 9's six names** (tests/golden-moog.test.mjs:159 renders every `MG.PRESETS` entry with `{ ensure: M15 }` and :218 checks the
  list: the 7 new presets' modules are unknown to ref-9's frozen `moog-dsp.js` on side A — dropped as `'type'` — so A ≠ B and the golden
  fails; skeptic #1); the new presets are golden-moog-b's.
- `engine-track`: `{t: 'seq', s: { pe }}` reaches the machine (and is dropped for a non-patch Inst, and for a module gone); the `pt` lamps
  in the graphed monitor; the warm-up covers every new class (`warmPatch`'s generic graph), **the scope's warm-up time ≤ 1.15 × stage 9's**
  (V8 ≈ 776 ms → ≤ 893; JSC ≈ 925 → ≤ 1 064) and **each first quantum ≤ ¼ of the deadline** for a System 55 set arriving on a new Track
  (I9's gate extended); `graph()` per §3.8's rule; **every warm payload analyses with no `why`** (≤ 256 connections, skeptic #7) and the
  loop step and the 921Bs' sync paths are among them.
- **D2 / D7**: `tests/golden-moog-b.test.mjs` (ref-7d's form): side A = the tree with `tests/ref-9b/`'s copies; cases — each new type
  alone at three settings, the 960 free / song-clocked / at audio rate, the 962 2:1 and 3:1, the 961's four circuits, the 911A's modes,
  every bus row, each new preset with its note line (and the transport for the clocked ones), a graph change mid-sequence, OS 2, 44.1 kHz;
  **D7** (*Sequence* bounced offline = live with the live anchor on the span grid; live with anchors 1–3 frames off it: its first
  note is stage 1's), **span invariance** (§8.1's clock cases through the whole Track); gate `max |A − B| === 0`;
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
groups, glyphs); DOM per module (§4.2: the 960 ≤ 240, the 961 ≤ 120, the 914 ≤ 100, a console panel ≤ 90; the existing ≤ 90 / ≤ 160).

### 8.6 Host (`tests/canvas-9b-sim.test.mjs`, H9b, accessor-free)

System 35 / 55 tiles on another track (Replace, tap to undo, the rack laid out: console row above the controller) and on a 900 Series
(a preset step; undo gives the topology and the knobs back); a set tile greyed at the cap; a bus switch → `pk` posted, no History step,
undo of a cord pull keeps the switch; a SET tap → `{t: 'seq', s: { pe }}`; lamps delivered to the 960's face; ▶ starts *Sequence* (the
song's transport into the node), ■ holds it; mute → off (P-1) and back at stage 1; **a preset step's undo with a bus switch among its
  knobs re-posts the graph** (applyRestore's loop, §6); a System 55 tile on a Model 15 900 Series lays the rack out (one step, undo gives the
  places back); selecting the 993 outlines its routed 911s / 902s; save / reload identical (schema 12); a bounce of
*Sequence* includes it; a project without a 900 Series posts exactly today's messages (`canonical-stream`).

### 8.7 Rendering and the iPad (reviewer 2, the user)

The System 55 rack GL vs `?nogl`; G1 `equalPx` with the 960's lamps lit (lamps are DOM: they follow the compositor as the jacks do); the
painted count ≤ 1 700; GL ≤ 90 MB; a pan / pinch at 60 fps on the Mac with 20 cords; the default camera and Fit; no console error.

### 8.8 Pins that change (none weakened; each extended to the new truth)

moog-core.test:38–41 → params 0 … 48, the list of types over 16 pinned (`['960']`) and of types with none (`['903a', '962', '993', '994',
'cp8a']`); :127–133 → the new `ORDER` / groups / tiles / shorts; :130 → `ROWS` + `CONSOLE` = `ORDER`; :168–169 unchanged (the m15 set);
patch-core.test **:76–77, :156, :207, :369–371 and :562–567** → an unknown type `'999'` (914 is real now: five sites use it as "a
newer type" — a cord from its `out`, canPlug's reason, pruneVals keeping its `q`, rackLayout's extra row —, not only the fuzz;
skeptic #14); moog-core.test :118–122 (sizes by `face`, not `id === 'ctl'`; `cost > 0` → ≥ 0 with the zero-cost 993 / 994 / CP8A
pinned), :173 (the thirteen names); moog-dsp.test :270–282 (the ten types, `ORDER`) and its preset loops :962, :988, :1080 (`LINE[P.name]`
per preset) (V9c); engine-track :2164 (the presets' headroom: the clocked ones with a transport) (E9b); golden-moog :159 / :218
(§8.3, E9b); cv-tray.test (the Moog row: 25 tiles, five groups; :1161 glyphs);
cv-patch.test:538 (+ the 960 / 961 / 914 lines); cv-panel.test (module faces 10 → 26); cv-face.test (new sizes); canvas-9-sim (the
view's tiles: + the set tiles and 16 modules); cv-cost.test (coverage). No MODELS-iterating test changes (no new model).

---------------------------------------------------------------------------------------------------------------------------------

## 9. Bench rows and the iPad (after deploy)

`canvas.domlavin.com/tests/bench.html` five passes → `tests/bench.json` `"ipad9b"`: c1–c6 and the engine rows within 5 % of the newest
valid run, **m9p / m9x / m9d** and **m9q / m9s ≤ their iPad targets**, `stale: false`, the deployed build (it also records stage 9's and
the drums' rows if still missing — IMPL-8 §15.11's rule). **Hands-on**: the System 35 tile (play *Swept band*), the System 55 tile (▶:
*Sequence* runs in time; a key transposes it (P-3 decides how it lets go); turn a stage knob; SET / SHIFT; a 993 switch; the 962 in *Twenty-four steps*), a pinch over
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

**The answers (2026-10-22, relayed by the lead — settled; the build uses them):** **Q1** the 960 keeps its own clock, and **our Song
clock** panel sends the song's steps, a run signal and a restart pulse; the System 55 comes patched to it. **Q2** the System 55 tile is
***Sequence***, an 8-step bass that starts on ▶ and follows the tempo, a key transposes it (how it lets go: **P-3**), with a one-time
notice "The sequence starts when you press ▶". **Q3** **keep the 48-module cap**.

**Things you will notice (no decision needed)**: two new tiles, **System 35** and **System 55**, beside Model 15; sixteen new module tiles
in five groups; a big System 55 rack (two cabinet rows, the console panels in a row above our controller) that opens at 50 % with the top
row in view. **Routing switches**: the 992, 993 and the CP3A / CP4A panels route the keyboard and the envelopes **behind the panel** like
the originals — a lit switch is a connection, **no cord is drawn** (select the panel to see the modules it reaches outlined); they
follow positions ("the second 911"), so deleting a 911 moves the routing to the next one; loading a starting patch switches every
routing panel it doesn't use off. Trunk jacks and the CP8A's power switch are drawn but not working (as on today's hardware panels: "not
emulated"). The CP4A, CP35 and CP2 are **our stand-ins** where no source says exactly what is on them, and say so. The 960's lamps follow
the music; SET, SHIFT and OSC ON / OFF act when you lift your finger (a second finger cancels, as everywhere); its knobs are plain
voltages, as on the original — on ×1 a semitone is about 0.42 of a dial number (the starting patches are tuned for you). The Song
clock's RESTART is patched to the 960's stage 1 in the starting patches, so a sequence begins on its first stage and starts over at each
loop; a count-in doesn't move it. Patching a 960's stage output back into a stage input (a shorter cycle) skips that stage at once, as on
the original. Pressing ▶ restarts a sequence at stage 1; ■ leaves a free-running 960 running (mute or ⏻ silences it); unmuting (or a
seek) restarts it at stage 1 wherever the song is (**P-2** would keep it in step with the song). The 962 clips large negative
voltages (built for positive control voltages). The controller is unchanged (with LOW priority and MULTIPLE triggering a higher key still
retriggers the envelopes — as decided in stage 9). A 9b project opened by an older build keeps every module but plays only the Model 15
ones.

## 12. Notes (the builders fill in)

### Spike (a2): the evaluator at System 55 scale (lane A2, 2026-10-22, base 81da0d8; scripts and raw results in the lead's scratchpad `9b/a2/`)

The real `patch-dsp.js` + the real Model 15 classes + 16 stub classes of the new types (§2.2 / §2.3's lists, §3.3 / §3.4's algorithms)
through the real `engine.js` and its warm-up; V8 (node 24) and JSC (the macOS shell), c3 in the same harness; controls: m9p reproduced
stage 9 (V8 0.0186 vs 0.0185, JSC 0.0142 vs 0.0143). Graphs of 38 modules (37 + the controller): *Sequence* (23 cords, 16 live
nodes), a System 55 classic (30 cords incl. 7 bus rows, 24 live), a dense stress (98 cords, two loops).
- **`graph()` at 38 modules**: warm median 0.05–0.15 ms, p95 ≤ 0.25, max 0.2–0.9 (V8 / JSC) — ≈ 2× stage 9's 13-module cost, not 3×;
  ≈ 0.28 MB allocated per call. **One JSC eden GC lands on a `graph()` ~20 calls after the warm-up: 2.3–2.7 ms** (about a quantum) — the
  rule of §5 (a2) **passes at High** with that clause. Transition quanta: one input +0.005–0.01 ms; a whole-topology swap +0.14–0.19.
  A set tile on a new Track: first quanta ≤ 0.42 ms V8 / 0.15 JSC (steady 0.107 / 0.087).
- **Skeptic #7 confirmed**: with the 9b jack lists `ptWarm`'s payloads are a 211 / **b 298** / **c 286** connections (> 256); halves of the
  module list (the controller in both) analyse cleanly. Warm-up time with the 9b family ×1.17–1.22 (V8 / JSC).
- **Rows (OS 4, 48 kHz)**: m9q (*Sequence*, ALWAYS) 0.0229 V8 / 0.0175 JSC (≈ 0.0154 iPad Pro); m9s (System 55 classic) 0.0414 / 0.0338
  (≈ 0.0297); the dense stress 0.123 / 0.108. At OS 2 / 1: m9s 0.0234 / 0.0148 V8, 0.0187 / 0.0108 JSC (the evaluator's per-chunk cost
  ≈ 0.004 V8 is OS-independent: 28–55 % of the load at OS 1).
- **Per type (×10⁻³, V8 / JSC)**: 904B 2.1 / 2.4 (1.5 without CV) · 914 6.5 / 6.3 · 960 1.0 / 1.4 typical, 1.7–1.9 / 2.2–3.8 with
  CONTROL INPUT patched · 961 V→S 0.7, audio→V 0.3 · 962 0.6 / 0.7 · 911A 0.4 / 0.5 · 903A 0.4 / 1.2 · CP3A 0.5 · 992 / CP4A 0.1 · CP2
  0.7 (2 sections) · CP35 / clk 0.3. The 960 in a one-member loop ≈ 0.0046–0.0053 total (10–18 ns per member-sample, not 6–9).

**The lead's decisions (2026-10-22), binding on K9b / V9c / E9b / P9b / H9b:**
1. §5 (a2) passes at High. **E9b**: split every warm payload to ≤ 256 connections (skeptic #7) and end `warmPatch` with ~100 System
   55-size `graph()` calls (≈ 22 ms) so the first eden GC happens in the warm-up, not on a user's first patch edit — re-measured: no flip
   > 1 ms after the warm-up. The warm-up time cap is restated as **≤ 1.25 ×** stage 9's (measured 1.17–1.22 before the payload split).
2. §3.8's `graph()` expectation → the measured 0.05–0.15 ms median / 0.2–0.9 ms max at 38 modules (JSC's single eden GC excepted).
3. **Rows (node / jsc / ipad, High)**: **m9q 0.03 / 0.022 / 0.02 · m9s 0.055 / 0.042 / 0.04.**
4. §3.3: the 960 / 961 / 962 compute their patched-input lists once per chunk in `ctl()` (never per `run` call). §3.4: the 960 in a loop
   ≤ 0.005 (OS 4); loop members cost 10–18 ns per sample. §3.7 limits: **960 ≤ 0.002 (≤ 0.003 with CONTROL INPUT patched) · 961 V→S ≤
   0.0008 per section, the others ≤ 0.0004 · 914 ≤ 0.008**; the m9q / m9s rows are the real gate. §2.2: the 962 has **12** jacks (3 + 2
   + 3 + 3 + 1).
5. **For the performance-presets stage (ROADMAP 14; the user: Low / Medium / High, mid-range Android too)** — recorded, not built in 9b:
   Medium ≈ 3 × and Low ≈ 7 × (pessimistic 15 ×) the iPad Pro's loads; m9s on Low fits a ~0.10 track budget only at OS 1 (≈ 0.067), with
   the module cuts (four oscillators idle, no 914) ≈ 0.048, with longer evaluator chunks (K × 4 frames, Low only) ≈ 0.036. **`graph()`
   scaled to Low (×7) needs the fast path** (re-wire only a changed input when no component changes; cut the per-call allocation; build
   and install a plan over two quanta). Other Low levers: skip the 904A's second pass, per-chunk CV exponentials, a cheaper 914 / BLEP.

### Spike (a2)
### Spike (b2) / the user's session
### Lane K9b

**K9b-a (base b06f1aa)** — first, before any edit: `tests/ref-9-core/` = the base's `patch-core.js` / `moog-core.js` verbatim (= 53b7e88's
= 8f6c716's) + `MANIFEST.json` (their sha256 and **`records`**: the frozen Model 15 records — `payload(rec).pk` and sha256 of
`JSON.stringify` of `pvOf(vals)`, `rec`, `vals` — for `model15({})`, `makeSet('m15', {})` (stage 9: `model15`) and the six presets on
a fresh record with `{ ensure: M15 }`; e.g. Classic bass pk `088e7464`, pv `98efe346…`); computed from the base tree and again from the
copies (identical), and again after the tables commit (unchanged). Then **the tables** (one commit; `moog-core.js`, the two test files'
pins). Refinements of [C]s, each within §2:
- **Type ids** `904b 914 911a 903a 960 962 992 993 994` (5U) · `cp2 cp3a cp4a cp35 cp8a 961 clk` (console height). **`face: 'console'`
  for the seven console-height types** (sizes by face, §8.8) — the controller is `type === fam.ctl`, no longer "the console face"
  (cv-panel's `moduleModel` reads `T.face !== 'module'` → P9b). Layout ids = type ids.
- **Jack counts include the rear terminals** (the table is the payload's port order): CP2 12 (10 + `kpr` `ksr`), CP3A 12 (11 + `xr`),
  CP4A 4 (2 + `tr` `cr`), 992 2 (1 + `xr`) — rear jacks last in their section, labelled "… (REAR)". The 962 has 12 (§12 (a2)).
- **A normal may name an output of another section** (the CP35's `i1 i2` ← `p6`, `i3 i4` ← `m6`): I9's "norm: <input id>" generalised;
  patch-dsp already reads a normal from an output (its header: "an output, an input …, or a multiple") and patch-core's `wiring` too.
- **Labels**: unique per type; the 960's `co` "OUTPUT", rows "ROW A 1 / 2"; the 961's "V→S 1 A INPUT 3", "S→V 2 OUT", "AUDIO→V OUT 1";
  the Song clock's short "SONG CLOCK" (its bar: "SONG CLOCK 1"); tiles ≤ 24 chars ("903A Random signal", "993 Trigger routing" …).
- **The Song clock's LENGTH** (P-2 (b)): `ln` an S of 32 positions `Off, 2 … 32` — index = N − 1 (*Sequence* 7 = 8 steps,
  *Twenty-four steps* 23); default Off. P9b draws it as a detented rotary.
- **§8.8's "types with no params" names the 993 by mistake** (it has eight switches and no jack): pinned as `903a 994 962 cp8a`; no
  jack: `993 cp8a`; zero cost `994 cp8a 993`.
- **Costs** = spike (a2)'s V8 figures (904B 0.0021, 914 0.0065, 960 0.001, 962 0.0006, 911A / 903A 0.0004, CP3A 0.0005, CP2 0.0007,
  CP35 / clk 0.0003, 992 / CP4A 0.0001; the 961 0.0019 = 2 × 0.0007 + 0.0003 + 2 × 0.0001 [C for the S → V pair]); V9c re-measures.
- **`LAW`** gains the 9b laws (moog-dsp holds the same): `f904b`, `f914`, `d911a`, `clk960(rg, vn)`, `row960(v, g)`, `on961`, `th961`,
  `ticks(dv)`. Section names: 994 `multA multB`, CP3A `mix route mult`, CP4A `trig cv`, CP35 `src 1 2 3 4 mult`, CP2 `lp hp mult kbd`,
  961 `v2s1 v2s2 s2v1 s2v2 a2v`, the rest `main`.
- **FAMILY**: `rows` stays the two cabinet rows (`ROWS`); `console` (= `CONSOLE`), `sets` (= `SETS`: m15 / s35 / s55 — the s35 / s55
  starters' presets land with K9b's second commit), `rackWide` 2 816, `rackN` 16; `set` / `starter` unchanged.
- moog-core.test's new pins: the param / jack / event / lamp lists and orders, the bus rows (§2.4 verbatim; typed, one plug, out → in,
  no normalled input, their switches the panel's Off / On switches; every rear jack reached by its panel's rows), the sets (counts,
  Tidy order, row widths 1 120 / 1 376 / 1 920 and 2 624 / 2 368 / 2 496), the laws; the cross-checks now include PatchMoog's `EV` /
  `LAMPS` and the faces of `panels/m900b.js` (ports without rear jacks, `button.ev`, `lamp.lamp`). patch-core.test's "newer type" is
  `'999'` at its five sites. **Windows after this commit**: moog-core.test's two cross-checks (V9c, P9b), cv-tray (U9b), cv-panel
  (P9b), cv-cost (E9b), moog-dsp / engine-track's type lists (V9c / E9b), canvas-9-sim's tile list (H9b).

**K9b (phase 2, base 8a1fdbd = wt-9b after K9b-a)** — 6142aad patch-core · 6b2614d makeSet + the presets · c727e0b / 7a53e9f the tests.
Choices within §1 / §2.6 / §4.4 [C]:
- **Rear terminals**: `endOf` returns null for a `rear` jack unless asked (bus rows only), so `canPlug` / `plug` / `repatch` say "No such
  jack", `normPatch` drops such a cord, `jacksOf` / `targets` leave them out; they stay ports of the payload (the jack order).
- **Bus rows** (`busScan`, pure): a row is live when every switch of it reads ≠ 0 (`_t`-checked, else the default) and both ends
  resolve to typed jacks; panels by number, rows in table order; **room = 256 − the payload's cords** (`MAX_CONN`), rows past it
  skipped. Ordinals: `'<t>|<t>#k'` lists each type's modules by number, the types in list order; `'#='` = the panel's ordinal. A
  reason per row for the tips (`busInfo`): `'Off'`, `'No 921A / 921 3 in this patch'` (the listed types' shorts and k), the bound's.
  **`vals` absent → no row at all** (the CP2's always-on rows included: stage 9's callers see stage 9's payload). In `payload` the
  live rows follow the sorted cords as 5-tuples, sorted alike; `wiring` (so `live` / `liveNodes`) takes them as cords into inputs.
- **A preset writes every routing switch** (skeptic #6): bound panels as before (every param); an unbound panel's switches that read
  on are written 0 (an entry created if needed) and join `back` — unlit panels get no write, so a Model 15's back meta and the
  frozen records are unchanged.
- **`loadSet(rec, vals, id)`**: `FAMILY.sets[id]`; no id = the family's `set` / `starter` (stage 9's call); an unknown id → `why: 'No
  such set'`. **`setNeeds(rec, id)`** = Σ over the set's types of max(0, needed − present); −1 for no set. The host greys a tile
  when `count + setNeeds > 48`.
- **Tidy**: the rows are `[...rows, console]` (the console row lowest); a type no row names goes to the shorter *cabinet* row; the
  width is `rackWide` when the patch holds more than `rackN` modules **or any console module**, else `rackW` (a Model 15: 1 024, its
  tests unchanged). **freeSlot**: H = the tallest 5U type (512); hc = the tallest console module present (352, else 0): a console
  type's line −hc, a cabinet row r's −hc − (rows − r) · H, above-the-rack lines −hc − (rows + k) · H; x within the same width rule.
- **`makeSet(id, vals)`** (moog-core): `model15`'s builder over `SETS[id]` plus loadPreset's driver shedding (a no-op for the three
  sets as shipped); an unbound routing panel is new, so nothing to switch off. `model15(v) = makeSet('m15', v)`; the tests compare
  `makeSet` with `loadPreset(fresh, vals, starter, { ensure: set })` for m15 / s35 / s55 and four vals each (rec and vals).
- **The presets as built** (§2.6, tuned on V9c's circuits at 252a750 read in scratch, never committed here): *Swept band* 20 cords as
  written (CP35 attenuator 1 at 5 → 904A `c2`; GATE → GATE IN → S-TRIG OUT → 911 3 → 904B `c1`, T1 6 ≈ 0.33 s; CP3A master 6.5, 7.5 after review 1 F5).
  *Sequence* **24 cords**: §2.6's 20 + P-3 (b)'s gate (KBD PITCH 1 → 902 2 `i1`, GATE → its `c1`, LIN at −2 V, `o2` → the
  controller's multiple A → 921A 1 `f2` and the 921 `f2`) and ROW B → 904A `c2`; the Song clock 1/16, LENGTH 8 (`ln` 7); 960 `os` 0;
  the riff on ROW A ×1 (0, 0, 15/12, 35/12, 5, 50/12, 35/12, 25/12); CP3A 9 / 6 / 8, master 8; OUTPUT 10. *Twenty-four steps* 28
  cords: rows A / B / C (Cm · A♭ · G7 shapes, ≤ 20 semitones) → 962 `i1…i3`, `q1` → 921A 1 `f1`, `q2` → the 921 `f1`; 960 stage 1
  OUT → 962 SHIFT; RESTART → 994 B → 960 IN 1 and 962 TRIGGER IN 1; LENGTH 24 (`ln` 23). *Echo strikes* MULTIPLE / LAST, the 911A
  SERIES at 6.25 (≈ 150 ms each), CP3A master 8. *Vowel*: the two saws summed on the controller's mixer (×1.6 each) into the 914's
  INPUT 1 — two inputs would average them (−6 dB) [C, headroom]. *Step bass*: **the 902 before the 904A** — ROW A ×4 (a falling
  staircase 4 V … 0) on its upper input, ROW B ×4 at the stages' mean (2 V) on its lower: the differential takes the offset off
  exactly (the 904A's soft input would not pass it at unity); RANGE 410 Hz, VERNIER 10 · log₄(523.25 / 409.6) ≈ 1.766 so C4 clocks
  523.25 Hz (C2 = clock / 8): keys C3 … B4 → C1 … B2, the 1 kHz clamp above; KBD PITCH 2 → 904A `c2`. *Routed*: CP3A 1 `r1`, the
  993's `f1 t1 t2 e1`, the 911A OFF at d1 4 (≈ 32 ms), six cords, CP3A 9 / 8 master 8, OUTPUT 10.
- **Measured** (moog-core.test's method over V9c's 252a750, 48 kHz × 4, peak / RMS dBFS; the clocked pair from a stop at 120 BPM):
  Swept band −9.1 / −26.0 · Sequence −8.9 / −22.2 (a key held −8.2) · Twenty-four steps −8.2 / −21.0 (held −7.6) · Echo strikes −9.9 /
  −21.9 · Vowel −7.2 / −18.1 · Step bass −10.3 / −20.2 · Routed −9.2 / −21.2; stage 9's six as recorded. With those circuits swapped
  in, moog-core.test passes 16 / 17 (the faces' cross-check: P9b's window) — incl. PatchMoog's EV / LAMPS = the tables and "the
  clocked presets step from stage 1": Sequence 1…8 on every sixteenth (6 000 frames), Twenty-four steps' 962 A → B → C.
- **For V9c (found while measuring)**: `M960`'s constructor calls `reset()` with the default params (`base()` copies the defaults;
  the machine's `reset()` also runs `m.reset()` before `m.p.set(m.t)`), so a freshly built 960 takes CLOCK AT START's default
  (Running): *Sequence* / *Twenty-four steps* (`os` 0) free-run at 2.1 Hz (RANGE 1.6 Hz × VERNIER 2) until the first Play-from-stop
  reset — the lamps cycle on a System 55 just added, before ▶. The tests above emulate the engine (built stopped, `reset()`, then
  Play); power-on should take the stored `os`.
- **Gates**: patch-core.test 35 / 35 · moog-core.test 14 pass + 2 windows (V9c's PatchMoog, P9b's faces) + 1 skipped (the stepping
  check, until V9c) on this branch · lint 159 / 159 · **golden-moog 6 / 6 bit-identical** (457 MB) · the frozen Model 15 records
  identical at every commit (also pinned in patch-core.test against `tests/ref-9-core/MANIFEST.json`).

### Lane V9c (circuits + evaluator; 2026-10-22, base b06f1aa, K9b's tables merged at 8a1fdbd; `moog-dsp.js`, `patch-dsp.js`, their tests, RM §9 / §10; scratch `9b/v9c/`)

Built: `moog-dsp.js` — the sixteen `SPEC` rows, classes and `T` entries appended after stage 9's (nothing existing edited: the ten
classes, the shared helpers and their rows untouched; `insAcc`'s loop and `T` / the export only gained lines), `EV` / `LAMPS` (a
row for every type, ids in moog-core's order), the new constants in `K`. `patch-dsp.js` — a family's `EV` / `LAMPS` read into the
type info (`nEv`, `nLamp`); the machine's **`ev(n, k)`** (→ 1, or 0 dropped: no graph, no module n in the latest graph, k outside the
type's row, no `ev`), **`lamps(F)`** → `{ F, l: [n, bits, …] }` over the latest plan's live lamp modules (a new array: the monitor's),
**`lampN`** (set by `graph()`); the chunk loop and every stage-9 path unchanged. moog-core ↔ PatchMoog agree on every type (jacks,
params, ranges, sections, `ev`, `lamps`: moog-core.test's cross-check and `9b/v9c/xcheck.mjs`).

**Gates** (one file at a time, 2048 MB; wt-9b at 6749734 merged — K9b's presets): moog-dsp 52 / 52 (≈ 10 s), patch-dsp 29 / 29,
golden-moog 6 / 6 (ref-9 bit-identical at every commit), lint 159 / 159; moog-core 16 / 17 — its clocked-stepping check runs; the
faces' test ("a face for every type") waits for P9b (§7.2's window).

**Per type** (the spike (a2) method — the type minus its null twin through the evaluator, OS 4, 48 kHz, median of 9 alternating
pairs, `9b/v9c/alone.js` over the real classes; V8 node 24 / the macOS `jsc`, ×10⁻³; every one inside decision 4's limits):

| type | V8 | JSC | limit |
|---|---|---|---|
| 904B (c1 patched) · no CV | 1.58 · 1.30 | 1.59 · 1.11 | ≤ 3 |
| 914 | 7.24 | 6.97 | ≤ 8 |
| 911A (PARALLEL, both in) | 0.47 | 0.58 | ≤ 1 |
| 903A (white + pink) | 0.34 | 1.46 (the xorshift, as the 923's 1.49) | ≤ 1 (§3.7: ≤ 2 JSC) |
| 960 *Sequence*-like (SHIFT + IN 1, rows A / B) · its clock at 410 Hz, six outputs read · + CONTROL INPUT | 0.96–1.22 · 1.56 · 2.06 | 1.45 · 1.09 · 2.18 | ≤ 2 · ≤ 2 · ≤ 3 |
| 960 in a one-member loop (OUT 5 → IN 1) | 3.47 | 3.50 | ≤ 5 |
| 961 V→S (one A, one B) · AUDIO → V · all four circuits | 0.54 · 0.23 · 1.25 | 0.59 · 0.46 · 0.98 | ≤ 0.8 / section · ≤ 0.4 |
| 962 (three inputs, SHIFT) | 0.61 | 0.58 | ≤ 1 |
| CP3A mix, two / four inputs | 0.39 / 0.64 | 0.53 / 0.66 | ≤ 1.5 |
| CP2 (two sections) · 992 · CP4A · CP35 (two sections) | 0.64 · 0.10 · 0.13 · 0.30 | 0.75 · 0.12 · 0.04 · 0.08 | ≤ 0.5 / section |
| Song clock: SONG stopped · ALWAYS (three outputs read) | 0.10 · 0.27 | 0.11 · 0.39 | ≤ 0.5 |

In moog-dsp.test's own harness (costOf: a module's ctl + run alone, its floor ≈ 0.1–0.3 included) the same types read 0.4–2.2;
that test gates at three times the limits, as stage 9's. A System 55 slice (20 modules through the evaluator, the transport
looping): 0.024 V8 (no decimators, no Track).

**Choices [C]** (the contract refined, with the reason):
1. **The 960's fresh flip-flop is taken at its first `ctl`** after construction / reset, not in `reset()` — the evaluator writes
   the stored values after both, so a constructor's reset read the default (E9b's find on 252a750: a new 960 with CLOCK AT START
   STOPPED ran its clock until Play-from-stop). A test renders every 9b type off its defaults against the same machine reset at
   frame 0 (only the 960 differed); no other 9b class reads a value in `reset()`.
2. **The 960's clock**: a start (OSC ON) raises OUTPUT without a shift — the phase continues from where it held (fresh 0), so the
   first stage plays a whole period, as a free oscillator restarting; ON and OFF in one sample → off; several IN rises in one
   sample → the highest stage; from stage 9 a shift walks to stage 1 like any other (passing SKIP stages; with 1 … 8 all SKIP and
   stage 9 on STOP it stops on 9 again).
3. **Events at `ctl`**: the flip-flop's in arrival order, then every SHIFT, then the last SET — a SET wins over a SHIFT in the
   same chunk, as IN over SHIFT in the same sample; the 962: the last SET of the chunk.
4. **The 960 / 961 / 962 rebuild their patched lists only after a re-wiring**: their own `ins` accessor (insAcc's, plus a stale
   mark on any access — the evaluator re-wires a slot only through it: `make()`'s whole array, `install()`'s `m.ins[k] = …`) — the
   lists rebuilt at the next `ctl`, never every chunk (decision 4's "once a chunk" was the ceiling; the 961's 24 slot checks a
   chunk cost ≈ 0.3–0.5 ×10⁻³ alone). The 961's V→S runs input by input (B rises, the one-shot, A levels): n-independent.
5. **The 961**: each A input its own +1.5 / +1.0 V Schmitt (a level with the house thresholds); the AUDIO → V comparator works on
   the signal itself (one pulse a cycle above θ), not a rectified one; two S → V circuits (MS-961; VK says one).
6. **The 962's clip** is hard at −1 V; a SET / TRIGGER IN to an unpatched INPUT 3 selects it (0 V) and the next shift goes to 1.
7. **The 914's alignment**: δ 0.2 oct, Q 2 (the band), Q 0.6 (the sections), 0.925 at a band's centre, polarities alternating along
   the bank with the sections continuing it — fitted on the analog prototype (± 1.35 dB; one polarity at best ± 5.6 dB: two
   cascaded sections turn ≈ 140° at a crossover); digitally −1.42 … +1.34 dB.
8. **The 904B flushes its four states every chunk in `ctl`** (with f_c near fs / 4 a stage falls × 0.03 a sample in silence and
   went subnormal inside the 32-chunk flush; in `ctl`, so block and loop-member runs stay the same bits).
9. **The Song clock** plans each chunk in `ctl` (constants, or per-sample levels in a chunk with a change; `run` copies the plan).
   An event exactly on a chunk's sample 0 belongs to that chunk: a wrap the previous chunk placed on its sample CH fires RESTART at
   this one's 0, and a half step less than a sample before a segment's start is an event there (LENGTH's RESTART on a chunk
   boundary was lost without it). A RESTART during a pulse extends it (no low gap). LENGTH = moog-core's `ln` index + 1 (index 0
   OFF), as K9b's table (Off, 2 … 32).
10. **The 911A** counts OS samples (held at D + 1); the delay rounds to a sample (≤ 2.6 µs at 48 k × 4).

**For the other lanes**:
- **E9b**: the interface as §7.4 — `pm.ev(n, k)`, `pm.lamps(F)`, `pm.lampN`; the Song clock reads `h.inst.tp` (play, frame, tick, fpt,
  wrap, ls, le, end) and `h.inst.bpm` in `ctl`, so the warm-up needs one round with a playing `tp` and a wrap (§3.1) to reach its
  SONG branch and its slow path (a chunk with an edge); the 960's fresh state needs a first `ctl` after `reset()` (P-2's ptFresh is
  followed by a render: nothing to do). `tests/moog-dsp.test.mjs` has a Track-like transport (`songStep`, `songPlay`) that
  golden-moog-b may reuse.
- **K9b**: your seven presets over these circuits (moog-dsp.test: `presetM` passes `vals` to `payload` for the bus rows and gives
  the clocked two a transport from frame 0; 48 k × 4 peak dBFS): Swept band −9.1 · Sequence −7.8 · Twenty-four steps −8.2 · Echo
  strikes −9.9 · Vowel −7.2 · Step bass −10.3 · Routed −9.2 — all inside −12 … −3; *Sequence* / *Twenty-four steps* on stage 1 at
  the first step and stage 2 at the second with the live anchor 0 … 3 frames off the grid; *Step bass* C3 → 32.70 Hz, G3 → 49.00 Hz,
  C7 → 125 Hz (the clamp). Your 960 power-on finding = E9b's = choice 1 (f6d11d5).
- **P9b / U9b**: lamp bit i = `LAMPS[t][i]` (the 960: `l1` … `l9` bits 0 … 8, `lo` bit 9; the 962 `l1` … `l3`; the Song clock `lr`).
### Lane E9b (engine + plumbing; 2026-10-22, base 8a1fdbd; V9c's 252a750 / f6d11d5 / a26e44a and K9b's 6749734 merged as they landed; `engine.js`, `cv-cost.js`, the bench files, `tests/engine-track.test.mjs`, `tests/cv-cost.test.mjs`, `tests/golden-moog-b.test.mjs` (new); scratch `9b/e9b/`)

Built — **engine.js §3.1**, every new statement behind `s.pe !== undefined`, `kind === 'patch' && pm !== null` or the warm-up:
- **Events**: `seqMsg` routes `{pe}` with `{pg}` to `ptMsg`, which hands `[n, k]` to `pm.ev` at once (the module holds it for its next
  `ctl`); not a patch, no machine or a malformed event → dropped, never `pmPend` (a TB-303's payload path untouched).
- **Lamps**: `postMon` (the graphed branch, and the legacy one alike) posts `pt: pm.lamps(this.frames)` in a patch Inst's `smon` when
  its machine's latest graph holds a live lamp module (`lampN > 0`); F = the Track's frame at the post (the drums' `dr` form); a patch
  without lamp modules and every other kind post today's message.
- **The Song clock's feed**: nothing new in the engine — V9c's class reads `inst.tp` (the Track's, by reference) and `inst.bpm` in
  `ctl`; the engine's part is the transport as it was (an anchor applied at the first 4-frame span start ≥ its frame, spans cut at a
  wrap and at a pending anchor, P-2's `ptFresh` at Play from a stop). Proved through the whole Track: engine-track "the Song clock
  through the Track" (count-in silent, ▶ 3 frames off the grid on stage 1, a tempo change's late re-anchor no restart, a seek and a
  loop wrap a restart, LENGTH 8 — the test fails with the seek's restart taken out) and golden-moog-b's D7 / span invariance.
- **The warm-up** (§3.1, skeptic #7, spike (a2) decision 1): `ptWarm` → `ptTab` + `ptWarmOf(pick)` + **`ptWarms(F, f, MAXC)`**: the
  whole table while its a / b / c fit the evaluator's 256, else k parts (contiguous in ptWarm's order, balanced by jacks, a linked type
  in its driver's part). The 9b table → **two parts** (9 and 19 modules; a / b / c 131 / 186 / 167 and 101 / 130 / 105 connections;
  the whole table's a, 230, is the pre-warm's payload). **Every module's multiples** are patched now (stage 9's drove the controller's
  only: the 994's and the CP panels' were never warmed); b's self cord is that input's **only** source (a lone late read: the loop's
  pre feed — stage 9 met it by luck of the table); c leaves the normalled inputs unfed (their normals under a ramp) and module 1's first
  input empty, then b again (a ramp from nothing). `warmPatch`: the machine; the values in five shapes and the controller's list in five
  elements kinds; **100 graph() calls of the whole table and its flip** (less its first connection), back to back; then 2 rounds × 2
  parts — in each, every event of every evented module (the 960's twelve overflow its 8-slot ring), a lamp read, graph b under a
  stand-in playing `tp` (swapped back in the `finally`): count-in −40 ticks at fpt 0.25, so tick 0, the half steps, the loop wrap
  (round 0) or the song's end (round 1) all fall in one quantum — the warm-up's currentFrame stands still, so each quantum replays
  them: a jump back each (a seek's RESTART). `warmPatchOn` plays the part holding the driven type.

**Choices [C]** (the contract refined, with the reason):
1. **The GC pre-warm first, not last** ("end warmPatch with" — §12 decision 1): graph() then runs optimised through the rounds, whose
   transitions meet the optimised graph()'s holey entry arrays (TurboFan's inlined `map` builds holey, the interpreter's builtin
   packed): with the pre-warm last, `wire()` was optimised on packed arrays only and deopted ("wrong map", patch-dsp's `for … of A`)
   at m9x's arrival on a new Track. JSC either way: no flip over 1 ms after the warm-up (600 m9s bus flips over three processes, max
   0.28 ms; without the pre-warm the 26th flip took 2.8 ms — spike (a2)'s eden GC).
2. **Values in five shapes, the controller's list in five elements kinds** (whole numbers, fractions, a hole, a non-number — ignored,
   its default): the machine's `vals()` read `pv['m' + n]` and `e.length` monomorphically and deopted on a new Track's pv (another
   map; another realm in the tests' harness); five or more maps make those reads generic.
3. **warmPatchOn plays the part with the driven type** (the 921Bs'), not the whole table (its 28 live modules over the 480 interleaved
   quanta: +190 ms on V8, the cap's whole margin) nor the first part: on JSC a new Track's first patch quantum then runs × 1.8 of steady
   (0.07 ms; × 5, 0.24 ms, with the first part; stage 9's files × 3.3) and Classic bass's steady state is stage 9's again (0.039 ms a
   quantum, was 0.047). A third warm round of that part did as much for the first quantum but cost +5 % on V8 and left the 921B's `ctl`
   (`drift` inlined) TurboFan-compiled against an Inst map the later warm-up generalises — a deopt on a new Track: dropped.
4. **The leftovers' tiers** (§0.2; V8 `--trace-opt` at the warm-up's end): `outStage` TurboFan; `ptRamp`, `renderPatch`, `fadePatch`
   Maglev (the optimising mid tier; TurboFan would need rounds the cap does not hold); `renderSpan` interpreted after a late deopt —
   as stage 9's (ref-9's trace the same). First quanta of a new Track (payload / first note / m9x arriving, × steady): V8 3.0 / 1.3 /
   1.4 (gates 4 / 1.8 / 2.5), JSC 1.8 / 1.1 / 2.0–2.5; no deopt in patch-dsp.js / moog-dsp.js (7 before this lane, at the base with
   V9c's classes: the truncated graphs).
5. **cv-cost**: `COST.patch` from V9c's V8 column (§12 Lane V9c), sectioned types per section [C] (the 961's V→S 0.0005 each, S→V
   0.0001, AUDIO→V 0.0002; the CP2's filters 0.0003, its keyboard copies 0.0001; the CP3A's mixer 0.0005, its EXT 0.0001; the CP35's
   sources and attenuators 0.0001), the 993 / 994 / CP8A 0; `patchLoad(cs, rec, vals)` over `liveNodes(rec, f, vals)`: a routed 911
   costs its own and its keyboard section; `estimate` takes the device's `vals` (destructured — the N5 ratchet counts `x.vals`).
6. **Bench rows**: m9q = *Sequence* as the System 55 tile leaves it (`MG.makeSet('s55')`), the Song clock on ALWAYS (15 of 37 modules
   live); m9s = the set re-patched (`initPatch`, then 23 cords + nine bus rows: the 993's seven, the CP2's two; 23 live), the bass line as
   roll notes; `patchTrack` posts the payload with the vals. Targets in bench.json carry `jsc` (decision 3's) beside node / ipad.

**Measured** (bench.json `"m9b"`): node gate (calibrated) **m9q 0.0232, m9s 0.0443** (targets 0.03 / 0.055; m9p 0.0189, m9x 0.0374,
m9d 0.0194 in the same run); the jsc shell **m9q 0.0182–0.0193, m9s 0.0359–0.0371** (targets 0.022 / 0.042; iPad ≈ 0.017 / 0.032 under
0.02 / 0.04); stage 9's three on JSC 5–8 % above their record (m9p 0.0153–0.0159 vs 0.0143) with the 26-type family — the engine.js
A/B on m9p +1.7 %, so the family's, not this lane's; cv-cost 0.0224 / 0.0385. **Warm-up**: V8 × 1.11–1.15, JSC × 1.10 of stage 9's
(ref-9's three files, alternating fresh processes; cap 1.25; the spike's 1.17–1.22 was with the truncated graphs). **The System 55 tile
on a new Track** (V8): its graph() 0.38 ms (37 built), first quanta 0.18–0.21 / ▶ 0.29–0.34 ms (¼ deadline 0.67), 40 bus flips: graph()
median 0.09, max 0.23–0.42 ms. **engine.js V8 A/B** (8a1fdbd vs E9b, every other script current, 3–11 pairs): c1 0.97–0.99, c3 1.00–1.04,
d 0.97, e 1.00, r 1.01, mk 1.01, d6p 0.99, d9p 1.00, dvp 1.00, m9p 0.99, m9x 1.01, m9d 1.00, d8p 1.02–1.03 (the harness with one engine
on both sides reads d8p 1.05: its B-side bias), mc0 / mt within 0.0001 absolute.

**Tests**: engine-track **100 / 100** (+5: events, lamps, the Song clock through the Track, the System 55 tile and its flips, the
warm-up time; rewritten: warmPatch over the parts — every payload within 256 and analysed with no `why`, every type and jack across the
parts' graph a, a lone self cord, the 921Bs' sync driven by a module in a graph with a loop step, normals under a ramp, every event
delivered, a lamp read, the playing stand-in with a wrap / an end / a count-in, ≥ 100 whole-table calls, the Track's `tp` back —; the
headroom over the thirteen presets (the clocked pair from ▶, every one sounding, Classic bass −12 … −3); the bench gate over five rows);
**golden-moog-b** (new, freeze mode, ref-9b **not committed**: 45 cases — the sixteen types at their settings, every row of the 992 /
993 / CP2 and the lit CP3A / CP4A rows, the Song clock SONG (a wrap, LENGTH) and ALWAYS, the seven presets, a graph change and routing
switches mid-sequence, OS 2, 44.1 kHz —, their validity and differences, D7 Sequence offline = live and off-grid anchors on stage 1,
span invariance with a wrap inside a span and a tempo change's late re-anchor; the freeze path tried once in scratch: written, 6 / 6
frozen, removed); cv-cost **18 / 18** (+1: the bus rows and the m9q / m9s estimates; the coverage pin with the zero-cost three).
**golden-moog** unchanged (the lead's pin to stage 9's types and presets suffices: it renders through `PT.payload(rec)` without vals,
stage 9's bytes).

**Gates** (one file at a time, 2048 MB): engine-track 100 / 100 · golden-moog 6 / 6 · golden-moog-b 6 / 6 · cv-cost 18 / 18 · bench
6 / 6 · bench-page 2 / 2 · lint 159 / 159 · golden-classic 8 / 8 · golden-fx 3 / 3 · golden-presets 8 / 8 · golden-random 1 / 1 ·
golden-graph 6 / 6 · canonical-stream 1 / 1 · golden-drums 5 / 5 · golden-606 11 / 11 · golden-909 9 / 9 · golden-sdsv 5 / 5 — every
frozen golden bit-identical.

**For H9b**: lamps arrive as `smon.pt = { F, l: [n, bits, …] }` only while the device is monitored (`{t: 'mon', ids}`) and its live
graph holds a lamp module — queue them by F as the drums' lights; an event is `{t: 'seq', i, s: { pe: [n, k] }}` with k the index in
`TYPES[t].ev` (no reply; dropped unless the node's Inst is a patch with a machine); the payload is `PT.payload(rec, f, vals)` (the bus
rows) everywhere, `cvCost.estimate(device)` reads the device's `vals`. **Found on the way** (V9c's, fixed in f6d11d5): a freshly built
960 ran its own clock until a reset (CLOCK AT START read before the values). The m9s row is quiet (peak ≈ −36 dBFS: two 902s in series
on routed envelopes) — audible, as the bench requires.
### Lane P9b

**P9b (base 8a1fdbd; `panels/m900b.js` (new), `panels/index.js`, `cv-panel.js`, `tools/panel-check.mjs`, `tests/cv-panel.test.mjs`,
`tests/cv-face.test.mjs`; scratch `9b/p9b/`)** — commits 65db941 (faces + cv-panel), ae3fd95 (panel-check, the Chrome look's
tweaks), dc8c8a4 (cv-panel tests), 21d1448 (cv-face), 11962da (a rule), these notes. No photograph fetched or viewed.
- **`panels/m900b.js`**: `MODULES` = the sixteen 9b faces by type (no default export: moog-core.test reads every exported object),
  merged after m900.js's in `MODULE_LAYOUTS`. m900.js's house treatment (FRAME / PANEL / the knurled knob skin), small builders
  (KN / ROT / BH / BV / LIT / EVB / LMP / JK / SK / TRUNK, `face()`: frame, inset panel, screws) — the data they return is plain.
  Every face says "Ours (no photograph viewed)" in its notes; the CP2, CP4A, CP35 and our Song clock on their plates too ("OURS —
  …"). Layouts [C], from §2's lists: **960** — a clock column (x 0…60: the OSC lamp, OSC ON / OFF, CLOCK AT START, RANGE (seven
  detents in Hz), VERNIER, ROW C → CLOCK, SHIFT; jacks ON · OFF · SHIFT over CONTROL IN · OUTPUT), stages 1–8 in 38 mm columns (lamp,
  A / B / C knobs d 18, STOP / NORMAL / SKIP vertical bat, SET, IN, OUT), stage 9 narrower (30 mm: STOP / SKIP, SET, IN, OUT), a row
  column (two jacks a row level with its knobs, three ×1 / ×2 / ×4 bats); **914** two rows of seven pots (LOW 125 … 700; 1K … 5.6K
  HIGH), the two inputs → the two outputs; **961** two V → S blocks of 6 × 2 jacks at the 15 mm pitch (their row numbers between
  the blocks) over S-TRIG OUT and SWITCH ON TIME, AUDIO → V (IN, SENSITIVITY, OUT 1 / 2), two S → V; **962** three stages (IN,
  lamp, TRIG IN; the stage number, SET, TRIG OUT), OUTPUT ×2, SHIFT; **992 / 993 / CP3A / CP4A** routing switches as **lit push
  switches** (a `button` over the Off / On param, `cycle [0, 1]`, `led: 'cap'`: the amber lamp is the value; the 993's ENVELOPE
  caps green); **CP3A** MIXER (2 MU) · ROUTING · MULTIPLES + TRUNKS; **CP35** SOURCES · four ATTENUATORS · MULTIPLES + TRUNKS;
  **CP2** LOW PASS · HIGH PASS (the 923's Hz dials) · MULTIPLES + KEYBOARD (PITCH, S-TRIG); **CP8A** its switch, pilot lamp and
  fuses dimmed (inert: "… — not emulated"); trunks: inert jacks "TRUNK n"; **Song clock** STEP (6 detents), LENGTH (32 detents,
  OFF 4 8 16 24 32 printed), MODE, the RUN lamp, CLOCK / RUN / RESTART; 904B / 911A / 903A / 994 in the 1 MU style. Rear
  terminals never placed. panel-check: all sixteen valid, no overlaps; least hit box 30 × 30 px (a 15 mm bat / push / event
  box); least jack pitch 15 mm (the 961's blocks: jackHit 28 px), else ≥ 18 mm; least jack-to-hit clearance 11 mm (961 s1 ↔ t1).
- **cv-panel (generic)**: `moduleModel` excludes only `fam.ctl` (the seven console-height types are modules) and carries `ev` /
  `lamps` (`[]` when none). **Event buttons** `{ kind: 'button', ev, x, y, w, h, onCap? }`: no id / value / cycle / inert, one of
  the type's `ev`, each once, every one placed, a ≥ 14 mm hit box pushed with the controls' (overlap and the 9 mm jack clearance
  apply; a jack's widest circle keeps off it); drawn in the art (`g.hw-ev[data-ev]`, titled with the event's label, the scheme's
  button cap, its `onCap` word). **Live lamps** `{ kind: 'lamp', lamp, x, y, d }`: one of the type's `lamps`, each once, all
  placed; drawn unlit (`g.hw-lamp[data-lamp]`, the lens at 0.45). Neither is live / show: no widget, no Tab stop, not in
  `hitBoxes()`. **`geometry().evs`** `[{ id, label, x, y (centre), w, h, hit: {x, y, w, h} }]` and **`.lamps`** `[{ id, label, x, y,
  d, w, h }]`, body px (the host adds BAR_H), `[]` on every other panel. **Rear terminals**: placed → refused; never required.
  **A patch face's inert parts make no extras strip** (each says "not emulated" in its own tip; the size stays the type's).
- **The DOM budget — `lite: true`** (a patch module face only; validate refuses it elsewhere and any non-line pointer on it): a
  knob's / rotary's skirt (knurled: style.css's 70 % mix, dash and width, in the art's units), cap and its stroke are drawn in the
  face art (`liteKnobSvg`); the DOM keeps `.hw-c > div.knob.hw-lk > i.hw-lp` — the pointer, today's line (the 64-unit box: y 8 …
  32 − cr − 1 for capR 0.56), styled inline (left / top / size in %, `var(--hw-knob-ptr)`, turned about the knob's centre by
  `transform: rotate(…deg)`), driven through `api.watch` / `api.dragB(api.bind(mc))` (keys, wheel, Reset / Enter Value as
  today); a lite rotary the same over its detents (tap = next); a lite bat / slide switch drops its `i.hw-sw-t` slot line (the pill
  is the button's own background). **3 painted elements a control** (knob 7 → 3, switch 4 → 3, lit push 3). Every m900b face is
  lite; **no existing panel is** (stage 9's faces keep today's knobs). Headless Chrome: the lite knob beside the 904A's / 911's DOM
  knob — the same picture (`9b/p9b/cmp/faces-all.png`).
- **Every existing panel unchanged**: scratch `9b/p9b/snap.mjs` hashes, for the 17 authored models and the nine Model 15 faces,
  the face SVG, `validate()`, the geometry (less `evs` / `lamps`), `hitBoxes()`, the DOM through `render` over a fake api and
  through a real ClassicPanel — before (8a1fdbd) = after (11962da), byte for byte (26 / 26).
- **Painted elements (headless Chrome, `9b/p9b/`)**: each face's live layer through a ClassicPanel (`tests/p9b.html` in the scratch
  copy, without its SVG): 960 **123** (3 + 40 × 3), 914 45, CP3A 33, 993 27, CP4A 24, 992 18, CP35 15, 961 / 911A / clk 12, 904B /
  CP2 9, 962 / 994 / 903A / CP8A 3. **The System 55 rack** — S9b's `?m9=1&s55=1` page in the scratch copy with its `c55` taking
  cv-panel's real faces (`geometry().evs / .lamps` for its button and lamp spans; patch not committed: S9b's file), scene `s55`
  (38 faces, 40 cords, the lamps toggling): **1 521 painted without the face pictures** (gate ≤ 1 700; S9b's stand-ins 1 847);
  per module **960 181** (≤ 240), **914 56** (≤ 100), 961 52 (≤ 120), CP3A 51 / CP2 26 / Song clock 23 / CP8A 10 (≤ 90), 993 34, 962
  28, 992 26, 911A 23, 904B 21, 994 18, 903A 14 (the Model 15 types as S9b measured); GL faces 38, 69.3 MiB (≈ §4.2's 74 MB).
  Screenshots: `9b/p9b/shots/` (`faces-all.png`, `face-<type>.png`, `rack-s55.png`, `rack-s55-960.png`, `rack-s55-console.png`).
- **Textures** (cv-face test): 4 MU 448 × 472 4.5 MB, the 960 864 × 472 **8.7 MB** (its cap 9 MB; every other face ≤ 6), console
  2 / 3 / 4 MU 1.5 / 2.3 / 3.0 MB; the System 35 set 43.7 MB, the System 55 72.6 MB (≤ 74, ≤ a fifth of FACE_BUDGET_BYTES).
- **Tests**: cv-panel 104 → **108** (the faces test over all 26 + the console: sizes by `face` and MU, rear terminals never placed,
  `evs` / `lamps` = the type's, only trunks and the CP8A dimmed, the plates; four new: one mutation per new rule (22), `evs` /
  `lamps`, the art, the lite render — every 9b face's live layer = 1 + 3 × params: the 960 121, the 914 43). Eight cv-panel
  mutations (the rear rule ×2, an event button's box in `hits` and in the jacks' circles, the patch-face strip gate, the lite slot
  line, `moduleModel`'s ctl-only rule, a lamp twice) each fail a test. cv-face 27 / 27 (sizes, bytes). **Gates** (one file at a
  time, 2048 MB): cv-panel 108 / 108 · cv-face 27 / 27 · classic-panel 14 / 14 · canvas-1i-sim 20 / 20 · lint 161 / 161 ·
  moog-core 15 / 16 (the faces cross-check passes; **moog-core = PatchMoog** fails until V9c's `moog-dsp.js`) · canvas-9-sim
  22 / 22 · cv-module 65 / 65 · main 45 / 45 · canvas-sim 23 / 23 · cv-drum 66 / 66. Windows: **cv-patch 18 / 19** (U9b: its
  faceJacks test expects every jack of a type — `T.jacks.filter(j => !j.rear)`), **cv-tray 35 / 37** (U9b's Moog row), **pwa 21 /
  22** (the lead's precache: new `panels/m900b.js`; no sw.js here).
- **For U9b**: a module's face as stage 9's (`cvPanel.render` through a ClassicPanel; `faceJacks` already takes only placed
  jacks). Event buttons: for each `geometry(L, model).evs[i]` a transparent `button.cv-pev` at its `hit` box (+ BAR_H), labelled
  "<title> · <label>" (the cap and its word are in the art). Lamps: for each `.lamps[i]` a `span.cv-plamp` at its centre (+ BAR_H),
  `d` its size (the lens is d × 0.72; LAMP `#f0642c`, the CP8A's pilot excepted — inert, art only). The routing switches need
  nothing new (ordinary params; `.hw-btn[data-lit]` shows the lamp). `.hw-lk` / `.hw-lp` mark a lite knob and its pointer if
  style.css wants them (nothing needs a rule). Patch faces keep no halos (`canMod: false`): a lite knob has no `.cap` / `.rot`
  nodes for one.
- **For H9b**: `PT_HEAVY` — the real System 55 rack measured 1 521 painted (Mac, headless Chrome) before the cords' and lamps'
  own nodes (S9b's 1 847 was its stand-ins); the iPad session decides.

### Lane X9b

Set tiles for the tray (cv-art.js, tests/cv-art.test.mjs; base b06f1aa). **API for U9b**: `SET_ART` (frozen descriptors by set id, keys `s35` / `s55` — the Model 15's tile stays `art('m900')`; `SIL` keys unchanged =
MODELS ids) with `name`, `modules` (22 / 37 = the tile label's count: faces + console panels, the controller not counted), `rows` ([9, 8] / [16, 14]), `console` (5 / 7), `cords` (0 / 4), `outline` (the silhouette's
polygon in the 96 × 56 box); **`setArt(setId, { w, h })`** → the SVG string (cached per id + size, `data-art` = the set id, TILE default, chip detail under 48 px wide) and **`setChip(setId)`** (CHIP size). An unknown set id gets
`art('m900')` (the Model 15's tile), as `art()` falls back to a keyboard. `tileMeta` is untouched (labels "System 35 · 22 modules" are U9b's, from `SET_ART[id].modules` or moog-core).
- **System 35**: one wood wedge (a trapezoid: sides lean in toward the top, the faces and knobs narrow with it): nine narrow faces over eight (the lower with a wide filter bank: two rows of seven small knobs), a console strip of five
  panels (lit amber switches / two small knobs, three jacks each), grain on the cheeks, **no cords**. 17 + 5 = 22.
- **System 55**: two wood-ended cabinets stacked, the upper a step narrower (an eight-corner silhouette): sixteen tall faces (one wide: the 960's lamp row over three rows of eight dots and a button row) over fourteen (a wide bank, wide pairs),
  a console strip of seven panels in the lower, **four coloured cords** (red, yellow, blue, green — the Model 15's without its purple) from the upper's jacks to the lower's, plugs at both ends. 30 + 7 = 37.
- At a glance: Model 15 = a dark box with a handle and big knobs; System 35 = one brown trapezoid; System 55 = a taller brown-ended step with cords. At chip size (28 × 18) the faces are blocks with a pale bar, the console panels
  amber / grey blocks, the cords kept (2 wide). Same house style as `DRAW.m900` (FACE `#2b2926`, CAP, jacks, the WOOD helper); no text, no logo, nothing traced; no `<text>` / gradient / id (the existing rules, now looped over the sets too).
- Tile weight: s35 356 shapes / 24.6 kB, s55 471 / 33.4 kB (m900: 271 / 17.2 kB); chips 50 / 100 (m900 71). Cached strings, three more per tray.
- Tests (tests/cv-art.test.mjs, the last test): descriptors frozen and `modules` = faces + console = 22 / 37; tile + chip render (size, well formed, cached, simpler chip); the rules at four sizes (+ no "moog" / "system" / "model" / "900");
  the face / console-panel / sequencer-dot / bank-knob / cord / plug counts (tile and chip); the outlines drawn (s35's polygon, s55's two cabinet rects); silhouettes distinct (4 corners vs 8; the wedge wider at every step down and its top
  < 85 % of the foot; the stack constant within each cabinet and a step between, taller); the five wooden-or-dark tiles all differ; the unknown id.
- Previews: the lead's scratchpad `9b/x9b/` — `compare.png` (tiles 1× / 3×, chips 1×, beside the Model 15 / Moog Modular / Minimoog), `big.png` (s35 | s55 at 960 × 560), `big-*.svg.png` (qlmanage), `tile-*.svg`, `chip-*.svg`, `render.mjs`.
- Gates: cv-art 5 / 5, cv-tray 37 / 37, lint 159 / 159. `pwa.test` waits for the lead's `node tools/precache.mjs --write` (cv-art.js changed; no sw.js committed).
### Lane U9b
**U9b (base 557d632 = wt-9b with K9b, V9c, P9b, X9b merged; `cv-patch.js`, `cv-tray.js`, `style.css`, `tests/cv-patch.test.mjs`,
`tests/cv-tray.test.mjs`, `tests/canvas-sim.test.mjs`; scratch `9b/u9b/`)** — commits aab0602 (cv-tray), d91fe4f (cv-patch, style.css),
12dc108 (canvas-sim), b3a8894 (a panel's tips in two reads), these notes. No main.js. Choices within §4 [C]:
- **Event buttons** (cv-patch `moduleBody`): a `button.cv-pev[data-ev]` per `geometry().evs[i]` at its `hit` box, in the face's own
  live layer (`.hw-ctls`: body px — no BAR_H, the layer's origin is the body, as its controls'), `data-nomod`, aria "960 1 · SET 3"
  (relabelled at each refresh: ordinals move). It fires on the **release** of a tap within the slop (TAP_TOUCH 8 / TAP_MOUSE 4); never
  past it, after a pointercancel (gesture.js's two-finger flag), a lost capture, a right button or another pointer; Enter / Space at
  the key (a held key once; the key's own click ignored for 500 ms), an assistive click (detail 0) too, a pointer's click never;
  asleep below READ_K unless the module is in edit state (the world takes such a press first; the button also asks `host.awake`, the
  jacks' rule); `[data-down]` while pressed (a shade). No value, no History step, no knob: `host.ev(t, dev, mid, id)` checks the
  type's `ev` and calls `deps.ev` (→ true when it posted). A mouse's hover shows the event's label (kit.tip).
- **Lamps**: a `span.cv-plamp[data-lamp]` (aria-hidden) per `geometry().lamps[i]`, the lens d × 0.72 at its centre, lit `[data-on]`
  (#f0642c, an inset highlight and a 6 px glow; reduced motion: no glow); bit i = the type's lamp i. `host.lamps(t, dev, { F, l })`
  queues the post per instrument (`LAMP_QMAX` 64, the oldest dropped) and asks **one** frame for every queue (`deps.raf`, else
  wk.frame); there everything heard by then (`F ≤ deps.heard() + deps.rate() · LAMP_LEAD_S`, 1/60 s: cv-drum's rule; no clock → at
  once) sets a bits map per module number (the latest wins) and only the faces whose bits changed are painted, only the lamps that
  changed written — never a DOM write per post; a face off screen (`[data-cv-off]` up its chain) writes nothing and keeps the bits
  for `host.shown(key)`; a face mounted later shows the bits heard; `lamps(t, dev, null)` darkens that instrument's.
  `stats().lamps` = { queued, due, posts, pumps, paints, evs }.
- **Routing switches** (the switches named by a type's `bus` rows: lit push switches, `.hw-c[data-ctl] > button`): `aria-description`
  = `host.busTips(t, dev, mid)[id]` — "<label>: On | Off — <its rows>": a route "Controller · PITCH 1 → 904B 1 · CONTROL INPUT 3" (a
  rear terminal by its table label, "992 1 · EXT (REAR)"), unresolved busInfo's reason ("No 911 3 in this patch", the bound), lit
  but waiting on another switch "(needs Trigger 1)"; shown (kit.tip, 1.8 s) after a flip and on a mouse's hover. Two busInfo reads a
  panel (as it is, and with every switch of the panel on: where its rows would go) — a System 55 sync 2.0 → 0.9 ms (node) against
  two a switch; at the 256 bound the "all on" read may name the bound where the real one would not (an edge, said here).
- **members** (P-1 (a)): a routing panel's lit, resolved rows' modules — the controller's own module too (its keyboard voltages leave
  it), never the panel — beside a driver's driven modules. A flip is a knob (no re-render), so cv-patch re-outlines the selected
  panel itself (`outline()`, cv-module's rule over the view's modules; the selection from the world's 'select').
- **Sets**: `preset(name, { ensure, tidy, label, note, tail })` — `tidy` lays every module of the new record by `rackLayout` from the
  controller's place in the same step (cabinets and the console row; undo gives the places back); `setLoad(id)` = `FAMILY.sets[id]`'s
  starter over its set: "Load System 55", "Loaded System 55 — The sequence starts when you press ▶ · tap to undo", Tidy unless it is
  the family's own set (the Model 15 tile: stage 9's free slots, "Load Classic bass"); unknown: "No such set". `setNote(id)` →
  `SET_NOTES[id]` once a host session ('' after; only s55 has one) — asked only once the step is made, shared with H9b's Replace path.
- **Tray**: `SET_TILES` (moog-core SETS: id, name, modules 22 / 37 = SET_ART's, starter); `o.sets` (array | true) →
  `button.cv-tile.cv-stile[data-set]` (setArt, the name, "22 modules", a reason) right after the patch model's tile (or in
  `o.setsEl`), shown where a view's section says `sets` (the Moog view's m15); a tap → `o.setPick(id, mode)` (never `o.pick`); a drag →
  `o.setDrag` with `info.set` (the canvas "+ System 55", the track list "+ New track"; the ghost hidden while `o.setCanvasGhost()`);
  `setSetPlaced(id, why)`, `setPlacedOf(id)`, `setTiles()`, `setTile(id)`; `setFull(count, needs, max = 48)` → "This set needs N more
  modules than the patch can hold" | null. The row: GROUPS' five headings, 25 tiles. The sixteen glyphs are laid out from cv-panel
  geometry of `panels/m900b.js` (scratch `9b/u9b/glyphs.mjs`, pasted as strings like the nine): one outline (1 / 2 / 3 / 4 / 8 MU →
  12 / 20 / 34 / 38 / 38 wide; 5U 42 tall, console 27, the 960 at its face's aspect, 20.8), a dot a param, a ring a face jack (rear
  terminals never), `.e` an event cap, `.l` a lamp, `.i` an inert part (trunks, the CP8A's); `data-fine` on the 960 / 914 / 961
  (thinner rings). The view's note names the three sets.
- **style.css** (the last section, after stage 9's): `.cv-pev` (transparent, `pointer-events: auto`, `touch-action: none`),
  `[data-down]`, `:focus-visible`, `.cv-plamp`, `[data-on]`, the reduced-motion rule, the glyphs' `.e` / `.l` / `.i` / `[data-fine]`.
- Pins extended (§8.8, none weakened): cv-patch faceJacks (P9b's hand-off: `T.jacks.filter(j => !j.rear)`, the 25 faces), Patches…
  (the thirteen); cv-tray's Moog view (25 tiles, five groups, the glyph rule with `e` / `l` and the outline by face, the note).

**Host interface for H9b** (main.js; cv-patch's names unless said):
- `cvPatch.patchHost` deps gain `ev: (t, dev, mid, id) => ptEv(ptT(t), dev, mid, id)` (→ true when posted: `{t: 'seq', i, s: { pe:
  [n, k] }}`, n = +mid.slice(1), k = the index of id in `MG.TYPES[type].ev`), `heard: ts => outFrame(ts)` (the drums' heard clock),
  `rate: () => ctx.sampleRate`.
- The lamp monitor (beside `drumMonitor`): `monitors.sub` for the shown 900 Series while a face with lamps is mounted; `deliver: d =>
  d.pt && PATCH.lamps(t, dev, d.pt)`; `PATCH.lamps(t, dev, null)` when its node goes silent (⏻ off, P-1's mute / solo-out, a
  Replace, the track gone); `cvHost().shown(key)` also calls `PATCH.shown(key)`. No hold while the camera moves (measured below).
- The tray (main.js 5069–5083): `sets: cvTray.SET_TILES`, `setPick: (id, mode) => (mode !== 'track' && ptShown() ? PATCH.setLoad(id) :
  Replace / + Track through patchNew(…, id))` — on that path the notice adds `PATCH.setNote(id)` when non-empty —, `setDrag` (as
  moogDrag, info.set), `setCanvasGhost`; `ptTray()`: `shell.tiles.setSetPlaced(id, ptShown() ? cvTray.setFull(count,
  PT.setNeeds(rec, id)) : null)` per SET_TILES id. The Model 15 tile keeps `ptSet()` (`PATCH.setLoad('m15')` is the same step).
- `ptKnob`: `PT.isBusKnob` → `patchSend` at once (K9b); the tips and the outline follow by themselves. `srcModeUI`'s moog branch still
  reads "Tap one to use it in place of the 900 Series …" (seen in Chrome): name the set tiles (§6).
- `__synthTest.cv.patch` already carries `setLoad`, `setNote`, `lamps`, `lampBits`, `shown`, `ev`, `busTips`, `stats().lamps`.
- For E9b: the 9b tiles show no load label in the page (`moogCost`: `COST.patch` lacks the new types on this base).

**Gates** (one file at a time, 2048 MB): cv-patch 19 → **25 / 25** · cv-tray 37 → **38 / 38** · canvas-sim 23 → **24 / 24** ·
canvas-9-sim 22 / 22 · cv-module 65 / 65 · cv-panel 108 / 108 · lint 161 / 161. DOM per module (the fake DOM's S55 rig, outside the
face art; its diagnostics): 960 **181**, 921 53, 914 56, 961 52, CP3A 51, 993 34, 921B 30, 962 28, CP2 / 992 / 904A 26, Song clock 23,
CP8A 10 — the rack 1 246 (≤ 1 700).

**Headless Chrome** (155, `--headless=new --use-angle=metal --force-device-scale-factor=2`, 1440 × 900; the real app — a copy of the
tree with `window.__synthTest = {}`, served no-store from scratch; H9b's part stubbed: the set tiles by a second sourcesTray over
#srcList with `o.sets`, the lamps by a page-side stub monitor at 8 Hz (Sequence's 1/16 at 120 BPM: the 960's stage + OSC, the 962's),
ev counted by `stats().lamps.evs`; scripts `9b/u9b/run.mjs`, `pinch.mjs`, `evcheck.mjs`, `glyphsheet.mjs`): the 960 tile, then
`PATCH.setLoad('s55')` → 37 modules, "Load System 55", the notice, Sequence's 24 cords, Fit k 0.5, 38 GL faces 72.6 MB; the Moog view:
five groups, 25 tiles, System 35 / 55 after Model 15, greyed with setFull's reason; the 960's 12 buttons and 10 lamps; by touch a
tap fires once, a moved touch none, a second finger none (the two pinch: k 1.1 → 2), Enter + Space two, below READ_K none; five
posts in one task → one pump and 3 DOM writes after the frame, none before; the 993 selected, ENVELOPE 1 / FROM 1 / TRIGGER 1 flipped
by touch → the tip ("Trigger 1: On — … (needs From 2)") and the outline (Controller, 911 1, 911A 1, 902 1), no History step; a plug
drag 921B 6 SAWTOOTH OUT (the top row) → 914 SIGNAL INPUT 2 (the row below) at k 0.5: the chip, 147 compatible of 294 marked, one
"Patch cord". No console error. **Frames** (the browser's own input path — a synthesized pinch in ×2.2, out, a pan — the lamps at
8 Hz and without): 1× 60 fps, worst 16.8 ms both; **4× CPU 59.2–59.6 fps, median 16.7, p95 16.8, worst 33.4 ms (1–2 frames over
20 ms), with the lamps and without alike** (20 posts → 21 pumps, 44 lamp writes). A scripted `setCamera` every frame (no burst: each
a whole camera write) is the world's own cost at 4× — 21–24 fps with the lamps or without; the lamps alone at 4×: 60 fps. Screenshots
`9b/u9b/`: `rack-s55.png`, `rack-s55-4x.png`, `tray-moog.png`, `tray-moog-groups.png`, `tray-sets-greyed.png`, `glyphs-25.png`,
`960-lamps.png`, `960-lamps-zoom.png`, `routing-993.png`, `drag-s55.png`, `drag-s55-after.png`; results `run.json`, `pinch.json`,
`evcheck.json`.

### Lane H9b

**H9b (base 6a31967 = wt-9b with K9b, V9c, P9b, X9b, E9b, U9b merged; `main.js`, `tests/canvas-9b-sim.test.mjs` (new),
`tests/canvas-9-sim.test.mjs`, `tests/main.test.mjs`; scratch `9b/h9b/`)** — commits 9897451 (the lead's fixture check, failing on the
base: no set tiles), 86a5e08 (§6), 8291fd4 (the §8.6 sims, main.test), b171d91 (`PT_HEAVY`), these notes. §6 row by row:
- **Sets**: `patchNew(t, dev, type, set)` → `MG.makeSet(set, vals)` (else `model15`, stage 9's bytes); `addTrack` / `setTrackModel`
  pass `o.set`. `ptSet(id = 'm15')` = `PATCH.setLoad(id)` (the Model 15 tile: the same step as stage 9's, `FAMILY.sets.m15.set ===
  FAMILY.set`). The tray: `sets: cvTray.SET_TILES`, `setPick(id, mode)` (a shown 900 Series → `ptSet(id)`; else a Replace through
  `cvDropInstrument(m900, null, { set })`, or + Track → `setTrack(id)`), `setDrag`, `setCanvasGhost`; `ptTray` greys a set tile by
  `cvTray.setFull(count, PT.setNeeds(rec, id))` on a shown 900 Series (never elsewhere: a Replace always fits).
- **The payload with vals** everywhere: `patchPayload` = `PT.payload(rec, rec.f, vals)` (so `patchSend`, `graphParts` — a new node's
  options —, `offParts` / `bounceSet`, applyRestore's loop: skeptic #21 holds, tested), `syncedOf`'s `PT.live(rec, null, vals)`.
  `ptKnob`: `PT.isBusKnob` → `patchSend` at once, before the throttled `{t: 'patch'}` (the flip is the graph change; patchSend's key
  keeps an equal graph from being posted again).
- **Events**: `ptEv(t, dev, mid, id)` → the node's `{t: 'seq', i, s: { pe: [n, k] }}` (k = the index in the type's `ev`), false
  without a node, for the controller, an id the type lacks; PATCH's deps `ev`, `heard` (outFrame, the drums'), `rate`.
- **Lamps**: `ptLampMon` — one `monitors.sub` (role 'inst') per (track, 900 Series) while a mounted face of it declares lamps
  (pmMount / pmUnmount keep its keys: the 960, 962, Song clock of a System 55), live while the track is selected and one of those
  faces `cvLive`; `deliver` → `PATCH.lamps(t, dev, d.pt)` **only while the patch is heard** (`ptHeard` = audible and ⏻ on): the
  engine keeps posting a powered-off machine's frozen lamps, so they are dropped, and `ptDim` (mix / cvPower / ptShow: mute,
  solo-out, ⏻, a track switch, an undo) darkens them with `PATCH.lamps(t, dev, null)`; a Replace away and a deleted track clear
  the queue. `cvHost().shown(key)` → `PATCH.shown(key)`. No hold while the camera moves (U9b's measure; Chrome below agrees).
- **Notices**: the Replace names the set and adds `PATCH.setNote(id)` (asked once the step is made; once a session, shared with
  `setLoad`): "Replaced Minimoog with 900 Series (System 55) — The sequence starts when you press ▶ · tap to undo"; + Track says
  "New track with System 55 — …" only when there is a note to say. `srcModeUI`'s Moog branch names the sets: on a 900 Series
  "… **Model 15** loads Classic bass over the patch; **System 35** and **System 55** bring their whole set, patched and laid out
  (tap to undo) …", elsewhere "… with a 900 Series holding it — **Model 15**, **System 35** or **System 55** for a whole set,
  patched — …" (canvas-9-sim's F4 pin extended to these words, its tile list to the set tiles and the 25 module tiles).
- **setDrag** [C]: over the canvas the set's **whole rack outline** (`setBox(id)`: Tidy's rows of `makeSet(id)` and the console:
  the System 55 2 624 × 1 728 from (0, −1 376)) pinned with its controller on the instrument's module — where a Replace puts it,
  or the shown 900 Series' own controller, from which the set is laid out —, "+ System 55 · replaces Juno-60"; the drop = the tap;
  the track list: a new track.
- **`PT_HEAVY` = 4 802** (superseded: 2 048 in the painted unit, review 2 F6 below) [C, from the measures]: the app's S0 counter (`sxHeavyCount`) counts every element with a layout box,
  the GL faces' `visibility: hidden` SVGs included, so the line is in that unit. The patch scenes measured P+: the user's iPad
  ran stage 9's m30 at **4 423** ("ui-m9"); under the user's interim gate (the Mac at 4× CPU until the consolidated iPad pass,
  §13) S9b's s55 rack ran P+ at **4 802** ("ui-m9b-mac" throttle4) with more live elements than the real rack carries (1 847
  without the face pictures vs 932 here). The real System 55 counts **4 710** at rest in headless Chrome (3 778 hidden face-SVG
  nodes, 932 painted live; 24 cords), so it gets no notice; the System 35 + a 914 2 939; a full 48-module rack (the System 55 +
  the Sequencer Complement's kind: 2 × 960, 961, 2 × 962, 994, 2 × 911, 2 × 902, 995) **6 879** — the notice. 4 423 would have
  put the notice on every System 55 the iPad opens on no device evidence either way; the consolidated iPad pass re-decides.
- `__synthTest.cv`: `setPick`, `setDrag`, `setBox`, `ptEv`, `ptLamps()` ('trackId/dev' → the mounted lamp faces' keys).

**Tests**: **canvas-9b-sim 9 / 9** (new, accessor-free): the fixture check (the tile on track 1 → 37 modules, Sequence's record and
knobs = `makeSet('s55')`, the notice; `{t: seq}` = `payload(rec, f, vals)` with the routing rows of none — every switch off, the
CP2's two always-on rows, `pg.cords` = cords + 2; stopped the 960 holds stage 1 (its lamps through the monitor); ▶: the transport
after the graph, stages stepping at 1/16, the face lit from the queue; **a held C5 an octave up** (autocorrelation over the
riff's first two C steps: 371 → 185 frames) and as written again; a 993 switch → one new pk at once, no step, off → the old pk) ·
the System 35 tile on another track (Replace named, no note for it, the rack at Tidy's places: the console row flush above the
controller, two cabinet rows, ≤ 2 816 wide; its tap undoes; + Track and a track-list drop: new tracks with the set, the System 55's
note not said twice) · the drag outline (pinned, its label, the drop replaces / on a 900 Series loads the set) · the System 55
over a Model 15 900 Series (one step "Load System 55", 12 + 27 modules, every module laid out — a hand-moved 921 too —, knobs then
graph, undo gives topology, knobs and places back; greyed at the cap: a Model 15 + 10 more 995s → "This set needs 1 more module
than the patch can hold", the System 35 still fits, a greyed tap does nothing) · routing switches (a flip posts, no step; a cord
pulled and undone keeps the switch and re-posts with its row; Routed loaded and undone → the switches back off, the graph re-posted
by applyRestore's loop; the 993 selected outlines 911 1 / 902 1, + the controller and the 911A with FROM 1 + TRIGGER 1) · SET 3 by
Enter on the 960's button → `pe [13, 5]`, stage 3, lamp 3 lit on the face, ptEv's refusals, the monitor off on another track and
back · ▶ steps / ■ holds; muted: dark, no post delivered, unmuted fresh at stage 1; ⏻ off dark, undo lit · save / reload identical
(a lit switch kept), the bounce of Sequence with no notes (its rows in the payload; every step sounds) · `PT_HEAVY`, a Replace away
and its undo (the monitor and the queue). **main.test +1**: a System 55 over `#m900`'s Model 15, a 993 switch lit → its payload at
once, `graphParts` and `offParts` carry the same rows; the set tiles in the Moog view. **canvas-9-sim**: pins extended (above).

**Headless Chrome** (155, `--headless=new --use-angle=metal --force-device-scale-factor=2`; the tree copied to `9b/h9b/site/`
with `window.__synthTest = {}` before main.js (`h9b.html`), served no-store on 8871, CDP 9341; `9b/h9b/run.mjs`, `probe.mjs`,
results `run.json`): the Moog view lists Model 15 · System 35 (22 modules) · System 55 (37 modules) and the 25 module tiles; the
System 55 tile on the Minimoog track → 37 modules, 24 cords, "Replace Minimoog", the notice above, the node graphed (pk afd31db8),
one lamps' monitor (3 faces); stopped: stage 1, level 0; **▶ → the transport, stages 2 … 8, 1 … 7 stepping with the lamps, the
track's peak 0.16–0.20**; with ROW A at 0, **C5 held 259.5 Hz over 129.4 (× 2.005), released 129.4**; SET 5 by touch → `pe
13,7`, no step; **■ holds** (one stage throughout); the 993's ENVELOPE 1 by touch → a new pk (1861665d), no step, its tip
"Envelope 1: On — 911 1 · OUTPUT → 902 1 · CONTROL INPUT 3", 911 1 / 902 1 outlined; + Track with the System 35 tile (22 modules,
Swept band), the 914 tile on it → "Add 914"; save and reload: every record, knob and place identical; no console error, no
exception. **Frames** with the sequence running (the monitor's real lamps): the browser's input path (a synthesized pinch ×2.2 /
×0.45 and a pan) **1×: 60 fps, worst 16.8 ms; 4× CPU: 59.2–60 fps, median 16.7, p95 16.8, worst 33.4 (1–2 frames over 20 ms)**;
a scripted camera write every frame (no burst: the world's own cost, as U9b found) 60 fps at 1×, **22.9–27.5 fps at 4×** (median
33.3, worst 183–217 ms). Screenshots `9b/h9b/`: `h9b-tray-moog-1440.png`, `h9b-rack-s55-1440.png`, `h9b-960-playing-1440.png`,
`h9b-rack-s55-fit-playing-1440.png`, `h9b-rack-s55-4x-1440.png`, `h9b-993-routed-1440.png`, `h9b-rack-s55-1366.png`,
`h9b-tray-s35-1440.png`, `h9b-rack-s35-1440.png`, `h9b-rack-s35-1366.png`, `h9b-reloaded-1440.png`, `h9b-rack-48-1440.png`.

**Gates** (one file at a time, 2048 MB, at b171d91): canvas-9b-sim 9 / 9 · canvas-9-sim 22 / 22 · main 46 / 46 · integration 44 / 44 ·
canvas-1i 20 · 2a 26 · 2b 23 · 3 27 · 7a 23 · 7b 15 · 7c 13 · 8 17 · cv-fixes-sim 5 · cv-shell-sim 16 · cv-patch 25 · cv-tray 38 ·
golden-graph 6 / 6 · golden-moog 6 / 6 · golden-moog-b 6 / 6 · canonical-stream 1 / 1 · lint 161 / 161 · pwa 22 / 22 (after
`node tools/precache.mjs --write`: 97 versioned files, `panels/m900b.js` among them; sw.js not committed) · **canvas-sim 23 / 24:
U9b's window** — its Moog-view test pins `tiles.setTiles().length` 0 "until the host passes o.sets (lane H9b)"; with the host's
`sets` it is the two set tiles. Not H9b's file: the one-line extension (`[…, ['s35', 's55']]` by `data-set`, the title naming H9b)
is in `9b/h9b/canvas-sim-window.patch` — applied in the worktree it passes 24 / 24 (reverted, uncommitted).

**For the reviewers / found on the way** (none in H9b's row):
- **A key pressed before ▶'s anchor is forgotten** (sim and Chrome): Play posts its anchor ≈ 60 ms ahead and the Play-from-stop
  reset (P-2, engine.js `ptFresh`) clears the controller's held key at that frame, so "hold a key, then ▶" plays the riff as
  written until the key is struck again; pressed after ▶ it transposes (the tests press after the anchor). The engine's power-on
  restrikes held keys (P-1); its Play-from-stop reset does not — for the lead (E9b's file). **Fixed** (review 1 F1, `Track.ptHeld`: the user's ruling).
- Fit floors at READ_K (I9 review 2 F2): a 2 816-wide System 55 rack is never whole on a 1440 or 1366 window (k 0.5, the top
  row's left part in view) — as designed; the minimap shows the rest.
- The tray's intro is rewritten by the view dropdown (`onView`); `tiles.setView` (a restore) leaves the previous view's words —
  stage 9's behaviour, unchanged.
### Reviews and fixes
#### Fixes (review 1) — fixer R1 (2026-10-22, base 45fe83e on `wt-9b`; `engine.js`, `patch-dsp.js`, `moog-core.js`, `tests/bench.json`, `tests/engine-track.test.mjs`, `tests/patch-dsp.test.mjs`)
- **F1 (major) — a held key carries through Play from a stop** (the user's ruling). `Track.transportHook` (engine.js) calls the new
  `Track.ptHeld(I)` on a cold start, after the Insts' hooks (`ptFresh` has reset the machine and the controller by then): for each
  powered patch Inst (`kind === 'patch'`, machine built, `on === 1`) every key with `holdV[k] > 0` and the Inst's receiver bit in
  `holdR[k]` is struck again with `x.pm.note(holdP[slot · NK + k], holdV[k], 1)` — the pitch the press stored (a graph node's zone and
  transposition as they were then; a key the zone refused has no bit and is never struck; the legacy Track's `i0` is slot 0, bit 1), in
  the same span before the first chunk's `ctl`: GATE and the keyboard pitch from sample 0 of the step. **Decision**: straight into the
  controller, not through `Inst.noteOn` (what `Track.power`'s P-1 restrike calls) — the key never went up, so no Hyper RETRIG of the
  Inst's rack, no new `lastNote` / note count; only the state `Ctl.reset` wiped is put back. Nothing else changes: one machine reset
  (the controller's with it), the 960 on stage 1 with its clock in its start state, RESTART at tick 0, the Song clock "not started";
  a seek and a loop wrap neither reset nor restrike; a powered-off patch keeps P-1's rule (its keys were forgotten at the off; the
  power-on restrikes once); a bounce holds no key (`holdV` all 0), so D7 and golden-moog / golden-moog-b are untouched.
  Tests (engine-track): *9b P-2 × P-3: a key held before ▶ …* — Sequence on the legacy Track, the heard period over stage 1 (370 → 185
  frames at 48 kHz × 4: an octave up) with the key held before ▶, pressed in the anchor's quantum, and posted between ▶ and its
  anchor; the controller after ▶ (`held[72]`, `nh`, `tgt` 1 V, gate), one machine reset and one controller reset, the 960's lamps equal
  to a restart with no key (stage 1 through the step, stage 2 after), one restrike (the press + 1 note-on), a key pressed after the
  anchor unchanged, the release returning stage 2 to its written pitch; *… on a graph node …* — a zone `{lo 40, hi 80, xp 12}`: 48 → 60
  struck, 90 refused and never struck, a later zone change moving no held key, the restrike at 60; a patch powered off at the press
  gets no note through Play and exactly one at its power-on, and one held, powered off, ▶ while off, on again the same. Failed first
  (the controller held nothing after ▶; period 370).
- **F2 (minor) — a momentary event is live only.** `Inst.ptMsg` drops `{pe}` while `this.on !== 1` (engine.js), and `PatchDSP.ev`
  accepts only a module in the latest plan's `recs` (patch-dsp.js; the modules whose `ctl` runs): an unmute starts the sequence at
  stage 1 (the SET pressed while muted is gone), a cord that makes a 960 live no longer applies the SETs pressed while it was not.
  Tests: engine-track *9b events (review 1 F2)* — `evmute.mjs`'s sequence as assertions (SET 6 while off → stage 1 at the power-on;
  SET 4 / SET 7 to the 960 with its rows unpatched → still stage 2 when the cords return; its lamps are not posted while it is not
  live, and an event sent live works); failed first (stage 6, stage 7). patch-dsp.test's two pins of the old behaviour changed with the
  contract (*events*: ev to the module nothing reads → 0, none waiting, and a made-live module hears only its own later event;
  *lamps*: the frozen module's event is dropped, its lamp 0 at its first `ctl`, its live event applied after it).
- **F3 (nit)** — not in this lane (the lead's: §11's CP3A / 921A line, the moved-rows notice).
- **F4 (nit)** — `tests/bench.json`'s `"m9b"` note no longer blames the 26-type family: the reviewer's JSC A/B against tests/ref-9's
  DSP files reads m9p ×1.007, m9x ×1.000, m9d ×1.006, c3 ×1.000, so the +5–8 % over stage 9's record is ambient (another session); the
  iPad pass re-baselines the JSC rows. No test.
- **F5 (nit)** — *Swept band*'s CP3A master 6.5 → 7.5 (+1.24 dB: the CP3A's master is linear, `ms / 5`; moog-core.js). Through the whole
  Track (the reviewer's `headroom.mjs`, 48 kHz × 4, C2 … C7 at velocities 0.8 / 1): −10.8 dBFS at the loudest key, −13.1 at the
  lowest (G5), was −11.8 … −14.2; at the evaluator moog-core.test reads −8.3 (was −9.1); the stage-9 frozen records are untouched
  (a 9b preset).
#### Fixes (review 2) — fixer R2a (2026-10-22, base 7ac99ea on `wt-9b`; `cv-face.js`, `patch-core.js`, `tests/cv-face.test.mjs`, `tests/patch-core.test.mjs`)
- **F2 (major) — a GL face always ends with its SVG hidden.** `sync`'s overlap path turns the 1g tier on and *holds* the quad (mode
  stays `gl`); when the overlap clears before the tier's bitmap decodes, `tierOff` → `faceTier.destroy()` → `drop()` → `vis(false)`
  shows the SVG, and `setMode(F, 'gl')` returned early (mode already `gl`) before its hide line. Fix: `setMode` applies the hide for
  `m === 'gl'` *before* the no-change return (one guarded style write, only when the SVG is not already hidden) — whichever order tier
  changes and rebuilds come in, a face in `gl` ends hidden; no other mode's rule moved (`svg` shows, `dom` leaves the tier the
  visibility, gl → dom with the bitmap shown keeps it hidden), so the 1h / 1i faces of every instrument behave as before. `cv-panel.js`
  untouched (the tier's `drop` showing the SVG is its own contract: it owns the visibility in `dom`). Test (cv-face): *9b fix R2a
  (F2)* — two faces at k 0.5 settled in `gl`, B dropped on A (held: mode `gl`, tier pending), the overlap cleared before any decode:
  both `gl`, tiers gone, both SVGs hidden (failed first: `visible`); a late decode of the dead tiers shows nothing; the same through a
  shown bitmap; the invariant "no `gl` face with a visible SVG". Headless Chrome 155 (the reviewer's `s9b-m15` / `s9-overlap`
  scripts on the fixed tree; scratch `9b/fr2a/`): System 55 over a Model 15 **0** faces with a visible SVG under `gl` (was 5), its
  undo **0** (8), System 35 over the System 55 **0** (19), that undo **0** (31); no console output; S0 unchanged (4 954 / 5 184 /
  4 710 — F6's unit).
- **F5 (minor, the lead's decision) — two connections of one source to one input are one.** `busScan` (the one resolver behind
  `payload`, `busRows`, `busInfo`, `live`, `liveNodes`) keeps a map (source module · jack → input module · jack) of every valid cord
  (first) and of each row taken; a row whose pair is held is **skipped and not counted against the 256-bound**, the earlier holder
  keeping its gain (a cord first — cords precede rows — then panels by number, then row). Cords are not merged with each other
  (stage 9's payload is byte for byte; vals absent → no rows, unchanged). The skipped row's reason reads in the switch's tip:
  *Already patched by a cord* / *Already routed by 993 1* (the first panel's type and ordinal) / *Already routed by another row of
  this panel*. A copy's own rear terminal is its own wire (a duplicated 992's EXT row, a CP4A's TRIGGER (REAR)): still a connection.
  Consequences (by the rule): the copy's selection outline (`members`) names only the modules its connecting rows reach (a fully
  merged copy outlines none); deleting the first panel lets the copy's rows connect (it is the first holder then). Tests
  (patch-core): *R2a F5* — a lit 993 (`f1 t1 e1`; all seven) and a lit 992 (`s1`; `s1`–`s3`) duplicated: `payload` cords equal the
  original's (only the mods list gains the copy), the same rows, `live` equal, no repeated 5-tuple, the copy's tips *Already routed
  by …* and the first's rows still connections (failed first: the cords doubled); a switch closing a cord's own pair (cord gain 2.5):
  the payload and `pk` equal the cord-only record, the cord's gain kept, `busInfo` *Already patched by a cord*; another pair of the
  panel still connects; the copy's rear wires its own. The bound's test (skeptic #33) is rewritten for the rule — its premise, 20
  993s with identical rows each counting, is now one connection: 44 CP4As (the shared six rows once + 4 own-rear rows a panel = 182)
  after 128 hand-built distinct cords → 128 rows, 256 connections, every pair distinct, the last row m35's sixth (its rows 3 and 5 connect), the
  later panels' rows *Already routed by CP4A 1* or the bound's reason, none into a normalled input. **golden-moog-b**: no 9b preset
  (13 presets × the three sets, 156 loads over a fresh patch and each set) carries a repeated pair — every payload byte-identical to the
  pre-fix code — so its recorded refs are unchanged; golden-moog (ref-9) and the stage-9 frozen-record pin pass untouched. Real app
  (Chrome, `s20-dup`): *Routed* + Duplicate 993 1 → 13 connections before and after (was 13 → 17), a lit 992 duplicated 14 → 14
  (was 15), the held key's level inside the run-to-run spread (rms 0.067–0.077 both ways; the +6.9 dB is gone).

#### Fixes (review 2) — fixer R2b (2026-10-22, base 7ac99ea on `wt-9b`; `main.js`, `cv-patch.js`, `cv-tray.js`, `tests/canvas-9b-sim.test.mjs`, `tests/cv-patch.test.mjs`, `tests/cv-tray.test.mjs`; scratch `9b/fr2b/`)
- **F1 (major) — a preset / a set starts the 960's clock per its CLOCK AT START.** The machine reads `os` only when it is built or reset
  (`moog-dsp.js:1141`), never at a preset, so *Step bass* over a System 55 was silent on a held key and *Sequence* over it free-ran before
  ▶. Fix in the host, not the DSP: `cv-patch.js` `SEQ_START = { 960: { p: 'os', on: 'on', off: 'off' } }` (a sequencer type's fresh-state
  select and the `ev` ids that start / stop its clock — a table entry beside `SET_NOTES`, in cv-patch because the lead scoped the fix to
  the host / cv-patch; a family table key would be the generic home) and the pure `seqStart(fam, rec, vals, mid)` → `'on'` | `'off'` |
  null. `preset()` passes the bound roles whose type has an entry as `r.seq` (the step's sequencers, mid order); `commit` → `ptEdit`
  (`main.js`) writes them into the step's meta (`{ pt: 1, trackId, dev, f, seq }` — also when the step wrote no knob) and, after the
  knobs and the graph are posted, `ptStart` posts `ptEv(mid, 'on' | 'off')` for each (`PATCH.starts(t, dev, mids)`: `[[mid, id]]` from the
  record and knobs as they are now): `{t: 'seq', s: { pe: [n, 0 | 1] }}` — after the graph, so the module is in the plan (R1's F2 rule).
  `applyRestore` does the same after an undo / redo's knobs (`ptBackApply`) and graph (the step's `seq` through `ptBack.mv`), so the clock
  follows the restored `os`. A set tile over a Model 15 (it adds the 960) starts it too; a Replace / + Track builds a fresh machine
  (`os` read at construction) and needs nothing; a preset that binds no 960 posts none; Init patch is not a preset (its cords are out, the
  960 not live). **Said**: OSC OFF stops the clock, it does not rewind — a *Sequence* loaded over a running 960 holds the stage it was on
  until ▶ (the Play-from-stop reset puts stage 1). A graph post held back for assets (`N.waitP`) leaves the event ahead of its graph (the
  engine drops an event to a module not yet in its plan): only a track with an FX needing assets, not seen. Tests (failed first): canvas-9b-sim
  *review 2 F1* — Step bass: `['pg', 'pe n,0']`, the OSC lamp lit with no transport (the peak alone cannot tell: the stopped 960's DC row
  step through the 902 thumps at 0.14, the running clock sounds at 0.24), Sequence: `['pg', 'pe n,1']`, the lamp dark, one stage held;
  undo → OSC ON again and sounding, redo → OFF; Classic bass: no `pe`; the System 55 tile over a Model 15 → `['pg', 'pe n,1']` for the new
  960. cv-patch *(review 2 F1)*: `r.seq`, `starts()`, `seqStart` pure. Real Chrome (`m5-f1.mjs`, 1440 × 900): Step bass from Patches… on the
  System 55 tile — OSC lamp `lo`, level 0.114 (was 0.0001, reviewer 2's s22); Sequence over it: `l1` held; undo: `lo,l4` running, 0.153;
  redo: `l7` held.
- **F4 (minor) — a step that moves a routing panel's rows says so.** `cv-patch.js` `routeMoves(C, rec2, vals2)`: `PT.busRows` before and
  after per (panel, row) for the panels present in both (a panel the step makes or deletes carries its own rows): a row that resolves to
  other ends or newly resolves → "now reaches <the modules the ends moved onto>"; a row that vanished → "no longer reaches <its end that
  no longer resolves>" (`PT.busInfo`'s null end), minus what the panel reaches anyway; modules by their titles **before** the step (a new
  module by its own) — so the 993 over the System 55's five 911s reads "the 993's routing now reaches 911 2, 911 3" (the screen shows "911
  1, 911 2" again: the titles renumber, which is the point); the panel as "the 993's" when it is the only one of its type, else its title
  ("CP3A 3's"); ≤ 3 modules a panel, ≤ 2 panels. Delete: "Deleted 911 1 · the 993's routing now reaches 911 2, 911 3 · tap to undo" (8 s);
  **add** and **duplicate** (which had no notice) say it the same way only when a row moved ("Added 921A 3 · CP3A 3's routing now reaches
  921A 3 · tap to undo": a 921A goes before the 921s in `921a|921#=`); nothing extra otherwise (a 911 no lit row reaches, a 921B). Tests
  (cv-patch, failed first): the System 55 with *Routed* (delete 911 1 → the text; 911 4 → today's), ENVELOPE 3 with a third 911 deleted
  ("no longer reaches 911 3"), the CP3A 3 and the 921A add (a 921B: none; a 911 duplicate: none). Real Chrome: the exact text above.
- **F6 (minor) — the heavy-scene line counts what is painted.** `main.js`: `sxPainted(el, skipFaces)` / `sxHeavyCount(skipFaces)` — for the
  900 Series (`k === 'pt'`) a module whose `data-cv-face` is `gl` does not count its `.hw-decor > svg` while that SVG is `visibility:
  hidden` (the texture is free to paint); a face on `dom` (?nogl's 1g tier, an overlap), `svg` (the base pending), or a `gl` face whose
  SVG shows (the F2 state) counts it; the Serum's S0 count (SX_HEAVY 1 866, measured on the iPad in the old unit) is untouched
  (`painted()` with no argument). **`PT_HEAVY` = 2 048 = 1.3 × 1 575**, the real System 55's live layer (headless Chrome 155, 1366 × 1024
  touch, 2×, `m1-count.mjs`; reviewer 2's 1 575 reproduced): + 921B 1 679, + 902 1 653, + a second 960 2 176, a full 48-module rack 2 236 with every face a
  texture (3 746 while its 11 added modules are off screen on their SVGs), the System 55 on `?nogl` 4 748 (old unit 4 748: all of it live).
  Notice runs (`m4-notice.mjs`, waiting out the "Replaced …" notice): GL — the System 55, + 921B, + 902 quiet, + a second 960 the notice;
  `?nogl` — the System 55 alone the notice. `ptHeavy().done` and `heavyReset()` (the sim hook) reset `ptHeavyDone` too. Test (canvas-9b-sim,
  failed first): stub module elements at the measured weights (43 live + 85 SVG boxed per module, 40 modules): GL 1 720 / no notice;
  `dom`, `svg`, `gl`-with-the-SVG-visible 5 120 / the notice; + 2 modules 1 806 quiet; a 48-module rack 2 193 / the notice, once.
- **N1 (nit) — the set ghost.** `setCanvasGhost: () => false`: the rack outline stays pinned to the instrument (a Replace in place, 9 % of it
  in the viewport over the default Minimoog) and the tile's own ghost (its art, "+ System 55") now stays with the finger over the canvas as
  well, instead of being hidden for an outline that is not there. The simplest of the two options (no scaling); both go with the drag's end.
  Test (canvas-9b-sim): a real tile drag through `wk.dragSource` (mouse, `document.elementFromPoint` stubbed over `#viewport`): the ghost
  in `#ov`, not `off`, "+ System 55", beside the outline "+ System 55 · replaces Juno-60". Screenshot `shots/n1-set-ghost-over-minimoog.png`.
- **N2 (nit)** — `deps.playing` (`main.js`: `T.playing`): `setNote` returns '' **and does not spend** the once-a-session flag while the song
  plays (the Replace, the + Track and the set-on-a-900-Series paths all ask it): playing → "Replaced Minimoog with 900 Series (System 55) ·
  tap to undo"; the next load with the transport stopped says it. Tests: canvas-9b-sim *review 2 N2* (first in the file: the flag is
  per session), cv-patch.
- **N3 (nit)** — the set tiles' `span.cv-tcost` (`cv-tray.js`, `o.setCost(id)`, re-read by `refreshMoog`, i.e. by `costLabels` after a
  measurement): `main.js` `setCost(id)` = `COSTM.label(COSTM.estimate({ kind: 'synth', model: 'm900', patch, vals }, devFactor()))` over
  `MG.makeSet(id, {})`'s record and knobs — what a tap makes. Reads "~2 %" for the Model 15, System 35 and System 55 alike: `COST.patch` charges
  the live nodes of each starter (Sequence's 15 live modules cost what Classic bass's do; reviewer 2's "≈ 3 ×" was the measured m9s / m9p
  rows, the estimate table's own figures are what the tile shows). The tile's children are now `[art, name, meta, cost, reason]` (the pin
  extended). Tests: cv-tray (the label, `title`, refresh, hidden when none), canvas-9b-sim *review 2 N3* (equal to cv-cost over `makeSet`,
  the ×10 device factor re-read).
- **Not touched** (as briefed): F2 / F5 (cv-face.js / patch-core.js — the other fixer), F3 (fixer R1), N4. No `sw.js`.
### Acceptance

## 13. Review log

### The skeptic review (2026-10-22, against 6b7741e)

Every claim about existing code was read at 6b7741e (its code = 8f6c716's: the contract commit adds this file only); one scratch
measurement (`scratchpad/9b/skeptic/warmcount.mjs`, not committed: engine.js's real `ptWarm` over the real Model 15 `PatchMoog` plus
stand-in rows with §2's jack lists — connections per warm payload) and hand arithmetic (DOM per control from the Model 15's 408, the
914's skirts, the 904B's slope, the transport anchor's lateness); no test was run. **Settled before or during the review** (not
reopened; written into §11's answers): the user's Q1 (the 960's own clock + our Song clock, the System 55 patched to it), Q2 (*Sequence*
on ▶, the one-time notice), Q3 (48 modules); the standing decisions (mono, physics cords with only plug ends interactive, the Moog
modules view, the old Moog Modular untouched, original art with no photograph, always snap, canvas only, every frozen golden
bit-identical). Severity as I9 §13: P1 a contract contradiction or an impossible gate, P2 a gap a builder would trip on, P3 a correction.

**The author's three risks.** (1) **Routing switches as values** hold against the code: the knob policy is the settled one (a flip is
no History step, undo restores cords and keeps switches — every knob since 1c), `applyRestore` already re-posts every 900 Series'
payload after `ptBackApply` (main.js:1461, 1472: #21), ordinals are a fair [C] — but a preset left unbound panels lit (#6), the routes
were invisible even on demand (#25, **P-1**), and the rows-as-cords bounds and normals were unsaid (#33). (2) **The iPad**: the
per-control arithmetic puts the rack at ≈ 1 400 painted (not 1 300) and the 960 at ≈ 225 (on its ≤ 220 line) — still under sx1's 1 866
and the 1 700 gate (#18); the textures re-derive to ≈ 74 MB; what §5 would not have measured is the 960's lamps toggling during a pinch
(#10) and the cold raster of 38 faces (#30). (3) **The 960's timing** is sound where the contract worried (the wrap fold equals the
Track's exact re-anchor, engine.js:4407–4411, and songEvents cuts spans at a wrap and at a pending anchor, so every span split sees the
same `tp` per chunk) and broken where it did not: the first step (#2), a tempo change's late anchor (#3), the count-in (#4), position
after a reset (**P-2**); the rebuild is plausible but every bus flip is the transition case (#22); the one-section 960 loops on its
everyday self-patches (#29). **Frozen goldens**: the existing classes and shared helpers truly need no edit (#35), but **ref-9 never
froze the Model 15 *records***, and golden-moog renders every preset (#1).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **ref-9 does not guard what K9b edits, and golden-moog breaks on the new presets.** Side A swaps only the three DSP files; `moog-core.js` / `patch-core.js` (PRESETS, `model15`, `loadPreset`, `payload`) are the current tree on both sides, so a K9b change to the Model 15 records (`model15 → makeSet`, the preset loader, the payload) changes A and B alike and passes; and the case list renders **every** `MG.PRESETS` entry with `{ ensure: M15 }` and checks the list — the 7 new presets' modules are unknown to ref-9's frozen `moog-dsp.js` (dropped as `'type'` on side A) → A ≠ B: golden-moog fails | tests/golden-moog.test.mjs:1–6 (header), 31–32, 86 (`preset`), 159, 218; patch-dsp.js:175 | **fixed in D1, §7.1, §8.2, §8.3, §8.8**: golden-moog's preset cases fixed to stage 9's six names (the lead, phase 0, on the base: no window; a pin to stage 9's truth); a **frozen-record pin** (K9b): `model15({})`, `makeSet('m15', {})` and the six presets' `payload(rec).pk` + `pvOf(vals)` hashed from the base tree before K9b's first edit; the 9b presets pinned the same way at ref-9b's freeze |
| 2 · P1 | **The first step plays stage 2, and live ≠ bounce.** A fresh 960 sits on stage 1 and the Song clock's first CLOCK edge (the song's first step) shifts it to stage 2 on the downbeat: the riff starts rotated. Whether that edge exists depends on the anchor: Play posts an integer frame, the Track applies it at the first 4-frame span start at or after it, so tick 0 lies 0–3 frames before the patch's first chunk and "each step boundary inside the chunk" misses it three times in four — the bounce (anchored at frame 0) never misses: D7's *Sequence* bounced ≠ live. *Twenty-four steps* shifted the 962 from stage 8's OUT: B played on A's stage 8 | main.js:1520 (`F = Math.round(…)`); engine.js:4395–4399 (`F >= P.frame − 0.5`), 4424–4436 (the Track's late-anchor rule for notes); §3.4 / §2.6 (as written) | **fixed in §2.3, §2.6, §3.4, §8.1, §8.3, §11**: CLOCK is a **level of the song position** (high while t ≥ 0 and frac(t / step) < ½, per OS sample; fresh low) — deterministic whatever the anchor's offset; **a select wins over a shift in the same sample** (960 IN / SET, 962 TRIGGER IN / SET); *Sequence* / *Twenty-four steps* patch **RESTART → 994 B → 960 IN 1** (+ 962 TRIGGER IN 1), the 962 shifted from stage 1's OUT; tests: the first note is stage 1's, bounced and live with anchors 0–3 frames off the grid |
| 3 · P2 | **A tempo change fires RESTART.** The jump detector's ± 1e-6: reanchor posts {F, t(F)} applied at the first span start ≥ F, so up to 4 frames run on the old tempo and the new anchor disagrees with the old expression by up to 4 · \|1/fpt₁ − 1/fpt₀\| ticks (120 → 130 BPM ≈ 0.013) | main.js:1544–1545; engine.js:4395–4399; §3.4 (as written) | **fixed in §3.4, §8.1**: a jump is \|Δt\| > 0.5 tick (a seek moves ≥ 1 tick: main.js:1556 rounds it); ALWAYS's stopped clock (t = F / fpt, as `drClock`, engine.js:2433–2435) jumps at a stopped tempo change and fires RESTART — said |
| 4 · P2 | **A count-in advances the 960.** `play(from, countBars)` anchors at a negative tick; "while the transport plays" the Song clock would pulse through the count-in and bar 1 would start mid-sequence | main.js:1521 | **fixed in §2.3, §3.4, §8.1**: t < 0 → CLOCK, RUN, RESTART low; tick 0 is the start (RESTART) |
| 5 · P2 | **OSC ON / OFF as a stored `os` that "sets the flip-flop when it changes"** cannot restart a clock cleared by stage 9's STOP or the OFF jack while `os` still reads ON (writing ON again is no change); the lit ON button then contradicts a stopped clock | §2.2, §3.4, §4.5 (as written); cv-panel's `buttons` kind is a value (cv-panel.js:69) | **fixed in §1.5, §2.2, §3.4, §4.1, §4.5, §8.1**: OSC ON / OFF are **events** (12 on the 960); `os` = CLOCK AT START, the flip-flop's fresh state; the `lo` lamp shows the flip-flop |
| 6 · P2 | **A preset leaves unbound routing panels lit**: `loadPreset` writes the controller's and the **bound** modules' params only, so a 993 / 992 / CP3A the preset does not bind keeps its switches and adds hidden connections into the preset's modules (993 e1: 911 1 into 902 1's c3) — "a preset is a whole sound" (I9 §12 lane K9) fails; a set tile over a patch likewise | patch-core.js:455–464 | **fixed in §1.4, §8.2, §11**: a preset writes every bus switch in the patch (its value on bound panels, off on the rest), in `back` |
| 7 · P2 | **warmPatch's graphs outgrow the payload**: `ptWarm` feeds every input and sinks every 1/4" output; with the 9b table graph b holds **298** and c **286** connections (a 211) > the evaluator's 256 → `'limit'`, swallowed by the warm port; b's tail is lost — **its two loop cords** (the per-sample path stage 9 warmed) and the **921Bs' sync chain** (integer-like keys enumerate first, the 921Bs last) — a regression of stage 9's warm-up, not only a 9b gap | engine.js:1542–1614 (`ptWarm`), 1565, 1597, 3756 (`WPORT`); patch-dsp.js:82, 201; `9b/skeptic/warmcount.mjs` (stage 9: a 85 / b 110 / c 97) | **fixed in §3.1, §8.3**: warm payloads split ≤ 256 (the types in halves, the loop and sync cords in each); a test asserts every warm payload analyses with no `why` |
| 8 · P1 | **An impossible gate**: the 914's "a band at 0 off (≤ −60 dB at its centre with its neighbours at 0)" — with 12 dB/oct skirts the bands an octave away (two stagger-tuned 2nd-order sections, Q ≈ 2: ≈ −10 dB each at an octave) leak ≈ −14 dB into that centre | §8.1 (as written); §2.2's 12 dB/oct [R VK-55] | **fixed in §8.1**: a band at 0 contributes nothing (every band and section at 0 → silence ≤ −120 dB); a lone band's rejection an octave away measured and recorded |
| 9 · P3 | The 904B's "24 dB/oct ± 1 (two octaves under)": four buffered one-poles are 22.7 dB/oct locally at two octaves (4 × 6.02 / (1 + 1/16)) | §8.1 (as written) | **fixed in §8.1**: measured between three and two octaves under (≈ 23.3, the 904A's form) |
| 10 · P2 | **§5 would not measure the 960 running during a pinch**: lamps are DOM in the transformed world, toggled at the step rate (8 Hz in *Sequence*); `s55w` sways cords with no lamp activity, while §9's hands-on pinches over the running rack | §4.5, §5 (as written); engine.js:4720, 4737 (the monitor) | **fixed in §5, §6**: `s55` / `s55w` toggle the 960's and 962's lamps as *Sequence* does; a decision row (#31): lamp deliveries held while the camera moves, solid fills, the hold rule |
| 11 · P3 | The old-build test runs the **new** `normPatch` / `pruneVals`, where every 9b type is known — it says nothing about a stage-9 build (the claim itself holds by reading: #35) | §1.1, §8.2 (as written) | **fixed in §1.1, §7.1, §8.2**: stage 9's `patch-core.js` / `moog-core.js` copied verbatim into `tests/ref-9-core/` (K9b, from the base) and a 9b record run through them |
| 12 · P2 | **A System 55 tile on a Model 15 900 Series is not a System 55 rack**: `loadSet` adds up to 27 modules "in free slots" (U9's preset path) beside the Model 15's pinned 1 024-wide rows | I9 §12 lane U9 (`preset`: added modules in free slots); patch-core.js:624–636 | **fixed in §1.2, §6, §7.1, §8.6**: a set tile on a 900 Series also Tidies the rack in the same step (undo gives the places back) |
| 13 · P2 | **`freeSlot` ignores the console row**: its lines are −(rows − r) · 512; with a console module present `rackLayout` (as specified) lifts the cabinet rows by 352, so a tapped 921B's line overlaps row 2 along its whole width and lands above the rack | patch-core.js:627–634; §4.4 (as written) | **fixed in §4.4, §8.2**: `freeSlot` takes each row's line from `rackLayout`'s stacking; an empty console row takes no height (Model 15 Tidy / freeSlot unchanged, tests :545–579) |
| 14 · P3 | **§8.8 misses pins**: '914' is "a newer type" at five places, not one; moog-core.test sizes by `id === 'ctl'` and asserts `cost > 0` (the console types; the zero-cost 993 / 994 / CP8A), pins six preset names; moog-dsp.test pins the ten types and loops the presets through `LINE[P.name]`; engine-track's headroom loop takes every preset | tests/patch-core.test.mjs:76–77, 156, 207, 369–371, 562–567; tests/moog-core.test.mjs:118–122, 173; tests/moog-dsp.test.mjs:270–282, 962, 988, 1080; tests/engine-track.test.mjs:2164 | **fixed in §8.8** with owners |
| 15 · P3 | `rear` cross-checked against PatchMoog needs moog-dsp's shared jack-row builder edited (`[id, d, s, sec, norm, ac]` has no slot for it) — against D1's "nothing existing edited" — for a field the evaluator never reads | moog-dsp.js:124–175 | **fixed in §2.7**: `rear` checked moog-core ↔ faces only |
| 16 · P2 | **"994 none"**: a type without a `T` class makes `typeInfo` return null, and `analyse` drops the module as `'type'` with its cords — the 994's multiples would be dead; the same for the 993 / CP8A read as "no class" | patch-dsp.js:112, 175, 194; §3.3 (as written) | **fixed in §2.2, §3.2, §3.3**: 993, 994, CP8A each a class with no slots (no-op `ctl` / `run`) |
| 17 · P3 | An evaluator-side event queue checked before each module's `ctl` puts a branch in the chunk loop of every stage-9 patch; messages arrive between quanta, so the class can hold the event itself | §1.5, §3.2 (as written) | **fixed in D1, §1.5, §3.2**: `pm.ev(n, k)` → the class's `ev(k)` (its own ring), applied at its next `ctl`; the chunk loop untouched |
| 18 · P3 | The DOM arithmetic: the Model 15's 408 painted = ≈ 4.2 per control (56 controls, 97 jack spans, 13 bars) → the 960 ≈ 225 (40 controls, 29 spans, 22 buttons and lamps, bar), the rack ≈ 1 400 — the sum's "960 ≈ 140, CP3A ≈ 40" were low | I9 §12 lane P9 (painted counts); §4.2 (as written) | **fixed in §4.2, §8.5**: ≈ 1 400 (gate ≤ 1 700 kept); the 960 ≤ 240, confirmed by S9b's real-count scene |
| 19 · P3 | **"Hold a key to transpose"** (Q2's words): the controller's pitch moves only while a key is held and stays at release (`tgt` latches; reset → 0 V), so the riff stays transposed after the key is let go and returns to C at the next Play from a stop | moog-dsp.js:750 (`if (k >= 0) this.tgt = …`), Ctl.reset | **P-3**; §2.6 / §11 say "a key transposes" until the lead decides |
| 20 · P3 | m9s's "five 911s routed by the 993" — the 993 routes three (t1…t3, e1…e3) | §2.4 | **fixed in §3.7**: three by the 993, two by cords |
| 21 · P3 | §6's applyRestore row is already true: `ptBackApply` runs before the loop that posts every 900 Series' payload | main.js:1461, 1472 | **fixed in §6, §8.6**: "nothing to add" + a test |
| 22 · P3 | §3.8's fallback ("a value-only bus flip … leaves the order"): a flip adds an edge and may change the live set or close a loop; and every flip into a live input builds a transition (its ramp), so the measured max is the typical flip | patch-dsp.js header (transitions), 266–336 (`order`) | **fixed in §3.8**: the fast path only when both nodes are live, the order already right and no component changes |
| 23 · P3 | D7's "live = bounce" holds for a live anchor on the 4-frame grid only; off-grid, edges shift by 0–3 frames exactly as every instrument's roll notes | engine.js:4424–4436 | **fixed in §3.4, §8.3** |
| 24 · P3 | The warm-up never plays the Song clock's SONG branch: warmPatch's rounds run with the stopped `tp` | engine.js:3753–3784; 3601 (the drums' playing `ck`) | **fixed in §3.1**: one round under a playing anchor with a wrap |
| 25 · P3 | The bus rows were invisible even on demand; the ordinal binding (a delete moves the routing) shows only in titles | cv-patch.js:582–586 (`members`: a 921A's 921Bs) | **fixed in §1.4, §6, §7.1, §8.6, §11**: selecting a routing panel outlines what its lit rows reach; more → **P-1** |
| 26 · P3 | Lane gaps: no owner for golden-moog.test.mjs (#1) or golden-harness.mjs; RM written by V9c (§7.1) and by the lead (§10) | §7.1, §10 (as written) | **fixed in §7.1**: E9b owns both; V9c RM §9 / §10, the lead §2.2 / §3 / §8 |
| 27 · P3 | E9b's two goals pull apart: more warm rounds to reach the optimising tier vs the warm-up time ≤ 1.15 × | §3.1, §8.3 (as written) | **fixed in §3.1**: the time cap wins; E9b reports what tiers |
| 28 · P3 | *Step bass* plays one pitch above ≈ A4: the clock clamps at 1 kHz (a 125 Hz fundamental), and at RANGE 410 Hz, VERNIER 2 it is 541 Hz at 0 V | §2.3 (the clock law), §2.6 (as written) | **fixed in §2.6**: VERNIER tuned for ≈ two octaves of keys from C3, the range said and tested |
| 29 · P3 | The 960 patched into itself (OUT k → IN 1, OUT → OSC OFF — its everyday patches) is a one-member loop step run per sample; neither costed nor tested | I9 §3.3; §3.4 / §3.7 (as written) | **fixed in §3.4, §8.1**: ≤ 0.004 measured; a case; the one-sample stage said in §11 |
| 30 · P3 | The System 55 tile puts 38 faces through the raster queue (one job a frame; the 960 ≈ 1 728 × 1 024 device px) — the cold load's length and worst frame on the iPad are unmeasured | IMPL-1h (cv-face's queue) | **fixed in §5**: scene `s55c` |
| 31 · P3 | The decision table had no row for `s55` passing and `s55w` failing | §5 (as written) | **fixed in §5** (with #10) |
| 32 · P3 | *Sequence*'s "S-TRIG OUT 1" names no module (the controller's S-TRIG is `ks1`; the cord is the 961's) | §2.6 (as written) | **fixed in §2.6**: the 961's `s1` |
| 33 · P3 | Rows-as-cords: (a) unbounded — cords + rows past 256 make the evaluator drop connections in payload order, cords included; (b) a row into a normalled input marks the slot plugged and breaks its normal (the rear bus does not) — no 9b row does, nothing pinned it | patch-dsp.js:82, 201, 203 | **fixed in §1.4, §8.2**: cords + rows ≤ 256 (the rest skipped, with a tip); a test: no row ends on a normalled input |
| 34 · P3 | moog-dsp learns the evaluator's zero buffer only from a whole `ins` of ≥ 2 slots; the 9b classes that test "patched" all have ≥ 2 — unsaid | moog-dsp.js:193–196 | **fixed in §3.3** |
| P-1 · proposal | **How visible are the routing switches' connections?** (risk 1: hidden connections on an instrument whose identity is visible cords.) (a) As fixed now: a lit switch, its tip, and the routed modules outlined while the panel is selected (#25). (b) Also draw the live rows as faint rear-wiring lines (not cords: no plugs, no touches) while a routing panel or a routed module is selected. (c) The routing panels drawn only, "not emulated" (as the trunks), the sets patched with cords. The review recommends **(a)** — honest, cheap, faithful to the panels; (b) later if the user asks | §1.4, D9; cv-patch.js:582–586 | **for the lead** |
| P-2 · proposal | **Keeping a sequence in step with the song after a reset** (risk 3): RESTART comes only at a start, a wrap and a seek, so after an unmute (P-1 powers the patch off), a panic, a seek, Play from mid-song or a loop that is not a whole number of cycles, the 960 restarts at stage 1 wherever the song is — out of phase with the bars, while the drum machines follow the song position. (a) As contracted; said in §11. (b) A **LENGTH** switch on our Song clock [OFF 2 … 32 steps]: RESTART also fires at every step index ≡ 0 (mod N) counted from tick 0, so RESTART → 960 IN 1 keeps the sequence locked to the song position (a reset realigns at the next cycle); *Sequence* 8, *Twenty-four steps* 24 (the 962 reset with it). (c) A muted song-clocked patch keeps running (exempt from P-1's power-off) — in step, but its CPU while muted. The review recommends **(b)**: ours, deterministic, free | §3.4, §2.6; I9 §13 P-1 | **for the lead** |
| P-3 · proposal | **"Hold a key to transpose"** (#19; the user approved those words). (a) Keep the controller's latch, as the original keyboard: a key transposes and it stays until the next key, ▶ from a stop starts at C; the notice and §11 say so. (b) *Sequence* gates the keyboard pitch through a spare 902 (GATE → `c1`, FIXED CONTROL VOLTAGE −2 V, LIN: g = (−2 + 5) / 3 = 1 exactly while a key is held, 0 when released) so the riff transposes while held and returns at release — the approved words, one 902 and two cords, a classic VCA-as-gate patch (SINGLE triggering: GATE never dips mid-hold). The review recommends **(b)**: it delivers what the user approved; (a) only changes the text | moog-dsp.js:750 (`tgt`), Ctl `kg` = 5 · s, :682 (M902 LIN, `V · T3`) | **for the lead** |
| 35 · fine | Checked and fine: **D1 by construction** — the new types need **no shared-helper edit**: `ex2` / `tanp` / `tr` / `rail` / `knee` / `psin` / `seedOf` / `osOf` / `cl` are pure reads (moog-dsp.js:62–92), `base(m, h, t)` reads `IO[t]` / `PS[t]` rows that are appended (:183–191), and the `insAcc` loop, `T` and the export only gain lines (:799–808) — `rear` aside (#15); engine.js's additions sit behind `s.pe` / `kind === 'patch'` / `pm !== null`, the lamps in the graphed monitor's per-Inst message (engine.js:4737); **the schema-12 claim** (stage 9's `TYPE_RE` takes `cp35` / `clk`, patch-core.js:54; an unknown type's cords kept by port shape, :96, :143–149; `pruneVals` keeps its numbers, :176; `payload` leaves it out, :503; cv-patch sizes it 1 MU and draws "needs a newer version", cv-patch.js:454, 621–624); **the Song clock's `tp`** (shared by reference, engine.js:1653, graph nodes included; a wrap re-anchored at its exact frame, :4409–4411; spans cut at a wrap and at a pending anchor, so every span split sees the same `tp` per chunk); bounds (MAXM 64 ≥ 49; the 960's 16 outputs ≤ 30; CP35's 6 sections ≤ 16); sizes (4 MU 448, 8 MU 864, console 352 = moog-core `sizeOf`); counts (37; over a Model 15 + 27 = 39, over a System 35 + 19 = 41); *Sequence*'s dials (0.4167 a semitone); m9q ≈ 0.021 / m9s ≈ 0.041 re-derived from I9 §12 lane V9b's measured per-type costs; ≈ 74 MB of textures from 1.29 MB a 1 MU face and 5.75 MB the 8 MU console; the Model 15's Tidy (its rows keep their relative order; :545–568 hold at ≤ 16 modules); moog-core.test:130 compares ROWS and ORDER **sorted** (Tidy order ≠ tray order is fine) | as cited | — |

**The lead's decisions on the skeptic's proposals (2026-10-22):** P-1 — **(a)** a lit switch, its tip, and the routed modules
outlined while the panel is selected (as applied; no rear-wiring lines). P-2 — **(b)** a LENGTH switch on our Song clock that also
fires RESTART every N steps counted from tick 0, so RESTART → IN 1 keeps a sequence locked to the song position after an unmute, panic,
seek, mid-song Play or an odd loop length (*Sequence* 8, *Twenty-four steps* 24). P-3 — **(b)** *Sequence* routes the keyboard pitch
through a spare 902 (GATE → `c1`, fixed −2 V, LIN: gain 1 while a key is held, 0 released) so "hold a key to transpose" is literally
true. Skeptic #1's phase-0 step done by the lead on the base: golden-moog's cases and checks are pinned to stage 9's nine types and six
presets by name (`S9_TYPES` / `S9_PRESETS`), golden-moog 6 / 6 at this commit. Phase 0 (A2 ∥ S9b) starts now on the holding branch
`wt-9b`, base this commit.

**The user, 2026-10-22 (process):** "i dont want to have to keep doing these ipad tests … we should test after were done adding
feature" — the phase-0 iPad session (`?m9=1&s55=1` → `"ui-m9b"`) is **deferred** to one consolidated real-device pass after the feature
work (with the performance presets). Gates meanwhile: the Mac's `"ui-m9b-mac"` (incl. 4× / 6× CPU throttling: every s55 scene P+ at 4×,
P at 6×) and the real faces' counts (P9b: the System 55 rack 1 521 painted without the face pictures ≤ 1 700; the 960 181) — §5's
decision table applies as "m13 / m13w-class P+ on the Mac at 4×". **U9b starts now** without waiting for a session.

**The user, 2026-10-22:** "the held key should carry through Play" — Play from a stop resets the patch (P-2) **but keeps the keys held
at that moment**: hold a key, press ▶ → *Sequence* plays transposed from its first step (a bounce has no held keys; D7 unaffected).

### Acceptance (the lead, 2026-10-22)

Phase 3 done on `wt-9b`: reviewer 1 (real engine: 0 blocker, 1 major (a held key across ▶ — the user's ruling), 1 minor, 3 nits) and
reviewer 2 (headless Chrome: 0 blocker, 2 major, 4 minor, 4 nits) — every finding fixed failing-test first by fixers R1 / R2a / R2b
(review 1's F3: routing moves named in the step's notice; N4 — the System 55 tile's one long frame at 4× / 6× CPU and a cord drop at 6× —
handed to the performance-presets stage, ROADMAP 14). The listening renders went to the user ("those are sounding good to me but i
have no point of reference"; drum-feedback rule: build on RM's targets). **One sweep**: 113 files, 3 397 tests, all pass. **`tests/ref-9b`
frozen at 9c3d323** (golden-moog-b's PIN) beside ref-9 (golden-moog, pinned to stage 9's types and presets) and ref-p1 / 1c / 7a–7d. No
iPad session (the user's process decision): gated on the Mac incl. 4× / 6× CPU throttling; the real-device pass comes after the features.
Known gap (fixer R2b): a graph held back for assets could leave a preset's OSC event ahead of its graph (the engine drops it) — not seen
on a 900 Series track.
