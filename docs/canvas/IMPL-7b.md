# Stage 7b: the TR-606 drum machine (IMPL-7b) — contract

The user, 2026-10-20 ([PROPOSAL-drums.md](PROPOSAL-drums.md), answers): the order **TR-808 → TR-606 → TR-909 → Simmons SDS-V**; (1)
**our own sounds through the real circuit**, labelled as ours, plus **"load your own sounds"**; (2) the **authentic panel** (original
art, no logos, no maker names) + an **extras strip that starts neutral** — for the 606 the proposal named **tune / decay** among the
extras ("the 606 has no tune or decay knobs"); (3) **mix output first**; (4) **both ways** (the machine's own sequencer, and named drum
rows in the piano roll that play it). 7a's four questions (IMPL-7a §13: follow the song by default, roll notes and pattern both play,
undo like the TB-303, GM drum rows) are settled for the whole drum family and apply here unchanged.

Design inputs: this stage's appendix [research-606-circuits.md](research-606-circuits.md) (**R6 §n**: the 606's circuits read off its
service notes, its sequencer from its owner's manual, its panel in mm); [IMPL-7a.md](IMPL-7a.md) (**7a §n**: the drum family this stage
reuses — its §14 as-built notes and §15 review log are the reference for what exists); [research-808-circuits.md](research-808-circuits.md)
(**RC §n**); [research-drums.md](research-drums.md) (**RD**, §3 A3 — superseded by R6 where they differ). ROADMAP and its feedback rows
win where they differ. Code references are to `canvas` at **452f731** (the 7a commit; they drift, the names do not). Sections 0–10 are
the contract, §11 the lanes, §12 the gates, §13 the questions for the user, §14 the builders' notes, §15 the review log.

**Every number is tagged**: **[R]** from research (with its R6 / RC section; **[R?]** a secondary or conflicting source, or a value
the sources do not give — lane V6 pins it, R6 §14) and **[C]** a choice made here (a builder may refine a [C] with a reason in §14,
never an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical** — and **the 808 is old sound now**: every golden shard (`golden-classic`, `-fx`, `-presets`,
  `-random`, `-graph`), `canonical-stream`, **`golden-drums` against the frozen `tests/ref-7a/`** (untouched, its `PIN` unchanged,
  tests/golden-drums.test.mjs:30), `tests/dr-808.test.mjs` unchanged and green, the bench rows' outputs. `dr-808.js`, `dr-seq.js` and
  `engine.js` may change only so that every ref-7a case renders bit-identically (that test renders the frozen three against the
  current tree: it is the guard of every refactor below). The 808's patch, payload, plan and record keep their exact shapes (no key
  gained: the 606's discriminators are absent = 808).
- **D2 New sound frozen**: the 606 is pinned at the acceptance commit by **`tests/ref-7b/`** (verbatim `dr-808.js`, `dr-seq.js`,
  `engine.js` + `MANIFEST.json`, ref-7a's mechanism) rendered by a new **`tests/golden-606.test.mjs`**; from then on ref-7a guards the
  808 and ref-7b the 606, so 7c's changes to the shared files keep both.
- **D3 One instrument per track, one output**: the 606 is a track's instrument with one `out` jack (the mix). The hardware has a
  single OUTPUT (+ headphones, R6 §10); its rear legends (SYNC, INPUT / OUTPUT, TRIGGER OUT LT / HT, RUN/STOP pedal) are print.
- **D4 Original content**: no Roland recordings, schematics, manual text, logos, maker names or wordmark lettering; the panel's
  maker-mark and wordmark zones (R6 §13) stay empty; the model name only in plain type; "our model of the circuits" on the tile, the
  about text and the extras caption; DEMO patterns written for this project.
- **D5 Both ways are one sound** for the 606, as 7a §D5: its pattern through its sequencer and the same pattern written by "→ Piano
  roll" render **bit-identically** where step frames are whole numbers (120 BPM / 48 kHz), on the same or the next 4-frame grid point
  elsewhere, at any swing — **including the open hat's tempo-linked cut** (§2.2: both paths read one clock, §3.5).
- **D6 Budgets**: §2.6's rows on the Mac (V8), the JSC shell and the iPad; no allocation on the audio thread; a silent machine
  ≤ 0.0005.
- **D7 Determinism**: hits, the noise and the 606's tempo clock are functions of the transport, the plan, the tempo and the salt;
  offline bounce = live.
- **D8 Reuse, not fork** (this stage's own): the 606 adds **no** Inst kind, worklet script, message type, store, cable or DSP-list
  entry. It is a **machine descriptor** in `dr-808.js` (§2), a **personality** in `drum-core.js` (§3), two small additions to
  `DrSeq` (§3.5), a **panel** (`panels/tr606.js` + cv-drum's 606 widgets, §7) and data entries (models, classes, costs, tray, art,
  bench). Wherever a shared function must know the machine it reads the patch's `machine` or the record's `m` — absent = `'tr808'`.

## 0. What 7a built, and what 7b does with it (read at 452f731)

| 7a piece | where | 7b |
|---|---|---|
| Inst kind `'drums'`: kind boundary, machine, payload routing, hits, steps, render, monitor | engine.js:1905–1930 (setPatch), 2111–2249 (`drOn`, `drFail`, `drGain`, `drUnits`, `fadeDrums`, `drHit`, `drSeqMsg`, `drStep`, `renderDrums`, `drMon`), 2454 / 2618 (`noteOn` / `noteOff`), 2724 / 2728 / 2743 / 2769 (transport, `seqMsg`, `seqRelease`, `seqEvents`), 4149 / 4167 (monitor) | **reused as is**, but the spots that assume one machine: `drOn` builds `Dr808.create(this, 'tr808')` (2119); setPatch's boundary tests only `kind === 'drums'` (1905) **and so do its `rebuild` (1911) and the `drOn` call's guard `was !== 'drums'` (1927)**, so an 808 → 606 Replace (kind stays 'drums') would keep the 808's circuits and DrSeq; `drGain` reads the 808's output stage (2138–2144); `drSeqMsg` (2184) puts any payload into the current `sq` (review #2). §1.5 |
| `DrumP` (the patch's flat `drum`, fixed shape) | engine.js:1355–1368; `PatchP.drum` 1390 | gains the 606's ids (§1.1); `PatchP` gains `machine` |
| the drums warm-up round | engine.js:3204 (`warmDrums`), 1447 (`WDRUM`), `WMASK` | gains a 606 round (§1.5) |
| the machine shell: latches (one trigger per circuit per chunk, lane order), render, the sample lanes, post, mon, smp, salt | dr-808.js:1724–2160 (`create`; `latch` 1988, `apply` 1990, `smpHit` 2016, `render` 2084, `post` 2106) | machine-generic in what it does, but built from the 808's tables (`SOUNDS`/`S_CIR`/`S_VAR`/`S_PAIR` 62–66, `LANE_*` 68–71, `KNOB_IDS`/`KNOB_DEF`/`KNOB_CIR`/`LEVEL_OF` 74–83, `MIX` 293, `OUT_K` 298, the voice list 1744–1745) and **`create` refuses any kind but 'tr808'** (1725) → a **descriptor per machine** (§2.1) |
| the blocks | dr-808.js: `Lin` 147, `BT2` 182, `bil1`/`bil2`/`kBil`/`skHP` 111–133, `hash32` 194, the swing-VCA tables 200–217, `Voice` (the sleep rule) 343, `bandH` 323, the bank (`buildBank` 1777, `band1` 1828, `bandWake` 1852), the noise (`whiteRange` 1887, `pinkRange` 1902, `noiseWake`) | **reused by the 606's voices** (§2.2: the band-passes are the 808's value for value, the toms' rumble filter is the 808's PN filter exactly) |
| the voice classes | `BassDrum` 360, `Snare` 550, `Tom` 724, `Cymbal` 1431, `Hat` 1612 | hard-wired to their tables (`const P = BD`, `K.bdd`): the sub-blocks the 606 shares (the transistor-switched shunt leg of the BD's attack, the snare's noise VCA and ladder, the swing VCA + peak tracker, the Sallen-Key high-passes) are **lifted into parameterised helpers** used by both; the 808's call sites pass today's tables (ref-7a proves the bytes) |
| `DrSeq` | dr-seq.js (all): plays any compiled plan (`valid` 71, `set` 120, `take` 148, `locate` 186, `boundary` 207, `fire` 229, `events` 256) | **unchanged** for the plan, the clock, sync, swing, TAP fills — the 606's scales are four of the 808's step codes (§3.1). Two additions: **STEP RESET** (`rst`) and **`clock(F)`** (the tempo clock the 606's open hat reads) (§3.5) |
| `drum-core` | `PERS` 71 (a data table only); 808-only: `normDrum` 190, `measures` 227, `compilePlan`'s row lookup (`key · 2 + var`, 253), `press` 412, `leds` 623, `gridPat` 370, `stepLen` 613, `demoFree` 619, `DEMO` 650, `DEFAULT_MAP` 67, `tempoBpm` 137, **`compilePlan`'s entry guard (254: a record whose `keys` are not 16 long is re-normalised as an 808's) and `normUi` / `normX` (175–188: a 606 `ui` through them loses its BPM tempo and keys 13–16)**, `normMap` 151 (fills every sound the map lacks with the 808's defaults); shared: the plan format, `payload` 345 (but its `tempoBpm(ui.tempo, ui.fine)` 348), `toNotes` 312, `mapTable` 111 / `primaries` 117 / `drumRows` 123, `audible` 214 / `soundMute` 219, `initState` 360, `running` 361 | **a personality dispatch** on the record's `m` (§3), taken **before** those guards: `PERS.tr606`, its record, state machine, plan measures, LEDs, demo, map, tempo law; the shared functions take the machine's sound set |
| cv-drum (host + widgets) | `drumHost` 126 (generic through drum-core; `mem`'s shape check 131), `drumPanel` 292 (808 tables `LANE_CODE` 58, `PAD_ORDER` 64, `GRID` 70, `DIAL` 96–103, the fallback record `FB` 299, tooltips naming the 808 669 / 674) | **per-personality tables** and the 606's widgets (FUNCTION, CLEAR/RESET, PATTERN GROUP, chains by two held keys); the shared widgets (step keys + LEDs, held-button states, TAP at the press, rotaries, slide switches, the grid canvas, pads, popovers) reused (§7.4) |
| cv-panel | `TOKENS` 72–96, `RENDERED_TOKENS` 100, `TOK_CELL` 108, `XCAPTION_DRUMS` 116, `drp()` 1601 | `TOKENS.tr606` (+ per-model cell sizes), `ctx.model` for cv-drum (§7.3) |
| models / classes / costs / art / tray | models.js:726–765; cv-mods.js:168 (`CLASS_TABLE.tr808`); cv-cost.js:84; cv-art.js:37 / 285; cv-tray.js:334–342 | one more entry each (§1.1, §8, §9); the Drums view's note ("More machines later: TR-606 …") updated |
| data and history | song.js:548 (`isDrum` by `PERS`: the 606 joins), 570 (`normDrum(d.drum)`), 911 (a channel-10 import → tr808); main.js:145–149 (`drumOf`), 1797 (`setTrackModel`), 3211 / 3222 (`drumPayload` / `drumSend`, generic), 1375 (`keepDevs`), 3292–3307 (→ Piano roll, its notice already names the model), 3906; roll.js:52–55 (`drumRowsOf`); cv-migrate.js:121, 240 ("TR-808 track(s)"); **main.js:206 (`normDevs`: a drum device without its record) and 3257 (`drumEdit`: the asset manager's relink) also call `DC.normDrum` without a model**, main.js:3295 (`toNotes` with `map: D.map`, the 808's `normMap`) | `normDrum(d, model)` at song.js:570 and the **four** main.js sites (148, 206, 1797, 3257; review #4), `drumRows(map, model)`, schema 9, the lost-line names the model (§6, §10) |
| tests / refs | `golden-drums` + `ref-7a`; `dr-808`, `dr-seq`, `drum-core`, `cv-drum`, `canvas-7a-sim`; bench d8p–d8i, `bench.html` c7, `drumTrack` (bench-scenarios.mjs:252, hard-codes tr808) | all kept — but two 7a tests pin the 808 as the only drum machine and have no owner as written: `canvas-7a-sim.test.mjs:68` (`shown` = `['tr808']`) and `classic-panel.test.mjs:197–248` (the vertical-switch test hosts only the 808 and pins its list `V`; the 606's SCALE is a vertical switch) — owners in §11 (review #9); **new**: `dr-606.test`, `golden-606` + `ref-7b`, `canvas-7b-sim`; d6p–d6i, c8; `drumTrack(…, model)` (§12) |

## 1. The second machine in the family

### 1.1 The model `tr606` and its patch

- `models.js` gains **`tr606`**, appended after `tr808` (`MODELS` = the 13 + tr808 + tr606; every earlier index unchanged): `name
  'TR-606'`, `model 'Drumatix'`, `maker 'Roland'` (a model label, never on the panel or tile, D4), `year 1981`, **`family: 'drums'`**,
  `tag 'Drum machine · 7 sounds on analog voice circuits · trigger-voltage accent · 16-step sequencer · the TB-303's partner'`, `about`
  ("Our circuit-level model of the TR-606's voice circuits — no recordings of any machine. …"), `theme` (the TB-303's silver and black,
  §7.1), `presets` (§2.5).
- **Controls** — all knobs, `K(id, label, 0, 10, def)`; no switches [C]:
  - the face (R6 §10, §13): **`ac`** ACCENT (def 5), **`bdl`** BASS DRUM, **`sdl`** SNARE DRUM, **`tml`** L.H.TOM (both toms: one pot
    [R]), **`cyl`** CYMBAL, **`hhl`** O.C.HIHAT (both hats: one pot [R]) — levels def 7 (the 808's) [C]; **`vol`** VOLUME (def 7.5);
  - the extras (§2.3; neutral at **5 = the stock circuit**, user answer 3) [C, §13 Q2]: **`bdu` `bdd`** BD tune / decay, **`sdu` `sdd`**,
    **`ltu` `ltd`**, **`htu` `htd`**, **`cyd`** CY decay, **`ohd`** OH decay, **`chd`** CH decay.
  The ids the 808 also has (`ac bdl sdl cyl vol bdd cyd ohd`) mean the same thing on both machines (one `FIELD_CLASS` entry each);
  new: `tml hhl bdu sdu sdd ltu ltd htu htd chd`.
- **`map`** → `{ engine: 'drums', machine: 'tr606', drum: { …every control's position 0…1 by id… }, level: 1 }` — flat, `vals` only
  (7a §1.1, §2.3: the classic adapter's one-level `drum.<id>` paths; the memory, map, mute and slots ride the payload). The 808's
  `map` is untouched: its patch has no `machine` (= 'tr808').
- Every `family` filter 7a added (the tray's `CLASSIC`, the Simple-layout paths, golden-graph, smpgen, integration's note 36,
  cv-tray's test) covers the 606 with no edit; the sites that name `'tr808'` are listed in §10 and §12.6.

### 1.2 Lanes and sounds: the 808's space, a subset

The 606's eight sequencer rows use **the 808's lane bits and sound indices** [C, D8] — so the plan, the payload, `DrSeq`, `dm.trig` /
`dm.hit`, the note map, mute / solo, the sample slots, `toNotes` and the roll's rows run unchanged:

| INSTRUMENT position (R6 §12) | 1 AC | 2 BD | 3 SD | 4 LT | 5 HT | 6 CY | 7 OH | 8 CH |
|---|---|---|---|---|---|---|---|---|
| lane bit (= 808) | 0 | 1 | 2 | 3 | 5 | 9 | 10 | 11 |
| sound index (= 808 `SOUNDS`) | — | 0 bd | 1 sd | 2 lt | 4 ht | 8 cy | 9 oh | 10 ch |
| default notes (§4.1) | — | 36, 35 | 38, 40 | 41, 43, 45 | 48, 50, 47 | 49, 57 | 46 | 42, 44 |

- A 606 step mask is a 12-bit mask **& 0xE2F**; `PERS.tr606.lanes = [0, 1, 2, 3, 5, 9, 10, 11]` maps the selector's position to its bit.
  The sounds it has are **`sids = [0, 1, 2, 4, 8, 9, 10]`** (`PERS.tr606.sids`, `Dr808.mach.tr606.sids`); every sound list stays
  the 808's 16 entries **indexed by sound id** (`SOUNDS`, the payload's `smp` / `prim`, the machine's slots and `lit`) — never a
  7-entry list whose index is not the sound id (`ht` would be 3, not 4) [C] (fixed here, review #17).
  `DrSeq`'s lastNote lookup reads `p.drum.lts` / `hts` for lanes 3 / 5 (dr-seq.js:242) — absent on a 606 (`DrumP` gives 0): the tom.
- **Circuits and triggers** (R6 §4–§9): BD, SD, the **tom pair** (two resonators, one shared envelope, one shared rumble), CY, the **hat
  pair** (one VCA, two envelopes); **seven trigger inputs**, one per sound. Latching (7a §1.2, kept): a hit or step latches its
  sound for the chunk; the chunk applies them in lane order (BD SD LT HT CY OH CH: the CH's choke after the OH's trigger), one trigger
  per **sound** per chunk (the highest volts). There are no one-circuit pairs: LT and HT ring together; OH and CH both drive the hat
  VCA (the circuit decides what "together" sounds like, R6 §9).
- A sound the 606 lacks (mt, rs, cp, cb, the congas, cl, ma) never reaches it from its own map (§4.1); a hostile payload's hit on one
  is ignored by the machine.

### 1.3 The trigger bus and accent (R6 §1)

- One global accent carried as the **trigger's height**, as the 808 (7a §1.3): unaccented **V_N = +B − (V_D6 + V_BE)** [R? R6 §1:
  ≈ 4–4.8 V; V6 pins +B, 4.8 V if the CPU runs from the +6 V regulator, else 4.5 V [C]]; accented **V_A(u) = max(V_N, 15 · 4.7 /
  (4.7 + R_VR2) − 0.65)** with **R_VR2 = 10 kΩ · (1 − u) + 50 Ω** (the ACCENT pot a rheostat; u the knob 0…1) [R calc]: ≈ 14.2 V at
  10 (14.35 V with no end resistance, R6 §1's figure), ≈ 6.6 V at 5, = V_N at 0 (the 606's "barely heard" minimum).
- **No metal bus narrowing**: the 606's cymbal and hats take the plain trigger through their gates (the 808's 7–14 V buffered bus has
  no counterpart, R6 §1) [R].
- **Velocity → volts**: 7a's law with the machine's own V_N and V_A(ac) — `v ≥ 100`: `(1 − w) · V_N + w · V_A`, `w = (v − 100) / 27`;
  `v < 100`: `V_N · (0.6 + 0.4 · (v − 1) / 99)` [C, 7a §1.3]. The sequencer sends V_N / V_A exactly; → Piano roll writes 100 / 127.
- **Pulse width 1 ms** [C, R? R6 §14: the notes do not give it; the 808's]. It matters to the snare and toms, whose drive is
  differentiated (two edge spikes 1 ms apart).

### 1.4 Notes into hits

Unchanged (7a §1.4; engine `drHit`, 2176): the payload's note map → a sound → mute → `dm.hit(sound, v127)` latched at the event's
frame. Before a payload arrives the Inst uses `DrSeq.DEF_MAP` (the 808's: on a 606, 45 and 47 play nothing until the payload — a
render farm or cost probe only) [C].

### 1.5 The engine (lane E6)

- **`PatchP.machine`** = `o.machine === undefined ? 'tr808' : String(o.machine)` (no "unknown key" warning; the 808's patches unchanged).
- **`DrumP`** gains `tml hhl bdu sdu sdd ltu ltd htu htd chd` (defaults: the 606's panel defaults, 0.7 / 0.5); the 808 reads only its
  own fields, the 606 its own. Fixed shape for both (one hidden class).
- **A machine change is a kind boundary**: in `setPatch` (1905) the boundary is `(kind === 'drums') !== (was === 'drums') || (kind ===
  'drums' && p.machine !== old.machine)` — `seqRelease()`, `sq = null`, the old machine's ≈ 3 ms tail (`allOff(true)`) in output units
  through **its own** gain; **both** `rebuild` (1911) and the `drOn` call's guard (1927: today `was !== 'drums'`) include a
  machine change, so `drOn(p)` runs (fixed here, review #1: either edit alone keeps the old machine). The new model's payload
  follows its patch (7a §10.1's order: `sendPatch`, then the forced `drumSend`) and builds a fresh `DrSeq`.
- **The payload may overtake its patch** (review #2): `sendPatch` waits for its assets (`tables.ensure`, main.js:615–618; a graphed
  node's `sendGraph` likewise) while `drumSend` posts at once (main.js:3226–3228), so on an 808 ↔ 606 switch (or its undo / redo)
  the new machine's payload can reach the Inst while the old machine still plays — today it lands in the old `sq` (`drSeqMsg`,
  2184) and the boundary then drops it (`sq = null`): a silent machine until the next edit. So **the 606's payload carries `m:
  'tr606'`** (absent on the 808's: its shape and `pk` unchanged, D1) and `drSeqMsg` keeps a payload whose machine (`m`, absent =
  'tr808') differs from the current patch's in **`drPend`** (a newer one replacing it), exactly as a payload that arrives before
  the drums kind does; `drOn` adopts `drPend` only when its machine is the new patch's (else drops it) [C] (fixed here).
- **`drOn(p)`**: `this.dm = this.dmBy[p.machine] || (this.dmBy[p.machine] = Dr808.create(this, p.machine))` — one machine per kind per
  Inst, built on first use and kept warm (7a's rule, now per machine); `dmV` from that machine's `_v`; `dm.reset()`, `setOS`, `smp` as
  today. A machine `create` refuses (null) → `drFail()` (the `drumsErr` notice), as a missing script. The per-Inst state that today
  assumes one machine follows the cache: `setSalt` and `restore` reach every machine in `dmBy` (reset, no slots),
  the OS each runs at is kept per machine (`dmOS` per kind: a cached machine catches up at its `drOn`).
- **`drGain(p)`** → `Dr808.gain(p.machine, p.drum)` (the output stage's static gain at the panel, §2.1): the 808's arithmetic moves
  into dr-808.js unchanged (ref-7a's cases do not cross kinds; engine-track's 7a kind-change tests pin it).
- **`warmDrums`**: a 606 round after the 808's (two 606 panels with the extras off 5, every sound plain and accented with a retrigger,
  OH + CH together, a free plan through `DrSeq` with a STEP RESET, the clock read at two tempi, an OS change), then `SD.warmUp` /
  `warmGraph` as today (the 2b JSC lesson). A missing machine never throws there (7a §10.2). The round's cost (7a: the scope's
  warm-up 540 → 660 ms in node) is recorded in §14, node and the iPad's first-context ready time.
- **`drClock(F)`** (new, for the 606's tempo clock, §2.1 / §3.5): the DrSeq's `clock(F)` when the Inst has one; without one (no
  payload yet — the notes-only renders of D5, a cost probe) the transport's: the song's ticks while it plays (`tickAt(F)`,
  2713); **stopped, `F` at the Inst's tempo — the `bpm` getter (2716: the patch's `bpm`, the project's), never `tp.fpt`**, which
  is 1 frame a tick until the node's first transport message (3106: a pulse every 40 frames, the open hat cut within ms) —
  so a machine with and without a payload reads one clock whenever the song plays (D5) [C] (fixed here, review #6). `F` is any
  frame (the shell asks per chunk, §2.1, and the de-click tail renders up to 3 ms ahead, 2163–2169), never only a span start.
- Nothing else changes: `drHit`, `drSeqMsg` (but for its machine check above), `drStep`, `renderDrums`, `noteOn` / `noteOff`,
  `transportHook`, `seqEvents`, the monitor
  (the 606 fills its sounds' slots of `lit` and `act`, §2.1), `postMon`, the Track. **No DSP-list change** (the 606 lives in
  dr-808.js and dr-seq.js, which every list already loads — 7a §10.2).

## 2. The voices (`dr-808.js`, lane V6)

### 2.1 One shell, a descriptor per machine

- `create(inst, kind, opt)` takes `kind` **'tr808'** (also `undefined`) or **'tr606'** and builds the shell from **`MACH[kind]`**: the
  knob table (ids, defaults, the circuits each retunes, the level knob of each sound), the sound → circuit / trigger-input maps, the
  lane → sound map, the voice list and its render order, the mix (each sound's bus gain), the output stage (`post`), `OUT_K`, the
  trigger law (§1.3), the sample rules (§5). `MACH.tr808` **is** today's constants (62–83, 293–298, 1744–1745): moved, not changed.
- **`Dr808.gain(kind, drum)`** (engine `drGain`), **`Dr808.mach[kind]`** (`{ KNOB_IDS, KNOB_DEF, SOUNDS, sids }` for tests and the
  engine; `SOUNDS` the 16 by sound id, `sids` the ones the machine has, §1.2);
  the top-level exports (`SOUNDS`, `KNOB_IDS`, `KNOB_DEF`, `SW_IDS`, `vTrig`, `proto` …) stay the 808's exactly — tests/dr-808.test.mjs
  reads them; `proto` gains the 606's tables under `proto.tr606`.
- **Blocks shared** (7a §2.1): the bilinear / TDF-II / trapezoidal blocks (prewarped at the block's frequency; plain `K = 2·fs` where a
  coefficient moves every sample — the 606's three transistor-switched shunt legs), `Lin`, `BT2`, the swing-type VCA (Werner's lower
  edge and α 3.5 soft switch) with the coupled-base peak tracker, the switched first-order envelopes, the Sallen-Key high-pass, the
  hashed noise (absolute-index, salted), the metal bank's steady-state tables (`bandH`, phases from the absolute OS index, the
  trackers' exact pre-roll on waking), the sleep rule (1e-5 of the trigger scale, 4 chunks), span invariance (control work per
  absolute 4-frame chunk), order-free latching, the sample lanes. Where an 808 voice class holds a sub-block the 606 needs, V6 lifts
  it into a helper taking its component table; the 808's call sites pass today's tables. (Bit-safe: JavaScript never contracts
  `a · b + c` into a fused multiply-add, so a helper that keeps each expression's order renders the same bytes; ref-7a checks it.
  CPU: the helpers take scalars computed at a knob change, not the tables, inside the per-sample loops — one shape per call
  site, so the 808's hot loops stay monomorphic after the 606 has run in the same scope; `cpu-gate`'s 2 % on d8p guards it.)
- **The tempo clock** (the 606's open hat, §2.2): the shell reads **`inst.drClock(Fc)`** → `{ t, tpf }` (ticks at frame `Fc`, ticks
  per frame; E6, §1.5) **at every absolute 4-frame chunk start `Fc` while the open hat sounds** and places a pulse on the OS sample
  where `floor(tick / 40)` steps inside that chunk (24 a quarter note, R6 §9), the chunk's own reading only — never a span-start
  reading extrapolated across the span: the two D5 paths split spans at different frames (the notes path also at its note-offs),
  so an extrapolated `t(F0) + n · tpf` would round a pulse onto different samples (fixed here, review #7); a stand-in Inst without
  it (tests): 120 BPM from frame 0 [C]. The 808's machine never reads it.
- **The monitor** (`mon()`, 7a §3.5): `lit` is the 16-bit sound mask as before; the 606 reports its circuits in the 808's circuit slots
  of `act` (BD 0, SD 1, LT 2, HT 4, CY 8, OH 9, CH 10; the hat VCA's level on the slot of the envelope that drives it) [C].

### 2.2 The circuits (R6 §1–§10; values re-read by V6, R6 §14–§15)

| circuit | topology (R6) | the numbers | reused / new |
|---|---|---|---|
| **noise** | junction noise → IC10B (gain ≈ 32–46, TM3) with C36 ∥ R116: a one-pole roll-off (§3) | **130 mV rms** at the test point [R]; −3 dB at **≈ 7.2 kHz** [R calc] | the 808's hashed source (its own salt stream) + one pole; ≠ 808's 20 kHz |
| **BD** | gate → 1/11 divider (R63 / R64) → C25 → **two bridged-T resonators in parallel** on IC5's + inputs (8.9 V bias) → R56 + C16 / R60 + C22 → the top of VR3 (C21 10 nF) → R57 47 kΩ (§4) | **60.0 Hz, Q 7.2, τ 38 ms** and **129.4 Hz, Q 3.4, τ 8.4 ms** [R calc]; no attack switch, no sigh, no tone / decay [R]; the NJM2904's single-supply swing (+4.6 / −8.9 V about the bias) [R?] | `BT2` × 2 (7a's snare / RS GEN1 block); the sum network a `Lin`; the rail clip new (asymmetric) |
| **SD** | gate → 1/11 → **C34 3.3 nF** (differentiated) → **one bridged-T** (4.2 V bias) with **Q17 across R115** (the pitch kick, driven by Q16 / C31 / R105 / R114 from the gated trigger) → R110 / C30; noise → a **swing-type VCA** (Q30, envelope D26 / C35 / R120 / C37 / R121 / C38 / D27) → **Sallen-Key HPF** (Q32) → C57 / R111; both into VR4 → R102 10 kΩ (§5) | **204.8 Hz** at rest → ≤ **358 Hz** at full kick, **Q 14.2, τ 22 ms**; kick fades ≈ 10–15 ms and deepens with accent; HPF **2.67 kHz, Q 0.75**; noise envelope τ ≈ 20 ms [R calc] | the shunt-leg switch = the 808 BD's Q43 solution (time-varying R in the leg, plain bilinear) in a 2-state bridged-T; the VCA + ladder = the 808 snare's (Q48, C51–C53); `skHP` |
| **LT / HT** | each: gate → 1/11 → **C301 4.7 nF / C307 3.9 nF** → bridged-T (8.9 V) with **Q307 / Q308 across R318 / R333**; **one shared envelope** (Q305 / Q306 dump C302 47 µF into C303 0.47 µF, ≈ +15 V whatever the accent) drives both kicks; **one shared rumble**: noise → the 273 Hz Sallen-Key low-pass (Q309) → **Q310**, a base-driven common-emitter stage gated by the same envelope → ≈ 1.6 kHz low-pass → the tom bus; **one level pot** VR5 → R108 22 kΩ (§6) | LT **131.8 Hz, Q 22.4, τ 54 ms** (kick ≤ 311 Hz); HT **206.1 Hz, Q 23.3, τ 36 ms**; the LT's kick audible, the HT's slight; rumble envelope τ ≈ 120 ms [R calc]; a hit on one tom bends the other while it rings [R topology] | the shunt-leg switch (as SD); the rumble low-pass **is** the 808's PN filter (`nz.p`, identical values); the CE stage new |
| **metal bank** | six HD14584 Schmitt RC oscillators at +5 V → **150 kΩ each into R210 1 kΩ** → the two band-passes (IC15, µPC4558, 7.5 V) (§7) | f = **2.07 / RC** [R calc from RC §7's ranges; MK 2.05]: **A 418 Hz** (R226 330 kΩ: §13 Q3) / 203 Hz (680 kΩ, the "84 lot"), **B 440, C 627, D 246, E 308, F 367 Hz**; duty **47.98 %**, 5 V [R, same chip and rail]; band-passes **3454 Hz / 7117 Hz** — the 808's exactly [R] | `buildBank` / `bandH` / `band1` / `bandWake` with the 606's frequencies and summing network (a table) |
| **CY** | gate → R141 → D28 / D29 → **E1** (C49 1 µF, 2 MΩ bleed, Q35 buffer) and the **high-band network** (C47, R165 / C48, R166, + half of E1 via R181); **low band**: E1 → R185 / C61 / R186 → D35 → **Q39** (3454 Hz band at the base) → **HPF 2.18 kHz, Q 0.75** (Q40) → one pole ≈ 1 kHz (R198 / C78) → R200; **high band**: → D34 → **Q38** (7117 Hz band) → C62 → **HPF ≈ 8.5 kHz, Q ≈ 1.1, gain 2** (IC12B) → R204 / C75; VR6 → R109 10 kΩ (§8) | E1 τ ≈ 1.5–2 s; the low band ≈ 70 ms late; the high band ≈ 22 ms fast + ≈ 0.2 s tail + a floor of half E1 [R calc]; two bands, not three [R] | swing VCA + tracker, switched envelopes, `skHP`, one-pole (the 808 CY's blocks with the 606's network) |
| **OH / CH** | the 7117 Hz band → **one swing VCA Q37** whose collector takes **two supplies through diodes**: OH (C45 1 µF / R167 1 MΩ, Q36 buffer, R170 33 kΩ, D33), CH (C42 0.47 µF, R134 33 kΩ, D32); pick-offs at each diode's anode (C67 / C44 2.2 nF) → R172 → **HPF ≈ 8.5 kHz, gain 2** (IC12A) → VR7 → R149 22 kΩ; **choke**: C42 holds Q25 on through R135 330 kΩ, draining C45 through R137 100 kΩ; **the tempo cut**: C41 56 nF, charged by each tempo-clock pulse through D1 / R6 15 kΩ and emptied by Q23 at every OH hit, turns Q24 on through R131 100 kΩ, draining C45 through R137 (§9) | OH natural τ ≈ 0.8 s; CH τ ≈ 15 ms; choke drain τ ≈ 100 ms [R calc]; the cut's onset: the pulses each add ΔV to C41 from the clock pulse's width, which V6 derives from the clock's components (IC1, Q2, C10, R13, R22, C8 — R6 §9) and records (60 / 120 / 240 BPM) [R?]; OH + CH on one step: the closed hat louder, the open one choked [R OM6] | the swing VCA (two diode-OR supplies: new), the choke as the 808's C63 / Q23 path (values), the clock-driven C41 new (the pulses applied as charge events at their OS sample — a µs pulse is below one sample) |
| **mix / output** | the five level pots (50 kΩ B dividers) through **R57 47 k, R102 10 k, R108 22 k, R109 10 k, R149 22 k** into IC14A (R189 47 kΩ ∥ C86 220 pF, 7.5 V) → C87 → **VOLUME 50 kΩ A** → R191 → IC14B (gain −1.5, ∥ 220 pF) → the clamp diodes → C89 / R219 → R218 1 kΩ (§10) | output **2 / 6 Vp-p** at ACCENT min / max (VOLUME max, levels centred) [R spec]; single-supply clipping, the clamp at the output [R] | the shell's `post` with the 606's stage; `OUT_K606` (§2.5) |

- **Every circuit is the analog topology with its component values** (7a §2.2's rule): accent, retriggers, the shared tom envelope,
  the hat pair and the clock-driven cut behave as the circuit does — never an envelope-on-oscillator stand-in.
- **The metal revision** [C, §13 Q3]: **R226 = 330 kΩ** (oscillator A ≈ 418 Hz) — the value of every unit built before the change
  (from s/n 148400, the "84 lot", late in the 1981–84 run [R R6 §7]; that this is most units is our estimate [R?]); the later 680 kΩ
  is recorded in R6 §15 for a later "unit character" option (the 808 snare's precedent, 7a §2.2).
- **Targets** (R6 §14): (a) each block against its own analog prototype (centres ± 1 %, time constants ± 2 %, ± 0.2 dB to 5 kHz at OS
  4); (b) the calc numbers of the table (frequencies ± 2 %, time constants ± 10 %) and the spec's output levels (± 3 dB); there is no
  per-voice service table for the 606.

### 2.3 Knobs → circuit

- **Face** [R]: ACCENT = the rheostat law of §1.3; each LEVEL = its 50 kΩ B divider (position × the pot, the wiper's source resistance
  in series with the mixer's resistor); VOLUME = VR8 50 kΩ A (`tapA`, 7a's audio taper) feeding R191. The tom and hat LEVELs act on
  both sounds of their pair [R].
- **Extras** — each acts on named components, as a pot in their place would; **at 5 every factor is exactly 1.0** (`4 ** 0`), so a
  panel with every extra at 5 renders the stock circuit's bytes (a test, §12.1) [C]:
  - **TUNE** (`bdu sdu ltu htu`): the resonators' **R2** (the whole shunt leg, including the switched part, so the kick's ratio holds)
    × 4^(−2(u − ½)) → f × 2^(2(u − ½)): **± 1 octave**; τ = R1·C unchanged. BD: both resonators together.
  - **DECAY** (`bdd sdd ltd htd`): **R1** × 4^(2(u − ½)) and R2 × 4^(−2(u − ½)) together → **τ × ¼ … 4** at a constant pitch; the
    snare's DECAY also scales its noise envelope's discharge path (R120 + R121) by the same factor; the toms' DECAY their own
    resonator only (the shared envelope stays: R6 §6).
  - **`cyd`**: E1's bleed (R163 + R164) and the high band's tail (R165) × 4^(2(u − ½)); **`ohd`**: R167 (the natural decay) and the
    cut's charging resistor R6 × 4^(2(u − ½)) (a longer decay also cuts later); **`chd`**: R134 × 4^(2(u − ½)).
- `Dr808`'s machine holds the 606's pot table by id (value, taper) and turns a position into the circuit's coefficients in one place,
  testable [C] (7a §2.3).

### 2.4 Rates and oversampling

As 7a §2.4: the app's oversampling (default 4; the CPU safeguard may drop it), every coefficient from `fs`; 44.1 and 48 kHz first-class.

### 2.5 Level, presets, labels

- **Calibration** [C]: `OUT_K606` so the BD at the default panel, unaccented, peaks at the 808's default BD peak (= the TB-303's
  default note, 7a §2.5 / §14: 0.4286 at OS 4, 48 kHz) within ± 1 dB — a 606 replacing an 808 lands at the same loudness. The
  track's limiter catches accented stacks (as 7a).
- **Presets** (knobs only): `Init`, and three of ours [C]: `Deep Kick` (bdu 3.5, bdd 7), `Tight` (bdd 3, sdd 3, ohd 3, chd 4), `Long
  Toms` (ltd 8, htd 8, tml 8).
- **Labels** (D4): about "Our circuit-level model of the TR-606's voice circuits — no recordings of any machine"; the extras caption
  `XCAPTION_DRUMS` (7a); the tile's tip "TR-606 (1981) — our model of its circuits, not recordings".

### 2.6 CPU: rules and bench rows

- Idle costs nothing (7a §2.6): asleep circuits skipped; the metal bank only while CY / OH / CH are live; **the tempo clock costs a
  counter** (no circuit runs for it while the hats sleep: C41's state is a function of the clock and the last OH hit, computed at the
  next wake) [C].
- Per circuit (one ringing continuously, OS 4, the M4 Max, node; informational, recorded in §14) [C]: BD, SD, the tom pair, CY, the hat
  pair each ≤ **0.004** on top of the bank (≤ 0.008).
- **Bench rows** [C] (kind `track`, OS 4, 48 kHz, the machine's own pattern synced at 120 BPM, every timed run audible):

| row | node | jsc | ipad | what |
|---|---|---|---|---|
| **d6p** | 0.025 | 0.025 | 0.025 | a typical 606 pattern: BD on the quarters, SD on 2 / 4, CH sixteenths with OH on the off-beats, LT / HT, CY once a bar, accents every fourth step |
| **d6x** | 0.06 | 0.06 | 0.06 | every lane every 250 ms, accented, every extras DECAY at 10 (the worst case) |
| **d6m** | 0.025 | 0.025 | 0.025 | CY + OH every 500 ms (the bank, three VCAs, the clock-driven cut) |
| **d6i** | 0.0005 | 0.0005 | 0.001 | the machine powered, synced, stopped, silent — gated as row p / d8i (engine-track), not a `scenarios()` row |

(d6p was 0.015 — review #8: below what its own pattern keeps awake. 7a measured, node, M4 Max: d8p **0.0193** for a pattern with
no cymbal (the machine 0.014, the decimators 0.0036, the Track ≈ 0.001), and the 808's CY alone **0.0082** with both bands; d6p's
CY once a bar is never asleep at 120 BPM (E1 τ ≈ 1.5–2 s), its CH sixteenths keep the hat VCA and the high band on, and this
section's own ceilings sum to 5 × 0.004 + 0.008 + ≈ 0.0046 of decimators and Track ≈ 0.033. 0.025 = d8p's target + the cymbal's
bands [C]; the lead may instead drop CY from d6p (it is d6m's) and keep d8p's 0.020.)

`bench.json` `targets` gain `{ node, ipad }` for d6p, d6x, d6m, d6i; `cv-cost` `COST.synth.tr606 = C('d6p', 'drums', 1, base, voice)`
from E6's measured d6p; `bench.html` adds **c8** (the 606 at its default panel playing its DEMO synced, `ipad: null`). JSC A/B (the
lead, IMPL-2b §9's shell method): d6p / d6x and, because `Inst` changed again, c1, d, e, mc0, mt, d8p within 3 %; V8: every existing
row within 2 % (`cpu-gate`).

## 3. The sequencer: the 606's personality (`drum-core.js`, `dr-seq.js`; lane S6)

### 3.1 The record (`dev.drum` of a `tr606` device; `normDrum(d, 'tr606')`)

```
{ v: 1, m: 'tr606',
  keys: [32 × { sc: 1–4, l1: 1–16 }],     pattern p = group · 16 + key: its SCALE and LAST STEP          (cleared: sc 1, l1 16)
  st:   [32 × [16 masks & 0xE2F]],        its steps (§1.2's lane bits)
  rt:   [704 keys −1 … 15],               the bars of the 8 tracks: one store, regions at 0, 64, … 384 (tracks 1–7, 64 bars)
                                          and 448 (track 8, 256 bars) [R R6 §12]
  tg:   [8 × 0 | 1],                      each track's pattern group [R]
  dc:   [8 × bar | −1],                   each track's D.C. bar (absolute index) [R]
  sg:   [8 × bar | −1],                   each track's segno bar [R]
  ui:   { mode, inst, grp, sel, cl, sc, tempo },  x: { sync, swing, mute, solo, rec },  map: {…},  smp: {…} }
```

The **payload** (`payload(D, S, at)` on a 606 record) is 7a's plus **`m: 'tr606'`** (§1.5: the Inst keeps a payload for another
machine waiting) and **`rst`** (the STEP RESET counter, §3.5), and its `bpm` is `ui.tempo` itself (BPM, not 7a's clicks). **`pk`
hashes `m` and `rst`** when present — a STEP RESET is a TAP press whose only change is `rst`, and `drumSend` drops a `'now'`
payload whose `pk` it already sent (main.js:3223) — while an 808 payload has neither key and keeps its `pk` [C] (fixed here,
review #3).

- **`sc` → the plan's step code** (the 808's `STEP_T` codes, drum-core.js:52; no new step length) [R R6 §12]: SCALE **1** sixteenths →
  code **3** (240 ticks), **2** thirty-seconds → **4** (120), **3** eighth triplets → **1** (320), **4** sixteenth triplets → **2**
  (160). Swing applies to codes 3 and 4 (sixteenths, thirty-seconds), as on the 808.
- `ui`: **`mode`** 0 TRACK WRITE · 1 TRACK PLAY · 2 PATTERN PLAY · 3 PATTERN WRITE (the rotary's clockwise order) [R]; **`inst`** 0–7
  (AC … CH; tracks 1–8 in the track modes) [R]; **`grp`** 0 / 1 (I / II) [R]; **`sel`** 0–15 and **`cl`** 0–3 (the chain: keys `sel …
  sel + cl`, inside sel's block of four) [R]; **`sc`** the SCALE switch 1–4 [R]; **`tempo`** BPM 40–300, 0.01 steps — continuous, no
  click stops [R]; on a log law over the knob's travel [C] (`tempo606(u) = 40 · 7.5^u`).
- `x`: as the 808's (sync **on** for a new machine, swing 50–75 % off at 50, mute / solo 12-bit masks & 0xE2F, rec) — no `part`.
- `normDrum(d, 'tr606')`: exact lengths, every value in range, unknown fields dropped, `dc` / `sg` inside their track's reach or −1,
  idempotent, never throws (7a §6's contract). **`normDrum(d)` / `normDrum(d, 'tr808')` return exactly what they return today** (no
  `m`, the 808's shape): every 808 record, payload and test stays byte-identical. **The machine is `model ?? d.m`**: a call without
  a model reads the record's own `m` (`'tr606'` → the 606's; absent, unknown or hostile → the 808's), so a site that forgets the
  model never turns a 606 record into an 808's — main.js has four such sites today, two of them unlisted (206 `normDevs`, 3257
  `drumEdit`: a relinked sample slot would wipe the 606's patterns) [C] (fixed here and §10, review #4).
- **Track reach**: a track starting in region t holds ≤ 256 bars and continues into the next regions when written past its own
  (automatic track selection, up to four tracks) [R]; overwriting into a later track's region ends that track (`dc`, `sg` → −1; the
  808's overflow rule, 7a §14 S #5) [C]; the store's end (703) bounds it. **A continued track keeps its starting track's group**
  (`tg` of the region it starts in; the RAM's 4 bits a bar hold the key only, R6 §12) [C] (R6 §14's open point, decided here,
  review #15).

### 3.2 Panel state (saved) and session (not saved)

- Saved: `ui` and `x` above. Session (`initState('tr606')`, never saved — `initState()` / `initState('tr808')` unchanged): `run`,
  `play`, `pos` (the last heard post), `undo`, `bpm`; **`bar`** (the track pointer, absolute; BAR RESET / locate / TAP move it);
  **`loc`** (the keypad's digits being typed); **`fn`**, **`clr`** (FUNCTION / CLEAR held); **`held`** (the step keys held, for chains
  and PATTERN CLEAR); **`wipe`** (CLEAR held running in PATTERN WRITE); **`twSel`** (TRACK WRITE: the key / chain heard, null = the
  bar's own); **`dcArm`**, **`sgArm`** (CLEAR or PATTERN GROUP pressed before TAP in TRACK WRITE); **`rst`** (STEP RESET counter).

### 3.3 The behaviours (`press(state, drum, input)` → the 606's machine when `drum.m === 'tr606'`)

The 606's buttons are **held states**, so its widgets send down / up [C]: `{ k: 'key', n, down }`, `{ k: 'fn', down }`, `{ k: 'clr',
down }`; TAP acts at the press (`{ k: 'tap', f, F }`), RUN/STOP and PATTERN GROUP on a tap (`{ k: 'start' }`, `{ k: 'grp' }`: the
808's START's `A.tap` — a finger at its release, so a pinch starting there presses nothing; fixed, review 2 #1 / #2). A key's action
happens at its **down** unless a combination needs it held (chains: the second key's down) [C]. One row per test (§12.3) [R R6 §12
unless tagged]:

| input | behaviour |
|---|---|
| **RUN/STOP** | synced: the project's ▶ / ■ (7a §13 answer 1); free: runs / stops the machine at its TEMPO. Pattern modes start at step 1 of the selection (a chain: its first); track modes at `bar` (BAR RESET or a locate set it; synced: §3.4) |
| **key, stopped, PATTERN PLAY / WRITE** | selects pattern `grp · 16 + n − 1` (flashing); a second key **down while the first is held, in the same block of four**: the chain first … last (≤ 4, never across blocks) — the first flashing, the rest steady. Mouse: Shift-click a second key of the block [C] |
| **key, running, PATTERN PLAY** | queues that pattern / chain: it starts when the current pattern ends (`at: 'bar'`) [R "always finish the measure"; R? a running chain: at the end of the current pattern, not the chain — R6 §14] |
| **key, running, PATTERN WRITE** | toggles the selected instrument (AC included) at step n of the edited pattern (in a chain, the pattern heard [C]); keys beyond its LAST STEP do nothing [C]. PATTERN PLAY ↔ PATTERN WRITE may change while running (live edit) [R] |
| **FUNCTION + key, running, PATTERN WRITE** | LAST STEP = n for the edited pattern (`at: 'bar'` when it shortens the bar under the playhead, else 'now') |
| **FUNCTION down, running, PATTERN WRITE** | latches the SCALE switch (`ui.sc`) into the edited pattern [R: at the press — also when it starts a FUNCTION + key]; stopped: nothing [R] |
| **FUNCTION held** | LEDs: running PATTERN WRITE → the first step of each beat (scale 1: 1 5 9 13); running in a track mode → the current bar number; stopped TRACK WRITE / PLAY: FUNCTION + CLEAR shows the D.C. bar, FUNCTION + PATTERN GROUP the segno bar (§3.6) |
| **FUNCTION + keys, stopped, TRACK WRITE / PLAY** | the **bar keypad**: keys 1–9 → digits 1–9, 10 → 0, 11 → 100, 12 → 200 (typed into `loc`; FUNCTION's release locates `bar` = the track's start + loc − 1, clamped to its reach) [R]; keys 13–14 nothing [R?]; **15 DEL** (TRACK WRITE): removes bar `bar`, the rest shift left (`dc` / `sg` follow their bars; a deleted D.C. bar moves the D.C. to the bar before [C]); **16 INS**: duplicates bar `bar`, the rest shift right (the track's last bar drops when it is full) [R; C for the markers] |
| **CLEAR down + a held key, stopped, PATTERN WRITE** | **PATTERN CLEAR** of that pattern (two held: both), steps only — SCALE and LAST STEP kept [R]; the group LED flashes once [R]; ours: "Pattern I-3 cleared · tap to undo" (a one-level session copy, 7a's rule) [C] |
| **CLEAR held, running, PATTERN WRITE** | **wipe**: the selected instrument's step is cleared at each step heard while CLEAR is held (they go as they pass) [R] — applied at the heard post (the `'heard'` notification, as 7a's COMPOSE recording) |
| **CLEAR, stopped, TRACK WRITE / PLAY** | **BAR RESET**: `bar` = the track's first bar [R] |
| **CLEAR, running, TRACK WRITE** | arms D.C. (`dcArm`): the next TAP writes the heard pattern as the D.C. bar (the track ends there; an older D.C. is replaced) [R] |
| **CLEAR, running, TRACK PLAY / PATTERN PLAY** | nothing [R / C] |
| **TAP, running, PATTERN WRITE** | writes the selected instrument at the **nearest step** of the heard pattern (7a's TR-08 rule, `f` from the host at the press) [C, R? R6 §14] |
| **TAP, running, PATTERN PLAY** | **STEP RESET**: the payload's `rst` counter +1 — the current pattern restarts from its step 1 at the next step tick (§3.5) [R; C "next step tick"] |
| **TAP, running, TRACK WRITE** | writes the heard key (or chain: one bar each) into `rt` from `bar` and advances `bar` by as many (with `dcArm`: the last as the D.C. bar; with `sgArm`: marks `bar` as the segno instead of writing) [R]; the track's group is `tg` (set stopped) [R] |
| **TAP, stopped, TRACK WRITE** | `bar` + 1 (stepping through the track to check) [R] |
| **TAP, running, TRACK PLAY** | **D.S.**: from the next bar, the track continues at its segno bar (a plan swap `at: 'bar'`, §3.4) [R; R? at once vs the bar's end: the bar's end, C] |
| **PATTERN GROUP** | stopped: toggles the group (pattern modes: `ui.grp`; TRACK WRITE: the track's `tg`) [R]; running TRACK WRITE: arms segno (`sgArm`) [R]; running otherwise: nothing [R] |
| **MODE** | the panel's rules change at once; the plan swaps at the next measure (`at: 'bar'`; PATTERN PLAY ↔ WRITE keep the pattern running) [C, 7a] |
| **INSTRUMENT / TRACK** | pattern modes: the instrument written; track modes: the track; running in TRACK PLAY: the new track from its first bar at the next bar [C, TR06's queue] |
| **SCALE** (the switch) | sets `ui.sc` only (FUNCTION latches it) [R] |
| **TEMPO** | free: the machine's tempo; synced: the project's (one gesture = one tempo edit) [C, 7a] |
| extras | `sync`, `swing`, `mute` / `solo`, `rec`, `grid`, `pad`, `map`, `mapReset`, `smp`, `undo`, `demo` as 7a §3.3 (lanes restricted to 0xE2F); **`link303`** (§3.8) |

- Inputs not in the table do nothing (START in a mode with nothing to play, keys in TRACK PLAY without FUNCTION …) [C].
- **FUNCTION held wins** (review #14): stopped in a track mode, CLEAR and PATTERN GROUP pressed while FUNCTION is held only show
  the D.C. / segno bar (the FUNCTION row) — no BAR RESET, no group toggle, no D.C. / segno arming; the rows "CLEAR, stopped …"
  and "PATTERN GROUP" apply with FUNCTION up [C].
- **A track with no D.C. bar** plays to its last written bar and loops from bar 1 (an implicit D.C. there) [C, R? R6 §14]; an empty
  track plays nothing. A `−1` bar inside a track plays a silent bar of 16 sixteenths (7a §14 S #7) [C].
- The manual's "release the buttons between operations" quirk [R] is not emulated (a held-state machine handles any order) [C].

### 3.4 The plan (`compilePlan` → the shared format; the 606's `measures`)

The 7a plan format and its content key unchanged (7a §3.4, drum-core.js:253–289): a measure per pattern (`mKey` = the pattern 0–31,
`mVar` 0, `mPre` = the step code of its `sc`, `mL1` = its `l1`, the steps `& audible(x)`), `fill: null` (the 606 has no fills). The
row lookup becomes per machine (the 808's `st[key · 2 + var]`, the 606's `st[key]`) [C]. Per mode:

- **PATTERN WRITE / PLAY**: the selection — one pattern or the chain `sel … sel + cl` of group `grp` — looping.
- **TRACK WRITE** (running): `twSel` (the key / chain heard) looping, else the pattern at `bar` [R].
- **TRACK PLAY**: the track's bars from its first to its D.C. bar (or last written), looping [R]; **free**, a located start is a
  pre-roll: `[bar … end]` then the cycle `[first … end]` with `loopFrom` after the pre-roll (the plan's intro mechanism) [C];
  **synced**, the plan is anchored at song tick 0 like every synced plan (track bar n is the plan's measure n from tick 0, looping
  — a song bar only while every pattern is 16 sixteenths; a LAST STEP or a SCALE makes its own length) and the keypad's locate
  only shows (7a §3.5's rule: a synced machine's position is a function of the song position) [C]. **D.S.** = a plan swap at the next
  bar to the rotated cycle `[segno … end, first … segno − 1]` (`loopFrom` 0); the next start / seek / stop sends the plain plan again
  (the session clears its D.S. state at `'transport'`) [C].
- Bounds: ≤ 512 measures (a 256-bar pre-roll + a 256-bar cycle), ≤ 8 192 steps: inside 7a's `MAX_MEAS` / `MAX_STEPS`.

### 3.5 The clock (`DrSeq`, unchanged but for two additions; lane S6)

Sync, free running, live plan changes (`at: 'now' | 'bar'`; the 606 never sends 'beat2'), swing on whole ticks, hits through
`dm.trig(mask)`, the #34 step hook, the posts at the heard time, offline = live: **exactly 7a §3.5**. Additions, each inert for the
808's payloads (ref-7a guards it):

- **`rst`** (a payload counter, like `tap`): an increment while running → at the cursor's next **even** step (a pair's first step:
  on the straight grid) the playing measure restarts at its step 1 (`c0` = that tick; the measure count continues; synced, the
  shift holds until the next re-anchor — a start, seek, loop wrap or power on re-anchors at tick 0 as always) [C: the hardware
  restarts at once; ≤ two steps later keeps the step grid]. Not the next step whatever its parity (review #11): at a swing an odd
  step's tick carries the swing offset `cw`, and `c0` there would shift the whole grid by it (every even step swung, every odd
  one twice, dr-seq.js:175). A pending plan swap stays pending to the new measure's end. **`rstF`** (the press's heard frame,
  −1 none; the 606's payload only): the request is dropped when a measure's step 1 fired after it — the pattern already
  restarted after the press as heard (with output latency the cursor is past the bar line a press heard on step 15 / 16 meant)
  [C, the lead's decision on review 2 #3].
- **`clock(F)`** → a preallocated `{ t, tpf }`: the 606's tempo oscillator, which runs always (R6 §9) — **free and running**: the
  machine's own ticks at **frame F** (`fT + (pos + F − sF − fP) / ffpt`, `sF` the span start `events(F)` last saw: `pos` is the
  span start's position, engine.js:3981, and the shell asks per chunk and 3 ms ahead in a de-click tail); **otherwise, the
  transport playing**: the song's ticks (`tp.tick + (F − tp.frame) / tp.fpt`); **otherwise**: `F / fpt0` with fpt0 the tempo the
  panel shows — free, the machine's TEMPO (the payload's `bpm`); **synced, the Inst's `bpm` getter (engine.js:2716: the project's;
  never `tp.fpt`, 1 until a transport arrives, nor the payload's `bpm`, the stored knob)** [C] (fixed here, reviews #6, #7). So
  the notes path and the sequencer path read the same clock whenever the song plays (D5 — "→ Piano roll" leaves a stopped free
  machine; an Inst with no DrSeq falls back to the same transport rule in `drClock`, §1.5), and a bounce equals live (D7). No
  allocation.

### 3.6 LEDs (`leds(S, D)` → `{ step[16] 0–4, run, grp: [I, II] }`; the 808's codes, cv-drum `LIT`)

Stopped, pattern modes: the selected key flashing, a chain's other keys steady [R]. Running PATTERN PLAY: the **chase** — the
playhead step lit across 1 → last [R]. Running PATTERN WRITE: the instrument's steps lit with the playhead inverted (the 808's codes 3 /
4) [C, R? R6 §14]; FUNCTION held: the beat markers steady [R]. Running TRACK WRITE: the current bar's key steady [R]. Track modes with
FUNCTION held (or a locate being typed): the bar number — the hundreds (key 11 / 12) and tens steady, the units flashing (a repeated
digit alternates each beat) [R TR06]. The group LEDs: the shown group (a track mode: the track's), one flash after PATTERN CLEAR [R];
the RUN LED lit while running [R].

### 3.7 Extras helpers (start neutral; 7a §3.6's, re-tabled)

- **Grid** (`dr:grid`): the 8 rows AC … CH × 16 steps of the pattern edited (PATTERN WRITE) or heard; tap toggles; a header tap mutes,
  a long press solos (7a); the cells past LAST STEP dimmed [C].
- **Pads** (`dr:pads`): 2 × 4 — **CY OH CH AC / BD SD LT HT** (the kick bottom-left); velocity from where the pad is touched (the 1i
  curve), multi-touch, `data-gesture="music"`; **AC is a hold**: while it is held every pad hit plays at 127 (the 606's total accent
  as a modifier; it plays nothing itself) [C]; REC records such a hit with its accent (the AC row too), the pad reads "Hold"; the
  pads 2 × 50 + 8 from 8 px down (clear of the grid) — fixed, reviews 1 #5, 2 #4.
- **SYNC**, **SWING** (50–75 %), **→ PIANO ROLL**, **REC**, **MAP…**, **SOUNDS…**, **DEMO** (our own: pattern I-1 a groove for the
  TB-303's default line, I-2 its variation with the toms, chained 1–2 in PATTERN PLAY — written for this project, D4) — 7a's widgets
  with the 606's texts; **SYNC 303s** (`dr:link`, §3.8).
- **The eleven TUNE / DECAY knobs** (models.js controls placed in the extras strip, §2.3), two rows (§7.5).

### 3.8 The TB-303 pairing (the acid pair)

The 606 was sold as the 303's partner: the 606 at DIN-sync OUTPUT drives the 303's SYNC IN, both at 24 PPQN (R6 §12). In the app
**one clock already drives every track** (the proposal's "no separate sync cable" choice): a synced 606 and a synced 303 are locked —
the 303's synced step `k = floor(t / 240)` from song tick 0 (engine.js `seqEvents`, the analog branch) and the 606's sixteenths from
tick 0 fire on the same 4-frame grid point, or the next (both fire at the first span start whose `tickAt(F)` reaches the tick —
engine.js:2713 / 3810, the expression `DrSeq` and `songEvents` use — 7a §15's D5 analysis). What the app adds [C, §13 Q1]:

- **The default gap**: a new TB-303's sequencer has **SYNC off** (`SEQ_DEF.sync = false`, classic-panel.js:107–108: its own RUN and
  128 BPM), a new 606 SYNC on — side by side they drift. So **SYNC 303s** (`dr:link`, extras): one tap switches every TB-303
  sequencer of the project to SYNC (the 303's existing `sync`, main.js `seqOf` / `seqSend`), stops their free runs, and sets each one's
  swing to the 606's equivalent; its notice "2 TB-303s now follow the song · tap to undo" restores each 303's sync, run and swing.
  The button reads "303s synced" (disabled) when every 303 already is, and is hidden with no 303 in the project. **Plumbing**
  (review #18): the drum panel learns that state from a host dep **`n303()` → `{ n, synced }`** and repaints on **`DRUM.link303()`**,
  which the host calls whenever a 303's `seq.sync` or the project's 303s change (the 303 panel's own SYNC button,
  classic-panel.js:620; a track added / removed / replaced; undo); and an open TB-303 panel repaints its SYNC / Run / SWING after
  SYNC 303s writes its `seq` — today `syncDraw` runs only on its own click (classic-panel.js:618–620) and the numbers on theirs
  (657) [C]. A 606 above 62.5 % sets the 303s to their 50 (the most they swing), and the notice says "(as far as the TB-303 swings)".
- **The offer**: when a 606 arrives (Drums view tap or drop, Replace with…) in a project with a 303 on SYNC off, the notice "The TB-303
  on “Bass” runs on its own clock — sync it to the song so the two play locked? · Sync" (the same action; once per project session).
- **Swing scales differ**: the 303's extras swing is 0–50 (a fraction `s / 200` of a sixteenth: 1.2 · s ticks, fractional), the drum
  machines' 50–75 % (Linn's, whole ticks). The equivalent: `s = 4 · (P − 50)` (0–50: the 303 reaches 62.5 %). At one swing the two
  differ by < 0.5 tick (≤ 0.26 ms at 120 BPM), inaudible; SYNC 303s writes `s` and a test bounds the offset (§12.2) [C].
- Not emulated: DIN pins, the INPUT / OUTPUT switch (drawn as print), the trigger outs (print) [C, D3].

## 4. Both ways: notes and the piano roll

- **The note map** (`PERS.tr606.map`, GM-based, 7a §13 answer 4): **bd 36** (+35), **sd 38** (+40), **lt 41** (+43, 45), **ht 48** (+50,
  47), **cy 49** (+57), **oh 46**, **ch 42** (+44) [C] — the 808's primaries, so a pattern moved between an 808 and a 606 track (notes,
  MIDI files) plays the same drums; the GM toms 43 / 45 / 47 / 50 fold onto the two toms. `normMap(map, 'tr606')` keeps only the 606's
  seven sounds; MAP… lists those seven.
- **Roll rows**: `drumRowsOf(dev)` → `drumRows(map, dev.model)` — the seven named rows (Kick 36, Snare 38, Low tom 41, Hi tom 48,
  Cymbal 49, Open hat 46, Closed hat 42); everything else of 7a §4.2 unchanged.
- **→ Piano roll**, recording, bounce, MIDI in / files: 7a §4.3–§4.5 unchanged (`toNotes` of the 606's plan; its notice reads "the
  606's own sequencer is off …" — main.js:3307 already takes the model's name). A channel-10 import still makes a TR-808 track [C].
  **But** main.js:3295 hands `toNotes` the map (`map: D.map`), whose primaries come from the 808's `normMap` — it fills every sound
  the map lacks with the 808's defaults in sound order, so a 606 map with HT moved to 45 or 47 loses that note to the 808's mid tom
  (`mt: [45, 47]`, filled before `ht`) and → Piano roll drops every HT hit. H1 passes **`prim: DC.primaries(D.map, model)`**
  (fixed here and §10, review #5). → Piano roll also sets the machine's own TEMPO (the 808's TEMPO + FINE) to the project tempo
  (`DC.withTempo`), undone with the rest, so after ■ the SYNC-off machine's clock is the synced pattern's (D5 at a stop: the
  lead's decision on review 1 #4, both machines).

## 5. Your own sounds

7a §5 unchanged, on the 606's **seven** slots (SOUNDS… lists them). What acts on a sample [C]: its LEVEL (the tom pair's / hat pair's
shared pot for both), the hit's voltage as gain (7a's law with the 606's V_N / V_A), **TUNE ± 1 octave centred at 5** (BD, SD, LT, HT),
**DECAY a fade only below 5** (5 = the whole sound, 0 = 30 ms: neutral at the default), the CH → OH choke (7a F3's rule), mute / solo.
The machine's memory cap and the 2 playback levels as 7a.

## 6. Project format, schema, undo

- **Device record**: `{ kind: 'synth', model: 'tr606', vals, preset, drum: {…§3.1…} }`; `song.normDev` → `normDrum(d.drum, o.model)`
  (song.js:570); `drumOf` (main.js:148) and `setTrackModel` (1797) pass the model; `keepDevs` keeps a same-model device's `drum` (the
  808's policy: pattern edits are instrument tweaks, 7a §6); PATTERN CLEAR, DEL / INS, DEMO, SYNC 303s and → Piano roll get the one-tap
  undo notice; a model switch deletes the old machine's `drum` (7a §15 #28) — **808 ↔ 606 included** (each gets a fresh record; the
  Replace undo restores the old one from History).
- **Schema 9** (`cv-migrate.SCHEMA = 9`, `STEPS[8]` additive): a schema-8 build (7a) reads `tr606` as a Minimoog (`modelById`'s
  fallback, main.js:89) and would autosave the loss; with the bump it opens the project read-only (7a's precedent, §6).
- Save as classic project: the lost-line names each drum track's model ("TR-606 track “Drums”: the live site has no drum machine —
  its piano-roll notes are kept"; cv-migrate.js:240 says "TR-808" for any drum track today).

## 7. The panel (`panels/tr606.js`, `cv-panel.js`, `cv-drum.js`; lanes P1 / X)

### 7.1 The layout (R6 §13)

- **300 × 146 mm** (one area `main`; the face may crop to the measured 143–145.5 mm as the TB-303's does, panels/tb303.js notes) → 600
  × ≈ 290 px at 2 px/mm; the module with its extras strip ≈ **608 × 864 px** (P1 pins `TARGET.tr606` from its geometry, ± one dot)
  [C est.: the face ≈ 290, the strip ≈ 16 + 192 + 116 + 2 × 64 + 64 + 8, §7.5] — about half the 808's module (its face about a
  quarter of the 808's).
- Three bands as the hardware (R6 §13): **A** — the rear legends with ▲ marks (print), the six knobs (ACCENT, BASS DRUM, SNARE DRUM,
  L.H.TOM, CYMBAL, O.C.HIHAT at y 14.9, pitch 22.8 mm); **B** — TEMPO, the TRACK / INSTRUMENT rotary (8 detents, numbers in black
  squares), the MODE rotary (4, the 303's bracketed legends), the model name in plain type, VOLUME; **C** (the dark panel) —
  CLEAR/RESET (D.C. · BAR RESET · PATTERN CLEAR legends), the RUN LED and RUN/STOP, the SCALE slide switch (4 at the top) with its
  leaders and the four-row scale graphic (our glyphs), FUNCTION, the 16 step keys with LEDs above, the LAST STEP and BAR bands, the
  segno box, the group LEDs I / II and PATTERN GROUP, D.S., TAP with WRITE/NEXT · TAP · STEP RESET. Positions from R6 §13 (± 1.5 mm);
  P-lane notes record every nudge for the 14 mm hit rule (7a §7.3).
- **Colours / skins**: the TB-303's scheme (panels/tb303.js: silver `#c6c8c7`, case `#1b1c1c`, its knob and selector skins) for the
  shared case family, plus the near-black lower panel, light grey key caps and red LEDs [R? V]. Title: plain type "TR-606 · Computer
  Controlled" (the 303 precedent: no wordmark lettering, no maker); the photo's maker and wordmark zones empty (D4).
- Inert, drawn as print: the rear legends (RUN/STOP pedal, INPUT ▲ OUTPUT, SYNC, TRIGGER OUT LT / HT, HEADPHONE, OUTPUT, DC 9V); no
  `inert: 'later'` jacks (the 606 has no per-voice outputs, D3).

### 7.2 Tokens (`TOKENS.tr606`)

| token | kind | | token | kind |
|---|---|---|---|---|
| `dr:mode` | rotary (4) | | `dr:start` | button (RUN/STOP) |
| `dr:inst` | rotary (8) | | `dr:runLed` | led |
| `dr:tempo` | knob (continuous) | | `dr:clear` | button (CLEAR/RESET, held state) |
| `dr:sc` | switch (4, vertical) | | `dr:fn` | button (FUNCTION, held state) |
| `dr:step` | button, **multi**, `n` 1–16, all present, LED above | | `dr:grp` | button (PATTERN GROUP) |
| `dr:tap` | button (WRITE/NEXT · TAP) | | `dr:grpI`, `dr:grpII` | led |
| extras | `dr:grid dr:pads dr:sync dr:swing dr:toRoll dr:rec dr:map dr:sounds dr:demo dr:link` + the eleven extras knobs (models.js ids) | | | |

Token ids the 808 also uses keep their widget; `TOKENS` is per model (`pos`: mode 4, inst 8, sc 4). **Cell sizes per model** [C]:
`TOKENS.<model>.cells` overrides `TOK_CELL` (the 606's grid **592 × 192** — a 48 px header + 16 × 34, a 32 px top + 8 × 20 — and
pads **232 × 116**) and its own row breaks (7a's `XBREAK`, today one global list, cv-panel.js:114). (Review #10: the grid was 608 ×
192, but a 300 mm face is a 608 px module, `ceil32`, cv-panel.js:545, whose strip keeps `XPAD` 8 px each side, 35 / 586–589: 592
px inside, the TB-303's `SEQ_GRID` 576 the precedent); `RENDERED_TOKENS` gains `dr:runLed dr:sc dr:fn dr:grp dr:grpI dr:grpII
dr:link`; `usable('tr606')` once valid.

### 7.3 Validator and geometry (`cv-panel.js`, P1)

7a §7.3's rules for `tr606` (hit boxes ≥ 14 mm disjoint, no maker word, the model name only as plain text, `panel-check` knows it);
`drp()` passes **`model`** in cv-drum's ctx (a stub-hosted 606 panel builds the 606's widgets over a 606 fallback record).

### 7.4 The widgets (`cv-drum.js`, P1)

- **Personality tables** per machine (`UI.tr808` = today's `LANE_CODE`, `LANE_ALT`, `PAD_ORDER`, `GRID`, `DIAL`; `UI.tr606`: codes AC BD
  SD LT HT CY OH CH on bits 0 1 2 3 5 9 10 11, the 2 × 4 pads with the AC hold, the 8-row grid, `DIAL` for mode / inst / sc); the host
  and panel pick by the record's `m` (the panel: by `ctx.model` before a record exists); every 808 text and behaviour unchanged.
- The 606's widgets: **FUNCTION** and **CLEAR/RESET** as held states (pointer capture, Enter / Space held; two-finger cancel, lost
  capture and blur release them silently — 7a's CLEAR rule) sending down / up; the step keys send down / up (a second key down in the
  same block while one is held = a chain; **Shift + a key** chains with the mouse; **Alt + a key** = FUNCTION + key) [C];
  **PATTERN GROUP** with its two LEDs; **TAP** at the press (the heard-time fraction, 7a); **RUN/STOP** + the RUN LED; the rotaries
  and the SCALE switch (a vertical switch's up is its first position: 7a review 2 #9 — here SCALE 4 at the top); TEMPO continuous.
  The LED paint once per frame, never off screen (7a).
- `drumHost` unchanged in shape; its `mem` check accepts a 606 record (`Array.isArray(D.keys)` holds); `api.drum` gains `link()` (SYNC
  303s, the host's dep `link303(tr)`), the dep `n303()` and the host method `link303()` (§3.8). **The session follows the
  record's machine** (review #16): `entry()` builds it with `DC.initState(D.m)` (today `DC.initState()`, cv-drum.js:140), the
  fallback `FB` (299) from `ctx.model`, and `changed(tr)` starts a fresh session when the record's `m` is not the session's —
  the undo / redo of an 808 ↔ 606 Replace restores the other record under the same device view without `drumForget` (that runs
  only in `setTrackModel`, main.js:1797), so a 606 session would otherwise drive an 808 record [C].
- **DOM**: the module ≤ **700** elements (the TB-303's is 557) [C].

### 7.5 The extras strip

Full width under the face, caption `XCAPTION_DRUMS` + "Dimmed controls are not emulated" (7a). Row 1: the grid. Row 2: the pads, SYNC,
SWING. Rows 3–4: TUNE · DECAY (the eleven knobs: a models.js knob's extras cell is `XCELL.k` 72 × 64, cv-panel.js:35–36, so 11 ×
72 = 792 px is two rows of 8 + 3 or 6 + 5 in the 592 px inside, not one; the strip has one caption and no row labels — P1 adds a
label cell or leaves the label out). Row 5: → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO · SYNC 303s. P1 lays them within 608 px [C]
(fixed here, review #10).

## 8. Canvas and the Sources tray

1. **Drums view**: lists TR-808 and TR-606 (MODELS order, `DRUMS = m => m.family === 'drums'`: no code change); its `note` →
   "More machines later: TR-909, then the Simmons SDS-V with the pad controller." (cv-tray.js:342).
2. **The tile**: `cv-art` `SIL.tr606 = { body: 'desktop', steps: 16 }` (the TB-303's body family) and `DRAW.tr606` — ours: a silver
   case, six knobs in a row over two bands, the dark lower panel, sixteen grey keys with red LEDs, no text (cv-art.test's rules); meta
   "1981 · drum machine" (7a H2's rule, no maker); the cost label from `COST.synth.tr606`.
3. **Tap / drop / Replace / + Track** as every instrument (7a §8); an 808 ↔ 606 Replace is a model switch (§1.5, §6).
4. **The module**: fixed size from the panel; one `out` jack; a GL face like every hardware face; Hardware only (no Simple layout:
   7a's drum rule covers it).

## 9. Modulation

Every 606 knob — the seven face knobs and the eleven extras — is a **`proc`** destination (`cv-mods.FIELD_CLASS` `drum.<id>` for the
ten new ids; `CLASS_TABLE.tr606` regenerated, `node tools/cv-classes.mjs --write`); no switches, so no `struct` rows. Through the
one-level `drum.<id>` paths, `modSpan` unchanged (7a §9). `dr:` tokens carry `data-nomod`.

## 10. Host wiring (`main.js`; lane H1)

| site | change |
|---|---|
| `drumOf` (145–149) | `DC.normDrum(d.drum, d.model)` |
| `normDevs` (206) | `DC.normDrum(undefined, m.id)` (a drum device loaded without its record; review #4) |
| `setTrackModel` (1797) | `DC.normDrum(undefined, id)` for any drum model; 808 ↔ 606 as a switch away and to (record replaced, session forgotten, payload forced after the patch — the engine keeps it if it overtakes the patch, §1.5); the **303 offer** (§3.8) when a 606 arrives |
| `drumEdit` (3257) | `DC.normDrum(E, instOf(t, dev).model)` (the asset manager's relink of a 606's slot; review #4) |
| `drumPayload` (3211) | the offline session `DC.initState(model)` (a 606 record never meets an 808 session) |
| `DRUM = cvDrum.drumHost(…)` (1889) | dep **`link303(tr)`**: every TB-303 device of the project → `seq.sync = true`, `seqRun` off (`seqToggle(…, false, …, dev)`), swing `4 · (P − 50)` clamped to 0–50; `seqSend` each; an open TB-303 panel repaints its SYNC / Run / SWING; the undo notice restores them; dep **`n303()`** → `{ n, synced }`; `DRUM.link303()` after any 303 SYNC change, 303 added / removed / replaced, undo (§3.8, review #18) |
| `drumToRoll` (3292–3307) | `toNotes(…, { …, prim: DC.primaries(D.map, model) })` instead of `map: D.map` (§4, review #5); the notice already takes the model's short name |
| `importMidiFile` (3889–3906) | unchanged (channel 10 → TR-808); its notice keeps naming the 808 |
| `userSmps` / `states()` / `drumNeeds` (157, 2107, 2338) | unchanged (`DC.SOUNDS` over the record's `smp`: the 606's has only its seven) |
| `__synthTest` | unchanged (`cv.drum`) |

No `t.model` / `t.vals` / `fxOf(t)` in a new line (the accessor ratchet).

## 11. Lanes and the schedule (the leaner shape)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **V6** voices | 0 | `dr-808.js` (§2: the descriptor shell, the lifted helpers, the 606's circuits, `Dr808.gain`), `tests/dr-606.test.mjs` (new), `docs/canvas/research-606-circuits.md` §15 (the component tables) | §12.1; runs `dr-808.test` and `golden-drums` unchanged | **standard** (the stage's hardest code) |
| **S6** sequencer | 0 | `drum-core.js` (§3: `PERS.tr606`, the dispatch, the record, `press`, `measures`, `leds`, `DEMO606`, map, tempo law), `dr-seq.js` (`rst`, `clock`), `tests/drum-core.test.mjs`, `tests/dr-seq.test.mjs` | §12.3, §12.4; runs `golden-drums` | standard |
| **E6** engine + data | 1 (E6a first: `models.js` `tr606` + `FIELD_CLASS` / `CLASS_TABLE` + E6's test rules) | `engine.js` (§1.5), `models.js`, `cv-mods.js` + `tools/cv-classes.mjs` + `tests/cv-mods.test.mjs`, `tests/classic-mod.test.mjs`, `cv-cost.js` + `tests/cv-cost.test.mjs`, `tests/bench-scenarios.mjs` (`drumTrack(…, model)`, the d6 rows) + `tests/bench.json` + `tests/bench.html` (c8), `tests/engine-track.test.mjs` (additions), `tests/golden-606.test.mjs` (new; `ref-7b` frozen by the lead) | §12.2, §12.5 | standard |
| **P1** panel code | 1 (after E6a) | `cv-panel.js` (§7.2–7.3), `cv-drum.js` (§7.4), `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs` (`HW_IDS` + `tr606`, `TARGET.tr606`, `NOKEYS`, the per-model extras list beside the 808's, cv-panel.test.mjs:35), **`tests/classic-panel.test.mjs`** (review #9: its 7a review-2 test, 197–248, hosts `api.drum` only for the 808 and pins every bound vertical switch in `V` — gains `'tr606 dr:sc'` and a 606 record for the 606's panel; its `posOf` reads the 808's `CD.DIAL`, the 606's from `UI.tr606`) | §12.7 | standard |
| **X** satellites | 1 (from P1's first commit, the validator) | `panels/tr606.js` (new), `panels/index.js`, `cv-art.js`, `song.js`, `cv-migrate.js`, `cv-tray.js`, `roll.js`, their tests (`cv-art`, `cv-migrate`, `cv-tray`, `roll`, `canvas-sim` if a label moves), **`tests/canvas-7a-sim.test.mjs:68`** (the Drums view lists `['tr808', 'tr606']`; review #9) | `panel-check tr606`, §12.6's data rows | **cheaper** (layout data from R6 §13's mm; mechanical edits) |
| **H1** host | 2 | `main.js` (§10), `tests/canvas-7b-sim.test.mjs` (new, accessor-free), additions to `tests/main.test.mjs` | §12.6 | standard |
| reviewers × 2 | 3 | (1) **real engine**: golden harness + `main-sim` with the real Track — D1 (ref-7a), D2, D5 incl. the OH cut, D7, every §3.3 row end to end, the 606 + 303 lock, the circuits against R6's numbers; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the face, held FUNCTION / CLEAR and chains by touch, LEDs at the heard time, pads with the AC hold, the grid, the Drums view, the roll's seven rows, SYNC 303s, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

- **Phase 0** (V6 ∥ S6): two files nobody else touches, plus their tests; base = `canvas` at this contract's commit (452f731 + the
  docs). They may start at once. **Phase 1** (E6 → P1 → X; E6a first, P1 and X branch from it): after the user's 7a iPad session
  feedback is in ROADMAP (the every-stage rule) — or at once if the lead judges the feedback cannot touch these files; base = that
  `canvas` + V6 + S6 on the holding branch **`wt-7b`**. **Phase 2** (H1): `wt-7b` after phase 1, the lead's fixture check first (a
  page sim with the real engine: a 606 from the Drums view, its DEMO synced from bar 3 beside a synced 303 — the 606's step posts are
  the plan's, `F` on the 4-frame grid at its ticks' frames). **Phase 3**: the two reviewers → fixers → **one sweep** (every test
  file, one at a time; `golden-*` once) → the lead freezes `tests/ref-7b/` (§12.2) → docs (ROADMAP row 7, HANDOVER, §14) → **one squashed commit
  "7b" on `canvas`** → `tools/deploy-canvas.sh` → the user's iPad session (§12.8).
- **Known windows** on `wt-7b` until the phase-1 merge (merge order E6 → P1 → X): the MODELS-iterating tests owned by P1 / X
  (`cv-panel` `HW_IDS`, `cv-art`, `cv-tray`'s Drums list, `canvas-7a-sim`'s Drums view, `classic-panel`'s vertical-switch list) fail
  on branches without the owner's change; each lane runs its own files.
  `pwa.test`'s precache check until the lead's `node tools/precache.mjs --write` (the new `panels/tr606.js`).
- **Rules for every builder** (7a §11, kept): `git reset --hard <base>` first (harness worktrees start from `main`; check `git log -1`);
  `?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time
  (`node --max-old-space-size=2048 --test tests/<file>.test.mjs`); dense comments in the existing voice; **no Roland material** (D4:
  circuits in our words, schematics read for values only, nothing of the manual's prose, no scans committed); no lane commits `sw.js`;
  commit on the worktree branch; report the commit hash and the gates measured. Briefs: the lane's row, its sections, the base.
- **Interfaces** (each lane stubs the other side): `Dr808.create(inst, 'tr606')` → 7a's machine interface (`set`, `setOS`, `hit`,
  `trig`, `render(buf, N, F0)`, `post`, `live`, `reset`, `mon`, `smp`, `setSalt`), reading `inst.drClock(Fc)` per absolute 4-frame
  chunk (§2.1); `Dr808.gain(kind, drum)`; `Dr808.mach.tr606` (`sids`, V6 ↔ E6). `DrSeq`: `rst` in the payload, `clock(F)` at any frame
  (S6 ↔ E6's `drClock`); the payload's `m` (S6 ↔ E6's `drSeqMsg` / `drPend`). `drum-core`: `normDrum(d, model)` (`model ?? d.m`),
  `compilePlan` / `press` / `leds` / `gridPat` / `stepLen` / `demoFree` / `payload` dispatching on `D.m`, `initState(model)`,
  `PERS.tr606` (lanes, `sids`, codes, names, map, dials), `drumRows(map, model)`, `mapTable` / `primaries(map, model)`, `swing303(P)`
  (S6 ↔ P1 / H1 / X). `api.drum.link()`, the dep `n303()` and `DRUM.link303()` (P1 ↔ H1); `drumRowsOf(dev)` (X ↔ H1, unchanged
  signature).

## 12. Tests and gates

### 12.1 Voices (`tests/dr-606.test.mjs`, V6; each circuit alone through `Dr808.create(…, 'tr606')` at 48 kHz × 4 and 44.1 kHz × 2)

- **Target (a)** per block (R6 §14): the bridged-T resonators (BD × 2, SD, LT, HT at rest), the band-passes, the four Sallen-Key
  high-passes and the rumble low-pass against their analog prototypes — centres ± 1 %, magnitude ± 0.2 dB to 5 kHz at OS 4; the
  envelope time constants (OH natural, CH, E1, the choke drain) ± 2 %.
- **Target (b)**: §2.2's calc numbers — BD 60.0 / 129.4 Hz, SD 204.8 Hz at rest, LT 131.8, HT 206.1, the metal oscillators (periods
  within 0.1 % of 2.07 / RC; duty 47.98 % ± 0.1), the HPF corners — frequencies ± 2 %, ring τ ± 10 %; the output at VOLUME max and the
  levels centred, the demo pattern: peak-to-peak within ± 3 dB of **2 V at ACCENT 0 and 6 V at 10** [R spec].
- **Per circuit**: the SD's pitch kick (the instantaneous frequency in the first 5 ms above the resting 205 Hz, deeper accented); the
  toms bend each other (an HT hit during an LT ring raises the LT's frequency for ≈ the envelope); the rumble on both toms, gated by the
  shared envelope; the CY's two bands (the low band's onset ≈ 70 ms late); **the hat pair**: CH chokes a sounding OH — the depth
  recorded in §14, the gate only "an OH 300 ms after a CH is quieter than a free OH" (review #13: Q25 holds only while C42 —
  τ ≈ 15 ms — keeps its base up, so the R137 drain, τ ≈ 100 ms, may act for tens of ms; C46 / R136's role is open, R6 §14; 7a's
  808 choke met −20 dB, not its −40, for the same reason); OH + CH on one chunk peaks above CH alone (the "accented" closed hat,
  R6 §9); **the tempo cut**: the OH's −30 dB time **non-increasing** from 60 to 120 to 240 BPM and **strictly shorter at 240 than
  at 60** (a stub `inst.drClock`; review #13: R6 §9's estimate puts the onset 1–4 beats after the hit, so at 60 and 120 BPM it may
  fall past the OH's natural −30 dB point and leave equal times), the onset recorded in §14 at 60 / 120 / 240, independent of
  whether the transport plays (only the clock's tempo); C41 emptied by each OH hit; the pulses on the same samples whatever the
  span splits (4, 128, random multiples of 4: §2.1's per-chunk clock).
- **The shared contracts** (7a §12.1): retrigger continues the state; **accent is timbre** where the circuit has a nonlinearity —
  SD, CY, OH, CH (normalised spectral correlation < 0.99) — and **level only** on BD, LT, HT within the rails (the 606's resonators are
  linear and the tom envelope ignores the accent: ratio within 2 % of V_A / V_N) [R calc]; 44.1 vs 48 kHz within 0.5 %; no NaN / Inf /
  subnormal; determinism; span invariance (4, 128, random multiples of 4); order-free latching; no allocation over 200 spans; idle (an
  asleep 606 runs no circuit code, the clock costs a counter); the sleep rule; the sample slots (§5's rules, TUNE / DECAY neutral at
  5); **the extras at 5 = the stock circuit, byte for byte**, and monotone over 0 → 10; the §2.5 level (± 1 dB of the 808's BD).
- **The 808 untouched**: `tests/dr-808.test.mjs` (unchanged file) and `tests/golden-drums.test.mjs` (ref-7a) green after every V6
  commit.

### 12.2 Golden refs (`tests/golden-606.test.mjs`, E6; frozen by the lead)

- **Old sound (D1)**: every golden shard, `canonical-stream`, **`golden-drums` (ref-7a)** — bit-identical.
- **New refs (D2)**: `tests/ref-7b/` = verbatim `dr-808.js`, `dr-seq.js`, `engine.js` + `MANIFEST.json` (ref-7a's format; `PIN` set
  at the freeze; before it, B against itself, said in the header). Cases: every sound × { V_N, V_A at ACCENT 5, 10 } × { the defaults,
  every extra at 0, at 10 }; OH + CH together; a CH choke; the open hat at 60 and 240 BPM (the clock); a 2-pattern chain synced from
  tick 0 and from bar 2 with a loop; STEP RESET; a track with D.C. and a D.S. jump; retrigger trains; OS 2; 44.1 kHz × 1; a sample
  slot. Gate `max |A − B| === 0`.
- **D5 (B only)**: the DEMO chain through the sequencer vs `toNotes` (with the 606's `prim`) of its plan through the song path —
  **bit-identical** over 8 bars at 120 BPM / 48 kHz at swing 50 and 62 %, OH hits included (the clock, §3.5); at 97 BPM every hit on
  the same 4-frame grid point or the next. **Plus one pattern whose open hats ring unchoked for ≥ 4 beats** (an OH on beat 1, no
  CH, no OH for a bar) so the cut itself is crossed by both paths — off-beat OHs (or a CH after each) empty C41 or choke the OH
  every 500 ms, before the cut's onset (review #12).
- **The acid pair (B only, §3.8)**: a synced TB-303 track (its default pattern) and a synced 606 track (its DEMO) rendered from the same
  transport messages (start at bar 3, a seek, a loop wrap) with a hit log of each (the 303's `seqFire` and the 606's `dm.trig`, at
  `T.spanF`, as golden-drums' log): every 606 sixteenth that coincides with a 303 step lands on the same 4-frame grid point or the
  next — straight, and at one swing (the 606 at P %, the 303 at `4 · (P − 50)`) within 0.5 tick + one grid point.

### 12.3 drum-core (`tests/drum-core.test.mjs`, S6)

The 41 tests of 7a unchanged; **pins**: `normDrum(d)` / `normDrum(d, 'tr808')`, `initState()`, an 808 payload and plan byte-identical to
452f731's (a fixture taken before the change). New: `normDrum(·, 'tr606')` (idempotent, bounds, hostile input, the track reach rules,
a continued track's group); `normDrum(d606)` without a model keeps it a 606's, a hostile `m` gives the 808's; `compilePlan` /
`payload` of a 606 record never pass it through the 808's guards (a 606 at 137.5 BPM, keys 13–16, keeps them); the 606 payload's
`m`, `rst` and `bpm` and its `pk` changing with `rst` alone; `primaries(map, 'tr606')` with HT on 45 or 47 keeps HT's primary;
**one test per row of §3.3** through `press` (incl. chains by two held keys and Shift, PATTERN CLEAR of a chain, the wipe at heard
posts, FUNCTION + key LAST STEP, the SCALE latch, the keypad locate / DEL / INS with the markers, BAR RESET, TRACK WRITE's TAP / D.C. /
segno, STEP RESET's counter, D.S.'s swap, the group switch stopped only); `compilePlan` for the 606 (every mode, the scale codes,
chains with mixed lengths, the track pre-roll free, synced anchoring, D.S.'s rotation, mute / solo, the key stable and sensitive);
`leds` (the chase, the beat markers, the bar number code); `toNotes` of a 606 plan; the 606 map (seven sounds, GM numbers);
`tempo606`; `swing303` (`4 · (P − 50)`, clamped); the constants equal `dr-seq.js`'s.

### 12.4 dr-seq (`tests/dr-seq.test.mjs`, S6)

The 18 tests of 7a unchanged (the 808's clock); new: `rst` restarts the playing measure at the next even step (free and synced, at
swing 50 and 62 %: the steps after it on the straight / swung grid as before; a re-anchor after it returns to tick 0; a TAP-fill
request and `rst` together); a 606 plan (scale codes 1–4, a chain of different lengths, a 256-bar track) through the fake Track;
`clock(F)`'s three cases at frames inside a span and ahead of it (free: `pos + F − sF`), the synced-stopped case at the Inst's
`bpm` before any transport, and its continuity across a start / stop; no allocation.

### 12.5 Engine (`tests/engine-track.test.mjs` additions, E6)

A 606 Inst from `{t:'patch'}` and from `processorOptions` (live = offline); **808 → 606 → 808 on one Inst** (each its own machine and a
fresh DrSeq; a payload posted after its patch is kept, **and one posted before it** — the new machine's `m` — waits in `drPend` and
plays; the tail crossing the switch keeps its level through each machine's `gain`); `drClock` on a fresh node before any transport
(the Inst's `bpm`, not `tp.fpt` = 1); a
606 on a graphed node; `warmUp` + `restore` leave a fresh 606; an OS change through `osFade` (no click above −60 dB); a `modRows` row on
`drum.tml` through the real `moRec`; a panic while the toms ring; d6p / d6x / d6m and **d6i** (row p's method) — V8; JSC by the lead.

### 12.6 Host, data, the model-iterating tests (H1, X, E6)

- `canvas-7b-sim` (new, accessor-free): the Drums view lists TR-808 and TR-606, a tap replaces; the face renders with `api.drum`; RUN
  synced starts the project; PATTERN WRITE running: a step key toggles in place; FUNCTION + 7 sets LAST STEP 7; the SCALE latch; a
  chain by two held keys plays first → last; PATTERN PLAY: a key queued to the bar's end; TAP = STEP RESET; TRACK WRITE writes three
  bars by TAP, a D.C., then TRACK PLAY loops them; the LEDs at the heard time; the pads (two fingers; the AC hold → v 127); MIDI 36
  plays the kick; → Piano roll (seven rows, v 100 / 127) and its undo; MAP… (HT moved to 45: → Piano roll keeps HT); a sample in SD,
  then relinked through the asset manager (the record stays a 606's); Save / reload identical; **808 ↔ 606 Replace** and its undo /
  redo twice, plain and graphed, with an FX asset still building so the patch waits (each machine's synced steps play every time:
  §1.5's payload-before-patch; the panel's session follows the record); SYNC 303s switches a free 303 to SYNC (and its swing to `4 · (P − 50)`) with its
  notice's undo; the offer appears once when a 606 arrives beside a free 303; bounce includes a synced 606 with no notes.
- X: `song` (normDev keeps a 606's `drum` through `normDrum(·, 'tr606')`; an 808 record unchanged; export ch 10 for a 606 track),
  `cv-migrate` (schema 9: a schema-9 project read-only in a schema-8 gate; STEPS[8] stores nothing new; the lost-line names the
  model), `cv-tray` (the Drums view lists `['tr808', 'tr606']` — cv-tray.test.mjs:566 pins `['tr808']` today; the note text; no SIMPLE
  badge; Hardware / Simple still the 12), `roll` (a 606's seven rows; an 808's sixteen unchanged).
- **Tests that iterate MODELS** (none weakened): `cv-mods.test` counts (E6: controls + 18, proc + 18, struct unchanged; the 606's
  `drum.<id>` fields; **`machine`** — its "FIELD_CLASS knows every patch field" test parses `class PatchP` and wants every
  `this.<field>` classed, cv-mods.test.mjs:46–63, so `FIELD_CLASS` gains `machine: 'struct'` (a kind boundary, §1.5), never the
  test's SKIP list; review #19); `classic-mod.test` (E6: every 606 knob has its `drum.<id>` target, resolved by the real `moRec`); `cv-cost.test`
  (`COST.synth.tr606`); `cv-art.test` (`SIL` / `DRAW.tr606`); `cv-panel.test` (`HW_IDS` + `tr606`, `TARGET.tr606`, `NOKEYS` +
  `tr606`); `classic-panel.test:93` (renders, one `data-dest` per control) and `golden-graph` / `smpgen` / `integration:656` /
  `cv-shell-sim:257` / `cv-graph.test:20` (cover the 606 through 7a's `family` rules with no edit).

### 12.7 Panel (P1 / X)

`cv-panel.test` + `cv-drum.test`: `TOKENS.tr606` validated (one mutation per rule); `panel-check tr606` clean; rendered with a fake
`api.drum`: 16 keys with `data-lit`, the rotaries' 4 / 8 positions, FUNCTION held + key → `fn` down, `key` down, `key` up, `fn` up in
that order; CLEAR held + a held key; two keys of one block → a chain, of two blocks → two selections; Shift / Alt with the mouse; a
cancelled hold sends no action; without `api.drum` the same nodes, `aria-disabled`; the grid's 8 rows hit-test at 3 zooms; the pads'
AC hold; LEDs ≤ 1 paint a frame; the module ≤ 700 elements; the 808's panel and widgets unchanged (its tests green).

### 12.8 Rendering, UI and the iPad

- Reviewer 2 (CDP): the 606 face GL vs `?nogl` (≥ 99 % within 8 / 255 at k 0.5 and 1); G1 `equalPx` mid-pinch vs rest; the grid canvas
  ≥ 1:1 at rest; FUNCTION + key and two-key chains with two touch points; LED updates ≤ 1 a frame at 300 BPM thirty-seconds.
- **iPad session** (after deploy): `bench.html` five passes → `bench.json` `"ipad7b"` (old rows within 5 % of `ipad7a` — not in
  bench.json at 7788b71: the 7a session's row, if it has been recorded by then — else `ipad2b`,
  d6p / d6x / d6m / d6i ≤ their iPad targets, `stale: false`, the deployed build); hands-on — the Drums view, a 606 beside the TB-303
  (SYNC 303s, the acid pair locked), a pattern written on the face (FUNCTION + key for LAST STEP, a chain, CLEAR held to wipe), a short
  track with TAP and D.C., the pads with the AC hold, the tune / decay knobs, → Piano roll.

## 13. Questions for the user

Only what the user alone can decide; each has the default the build uses until answered.

1. **The acid pair.** The 606 was made to drive the TB-303 with a sync cable. In the app every track already follows one clock, but a
   new TB-303's own sequencer runs on its own clock (its SYNC is off), so a 606 and a 303 side by side drift apart. **Recommended:**
   a **"Sync 303s"** button in the 606's extras strip (it switches your TB-303s to follow the song, matching the 606's swing; one tap
   undoes it), and when you add a 606 next to a free-running 303, a one-time offer to do it. Alternative: leave the 303s alone (you
   turn on their SYNC yourself).
2. **Tune and decay helpers** (the extras strip, starting at the real 606's sound). **Recommended:** TUNE and DECAY for the kick,
   snare, low tom and high tom, and DECAY for the cymbal, the open hat and the closed hat — eleven small knobs, all at 5 = the
   original sound. Alternative: fewer (kick and snare only), or none.
3. **Which 606's cymbal and hats.** Late in production Roland changed one of the six metal oscillators (an octave lower, "for a
   better cymbal"), so early and late 606s sound a little different. **Recommended:** the earlier version, which we expect most 606s
   have (the change came late); the later one could come as an option later.

**Things you will notice (no decision needed)**: the Drums view gains the TR-606; its panel is drawn at real size (the TB-303's size: about half
the 808's module); as on the original, one knob sets both toms and one both hi-hats, there are no tune /
decay knobs on the panel itself, the open hat gets shorter at faster tempos (its circuit is tied to the tempo clock, even when the 606
follows the song), an open and a closed hat on the same step make the original's louder "open + closed" hat, and two tom hits bend each
other's pitch; patterns change at the end of the bar; you chain patterns by holding one step key and pressing another in the same
group of four; CLEAR held while running erases the chosen drum as the pattern passes; FUNCTION + a step key sets the last step;
tracks are written bar by bar with TAP (and D.C. / D.S. as on the original); TAP in pattern play restarts the pattern (STEP RESET) —
here on the next step, so it stays in time; the sync and trigger jacks on the back are printed, not working; its sounds are our model of
its circuits, not recordings.

**And one request**: after the deploy, a 15-minute iPad session — `canvas.domlavin.com/tests/bench.html` (five passes, Copy results)
and the hands-on list of §12.8.

**Answers (the user, 2026-10-20):** all three as recommended — **Q1** yes: the "Sync 303s" button in the 606's extras strip and
the one-time offer when a 606 is added beside a free-running 303 (§3.8); **Q2** the eleven extras knobs — TUNE and DECAY for the
kick, the snare and both toms, DECAY for the cymbal, the open hat and the closed hat — each the original circuit at its centre
(§2.3); **Q3** the earlier metal: R226 = 330 kΩ, oscillator A ≈ 418 Hz (§2.2). Settled; the build's defaults stand.

## 14. Notes (the builders fill in)

(One subsection per lane: as built, the [C] refinements with their reasons, the measured gates — 7a §14's format.)

### Lane S6 (sequencer; phase 0, base 0a05a11)

**Files**: `drum-core.js`, `dr-seq.js`, `tests/drum-core.test.mjs` (41 → 77 tests), `tests/dr-seq.test.mjs` (18 → 25; the fake
Track gains `pbpm` — the Inst's `bpm` getter, engine.js:2716's — and `T.onSpan(F, len)`, called where the Track renders: after
the events, before `pos += len`). Resumed: the stopped run's partial (its drum-core / dr-seq edits and the drum-core tests up to
the 606 property tests) applied cleanly on 0a05a11 and was kept after a row-by-row check against §3; this run fixed a stray
whitespace edit in the 808's `stepLen` line, added the core's half of review #16 (below), the dr-seq tests and these notes.

**Gates** (node 24, one file at a time): drum-core 77/77, dr-seq 25/25, **golden-drums 5/5** (ref-7a bit-identical, D5
identical frames), cv-drum 19/19, roll 48/48, engine-track 45/45, canvas-7a-sim 22/22, classic-panel 13/13, cv-migrate 48/48,
lint 139/139; pwa 21/22 = the known window (sw.js BUILD: the lead's `precache --write`; no sw.js commit). **The 808 pin**: one
SHA-256 over the 808's outputs (records — no model, 'tr808', a hostile `m` — sessions, payloads at every `at`, plans, notes,
the tables, and 66 `press` calls on each of 6 random records with their LEDs and grid) = `04ba14f6…` computed on 0a05a11's module
before any change and unchanged after (the test pins it). Mutations each caught by a test: STEP RESET on any parity; the free
clock ignoring `F`; the synced-stopped clock on `tp.fpt`; a loop wrap dropping the request.

**Interfaces as built** (for E6 / P1 / H1 / X):
- `normDrum(d, model)` (machine = `model ?? d.m`, the 606 only for the exact string 'tr606'); `initState(model)`;
  `compilePlan(mem, ui, x, S)` — a 4th argument, the session: a 606's plan reads `bar`, `twSel` and `ds` (the 808's ignores it;
  no session = the track from its first bar, no D.S.: what → Piano roll wants); `payload(D, S, at)` (+ `m`, `rst`; `bpm` =
  `ui.tempo`; `tap` 0); `press`, `leds` → `{ step[16], run, grp: [I, II] }` (grp code 2 = PATTERN CLEAR's flash),
  `gridPat` (0–31), `stepLen`, `demoFree` (I-1, I-2) dispatch on `D.m`; `mapTable` / `primaries` / `drumRows(map, model)`;
  `track606(D, t)` → `{ start, cap, max, end }`; `tempo606(u)` / `tempo606Pos(bpm)`; `swing303(P)`; `freeBpm(D)`; `PERS.tr606`
  (`lanes codes rows sids mask sounds names laneSound map keys groups patterns steps tracks rtLen trackMax scCode stepT spb swung
  modes scales dials tempo swing cleared choke`; `sounds` / `names` the 16 by sound id) — `PERS.tr808` gains `sids` 0–15 and
  `mask` 0xFFF; constants `LANES606 CODES606 ROWS606 SIDS606 MASK606 M6_TW/TP/PP/PW MODES606 SC_CODE N_PAT6 N_STEP6 N_TRACKS6
  RT6_LEN TRACK6_MAX CLEARED6 TEMPO6_LO/HI MAP606 DEMO606`.
- The 606's `press` inputs: `{k:'key', n, down, shift}`, `{k:'fn', down}`, `{k:'clr', down}`, `tap f`, `start`, `grp`, `mode` /
  `inst` / `sc` v, **`tempo` v in BPM** (the widget maps its travel through `tempo606(u)`: the record holds exact BPM, the
  payload needs no law), **`release`** (a cancelled hold — two-finger cancel, lost capture, blur: every hold let go, nothing
  done), `link303` → the cmd `{ c: 'link303', s: swing303(x.swing) }`, the 808's extras (`sync swing mute solo rec grid pad map
  mapReset smp undo demo`, lanes & 0xE2F, its seven sounds) and host notifications (`transport heard bpm panic`). Alt + a key
  = P1 sends fn down, key down / up, fn up.
- `DrSeq`: `rst` in the payload (like `tap`: the first payload's counter is no request); `clock(F)` → the preallocated
  `{ t, tpf }` (one object per DrSeq: copy before the next call).

**Readings where §3 is silent** [C]:
1. *The record's map* keeps every `SOUNDS` key, the nine the 606 lacks as `[]`, so a reader without the model (main.js:3295's
   `map: D.map` today, a `mapTable(D.map)`) fills none of the 808's defaults in: `primaries(D.map)` = `primaries(D.map,
   'tr606')`. H1's `prim` (review #5) stays right; the record is safe either way.
2. *Defaults*: PATTERN PLAY, instrument BD, group I, pattern 1 alone, SCALE 1, 120 BPM, SYNC on.
3. *Track reach* (`track606`): a track continues into the next region when its region's last bar is written and the next
   track has no D.C. or segno of its own; writing into a later region clears that track's D.C. and segno (`endLater`, the
   808's overflow rule), so a continued track is recognised and a track written the hardware's way (its D.C. set) is never
   swallowed. With no D.C. a track ends at its last written bar inside the regions it covers. After the reach's last TAP the
   pointer sits one past it (TRACK WRITE hears a silent bar; TAP does nothing).
4. *Keypad*: `loc = { h, u }` — keys 11 / 12 set the hundreds, digits roll the last two (1 1 5 → 15; 100 then 1 5 → 115); the
   release locates `start + loc − 1` clamped to the reach (0 → the first bar). DEL / INS in one hold after a typed locate act
   on that bar. DEL of the segno bar leaves the segno on the bar that moves into its place (the track's last: the bar before);
   INS of the D.C. bar moves the D.C. to the copy (the track gains the bar); a full track (its end at the last bar of the
   regions it covers) drops its last bar and keeps its D.C.
5. *PATTERN CLEAR* in either order (keys held then CLEAR, or CLEAR held then a key); the undo is one level (the last).
6. *The wipe* and the step keys edit the pattern heard (in a chain, the one playing); LAST STEP sends 'bar' when it shortens,
   'now' when it lengthens (DrSeq waits for the boundary either way: a new shape).
7. *TRACK WRITE running*: a key (or a chain: two held keys, Shift) is `twSel`, heard from the next bar; TAP writes it (a chain:
   a bar each) and keeps it for the next TAP; with no key TAP rewrites the bar's own pattern and steps on. LEDs: the key heard
   steady, `twSel` flashing.
8. *LEDs beyond §3.6*: running TRACK PLAY = the chase; a stopped track mode = the pointer's key flashing; FUNCTION held in a
   running TRACK WRITE = the pointer's bar number; the bar number's repeated digit (tens = units) steady on even beats,
   flashing on odd ones (stopped: flashing).
9. *Session additions*: `ds` (the D.S. counter: the rotated plan's key carries it, so each TAP re-swaps), `show` ('dc' / 'sg'
   while FUNCTION + CLEAR / PATTERN GROUP is held), `gfl` (the group flash after PATTERN CLEAR, until the next press). Synced,
   `transport` (start, seek, stop) ends the D.S., `twSel`, the arms and the wipe (resending when the D.S. or `twSel` was set);
   free, START / STOP do the same.
10. *A foreign session* (an 808 session under a 606 record, or a 606 session under an 808 record — review #16's undo / redo of
    a Replace) becomes the record's machine's, keeping run / play / pos / bpm: the core's half of #16 (P1's `changed()` still
    starts a fresh one). The 808's `press` gains that one line; the pin is unchanged (no 7a session has `held`).
11. *DEMO* also selects PATTERN PLAY, group I, the chain 1–2, so it plays at once; its undo restores the patterns and the ui.
    I-1 accents 1 5 9 13 16 (the TB-303's default line's accents, classic-panel.js:109–110), I-2 a variation with LT / HT and CY.
12. *STEP RESET* (DrSeq): the restart point is the cursor's next even step of whatever measure (or 808 TAP fill) then plays —
    when the measure ends first, the next one's step 1 is already a start and the request is consumed. A loop wrap keeps a
    pending request (7a review 2 #1's rule for TAP: the restart at the first even step after the wrap); a start, seek, stop,
    power on or sync change drops it (a free STOP leaves it to START, which drops it).
13. *The free clock* reads `sP + (F − sF)`, `sP` = `pos` captured at `events(F)`: §3.5's `pos + F − sF` while the span renders
    (the Track adds to `pos` after it), and still right if read between the Track's `pos += len` and the next `events()`;
    before the first `events()` after a START it reads `pos` (tick 0). Synced and stopped with no `bpm` on the Inst (a
    stand-in): 120 BPM.

### Lane V6 (voices) — `dr-808.js`, `tests/dr-606.test.mjs`, R6 §15 (2026-10-20, base 0a05a11)

**Resumed** from the stopped run's patch (`scratchpad/7b/partial-ab91671c5955e5f52.patch`: the five 606 circuit classes, no
shell, never run) — applied: its approach was sound (the 808's primitives, the single-supply bridged-T, Werner's VCAs on the
606's networks); worked through and corrected below.

**As built.** `Dr808.create(inst, 'tr606', opt)` → 7a's machine interface (`set`, `setOS`, `hit`, `trig`, `render`, `post`,
`live`, `reset`, `mon`, `smp`, `setSalt`), plus `_mach`. **One shell, a descriptor per machine**: `MACH.tr808` (7a's knob table,
sounds, lanes — moved, not changed) and `MACH.tr606` (18 knobs `ac bdl sdl tml cyl hhl vol bdu bdd sdu sdd ltu ltd htu htd
cyd ohd chd`, `sids` [0, 1, 2, 4, 8, 9, 10], lanes & 0xE2F); `create` builds either machine's voices, sources, latches, output
stage and sample rules, the 808's functions verbatim (`sources8`, `apply8`, `post8`, its `readTargets`), the 606's beside them.
**`Dr808.gain(kind, drum)`** (the engine's `drGain`: the 808's arithmetic exactly as engine.js has it; the 606: VOLUME 50 k A
into R191, IC14B's 33 k, `OUT_K6`), **`Dr808.mach[kind]`** `{ KNOB_IDS, KNOB_DEF, SOUNDS (16 by id), sids }`, `proto.tr606`
(the component tables and laws, for the tests); the top-level exports stay the 808's. **The tempo clock**: the shell reads
`inst.drClock(Fc)` → `{ t, tpf }` at each absolute chunk start while the hat circuit is awake after an open-hat hit (a pulse on
the OS sample where `floor(t / 40)` steps; a stand-in Inst without `drClock`: 120 BPM from frame 0); asleep it costs nothing.
`mon()`: `lit` the sounds, `act` in the 808's slots (BD 0, SD 1, LT 2, HT 4, CY 8, OH 9, CH 10). Test options: `noSleep`,
`bankOn`, **`vcaOn`** (new: the metal VCAs' bases held at their peak — the CH's time-constant test). The circuits and every
value: R6 §15.

**[C] refinements of §2 (for the lead):**
- *Reuse at the block level, not by lifting 808 sub-blocks*: the 808's voice classes are untouched (their hot loops are the
  bytes ref-7a pins and the CPU 7a measured); the 606's five classes (`Bd6`, `Sd6`, `Toms6`, `Cy6`, `Hats6` — the tom pair and
  the hat pair one circuit each) call the shared primitives — `Lin`, `skHP`, `bil1` / `bil2` / `kBil`, `bandH` and the bank's
  steady-state tables, the hashed noise, Werner's VCA (`gT`, `vle`, `swing`) with the peak trackers, `Voice`'s sleep rule. The
  606's sub-blocks differ from the 808's in topology (single supply, the transistor kicks in R2, the diode-OR hat VCA), so a
  lifted 808 helper would have been a fork in disguise; no 808 loop became polymorphic (A/B below).
- *The bridged-T* (`btDesign`): the trapezoid in s-form (exact as the shunt leg moves) with the op-amp's single-supply rail as
  a second, saturated network (V− leaves the + input; the rail drives the T); the legs move per chunk (the kick transistors'
  bases change over ms), so it is prewarped at the resting frequency — not plain 2·fs: the kick's top is within 0.1 % at OS 1.
- *The coupling capacitors* (C25, C34, C301, C307): the pulse's mean over a sample (an exact exponential: the edge spikes keep
  their area at every rate), times the + input's share of the divider (0.943; the patch had left it out).
- *The toms*: the rumble's envelope read as C303 through R337 onto C313 (R6 §6's "shared envelope"; the two decay together,
  0.12–0.14 s — R6's 120 ms) and the noise into Q310's base with its corner following r_π; Q310 saturates at the envelope's top,
  so each tom hit carries the stage's switching thump through the rumble's band (≈ 0.5 V on the bus, −11 dB under the LT's
  peak) — **for the lead's ears** (R6 §15.0 records the alternative reading). Their sleep is measured on what reaches the bus
  (C318's recovery through C316 · R340): 1.68 s after a hit.
- *The hats*: C46 / R136 left out (R6 §15.0); C41 is charged only after the open hat's gate (Q23 holds it empty during it);
  their sleep on what Q37 can still swing (the pick-off capacitors' charge is DC).
- *The tempo cut* (P-2 applied: `ohd` scales R167 and R6 together): the pulse 1.25 µs from IC1 / Q2's components, the onset
  3.5 beats at any tempo (R6 §15.0) — so at V_N, 120 BPM, the open hat (−30 dB at 0.84 s) is silent before the cut's onset
  (1.75 s); the gate is measured at v 127 / ACCENT 10, where it shows (review #13's foresight).
- *The output gate*: R6's "2 / 6 Vp-p (accent min / max, VOLUME max, levels centred)" is gated as the **median of the seven
  sounds** (1.57 / 5.71 Vp-p: −2.1 / −0.4 dB) — the d6p pattern measures 5.38 / 13.18 Vp-p (+8.6 / +6.8 dB, the second at the
  rails), because a step sums up to four sounds (BD + CH + accent + CY) through the summing amplifier; a single figure for a
  mixed output can only be a per-sound level. The lead may restate §12.1's line.
- *Samples* (§5): LEVEL the sound's pot (linear B; the pairs' shared ones), the hit's volts with V_N / V_A(10), TUNE ± 1 octave,
  DECAY a fade below 5 (0 → 30 ms), the CH → OH choke as 7a F3 (a CH sample fires the closed side muted while an OH circuit
  can sound); `SMP_LEVEL6` 1.68 (a full-scale sample at LEVEL 10 ≈ the BD's bus peak there). A hit or slot on a sound the 606
  lacks is ignored.
- *Pinned* (R6 §15.0): V_N 4.8 V, the pulse 1 ms, TCK 1.25 µs, R179 immaterial, `OUT_K6` 1.364 (the BD 0.4284 FS, the 808's
  0.4286).

**Not re-read**: the component values are R6's reading — no scan is in the repo or the scratchpad, and fetching one is a
download for the user to approve (R6 §15's note). **For the lead**: one pass over SN6 p5 with R6 §15 beside it.

**Measured** (48 kHz × 4, node 24, M4 Max; every gate of §12.1 in `tests/dr-606.test.mjs`, **25 tests, ≈ 3.2 s**):
- Target (a): the five resonators (BD ×2, SD, LT, HT) by `btDesign` against `1 + g s / (s² + 2ps + pg)`, the SK high-passes
  (SD Q32, CY Q40), the trapezoidal networks (IC12B, IC12A, the rumble's band, the voices' sums), the noise pole (7234 Hz) and
  the rumble's 273 Hz low-pass (to 2 kHz at the base rate): within 0.2 dB to 5 kHz, peaks within 1 %. Time constants: OH C45 ·
  R167 at DECAY 0 / 5 / 10, E1 at DECAY 0 / 5 / 10, the choke's drain **89.7 ms** (R137 ∥ R167 ∥ Q36: 90.1), the CH's C42 with
  Q37 held on (its apparent τ 2–12 ms after the gate, towards the VCA's lower edge) 21.5 ms against the same network integrated
  finely, 21.6 — all within 2 %.
- Target (b): BD **59.85 / 128.3 Hz** (60.0 / 129.4), SD **204.7** (204.8), LT **131.8**, HT **206.1**; rings 37.7 / 9.0, 22.3,
  53.6, 35.8 ms (38.1 / 8.4, 22.1, 54.0, 36.7: within 10 %); the metal periods within 0.1 % of 2.07 / RC (A 418 Hz), duty
  47.98 %, the bands 3454 / 7117; output Vp-p (VOLUME 10, levels 5) V_N: BD 1.57, SD 2.89, LT 3.86, HT 1.55, CY 2.34, OH 1.35,
  CH 1.49; V_A(10): 3.60, 7.37, 5.71, 4.12, 10.22, 6.64, 5.61.
- Per circuit: the SD's kick 364 Hz in 1–5 ms, 204 Hz by 40 ms, 5–20 ms 295 → 308 Hz accented; an HT hit at 150 ms moves the
  ringing LT 131 → 248 Hz; the rumble the same bytes for an LT hit and an accented HT hit, −23 dB from 60–200 to 450–550 ms;
  the CY's C47 peaks at the gate, C61 at 150 ms (63 % at 38 ms); **the choke: a sounding OH −18.3 dB 50 ms and −51.5 dB 100 ms
  after a CH** (Q25 holds ≈ 0.2 s: deep, unlike the 808's −20 dB), an OH 300 ms after a CH 0.0 dB; OH + CH on one step **+6.0
  dB** over CH alone; **the cut**: the OH's −30 dB (v 127, ACCENT 10) **1.656 s at 60 BPM, 1.622 at 120, 1.121 at 240** (no
  clock 1.656); onsets (C41 at 0.5 V) past 3.5 s / 1.75 s / 0.86 s; the same with the song playing (a tick offset) within one
  pulse; a second OH 1 s in cuts as the first.
- Contracts: accent timbre (spectral correlation) SD 0.840, CY 0.870, OH 0.938, CH 0.933; level only (ACCENT 5) BD, LT, HT ×1.3710
  (V_A / V_N 1.3710); 44.1 × 2 vs 48 × 4 within 0.5 %; no NaN / Inf / subnormal (every knob at 0 and at 10, OS 4 and 1); the
  bytes deterministic, span-invariant (4 / 128 / random, the clock's pulses included, OS 1 at 44.1 kHz), order-free (a step
  mask = its hits; the 808's lanes and sounds the 606 lacks ignored); no allocation over 200 spans with the clock; an asleep
  machine runs no circuit and reads no clock; time to sleep (ms, V_N / V_A 10): BD 344 / 403, SD 384 / 421, toms 1677, CY 1704 /
  3523, OH 1637 / 1965, CH 251 / 277; the extras at 5 = the stock circuit byte for byte (and the designs equal the components'),
  TUNE ± 1 octave and DECAY monotone over 0 → 10; §2.5 the BD **0.4284 FS** (the 808's 0.4286).
- **The 808 untouched**: `golden-drums` (ref-7a) 5/5 and `dr-808.test` 25/25 after every step. Its machine CPU A/B (base 0a05a11
  vs this, and this after the 606 has run in the same scope; medians of 7, three repeats): d8p, d8x, d8m within ± 2–5 % run to
  run, no systematic change.
- **CPU** (the machine alone, node, OS 4; 20 s each, retriggered every 100 ms at v 127): BD 0.0016, SD 0.0027, the tom pair
  0.0025, CY 0.0056 (both bands included), OH 0.0043 / CH 0.0034 (the high band included) — every circuit ≤ 0.004 on top of the
  bank; the patterns (best of 3): **d6p 0.0104**, d6x 0.0122, d6m 0.0080 — gated against §2.6's rows (the bench rows add the
  decimators and the Track: E6's); a silent machine 0.0004 (its output stage every span; gated ≤ 0.001 — d6i proper is E6's:
  the Inst past its quiet window never calls the machine). One-off costs (for E6's warm-up and the iPad's
  first context): the first 606 `create` in a scope ≈ 6 ms (the junction tables), later ≈ 1 ms; `setOS` ≈ 0.7 ms; **a metal
  voice waking the bank** re-runs the trackers' pre-roll — 0.16 ms (the high band) / 0.32 ms (both) warm, ≈ 2.4 ms cold (the
  high band's 1 µF coupling: a 64 ms window, 7a's was 3.6 ms) — the warm-up round should wake both bands once.
- **Listening renders** (for the lead): `scratchpad/7b/v6-wavs/` — every sound normal (v 100, ACCENT 5) and accented (v 127,
  ACCENT 10), a 2-bar pattern at ACCENT 5 and 10, the open hat at 60 / 240 BPM (the cut), OH + CH on one step, the choke, an LT
  bent by an HT, the extras at their ends (BD TUNE 0, TUNE + DECAY 10, SD DECAY 0 / 10); 48 kHz 16-bit, the bus decimated by a
  windowed sinc then `post()`, normalised only where a file would clip (said in the list). Script: `scratchpad/v6/wavs.cjs`.

### Lane P1 (panel code: `cv-panel.js`, `cv-drum.js`, `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs`, `tests/classic-panel.test.mjs`)

**P1a (the validator, the geometry, panel-check; lane X's base)**, on E6a 45caf89. Readings where §7 left a detail open [C]:
- `TOKENS.tr606`: §7.2's table — face `dr:mode` rotary, `dr:inst` rotary, `dr:tempo` knob, `dr:sc` switch, `dr:start`,
  `dr:clear`, `dr:fn`, `dr:grp`, `dr:tap` buttons, `dr:runLed`, `dr:grpI`, `dr:grpII` LEDs, `dr:step` (multi, n 1–16, all
  present, its LED shown); extras the 808's nine + `dr:link`; `pos` MODE 4, INSTRUMENT 8, SCALE 4. The 808's tokens are not
  the 606's and back (`dr:fill`, `dr:pre`, `dr:part1` … on a 606, `dr:fn`, `dr:sc`, `dr:link` … on an 808: "not a control of
  the model"). `RENDERED_TOKENS` has every one from P1a on (phase 2 builds their widgets), so a valid 606 layout is `usable()`.
- **New table fields** (generic, per model): `orient` — a switch token's required orientation (`dr:sc: 'v'`: its `orient`,
  else taller than wide; "dr:sc is a vertical switch (orient v)"); `cells` — the model's own extras cells over `TOK_CELL`
  (the 606's grid **592 × 192** = `DR6_GRID`, pads **232 × 116** = `DR6_PADS`); `xbreak` — its own row breaks over the global
  `XBREAK` (`['dr:grid', 'dr:swing', 'htd', 'chd']`). `TOK_CELL` gains `dr:link` 128 × 64; `tokCell(model, id)` /
  `xbreakOf(model)` exported (panel-check reads them; cv-drum keeps its own copy of the sizes, as 7a's `GRID` / `PADS`).
- **The extras rows** (§7.5), with `extras.ids` in this order — `dr:grid dr:pads dr:sync dr:swing bdu bdd sdu sdd ltu ltd
  htu htd cyd ohd chd dr:toRoll dr:rec dr:map dr:sounds dr:demo dr:link`: the grid (592) · the pads, SYNC, SWING (432) ·
  TUNE / DECAY **8 + 3** (the four drums' pairs, then the metal's three decays: 576 / 216) · → PIANO ROLL, REC, MAP…,
  SOUNDS…, DEMO, SYNC 303s (592 exactly). No row label cell: each knob carries its own ("BD Tune" …). The strip is 16 + 192 +
  116 + 3 × 64 + 8 = **524 px**; a 300 mm face is **608** wide (`ceil32(600)`, offX 4), and with the face at 143, 145.5 or
  146 mm the module is **608 × 864** (`TARGET.tr606`).
- **`rot`** (new, any rotary): the sweep's centre in degrees clockwise from 12 o'clock (−180…180; default 0 = today's art
  byte for byte — checked on all 13 authored panels: art, geometry and problems identical to 45caf89). The art's detent
  ticks / scale / an inert rotary's pointer and the widgets (cv-panel's `hwRotary`; cv-drum's rotary in phase 2) turn by it:
  the 606's MODE detents sit at +37° … +127° (R6 §13) = `sweep: 90, rot: 82`. A rotary token's legends may be empty strings
  (the tick only) when the print is decor (MODE's bracketed TB-303 legends).
- cv-panel's `drp()` passes `model: model.id` in cv-drum's ctx (phase 2: a stub-hosted 606 builds the 606's widgets).
- `panel-check`: loads an unlisted `panels/tr606.js` directly (7a's path); prints a switch token's orientation (and the
  required one), a rotary's sweep and `rot`, and the extras rows with the model's breaks.
- **For lane X — the hit rule vs the hardware**: the step keys' 13.55 mm pitch (R6 §13) is under the 14 mm hit rule (the
  validator says "hit boxes overlap"); the fixture spaces the caps **14 mm** apart round the row's centre (centres 53.25 + 14 (k
  − 1): ≤ 3.4 mm at the ends; the printed key cells / scale graphic may keep 13.55) and moves FUNCTION 2.8 mm left (x 39.2,
  hit [14, 15]) so its hit box clears key 1's. The fixture (tests/cv-drum.test.mjs `TR6_FX`) validates with every other R6
  §13 position as measured.
- Tests: `cv-drum.test` 19 → 23 (the tokens, one mutation per rule, the geometry, MODE's dial), `cv-panel.test` 80 → 81 (a
  rotary's `rot`) with `HW_IDS` + `tr606`, `EXTRAS.tr606`, `TARGET.tr606` 608 × 864, `NOKEYS` + `tr606`: 80 / 81 — the
  `HW_IDS` pin is the known window until lane X lists `tr606` in `panels/index.js` (checked with the fixture as a scratch
  `panels/tr606.js` listed there: 85 / 85, the four per-model tests pass; classic-panel's vertical-switch test then fails
  until phase 2 hosts the 606's SCALE, review #9). `lint` 139 / 139, `classic-panel` 13 / 13, `cv-face` 26 / 26. Each new
  rule's mutation caught (the orientation rule off; the per-model breaks off).

**P1 phase 2 (the 606's widgets, `cv-drum.js`; on P1a).** Every 808 widget, text and behaviour unchanged (its 23 cv-drum
tests and classic-panel's as they were; the grid / pads / menus made machine-generic with the 808's output term for term).
Readings [C]:
- **Tables**: `UI.tr808` (7a's `LANE_CODE` / `LANE_ALT` / `PAD_ORDER` / `GRID` / `PADS` / `DIAL`, still exported) and `UI.tr606`
  (`CODES606` on `LANES606`, `PAD6` = CY OH CH AC / BD SD LT HT, `GRID6` = cv-panel `DR6_GRID`, `PADS6` 4 × 52 / 2 × 54 + 8 gaps
  = `DR6_PADS`, `DIAL6`: MODE 4 (default PATTERN PLAY), TRACK / INSTRUMENT 8 (value text "Track n" in the track modes, else
  drum-core's `ROWS606`), **SCALE: position = 4 − sc** (the top is SCALE 4; drag / ArrowUp / PageUp towards it, 7a review 2
  #9)); `machOf(model | record)`, `gridAt606(x, y)` → `{ lane, row, s }`. The panel picks by `ctx.model`; `st()` shows the
  panel's machine's defaults (`normDrum(undefined, M)`, `initState(M)`) when the host has no record **or a record of the
  other machine** (an 808 ↔ 606 Replace undone before main re-renders the view: nothing reads the wrong shape).
- **Held states** (one panel-local table `H6`: FUNCTION by its key or by Alt, CLEAR, the step keys by pointer id / 'kb'):
  FUNCTION / CLEAR send `{ k: 'fn' | 'clr', down }` at the press and the release (pointer capture; Enter / Space held); the step
  keys send `{ k: 'key', n, down: true, shift }` at the press (the hardware acts there) and `{ k: 'key', n, down: false }` at
  the release — two keys held in a block is drum-core's chain, Shift its mouse form. **Alt + a key** = FUNCTION down before the
  key, held **while Alt is** (up at Alt's keyup on the document, or at a key's release without Alt), so a mouse can type a
  multi-digit bar (Alt + 1, 1, 5) as the keypad wants. **A cancel** (pointercancel, a capture lost before its up, a keyboard
  hold blurred, the host's release-all, destroy) lets go of every hold with one `{ k: 'release' }` (nothing done: no locate,
  no LAST STEP); a stale up after it posts nothing.
- RUN/STOP and PATTERN GROUP act at the press (pointer / Enter / Space down), TAP as the 808's (the heard-time fraction, now
  from the machine's own BPM: the host's `frac` reads `DC.freeBpm`); PATTERN GROUP's label names the shown group; the RUN
  LED and the group LEDs (`leds().run`, `.grp`; code 2 = PATTERN CLEAR's flash, a CSS animation as the keys'); TEMPO
  continuous on drum-core's log law (`tempo606` / `tempo606Pos`, aria in BPM 40–300; synced: the project's tempo, one gesture
  = move … end). The MODE rotary turns by its layout `rot`.
- **Extras**: the grid's 8 rows on their lane bits (header mute / solo per lane bit; the cells past LAST STEP dimmed;
  corner label "I-3"); the pads 2 × 4 — **AC is a hold**: no note, every hit while it is held at v 1 (127), Space / Enter hold
  it too; MAP… / SOUNDS… list the seven sounds; texts name the 606 (RUN/STOP, PATTERN WRITE, I-1 / I-2); **SYNC 303s**
  (`dr:link`): hidden with no TB-303 (`n303()` → n 0), "Sync 303s" when one is free, "303s synced" (aria-disabled, out of
  the Tab order) when all are; a tap → `api.drum.link()` → drum-core's `{ c: 'link303', s }` → the host's `link303(tr, s)`; the
  host method `link303()` repaints. The loop hint has the 606's texts (track / chain) and sits above DEMO (row 4's free room:
  DEMO's right neighbour is SYNC 303s).
- **Host** (review #16): a new entry's session is `initState(D.m)`; `changed(tr)` starts a fresh session (transport and
  tempo as now, queues cleared) when the record's machine is not the session's; the demo's confirm names I-1 / I-2.
- **For lane H1**: deps `link303(tr, s)` (s = `swing303` of the 606's swing, ready to write) and `n303()` → `{ n, synced }`;
  call `DRUM.link303()` whenever a 303's SYNC or the project's 303s change.
- **The DOM budget (§7.4, ≤ 700)** — measured in Chrome on the real ClassicPanel: the live layer is **408** elements, of which
  the eleven TUNE / DECAY knobs (today's extras knob: tick ring and shine, 21 each) are **231**; the step keys 48, the face
  knobs 7 each, the pads 10, the grid 3. So **X's face SVG must stay ≤ 292 elements** (the TB-303's whole face is 249). If it
  cannot, the cheap fix is a one-line cv-panel change: the 606's extras knobs built as hardware knobs (`hw`: no tick ring /
  shine, 21 → 7 each, −154) — a look call for the lead (other models' extras knobs keep theirs).
- **Headless Chrome** (`--headless=new --use-angle=metal`, dpr 2; the real ClassicPanel → cv-panel → cv-drum over a stub host:
  a 606 record, a fake transport, a 200 ms-latency audio clock, a fake sequencer posting a sixteenth every 125 ms, the
  monitor on every note; the fixture face as a scratch `panels/tr606.js`; `scratchpad/p1/`): 1440 × 900, 1366 × 1024, 1024
  × 1366 looked at (screenshots); two fingers FUNCTION + key 7 → fn down, key down, key up, fn up and LAST STEP 7 (and
  FUNCTION lifted first: fn up, then key up, LAST STEP set at the key's press); key 3 held + CLEAR → PATTERN CLEAR of I-3;
  keys 5 + 7 → the chain 5–7, 4 + 6 → 6 alone; a touchCancel of FUNCTION with 5 typed → `release`, no locate; two fingers on
  two pads → two notes and two offs, AC held + the kick at its back edge → v 1; Shift-click → the chain 9–11; Alt + key 12
  (Alt up after) → fn down, key down / up, fn up, LAST STEP 12; running synced (the demo) every post shown 4.6–16.2 ms ahead of
  its heard frame (one frame's lead), 8 paints in 61 frames, one key lit, the RUN LED lit; SYNC 303s shown, a click →
  `link303 0`; no console error or exception; destroy clean.
- Tests: `cv-drum.test` 23 → **31** (the host's session per machine, TAP at the 606's BPM, SYNC 303s; the render with
  `api.drum`; FUNCTION / CLEAR / chains / Shift / Alt / the keyboard; cancels → release, destroy → release; the grid at 3
  zooms; the pads' AC hold; the LEDs at the heard time ≤ 1 paint a frame; no host: the same nodes, aria-disabled, a record of
  the other machine under each panel); `classic-panel.test` (review #9): its vertical-switch test hosts the 606 with its own
  record and reads `UI.tr606`'s dials — `V` gains `'tr606 dr:sc'`: 12 / 13 until X lists `tr606` (13 / 13 with the fixture
  as a scratch `panels/tr606.js`). Gates (node 24, one file at a time): cv-drum 31 / 31, cv-panel 80 / 81 (the `HW_IDS`
  window; 85 / 85 with the scratch layout), classic-panel 12 / 13 (the window; 13 / 13 with it), lint 139 / 139, main 41 / 41,
  canvas-7a-sim 3 / 22 = its line-68 window (X's: the first test's Drums view lists the 606, the rest build on it) — **22 / 22**
  with that line changed to `['tr808', 'tr606']` (a scratch edit, reverted).

### Lane X (satellites: `panels/tr606.js`, `panels/index.js`, `cv-art.js`, `song.js`, `cv-migrate.js`, `cv-tray.js`, `roll.js` + their tests; base f17f026)

**Commits** (on the worktree branch): 75601c9 + 153a4b4 the panel, 348ae19 the tile, 96484a0 schema 9 + song, 00b1ebf the Drums view, 0de4004 the roll; this note. No `sw.js`.

**The panel** (`panels/tr606.js`, 185 decor items, 32 live controls + 3 LEDs; P1a's hand-off followed exactly). `panel-check tr606`: **valid, 608 × 864** (body 608 × 824, content 600 × 292 at x 4; the 146 mm face — 143 gives the same module), live 32 · displays 3 · inert 0 · extras 21 in the contract's order, tokens 13 of 13 + 10 of 10, **smallest hit box dr:sc 28 × 32 px, no overlaps**. The checker SVG (outlines + dashed hit boxes) is `scratchpad/x606/tr606.svg`; a mock of the face with approximate caps and knobs (decor SVG + drawn controls, `scratchpad/x606/mock.png`, crops cropL / cropR / cropB) was read at 1:1 and 4:1 — nothing overlaps, every legend clear of its tick and number.
- *Tokens*: `dr:mode` rotary (`sweep 90, rot 82`, four empty legends: the ticks are the detent dots, the bracketed TRACK WRITE / PLAY · PATTERN PLAY / WRITE print is decor, the TB-303's MODE print positioned from the ticks' own end points), `dr:inst` rotary (`sweep 210`, legends AC BD SD LT HT CY OH CH printed by the renderer; the track numbers 1–8 in black squares are decor at r = d/2 + 8.2, the name plate "TRACK INSTRUMENT" above them), `dr:tempo` knob (d 24, sweep 270, a decor scale ring Ø 31 mm + SLOW / FAST as the 303's), `dr:sc` (vertical, orient v, hit [14, 16], legends 4 3 2 1 from the top; the stops' numbers and slanted leaders to the scale rows are decor), `dr:start` / `dr:clear` / `dr:fn` / `dr:grp` / `dr:tap` buttons (`led: 'none'`), `dr:runLed` / `dr:grpI` / `dr:grpII` LEDs (d 3), the 16 `dr:step` caps (5.4 × 12.2 mm, `led: 'above'`, hit [14, 15]), the face knobs `ac bdl sdl tml cyl hhl` (d 17, sweep 270, scale n 11: ring Ø 18–21 mm) and `vol` (d 23, a decor scale d 27 as the 303's), no 808 token.
- *Nudges for the 14 mm hit rule* (recorded in the file's `notes`): the step caps stand at x 53.25 + 14 (k − 1), the hardware's 56.6 + 13.55 (k − 1): **−3.35 mm at key 1, +3.4 at key 16** (0.2 at the middle), every cap still inside its printed cell (13.55 mm; the strip, the LAST STEP and BAR numbers and the scale graphic keep the hardware's cells — the offset is visible at the ends only); FUNCTION at x 39.2 (hardware 42: −2.8 mm, hit [14, 15]); SCALE hit [14, 16] at the hardware's x 42.5 / y 88.5. Nothing else moved.
- *Art* (original; the TB-303's silver + near-black family): the scale graphic is **path glyphs, no font** — beamed eighth notes under slurs in threes (scale 3) and sixes (scale 4), a quarter note over each group of eight (scale 2) and of four (scale 1) with a dot at every other key; the LAST STEP numbers in orange-red, the BAR boxes (1–9 0 100 200 / / DEL INS) white on black; the segno sign is the 303's path; rear legends (RUN/STOP, INPUT ▲ OUTPUT, SYNC, TRIGGER OUT LT / HT, HEADPHONE, OUTPUT, DC 9V) print only — **no inert control of any kind, so the extras strip carries no "not emulated" note**; the maker-mark and wordmark zones stay empty; the model name is "TR-606" + "Computer Controlled" in the centre of band B, nothing else says it (no title, tip or label). Key caps: light grey (`#c9cbc8`) on the dark panel, `#a7a9a7` on the light strip (`#d9dad7`): [est.] — the photographs run light grey to greige.
- *Sections* (the Tab order reads top-down, left-right): `levels` (the six knobs) · `mid` (TEMPO, TRACK / INSTRUMENT, MODE, VOLUME) · `run` (CLEAR/RESET, RUN LED, RUN/STOP) · `scale` (SCALE, FUNCTION) · `keys` (1–16) · `group` (the two group LEDs, PATTERN GROUP, TAP) — checker order confirmed.

**Sources tile** (`cv-art`): `SIL.tr606 = { body: 'desktop', steps: 16 }`, `DRAW.tr606` — the 303's silver case, six dark knobs in a row (the skirt `#2a2c2d`, r 2.5), TEMPO / two selectors / VOLUME with a name rule (no text), a dark programming panel: four scale rows, sixteen LEDs (every fourth accent) over sixteen `#a7a9a7` keys on a light strip, a red LAST STEP rule, the CLEAR / RUN / FUNCTION / group / TAP keys. Chip (28 × 18): the knob band, the dark panel, the key strip, a run pad and an accent block. cv-art 4 / 4 (a new block pins the six knobs, sixteen keys, sixteen LEDs, the chip, `data-art`).

**Schema 9** (`cv-migrate`): `SCHEMA = 9`, `STEPS[8]` additive (nothing stored: an 8 opens as a 9; a 9 is read-only in a schema-8 build through the store's gate; `upgrade({ schema: 10 })` read-only). **The lost line names each drum model** (`toV1`): "TR-606 track “Drums”: …" / "TR-606 tracks “A”, “B”: … their …", one line per model in the order the tracks first appear (an 808-only project: the 7a line byte for byte). `song.normDev`: `normDrum(d.drum, o.model)` (a 606 device always ends with a 606 record — a hostile or 808 record under it is re-normalised as a 606's; an 808 device is the 808's; a 606 record under an 808 model is the 808's: the model wins, as §3.1). Export: a 606 track goes out on channel 10 with no change (`isDrum` is by `PERS`); a channel-10 import is a TR-808 track (§4) and its `inst` meta keeps the exporter's name ("tr606"). 7a's two pins moved with the schema (the constants test `8 → 9`; the 7a schema test now says "through 8 and 9" and saves its read-only seed from `STEPS[7]`), none weakened. cv-migrate 48 → 52 tests.

**Drums view** (`cv-tray`): the lists follow `DRUMS` (no code change but the note → "More machines later: TR-909, then the Simmons SDS-V with the pad controller."); cv-tray's Drums test now pins `['tr808', 'tr606']`, the 606 tile (its art, "1981 · drum machine", no SIMPLE badge, no aria text, no maker word) and both taps; `canvas-7a-sim.test.mjs:68` pins `['tr808', 'tr606']` (review #9).

**Roll** (`roll.js`): `drumRowsOf(dev)` = `drumRows(map, dev.model)` — a 606's seven rows (Kick 36, Snare 38, Low tom 41, Hi tom 48, Cymbal 49, Open hat 46, Closed hat 42; "Other" + seven = 8 rows), the 808's sixteen unchanged; an 808's sixteen-sound map on a 606 device gives no 808-only sound a row. roll.test 48 → 50 (the helper `mkDrum` takes `model`). A reading for P1 / H1: `normMap` gives a key to one sound only (the first in sound order), so a MAP… edit that moves HT onto 45 must take 45 off the low tom (`lt: [41, 43, 45]`), or the HT keeps its old primary — the roll test builds its map that way.

**Gates** (node 24, one file at a time): `panel-check tr606` valid · 608 × 864 · no overlaps; `cv-panel` **85 / 85** (with `tr606` listed: the `HW_IDS` pin passes, the four per-model tests pass), `cv-art` 4 / 4, `cv-tray` 31 / 31, `cv-migrate` 52 / 52, `roll` 50 / 50, `canvas-sim` 22 / 22, `canvas-7a-sim` 22 / 22, `lint` 141 / 141, `golden-drums` 5 / 5 (ref-7a bit-identical), plus (informational) `cv-drum` 23 / 23, `cv-face` 26 / 26, `cv-shell-sim` 16 / 16, `cv-module` 57 / 57. **Known window**: `classic-panel`'s 7a review-2 vertical-switch test fails (12 / 13) until P1's phase 2 hosts the 606's SCALE (`'tr606 dr:sc'` in its `V` list); `pwa` until the lead's `node tools/precache.mjs --write` (the new `panels/tr606.js`). Cosmetic, not mine: `canvas-7a-sim.test.mjs:328`'s assert message still says "schema 8" (it compares to `CM.SCHEMA`).

### Lane E6 (engine + data; phase 1, base e96ddf9)

**Commits**: E6a 45caf89 (`models.js` `tr606`, `FIELD_CLASS` / `CLASS_TABLE`, the test rules, a provisional cost, the d6
targets); E6b-1 eed75ab (engine §1.5, the warm-up round, ten engine-track tests); E6b-2 b470b7e (the bench rows, `c8`, cv-cost
from d6p); E6b-3 44607b8 (bench track rows' transport, a failing test first); E6b-4 d0cf248 (`golden-606`); E6b-5 these notes.

**As built** [C]:
- *models.js*: sections Accent / Level / Volume / Tune · Decay, `K6_IDS`' order and defaults; labels — face "Bass Drum" …
  "L.H. Tom", "O.C. Hihat", "Volume", extras "BD Tune" … "CH Decay" (self-describing: an extras cell shows `mc.label` alone,
  the strip has no row labels); theme the TB-303's (`knob: 'tb'`, panel `#c6c8c7`); presets as §2.5. `CLASS_TABLE` 471 controls
  (proc 78); `FIELD_CLASS` the ten new `drum.<id>` proc and `machine` struct.
- *engine.js*: `PatchP.machine`; `DrumP` + the ten ids (one shape for both machines). One machine per kind per Inst: records
  `dmL` `{ id, dm, os, v }`, built on first use and kept (`dm` / `dmOS` / `dmV` the current one's, `dmR` its record); a cached
  one catches up with the Inst's OS at its `drOn`; `setSalt` / `restore` reach every one. A machine `create` refuses (an
  unknown `machine`): `dm` null, `drumsErr` once, silent. The boundary `mch` in `setPatch` — `rebuild` and the `drOn` guard
  both. `drSeqMsg`: a payload whose `m` (absent = 'tr808') is not the patch's machine waits in `drPend` (`drPendM` its
  machine); a payload for another machine than the waiting one replaces it with a fresh DrSeq (not `set` onto it: its TAP /
  `rst` counters start over); `drOn` adopts it only for its own machine. `drGain` → `Dr808.gain(p.machine, p.drum)`.
  `drClock(F)`: the DrSeq's `clock(F)` while the kind is 'drums' and it has one; else the song's ticks while the transport
  plays (`tickAt`'s expression); else `F` at the Inst's `bpm` through DrSeq's `fptOf` law (clamped 20–400) — one object.
- *the warm-up*: the 606 round after the 808's — two panels with every extra off 5, its seven sounds plain then accented (a
  retrigger), OH + CH in one chunk, the choke, a free plan with STEP RESET at 173 and 292 BPM (the clock through
  `DrSeq.clock`), an OS change, an open hat on a stand-in song clock (2.03 frames a tick, 24 quanta: C41's pulses, Q24's
  drain); the cymbal before it wakes both bands (the cold pre-roll paid here). Node: `warmDrums` 68 → 109 ms (268 quanta); the
  scope's whole warm-up 572–578 ms with the round, 582–585 without (inside the run-to-run noise). The iPad's first-context
  time: the lead's session.
- *bench*: `drumTrack(rows, vals, samples, model)` — the 606 as pattern I-1 in PATTERN PLAY (16 steps), `rows 'demo'` its DEMO
  through `press`; d6p as §2.6 (LT / HT one a half; CY accented on step 1, so it never sleeps inside the bar: both 1 s halves
  keep its circuit awake). `measure()`'s track rows now start the transport's tick 0 at the row's first frame (`nowF`): d6m
  (CY + OH every 500 ms) timed silence in bench.test's 50 ms runs once the scope's frame had moved on (the 808's rows were
  lucky). `bench.html` c8: the 606's DEMO (I-1 → I-2) synced.
- *cv-cost*: `tr606: C('d6p', 'drums', 1, 0.0143, 0.0030)` = 0.0173 (the gate's d6p).

**Seen, not fixed** (for the lead):
1. *A new drum machine starts unsalted* (7a's behaviour, kept: D1): a graph Inst's salt arrives before its first drums patch
   and `setSalt` returns when the salt is unchanged, so a machine built later never takes it — two drum machines on one graph
   node share their noise. A fix (`setSalt` at `create`) changes only salted graph Insts' bytes (no ref-7a case).
2. *A tail entering a machine dips for ≈ 4 samples* (`dr-808.js`; analog → 808 since 7a, 808 ↔ 606 now): `post` starts its
   220 p low-passes from rest after `reset()`, so the first samples of a de-click tail lose about two thirds and ring (808 →
   606: second difference −8.4 dB over the first 8 samples, then −76.5 dB). Settling those states on the first input after a
   reset is byte-identical for every ref-7a case (they start from silence). The engine's part (the gains) holds: the level at
   sample 8 is 0.97 (808 → 606) and 0.85 (606 → 808, a 132 Hz tom moving) of the last sample before.
3. *The tail passes the new machine's stage, rails included*: the 606's IC14A clips at −6 / +7.5 V before VOLUME, so a tail
   above 6 V × its gain (2.6 FS at its default VOLUME, 0.35 FS at 3) is clipped there, as that stage would.

**Measured** (node 24, M4 Max; one file at a time):
- Bench rows (cpu-gate, calibrated; two runs): **d6p 0.0173 / 0.0169** (0.025), **d6x 0.0192 / 0.0186** (0.06), **d6m 0.0137 /
  0.0134** (0.025), **d6i 0.00018 / 0.00017** (0.0005); the 808's in the same runs d8p 0.0197 / 0.0203, d8x 0.0361 / 0.0368,
  d8m 0.0166 / 0.0169, d8s 0.0058 / 0.0060, d8i 0.0002 (7a: 0.0193 / 0.036 / 0.017 / 0.0058 / 0.0002). `measure()` (median of 5
  × 1 s, uncalibrated): d6p 0.0152–0.0165 beside d8p 0.0177–0.0183; c8 0.015–0.020.
- V8 A/B (e96ddf9's engine.js vs this, each in its own vm context, interleaved): d8p ×1.000 / ×1.011, d8x ×1.001 / ×0.996, d8m
  ×0.983 / ×0.998; c1 ×0.995, d ×0.969, e ×0.971, r ×1.013 (mc0 / mt ×0.92: minus-base rows, noise) — none slower by 2 %.
- JSC (the macOS jsc shell; a scratch driver, not a repo runner: the rows' messages built in node, the first Track's warm-up,
  3 s lead-in, the median of 5 × 1 s, each row its own process): **d6p 0.014, d6x 0.014, d6m 0.0096** steady; their first
  second 0.038 / 0.033 / 0.018 (JSC's tiers, as 7a's d8p: d6p's first bar 0.036–0.049 in 100 ms windows, the next ≈ 0.02).
  A/B of the 808's rows against e96ddf9's engine: d8p 0.0284 / 0.0286, d8x 0.0369 / 0.0369, d8m 0.0119 / 0.0119 (this driver
  reads d8p at 0.028 where 7a's read 0.014: another driver; the A/B is the measure). c1, d, e, mc0, mt in JSC: the lead's.
- engine-track 56/56: the ten 7b tests and the 7b bench gate. golden-606 11/11 (not frozen: determinism); its freeze mode
  exercised once (11/11 against its own refs; a +7-tick shift of the song clock caught at −55 dB / −84 dB; the refs deleted).
  D5: the DEMO chain 198 notes (28 open hats) = 180 sequencer hits, bit-identical at 50 / 62 % with and without the SYNC-off
  payload; the open hat ringing two bars unchoked bit-identical, its tail at 1.9–2.9 s −99.6 dB at 120 BPM against −74.8 dB at
  30 (the cut inside both paths); 97 BPM: 91 hits, all on the same frame. The acid pair: 71 sixteenths (a start at bar 3, a
  seek back, a loop wrap), worst 0 frames straight, 12 at 62 % / 48 (bound 4 + 12.5).
- E6's files: cv-mods 16/16, classic-mod 16/16, cv-cost 13/13, bench 6/6, bench-page 2/2, lint 139/139, integration 44/44,
  cv-graph 33/33, classic-panel 13/13. **D1**: golden-drums 5/5 (ref-7a), golden-classic 8/8, -fx 3/3, -presets 8/8, -random
  1/1, -graph 6/6, canonical-stream 1/1 — bit-identical.
- Windows: canvas-7a-sim 3/22 — line 68 (X's: the Drums view lists `['tr808', 'tr606']`) and the 19 tests built on its
  track; with that one line edited locally (not committed) 22/22 against this engine. pwa 21/22 (sw.js BUILD: the lead's).

### Lane H1 (host: `main.js`, `tests/canvas-7b-sim.test.mjs` (new), `tests/main.test.mjs` (+1); phase 2, base 2508344 = wt-7b after phase 1)

**Commits**: bcab0c7 (main.js + the fixture check), c4fe8c8, d094a3b, 1b65182 (the sim's tests, main.test), and the last one
(`sw.js` by `tools/precache.mjs --write`: BUILD only; these notes). No DSP / engine / other lane's file.

**The lead's fixture check** (canvas-7b-sim's first test, real engine): a TB-303 track ("Bass") on SYNC, the Minimoog track
replaced by the TR-606 from the Sources tray's Drums view (it lists `tr808, tr606`; "Replaced Minimoog with TR-606 · tap to
undo", no offer: the 303 is synced; Hardware only; a 606's empty record; a 606 session; 16 live keys, 8 pads); DEMO (I-1, I-2
chained in PATTERN PLAY; the payload `m: 'tr606'`, its plan the panel's), RUN/STOP synced = ▶ from bar 3: **32 step posts**
over bars 3–4, each `{M, s, m, k, v, p, f, o}` the plan's (I-1 on bar 3, I-2 on bar 4), `F` on the 4-frame grid at its tick's
frame (+0 or +4 frames); the machine's `dm.trig` at each sounding post's frame, lanes & 0xE2F only; **the 303's 32 synced
steps (`seqFire`, at `T.spanF`) on the same grid points — all 32 on the 606's very frame** (the bound: the same or the next);
the panel at the heard post (200 ms of output latency), RUN lit, the chase on the heard step.

**As built** (§10's sites; [C] where §10 left a detail open):
- `drumOf` → `normDrum(d.drum, d.model)`, and a record of the other machine (`(D.m === 'tr606') !== (model === 'tr606')`) is
  re-normalised by the model too [C] — keepDevs and the Replace keep them apart already; this is the guard if a snapshot ever
  pairs them (a 606 then never drives an 808 record, nor the reverse). `normDevs` → `normDrum(undefined, m.id)`;
  `setTrackModel` → `normDrum(undefined, id)` (808 ↔ 606: away and to, the session forgotten, the payload forced after the
  patch — the engine's `drPend` keeps one that overtakes it); `drumEdit` → `normDrum(E, model)`; `drumPayload` offline →
  `initState(model)`; `drumToRoll` → `prim: DC.primaries(D.map, model)`, its notice "the 606's own sequencer …".
- **SYNC 303s**: deps `link303: (x, s) => link303(x, s)`, `n303` (every TB-303 device of the project; `synced` = all on SYNC).
  `link303Chk()` calls `DRUM.link303()` only when `n:synced` changes — from `seqSend` (a 303's SYNC: its panel's button, Simple
  or Hardware, goes through it) and `renderHeads` (a track added / deleted / duplicated, a Replace, an undo / redo, a load).
  `link303(x, s)`: every 303 → `seq.sync = true`, `seq.swing = s` (clamped 0–50), a running free one stopped through
  `seqToggle(…, false, quiet, dev)` (its payload: SYNC, the swing, not running — one post each), not a History step (a 303's
  pattern state never is: keepDevs); the notice "1 TB-303 now follows the song · tap to undo" ("N TB-303s now follow …";
  above 62.5 %: "…, swung as far as the TB-303 swings · …"); its tap puts each 303's sync, swing and run back (a 303 replaced
  or deleted since is skipped). **An open TB-303 panel** reads its SYNC / Run / SWING only when built (classic-panel
  `seqParts`' `syncDraw` and `numCtl`'s `upd`), so `seq303UI` rebuilds a mounted one (`renderPanel`) after SYNC 303s and its
  undo [C] — classic-panel.js is not H1's (see below).
- **The offer** (`offer303(view)`): from `setTrackModel` (the Drums view's tap or drop, Replace with…), `addTrack` (+ Track, a
  drop on the track list) and `cvAddInstrument` (the hook) when the model is `tr606`; a microtask later, so the arrival's own
  notice goes first — the offer then takes the one notice line (the Replace's "tap to undo" gives way; ↶ still undoes it) [C];
  only with a 303 on its own clock; once per project (uid) in a page session; "The TB-303 on “Bass” runs on its own clock —
  sync it to the song so the two play locked? · Sync" (several: "The TB-303s on “A”, “B” run on their own clocks — sync them
  … so they play locked? · Sync"); its tap is the arriving 606's own `link()` (its swing).

**Readings / findings** (the review items through main.js, measured):
- #4's two unlisted sites: with S6's `model ?? d.m`, **`drumEdit` was already safe** (the record's clone carries `m`: the
  relink test passes with the old line too); **`normDevs` and `drumOf` were not** — a 606 device without a record got the
  808's (the fixture failed first: the Drums view's 606 got an 808 record through `setTrackModel` / `drumOf`; main.test's
  `normDevs` case and the other-machine guard each failed with its line reverted).
- #5: with S6's reading 1 (a 606 record's map holds every key) `map: D.map` already gave the 606's primaries; `prim` is passed
  as §10 says. The sim's MAP… → HT on 45 → Piano roll keeps both HT hits on 45.
- The offline session: `payload606` reads only `rst`, `bar`, `twSel`, `ds` of a session — an 808 session gave the same bytes;
  `initState(model)` as §10 says.
- 808 ↔ 606 and the payload key: `postPatch` forgets `N.drPk` only when the engine leaves 'drums'; a machine change keeps it,
  which is harmless — the two machines' payloads never share a `pk` (the 606's hashes `m`), so the restore's `drumSend` always
  posts. Measured with the patch held (an asset wait): the new machine's payload goes first, waits in `drPend`, and plays.

**Tests** — `canvas-7b-sim` (11, accessor-free: the guard build, device views and hooks only; strings / numbers into
`assert`): the fixture check; PATTERN WRITE running (a key toggles in place — one 'now' payload, the shape kept; the LEDs with
the heard playhead inverted; FUNCTION + 7 → LAST STEP 7 at the bar, seven-step measures after it; the SCALE switch alone sets
nothing, FUNCTION's press latches SCALE 2: seven 32nds, `o` 0 … 720); PATTERN PLAY (keys 2 + 4 held → the chain I-2 … I-4,
stopped LEDs 2 / 1 / 1, played 1, 2, 3, 1, 2; a key running → 'bar', the pattern finishes then I-1; **TAP = STEP RESET**: one
payload, `rst + 1`, its `pk` new, the plan unchanged — the worklet restarts the pattern after an odd step, one sixteenth on,
nothing skipped); TRACK WRITE (key + TAP three times running, CLEAR arming the D.C.: `rt` 0, 1, 0, D.C. bar 3; FUNCTION + 2
shows bar 2 and locates there) then TRACK PLAY (0, 1, 0, 0, 1, 0); Shift + a key chains; the pads (2 × 4: two fingers → 38 at
0.675, 36 at 1; AC held → no note, the snare at 1; one off), MIDI 36 plays the kick; → Piano roll (MAP… HT → 45, LT gives 45
up; the roll's seven rows; 4 bars of the chain as notes, v 100 / 127, `36 38 41 42 45 46 49`; the notice; SYNC off; **the
synced pattern and its notes bounce bit-identically**, the bounce carrying the 606's payload; the notice's undo, ↷, ↶); the SD
slot (its entry with 2 levels before the payload naming it, it plays; `tables.relink` → `drumEdit`: a 606's record, only the
slot's id moved); Save with an 808 beside it → schema 9, both records round-trip (the 808's without `m`), a newer schema
read-only (the gate a schema-8 build applies to 9); **808 ↔ 606** Replace and ↶ / ↷ twice, plain and as a graphed node's
second instrument, every restore with the patch held (a sample slot on each machine gives the track needs; `tables.ready`
false): the payload before its patch, then the machine's synced steps (the same count every time), `dm._mach`, the record and
the panel's session that machine's; SYNC 303s (the button "303s synced" → "Sync 303s" when the 303's own SYNC goes off, with
nothing pressed on the 606; a tap: SYNC, its free run stopped, swing 32 at 58 %, one payload; the notice's undo; 70 % → 50,
said; the Bass track's open panel rebuilt: "⛓ Synced to song", Run disabled, SWING 16 % — and back); the offer (shown after
a Replace beside a free 303, its tap = SYNC 303s; not again in the session); the SYNC-off bounce on a graphed node (a synced
606 with no notes bounces; SYNC off and no notes: nothing to bounce; note 60 = HT through the payload's map, which the
engine's default map leaves silent). `main.test` +1 (41 → 42): a page booted on `#tr606` — the record, `processorOptions.seq`
(`m`, `rst`, HT 48 / 47, LT 45, no cowbell), a step post → a 606 session, the tab "Drums", `normDevs` / `drumOf` by model,
`n303`. **Failing first**: the fixture (an 808 record on the 606), main.test (normDevs; the other-machine guard), SYNC 303s's
"repainted" (without `link303Chk` in `seqSend`).

**Gates** (node 24, one file at a time): canvas-7b-sim 11/11, main 42/42, canvas-7a-sim 22/22, classic-panel 13/13, cv-drum
31/31, roll 50/50, assets 38/38, canvas-sim 22/22, canvas-1e-sim 24/24, canvas-1i-sim 20/20, canvas-2a-sim 26/26,
canvas-2b-sim 23/23, canvas-3-sim 26/26, cv-shell-sim 16/16, cv-fixes-sim 5/5, accessors 30/30, engine-track 56/56, lint
141/141 (the accessor ratchet unchanged), pwa 22/22 (`precache --write`); once at the end **golden-classic 8/8, -fx 3/3,
-presets 8/8, -random 1/1, -graph 6/6, golden-drums 5/5 (ref-7a), golden-606 11/11, canonical-stream 1/1 — bit-identical**.

**Headless Chrome** (`--headless=new --use-angle=metal --force-device-scale-factor=2`, a fresh browser context,
`window.__synthTest = {}` first; my own static server over a copy of the worktree; `scratchpad/h1-606/smoke.mjs`), **1440 × 900
(mouse) and 1024 × 1366 (touch)**, both all ok: Power by a real tap; a TB-303 track ("Bass") by the tray's + Track; the Drums
view lists TR-808, TR-606; a real tap on the 606's tile replaces the Minimoog and the offer shows; its tap → "1 TB-303 now
follows the song", the 303 on SYNC, the module's button "303s synced" (disabled); DEMO and ▶ by real taps: the session at a
heard post, the LEDs lit; PATTERN WRITE running, **FUNCTION + key 7 by two touches** (FUNCTION held, key 7 pressed, both
lifted) → LAST STEP 7 of the pattern heard (the grid dims 8–16); **AC + BD + SD by three touches**: all three held, AC
pressed, BD and SD at v 1, their offs; "→ Piano roll" → its menu's "1 bar" by real taps: 22 notes and the notice; the roll's
seven rows (Kick 36 … Closed hat 42); **no console error, exception or log error**. Screenshots `out-1440/`, `out-1024/`.

**Seen, not fixed** (for the lead / the reviewers):
1. `seq303UI` rebuilds an open TB-303 panel (`renderPanel`) after SYNC 303s: correct, but a whole rebuild (focus, the Hardware
   face's state); a `ClassicPanel.seqSync()` (classic-panel.js: re-run `syncDraw` and the TEMPO / SWING boxes' `upd`) would be
   lighter — not H1's file.
2. The offer shares the one notice line with the Replace's "tap to undo" (it replaces it; ↶ still undoes). A notice queue
   would keep both; the page has none.
3. Pre-existing, not 7b's: main.test's Serum boots log `doc.getElementById is not a function` from `SerumHost` in the DOM stub
   (wk.js `injectStyles`); the tests pass.

### Fixes (reviews 1 + 2; the fixer, base f94b078)

**Commits**: 4ece89e (host, pads, buttons, rstF in the payload), 550222d (DrSeq rstF), 2a14434 (→ Piano roll's tempo), de1adbb
(the 808 ↔ 606 tail), a9e3d90 (sw.js), and these notes. Each fix failing test first (the new test run against the old file:
the failure noted); the reviewers' repros re-run before / after from `scratchpad/7b/fix/r1`, `fix/r2` (copies retargeted at this
worktree; Chrome's results in `fix/r2/out`).

| # | finding | fix | test (failing first) · repro before → after |
|---|---|---|---|
| R1-1 · P1 | ■ / ▶ / a seek kept a synced 606's D.S. (TRACK PLAY) or TRACK WRITE's heard key in the worklet: cv-drum's `transport()` kept only `.state`; main's `seek()` never told the drum host | cv-drum `exec(e, D, r, ph)`: one helper runs a press's result (state, record, every command) for the panel's presses, `transport()`, `heardPost()` and `panic()`; main `seek()` calls `DRUM.transport(true)` while playing (the 606 clears ds / twSel / the arms and sends 'now', which DrSeq takes at once — it is re-anchoring; the 808's 'transport' returns no command) | cv-drum "review 1 #1" (sent `[]`, want `['now']`); canvas-7b-sim "review 1 #1" (■: the plain plan posted — failed on the old host). `r1/ds-stop`: after ■ ▶ `2,3,0,1,2` → **`0,1,2,3,0`**; after a seek `2,3,0,1,2` → **`0,1,2,3,0`**; TRACK WRITE ■ ▶ `2,2,2` → **`0,0,0`**; `r1/host-cmds` #1: sent `[]` → `["now"]` |
| R1-2 · P1 | CLEAR held running in PATTERN WRITE erased the record but the worklet kept playing the steps (`heardPost()` dropped the 'now') | the same `exec` in `heardPost()` | cv-drum "review 1 #2" (`[]` → `['now']`, one payload per step wiped). `r1/wipe`: payloads during the hold 0 → **12**, the worklet's CH row `1101110111011101` → **`0000000000000000`**, CH hits in the next 2 bars 24 → **0** |
| R1-3 · P2 | a loud 808 replaced by a 606 clicked: the de-click tail (pre-limiter output units) went through the 606's IC14A rails (−0.760 → −0.177) | engine `drPost(out)`: on an 808 ↔ 606 switch only (`mch`), after `drUnits(g_old)`, the tail and the decimators' history move to their own chain (`tailO`, `decO`, two rings added sample for sample) and `renderDrums` mixes them **after** `dm.post` (one quantum of zeros behind the tail drains the chain, then it is emptied; `osFade` ramps it with the machine; `reqOS`, the idle skip, `isQuiet`, `panicClear` know it); leaving the drums with one draining folds it back (`drPost(false)`). 7a's kind switches never call it: **golden-drums 5/5 against ref-7a**, reviewer 1's `d1-808paths` / `d1-graph` all IDENTICAL | engine-track "review 1 #3" (old engine: max \|Δ\| **0.7524** vs the switch to an analog model). `r1/e6dbg` 808 → 606: `… −0.760 −0.177 −0.162 …` → **`… −0.760 −0.840 −0.823 −0.802 …`** (= 808 → Minimoog); `r1/e6rail` VOLUME 0.5 / 2 / 3 vs 7.5: max \|Δ\| **0.0000**; `fix/r1/fold` (808 → 606 → Minimoog / → 808 → 606 in consecutive quanta): max \|Δ\| 0.0000 vs 808 → Minimoog |
| R1-4 · P2 (the lead's decision) | after ■ a ringing open hat's clock differed between the synced pattern (the project's tempo) and its → Piano roll notes (the machine's own TEMPO, 120) | drum-core **`withTempo(D, bpm)`** (the 606's TEMPO, the 808's TEMPO + FINE by `bpmTempo`; 40–300; the same record when equal); `drumToRoll` writes it before SYNC off (one payload; `drumSend` too when no press sends) and puts `k0` / `k1` in `meta.drumSync`: ↶ / ↷ (`drBackApply`) and the notice's own undo under a later step restore / re-apply it (`drTempoPut`, same machine only). Both machines | drum-core "review 1 #4"; canvas-7b-sim "review 1 #4" (the 606, failed on the old main); canvas-7a-sim "7b review 1 #4" (the 808). `r1/d5` with the SYNC-off record as → Piano roll now leaves it (`fix/r1/d5fix`): stop at 0.8 s, project 100: max \|A−B\| 6.7e-3 → **BIT-IDENTICAL**, project 40: 3.6e-4 → **BIT-IDENTICAL**; every other D5 row still bit-identical. Note: a tempo change after → Piano roll leaves the machine's TEMPO where it was (SYNC off: its own) |
| R1-5 · P2 | REC with the AC pad held recorded the hit without its accent | cv-drum `pads.on` passes `v` to the 'pad' press; press606 'pad' sets lane 0 (AC) at that step when `v ≥ 1` (the AC hold plays every hit at 1; a pad touched at its front edge is heard at 127 too). The 808's REC unchanged | cv-drum "review 1 #5" (AC 0, want 1); drum-core "review 1 #5". `r1/rec-ac`: `SD 1, AC 0` → **`SD 1, AC 1`** |
| R1-6 · note | the open hat's tempo cut is audible only above ≈ 180 BPM (V6's pulse: onset 3.5 beats) | **no change** — authentic to the circuit as read (R6 §9's "one to four beats"); at ordinary tempos the hat's own decay ends first | — |
| R2-1 · P1 | a pinch or a one-finger drag starting on RUN/STOP started / stopped the song (`pressBtn` at pointerdown) | `start606` = the 808's `startBtn` with the 606's label: `A.tap(b, () => DR.press({ k: 'start' }))` (`tapBtn6`; `pressBtn` removed; Enter / Space by A.tap's detail-0 click) | cv-drum "review 2 #1 / #2" (a touch press then a two-finger cancel: `['start']` at the press, want none). `runstop-pinch` 1440 × 900 and 1024 × 1366: zoom 1 → 1.42 / 1.38 and **nothing started** (was: playing); `drag1` (1024 × 1366 and 1440 × 900): RUN/STOP changed true → **false** |
| R2-2 · P2 | PATTERN GROUP was a music zone acting at the press: a pinch on it never zoomed and flipped the group | no `data-gesture`, `A.tap` (the same `tapBtn6`); FUNCTION + PATTERN GROUP still shows the segno bar (FUNCTION is the music touch held first) | the same cv-drum test (`data-gesture` null; FUNCTION held + a tap → `show 'sg'`, `tg` kept). `runstop-pinch`: PATTERN GROUP first → **zoom 1 → 1.42 / 1.38, grp 0 kept** (was: no zoom, grp → 1); `pinch` 1366 × 1024 / 1024 × 1366: zoom, nothing changed (at 1440 × 900 `pinch.mjs`'s framing puts PATTERN GROUP under the arrangement strip — `fix/r2/grpwhere`: outside the band, a script artefact); `a11y`: PATTERN GROUP and RUN/STOP by Enter ok |
| R2-3 · P2 (the lead's decision) | STEP RESET with +200 ms of Bluetooth latency: a TAP heard on a bar's step 15 / 16 restarted the pattern twice (the cursor already past the bar line) | the press's heard frame rides with the counter: cv-drum `api.tap(ts)` → `{ k: 'tap', f, F: heardAt(ts) }`, press606 → session `rstF` (initState `rstF: −1`), payload606 `rstF` (not in `pk`: `rst` changes it); DrSeq keeps `c0F` (the post frame of the last step 1, set in `fire`) and `restart()` drops the request when `rstF ≥ 0 && c0F > rstF`. **The 808's payload byte-identical** (no `rstF`; `pk` unchanged — drum-core's pins; golden-drums 5/5) | dr-seq "review 2 #3" (synced and free; old DrSeq: restarted at 4320); canvas-7b-sim "review 2 #3" (old DrSeq: `15 0 1 0 1 2 …`, now `0 1 2 3 4 5 6 7`); cv-drum, drum-core pins. `steprst 200` (1440 × 900 and 1024 × 1366): heard 16 `16 \| 1 2 1 2 3` → **`16 \| 1 2 3 4 …`**, heard 15 `15 16 \| 1 2 1 2 3` → **`15 16 \| 1 2 3 …`**, heard 1 `1 2 3 4 1 2` (unchanged: the cursor's own lead, not a double restart); `steprst 0`: as before (`16 \| 1 2 3`, `15 16 \| 1 2 3`, `1 2 1 2 3`) |
| R2-4 · P2 | the pads row flush on the grid; the AC pad's name wrapped ("Accent · / hold") | `PADS6` `{ ph: 50, top: 8 }` (8 + 2 × 50 + 8 = 116: the cell and the module unchanged), `p.style.top = (PG.top \|\| 0) + …` (the 808's: the same strings); the AC pad's `data-name` "Hold" (its aria label unchanged) | cv-drum "review 2 #4" (+ the two 7b render / grid assertions moved to 66 px / 50 px). `grid-fix` (1024 × 1366 touch, 1440 × 900 mouse): pad tops 0 → **8 px** below the grid, pads 50 px, row gap 8, "Hold" on one line (`fix/r2/out/grid606-*.png`); every grid cell still ok at k 0.5 / 1 / 1.6 |
| DOM | the module 645 ≤ 700 | no change (reviewer 2's judgement) | — |

**Also checked**: the 808's panel at k 1 vs 452f731 (`diff808`, served from `git archive 452f731`): **0 of 4 194 304 px** differ in GL
and `?nogl`, the module DOM identical, 847 = 847 elements; `pads` 1024 × 1366: as reviewer 2's run (its "two fingers on CH" row
is its script's regex, the same output as theirs); no console error, exception or CDP log error in any run.

**Gates** (node 24, one file at a time, at a9e3d90 + these notes): cv-drum 37/37, canvas-7b-sim 14/14, canvas-7a-sim 23/23,
drum-core 79/79, dr-seq 26/26, dr-606 25/25, dr-808 25/25, engine-track 57/57, main 42/42, cv-panel 85/85, classic-panel 13/13,
roll 50/50, lint 141/141, pwa 22/22 (`precache --write`); once: **golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1,
-graph 6/6, golden-drums 5/5 (ref-7a), golden-606 11/11, canonical-stream 1/1 — bit-identical**.

## 15. Review log

### The skeptic review (2026-10-20, against 7788b71 = 452f731 + this contract)

Every claim about existing code was read at 7788b71 (whose `engine.js`, `dr-808.js` and `dr-seq.js` equal `tests/ref-7a/`'s byte
for byte); scratch arithmetic only (the research's resonators re-solved, with the op-amp's GBW, in a node script); no test was run.
The user's answers (§13) are settled and not reopened. **D1 holds as designed**: golden-drums renders exactly the three frozen files
against the current ones with every other module current (tests/golden-drums.test.mjs:28, 44–51), JavaScript never fuses a
multiply-add, so V6 can move the 808's constants into `MACH.tr808` and lift sub-blocks into helpers without changing a byte if each
expression keeps its order; what it adds to the contract is that drum-core's 808 exports are part of the guard too (the test
builds its payloads, maps and notes from the current `drum-core.js`: 57–75, 88–90, 146–147 — §12.3's pins). **D5 for the open
hat did not hold as written** (#6, #7, #12), and four host paths would have lost or misread a 606 (#2, #3, #4, #5). Severity as 7a:
P0 a silent failure or a broken build, P1 a contract contradiction or an impossible gate, P2 a gap a builder would trip on, P3 a
correction.

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | "`rebuild` includes a machine change, so `drOn(p)` runs" — the call is also guarded by `was !== 'drums'`, so a builder who widens `rebuild` alone still keeps the 808's circuits under a 606 patch (or builds nothing: `drOn` never runs) | engine.js:1911 (`rebuild`), 1927 (`if (kind === 'drums' && was !== 'drums') this.drOn(p)`) | **fixed in §0, §1.5**: both conditions include the machine change |
| 2 · P1 | The new machine's payload can overtake its patch: `sendPatch` waits for its assets while `drumSend` posts at once; on 808 ↔ 606 (and its undo / redo) the kind stays 'drums', so the payload lands in the old machine's `sq`, which the boundary then drops — the machine stays silent until the next edit (7a's F2 class; 7a was safe because a payload before a kind change waits in `drPend`) | main.js:615–618 (`tables.ensure`, `N.waitP`), 3226–3228 (`post()` at once), 1808–1810 (setTrackModel: `sendPatch` then the forced `drumSend`); engine.js:2184–2193 (`drSeqMsg` → `this.sq`), 1905–1906 (`sq = null`) | **fixed in §1.5, §3.1, §12.5, §12.6**: the 606 payload carries `m` (absent on the 808's: D1); a payload for another machine than the patch's waits in `drPend`; `drOn` adopts it when it matches |
| 3 · P0 | STEP RESET would never reach the worklet: TAP in PATTERN PLAY changes only the `rst` counter, `drumSend` drops a `'now'` payload whose `pk` it already posted, and `pk` hashes `tap` but nothing new | drum-core.js:350–353 (`pk`), main.js:3223 (`if (!force && at === 'now' && pk.get(dev) === s.pk) return`) | **fixed in §3.1, §12.3**: `pk` hashes `m` and `rst` when present (the 808's payload has neither: its `pk` unchanged) |
| 4 · P0 | `normDrum` call sites: §0 / §10 named three; main.js has four, and the two unlisted ones would rewrite a 606 record as an 808's (unknown fields dropped) — `drumEdit` on every sample relink from the asset manager (the 606's patterns, chains and tracks gone), `normDevs` for a device loaded without its record | main.js:148, **206**, 1797, **3257**; song.js:570; drum-core.js:190–208 | **fixed in §0, §3.1, §10, §12.3, §12.6**: the machine is `model ?? d.m` (an 808 record has no `m`: unchanged); §10 lists all four sites |
| 5 · P2 | → Piano roll hands `toNotes` the map; its primaries come from the 808's `normMap`, which fills the sounds a 606 map lacks with the 808's defaults in sound order — `mt: [45, 47]` is filled before `ht`, so a 606 with HT on 45 or 47 loses HT's primary and → Piano roll drops every HT hit (§10 said "unchanged") | main.js:3295; drum-core.js:117–121, 151–162, 67 | **fixed in §4, §10, §12.2, §12.3, §12.6**: H1 passes `prim: DC.primaries(D.map, model)` |
| 6 · P1 | The stopped clock `F / tp.fpt`: `tp.fpt` is 1 frame a tick until the node's first transport message, so a fresh node's open hat is cut after ≈ 40 frames; the synced DrSeq's "the project's tempo" is not in its payload (`bpm` is the stored knob) | engine.js:3106 (`fpt: 1`), 2716 (the `bpm` getter: the patch's `bpm`); drum-core.js:348 | **fixed in §1.5, §3.5, §12.4, §12.5**: stopped → the Inst's `bpm` getter (synced) / the machine's TEMPO (free) |
| 7 · P1 | D5 through the open hat: the shell read `{ t, tpf }` once per span and extrapolated, but the two D5 paths split spans at different frames (the notes path also at its `d: 120` note-offs; a span is cut wherever an event is due), so a pulse near a tick boundary can round onto different OS samples — bit-identity fails at the cut; and the free clock `fT + (pos − fP) / ffpt` ignores `F` (`pos` is the span start's; the de-click tail renders up to 3 ms ahead) | engine.js:3963–3982 (spans, `pos += len`), 2160–2172 (`fadeDrums` at `F0 + o / OS`); dr-seq.js:270 | **fixed in §1.5, §2.1, §3.5, §12.1, §12.4**: the shell reads the clock at every absolute 4-frame chunk start; the free clock at `pos + F − sF` |
| 8 · P1 | d6p 0.015 (node / iPad) is below what its own pattern keeps awake: 7a measured d8p 0.0193 with no cymbal and the 808's CY 0.0082 alone; d6p's CY once a bar never sleeps and its CH sixteenths keep the high band on; §2.6's own ceilings sum to ≈ 0.033 | IMPL-7a §14 lane V ("CY 0.0082 (+ both bands)", d8p's machine 0.0126) and lane E (d8p 0.0193); tests/bench.json `targets.d8p` 0.02 | **fixed in §2.6**: d6p 0.025 [C] — proposal P-1 |
| 9 · P1 | Two 7a tests break the moment `tr606` is in MODELS and no lane owns them: canvas-7a-sim pins the Drums view to `['tr808']`; classic-panel's review-2 test pins every bound vertical switch (`V`) and hosts `api.drum` for the 808 only — the 606's SCALE is a vertical switch (`seen.v` gains it; without a host it is `aria-disabled` and does not move) | tests/canvas-7a-sim.test.mjs:68; tests/classic-panel.test.mjs:197–209, 238–248 | **fixed in §0, §11**: X owns canvas-7a-sim's line; P1 owns classic-panel.test (`V` + `'tr606 dr:sc'`, a 606 record); both in the known windows |
| 10 · P2 | The extras did not fit: the grid's 608 px in a 608 px module whose strip keeps 8 px each side (592 inside); eleven knob cells of 72 px = 792 px are two rows, not one; the strip has no row labels; the module estimate | cv-panel.js:35–36 (`XROW`, `XPAD`, `XCELL.k`), 545 (`W = ceil32`), 581–594 (the cells), 114 (`XBREAK` global); `SEQ_GRID` 576 (41) | **fixed in §3.7, §7.1, §7.2, §7.5**: grid 592 × 192 (48 + 16 × 34); two knob rows; ≈ 608 × 864 |
| 11 · P2 | STEP RESET "at the cursor's next step tick": at a swing an odd step's tick carries the swing offset, and a measure restarted there shifts the whole grid by it (every even step swung, every odd one twice) | dr-seq.js:175 (`tickOf`), 140 / 180 (`cw`) | **fixed in §3.5, §12.4**: at the next even step |
| 12 · P2 | D5 "including the open hat's tempo-linked cut" is not exercised by a DEMO-like pattern: the cut's onset is 1–4 beats after an OH (R6 §9), and off-beat OHs or a CH empty C41 / choke the hat every 500 ms | R6 §9 (the pulse charge estimate); §12.2 (as written) | **fixed in §12.2**: one D5 pattern with an OH ringing unchoked ≥ 4 beats |
| 13 · P1 | Two §12.1 gates may fail a correct model: "the OH's −30 dB time shorter at 240 than at 120 than at 60" (at 60 and 120 BPM the cut may fall past the OH's natural −30 dB point: equal times), and "CH chokes a sounding OH −20 dB within ≈ 3 τ of the drain" (Q25 holds only while C42, τ ≈ 15 ms, keeps its base up; the R137 drain's τ is ≈ 100 ms; C46 / R136 unknown — 7a's choke met −20 of its −40 for the same kind of reason) | R6 §9, §14; IMPL-7a §14 lane V "Targets not met: Choke depth" | **fixed in §12.1**: the tempo times non-increasing, strictly shorter at 240 than at 60; the choke depth recorded, the gate "quieter than a free OH" |
| 14 · P2 | FUNCTION + CLEAR / FUNCTION + PATTERN GROUP (stopped, track modes) show the D.C. / segno bar, but the same CLEAR is BAR RESET and the same PATTERN GROUP toggles the group — the table did not say which wins | §3.3 rows FUNCTION held, CLEAR stopped, PATTERN GROUP | **fixed in §3.3**: FUNCTION held wins (show only) |
| 15 · P3 | R6 §14 left "whether chained tracks share one group" to §3.3; nothing decided it | R6 §14; §3.1 | **fixed in §3.1**: a continued track keeps its starting track's `tg` [C] |
| 16 · P2 | The panel's session is built with `initState()` (808) and replaced only by `drumForget` in `setTrackModel`; the undo / redo of an 808 ↔ 606 Replace restores the other record under the same device view, so a 606 session would drive an 808 record (and vice versa); the offline payload's session likewise | cv-drum.js:140, 299; main.js:1797, 3211; applyRestore → `drumChanged` (main.js:1386, 3234) | **fixed in §7.4, §10**: `initState(D.m)`; `changed()` starts a fresh session when the record's machine differs; `drumPayload` offline `initState(model)` |
| 17 · P2 | "`Dr808.mach[kind]` `{ … SOUNDS }`" for a 7-sound machine invites a 7-entry list whose index is not the sound id (`ht` = 3, not 4) — the payload's `smp` / `prim`, the machine's slots and `lit` are all 16 by sound id | dr-808.js:62, 2016–2061, 2146–2153; drum-core.js:339–343 | **fixed in §1.2, §2.1**: `SOUNDS` stays 16 by id; `sids` [0, 1, 2, 4, 8, 9, 10] |
| 18 · P2 | SYNC 303s needs the 303s' state (the hidden / "303s synced" button) and a repaint when a 303 changes elsewhere; an open TB-303 panel does not repaint its SYNC / SWING when someone else writes its `seq` | classic-panel.js:616–620 (`syncDraw` on its own click), 657; main.js:3165–3179 (`seqOf` / `seqSend` / `seqToggle`) | **fixed in §3.8, §7.4, §10**: dep `n303()`, `DRUM.link303()`, the 303 panels repaint; the 62.5 % clamp said in the notice |
| 19 · P2 | `PatchP.machine` is a new patch field: cv-mods' "FIELD_CLASS knows every patch field" parses `class PatchP` and fails on an unclassed `this.machine` | tests/cv-mods.test.mjs:46–63; cv-mods.js:50–72 | **fixed in §12.6**: `FIELD_CLASS` `machine: 'struct'` (E6) |
| 20 · P2 | drum-core's 808-only guards sit **before** any dispatch: `compilePlan` re-normalises a record whose `keys` are not 16 long as an 808's; `normUi` clamps a 606 tempo (BPM) to 808 clicks 0–39 and `sel` to 0–11; `payload` reads `tempoBpm(ui.tempo, ui.fine)` | drum-core.js:254, 175–183, 348 | **fixed in §0, §3.1, §12.3**: the dispatch on `D.m` precedes them; a test keeps a 606's 137.5 BPM and keys 13–16 |
| 21 · P3 | V_A at ACCENT 10 is ≈ 14.2 V with §1.3's own 50 Ω end resistance (14.35 V without) | 15 · 4.7 / 4.75 − 0.65 = 14.19 | **fixed in §1.3** |
| 22 · P3 | R179 is Q38's 100 Ω emitter resistor in R6 §8 and half of IC12A's 39 kΩ gain network in R6 §9; IC12B's gain resistors are not given | R6 §8, §9 | **fixed in R6 §14** (V6 re-reads) |
| 23 · P3 | "within 5 % of `ipad7a`": bench.json has no such row yet (its iPad rows: `ipad`, `ipad1d`, `ipad1e`, `ipad2b`) | tests/bench.json (keys) | **fixed in §12.8**: `ipad7a` if recorded, else `ipad2b` |
| 24 · P3 | The 606 round adds to the scope's one-off warm-up (7a: 540 → 660 ms in node), the iPad's first-context wait | engine.js:3178–3197; IMPL-7a §14 lane E | **fixed in §1.5**: recorded in §14 |
| 25 · P3 | Lifting 808 sub-blocks into helpers that take component tables inside per-sample loops makes the 808's hot loops polymorphic once the 606 has run in the scope (the warm-up runs both) | dr-808.js:413, 592, 1470, 1647 (`const P = BD / SD / CY / HH` in the loops) | **noted in §2.1**: scalars at a knob change, not tables, in the loops; `cpu-gate` 2 % on d8p |
| 26 · P3 | Synced TRACK PLAY "song bar n = track bar n" holds only for 16-sixteenth patterns | §3.4; drum-core.js:266–268 (`mT`) | **fixed in §3.4** |
| P-1 · proposal | d6p's target: 0.025 as applied (#8), or drop CY from d6p (it is d6m's) and keep d8p's 0.020 so the two machines' typical rows compare | #8 | **for the lead** |
| P-2 · proposal | `ohd` scales R167 **and** the cut's charging resistor R6 (§2.3), so a long open hat is cut 4× later too (R6 §9's 1–4 beats → 4–16): the 606's signature cut then never shows on a long hat. Alternative: `ohd` on R167 only — a long open hat ends at the tempo cut, which is the circuit's own behaviour with a longer natural decay (Q2's answer fixed the knob set, not this) | §2.3 `ohd`; R6 §9 | **for the lead** (a [C]; the default 5 is the stock circuit either way) |
| 27 · fine | Checked and fine: the lane bits & 0xE2F and the 808 sound ids (dr-808.js:68 `LANE_S`; DrSeq's lastNote reads `lts` / `hts` = 0 from `DrumP`, engine.js:1365, dr-seq.js:242); the SCALE → step codes 3 / 4 / 1 / 2 and swing on codes 3–4 (drum-core.js:52–54, dr-seq.js:51–53); the 606's bounds inside `MAX_MEAS` 769 / `MAX_STEPS` 24576 and `valid()`'s `d ≤ 32`, `l1 ≤ d` (dr-seq.js:54, 71–91), `mKey` an Int8Array holding 0–31; `DrSeq.DEF_MAP` plays the 606's primaries right before a payload (36 38 41 48 49 46 42 → 0 1 2 4 8 9 10, dr-seq.js:60–61: integration.test:656's kick); `create(…, 'tb303')` stays null (dr-808.test.mjs:160) and `Dr808` stays frozen with `proto` (dr-808.js:2163–2169); the warm-up's 606 round touches its own machine object, so the 808's post-`restore` state is today's; schema 9 is free and the 7a precedent holds (cv-migrate.js:85, 113–129; main.js:89's Minimoog fallback); the acid-pair arithmetic — the synced 303's offset `q.swing · 240` with `q.swing = s / 200` (main.js:3167, engine.js:2777) is 1.2 · s ticks, the drum machines' `round(4.8 (P − 50))` (drum-core.js:64), equal before rounding at `s = 4 (P − 50)`, the 303's SWING whole 0–50 (classic-panel.js:657), both clocks firing at the first span start whose `tickAt` reaches the tick (engine.js:2775–2781, dr-seq.js:259–274); the research re-computed — BD 60.0 / 129.4 Hz (Q 7.18 / 3.42, τ 38.1 / 8.4 ms), SD 204.8 → 358.3 Hz (Q 14.2, τ 22.1 ms), LT 131.8 → 310.7 Hz (Q 22.4, τ 54 ms), HT 206.1 Hz (Q 23.3, τ 36 ms), metal 418 / 440 / 627 / 246 / 308 / 367 Hz (203 at 680 kΩ; f · RC = 2.0698 on the 808's two), the noise pole 7.23 kHz and gain 32–46, the Sallen-Keys 2.67 kHz / 2.18 kHz at Q 0.75 and 8.5 kHz at Q 1.13 (R1 18 kΩ), V_A 6.58 V at ACCENT 5, the band-passes the 808's value for value, and the NJM2904's 0.6 MHz GBW moving the resonances ≤ 1 % (R6 §14); the counts (18 controls, 10 new ids: cv-mods 453 → 471, proc 60 → 78, cv-mods.test.mjs:26–27); `isDrum` by `PERS` (song.js:548) and the family filters (cv-tray.js:334, golden-graph.test:24, smpgen.test:577, integration.test:656) take the 606 with no edit; the `?v=9` / precache rules; D4 — the validator's `MAKERS` has the maker (cv-panel.js:45), the TB-303's face prints only its model and "Computer Controlled" (panels/tb303.js:131), a drum tile's meta has no maker (7a H2) | as cited | — |

**The lead's decisions on §15 (2026-10-20):** P-1 — keep d6p at 0.025 with the cymbal in its pattern (the honest load; the
808's measured rows say 0.015 cannot hold). P-2 — keep as written: the open-hat DECAY knob scales the natural decay and the
tempo cut together (a user turning DECAY up wants a longer hat; at its centre it is the original). Phase 0 (V6 ∥ S6) starts
now on the holding branch `wt-7b`, base this commit.
