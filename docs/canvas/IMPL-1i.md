# Stage 1i: hardware keyboards (IMPL-1i) — contract

The user, 2026-10-20: "we should have the full functional keyboards on our hardware synths". Their answers: velocity "where you
touch the key" (front edge = loud, toward the back = soft); the real performance controls "yes, all working" (pitch / mod wheels,
bender levers, the CS-80 ribbon, …); "hardware layout only" (Simple stays compact); the bottom keyboard tray stays; two fingers on
keys are notes (a music zone), not a pinch. The rendering rules of 2026-10-19 hold (GPU faces never below 1:1 at rest, nothing
"renders in" at a zoom end) and so does the 1f lesson (the panels get bigger: measure).

**Revision 2 (2026-10-20)**: the skeptic review against e9cd1b9 folded in — S1 dropped (its premise was false), two gesture fixes
(G1 controllers, G2 a resting finger), the TB-303 audition's root and NaN guard, key hit tolerance, unrounded bed geometry, the
validator's shared tokens, the `hw5k` reference, a separable early-ship schedule; §12 logs every point and the ones rejected.

Design: [IMPL-panels.md](IMPL-panels.md) (the layout format, 2 px/mm, sizes on the 32 px grid, extras, aux plates) — **this file
supersedes its R3 ("the keyboard and the wheels/levers are never drawn"), §10's "keyboard and wheels not drawn" and §12 decision 2
(aux plates on an 8 mm seam)**; [IMPL-1h.md](IMPL-1h.md) (GPU faces: base + window textures, budgets, the overlap rule);
[IMPL-3.md](IMPL-3.md) §6 (the milestone-3 lanes this stage builds around; §8.3 below amends it); [ROADMAP.md](ROADMAP.md) row 1i
and the feedback rows (they win). Input: the mapper's report `scratchpad/1i/map.md` (cited **MAP §n**: the instruments with sources
§1 / §7, the engine §2, the code map §3, the rendering options §4); the size estimates below come from `scratchpad/1i/plan-sizes.mjs`
(the planned areas run through today's `cv-panel.geometry`); the review's reproductions are `scratchpad/1i/skeptic/s1.test.mjs` and
`perf2.test.mjs` (the real gesture.js and cv-world.js on the fake DOM). Sections 1–7 are the contract, §8 the lanes and the schedule,
§9 the gates, §10 the questions for the user, §11 the builders' notes, §12 the review log.

**Invariants of the stage**
- **I1 Sound**: no DSP, compile or `models.js` change. Every golden shard, `golden-graph`, `canonical-stream` (fixture untouched),
  the cp2 / ct2 / 2b fixtures stay bit-identical. The golden harness already sends bend, wheel and aftertouch moves
  (`tests/golden-harness.mjs` 195–198), so bend stays ±2 st (`bendRange` 2) on every model and every controller drives today's
  `bend` / `wheel` / `at` paths (§5.3). The TB-303's `seq` payload keeps `root: 48` (now the named `SEQ_ROOT`, §6.4).
- **I2 One note path**: a hardware key is the on-screen keyboard (`noteOn(n, v, 0, ts)` / `noteOff`), a hardware controller is the
  tray's wheel (`ctl(kind, v, 0)`). Recording, held notes, MIDI out, the Velocity / Note / Mod Wheel / Aftertouch / Bend modules,
  the tray key lights: unchanged code, reached the same way. No new worklet message, no new per-track entry point.
- **I3 Rendering**: keys and controller art are part of the hardware face (the GL texture of 1h): exact mid-pinch and at rest, ≥ 1:1
  at rest to k = 1 on a dpr-2 screen for every model (above dpr 2: the recorded exemption of §3.3). The DOM adds only hit areas and
  moving parts drawn as flat shapes (§3).
- **I4 Hardware layout only**: the Simple layout, the bottom tray, the project format (no schema bump), History and the Sources tray
  are unchanged. Playing never makes a History step.
- **I5 Lanes**: the keys lanes (K1, K2) touch no file a milestone-3 lane owns and stay off `canvas` until the user's S0 iPad session;
  the host lane (H) runs after that session (schedule A, recommended) or at phase 1.5 (schedule B), §8. 1i lands on `canvas` as **one
  separable commit**.

## 1. The instruments

### 1.1 Common rules

- **The bed is fixed, like the instrument's**: real key count, real lowest key, a fixed MIDI note per key (table §1.2). The tray's
  Oct buttons do not move it; transposition comes from each instrument's own controls where we emulate them (Minimoog RANGE,
  Juno-60 OCTAVE TRANSPOSE `rg`, DX7 TRANSPOSE `tr`, …). 61-key C…C = 36…96 (C2–C7, C4 = 60), 49-key = 36…84, so middle C is the
  same key on every synth.
- **Key geometry** (research mm; `cv-keys.js` maths, §4.1): white pitch `pitch` = bed width / white keys (23.5 measured on every
  61-key bed; Jupiter-8 **834 / 36 = 23.1667** — write the division: 36 × 23.17 = 834.12 overruns the 834 mm area and the validator's
  1e-6 tolerance; Minimoog ≈ 23 and MS-20 ≈ 22 derived), visible white length `len` (back edge at the felt → front edge), black width
  `0.583 · pitch` (13.7 at 23.5), black visible length `0.62 · len`, white gap 0.6 mm. **Black keys sit at their real offsets**, not
  on the white boundaries: centres at 0.900, 2.100, 3.857, 5.000, 6.143 white pitches from the octave's C (C♯ D♯ F♯ G♯ A♯; the "equal
  top widths" layout: C–E in fifths of 3 pitches, F–B in sevenths of 4). The **hit** geometry is wider than the art at fit zoom (black
  keys) and reaches a little past the front edge (§4.1); the art never changes.
- **Where the instrument's keyboard is a separate case** (ARP 2600 + 3620, Moog System 55 + 951): **one module**, the keyboard's
  case drawn below the console with a 16 mm gap of case colour, left edges aligned — the real setup on a table, read as one
  instrument. Not a separate canvas module: that needs a module kind, a key in `lay`, Tidy rules and a CV cable type in lane C's
  files (cv-module, cv-cables) and is milestone-4 / stage-9 material (stage 9 takes the modular apart anyway).
- **Plates beside the keys** become full-depth blocks at their real place (no 8 mm seam): the Minimoog left-hand controller, the
  CS-80 left cheek, the Prophet-5 wheel block, the OB-Xa modulation panel, the Jupiter-8 performance panel, the Juno-60 bender
  panel, the DX7 and MS-20 wheel blocks, the 951 / 3620 end plates. Their controls we emulate stay live where they are; the rest are
  drawn inert ("not emulated", dimmed), as today.
- **Felt, key slot, cheeks, lip** are ordinary decor (`rect`) drawn by the author around the bed; they are panel art (backgrounds:
  a finger there pans), except the **front band** (§4.1: up to 8 mm of the lip / rail in front of the keys is part of the keys' hit
  box). K2 draws each bed's front lip / rail at its measured depth.
- **Measured by the data lane (K2)** where the research has no number (MAP §1.4): wheel / lever / ribbon / pad rectangles, the DX7
  and MS-20 wheel blocks, the ARP 3620 case, the Minimoog plate width, each bed's front lip. From the crops in
  `scratchpad/canvas/panels/research/crops` and the photo files each research JSON lists (fetched into the scratchpad); each
  measurement and its source goes into the layout's `notes`. Default sizes when a photo is not readable: wheel window 22 × 64 mm,
  lever slot 16 × 52 mm, pad 30 × 22 mm, lip 10 mm.
- **Decided here, not by a photo**: the ARP 3620 gets **no pitch control** (the ±1 oct bend in MAP §1 is the 2020 reissue's spec; no
  1970s source establishes one, and we do not invent controls: the tray's bend wheel bends the ARP as today). The Moog 951 is **61
  keys C…C, 36–96** (a secondary source's "five octaves"; recorded as such in the layout's `notes`; stage 9 replaces this instrument).

### 1.2 Per synth

Areas: `src` in the layout's research frame (mm) → `at` in content mm (IMPL-panels §3.3); "offset −n" = the area's `at − src` in y,
named after the existing area it matches. Sizes: module outer px (bar included), today → 1i, ± one dot until K2 pins them (`plan-sizes.mjs`).

| model | bed (MIDI) | key dims (mm) | areas added / changed | controllers (live) | plate controls (live / inert) | extras | size px |
|---|---|---|---|---|---|---|---|
| **modular** (do it last, thin: stage 9 replaces it) | 951: 61 C…C, 36–96 (decided, §1.1) | 23.5 / 150 | `keys` [219, 458, 846, 150] → [219, 405.1] right of the existing `kbd` plate; `case951` [0, 450, 1087, 166] → [0, 397.1] (the 951's case: the module's `case: 'wood'` fills it) | none (the 951 has none) | `gl` PORTAMENTO live (as today); SCALE, RANGE, GLIDE inert | `kb` → the default strip below (its `at` sat in the bed's band) | 1728 × 960 → **2176 × 1280** |
| **minimoog** | 44 F…C, 29–72 | ≈ 23 / 150 | `lefthand` → [0, 192, 98.7, 150] (full depth; offset −7.8 kept); `keys` [98.7, 192, 598, 150] → [98.7, 184.2] | PITCH wheel (`perf:bend`, left), MOD wheel (`perf:mod`, right) in front of the rockers | `dk` DECAY live; GLIDE inert | none | 1408 × 512 → **1408 × 736** |
| **arp2600** | 3620: 49 C…C, 36–84 | 23.5 / 150 | `kb3620` [0, 500, 914, 182] → [0, 414] (its own frame: a 24 mm rear strip, the left control block, 29 whites) | **none** (decided, §1.1) | `gl` PORTAMENTO **moves from the extras to its 3620 slider, live**; the rest of the block inert | `sy kb lw src` (strip below, `gl` gone) | 1568 × 928 → **1856 × 1344** |
| **solina** | 49 C…C, 36–84 | 23.55 / 143 | `keys` [213, 240, 683, 143] → [213, 55] (offset −185 of `main`); `modulation` → [896, 240, 61, 143] → [896, 55] (its real depth) | none (the original has none) | `en` live (as today) | `tn` → `at` [8, 63, 197, 42] (the empty cabinet left of the keys) | 1984 × 256 → **1984 × 448** |
| **cs80** | 61 C…C, 36–96 | 23.5 / ≈ 165 (the 175 mm bed incl. the lip: the lip is decor + the front band, K2 measures) | `keys` [232, 465, 846, 175] → [232, 298]; `left` → [22, 465, 204, 175] → [22, 298]; `right` [1078, 465, 105, 175] → [1078, 298] (art); offset −167 = the `name` strip's (no collapse between ribbon and keys) | RIBBON (`perf:bend`, kind `ribbon`, research x 232 y 437 w 490 h 12, hit [490, 16]: replaces today's inert `strig`) | left cheek: `gl` live; FOOT selector, SUSTAIN inert | none | 2432 × 768 → **2432 × 1024** |
| **prophet5** | 61 C…C, 36–96 | 23.5 / 156 | `keys` [95, 250, 845, 156] → same; `wheels` [12.5, 250, 82.5, 150] → same (offset 0) | PITCH wheel (`perf:bend`), MOD wheel (`perf:mod`) | — | `li ud rev` stay at `at` [20, 191, 200, 40] (the wood strip above the bed: no overlap) | 1920 × 512 → **1920 × 864** |
| **ms20** | 37 C…C, 48–84 | ≈ 22 / 130 (derived) | `wheel` [0, 193, 55, 130] → same; `keys` [55, 193, 484, 130] → same (a frame continuing below the face, 8 mm hinge gap) | CONTROL WHEEL (`perf:bend`, centre click drawn) | MOMENTARY SWITCH inert | none | 1120 × 448 → **1120 × 704** |
| **tb303** | its 13 key cells (no bed) | — | none | none | `seq:key` cells also **sound** (§6.4) | unchanged | 608 × 608 (unchanged) |
| **obxa** | 61 C…C, 36–96 | 23.5 / 175 | `keys` [142, 333, 846, 175] → same; `modpanel` [28, 333, 114, 137] → same; `cheekL` / `cheekR` extended to y 508 | MODULATION lever (`perf:mod`), PITCH BEND lever (`perf:bend`), both front–back paddles | RATE, DEPTH, OSC 1 / OSC 2, OSC 2 ONLY, NARROW, TRANSPOSE DOWN / UP, LOWER / UPPER inert | `lc ud` stay at `at` [34, 291, 200, 40] (the badge strip above the bed) | 2048 × 576 → **2048 × 928** |
| **jupiter8** | 61 C…C, 36–96 | 834 / 36 / ≈ 176 (the 186 mm bed incl. the rail, as the CS-80) | `keys` [190.6, 299, 834, 186] → [190.6, 256.5]; `performance` → [9.7, 299, 179.4, 126.5] → [9.7, 256.5] (full height; offset −42.5 = `main`'s) | BENDER lever (`perf:bend`, left–right), LFO MODULATION pad (`perf:mod`, kind `pad`) | `gl` PORTAMENTO live; BEND VCO-1 / VCO-2 / VCF switches, the two bend sliders, LFO MOD sliders / RISE TIME, UPPER ONLY / OFF / ON inert | `pw` → `at` [200, 215, 340, 40] (the 42 mm band between the plate and the keys) | 2144 × 608 → **2144 × 928** |
| **juno60** | 61 C…C, 36–96 | 23.5 / 174 | `keys` [186, 204, 846, 174] → [186, 155]; `bender` → [32, 204, 150, 174] → [32, 155] (offset −49 = `main`'s; `rg` lands at its real place) | BENDER lever (`perf:bend`, left–right) | `rg` OCTAVE TRANSPOSE live; LFO TRIG inert | `hs` → the default strip below (no free band) | 2144 × 416 → **2144 × 800** |
| **dx7** | 61 C…C, 36–96 | 23.5 / 157 (derived) | `wheels` [0, 172, 150, 157] → same; `keys` [150, 172, 846, 157] → same (K2 measures the split) | PITCH BEND wheel (`perf:bend`), MODULATION wheel (`perf:mod`) | breath / foot jacks not drawn | `dac` strip below (as today) | 2048 × 480 → **2048 × 800** |

Aftertouch on the original (§4.4): CS-80 (per key) and DX7 (channel) → `at: true` on those two beds only. Velocity on the original:
CS-80, DX7 (the engine reads it on exactly these, plus the 303 accent; MAP §2). Checked: 44 keys F…C = 29…72 (26 whites), 49 =
36…84 (29), 61 = 36…96 (36), 37 = 48…84 (22) all start and end on white keys; the black offsets match the equal-top-width layout.

## 2. Layout data additions (`panels/<model>.js`; `cv-panel.js` validates)

Additive and optional: a layout without them behaves exactly as today; `FORMAT` stays 1.

- **Kinds** (`KINDS`): `keys: [], wheel: [], lever: [], ribbon: [], pad: []` — no `models.js` type; live only with their tokens,
  drawn at rest when `inert: true`.
- **Shared tokens for every model**: a new `PERF_TOKENS = { kind: { 'perf:keys': ['keys'], 'perf:bend': ['wheel', 'lever',
  'ribbon'], 'perf:mod': ['wheel', 'lever', 'pad'] } }` beside the per-model `TOKENS`. Today `validate` reads one table, `T =
  TOKENS[model.id] || null` (cv-panel.js 235; used at 265, 274, 278, 353), and only tb303 / dx7 have one, so the generalisation is
  explicit: `tokOf` / `isTok` and every `T` read in `validate` consult the model's table **and** `PERF_TOKENS` (a token's kind check
  is "∈ its list" for perf, "=" for the model's); `RENDERED_TOKENS` gains the three. **Each perf token at most once per layout on
  every model** — including the ten whose `T` is null today (the `if (T)` guard of the duplicate check at 353 does not cover them):
  the rule is its own check, not folded into `T.multi`. The DX7 mixes `dx:` and `perf:` tokens: a test validates its layout with
  both and mutates each (a `perf:bend` twice, a `dx:btn` with a perf kind, a `perf:mod` of kind `ribbon`). The id names the target,
  the kind the widget.
- **Fields** (every control's `x, y` is its centre, IMPL-panels §3.1; `panel-check` prints a bed's left / right edges):

```js
{ id: 'perf:keys', kind: 'keys', a: 'keys', x, y,       // centre of the keys' rectangle (whites · pitch × len)
  n: 61, lo: 36,                                        // key count; MIDI note of the lowest key (a white key; lo + n − 1 white too, ≤ 127)
  pitch: 23.5, len: 150,                                // white pitch (JP-8: 834 / 36), white visible length (mm)
  black: { w: 13.7, len: 93 },                          // optional: defaults 0.583 · pitch, 0.62 · len
  front: 8,                                             // optional: the front band (mm, 0–8, default 8; clamped, §4.1)
  at: false,                                            // true: Pencil pressure → channel aftertouch (cs80, dx7)
  skin: { white, whiteEdge, black, blackTop, gap } }    // optional; defaults from scheme.keys
{ id: 'perf:bend' | 'perf:mod', kind: 'wheel', a, x, y, w, h,        // the slot opening (the visible wheel window)
  orient: 'v',                                          // 'v': rolls toward / away from the player (all ours); 'h' allowed
  detent: true,                                         // a centre mark / click drawn (pitch wheels, MS-20)
  skin: { slot, surface, ridge, mark } }
{ id, kind: 'lever', a, x, y, w, h,                     // the slot
  axis: 'x' | 'y', up: '+x' | '-y' | '+y',              // the direction that raises the value (§5.1)
  skin: { slot, cap } }
{ id: 'perf:bend', kind: 'ribbon', a, x, y, w, h, span: 12,   // semitones over the full length on the original (§5.1)
  hit: [490, 16], skin: { felt, edge } }
{ id: 'perf:mod', kind: 'pad', a, x, y, w, h, rise: 0.25,     // s to full depth while touched (§5.1)
  skin: { face, lit } }
```

- `scheme` gains `keys`, `wheel`, `lever`, `ribbon`, `pad` objects with the same fields (the model's defaults); authors pick colours
  from photos (ivory vs white keys, felt colour), never write CSS.
- **Validation** additions: the kinds and tokens above; `keys`: integer `n` 1–88, integer `lo`, `lo` and `lo + n − 1` white and
  within 0–127, `pitch` 18–26, `len` 80–200, `black.w < pitch`, `black.len < len`, `front` 0–8; the keys' rectangle inside its area;
  `wheel` / `lever` / `ribbon` / `pad` hit boxes ≥ `HIT_MIN_MM` (the ribbon's via `hit`); each perf control inside a section (a new
  area gets a section: `frame: 'none'`, `title: 'none'`, `label` '' or its printed name); live hit boxes pairwise disjoint **with the
  bed's box (keys + the clamped front band) counting as one** (no per-key boxes: black keys are hit-tested by the engine, §4.1, so no
  `HIT_MIN_MM` exemption is needed); no maker name in any skin label; content ≤ 2000 × 1000 mm (the extremes: the modular's 1087 mm
  width, the ARP's 596 mm height).
- **`geometry()`** adds, per keys control, `o.bed = bedLayout(c)` converted to body px **unrounded** (mm × 2, three decimals: `n3`),
  **not through `rectPx`** (its `r05` rounds to 0.5 world px: up to 0.8 device px at k 1.6, dpr 2 — over §9's 0.5 px shade gate):
  `x, y, w, h` per key, the bed box and the front band — the one source for the art, the overlays, the hit test and the tests.
  `hitBoxes()` lists the bed once (`id: 'perf:keys'`, band included).
- **`usable()`**: a layout with perf tokens is usable with or without a host (§3.2: without `api.perf` the widgets render inert).
- `tools/panel-check.mjs` draws each bed (white / black outlines, the front band), each controller's slot and hit box, and prints the
  bed's MIDI range and edges.

## 3. Rendering

### 3.1 What goes where (option A of MAP §4)

| part | where | why |
|---|---|---|
| keys at rest, felt, slot, cheeks, lip; wheel bezel and the wheel at rest; lever slot; ribbon felt and edges; pad face | **the face SVG** (`decorSvg`) → the GL base / window textures of 1h | exact mid-pinch and at rest (R1), ≥ 1:1 at rest (R3); nothing new in `cv-gl.js` |
| a pressed key's dip | DOM: one `.hw-kd` per key at its unrounded art rectangle (`o.bed`), hidden until pressed (`hidden` attribute), a flat translucent shade (`rgba(0,0,0,.18)` + a 2 px darker band at its back, as a gradient) | flat shapes look the same compositor-scaled and re-rastered: no visible "render in" |
| wheel surface (ridges + mark), lever cap, ribbon touch marker, pad light | DOM, opaque over their own window | they move; same treatment as every DOM control today (accepted in 1h §4) |
| hit areas, focus, `aria-*` | DOM (`.hw-c` wrappers, as every control) | |

Option C (a procedural keys shader) stays the follow-up if the user finds the bed soft above 100 % on the iPad (the 1h window-cap
residual, IMPL-1h §3.3); it would change lane G's `cv-gl.js` and needs a second path for `?nogl` and the 'dom' tier, so not now.

### 3.2 DOM (per bed and per controller)

```
.hw-c[data-ctl="perf:keys"][data-kind="keys"][data-nomod]          box = the keys' rectangle + the front band (body px)
  div.hw-keys[data-gesture="music"][role="group"][aria-roledescription="keyboard"]
        aria-label="<Model> keyboard, 61 keys, C2–C7<, velocity note>"; touch-action none; pointer-events auto; no text selection / callout
    div.hw-kd[data-note][hidden] × n                               (pointer-events none)
.hw-c[data-ctl="perf:bend"|"perf:mod"][data-kind="wheel"|…][data-nomod]
  div.hw-wheel | .hw-lever | .hw-ribbon | .hw-pad [data-gesture="perf"][role="slider"|"button"][tabindex="0"]
```

≈ 70 elements per panel (+10 % on today's 600–700). Without `api.perf` (tests with a stub api; a host without `perf`) the same nodes
are built with no listeners and `aria-disabled="true"`: the bed is drawn and silent. CSS lives in `cv-keys.js` as one injected
`<style>` per document (`ensureCSS(doc)`, wk's pattern), so lane C's `style.css` is not touched in this stage (it may move into the
cv-panel section later). The `.hw-c > *` rule's `pointer-events: none` is overridden for these widget roots; their `--hit-w / --hit-h`
equal their box (so the `::before` hit area is harmless).

**The velocity note** (the review's P3): on the nine synths whose original ignored velocity, the bed's `aria-label` ends "; not
touch-sensitive, like the original (velocity is recorded and sent)" and `api.tip` shows the same on hover; on the CS-80 and DX7
"; touch-sensitive: the front edge is loudest". Question 1 (§10) stays.

### 3.3 Memory, rasters, the user's rules

| model | face raster (dpr 2) | base + mips | | model | face raster | base + mips |
|---|---|---|---|---|---|---|
| modular | 10.8 Mpx | 57.6 MB | | prophet5 | 6.3 | 33.8 |
| arp2600 | 9.7 | 51.6 | | juno60 | 6.5 | 34.8 |
| cs80 | 9.6 | 51.1 | | dx7 | 6.2 | 33.2 |
| jupiter8 | 7.6 | 40.6 | | minimoog | 3.9 | 20.9 |
| obxa | 7.3 | 38.8 | | solina / ms20 / tb303 | 3.2 / 3.0 / 1.4 | 17.3 / 15.9 / 7.4 |

- **One face is resident in the app** (the canvas shows the selected track; a track switch destroys the old view before building the
  new one): ≤ 58 MB base + one window (≤ 16 MB at the iPad's 4 M px cap, ≤ 64 MB at 16 M px on the Mac). `FACE_BUDGET_BYTES` (384 MB)
  unchanged. The bench's five-panel set goes from 116 to 180 MB of bases (≈ 340 MB with the unmipped windows: under 384); with
  keyboards it is a new scene, **`hw5k`**, never compared with 1h's `hw5` envelope (§8.3, §9).
- **≥ 1:1**: every raster ≤ 10.8 Mpx < `BASE_MAX_PX` (16 M), so `baseLevel` stays 2.00 at dpr 2 on every model: R3 holds to
  k = 1 on the iPad and the Mac (both dpr 2) exactly as today; above 1 the window / base residual of 1h is unchanged (windows are
  capped per window, not per face).
- **Exemption, recorded (the 16 M px base ceiling, the iOS 2D canvas limit)**: above dpr 2 the biggest faces fall below 1:1 at rest
  for k ≤ 1. dpr 2.5 (a Mac at 125 % browser zoom): the modular at 0.974, every other face 1.000. dpr 3 (150 % browser zoom): modular
  0.812, ARP 0.857, CS-80 0.862, JP-8 0.966, OB-Xa 0.989 (Prophet-5, Juno-60, DX7 and the small ones 1.000). Today (1h) every face is
  1:1 up to dpr 3, so this is new: the user is told (§10), and `cv-face.test` pins these numbers so a change is visible. The fix, if
  the user asks: a non-iOS base ceiling (≈ 24 M px covers dpr 2.5 for every face inside the 384 MB budget; dpr 3 does not fit the
  budget for five faces) — a cv-face.js change, not in this stage.
- **R1**: nothing of the bed is rastered at a zoom end; the moving DOM parts are flat (§3.1). G1 of 1h (`equalPx` mid-pinch vs rest)
  must hold with keyboard faces (§9).
- **First paint at mount** (a track switch, a load; never at a zoom end): rasters over 8 Mpx (modular, ARP, CS-80) already take the
  split raster / upload path (one extra frame). A 10 Mpx `drawImage` is ≈ 5 ms warm / ≈ 30 ms cold on the Mac; on the iPad a 4 Mpx
  window paint took 79 ms, so ≈ 200 ms is possible. **B1 (conditional)**: if the iPad's first base paint of the CS-80 or modular face
  (`ui-bench-1i.html`, §9) is over 100 ms, the 1i fix round adds banded base rasters to `cv-face.js` (unowned by milestone 3): a base
  over `BASE_BAND_PX` = 4 M px painted in horizontal bands of ≤ 4 M px, one per animation frame, uploaded with mips after the last
  band; the SVG shows until then, as at today's mount.
- **The overlap rule** (a hardware module over another drops its face to the 'dom' tier) is unchanged; bigger modules meet it a
  little more often when dragged (and after the first open, §7). The 'dom' tier and the `?nogl` / `'svg'` paths draw the same SVG,
  keys included.

## 4. Touch, mouse and Pencil on the keys (`cv-keys.js`)

### 4.1 The bed engine

Pure, node-tested: `bedLayout(c) → { lo, hi, n, whites, w, h, front, keys: [{ note, black, x, y, w, h }] }` (mm, origin = the lowest
white key's back-left corner); `keyAt(B, x, y, s) → { note, v } | null`; `velOf(B, note, y) → v`. `s` = on-screen px per mm, read
per event from the bed element's `getBoundingClientRect()` (width / `B.w`). The hit rules, in order:
- **outside** (x < 0, x ≥ `B.w`, y < 0, y > `len + front`) → null;
- **black keys first**: a black key when y ≤ its own length and |x − its centre| ≤ `bw / 2`, with the hit width **`bw = clamp(BLACK_PX
  / s, black.w, 0.8 · pitch)`**, `BLACK_PX = 20` — at the iPad's fit zoom (k 0.53–0.68: a black key 14–18 px on screen, ≈ 3 mm on
  the glass) the hit grows toward 20 px; from k ≈ 0.73 it equals the art; the 0.8 cap leaves ≥ 0.34 pitch of white between two
  neighbours (F♯–G♯);
- **else the white key under x** (the 0.6 mm gaps belong to their left key, so every point of the bed is a key);
- **the front band** (len < y ≤ len + front: the lip / rail in front of the keys; a press 1–2 mm past the front edge on the glass
  is ≈ 5–10 px): the white key under x, v = 1. `front` = `c.front` (default `FRONT_MM` = 8 mm: 8.5–11 px at fit zoom, 16 px at k 1),
  clamped by `geometry` to the room below the bed inside the module body, never over the extras strip or another live hit box; 0
  where the keys end at the body's edge. A fixed world band, not a screen-px one: the DOM hit box would otherwise change size at
  every zoom end.
The art is untouched (the shades follow the art, not the hit). DOM: `bed(el, B, o)` → `{ lit(n, on), release(), destroy() }`,
`o = { on(n, v, ts), off(n, ts), at(v) | null }`. The pointer logic is `wk.pianoKeys`'s, copied (wk.js is lane C's) with the true
geometry:
- **hit test** per pointer event from `el.getBoundingClientRect()` (correct under the camera transform; the rect scales mm);
- **multi-touch**: each pointer plays its own note; notes are **reference-counted** over the pointers (two fingers on one key = one
  note, off when the last leaves); `setPointerCapture` at the press;
- **glissando**: a pointer moving onto another key releases its note and plays the new one (velocity at the entry point); off the
  bed (onto the panel) it keeps its note; within a key nothing happens;
- **release**: `pointerup`, `pointercancel`, `lostpointercapture` end that pointer's note; `release()` ends every held pointer:
  `o.off` once per sounding note, captures dropped, shades cleared; a stale pointer event after `release()` or `destroy()` posts
  nothing (its record is gone);
- **mouse**: button 0 without Ctrl only (a right click or a Ctrl-click plays nothing), drag = glissando, `contextmenu` prevented on
  the bed (a long press plays, never opens a menu); the mouse wheel is not taken (the camera keeps it, as over the panel art).

### 4.2 Velocity: where the key is touched

For the key under the press: `f` = the distance from the key's back edge (where it meets the felt) to the touch point, divided by
that key's visible length (a black key: its own length), clamped 0…1; the front band is f = 1. **`v = min(1, 0.3 + 0.75 · f)`**
(0…1 into `noteOn`; MIDI out `round(v · 127)`, 38…127): the back of a key still sounds (0.30), the front part of a white key gives
0.77…1, the front 7 % and the band are full. It is the bottom tray's `velAt` curve exactly, so the same synth answers the two
keyboards alike. Constants `KEY_VEL = { lo: 0.3, span: 0.75, min: 0.05 }` in `cv-keys.js`. The same rule for a finger, the mouse and
the Pencil. What it does to the sound is each model's, as on the original (§5.3): CS-80 and DX7 respond; the other nine record it,
send it on MIDI and to the canvas Velocity module, but do not change (the bed says so, §3.2; question 1, §10).

### 4.3 Gestures and zoom

What today's code does (reproduced by the review's scripts on the real gesture.js and cv-world.js) and the two fixes:
- **Two fingers on the keys are notes** (k ≥ 0.5): the bed is `data-gesture="music"`; gesture.js never pairs a touch with a q on a
  music zone, and the world does not take a key press, so a chord never becomes a pinch (unchanged code; verified).
- **A key and a controller** (`perf`), in either order: never pair (unchanged code; verified): wheel + chord is the main gesture of
  a player.
- **G1 (fix, lane H, gesture.js `partner()`): controllers.** Today a `perf` touch pairs with a `perf` touch: a second wheel pressed
  within 250 ms, or while the first is held still up to 1.2 s, opens a nav session — the second press is eaten and the first wheel
  rolled back (`perf2.test.mjs`). That breaks the one-hand thumb-and-forefinger technique (Prophet-5, Minimoog, DX7), the OB-Xa's
  two levers and the JP-8's lever + pad. The rule becomes: **a `perf` touch never pairs with another `perf` touch, and pairs with
  anything else by the time rule only** (≤ PAIR_MS; never the late rule, whichever landed first). **Wheel + knob** (or panel art)
  is therefore decided: landing together (≤ 250 ms) is a pinch — the wheel rolls back to its `abort` value (bend 0, mod the value at
  the press), the standing "two fingers win" — while a controller held longer is a hand at work, so a knob turned by the other hand
  is an independent touch. Two lines in `partner()` (`perf` = p's or q's zone): skip when both are perf; drop the late clause when
  either is. The bottom tray is one `perf` zone (`#perf`): its bend and mod wheels now work together too, and a finger resting on
  the tray's chrome no longer pairs late with a finger elsewhere (two fingers landing together still pinch).
- **G2 (fix, lane H, cv-world `onDownCap`): a resting finger never silences the keys or the controllers** (review 1 F5: the controllers too). Today a finger already down on module art or
  empty canvas holds the world's one-finger pan (`G`), and a key pressed later is taken as that pan's pinch finger at any delay
  (`s1.test.mjs`, k 0.8, 400 ms: no pointerdown on the keys, no session); gesture.js's edge-thumb protection does not reach the
  world's `G`. A thumb resting on the canvas while holding the iPad would silence every bed key. In the branch for a further touch
  while the world's touch pan runs, before `take(e)`: when `G.kind === 'pan' && !G.moved && !G.sleep && now() − G.t0 > PAIR_MS`
  (imported from gesture.js) and the touch is in an **awake music or perf zone** (an ancestor `[data-gesture="music"]` or `"perf"` inside a
  `[data-cv-mod]`, and `cam.k ≥ READ_K`), return: the key (or the wheel) gets its press and `G` stays (the resting finger may still pan; a held key
  keeps its note while the bed moves under it, §4.1). Landing within PAIR_MS, or a pan already moving: today's pinch (gesture.js
  pairs by the time rule; the world takes the late finger of a moving pan). Key first, background second: both work, unchanged.
- **A finger on the panel art or the canvas joined by a key finger within 250 ms** pairs and pinches (as on the tray: keep). Two
  fingers on the panel art, the cheeks, the lip outside the band, the gaps: pan / pinch the camera as today.
- **Keys sleep below 50 % zoom like every control** (cv-world `READ_K`; a double-tap on the module wakes it): decided, not asked —
  at fit zoom on the iPad a 61-key synth is k ≈ 0.53–0.68 (the default camera never lands below 0.5), and below 0.5 a black key is
  under 14 px wide. The world already takes a press on a sleeping bed as a camera pan **and a second finger as its pinch** (verified:
  k 0.4, two fingers on a bed → the world pinched 0.4 → 0.876, no note, no session). *(Revision 1's S1 — a `data-cv-sleep` attribute
  and a `zoneOf` change — rested on the opposite premise and is dropped; a regression test keeps the behaviour, §9.)* The sleep is
  silent today; **a hint**: a tap on a sleeping bed or controller (the world's `tap` with `g.sleep` and a music / perf target) emits a
  world event `sleeptap`; main.js shows `notice('Zoom in, or double-tap the synth, to play it', 2500)` the first time per session.

### 4.4 Apple Pencil and aftertouch

- The Pencil plays like a finger (position velocity, glissando); gesture.js never pairs pens. Hover moves (`buttons` 0) are ignored.
- **Aftertouch only where the original had it** (CS-80 per key, DX7 channel; `at: true`): while a `pen` pointer holds a key,
  `at = clamp((pressure − 0.15) / 0.85, 0, 1)` is sent as channel aftertouch, at most once per animation frame; the last pen lift
  sends 0. A finger on iPad glass reports no pressure, so fingers and the mouse send none (question 2, §10). No "long hold"
  aftertouch: it would swell every held chord unasked. The CS-80's per-key pressure becomes channel aftertouch (the engine's `at`
  is per channel: `vcf.at` 0.6, After → Brill); the DX7's engine does not read `at` (it still records, goes out on MIDI and feeds
  the canvas Aftertouch module).
- **Unverified**: that WebKit fires `pointermove` for a pressure-only change (the Pencil pressed harder without moving). If it does
  not, aftertouch follows the pen only while it moves; the iPad checklist (§9) has "press harder without moving", and the result goes
  into §11.

### 4.5 Keyboard and accessibility

The bed is one `role="group"` (not focusable: 61 tab stops would be a trap); the computer keys (`CODEMAP`) play through `noteOn`
and light the bed (§6.2). Controllers are focusable sliders (`aria-valuenow`, `aria-valuetext` "+1.2 st" / "45 %"): arrows ±0.1,
Home / End; a springing control returns to centre on `keyup` and on `blur`. The pad is a button (`aria-pressed`, Space / Enter
held = touched). **Only a controller focused from the keyboard (Tab) acts on keys**: one a pointer press focused gives Space, Home /
End and the arrows back to the page (the transport, the seek; main.js's `kbFocus` rule for pointer-focused controls; review 1 F6).

## 5. Controllers

### 5.1 Behaviour

All drags use the host's `api.track(el, e, move, end, abort)` (absolute pointer tracking with capture and the two-finger rollback)
and **relative** maths: the part moves with the finger from where it was pressed, never jumps to the touch point.

| kind | value | maths (mm of the control, from the press) | release (`end`) | two-finger `abort` |
|---|---|---|---|---|
| `wheel` `perf:bend` | bend −1…1 | Δv = 2 · Δ / h, Δ = travel away from the player (screen up) | **springs to 0** (every pitch wheel: the originals of the Minimoog / Prophet-5 / MS-20 only detent, but a wheel left off-centre on glass is a trap; the tray's bend wheel springs too) | 0 |
| `wheel` `perf:mod` | wheel 0…1 | Δv = Δ / h | stays | the value at the press |
| `lever` `perf:bend` | bend −1…1 | Δv = 2 · Δ / (slot length), Δ along `up` | springs to 0 | 0 |
| `lever` `perf:mod` (OB-Xa) | wheel 0…1 | Δv = Δ / (slot length), toward the player = more (manual p.16) | **springs to 0** (a paddle: rest = no modulation) | the value at the press |
| `ribbon` (CS-80) | bend −1…1 | relative to the first touch point: v = Δx · span / (w · bendRange) — the original's ≈ 1 octave over the full 490 mm (≈ 41 mm a semitone), clamped at our ±2 st (82 mm); a touch without moving does nothing (the owner's manual) | springs to 0 | 0 |
| `pad` (JP-8) | wheel 0…1 | while touched: ramps from the value at the press to 1 over `rise` (0.25 s; the RISE TIME slider is inert) | back to 0 at once | the value at the press |

Directions: wheels and the OB-Xa pitch lever: away from the player = up; JP-8 / Juno-60 benders: right = up (JP-8 manual p.14:
"left and right extremes bend by the same amount in opposite directions"). A second finger on a controller already held is
ignored (one finger per controller); two controllers at once work (G1). Every move posts at most once per animation frame; the end
posts its final value at once (spring returns are instant, like the tray's).

### 5.2 Views of one value

A hardware wheel is one more view of the values the tray wheels, MIDI input and the 2a modules already share: moving it calls
`ctl` and moves the tray's wheel (`setBendUI` / `setModUI` with `send = false`); a `ctl` of that kind **that reaches the selected
track** redraws it (§6.2: a bend on another MIDI channel, or a value the selected track did not receive, does not; a view being
dragged ignores the echo). The mod value is the project's one Mod Wheel (2a: it also reaches every track with a Mod Wheel cable).
Like the tray wheels, hardware controls show live values only (not a recorded lane during playback).

### 5.3 What each controller drives (today's engine paths, no change)

| model | pitch control → | mod control → `wheel` | velocity | aftertouch |
|---|---|---|---|---|
| modular, solina, arp2600 | none on the instrument (decided for the ARP, §1.1); the tray's bend wheel bends ±2 st as today | none on the instrument; the tray's wheel → LFO → pitch (modular, ARP) as today; the Solina reads no wheel | — | — |
| ms20 | CONTROL WHEEL → `bend` ±2 st (the original's wheel is a patch source only, `CONTROL WHEEL OUT`, not normalled; we bend the pitch, its usual patch) | none on the instrument (the tray's wheel → LFO → pitch) | — | — |
| minimoog | PITCH wheel → ±2 st | MOD wheel → the mod bus when OSC MOD / FILTER MOD are on, else LFO → pitch | — | — |
| cs80 | RIBBON → ±2 st | (none on the instrument) | `velAmp` 0.5, `vcf.vel` 1.4 | `vcf.at` 0.6 |
| prophet5 | PITCH wheel → ±2 st (original ≈ ± a fifth) | MOD wheel → the WHEEL-MOD switches | — | — |
| obxa | PITCH BEND lever → ±2 st (original ±1 oct, NARROW ±2 st) | MODULATION lever → LFO → pitch 0.6 | — | — |
| jupiter8 | BENDER → ±2 st (the BEND switches / sliders inert) | LFO MOD pad → LFO → pitch 0.6 | — | — |
| juno60 | BENDER → ±2 st | (none) | — | — |
| dx7 | PITCH BEND wheel → ±2 st (original 0–12 per patch) | MOD wheel → `pmd` (FUNCTION 17 sets the range) | per-operator `vel` | (not read) |
| tb303 | — | — | accent (keys: §6.4) | — |

The bend range stays ±2 st on every model (I1: changing `models.js` changes the goldens; a per-model or per-track range is a later
step, question 3). Each pitch control's tooltip says "±2 semitones (the original: …)".

## 6. The note path and the host

### 6.1 `api.perf` (what cv-panel gets; built by `cv-keys.perfHost`, forwarded by classic-panel)

```
perf: {
  on(n, v, ts), off(n, ts)        // a key: noteOn(n, v, 0, ts) / noteOff(n, 0, ts) when this panel's track is the selected one, else nothing;
                                  // a note that is not an integer 0–127 is dropped here (defence beside noteOn's guard, §6.2)
  bend(v), mod(v), at(v)          // ctl('bend' | 'wheel' | 'at', v, 0) + the tray wheel's view (bend, mod)
  value(kind) → number            // 'bend' | 'wheel' | 'at': the last live value sent to the selected track (perfLive), 0 when none
  view(kind, fn) → off            // fn(v) on every ctl of that kind that reaches the selected track (§5.2)
  lit(fn) → off, held() → n[]     // fn(n, on) on every key light (keyVis); held(): the notes lit now (a bed mounts lit)
  bed(release) → off              // a mounted bed / controller registers its release() for the host's release-all
}
```

`perfHost(deps) → { api(trackView), lit(n, on), live(kind, v), release() }` lives in `cv-keys.js` (node-tested with fakes) so
`main.js` only wires it. `deps = { noteOn, noteOff, ctl, live(kind), held(), bendUI(v), modUI(v), sel(trackView) }`. `cv-keys.js`
also exports the TB-303's pitch maths (§6.4): `SEQ_ROOT = 48`, `seqNote(s) = SEQ_ROOT + s.n + 12 · s.o`, `seqVel(s) = s.a ? 1 :
0.62` (`seqFire`'s).

### 6.2 `main.js` sites (lane H; ≈ 20 lines)

| site | change |
|---|---|
| imports | `import * as cvKeys from './cv-keys.js?v=9';` |
| beside `classicHost` | `const PERF = cvKeys.perfHost({ noteOn: (n, v, ts) => noteOn(n, v, 0, ts), noteOff: (n, ts) => noteOff(n, 0, ts), ctl: (k, v) => ctl(k, v, 0), live: k => (perfLive.get(trk().id) || {})[k] || 0, held: () => [...new Set([...held.keys()].map(k => +k.split(':')[1]))], bendUI: v => setBendUI && setBendUI((v + 1) / 2, false), modUI: v => setModUI && setModUI(v, false), sel: v => trOf(v) === trk() })`; `classicHost.perf = PERF` |
| `keyVis(n, on)` | `PERF.lit(n, on)` (every source lights the bed: tray, computer keys, MIDI in, the bed itself; playback does not, as for the tray) |
| `ctl(...)` | after the posts: `if (kind !== 'sus' && to.includes(trk())) PERF.live(kind, v)` — only when the selected track is among the targets (`to` = `trs` + `wheelTracks()` for 'wheel'); was "after every `ctl`" (the review's P1-6) |
| `noteOn` guard | `if (!(n >= 0 && n <= 127)) return;` (today's `n < 0 \|\| n > 127` lets NaN through: held, lit, recorded and posted) |
| `seqPayload` (3013), `seqToRoll` (3037) | `root: cvKeys.SEQ_ROOT`; `const n = cvKeys.seqNote(s)` — the two literal 48s become the one constant (bytes unchanged: I1) |
| `panic()`, `powerOff()`, `visibilitychange` (hidden), window `blur` | `PERF.release()` |
| the world's `sleeptap` | `notice('Zoom in, or double-tap the synth, to play it', 2500)` once per session (§4.3) |
| `__synthTest` | `cv.perf: PERF` (the sims) |

`classic-panel.js` `api()`: `perf: H.perf ? H.perf.api(tr) : null` (every model; not gated like `seq` / `dx`). Nothing else in
either file. No `t.model` / `t.vals` / `fxOf(t)` in any of these lines (lane A's accessor ratchet, §8.3).

### 6.3 Which track, recording, MIDI out, cleanup

- **The selected track plays** (+ armed tracks: `midiTargets`, src 0), which is the track whose modules the canvas shows. A panel of
  another track (a stale view mid-switch) plays nothing (`sel`). The bed and the tray share `noteOn`'s `held` key (`0:n`): the same
  note pressed on both retriggers (today's tray vs computer-keys behaviour), and whichever lifts first ends the note.
- **Recording** into armed tracks (`recStart` / `recEnd`, `recCC` for controllers — it overwrites its last value within 12 ticks, so a
  spring's final 0 is recorded), **MIDI out**, `inputNote` (the Velocity / Note modules, a Serum's render-last group — not reached:
  hardware tracks), `playingUI`: all through `noteOn` / `ctl`, unchanged.
- **Held-note hygiene**: `selectTrack` already ends every held note and rebuilds the view (the panel's `destroy` → the bed's
  `release`); a Hardware ↔ Simple switch, a model replace, a module delete or a re-render: `ClassicPanel.destroy` →
  `cv-panel render().destroy()` → every bed and controller `release()` (cv-panel's destroy gains that, lane K); `panic`, power
  off, a hidden page, a window blur: `PERF.release()` (the bed drops its pointers so a still-pressed finger cannot leave a count
  that silences the next press). A springing controller released this way posts its rest value. Review 1: the beds and controllers
  also let go **while their track is still the selected one** — `PERF.release()` at the top of `applyRestore` (Undo / Redo / a load
  replace every track object, and the old panels' offs fail `sel()`), in `selectTrack` (after its early return) and in `deleteTrack`
  (the selected track, before the splice); a blur or a hidden page keeps the bed lit for a MIDI / tray note still held (`perfLetGo`).
- **The bottom tray stays** as it is; its keys and the beds light each other through `keyVis`.

### 6.4 TB-303

Its 13 key cells (`seq:key`) are its only keys: in PITCH mode a press now also **sounds the note while held**, as the 303 does when
writing: `perf.on(seqNote(step), seqVel(step))` with the cursor step's octave and accent (`SEQ_ROOT` from `cv-keys.js`, §6.1: the
main-side pattern `SEQ_DEF` has no `root`, and revision 1's `q.root` was NaN). The cell takes `setPointerCapture` at the press and
ends its note at `pointerup`, `pointercancel` and `lostpointercapture` (a mouse that leaves the cell before release would otherwise
never get its pointerup); `release()` and `destroy()` end it too. The write itself stays on `api.tap`, as today (a finger: at the
tap's release; a mouse: at the press). TIME mode: silent. The cells get `data-gesture="music"`: **two fingers on two cells sound
both notes and never pinch, and each tap writes the same cursor step (the 303 has one), so the cell released last is the step's
note** (the mouse: the last press). Code in cv-panel's `seqWidget` (lane K1); the root's single definition in main.js (§6.2, lane H).

## 7. Sizes, making room, existing projects

- Sizes: §1.2 (every model taller; modular +448 px and ARP +288 px wider). `cvModuleSize` (the drop outline), `TrackView.sync`, the
  fixed module size and `makeRoom` follow `sizeOf` with no code change.
- `makeRoom` runs on load / track switch / toggle when the size changed (a view normalisation, no History step): the FX and OUT
  modules right of a widened modular / ARP move right once. It clears **horizontally**: the modules whose left edge is at or right of
  the instrument's left edge and which it now overlaps move right together, so **a module the user put below an instrument that now
  grows into it moves to the right of the instrument** (with whatever else moves), not down. A module below whose left edge is left of
  the instrument's stays where it is, covered, and the instrument's face drops to the 'dom' tier until one of them is moved (the 1h
  overlap rule). The modulator column at x −320 (milestone 3 makes it grow left) is unaffected: instruments grow right and down only.
  The user is told (§10).
- Nothing stored changes (sizes derive from the layouts): no schema bump, no migration. An older canvas build shows the old sizes.
- The default camera keeps its `READ_K` floor (a CS-80 fits an iPad landscape canvas at k ≈ 0.53, a Prophet-5 at ≈ 0.68). **Review 2
  (P2-1): an instrument with hardware keys fits its height into the band too (down to `READ_K`); below that the camera slides up / left
  the least that puts the whole bed in the band (§11 "Fixes (review 2)").** The band is the viewport less the toolbar / minimap box, so on
  an iPad landscape canvas (≈ 432 px) most faces open at `READ_K` with the keys in view and the top of the face above the fold.
- The Simple layout and the Sources tray tiles are unchanged.

## 8. Lanes and the schedule

### 8.1 Lanes (the leaner shape)

| lane | when | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **K1** keys code | now; **K1a first** (one commit: §2 validation with `PERF_TOKENS`, `geometry` / `o.bed` unrounded, `hitBoxes`, the pure `bedLayout` / `keyAt` / `velOf`, `panel-check`) | `cv-keys.js` (new: §4, §5, §6.1 `perfHost`, the `SEQ_*` maths, `ensureCSS`), `cv-panel.js` (§2, §3 art + DOM, §5 widgets, destroy → release, §6.4 audition), `tools/panel-check.mjs`, **`tests/ui-bench-1i.html` + `tests/ui-bench-1i.mjs`** (new: S0 owns `ui-bench.html`, so no hook there) | `tests/cv-keys.test.mjs` (new), `tests/cv-panel.test.mjs` (TARGET / PINNED from K2's hand-back, the new kinds), `tests/cv-face.test.mjs` (+ every model's raster ≤ 16 M px, `baseLevel(2)` = 2, the dpr 2.5 / 3 numbers of §3.3), lint, pwa; **the bench page in the CDP harness before hand-over** (§9) | standard |
| **K2** keys data | from K1a's commit (base = that hash: the validator must exist first) | `panels/*.js` (11 files; tb303 untouched), measurements into each layout's `notes`; the modular last | `node tools/panel-check.mjs <model>`, `tests/cv-panel.test.mjs` | standard |
| **H** host | after the user's S0 iPad session (schedule A) or phase 1.5 (B), §8.2 | `main.js` (§6.2 only), `classic-panel.js` (`api().perf`), `cv-world.js` (G2, the `sleeptap` event), `gesture.js` (G1), `tests/canvas-1i-sim.test.mjs` (new, **accessor-free**: no `t.model` / `t.vals` / `fxOf(t)` — device views and `__synthTest.cv` only, so lane A's hook and ratchet pass over it), size updates in `tests/canvas-sim.test.mjs` / `tests/cv-fixes-sim.test.mjs`, additions to `tests/main.test.mjs`, `tests/gesture.test.mjs`, `tests/cv-world.test.mjs`, `tests/classic-panel.test.mjs` | those files, lint, pwa | standard |
| reviewers ×2 | after H | (1) real host: page sims with the real `main.js` (note path, recording, MIDI out, cleanup, gestures G1 / G2, the sleeping-bed regression, the 303 audition, goldens / `canonical-stream` once); (2) headless Chrome (CDP, `--use-angle=metal --force-device-scale-factor=2`) at 1440 × 900, 1366 × 1024, 1024 × 1366: §9's look, alignment and budget gates, synthetic multi-touch, `ui-bench-1i.html` | — | standard |
| fixers | after the reviews | the finding's files, failing test first | | cheaper |

Rules for every builder: `git reset --hard <base>` first (harness worktrees start from `main`; check `git log -1`); `?v=9` on every
import; `import './v8-guard.mjs'` first in new test files; never fake-DOM nodes in `assert.*` (compare ids, numbers, strings); one
test file at a time with `node --max-old-space-size=2048 --test tests/<file>.test.mjs`; dense comments in the existing voice;
original art only (no logos, no maker names; the validator checks); **no lane commits `sw.js`** (the lead runs `node
tools/precache.mjs --write` after each merge); commit on the worktree branch; report the commit hash and the gates measured.

### 8.2 The schedule around milestone 3

Milestone 3 (IMPL-3 §6) is in flight: phase 0 = S0 ∥ lane A (A owns `main.js`, `classic-panel.js`, `midi.js`, `song.js`,
`assets.js`, `cv-model.js`, `cv-migrate.js`, `tests/lint.test.mjs` and the sims' accessor sites **through phase 1**); the user's S0
iPad session gates phase 1; phase 1 = A ∥ B ∥ C ∥ E (C owns `cv-world.js`, `wk.js`, `style.css`, `index.html`, `cv-module.js`, …),
merged by the lead at the phase-1 merge point; phase 2 = D (owns `main.js` again); `tools/deploy-canvas.sh` publishes `canvas` HEAD
only (no side path). Between S0's deploy and the phase-1 merge, `canvas` HEAD holds the contracts and S0's test page only.

| step | when | who | what | lands |
|---|---|---|---|---|
| 0 | **now, before any 1i worktree** | the lead | commit `IMPL-1i.md` + `ROADMAP.md` on `canvas` (this contract's commit: IMPL-1i is untracked and ROADMAP modified today), with §8.3's IMPL-3 amendments | `canvas` |
| 1 | now, beside phase 0 | K1 (K1a first) → K2 from K1a | everything in K's rows: no file of S0 / A / B / C / E | the lead merges K1 → K2 into the holding branch **`wt-1i`**, not `canvas`: S0's `hw5` must measure the 1h faces the user accepted, lane A's sims pin today's sizes (canvas-sim's 1408 × 512), and a deploy publishes HEAD |
| 2 | **A**: right after the user's S0 iPad session · **B**: at the phase-1 merge point | the lead | merge `canvas` into `wt-1i` (disjoint files) | `wt-1i` |
| 3 | after step 2 | H (base = `wt-1i`) | §6.2, §6.4's host half, G1, G2, the hint, the sims at the new sizes | `wt-1i` |
| 4 | after H | 2 reviewers → fixers (failing test first) → the sweep of every file 1i touched, one at a time, `golden-classic` / `-fx` / `-presets` / `-random` / `-graph` and `canonical-stream` once | | **one squashed commit "1i" on `canvas`** (revertable alone); ROADMAP / IMPL-panels R3 / HANDOVER notes |
| 5 | **A**: at once · **B**: with M3 | the lead | **A**: `tools/deploy-canvas.sh` → the user's 1i iPad session (`ui-bench-1i.html` → bench.json `"ui-1i"`: the `hw5k` envelope, base paints, bytes; the hands-on of §9); B1 / option C decided there, a 1i fix round if needed. **B**: 1i ships with milestone 3's deploy; its iPad numbers come from the `ui-m3b` session | the site |

- **Schedule A (recommended, question 4)**: the user gets the keyboards a day or two after the S0 session instead of at the end of
  milestone 3 (four lanes, integration, reviews: several times longer), and 1i's first iPad numbers arrive before milestone 3 builds
  on bigger faces. The deploy carries nothing of milestone 3 but S0's test page (already public for the session). Costs: (1) phase 1
  waits for nothing — B and E start at once (no shared file with H); C's base is the 1i commit when it is ready, else C starts at once
  and the lead merges H's cv-world hunk later (G2 sits in `onDownCap`, C's work in `canvasStats` / the budget: disjoint); (2) lane A's
  `main.js` / `classic-panel.js` exclusivity gets one exception (§8.3): H's ≈ 20 lines land on `canvas` while A works, and the lead
  merges them into A's branch at the phase-1 merge (line-level, at sites A does not retire: `classicHost`, `keyVis`, `ctl`, `panic`,
  `powerOff`, `visibilitychange`; `seqPayload` / `seqToRoll` may touch A's `seqOf` edits — resolved by hand), plus the sims' size
  numbers in canvas-sim / cv-fixes-sim against A's accessor edits there (budget one fix-up). Shipping 1i **before** S0's session is
  refused: S0's `hw5` would measure keyboard faces and its accepted envelope would have to be re-pinned.
- **Schedule B** (the user prefers it, or S0's session slips past the K lanes by a lot and the lead judges the merge cost not worth
  it): steps 2–4 at phase 1.5 (after the phase-1 merge, before D), as revision 1; 1i ships with milestone 3's deploy.
- Either way B1 (§3.3) and option C (§3.1) are decided from the user's iPad numbers (A: the 1i session; B: `ui-m3b`), in a 1i fix
  round, never by milestone 3's D-R5 (§8.3).

### 8.3 Amendments to IMPL-3 (the lead applies them in step 0's commit; this lane writes no other doc)

1. **§1.5 / §7, the five-panel reference after 1i**: once 1i is on `canvas` the five panels carry keyboards (≈ 55 % more base texture,
   116 → 180 MB). `ui-m3b`'s validity scene is **`hw5k`**, judged against its own envelope — recorded at the 1i iPad session as
   `"ui-1i"` (schedule A), or within `ui-m3b` itself (schedule B: `hw5k` first and last, drift ≤ 1.0 ms) — never against 1h's `hw5`
   envelope. S0's phase-0 run is unaffected (1i is not on `canvas` then).
2. **§1.5 decision table**: if `hwm-real` fails P+ while `hw5k` alone fails P+ in the same session, the cost is the keyboard faces:
   1i's B1 (banded bases) or option C (a keys shader), re-measured; **D-R5 does not flip for it**. D-R5 flips only when `p1x-real`
   fails, or `hwm-real` fails while `hw5k` passes.
3. **§6, lane A's exclusivity** (schedule A only): one exception — 1i's lane H (§6.2's sites, `classic-panel.js` `api().perf`, the
   sims' sizes) lands on `canvas` between phases 0 and 1; the lead merges it into A's branch; A's accessor hook and ratchet run over
   `canvas-1i-sim` (written accessor-free).
4. **§6, phase-1 bases** (schedule A): B and E start from `canvas` after the S0 session; C from the 1i commit when it exists.

ROADMAP row 1i is updated by the lead when question 4 is answered (it says "ships with milestone 3's deploy" today).

## 9. Tests and gates

- **Sound (I1)**: `git diff` of the DSP / compile files and `models.js` empty; goldens and `canonical-stream` bit-identical (the lead,
  once, at step 4); the 303's `seq` payload byte-identical (`root` 48).
- **cv-keys** (K1): `bedLayout` for 37 / 44 / 49 / 61 keys (lowest / highest white, whites × pitch = width, black centres at the
  five offsets ± 0.01 mm, black dims); **a property test of `keyAt`** over 37 / 44 / 49 / 61 keys and several `s` (0.5, 1.06, 1.36,
  2, 3.2 px/mm): every point of the bed and its band maps to exactly one key in [lo, hi], gaps go to the left key, a black key wins
  inside its (widened) hit, the hit width is `clamp(20 / s, black.w, 0.8 · pitch)`, at large `s` the hit equals the art, outside →
  null; the front band → the white key under x with v = 1; `velOf` (back 0.30, front 1, the 7 % band, black keys by their own
  length); the pointer engine on fake events (a chord, two fingers on one key = one on / one off, glissando with the entry velocity,
  off-bed keeps the note, `lostpointercapture` ends it, `release()` posts each off once and clears the shades, **a stale pointer
  event after `release()` or `destroy()` posts no second off**, a right click **and a Ctrl-click** play nothing, a pen with `at: true`
  sends aftertouch ≤ 1 per frame and 0 at the lift, without `at` none, a finger never); controllers (each row of §5.1: ranges,
  directions, relative drags, springs, abort values, the pad ramp on a fake clock, one finger per controller); `perfHost` (lit
  fan-out to every mounted bed, `release()` reaches all and **a spring controller released through it posts its rest value**, echo
  ignored while dragged, `sel` false → nothing posted, a NaN / non-integer note → nothing posted); `seqNote` / `seqVel` for every cell
  0–12 × octave −1 / 0 / 1 × accent.
- **cv-panel** (K1 / K2): the new kinds and tokens validated (one mutation per rule of §2, incl. a perf token twice on a model with no
  per-model table and the DX7's mixed `dx:` / `perf:` cases); every model but the TB-303 has one `perf:keys` with the §1.2 range;
  the JP-8 bed fits its 834 mm area; TARGET / PINNED sizes (§1.2, pinned from K2); live hit boxes disjoint with the bed's (band
  included); extras overlap no area; `o.bed` unrounded (three decimals, equal to `bedLayout` × 2 + the area's offset); render with a
  fake `api.perf`: one `.hw-c` per perf token, `data-gesture` music / perf, `n` hidden shades, a fake press reaches `perf.on` with the
  §4.2 velocity, the velocity note in the bed's `aria-label`; without `api.perf` the same nodes, no listener, `aria-disabled`; the
  TB-303 audition (PITCH: on at press with `seqNote` / `seqVel`, off at release, at `lostpointercapture` after the pointer left the
  cell, at `destroy()`; TIME: none; two cells: two notes, the last tap writes); determinism (render twice → identical serialisation);
  artwork rules.
- **cv-face** (K1): `baseLevel(2, …)` = 2 for every 1i face; at dpr 2.5 the modular 0.974 of 1:1 and the rest 1.000; at dpr 3 the
  §3.3 numbers (the recorded exemption, pinned).
- **Host / sims** (H): `canvas-1i-sim` (new, accessor-free): a CS-80 hardware panel on the canvas → a synthetic press on a key posts
  `{t:'on', n, v}` to the selected track's node with v from the press depth; an armed track records it; MIDI-in and tray notes light
  the bed; the ribbon posts `bend` and the tray wheel follows; the tray wheel moves the Prophet-5's hardware wheel; **a MIDI bend on a
  channel the selected track does not take leaves the hardware wheel still**; tray and bed on the same note (retrigger; the bed's lift
  ends the tray's note); panic / power off / hidden page / Simple switch / track switch leave no held note and no lit key; a press on
  a non-selected track's stale panel posts nothing; makeRoom moves FX / OUT right once for the modular and the ARP on load (no
  History step); **the TB-303 audition end to end: for every cell and octave its note equals `seqToRoll`'s and the `seq` payload's
  `root` is `SEQ_ROOT`**; `noteOn(NaN)` posts and holds nothing. `gesture.test` (G1): two fingers on a canvas module's bed → no
  session; wheel then key and key then wheel → no pair; **wheel + wheel (≤ 250 ms; the first held still 600 ms) → no session, both
  get their pointerdown; lever + pad the same; tray wheel + hardware wheel the same; wheel + knob ≤ 250 ms → a nav session (the wheel
  rolls back); wheel held still 600 ms then knob, and knob then wheel 600 ms → no session**; background then key within 250 ms →
  pairs. `cv-world.test` (with the real gesture.js, as `s1.test.mjs`): **k 0.4, two fingers on a bed → a camera pinch, no note, no
  session** (the regression S1 became); **G2: k 0.8, a finger on the module art, a key 400 ms later → the key gets its pointerdown,
  no session, the camera unchanged; 100 ms later → a nav pinch; a moving pan then a key → a pinch; key first then the art → both**;
  a tap on a sleeping bed emits `sleeptap`. `main.test`: a key → `noteOn` → the node's message; a wheel → `ctl`; `keyVis` lights a
  mounted bed; `PERF.live` only for the selected track. `classic-panel.test`: `api().perf` forwarded; **a host without `perf` →
  `api().perf` null and the Hardware panel builds the same nodes**. `canvas-sim` / `cv-fixes-sim`: the new sizes.
- **Rendering** (K1's CDP run before hand-over, then reviewer 2): G1 `equalPx` mid-pinch vs rest with the CS-80 and Prophet-5
  keyboard faces at k = 0.6 and 1.6 (window landed); the bed region GL vs `?nogl` ≥ 99 % of pixels within 8 / 255 at k = 0.5 and 1;
  every `.hw-kd` shade within 0.5 device px of its key's art at k = 0.5, 1, 1.6 (geometry unrounded, §2; if the GL path itself is
  found to offset the art, that is a finding to fix, not a reason to widen the gate); wheel / lever DOM windows exactly over their
  slots; **`ui-bench-1i.html`** (K1's page: `hw5` from the 1h base build vs `hw5k`, the same drive as ui-bench's): `hw5k` no frame
  over 33 ms in pan / zoom / deep, GL draw mean ≤ 1 ms, `glStats().bytes` ≤ 384 MB; one-face app scene ≤ 58 MB base; base paint ms
  per model (`paintMs`); key latency pointerdown → `postTo` in the same task, ≤ 1 ms main thread; no console error. K1 records the
  Mac numbers (`"ui-1i-mac"`, informational) in §11.
- **iPad (the user: schedule A's 1i session, or B's `ui-m3b` session)**: `ui-bench-1i.html` → the `hw5k` envelope (`"ui-1i"`), the
  first base paint of the CS-80 and modular faces (B1 above 100 ms), `glStats().bytes`; hands-on: a chord with all ten fingers on the
  CS-80, a glissando, soft at the back / loud at the front on the DX7, **a key pressed just past its front edge (loud) and the black
  keys at fit zoom**, the Prophet-5 wheels while playing, **both Prophet-5 wheels at once with thumb and finger, the OB-Xa's two
  levers, the JP-8 lever + pad**, the CS-80 ribbon, the JP-8 pad, **a thumb resting on the canvas while playing the keys**, a pinch
  with two fingers on the panel above the keys, a pinch at 40 % over the keys (the camera zooms, no note), a tap on the keys at 40 %
  (the hint), the Pencil on the CS-80 **including "press harder without moving"** (§4.4).
- **Sweep**: every file 1i touched, one at a time; lint, pwa (precache rebuilt by the lead: `cv-keys.js` is reached from `main.js` and
  `cv-panel.js`).

## 10. Questions for the user

Only genuine decisions; each has the default the build uses until answered.

1. **Velocity on the synths that never had it.** Only the CS-80 and the DX7 (and the TB-303's accent) were touch-sensitive; on the
   Minimoog, Prophet-5, Jupiter-8, Juno-60, OB-Xa, MS-20, ARP, Solina and Moog a key sounds the same wherever you strike it — as on
   the originals — though the velocity is recorded, sent over MIDI and usable through the canvas Velocity module (each keyboard says
   so when you point at it). **Default: faithful.** Want "front edge = louder" on those too? (A small later step: a
   velocity-sensitivity knob in each one's extras strip, off by default so existing songs sound the same.)
2. **Aftertouch with a finger.** The CS-80's pressure (and the DX7's) will respond to the Apple Pencil's pressure; a finger on the
   iPad's glass reports no pressure. **Default: Pencil only.** Want a finger gesture too, e.g. after striking a key, sliding the finger
   toward the panel adds pressure?
3. **Bend range.** Every synth bends ±2 semitones today; the originals differ (Prophet-5 about a fifth, OB-Xa an octave, the CS-80
   ribbon about an octave, DX7 per sound). **Default: keep ±2 now** (your recorded bends keep sounding the same). Want each synth to
   bend like its original as a later step?
4. **When the keyboards go live.** The keyboards are built now, beside milestone 3's first phase. They can go live **on their own, a
   day or two after your iPad test session for milestone 3** (that session must come first, so its measurements see today's
   panels), or **together with milestone 3** at its end (several times longer). **Recommended and default: on their own**, right after
   that session — you get them sooner, and we measure the bigger panels on your iPad before milestone 3 builds on them; it costs us
   one extra merge.

**Things you will notice (no decision needed)**: the synths get taller (and the Moog and ARP wider: their keyboards are separate
cases, drawn in front of the console as on a table); the first time you open a project after the update, a module you placed below a
synth that now grows into it moves to the right of that synth (one placed further left stays put, partly covered, until you move it);
the keys sleep below 50 % zoom like the knobs (zoom in or double-tap the synth; tapping a sleeping keyboard says so once); pitch wheels
and benders spring back to centre (the Minimoog's and Prophet-5's originals only had a centre notch); two wheels or levers can be held
at once; the OB-Xa's modulation lever and the Jupiter-8's pad apply modulation while held; transpose buttons on the keyboards (OB-Xa,
ARP) stay dimmed — the keyboard plays its fixed range, the synths' own range / octave switches transpose; the ARP keyboard has no
pitch-bend control (the tray's wheel bends it); the TB-303's keys now sound the note while you write it; the bottom keyboard tray is
unchanged and lights up with the synth's keys; on the Mac, only if you zoom the browser itself to 125 % or more, the biggest panels
(the Moog first) are drawn slightly below full sharpness — at normal browser zoom and on the iPad every panel stays full resolution.

**Answers (the user, 2026-10-20):** 1 velocity — no, the nine stay as the originals (CS-80, DX7, TB-303 respond to where the key is touched); 2 aftertouch — Apple Pencil only; 3 bend range — keep ±2 st for now; 4 timing — **schedule A**: 1i ships on its own right after the user's S0 iPad session (built now on the holding branch `wt-1i`; lane A was already merged at 44d1623, so H edits `main.js` without an exception).

## 11. Notes (the builders fill in)

### Lane K1 (cv-keys.js, cv-panel.js, tools/panel-check.mjs, the K1 tests)

**K1a (the validator and the pure maths; lane K2's base)** — readings taken where §2 left a detail open:
- `ribbon.span` and `pad.rise` are optional (defaults 12 st and 0.25 s, validated > 0 when given); a lever's `axis` / `up` are
  required and must agree: `axis: 'x'` with `up: '+x'`, `axis: 'y'` with `up: '-y' | '+y'` (§2's three directions).
- Every field of a perf `skin` and of `scheme.keys / wheel / lever / ribbon / pad` must be a colour (`colorOk`, as area and
  decor fills): the skins hold colours only, so "no maker name in a skin label" is also checked but cannot fire on a valid one.
- The front band is clamped in `geometry` against the *rounded* body-px hit boxes of the other live controls and the extras
  strip (so `hitBoxes` stays exactly disjoint); `validate` checks the keys' rectangle alone for overlaps — the band, clamped
  by the others, can never overlap one. An inert bed (no id) gets `o.bed` for the art but no band and no hit box.
- A token-like id this build does not know (`perf:pitch`) is reported as "not a control of the model" (was "decoration only").
- `tests/cv-panel.test.mjs`: the per-model bed test (§1.2 range, `o.bed` = `bedLayout` × 2 + the offset, one hit box, the band)
  is a node:test **todo** until a model's layout has its `perf:keys` (then it is a real test); once a layout has its bed the
  size test uses the §1.2 1i targets (± a dot; `PINNED_1I` from K2's hand-back), the ARP's extras lose `gl`, and the pinned
  §10 section order allows the added sections.
- At s = 1.06 px/mm (a CS-80 at k 0.53) 20 px would be 18.9 mm: the 0.8 · pitch cap (18.8 mm, 19.9 px) binds there.

**K1 (phase 2: the engine, the controllers, perfHost, the art and the DOM, the audition, the bench)** — on top of K2's
a8ceaf6 (merged, fast-forward); `PINNED_1I` = K2's hand-back (every model on its §1.2 target), so the per-model bed tests are
real tests now (no todo). Readings and choices:
- **Shades**: a key's dip shows while a pointer of the bed itself holds it (an immediate dip, also on a stale panel that plays
  nothing) or the host lights it (`perf.lit`: keyVis, every source); `release()` clears both. A bed mounts lit (`perf.held()`).
- **Controllers**: the end of a drag posts its final / rest value at once, except a touch that moved nothing (the ribbon's
  "a touch without moving does nothing": no post at all). The pad's ramp posts from its frame callbacks (≤ one a frame).
  `perfHost`'s `sel` gates every post (keys, bend, mod, at); `on` clamps v to 0…1. A controller's window (`o.box` / `o.own`) is
  unrounded like the bed (its hit box stays `rectPx`), so the DOM part sits exactly over its slot's art.
- **Art** (one source, `perfParts`, mm from the slot): a white key = white + a 2.5 mm front edge (`whiteEdge`); a black key =
  black with a lighter top face inset 0.9 mm and short of its front 5 mm (`blackTop`); the gap colour under the keys. A wheel:
  slot, the surface inset 1.5 mm, 0.6 mm ridges every 3 mm, the centre mark when `detent`; its DOM surface is an opaque CSS
  gradient of the same numbers rolled by `background-position`. A lever: a cap 22 % of the slot's length (6–14 mm), centred
  (bend) or at its rest end (mod). Ribbon: felt and two edges (the DOM adds a touch marker only). Pad: a rounded face (the DOM
  adds its light, opacity = the value). Inert controllers draw the same, dimmed and titled. Defaults `PERF_SKIN`.
- **Tooltips** (mouse hover only): the bed "Keyboard: <the velocity note>"; a pitch control "… · ±2 semitones (the original:
  …)" where §5.3 states the original's range (Prophet-5, OB-Xa, CS-80, DX7, MS-20: `BEND_ORIG`), else "±2 semitones"; a
  control's `tip` (none in K2's layouts) wins.
- **TB-303**: the cells become music zones only when the host has `api.perf` (without it they stay plain buttons, as today).
- **No host** (`api.perf` null: today's main.js until lane H): the same nodes, no listeners, `aria-disabled`, and CSS
  `pointer-events: none` (the bed is then panel art: a finger there pans, as on any art).
- `tests/ui-bench-1i.html` / `.mjs`: `hw5` comes from `?base=<folder with the 1h panels/<id>.js>` (the 1h layouts through
  `__synthTest.panels` in this same app, so only the faces differ); the Mac harness serves an export of 5129c60's panels. On
  the deployed site there is no base: the iPad session gets `hw5k` (first and last), `one`, `paint`, `keys`, the probes. The
  first scene starts with an unmeasured pan and pinch: without it the first measured pan showed one 130–150 ms frame on the
  Mac in both runs (a cold first burst; `hw5` and the last `hw5k` never did). The key latency is the engine alone (a stand-in
  over the bed) until lane H gives the app `api.perf`; reviewer 2 re-measures it on the host path.
- After the merge with K2, `tests/canvas-sim.test.mjs` fails 3 tests on the Minimoog's size only (1408 × 512 pinned there, now
  1408 × 736): lane H's size updates (§8.1). No other change in the sims; `main.test` and `classic-panel.test` pass.

**"ui-1i-mac"** (informational: headless Chrome, `--use-angle=metal`, dpr 2, M4 Max; `ui-bench-1i.html?base=…` at 1440 × 900
and 1366 × 1024, the app 1416 × 558 / 1342 × 635; K2's layouts a8ceaf6; three runs at 1440 × 900 (the frames from the one with
the warm-up), one at 1366 × 1024; ranges over the runs):
| measure | result | gate |
|---|---|---|
| `hw5k` pan / zoom / deep (and the last `hw5k`) | median 16.7 ms, p95 ≤ 16.8, max 16.8, 0 frames > 33 ms; drift 0 | no frame > 33 ms ✓ |
| GL draw (`hw5k`, pan / zoom / deep) | mean 0.015–0.031 ms, max 0.2 | mean ≤ 1 ms ✓ |
| `glStats().bytes` | `hw5k` 180.1 MB (`hw5`, the 1h faces: 116.2 MB) — the §3.3 estimate exactly | ≤ 384 MB ✓ |
| one CS-80 face (base + mips) | 51.05 MB | ≤ 58 MB ✓ |
| first base paint (raster + upload) | modular 5.7–5.8 ms, CS-80 4.0–4.4, ARP 2.9–3.2, Juno-60 1.7–3.2, OB-Xa 1.5–2.4, JP-8 1.8–2.5, DX7 1.6–2.5, MS-20 2.0–2.3, Minimoog 1.8–1.9, Prophet-5 1.7–1.8, Solina 0.8–0.9 | B1 on the iPad (> 100 ms) |
| key press (pointerdown dispatch; the engine alone) | median 0.1 ms, p95 0.2, max 0.2 (40 presses after 4 warm-up) | ≤ 1 ms ✓ |
| G1 `equalPx` (CS-80, Prophet-5, JP-8 faces, k 0.6 and 1.6, the window landed) | equal, 0 bytes differ (mid-burst and rest) | ✓ |
| shades vs their keys' art (GL pixels: black keys' sides and fronts, E–F / B–C gaps) | CS-80 max 0.098 / 0.109 / 0.155–0.20 device px at k 0.5 / 1 / 1.6; Prophet-5 0.099 / 0.107 / 0.14–0.149; JP-8 0.107 / 0.126 / 0.19 (85, 68–71, 41–44 edges each) — the GL path offsets nothing | ≤ 0.5 px ✓ |
| wheel / lever windows vs their art | Prophet-5 wheel surfaces ≤ 0.036 device px, the JP-8 bender's cap ≤ 0.027 (k 1, 1.6); the DOM and the art side by side at k 1–1.5 (Prophet-5 PITCH, OB-Xa MODULATION, JP-8 BENDER): identical to the eye | exactly over ✓ |
| the bed region, GL vs `?nogl` (CS-80, Prophet-5; k 0.5 and 1; the same camera) | 100.000 % of pixels within 8 / 255 (max difference 0–1) | ≥ 99 % ✓ |
| console errors | none | ✓ |

### Lane H (main.js §6.2, classic-panel `api().perf`, gesture.js G1, cv-world G2 + `sleeptap`, the host sims)

On `wt-1i` e424c76 (K1 + K2 + canvas with lane A's R7). No K file touched. Readings and choices:
- **main.js**: the §6.2 sites only (+19 / −6 lines): the import; `PERF` beside `classicHost` with exactly §6.2's deps, and
  `classicHost.perf`; `keyVis` → `PERF.lit`; `ctl` → `PERF.live` when the selected track is in `to` (trs + `wheelTracks()` for
  'wheel'; never 'sus'); the `noteOn` guard; `seqPayload` `root: cvKeys.SEQ_ROOT`, `seqToRoll` `cvKeys.seqNote(s)` (bytes
  unchanged); `PERF.release()` in `panic` (before its held-note loop: the beds' offs go through `noteOff` like the rest),
  `powerOff` (beside its held-note clearing), the hidden page and the window blur — at those two sites, not inside
  `releaseKeys` (a Meta keyup calls that one: it would end the notes held on the beds); the `sleeptap` hint wired with the
  world's other events in `initModules` (a flag per session); `__synthTest.cv.perf`. No accessor read added (the ratchet holds).
- **gesture.js G1**: in `partner()`, `qp` (q is perf): `perf && qp` → skip; the late clause needs neither p nor q perf; a music
  p keeps its rule (time only, never a perf q). The header says so.
- **cv-world G2**: in `onDownCap`'s further-touch branch, before `take(e)`: `G.kind 'pan' && !G.moved && !G.sleep && now() −
  G.t0 > PAIR_MS` and the target inside a module's `[data-gesture=music]` that is awake — `!(k < READ_K && sleeper(t))`, i.e.
  sleeper's own rule (a module in edit state is awake below READ_K too). `PAIR_MS` is imported from gesture.js (it imports
  nothing: no cycle). It sits before the 'Zoom page' branch as §4.3 places it, so in that mode a late key plays too (the bed is
  touch-action none: the browser could not pinch there anyway). `sleeptap { id }` is emitted on a sleeping module's single tap
  whose target is in a music or perf zone — a double-tap's first tap emits it, its second (focusing) tap does not. Nothing in
  `canvasStats` / the budget (lane C's).
- **Failing tests first**: G1 (gesture.test: perf + perf ≤ 250 ms → a nav session, the second press eaten; a wheel held still
  600 ms + a knob → a session), G2 and the hint (cv-world.test: no pointerdown on the key 400 ms after a resting finger; no
  event), `noteOn(NaN)` (canvas-1i-sim with the old guard: NaN posted and held). Each failed before its fix.
- **The sims**: `tests/canvas-1i-sim.test.mjs` boots `#cs80` with the Chromium clock (a press's timeStamp is the recording's
  clock) and canvas-sim's scripted world, whose factory also makes the tray wheels' `.slot` / `.thumb` stable nodes (the stub's
  `querySelector` makes a new node per call) so a test drives the tray's wheel and reads its view. The tray's keys are reached
  as the computer keys (the same `noteOn(n, v, 0)` path; the stub's tray key elements are not reachable). A stale panel is a
  panel whose track is no longer `selTrack` before the view is rebuilt. Accessor-free: under the strict accessor hook it
  records one site, `cv-module.js:733` (`T.model` in a try — lane C's; canvas-sim records the same), none in tests/.
- **Sizes**: canvas-sim's Minimoog 1408 × 512 → 1408 × 736 (7 places); cv-fixes-sim needs no change (its default-camera test
  fits the instrument's actual width; no size pinned). `sw.js` precache rebuilt (this lane's commit carries it).

**Host / sims gates** (one file at a time): canvas-1i-sim 12 / 12, gesture 53 / 53 (+3), cv-world 58 / 58 (+3), main 38 / 38
(+1), classic-panel 9 / 9 (+1), canvas-sim 22 / 22, cv-fixes-sim 5 / 5, lint 127, pwa 22, cv-keys 19, cv-panel 72, cv-face 26,
canvas-1e-sim 24, canvas-2a-sim 26, canvas-2b-sim 23, cv-shell-sim 16, accessors 30 — all pass. Sound (I1), once at the end:
golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, canonical-stream 1 — bit-identical; no DSP /
compile / `models.js` file in the diff.

**The host path in headless Chrome** (`--use-angle=metal`, dpr 2, M4 Max; this worktree served on its own port):
| measure | result | gate |
|---|---|---|
| key press, `ui-bench-1i.html?only=keys` (now `host: true`: pointerdown → `perf.on` → `noteOn` → `postTo`) | 1440 × 900: median 0.1 ms, p95 0.3, max 0.3 (two runs); 1024 × 1366: 0.1 / 0.2 / 0.3 | ≤ 1 ms ✓ |
| the same press with the node's `port.postMessage` wrapped (smoke) | the `{t: 'on'}` posted inside the dispatch 40 / 40; median 0.1, max 0.2–0.3 ms | same task ✓ |
| the full bench at 1440 × 900 (no base) | `hw5k` and the last `hw5k` median 16.7, max 16.8, 0 > 33 ms, drift 0; GL mean ≤ 0.023 ms; 180.1 MB; one CS-80 51.05 MB; paints ≤ 5.4 ms (modular); G1 equal; shades ≤ 0.19 px; slots ≤ 0.036 px; no error | every gate ✓ |
| smoke, 1440 × 900 and 1024 × 1366 (synthetic multi-touch, `Input.dispatchTouchEvent`) | a CS-80 chord of three fingers 40 ms apart at k 0.54 / 0.5: on 60 / 64 / 67 at v 0.9 (80 % deep), all off at the lift, no shade left; the ribbon +80 px → bend 0.913 / 0.98, 0 at the lift, the tray's wheel back at centre; a pinch over the keys at k 0.4 → k 0.76, no note; a tap on the sleeping bed → the hint; the Prophet-5 pitch wheel while a key is held (bend 0.563, the note kept), both wheels at once 80 ms apart (bend 0.563 + mod 0.281, both shown on the hardware wheels; bend 0 and mod kept at the lift); no console error | ✓ |

### Fixes (review 1)

Reviewer 1 (real host: `scratchpad/1i/review-1.md`, against a5d9157). Each was reproduced, a failing test added, then fixed; the
reproductions `r1-sim` / `r1-world` / `r1-sweep` (its F6 check is synchronous: Space's play is async, the repo test settles) pass.

| finding | cause | fix | test (failed first) |
|---|---|---|---|
| F1 P0 stuck note: Undo / Redo / a load / the Undo of a Replace with a bed key held | `applyRestore` swaps in new track objects; the old panel's destroy → `perf.off` fails `sel()` (`trOf(v) === trk()`) | `PERF.release()` right after `applyRestore`'s `if (!p) return` | canvas-1i-sim "review 1 F1" ×2 (off posted, nothing held / lit, silent) |
| F1b P0 stuck bend / aftertouch: Undo with a wheel or a Pencil held | the spring's `bend(0)` / `at(0)` dropped by the same gate | the same release | "review 1 F1b" (bend 0, `perfValue` 0, the new wheel at rest; `at` 0) |
| F2 P1: a track switch with a wheel / Pencil held leaves the old track bent / under aftertouch | beds released only when the old view is destroyed, after `selTrack` moved | `PERF.release()` in `selectTrack` after its early return, before `selTrack` changes | "review 1 F2" (A's last bend 0, B never bent, `at` 0) |
| F3 P1 stuck lit key: deleting the selected track with a bed key held | `deleteTrack` moves the selection before the views go | `if (project.selTrack === t.id) PERF.release()` before the splice | "review 1 F3" (nothing held / lit; another track's delete leaves the key) |
| F4 P2 wrong light: a blur / hidden page darkens the bed of a MIDI / tray note still sounding | `PERF.release()` → each bed's `host.clear()` | `perfLetGo()` (main.js): `PERF.release()`, then `PERF.lit(n, true)` for every note still in `held`; cv-keys' pinned `host.clear()` kept | "review 1 F4" (blur and hidden page: only `1:62` held and lit) |
| F5 P1: a finger resting on the canvas silences the hardware wheels / levers / ribbon / pad (G2 covered keys only) | cv-world `onDownCap`'s G2 test: `zoneIn(…, 'music')` | `zoneIn(…, 'music') \|\| zoneIn(…, 'perf')` (still asleep below READ_K) | cv-world "1i G2 (review 1 F5)" (wheel after 400 ms plays; 100 ms: nav pinch; a moving pan and k 0.4: the world's) |
| F6 P2: a pointer-focused controller takes Space / Home / the arrows | `controller`'s keydown ignored how it was focused | `byPtr` (set at a press that focuses it, cleared at blur): the keydown returns first; a Tab focus, or a press on an already keyboard-focused one, keeps the keys | cv-keys "controllers (review 1 F6)"; canvas-1i-sim "review 1 F6" (Space starts the transport, the Mod Wheel keeps 0.6, Home reaches the page) |

Left as it was (out of 1i's scope, reviewer's note): the tray's own bend wheel held across a track switch springs to the new
track (pre-1i); a computer / MIDI note held on a track that is deleted ends at its own lift (no stuck state).

### Fixes (review 2)

Reviewer 2 (headless Chrome: `scratchpad/1i/review-2.md`, against a5d9157). P1-1 (a resting finger silences the controllers) is review 1's
F5 above (d3b86b8). Fixer B's rows, each with its test written and seen failing first (P2-3's is the new `tests/ui-bench-1i.test.mjs`):

| finding | cause | fix | test (failed first) |
|---|---|---|---|
| P1-2 low contrast: a pressed white key's shade darkens half of each neighbouring black key (CS-80 k 1: 18.4 px of D♯4, luma 43 → 35) | `bedWidget`'s `.hw-kd` of a white key is the key's full rectangle, which runs under the black keys the art draws over it | each white shade gets a static `clip-path: polygon(…)` (px, shade-local, built once from the neighbouring black keys of `o.bed`): the narrow top between the blacks + the full-width front; the black shades are not clipped | cv-panel "review 2 P1-2" (every model's bed: 358 white keys, 347 clipped; the polygon inside its key, leaving out every overlapped black rect, its area = the visible white). Headless: black neighbours' luma 43 → 43 at k 0.5 / 1 / 1.6 (CS-80, Prophet-5); the shade alignment gate (bench probes) max 0.2 device px (CS-80, Prophet-5, JP-8 at k 0.5 / 1 / 1.6) |
| P2-1 the default camera opens tall instruments with the keyboard below the fold (ARP 0 % of its bed at 1366 × 1024 and 1440 × 900, modular 0 % at 1440 × 900, MS-20 18 %, Minimoog 34 %, …) | `cvCamRestore` fitted the width only and anchored the top-left; the band is the viewport less the toolbar / minimap box at its foot (1278 × 432 px at 1366 × 1024, 1352 × 308 at 1440 × 900) | an instrument with a hardware bed (`cvBedBox`: its `o.bed.box` from `cv-panel.geometry`) also fits its height into the band (`k = max(READ_K, min(1, kw, kh))`, the side-by-side FX test too); when it still does not fit (READ_K floor) the camera slides up / left the least that puts the whole bed inside the band, its top / left edge first. A model without keys (TB-303), Serum, the Simple layout: today's width-only fit; a saved or moved camera is untouched; the U14 reserved-box loop is as it was | canvas-1i-sim "review 2 P2-1" (the 11 models × the 3 measured bands: the whole bed in the band, k as the formula, the fitting ones top-left, the others slid up / left, the TB-303 and a saved camera unchanged; 33 cases: 27 slid, 6 fit). Headless defcam at 1366 × 1024, 1440 × 900, 1024 × 1366: every model 100 % of its bed in the viewport and in the band (was 0–100 %) |
| P2-2 the Solina's extras box covers 14 mm of the left walnut cheek | `extras.at [8, 55, 205, 42]` over the cheek decor x 0–22 | `at: [22, 55, 191, 42]` (the box starts at the cheek's inner edge; the caption still fits, `over` false); the panel's note updated | cv-panel "review 2 P2-2" (the extras at or right of the cheek's edge, valid, no `over`, size 1984 × 448 as pinned); `panel-check solina` clean |
| P2-3 the bench's warm-up hid the first pan (a cold 130–150 ms frame once on the Mac, not reproducible in 13 fresh-profile runs) | the first scene's pan / pinch ran unmeasured | `firstBurst` (ui-bench-1i.mjs): the page's first pan and pinch are measured as their own phases (frames, median / p95 / max / > 33 ms, the worst three, the GL draws) into `R.firstPan` — before anything is warm, never a gate (`gates()` ignores it); the table shows "first, unwarmed · pan / zoom" rows. The iPad session reads whether WebKit hitches on first use | tests/ui-bench-1i.test.mjs (firstBurst: a pan then a pinch, each measured; gates: a 500 ms first pan fails nothing). Headless 1366 × 1024: first pan / pinch 16.7 / 16.8 ms max, 0 over 33 |

Existing sims that encoded the old width-only fit: canvas-sim / canvas-1e-sim / cv-fixes-sim script a band 160–300 px taller (860 / 860 /
1000: a 1i Minimoog is 736 px, a Prophet-5 864) so their k = 1 assertions stay as they were; cv-fixes-sim's portrait-band case, where the
instrument cannot fit at READ_K, now asserts the slide (top-left anchor when it fits; else slid left only, the whole bed in the band).

## 12. Review log (revision 2, 2026-10-20: the skeptic review against e9cd1b9)

The reviewer's two scripts (`scratchpad/1i/skeptic/s1.test.mjs`, `perf2.test.mjs`) were re-run for this revision and reproduce: k 0.4
two fingers on a bed → the world pinched 0.4 → 0.876, no pointerdown on the keys; k 0.6 → a chord; a finger on the art then a key
400 ms later → no pointerdown, no session; 100 ms → a nav session; two `perf` zones ≤ 250 ms (moved) or held still 600 ms → a nav
session and the second press eaten; 600 ms after a moved first → independent. The code claims were read at e9cd1b9 (`SEQ_DEF`,
`seqPayload` 3013 / `seqToRoll` 3037 with literal 48s, `noteOn`'s guard 1562, `ctl` 1597, `validate`'s `T` 235, `rectPx`'s `r05`,
`partner()` 149–158, `onDownCap` 1048–1057, `makeRoom` in cv-module.js, `baseLevel` in cv-face.js).

| # | point | verdict | where |
|---|---|---|---|
| P0-1 | TB-303 audition pitch NaN (`q.root` does not exist), NaN passes `noteOn`'s guard, one `SEQ_ROOT`, the guard, a test against `seqToRoll`, capture, two cells | **accepted**. `SEQ_ROOT` lives in `cv-keys.js` (not beside `SEQ_DEF` in classic-panel.js: classic-panel imports cv-panel, so cv-panel cannot import it back; main.js is H's); `perfHost.on` also drops a bad note | §6.1, §6.2, §6.4, §9 |
| P0-2 | S1's premise is false: the world already takes a second finger on a sleeping bed as the pinch | **accepted** (reproduced). S1 (`data-cv-sleep`, the `zoneOf` change) dropped; one regression test kept | §4.3, §9 |
| P0-3a | perf + perf pair (two wheels, two levers, lever + pad); decide wheel + knob | **accepted**: G1 — perf never pairs with perf; perf pairs with anything else by the time rule only (decides wheel + knob: together = pinch, a held controller + a knob = independent). Also changes the tray (one perf zone), stated | §4.3, §9 |
| P0-3b | a resting finger on art / canvas (`G`) takes any later key as its pinch finger | **accepted** (reproduced): G2 in `onDownCap`, replacing S1 in lane H's cv-world slot; both orders tested | §4.3, §9 |
| P1-4 | front-edge and black-key tolerance | **accepted with one change**: black keys get a screen-px minimum hit width in `keyAt` (as proposed, capped 0.8 pitch); the front slop is a **fixed 8 mm world band** clamped per layout, not a screen-px slop — the DOM hit box would otherwise have to be resized at every zoom end, and a fixed band keeps the tests deterministic (8.5–11 px at fit zoom). Art unchanged | §1.1, §2, §4.1, §4.2, §9 |
| P1-5 | the 0.5 px shade gate vs `rectPx`'s 0.5 world px rounding | **accepted**: `o.bed` unrounded (mm × 2, three decimals); the gate stays 0.5 device px | §2, §3.1, §9 |
| P1-6 | `PERF.live` after every `ctl` is too broad | **accepted**: only when the selected track is among the targets | §5.2, §6.1, §6.2, §9 |
| P1-7a | `hw5` / `hwm` gates recorded on 1h faces; a 1i miss could flip D-R5 | **accepted**: `hw5k` is its own reference; the IMPL-3 amendment text is in §8.3 for the lead to apply (this lane may write only this doc) | §3.3, §8.3 |
| P1-7b | first iPad numbers only at M3's deploy; K1 owns the bench and runs it in CDP | **accepted, adapted**: a new page `tests/ui-bench-1i.html` + `.mjs` instead of a `?keys=1` hook (S0 owns `ui-bench.html` in phase 0); 1i is one squashed commit | §8.1, §8.2, §9 |
| P1-7c | "ships with M3" may be weeks; tell the user or merge H early | **accepted**: schedule A (after the S0 session) recommended, B kept; question 4. Before the S0 session: refused (S0's envelope) | §8.2, §10 |
| P1-7d | commit IMPL-1i.md and ROADMAP.md before the worktrees | **accepted**: step 0 (the lead) | §8.2 |
| P1-7e | K2 needs K1's validator; K lanes must not commit sw.js | **accepted**: K1a first, K2's base = K1a; no lane commits sw.js | §8.1, §8.2 |
| P1-7f | `canvas-1i-sim` must pass lane A's accessor hook and ratchet | **accepted** | §6.2, §8.1, §8.3 |
| P1-8 | `validate()` reads one per-model token table; DX7 mixes; "at most once" for `T === null` models | **accepted** | §2, §9 |
| P1-9 | JP-8: 36 × 23.17 = 834.12 > 834 | **accepted**: pitch 834 / 36 (exactly 834 in floating point) | §1.1, §1.2, §2, §9 |
| P2 | keyAt property test; stale pointer; tray + bed same note; Ctrl-click; spring via `release()`; no `api.perf` → same nodes | **accepted** | §9 |
| P2 | "`baseLevel` at dpr 2.5: the three largest faces fall to ≈ 0.97" | **partly wrong**: at dpr 2.5 only the modular falls (0.974); the ARP and CS-80 hold to dpr 2.57 / 2.59 (`baseLevel` computed for each 1i face). The test is added with the right numbers | §3.3, §9 |
| P3 | velocity note on the bed | **accepted** (aria + hover tip; Q1 kept) | §3.2, §10 |
| P3 | sleeping keys give no cue | **accepted**: a once-per-session hint on a tap (`sleeptap` → `notice`) | §4.3, §6.2 |
| P3 | Pencil aftertouch assumes force-only pointermoves | **accepted**: marked unverified, iPad step added | §4.4, §9 |
| P3 | the ARP 3620 bend and the 951 key count left to photos | **accepted**: decided in the contract (no ARP bend control; 951 61 keys, secondary source) | §1.1, §1.2, §5.3 |
| P3 | `makeRoom` moves a module below an instrument to the far right; say so | **accepted**, plus one case the review missed: a module below whose left edge is left of the instrument's is not moved and stays covered (the face drops to the 'dom' tier until moved) | §7, §10 |
| P3 | dpr 3: record the exemption | **accepted, with a correction of scope**: today (1h) every face is 1:1 up to dpr 3, so 1i introduces this; it reaches the Mac at ≥ 125 % browser zoom, so the user is told rather than only recorded | §3.3, §10 |
| — | "Checked and fine" (key counts, offsets, sizes, GPU memory, note path, key-then-wheel, chords at k ≥ 0.5) | agreed; nothing to change beyond citing the checks | §1.2, §3.3, §6.3 |
