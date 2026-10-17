# SYNTH Canvas: architecture spec

| | |
|---|---|
| Status | Revision 2, for the user's review. Answers to §13 may change details, not the structure. Review fixes are listed in the [Review log](#review-log) |
| Branch | `canvas` (from `a02ab5d`). `main` and synth.domlavin.com are never touched by this work (one possible exception, a small "Export library" on main, is the user's call: §13 Q6) |
| Deploy | `tools/deploy-canvas.sh` → GitHub Pages repo `CorrugatedCarl/synth-canvas` → **canvas.domlavin.com**, installed as "SYNTH Canvas" |
| Plain-language version | [SUMMARY.md](SUMMARY.md) |
| Inputs | Five code maps (ui-shell, audio-graph, serum, modulation, interaction), three proposals (mvp-first, engine-first, ux-first), three judges, one review. The base is **ux-first**, with grafts listed in Appendix B |
| Conventions | Code is cited as `file:symbol` (line numbers drift). "World px" are canvas units before zoom; "screen px" are CSS px on the glass. *k* is the canvas zoom factor. Stages are named after the user's three milestones: **1a–1e** (milestone 1), **2a–2b** (milestone 2), **3** (milestone 3), then **4–6** (later) |

## Contents

0. [Decisions at a glance](#0-decisions-at-a-glance)
1. [Goals, invariants, non-goals](#1-goals-invariants-non-goals)
2. [User experience](#2-user-experience)
3. [Instrument tray and illustrations](#3-instrument-tray-and-illustrations)
4. [Interaction and gestures (iPad and desktop)](#4-interaction-and-gestures-ipad-and-desktop)
5. [Data model, migration, storage](#5-data-model-migration-storage)
6. [Per-track audio graph](#6-per-track-audio-graph)
7. [Universal modulation](#7-universal-modulation)
8. [Serum on the canvas](#8-serum-on-the-canvas)
9. [Performance budgets and platform (iPad)](#9-performance-budgets-and-platform-ipad)
10. [Milestones](#10-milestones)
11. [Testing strategy](#11-testing-strategy)
12. [Risks](#12-risks)
13. [Questions for the user](#13-questions-for-the-user)
- [Appendix A. Files](#appendix-a-files)
- [Appendix B. Where each decision came from](#appendix-b-where-each-decision-came-from)
- [Review log](#review-log)

---

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **The app becomes one fixed, full-screen view: a canvas framed by trays.** Top tray: header, transport, arrangement toolbar and tracks (collapses to one row; a grip reveals 1…N track rows). Bottom tray: today's keyboard. Left tray **Sources**: instruments drawn as small physical instruments, Serum parts, note tools, modulators. Right tray **Effects**. All trays share one grip helper lifted from today's `#kbGrip`. Side trays open by a tap on their rail, never by an edge swipe. |
| D2 | **The canvas is a camera over a DOM world**: one `translate(tx,ty) scale(k)` on one layer. Nothing reflows. Whether a pinch on the canvas zooms the canvas or the page is the user's choice (§13 Q1); the recommended default is canvas zoom, with native page zoom kept over the trays. **Native zoom can always be undone**: while the page is natively zoomed (`visualViewport.scale > 1`) the canvas hands every pan and pinch back to the browser (§4.3). **Two fingers always win**: a knob, drag or cable the first finger started is rolled back; a camera pan the first finger started simply continues as a pinch. |
| D3 | **Every module has the same top bar** (power · colour stripe · title · preset chip · CPU · menu · fold). Dragging the top bar moves the module. Audio jacks sit on the edges. Modulators have one mod-out jack that can be dropped on any knob, or on a module's top bar to pick a parameter from a list. Knobs keep today's press-and-hold mod menu. |
| D4 | **Sound flows left to right**: modulators and note tools → instruments (Serum: parts → VOICE → its own FX) → shared FX panels → OUT. Each track has exactly one OUT: the "one sound". Each track has its own canvas, its own camera, and the piano roll as the other tab. |
| D5 | **One AudioWorkletNode per track, split inside into `Track` + N × `Inst` + M × `Chain`.** `Inst` is one monomorphic class used by every path (live, preview, offline, render farm, golden harness). Method bodies move verbatim. A single-instrument track runs today's operations in today's order and stays bit-identical. |
| D6 | **Canonical compile.** A track shaped like today's (one instrument → at most one FX panel → OUT; or one Serum → its own FX → OUT) posts exactly today's message stream and no graph message. Only new shapes use the new protocol. |
| D7 | **An FX panel is a pedalboard** (an ordered list of effects = one `FXRack`). Panel identity is stable, so re-patching keeps reverb and delay tails. **Every Serum keeps a private FX chain** (today's Main/Bus 1/Bus 2 racks, possibly empty and then shown folded into its VOICE): its master, Bypass, Direct and bus levels live there, so nothing else may enter it. A Serum's output then cables into **shared panels**, which any number of instruments can feed. |
| D8 | **One cable = one modulation row, everywhere**, using Serum's row formula unchanged. Global sources (Mod Wheel, Aftertouch, Bend, Macros, GLOBAL LFO, CC) are evaluated once per track by a `ModCore` that **reuses Serum's own modulation code** (a voice-less `SxMod` plus one "most recent note" pseudo-voice). Per-note sources reach Serum knobs per voice, and every other knob as "most recent note" until true per-voice classic modulation lands (stage 5). |
| D9 | **Exactly one Mod Wheel module per project.** It is pinned: the same module shows on every track canvas; its cables are stored with the track they land on. The physical wheel moves every knob it is cabled to, on every track. |
| D10 | **Serum stays one voice engine.** Its OSC A/B/C, SUB, NOISE, FILTER 1/2, ENV, LFO, MACRO, ARP, CLIP modules are views of one Serum state; a required **VOICE** module owns voicing, glide, ENV 1 (the amp envelope) and the outputs. Internal cables are views of existing state fields. Each Serum can be shown **bundled** (today's whole panel) or **as parts**, and switching loses nothing. |
| D11 | **Cables from track or project modules never live inside a Serum preset.** They are stored in `track.mods` and compiled into each Serum's rows at compile time, so loading a Serum preset never deletes a cable the user drew, and a preset never creates one. Rows a preset brings with performance sources (wheel, velocity, aftertouch, bend, note) are shown as "saved with preset" cables; a cable's "Save with preset" switch moves it into the preset on purpose. Cables between a Serum's own modulators and its own knobs are that Serum's patch (`s.matrix`), as today. |
| D12 | **Structure is undoable, knob values keep today's policy** until the user decides otherwise (§13 Q7). The camera never enters undo. |
| D13 | **Ship in the user's three milestones**: 1 = canvas + trays + modules + cables + several synths per track (stages 1a–1e), 2 = universal mod modules (2a–2b), 3 = Serum taken apart. Later stages (4–6) add full patching, per-voice classic modulation and polish. Every stage is deployed to canvas.domlavin.com and fully usable. Stage 1b touches no audio file; the engine changes only from 1d, after an iPad benchmark has been recorded. |

---

## 1. Goals, invariants, non-goals

**Goals (the user's request, item by item)**

| Request | Where |
|---|---|
| A separate branch in case of regret | `canvas` branch, separate site and storage; "Save as classic project" (§5.4) |
| An infinitely scrollable canvas that instruments are placed on; everything modular | §2.5, §4.3, §4.4 |
| Header/transport/tracks in a sliding, collapsible top tray, like the keyboard tray | §2.2 |
| Every module movable by its top bar | §2.6, §4.6 |
| Each track has its own canvas, piano roll and FX | §2.5, §2.12 |
| Piano roll stays a tab; instruments and FX together, instruments left flowing into FX right | §2.1, §2.5 |
| Several synths per track, each switchable on/off, patched into separate or shared FX, mixed to one sound | §2.7, §2.8, §6 (stage 1e) |
| Visible patch cables | §2.9 |
| Instruments dragged from a tray that shows the physical instrument | §3 |
| Serum split into SUB, NOISE, OSC, FILTER… | §8 (stage 3) |
| A recommendation for Serum envelopes, LFOs, voicing | §8.4 |
| A Serum-style LFO module anywhere, applied to any knob on any synth; velocity; exactly one Mod Wheel module tied to many knobs | §7 (stage 2), §7.10 |

**Invariants**

1. Every sound that exists today renders **bit-identically** (`golden-classic`, `golden-fx`) or within 1e-6 (`golden-presets`, `golden-random`) at every stage. New DSP paths follow the neutral-term rule of SPEC-serum2 §0.7: skipped, not computed, when unused.
2. `compileSerum` output for an existing Serum state with no canvas cables never changes. Canvas layout and canvas cables never enter the Serum state.
3. The app is fully usable on canvas.domlavin.com after every stage.
4. Original content only: no vendor artwork, logos or manual text.
5. No app-owned page zoom that reflows the layout (the user rejected it in `a02ab5d`), and **nothing may leave the user stuck in native zoom**: wherever the canvas takes the pinch, it hands it back while the page is natively zoomed (§4.3).
6. The two-finger false-press protection (`gesture.js`), the edge auto-scroll while dragging and the knobs' press-and-hold mod menu are kept, not rebuilt.

**Non-goals for v1**

- Audio-rate patching between instruments (OSC of synth A into the filter of synth B, cross-instrument FM). Audio cables carry summed, post-voice signals between instruments, panels and OUT.
- More than 3 oscillators, 1 sub, 1 noise or 2 filters inside one Serum (a 4th oscillator starts a second Serum).
- Feedback cables (cycles are refused).
- Cross-track cables, except the project-wide Mod Wheel (§7.10).
- Per-parameter automation lanes (a later "lane" source module fits the modulation model).
- Note tools (ARP, CLIP) for classic synths; they drive a Serum in v1 (§2.13).

---

## 2. User experience

### 2.1 Screen layout

iPad Pro 11″ landscape (1194×834), top tray opened to two track rows:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ≡  ▶ ■ ●  3.2.1 · 0:05.2  ♩120 4/4  ⟲ ♪ ↶ ↷ │ ●Bass ▾ ●●●○ │ CANVAS│ROLL │ ⏻ ▮▮ 18% ⚙ │ ← top tray, 48 px collapsed
│ + Track  MIDI ch │ bars 3–4 selected │ Copy Paste Dup Clear │ −Bars +Bars │ Loop │ 16▾ │ + 32 arrangement toolbar
│ ┄ruler┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ + 24
│ ▌Bass  M S R ▮ [▣mini][▣juno]  1 ─vol─ ─pan─ │▒▒▒▒░░░▒▒▒▒░░░░▒▒▒▒                    │ + 56 per row
│ ▌Lead  M S R ▮ [▣S1]           2 ─vol─ ─pan─ │░░▒▒▒▒░░░░░▒▒                          │
│                                ══ grip ══                                            │
├────┬────────────────────────────────────────────────────────────────────────────┬────┤
│ ▤  │                                                                            │ ▤  │
│ S  │                                                                            │ E  │
│ o  │                  TRACK CANVAS  (selected track, §2.5)                      │ f  │
│ u  │                                                                            │ f  │
│ r  │                                                                            │ e  │
│ c  │                                                                            │ c  │
│ e  │                                                                            │ t  │
│ s  │ ⊖ 62% ⊕  ⤢ fit  ▦ map  ∿ mods  ☰ list  ⇶ tidy                              │ s  │
├────┴────────────────────────────────────────────────────────────────────────────┴────┤
│                     ══ grip ══   oct − +   vel   key size   MIDI  hold  panic   ▾    │ ← keyboard tray (today's)
│ ┃bend┃ ┃mod┃  ▌▐▌▐▌▌▐▌▐▌▐▌▌▐▌▐▌▌▐▌▐▌▐▌▌▐▌▐▌▌▐▌▐▌▐▌▌▐▌▐▌▌▐▌▐▌▐▌▌▐▌▐▌                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Vertical budget** (today the Instrument tab leaves about 292 px for the instrument, ui-shell map §0.7):

| Configuration | Top | Canvas | Bottom |
|---|---|---|---|
| Top collapsed, keys shown | 48 | **≈ 555** | 231 |
| Top with 3 track rows, keys shown | 48 + 32 + 24 + 168 | ≈ 331 | 231 |
| Top collapsed, keys folded to their toolbar | 48 | **≈ 750** | ≈ 36 |

- **One budget function** `cv-tray.js:budget()` serves both grips and replaces `main.js:kbMaxH` (60 % of the window). Rule: the canvas never drops below **240 px**. Dragging one grip past the limit pushes the other tray toward its fold.
- Side trays overlay the canvas. Collapsed they are 44 px icon rails; they never take width from the canvas.

### 2.2 Top tray: transport, arrangement toolbar, tracks

**Collapsed row (always visible)**: everything in the user's screenshot, compacted to one line.

| Group | Contents | Source today |
|---|---|---|
| `≡` app menu | New, Open, Save, Save as classic project, Export MIDI, Bounce, Install, Full screen | `#transport` file buttons, `pwa.js` |
| Transport | play/stop/record, position (BBT and time), tempo, time signature, loop, click, count-in, undo/redo | `main.js:initTransport` |
| Track | track chip (colour, name, ▾ switcher) plus one dot per track for one-tap switching | `renderHeads` |
| View | `CANVAS │ ROLL` | replaces `nav.tabs` |
| Engine | power, master level with meter, total CPU %, `⚙` | `header.top` |

- `⚙` holds the less-used header items: sample rate, oversampling, drift, latency popover (`#latPop`), rec mode, input quantise, "Measure this device" (§9.1), "Pinch on canvas" (§4.3), cable animation, mod-cable visibility.
- **Elements move with their ids unchanged** (`#transport` children, `#sr`, `#os`, `#drift`, `#master`, `#lat`, `#tBars`, the `.arrbar` buttons…), so `main.js:initTransport` and `tests/main-sim.mjs` keep working.
- Today's transport wraps to two rows even at 1366 px; the compact form fixes that. At portrait width the transport overflows into `⋯`.

**Expanded**: the grip at the bottom edge reveals, in order, the **arrangement toolbar**, the ruler and the track rows.

- **Arrangement toolbar** (32 px, shown whenever at least one track row is shown): today's `.arrbar` (`+ Track`, `Assign MIDI channels`, the range info `#aRange`, `Copy`, `Paste`, `Duplicate`, `Clear`, `Delete bars`, `Insert bars`, `Loop selection`) plus the song length `Bars` field (`#tBars`, today in the transport). Below 1000 px wide the edit buttons fold into one `Bars ▾` menu; the range info stays.
- Heights snap to whole rows: `48 + 32 + 24 + 56·n` (matches `arrange.js:Arrangement` `rowHeight 56`, `RULER 24`). The lowest stop is the collapsed row. Double-tap the grip toggles collapsed ↔ last height.
- Grip mechanics are lifted from `main.js:initKbView` / `setKbHeight` / `applyKbHeight` / `onDouble` into `cv-tray.js:trayGrip(panel, {edge, min, max, snaps, key})`: pointer capture, two-finger rollback, arrows/PageUp/Home keys, ARIA slider. The keyboard tray is rebuilt on the same helper. It replaces `.arrwrap { max-height: 340px }`.
- `arrange.js:Arrangement` is reused as is (it sizes to its container, and keeps its own two-finger timeline pinch: it marks itself `data-gesture="own"`).
- **Track rows** keep name, M/S/R, meter, MIDI channel, vol/pan, duplicate, delete. The model `<select>` is replaced by **instrument chips** (tiny illustrations, one per instrument on the track; the primary instrument first, §5.4). **Tap a chip: select the track and centre the camera on that instrument. Long-press: menu (Power, Solo in track, Make primary, Rename, Remove).** Power is never a bare tap (an easy accidental mute on touch). The preset select moves to the instrument's top bar.
- `main.js:renderHeads` becomes incremental (today it rebuilds every row per call).
- `+ Track` opens the Sources tray; dropping an instrument tile onto the track list creates a new track with it already patched.

### 2.3 Bottom tray: keyboard

- Behaviour unchanged: resizable, foldable, key size, `data-gesture="perf"` / `"music"` zones.
- It moves from `position: sticky` to the shell's footer row and keeps `data-wk-inset="bottom"`.
- **Its mod wheel (`#modw`) stays the one physical wheel.** It is the input; the project's Mod Wheel *module* on the canvas is where its routing lives (§7.10).

### 2.4 Side trays

| Tray | Edge | Sections |
|---|---|---|
| **Sources** | left, `data-wk-inset="left"` | Synths (12 classics + "Serum (complete)") · Serum parts (OSC, SUB, NOISE, FILTER, VOICE) · Note tools (ARP, CLIP) · Modulators (LFO, ENV, Velocity, Mod Wheel, Aftertouch, Bend, Macro, CC, Note) |
| **Effects** | right, `data-wk-inset="right"` | Empty FX Panel · each effect type grouped as in the rack's add menu · saved rack presets and chains |

Sources on the left and Effects on the right mirror the signal flow the user asked for.

- Collapsed: a 44 px rail of section icons. **Tap the rail to open** (≈ 240 px). The resize grip sits on the tray's inner edge, **at least 24 px (`gesture.js:EDGE_PX`) from the screen edge**, so Safari's back-swipe and the iPadOS edge gestures never compete with it. There is no swipe-from-the-edge to open.
- A tile drags out as soon as the finger moves toward the canvas; a swipe along the tray scrolls it; a 250 ms hold drags in any direction (`wk.dragSource({scrollAxis:'y'})`, the recipe `serum-ui.js:tileDrag` already uses).
- **The tray slides shut as soon as a drag leaves it**, so the drop area is visible.
- Each tile shows an estimated CPU cost for this device ("~3 %", §9.1). Singleton tiles grey out once placed: Velocity, Aftertouch, Bend, Note ("already on this track"), Mod Wheel ("already in this project").
- The LFO tile drops a **GLOBAL** LFO by default (cheapest, in sync everywhere, valid on every knob).
- `wk.js:asBand` learns `left`/`right` insets so edge auto-pan bands exclude the side trays.

### 2.5 The track canvas

Each track has its own world and its own remembered camera. Default flow left → right:

```
 ╭ LFO 1 · GLOBAL ─────○╮┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
 ╰──────────────────────╯                                                          ┆
 ╭ MOD WHEEL · project ▣○╮┄┄┄┄┄┄┄┄┄┄┐  (+4 cables on other tracks)                 ┆
 ╰───────────────────────╯          ┆                                              ┆
 ┌⏻▌MINIMOOG  Lead 3 ▾   2%  ⋯  ▾──┐┆           ┌⏻ FX PANEL A ──────────── ⋯  ▾┐ ┆
 │ [keys: all]    ◔cutoff◂┘   …     ●━━━━━━━━┓   │ EQ ▸ Chorus ▸ Delay(◔mix◂┄┄┄┄┘
 └──────────────────────────────────┘        ┣━━●in                         out●━━━━━━━━━┓
 ┌⏻▌JUNO-60  Strings ▾   3%  ⋯  ▾──┐        ┃   └──────────────────────────────┘          ┃   ┌ OUT ───────┐
 │ [keys: C3–C6 · +12]              ●━━━━━━━━┫                                             ┣━━●│ ▮▮   vol   │
 └──────────────────────────────────┘        ┃                                             ┃   │ pan    ∿   │
 ┌S1 OSC A┐━━┓                               ┃                                             ┃   └────────────┘
 ┌S1 OSC B┐━━╋━━┌S1 FILTER 1┐━━━━┌⏻▌S1 VOICE ─────────┐   ┌S1 FX (own) ─┐                 ┃
 ┌S1 SUB──┐━━┛                   │ POLY 8 · glide     ●━━━│ Reverb      ●━━━━━━━━━━━━━━━━━┛
 ┌S1 NOISE┐━━━━━━━━━━━━━━━━━━━━━▶│ ENV 1  ╱‾‾╲__      │   └─────────────┘   (S1 FX → FX Panel A also possible)
                                  └────────────────────┘

 ━━  audio (instrument → panel → OUT; inside a Serum, per-voice part → filter → VOICE → its own FX)
 ┄┄  modulation (all shown by default, §2.9), ◂ marks the knob it lands on
 ⏻ power   ▌ group colour   ● jack   ○ mod-out jack   ▣ pinned (project-wide)   ◔ knob with a modulation halo
```

- **Notes go to every powered instrument implicitly.** They are not drawn as cables (clutter). Each instrument has a **key-zone pill** on its left edge ("keys: all", "keys: C3–C6 · +12"): tap to set a range and transpose, for splits and layers at almost no cost. ARP and CLIP modules (note tools) are the exception: they cable into a Serum VOICE's note input.
- Instruments on the left, panels in the middle, OUT on the right is a convention that **Tidy** enforces and drops encourage. Positions are otherwise free.
- A track created from a v1 project opens as instrument → panel → OUT (or Serum → its own FX → OUT), laid out by Tidy (§5.4). Nothing sounds different.

### 2.6 Modules and the top bar

```
            drag the bar to move ↓                                CPU ↓   menu ↓  fold ↓
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ ⏻ ▌S1  OSC A                     Basic Shapes ▾                     2%    ⋯    ▾ │ ← 40 world px on every device
 ├──────────────────────────────────────────────────────────────────────────────────┤
 ●in                        module body = the existing panel                    out●
 │        knobs keep their gestures; plain background pans the canvas              │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

**Top bar**: power `⏻` · colour stripe (instrument or Serum group, with a group chip like "S1") · title · preset/info chip · live CPU (instruments) · `⋯` menu (Duplicate, Delete, Init, Copy/Paste, Rename, About, Bring to front, Open as sheet, Bundle/Show parts for Serum) · `▾` fold (collapses to the bar; jacks stay usable).

- **Drag the bar to move.** Starts immediately on touch (bar is `touch-action: none`). Snaps to an 8 world-px grid with alignment guides; Shift or the Fine latch turns snapping off.
- Tap selects; Shift (key or `wk.modifierBar` latch) adds; Alt-drag duplicates; long-press or right-click on the **bar** opens the menu (`wk.menuSource`); **double-tap zooms that module to 100 %** (or to fit if larger than the viewport) and puts it in edit state (§4.2), double-tap again returns.
- Long-press on a **knob** is not the module menu: it stays today's press-and-hold mod menu (Serum knobs; classic knobs gain the same menu in stage 2b).
- Bring-to-front uses `z-index` only, never DOM re-append (that would drop pointer capture mid-gesture).
- **Same geometry on every device**: the bar is 40 world px everywhere; inside canvas modules, touch hit areas grow through `::before` only, never `min-height`. A layout made on the desktop matches on the iPad (the interaction map flagged `.wk-touch` height drift).
- Classic panels have a resizable width (right-edge grip, 480–1600 world px); they already reflow with `flex-wrap`. Serum parts and FX panels have fixed widths so their `@container` rules resolve against the module.
- **Jacks**: audio in on the left edge, audio out on the right edge; modulators have one mod-out jack at the top right. **Knobs are the mod inputs**; there are no per-knob sockets.
- The bottom-of-page console goes away: the scope moves into OUT; the About text and the DX7 algorithm diagram (`main.js:drawAlgo`) move to `⋯ → About`.

### 2.7 Instruments: adding, power, key zones

- **Dropping a synth tile** creates the module at the drop point and **auto-patches it**: a cable animates from its out to the shared panel that already receives the most instruments, or to OUT if there is none. (A Serum is always cabled through its own FX first.) It sounds on the next note. An instrument with no outgoing cable shows a **"not connected – silent"** badge.
- **Power `⏻`** (on the bar, or the chip's long-press menu):
  - Off: notes stop being delivered, voices fade over the existing ~3 ms de-click path, its own sequencer (TB-303 pattern, Serum ARP/CLIP) stops firing, CPU drops to ≈ 0, the module dims, its cables turn grey. Settings are kept, and bend, wheel, sustain and aftertouch keep reaching it so nothing is stale at power-on.
  - On: plays from the next note; keys still held are restruck (`engine.js:sxKeep`/`sxRestrike` pattern); its sequencer re-anchors to the song position.
  - **Solo in track** (menu) temporarily silences the other instruments on the track.
- **Presets** load from the bar chip. Classic presets work as today. A Serum preset loads into its whole group and its own FX (§8.5); it never removes canvas cables (D11).
- **Replacing** an instrument: `⋯ → Replace with…` or drop a synth tile onto an instrument's top bar; undoable with a toast ("Replaced Minimoog with Juno-60 · Undo"). Until stage 1e (one instrument per track), dropping a synth anywhere on the canvas replaces the instrument the same way; from 1e a drop on empty canvas adds one.
- **Delete** is in the menu and undoable (the sound comes back with it, §5.7).

### 2.8 FX panels, a Serum's own FX, and OUT

- A **shared FX panel** is one of today's racks (ordered effects plus splitters) drawn as a pedalboard, using `fx-ui.js:FXRackUI` inside the module. Drag inside a panel to reorder, as today. Any number of instruments (and Serums' own FX outputs) can feed it.
- A **Serum's own FX** ("S1 FX") is that Serum's Main rack, with its Bus 1 / Bus 2 racks as tabs or extra panels in the group colour. It takes only that Serum. When all three racks are empty it is folded into VOICE as an `FX ▸` chip; it still exists, because the Serum's master, Bypass, Direct and bus levels are applied in its output stage (§6.5).
- Drag an effect tile from the Effects tray into a panel's slots, or onto empty canvas to create a new shared panel holding it. From stage 4: drag an effect out of a panel onto empty canvas to split it into its own panel; drop a panel onto another to merge.
- A panel's input sums every cable that arrives. Its output goes to OUT (from stage 4 also to another panel).
- **OUT** is the track's output: final sum, meter, scope (from today's `#scope`), vol, pan, mute mirrored with the track row. Exactly one per track, cannot be deleted. It is where today's limiter lives (`engine.js:outStage`).
- Serum's DIRECT output joins inside its own FX output stage (`g.direct`), drawn as a thin read-only cable from VOICE to the "direct" jack of S1 FX.

### 2.9 Patch cables

| Cable | Look |
|---|---|
| Post-voice audio (instrument → panel → OUT) | 4 px, source instrument's colour, subtle glow from signal level (≤ 15 Hz, visible cables only, off under reduced motion) |
| Serum per-voice audio (part → FILTER → VOICE) | 3 px, Serum group colour |
| Bus send / cable with a level ≠ 1 | thin, with a level badge |
| Modulation | 2 px, source module's colour, with an amount badge at the knob end |
| Per-note source on a target that follows the most recent note (§7.5) | dashed |
| Saved with a Serum preset (a native row in `s.matrix`, D11) | thin, with a small "preset" tag |
| Serum warp/FM source (inside one Serum) | dotted orange, OSC → OSC |
| Routing switched by a matrix row | small "modulated" tick on the cable |
| From a powered-off instrument | grey |

**Creating**: drag from a jack. A live bézier follows the finger; compatible jacks glow; incompatible ones dim and say why. Releasing within 32 screen px of a jack snaps to it; releasing on a module body picks its first compatible input. **Tap a jack** for a "Connect to…" list (also the keyboard and accessibility path). For modulation, drag the mod-out jack onto a knob (modulatable knobs light up, others grey out), or onto a module's top bar to choose from `serum-core.js:destMenu`-style lists (essential when knobs are tiny).

**Editing**: tap a cable to select it (amount, ×). Long-press: Disconnect, Bypass, Insert FX panel here, Amount. Drag a cable end off a jack to re-patch. The cable inspector is the modulation-row editor (amount, bipolar, curve, aux, slew, bypass). Dropping a source onto a cable's midpoint makes it the cable's aux ("Mod Wheel scales LFO depth").

**Rendering**:

- Two SVG layers in world coordinates. **Audio cables and the bodies of mod cables sit under the modules** (a cable over a knob never steals its touch). **The last 24 screen px of each mod cable and its amount badge are drawn in a second layer above the modules**, with `pointer-events` only on the badge, so the cable visibly lands on its knob even when it passes under an opaque module.
- Cables touching the selection are raised and the rest dimmed.
- **Stroke widths are set from `--ik`** (`stroke-width: calc(4px * var(--ik))`, hit paths 24 / 12 screen px the same way), updated on zoom end. `vector-effect: non-scaling-stroke` is not relied on: it very likely ignores a CSS `scale()` on an HTML ancestor. Stage 1b checks this on WebKit; if it does work there, it may be used for the live pinch frames only.
- Cubic béziers with horizontal tangents (`d = max(40, |x2−x1|/2)`). Port positions are cached module-local offsets, refreshed by a per-module ResizeObserver (folding changes heights), never measured per frame.

**Visibility**: audio cables are always shown. Mod cables: **Always (recommended default) / On select / Never** (toolbar `∿`; §13 Q5). With "Always", when more than 24 mod cables are visible at once, the ones not touching the selection fade to 30 % and a small "24+ mod cables, tap ∿ to filter" hint appears once; nothing is hidden. Flow animation is off by default (`⚙`), and always off under `prefers-reduced-motion`.

### 2.10 Modulator modules

| Module | Kind | How many |
|---|---|---|
| **LFO** (Serum's LFO editor and shapes) | badge **GLOBAL** (default: one wave for everything) or **PER NOTE** (restarts per note) | any per track (≤ 10 GLOBAL, §7.6) |
| **ENV** (Serum ENV 2–4 style) | per note | any per track |
| **Velocity** (default curve, per-cable curves) | per note | **1 per track** |
| **Mod Wheel** | global | **1 per project** (the user's rule), pinned on every track canvas |
| **Aftertouch**, **Bend** | global | 1 each per track |
| **Macro** (8 knobs, 8 jacks) | global | any per track |
| **CC** (a MIDI controller number; works on classic knobs too) | global | any per track |
| **Note** (key track) | per note | 1 per track |

- A modulator can be cabled to any number of knobs on any instrument or panel on its track (the Mod Wheel: on any track).
- Instruments keep their built-in envelopes and LFOs (Minimoog contours, Prophet poly-mod, Serum's own ENV/LFO). Canvas modulators add on top.
- What "per note" means on each kind of knob, and when each kind of knob becomes modulatable, is in §7.5 and §7.8.

### 2.11 Zoom levels, culling, toolbar, minimap

- Camera range **k = 0.25–2**.
- **Below k ≈ 0.5, modules render as cards**: illustration, title, power, jacks. Knobs hide, tickers and halos stop, cables still attach. (Knobs would be under 20 px on screen anyway.)
- **Culling unmounts**: a module outside the viewport (plus a margin, tested in world coordinates), or shown as a card, has its **body unmounted**: its widgets are destroyed (state lives in the project, so nothing is lost), its canvases are set to 0×0 so Safari frees their backing stores, its DOM is removed, and its tickers, halo painting and monitor subscriptions stop. Only the top bar, jacks and card remain (≤ 30 elements). Bodies re-mount in slices of ≤ 12 ms per frame, nearest the viewport centre first, as for a track switch (§2.12). `content-visibility: hidden` is not used for culling (it frees neither canvases nor nodes); it may be added on Safari 18+ as a paint hint only.
- **Pinches don't thrash**: when a pinch crosses k = 0.5 in either direction, mounting and unmounting wait until the gesture ends.
- **Mounted-body budget**: when the bodies in view would exceed the DOM budget of §9.3 (three bundled Serums at ≈ 3.7k elements each already do), the modules farthest from the viewport centre stay cards marked "zoom in to edit".
- **Floating toolbar** (bottom-left of the canvas): `⊖ 62% ⊕`, **fit all**, **minimap**, **mods** visibility, **mod list**, **tidy**.
  - **Tidy** lays the graph into columns: modulators/note tools → instruments → Serum VOICE → Serum FX → shared panels → OUT.
  - **Mod list** is a sheet listing every modulation row (source, target, amount, curve, on/off, "preset" or "canvas") including each Serum's row budget ("12/64"). It is the precise editor and replaces Serum's MATRIX page on the canvas.
  - **Minimap**: module rectangles plus the viewport; drag to pan, tap to centre; redraws only on camera or layout change.

### 2.12 Piano roll and track switching

- `CANVAS │ ROLL` swaps the centre area; `roll.js:PianoRoll` sizes to its container (`#rollwrap` sized by the stage instead of `clamp(300px, 100vh-400px, 640px)`). Both trays stay.
- Selecting a track swaps worlds with a short cross-fade. Only the selected track's canvas is mounted (today's `renderPanel` behaviour). **The switch shows cards first, then mounts visible bodies over a few frames** (≤ 12 ms slices), so a track with three Serums does not freeze the switch.
- The project's Mod Wheel module appears on every track canvas (D9), at the position it has on that track (first placement: top-left of the instrument column).

### 2.13 Refusals, automatic fixes, notices

Every refused or automatically adjusted action explains itself in one line in `#notice` (the app's single notice line), for example:

- "That would make a loop" (cycle).
- "Each Serum source has one output: to its filters, Main or Direct" (second route).
- "Moved OSC B to Serum 2 · Undo" (an OSC of Serum 1 cabled into Serum 2's filter while Serum 2 has a free oscillator slot, via `serum-core.js:copyModule`). If Serum 2 is full: "Serum 2 already has 3 oscillators".
- "Serum 1 already has 3 oscillators. Added to new Serum 2."
- "Serum 1's own FX take only Serum 1 · Make a shared panel" (one tap inserts a shared panel after S1 FX and connects both instruments to it).
- "Bus sends feed this Serum's own bus panels."
- "This knob can't be modulated" (structural switch) / "…from stage 5" (classic per-voice-only knobs, §7.8) / "Switch the oscillator on to modulate its level".
- "Serum 1 has no free LFO slot (10/10)." / "Serum 1's mod rows are full (64/64)."
- "ARP and CLIP play a Serum · Add Serum" (a note tool dropped on a track without a Serum; one tap adds "Serum (complete)" and cables the tool to it).
- "Opened read-only: saved by a newer SYNTH Canvas · Reload" (§5.8).

### 2.14 Portrait and small windows

At portrait width (834 px) or Stage Manager windows: the side tray not in use auto-collapses to its rail; the floating toolbar folds into one `⊕` button; the transport overflows into `⋯`; the arrangement toolbar folds into `Bars ▾`; the top tray's minimum stays one row.

---

## 3. Instrument tray and illustrations

**Original procedural SVG, no copied artwork.** `cv-art.js:art(id, {w, h})` draws each instrument from data the app already has, plus a small silhouette descriptor per model:

- From `models.js` `theme`: `panel`, `face`, `ink`, `label`, `accent`, `wood`, `stripes`, `capColors`, control style (`knob` / `slider` / `num`).
- From `models.js` `sections`: number of sections and controls per row, so the miniature has the right density.
- Silhouette descriptor (new, in `cv-art.js`): `{body: 'keyboard'|'desktop'|'cabinet'|'box', keys, cheeks, tilt, screen, steps}`.

| Instrument | Miniature |
|---|---|
| Moog Modular | cabinet of module columns with a few patch cords |
| Minimoog | wood cheeks, tilted dark panel with knob rows, short keyboard |
| ARP 2600 | grey cabinet with slider columns and a separate keyboard |
| Solina | long cabinet, row of tab switches, keyboard |
| CS-80 | long body, coloured lever row, keyboard |
| Prophet-5, OB-Xa, Jupiter-8, Juno-60 | panel colour, wood or stripes and cap colours from their themes, knob/slider rows, keyboard |
| MS-20 | compact body with patch panel on the right, short keyboard |
| TB-303 | silver box with 16 step keys |
| DX7 | dark body, LCD strip, membrane button rows, keyboard |
| Serum (complete) / parts | abstract glyphs: wavetable stack (OSC), filter curve (FILTER), sine (SUB), scribble (NOISE), envelope (VOICE) |
| Modulators | LFO wave, ADSR shape, a wheel, a key with an arrow, eight small knobs (Macro) |

Rules:

- **No logos, wordmarks, maker typefaces or traced photos.** The label under a tile is plain text in the app's own UI font, using the names the app already uses.
- Drawings are cached as strings and reused in three places: tray tiles, track-row chips, cards (§2.11). One drawing path.
- Tiles carry the year and maker line as small text (from `models.js` `year`, `maker`), as `#models` does today.
- No image assets are needed; the file is added to `sw.js:ASSETS` with the `?v=` bump (`tests/lint.test.mjs`).

**Drag-in**: the ghost is the illustration at screen scale following the finger (40 px above a finger, as `serum-ui.js:ghostAt`). Over the canvas it becomes a **true-size outline of the module** at the current zoom, snapped to the grid, drawn in the untransformed overlay layer. Near the canvas edges the camera pans (`wk.edgePan2`, §4.6); hovering over a tray counts as past the edge. Dropping outside the canvas cancels. Dropping on the track list makes a new track.

---

## 4. Interaction and gestures (iPad and desktop)

### 4.1 Gesture table

| Where | Touch, 1 finger | Touch, 2 fingers | Mouse | Trackpad / wheel |
|---|---|---|---|---|
| Empty canvas | pan, with gentle momentum; hold 250 ms then drag = marquee; double-tap = fit all | pan + pinch the camera (or the page, §4.3); a pan already running **continues** into the pinch | drag = pan (§13 Q8); Shift-drag = marquee; middle-drag = pan; double-click = fit | scroll = pan; pinch or Ctrl/Cmd-wheel = zoom at pointer; Safari `gesture*` = zoom |
| Module background (known background classes only, §4.6) | pan (no marquee) | camera | drag = pan | scroll = pan |
| Module top bar | drag = move (immediate); tap = select; long-press = menu; double-tap = 100 % and edit state | camera; **the move snaps back** | drag = move; Shift-click = add; Alt-drag = duplicate; right-click = menu | pan |
| Control (knob, slider…) | as today, including press-and-hold for the mod menu | camera; **the knob value rolls back** | as today | the knob takes the wheel only after a 300 ms rest **and** ≥ 300 ms after the last camera move |
| Editor zone inside a module (LFO/ENV/curve graph, sample display, clip/arp editor, Serum keyboard) | as today | **camera**, unless the module is in edit state; then the editor's own zoom/pan (§4.2 item 6) | as today | as today when hovered |
| Jack | drag = cable / re-patch; tap = "Connect to…" | camera; the cable drag is cancelled | same | – |
| Cable | tap = select; long-press = menu | camera | click = select; Delete removes it (canvas focused) | – |
| Tray tile | move outward = drag now; along the tray = scroll; hold = drag any way | over a tray: native page zoom | drag | – |
| Trays and keyboard | as today | **native page pan/pinch (ruling Z1)**, except the keys (chords) and the arrangement lanes (their own timeline pinch), as today | as today | as today |

**Momentum guard**: a touch that lands while the camera is still gliding, or within 120 ms after it stops, stops the glide and is consumed; it never reaches a control (the iOS scroll-view rule). Momentum is off under reduced motion. Where it runs: a **capture-phase `pointerdown` listener on `#viewport`**, not on the window. `installGestures` stays the only window capture listener and the first statement of `main.js:boot`, so it sees every touch first and can still pair the consumed touch with a second finger; the viewport listener runs after it and calls `stopImmediatePropagation` so no control inside the viewport sees the touch. The consumed touch then pans the camera like a touch on empty canvas.

**Pencil** behaves like the mouse (`wk.dragSource` already treats pen as mouse); hovering a jack shows its label.

### 4.2 Two fingers always win: `gesture.js` changes

The canvas viewport has `touch-action: none` (except while the page is natively zoomed, §4.3), so a two-finger touch on it is a script **nav** session (`mayPan` is false) and the first finger's owner is rolled back by the existing machinery: `claim()` callbacks, range restore, a synthetic `pointercancel` with `e.gesture === 'two-finger'`. Every wk widget, `main.js:track`, roll and arrange already honour it. Changes:

1. **Location-routed hooks**: `installGestures(win, {pan(dx, dy, at) → bool, zoom(f, cx, cy, at) → bool})`. Returning `false` falls through to today's scroller chain and page pan (trays and roll still need it). Fixes `gesture.js:panBy`, which today returns early whenever `o.pan` exists. The canvas claims the event when `at` lies inside the viewport rectangle **and** `visualViewport.scale` is 1 (§4.3).
2. **Pinch in nav sessions**: `frame()` tracks finger distance as well as the midpoint; zoom engages after 6 px of spread change and rebases with no jump (`roll.js:PianoRoll._pinchStart`/`_pinchApply`/`PZ_ENGAGE`). The content under the midpoint stays under it. Applied once per frame from both fingers' latest positions.
3. **A camera pan is never rolled back.** A one-finger camera pan registers no `claim()`; when `gesture.js` pairs a second finger with it, the hooks receive deltas from the session's first frame and apply them to the camera **as it is now**, so the pan continues into the pinch without a jump back. (Knobs, module moves and cable drags still roll back, D2.) After the pinch, a finger left down is "spent" until it lifts, as today.
4. **A late second finger during a moving pan.** `gesture.js` pairs only within `PAIR_MS` (250 ms) or with a still first finger (`STILL_PX`), so a finger that lands while a pan is moving is not paired and would otherwise press whatever is under it. The canvas's own pointer handler therefore upgrades: while its one-finger pan is live, its viewport capture listener takes any new touch inside the viewport (`stopImmediatePropagation`, so no knob sees it) and turns the pan into a canvas pinch with the same rebase maths. `gesture.js` itself is unchanged here.
5. **No `data-gesture="own"` on the viewport.** `zoneOf` walks ancestors, so modules would inherit it, and own sessions do not roll back finger 1's knob.
6. **Editor zones inside modules.** Several widgets mark themselves as zones through `wk.js:zoomPan` (`data-gesture="own"`): every `graph.js` LFO/ENV/curve editor (`ed.zp = zoomPan(ed.root…)`), `sx-ui-osc.js`'s sample display, `sx-ui-seq.js`'s clip/arp editor (`this.zp`); `wk.pianoKeys` (Serum's keyboard and the ARP/CLIP slot keys in `sx-ui-seq.js`) marks itself `"music"`, which never pairs. Since `zoneOf` walks up the ancestors, a pinch that starts on an LFO module's graph would zoom the graph, not the camera. Rule: **inside a canvas module (`[data-cv-mod]`), `own` and `music` zones count only while that module is in edit state** (`[data-cv-edit]`); otherwise `zoneOf` skips them and the touch belongs to the camera. A module is in edit state when it is selected **and** k ≥ 0.9, after a double-tap on its bar (100 %), or while it is open as a sheet in `#ov`. Edit state shows as a thin outline and ends on a tap outside the module, on Escape, or when k drops below 0.9. In edit state the editor's pinch and the keys' chords behave exactly as today.
7. **Trackpad and Safari**: `gesturestart`/`gesturechange` on the viewport are `preventDefault`-ed (non-passive, element-level), and their scale is ignored while touch pointers are down (the `PianoRoll._gest` rule, because iPad sends both).
8. **No non-passive `touchmove` on `window`** (the `gesture.js` header rule stands).

### 4.3 Pinch on the canvas, and native zoom

**Where native pinch works today**: the keys are `touch-action: none` (`style.css .keys`), the arrangement lanes are `pan-y` and pinch their own timeline, and the canvas viewport (new) is `touch-action: none`. So with canvas zoom, native page zoom works only over tray chrome: the transport row, track heads, tray rails, the keyboard toolbar.

**The trap**: after a native zoom-in, the visible area can be all canvas and keys. If the canvas kept taking every touch, native pinch-out and native pan would be impossible, and `#app` has no scroll of its own (fixed, `overflow: clip`). The user would be stuck zoomed in.

**Rule, whatever the user chooses**: while `visualViewport.scale > 1` (checked on every `visualViewport` `resize`/`scroll` event), the canvas **hands over**: its hooks return `false`, its one-finger pan and momentum stop, and `#viewport` gets `[data-cv-native]`, which switches the viewport, module backgrounds and top bars to `touch-action: pan-x pan-y pinch-zoom` (controls keep `none`, so knobs still work; a touch that starts on a knob turns it, as on any zoomed page). Native pinch and pan then work over the whole canvas until the scale is back to 1, when the canvas takes its gestures back. A small "page zoomed · 1:1" chip appears in the canvas toolbar while this lasts; tapping it is a hint, not a reset (pages cannot reset native zoom).

**The choice (§13 Q1)**, one switch in `⚙ → Pinch on canvas`:

| Mode | Two fingers on the canvas | Canvas zoom comes from | Native page zoom |
|---|---|---|---|
| **Zoom canvas** (recommended) | pinch zooms the canvas, two-finger drag pans it | pinch, toolbar `⊖ ⊕`, fit, double-tap, Ctrl-wheel | over the trays, and everywhere while already zoomed |
| **Zoom page** | native: the whole page zooms, as today | toolbar `⊖ ⊕`, fit, double-tap, Ctrl-wheel only | everywhere; the canvas pans with one finger only |

Recommended because native zoom can never zoom **out** below 1, so it cannot give the overview an infinite canvas needs, and canvas zoom does not reflow anything (the reason the user rejected the old zoom).

### 4.4 Camera model

```
#app        position: fixed; inset: 0; height: 100dvh; overflow: clip; overscroll-behavior: none
  #topTray      [data-wk-inset=top]
  #stage
    #viewport   touch-action: none (pan-x pan-y pinch-zoom while natively zoomed); overflow: clip;
                grid = CSS background (size g·k, offset t mod g·k)
      #world    0×0; transform-origin: 0 0; transform: translate(tx,ty) scale(k); --ik: 1/k
        svg.cables          (under the modules; pointer-events only on hit paths)
        .mod × N            position: absolute; contain: layout paint style; [data-cv-mod]
        svg.cable-ends      (above the modules: mod-cable ends and amount badges, §2.9)
    #overlay    untransformed: ghosts, drop outlines, marquee, minimap, snap halos
    #tab-roll   (shown instead of #viewport in ROLL)
  #srcTray [data-wk-inset=left]   #fxTray [data-wk-inset=right]
  #perf    [data-wk-inset=bottom]
#ov          top layer: popovers, Serum overlays, sheets   (+ existing .modal / .toast / .tip)
```

- `world = (client − vpOrigin − t) / k`; zoom about point c: `t' = c − (c − t)·k'/k`.
- **Camera storage**: per project, per track, per device, in prefs: `synthc.cam.<project uid>.<trackId>` (track ids `trk_N` are reused across projects, so the project's `uid`, §5.1, is part of the key). Kept as an LRU of 200 entries. Never in the project or History: different screens want different cameras.
- **Crispness**: `will-change: transform` is set only while a gesture or animation runs; removing it at the end forces one sharp re-raster of visible modules. On zoom end, `wk.rescaleCanvases(k)` invalidates in-module canvas backing stores and `wk.fitCanvas` sizes them at `min(dpr·k, 2)` within the 16e6 px per-canvas cap (`arrange.js:MAX_AREA`).
- **`overflow: clip`, not `hidden`** on the viewport: programmatic scrolls (`focus()` without `preventScroll`, `scrollIntoView` in `main.js:instPicker`, Tab) would silently shift the world. A `focusin` handler pans the camera to reveal a focused control instead. (`overflow: clip` needs Safari 16; see §9.4.)

### 4.5 Touch targets under zoom

`#world` carries a CSS variable `--ik = 1/k`, updated on zoom end.

- **Jacks**: hit circle ≥ 44 screen px diameter at any zoom (`calc(44px * var(--ik))` world); overlaps resolve to the nearest jack within 32 screen px.
- **Top bar**: visible 40 world px; its hit area extends **upward, outside the module** so the on-screen height is ≥ 36 px down to k = 0.5 (it never grows into the module body).
- **Cables**: hit path 24 screen px (touch) / 12 (mouse), from `--ik` (§2.9).
- Below k = 0.5 modules are cards (no knob editing), which bounds every other target.

### 4.6 Drags

All drags go through `wk.dragSource` (touch hold, ghost, settled-drop rule, Escape cancel), with `autoScroll: false` and a 2-D camera edge-pan.

- **New `wk.edgePan2(band, x, y, pointerType, t) → {vx, vy}`** (exported from `wk.js`): the 2-D form of today's edge auto-scroll, applying the existing 1-D speed law `dragSource.edge` (`wk.js:asEdge`: quadratic, `AS_RAMP` ramp-in, `AS_ARM` arming) on each axis against a band. Today's `dragSource` auto-scroll is vertical only and moves DOM scrollers, so it cannot drive a camera. The band is the viewport rectangle minus the trays, from `asBand` extended with `left`/`right` insets. A pointer over a tray counts as past the edge (full speed).
- **Re-projection**: every live drag stores its pointer in screen px and recomputes its world position **each frame from the current camera**, so a module, a ghost outline or a cable end stays under the finger while the camera edge-pans (or a second finger pans) under it. Drop targets are re-hit-tested on those frames (`info.scrolled`, as `dragSource` does after an auto-scroll).

| Drag | Details |
|---|---|
| Tray tile → canvas | `scrollAxis:'y'`; tray closes on leave; true-size outline at k; grid snap |
| Module top bar | `scrollAxis:'none'`; world delta = screen delta / k; `translate3d` with temporary `will-change` during the drag; commit x/y on drop; group-move the selection; a two-finger cancel restores start positions; one undo step opened at the first real move (`roll.js:_edit0` pattern) |
| Jack → jack | live bézier; nearest compatible jack within 32 screen px; ghost label above the finger (`ghostAt`), `settled` rule for quick drags |
| Mod jack → knob or top bar | hit test `elementFromPoint` → `closest('[data-dest]')` → `closest('[data-dev]')`; drop on a top bar opens a parameter list |
| One finger on a module background | pans only when the press lands on a known background class (`.mod-body`, `.sec`, `.secs`, `.plate`, and the equivalent Serum/FX panel backgrounds); anything else (`[data-dest]`, inputs, buttons, `.wk-*`, editor canvases, jacks) keeps its own `pointerdown`, so graph.js, fx-ui and wtedit editors never lose it |

Today's label drags change meaning: `serum-ui.js:moduleDrag` (swap / copy / drop as audio-rate source) and the `fx-ui.js` grip reorder must not collide with "top bar = move". Swap and copy move to the `⋯` menu; "OSC as audio-rate source" becomes the dotted warp-source jack (§8.3); FX reorder stays inside the panel body.

### 4.7 Transform-safety fixes (all in stage 1b)

| Fix | Detail |
|---|---|
| `wk.localPoint(el, e)` | Returns layout px as `(client − rect.origin) · el.offsetWidth / rect.width` (exactly 1/k, no global, also correct under native page zoom). Replaces the k-dependent mappings in `graph.js:pos` (every LFO/ENV/curve editor), the `fx-ui.js` display-drag `pos` handlers, the `wtedit.js` strip index maths; audit the `sx-ui-osc.js` and other `fx-ui.js` sites listed in the interaction map §5. These are UI files; no DSP file changes (§10, stage 1b acceptance) |
| Overlays to the top layer | `SerumUI.popover`, `overlayOpen` (WT editor, large LFO editor), `.sx-seqov`, `.gx-overlay` render into `#ov` via a kit-level `layer`, placed in client coordinates. On iPad they open as sheets. (`position: fixed` breaks inside a transformed ancestor, and a module-sized `.sx-root` would make tiny overlays) |
| Stranded popups | Export `wk.closeTransient()` (closes the private `active` menu and calls `hideTip`); the camera calls it when a move starts (a transform pan fires no `scroll`) |
| Wheel veto | `wk.setWheelVeto(() => camera.movedAt > now − 300)` so a knob sliding under a resting cursor does not capture the wheel |
| Canvas backing stores | `wk.rescaleCanvases(k)` on zoom end (≈ 10 sizing sites: `fitCanvas` callers plus custom sizing in sx-ui-osc, sx-ui-seq, wtedit); `wk.releaseCanvases(root)` sets them to 0×0 on unmount (§2.11) |
| Edge pan | `wk.edgePan2` (§4.6) |
| Gesture zones | `[data-cv-mod]` / `[data-cv-edit]` rule in `gesture.js:zoneOf` (§4.2 item 6) |
| Viewport media queries | Audit the remaining viewport `@media` rules in fx-ui (3), sx-ui-mix (2), sx-ui-seq (2), wtedit (2); modules use container queries |

### 4.8 Keyboard, Pencil, accessibility

- Shortcuts avoid Space (play) and the computer-piano keys (A–; W E T Y U O P Z X C V). Canvas shortcuts act only while the canvas has focus: `0` fit all, `1` 100 %, Delete/Backspace remove selection, Cmd/Ctrl-A select all, arrows nudge the selection by one grid step, Escape cancels a drag, leaves edit state or deselects (inserted into `main.js:initKeys`' Escape chain).
- Module top bars are focusable; Tab moves between modules and the `focusin` reveal keeps the focused one on screen.
- Every cable can be made and removed without drawing: jack tap → "Connect to…", and the Mod list sheet. Jacks carry ARIA labels ("Minimoog out", "FX Panel A in").

---

## 5. Data model, migration, storage

### 5.1 Project v2

```js
project = {
  version: 2,
  schema: 4,                                     // bumped by every stage that adds or changes a saved field (§5.8)
  uid: 'p_k3x9q2',                               // random, made once per project; keys device prefs (camera, §4.4)
  name, bpm, sig, bars, loop, …,                 // song.js fields, unchanged
  selTrack,
  perf: { wheel: { v: 1 } | null },              // the project's one Mod Wheel module (D9); null = not placed
  tracks: [track]
}

track = {
  id, name, color, ch, mute, solo, arm, vol, pan, notes, cc,   // song.js core fields, unchanged
  prim: 'i1',                                                 // the primary instrument: explicit and stable (§5.4)
  nid: 7,                                                     // next device number (ids never reused in a track)
  dev: {                                                      // everything that makes or shapes sound
    i1:  { kind: 'synth', model: 'minimoog', vals: {…}, preset, seq: null,
           on: true, solo: false, zone: { lo: 0, hi: 127, xp: 0 }, name: null },
    i2:  { kind: 'synth', model: 'serum', vals: { s: {…} }, preset, on: true, solo: false, zone: {…},
           view: 'parts',                                     // or 'bundled'; s is today's Serum state, unchanged
           fx: { v: 2, racks: [main, bus1, bus2], ui: {…} } },  // the Serum's own FX (D7): today's t.fx, private
    fx1: { kind: 'panel', rack: { mods: […], byp: 0, lock: 0, ui: {…} }, name: 'FX Panel A' },   // a shared panel
    out: { kind: 'out' },
    l1:  { kind: 'lfo', mode: 'global', st: { /* Serum LFO state shape: pts, path, rate, sync, mode, … */ } },
    e1:  { kind: 'env', st: { /* Serum ENV state shape */ } },
    ve:  { kind: 'velo', crv: null }, at: { kind: 'at' }, bd: { kind: 'bend' }, nt: { kind: 'note' },
    m1:  { kind: 'macro', v: [0, 0, 0, 0, 0, 0, 0, 0], names: […] },
    c1:  { kind: 'cc', cc: 74 }
  },
  wires: [ { id: 'w1', a: 'i1.out', b: 'fx1.in', g: 1 },      // post-voice audio
           { id: 'w2', a: 'i2.out', b: 'fx1.in', g: 1 },      // i2.out = after the Serum's own FX
           { id: 'w3', a: 'fx1.out', b: 'out.in', g: 1 } ],
  mods:  [ { id: 'r1', src: 'l1.out', dst: 'i1:cutoff',       // every cable drawn from a track or project module (D11)
             amt: 0.4, bi: 1, curve: 0, crv: null, aux: null, inv: 0, rise: 0, fall: 0, byp: 0 },
           { id: 'r2', src: 'wheel', dst: 'i2:f.cutoff', … },        // the project Mod Wheel → a Serum knob
           { id: 'r3', src: 'i2/lfo3', dst: 'fx1:fx.d1.mix', … } ],  // a Serum's own LFO, linked outside it (§7.7)
  lay:   { i1: { x, y, w, fold, z }, 'i2/voice': { x, y }, 'i2/oscA': { x, y }, 'i2/fx': { x, y },
           fx1: {…}, out: {…}, l1: {…}, wheel: { x, y } }     // wheel: where the project Mod Wheel sits on this track
}
```

- A **modulation row has exactly the shape of a Serum matrix row** (`serum-core.js:normRow`), with namespaced ends. Compiler, inspector and Mod list share one format.
- `lay` is view-only: never compiled, never in presets.
- The 303 pattern (`seq`) and the preset name live on the synth device that owns them.

### 5.2 One source of truth per fact

| On screen | Stored in |
|---|---|
| Serum part → FILTER → VOICE cables, sends, Direct, warp sources | that Serum's `vals.s` routes and levels (cables are **derived** via `sx-ui-mix.js:channelStrips`/`routeMenuItems`) |
| A Serum's own ENV/LFO/macro → its own knobs or its own FX | `s.matrix` rows (today's format; saved with its presets) |
| A preset's rows from performance sources (`wheel`, `velo`, `at`, `bend`, `note`) | `s.matrix` (shown as "saved with preset" cables from the matching module) |
| Any cable from a track or project module (Mod Wheel, Velocity, Aftertouch, Bend, Note, LFO, ENV, Macro, CC) to any knob: Serum, FX or classic | `track.mods` of the track the knob is on; compiled into the target Serum's rows at compile time (§7.7), never written into `s.matrix` unless the user flips "Save with preset" |
| A Serum's own LFO/ENV → a target outside that Serum (linked automatically, §7.7) | `track.mods` with `src: '<dev>/<part>'` |
| Instrument → panel → OUT | `track.wires` |
| A Serum's own FX | `dev.<id>.fx` (today's `t.fx` shape) |
| Positions, widths, folds | `track.lay` |
| Camera | device prefs (`synthc.cam.<project uid>.<trackId>`) |

### 5.3 Ids

- Device ids are short, unique within a track, never reused (`track.nid`).
- Serum part modules are `<dev>/<part>` using `serum-core.js:MODULE_FIELDS` names (`oscA`, `filter2`, `env3`, `lfo7`, plus `voice` and `fx`).
- **FX instance ids are unique per track** (across shared panels and Serums' own FX), so every `fx.<inst>.<pid>` destination stays valid; migration preserves them.
- Destination ids: `<devId>:<paramId>` (Serum `DESTS` ids, FX `fx.<inst>.<pid>`, classic control ids).
- `duplicateTrack` and pasting remap device and instance ids and rewrite references, as `fx-core` `applyRackPreset`/`applyPresetFx2` already do.

### 5.4 Migration, the primary instrument, the regret path (`cv-migrate.js`, pure, node-tested)

**`toV2(v1)`** per track:

1. The instrument becomes `i1` (`model`, `vals`, `preset`, `seq`); `prim = 'i1'`.
2. Classic: `fx.racks[0]` becomes shared panel `fx1`, wired `i1.out → fx1.in → out.in`. An empty rack still becomes a panel (it may hold nothing; it is cheap).
3. Serum: the whole `fx` (three racks, routes, `ui`) becomes `i1.fx`, its own FX, wired `i1.out → out.in`. Buses and Direct stay inside it, exactly as today.
4. FX instance ids are kept; `track.mods` is empty (a Serum's rows stay in `s.matrix`; its performance-source rows show as "saved with preset" cables).
5. Layout by Tidy.

**The primary instrument** (`track.prim`):

- Explicit and stable: set to the first instrument at creation or migration. It changes only when the user picks "Make primary" (chip menu) or deletes the primary (then the oldest remaining instrument becomes primary and the notice says so). **Powering an instrument off never changes it**, so MIDI program change, the track row's first chip, `toV1` and undo never retarget mid-session.
- Uses: track-row chip order; program change (§6.9); the file mirror (§5.8); `toV1`'s canonical choice; the transition accessors below.

**Transition accessors** (stages 1c–1e only): `track.model`, `vals`, `preset`, `fx`, `seq` are non-enumerable accessors onto `dev[prim]` (and its FX: the Serum's own FX, or the shared panel a classic primary feeds, or `null`), so the ~33 `isSx(`, ~31 `.model`, ~34 `.vals` and ~23 `fxOf(` sites in `main.js` can move to `instOf(t, id)` gradually.

- **One adopt point.** `History._load` (`JSON.parse`), `song.deserialize`, duplicate and paste all produce plain objects, which have no accessors. So every path that puts track objects into `project` goes through `cv-model.js:adopt(project)`: `main.js:loadProject`, `freshProject`, `applyRestore` (undo/redo), `addTrack`, `duplicateTrack`, arrangement paste, `toV2`. `tests/main-sim.mjs` asserts after every History step and every load that each track has its accessors.
- The accessors are removed at the end of stage 1e, when no `main.js` site uses them.

**`toV1(v2)`**, offered as `≡ → Save as classic project`:

- A canonical track (§5.5) converts exactly.
- Otherwise each instrument becomes its own v1 track with a copy of the notes; a Serum keeps its own FX; a classic instrument takes the shared panel it feeds, flattened where the topology allows. `track.mods` rows from performance sources into a Serum knob are written into that Serum's `s.matrix` (lossless). A dialog lists what was lost (shared panels feeding several instruments, track LFOs/ENVs/macros, classic-knob modulation, key zones) before saving.
- The result opens on synth.domlavin.com (main).

`song.js:newTrack`/`deserialize` whitelist the new fields; `main.js:loadProject`, `freshProject`, `addTrack`, `duplicateTrack`, `renderOffline` learn them. `exportMIDI` is unaffected (notes only).

### 5.5 The canonical-compile contract

`cv-graph.js:compileTrack(track)` recognises these shapes:

- one powered classic instrument → one shared panel → OUT (no panel compiles as today's empty rack);
- one powered Serum → its own FX → OUT.

For them it presents the track to today's `main.js:buildPatch` / `sendPatch` path as a v1 track (`model`, `vals`, `fx`), so the live fields and the part caches (`partDelta`, `ctDelta`, `seedPend`) behave exactly as today and **the message stream posted to the node is identical** to main's. No graph message is sent.

**Proof** (`tests/canonical-stream.test.mjs`): `tests/main-sim.mjs` records every `postMessage` to every node (order, and structured-clone bytes via `v8.serialize`) during a scripted session: load `tests/ref-p1/project-p1.json`, play, select tracks, turn knobs on a classic and a Serum track, load classic and Serum presets, add and remove effects, undo/redo, change oversampling, power-cycle the engine. The reference stream is recorded once from main's code at the merge base (a `git worktree`, checked in as `tests/fixtures/stream-main.bin`); the canvas build must reproduce it exactly. A quicker unit check in `cv-graph.test.mjs` compares `compileTrack` with `models.js:patchFor` for every factory preset.

### 5.6 Storage isolation and user libraries

- canvas.domlavin.com is its own origin, so it has its own IndexedDB and localStorage, and it **starts empty**.
- On localhost both branches share an origin, so stage 1a renames `appstore.js:DB_NAME` to `'synth-canvas'` and prefixes localStorage keys with `synthc.` (`APP_NS`). A v2 autosave can never reach main's `song.deserialize`.
- **Songs** come across by file: Save on synth.domlavin.com, Open on canvas; `toV2` runs on load. Going back: "Save as classic project".
- **User libraries do not come across by themselves.** Missing on canvas at first run: classic user presets (`synth.user.<model>`, which have no export today: `main.js:userPresets`), Serum user presets and the default Serum preset (`synth.sx.default`), Serum prefs, browser state, ratings and Voice Control presets (`synth.sx.*`), FX chains (`synth.fxchains`), FX rack presets (`synth.fxracks`), FX module presets (`synth.fxmod.*`), shapes (`synth.sx.shapes`), settings (`synth.settings`), and user wavetables and samples in `synth-wt` / `synth-smp` that no saved project embeds. Some already have file export (FX chains "Export All to File…", shapes, projects with embedded assets); classic user presets have none.
- Moving them needs either a small **"Export library"** on main (one menu item that writes every `synth.*` key plus the user's wavetable and sample assets into one file; additive, but it is a change to main) or the user's decision to start fresh. This is §13 Q6. The canvas side gets **"Import library"** in `≡` either way (merges, never overwrites; a name clash gets " (2)").

### 5.7 Undo and History

- **Project History** (`song.js:History` via `main.js:edit`/`beginEdit`/`endEdit`) records **structure**: module add, delete, move, fold, resize; power and solo; key zones; primary; cable connect/disconnect/re-patch; cable amounts and levels (coalesced over 600 ms like Serum's); the Mod Wheel module (`project.perf`) and its cables on every track. One step per gesture, opened at the first real move.
- **Knob values keep today's policy** (not in project undo; each Serum keeps its own panel undo, capped at 4 MB per instance on touch devices). §13 Q7 asks the user.
- `applyRestore(p, keepSound)` gets a per-device rule: a device present in both snapshots keeps its *current* `vals`/`rack`/`fx`; a device that comes back from a delete gets its snapshot values (undoing a delete brings the sound back). It ends in `adopt(project)` (§5.4).
- The undo button follows focus and says what it will undo ("Undo move LFO 1"); Serum's own undo stays labelled inside its VOICE/bundled panel.
- Snapshot cost: ≈ 0.07 ms per 30 KB track on desktop; a track with two Serums ≈ 0.15 ms per record, fine at gesture granularity.

### 5.8 Schema and file compatibility

**Schema number.** The v2 format grows stage by stage (module layout in 1b, devices and the primary in 1c, instruments and wires in 1e, mods and `perf` in 2a, modulator modules in 2b, parts layout in 3). Every saved project carries `schema` (an integer); `cv-migrate.js:SCHEMA` is the highest this build understands, and each stage that adds or changes a saved field bumps it, with a migration step from the previous number.

- **Older builds open newer data read-only.** An installed PWA can lag one or more builds behind (service-worker update on next launch). A build that meets `schema > SCHEMA` (autosave or file) opens it read-only: autosave is off for the session, Save is disabled, and the notice says "Opened read-only: saved by a newer SYNTH Canvas · Reload" (Reload applies the waiting service worker, `pwa.js`). Before every autosave write, the build checks the stored slot's schema and never overwrites a newer one.
- This rule ships in **stage 1a**, before any v2 field exists, so every later build is protected by the build before it.

**Opening a v2 file on main.** `song.deserialize` keeps only known fields and defaults a missing `model` to `'minimoog'`, and `main.js:loadProject` gives a missing `fx` a default rack, so a bare v2 file would silently become Minimoog tracks there. So **files** saved on canvas (Save, Save as; not autosave, not History) carry a **mirror** of each track's primary instrument at track level: `model`, `vals`, `preset`, `seq`, and `fx` (a Serum's own FX, or the shared panel a classic primary feeds, or an empty rack). The canvas reader ignores the mirror when `dev` exists. On main such a file opens as "each track = its primary instrument with its FX": degraded but recognisable. The cost is one instrument's state per track in saved files only. "Save as classic project" (§5.4) stays the faithful way back.

---

## 6. Per-track audio graph

### 6.1 One node per track

Each track stays **one `AudioWorkletNode('synth-engine')`** → gain → panner → master, as `main.js:makeNode` builds today. Several instruments and panels live **inside** it. Reasons: Float64 end to end, deterministic order, one limiter, modulation inside a track is local, `main.js:nodes` bookkeeping and the `main-sim` fakes barely change, and several nodes would buy no parallelism (one audio thread per context in WebKit and Chrome).

### 6.2 `Track`, `Inst`, `Chain` (inside `engine.js`)

```
Track  (the AudioWorkletProcessor, registered as 'synth-engine')
 ├─ events   songEvents / extEvents / every powered Inst's sequencer (303 seqEvents, SxSeq) → spans on the 4-frame grid
 │           note fan-out to powered Insts whose zone admits the note (per held note: bitmask of receivers)
 │           controller state (bend, wheel, sus, at, mpe, pat) to every Inst, powered or not
 ├─ ModCore  voice-less SxMod + one "most recent note" pseudo-voice (stage 2b, §7.6)
 ├─ Inst[]   one class, kind ∈ analog | fm | divide | serum
 │           own OS / CH / fs, voices, smoothing, LFO, tails, decimators, chorus/ensemble, PRNG seeds (§6.2.1)
 │           a Serum Inst owns one private Chain: its own FX (today's 3-rack FXRack)
 │           out: base-rate L/R
 ├─ Chain[]  shared panels: one FXRack each + input pairs
 └─ out      Σ OUT inputs → panicFade → outStage (DC block, Limiter, clip)
```

- **What stays in `Track`** (≈ 350 lines of today's `SynthProcessor`): `process`, span splitting, `songMsg`, `transportMsg`, `songEvents`, `releaseSong`, `extNote`/`extEvents`, `msg` dispatch, `panic`/`end`/`panicFade`, `postMon`/stats, `outStage`, `PROCS`/`ALL` registration (MIDI OUT stays track to track).
- **What moves into `Inst`** (≈ 1,100 lines): `init`/`setOS`/`recalc`, `smTargets`/`smSnap`/`smStep`, `setPatch`/`setSerum`/`sx*`, `noteOn`/`noteOff`/`monoPlay`, `runLFO`, `renderDac`, the 303 `seq*`, `fadeOut`/`fadeSerum`/`allOff`, `osFade`/`decim`, and the render half of `renderSpan`/`renderSerum` up to and including chorus/ensemble, a Serum's own FX (`rack.setMods`/`setNote`/`trigger`/`process`) and the Serum `sxRel` bookkeeping.
- **Verbatim move rule**: method bodies move unchanged. `Inst` carries every field the DSP scripts read by name (the 27 `proc.*` fields of `SerumDSP`/`SxMod`/`SxSeq`; `fs, fcMax, p, CH, smA, smD, smB, smMv, pkP, pkB, pkS, ouB, ouN, ctl, lfoBuf, gdrift, nzW, nzMR, nzMW, bwc, ampK, fbHPc` for `AVoice`/`FVoice`). `tp`, `procs`, `songBeat()`, `bpm` forward to the `Track` by reference. **`AVoice`, `FVoice`, `Divide`, `SerumVoice`, `SerumDSP`, `SxMod`, `SxSeq` render code is not modified by the split.** Later DSP-file edits are small and outside the voice loops: the seed sites (§6.2.1, stage 1e) and the `ext` sources (§7.7, stage 2b); only stage 5's `AVoice.mo` enters a voice loop.
- **`Inst.rack` points at its own FX** (Serum) or at the single shared panel it feeds on a canonical classic track, so the existing `this.rack.setMods(SerumDSP.fxMods(this), cp.fxKey)`, `this.rack.setNote(…)` and `this.rack.trigger()` calls stay verbatim. Only three call sites per render path are lifted into `Track`: shared-chain `rack.process` (with the no-fx-dsp fallback and `mixPeaks`), `panicFade`, `outStage`.
- **One monomorphic class.** Every path constructs a `Track` that holds `Inst`s: live tracks, preview, `renderOffline`, `renderLast`, the render farm (`smprender.js`), and the golden harness. So only `Inst` objects ever reach `AVoice`/`SerumVoice` as their host, and their property loads stay monomorphic. Field types stay fixed from construction (the engine's own V8 comments, e.g. `lastNote = 60.5; lastNote = 60`).
- **Compatibility facade**: `Track` exposes getters/setters `voices, kind, sx, OS, p, sxSeq, sxMask, div, act, tp` delegating to `insts[0]` and `rack` delegating to the first chain. The 8 test files that reach into the processor (e.g. `tests/cpu-gate.mjs:calibRowB`) run unchanged; `tests/ref-p1` stays frozen.
- **Warm-up**: `warmUp` moves to `Track` and, besides today's rounds through an `Inst`, also runs the new paths once (§9.2), so JavaScriptCore has compiled them before the first real note.
- **Limits** (preallocated, allocation-free index arrays): ≤ 8 instruments and ≤ 16 shared panels per track.

#### 6.2.1 PRNG seeds

Today every processor starts from the same seeds: `this.r = 987654321` (`engine.js:SynthProcessor` init and restore), voice streams by index (`AVoice` constructor: `(0x9E3779B9 * (i + 7)) >>> 0`), chorus `r = 22222`, Serum's `SEED` for `sx.seed`/`sx.rng` (`serum-dsp.js`) and `sx.mod.seed` (`sx-mod.js`). Two Junos or two Serums on one track would therefore drift and randomise in lockstep.

- The **primary instrument's Inst keeps today's seeds** (salt 0), so canonical tracks stay bit-identical.
- Every other Inst gets a salt from its device number (`salt = (devNum · 0x9E3779B9) >>> 0`). The Inst XORs it into its own `r`, each voice's `r` and the chorus `r` after construction and after every reset (from outside the voice classes), and `serum-dsp.js` / `sx-mod.js` XOR `proc.seedSalt | 0` where they set `SEED` (a one-token change at each seed site).
- Seeds depend only on device ids, so offline bounce = live and reloads reproduce.
- Solina's `Math.random` is scope-shared, so only two or more Solinas on one track depend on render order (documented, tested).

### 6.3 Span order and the bit-exact path

Per span:

1. Track events (song, ext, powered Insts' sequencers) fan out to powered Insts in zone; controller state to every Inst.
2. ModCore (if any track source is cabled) fills its per-chunk source rows.
3. Each Inst, in graph order: render → decimate → `osFade` → chorus/ensemble (classic) or Serum channels → **a Serum's own FX** (`setMods`/`setNote`/`trigger`/`process` exactly where today's code calls them, input = its main/direct/bus pairs per `CP.outMask`). Then the Inst's `post()` work (Serum `sxRel` drain).
4. Each shared Chain, in topological order: input = **copy of the first source, add the rest; a gain of exactly 1 is skipped**; `setMods` = ModCore's vector for that panel, or `null` as today; `setNote` = most recent source pitch; `trigger` on any source note-on; `process`.
5. Track sum (copy-first) → `panicFade` → `outStage`.

**In-place aliasing**: when a source has exactly one consumer and that consumer has exactly one source at gain 1, the chain processes the source's own buffers in place, and OUT aliases the last buffers. With one classic Inst and one Chain, or one Serum and its own FX, this performs **exactly today's operations in today's order**: render → decimate → osFade → chorus/ensemble → setNote/setMods → rack.process → panicFade → outStage. No arithmetic is added.

**A co-resident sequencer changes the span grid.** `SynthProcessor.process` splits spans at every sequencer event (303 `seqEvents`, Serum `sxSeq.next`), and `smStep(n)` (two cascaded one-poles with `k = 1 − exp(−n/τ)`), `gdrift` and Serum's per-span work depend on span length. So an instrument that shares a track with a running TB-303 or a Serum ARP/CLIP renders very slightly differently than it would alone. This is accepted and documented (one span grid is what lets ModCore feed every instrument per chunk); `engine-track.test.mjs` measures the difference and records its bound. Per-instrument span grids remain possible later if the difference is ever audible.

### 6.4 Idle skip

Today `engine.js:renderSpan` zero-fills and returns **without calling `outStage`** once the track has been quiet for 2 s and `rack.idle()`; the DC block and limiter state freeze during silence. The split preserves that exactly:

- **Single-instrument track**: the Inst skips under today's condition (quiet > 2 s and its FX idle), and then the Track skips the whole span including `outStage`. Identical to today.
- **Several instruments**: a quiet Inst (> 2 s, no tails, no warm-up) skips its render and contributes nothing, keeping `ctl` and Serum `SD.idle` clocks in time. The **Track-level skip (zero output, no `panicFade`, no `outStage`) happens only when every Inst skips and every Chain is idle.**
- A golden-graph case renders "note → 3 s silence → note" to prove the frozen-state behaviour matches.

### 6.5 Shared panels and each Serum's own FX

- **One shared panel = one Chain = one `FXRack`.** Chain identity is the panel id, so re-patching cables never rebuilds a rack: reverb and delay tails survive. Cost of an extra empty rack ≈ 0.00007 load.
- **A Serum's own FX is private.** Today Serum's master volume, Bypass, Direct, Bus 1 and Bus 2 levels are applied in the FX rack's output stage: `models.js:patchFor` passes `master: sp['g.master']` and `bypass: sp['g.bypass']` into `compileFx`, and `fx-dsp.js` holds them in FX-context slots [0…4]. `serum-core.js:fxModded2(s, rack)`, `CP.fxKey` and Serum preset loads (`{s, fx}`) also assume the rack belongs to one Serum. So:
  - every Serum always has its own 3-rack FX (possibly empty, then shown folded into VOICE), compiled exactly as today;
  - **nothing else may feed it** (refused, with the one-tap "Make a shared panel" fix, §2.13);
  - loading a Serum preset replaces only that Serum's own FX;
  - its single output (after the output stage, where Direct has joined) is the Serum's `out` jack, which cables into shared panels or OUT.
  The canonical Serum shape (Serum → own FX → OUT) is today's track, so goldens are unaffected.
- **Modulation**: Serum-native rows (`fx.*` destinations) reach only that Serum's own FX. Shared panels take modulation from track sources through `FXRack.setMods` (§7.9). If track sources also modulate a Serum's own FX, the Track sums the Serum's vector and ModCore's vector into a `Float64Array(1160)` scratch; when only the Serum's exists it passes through untouched (bit-identical).
- **Fan-in**: several sources into one shared panel are summed (copy-first) before `process`.
- **Bus jacks**: a Serum's BUS 1/2 sends feed only its own bus racks; their routes (Main, Direct, the other bus, per `fx.racks[k].route`) are drawn as cables inside the group.
- **Latency alignment (stage 4)**: when one source reaches OUT through parallel chains of different latency (Distortion 15 samples, Compressor look-ahead), the compiler adds per-edge delay compensation, reusing the splitter `align`/`alignCap` logic in `fx-dsp.js`. The single-chain path never has one.
- **Memory**: the 32 MB cap applies per rack; add a **64 MB per-track total** across chains (own FX included), enforced in `Chain.set` and reported through the existing `fxover` message.

### 6.6 Notes, key zones, power

- Song notes, live keys and MIDI arrive at the Track as today and fan out to each powered Inst whose zone admits the note, transposed by `xp`. The Track remembers per held note which Insts received it, so note-offs always reach the same set even if a zone changes mid-note. `seqOn` bookkeeping stays per track.
- **Controller state** (`bend`, `wheel`, `sus`, `at`, `mpe`, `pat`) goes to **every** Inst, powered or not: it is a scalar store with no render cost, and a powered-on instrument then starts with current values.
- Audition (`aud`) targets one Inst.
- **Power off**: stop note delivery, `allOff(true)` (≈ 3 ms fade), then idle skip. Its own sequencer stops: the Track leaves a powered-off Inst out of its `seqEvents` / `sxSeq.next` scan, so a TB-303 pattern or a Serum ARP/CLIP neither plays nor splits spans. Transport messages still reach it, so LFO clocks keep time. **Power on**: next note, plus restrike of held keys; its sequencer re-anchors to the song position through the same path it uses at transport start.
- **Solo in track** compiles to `on` flags; nothing new in the engine.

### 6.7 Graph compile (`cv-graph.js`, pure)

`compileTrack(track) → { canonical, patch?, graph?, patches, chains, mods }`

- **Validation (jack rules)**: no cycles; exactly one OUT; per-voice Serum cables stay inside their group; a Serum's own FX takes only its Serum; bus jacks only to own bus racks; ≤ 8 instruments, ≤ 16 shared panels, ≤ 48 effect instances per panel, 64 MB FX memory per track.
- **Canonical shapes** (§5.5) go through today's `buildPatch` path only.
- **Other shapes** emit `{t:'graph', …}`, per-Inst `{t:'patch', i, p}` (a Serum's includes its own FX as today's `p.fxr`/`p.fxrT`), per shared chain `{t:'chain', c, fxr, fxrT}` (`compileFx` per chain), and `{t:'mods', …}` when modulation needs it.
- Caching: `main.js:partDelta`/`ctDelta`/`sameVal` become keyed per Inst and per Chain.

### 6.8 Protocol

| Message | Dir | Scope | From |
|---|---|---|---|
| `{t:'patch', p}` (legacy, incl. `p.fxr`/`p.fxrT`) | → | Inst 0 + its FX (golden harness, preview, render farm, canonical tracks) | unchanged |
| `{t:'mon', ids}` | → | which Insts/Chains send snapshots (on-screen modules only) | 1d |
| `stats` gains `per:[{id, load, voices, os, pk}]` | ← | per Inst / Chain | 1d |
| `smon`, `step`, `fxph`, `fxover` gain `i`/`c` | ← | | 1d |
| `{t:'graph', insts:[{id, kind, on, zone, salt}], chains:[{id, racks}], edges:[[src, dst, g]], order, out, key}` | → | track; applied between quanta; new Insts/Chains built lazily (Serum voices `sxWarm`-style), removed ones hand their de-click tails to the Track | 1e |
| `{t:'patch', i, p}` / `{t:'chain', c, fxr, fxrT}` | → | one Inst (with its own FX) / one shared Chain | 1e |
| `{t:'power', i, on}` | → | one Inst | 1e |
| `seq`, `seqcmd`, `sqt`, `ct`, `os` gain `i` | → | one Inst | 1e |
| `on`/`off` gain optional `i` (audition) | → | | 1e |
| `{t:'mods', cp, rows, xfer, ext}` | → | ModCore + adapters | 2b |
| `song`, `transport`, `panic`, `bye`, `bend`/`wheel`/`sus`/`at`, asset messages | → | unchanged | — |

### 6.9 `main.js` bookkeeping, MIDI, the CPU safeguard

- `nodes.get(trackId)` stays. New `insts: Map(instId → {ctParts, sqParts, xsKey, last, load, voices, os})` holds the per-node part caches.
- `postTo(trackId, msg, instId?)`, `sendPatch(t, inst)`, `buildPatch(inst)`; per-instrument `voiceInfo`/`trackVoice`/chord notice.
- `monitors` becomes a list of subscriptions keyed by `(trackId, devId)`, driven by which module bodies are mounted (§2.11).
- **Live wheel routing**: `main.js:ctl('wheel')` posts to `targets(src)` plus every track with a Mod Wheel cable (§7.10). Bend, sustain and aftertouch keep today's `targets(src)`.
- **MIDI learn, program change and render-last become per instrument.** Today `midi.js` checks `H.isSx(t)` and reads and writes `t.vals.s.midi`, and `renderLast(t, o)` and program change follow the same one-Serum-per-track assumption.
  - MIDI learn: learn mode records the touched knob as `<devId>:<dest>`; the mapping is stored in that Serum's own `s.midi` (saved with its preset, as today). An incoming CC is applied to every Serum on each target track (`H.instsOf(t)`), each with its own map. Classic knobs get controllers through CC modules (§7.10) instead of learn.
  - Program change: loads into the track's **primary** instrument (stable, §5.4).
  - Render-last (`main.js:renderLast(t, o)`, the last input group): takes an instrument id and renders that Serum alone; the button sits on its VOICE (or bundled panel). Input groups (`lastIn`) stay per track and are shared by the track's Serums. `inputNote`'s `isSx(t)` becomes "the track has a Serum".
- **Safeguard** (`main.js:statsText`/`lowerOS`): same trigger (total load > 0.85 for 2 s, 1 s above 1), but it lowers **the heaviest instrument first**: classic → that Inst's OS halves (session-only); Serum → `sxCap`, then the `qrStep` quality steps Q1…Q6. The affected module shows a badge ("OS 4→2", "Q2") and the notice names it.

### 6.10 Offline, preview, render farm

- `renderOffline` (bounce) builds one Track per track with `processorOptions.graph` for non-canonical tracks and today's options otherwise. Offline = live is tested.
- `previewPatch`/`preview`, `renderLast` and `smprender.js` stay single-instrument on the legacy options (they still construct `Track` + one `Inst`).

### 6.11 Alternatives considered

| Alternative | Why not |
|---|---|
| Several Web Audio nodes per track (instrument nodes → FX nodes) | Float32 hop and a second limiter in the path break `golden-fx`/`golden-classic` for single-instrument tracks; Serum→FX modulation, key tracking and retrigger cross node boundaries; per-node costs unmeasured; no parallelism |
| Mixin host (`SynthBody(Base)`, nested cores in a separate `synth-track` processor) | Smallest diff, but two classes over one body make `AVoice`/`SerumVoice` host loads bimorphic where preview and hosts coexist (the inlining budget is already exhausted); the host must mirror each core's idle skip or its `outStage` state diverges; each core re-parses the song. **Kept as the fallback** if the `Inst` split misses its bench gate in stage 1d: then multi-instrument tracks only would use the mixin host, with per-span skip flags propagated and a bimorphism bench |
| Sharing a Serum's own FX with other instruments | Its output stage carries that Serum's master, Bypass, Direct and bus levels and its FX-context slots; a second source would be scaled by another instrument's master, and two Serums into one rack have no defined master or modulation vector (§6.5) |
| Per-instrument span grids | Exact even beside a sequencer, but ModCore and the track sum then need a second scheduling layer; deferred unless the co-resident difference (§6.3) is ever audible |

---

## 7. Universal modulation

### 7.1 Model

**A cable from a modulator to a knob is a modulation row**, evaluated with Serum's row formula (SPEC-serum2 §5.2), unchanged:

```
x = source → curve (crv / CT table) → slew (rise, fall) → bipolar → × aux (inv) ;  offset[dst] += amt · x
```

**One rule for every knob in every module**: `eff n = clamp(base n + Σ offsets, 0, 1)`, then the parameter's law (SPEC-serum2 §5.1); stepped laws round. Halos show range and live value (§7.11). Offsets are not smoothed (only row slew), so sample-and-hold steps survive, as in Serum.

### 7.2 Addressing and descriptors

- Destination id `<devId>:<paramId>`. DOM: each module root has `data-dev`, controls keep a local `data-dest`.
- `cv-mods.js:descs(dev)` returns `{id, label, law, lo, hi, def, fmt, scope, cls, nomod}`:
  - Serum: `serum-core.js:DESTS` (529 rows, scopes V / V* / V*M / G / M).
  - FX: `FXP_TAB` rows (`fx-core.js`), `nomod` where the FX defines it (e.g. Convolve's 6).
  - Classic: generated from `models.js` `K`/`S`/`B`: knobs `lin` over [min, max], selectors `enum`, toggles `bool`. Each control's class comes from a checked-in table generated by perturbing every control through `map()` **over the default patch and every factory preset of its model**, keeping the most demanding class seen (none < `sm` < `apply` ≈ `proc` < `chunk` < `struct`). Of the 425 classic controls: **`sm` 129, `apply` 70, `proc` 38, `chunk` 179, `struct` 7, `none` 2** (§7.8 says what each class means and when it becomes modulatable).

### 7.3 Sources

| Source | Class | Evaluated in | Rate |
|---|---|---|---|
| Mod Wheel (project), Aftertouch (channel), Bend | global | Serum targets: each Serum's own smoothers (`sx-mod.js:begin`, native sources); other targets: ModCore | per span, interpolated per chunk |
| Macro (track), CC | global | ModCore | per span → chunk |
| LFO · GLOBAL, Chaos (mono), a Serum's own MONO LFO linked outside it | global | ModCore (voice-less SxMod) | per chunk (4 base frames) |
| Velocity, Note (key track), note-on random | per note, constant | Serum targets: each voice. Other targets: "most recent note" values latched at each track note-on (ModCore) | at note-on |
| LFO · PER NOTE, ENV, a Serum's own POLY LFO or ENV linked outside it | per note, time-varying | Serum targets: an injected slot in that Serum, per voice. Other targets: ModCore's pseudo-voice, retriggered by the track's notes ("most recent note", dashed) | per chunk |
| A Serum's own ENV 1–4, LFO 1–10, macros, chaos, audio taps, on its own knobs and own FX | as in Serum today | its Serum | as today |

A chunk is 4 base frames (12 kHz at 48 kHz) for every instrument whatever its oversampling (`CH = 4·OS`); a span is ≤ 128 frames (≥ 375 Hz at 48 kHz). That shared chunk grid is what lets one track-level ModCore feed every instrument.

### 7.4 Destinations

| Destination kind | Applied as | Rate |
|---|---|---|
| Serum per-voice knob (V; V* sampled at note-on or one-chunk lag) | matrix row in the voice context | per chunk |
| Serum mono/global knob (G, mono side of V*M) | matrix row in the mono context | per span → chunk |
| FX knob, a Serum's own FX | Serum FX-context row (+ ModCore vector) → `setMods` | 16-sample blocks, linear ramp across the span |
| FX knob, shared panel | ModCore/Track row vector → `setMods` | same |
| Classic `sm` knob (analog engine; DX7/Solina: level only) | offset on the smoothed slot after `smStep` (§7.8) | per chunk, linear within the span |
| Classic `apply` knob (envelope times, filter character, 303 accent/decay) | per-voice `Env.set` / filter setter, called by the Inst | span (stepped) |
| Classic `proc` knob (LFO rate, glide, unison detune, Solina registers, DX7 DAC) | the Inst's span-rate setter | span (stepped) |
| Classic `chunk` knob | per-voice offset `AVoice.mo`, per-operator `FVoice` offsets | per chunk (stage 5) |
| `struct` / `nomod` | refused at drop | — |

### 7.5 What each cable does, and when (source × destination)

Cell = **compiles to · G (same value for all voices) / P (per voice) / R (most recent note, drawn dashed) · stage**.

| Source ↓ / Destination → | Serum knob | FX knob, a Serum's own FX | FX knob, shared panel | Classic `sm` | Classic `apply` / `proc` | Classic `chunk` |
|---|---|---|---|---|---|---|
| **Mod Wheel, Aftertouch, Bend** | native row injected from `track.mods` · G · **2a** | Serum FX-context row · G · **2a** | ModCore → `setMods` · G · 2b | ModCore → slot offset · G · 2b | ModCore → span setter · G · 2b | `mo` · G · 5 |
| **GLOBAL LFO, Macro, CC, Chaos, linked MONO Serum LFO** | `extK` row · G · 2b | `extK` FX-context row · G · 2b | ModCore → `setMods` · G · 2b | slot offset · G · 2b | span setter · G · 2b | `mo` · G · 5 |
| **Velocity, Note, note random** | native row (`velo`/`note`/`rand1`, per-cable `crv`) · P · **2a** | Serum FX-context row · R · **2a** | ModCore recent-note hold → `setMods` · R · 2b | recent-note hold → slot offset · R · 2b; P · 5 | recent-note hold → span setter · R · 2b; P · 5 | `mo` at note-on · P · 5 |
| **PER NOTE LFO, ENV, linked POLY Serum LFO / ENV** | injected Serum slot + row · P · 2b | injected slot, FX-context row · R · 2b | ModCore pseudo-voice → `setMods` · R · 2b | pseudo-voice → slot offset · R · 2b; P · 5 | pseudo-voice → span setter · R · 2b; P · 5 | per-voice evaluator → `mo` · P · 5 |
| **A Serum's own modulator, on its own Serum** | `s.matrix` row (today) | `s.matrix` FX row (today) | linked automatically (row above) | linked | linked | linked |

- **Nothing in this table is refused for being "per note"**: until stage 5, a per-note source on a non-Serum knob follows the track's most recent note (dashed cable); stage 5 upgrades classic knobs to true per voice.
- Any source → `struct`/`nomod`: refused, the knob shows a "not modulatable" mark.
- Cross-track: only the project Mod Wheel (§7.10). ModCore sources are deterministic functions of the frame clock, so project-wide LFOs need no shared memory if they are ever wanted.
- Audio-rate cables between instruments: not modulation, not in v1.

### 7.6 ModCore (`mod-core.js`, worklet classic script, loaded before `engine.js`)

- **It reuses Serum's modulation code instead of a new LFO engine**: a `SerumDSP.attach`-ed Serum state on a shim object with `voices = []`, **`OS = 1`, `CH = 4`, `fs = base`** (so its per-chunk rows line up with every Inst's 4-base-frame chunks), `wheel`/`at`/`bendRaw` read from the Track, `tp`/`songBeat()`/`bpm` forwarded. Its CP is compiled on the main thread by `compileSerum` from a synthetic state: track GLOBAL LFOs and linked MONO Serum LFOs → `s.lfo[l]` with `mono: 1`; PER NOTE LFOs and linked POLY LFOs → `s.lfo[l]` per voice; track ENV modules and linked Serum ENVs → ENV 2–4; the Macro module → `s.macros`; Chaos; all oscillators off.
- `SxMod.begin(shim, sx, nCh)` fills `g[src·32 + chunk]` per span with every Serum LFO feature (shapes, paths, BPM/HOST anchors, swing, S&H seeding on transport). This is the path `SD.idle` already runs without voices.
- **The pseudo-voice ("most recent note").** One `sx-mod.js:ModV` on a shim voice, driven by the track's notes: `noteOn` at every note-on that reaches any powered Inst (legato when other keys are held, so Serum's legato envelope rules apply), `noteOff` when the last held note is released. It evaluates the per-voice LFOs and ENV 2–4 of the synthetic state; processor TRIG/ENV LFOs restart at the same note-ons (`monoRestart`, kind `K_MONO`). Its per-chunk values feed every non-Serum target of a per-note source. Velocity and Note for non-Serum targets are latched at the same note-ons.
- **Spike first (start of stage 2b)**: confirm `begin` and `recentMod` with zero real voices and an all-off CP; one `ModV` on a shim voice (gates, legato, release with no amp output); unreferenced LFOs still evaluated (else internal keep-alive rows to a scratch destination); `transport` re-seeding. Fallback: extract the processor-LFO functions (`monoLfo`, `offLfo`, `freePos`) and a small ADSR with Serum's curve law into a standalone evaluator with the same arithmetic.
- **Track row evaluator**: rows in `track.mods` targeting classic slots, span setters and shared panels are evaluated by a small port of the SPEC-serum2 §5.2 row formula (curves from 129-point CT tables built by the `buildSerumT` part machinery), once per span with the last-chunk value (classic slots also get the span-start value for the ramp).
- Capacity: 10 LFO slots (GLOBAL, PER NOTE and linked together) and 3 ENV slots (ENV 2–4) per track for non-Serum targets; a second synthetic state can be added if users hit it (the spike checks whether ENV 1 can serve as a fourth).
- **Neutral rule**: no `{t:'mods'}` → no ModCore, no adapter work; the golden harness never loads `mod-core.js`.

### 7.7 Serum adapter

1. **Compile-time injection (D11).** `cv-graph.js` compiles each Serum from `vals.s` plus the `track.mods` rows that target it: `compileSerum(s, {extraRows, inject})` appends them to the compiled matrix after the preset's own rows. `vals.s` is never mutated, so loading a preset replaces `s.matrix` and the canvas cables are re-injected unchanged; a preset never creates canvas cables.
2. **Native sources** (wheel, at, bend, velo, note, rand) compile to rows with the native source. No DSP change (stage 2a).
3. **`ext` sources** for ModCore globals: append `ext1…ext16` to `serum-core.js:SOURCES` after index 61 (append-only, scope G; `sx-mod.js` `NSRC` grows from 62 to 78). A cable from a GLOBAL LFO to `i2:f.cutoff` compiles into an ordinary row with `src: 'extK'`. Before `SD.begin(inst)`, the Track copies ModCore's rows into the instance's `g[(S_EXT0 + k)·32 + c]` and sets `monoSrc[S_EXT0 + k]`. Voice, mono and FX contexts, curves, slew, halos and the 64-row cap then work as today. Gated by **the next free `CP.use` bit**: no ext rows → no copy → existing presets bit-identical.
4. **Per-note track LFO/ENV → Serum knob**: injection into a free LFO (1–10) or ENV (2–4) slot of the compiled CP, plus rows: true per voice. No free slot → the cable is still made, as "most recent note" through ModCore's pseudo-voice and an `ext` source (dashed), and the inspector says why.
5. **A Serum's own modulators outside it ("linked", automatic).** Dragging S1's LFO 3 or ENV 2 mod-out onto a knob that is not S1's (another instrument, another Serum, a shared panel) just works: the cable is a `track.mods` row with `src: 'i2/lfo3'`. The compiler copies that LFO's or ENV's state into ModCore's synthetic state (MONO → GLOBAL, bit-identical to S1's own by the cross-check below; POLY LFO or ENV → the pseudo-voice, dashed) or, when the target is another Serum, injects it into a free slot there (true per voice). Nothing leaves S1's preset; editing the LFO in S1 updates every linked copy on the next compile. This replaces the earlier explicit "Share with track" menu.
6. **Preset rows and "Save with preset"**: a preset's rows from performance sources appear as "saved with preset" cables; editing them edits `s.matrix`. A canvas cable from a performance source to a Serum knob has a "Save with preset" switch in its inspector that moves it into `s.matrix` (and back).
7. Rows from track sources count against the Serum's 64-row budget, shown on VOICE ("23/64") and in the Mod list.

**Cross-check (bit-identical)**: a GLOBAL LFO in ModCore cabled via `ext` to a Serum knob must render identically to the same LFO defined inside that Serum as MONO with an ordinary row (same code, same clock, chunk length 4 base frames in both).

### 7.8 Classic adapter

**Which knobs, when** (counts from the class table, §7.2):

| Class | Count | What it is | Sources | Mechanism | Stage |
|---|---|---|---|---|---|
| `sm` | 129 | knobs that land on a smoothed slot: on the 10 analog-engine models cutoff, env offset/amount, resonance, drive, HPF, dual filter, osc level, PW, tune, sub, noise, ring, ext, ring-mod depth; on DX7 (`fm`) and Solina (`divide`) the level only (`engine.js:smTargets` returns before the other slots unless `p.engine === 'analog'`) | all (per-note ones as R) | slot offsets (tier 1, below) | **2b** |
| `apply` | 70 | envelope times, filter character, 303 accent/decay | all (R for per-note) | per-voice `Env.set` / filter setters at span rate, called by the Inst for active voices when the value changed | **2b** |
| `proc` | 38 | LFO rate, glide, bend range, unison detune, Solina registers, DX7 DAC | all (R for per-note) | the Inst's span-rate setter | **2b** |
| `chunk` | 179 | everything voices read per chunk straight from the patch (mixer and waveform details, DX7 per-operator out/ratio/detune/levels, …) | all, true per voice | per-voice offset vector `AVoice.mo` (≈ 45 slots) in the control-rate block when `moOn`; per-operator offsets in `FVoice`; **edits the voice hot loop**, so gated by the iPad bench and `v8-guard` | **5** |
| `struct` | 7 | voice-structure switches: Prophet-5 and OB-Xa Unison, Jupiter-8 assign mode, OB-Xa filter slope, DX7 algorithm; and the HPF Cutoff knobs of the Moog Modular and Jupiter-8 (as wired today, sweeping them switches the HPF type; they could join `sm` if that switch is split off later) | — | `nomod` | **never** (in this plan) |
| `none` | 2 | Minimoog Mod Mix (`mm`) and Jupiter-8 PWM Source (`pws`): they changed nothing in any factory preset (they act only together with other settings) | — | re-checked against the live patch when dropped on; refused unless they act there (then classed by the same sweep) | — |

So at the end of stage 2b, **237 of 425 classic controls** take every modulator (per-note ones as "most recent note"); stage 5 adds the other 179 and true per-voice behaviour; 7 never do.

Also excluded from tier 1 until stage 5: oscillator on/off switches, and the level of a switched-off oscillator (`smTargets` writes 0 for it: "Switch the oscillator on to modulate its level").

**Tier 1 mechanism (slot offsets), without touching `AVoice`/`FVoice`.** Adding offsets to `smA`/`smD` alone would leave three holes: `AVoice.render` decides `needNoise = p.noise !== 0 || SB[S_NZ] !== 0 || …` from the unmodulated `smB`, so modulating noise up from 0 stays silent, and the sync/PWM start reads `SB[S_PW+1]`; `SynthProcessor.fadeOut` does `this.smA.set(this.smB)`, so offsets would vanish during de-click tails; and an off oscillator's level slot is 0. The adapter therefore works on all three arrays and restores exactly:

1. After `Inst.smStep(n)`, for each cabled slot `i`: save `u[i] = b[i]`; `a[i] += o_prev[i]`; `b[i] += o_end[i]`; `d[i] = b[i] − a[i]`; set `smMv = true`.
2. The voices render the span reading modulated `SA`/`SD`/`SB`, so `needNoise` and the sync start see the modulated values. `smStep` already re-bases `a[i] = b[i]` every span, so offsets never accumulate.
3. At the end of the Inst's span (after chorus/ensemble), restore `b[i] = u[i]` **by copy, not subtraction**, so `smStep`'s exact-settle test (`b[i] === t[i]`) and `smTargets`' range-switch test (`|tu − smB| ≥ 5`) see today's numbers.
4. `fadeOut` runs between spans on restored values; the Inst adds `o_end` to the cabled slots right after its `this.smA.set(this.smB)` (one guarded line in Inst code), so de-click tails keep the modulated timbre.

Cost: with no cables nothing runs and the voice code is untouched (bit-identical). **With cables it is not free**: `smMv` is true every span, so each voice takes the per-chunk interpolation path, including a `Ladder.setRes` (with a `pow`) per chunk. This is measured per voice and budgeted (§9.2), not claimed to be zero.

- **Knob space → slot units (transfer)**: on the main thread, `cv-mods.js` sweeps `models.js` `map()` over the cabled knob with the other knobs at their current values (129 points × ≈ 1 µs ≈ 0.13 ms per cabled knob) and stores either two coefficients (`a + b·n`, exact for the many knobs whose `oct = lg(ex(v))` is linear in the dial) or a 129-point table. The worklet adds `T(clamp(base + Σ)) − T(base)`. Rebuilt when base values change. Exact for single-knob modulation; interacting pairs (`lev = v1·m1`) are first-order only, noted in the Mod list.
- **Neutral rule**: an Inst with no cables never runs the adapter; `x + 0` is never evaluated in order-sensitive sums.
- **Cross-check**: a GLOBAL LFO on a classic cutoff must match an oracle that sets the slot target per span through `smTargets`, within 1e-9; a noise-level cable from 0 must produce noise; a fade-out during modulation must keep the modulated level.

### 7.9 FX adapter

ModCore/Track rows targeting a panel are evaluated into a per-chain FX-context vector (same `fx-core.js:fxLayout` indices) and delivered with `FXRack.setMods(off, key)` (key-validated, clamped ±2, linear ramp across the span, 16-sample re-evaluation). On a Serum's own FX the Track sums the Serum's and ModCore's vectors only when both exist. Classic tracks today call `rack.setMods(null)`; with no cables that stays the case.

### 7.10 Performance controls: Mod Wheel, Velocity, Aftertouch, Bend, Macros, CC

**Mod Wheel: one module per project (D9).**

- **Placing**: drag the Mod Wheel tile onto any track canvas. From then on it exists for the whole project (`project.perf.wheel`), it shows on **every** track canvas (its position is remembered per track in `track.lay.wheel`; on a track where it was never moved it sits top-left of the instrument column), and the tray tile greys out ("already in this project"). Deleting it from any canvas asks first and lists its cables everywhere ("Remove the Mod Wheel and its 9 cables on 3 tracks?").
- **Cables**: each is a row in the `track.mods` of the track whose knob it lands on, with `src: 'wheel'`. The module's jack shows "+N on other tracks"; tapping it lists them and jumps to one.
- **Value**: each track's audio node already holds a wheel value (`engine.js` `this.wheel`, written by `{t:'wheel'}` and by the track's recorded wheel lane in `songEvents`). The cables compile into each track's rows reading that value (Serum native `wheel` rows, ModCore for everything else). No shared audio memory.
- **Which tracks the live wheel reaches**: today `main.js:ctl('wheel')` posts only to `targets(src)` (`midi.js:targets`: the selected or armed tracks, or the tracks on that MIDI channel). With the module placed, the wheel also posts to **every track that has at least one Mod Wheel cable**, so moving the physical wheel (on-screen or MIDI CC 1) moves every knob tied to it on every track. On those tracks the instruments' own wheel routes also respond (a Serum preset's wheel rows, classic hard-wired wheel routes), because it is one physical wheel. Without the module, routing is exactly today's.
- **Recording**: unchanged: the wheel is recorded into armed tracks among `targets(src)` (`main.js:recCC`). Arm a track to record its wheel moves.
- **Playback**: each track's recorded wheel lane plays into that track only, as today. A track without a lane keeps the last live value. Moving the wheel during playback: the last writer wins on each track (today's behaviour).
- The module shows the live wheel; during playback it shows the selected track's lane value.
- MPE Y stays per track. Classic hard-wired wheel routes (`lfo.wheelPitch`, `wheelFilter`, `osc[k].wheelPitch`/`wheelPw`) stay instrument knobs, marked with a small wheel badge.

**Velocity**: one per track, the visual form of `velo`. Per-cable curves use `row.crv` (`mCrv`); each Serum keeps its own `s.velo` curve in the VOICE fold-out for local shaping.

**Aftertouch, Bend**: one each per track (they follow that track's note input).

**Macro**: track Macro modules (8 knobs, global). A Serum's own 8 macros stay owned by that Serum.

**CC**: a source module bound to a controller number. Cheaper than MIDI Learn (no patch recompile per CC) and it reaches classic and FX knobs. Existing Serum `s.midi` mappings keep working (§6.9).

### 7.11 The canvas mod layer (`cv-modlayer.js`) and halos

- Generalises `serum-ui.js:installModLayer`/`tileDrag`/`hitTest`/`doDrop`/`scanMods`/`paintMods` to one layer on `#viewport`. Knobs keep today's press-and-hold mod menu (`serum-ui.js`; the user asked to keep it); classic knobs gain the same menu.
- Drop resolution: `elementFromPoint` → `closest('[data-dest]')` → `closest('[data-dev]')`; validity from the device's descriptor table; refusals per §2.13.
- **Halos**: Serum and FX knobs are wk widgets and use the existing `setMod` halos (`serum-ui.js:haloArcs`). **Classic knobs are not wk widgets** (they are `main.js:control` / `knob` / `slider` / `numBox` DOM), so stage 2b adds new code in `classic-panel.js`: `data-dest` on each control, a halo ring (one absolutely positioned SVG arc per modulated knob, drawn in the same style as `haloArcs`), a range bar for sliders and a small badge for number boxes and switches.
- Halos are painted only for mounted, visible modules above the card threshold, at the monitor snapshot rate (`smon`, ≤ 30 Hz), from per-instrument `eff` snapshots; classic Insts gain a small snapshot of their modulated slot and setter values.

---

## 8. Serum on the canvas

### 8.1 Principle

**One Serum = one voice group**: one `vals.s` state, one `Inst`, one `SerumVoice` pool, one own FX. `serum-dsp.js:SerumVoice` is a fused per-voice chunk loop with fixed summation orders, unison-aligned FM and shared scratch; splitting it into separate DSP objects would break bit-exactness and the CPU budgets. So the canvas modules are **views of one Serum's state**, and every internal cable maps one-to-one onto a field that already exists. Removing a part powers it off (`a.on`, `b.on`, `c.on`, `s.on`, `n.on`, `f.on`, `f2.on`), which is already O(1) in the DSP.

Each Serum can be shown two ways (`⋯ → Show parts / Bundle`): **bundled** (today's whole `SerumUI` in one module, the default until stage 3 and a permanent fallback) or **parts**. Switching loses nothing; parts view stores only positions (`lay['i2/oscA']`).

### 8.2 Module catalogue

| Module | Contents (existing UI) | State | Count per Serum |
|---|---|---|---|
| **VOICE** (required; deleting it deletes that Serum, with confirmation) | note input (key-zone pill, ARP/CLIP cable in), POLY n / MONO / LEGATO, steal, one-note, glide (time, curve, always, scaled), bend range, tune, AMP, **ENV 1 graph and knobs** with a mod-out jack, master, row budget "12/64", voices, CPU, render-last. Outputs **MAIN, DIRECT, BUS 1, BUS 2** into its own FX. Fold-out: quality/OS, S1 mode, MPE, tuning, Voice Control, VELO/NOTE curves, unison defaults | `voicing`, `g.*`, `e1.*`, `global`, `vc`, `velo`, `note` | 1 |
| OSC A / B / C | `sx-ui-osc.js:OscPanel` (type views, pitch, **unison**, warp 1/2 with source jack, level/pan, key range, bus-send knobs, AMP ENV toggle) | `osc[o]`, `a.*`/`b.*`/`c.*` | ≤ 3, letters always visible |
| SUB, NOISE | `SubPanel`, `NoisePanel` | `sub`, `noise` | ≤ 1 each |
| FILTER 1 / 2 | `FilterPanel` | `filter[k]`, `f.*`/`f2.*` | ≤ 2 |
| ENV 2–4, LFO 1–10 (the Serum's own) | extracted `envPanel`, `lfoPanel` (+ `graph.js` editors, LFO tools and shape library), mod-out jack, MONO/POLY shown as GLOBAL/PER NOTE badge | `env[k]`, `lfo[l]` | as used |
| MACROS, CHAOS | extracted `macrosPanel`, `chaosPanel` | `macros`, `chaos` | 1 each |
| ARP, CLIP | `sx-ui-seq.js:ArpPage`/`ClipPage` with `KeyboardPanel` (transpose, scale) | `arp`, `clip`, `kbd` | 1 each, cabled into VOICE's note input |
| **S1 FX** (its own FX, §6.5) | Main rack, with Bus 1 / Bus 2 as tabs or extra panels; folded into VOICE as `FX ▸` when all are empty | `dev.<id>.fx` | 1 (3 racks) |

- Members carry the group's colour stripe and chip ("S1"). The group outline is drawn only while a member is selected. Selecting VOICE highlights all members.
- Identity matters to the DSP and stays visible: OSC A/B use PRNG stream `r` in Phase-1 order, C uses `r2`; warp sources `_o1/_o2` are relative to the target; summation order is fixed (`CHX` A, B, Noise, Sub, C).
- Serum's MIX and FX pages are not needed in parts view (cables and S1 FX replace them); MATRIX is replaced by the Mod list; GLOBAL folds into VOICE. All remain in the bundled view.

### 8.3 Jack rules (data from `sx-ui-mix.js:channelStrips` / `routeMenuItems`)

| Cable | Writes | Rule shown to the user |
|---|---|---|
| Source → FILTER 1 and/or 2 | `osc[o].route = 0`, `p['f.routeX']` / `p['f2.routeX']`; both → balance `x.fbal` (a knob at the cable's fork) | Each source has **one output**: its filter(s), VOICE Main, VOICE Direct, or nothing. A new cable replaces the old one with an animated unplug |
| Source → VOICE MAIN / DIRECT | route 1 / 2 | same |
| Source of Serum 1 → FILTER of Serum 2 | `serum-core.js:copyModule(dst, src, 'oscB', 'oscA', {mods: true})` into Serum 2's first free slot of that kind, then Serum 1's part powers off | done automatically with "Moved OSC B to Serum 2 · Undo" when Serum 2 has a free slot; refused with the count when it is full. Warp/FM references to Serum 1's other oscillators are dropped and listed in the notice |
| FILTER 1 → FILTER 2 (or the reverse) | `filter[k].route = 0` | one direction only; the most recent choice wins (today's rule; `syncCP`) |
| FILTER → VOICE MAIN / DIRECT | `filter[k].route` | — |
| Bus sends | `x.bus1`/`x.bus2` knobs on the source | knobs, not cables |
| AMP ENV per source | `osc[o].env`, `sub.env`, `noise.env`, `filter[k].env` | a toggle at the cable's VOICE end |
| OSC → OSC warp / FM / pitch source | `p['k.w1'\|'k.w2']` mode family + `_o1/_o2/_noise/_sub/_f1/_f2`, `pitch.src` | dotted cable; same group only; **cycles refused up front** (`oscSetup` would silently drop the edge) |
| VOICE BUS 1/2 | its own bus racks (`fx.racks[k]`), `g.bus1v`/`g.bus2v` | only to its own FX |
| VOICE DIRECT | `g.direct` | read-only cable to its own FX's direct jack |
| S1 FX out → shared panel / OUT | `track.wires` | anything else into S1 FX is refused ("Make a shared panel") |

Routing switches are themselves modulatable bool destinations (`f.routeX`, `*.on`); a cable a matrix row switches gets the "modulated" tick.

### 8.4 Recommendation: envelopes, LFOs and voicing (the user's open question)

1. **Voicing and the amp envelope live together on one VOICE module, the heart of each Serum.** It decides how many notes play, how they glide, and when a note ends. ENV 1 is the volume of each note and decides how long each voice lives (the lifetime rules in `SerumVoice.chunk`), so it cannot float free: a patch without it would hold notes forever. ENV 1 still has a mod-out jack, so it can modulate other knobs, its own Serum's and (as "most recent note") anything else on the track.
2. **ENV 2–4 and the LFOs are separate modules you can place anywhere.** Ones that came with a Serum preset wear that Serum's colour and are saved in its presets. New ones dragged from the tray belong to the track. Both kinds look and edit the same, and **both can be cabled to any knob on any synth or panel of the track**: a Serum's own LFO cabled outside its Serum is linked automatically (§7.7), with no menu step.
3. **LFO modules carry one clear switch: GLOBAL (default) or PER NOTE.**
   - GLOBAL: one wave for the whole track, in sync everywhere it goes (any synth, any panel, any Serum part). This is "drag an LFO anywhere and apply it to any knob on any synth".
   - PER NOTE: the wave restarts with each note. On a Serum knob each voice runs its own copy. On any other knob it follows the track's most recent note (dashed cable) until stage 5 makes classic synths truly per note.
   - ENV modules are always per note and behave like PER NOTE LFOs.
4. **FX knobs see the mixed sound, not single notes.** A per-note modulator on an FX knob follows the most recent note, and the cable is dashed.
5. **Voicing stays with each instrument.** Each Serum's VOICE and each classic panel keep their own poly/mono/legato/glide, so a mono bass and a poly pad can share a track. Unison stays on each oscillator, where the DSP keeps it. ARP and CLIP become note modules plugged into a VOICE.
6. **Velocity is one module per track; the Mod Wheel is one module for the whole project**, pinned on every track canvas, cabled to as many knobs as you like on any track. Each Serum's own velocity curve stays in its VOICE fold-out.
7. **Classic synths keep their built-in envelopes and LFO inside their panels**, as on the hardware; canvas modulators add to them.

Limits, stated openly in the tray and in refusals: one Serum holds 3 OSC, 1 SUB, 1 NOISE, 2 FILTER, ENV 2–4, 10 LFOs, 8 macros and 64 modulation rows; an oscillator can feed only its own Serum's filters (cabling it into another Serum's filter moves it there). Several Serums share panels and track modulators freely.

### 8.5 Building, joining, moving, removing parts

- **"Serum (complete)"** drops an arranged group: VOICE, its folded own FX, plus the parts that are powered on in its default preset, cables drawn.
- **A single part** joins the Serum whose group frame it lands in, or the only Serum on the canvas with a free slot of that kind (the frame lights up during the drag); otherwise it starts **a new Serum** with its VOICE auto-placed to the right and auto-cabled. Full → toast: "Serum 1 already has 3 oscillators. Added to new Serum 2."
- **Removing** a part powers it off and hides it (settings kept; dragging it back restores them; Init is in the menu). A tray badge shows hidden parts.
- **Loading a preset** onto VOICE replaces the Serum's state and its own FX, adds modules for parts that are now on, never removes modules (parts now off just dim), and never touches canvas cables (D11): rows from track modules are re-injected; a canvas cable whose target knob no longer exists in the new preset's routing (for example an FX knob of an effect the preset removed) turns red, "target missing", and stays until deleted or until a preset brings the target back.
- **Moving a part to another Serum**: by cabling it into the other Serum (§8.3), from the menu, or by dragging the part into the other group's frame. Uses `serum-core.js:copyModule(dst, src, 'oscB', 'oscA', {mods: true})` (re-targets its matrix rows), then powers the source part off. Undoable.
- ARP or CLIP dropped on a track without a Serum: "ARP and CLIP play a Serum · Add Serum" (one tap adds "Serum (complete)" and cables the tool to it). Note tools for classic synths are a later idea, not v1.

### 8.6 `SerumHost` (UI engineering, `sx-host.js`)

- **One headless controller per Serum instance**, owning what `SerumUI` owns today: the kit (`serum-ui.js:makeKit`, bound to the host instead of a page), a registry of mounted views, snapshot subscription by instance id, halo painting for visible views, popover/overlay hosting in `#ov`, panel undo (cap 4 MB per instance on touch).
- **Paint loop**: one canvas-wide rAF scheduler replaces each `SerumUI.paint`; it paints only views that are mounted, visible and above the card threshold (`shownPages()` becomes "visible mounted views"). `scanMods` runs per view.
- **Views**: `OscPanel`, `SubPanel`, `NoisePanel`, `FilterPanel` mount as they are. `envPanel`, `lfoPanel`, `macrosPanel`, `voicingPanel`, `vcPanel`, `chaosPanel`, `unisonPanel`, `qualityPanel`, `tuningPanel`, `mpePanel` move from `SerumUI` methods into `sx-ui-mod.js` classes with the `OscPanel(root, kit, …)` signature, each with `destroy()` so culling can unmount it (§2.11). Each part root gets `container-type: inline-size` so the `@container sx` rules apply per module.
- The `rowC` and `tileStrip` duplication (one copy per page today) disappears in parts view: each ENV/LFO/macro exists once. The tile strip is replaced by mod-out jacks plus the track Velocity and project Mod Wheel modules.
- `data-dest` ids are namespaced by the `[data-dev]` ancestor (`a.level` exists in every instance).

---

## 9. Performance budgets and platform (iPad)

### 9.1 What is measured, and how

- **No iPad numbers exist yet** (`tests/bench.json` has `"ipad": null`). **Stage 1a gate**: the user opens `tests/bench.html` on their iPad Pro (installed PWA closed, Safari tab, plugged in, nothing else running) and runs it **five times**; the page reports the median per row, which goes into `bench.json` as the iPad baseline. Every audio limit below is provisional until then, and the engine work (1d) does not start before it.
- **Repeat runs**: the user runs the same five-run `bench.html` at stages **1d, 1e, 2b and 5** (the stages that change the engine). These are the only iPad gates; everything else is gated on the Mac.
- **"Measure this device"** in `⚙` (stage 1e) runs a short subset of `tests/bench-scenarios.mjs` in a Worker (the `smprender.js` pattern) and stores a device factor in prefs. Tile cost estimates = per-model cost table × factor.
- Reference figures (M4 Max, node, 48 kHz, audio-graph map §7): classic 4-voice poly at OS 4 ≈ 0.02–0.035; mono classic ≈ 0.011–0.019; default Serum (4 voices) ≈ 0.021; heavy Serum (bench row d) ≈ 0.40; FX chain EQ+chorus+delay+reverb ≈ 0.012; extra empty rack ≈ 0.00007; idle track ≈ 0.00013. Estimated iPad factor ×1.0–1.3 (M4), ×1.5–1.8 (M1/M2), ×2.5–3 (A12Z).

### 9.2 Audio budgets and gates

**Engines.** The iPad runs JavaScriptCore, not V8, so every engine stage has three gates:

| Gate | Where | Method | Limit |
|---|---|---|---|
| V8 | Mac, every commit touching the worklet | `bench.test.mjs` / `cpu-gate.mjs`, calibrated rows | ≤ 2 % per row vs `bench.json` `node` |
| JavaScriptCore | Mac, stages 1d, 1e, 2b, 5 | the `bench.json` `jsc` method: macOS JSC shell, voice rows rendered as in `measure()`, median of 5 × 1 s | ≤ 3 % per row vs the `jsc` row; worst quantum ≤ the `worstMs` row + 10 % |
| iPad | the user's iPad, stages 1d, 1e, 2b, 5 | `tests/bench.html`, five runs, median per row | canvas median ≤ baseline median × 1.05 per row, or within the baseline's own run-to-run spread if that is larger (a 3 % gate would sit inside device noise) |

| Item | Budget | Gate |
|---|---|---|
| Engine split overhead (1d) | as the three gates above, on every row | V8, JSC, iPad |
| Powered-off or quiet instrument | ≤ 0.0005 load once tails end | `engine-track.test.mjs` |
| ModCore, 10 GLOBAL LFOs + pseudo-voice + 16 cables | ≤ 0.002 per track (M4 Max) | new bench row (2b), V8 and JSC |
| Classic tier-1 offsets, no cables | no change (no work runs; voice code untouched) | bench rows bit-for-bit, `v8-guard` |
| Classic tier-1 offsets, with cables | documented cost per voice (per-chunk interpolation incl. `Ladder.setRes`); target ≤ 8 % on an 8-voice classic row with one cutoff cable | new bench row (2b), V8 and JSC |
| Classic span setters (`apply`/`proc`) | ≤ 1 µs per cabled control per span per active voice (Mac) | new bench row (2b) |
| Tier 2 (`AVoice.mo`, stage 5) | ≤ 3 % (V8, JSC) on classic rows with modulation off; documented cost per voice with it on | V8, JSC, iPad + `v8-guard` |
| Project ceiling | ≤ 0.6 total on the measured iPad (SPEC-serum2 §14.1 per-scenario ceiling); above that the safeguard steps the heaviest instrument down, audibly gracefully, never dropping out | iPad soak |
| Worked example | one track of Prophet-5 + Juno-60 + default Serum + one 3-effect panel ≈ 0.10 (Mac) ≈ 0.15–0.18 (M1/M2 iPad); six such tracks ≈ 1.0 on M1/M2 → **the safeguard is expected to act**. Freeze/bounce per instrument is out of scope | — |
| FX memory | ≤ 64 MB per track (32 MB per rack stays) | `fxover` |
| Worklet assets | ≤ 128 MB on touch devices (existing) | existing |
| Allocation on the audio thread | none in render paths (`noAlloc`, GC check); adding an Inst/Chain allocates in `msg` between quanta, Serum voices built lazily (≤ 1 ms per quantum) | `noAlloc`, `bench.test.mjs` |

**Warm-up coverage.** `engine.js:warmUp` today runs `WARM` patches, `SerumDSP.warmUp` and `rack.warmUp` through one processor. It is extended (in `Track`) so the first real note never runs unoptimised on the iPad: two Insts into one shared chain (1e); a Serum with its own FX into a shared chain (1e); a powered-off Inst and a power-on restrike (1e); ModCore with a GLOBAL LFO, the pseudo-voice and a track row (2b); an `ext` row on a Serum (2b); classic tier-1 offsets and one span setter (2b); `AVoice.mo` (5). `restore()` then returns every warmed object to its fresh state, as today. `bench.test.mjs` asserts the first quantum after warm-up of each new path is within 1.5× its steady state.

**Soft caps on touch devices**: a warning when a 4th instrument is added to a track; a confirmation before a second "heavy" Serum (estimate > 0.15 on this device, from voices × unison × oscillators × granular/spectral, the `qrStep` inputs). **Hard limits**: 8 instruments and 16 shared panels per track; 48 effects per panel.

### 9.3 UI budgets

| Item | Budget |
|---|---|
| Pan/pinch frame rate with 3 instruments (one a full Serum) on screen | 60 fps; main thread ≤ 6 ms per frame during a gesture (transform only, no layout, no mounting) |
| Zoom end (re-raster + canvas rescale) | ≤ 50 ms for visible modules |
| Track switch | cards ≤ 100 ms; visible bodies mounted ≤ 600 ms in slices of ≤ 12 ms |
| Mounted DOM, selected track | ≤ 9k elements; bodies beyond it stay cards ("zoom in to edit", §2.11); a card ≤ 30 elements |
| Live canvases | only mounted bodies own canvases; unmounted ones are released (0×0). Total backing store ≤ 64 MB; each ≤ 16e6 px; render scale `min(dpr·k, 2)` |
| Monitor traffic | `smon` only for mounted, on-screen modules (`{t:'mon', ids}`), ≤ 30 Hz; cable glow ≤ 15 Hz |
| Graph compile per edit | ≤ 2 ms (main thread); transfer tables ≈ 0.13 ms per cabled classic knob |
| Serum panel undo | ≤ 4 MB per instance on touch (16 MB today) |
| History record | ≤ 1 ms per gesture for a track with two Serums |
| Inactive tracks | unmounted (today's behaviour); an LRU of 2 mounted canvases only if stage 6 measurements allow |

### 9.4 Platform minimums

- The app's error message still claims "Safari 14.5+" (`main.js:412`, AudioWorklet). The canvas build needs more: `overflow: clip` and `@container` (Safari 16; Serum's panel already uses `@container`), `dvh` (15.4), the `playback` audio session (16.4).
- **SYNTH Canvas requires iPadOS / Safari 16.4 or later** (Chrome 108+, Firefox 110+ on desktop). The canvas branch updates the message and the PWA install sheet accordingly.
- `content-visibility` (Safari 18) is used only as an optional paint hint, never for correctness; culling unmounts (§2.11). Nothing else needs a version above 16.4.

---

## 10. Milestones

The user agreed to three milestones: **1 = canvas + trays + modules + cables + several synths per track, 2 = universal mod modules, 3 = Serum taken apart.** Milestone 1 is too large to land in one step without risking the live sound, so it is cut into five stages; each is deployed with `tools/deploy-canvas.sh`, passes the gate set of §11.1 and the iPad checklist items listed, and leaves canvas.domlavin.com fully usable. `main` is untouched. Sizes are relative (S < M < L).

| Stage | Milestone | What canvas.domlavin.com shows after it | Size | Audio code touched? |
|---|---|---|---|---|
| **1a** Foundations | 1 | Today's app, unchanged, named "SYNTH Canvas", with its own storage | S | no |
| **1b** Canvas shell | 1 | The canvas: top tray, keyboard tray, Sources tray with drawings; today's instrument and its FX as movable modules side by side; read-only cables; pinch/pan | L | no |
| **1c** Instances and project v2 | 1 | Same, plus minimap, box-select, "Save as classic project"; files open on main as their main instrument | M | no |
| **1d** Track engine | 1 | Same sound; CPU shown per module (the engine is split inside, invisible) | L | yes (split, invisible) |
| **1e** Several synths per track | 1 | **Milestone 1 complete**: several synths per track, each switchable, cabled into shared or separate FX panels and mixed into one OUT; Effects tray; key zones | L | yes |
| **2a** Performance modulators | 2 | The project Mod Wheel, Velocity, Aftertouch, Bend modules cabled to any Serum knob and its own FX; Mod list; cable inspector | M | no |
| **2b** Modulation everywhere | 2 | **Milestone 2 complete**: LFO (GLOBAL / PER NOTE), ENV, Macro, CC, Chaos modules on any Serum knob, any FX knob and 237 classic knobs; the Mod Wheel on all of them | L | yes (neutral-gated) |
| **3** Serum taken apart | 3 | **Milestone 3 complete**: OSC, SUB, NOISE, FILTER, VOICE, ENV, LFO, ARP, CLIP as separate modules with internal cables | L | no |
| 4 Full patching | later | panel → panel chains, one synth into several panels, latency alignment, split/merge panels | M | yes |
| 5 Per-voice classic modulation | later | true per-note velocity/ENV/LFO on classic synths; the remaining 179 classic knobs | M | yes (gated) |
| 6 Scale and polish | ongoing | presets of whole canvases, accessibility, refinements | – | no |

Order rationale: the user asked for several synths per track before modulators, so the performance modulators (formerly bundled with the engine split) now come after 1e. Stage 1d exists only because 1e needs it; it ships alone so any sound change is caught before anything depends on it.

### 1a: Foundations

- **Scope**: storage namespace (`DB_NAME = 'synth-canvas'`, `synthc.` key prefix); **schema check and read-only open** (§5.8) so every later build is protected; project `uid`; **iPad bench recorded** in `tests/bench.json` (five runs, §9.1); skeletons of `cv-migrate.js`, `cv-graph.js`, `cv-mods.js` (classic class table generated over defaults and factory presets, checked in) with node tests; platform message (§9.4); this spec's open questions answered.
- **User sees**: nothing new except the app name.
- **Acceptance**: a canvas build on localhost cannot read or write main's `synth-app` database or `synth.*` keys; a project with `schema` above `SCHEMA` opens read-only and is never overwritten; `bench.json` `ipad` populated; skeleton tests green.
- **Tests**: `appstore` namespace test; `cv-migrate.test.mjs` (schema gate); `cv-mods.test.mjs` (class table matches a fresh perturbation run over defaults and factory presets).

### 1b: Canvas shell (UI only; no audio file touched; no de-globalisation)

- **Scope**:
  - Fixed shell (`index.html`, `style.css`): top tray with `cv-tray.js:trayGrip` and `budget()`, compact transport + arrangement toolbar + `⚙` + `≡`, track rows with one instrument chip each; keyboard as footer on the same grip helper; `CANVAS │ ROLL` (FX tab and model nav removed); `#ov` layer; side trays opened by tap, grips inset ≥ 24 px.
  - `cv-world.js`: camera, grid, pan/pinch/momentum with the viewport guard, **native-zoom hand-over** and the "Pinch on canvas" switch (§4.3), fit, focus reveal, cards, **unmount culling**, toolbar (zoom, fit, tidy, mods filter placeholder).
  - `gesture.js` hooks, pan continuation, late-finger upgrade and editor-zone rule (§4.2); transform fixes (§4.7) including `wk.edgePan2`; counter-scaled hit areas (§4.5); cable strokes from `--ik` and the WebKit check of `non-scaling-stroke` (§2.9).
  - Modules (`cv-module.js`): **today's `#inst`** (classic `renderPanel` or the whole `SerumUI`) inside an Instrument module; **today's `FXRackUI`** kept mounted inside an FX Panel module; OUT module with the scope; About/DX7 diagram in `⋯`. `monitors.wanted` changes from "tab visible" to "module mounted"; Serum panel and FX panel refresh each other on edits.
  - Derived read-only cables (instrument → panel → OUT; Serum bus/direct labels).
  - Sources tray (synths) with `cv-art.js` illustrations: drop on canvas replaces the instrument (undo toast); drop on track list adds a track.
  - Module move/fold persisted in `track.lay` (additive field whitelisted in `song.js`, schema bump), one undo step per move; camera in prefs keyed by project uid.
- **User sees**: everything the app does today, laid out on a canvas, instrument and FX side by side, about twice the vertical room on the iPad.
- **Acceptance**: no DSP or compile file differs from the merge base: `git diff $(git merge-base main HEAD) -- engine.js serum-dsp.js fx-dsp.js fx-mods2.js sx-base.js sx-filt2.js sx-warp.js sx-mod.js sx-sample.js sx-gran.js sx-spec.js sx-seq.js serum-core.js fx-core.js models.js laws.js tuning.js` is empty (UI files such as `sx-ui-osc.js`, `graph.js`, `fx-ui.js`, `wtedit.js` do change, for `localPoint`); all goldens pass; every today-feature reachable (checklist); iPad items 1, 2, 3, 5, 6, 7, 10 pass.
- **Tests**: `main-sim.mjs` and `keyboard.test.mjs` adapted to the shell (ids kept); `gesture.test.mjs` cases of §11.3; `cv-world.test.mjs` (camera maths, `localPoint` at k = 0.5/1/2, culling and unmount/remount, cards, pinch-defer); `wk.test.mjs` `localPoint`, `closeTransient`, wheel veto, `edgePan2`; `lint.test.mjs` precache list.

### 1c: Instances and project v2 (UI and data only)

- **Scope**: `classic-panel.js:ClassicPanel(root, ctx)` (≈ 520 lines of `renderPanel`, `control`, `presetUI`, `seqUI`, `showTip` with `vals`/`model`/`ui`/`trk()` passed in; adds `data-dest`; `destroy()` for culling); `SerumUI` safe to run more than once (`data-dev` scoping, popovers/overlays in `#ov`, 4 MB undo cap on touch); one `FXRackUI` per panel; `monitors` as subscriptions; project v2 (`cv-migrate.js` `toV2`/`toV1`, `track.prim`, `cv-model.js:adopt`, transition accessors); `cv-graph.js` canonical compile through today's `buildPatch` path; file mirror (§5.8); "Save as classic project"; "Import library" (§5.6); minimap; marquee and multi-select; track-switch mounting over frames.
- **User sees**: same as 1b plus minimap, multi-select, Save as classic project; a canvas file opened on main shows each track's main instrument.
- **Acceptance**: **the canonical message stream equals main's** (`canonical-stream.test.mjs`, §5.5); `toV2 → toV1` round-trip exact for canonical tracks; accessors present after every History step; a canvas file opened in main's `loadProject` yields the primary instruments and their FX; **DOM and memory measured on the iPad** with a dev fixture mounting 3 Serum + 2 classic + 3 panel instances (numbers recorded; card threshold, culling margin and the mounted-body budget tuned against §9.3).
- **Tests**: `cv-migrate.test.mjs`, `cv-graph.test.mjs`, `canonical-stream.test.mjs`, `classic-panel.test.mjs` (two instances don't share state; destroy/remount keeps values), ported `serum-ui` tests with two instances.

### 1d: Track engine (invisible)

- **Scope**: `engine.js` split into `Track`/`Inst`/`Chain` with the verbatim-move rule, facade, idle-skip rule (§6.4), warm-up moved to `Track`, `{t:'mon', ids}`, per-Inst `stats`. `main.js` still sends legacy messages (all tracks canonical). Per-module CPU on the top bars.
- **User sees**: CPU per module; nothing else.
- **Acceptance**: goldens bit-identical; **`golden-graph.test.mjs`** green (§11.2); V8 ≤ 2 %, JSC ≤ 3 %, iPad five-run median within its gate (§9.2); `noAlloc`, GC check, `v8-guard` pass; idle-then-note case identical. If the split misses a gate, fall back per §6.11.
- **Tests**: `golden-graph.test.mjs`, `engine-track.test.mjs` (facade fields, stats per Inst).

### 1e: Several synths per track (completes milestone 1)

- **Scope**: `graph`/`patch i`/`chain`/`power` protocol; N Insts → shared or separate panels → OUT (fan-in), a Serum through its own FX into a shared panel; editable audio cables (connect, re-patch, disconnect, "Make a shared panel"); Sources tray drop adds instruments with auto-patch and the "not connected" badge; Effects tray (panel tile, effect tiles into panels or onto empty canvas); power (sequencers paused, controller state kept), solo in track, key zones and transpose; instrument chips and "Make primary"; PRNG salts (§6.2.1); per-instrument `main.js` maps, MIDI learn, program change and render-last (§6.9); safeguard per instrument; soft caps; "Measure this device" and tile cost estimates; `renderOffline` graphs; `toV1` splitting multi-instrument tracks; restrike held keys on power-on; warm-up of the new paths; removal of the transition accessors.
- **User sees**: a Juno and a Minimoog (and a Serum) on one track, into one panel or separate panels, each switchable, mixed into one OUT.
- **Acceptance**: canonical tracks still produce main's message stream; **two sequencer-free Insts into one chain equal copy(A) + B rendered alone, before the limiter**, bit for bit; with a TB-303 or Serum ARP beside them the difference is measured and within the recorded bound (§6.3); two identical Junos on one track are not sample-identical (salts); a powered-off TB-303 fires no notes and splits no spans; power off/on click-free (largest step < −60 dB) and ≤ 0.0005 load when off; bend/wheel set while off are current at power-on; offline bounce = live render; V8/JSC/iPad gates; iPad CPU with 3 instruments matches the device factor within 25 %.
- **Tests**: `engine-track.test.mjs` (sum, power, zones and note-off routing, sequencer pause, controller state while off, salts, MIDI OUT into a multi-instrument track, co-resident sequencer bound), `cv-graph.test.mjs` (validation, order, caps, own-FX refusal), `midi.test.mjs` (learn and CC per Serum instance, program change to the primary), page-sim (tray drop → graph message; one undo step per drop).

### 2a: Performance modulators (UI and compile only, no DSP change)

- **Scope**: `cv-modlayer.js`; the **project Mod Wheel** (pinned, §7.10) with the live-wheel broadcast rule; Velocity, Aftertouch, Bend modules (per-track singletons); cables to Serum knobs and a Serum's own FX knobs stored in `track.mods` and **injected at compile time** (§7.7); preset rows shown as "saved with preset", the "Save with preset" switch; cable inspector; Mod list sheet with the 64-row budget; mods visibility (§2.9); drop on top bar → parameter list. Classic and shared-panel targets show "from stage 2b".
- **User sees**: one Mod Wheel module, shown on every track, cabled to Serum knobs on several tracks; velocity cables.
- **Acceptance**: no cables → bytes and goldens unchanged; a canvas wheel cable renders identically to the same row written by Serum's own WHEEL tile; a preset load keeps every canvas cable; the live wheel reaches a cabled, unselected, unarmed track and is recorded only into armed targets.
- **Tests**: `cv-modlayer` page-sim (mod drop writes the same compiled row Serum's own drag writes), `cv-graph.test.mjs` (injection, row budget, preset reload), `main-sim` (wheel broadcast set, recording targets).

### 2b: Modulation everywhere (completes milestone 2)

- **Scope**: ModCore spike, then `mod-core.js` with the pseudo-voice; LFO (GLOBAL default, PER NOTE), ENV, Macro, CC, Chaos modules; `ext1…ext16` sources behind a `use` bit; per-note injection into Serum slots; automatic linking of a Serum's own LFOs/ENVs (§7.7); classic tier 1 (slot offsets with exact restore), `apply` and `proc` span setters, transfer tables; classic halos and long-press mod menu (§7.11); `setMods` on any panel; "most recent note" for per-note sources on non-Serum knobs; warm-up of the new paths.
- **User sees**: drag an LFO anywhere and apply it to any knob on any synth (every Serum knob, every FX knob, 237 classic knobs), in sync; envelopes and velocity on all of them (dashed where they follow the most recent note); one Mod Wheel tied to knobs on every instrument.
- **Acceptance**: neutral path (no cables) bit-identical; **ext cross-check bit-identical** (§7.7); classic slot oracle ≤ 1e-9, noise-from-zero, fade-out-keeps-modulation cases (§7.8); ModCore phases identical across two Tracks for the same frames; V8/JSC/iPad gates; new bench rows within budget.
- **Tests**: `modcore.test.mjs` (incl. pseudo-voice gates and legato), `cv-mods.test.mjs` (transfer tables exact for linear `sm` knobs, bounded error elsewhere; §7.5 table), golden subsets with an empty ModCore.

### 3: Serum taken apart (completes milestone 3)

- **Scope**: `sx-host.js:SerumHost`, `sx-ui-mod.js` extracted panels (with `destroy()`); parts view with VOICE, S1 FX and part modules; derived editable internal cables under the jack rules; join / new group / move (including by cabling into another Serum) / remove parts; Serum parts in the Sources tray; ARP/CLIP modules; cards for parts; bundled view kept.
- **User sees**: OSC, SUB, NOISE, FILTER dragged separately onto the canvas and cabled; envelopes and LFOs as their own modules.
- **Acceptance**: Serum goldens untouched (no DSP change); parts ↔ bundled round-trip leaves `vals.s` byte-identical; jack-rule refusals and automatic moves for every case in §8.3; injection never mutates `vals.s`; iPad DOM/memory check with 3 Serums in parts view within §9.3.
- **Tests**: ported `serum-ui*` and `sx-ui-*` tests on `SerumHost`; `jackrules.test.mjs` (every cable ↔ state field mapping, both directions; move-on-cable); injection tests (slot choice, exhaustion fallback to "most recent note", row budget).

### 4: Full patching (later)

- **Scope**: panel → panel chains, fan-out with per-cable level, latency alignment, "Insert FX panel here", split/merge panels by dragging effects.
- **Acceptance**: impulse test shows no comb filtering on parallel paths with different latency; re-patching keeps tails; canonical shapes still produce main's stream.
- **Tests**: `cv-graph.test.mjs` (alignment maths, cycle refusal), `engine-track.test.mjs` (fan-out copies, alignment), `golden-fx` unchanged.

### 5: Per-voice classic modulation (later, gated)

- **Scope**: velocity first (per-voice constant offsets `AVoice.mo`), then ENV and PER NOTE LFO through a per-voice evaluator (extracted from `sx-mod`'s `envTick`/`lfoAdv`, or a small new ADSR+LFO), then the 179 `chunk`-class controls, oscillator on/off switches, DX7 per-operator offsets; dashed classic cables become solid.
- **Acceptance**: `golden-classic` bit-identical with no rows; V8/JSC/iPad gates (§9.2); `v8-guard` clean on `AVoice.render`.
- **Tests**: per-voice offset tests per engine kind; bench rows with 8 voices × 8 cables.

### 6: Scale and polish (ongoing)

Alignment guides polish, canvas/rack presets (devices + cables + layout, with id remapping like `applyRackPreset`), LRU of mounted canvases if measurements allow, portrait refinements, accessibility pass (keyboard move, cable list navigation), momentum tuning, note tools for classic synths, per-instrument span grids if ever needed (§6.3), unified knob undo if the user asks for it.

---

## 11. Testing strategy

Rule from the Serum work: **never run the full suite**. One targeted file at a time with `node --max-old-space-size=2048 tests/<file>`.

### 11.1 Gate set (every stage)

- `golden-classic`, `golden-fx`: bit-identical against frozen `tests/ref-p1` (SHA-pinned).
- `golden-presets`, `golden-random`: ≤ 1e-6. `project-p1.json`: loads, plays, saves, reloads.
- `noAlloc`, the GC check in `bench.test.mjs`, `v8-guard`, `cpu-gate.mjs` calibrated gates; the JSC and iPad gates at engine stages (§9.2).
- `lint.test.mjs`: `?v=` rule; every new file in `sw.js:ASSETS` (`tools/precache.mjs --write`).

### 11.2 New suites

| Suite | Proves |
|---|---|
| `cv-migrate.test.mjs` | v1 → v2 → v1 round-trips; FX instance ids and `fx.*` destinations preserved; id remapping on duplicate/paste; undo of a delete restores the sound; schema gate and read-only open; file mirror; `adopt` after every load and History step |
| `cv-graph.test.mjs` | canonical compile matches `patchFor` for every factory preset and `project-p1`; validation (own-FX refusal, caps), topological order, latency alignment; injection of `track.mods` rows (never mutates `vals.s`, survives preset reload) |
| `canonical-stream.test.mjs` | the full message stream posted for a scripted `main-sim` session equals main's recorded stream (§5.5) |
| `golden-graph.test.mjs` | every factory preset (classic, Serum, FX) rendered through `{t:'graph'}` + `{t:'patch', i}` + `{t:'chain'}` equals the legacy `{t:'patch', p}` render **bit for bit**, including "note → 3 s silence → note" (idle skip) and an OS change mid-note. Fast subset by default, everything with `GOLDEN_FULL=1` |
| `engine-track.test.mjs` | facade fields; two sequencer-free Insts into one chain = copy(A)+B before the limiter; the co-resident sequencer bound; power fade click-free and cheap; sequencer paused when off; controller state while off; salts; zones and note-off routing; MIDI OUT into a multi-instrument track; Solina render-order documentation |
| `modcore.test.mjs` | ext row vs in-instance MONO LFO bit-identical; ModCore phases equal across two Tracks; pseudo-voice gates, legato and release; empty ModCore leaves golden subsets untouched |
| `cv-mods.test.mjs` | descriptors; class table (defaults + factory presets); transfer tables exact for linear `sm` knobs (all 425 controls swept); classic slot oracle ≤ 1e-9; noise-from-zero; fade keeps modulation; §7.5 table |
| `jackrules.test.mjs` | every Serum cable ↔ state field mapping both ways; refusal reasons; move-on-cable |
| `cv-world.test.mjs` | camera maths (zoom about a point is invariant), `localPoint`, culling with unmount/remount and slicing, pinch-defer at k = 0.5, card threshold, hit-area counter-scaling, camera key by project uid |

### 11.3 Page simulations and gestures

- `tests/main-sim.mjs` updated for the shell, keeping `__synthTest.api` (`kb()`, `roll()`, `arr()`, `addTrack`, `selectTrack`) and adding `canvas()`, `dropModule()`, `connect()`, `cable()`, plus a message-stream recorder (§5.5).
- `canvas-sim.test.mjs`: tray drop creates a module or track; a top-bar drag moves the module and records one undo step; a cable drag produces the right message; the camera never enters History; drags re-project while the camera edge-pans.
- `gesture.test.mjs` adds:
  - second finger rolls back a knob and a module drag, but **continues** a camera pan (no jump);
  - a late second finger during a moving pan is taken by the canvas and becomes a pinch (no knob press);
  - pinch engages only after 6 px; hooks returning `false` fall through to tray scrollers;
  - **editor zones inside modules**: a pinch starting on a `graph.js` editor, the `sx-ui-osc.js` sample display, the `sx-ui-seq.js` clip editor or a `wk.pianoKeys` inside a module not in edit state moves the camera; the same pinch inside a module in edit state reaches the editor (`own`) or plays a chord (`music`);
  - with `visualViewport.scale > 1` every hook returns `false` and the viewport carries `[data-cv-native]`;
  - `gesture*` ignored while touches are down; the momentum guard (viewport capture) consumes the stopping touch and `installGestures` still pairs it.
- `wk-dom` tests: tray drag-out (quick vs scroll vs hold), top-bar move with snapping, cable creation/snapping/refusal, mod drop onto a classic knob, drop onto a top bar opens the parameter list.

### 11.4 iPad checklist (iPad Pro, installed PWA and a Safari tab, Web Inspector)

1. One finger pans from empty canvas and from module backgrounds; two fingers starting on a knob never change it; a pan turns into a pinch without jumping; a second finger landing late during a pan never presses a knob; pinch keeps the point under the fingers fixed; a touch during momentum only stops the glide.
2. Pinch over the trays gives native page zoom; after zooming in until only canvas and keys are visible, pinching out and panning still work (hand-over); grips drag; keyboard chords never become pans.
3. A two-finger pinch on an LFO graph, sample display or clip editor moves the camera unless the module is in edit state; in edit state it zooms the editor.
4. Tile drag: the tray closes, the outline is true-size, edge-pan works in all four directions and the dragged item stays under the finger; side trays open by tap and never by an edge swipe.
5. After a zoom ends, text, cables and canvases are sharp at k = 2; LFO/filter editors hit correctly at k = 0.6 and 1.4; mod cables visibly land on their knobs.
6. Popovers and WT/LFO editors open as sheets; nothing is stranded after a pan.
7. Typed entry near the bottom isn't hidden by the software keyboard; the camera reveals the focused control.
8. 60 fps while panning with 3 instruments (one a full Serum); memory stable after switching tracks 20 times and after zooming out and in 20 times (canvases released).
9. Audio: the five-run bench at engine stages; 30-minute playback soak without crackles at total ≈ 0.6; CPU chips agree with the bench; Bluetooth MIDI and the keyboard tray behave as on main; the first note after launch on each new path doesn't crackle (warm-up).
10. Rotation (landscape/portrait) and Stage Manager resizing.
11. An older installed build opening a newer autosave shows read-only and does not overwrite it.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Engine split touches the hottest code** (`renderSpan`/`renderSerum`/`outStage`, ≈ 1,100 lines moved) | Verbatim-move rule; voices untouched; one monomorphic `Inst` on every path; facade; `golden-graph` + goldens + V8/JSC/iPad gates + `v8-guard`; lands alone in 1d with nothing depending on it; mixin host fallback (§6.11) |
| 2 | **iPad CPU with stacked instruments**; no iPad numbers yet; JSC behaves differently from V8 | 1a bench gate; JSC gates; warm-up coverage; per-module CPU; tile estimates; per-instrument safeguard; soft caps |
| 3 | **iPad DOM and memory** with several Serums and many canvases | unmount culling and released canvases (not `content-visibility`); mounted-body budget; DOM/memory measured in 1c before stacking; visible-only painting and monitors; 4 MB Serum undo cap; only the selected track mounted |
| 4 | **Two-finger arbitration** on a canvas full of `touch-action: none` controls and editor zones | extend the tested `gesture.js` (no second gesture system); editor-zone rule; pan continuation; late-finger upgrade; momentum guard after `installGestures` |
| 5 | **The user stuck in native zoom** | hand-over while `visualViewport.scale > 1` (§4.3); iPad checklist item 2 |
| 6 | **Silent zoom mis-mapping** in editors (`graph.js`, `fx-ui` displays, `wtedit`) | `wk.localPoint` in 1b, tests at k ≠ 1, iPad item 5 |
| 7 | **Expectation gap on "fully modular" Serum** (4+ oscillators, OSC into another Serum's filter) | jack rules with reasons; automatic moves and new Serums; §13 Q3. A later route-bitmask generalisation behind a `use` bit is possible if needed |
| 8 | **64-row cap per Serum** shared with canvas rows; 10 LFO / ENV 2–4 slots for injection | budget on VOICE and in the Mod list; refusal with counts; "most recent note" fallback when slots run out |
| 9 | **Classic modulation exactness and cost**: tier 1 analog-only plus level; transfer tables first-order for interacting knobs; tier-1 cables cost per-chunk `setRes`; per-voice behaviour only in stage 5 | tiers labelled in the UI and in §13; oracle tests; cost budgeted (§9.2); stage 5 gated |
| 10 | **Undo split** across project History and Serum panel undo | undo button follows focus and names the action; §13 Q7 |
| 11 | **Page model change** (scrolling document → fixed shell) breaks `scrollIntoView`, `data-wk-inset`, `asBand` assumptions and test DOM ids | move elements, keep ids; `main-sim` rewrite in 1b; `asBand` left/right; `wk.edgePan2` |
| 12 | **Data across builds and origins**: newer autosave vs older installed app; v2 files on main; libraries left behind | schema number and read-only open from 1a; file mirror; Import library; §13 Q6 |
| 13 | **Live wheel on extra tracks** surprises (their built-in wheel routes respond) | only tracks with a Mod Wheel cable are added; documented in §7.10; the module lists every cabled track |

---

## 13. Questions for the user

Only decisions that are genuinely the user's. Each has a recommended default that the plan uses until answered. (Already decided, so not asked again: one Mod Wheel per project; modulation before taking Serum apart; the three milestones.)

1. **Pinch on the canvas.** Recommended: **a pinch on the canvas zooms the canvas** (so you can zoom out to see everything; native zoom can't go below 100 %), while a pinch over the trays keeps the normal iPad page zoom, and whenever the page is zoomed in the canvas hands every gesture back so you can always pinch out again. Or: keep the normal page zoom everywhere, and zoom the canvas only with the `⊖ ⊕` buttons and double-tap. Either is one switch in `⚙`.
2. **FX granularity.** Recommended: an **FX panel** is a pedalboard holding several effects in order, and cables connect instruments and panels. Or should every single effect be its own module with cables between them (more cables, more freedom)?
3. **Serum limits.** Is it OK that one Serum holds at most 3 oscillators, 1 sub, 1 noise and 2 filters, that its oscillators feed only its own filters (cabling one into another Serum's filter moves it there), and that dropping a 4th oscillator starts "Serum 2" (which can share FX and modulators)? The alternative, fully independent oscillator modules, means a new synth engine.
4. **When each kind of knob becomes modulatable.** Is this order OK?
   - Milestone 2 (stage 2a): Mod Wheel, Velocity, Aftertouch, Bend on every Serum knob and a Serum's own effects.
   - Milestone 2 (stage 2b): every modulator on every Serum knob, every effect knob, and 237 of the 425 classic-synth controls (filters, levels, tuning, pulse width, envelope times, LFO rates, glide…). On classic synths and effects, envelopes, per-note LFOs and velocity follow the most recent note (dashed cable).
   - Stage 5 (later): the other 179 classic controls, and true per-note envelopes/LFOs/velocity on classic synths.
   - Never: 7 structural switches (unison and assign modes, filter slope, DX7 algorithm, two HPF cutoffs that switch the filter type).
5. **Showing modulation cables.** Recommended: **Always** (you asked to see what affects what), fading the ones not touching your selection when there are more than 24 on screen. Or "only for the selected module" (tidier), or "never" (Mod list only).
6. **Your saved sounds on the new site.** canvas.domlavin.com starts empty: your saved classic presets, Serum presets, FX chains, shapes, wavetables, samples and settings stay on synth.domlavin.com. Songs move by Save there / Open here. For the rest: **(a)** add one small "Export library" item to the live site (the only change to main; it just writes a file), then "Import library" on the canvas site; or **(b)** start fresh on the canvas site and re-save what you need. Recommended: (a), as one small separate commit, only if you say yes.
7. **Undo for knob moves.** Today knob tweaks are not undoable (except inside Serum). Should knob moves on the canvas become undoable along with moves and cables?
8. **Mouse/trackpad on the Mac.** Recommended: dragging empty canvas pans (same as touch) and Shift-drag draws a selection box. Or should drag select and middle-drag/scroll pan?

And one request (not a decision): please run `tests/bench.html` five times on the iPad Pro when stage 1a lands, and again at stages 1d, 1e, 2b and 5, so the audio budgets use real numbers.

---

## Appendix A. Files

All under `/Users/dom/Documents/Claude - Synth Synth/`.

**New (main thread, ES modules)**: `cv-tray.js` (trayGrip, budget, side trays), `cv-world.js` (camera, grid, culling and mounting, cards, toolbar, minimap, native-zoom hand-over), `cv-module.js` (chrome, top bar, jacks, edit state), `cv-cables.js` (SVG layers, ports, cable editing), `cv-modlayer.js` (canvas-wide modulation drops), `cv-art.js` (illustrations), `cv-model.js` (`adopt`, `instOf`, primary), `cv-migrate.js` (`toV2`/`toV1`, `SCHEMA`, file mirror), `cv-graph.js` (validation, canonical compile, graph compile, row injection), `cv-mods.js` (descriptors, class table, transfer tables), `classic-panel.js` (`ClassicPanel`, classic halos), `sx-host.js` (`SerumHost`), `sx-ui-mod.js` (extracted Serum mod panels).

**New (worklet, classic script)**: `mod-core.js` (ModCore glue around a voice-less `SxMod` and the pseudo-voice, Track row evaluator).

**New tests**: listed in §11.2–11.3; fixture `tests/fixtures/stream-main.bin`.

**Changed**: `engine.js` (`Track`/`Inst`/`Chain`, facade, warm-up, salts, tier-1 adapter, ModCore hookup), `serum-dsp.js` and `sx-mod.js` (seed salt sites; `sx-mod.js` `NSRC`, ext rows), `serum-core.js` (`SOURCES` ext append, `use` bit, `compileSerum` extra rows and injection), `gesture.js` (hooks, pinch in nav sessions, editor-zone rule), `wk.js` (`localPoint`, `closeTransient`, `setWheelVeto`, `rescaleCanvases`, `releaseCanvases`, `edgePan2`, `asBand` left/right), `graph.js`, `fx-ui.js`, `wtedit.js`, `sx-ui-osc.js` (localPoint sites), `serum-ui.js` (kit layer, multi-instance, then `SerumHost`), `midi.js` (per-instrument learn and CC), `main.js` (shell, per-instrument maps, monitors, `lowerOS`, `renderOffline`, wheel routing, `renderLast`, platform message), `song.js` (whitelist, History restore rule), `appstore.js` (`DB_NAME`), `pwa.js` (read-only reload prompt, minimum version), `index.html`, `style.css`, `sw.js`, `tests/main-sim.mjs`, `tests/keyboard.test.mjs`, `tests/gesture.test.mjs`, `tests/bench.test.mjs`.

## Appendix B. Where each decision came from

| Decision | Source |
|---|---|
| Four trays (Sources left, Effects right), auto-patch on drop, tray closes during drag, "not connected" badge, 40 world-px top bar on every device, hydration over frames, CPU estimates on tiles and "Measure this device", canonical compile, `toV1` regret path, Serum slot injection without mutating `s`, PER NOTE / GLOBAL badges, Mod list with row budget, Serum recommendation wording | ux-first (winner) |
| UI-only shell stage that wraps today's panels without de-globalising; panels-as-instances before engine work; iPad bench as a gate before the first engine stage; drop a jack on a top bar → parameter list; pan only on known background classes; double-tap bar → 100 %; shared `budget()`; cards and culling in the shell stage; scope into OUT, About into `⋯`; per-device rule in `applyRestore`; one LFO module type with compiler-decided placement; explicit `nomod` list; soft caps; bundled/parts views | mvp-first via judges 1, 2, 3 |
| Monomorphic `Inst` with a kind switch; in-place aliasing; Track-level idle skip only when everything is idle; ModCore as a voice-less SxMod on a base-rate shim; post-`smStep` slot injection; `golden-graph` test; ext vs MONO bit-identical cross-check; classic oracle test; key zones and transpose; `{t:'mon', ids}`; GLOBAL / PER NOTE switch; CC source module; 64 MB per-track FX cap; `translate3d` during drags; Pencil hover labels | engine-first via judges 1, 2, 3 |
| Chip tap selects and centres (power via long-press); counter-scaled jack/bar hit areas; momentum guard; portrait auto-collapse | judge 2 fixes |
| Analog-only caveat for classic tier 1; idle skip bypasses `outStage` (verified in `engine.js:renderSpan`); mixin host bimorphism and idle-skip pitfalls (why it is only the fallback) | judges 1 and 3, verified against the code |
| No separate IN module (notes are implicit; key zones live on a pill) | synthesis: judge 1 found IN modules cluttered, judge 2 wanted visible note flow; the pill and the ARP/CLIP note cables give both |
| Project-wide pinned Mod Wheel; stages mapped to the user's three milestones; native-zoom hand-over; editor-zone rule; private Serum FX; ENV and per-note LFO on every knob via the pseudo-voice; automatic linking; `track.mods` injection instead of `s.matrix` writes; tier-1 restore mechanism; unmount culling; schema gate and file mirror; per-instrument MIDI; salts; JSC and iPad gate method; "Always" mod-cable default | review (revision 2), see the Review log |

---

## Review log

Revision 2 answers a review of revision 1. Every point was checked against the code (cited as `file:symbol`); accepted points are folded into the sections listed, rejected or partly rejected points have a one-line reason.

| # | Point | Outcome |
|---|---|---|
| — | `SUMMARY.md` missing; `docs/canvas/` untracked | Accepted: a plain-language [SUMMARY.md](SUMMARY.md) is drafted alongside this revision. Committing `docs/canvas/` to the `canvas` branch is left to the user (no commit without being asked) |
| 1 | Mod Wheel was per track, against the recorded "one per project" | Accepted: D9, §2.10, §2.12, §5.1, §7.10 (live reach, recording, playback defined); the old Q1 (one world per track) removed |
| 2 | Milestones didn't match the agreed three; Q1/Q4 already answered | Accepted: §10 stages 1a–1e / 2a–2b / 3 with what each build shows; performance modulators moved after multi-synth; the old Q1 and Q4 dropped, new questions added |
| 3 | Canvas blocks native pinch; zoom trap | Accepted: §4.3 hand-over while `visualViewport.scale > 1`, the user's choice as Q1, native-pinch map |
| 4 | Editor zones (`zoomPan` `own`, `pianoKeys` `music`) grab two fingers inside modules | Accepted: §4.2 item 6 edit-state rule, `gesture.test` cases in §11.3 |
| 5 | A Serum's FX rack carries its master/Bypass/Direct/bus levels; sharing it is undefined | Accepted: D7, §2.8, §6.5 private own FX, its output cables into shared panels; goldens unaffected |
| 6 | "Any knob" and ENV only partly delivered; refusals | Accepted: `apply`/`proc` in 2b; pseudo-voice "most recent note" for every non-Serum target (§7.6); refusals removed (§7.5); automatic linking (§7.7); plain timetable in Q4. Partly rejected: "17 `none` never" — rerunning the classifier over defaults plus every factory preset leaves 2 `none` (Minimoog `mm`, Jupiter-8 `pws`); the others act once another control is set, so they are classed normally (§7.2, §7.8) |
| 7 | Tier-1 holes (`needNoise`, `fadeOut`, off oscillator); hot-loop and cost claims | Accepted the holes and the cost (§7.8, §9.2). Rejected "fixing them must edit the voice hot loop": modulating `smB` too, restoring it by copy at span end and one guarded line after `fadeOut`'s `smA.set(smB)` close all three with `AVoice`/`FVoice` untouched; off-oscillator levels are excluded |
| 8 | `content-visibility` frees neither canvases nor nodes; 3 Serums exceed 9k | Accepted: §2.11 unmount culling, released canvases, sliced remount, pinch-defer, mounted-body budget with cards |
| 9 | Gesture hand-offs | Accepted: §4.2 items 3–4 (pan continues, late finger upgrade), §4.6 re-projection, §4.1 momentum guard placement |
| 10 | User libraries don't cross origins | Accepted: §5.6 inventory, Import library, Q6 |
| 11 | Schema growth vs stale installed apps; v2 files on main become Minimoog | Accepted: §5.8 schema number with read-only open from 1a; file mirror of the primary instrument |
| 12 | Accessors lost after undo; "first powered synth" primary unstable | Accepted: §5.4 single `adopt` point with a test; explicit stable `track.prim` |
| 13 | Track-module cables in `s.matrix` get wiped by preset loads | Accepted: D11, §5.2, §7.7 `track.mods` + compile-time injection; preset rows shown as "saved with preset" |
| 14 | MIDI learn, program change, render-last assume one Serum | Accepted: §6.9 per instrument |
| 15 | copy(A)+B fails beside a sequencer | Accepted: test restricted to sequencer-free sources, co-resident difference documented and bounded (§6.3, §10 1e) |
| 16 | V8-only gates; 3 % iPad gate below noise; warm-up | Accepted: §9.1–9.2 JSC gates, five-run iPad method, warm-up coverage |
| 17 | Cable rendering: hidden ends, "On select" default, `non-scaling-stroke` | Accepted: §2.9 cable ends above modules, "Always" default with clutter fade and Q5, strokes from `--ik` (WebKit check in 1b) |
| 18 | Side trays vs system edge gestures | Accepted: §2.4 open by tap, grips ≥ 24 px (`EDGE_PX`) from the edge |
| 19 | 2-D edge-pan has no API | Partly rejected: `dragSource.edge` does exist (`wk.js`: `dragSource.edge = asEdge`, the 1-D speed law). What is missing is a 2-D camera driver (today's auto-scroll is vertical and DOM-only), so `wk.edgePan2` is added (§4.6) |
| 20 | 1b diff glob `sx-*.js` includes `sx-ui-osc.js` | Accepted: §10 1b lists the DSP and compile files explicitly against the merge base |
| 21 | Canonical proof checked `patchFor`, not the posted stream | Accepted: §5.5 `canonical-stream.test.mjs` compares the whole recorded `main-sim` message stream |
| 22 | Classic halos need new code | Accepted: §7.11 halos in `classic-panel.js` |
| 23 | Arrangement toolbar unplaced; ARP/CLIP without Serum; tray LFO default | Accepted: §2.2 toolbar row, §2.13 / §8.5 ARP/CLIP, §2.4 GLOBAL default. Note: `Bars` (`#tBars`) is in today's transport, not the arrangement toolbar; it moves to the toolbar row anyway |
| 24 | Lockstep seeds; controller state while off; powered-off 303 | Accepted: §6.2.1 salts (Serum seeds too), §6.6 |
| 25 | Browser minimums; camera key collides across projects | Accepted: §9.4 iPadOS/Safari 16.4+, §4.4 key by project uid |
| 26 | Auto-move OSC into another Serum; keep press-and-hold menu | Accepted: §8.3, §8.5, §2.6, §7.11 |
| 27 | Documents | Accepted: SUMMARY.md; §13 rewritten |
