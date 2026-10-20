# Stage 3: Serum taken apart (IMPL-3) — contract

What milestone 3 builds, in which order, and the rules. Design: [SPEC-canvas.md](SPEC-canvas.md) §0 D10 / D11 / D12, §2.5–2.10,
§5.1–5.8, §8 (Serum on the canvas), §9.3, §10 3; [ROADMAP.md](ROADMAP.md) wins where they differ (the 1f withdrawal of several synths
per track, the three rendering rules of 2026-10-19, "they all should [look like Serum's] where possible", the filter S A B C N inputs
as plain switches, the standing preferences). What exists: [IMPL-1e.md](IMPL-1e.md) (graph engine, per-device host; §8.3 left-overs,
§8.5 1f / 1g), [IMPL-1h.md](IMPL-1h.md) (GL grid + faces), [IMPL-2a.md](IMPL-2a.md) (rows, injection; §8.1 the accessors stay),
[IMPL-2b.md](IMPL-2b.md) (ModCore, the modulator modules; §6, §9). Inputs: three maps in the lead's scratchpad `m3/`, cited as
**RM** (`map-rendering.md`), **XM** (`map-serum-extraction.md`), **AM** (`map-accessors-graph.md`). Sections 1–5 are the contract
(§1 first: it gates the rest), §6 the lanes, §7 the gates, §8 the questions for the user, §9 the builders' notes, §10 the review log.
**Revision 2** (2026-10-19): the contract review's 25 points folded in (§10 lists each one and where it went).

**Invariants of the stage**
- **N1 Sound**: no DSP change. The one worklet change is two monitor fields (§2.9), written and posted only while subscribed. Every
  golden shard, `golden-graph`, `canonical-stream` (fixture untouched), the cp2 / ct2 and 2b fixtures stay bit-identical.
- **N2 One state**: bundled and parts views are views of one `vals.s` + `fx`. Switching either way, any number of times, leaves both
  byte-identical (JSON); parts add only `lay` entries.
- **N3 Modulators keep their data**: the canvas LFO / ENV / Macro / Chaos records keep their 2b shapes; a module's compiled
  `{t:'mods'}` payload is the same before and after its body becomes Serum's panel.
- **N4 No rendering regression**: the grid and hardware faces keep 1h's G1–G3, on hardware tracks with the Serum-faithful modulators too
  (no modulator overlaps an instrument, so no face drops out of GL: §2.2); every display canvas ≥ 1:1 at rest within a 64 MB total (H5).
- **N5 Accessor-free**: at the end no code reads `t.model / vals / preset / seq / fx` on a track — proven by the dynamic accessor hook
  (AM §0: zero sites over every sim), by production `adopt` installing nothing (`'model' in t === false`) and by the static ratchet
  standing at its allowlist of kept sites (§4.3), not at zero.

## 1. Rendering many modules (answered first)

### 1.1 The question, measurable (RM §1)

| rule | measurable form |
|---|---|
| R1 "the resolution only renders in when i let go" | a module's pixels mid-gesture equal its pixels at rest for the same camera |
| R2 "the dot grid … should be precise" | every dot centre within 0.5 device px every frame (1h G3: done) |
| R3 "never … below 1:1" | texel / backing-store px per on-screen device px ≥ 1.0 for every pixel source |
| Z1 "modules render identically at every zoom" | no cards, LOD, unmount or swap in or near view |
| L the 1f lag ("lags mostly when pinch zooming") + hotfix 2 ("a noticeable hitch … past around 60 %") | touch-driven pinch 25–200 % and pans at 60 Hz with no burst frame > 33 ms (§1.5 P+) |

### 1.2 Facts that decide it

- The GPU draws the grid (shader) and the 12 hardware faces (textures). **Everything else is DOM**, including today's bundled Serum:
  ≈ 3.7k elements and 29 canvases on its OSC page, 12.5k and 63 canvases (17.3 MB of stores) once every page was visited (XM §0.4).
- **A Serum in parts view is not more DOM than the bundled one**: "Serum (complete)" (VOICE core, OSC A, FILTER 1, own FX) ≈ 1.4k
  elements / 10 canvases; a fully opened Serum ≈ 4.9k (≈ 3.5k with lazy OSC type views, H1) (XM §9.3). The DOM multiplies only with
  several Serums per track and with the Serum-faithful modulators (2–3× today's bodies: LFO 145 el + 6 canvases (2 with H3), ENV 145
  + 2, MACROS 129) — and those go on **every** track, hardware ones included, where 1h's faces are.
- On WebKit every DOM option is compositor-scaled mid-pinch and re-rastered at rest (R1 ✗; R3 ✗ while zooming in). WebKit has no
  DOM → texture path. Only a module painted on the GPU by our own painter, with its DOM kept invisible for hits / focus / accessibility
  (RM option b), meets R1 / R3 for text and knobs: XL, high risk (text parity, a second renderer of the whole Serum kit) (RM §3).
- The bar the user accepted: the 1h verdict ("pinch zoom feels great. no hitching") with `hw5` at single 50–80 ms frames at a pan's
  first move / settle (one per phase), the rest 17 ms, no frame > 33 ms in the one-panel sets (ROADMAP 2026-10-19, after 1h); the
  user rejected a single mid-zoom hitch past 60 % (hotfix 2), where monitor wake-ups were part of the cost. ≈ 2.8k hardware DOM
  controls still re-raster at rest; the bundled Serum (DOM) has been on the canvas since 1b without a rendering complaint. **Nothing
  Serum-shaped was ever measured on the iPad** (touch path, closer zooms).
- Display canvases are below 1:1 above 100 % in three places (an R3 violation at rest, cheap to fix): `wk.fitCanvas`, serum-ui
  `paintCanvas` (`min(2, dpr)`, clamp 0.5…2: 0.67 at k 1.5, 0.50 at 2, measured) and sx-ui-seq `storeDpr` (CLIP's 15 canvases).
- The modulator column sits at x −(W_MOD + MOD_GAP) = −320 (cv-module 47 / 63–65; tap placement main 5349, the drop ghost 5395): a
  Serum-faithful LFO (≈ 393 px panel) there would reach x +96 into the instrument, and any overlap drops a hardware face out of GL
  (cv-face `recheck`, 435–455) — R1 / R3 again.

### 1.3 Decision

- **D-R1 — Milestone 3 renders Serum parts and the Serum-faithful modulators in the DOM**, with the same kit widgets the bundled
  Serum uses, under the hygiene rules H1–H7 and the measured budgets of §1.4 (they replace SPEC §9.3's "9k mounted, the rest
  cards", void since Z1). **Provisional on Q1**: the user answers Q1 in the S0 session, after pinching `p1x` (M1) and seeing its rest
  screenshots (M3); Q1 is an input to §1.5's table. The DOM is needed whatever the answer (option b keeps it as the hit layer), so
  phase 1 starts on S0's numbers and no lane's work is lost.
- **D-R2 — Displays are ≥ 1:1 at rest** (H5), like the DOM text around them: soft while the fingers move, exact at rest. No
  displays-to-GL step (RM a2) here: a GL display under an opaque Serum panel needs holes cut through every ancestor background
  (that is option b's work), and a crisp display beside re-rastering text is not more consistent.
- **D-R3 — The GPU module painter (option b) is not built in milestone 3.** It becomes its own stage **3R** (own contract; RM
  §6.4–6.5 probes P1–P3 and spikes S-B1–3 first). 3R is **decided (contracted and scheduled) before phase 2** when Q1 is "no", or when
  S0 fails with the `opacity0` floor passing; it is put to the user when `ui-m3b` fails P after the deploy (§7).
- **D-R4 — Several instruments per track stay withdrawn** unless S0's t2 / t3 pass P+ and the user says yes (§5).
- **D-R5 — The default view of a new Serum is a runtime pref**, `synth.cv.sxView` = `parts` | `bundled` (⚙ → "New Serums open as:
  Parts · Whole panel"); the shipped default is one constant, set from S0 (§1.5) and re-checked on the deployed build (`ui-m3b`): a
  P+ failure there flips the constant to `bundled` in the same deploy round (no code path changes; the user is told).
- Told to the user plainly (Q1): the grid and the hardware faces stay exact; Serum parts and modulators behave like today's Serum
  panel — compositor-scaled while the fingers move, crisp the moment they lift.

### 1.4 Hygiene and budgets (in the lanes; each measured)

- **H1** `OscPanel` builds only the active type view; the others on first switch, then kept (−421 el per OSC, bundled too).
- **H2** Parts view mounts no MIX / MATRIX / GLOBAL / FX page, no tile strip, no `rowC` duplicate, no UNISON A/B/C panels (the
  oscillator's gear popover owns unison).
- **H3** Part and slot-host LFO panels do not build the VELO / NOTE curve area (that is VOICE's `CurvePanel`); every LFO panel
  (bundled too) builds its PATH editor (`gx.PathEditor`, serum-ui 4135) on the first `type = path`, then keeps it: 2 canvases, not 6.
- **H4** One `SerumHost` per Serum (and per slot host): one paint loop over **shown** views only (mounted and on screen per the
  world's on-screen plan); the snapshot subscription is live while any view is shown; halos per shown view.
- **H5** Canvas density: one rule, `wk.storeDensity(el)` (wk.js), used by `wk.fitCanvas`, serum-ui `paintCanvas` and sx-ui-seq
  `storeDpr`. At rest an on-screen canvas stores `dpr·k` px per layout px (the cap of 2 lifted; `CANVAS_MAX_PX` 16e6 per canvas
  kept), changed at a rest only (never in a burst). **Total cap**: Σ every store, on and off screen, ≤ `CANVAS_BUDGET` = 64 MB (SPEC
  §9.3); over it, off-screen canvases drop to `dpr` first (invisible: Z1 holds), then on-screen ones farthest from the viewport
  centre. An off-screen canvas brought into view at k > 1 by a pan shows its `dpr` store until the next rest (1h's residual; M4
  counts it). `world.canvasStats()` → `{ n, bytes, minDensity, onMin, offN }`.
- **H6** The compositing policy S0 selects (none, or one of `contain` / `layers` / `skip` / `noWC`), in `style.css` under one rule. A
  variant is eligible only if it never shows a blank or late body when a pan or a zoom out brings a module into view (Z1).
- **H7** (conditional: only if S0's M1 or `hwm` shows burst frames from repaints, measured as M2's `still`) live-display repaints
  (snapshot-driven canvases, meters, the phase dot) pause during a camera burst and resume at its end: they are compositor-scaled
  anyway, and each repaint mid-burst is a texture upload.
- **Budgets** (§7 gates; S0 confirms them): Serum (complete) in parts ≤ 1.6k painted elements / ≤ 12 canvases; a fully opened Serum in
  parts (VOICE core, 3 OSC, SUB, NOISE, 2 FILTER, ENV 2, 2 LFO, MACROS, ARP, own FX with 4 effects) ≤ 5.0k / ≤ 40 canvases; **the
  worst factory preset in parts** (the most in-use slots by I2, found by a script over the bundled presets) inside the same lines, or
  its own measured line in §9; one Serum-faithful modulator ≤ 160 el, ≤ 2 canvases; Σ canvas stores of the selected track ≤ 64 MB.

### 1.5 S0: the iPad spike (before any lane builds on it)

**What to build** (one builder; a test page only, no app file: `tests/ui-bench.html` + new `tests/ui-bench-m3.mjs`, opened as
`ui-bench.html?m3=1`). Scenes are built by script inside the iframe app (test hooks on):
- **Panels**: real Serum panels mounted alone against a kit (`new SerumUI(box, host)` over a hand-made host as XM §1 does). ENV / LFO
  panels are built with `ui.bp = ui.headPage` (`bind` registers into `bp || headPage`, serum-ui 1959; `paint` walks `shownPages()` =
  head + page + foot, 2079): a throw-away page would be neither painted nor rescaled. Each panel sits in a `.cv-mod` shell (a cloned
  bar, the module CSS) at §2.2's sizes (the panel at its bundled column width), placed in `#world` like Tidy, the modulators in the
  left-growing column (§2.2).
- **H5 shim** (`h5=1`, default on): the page applies §1.4's H5 rule over today's density code (a test-page patch of the scale in
  `SerumUI.prototype.paintCanvas`, `wk.fitCanvas` and CLIP's `storeDpr`) so the settle cost at k > 1 is the one that ships; M4
  reports both.
- **Real traffic**: in every scene the app's transport plays a 2-bar loop on the scene's track (a chord through the ARP), so the
  worklet, `smon` and the monitors run as in use (hotfix 2: monitor wake-ups were part of the hitch). `sx1` is the app's own Serum
  with its own monitors; the hand-made hosts of `p1` / `p1x` / `t2` / `t3` get that Serum's real snapshot fanned out (no synthetic
  feed); the modulators the track's real ModCore `mc` (a canvas LFO, ENV and chaos module on the track, cabled). The scene states
  keep every display moving (LFO 1 → OSC A / B / C WT POS, ENV 2 → filter cutoffs).
- **Cables**: `sx1` with 8 canvas mod cables (2 LFOs, the Mod Wheel, a Macro onto Serum knobs); `p1` / `p1x` / `t2` with their
  internal cables (sources → filters → VOICE → own FX, a fork, a stub: ≈ 12 per Serum) and 8 mod cables, drawn by the real cv-cables
  layer from hand-made edges.
- **Self-check** (CDP harness and iPad): every live canvas of a scene repaints at ≥ 0.8 × the snapshot rate while idle; element and
  canvas counts against §1.4; no console error. A scene failing it makes the run invalid.

| id | content | decides |
|---|---|---|
| `hw5` | the 1h five hardware panels — run **first and last** | the run's validity, thermal drift |
| `sx1` | one bundled Serum (the app's own, OSC page) + cables, audio running | baseline |
| `p1` | Serum (complete) in parts: VOICE (voicing + ENV 1 + a header proxy), OSC A, FILTER 1, own FX (empty) | the parts default |
| `p1x` | a fully opened Serum in parts (the §1.4 budget line) + 6 Serum-faithful modulators (LFO ×2, ENV ×2, MACROS, a chaos row) + OUT | milestone 3 |
| `hwm` | `hw5`'s five panels + the same 6 Serum-faithful modulators in the left column (heavier than any one-instrument hardware track) | the modulators on hardware tracks |
| `t2` | two `p1x` Serums (without the 6 modulators) | §5 |
| `t3` | `p1` + OB-Xa + Jupiter-8 + CS-80 (GL faces) + an FX with four effects | §5 |

**Runs** (order: `hw5`, `sx1`, `p1`, `p1x`, `hwm`, `t2`, `t3`, `hw5`).
- **M0 scripted**: the existing phases (idle / pan / zoom / settle / deep / deepSettle) for every scene, GL on; per phase also
  `firstMove` (the max frame within 100 ms of `movestart`), `settle` (the max within 800 ms of `cameraend`) and `burstMax`.
- **M1 hand test** (`?hand=1`; a 45 s protocol shown on screen: 3 × pinch 100 → 25 → 100 % slow 1.5 s / medium 0.7 s / fast 0.3 s,
  2 × 100 → 200 → 100 %, 3 two-finger pans, 3 one-finger pans, one knob drag) on `hw5` (first and last), `sx1`, `p1x`, `hwm`, `t2`,
  `t3` (and `p1` when `p1x` fails), audio running: rAF intervals by phase (burst / firstMove / settle / rest), input-to-frame latency
  (capture-phase `pointermove` `timeStamp` → next rAF; median, p95), the k range reached, `visualViewport.scale` (must stay 1).
- **M2 policy matrix**, scripted, on `p1x`, `hwm` and `t2`: `base`, `contain` (`.cv-mod > .cv-body { contain: content }`), `layers`,
  `skip`, `noWC`, `permWC` (RM §6.3), `still` (H7: live repaints paused in bursts), **`opacity0`** (non-hardware bodies `opacity: 0`:
  the floor, option b's best case) and **`none`** (`display: none` bodies; with `opacity0` this is probe P4). If `base` fails M1 on
  `p1x` or `hwm`, the best M2 variant is hand-tested there.
- **M3 rest test** (`?hold=1`) on `p1x`, 1.0 → 0.5 and 1.0 → 1.5: **everything live frozen for the whole hold run** (transport
  stopped, the snapshot fan-out and ModCore feed paused, meters and the playhead still, `animation-play-state: paused` on `#world *`);
  as a fallback the page lists every live region's rect (display canvases, meters) in the screenshot's coordinates and B ↔ C masks
  them. The burst held open, three iPad screenshots (A in the burst, B 2 s after release, C 1 s later), diffed on the Mac (RM §6.3
  `restdiff`): per module the % of pixels changing by > 16/255. Not a gate for DOM: the lead shows the user A next to B (a part
  module, cropped) in the same session, and Q1 is answered then.
- **M4 density audit** at k ∈ {0.25, 0.5, 1, 1.5, 2} (canvases, faces): today's rule and the H5 shim; Σ stores on and off screen.
- **M5 memory / survival**: `glStats().bytes`, Σ canvas stores, element counts, a 60 s k-sweep with a `localStorage` heartbeat (a tab
  the OS killed is reported at the next load).
- **P1 / P2 probes** (buttons, not gates; they feed 3R and 1h's windows above 100 %): SVG `foreignObject` → canvas taint on iPadOS 26;
  `OffscreenCanvas` 2D + `FontFace` in a Worker (paint ms of 4 Mpx of text, `transferToImageBitmap` → `texImage2D`).
- **Output**: one JSON (`"stale": false`, the build, UA, dpr, viewport) → `tests/bench.json` `"ui-m3"` (the lead records it). The
  builder first runs everything in the headless-Chrome CDP harness on the Mac → `"ui-m3-mac"` (informational: Chrome cannot show
  WebKit's behaviour; it proves the page and its self-check work). The user's session: ≤ 30 minutes, the iPad plugged in, other apps
  closed.

**Pass criteria** (per scene, M1):
- **P** (enough for an opt-in feature only): bursts median ≤ 17.5 ms and p95 ≤ 25 ms; no burst frame > 50 ms; firstMove and settle
  ≤ 100 ms; input-to-frame p95 ≤ 40 ms; no tab loss (M5); Σ canvas stores ≤ 64 MB.
- **P+** (needed for anything on by default): bursts median ≤ 17.0 ms and p95 ≤ 20 ms; **no burst frame > 33 ms** (1h's bar; the
  hotfix-2 hitch was one such frame); firstMove and settle ≤ 80 ms with at most one frame > 33 ms per phase (the `hw5` envelope the
  user accepted); input-to-frame p95 ≤ 33 ms; no tab loss; Σ ≤ 64 MB.
- **A run counts** only when `hw5` lands inside its recorded envelope (median ≤ 17.5 ms, firstMove / settle ≤ 80 ms) both first and
  last, the last burst median within 1.0 ms of the first (no thermal drift), every scene passed its self-check, M3's B ↔ C is 0.00
  outside the masked live regions, the grid / faces regions are 0.00 A ↔ B (1h G1 still holds) and `visualViewport.scale` stayed 1.

**Decision table** (inputs: M1 per scene with `base` or one M2 variant, and Q1; the lead applies it; §9.0 and ROADMAP record it):

| S0 on the iPad + Q1 | decision |
|---|---|
| `p1x` P+, Q1 yes | D-R1 confirmed; phases 1 and 2; the variant (if any) becomes H6; D-R5's constant = Q2's answer (parts recommended) |
| `p1x` P (not P+), or `p1` P+ with `p1x` failing, Q1 yes | phases 1 and 2; parts opt-in (D-R5's constant `bundled`); on touch devices a notice when a track's painted elements pass the largest P+ scene's count ("this many modules may stutter when zooming", once, like the CPU soft caps); 3R offered |
| `p1` or `sx1` fails P, `opacity0` P | DOM paint is the cost: phase 1 with parts opt-in only; 3R decided before phase 2 (put to the user) |
| `opacity0` fails too | the cost is not DOM paint (layers, JS, GL): stop and profile on the device before any UI lane |
| Q1 no (whatever the numbers) | phase 1 starts (its DOM is 3R's hit layer); 3R decided and contracted before phase 2; phase 2 builds parts opt-in until 3R lands |
| `hwm` P+ | the Serum-faithful modulators as specified |
| `hwm` fails P+ | H7 and the best M2 variant, re-measured on `hwm` (CDP harness, then the user) before phase 2; still failing: the lead puts the numbers to the user. The modulators are rebuilt either way (the user's requirement) |
| `t2` and `t3` P+ | §5's step 3S may be offered to the user |
| after the deploy: `ui-m3b` fails P+ on `p1x-real` / `hwm-real` | D-R5's constant flips to `bundled` in the same deploy round; fails P: parts opt-in only and 3R put to the user |

**Fallback** (the whole milestone): its function ships whatever S0 says. The bundled view stays a permanent, first-class view (SPEC
§8.1) and parts are the user's choice per Serum; S0 and Q1 decide the default, whether several instruments may return, and whether
3R is next. **Order**: S0 runs in phase 0 beside lane A (the accessor retirement does not build on rendering); phase 1 waits for the
user's S0 run, phase 2 for Q1 (and, on "no", for the 3R decision).

## 2. The modules

### 2.1 Keys and views

- Serum part modules have keys `iN/<part>`, part ∈ `oscA oscB oscC sub noise filter filter2 env2 env3 env4 lfo1 … lfo10 macros arp
  clip` (serum-core `MODULE_FIELDS` names; `macros` new). **VOICE is the device key `iN` itself** (in parts view its `lay` entry is
  VOICE's, in bundled view the whole panel's); the own FX stays `iN/fx`. `kindOfKey` → `'part'`; `CMOD.partOf(key) → { dev, part } |
  null`.
- **Parts are not devices**: `track.dev` is unchanged (`validate` keeps refusing `iN/oscA` as a device); every internal cable is
  derived from Serum state (§2.5); `track.wires` holds audio cables between devices only (cv-graph `port()` already parses
  `i2/oscA.out`). cv-module learns them from the host: `host.devices(T)` lists `{ key: 'iN/oscB', kind: 'part', dev: 'iN', part:
  'oscB', model: 'serum', title }` entries (§6), from `sx-edges.partKeys` (I1 / I2).
- View flag: `lay[iN].ui = 'parts'` (absent = bundled), as `ui: 'flow'` marks a classic's Simple layout.
- Host records: `trackId/dev → { host, views }` (§2.4); every session map keyed `trackId/dev` from R4 on (§4.3).

### 2.2 Catalogue

| module | panel (one implementation: `sx-ui-mod.js` / existing) | state | per Serum | jacks | ⏻ |
|---|---|---|---|---|---|
| **VOICE** `iN` | `VoiceHeader` (preset ◀ name ▶, save, undo / redo, menu, MASTER + meter, voices, render-last) + `VoicingPanel` + `EnvPanel(·, 0)` (ENV 1) + `OutputsPanel` (MAIN / DIRECT / BUS 1 / BUS 2 strips out of sx-ui-mix `outStrip` / `bypassBtn`); fold-outs (the panel's `foldable`): QUALITY, TUNING, MPE, VOICE CONTROL, VELO / NOTE (`CurvePanel`), KEYS (`KeyboardPanel`, `s.kbd`), CHAOS 1 / 2 (S1 mode only, as GLOBAL). PREFERENCES / INFO → ⋯ (app dialogs) | `voicing`, `g.*`, `e1.*`, `global`, `vc`, `velo`, `note`, `kbd` | 1, required | in `main`, `direct`, `note` (left); out → `iN/fx` (today's read-only cable, bus / direct labels); mod-out `env1` (top right) | none (1f) |
| OSC A / B / C `iN/oscA…` | `OscPanel(root, kit, o, { bare })` (H1) | `osc[o]`, `a.* / b.* / c.*` | ≤ 3, letters fixed | out (right) | `a.on / b.on / c.on` |
| SUB, NOISE | `SubPanel`, `NoisePanel` (`data-noisepanel` kept) | `sub`, `noise` | ≤ 1 each | out | `s.on`, `n.on` |
| FILTER 1 / 2 | `FilterPanel(root, kit, k, { bare })`; the S A B C N switches stay (the same edit as a cable, §2.5) | `filter[k]`, `f.* / f2.*` | ≤ 2 | in, out | `f.on`, `f2.on` |
| ENV 2–4 (own) | `EnvPanel(root, kit, k)`, a fixed slot (no tabs) | `env[k]`, `e<k>.*` | in use (§2.4) | mod-out | — |
| LFO 1–10 (own) | `LfoPanel(root, kit, k)`, a fixed slot; GLOBAL / PER NOTE badge on the bar = `lfo.mono` (Serum's MONO, one field) | `lfo[k]`, `l<k>.*` | in use | mod-out | — |
| MACROS (own) | `MacrosPanel(root, kit)`: Serum's 4 × 2 grid; **each name tile is its macro's jack** (`k1…k8`, inline, §2.5) | `macros` | 1 | 8 inline | — |
| ARP | `ArpPage` alone (the bundled ARP page's MACROS pane is serum-ui `buildSeq`'s, not ArpPage's: it is simply not mounted) | `arp` | 1 | note out → VOICE `note` | `arp.on` (= the cable) |
| CLIP | `ClipPage` with its own MACROS pane (Serum's CLIP UI: its knobs write clip lanes while recording, sx-ui-seq 1733–1746), closed by default; its eight knobs are **twins** (`data-twin`: no cable end, no drop target; ends resolve to the MACROS module; halos shown) | `clip` | 1 | note out → VOICE `note` | `clip.on` |
| own FX `iN/fx` | `FXRackUI` as today (the bundled FX page is not mounted in parts view) | `dev.iN.fx` | 1 | as today | — |

**The part's ⏻ is the panel's own power toggle** (`dToggle(powerId, …, { module })`, serum-ui 3691) placed in the canvas bar's power
slot: a `data-dest="a.on"` destination (cable end, drop target, halo, press-and-hold menu as in the panel), so existing rows on `a.on`
keep their end. The panel's module-label drag (`moduleDrag`: swap / copy onto another part of the kind) moves to the bar title.

Not modules in parts view (they stay in the bundled view): MIX (cables + `OutputsPanel`), MATRIX (the Mod list + cables), GLOBAL
(VOICE's fold-outs), the tile strip (module jacks).

**Canvas modulators** (track devices; data unchanged, N3), each on **the same panel class** a Serum's own slot uses (§2.3):

| module | panel | notes |
|---|---|---|
| LFO `l<n>` | `LfoPanel(root, slotKit, 0)` | bar badge GLOBAL / PER NOTE (= its MONO button) |
| ENV `e<n>` | `EnvPanel(root, slotKit, 1)` | ENV 2's layout (START / END; ENV 1's sustain law never applies); fixes XM §8.7's curve bug by construction |
| Macro `m<n>` | `MacrosPanel(root, slotKit)` | 4 × 2 grid, tiles as jacks `k1…k8` (the 2b one-column layout and right-edge jacks go); names ≤ 16 (the record's limit) |
| Chaos `h<n>` | `ChaosRow(root, slotKit, 0)` | RATE, BPM, MONO, S&H — all compiled since 2b (cv-graph `compileMods` writes `mono` / `sh` / `c1.rate` / `c1.bpm`); the 2b body's **smooth** knob and scope are dropped: smooth was never compiled (no Serum parameter); the field stays in the record, ignored. A visible removal: the user is told (§8) |
| Velocity, Note | unchanged until Q5 | Serum's counterparts are the VELO / NOTE curve editors inside each Serum's VOICE (they shape *that* Serum's velocity / key tracking); a curve on the canvas modules is Q5 |
| Mod Wheel, Aftertouch, Bend, CC | unchanged | no Serum counterpart |

**Sizes**: the panel inside a module has **its width in the 1200 px bundled Serum** (the look the user compares with): rowC's columns
≈ MACROS 236 / ENV 314 / LFO 393 / VOICING 209 px (0.9 / 1.2 / 1.5 / 0.8 fr, serum-ui 833), OSC 257 (three on, XM §3), SUB / NOISE /
FILTER from rowA's columns, the chaos row from the GLOBAL page — measured once from a 1200 px bundled reference and frozen as
`PART_W` (sx-ui-mod.js; the parity gate re-measures). The module is that width rounded up to the 32 px grid (LFO 416, ENV 320,
MACROS 256 …), the panel centred on a body of the panel's colour; height = content (measured at mount, `ResizeObserver`; never
user-resizable). `cv-module` gives `W_MOD` / `MOD_H` per-kind values for LFO / ENV / Macro / Chaos (`MOD_W[kind]`, heights measured).

**The modulator column grows leftwards**: each modulator's right edge stays at x ≤ −MOD_GAP (−80), its x = −⌈(MOD_W[kind] +
MOD_GAP) / 32⌉·32; `modSpot` / `modTap` (main 5344–5350), the drop ghost and the tap placement (5395–5404) use the per-kind width
and height. **Existing projects**: once, in schema 7's `STEPS[6]` (lay positions only), every LFO / ENV / Macro / Chaos module keeps
its right edge and grows left; one that then intersects another module moves on left past that module's left edge − MOD_GAP
(modulators only move; nothing else). So no modulator overlaps an instrument and no hardware face leaves GL (gate, §7).

### 2.3 Serum's own panels, one code path

- **`sx-host.js` `SerumHost(o)`** = today's `SerumUI` minus its shell (XM §6.1): state / `edit` / `editFx`, panel undo, the kit,
  `snap`, the paint scheduler (H4), the mod layer, tile / cable drag, the popover layer, shape library, `OscData`, prefs, monitor.
  `host.mount(kind, root, args) → View { id, kind, root, page, shown(), destroy() }` builds under `kit.page = view.page` (a real page
  of the host's registry: painted and rescaled).
  **`SerumUI` = a host + its shell views** (head, 7 pages, foot): the constructor and `showPage` become `mount` calls, so the bundled
  panel stays byte-compatible (its tests keep their shape).
- **`sx-ui-mod.js`** (new): `EnvPanel, LfoPanel, CurvePanel, MacrosPanel, VoicingPanel, ChaosRow, VoiceHeader, OutputsPanel,
  QualityPanel, TuningPanel, MpePanel, VcPanel`, each `(root, kit, args)` + `destroy()`; ≈ 1200 lines leave `SerumUI`. Ids, classes
  and CSS are the bundled ones, and the bundled panel mounts the same classes — **identical look once the container rule below holds**
  (the parity gate, §7, checks it; it is not true by construction).
- **Container rule**: `.sx-root` is the `sx` container (serum-ui 752), and its width queries (812–1029) restyle the inside of a
  narrow root — `@container sx (max-width: 899px)` sets `.wk-md` / `.wk-lg` to 28 px (996–1001), where the 1200 px bundled panel
  has MACROS knobs at 40 px (`size: 'md'`, 3881), and OSC-column knobs at 30 px (831–841). Part and slot-host roots are
  `div.sx-root.sx-part[data-dev=<dev>]` with **`container: sxp / inline-size`** (not `sx`): no whole-panel width query matches inside
  them. The rules the 1200 px bundled panel applies inside an extracted panel (the 1100–1365 band, e.g. `.sx-colO` knobs 30 px; the
  rest found by the parity gate's computed-style diff) are restated once as `.sx-part[data-col=O|SN|F|C|GL] …`, the column the panel
  comes from.
- **Kit additions** (XM §6.1 step 3), mirrored in `tests/serum-ui-stubs/kit.js` (the parity test): `page`, `editor(ed, sig)`, `bpm()`,
  `uiState` (`lfoTool lfoSnap lastLfo big lfoGest`: host-level, shared by the host's views), `srcUsed`, `selectSrc`, `srcMenu`,
  `moduleMenu`, `lockModule`, `opts` (`{ bare, nomod, links, ghosts, learn, undo, lock, wt2lfo, osc, nameMax, tiles, srcItems }`).
- **`K.panel(…, { bare: true })`** removes only the chrome the canvas bar replaces: the power toggle (into the bar, §2.2), the name
  (its module menu → the bar ⋯, its label drag → the bar title), the lock mark, the peek chevron, and the ENV 1–4 tabs (a fixed
  slot). **The panel's own head controls stay, in a head row** (`.sx-ptitle.sx-bare`): OSC — the type menu, the type view's head
  (wavetable menu, ren / del / edit, sx-ui-osc 1507) and the route button (2670–2678); SUB — shape menus and route (2903); NOISE —
  name, load, del, EMBED, route (2950); FILTER — type menus and route (3021–3030); ENV — BPM, LOCK, zoom and ⋯ (serum-ui 3958). No
  collapse (the bar folds).
- `this.el`'s eleven jobs per view root (XM §4.2): the capture listeners on every view root (`host.viewOf(target)`); `hitTest` =
  inside any view root **of this host**; the touch / drag classes on every root; one `layerEl` twin per host; overlays,
  `PresetBrowser` and the large LFO editor on the layer; a unique uid per view. `moduleDrag.find` limited to the same host (XM
  finding 2: today it can swap with another Serum's label).
- Panel undo: one stack per host; snapshots exclude `s.ui` (a view switch is no undo step); Cmd / Ctrl-Z inside a view root goes to
  it (keyboard routing: §2.5).

**The slot host** (the canvas modulators): `slotHost(dev, o)` → a `SerumHost` over a memoised synthetic state
`normalizeSerum(defaultSerum())` with the device overlaid into one slot (LFO → LFO 1 / `l1.*`, ENV → ENV 2 / `e2.*`, chaos → chaos 1 /
`c1.*`, macro → `macros[0…7]`; the writes `cv-graph writeSlot` and the chaos branch of `compileMods` make) — ≈ 29 KB, 0.35 ms, never
saved. `o = { get, live, edit, cancel, set, bpm, rows }`.
- **A gesture with phases** (wk start / move / end): the first `o.live(fields)` opens the gesture's History step (`modPre`, before
  anything is written: its snapshot is the pre-drag project) and keeps the gesture's start fields; every move writes the device
  record (`CMOD.setModState`) and reposts `{t:'mods'}` with `N.modsHold = true` (the 66 ms throttle of 2b U2 / P4, which today only
  `valChanged`'s 'move' sets, main 664): the sound follows the drag as in a Serum. The end → `o.edit(fields)`: the final fields, the
  hold released, `modStep('Edit LFO 1')`. A two-finger rollback → `o.cancel()`: the start fields written back, `modUnstep`; a
  gesture that ends where it began leaves no step (`modStep`'s prune). Fields are device-level keys; nested `lfo` / `env` / `chaos`
  objects are passed whole (the 2b contract).
- **Edits without a phase** (a menu pick, a segment, a toggle, a typed value): `o.edit(fields)` alone = one History step each.
- **Macro values**: `o.set(k, v)` → `modVal` → `{t:'mval'}` per move (as 2b: the payload key excludes macro values, cv-graph 751, so a
  macro gesture reposts nothing); the end writes `v` into the record as one step. Without `set`, macro moves would be silent.
- **No step, no device write**: view edits (`uiEdit`: editor zoom, LOCK fit, page / tab state) and the LFO grid (`s.lfoGrid`, a
  Serum-global field with no device field): kept in the per-module view state.
- **Options**: `undo: false` (History owns it); `nomod: true` (every control `data-nomod`; no mod / MIDI-learn / lock items; cv-mods
  `destOk` refuses modulator kinds too); `links: false` (no LFO point links, no point buses); `ghosts: false` (no other-ENV ghosts);
  `lock: false` (no Lock / "Lock Module", serum-ui 4003: a canvas modulator has no preset); `wt2lfo: false` (Wavetable → LFO, 4208 /
  4262, hidden: a canvas LFO has no oscillators); `osc: false` (no `OscData`, no table loads: `fctx` / `tinfo` get a stub);
  `learn: false` (no MIDI learn on macro knobs, 3896: the CC module is the MIDI path); `nameMax: 16` (the rename prompt's and the
  tile input's hard 24, 3899 / 3907, become `nameMax`); `tiles: 'jack'` (the macro name tiles carry `data-jack="k<n>"` and no Serum
  tile drag: a press-drag starts the canvas mod-cable drag from that jack); `srcItems` (the LFO / ENV / chaos module menu, `moduleMenu`
  + `srcDestItems`, 4073): Init, Copy, Paste (values, the shared `CLIP`: between canvas modulators of a kind and a Serum's own slot)
  kept; Copy (w/mods), Swap with ▸, Lock hidden; Bypass / Remove All Destinations act on the module's `track.mods` rows through
  `o.rows` (the 2b ops, one History step), not on the synthetic matrix. `fx()` = a shared frozen default FX state.
- View state (editor zoom, grid, tool) per module for the session (a Map by `trackId/dev`), not saved.
- `sync()` after undo / redo / a load: re-overlay, `paint(true)`.
- **Allowed differences** from a Serum's own slot (the parity gate's list; told to the user): no point links, no ENV ghosts, no Lock,
  no Wavetable → LFO, no Copy (w/mods) / Swap, macro names ≤ 16, no MIDI learn on macro knobs, **no modulation of a modulator's own
  knobs** (Serum lets an LFO modulate another LFO's rate; the canvas keeps 2b's refusal), the GLOBAL / PER NOTE badge on the bar,
  Chaos without smooth.

### 2.4 Bundled and parts views of one state

- **One host per Serum** (`trackId/dev`) serves both views; **never both mounted** (no "Open as sheet" of the bundled panel while
  parts show, so the `s.ui` view flags cannot couple two views). A switch destroys one view set and mounts the other (14–22 ms on the
  Mac); the host — panel undo, dirty, view state — survives it. A track switch keeps today's rule.
- ⋯ → **Show parts / Bundle**: one History step each (`lay` only; N2). The first Show parts lays out VOICE (at the bundled module's
  place), `iN/fx`, every part with `x.on`, every own ENV / LFO in use, MACROS when a macro row exists, ARP / CLIP when on (Tidy, §2.7);
  later switches restore the stored positions. **Undo / redo of either** switches views through `applyRestore`: the record survives
  (the view set the restored `lay[iN].ui` names is mounted on the same host; `sxDrop`, which destroys the UI and its panel undo, runs
  only when the device's model or identity changes, never for a `lay`-only difference).
- **I1**: in parts view every part with `x.on ≥ 0.5` has a module (one without a `lay` entry gets one, placed by the Tidy rule, no
  History step — e.g. after a preset load); a module whose part is off shows dimmed with ⏻ off. **I2**: an own ENV 2–4 / LFO slot is
  in use when something reads it: an `s.matrix` row (src or aux), a canvas link row, or an LFO point-modulation bus; in use ⇒ a
  module. A shaped slot nothing reads gets no module by itself (it would mount up to ten LFOs for one preset); VOICE ⋯ → Add ▸ lists
  it ("LFO 4 · shaped").
- **Add a part** (a Sources tile, §2.6, or VOICE ⋯ → Add ▸): the first free slot of the kind (`sx-edges.firstFree(s, kind)`: `x.on <
  0.5`, lowest letter, for OSC / SUB / NOISE / FILTER; a not-in-use slot for ENV / LFO), laid at the drop point; a part with a power
  field (OSC, SUB, NOISE, FILTER, ARP, CLIP) is powered on **with its kept settings** (SPEC §8.5). One History step, carrying `meta {
  trackId, dev, part, on: [before, after] }` when a power field changed (ENV / LFO / MACROS: `lay` only).
- **Remove a part** (⋯ → Remove): ⏻ off + its `lay` entry deleted, one History step with the same meta. An own ENV / LFO in use is
  not removable ("LFO 3 modulates 2 knobs", with the panel's Remove All Destinations).
- Undo / redo of add / remove write `p['x.on']` back from `meta` only when the current value equals the step's after-value (else it
  stays, with a notice): 2a's `modMoveBack` pattern; `keepDevs` unchanged.
- **Destinations with no knob on screen**: a row (`s.matrix` or canvas) whose destination has no element with a box in any mounted
  view of its Serum — a part without a module, unison in the closed gear popover, a value in a folded VOICE fold-out — ends at VOICE's
  bar (left end), dashed, tagged with the part and knob ("OSC B · LEVEL · hidden"); a tap opens the inspector with "Show OSC B" /
  "Open UNISON". A row into an off part's knob ends at the dimmed knob as usual.

### 2.5 Internal cables are views (one pure module)

- **`sx-edges.js`** (new, pure, node-tested): `serumEdges(s, fx) → [{ a, b, kind, share?, fork?, stub?, ro? }]`, `setEdge(s, fx, a, b)
  → { edit(s, fx) | null, why }`, `cutEdge(s, fx, a, b)`, `firstFree(s, kind)`, `partKeys(s, lay, dev, used) → [part]` (I1 / I2; `used`
  = the slots rows, link rows and point buses read). It replaces cv-cables' pasted `STRIPS` / `routeOf`. The MIX page (sx-ui-mix
  `routeOf` / `channelStrips` / `routeMenuItems`) and serum-core (`filterFeeds`, `toggleFilterRoute`, the normaliser's F1 / F2 loop
  rule) stay as they are; `jackrules.test` proves sx-edges agrees with each of them on every enumerated state.

| cable | fields | rule |
|---|---|---|
| source (OSC A/B/C, SUB, NOISE) → FILTER 1 / 2 | `route = 0`, `p['x.fbal']` (0 = F1, 1 = F2, between = both), `p['f.route<X>']` / `p['f2.route<X>']`, X ∈ A B C N S (the ten switches SPEC §8.3 omits) | one output per source: a new cable replaces the old (animated unplug); a second filter cable makes a **fork** (fbal 0.5; a BALANCE badge at the fork opens the source's routing popover); lit ⇔ `filterFeeds` |
| source → VOICE MAIN / DIRECT | `route = 1 / 2`; AMP ENV `x.env` (a toggle at the VOICE end) | as above |
| source → nothing | `route = 3` | Disconnect |
| `route = 0` lit nowhere (switch off or share 0) | — | a dashed stub at the out jack tagged "→ Filter (off)"; a tap opens the routing popover |
| FILTER 1 → FILTER 2 (or the reverse) | `filter[k].route = 0` | one direction, the most recent wins (the other goes to Main) |
| FILTER → MAIN / DIRECT / nothing | `filter[k].route = 1 / 2 / 3`, `filter[k].env` | |
| OSC → OSC warp / FM / RM / pitch source | `p['x.w1' / 'x.w2']`, `osc[o].fm`, `osc[o].pitch.src` | dotted orange, **read-only** here (a tap opens the warp / pitch menu, which refuses cycles as today) |
| ARP / CLIP → VOICE note | `arp.on` / `clip.on` | |
| VOICE → own FX | `fx.racks[k].route / byp`, `g.master / direct / bus1v / bus2v` | read-only (edited in VOICE's `OutputsPanel`); labels as today |
| bus sends | `x.bus1`, `x.bus2` | knobs, not cables |
| own LFO / ENV / macro → a knob of the same Serum | `s.matrix[slot]` (`host.addModUI`, a native row) | D11 |
| own LFO / ENV → a knob elsewhere on the track | a `track.mods` link row from `iN/lfo<k>.out` / `iN/env<k>.out` (2b) | own macros refused: "A Serum's macros modulate that Serum · use a Macro module" |
| canvas modulator → a part knob | a `track.mods` row `iN:<param>` | part-independent: the same row bundled or as parts |
| source → a panel / OUT | refused: "Serum sources play through their VOICE" | (3S: into another Serum's FILTER moves the part, §2.8) |

- **Editing**: drag from a jack; tap a jack → "Connect to…"; long-press a cable → Disconnect (a fork: Balance…). **An internal cable
  edit made on the canvas is one History step** (D12 "structure is undoable", like a canvas mod-cable drag): `hist.record` first,
  then the edit through the host (`sxEdit`; the panel undo records it as its own labelled step), the step carrying `meta { trackId,
  dev, f: [[path, before, after] …] }`; undo / redo write the fields back when every current value equals the step's after-
  (before-) value, else a notice (§2.4's write-back: `keepDevs` would keep them otherwise). The same fields edited inside a panel
  (the OSC route popover, the filter switches, the bundled MIX page) stay panel-undo, as today. The notice ("OSC B → Filter 2 ·
  Undo") calls History's undo. (Q4.)
- **Keyboard and ↶**: Cmd / Ctrl-Z and the top ↶ / ↷ go to History unless the focus is inside a Serum view root (then that Serum's
  panel undo, as the bundled panel today). After a canvas cable edit the focus is on the canvas, so Cmd-Z undoes the cable, never an
  earlier Show parts.
- **Drawing**: per-voice audio 3 px in the group colour, under the modules (SPEC §2.9); a Serum's own LFO / ENV / macro rows drawn from
  their module's jack to the knob as 2a mod cables (the Serum's colour, no "preset" tag), edited by the inspector's preset-row path
  (`sxEdit` on `s.matrix[slot]`); rows whose source has no module (VELO, NOTE, random …) are listed in the **Mod list**, which in parts
  view lists every `s.matrix` row (it replaces MATRIX), and the 2a performance sources keep their "preset" cables.
- **Link-row sources**: `modSrcPort` accepts part keys (`/^([a-z][a-z0-9]*(?:\/[a-z][a-zA-Z0-9]*)?)\.(out|k[1-8])$/`; today's
  `[^.:/]+` refuses them, cv-cables 85–89), and the host resolves the key: in parts view `iN/lfo<k>.out` → module `iN/lfo<k>` port
  `out`, `iN/env1.out` → VOICE (`iN`) port `env1`, `iN/env<k>.out` (k 2–4) → module `iN/env<k>`; in bundled view (no such module)
  today's behaviour (no cable; the Mod list lists the row).
- **Inline jacks** (cv-module): a jack spec gains `side: 'inline'` with module-local `{ x, y }` measured from its anchor, the element
  `[data-jack="<port>"]` inside the module (B's `MacrosPanel` sets it on each name tile under `tiles: 'jack'`; C's cv-module finds
  it), at mount / relayout (a layout read outside bursts, as the 1h face offsets).
- **Knob ends** are measured per module, keyed `(moduleKey, destId)` (several modules share one `[data-dev]`); a destination is shown in
  exactly one module: twins (`[data-twin]`, CLIP's MACROS pane) are skipped for ends and drops; the bar ⏻ is the `x.on` end.

### 2.6 Sources tray and drops (one instrument per track)

- The Serum view's **Serum parts** section: OSC, SUB, NOISE, FILTER, MACROS; **Note tools**: ARP, CLIP (original glyphs; cv-tray
  `SRC_VIEWS` data).
- A part tile on a track whose instrument is a Serum: a bundled Serum switches to parts first (the same History step); the part joins
  the first free slot (§2.4); full → "This Serum already has 3 oscillators" (Q3).
- On a classic track: "Serum parts belong to a Serum · Replace with Serum" (one tap replaces the instrument by Serum (complete) in parts
  view and adds the part; one step). ARP / CLIP likewise.
- The Serum tile ("Serum (complete)") replaces the instrument as today and arrives in the default view (D-R5); as parts: VOICE, OSC A,
  FILTER 1 and `iN/fx` (the default preset's parts that are on).

### 2.7 Tidy, chrome, selection

- Tidy for a Serum in parts view, left to right: canvas modulators (the left-growing column, right edges at −MOD_GAP) → note tools
  (ARP, CLIP) → sources (OSC A / B / C, SUB, NOISE, top to bottom) → filters → VOICE (own ENV / LFO / MACROS stacked above it) → own
  FX → panels → OUT.
- Every part carries the group colour stripe and the chip "S1"; selecting VOICE outlines the members. A part's ⋯: Init, Copy, Paste,
  Swap with ▸ (same kind, same Serum: `copyModule` / `pasteModule` / `initModule` / `swapModules` through `moduleMenu`), Lock (the
  preset lock, as the panel's), Remove, Bundle. VOICE's ⋯: Show parts / Bundle, Add ▸, Modulation list…, the 1f items.
- Press-and-hold mod menus, the two-finger rollback, edge auto-scroll, "controls sleep below 50 %", double-tap to 100 %: per widget /
  per module, unchanged (`onCtx` on every view root).

### 2.8 Limits, "Serum 2", moving parts (the data rules; built only in step 3S, §5)

- The limits are the slots: 3 OSC, 1 SUB, 1 NOISE, 2 FILTER, ENV 2–4, 10 LFO, 8 macros, 64 rows per Serum (SPEC §8.4).
- **Without 3S** (one Serum per track): a 4th oscillator is refused with the count (Q3); there is no other Serum to cable into.
- **With 3S**: a part beyond the slots → `CMOD.addInst(t, 'serum', { vals: init with that part only, on })`, auto-cabled through its
  own FX into the shared panel / OUT: "Added to new Serum 2". Cabling a source of Serum 1 into a FILTER of Serum 2 (or ⋯ → Move to ▸,
  or dropping the part into Serum 2's group) is **one History step**:
  1. `serum-core.copyModule(s2, s1, dstPart, srcPart, { mods: true })` into Serum 2's first free slot of the kind (SUB / NOISE only onto
     SUB / NOISE); full → refused with the count.
  2. Route it into that filter (`setEdge`), `x.on = 1` in Serum 2; Serum 1's part `x.on = 0` (its settings kept, SPEC §8.5).
  3. Copied rows whose source is Serum 1's LFO / ENV become canvas link rows from `i1/lfo<k>.out` / `i1/env<k>.out` (else they would
     read Serum 2's LFO / ENV of that number); macro-sourced rows are dropped and listed.
  4. Warp / FM / RM / pitch references to Serum 1's other oscillators are dropped and listed; `s.midi` / `s.locks` entries of the moved
     ids too.
  5. Canvas rows `i1:b.*` are re-targeted to `i2:<x>.*` (new `CMOD.retargetRows`).
  6. History `meta { from: { dev, s }, to: { dev, s } }` (both Serum states before); undo / redo write both back when neither changed
     since, else a notice; both hosts re-base their panel undo.
  7. Notice: "Moved OSC B to Serum 2 · it now plays through Serum 2's voice · Undo", plus what was dropped. Not bit-identical by design
     (the slot letter's PRNG stream, Serum 2's VOICE / glide / ENV 1).

### 2.9 Live data for the panels (the one worklet change, monitor-only)

- A Serum's own part views get the Serum's snapshot as today (one `smon` per Inst, fanned out to the shown views).
- The canvas modulators: ModCore's `live` (2b: `Float32Array(16)` values only, written every span, `mcSnap` passes a scalar) is
  unchanged. New: per evaluated LFO slot its phase and output y (`MC.livePh`, `Float32Array(20)`) and per ENV slot its stage and stage
  time (`MC.liveEnv`, `Float32Array(8)`), read from the processor LFOs and the pseudo-voice (the reads `SerumDSP`'s snapshot makes),
  **written at the span end and posted as `{ t: 'smon', mc, mcx }` only while the Track's `'mods'` monitor id is subscribed** (a flag
  the Track sets from `{t:'mon', ids}`; unsubscribed, no new write at all: N1 literally). The subscription becomes track-level with no
  part (`mcMonitor` today rides the primary's part): an engine monitor change in `engine.js`'s monitor region, lane E. The slot host
  maps them into its slot's `snap.lfoPh / lfoOut / lfoY / envStage / envT`, so the phase dot and the ENV playhead move as in a Serum
  (they never moved on the 2b bodies).

## 3. Data, model, undo, presets, migration

- **Saved**: `dev.iN.vals.s` and `dev.iN.fx` exactly as today; parts add `lay['iN/<part>']` entries and `lay[iN].ui = 'parts'`. The
  modulator records keep their 2b shapes (no migration of content). `track.mods` rows are part-independent.
- **Schema 7** (`cv-migrate.SCHEMA = 7`, `STEPS[6]`: `lay` positions only — the modulator moves of §2.2; content unchanged). A
  schema-6 build's `normLay` would drop the part keys and `ui: 'parts'` and autosave the loss; the gate opens such a project read-only
  there instead (SPEC §5.8). `song.js`: `LAY_KEY = /^[a-z][a-z0-9]{0,15}(\/[a-z][a-zA-Z0-9]{0,15})?$/` (as `PORT_ID`), the entry cap
  64 → 256 (a Serum in parts is up to 25 modules), `ui ∈ { 'flow', 'parts' }`; `cv-model.dropLay(id)` removes `id` and every `id/*`.
- **History**: Show parts / Bundle, add / remove part (meta write-back, §2.4), **canvas internal cable edits** (meta write-back,
  §2.5), module moves / folds: one step each. Part knobs, a ⏻ or switch pressed inside a panel, the routing popover, the matrix: the
  Serum's panel undo (today's knob-tweak policy, D12). Canvas modulator edits: one step per gesture, opened at its first live change
  (§2.3). Cmd / Ctrl-Z routing: §2.5. Snapshot cost grows by ≈ 25 `lay` entries per Serum: negligible.
- **Presets**: whole-Serum, on VOICE (`sxLoad` / `sxSave`), locks honoured, canvas rows re-injected (D11). A load adds modules for parts
  now on (I1, no History step) and dims parts now off; it never touches other `lay` entries or `track.mods`. Per-part Copy / Paste /
  Init / Swap through the existing serum-core functions (same kind, same Serum).
  **Amendment (the lead, 2026-10-20, review 1 F2)**: a part place written by the rule (`sxPlaceNew`, the first Show parts' group) is
  automatic (`lay['iN/<part>'].auto = 1`, kept by `song.normLay`, Tidy and the no-step moves); a user act on the module (a move or
  fold, Add, the tray, Show OSC C) clears the mark. A load — any `vals.s` replacement that is not a History undo / redo (those carry
  their lay): `sxLoad` (the browser, VOICE ◀ ▶, a MIDI program change), and the panel's seeded edits (Init Preset, Hybridize, its
  undo / redo of a load) — prunes the automatic entries whose part is now neither on (I1) nor read (I2), in either view, no step.
  User-placed entries are never pruned, so "a load never touches other `lay` entries" holds for everything the user arranged.
- **Save as classic project, the file mirror**: unchanged (the Serum state is the same; the parts layout is view-only and dropped); main
  opens such a file as a bundled Serum.
- **The ENV curve bug** (XM §8.7): a canvas ENV whose curve was typed in the 2b body may hold an extreme curve; it is what the engine
  played, so it is kept; the Serum `EnvPanel` shows the true value.
- `cv-migrate.splitTracks` unchanged (one instrument per track stays the rule until 3S).

## 4. Retiring the 1e transition accessors and the primary-only paths

### 4.1 What exists (AM §1.1–1.2)

`cv-model.adopt` installs five non-enumerable accessors on every track (`model / vals / preset / seq` → `dev[prim]`, `fx` → the FX of
`fxDevOf`); `main.js fxOf(t)` hands out a detached rack when there is none; `instView(t, dev)` returns **the track itself** for the
primary, so `dvOf(x)` is null for the primary and "null means primary" is tested in ten places. Sites (the dynamic hook, AM §0): main.js
**83 reached** of 195 static (69 functions; the cv-model header's "~120" is stale), classic-panel.js 3, midi.js 2, song.js 1 (769,
`exportMidi`), assets.js 6, cv-module.js 1 (the 1b legacy path, module tests only); **169** test sites in 11 files. The static regex
also matches ≈ 65 lines outside main.js that are not accessors or are kept on purpose (cv-cost, cv-graph, cv-migrate, cv-module,
smpgen, cv-cables — plus `isSx(D, id)`, a different function —, cv-modlayer, song, fx-core, serum-core) and main's `V.model` on
`c.v1`: the ratchet cannot reach zero.

### 4.2 Primary-only paths (every one gets a test with a non-primary device in the data, even while the UI has one instrument)

| path | today | becomes |
|---|---|---|
| program change (`programChange`) | each track's primary Serum, asks through `sxPanel.ui.confirmChange()` | the primary, named explicitly (`CMOD.primId`); the confirm through that device's host |
| MPE detection (`midi.isMpe`) | the primary | "any Serum on the track with MPE on" via the host's `instsOf` |
| multisample zone (`zoneOf`, `zoneWarm`) | `sxPanel.ui.snap`; `zoneWarm` only `if (r === sxPanel)` | per device record |
| `wheelToWt` / wtEdit default, `resampleTo`, `renderLast` default, `rateText`, `sxQuality` / `trackOS` | the primary | the device passed (or every Serum where the service means all: `sxMaxOS` / `capsOf` already loop) |
| `voiceSeen` + voice labels (`buildInstPatch`, `trackVoice`) | the primary only | per device |
| FX phase memory (`primFx`, `N.fxph`, `syncPhases`, `setPhases`, `sxSave`) | the primary's rack only | a Map by part id; each rack asked with `i` / `c` (the engine already answers per part) |
| per-model value memory (`synth.v.<model>`: `bind` 281–283 reads, `save` 294 writes from the globals `model` / `vals`, `setCur`'s flush 1727) | the globals R6 removes | the current device's view, written per model as today (R0 test first) |
| preset session maps `presetKeys`, `sxKeys`, `sxDirty`, `voiceShown`, `voiceOpt`, `seqHw`, `dxHw` | keyed by track id (= the primary) | keyed `trackId/dev` (R4) |
| the asset manager (`assets.js` `learnTracks`, `relink`, `users`, delete-in-use, `uses`) | the primary Serum and the primary's FX only: another Serum's samples / IRs count as unused | the host hands `states() → [{ track, dev, s, fx }]` for every Serum and panel |
| MIDI file export (`song.js` 769) | `tr.model` | `instOf(tr).model` |
| ModCore live meters (`mcMonitor`) | ride the primary's part | the track's `'mods'` id (no part; lane E's engine side) |
| homes and singletons: `sxPanel`, `fxTab`, `cvHomeKeys` (`#inst`, `#fxrack` moved by reference), `cvBodyEl`, the globals `model` / `vals` / `cpanel` (`bind()`), the `primId(t)` default-dev pattern (31 lines: `sxMonitor`, `modCount`, `sxHost`, `panelKey`, `peerRefresh`, `cvDropInstrument`, `fxTarget` …) | "the primary is special" | per-device records (`trackId/dev` → `{ ui, … }` in R6, `{ host, views }` in phase 2), `curView()` reads |

Kept on purpose (each an allowlist entry with its reason, §4.3): `CMOD.primId / instIds / fxDevOf / destOf` (API: the primary is still
named where it is meant — program change, `toV1`, the file mirror), `instRoutes / primV1 / mirror`, the v1 branches of cv-cables /
cv-cost / cv-graph `v2View` / cv-module `tidy1`, cv-migrate's v1 inputs, plain device-record reads the regex catches.

### 4.3 Steps (AM §1.6), mechanical first — all in lane A (phases 0–1; B / C / E never touch main.js)

| step | what |
|---|---|
| **R0** | the safety net. A **shrink-only ratchet** in `tests/lint.test.mjs`: per root file, the lines matching `\b(t\|tr\|x\|T\|v\|V)\.(model\|vals\|preset\|seq\|fx)\b`, `trk().x` / `curView().x`, `fxOf(`, `isSx(` against `tests/fixtures/accessor-allow.json` (above fails; below asks to lower the file). The dynamic recorder (AM §0's loader hook) checked in as `tests/accessor-hook.mjs`, run over each sim. ≈ 24 characterisation tests (`tests/accessors.test.mjs`) for what no sim reaches, written against today's behaviour: `presetSave / Delete`, `sxCurrent / Rename`, `programChange`, `wheelToWt`, `fxHost`, **`resampleTo`'s primary bytes** (`buildPatch` path), `renderLast` legacy, `syncPhases / setPhases`, **`sxSave`'s phase capture** (`N.fxph` of the primary's rack into the stored preset), **`save()`'s `synth.v.<model>`** writes and `bind`'s read, `projectFile`, `importMidiFile`, `addTrack`, `duplicateTrack`, `trkListUI`, `instMenu`, `zoneOf / zoneWarm`. From R0 on no lane adds a site |
| R1 | `instView(t, dev)` returns a `VIEW` for the primary too. **Keys R1–R3**: `VIEW.id` = the track id for the primary, `trackId/dev` for any other (today's keys: no map changes). Every `dvOf(` site decided, since `dvOf(x)` is no longer null for the primary — "null means primary" becomes `isPrim(x)` (`dvOf(x) === CMOD.primId(trOf(x))`): 663 `valChanged` (cpVer key, same), 1685 `setTrackModel` (same dev), 1762 / 1765 / 1766 the classic mod hooks (same dev), 1769 `panelKey` (same), 2114 `fxEdit` → `fxEditDev(dev)` (the primary passes its dev: `fxOfDev` of the primary = `fxDevOf`, same rack; `sxDirty` key via `VIEW.id`), **2275 `sxSave`** (`isPrim ? nodes.get(t.id)` — else the primary's phase memory is lost), **2486 `resampleTo`** (`isPrim ? buildPatch : buildInstPatch` — else the primary's patch path changes), 4902 `cvDropInstrument` (same), `renderLast`'s legacy branch (`legacy` keeps `dev === primId && legacyOk`). ≈ 45 reached sites become accessor-free; R0's tests prove the primary's bytes and phases unchanged |
| R2 | the reads (AM groups A, half of B / D): `instOf(t)`, `isSx(t)` → `isSerumDev(t, dev)` / `serumsOf(t)`; classic-panel, midi `isMpe`, song 769 (mechanical, ≈ 120 sites) |
| R3 | `fxOf` → `fxOfDev(t, dev)` everywhere (`fxOf` deleted); the per-rack phase memory |
| R5 | writes and lifecycle: `normDevs` for every device (the primary's exclusion dropped: `loadProject` / `freshProject` normalisation lines vanish), `setTrackModel` through `CMOD.setModel` (vals before model: C11), `bind()` writes gone |
| R4 | **keys from R4 on: `VIEW.id` = `trackId/dev` for every device, the primary too**, and every session map re-keyed in the same commit (`presetKeys`, `sxKeys`, `sxDirty`, `voiceShown`, `voiceOpt`, `seqHw`, `dxHw`; none is saved); preset services take a device view; the asset manager's `states()` (semantic: the lead reads its diff) |
| R6 | homes and singletons: device bodies through per-device records (`trackId/dev → { ui, el, box, gen … }` for Serums — lane D later makes it `{ host, views }`); `sxPanel` / `fxTab` / `#inst` / `#fxrack` / `P.inst` go; `FACES.recheck` on re-homing, track-switch mounting (U17); the `synth.v.<model>` memory off the globals (semantic: the lead reads its diff) |
| R7 | delete the accessors: production `adopt` keeps v1 → v2 + `repair` and installs nothing (`'model' in t === false`). **For one stage the sims and dev builds** (`window.__synthTest` set, `?dev=1`, node tests: `adopt(p, { guard: true })`) install **throwing** non-enumerable V1-key accessors, so a stray `t.model = …` throws instead of creating an enumerable field that autosave and History would serialise. The 169 test sites via a helper `P = t => instOf(t)` (mechanical); cv-migrate's accessor tests become `setModel` / `fxDevOf` tests; the ratchet at its allowlist; after every load / History step: no own V1 key (`Object.keys(t)`), and production `'model' in t === false` / guard builds the guard descriptor |

No engine, DSP, compile or message change in any step: `canonical-stream` and the goldens are the proof. Phase 2 (lane D) starts
accessor-free: N5 is reviewed on lane A's merge alone.

## 5. Several instruments per track

- **Default: not in milestone 3.** The core keeps one instrument per track (1f).
- **Condition to offer it**: S0's `t2` and `t3` pass **P+**, the rerun on the built app confirms it (`"ui-m3b"`, §7: the real parts +
  two hardware panels), and the user says yes (Q3). Then it is a **separate step 3S** after milestone 3's deploy (its notes go in §9),
  never folded into the core lanes.
- **3S contains**: the 1e UI withdrawn in 1f (IMPL-1e §8.5's list: a drop on empty canvas adds, ⏻, the zone pill, the device menu items,
  editable audio cables, the Effects panel tile, Make primary, Solo, Duplicate / Delete); `splitTracks` split only shapes the UI cannot
  make; "Serum 2" and the moves of §2.8; a **DOM soft cap** on touch devices (a notice when a track's painted elements pass S0's
  largest P+ scene, like the CPU soft caps); the hidden face SVGs taken out of the DOM in gl mode (−3.9k elements in `hw5`; the
  `data-tip` hit test builds one on demand); the missing engine tests (two Serums on one track: copy(A) + B at the chain input, the
  warm-up with a second Serum, a bench row); the user's iPad bench (graph paths in use again: row r and the new two-Serum row).
- If S0 does not pass P+, several instruments stay withdrawn and the user is told that 3R (§1.3) is the way back.

## 6. Lanes (the leaner shape)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **S0** rendering spike | 0 | `tests/ui-bench.html`, `tests/ui-bench-m3.mjs` (new) | the page's own self-check in the CDP harness | standard |
| **A** accessors + data | 0–1 | `main.js` (R0–R7 only, no features; exclusive through phase 1), `classic-panel.js`, `midi.js`, `song.js`, `assets.js`, `cv-model.js`, `cv-migrate.js` (schema 7, `STEPS[6]` with the modulator moves: widths from `cvModule.MOD_W`, read-only), `tests/lint.test.mjs`, `tests/fixtures/accessor-allow.json`, `tests/accessors.test.mjs` + `tests/accessor-hook.mjs` (new), the accessor sites of the test files (R7) | cv-migrate (schema 7, read-only open, normLay keys / cap / `ui`, `STEPS[6]` moves: no modulator overlaps an instrument in the fixtures), cv-model (`dropLay`, `partOf`, the guard), main, canvas-sim, canvas-1e / 2a / 2b-sim, cv-shell-sim, cv-fixes-sim, graph-host, midi, assets, presets, lint, the hook over each sim, canonical-stream (unchanged) | standard (R4 / R6 semantic: the lead reads both diffs) |
| **B** Serum host + panels | 1 | `sx-host.js` (new), `sx-ui-mod.js` (new: panels, `PART_W`), `serum-ui.js` (bare head row, `opts`, the `sxp` container rule and the restated column rules, `paintCanvas` → `wk.storeDensity`, the lazy PATH editor, `nameMax`, `tiles`), `sx-ui-osc.js`, `sx-ui-mix.js` (the `OutputsPanel` extraction), `sx-ui-seq.js` (`storeDpr` → `wk.storeDensity`, CLIP's twins), `graph.js` (only an option a panel needs), `cv-mods-ui.js` (the four bodies → slot-host panels), `tests/serum-ui-stubs/*` | serum-ui, sx-ui-osc, sx-ui-mix, sx-ui-seq, graph, cv-mods-ui, `sx-host.test.mjs` (new: mount alone / twice, view registry and paint gating, `moduleDrag` host guard, bare keeps every head control, the slot host round trip device ⇄ slot for all four kinds, `data-nomod`, the `o.live` / `o.edit` / `o.cancel` / `o.set` phases (first live before any write, macro → `set`, menu edits one call, view edits none), each `opts` item, the ENV curve values) | standard |
| **C** canvas widgets + routing + H5 | 1 | `sx-edges.js` (new, incl. `partKeys`), `cv-cables.js` (part-key `modSrcPort`, inline jacks, twins, hidden-destination ends), `cv-module.js` (kind `'part'`, inline jacks from `[data-jack]`, `MOD_W` / heights per kind), `cv-mods.js` (`destOk` refuses modulator kinds), `cv-tray.js`, `cv-world.js` (`canvasStats`, the total budget), `wk.js` (`storeDensity`, `fitCanvas`), `style.css`, `index.html` | `jackrules.test.mjs` (new), cv-cables, cv-module, cv-mods, cv-tray, cv-world, wk | standard |
| **E** monitor fields | 1 | `mod-core.js`, `engine.js` (the Track monitor region: `postMon`, `mcMon`, the track-level `'mods'` subscription with no part) | modcore (fields written and posted only subscribed), golden-* and canonical-stream run, the V8 A/B of rows mc0 / mc / mt / me | cheaper |
| **D** integration | 2 | `main.js` (the parts lifecycle §2.4, host records `trackId/dev → { host, views }`, `kindOfKey` / `cvMountBody` / `devices(T)` part entries, monitors "any view shown", the cable drag resolver of §2.5, canvas internal edits via sx-edges → History step + meta write-back, the keyboard routing, slot hosts wired (`modPre` at the first live change, `N.modsHold`, `modVal`, `o.rows`), the `mcx` feed, the tray drops of §2.6, the per-kind column placement (`modSpot` / `modTap` / the ghost), D-R5's pref, a hook `__synthTest.cv.parts`), `cv-modlayer.js` (the Mod list as MATRIX in parts view, own rows in the inspector, the hidden-destination tag), `tests/canvas-3-sim.test.mjs` (new), `tests/main-sim.mjs` (additive), `tests/ui-bench-m3.mjs` (the real scenes `p1x-real`, `hwm-real`), `node tools/precache.mjs --write` | page sims, main, pwa, lint, the accessor hook over the new sim | standard |

**Interfaces** (each lane stubs the other side in its tests):
- §2.3: `SerumHost`, `mount`, `View`, `slotHost(dev, o)` with `o = { get, live, edit, cancel, set, bpm, rows }`, the kit `opts`;
  `PART_W` (B) → `MOD_W` (C, the rounded module widths).
- §2.1 / §2.5: `host.devices(T)` part entries `{ key, kind: 'part', dev, part, model, title }` (D builds them from C's `partKeys`);
  sx-edges; the inline jack spec + the anchor attribute `data-jack="<port>"` (B sets it, C measures it); `data-twin` (B sets, C
  skips); the bar power slot (C's bar holds the element B's panel hands over: `View.power`).
- §1.4: `wk.storeDensity(el)` (C) called by B's `paintCanvas` / `storeDpr`; `world.canvasStats()` (C).
- §2.9: `mcx`; §3: schema 7.

**Order**: phase 0 = S0 ∥ A. The lead records S0, takes Q1, applies §1.5's table. Phase 1 = A (R4–R7) ∥ B ∥ C ∥ E (B / C / E never
touch main.js). The lead merges A → E → C → B and runs the **fixture check** (a page sim mounting one Serum in parts against the real
compile and the golden harness: OSC B cabled into FILTER 2 through sx-edges renders the bytes of the same fields set through the MIX
page; a canvas LFO edited through `LfoPanel` posts the payload the same state written directly posts). Phase 2 = D (accessor-free
base; waits for Q1). Phase 3 = **two reviewers** (below) → fixers (cheaper model, failing test first) → **one sweep** (the lead, one
file at a time) → docs (ROADMAP, HANDOVER, §9) → commit on `canvas` → `tools/deploy-canvas.sh` → the user: `ui-bench.html?m3=1&real=1`
on the iPad (`"ui-m3b"`) and the hands-on.

**Reviewers**: (1) **real engine** (golden harness, `main-sim` with the real Track): N1–N3 and N5; every internal cable mapping
rendered against the MIX-page edit of the same fields; bundled → parts → bundled byte-identical; the accessor retirement's message
streams (`canonical-stream`, the 2b fixture), R1's `dvOf` sites and R4's re-keying; E's fields neither written nor posted
unsubscribed. (2) **headless Chrome** (the CDP harness, 1440 × 900, 1366 × 1024, 1024 × 1366): the look parity of §7, parts mount /
add / remove / undo, Show parts / Bundle and their undo, cables, stubs, forks, hidden-destination ends, inline macro jacks, Tidy and
the left-growing column, the two-finger rollback on a part knob and on a slot-host drag, the budgets and the density audit, ui-bench
`?m3=1` as the Mac proxy, no console errors.

**Rules for every builder**: `git reset --hard <base>` first (harness worktrees start from `main`; check `git log -1`); base = `canvas`
at this contract's commit (phase 1 / 2 lanes: the merge commit the lead names); `?v=9` on every import; `import './v8-guard.mjs'` first
in new test files; never fake-DOM nodes in `assert.*`; one test file at a time with `node --max-old-space-size=2048 --test
tests/<file>.test.mjs`; new modules reachable from `main.js`; dense comments in the existing voice; commit on the worktree branch;
report the commit hash and the gates measured. Briefs are short: the lane's row, the sections it implements, the base.

## 7. Gates

- **Sound (N1)**: golden-classic, golden-fx, golden-presets, golden-random, golden-graph bit-identical; `canonical-stream` unchanged
  (fixture untouched); cp2 / ct2 / 2b fixtures; `noAlloc` with the monitor fields on.
- **Engine bands**: V8 A/B ≤ 2 % per row vs the base (engine.js / mod-core.js changed); JSC (the lead's shell method) ≤ 3 % on mc0 /
  mc / mt / me, c1, d, e. No iPad audio bench (no audio-path change).
- **Data**: schema 7 (`STEPS[6]` moves `lay` positions only; a schema-7 project opens read-only in a schema-6 gate test); `normLay`
  keeps `i1/oscA` and `ui: 'parts'` and up to 256 entries; `dropLay` removes `id/*`; **bundled → parts → bundled leaves `vals.s` and
  `fx` byte-identical** and History holds `lay` only; add / remove part and canvas cable edits undo / redo with the meta write-back
  (incl. a changed-since case).
- **jackrules**: every cable ↔ field mapping both ways; state → edges → state round trip over the enumerated states; agreement with
  `filterFeeds` / `toggleFilterRoute` / sx-ui-mix `routeOf` / the F1-F2 loop rule; fork, stub, refusals; the S A B C N switches as
  cables only (never modulation destinations); `partKeys` (I1 / I2, shaped-but-unread slots excluded).
- **Accessors (N5)**: the dynamic hook reports zero accessor calls over every sim; the ratchet at its allowlist (each entry with a
  reason); production `'model' in t === false` and no own V1 key after every load / History step (guard builds: the throwing
  descriptor); each §4.2 path tested with a non-primary device (assets `states()`, MIDI export, per-rack phase memory, program change,
  `zoneOf`, the session maps, `synth.v.<model>`); R0's characterisation tests unchanged (the primary's resample bytes, `sxSave`'s
  phases).
- **UI**: page sims (`canvas-3-sim`: Show parts / Bundle and **their undo / redo keeping the host and its panel undo**; add / remove /
  undo; a part tile on a Serum / bundled Serum / classic track; the cable drag resolver's three destinations; **an internal cable
  edit then Cmd-Z undoes the cable, not an earlier Show parts**; the Mod list in parts view; a preset load adding modules; a row into
  a removed part's knob ends at VOICE with its tag; a link row `iN/lfo3.out` drawn from `iN/lfo3`, `iN/env1.out` from VOICE's `env1`;
  a slot-host drag = one History step whose undo restores the pre-drag record, a rollback leaves none, reposts throttled under
  `N.modsHold`, macro moves post `mval`, menu edits one step each, view edits none; the bar ⏻ is an `x.on` cable end).
- **Look parity**: in headless Chrome at k = 1, dpr 2, each canvas LFO / ENV / Macro / Chaos module **and each part (OSC, SUB, NOISE,
  FILTER, ENV, LFO, MACROS, VOICING)** against the same panel **in the actual 1200 px bundled Serum** holding the same state (not a
  standalone mount): ≥ 99 % of pixels within 8 / 255, excluding only the removed chrome's rects (power, name, lock mark, chevron, ENV
  tabs); equal computed knob diameters (`--wk-d`); every remaining difference listed against §2.3's allowed list; the default canvas
  ENV shows Serum's default curves (XM §8.7 fixed); `data-nomod` refusals on modulator panels; the phase dot / ENV playhead move from
  `mcx`.
- **Rendering**: H5 — M4 minimum on-screen density ≥ 1.0 at rest for every canvas at k ∈ {0.25 … 2}, Σ all stores (on and off
  screen) ≤ 64 MB; the §1.4 budgets (and the worst factory preset) measured on the built app; no modulator rect intersects an
  instrument after `STEPS[6]`, a tap, a drop or Tidy (faces stay in GL); 1h G1 / G3 unchanged (ui-bench); **the iPad gate**:
  `ui-bench.html?m3=1&real=1` on the deployed build (`p1x-real`, `hwm-real`: the app's own parts and modulators via
  `__synthTest.cv.parts`) meets §1.5's P+ for the parts default (D-R5) and P for parts at all (`"ui-m3b"` in bench.json); for 3S,
  P+ on `t2` / `t3`.
- **Sweep**: every test file one at a time; lint, pwa (precache rebuilt).

## 8. Questions for the user

Only genuine decisions; each has the default the plan uses until answered. Q1 is asked during the iPad session below.

1. **How Serum parts look while you pinch.** They are built from the same live controls as today's Serum panel, so on the iPad their
   text and knobs behave as that panel does now: slightly soft while your fingers move, sharp the moment you lift them (the grid and
   the hardware faces stay exact). Making them exact too means drawing every Serum control on the GPU ourselves — a big stage of its
   own. In the iPad session you pinch a screen full of Serum parts and see two screenshots side by side (during the pinch, after it).
   **Is that acceptable for now?** If yes, milestone 3 is built this way; if no, the GPU stage is planned before the parts are wired
   in (the parts still come, on that base).
2. **Default view for a new Serum**: as **parts** (VOICE, OSC A, FILTER 1 and its FX, cabled) or as the **whole panel** (today)? Either
   is one tap away in ⋯, and a setting lets you choose. **Recommended**: parts for new Serums if the iPad test passes with margin;
   projects you already have keep the whole panel until you switch.
3. **"A 4th oscillator starts Serum 2" and "cabling an oscillator into another Serum's filter moves it"** both need two Serums on one
   track — several synths per track, which you took out in 1f because of lag. **Recommended**: leave both out of milestone 3 (a 4th
   oscillator is refused with a message) and bring several synths per track back as a separate step, only if the iPad test passes with
   room to spare and you say yes.
4. **Undo for cables inside a Serum.** Re-routing OSC B into Filter 2 by dragging a cable on the canvas changes the Serum's routing.
   **Recommended**: the top ↶ (and Cmd-Z) undoes it, like moving a module or a modulation cable; changes made inside a Serum panel
   (its routing menu, knobs) keep using that Serum's own ↶, as today. The alternative is one undo history per Serum for cables too —
   but then the top ↶ right after a cable drag would undo something older instead.
5. **Velocity and Note modules.** Serum has curve editors for velocity and key tracking (VELO / NOTE). The canvas Velocity and Note
   modules could get those editors too, shaping how the velocity / note value modulates any knob on any synth. **Recommended**: not in
   milestone 3 (each Serum already has its own VELO / NOTE curves inside its VOICE module, and a second curve on the canvas would
   stack on top of it for Serum knobs); a small later step if you want them.

**Answers (the user, 2026-10-19):** Q3 — leave both out of milestone 3 (recommended). Q4 — yes: the top ↶ undoes canvas cable edits inside a Serum (recommended). Q5 — not now (recommended). Also: the Serum filter S / A / B / C / N switches stay non-modulatable but **get MIDI learn and lock back** (the 2b fix 645a996 had dropped them with `data-dest`; restored by a separate marker before phase 1). Q1 and Q2 are answered in the S0 session. **Q2 (the user, after the S0 session, 2026-10-20): whole panel** — new Serums open bundled; ⋯ → Show parts and ⚙ → "New Serums open as" switch.

**Answer (the user, 2026-10-20), Q1:** first "I'd rather they not look soft if we can help it", then, told that it means the GPU module painter (3R, a stage bigger than 1h), **"okay nvm it's not that big of a deal" — yes**. §1.5's table applies with Q1 yes: S0's numbers decide D-R1 / D-R5 (Q2 at the session); 3R is not built now (offered again only if S0 or `ui-m3b` call for it; research kept in [map-rendering.md](map-rendering.md)).

**Things you will notice (no decision needed)**: the Chaos module loses its "smooth" knob and little scope (the knob never changed the
sound — Serum has no such control); the knobs on LFO / ENV / Macro / Chaos modules can't themselves be modulated by other modules (in
Serum an LFO can modulate another LFO's rate; on the canvas not yet); an LFO that is shaped but not connected to anything doesn't get
its own module automatically (VOICE ⋯ → Add shows it); existing modulator modules get wider and move left so they never cover the synth.

**And one request (not a decision)**: before the building starts, a 25–30 minute session on the iPad: open
`canvas.domlavin.com/tests/ui-bench.html?m3=1` in Chrome (plugged in, other apps closed), follow the on-screen pinch / pan steps for
each scene (the first and last are the same five-panel scene, to catch the iPad warming up), take the three screenshots the page asks
for, tap **Copy results** and paste them with the screenshots; then answer question 1.

## 9. Notes (the builders fill in)

### 9.0 S0 on the iPad (the user, 2026-10-20; bench.json `"ui-m3"`) and the decision table

Build bd6d7ca2ad50 (canvas a6633e0), iPad Pro, Chrome for iOS 155, stale false. Validity: hw5 first inside its envelope, hw5 last
1 ms over (firstMove 81 vs 80, two steps skipped), drift 0, scale 1, every self-check ok — accepted as indicative (the user: "my
zoom speed was really inconsistent"). M1 hand: sx1 **P+**, p1 **P**, hwm **P** (smoother than hw5 alone, 36 vs 83 ms burst max),
p1x **fail by one settle frame** (106 vs 100; otherwise P), t2 and t3 **fail** (bursts to 198 / 116 ms), hw5 shows the 1h-era single
50–90 ms frames. M0 auto: sx1 / p1 P+, p1x P. M2 on p1x: `layers`, `noWC`, `opacity0`, `none` P+ (the H6 candidate `layers`; not
adopted while parts are opt-in — re-measured in `ui-m3b`); on hwm every variant fails incl. `opacity0` / `none` (the cost is not the
modulators' DOM); on t2 only `opacity0` reaches P. M4: H5 keeps every store ≥ 1.0 at rest. M5: no tab loss. P1: a `data:`-URL
foreignObject draws untainted into GL on iPadOS 26 (a DOM-snapshot route for a future 3R); P2: worker text 12 ms / 2125 strings.

Applied (§1.5): Q1 yes (before the session) and p1x not P+ → **phases 1 and 2 as built; parts opt-in: D-R5's constant `bundled`**
(Q2, the user: "Whole panel"); the touch notice past the largest P+ scene's count (sx1, 1866 painted; §9.9); **hwm P → the
Serum-faithful modulators as specified**; **t2 / t3 fail → several instruments per track stay withdrawn (D-R4)**; 3R stays parked
(the user, "save the soft pinching fix for later maybe"; P1's result makes it cheaper when it comes).

### 9.1 Lane E — monitor fields (2026-10-20; base e9cd1b9; `mod-core.js`, `engine.js` Track monitor region, `tests/modcore.test.mjs` +3, sw.js BUILD)

**Format.** The Track posts `{ t: 'smon', mc: MC.live, mcx: MC.mcx }` while its `'mods'` monitor id is subscribed and a ModCore exists;
`mcx = { ph: Float32Array(20), env: Float32Array(8) }` (the same two arrays every post; postMessage copies). `ph[l]` = the phase of LFO
slot `l` (0…9 = `mc[l]`'s slot; 0…1; Float32 rounding may give exactly 1), `ph[10 + l]` = its Path-LFO Y output (0 for any other type;
the X output is `mc[l]`, so the slot host maps `snap.lfoPh[l] = ph[l]`, `lfoOut[l] = mc[l]`, `lfoY[l] = ph[10 + l]`). `env[j]` = the stage of
ENV slot `j` (SxMod's eSt: 0 idle, 1 attack, 2 hold, 3 decay, 4 sustain, 5 release), `env[4 + j]` = its stage time in seconds, `j` in the
`live` order (0…3 = ENV 2, 3, 4, 1 = `mc[10 + j]`; `snap.envStage[j] = env[j]`, `envT[j] = env[4 + j]`). The reads are exactly SerumDSP's
snapshot reads (`SxMod.snap`, cross-checked per quantum in the test): the most recent voice's (the pseudo-voice once a note has played),
else the processor's. Slots nothing reads stay unevaluated (`sx.mon` is never set), so their phase is the parked one.

**Gate.** `MC.mon` (0 default) is set by `MC.watch(on)`, which the Track calls from `watch()` (every `{t: 'mon'}` / `{t: 'smon'}`) and for a
ModCore built while subscribed (`modsMsg`); going on reads the fields once (the first post is fresh), `span` writes them at its end only
while `mon`; off: no read, no store, no post. Track-level: `ids: ['mods']` alone is enough (no part id; nothing but the `mc` / `mcx`
message posts). Legacy (un-graphed) tracks no longer post an empty part snapshot first when only `'mods'` is subscribed. For lane D: the
host's `mcMonitor` can drop the primary's part (`role` none; `partsOf` → `[]`) and `monitors.deliver`'s `part === null && d.mc` branch
already routes the message; `mcx` rides the same `d`.

**Gates measured.** Sound: golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, canonical-stream 1 pass,
unchanged. `noAlloc` with the fields on (200 spans, notes, transport, watch toggles). Engine bands (the row track's absolute 1 s load,
unsubscribed, vs e9cd1b9): **V8**, 8 interleaved process pairs, medians: mc0 +1.2 %, mc +0.5 %, mt −0.8 %, me −0.5 % (spread of the
runs themselves ±2 %); **JSC shell**, base and new engine in two `$262` realms, 11 interleaved 1 s pairs after a 2 s warm-up, 9
processes (3 + 3 with the realm order swapped + 3 in a four-slot run with an A/A control), median of the pair ratios: mc0 +0.4 %,
mc +0.7 %, mt +0.6 %, me −0.9 % (single processes −1.2 … +1.3 % / −1.2 … +1.2 % / −1.6 … +4.1 % / −1.4 … −0.7 %; the harness' own
A/A control reads 1–3 % low on its second slot, once 10 % on mc0, so only medians mean anything). Monitor on (V8, same tree): mc0 +1.7 %, mc −0.4 %, mt 0.0 % —
noise. Tried and dropped: the `mread` call in `Track.modPre` after `MC.span` instead of inside `span` (JSC mt +3 … +4.7 % in all three
four-slot processes, the extra branch there costs more than the one in `span`). Harness (scratchpad `ab/`, `jsc/`; not in the repo).


### 9.2 Lane A — accessor retirement R0–R7, schema 7 (2026-10-20; merged 44d1623; the lead's summary of the lane's report)

R0 safety net: the static ratchet in `lint.test` (+ `tests/fixtures/accessor-allow.json`, fragments checked), the dynamic recorder
`tests/accessor-hook.mjs` (`ACCESS_STRICT=1`, `ACCESS_OUT=`), `accessors.test` (15 characterisation tests). Data: `SCHEMA` 7,
`STEPS[6] growMods` (places only), `song.normLay` part keys (≤ 256 entries, `ui` flow | parts), `cv-model.dropLay` / `PARTS` /
`partOf`. R1 `instView` for the primary, `isPrim`; R2 `isSx` → `instOf` / `isSerum` / `isSerumDev` / `serumIds`, MPE = any Serum; R3
`fxOf` → `fxOfDev`, phase memory per rack (`N.fxph` / `N.phWait` Maps); R5 `normDevs` for every device; R4 VIEW.id `trackId/dev`
(session maps re-keyed, `voiceSeen` per instrument, `assets.states()` per Serum / panel); R6 one record per device (`serumPanels` /
`fxPanels`), no `#inst` / `#fxrack` homes, same-track changes are a view sync, `curModel()` / `curView()` / `curPanel()`; R7
production `adopt` installs no accessors, guard builds throw (`__synthTest`, `?dev=1`, `adopt(p, {guard: true})`). Ratchet 193 → 52
lines (lane A's files 145 → 13); the dynamic hook's last site (cv-module `tModel`) went in lane C. Sweep at R7: 78 files / 2199 tests;
the lead's sweep after the merge: 78 files / 2207 tests, goldens and canonical-stream bit-identical. Behaviour changes (intended): a
Serum-FX-page removal / IR relink prunes that rack's canvas rows; the tempo resend reaches every synced 303; a non-selected classic
primary's vals merge with defaults at load; a track switch destroys the outgoing primary panel at the switch.

### 9.4 Carried to lane D (the lead, from A's and C's reports)

1. `modSpot` / `modTap` / the drop ghost place every modulator at x −320 with `W_MOD`: use `cvModule.modX(kind)` / `modW(kind)` (a
   tapped LFO overlaps the instrument by 96 px until then).
2. `cvTidy` / `cvRoom` copy only `ui: 'flow'`: carry `ui: 'parts'` too.
3. `index.html`'s `#inst` / `#fxrack` are unused homes; `cv-shell-sim` still requires them (with `#boot` inside `#inst`): change the
   sim first, then remove them.
4. `STEPS[6]` reads `cvModule.MOD_W` live: freeze the widths it grows to (a constant in cv-migrate, equal to MOD_W at milestone 3's
   deploy) so a later width change (e.g. B's parity re-measure of chaos, 416 today) never changes what a schema-6 project opens as.
5. `mcMonitor` still rides the primary's part.
6. Host interface from C: `host.devices` part entries carry `dev` as an id string; the power handover is `host.powerEl(key)` → B's
   `View.power`; VOICE's parts view from the device entry's `ui` or `lay[iN].ui`; `firstFree(s, kind, skip)`.

### 9.x Amendments from IMPL-1i §8.3 (the lead, 2026-10-20)

1. **The five-panel reference after 1i**: once 1i is on `canvas` the five panels carry keyboards (≈ 55 % more base texture, 116 → 180 MB).
   `ui-m3b`'s validity scene is **`hw5k`**, judged against its own envelope (recorded at the 1i iPad session as `"ui-1i"`, or within
   `ui-m3b` itself: `hw5k` first and last, drift ≤ 1.0 ms) — never against 1h's `hw5` envelope. S0's phase-0 run is unaffected (1i is not
   on `canvas` then: 1i deploys only after the user's S0 session).
2. **Decision table**: if `hwm-real` fails P+ while `hw5k` alone fails P+ in the same session, the cost is the keyboard faces: 1i's B1
   (banded bases) or option C (a keys shader), re-measured; **D-R5 does not flip for it**. D-R5 flips only when `p1x-real` fails, or
   `hwm-real` fails while `hw5k` passes.
3. **Schedule as it ran**: lane A merged before 1i started (44d1623), so 1i's host lane edits `main.js` / `classic-panel.js` without an
   exception; lanes B and C started from e9cd1b9 before S0 (their work does not depend on S0's numbers; S0 decides D-R5 / H6 / H7 only);
   1i's small `cv-world.js` change (G2) is merged after lane C.
### 9.3 Lane C — canvas widgets, internal routing, H5 (2026-10-20; base e9cd1b9; `sx-edges.js` new, cv-cables / cv-module / cv-mods / cv-tray / cv-world, wk.js, style.css, index.html, sw.js BUILD)

**sx-edges** (pure). ENDs are dev-free `'<part>.<port>'` (`oscA.out`, `filter2.in`, `voice.main|direct|note|out|env1`, `fx.in`,
`arp.out`, an oscillator's read-only `'<osc>.warp'`); `jackOf(dev, end)` / `endOf(dev, jack)` map them to canvas jacks (`i1/oscA.out`,
`i1.main`, `i1/fx.in`). `serumEdges(s, fx)` → `{ id, a, b, kind: audio | note | fx | warp, src, share?, fork?, stub? (b null, label
'→ Filter (off)'), ro?, dim? (source off), env?, field?, what? }`; the warp edges cover every WARPS2 mode reading another part (`_o1 / _o2`,
Noise, Sub, Filter 1 / 2; spectral modes only on a spectral oscillator; S1 mode's v1 field) and ratio pitch sources. `setEdge` /
`cutEdge` → `{ edit(s) | null, why, f: [[path, before, after] …] }` (path e.g. `['osc', 1, 'route']`, `['p', 'b.fbal']`; before = the
effective value, a missing route sx-ui-mix's default) — D's History meta is `f` as it stands. Refusals: `WHY` (voice, ro, fx, self, dir,
note, notes, same, none, bad). Off-route → filter k is exactly `toggleFilterRoute`'s branch (proved); a second filter cable forks at
fbal ½ with both switches on; cutting a fork's branch moves the balance to the other filter; filter → filter sends the other to Main
when it fed this one. `firstFree(s, kind, skip)` (`skip`: the parts already shown); `slotsUsed(s, used)` (point-modulation buses read
their sources through matrix rows, so rows cover them); `partKeys` keeps any part with a `lay` entry (a laid-out part stays, dimmed).
`routeLabel` moved here (cv-cables re-exports it).

**cv-cables.** `cablesOf` adds, per Serum in parts view (`lay[iN].ui === 'parts'`; `opts.parts` false / a function overrides), the
internal cables `{ id: 'x:<dev>:<edge id>', kind: 'audio', int: audio | note | warp, dev, edge: { a, b } (ENDs), a / b jacks, share,
fork, stub, tap: 'open' (warp) }` — editable even under `host.patch: false`; the layer reports `onAction(id, 'disconnect' | 'balance' |
'tap')` (D: `cutEdge` on `c.edge`, the routing popover, the warp / pitch menu); one BALANCE badge per forked source (`forkBadge(jack)`);
a stub is `STUB_PX` (56) long. Own matrix rows from LFO / ENV / MACROS (`opts.ownRows` false disables): mod cables `'o:<dev>:<slot>'`
(`own, dev, slot`), Serum colour; velo / note / random / bus rows stay the Mod list's. Link rows resolve through `modSrcJack`
(`iN/env1.out` → `iN.env1`). A knob end with `hid` (cv-module) gets `.cv-hid` and the badge's third span `.cv-htag` (`hiddenTag(id)`).
Twins are skipped by the mod drag; a jack's `data-dir` (VOICE's inputs) drives press / menu.

**cv-module.** `MOD_W` = { 240 …, lfo 416, env 320, macro 256, chaos 416 } (chaos: a GLOBAL-page column ≈ 388 measured from the grid
rule, not yet from B's `PART_W` — the parity gate re-measures), `modW`, `modX(kind)` (= −⌈(MOD_W + 80) / 32⌉·32), `roundW`, `SX_MODS`
(their height measured; MOD_H stays the guess), `PART_W_DEF` / `PART_H_DEF` (fallbacks until `host.size(key)` gives B's PART_W),
`partJacks(part)`, `voiceJacks()`. Device entries `kind: 'part'` (dev may be the id string); `host.powerEl(key)` → the element for the
bar's power slot (D passes B's `View.power`); the chip defaults to `S<n>`; parts view from the device entry's `ui` or `lay`; a jack-set
change rebuilds the module. Inline jacks: spec `side: 'inline'` (+ fallback `y`), the anchor `[data-jack]` becomes the jack. View
additions: `intPort(jack)` (a cable drag's `port` for internal ends), `partsOf(dev)`, `jacks()` dir from the spec. `V.model` removed
(lane A: it read the track accessor; nothing read it). Macro jacks are inline now and the LFO / ENV / Macro / Chaos modules MOD_W wide
with measured heights: the 2b geometry assertions in cv-module.test were updated to the contract (§2.2).

**H5.** `wk.storeDensity(el, w?, h?)`: in the world max(0.5, dpr·k) (no cap of 2), outside it the dpr capped at 2 (§13.1 kept), the
budget's cap, the 16e6 px cap given a size; remembered per canvas (`storedDensity`). `wk.setStoreCaps(map)`, `CANVAS_BUDGET` = 64 MiB.
cv-world plans at every rest and recache (`planStores`, pure, exported): projected Σ from each store's size over its handed-out
density (no layout read); past the budget off-screen first, then the farthest on-screen (both to the dpr, never below); a changed cap
→ `rescaleCanvases`. `world.canvasStats()` → `{ n, bytes, minDensity, onMin, offN, capped, budget, planned, k, dpr }`. A live canvas
that is not repainting (the OUT scope with the engine off) keeps its last store until its next frame.

**Other.** cv-mods `destOk` refuses every modulator kind with `NOMOD_MOD` (kept rows too). cv-tray `o.parts` (`PART_TILES`) with
`partsEl / partsSec / notesEl / notesSec` (index.html `#srcPartSec #srcParts #srcNoteSec #srcNotes`), `partPick`, `partDrag` (info.part),
`setPartPlaced`. style.css: part modules, members, the power slot, inline / note / warp jacks, internal cables, stubs, forks, hidden
ends, and H6 as one hook (`#world[data-cv-h6="contain"]`, off until S0 picks it). `#inst` / `#fxrack` stay in index.html: lane A's
cv-shell-sim still requires them and `#boot` lives in `#inst`.

**For D.** main's `modSpot` / `modTap` / the drop ghost still place every modulator at x −320 with W_MOD: a tapped LFO (416) overlaps
the instrument by 96 px until they use `cvModule.modX(kind)` / `modW(kind)` (seen in the browser check). Accessor ratchet: cv-module 6
lines (the fixture's tModel and V.model sites go: n 8 → 6), cv-cables 7 (unchanged), the other lane-C files 0.

**Tests.** jackrules 13 (new), cv-cables 37 (+4), cv-module 57 (+5), cv-mods 16 (+1), cv-tray 30 (+2), cv-world 57 (+2), wk 100
(+1; the in-world "capped at 2" assertion now dpr·k); also run green: lint, pwa, main, canvas-sim, canvas-1e / 2a / 2b-sim, cv-shell-sim,
cv-fixes-sim, cv-mods-ui, cv-migrate, cv-graph, cv-panel, cv-face, cv-gl, app.

### 9.5 Lane B — Serum host + panels (2026-10-20; base e9cd1b9; `sx-host.js` / `sx-ui-mod.js` new, serum-ui / sx-ui-osc / sx-ui-mix / sx-ui-seq / graph / cv-mods-ui)

**Lane B (Serum host + panels), 2026-10-20.** `sx-host.js` = SerumUI minus its shell: the state / edit / undo / kit / paint
loop (shown views only, H4) / mod layer / popovers / shape library / browser, now multi-root (`addRoot`, `owns`, `rootOf`,
`viewOf`, `adopt` for the handed-over power toggle) and a view registry (`defineView(kind, make)`, `mount(kind, root, args)` →
View `{ id, kind, root, page, panel, power, shown(), menuItems(), labelDrag(el), destroy() }`). `serum-ui.js` is the shell only
(head / 7 pages / foot are `mount` calls; every public name still exported, bundled DOM identical except H1 / H3).
`sx-ui-mod.js`: the panels (MACROS, ENV, CURVE, LFO, VOICING, chaos row, VOICE + its fold-outs, QUALITY / TUNING / MPE / VOICE
CONTROL, Preferences / Info) as classes, `PART_W` (measured in Chrome from a 1200 px bundled panel: osc 256.6, sub / noise
163.7, filter 218.3, macros 237.3, env 316.4, lfo / curve 395.5, voicing 210.9, chaos / quality / tuning / mpe / vc 389.3,
arp / clip 1184, voice / outputs 535.3), `partView`, `mountPart`, `mountSlot`, `panelDialog`. The slot host:
`slotHost(dev | kind, o)` over a memoised default Serum (LFO → LFO 1, ENV → ENV 2, chaos → chaos 1, macro → macros 1–8).
Additions to the interfaces: `o.storage / notify / view / devKey / doc`; the kit's `under(page, fn)`, `editor`, `bpm`,
`tile`, `sx` and the getters `page` / `uiState` / `opts`; `host.editEnd` (a gesture that ends on its last move value still
closes with one edit); `slotBody` bodies in cv-mods-ui load sx-host / sx-ui-mod on demand (`ready()`, the boot graph
stays lean; the 2b `value()` / `knobs()` kept); `update(v)` also takes `{ v, ph, y, out }` / `{ v, stage, t }`; ClipPage
`o.twins`; `OutputsPanel` in sx-ui-mix; graph `CurveEditor` `links: false`. `wk.storeDensity` is feature-detected (pre-H5
rule without it). Part roots are `flex: none`: a module body narrower than `PART_W` clips the panel, it never re-flows —
until C's `MOD_W` / heights land a 2b-sized LFO module shows its middle. **For D**: call `body.sync()` after undo / redo /
load; wire `o.live` / `o.cancel` / `o.rows` / `o.view`. Counts (Chrome): slot LFO 125–128 el / 2 canvases, ENV 138 / 2,
Macro 127 / 0, Chaos 30 / 0 (≤ 160 / ≤ 2); parts VOICE 433 / 2 (folds closed), OSC 339 / 1, FILTER 139 / 1, NOISE 126 / 1,
SUB 89 / 0. Edited outside the row: tests/canvas-2b-sim (the bodies' async load, the MONO toggle for the old badge, ENV 2's
curve knobs) and the new tests/serum-ui-stubs/dom.js (a selector fake DOM).

### 9.6 Lane D — integration, phase 2 (2026-10-20; base b004627 + ed61ac3 + wt-m3's fixture check 53f119a; `main.js`, `cv-modlayer.js`, `cv-migrate.js` (`MOD_W6`), `index.html`, `serum-ui.js` (one change, below), `tests/canvas-3-sim.test.mjs` (new), main / cv-migrate / cv-shell-sim tests, sw.js BUILD)

**Host records.** `serumPanels` `trackId/dev` → `{ ui (the host; getter `host`), views (Map module key → { V, el, lab }), mode 'bundled' |
'parts', box, el, vals, gen }`. One host per Serum serves both views. **serum-ui.js (lane B's) took the smallest change that makes that
possible**: `new SerumUI(root, host, { parts: true })` builds no shell; `dropShell()` / `buildShell(root)` switch the same host (the head /
page / foot views unmounted, the bundled root dropped, the header's modifier bar and meter destroyed, the preset browser re-homed;
`allPages` / `shownPages` / `rackShown` fall back to the views without a shell; `get bundled`). Why: SerumUI built its shell in the
constructor only, so "the host — panel undo, dirty, view state — survives a switch" had no path; a second host with a transplanted undo
stack was rejected. `sxViews(t, dev)` (idempotent: a part or Serum body mounting, renderCustom — built, or refreshed after undo / redo /
a load) mounts the shell in the box (bundled) or VOICE (`mountPart 'voice'`) in the box and each mounted part body's panel (`mountPart`,
`shown` = the module live, MACROS with `opts.tiles 'jack'`). A Serum's module made again in the same sync (VOICE ↔ whole panel: another
jack set) keeps its element and host (cvUnmountBody); a removed device or another track drops them.

**Modules.** `devices(T)` part entries `{ key, kind: 'part', dev, part, model: 'serum', title }` from `sx-edges partKeys(s, lay, dev,
used)` (`used`: the track's link rows from that Serum); `kindOfKey` → `'part'`; `host.size` (PART_W rounded once sx-ui-mod has loaded,
else cv-module's PART_W_DEF), `host.powerEl` (`View.power`), titles ('OSC B' · Serum; 'Serum · VOICE'), the ⋯ menus of §2.7 (VOICE: Show
parts / Bundle, Add ▸ with ENV / LFO slots "· shaped", Modulation list…, Preferences… / Info…; a part: its panel's module items, Remove,
Bundle), the panels' label drags on the bar titles (`sxLabels`; a mouse drag on the title still moves the module, checked in Chrome).
Monitors: a parts host's subscription is live while any of its views is shown (`anyShown`).

**Show parts / Bundle** (`sxSetView`): one step, `lay` only. The first Show parts lays the group (VOICE, its parts, its own FX) out by
cv-module `tidy`, **its left edge where the bundled module stood, VOICE on its row** — VOICE itself at that place would put the sources over
the modulator column at x < 0 —, and the modules right of it make room (`makeRoom`; never left, never a modulator). `lay[iN]` is shared by
both views: later switches restore the stored places, the whole panel opens at VOICE's place and `cvRoom` makes room. Undo / redo of
either switch views on the same host (canvas-3-sim: the host object and its panel undo across Show parts, Bundle, their undo and redo).

**Places.** A part shown without a place (I1: a preset load, a ⏻ in the bundled panel — `sxPlaceNew` at every render, no step) or added by
a tap (`sxSpot`) takes its column (note tools · sources · filters, or the own ENV / LFO / MACROS stack above VOICE) under its last member; a
column of its own goes between its neighbours on VOICE's row, what stands right of it moving right. Tidy's heights are guesses, so places
written by a rule — and tapped modulators — are settled once the module's panel is built and measured (`sxSettle`: moved clear of what they
cover, no step; the headless-Chrome run showed four quick taps overlapping before it).

**Add / remove** (`sxAddPart` / `sxRemovePart`, VOICE ⋯ → Add ▸, the tray): `firstFree`; the ⏻ written through the host (its panel undo
too); full → the Q3 count, no step; an own ENV / LFO / MACROS something reads is not removable ("LFO 2 modulates 1 knob · its ⋯ → Remove All
Destinations first"); "Show OSC C" (a hidden destination) = a `lay` entry only, no power. Step meta `{ trackId, dev, part, on, f }` —
**`f` added to the contract's meta** so add / remove and canvas cable edits share one write-back (`sxBack`, applied in `applyRestore` after
`keepDevs`): undo writes the before-values while every field holds its after-value, nothing when they already are, else a notice "…
changed since: … left as it is" (redo likewise).

**Cable drag resolver** (§2.5; `modDragOpts.port` = `intPort || port`, `canConnect` = `sxCan`, `onConnect` = `sxConnect`): internal ends
through `setEdge` → one History step labelled 'OSC B → FILTER 2', meta `{ trackId, dev, f }` (sx-edges `f` as it stands), the fields
through the host (its own labelled step), the notice '… · Undo' (History's undo); every other jack refuses with sx-edges' reason ("Serum
sources play through their VOICE"); a mod-out onto a knob stays `modConnect`. `onAction`: disconnect → `cutEdge` (one step), BALANCE → the
source part's routing popover (its panel's route button), a warp cable → the oscillator revealed + WHY.ro; a stub's tap → the routing
popover; menus Balance… / Routing…. Keyboard: today's routing holds (a part root's keydown is its host's panel undo; the canvas → History):
canvas-3-sim proves Cmd-Z after a canvas cable undoes the cable, not the earlier Show parts.

**Own sources** (`sxOwnSrc`: 'iN/lfoK.out', VOICE's 'iN.env1', MACROS' 'iN/macros.kN'): onto its own Serum → `host.addModUI` (a native row:
the Serum's undo, D11); elsewhere → a link row (2b); its macros elsewhere refused ("A Serum's macros modulate that Serum · use a Macro
module"). Own cables ('o:…') open the inspector as matrix slots; bypass / disconnect through the Serum's edit.

**cv-modlayer.** In parts view `presetRows` = every matrix row (own rows `own: true`: tag "Serum", no Keep on canvas) — the Mod list
replaces MATRIX; `host.nativeLabel(dev, src)` names a Serum source; `host.hidden(dev, pid)` → `{ tag, show }` (`modHidden`: cv-module
destPort's `hid`) — the tag in the list and the inspector, "Show OSC C" in its foot.

**Slot hosts.** `modMount` gives `o.live` (`modLive`: `modPre` at the first live change with the record before kept; `setModState` per move;
`N.modsHold`), `o.edit` (the hold released, `modEditState`), `o.cancel` (the record back in place, `modUnstep`), `o.rows` (Bypass / Remove
All Destinations: one step each), `o.view` (`modViews`, by `trackId/key`, never saved), `storage`, `notify`, `devKey`; `body.sync()` after
undo / redo / load is 2b's `cvModSync`. **Meters**: `mcMonitor` is track-level (dev null, role `'none'`: `partsOf` → []; `monitors.deliver`
hands such a subscription any message carrying `mc`); `mcSnap` maps lane E's `mcx` — LFO `{ v, ph: ph[i], y: ph[10 + i], out }`, ENV `{ v,
stage: env[i − 10], t: env[i − 6] }`.

**Column, tray, D-R5.** `modSpot` / the drop ghost / a drop use `modX` / `modW` and measured heights; a drop over an instrument moves left
of it (`modClear`). Tray: `parts: true` with `partPick` / `partDrag` (`sxPartDrop`): a Serum's first free slot (a bundled one shows its
parts in the same step); on a classic track the notice "Serum parts belong to a Serum · Replace with Serum", its tap one step "Replace X
with Serum" (the Serum in parts view + the part); tiles greyed with the Q3 counts (`sxPartsDecor`). D-R5: `SX_VIEW_DEFAULT = 'bundled'`,
pref `synth.cv.sxView`, ⚙ → "New Serums open as" (`#sxView`, built in `initShell`); `setTrackModel` / `addTrack` apply it (`sxModelLay`
also drops an old Serum's part places on a model change).

**§9.4.** 1 done; 2 `cvTidy` / `cvRoom` (and its pin) carry `ui: 'parts'`; 3 cv-shell-sim changed first, then `#inst` / `#fxrack` gone
(`#boot` and the noscript stay in `#cvParts`); 4 `cv-migrate.MOD_W6` frozen (+ a cv-migrate test); 5 done; 6 done (`powerEl` → `View.power`,
`dev` as an id string, `firstFree(s, kind, skip)` with the shown ENV / LFO slots skipped).

**Hook `__synthTest.cv.parts`**: cvParts' own fields stay (`home`, `root`, `scope`, `about`: canvas-sim and accessors read them) plus `show,
add, remove, showPart, rec, list, isParts, connect, can, act, pick, drop, drag, replace, newView, VIEW_DEFAULT, VIEW_PREF, own, hidden,
settle, spot, decor, module, widths, setModule, live, cancel, rowsOps, views, modSpot, modClear, mcSnap, presetRows`.

**Other files.** tests/canvas-1e-sim and canvas-2a-sim: the Serum's ⋯ now lists Show parts (one assertion each). canvas-3-sim runs the real
Serum panels in main-sim's DOM stub, given browser detach semantics (`remove`, a cleared `textContent`, a move into another parent) and an
`ownerDocument` — without them a destroyed view's controls still answered the knob-end walks — and every DSP global null (the fixture
check's lesson); peak RSS 0.71 GB.

**Gates.** canvas-sim 22, canvas-1e-sim 24, canvas-2a-sim 26, canvas-2b-sim 23, cv-shell-sim 16, cv-fixes-sim 5, canvas-3-sim 12 (new),
main 38 (+1), accessors 30, cv-modlayer 12, cv-migrate 43 (+1), lint 131 (the ratchet at its allowlist), pwa 22 (precache rebuilt), serum-ui
60, sx-host 16, m3-fixture 13, app-ios 6, app 11, graph-host 22, keyboard 12, roll 42, presets 2, assets 36, midi 23; the accessor hook over
canvas-3-sim: 0 calls; golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, canonical-stream 1: bit-identical.
Headless Chrome (dpr 2, 1440 × 900 and 1024 × 1366): Show parts / Bundle and their undo / redo on one host; a pointer drag from OSC B's out to
FILTER 2's in on the canvas = one step 'OSC B → FILTER 2' (route 0, b.fbal 1, f2.routeB 1), undone; a stub's tap opens 'OSC B routing'; a
part's title drag moves it ('Move OSC B'); LFO / ENV / Macro / Chaos tapped at x −512 / −416 / −352 / −512 (416 / 320 / 256 / 416 wide),
none over VOICE, clear of each other once settled; `canvasStats` minDensity 0.99; no console errors.

**Open.** "Open UNISON" for a hidden unison destination is not built (it offers the oscillator, revealed); four modulators tapped in one go
settle clear of each other but not in MOD_ORDER; the ui-bench real scenes `p1x-real` / `hwm-real` wait for the S0 builder's file.

### 9.7 Fixes (review 1) (2026-10-20; fixer A; base 2ef9997; failing test first for each; F6 and note F7 left as they are, the lead's call)

| # | finding | fix | test |
|---|---|---|---|
| F1 (P1) | the one host kept every view set it ever mounted: per-view disposers on the host's `offs` / `sats` (`tileDrag`, `moduleDrag`, `adopt`, serum-ui `rowDrag`), freed only at host destroy (≈ 10.7 MB per Show parts / Bundle) | each View has its own `offs` / `sats`; `viewNow()` = the page being built's view (a lazy build under its page counts), `offNow()` pushes there (else the host's); `labelDrag` registers under its view's page; `unmount(V)` runs `V.offs` and releases `V.sats` (one another live view also adopted stays); `dropShell` unmounts the shell views, so it runs them too; `destroy` runs every view's | sx-host "review 1 F1" (mount / destroy cycles: offs / sats level); canvas-3-sim "F1" (4 Show parts / Bundle cycles through main: offs / sats level). Reviewer's probes: p8b offs 1 → 1, sats 0 → 0; p8-leak (switch, `--expose-gc`) heap 67.1 → 68.1 MB over 50 switches (was 173.6 → 707.5) |
| F2 (P1) | preset browsing in parts view piled modules up (17 for a 2-part preset) | the lead's rule, §3's amendment: `sxPlaceNew` and the first Show parts' group (`sxLayParts`, not the part being added) write `auto: 1`; `song.normLay`, Tidy, `cvRoom` / front / pin writes and the no-step settles keep it; a move / group move / fold (cvLay), `sxAddPart` (Add ▸, the tray), Show OSC C write the user's place. `sxPruneAuto(t, dev)` — automatic entries whose part `partKeys(s, null, …)` no longer wants — runs in `sxLoad` (browser, ◀ ▶, program change) and in `sxEdit` for a seeded edit (Init Preset, Hybridize, the panel's undo / redo of a load), in either view, no step. Found on the way: `cvPinned` (and cv-module's `'pin'` writes) re-pinned a just-pruned part's stale module without the mark — a part is never pinned now (its place is always written before its module exists) | canvas-3-sim "F2": all 86 factory presets in parts view → Laser Drop's 2 parts + the OSC B the user moved (dimmed), no step; the panel undo of the last load → that preset's parts + OSC B. Probe p5 (c): 2 modules (was 17). Heap over two passes of all 86 loads flat (68–86 MB) |
| F3 (P2) | cable → Cmd-Z in the Serum → top ↶ undid Show parts while labelled the cable | `History` (song.js) never skips a step carrying `meta` as a no-op (undo, redo, `canUndoFrom` / `canRedoFrom`): what such a step did lives partly outside the snapshot (its Serum fields, written back from meta), so the ↶ that names it takes it alone; `hist.noop` says it changed nothing History holds, and `sxBackApply` then says "OSC B → FILTER 2 was already undone in Serum" (redone likewise). The smaller fix than a main-side pre-check of the top step (which would serialise the project per ↶ and reach into History's stacks); only meta steps (canvas cables, add / remove part, Save with preset / Keep on canvas) are affected, and their write-backs already handle "already so" | cv-migrate "3 (review 1)" (History unit: a no-op meta step taken alone, noop; without meta skipped as before); canvas-3-sim "F3" (↶ consumes the cable step, the view stays parts, the label then Show parts; ↷ writes the cable; a plain ↶ writes it back). Probe p11 passes |
| F4 (P2) | an LFO read only by a row without a destination: a module (I2) Remove could not remove (a no-op step) | one rule — a row with no destination reads nothing: sx-edges `slotsUsed` skips rows without `dst` (so I2 / `partKeys`, `firstFree`, Add ▸ agree), and `sxRemovePart` refuses exactly when `slotsUsed(s, sxUsed(t, dev))` has the part (`sxReads` only counts for the message; both need a `dst`). Why not "refuse with the reason": the row modulates nothing, and the advice "Remove All Destinations" is disabled for it (srcDestItems counts rows with a `dst`) | jackrules partKeys test (dst-less src / aux / macro rows: no slot, no module, free for `firstFree`); canvas-3-sim "F4" (no module; Add ▸ LFO n then Remove: one step each, gone). Probe p5 (b) now fails on its premise only ("LFO 4 has a module") |
| F5 (P2) | "Replace with Serum" acted on whatever track was selected when tapped | the offer captures the track id and its instrument; tapped once another track (or instrument) is selected, it only goes | canvas-3-sim "F5" (offered on a Juno-60 track, tapped on a Prophet-5 track: nothing replaced, no step; offered and tapped on the same track: replaced, one step). Probe p9 passes |

**Gates** (each file alone): canvas-3-sim 17 (+5; peak RSS 1.4 GB, was 0.71: the 86-preset browse mounts panels per load — heap after GC flat), sx-host 17 (+1), serum-ui 60, m3-fixture 13, main 38,
canvas-sim 22, canvas-1e-sim 24, canvas-2a-sim 26, canvas-2b-sim 23, cv-shell-sim 16, cv-fixes-sim 5, jackrules 13, cv-cables 37, cv-module 57,
cv-migrate 44 (+1, the song.js test: there is no song.test file), cv-modlayer 12, accessors 30, appstore 25, lint 131, pwa 22 (precache
rebuilt); golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, canonical-stream 1: bit-identical. Reviewer 1's
probes on this tree: p8b, p9, p11 pass; p5 (a) (c) (d) pass, (b) as above; p7-walk seeds 7 / 29 / 101 pass.

### 9.8 Fixes (review 2) (2026-10-20; fixer B; base 13bb225; a failing node test first wherever one can express it; each visual / interaction fix checked before and after with reviewer 2's headless-Chrome scripts, dpr 2)

| # | finding | fix | test · Chrome |
|---|---|---|---|
| P1-1 | one touch tap on an internal cable disconnected it (the × appeared under the finger, the tap's own click hit it) | cv-cables: a touch / pen tap that selects arms `ghost`; the ×'s click drops the next click until a new press (the selecting tap's compatibility click); a mouse tap is unchanged (its click targets the common ancestor); mod cables unchanged (no ×) | cv-cables "review 2 P1-1"; ghost.mjs: route stays 0, no step (was "Disconnect OSC A → FILTER 1"); the mod cable unchanged |
| P1-2 | a part mounted off screen was never painted until an edit (empty MACROS names, two filter menus, Rename, blank displays, an empty LFO grid; also after a reload with the engine off) | sx-host: every View is `stale` at mount and whenever a paint skips it hidden; a paint that finds a stale view shown is a full one; `host.reshow()` queues one; main's `sxReshow` calls it from cv-module's host.shown (a module on screen, unfolded) and when the CANVAS tab shows | sx-host "review 2 P1-2" (mounted hidden → shown → painted; hidden through an edit → shown → the edit); canvas-3-sim "P1-2" (a module off screen, an edit, on screen: painted, engine off); x6.mjs: names, one type menu + MAIN, OSC B's MAIN (no Rename), the displays drawn; stale.mjs: the LFO grid "8" after the fit with the engine off |
| P1-3 | ui-bench `?m3=1` broken | fixed in the base (21b47ef, the real scenes too) | `?m3=1` and `?m3=1&real=1` run end to end here (below) |
| P1-4 | a modulator dropped just above an instrument covered it (the OB-Xa face left GL); a drop over the instrument landed on another modulator | main `modHt(kind)`: the measured height of a module of the kind on the canvas, else the last measured, else Chrome's at 1200 px (`MOD_H_SX`: LFO 451, ENV 371, Macro 250, Chaos 135; cv-module's `MOD_H` stays Tidy's guess) — in `modSpot`, `modClear`, the drop ghost and the drop; `modClear` moves left of an instrument, then below whatever it would cover (one column); drops settle (`sxFresh`) as taps | canvas-3-sim "P1-4" (a measured 451 vs the 256 guess; onto VOICE at the column's height: clear of every module; a tile drop settles clear); x12.mjs: the LFO at (−512, −288), face gl, glFaces 1 (was over the face, dom, 0); hw.mjs at 3 sizes: no overlap, face gl |
| P1-5 | a stub's tap opened and closed its routing popover in one tap; at k ≤ 0.5 the out jack covered the stub | cv-cables tells `onSelect(id, pointerType)` for a tap; main opens a stub's routing after the tap's click (`afterTap`: the window's capture click → a 0 ms timer, else 600 ms) — inside the tap the world still holds its gesture and takes a synthetic click (cv-world `onClickCap`); a selection without a tap opens at once. A stub keeps `STUB_PX` screen px below k 1, at most `STUB_MAX` 136 world px (Tidy's GAP 160), re-laid at a zoom's end | cv-cables "P1-5" (k 0.4 / 0.5 / 2, the pointer type); canvas-3-sim "P1-5" (nothing inside the tap; open after its click; at once without one); x10b.mjs mouse and touch at k 1 and 0.4: "OSC B routing", route 0; x9.mjs at 0.4: the hit is the cable; taps.mjs: stub and BAL by touch open "OSC B routing" |
| P1-6 | the default Serum as parts: OSC A looked unconnected (FILTER 1 off, no module) | the lead's decision — cv-cables `internal()`: a source's edge into a filter that is off with no `lay` entry is a dimmed stub "→ Filter 1 (off)" (`off: 'filter'`, its id and edge kept: Disconnect cuts the route); main: its tap opens the source's routing and the offer "FILTER 1 is off · tap to turn it on" (`sxOffOffer` → Add FILTER 1: module, ⏻, the cable into it — one step, bound to the track); its menu Routing…, Turn FILTER 1 on | cv-cables "P1-6"; canvas-3-sim "P1-6" (offer → one step, undo → the stub and its menu again); x13b.mjs (touch): the dimmed stub, "OSC A routing" + the offer, its tap → "Add FILTER 1", the cable into it (`shots/p16-*.png`) |
| P1-7 | the hidden-destination tag covered FILTER 1's bar (its ⋯ unreachable) | a hidden destination ends at VOICE's top-left corner (cv-module, was its bar's middle); its tagged badge sits right of the end and above the bar (CSS `.cv-mbadge.cv-hid`), several stacking upwards (`HID_STEP` 22 screen px) — never left of the end, where Tidy puts FILTER 1 | cv-cables "P1-7", canvas-3-sim "P1-7", cv-module's hidden-end expectation updated (the corner); hidden.mjs: badge 660–811 × 179–197 above VOICE, FILTER 1's ⋯ hit = `cv-more` (was `cv-mbadge`); "Show OSC C" as before |
| P2 parity | 93.6–99.7 % within 8/255: text rastered at other sub-pixel origins | sx-ui-mod `PART_W` to the layout unit (1/64 px, the part root's width exact: 256.65625 for 256.6 …) and `PART_PH` (each panel body's world offset mod 1 px in the bundled panel); sx-host `alignPhase` moves a part's / canvas modulator's panel (relative, < 1 px) to that phase when the view shows (VOICE: VOICING and ENV 1 apart) — the world layer rasters text at each element's own fractional origin | sx-host "review 2 P2 parity"; parity.mjs bodies (≤ 8/255, k 1, dpr 2): OSC A 99.994, OSC B 99.940, OSC C 99.983, SUB 99.963, NOISE 99.928, FILTER 1 / 2 99.642, MACROS 99.868, ENV 1 100, ENV 2 100, LFO 1 99.827, VOICING 99.568; canvas LFO 98.887 (its MONO lit: the canvas default GLOBAL; 99.928 at MONO off, the same state), ENV 99.393, Macro 99.642, Chaos 99.820 (its one row against the GLOBAL page's two-row panel); knob diameters and `--wk-d` equal |
| P2 density | `canvasStats().onMin` 0.99 (the border box; stores rounded down) | cv-world `canvasStats` measures the content box both ways; wk `fitCanvas`, sx-host's displays and sx-ui-seq's lanes round stores up (identical at k 1) | cv-world "review 2 P2" (a bordered canvas 1:1; k 0.4: 159 × 119, ≥ 1); dens.mjs (Serum fully opened + 4 modulators, VOICE / column / FX centred): onMin 1 at k 0.25 / 0.5 / 1 / 1.5 / 2 |
| P2 ENV playhead | a canvas ENV cabled to a Serum knob never moved its playhead (injected into the Serum's ENV slot: no ModCore slot) | main `sxInjEnv(t)` (per payload, from cv-graph `injectMods().inj`, also when the payload is off) and `sxInjSnap` on the Serum's own snapshot: the body takes that slot's stage / time / level; the Serum's subscription stays live while such an ENV is on screen | canvas-3-sim "P2 ENV" (also with the payload off); envph.mjs, engine on, held note: stage 0 → 3 (t 0.13 … 0.89) → 4, bundled and parts |
| P2 places | a tray part dropped on VOICE overlapped it; after a preset load OSC C above OSC B, FILTER 2 above FILTER 1 | `sxSettle` settles a batch together once every panel is up, top to bottom (the stack above VOICE bottom to top), each clear of what stands and of the members settled before it (a member covering the next one used to move below it); a part tile dropped on a module lands below it (`sxDropClear`; above for the stack) and settles | canvas-3-sim "P2 places" (heights taller than the guesses: A · B · C, 1 · 2, no overlap; a drop on VOICE clear); preset.mjs "Drift Machine": OSC A 0 · B 768 · C 1536, FILTER 1 0 · 2 512, no overlap; tray.mjs: FILTER dropped on VOICE at (608, 992), no overlap |
| P2 small | no GLOBAL / PER NOTE badge; the canvas Chaos without "CHAOS 1", MONO on | `cvBadge`: an LFO's GLOBAL / PER NOTE (a canvas LFO's record, an own LFO part's slot), a neutral `tone: 'mode'` badge (cv-module `setBadge(text, tone)`); `ChaosRow` keeps its label in a slot host ("CHAOS <n>", the module's number); cv-model `addModDev`: a new Chaos starts at Serum's own chaos row (MONO, S&H off) — records without the fields keep MONO on (fixtures, goldens unchanged). Note: a new Chaos is now PER NOTE, so its cables draw dashed ("follows the most recent note") until MONO is on — **the lead kept the GLOBAL default** (mono 1, like a canvas LFO: a per-note chaos on a classic knob would restart at every note) | canvas-3-sim "P2 badge"; sx-host chaos (label, "CHAOS 2" for h2); cv-model 2b defaults |
| MACROS names | "acro 1": 45–48 px names in 26 px, clipped at both ends (the whole panel too) | sx-host CSS: `.sx-macro` padding 4 px 2 px, its tile 2 px 1 px at 9.5 px; the label shrinks with an ellipsis; the destination count on the tile's corner — everywhere (whole panel, part, canvas Macro) | macroclip.mjs: 36–38 px in 42 px (was 45–48 in 26), "Brightness" → "Bright…"; regress.mjs vs canvas HEAD: OSC 99.769 %, MIX 99.765 %, FX 99.721 % — only the MACROS tiles —; MATRIX, ARP, CLIP, GLOBAL 100 % |
| left | the panel label drag (swap / copy) from a part's title on the canvas | as it is (the lead's call): ⋯ → Swap with ▸ / Copy work | — |

**Gates** (each file alone): canvas-3-sim 25 (+8; peak RSS 1.29 GB), sx-host 19 (+2), serum-ui 60, sx-ui-osc 52, sx-ui-mix 17, sx-ui-seq 51,
m3-fixture 13, cv-cables 41 (+4), cv-module 57, cv-world 58 (+1), wk 100, main 38, canvas-sim 22, canvas-1e-sim 24, canvas-2a-sim 26, canvas-2b-sim 23,
cv-shell-sim 16, cv-fixes-sim 5, cv-mods-ui 12, cv-mods 16, cv-tray 30, cv-model 8, cv-migrate 44, cv-modlayer 12, jackrules 13, accessors 30,
graph-host 22, lint 131, pwa 22 (precache rebuilt); golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, canonical-stream 1:
bit-identical. Headless Chrome: reviewer 2's life / cables / tray / hw / touch at 1440 × 900, 1366 × 1024 and 1024 × 1366, x6, x9, x10, x12, ghost,
taps, stale, hidden, preset, parity, regress, macroclip: no console error or warning. budget.mjs: Serum (complete) 705 / 4, fully opened 2557 / 16,
LFO 120 / 2, ENV 126 / 2, Macro 103 / 0, Chaos 35 / 0; onMin 1 at every k. ui-bench (reviewer 2's bench-all, headless, dpr 2): `?m3=1` end to end —
auto / hand / hold, 8 scenes, every self-check ok, hw5 first and last, 0 page errors; `?m3=1&real=1` end to end — hw5 → p1x-real (3277 painted, 26
canvases) → hwm-real (5456 / 9) → hw5, self-checks ok, one build, 0 page errors (Mac headless timings informational only).

## 10. Review log (revision 2, 2026-10-19: the contract review, 25 points)

All 25 points were checked against the code (and the review's "checked and confirmed" items, Chaos compile and the ENV slot round
trip, hold). Accepted unless marked.

| # | point | where it went |
|---|---|---|
| 1 | `bare` deleted the panels' own head controls; the parity exclusion hid it | §2.3 `bare` keeps a head row (OSC / SUB / NOISE / FILTER / ENV controls listed); §7 excludes only the removed chrome |
| 2 | "identical look by construction" false (`sx` width queries → 28 px knobs) | §2.3 container rule (`sxp`, restated column rules); §7 parity covers parts too |
| 3 | slot-host edit path broke undo, macros, phase-less edits, throttle | §2.3: `modPre` at the first live change, `cancel`, `o.set` → `modVal`, one step per menu edit, none for view / grid edits, `N.modsHold` |
| 4 | S0 could not produce a valid run | §1.5: everything frozen in `?hold=1` (+ masks), ENV / LFO built into `headPage`, self-check, H5 shim, real audio / `smon` / cables |
| 5 | pass criteria would not catch the hitch; no hardware + modulators scene | §1.5: P+ with no burst frame > 33 ms for default-on, P for opt-in only; `hwm` + its rows; `hw5` first and last |
| 6 | D-R1 vs R1 / R3 unless Q1 blocks; no branch for `ui-m3b` failing | §1.3 D-R1 provisional on Q1 (asked at the S0 session), D-R3 "no" → 3R before phase 2, D-R5 runtime pref; §1.5 table rows |
| 7 | grown modulators overlap instruments, faces leave GL | §2.2 left-growing column (per-kind widths in `modSpot` / `modTap` / ghost, `STEPS[6]` moves); §7 no-overlap gate |
| 8 | R1 flips "null `dvOf` means primary" | §4.3 R1 lists all ten `dvOf(` sites + `renderLast`'s legacy branch; R0 tests `sxSave` phases and the primary's resample bytes |
| 9 | ratchet at zero infeasible | §4.1 / §4.3: ends at an allowlist; N5 by the dynamic hook + `'model' in t === false` |
| 10 | stray `t.model = …` after R7 | §4.3 R7 throwing guard accessors in sims / dev for one stage |
| 11 | lane D overloaded | R6 / R7 in lane A, phase 1; phase 2 starts accessor-free (§4.3, §6) |
| 12 | H5 ownership, `storeDpr` missed, unbounded memory | §1.4 H5: one `wk.storeDensity` (C) called by B's `paintCanvas` / `storeDpr`; total 64 MB cap, off-screen to `dpr` first |
| 13 | CLIP's MACROS pane duplicates `m1`–`m8`; ARP item misdirected | §2.2 CLIP pane kept as twins (`data-twin`); ARP = `ArpPage` alone; lane B's sx-ui-seq item corrected |
| 14 | part power loses its destination | §2.2 the panel's own `dToggle` in the bar slot (`data-dest="x.on"`) |
| 15 | I2 inflates parts beyond the budgets | §2.4 I2 = read by a row, link or point bus; H3 lazy PATH editor; §1.4 worst-factory-preset budget line |
| 16 | cable ends with no module; `/` in link sources | §2.4 hidden-destination ends at VOICE with a tag; §2.5 `modSrcPort` part keys, `iN/env1.out` → VOICE `env1` |
| 17 | undo routing after a cable drag; undo of Show parts vs `sxDrop` | §2.5: canvas cable edits are History steps with write-back (Q4's default changed to agree with D12) + keyboard routing; §2.4 undo of Show parts keeps the host; both in `canvas-3-sim` |
| 18 | slot-host options incomplete | §2.3 `lock`, `wt2lfo`, `osc`, `learn`, `nameMax`, `tiles`, `srcItems` (rows ops), the allowed-differences list |
| 19 | parity gate ill-defined | §2.2 panel at its bundled column width inside the module; §7 compares with the actual 1200 px bundled rendering |
| 20 | lane interface gaps | §6: `cv-mods.js` → lane C; `devices(T)` part entries; `data-jack` / `data-twin` / `View.power` |
| 21 | R0 misses `synth.v.<model>` | §4.2 row + R0 test + R6 |
| 22 | monitor fields not literally "off unless subscribed"; lane E's engine side unnamed | §2.9 written and posted only subscribed (`MC.live` untouched); the no-part subscription in lane E |
| 23 | Velocity / Note counterparts; visible removals; mod-of-mod | §8 Q5 + "things you will notice"; §2.3 allowed differences |
| 24 | two key schemes | §4.3: track id for the primary through R3, `trackId/dev` for all from R4 (one commit, maps re-keyed) |
| 25 | pause live repaints in bursts if M1 fails | §1.4 H7 (conditional), measured as M2 `still` |

Partly not taken: in point 9, the review's per-file counts are not restated as facts (the static regex counts depend on the
pattern; the allowlist records each kept line with its reason instead). In point 5, `hwm` uses `hw5`'s five panels rather than one to
three: it is the case with a known envelope to compare against, and heavier than any real one-instrument hardware track.
