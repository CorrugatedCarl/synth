# Stage 9: the Moog modular, module by module (IMPL-9) — contract

The user, 2026-10-20: "can we do all the moog modules eventually with realistic patch cables?"; 2026-10-21 (ROADMAP row 9 and the
feedback table's 2026-10-21 rows), settled — this contract designs to them and does not re-ask: **(1)** the **Model 15 set first** —
902 × 2, 904A, 907A, 911 × 2, 921, 921A, 921B × 2, 923, 995 — plus **our own controller / mixer panel** standing in for the CP15 (whose
contents no source documents); System 35 / 55 modules later, so adding a module must be a table entry + its DSP + its panel; **(2)**
**mono**, like the original (a per-voice option is a later stage: leave room, don't build it); **(3)** **a new category in the Sources
dropdown** for the Moog modules, each module a tile; **today's Moog Modular stays where it is**, unchanged (model, presets, panel and
every golden that pins it); **(4)** **patch cords with simple jiggly physics** — the cord lab's **Studio** preset — **only** on
instruments patched with cords in real life (this Moog set now; the ARP 2600 and the MS-20's patch panel later on the same engine; a
custom synth of ours much later); **the app's existing mod / note / audio cables stay exactly as they are**; so the patch engine and the
cord layer are generic; **(5)** original art only.

Design inputs, cited as: **MM §n** [map-modular-engine.md](map-modular-engine.md) (today's Modular, where a patch graph lives, goldens);
**MC §n** [map-cords.md](map-cords.md) (cables, jacks, the iPad DOM budget, the cord plan); **RM §n**
[research-moog-modules.md](research-moog-modules.md) (the modules, conventions, targets, conflicts); **LAB** [ref/cord-lab.html](ref/cord-lab.html)
(the approved feel: its `PRESETS.studio`, `Cord.step`, `frame`, `shown`, `drawPlug` — LAB:132–137, 168–204, 286–307, 253–259, 278–284);
[IMPL-8.md](IMPL-8.md) (the model contract), [IMPL-7a.md](IMPL-7a.md) (a new instrument family end to end), [IMPL-3.md](IMPL-3.md) (parts of
one instrument as canvas modules; S0), [IMPL-1h.md](IMPL-1h.md) (GL faces), [IMPL-1i.md](IMPL-1i.md) §4.3 (two fingers), [IMPL-panels.md](IMPL-panels.md)
(the layout format). ROADMAP and its feedback rows win where they differ. **Code references are to `canvas` at 5ca17ce** (its code is
8aab46f's, the maps' tree; lines drift, names do not). §0 what exists; §1 data; §2 the modules; §3 the engine; §4 the canvas; §5 the
phase-0 spikes; §6 host wiring; §7 lanes; §8 tests and gates; §9 bench and the iPad; §10 docs; §11 questions; §12 notes (builders); §13
review log.

**Every number is tagged**: **[R]** research (its RM section or source code; an engine fact cited by file:line), **[R?]** secondary or
conflicting (RM §8's "what we used"; the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never
an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical**: every golden shard (`golden-classic`, `-fx`, `-presets`, `-random`, `-graph`), `canonical-stream`,
  `golden-drums` (ref-7a), `golden-606` (ref-7b), `golden-909` (ref-7c), `golden-sdsv` (ref-7d), the dr-* tests, all against their
  frozen refs, untouched, their `PIN`s unchanged. **Today's Moog Modular is not edited**: `models.js` `modular` (models.js:49–92), its four
  presets, `panels/modular.js`, its `FLOW_W` and every size pin stay byte-identical; it keeps rendering through `AVoice` and engine.js's
  untouched `Ladder` / `Env` / `HP4` (engine.js:77–98, 110–160, 330–355). `engine.js` gains branches reached only by `kind === 'patch'`
  and fields declared in `Inst.init`; `AVoice` / `FVoice` / `Divide` / Serum / drum code is not in the diff.
- **D2 New sound frozen**: the patch engine is pinned at the acceptance commit by **`tests/ref-9/`** (verbatim `patch-dsp.js`,
  `moog-dsp.js`, `engine.js` + `MANIFEST.json`, ref-7d's mechanism, tests/golden-sdsv.test.mjs:1–40) rendered by a new
  **`tests/golden-moog.test.mjs`**; from then on ref-7a…7d and ref-9 each guard their family.
- **D3 One instrument per track, one output**: a patch is the track's instrument — the device `iN` of model **`m900`** ("900 Series",
  family `'patch'`); its sound leaves through the controller's **MAIN OUT** input into the track's FX panel → OUT (the derived read-only
  audio cable, as every instrument since 1f). Several patches in a project = several tracks.
- **D4 Original content**: no Moog panel art, logo, wordmark, manual prose or schematic; module **numbers and function names are facts**
  (RM header); faces in our own drawing of the house style (`panels/modular.js` is the treatment); our own starting patches; the
  controller is ours and says so; no maker word on any face (cv-panel `MAKERS`, cv-panel.js:58).
- **D5 Generic engine and cord layer**: `patch-core.js`, `patch-dsp.js`, `cv-patch.js` and `cv-cords.js` hold **no Moog name, number or
  constant**: a family = a module table (`moog-core.js`) + its DSP classes (`moog-dsp.js`) + its faces (`panels/m900.js`); adding a module
  type = §2.6's checklist, nothing else. The ARP 2600 / MS-20 (later) add their own table, DSP script and faces.
- **D6 Mono**: one note at a time, the voice logic in the controller module only (§3.5); every module's state is per instance (an
  object), so a later per-voice stage instantiates module sets — nothing of it built now.
- **D7 Determinism**: a patch renders as a function of the absolute frame clock, the graph payload, the values and the salt; control work
  per absolute 4-base-frame chunk (span invariance, the drum family's rule, IMPL-7a §2.1); offline bounce = live.
- **D8 Budgets**: §3.8's rows (V8, JSC, iPad); no allocation in a render path (a graph change allocates in the message handler, between
  quanta); the cord layer costs ≈ 0 asleep and allocates its buffer only when cords exist; §4.1's DOM per module.
- **D9 Cords never steal, the old cables never change**: a cord takes no press from a knob, a switch, a bar or a key (the layer is
  `pointer-events: none`; geometric hits only where the DOM beneath is a background); two fingers always win; cv-cables.js keeps its
  shapes, colours, layers and tests — it gains two lines (§4.4: delegating a cord jack's press).

## 0. What exists, and what this stage does with it (read at 5ca17ce)

| piece | where | stage 9 |
|---|---|---|
| today's Moog Modular: one `models.js` entry mapped onto the mono `AVoice` (`mode 'mono'`, `prio 'low'`, legato, glide, 3 osc → HP4 → ladder → VCA, two `Env`s) | models.js:49–92; engine.js:374 (AVoice), 556–852 (render), 1991 (`nv` = 1) | **untouched** (D1); a separate model `m900` beside it |
| the drum family: a new `Inst` kind with its own classic worklet script(s), the machine object kept per Inst, `drOn` / `drFail` / `renderDrums` / `fadeDrums`, a payload routed by its shape through `{t:'seq'}` (`seqMsg`: `s.plan` → drums), a warm-up round, `restore` | engine.js:1613–1623 (fields), 1736 (setOS hook), 1972–1975 (anyActive), 1978–2011 (setPatch), 2199–2224, 2346–2391, 2402–2405, 2482–2486, 2572–2575, 2873–2875, 2981–2997, 3324–3340 | **the template**: kind `'patch'`, a machine `pm` from `globalThis.PatchDSP.create`, its payload `{t:'seq', s:{pg, pk}}` routed by `s.pg` (§3.1) |
| classic DSP scripts: an IIFE publishing a frozen global, failure → null, never a throw; loaded in parallel (no script reads another's global at load) | dr-808.js:56–60; main.js:796–806 (`DSP_FILES`, `Promise.allSettled`); tests/golden-harness.mjs:28–29 (`DSP_V2`); tests/dsp-scope.mjs:36–41 (`DSP_TABLE`) | **two new scripts**: `patch-dsp.js` → `PatchDSP` (generic), `moog-dsp.js` → `PatchMoog` (the family); `PatchDSP.create` looks the family up lazily (§3.2) |
| `Inst`: one monomorphic class for every path; fields declared in `init` so the hidden class never changes; OS = the app's, `decChain` decimation, 64-bit | engine.js:1551–1559, 1560–1684, 1686–1737, 1544–1549 | `pm`, `pmErr`, `pmPend` declared in `init`; the patch runs at `fs = base · OS` and is decimated once (§3.6) |
| `Track.process`: spans on a 4-frame grid inside 128-frame quanta; `Inst.renderSpan`'s 2 s idle skip; `stats` by `Date.now()` | engine.js:4235–4271 (cut at 4264), 2981–2997, 4294 | per-chunk evaluation (§3.3); the idle rule of §3.6; no per-module CPU (1 ms timer) |
| `Ladder` (ZDF transistor ladder, secant linearisation), `Env` (RC with overshoot `ov` 1.3), `HP4` — engine.js scope, not exported | engine.js:110–160, 77–98, 330–355 | **not reused, not edited**: moog-dsp.js re-writes the ladder's method in its own scope with the 904A's control law (IMPL-8's `Ota4` precedent, IMPL-8 §0) — D1 by construction (§3.7) |
| the hardware-panel pipeline: a layout in mm (2 px/mm), `cv-panel.render(root, L, model, api)` (art SVG + live widgets over an `api`), the face registered with cv-face as a GL texture | cv-panel.js:42 (`PX_PER_MM`), 1260 (`render`), 1927 (`FACES.register`); cv-face.js:23 (`FACE_BUDGET_BYTES`), 468 | **every module face rides it**: a layout per module type in `panels/m900.js`, a synthetic module model, a per-instance `api` over `vals.p[mid]` (§4.1) |
| `panels/modular.js`: 80 jacks drawn into the face, all `inert: true` (art); real 921 / 995 / 904A / 902 / 911 / CP3A sections in mm | panels/modular.js:55–76 (921), 121–129 (995), 145–152 (904A), 154–162 (902), 164–176 (911), 178–207 (CP3A), 548–553 (notes) | **untouched**; its mm sections are P9's starting point for the 921 / 995 / 904A / 902 / 911 faces (re-based, our art already) |
| cv-panel's `jack` / `strig` kinds: display only (`KINDS.jack: []`); `inert: 'later'` = a jack at full contrast, art only | cv-panel.js:60–65, 424–427, 1087–1136 | **a live patch jack**: `{kind: 'jack' \| 'strig', port, …}` drawn at full contrast, its position exported by `geometry()` (§4.2) |
| canvas jacks: 16 px DOM dots on edges or inline anchors measured at relayout; hit circle 44 screen px (`calc(44px * var(--ik))`); `port()` pure maths | cv-module.js:454–468, 479–496, 789–793; style.css:1072–1082 | **face jacks** `side: 'face'`: a transparent span at a spec (x, y), hit diameter ≤ the jack pitch (§4.2) |
| one jack hook in the world (`setJackHook`): a press on `[data-cv-jack]` is offered first; a second finger cancels it (`jackStop`) and pinches | cv-world.js:1134–1142, 1123–1133, 1184–1187, 1777–1781; cv-cables.js:941–957, 1216 | cv-cables' `press` delegates a `data-kind="cord"` jack to the host's `o.cordPress` (2 lines, as `isModJack → pressMod`, cv-cables.js:943) |
| cables: two SVG layers in `#world`, sag-free cubics, no plugs, audio under modules | cv-cables.js:190–193, 464–477; SPEC §2.9 | **untouched** (D9); cords are a separate layer (§4.3) |
| the GL layer: one WebGL2 canvas before `#world`, drawn from `write()` every camera frame; context loss → 2D fallback | cv-gl.js:151–180; cv-world.js:508–524, 592–604, 648–666 | **a second WebGL2 canvas after `#world`** for cords, drawn from the same `write()` (§4.3) |
| the S0 iPad envelope: painted DOM drives stutter (sx1 1 866 P+, hw5 2.8 k borderline, p1x 3 176 one frame over, t2 ~6 k fail) | bench.json `ui-m3`; MC §3.1; main.js:6171 (`SX_HEAVY`) | **spike (b)** measures patch scenes; a touch notice past the measured line (§4.7) |
| Serum parts as modules of one instrument: keys `iN/<part>`, `cvDevices` lists them, `host.size(key)` sizes them, internal cables are state | main.js:6510–6512, 5293; song.js:518 (`LAY_KEY`); IMPL-3 §2.1 | **the precedent**: Moog modules are `iN/<mid>` parts of the `m900` device (§1.1) |
| History snapshots the project; undo / redo never revert knob tweaks (`keepDevs` copies the current `vals` / `fx` / `drum` onto the restored device) | song.js:426–431; main.js:1391–1401, 1410 | knob values live in `vals` (kept), topology in `dev.patch` (undone) — §1.5 |
| project format: schema 11, `normDev` (64 devices, `vals` plain data, `drum` by model, 256 wires, `PORT_ID`), `LAY_KEY` ≤ 256 entries, newer schema → read-only | cv-migrate.js:98, 111–139; song.js:518–536, 548–597 | **schema 12**, `dev.patch` normalised by `patch-core.normPatch` (§1.6) |
| Sources views from data (`SRC_VIEWS`: hw, flow, serum, drums, ctl); `CLASSIC = !m.custom && m.family !== 'drums'`; a Modulators-style tile row of its own (`o.ctls`) | cv-tray.js:345–356, 358; IMPL-8 §1.2 | **a sixth view `moog` "Moog modules"** with its own tile row `o.moog` (§4.6); `CLASSIC` excludes family `'patch'` |
| goldens pinning the Modular: golden-classic's frozen 12-model list; golden-graph's family filter and count | tests/golden-classic.test.mjs:12, 19–26; tests/golden-graph.test.mjs:24, 171 | golden-classic untouched (side A is ref-p1's list); golden-graph's filter becomes `!m.custom && !m.family` — the same 12 models, the count at :171 unchanged (§3.7) |
| bench: no modular row; c3 (Minimoog, 1 note, OS 4) = iPad 0.010 | tests/bench.json `ipad`, `ipad2b`; tests/bench.html:142 | new rows `m9p` / `m9x` / `m9d`, `c11` (§3.8) |

**Tests that iterate MODELS or pin a list the new model breaks** (each gets the rule named in §8.9; none is weakened): golden-graph:24
(filter), classic-mod.test:17 (`CLASSIC = !m.custom`), classic-panel.test:94 / 243, cv-mods.test:12 and its counts, cv-mods.js:154
(the class table skips `m.custom`: + family `'patch'`), cv-tray.test:492 (classic list) and 545–598 (the views, the menu labels),
canvas-sim.test (the view menu's labels), cv-art.test:25–80 (`SIL` keys = MODELS ids), cv-cost.test:33–39 (a cost per model),
cv-panel.test (`HW_IDS`, `TARGET`), cv-face.test (face sizes), integration.test:652–658 ("every plain model renders": a patch model needs
its payload), cv-migrate.test (schema pins 11 → 12), tests/golden-harness.mjs:28 and tests/dsp-scope.mjs:36–41 (the DSP lists),
tests/pwa.test (precache: new files).

---------------------------------------------------------------------------------------------------------------------------------

## 1. The data model

### 1.1 One instrument, its modules as parts (decided)

| option | consequence | verdict |
|---|---|---|
| **A. One `synth` device of model `m900` holding a `patch` record; each module a canvas module keyed `iN/<mid>`** (the Serum-parts form) | the engine sees one Inst; prim, zones, power, MIDI, roll, FX panel, OUT, bounce, Replace, toV1 work unchanged; 64-device and 256-wire caps untouched; `cv-graph.validate` untouched (its fan-out / cycle refusals, cv-graph.js:229–237, are the track graph's); lay keys `iN/m3` fit `LAY_KEY` (song.js:518) | **chosen** [C] (MM §5 item 4; MC §5.6) |
| B. Each module a track device (`kind: 'mmod'`) | 64-device cap (song.js:556), `validate` / `order` / `compileGraph` rewrites, every module looks like an Inst to the host (`instIds`), the mod and cost layers | rejected |
| C. Project-level data (the Pads module's form) | a patch is one track's sound (its notes, its FX panel, its bounce): wrong owner | rejected |

### 1.2 The device and its records

- **The model** (`models.js`, lane E9a): `m900` — `name '900 Series'`, `model 'Moog modules, patched'`, `maker 'R.A. Moog'` (a label, as
  `modular`'s; never on a face or tile, D4), `year 1973` [R RM §2.1: Model 15], **`family: 'patch'`**, `custom` falsy, `theme` (the
  Modular's house treatment), `sections` = **the controller's controls only** (§2.4; they are the device's flat `vals` and get the classic
  machinery: the hardware face, MIDI learn, the knob tweak policy), `presets: []` (patch presets are topology: §2.5), `about`, `tag`
  ('Mono · module by module · patch cords · 921 / 921A / 921B oscillators, 904A ladder, 907A filter bank, 911 envelopes, 902
  amplifiers'), `map(P, v, G)` → `{ engine: 'patch', family: 'moog', pv: {…§3.2…}, level: 1, mode: 'mono' }` built **without**
  `base(G)`'s voice fields. `MODELS` appends `m900` **last** (after `sdsv`, models.js:870): every index-based use unchanged.
- **`classicOf(m)`** exported from models.js = `!!m && !m.custom && !m.family` — "a classic keyboard synth". It replaces exactly the
  predicates that read `!m.custom && m.family !== 'drums'` (cv-tray.js:345, main.js:3682, 5678; tests/golden-graph.test.mjs:24,
  tests/cv-tray.test.mjs:492): **unchanged for every existing model**. The plain `!m.custom` sites **keep the drums** (they are classic
  there) and gain `&& m.family !== 'patch'` only where a patch must not go: main.js:349 (the last-values store), 1341 (the mono-chord
  suggestion), cv-mods.js:154, 273, 294, 316, 362, 550 (the class table and the classic descriptors: a patch has no classic modulation,
  §4.8), tests/classic-mod.test.mjs:17, tests/cv-mods.test.mjs:12. The Hardware-only rules learn the patch family beside the drums':
  main.js:1819, 1892, 4847, 5263 (`isPatchDev` / `family === 'patch'` → `'hw'`). Sites that hold for a patch as they are: main.js:1888
  (`hwLayoutOf`: the console layout), 5206 / 5214 (no keys bed: nothing found), cv-migrate.js:391 (its size from the layout) [C]. Sites
  meaning "Serum" (`m.custom` in main.js:138, 181, 215, 465–466, 528, 2054, 5333, 5381, 6002, 6437) are unchanged: `m900` is not custom.
- **The `patch` record** (`dev.patch` of an `m900` device; `patch-core.normPatch(rec, fam)`, a leaf importing the family tables only):
  ```
  patch: { v: 1, f: 'moog',                          family id (the module table)
           nid: 1…4096,                              next module number — monotonic, never reused in this device's life
           mods: { m<n>: { t: '<type>', drv?: 'm<k>', name?: ≤ 24 }, … },   ≤ 48 modules; drv: a 921B's driver (a 921A's id)
           cid: 1…65535,                             next cord number
           cords: [ { id: 'c<n>', a: '<end>', b: '<end>', c: 0–7 }, … ],    ≤ 128 cords; end = '<mid>.<port>' | 'c.<port>'
           name?: ≤ 40 }                             the patch's name (the last preset loaded, or the user's)
  ```
  The controller is module **`c`** (reserved, not in `mods`, never deletable; its canvas module is the device key `iN` itself, as VOICE is
  a Serum's). `a` is the **source** end (an output, or a multiple jack acting as one), `b` the **destination** (an input). Bounds:
  exact shapes, ids `/^m\d{1,4}$/` and `/^c\d{1,5}$/` unique, types known to the family (an unknown type is **kept** as data and renders
  silent — a newer file — with a one-time notice), ends valid for their module's type, every rule of §1.3 (a violating cord is dropped),
  `drv` naming an existing 921A or dropped, unknown fields dropped, idempotent, never throws; anything else → a fresh record (controller
  only) [C].
- **Knob values live in `vals`** (the device's existing store, `plain` data, song.js:563): the controller's flat ids (models.js controls)
  and **`vals.p = { m<n>: { <param>: number } }`** for the modules (positions as the face shows them, §2.3). `map()` reads `v.p`; the
  models.js wrapper fills only the flat controller ids (models.js:871–883). **Orphans** (`vals.p` entries whose module is gone) are kept for
  the session — an undo that brings a module back finds its knobs as they were (§1.5) — and dropped by `normPatch`'s companion
  `pruneVals(vals, patch)` at load only [C].
- Lay: the controller `iN`, each module `iN/m<n>` (≤ 49 entries of the 256, song.js:518); positions only, as every module.

### 1.3 Cords: the rules (`patch-core.canPlug(rec, a, b, fam) → { ok, why, a, b }`, pure)

- **Direction**: from an output to an input; a **multiple** jack (`dir: 'any'`, the controller's two groups of four) takes the direction
  its other end implies (out → it is an input of the group, in → an output); any ↔ any is refused ("Connect a module's output or input to
  a multiple") [C].
- **Plugs** [R RM §1.5–1.6]: 1/4" jacks (`sig: 'v'`: audio, CV and V-triggers — **one signal kind**, the role is a hint) and Cinch-Jones
  S-trigger sockets (`sig: 's'`). **A cord joins two jacks of the same plug** (a different connector: "An S-trigger socket — use the
  controller's trigger converter"); never a refusal by role (audio into a CV input, CV into audio, FM: all legal) [R RM §7].
- **One plug per jack** [C, from RM §1.6: a 1/4" jack holds one plug]: a jack holds at most one cord end; a drop on an occupied jack is
  refused ("This jack has a cord — pull it first"). **Fan-out** is the multiples' job (the controller's two groups of four; the 995's
  normalled chain feeds three outputs from one input) [R RM §3.6]; **summing** is the mixer's and the modules' own three summed control
  inputs [R RM §1.4]. A multiple group with two driven jacks sums them [R RM §3.6, 994].
- **Feedback allowed** (any loop, a module into itself) [C, the user's "any output into any input … feedback"]; the engine breaks it
  with a one-sample delay (§3.3).
- **Limits**: ≤ 48 modules, ≤ 128 cords per patch (≤ the jacks / 2 anyway); a 921A drives ≤ 3 921Bs [R RM §3.1 MS-921A; R? 12, RM §8]; the
  controller is unique; nothing else is unique (three 902s are fine) [C].
- `canPlug` returns the reason the drag shows on a dimmed jack and the "Connect to…" list omits.

### 1.4 Tiles, drops, the first module, several patches

- The Sources view **Moog modules** (§4.6) lists **Model 15** (the `m900` tile: the whole set, pre-patched as *Classic bass*) and one tile
  per module type.
- **A module tile** on a track whose instrument is a `900 Series`: adds the module — tapped: at the next free rack slot (§4.5); dropped:
  where released (one History step "Add 921B"). On any other track (or in the tray's + Track mode): **replaces** the instrument (the 1f rule,
  "Replaced Juno-60 with 900 Series · tap to undo") with a `900 Series` holding **the controller and that module, nothing patched** (Q5) [C].
- **The Model 15 tile**: replaces the instrument with the whole set laid out (§4.5) and the *Classic bass* patch (Q5) [C].
- A classic / drum / Serum tile on a `900 Series` track replaces it as any instrument (the patch, its `vals.p` and its `iN/*` lay entries
  go with the device: one step, tap to undo). Several patches per project = several tracks; a cord never joins two tracks.

### 1.5 Undo granularity (and why the split is safe)

- **One History step** each: add a module, delete a module **with its cords** (Q4), duplicate a module (values, no cords), plug a cord,
  pull a cord, re-patch an end, a cord's colour, a 921B's driver, load a patch preset (with "tap to undo"), Init patch, Tidy, a module move
  (as today). **No step**: a knob or switch on any face (the knob policy: `keepDevs`, main.js:1391–1396), a cord's swing, a pluck.
- **Why it works**: `keepDevs` copies the current `vals` onto the restored device and leaves `patch` to the snapshot (main.js:1396 copies
  `vals` / `fx` / `drum` / `seq` only). Undo of "plug" restores the topology and keeps every knob; undo of "delete 904A" restores `mods.m5`,
  its cords and its lay entry, and its knobs are still in `vals.p.m5` (orphans live for the session, §1.2); `nid` is monotonic so an
  orphan's id is never reused by a new module. A cord drag in progress is cancelled first at `applyRestore` (§6).

### 1.6 Schema 12, the file, toV1

- `cv-migrate.SCHEMA = 12`, `STEPS[11]` additive (`p => Object.assign({}, p, { schema: 12 })`), its header line "11 → 12: patchable
  modules (an 'm900' device and its `patch` record; `vals.p`)". A schema-11 build opens a 12 read-only (the gate; without the bump it
  would read `m900` as a Minimoog through `modelById`'s fallback and drop `patch` on autosave — the 7b reasoning, cv-migrate.js:31–36).
- `song.normDev`: `if (isPatchModel(o.model) && d.patch != null) o.patch = normPatch(d.patch, familyOf(o.model))` beside the drum line
  (song.js:573); `patch` on another model's device is dropped.
- **toV1** (Save as classic project): an `m900` track keeps its notes and names the loss: "“<track>”: the 900 Series patch (N modules,
  M cords) — the live site has no patchable modular; its piano-roll notes are kept" (the drum lines' pattern, cv-migrate.js:256).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The modules

### 2.1 Conventions (every module, every cord)

| convention | value | tag |
|---|---|---|
| unit | **volts**, Float64, at the OS rate, on every buffer | [C on R RM §7] |
| pitch | **1 V/oct** on every frequency control input; a module's inputs and its fixed knob **sum** | [R RM §1.4] |
| keyboard reference | 0 V = C4 (MIDI 60); a 921 / 921B at 8′ with its FREQUENCY centred plays C4 at 0 V | [C] |
| rails | every active output **soft-clips into −6 … +12 V** (linear inside −5 … +11, a quadratic knee to the rail); a passive one (995, multiples) does not | [R RM §1.2, T-LVL1; C knee] |
| oscillator levels | 921 / 921B fixed outputs: saw 1.73 Vpp (0.5 V RMS), sine 1.41, triangle 1.13 (−6 dB), rectangle 1.70 (−3 dB vs the 901B's 2.4) — zero-mean | [R RM §1.3 MS-901B; R? EME −6 / −3 dB] |
| envelope | 911: 0 … 5.5 V (Emax) | [R RM §1.3] |
| S-trigger | a **switch to ground**: a Cinch-Jones cord carries a boolean per sample (1 = closed); a receiver acts on closure / opening (the pull-up's voltage is never modelled: a closed line is within 1 V of 0 V by definition) | [R? RM §1.5, §8 "closure starts, opening releases"] |
| V-trigger / gate | a 1/4" voltage: rising through +1.5 V = an edge (hysteresis 0.5 V) | [C on R RM §1.5: ≈ 3 V nominal, 3.6 / 4 V] |
| unpatched input | 0 V, or its **normal** (another jack's signal, a table field: 995 inputs 2 ← 1, 3 ← 2) | [R RM §1.6; C 995 chain, RM §8] |
| loading | ideal buffered outputs (no source impedance, no input loading) | [C] |
| AC coupling | one-pole high-pass 10 Hz on a jack marked `ac` (the 921B's AC MODULATE) | [C on R RM §3.1] |

### 2.2 The catalogue (the Model 15 set; MU = 2⅛ in = 53.975 mm; faces 5U = 222.25 mm tall) [R RM §1.1, §2.2]

Face px = mm × 2 (cv-panel.js:42); module = `ceil32(face w)` × `ceil32(BAR_H 40 + face h)` (the 1b+ rule; the face centred, the margin the
case colour) [C]: **1 MU → 128 × 512**, **2 MU → 224 × 512**, **3 MU → 352 × 512**, the controller (8 MU console, 142.875 mm tall [R RM §1.1
CP format]) → **864 × 352**. Params: `K(id, label, min, max, def)` / `S(id, label, opts, def)` as models.js; ids ≤ 3 chars. Jacks: `id (dir,
sig) LABEL`; `·cv` / `·au` / `·tr` = the role hint (§1.3).

| type | MU | params | jacks | behaviour (§3.4 has the DSP) | tags |
|---|---|---|---|---|---|
| **921** Oscillator | 2 | `sp` SCALE [±12 ST, ±6 OCT] 0 · `cr` COARSE RANGE [SUB-AUDIO, AUDIO] 1 · `fq` FREQUENCY −6…+6 (0) · `rg` RANGE [32′ 16′ 8′ 4′ 2′ 1′] 2 · `pw` RECTANGULAR WIDTH 10…90 (50) · `ax` AUX. OUT WAVEFORM [SINE TRI SAW −SAW RECT −RECT] 2 · `cl` CLAMPING POINT 0…100 (0) · `al` AUX. OUT LEVEL 0…10 (5) | `f1 f2 f3` (in v ·cv) FREQUENCY CONTROL INPUT · `w1 w2` (in v ·cv) WIDTH CONTROL IN · `cv` (in v ·tr) CLAMP TRIG. V · `cs` (in s) CLAMP TRIG. S · `xm xp` (out v) AUXILIARY OUTPUT − / + · `sin tri saw rec` (out v ·au) — **13** | f = 261.63 Hz · 2^(ΣV + knob + range); FREQUENCY spans ±1 oct (`sp` 0) or ±6 oct (`sp` 1); SUB-AUDIO −10 oct; width 1 V = 10 % on top of the knob, clamped 5…95 %; clamp = a hard reset to the CLAMPING POINT phase at an edge of V or a closure of S; AUX = the selected waveform × 0…5 (≈ ±4 V), − inverted | [R panels/modular.js:55–76, RM §3.1 MS-921, VK-15; R? CH-921 SCALE; C SUB-AUDIO depth, width law] |
| **921A** Oscillator driver | 1 | `sp` SCALE [±12 ST, ±6 OCT] 0 · `fq` FREQUENCY −6…+6 (0) · `pw` RECTANGULAR WIDTH 10…90 (50) | `f1 f2 f3` (in v ·cv) · `w1 w2` (in v ·cv) — **5**; no front output: it drives ≤ 3 921Bs over a rear link (`drv`) | sends V_drv = ΣV + knob (1 V/oct outwardly) and the width W to its 921Bs; nothing else | [R RM §3.1 MS-921A, VK-15; R? RM §8 "0.5× gain" → outwardly 1 V/oct] |
| **921B** Oscillator | 1 | `rg` RANGE [LO 32′ 16′ 8′ 4′ 2′] 3 · `fq` FREQUENCY −6…+6 (0) → ±1 oct · `ss` SYNC [WEAK OFF STRONG] 1 | `dc` (in v ·cv) DC MODULATE · `ac` (in v ·cv, AC-coupled) AC MODULATE · `sy` (in v ·au) SYNC IN · `sin tri saw rec` (out v ·au) — **7** | f = 261.63 · 2^(V_drv + range + fq) · max(0, 1 + (V_dc + V_ac)/5) (linear FM, no through-zero: a relaxation core); its **own exponential converter** (a detune is an interval); width from its driver (50 % undriven); LO = 32′ − 4 oct (2 … 8 Hz over the knob, near the bench unit's 2 … 13 Hz); sync = a phase window around the wrap (§3.4) | [R RM §3.1 MS-921B, VK-15, BON; R? lock range, RM §8; C FM depth 5 V = +100 %, the LO offset] |
| **923** Noise + filters | 1 | `lp` LOW PASS 0…10 (5) · `hp` HIGH PASS 0…10 (5) | `wh1 wh2` (out v ·au) WHITE · `pk` (out v ·au) PINK · `li lo` (in / out v) LOW PASS · `hi ho` (in / out v) HIGH PASS — **7** | white 0.5 V RMS (one source, two jacks), pink 0.5 V RMS (1/f); each section a one-pole RC, 10 Hz … 10 kHz on an exponential knob; no CV | [R RM §3.2 VK-15; R? CH-923 ranges and 6 dB/oct; C levels] |
| **904A** Low pass filter | 1 | `fc` FIXED CONTROL VOLTAGE −6…+6 V (0) · `rg` FREQUENCY RANGE [1 2 3] 1 · `re` REGENERATION 0…10 (0) | `in` (in v ·au) SIGNAL INPUT · `c1 c2 c3` (in v ·cv) CONTROL INPUT · `out` (out v) SIGNAL OUTPUT — **5** | f_c = f₀ · 2^(fc + 6 + ΣV), f₀ = 1 / 4 / 16 Hz (ranges 1–5 kHz, 4–20 kHz, 16–80 kHz), clamped ≤ 0.46 · fs; 4-pole transistor ladder, 24 dB/oct; k = 4.4 · re / 10 (whistles above ≈ 9.1); passband gain falls as k rises (no make-up); self-oscillates as a sine at the per-stage corner, 1 V/oct | [R RM §3.3, §4.1 PAT, TIL-P, ROSS, VK-15; C k scale, the 0.46 clamp (IMPL-8 review #26)] |
| **907A** Fixed filter bank | 3 | `lo` LOW · `b1 … b8` the bands · `hi` HIGH — each 0…10 (10) | `in` (in v ·au) · `out` (out v) — **2** | ten parallel sections summed: a low-pass "shelf" at 177 Hz, eight band-passes at 250, 354, 500, 707, 1000, 1414, 2000, 2828 Hz, a high-pass at 4 kHz, 24 dB/oct each; all at 10: flat ± 2 dB, unity gain; pots audio taper (0 = off); no CV | [R RM §3.3 JD-907, MS-907, VK-15; C the √2 centres, the ± 2 dB, the taper] |
| **911** Envelope generator | 1 | `t1` T1 · `t2` T2 · `t3` T3 — each 0…10 → 2 ms … 10 s (exponential) · `es` E SUS 0…10 → 0 … Emax | `trg` (in s) TRIGGER · `out` (out v ·cv) OUTPUT — **2** | closure → T1 from the current level (an RC toward 1.3 · Emax, stops at Emax) → T2 toward E SUS while closed; opening → T3 to 0 from wherever; a closure during T3 restarts T1 from there; output 0 … 5.5 V | [R RM §3.4 JD-911, MS-911, §4.3; R? MF-S polarity, RM §8; C the 1.3 target (engine.js:79 `ov` of the same contour family)] |
| **902** Amplifier | 1 | `md` CONTROL MODE [LIN EXP] 0 · `fc` FIXED CONTROL VOLTAGE −6…+6 V (0) | `i1 i2` (in v ·au) SIGNAL INPUT upper / lower · `o1 o2` (out v) SIGNAL OUTPUT upper / lower · `c1 c2 c3` (in v ·cv) CONTROL INPUT — **7** | V = fc + ΣV; lin g = 2 · clamp(V, 0, 7.5) / 6; exp g = 2 · 4^(min(V, 6) − 6) for V ≥ −2, 0 below; differential: x = i1 − i2; o2 = g·x, o1 = −g·x (upper inverted); per sample (audio-rate AM) | [R RM §3.4 VK-15, MS-902, panels/modular.js:154–162; R? RM §8 "gain of 3" → ×2.5 at 7.5 V; C the −2 V floor] |
| **995** Attenuators | 1 | `a1 a2 a3` 0…10 (0) | `i1 o1 i2 o2 i3 o3` (in / out v) — **6**; `i2` normalled to `i1`, `i3` to `i2` | passive linear pots: o = i · a / 10 (cw = unity) | [R RM §3.6 MS-995, VK-15, panels/modular.js:121–129; C the chain (RM §8)] |
| **Controller** (ours, `c`, §2.4) | 8 (console) | the `m900` controls | **27** | the keyboard, mixer, multiples, converters, MAIN OUT | [C] |

About **97 jacks** in the Model 15 set with the controller [C arithmetic; RM §6 "≈ 70 + the controller"].

### 2.3 Values, display and defaults

- A face shows the hardware legends (FREQUENCY −6…+6, RECTANGULAR WIDTH 10…90, FIXED CONTROL VOLTAGE −6…+6, the 911's 0…10) and the
  stored value **is the dial position** (the dr-808 rule: the DSP holds the laws, one place, testable) [C]. Defaults above make a fresh
  module sound plain: an oscillator at 8′ C4, a closed VCA, an open bank, a filter at its range's middle with no regeneration.

### 2.4 The controller (ours, standing in for the CP15) [C; Q2]

The CP15's contents are undocumented (RM §3.6, §8): an honest stand-in, its face titled **CONTROLLER** with the caption "Ours — stands in
for the Model 15's console panel" (the extras-caption idiom, cv-panel.js:82). Its controls are the `m900` model's (flat `vals`):

| section | controls | jacks |
|---|---|---|
| KEYBOARD (the track's notes: roll, keys tray, MIDI, Pads) | `gl` GLIDE 0…10 (0 = off … 5 s, an exponential slew of the pitch CVs) · `pr` PRIORITY [LOW, LAST] (Q1: LOW) · `rt` TRIGGER [SINGLE, MULTIPLE] (SINGLE: legato, as the original's S-trigger held while any key is down) · `tu` TUNE ±50 cents (0) | `kp1 kp2` (out v) PITCH (1 V/oct, 0 V = C4, + bend: the app's ±2) · `ks1 ks2` (out s) S-TRIG (closed while a key is held; MULTIPLE opens it for one chunk at each new note) · `kg` (out v) GATE (+5 V while held; low for that chunk too) · `kv` (out v) VELOCITY (0…5 V, latched at each note-on) |
| PERFORMANCE | — | `kw` (out v) WHEEL (0…5 V: the track's mod wheel) · `ka` (out v) PRESSURE (0…5 V: aftertouch, the Pencil) |
| MIXER (the CP3A's shape, RM §3.4) | `x1 … x4` LEVEL 0…10 (7) → 0 … ×2 | `m1 … m4` (in v) INPUT · `mo` (out v) MIX + · `mn` (out v) MIX − |
| MULTIPLES | — | `a1 … a4`, `b1 … b4` (any v): two groups of four (§1.3) |
| TRIGGERS (a 961-like stand-in, RM §1.5) | — | `vi` (in v) GATE IN → `vo` (out s) S-TRIG OUT (closed above +2.5 V, 0.5 V hysteresis) · `si` (in s) S-TRIG IN → `so` (out v) GATE OUT (4 V while closed [R RM §1.5 961]) |
| OUTPUT | `ov` OUTPUT 0…10 (7) | `out` (in v) **MAIN OUT** — the patch's sound into the track (unpatched: silence) |

The bottom keyboard tray plays it (no keyboard is drawn on the controller: the CP15 had none and the 953 is a separate case [R RM §2.4]) [C].
No LFO (the oscillators' LO / SUB-AUDIO ranges are the modular's LFOs [R RM §3.1]) and no fixed ±V sources (the 902 / 904A fixed knobs
are voltage sources) [C].

### 2.5 Starting patches (ours; `moog-core.PRESETS`; ⋯ → Patches… on the controller) [C]

Each: a name, the modules it needs (a Model 15 set carries them all), its cords, its knob values; loading one is one History step with "tap
to undo" (it replaces the topology and every `vals` it names; modules it does not use stay, unpatched). **Classic bass** (the Model 15
tile's): kp1 → 921A `f1` (its two 921Bs: 16′ saw, 8′ rect detuned 4 cents); kp2 → multiple A (`a1`), A `a2` → 921 `f1` (32′ saw),
A `a3` → 995 `i1` (`a1` at 5: half keyboard tracking) → `o1` → 904A `c2`; the three outputs → mixer `m1 … m3`, `mo` → 904A `in`, `out`
→ 902 `i1`, `o2` → MAIN OUT; ks1 → 911 #1 → 904A `c1`; ks2 → 911 #2 → 902 `c1` (15 cords). **Filter sweep**: two 921B saws → mixer → 904A (regeneration 7) ← 921 at SUB-AUDIO, triangle (≈ 0.2 Hz) on `c2`; 911 → 902.
**Drone**: three oscillators in fifths, no keyboard, 923 pink → its LP → mixer, mixer → 907A → 902 opened by its fixed knob → MAIN OUT —
the free-running case (§3.6). **Sync lead**: 921B #2 synced STRONG to #1, 911 #1 → 921B #2 `dc` (the sync sweep), 911 #2 → 902. **Wind**:
923 white → 904A (regeneration 8) ← 921 SUB-AUDIO through 995 `a1` on `c1`. **Bells**: two 921B sines at a 1 : 3.5 ratio → 907A (three
bands up) → 902 in EXP with a fast 911. Lane K9 writes them; V9b proves each sounds and stays inside the rails; the listening gate (§7.3)
may retune them before the freeze.

### 2.6 The module table and adding a module (D5)

`moog-core.js` (pure data + tiny pure helpers; no DOM; node-tested) exports `FAMILY = { id: 'moog', model: 'm900', ctl: <controller
type>, types: { '<type>': TYPE }, order: [...tray order], rows: [...Tidy rows], PRESETS }` with
```
TYPE = { id: '921b', name: '921B Oscillator', short: '921B', mu: 1, face: 'module' | 'console', layout: '921b',
         params: [K(…) | S(…)],                                   ≤ 16, the face's live controls
         jacks: [{ id, dir: 'in' | 'out' | 'any', sig: 'v' | 's', role: 'au' | 'cv' | 'tr', label, norm?: '<jack id>', ac?: 1 }],
         link?: { to: '921a', max: 3 },                           a rear-connector link (the 921B's driver)
         group: 'src' | 'mod' | 'ctl', cost: <load at OS 4, measured by V9b> }
```
`patch-core.js` reads only `FAMILIES[f]` (registered by `moog-core.js`'s import in patch-core — the only family import), never a type id.
**Adding a module type** (System 35 / 55 later): (1) a `TYPE` entry; (2) its DSP class in the family's worklet script, registered under
the same id with the same jack order (`tests/moog-core.test.mjs` compares the two tables); (3) its layout in `panels/m900.js` (its `port`s
= the table's jack ids, checked by cv-panel's `validate` and a test); (4) its tile glyph in cv-tray's `MOOG_GLYPH`; (5) its golden cases,
its cost. Nothing in patch-core, patch-dsp, cv-patch, cv-cords, engine.js or main.js changes.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The engine

### 3.1 The Inst kind `'patch'` (engine.js, lane E9)

Every branch below is reached only when `kind === 'patch'` or a payload carries `pg`; every other path keeps its statements (D1).
| site | change |
|---|---|
| `Inst.init` (1613–1684) | `this.pm = null; this.pmErr = 0; this.pmPend = null;` — the machine, its error latch, a graph payload that arrived before the patch kind (as `drPend`) |
| `PatchP` (1397–1430) | `family` (string, default `''`) and `pv` (pass-through, as `drum` / `serum`) |
| `setPatch` (1978–2043) | `nv = 0` for `'patch'` (beside `divide` / `drums`, 1991); a kind change to or from `'patch'`: `allOff(true)` (its tail rendered by `fadePatch`); entering: `ptOn(p)` = `globalThis.PatchDSP.create(this, p.family)` (null → `ptFail()`: `{t: 'ptErr'}` once, the `drFail` pattern, 2220–2224), adopting `pmPend`; then `pm.set(p.pv)` on every patch; no chorus / ensemble (the reset of 2020 learns `was === 'patch'`) |
| `setOS` (1686–1737) | `if (this.pm !== null && this.kind === 'patch') this.pm.setOS(os, this.fs);` beside the drums hook (1736) |
| `setSalt` (1578–1588) | `if (this.pm !== null) this.pm.setSalt(s);` |
| `anyActive` (1972) | `if (this.kind === 'patch') return this.on === 1 && this.pm !== null && this.pm.live();` |
| `noteOn` / `noteOff` (2583 / 2762) | beside the drums line (2599: `lastNote` / `nOn` are already set at 2585, the rack's RETRIG at 2598): `if (this.kind === 'patch') { if (this.pm !== null) this.pm.note(n, v, 1); return; }`; in `noteOff`, beside 2763: `… pm.note(n, 0, 0); return;` — the Track's held-key record runs as for any Inst (zones, transposition, the slot bits, engine.js:3949–4005); a preview (`aud`) plays as a note [C]; the sustain pedal is read per chunk from `inst.sustain` (set at 2547), as `bend` / `wheel` / `at` |
| `seqMsg` (2873) | first line: `if (s && s.pg !== undefined) { this.ptMsg(s); return; }` (a patch payload, routed by its shape; kept in `pmPend` until the kind is `'patch'`) |
| `renderSpan` (2981–2997) | `if (this.kind === 'patch') { this.renderPatch(n); return 1; }` after the drums line; `renderPatch(n)` = renderDrums' frame (2346–2391): tails into the OS-rate `buf`, `pm.render(buf, N, this.T.spanF)`, decimate, `osFade`, `Lb = Rb = mono`, `act`, `rack.setNote(lastNote)` |
| `fadeOut` (2402) / `allOff` (2482) / `panicClear` (2572) | `fadePatch()` (≈ 3 ms raised-cosine tail rendered ahead, as `fadeDrums`) / hard: `pm.reset()` after the tail / `pm.reset()` |
| `restore` (1590–1612) | `if (this.pm !== null) this.pm.reset(); this.pmPend = null;` (the machine kept, its code warm) |
| `Track.warmUp` (3324–3340) | `this.warmPatch(run, io)` after `warmDrums`, before `SD.warmUp` / `warmGraph` (the 2b JSC lesson: the classic re-warm last): a patch with every Moog type, every jack patched, a feedback loop, FM, sync, a clamp, the 907A, notes in both priorities, a graph change mid-note (ramps, a retiring module), an OS change, twice; `restore` after. Without the scripts: nothing |
| `stats` | voices = 1 while `pm.live()` |
No other Track, Chain, graph, ModCore or protocol code changes. The 2b classic adapter (`modRows`, `moRefresh`) never runs for a patch
(no row can name its fields: §4.8).

### 3.2 `patch-dsp.js` → `globalThis.PatchDSP` (generic; lane V9a)

- **`create(inst, family)`** → a machine, or null when `globalThis['Patch' + Family]` (e.g. `PatchMoog`) is missing (looked up at
  create, not at load: the scripts load in parallel, main.js:796–806). The machine:
  `set(pv)` (values, stored by module number; applied to the modules that exist, kept for those that arrive later) ·
  `graph(g)` (a graph payload, below; builds / reuses / retires modules, wires inputs, compiles the schedule — **allocates; called from the
  message handler only**) · `note(n, v, on)` · `setOS(os, fs)` · `render(buf, N, F0)` (adds MAIN OUT × `OUT_K` × the
  OUTPUT knob into the OS-rate `buf`) · `live()` · `reset()` · `setSalt(s)` · `mon()` (a debug snapshot for tests: module ids, schedule,
  ramps).
- **The graph payload** (built by `patch-core.payload(rec, fam)` on the main thread, posted as `{t: 'seq', s: { pg, pk }, i?}`; `pk` its
  content hash, so an unchanged graph is not reposted — the drums' `drPkOf`, main.js:3345):
  ```
  pg = { v: 1, f: 'moog', mods: [[n, 'type', drvN | -1], …] (n: 0 = the controller, k for m<k>; sorted by n),
         cords: [[aN, aPort, bN, bPort], …] (port = the jack's index in its type's table; sorted) }
  ```
  `pv` (in `{t: 'patch'}`) = `{ '<n>': [values in the type's param order] }` from `vals` (the controller's flat ids, `vals.p`), raw dial
  positions. A hostile or partial payload (unknown type, port out of range, a cord breaking §1.3) drops the offending item and posts
  `{t: 'ptErr', why}` once [C].
- **Module state is kept by id** while its type is unchanged (the FXRack rule, fx-dsp.js:13–15); a new module starts fresh (phase 0,
  envelopes 0, filters 0; its noise seeded `0x9E3779B9 ^ salt ^ hash(n)`); a module whose number leaves the graph **retires** (below).

### 3.3 The schedule and the chunk loop

- **Live set**: the modules from which MAIN OUT (`c.out`) is reachable through cords (inputs included: envelopes into a VCA's CV are live);
  every other module is idle — its state frozen, cost 0 (patching it later resumes from its frozen state; deterministic) [C].
- **Order**: Tarjan's strongly-connected components over the live set's cords; the condensation in topological order, ties by module
  number. A component of one module without a self-cord is a **block step**; a component with a cycle (or a self-cord) is a **loop step**:
  its members ordered sources-first (the longest path to MAIN OUT first, ties by number) and **every cord from a member to an earlier or the
  same member is a back-edge, read one sample late** (5.2 µs at 48 kHz × 4, MM §2.5) [C]. `PatchDSP.schedule(g)` is pure and exported
  (tests compare it with hand-made cases and fuzz it: every live module once, every forward edge after its source, back-edges only inside
  loop steps).
- **The chunk** = `CH = 4 · OS` samples, one absolute 4-base-frame chunk (spans start on 4-frame boundaries and are multiples of 4:
  engine.js:4264) [R]. Per chunk: the controller's note state (latched at the span start), then each step: **block** → `m.ctl()` (control-
  rate work: knob glide, coefficients) then `m.run(0, CH)`; **loop** → each member's `ctl()`, then for `i` in `0 … CH − 1`: each member in
  order fills its back-edge inputs (`z[i] = i ? src[i − 1] : src_last`) and runs `run(i, 1)`; after the chunk each back-edge keeps
  `src[CH − 1]`. Knob values glide per chunk (one-pole, 6 ms, the panel's `smStep` constant) toward `set`'s targets [C].
- **Wiring**: every output jack owns a `Float64Array(32)` (CH at OS 8); an input reads its source's buffer directly (one cord), a zero
  buffer (unpatched), its normal's buffer, or a scratch (a multiple's sum, a back-edge's `z`, a ramp). Module `run` loops are
  monomorphic per class; the step dispatch (≈ 13 calls a chunk) is the only megamorphic site [C; spike (a) measures it].
- **Click-free cord changes** [C]: a graph change diffs each input's source set; an input whose source changes **ramps over 2 ms**
  (linear: from the old source — or the normal / 0 V — to the new); a module leaving the graph **retires**: it stays scheduled, its inputs
  as they were, until every ramp that reads it has ended, then it is dropped (the Track's dying-Inst precedent: `dyI`, engine.js:3264–3269, rendered by
  `spanG`). Values snap (no glide) for a module that just arrived. A cord's sound when pulled is therefore a 2 ms fade, never a click.
- **No allocation in `render`**; `graph()` allocates (between quanta, as `graphMsg` / `modsMsg`); `setOS` reallocates (as `Inst.setOS`).

### 3.4 `moog-dsp.js` → `globalThis.PatchMoog` (the family's DSP; lane V9b)

`PatchMoog = { id: 'moog', T: { '<type>': class }, JACKS: {…}, PARAMS: {…} }` (the table copies `moog-core.test` compares); every class
`extends PatchDSP`'s base shape `{ ins, outs, p, t, ctl(), run(i0, n), setOS(fs), reset(), setSalt(s) }`. The circuits, in our code:
- **Exponential converter**: `ex2(v)` = 2^v by `2^⌊v⌋` (a table) × a polynomial of the fraction (error ≤ 0.01 cent over ±20 oct) — no
  `Math.pow` per sample [C].
- **921 / 921B cores**: one phase per oscillator (cycles, Float64) and four outputs from it — polyBLEP saw and rectangle, polyBLAMP
  triangle, a polynomial sine; dt per sample from the instantaneous frequency (exponential and linear FM: the polyBLEP-with-varying-dt
  approximation AVoice uses, engine.js:731, 754); the residuals at OS 4 bound aliases (§8.1) [C]. **Clamp (921)**: at an edge (V) or a
  closure (S), the phase jumps to CLAMPING POINT with a BLEP / BLAMP correction at the edge's sub-sample position (linear interpolation of
  the crossing) [C]. **Sync (921B)**: at the sync input's rising zero crossing (sub-sample position), the phase is reset to 0 — with a
  BLEP — only if it lies inside a window around the wrap ([1 − w₊, 1) ∪ [0, w₋]); STRONG's window captures harmonics 1…6 with ±6 semitones
  at harmonic 1, WEAK a quarter of that reach [R? RM §3.1 BON / ADO lock range; C the window model: V9b sizes w₊ / w₋ to T-OSC4]. **Drift**:
  each oscillator takes the app's analog-drift preference (`G.drift`, as the classics) as a slow seeded random walk; 0 in the goldens.
- **904A**: the transistor ladder's ZDF method (engine.js:110–160's maths re-written in this scope: four stages, the secant
  linearisation, the predictor / second pass) with **per-sample** g from f_c (`tan` by a rational approximation, f_c ≤ 0.46 · fs), no input
  make-up (`comp` 0: the gain loss with k [R RM §4.1]), input scaled so a 1.73 Vpp saw drives the stages lightly (V9b pins the scale and
  records it) [C].
- **902**: the gain law of §2.2 per sample from the summed CV; differential in, two outs.
- **911**: a state machine stepped per sample (the S line read per sample: a closure or an opening acts at its sample), RC segments per
  sample with coefficients per chunk [C].
- **907A**: ten sections, each two cascaded biquads (TPT), prewarped at their centres (OS 4 → 1 keeps every centre, IMPL-7a §2.1), summed
  with the pots' gains [C].
- **923**: xorshift white at the engine's density convention (`nzW = sqrt(fs / 192000)`, engine.js:1711), Kellett pink re-written here,
  two one-pole RC sections [C].
- **995**, **multiples**: sums and products. **Controller**: §3.5.
- **Rails**: every active output through `rail(x)` (§2.1) — the guard that keeps any feedback patch finite (the `fbp` cap's role,
  engine.js:667–672) [C].

### 3.5 The track's notes → the patch (the controller module)

A held-key table (128 flags + order stamps, no allocation); **PRIORITY LOW** (the lowest held key sounds; releasing it falls to the next
lowest; no retrigger in SINGLE) or **LAST** (the most recent; releasing it falls back to the previous held) [R RM §1.4 / §3.5 keyboards;
C LAST]. The pitch CV = (note − 60) / 12 + bend / 12 + TUNE, slewed by GLIDE (an exponential slew toward the target, per sample from a
per-chunk coefficient) [C]; S-TRIG closed while any key (or the sustain pedal) holds; MULTIPLE: open for one chunk at each new note-on
while held (the 911 sees an opening then a closure: T1 from the current level) [C]; GATE likewise; VELOCITY 5 · v V latched at a note-on;
WHEEL 5 · `inst.wheel`, PRESSURE 5 · `inst.at`, read per chunk (the Inst's scalars: declared engine.js:1626, the bend in semitones at 2023) [C]. The mixer, the multiples, the
converters and MAIN OUT are the controller's other parts. Per-voice later: this module is the only one that knows notes (D6).

### 3.6 Rates, idle, power, panic

- **Oversampling** = the track's (the app's, default 4; `osFor`, main.js:89 / 748); `fs = base · OS`; 44.1 and 48 kHz first-class; an OS
  change goes through `reqOS` / `osFade` (engine.js:2396–2400, 2953) with `pm.setOS`. The CPU safeguard's `lowerOS` may halve it (session only,
  the badge): FM aliasing and the feedback delay change with it — said in §4.7's notice text [C].
- **Idle** [C]: a patch **whose MAIN OUT is patched never goes quiet** (`live()` true: a free-running drone, a self-
  oscillating filter behind a closed VCA, an LFO are the hardware's normal state); unpatched MAIN OUT → `live()` false → the 2 s idle skip
  applies (engine.js:2985–2995). Powered off (`on 0`) → not live. Cost: a patched patch costs its full load continuously — the bench rows
  measure exactly that (§3.8).
- **Panic** → `pm.reset()` (silence, held keys cleared); a kind change → the 3 ms tail; `{t: 'bye'}` as any Inst.

### 3.7 Old sound bit-identical — how

- `engine.js`: only §3.1's lines; each is either a new field, a branch whose condition is false for every existing patch (`kind ===
  'patch'`, `s.pg !== undefined`), or a `pm !== null` guard. `Ladder`, `Env`, `HP4`, `AVoice` are not edited (the 904A / 911 are
  re-written in moog-dsp.js) → **ref-p1 and ref-1c** (today's Modular through AVoice) and **ref-7a…7d** (each golden swaps its frozen
  engine.js on side A, golden-sdsv.test.mjs:1–14) stay bit-identical by construction; E9 runs every one of them after each commit.
- **golden-graph**: its filter (tests/golden-graph.test.mjs:24) becomes `!m.custom && !m.family` — the same 12 keyboard classics (the drum
  family and now the patch family have no legacy render: IMPL-7a §12.2's reason); the count at :171 is unchanged. **golden-classic** uses
  side A's frozen list (tests/golden-classic.test.mjs:12, 19): untouched. **canonical-stream**: no `m900` in its fixture: untouched.
- The DSP lists (`DSP_FILES`, `DSP_V2`, `DSP_TABLE`) gain `patch-dsp.js`, `moog-dsp.js` after `mod-core.js`: the scripts only publish
  globals; no existing render reads them.
- **New sound (D2)**: `tests/golden-moog.test.mjs` (ref-7d's form): side A = the current tree with `patch-dsp.js`, `moog-dsp.js`,
  `engine.js` replaced by `tests/ref-9/`'s copies; before the freeze B against itself (determinism), said in a diagnostic. Cases: every
  module type alone at three settings (oscillators at each range and waveform, the 904A at k 0 / 2 / 4.4 with a 1.73 V saw and self-
  oscillating, the 902 both modes, the 911 short / long with legato and MULTIPLE, the 907A at three band settings, the 923's three outputs
  and sections, the 995 chain), each preset with a note line, sync at both strengths, a clamp train, a 3-module feedback loop and a self-
  patched 921B, a graph change mid-note (a ramp, a retiring module), LOW / LAST priority with glide, OS 2, 44.1 kHz × 1; gate `max |A − B|
  === 0`. **D7**: a preset bounced offline (processorOptions) = live, bit for bit; **span invariance**: the same events rendered with spans
  of 4, 128 and random multiples of 4 frames, bit for bit. Freeze: `GOLDEN_FREEZE_9=1 node --max-old-space-size=2048 --test
  tests/golden-moog.test.mjs` by the lead after the listening gate (§7.3), then `PIN`.

### 3.8 CPU: rules and bench rows

- Per module type alone, OS 4, M4 Max node, recorded in §12 by V9b (informational, feeds `cv-cost`): oscillators ≤ 0.0015, 904A ≤ 0.002,
  907A ≤ 0.002, the rest ≤ 0.0005 [C; spike (a) revises].
- Rows (kind `track`, OS 4, 48 kHz, every timed run audible) [C provisional — **spike (a) fixes them before phase 1**; ≈ 2.5–3 × c3 for a
  typical patch, MM §6]:

| row | node | jsc | ipad | what |
|---|---|---|---|---|
| **m9p** | 0.025 | 0.025 | 0.03 | *Classic bass*: an eighth-note bass line at 120 BPM (roll notes), its defaults |
| **m9x** | 0.05 | 0.05 | 0.06 | every Model 15 module live: three oscillators, audio-rate FM into the 904A (k 4.4), a 904A → 921B → 904A loop, sync STRONG, a clamp at audio rate, 923 → 907A, chords on the controller |
| **m9d** | 0.02 | 0.02 | 0.025 | *Drone*, no notes (the never-quiet cost) |
`bench.json` `targets` gain `{ node, ipad }` for them (the jsc column is the lead's A/B); `bench.html`'s classic list adds **c11** (the 900
Series' *Classic bass*, `ipad: null`); `cv-cost` `COST.synth.m900 = C('m9p', 'patch', 1, <measured base>, 0)` and `COST.patch[type]` (the
module costs: tile labels, the track estimate). JSC A/B (the lead): m9p / m9x and, because `Inst` changed, c1, d, e, mc0, mt, d8p, d9p,
dvp within 3 %; V8: every existing row within 2 % (`cpu-gate`).

---------------------------------------------------------------------------------------------------------------------------------

## 4. The canvas

### 4.1 Modules on the canvas

- **Keys and kinds**: the controller = the device module `iN` (kind `'inst'`, model `m900`: the classic hardware path renders its face,
  `renderPanel` → `ClassicPanel` with `panels/m900.js`'s console layout, main.js:2045–2061); each module = `iN/m<n>`, kind **`'pm'`**, listed
  by `cvDevices` (main.js:6504) as `{ key, kind: 'pm', dev: 'iN', mid, type, model: 'm900', title, jacks, fixed }` (the Serum-parts form,
  main.js:6510–6512; the jacks from the entry, IMPL-8 review #4's form).
- **Faces**: `cv-patch.moduleBody(o)` mounts `cv-panel.render(root, layoutOf(type), moduleModel(type), api)` — `moduleModel(type)` a
  synthetic model `{ id: 'pm-<type>', name, theme, sections: [{ c: TYPE.params }], controls }` (memoised), `api` over `vals.p[mid]`
  (`get` / `set` → the knob policy: write, `queuePatch` with the 66 ms drag throttle, no History; `fmt`, `bind`, `doc`, `tip`). So every
  module face is a **GL texture** (cv-panel.js:1927 → cv-face; the 1h path, IMPL-1h §3), the 14 mm hit rule, `validate`, `panel-check`
  all apply. Module knobs carry `data-nomod` (§4.8).
- **Sizes** from §2.2 (`host.size(key)` → `{ fixed: { w, h } }` from the type's MU; main.js:5293's chain). **Bar**: compact for `'pm'`
  modules [C] — the title ("921B 2": type + ordinal by number among its type; a driven 921B's sub "on 921A 1"), ⋯; no ⏻, no CPU slot (not
  measurable per module: MM §2.1), no chip, **no fold** (a face carries its jacks; cv-module `o.nofold`, the controller too).
- **DOM budget** [C, spike (b) confirms]: a 1 MU module ≤ **90 painted elements** (bar ≤ 6, widgets, a span per jack) + its hidden face SVG;
  the controller ≤ 160; the Model 15 set ≤ **1 300 painted** (below sx1's 1 866, the P+ line).

### 4.2 Face jacks

- cv-panel: a layout control `{ kind: 'jack' | 'strig', port: '<jack id>', label, x, y, d | w, h }` (no `id`, no `inert`) is a **live
  patch jack**: drawn into the face at full contrast (the `inert: 'later'` look, cv-panel.js:1087–1136, titled with its label), validated
  (`port` `/^[a-z][a-z0-9]{0,7}$/`, unique in the layout, `d > 0`, every two live jacks' centres ≥ 15 mm apart), and listed by `geometry(L, model).jacks` → `[{ port, x, y, d }]` in
  module-local world px (pure maths) [C].
- cv-module: a jack spec with **`side: 'face'`** and `x, y` → a `span.cv-jack.cv-fjack` placed at (x, y) inside the module (no anchor
  search, no measuring), `data-kind="cord"`, `data-sig`, `data-dir`, `aria-label` ("921B 2 · SAWTOOTH OUT"), `role="button"` with a
  roving tabindex (one tab stop per module); transparent (the face shows the jack), visible only for focus and the drag's halos
  (`.cv-ok` / `.cv-no` / `.cv-from`, style.css:1136–1140); `port()` returns (x, y) [C].
- **Hit size vs zoom**: the hit circle = `clamp(28px, 44px · --ik, var(--jp))` world px — 44 screen px where the module's jack pitch
  allows, never wider than the pitch (`--jp` = the face's smallest centre distance − 2, from `geometry`: ≈ 36 px on a 921's 19.4 mm row,
  panels/modular.js:67–69), never under 14 mm — so neighbouring circles never overlap and a press lands on the jack under it (SPEC §4.5's
  "nearest jack" by construction) [C].
- **Below `READ_K` (0.5)** cord jacks **sleep like controls** (a press pans; double-tap the module to wake it): cv-world `sleeper()` no
  longer returns null for a `[data-kind="cord"]` jack (cv-world.js:1196–1200) — at k 0.3 a 38 px pitch is 11 screen px and a pan across a
  rack would start cords [C]. Other jacks keep today's rule.

### 4.3 The cord layer (`cv-cords.js`, new; lane C9)

- **Where**: a second WebGL2 canvas `.cv-cords` **after `#world` inside `#viewport`** (above every module, under `#overlay` / the
  toolbar / the trays, which are #viewport's siblings: index.html:193–217), `pointer-events: none`, never transformed, no will-change;
  drawn from cv-world's `write()` and `endBurst()` right after `gridAt()` (cv-world.js:592–604, 648–666) with the same camera, device ratio
  and viewport — the grid and faces are drawn in that same callback, the path the user verified as glued mid-pinch (1h verdict) [C; MC §4.3].
  Its drawing buffer is allocated only while the shown track has cords (0 × 0 otherwise); context loss: cv-gl's pattern (cv-gl.js:159–180),
  three in a minute → the SVG fallback.
- **The physics — exactly the Studio preset** [R LAB:132–137, 168–204, 286–307]: per cord **10 points**; **fixed 1/120 s steps**
  (`steps = min(8, ⌊acc / DT⌋)`, a frame's dt capped at 50 ms, `acc` dropped past one step); interior points `v = (p − p_prev) · 0.959`
  (= 0.90 + 0.095 · 0.62), `p += v`, `y += 6000 · DT²`; the ends pinned to the plugs (and a grabbed point to the finger); **5 passes** of
  slack-only distance constraints (`d ≤ seg` → nothing; else the excess split ½ / ½, an end weightless); the length **L eases toward
  1.10 · D + 24 at 5 / s** (`L += (1.10·D + 24 − L) · min(1, DT · 5)` per step); **anchors swept across the frame's steps** (step s of S at
  A₀ + (A₁ − A₀) · (s + 1) / S); asleep after **30 consecutive quiet steps** (max over interior points of |Δx| + |Δy| < 0.02 px) and not
  grabbed; woken by an anchor moving > 0.01 px (Σ|Δ| of both ends) or a grab; **seeded** at creation / load from the parabola of length L
  (sag = √(3 · max(D, 1) · (L − D) / 8), `y += sag · 4t(1 − t)`) and asleep at once. **Motion off** (`prefers-reduced-motion`, cv-world.js:384;
  a pref): the parabola from the ends on every draw (LAB:278–284), no ticker. World px throughout; the camera never enters the sim. Pure,
  exported: `STUDIO` (the constants), `seed`, `step`, `shown`, `smooth` (the quadratic-through-midpoints path of LAB:247–251 as a polyline) —
  node-tested against a reference polyline per (A, B, L).
- **The ticker**: its own rAF only while a cord is awake, a cord is held, or a plug is in flight — never while the canvas view is hidden
  (ROLL) or the page is; it draws with the world's current camera (`world.cam()`); all asleep → no frames (a rAF counter test). [C, spike (c) decides]: if a burst's last frame took > 24 ms, a pinch-time
  step is skipped (the ropes freeze and resume) — kept only if (c) shows sim steps inside a pinch's long frames.
- **Drawing** (the lab's look ×1.4 for the 2 px/mm faces: the lab's plug covers its r 10 jack; a 900-series jack nut is 14 mm = r 14 px,
  panels/modular.js `d: 14`) [C on LAB:253–275]: one dynamic vertex buffer of triangle strips (the smoothed polyline, ≈ 4 sub-points a
  segment); a **shadow** pass (+4, +8 world px, black 0.32, width 11.2); the cord as one strip with three bands across it — rim (the colour
  darkened 45 %, full width **11.2**), body (the colour, 7.8), a highlight (lightened 45 %, 0.55 alpha, 2.2, offset up-left) — anti-aliased
  by `fwidth`, never thinner than 2.5 device px; **plugs**: one instanced quad per end with an SDF — shadow r 14 at (+3, +4), ring r 14
  (darkened 35 %), body r 9.8, highlight r 3.4 at (−3, −3) 0.35 alpha; an S-trigger cord's plug a rounded rectangle (a Cinch-Jones plug)
  [C]. ≤ 3 draw calls. No geometry upload on a camera-only frame.
- **Colours**: the lab's eight (LAB:143): red #d8432f, yellow #e6b83a, blue #3f80d8, green #41a75c, cream #e9e5da, orange #e27c2f, violet
  #9060c9, black #2f3033 — a cord stores its index `c`; a new cord takes the colour used least in the patch, ties in palette order (Q3)
  [C]. Selected: a 2 px light outline pass. A module of a powered-off instrument: cords at 0.45 alpha (cv-face's `OFF_ALPHA`).
- **SVG fallback** (no WebGL2, `?nogl`, a dead context): `svg.cv-cords-svg` in `#world` above the modules (z 10001, `pointer-events:
  none`), the motion-off parabola per cord as the lab's three strokes + plug circles, re-pathed on anchor changes only; no dynamics [C;
  MC §4.3].
- **API**: `createCords(viewport, { world, doc, win, now, raf, createGL?, reduced? }) → { set(list), anchors(map), grab(id, end, p) /
  move(p) / drop(), pull(id, i, p) / release(), live(spec | null), pluck(id, at), hit(x, y, r) → { id, i, t } | null, pointAt(id, t),
  sel(id | null), resize(vw, vh, d), draw(cam, vw, vh, d), stats() → { mode, cords, awake, steps, stepMs, uploadBytes, drawMs, holds,
  bytes }, destroy() }`; `set` diffs by id (new → seeded; gone → removed; a changed end → woken). cv-world builds it lazily (`o.createCords`
  for tests, `?nogl` → SVG) and exposes `world.cords()`.

### 4.4 Patching (cv-patch.js, lane U9; over the world's jack hook)

- **The press**: cv-cables' `press` gains `if (el.getAttribute('data-kind') === 'cord') return call(Op.cordPress, e, el) || false;`
  beside `isModJack` (cv-cables.js:943) and its `jacks()` skips `data-kind="cord"` jacks (an audio / mod drag never restyles them) — the
  two lines of D9. `o.cordPress` = cv-patch's drag (host-provided, main.js).
- **From an empty jack**: after TAP_PX (8 touch / 4 mouse) a **new cord** leaves the jack, its free plug following the finger (a driven
  anchor, LAB:330–337); compatible empty jacks of the patch glow (`canPlug`), the rest dim with their reason in the title (only the patch's
  jacks are marked: ≤ ~100 class writes); release within SNAP_PX 32 screen px of a compatible jack → **plug** (one step "Patch cord", the
  new cord swings into place); elsewhere → nothing (the cord vanishes).
- **From a plugged jack** (its plug is drawn there): the **plug is pulled** — that end follows the finger; release on a compatible empty
  jack → **re-patch** (one step); **released away from any jack → the cord comes out** (one step "Pull cord", "tap to undo") (Q6) [C]; on
  its own jack again → nothing.
- **Tap** on a jack (no move): a **"Connect to…"** menu (the existing pattern, cv-cables.js:1172–1197): compatible jacks grouped by module
  ("904A · CONTROL INPUT 2"), and for a plugged jack "Pull cord" and its colour swatches. Enter / Space / ContextMenu on a focused jack open
  it (keyboard path).
- **A cord's body** (geometric hit, `cords.hit(world point, 10 screen px)`, consulted only where the DOM target is a background —
  `cv-module.isBackground`, cv-module.js:210–218): **tap** → selects it and **plucks** it (an impulse of 9 px / step at the nearest point
  with a sine falloff, the lab's "Pluck" without its randomness, LAB:368–372) and shows a small chip at the tap (eight swatches, "Pull
  out"); **press-and-hold 350 ms without moving** → **grabs** that point (the lab's pull, LAB:321–325) until the finger lifts, then it swings;
  **a drag** pans the canvas (U13: a cord never blocks a pan) [C]. A knob, switch or jack under a cord always wins (the layer takes no
  pointer events). Escape / a tap elsewhere deselects. Cords are drawn above modules, so a cord over a module's bar is visible but the
  bar keeps its press.
- **Two fingers**: a second finger during a cord drag cancels it — a new cord vanishes, a pulled plug springs back — and the two fingers
  pinch (cv-world.js:1123–1133's `jackStop`); a grab ends the same way. Gesture code stays passive (nothing new on `window`).
- **Edge auto-pan** while dragging a plug (`W.dragPointer`, cv-world.js:1364), as cable drags.
- **Module moves**: cv-module's `relay()` (cv-module.js:1036) also hands the ports to the host's `onRelay(ports)` → `cords.anchors()`
  (coalesced to one call a frame); a module dragged with Snap on moves 32 px a step and its cords swing through the swept anchors (LAB's
  rule handles a jump; > 16 px in a frame takes ≥ ⌈Δ / 16⌉ steps, ≤ 8) [C].

### 4.5 Placement, Tidy, add / delete / duplicate / driver

- **Tidy**: the controller is the track's instrument module and cv-module's `tidy` places it as any instrument (cv-module.js:285–339:
  the instrument column at y 0, the FX panel and OUT to its right, the modulators to its left); the `'pm'` keys are placed by the host's
  `PT.rackLayout(rec, fam, sizes)` **relative to the controller's top-left**: the family's `rows` stacked flush **above** it (Moog: row 1
  sources — 921 · 921A · 921B… · 923 · 995 — at dy −1 024; row 2 modifiers — 904A · 907A · 911… · 902… — at dy −512), modules flush left
  to right from the controller's x, extra modules appended to the shorter row, a row past 1 024 px wrapping upward [C; the Model 15 case is
  ≈ 8 MU wide, two module rows over a console row, RM §2.1]. Every width is a multiple of 32 (§2.2), so a flush row stays on the dots;
  touching rects do not trip the GL-face overlap rule (`intersects` is strict, cv-world.js:225); the rows sit above the instrument
  column (y < 0), clear of the FX panel and OUT (y ≥ 0, x ≥ the instrument's + `GAP` 160, cv-module.js:139) and of the modulators (x < 0).
- **Add**: a tap places the module in the first free slot of its row; a drop where released (the ghost at its fixed size). **Delete**: ⋯ →
  Delete (its cords out, its lay entry gone, its `vals.p` kept as an orphan: one step, "tap to undo", Q4). **Duplicate**: ⋯ (values, no
  cords; beside it). A **921B's driver**: at add, the first 921A (by number) with < 3 921Bs, else none; ⋯ → Driver ▸ 921A 1 · none (one
  step); no cord is drawn (a rear connector) — the bar's sub says it, and selecting a 921A outlines its 921Bs [C].
- The controller has no Delete (Replace / Delete track remove the instrument).
- **The default camera** of a 900 Series track (a new one, a track switch without a stored camera, the fit button) frames the controller
  and its rack together, never below `READ_K` (cv-world.js:58–61): the Model 15 rack (≈ 992 × 1 376 world px) opens whole at ≈ 0.5–0.6 on
  the iPad's landscape canvas [C].

### 4.6 The Sources view "Moog modules" (cv-tray, lane U9; art, lane X9)

- `SRC_VIEWS` gains, after `ctl`, `{ id: 'moog', label: 'Moog modules', tip: 'The 900-series modules, patched with cords', layout: 'hw',
  note: 'Model 15 brings the whole set, patched. Drop a module onto a 900 Series track to add it. The Moog Modular (a fixed patch) stays in
  Hardware.', sections: [{ id: 'moog' }] }` — a tile row of its own (`o.moog: [{ id, name, group }]`, `o.moogPick` / `o.moogDrag`,
  `setPlaced(id, reason)` greying at 48 modules), Modulators-style (IMPL-8 review #16's lesson: not the Serum part tiles) [C].
- Tiles: **Model 15** (the `m900` tile: `cv-art` `SIL.m900` / `DRAW.m900`, ours — a small suitcase with two rows of module faces and a
  console strip, cords hanging; no text), then by group — Sources: 921 Oscillator · 921A Driver · 921B Oscillator · 923 Noise; Modifiers:
  904A Low-pass · 907A Filter bank · 902 Amplifier; Control: 911 Envelope · 995 Attenuators — each with an original monochrome glyph
  (`MOOG_GLYPH`: a tall panel outline with its knob dots and jack rings in the module's own arrangement; the 907A wide with ten small knobs)
  and its cost label (`COST.patch`). The view is remembered (`synth.cv.trayLayout = 'moog'`; an older build opens Hardware, cv-tray.js:389).
- `CLASSIC` (cv-tray.js:345) = `classicOf`: the `m900` model never shows in Hardware / Simple.

### 4.7 Notices

On touch devices, a one-time notice when the shown track's painted elements pass the measured line (spike (b); `sxHeavySoon`'s machinery,
main.js:6171–6190): "This many modules may stutter when zooming on this device." The CPU safeguard's OS badge on a patch adds "(cords
into audio inputs may sound different at lower oversampling)" [C].

### 4.8 What stage 9 does not do (said to the user; later stages)

Canvas modulators (LFO / ENV / Macro / Pads …) cabled into a patch (an interface module — "CV IN" — later: the app's mod sources run at
control rate, MC §5.3); MIDI learn and the press-and-hold mod menu on module knobs (`data-nomod`; the controller's knobs keep MIDI learn as
any classic); user patch libraries (the project holds the patches; factory starting patches now); System 35 / 55 modules (904B, 914, 911A,
960 / 961 / 962, 992–994 …); per-voice patches; "Open the Moog Modular as a patch"; patch cords on the app's other cables.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Phase 0: three spikes (before the builders)

| spike | builds (scratch / test page only) | measures | decides |
|---|---|---|---|
| **(a) the evaluator's CPU** (lane A, the lead's scratchpad `9/spike-a/`) | a typed-array prototype of §3.3 running the *Classic bass* graph (13 modules with stand-in DSP of the right cost: polyBLEP cores, the ladder's maths copied, 20 biquads for the 907A) and an m9x-like graph; variants: block per chunk (§3.3) · block per span · per-sample interpretive · a 3-module loop step; `ex2` / rational `tan` vs `Math.pow` / `Math.tan` | load at OS 2 / 4, 48 kHz, on V8 (node, `v8-guard`) and the macOS JSC shell (IMPL-2b §9's method), against **c3 measured in the same harness**; first-quantum after a warm-up; allocation (`noAlloc`) | the evaluation strategy (§3.3 stands unless block-per-span is ≥ 15 % cheaper); the rows' targets (§3.8); whether the 907A needs a cheaper structure; the loop step's cost per member |
| **(b) many modules on the iPad** (lane S9: `tests/ui-bench.html?m9=1` + `tests/ui-bench-m9.mjs`, IMPL-3 §1.5's harness) | stand-in module faces cut from `panels/modular.js`'s sections (921, 995, 903A, 904A, 902, 911, CP3A: real art, real jack positions) as separate GL-face modules with live face-jack spans; scenes **`hw5`** (first and last), **`m13`** (the Model 15 set + 20 cords asleep), **`m13w`** (a scripted module drag — 6 cords awake — then a pluck of all 20, pinching 25–200 % during the sway), **`m20`** (20 modules, 30 cords), **`m30`** (30, 40), **`m30h`** (m30 with the hidden face SVGs dropped once rastered), **`m13s`** (m13 on the SVG fallback) | M0 scripted, M1 hand protocol (+ a plug drag, a re-patch, a tap-pluck, a hold-grab, a module drag with Snap on), firstMove / settle, input-to-frame, painted elements, GL bytes (faces + cord buffer), `cords.stats()`, a rAF counter at rest; P / P+ of IMPL-3 §1.5 | the module-count line of §4.7; whether patch faces must drop their hidden SVG (a hygiene item for P9 / C9, scoped to `'pm'` faces); the jack hit rule at the fit zoom (k ≈ 0.6); Q6's feel |
| **(c) the GL cord layer on WebKit** (S9, in the same page: a prototype cord layer — the Studio physics, the strip and plug shaders — that C9 then hardens as `cv-cords.js`) | the second WebGL2 canvas above `#world`, drawn from the world's `write()` | **glue**: a plug's centre vs its jack's DOM centre mid-pinch and mid-pan ≤ 1 device px (G1's method: CDP screenshots on the Mac; on the iPad the page's probe reads the jack rect and the GL pixel ring in the same frame, plus the user's eye); the frame cost with 40 awake cords (≤ 0.6 ms Mac, recorded iPad); no context loss over a 60 s k-sweep with 30 faces; memory | the layer's place: **above `#world`** (kept) or the fallbacks — cords in cv-gl's under-canvas (knob caps over cords: wrong look, zero new layers) or SVG cords above the modules (static sag, motion only while dragging); the hold rule |

**The user's session** (≤ 30 minutes, the iPad plugged in, other apps closed; after the CDP run on the Mac records `"ui-m9-mac"`): run the
page, the hand protocol on `hw5`, `m13`, `m13w`, `m20`, `m30` (and `m30h`, `m13s` when the others fail), Copy results → `tests/bench.json`
`"ui-m9"`; then a free play with the prototype cords (plug, pull, re-patch, pluck, hold-grab, drag a module) and Q6's answer.

**Decision table** (the lead applies it; §12 records it):
| (b) + (c) on the iPad | decision |
|---|---|
| `m13` and `m13w` P+, glue ≤ 1 device px | as contracted; §4.7's line = the largest P+ scene's painted count |
| `m20` / `m30` fail P+, `m30h` passes | the hidden-SVG hygiene for `'pm'` faces joins P9 / C9 |
| `m13w` fails, `m13` passes | the hold rule (§4.3) on; re-measured by reviewer 2 |
| glue fails (cords lag the faces) | the under-canvas fallback (cords drawn in cv-gl after the faces), the look trade told to the user |
| `m13` fails P | stop: profile on the device before any UI lane (the IMPL-3 "opacity0" probe) |

---------------------------------------------------------------------------------------------------------------------------------

## 6. Host wiring (`main.js`, lane H9)

| site | change |
|---|---|
| imports | `patch-core.js?v=9` as **`PT`** (`PC` is pads-core's, main.js:5293), `moog-core.js?v=9` as `MG`, `cv-patch.js?v=9` (all reachable from main.js: precached) |
| `DSP_FILES` (800–801) | + `'patch-dsp.js', 'moog-dsp.js'` after `'mod-core.js'` (also `tools/precache.mjs`'s read, :65–66, and `wk.loadDSP`) |
| `isPatchDev(t, dev)` beside `isDrumDev` (152) | `d.kind === 'synth' && MODELS family 'patch'`; `patchOf(t, dev)` (the record through `PT.normPatch` when absent: a fresh one) |
| `patchPayload(t, dev)` beside `drumPayload` (3351) | `PT.payload(rec, fam)` + `pk`; sites: `makeNode` (994: `po.seq` for a patch primary), `graphParts` (482: `seqs[id]`), `syncNodes` (718: a fresh Inst's payload in the graph form), the bounce / render-last (4206–4211: offline payloads, `needs: null`), and a `patchSend(t, dev)` after every topology edit (an unchanged `pk` is not reposted: `drPkOf`'s map, 3345) |
| node `onmessage` (1029) | `{t: 'ptErr'}` → one notice per session ("The patch engine did not load: this 900 Series is silent") and a console line |
| `defaults(m)` (130–138) | `m900`: the controller's defaults + `p: {}`; a new `m900` device gets `patch` = `PT.fresh('moog')` (controller only) or the Model 15 set with *Classic bass* (`MG.model15()`) |
| `addTrack` / `setTrackModel` / Replace (3678, 1817) | a `900 Series` instrument's lay: the controller + `rackLayout`; replacing it drops its `iN/*` lay entries and `vals.p` with the device |
| `cvDevices` (6504) | one entry per module (§4.1), after the Serum parts |
| `cvHost()` (5281–5300) | `size`: an `iN/m<n>` key → its fixed size; `devices` as above; `onRelay: ports => CORDS.anchors(...)`; `cordPress` for the cable drag (`V.cableDrag(o)`, cv-module.js:1262) |
| `cvMountBody` / `modMount` (6518) | kind `'pm'` → `cvPatch.moduleBody({ host: PATCH, track, dev, mid, type, doc })` |
| `PATCH = cvPatch.patchHost({…})` beside `PADS` / `DRUM` | deps: `project`, `trk`, `patchOf`, `edit(label, fn)` (one History step: the record write, `patchSend`, `cvRender`, the cords' `set`), `knob(t, dev, mid, id, v)` (vals write + `queuePatch`, no step), `cords: () => world.cords()`, `world`, `notice`, `tapUndo`; it owns the drag, the menus, the chip, add / delete / duplicate / driver, Patches… |
| `renderPanel` (2045–2061) / `cvTitle` (5310) / `cvMenu` (5371) | the controller as a classic hardware panel (its layout `panels/m900.js`'s console; its face jacks from `cvPanel.geometry(L).jacks` into its device entry); the modules' titles / ⋯ items (§4.5); the controller's ⋯: Patches… (the presets, Init patch), Tidy patch; its chip shows `patch.name` (no ◀ ▶: a preset is topology) |
| `cvTidy` (5622) | `'pm'` keys through `PT.rackLayout` |
| the tray (`srcPick` / `srcDrag`, 5004) | `o.moog`, `moogPick(id, mode)`, `moogDrag(id, info)` (§1.4); `setPlaced` at 48 modules |
| `keepDevs` (1391–1401) | **unchanged** — the proof of §1.5 is a test (canvas-9-sim), not an edit |
| `applyRestore` (1402–1416) | `PATCH.cancel()` first (a cord drag ends: a new cord vanishes, a pulled plug springs back); after it `PATCH.sync()` (the cords' `set` from the restored record) |
| `selectTrack` (1855), `deleteTrack` (3711), `panic` | `PATCH.cancel()`; the cord layer's `set([])` on a track without cords (its buffer freed) |
| `loadProject` / `freshProject` | `PT.pruneVals` on each `m900` device (orphans at load only, §1.2) |
| `sxHeavySoon` (6171–6190) | the patch line (§4.7) beside `SX_HEAVY` |
| `__synthTest.cv` (7481) | `patch: PATCH`, `cords: () => world.cords()` for the sims |
| the family sites of §1.2 | main.js:349, 1341 (`&& m.family !== 'patch'`), 1819, 1892, 4847, 5263 (Hardware only, beside the drums), 3682, 5678 (`classicOf`) |
| the accessor ratchet | no new `t.model` / `t.vals` / `fxOf(t)` read (tests/lint.test.mjs:90–110): device views only |

---------------------------------------------------------------------------------------------------------------------------------

## 7. Lanes, schedule, interfaces

### 7.1 Lanes (the leaner shape: contract → skeptic review → builders in worktrees reset to the base with exclusive files → two reviewers → failing-test-first fixers → one sweep)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **A** engine spike | 0 | the lead's scratchpad `9/spike-a/` (nothing committed but §12's report) | §5 (a) | standard |
| **S9** iPad page + cord prototype | 0 | `tests/ui-bench.html` (the `?m9=1` route), `tests/ui-bench-m9.mjs` (new) | §5 (b) (c); CDP run → `"ui-m9-mac"` | standard |
| **E9a** the model | 1a, first | `models.js` (`m900`, `classicOf`) | models load; every existing model's map unchanged (classic-mod's probe) | cheaper |
| **K9** patch core | 1a | `patch-core.js` (new: `normPatch`, `pruneVals`, `fresh`, `canPlug`, the edits `addModule` / `removeModule` / `plug` / `pull` / `repatch` / `setColor` / `setDriver` / `loadPreset`, `payload`, `rackLayout`, `ordinal`, `PALETTE`, `FAMILIES`), `moog-core.js` (new: §2.2's table, §2.4's controller, §2.5's presets, `model15()`), `tests/patch-core.test.mjs`, `tests/moog-core.test.mjs` (new) | §8.2 | standard |
| **V9a** the evaluator | 1a | `patch-dsp.js` (new: `create`, `graph`, `schedule`, the chunk loop, wiring, normals, multiples' sums, back-edges, ramps, retiring, `live`; tested over stub modules of the base shape), `tests/patch-dsp.test.mjs` (new) | §8.1 (schedule, contracts) | standard |
| **V9b** the Moog circuits | 1a | `moog-dsp.js` (new: every class of §3.4 and the controller's DSP, against a minimal host of the base shape; then over V9a's evaluator once merged), `tests/moog-dsp.test.mjs` (new), RM (a "§10 as modelled" table) | §8.1 (targets, bandlimiting) | standard |
| **E9** engine + data plumbing | 1a (after E9a) | `engine.js` (§3.1), `cv-cost.js` + test, `tests/bench-scenarios.mjs` (`patchTrack`, rows), `tests/bench.json` (targets), `tests/bench.html` (c11), `tests/engine-track.test.mjs` (additions), `tests/golden-moog.test.mjs` (new), `tests/golden-harness.mjs` (`DSP_V2`, a `seq` for patches), `tests/dsp-scope.mjs`, `tests/golden-graph.test.mjs` (the filter), `tests/integration.test.mjs` (the plain-model loop: a patch model gets *Classic bass*) | §8.3 | standard |
| **P9** faces | 1a (after E9a) | `panels/m900.js` (new: the controller console + nine module layouts in mm — 921 / 995 / 904A / 902 / 911 re-based from `panels/modular.js`'s sections, 921A / 921B / 907A / 923 from published photographs, **viewing only**, mm recorded in its notes), `panels/index.js` (register `m900`; module layouts by type), `cv-panel.js` (live patch jacks §4.2: `validate`, the art, `geometry().jacks`, `moduleModel`), `tools/panel-check.mjs`, `tests/cv-panel.test.mjs`, `tests/cv-face.test.mjs` (sizes) | §8.4 | standard |
| **X9** satellites | 1a (after E9a) | `song.js` (`normDev` → `patch`), `cv-migrate.js` (schema 12, toV1), `cv-mods.js` (family `'patch'` skipped at :154, 273, 294, 316, 362, 550), `tools/cv-classes.mjs`, `cv-art.js` (`SIL.m900` / `DRAW.m900`), their tests and the pins of §0's list (cv-mods / cv-art / cv-migrate / classic-mod / classic-panel / cv-tray:492) | §8.9 | cheaper |
| **C9** cords | 1b (after the user's S9 session) | `cv-cords.js` (new), `cv-world.js` (the layer: build, draw in `write` / `endBurst`, resize, `cords()`, `sleeper` for cord jacks, the background tap / hold → `'cordtap'` / `'cordhold'` events), `style.css` (`.cv-cords`, `.cv-fjack`, the hit clamp), `tests/cv-cords.test.mjs` (new), `tests/cv-world.test.mjs` (additions) | §8.5 | standard |
| **U9** canvas UI | 1b (after K9's merge) | `cv-patch.js` (new: `patchHost`, `moduleBody`, the drag, menus, chip, Patches…), `cv-module.js` (`side: 'face'`, compact bar, `nofold`, `'pm'` sizing and the Tidy delegation, `onRelay`), `cv-cables.js` (§4.4's two lines), `cv-tray.js` (the view, `o.moog`, `MOOG_GLYPH`), `tests/cv-patch.test.mjs` (new), `tests/cv-module.test.mjs`, `tests/cv-cables.test.mjs`, `tests/cv-tray.test.mjs` (views 545–598, labels), `tests/canvas-sim.test.mjs` (the menu's labels) | §8.6 | standard |
| **H9** host | 2 | `main.js` (§6), `tests/canvas-9-sim.test.mjs` (new, accessor-free), `tests/main.test.mjs` (additions) | §8.7 | standard |
| reviewers × 2 | 3 | (1) **real engine** (golden harness + `main-sim` with the real Track): D1 on every ref, D2 / D7, the schedule on fuzzed graphs, feedback stays finite, ramps click-free (no step > −60 dB at a pull), the presets against RM §5's targets, undo × knobs (§1.5), bounce = live; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the Model 15 rack, glue mid-pinch, plug / pull / re-patch / pluck / hold-grab, two-finger cancel, jack hits at k 0.6 / 1 / 2 and the sleep below 0.5, DOM counts, GL vs `?nogl`, reduced motion, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

### 7.2 Schedule

- **Phase 0**: A ∥ S9; base = `canvas` at this contract's commit. A's report → the lead fixes §3.8's targets (and §3.3 if A says so); S9's
  CDP run, then **the user's iPad session** (§5) → the decision table.
- **Phase 1a** (after A's report): E9a first, then K9 ∥ V9a ∥ V9b ∥ E9 ∥ P9 ∥ X9 on the holding branch **`wt-9`**. **Phase 1b** (after the
  user's session and K9's merge): C9 ∥ U9. Interfaces stubbed per §7.4.
- **Phase 2**: H9 on `wt-9` after phase 1; the lead's fixture check first (a page sim: the Model 15 tile on track 1, a note → the node gets
  the patch payload and `{t: 'on'}`; a cord pulled → a new `pk` posted, one History step, undo restores it with the knobs kept).
- **Phase 3**: the two reviewers → fixers → **one sweep** (every test file, one at a time; `golden-*` once) → **listening renders** (each
  preset, each oscillator / filter / envelope alone; short files) to the user **before** the freeze — the user isn't a modular expert:
  build on RM's measured targets, don't block on sign-off; one retune round by V9b if they ask, then the lead freezes `tests/ref-9/` →
  docs (§10) → **one squashed commit "9"** on `canvas` → `tools/deploy-canvas.sh` → the iPad session (§9).
- **Known windows on `wt-9`** until phase 1 merges (E9a → K9 → V9a → V9b → E9 → P9 → X9): the MODELS-iterating tests (§0's list) fail on branches
  without their owner's change; schema pins until X9; `pwa.test`'s precache check until the lead's `node tools/precache.mjs --write` (new
  files `patch-core.js`, `moog-core.js`, `patch-dsp.js`, `moog-dsp.js`, `cv-patch.js`, `cv-cords.js`, `panels/m900.js`). Each lane runs
  its own files.

### 7.3 Rules for every builder

`git reset --hard <base>` first and check `git log -1` (harness worktrees start from `main`); `?v=9` on every import; new test files
`import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*` (serum-ui.test's safe wrapper); one test file at a time (`node
--max-old-space-size=2048 --test tests/<file>.test.mjs`); dense comments in the existing voice; **no Moog material** (D4: numbers and
function names are facts; layouts from photographs viewed only, recorded in our own mm; no manual prose, no scans committed, no logo); no
lane commits `sw.js`; commit on the worktree branch; report the commit hash and the gates measured.

### 7.4 Interfaces (each lane stubs the other side)

- **moog-core (K9 ↔ V9b / P9 / U9 / H9 / E9)**: `FAMILY` (§2.6: `types`, `order`, `rows`, `PRESETS`, `ctl`), `model15()`. The jack order
  per type = `PatchMoog.JACKS[type]` (V9b), = `panels/m900.js`'s `port`s (P9) — `moog-core.test` checks all three once they exist.
- **patch-core (K9 ↔ U9 / H9 / X9 / E9)**: `normPatch(rec, f)`, `pruneVals(vals, rec)`, `fresh(f)`, `canPlug(rec, a, b, f) → { ok, why,
  a, b }`, edits returning `{ rec, …ids }` (pure: a new record), `payload(rec, f) → { pg, pk }`, `rackLayout(rec, f, sizes) → { key: {x,
  y} }`, `ordinal(rec, mid)`, `PALETTE`, `nextColor(rec)`, `FAMILIES`, `familyOf(model)`, `isPatchModel(model)`.
- **patch-dsp / moog-dsp (V9a ↔ V9b ↔ E9)**: `PatchDSP.create(inst, family)` → `{ set, graph, note, setOS, render, live, reset, setSalt, mon }`
  (it reads `inst.bend` / `wheel` / `at` / `sustain` / `fs` / `OS` / `salt` by name, as the drum machines read their Inst); `PatchDSP.schedule(pg)`; `PatchMoog` (§3.4).
- **cv-panel (P9 ↔ U9 / H9)**: `layoutOf('m900')` (the console), `moduleLayout(type)`, `moduleModel(type)`, `geometry(L, model).jacks`.
- **cv-cords (C9 ↔ U9 / H9)**: §4.3's API; cv-world `cords()`, events `'cordtap' { id, x, y }`, `'cordhold' { id, i, x, y }`.
- **cv-patch (U9 ↔ H9)**: `patchHost(deps)` → `{ press(e, el) (o.cordPress), sync(), cancel(), menu(jack), add(type, at), remove(mid),
  duplicate(mid), driver(mid, drv), preset(name), stats() }`, `moduleBody(o)`.
- **cv-module (U9)**: jack spec `{ id, side: 'face', x, y, kind: 'cord', sig, dir, label }`; `o.nofold`, `o.compact`; host `onRelay(ports)`;
  `tidy` → `host.rackLayout` for `'pm'`.
- **cv-tray (U9 ↔ H9)**: `o.moog`, `o.moogEl`, `o.moogPick`, `o.moogDrag`, `MOOG_TILES`.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Tests and gates

### 8.1 Voices and engine (`tests/moog-dsp.test.mjs`, `tests/patch-dsp.test.mjs`, V9a / V9b; each module alone and in small graphs at 48 kHz × 4 and 44.1 kHz × 2)

- **RM §5's targets**: T-OSC1 (1 V/oct over ±5 V within 0.1 cent; inputs and knobs sum; the 921B's detune an interval, the 921A's span
  switch), T-OSC2 (the levels of §2.1 within 1 %), T-OSC3 (ranges: 921B LO … 2′, the 921's SUB-AUDIO, 1′), T-OSC4 (sync: STRONG locks
  harmonics 1…6, ±6 semitones at 1; WEAK a quarter), T-VCF1 (24 dB/oct ± 1 dB/oct two octaves above f_c; oscillation at k 4 at the per-stage
  corner ± 2 %, a sine; the three ranges; 1 V/oct tracking self-oscillating ± 5 cents over 3 oct; the passband loss with k), T-VCA1 (×2 at
  6 V; lin ∝ V; exp −12 dB / V; the differential and the inverted upper output), T-EG1 (T1 / T2 / T3 2 ms … 10 s ± 5 %, Emax 5.5 V, E SUS,
  opening → T3 from any stage, closure in T3 → T1 from there), T-FFB1 (907A: the centres ± 2 %, 24 dB/oct, flat ± 2 dB at 10), T-LVL1
  (rails), the 995 chain, the 923's spectra (white flat ± 1.5 dB, pink −3 dB/oct ± 1), the controller (priority, glide, triggers, velocity,
  the converters' thresholds).
- **Bandlimiting**: a 921B saw at 4 kHz, OS 4: aliases below 20 kHz ≤ −60 dB re the fundamental; under exponential FM from another 921B at
  audio rate (±1 oct) ≤ −50 dB; a hard-synced and a clamped train ≤ −50 dB [C].
- **The schedule**: `schedule()` on hand cases (a chain, a fan-out through a multiple, a loop of 3, a self-cord, two loops sharing a node,
  idle modules) and 500 random graphs (every live module once; forward edges after their source; back-edges only inside loop steps; MAIN
  OUT's ancestors only); a loop's output = a reference per-sample interpreter with the same back-edges, bit for bit.
- **Shared contracts** (IMPL-7a §12.1's): determinism; **span invariance** (4, 128, random multiples of 4: bit for bit); no NaN / Inf /
  subnormal (every knob at its ends, every module, OS 1 and 4, a max-gain feedback loop for 10 s stays inside the rails); no allocation over
  200 spans incl. note storms (`noAlloc`); `graph()` reuses state by id (an oscillator keeps its phase across a cord change); a pulled cord's
  ramp (no sample step > −60 dB re the signal); a retiring module ends; unknown types / ports dropped with one `ptErr`; `live()` (MAIN OUT
  unpatched → false); `reset`; the per-type costs recorded in §12.

### 8.2 Core (`tests/patch-core.test.mjs`, `tests/moog-core.test.mjs`, K9)

`normPatch` (idempotent; every bound; hostile input — wrong types, 60 modules, 200 cords, duplicate ends, a cord into an occupied jack,
any ↔ any, S ↔ 1/4", unknown types kept, a `drv` to a non-921A; never throws); `canPlug` (every rule of §1.3 with its reason); the edits
(pure; ids monotonic; delete removes the module's cords; duplicate copies values not cords; the driver's ≤ 3); `payload` (stable order,
`pk` changes with topology only); `rackLayout` (the Model 15 set flush in two rows + the console; on the dots; extras appended; wraps);
`nextColor`; `pruneVals`; the presets (each `normPatch`-valid, each uses only Model 15 types, *Classic bass* plays through MAIN OUT);
moog-core's table vs `PatchMoog`'s (`JACKS`, `PARAMS`) and vs `panels/m900.js`'s ports once present.

### 8.3 Engine plumbing and goldens (E9)

- **D1**: golden-classic, -fx, -presets, -random, -graph (its new filter: still 12 models, the count unchanged), canonical-stream,
  golden-drums / -606 / -909 / -sdsv, dr-* — bit-identical after every E9 commit.
- `tests/engine-track.test.mjs`: a patch Inst from `{t: 'patch'}` + `{t: 'seq', s: {pg}}` and from processorOptions (live = offline);
  the payload before the patch waits in `pmPend`; Juno → 900 Series → TR-808 → 900 Series on one Inst (tails on each switch, no click
  above −60 dB); an OS change through `osFade` with a self-oscillating 904A; panic; `warmUp` + `restore` leave a fresh machine; the scripts
  missing → `ptErr` once, silence, no throw; `anyActive` (patched / unpatched MAIN OUT / power off); notes through zones.
- **D2 / D7**: `tests/golden-moog.test.mjs` (§3.7). Bench: m9p / m9x / m9d (V8; JSC by the lead), cv-cost, integration's plain-model loop.

### 8.4 Faces (P9)

`validate` (one mutation per new rule: a live jack without `port`, a duplicate port, a port the type lacks); `panel-check m900` and every
module layout clean (the 14 mm rule, no maker word); `geometry().jacks` (positions = the layout's mm × 2, the module-local origin); the
sizes of §2.2 (1 / 2 / 3 MU, the console); every other model's panel unchanged (cv-panel / cv-face pins byte-identical); a module face
rendered over a fake `api` (its knobs bound to `vals.p[mid]`, no History).

### 8.5 Cords (C9)

The pure physics against LAB (a port of LAB's `Cord.step` / `frame` in the test as the reference: the same polyline after 1, 30 and 240
steps from the same seed, max difference ≤ 1e-9 px); sleep after 30 quiet steps; wake rules; L's easing; the parabola seed and `shown`;
anchors swept across steps; the snap jump rule; the pluck; `hit` (distance to the smoothed polyline, the top-most cord), `pointAt`; the GL
path on a fake context (buffers sized, ≤ 3 draws, no upload on a camera-only frame, context loss → SVG after three); the SVG fallback's
paths; reduced motion (no ticker, parabolas); cv-world: the layer drawn in `write` / `endBurst` with the camera, freed with no cords,
`sleeper` treating cord jacks as bodies below `READ_K`, `'cordtap'` / `'cordhold'` only from a background.

### 8.6 UI (U9)

cv-patch (fake DOM, the safe assert): a press on an empty jack → a live cord; a drop on a compatible jack → one `edit` call (one step);
an occupied / wrong-plug / same-direction jack refused with its reason; a pulled plug → re-patch or out (Q6); a tap → "Connect to…"
(compatible jacks only); a second pointer → cancel (the new cord gone, the plug back); keyboard (Enter on a focused jack, arrows between a
module's jacks); module add / delete (cords out, one step) / duplicate / driver; the module body over `vals.p` (a knob: a `knob` call, no
`edit`); the chip and Patches…; DOM counts per module (§4.1). cv-module: `side: 'face'` jacks at (x, y), no measuring, the hit clamp
variables, `nofold`, compact bar, `onRelay` per relay. cv-cables: a cord jack's press goes to `o.cordPress`; an audio / mod drag never marks
cord jacks; its 54 tests unchanged. cv-tray: six views in order, the menu labels, the Moog row (tiles, groups, glyphs, `setPlaced`), the
remembered view.

### 8.7 Host (`tests/canvas-9-sim.test.mjs`, H9, accessor-free)

The Moog view lists Model 15 and the nine modules; the Model 15 tile replaces the track's instrument (tap to undo) with the rack laid out
and *Classic bass* → the node gets the patch, the payload, a note plays; a module tile on another track → a 900 Series with the
controller and that module; on a 900 Series track → added (one step); a cord plugged / pulled / re-patched → one History step each, a new
`pk` posted, unchanged `pk` not reposted; **undo keeps knobs** (turn a 904A knob, pull a cord, undo: the cord back, the knob as turned);
delete a module with cords, undo (module, cords, lay and knobs back); load a preset, tap to undo; Tidy; a track switch mid-drag cancels
it; panic; Replace with a Juno and back with undo; Save / reload identical (schema 12), a schema-13 file read-only; toV1's lost-line;
a bounce = live; a project without a 900 Series posts exactly today's messages (`canonical-stream` beside it).

### 8.8 Rendering and the iPad (reviewer 2, the user)

The Model 15 rack GL vs `?nogl` (faces ≥ 99 % within 8 / 255 at k 0.5 and 1); G1 `equalPx` (faces and cords mid-pinch = at rest);
the glue (≤ 1 device px); the old panels and cables 0 px changed; a pan / pinch with the rack and 20 cords at 60 fps (no frame > 33 ms in
the steady part); the cord layer ≤ 0.6 ms a frame with 40 awake (Mac); a rAF counter at rest = 0 with every cord asleep.

### 8.9 Tests that iterate MODELS (X9, E9, U9; none weakened)

golden-graph:24 → `!m.custom && !m.family` (E9); classic-mod.test:17 and cv-mods.test:12 → `!m.custom && m.family !== 'patch'` (X9: the
drums stay in; the 900 Series has no classic modulation, §4.8); classic-panel.test:94 and :243 keep `m900` (its console face renders through
`ClassicPanel` like any hardware panel) unless an assertion needs a keyboard synth, then `family !== 'patch'`, recorded in §12 (X9);
cv-mods.js's sites and the class table (`tools/cv-classes.mjs`) skip family `'patch'` (X9; counts unchanged); cv-tray.test:492 →
`classicOf` (U9); cv-art.test:25–80
(`SIL.m900` / `DRAW.m900`, no text) (X9); cv-cost.test:33–39 (`COST.synth.m900`) (E9); cv-panel.test `HW_IDS` + `m900`, `TARGET.m900` (P9);
cv-face.test sizes (P9); integration.test:652–658 (a patch model plays *Classic bass*) (E9); cv-migrate.test schema pins (X9).

---------------------------------------------------------------------------------------------------------------------------------

## 9. Bench rows and the iPad session (after deploy)

`canvas.domlavin.com/tests/bench.html` five passes → `tests/bench.json` `"ipad9"`: c1–c6 and the engine rows within 5 % of `ipad2b` (or the
newest valid run), **m9p / m9x / m9d ≤ their iPad targets**, c11 recorded as the patch baseline; `stale: false`, the deployed build. If the
pending `ipad7a` / `ipad8` drum runs are still missing, this run records the drum rows too (IMPL-8 §15.11's rule). **Hands-on**: the Moog
modules view; the Model 15 tile and *Classic bass* from the keys tray; patch a cord, pull one, re-patch, tap-pluck, hold-grab; drag a module
and watch its cords swing; pinch with cords swinging; a feedback patch (904A → 921B); *Drone* left running; the six starting patches;
undo of a pull with knobs turned since.

## 10. Docs to update (the lead, at the end)

ROADMAP row 9 (status, the decisions, Q answers) and the feedback table; HANDOVER §3 (stage 9 row), §4 (architecture: patch-core /
moog-core / patch-dsp / moog-dsp / cv-patch / cv-cords / panels/m900; the `m900` model and `classicOf`), §5 (lessons); research-moog-modules.md
"§10 as modelled" (V9b's values); SUMMARY.md (plain language); this file's §12 / §13.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Questions for the user

Only what the decisions above leave open; each has the answer the build uses until you say otherwise.

1. **Which key plays when you hold two?** *Recommended:* **the lowest one**, as on the original Moog keyboard (and today's Moog Modular),
   with a LOW / LAST switch on the controller panel so you can change it per patch. The alternative default, "last key", is how most later
   synths behave — nothing is lost either way, it is only the starting position of that switch.
2. **The controller panel** (the Model 15's own console panel is undocumented, so we design ours, labelled as ours). *Recommended:*
   keyboard outputs (two pitch, two S-trigger, a gate, velocity), the mod wheel and pressure as voltages, glide, priority, single /
   multiple triggering, fine tune, a 4-input mixer with + and − outputs, two groups of four multiples, a trigger converter pair (gate →
   S-trigger, S-trigger → gate) and MAIN OUT with its level. No keyboard drawn on it (the bottom keyboard plays it). *Anything to add or
   remove?* Velocity, wheel and pressure were not on the original; keeping them costs nothing if you never patch them.
3. **Cord colours.** *Recommended:* each new cord takes the colour used least in the patch, from eight real cord colours, and you can
   recolour any cord from its menu. *Alternative:* colour by what the cord carries (audio / control / trigger) — more information at a
   glance, but only three colours, and a cord changes colour when you re-patch it.
4. **Deleting a module that has cords plugged in.** *Recommended:* its cords come out with it, in one undo step ("Deleted 904A and 3 cords
   · tap to undo"), no question asked. *Alternative:* ask first — safer, but one more tap every time.
5. **What the first drop gives you.** *Recommended:* the **Model 15** tile brings the whole set already patched as *Classic bass* (play at
   once); a single module tile brings the controller panel and that module, nothing patched (start from an empty case). *Alternative:* any
   first module brings the whole set — instant sound, but no empty-case start.
6. **Letting go of a plug away from any jack.** *Recommended:* the cord comes out ("Cord pulled · tap to undo") — as you would pull a real
   one. The cord lab you tried springs it back to its jack instead. *Alternative (the lab's):* it springs back, and you remove a cord from
   its menu — fewer accidents, one more step to remove. You can try both on the iPad during the spike session.

**Things you will notice (no decision needed)**: a sixth Sources view, **Moog modules**; each module is its real size (2 px per mm, like
the hardware panels) with its own face and jacks; **a jack takes one cord**, as on the real instrument — to send one output to several
places use a multiple on the controller (or the 995's chain); cords sag, swing when you move a module and settle in a couple of seconds;
they hang **over** the modules but never take a knob's touch; tap a cord to pluck it and get its menu, hold a cord to grab and pull it, drag
over it to pan; below 50 % zoom the jacks sleep like the knobs (double-tap a module to patch it there); a patched 900 Series keeps running
(and using CPU) even when you don't play it — that's what lets a drone or a self-oscillating filter keep going; today's Moog Modular is
still in Hardware, unchanged; module knobs aren't MIDI-learnable or cable-able from canvas modulators yet (later).

## 12. Notes (the builders fill in)

## 13. Review log
