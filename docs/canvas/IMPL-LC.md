# Stage LC: the LFO combiner with a whole-bar view (IMPL-LC) — contract (2026-11-02)

ROADMAP row 26 (docs/canvas/ROADMAP.md:47 [R]). Prior art: IMPL-MOD1 (one face system, `MOD_COLS`, the Modulators view, numbering),
IMPL-FR-B (the heard clock, motion.js, the fast lane; its §10 lists what Cut B exposes for this row), IMPL-SX0 (the kit after Serum),
IMPL-2b (ModCore), IMPL-MM (the master's ModCore).

**The user's request (2026-10-28).** "a module that you can plug multiple LFOs into that will show their combined waveform for the
whole bar … so i can craft complex waveforms that pump with the music in different ways using the visual aid that this module would
give me".

**The user's answers (2026-10-28, binding).**
1. It **outputs** the combined signal: cable it to any knob, so the picture is exactly what the knob gets.
2. **As many inputs as the user wants, all on ONE input jack** with stacked cords ("one input jack that all cables go to like we are
   doing now"), the discreet count on it.
3. Each input's **amount / mute on its cord or in a list on the face**, not on extra jacks.
4. **LFOs only** (no envelopes, no macros).
5. The whole bar on the song's beat grid, with a playhead.

**First guesses from the row (kept as first guesses, §15):** modes Add / Multiply (Min / Max later); the window 1 bar, ½ / 2 / 4
selectable; track hits marked on the grid as a reference (**Off until the user picks a track**: Q3). The user "almost always" runs
LFOs in FREE mode.

**The user's answers to §15 (2026-11-02, binding; the words they picked).** Q1 Add over 100 %: **"Clip flat"** (not the first
guess). Q2 the name: **"Combiner (Recommended)"**. Q3 the kick marks: **"Nothing until I pick"** (not the first guess). Q4 when
stopped: **"Yes (Recommended)"**. Q5 and Q6 were not asked: their first guesses stand and stay listed as first guesses. The body
follows them (§3, §6.3, §6.7; §18).

**Base ⟨B⟩.** `canvas` **51464be** (Cut B, MOD1, SX0 live). Line references are to ⟨B⟩; the lead re-checks them at phase 0. Tags as
IMPL-MOD1: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C]
with a reason in §17, never an [R]).

**Standing rules.** Browser first (no iPad app rebuild; its node tests stay in the sweep). No per-stage iPad session. The lean shape: a
contract first, phase 0, builders in worktrees reset to the phase-0 commit (`git log -1` checked: the harness makes worktrees from
`main`'s ee2a939), two reviewers, failing-test-first fixers, one sweep, one test file at a time
(`node --max-old-space-size=2048 --test tests/<file>.test.mjs`). **No Fable**: Opus 5.5 for the engine and judgment lanes, Sonnet for
the mechanical lane and one-file fixers. Chrome for Testing only (downloads denied, its own `--user-data-dir`, killed after). Never
touch `main`. Original content only. "Push it live when it's done."

**Invariants**
- **D1 Nothing existing changes.** A project without a combiner compiles, posts and renders byte for byte as at ⟨B⟩: no payload,
  message, key or sample differs (FR1 and FR1b hold as written). Every golden and frozen ref stays exact. The DSP diff is additive
  (mod-core.js, sx-mod.js's new exports, engine.js's two message fields that exist only with a combiner, §5): on the audio path one
  guarded block (`cmbN !== 0`) and one more FAST_A key — no sample, message or allocation differs without a combiner (§18 P3-1).
- **D2 The worklet combines; the page never feeds a knob.** The combined signal is computed in ModCore per chunk (4 base frames, the
  rate every canvas modulator runs at), live and in the bounce alike (the same payload: export = playback). No page-side value
  (`{t:'mval'}`, a timer) ever reaches a knob for it.
- **D3 The picture is drawn from the same math.** The face's curve calls the DSP scripts' own functions (the LFO laws, the combine law)
  on a preview synced from the same payload (§6). No LFO law is re-implemented on the page: the read laws (swing, PHASE, direction,
  shape) are the DSP's own functions; the clock's closed forms (`lfoClock`) live in sx-mod.js beside offLfo / freePos, written from
  their expressions, and G4 holds the two equal (§18 P3-2). The playhead and the live dot read the
  heard frame (`heardFrame()`, frame-stamped, main.js:6296 [R]).
- **D4 Seams untouched.** Cut B (motion.js, the fast lane's rules, sx-host, IMPL-MOD1 §7's list) and MOD1's faces: only the 'mods'
  part gains a field (§5.3); motion.js is used, not edited.
- **D5 No schema step.** A combiner is a modulator device (a new kind) plus ordinary `track.mods` rows (§2). Nothing existing stored
  changes.
- **D6 Inputs are LFOs only**, each LFO at most once per combiner, every input on the one IN jack.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at ⟨B⟩; "→" what they force)

| piece | where [R] | → LC |
|---|---|---|
| **ModCore's span.** Per Track span, before any Inst: `SD.begin` (every processor LFO per chunk into `g[src·32 + c]`), then (1) the value sources 8–23 into g rows 62–77 (glided per chunk), (2) the pseudo-voice's matrix at the span ends, (3) ext: global sources copied from g into `MC.ext` per chunk for the Serum-engine knobs, `mread` while `mon`, (4) the rows' sums per target | mod-core.js:332–420 ((1) :338, (2) :349, (3) :369, `mread` :384, (4) :385); header :17–64 | a combiner's value is one more g row, written **after (1) and before (2)**: the matrix, ext and every target read it as they read a CC (§5.1) |
| **The value sources.** CP sources 62–77 (`ext1…16`), 16 a track (`VAL_N`), fed by `vals` / `MC.ctl`, taken by CC modules and macro knobs past 8 | cv-graph.js:520; mod-core.js:28–31, :338–347 | the combiner takes one (§4) |
| **Source polarity.** LFO sources and `ext1…16` are both unipolar (`SRC_POL2` marks chaos, noise, bend, mpex, the audio taps, vmod only) | sx-base.js:223–225; the row law sx-mod.js:204–215 | a combiner with one input at +100 % gives a knob the same row value as the LFO cabled directly (G2) |
| **The LFO kinds.** mode FREE → processor FREE (`K_OFF`) when GLOBAL, per-voice FREE (`K_FREE`) otherwise; RETRIG / ENV → processor (`K_MONO`, restarted by every note-on) when GLOBAL, per voice (`K_VOICE`) otherwise. Processor LFOs live in g; per-voice ones on the pseudo-voice | sx-mod.js:148, :949–952, :1331–1345, :1400–1401 | the combiner reads processor LFOs from g: its inputs run GLOBAL in ModCore (§4.2) |
| **The phase laws.** BPM + ANCHOR: `x = start + beat / beats` (song beat while playing, the processor beat clock while stopped); Hz + ANCHOR while playing: anchored to `start + songSeconds · hz` at ▶ / seek / wrap, integrated between; otherwise integrated (`p += dt · rate`). ▶ resets every processor LFO to `lfoStart` and re-locks the anchored ones | sx-mod.js:410–416 (`lfoHz`), :1086–1112 (`offLfo`), :1140–1170 (`freePos`), :1295–1309 (`begin`'s beat clock, the jump rule), :1419–1434 (`transport`, :1423) | every GLOBAL FREE LFO is a closed form of the song beat (anchored) or linear in frames (not anchored) between events: a whole bar can be predicted exactly (§6) |
| **Tempo.** Every track's payload carries `bpm` (Cut B's `bpmPay`), ModCore's `m.bpm` | main.js:468–473; mod-core.js:199–202 | the laws run at the project tempo, stopped or playing (FR8) |
| **The DSP scripts on the page.** The same 17 scripts are injected on the main thread (`wk.loadDSP`) for the panels' displays; `globalThis.SxMod` exports `attach, sync, …, snap, fastRead, effAt, ModV` | main.js:924–930; wk.js:3533–3552; sx-mod.js:2188–2191 | the page can run the very same law code on a preview (§5.4, §6) |
| **The compile.** `compileMods` → `{t:'mods', …, rows, ext, vals, keep, left, slots, n}`, memoised on `sigOf`; LFO slots go only to sources a row needs (`take`), 10 a track incl. linked Serum-engine LFOs (`slotState` twins); keep-alive rows keep every evaluated source evaluated; `buildMods` posts `{off: true}` when rows, ext and vals are all empty | cv-graph.js:145, :396–410, :592–613, :634–767 (keep rows :762); main.js:455–461 (:457) | the combiner's inputs, value slot and payload block (§4); the off rule learns it (§8.6) |
| **Rows.** `track.mods` / `project.master.mods`: `{id, src, dst, amt −1…1, bi, curve, aux, inv, byp, out, acurve, crv, rise, fall, slink}`; `src` `'<dev>.<port>'` or `'<dev>/<lfoN>.out'` (a Serum-engine LFO, a link row); `dst` `'<dev>:<param>'`; deleting a device drops every row from or to it | song.js:661–662, :680–693; cv-mods.js:493–509; cv-model.js:358–376, :498–560 | an input cord is a row `src → '<id>:in'`: its `amt` the input's amount, its `byp` the mute (§2.2) |
| **destOk.** Any modulator kind is refused as a destination (`NOMOD_MOD`); faces mark every control `data-nomod` | cv-mods.js:622–640 (:626); cv-mods-ui.js:362 | `'<id>:in'` is the one modulator destination, for LFO sources only (§2.2) |
| **The mod drag.** `beginMod` marks every registered jack `cv-no` and every `[data-dest]` under a `[data-dev]` the host's test accepts `cv-ok`; release on one → `onMod(src, dst)` → `modConnect` (one step "Modulate … with …"); a mod rope may also land on a compatible cord input (the Amplifier's LEVEL) | cv-cables.js:1444–1470, :1497–1507, :1683–1690; main.js:10539–10614 | the IN is a `[data-dest="in"]` drop target, not a registered jack (§8.3) |
| **Cords and stacks.** On a Wavecraft canvas `cordOf` draws the rig's internal edges, its own rows and link rows from its modules' jacks as physics cords; several cords at one jack stack on its socket (the newest on top, a press grabs it, a touch long-press → "Which cord?") with a discreet count chip at ≥ 2; a knob end goes in behind the knob's rim; a track modulator's rows stay lines (MOD1 §6) | main.js:9203–9214, :9256–9280, :9407–9464; cv-cables.js:885–905, :1313–1318, :1715 | the combiner's rows are cords on a Wavecraft canvas, lines elsewhere; its IN stacks like a jack (§8.3) |
| **The faces.** Plain faces on the RIG grid without a SerumHost: `MOD_FACE`, `plainFace`, `bodyFor`; `MOD_COLS`; widths `faceW(cols)` = 64·cols + 32; screens 112 / 128; colours from the skin's display tokens (`--sxd-bg / grid / mute / ink / wave / on / cur`, `dispPalette`) | cv-mods-ui.js:66–73, :130–162, :500–514; cv-mods.js:468; rig-grid.js:17–31; sx-ui-osc.js:95–120 | the combiner is a seventh plain face (§7) |
| **The module.** `MOD_W` from `MOD_COLS` over `MOD_ORDER`, `MOD_H` (Tidy's guesses), `SX_MODS` (height = content), `modX`, `modJacks` (every kind one inline `out`) | cv-module.js:88–126 | `'comb'` in each (§8.2) |
| **Monitoring.** `mcMonitor` subscribes `'mods'` (fast too); the slow `{t:'smon', mc, mcx}` and the fast `{t:'fast', F, mc, x}` map onto bodies through `pay.slots`; `MC_KINDS` / `MC_FAST` | main.js:10105–10155; engine.js:5149, :5184, :4236, :3572 (Track), :5512, :5532 (MASTER) | one more field on each, only with a combiner (§5.3) |
| **The heard clock.** `heardFrame()` one `outFrame` per rAF, frame-stamped; `heardTickNow()` = the song tick at the heard frame (wrapped in the loop) or the cursor while stopped; `PPQ` 960, `barTicks = PPQ·4·num/den`, bpm in quarter notes | main.js:6296–6307; audioclock.js:73–82; song.js:16, :102–103 | the playhead and the window's grid (§6) |
| **The tiles and the master.** `MOD_TILES` (LFO · Envelope · Macros first), `MASTER_MODS` lfo / macro / cc / chaos; the master's `normMasterDev` **drops any other kind** | cv-tray.js:715–724; song.js:703–716 | `'comb'` joins both (§2.1, §8.1) |
| **Schema** 17 | cv-migrate.js:129 | stays 17 (§2.4) |

---------------------------------------------------------------------------------------------------------------------------------

## 1. Where the combining runs — decided [C]

| option | consequence | verdict |
|---|---|---|
| **A. Compile-time expansion** (one row per input onto each target knob; Multiply through a row's aux) | Add only, Multiply only for two inputs; a cable's curve / bipolar / slew / output act per input, not on the sum, so the knob would not get the picture; a target's row budget × inputs | rejected |
| **B. The page computes the value and posts it** (`{t:'mval'}` as a CC) | a UI-side approximation feeding a knob: arrival-time jitter, stops with a hidden tab, the bounce cannot reproduce it | rejected (D2) |
| **C. A ModCore value source** — the combiner's output is one of the track's value sources (CP 62–77), written per chunk from its inputs' g rows after the value glide, before the matrix | chunk-exact; every target (classic, panel, FX, a Wavecraft's knob through ext, the master's rack) reads it like a CC; live ≡ bounce by the payload; no Serum-engine change; existing payloads unchanged | **chosen** |
| **D. A native Wavecraft part** (a new source in the Serum engine) | changes the Serum engine and state (`NSRC` 78 fixed, W2), only inside a Wavecraft | rejected |

So **one module, one host**: the combiner is a track (or master) modulator device evaluated by ModCore on every canvas, a Wavecraft's
included. Its inputs are LFOs evaluated by the same ModCore (a Wavecraft's own LFO through the linked-slot twin it already gets when it
drives anything outside the Wavecraft, cv-graph.js:396–410 [R]).

---------------------------------------------------------------------------------------------------------------------------------

## 2. Data (phase 0) [C]

### 2.1 The device
- **Kind `'comb'`**, id prefix **`x`**, numbered (`x1`, `x2`, …: `MOD_MULTI`), label **"Combiner"** (titles "Combiner n", Q2).
- `normModDev` branch: `{ kind: 'comb', mode: 'add' | 'mul' (default 'add'), win: 0.5 | 1 | 2 | 4 (bars, default 1), mark: null | { t:
  <track id ≤ 16> | '', n: −1 (every note) | 0…127 } (null = **Off**, the default: Q3 "Nothing until I pick", §6.7), name? }`.
  Anything else falls to the defaults.
- **The master** takes it: `MASTER_MOD_KINDS` + `'comb'`, `MASTER_MOD_RE.comb = /^x[1-9]\d{0,5}$/` (song.js:703–704).
- Registries (cv-mods.js:461–474, cv-cables.js:78–94): `MOD_LABEL`, `MOD_PREFIX`, `MOD_MULTI`, `MOD_ORDER` (**last**, after chaos: no
  existing kind's order moves), `MOD_COLS.comb = 6` (faceW 416), `ID_KIND` / `kindOfId` / `keyKind` (`[lemchx]`), `MOD_COLOR`,
  `srcDev` (`'x1.out'`), `perNoteOf` → false (GLOBAL); cv-graph `MOD_KINDS` (lane E). `addModDev` seeds `{ kind: 'comb' }`.

### 2.2 The inputs are rows
- A cord from an LFO into the IN is a **row `{ src, dst: '<id>:in', amt, byp }`** in `track.mods` (`project.master.mods` on the master).
  `amt` −1…1 = the input's amount (a negative amount flips that input, §3); `byp` = mute. The other row fields keep their defaults and
  mean nothing here (the inspector hides them, §8.4).
- **`destOk(comb, 'in')` → ok** (checked before the `NOMOD_MOD` refusal); every other id of a combiner → `NOMOD_MOD`.
- **`cmbSrcOk(t, src, id)`** (cv-mods.js, new) → `{ ok, why }`: ok for a track LFO's `'lN.out'` and a Serum-engine LFO's link
  `'iK/lfoN.out'`; refused with "A combiner takes LFOs" (Envelope, Macros, CC, Chaos, the wheel, Velocity, Aftertouch, Bend, Note, a
  pad, another combiner — no cycles), "That LFO is already plugged in" (a row with the same `src → <id>:in` exists).
- **`inputsOf(t, id)`** (cv-mods.js, new) → the rows into `<id>:in` in `t.mods` order: the face's list order and the payload's.
- The default amount of a new input: **+100 %** (`addMod` for a combiner destination; not the knob rules).
- Deleting the combiner drops its rows in and out (cv-model `dropRows(t, id, true)`, cv-model.js:358–364 [R]); deleting an input LFO
  drops its input row the same way; removing a Wavecraft LFO's module drops its link rows [R?: H pins the rig's own removal path].

### 2.3 Numbering and history
- Titles from the id's number (MOD1's rule): "Combiner 1", "Combiner 2"; deleting one leaves the others' numbers.
- History as every modulator: add, remove, move, fold, Tidy, a cord in or out, a mode / window / marks pick — one step each; an amount
  gesture one step at its end (live writes and the 66 ms throttled repost while it moves, the cable-amount precedent); a mute one step.

### 2.4 No schema step
- `SCHEMA` stays **17**. A project without a combiner saves byte for byte as before.
- **An un-updated tab (a schema-17 build at ⟨B⟩)** opening a project with combiners: a track's `comb` device is kept as plain data
  (normModDev's unknown-kind rule, song.js:643 [R]) and its rows kept (they pass `normMods`); nothing compiles them, the rest plays. A
  **master** combiner is dropped by that build's `normMasterDev` (song.js:712 [R]). Recorded (§16), not guarded: the canvas site's
  saves "need no care" (the user, SX0) and a bump would make every newer save read-only in such a tab. **Phase 0 confirms it by
  booting ⟨B⟩** (a scratch worktree of 51464be, tests/main-sim.mjs) on a fixture with a track and a master combiner: it opens with
  no throw and no console error, the rest plays, and writes the result in §17 (the user, ROADMAP 28: an old canvas project "must
  still open"; a read of song.js / cv-graph.js alone misses the canvas's own walks — §18 P2-7).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The combine law (lane E owns; one function, used by the worklet and the page) [C]

Inputs k = 1…n, each with its LFO's value `x_k` ∈ [0, 1] (the processor LFO's g value: SMOOTH applied, what an ext feed reads; a
direct classic / panel cable of a FREE GLOBAL LFO also fades in per note by its RISE / DELAY through the pseudo-voice, sx-mod.js:1969–1977
[R] — the combiner does not: §16, G2) and
its effective amount `a_k` ∈ [−1, 1] (0 when muted):
- `c_k = a_k · x_k` for `a_k ≥ 0`, `−a_k · (1 − x_k)` for `a_k < 0` (a negative amount is the inverted LFO at that depth).
- **Add** (Q1, the user: **"Clip flat"**): `y = clamp01(Σ c_k)` — the plain sum, its top clipped flat at 1, never scaled down; the
  picture draws those flat tops exactly as the knob gets them (§6.3).
- **Multiply**: `y = clamp01(Π (1 − |a_k| + c_k))` — each input a gain at its depth (a muted one × 1).
- **No input, or every input muted: `y = 0`** in both modes (the combiner's cables then do nothing).
- **Identity (exact):** one input at +100 % (any others muted) gives `y = x` bit for bit in both modes (0 + 1·x, clamp01(x) = x on
  [0, 1]; (1 − 1 + 1·x) × 1 …). The code evaluates in that order (the sum from 0, the product from 1); G2 holds it.
- `ModCore.combine(mode, n, a, x, ax, xx)` (pure, mod-core.js's IIFE export): the arrays and offsets given, no allocation. The worklet's
  span and the page's preview call this one function.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The compile and the payload (lane E: cv-graph.js) [C]

### 4.1 What takes slots
- A combiner is compiled when it has ≥ 1 input row or ≥ 1 output row (the face shows its truth before its OUT is cabled).
- **The value slot**: one of the track's 16 value sources (`VAL_N`, shared with CC modules, macro knobs past 8 and mod pads), taken
  **after every existing need** — the modules', the pads' (cv-graph.js:680 [R]: they come after the modules today) — so a combiner
  never moves or evicts another value source (§18 P1-5). It reaches the CP as an `ext<j>` source, so `anyExt` sets compileSerum's
  `ctx.ext` (cv-graph.js:745–764 [R]) and `m.extOn` (sx-mod.js:919): the pseudo-voice reads g rows 62–77 only then (sx-mod.js:1957).
  Over budget: the first OUT cord is refused at the drop (§4.2's rule) with VALS_FULL's words (cv-model.js:397); a later edit that
  leaves it `left` uses the existing code `'slots'` (there is no `'vals'` code).
- **The OUT rows** compile as a value source's do (a CC's path): a synthetic row reading `62 + k − 8` onto a classic / panel / FX knob,
  an ext entry `{ k, src: 62 + k − 8 }` onto a Serum-engine knob. Nothing new downstream.

### 4.2 The inputs run GLOBAL
- An input needs a ModCore LFO slot that is **processor-evaluated** (g):
  - a GLOBAL track LFO → **its own slot** (shared with its direct cables);
  - a PER NOTE track LFO, or a Serum-engine LFO (link) whose state is per voice → **a GLOBAL twin**: a slot keyed `<src>#g` holding the
    same state with `mono: 1` (cv-graph `slotState` + `writeSlot`, cv-graph.js:396–420 [R]);
  - a GLOBAL Serum-engine LFO → its linked slot (shared with its link rows).
- Every input slot gets a keep-alive row (cv-graph.js:762 [R]), so `begin` evaluates it whatever reads it.
- **Order and the limit (§18 P1-5).** An input LFO nothing else needs, and every twin, takes its slot **after every existing need**
  (after the links, cv-graph.js:681 [R]): plugging an input never moves or evicts another cable's slot. At the limit the new input
  is **refused at the drop** — no row, no step, the words "That LFO can’t join: this track runs 10 LFOs" — modConnect's existing
  rule (main.js:10578 [R]: a new row that compiles `left` is removed and told) and cv-model addMod's pad precedent (:506–509 [R]).
  A `left` input (`why: 'slots'`) arises only from a later edit elsewhere (an LFO set PER NOTE, a new cable): the face greys its
  line with the reason (§7.1). A module used only through its twin: `pay.slots[id]` points at the twin's slot, so its own face's
  playhead keeps moving (§18 P3-9).
- **The key and the memo**: `mode` and the input rows (with `amt`, `byp`) are in `sigOf` and the key; **`win` and `mark` are not** (view
  only: a window pick never recompiles or reposts).

### 4.3 The payload block
```
pay.cmb   [{ id, k (value table 8…23), mode (0 add | 1 mul), in: [{ row, src (the CP source index), l (slot 0…9), a (−1…1; 0 bypassed) }] }]
          — absent (not []) on a track without combiners: D1's byte-identity
pay.slots[id] = { kind: 'comb', i (offset into the monitor block), n (inputs) }
pay.left  += { id: <row id>, why: 'slots' }          (a later edit's; a new cord over budget is refused at the drop, §4.2)
```
Inputs `left` are absent from `in` (no slot); muted ones are present with `a: 0` (the view draws them faint).

---------------------------------------------------------------------------------------------------------------------------------

## 5. The worklet (lane E: mod-core.js, sx-mod.js, engine.js) [C]

### 5.1 The span
- `setRows`: reads `cmb`, validates it before writing anything (E6's rule), allocates the per-combiner arrays (`a`, source rows) and the
  monitor block; clears `vUse` for the combiners' value slots, so step (1) skips them with no change to `span`'s loop.
- `span`: **after step (1), before step (2)**, for each combiner and each chunk `c`: `g[(62 + k − 8)·32 + c] = combine(…, g[src·32 + c] …)`.
  No allocation (tests/modcore.test.mjs's noAlloc technique). The pseudo-voice, ext and the targets read the row as they read a CC's.
- `pvOn` unchanged: a combiner read only by Serum-engine knobs runs on `begin` alone, as a GLOBAL LFO through ext does.
- Without `cmb` not one instruction on the audio path changes (D1; FR1 / FR1b; every golden).

### 5.2 The monitor block (while `mon`, at the span end)
`MC.cb` Float64Array(Σ (1 + 3·n_j)), per combiner in payload order: `[y, then per input: x, r, v]`:
- `y` the combiner's output at the last chunk;
- `x` the input's **clock**: unwrapped cycles (cycle + phase, before swing, PHASE and direction) at the last chunk [R?: E pins the
  fields per kind — `oPh` / `oCy` on the fast path, `freePos`'s clock on the general one; offLfo, the fast path, keeps no `oCy`
  (sx-mod.js:1086–1114 [R]) and needs none: it runs only without PHASE, direction and swing, so the phase alone is the clock];
- `r` its rate in cycles per base frame (`lfoHz(m, l, E, sc) / base`);
- `v` its value at the last chunk (its g value).

### 5.3 Messages (engine.js; additive, only when `MC.cmbN > 0`)
- The Track's and MASTER's slow post: `{ t: 'smon', mc, mcx }` **+ `cF`** (`this.frames` at the post) **+ `cb`** (engine.js:5149,
  :5184, :5532 [R]).
- The fast `'mods'` part: `{ t: 'fast', F, mc, x }` **+ `cb`** (engine.js:4236, :5512). A payload with combiners **replaces** the
  part's message object (built at :3572) with one that carries `cb`, its hold reset (`h.w = null`) — **never a key added to the live
  object**: fastSame / fastKeep read `w[k].length` for every FAST_A key, so a twin made before `cb` existed throws on the audio
  thread (engine.js:3593–3616 [R]; §18 P1-4). `'cb'` joins FAST_A, so the idle rule sees it (a message without `cb` skips the key:
  FR1b unchanged); `m.cb` is re-pointed at `MC.cb` per post, as `m.mc` is.
- No other message changes; no `{t:'fastOn'}` change; a project without combiners posts exactly ⟨B⟩'s messages.

### 5.4 The preview API (the page's "same math")
**`ModCore.preview(pay, sr)` → P** — a page-side ModCore (`create` on a stub Track, `setRows(pay)`), nothing posted, nothing ticked:
- `P.lock(l)` → `'song'` (FREE + ANCHOR, BPM or Hz: a closed form of the song beat while playing) · `'time'` (FREE without ANCHOR:
  linear in frames) · `'note'` (RETRIG / ENV: restarted by every note-on of the track, sx-mod.js:1690–1693 [R]; on the master, which
  plays no notes, `'time'` from ▶: ▶ resets every processor LFO's phase, cycle and S&H draws, sx-mod.js:1423, :757 [R] — ENV mode
  runs once from ▶) ·
  `'rand'` (S&H, Lorenz, Rossler types);
- `P.playX(l, b, b0)` → the clock at song beat `b` when ▶ starts at `b0` (▶'s reset and the anchored closed forms, sx-mod.js:1423,
  :1092, :1144–1150 [R]);
- `P.read(l, x)` → the raw value at clock `x` (swing pairs, PHASE, direction, the shape table or the point law, ENV mode's loop) —
  **the functions the processor law calls** (sx-mod.js `startPh` / `swingMap` / `readPos` / `rawOf`, :399–500, `rawOf` :486 [R]), exported
  additively as `SxMod.lfoRead(sx, l, x)`;
- `P.rate(l)` (cycles per base frame at the payload's tempo), `P.tau(l)` (SMOOTH's time constant in s, 0 = none: the coefficient law
  of `offLfo`, sx-mod.js:1099–1104 [R]), `P.destroy()`.
- Additive SxMod exports only (`lfoRead`, `lfoClock`, `lfoLock`, `lfoTau`); `snap` / `fastRead` / every existing export untouched.
- **P is keyed by the CP** (`cpKey` + the CT key + bpm), not by the payload key: an amount / mute / mode change never rebuilds it
  (the amounts come from the payload's `cmb`). `ModCore.warmPayload` stays as it is (§18 P3-5).

---------------------------------------------------------------------------------------------------------------------------------

## 6. The view (lane F: lc-view.js, new) [C]

### 6.1 The window
- Song beats on the x axis (quarter notes = ticks / PPQ), value 0…1 on the y axis.
- `W = win · barBeats` (`barBeats = 4·num/den`); the window is `[floor(b / W)·W, + W)` around `b` = the heard beat while playing,
  the cursor while stopped. ½ bar = half bars.
- The grid: bar lines, the signature's beats (`4/den` quarter notes), sixteenths faint. Beats outside the loop while it plays are
  dimmed (not played this pass).

### 6.2 The inputs' curves (steady ones exact)
For each input slot `l`, at ≤ `W_PTS` = 512 points across the window (the screen's device width if smaller):
- **Playing, `'song'`**: `x(b) = P.playX(l, b, ·)` — exact, no data needed.
- **Playing, `'time'`**: `x(b) = x_a + (F(b) − F_a)·r` from the newest monitor anchor (`F_a`, `x_a`, `r`), `F(b) = Fh + (b − b_h)·60·sr / bpm`
  in this pass. Exact while nothing restarts the LFO (a payload change or ▶ re-anchors at the next post: §6.6).
- **Stopped (every steady input)**: `x(b) = P.playX(l, b, cursor)` — **how it will play from the cursor** (▶ resets and re-locks every
  processor LFO, §0). Q4.
- **`'note'`** (between notes `'time'`): drawn from its newest anchor, **dashed** (a note may restart it). **`'rand'`**: its current value
  `v`, flat, dashed. Q5.
- The value: `P.read(l, x(b))`, then SMOOTH when `P.tau(l) > 0`: **the DSP's own recurrence at the chunk rate** (4 base frames,
  offLfo's coefficient `1 − exp(−dt / (0.5·sm³))`, sx-mod.js:1099–1104 [R]) from the newest anchor's `v` when time-locked, else
  warmed ≥ 14 τ before the window, sampled at the display points: exact (≤ 1e-6) after the warm-up. A one-pole at the display
  step is not (a square's edge inside a 4 ms step leaves ≈ 0.3 at SMOOTH 0.3: §18 P2-1). If G6's recompute bound fails at 6 × CPU,
  a SMOOTHed input draws dashed — never claimed exact.
- A `'time'` input before its first anchor (≤ one slow post after the face shows) is not drawn; the part of a window before ▶ in
  this pass is dimmed (not played).

### 6.3 The sum
`ModCore.combine` over the inputs' values at each point (the payload's amounts): the curve the knob gets. Dashed where it depends on a
dashed input. Add clips flat at 1 (Q1 "Clip flat"): the drawn sum is the clamped one, its flat tops exactly where the knob's are
(no unclipped ghost line in cut 1).

### 6.4 The playhead and the dot (every painted frame)
- **Playhead**: `heardTickNow()` (main.js:6307 [R]) → its x; a solid line while playing, dashed at the cursor while stopped.
- **The live dot**: the worklet's `y` read at `Fh` from a motion.js ring (kind LIN, n = 128) fed by every `cb` (slow at ≈ 29 Hz with
  `cF`, fast at the lane's rate with `F`), guarded by `R.live(Fh, sr)`. It sits on the curve when the picture is right; it is the truth
  when an input restarts or draws at random. While stopped the dot is a level mark at the left edge (the knob moves; the grid does not).

### 6.5 Each input faint behind the sum
In its cord's colour (cv-cables `MOD_COLOR` / the rig's cord colour), alpha by |amount|, a muted input dotted at the lowest alpha, an
input `left` not drawn. The sum in `--sxd-wave`, 2 px.

### 6.6 When to redraw the curves (never per frame)
On: the payload key (`P` rebuilt once per key, one P per track shared by its combiners), the window moving to the next window, ▶ / ■ /
a seek / the loop changing, the tempo, the signature, a skin switch, a resize, the device's `win` / `mark`, and a `'time'` input whose
newest anchor disagrees with the extrapolation by > 1e-6 cycle, compared modulo 1 (a restart, a re-assigned slot). An amount / mute /
mode change re-runs only the combine over the inputs' cached value arrays (≤ 512 × n: no P rebuild, no curve recompute). Per frame
only the overlay (playhead, dot): no allocation, no layout read.

### 6.7 The marks (the reference hits)
Small ticks at the screen's foot for the chosen track's hits in the window: `mark = null` → **Off** (Q3, the user: **"Nothing until I
pick"**); a pick in the face's Marks menu: Off, a track (every note), a drum machine's sound (its rows). The host expands roll notes
in the song's clips and a drum machine's own pattern hits through drum-core's "Pattern to notes" reader (`rollPlan` / `toNotes`,
drum-core.js:1634, :652 [R]) — page data, no engine. Marks are the first thing to move to cut 2 if H runs long (the head keeps the
button's slot; nothing else waits on them).

---------------------------------------------------------------------------------------------------------------------------------

## 7. The face (lane F: cv-mods-ui.js) [C]

### 7.1 The recipe (the RIG grid, `MOD_COLS.comb = 6`, 416 px)
- **Head** (32): MODE `Add | Multiply` (a seg), WINDOW `½ 1 2 4` (a seg), MARKS (a menu button: the chosen track / sound, "Off").
- **Screen** (`'L'` 128 px, full width): two canvases — the curves (§6.1–6.3, 6.5, 6.7) and the overlay (§6.4). A hint "Plug LFOs into
  IN" while empty.
- **The list**: one 32 px line per input (min one line: the hint), no gaps between lines: colour dot + name ("LFO 2"; a Wavecraft's
  LFO by its module's title) over 3 columns, AMOUNT (a number box, ±100 %, drag / keys / type) over 2, MUTE (a toggle) over 1; a tap
  on the name opens: Mute / Unmute, Unplug, Select the cord (the list is the IN's cord picker: no "Which cord?" on the socket in
  cut 1). A `left` input greyed, its reason as the line's tip ("The track runs 10 LFOs"). An input the combiner cannot hear as
  its own face shows it wears a small "≈" with the reason as its tip: RISE / DELAY set ("Rise and Delay act per note: not in the
  Combiner"), a Wavecraft LFO whose rate / phase / shape knobs are under a cable ("Its modulation stays inside the Wavecraft")
  (§16; §18 P1-3, P2-3).
- **Jacks**: `<in` left (label "IN Σ", tip "any number of LFO cords"), `>out` right. The IN wears the discreet count (≥ 2): on a
  cords canvas the cord layer's counts map (§8.3), elsewhere the face's own chip in the same `.cv-jn` look (no lines-mode count in
  cv-cables).
- The list may need a row type rig-grid lacks: F builds it in its own recipe (`h` numeric, layoutOf's own path) [R?]; any rig-grid.js
  change is additive and keeps every existing layout byte for byte (fx-ui, rig-ui), noted in §17.
- Elements ≤ 24 + 6·n (G7). Every hit ≥ 44 px on touch.

### 7.2 The body API (cv-mods-ui `bodyFor('comb', o)`)
- `o` (from H): `doc, devKey, shown, get, edit(fields)` (mode / win / mark, one step), `heardFrame, sampleRate, song()` → `{ bpm, sig,
  playing, tick (heardTickNow), cursor, loop: { on, start, end } }` (ticks), `inputs()` → `[{ row, src, l, name, color, amt, byp, why }]`,
  `setAmt(row, v, phase)` (`'move'` live, `'end'` the step), `setMute(row, on)`, `unplug(row)`, `select(row)`, `payload()` (the track's
  last posted payload or null), `marks(t0, t1)` → ticks, `markList()` → `[{ value, label }]`.
- Returns `{ el, face, jacks, update(v), sync(), menuItems(), value(), destroy() }`. `update({ F, cb, i })` (one reused object per
  body, mcFast's precedent): pushes the block's `y` into the ring and keeps the newest anchors; change-gated; no allocation.
- **A clock client** (`wk.clock.add({ name: 'lc', el, live, fn, shed: true })`): live while `shown()` and (playing or the ring live);
  not essential (reduced motion: 10 fps). Off screen or idle: no client.
- **DSP not loaded yet** (the page's scripts are lazy): the face draws its grid and waits for `wk.loadDSP()`, then draws. lc-view.js
  is imported on demand beside it (`import('./lc-view.js?v=9')`, the slot faces' way, cv-mods-ui.js:368 — tools/precache.mjs
  follows literal `import()`s): the boot graph stays as it is.
- **The overlay** (playhead, dot): F picks a canvas or two transformed elements (compositor only, no per-frame paint) by G6's
  numbers; either way nothing allocates per frame.

### 7.3 Skins and words
- The screens from `dispPalette(el)` (`--sxd-*`), the chrome from the skin's rig tokens under `.cv-mod[data-cv-face=""]` (MOD1's mark
  and its `:where(:not([data-cv-face="gl"], …))` guard, IMPL-MOD1 §15 lane U). Charcoal, ivory, glass (glass neutral: no blue; blur off
  on Low). A skin switch moves no box.
- Words: Combiner, IN, OUT, Add, Multiply, Window, Marks, Mute, Unplug; no "Serum", no "Xfer" (G8).

---------------------------------------------------------------------------------------------------------------------------------

## 8. The host (lane H: main.js, cv-module.js, cv-modlayer.js, cv-cables.js behaviour) [C]

### 8.1 Where it lives
- A **Combiner** tile in the Modulators view (after Macros) and in `MASTER_MODS`. On **every canvas**: any track (a Wavecraft's
  included: a track device there, `modAdd`, never `rigAdd`) and the master. `modTile('comb')` → `modAdd`; never a replace.

### 8.2 The module
`MOD_W.comb = faceW(6)`; `MOD_H.comb` (Tidy's guess: the face at one list line + the bar); `SX_MODS` (height = content, measured);
`modX`; `modJacks('comb')` → the inline `out` only (the IN is not a registered jack: §8.3); `MOD_ORDER` (cv-module.js's copy) last;
`costOf` a plain face's 40 + 8 per input line [C]. Tidy stacks it at the column's end; on a Wavecraft canvas it stays in the left
column (MOD1 §6).

### 8.3 Cords and lines
(Re-planned, §18 P2-4: reuse what the cord layer and the drag already do; no new stack code, no cv-cables drop-target change.)
- **The IN is a drop target of the modulation drag**: `[data-dest="in"]` under the module's `[data-dev]` (never `data-nomod`), drawn
  as a socket. cv-cables already hands the dragged source to the host's test (`call(Op.markDests, D.src)`, cv-cables.js:1437 [R]);
  main's `markDests` drops it today (main.js:10612 [R]) and now passes it on, so `modMarks(src)` lights the IN `cv-ok` **only for an
  LFO not yet plugged**. A release → `onMod(src, '<id>:in')` → `modCan` (+ `cmbSrcOk`, the words of §2.2) → `modConnect` (one step
  "Plug LFO 2 into Combiner 1"; its existing left-row refusal is §4.2's limit). On a Wavecraft canvas the rope from a Wavecraft LFO's
  cord jack lands there the same way (beginCord → beginMod, cv-cables.js:1497–1507; the link-row path, main.js:10541–10546 [R]).
- **Cords** (a Wavecraft canvas): a link row into the IN is a cord already (cordOf, main.js:9209–9213 [R]); H adds the combiner's
  rows to cordOf (a track LFO's input, the OUT rows: a knob end at the rim, as a rig LFO's) and **one anchor branch** in the cord
  layer's list: an end `'<comb>:in'` resolves as a **jack end**, not a knob end — the socket's centre, stacked (the newest on top,
  the stack's existing order rule), its count in the layer's counts map (cv-cables `counted`, :885–905 [R]). No "Which cord?" and
  no press-to-grab on the IN in cut 1: the face's list is the cord picker (Mute, Unplug, Select).
- **Lines** (every other canvas): lines converge on the IN's centre as on a knob; the count is the face's own chip (§7.1).
- **No amount badge on an input row** (one flag on its record; one jack, many cords): the amounts live in the face's list. An OUT
  row keeps its badge.
- A tap on the IN (no drag): "Connect to…" with the track's LFOs not yet plugged (`modSrcPick`'s precedent); a tap on an input cord
  selects it and highlights its list line.

### 8.4 The inspector, the Mod list, menus
- An input row's inspector: Amount, Mute (the row's Bypass, worded Mute), Disconnect — the curve / bipolar / output / aux / slew fields
  hidden. The cord's long-press menu: Mute / Unmute, Disconnect.
- The Mod list reads "LFO 2 → Combiner 1 · IN". The knobs' source menus (press-and-hold, Connect to…) list each combiner as a source
  (it is a `MOD_LABEL` kind).

### 8.5 Monitoring
`MC_KINDS` / `MC_FAST` + `'comb'`; `mcSnap` / `mcFast` map `cb` through `pay.slots[id]` (`i`, `n`) into `B.update({ F, cb, i })` (the
slow one's `F` = `cF`). The `'mods'` monitor is wanted while a combiner face is shown (its `live`).

### 8.6 The rest
- `buildMods`' off rule (main.js:457 [R]): a payload with `cmb` is never `off` (one more term; without `cmb` the same test).
- `modMount('comb')` builds §7.2's `o`; titles "Combiner n"; the master's path through `MREC` (IMPL-MM) as every master modulator.
- Undo / redo of every act in §2.3; Tidy; fold; delete (rows in and out, one step).

---------------------------------------------------------------------------------------------------------------------------------

## 9. The iPad / WebKit
- **The fast lane is off in WebKit** (`FAST_WEBKIT = 0`, IMPL-FR-B §6). The view needs no fast data: song-locked inputs are closed
  forms, time-locked ones extrapolate from the slow anchors (`cF`, ≈ 29 Hz), and the dot reads the slow ring at `Fh` (WebKit's
  `outDelay` ≥ the ring + `outputLatency` keeps bracketing anchors; else the ring's bounded EXTRA). The playhead is the heard clock.
- **Cost**: the worklet's combine is a few multiply-adds per chunk per input (G6's `lc` row); the page's per-frame work is one line and
  one dot; a curve recompute only on a change (§6.6), ≤ 512 points per input (a SMOOTHed input at the chunk rate: G6 bounds it); one
  preview P per track with a shown combiner, rebuilt per CP key (§5.4) — an amount drag re-runs only the combine over cached arrays.
- Measured on the Mac with CPU throttling (G6); the iPad pass after the features re-measures.

---------------------------------------------------------------------------------------------------------------------------------

## 10. The frozen ref (new: tests/ref-LC/)
`tests/ref-LC/record.mjs` (lane E writes it) renders a fixed project: a Juno-60 with three track LFOs (BPM ¼ anchored, Hz 0.7 FREE
not anchored, a Path LFO with SMOOTH) into **Combiner 1 Add** (amounts +100 / −50 / +30) → its cutoff; a Wavecraft with three of its own
LFOs (one per voice) into **Combiner 2 Multiply** → its filter cutoff and a panel Utility's pan; the master with two LFOs into a
combiner → a master Delay's mix; 128 BPM, 8 bars, a 2-bar loop wrapping once. Live (`sim.run`, per-node output) and bounce hashes,
**recorded once by the lead at integration** into `tests/ref-LC/*.sha`, compared exact by `tests/golden-lc.test.mjs` from then on.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Gates

| gate | what | target |
|---|---|---|
| **G1 nothing existing changes (D1)** | every golden (classic / fx / presets / random / graph / 606 / 909 / drums / sdsv / moog ×3) and frozen ref (p1, 1c, 7a–7d, 9 / 9-core / 9b / 9c, M, MM, P, SC, SX0, WC — `node --max-old-space-size=2048 tests/ref-WC/record.mjs` exact) in the sweep, with master-proc, engine-track, canonical-stream, canvas-M-bounce, tempo-mods, fast-lane (FR1 / FR1b unchanged), motion; a project without a combiner: the same payloads, keys and messages as ⟨B⟩ (a sim over the 2b fixture tracks, the master's MM fixture); reviewer 1 reads the DSP diff (additive; nothing on the audio path without `cmb`) | exact |
| **G2 identity** (re-planned, §18 P1-3) | one input at +100 % (others muted) in Add and in Multiply, its OUT onto a knob ≡ the same LFO cabled directly with the same row, rendered **bit for bit**, live and bounced, for **GLOBAL** sources with RISE = DELAY = 0 (a direct classic / panel cable of a FREE GLOBAL LFO fades in per note through the pseudo-voice, sx-mod.js:1969–1977 [R]; g — what the combiner and ext read — does not): a Juno cutoff (cls), a panel FX knob (fx), a Wavecraft's filter cutoff (ext: any RISE / DELAY), the master's Delay mix; a GLOBAL track LFO, a GLOBAL Wavecraft LFO (its linked slot). A **twin** (a PER NOTE track or Wavecraft LFO) ≡ the same LFO switched GLOBAL and cabled directly — never the per-voice LFO (its PHASE / RISE / DELAY / SMOOTH per voice at the voice's half-ticked dt, sx-mod.js:1993–1995 [R]) | exact |
| **G3 the law** (node, `tests/lc-dsp.test.mjs`) | §3 (Add = the sum clipped flat, Q1) against a double reference over 2 000 random states (n 0…12, amounts ±, mutes, both modes) per chunk; empty / all muted → 0; the clip (sums over 1 flat at 1); the slot not glided; budgets (an 11th LFO input, a twin past 10, a 17th value source) → that input / OUT `left` `'slots'` and **every existing cable's slot unchanged** (the order rule, §4.1–4.2); no allocation per span; `cmb` absent → `ModCore.combine` never called (a spy) and the payloads / messages of ⟨B⟩ | exact |
| **G4 the view ≡ the worklet** (node, reviewer 1 re-derives) | lc-view's curve sampled at every quantum end over 8 s vs the worklet's `y` (the real Track + ModCore, `mon` on): playing at 120 and 140 BPM, BPM ¼ / dotted / triplet anchored, Hz 0.7 with and without ANCHOR, ping-pong, PHASE, a Path LFO, a 2-bar loop wrapping, a seek (swing: none — ModCore has no keyboard swing, sx-mod.js:926–929 [R], so a swung input is drawn and heard unswung); **SMOOTH 0 and SMOOTH 0.3 (the chunk-rate recurrence after its 14 τ warm-up, §6.2): \|Δ\| ≤ 1e-6**; stopped: the curve from the cursor vs the render after ▶ from it, the same bound; the master's case; dashed inputs ('note' after a note-on, 'rand') excluded and counted | bounded |
| **G5 heard time** (sims, `clock: 'std'` with a scripted heard frame; reviewer 2 in Chrome) | the playhead's x = the heard tick's within 0.5 px every painted frame; the dot = the ring at `Fh` (the fast lane on and off; WebKit's path = off); a seek / a wrap shows on the first frame whose `Fh` reached it (one frame of slack) | ≤ 1 frame |
| **G6 cost** | node / jsc bench row `lc` (a Track: 2 combiners × 5 inputs onto a Juno and a panel vs the same rows from the LFOs directly; IMPL-FR-B §2.7's paired interleaved medians with an A/A): Δ ≤ max(0.002, 2 × the A/A spread); tests/ui-bench-fps.mjs scene **`comb`** (a Juno canvas, 2 combiners × 4 inputs, one SMOOTHed, playing, 1 × and 6 × CPU, caps 60 / 120, fast on / off — trimmed, §18 P3-7): frame cost med ≤ 2 / p95 ≤ 4 ms at 1 ×, the face's per-frame work ≤ 0.1 ms, a curve recompute ≤ 4 ms at 6 ×, an amount move's re-combine ≤ 0.5 ms at 6 ×, nothing per frame while stopped and unchanged, the overlay probe moves on every painted frame at 1 ×; the `mods` scene A/B against ⟨B⟩ within 5 % | within |
| **G7 layout** (tests/ui-layout-wc.mjs extended; lane F in CfT) | the face at 0 / 4 / 12 inputs, 1440 × 900, 1366 × 1024, 1024 × 1366: width 416 = `MOD_W.comb`, the grid's rows, text margins, the fill band, contrast per skin (charcoal / ivory / glass), elements ≤ 24 + 6n, hits ≥ 44 on touch; a skin switch moves no box | exact |
| **G8 host** (tests/canvas-LC-sim.test.mjs, new) | the tile on a Juno / an 808 / a Wavecraft / the master adds a combiner (never a replace); drags onto IN: track LFOs, a Wavecraft LFO, a master LFO → rows; an Envelope / Macros / CC / Chaos / the wheel / another combiner / the same LFO twice → refused with §2.2's words, no step; an input past the 10 LFOs and an OUT past the 16 value sources → refused at the drop with §4's words, no row, no step, no other cable `left`; stacked cords and the count (cords and lines); the list (amount gesture = one step; mute; unplug; select); mode / window / marks = one step each, window / marks post nothing; undo / redo of each; delete the combiner → its rows go; delete an input LFO → its row goes; Tidy; numbering; save / load round trip; the off rule; a project without combiners byte-identical through load / save; no console error | exact |
| **G9 words** | a DOM scan of the face and its menus and the inspector: no "Serum", "Xfer"; the words of §7.3 | exact |
| **G10 the sweep** | every test file one at a time (2 GB each), after phase 0 and at integration | green |

---------------------------------------------------------------------------------------------------------------------------------

## 12. Lanes, order, models

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **phase 0** (the lead) | song.js (`MOD_KINDS`, the `comb` branch, the master kinds / regex), cv-mods.js (§2.1's registries, `destOk`, `cmbSrcOk`, `inputsOf`, `srcDev`, `perNoteOf`), **cv-graph.js's `MOD_KINDS` line only** (cv-model's `kindOf` / `setModState` and `validate` read it from phase 0 on, cv-model.js:98 [R]; §18 P2-5), cv-cables.js's data lines (`MOD_PREFIX`, `keyKind`, `MOD_COLOR`), cv-tray.js (`MOD_TILES`, `MASTER_MODS`, **`MOD_GLYPH.comb`**: original, stroked, two faint waves into one, **`MASTER_NOTE`'s words** — lane U's, folded in), cv-model.js (`addModDev`'s seed, `addMod`'s +100 % for `:in` and its budget check, the pad precedent), tests/lc-model.test.mjs (new, failing first), the moved pins (§13), §2.4's boot probe of ⟨B⟩, `precache --write`, the sweep | G8's model half, G9's tray words, G10 | **Opus 5.5** |
| **E** the engine | mod-core.js (§5.1–5.2, `combine`, `preview`), sx-mod.js (additive exports), engine.js (§5.3: the new message object, FAST_A), cv-graph.js (§4: the order rule, twins, the value slot, `sigOf` without `win` / `mark`), tests/lc-dsp.test.mjs, tests/lc-compile.test.mjs (new), tests/modcore.test.mjs, tests/fast-lane.test.mjs (a combiner scene: `cb` slow ≡ fast, FR1b), tests/bench-scenarios.mjs + tests/bench.json (row `lc`), tests/ref-LC/record.mjs, tests/golden-lc.test.mjs | G1's DSP half, G2, G3, G6's row | **Opus 5.5** |
| **F** the face and the view | cv-mods-ui.js (`bodyFor('comb')`, §7: the list, the IN's count chip, the "≈" marks), lc-view.js (new, §6; imported on demand, §7.2), style.css (only if the skins need a rule beyond MOD1's `[data-cv-face=""]` blocks — lane U's, folded in), tests/lc-view.test.mjs (new), tests/cv-mods-ui.test.mjs, tests/ui-layout-wc.mjs | G4 (with E's code at integration), G7 (the skin half too), G9 | **Opus 5.5** |
| **H** the host | main.js (§8: `markDests` passes the source, cordOf + the one anchor branch, the monitor mapping, marks through rollPlan / toNotes — the first cut-2 candidate), cv-module.js (§8.2), cv-modlayer.js (§8.4), cv-cables.js's behaviour (only the input rows' no-badge flag: no drop-target, stack or lines-count change), tests/canvas-LC-sim.test.mjs (new), tests/cv-module.test.mjs, tests/cv-modlayer.test.mjs, tests/cv-cables.test.mjs, tests/ui-bench-fps.mjs + .test.mjs (the `comb` scene) | G5's sims, G6's scene, G8 | **Opus 5.5** |
| reviewers × 2 | (1) **the real engine + sim**: D1–D6, G1, G2, G3, G4 re-derived, the bounce, the master, budgets, a 50-track project with 12 combiners opens (no throw, the memo holds); (2) **Chrome for Testing**: G5 (trace), G6, G7, G9, touch drags onto IN and two-finger cancel, the stacked IN and its count, the list as the cord picker, the three skins mid-animation, a power cycle, a hidden tab | — | Opus 5.5 × 2 |
| fixers | the finding's files, failing test first | | Sonnet (one file) / Opus 5.5 (across files) |

**Interfaces between the lanes** (fixed here): E ↔ H the payload (§4.3) and the messages (§5.3); E ↔ F `ModCore.combine` and
`ModCore.preview` (§3, §5.4); H ↔ F the body's `o` and API (§7.2). Each lane tests against fakes of the others' side; F's G4 runs on
E's code at integration.

**Order.** Phase 0 from ⟨B⟩ → **E ∥ F ∥ H** in worktrees reset to the phase-0 commit → integration by the lead (merge, `precache
--write`, a Chrome smoke: a Juno and a Wavecraft with a combiner each, the master; **record tests/ref-LC**) → the two reviews →
fixers → the sweep → deploy (`tools/deploy-canvas.sh`) → ROADMAP row 26 / HANDOVER → the user tries it.

**Rules.** `?v=9` on every import; new test files import `./v8-guard.mjs` first; never fake-DOM nodes in `assert.*`; one test file at a
time with `--max-old-space-size=2048`; no lane commits `sw.js`; DSP files only in lane E and only additively (a lane that needs a
sample change for an existing sound stops and says so); per-frame paths allocate nothing (reviewers grep for `new `, `[...`, `.map(`,
`.filter(`, `split(`, regex literals); Chrome for Testing only, downloads denied; no iPad app build.

---------------------------------------------------------------------------------------------------------------------------------

## 13. Pins that change by design (and the ones that must not)
**Move by design:**
- **phase 0**: the registries' pins — cv-mods.test (`MOD_LABEL`, `MOD_PREFIX`, `MOD_ORDER`, `MOD_COLS`, `kindOfId`, `destOk`'s modulator
  refusal now with the `:in` exception), cv-tray.test (`MOD_TILES` 10 → 11, `MASTER_MODS` 4 → 5, the glyph pins), cv-cables.test (`keyKind`),
  master-mods-model / song tests listing `MASTER_MOD_KINDS`, mod1-model (`MOD_COLS`' kinds), and whatever the sweep finds.
- **E**: modcore.test (the payload fields), fast-lane.test (a combiner scene added; the existing scenes unchanged), bench.json (row
  `lc` added).
- **F**: cv-mods-ui.test (`bodyFor`'s kinds), ui-layout-wc (the combiner face added).
- **H**: cv-module.test (`MOD_W` / `MOD_H` / `SX_MODS` / `MOD_ORDER` gain `comb`), ui-bench-fps.test (the scene list).

**Must not change:** every golden and frozen ref (tests/ref-WC/base.json included: its sessions hold no combiner); canonical-stream's
fixtures; FR1's message logs (golden-graph:244–260, master-proc:384–393, engine-track:160–167); tempo-mods; motion; canvas-FR-sim;
canvas-MOD1-sim; canvas-MM-sim's payload pins; bench.json's existing rows; app.test's worklet module count (no worklet module added).

---------------------------------------------------------------------------------------------------------------------------------

## 14. Risks
- **R1 The picture drifts from the sound.** Held by D3 (the DSP's own functions on a preview of the same payload) and G4; the dot is
  always the worklet's truth; inputs the picture cannot know (restarts, random types) are dashed.
- **R2 Budgets.** 10 ModCore LFO slots a track (cables and combiner inputs together, a PER NOTE input costs a GLOBAL twin), 16 value
  sources (CC modules, macro knobs past 8, mod pads, combiners). The combiner's needs come last, so it never takes an existing cable's
  slot; a new input or OUT over them is refused at the drop with the words (§4); Q6's first guess: 10 is enough.
- **R3 A Wavecraft LFO's twin.** While playing it equals the Wavecraft's own LFO (both re-lock at ▶; G2's link case). While stopped the
  two processors' beat clocks differ, so a Wavecraft LFO's own face and the combiner's input may show different phases. A Wavecraft's
  swing amount is not in the twin (ModCore has no keyboard swing, sx-mod.js:926–929 [R]): a swung Wavecraft LFO reaches the combiner
  unswung. The twin / linked slot copies the knob **bases** only (cv-graph.js:402 [R]): a Wavecraft LFO whose rate / phase / shape is
  under a cable (its own cords, a track row onto `iN:l3.rate`) reaches the combiner unmodulated — the picture still equals the
  sound; the input wears "≈" (§7.1). Recorded (§16).
- **R4 Old tabs** drop a master combiner (§2.4). Recorded, not guarded.
- **R5 The cord layer.** Cut to one anchor branch (`'<comb>:in'` as a jack end) and one cordOf condition, both reached only by a
  combiner's rows (§8.3); ref-WC's G12 and cv-cords' tests must stay exact (no combiner in them).
- **R6 Page cost on the iPad.** One preview P per track (an attached Serum modulation state), rebuilt per CP key only (an amount drag
  re-runs the combine over cached arrays); a SMOOTHed input at the chunk rate. G6 measures a recompute at 6 × CPU; if it fails, the
  SMOOTHed input draws dashed (§6.2).
- **R7 Chromium's short `outDelay`** with the fast lane off (reduced motion, a Frame-rate override): the dot extrapolates past the
  newest slow anchor (EXTRA, ≤ 2 intervals) — visible as a small lag, never a wrong value for long.

---------------------------------------------------------------------------------------------------------------------------------

## 15. Questions for the user (short; the build follows the answer, or the first guess where none came)
- **Q1 Add, over 100 %.** Two LFOs at full amount: squeeze the sum to fit, or let the top clip flat? First guess: squeeze to fit.
  **Answered (2026-11-02): "Clip flat".** Add sums and clips the top flat; the picture shows the flat tops (§3, §6.3).
- **Q2 The name.** "Combiner" (Combiner 1, 2 …)? First guess: yes. **Answered: "Combiner (Recommended)".**
- **Q3 The kick marks.** Show the drum track's kick on the bar by default, or nothing until you pick a track? First guess: the kick.
  **Answered: "Nothing until I pick".** No marks by default; you pick a track in the Marks menu (§6.7).
- **Q4 When stopped.** The bar shows how it will play from the song cursor. First guess: yes. **Answered: "Yes (Recommended)".**
- **Q5 Retrig LFOs.** An LFO that restarts on each note still combines; its line is dashed, drawn as if no new note came. **First
  guess: yes** (not asked yet).
- **Q6 How many.** One track runs up to 10 LFOs for its cables and combiners together. Enough for now? **First guess: yes** (not
  asked yet).

(No new question from the skeptic: what it found is recorded in §16 and shown on the face, so the user meets it by playing.)

(Settled, not asked: on every canvas and the master (MOD1's "one module everywhere"); a combiner into another combiner is refused (no
cycles; later if wanted); the window 1 bar with ½ / 2 / 4 and Add / Multiply are the row's first guesses; amounts in the face's list,
not as badges on the stacked cords (the user: "on its cord or in a list").)

---------------------------------------------------------------------------------------------------------------------------------

## 16. Known limits (recorded)
- **Chunk rate.** The combiner runs at ModCore's chunk rate (4 base frames), as every canvas modulator; classic targets read it at span
  ends (span rate), as every LFO on a classic knob.
- **GLOBAL inputs.** A PER NOTE or per-voice LFO enters the combiner as its GLOBAL twin (it follows the track's newest note, not each
  voice); the combiner's output is GLOBAL.
- **What the picture cannot know**: a RETRIG / ENV input's next restart, a random type's next draw — dashed; the dot is the truth.
  (The tempo is one project value: a change reposts and redraws, tempo-mods T1.)
- **What the combiner does not hear** (the picture agrees with the combiner, the input wears "≈", §7.1): an input's RISE / DELAY (they
  act per note on a direct classic cable, sx-mod.js:1969–1977; the combiner reads g, as an ext feed does); swing (ModCore has none,
  sx-mod.js:926–929); a Wavecraft LFO's rate / phase / shape under a cable (the twin copies the knob bases, cv-graph.js:402); a
  Wavecraft LFO while stopped runs on ModCore's clock, not the Wavecraft's (R3).
- **SMOOTH** is drawn by the DSP's own recurrence at the chunk rate (§6.2); dashed if that costs too much on the floor. Past
  **`SM_MAX` = 28 000 chunks** in the window (1 bar at 120 BPM with one SMOOTHed input stays exact; 2 bars, or 1 bar below ≈ 110 BPM, falls
  past it) the SMOOTHed input and the sum are drawn dashed by the display-step recurrence (fix round F).
- **The view's bound in practice** (reviewer 1, the real engine): playing, every steady input ≤ 2.9e-10 — except an edge that lands exactly
  on a chunk boundary (every BPM-synced edge at 120 BPM / 48 kHz), where the worklet's per-chunk sum and the view's closed form round one
  chunk apart: unsmoothed one chunk, SMOOTHed a decay over 14 τ, ≤ 3.8e-3 (under half a pixel; R1-4). **Stopped**, the curve from the cursor
  is the bounce's grid (▶ at chunk 0 on the cursor's beat); the live ▶ lands on the next 4-frame boundary unless the master aligns it
  (an effect or a sidechain there), so song-locked inputs sample up to 3 frames off, ≤ 8.8e-3 (R1-3). G4's 1e-6 holds elsewhere.
- **Touch hits** (§7.1 refined, fix round K): the Window's four picks are their own 30 × 44 px boxes — four 44 px bands in 120 px would sit
  off the boxes; every other head control and the IN / OUT hit ≥ 44.
- **Beats outside the loop** in a window are dimmed (not played this pass).
- **Old tabs** (schema-17 builds) keep a track combiner inert and drop a master one (§2.4).
- **WebKit / the iPad**: the dot reads ≈ 29 Hz anchors at heard time (the fast lane off, IMPL-FR-B §6) — every frame still moves it.
- **Min / Max modes**, a combiner into a combiner, Envelopes / Macros as inputs, "Which cord?" / press-to-grab on the IN, an
  unclipped ghost of the sum, exact S&H inputs after ▶ (their draws are seeded at ▶, sx-mod.js:748–757): later, if wanted.

---------------------------------------------------------------------------------------------------------------------------------

## 17. Notes (the builders fill in)

**Phase 0 (the lead's lane, 2026-11-02; on 4f802d0 = ⟨B⟩'s code).** Failing tests first (1acc9b2), then the code. What is in:
- **song.js**: `MOD_KINDS` + `'comb'`; normModDev's branch `{ kind, mode, win, mark }` (key order as written; a name kept as on every
  kind); `MASTER_MOD_KINDS` + `'comb'` (appended), `MASTER_MOD_RE.comb = /^x[1-9]\d{0,5}$/`.
- **cv-mods.js**: `MOD_LABEL.comb 'Combiner'`, `MOD_PREFIX.comb 'x'`, `MOD_MULTI` + comb, `MOD_ORDER` last, `MOD_COLS.comb 6`,
  `ID_KIND` / `kindOfId` `[lemchx]`; `srcDev` / `sourcesOf` / `modDevs` / `numsOf` / `modLabelOf` take it with no code change
  (`'x1.out'` kind `'comb'`, "Combiner 1", after the Chaos); `perNoteOf` false (no code: not a per-note kind); `destOk(comb, 'in')`
  ok, every other id NOMOD_MOD; **`cmbSrcOk`**, **`inputsOf`**, the words **`CMB_LFOS`** / **`CMB_TWICE`** (all re-exported by
  cv-model, the host's namespace).
- **cv-graph.js**: the `MOD_KINDS` line only.
- **cv-cables.js**: `MOD_PREFIX.comb 'x'`, `keyKind` `[lemchx]`, `MOD_COLOR.comb '#b5e05a'` (a lime of its own: eleven distinct).
- **cv-tray.js** (lane U's part): the tile `{ id: 'comb', name: 'Combiner', scope: 'track', multi: true }` after Macros; `MASTER_MODS`
  + comb (appended: = MASTER_MOD_KINDS; shown in MOD_TILES' order, the Combiner after Macros); `MOD_GLYPH.comb` (two faint waves,
  opacity .45, running into a junction ring, one full-strength wave out; stroked, no fill, no text); `MASTER_NOTE` "The master has no
  notes: its modulators are LFOs, Macros, Combiners, CC and Chaos. Drop one on the canvas and cable its OUT to any knob of the master
  rack." ("its OUT": the app's word for the jack, MOD1's "Then drag its OUT onto a knob").
- **cv-model.js**: `addModDev(t, 'comb')` → `x<n>` with normModDev's defaults (no code: the generic seed); `addMod` to `'<comb>:in'`
  (cmbIn): cmbSrcOk (code `src`; a device that is no combiner module, e.g. `l9` of kind comb, code `end`), the row at `amt` +1
  (`o.amt` −1…1) and `o.byp`, every other field normRow's default (`bi` 0, no curve: no knob rules); **the budgets as pre-checks
  (the pad precedent: a compile without the new row)** — an input is refused with **`CMB_FULL`** ("That LFO can’t join: this track
  runs 10 LFOs", code `slots`, no row, no id spent) when `pay.n.lfo ≥ 10` and it needs a slot of its own: a GLOBAL LFO / link when
  `pay.slots['l1' | 'i1/lfo3']` is absent, a PER NOTE / per-voice one when no **placed** input of another combiner comes from the same
  source (its GLOBAL twin, one per source); a combiner's OUT (`'x1.out'` onto a knob) is refused with VALS_FULL (code `slots`) when
  `pay.n.vals ≥ 16` and the combiner holds none (`pay.vals` id `'x1.out'`, or `pay.cmb[].id`). modConnect's left-row post-check
  (main.js:10578) stays the backstop.
- **For lane E** (what those pre-checks read — keep them true): `pay.n.lfo` counts every LFO slot incl. twins and inputs nothing
  else needs; a GLOBAL input's slot is `pay.slots['<lfo id>']` (as a direct cable's); one twin per source, shared by the combiners;
  the combiner's value slot counted in `pay.n.vals`, listed in `pay.cmb` (`id`). Until E lands, a combiner's OUT row compiles
  `left: 'slots'` (cv-graph's `take` has no comb kind: `alloc` null) and its input rows compile to nothing (validRows skips a `'mod'`
  destination) — so in the phase-0 app the host's post-check refuses every OUT cord; nothing without a combiner changes.
- **[C] refined**: `mark.t` is any track id song.js accepts (`validId`: `[\w.:-]{1,64}`) or `''` — "≤ 16" would drop a mark on a valid
  longer id at load; `n` an integer 0…127, else −1; a mark without a valid `t` → `null` (Off). `inputsOf` skips a row from no LFO of
  the track and a second row from an LFO listed already (one list for the face and the payload). The shared `combine` stays lane E's
  (§3: mod-core.js, a DSP file) — not in phase 0.
- **Pins moved beyond §13's list** (each one value, the rest of the file exact): canvas-MOD1-sim's tile list (boot test: §13 lists
  the file as must-not-change, but it pins `MOD_TILES`' order, which §13 moves — contract slip), the tile counts 10 → 11 in
  canvas-sim, canvas-2a-sim, canvas-2b-sim, cv-tray's rig-view glyph count 14 → 15, canvas-MM-sim's `MASTER_MOD_KINDS` (a list, not a
  payload pin), cv-module.test's `mkOf('x9')` null → 'comb' (lane H's file: cv-cables keyKind's prefix reaches it).
- **The ⟨B⟩ boot probe (§2.4, P2-7)** — a tree of 51464be (`git archive`, in the scratchpad), tests/main-sim.mjs + canvas-MOD1-sim's
  scripted world; the fixture built in that app (a Juno: LFO 1 on CUTOFF; a <NAME>: a track LFO on its cutoff; the master: an LFO on
  a Delay's MIX), then written in as a phase-0 build saves it: the Juno `x1` (Add: LFO 1 +100, LFO 2 −50 → its RES) and `x2` (Mul,
  window 2, marks on the <NAME> track; LFO 2 in muted → CUTOFF), the <NAME> `x1` (its own LFO 1 link + the track LFO → its RES),
  the master `x1` (window 4: the LFO → the Delay's MIX); opened through the app's file path (loadProject → applyRestore), every track shown, the master
  opened, notes played, saved again. **It opens: no throw, no console error, every other cable compiles and posts as before,
  both tracks play (peaks 0.1718 / 0.1595 — the same in the phase-0 build).** But it does **not** keep a track's combiner as §2.4 /
  §16 say: ⟨B⟩'s loadProject runs cv-migrate **splitTracks**, whose `single(t)` wants every device inst / panel / out / `'mod'` —
  a `comb` is `kindOf` null there — so the track is re-shaped: the instrument, its panel, OUT and the `'mod'` devices kept, the
  combiners **and every row into or out of them dropped** (rowsTo keeps rows ending on the instrument), with the notice "Track
  “Juno-60 1”: 5 modulation cables to nothing that survives were dropped · Track “<NAME> 2”: 3 …"; a save there writes them
  gone (their lay entries too). The master: `mdev.x1` dropped (normMasterDev, as §2.4 says), its two rows and `lay.x1` kept as
  orphans (nothing compiles them; the master posts its own cable only), saved back as orphans. So **an old tab (or the iPad app's
  older bundle) opens the project and plays everything else, and loses every combiner if the user saves there** — §2.4, §16 and R4
  understate it (track combiners are not kept inert). Not guarded (no schema step, the user's "need no care"); the lead may want
  the words in §16 changed. The same fixture in the phase-0 build: every device and row kept through load and save, the OUT rows
  `left: 'slots'` until E (above), no console error.
- (Recorded, unreachable today) the phase-0 build's splitTracks keeps a combiner on a split track's keeper (`'mod'`) but rowsTo
  drops its input rows (they end on the combiner, not the instrument) — only an old multi-instrument track could be split, and none
  holds a combiner.
- **For H / F**: `destOk(comb, 'in')` alone accepts any source (it knows no source): the IN's marks need `cmbSrcOk` (§8.3);
  main.js passes `masterMods: S.MASTER_MOD_KINDS`, so the master's tray shows the Combiner tile from phase 0 on (modAdd adds `x1` to
  `mdev`; no module mounts until H's cv-module `MOD_ORDER` takes `comb`).

**Lane E (the engine, 2026-11-02; on 1c99d07).** Failing tests first (fb8e977), then the code. What is in:
- **cv-graph.js** (§4): `cmbPlan` / `cmbPay`; one block after the links' line (no existing need moves: G3's order rule, lc-compile):
  each compiled combiner's value slot (`take(<id>.out, 'val')`), then — only for a combiner that got one — its inputs' LFO slots (key
  the LFO's own id when GLOBAL; **`'<src>#g'`** a GLOBAL twin when PER NOTE / per voice, its state with `lfo.mono = 1`, one per source,
  shared). The devs loop skips `comb`; the value table skips it (**a combiner's slot is not in `pay.vals`**: it has no host value;
  `n.vals` counts it). `pay.slots['<module>' | '<dev>/lfoN']` → the twin's slot when the source has no slot of its own (P3-9, links
  too). `sigOf` hashes a combiner's `mode` only. Without a combiner not one byte differs (D1 test; ref-WC G1 unchanged).
- **The payload (H / F read it)**: `pay.cmb = [{ id, k, mode: 0 | 1, in: [{ row, src, l, a }] }]` — present only when ≥ 1 combiner has
  a value slot (a combiner with none, or no combiner: no key); a combiner compiles with ≥ 1 input or an OUT row the compile needs (one
  with inputs only takes its value slot too: the face's truth). `pay.slots[<comb id>] = { kind: 'comb', i, n }` (i = Σ 1 + 3n of the
  combiners before it). `pay.left += { id, why: 'slots' }` for an input past the 10 LFO slots **and for every input and OUT row of a
  combiner that got no value slot** (§4.3 named the OUT's only); `left` is then sorted by `t.mods` (inputs are no `validRows`).
- **mod-core.js** (§3, §5.1–5.2, §5.4): `ModCore.combine` (exactly §3's order: c, then the sum from 0 / the product from 1; no input
  or every `a` 0 → 0); `setRows` validates `cmb` before anything is written (`cmbOf`, E6) and drops the value slots from `vUse`;
  `span` step (1b) `if (cmbN !== 0) { cmbSpan; if (mon) cbRead }` — the one guarded block; `MC.cmbN`, **`MC.cb`** per combiner `[y, then
  per input x, r, v]` — **y, x and v all belong to the span's last chunk, which starts at the post's frame − 4 (`cF − 4` / `F − 4`)**
  (lane F's LAG convention, matched at the lead's relay): **y** the combiner's value, **x** the input's clock at that chunk (FREE +
  BPM ANCHOR: the closed form at that chunk's beat, exact; otherwise the state the span left minus one chunk's advance, 4·r — ≈ 1e-16
  off the DSP's own sum), **r** cycles per base frame, **v** its g value (SMOOTH's state: the next chunk's is `v + (read(x + 4r) −
  v)·k`). On offLfo's fast path x is the phase alone (possibly just below 0 after the subtraction: read takes any x); elsewhere cycles
  + phase. `ModCore.preview(pay, sr)` → `{ lock, playX, read, rate, tau, destroy }` (a ModCore on
  a stub host, one `SerumDSP.begin` for the tempo); the caller keys it by the CP.
- **sx-mod.js** (additive exports): `lfoLock(sx, l, noteless)`, `lfoClock(sx, l, b, b0)`, `lfoRead(sx, l, x, gate)`, `lfoTau`,
  `lfoRate`, `lfoMon(sx, l, out, j)`. Pinned per kind: FREE (K_OFF) BPM + ANCHOR `start + b / beats`; Hz + ANCHOR (S2) `start +
  b·60 / bpm·hz` (re-anchored at ▶, a seek, a wrap); other FREE `start + (b − b0)·60 / bpm·hz` — **valid in the first pass from b0
  only: after a loop wrap a 'time' input continues in frames (the view uses the monitor anchor, §6.2)**; read adds PHASE (with the
  cycle) and applies DIRECTION. RETRIG / ENVELOPE GLOBAL (K_MONO): ▶ resets the phase to `lfoStart` (transport), **not startPh: PHASE
  enters only at a note's restart** — so on the master a RETRIG LFO's PHASE is never heard (the DSP's, modelled as is); BPM + ANCHOR
  from `startPh + (b − b0) / beats` after ▶'s first chunk; ENVELOPE one pass then its loop (gate 0 on the master: held at 1).
- **engine.js** (§5.3): FAST_A + `'cb'`; `cbPart` (message time only: modsMsg, modsOff, fastOn — Track and MASTER) gives the 'mods'
  part's object the cb shape while `cmbN > 0` (a new object, `h` reset, on every payload with combiners; the plain shape back after
  one without); postFast re-points `m.cb = mc.cb` (guarded `cmbN !== 0 && m.cb !== undefined`); the slow `smon` gains `cF:
  this.frames, cb` only with combiners (three posts). **`modsMsg`'s empty rule now counts `cmb`**: a payload with a combiner and no
  rows / ext (its OUT not cabled yet) builds a ModCore — H's buildMods off rule (§8.6) must not post `{off}` for it.
- **F's asks (the lead's relay)** all hold: `combine` reads `x[xx + j]` (the view's interleave `xx = i·n` works); `playX` ignores b0
  for 'song'; `read(l, x)` takes any unwrapped x, negative too, the ping-pong parity kept (floor; lc-dsp pins it); `pay.cmb[].in` row
  ids in `t.mods` order; cb's x / v at the last chunk (above).
- **Results** (one file at a time): lc-compile 6/6, lc-dsp 8/8 (G3 law over 2 000 states exact; the span exact; G4's E half: the
  preview ≡ the worklet at every chunk of 8 s, worst ≤ 1e-6 — song and time inputs, a wrap, SMOOTH 0.3 by the chunk-rate recurrence on
  a hard-edged shape), lc-engine 19/19 (**G2 bit for bit** in Add and Multiply: Juno cutoff live + offline, a panel knob, a rig's
  cutoff through ext with RISE / DELAY, a GLOBAL rig LFO's linked slot onto the Juno, **the rig's own LFO onto its own cutoff (native
  vs the combiner — N2 holds through it)**, a PER NOTE twin ≡ the LFO switched GLOBAL, the master's Delay mix live + offline; the
  messages; G6 node Δ 0.00044 (on 0.0477, A/A spread 0.0002; gate 0.002)), fast-lane (+ a combiner scene: FR1b, cb fast ≡ slow at
  hz 30), modcore (+1). jsc: not measured (the row's targets are estimates).
- **tests/ref-LC/record.mjs** written (§10's project, live through main-sim + the app's bounce) and dry-run on this tree (compare
  mode: both renders audible, every combiner compiled, nothing left; `LCDBG=1` prints the steps); **not recorded** —
  tests/golden-lc.test.mjs fails with the instruction until the lead runs `record.mjs --write` at integration (on the merged tree).
  One §10 deviation: the Utility sits on the Wavecraft's **own FX** (`i1:fx.util.pan`, an ext row) — a rig track keeps i1 → OUT on
  load, so a panel wired after it was re-shaped away (its rows dropped); the Wavecraft is added on a second track with the Juno
  shown (a shown rig's cord layer is WebGL, which the node page cannot draw), the faces' clock answered by a getClientRects stub.
**Lane F (the face and the view, 2026-11-02; on 1c99d07).** Failing tests first (0c4208d), then the code.
- **cv-mods-ui.js**: `combBody` (`bodyFor('comb')`), `combRecipe(n)` / `CMB_FACE` (6 columns: head 32 · screen L · the list
  32·max(1, n) — a row layoutOf already takes (numeric `h`), laid by the face's own builder: **no rig-grid.js change** · jacks: IN Σ
  col 0, OUT col 5). `MOD_FACE`'s six untouched. The face's pieces in `MOD_CSS` (MOD1's plain-face convention); **style.css
  unchanged**: MOD1's skin blocks carry every token the face reads (glass neutral by its tokens: white sum, champagne cursor).
- Head: Mode (Add | Multiply) and Window (½ 1 2 4) as radio groups of plain buttons (a wk seg is 7+ elements: the budget is met
  exactly at 0 inputs, 24), Marks a button over `wk.contextMenu` (`o.markList()`; Off by default, Q3). One `o.edit` per pick.
  The overlay is a canvas (one element, the budget), clearing only its last boxes.
- List: a line per row in `o.inputs()` order — name (its cord's colour dot, `--rig-cc`; "≈" with `apx`'s words as its tip),
  amount (a spinbutton: drag 1 %/px, Shift × 0.1, 'move' per change and one 'end'; keys ±1 / ±10 / Home −100 / End +100, an 'end'
  each; Enter / double-click types; a two-finger cancel ends at v0), MUTE. The name's tap: Mute / Unmute, Unplug, Select the cord.
  A left row greyed, its tip "The track runs 10 LFOs". `highlight(row)`. The count chip (`span.rig-cn`, the `.cv-jn` look) **beside**
  the IN, not on its rim (the gate's 6 px text-to-control margin), at ≥ 2 rows when `!o.cords()`.
- **[C] refined (§7.1 "every hit ≥ 44 px on touch")**: a line is 32 px with no gap (§7.1), so a 44 px hit would take the next
  line's presses: each line control's hit is its line's band (32 px) × its column (≥ 56 px); the head's are 44 px (inside the row
  gaps). The gate checks both; reviewer 2 may weigh it.
- **lc-view.js** (new, on demand): `timeline`; `inputCurve` — a point's value is its CHUNK's (the chunk holding its frame: ModCore's
  grid at frames ≡ 0 mod 4 while playing; stopped, ▶'s chunk 0 on the cursor's beat, the bounce's); SMOOTH by offLfo's recurrence at
  the chunk rate (s = y at ▶'s chunk — oInit —, the anchor's v for a time-locked input, else a 14 τ warm-up; points further apart
  than that restart theirs); a later pass's warm-up before the loop start reads the loop's end; `sumCurve`; previews keyed cpKey |
  CT key | bpm | rate, counted; `createView` (§6.6's keys in a Float64Array; a repost on the same preview and inputs only
  re-combines; nothing allocated per frame or per post; `restyle()` at a host's sync repaints a new skin, never recomputes).
- **[C] the anchor**: cb's x / v are the LAST chunk's, the chunk starting at F − 4 (F = cF slow, the fast F): lc-view's `LAG = 4`.
- G4's node half on a stand-in (tests/lc-stub.mjs: §3's combine and §5.4's API over stub laws, a worklet model): ≤ 1e-6 (worst
  1.2e-9, the square under SMOOTH 0.3) at 120 / 140 BPM, a 2-bar loop wrapping, Multiply, stopped from the cursor. The stub's shapes
  are table-read as the DSP's (a hard step flipped by a 1e-16 phase rounding at an edge on a chunk).
- G7 (tests/ui-layout-wc.mjs, CfT, 1440 × 900 / 1366 × 1024 / 1024 × 1366): **green** — 0 / 4 / 12 inputs: 416 × 312 / 408 / 664,
  fill 0.619 / 0.691 / 0.781, elements 24 / 41 / 73, every text ≥ 4.5 : 1 on its own ground (charcoal: 13.07 the labels), the
  margins, the lines in their columns, the hits; a skin switch moves no box. Its page draws on the stand-in while the page has no
  `ModCore.preview`; `--lc` writes the face per skin.
- Cost (node, the stub's P — a floor): a recompute of 4 inputs (one SMOOTH 0.3) at 512 points 0.47 ms (1 bar, 120 BPM) · 2.7 ms
  (4 bars, 60 BPM); a re-combine ≤ 0.008 ms. The SMOOTHed input's chunk loop dominates (24 000 chunks a bar at 120 BPM): G6's 6 ×
  bound is H's scene to measure on E's P; past it, §6.2's fallback (dashed) is one flag.
- **For E**: `combine(mode 0 | 1, n, a, x, ax, xx)` (the view interleaves: `x[xx + k]`, `xx = i·n`); `preview(pay, sr)` → P with
  `playX(l, b, b0)` ('song' ignores b0), `read(l, x)` for any unwrapped x (negative too; the cycle's parity for ping-pong), `tau` in
  s; `pay.cmb[].in` with row ids in t.mods order; cb's x / v at F − 4 (else say the offset: one constant).
- **For H**: §7.2's `o` plus — `song()` ONE reused object (a frame allocates nothing) carrying `start` (the tick this run began at:
  ▶ or the last seek) and `pass` (the loop pass since then, 0 the first; without them no "before ▶" dimming, the warm-up assumes no
  wrap); `inputs()[k].apx` ("≈" words, '' none) and `why`; `cords()`; `B.sync()` after an edit, undo, a skin switch, ▶ / ■ / a seek,
  the tempo, signature, loop (it repaints while shown); a `setAmt(row, v0, 'end')` after moves back to v0 is no step; `B.inJack`
  (the IN: a jack end's centre), `B.highlight(row)`, `B.update({ F, cb, i })` (F = cF on a slow post), `B.face.h` (follows the
  row count).
**Lane H (the host, 2026-11-02; on 1c99d07).** Failing tests first (ff23a29), then the code. What is in:
- **cv-module.js**: `comb` last in `MOD_ORDER` (so `MOD_KINDS`, `SX_MODS`, `MOD_W.comb` 416, `modX` −512 follow); `MOD_H.comb` 352 (Tidy's
  guess: top 12 · head 32 · screen 128 · one list line 32 · jacks 56 · bottom 16 + the bar, gaps 12); `modJacks('comb')` the inline OUT
  alone; `costOf` 40 + 8 per input line (cv-mods `inputsOf`, re-read at every sync). The IN is no jack: its rows' end is `destPort('x1',
  'in')`, the face's `[data-dest="in"]` centre (lines converge there; no knob rim: a modulator's module has no `wires`).
- **cv-cables.js**: the one flag — `modCables` sets `nobadge: true` on a row into a combiner's IN (`keyKind` comb and the device a comb;
  absent on every other record), the layer keeps that badge hidden (`vis()`).
- **cv-modlayer.js**: host.budget kind `'comb'` → an input's inspector (`data-input`): Amount (slider + box), **Mute** (the row's `byp`,
  steps "Mute" / "Unmute"), Disconnect; bipolar, curve, Custom…, output, aux, slew, Save with preset hidden; its header the LFO slots. The
  Mod list: "2 inputs · LFO 3/10", lines "LFO 2 → Combiner 1 · IN · +100%" (" · muted").
- **main.js**: `buildMods`' off rule `|| (pay.cmb && pay.cmb.length)`; `markDests: src => modMarks(src)` (a combiner's IN lit only when
  `cmbCan`: destOk + cmbSrcOk, a Serum-engine LFO's jack as its link); `modCan` → `cmbCan`'s words before anything else for a combiner end
  (a <NAME>'s own macros: "A combiner takes LFOs" too); `modConnect`'s step "Plug LFO 2 into Combiner 1" (addMod's CMB_FULL / VALS_FULL
  and its left-row post-check as before); `modLabel('x1:in')` "Combiner 1 · IN"; `cordOf`'s one condition (`cmbRow`: a row into a
  combiner's IN — a track LFO's too — or from its OUT) and `isKnobEnd`'s one branch (`'<comb>:in'` a jack end: plug s 0, stacked, the
  layer's count; no badge placed); `toCord` gives a track modulator's cord its kind's colour (an LFO the rig LFO's, the Combiner the
  default) — no existing record changes (none came from a track modulator); the input cord's menu: Mute / Unmute (one step "Mute LFO
  2") after cv-cables' Disconnect; its tap selects it, no inspector (the face's line is the picker); the Mod list lists combiners with
  inputs; the module ⋯ takes the body's `menuItems()` first; `MC_KINDS` / `MC_FAST` + comb, `mcSnap(tid, mc, mcx, cb, cF)` / `mcFast` →
  `cmbFeed`: one reused `{ F, cb, i, n }` per body through `pay.slots[id]` (no bodyAns gate: the face's ring takes slow and fast).
- **The body's `o`** (`cmbHost`, §7.2, also `__synthTest.cv.mod.comb(key)`): `doc, devKey, shown, get, heardFrame, sampleRate, edit(fields)`
  (modEditState: one step "Edit Combiner 1"), `song()` (ONE object reused per body: `{ bpm, sig: [num, den], playing, tick:
  heardTickNow(), cursor, start, pass, loop: { on, start, end } }` — lane F's asks: `start` the tick this run began at (▶ or the last seek:
  T.startPos; stopped the cursor), `pass` its loop pass from 0 (heardPass − the run's: a seek in a loop starts again)), `inputs()` →
  `[{ row, src, l (−1 none), name, color, amt, byp, why ('slots': the face words it), apx }]`, `setAmt(row, v, phase)` (`'move'` live under
  N.modsHold, `'end'` / `'set'` one step "Mod amount" — none when the moves came back to where they began —, `'start'`, `'cancel'` the
  value back and no step), `setMute(row, on)` ("Mute LFO 2" / "Unmute LFO 2"), `unplug(row)` ("Unplug LFO 1"), `select(row)`, `payload()`
  (null when off), `marks(t0, t1)`, `markList()` → `[{ value: null (Off) | { t, n } (what edit({ mark }) takes), label }]`; **extras**
  (not in §7.2's list): `selected()` (the selected cable), `cords()` (true on a cords canvas: the IN's count is the layer's there, the face's
  chip elsewhere), `connect(el)` ("Connect to…" with the LFOs not yet plugged; none: "Every LFO of this track is plugged into Combiner 1"),
  `inputs()[].apx` (the "≈" tip: RISE / DELAY set — "Rise and Delay act per note: not in the Combiner" —, a Wavecraft LFO whose knobs are
  under a cable — "Its modulation stays inside the <NAME>"), `update`'s `n`.
- **The body** (lane F's asks): `B.sync()` once a frame (`cmbSoon`, a rAF) after every row / state edit (cvModAfter), ▶, ■, a seek (the
  cursor too), a tempo / signature / loop change (reanchor), a skin switch; at once on undo / redo / load (cvModSync). `B.highlight(row |
  null)` on every cable selection (an input's: its line; anything else: none). `B.inJack` (F's `[data-dest="in"]`: destPort's end, its
  centre) takes the IN's tap: click / Enter / Space → "Connect to…" (`cmbPick`), its press never the world's.
- **Marks** (cut 1, in): the marked track's notes in [t0, t1) (n −1: all) and its drum machines' own pattern hits while SYNC is on
  (rollPlan / toNotes), sorted ticks.
- **Pinned [R?]**: removing a Wavecraft LFO's module whose link row feeds a combiner is refused while in use (rigRemove's `sxUsed`:
  RC.WORDS.inUse) — the row is never orphaned. Numbering: cv-model `addModDev` goes past the highest (x1, x3 → x4), every kind's rule.
- **Tests** (canvas-LC-sim, new, 19: 14 pass, 4 skip until lane E, 1 until lane F (its face in the host: probed on a scratch merge of 5cc26e3 — green, with cv-mods-ui and lc-view) — the OUT's drop, the off rule, mode / window / marks posting, the
  monitor feed; with a temporary stand-in for E's pay.cmb / slots / key they pass but the OUT, whose value slot is E's); cv-module (+1, pins
  moved: MOD_ORDER / MOD_KINDS / MOD_H / MOD_W 11), cv-modlayer (+1), cv-cables (+1). Green one file at a time: those, main, canvas-sim,
  canvas-MOD1-sim, canvas-WC-sim, canvas-MM-sim, canvas-FR-sim, canvas-2a-sim, canvas-2b-sim, cv-tray, lc-model, lint, golden-graph, pwa.
  **On a scratch merge of E (ed7aabd) + F (5cc26e3) + H** (conflicts only in this file and sw.js; precache rebuilt): canvas-LC-sim
  **19 / 19, no skip**; lc-model, lc-compile, cv-mods-ui, lc-view, main, canvas-sim, canvas-MOD1-sim, canvas-WC-sim, canvas-MM-sim,
  canvas-FR-sim, canvas-2a-sim, canvas-2b-sim, cv-cables, cv-module, cv-modlayer, cv-tray, fast-lane, golden-graph, lint, pwa green.
- **Not done (H's in §12, not in this brief)**: ui-bench-fps's `comb` scene (G6) — it measures F's face; at integration.
- **Found (pre-existing, not LC)**: song.js `normTrack` lifts a track's `nid` past its highest device number at load (an `l2` → nid 3),
  so a project whose modulator numbers reach its nid changes once on its first load / save round trip, stable after.
- **For E**: H reads `pay.cmb[].id`, `.in[].row`, `.in[].l`; `pay.slots[id] = { kind: 'comb', i, n }`; `pay.left` (`'slots'`); `cmb`
  absent without combiners (the off rule tests `pay.cmb && pay.cmb.length`); `cb` / `cF` on the slow post beside `mc` (deliver needs `mc`
  as today), `cb` beside `F` and `mc` on the fast one; `win` / `mark` outside `sigOf` (canvas-LC-sim checks no repost).
- **For F**: the IN a `[data-dest="in"]` socket under the module root (no `data-nomod`, no `data-twin`): the drag's target, the lines' and
  cords' end; `update({ F, cb, i, n })` one object per body; `menuItems()` (optional) heads the module's ⋯; the IN's tap is the host's
  (listeners on `B.inJack`).

**Lane G6 (the `comb` fps scene, 2026-11-02; on cf8adc3, d30211c).** tests/ui-bench-fps.mjs only (+ its .test pins: 9 scenes, the comb test).
- **The scene** (`BUILD.comb`, the app's hooks as `mods`): a Juno; 8 track LFOs, GLOBAL FREE (BPM ¼ / ½ / ⅛ / 1 bar anchored, Hz 0.7 /
  0.4 / 2.1, Hz 1.3 Path with SMOOTH 0.3 — their state through `cv.mod.comb(l).edit` = modEditState, an LFO's own step), off screen;
  Combiner 1 Add 1 bar (+50 / −30 / +40 / +25 %, the SMOOTHed input in it) → cutoff, Combiner 2 Multiply 2 bars (+60 / +50 / +70 / +40) →
  resonance (`setAmt(row, v, 'set')`, `edit({ mode, win })`); the combiners and the Juno framed; 128 BPM, chords playing. **EXPECT**: one
  entry, the two overlays `[data-rig-kind="comb"] canvas.rig-cov`, rate `'eff'`, min 2 (paintOverlay draws a new playhead x every frame:
  ≥ ¼ px a frame at 2 bars / 240 Hz); the curves are not expected (on a change only: counted by the probe, 0.4–0.8 / s = the window's turn).
- **The probe** (`combProbe`, the driver's checks `comb probe 1x` / `6x` at cap 120 and `comb stopped`): each view's `frame()` wrapped (the
  `lc` client's callback is shownNow + frame()), the overlay's moveTo(x, 0) per delivered frame, the curves' paints; a recompute =
  `V.dirty(2) + V.frame()` × 15 and the host's own `o.edit({ win })` there and back (the frame after it); an amount move = `o.setAmt(row,
  v, 'move') + V.dirty(1) + V.frame()` (the face's recombine) × 15, then `'cancel'`; the combine alone (lc-view `sumCurve` on the cached
  arrays). Numbers are wall ms in Chrome for Testing, d 1440 × 900, runs with `--fast on` and `--fast off` (`--no-cross`).
- **G6 vs targets**: frame cost at 1 × med 0.28–0.485 / p95 0.37–0.715 ms (≤ 2 / 4: **pass**; 6 × med 1.03–1.38, p95 1.93–2.68); the
  overlays live in every cell, moved on **1.0** of the frames at 1 × (**pass**); the face's per-frame work med 0.005–0.025, p95 ≤ 0.04 ms
  at 1 × (≤ 0.1: **pass**); a curve recompute at 6 ×, Combiner 1 (the SMOOTHed input): med 2.89 / 3.10 (≤ 4: **pass**), max 4.8–5.3, and
  **the window edit 1 → 2 bars 6.4–7.4 ms (FAIL)** (back to 1 bar ≈ 4.1; Combiner 2, no SMOOTH: med 1.1–1.3, its edits ≤ 1.7; at 1 ×
  Combiner 1 0.68–1.0, 1.2 at 2 bars); an amount move at 6 ×: **the view's part (the combine + the curves' repaint) med 0.40–1.25 ms
  (≤ 0.5: FAIL)**, the combine alone ≈ 0.005, the host's setAmt 0.01 (1 ×: 0.11–0.14) — the repaint is the cost, not the combine;
  stopped: ■ with the engine on, the curves 0 paints and the overlay only when its level mark moved (0 unmoved paints) — the FREE GLOBAL
  inputs run on, so the dot moves and the `lc` clients stay (§7.2 "live while … the ring live": by design); ⏻ off: no `lc` client, 0
  frame(), 0 paints (**pass**). No console error, no build note.
- **mods A/B** (bench.json's ui-fps-mac row is at 8f35d70, before MOD1: it has no mods cells): ⟨B⟩ 51464be by `git archive` in the
  scratch, its own harness, interleaved × 3 with this build, d, fast on: 1 × med 0.445 → 0.43 (cap 60, −3.4 %), 0.34 → 0.345 (120,
  +1.5 %), p95 equal (**pass**, ≤ 5 %; the A/A spread ≈ 15 %); 6 × within its throttle noise.
- **For the lead**: the recompute FAIL is §6.2 / R6's named one — the SMOOTHed input's chunk loop over a 2-bar window (its fallback:
  that input dashed); the amount-move FAIL has no named fallback — the curves' full repaint per move (grid, 4 faint inputs, the sum at
  ≤ 512 points) is the cost, the combine is not (one idea: the sum's line on a canvas of its own). No source changed here.

**Fix round (lead's list A–M, 2026-11-02; on 306100d).** Failing test first for each, then the code, then the reviewers' own repros (copies
of review2's scripts in the scratchpad's fix-scratch/r2: their R2 path only changed). One commit per item or pair, 3d62b87 … the last.
- **A (R1-1)** lc-view `inputCurve`: the clock at ▶'s chunk F0 (pass 0, start known) is `P.playX(l, b0, b0)` itself — never rebuilt from
  the heard line or a later anchor. Test lc-view "(R1-1)" (a stub hard 'step', song- and time-locked, ▶ on an edge, 97 / 133 / 151 BPM:
  0.83 → ≤ 1e-6). Repro g4-real "120 BPM SMOOTH 0.3 ▶ frame ≡ 2": every playing line ok (x2 0.466 → 5.5e-9); its stopped lines still fail by
  R1-3's 1.5e-4 / 7.8e-4 (recorded, not this fix); "≡ 0" x2 0.70 → 3.84e-3, all ≥ 0.2 s after the start = R1-4 (recorded).
- **B (R2-1)** lc-view `push`: an F below a stored anchor's is a new context — every anchor reset (F / F1 / v), the block taken, lvl 2 (the
  ring flushes itself). Test lc-view "(R2-1)" (anchors at 5e6, a block at 2000: 0.51 → ≤ 1e-12). Repro repro-R2-1-power: dot vs curve
  after ⏻ med 0.0984 (old lc-view, control) → 0 / 0.0001 after ■ ▶ — "not reproduced".
- **C (R2-2)** cv-module **`roomBelow(rects, key, dh)`** (pure; makeRoom moves right only): the modules stacked under a module (overlapping
  it horizontally, top within VGAP of its bottom — growing: of the bottom it will have —, then those stacked so under them) move by dh;
  main.js **`cmbRoom(t)`** from `cvModAfter` (so inside the plug's / unplug's own step): dh = cv-mods-ui **`combFaceH(n)`** − the shown
  face's height (the comb's rect taken at BAR_H + face.h, ahead of the measure), written to t.lay (cvPinned's copy), the face synced at
  once. Test canvas-LC-sim "(R2-2)" (4 plugs → the stack +4·32, the instrument stays, undo takes both, redo, an unplug −32). Repro
  repro-R2-overlap: Juno and Wavecraft 0 → 5 inputs, "l1 352×32 / ×64" → no overlap.
- **D (R2-3)** main.js `modBudgetOf`: a combiner's b.canvas = `inputsOf(t, id).length`. Test canvas-LC-sim "G8 §8.4" (budget and the Mod
  list header "1 input"). Repro repro-R2-3-modlist: "3 inputs · LFO 3/10".
- **E (G6 amount move)** lc-view `paintCurves`: offscreen layers (never in the DOM: 24 + 6n holds) — the ground + grid (redrawn only on the
  window's length / signature / skin / size) and each input's curve at full alpha, composited with globalAlpha by |amount|; a recompute's
  frame strokes the inputs straight on, their layers built at the next amount / mute / mode change and only composited after; the sum is
  the one path stroked per move. `amounts()` asks the host's inputs() once per paint; main.js cmbInputs builds `modSrcList` once (modLabel
  built it per name: 28 of its 38 µs). Test lc-view "(G6, E)". **The amount move's view part at 6 ×: med 0.82 → 0.055–0.09 ms (gate 0.5)**
  in the 6 runs since (one run before the straight-on recompute paint: 0.38); the real work ≈ 0.05 ms — CfT's 6 × throttle suspends the thread ≈ 1–1.5 ms per ≈ 0.2 ms run slice, so a median is the share
  of moves a pause lands in (measured: 50 µs of wall work 11/40 hit, 100 µs 16/40, 200 µs 38/40).
- **F (G6 window edit)** lc-view `inputCurve`: the chunk loop with the clock inlined (no closure / property read per chunk; the same
  expressions, bit-identical) — 0.478 → 0.468 ms a bar in node (the DSP's `lfoRead` is ≈ 12 ns of the ≈ 19 a chunk: the floor);
  **`SM_MAX = 28000`** chunks per SMOOTHed input per recompute (1 bar at 120 BPM / 48 kHz + 14 τ at SMOOTH 0.3 = 26 268: exact; 2 bars at
  120 = 50 268, or SMOOTH 0.5's 10 500-chunk warm-up on a bar: past it) — past it the display-step one-pole (`approx`), the input drawn
  dashed and the sum with it, never claimed exact; `curveAt` (G4) passes no budget (exact). A one-deep memo (M0 / M1): a key move that comes
  back (the window there and back) takes the previous curves while the line and every anchor are still theirs (§6.6's check); dirty 2, new
  inputs, a restart, a new context never do (`state().memos`). Tests lc-view "(G6, F)" and "(G6) a window edit there and back". **At 6 ×
  (comb scene, d, cap 120): recompute med 3.375 → 2.34–3.02 (gate 4; its max 4.5–5.75 — the throttle's pauses), the window edit 6.29 →
  1.42–1.77 (the 2-bar edit dashed 0.95–1.49; back to 1 bar a memo hit), comb probe 6x ok in 4 of 4 runs with the memo** (before it, the
  exact 1-bar edit back: 4.185 / 2.56 / 3.9 / 2.6 — one FAIL in 4). 1 ×: frame med 0.015–0.02, the overlay moved on every frame, comb stopped ok.
- **G (R1-2)** tests/lc-engine: the fixture rig's `s.p['f.on'] = 1`; every G2 case also renders the track without the cable and asserts it
  differs. 4 cases failed first (vacuous), 19 / 19 after. Repro g2-vacuous (a verbatim copy of the old harness: its own f.on 0 fixture —
  FAIL as written); with f.on = 1 applied (fix-scratch/g2-vacuous-fon.mjs) "direct ≡ no cable false" ×2, ok.
- **H (R1-5)** main.js `runT` beside runP: play() the anchor's tick (from − countBars bars), a seek its tick; song().start = runT while
  playing. Test canvas-LC-sim "(lane F's asks)": a one-bar count-in recording → the transport's ▶ tick −3840 = song().start (was 0). Repro
  g4-real countin as written passes start = from (the old host): fails; with the fixed start (fix-scratch/g4-real-countin-fixed.mjs): 0.198
  → 3.27e-3, every point ≥ 0.2 s after the start — R1-4's chunk-boundary edge at 120 BPM.
- **I (R1-6)** cv-model `cmbIn`: the OUT's VALS_FULL pre-check when the combiner holds no value slot yet. Test lc-model "(review 1 R1-6)".
  Repro g3-budget: ALL OK (was 1 FAILED).
- **J (R1-7)** lc-view `preview`: the key + `'|m'` for `pay.i === 'master'`. Test lc-view "(§5.4, P2-6)" (track vs master apart, two tracks
  share). Repro prevkey: "track note master time" — ok.
- **K (R2-4)** cv-mods-ui MOD_CSS: on touch (`pointer: coarse`) the Window's four picks hit four abutting 44 px bands centred on the segment
  (over its gaps and the neighbours' near edges: Multiply keeps 49, Marks 106), above them — **4 × 44 in 120 px is all the room: each box's
  centre sits ≈ 1 px inside its own band**, a tap on a pick's outer edge may take its neighbour; no box moves, desktop as was. The stronger
  check found **Marks' hit 28–33 px tall** (its `overflow: hidden` clips its ::after): its band is the head row's ::before over its two
  columns, a press / tap there forwarded to Marks (combBody, no element). tests/ui-layout-wc.mjs: the head hits as hit-tested (elementFromPoint
  across the centre row and down the centre column, ≥ 44 both ways); the clip check measures a text's own range (a positioned hit widened
  scrollWidth). Failing first: the old face under the new check (l): ½ 30.5, 1 / 2 29.5, 4 30.5 wide, Marks 33 tall. Repro repro-R2-4-hits:
  ½ 1 2 4 44 × 45, Multiply 49 × 45 — "not reproduced".
- **L (R2-5, the lead's call)** cv-mods-ui **`CMB_TINT`** (#e0533d #b07a10 #2a8f4c #9b5fd6 #128a84 #d6528f #5a6fe0 #7a8618: luminance
  0.19–0.23, ≥ 3 : 1 on the charcoal / glass screens and the ivory screen and face, apart from every skin's --sxd-wave); main.js cmbInputs
  `color = CMB_TINT[index % 8]` — the dot and its faint curve; the cords unchanged; §6.5's alpha and dotted-when-muted kept. canvas-LC-sim's
  colour pin moved to the rule (+ the cord still MOD_COLOR.lfo).
- **M (R2-6)** tests/ui-layout-wc.mjs `--lc`: with the page's real ModCore (wk.loadDSP), a real payload — cv-graph compileMods over a track
  of real LFOs into x1 (BPM ¼, 1 bar + PHASE, a square under SMOOTH 0.3, a RETRIG one: dashed; the 11th row as a loaded project holds it,
  left 'slots') — and anchors read off its own preview; without a preview the stand-in's laws and payload together. Console errors and
  exceptions (the skin passes' too) fail the run. **Before: 9 console errors ("the CP was rejected", "bad cmb"), empty screens, "green";
  after: d / l / p green, no console line, the lc-face-*.png sheets show the real curves** (fix-scratch/layout).
- Not fixed (recorded in §16 by the lead): R1-3 (the stopped curve exact only at a 4-frame-aligned ▶), R1-4 (an edge exactly on a chunk
  boundary rounds one chunk off).

---------------------------------------------------------------------------------------------------------------------------------

## 18. Skeptic + re-plan (2026-11-02, before phase 0)

Checked against ⟨B⟩ (file:line) and the user's answers (the header). The body above is already amended; each item names where.

**Facts the plan now rests on (new [R]s)**
| fact | where | → |
|---|---|---|
| A K_OFF (FREE GLOBAL) LFO on a direct classic / panel cable is faded in per note by RISE / DELAY on the pseudo-voice; g (what ext and the combiner read) is raw | sx-mod.js:1969–1977 | G2 on RISE = DELAY = 0; "≈" on such an input |
| A per-voice LFO's direct cable reads its own PHASE / RISE / DELAY / SMOOTH at the voice's (half-ticked) dt | sx-mod.js:1993–1995, `lfoOut` :512 | a twin ≡ the LFO switched GLOBAL, not the per-voice one |
| ModCore has no keyboard swing (`shim.p.seq` null) | sx-mod.js:926–929; mod-core.js:202 | no swing case in G4; a swung input is unswung (recorded) |
| ▶ resets every processor LFO's phase, cycle and S&H draws | sx-mod.js:1423, :757 | the stopped preview is exact for 'song' / 'time' |
| fastSame / fastKeep read `w[k].length` for every FAST_A key | engine.js:3590–3616 | a key added to a live message throws on the audio thread |
| cv-cables hands the dragged source to `markDests`; main drops it | cv-cables.js:1437; main.js:10612 | the IN target needs no cv-cables change |
| modConnect removes and tells a new row that compiles `left` — that row only | main.js:10578 | refuse at the drop; the combiner's needs come last |
| Pads take value slots after the modules, links take LFO slots after the pads | cv-graph.js:680–681 | a combiner in `modDevs` order would evict them silently |
| The twin / linked slot copies a Wavecraft LFO's knob bases only | cv-graph.js:402 | a modulated Wavecraft LFO reaches the combiner unmodulated |
| A new track LFO is RETRIG GLOBAL; Serum's default LFO is BPM + ANCHOR; a rig LFO is PER NOTE | cv-model.js:409; serum-core.js:1296 | the user's FREE LFOs are mostly 'song'-locked: exact, no data needed |
| Track / master LFO knobs are never cable ends (NOMOD_MOD) | cv-mods.js:626 | a track LFO's rate is constant between payloads: 'time' extrapolates exactly |
| On a Wavecraft canvas the LFO tile adds rig LFOs | main.js:10459–10462 | there, the combiner's inputs are mostly links / twins |
| Literal `import()`s are precached | tools/precache.mjs:87; cv-mods-ui.js:368 | lc-view on demand |

**P1 (before phase 0)**
- **P1-1 Q1 "Clip flat".** Add = `clamp01(Σ c_k)`, no fit; the identity stays exact; the curve shows the flat tops. §3, §6.3, G3.
- **P1-2 Q3 "Nothing until I pick".** `mark` null = Off; no default marks. Header, §2.1, §6.7.
- **P1-3 G2 could not pass as written.** A direct cable of a FREE GLOBAL LFO with RISE / DELAY, and a PER NOTE LFO's direct cable,
  are not what g holds. G2 now: GLOBAL sources with RISE = DELAY = 0; a twin ≡ the LFO switched GLOBAL. The face marks an input with
  RISE / DELAY ("≈", §7.1); §16 records it. No DSP change (D1).
- **P1-4 The fast 'mods' message.** "Its object gains the field" would throw in fastSame / fastKeep: a payload with combiners
  replaces the object (its hold reset), `'cb'` joins FAST_A. §5.3.
- **P1-5 Budgets: no silent eviction.** The combiner's value slot, its twins and input LFOs nothing else needs are allocated after
  every existing need (after pads and links); a new input / OUT over the limit is refused at the drop with words (modConnect's rule,
  addMod's pad precedent); `'vals'` was not a code (`'slots'`). §4.1–4.3, G3, G8.

**P2 (in the lanes' briefs)**
- **P2-1 SMOOTH.** A display-step one-pole cannot meet 2e-3 (an edge inside a 4 ms step ≈ 0.3 at SMOOTH 0.3). The page runs the DSP's
  recurrence at the chunk rate (≤ 1e-6 after 14 τ); dashed if G6 fails. §6.2, G4, G6.
- **P2-2 The 1e-6 gate is honest** for 'song' (both sides evaluate one closed form of `tickAt / 960`, engine.js:4717, sx-mod.js
  :1092, :1144–1150) and for 'time' (a constant rate between payloads; float accumulation ≈ 1e-13 over a 4-bar window; compared
  modulo 1), at SMOOTH 0 or the chunk-rate SMOOTH; not for dashed inputs (excluded and counted). G4.
- **P2-3 Wavecraft LFOs**: rate / phase / shape under a cable, swing, RISE / DELAY are not in the twin → "≈" with a tip; stopped,
  ModCore's clock ≠ the Wavecraft's (R3). Recorded, not fixed: the picture = the combiner's sound.
- **P2-4 The stacked IN by reuse.** Drop target: no cv-cables change. Cords: link rows are cords already; one anchor branch
  (`'<comb>:in'` as a jack end, stacked, the counts map) + one cordOf condition. "Which cord?" / grab dropped for cut 1 (the face's
  list picks). Lines: the face's own count chip. §7.1, §8.3, R5.
- **P2-5 cv-graph's `MOD_KINDS` → phase 0** (cv-model's `kindOf` / `setModState` and `validate` need `comb` as `'mod'` before E lands).
- **P2-6 Page cost.** P keyed by the CP; cached input arrays; an amount / mute / mode move re-runs the combine only. §5.4, §6.6, §9, R6.
- **P2-7 The old-tab check is a boot**, not a read: ⟨B⟩ in a scratch worktree opens a track + master combiner fixture without a
  throw; no guard (the user: canvas saves need no care; an old project "must still open"). The iPad app's older bundle meets the
  same data (no schema step). §2.4.

**P3 (wording, trims)**
- P3-1 D1: "one guarded block", not "not one instruction"; G3's counter hook → a spy on `combine` (0 calls without `cmb`).
- P3-2 D3: the clock closed forms live in sx-mod.js beside offLfo / freePos; the read laws are shared; G4 holds them equal.
- P3-3 lc-view.js on demand (the boot graph unchanged); the overlay a canvas or two transformed elements, by G6. §7.2.
- P3-4 `cb`'s `r` is derivable from P (E may drop it); keep `v` (SMOOTH's anchor, 'rand'). A 'time' input before its first anchor is
  not drawn; the window before ▶ in this pass is dimmed. §6.2.
- P3-5 `ModCore.warmPayload` unchanged (no combiner in Track.warmUp).
- P3-6 Lane U folded: the glyph and MASTER_NOTE into phase 0, style.css into F (one agent fewer; Sonnet stays for one-file fixers).
- P3-7 G6 trimmed to 1 × and 6 × CPU, caps 60 / 120, fast on / off; the iPad row after the features (the standing rule).
- P3-8 Marks stay in cut 1 but are the first thing to move to cut 2 if H runs long (Off is the default either way, Q3).
- P3-9 A module used only through its twin: `pay.slots[id]` → the twin's slot (its face's playhead keeps moving). §4.2.
- P3-10 Pre-existing, out of scope, for the lead: LFO slots go in module-id order and modConnect checks only the new row, so a new
  **direct** cable from a lower-numbered LFO can push another LFO's existing cable `left` without a word (cv-graph.js:659–681,
  main.js:10578). The combiner avoids it by P1-5; the direct case is a separate fix.

**Final lane plan** (§12): phase 0 (the lead, Opus 5.5: the registries incl. cv-graph `MOD_KINDS`, the tray glyph and words, cv-model,
lc-model tests, the ⟨B⟩ boot probe, the sweep) → **E ∥ F ∥ H** (Opus 5.5 each; disjoint files: E mod-core / sx-mod / engine /
cv-graph; F cv-mods-ui / lc-view / style.css; H main / cv-module / cv-modlayer / cv-cables' badge flag) → integration (record
tests/ref-LC) → reviewers × 2 (Opus 5.5: the real engine; Chrome for Testing) → fixers (Sonnet one file / Opus 5.5 across) → the
sweep → deploy. No Fable. Cut-2 candidates, in order: Marks, the OUT as a cord on a Wavecraft canvas, the Wavecraft "≈" detection.

**The user's questions**: Q1–Q4 answered (their words in the header and §15; the design follows); Q5 / Q6 stay first guesses; no new
question.
- **K, the lead's revert (90d21ea)**: the fixer's four abutting 44 px bands over the 120 px Window segment put the outer picks' centres on
  a band edge (the right half of ½ picked 1, the left half of 4 picked 2). Reverted to the picks' own boxes (30 × 44 on touch; §16, §7.1
  refined); Marks' head-row band and its forwarding kept; tests/ui-layout-wc.mjs asks a Window pick for its box's width, ≥ 44 of the rest.
  G11 green d / l / p on the real DSP; cv-mods-ui 27, lint 173, pwa 25.
- **G6 after the round** (lane G6's probe, 6 ×, the fixer's 4 runs): amount move 0.055–0.09 ms (gate 0.5), window edit max 1.42–1.77 ms
  (gate 4; 2 bars draws the SMOOTHed input dashed past SM_MAX, and 1 → 2 → 1 is a memo hit), recompute med 2.34–3.02 ms (gate 4; max 4.5–5.75).
  A fresh exact 1-bar recompute at 6 × is 2.4–4.2 ms: marginal on the floor, as R6 said. Not measured: jsc / the iPad (after the features).
