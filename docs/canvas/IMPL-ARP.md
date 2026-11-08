# IMPL-ARP — the Arpeggiator module (Wavecraft, the first WC-2 face)

**Status:** contract, 2026-11-08 (the Fable lead), revised after the skeptic (§11: 20 items, all folded in). The user: "do we have a
arpeggiator module?" → "the word" (go). Branch `wt-ARP` from canvas cce9c07. The Clip sequencer is **not** in this stage (the user asked for
the arpeggiator; its face is the same shape — §9).

**The lead's guesses (the user has not answered; reversible):** (1) the **pattern editor opens over the canvas in the top layer**, never
inside the 544 px face (§4); (2) **MIDI OUT and the RATE field live in the head's ⚙ drawer** (§3); (3) the face's words are ours — the bar
reads **Arpeggiator**, the slots keep their note names, "ARP" / "Arp" appears nowhere on the face (§5); (4) the Arpeggiator tile dropped on
a non-Wavecraft instrument starts the **starter rig with the Arpeggiator plugged in** (it must sound; §1.3).

## 0. Facts (verified in canvas cce9c07 by the lead and the skeptic)

- **Engine: done.** sx-seq.js is the arpeggiator; `arp.on` is a stored destination (serum-core.js:726), `arp.rate … arp.wrange` virtual
  ones bound to the selected slot (:727–739, `VIRTUAL` :789); `MODULE_FIELDS.arp.p = ['arp.on']` (:848: ⋯ → Init resets it → the cord
  pulls). Nothing in the DSP or the patch changes: **every golden stays bit-identical**, canonical-stream untouched. `AUTO_RIG_NO` keeps
  `arp.*` out of automation (main.js:1309).
- **State: done.** `s.arp` = { slots[12], sel, bank, dirty, quant, editAll, midiOut, outTrack }; `s.ui.arpEd` (serum-core.js:1832) is a
  **stored** view flag the page's paint opens the editor from. Schema 19 stays: no new field; the ui view fields are written as the page
  wrote them (`edit` with `ui: true`).
- **The page view: done.** sx-ui-seq.js `ArpPage` (:803–1012): GLOBAL (BANK ▾ · LAUNCH QUANT ▾ · EDIT ALL) · SLOTS (`SlotStrip` :671: 12
  keys in two grid rows (black above white, no overlap), 14 columns / 4 px gaps ≈ 70 px a key; tap = select, ▶ = launch / stop through
  `host.seqCmd` 'arpLaunch' / 'arpStop'; long-press / right-click = the slot menu; `showNames` default true :815) · PATTERN (SHAPE ▾ · BPM |
  HZ · RATE knob + numBox (both `data-dest="arp.rate"`, the knob first) · TRIP · DOT · EDIT PATTERN) · TRANSPOSE (SHIFT · RANGE · RANGE SHAPE ▾
  · TRANS) · PLAYBACK (LATCH · THRU · OFFSET · REPEATS · GATE · CHANCE · PRE) · RETRIGGER (LAUNCH · RATE · EVERY · NOTE · FIRST) · VELOCITY
  (ENABLE · RETRIG · DECAY · TARGET) · MIDI OUT (seg · TARGET ▾, needs `host.tracks`). The shell `K.panel('ARP', 'arp', 'arp.on', …)` hands ⏻
  to the bar (`bare`; its aria "ARP on", sx-host.js:3961); `P.shell.menuItems()` already = `moduleMenuActs('arp', null, moduleItems)`
  (sx-host.js:3970), `ArpPage.menuItems()` = lockItem + module items. The **pattern editor** (`PatternEditor` :1014) appends itself to
  `page.el` (:1086), is built inside the paint by `this.fn(() => this.syncPattern())` (:847 / :991) whenever `s.ui.arpEd` and SHAPE =
  Pattern; its CSS `.sx-seqov { position: absolute; inset: 0 }` (:273) and, outside the world, `@media (max-width: 1099px) … position: fixed`
  (:296); its roll is 360 px tall (:302) plus head, row, lanes 96 and tabs (:303). Its popups (`menuAt` / `wk.contextMenu` .wk-ctx, knob
  menus, `K.prompt` → `layerEl`, sx-host.js:3234) live outside it. `defineView('arp')` (sx-ui-mod.js:777) stays: sx-host.test.mjs:113
  pins `viewKinds()` = ['arp', 'clip']; main.js:8855 takes the face when `RIGUI.FACE[kind]` exists, :8857 the page otherwise.
- **The module: defined, gated.** rig-core.js:145 `MODULES.arp` { cols 8, max 1, slots ['arp'], power, OUT (note), rows ['head', 'screen',
  'jacks'], **cut 2** }; AUTOPLUG arp → `voice.note` (:153). **A note cord = `arp.on`** both ways (sx-edges.js:214 / 250, rig-core pull
  :471); ⏻ on with no cord draws the cord (`partOn`, sx-edges :144); Remove turns ⏻ off (main.js:9822). The tile: `RIG_TILES` + glyph
  (cv-tray.js:695 / :714), hidden while `cut > RIG_CUT` (= 1, :694 / :1011); the Note tools placeholder (:607) is skipped once the group has
  a live tile (:1077 `pbox.has`). The tile on a non-rig instrument: `sxPartDrop` → `rigReplace('arp')` (main.js:9435 / 9864) over
  `rigBlank` (every source off: silent). `rigSlot` maps 'arp' → part 'arp' (:9697); the bar's "· Arp" badge reads `arp.on` (:647). Size:
  `RIGUI.sizeOf` once FACE has the kind (:9498 / :9501); `PART_W_DEF.arp` 480 × 384 then unread.
- **The face system.** rig-ui.js: `FACE[kind]` recipes on the RIG grid (rig-grid.js GRID: column 64, pad 16, rows head 32 · screen 112 | 128
  · knobs 76 · switches 32 · jacks 56, gap 12, top 12, bottom 16; a short row starts at ⌊(n − S) / 2⌋ — **S must have n's parity**,
  rig-ui.test.mjs:110 asserts it; `mid` is fx-ui's alone), `BUILDERS[kind].build(ctx)`, `resolve` (a named piece, else the donor's widget by
  data-dest — virtual ids as written —, else a fresh knob), the dim policy, `ctx.drawerItems` (⚙), `ctx.menuItems` (⋯), `shellItems(P)`,
  `wrapDisp` (any element), `boxCell` captions, `RELABEL`. Rig CSS sizes `.sx-hbtn` / `.wk-tog` / `.wk-mbtn` (rig-grid.js:116–131): a knob
  cell's `.wk-menu` is `--rig-sw` 56 wide with its `.wk-lab` hidden; a seg has a rule in switches rows only (:123); `.sx-seqbtn` has none
  (touch min-height 44, sx-ui-seq.js:300 / 305; `.sx-bankbtn max-width 200`, :249). The kit K the builder gets is the view maker's kit
  (sx-host.js:1946). Drawer precedents: skin attribute copied (rig-ui.js:346), `H.scanMods()` after open (:357), the outside-tap exclusion
  `closest('.wk-ctx, .wk-pop, .sx-pop')` (:351), `addTransient` closes on a camera move (wk.js:2933). `H.layerEl()` = the top layer
  (sx-host.js:3143–3145; the host root when no layer is set).
- **Tests touching this ground** (update, never weaken): rig-ui.test.mjs:80 (FACE keys exact), :110 (row parity), :63 (parity uses
  `DESTS3.parts.rig[part]`); tests/fixtures/sx0-dests.json `parts.rig.arp` = **11 ids** (rate shift range offset repeats gate chance rrate
  vdecay vtarget trans; not arp.on, not the editor's wtrans / wrange); rig-model.test.mjs:140 (`cut` list); cv-tray.test.mjs:1163 / 1182 /
  1191 / 1203 / 1237 / 1243 / 1248 (four live tiles, the placeholder, fifteen glyphs); canvas-3-sim.test.mjs:637–651 (arp through
  mountPart at 1184 / 'P'); canvas-WC-sim.test.mjs:1250 (the note text), :424 (G13's regex `/Serum|VOICE|Xfer/`); sx-host.test.mjs:113 /
  116; tests/ui-layout-wc.mjs `FACES` :89, `DONOR` :60 (no arp), no `wk.setLayer` / `[data-cv-world]` in its page.

## 1. Scope

1. **The Arpeggiator face** on the grid: `FACE.arp` (8 columns = 544 px) + `BUILDERS.arp` over an `ArpPage` donor (§2–§3). Every control the
   page shows is on the face or in its drawer (G11's parity; nothing dropped).
2. **The pattern editor in the top layer** (§4) — the lane's second gated step.
3. **The tile live**: `MODULES.arp.cut = 1`, its rows the face's; the Note tools section shows its note **beside** a live tile when a
   later-cut tile remains in the group (cv-tray: the note line under the tiles, not the cv-tsoon placeholder), reading "The <NAME>'s Clip
   sequencer arrives in a later update."; "Arpeggiator is on" once placed (exists). The Clip sequencer stays cut 2 (its tile hidden, its
   `mountPart` page). **The tile on a non-rig instrument** (guess 4): the rig's **starter** (the rig tile's preset-style load, main.js
   rigReplace's starter path) **plus the Arpeggiator plugged into NOTE**, one step, the Replace notice naming both — never a silent rig.
4. **Words**: ours, everywhere the face speaks (§5).
5. **Nothing else moves**: no engine, no schema, no song.js, no new stored field; `defineView('arp')` and `mountPart` stay (the Clip, the
   view registry pin).

## 2. The face recipe (FACE.arp) — every row's span S has the parity of 8

```
head      ['#bank*', '#editall', '#gear']
screen L  ['#slots']                                                           512 × 128: the SlotStrip
knobs     ['#shape:2', 'arp.rate', 'arp.gate', 'arp.chance', '#edit:3']                       S 8
knobs     ['arp.shift', 'arp.range', '#rshape:2', 'arp.trans', 'arp.offset', 'arp.repeats', 'arp.rrate']   S 8
switches  ['#latch', '#thru', '#pre', '#bpmhz:2', '#trip', '#dot']                               S 8
switches  ['#rlaunch', '#rrate', '#rnote', '#rfirst', '#vel', '#vretrig']                        S 6 (centred)
knobs     ['#quant', 'arp.vdecay', 'arp.vtarget', '#ratefield']                                  S 4 (centred)
jacks     ['>out']
```

Height 12 + 32 + 128 + 3 × 76 + 2 × 32 + 56 + 8 × 12 + 16 = **632 px**; width 544. `MODULES.arp.rows` := ['head', 'screen', 'knobs',
'knobs', 'switches', 'switches', 'knobs', 'jacks'] and **G1 compares them to FACE.arp's row types** (a new assertion: no test does today).
The menus in knob cells (#shape, #rshape at `:2` = 128 px, #quant) are `rig-noarr` boxes with `boxCell` captions (SHAPE · RANGE SHAPE ·
LAUNCH); #bpmhz is the page's seg in a switches row (the rule exists there). #ratefield = the page's RATE numBox taken **by reference**
(`findDest` returns the knob first), captioned RATE. The lane may move #quant / #ratefield to the drawer (§3) if the gate shows the last
row thin — then that row is ['arp.vdecay', 'arp.vtarget'] (S 2, even).

## 3. The builder (BUILDERS.arp)

- Donor `new seq.ArpPage(null, K, { title: 'Arpeggiator', face: true })` — rig-ui imports sx-ui-seq.js directly (no new module file).
  `face: true` is a page option (§5's words, §4's editor hook); `title` names the shell (⏻ aria "Arpeggiator on"). `ctx.shell = P.shell`,
  `ctx.roots` = the page's section bodies (`P.sec.*`), `ctx.prefix` ''.
- Pieces: `bank` (the BANK button: class `sx-hbtn` added, `max-width` lifted on the face), `editall`, `gear` (`gearBtn(ctx)`), `slots`
  (`wrapDisp(P.slots.el)`), `shape`, `rshape`, `quant` (menus, §2), `bpmhz` (seg), `trip`, `dot`, `edit` (EDIT PATTERN: `sx-hbtn`,
  `aria-pressed` while the editor is open), `latch`, `thru`, `pre`, `rlaunch`, `rrate`, `rnote`, `rfirst`, `vel`, `vretrig`, `ratefield`.
  Knob cells resolve by data-dest.
- Drawer `ctx.drawerItems`: [{ items: the MIDI OUT seg and its TARGET menu }] (fix round: no title — the seg says MIDI OUT).
- ⋯ `ctx.menuItems = shellItems(P)` (one Lock Module; Init resets `arp.on` → the cord pulls: G4 records it).
- Labels (RELABEL, aria names kept in full): switches S1 LATCH · THRU · PRE · BPM | HZ · TRIP · DOT; S2 **ON PLAY** (retrigger on launch) ·
  **ON RATE** · **ON NOTE** · **FIRST** · **VEL** (velocity enable) · **VEL RST** (velocity retrigger); knobs RATE · GATE · CHANCE · SHIFT ·
  RANGE · TRANS · OFFSET · REPEATS · **EVERY** (retrigger every) · **VEL DEC** · **VEL TGT**; captions SHAPE · RANGE SHAPE · LAUNCH · RATE.
  Every label ≤ 7 characters at 11 px in a 56 px switch; the disabled rules stay the page's (TRIP / DOT in BPM mode, EVERY with ON RATE,
  the VEL knobs with VEL): the dim policy shows them, never hides.
- Slots on the face: **the whole key is one hit** (the fix round, the lead's decision on R2 P2-2 — Ableton's clip-slot idiom): a tap
  selects the slot, a tap on the **already-selected** slot launches it (stops it while it plays); a tap on another key while one plays
  selects it, never launches; long-press / right-click = the slot menu, which opens with **Launch / Stop**. No ▶ button on the face
  (`SlotStrip`'s `face` option; the page keeps its ▶); the selected key shows a ▶ (■ while playing) glyph at its bottom-right as the
  hint — aria-hidden, no target — and its name's title ends "· tap again to play" / "· tap again to stop". G3: every key's select hit
  ≥ 44 × 44 and the key's centre point is the select. `showNames` **off by default on the face** (note names fit 70 px; Show Pattern
  Names stays in ⋯).
- OUT tooltip: a `tip` option on rig-core's `J('out', …)` that `jackOf` appends to the title: "plug into the Amplifier's NOTE to play".
- Destroy: the donor's `destroy()` (the editor closes with it).

## 4. The pattern editor (guess 1; the lane's step b)

- **Open only from EDIT PATTERN** on the face. `ArpPage({ face: true })` keeps a **page-local** open flag (`this.edOpen`) in place of
  `s.ui.arpEd`: `syncPattern` reads it, `openPattern` / `closePattern` write it, nothing stored is written or read for the face (a
  project saved with the page's editor open never pops it on mount; §0's stored-flag paint path stays for the page).
- **Mount hook** (one line in sx-ui-seq.js:1086): `(page.edHost ? page.edHost() : page.el).appendChild(el)`. The builder supplies
  `P.edHost = () => body` of a top-layer panel it makes in `H.layerEl()` (never `#ov` directly): class `rig-seqpanel sx-arp` (the
  `--sx-seqc` colour lives under `.sx-arp`), the world's skin attribute copied (as the drawer, rig-ui.js:346), `data-dev`; `H.scanMods()`
  after open (the PITCH / RANGE knobs' halos). The panel's own CSS **resets** `.sx-seqov`'s `position: absolute; inset: 0` and the
  `max-width: 1099px` fixed rule (a `.rig-seqpanel .sx-seqov { position: static; inset: auto }` of higher specificity, and the media
  rule scoped out by `:not(.rig-seqpanel *)`): width `min(1024px, 100vw − 32px)`, height `min(640px, 100vh − 32px)` (the roll's 360 +
  head + row + lanes 96 + tabs), centred over the module in viewport px (the world's zoom never scales it), scrolling inside only if
  the viewport is shorter.
- **Closes** on ✕, Escape, a tap outside (exclusions `.wk-ctx, .wk-pop, .sx-pop, .sx-ov` and the panel itself: its menus, knob menus and
  the Save / Rename prompts stay), and **a camera move** (as the drawer: `addTransient`). The face's EDIT PATTERN reads pressed while open.
- SHAPE ≠ Pattern: the page's notice ("Set SHAPE to Pattern to edit a pattern") — the face's EDIT PATTERN is dimmed, never hidden.
- Touch: the roll's gestures are the page's (IMPL-3, already touch-capable).

## 5. Words

Bar title **Arpeggiator**; jack **OUT**; ⏻ aria "Arpeggiator on"; the SlotStrip's aria "Arpeggiator slots" / "Arpeggiator slot C" and the
slot titles likewise (`face: true` passes a `noun` to SlotStrip); BANK's label "Bank: <name>"; the labels of §3; the editor's title
"PATTERN" stays; no "Serum", "Xfer". **The rule is scoped to the face's own text**: the face element's `textContent`, every `aria-label` and
`title` of its descendants and of the editor panel ∌ `/\bARP\b|\bArp\b|Serum|Xfer/` (G4's scan). Not in scope: undo labels ("Arp Shape"),
`destLabel` names ("Arp Rate" — the engine's names, the renaming pass §9), the badge "· Arp" (main.js:647, the bar's shorthand: stays).
The Note tools note: "The <NAME>'s Clip sequencer arrives in a later update."

## 6. Gates

| | check | how |
|---|---|---|
| G1 recipe | FACE.arp: cols 8, rows as §2, every row's S even, `layoutOf` 544 × 632, every item parses; **MODULES.arp.rows = FACE.arp's row types**, cut 1; FACE's key list test and rig-model's `cut` list updated | tests/rig-ui.test.mjs, tests/rig-model.test.mjs |
| G2 parity | the face's data-dest set ⊇ `DESTS3.parts.rig.arp` (11 ids); every piece of §3 present and placed (none null, none in the park); the drawer holds MIDI OUT (seg + TARGET); #ratefield is the numBox, not the knob; ⏻ handed to the bar with aria "Arpeggiator on"; ⋯ = shellItems (one Lock); the slot strip's aria words | tests/rig-ui.test.mjs (new test, the fake DOM) |
| G3 layout | the 'arp' face in `FACES` of tests/ui-layout-wc.mjs with `DONOR.arp` (the page mounted hidden beside it for the element count): G11's numbers at d / l / p, charcoal · ivory · glass; every slot's select and ▶ hit ≥ 44 on touch; the contact sheets; **the editor open** — the harness sets a top layer (`wk.setLayer`) and a `[data-cv-world]` for that page — a shot per size, the panel inside the viewport, its roll not clipped | tests/ui-layout-wc.mjs (Chrome for Testing) |
| G4 flows | the tile adds an Arpeggiator to a rig (one step), auto-plugs OUT → NOTE (`arp.on` 1), the badge "· Arp", the face mounted (`rig:arp` 544 × 632 — never the 1184 page); undo removes it (arp.on 0); Remove pulls the cord; pulling the cord → ⏻ off, plugging → on, ⏻ on with no cord draws it; ⋯ Init pulls the cord (recorded); a slot ▶ posts `seqcmd` arpLaunch, ▶ again arpStop; EDIT PATTERN with SHAPE ≠ Pattern notifies, with Pattern opens the panel in the layer (not in the face), ✕ / Escape / outside / camera close it, a menu inside does not; a file with `ui.arpEd` 1 mounts with the editor **closed**; a schema-16 file with arp on opens with the face; the tile on a Juno → the starter rig + Arpeggiator plugged, sounding (a note renders > 0); the Clip tile still hidden, the note's new text beside the live tile; G4's word scan (§5) over the face and the panel; canvas-3-sim's mountPart case moved to the Clip | tests/canvas-WC-sim.test.mjs (new tests), canvas-3-sim, cv-tray.test updated |
| G5 sound | every golden-*, canonical-stream, rig-sound, canvas-M-bounce unchanged; `git diff --stat` touches no engine / DSP file; no new stored field (the ui view fields as the page wrote them) | the sweep |
| G6 hygiene | lint (?v=9, accessor ratchet), pwa (precache), ui-bench-wc's gates unchanged, sx-host.test's view-kinds pin | the sweep |

## 7. Lanes

One builder lane **F** (Opus, worktree `ARP-F` from wt-ARP) in **two gated steps**, each committed with its tests green before the next:
**(a)** the face, the tile, the words, the starter-plus-arp drop — G1 / G2 / G4 (all but the editor rows) green, G3's face rows passing at
d / l / p; **(b)** the editor's local flag, mount hook, panel and CSS — G3's editor shots and G4's editor rows. Failing-test-first. Then
**reviewer 1** (Opus, the real engine + the sims: hostile states — every slot playing, EDIT ALL, arp on with no Amplifier cord, a loaded
pre-WC file, undo storms, the drop on every instrument family) ∥ **reviewer 2** (Opus, Chrome for Testing d / l / p + touch: the contact
sheets, the editor at every size and skin, hits ≥ 44, the words, the tray) → **one fixer** → the sweep → squash onto canvas → deploy. No
phase 0: nothing in the model moves.

## 8. Known limits (recorded)

- The RATE field and LAUNCH QUANT may end in the drawer (§2's option); MIDI OUT does.
- The editor is one panel for every size (no phone layout: the app's floor is a tablet); on a short viewport it scrolls inside.
- MIDI OUT's TARGET lists tracks by name as the page did; `destLabel` names ("Arp Rate") are the engine's until the renaming pass.
- A camera move closes the editor (the drawer's rule).
- (fix round, R2 P3-5, recorded) The face's EDIT PATTERN sits under the centred editor panel while it is open (the panel is centred over
  the module): ✕, Escape and a tap outside close it; the button is not needed while the editor is up.
- (fix round) The bar's ⋯ / ▾ at 32 px and the 28-wide ⚙ are grid-wide (every face), not this stage's: left to a grid pass.
- (fix round, R2 P3-2) "The tooltip lingers onto OUT" is no bug: pointerleave fires and wk hideTip drops `wk-show`; the `.wk-tip` keeps
  its box at `visibility: hidden`, which a width > 0 probe counts. The jack's own tip is its native `title`.
- (fix round) The face's slot keys launch by a second tap on the selected key (or the slot menu's Launch): no one-tap launch of an
  unselected slot — a performer who wants that uses the page (the Clip sequencer's face takes the same idiom).

## 9. Left for later

The **Clip sequencer** face (the same recipe shape; its editor in the top layer as §4; `mountPart` then goes with the Note tools note) — a
stage of its own when the user asks. The oscillator interiors, the Amplifier drawer, the light-show and glass skins, the renaming pass.

## 10. Notes (filled by the lanes)

### Lane F (2026-11-08; `rig-ui.js`, `rig-grid.js`, `rig-core.js`, `sx-ui-seq.js`, `cv-tray.js`, `main.js`, `style.css`; tests rig-ui, rig-model, cv-tray, canvas-WC-sim, canvas-3-sim, ui-layout-wc)

**Built.** (a) 9394b09: `FACE.arp` + `BUILDERS.arp` over `new ArpPage(null, K, { title: 'Arpeggiator', face: true })` (pieces by section
index, knobs by data-dest, #ratefield the page's numBox labelled RATE on the face, menus `rig-noarr` with `boxCell` captions, `rig-wide`
for the two-column menus and EDIT PATTERN, toggles re-worded through their `.wk-tl` with the page's aria names kept, VEL DEC / VEL TGT in
RELABEL); MIDI OUT in the ⚙ drawer; ⋯ = `shellItems`; ⏻ "Arpeggiator on"; the slot strip fills the L screen (`.rig-slotsd`: a key's name
button covers the key, ▶ a 28 px corner box with a 44 px `::after` hit growing into the inter-key / row gaps); `MODULES.arp` cut 1, its rows
the face's, OUT's `tip` (J option, jackOf appends " — plug into the Amplifier’s NOTE to play"); the tray's Note tools show the Arpeggiator
tile with the note "The <NAME>’s Clip sequencer arrives in a later update." under it (not the cv-tsoon placeholder); a note-tool tile on
another instrument or as a new track starts from `rigStarter` (main.js `rigBase`), the notice "Replaced X with <NAME> · starter rig +
Arpeggiator · tap to undo". (b) 2606efc: the page's `edOpen` under face: true, the one-line `edHost` hook, rig-ui `edPanel` (the panel in
`H.layerEl()`, wrapped `openPattern` / `closePattern`, a K.custom sync for SHAPE leaving Pattern, EDIT PATTERN `aria-pressed`), the
`.rig-seqpanel` CSS in rig-grid, the three skin blocks in style.css carry `.rig-seqpanel[data-cv-skin]`.

**Deviations.** (1) §2's first switch row sums 7 (odd; G1's parity fails): PRE moved beside CHANCE in knob row 1 and EDIT PATTERN spans 2
(`['#shape:2', 'arp.rate', 'arp.gate', 'arp.chance', '#pre', '#edit:2']`); switches row 1 = LATCH · THRU · BPM|HZ:2 · TRIP · DOT (S 6).
(2) §2's height counted 8 gaps for 8 rows: the face is **544 × 620** (7 gaps). (3) EDIT PATTERN on the face is dimmed with
`aria-disabled` but not `disabled` while SHAPE ≠ Pattern, so a tap gives the page's notice (G4). (4) "Init pulls the cord (recorded)":
the record is the rig's panel undo ("Init Arp"), not an app History step — the kit's module menu edits through the host's undo, as every
module's Init does. (5) The ▶-plays-then-stops G4 row feeds the host one monitor message (`seq[0]` = the slot): the sim's engine posts
no sequencer state. (6) The sim's DOM has no `closest()` / bubbling / world: "a menu inside does not close it" and the layer mount are
asserted in rig-ui.test (its fake DOM, `wk.setLayer` + `[data-cv-world]`); the sim asserts the panel in `H.layerEl()`, not in the face.
(7) The editor's kit labels (8–9 px) are lifted to the grid's 10 px inside the panel; its overlay padding is half a unit vertically so
640 px holds roll 360 + lanes 96 + head / row / tabs without scrolling at l / p.

**G3 (ui-layout-wc, Chrome for Testing, d / l / p, Inter pass): green.** The face: 544 × 620, fill 0.613 (strict 0.515), min text-to-edge
20, text-to-control 6, text-to-text 10.5, min font 10, label / value contrast 13.07 / 5.59, parity 11 ⊇ 11, 319 elements vs the page's 297
(1.07). Touch slots: every ▶ hit 44.5 × 44.5 (hit-tested, never on a neighbour), every select 68 × 60 holding 59–61 % of its key, its
name point the select. The editor: d 1024 × 640 (roll 990 × 300), l 1024 × 640 (roll 990 × 360), p 992 × 640 (roll 958 × 360), inside the
viewport, no scroll, font ≥ 10, no "Arp" word. Contact sheets: wc1-faces-<size>.png and arp-editor-<size>.png.

**Left.** The narrow-face pass (`--narrow`) and the ivory / glass skins on the editor were not shot (charcoal only); the slot strip's
select gives up its ▶ corner (two disjoint 44 × 44 hits cannot fit a 70 × 62 key — the reviewers' call); the Clip sequencer (§9).

### Fix round (2026-11-08, the fixer; branch arp-X from 852b7eb; two reviews, 12 items, the lead's decisions)

**Fixed.** 1 (R1 P2-1) 0625bb7: ⋯ → Init on the Arpeggiator is one History step "Init Arpeggiator" + "· tap to undo" (rig-core
`arpInit` → main `rigArpInit` → `rigEdit`; the kit's Init asks `host.arpInit` first, as `envInit`), undo exact (the cord back, the module
kept) — R1 P3-1's "Init Arp" label falls with it. 2 (R1 P2-2) 2bed648: G4's "it sounds" drives the key at 0.8 (`api.noteOn`'s 0…1;
levelOf's 100 was refused by `arpAccept`) and counts the engine's generated onsets (gen 1 ≥ 4 a second; 0 unplugged). 3 (R2 P2-2)
404bdad: the whole key one hit (§3: select, then a tap on the selected key launches / stops; the menu's Launch / Stop; no ▶ on the face,
the selected key's ▶ / ■ hint); G3 measures every key's select ≥ 44 × 44 across the key and its centre point the select (the old ▶
corner failed: 25 failures at l). 4 (R2 P2-1) ab4f49a: `.cv-psec > .cv-tnote` wears the placeholder's look. 5 (R2 P2-3) 6ff6731: the
black keys keep their dark ground in every skin, their words the light engraving (ivory 1.10 → 13.29 : 1; G3's skin pass measures the
slot names). 6 (R2 P2-4) 218fd18: BANK's name in `span.sx-bankt` (ellipsis), the button `overflow: visible` (its hit 44 px again).
7 (R2 P3-1) f5611a1: the heads re-render when an edit turns arp.on / clip.on over (`sxSeqKey` / `sxSeqHeads` in the host's edit and
sxApply's direct path): "· Arp" right after a tap / drag add, gone on ⏻ off. 8 (R2 P3-2) 7c1766b: a face knob's tooltip uses the
face's label ("RATE: 1/16"); the lingering tip onto OUT is a probe artifact (§8). 9 (R2 P3-3) 6915c1c: lit controls on the violet
accent keep dark ink in every skin (ivory 2.29 → 6.41). 10 (R2 P3-4) 280b1c5: the roll fills the panel's free height (d 990 × 423, band
4 px; G3: no band > 24 px under the lanes, roll ≥ 360 in a 640 panel). 11 (R2 P3-6) 43cb290: the drawer prints MIDI OUT once.

**Left (recorded, §8).** 12 (R2 P3-5) EDIT PATTERN under the open panel; the bar's ⋯ / ▾ at 32 px and the 28-wide ⚙ (grid-wide).

## 11. The skeptic (2026-11-08, Opus; 20 items, read-only)

P1: knob row 1 odd (grid starts at ⌊(n − S) / 2⌋, rig-ui.test:110) → §2 every S even; the PatternEditor appends to `page.el` = the face
root and opens from the paint → §4 hook + local flag; "44 ids" was 11 × 4 states → G2. P2: `s.ui.arpEd` stored → §4; `.sx-seqov` CSS and
the 1099 px fixed rule, 480 too short → §4 sizes; outside-tap vs the editor's own popups → §4 exclusions; the placeholder skipped once a
tile is live → §1.3 note beside tiles; eight tests to update → §0 list; "Arp" in aria / titles → §5 scope + `face: true`; labels losing
their section → §3 RELABEL; `.sx-seqbtn` unsized on the grid → §3; menus in knob cells (56 px, no caption, arrows) → §2 `:2` + captions +
`rig-noarr`; the drop on a non-rig instrument = a silent rig → guess 4; slot hits < 44 → §3 slots; P3: ⋯ duplicating Lock → `shellItems`;
no rows comparison → G1; no tooltip mechanism → `tip`; the layout harness has no layer / world → G3; the layer mount's skin / class /
scanMods → §4; the stored-state footnote → §0 / G5.
