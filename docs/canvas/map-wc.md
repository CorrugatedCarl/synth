# Map for stage WC (Wavecraft): what the stage is built from, read at `canvas` dee3010

Facts only, with file:line (cited from IMPL-WC as "map §n"). Three mapping passes (stage-3 parts, the cord stack, the Serum engine)
condensed; where a stage doc and the code differ, the code is quoted. Lines drift, names do not.

## 1. Stage 3's Serum parts (the machinery Wavecraft inherits)

- Everything "Show parts" lives in main.js `/* cv SERUM PARTS */` (main.js:7026–7699) plus hooks: `cvMenu` (6351; the Serum branch
  6359–6379: bundled → `Show parts` (6365–6369), parts → `Bundle` / `Add ▸` / the part ⋯ 6386–6389), `sxSetView(dev, on)` (7114; History
  labels 'Show parts' / 'Bundle' at 7118: `lay` only), `SX_VIEW = 'synth.cv.sxView'` / `SX_VIEW_DEFAULT = 'bundled'` / `sxNewView` /
  `sxParts(t, dev)` (7038–7041), the ⚙ "New Serums open as" select (5843–5851), its readers `addTrack` (4235) and `sxModelLay` (7186),
  `sxLayParts` (7129–7160: the first layout, `auto: 1` places), `sxLayBundle` (7192), `sxPlaceNew` (7270–7287, from `cvRender` 6150),
  `sxSpot` / `SX_COL` (7201–7202), `sxPruneAuto` (7291), `sxSettle` (7322), `SX_HEAVY = 1866` / `SX_HEAVY_MS 600` / `SX_HEAVY_TXT`
  (7355; `PT_HEAVY = 2048` 7367; touch only, once a session; hooks `cvParts.HEAVY`, `heavyReset` 9025).
- Part keys `iN/<part>` are Serum-named in three places: `CMOD.PARTS` / `partOf` (cv-model.js:154–160), `sx-edges.PARTS` / `splitKey`
  (sx-edges.js:33, 74), `kindOfKey` (main.js:6069–6077: `isSerumDev(t, q.dev) ? 'part' : null`).
- `cvHost()` (main.js:6253–6279): `devices: cvDevices` (7725–7742: inst, `iN/fx`, panels, out, track mods, the parts of every Serum with
  `sxParts` as `{ key: dev + '/' + part, kind: 'part', dev, part, model: 'serum', title }`, wheel, Pads, 900 Series), `size` (6265: a part
  → `{ fixed: { w: sxPartW(kind) } }`; VOICE `cvInstSize` 6184–6185), `powerEl: sxPowerEl` (6271, 7092 → `View.power`), `patch: false`
  (6274 — the derived audio cables are read-only through it, cv-module.js:1236/1249), `onRelay: ports => cvCords().anchors(ports)` (6270).
- Mounting: `cvBodyEl` (6079–6092: `div.sxpart[data-part=<key>]`), `cvMountBody` (6096) → `sxViews(t, dev)` (7058–7081: `H.dropShell()`
  serum-ui.js:83 / `H.buildShell(rec.box)` :95; VOICE `mount(dev, 'voice', rec.box)`; each part `SXMOD.mountPart(H, part, M.el, { shown,
  dev, opts })` sx-ui-mod.js:983–987 → `host.mount(v.kind, root, { k, bare: true, width: PART_W[kind], col: COL[kind], part, phase })`);
  the host record `sxRecMk` (3607: `{ ui, trackId, dev, vals, box, el, gen, views, mode }`), `serumPanels` keyed `trackId/dev` (3608);
  `renderCustom` (3627–3665: `new M.sx.SerumUI(box, sxHost(t, dev), parts ? { parts: true } : undefined)` 3648; the host survives undo
  unless `rec.vals !== iv.vals`); unmount `cvUnmountBody` (6113) → `sxPartGone` (7083).
- sx-ui-mod.js: `partView(part)` 969–981; `PART_W` 48–51 (osc 256.66, sub / noise 163.73, filter 218.33, macros 237.27, env 316.38, lfo
  395.45, voicing 210.91, chaos 389.34, arp / clip 1184, voice / outputs 535.28); `defineView` kinds (1007–1030): osc, sub, noise, filter,
  env, lfo, macros, voicing, chaos, curve, arp, clip, voice, header, outputs, quality, tuning, mpe, vc; `VoicePanel` 912 (= VoiceHeader +
  VoicingPanel + `EnvPanel(·, 0)` + OutputsPanel + fold-outs); `VoiceHeader` 550, `VoicingPanel` 471, `OutputsPanel` 636, `EnvPanel` 207,
  `MacrosPanel` 89, `LfoPanel` 334, `ChaosRow` 523. sx-host.js: `mount(kind, root, args)` 1852–1891, `addRoot` 1781
  (`div.sx-root.sx-part[data-dev][data-col]`, container `sxp`), `HOST_OPTS` 1544, `barePanel` 3781 (`section.sx-panel.sx-bare`, the power
  toggle handed out as `.power`, a `data-dest="x.on"` control), the part CSS 1088–1094.
- Part ⏻: cv-module `decorate` (1139–1143) → `setPowerEl` (731–738, into `span.cv-pow`); power ids `sx-edges.POWER` (38). Add / remove:
  `sxAddItems` 7427, `sxAddPart` 7441–7470 (meta `{ trackId, dev, part, on: [on0, 1], f }`), `sxFullWhy` 7405, `sxRemovePart` 7473,
  `sxShowPart` 7163, write-back `sxBack` / `sxBackApply` 7526–7539 (read in `applyRestore` 1813).
- Drops: tray wiring 5800–5818 (`parts: true, partsEl, partsSec, notesEl, notesSec, partPick: sxPartPick, partDrag: sxPartDrag`);
  `sxPartPick` 7645 → `sxPartDrop` 7646 (a Serum: `sxAddPart`; a classic: the notice 'Serum parts belong to a Serum · Replace with Serum'
  7650–7654 → `sxReplaceWithSerum` 7656–7667 = `setTrackModel(iv, 'serum', { parts: true })` + `sxAddPart(…, { step: false })`,
  label 'Replace <old> with Serum'); `sxPartDrag` 7669–7685; `sxPartsDecor` 7687–7698 (`setPartPlaced`).
- Replace (1f): `cvDropInstrument(modelId, at, o, v0)` 6800–6819 (same model → false; `cvUndoNotice('Replaced <old> with <new> … · tap
  to undo')`); `setTrackModel(tr0, id, o)` 2228–2281 (`hist.record(project, 'Replace ' + old.name)` 2238; `CMOD.setModel` 2245; `{t:'panic'}`;
  `sxModelLay` 2264); `cvUndoNotice` 6821 (a tap undoes only while newest); `keepDevs` 1792–1802 (vals / fx / drum kept only when
  `d.model === c.model`); `CMOD.setModel` cv-model.js:323–335 (`reshape` 162–193 moves FX between an own rack and a panel; `dropGone`).
  "+ Track": `#aAdd` → `cvOpenSources('track')` 4589 / 5891; `addTrack(m = curModel(), vals0, o)` 4226; the chip menu `instMenu` 5621–5632
  (every model via `instItems` → `cvDropInstrument(id, null)`).
- sx-edges.js (pure, 321 lines): `serumEdges(s, fx)` 115 → `[{ id: a + '>' + (b || '') + (field ? '#' + field : ''), a, b, kind: 'audio' |
  'note' | 'fx' | 'warp', src?, share?, fork?, stub?, ro?, dim?, env?, field?, what?, label? }]`, ends `'<part>.<port>'` (`oscA.out`,
  `oscA.warp`, `filter.in / out`, `voice.main / direct / note / out / env1`, `fx.in`, `arp.out`, `clip.out`); `setEdge(s, fx, a, b)` 196–231
  → `{ edit | null, why, f: [[path, before, after] …] }`; `cutEdge` 232; `firstFree(s, kind, skip)` 281; `partKeys(s, lay, dev, used)` 294
  (I1 a power field on; I2 `slotsUsed` 262); `routeOf` 63 (`osc[o].route` / `sub.route` / `noise.route`: 0 Filter, 1 Main, 2 Direct, 3
  None), `envOf` (`x.env`, default 1), the fork `x.fbal` + the `f.routeX` / `f2.routeX` switches (lit ⇔ serum-core `filterFeeds`), filter
  → filter `filter[k].route = 0` (both 0 → F2 → Main, the normaliser's rule 134), arp / clip = the power field (`setEdge` writes 1,
  `cutEdge` 0); `WHY` 47 (voice, ro, fx, self, dir, note, notes, same, none, bad); `STUB_LABEL` '→ Filter (off)'.
- Tray: `SRC_VIEWS` cv-tray.js:471–486 (hw, flow, serum `[{ id: 'serum', models: m => !!m.custom }, { id: 'mods' }, { id: 'parts', head:
  'Serum parts', note }, { id: 'notes', head: 'Note tools', note }]`, drums, ctl, moog); `PART_TILES` 553–557 (osc / sub / noise / filter /
  macros → group 'parts'; arp / clip → 'notes'), `PART_GLYPH` 559–567, tile DOM `button.cv-tile.cv-ptile[data-part][data-group]` (title
  821), built 793–840 (`tileDrag` info `{ part: true, over: 'canvas', at }`), `setView` 891–931 (`pbox` sections shown iff the view lists
  'parts' / 'notes'), `setPartPlaced` 972; boxes index.html:237–244 (`#srcPartSec / #srcParts`, `#srcNoteSec / #srcNotes`); the Serum tile
  label 'Serum (complete)' cv-art.js:663 (`tileMeta`); `SIL` keys = MODELS ids (cv-art.js:23).
- cv-module.js: `BAR_H 40` (63), `W_SERUM 1200 / W_FX 760 / W_OUT 280` (66), `W_MOD 240` (77), `MOD_W` (92), `MOD_GAP 80` (112), `PART_W_DEF`
  (120: osc 288, sub 192, noise 192, filter 224, env 320, lfo 416, macros 256, arp 480, clip 640, voice 448), `PART_H_DEF` (122), `partJacks`
  (127: osc out + warp; filter in / out; env / lfo out (mod); macros k1…k8 inline; arp / clip out (note)), `voiceJacks` (139: main, direct,
  note, env1 inline, out), `JACK_Y 28 / JACK_OUT 14` (173), `devicesOf` 270, `tidy()` 296–341 (parts columns arp/clip → osc/sub/noise →
  filter → VOICE; own env / lfo / macros stacked above VOICE; `x1` own FX, `x2` panels, `x3` OUT; modulators at `−gup(w + MOD_GAP)`),
  jack specs 483–503 (`side: left | right | inline | face`, `kind: audio | mod | note | warp | cord`), `measureInline` 532, `decorate`
  1139–1162, `costOf` 1127 (inst 3700 / 900 parts, part 400, fx 900, pm 90, mod 160, else 40), `colorOf` 1128, `ports()` 1042, `relay()`
  1110, `isParts` 971, `cablesNow` 1236. CSS: `.cv-mod` style.css:1042, `.cv-bar` 1045, `.cv-body` 1075, `.cv-jack` 1088 / 1096 (16 px,
  hit `calc(44px * var(--ik))`), `[data-cv-kind="part"]` 1319, `[data-off]` 1125–1128, the Serum palette vars 629 (`--sx-osc-a #4fb3ff` …).
- Schema / song / model: `SCHEMA = 15` (cv-migrate.js:107), `STEPS` 15 entries (123–158; 14 → 15 comment 154–156), `upgrade` read-only
  rule 161–170 (`READ_ONLY_NOTICE` 110), `toV1` 249–308 (lost-line idioms; `patchLine` 246); song.js caps `DEV_MAX 1024 / WIRE_MAX 4096 /
  MODROW_MAX 4096 / LAY_MAX 4096` (536), `LAY_KEY` + `LAY_UI = ['flow', 'parts']` (537), `normLay` 539–555 (`{ x, y, fold?, z?, ui?,
  auto? }`), `PORT_ID` / `DEV_ID` 568, `normDev` 569–617 (synth: `model` /^[\w-]{1,32}$/ else 'minimoog', `vals`, `preset`, `seq`, `fx`,
  `on`, `solo`, `zone`, `name`, `fxId`, `drum` iff drum model, `patch` iff patch model; **no `color`, no other field**); cv-model.js
  `dropLay` 148 (an id and every `id/*`), `PARTS` 154, `partOf` 157, `addInst` 236, `setModel` 323, `addMod` 495.
- Tests: canvas-3-sim (27 tests: boot 94 `VIEW_DEFAULT === 'bundled'`, Show parts / Bundle 111, I1 / I2 141, add / remove 156, tray 183,
  resolver 211, own sources 255, hidden tag 280, slot hosts 299, `modX` 334, meters 348, D-R5 pref 362, S0 notice 631 `HEAVY === 1866`),
  jackrules (13: sx-edges ≡ serum-core `filterFeeds` / `toggleFilterRoute` ≡ sx-ui-mix `channelStrips`), m3-fixture (13), cv-tray
  (648–661 six views + the Serum view's placeholders; 966–1007 `PART_TILES` 7 / 5 + 2 / glyphs; 1011–1021 CSS selector pins), cv-module
  (1350 widths / jacks, 1371 tidy, 1414 part modules, 1441 internal cables, 1475 inline jacks), cv-cables (940 / 967 / 993 / 1035),
  cv-migrate (991 `normLay` keeps `iN/oscA`, `ui` 'parts' / 'flow'; 32–33 `SCHEMA === 15`, `STEPS.length === SCHEMA`; `[15, 15]` pins at
  1056 / 1147 / 1233 / 1330 / 1474), serum-ui's safe `assert` Proxy (25–33, `scrub` on stub nodes).

## 2. The cord stack (stage 9 / 9b / 9c / P)

- cv-cords.js (881 lines, imports nothing): `createCords(viewport, o)` 286 (`{ world, doc, win, now, onWake, mode: 'gl' | 'svg' | 'under',
  under(), test, reduced, hold, perf: 'high' | 'medium' | 'low', full }`); built lazily by cv-world `cords()` 709 (exposed `world.cords()`
  1934; `setPerf` 1939). **API**: `set(list)` 705 — records `{ id, a, b, c, s }` (`id` stringified, `a` / `b` jack keys (strings), `c` colour
  index |0 — **not clamped on the GL path** (489: `col = c.c | 0` indexes 8-entry uniform arrays; the SVG path guards 665), `s` 1 = an
  S-trigger plug); diffs by id (new → seeded asleep once both ends are known; a changed end wakes; a recolour queues a redraw); `anchors(map)`
  727 (Map or object `jackKey → { x, y }` world px, kept by reference, read each frame; an unknown end → the cord is neither drawn nor
  stepped, `endsOf` 342); `live(spec | null)` 739 (a free rope; the next `set` naming a cord with a fixed end on it takes it over, `place` 346);
  `grab(id, end, p)` / `move(p)` / `drop()` 753–760; `sel(id)` 762; `alloc(on)` 764; `dim(on)` 771 (one global alpha 0.45); `resize` 772;
  `step(T, hold)` 776; `owed` 798; `wants` 800; `draw(cam, vw, vh, d)` 802; `pointAt` 812; `probe` 827; `reset` 829; `setPerf(id)` 836;
  `stats` 852; `destroy` 866. **No** `relayout` / `write` / `frame` / `hit` / `pull` / `release`; the body takes no press (IMPL-9.md:1003,
  the user's rule; cv-cords.js:5–7). One layer per world, one flat id space, one `sel`, one `live`, one `grab`, one global dim.
- Physics `STUDIO` 44 (`N 10, DT 1/120, SLACK 0.10, EXTRA 24, DAMP ≈ 0.959, G 6000, PASSES 5, EASE 5, QUIET_N 30, QUIET_PX 0.02, WAKE_PX 0.01,
  MAX_STEPS 8, DT_MAX 0.05, BUDGET 160, JUMP_PX 16, HOLD_MS 24, SUB 4`); `step` 89 (the lab's verlet, bit for bit), `advance` 123; sleep after
  31 quiet steps, wake on Σ|Δ| > 0.01 px; budget `max(1, floor(160 / awake))` steps per rope. `CORD_Q` 52: high `full` (10 pts, SUB 4, 34
  drawn), medium `light` (6 / 3 / 14), low `still` (no simulation, the settled parabola; reduced motion forces still). **Rest cost 0**
  (`step` returns when not running 777; cv-world `tick` 676 asks no frame). Per cord: a fixed vertex range, `bufferSubData` (486, 540;
  `RUN_GAP 4 / RUN_MAX 16` 56): ≈ 2 000 B (high) / 880 B (medium, low) a moved cord; no cap in the layer (patch-core `MAX_CORDS` 4096).
  Drawing buffer = the viewport in device px while `alloc(true)` or any cord exists (450, 764; 13.4 MB at 1440×900 dpr 2); ≤ 3 draw calls
  (613–621); 3 context losses in 60 s → SVG (436). Canvas `.cv-cords` after `#world` in `#viewport`, `pointer-events: none`, above every
  module, under `#overlay` (429); SVG fallback `svg.cv-cords-svg` z 10001.
- `LOOK` 66 (world px): cord `W 11.2`, `BODY 7.8`, `HI 2.2`, `MIN_DPX 2.5`, shadow (4, 8) α 0.32; plug `PLUG_R 14`, `PLUG_B 9.8`, `PLUG_H 3.4`,
  `PLUG_EXT 22`; S-plug 26 × 20 r 4; `OFF_ALPHA 0.45`; `SEL 0.96`. `PALETTE` 58 = patch-core's: 0 Red #d8432f, 1 Yellow #e6b83a, 2 Blue
  #3f80d8, 3 Green #41a75c, 4 Cream #e9e5da, 5 Orange #e27c2f, 6 Violet #9060c9, 7 Black #2f3033.
- Measured: Mac 20 awake step / draw 0.1 ms p95 (IMPL-9.md:1829–1831); iPad Pro `ui-m9` 20 awake step 0.183 / draw 0.046 ms, 40 awake
  0.2 / 0.054 ms, m30 (30 modules / 40 cords) P+, plugs 10 / 10 hit at k 0.6, "Just right"; Mac at 6× CPU 40 awake step 0.73–0.83 ms, cord
  frame median 1.1–1.2 / max 2.1–3.3 ms (IMPL-P:60); node `advance` 128 awake 0.107 / 0.056 ms (high / medium), 512 awake 0.42 / 0.22
  (IMPL-P:127–128); a module drag of 8 cords among 4 096: 0.789 ms (IMPL-P:547–557); `ui-P-mac` `sway_upload_MB_2s` high 5.7 / medium 2.5
  / low 0.
- Plug ends are DOM: cv-module.js:484–503 `side: 'face'` → `span.cv-jack.cv-fjack` (`data-cv-jack`, `data-side=face`, `data-kind=cord`,
  `data-dir`, `data-sig`, `--jp` = spec `hit`, roving tabindex 507–519); `decorate` 1155 keeps a cord jack pressable whatever `host.patch`;
  a face jack's `port()` = its spec `{ x, y }` (845); `V.jacks()` 1332 (cv-cables `jacks()` filters `kind: 'cord'` out, cv-cables.js:923).
  style.css:1361–1373 (`.cv-jack.cv-fjack` 28 × 28, hit `clamp(28px, calc(44px * var(--ik, 1)), var(--jp, 36px))`, `.cv-ok` / `.cv-from`
  / `.cv-no`, `#world[data-cv-cordsleep]`). The press path: cv-world jack hook 1267–1275 (`setJackHook` 1927; `jackStop` 1315 = a second
  finger; `cordAsleep` 1331 below `READ_K 0.5` (77) unless the module is in edit state) → cv-cables `press` 946 (`data-kind === 'cord'` →
  `Op.cordPress`, before `ro(el)` / `isModJack`) → main.js:8518 `cordPress: (e, el) => PATCH.press(e, el)` → cv-patch.js:218.
- cv-patch.js (971 lines): `press` 218 → `move` 233 / `begin` 245 (mode `new` from an empty jack: `PT.nextColor`, `layer('live', …)`; `pull`
  from a plugged one: `layer('grab' / 'move' / 'drop')`), marks 253 (`.cv-from / .cv-ok / .cv-no`, `#world[data-cv-patching='cord']`),
  `follow` 277 (the jack under the finger, `hitR = max(28k, min(44, jp·k)) / 2`; else the nearest compatible within `SNAP_PX 32`; the chip
  `.cv-plugchip` in `#overlay`, `CHIP_DX 26 / CHIP_DY −54`; refused → `data-no`), `up` 329 (tap → menu; 'Patch cord' / 'Re-patch cord' /
  'Pull cord' + 'Cord pulled · tap to undo' 6 s; a refused drop → `endLabel + ': ' + why` 3.5 s), `connectMenu` 395, `cordMenu` 408
  (`.cv-cmenu`, 8 swatches `.cv-cm-c` 44 × 44 → 'Cord colour', 'Remove cord'), keys 471 / 478, `commit` 359 (shows `r.why`, writes nothing
  on a refusal), `cordList(dev, rec)` 131 → `[{ id, a: jackKey, b: jackKey, c, s }]`, `sync()` 380 (`layer('set', …)`, `layer('anchors',
  portsNow())`), `jackKey` 113 / `endOf` 115 (`'m3.saw'` → `'i1/m3.j-saw'`); deps 33–42 (`doc, world, cur, rec, vals, edit, knob, view,
  cords, notice, undo, kit, menu?, …`); the handle 824. **Hard-wired to patch-core** (`PT.canPlug / cordAt / nextColor / plug / repatch /
  pull / targets / jacksOf / setColor`): the pattern is reusable, the code is not.
- patch-core.js (841 lines): `FAMILIES = Object.freeze({ [MG.FAMILY.id]: MG.FAMILY })` 58 (a frozen single-entry registry, no register
  function); `normPatch` 125; `canPlug` 286 / `verdict` 266 — **one plug per jack, same `sig`, out → in and the multiples' rules are
  hard-coded** (the only per-family inputs: `fam.plugs`, `fam.conv`); `MAX_MODS 512 / MAX_CORDS 4096 / MAX_CONN 8192`; `PALETTE` 54. A
  derived-state instrument needs none of it (cv-cords only matches its PALETTE in a test, cv-cords.test.mjs:90).
- cv-cables.js (1236 lines; 45 tests): two SVG layers 476 (`svg.cv-cables` z 0 under the modules; `svg.cv-cable-ends` z 10000: the last
  `END_PX 24` screen px of each mod cable + the live rope); `cablePath` 190 (`d = max(40, |dx| / 2)`); records: audio `{ id, a, b, kind:
  'audio', readonly?, wire?, from?, src, color, dim, g?, label? }`, mod `{ kind: 'mod', a, b: '<dev>:<param>', amt, bi, byp, preset, dashed,
  badge, color, src }` (ids = the row ids; own rows `o:<dev>:<slot>`, preset rows `p:<dev>:<slot>`), internal `{ int, dev, edge, stub, fork,
  tap, off }` (ids `x:<dev>:<edge id>`), note `{ kind: 'note', tap: 'pads' }`; `cablesOf(track, opts)` 241–279, `deriveCables` 197 (v1
  `i1.out → fx1.in → out.in`; a Serum `i1.out → i1/fx.in → out.in`), `modCables` 319–371, `internal` 293–309, `noteCables` 386; the badge
  `button.cv-mbadge` (z 10001; `amtText` 158: '+50%' / '−25%' / '±50%' / '∓50%'; `.cv-ptag` 'preset'; `.cv-htag` hidden-end tag via
  `hiddenTag` 144; the press beneath it goes to the `[data-dest]` knob 173; tap = select, again → `onSelect` → main.js:8534 `modCableSel`
  → `modLayer.openInspector`; long-press / right-click → `openMenu` 763 (Disconnect + main.js:8555 `modCableMenu` Edit… / Bypass;
  internal fork / stub → Routing… / Balance… / 'Turn <filter> on'); Delete disconnects); `dashedSet` (main.js:6262); visibility `MOD_MODES`
  always / select / never, `MOD_FADE_N 24` + `MOD_HINT`; `MOD_COLOR` 69 (wheel #4fb3d9, velo #e8a33d, at #b98ae6, bend #63c98a, lfo
  #ff7f5a, env #d9c84a, macro #5b8cff, cc #9aa4b2, chaos #e05fb4, note #7fe0d6); drags `createCableDrag` 897–1236 (`pressMod` 962 on
  `[data-kind="mod"]`, `beginMod` 1028 marks `[data-dest]` knobs `.cv-ok` through `o.markDests`, `.cv-nodest` modules,
  `#world[data-cv-patching="mod"]`; `followMod` 1057 (`hitAt` through badges, `devAt` 1005, a bar = `onBarDrop`); release `onMod(src, dst)`
  → main.js:8465 `modConnect` (own source on its own Serum → `sxOwnConnect` native row; else `CMOD.addMod`, 'Modulate <knob> with <src>');
  `onJackTap` → `modJackTap` 8498); audio `press` 944–948 / `begin` 983 / `follow` 1080 / `up` 1138 / `menu` 1177 ("Connect to…");
  `port: j => cvView.intPort(j) || cvView.port(j)` (main.js:8513); `canConnect: sxCan` (7566) / `onConnect: sxConnect` (7573) → `sxCable`
  7580 (`hist.record(label)`, `step.meta = { trackId, dev, f }`, `sxApply`, notice '<label> · Undo'); constants `SNAP_PX 32, TAP_PX 8,
  STUB_PX 56, STUB_MAX 136, HID_STEP 22, NOTE_END '@notes'`. Rough split: ≈ 400 pure / typedefs, ≈ 190 SVG drawing, ≈ 165 selection /
  menus / badges, ≈ 340 drags (mod ≈ 110, audio ≈ 190). Host object `o`: `{ doc, onSelect, onAction, menu, onHint, mods, ignore, k }`
  (from `H.cables`, cv-module.js:949); drag opts main.js:8506 `modDragOpts`.
- Pads: `moduleJacks` cv-pads.js:94 (`{ id: 'p<i>', side: 'inline', kind: 'mod' }` per mod pad + `{ id: 'notes', side: 'right', kind:
  'note' }`); anchors `span.pd-jk[data-jack]` (713); note cables end at `<dev>.@notes` (cv-module.js:1048, a fixed point, no jack).
- Faces / skins today: `PATCH_FAMS` cv-panel.js:105 (`{ fam, theme }`), `m900.theme` models.js:885, `panels/m900.js:19–26` `SCHEME`
  (`panel, legend, rule, accent, font: 'sans', knob { skirt, cap, ptr, ptrStyle, knurl, capR }, jack { nut, hole }`), scheme → CSS vars
  `--hw-*` (cv-panel.js:1499–1512), `FONTS` 268 (`sans` / `condensed` 'Arial Narrow' … / `rounded` system stacks), decor `screws`
  (`{ t: 'screws', pts, d }`, 271). The Serum kit: `.wk-knob` (wk.js:3286) — `.wk-track` stroke `--sx-line`, `.wk-face` fill `--sx-panel2`,
  `.wk-val` `--sx-graph`, `.wk-ptr` `--sx-ink`, labels `--sx-mute`, font `--ui` (wk.js:3288–3297): **every kit colour is a `--sx-*` custom
  property**; the cord lab (docs/canvas/ref/cord-lab.html:10–20): `--bg #111214, --rack #17181a, --panel #1f2023, --line #2c2e32, --ink
  #ebe6d8, --muted #9c978a, --accent #e8a33d`, display font "Archivo Narrow" (Google Fonts; **the app bundles Inter + JetBrains Mono only**,
  fonts/, OFL).
- Tests: cv-cords (34: `STUDIO` fields, `PALETTE`, `LOOK`, the lab bit for bit, sleep / jump / budget, lifecycle, `set` diffing, live
  takeover 378, grab 407, presets 566–640, P-1(c) 776–839 byte hashes + upload sizes), cv-patch (28), patch-core (52; bounds 1140),
  cv-cables (45); bench `ui-m9` / `ui-m9-mac` / `ui-m9b-mac` / `ui-P-mac` (tests/bench.json:48–50); scenes tests/ui-bench-m9.mjs:367–379
  (hw5, m13, m13w, m20, m30, m30h, m13s; `?m9=1&s55=1`).

## 3. The Serum engine (what a key gate costs: nothing)

- serum-core.js: `N_OSC 3, N_MATRIX 64, N_LFO 10, N_ENV 4, N_MACRO 8` (151–158); `ROUTES_SRC / ROUTES_FILT` = Filter 0, Main 1, Direct 2,
  None 3 (329–332); `SOURCES` 62 (446–489: env1 = 2, env2–4 = 3, 4, 34, lfo1–8 = 5–12, lfo9 / 10 = 35 / 36, macro1–4 = 24–27, macro5–8 =
  47–50, wheel 1, velo 13, note 14); `S_EXT0 62 / N_EXT 16` (493); `DESTS` 529 (535–752); `MODULE_FIELDS` 835–853 (env1 = `{ p: ['e1.att',
  'e1.hold', 'e1.dec', 'e1.sus', 'e1.rel', 'e1.ca', 'e1.cd', 'e1.cr'], paths: [['env', 0]] }`); the ENV rows 554–562 / 589–593: `e1.att` def
  n 0.11, `e1.hold` 0, `e1.dec` 0.5, `e1.sus` 1 (law pow2, fmt db), `e1.rel` 0.215, `e1.ca` 0.5 (linear), `e1.cd` / `e1.cr` 0.666; law
  'pow5' lo 0 hi 32 s (laws.js:71: `32·n⁵`, the DSP the same sx-mod.js:2046) → defaults att 0.515 ms / rel 14.70 ms; **n for 3 ms =
  (0.003 / 32)^0.2 = 0.15648**; ENV 2–4 sustain lin, `e<k>.start / end` 699–702; `ENV_K 10`, `bend(q, k)` laws.js:127 (c 0.5 = linear).
  `defaultSerum` 1313–1340: `a.on` 1, `b/c/n/s.on` 0, `f.on / f2.on` 0, `a/b/c.level` n 0.75 (gain n² = 0.5625), `g.amp` 1, `g.master`
  (fx-core.js:125, pow3, def 0.7 → 0.343), `voicing { mono 0, legato 0, poly 8, always 0, scaled 0, oneNote 1, steal 0 }`, `g.porta` 0
  (8·n⁵ s); `OSC_ROUTE_DEF = [0, 1, 1]` (1287), sub / noise / filters route 1, every `env` flag 1, `f.routeX` / `f2.routeX` all 1 (DEF2 794),
  `x.fbal` 0 (all to F1); `normalizeSerum` 1840 (`normV2` 1746 / `migrate1` 1572; `normOsc` 1616: route intIn 0..3, env bit 1630);
  `emptyRow` 1277 `{ src, amt, dst, bi, curve, aux, inv, byp, out, acurve, crv, rise, fall, slink }`, `normRow` 1674, `rowActive` 2053,
  `addMod` 2465 / `freeSlot` 2454; `compileSerum` 2126 (never throws; output 2429–2441 `{ engine: 'serum', mode, poly, prio, legato, glide 0,
  …, level 1, serum: CP (144 keys, `cpKey` 2151), serumT }`; `ext` 2196); `FACTORY_PRESETS` 5020 (86 = 38 `recipe2` 4474 + 48 V1 3893,
  'Init' at 38; no factory ENV 1 below 0 s attack, the minimum release 14.7 ms).
- serum-dsp.js / sx-mod.js: the control chunk `CH = 4·OS` samples (engine.js:1855); `chunk()` 2865–2886 (follow, sources, matrix,
  renderChunk, `mv.advance`); ENV 1 multiplies the output per sample with a per-chunk target (`ampT = eV[0]·g.amp²·fd`, 3546–3560; `addAmp`
  2148 ramps linearly across the chunk); **a fresh voice starts at `gAmp = gAmpN = 0`** (2761: "ENV1×AMP from 0"); `envTick` sx-mod.js:2036–
  2095 (attack `v = v0 + (1 − v0)·bend`, `A <= 0` → a jump to 1 (2058); release `vR·(1 − bend)` reaching exactly 0; `envRestart` 1596–1603
  keeps the level at a steal unless `stealRe`; `noteOff` 1860 → stage 5 with `eVR = eV`); the voice ends when the gate is off and `eV[0] ≤
  1e-5 && gAmp ≤ 1e-5` (2870–2877) — with any source's `env` 0 (`noEnv`) it waits for every envelope (`envsIdle` sx-mod.js:1546) then a
  `ceil(0.002·fs / CH)`-chunk fade; the ENV-off groups `gAmpN` (3509, 3517–3527: a source routed through a filter follows the **filter's**
  `env` flag E[5] / E[6]); base-param smoothing τ ≈ 6 ms (sx-mod.js:808–810); `fadeSerum` engine.js:2730 (≈ 3 ms raised cosine on a hard
  stop); `allocate` 1950; 32 voices max (engine.js:1683), `capQ4` main.js:559 (POLY ≤ 8 live, 4 at Q6).
- engine.js: `Inst` 1718, `setPatch` 2148 → `setSerum` 2216–2279 (`kind = 'serum'` 2238; `SD.attach` 2241; voices 2264; `sxArm` 2284–2293),
  `sxOS` 2322; `noteOn` 2875 → `sxIn` 2924 → `sxNote` 2943 (mono `monoPlay` 3030; poly `allocate` + `vc.noteOn` 2979–2980); `noteOff` 3057 →
  `sxOff` 2995; `renderSpan` 3280 (idle skip past 2 s quiet 3285–3298), `renderSerum` 3363 (`SD.begin`, voices, `fxMods`, decimate, the own
  rack `fxc.rack.process`; `rackOf` 4246); messages `{t:'patch', p}` 2791 / `{t:'patch', i, p}` 4027 / 4287, `{t:'ct'}` 2804.
- cv-graph.js: `compileTrack` 264–291 (a canonical Serum track → `{ canonical: true, shape: 'serum', inst, v1: { model, vals, preset, seq,
  fx } }`), `compileGraph` 329 / `instPatch` 337–348 (`patchFor(d.model, vals, d.fx, opts)`), `compileMods` 634 (memo `MEMO` 530 on `sigOf`
  ≈ 595; `serumSig` 580 hashes lfo / env slot states, `l*` / `e2..e4*` knobs — never `e1.*` —, the matrix fill), canvas rows `'<dev>:<param>'`
  (`modRowsFor` 360, `nativeRow` 364), `envFree` 386 (never ENV 1), `place` 482 / `injectMods` 499 (vals.s never mutated). cv-mods.js
  `destOk` 592 (**`dev.model !== 'serum'` → the classic path → a second Serum-engine model is refused on every knob**), `SERUM_IDS` /
  `PLAIN_SW` ≈ 585, `targetsOf` / `depsOf` / `classicDescs` → [] for custom (`noClassic` 104), `serumDescs` 375.
- models.js: `serum` 701–724 (`custom: true`, `sections: []`, `defaults(prefs)` → `{ s: defaultSerum() }`, `map(P, v, G)` → `compileSerum(v.s,
  { bpm, smooth, fx: G.fx, qr, ultra, mpeBendX, mpeYBi, ext })`, `presets: FACTORY_PRESETS`); `MODELS` 893 (18 entries; `m900` last, 880–892);
  `classicOf = m => !!m && !m.custom && !m.family` 895; `patchFor` 920–945 (`m.custom` 930 feeds master / bypass / direct / bus gains to
  `compileFx`); main.js:112 `modelById` falls back to Minimoog. `m.custom` sites in main.js (24): 159 `loadVals`, 225 `newFx`, 259
  `normDevs`, 395, 479 `modVals`, 491 `buildPatch`, 513–514 `buildInstPatch`, 587 / 598 `trackVoice` / `modelVoice`, 1742, 2230, 2318, 2484
  `renderCustom`, 4235, 5685, 6178, 6186, 6311, 6329, 6365, 6907, 7186, 7658. The literal `'serum'`: main.js 29×, cv-graph 15, cv-model 8,
  cv-module 9, cv-migrate 7, cv-cost 6, cv-modlayer 5, cv-mods 4, cv-tray 3, cv-cables 2, midi.js 2, smpgen.js 6, cv-art 1, engine.js 43
  (the engine *kind*, untouched).
- main.js Serum paths: `sxLoad` 2971 (`core.applyPreset(iv.vals.s, p, …)` + `applyPresetFx` + `sendPatch` + `sxRefresh`), `sxSave` 2988,
  `sxPreset` 2956, `sxDefault` 157, `sxHost(t, dv).presets` 3533, `sxEdit(x, fn, o)` 2846, `sxHost` 3504, `sendPatch` 676, `buildPatch` 491,
  `buildInstPatch` 511, `qrOf` 834, `sxCap` 823; the device record `{ kind: 'synth', model: 'serum', vals: { s }, preset, fx, … }`
  (song.js:566–586; cv-model.js:237–239); `DSP_FILES` 866 (+ smprender.js:30, cv-cost.js:342, wk.js:3189, tests/dsp-scope.mjs:37–44).
- Pins: golden-presets / golden-random (48 V1 presets + 60 random states vs tests/ref-p1, ≤ 1e-6), golden-graph (engine.js vs
  tests/ref-1c, bit-identical), canonical-stream (SHA of every posted message vs tests/fixtures/stream-main.json / stream-master.json),
  serum-core.test (SOURCES 62 / DESTS 529 / `MODULE_FIELDS` order 2645–2661 / the CP key set 1329–1400 / `cp2-default.json` 1445 / `N_*`
  289), serum-dsp.test (default level 0.5625·peak and release −60 dB < 50 ms 900–919; env laws 1733; ENV-off lifetime 2901–2926; steal
  click-free 1550), cv-cost.test:33–44 (every MODELS id has a `COST.synth` entry), cv-art.test:79 / cv-tray.test:446 / 847 / 1343 /
  cv-shell-sim.test:260 (the MODELS id list); `COST.synth.serum = { row: 'e', poly: 32, base: 0.0063, voice: 0.00245 }` (cv-cost.js:104),
  `serumLoad` 164–178, `estimate('serum')` 0.0355 ("~4 %").
