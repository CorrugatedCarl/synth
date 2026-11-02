# Stage MOD1: one LFO, one Envelope, one Macros everywhere (IMPL-MOD1) — contract, amended after the skeptic + re-plan (2026-11-02)

**Amended 2026-11-02** (§16, "Skeptic + re-plan"). The user's later answers (the end of this file, verbatim) made the sound-identity proof,
the schema step and every Serum-complete item moot, and widened the faces to every modulator. §0–§14 are rewritten to the smaller plan;
§16 lists each finding and what was done with it. Where an older reading of this file conflicts, the user's answers and §16 win.

**The user's request (2026-11-01).** On a Wavecraft track the Sources tray shows "LFO", "Envelope" and "Macros" under the Wavecraft
modules, and "LFO", "ENV" and "Macro" under Modulators: two implementations, and the Modulators ones still wear the old Serum panels.
The user chose:
1. **"Merge into one"**: one LFO, one Envelope and one Macros, in the Wavecraft style, on every instrument's canvas and on the master.
2. **"Convert them"**: the old-style LFO / ENV / Macro modules in saved projects become the merged module. Shape, rate, settings and
   cables are kept, and **the sound stays the same**. (Later the same day: "i dont care if old projects get messed up at all" — an old
   module simply wears the new face; nothing stored changes, so its sound is in fact the same, but no proof is built for it: §2.)

**The end state (the user, 2026-11-01).** ROADMAP 28 comes right after MOD1: the Serum part modules **and Serum complete** leave canvas
entirely (no legacy tag, no switch); canvas saves need no care; the old app on `main` (synth.domlavin.com) keeps its Serum and is never
touched. So MOD1 builds nothing for Serum complete, and the merged modules depend on no Serum-part UI (§4.5): after MOD1 no modulator shows
a Serum panel, `mountSlot` has no caller and rig-ui imports no `partView`. §14 lists what 28 removes.

**Base ⟨B⟩.** `canvas` **3b5e1b1** (FR Cut B live: 935d791) plus this contract. Line references are to 3b5e1b1, re-checked by the skeptic
on 2026-11-02; the lead re-checks them at phase 0. Tags as IMPL-WC / IMPL-MM: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane
pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §15, never an [R]).

**Standing rules.** Browser first (no iPad app rebuild; its node tests stay in the sweep). No per-stage iPad session. Cords only on a
Wavecraft canvas (IMPL-WC Q1 = (b)). No artificial caps. The lean shape: a contract first, builders in worktrees reset to the base,
two reviewers, failing-test-first fixers, one sweep, one test file at a time. **No Fable**: Opus 5.5 for the judgment lanes (the faces,
the host) and the lead's phase 0, Sonnet for the mechanical one (tray + skins) and one-file fixers. Never touch `main`. "Push it live
when it's done."

**Invariants**
- **D1 No sound changes, anywhere.** No DSP file in the diff (engine.js and every `DSP_FILES` script, main.js:931–932 [R]: the sx-*
  scripts, serum-dsp, fx-mods2, fx-dsp, dr-808, dr-seq, mod-core, patch-dsp, moog-dsp, master-dsp). **Nothing stored changes**: no
  schema step, no migration, no new saved field; no device id, kind, state or row is edited by MOD1. So every compile, payload and
  message is the same by construction, for old projects and new. Every golden and frozen ref stays bit-identical, `tests/ref-WC/record.mjs`
  included (its G1 compile hashes and its G12 cable DOM: nothing re-recorded). A face edits through the same donor widgets on the same
  slot host as the old body: the same gesture writes the same device record (G1's parity half).
- **D2 Nothing moves between hosts.** A track's or the master's LFO / ENV / Macro stays a ModCore device; a Wavecraft's stays in its
  Serum state (the user's answer 2: old track LFOs stay where they are). Only faces, titles and tiles change.
- **D3 One tile per type, one face per kind.** LFO, Envelope, Macros, Mod Wheel, Velocity, Aftertouch, Bend, Note, CC and Chaos each wear
  a Wavecraft face on the RIG grid, on every canvas (tracks of every instrument, the master), the skins applying. No Serum panel remains
  in a modulator.
- **D4 Cut B untouched** (§7).
- **D5 Everything else as it was.** Instruments, the FX panels (already the FX look), the 900 Series, Pads, a Wavecraft's own modules
  (already faces). Cables: `cablesOf` and cv-cables.js are not in the diff — lines on every canvas but a Wavecraft's; on a Wavecraft
  canvas its own modules' cords as today and a track module's rows lines, as today.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at 3b5e1b1; "→" what they force)

| piece | where [R] | → MOD1 |
|---|---|---|
| **The canvas modulators.** Devices on a track (`t.dev.l1`, `e1`, `m1`, `c1`, `h1`, `ve`, `at`, `bd`, `nt`; the project wheel) or on the master (`project.master.mdev`, IMPL-MM §5). States: `lfo { kind, lfo, rate, rise, delay, smooth, phase }`, `env { kind, env: { bpm, legInv, stealRe }, att, hold, dec, sus, rel, crv, start, end }`, `macro { kind, v[8], names[8] }`, `cc`, `chaos`. Ids from `addModDev`: the largest number + 1, **never reused** | song.js:634–654 (`normModDev`); cv-mods-ui.js:19–27; cv-model.js:398–410 (:402–406) | a number is already fixed at creation; **nothing stored needs to change** (§2) |
| **Their bodies.** `bodyFor` → the six plain bodies (wheel, velocity, aftertouch / bend, CC, note) and, for lfo / env / macro / chaos, `slotBody(kind, o)`: sx-host `slotHost` (a SerumHost over a synthetic Serum state, the device overlaid into one slot: LFO 1, ENV 2, chaos 1, macros 1–8; host opts `bare, nomod, links: false, learn: false, undo: false, lock: false, srcItems` (+ `monoLock` on the master)) and **Serum's own panel** by `SX.mod.mountSlot(H, el)` (LfoPanel 0 / EnvPanel 1 / MacrosPanel / ChaosRow 0). API `{ el, update(v), sync(), menuItems(), host(), view(), value(), knobs(), destroy() }` | cv-mods-ui.js:385–399 (`bodyFor`), :63 / :162 / :195–224 / :317 / :357 (the plain bodies), :277–302 (`slotBody`; `mountSlot` :286); sx-host.js:4559–4734 (`SLOT` :4566, `overlaySlot` :4575, `readSlot` :4597, `slotHost` :4633, its SerumHost :4685, `H.live` :4707–4732); sx-ui-mod.js:1001–1007 | the slot host stays the host; only what mounts on it changes (§4.1) |
| **The Wavecraft faces.** `rigHost().face(kind, root, { host, part, shown, dev, n })` mounts on **any SerumHost** (`H.mount`); `buildFace` reads the slot index through `MOD.partView(part)`; recipes env / lfo / macros; builders over the donors `EnvPanel` / `LfoPanel` / `MacrosPanel`; the title `nameOf(A, kind, k)` reads `A.n`; the env builder's ⋯ calls the rig host's `moduleMenuActs` (Swap with ▸, Lock …). main.js mounts a rig's faces with `RIGUI.face(…, { host: H, part, shown: () => cvLive(k), dev, n: RC.ordinalOf(…) })`, else `SXMOD.mountPart` (the Arp / Clip fallback) | rig-ui.js:57–80 (recipes, `FACE`), :145–146 (`buildFace`, `partView`), :354 (`nameOf`), :537–600 (env / lfo / macros builders), :613–633 (`rigHost`, `face`); main.js:8077–8082 | a slot host **is** a SerumHost: the face mounts on it as it is, and `nomod` comes from the host's opts (`mount` merges `this.opts`, sx-host.js:1946–1949) |
| **One evaluator.** ModCore is Serum's modulation code on a shim; N2: a GLOBAL track LFO through ext ≡ the Serum's own MONO LFO row | mod-core.js:1–15; tests/modcore.test.mjs:113 | two hosts, one code; D2 keeps each module where it is |
| **The payload.** `compileMods` is memoised on `sigOf` (each modulator device hashed whole); the posted `key` holds no device field | cv-graph.js:592–613, :634, :767 | unchanged records ⇒ unchanged payloads (D1) |
| **Labels.** `MOD_LABEL` lfo 'LFO', env 'ENV', macro 'Macro'; `modLabelOf(id)` = label + the id's number; **no title reads `dev.name`**. A rig module: `labelOf(part, rig)` = `labelN(ordinalOf(rig, part))`, `ordinalOf` = `dev.rig.n[part]` (any part key, 1…99) else the slot number; only Envelopes store one at creation (`rigPick` → `rigSetOrd`); `MODULES.macros` has no `labelN` ("Macros"); `nextOrdinal(rig, kind, parts)` looks at the rig alone | cv-mods.js:448, :461–465; main.js:7232, :7446, :10409, :10473; rig-core.js:128–142, :179, :184–199, :633–664; main.js:8933–8936 | on a Wavecraft canvas a track "LFO 1" and the rig's "LFO 1" can stand side by side today → numbering in the add paths (§2.2) |
| **The tray.** `SRC_VIEWS`: the Modulators section `mods` shows in the **Serum** view and the **Wavecraft** view (and alone on the master); Hardware / Simple say "Serum and its modulators: the Serum view" (`TO_SERUM`). `RIG_TILES` osc sub noise filter **env lfo macros** + arp clip; `MOD_TILES` wheel velo at bend note **lfo env macro** cc chaos ('ENV', 'Macro'); `MASTER_MODS` lfo macro cc chaos. main.js: mods tiles → `modAdd` (tap / `modTileDrag`); part tiles → `sxPartPick` / `sxPartDrag` → `sxPartDrop`: `rigAdd` on a Wavecraft track, else **`rigReplace`** (the instrument replaced by a Wavecraft holding the module) | cv-tray.js:586–606, :677–678, :708–719; main.js:6672, :6679, :8645–8648, :8960 (`rigAdd`), :9043 (`rigReplace`), :10395 (`modAdd`) | the duplicate the user saw; a modulator tile replacing a Juno goes (§5) |
| **Sizes and jacks.** `MOD_H` (Tidy's guesses), `SX_MODS` (lfo env macro chaos: height = content, measured), `MOD_W` lfo 416 · env 320 · macro 256 · chaos 416 · the rest `W_MOD` 240, `modJacks` (a macro's k1…k8 inline, every other kind one `out` on the right edge), `modX(kind)`, `rigJacks` (every rig jack inline) | cv-module.js:83, :87, :95, :107–111, :120, :135–148 | the faces' widths from the RIG grid; every `out` inline (§4.3) |
| **Skins.** One `data-cv-skin` on `#world`. The rig chrome `.cv-mod[data-cv-rig]` (bar, title, case, the screws pseudo-element, the jacks) and the FX look's `.cv-mod[data-cv-fx]` beside it; three skin blocks (charcoal / ivory / glass), the glass transparency and its blur (off on Low). Marks: `rigMark`, `fxMark`; the popups' skin through `wkPopSkin` (`closest('.cv-mod[data-cv-rig], .cv-mod[data-cv-fx]')`). tests/cv-tray.test.mjs pins every selector list | style.css:1555–1600 (screws :1570–1579), :1660–1728 (:1726, :1728); main.js:8749–8752, :8756–8777; tests/cv-tray.test.mjs:1628, :1699, :1724, :1751 | a third mark, `[data-cv-face]`, on the FX look's precedent (§4.4) |
| **Schema** 17 | cv-migrate.js:117 | stays 17 (§2.1) |
| **Cut B** | §7 | untouched (D4) |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The engine — decided [C]

| option | consequence | verdict |
|---|---|---|
| **A. One home: ModCore.** Every LFO / ENV / Macro becomes a track (or master) device, a rig's own slots moved out | breaks IMPL-WC W2 / W3 (a Wavecraft's sound is its Serum state): presets loaded into a Wavecraft bring native LFOs, preset saves would lose them, per-voice features (an LFO's rate under a macro, voice retrigger) change | rejected |
| **B. One home: a Serum state per track** | that **is** ModCore already | — (it is what exists) |
| **C. One module, two hosts.** One kind per role, one face, one state vocabulary. The module is evaluated where it lives: inside a Wavecraft (a slot of its Serum state, the Serum engine per voice) when it belongs to the Wavecraft, ModCore (the track's or the master's) everywhere else. A module never changes host by itself | no engine change; nothing stored changes, so every compile and every message is the same by construction (D1) | **chosen** |

**Why the user sees one module.** Both hosts run the same code (SxMod), take the same state fields and wear the same face (§4). The
cables are the same records (`track.mods` rows from `l1.out`, native rows from `iN/lfo3.out`). §13 lists the few visible differences.

**Which host a new module gets [C].** The tile adds into the Wavecraft on a Wavecraft track (rig-core's add rules, a native slot: part of
the Wavecraft's sound and presets). Everywhere else it adds a track / master device. A full Wavecraft ("This Wavecraft already has 10
LFOs") refuses, as today: no silent fallback to the other host.

**Old modules on a Wavecraft track** keep their host (D2, the user's answer 2). Moving one in is a later menu item, never automatic.

---------------------------------------------------------------------------------------------------------------------------------

## 2. Data: nothing stored changes (phase 0, the lead) [C]

### 2.1 No schema step
- `SCHEMA` stays **17**: no `STEPS` entry, no stored display number, no place step. An old project opens exactly as before; its
  modulators wear the new faces at their stored places. A face taller or wider than the old body may overlap a neighbour (Tidy fixes it;
  the user: "i dont care if old projects get messed up at all").
- Why no stored number: a track device's number is its id's, never reused (cv-model.js:402–406 [R]); a Wavecraft module's is
  `dev.rig.n[part]` or its slot. A clash needs both hosts on one canvas: an old project, or a Wavecraft made on a track that holds
  track modulators. The add paths prevent new clashes (§2.2); old ones stay (§13).

### 2.2 One numbering [C]
- **Titles** "LFO n", "Envelope n", "Macros n", "Chaos n", "CC n" in both hosts; the singletons keep their names (Mod Wheel, Velocity,
  Aftertouch, Bend, Note). The macro **knobs** keep their default names "Macro 1" … "Macro 8" (they name knobs, as a Wavecraft's do).
- **A new Wavecraft LFO / Envelope / Macros** takes the lowest number that no module of its kind on that canvas shows, in either host:
  rig-core `nextOrdinal(rig, kind, parts, taken)` (`taken`: the track's own device numbers of that kind, cv-mods `numsOf(t, kind)`;
  macros ↔ the track's `macro` devices). It is stored in `dev.rig.n[part]` at creation for **every** kind (today Envelopes only), inside
  the add's History step.
- **A Wavecraft made on a track that holds track modulators** (a Wavecraft tile over a Juno with an LFO and an ENV; `setTrackModel` → the
  rig) numbers its modules the same way: beside a track's "Envelope 1" the starter's amp Envelope reads "Envelope 2".
- **A track device** keeps its id's number (unchanged). The tiles never add a track LFO / ENV / Macro on a Wavecraft track (§5).
- **Every label reads these**: bars, the Mod list, the inspector, notices ("Added Envelope 2 · tap to undo"), History, the knob
  press-and-hold source menu, tips. Destinations keep the engine's ids (IMPL-WC §13).
- **The words** (phase 0): `MOD_LABEL` env 'Envelope', macro 'Macros'; `MODULES.macros.labelN` → "Macros n" (a Wavecraft's Macros reads
  "Macros 1"). Serum complete's own panel keeps Serum's words until 28.

### 2.3 `MOD_COLS` (phase 0, data) [C]
`cv-mods.js` `MOD_COLS = { lfo: 5, env: 5, macro: 4, chaos: 3, wheel: 2, velo: 3, at: 2, bend: 2, note: 3, cc: 3 }`: each face's RIG-grid
columns (width `faceW(cols)` = 64·cols + 32 → 352 · 352 · 288 · 224 · 160 · 224 · 160 · 160 · 224 · 224). Lane F lays each face to it,
lane H's `MOD_W` reads it: no face spike before the lanes, no serial dependency. A builder who needs another count asks the lead (one
line in phase 0's file, a note in §15).

### 2.4 History
Unchanged: every structural act on a modulator is one step (add, remove, move, fold, cable, Tidy); a knob gesture on a track module is
one step (the slot host's `edit`), on a Wavecraft module the rig's panel undo (IMPL-WC §3.5). A new Wavecraft module's `rig.n` entry is
in its add's snapshot: undo removes it, redo brings it back with the same number.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The engine side — nothing (D1)
No message, payload, worklet option or DSP line changes. ModCore stays the host of every track and master module, the Serum engine of
every Wavecraft's. Per-note injection, ext slots, the master's MONO lock, Cut B's tempo and the fast lane apply as at ⟨B⟩. Bench rows
unchanged. Reviewer 1's first check: `git diff --stat 3b5e1b1..HEAD -- engine.js <DSP_FILES>` is empty.

---------------------------------------------------------------------------------------------------------------------------------

## 4. One face for every modulator (lane F; lane H the module; lane U the skins) [C]

### 4.1 The four slot faces: LFO, Envelope, Macros, Chaos
- **`slotBody(kind, o)`** keeps its API, its slot host and Cut B's forwarding line byte for byte (cv-mods-ui.js:283–285: `heardFrame`,
  `sampleRate`). It mounts **`RU.rigHost({}).face(K, el, { host: H, part, slot: true, dev: O.devKey, shown: O.shown })`** in place of
  `mountSlot`: `K` = 'lfo' | 'env' | 'macros' | 'chaos', `part` = 'lfo1' | 'env2' | 'macros' | 'chaos1' (the slot host's slots,
  sx-host.js:4566; ENV 2's variant: START / END, as the old body). After MOD1 `mountSlot` has **no caller**.
- **rig-ui `face()` with `slot: true`** — the same recipes and donors, presentation only:
  - a new **`chaos`** recipe (MOD_COLS 3; RATE, BPM, MONO, S&H from the donor `ChaosRow`; a jack row `>out`);
  - `part → slot` by a local `partOf(part)`: rig-ui no longer imports `MOD.partView` (the donors stay);
  - **the title** from the id's number (`devKey` 'l3' → "LFO 3", `MODULES[kind].labelN`; chaos "Chaos n");
  - **⋯ items** = the old slot body's, item for item: the panel's own and the host's `srcItems` (Bypass All / Remove All
    Destinations); no Swap with ▸, no Lock, no MIDI learn (the env builder's `moduleMenuActs` path stays for a rig host only);
  - **the MONO lock** on the master through the host's `monoLock`, as on the old panel; **every control `data-nomod`** (the host's opts).
- **The jack row**: LFO / Envelope / Chaos `>out`; Macros' name tiles k1…k8 (tiles 'jack', as today). Jack ids unchanged (`l1.out`,
  `m1.k3`): no row, no cable record changes.
- **Body API kept**: `update(v)` → `H.live(v)` (Cut B's ring path when `v.F` is set), `sync()`, `menuItems()`, **`host()` → the slot host**
  (main.js `bodyAns` / `bodyReset` read its ring, §7), `view()` (the face's View), `value()`, `knobs()` (the eight macro knob elements).
- **`ready()`** imports rig-ui beside sx-host and sx-ui-mod (main.js's `uiLoad` already loads all three, main.js:3008: precached).
- **Parity**: every `data-dest` of the old body is on the face (the ⚙ drawer included: DOT / TRIP / HOST, the drawing tools).

### 4.2 The six plain faces: Mod Wheel, Velocity, Aftertouch, Bend, Note, CC
- In cv-mods-ui.js, **without a SerumHost**: the RIG grid (rig-grid.js `GRID`, `layoutOf`, `faceW`, `ensureRigCSS`) and rig-ui's markup
  (`.rig-face[data-rig-kind]`, its rows and cells, `.rig-jack`), as fx-ui lays the FX faces (the FX look). Widths `MOD_COLS`.
- The same behaviours and API as today's bodies: the wheel's drag, keys, two-finger cancel and "+N on other tracks" chip (`setOthers`,
  `others`, `dragging`); CC's number, channel menu and Learn (`setLearn`, `armed`); the meters, the velocity curve and the note keyboard
  as screen rows; a jack row with `>out` each.
- `update(v)` stays change-gated (no layout read, no allocation per call: `cvModLive` and the frame lanes call it while playing).

### 4.3 The module (lane H: main.js, cv-module.js)
- **Sizes**: `MOD_W[kind]` = `faceW(MOD_COLS[kind])`; every modulator kind's height is its content (`SX_MODS` → every kind), `MOD_H` the
  Tidy guesses; `modX(kind)` follows. **`modJacks`**: every kind's `out` **inline** (anchored on the face's `[data-jack="out"]`, the
  right-edge dot the fallback), the macros as today; kind `'mod'` (a line) on every canvas.
- **`faceMark`** (beside `fxMark`): every modulator module carries `[data-cv-face]` (a Wavecraft's own modules keep `data-cv-rig`);
  `wkPopSkin`'s `closest()` gains it.
- **`modMount`** passes `shown: () => cvLive(key)` (an off-screen face stops its tick: the slot host's `tickLive` reads its views'
  `shown()`, sx-host.js:2696) and keeps every Cut B argument (`heardFrame`, `sampleRate`).

### 4.4 Skins (lane U: style.css)
- `.cv-mod[data-cv-face]` chrome beside `[data-cv-fx]`'s (bar, title, case, the screws rule); each skin block gains `.cv-mod[data-cv-face]`,
  `… .sx-root`, `… .rig-face`; the glass transparency and blur rules too (blur off on Low, as today). A skin switch changes colours and
  the face font only: no layout box moves (G4). The LFO / Envelope editors read the skin's colours through `theme(root)` (graph.js).

### 4.5 No dependency on Serum-part UI
The faces use rig-ui.js, rig-grid.js, rig-core.js, sx-host.js (`SerumHost`, `slotHost`), graph.js, wk.js and sx-ui-mod.js's **donor
classes** (`LfoPanel`, `EnvPanel`, `MacrosPanel`, `ChaosRow`) — the Wavecraft's own donors, which ROADMAP 28 keeps. They do **not** use
`mountSlot`, `mountPart`, `PART_W`, `PART_PH`, `COL`, `phaseOf`, `partView` or serum-ui.js (G8's grep).

---------------------------------------------------------------------------------------------------------------------------------

## 5. The tray (phase 0 the data; lane U the views; lane H the routing) [C]
- **Phase 0**: `MOD_TILES` order and names — **LFO · Envelope · Macros** first, then Mod Wheel, Velocity, Aftertouch, Bend, Note, CC,
  Chaos (the user's answer 3); `RIG_TILES` loses env / lfo / macros (the Wavecraft modules section: Oscillator, Sub oscillator, Noise,
  Filter; Note tools as today); `MASTER_MODS` unchanged (LFO, Macros, CC, Chaos).
- **Lane U**: the three tiles wear the Wavecraft glyphs (`PART_GLYPH` env / lfo / macros). **The Modulators' home (Q5, first guess)**:
  a "Modulators" view of its own in the Sources menu (the `mods` section), and still at the end of the Wavecraft view (and the Serum view
  until 28 deletes it). Hardware / Simple's note points to it; the Wavecraft view's note speaks of its own modules only.
- **Lane H**: a modulator tile (tap or drop): **on a Wavecraft track → `rigAdd`** (macro → 'macros'; its auto-plug, the amp-slot rule:
  an Envelope on a gate-only Wavecraft takes the LEVEL; its full texts); **on any other track and on the master → `modAdd`**. **Never
  `rigReplace`.** Over the track list it does what a Modulators tile does today (no new track). The tiles stay `multi` (never greyed): a
  full Wavecraft says why on the tap (H may grey them there if cheap).

---------------------------------------------------------------------------------------------------------------------------------

## 6. Canvases and cables — as today [C]
- Lines on every canvas but a Wavecraft's (IMPL-WC Q1 = (b)); a line leaves the face's inline `out`.
- On a Wavecraft canvas: its own modules' rows are cords, as today; **a track module's rows stay lines and its module stays in the left
  column** (Tidy as today). `cablesOf` and cv-cables.js are not in the diff.
- Cut (2026-11-02, §16 P2-2): track modules' rows as cords on a Wavecraft canvas, the rig band for track modules, the LEVEL refusal.

---------------------------------------------------------------------------------------------------------------------------------

## 7. The Cut B seam (D4) — as the code is at 3b5e1b1
**Cut B owns, MOD1 does not edit:**
- **motion.js**: `RING_N` 128, `SLOT_K` / `SLOT_G`, the gap rule `R.push(F, src, off, sr)`.
- **sx-host.js**: the slot host's ring path `H.live` :4707–4732 (a finite `v.F` → the ring `H.sl` (widths `SLOT_W` :1215) pushed with
  `H.srNow()`, then `H.tickOn()`); the `'sx-fast'` clock client (`tickOn` :2689–2694), **a `shed` client** (wk.clock's drop level ≥ 2: every other
  frame; at 3: ≈ 30 / s); `tickLive` :2696 (live while one of its views is `shown()`); `fastTick` :2707; `fastLive` :2668; `fastReset`
  :2675; the heavy displays' period `heavyMs` / `rateMs` / `capMs` :1197–1210 (k doubled per drop level, ≥ 15 / s) and `heavyHz()`
  :2762 (a slot host's host gives none: the class alone, as for the old body).
- **cv-mods-ui.js**: `slotBody`'s forwarding of `heardFrame` and `sampleRate` (:283–285).
- **main.js**: `monitors` :3108 (with `fastOn`); `fastHz` :3247 (**`FAST_WEBKIT = 0`**: no fast lane in WebKit — the iPad and Safari keep
  Cut A's motion); `fastAns` / `bodyHost` / `bodyAns` / `bodyReset` :3255–3260 (they read **`B.host().sl`** and `.fastReset()`);
  `fastPush` :3265; `fastDrop` :3382; `fastReset` :3389; `fastTick` :3403 (a `shed` client, :11258); `heardFrame` :6291 /
  `frameHeard` :6300; `modMount`'s `heardFrame` / `sampleRate` (:10011); `MC_KINDS` / `MC_FAST` :10085–10086 (chaos never fed fast);
  `mcMonitor` :10093; `mcSnap` :10105; `mcFast` :10123 (one reused `B.fastV` per body); `sxInjEnv` / `sxInjSnap` / `sxInjFast`
  :10140–10181; `__synthTest.fr` (its `trace` probe reads **only `serumPanels`' hosts** (`fastTraceFrame` :3433) — a Wavecraft's, never
  a modulator body's slot host).
- **wk.js**: the clock's `drop()` 0…3, `dropReset`, the shed rule (:3119).

**MOD1:**
- edits none of sx-host.js, sx-ui-mod.js, motion.js, wk.js (a line lane F finds needed is additive, listed in §15, read by reviewer 1);
- edits in cv-mods-ui.js only what `slotBody` mounts (the forwarding line unchanged);
- edits in main.js none of the functions above; `modMount` gains `shown` only;
- keeps the body contract: `update({ v, ph, y, out, F })` / `({ v, stage, t, F })` / a level, **`host()` = the slot host**. The face's
  LFO / Envelope editors are the donors': their playheads read `kit.snap()`, Cut B's view at the heard frame.

**G7 (the tests that must pass unchanged):** tests/sx-host.test.mjs:1256 (slotBody forwards `heardFrame` / `sampleRate`; `update` with
`F` takes the ring path) and that file's slot-ring cases; tests/canvas-FR-sim.test.mjs :349 (`mcFast` → the LFO body), :389 (R1-C; a
chaos body never fed fast), :430 (the injected ENV); tests/canvas-MM-sim.test.mjs (the master's LFO body per frame); motion; fast-lane.
**A face probe** for a track LFO (trace cannot see one): the harness's `arc` hook on `.gx-lfo canvas.gx-ov` (the donor keeps the class)
in G6's `mods` scene.

---------------------------------------------------------------------------------------------------------------------------------

## 8. ROADMAP 26 (the LFO combiner) — not built here
Row 26 takes the merged LFO as it is: a track LFO's state is cv-graph `slotState(t, src)` (cv-graph.js:396, not exported), a Wavecraft
LFO's its slot; any LFO face's live view is its host's `kit.snap()` at the heard frame. Row 26's contract adds what it calls
(`isLfoSrc`, an exported `lfoStateOf`, a `phase()` accessor): MOD1 adds no API with no caller.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Gates

| gate | what | target |
|---|---|---|
| **G1 sound (D1)** | every golden (classic / fx / presets / random / graph, 606 / 909 / drums / sdsv, moog ×3) and frozen ref (p1, 1c, 7a–7d, 9 / 9b / 9c, M, MM, SC, P) in the sweep, with master-proc, engine-track, canonical-stream, canvas-M-bounce, tempo-mods, fast-lane; **`node --max-old-space-size=2048 tests/ref-WC/record.mjs` compares exact (G1 and G12)**; `git diff --stat 3b5e1b1..HEAD -- engine.js <DSP_FILES>` empty (reviewer 1, and the lead before the squash); **parity**: tests/m3-fixture.test.mjs's body half — the same edits through each face give byte-identical device records and `compileMods` payloads | exact |
| **G2 old projects open and play** (the user's floor) | sim (`bootMain`, the app's load path): the 2b fixture tracks (tests/fixtures/mods-2b.mjs `tracks()`) saved as a file; the master with an LFO and a Macros on two effects; a Wavecraft with its own LFO / Envelope / Macros beside old track LFO / ENV / Macro (numbers clashing); a schema-6 file with modulators (STEPS[6]); a Serum complete with canvas modulators while it exists. Each opens with no throw and no console error, every modulator wears a face, its `{t:'mods'}` is posted. Reviewer 1 renders each through the real engine: finite and not silent | pass |
| **G3 host** (tests/canvas-MOD1-sim.test.mjs, new) | the tray: LFO / Envelope / Macros first in Modulators, `RIG_TILES` without them, the Modulators view (Q5); a tile on a Wavecraft track adds a native module (its slot, `dev.rig.n` numbered around the track's devices), on a Juno / an 808 / a 900 Series a track device, on the master a master device — **never a replace**; a Wavecraft made on a track with track modulators numbers around them; every modulator module `[data-cv-face]` with a `.rig-face[data-rig-kind]`; jack ids unchanged, `cablesOf` equal to the base's; a macro knob move posts `{t:'mval'}` only; the master's MONO lock (a tap changes nothing, no step); the words everywhere ("Added Envelope 2 · tap to undo", the Mod list, the inspector, History, the source menu); Tidy; undo / redo of every structural act; an off-screen face's tick stops | exact |
| **G4 UI** (reviewer 2: Chrome for Testing, downloads denied, its own `--user-data-dir`; 1440 × 900, 1366 × 1024 touch, 1024 × 1366 touch, dpr 2) | a Juno, an 808, a Wavecraft with both hosts, the master, each with modulators: screenshots; the three skins (charcoal, ivory, glass): a switch moves no layout box (`getBoundingClientRect` equal), pixels differ only in colour / font; touch drags from a face's jack onto a knob (a line), two-finger cancel; the ⋯ menus; no console error | pass |
| **G5 layout** (tests/ui-layout-wc.mjs extended; lane F runs it in CfT) | every face at 100 % and the iPad sizes: the RIG grid numbers of IMPL-WC G11 (widths 64·n + 32, knob centres, row tops, text margins, fill ratio, contrast per skin); `data-dest` parity with the old slot bodies; element counts: a slot face ≤ 1.2 × its old Serum panel, a plain face ≤ 48 elements; `MOD_W` equals the measured widths | exact |
| **G6 frame cost** | tests/ui-bench-fps.mjs, a new **`mods` scene**: a Juno with 4 LFOs, 2 Envelopes, 1 Macros, a CC, a Chaos and the wheel, every LFO cabled and moving; Cut B's G7 bar (1 × / 4 × / 6 × CPU; caps 60 / 120 / 240; the drop levels); A/B against 3b5e1b1: ≤ + 10 % frame cost; the LFO overlay (the `arc` hook) moves on every painted frame at 1 ×. WebKit not measured here (the lane is off there) | within |
| **G7 the Cut B seam (D4)** | §7's tests green unchanged; reviewer 1 reads the diff: no edit in §7's functions | exact |
| **G8 words and dependencies** | a DOM scan of every face and its menus: no "ENV" or "Macro" as a module name (the macro knobs' "Macro n" allowed), no "Serum", no "Xfer"; grep: no `mountSlot` / `mountPart` / `PART_W` / `PART_PH` / `COL` / `phaseOf` / `partView` in rig-ui.js or cv-mods-ui.js, and **no caller of `mountSlot` in any file** | exact |
| **G9 the sweep** | every test file one at a time (2 GB each), after phase 0 and at integration | green |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Lanes, order, models

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **phase 0** (the lead) | cv-mods.js (`MOD_LABEL` words, `MOD_COLS`, `numsOf`), rig-core.js (`MODULES.macros.labelN`, `nextOrdinal`'s `taken`), cv-tray.js's data (`MOD_TILES` order / names, `RIG_TILES`), tests/mod1-model.test.mjs (new, failing first), **every label pin the words move** (§11), the sweep. No schema, no recording, no corpus | G3's model half, G9 | **Opus 5.5** |
| **F** faces | rig-ui.js (`slot: true`, `partOf`, the chaos recipe, slot ⋯ items, titles), cv-mods-ui.js (`slotBody` mounts the face, `ready()`, the six plain faces), tests/rig-ui.test.mjs, tests/cv-mods-ui.test.mjs, tests/m3-fixture.test.mjs, tests/ui-layout-wc.mjs | G1's parity half, G5, G8 | **Opus 5.5** |
| **U** tray + skins | cv-tray.js (the Modulators view, the glyphs, the notes), style.css (`[data-cv-face]` chrome, the skin blocks, screws, glass), tests/cv-tray.test.mjs | G3's tray half, G4's skin half | **Sonnet** (mechanical) |
| **H** host | main.js (tile routing, numbering on add and when a Wavecraft is made, `faceMark`, `wkPopSkin`, `modMount`'s `shown`), cv-module.js (`MOD_W`, `MOD_H`, `SX_MODS`, `modX`, `modJacks`), tests/canvas-MOD1-sim.test.mjs (new), tests/cv-module.test.mjs, tests/canvas-WC-sim.test.mjs (the rig tiles' routing pins), tests/ui-bench-fps.mjs + .test.mjs (the `mods` scene) | G2, G3, G6's scene, G7's host half | **Opus 5.5** |
| reviewers × 2 | (1) **real engine + sim**: D1–D5, G1, G2 (renders), G3, G7, a 50-track project with 400 rows opens (no throw, the memo holds); (2) **Chrome for Testing**: G4, G5, G6, G8, the iPad sizes, a skin switch mid-animation, a power cycle | — | Opus 5.5 × 2 |
| fixers | the finding's files, failing test first | | Sonnet (one file) / Opus 5.5 (across files) |

**Order.** Phase 0 from ⟨B⟩ (the model commit, the moved pins, the sweep) → **F ∥ U ∥ H** in worktrees **reset to the phase-0 commit**
(`git reset --hard <phase 0>`, `git log -1` checked: the harness makes worktrees from `main`'s ee2a939) → integration by the lead
(`precache --write`; a Chrome smoke: a Juno, a Wavecraft with both hosts, the master) → the two reviews → fixers → the sweep → deploy
(`tools/deploy-canvas.sh`) → ROADMAP / HANDOVER → the user tries it → **ROADMAP 28**.

**Files.** Every lane's files are disjoint. Phase 0 edits cv-tray.js's data and tests/cv-tray.test.mjs first; U branches after it.
The label pins all move in phase 0, so every lane starts green.

**Rules.** `?v=9` on every import; new test files import `./v8-guard.mjs` first; never fake-DOM nodes in `assert.*` (serum-ui's safe
wrapper); one test file at a time with `--max-old-space-size=2048`; no lane commits `sw.js`; no DSP file in any diff; Chrome for Testing
only, downloads denied, its own `--user-data-dir`, killed after; no iPad app build; every user-visible Wavecraft word through `RIG.NAME`.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Pins that change by design (and the ones that must not)
**Move by design:**
- **phase 0, the words**: cv-mods.test (`MOD_LABEL`, `modLabelOf`), cv-tray.test (`MOD_TILES` order / names; `RIG_TILES` 9 → 6),
  rig-core.test (`nextOrdinal`'s `taken`, "Macros 1"), and every label-text pin — canvas-2b-sim, canvas-3-sim, canvas-del-sim,
  canvas-MM-sim, canvas-WC-sim, classic-panel, cv-model, fx-ui, rig-model, the ui-bench-m3 / -m9 scripts, and whatever the sweep finds:
  "ENV 1" → "Envelope 1", a module's "Macro 1" → "Macros 1", a Wavecraft's "Macros" → "Macros 1". Serum complete's own panel keeps
  Serum's words (serum-ui / serum-core / sx-host tests unchanged).
- **F**: cv-mods-ui.test (the ten bodies are faces), rig-ui.test (the slot variant, the chaos recipe), m3-fixture.test (its body half
  finds the controls on the face; its records and payloads stay byte-identical), ui-layout-wc.
- **U**: cv-tray.test's skin selector lists (:1628, :1699, :1724, :1751) gain `[data-cv-face]`; the views list.
- **H**: cv-module.test (`MOD_W`, `MOD_H`, `SX_MODS`, `modX`, `modJacks`' inline `out`), canvas-WC-sim's env / lfo / macros tile routing,
  ui-bench-fps.test (the scene list).

**Must not change**: every golden and frozen ref — **tests/ref-WC/base.json included** (G12's ports are hashed from each jack id,
tests/ref-WC/record.mjs:115–127, never from module sizes or jack sides; `cablesOf` is untouched); canonical-stream's fixtures; ref-MM;
Cut B's tempo-mods, fast-lane, motion, canvas-FR-sim and sx-host.test's slot cases; master-mods G2 / G3; bench.json's rows; app.test's
worklet list; Serum complete's panel DOM (until 28).

---------------------------------------------------------------------------------------------------------------------------------

## 12. Questions for the user (short; the build follows the first guess until answered)
Q1–Q3 are answered (the user's answers, below). Q4 (Serum complete's legacy home) is superseded: 28 removes it.
- **Q5 Where the modulators live.** Serum's view leaves the Sources menu in the next stage. Where should the LFO, Envelope, Macros …
  tiles go? **First guess: a "Modulators" view of their own in the Sources menu, and still under Wavecraft.**
  **Answered (the user, 2026-11-02): "Own Modulators menu"** — the first guess: their own Modulators view, and still under Wavecraft.

(Settled, not asked: the names. None of the ten is Serum's own; "Chaos" is a common word and stays, on the rename list before any sale —
the user's answer 1. Lines on every canvas but a Wavecraft's, IMPL-WC Q1; no Envelope on the master, IMPL-MM Q1.)

---------------------------------------------------------------------------------------------------------------------------------

## 13. Known limits (recorded)
- **Two hosts under one face.** A Wavecraft's own LFO / Envelope / Macros are part of its sound (saved with its presets, cleared by
  Init); every other one belongs to its track or the master. Visible differences:
  - a Wavecraft LFO's knobs take a cord from its Macros (Serum's matrix); a track LFO's take none (2b's `NOMOD_MOD`);
  - a Wavecraft holds at most 10 LFOs, 4 Envelopes (Envelope 1 the amp's) and 1 Macros: on a Wavecraft canvas one more is refused with
    its text (today a track Macro could be added there); a track has no cap.
- **A track module on a Wavecraft canvas** (an old project; a Wavecraft made on a track with modulators): lines and the left column, as
  today.
- **Old projects**: modulators keep their stored places with the faces' new sizes (they may overlap: Tidy); an old Wavecraft canvas may
  show a track "LFO 1" beside the Wavecraft's "LFO 1" (new adds never clash).
- **Destination names** keep the engine's ids ("OSC A · LEVEL"), IMPL-WC §13.
- **Numbers are fixed at creation**: deleting LFO 2 leaves LFO 1 and LFO 3. A Wavecraft's Macros reads "Macros 1".
- **WebKit / the iPad**: the faces move at Cut A's rate (`FAST_WEBKIT = 0`) until G8i and the iPad pass (IMPL-FR-B §6).

---------------------------------------------------------------------------------------------------------------------------------

## 14. What ROADMAP 28 removes (its own contract)
**After MOD1**: no modulator shows a Serum panel; `mountSlot` has no caller; rig-ui imports no `partView`; the Modulators have their own
view (Q5); the `mods` frame-cost scene replaces the harness's Serum-complete one.

**For 28** (the user: "you can remove serum complete entirely then"; canvas saves need no care; `main` untouched):
1. **Serum complete**: the model and its tile, the Serum view, serum-ui.js and its tests, "Make it a Serum (complete)" on a Wavecraft,
   the `#serum` URL, the harness's `serum` scene, ref-WC's `serum` G12 session (a frozen ref changes there: 28's contract says how).
2. **The parts machinery**: sx-ui-mod.js `mountSlot`, `PART_W`, `PART_PH`, `COL`, `phaseOf`, `partView` (callers checked); `mountPart`
   — still the rig's Arp / Clip fallback (main.js:8081) until those get faces (WC-2) or leave; cv-module's `PART_W_DEF` / `PART_H_DEF`
   Serum entries; main.js's parts-view paths; canvas-3-sim's Serum-part cases; m3-fixture's parts half; `LAY_UI 'parts'`.
3. **An old canvas project with a Serum complete track still opens** (the user): 28 decides what that track becomes.
4. **Kept** (the Wavecraft's): the Serum engine (serum-dsp, the sx-* scripts, mod-core), serum-core.js, sx-host.js (`SerumHost`,
   `slotHost`), the donor classes in sx-ui-mod.js / sx-ui-osc.js, graph.js, cv-graph's injection path for Wavecraft knobs.
5. **Words**: no "Serum" in any user-visible string on canvas (G8's scan over every canvas).

---------------------------------------------------------------------------------------------------------------------------------

## 15. Notes (the builders fill in)

**Phase 0 (2026-11-02; the tests first, then the code, from 5a76aca).**
- **Built as written**: cv-mods `MOD_LABEL` env 'Envelope', macro 'Macros'; `MOD_COLS` (§2.3's numbers); `numsOf(t, kind)` (ascending;
  `'macros'` reads the track's `macro` devices, so H passes the rig kind as it is: `RC.nextOrdinal(rig, kind, parts, numsOf(t, kind))`;
  [] for a singleton). rig-core `MODULES.macros.labelN` ("Macros 1"; the generic `label` stays 'Macros': rigFull's "Macros is on the
  canvas"); `nextOrdinal(rig, kind, parts, taken)` (`taken` an array or a Set, integers 1…99, garbage ignored; without it as before).
  cv-tray `MOD_TILES` LFO · Envelope · Macros first (names = `MOD_LABEL`'s), `RIG_TILES` osc sub noise filter arp clip; `MASTER_MODS`
  unchanged; `MOD_ORDER` (Tidy's order) unchanged. tests/mod1-model.test.mjs holds every phase-0 fact (7 tests).
- **Not re-exported by cv-model** (phase 0 owns no cv-model.js line): H imports `numsOf` / `MOD_COLS` from cv-mods.js as main.js:35
  already does, or adds them to cv-model's re-export.
- **Pins moved**: cv-mods.test, cv-tray.test (`MOD_TILES` order; `RIG_TILES` 9 → 6 — the WC part-tile test runs on four tiles and taps
  Noise; its Envelope / LFO glyph pins (an ADSR on a baseline, three handles each) are **lane U's to re-pin on the Modulators' tiles**;
  the master's "+ Add Macros" ghost and its flat-list order), rig-core.test (labelOf / barOf "Macros 1"), cv-migrate.test (toV1's
  lost line), canvas-2b-sim ("Edit Macros 1"), canvas-del-sim ("Delete Macros 1"), canvas-MM-sim ("Edit / Delete Macros 1"),
  canvas-WC-sim (the "+ Add a track…" test's one-off tile: Noise for Macros — **H pins the Macros tile's routing**), fx-ui (a row label
  given as input), ui-bench-m3 (its slot titles), ui-layout-wc (the Macros face's title).
- **§11 guessed, nothing to move**: classic-panel's 'Macro 1' and cv-model.test's are a macro **knob's** name (normModDev's defaults
  "Macro 1" … "Macro 8": an `mN.kK` source reads its knob's name; "Macros 1 · 2" shows only for an emptied name); rig-model (MODULES'
  labels unchanged); ui-bench-m9 (the 993's ENV 1–3 are its panel's legends). cv-mods-ui.test's 'ENV 2' / 'MACROS' / 'CHAOS 1' are the
  Serum panels' titles: lane F's. The inspector's "LFO 1/10 · ENV 0/4 · ext 0/16" counts ModCore's engine slots, not modules: kept.
- **Found for the lanes / reviewers**: (1) cv-mods `linkSources` names a Serum-engine device's own LFOs / Envelopes "<model name>
  LFO n" / "… ENV n" by engine slot, not by `dev.rig.n` — main.js `modSrcList` (the source menus) lists them on a rig track (G8's scan);
  not phase 0's words (MOD_LABEL / labelN): H or a fixer (a rig's: labelOf over its `n`; Serum complete keeps Serum's until 28).
  (2) main.js `sxPartsDecor` still loops over env / lfo / macros (setPartPlaced ignores a missing tile): H's cleanup.

**Lane F, the faces (2026-11-02; from cfdcc9f, the tests first at 9face2d).**
- **Built as written**: rig-ui `face(…, { slot: true })` — the title from the module id's number (`l3` → LFO 3, `h2` → Chaos 2), the ⋯ the
  old body's item for item (tested against the old panel on a second slot host), data-nomod and the master's MONO lock from the host's
  opts; a local `partOf` (rig-ui imports no `partView`); the `chaos` recipe and builder over `ChaosRow`; `View.donor`. cv-mods-ui
  `slotBody` mounts the face (the Cut B forwarding line as it was; `host()` the slot host; `shown` reaches the face's view: an off-screen
  face is no shown view of its host), `ready()` imports rig-ui; the six plain faces on the RIG grid (`MOD_FACE`, their screens' CSS
  injected once: `#rig-mods-css`, the skin's display tokens). No app file calls `mountSlot`.
- **[C] refined, with reasons**: (1) **Chaos** = a large scope screen (the monitor's value, one sample per snapshot while shown, the kit's
  display canvas) with S&H on it, BPM · RATE · MONO in the knob row, OUT; no head. Four controls on three columns reach G11's fill band
  (0.55) only with a screen (0.27–0.50 without), and the face stays at 1.2 × the old panel's elements (36 / 30, G11's ratio: container,
  root, panel; the inline OUT and the scope are the new ones). (2) Every plain face has a 128 px screen: a two-column face fills 0.557
  only so. (3) The wheel's chip reads "+N tracks" (its column is 64 px); its aria label and tip keep "+N on other tracks". The meters
  stand (Aftertouch from the bottom, Bend from the centre, up = up); CC's box shows the number (its label CC), the channel its caption.
  (4) An empty ⚙ drawer is not appended to a face (one element: the slot faces' count); the park stays. (5) A Macros rename's field goes
  into the tile's cell — on a Wavecraft's Macros too, where it went into the donor's detached box (invisible): rig-ui.test pins it.
- **Pins moved** (§11, F): cv-mods-ui.test (the ten bodies are faces; the Serum panels' titles 'ENV 2' / 'MACROS' / 'CHAOS 1' gone), rig-ui.test
  (FACE + chaos, its geometry, the slot faces, the rename), m3-fixture's body half (every control found on the `.rig-face`; records,
  payloads and renders byte-identical, unchanged), tests/ui-layout-wc.mjs (the ten faces, G5).
- **G5** (tests/ui-layout-wc.mjs in Chrome for Testing — its default now, never /Applications/Google Chrome —, downloads denied, a
  `--profile` dir): green at 1440 × 900, 1366 × 1024 and 1024 × 1366, Inter and the narrow face; elements LFO 146 / 127, Envelope
  145 / 137, Macros 126 / 126, Chaos 36 / 30, the plain faces 12–32 (≤ 48); data-dest parity; the words; a switch to ivory / glass moves
  no face's box.
- **For H**: pass `devKey` for a CC too (its title "CC n"; today only the slot kinds get it); `shown: () => cvLive(key)` (the face takes
  it); sizes — the widths `faceW(MOD_COLS)`, the heights (content, measured): LFO 400, Envelope 428, Macros 236, Chaos 312, CC 312, the
  others 224 (+ the bar); every face's OUT is `span.rig-jack[data-jack="out"]` in its jack row (data-rig-sig 'mod'). A slot body's el is
  `div.cv-mface` (no `.cv-mbody`: style.css pads that), a plain body's el is the `section.rig-face` itself (the wheel's press area is
  its first child: canvas-2a-sim).
- **For U**: the faces' colours come from the skin's tokens on the face (`--sxd-*` for the screens, `--sx-*`, `--rig-*`): the skin blocks
  need `.cv-mod[data-cv-face] .rig-face` (and `.sx-root` for the slot faces, whose root is an `.sx-part`). style.css's 2a / 2b body rules
  (`.cv-mw`, `.cv-mbar`, `.cv-mkey`, `.cv-mlearn`, …) have no element left (cv-tray.test pins some of their selectors: U's call).
**Lane U (2026-11-02; cv-tray.js, style.css, tests/cv-tray.test.mjs — tests first: 0995128).**
- **Built as written**: SRC_VIEWS `mods` (label "Modulators", after the rig view; one section, the Modulators', which also ends the rig and
  Serum views; no layout of its own); Hardware / Simple's note `TO_MODS` ("Modulators: the Modulators view. Serum: the Serum view (the menu
  above)."), the rig view's note "Drop a <NAME> module onto the canvas …" (its own modules only); the LFO / Envelope / Macros tiles wear the
  rig's glyphs (they moved from `PART_GLYPH` to `MOD_GLYPH`; the cv-tray.test pins are back on them: the ADSR on a baseline, three editor
  handles each, four panes); the `[data-cv-face]` chrome (case, bar, title, body, face, labels), its screws and jack row (the rig's own
  rules, selector lists extended), the three skin blocks (+ module, `.sx-root`, `.rig-face`; variables and their order untouched, the
  contrast gate unchanged and green), the glass pane and frost.
- **The name collides: `data-cv-face` is already cv-face.js's tier attribute on a hardware module (`gl` | `dom` | `svg`; cv-face.js:335,
  main.js sxHeavyCount reads `'gl'`).** A bare `[data-cv-face]` rule would skin every instrument, so every selector is
  `.cv-mod[data-cv-face]:where(:not([data-cv-face="gl"], [data-cv-face="dom"], [data-cv-face="svg"]))` (`:where`: the rig's specificity;
  checked in Chrome for Testing: `""` and `"mod"` skinned, `"svg"` and `"gl"` not). So the modulators' mark is the attribute with **any
  other value** — H sets `''`, as `data-cv-rig` / `data-cv-fx`. **H's `faceMark` must not copy `rigMark`'s `hasAttribute` toggle** (it would
  strip cv-face.js's value from every hardware module and cv-face never re-sets it: `F.mode === m` returns early); remove only a mark it
  made (`getAttribute('data-cv-face') === ''`). `wkPopSkin`'s `closest()` needs the same guard (else an instrument's popups take the rig's
  skin), as does any `[data-cv-face]` test in tests. The H6 hook `:not([data-cv-face])` skips a marked module, so a sibling rule contains
  the modulators' bodies.
- **For H**: `srcModeUI` (main.js:6512) has no `v === 'mods'` branch: the default text ("Tap one to use it in place of the <model>") is
  wrong there (a tap adds a module; in the rig view the Modulators row behaves differently from the module tiles above it). The tile
  routing (rigAdd / modAdd, never rigReplace) is H's as written. `setPlaced` ignores `multi` tiles, so "grey on a full Wavecraft" needs a
  new tray method (ask lane U); `#srcModSec`'s own "Modulators" heading (index.html) repeats the view's name in the Modulators view.
**Lane H (2026-11-02; tests first 3afdb58, the host a9156c1, from cfdcc9f).**
- **Built as written**: `modTile` (a Modulators tile's tap / drop: on a Wavecraft track LFO / Envelope / Macros → `rigAdd` (`RIG_MOD`, macro →
  macros), else `modAdd`; never a replace, never a new track; `cv.mod.add` stays `modAdd`: the hook's track device); `sxPartDrop` of a
  modulator kind on another instrument → `modAdd`. Numbering: `rigPick` numbers every new LFO / Envelope / Macros (`RIG_NUM`) with
  `nextOrdinal(…, numsOf(t, kind))`, stored in `dev.rig.n`; `rigNumber(t, dev)` when a Wavecraft is made (`setTrackModel` → the rig: the
  tile's starter, a module tile's blank, Make it a Wavecraft) and in `rigLoad` (starter / Init on one) — only kinds the track holds devices
  of, written only where a number moves. `faceMark`: **`data-cv-face=""`** (lane U's note: cv-face sets "gl" / "dom" / "svg" on hardware
  modules — the mark is the empty value, removed only when it is ours; `wkPopSkin` matches `[data-cv-face=""]`). `modMount` passes
  `shown` and `devKey` (every kind: CC's "CC n", lane F's ask). cv-module: `MOD_W` = faceW(MOD_COLS), `SX_MODS` every kind, out inline
  (y JACK_Y the fallback), the slot faces' cost 160, the plain 40 (as before); **`MOD_H` unchanged** (Tidy's guesses: cv-migrate's
  STEPS[6] reads them) — main's `modHt` guesses a face's height from the RIG grid (`modFaceH`: rig-ui sizeOf / cv-mods-ui MOD_FACE,
  = lane F's 400 / 428 / 236 / 312 / 312 / 224 + the bar). `linkSources`: a rig's LFO / Envelope by `labelOf(part, dev.rig)`.
  `sxPartsDecor` over `RIG_TILES`. `srcModeUI` 'mods' (lane U's view): a tap adds, in either mode.
- **G6**: the `mods` scene **added** beside `serum` (§14: 28 deletes `serum`; its pins kept). The ten modulators dropped as two rows of
  five and framed with the Juno (Tidy's one column is taller than any viewport at K_MIN 0.25: the top LFO fell off screen); expect the six
  LFO / Envelope playheads (min 6); the smooth probe runs on it. With F + U merged, Chrome for Testing, 1 ×: d 60 / 240 cost med 0.40 /
  0.19 ms, p 0.32 / 0.11, every live check and probe ok. The A/B against 3b5e1b1 is reviewer 2's.
- **Pins moved outside §11's list** (forced by §4.3's widths and measured heights; the lead to confirm): canvas-2a-sim (the wheel /
  Aftertouch / Bend at modX −256; slots 100 + VGAP apart — the stub DOM's measured 100), canvas-3-sim (the LFO 352 / −448, ENV 352; the two
  tray drops use a Chaos: on that rig the LFO / Envelope tiles now add into it), cv-migrate.test (STEPS[6] grows to its frozen `MOD_W6`;
  "MOD_W6 === MOD_W" is now "≠": the freeze's purpose).
- **canvas-MOD1-sim** (17 tests): the lane-F face checks and the lane-U view words skip until those lanes are merged (both detected:
  rig-ui's chaos recipe, SRC_VIEWS 'mods') — merged locally with 9a1f367 + c54e80b: 17 / 17 green. sw.js not committed (§10).
- **Found**: (1) lane U's 'Modulators' view moves canvas-sim's views pin (:519, "Hardware … Moog modules": + 'Modulators') — no lane owns
  it. (2) `linkSources` lists all ten LFO slots of a rig: a slot with no module reads its slot number, which can repeat a renumbered
  module's ("LFO 3" twice) — old-number clashes only (§13). (3) The Modulators tiles stay live on a full Wavecraft (the tap says why):
  greying needs a tray method (setPlaced ignores multi tiles) — not built.
**Review fixes (2026-11-02; tests first ec0876c, from f53a00a).**
- **R1 P1** main.js `sxReshow` (the canvas's shown hook: on screen again, unfolded, the CANVAS tab back) reshows every modulator body's slot
  host too: a slot face mounted folded / off screen, or edited while hidden, was stale for good (canvas-MOD1-sim: R1-r × 4, R1-o, off screen, ROLL).
- **R1 P2** cv-mods `linkSources` lists a rig's LFOs / Envelopes only where a module stands (rig-core `partKeys`: laid, powered, a slot a matrix
  or a track row reads — nothing a cable uses goes); a title a track module shows already reads "LFO 1 · <name>" (an old project's clash, §13).
  Pin moved: canvas-MOD1-sim's numbering test (the amp "Envelope 1" beside the hook's track Envelope 1 is told apart).
- **R2 P2 [C] refined** `MOD_COLS` wheel / at / bend 2 → 3 (224; §2.3's 160 left a bar title 52 px: "AFTERTC"); `modBarSub(kind)`: a bar's
  sub-label only on a face of ≥ 4 columns (a 3-column bar holds "AFTERTOUCH", 97 of 116 px in Inter). Pins moved: mod1-model, cv-module,
  canvas-2a-sim, canvas-3-sim (modX −256 → −320). tests/ui-layout-wc.mjs builds each modulator's bar as cv-module does, at its face's width:
  titles and subs whole at the three sizes, both fonts, every skin. **R2 P3** the wheel's bar "Mod Wheel" (cvTitle: no device, its kind).
- **P3** the Modulators view hides its section's own "Modulators" heading (cv-tray setView; the rig / Serum views and the master keep it);
  its words true on a <NAME> ("an LFO, Envelope or Macros goes into it": AUTOPLUG plugs only an Envelope on a gate); the Note face a piano's
  two octaves from a C that steps an octave when a note falls outside (15 elements). A Modulators LFO tile dropped on a <NAME> lands there (test).

## The user's answers (2026-11-01)
1. **Every modulator gets the Wavecraft look** — Mod Wheel, Velocity, Aftertouch, Bend, Note, CC and Chaos too (the user: "yes give
   them all the wavecraft look"). The user asked whether Chaos is Serum-proprietary: the lead's answer (not legal advice) — a chaotic
   modulator is a general idea (simple chaotic maps) in many synths; Serum's look / design is theirs, ours is our own math and the
   Wavecraft face; the name joins the rename list before any sale (ROADMAP 15). Scope: in MOD1 if it fits the lanes, else the next
   small step — Chaos first (it still shows a Serum panel).
2. **Old track LFOs next to a Wavecraft stay where they are** (as recommended; a "Move into the Wavecraft" item may come later).
3. **One tile per type** — one LFO, one Envelope, one Macros, first in Modulators (the user: "there shouldnt be multiple of 1 type of
   module").
4. **Serum complete, later**: the Legacy tag + "Make it a Wavecraft" + the ⚙ "Show legacy instruments" switch, off (as recommended).
- **Corpus**: the lead asked the user for a saved project using LFOs (to add to the recording); none yet.
- **Old projects (the user, 2026-11-01): "i dont care if old projects get messed up at all."** → MOD1 drops the sound-identity proof
  for converted projects (no corpus recording, no 0-sample render gate for conversions, no bit-exact constraint on where a converted
  module lives). Kept: an old project still **opens and plays without errors** (the migration may change its sound / layout); the
  frozen refs and goldens of today's engine stay as they are (they test the engine, not old files). The lead re-plans the lanes
  smaller on this basis before building.
- **Serum complete (the user, 2026-11-01): "you can remove serum complete entirely then"** — §14's later stage (ROADMAP 28) removes it
  from canvas outright (no Legacy tag, no ⚙ switch: Q4's answer superseded); canvas saves need no care. The old app (`main`,
  synth.domlavin.com) keeps its Serum untouched — the user's brother may use it.

---------------------------------------------------------------------------------------------------------------------------------

## 16. Skeptic + re-plan (2026-11-02)
Against the contract at b8351e7 (written before Cut B landed), today's tree at 3b5e1b1, and the user's answers above. 4 P1 · 10 P2 ·
10 P3; each with what the re-plan did (the sections above already carry it).

**P1**
- **P1-1 The sound-identity proof is moot, and it was most of phase 0.** §1's proof by record and by render, D1's "a converted project
  posts the same messages", G2 (a corpus of real saves written through `bootMain`, recorded once from ⟨B⟩), G3 (0 samples differ, live
  and bounced), G4's schema chains. The user: old projects may change. → Cut. D1 now holds by construction (nothing stored changes, §2),
  checked by the frozen ref-WC record and m3-fixture's body parity (G1); the floor is G2 "opens and plays".
- **P1-2 Every Serum-complete item is thrown away by 28.** D3's "Serum complete's canvas", corpus (b), G5 / G6's Serum-complete cases,
  §14.3's legacy plan, Q4. → Cut. Serum complete gets the faces for free (its modulators are track devices) and appears only in G2's
  floor while it exists.
- **P1-3 Scope gap against the user's binding answer 1.** D5, §13 and G10 left Mod Wheel, Velocity, Aftertouch, Bend, Note and CC on
  their old bodies and Chaos on Serum's `ChaosRow` through `mountSlot` — a Serum-part UI dependency 28 would have to undo. → §4.1–4.2:
  all ten kinds get faces; Chaos a rig-ui recipe over its slot host; `mountSlot` left with no caller (G8).
- **P1-4 §11 planned to re-record ref-WC's G12 sessions** ("their geometry moves by design"). False: G12's ports come from a hash of each
  jack id (tests/ref-WC/record.mjs:115–127 `portsOf`), never from module sizes or jack sides; with §6's cords cut, `cablesOf` and
  cv-cables are untouched. Re-recording a frozen ref without cause would loosen a gate. → §11: base.json must not change; G1 runs
  record.mjs.

**P2**
- **P2-1 Schema 18, `ord` and the place step are not needed.** Ids are never reused (cv-model.js:402–406), `rig.n` takes any part key
  (rig-core.js:179, :184–199); a clash needs both hosts on one canvas, which the tiles no longer create; the place step (`MOD_W18` /
  `MOD_H18`, a generalised `growTrack`) served only old layouts. The bump also moved schema pins in seven files and made phase 0 wait
  for lane F's face spike. → §2: schema 17, numbering in the add paths, `MOD_COLS` fixed in phase 0.
- **P2-2 §6's two-host extras** (a track module's rows as cords on a Wavecraft canvas through a new `cordOf`, the rig's Tidy band for track
  modules, the LEVEL refusal) serve only canvases holding both hosts, and touched `cablesOf` (a ref-WC risk) and Tidy. → Cut; lines and
  the left column as today (§13).
- **P2-3 Citations stale after Cut B** (main.js +450 lines net, sx-host.js +358): `slotHost` :4290 → :4633, `overlaySlot` :4234 →
  :4575, `readSlot` :4256 → :4597, `live` :4360 → :4707; `slotBody` :249–299 → :277–302 (`mountSlot` :283 → :286; it forwards
  `sampleRate` too); main.js `modMount` :9584 → :10010, `mcMonitor` :9666 → :10093, `mcSnap` :9677 → :10105, `sxInjEnv` / `sxInjSnap`
  :9712–9720 → :10140–10167, tile routing :8237–8251 → :8645–8648, `SXMOD.mountPart` :7684 → :8081, the popups' skin :8354 →
  `wkPopSkin` :8749; style.css's skin blocks :1555–1594 → :1660–1728 (the chrome is :1555–1600). → §0 and §7 rewritten against 3b5e1b1.
- **P2-4 §7 missed Cut B pieces MOD1 can break**: main.js `bodyHost` / `bodyAns` / `bodyReset` (:3257–3260) read `B.host().sl` and
  `.fastReset()`, so the face body's `host()` must stay the slot host; the `'sx-fast'` tick is a `shed` client of the drop levels;
  `heavyMs` / `heavyHz`; `RING_N` 128; `FAST_WEBKIT = 0` (no lane on the iPad). → §7 lists them; §4.1 pins `host()`.
- **P2-5 G9 named "M-B's tests/cv-mods-ui.test.mjs cases"; there are none.** Cut B's slotBody case is tests/sx-host.test.mjs:1256; the
  body cases are canvas-FR-sim :349 / :389 / :430 and canvas-MM-sim. → G7 names them.
- **P2-6 G6's "`__synthTest.fr.trace` moves every painted frame on a merged LFO face" cannot see a track LFO**: trace's probe reads only
  `serumPanels`' hosts (main.js:3433). → G6: the harness's `arc` hook on `.gx-lfo canvas.gx-ov` in a new `mods` scene (a Juno), which also
  outlives the harness's `serum` scene that 28 deletes.
- **P2-7 §5 left the Modulators in the Serum view and the Wavecraft view only.** 28 deletes the Serum view, leaving a Juno's LFO tile
  under "Wavecraft". → Lane U gives them a home now (Q5's first guess); 28 only deletes the Serum view.
- **P2-8 §8's exports for row 26** (`isLfoSrc`, `lfoStateOf`, `phase()`) have no caller in MOD1. → Not built; row 26's contract.
- **P2-9 tests/m3-fixture.test.mjs:413–423 drives `slotBody` → `mountSlot`** and was not in §11. → Lane F owns it; its body half becomes
  G1's parity check.
- **P2-10 iPad cost.** Every slot body's tick runs while off screen today: `mountSlot` passes no `shown`, and `tickLive` (sx-host.js:2696)
  counts that as shown. G7's "≤ 1.2 × the old body" means nothing for a 10-element meter. → H passes `shown: () => cvLive(key)` (G3 pins
  it); a plain face ≤ 48 elements (G5); G6 measures the `mods` scene A/B.

**P3**
- **P3-1** §2.2 said "a user `name` still wins on a track device": no title reads `dev.name` (main.js:7232, :7446). → Dropped.
- **P3-2** D1's DSP list missed fx-mods2.js, dr-808 / dr-seq and moog-dsp. → "engine.js and `DSP_FILES`" (main.js:931–932).
- **P3-3** G10's word scan would flag the macro knobs' kept names "Macro 1 … 8". → G8 allows them.
- **P3-4** ⟨B⟩ was undefined (Cut B had not landed). → 3b5e1b1 + this contract. The harness still makes worktrees from `main` (this
  skeptic's started at ee2a939): every lane resets first.
- **P3-5** The Modulators tiles are `multi` (never greyed): a full Wavecraft says why on the tap, not by a greyed tile. → Recorded (§5);
  H may grey them on a Wavecraft track if cheap.
- **P3-6** `mountPart` keeps one caller after MOD1, the rig's Arp / Clip fallback (main.js:8081). → Noted for 28 (§14.2).
- **P3-7** The only frame-cost scene with track modulators on an instrument is the harness's `serum` scene, which 28 deletes. → The
  `mods` scene (G6).
- **P3-8** The names: none of the ten modulator names is Serum's own; "Chaos" is a common word and stays (the user's answer 1: on the
  rename list before any sale). → Not asked again (§12).
- **P3-9** Lane collisions: the old plan's label pins (canvas-2b / 3 / MM / WC-sim) had no owner while F and H both touched sims. → Every
  label pin moves in phase 0; canvas-WC-sim is H's alone; cv-tray.test is phase 0's, then U's (in sequence).
- **P3-10** `n: o.ord` from `modMount` coupled F to H. → The face derives its number from `devKey`.

**The re-plan in one line.** Phase 0 = the words, `MOD_COLS`, the add-path numbering helpers and the tile data (no schema, no corpus);
then three parallel lanes on disjoint files — F (all ten faces), U (the Modulators view, the skins), H (routing, numbering, sizes, jacks,
marks, the `mods` scene) — two reviewers, the sweep, deploy; then ROADMAP 28 deletes Serum complete and the parts machinery with no
modulator left on them.
