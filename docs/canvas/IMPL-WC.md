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
  envelope ("Envelope <n> already shapes the level — pull it first", n the amp slot's module's fixed name — pre-deploy [amp-held], §14).
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
**Superseded by review 2 P2-5 (the user's rule, 2026-10-26: "shouldnt envelope come after the oscillator in the chain?" → "carry on"; fixer
B1, §14)**: a rig's Tidy (cv-module `rigLay`) lays **the chain on one row** left → right, each module its own column — Arpeggiator / Clip →
Oscillators, Sub, Noise → Filters → **Amplifier** → its FX → OUT — tops at 0, GAP apart; **every modulator in one band above it**,
bottom-aligned VGAP + one grid row (the sag air) over the chain's tops, **centred over what it drives** (`rig-core.targetsOf`: Envelope 1
the Amplifier, a row the module holding its knob; several → its left-most), cluster-merged `BAND_GAP` 64 apart (never stacked); a
modulator with no target at the band's left end; **a narrow (portrait) canvas** wraps FX → OUT under the Amplifier; canvas modulators keep
their left column. An add never moves a module that stands (`rigSpot`: the band's rule for a modulator, the row's slot or under its left
neighbour for a chain module); the first drop's group (`sxLayParts`) follows the same rule. Every other canvas's Tidy is unchanged.
(Was: modulators stacked in the Amplifier's column, sources and filters stacked in columns — their cords crossed the faces between their ends.)

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
the tag badge, as today (cv-cables' `hid` idiom). **(Fixer B2, the user 2026-10-26, §12 item 3: the knob end is on the knob disc's rim where
the rope arrives radially, several ≥ 40° apart; the fan is 32 px; the claimed badges' places come from the host — §14.)** **(Integration
fixer K, the go / no-go review: a fan stays in its jack row, packed between the row's other jacks and the face's edges, its cords on the
plugs that cross the fewest faces and each other; a press on a plug is that plug's cord (§4.4 amended); the rope "at rest" the knob end and
the badge are aimed on is the layer's own settled shape, and the anchor carries the knob's disc so the layer cuts the rope at the rim —
§14.)** **(The user, 2026-10-26, §12: the fan is retired — several cords at one jack STACK on its socket, every end the jack itself, the
newest on top; §14 "stacked plugs".)**

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
dimming, the refusal reasons and the History labels: unchanged. **(Integration fixer K, review B5 / P2-3 / P3-7: a press on a fanned plug
grabs **that plug's** cord — the most recent is the default only at the jack itself; a press resolves to the nearest jack centre or plug of
its module within max(22 screen px, half the 64 px column), so at Fit zoom a rig jack is as easy to hit as a line jack — a press on no jack
too (cv-world `setJackNear`: the empty canvas past a face's edge, a sleeping face, an awake face where no control is), while a jack's own hit
stays the grid's 44 px circle (a face clips it; it never reaches the row above); the long-press "Which cord?" opens the tap's plug menu —
each cord's Pull · Re-patch to ▸ · Colour ▸. §14.)** **(The user, 2026-10-26: stacked plugs — a press on a stacked input grabs the
stack's top, the newest (the host's jackAt names it), "Which cord?" lists it first; an output's press a new cord, as ever; no fanned plug to
pick. §14.)**

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
  Sub Violet 6, Noise Cream 4 (review 2 P3-6: Black 7 read 1.4 : 1 on charcoal; every rule colour ≥ 3 : 1 now), Filter 1 Orange 5, Filter 2 Red 0, note cords (Arpeggiator / Clip → NOTE) Violet 6, the amp-slot cord and
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
view only; **in WC-1 the Note tools section shows its heading and "The <NAME>’s Arpeggiator and Clip sequencer arrive in a later update."**
(integration fixer L, review WC-int P3-8: our words through `RIG.NAME`; "Arrive with the next cut." was the plan's jargon) (the existing `cv-tsoon` placeholder idiom
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
- **Memory**: the drawing buffer (18.7 MB at 1440 × 900 dpr 2 on the Mac — 2880 × 1702, measured (review 2, fixer B2); 13.4 was an estimate; **≈ 22.7 MB on the iPad Pro** at 1376 × 1032 pt dpr 2 — the
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
**The portrait Fit floor** (review WC-int P3-4, §13): a full rig in portrait stops at the 25 % zoom floor, clipped at both sides — keep the
one-row chain (the user's rule) and pinch / pan, or wrap the chain itself in portrait (two chain rows: the sources and filters over the
Amplifier's row — the cords between them then run down across faces), or a lower floor for a rig? **A new <NAME>'s first view** (review
WC-int B3, after its checks): framed whole when it fits at READ_K (50 %), else at READ_K with what matters whole (the chain's start or the
module just added, the Amplifier, Envelope 1) and the rest from the rig's left — the knobs answer on the first view (below READ_K a press on
a module pans); the whole starter would want 49 % / 46 % / 33 % (desktop / iPad landscape / upright, the tray open): is the cut-off right
edge (the Effects panel 90 % / 61 % in view) the right trade, or the whole rig smaller?

**The lead's first guesses on the skeptic's six questions (2026-10-25) — each easy to change after WC-1; the user decides by feel:**
1. **Which connections are cords on a Wavecraft canvas**: only the Wavecraft's own (its modules' edges, its Envelopes / LFOs / Macros onto its
   own knobs and its effects' knobs); Amplifier → FX, FX → OUT, canvas modulators and Pads stay lines — the Moog precedent (§4.1; flip: the
   `cordOf` predicate).
2. **Removing and reaching cords**: yes — a tap on a cord selects it with a × (parity with lines), and Wavecraft jacks stay patchable at every
   zoom where a line jack is (§4.4, §3.2; flips: the `cordHit` hook, the `data-cv-awake` exemption).
3. **Modulation into a knob**: yes — the cord ends at the knob's rim with a small tip, no plug over the knob; the amount badge is its handle
   (§4.5; flip: `s: 2` → 0 in `toCord`). **→ The user, 2026-10-25 (after the faces, "looking great"), flipped it**: "any time a cable is
   plugged into a place that doesnt have a socket eg from an LFO to a frequency cutoff knob. lets imagine it goes into the back of the
   module" — a modulation cord onto a knob (any socket-less destination: the rig's own knobs, its FX panel's, a Macro onto a knob) now
   **goes into the back of the target module**: its end is where the line from the source jack meets the module's outline (cords into one
   edge ≥ 12 px apart), the rope dives behind the panel there (nothing of it over the target's face) through a small dark grommet straddling
   the edge (cv-cords `s: 2` = the BACK end, `box` the module's rect), the knob wears a thin ring in the cord's colour, the amount badge sits
   at the entry point outside the panel (tap = amount / menu, drag = re-target or pull). Jack-to-jack cords unchanged. Lane H, §14.
   **→ The user, 2026-10-26 (after review 2), replacing the edge entry**: "the cable going from lfo to filter should be going directly to
   the back of the knob that it is attached to" — a socket-less modulation cord now runs **to the knob it modulates** and ends at that
   knob's **rim**, the point facing the cord, where the settled rope arrives radially (it may cross its own target module's face on the
   way — accepted). The end reads as **going in behind the knob**: a butt end (no plug, tip or grommet), the knob's shade darkening the
   rope's last 7 px, the knob's ring (in the cord's colour) laid across the rope's end, the rope's shadow faded out before the knob (cv-cords
   `s: 2` = the KNOB end). Several cords onto one knob: their rim points ≥ 40° apart round it and a **segmented ring**, each segment facing
   its cord. The **amount badge** lives in a layer **above the cords** (cv-cords `top()`; the × and a fork's BAL too — never under a rope),
   placed **on its cord just outside the rim**, walked back along the cord to the first place whose 44 px hit covers **no control** (knobs,
   the Filter's display, buttons, menus, jacks, module bars) and no other badge — so on a dense face it usually sits where the cord leaves
   the face. Fixer B2, §14.
4. **Envelope names stay fixed per module** (the one plugged into LEVEL keeps its name; the engine slot is an implementation detail shown in
   the inspector) (§3.4; `dev.rig.n`).
5. **The Filter keeps its per-input switches on its face** — they are audible state (§3.1; the skeptic's P1-1 / P1-2).
6. **Tracks keep the name they were given**; a later rename of the instrument does not rename existing tracks ("Wavecraft 3" stays; §13).

**The user, 2026-10-26, on the live Wavecraft (canvas 050ea9f) — three decisions** (§14 "stacked plugs, cables over labels, cables behind"):
- **Stacked plugs** — "in cases like this all cables should overlap at the outlet" (an LFO's OUT with two cords fanned side by side) and
  "overlap everywhere": every jack holding several cords, outputs and Σ inputs alike, shows its plugs **stacked on its one socket** (its
  centre, the newest on top, the cables diverging from there) like real stackable patch cables. Integration fixer K's fan along the jack row
  (B5's per-plug press, P3-6's row packing, B1's plug order) is retired. The press rules stay: an output's press starts a new cord; an
  input's grabs the most recent — now the stack's top (the cord plugged last in this session; after a reload, edges() order); long-press /
  right-click → "Which cord?" (the top first); a tap on a cord's body → ×; a badge drag re-targets its row.
- **Cables over the jack labels** — "cable should be on top of text here" (the IN Σ label drawn over its rope): the physical look, the
  cable passes **over** its jack's label; review WC-int P3-12's lifted label chip is retired. A label no cord crosses reads as before.
- **A cables-behind button** — "we need a button that makes cables go behind": a toggle in the canvas toolbar after ∿ ("Cables behind
  modules", the row's style and 44 px touch target, shown on a cord canvas only: a Wavecraft in cords mode, a 900 Series) draws the rope
  bodies **behind the modules** so the knobs and text are clear; the plugs on their jacks, the knob rings, the badges and the × stay on top
  and usable; pressed again, the cables return on top. Remembered (synth.cv.behind, the app's prefs store); default off = today's look.

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
- **The drawing buffer** (18.7 MB at 1440 × 900 dpr 2: 2880 × 1702, measured by review 2 and fixer B2 — the 13.4 first written was an
  estimate) exists on a Wavecraft canvas as on a 900 Series canvas; not elsewhere.
- **A modulation cord runs to its knob** (the user, 2026-10-26; §12 item 3): its rope crosses its own target module's face — and, with
  today's Tidy, the faces between (B1's Tidy places modulators above their targets) — hiding the labels and values it lies on (presses
  pass through: the layer takes none). The rope cannot truly pass *behind* the knob (the cord layer is above every module): the butt end,
  the knob's shade and its ring across the rope's end give the look. On a face whose controls touch (the knob grid's 64 px cells) the
  amount badge finds no free 44 px place inside the face and sits where its cord leaves the face — far from the knob at times; it is on
  its cord either way (integration fixer K: on the rope as the layer draws it at rest, touching it when beside it). A modulator straight
  above its knob: the rope's slack fold would hang into the knob — the layer cuts the rope where it first meets the rim (nothing of it on
  the knob's face; the end there, its ring across it).
- **Fanned plugs** at a Σ input sit a plug's width apart along the jack's own row (32 px; down to 16 px — overlapping like coins — where the
  row has no room: the Amplifier's IN Σ beside DIRECT Σ holds three at 32, a fourth squeezes them), never a second row over the face
  (integration fixer K). A cord's rope still hangs over its jack's label line: where one crosses it, the label is lifted above the cords —
  a small plate in the face's colours under the jack, its words always readable (fixer K, P3-12).
- **The drop outline's label at Fit zoom** (integration fixer K, P3-9 round 1): whole lines, the last ending in … — a 60 px-wide tile at 25 %
  holds about five letters a line, so a long name still ends in "AFT…"; the clamp's … on a word wider than the outline was checked in
  Chrome (WebKit's `-webkit-line-clamp` is its own; not run here).
- **The cords-mode chip in a narrow canvas** (integration fixer K, P3-9 round 2): an overlay under ~816 px (the iPad mini in portrait
  744, Split View / Stage Manager 694) has no room for a two-line refusal (360 px) 44 px clear on either side of a finger mid-top — the
  flipped chip then sits as far left as it goes (x 4), 27 px under the finger: clear of a resting right hand, but at 694 px its right end
  passes under the finger's column (4 … 364 with the finger at 347). A left hand is not told apart.
- **A Wavecraft jack reaches 22 screen px** (32 world px from 69 % up; integration fixer K, P2-3): a press that lands on no control within
  that reach of a rig jack is the jack's — on the empty canvas past a face's edge, anywhere on a sleeping face (below 50 %: its controls
  sleep), on an awake face's bare cells and labels. So at Fit zoom a pan or a tap that begins beside a jack row starts a cord (a tap: the
  jack's menu) instead of panning / selecting the module; begin a pan 22 px away from the jacks. A module's bar, another module's body and
  every awake control keep their presses; the mouse cursor shows the crosshair over the jack's own 44 px circle only.
- **Lines mode (`?wires=lines`, not reachable from WC-1's UI; the ⚙ "Connections: Cords | Lines" is WC-2)** keeps two gaps the go / no-go
  review found (P3-1, P3-2), recorded rather than fixed in WC-1 (each is a change to cv-cables' line drags or badges on every canvas, not a
  contained one): an Envelope's OUT cannot be **dragged** onto the Amplifier's LEVEL (the line drag from a mod output only targets knobs;
  LEVEL is reached from the Envelope OUT's or LEVEL's tap menu, as today), and a rig row's amount badge sits by cv-cables' rim rule
  (24 screen px past the knob's rim), so its 44 px hit can overlap the knob it modulates — the host's badge placement (cords mode) is the fix
  when the switch ships.
- **A fully opened Wavecraft** is the S0 `p1x` DOM class (one slow frame short of P+ on the iPad Pro, 2026-10-20); the heavy notice tells.
- **The portrait Fit floor** (review WC-int P3-4; the user's call, §12's list — not changed): the chain is one row (the user's rule), so a
  rig's width grows with every chain module; in portrait (1024 × 1366, tray closed, headless Chrome, integration fixer L) the starter fits at
  42 % (2232 world px wide: the wrap's FX row under the Amplifier, its line routed round it — P3-11), a full rig (§9's eight chain
  modules, modulators with no target at the band's left end) stops at the 25 % floor, 7288 px wide, centred and clipped at both sides;
  landscape (1366 × 1024) 47 % / 25 % (7416 px). With the Sources tray open the band is 240 px narrower. Tidy and the toolbar's Fit frame
  it centred at the floor; pinch and pan reach the rest.
- **Envelope 1 beside the Amplifier** (review WC-int P3-3): Tidy and a tapped Envelope stand the amp slot's Envelope with its OUT 48 px right
  of the Amplifier, so its cord hangs beside it and comes into LEVEL from the side (crossing the Amplifier → Effects line once); when the
  band has no room there (a cluster of modulators over the Amplifier) it keeps the cluster's place and its cord may cross the Amplifier's face.
  Upright (the wrap), a modulator driving the Effects panel under the Amplifier (a knob on Effects) stands right of the Amplifier's slot —
  past Envelope 1 and the Amplifier → Effects line's run — so Envelope 1 keeps its place (review WC-int P3-11, after its second check): two
  such modulators (an LFO and Macros) stay inside OUT's right edge (the starter's 2232 world px, Fit 42 % unchanged), a third widens the
  rig by 360 px; its cord comes down to its knob across that line's gap run. One that drives the Amplifier (or a chain module) too stands
  over that module, as in landscape (with Envelope 1 over the Amplifier: their cluster, no room — the case above).
- **The upright wrap's Amplifier → Effects line is routed** (review WC-int P3-11, after its check): with the FX row under the Amplifier the
  line goes out of OUT rightward, down 96 px beside the Amplifier (beyond Envelope 1's cord: they cross once, by OUT), along the gap between
  the rows and into the Effects IN from the left — straight runs with rounded corners, the only routed line on the canvas (every other line
  keeps its one cubic). A module the user stands in its runs or the gap gives the plain line back (it may then cross the Amplifier).
- **A new <NAME>'s first view never goes below READ_K** (review WC-int B3, after its checks): a rig wider or taller than the band at 50 %
  shows what matters FIRST, in priority order — the module just added (a module tile's Replace), else the chain's start; the Amplifier;
  Envelope 1 — on each side it does not fit, the longest head of that list that fits there whole, centred, slid back only so far that no
  blank canvas opens past the rig's edge (the first one's top-left when even it does not fit) — when both sides are short, the head both
  hold (an iPad split view, 678 × 1024: the chain's start alone, centred); the rest as far as the band reaches. With
  the keyboard row up (the default, 170 px) the chain row is whole and Envelope 1 shows its lower part above it (its curves and OUT; 32 % of
  it at 1440 × 900, 77 % in iPad landscape, whole upright); with the Sources tray open the Effects panel is 90 % in view in iPad landscape,
  61 % upright; a grown rig's modulators at the band's left end slide out first. A band shorter than the chain row at 50 % (a desktop at
  200 %, 480 × 120 past the tray, the keyboard row, the toolbar and the minimap) shows the chain's start's top-left — its bar and screen, its
  first knobs awake — where the old overview showed the whole rig asleep at 25 %. Tidy and the toolbar's Fit stay overviews (below READ_K when the canvas needs it: pinch in
  to turn knobs).
- **WC-1 ships eight faces**; the Arpeggiator and Clip sequencer modules, the Oscillator's multi / granular / spectral interiors on the grid
  and the Amplifier's drawer panels are WC-2 (the interiors show the kit's own views inside the grid's frame meanwhile).
- **The Serum complete panel keeps its layout** — the user's crowding / negative-space gripe applies to it too; a pass over the bundled
  Serum (the same grid numbers, or a lighter respacing) is a possible later stage, out of scope here.
- **A face's `data-dest` ids are the kit's**; the face's words are ours, the inspector's are the engine's (above).
- **The gate scales with VOICE CONTROL's ENV scale** (`vc.escale`, on the Amplifier's drawer): 3 ms × the scale; the legend's tooltip says so
  when it is set (exempting ENV 1 would be a DSP change).
- **A dry source** (a source into a Filter whose input switch is off) is audible and drawn as a "dry"-tagged cord; a source into a filter that
  is ⏻ off passes through it — the Filter module stands ⏻ off (I1'); so does a Filter the other Filter routes into while that one is powered
  or itself fed (review 1 P2-1: nothing audible without its cord). Both are Serum's behaviour, kept exactly (W2).
- **MPE is the Serum's in WC-1** (the lead, review 1 P2-3): midi.js stays byte-identical (the iPad app's B2 pin, midi.test's leaf pin) and
  answers an MPE zone by `d.model === 'serum'` (`isMpe`, `noteCh`), so a Wavecraft is never one — member-channel notes do not reach it,
  its notes carry channel 0. The Amplifier's drawer shows **MPE… disabled** with `WORDS.mpeLater` ("MPE on a <NAME> arrives in a later
  update"); the "MPE on by default" preference applies to a new Serum only (`applyPrefs(s, prefs, true)` for the rig's starter and Init).
  A converted Serum keeps its `global.mpe` in the state (W2: the same state; moot without the routing). Lifting it = midi.js's two sites
  on `isSxModel` with B2's hash moved — a stage decision.
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

### Notes — phase 0, the model commit (2026-10-25; `rig-core.js`, `models.js`, `song.js`, `cv-model.js`, `cv-migrate.js`, `cv-cost.js`, `cv-art.js`, `cv-tray.js`, `tests/ref-WC/`, `tests/rig-model.test.mjs`)
- **The base record** (G1 / G12): `tests/ref-WC/record.mjs` + `base.json`, recorded from c950b49's pristine sources in a commit of its own
  BEFORE any source change. G1: 114 fixtures (the 86 factory presets as canonical Serum tracks, the 12 classics at their defaults, the four
  drum machines, the Model 15, the 1e / 2a / 2b fixture tracks) × six sha256s of the stable JSON of `compileTrack` / `compileGraph` /
  `compileMods` / `cablesOf` / the host's messages (graph-1e `messages()`: `instPatch` / `chainPatch`) / `destOk` over every control id.
  G12: five cv-cables sessions on wk-dom (a Juno with modulators, a Serum complete with mod cables, a Serum under 26 rows, an 808 + Pads
  note lines, a 900 Series), the world element's full markup after each of 17 scripted steps. `node --max-old-space-size=2048
  tests/ref-WC/record.mjs` compares a changed tree (exit 1 on a difference) — lane S after the sweep, lane C / H after theirs, reviewer 1.
  [C] No master session: the master canvas mounts no cv-cables (its rack feeds OUT inside master-ui) and cv-graph has no master compile.
- [C] **Return shapes**: `rigBlank()` and `rigInit()` return a state `s` (§2.2's words, §3.5's `vals: { s: rigBlank() }`); `rigStarter(prefs)`
  returns `{ s }` (what `defaults()` returns). G3's `isGate(rigBlank().s)` is a slip → `isGate(rigBlank())`.
- [C] **`GATE.p['e1.att']` = (0.003 / 32)^⅕ = 0.1564567…**, derived from `RIG.GATE_MS` (the law `32·n⁵`, laws.js); the contract's digits
  "0.156482…" were a rounding slip (32 · 0.156482⁵ = 3.0025 ms). The law is the pin: `lawValue('e1.att', n) = 0.003` within 1e-15.
- [C] **`RIG.STARTER` as data**: `{ on: [parts], cords: [[a, b] …] }` — `rigStarter` powers the parts (sx-edges `POWER`) and plugs the cords through
  sx-edges' `setEdge` (the audio ones); `'voice.level'` writes ENV 1 at Serum's `DESTS` defaults (an Envelope on LEVEL, not the gate) until lane
  K's `plug` knows the end. `null` = the blank (an Amplifier alone).
- [C] **`adopt`'s notes name the module** ("Oscillator 2’s AMP ENV switch was off — it is on"), not the engine part ("OSC B's" in §2.5): the bars
  read our names (G13's spirit). `adopt` deep-copies and touches only the seven `env` switches (a non-object → a default state).
- [C] **`dev.rig.n` is keyed by the part name** (`'env2'`), not the lay key (`'iN/env2'`): the record lives inside the device, the prefix is
  redundant (§2.1's "a LAY_KEY part"). `normRig` → `{ v: 1, cc, n }` always (empty objects kept; idempotent).
- [C] **`pruneRig(rig, s, lay, dev)`** takes the device key as a fourth argument (the track's lay is keyed `'dev/part'`); `song.normDev` calls it
  (the load hook) with the bounded record, the raw state, the normalised lay and the key; it is the identity until lane K. The save-side hook
  (before a save) is lane H's (main.js).
- [C] **`applyPrefs(s, prefs)`** lives in rig-core and `serum.defaults` now uses it (one truth for the GLOBAL preferences; behaviour-identical —
  rig-model.test pins `serum.defaults()` ≡ `{ s: defaultSerum() }` and the four preference effects).
- [C] **No `maker`** on the model (§2.2). cv-art.test's maker scan skips maker-less models; the tray would print "2026 · undefined" on the rig tile
  until lane U — meanwhile the tile is hidden in every view: **cv-tray.js's Serum section filter is `isSerumModel` now** (one line, lane U's
  file, the start of §7's end state) so the Serum view's pins hold with a 19th custom model.
- [C] **`STEPS` take a second argument**: `(p, notes) => p'`; `upgrade()` threads one array through every step and returns it as `notes` (every
  other step ignores it). The parts-view notice is one line per device ("its Serum “<name>”" when the device has a name) plus the link-rows
  line (rows whose `src` starts with `iN/`), as separate `notes` entries (the loader shows each with the 1f idiom — lane H).
- [C] **toV1** converts rig devices to `'serum'` on the plain copy BEFORE its per-track pass (so its own `'serum'` tests see a Serum: own FX kept,
  `single()`'s shape), drops `rig` and the `iN/<part>` lay entries, keeps `iN/fx` (a Serum's too); one lost line per rig device.
- **Left for lane S (in its sweep list already)**: cv-migrate's `single` / `instV1` / `instRoutes` / `splitTracks` `'serum'` sites — a rig track
  loaded through `splitTracks` today would be split (not canonical: its own FX into a panel); lane S lands before any rig track can be made in
  the UI. cv-graph.test's `v1Tracks()` pushes the 86 preset tracks once per custom model (twice now): harmless; lane S may pin `isSerumModel`.
- **Pins moved** (§11.3): cv-migrate.test's every 15 / 16 pin → 16 / 17 and `PARTS` 23 → 24 (`partOf('i1/env1')` a part); the schema pins of
  canvas-7c-sim (643, 655), canvas-8-sim, canvas-9-sim, canvas-9b-sim (438), canvas-M-sim; cv-art.test's maker scan; cv-tray.test's set-tile window
  (1342: the four tiles from the Model 15's index, no longer the list's tail). Every other test green unchanged (the sweep below).
- **The name rule is a plain grep** (tests/rig-model.test: `includes(RIG.NAME)` over root `*.js` / `panels/*.js` / `style.css` / `index.html`,
  comments included): builders write "the rig" or `RIG.NAME` in comments too. Phase 0's tests are `tests/rig-model.test.mjs` (lane K's file
  is `tests/rig-core.test.mjs`); the schema-16 block is appended to `tests/cv-migrate.test.mjs`.

### Notes — lane S (2026-10-25; the predicate sweep §8.1 and the Show-parts removal §6: `models.js`, `assets.js`, `cv-cables/cost/graph/migrate/model/mods/module/tray.js`, `main.js`, the moved pins)
- **Names.** `models.js` gains `isSxId(id)` — `isSxModel` for a model *id* (a Set built from `MODELS`; a device record holds `model: 'serum'`, not the
  model); the cv-* modules import it. `main.js` (line 167): **`isSxRec(d)`** (a device or a view runs on the Serum engine), `isSxDev(t, dev)`,
  `sxIds(t)`, `isRigDev(t, dev)`; `isSerum` / `isSerumDev` / `serumIds` are **gone — no site means "the bundled Serum" of a device** (the panel code
  tests the model: `isSerumModel(m)`; lane H may add `isSerumDev` when "Make it a <NAME>" needs it). **Not `isSx(`**: tests/lint's accessor ratchet
  counts `\bisSx\(` as a v1 track-field read (`ACC_RE`), so the device predicate is `isSxRec`; the ratchet's counts did not move, only
  six `has` fragments of `accessor-allow.json` (the lines now spell `isSxId(t.model)` / `isSxId(x.model)`). `main.js` imports `RIG` (rig-core) for `isRigDev` and
  the S0 text.
- **The sweep, by file and verdict** (source lines with ≥ 1 site; the engine verdict = `isSxModel` / `isSxId` / `isSxRec` / `isSxDev` / `sxIds`):
  models.js 1 engine (`patchFor`) · assets.js 1 engine (`farmPatch`, missed by the map) · cv-cables 2 engine (`deriveCables`, `isSx` ⇒ its 7 callers:
  `jackPort`, `portJack`, the derived own-FX cable, `internal()`, the own rows, `sxColor`, the preset rows) · cv-cost 5 engine, 1 unchanged ·
  cv-graph 10 engine, 5 unchanged · cv-migrate 8 engine (`trackToV2`, `instV1` ×2, `instRoutes`' lost lines ×2, `single`, `splitTracks`, `rectOf`'s
  `.custom`), 2 unchanged · cv-model 7 engine (8 sites), 1 unchanged · cv-modlayer 5 unchanged · cv-mods 5 engine (`descs`, link source, `linkSources`,
  `destOk`, `noClassic`) · cv-module 4 engine, 4 bundled-panel unchanged · cv-art 1 unchanged · cv-tray 1 Show-parts removal (3 unchanged ids) ·
  midi.js 2 unchanged **by a pin** (below) · smpgen 6 recipe data, unchanged · **main.js** (occurrences, new file): 98 engine — `isSxModel(` 22 (were
  `.custom`), `isSxRec(` 31 (the 14 `isSerum(` and the `'serum'` literals of device records), `isSxDev(` 30, `sxIds(` 12 (the 12 `serumIds(`), `isSxId(` 3 —;
  3 bundled (`isSerumModel`: `loadVals`, `newFx`, `renderCustom`); 7 rig (`isRigDev`: `sxParts` and the part adds / removes / tile drops / decor /
  internal-cable actions; 3 `isSerumDev && sxParts` pairs folded into `sxParts`); 6 unchanged tags (below); the sites inside the removed
  Show-parts code (`sxSetView`, `sxModelLay`'s D-R5 line, `addTrack`'s, `sxReplaceWithSerum`, `sxPartDrop`'s offer) went with it.
  compileTrack's literal (cv-graph:282) is `isSxId`: a rig track compiles `shape: 'serum'` with its own FX, canonical-stream unchanged.
- **Judged outside the table** (the reason with each):
  1. `loadVals` / `newFx`: the table lists them engine; the outer `isSxModel` branch is, but **the user's default preset (Save as Default Preset,
     `synth.sx.default`) is the Serum's** — a rig starts from its own `defaults()` (`rigStarter`) and a plain `defaultFx2()` rack (a full Serum patch
     under a rig drop would defeat "start with the raw oscillator").
  2. `cvMenu`'s Serum branch: the table says bundled; it stays on `isSxModel` until lane H's Amplifier menu (§8.2), else a rig's ⋯ would fall to
     the classic layout items. The three Show-parts items are gone from it; Modulation list…, VOICE's own items (in a rig's parts view) stay.
  3. cv-module `isParts` and cv-cables' internal path (`partsView`) are **engine-wide** (the lay flag / the entry's `ui` decide, their tests drive
     Serum records); the rig-only gate is `main.js sxParts` = flag **and** `isRigDev` — so a Serum with a stale `ui: 'parts'` mounts whole, and
     none can arise (STEPS[15] drops the flag, `sxModelLay` purges it on a model change). `sxPruneAuto` stays engine (a Serum's kept `iN/*`
     auto places are pruned on a load as before).
  4. cv-model:334's notice keeps `was === 'serum' ? 'the Serum' : 'the instrument'` (naming, bundled): a rig reads "the instrument", no Serum word
     (G13 spirit). cv-module `defaultW` (W_SERUM), `hOf`'s `H_GUESS.serum`, `sizeFor`, `costOf`'s 3700 are the bundled panel's DOM sizes, unchanged.
  5. **midi.js stays as it is** — tests/app-midi.test B2 pins it **byte-identical to d461f7d's** (the iPad app shares it; CLAUDE.md "midi.js stays
     byte-identical"), and tests/midi.test pins "imports only serum-core", so neither an `isSxId` import nor a local list could land. The contract's
     "MIDI-learn paths (midi.js's two sites)" are therefore **not swept**: MIDI learn reaches a rig through the host (`main.js instsOf`, swept), but
     `isMpe(t)` / `noteCh` (MPE zone routing, `sxInsts`: `d.model === 'serum'`) ignore a rig device — a rig holding a state with `global.mpe.on`
     would route as non-MPE (W2 differs there only). **For the lead**: either move B2's hash with a stage decision (and add `'rig'` to the two
     sites, a list pinned to models.js in midi.test) or leave MPE to the Serum.
  6. The map's counts missed `assets.js:355` and `cv-migrate.js:504` (`.custom`): swept as engine.
  7. `cvDevices` / `sxLayParts` list the parts and the own-FX entry with `model: <the device's model>` (was the literal `'serum'`): the same for a
     Serum, the rig's id for a rig; cv-module `devicesOf` likewise for its fx entries.
  8. `SXM` (the Serum model object) stays the presets list and the bounce compile (`patchFor(SXM, …)`): a rig's `map` is Serum's (W2), the same bytes.
- **Show parts removed** (base line numbers, `829fcf9`): the ⋯ items 'Show parts' / 'Bundle' / 'Add ▸' (6365–6369) and the part ⋯ 'Bundle' (6386–6389);
  `sxSetView` (7111–7124); `SX_VIEW` / `SX_VIEW_DEFAULT` / `sxNewView` (7036–7040) and their readers — `addTrack` (4235), `sxModelLay` (7186; its
  signature is `(tr, dev)` now), `sxReplaceWithSerum` (7656–7667, with the 'Serum parts belong to a Serum · Replace with Serum' offer in
  `sxPartDrop` 7650–7654: a part tile now adds to a rig and does nothing elsewhere until lane H's first drop); the ⚙ "New Serums open as" select and
  `shell.sxView` (5843–5851); `sxAddItems` / `sxShaped` / `sxD0` (7417–7435: the Add ▸ builder, dead with its item); the hooks `cv.parts.show` / `newView` /
  `VIEW_DEFAULT` / `VIEW_PREF` / `replace`; `SX_HEAVY_TXT` is "This many ${RIG.NAME} modules may stutter when zooming on this device."; the Serum
  view's `parts` / `notes` sections (cv-tray `SRC_VIEWS`: now `[serum, mods]`; the boxes and `PART_TILES` stay for lane U's rig view); the
  `renderCustom` parts branch is `!isSerumModel(m) && sxParts(…)` (a Serum is whole, always). **Kept**: `sxLayParts` / `sxLayBundle` (no caller now —
  lane H's drop / convert paths and the schema-16 open place with them), `sxCan` / `sxConnect` / `sxCable` / `sxCableAct`, `sxAddPart` / `sxRemovePart`
  (guarded `isRigDev`), sx-host / sx-ui-mod / sx-edges, `LAY_UI`, `normLay`, cv-cables' internal path. The hook object is still `cv.parts` (lane H
  renames it `cv.rig`, §8.2).
- **Remaining `'serum'` literals** (`git grep -n "'serum'" -- '*.js' ':!tests' ':!engine.js'`), each with its reason: cv-art:679 the tile's "Serum
  (complete)" label (naming of the bundled panel) · cv-cost:299 the bench measurement's `patchFor('serum', …)` (a recipe) · cv-graph:29 (doc), :267 / :282 /
  :284 the payload's `shape: 'serum'` (the engine's canonical shape; canonical-stream) · cv-graph:542 / :649 / :653 / :715 the internal `kind: 'serum'`
  tag of a compiled row class · cv-migrate:195 STEPS[15]'s `partsWhole` (only a *Serum* shown as parts opens whole — a rig keeps its parts) · :299
  toV1's rig → Serum target · cv-model:335 the "the Serum" notice (item 4) · cv-modlayer:207–219 / :305 the budget `kind: 'serum' | 'classic' | 'panel'`
  tag the host passes (main.js:8801 sets it by `isSxDev`) · cv-module:28 (doc), :242 / :305 / :411 / :1128 the bundled panel's sizes and cost (item 4) ·
  cv-tray:474–475 / :944 the tray view and section id `'serum'` · main.js:598 / :606 `engine: 'serum'` (the payload kind), :676 the patch key
  `serum` in `sameVal`, :2951 `SXM`, :5668 / :5690 the tray view id, :8801 the budget tag · models.js:705 / :708 / :898 the Serum's id and the `knob: 'serum'`
  theme · :911 `isSerumModel` itself, :915 the doc · serum-core:2123 / :2430 `engine: 'serum'` · smpgen.js (6) render-farm recipe data · midi.js:55–56
  (item 5). engine.js is the engine's kind, untouched.
- **Pins moved by design** (§11.3; failing-test-first in their own commit): cv-tray.test (the Serum view lists the Serum tile and the modulators —
  `secs()` empty in these views; the part-tile machinery test runs on a view list that has the two sections, as the rig view will), canvas-1e-sim /
  canvas-2a-sim (the Serum's ⋯ without 'Show parts'), main.test (the lane-D cable test holds a *rig* in parts view: its first assertion is W2 at
  `buildPatch`), smpgen.test (the `buildPatch` eval gets `isSxModel`; the rig joins its loop: `buildPatch` = `patchFor` + live fields for a rig too),
  cv-graph.test (`v1Tracks()` pins `isSerumModel`: the 86 once), accessor-allow.json (five fragments). **canvas-3-sim** (27 → 25 tests): it runs on a
  rig in parts view made by the sim's `rigParts()` (model `rig` + the lay flag + a re-render — lane H's conversion is not in yet; no History step); retired:
  Show parts / Bundle (replaced by a state-identity case: the flag on a Serum is ignored; a rig keeps the host, the panel undo and N2), the
  Serum-tray offer and Replace with Serum (F5), D-R5's pref (replaced: no ⚙ line, Tidy keeps a rig's flag, a track switch rebuilds the host in
  parts), F1's Bundle cycles; re-pointed with the same assertions: I1 / I2, add / remove, the resolver (its "Show parts" label is the step before),
  own sources, the hidden tag, slot hosts, modX, meters, F2–F4, review 2's, S0 (with `RIG.NAME`'s text; the touch / desktop / gesture / once /
  Add-part cases, rendered again instead of Show/Bundle toggles). canvas-del-sim's part-removal case likewise (`rigParts`). Lane H's
  canvas-WC-sim rewrites the retired cases on the real conversion and first drop.
- **Gates.** G1: `tests/ref-WC/record.mjs` — "the record matches base.json (114 fixtures, 5 sessions)"; golden-classic / -fx / -presets / -random /
  -graph / -drums / -606 / -909 / -sdsv / -moog / -moog-b / -moog-c and canonical-stream green; every other test file green, one at a time, after
  `node tools/precache.mjs --write` (sw.js BUILD); `git diff --stat 829fcf9..HEAD -- engine.js drum-core.js` and the `DSP_FILES` is empty.
  **For the lanes**: the G13 words still on rig surfaces from files this lane touched (left alone: "predicates right, nothing else"): cv-graph:224
  ("A Serum’s own FX…"), cv-mods:531 (`name = d.name || 'Serum'` in the link-source labels), cv-cost:260 (the heavy confirm text), main.js
  `sxFullWhy` ("This Serum already has…"), `SX_OWN_MACRO`, 'Serum FX (own)' (cvTitle), 'No such Serum', 'Rendering needs a Serum track'.
  `tests/ui-bench-m3.mjs` (a CDP harness, not in the sweep) calls the removed `cv.parts.show` and says so when it is missing: lane C's
  `ui-bench-wc.mjs` replaces its S0 scene.

### Notes — lane U (2026-10-25; the skin, the tray, the art, the narrow face: `cv-tray.js`, `index.html`, `cv-art.js`, `fonts/`, `style.css`, `tests/cv-tray.test.mjs`, `tests/cv-art.test.mjs`, `tests/fonts.test.mjs`, the canvas-sim view pin)
- **The narrow face** (§5.3, the user's OK; the lead downloaded it): **one variable Latin file**, `fonts/ArchivoNarrowVariable.woff2` (18 724 B, Archivo
  Narrow 3.002, Omnibus-Type; wght 400–700, default 400; 232 code points; fsType 0; Google Fonts v35's latin subset — the cord lab's request), not
  §5.3's three static weights (the plan predates knowing Google serves one variable file: [C], recorded). Declared in `fonts/fonts.css` as
  `font-weight: 400 700` with Google's latin `unicode-range` verbatim (the six cmap glyphs outside it — Ă and five combining marks the subset keeps
  for its composites — fall back, exactly as served); **not preloaded** (only a rig face asks for it); the precache's url() crawl lists it and
  `licenceFiles` its text, so it ships with every copy and is there offline. `fonts/OFL-ArchivoNarrow.txt` is the file as distributed (CRLF
  kept): "Copyright 2019 The Archivo Narrow Project Authors (…/Omnibus-Type/ArchivoNarrow)" (= the font's name 0), no Reserved Font Name, then
  the SIL OFL 1.1 word for word (fonts.test compares it with Inter's and JetBrains Mono's copies modulo "AND" / "&", http / https and the FAQ
  address). Its name table has the licence URL (14) but no name 13 (Google's subset drops it) — fonts.test pins 14 for it, 13 for the others.
  The face font is `--rig-font: 'Archivo Narrow', Inter, var(--ui)` (the skin), so a face reads the same in Inter if the file is missing.
- **The tray** (§7): the `rig` view after Serum (`label` RIG.NAME; sections `rig` (`isRigModel`), `rigmods` (head "<NAME> modules"), `rignotes`
  (head "Note tools", note "Arrive with the next cut."), `mods`; no layout of its own; note "Drop a module onto the canvas: on a <NAME> it adds
  itself and plugs in; on any other instrument it starts a <NAME> with it."). [C] **Its tip is "Our own modular synth, patched with cords"**,
  not §7's "<NAME> — our modular synth…": the menu prints the label above the tip, so the name showed twice (no other view's tip repeats its
  label; the dropdown button's title is the tip + "tap for the other views"). **`PART_TILES` → `RIG_TILES`**: nine kinds in Tidy-ish order
  (osc sub noise filter env lfo macros → `rigmods`; arp clip → `rignotes`), names and `cut` from rig-core `MODULES`; a tile is built while
  `cut ≤ RIG_CUT` (= 1 in WC-1; WC-2 sets 2), so ARP / CLIP have no tile yet and **Note tools is the cv-tsoon placeholder inside the host's own
  `#srcNoteSec`** (its heading, the note, its empty box hidden — given back at destroy). The tray API is milestone 3's, unchanged (`o.parts`
  / `partTiles` / `partTile` / `setPartPlaced` / `partPlaced`; main.js's `parts: true, partsEl … notesSec` wiring works as is). **Headings from the
  constant**: the tray inserts the `h3.cv-tgrp` and the `aria-label` into the host's sections from the view's section `head`; index.html's
  `#srcPartSec` / `#srcNoteSec` carry no heading or label (no name in the markup, G4) and **moved right after `#srcList`**, before the
  Modulators — in the rig view the module tiles follow the rig tile (DOM order is the tray's order; the Serum view no longer uses them).
  **`rigFull(kind)`**: the `setPartPlaced` texts — "This <NAME> already has 3 oscillators" / "2 filters" / "4 envelopes" / "10 LFOs" (counts from
  `MODULES.max`), "Sub oscillator is on the canvas", "Noise is on the canvas", "Macros is on the canvas", "Arpeggiator is on", "Clip sequencer is
  on"; null for an unknown kind. Tile tip "<label> — tap to add it to this track's <NAME> (or start one with it), or drag it onto the canvas";
  drag label "+ Add <label>". Glyphs: stage 3's five, ARP / CLIP kept for WC-2, **new Envelope (an ADSR trace on a baseline) and LFO (a shape)
  with the point editor's square handles** — the Modulators' ENV / LFO tiles show in the same view, so the two must differ. **The rig tile**:
  "<NAME>", "2026 · modular synth" (no maker word), its tip "… — our modular synth: modules patched with cords, a small starter rig that plays
  — tap to use it …" (`RIG.STARTER` null would say "an Amplifier to add modules to"); its art `cv-art.art('rig')`. Tiles outside the view stay
  `hidden` (the 2026-10-19 rule). `SRC_VIEWS` is seven views: hw flow serum **rig** drums ctl moog.
- **The art** (cv-art `rig`, replacing phase 0's placeholder; `SIL.rig` stays `cabinet`): ours, the cord lab's look in miniature — three charcoal
  faces on a dark rack (an oscillator's with its little screen and wave, two knobs; a filter's with one big knob over two; an amplifier's with
  four), four slotted screws per face, a cream rule where a name would be engraved (no text) over a hairline, black knob caps with cream pointers,
  two cream-ringed jacks with label bars at each face's foot, and two cords sagging between the faces — yellow (#e6b83a, the lab's) OUT of the first
  into the second, blue (#3f80d8) out of the second into the third — a plug at each end. Chip: the faces, the screen, the caps, the rings, the cords.
- **style.css** (appended at the end, in three parts): **(1) the rig chrome** on `.cv-mod[data-cv-rig]` — the case (module and body ground
  `--rig-case`), the bar (`--rig-bar`, a `--rig-line` rule under it, none when folded), the title (`--rig-title`, `font: 600 13px/1.2
  var(--rig-font)`, 0.06 em — §3.8's 13 px least for the bar title; uppercase is cv-module's), `.rig-face` (ground `--rig-face`, ink `--sx-ink`),
  `.rig-face .wk-knob` and `.wk-menu > .wk-lab` in the face font (values keep `--mono`, menus' text `--ui`), the knob labels cream (`--sx-ink`,
  §5.2 "every face label … cream"); every colour a custom property with the plain module's colour as the var() fallback (a world no skin was
  applied to still reads). [C] **The screws are one pseudo-element**, `.cv-mod[data-cv-rig] > .cv-body::after` — eight layered backgrounds
  (four 8 px radial discs `--rig-screw` → `--rig-screw-lo` at 5 px from the corners, four 5 px diagonal slots over them), `z-index: 2`,
  `pointer-events: none` — not §5.1's "::before/::after + two spans": no DOM to mount or measure; `::before` stays free. **The jack**
  `.cv-mod[data-cv-rig] .cv-fjack` (28 px): a cream ring 9.25–13.25 px round a nut (`--rig-jack-nut`) and a 5.5 px hole — the lab's jack
  scaled; while a cord flies, a jack it cannot take dims to 0.4 (the 900 Series' rule paints a dark disc over a *drawn* nut, which would black
  the rig's ring out); the green / amber rings are the face jack's box-shadows (untouched). **(2) lane C's marked place** — a comment
  "(WC, lane C) the cords renderer's rules … go here", between the chrome and the skins. **(3) the skins, last** — one block per `SKINS` id,
  scoped `#world[data-cv-skin="<id>"] .cv-mod[data-cv-rig]` (the bar inherits), `… .sx-root` (the kit declares its tokens there, skeptic
  P2-9) and `… .rig-face`; nothing but colour and font custom properties, the same 23 in the same order in every block (a switch never leaves
  a value behind): the kit's `--sx-bg / -panel / -panel2 / -line / -graph / -ink / -mute / -accent / -neg`, the chrome's `--text / --mute`, and
  `--rig-case / -face / -bar / -title / -line / -font / -screen / -jack-ring / -jack-nut / -jack-hole / -screw / -screw-lo` (§5.1's list plus
  case, line, jack-nut, screw-lo). **Charcoal** = the cord lab's `:root` (face / panel / bar #1f2023, case #17181a, line #2c2e32, ink / title /
  text #ebe6d8, muted #9c978a, accent #e8a33d) and §5.2's (caps and screen #141518, arcs and pointers cream, ring #ebe6d8, nut #7d7a72 the lab's,
  hole #0b0b0c, screws #9c978a → #55524a); [C] `--sx-neg` #ec6a4c (a warm red: §5.2 names no value; the kit's #ffb347 is too near the amber).
  Contrast, measured by the test: ink on face 13.1 : 1, muted on face 5.6, title on bar 13.1, menu text on a cap 14.6, accent on face 7.6;
  ring / face 13.1, arc / track 10.9, negative / face 5.2. The section headers are `/* ----` — cv-module.test pins `/* =====` as its own,
  the last such header.
- **What the other lanes must do** (none of it is lane U's file): **lane H** — set `data-cv-rig` on every rig module's `.cv-mod` (the Amplifier
  `iN` and each `iN/<part>`; not `iN/fx` — the FX panel is not skinned, §13 — nor OUT); call rig-ui's `applySkin(world, store.get('synth.rig.skin',
  SKIN_DEFAULT))` at boot (without it the rig modules show the fallbacks, the plain module's colours); `sxPartsDecor` over `osc sub noise filter
  env lfo macros` with `cvTray.rigFull(kind)` as the reason (sxFullWhy's Serum texts go); `env` and `lfo` are new tile kinds for the drop
  (`sxPartPick` / `sxPartDrag` / `sxPartW` / `SX_KIND`: `env` → §3.4's amp-slot rule, `lfo` → the first free slot). **Lane F** — rig-ui's own text
  (switch and jack labels, legends, the head) reads `var(--rig-font)` and the colour variables (`--sx-ink`, `--sx-mute`, `--rig-screen` for the
  screen frame, `--rig-line`); the jack row's jacks are `span.cv-jack.cv-fjack[data-jack]` (their paint is style.css's); no colour literal on
  `.rig-face`, no z-index ≥ 2 on its ground (the screws are z 2 in the body). **Lane C** — its CSS block to the marked place (lane U applies it).
- **Pins moved**: cv-tray.test (seven views and their labels; the Serum view's sections; the 2a markup pin lets the rig sections sit between
  `#srcList` and `#srcModSec`; milestone 3's part-tile cases rewritten as the rig view's; the Controllers / Moog indices), canvas-sim (the
  dropdown's labels gain RIG.NAME), fonts.test (four files, three licence texts). Nothing weakened.
- **Gates** (one file at a time): fonts 10/10, cv-art 6/6, cv-tray 43/43, pwa 25/25 and fonts' precache pin after `node tools/precache.mjs
  --write` (sw.js committed on its own — the lead may drop it and re-run after the merge), lint 167/167, rig-model 11/11 (the name grep),
  canvas-sim 24/24, cv-shell-sim, canvas-2a-sim, canvas-3-sim, main, cv-module, cv-patch, cv-cables, cv-cords, cv-world, cv-face, app,
  app-native, classic-panel, keyboard green; `tests/ref-WC/record.mjs` "the record matches base.json (114 fixtures, 5 sessions)". Headless
  Chrome (1440 × 900, 1366 × 1024, 1024 × 1366, dpr 2) on a scratch page: the tray's rig view, the charcoal skin on stub faces, the art — the
  narrow face loaded from fonts/ (the server's log: no other font request); the screenshots are in the lead's scratchpad (not committed).

### Notes — lane C (2026-10-25; the cords renderer: `cv-cords.js`, `cv-cables.js`, `cv-module.js`, `cv-world.js`, `tests/ui-bench-wc.mjs` + `?wc=1`, their tests)
- **The layer (G8)**: `o` → `ALPHAS [1, 0.85, 0.45, 0.3]` index (`alphaOf`: the nearest; not a finite number → 1) packed as `sel + 4·index` in
  the strip vertex's and the plug instance's existing float, decoded in both vertex shaders (`al`, multiplied into the coverage / the plug):
  FPV 7 / FPI 5 kept, the P-1 (c) scene hash (`BASE_SCENE`) unchanged, `o: 1` = no `o` byte for byte (pinned). `s: 2` = a round plug at a and
  the **tip** at b — plug-instance shape **3** (2 stays the glue probe): a small shadow, the ring shade to `TIP.R 6`, the body to `TIP.B 4.2`
  (the cord's BODY / W), the selected ring; the SVG fallback the same three discs and `o` as the group's `opacity` (absent at 1). [C] "a 6 px
  dot" read as its **radius** (12 px across: just wider than the 11.2 px rope, so the rope ends rounded, 6 px into the knob's rim). `c` clamped
  0…7 (`colourOf`) on every path, the live rope too. **`hit(p, r[, ok])`**: the nearest placed cord whose drawn polyline (rope, parabola,
  the SVG's 10 / 4) passes within r world px, never the live rope or a cord with an end unknown; `ok(id)` filters. `HIT_PX 12`. The canvas
  still takes no press; the cv-cords.test pin "no `hit`" moved by design (the lead's decision 2), 'pull' / 'release' / 'cordtap' still absent.
  Measured (node, the M4): `hit` 0.009 ms over 40 cords, 0.025 over 128, 0.095 over 512 — once per pan-start press, never a frame; the
  additions cost nothing per frame (no new attribute, one branch per plug).
- **cv-cables' cords mode (G8)**: `createCables(world, { cords, onRecords, cordSel, cordPoint })`. A claimed record (`cords(rec)`, never a stub:
  no b) has **no path** (no tail twin either); its `g[data-cord]` sits in the over layer carrying its label as a tag `CORD_TAG_DY 22` above
  its b plug (a dry source's "dry", a warp's "FM"). Its badge: END_PX screen px past the knob's rim (`ports`' `b.r`) on the line to its
  source, placed at relayout, `data-to="l" | "r"` (which side of the tip; CSS below); a per-note row's badge carries `NOTE_TAG "∿ last note"`
  (`.cv-ntag`, a rope cannot dash). `onRecords(records, ports)` after every set / layout (forced) and from `vis()` when the visible claimed
  set changes: ∿ Never claims no mod cord, On select those touching, Always past MOD_FADE_N a **copy** with `fade: true` (the host's 0.3). A
  claim change makes the record again (kind `kd`); the selection's class and `cordSel` follow. `tap(id, p, by)` = a line's tap on a claimed
  cord (the × at p — at `cordPoint(id, 0.5)` for a keyboard select, back there when its ends move —, a mod row's second tap the inspector, a
  warp cord's tap action); `claimed(id)`, `cordList()`, `setBadgeDrag(fn)`, `setCordAt(fn)` (a press on the selected cord's body is no
  "elsewhere"). **`cords` absent / null / claiming nothing: today's markup byte for byte** (a scripted test, the 45 old tests unchanged,
  `tests/ref-WC/record.mjs` "matches base.json"). `cablesOf(t, { edges })`: a device shown as its modules takes its internal records from
  `opts.edges(id, dev)` when it answers an array (lane H: `rig-core.edges`), else sx-edges' as before.
- **The cords-mode drag** (`createCableDrag(world, { live, grab, cordLook, onPull, onRepatch, onRepatchMod, jackMenu, cordHit })`; without
  `live` nothing of it runs): a `[data-kind=cord][data-cord]` jack (a rig's, cv-module) that `o.cordPress` **declines** is this drag's — so with
  `cordPress: PATCH.press` (it declines a rig's jack) the rig's press rules are cv-cables': an **output always a new cord** (`live({a: the
  jack, b: the finger, c, s, o})`, `cordLook(jack)` the colour, a mod output's tip), an **input grabs its most recent** (the last claimed record
  at it in the list's order: `grab.grab(id, 'b', p) / move / drop`), a free input a new cord backwards; the jack **under the finger decides
  first** (its hit circle, cv-patch's rule), else the nearest compatible within SNAP_PX, else a module body's first; the target chip
  (`#overlay .cv-plugchip`, cv-patch's class). Release: new → `onConnect(out, in)`; grabbed → `onRepatch(id, out, in)` on another input,
  nothing on its own jack or its source, **`onPull(id)` away from any jack**, `onRefuse` near a refused one; Escape / a second finger: it springs
  back (`drop`, nothing written); the callbacks first, then `drop` / `live(null)` (a commit's set takes the rope over). A **mod output**'s cord
  lands on a knob (`onMod`, markDests' glow) or on a cord input `canConnect` accepts (an Envelope onto LEVEL → `onConnect`). A **warp** jack is a
  target only (its tap = the warp cord's tap). A tap / Enter / Space / right-click: `jackMenu(jack, el, x, y)` first (the host's plug menu,
  rig-ui's), else a mod output's `onJackTap`, else "Connect to…" over the cord jacks with **Pull** items. A touch long-press (`WHICH_MS 500`) or a
  right-click on an input holding several: **"Which cord?"** (by source, the most recent first; a pick selects it and opens its menu). **The
  badge drag**: a claimed mod row's badge stops its press (never a pan) and past TAP_PX grabs the tip: another accepted knob →
  `onRepatchMod(id, dst)`, its own / a refused one → nothing (refused: `onRefuse`), away from any knob → `onPull(id)`. `cordHit(p, r, ok)` given:
  the drag installs `world.setCordHook` (its tap → `cables.tap`) and the cables' `setCordAt`.
- **[C] who drags a rig cord** (§4.4 says `cordPress → rigHost.press`, row C says cv-cables' cords drag): both can stand — whichever `cordPress`
  answers takes the press. If lane F's `rigHost.press` does the whole plug drag, lane H wires `cordPress: (e, el) => PATCH.press(e, el) ||
  rigHost.press(e, el)` and cv-cables' cords drag never sees a rig jack; if it is the menus' glue, `cordPress` stays `PATCH.press` and rig-ui
  answers `jackMenu`. One of them should go before the squash (the lead's call).
- **cv-module**: `partJacks(part, title, mode)` / `rigJacks` — mode `'cords' | 'lines'` (`WIRES`) gives a rig's jack rows: every jack **inline**
  (its `[data-jack=<port>]` anchor in rig-ui's row), dir set, `awake` (`data-cv-awake`); cords → kind `cord` + `data-cord` role (audio / note /
  mod / warp) + `data-sig v`; lines → stage 3's kinds. The Amplifier (`'amp'`, the device key): main · direct · level · note ‖ out (sx-edges'
  `voice.*` ids, labels IN / DIRECT / LEVEL / NOTE / OUT). `env1` an Envelope (a local `partKind` fallback until sx-edges' table knows it).
  **createTrackView reads the entries' `wires`** (lane H: `wires: drawMode(t)` on the rig's inst entry and its part entries; **no `wires` =
  stage 3's jacks at the edges**, canvas-3-sim's rig untouched): the jack rows (`JA` copies `data-cord / data-sig / data-cv-awake` onto the
  anchor), every rig jack its own tab stop (not cv-patch's roving one), `ports()`' **`iN.env1` alias** of `iN/env1.out` (sx-edges' `voice.env1`
  and VOICE-era link rows land on Envelope 1's OUT), a cords-mode knob end's **`r`** (the knob's radius: the host's rim point, the badge's
  offset), `cOpts`' `parts` gate (a rig needs no lay flag) and the host's `edges`, the cables' `cords / onRecords / cordSel / cordPoint` from
  `host.cables`; `PART_W_DEF.amp 288` / `PART_H_DEF.amp 416`; a flip of `wires` rebuilds (the jack signature carries the kind). **Tidy** (§3.6):
  a rig part in cords mode leaves one grid row (32) more under it in its stack [C: every one, not only "an OUT running downwards" — the sag is
  ≈ 57 px at D 200]; the Amplifier column at 288.
- **cv-world**: `cordAsleep` / `sleeper` exempt `[data-cv-awake]` cord jacks (offered to the jack hook at every zoom, never the sleeping body;
  the 900 Series' still sleep). `setCordHook(hit, tap)`: every press that would pan — the empty canvas, **a module background and a sleeping
  body too** [C: a cord lies over panels; a tap on it there selects the cord, a drag pans] — asks `hit(p, HIT_PX / k)`; a tap then runs
  `tap(id, e, p)` (no deselect, no double-tap fit, its click eaten — never the × that appears under the finger).
- **What lane H calls** (main.js): (1) `wires: drawMode(t)` on the rig's device entries (cvDevices); (2) `host.cables = { …, cords: cordOf,
  onRecords: (L, P) => { const C = cvCords(); C.set(L.map(toCord)); C.anchors(cordAnchors(P)); }, cordSel: id => cvCords().sel(id), cordPoint:
  (id, t) => cvCords().pointAt(id, t), edges: (id, dev) => isRig ? RC.edges(…) : null }` — `toCord` maps `fade` → o 0.3, `byp` / `dim` →
  0.45, the rig's own rows 0.85, a mod row `s: 2`; `cordAnchors` rims a knob end with `P.get(b).r` toward the source and fans `<jack>#<i>`;
  (3) `modDragOpts += { live: x => { const C = cvCords(); if (C) C.live(x); }, grab: () => cvCords(), cordLook, onPull (+ "Cord pulled · tap to
  undo"), onRepatch (record id → rig-core repatch), onRepatchMod, jackMenu, cordHit: (p, r, ok) => { const C = cvCords(); return C ? C.hit(p, r, ok) :
  null; } }`; (4) `alloc` by drawMode and cv-patch's conditional dep (§4.1); (5) **`host.onRelay`** (today `ports => cvCords().anchors(ports)`)
  runs right AFTER `cables.layout` in cv-module's `relay()`, so on a rig canvas it would replace `cordAnchors(ports)` with the raw ports (no
  rims, no `#i` keys: the fanned cords undrawn) — make it the patch canvas's only (or have it set `cordAnchors(ports)` too). The bench calls `__synthTest.cv.rig.add(dev, kind, part)`,
  `plug(dev, a, b)` (sx-edges ENDs) and `wires(mode?)` — adapt either side.
- **Open for lane H / K**: in **lines** mode an Envelope's OUT is stage 3's `mod` jack, so no line drag reaches the Amplifier's LEVEL (an audio-kind
  input) and its "Connect to…" lists no mod output — the amp slot there needs a menu path (the Envelope's ⋯, or `jackMenu`); cords mode has it.
- **The bench** `tests/ui-bench-wc.mjs` (`?wc=1`, `&auto=1` → `window.__wc`, kind "ui-WC-mac"): scenes juno (W7: no buffer, no claims) / rig1 /
  rigX made through the app's hooks; phases idle / pan / pinch 25–200 % / settle / amp (the Amplifier dragged, its cords awake) / sway (every
  cord plucked) / rest + rigX's 60 s sweep (context losses); per phase IMPL-3 §1.5's analysis and verdict, `cords().stats()`; painted
  elements against §9. Its pure part is node-tested (`tests/ui-bench-wc.test.mjs`); **not run in a browser by lane C** — the main checkout's
  launch config was not mine to edit and the rig host is lane H's: reviewer 2 runs it after H (before H it builds the rigs stage 3's way).
- **CSS for lane U** (style.css, one block; nothing committed here):
  ```
  /* (WC, lane C) cords mode: a claimed record's tag above its b plug; the badge of a rope (no tail: it grows away from the tip — data-to r
     its right), its per-note tag, the knob end's handle */
  svg.cv-cable-ends .cv-cable-g[data-cord] .cv-cable-lab { font: 600 11px var(--ui); }
  .cv-mbadge[data-cord] { touch-action: none; cursor: grab; }
  .cv-mbadge[data-cord][data-to="r"] { transform: translate(0, -50%); margin-left: calc(2px * var(--ik, 1)); }
  .cv-ntag { padding: 0 calc(3px * var(--ik, 1)); border-radius: calc(3px * var(--ik, 1)); background: #1b1f26; color: #7fe0d6;
    font: 600 calc(8.5px * var(--ik, 1))/1.4 var(--ui); letter-spacing: 0.04em; }
  .cv-ntag[hidden] { display: none; }
  ```
  (the × on a cord is `.cv-cable-x` as a line's; the chip is cv-patch's `#overlay .cv-plugchip`; the jack rings `.cv-jack-in.cv-ok / .cv-from /
  .cv-hot` exist.)
- **Gates run** (one file at a time): cv-cords 40/40, cv-cables 57/57, cv-module 71/71, cv-world 79/79, ui-bench-wc 5/5, cv-patch 31, canvas-9 /
  9b / 9c-sim, every canvas-*-sim, cv-shell-sim, lint, rig-model (the name grep: comments say "a rig"), and the 35 other files importing
  these modules (main, integration, canonical-stream, canvas-M-bounce, serum-ui …) — all green; `tests/ref-WC/record.mjs`: "matches base.json
  (114 fixtures, 5 sessions)". pwa.test needs the lead's `node tools/precache.mjs --write` (a one-line BUILD change, checked and reverted:
  then 25/25; no lane commits sw.js).

### Notes — lane K (2026-10-25; the rig's rules: `rig-core.js` edges / can / plug / pull / repatch / envToAmp / envFromAmp / partKeys / nameOf / labelOf / pruneRig / WORDS / LOOK, `sx-edges.js` additive, `tests/rig-core.test.mjs`, `tests/rig-sound.test.mjs`)
- **The API as built** (§2.3 / §11.1, deviations marked [D]). Every editor is pure and returns **`{ f: [[path, before, after] …], why, notes: string[],
  lay?, links?, ids? }`** — `f` empty and `why` set on a refusal; `f` in sx-edges' path form (`['p', id]`, `['osc', 0, 'route']`, `['matrix', 5, 'dst']`,
  `['env', 0, 'bpm']` …), written by main's `sxApply` / `sxFieldSet` and undone by writing the before-values (every test proves the undo exact).
  - `edges(s, fx, dev, rig, used)` [D: a fifth argument `used` — the host's link-row sources (`sxUsed`), so the amp-slot cord knows a link row reads
    ENV 1] → `[{ id: 'x:<dev>:<edge id>', kind: 'audio' | 'note' | 'warp' | 'mod', int (= kind; the amp cord's `int` is `'level'`), dev, edge: { a, b }
    (sx-edges' ends), a, b (the canvas jacks; the ends when `dev` is not a string), src: [dev], c, o, s: 0, ro?, dim?, fork?, share?, badge: 'BAL'?, dry?, tag:
    'dry'?, off? (the ⏻-off Filter it lands on), env?, label? / field? / tap: 'open' (warp) }]`. Kind `'fx'` dropped. Records from an off (module-less)
    source are listed `dim` as serumEdges lists them (an unknown anchor draws nothing in the layer; the host may filter by its modules).
  - `can(s, fx, a, b) → { ok, why, a, b }`; **`plug(s, fx, a, b, o)`**, **`pull(s, fx, id, o)`** (an edges() id, `'x:<dev>:<edge id>'` or the bare edge id with
    `o.dev`), **`repatch(s, fx, id, end, b, o)`** (`end` `'a'` | `'b'`: pull then plug on a copy, one `f`), **`envToAmp(s, k, o)`** (k 2–4 or `'env3'`),
    **`envFromAmp(s, o)`** — [D] the contract's `held` argument became an options object **`o = { held, shown, used, rig, dev }`** (a bare array / Set
    is taken as `held`): `held` the slots canvas-modulator injections hold (names `'env3'` or cv-graph's `inj` records `{ kind, k }`, k 0-based), **`shown`
    the parts laid on the canvas** (an unplugged Envelope module keeps its slot — a laid slot is never "free", the way `sxAddPart` skips the shown
    parts; without it envFromAmp would overwrite a module's fields), `used` the link-row sources, `rig` = `dev.rig` (the ordinals in the notices), `dev`.
  - The slot moves return **`lay: [[fromPart, toPart] …]`** (part names, the host prefixes `dev + '/'`; a swap lists both directions — apply them
    simultaneously, to `t.lay` AND to `dev.rig.n`), **`links: [[fromEnd, toEnd] …]`** (`'env3.out' → 'env1.out'`, part-relative: the host renames
    `track.mods` rows whose `src` is `dev + '/' + fromEnd`) and **`ids: [[fromId, toId | null] …]`** (every destination id of both modules by suffix:
    the host re-targets canvas rows `dev + ':' + fromId`; `null` = no counterpart (`e3.start / end` into ENV 1): the row is dropped).
  - `partKeys(s, lay, dev, used, rig)`, `nameOf(rig, key)`, `labelOf(part, rig)` (`'voice'` / `'amp'` / nothing → 'Amplifier', `'fx'` → 'Effects'),
    **`ordinalOf(rig, part)`** and **`nextOrdinal(rig, kind, parts)`** (the lowest 1…99 none of the kind's modules shows — lane H sets `dev.rig.n[part]`
    at creation), `pruneRig(rig, s, lay, dev)`, **`envRead(s, used)`**, **`LOOK`** `{ c: part → palette index, o: { on 1, row 0.85, off 0.45, fade 0.3 } }`,
    **`cordColor(a, rig, kind)`** (the §4.5 rule; `dev.rig.cc[a]` wins; warp Orange), **`diff(a, b)`** / **`apply(s, f)`** (the `f` form both ways —
    exported for the host's tests).
- **[C] The sustain re-law is serum-core's already**: `copyFields` carries a knob through `convN` — value-wise when the laws differ (`lawNorm(pow2,
  lawValue(lin, n))` = √n) — so `swapModules(s, 'env1', 'env3')` gives `e1.sus = √e3.sus` by itself; rig-core adds nothing there (the round trip is
  within 1 ulp as the contract says). What rig-core adds over `swapModules` (`swapRest`): the rows' **sources** (`src` and `aux`, both ways — swapModules
  re-targets destinations only), `s.midi`'s destination ids, `s.locks.p` / `.unp` ids and `s.locks.mod` module names; then **the gate rules**: envToAmp
  resets slot k to Serum's defaults (`initModule`: fields, flags, the rows onto it) when nothing reads it — when ENV 1 was read (a row or a link row) the
  module that was Envelope 1 stays, at slot k, with the gate's values (lay both ways; §3.4's "Envelope 1 stands there plugged" case, moved); envFromAmp
  swaps ENV 1 into the first free slot and writes `GATE` into ENV 1. START / END of the moved Envelope are dropped by swapModules' rule and **listed**
  ("Envelope 7's START and END dropped — Envelope 1 has none"); they come back as 0.
- **[C] plug's one rule beyond setEdge**: a source into a Filter while its other cord exists (wet **or dry**) forks with the balance ½ and **this**
  switch on — setEdge also switches the other filter's input on. Everywhere else `plug ≡ setEdge` and `pull ≡ cutEdge` field for field (tested over
  jackrules' 800 states; the pull of a wet cord whose sibling is dry keeps the dry one — cutEdge, seeing one cord, cuts the route). A source into a
  Filter it already feeds, wet or dry, is "Already connected" (the switch is the Filter face's). `can` treats a mod output (`env<k>.out`, `lfo<k>.out`,
  `macros.k<n>`) as a known end so the refusals read right ("An Envelope, LFO or Macro goes on a knob"; an LFO into LEVEL has its own word); the knob
  path itself is the host's (`sxOwnConnect`).
- **The dry cord in the 86 presets**: exactly **19** presets have a powered source with a cord into a Filter whose input switch is off and **30** a
  powered source into a ⏻-off Filter (I1') — the skeptic's counts, re-derived by the test; the default Serum gives `partKeys` `['oscA', 'filter', 'env1']`
  (G6's "Make it a <NAME> on a default Serum": a Filter 1 module ⏻ off).
- **sx-edges, additive**: `PARTS` has `env1` before `env2`; `LABEL.env1`; `PORTS.voice` gains `'level'` and `'env1.out'` parses (`jackOf('i1',
  'voice.level')` = `'i1.level'`, `endOf` back); `setEdge` / `cutEdge` refuse either amp end (**`WHY.level`** 'Only an envelope shapes the level',
  **`WHY.env`** 'An envelope shapes the level or modulates a knob' — the amp slot is rig-core's); `KIND_OF.env` lists `env1` (`kindOf('env1')` = `'env'`)
  while **`firstFree` never gives it**; `SLOT` learns `env[1-4]`; **`slotsUsed(s, used, env1)`** counts ENV 1 only with the third argument (rig-core
  passes it; a Serum's VOICE holds ENV 1 — this is what keeps jackrules' `slotsUsed` / `partKeys` / `firstFree` pins byte-identical) and sx-edges'
  `partKeys` never lists `env1` (rig-core's does, by the amp-slot rule). jackrules.test: 13 / 13 unchanged.
- **[D] `pruneRig(rig, s, lay, dev)`** returns the record itself for a non-state `s` (nothing is known) — phase 0's pin holds — and otherwise a GC'd copy:
  cc keys whose source part (before the `.`) is no module of `partKeys(s, lay, dev)` go (`'voice.*'` stays; `'env1.out'` iff the amp cord exists), n keys
  likewise. At load (song.normDev) the link rows are not at hand, so an `env1.out` colour on a gate-with-link-row rig may be pruned there — cosmetic.
  **Pin moved** (§11.3, failing-test-first): rig-model.test's normDev case — the orphan ordinal (`n.env2` on Init) is dropped now, a module's stays.
- **G3 as measured** (tests/rig-sound.test.mjs; the real engine through golden-harness' worklet scope, `SerumVoice.prototype.chunk` wrapped to log
  `eV[0]` / `gAmp` per control chunk; the oscillator **`factory:Sine`** (one frame — the lane's pick over Default Shapes' frame 1: nothing to position),
  220 Hz, `rigInit`): at 48 kHz × OS 1 ENV 1 rises 1/36 per chunk, exactly 1 at chunk 36 (0.9722 at 35); at 44.1 kHz × OS 2 0.03023 per chunk, 1 at
  chunk 34; the release is the mirror and reaches exactly 0; the voice ends ≤ A + 2 chunks after the key-up; **the engine renders any quantum length**
  (`n = output.length`), so the re-press case runs 48- / 44-frame quanta and strikes 1 ms into the release: the attack restarts from ≈ 0.67 — no step
  on the voice or the output; the output's edge steps equal the steady sine's own (≈ 0.00556 at a 0.193 peak; bound 0.00724); a held key is exactly 1
  for 10 s; legato mono holds 1 across the second key; glide changes the pitch and not one amplitude chunk; 8 keys = 8 voices each from 0; a steal
  (poly 2) keeps the stolen voice at 1; a BPM / Voice-Steal-Retrigger ENV 1 pulled off LEVEL is the gate (flags 0) and passes the same bounds.
  **Two engine observations, not the rig's** (W1 / W2, the same for a Serum): the output lags the voice by ≈ 51 frames at OS 1 (≈ 1 ms; the quantum
  size does not change it), and after a voice ends the output holds a **≈ −44 dB one-signed DC tail** (≈ 1e-3 absolute at a 0.19 peak) that decays
  with τ ≈ 40 ms — the output stage's settling, inaudible; the test bounds the post-release output at −40 dB two quanta after the key-up rather than
  −80 dB. G2: `patchFor` deep-equal and 10 s renders (keys, wheel, bends, sustain, the song with transport) bit-identical for the starter, Init and
  preset 5.
- **For lane H**: `plug(s, fx, 'env1.out', 'voice.level')` on the gate = Envelope 1 takes the level over at Serum's envelope defaults (an Envelope tile
  dropped while the gate — §3.4 — is this plug); `plug(… 'env<k>.out', 'voice.level', o)` = envToAmp; `pull(… '<amp cord id>', o)` = envFromAmp (the
  notice text is `notes[0]`: "Envelope n unplugged · the keys gate the level again"); pass **`o = { held: <compileMods' inj slots>, shown: sxPartList(t,
  dev), used: sxUsed(t, dev), rig: dev.rig, dev }`** to every editor; apply `lay` / `links` / `ids` as above and move `dev.rig.n` with `lay`. `sxFullWhy` →
  `WORDS.full(kind)`, `SX_OWN_MACRO` → `WORDS.ownMacro`, the S0 text → `WORDS.heavy`, the "Inside its instrument" refusal → `WORDS.notPatchable`,
  modRefusal's 'full' → `WORDS.rowsFull(used, max)`, cv-model's notice word → `WORDS.theInstrument`, sx-host's `BUILD` → `WORDS.build`, the S1 tooltip
  → `WORDS.s1Tip`, the legends → `WORDS.gateTip / gateTipScaled / dry / dryTip / filterOff / lastNote`. **The kit's own ENV moves** (sx-host's Swap /
  Paste / label drag, §3.4) still go through serum-core directly: sx-host.js is in no WC-1 lane's list — the host (or a fixer) routes them through
  envToAmp / envFromAmp when ENV 1 is a party; the test pins that swapModules / copyModule move the fields and the flags exactly as envToAmp does, so
  the difference is only the sources / midi / locks / the slot reset / the lay. **For lane C / F**: the amp cord's record has `kind 'mod'`, `int 'level'`,
  `c` 1 (Yellow), `o` 1, `s` 0; dry cords carry `dry: true, tag: 'dry'`; forks `fork, share, badge: 'BAL'`; a cord into an off Filter `off: '<part>'`.
  `rigStarter` now plugs its cords through `plug` (the same state as phase 0's, pinned).
- **Gates**: rig-core.test 14 / 14, rig-sound.test 9 / 9, jackrules 13, serum-core 86, sx-host 21, rig-model 11, cv-migrate 72, lint 167, `tests/ref-WC/
  record.mjs` "the record matches base.json (114 fixtures, 5 sessions)", golden-presets 8, canonical-stream 1 — plus cv-module 67, cv-cables 45, canvas-3-sim
  25, main 47 (the shared sx-edges change). No DSP file in the diff (rig-core.js, sx-edges.js, three test files, this doc).

### Notes — lane F (2026-10-25; the faces: `rig-ui.js`, `tests/rig-ui.test.mjs`, `tests/ui-layout-wc.mjs`)
- **The API as built.** `GRID` (every §3.8 number, frozen; `cssText()` generates the injected CSS from it — `--rig-u / -col / -pad / -top /
  -bottom / -gap / -row-* / -knob* / -lab* / -box* / -jack* / -hit / -f-*` on `.rig-face, .rig-drawer`; `ensureRigCSS(doc)` once, `#rig-css`),
  `FACE[kind | variant] = { cols, rows: [{ t, h, items }] }` (items: data-dest ids with `@` = the slot's prefix, `#name` pieces, `a|b` alternates in
  one cell, `:n` spans, `*` the head's growing item, `<port` / `>port` jacks — no pixel anywhere), `layoutOf(recipe)` (pure geometry: w, h, row tops,
  cells' columns and centres), `sizeOf(kind, part)`, `variantOf`, `applySkin(worldEl, id)`, and **`rigHost(deps)` → `{ face(kind, root, args) → View,
  jackMenu(jack, el, x, y) → handle | null, press → false, applySkin, FACE, GRID, sizeOf, layoutOf, endOf, jackKey }`**. `face` args: `{ host` (the
  rig's SerumHost — main.js's record's SerumUI in parts mode, exactly what `SXMOD.mountPart` gets today)`, part` (`'voice'` for the Amplifier, else
  the engine part)`, shown, dev, n` (the fixed ordinal, dev.rig.n)`, opts, levelPlugged? }`; the View is the host's (`H.mount` of a builder: its
  page, paint, panel undo, label drag, `V.power`, `V.menuItems()`) + `{ el, face: { kind, variant, cols, w, h }, jacks: Map(port → el), dests(),
  drawer: { el, open, close, isOpen } }`.
- **What lane H calls.** `const RIGUI = rigHost({ doc, cur: () => ({ t, dev, s, fx, rig }), rec?: (t, dev) => records, edit: (t, dev, label, r) =>
  sxCable-style ONE step (r = rig-core's { f, why, notes, lay }), colour: (t, dev, srcEnd, c) => dev.rig.cc, notice, undo, menu?, view: () =>
  cvView, title: (t, dev, part) => nameOf(rig, part) })`; in `sxViews` replace `SXMOD.mountPart(H, part, el, …)` by `RIGUI.face(kindOf(part), el,
  { host: H, part, shown: () => cvLive(k), dev, n })` (the Amplifier: `face('amp', rec.box, { host: H, part: 'voice', … })`); cv-module's `size` for
  a rig part = `{ fixed: { w: RIGUI.sizeOf(kind, part).w } }` (288 / 352 / 224); `createCableDrag({ …, jackMenu: RIGUI.jackMenu })` (lane C's
  `cordTap` asks it first); `applySkin(W.el, store pref)` once per canvas mount; rig-ui is imported with the panels (it imports sx-ui-mod /
  sx-ui-osc / wk at top level — load it in `uiMods()`, not at boot; precache by reachability from main.js).
- [C] **The widgets come from donors.** Each face builds the kit's own panel classes (OscPanel, SubPanel, NoisePanel, FilterPanel, EnvPanel,
  LfoPanel, MacrosPanel, VoicingPanel, OutputsPanel) on its page and moves their widgets onto the grid by data-dest (or by a named piece: menus,
  buttons, displays); the panels' compositions are discarded. So every binding, extra menu (SEM's pitch modes, CUTOFF's Key Track, PHASE's memory
  …), label function (SEM → HARM / STEP, VAR → FAT …), alternate (OCT ↔ SRC, SEM ↔ RATIO, SCAN ↔ RATE, START ↔ STEREO …) and lazy type view is the
  kit's, and the stage-3 data-dest set holds by construction (a widget the recipe does not place is **parked** on the face, hidden as the kit hid
  it: Envelope 1's ENV-2 START / END, a Wavetable's granular warp RANDs). **Fresh** knobs only where a knob reads better on the grid or the kit has
  none: the Filter's LEVEL (the kit's slider), X / Y (dimmed below the new types; the kit had them in a pane), the Amplifier's MAIN · DIRECT · BUS 1 ·
  BUS 2 (the kit's faders) and LEVEL (`g.amp`, none), the unison WIDTH, a kit type's HZ, the Sub's TRACK (`s.track`, a menu item in the kit); the
  donor's own widget for those ids stays off the face (bound, never shown). A few labels print our words (`data-l`: SEMI · FINE · COARSE · GLIDE).
- [C] **Every knob row full** (or short by an even count: Envelope 1's three curves on columns 2–4) so every knob sits on a column centre (G11);
  the recipes refine §3.1's rows where it needed one (MODULES.rows is descriptive; FACE is the truth — **lane K / the lead may sync MODULES.rows**):
  · **Oscillator** 3 × 5 cells, the same in every type, only the type cells differ (row 1 col 5, row 2 cols 4–5): Wavetable WT POS · PHASE · RAND;
  Sample SCAN|RATE · START · END + a fourth row LOOP · LS · LE · X-FADE · SLICE; Multi / Granular / Spectral (the kit's interior in the screen
  frame, WC-2) HZ · RAND · RAND 2; rows OCT · SEMI · FINE · COARSE · T1 / UNISON · DETUNE · BLEND · T2 · T3 / WARP · WARP 2 · WIDTH · PAN · LEVEL; the
  head TYPE · the table (◀ ▾ ▶, grows) · ✎ editor · ⚙; the screen = the display + a strip of the two warp menus (number, mode, VAR in Sync, FM type,
  remap pen — the kit's warp-row pieces). · **Filter** gains a 112 screen (its response display: drag = cutoff / res, tap = the view) and keeps one
  switch row, INPUTS, in our words (OSC 1 · OSC 2 · OSC 3 · NOISE · SUB: the kit's routeTap and `data-pdest`, never a mod target); KEY in a knob cell
  (row 2: KEY · X · Y · PAN · LEVEL), CLEAN a head toggle. · **Sub / Noise** a third knob row with the sends (BALANCE · BUS 1 · BUS 2, the kit's route
  pane knobs; BALANCE dimmed unless the source goes into a filter): Sub OCTAVE · COARSE · PHASE / TRACK · PAN · LEVEL; Noise PITCH · FINE · START|STEREO /
  RAND|FILTER · PAN · LEVEL, ONE SHOT in its head (its source menu without ◀ ▶ at three columns). · **LFO** RATE · RISE · DELAY · SMOOTH · PHASE, the
  switch row MODE (FREE | RETRIG | ENV, 3 columns) · BPM · MONO; head TYPE · DIRECTION · GRID · shapes · ⚙ (DOT / TRIP / HOST, the drawing tools, the
  large editor in the drawer). · **Envelope** head BPM · LOCK · zoom (its ⋯ items are the bar's). · **Amplifier** VOICES · GLIDE · CURVE · LEVEL /
  MONO · LEGATO · ALWAYS · SCALED / MAIN · DIRECT · BUS 1 · BUS 2; head undo · redo · voices · meter · ⚙ (BEND, the buses' routes and FX bypass, the
  GLOBAL fold-outs as dialogs, the touch modifier bar). · **Macros** head = a one-line hint ("Drag a name onto a knob to modulate it").
- [C] **The jack row**: `span.rig-jack.cv-jack.cv-fjack[data-jack=<port>][data-cv-awake]` (lane U's markup; cv-module's `rigJacks` anchors —
  lane C's JA moves data-cv-jack / data-kind / data-dir / data-cord / data-sig / data-cv-awake onto it) + `data-rig-sig` (the MODULES kind),
  `data-sum` on a Σ input, `data-ro` on WARP; `--jp` 44. **Its numbers refined**: jack 4 px from the row top, a **6 px** gap, the 12 px label
  line, 6 px (the contract's "4 px gap" put the label 4 px from the jack against §3.8's own ≥ 6 px text margin; the row stays 56). **The
  Amplifier's OUT is cv-module's right-edge dot** (no anchor: lane C's fallback) — its line to the FX panel attaches at the edge as every line
  does, and its four inputs fill its four columns: IN Σ · DIRECT Σ · NOTE Σ · **LEVEL** last (the "LEVEL KEYS" label needs the room a neighbour's
  "DIRECT Σ" left it only 6 px of; MODULES' data order unchanged). KEYS is struck while `!isGate(s)` (or `args.levelPlugged()`); the tooltip names
  the 3 ms ramps and, when set, the voice control's envelope scaling.
- [C] **Values in the face font with tabular figures**, not mono: a 10 px mono digit is 6 px, so LFO's "0.00 beats" (10 characters) overran its
  cell into the next one's; the face font keeps the 8 px text gap.
- [C] **G11's fill ratio is the grid occupancy**: the cells a control stands in (a dimmed one too), every jack's cell, the head's items at the row
  height, the screens, the text boxes — over the face area; empty cells, empty jack cells, paddings and gaps are the empty part (the negative space
  the user meant). The literal "union of control, screen and text boxes" is reported beside it ("strict"): with §3.8's own paddings (12 / 16 / 16),
  12 px gaps and a 56 px jack row holding one jack, a three-column face cannot reach 0.55 even with every cell full (Sub 0.51, the Amplifier 0.54).
  Also refined: a cell's label / value stack is one text unit (the 8 px rule is between cells and controls); an asset **name** in a menu (a table, a
  sample, a noise, a warp mode in the strip) may ellipsize (G11 checks every fixed text for clipping).
- [C] **The ⚙ drawer** is the face's overflow, built with it and kept **inside the face, hidden** (its data-dest ids count for parity; a cord to
  one of its knobs ends at the bar as cv-cables' hidden-end idiom), opened as a sheet in the host's layer at the ⚙ (outside press / Escape / a
  camera move close it; the kit's popovers from inside it stay); it copies `data-cv-skin` from the world (the top layer is outside #world).
- [C] **Touch**: the kit's 44 px minimum heights (`.sx-touch`, `pointer: coarse`) would break the rows: on a face every head / switch / box control
  stays 28 px with an invisible 44 px hit (`::after`, inside the row gaps); the head's ◀ ▶ stay 20 px wide (the kit widens them to 28 on touch).
- **The lead's decision (after lane C)**: the cord drag is cv-cables' (`createCableDrag({ live, grab, … })`); `rigHost.press` declines every
  press; rig-ui keeps the **tap menu** `jackMenu(jack, el, x, y)` (lane C's call; `(jackEl, event)` works too): a plugged jack → the cord (A → B)
  with Pull ("Cord pulled · tap to undo") · Re-patch to ▸ (its input plug to another input its source can feed) · Colour ▸ (eight, by the source
  end); several → "Which cord?" (most recent first); an output or a Σ input adds Connect to ▸; an empty jack → Connect to… (the jacks `can`
  accepts, never a read-only one); a read-only jack lists what reaches it; an Envelope's OUT offers the Amplifier's LEVEL (lane C's open item: the
  amp slot's menu path in lines mode too); a modulator with nothing to reach → null (cv-cables' onJackTap). Rules by namespace (`RC.can / plug /
  pull / repatch / edges` when lane K's land; deps override them — the tests stub them).
- **G11** (`node --max-old-space-size=2048 tests/ui-layout-wc.mjs --sizes d,l,p --narrow <woff2> --out <dir> [--faces]`; its own static server
  and a headless Chrome on a temporary profile): **green at 1440 × 900, 1366 × 1024 and 1024 × 1366 (touch, dpr 2), with Inter and with Archivo
  Narrow**. Per face at 1440 × 900 (Inter; the narrow face only widens the margins): fill (occupancy / strict) · min text margin to edge / to a control
  / between texts — Oscillator 0.68 / 0.65 · 16 / 6 / 15.8; Filter 0.67 / 0.59 · 19.8 / 6 / 21; Amplifier 0.69 / 0.54 · 14.6 / 6 / 10.2; Envelope 1
  0.59 / 0.56 · 20 / 6 / 10.8; Envelope 2 0.65 / 0.63 · 20 / 6 / 10.8; Sub 0.61 / 0.51 · 19.4 / 6 / 17.1; Noise 0.60 / 0.57 · 19.4 / 6 / 18.8; LFO
  0.62 / 0.58 · 19.8 / 6 / 10.7; Macros 0.69 / 0.58 · 16 / 11 / 18.8; Oscillator (Sample) 0.70 / 0.65 · 16 / 6 / 15.8; the kit interior (Granular) frame
  only. Label / face contrast 13.1 : 1, value 5.6 : 1 (charcoal). Every knob 40 × 40 on a column centre and its knob line, every row at layoutOf's top
  ± 0.5, jacks 28 px at column centres with 44 px hits, every control inside the inner area, font minima held. **Parity** ⊇ on every face (Oscillator
  26 ⊇ 22, Filter 13 ⊇ 9, Amplifier 11 ⊇ 10 with ENV 1's ids on Envelope 1, Sub 11 ⊇ 7, Noise 11 ⊇ 8, Envelope 10 ⊇ 10, LFO 5 ⊇ 5, Macros 8 ⊇ 8).
  **Elements** (all / painted, against the stage-3 panel): Oscillator 393 / 200 vs 330 / 197; Filter 210 / 145 vs 130 / 98 (×1.48 painted: the X / Y
  knobs the kit kept in a pane, the 23 grid wrappers, the jacks); Sub 131 / 101 vs 80 / 59 (×1.71: the three sends the kit kept in a pane, TRACK, the
  wrappers, the jack); Noise 169 / 109 vs 117 / 73 (×1.49: the sends, the wrappers, the jack); Amplifier 224 / 127 vs VOICE's 429 / 328; the rest ≤ 1.2.
  The drawer and the park are never painted. G13's words: no "Serum", "Xfer" or "VOICE" in any face's texts, titles or names (the harness lists them).
- **Contact sheets** (the lead shows them before WC-1 deploys; not committed): `wc1-faces-{desktop-1440x900, ipad-1366x1024, ipad-1024x1366}{,-narrow}.png`
  + `g11.json` + 2× crops per face in the lead's scratchpad `WC-sheets/` (the session's). **Not made here**: the sheet of a rig canvas with the
  starter rig and six cords — it needs lane H's host and lane C's cords on one page (the reviewers' / the lead's after the merge).
- **For lane U** (style.css): the faces read `--rig-face` (face), `--rig-screen` (screen frame), `--rig-jack-ring` / `--rig-jack-hole`, `--rig-font`,
  `--rig-label` (labels; default `--sx-ink`) and the kit's `--sx-*`; the skin block must also match **`.rig-drawer[data-cv-skin="<id>"]`** (the drawer
  in the top layer); the 16 px side padding is the screws' (every control stays inside the inner area, G11 checks it).
- **For lane K / the lead**: MODULES.rows ≠ FACE's rows for Oscillator (Sample: 4 knob rows), Sub / Noise (3), Filter (screen + 2 knob rows + 1
  switch row), LFO (unchanged kinds) — FACE is what the faces do. tests/pwa.test fails on this branch alone (rig-ui.js joins the precache crawl; the
  lead's `node tools/precache.mjs --write`).
- **WC-2 for lane F2**: Multi / Granular / Spectral interiors on the grid (they show the kit's view in the screen frame now, natural height), the
  Arpeggiator / Clip faces, the drawer's GLOBAL panels re-laid; the screens' colours read the skin (§5.2).

### Notes — lane H (2026-10-25; the host: `main.js`; minimal touches to `cv-cords.js` / `cv-cables.js` / `cv-module.js` (the BACK end), `rig-ui.js` (the Amplifier's head), `sx-host.js` (the ENV swap), `cv-graph.js` / `cv-mods.js` / `cv-cost.js` (G13), `style.css`; `tests/canvas-WC-sim.test.mjs` and the moved pins)
- **What is wired** (§3.5, §8.2): a rig is always its modules (`sxParts` = `isRigDev`; **no lay flag** — `sxLayParts` no longer writes `ui`, a
  stored one is ignored; the rig's device entry carries `ui: 'parts'` + `wires: drawMode(t)` and its part entries `wires`); `sxPartList` =
  rig-core `partKeys` (I1 / I2 / I1' / the amp slot); every part module and the Amplifier mount rig-ui faces (`RIGUI.face`, the ordinal
  `dev.rig.n`), Arpeggiator / Clip (no WC-1 face) stage 3's view; widths rig-ui's `sizeOf` (before the panels load, its `faceW` restated —
  canvas-WC-sim pins them equal); titles rig-core `labelOf` ("Envelope 2"), the Amplifier "Amplifier", the FX panel "Effects"; the
  Amplifier's ⋯ (About, Replace with…, **Init**, Modulation list…, its panel's Preferences… / Info…, fold, front, Tidy — no Remove); a module's
  ⋯ (its face's items, Remove; Init on the amp Envelope = the gate); a Serum's ⋯ **Make it a <NAME>** (`setTrackModel(…, { keepLay, vals: adopt(s),
  preset })`: one step, the parts' old places kept, else Tidy's group; "Now a <NAME> · same sound · tap to undo", or the switch notes).
  **The first drop** of a module tile on any other instrument = `rigReplace` → `setTrackModel(iv, 'rig', { module })` (the blank, the module's ⏻ +
  auto-plug + ordinal, `sxLayParts` — [module] [Amplifier] [FX] [OUT] where the old instrument stood — one step "Replace <old>", "Replaced <old>
  with <NAME> · <module> · tap to undo"); **on a rig** = `rigAdd` (the first free slot, its ⏻, `AUTOPLUG`'s first standing target; an
  Envelope: the amp slot while it is the gate — plugged into LEVEL at Serum's envelope defaults — else the first of 2–4 nothing reads, shows
  or holds; meta `{trackId, dev, part, on, f}`; "Added <label> · tap to undo"); the rig tile on a rig = its starter as a preset-style load
  (one step with sxBack meta, "<NAME> starter · tap to undo"); + Track / the chip / `#rig` = the model's `defaults()` (the starter) laid out
  by Tidy's group (`sxPlaceNew`: a rig none of whose modules has a place gets `sxLayParts`, auto places, no step). **Remove**: an Envelope /
  LFO / Macros something reads refused (`WORDS.inUse`); the amp Envelope: `envFromAmp` first (the gate back) and its module goes; a Filter: its
  sources re-plugged where its OUT went (nothing silenced) and ⏻ off; any other part ⏻ off — one step each. **Init** = `rigInit()` with the
  preferences, a whole-state load (meta `f` = rig-core `diff`; the places of parts no longer in the state go in the step).
- **Every structural edit is `rigEdit`**: ONE History step, rig-core's `f` through the Serum host (`sxApply`: its panel undo has it too), meta
  `{trackId, dev, f}` (sxBack: undo / redo write the fields back — `sxSame` compares a whole-array leaf by value), `lay` renames (simultaneous;
  the ordinal follows: `dev.rig.n[to] = ordinalOf(from)`), `links` (track.mods sources), `ids` (canvas rows re-targeted, null dropped), then
  `pruneRig` — written only when it drops something (so a step that changed nothing stays History's no-op: review 1 F3 holds). The editors get
  **`o = { held, shown, used, rig, dev }`** (`held` = cv-graph `injectMods(…).inj` of the device's canvas rows).
- **The drawing modes** (§4.1, §4.7): `drawMode(t)` = 'cords' on a rig canvas (the hook's override, `?wires=`, the pref `synth.rig.wires`,
  `RIG.WIRES`), else 'lines'; `host.cables = { cords: cordOf, onRecords: rigRecords, cordSel, cordPoint, cordEnd, edges }`; `cordOf` = §4.1's
  table (the rig's internal records, its own rows, link rows from its modules' jacks; never Amplifier → FX, FX → OUT, a canvas modulator's or a
  preset row, a note line, a stub); `rigEdges` = rig-core `edges()` **filtered to records whose both ends are modules** (rig-core lists an off
  source's dim records: they would fan the jacks and fill the jack menus) and **the amp-slot cord's kind 'mod' → 'audio'** (int 'level' kept:
  [D] for lane K — as a 'mod' record cv-cables gave it an amount badge "+0%" and the ∿ modes; a `'level'` kind in rig-core would be cleaner).
  `rigRecords` → the layer: `set` (toCord: rig-core's colour / `dev.rig.cc`, the alphas 1 / 0.85 / 0.45 / 0.3, a knob end `s: 2`) + `anchors`
  (the ports copied + fanned `<jack>#<i>` 10 px apart in the records' order + the BACK ends) + the knob rings; leaving cords mode clears. The
  layer's buffer (`alloc`) on a cords canvas or a patch's; **`host.onRelay` and cv-patch's `cords` dep answer the patch canvas only**; `ptShow`
  sets `[]` on a canvas with neither (what `PATCH.sync` did before its dep went conditional — canvas-9-sim's Replace case) and runs on every
  model change to / from a rig. The drag (`modDragOpts`): `live`, `grab`, `cordLook` (the source's colour, **a round plug in the finger** — the
  BACK end once committed), `onPull` / `onRepatch` / `onRepatchMod` (rig-core pull / repatch, a mod row's knob end re-aimed: a canvas row one
  step, the rig's own matrix row the panel's own undo), `jackMenu` (rig-ui's), `cordHit`; `cordPress` stays `PATCH.press`. `sxCan` /
  `sxConnect` go to rig-core `can` / `plug` (lines mode's drags too); [D] `sxCable` is gone (`rigEdit` is the one step; §6 kept it for this
  re-pointing), with stage 3's own add / remove bodies (`sxAddPart` / `sxRemovePart` are `rigAdd` / `rigRemove`).
- **The BACK end** (the user's flip of first guess 3, §12): [C] cv-cords `s: 2` is now the BACK end — `dive(P, m, box)` (Liang–Barsky over the
  drawn polyline: the first stretch into the target's rect ends where it enters; every later point collapses there — the rope behind the
  panel; a source inside the box, a module onto its own knob, is drawn whole), applied in `put`, the SVG path, `pointAt` and `hit`; the plug
  instance at the drawn end is a **grommet** (shape 3 along a top / bottom edge, 4 along a side: rubber 20 × 8, its slot 13 × 2.6, a soft
  shadow, the selected ring) — the records without `box` / with `s` 0 / 1 write the bytes they wrote (P-1 (c) pinned, green). The host's anchor
  `back:<id>` = `rigEntry`: where the line from the source jack to the knob's centre meets the target module's rect (the smallest of the
  device's modules holding the knob; an `fx.*` knob its FX panel; the source inside: the outline point nearest the knob), cords into one edge
  ≥ 12 px apart; the record carries `box` (heights cached per render: a drag reads no layout). The badge: cv-cables' new `o.cordEnd(record,
  a, b)` → its point, END_PX past it toward the source (unfanned; a fanned grommet sits ≤ 6 px aside). The knob's ring: `data-rig-cord="<c>"`
  on its `[data-dest]` element (set at each claimed-set change, cleared when it goes), CSS in lane C's block (the cord palette, its black
  lifted to #8a8c90). Not done: a tap on the ring selecting the cord (the lead's "may"). Found on the screenshots: a selected Filter dimmed
  the cord into its back — cv-module's `touches` knew a mod cable's module by its `b` prefix only (`i1:` — the Amplifier); now a part whose
  `[data-dest]` index holds the knob touches it too (`inPart`, one line; stage 3's parts view gains the same; canvas-WC-sim pins it).
- **The kit's ENV moves** (§3.4): sx-host's `swapModuleUI` (Swap with ▸ and the label drag's plain swap) asks `host.envSwap(a, b)` when ENV 1 is
  a party (sxHost: `rigEnvSwap` — `envToAmp` while ENV 1 is the gate, one step; refused "Envelope <n> already shapes the level — pull it first"
  otherwise, n the amp slot's module's name — pre-deploy [amp-held]); Paste and the Alt-drag copy stay the kit's (no slot moves: fields in place); Init on the amp Envelope = `rigEnvInit` (the gate).
- **The Amplifier's head** (the lead's question): "↶ ↷" is the panel undo / redo (§3.5's knob policy — kept), **"0 / 400" was the kit's
  voice counter** (oscillator voices sounding / poly 8 × 16-voice unison × 3 oscillators + sub + noise: an engine number a rig's user cannot
  read) — **dropped from `FACE.amp`** (rig-ui, two lines; rig-ui.test pin moved); the "slider" is the output **meter** (§3.1 lists it) — kept.
- **`RIGUI === false`** (a loader without rig-ui: canvas-3-sim forces it with `cv.rig.setUi(false)`): stage 3's views stand in — no `wires`
  (stage 3's jacks), cv-cables' stage-3 internal records (`edges` answers null), cv-module's `cOpts` gates internal records by a device entry's
  `ui: 'parts'` too (one line); the rules stay rig-core's. So canvas-3-sim keeps testing the parts machinery; the faces / cords are canvas-WC-sim's.
- **G13** (the words): `sxFullWhy` → `WORDS.full`, `SX_OWN_MACRO` → `WORDS.ownMacro`, the resolver's refusals / labels (`WORDS.other`,
  `notPatchable`, "Oscillator 2 · OUT → Filter 2 · IN"), the bars, 'Serum FX (own)' → "Effects" on a rig, 'No such Serum' / 'Rendering needs a
  Serum track' neutral, the fallback 'the Serum' → 'the instrument'; cv-graph:224 (the own-FX refusal: the Serum keeps its words, a rig's
  neutral), cv-mods:531 (a link source's name: the model's), cv-cost:260 (each instrument by its model's name); the kit's texts a rig's dialogs
  show — the Info line `BUILD` (sx-ui-mod InfoPanel), the S1 tooltip (QualityPanel), a warp swap's S1 refusal (sx-ui-osc) — read
  `host.words` (sxHost: rig-core's `WORDS.build` / `WORDS.s1Tip` on a rig, null on a Serum: the bundled panel's words unchanged; one
  expression each in sx-ui-mod.js / sx-ui-osc.js); cv-modlayer's own-row tag and its "Move this cable into the …'s preset" read the device's
  name (a rig's own; a Serum's "Serum").
- **upgrade().notes** are shown with the split notices (one notice, " · ", 30 s; `early` before boot).
- **Hooks** `__synthTest.cv.rig` (§8.2 + `starter`, `tile`, `mode`, `cordOf`, `toCord`, `layer`, `cordsOn`, `ui` / `setUi`, `width` / `height`,
  `opts`, `envSwap` / `envInit`, `entry`, `cordEnd`, `menuLast`, `HEAVY`) and `cv.cordsOf()`; `cv.cords` stays the layer itself (canvas-9-sim and
  ui-bench-wc read it so) — not §11.1's `{ list, anchors, stats, hit }` object; `cv.layout()` not made (G11 is lane F's harness). ui-bench-wc's
  `rig.add(dev, kind, part)` / `plug(dev, a, b)` / `wires(mode?)` fit.
- **Pins moved by design**: canvas-3-sim (a rig is always parts: `uiOf` re-pointed; rig-core's part sets — + Filter 1 by I1', + Envelope 1 by the
  amp slot —; the rig's names and words; a tile on a classic replaces (undone in place); the P1-6 stub case → I1' + Remove re-plugs; stage 3's
  views forced), canvas-del-sim (names), main.test lane D (rig-core plug, its label), canvas-1e-sim / canvas-2a-sim (a Serum's ⋯ + Make it a
  <NAME>), cv-tray.test (the skin block's `.rig-drawer[data-cv-skin]` scope, lane F's ask), rig-ui.test (no voice counter), cv-cords.test (the
  BACK end replaces the tip: dive, grommet shapes, the SVG; the 900 Series' bytes unchanged), cv-cables.test (+ the `cordEnd` case).
- **Gates** (one file at a time, the whole sweep sequential after `node tools/precache.mjs --write`): 140 files, every one green — canvas-WC-sim
  19 / 19, main 47, canvas-sim 24, canvas-3-sim 25, canvas-del-sim 11, canvas-1e 24, canvas-2a 26, canvas-9 22 (and every other canvas-*-sim),
  cv-cords 40, cv-cables 58, cv-module 71, cv-tray 43, every cv-*, rig-core 14, rig-model 11, rig-sound 9, rig-ui 25, serum-ui 62, sx-host 21,
  graph-host 22, presets 2, presets2 4, integration 44, canonical-stream 1, every golden-* (classic 8, fx 3, presets 8, random 1, graph 6, …),
  lint 169, pwa 25, fonts 10; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.
- **Screenshots** (headless Chrome, a static server on a free port; the starter + an LFO onto CUTOFF and the Amplifier's LEVEL, Tidy, Fit, then
  a close-up on the Filter): desktop 1440 × 900 and iPad 1024 × 1366 touch — GL cords, the charcoal skin, the BACK ends' grommets on the
  Filter's right edge and the Amplifier's top, the rings on CUTOFF / LEVEL, the badges outside the panels (+50 % / +5 %), local fonts only.
- **Left for the reviewers / WC-2**: the cord drags at pointer level on a real page (lane C's tests drive them; the sim calls the drag's
  callbacks), G6 / G7 / G10 / G11 in Chrome (reviewer 2); cv-modlayer's "Add a Velocity module to see it" (the preset rows of §3.7, WC-2); MPE on a
  rig (midi.js pinned, the lead's note); the ring tap; a dedicated `'level'` kind for the amp cord in rig-core; the inspector's generic names (§13).
  Seen on the screenshots, not changed: a cord crosses the faces of modules **between** its ends (only its target's face is dived behind) —
  Tidy stacks the LFO in the Envelope's column, so ENV 1 → LEVEL runs down over the LFO's right edge, and LFO → CUTOFF sags across the
  Amplifier; Tidy's placement of mod sources (or a sag that routes round panels) is the cure, not the layer.

### Notes — fixer A (review 1) (2026-10-26; the rig's rules and host edits: `rig-core.js`, `main.js`, `rig-ui.js` (the MPE… fold, the Envelope ⋯), `sx-host.js` (one hook), `song.js` (one flag); `tests/canvas-WC-sim`, `rig-core`, `rig-ui`, `rig-model`)
Every finding's repro ported first (canvas-WC-sim's six "review 1 …" cases, rig-core's "review 1 (fixer A)" case, rig-ui's two, rig-model's
moved pin) and seen failing on b050ddd; then the fix.
- **P2-1** (Remove a Filter the other Filter feeds: audible with no cord) — `rigRemove` re-plugs the feeding Filter's `<other>.out` where the
  removed one's OUT went, like a source; **I1' extended** (rig-core `partKeys`, the safety net): a Filter stands whenever a powered source
  **or the other Filter** routes into it, that one powered or itself fed by a powered source (serum-dsp passes an off Filter's input on, so
  Filter 2 ⏻ off fed by an oscillator still sounds through Filter 1). No factory preset changes (the reviewer's walk: no powered Filter routed
  into a module-less one; rig-core's 19 / 30 counts hold).
- **P2-2** (`plug` without `pull`) — `rigRemove` now, for every cord into the removed Filter in edges() order: `RC.pull` it (a fork's branch →
  the balance all to the other Filter; a sole cord → None), then `RC.plug` the sole ones to `to` (its OUT's target; `voice.main` when it had
  none — lane H's "nothing silenced" default kept), each applied to the state before the next. B2: the fork keeps its Filter 2 branch
  (`a.fbal` 1); A2: Oscillator 1 lands in Filter 2 and Filter 1 is gone (never in `partKeys` after); both symmetric cases too — canvas-WC-sim
  checks the ends, the module set, one step, a level before and after, undo exact.
- **P3-1** — `rigEnvInit` = `rigEdit('Init Envelope n', envFromAmp(s, rigOpts))`: the module stays unplugged at the first free slot, its name
  and values kept, the notice "Envelope n unplugged · the keys gate the level again"; no free slot → envFromAmp's refusal. **Found on the
  way**: an Envelope face's ⋯ had **no** Init / Copy / Paste / Swap / Lock at all (EnvPanel's shell has no module, so `shellItems` was
  empty and rig-ui used EnvPanel's own items — main's Init wrap never matched); rig-ui's env face now lists the kit's `moduleMenuActs`
  (§8.2) before its own items (Lock once, no doubled separator). The kit's **Init Module** on ENV 1 from any menu (a knob's too) asks the
  new `host.envInit()` (sx-host, beside `envSwap`): a rig → `rigEnvInit`; the gate (Envelope 1 standing, read) → "The keys gate the level —
  nothing is plugged into LEVEL", no step (the kit's Init would have made it a real envelope).
- **P3-2** — `rigColour` refuses a pick that changes nothing (`normRig` equal: no step); `History.record(project, label, force)` (song.js,
  additive: `force` pushes even onto an equal top) and main's `rigStep(label)` = `record(…, true)` → the step when it returned true: `rigEdit`
  / `rigAdd` / `rigRemove` / `rigLoad` each get their own step after any no-op (a same-name rename, a no-op hook step) — their label and meta
  never land on the no-op. canvas-WC-sim: a plug, an add, a remove and Init after `hist.record(P(), 'Nothing')`, one undo each.
- **P3-3** — rig-core `repatch` composes its two editors' renames (`compose`: x ↦ B(A(x)), each key once, identities dropped) for `lay`,
  `links` and `ids`, and the second editor reads the first's renames (`moved`: `shown` / `used` / `rig.n` renamed — the stale `used` had made
  envToAmp keep the gate's values at slot 3 when a link row had read Envelope 1). `done()` accepts an empty `f` with a non-empty `lay` (equal
  fields: the modules still swap places and names) and `rigEdit` takes such a lay-only result (no `sxApply`, no meta: History's snapshot holds
  lay / rig.n / mods). The host's `rigStruct` keeps its Map (each list's keys are unique now — the contract's "simultaneous").
- **P2-3** (the lead's decision) — §13 "MPE is the Serum's in WC-1": midi.js untouched (B2 holds); the Amplifier's drawer: MPE… disabled,
  `title` and a one-line `.rig-dhint` = `WORDS.mpeLater` ("MPE on a Wavecraft arrives in a later update"); `applyPrefs(s, prefs, rig)` keeps
  `mpe.on` off for the starter and Init (models.js' Serum defaults unchanged). **Pin moved**: rig-model's prefs case (the rig's `mpe.on` 0,
  the Serum's 1).
- **The observation** (re-dropping Envelope 1 on LEVEL while it stands as the gate) — `can(…, o)` takes `o.used`: `env1.out → voice.level`
  while the gate **and read** (a row, or a link row) is "Already connected" (nothing rewritten); plug / repatch pass their options; the host's
  three `can` callers pass `{ used: sxUsed }`. An Envelope **tile** then (Envelope 1 standing) gives Envelope 2 at the first free slot 2–4
  (`rigSlot`: the amp slot only while the gate has no module).
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 25, rig-core 15, rig-sound 9, rig-model 11,
  rig-ui 26, main 47, canvas-3-sim 25, canvas-del-sim 11, canvas-sim 24, canvas-9-sim 22, canvas-1e-sim 24, canvas-2a-sim 26, cv-cables 58,
  cv-module 71, cv-migrate 72, jackrules 13, sx-host 21, serum-core 86, serum-ui 62, midi 34, app-midi 16 (midi.js byte-identical), lint 169,
  golden-classic 8, fx 3, presets 8, random 1, graph 6, drums 5, 606 11, 909 9, sdsv 5, moog 6, moog-b 6, moog-c 4, canonical-stream 1, pwa 25;
  `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". The new tests fail on b050ddd (canvas-WC-sim 6,
  rig-core 1, rig-ui 2, rig-model 1). No DSP file in the diff.

### Notes — fixer B1 (review 2) (2026-10-26; `cv-module.js`, `rig-core.js`, `main.js`, `rig-ui.js` (the jack menu's notices), `tests/ui-layout-wc.mjs`; `tests/canvas-WC-sim`, `cv-module`, `rig-core`, `rig-ui`, `canvas-3-sim`)
Every finding's repro ported first (the commit before the fix: canvas-WC-sim 7, cv-module 4, rig-core 4, rig-ui 2, canvas-3-sim 1 fail on
a7717f0, nothing else does); fixer B2 has the cords themselves (cv-cables / cv-cords, `cordAnchors` / `toCord`, the badge and ×, the knob
ends) — untouched here.
- **P1-1** (the first drop's dead jacks) — cv-module `measureInline` keeps `dirty` while the anchor is not in the body yet (`!a && !hide`: a
  hidden pad is looked for once, never per drag frame), and `sxViews` calls `cvRemeasure(t.id, dev)` whenever it mounted a face (renderCustom's
  async build sets the mode itself, so its remeasure branch never ran; a module added later the same). Headless Chrome, all three sizes: right
  after a tray tap on a Juno every `.rig-jack` carries `data-cv-jack` / `data-kind cord` / `tabindex 0`, the layer's anchors are 0.0 px off the
  jack centres, a real drag OUT → DIRECT plugs ("Plug Oscillator 1 · OUT → Amplifier · DIRECT · tap to undo").
- **P2-1 / P3-4** — a rig's own row is a cord: `sxOwnConnect` → `rigOwnConnect`, the badge re-aim (`rigRepatchMod`) and the pull
  (`modCableAct` disconnect: the ×, Delete, the drag-off, the menu) go through `rigRowEdit` → `rigEdit` (one step, meta `f` = the row's fields,
  sxBack; "Modulate Filter Cutoff with LFO 1 · tap to undo", "Re-patch LFO 1 → Filter Res …", "Cord pulled · tap to undo"); the mod layer's
  parameter list takes the same path; a Serum complete keeps its panel undo (it has no own-module jacks on its canvas). rig-ui's jack menu: every
  edit ends "… · tap to undo" (its notes when it has some; `commit` also takes a lay-only result — fixer A's equal-field slot move). Chrome:
  a real drag LFO 1 → CUTOFF is one step, ↶ takes it and leaves the step before it.
- **P2-2** — `rigEdges` maps rig-core's `tag` to the record's `label` (cv-cables draws it: above the IN plug of a cord, above a line); the
  "dry" text is in the DOM and shown in both modes.
- **P2-5 (the user's rule)** — §3.6 rewritten: cv-module `tidy(…, opts)` → `rigLay` on a rig only (`opts.targets` from main's `rigTargetsOf`
  = rig-core's new pure `targetsOf(s, parts)` + the link rows; `opts.narrow` = the world's band taller than wide); every other canvas runs the
  old code unchanged (cv-module test: a classic, a Serum, stage 3's parts, a 900 Series identical with and without opts; ref-WC record
  green). The view's own Tidy (modules with no place) gets the same opts (`host.tidyOpts`); `sxLayParts` passes the faces' heights and the
  opts (the first drop's group); `sxSpot` → `rigSpot` on a rig (a tapped add never moves a module: a modulator at the free band spot nearest its
  target, none → the band's left end; a chain module at its row slot when the gap holds it, else under its left neighbour — stage 3's spot
  made room by moving modules right). Measured with review 2's metric (`WC-R2/tidyproto.mjs` CROSS) on the real app, `B1/tidy.mjs`:
  | scene | 1440 × 900 | 1366 × 1024 | 1024 × 1366 (wrapped) |
  |---|---|---|---|
  | S1 starter + LFO 1 → CUTOFF | 0 · fit 50 % | 0 · 47 % | 0 · 42 % |
  | S2 2 Envelopes, 2 LFOs, Macros | 0 · 43 % | 0 · 40 % | 0 · 34 % |
  | S3 §9's full rig (18 cords) | 1 · 26 % | 1 · 25 % | 1 · 25 % |
  S3's one: LFO 1 drives OSC A and OSC B WT POS, so it sits over Oscillator 1 (the left-most rule); its cord into Oscillator 2's back enters
  that module's left side (the BACK entry is the line source → knob, B2's) and sags over Oscillator 1's corner. canvas-WC-sim measures the
  same three numbers in node: the ropes settled with cv-cords' own `seed` / `step` / `smooth` / `dive` / `along` (the sim's SVG layer draws
  the motion-off parabola, which hangs less — it counted 3 for S3), and stand-ins for the kit knobs and Macros tiles the stub DOM does not
  build (at their layoutOf cells).
- **P2-6** — `rigReplace` → `rigShow`: `world.fit({ ids: [module, Amplifier, FX], animate })` — the visible band less an open Sources tray.
  OUT is left out (it stays where the replaced instrument's stood, often far right: framing it too gave 31 %). Chrome, the tray open: the
  group inside 240 … 1440 at 64 % (desk), 240 … 1024 at 54 % (portrait).
- **P3-2** — no subtitle on a rig module's bar (`cvTitle`; the Amplifier keeps "Wavecraft"); the bar title is rig-core's new `barOf`:
  "Sub osc" for the Sub oscillator (a 3-column bar leaves the title 84 px; "SUB OSCILLATOR" is 104), every other text keeps "Sub oscillator".
  Noise fits once the subtitle is gone (37–44 / 84 px).
- **P3-6** — rig-core `LOOK.c.noise` 7 → 4 (Cream; every rule colour ≥ 3 : 1 on the charcoal case and face, a rig-core test; §4.5 amended).
- **P3-8** — `tests/ui-layout-wc.mjs`: the page links `/__fonts.css` (fonts.css with absolute urls; the Inter pass without its Archivo
  Narrow face, the narrow pass with it — the bundled file unless `--narrow <file>`), a probe checks each pass measured its face (stack
  252 px Inter / 211 px Archivo Narrow), d at dpr 2, and each face's bar is cv-module's (⏻ slot, stripe, `barOf` title, ⋯, ▾) with a
  clipped-title check. **G11 green at 1440 × 900, 1366 × 1024 and 1024 × 1366, both fonts** — the Inter pass is tighter (osc text 15.8 px
  apart, the Amplifier's text 14.6 from its edge / 10.2 apart, the envelopes' 10.8) but inside every §3.8 minimum. Sheets
  `scratchpad/B1/g11/wc1-faces-*.png`.
- **Pins moved by design**: cv-module's "(WC, §3.6) Tidy" (the new lay), rig-core's LOOK / cordColor (Noise 4), rig-ui's jack-menu notices
  (every edit, once), canvas-3-sim's own row (now one History step on a rig).
- **Seen, not changed** (for the lead / B2): the amp cord leaves Envelope 1's OUT (its right column, over the Amplifier) and runs down the
  Amplifier's right column to LEVEL — a cord into a bottom jack from the band crosses its own target's face (the metric excludes ends); in
  portrait the Amplifier → Effects *line* (cv-cables' horizontal tangents) loops back over the Amplifier's lower right to the FX panel under it.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 32, cv-module 74,
  rig-core 18, rig-ui 26, rig-model 11, main 47, canvas-sim 24, canvas-3-sim 25, canvas-del-sim 11, the Tidying sims canvas-1e 24 / 2a 26 /
  8 17 / 9 22 / 9b 14 / M 20, canvas-1i 20, cv-cables 58, cv-cords 40, cv-tray 43, cv-migrate 72, jackrules 13, sx-host 21, serum-ui 62,
  graph-host 22, integration 44, rig-sound 9, fonts 10, lint 169, pwa 25, every golden-* (606 11, 909 9, classic 8, drums 5, fx 3, graph 6,
  moog 6, moog-b 6, moog-c 4, presets 8, random 1, sdsv 5), canonical-stream 1; `tests/ref-WC/record.mjs`: "the record matches base.json
  (114 fixtures, 5 sessions)". No DSP file in the diff.
- **Screenshots** (headless Chrome, GL cords, the starter + LFO 1 → CUTOFF + Envelope 2, after Tidy, fit and the band close up):
  `scratchpad/B1/shots/B1-{d,p}-starter-lfo-env2-{tidy,band}.png` (1440 × 900 mouse, 1024 × 1366 touch).

### Notes — fixer B2 (review 2) (2026-10-26; the cords: `cv-cords.js`, `cv-cables.js`, `cv-module.js` (two lines), `main.js`'s cord layer / anchors / rings / badges, `style.css`'s cord block; `tests/cv-cords`, `cv-cables`, `canvas-WC-sim`, `ui-bench-wc(.test)`)
Every new case was seen failing on a7717f0 first (cv-cords 2, cv-cables 6 — one an old pin moved by design —, canvas-WC-sim 1, ui-bench-wc's
RIGX); then the fix. Fixer B1 (the host: first drop, mod-row History steps, the dry tag, Tidy, reveal, bar titles) worked in parallel: none of
that is touched here.
- **The user's change (2026-10-26, §12 item 3, §13)** — a socket-less modulation cord goes **to the knob it modulates**. cv-cords `s: 2` is
  now the **KNOB end** (the edge grommet, `dive`, `box`, `backShape`, `boxOf` gone): the rope ends exactly at b — the host's rim point —, no
  plug; the end instance (shape `3 + endU`, the drawn rope's last heading in turns, packed in the existing float) shades the rope's last
  `KNOB.SHADE` 7 px (black → 0.55 at the rim) and lays the knob's ring (the cord's colour; black lifted to the ring CSS's #8a8c90) across its
  end, so the ring passes over the rope; the rope's last point carries `KNOB.FLAG` 16 in its vertices' sel float → `ke`, and the shadow pass
  fades with it (no shadow cast on the knob). Records with `s` 0 / 1 write the bytes they wrote (P-1 (c) pinned, green); the SVG fallback:
  butt caps and the two bands, turned along the end. The host (`main.js` `rigLayer`): the knob's **disc** (cv-module `localDest` now also
  measures a knob control's direct `.wk-svg` child: `kx / ky / kr` in cords mode — its centre is not the control's, whose label hangs below;
  lines keep `x / y`, W7) — the anchor `knob:<id>` is on its rim where the **settled rope arrives radially** (`rigAim`: the drawn rope's last
  segment heads along (dx, dy − 32/9 · sag), three iterations); several cords onto one knob are spread **≥ 40°** apart round it (`rigSpread`:
  cut at the widest gap, clusters merged, each centred on its cords' own angles) and the knob wears a **segmented ring** (`data-rig-ring`,
  `--rig-ring` a conic gradient whose segments face their cords, 2° gaps; `--rig-rx / ry / rd` the disc measured once per element — CSS
  `.wk-knob[data-rig-ring]::after`); one cord: the ring as before. A hidden / folded knob's end stays the bar corner (the tag badge).
- **The badge** (the user's "visible and pressable"; review 2 P2-3, P3-7): cv-cords `top()` — a world-space `div.cv-cords-top` after its
  canvas in `#viewport`, moved with the camera at every `draw()` (#world's transform; hidden until a camera is known; `will-change` in a
  camera burst like #world), pointer-events none but for its children — holds a claimed mod row's badge, a claimed cord's **×** and a
  claimed fork's **BAL** (cv-cables `o.top`, asked only when one is made: no element on a canvas without cords; `--ik` copied from #world at
  each layout / zoom). Its place: cv-cables' `onRecords(records, ports, k)` may now answer `{ badges, forks }` and the claimed badges go
  there (`data-at="c"`, centred; left out → the old rim rule); the host walks back along the settled rope from the rim (8 screen px steps,
  on the cord, else ± beside it) to the first place whose **44 px hit** covers **no control** — `[data-dest]`, buttons, canvases (the
  Filter's display), inputs / selects, roles button / slider / switch / combobox, jacks, module bars — measured once a render per module
  (`rigCtl`) — and no badge placed before it (`rigBadge`, in the records' order); a place is kept while its cord's ends, the zoom and its
  width stay and its box stays clear (a module drag re-places only what moved or what it slid under). `o.cordEnd` / `rigEntry` /
  `rigCordEnd` are gone. Measured: one relayout of `rigX` (43 cords, 32 badges) 0.3 ms median on the M4.
- **P1-2** (an Envelope's OUT dragged onto LEVEL refused): the reviewer's guess holds for a **moved** Envelope — pulled off LEVEL, Envelope 1
  goes to a free slot (`envFromAmp`: `i1/env2.out`), whose jack the drag's `port()` (the view's `intPort`) has no port for. cv-cables' cord
  drag now asks the host with the **jacks themselves** for a rig cord input in a mod output's drag (`checkCord`, `cordPort(j) = portOf(j) ||
  j`; `onConnect` / `onRefuse` likewise), and a refused one shows the host's reason ("An Envelope only"-like words — the old knob hint
  "Drag a modulation cable onto a knob" pin moved by design). canvas-WC-sim pins the host's side (pull → the slot move, `port` null,
  `canConnect` / `onConnect` by jacks, one step).
- **P2-4, the regret path** (lines mode): the rig's lines take the **group colour** (`rigEdges` adds the device's colour, else the track's,
  in lines mode — §4.7); every rig jack a line arrives at or leaves wears a **ring in its line's colour, one per line** (`--rig-lines`,
  concentric with dark gaps: a Σ input's count reads; CSS `.cv-jack.cv-fjack[data-rig-line]`, the patching rings win); a press on a plugged
  rig input **grabs its most recent line's end** (cv-cables `lines(j)`: the internal records at it, unclaimed) — dropped on another input
  `o.onRepatch` (rig-core repatch, one step), let go elsewhere nothing (a line's rule; its × removes it).
- **P3-1 / P3-7** (fanned plugs, badge collisions): `<jack>#<i>` fans **32 px** apart (a plug's 28 + air; past three a second row 30 px
  above); a fork's BAL sits right of its fan (host place). Badges never overlap (above). **P3-3**: the jack under the finger counts whatever
  its direction — an output dropped on an output is refused there with the host's reason in the chip ("Two outputs — connect an output to
  an input") and the release says it; a grabbed cord let go on an output is refused, never pulled.
- **P3-9 (G7)**: `RIGX.own` is 32 rows (the scene holds **43** cords) and its plugs are ones AUTOPLUG has not made (Oscillator 2 forked into
  Filter 2, Filter 2 → DIRECT: no refusal notes); `cordBar.reached` records the 40-awake budget. Headless Chrome 155, metal, dpr 2, 1440 ×
  900 frame, `ui-bench.html?wc=1&auto=1`: **1×** juno / rig1 / rigX P+; rigX sway **43 awake: step 0.109 ms / draw 0.017 ms** (≤ 0.35 /
  0.08 ✓), amp drag P+ (0 frames > 33), the 60 s sweep P+ (3 603 burst frames, 0 > 33, **0 context losses**), buffer **2880 × 1702 =
  18.7 MB** (rig1; §9 / §13 corrected from 13.4), juno 0 × 0 (W7). **4×** all P+ (rigX sway 43 awake step 0.40 / draw 0.06). **6×** juno / rig1
  P+, rigX **fail** (p95 33.3: pan 9, pinch 9, amp 29, sway 8 frames > 33) — **the base build fails the same 43-cord scene alike** (a7717f0
  with this bench: pan 9–10, pinch 10–14, amp 30, sway 9–10); with review 2's 18-cord scene this build is **P** at 6× as the base (amp
  22 vs 17 frames > 33, pan 4 vs 1, pinch 8 vs 10). Found on the way and fixed: re-walking every module's DOM for each ring each relayout
  (12 ms → a per-render element cache), and badges re-placed every frame of a drag (a validated place cache). Not recorded in bench.json
  (informational; the lead's).
- **Browser** (own no-store server, free ports; real CDP pointer / touch drags; `scratchpad/WC-B2/flow.mjs`, `lines.mjs`, `look.mjs`,
  `closeup.mjs`): at 1440 × 900 mouse and 1024 × 1366 touch dpr 2 — Envelope 1 pulled off LEVEL by a drag (to `env2`), its OUT dragged back
  onto LEVEL: the chip "Amplifier LEVEL", plugged; LFO → CUTOFF by a drag: the anchor on CUTOFF's disc rim (≤ 1e-14), the rope's end there,
  the ring, the badge in the top layer, the topmost element at its centre, covering no control at k 1 and 0.5; the badge dragged onto RES
  re-targets; three cords into Filter IN Σ 32 px apart, none over its label; a tap on a cord → its × topmost (above the rope), its tap pulls;
  Oscillator 1 OUT onto Oscillator 2 OUT: chip + notice "Two outputs — connect an output to an input"; `?wires=lines`: lines in the track
  colour, the plugged jacks ringed, a drag from the plugged Filter IN → DIRECT re-patches; no console error. Shots (`scratchpad/WC-B2/shots/`):
  `close-c1.png` / `close-c2.png` / `close-c2p.png` (one / two cords into CUTOFF at 200 %), `look-b-filter-k1.png` (two badges apart),
  `F-d-*` / `F-p-*` (knob, × , fan, out-on-out), `L-d-rings.png` / `L-p-rings.png`.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): cv-cords 41, cv-cables 62, cv-module 71,
  cv-world 79, cv-patch 31, canvas-WC-sim 26, canvas-9 22 / 9b 14 / 9c 3 (the Moog's cords byte-identical: P-1 (c) and their pins), every
  canvas-*-sim (sim 24, 1e 24, 1i 20, 2a 26, 2b 23, 3 25, 7a 23, 7b 15, 7c 13, 8 17, M 20, P 8, SC 15, del 11, tab 8), main 47, lint 169, pwa 25,
  ui-bench-wc 5, cv-tray 43 and the 50 other files importing these modules (integration 44, canonical-stream, canvas-M-bounce, golden-graph,
  golden-presets, golden-moog-b, serum-ui, rig-core / ui / model …) — all green; `tests/ref-WC/record.mjs`: "the record matches base.json (114
  fixtures, 5 sessions)". No DSP file in the diff.
- **Left**: the "dry" tag (B1's) is an SVG label in #world — a rope can lie over it (the top layer is there if wanted); a knob's long cord
  over a dense face hides labels on the way (§13; B1's Tidy shortens it); the fan cannot keep a cord coming up from below off its jack's
  label.

### Notes — integration fixer L (review WC-int) (2026-10-26; layout, camera, tray: `main.js`, `cv-module.js` (`rigLay`, two exports), `cv-tray.js`, `wk.js` (one export); `tests/canvas-WC-sim`, `cv-module`, `cv-tray`)
Base 907f832. Every item's test was committed failing first (3db1ca2; run against the base sources too: the seven new canvas-WC-sim cases, the
two new cv-module cases and the moved pins all fail there), then the fix. Lane K (in parallel) has cv-cables / cv-cords / rig-ui and main's
`rigFan` / `rigBadge` / `rigAim` / `cordAnchors` — untouched here; **B1 (S3's red gate) is lane K's**: S3 still measures the base's 2 crossings
(S1 0 · S2 0 hold, the gate unchanged).
- **B2** (tapped modules out of sight) — a tapped `rigAdd` (and a drop the clear moved) asks `rigReveal`: once its face is up, `modShow` (the
  modulators' rule: a pan at the zoom it has into `W.band()`, the tray, minimap and toolbar excluded). `sxDropClear` clears a drop to the
  **nearest** free spot up or down (a tie: the old way) — an LFO dropped over the Effects panel's foot goes under it, not 400 px up.
- **B3** (a new rig framed on one entry point, too early) — one deferred camera request (`rigCam`: `rigFrame` / `rigReveal`, the newest wins)
  polled a frame at a time until the rig's faces are up (`rigFacesUp`: no switch mounting, no panel due, every module holding its face; 60
  frames at most), then `W.fit` over every `iN` / `iN/*` module (OUT left where the old one stood, as review 2's rule). Called from all four
  entry points: the <NAME> tile on another instrument (`cvDropInstrument`), a module tile's Replace (`rigReplace`, `rigShow` gone), ⋯ → Make it
  a <NAME> (`rigConvert`), and a new track — `cvCamRestore`'s default camera on a rig is the whole rig (a jump, kept as the untouched default:
  re-derived on resize, not stored), which covers + Track's starter, a module tile's new track (B4) and a rig track never shown.
- **B4** ("+ Add a track…" mode) — `partPick` passes the tray's mode (as `moogPick`): in track mode a module tile makes a NEW track holding a
  <NAME> that starts from that module (`rigNewTrack` → `addTrack(rig, {s: rigBlank}, {module})` → `rigFirst` inside addTrack's one step), the
  tray back to replacing; `sxPartsDecor` greys for the track a tap would change (track mode: none; `srcModeUI` decorates again); a module tile
  dragged onto the track list makes one too (cv-tray's part tiles take `over: 'tracks'` with "+ New track", as a Moog tile; `sxPartDrag`).
- **P3-3** (Envelope 1's cord over the Amplifier's ▾) — `rigLay`: after the band's clusters, Envelope 1 on the amp slot whose OUT would stand
  over the Amplifier steps right until its OUT is `RIG_AMP_AIR` 48 px beside the Amplifier's right edge (`ampEnvCentre`; `RIG_JACK` 48: a face's
  outer jack cells, §3.8 — rig-ui's cells pinned equal by canvas-WC-sim) when the band has room; a cluster that already holds it beside, or
  no room, keeps its place (S2's cluster: unchanged). `rigSpot` wants the same for a tapped Envelope onto the gate. The settled rope (cv-cords'
  own) now hangs beside the Amplifier and comes into LEVEL from the side: 0 samples over ▾ / ⋯ / the face above the jack row (sim and Chrome).
- **P3-5** (Tidy) — on a rig's canvas Tidy says "Canvas tidied · tap to undo" (its tap undoes the step; already tidy: no step, no notice) and
  frames every module once laid (`rigFrame` all: OUT, canvas modulators, Pads too). A rig wider than the band at the 25 % floor is framed
  centred and clipped at both sides (P3-4).
- **P3-8** (the tray's words) — the <NAME> view has its own intro: on a <NAME> "Tap a module to add it to “…”, plugged in, or drag it where you
  want it. <NAME> loads the starter rig (tap to undo). …"; on any other instrument "Tap a module to replace the … on “…” with a <NAME> holding
  it, or <NAME> for a starter rig that plays — …". Note tools: "The <NAME>’s Arpeggiator and Clip sequencer arrive in a later update." (§7;
  cv-tray's pin moved with the words).
- **P3-11** (the portrait Amplifier → Effects line looping under the Amplifier) — the narrow wrap's FX row starts a grid step right of the
  Amplifier (`gup(amp.x + amp.w + DOT)`), so the line leaves OUT rightward and comes into the FX panel's IN from the left: no sample inside the
  Amplifier (cv-module samples cv-cables' `cablePath`; Chrome samples the drawn path). Cost: the portrait rig is 320 px wider — the starter's
  portrait Fit 36 % (≈ 42 % before); recorded with P3-4.
- **P3-4** (the portrait Fit floor) — not changed (the user's one-row rule): §13 and §12's "ask after the hands-on" list.
- **P3-18** (merge leftovers) — `rigArgs` (records, ports, zoom never read) → the flag `rigLaid`; a rig's own row pulled by its cord
  (`rigPull`) leaves the notice to `rigRowEdit` — "Cord pulled · tap to undo" written once, not twice; the knob-disc finder is the kit's
  `wk.discOf` (main's ring measure and cv-module's knob ends; cv-cables' `discEl` is lane K's file — it can call `wk.discOf` the same way).
- **Seen, not changed** (not in this lane's items): in iPad portrait with the Sources tray open the "· tap to undo" notice sits over the canvas
  toolbar's Fit / Tidy / Lock for its 8 s — a tap meant for Tidy right after an add taps the notice and **undoes the add** (headless Chrome
  1024 × 1366: `#notice` is the element at Tidy's centre; `scratchpad/WC-L/shots/dbg-p-before-tidy.png`); in landscape it overlaps the
  toolbar's right end. Worth a placement fix (above the toolbar, or clear of it) before the iPad pass.
- **Browser** (own no-store server, free port; headless Chrome; real CDP mouse at 1440 × 900, touch at 1366 × 1024 and 1024 × 1366 dpr 2;
  `scratchpad/WC-L/verify.mjs`, `fitp.mjs`): all three sizes ALL PASS — the Wavecraft tile on a Juno with the tray open (every rig module 1.0
  in view, k 49 / 46 / 33 %), the starter's rope off ▾ / ⋯, the tray's words, five tapped modules each 1.0 in view at the zoom they had, an
  LFO dropped over the Effects panel's foot under it and in view, Tidy's notice and framing, the rope after Tidy, the Amplifier → Effects line
  never under the Amplifier (portrait wrap included), "+ Add a track…" → the Oscillator tile (a new <NAME> track, every tile live, framed), →
  the <NAME> tile (a new track's starter framed), the Filter tile dragged onto the track list (a new track), an Oscillator tile's Replace
  framed after its faces mounted, ⋯ → Make it a <NAME> framed; no console error. Shots `scratchpad/WC-L/shots/L-{d,l,p}-*.png`.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 39 / 40 (S3 only — lane
  K's B1, the gate unchanged), cv-cables 62, cv-cords 41, cv-module 76, cv-world 79, cv-tray 43, rig-core 18, rig-ui 26, main 47, canvas-sim
  24, canvas-3-sim 25, canvas-9-sim 22, canvas-9b-sim 14, lint 169, pwa 25; also cv-shell-sim 17, canvas-1e 24 / 1i 20 / 2a 26 / 2b 23 / 7a 23
  / 7b 15 / 7c 13 / 8 17 / 9c 3 / M 20 / M-bounce 1 / P 8 / SC 15 / del 11 / tab 8, wk 101, rig-model 11, rig-sound 9, ui-bench-wc 5,
  serum-ui 62, sx-host 21, integration 44, golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6 — green;
  `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.

### Notes — integration fixer L, round 2 (2026-10-26; after the fix checks: B3, P3-11, P3-18 judged not fully fixed at 762310a)
Each item's tightened test was committed failing first, then the fix: 695f26d (B3 upright "never below READ_K" k 0.306, P3-11 "the FX under
the Amplifier" and the routed line, P3-18 cv-cables' `wk-svg`) → effaacc; 2bc4c12 (B3 what matters whole: the upright starter's Envelope 1
at 0.93, a grown rig losing its Amplifier; cv-world's fit focus; P3-18 one measure the callers agree on — a disc spilling out of its control
ringed where the cord ended at the control) → the fix after it. Files: `main.js`, `cv-world.js` (fitCam / fit `focus`), `cv-module.js`,
`cv-cables.js` (lane K's — two small hunks: `wrapPath` + the `o.route` hook, the disc aim), `wk.js` (`discBox`); `tests/canvas-WC-sim`,
`cv-world`, `cv-module`, `cv-cables`.
- **B3** — the check found every new <NAME> (and an untouched rig track) opening below READ_K (49 / 46 / 33 % with the tray open): its knobs
  asleep, a press panned. `rigFrame`'s fit now has `kMin: READ_K` (cv-world fitCam's floor, the 900 Series default's rule) and a **focus**:
  whole when the rig fits at 50 %, else at 50 % holding what matters whole — `rigFirstKeys`: the module just added (`o.lead`, a module tile's
  Replace), else the chain's start (the left-most module on the Amplifier's row: no modulator, not its FX); the Amplifier; its Envelope 1 —
  and the rest from the rig's left (cv-world `fitCam(…, { focus })`: a floored side keeps its start, then slides the least that holds the
  focus whole, pad clear; centred when it fits only with less air; its start when it does not fit — the 900 Series' fit hook and every other
  fit unchanged: no focus). Centring the focus instead was weighed and not taken: in iPad landscape it shows under half of the Effects panel
  against 90 % (blank canvas left of the chain instead). Headless Chrome, tray open: desktop the starter whole at 50 %; iPad landscape Effects 90 %,
  upright 61 % (the chain, the Amplifier and Envelope 1 whole); a grown rig (two LFOs at the band's left end, its default camera as a
  duplicated track) upright: the LFOs slide out, the Amplifier and Envelope 1 whole (the start rule alone left the Amplifier out); an
  Oscillator tile's Replace whole above it (64 / 60 / 54 %). A drag on Filter 1's cutoff right after the tile, the new track and the grown
  rig turns it at all three sizes (touch on the iPad sizes; no pan). Minor 2 (a slow device's late fit jumping under the finger): a press,
  wheel or pinch on the canvas while the faces mount drops the request, and a finger still down on the canvas when they are up drops it too
  (a track switch builds its canvas after the press that follows it) — `rigDown` (pointerId → its time; lifted anywhere: gone; 8 s at most).
  Tidy stays an overview (`o.all`, no floor, as the toolbar's Fit).
- **P3-11** — the check found the moved FX row cost the portrait wrap its width (the starter's upright Fit 42 → 36 %; a 6-module rig past the
  25 % floor). Reworked: the FX row is back under the Amplifier (review 2's pin restored; the wrap saves the Amplifier + a GAP, pinned) and
  the line is ROUTED — cv-cables `wrapPath(A, B, src, dst, obst, out)` (pure: out of OUT rightward, down `out` beside the module, along the gap
  between the rows, into IN from the left; corners `WRAP_R` 24; null when IN is not under-left of OUT or a module stands in a run or the gap)
  behind the line layer's new `o.route` hook (cv-module passes the host's `cables.route`); main's `rigRoute` answers for a rig's `iN.out →
  iN/fx.in` only, `out` = 2 × `RIG_AMP_AIR` (96: beyond Envelope 1's cord — P3-3 hangs it 48 beside the Amplifier; one crossing by OUT, 17 of
  201 rope samples within 24 px of the line, all at the crossing), on the modules' rects with their heights read once a render (`rigRectOf`,
  the badges' cache — the route is asked every frame of a drag; one row: no walk at all). The label point is the gap run's middle; the
  layer's box takes the route's x span. Every other line keeps its one cubic and no other canvas answers the hook (ref-WC record unchanged).
  Upright Fit after Tidy 42 % again (2232 world px wide; headless Chrome 1024 × 1366: the line routed, nothing of it inside a module).
- **P3-18** — the check found three knob-disc finders (cv-module's knob ends — the cord's rim and its badge —, main's segmented rings,
  cv-cables' aim of a cord dragged onto a knob), each measuring the disc its own way (only cv-module's required the disc inside the control:
  a disc spilling out got the ring and the aim while the cord ended at the control). Now ONE measure: `wk.discBox(el)` — `discOf`'s box when
  it has a size and lies inside the control's (±0.5 px), else null (the control stands for it) — called by all three (`discOf` itself is
  called nowhere else). Tests: canvas-WC-sim (the rim / badge centre and the ring's `--rig-rx / -ry / -rd` on the same disc of a kit knob
  whose disc sits over its label; a spilling disc: neither — seen failing on the old ring), cv-cables (the drag's aim: the disc's centre, a
  spilling disc and no disc: the control's), and the three files call `discBox` and find no disc of their own. Headless Chrome, a real kit
  knob with two cords at 100 %: the disc, the rim's centre and the ring's centre all (560, 244) r 20, the rim anchors 20 from it.
  canvas-WC-sim's `geometry()` now puts the stub kit's disc inside its 40 × 40 control, as the kit draws it (the stub's default box sat at
  the client's origin: fixer B2's segmented-ring case had read that box for the ring while the cord ended at the control — the very
  disagreement; its assertions unchanged).
- canvas-WC-sim counts its History steps by identity (`since(u0)`): History keeps 200 and the file now fills it, so a length difference read 0.
- **The WC bench re-run on this tree** (review WC-int's leftover: B2's numbers were measured before Tidy's rework; G7, `tests/ui-bench.html
  ?wc=1&auto=1`, headless Chrome, metal, dpr 2, sweep off): **1×** juno / rig1 / rigX P+ (rigX sway 43 awake: step 0.15 ms / draw 0.014 ms,
  amp 0 frames > 33); **4×** juno / rig1 P+, rigX P+ in three runs of four (one P), the Amplifier drag 19–26 frames > 33 against the base's
  (907f832) 18–19 with the same bench (the route first read every module's height each drag frame: 23 / 26 — now `rigRectOf`'s, 22 / 19),
  sway step 0.44–0.51 ms (base 0.44–0.53). Not recorded in bench.json (informational; the lead's).
- **Browser** (own no-store server on a free port, headless Chrome via CDP, killed after; real CDP mouse at 1440 × 900, touch at 1366 × 1024
  and 1024 × 1366 dpr 2; `scratchpad/L3/check3.mjs`): ALL PASS at the three sizes — B3 on the six entry points above (k, what matters, the
  knob drag), P3-11 (upright routed / one row plain, nothing inside a module), P3-18 (the real knob's disc, rim and ring); no console error.
  Shots `scratchpad/L3/shots/L3-{d,l,p}-*.png`.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 40 / 41 (S3 only — lane
  K's B1, the base's same 2 crossings, the gate unchanged), cv-cables 63, cv-cords 41, cv-module 76, cv-world 80, rig-ui 26, main 47,
  canvas-sim 24, lint 169, pwa 25; also wk 101, canvas-9-sim 22, canvas-9b-sim 14, canvas-3-sim 25, cv-tray 43, ui-bench-wc 5, rig-core 18,
  cv-shell-sim 17, canvas-1e 24 / 1i 20 / 2a 26 / 2b 23 / 7a 23 / 7b 15 / 7c 13 / 8 17 / 9c 3 / M 20 / M-bounce 1 / P 8 / SC 15 / del 11 /
  tab 8, rig-model 11, rig-sound 9, serum-ui 62, sx-host 21, integration 44, golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1,
  golden-graph 6 — green; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.

### Notes — integration fixer L, round 3 (2026-10-26; after the second checks: B3, P3-11 judged not fully fixed at 357068e)
Failing tests first: 30b5989 (B3 over five keyboard-up / short bands: at 357068e Oscillator 1 0.36 in view under a 1200 × 439 band; P3-11's
upright LFO on Reverb MIX: Envelope 1 pushed off its P3-3 place) → 97ffd85; then, after this round's own Chrome for Testing check, 455d4d3
(the head both floored sides hold: cv-world's fitCam ty 301 against 157, canvas-WC-sim's two split views) → the fix after it. Files:
`cv-world.js` (fitCam's focus), `cv-module.js` (rigLay's narrow band), `main.js` (comments: `rigFirstKeys` is the priority list); tests
`cv-world`, `cv-module`, `canvas-WC-sim`. The headless checks moved to Chrome for Testing (`.claude/test-browser`, its own profile in the
scratchpad — the user's rule since 2026-10-26); the scratch harness's old path to the user's Chrome is gone.
- **B3** — the second checks found the keyboard row (up by default) pushing the chain under the minimap and the toolbar: the focus box ran
  from Envelope 1's top to the chain's foot (575 px at 50 %) in a 439 / 544 px band, so `hold()` showed its top corner; and on short screens
  (960 × 600, 1194 × 760, …) Envelope 1 or empty canvas instead of the chain. Now `rigFirstKeys` is a PRIORITY list and fitCam's focus takes
  the longest head of it that fits a floored side — the head BOTH floored sides hold — centred, slid back only so far that no blank canvas
  opens past the rig's edge (the pad kept), the first one's start when even it does not fit; `fit` passes the focus ids in their order.
  Chrome for Testing, the tray open, real CDP mouse (1440 × 900) and touch + pen (1366 × 1024, 1024 × 1366, dpr 2), the keyboard row up and
  hidden, eleven entry points (the tile tapped / dragged, + Add a track… with the tile / the Oscillator tile, ⋯ → Make it a <NAME>, an
  Oscillator / Filter / LFO tile's Replace tapped, the Oscillator tile dragged, an untouched rig switched back to, a grown rig duplicated)
  and a rotation each way: 541 / 541 pass — never below 50 %, the head whole and uncovered, a first drag on each of its knobs turns it with
  no pan. Keyboard up: desktop the chain row whole (Oscillator 1 1.0, was 0.36), Envelope 1's lower 32 %; iPad landscape the chain whole,
  Envelope 1 77 %; upright all three whole. The short screens and split views, keyboard up (the tile, a new track, an untouched rig switched
  back to, the Oscillator tile's Replace): 960 × 600 / 1194 × 760 / 1133 × 744 the chain's start's top-left and its upper knobs (awake; at
  1194 × 760 the Amplifier and Filter whole), 1280 × 800 / 1194 × 834 the chain's start and the Amplifier whole, 504 × 1366 the start alone,
  678 × 1024 the start centred (it sat at the band's foot under blank canvas before 455d4d3: the third check's own find); all pass, but 720
  × 450 (a desktop at 200 %, band 480 × 120) where the start's upper quarter shows and turns (a new track; the tile on a Juno could not be
  reached — next).
- **Seen, not changed** — at 720 × 450 with the keyboard row up the Sources tray shows only its intro: the tiles under it were out of reach
  for the harness (scrolled into view, tapped: the Juno stayed); a tray layout matter for a tiny window, worth a look with the tray pass.
- **P3-11** — the second check found the FX row under the Amplifier costing Envelope 1 its place upright: a modulator driving a knob on
  Effects wanted the panel's centre — over the Amplifier — joined Envelope 1's cluster and pushed it left (its cord through the Amplifier's
  bar and face: 44 / 47 of 81 samples). Now upright such a modulator (its left-most target in the wrapped row) never joins the clusters over
  the chain: it stands right of the Amplifier's slot — past every band module (Envelope 1 at its P3-3 place) and past the Amplifier →
  Effects line's run (2 × `RIG_AMP_AIR`) — flowed left → right in its wants' order; a tie (a modulator on the Amplifier and on Effects) is
  the chain's module's, as wide; one row: unchanged. Chrome for Testing, starter + Reverb + Delay, an LFO on Reverb MIX / Macros on Delay
  MIX (the check's two; the cord set by the API when the drag missed — Tidy and Fit by real taps): upright Envelope 1 at 1056 with its OUT
  48 right of the Amplifier, its rope 0 / 81 samples over the Amplifier, the LFO at 1472 / Macros at 1472, no rope inside a module not its
  end, the Amplifier → Effects line routed with nothing of it inside a module, the rig 2232 world px and Fit 42 % with or without the
  modulator (no width spent); landscape unchanged (the FX right of the Amplifier, the plain line). A third such modulator widens the
  upright rig by 360 px (§13).
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 41 / 42 (S3 only — lane
  K's B1, its same 2 crossings, the gate unchanged), cv-cables 63, cv-cords 41, cv-module 77, cv-world 80, rig-ui 26, main 47, canvas-sim
  24, lint 169, pwa 25; also canvas-3-sim 25, canvas-9-sim 22, canvas-9b-sim 14, cv-tray 43, wk 101, rig-core 18, ui-bench-wc 5,
  cv-shell-sim 17 — green; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.
  Scripts and shots: `scratchpad/WC-L4/` (`check2.mjs`, `harm4.mjs`, `h2.mjs`; `shots/fix-*.png`, `p311-*.png`).

### Notes — integration fixer K (2026-10-26; the go / no-go review's cords, jacks and badges: `main.js` (the rig's cord layer: `rigLayer` and its helpers `rigShape` / `rigAim` / `rigPack` / `rigOrder` / `rigFans` / `rigBadge`, new `rigJackAt` / `rigFanHits` / `rigLabels`, `rigRecords`, the drag's `jackAt`), `cv-cords.js`, `cv-cables.js`, `rig-ui.js` (the jack's hit), `style.css`; `tests/canvas-WC-sim`, `cv-cords`, `cv-cables`, `rig-ui`, `cv-tray`)
Every item's test was committed failing first (dc166f0: canvas-WC-sim 6 — S3 among them —, cv-cords 4, cv-cables 3, rig-ui 1, cv-tray 1), then
the fix (7af4592 and the commit after it). Lane L's items (B2–B4: tapped adds in view, framing, the new-track tiles) and their functions are
not touched; the one shared line is cvRender's cache clear (`rigLabInfoC` beside `rigCtls`).
- **B1 (S3 ≤ 1, the gate unchanged)** — the fan's order, not its width or Tidy: `rigOrder` gives a fan's cords the plugs on which their ropes
  at rest cross the fewest faces (any module but their ends', 3 px in, by the drawn rope's segments — a corner clipped by 8 px counts; ×2)
  and each other (every order up to five cords, pairwise swaps past that; a tie keeps the order it had). S3's Amplifier IN Σ: Filter 2's
  cord on the left plug (its own module never counts), Filter 1's in the middle, the Sub's on the right — nested, no rope over Filter 2:
  canvas-WC-sim S3 = 1 (the accepted `o:i1:1 × i1/oscA`), S1 0, S2 0; headless Chrome, a real Tidy, the drawn ropes once asleep: the same
  1 at 1440 × 900, 1366 × 1024 and 1024 × 1366. (Ordering by source x was the reviewer's worse case; Tidy's `rigLay` is unchanged.) The
  sim's recorder answers the layer's `shape()` as the browser's GL layer does (the settled rope, `restPath` at High) — the host plans on
  what the layer draws; the measure has always settled the GL rope.
- **B5** — `cv-cables` asks the host what a cords-mode press is on (`o.jackAt(el, p, k)` → `{ el, rec }`): `rigJackAt` gives the nearest of
  the module's jack centres and fanned plugs, an input's plug naming its own record; `pressCord(e, el, rec)` grabs that record (the most
  recent stays the default at the jack itself). Chrome, all three sizes: Oscillator 2 auto-plugged beside Oscillator 1 at Filter IN Σ, a
  real press on each plug dragged to DIRECT moves that plug's cord (`B5-*` shots). The plug-order counter (the review's "can follow" half)
  is not added: the default grab is still the last in `edges()` order.
- **P2-1** — `cv-cords rest()`: the Studio rope's settled shape, the hanging chain of its length in N − 1 equal links (tension solved:
  bisection on ln h, bracketed Newton on c — 6 µs), within 3.5 px of 1 200 Studio steps on every chord tested (the parabola missed by
  tens of px 20–30° off the vertical); a chain that cannot hang taut (near-vertical: its fold goes slack) from 300 Studio steps. The
  layer's `shape(a, b, out)` is its rope at rest for those ends (that, smoothed, with motion; the parabola still / reduced / SVG); a record
  with `rest: true` (every rig cord) is seeded asleep at rest (`seedRest`), so a project that opens still shows the shape the badges were
  placed on — the 900 Series' records carry no `rest`: their bytes as before (P-1 (c) green). `rigAim` iterates on that shape; `rigBadge`
  walks back along it (cut at the rim, below) and a beside place is offset by the **visible** 18 px badge, not the 44 px hit (the hit box
  still keeps every control clear). Chrome: every claimed badge 0–3.2 screen px from its drawn rope at k 1 and 0.6, all sizes.
- **P2-2** — the knob end's anchor carries its disc (`kx / ky / kr`); cv-cords `clip()` cuts the drawn rope where it first enters it (the
  points after it collapse onto the rim point: the strip keeps its vertex count; the end instance and the shadow's fade move there; GL,
  SVG, `pointAt`, `hit`). `rigAim` keeps the last angle whose rope stays off the face, else the one toward the source. LFO → MIX straight
  above (Chrome, k 2): the rope ends on the rim, nothing inside the disc (`P2-2-*-knob-200`).
- **P2-3** — `rigJackAt` resolves a press on a jack to the nearest centre or plug of its module within max(22 screen px, half the column);
  **(the skeptics' round)** the zoom-scaled hit (`max(64 world px, 44 screen px)`) is gone — the face (`.cv-body`: overflow clip, contain)
  cut it to 12–16 px right of / below the edge jacks at Fit, and at 50–60 % it covered the switch / knob row above (a tap on OSC 1 opened a
  plug menu, a MASTER turn re-patched a cord); lines mode's overlapping circles went to the later jack. Now a jack's own hit is the grid's
  44 px circle (a pill over a fan: `--rig-fw / --rig-fx`, `rigFanHits`) and **cv-world `setJackNear(fn)`** asks the host for a press on no
  jack (never in a glide): main.js `rigNearJack` — the empty canvas, a rig module's sleeping face (all of it), an awake face where no
  control is (`RIG_CTL`) — answers the nearest rig jack within the same reach (`rigNearest`, shared with `rigJackAt`), past the face's edge
  too; another module's body keeps its press; both drawing modes. Chrome, pen / mouse (no touch adjustment, as WebKit) at Fit (1024 × 1366
  k 0.29, 1366 × 1024 k 0.35, 1440 × 900 k 0.37): every direction of LFO 1 / Envelope 1 / Oscillator 2 OUT starts its cord to 21 px and pans
  at 26 (right of and below the face included); between DIRECT and NOTE the nearer; the three flows one undo step each (18 px left of LFO 1
  OUT onto CUTOFF, 12 px right of Oscillator 2 OUT onto DIRECT, 18 px below Oscillator 1 OUT onto Filter IN). At 0.5 / 0.55 / 0.6 OSC 1,
  SUB and MONO toggle at 2 px above their bottom, a drag from MASTER's value line turns it (−9.3 → 0.0 dB, no cord); lines mode at Fit: a
  press on MAIN / DIRECT / NOTE is that jack's (the base's). The row above each jack row is the controls' at 0.5–0.7 but for bare cell
  padding (`K3-p23/sweep.mjs`). **At 25 / 35 / 55 / 100 %** (each jack centred; the mouse at 1440 × 900, a pen at 1366 × 1024 and
  1024 × 1366): 4 × 168 presses a size round LFO 1 / Envelope 1 / Oscillator 1 and 2 OUT, Filter 1 IN, DIRECT, LEVEL (± x, ± y, 10–36 px),
  each judged against the rule (a jack's own element → it; an awake control → its own; else the nearest rig jack within max(22, 32 · k)
  screen px; else no cord): all as the rule but the Amplifier's bar under Envelope 1 at 25 % (a bar keeps its press at every zoom: the
  module's handle) — 22 px at 25–55 %, 32 at 100 %; 26 / 10 awake presses on a switch / knob kept theirs at 55 / 100 %
  (`K4/reach.mjs`). Every free point within reach at 55 / 100 % (each rig face, 2 px grid): no element with a press listener of its own —
  only the face's root (the Serum part's select) and the module body (`K4/ctl.mjs`, CDP `getEventListeners`). The three flows again by
  pen / mouse and by touch: one undo step each.
- **P3-6** — `rigPack` lays a jack row's fans in the row between its fixed jacks (empty or one-cord) and the face's 16 px edges, each as near
  centred on its jack as its neighbours let it (pool-adjacent), 32 px apart, squeezed to ≥ 16 where short; no second row. S3's Filter 1
  IN Σ (four): 2320 … 2416 on the jack's line inside 2304 … 2656, none on the OSC 1 switch; a claimed cord's tag ("dry") sits above its own
  plug (`onRecords` answers `ends`; cv-cables `places`).
- **P3-7** — cv-cables' long-press / right-click "Which cord?" asks the host's `jackMenu` first: the tap's menu (Which cord? ▸ each cord's
  Pull · Re-patch to ▸ · Colour ▸). Chrome: long-press at 700 ms on the iPad sizes, right-click on the desktop.
- **P3-9** — the cords-mode chip wraps (`data-wrap`; style.css: up to 360 px or the screen less 16, `text-wrap: pretty` — balance left a
  third of the box empty) and stands 27 px over the finger **by its own height** (read once per text, else estimated); **where there is no
  room above** (its top would pass the overlay's 4 px: near the canvas top, under the top bar) **it flips 27 px below the finger** — never
  slid over it (the skeptics: `translateY(-100%)` after a clamp of its bottom hid it under the top bar within ~60 px of the canvas top; a
  clamp of its top alone laid it across the finger's own row, over the jacks it heads for); left of the finger where the right has no
  room; whole inside the overlay either way. The drop outline's label wraps **at words only** (`overflow-wrap: break-word` split "OSCI /
  LLAT / OR"), a word wider than the outline ends in … (the `max-height` of that commit — 2408b94 — sliced the last line through its
  letters: **round 1** below). Chrome, a real drag from Oscillator 1's
  OUT onto the Amplifier's LEVEL (refused, two lines) and IN (one line) with the target 14 / 40 px under the canvas top, 24 px from the
  bottom, the left and the right edges, the four corners and mid-screen — 1440 × 900 mouse, 1366 × 1024 and 1024 × 1366 touch (the view
  locked: the touch edge auto-pan, P3-16, otherwise carries the jack away): 60 / 60 whole inside the overlay, below the finger at the top
  (gap 27), above elsewhere (27–28), left of it at the right edge, never over it, nothing cut (`K4/chip2.mjs`); Oscillator / Sub / 921 /
  Prophet-5 tiles at 25–100 %: no split word, never past the outline (Sub at 25 %: "+ / SUB / OS… / · A / WA…").
- **P3-9, round 1** (the skeptic: 2408b94's `max-height: calc(100% - 16px)` on the wrapped label is no whole number of 13.2 px lines, so
  on every canvas a small outline's last line was cut through its letters — Bend at 28 % "+" over half a "BEND", Aftertouch at 30 % "AFTE"
  halved, Bend at 25 % only "+", the lines past it gone with no …): **whole lines only**. cv-world `placeGhost` counts the lines the seen
  part of the outline holds (`GL_LH` 13.2: 11 px at 1.2; under the 8 px top, 3 px clear of the bottom border; dy / dx of a box larger than
  the canvas taken off) — ≥ 2: `data-lines` + `--gl-lines` (style.css: wrapped at words, `display: -webkit-box; -webkit-line-clamp`, the
  last line ending in …, a word wider than the outline too); 1: the base's own rule, byte for byte (`white-space: nowrap`, …); a box too
  short for two under the 8 px top (below 40.4 px: the iPad's Fit zoom) centres them 1 px clear (`data-lift`, its middle the inline top,
  `translate: 0 -50%`) — so a 32 px Bend at 25 % reads "+ / BEND" (the base "+ B…"), a one-line label there sits where the base's did;
  the label as wide as the outline less the dx it moved (`maxWidth`: never past its right edge); written only on a change. The chip
  (minor notes): a finger's or a pen's flip near the canvas top goes below and **left** of it, `CHIP_CLEAR` 44 px clear (below-right is
  where a right hand rests; right only where the left has no room, 44 clear), a mouse's stays below-right of the cursor; its box is read
  again when the overlay's width changed (Slide Over between two drags: `chipSz` keyed by it). Tests first: cv-world "the drop outline's
  label in WHOLE lines" (13 sizes: Bend at 25 / 28 %, Aftertouch at 30 %, Note at 25 %, a 24 px box, boxes past the band's left and top),
  cv-cables P3-9 (a finger / a pen / a mouse near the top and in the corners, the width-keyed read) — both red on 2408b94's sources.
  Chrome for Testing 156, headless (`scratchpad/WC-K/K6/ghost.mjs <d|l|p>`: real drags of the ten Modulators tiles over a Minimoog track at
  25 / 28 / 30 / 35 / 50 / 100 % and the seven Wavecraft part tiles at 25 / 30 / 50 %, 1440 × 900 mouse, 1366 × 1024 and 1024 × 1366
  touch, dpr 2): 0 lines cut by the label's edge, no split word, never past the outline (Bend at 25 / 28 % "+ / BEND", Aftertouch at 25 %
  "+ / AFT…"; `shots/gh-*`); `K6/chip3.mjs` (mouse; touch and pen with the view locked, both iPad sizes): the chip as the rule at every
  edge and corner, 0 off it (a finger's or a pen's top flip below-left, 44 px clear; a mouse's below-right, 26). Gates (one file at a
  time, after `precache --write`): canvas-WC-sim 39 (S3 ≤ 1, the gate unchanged), cv-cables 65, cv-cords 45, cv-module 74, cv-world 81,
  rig-ui 27, main 47, canvas-sim 24, lint 169, pwa 25; `tests/ref-WC/record.mjs` matches (114 fixtures, 5 sessions). No DSP file.
- **P3-9, round 2** (the skeptic: round 1's fallback — the left side no room, so 44 px right of the finger — then clamped by the
  overlay's right edge pinned a finger's top-flipped chip to that edge in any overlay under ~816 px: the iPad mini's 744 px portrait put
  "Amplifier LEVEL — Only an Envelope shapes the level" at 380 … 740 with the finger at 372, all of it under a resting right hand; 2408b94
  had it at 4 … 364): cv-cables `chip()` — a finger's or a pen's flip goes right of it only where the right **holds** the chip 44 px
  clear, else as far **left** as the overlay lets it (x 4); a mouse's rule unchanged (§13: the narrow canvas). Test first: cv-cables P3-9
  (744 / 694 px overlays, a finger and a pen mid-top, measured 330 and estimated 360 wide: x 4, 27 px under; a mouse at 744 right of the
  cursor, at 694 x 4) — red on 2271c3c (`translate(410px, 39px)`). Chrome for Testing 156, headless, real CDP drags from Oscillator 1's OUT
  to the Amplifier's LEVEL (refused, two lines) and IN, the target 14 / 40 px under the canvas top, in both top corners, mid-screen and
  24 px over the bottom (`scratchpad/WC-K/K7/chipH.mjs`, the skeptic's probe with the rule "left 44 clear, or x 4 where neither side
  holds it"; touch with the view locked): 744 × 1133 and 694 × 1000 touch (12 placements each), 744 pen, 1440 × 900 mouse, 1366 × 1024 and
  1024 × 1366 touch, 1024 × 1366 pen (18 each) — 114 / 114 whole inside the overlay, never over the finger or its jack, nothing cut, no
  console error; 744 top: 4 … 364 (8 px left of the finger), 694: 4 … 364 (2408b94's place); the full sizes as round 1 (a finger below-left
  44 clear, a mouse below-right 26). Gates (one file at a time, after `precache --write`): canvas-WC-sim 39 (S3 ≤ 1, the gate unchanged),
  cv-cables 65, cv-cords 45, cv-module 74, cv-world 81, rig-ui 27, main 47, canvas-sim 24, cv-patch 31, lint 169, pwa 25;
  `tests/ref-WC/record.mjs` matches (114 fixtures, 5 sessions). No DSP file.
- **P3-12** — `rigLabels`: where a rope of a jack's own (at rest) crosses its label line, the label is lifted above the cords — a
  `span.rig-jl-top` in the layer's top (under the badges), the label's words (KEYS in its span, struck while LEVEL is plugged) in the face's
  colours, at the jack's centre 20 px down; a label no rope of its jack crosses gets none. Chrome: "IN Σ" (the Amplifier's, Filter 1's) and an
  Envelope's "OUT" lifted; the LFO's "OUT" between its two fanned ropes needs none (`P3-12-*` shots).
- **P3-13** — the plug shader keeps index 1 (0.85, a rig's own row) at 1 for a plug; the rope and its knob end stay 0.85; the SVG fallback
  sets 0.85 on the strokes and the knob end, not the plug (cv-cords' fixer-B2 pin "o as the group's opacity" **moved by design**).
- **P3-14** — style.css `.cv-tscroll .cv-tiles { overflow: visible; overscroll-behavior: auto; }` (every grid in the scroller, not only its
  direct children: the module tiles and the Modulators sit in sections). Chrome: the wheel over a module tile scrolls the tray (desktop
  120 px, a touch swipe 201 px at 1366 × 1024; portrait has nothing to scroll).
- **P3-1 / P3-2 (lines mode)** — recorded in §13, not fixed (each is a change to cv-cables' line drags or badges on every canvas).
- **Cost** (S3's rig, headless Chrome at 4× CPU, 100 relayouts): at rest 0.43 ms a relayout (base 0.20), the Amplifier moved 3 px a step
  0.77 ms (base 0.40) — the order and a label's verdict are kept while their ends stay within 24 / 12 px, a fan keeps its order while a
  module is in the finger (one relayout once the drag is over: `rigOrderLater`), aims are cached to the px. ui-bench `?wc=1&auto=1&sweep=0`:
  1× juno / rig1 / rigX P+; 4× all P+ in total, rigX's Amplifier drag 26–29 frames > 33 of ~100 (base 18–21 of ~105: that phase is over the
  bar at 4× on the base too); rigX sway step 0.45–0.58 ms (base 0.40–0.50: run-to-run noise of the same physics).
- **Browser** (own no-store server, a free port, real CDP mouse / touch; `scratchpad/WC-K/k.mjs <d|l|p>`, shots in `scratchpad/WC-K/shots/`):
  every check above at 1440 × 900 (mouse), 1366 × 1024 and 1024 × 1366 (touch, dpr 2), and a real drag of the Amplifier by its bar 200 px
  and back (S3: the fan keeps its order in the finger and has the same one at rest); no console error.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 38 (S3 1, the gate
  unchanged), cv-cables 65, cv-cords 45, cv-module 74, cv-world 79, cv-tray 44, rig-core 18, rig-ui 27, main 47, canvas-sim 24,
  canvas-3-sim 25, canvas-9-sim 22, canvas-9b-sim 14, canvas-9c-sim 3, cv-patch 31, ui-bench-wc 5, rig-model 11, canvas-1e / 2a / 2b / del / M
  24 / 26 / 23 / 11 / 20, integration 44, golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, lint 169, pwa 25;
  `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.

### Notes — WC-1 merge fixer, L × K (2026-10-26; `main.js` `rigPack`, `tests/canvas-WC-sim`)

- **The red case** after the merge (0fb5b03): L's P3-18 "its end on the same disc's rim" — `knob:o:i1:1` `{x: null, y: null, kx 596, ky 260,
  kr 18}`. The disc was right (L's `wk.discBox` → cv-module's kx / ky / kr, the ring's `--rig-rx / ry / rd` all agreed); the **source** was
  not: the LFO's OUT holds three cords in that case (CUTOFF, LEVEL, Y), so K's fan packs its plugs (`rigFans` → `rigPack`) inside the
  LFO's face — and the case's stub geometry never measures a jack (the default box: the LFO's OUT port at (50, 2), off its face at x −416 …
  −64). `rigPack` places only the fans inside its walls (the face's span ± RIG_FAN); one off them never got an `x0` → its plugs `x NaN` →
  `rigAim(S …)` NaN → the knob end NaN (and no badge). L alone drew a centred fan there; K's own cases measure every jack (`rigGeometry`).
- **Fix** — `rigPack` starts every item at its centred place (a fixed jack its own x, a fan centred on its jack, RIG_FAN apart): a fan in no
  room keeps it, as a folded module's (`rigFans`' `centred`) — never NaN. A jack on its face (the real DOM) packs as before.
- **Test first** — canvas-WC-sim's P3-18 case gains "every drawn end a point" (each record's two anchors finite) before the rims: red at
  0fb5b03 (`o:i1:0 i1/lfo1.out#0: a point ({"x":null,"y":2})`), green with the fix; no test or gate loosened.
- **Browser** (Chrome for Testing, own no-store server on a free port, real CDP mouse / touch; `scratchpad/WC-MF/mf.mjs <d|p>`, shots in
  `scratchpad/WC-MF/shots/`), 1440 × 900 mouse and 1024 × 1366 touch: a real drag of the LFO's OUT onto CUTOFF (mid-drag the live rope's
  end on the disc's centre to 0.01 px — cv-cables' aim via `wk.discBox`), the row made; after Tidy at k 1 and 0.6 the end on the rim (error
  0), the layer's disc = the DOM `.wk-svg`'s centre and radius on screen (0 px), the drawn rope ends on the rim, no rope point inside the
  disc, the knob's ring in the cord's colour, the badge on the drawn rope (0 px off, 18 px high); then the LFO's OUT fanned (a second cord to
  MIX) and a Macro onto CUTOFF: every end finite, both knob ends on their rims, the segmented ring at the disc (`--rig-rx / ry / rd` 32 / 24
  / 40 px = the measured disc), the badges on their ropes (0 / 2.7 px); no console error. (The LFO straight over CUTOFF: its rope's slack
  fold is cut where it first meets the rim, 15 px round from the aimed end — K's rule, unchanged.)
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 48, cv-cables 66,
  cv-cords 45, cv-module 77, cv-world 82, rig-ui 27, rig-core 18, main 47, canvas-sim 24, canvas-3-sim 25, canvas-9-sim 22, canvas-9b-sim
  14, lint 169, pwa 25; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.

### Notes — pre-deploy fixes (2026-10-26; the final pre-deploy check of WC-1 at 9b35ade: 1 blocker, 3 of its minor findings: `main.js`, `cv-tray.js`, `cv-cables.js`, `rig-core.js`, `cv-art.js`; `tests/cv-tray`, `cv-shell-sim`, `cv-cables`, `rig-core`, `canvas-WC-sim`, `cv-art`)

- **[toast] (the blocker)** — the 8 s "· tap to undo" notice (`.notice`, centred over `#perf`, `bottom: calc(100% + 24px)`) lay on the canvas
  toolbar's row, which moves right past the open Sources tray: a tap meant for Fit / Tidy landed on it and **undid** the last step (portrait,
  tray open: Fit, Tidy, Lock, Minimap covered; landscape: Lock, Minimap, ∿; desktop: ∿; it also overlapped the keyboard grip's coarse box by 8 px).
  **Fix**: `cv-tray.noticeSpot(o)` (pure; `NOTICE_GAP` 12, `NOTICE_MAX` 620, `NOTICE_MIN` 200, `NOTICE_LIFT` 24) — the rooms in order: beside
  the toolbar on its row (its centre line, lifted clear of the grip's box), above the row right of the minimap (the toolbar's left without
  one) — the toolbar's foot, which a fit keeps clear of modules —, above both (centred past the tray); of the rooms touching none of the
  toolbar (row, fold button, page-zoom chip), the minimap, the grip, the open tray or its tab, the fewest lines wins (a room above both counts
  1.5 more: two lines in the foot beat one over the canvas), the earlier on a tie. No toolbar (the roll): centred, `NOTICE_LIFT` over the
  stage's foot, lifted clear of the grip. `main.js noticePlace()` measures the boxes (the tray's and its tab's place when the glide ends:
  `offsetWidth`; the grip where it rests on the keyboard tray's edge; the foot from the stage, never from a tray still gliding) and writes
  the inline `left` / `bottom: calc(100% + Npx)` / `max-width` / `transform: none` on every `showNotice`, again on `sideChanged` and from one
  `ResizeObserver` (`#stage`, `#cvToolbar`, `#srcTray`, the minimap: a window, a tray's height, the toolbar folded or the chip, the canvas
  hidden, the minimap toggled, the tray sized). The stylesheet's rule stays the fallback (cv-shell-sim's text pin). The notice stays in `#perf`
  (z 25): tappable, its tap still undoes.
  **Tests first**: cv-tray "noticeSpot" (the boxes Chrome measured at 1024 × 1366 / 1366 × 1024 touch and 1440 × 900 mouse, tray open and shut,
  three notice widths: clear of every box, no button centre covered, inside the stage, beside the row on one line; the long line, the chip,
  no minimap, a 390 px phone, the roll) — red: no export; cv-shell-sim "the notice line is placed off the canvas toolbar" (stub boxes: beside
  the shut-tray toolbar lifted clear of the grip; placed again when the tray opens; a tap on it undoes; the roll centred) — red: no inline spot.
  **Browser** (Chrome for Testing, own no-store server on a free port, real CDP touch / mouse; `scratchpad/WC-pd/tools/toast.mjs <p|l|d>`, shots
  in `scratchpad/WC-pd/shots/`): at 1024 × 1366, 1366 × 1024 and 1440 × 900, with the notice showing, every toolbar button's centre, the
  minimap, the tray tab, both grips answer `elementFromPoint` themselves and the notice touches none — tray open and shut, keyboard up and
  folded, toolbar folded and unfolded, minimap off; Fit tapped within the 8 s fits (the add stays), Tidy tidies (the add stays), a tap on
  "Canvas tidied · tap to undo" undoes the Tidy exactly. Spots: portrait / landscape tray open x 679 (beside the 667 px toolbar), shut x 439
  (lifted 12 px clear of the grip in portrait); desktop x 611 / 371.
  **Recorded limit**: in the roll the notice sits centred over the roll's foot as before (now clear of the grip) — over the velocity lane's
  bottom 30 px; unchanged in kind, not the toolbar's.
  **Round 2 (the skeptic: not fixed at narrow iPad widths with the tray open)** — none of the three rooms clear in a 375 window (Slide Over,
  a 1/3 split; a 390 phone): the stylesheet's spot over the tray, the toolbar's fold button (its centre hit at 390) and both grips; 639 with
  the tray pulled to 440: the same; 678 with the tray at 440 and the keyboard pulled taller: "above both" on the tray's tab (its centre hit:
  a tap meant to shut the tray undid); a 700 × 500 window: the track list's rows (its Master row) run over the stage's top and the line went
  under them. **Fix**: `noticeSpot` falls back to a **free column** — at a foot (the last room's, over the top of each thing, the toolbar's
  foot, the stage's top), the widest span the band of the line's height crosses nothing in (each box cut out `NOTICE_GAP` either side), at
  least `NOTICE_FLOOR` 96 px wide (else 48), centred in it, the fewest lines, the lowest on a tie; no column at all: the same with the
  minimap given up (the chrome least tapped right after an add or a swap); only with none even then, the last room. `o.fit(maxW)`:
  `noticePlace` measures the line at each width tried (its real wrap carries whole words down — a line more than need / width), `o.top`:
  the track list's grip; the stage is taken from where it shows (under `#topRow` / `#arrbar` / `#studio` / `#mfoot`); `.notice`
  `overflow-wrap: break-word` (a word too long for a narrow column). The three rooms and their spots are unchanged.
  **Tests first**: cv-tray "round 2" (the boxes Chrome measured at 375 / 390 / 639-440 / 678-440-keyboard-taller: clear of the toolbar,
  minimap, grips, tray, tab, top grip, no button centre, inside the stage, ≥ 96 px; a lossy measured wrap for 296.8 and the 572 px
  piano-roll line; 700 × 500 at 440: the minimap given up, nothing else; the iPad / desktop spots the same measured) — red: no
  `NOTICE_FLOOR`, `null` at 375; cv-shell-sim "round 2" (375 tray open by the measured wrap; a tap undoes; 700 × 500: under the track
  list's rows) — red: the stylesheet's spot, then the line at 66 over the Master row.
  **Browser** (`scratchpad/WC-pre3/tools/sweep.mjs`, one fresh profile a size, the tray at 240 then pulled to 440 at 1366 and the window
  narrowed; `toast.mjs`, `harm*.mjs`): clear (no chrome centre on the notice, no chrome box under it, inside the stage, never the tray, the
  track list) at 375 × 1024, 390 × 844, 639, 678, 768, 981 × 1024, 820 × 1180, 1024 × 1366, 1180 × 820, 1366 × 1024, 900 × 600, 700 × 500
  (tray 240), the keyboard pulled 150 px taller at 639 / 678 / 1024 / 1366, mouse 1440 × 900, 1280 × 720, 1024 × 640, 800 × 600 — tray open and
  shut; Fit / Tidy / the notice's undo as round 1 at p / l / d (spots 679 / 439, 611 / 371 unchanged). Spots: 375 open x 252 (111 px, 4 lines
  over the tab), 639-440 x 452 (2 lines over the tab), 678-440 keyboard taller x 496 (right of the tab).
  **Recorded limits**: a tray **wider than the window** (pulled to 440 full screen, then Slide Over 375 / a 390 phone: `sideTray` keeps its
  saved width when the window narrows — its grip clamps drags to half the window only) covers the whole stage, its own tab and ✕ off the
  window: no free px, the stylesheet's spot (a tray fix, not the notice's); 700 × 500 with the tray at 440 (the toolbar, minimap and tab fill
  the 260 px left): over the minimap only; phones under 375 with the tray open (360 × 740): a column under 96 px, over the minimap.
- **[badge-hold] P2** — a claimed badge held 500 ms opened its menu (wk.menuSource's long-press: `press.ctx`) and the document's pointermove
  still handed the press to the badge drag past `TAP_PX` (landscape: the cord pulled under the open menu; portrait: re-targeted, the menu left
  open); a slow drag (the badge's long-press never told of the moves the drag consumed) opened the menu mid-drag. **Fix** (cv-cables): the
  pointermove gives an own press to `bdrag` only while `!press.ctx` (the menu ends the gesture, as the jack's "Which cord?"); once the drag takes
  it, `took` = its pointer until that pointer's lift / cancel, and the badge's contextmenu opens nothing meanwhile. A creep under 8 px for
  500 ms is a hold by the long-press's rule: the menu, then no drag. **Test first**: cv-cables "[badge-hold]" (mock timers: hold-then-drag →
  the menu, no grab / re-patch / pull; drag at once held past 700 ms → re-targeted, no menu; hold and release → the menu alone) — red at
  9b35ade (grab, remod, drop after the menu). **Browser** (`badge.mjs <l|p>`, real touch, 28 % / 29 %): hold 650 ms then drag onto MIX → the
  menu stays, the row untouched; a drag at once onto RES (finger down ~1 s) → "Re-patch LFO 1 → Filter Res", no menu; hold and release → the
  menu; a creep → the menu, no drag — landscape and portrait.
- **[amp-held] P2** — `WORDS.ampHeld` was the fixed "Envelope 1 already shapes the level — pull it first" even with the module named Envelope 2
  in the amp slot (names fixed per module, §12 item 4). **Fix**: `WORDS.ampHeld(n)` like `takesOver` / `unplugged`; `can` and `envToAmp` pass
  `ordinalOf(o.rig, 'env1')`; main's `sxCan` (the drag chip), RIGUI's `can`, the test hook's `can` pass `rig`; `rigEnvSwap`'s notice names it
  too (`plug` had `rig` through `rigOpts`). **Pins moved by design**: rig-core's `W.ampHeld` → `W.ampHeld(1)` (four sites, the same text),
  canvas-WC-sim's swap refusal → `RC.WORDS.ampHeld(1)`. **Tests first**: rig-core "[amp-held]" (rig.n env1 2: can / plug / envToAmp name
  Envelope 2; no names: the slot's ordinal) and canvas-WC-sim "[amp-held]" (the finding's flow through the host: chip, drop notice, swap,
  no step) — red at 9b35ade. **Browser** (`ampheld.mjs <d|l>`, real mouse at 1440 × 900 and touch at 1366 × 1024): Envelope 1 pulled,
  Envelope 2 onto LEVEL (titles: `i1/env1` "Envelope 2", `i1/env3` "Envelope 1"), Envelope 1's OUT onto LEVEL → the chip "Amplifier LEVEL —
  Envelope 2 already shapes the level — pull it first", the same notice, nothing changed.
- **[chip-art] P3** — the rig's chip (the top bar's track chip, the track row's instrument button: `chip()`, `art()` below 48 px) drew the tile's
  `#17181a` rack and black knob caps on the chrome's `#141518` (1.03 : 1): only the cream jacks and the cords showed. **Fix** (cv-art
  `rigChip`, the lo branch of `DRAW.rig`; the tile unchanged): a `#55585e` case (2.6 : 1 on the chrome) with two pale rails, the three
  `#1f2023` faces (2.3 : 1 against it), and the tile's layout in light marks — a cream rule on each face, the oscillator's screen with an amber
  wave, cream knob discs (two; one big over two; four), two cream jacks at each foot — the cords at 2.6. Original art, no text.
  **Test first**: cv-art "[chip-art]" (the case ≥ 2 : 1 on #141518, the faces ≥ 1.8 : 1 against it, ≥ 3 light marks on each face, cords ≥ 2.2,
  the tile's pins as they were) — red at 9b35ade (1.03 : 1). **Browser** (`chips.mjs`, `chipctx.mjs d`): beside the 900 Series, Serum and
  Minimoog chips (`shots/chips-after1-sheet.png`) and in place (`shots/chipctx-d-rows.png`, `chipctx-d-topchip-1.png`) it reads as a rack of
  three modules with its cords.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 49, cv-cables 67,
  cv-module 77, cv-art 7, rig-core 19, main 47, canvas-sim 24, cv-shell-sim 18, tap-tempo-sim 18, cv-tray 45, rig-model 11, rig-ui 27,
  canvas-1i-sim 20, lint 169, pwa 25; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No DSP file in the diff.

### Notes — stacked plugs, cables over labels, cables behind (the user, 2026-10-26; §12; `main.js`, `cv-cords.js`, `cv-world.js`, `cv-module.js` (Tidy's Amplifier air), `cv-cables.js` (comments), `rig-ui.js` (the jack's hit), `style.css`; `tests/canvas-WC-sim`, `cv-cords`, `cv-world`, `cv-module`, `rig-ui`)
Every item's test was committed failing first (7cd4b04: canvas-WC-sim 4, cv-cords 3, cv-world 3, rig-ui 1; the Amplifier-air cv-module test
before its code: d07118b), then the change. No DSP file in the diff.
- **(1) Stacked plugs** — "in cases like this all cables should overlap at the outlet", "overlap everywhere". `rigLayer` no longer fans:
  every cord's end is its jack's own key, the jack's centre (the anchors map is the ports'), the cables diverge from there. **Retired**:
  `RIG_FAN` / `RIG_FAN_MIN` / `RIG_FAN_PAD`, `rigPack`, `rigOrder` (+ its cache, `rigOrderOwed` / `rigDragNow` / `rigOrderLater`),
  `rigFans`, the `'<jack>#<i>'` keys, `rigFanHits` and rig-ui's `--rig-fw / --rig-fx` stretch (the jack's hit is its 44 px circle again),
  the test hook `cv.rig.pack`. **The stack's order**: the records' order (cv-cables' claimed records, which follow plug order in a session:
  a new cord's record, or one plugged again after a pull / undo, comes last; a view built afresh — a reload, a track switch — starts from
  edges() order); `cv-cords set()` now draws **in the list's order** (a list in another order re-orders the layer: one new layout, nothing
  re-seeded; the same order keeps it — the 900 Series' lists keep their order, its bytes as before: P-1 (c) / BASE_SCENE green), so the
  last cord at a jack — its plug — is drawn on top. **The press rules**: an output's press starts a new cord (as ever); an input's grabs the
  stack's top — `rigNearest` names it (`R.tops`: a jack with ≥ 2 cords → its last), cv-cables `pressCord(e, el, rec)` grabs it (the
  channel fixer K made for a fanned plug, now the stack's top); "Which cord?" lists the top first (`rigStack`: the jack menu's records in
  the layer's order — §4.4's pin moved: Oscillator 2, re-patched last, now first). A forked source's BAL right of its jack (+20).
  **S3 ≤ 1 re-measured** (the gate unchanged): with the plugs stacked the Sub's cord into the Amplifier's IN Σ (fixer K's B1 had put its
  plug right of the fan) read **2** — its settled rope 2.5 px inside Filter 2's bottom-right corner (beyond the 3 px margin). Fixed in the
  layout: `cv-module tidy` takes `opts.past` (rig key → true; main.js `rigPast`: a source straight to its Amplifier, IN or DIRECT, while a
  filter stands — rigTidyOpts and sxLayParts pass it) and gives that rig's Amplifier **one grid row (DOT) more air** before it (the rope
  26 px clear at GAP + DOT; the Amplifier, its FX, OUT, Envelope 1 over it follow; upright the wrapped row follows too). S1 0, S2 0, S3 1
  (the accepted `o:i1:1 × i1/oscA`); a rig with no such source lays exactly as before (cv-module's position pins unchanged).
- **(1b) The stacked count** (the user, 2026-10-26: "on a socket with multiple outs lets just put a discreet number of how many outs on
  the socket") — `rigLayer` counts the cords drawn at each jack (a knob end its own; ∿ Never's hidden rows not drawn, not counted) and
  answers `counts` (jack → {x, y, n, to}: the plug's rim 30° up on its right, on its left where a BAL stands right of the jack); cv-cables
  keeps a `span.cv-jn` per jack with n ≥ 2 in the layer's top (above every rope, cables behind too; under the badges / BAL / ×), aria-hidden,
  no press, the world's skin on it (`.cv-jn[data-cv-skin]` joins the skin block, as the drawer did); none without an answer (lines mode,
  another canvas: the ref-WC record matches). style.css: a dark chip, the narrow face, the cream muted toward the case, a world 10 px held
  between 9 and 12 screen px, centred on the rim so at Fit it grows beside the plug (off the row above and the label); hidden while
  patching. Tests: canvas-WC-sim (2 / 3 / 4, undo / redo / pull / re-patch, ∿, behind, lines, a fork, Juno / 900 Series), cv-cables.
- **(2) Cables over the jack labels** — "cable should be on top of text here". Review WC-int P3-12's lifted label is retired: `rigLabels`
  (+ `rigLabC` / `rigLabInfoC` / `rigLabHitC` / `rigLabOf` / `rigSegBox` / `RIG_LAB_*`) and style.css `.cv-cords-top > .rig-jl-top` are
  gone; a jack's label stays in its face, under the cord canvas, so a rope crossing it passes over it (the physical look); a label no rope
  crosses reads as before.
- **(3) Cables behind** — "we need a button that makes cables go behind". `cv-world`: a toolbar toggle after ∿ (`data-cv-tb="behind"`,
  `aria-pressed`, "Cables behind modules: on / off", the row's `.cv-tb-btn` — 34 px with a mouse, 44 px on touch; `.cv-tb-btn[hidden]`),
  shown only while the cord layer is allocated (a cord canvas: a Wavecraft in cords mode, a 900 Series — cv-cords `onAlloc`), remembered
  in `BEHIND_PREF` (`synth.cv.behind`, the store every canvas pref uses, try / catch), a `'behind'` event, `behindOn()` / `setBehind()`;
  on, the layer is told `behind(fn)` — fn writes each world item's rect (its live x / y — a module in the finger — and its cached size: no
  layout read a frame). `cv-cords behind(fn)`: at each draw the boxes (≤ `HIDE_MAX` 64) go to both programs (`hb`, `nh`); the strip's
  fragments inside a box are discarded (the shadow pass by its own offset point), so the rope bodies run behind the panels; the plugs are
  drawn whole on top; a knob end's instance (it lies on the panel) hides with its rope; the live rope, the cord in the finger and the
  selected cord stay whole on top (`fr` / `fp`: their strip vertices and plug instances by `gl_VertexID` / `gl_InstanceID`); `hit()`
  skips a rope behind a box (a press there is the panel's). The SVG fallback: a `<mask>` (white, the boxes black) on each rope's strokes
  and a knob end, never a plug; the front cords unmasked. **Default off**: no hide uniform is ever written (a program's `nh` stays 0 as
  linked — the frames call for call as before; cv-cords' and cv-world's "off" tests), the SVG markup as before. The knob rings, the
  badges, the × and BAL (the layer's top) are DOM over everything, as before. `tests/ref-WC/record.mjs` matches: the toggle changes
  no record (the 900 Series' cords look the same while it is off).
- **Browser** (Chrome for Testing 156, headless, own no-store server on a free port, real CDP mouse / touch, `?gltest` for pixel reads of
  the cord canvas; `scratchpad/WC-ST/st.mjs <d|p>`, shots in `scratchpad/WC-ST/shots/`), 1440 × 900 mouse and 1024 × 1366 touch dpr 2: the
  rig (Oscillator 1 + 2 → Filter, LFO 1 → CUTOFF / RES) after Tidy — no fan key, both stacks on their jack's centre, the plug drawn on the
  LFO's OUT; a real drag from the stacked LFO OUT onto DRIVE made a **third** cord (stacked, the newest last); a real drag from the
  stacked Filter IN pulled **Oscillator 2's** (the top), "Cord pulled · tap to undo"; long-press (touch) / right-click (mouse) "Which
  cord?" → Oscillator 2 first; no lifted label anywhere, the IN Σ and OUT labels in their faces with the cables over them; the toggle:
  shown on the Wavecraft and the 900 Series, hidden on a Juno, 44 × 44 on touch, the undo notice clear of it (both sizes); on → the
  LFO → CUTOFF rope over the Filter's face reads alpha 0, the rope in the open and the plug 255, the pref stored; a tap on a rope in the
  open selects it (×); off → as before; the 900 Series (15 cords): on, a rope over a module 0 and its plug 255, off 255 / 255; no console
  error.
- **Gates** (one file at a time, `--max-old-space-size=2048`, after `node tools/precache.mjs --write`): canvas-WC-sim 49 (S3 1, the
  gate unchanged), cv-cables 67, cv-cords 48, cv-module 78, cv-world 84, cv-patch 31, rig-ui 27, rig-core 19, main 47, canvas-sim 24,
  canvas-9-sim 22, canvas-9b-sim 14, canvas-9c-sim 3, cv-shell-sim 19, lint 169, pwa 25; also canvas-3-sim 25, cv-tray 46, ui-bench-wc 5,
  rig-model 11, integration 44, golden-graph 6; `tests/ref-WC/record.mjs`: "the record matches base.json (114 fixtures, 5 sessions)". No
  DSP file in the diff.

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
