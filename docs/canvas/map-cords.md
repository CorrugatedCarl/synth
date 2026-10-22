# Stage 9 mapping: cables, jacks, many-module rendering, rope physics (mapper's report, 2026-10-21)

Repo `canvas` @ 8aab46f, read-only. Line refs are to that tree. *Recorded* = a number in the repo's docs/bench.json; *estimate* = my arithmetic (nothing
was run: no WebKit, no iPad); every estimate is a gate for a ui-bench scene (§6). Lead's late decision folded in: cables WILL have simple jiggly physics (§4 says HOW).

## 0. Answer in 12 lines

1. Cables are **DOM SVG inside `#world`** (two layers, `cv-cables.js:464-477`); one cubic bezier per cable, horizontal tangents, **no sag**, 4 px stroke from `--ik`
   (CSS 1084-1092). They ride the camera by compositor-scaling (soft mid-pinch, `--ik`/ends/badges re-cut at `cameraend`, `cv-cables.js:656`). Audio cables lie UNDER
   the modules by design (SPEC 2.9: "a cable over a knob never steals its touch"). Stage 9 needs cords OVER the panels, so the layer order must change.
2. The jack machinery (`createCableDrag`, `cv-cables.js:894-1230`; `.cv-jack` DOM, `data-cv-jack`) is generic and reusable. The **data model is not**: `cv-graph.validate`
   allows one output per DEVICE (`fan-out`, `cv-graph.js:234`), no cycles (237), three device kinds (`PORTS`, 146). Stage 9 needs its own patch graph (many-to-many, feedback).
3. Rendering: the S0 iPad session (bench.json `ui-m3`) says the iPad stutters from **painted DOM**, not cables: sx1 (1 866 painted el) P+, hw5 (2.8 k) borderline,
   p1x (3 176) one settle frame over, t2 (~6 k, ~32 cables) / t3 fail. A modular module is light (~13 control entries, ~80 painted el): **~25-30 modules ≈ the P+ line (estimate)**.
4. Physics: **do it on the GPU in a layer ABOVE `#world`** (a 2nd WebGL2 canvas, pointer-events none), world-space rope per cable (verlet, ~10 pts), camera only as a
   uniform, so a pinch costs the same as today's grid draw (~0.03 ms). CPU per awake cable ≈ 5-10 us (estimate); asleep = 0; idle app = no rAF.
5. SVG ropes are feasible for a handful of swaying cords but a bad bet for "dozens": ~11 SVG nodes/cable with 3 stacked strokes + plug circles, all re-rastered by WebKit
   (render-in at rest, the thing the user rejected for DOM in 1h/3R).
6. Jacks: ONE signal kind for all 900-series jacks (as on a Moog), direction only; audio/CV/gate = a role hint, never a refusal. Bridge to the app's `mod`/`note` jacks
   through interface modules, not direct cords.

## 1. Cables today

### 1.1 Drawing (cv-cables.js, style.css)
- Two `<svg>` children of `#world` built in `createCables` (`cv-cables.js:466-477`): `svg.cv-cables` z 0 (under the modules: audio cables, mod-cable bodies) and
  `svg.cv-cable-ends` z 10000 (the last END_PX = 24 screen px of each mod cable, the live cable, amount badges are HTML `button.cv-mbadge` in the world). Each svg is sized to the
  union bounding box of its cables + PAD 48 (`place`, 686-695), `overflow: visible`, no viewBox (1 user unit = 1 world px). CSS: `svg.cv-cables … pointer-events: none` (style.css:1084).
- Per cable: `g.cv-cable-g[data-cable][data-kind]` > `path.cv-cable-hit` (transparent, 12 px mouse / 24 px touch, `pointer-events: stroke`, CSS 1086-1088) + `path.cv-cable`
  (the visible stroke) + optional `text.cv-cable-lab` (`set`, 549-595). Mod cables add an over-layer twin `path.cv-mend` and a badge (`modParts`, 494-548). 2-3 SVG nodes/cable (+ badge).
- Path shape: `cablePath` (190-193) = one cubic, tangent d = max(40, |dx|/2): `M x1 y1 C x1+d y1, x2-d y2, x2 y2`. **No sag, no gravity, no sway.** The midpoint is the chord midpoint
  (label above it, x button on it, 629). `tail()` (420-433) splits the cubic at the arc length of END_PX (24-chord sampling) for the over-layer end.
- Colours: audio = source instrument `dev.color`, else the track's, via CSS var `--cc` on the group (`cablesOf`/`mk`, 258-264; fallback `#8d8b86`, CSS 1085); powered-off/solo-excluded
  source = grey `.cv-off` (CSS 1145). Mod = source module kind `MOD_COLOR` (69-70: wheel `#4fb3d9`, velo `#e8a33d`, at `#b98ae6`, bend `#63c98a`, lfo `#ff7f5a`, env `#d9c84a`,
  macro `#5b8cff`, cc `#9aa4b2`, chaos `#e05fb4`, note `#7fe0d6`); Pads: the pad's lit colour (`padColor`, 373-377); Serum internal: the Serum's colour (`internal`, 293-309).
  Widths: audio 4 (sel 6, hl 5), internal 3, mod 2 (preset 1.25), all `calc(Npx * var(--ik))` (CSS 1085, 1143, 1191-1194, 1316). Dashed: note cables, stubs, per-note mod, hidden ends.
- **Plug ends: none.** A cable's end is the path's round linecap on the jack (`stroke-linecap: round`); mod cables end on a knob centre. The only "end" artefacts are the 24 px over-layer
  tail and the badge.

### 1.2 Hit testing and editing
- Editable audio cables only (`wire` ids; read-only ones `[data-ro]` take no pointer events, CSS 1089). Tap = select (`.cv-sel`, floating `button.cv-cable-x` at the chord midpoint, 705-711),
  long-press/right-click = wk menu (Disconnect + host items, 763-770), Delete/Backspace/Escape (755-762). A press that moves > TAP_PX 8 is the canvas pan (U13: no pointer capture; moves and lift
  followed on `document`, capture phase, 778-808; `cv-module.isBackground` treats a cable hit path as background, cv-module.js:212,220).
- Mod cables: body `pointer-events: none` (CSS 1192); only the badge is pressable, and a knob beneath the badge gets the press handed to it (`knob()`/`beneath()`, 506-530).
- Highlight/dim/fade: `highlight(ids)` (823), the `cv-fade` rule past MOD_FADE_N = 24 visible mod cables (668-678) + a one-time hint; ∿ visibility Always/On select/Never.

### 1.3 Drag-to-connect (createCableDrag, 894-1230)
- Installed as the world's jack hook (`setJackHook`, 1216; cv-world `onDownCap` 1118, hook call ~1136-1142): a press on any `[data-cv-jack]` is offered first, so it is never a pan; a second finger
  cancels it (`jackStop`, cv-world 1184-1190, 1249) and the two fingers pinch. After TAP_PX (8 touch / 4 mouse) `begin()` (978-997) marks EVERY jack `.cv-ok`/`.cv-no`(+title reason)/`.cv-from`
  (classList writes on all jacks), sets `#world[data-cv-patching]`, hides the cables being lifted (`.cv-lift`), subscribes to `camera` for edge auto-pan (`W.dragPointer`).
- `follow()` (1075-1109): nearest compatible jack within SNAP_PX 32 screen px, else the first compatible jack of the module body under the pointer (`rects()`); the live cable is `C.live({x1,y1,x2,y2})`
  = the same bezier in the over layer (812-818), 0.8 opacity, 1.0 when snapped.
- Release: `onConnect(a,b)` / `onRepatch(wire,a,b)` / `onRefuse(a,b,why)` (1133-1161); tap/Enter/Space/right-click on a jack = "Connect to…" menu listing only compatible jacks (1172-1197).
  Mod drag (`pressMod`, 957; `beginMod`, 1023-1051; `followMod`, 1052): jack -> `[data-dest]` knob (elementFromPoint), whole-world walk once per drag, `cv-ok` on ok knobs.
- A dragged module re-lays cables per pointermove: `follow(i)` (cv-module.js:693-702) -> `setPos(…, live)` (translate3d, 526-531) -> `onMove('move')` (1108) -> `relay()` (1036) = `ports()` (968-982: every
  module's every jack, O(modules x jacks)) + `cables.layout(ports)` (608-645: per cable `cablePath` + 2 `setAttribute('d')`, mod: `tail()`+badge style writes, then `place()` x2, `vis()`).
  With Snap on (default) the module moves in 32-px steps (`gsnap`, cv-module.js:172, 698): a cord anchor would teleport 32 px per step (see §4.6).

### 1.4 During a pinch / pan; cost per frame
- Cables are not touched by camera frames: `write()` (cv-world.js:592-604) sets `#world.style.transform` only; `#viewport[data-cv-busy] > #world { will-change: transform }` (style.css:810) promotes the
  whole world (cables included) to a layer for the burst; the browser re-rasters it at the burst's end (map-rendering 2.2). Per camera frame cost of cables: ~0 JS.
  Visible consequences (all DOM-only): stroke width and badge font snap at rest (`--ik` written only in `endBurst`, cv-world.js:648-665), mod-cable ends re-cut at `cameraend` (`rezoom`, 656-665, cv-module.js:1180),
  soft/aliased cables mid-pinch. The two spikes the user saw on hw5 (50-80 ms at first move and settle) are layer promotion/demotion rasters ∝ painted DOM, cables a small part (inferred, map-rendering 2.2).
- Per drag frame: JS ≈ O(cables + modules x jacks) with ~3 DOM writes per cable (estimate 0.1-0.3 ms at 40 cables) plus WebKit repaint of the svg's dirty box (unmeasured).

### 1.5 How many cables have been exercised
- Unit tests: the largest fixture is 26 mod cables for the fade test (`tests/cv-cables.test.mjs:600-605`); the rest 2-8. `LIMITS.inst` 8, `panels` 16 (cv-graph.js:144); mod rows: 64 per Serum (`modBudget`, cv-graph.js:773).
- iPad S0 scenes (`tests/ui-bench-m3.mjs` `sceneCables` 626-652): sx1 8 mod; p1/p1x ~12 internal + 8-10 mod ≈ 20; t2 two Serums ≈ 32-40 (the cables are the app's real layer). **All static; none animated; cables were never
  isolated in a scene**, so their own cost is unmeasured. Indirect bound: on `p1x` the `opacity0` floor (cables kept) was P+ and on `t2` P (bench.json `ui-m3.m2`): ~30-40 static SVG cables fit inside a P budget.

## 2. Jacks today

- Kinds (`data-kind`, cv-module.js:454-463): `audio` (default), `mod` (filled dot in `--mc`, CSS 1159), `note` (CSS 1311), `warp` (Serum OSC FM/pitch source, read-only, 1312). Direction `data-dir` in|out (left side = in; VOICE's
  main/direct/note are ins; an inline jack = a `[data-jack="<port>"]` element inside the body, measured module-local once per relayout: MACROS tiles k1-k8, VOICE env1, Pads p0-p63, `measureInline` 479-496).
  Geometry is pure maths (`port()`, cv-module.js:788-795): module x/y + edge (left 0 / right w) or folded JACK_OUT 14 at bar height, y = BAR_H + JACK_Y(28) (+40 steps for VOICE). Dot 16 world px, hit circle 44 screen px at any zoom
  (`.cv-jack::before`, CSS 1081); `touch-action: none` (1133). Specs: `modJacks` 98, `partJacks` 121, `voiceJacks` 133, `entryJacks` 926 (Pads), fx `in`/`out`, OUT `in` (jacksOf 933-940).
- How a jack accepts a cable: audio ins/outs only when `jackPort(T, jack)` yields a model port (cv-cables.js:215: a Serum's own-FX out is `iN.out`; jacks inside a Serum null) and `host.patch !== false`
  (**since 1f every audio cable is read-only**, cv-module `decorate` 1076-1083, so today only Serum parts-view ends and mod-outs are patchable). `data-ro` jacks take no press.
- Validation, source -> destination, by path: **audio**: `cv-model.connect` (cv-model.js:276) trial-validates the whole track with `cv-graph.validate` (cv-graph.js:201-247): dir out->in, ports exist (`PORTS` 146:
  inst out / panel in,out / out in), dup, fan-out forbidden (234, per device), panel->panel chain forbidden, cycles forbidden (237), a Serum's own FX only that Serum; returns {ok, why, code, fix}. **Serum internals**: `sxCan`/`sxConnect`
  (main.js:6346-6361) via sx-edges `setEdge` (one History step each). **Mod**: `modCan` (main.js:6942-6955) = `cv-mods.destOk` per class (588-604) + the 64-row budget; `[data-nomod]` knobs refuse.
  `check()` (cv-cables.js:932-938) turns every refusal into the jack's tooltip while dragging.
- Pad jacks (stage 8): `pd1..pd8` modules carry their jacks in the device entry (`entryJacks`); 64 inline mod jacks p0-p63 per 8x8 grid with `hide` flags (no rebuild at a Grid change), `modSrcPort` regex
  (cv-cables.js:115-121), colour = the pad's (373); a `notes` jack (kind note) that is never patchable; note cables are derived, dashed, end at a fixed point on the instrument's left edge (`NOTE_END`, 381; no jack there).
  This is the precedent for "many jacks on one module, mostly cabled rarely": fine at 64 per module because dots/anchors are DOM `span`s.
- Hardware panels already draw the modular's jacks: `panels/modular.js` has 144 control entries over 11 module areas (80 jacks, 37 knobs, 13 switches, 6 rotaries, 5 strigs, 3 lamps), 115 `inert: true`
  (art only; cv-panel `inert: 'later'` = "cable-able with full patching", cv-panel.js:17, 175, 424-427). Jack positions are static mm x 2 px/mm: **no measuring needed for ports**.

## 3. Rendering budget for many modules

### 3.1 S0 on the iPad (IMPL-3 §9.0; bench.json `ui-m3`; Chrome for iOS 155, Pro, build bd6d7ca2ad50, "my zoom speed was really inconsistent")
| scene | content | burst med/p95/max/>33ms | first | settle | verdict |
|---|---|---|---|---|---|
| hw5 (x2: first/last) | 5 GL-face hardware panels (2.8 k painted + 3.9 k hidden) | 17/19/83/9 ; 17/18/85/45 | 52 ; 81 | 64 ; 78 | fail P+ (the 1h-era single 50-90 ms frames; second run 45 frames > 33) |
| sx1 | one bundled Serum + 8 cables (1 866 painted) | 17/18/30/0 | 35 | 52 | **P+** |
| p1 | Serum (complete) in parts | 17/17/36/1 | 30 | 57 | P |
| p1x | opened Serum in parts + 6 modulators (3 176 painted) | 17/18/50/7 | 37 | **106** | fail by one settle frame (else P) |
| hwm | hw5 + 6 modulators | 17/18/36/3 | 68 | 77 | P (smoother than hw5 alone) |
| t2 | two p1x Serums (~6 k painted, ~32+ cables) | 20/62/198/203 | 88 | 243 | **fail** (only `opacity0` reaches P) |
| t3 | Serum + OB-Xa + Jupiter-8 + CS-80 + FX | 17/19/116/8 | 92 | 110 | fail |
  M2 policies on p1x: `layers`, `noWC`, `opacity0`, `none` P+ (`layers` = H6 candidate, not adopted); on hwm every variant fails incl. `opacity0` (cost not DOM paint there). M4: H5 keeps every canvas >= 1.0 at rest.
  M5: no tab loss; a 60 s k-sweep on t2 had 226 frames > 33. P1 probe: SVG foreignObject via a `data:` URL is NOT tainted on iPadOS 26 (blob URL is); P2: Worker OffscreenCanvas text 12 ms/2125 strings.
  Verdict used: sx1-level scenes are the "on by default" line; **painted DOM element count is the driver** (map-rendering 2.2/2.4; the lead's `SX_HEAVY = 1866`, IMPL-3 §9.9).
- 1h recorded (IMPL-1h §9.4): one hardware panel 17 ms median, max <= 21, none > 33; five panels one 50-80 ms frame at a pan's first move/settle per phase; glStats draws <= 1 ms; 116 MB of face textures for five big panels;
  `winPx` bottomed at 4e6 (window paint 79 ms on the device) so above 100 % the base texture shows (accepted). User: "pinch zoom feels great. no hitching."

### 3.2 GL face path (what a modular module would ride)
- One WebGL2 canvas `.cv-gl` inserted BEFORE `#world` in `#viewport` (cv-gl.js:151-157; CSS style.css:801-804, no will-change); `world.write()` -> `gridAt()` -> `glDraw()` draws the grid shader + every face quad each written frame
  (cv-world.js:574, 519-524; measured mean 0.02-0.04 ms). All 12 `panels/*.js` hardware faces go GL when mounted, not folded, and not intersecting another world item (overlap rule IMPL-1h §3.5; 'dom' tier fallback); the face SVG
  stays in the DOM `visibility: hidden` (G5); controls (`.hw-c` widgets) + module chrome stay DOM over transparent bodies (`[data-cv-face="gl"]`). Base texture L0 = min(dpr,3) mipmapped; windows above k = 1 (iPad: base only).
  Budgets: `FACE_BUDGET_BYTES` 384e6 (cv-face.js:23), `WIN_BUDGET_PX` 40e6, 12 bases total 247 MB at dpr 2 (IMPL-1h §8); a 108x222 mm modular module = 216x444 px ≈ 1.5 MB at L = 2 (+mips): 40 modules ≈ 60-80 MB (estimate).
  One quad draw per module (uniform block each): 40 modules ≈ 0.3 ms (extrapolating 5 quads = 0.035 ms; estimate).
- DOM budgets: the world's soft cap `BUDGET_EL = 9000` (cv-world.js:77, 884-888) warns only. Whole modular cabinet today: 1 858 el (563 controls + 1 295 hidden face SVG; map-rendering 2.3) for 144 control entries
  ≈ 4 nodes per entry. A split modular module (13 entries avg incl. ~7 jacks, + ~15 bar nodes) ≈ **60-90 painted el** + ~100 hidden SVG (estimate).
- **What limits 20 modules + 40 cables on the iPad (estimate)**: 20 modules ≈ 1.6-1.8 k painted el ≈ sx1 (P+); 30 ≈ 2.4-2.7 k ≈ hw5 (borderline); 40 ≈ 3.2-3.6 k ≈ p1x (fail by a frame). So ~25-30 modules is the
  comfortable line, ~40 the "P" line, until measured. 40 cords on top are <= 440 SVG nodes if done as SVG ropes (§4.3), ~0 painted DOM if GL. No displays/canvases on analog modules (only a scope/meter if added), so the S0 canvas costs do not apply.
- Other per-module costs that scale with module count: bar chrome (~15 el; a 1-MU module is only 108 px wide, narrower than the 40 px bar's title+power+⋯+▾, so a compact bar is needed), `world.recache`/`planScreen`
  rect caches per item (cv-world `recache` 798, `planScreen` 344, `screen` 864), `ports()` O(modules x jacks) per drag move (250 jacks ≈ 20 us), `begin()` of a cable drag writes classes on ALL jacks (250 restyles + box-shadow glows: move halos to the cord layer, §5).
- What earlier stages recommended for "many modules": **1h** GPU for static art + DOM controls, overlap rule, budgets; **M3 (D-R1..R5)** parts opt-in, hygiene H1-H7, painted-element notice on touch past 1 866, several instruments per
  track stay withdrawn because t2/t3 fail (D-R4); **map-rendering/3R** stages 3R-1 hygiene (drop hidden face SVGs in gl mode: −3.9 k of 6.6 k nodes in hw5, not done) -> 3R-2 displays to GL -> 3R-3 whole-module painter
  (XL, risk H, parked by the user) -> **3R-4 "cables, badges, halos to GL: strokes in screen px every frame (also fixes the --ik snap and cables-over-art z-order)"**. Stage 9's cord layer is 3R-4 pulled forward for cords only.

## 4. Physics of a sagging, swaying cable: HOW (the decision is made)

### 4.1 Model
- **One rope per cord, world-space, verlet.** Points P0..PN (N = clamp(round(L/28), 6, 14), 10 typical): P0/PN pinned to the two jack centres (module x/y + `port()`, so moving a module IS moving the anchor); interior points
  integrate `p += (p − prev)·damp + g·dt²`, then `its` Gauss-Seidel passes of distance constraints (rest = L/N), then a bending blend (`p[i] += (mid(p[i−1], p[i+1]) − p[i])·b`). Fixed step 1/60 s with an accumulator (120 Hz iPad Pro: 0-1 steps
  per frame, max 2). No cord-cord or cord-module collision (cords just overlap, as real ones do in a front view).
- **Length and rest shape.** L = (1+ε)·D + c with D = |A−B|, ε = 0.10, c = 24 world px (min L = 1.02·D); a ±8 % per-cord jitter seeded by the cord id so parallel cords do not lie on one another. Parabolic sag of a slack cord s ≈ D·√(3ε/8)
  (ε 0.10 -> 19 % of the span; D 400 -> ~76 px). L is **recomputed only when the cord would be stretched (D grows) or at (re)connect/load**, never shrunk while connected (modules pushed together leave a real loop; "Tidy" or a re-patch resets).
  A cord is never stored with state: project = {a, b, colour}; on load/connect the rope is **seeded from the parabola** (cheap, instantly at rest) and run silently 30-60 steps to settle (≈ 0.2 ms/cord once), so nothing moves at open.
- **Gravity** is screen-down (+y), constant at all zooms (world space), slightly slowed so it reads weighty: g = 6000 px/s² (real: 19 600 px/s² at 2 px/mm; 0.3x). Plug hangs from the jack; no normal constraint.
- **Excitation** (wake a cord): either anchor moved > 0.01 px/frame (module drag, group drag, nudge, fold toggle, relayout/`remeasure`, `setPos` commit), a new/re-patched connection, a plug grabbed/dragged (the free end is a driven anchor following the
  finger through a stiff spring so it trails), a **tap on a cord body = a pluck impulse** (cheap delight; user said "jiggly"). Camera moves never excite (world-space sim).
- **Teleporting anchors** (Snap on: 32-px steps, §1.3): when |ΔA| > 16 px in one step, take 2 sub-steps and `its`+3, and shift the interior points by 0.6·ΔA first so the constraints do not explode.

### 4.2 Sleep / settle rule (idle cost ≈ 0)
- A cord sleeps after 30 consecutive steps with max point speed < 0.05 px/step AND no anchor change; it keeps its last points as the static shape (no pop to an analytic curve). A **forced-sleep ramp**: after 2.5 s awake multiply velocities by 0.95/step; hard stop at 5 s.
  The global rAF loop (the "cord ticker") runs only while any cord is awake or the camera is in a burst needing a draw; `all asleep` -> no rAF, no draws except on camera frames (the world already calls `glDraw` per written frame). `prefers-reduced-motion`
  (cv-world.js:384 `reduced()`): no dynamics, cord snaps to the seeded parabola. Hidden tab: no ticker.
- Expected visible motion after a drag: ~1.5-3 s (estimate from damp 0.97: amplitude ×0.16 per second).

### 4.3 Where it renders: GL layer ABOVE `#world` (recommended) vs SVG
- Cords must lie over panels, plugs over jack art, knob caps under cords (the user asked for real patch cords). The existing GL canvas is UNDER `#world` (cv-gl.js:151-157) and DOM controls/jacks paint over it, so cords there would pass UNDER knobs. => a **second
  WebGL2 canvas `.cv-cords` after `#world` in `#viewport`**, `pointer-events: none` (CSS like 801), no will-change, the same `{tx,ty,k}` + dpr uniforms as `cv-gl.draw`, drawn from the same `write()` frame (call it right after `glDraw()`, cv-world.js:592-604) and on
  its own ticker while ropes are awake. Because it takes no pointer events and adds no listeners, gesture.js's passive-listener rules (gesture.js header) and "two-finger always wins" are untouched.
- Geometry: one dynamic VBO (all cords, triangle strips with degenerate joins), vertex = (x, y world, nx, ny normal-in-world, side ±1, s arc length); the vertex shader extrudes `halfW = max(wWorld/2, 1.25/(k·d))` so the cord scales with zoom like a real
  object but never thins below ~2.5 device px; **no `--ik` snap, no render-in**. Fragment: cylinder shading from the across coordinate (diffuse + specular + dark rim) in the cord's colour, AA via fwidth; a second pass of the same VBO as a soft drop shadow
  (+3,+5 world px, alpha 0.35, 1.5x wide); plugs = one instanced quad per cord end (position, angle, size, colour) with a procedural SDF sleeve/ring/tip; halos for compatible jacks while patching = instanced rings (replaces the 250-jack `.cv-ok` class sweep).
  3 draw calls total (shadow, cords, plugs). Premultiplied alpha, blend ONE/ONE_MINUS_SRC_ALPHA as cv-gl:143. Context loss: same `webglcontextlost/restored` pattern as cv-gl.js:159-180; on a dead layer fall back to SVG (below).
- Memory: a 2nd drawing buffer = viewport × dpr² × 4 B (the S0 iPad viewport 1600×1068 @2 = 3200×2136 ≈ 27 MB); allocate lazily (0×0 until the first cord), free on the last cord. 2 GL contexts total (iOS allows ~16).
- **SVG fallback (no WebGL2 / loss / `?nogl`)**: the existing cv-cables SVG with a static sag: cubic with both control points moved down by 4/3·s (a parabola), 3 stacked strokes (shadow, body, highlight) and a plug circle pair; **no dynamics** (or <= 8 awake ropes at 30 Hz).
  Why not SVG ropes as the main path: ~11 nodes/cord (3 strokes + 2×(plug ring + sleeve + tip)) -> 440 nodes at 40 cords, each `d` rewritten and repainted while swaying (union-bbox repaint ≈ the whole canvas), compositor-scaled and re-rastered at rest (render-in), `--ik` snaps,
  and a swaying SVG is main-thread raster work during exactly the frames the user pinches in. Feasible at ~10 cords; unmeasured beyond.
- **Pinch rule**: the sim is world-space and independent of the camera; the camera costs one uniform update + 3 draws (≈ 0.03-0.05 ms, estimate from 1h's measured grid+quads). Safe default: while a camera burst is live, **do not step the sim if the last
  rAF interval exceeded 24 ms** (ropes freeze mid-swing and resume at `cameraend`); with the GPU path it should rarely trigger. Never upload geometry on a camera-only frame (the VBO is untouched unless a rope stepped).

### 4.4 Cost per frame (estimates; gate in §6)
- Per awake cord per step: integrate 9 pts + 5 passes × 10 constraints + bend 9 ≈ 70 vector ops ≈ 0.85 kflop + 10 sqrt; build 21 smoothed pts × 2 verts ≈ 0.9 kflop -> **≈ 5-10 us** (typed-array JS, iPad ≈ 0.8× the M4 per bench device factor).
  Upload 21 pts × 2 verts × 16 B = 672 B/cord. GPU fill: 40 cords × ~500 px × 14 px at dpr 2 ≈ 1.1 Mpx (+ shadow 1.6 Mpx): negligible.
| cords awake | sim+build | upload | draws | total/frame (est.) |
|---|---|---|---|---|
| 0 (asleep) | 0 | 0 | 3 on camera frames | ≈ 0.03-0.05 ms |
| 6 (one module dragged) | 0.05 ms | 4 KB | 3 | ≈ 0.1 ms |
| 40 (everything shaking) | 0.2-0.4 ms | 27 KB | 3 | ≈ 0.4-0.6 ms (≈ 3 % of 16.7 ms) |
- At module-drag time the existing `relay()` (cv-module.js:1036) already runs per pointermove; for cords it should coalesce to one `cords.setAnchors(map)` per rAF.

### 4.5 Start values (tune by feel on the iPad; one `CORD` constants block like cv-face's)
| parameter | start | range / note |
|---|---|---|
| points N (segments) | clamp(round(L/28), 6, 14) | ~10 at L 280; render smoothing: Catmull-Rom ×2 (21 pts) |
| step | 1/60 s fixed, accumulator, <= 2 steps/frame | 120 Hz displays: sim stays 60 Hz |
| gravity g | 6000 px/s² (g·dt² = 1.67 px/step²) | 4000 floaty ... 9000 heavy; if rubbery raise `its`, not lower g |
| velocity damping (per step) | 0.97 | 0.95 limp/short ... 0.985 very jiggly (>3 s) |
| constraint passes `its` | 5 (8 on teleport, 6 for N >= 12) | stretch should stay < 3 % of L |
| bend blend b | 0.15 | 0 limp string ... 0.3 stiff rubber; stops kinks at plugs |
| slack ε / c | 0.10 / 24 px (sag ≈ 19 % of span) | 0.06 taut (15 %) ... 0.18 droopy (26 %); per-cord jitter ±8 % |
| cord thickness | 9 world px (4.5 mm) | min 2.5 device px; shadow 1.5×, offset (3,5) |
| plug | 26 world px sleeve (jack hole 28 px, panels/modular.js `d: 14` mm) | head drawn end-on, cord leaves downward |
| sleep | 30 quiet steps, speed < 0.05 px/step; forced damp ×0.95/step after 2.5 s; hard stop 5 s | |
| pluck impulse (tap on cord) | 6 px/step at the tap point | |
| drag trailing (live end) | spring 0.35/step toward the finger | |
| caps | <= 128 cords/device (soft), <= 48 awake rope-steps per frame (round-robin beyond) | the cap is a safety net, not the budget |

### 4.6 One cable renderer for everything? (today's mod / note / audio cables)
- **Yes as the end state, not as step one.** The cord layer takes an item shape close to `Cable` (`{id, a, b, color, kind, style: 'cord' | 'wire' | 'dash', rigid}`), so mod/note/audio/Serum-internal cables can later be drawn by it as
  `style: 'wire'` with the sim off (a pre-sampled bezier/polyline, dashes by arc length `s` in the fragment shader, widths in screen px): that removes ~3 DOM nodes per cable, the `layout()` attribute writes, the `--ik` snap, `rezoom`/`tail()`,
  and the "cables under modules" ordering conflict. What stays DOM regardless: the amount badges, labels, × button, fork BAL badges, menus, selection/inspector (they need text and presses): they would read anchor points from the cord layer
  (`pointAt(id, t)` replacing the chord-midpoint and `tail()` maths, cv-cables.js:629, 649-654). Hit testing becomes geometric (`hit(clientX, clientY, r)` over the cached polylines, O(points) ≈ 500 for 40 cords) called from the world's
  background-press path where `cableHit()` is used today (cv-module.js:212-224) -> a cord never steals a knob's press.
- **Recommended staging**: 9-A cords for modular patch cables only (and any later patchable hardware: ARP 2600, MS-20 share the layer); mod/note/audio/internal stay on cv-cables untouched (goldens, 54 cv-cables tests, `main-sim` stay valid; no risk to the
  shipped modulation UX). 9-B after the iPad numbers: move them to `style: 'wire'`. Mod cables ending on knobs should stay non-jiggly (they have no plug); give them the sim only behind a pref if the user asks.

## 5. Recommendations for the stage 9 contract

1. **Cord renderer**: new `cv-cords.js` (like cv-gl: plain ES module, no DOM at top level, fake-GL testable, `?v=` imports). API: `createCords(viewport, {world, doc, win, now, onLost, onRestored}) -> {set(cords), anchors(map), mark(jackId, 'ok'|'no'|'hot'|'from'),
   live(spec), hit(x, y, r), pointAt(id, t), wake(id), hold(bool), stats(), destroy()}`; the world calls `cords.draw(cam, vw, vh, d)` after `glDraw` in `write()`/`endBurst()`; a sim ticker of its own. Pure maths exported (rope step, parabola seed, extrusion) for node tests with a golden polyline per
   (A, B, L). SVG fallback in cv-cables (static sag). Plug art procedural (no textures, no fonts, nothing to rasterise at a zoom end).
2. **Layering and input**: cords above module DOM, `pointer-events: none`; presses: a plug/jack press already goes through the world's jack hook (cv-world 1136-1142); a plugged jack re-patches the TOP cord (stacked plugs drawn 3 px apart); a press on a cord body only
   counts where the DOM beneath is a background (BG_SEL, cv-module.js:149-160) -> tap selects (menu: Disconnect, colour, length reset, Pluck), drag pans (the U13 rule). A knob under a cord always wins.
3. **Jack model**: ONE signal kind (`sig`) for every 900-series jack, direction in|out only, the engine treating every cord as an audio-rate float stream (FM, audio into CV, CV into audio all legal). Audio/CV/gate = `role` metadata (tooltip, soft glow ranking of "typical" targets while
   dragging, a legend dot) never a refusal; jack rings look alike as on a Moog. **Many-to-many**: an output may feed any number of inputs (outputs are buffered, so no MULT needed; keep a MULT module for authenticity), an input sums several cords (the 904A/921 control inputs do; per-input
   scale from the module). **Cycles/feedback allowed** (engine: one-sample delay on back-edges); this means a separate patch validator, not `cv-graph.validate` (its `fan-out` 234, `cycle` 237, `PORTS` 146 would reject normal patches). Keep the `{id, a, b, g}` wire shape (cv-model.js:276) as the stored cord
   with `col` (cord colour) and optional `len`; one History step per connect/move/disconnect (as sxCable, main.js:6360).
   **Bridge to the app's existing jacks** (`mod` LFO/ENV/Macro/Pads, `note`): through interface modules ("MOD IN", "KBD/GATE") not direct cords: the app's mod sources run at control rate (ModCore, 2b), a direct sig<->mod cord would lie about the rate. The existing mod-cable-to-knob UX stays for non-modular synths.
4. **Colour**: cord colour is a property of the cord, not of the signal: round-robin from a stock palette of ~8 real cord colours (black, red, orange, yellow, green, blue, violet, white) at creation, changeable in the cord menu, stored (`col`). Dimming/grey for cords of a powered-off module keeps the 1e idea (`.cv-off` #5b5e66, CSS 1145).
   Existing `MOD_COLOR` / instrument colours remain for the legacy cables.
5. **Limits**: <= 64 modules and <= 128 cords per modular device (soft warns), `Tidy` places modules flush in racks (touching rects do not trip the overlap rule, `intersects` uses strict < , cv-world.js:225; overlapping drops a module's face to the 'dom' tier). A painted-element notice
   on touch devices reuses the `sxHeavySoon` machinery (IMPL-3 §9.9) with a modular-calibrated count; **until the iPad run says otherwise, plan for ~25 comfortable / ~40 ceiling modules per scene (estimate, §3.2)**. Do the cheap hygiene first: drop the hidden face SVGs from the DOM in gl mode (3R-1) and use a compact bar
   (<= 4 nodes) for 1-2 MU modules. Cord count is not the iPad limit; module count is.
6. **Module keys / data**: follow the milestone-3 precedent (Serum parts: keys `iN/<part>`, `partJacks` from a table, ports from layout maths, internal edges as state): a `modular` device holding `{modules, cords}` with canvas modules keyed `iN/<mod>`; jack positions from `panels/modular.js` mm coordinates (static, no layout reads; jacks live DOM spans over the GL face, transparent while empty, the plug sprite drawn by the cord layer).
7. **What to measure on the iPad** (a `?m9=1` scene beside ui-bench-m3, same harness: hw5 first and last for validity, M0 scripted phases, M1 hand protocol, firstMove/settle, `glStats`): see §6.

## 6. ui-bench scenes for stage 9 (extend `tests/ui-bench-m3.mjs`; same pass criteria P / P+ of IMPL-3 §1.5)
| id | content | decides |
|---|---|---|
| `hw5` | the 1h five-set, run first and last | validity, thermal drift |
| `mod20` | 20 modular GL-face modules (flush, 5×4 rack) + 40 cords (SVG fallback static sag) | DOM-only ceiling, the module-count line |
| `mod20g` | the same with the GL cord layer, all asleep | cords at rest cost vs SVG |
| `mod20w` | the same, a scripted shake of one module (6 cords awake) then of all (40 awake), pinch 25-200 % DURING the sway | sim + camera together; the 24 ms hold rule |
| `mod40g` | 40 modules + 80 cords | ceiling (expect P, not P+) |
| `mod20x` | `mod20g` + 6 Serum-faithful modulators + Pads (mixed track) | real-track budget |
  Record per scene: burst med/p95/max/>33, firstMove, settle, input-to-frame p95 (M1); `cords.stats()` {awake, stepMs, uploadBytes, drawMs, maxStepMs, holds}; painted-element count; GL bytes (faces + cord buffer). Add: (a) a G1-style `equalPx` check that the cord layer's pixels
  mid-pinch = at rest (same camera); (b) a hand test of **plug grab/pull/re-patch, a cord tap-pluck and a module drag with Snap on** (teleport) on the iPad; (c) cord thickness/shading at k 0.25, 0.5, 1, 2 (no sub-2.5-device-px cords, plugs readable at 0.5); (d) idle: a stopped rAF (no frames while all asleep) via
  a rAF counter. Gates (proposed): cord layer adds <= 0.6 ms/frame with 40 awake (Mac) and keeps `mod20w` inside P+; asleep cost <= 0.05 ms per camera frame; GL buffer allocated only when cords exist.

## 7. Caveats / not verified
- No WebKit/iPad run exists for any cord or sim; every ms figure above marked "estimate" is arithmetic. The "25-30 modules" line is a ratio from S0's painted-element counts (sx1 1 866 P+, hw5 2.8 k borderline, p1x 3 176 fail-by-one-frame), scaled by my ~80 painted el per modular module.
- hw5 itself failed P+ in the user's S0 run (thermal drift: 9 -> 45 frames > 33 between runs): any new scene must be bracketed by hw5 first and last.
- A second WebGL context above the DOM has not been tried in this app; if iOS compositing of an overlay canvas over a will-change world costs a frame, the fallback is cords in the existing under-canvas (cords pass UNDER knob DOM: wrong look but zero new layers).
- Gauss-Seidel stretch and the "g, its" feel need a quick headless sim before the contract fixes numbers (a node script plotting max stretch and settle time per (N, its, g, damp)); I did not run one (task rule: no tests/scripts).
- Mod/note/audio migration to the cord layer (9-B) would touch cv-cables' 1 230 lines and tests/cv-cables.test.mjs (54 tests); keep it out of 9-A.

## Summary (10 lines)
1. Today's cables are DOM SVG in `#world` (cv-cables.js:464-477): one sag-free cubic each (190), 2-3 nodes, strokes from `--ik`, no plugs, audio cables UNDER modules; ~20-40 static cables ran on the iPad (never isolated or animated).
2. They compositor-scale mid-pinch and snap (`--ik`, ends, badges) at rest; camera frames cost them ~0 JS; a module drag re-lays every cable per pointermove (O(modules×jacks + cables), ~3 DOM writes each).
3. Jack machinery (`[data-cv-jack]`, `createCableDrag`, snap 32 px, tap menu, 44 px hit) is reusable; the audio data model is not: `cv-graph.validate` forbids fan-out (234), cycles (237), 3 device kinds (146). Stage 9 needs its own many-to-many patch graph with feedback.
4. S0 iPad: painted DOM drives stutter (sx1 1.9 k P+, hw5 2.8 k borderline, p1x 3.2 k one frame over, t2 ~6 k fail); a split modular module is ~80 painted el, so ~25-30 modules comfortable, ~40 ceiling (estimate); cord count is not the limit.
5. GL faces already fit modules (1 quad each, ~1.5 MB each); the 3R plan already lists "cables to GL" last (3R-4): stage 9 pulls it forward for cords.
6. Render cords in a NEW WebGL2 canvas ABOVE `#world` (pointer-events none, camera as a uniform, 3 draw calls, procedural plugs and cylinder shading, shadow pass): over panels, under nothing, no render-in, pinch cost ≈ today's grid draw.
7. Physics: world-space verlet rope per cord (≈ 10 pts, 5 passes, g 6000 px/s², damping 0.97, slack ε 0.10 -> ~19 % sag), seeded from a parabola, woken by anchor moves/connect/pluck, asleep after ~2-3 s (no rAF when all sleep); ≈ 5-10 µs per awake cord, ~0.5 ms with 40 awake (estimates).
8. Pinch safety: sim never reads the camera; no geometry upload on camera frames; hold the sim in a burst only if the last frame > 24 ms; Snap's 32-px teleports handled by sub-steps; reduced-motion = static parabola; SVG static-sag fallback when GL is lost.
9. Jacks: one `sig` kind (in|out), roles as hints only, many-to-many, feedback with a one-sample delay, cord colour per cord from a stock palette, interface modules to bridge the app's `mod`/`note` jacks; hit testing geometric, a cord never steals a knob's press.
10. One renderer for all cables is the end state (`style: 'wire'`, sim off) but ship 9-A with cv-cables untouched; measure `mod20/20g/20w/40g/20x` on the iPad (hw5 bracketing) before fixing limits.
