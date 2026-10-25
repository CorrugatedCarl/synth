# Stage WC: Wavecraft — our own modular synth (IMPL-WC) — contract

ROADMAP row 18 (docs/canvas/ROADMAP.md:39 [R]; row 10 merged into it, :31 [R]). **The user's decisions (2026-10-24 / 25 — settled; this
contract designs to them and does not re-ask)**: "when dragging a serum oscillator module into the canvas it should replace serum all
together. in fact we should rebrand the module synth into something of our own … i want to be able to drag an oscillator in and just start
with that plus the obligatory effects panel … the serum complete should live on its own". So: **Serum complete** stays its own whole
instrument, **its "Show parts" option removed**; the parts become **Wavecraft** (the user's name, **provisional**: "not 100% sold on the
name id like to be able to change it easily later on"); dragging an oscillator part onto a canvas **replaces** the instrument there with a
Wavecraft holding just that oscillator (+ the FX panel and OUT); **"no nothing should be hidden"**; **no envelope comes with it** — "the
raw oscillator at full level, gated by the keys (sounds while held, silent otherwise; only a few-ms click-free ramp), until the user adds an
envelope module explicitly, which then takes over the level"; further parts dropped onto it **add** to it; **patching with the physics
patch cords** (audio and modulation): "we can just change the current flowchart style connections into the patch cables and go from
there"; **look**: the cord lab's by default (ROADMAP 10: dark charcoal panels with corner screws, cream narrow-type names, black knobs with
cream pointers, cream-ringed jacks; generic names — Oscillator, Mixer, Low-pass filter, Envelope, Amplifier), **multiple interchangeable
built-in skins added to over time** (no skin editor); **browser first** (the iPad app untouched this stage); the iPad is the main
platform. Standing: one instrument per track (1f), no artificial caps (ROADMAP 14), the performance presets are visual only, native pinch
only, no per-stage iPad session (one consolidated pass later), "push it live when it's done".

**Code references are to `canvas` at dee3010** (= HEAD; the map [map-wc.md](map-wc.md), cited "map §n", holds the file:line facts the
three mapping passes verified). Tags as IMPL-SC: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made
here (a builder may refine a [C] with a reason in §14, never an [R]). House format: IMPL-SC.

**The lead's decisions on what the user's words leave open (2026-10-25)** — each argued in §1:
- **(a) Wavecraft rides the Serum engine.** Its sound state *is* a Serum state (`vals.s`); the modules are the stage-3 part panels; no DSP
  file changes. The generic patch engine (`patch-dsp.js`) is mono and would need every Serum oscillator / filter / envelope rewritten.
- **(b) The key gate is ENV 1 at fixed "gate" values** (3 ms linear attack, sustain 100 %, 3 ms linear release) — a state, not a code path:
  the engine already ramps a fresh voice from 0 and frees it at the release's end; nothing is added to the worklet.
- **(c) One visible hub module, the Amplifier**, comes with the first module dropped: it holds the keys (voices, mono / legato, glide), the
  level, the summing inputs and the LEVEL jack whose printed normal is **KEYS** — the gate the user described, written on the face; an
  Envelope plugged into LEVEL takes the level over (it becomes ENV 1). SPEC §8.4 point 1 [R]: the amp envelope cannot float free.
- **(d) Cords for the Wavecraft's own connections only** (the user's Q1 answer, below, and the lead's first guess on the skeptic's question 1:
  the Moog precedent). **The connection model is independent of how it is drawn**: one record list per canvas (`cablesOf`, the model), two
  renderers of it — *lines* (cv-cables' SVG, today's) and *cords* (the stage-9 layer) — and a per-record predicate says which records a
  Wavecraft canvas draws as cords: the Wavecraft's internal edges, the amp-slot cord, its own Envelope / LFO / Macro rows onto its own knobs
  (its FX panel's included), link rows whose source is one of its modules. **Lines stay lines**: Amplifier → FX, FX → OUT, canvas modulators'
  rows, preset rows from canvas Velocity / Note / Wheel modules, Pads note lines — exactly as the 900 Series' canvas mixes its patch cords
  with cv-cables' lines today (IMPL-9 D9 [R]). The predicate reads one constant and a pref (§1.3, §4.7), so flipping Wavecraft back to lines,
  or offering "Connections: Cords | Lines", is a line, not a stage.
- **(e) Name-neutral everywhere**: model id **`rig`** (family `'rig'`), files `rig-core.js` / `rig-ui.js`, tests `rig-*.test.mjs`,
  CSS `.rig-*` / `[data-cv-skin]`, prefs `synth.rig.*`, the tray view `rig`; **one display constant `RIG.NAME = 'Wavecraft'`** in
  `rig-core.js` (every label, notice, tile, menu, tooltip, ⚙ line and lost-line reads it; a test greps the tree for the literal outside
  that constant and the docs). A rename is one line and no migration.

**The user's answers (2026-10-25, to §12 — settled)**: **Q1 = (b)** cords only for Wavecraft (and the Moog, which has them); every other track
keeps today's lines — "i have a feeling i might regret the patch chords in the future but lets see. its all about ease of usability in the
end and intuitive interfacing" → §1.3's ease-of-use parity and §4.7's regret path. **Q2 = (a)** the visible Amplifier with the KEYS-printed
LEVEL jack. **Q3 = (a)** normal knob positions (Serum's loudness). **Q4 = (a)** old parts-view projects open whole + "Make it a Wavecraft".
**Q5 = (a)** Ivory. **Q6 = (a)** Serum presets load into / save from a Wavecraft. **Q7 = (a)** the starter rig that plays. And: "all these
answers are kind of guesses until i see and feel the thing, thats when ill really be able to tell you what i want" → **two cuts**:

**WC-1 — a playable first cut, shipped early** for the user to see and feel: drop an oscillator → Amplifier (KEYS gate) → FX → OUT; adding
modules with auto-plug; cords on the Wavecraft canvas (plug / re-patch / pull / Connect to…, ease of use first); the charcoal skin; the
starter-rig tile; Serum complete without Show parts; schema 16 with the parts-view migration and "Make it a Wavecraft" (the file format
must be right from day one); the eight faces of §3.1 on the layout system of §3.8. **Sections**: §0–§4, §5.1, §5.2 charcoal, §5.3, §6, §7,
§8, §9, §10 G1–G12, §11 WC-1 lanes.
**WC-2 — after the user's feedback**: the Ivory skin and the ⚙ skin line (§5.2 ivory), Serum preset load / save into a Wavecraft (§3.7 but
Init), "Make it a Serum (complete)" (§3.5 conversions, the reverse), the optional "Connections: Cords | Lines" ⚙ line (§4.7), the
inspector's generic names (§13), and whatever WC-1's feedback changes. **No schema change between the cuts**: schema 16 (§2.4) already holds
`dev.rig` and nothing WC-2 adds is stored (presets go to the Serum store, skins to a pref, conversions are `setModel`).

**Cheap to reverse** (a constant or a pref over a structure, wherever an answer may flip once the user has felt it): `RIG.WIRES = 'cords'`
(`'lines'` draws a Wavecraft's records with today's renderer; pref `synth.rig.wires`, URL `?wires=`; §4.7) · `RIG.STARTER` (the tile's
starter patch as data; `null` = an Amplifier alone; §3.5) · `RIG.GATE_MS = 3` (§3.3) · `AUTOPLUG` (the add rules as a table, §3.5) ·
`SKIN_DEFAULT` (§5.1) · `RIG.HUB_OPEN` (the Amplifier arrives open or folded to its bar, §3.5) · `RIG.NAME`. **Not cheap**, said plainly:
removing the Amplifier as a module altogether (its jacks and keys section would need another home — a WC-2 question if the user dislikes it,
contained to `rig-ui` + the Tidy row); the Serum engine underneath (§1.1).

**Invariants of the stage**
- **W1 Every sound outside Wavecraft is bit-identical.** No DSP file is in the diff (`engine.js`, `serum-dsp.js`, `sx-*.js`, `fx-*.js`,
  `mod-core.js`, `patch-*.js`, `moog-*.js`, `dr-*.js`, `drum-core.js` untouched); every frozen golden (golden-classic / -fx / -presets /
  -random / -graph, -drums / -606 / -909 / -sdsv, -moog / -moog-b / -moog-c, ref-M, ref-SC), canonical-stream's two fixtures, engine-track's
  warm-up hash and the live-p1 record stay exact. **Serum complete is the same instrument**: its state, panel, presets, compile and sound
  unchanged; only the ⋯ items "Show parts" / "Bundle" / "Add ▸", the ⚙ "New Serums open as" line and the parts tiles of its tray view go.
- **W2 A Wavecraft holding state S sounds exactly as a Serum holding S.** `patchFor('rig', { s }, fx, o)` ≡ `patchFor('serum', { s }, fx, o)`
  (deep-equal payload; the same `cpKey`), and so bit-identical in the engine (it is `engine: 'serum'`). Every Wavecraft sound test is a
  state test plus one render that proves this identity.
- **W3 One truth.** `vals.s` (+ `fx`, + `track.mods`) is the only audible truth; **cords are views** derived from it (`rig-core.edges`); a
  cord edit is a field edit (stage 3's `setEdge` / `cutEdge` form, map §1); `dev.rig` holds cosmetics only (cord colours) and the schema
  never lets it change a sound.
- **W4 Nothing hidden.** Every audible element of a Wavecraft has a module on the canvas or a printed legend on one (the key gate on the
  Amplifier's LEVEL jack); a Serum state the cords cannot show (a per-source AMP ENV switch off, §2.5) is normalised on entry and said in
  the notice — what you see is what plays.
- **W5 Cords never steal, the old rules hold.** The cord layer costs 0 at rest (map §2), the body takes no press, only plug ends and
  badges do, two fingers always win, the presets' quality tiers apply (ROADMAP 14), every count is cap-free up to the lifted bounds.
- **W6 Stage 9's instruments are untouched**: `patch-core.js`, `patch-dsp.js`, `cv-patch.js`, `moog-*.js`, `panels/m900.js` and their
  tests are not in the diff; the 900 Series' canvas draws exactly as today (its patch cords through cv-patch, its lines through cv-cables).
- **W7 Every other canvas draws exactly as today.** On a track whose instrument is not a Wavecraft, cv-cables' SVG markup for the same
  project is byte-identical to the base build's (G1 records it); the cord layer is not allocated there.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts; "→" what they force)

| piece | where [R] | WC |
|---|---|---|
| A Serum's parts as canvas modules keyed `iN/<part>` (opt-in, `lay[iN].ui = 'parts'`), mounted as `bare` views of one `SerumHost`, internal cables derived by `sx-edges.serumEdges(s, fx)`, edits through `setEdge` / `cutEdge` with History meta write-back (`sxCable`), add / remove parts with the first-free-slot rule, the modulator column, Tidy order, the `SX_HEAVY` touch notice | map §1 (main.js:7026–7699, sx-ui-mod.js, sx-host.js, sx-edges.js, cv-module.js, cv-cables.js) | **the parts machinery becomes Wavecraft's** (§3): the same views, keys, edges and write-back, under a new model; the Serum keeps none of it (§6) |
| Part keys are Serum-named in three places (`CMOD.PARTS`, `sx-edges.PARTS`, `kindOfKey` → `isSerumDev`) | map §1 | they become "a Serum-engine device's" (`isSxDev`, §8.1) |
| `cvHost.patch: false` makes the derived audio cables read-only; mod / internal / note cables editable | map §1 | unchanged semantics on cords: derived cords have no interaction but the plug tap's info chip (§4.4) |
| The Serum engine: ENV 1 multiplies per sample from a per-chunk target, **a fresh voice starts at amp 0**, attack `32·n⁵` s (linear at `e1.ca` 0.5), release `vR·(1 − bend)` reaching exactly 0, the voice freed at `eV[0] ≤ 1e-5 && gAmp ≤ 1e-5`; `A ≤ 0` jumps to 1 (a click) | map §3 (sx-mod.js:2036–2095; serum-dsp.js:2761, 2870–2877) | **the gate = ENV 1 at `GATE` (§3.3)**: n = 0.15648 for 3.00 ms; no engine change |
| `x.env = 0` (AMP ENV off) ≠ a gate: the source plays steady until every envelope has released, then a 2 ms fade | serum-dsp.js:3509–3527, 2870–2877; serum-dsp.test.mjs:2901–2926 | not used for the gate; **normalised to 1** on entry into a Wavecraft (§2.5) |
| Routing fields: `osc[o].route` / `sub.route` / `noise.route` 0 Filter · 1 Main · 2 Direct · 3 None; `x.fbal` + `f.routeX` / `f2.routeX` switches (a fork); `filter[k].route`; `arp.on` / `clip.on` = the note cable; `OSC_ROUTE_DEF [0, 1, 1]`, filters off by default, A at route 0 passes through the off filter's bypass sum to Main | map §3 (serum-core.js:329–332, 1287; sx-edges.js:63, 134) | the whole cord vocabulary of §4.2 is these fields; a fresh Wavecraft oscillator takes route **1** so no "→ Filter (off)" stub shows (§3.5) |
| `destOk` reads the literal `dev.model !== 'serum'`; `compileTrack` / `instPatch` / `loadVals` / `normDevs` / `renderCustom` / the tray / cv-cost / cv-art / cv-migrate / midi.js / smpgen.js test `m.custom` or `'serum'` (map §3: 29 + 15 + 8 + 9 + 7 + 6 + 5 + 4 + 3 + 2 + 2 + 6 + 1 sites) | map §3 | phase 0's mechanical sweep: `isSx(m)` / `isSxDev` where "a Serum-engine model" is meant, `m.id === 'serum'` where the bundled panel is (§8.1) |
| `MODELS` 18 entries, `m900` last; `classicOf = !m.custom && !m.family`; every MODELS id needs a `COST.synth` entry, a `SIL` silhouette, a tile | map §3 | `rig` appended **last** (`custom: true`, `family: 'rig'`): index-based uses unchanged; `classicOf` false |
| The cord layer: `set([{ id, a, b, c, s }])` by id, `anchors(Map key → {x, y})` by reference, `live`, `grab / move / drop`, `sel`, one global `dim`, `c` **not clamped on the GL path**; 0 at rest; ≈ 2 000 B per moved cord; ≤ 3 draw calls; plug ends are DOM `span.cv-fjack` with 44 px hits; the press path world hook → cv-cables `press` → `o.cordPress` → cv-patch | map §2 | one layer; **on a Wavecraft canvas its list is that canvas's records** (one instrument per track: never a merge, §4.1); the rig's and the rows' ends need anchors (knob ends included, §4.3); lane C adds per-cord alpha and clamps `c` (§4.5) |
| cv-cables draws every record of a canvas as SVG and owns the badges, selection, menus and the two drags; its records are pure data (`cablesOf`) | map §1–2 | **the model stays cv-cables' record**; a per-record `cords` predicate on a Wavecraft canvas leaves the claimed records' SVG paths undrawn and the rest in place (§4.1) |
| The cord-lab feel: `STUDIO`, Studio = the user's "great"; iPad Pro 40 awake cords step 0.2 + draw 0.05 ms; m30 (30 modules / 40 cords) P+; 6× CPU: 40 awake ≈ 1.2 ms median | map §2 (bench.json `ui-m9`, IMPL-P:60) | the budget line for a full Wavecraft (§9) |
| Stage 3's part views: six fractional widths cut from the 1200 px bundled grid (`PART_W` 256.66 … 395.45), knob labels 9 px at 2 px padding, panel padding 6 / 8 / 8 px, rows mixing 28 / 40 / 52 px knobs, flex-wrapping heads | sx-ui-mod.js:48–51; wk.js:3286–3288; sx-host.js:847; sx-ui-osc.js:2691, 3133–3145 | **own faces on one grid** (§3.0, §3.8) — the user's crowding / negative-space gripe cannot be met by a re-skin |
| cv-patch is hard-wired to patch-core; patch-core's `FAMILIES` is frozen and its one-plug / same-sig rules are hard-coded | map §2 | **the rig has its own pure rules** (`rig-core`), its own press handler (`rig-ui`), and shares only the layer and the DOM jack idiom (W6) |
| Every kit colour is a `--sx-*` custom property; the module chrome's are `--mc` / `--hot` / `--text`; hardware schemes become `--hw-*` vars | map §2 (wk.js:3288–3297; style.css:1042–1096; cv-panel.js:1499–1512) | **a skin is a CSS-variable set** scoped by `[data-cv-skin]` (§5) |
| Fonts bundled: Inter + JetBrains Mono (OFL), `fonts/fonts.css`; the cord lab uses "Archivo Narrow" from Google Fonts | index.html:28–31; fonts/; docs/canvas/ref/cord-lab.html:5 | the charcoal skin's narrow face: **Archivo Narrow bundled** (OFL, three weights, ≈ 60 KB; §5.3) — no network request |
| Schema 15, `STEPS[14]`, a newer file opens read-only; `normDev` keeps no field it does not list (no `color`, no `rig`); `LAY_UI = ['flow', 'parts']`; `dropLay(id)` removes `id/*` | map §1 (cv-migrate.js:107–170; song.js:536–617; cv-model.js:148) | **schema 16** (§2.4); `normDev` gains `rig` for the rig model only |
| Replace (1f): one step 'Replace <old>', `keepDevs` keeps vals only when the model is the same, `cvUndoNotice` 8 s "tap to undo", no confirmation | map §1 (main.js:2228–2281, 6800–6821, 1792–1802) | the drop / replace flows reuse it word for word (§3.5); a same-model drop is a preset-style load with `sxBack` meta (IMPL-9 §1.4's lesson) |
| Serum presets: 86 factory (`FACTORY_PRESETS`) + user `synth.user.serum`; `sxLoad` applies to `vals.s` and the own FX; a preset's ENV 1 is a real envelope (min factory release 14.7 ms) | map §3 | **any Serum preset loads into a Wavecraft** (§3.7): its ENV 1 appears as the plugged Envelope; saving from a Wavecraft writes a Serum preset |
| S0: a fully opened Serum in parts (`p1x`, 3 176 painted) one slow frame short of P+ on the iPad; Serum (complete) in parts (`p1`) P+; the notice at 1 866 painted | IMPL-3 §9.0; main.js:7355 | a full Wavecraft is the same DOM minus VOICE's ENV panel plus jack strips: **the same budgets and notice** (§9) |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The three decisions (argued)

### 1.1 Engine: the Serum engine [C]

| option | consequence | verdict |
|---|---|---|
| **A. A Serum-engine model `rig`: `vals.s` a Serum state, `map()` = Serum's `compileSerum`, the modules = stage 3's part views** | zero DSP change (W1), every part sounds as it did (W2), presets / mods / MIDI learn / halos / ModCore rows / the own FX rack / bounce / toV1 all work as for a Serum; the cord vocabulary is Serum's routing (filters, main, direct, note, modulation) — **no audio-rate FM by cord, no feedback, no audio into a modulator** (Serum has none; the warp / FM / RM menus stay the OSC → OSC path, drawn read-only) | **chosen** — "change the current flowchart style connections into the patch cables and go from there" is exactly this; full patching is SPEC §10 stage 4 |
| B. The generic patch engine (`patch-dsp`), Serum's oscillators / filters / envelopes ported as module classes | mono (IMPL-9 D6), months of DSP, nothing bit-identical, a second copy of every Serum part | rejected for this stage (a candidate for stage 4) |
| C. Keep "Show parts" and rename it | the user ruled it out: Serum complete stays whole and its own; a Wavecraft must exist without a Serum tile | rejected |

### 1.2 The hub [C]
Voicing (poly / mono / legato / glide / bend) and the level need a home that is always there (SPEC §8.4 points 1 and 5 [R]); the user's
"nothing hidden" forbids a hidden VOICE; the user's picture is "oscillator → effects panel → out". The **Amplifier** (one of the user's
generic names) reconciles them: it *is* the oscillator's way out, it holds the level and the key gate in plain sight, and the keys section
on it is where a modular's keyboard CV would arrive. Not a separate "Keyboard" module (a fifth module on the first drop, and pitch cords to
every oscillator would be noise: the engine tracks the keys implicitly). Not the FX panel's head (the panel is every track's pedalboard,
voicing is the instrument's). Q2 confirms.

### 1.3 Cords on the Wavecraft canvas (the user's Q1 answer: (b)) [C on the user's decision]
What the canvas connects today (map §1–2): (i) the derived audio cables instrument → FX panel → OUT (read-only), (ii) modulator → knob
cables (`track.mods` rows and a Serum's native rows: badge, inspector, menu, dashed per-note, bypass grey, the 24+ fade), (iii) a Serum's
internal cables (parts view — Wavecraft's now), (iv) Pads' note cables, (v) the 900 Series' cords. The draft argued for every canvas (one
look; (ii) is per row and would be free everywhere once Wavecraft had it); **the user chose Wavecraft only** — "i might regret the patch
chords … its all about ease of usability in the end and intuitive interfacing". So:
- **The record is the model, the renderer is a choice.** `cablesOf(track)` (cv-cables' pure list: (i)–(iv), plus the rig's edges through
  `rig-core.edges` the way stage 3's `internal()` listed a Serum's) is the one connection list of a canvas. **`drawMode(t)`** =
  `'cords'` when the track's instrument is a rig and `RIG.WIRES === 'cords'` (pref `synth.rig.wires` and URL `?wires=lines|cords`
  override), else `'lines'`. In `lines` mode cv-cables draws and behaves exactly as today (W7). In `cords` mode **the Wavecraft's own
  records** (§4.1's table) go to the cord layer and cv-cables keeps everything of them but their SVG paths; **every other record on the
  same canvas stays a line** — Amplifier → FX, FX → OUT, a canvas modulator onto a Wavecraft knob, a Pads note line onto it — the Moog
  precedent (the lead's first guess on the skeptic's question 1, §12). A Juno / Serum / drum canvas is all lines.
- **Ease of use first** (the user's criterion): every patching act on a Wavecraft canvas costs the gesture it costs with lines today, on
  targets no smaller — the parity table of §4.4: a tap on a cord selects it with a × (as a line), a press on a jack starts or grabs a cord,
  the badge is a modulation's handle, jacks patch at every zoom a line jack does; a drag on a cord's body pans (a cord never steals a pan).
- **The regret path** (§4.7): `RIG.WIRES = 'lines'` makes a Wavecraft canvas draw its records with today's renderer — the jack rows stay
  the anchors, the badges stay the handles — so the flip is one constant (or, if the user wants both, a ⚙ line "Connections: Cords | Lines"
  reading the pref). G6 exercises the rig canvas in both modes.

---------------------------------------------------------------------------------------------------------------------------------

## 2. The model (phase 0: the lead) [C]

### 2.1 The device
```
dev.iN = { kind: 'synth', model: 'rig', vals: { s: <a Serum state, normalizeSerum> }, preset, fx: <the own FX rack, as a Serum's>,
           rig: { v: 1, cc: { '<source end>': 0…7 }, n: { '<lay key>': 1…99 } },
           [seq, on, solo, zone, name, fxId as any synth] }
```
`cc`: colours a user picked, **keyed by the cord's source end** (`'oscA.out'`, `'lfo3.out#2'` for a row's ordinal — a re-patch keeps the
colour, skeptic P3); `n`: the fixed display ordinal of a module whose engine slot can move (the Envelopes, §3.4; skeptic P2-6 / the lead's
decision 4). `song.normDev`: `rig` kept **only** when `isRigModel(o.model)` (as `drum` / `patch`: song.js:573 [R]); `normRig(r)` → `{ v: 1, cc,
n }` with `cc` ≤ 512 entries of `/^[a-z][a-zA-Z0-9.#]{1,40}$/` → an integer 0…7, `n` ≤ 64 entries of a `LAY_KEY` part → an integer 1…99,
anything else dropped, never throws; `pruneRig(rig, s, lay)` at load and before a save drops entries whose end or key names nothing that
exists (a GC, skeptic P3). Nothing in `rig` reaches `map()` (W3). **Lay**: the Amplifier is the device key `iN` (VOICE's place, IMPL-3 §2.1 [R]); each module `iN/<part>` with stage 3's part
names (`oscA oscB oscC sub noise filter filter2 env1 env2 env3 env4 lfo1 … lfo10 macros arp clip`, `iN/fx` the FX panel) — the same keys
`LAY_KEY` already accepts (song.js:537 [R]), so a Serum shown as parts converts with its positions (§2.4). `env1` is new as a module key
(VOICE held ENV 1): `CMOD.PARTS` gains it. No `ui` flag: a rig is always parts (`lay[iN].ui` is never written for it).

### 2.2 The model entry (`models.js`, appended **last**)
`{ id: 'rig', name: RIG.NAME, year: 2026, custom: true, family: 'rig', theme: { … the charcoal skin's accents for the chip … }, sections: [],
defaults: prefs → rigStarter(prefs), map: serum.map, presets: FACTORY_PRESETS, tag, about }` — no `maker` (the about line and the tile omit
the maker clause for a maker-less model; `aboutUI` main.js:2471 [R] trims the leading space: lane H); `map` is Serum's compile (the MODELS
loop wraps each `map`, models.js:898–906 [R], so not literally the same object — harmless, `controls` is empty; W2 by construction:
`patchFor` sees `m.custom` and feeds the same gains, models.js:930 [R]). **Three named states** (skeptic P2-10): **`rigBlank()`** =
`normalizeSerum(defaultSerum())` with every source **and** filter off (`a.on := 0` too), every `env` flag 1, `p['e1.*'] := GATE` and
`s.env[0] := GATE.env` (§3.3) — **the base for a module drop** (so the first Oscillator dropped becomes OSC A through `firstFree`, not a
second oscillator beside Serum's default A); **`rigStarter(prefs)`** = `RIG.STARTER` applied to `rigBlank()` with the prefs the way
`serum.defaults(prefs)` applies them (models.js:713–721 [R]) — what `defaults()` returns, so **every generic "new instrument" path** (the tile,
`addTrack` main.js:4228, the chip menu, the `#rig` URL, `voiceDef` 598, `loadVals` 159 [R]) gives the starter; **`rigInit()`** = `rigBlank()` +
Oscillator 1 at route 1 (Main) — ⋯ → Init, the "raw oscillator" (Q3: Serum's knob levels). `MODELS.length` 18 → 19: every test iterating
MODELS gets the rule of §11.3 (none weakened). Predicates exported from models.js beside `classicOf`: **`isSxModel(m)`** = `!!m && !!m.custom`
(both Serum-engine models), **`isRigModel(m)`** = `m.family === 'rig'`, **`isSerumModel(m)`** = `m.id === 'serum'` — named so because main.js
already has a *device* predicate `isSerum = d => d.model === 'serum'` (main.js:167 [R]; skeptic P2-8); the device-level twins are
`isSxDev(t, dev)` / `isRigDev` / `isSerumDev` (the last exists).

### 2.3 `rig-core.js` (pure, a leaf: imports serum-core, sx-edges, laws; no DOM; node-tested)
```
RIG = { NAME: 'Wavecraft', ID: 'rig', VIEW: 'rig', WIRES: 'cords', GATE_MS: 3, HUB_OPEN: true, STARTER: {…} }   the display constant and the flippable choices
AUTOPLUG         the add rules (§3.5), data
GATE = { p: { 'e1.att': n3, 'e1.hold': 0, 'e1.dec': 0.5, 'e1.sus': 1, 'e1.rel': n3, 'e1.ca': 0.5, 'e1.cd': 0.666, 'e1.cr': 0.5 },
         env: { bpm: 0, legInv: 0, stealRe: 0 } }                       n3 = (0.003/32)**0.2; the flags too (skeptic P2-3)
isGate(s)        every GATE.p field within 1e-9 of s.p AND s.env[0] equals GATE.env
MODULES          the catalogue (§3.1): kind → { label, labelN(i), cols, rows, jacks, max, slots }
rigBlank(), rigStarter(prefs), rigInit(), adopt(s) → { s, notes }       §2.2, §2.5
edges(s, fx, dev, rig) → [record]                                       §4.2: sx-edges' edges + the amp-slot cord + the "dry" tag; ids, colours, ro, badges
can(s, fx, a, b) → { ok, why, a, b }                                    §4.2's rules (a is the source end)
plug(s, fx, a, b) / pull(s, fx, id) / repatch(s, fx, id, end, b) → { f: [[path, before, after] …], why, notes, lay? }
envToAmp(s, k, held) / envFromAmp(s, held) → { f, why, key: [from, to] } the ENV slot moves (§3.4) over serum-core copyModule / swapModules; `held` = the slots injections hold
partKeys(s, lay, dev, used, rig)                                        I1 / I2 + I1' (a fed-but-off Filter) + the amp-slot rule (§3.4)
nameOf(rig, key) / labelOf(part, rig)                                   the fixed ordinals (dev.rig.n) → "Envelope 2"
pruneRig(rig, s, lay)                                                   the cc / n garbage collection (§2.1)
SKINS, SKIN_DEFAULT                                                     §5
```
`f` lists are applied by the host through the Serum host's `sxApply` (panel undo + History meta, map §1 `sxCable`), never by `rig-core`.
**sx-edges.js** is lane K's too, additively: `PARTS`, `splitKey`, `KIND_OF`, `SLOT` / `slotsUsed` learn `env1` (today they stop at env2–4:
sx-edges.js:33, 74–76, 240–243, 257–262 [R], and `splitKey('i1/env1')` is null — skeptic P1-5), `slotsUsed` counts link rows
(`iN/env1.out`) as readers, `jackOf` / `endOf` gain the Amplifier's new **`voice.level`** input end; jackrules.test stays green unchanged.

### 2.4 Schema 16 and the parts-view projects
`cv-migrate.SCHEMA = 16`, `STEPS[15]`: for every track device of model `'serum'` whose `lay[iN].ui === 'parts'`: delete `ui` (its `iN/*`
entries **stay** — harmless data the bundled view ignores, ≤ 25 of 4 096, and the positions "Make it a Wavecraft" reuses); record the track
in the step's notice list. Header line "15 → 16: Wavecraft (model 'rig', `dev.rig`); a Serum shown as parts opens whole". Sound-neutral
(`lay` only: IMPL-3 N2 [R]). **The notice channel** (skeptic P2-13): `upgrade()` returns `{ p, from, readOnly }` today (cv-migrate.js:161–170
[R]) and only `splitTracks` carries notices (main.js:280–286 [R]) → `upgrade()` gains **`notes: string[]`** (additive; `[]` for every other
step; the loader shows them with the 1f idiom). **What the user sees** opening such a project: the Serum whole, as before Show parts; one
notice "“<track>”: its Serum was shown as parts — it opens whole now. ⋯ → Make it a Wavecraft keeps the parts as a Wavecraft (same
sound)" — plus, when the Serum has parts-view link rows (`iN/lfo3.out` → another device's knob: they still compile, cv-mods.js:483 [R], but
draw nothing while whole, cv-cables.js:34 [R]), "N modulation cables from its parts are hidden while whole — Make it a Wavecraft shows them"
(the Mod list lists them meanwhile). A rig device in a 16 file opened by a schema-15 build would read `'rig'` through
`modelById`'s Minimoog fallback and autosave the loss → the bump makes it **read-only there** (the 7b reasoning, cv-migrate.js:31–36 [R]).
`SX_VIEW` (`synth.cv.sxView`) is no longer read; a stored value is left alone. **toV1** (Save as classic project): a rig track becomes a
**Serum** device with the same `vals.s` / `fx` / `preset` (main opens it as a bundled Serum, the same sound) and the lost line
"“<track>”: <NAME> is saved as a Serum (same sound; the live site has no <NAME>)"; its `rig` field and `iN/*` lay entries dropped.

### 2.5 `adopt(s)`: a Serum state entering a Wavecraft (conversion, preset load, paste)
Returns `{ s, notes }`: **only** the `x.env` switches change — every `x.env` (osc / sub / noise / filter AMP ENV) `:= 1` with a note per switch
that was 0 ("OSC B's AMP ENV switch was off — it is on"; 0 of the 86 factory presets have one, skeptic's count). **Everything else is
untouched** — routes 0–3, forks and shares, the filters' input switches, both filters' power, every matrix row, ENV 1 as it is. The draft's
rule (2) ("a source into a filter whose input switch is off is silent → route 3") was **wrong and is withdrawn** (skeptic P1-1): the filter
channel is `Y_k = (S_k − U_k) + filtered(U_k)` — a source whose input switch is off is in the channel's sum `S_k` but not in the filtered
part `U_k`, so it **passes dry** through Filter k at Filter k's LEVEL and route (serum-dsp.js:3644, 3648 [R]; SPEC-serum2 §"filter
channel"); 19 of the 86 factory presets have a powered source in that state (Grain Storm OSC A, Neuro Snarl and Growl Yoi OSC B, Reese Drift
and Wobble Dub SUB, …). It is audible state and it stays: the Filter face keeps its per-input switches (§3.1, the lead's decision 5) and the
cord into IN carries a **"dry"** tag when the switch is off (§4.2). Rationale for (1) alone: a per-source "no amp envelope" is not a cord
and has no face control in Serum's parts either; a later Amplifier "HOLD" switch per input could expose it (§13).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The modules (lanes F / U / H / K)

### 3.0 Own faces on one layout system (the user, 2026-10-25) [C on R]
The user: "everything feels a bit crowded with some text areas not having enough margin to feel comfortable. as well as a lot of negative
space not being properly utilized … the wavecraft modules should have a very consistent look across all of them with consistent spacing
of visual elements." Measured, stage 3's part views cannot be re-skinned into that [R]: they are cut-outs of the 1200 px bundled grid at
**six unrelated fractional widths** (`PART_W` 256.66 / 163.73 / 218.33 / 237.27 / 316.38 / 395.45, sx-ui-mod.js:48–51), the kit's knob
labels are **9 px** at 2 px padding (wk.js:3286) on a panel padding of **6 / 8 / 8 px** (sx-host.js:847), head rows flex-wrap at 6 × 8 px
gaps, and rows mix **28 / 40 / 52 px knobs side by side** (`size: 'sm' | 'md' | 'lg'`, wk.js:3288; sx-ui-osc.js:2691, 3133–3145) so knob centres
and label baselines never align across a row, let alone across modules. **Decision: Wavecraft modules get their own faces, built by
`rig-ui.js` on one layout system (§3.8) from the kit's *controls* and *displays*** — `K.knob / K.num / K.menu / dToggle / seg` bound to the
same `data-dest` ids (binding, mod halos, press-and-hold menus, MIDI learn, panel undo come with them), the kit's display components (the
wavetable / sample view, the envelope and LFO editors) at fixed sizes in a screen row — **not the stage-3 panel compositions**. The Serum
complete panel is out of scope (its crowding is noted in §13 as a possible later pass).

### 3.1 Catalogue (generic names; faces on the RIG grid, §3.8; one `SerumHost` per rig for state / undo / snapshots)

| module (bar title) | key | face (rig-ui; width in columns, §3.8) | per rig | jack row | ⏻ | cut |
|---|---|---|---|---|---|---|
| **Amplifier** | `iN` | 4 col (288): head (name · panel undo · meter · ⚙ fold-outs: QUALITY / TUNING / MPE / VOICE CONTROL / VELO · NOTE / KEYS as kit panels in a drawer) · knob row **KEYS**: VOICES (num) · GLIDE · CURVE · LEVEL (`g.amp`) · switch row: MONO · LEGATO · ALWAYS · SCALED · knob row **OUTPUTS**: MAIN · BUS 1 · BUS 2 · (meter) · jack row | 1, required | **IN** Σ · **DIRECT** Σ · **LEVEL** (normal **KEYS**) · **NOTE** Σ ‖ **OUT** (→ FX, derived) | — | WC-1 |
| **Oscillator 1 / 2 / 3** | `iN/oscA…C` | 5 col (352): head (TYPE menu · table / sample name menu · ⚙) · screen 128 (the type's display) · knob rows: OCT · SEMI · FINE · COARSE · PHASE ‖ RAND · UNISON · DETUNE · BLEND · WT POS ‖ WARP · WARP 2 · (mode menus) · PAN · LEVEL · jack row. **WC-1 lays the wavetable and sample types on the grid**; multi / granular / spectral show the kit's type view inside the screen frame at the grid's padding (consistent frame, kit interior) until WC-2 | ≤ 3 | **WARP** (target only) ‖ **OUT** | `a/b/c.on` | WC-1 (3 interiors WC-2) |
| **Sub oscillator** | `iN/sub` | 3 col (224): head (SHAPE menu) · knob rows: OCTAVE (num) · COARSE · PHASE ‖ PAN · LEVEL · jack row | ≤ 1 | ‖ OUT | `s.on` | WC-1 |
| **Noise** | `iN/noise` | 3 col (224): head (name · load · ⚙) · knob rows: PITCH · PHASE · RAND ‖ PAN · LEVEL · jack row | ≤ 1 | ‖ OUT | `n.on` | WC-1 |
| **Filter 1 / 2** | `iN/filter`, `iN/filter2` | 5 col (352): head (TYPE menus · ⚙) · knob rows: CUTOFF · RES · DRIVE · VAR · MIX ‖ PAN · X · Y · switch row **INPUTS**: A · B · C · N · S (the per-input "filter it / pass it dry" switches `f.routeX` — **audible state, kept on the face**: a source whose switch is off passes dry through this filter's channel at its LEVEL and route, serum-dsp.js:3644 / 3648 [R]; skeptic P1-1, the lead's decision 5; the draft had removed them) · switch row: KEYTRACK · CLEAN · jack row. **A Filter module exists whenever a powered source routes into it with a share above 0, even when the filter is ⏻ off** (I1', §3.4; skeptic P1-2: 30 of 86 factory presets and every default Serum route OSC A into an off filter, which passes its input through): it shows ⏻ off with the tip "Off: passes its input at its LEVEL" | ≤ 2 | **IN** Σ ‖ **OUT** | `f.on`, `f2.on` | WC-1 |
| **Envelope 1 / 2 / 3 / 4** | `iN/env<k>` | 5 col (352): head (BPM · LOCK · zoom) · screen 112 (the curve editor) · knob row: ATTACK · HOLD · DECAY · SUSTAIN · RELEASE · knob row: CURVE A · CURVE D · CURVE R · (START · END for k ≥ 2) · jack row | ≤ 4 (one is the amp slot) | ‖ **OUT** (mod) | — | WC-1 |
| **LFO 1 … 10** | `iN/lfo<k>` | 5 col (352): head (GLOBAL / PER NOTE · BPM · tools) · screen 128 (the point editor) · knob row: RATE · RISE · DELAY · SMOOTH · GRID (num) · switch row: TRIG · ENV · OFF · SNAP · jack row | ≤ 10 | ‖ **OUT** (mod) | — | WC-1 |
| **Macros** | `iN/macros` | 4 col (288): two knob rows of 4, each cell's label an editable name tile that is the jack | 1 | 8 inline (mod) | — | WC-1 |
| **Arpeggiator** | `iN/arp` | 8 col (544): the ARP page as one screen module on the grid | 1 | ‖ OUT (note) | `arp.on` = the cord | WC-2 |
| **Clip sequencer** | `iN/clip` | 8 col (544): the CLIP page likewise | 1 | ‖ OUT (note) | `clip.on` = the cord | WC-2 |
| FX panel | `iN/fx` | `FXRackUI` (the rig's own rack; the track's "obligatory effects panel"; not re-laid) | 1 | IN · OUT (as today) | — | — |
| OUT | `out` | as every track | 1 | IN | — | — |

Names are ours (the bar), the control ids are the engine's (a destination still reads "OSC A · LEVEL" in the inspector and the Mod list;
a renaming pass is §13). Every knob the kit panel had is on the face (nothing hidden: the lane's parity test lists each panel's `data-dest`
ids against the face's — G11); a control that has no place on the grid goes into the head's ⚙ drawer (a kit panel, the grid's padding),
never dropped. **New vs stage 3**: own faces, the Amplifier (VOICE without its ENV 1 panel, with the LEVEL jack), Envelope 1 as a module,
the jack rows, the Filter without its switches. **Not at launch**: a Mixer (the Filter's and the Amplifier's inputs sum), a Low-pass-only
filter (the Filter's type menu has it), a Keyboard module (§1.2), a Sequencer beyond ARP / CLIP, an audio-rate FM / feedback cord (§1.1).

### 3.2 The jack row
Every rig face ends in its **jack row** (56 px, §3.8): 28 px cream-ringed jacks (`span.cv-jack.cv-fjack[data-jack=<port>]`, cv-module
`side: 'inline'` anchors that `measureInline` (cv-module.js:532 [R]) measures once per relayout — the Macros tiles' mechanism, so `ports()` →
`anchors()` needs no new path), inputs on the left, outputs on the right, a 10 px cap label under each; a Σ input shows "Σ" after its label;
the Amplifier's LEVEL jack prints **KEYS** in its label line, struck through (the override look) while a cord is plugged, tooltip "Gated by
the keys until an Envelope is plugged here · 3 ms ramps". Hit circle 44 px (`--jp` 44; the `.cv-fjack` rule, style.css:1361–1373 [R]); jacks
**stay awake at every zoom a line jack does** (`cordAsleep` exempts rig jacks — the jack row is a dedicated 56 px strip, not a dense face,
so the 900 Series' reason does not apply; the lead's first guess on the skeptic's question 2); a second finger cancels (`jackStop`). The
Oscillator's WARP jack is a **target only** (read-only cords land on it; a tap opens the warp menu). Keyboard: a jack is a button (Enter /
Space → "Connect to…").

### 3.3 The key gate (exact)
`GATE` (§2.3): `e1.att = e1.rel = (0.003 / 32)^0.2 = 0.156482…` (3.00 ms by the law `32·n⁵`, laws.js:71 [R]; the panel prints "3.00 ms"),
`e1.hold 0`, `e1.sus 1` (level 1² = 1), `e1.ca 0.5` and `e1.cr 0.5` (linear: `bend` at c 0.5), `e1.dec 0.5` (Serum's default; moot at
sustain 1), **and ENV 1's flags `s.env[0] = { bpm: 0, legInv: 0, stealRe: 0 }`** (serum-core.js:1322 [R]; skeptic P2-3: with `bpm` on the
times come from the beat ladder, sx-mod.js:2045–2050, and with `stealRe` on a re-pressed voice restarts from 0 — a 1 → 0 step, a click,
sx-mod.js:1594–1599 [R]). What the engine then does, with no change [R map §3]: note-on → the voice is fresh (`gAmp 0`), ENV 1 enters the
attack at 0 and rises linearly to 1 over 3.00 ms (**36 control chunks at 48 kHz at every OS** — `CH = 4·OS` samples at `fs·OS`, engine.js:1855
[R]; ≈ 33 at 44.1 kHz; every chunk's gain ramped per sample), then sits at 1 — **the raw oscillator at its knob levels** (Q3) — until
note-off; the release falls linearly to exactly 0 in 3.00 ms and the voice is freed at the first chunk with `eV ≤ 1e-5` (≈ 3.0 ms + one
chunk after the key-up, plus the decimator's group delay on the output). A new key during the release restarts the attack **from the
current level** (`envRestart` keeps it, `stealRe` 0) — no click; a steal is Serum's. Live keys, the roll, MIDI, the Arpeggiator and the Clip
all gate the same way (they are note-ons). A legato mono note never re-gates (Serum's legato). The ramp's slope bound: a full-scale sine
cannot step by more than its own slope + 1 / (0.003·fs) of the peak per sample (G3 measures). The 3 ms is a constant (`RIG.GATE_MS`), not a
knob: the user's "a few-ms click-free ramp"; an Envelope is the knob. **One thing scales it**: VOICE CONTROL's ENV scale (`vc.escale`,
sx-mod.js:2052–2053 [R], on the Amplifier's drawer) multiplies every envelope's times, the gate's included — exempting ENV 1 would be a DSP
change (no); the LEVEL legend's tooltip says "3 ms · scaled by VOICE CONTROL's ENV" when it is set (skeptic P3).

### 3.4 Envelopes and the amp slot (`rig-core.envToAmp / envFromAmp`, `partKeys`)
- **The amp slot is ENV 1.** The Amplifier's LEVEL input accepts one cord, from an Envelope module only (`can` refuses an LFO: "An
  Envelope shapes the level — an LFO goes on a knob").
- **An Envelope module exists in the amp slot** (`iN/env1`, plugged into LEVEL by definition — the cord is derived from the slot, never a
  field) **iff `!isGate(s)` or something reads `env1`** — a matrix row with `env1` as src or aux, or a saved link row `iN/env1.out` (parts view
  made them, main.js:7622–7624 [R]; `slotsUsed` learns both, §2.3). While it is the gate and unread, nothing shows but the legend; when it
  is the gate **and read**, Envelope 1 stands there plugged into LEVEL showing 3 ms / 100 % / 3 ms — consistent with W4 (skeptic P3).
- **Names are fixed per module** (the lead's decision 4; skeptic P2-6): a module's bar reads "Envelope <n>" from its ordinal `dev.rig.n[key]`
  (given at creation: the lowest unused 1…99; kept across slot moves by `lay` renames); the engine slot ("ENV 3") shows only in the
  inspector's destination names. Plugging "Envelope 2" into LEVEL keeps it "Envelope 2".
- **Plugging Envelope k (2–4) into LEVEL** = `envToAmp(s, k, held)`, built on serum-core's **`copyModule` / `swapModules`** (serum-core.js:
  2783–2830 [R]: they already move ENV 1 ↔ ENV k with the flag paths, drop START / END into ENV 1 and re-target rows by suffix — skeptic
  P2-4) plus the rig's two rules: the **sustain re-law** (`e1.sus = √e<k>.sus`, pow2 vs lin, serum-core.js:589 [R], so the level is the same)
  and **destination re-targeting** of every row whose *destination* is `e<k>.*` → `e1.*` (matrix rows — 5 factory presets have `macro1 →
  e1.dec`, Tight Hat `wheel → e1.dec` —, canvas rows `iN:e<k>.*`, `s.midi` / `s.locks` entries) beside the *source* re-sourcing `env<k>` →
  `env1`; the flags `s.env[k]` travel; START / END are dropped and listed; slot k returns to Serum's defaults (not in use → its module goes);
  the lay entry `iN/env<k>` → `iN/env1` in the same step (same x, y; the ordinal follows). Refused when the amp slot already holds a non-gate
  envelope ("Envelope 1 already shapes the level — pull it first").
- **Pulling the amp Envelope's cord** = `envFromAmp(s, held)`: the first free slot k of 2–4 — **free = not in use by `slotsUsed` and not held
  by a canvas-modulator injection** (`held` = the slots `compileMods`' payload reports, cv-graph.js:385–391 / 499–524 [R]; skeptic P2-5: a
  slot an injection uses would otherwise be taken and the canvas row would fall to `'full'` silently) — takes the fields (`e<k>.sus =
  e1.sus²`, the flags, the rows both ways), the lay entry renamed, `e1.* := GATE.p` and `s.env[0] := GATE.env` — the gate is back the moment
  the plug leaves. No free slot: refused ("Envelopes 2–4 are all in use — remove one first" / "… held by canvas modulators"). The notice:
  "Envelope 2 unplugged · the keys gate the level again · Undo".
- **Dropping an Envelope tile**: when the amp slot is the gate → it becomes the amp Envelope plugged into LEVEL with Serum's ENV defaults
  (att 0.5 ms, dec 1 s, sus 100 %, rel 14.7 ms — the user's "which then takes over the level"); else the first free slot 2–4 (same `held`
  rule), unplugged (its OUT waits for a knob). Both one step 'Add Envelope'.
- **The kit's own ENV moves** — "Swap with ▸", Paste, the module-label drag (sx-ui-mod.js:346–353, sx-host.js:327–338 [R]) — go **through
  `envToAmp` / `envFromAmp`** when ENV 1 is a party (so the re-law, the lay rename and the gate rules always apply), else through the kit as
  today; Init on the amp Envelope = `envFromAmp` (the gate), Init on a free one = the kit's.
- A face remount at a new slot (env1-layout ↔ env-k-layout) changes the module's height: settled like `sxSettle` so nothing overlaps
  (skeptic P3).
- One step each; `meta { trackId, dev, f, lay: [[fromKey, toKey]] }`; undo / redo write the fields back when every current value equals
  the step's after- (before-) value, else a notice (IMPL-3 §2.4's rule, `sxBack`) and move the lay entry back.

### 3.5 Drop, replace, add (main.js, lane H; tiles lane U)
- **A module tile on a track whose instrument is not a rig** (any classic, drum machine, 900 Series, **Serum complete**): **replaces** it
  (the 1f path `setTrackModel(iv, 'rig', { module: kind, at })` → `CMOD.setModel` with `vals: { s: rigBlank() }` (§2.2: every source off, so
  the first Oscillator becomes OSC A — skeptic P2-10), then the module added in the same step) — one step 'Replace <old>',
  `cvUndoNotice("Replaced <old> with <NAME> · Oscillator · tap to undo")`, **no confirmation dialog** (the 1f rule for every replace: a Serum's
  whole state comes back with the step's snapshot since the model differs, `keepDevs` map §1 [R]; its *panel-undo history* does not — the
  host is rebuilt — as for every Replace today, skeptic P3). The rig holds **the Amplifier + that module + the FX panel + OUT**; an Oscillator / Sub / Noise arrives
  plugged into the Amplifier's IN; a Filter with its OUT → IN plugged and its own IN empty; an Envelope plugged into LEVEL (§3.4); an
  LFO / Macros unplugged; Arpeggiator / Clip plugged into NOTE (= on). Tidy row left → right: [module] [Amplifier] [FX] [OUT] (§3.6). The
  Amplifier arrives **open** (`RIG.HUB_OPEN = true`; `false` folds it to its bar — a one-line flip if the user finds it in the way).
- **A module tile on a rig track**: **adds** (stage 3's `sxAddPart`: the first free slot, powered on with its kept settings; full →
  "This <NAME> already has 3 oscillators" etc., `sxFullWhy`'s texts with the name; one step 'Add <label>', "Added <label> · tap to undo").
  **Auto-plug on add** [C] — the table `rig-core.AUTOPLUG` (kind → target jack rule; data, each rule flippable): a source → the first
  Filter's IN when a Filter exists (its IN sums), else the Amplifier's IN; a Filter → its OUT into the Amplifier's IN (a second Filter
  likewise; a serial chain is the user's re-patch); an Envelope → §3.4; an LFO / Macros → nothing (a knob is its destination: drag the
  plug); Arpeggiator / Clip → NOTE. Dropped: where released; tapped: the Tidy slot.
- **The Wavecraft tile** (the `rig` model tile in its view, label `RIG.NAME`; what it gives is **`RIG.STARTER`**, data: the starter rig
  Oscillator 1 → Filter 1 → Amplifier with Envelope 1 plugged into LEVEL at Serum's Init-like values, no LFO — Q7 (a); `null` would give an
  Amplifier alone) replaces any other instrument as the 1f rule; **on a rig track** it is a preset-style load with `sxBack` meta and "tap to
  undo" (not a same-model replace: IMPL-9 §1.4's `keepDevs` reasoning [R]). The chip menu "Change instrument ▸ <NAME>", a `#rig` URL and
  "+ Track" from a rig track give the starter.
- **Conversions** (⋯ items, one step each, the state kept — W2 makes the sound identical up to `adopt`'s notes): **WC-1** a Serum's ⋯ →
  **"Make it a <NAME>"** (Q4 (a): `setTrackModel(…, 'rig', { keepLay: true })` — `sxModelLay` purges every `iN/*` entry on a model change
  today (main.js:7179–7185 [R]; skeptic P2-13), so the conversion skips that purge and reuses the parts' positions, else Tidy; `adopt`; the
  notice "Now a <NAME> · same sound · tap to undo", or without "same sound" and with the switch notes when `adopt` changed an `x.env`);
  **WC-2** the Amplifier's ⋯ → **"Make it a Serum (complete)"** (the reverse; nothing to normalise; the `iN/*` entries stay for a later
  conversion back). Dropping a module tile on a Serum is **not** a conversion (the user's sentence: it replaces).
- **Removing a module**: ⋯ → Remove (⏻ off + lay entry, cords derived away; an in-use Envelope / LFO refused as stage 3; the amp Envelope's
  Remove = `envFromAmp` then remove, one step). The Amplifier has no Remove (Replace with… instead). Delete key on a selected module = Remove.
- **Cord edits** (§4.4): 'Plug <A> → <B>', 'Pull <A> → <B>', 'Re-patch …', 'Cord colour' — one step each, meta write-back.
- **Undo policy**: structure (add / remove / plug / pull / re-patch / colour / replace / convert / Tidy / move / fold) = History; knobs,
  switches, menus inside a panel = the rig's panel undo (the Serum knob policy, `keepDevs`); Cmd / Ctrl-Z routing as IMPL-3 §2.5 (the
  canvas has focus after a cord edit → History).

### 3.6 Tidy and placement
cv-module `tidy()`'s parts columns (map §1) with the Amplifier where VOICE was: canvas modulators (left column) → Arpeggiator / Clip →
Oscillators / Sub / Noise (top to bottom) → Filters → **Amplifier** (Envelopes / LFOs / Macros stacked above it) → FX → OUT; a new
Wavecraft's first row [module] [Amplifier] [FX] [OUT] at the replaced instrument's place (`sxLayParts`' anchor rule). Cords sag under the
Studio preset, so Tidy leaves one grid row of air under a module whose OUT runs downwards (the lane measures the sag at EXTRA 24).

### 3.7 Presets (WC-1: Init only; WC-2: the Serum presets — the user's Q6 (a))
**WC-1**: the Amplifier's head has the name, panel undo and the meter but **no preset strip** (`VoiceHeader` with `presets: false`); ⋯ →
**Init** = `rigInit()` (the gate, one Oscillator, §2.2; one step with `sxBack` meta and "tap to undo"). **WC-2**: the preset strip comes back
and **every Serum preset** (86 factory + the user's `synth.user.serum`) loads into a rig through `sxLoad` → `adopt` (its notes in the
notice) → the module set follows I1 / I2 / the amp-slot rule (a preset's ENV 1 is never the gate → an Envelope 1 appears plugged into
LEVEL; parts now on get modules, parts now off dim; automatic places pruned as IMPL-3 §3's amendment); saving from a rig writes a Serum
preset (`sxSave`, the same store: a preset is sound, not layout — a rig preset with layout is §13); Serum's factory 'Init' stays in the list
and loads an Envelope. Canvas rows are re-injected as today (D11). A preset's native rows from VELO / NOTE / wheel / random show as cords
only when a canvas Velocity / Note / Mod Wheel module stands on the canvas (2a's tagged "preset" cables [R]); otherwise the Mod list lists
them with "Add a Velocity module to see it" — nothing audible is unlisted (W4; §13). Nothing stored changes between the cuts.

### 3.8 The layout system — the RIG grid (lane F; numbers, measured by G11) [C]
One system for every face, so each module reads as one family and space is used evenly. World px at 100 %; the module bar (40 px,
cv-module) sits above the face and is not part of it.
- **Unit and columns.** The base unit **u = 8 px**. A face is **n columns** wide, one column **c = 64 px** = one knob cell; the face's side
  padding is **16 px** → **module width = 64·n + 32** (n = 3 → 224, 4 → 288, 5 → 352, 8 → 544: every width a multiple of the canvas's 32 px
  grid, so modules keep snapping to the dots). Column centres at `16 + 32 + 64·i`, i = 0 … n − 1.
- **Rows** (fixed heights, top to bottom, a **12 px gap** between rows, **12 px** top padding, **16 px** bottom padding): **head** 32 (menus /
  name / ⚙ at 28 px tall, 12 px text) · **screen** 112 or 128 (one of two heights per kind, the full inner width `64·n`) · **knob row** 76
  (the knob cell) · **switch row** 32 (28 px toggles / segments, 11 px text, ≤ n per row at the column pitch) · **jack row** 56 (28 px jack at
  the column centre, a 4 px gap, a 12 px label line of 10 px text). Every face has a head and a jack row; the rest per §3.1. A face's height =
  12 + Σ rows + 12·(rows − 1) + 16, so two faces with the same rows are the same height — the Envelope and the LFO (head + screen + knob +
  knob / switch + jack) differ only by their screen's 112 / 128.
- **The knob cell** (64 × 76): a **40 px knob** (`--wk-d: 40px`, one size on every face — never `sm` / `lg`) centred, 4 px from the cell's top;
  **6 px** gap; an **11 px label** (600, uppercase, letter-spacing 0.06 em, the skin's face font) in a 14 px line; a **10 px tabular value**
  readout (`.wk-num`, mono) in a 12 px line; **≥ 8 px** between neighbouring cells' text (the 64 px pitch with ≤ 48 px of label width — longer
  labels are abbreviated by the catalogue, never wrapped or clipped). A `num` field (VOICES, OCTAVE, GRID) takes a cell: a 40 × 28 box at the
  knob's centre line with the same label / value lines.
- **Text margins.** Every text box ≥ **6 px** from its face edge and from any control's box, ≥ **8 px** from any other text box; nothing
  clipped (`scrollWidth ≤ clientWidth`); minimum sizes 10 px (values, jack labels), 11 px (labels, switches), 12 px (head menus), 13 px
  (the bar title, cv-module's). Contrast label / face ≥ 4.5 : 1 in every skin (WCAG AA).
- **Negative space.** A knob row with fewer controls than n centres them **at the column pitch** (never spread wider); the screen fills the
  inner width exactly; no empty row; **fill ratio** (the union of control, screen and text boxes over the face area) between **0.55 and
  0.85** — below, the face wastes space; above, it crowds. The screws sit in the padding corners (8 px discs at 5 px from the edges — the
  16 px side padding leaves ≥ 3 px to any box; text is ≥ 6 px away by the margin rule).
- **Family consistency.** The same row heights, knob size, label sizes, gaps and padding on every face; the head's menu buttons the same
  height (28) and radius; one jack look; the group colour stripe on the bar (cv-module's) is the only per-instance colour.
- **Fold / sleep / zoom** unchanged (cv-module's fold shows the bar; controls sleep below 50 %; the face is DOM: soft while pinching, exact
  at rest — the S0 verdict the user accepted for parts).
- **Where it lives**: `rig-ui.js` `FACE` (the row recipes per kind, data) + **the grid CSS injected by `rig-ui.js`** (the kit's `ensureCSS`
  idiom, wk.js:271 [R]; sx-host.js:1088 [R]: `.rig-face` rules with the numbers above as custom properties `--rig-u / --rig-col / --rig-pad /
  --rig-gap / --rig-row-*`, one place, lane F's file); `style.css` holds only the skins' colour / font blocks (lane U); a skin never changes a
  number, only colours and the face font (§5).

---------------------------------------------------------------------------------------------------------------------------------

## 4. Connections (lane C: cv-cables' renderer mode + the cord layer; lane H: the per-canvas choice; lane K: the rig's rules)

### 4.1 One record list, two renderers (the user's Q1 (b))
**The model** is cv-cables' record list, `cablesOf(track, opts)` (map §1: audio `{ kind: 'audio', readonly, … }`, mod `{ kind: 'mod', a, b:
'<dev>:<param>', amt, bi, byp, dashed, … }`, note, internal), extended by the rig's edges exactly as stage 3's `internal()` extended it for a
Serum in parts view: `rig-core.edges(s, fx, dev)` → records `{ id: 'x:<dev>:<edge id>', kind: 'audio' | 'note' | 'warp', int, dev, edge, a, b,
share, fork, off, ro, color, src }`. **Ids are stable** (a rig edge's sx-edges id `a>b#field`, a row's id, `o:` / `p:` rows, `iN.out>iN/fx.in`,
`w<n>`, `n:…`), so neither renderer re-creates what did not change.
**Which records are cords** (the lead's first guess on the skeptic's question 1 — the 900 Series' split, IMPL-9 D9 [R]):

| on a Wavecraft canvas, in `cords` mode | drawn as |
|---|---|
| the rig's internal edges (sx-edges' audio / note / warp edges, `rec.int` with `rec.dev` a rig) | cords |
| the amp-slot cord (`voice.level`) | a cord |
| native matrix rows from its Envelope / LFO / Macro modules onto its own knobs — its FX panel's knobs included (`iN:fx.*` is the same device: `modConnect` → `sxOwnConnect`, main.js:8466–8468 [R]; `destPort`'s `own` branch, cv-module.js:1099 [R]) — the `o:` records | cords |
| link rows whose **source** is a rig module (`iN/lfo3.out` → an FX panel knob) | cords |
| Amplifier → FX (cv-cables' read-only `iN.out → iN/fx.in`; `edges()` **drops kind `'fx'`** so it is never both) · FX → OUT · canvas modulators' rows onto rig knobs · preset rows from canvas Velocity / Note / Wheel modules · Pads note lines | **lines**, as today |

**The renderer**: `createCables(world, { …, cords: rec => bool, onRecords(records, ports) })`. For a record `cords(rec)` claims, cv-cables
creates **no `path` element** but keeps everything else of it — its badge, tag, × button, selection, menus, the live-drag glue (today's
switches do most of the gating: `opts.parts(id)` gates `internal()` and the own rows, cv-cables.js:276, 341–344 [R]; the one new predicate is
"a link row whose source jack belongs to a rig") — and calls `onRecords` with the claimed records after each `set` / `layout`; the host
forwards them to the cord layer (`cords.set(records.map(toCord))`, `cords.anchors(…)`, §4.3 / §4.5). `cords: null` (or `drawMode(t) ===
'lines'`) = today's cv-cables byte for byte (W7). The 900 Series' canvas is untouched: `drawMode` is `lines` there and cv-patch keeps feeding
the layer its patch cords (W6). **cv-patch and the layer** (skeptic P2-2): `PATCH.sync()` runs `layer('set', C ? cordList(…) : [])`
(cv-patch.js:380–384 [R]) from `ptShow` on every track switch, undo, Replace and boot (main.js:7751–7756, 1828, 2269, 2301, 6498 [R]) — on a
rig canvas that would wipe the rig's cords; the host makes cv-patch's `cords` dependency conditional (`cords: () => isPatchDev(trk(),
curOf(trk())) ? cvCords() : null`, so `layer()` is a no-op elsewhere, cv-patch.js:147 [R]) and sets the rig's records after `ptShow`. One
instrument per track: a canvas is a rig's or a patch's, never both, so no merge. The layer is allocated only on canvases in `cords` mode or
holding a patch (`alloc`, main.js:7754 [R], extended).

### 4.2 The rig's cord vocabulary (`rig-core.edges / can / plug / pull / repatch`, over sx-edges)
| cord | fields (sx-edges [R]) | rule |
|---|---|---|
| Oscillator / Sub / Noise OUT → Filter k IN | `route 0`, `x.fbal` (the share), `f.routeX` / `f2.routeX` (the input switch) | a source's OUT holds ≤ 2 cords (the two filters: a fork, `fbal 0.5`, a BAL badge at the OUT plug opens the balance); a third refused "Two filters at most"; **the cord stands for route 0 with a share above 0, whatever the switch says**: switch on → filtered; switch off → the cord carries a **"dry"** tag at its IN plug (the source passes dry through this filter's channel at its LEVEL and route — audible, serum-dsp.js:3644 / 3648 [R]; sx-edges calls it a stub, the rig a dry cord: the one documented difference from `serumEdges`, G4); the switch itself is on the Filter's face (§3.1); plugging a new cord writes the switch **on**; a share of 0 for a filter = no cord to it; the Filter module exists even when ⏻ off (I1', §3.1) |
| source OUT → Amplifier IN / DIRECT | `route 1` / `2` | one cord; a cord into IN replaces one into DIRECT and vice versa (an animated re-plug) |
| source OUT unplugged | `route 3` | silent, dimmed module |
| Filter OUT → the other Filter's IN | `filter[k].route 0` | one direction; the most recent wins (the other goes to IN) |
| Filter OUT → Amplifier IN / DIRECT | `filter[k].route 1 / 2` | |
| Envelope OUT → Amplifier LEVEL | the amp slot (§3.4) | an Envelope only |
| Envelope / LFO / Macro OUT → a knob of the rig | `s.matrix[slot]` (a native row; `host.addModUI`) | drawn from the module's jack to the knob, the rig's colour; the inspector edits it (preset-row path) |
| Envelope / LFO OUT → a knob elsewhere on the track | a `track.mods` link row (2b) | as today; macros refused ("A <NAME>'s macros modulate that <NAME> · use a Macro module") |
| canvas modulator → a rig knob | a `track.mods` row `iN:<param>` | as on a Serum (`destOk`'s Serum branch, §8.1) |
| Arpeggiator / Clip OUT → Amplifier NOTE | `arp.on` / `clip.on` | the cord is the power; NOTE sums both |
| Oscillator OUT → Oscillator WARP | `x.w1 / x.w2`, `osc[o].fm`, `pitch.src` | **read-only** (dotted-look: thinner body, orange 5); a tap on either plug opens the warp / FM / pitch menu, which refuses cycles as today |
| Amplifier OUT → FX IN; FX OUT → OUT IN | derived | read-only; a plug tap shows the route label chip ("Main · Bus 1 ×2") |
| anything else | — | refused with a reason: "An oscillator feeds a Filter or the Amplifier", "A Filter feeds the other Filter or the Amplifier", "That is an input", "Two outputs — connect an output to an input", "A <NAME> plugs into its own modules" |

Σ inputs (Filter IN, Amplifier IN / DIRECT / NOTE) take any number of cords; every other jack holds one (two for a forked OUT). No cycles
exist in this vocabulary (the normaliser's F1 ↔ F2 rule, sx-edges.js:134 [R]). `can` returns the reason the drag shows on a dimmed jack and
the "Connect to…" list omits.

### 4.3 Anchors (cords mode)
`cv-module.ports()` already yields every anchor the rig's cords need: the jacks (the jack rows' inline anchors included) and **the knob
ends of every mod record in `cables.list()`** (cv-module.js:1045–1054 [R] — the own rows stay cv-cables records, §4.1, so their knob ends are
computed as today from `destPort`, cv-module.js:1088–1109 [R]: the knob's centre, or the hidden-end corner with `hid` / `tag`). The host's
`cordAnchors(ports)` adds two things (lane H): **rim points** for knob ends — `centre + r · dir` toward the source anchor, the cord's tip
(§4.5) — and **fanned anchors** for a jack that holds several cords (skeptic P1-3): keys `<jack>#<i>`, i = 0 … n − 1 in `edges()` order, 10 px
apart along the jack row, so the count is visible and each plug is its own target. Built in `relay()` once per relayout (never per frame;
the map is read by reference each frame). A row whose knob is in an unmounted drawer / folded module ends at the module's bar corner with
the tag badge, as today (cv-cables' `hid` idiom).

### 4.4 Interactions on a Wavecraft canvas (ease of use first — parity with the lines)
**Jack kind by mode** (skeptic P2-7: cv-module gives `data-kind="cord"` only to face jacks, an inline jack gets `j.kind || 'audio'`,
cv-module.js:489 [R], and cv-cables grabs an `audio` / `mod` jack as a *line* drag before `cordPress` runs, cv-cables.js:946 [R]): in `cords`
mode every rig jack is `kind: 'cord'` with `dir` and `sig: 'v'` (`decorate` keeps it pressable; `cordAsleep` **exempts** it — §3.2), so the
press path is world hook → cv-cables `press` → `o.cordPress` → **`rigHost.press`** (the 900 Series' idiom, its own code); in `lines` mode
the jacks carry stage 3's kinds (`audio` / `mod` / `note` / `warp`, `partJacks`) and cv-cables' own drags run, routed to `rig-core.can /
plug` through `sxCan` / `sxConnect` (§4.7). **Press rules on a jack** (skeptic P1-3 — the 900 Series' one-plug rule does not hold here: Σ
inputs, forked OUTs, an OUT that also feeds warp cords, an LFO's OUT with one cord per row): a press on an **output** always starts a **new**
cord (a live rope, `cords.live`; the target jack / knob under the finger, else the nearest compatible within `SNAP_PX 32`; the chip with
the target's label or the refusal; release → `plug`, one step); a press on an **input** holding cords **grabs the most recent** (the last in
`edges()` order; `cords.grab / move / drop`: drop on another compatible jack = re-patch, away from any = pull "Cord pulled · tap to undo",
a second finger / Escape = it springs back), a **long-press** on it offers "Which cord?" (the list by source); a tap on any jack → "Connect
to…" (empty) or the plug menu (plugged: Pull · Re-patch… · colour swatches · for a mod cord Edit… / Bypass). The knob glow / `.cv-nodest`
dimming, the refusal reasons and the History labels: unchanged.

**A cord's body**: a **tap selects it** (`cords.sel`; a × at the tap point, cv-cables' × idiom → Pull / Disconnect; Delete does the same) —
parity with a line (the lead's first guess on the skeptic's question 2; the user's 2026-10-21 "only plugs" rule stays on the 900 Series);
a **drag** on it pans (a cord never steals a pan). Mechanism: `cords.hit(p, r) → id | null` (lane C: a pure distance test over the ropes'
current points, r = 12 screen px) asked by the world's empty-canvas press path through the host before it pans; only a tap (≤ `TAP_PX`
movement) acts; the host answers null for patch cords.

| act | with lines (today) | with cords (a Wavecraft canvas) | target |
|---|---|---|---|
| plug a module into another | drag jack → jack, or tap a jack → "Connect to…" | the same (a live rope instead of a line) | 44 px jacks |
| move a connection elsewhere | drag from the plugged jack → the new jack (re-patch) | drag from the plugged **input** (grabs the most recent), or the plug menu's Re-patch…, or the badge | 44 px |
| remove a connection | tap the line → × ; Delete; long-press → Disconnect | **tap the cord → ×** (as a line); or drag the plug off and let go; or the plug menu's Pull; Delete | 12 px body / 44 px plug |
| a second connection from one output | drag from the jack again | the same (an output press always starts a new cord) | 44 px |
| modulate a knob | drag a modulator's jack onto the knob (or its bar) | the same | knob hit as today |
| edit a modulation | tap its badge (→ inspector); long-press → Edit… / Bypass / Disconnect | the same badge, the same taps; the knob under the cord stays fully visible and turnable (the tip end, §4.5) | 44 px badge |
| pick a cord's colour | — | tap its plug → 8 swatches | 44 px |
| see what a read-only connection is | tap it | tap it (selects) or its plug → the label chip (2 s) | 12 / 44 px |
| select | tap the line | tap the cord, a plug or the badge | 12 / 44 px |

Nothing costs more taps than today (G10 counts). The badge is the mod cord's handle (`button.cv-mbadge`, cv-cables places it 24 screen px
before the knob already; on a rope it sits at a fixed offset from the tip toward the source anchor, computed at relayout — never a DOM
element placed per frame, skeptic P1-4): tap = select + the inspector on a second tap, long-press / right-click = Edit… / Bypass /
Disconnect, Delete disconnects, **a drag of the badge grabs the knob-end tip** (re-patch to another knob or pull — new, cords mode only). The
hidden-end tag, the "preset" tag and the BAL / fork badge keep their DOM. The 24+ fade and the ∿ visibility modes apply to the rig's mod
cords (host-side list filtering: "never" claims none; the fade is the per-cord alpha, §4.5). Two fingers always win (`jackStop`); keyboard:
jacks, badges and a selected cord's × are buttons (Enter / Space / ContextMenu / Delete).

### 4.5 Look and the layer's additions (lane C, cv-cords.js — small, tested)
- **Two additions, packed into the existing floats** (skeptic P2-12: the strip vertex is `FPV = 7` floats x y nx ny side col sel and a plug
  instance `FPI = 5`, cv-cords.js:257 [R]; P-1(c) pins the stride and byte hash, tests/cv-cords.test.mjs:776–809 [R] — a new attribute would
  break it): **`o`** (alpha, one of four values: 1 normal · 0.85 the rig's own mod cords (lighter over the panels, skeptic P2-15) · `OFF_ALPHA
  0.45` bypassed / from a powered-off module / a part off · 0.3 the 24+ fade) packed as `sel = s + 4·oIdx` and decoded in the shader; and the
  **tip end** (skeptic P1-4, the lead's decision 3): the plug type `s` gains the value **2 = tip** — no plug, the rope ends at the anchor (the
  knob's rim, §4.3) in a 6 px dot — so a modulated knob is never covered (today a `PLUG_R 14` disc would sit on it and a press would turn the
  hidden knob). Records without `o` / with `s` 0 or 1 write **identical bytes** (the 900 Series' look; G8 pins the hash). `c` is clamped `0…7`
  on the GL path (map §2: today an index past 7 reads past the uniform arrays). The draft's `w` (body scale) is **dropped**: own
  connections only, one body width as the 900 Series.
- **`hit(p, r) → id | null`** (§4.4): a pure distance from `p` to each rope's polyline (the layer's points, awake or settled), nearest within
  r, patch ids excluded by the host.
- **Colours by rule** [C] (PALETTE indices; `toCord(record)`): audio from Oscillator 1 Blue 2, Oscillator 2 Green 3, Oscillator 3 Yellow 1,
  Sub Violet 6, Noise Black 7, Filter 1 Orange 5, Filter 2 Red 0, note cords (Arpeggiator / Clip → NOTE) Violet 6, the amp-slot cord and
  the rig's Envelope rows Yellow 1, its LFO rows Orange 5, its Macro rows Blue 2, warp cords Orange 5 at `o` 0.45. A user's pick
  (`dev.rig.cc`, keyed by the source end — a re-patch keeps it) wins.
- Dashed per-note rows cannot dash a rope: a per-note row from a rig LFO onto the rig's FX panel (a non-Serum destination) is drawn at
  `o` 0.85 with the badge tag "∿ last note" (the inspector's existing wording). Told to the user (§12 Q1's note).
- Plug geometry, the Studio preset, the quality tiers, the hold rule, the SVG fallback: unchanged. The `under` cord mode (a diagnostic
  pref: the cords drawn into cv-gl beneath `#world`, cv-world.js:703–712 [R]) would hide a rig's cords behind its panels — noted (§13), not
  supported for rigs.

### 4.6 What stays as it is
Every non-Wavecraft canvas (W7); the 900 Series' patching code and look (W6); cv-cables' pure derivations, badges, menus and drags; the
inspector / Mod list (`cv-modlayer.js`); `destOk` (but for §8.1); the `∿` toolbar button; `cv-pads` jacks.

### 4.7 The regret path (the user: "i have a feeling i might regret the patch chords")
`RIG.WIRES` (rig-core, `'cords'`), the pref `synth.rig.wires` and `?wires=lines|cords` feed `drawMode(t)`. With `'lines'` a Wavecraft canvas
renders the same records through `createCables` in its normal mode (`cords: null`): the rig's edges draw as stage 3's internal cables did
(3 px, the group colour, forks, the BALANCE badge, the routing menu — **so §6 keeps cv-cables' internal path and `sxCan` / `sxConnect` /
`sxCable`**, routed to `rig-core.can / plug`), the jacks carry stage 3's kinds, the jack rows stay the jacks, every badge and menu is the same
element. **The edit model is shared** (`rig-core`, pure); only the drawing and the press path differ. **G6 runs the WC-1 flows on the rig
canvas in both modes** and G4 checks that in lines mode the rig's cv-cables internal records equal `edges()` (ids and ends) and a line drag
plugs through `rig-core`, so the flip is proven before the user asks. If the user wants both at hand, a ⚙ → Canvas line "Connections: Cords
| Lines" writes the pref (WC-2, one line). Nothing stored depends on the mode (W3; `dev.rig.cc` is kept and ignored in lines mode).

---------------------------------------------------------------------------------------------------------------------------------

## 5. Skins (lane U; the mechanism and charcoal WC-1, ivory and the ⚙ line WC-2) [C]

### 5.1 Mechanism
A skin is **data + CSS, no code path, no number**: `rig-core.SKINS = [{ id, label, font?: 'narrow' | 'ui' }]` and, in `style.css`, one
block per skin scoped **`#world[data-cv-skin="<id>"] .cv-mod[data-cv-rig] .sx-root, … .rig-face`** (skeptic P2-9: the `--sx-*` tokens are
*declared on* `.sx-root`, sx-host.js:752–757 [R], so a value set on an ancestor loses to that declaration — the skin block must match
`.sx-root` itself) setting only **colour and font** custom properties — the kit's `--sx-bg`,
`--sx-panel`, `--sx-panel2` (knob cap), `--sx-line` (knob track), `--sx-graph` (knob value arc), `--sx-ink` (knob pointer, text), `--sx-mute`
(labels), `--sx-accent`, `--sx-neg` (wk.js:3288–3297 [R]) and the faces' own `--rig-face`, `--rig-bar`, `--rig-title`, `--rig-font`,
`--rig-jack-ring`, `--rig-jack-hole`, `--rig-screw`, `--rig-screen` (the screen's frame). The layout numbers (§3.8's `--rig-u / -col / -pad /
-gap / -row-*`) are **not** a skin's to set. The **corner screws**: `.cv-mod[data-cv-rig] > .cv-body::before/::after` + two spans, four
radial-gradient discs with a slot, 8 px, in the padding corners. Nothing in the DOM or the geometry changes between skins: a skin switch is
one attribute on `#world` (`data-cv-skin`), every element's box is equal before and after, and a screenshot diff differs only in colour / font
pixels (G6). The pref `synth.rig.skin` (through `store`, as `synth.cv.perf`); default `SKIN_DEFAULT = 'charcoal'`. **WC-1 ships one skin and
no setting**; **WC-2** adds `ivory` and ⚙ → Canvas → "<NAME> skin ▾" listing `SKINS` by label (one line). A new skin later = one `SKINS`
entry + one CSS block (+ a font file if it brings one). Per-instrument skins are §13.

### 5.2 Shipped skins
- **`charcoal`** (WC-1, default — the cord lab, ROADMAP 10 [R], docs/canvas/ref/cord-lab.html:10–20 [R]): face `#1f2023` on a `#17181a`
  body, line `#2c2e32`, ink `#ebe6d8` (cream), muted `#9c978a`, accent `#e8a33d`; knob cap black `#141518` with a cream pointer, track
  `#2c2e32`, value arc cream; screen frame `#141518`; jack ring cream `#ebe6d8`, hole `#0b0b0c`; four screws `#9c978a` → `#55524a`; the bar's
  title and every face label in the narrow face, 600, cream, letter-spaced 0.06 em, uppercase; the stripe is the group colour; cords keep
  the palette.
- **`ivory`** (WC-2, the second, original — Q5 (a)): face `#e9e3d3` (cream) on a `#d9d2c0` body, line `#bfb7a4`, ink `#1d1c1a` (charcoal),
  muted `#6d675c`, accent `#b5541f`; knob cap black `#17171a` with a **white** pointer `#f6f3ea`, track `#bfb7a4`, value arc `#b5541f`; screen
  frame `#f3efe4`; jack ring charcoal `#2b2a27`, hole `#0b0b0c`; screws `#8d8678` → `#4a463e`; the same narrow face in charcoal.
- Both are **original art**: no Xfer / Serum asset, logo, colour scheme or text; the faces' legends are the catalogue's generic words.
- **The screens** (skeptic P2-9): sx-ui-osc hard-codes its display palette (`C` sx-ui-osc.js:88, ≈ 20 uses; `OSC_COL` :149 [R]) and a canvas
  repaints only when something changes. **WC-1**: the Oscillator / Filter / Envelope / LFO displays keep the kit's colours (dark, like
  charcoal — acceptable on the one shipped skin; §13). **WC-2** (ivory): the display painters read `wk.theme(el)` (wk.js:2704–2717 [R]) for a
  rig mount and repaint on a skin change; G6 WC-2 screenshots the Oscillator display on ivory. The FX panel is not skinned (§13).

### 5.3 The narrow face
**The face font is a skin variable with Inter as its fallback** — `--rig-font: 'Archivo Narrow', Inter, var(--ui)` for a `font: 'narrow'`
skin, `Inter, var(--ui)` for `font: 'ui'`: the bar title, every knob / switch / jack label and legend on a face (`.rig-face .wk-knob {
font-family: var(--rig-font) }`); menus, value readouts (mono) and the screens' own text keep `--ui` / `--mono`. **The narrow face is a
download the user must OK** (the lead asks; Archivo Narrow, Omnibus-Type, SIL OFL 1.1 [R?: the lead verifies the licence from the font's
own OFL text and ships it]): **if yes**, the lead fetches it in phase 0 (builders in worktrees never fetch) → `fonts/ArchivoNarrow-{500,600,
700}.woff2` (Latin subsets, ≈ 20 KB each [R?: measured; ≤ 150 KB in all or one weight]) + `fonts/OFL-ArchivoNarrow.txt`, declared in
`fonts/fonts.css` beside Inter and precached (`node tools/precache.mjs --write` — so it is installed with the app and the `@font-face` is
served from the cache on first use; tests/fonts.test.mjs's rule extends to it: the licence text beside the file, the `?v=` on fonts.css);
**if no**, nothing is added and the charcoal skin renders in Inter through the same variable — the lane ships either way, and G11's layout
numbers hold in both (the label widths are checked with the fallback too). A system "condensed" stack (cv-panel `FONTS.condensed` [R])
differs per platform and is rejected for a look the user chose by eye.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Serum complete without "Show parts" (phase 0, lane S — mechanical)

Removed (map §1 [R]): the ⋯ items 'Show parts' / 'Bundle' / 'Add ▸' and the part ⋯ 'Bundle' (main.js:6365–6369, 6386–6389), `sxSetView`
(7114), `SX_VIEW` / `SX_VIEW_DEFAULT` / `sxNewView` (7038–7040) and their readers (`addTrack` 4235 `o.parts`, `sxModelLay` 7186,
`sxReplaceWithSerum` 7656–7667), the ⚙ select (5843–5851; `shell.sxView`), `sxLayParts` / `sxLayBundle` as *Serum* paths (they become the
rig's first-layout helpers under the rig's keys), the part tiles' Serum behaviour (`sxPartPick` / `sxPartDrop` / `sxReplaceWithSerum`: a part
tile now always means §3.5), `SX_HEAVY_TXT`'s "Bundle" clause (the rig's text: "This many <NAME> modules may stutter when zooming on this
device."), the tray's 'Serum parts' / 'Note tools' sections of the Serum view (§7), the `renderCustom` parts branch for Serum devices
(`isSerumModel(m)` → bundled always; `isRigModel(m)` → `rig-ui`). **Kept** (skeptic P2-1 — they are the rig's *lines* renderer and its
regret path, §4.7): cv-cables' internal-cable path (`internal()`, the stub / fork / BALANCE badge, the routing menu, `intPort`), `sxCan` /
`sxConnect` / `sxCable` (main.js:7566–7598 [R], re-pointed from `SE.setEdge` to `rig-core.can / plug`), `SerumUI`'s `{ parts: true }`
constructor path and `dropShell` / `buildShell` (the rig uses them), sx-ui-mod / sx-host / sx-edges whole, `LAY_UI` (file grammar), `normLay`
keeping `iN/*`. A Serum's own internal cable `iN.out → iN/fx.in` stays (a line). Tests moved (§11.3): canvas-3-sim's Show parts / Bundle / D-R5 / tray-on-Serum
cases are rewritten as rig cases in `tests/canvas-WC-sim.test.mjs`; its state-identity and I1 / I2 / resolver / own-sources / hidden-tag /
slot-host / meter cases are re-pointed at a rig (the same assertions). `cvParts` hooks become `__synthTest.cv.rig` (`show` / `newView` /
`VIEW_DEFAULT` / `VIEW_PREF` gone).

---------------------------------------------------------------------------------------------------------------------------------

## 7. The Sources tray (lane U)

`SRC_VIEWS` (cv-tray.js:471–486 [R]) gains a view **`rig`**, label `RIG.NAME`, tip "<NAME> — our modular synth, patched with cords",
sections `[{ id: 'rig', models: isRig }, { id: 'rigmods', head: '<NAME> modules' }, { id: 'rignotes', head: 'Note tools' }, { id: 'mods' }]`,
placed after `serum`; the Serum view becomes `[{ id: 'serum', models: isSerum }, { id: 'mods' }]` (its 'parts' / 'notes' placeholders go).
`PART_TILES` → `RIG_TILES` (ids `osc sub noise filter env lfo macros` → group 'rigmods'; `arp clip` → 'rignotes'; names Oscillator,
Sub oscillator, Noise, Filter, Envelope, LFO, Macros, Arpeggiator, Clip sequencer; glyphs: stage 3's for the five, new original strokes
for Envelope (an ADSR trace) and LFO (a sine)), the boxes `#srcPartSec` / `#srcNoteSec` re-labelled from the constant, shown in the `rig`
view only; **in WC-1 the Note tools section shows its heading and "Arrive with the next cut."** (the existing `cv-tsoon` placeholder idiom
[R]) and its two tiles come with WC-2; `setPartPlaced` greys a tile on a rig track when full ("3 oscillators", "2 filters", "4 envelopes", "10 LFOs", "Macros is on the
canvas", "Arpeggiator is on"). The `rig` model tile (`tileMeta` label `RIG.NAME`; art: `cv-art.SIL.rig`, an original silhouette — three
small panels with a sagging cord; chip art likewise; no maker word). Tiles outside the view stay `hidden`, not removed (the 2026-10-19 rule).
The view is remembered (`synth.cv.trayLayout = 'rig'`); "+ Track" opens the last view.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Host wiring (main.js, lane H; the predicate sweep phase 0 lane S)

### 8.1 Predicates (phase 0, mechanical; lane S works from a classification table, not a grep)
**The table** (lane S writes it first, every site → *engine* / *bundled panel* / *parts view* / *recipe data*, then edits): the literal
`'serum'` sites of map §3 **and the helpers that hide the meaning** (skeptic P2-8: main.js `isSerumDev(` 46 call sites, `isSerum(` 15,
`serumIds(` 12, `hasSx(` 6, `SXM` 10, `sxRecOf(` 15, `sxParts(` 20 — changing a helper changes every caller), plus the sites the map missed:
models.js (2), cv-cables' `isSx` / `serumDev` call sites (209–226, 270, 276, 332, 357), cv-module.js:237 / 241 / 272 / 277 / 971 / 1127.
**Engine** → `isSxModel(m)` / `isSxDev(t, dev)` (both Serum-engine models): `loadVals` 159, `newFx` 225, `normDevs` 259, `modVals` 479,
`buildPatch` 491, `buildInstPatch` 513–514, `trackVoice` / `modelVoice` 587 / 598, 1742, 2230, 2318, `capQ4` / `sxCap` / `qrOf`, `sendPatch`'s
Serum branches, `sxEdit` / `sxHost` / `sxLoad` / `sxSave` / `sxRefresh`, the MIDI-learn paths (midi.js's two sites), **cv-graph `compileTrack`
(cv-graph.js:282 [R] — the one with a sound effect: a rig would otherwise compile as `'classic'` with `fxOfPanel(null)` and its own FX rack
would drop out of the live patch)** and its other `shape: 'serum'` sites (the shape stays the literal in the payload — a rig track compiles to
`shape: 'serum'`: canonical-stream unchanged for Serum tracks), cv-model's eight, cv-module's `isSerumDev` sites, cv-modlayer's five, cv-cost
(`COST.synth.rig` = `COST.synth.serum`'s object, `serumLoad` by `isSxModel`), cv-migrate's seven (toV1 §2.4), **cv-mods `destOk`**
(`dev.model !== 'serum'` → `!isSxModel(…)`; `SERUM_IDS` / `PLAIN_SW` apply to both). **Bundled panel** → `isSerumModel(m)` / `isSerumDev`:
`renderCustom`'s panel class, `cvMenu`'s Serum branch, the Serum tray tile filter, `cvInstSize` (W_SERUM 1200). **Parts view** → removed (§6)
or re-pointed at the rig (`isRigModel` / `isRigDev`). **Recipe data** → **untouched**: smpgen.js's six sites are render-farm recipe data
(smpgen.js:133–135, 824–852 [R]) and must stay `'serum'`. The new model predicates are named `isSxModel / isSerumModel / isRigModel` because
main.js:167 already has the *device* predicate `isSerum = d => d.model === 'serum'` [R]. Every replaced predicate is equivalent for every
existing model (G1 proves it: the fixtures; G2's host-level case proves the rig's path).

### 8.2 The rig's host paths
`renderCustom` → for `isRig`: the same `SerumUI(box, sxHost, { parts: true })` host (map §1: state, panel undo, snapshots, the kit),
`sxViews` mounting **`rig-ui.face(host, 'amp', rec.box)`** for the Amplifier and **`rig-ui.face(host, part, M.el)`** for each module (the
faces of §3.1 on the grid of §3.8, built from `host.kit`; `mountPart` and the stage-3 panel classes are not used for a rig); **`drawMode(t)`**
(§1.3) decides `createCables`' `paths` option per canvas and the layer's `alloc`; `o.onRecords(records, ports)` → `cvCords().set(records.
map(toCord))` + `cvCords().anchors(cordAnchors(ports))`;
`cvDevices` lists `{ key: dev + '/' + part, kind: 'part', dev, part, model: 'rig', title: RIGC.label(part) }` from `rig-core.partKeys`;
`kindOfKey` → `'part'` for `isSxDev`; `host.size` → `{ fixed: { w: 64 · FACE[kind].cols + 32 } }` (§3.8; heights measured); `cvMenu`: the
Amplifier (About…, Replace with…, Init, Modulation list…, fold, front, Tidy — WC-2 adds Make it a Serum (complete)), a module (the face's
`menuItems()`: Init / Copy / Paste / Swap with ▸ / Lock, then Remove, fold, front, Tidy; ENV moves through `envToAmp` / `envFromAmp`, §3.4); the jack-row press: `cordPress` → `rigHost.press` in cords mode, cv-cables' drags in lines mode (§4.4); the drop
paths (§3.5) incl. `setTrackModel(…, 'rig', { module })` and `RIG.STARTER`; "Make it a <NAME>" on a Serum's ⋯; the notices (every text
through `RIG.NAME`); `sxHeavy` for rigs (the same counter, the rig's text); `__synthTest.cv.rig = { add, remove, plug, pull, repatch, can,
edges, convert, wires, drop, replace, amp, gate, init, HEAVY }`. The master canvas refuses rig tiles as it refuses every instrument
(`MASTER_SRC`). **WC-2** adds the preset strip's host hooks (§3.7), the reverse conversion, the ⚙ skin and (if asked) wires lines.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Performance, the iPad, the presets

- **DOM**: a Wavecraft face is built from the same kit widgets as stage 3's parts, on the RIG grid (§3.8): the budget stays IMPL-3 §1.4's
  [R] — a (complete)-sized rig (Amplifier, one Oscillator, one Filter, FX) ≤ 1.6 k painted elements / ≤ 12 canvases; a full WC-1 rig
  (Amplifier, 3 Oscillators, Sub, Noise, 2 Filters, 4 Envelopes, 2 LFOs, Macros, FX with 4 effects) ≤ 5.0 k / ≤ 40 — **plus ≤ 6 elements per
  jack**; lane F reports each face's element count against its stage-3 counterpart (a face with more than 1.2 × its counterpart's elements
  explains why in its notes). The heavy notice at 1 866 painted (touch, once). S0's verdicts hold as the floor: `p1` P+, `p1x` one frame
  short of P+ on the iPad Pro — a full rig is the same class; nothing here moves it (3R, the GPU module painter, stays parked).
- **Cords**: a full rig ≈ 22 audio / note cords + its mod cords; awake only while something moves (a module drag wakes its own cords; a
  pinch wakes none — the anchors move with the camera, the rope is in world px). Budget: **40 awake cords ≤ 0.25 ms step + 0.06 ms draw on
  the iPad Pro** (ui-m9 measured 0.2 + 0.054 [R]); at Low the ropes are still (no step). The Mac CDP harness at 4× / 6× CPU reproduces the
  envelope (IMPL-P's method: 40 awake at 6× ≈ 1.2 ms median [R]).
- **Memory**: the drawing buffer (13.4 MB at 1440 × 900 dpr 2 on the Mac [R]; **≈ 22.7 MB on the iPad Pro** at 1376 × 1032 pt dpr 2 — the
  main platform, skeptic P3) exists on a Wavecraft canvas as it does on a 900 Series canvas, and nowhere else (`alloc` by `drawMode`); G7
  records it and the 60 s sweep (no context loss).
- **Presets** (ROADMAP 14): High / Medium / Low change the cords' quality (34 / 14 / 14 drawn points, still at Low) — unchanged; the rig
  has no face textures. Nothing audio.
- **Touch**: plugs 44 px, badges 44 px, two-finger cancel; jacks sleep below 50 % zoom (a pan never plugs).

---------------------------------------------------------------------------------------------------------------------------------

## 10. Gates

| gate | what | target |
|---|---|---|
| **G1 outside = today (W1)** | every golden file (the 12 golden-*.test.mjs) and canonical-stream (both fixtures), canvas-M-bounce (ref-M), engine-track's warm-up hash, ref-SC's live-p1 — after phase 0 and after every lane; **no DSP file in the stage's diff** (reviewer 1 runs `git diff --stat dee3010..HEAD -- engine.js drum-core.js <the files of DSP_FILES, main.js:866 [R]>` and it is empty; the lead re-checks before the squash — **not** a `sx-*.js` glob: sx-edges / sx-host / sx-ui-* are UI files the lanes edit, skeptic P1-5); the predicate sweep: `compileGraph` / `compileTrack` / `compileMods` / `cablesOf` / `destOk` outputs deep-equal the base's for every factory Serum preset track, every classic, drum, 900 Series and master fixture of main-sim's sessions (recorded by the lead from dee3010 into `tests/ref-WC/base.json`, **parts-view fixtures left out**: `cablesOf` changes for them by design); the Serum panel's DOM for a bundled Serum byte-identical in structure (its ⋯ menu minus the three items) | exact |
| **G2 a rig = its Serum (W2)** | node: for `rigBlank()`, `rigStarter()`, `rigInit()`, 20 factory presets and 60 random states S: `patchFor('rig', { s: S }, fx)` deep-equals `patchFor('serum', { s: S }, fx)` (`cpKey` equal); the engine renders a rig track and a Serum track with S bit-identically (golden-harness `renderTrack`, 10 s, keys + wheel + a song); **host-level** (tests/canvas-WC-sim.test.mjs; skeptic P2-8): the posted `{t: 'patch'}` of a rig track deep-equals a Serum track's with the same `s` / `fx` (qr, osCap, ext, fxr — `patchFor` alone does not prove the live path); `adopt(S)` changes only `x.env` fields and lists each | exact |
| **G3 the key gate** | node (tests/rig-sound.test.mjs, the real engine at 44.1 × 2 and 48 × 1): a rig with one Oscillator (a 220 Hz note on a pure-sine frame — the Default Shapes table's sine [R?: the lane picks the frame and pins its name], level 1) — **the voice's amplitude read directly** (`gAmp` / `eV[0]` per chunk through the dsp-scope harness, or the ratio of the output to an ungated render of the same phase — not a windowed peak of the waveform, skeptic P2-11): from 0 at the note-on chunk to ≥ 0.999 within 3.0 ms + 1 chunk, monotonically; after note-off to < 1e-5 within 3.0 ms + 2 chunks + the decimator's group delay, and the voice count reads 0 within one more quantum; **click-free on the output**: max |x[n] − x[n−1]| over the on / off edges ≤ 1.05 × (the steady sine's own max step + peak / (0.003·fs)); a re-press 1 ms into the release restarts from the current level (no sample jump above the same bound); **a preset's ENV 1 flags (BPM on, Voice Steal Retrigger on) set, then the Envelope pulled: the gate is the gate** (flags reset, the re-press bound holds; skeptic P2-3); a held key stays at the steady level for 10 s (no decay: sustain 1); legato mono: no re-gate; 8 simultaneous keys each gate (poly); `isGate(rigBlank().s)` true, `isGate(any factory preset)` false; `GATE` round-trips through `normalizeSerum` unchanged | exact / stated bounds |
| **G4 edges ↔ state (W3)** | node (tests/rig-core.test.mjs): over the enumerated routing states jackrules.test.mjs already walks, `edges()` ≡ `serumEdges` (ids, ends, kinds) **except the one documented difference** — a source into a filter whose input switch is off is a "dry" cord, not a stub — plus the amp-slot cord iff `!isGate ∨ read`; **the 19 factory presets with a dry source and the 30 with a powered source into an off filter** (the skeptic's lists, re-derived by the test): every audible source has a cord to a module that exists (I1'), none is unplugged by `adopt`; `plug / pull / repatch` ≡ `setEdge / cutEdge` field for field; `envToAmp(k)` then `envFromAmp()` with the same free slot returns the same state (**`e<k>.sus` within 1 ulp** — `√x²` is not exact —, every other field identical), rows re-sourced **and re-targeted** both ways (a `macro1 → e3.dec` row follows into `e1.dec` and back; a canvas row `iN:e3.*` too), the flags travel, lay keys swapped, the ordinal kept; the kit's Swap / Paste / label-drag with ENV 1 as a party produce the same state as `envToAmp` / `envFromAmp`; `envFromAmp` never takes a slot in `held` (a canvas ENV modulator's injection) — refused with its text; every refusal of §4.2 with its text; `can` is pure (same inputs → same output, inputs untouched); 1 000 random edit sequences never leave `normalizeSerum(s) ≠ s`; `adopt` idempotent; `normRig` / `pruneRig` fuzz (never throws, bounds, a GC drops only orphans); **in lines mode** (`RIG.WIRES = 'lines'`) a rig track's cv-cables internal records equal `edges()` (ids and ends) and a line drag plugs through `rig-core` (§4.7); the `RIG.NAME` literal appears nowhere in `*.js` / `*.css` / `index.html` outside `rig-core.js` (a grep test; docs excluded) | exact |
| **G5 schema and files** | cv-migrate: 16, STEPS 16, "a newer file" 17; `upgrade()` returns `notes` (`[]` for every other step); a 15 file with a parts-view Serum opens with the Serum whole, `vals.s` / `fx` byte-identical, its `iN/*` entries kept, the notice text (and the hidden-link-rows sentence when it has them), **no module overlap** after the open (the Bundle rule: `sxLayBundle` + cvRoom); a 16 file with a rig opens **read-only** in the base build (the stage-P / M / SC pattern); `toV1` of a rig → a `serum` device with the same `vals.s` / `fx`, the lost line; "Make it a <NAME>" keeps every `iN/*` position (`keepLay`, the `sxModelLay` purge skipped) and (WC-2) ↔ "Make it a Serum (complete)" round-trips the state byte-identically (no `x.env` 0); the fx-core / song pins (`normDev` keeps `rig` only on a rig; a `rig` field on a Serum dropped) | exact |
| **G6 UI (reviewer 2, headless Chrome 1440 × 900 / 1366 × 1024 / 1024 × 1366 touch, dpr 2) — WC-1** | the first drop on a Juno / a Serum / an 808 / a 900 Series (Oscillator → Amplifier → FX → OUT, the notice text, undo restores the old instrument's whole state), each WC-1 module kind as a first drop, adds with auto-plug, the three refusals, the amp Envelope's appear / move / disappear with the legend's strike-through, Make it a <NAME> (positions reused), Replace with… from the Amplifier, Init, Remove, Tidy, the starter tile; cord drags by touch-emulated pointers (plug, re-patch from an input, pull, fork + BAL badge, refusal chip), **a second destination from one LFO's OUT, a third oscillator into Filter IN (fanned plugs, three visible), pulling one cord out of a Σ input (the most recent; "Which cord?" by long-press)**, **a tap on a cord's body selects it and its × pulls it; a drag on the body pans**, rig jacks patch at k 0.4, the plug menu's swatches, the rig's own Envelope / LFO / Macro cords onto its knobs and onto its FX panel's knobs (badge, inspector, bypass alpha, Delete, the badge drag re-patch; **the knob under a tip cord is fully visible and turnable**), a dry source's "dry" tag and the Filter's input switches flipping it, "Make it a <NAME>" on a default Serum (OSC A into an off Filter 1 → a Filter 1 module ⏻ off, the cord into it), a hidden-end tag, the "∿ last note" tag; **on the same rig canvas Amplifier → FX, FX → OUT, a canvas LFO onto a rig knob and a Pads note line are lines** (their cv-cables DOM equal to the base's for those records); **the same flows on the rig canvas with `?wires=lines`** (the regret path, §4.7: every step's end state identical, the lines drawn); **every non-rig canvas unchanged**: a Juno with 6 modulators, a Serum complete with 24 mod cables + its own-FX cable, an 808 + Pads note lines, the master canvas, the 900 Series' `m13` / `m13w` / `m30` — their cv-cables SVG markup and the layer's `alloc` state equal the base's (W7; G12 pins it in the sim too); the Serum view has no parts tiles and a Serum's ⋯ no Show parts; no console error; the bundled fonts load with no network request (the CDP request log). **WC-2 adds**: a Serum preset loaded into a rig (Envelope 1 appears), Make it a Serum (complete), the two skins (a switch changes no layout box: `getBoundingClientRect` of every element equal before / after; pixel diffs only in colour / font), the ⚙ skin line, Arpeggiator / Clip faces | pass |
| **G7 frame cost (CDP harness, IMPL-P's method)** | scene `rigX` (the full WC-1 rig of §9 + 8 mod cords from canvas modulators + OUT): pan / pinch 25–200 % / a module drag of the Amplifier (≈ 12 cords awake) / sway: at 1× and 4× CPU **P+** (IMPL-3 §1.5's bar: bursts median ≤ 17.0 ms, p95 ≤ 20, no frame > 33, firstMove / settle ≤ 80), at 6× P; `cords.stats()`: 40 awake step ≤ 0.35 ms / draw ≤ 0.08 ms on the M4 (≤ 0.25 / 0.06 projected to the iPad by `ui-m9`'s ratio); the buffer 13.4 MB at 1440 × 900 recorded on the rig canvas and **0 on a Juno canvas**; a 60 s k-sweep with 0 context losses; painted elements of `rigX` ≤ 5 000 + 6 × jacks, of the (complete)-sized rig ≤ 1 650; the heavy notice fires once past 1 866 on a touch device; `ui-WC-mac` recorded in bench.json (informational; the iPad joins the consolidated pass) | pass / recorded |
| **G8 the layer's additions and the renderer mode** | tests/cv-cords.test.mjs: records without `o` and with `s` 0 / 1 → the P-1(c) byte hash **and stride** unchanged (the 900 Series' look; `FPV` 7 / `FPI` 5 kept — `o` rides in `sel`, the tip in `s`); `o` sets a cord's alpha to one of its four values; `s: 2` draws no plug and a 6 px dot at the anchor; `c` 8 / −1 / NaN clamp to 0…7 (no out-of-range uniform read); `hit(p, r)` finds the nearest rope within r and none beyond; `set` with 40 rig records (edges + own rows) diffs by id (a re-set with the same ids re-seeds nothing); anchors from a Map with knob-rim and fanned `#i` keys; `live` + `grab` from a rig jack. tests/cv-cables.test.mjs: with a `cords` predicate, a claimed record gets no `path` element and keeps its badge / tag / × / menu / drag, an unclaimed one draws as today on the same canvas, `onRecords` fires after `set` and `layout` with the claimed records and ports; **`cords` absent = today's DOM byte for byte** for every existing test's records (W7) | exact |
| **G13 our own words (skeptic P2-14)** | headless DOM + notice scan of a full rig, its menus, refusals, tooltips, the Info / Preferences dialogs of its host and every notice the WC-1 flows raise: no "Serum", "VOICE" or "Xfer" outside the inspector's engine ids (§13 accepts those) — the sx-edges `WHY` texts ("Serum sources play through their VOICE", "Not a cable of this Serum", sx-edges.js:48–50 [R]), `SX_OWN_MACRO` (main.js:7628), cv-model's "the Serum" notice (cv-model.js:333), `modRefusal`, the S1 tooltip (sx-ui-mod.js:675, sx-ui-osc.js:2854) and sx-host's `BUILD` 'Serum v2 panel' (sx-host.js:87) each get a rig-aware wording through `RIG.NAME` (a wording table in rig-core, lane K; the bundled Serum keeps its words) | exact |
| **G9 tray, art, pins** | cv-tray: seven views, the rig view's sections and nine tiles, the Serum view's two sections, `setPartPlaced` texts; cv-art `SIL.rig` + chip; MODELS 19, `rig` last, `classicOf(rig)` false; cv-cost `COST.synth.rig`, the tile label "~4 %"; cv-module `PART_W_DEF.amp`, `partJacks` for `env1` / the strips; index.html labels from the constant; pwa precache (fonts + new modules); lint `?v=9`; app.test's DSP list unchanged | exact |
| **G10 a11y / keyboard / touch** | every jack and badge focusable and operable (Enter / Space / ContextMenu / Delete / Escape), aria-labels name the module and port with the display name; two-finger cancel of a plug drag (gesture.js's layer); a plug drag at k 0.5 and 2.0 lands (hit radii per `--jp`); below READ_K a press on a jack pans; **the parity table of §4.4 holds**: a scripted run of each act counts its pointer events in lines and cords mode and the cords count is ≤ the lines count | pass |
| **G11 the layout system (§3.8; `tests/ui-layout-wc.mjs` in the CDP harness, dpr 2, at 100 % and at the iPad sizes' default camera)** | for every WC-1 face (each module kind, every oscillator type, the Amplifier with its drawer closed and open, the amp Envelope and a free one), measured from `getBoundingClientRect` in world px: module width = 64·n + 32 and a multiple of 32; every knob's SVG 40 × 40 with its centre on a column centre (`16 + 32 + 64·i` ± 0.5) and on its row's knob line; row tops at the cumulative heights (head 32, screen 112 / 128, knob 76, switch 32, jack 56; gaps 12; padding 12 / 16 / 16) ± 0.5; the same row heights across faces (one set of numbers for the family); every text box ≥ 6 px from the face edge and from every control box, ≥ 8 px from every other text box, `scrollWidth ≤ clientWidth` (nothing clipped), font sizes ≥ the §3.8 minima; jacks 28 px at column centres, hit circles ≥ 44 px; fill ratio 0.55 … 0.85 per face; label / face contrast ≥ 4.5 : 1 (per skin); **parity**: the set of `data-dest` ids on a face ⊇ its stage-3 panel's (nothing lost); element count per face ≤ 1.2 × its stage-3 counterpart (else explained). **Contact sheets** for the user: one PNG per size (1440 × 900 at 100 %; 1366 × 1024 and 1024 × 1366 at their default camera) of every WC-1 face side by side in the charcoal skin, plus a Wavecraft canvas with the starter rig and six cords — produced by the harness into the lead's scratchpad and shown to the user before WC-1 deploys (not committed); the user's verdict goes to §14 | exact / the user's eye |
| **G12 every other canvas as today (W7)** | sim (tests/canvas-WC-sim.test.mjs): for main-sim's sessions over a Juno, a Serum complete with mod cables, an 808 + Pads, a 900 Series and the master, the `svg.cv-cables` / `svg.cv-cable-ends` markup and the badge DOM after each step equal the base's record (`tests/ref-WC/base.json`, recorded from dee3010); `drawMode` is `lines` there and `cords.alloc` false; on a rig canvas `drawMode` is `cords` unless `RIG.WIRES` / the pref / `?wires=` says `lines` | exact |

---------------------------------------------------------------------------------------------------------------------------------

## 11. Lanes, interfaces, pins (the leaner shape; two cuts)

### 11.0 WC-1 — phase 0: the lead (Fable 5.1), then lane S (Sonnet), sequential, before the builders
- **The model commit (the lead, ≈ 250 lines)**: `rig-core.js` with `RIG` (every flippable constant of the header), `GATE`, `isGate`,
  `rigBlank / rigStarter / rigInit`, `adopt`, `SKINS`, `MODULES`, `AUTOPLUG` (data only; `edges / can / plug …` are lane K's); `models.js` `rig` (+ `isSxModel / isRigModel /
  isSerumModel`); `song.normDev` `rig` + `normRig` + `pruneRig`; cv-model `PARTS` + `env1`; cv-migrate 16 (+ the step, `upgrade().notes`, toV1); `cv-cost` entry;
  `cv-art` SIL (a placeholder stroke, lane U draws it); the pins they move (§11.3); `tests/ref-WC/base.json` recorded **from dee3010** (G1's
  compile / derivation record and G12's cable-DOM record). Every test green.
- **Lane S (Sonnet, mechanical, after the model commit)**: the predicate sweep (§8.1, every site of map §3 by line) and the Show-parts
  removal (§6), test moves (§11.3). Gate: G1 exact, every existing test green, `git grep -n "'serum'"` outside the engine's kind / payload
  shape sites reviewed line by line in its notes.

**WC-1 lanes** (phase 1 in parallel in worktrees reset to the lane-S commit; phase 2 after K's interface — stubs earlier):

| lane | phase | owns (exclusive) | gates | model |
|---|---|---|---|---|
| **K** rig rules | 1 | `rig-core.js` (§2.3, §3.4, §4.2: `edges / can / plug / pull / repatch / envToAmp / envFromAmp / partKeys / nameOf / pruneRig`, the wording table of G13), **`sx-edges.js`** (additive: `env1` in `PARTS` / `splitKey` / `KIND_OF` / `SLOT` / `slotsUsed`, link rows as readers, the `voice.level` end — jackrules.test green unchanged), `tests/rig-core.test.mjs`, `tests/rig-sound.test.mjs` (G2 / G3 with golden-harness and the dsp-scope harness) | G2 (node), G3, G4 | Fable 5.1 (sound-affecting state logic: the gate, the slot moves) |
| **C** the cords renderer | 1 | `cv-cables.js` (**the `cords` record predicate + `o.onRecords`**, the live drag over `cords.live` and the input-grab / output-new rules in that mode, the badge drag, the body-tap × — nothing changes for `cords` absent), `cv-cords.js` (`o` packed into `sel`, `s: 2` tip, the `c` clamp, `hit(p, r)` — nothing else), `cv-module.js` (`partJacks` `env1` + the jack kind by mode, the jack-row inline anchors), `cv-world.js` (the empty-canvas press asks `o.cordHit` before panning; `cordAsleep` exempts `[data-cv-awake]` jacks), `tests/cv-cables.test.mjs`, `tests/cv-cords.test.mjs`, `tests/cv-module.test.mjs`, `tests/cv-world.test.mjs`, `tests/ui-bench-wc.mjs` (+ the `?wc=1` hook in `tests/ui-bench.html`); **its CSS** (the × on a cord, the badge-drag cursor) written as one block in its notes and applied by lane U | G8, G6's cord half (with reviewer 2), G7 scenes | Opus 5.5 |
| **F** faces | 1 | `rig-ui.js` (new: `FACE` recipes + the face builder on the RIG grid §3.8 for the eight WC-1 kinds, the screen components over the kit's displays, the jack row, `press` glue for the jack row's "Connect to…" / plug menu over `rig-core.can`), `tests/rig-ui.test.mjs` (DOM-stub: the recipe → the row / cell geometry by computed layout numbers, `data-dest` parity per face), `tests/ui-layout-wc.mjs` (the G11 harness script + contact sheets) | G11, G6's face half | Opus 5.5 (the user's eye on the contact sheets before deploy) |
| **U** skin + tray + art + fonts | 1 | `cv-tray.js` + `index.html` (§7), `cv-art.js` (SIL + chip art), `fonts/` (+ `fonts.css`, the OFL text), **`style.css`** (the `charcoal` skin block appended last, `.cv-mod[data-cv-rig]` chrome + screws; lane C's block from its notes — the grid CSS is F's, injected by rig-ui), `tests/cv-tray.test.mjs`, `tests/cv-art.test.mjs`, `tests/fonts.test.mjs`, the style pins | G9, G10, G6's skin half | Opus 5.5 |
| **H** host | 2 | `main.js` (§3.5, §8.2: predicates' rig branches, `renderCustom` for rigs mounting F's faces, `cvDevices`, `kindOfKey`, `size`, `cvMenu`, drops / replace / Make it a <NAME> (`keepLay`) / Init / Remove, `drawMode` + the `cords` predicate + `toCord`, `onRecords` → the layer, `cordAnchors` (rim points, fanned `#i`), `o.cordHit`, cv-patch's conditional `cords` dep, `upgrade().notes` shown, `sxCan` / `sxConnect` → `rig-core`, `rigHost(deps)`, notices, hooks), `cv-modlayer.js` (the "Add a Velocity module to see it" line), `tests/canvas-WC-sim.test.mjs` (new; the stage-3 sim cases re-pointed; G2's host case; G12), `tests/main.test.mjs` pins | G2 (host), G5 (sim part), G6 flows, G12, G1 re-run | Opus 5.5 |
| reviewers × 2 | 3 | (1) **real engine + sim** (Fable 5.1): W1–W7, G1–G5, G8, G12; a 50-track project with 10 rigs and 400 mod rows (no throw, `compileMods` memo hit rate), undo / redo storms over cord edits, the slot moves under Init / replace, every refusal; (2) **headless Chrome** (Opus 5.5): G6 (both wire modes), G7, G9, G10, G11, the base build's read-only check, Safari on the Mac if available | — | — |
| fixers | after | the finding's files, failing test first | | Sonnet / Opus |

Then: one sweep (every test file, one at a time), the contact sheets to the user, deploy WC-1 (`tools/deploy-canvas.sh`), **the user's
hands-on** — their feedback is folded into §14 and decides WC-2's shape (and the flips of the header's constants).

**WC-2 lanes** (after the feedback; the same rules; no schema change):

| lane | owns | content | model |
|---|---|---|---|
| **F2** faces | `rig-ui.js`, `tests/rig-ui.test.mjs`, `tests/ui-layout-wc.mjs` | the Arpeggiator and Clip faces (8 col), the Oscillator's multi / granular / spectral interiors on the grid, the Amplifier drawer's panels re-laid, whatever the contact-sheet verdict asks | Opus 5.5 |
| **U2** skin + tray | `style.css`, `cv-tray.js`, `index.html`, `cv-art.js` | the `ivory` skin block, the ⚙ "<NAME> skin ▾" line (with H2), the Note tools tiles, (if asked) "Connections: Cords \| Lines" | Opus 5.5 |
| **H2** host | `main.js`, `tests/canvas-WC-sim.test.mjs` | the preset strip and Serum presets into / from a rig (§3.7), "Make it a Serum (complete)", the ⚙ lines, feedback fixes | Opus 5.5 |
| **K2** rules (if the feedback moves them) | `rig-core.js`, its tests | changed `AUTOPLUG` / `STARTER` / gate / slot rules | Fable 5.1 |
| reviewers × 2, fixers | | as WC-1, scoped to the diff | |

### 11.1 Interfaces (fixed here)
- `rig-core`: `edges(s, fx, dev, rig) → [{ id, a, b, kind: 'audio' | 'note' | 'warp', int, dev, edge, c, o, s, ro, badge?, label?, fork?, share?,
  off?, dry? }]` (cv-cables' internal-record shape plus the cord fields; **kind `'fx'` is dropped** — Amplifier → FX is cv-cables' derived
  line) with `a` / `b` ends in **sx-edges' ids** (skeptic P2-7: `voice.main / direct / note / out`, `voice.env1` the ENV 1 *output*, the new
  `voice.level` *input* for the amp-slot cord; module ports `out in warp k1…k8`) and jack keys `'<dev>/<part>.<port>'` / `'<dev>.<port>'`; the
  faces print IN / DIRECT / LEVEL / NOTE / OUT over those ids; `can(s, fx, a, b) → { ok, why, a, b }`; `plug / pull / repatch / envToAmp /
  envFromAmp → { f: [[path, before, after] …], why, notes: string[], lay?: [[from, to]] }` (`f` empty on a refusal, `why` set); `partKeys(s,
  lay, dev, used, rig) → part[]`; `GATE { p, env }`, `isGate`, `rigBlank()`, `rigStarter(prefs)`, `rigInit()`, `adopt(s) → { s, notes }`,
  `nameOf`, `pruneRig`, `RIG` (`NAME ID VIEW WIRES GATE_MS HUB_OPEN STARTER`), `AUTOPLUG`, `SKINS`, `SKIN_DEFAULT`, `MODULES`, `WORDS` (G13).
- cv-cables: `createCables(world, { …, cords: rec => boolean | null, onRecords(records, ports) })`; `createCableDrag(world, { …, live:
  cords.live | null, grab: cords.grab / move / drop | null })` — null = today's SVG live cable and today's re-patch-by-new-cable.
- cv-cords: records `{ id, a, b, c, s: 0 | 1 | 2, o }` (`s` 2 = tip, `o` one of 1 / 0.85 / 0.45 / 0.3); `hit(p, r) → id | null`.
- The host ↔ cord layer: `toCord(record)` (main.js, from `rig-core`'s colour / look rules); `cords.set / anchors` from `onRecords`;
  `drawMode(t) → 'lines' | 'cords'`; `cordOf(rec)` the predicate (§4.1's table); `cords.alloc(drawMode(t) === 'cords' || isPatchDev(…))`;
  `o.cordHit(p) → id | null` for the world (patch ids excluded); cv-patch's `cords` dep `() => isPatchDev(…) ? cvCords() : null`.
- cv-module: `partJacks(part, mode)` for the rig (`env1` out mod; kind `'cord'` + `dir` + `sig` in cords mode, stage 3's kinds in lines
  mode; `data-cv-awake` on rig jacks), `ports()` (jacks + the knob ends of `cables.list()`) → `onRelay(ports)`.
- rig-ui: **`rigHost(deps)`** (the cv-patch idiom, cv-patch.js:33–42 [R]: `doc, world, cords, cur, rec, edit (sxCable), notice, undo, menu,
  markDests / devAt / modCan, view, held`) → `{ face(kind, root, args) → View { el, panel, power, destroy, shown }, press(e, el) → { cancel } |
  false, applySkin(worldEl, id), FACE }`; `FACE[kind]` the row recipe (`rows: [{ t: 'head' | 'screen' | 'knobs' | 'switches' | 'jacks', h,
  items }]`, `cols: n`); the Amplifier is `kind 'amp'`.
- Hooks: `__synthTest.cv.rig` (§8.2) + `wires(mode)`, `__synthTest.cv.cords = { list(), anchors(), stats(), hit(p) }`, `__synthTest.cv.layout()`
  (G11's measurements as data).
- Messages / payloads: **none new**; a rig compiles to Serum's payload (`shape: 'serum'`).

### 11.2 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*` (serum-ui's `scrub` Proxy where
a DOM is in play); one test file at a time with `--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs
--write`); builders in worktrees `git reset --hard` to the phase-0 (lane S) commit; **no DSP file in any diff** (G1: reviewer 1's `git
diff --stat` over the DSP files is empty); no iPad app build this stage (browser first; its node tests stay in the sweep); every
user-visible string with the synth's name goes through `RIG.NAME` (G4's grep); original art only; **a layout number lives in one place**
(§3.8's custom properties — a face recipe never carries a pixel number, a skin never carries a layout number).

### 11.3 Pins that change by design
cv-migrate.test (every 15 / 16 pin of its stage blocks: 32–33, 1056, 1147, 1233, 1330, 1474 → 16; "a newer file" 17), the schema pins in
canvas-8-sim / canvas-9-sim / canvas-M-sim / canvas-SC-sim (15 → 16), cv-tray.test (648–661 six → seven views and their labels; 653 / 659 the
Serum view's sections; 966–1007 the tiles: 7 → 9 (two as WC-1 placeholders), groups, glyphs; 1011–1021 selector pins gain `[data-cv-skin]` / `.cv-mod[data-cv-rig]`), cv-art.test:79
/ cv-tray.test:446 / 847 / 1343 / cv-shell-sim.test:260 (MODELS 18 → 19), cv-cost.test:33–44 (a `rig` row), canvas-3-sim (its Show parts /
Bundle / D-R5 / Serum-tray cases retired; the rest re-pointed, §6), classic-mod.test / cv-mods.test (`CLASSIC` filters: `rig` is custom —
already excluded), golden-graph:24 (`!m.custom && !m.family`: unchanged for `rig`), integration.test:652–658 ("every plain model renders":
a rig renders as a Serum), pwa.test / fonts.test (new files), lint.test (`?v=9`), cv-module.test (1350 / 1414 / 1441 / 1475 with the rig's
keys), cv-cables.test (gains the `cords` predicate / `onRecords` cases; **its drawing tests stay as they are**: lines mode is today's). **Not
changed**: every golden, canonical-stream's fixtures, ref-M / -SC / -9 / -9b / -9c / -7a…7d, serum-core.test's tables (SOURCES 62, DESTS 529,
`MODULE_FIELDS`, the CP key set, `cp2-default.json`), serum-dsp.test, patch-core.test / cv-patch.test / moog-*.test (W6), app.test's DSP list,
cv-cables' SVG markup for every non-rig canvas (W7 / G12).

### 11.4 Docs (the lead, at the end of each cut)
ROADMAP row 18 (WC-1 shipped + the user's answers and feedback; then WC-2; row 10 "merged"), HANDOVER (§4: `rig-core` / `rig-ui`, the gate,
the record-list / renderer split and `drawMode`, the RIG grid, schema 16, the skin mechanism, the predicates; §5: lessons), SPEC-canvas (§2.9:
the Wavecraft canvas draws its connections as cords, the rest as the table says; §8 Wavecraft beside Serum), `tests/ref-WC/` frozen at WC-1's
acceptance (G1's base record, G12's cable-DOM record; G3's gate render hashes the moog-b `{ note, commit }` way), map-wc.md kept as the
stage's map.

---------------------------------------------------------------------------------------------------------------------------------

## 12. Questions for the user — answered 2026-10-25 (the answer first, then the question as asked)

The user's caveat stands over every answer: "all these answers are kind of guesses until i see and feel the thing" — hence WC-1 first, and
the header's flippable constants.

- **Q1 → (b).** Patch cords everywhere? (a) Every connection on every track's canvas becomes a cord — one look; the cords cost nothing while
  still — recommended. **(b) Only the Wavecraft (and the Moog) get cords; every other track keeps today's lines** — chosen ("i have a feeling
  i might regret the patch chords in the future but lets see. its all about ease of usability in the end and intuitive interfacing"). Noted
  to the user: a rope cannot be dashed, so a per-note cable onto the Wavecraft's effects says "∿ last note" on its badge instead.
- **Q2 → (a).** The Amplifier: **dropping your first oscillator gives Oscillator → Amplifier → effects → out**, the Amplifier a visible module
  with the keys settings, the level, and the LEVEL jack whose printed normal is KEYS. (b) No hub — not chosen.
- **Q3 → (a).** "Full level" = **the oscillator and the master at their normal knob positions** (a Serum's loudness). (b) LEVEL at maximum —
  not chosen.
- **Q4 → (a).** Saved projects where a Serum was shown as parts **open with the Serum whole, sounding exactly as before, with a one-time
  notice; the Serum's ⋯ has "Make it a Wavecraft"** (the sound kept, the parts where they were). (b) automatic conversion — not chosen.
- **Q5 → (a).** The second skin is **"Ivory"** (cream panels, charcoal lettering, black knobs with white pointers) — WC-2.
- **Q6 → (a).** **Serum presets load into a Wavecraft and a Wavecraft saves Serum presets** — WC-2.
- **Q7 → (a).** **The Wavecraft tile gives a small starter rig that plays** (Oscillator → Filter → Amplifier with an Envelope on the level);
  the module tiles stay the way to start from one oscillator.

**To ask after WC-1's hands-on** (not before — the user wants to feel it first): does the Amplifier earn its place, or should it fold by
default (`RIG.HUB_OPEN`)? cords or lines on the Wavecraft canvas (`RIG.WIRES`; or both as a ⚙ line)? is 3 ms the right gate (`RIG.GATE_MS`)?
do the auto-plug rules do what the hand expects (`AUTOPLUG`)? the contact sheets: spacing, sizes, the narrow face; which second skin.

**The lead's first guesses on the skeptic's six questions (2026-10-25) — each easy to change after WC-1; the user decides by feel:**
1. **Which connections are cords on a Wavecraft canvas**: only the Wavecraft's own (its modules' edges, its Envelopes / LFOs / Macros onto its
   own knobs and its effects' knobs); Amplifier → FX, FX → OUT, canvas modulators and Pads stay lines — the Moog precedent (§4.1; flip: the
   `cordOf` predicate).
2. **Removing and reaching cords**: yes — a tap on a cord selects it with a × (parity with lines), and Wavecraft jacks stay patchable at every
   zoom where a line jack is (§4.4, §3.2; flips: the `cordHit` hook, the `data-cv-awake` exemption).
3. **Modulation into a knob**: yes — the cord ends at the knob's rim with a small tip, no plug over the knob; the amount badge is its handle
   (§4.5; flip: `s: 2` → 0 in `toCord`).
4. **Envelope names stay fixed per module** (the one plugged into LEVEL keeps its name; the engine slot is an implementation detail shown in
   the inspector) (§3.4; `dev.rig.n`).
5. **The Filter keeps its per-input switches on its face** — they are audible state (§3.1; the skeptic's P1-1 / P1-2).
6. **Tracks keep the name they were given**; a later rename of the instrument does not rename existing tracks ("Wavecraft 3" stays; §13).

## 12a. Design requirement added 2026-10-25: faces on one layout system
The user: "one gripe i had with our current serum system is that everything feels a bit crowded with some text areas not having enough
margin to feel comfortable. as well as a lot of negative space not being properly utilized so i want to minimize those things in
wavecraft. the wavecraft modules should have a very consistent look across all of them with consistent spacing of visual elements." →
§3.0 (own faces, the measured reasons), §3.8 (the RIG grid: unit, columns, rows, cells, margins, fill ratio — numbers), G11 (the automatic
layout check and the contact sheets), lane F. The Serum complete panel is out of scope (§13).

## 13. Known limits (recorded)
- **Patching is Serum's routing**: no audio-rate FM / sync / feedback by cord (the oscillators' warp / FM / RM menus do FM, drawn as read-only
  cords), no audio into an LFO, no LFO into an envelope, no cord between two Wavecrafts (one instrument per track). Full patching is stage 4.
- **Per-source AMP ENV off** (`x.env = 0`) is normalised to on when a Serum state enters a Wavecraft (listed in the notice); a HOLD switch per
  Amplifier input could expose it later.
- **Destination names inside the inspector / Mod list** keep the engine's ids ("OSC A · LEVEL") while the bars read "Oscillator 1"; a
  renaming table is a later pass (it touches 529 `DESTS` labels — also row 15's "our own names").
- **A preset's rows from velocity / note / wheel / random** show as cords only when the matching canvas module stands on the canvas; the
  Mod list names them with a hint.
- **Cord colours**: a user's pick is stored for rig cords only (`dev.rig.cc`); row cords (modulator → knob) take the rule's colour.
- **Skins are global** (one pref), not per instrument; the kit's widget text inside the faces keeps Inter where a skin says `font: 'ui'`; the
  hardware panels, drum machines, the FX panel and the 900 Series are not skinned.
- **Two looks across tracks** (the user's Q1): a Wavecraft canvas has cords, every other canvas lines (the Moog canvas mixes, as since stage
  9). A rope has no dashes: a per-note row onto the rig's FX panel is thinner with a badge tag; bypass / off = 45 % alpha.
- **A Wavecraft preset is a Serum preset** (WC-2): sound without layout; "Save with layout" later if wanted. WC-1 has Init only.
- **The drawing buffer** (13.4 MB at 1440 × 900 dpr 2) exists on a Wavecraft canvas as on a 900 Series canvas; not elsewhere.
- **A fully opened Wavecraft** is the S0 `p1x` DOM class (one slow frame short of P+ on the iPad Pro, 2026-10-20); the heavy notice tells.
- **WC-1 ships eight faces**; the Arpeggiator and Clip sequencer modules, the Oscillator's multi / granular / spectral interiors on the grid
  and the Amplifier's drawer panels are WC-2 (the interiors show the kit's own views inside the grid's frame meanwhile).
- **The Serum complete panel keeps its layout** — the user's crowding / negative-space gripe applies to it too; a pass over the bundled
  Serum (the same grid numbers, or a lighter respacing) is a possible later stage, out of scope here.
- **A face's `data-dest` ids are the kit's**; the face's words are ours, the inspector's are the engine's (above).
- **The gate scales with VOICE CONTROL's ENV scale** (`vc.escale`, on the Amplifier's drawer): 3 ms × the scale; the legend's tooltip says so
  when it is set (exempting ENV 1 would be a DSP change).
- **A dry source** (a source into a Filter whose input switch is off) is audible and drawn as a "dry"-tagged cord; a source into a filter that
  is ⏻ off passes through it — the Filter module stands ⏻ off (I1'). Both are Serum's behaviour, kept exactly (W2).
- **The screens keep the kit's colours in WC-1** (sx-ui-osc's hard-coded palette); ivory re-colours them in WC-2.
- **The `under` cord mode** (a diagnostic pref) draws cords beneath the DOM: a rig's cords would hide behind its panels — not supported for
  rigs (the layer's `gl` / `svg` modes are).
- **Tracks keep their names after a rename of the instrument** (the lead's decision 6): a track made as "Wavecraft 3" keeps that name; the
  Replace auto-rename matches the name at the time; nothing renames stored names on load.
- **The amp-slot moves re-target rows by suffix**; a row's *curve* and amount travel untouched; START / END of a moved ENV 2–4 are dropped into
  ENV 1 (listed) and come back as 0 when it leaves (serum-core's `swapModules` rule).
- **The name**: `RIG.NAME` is the display name; the model id `rig`, the keys and files never carry it. Files saved with this build name
  `rig` and open under any later display name unchanged.

## 14. Notes (the builders fill in)

## 15. Review log

### The skeptic review (2026-10-25, against c06eaca with Q1 = (b) in mind; 5 P1 · 15 P2 · 16 P3; its scripts over the 86 factory presets in
the lead's scratchpad `WC/presets*.mjs`) — every finding and where it went

**P1 (5 / 5 fixed)**
- **P1-1** `adopt`'s "a stub is silent" rule was false (a switched-off input passes dry through the filter channel, serum-dsp.js:3644 / 3648;
  19 of 86 presets) → rule (2) **deleted**, `adopt` touches only `x.env` (§2.5); the Filter keeps its S A B C N switches on its face (§3.1, the
  lead's decision 5); a "dry" tag on the cord (§4.2); G2 "only `x.env`"; the 19-preset case in G4. Fix adopted.
- **P1-2** a source into a ⏻-off filter had no cord end (30 of 86 presets, every default Serum) → **I1'**: a Filter module exists whenever a
  powered source routes into it with a share above 0, shown ⏻ off with its tip (§3.1, §2.3 `partKeys`); the 30-preset and the "Make it a
  <NAME> on a default Serum" cases in G4 / G6. Fix adopted (not re-routing: inexact, as the skeptic says).
- **P1-3** pressing a multi-cord jack undefined → outputs always start a new cord, inputs grab the most recent, long-press "Which cord?",
  fanned anchors `<jack>#<i>` 10 px apart (§4.4, §4.3); G6 cases (a second destination, a third oscillator, pulling one of a Σ input). Fix adopted.
- **P1-4** a plug drawn over every modulated knob → the **tip end** (`s: 2`: no plug, a 6 px dot at the knob's rim), the badge the handle at a
  fixed offset computed at relayout (§4.5, §4.4, §4.3; the lead's decision 3); G8 / G6 pin it. Fix adopted.
- **P1-5** G1's `'sx-*.js'` glob forbade files the lanes edit → the list is `DSP_FILES` + engine.js + drum-core.js (G1, §11.2); sx-edges.js is
  lane K's (additive `env1`, `voice.level`, link rows as readers; jackrules unchanged) (§2.3, §11.0). Fix adopted; sx-ui-osc stays untouched
  (the Filter switches are kit toggles on the rig's own face).

**P2 (15 / 15 fixed)**
- **P2-1** the (a)-shaped sections → rewritten around the cords table (§4.1: the 900 Series' split; the lead's decision 1), `cords: rec =>
  bool` instead of a global `paths: false`, `edges()` drops kind `'fx'`, §6 keeps cv-cables' internal path + `sxCan` / `sxConnect` / `sxCable`,
  the lines-mode gate in G4, `w` dropped, the 24+ fade kept as host-side alpha, G6 / G7 / §9 / §13 rescoped. Fix adopted.
- **P2-2** cv-patch wipes the layer on every `ptShow` → cv-patch's `cords` dep conditional on a patch device; the rig's `set` after `ptShow`
  (§4.1, §8.2, §11.1). Fix adopted (host-side; cv-patch.js untouched, W6).
- **P2-3** the gate ignored ENV 1's flags → `GATE.env { bpm 0, legInv 0, stealRe 0 }`, `isGate` checks it, the slot moves carry the flags, a G3
  case (§2.3, §3.3, §3.4). Fix adopted.
- **P2-4** destination rows and the kit's Swap / Paste bypassed the rules → `envToAmp` / `envFromAmp` built on `copyModule` / `swapModules`
  + the sustain re-law + destination re-targeting (`e<k>.*` rows, canvas `iN:e<k>.*`, `s.midi` / `s.locks`); the kit's ENV moves route through
  them when ENV 1 is a party; `slotsUsed` counts link rows and `env1`; G4 cases (§3.4, §2.3). Fix adopted.
- **P2-5** canvas ENV injections share the ENV 2–4 slots → `held` (the injected slots from `compileMods`' payload) excluded from `firstFree`,
  refused with the budget's text; a G4 case (§3.4). Fix adopted.
- **P2-6** Envelope names changed with the slot → fixed ordinals `dev.rig.n` (§2.1, §3.4; the lead's decision 4). Fix adopted.
- **P2-7** interfaces: sx-edges' port ids kept (`main direct note out`, `env1` an output) + the new `voice.level` input; rig jacks `kind
  'cord'` in cords mode with `dir` / `sig`, stage 3's kinds in lines mode; `rigHost(deps)` in cv-patch's form; knob ends come from
  `cables.list()` as today (the own rows stay cv-cables records) (§11.1, §4.3, §4.4). Fix adopted.
- **P2-8** the sweep undercounted and `isSerum` clashed → a classification table incl. the helpers and the missed files; `isSxModel /
  isSerumModel / isRigModel`; smpgen out of the sweep; `compileTrack` named as the sound-affecting site; G2's host-level case (§8.1, §2.2).
  Fix adopted.
- **P2-9** skins would not reach the kit → blocks scoped to `.sx-root` / `.rig-face`; the displays keep the kit's colours in WC-1, read
  `wk.theme(el)` and repaint in WC-2; G6 WC-2 screenshots the display (§5.1, §5.2, §13). Fix adopted (WC-1 / WC-2 split added).
- **P2-10** the base state and `defaults()` → `rigBlank` (the drop base, every source off), `rigStarter` (= `defaults()`, every generic path),
  `rigInit` (§2.2, §3.5, §3.7). Fix adopted.
- **P2-11** G3 unmeasurable → the voice's amplitude read directly (dsp-scope) or the ratio to an ungated render; the click metric on the
  output; the decimator's delay in the bound; the chunk count corrected (36 at 48 kHz at every OS, ≈ 33 at 44.1) (G3, §3.3). Fix adopted.
- **P2-12** new vertex attributes would break the P-1(c) byte pin → `o` packed into `sel`, the tip into `s`; `w` dropped (§4.5, G8). Fix adopted.
- **P2-13** schema details → `upgrade().notes`; the hidden-link-rows sentence; the conversion skips `sxModelLay`'s purge (`keepLay`); G5
  overlap check (§2.4, §3.5, G5). Fix adopted.
- **P2-14** Serum's words on a Wavecraft → **G13** (a words gate) and a wording table in rig-core (§10, §2.3). Fix adopted.
- **P2-15** cords harder than lines → rig jacks awake at every zoom; a tap on a cord's body selects it with a × (the lead's decision 2); the
  rig's own mod cords at alpha 0.85 over the panels; plugs on knobs and stacked plugs by P1-3 / P1-4 (§3.2, §4.4, §4.5). Fix adopted (as the
  lead decided, not asked).

**P3 (16: 14 fixed, 2 noted)**
- golden count 13 → 12 (G1). — `map: serum.map` "the same function object" → "Serum's compile; the MODELS loop wraps it" (§2.2). — the gate
  scaled by `vc.escale` → the tooltip + §13. — sustain round trip → "within 1 ulp" (G4). — `dev.rig.cc` keyed by the source end + `pruneRig`
  GC (§2.1). — the rename and stored track names → the lead's decision 6, §13 (tracks keep their names; nothing renamed on load). — the iPad
  buffer ≈ 22.7 MB (§9). — `under` mode → §13 (diagnostic; not supported for rigs; noted, not forced: the layer is one per world). — fonts: the
  lead downloads in phase 0 with the user's OK; precache makes "loaded only when a rig…" moot → §5.3 rewritten with the Inter fallback. —
  "panel undo included" removed (§3.5). — `maker` omitted and the about line trimmed (§2.2). — G1's base record leaves parts-view fixtures out
  (G1). — module height after a slot move settled like `sxSettle` (§3.4). — ∿ modes: host-side filtering of the rig's mod cords (§4.4). — the
  conversion notice drops "(same sound)" when a switch changed (§3.5). — a link row reading ENV 1 while it is the gate: Envelope 1 shows the
  gate values, said (§3.4).

**The skeptic's six user questions** → the lead's first guesses, recorded in §12 (1 own connections only · 2 body tap selects + jacks awake ·
3 tip ends · 4 fixed names · 5 the Filter keeps its switches · 6 tracks keep their names); the user decides by feel after WC-1.
**Rejected**: nothing outright; two P3s noted rather than changed (`under` mode; renaming stored track names).
