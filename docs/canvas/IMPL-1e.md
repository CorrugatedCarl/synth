# Stage 1e: several synths per track (IMPL-1e) — contract

What stage 1e builds, how the work is split, and the rules every builder follows. The design is [SPEC-canvas.md](SPEC-canvas.md)
§2.7–2.9, §5.1, §6.2–6.9, §9.2, §10 1e, §11.2; [ROADMAP.md](ROADMAP.md) wins where they differ (no resizable modules, no
collision, side trays never auto-close, Lock view, Hardware/Simple). What exists: [IMPL-1c.md](IMPL-1c.md) (instances, project
v2, canonical compile), [IMPL-1d.md](IMPL-1d.md) (Track / Inst / Chain, facade, `mon`, `stats.per`). Sections 1–5 are the
contract; §6 the lanes; §7 the gates; §8 the notes the builders fill in when done.

**Invariant of the stage**: a track that is canonical today (one powered instrument → one panel → OUT, or one Serum → own FX →
OUT) renders bit for bit what it renders now, through the legacy messages (`tests/canonical-stream.test.mjs` unchanged) and
through the graph messages (new `golden-graph` cases). Everything new only runs for shapes that cannot exist today.

## 1. Vocabulary

- **Device**: an entry of `track.dev` (§5.1): instrument `iN` (`kind: 'synth'`), shared panel `fxN` (`kind: 'panel'`), `out`.
  A Serum's own FX is inside its device (`dev.fx`); on the canvas it is the module `iN/fx`.
- **Module key** = **device id**: `i1`, `i2`, `fx1`, `fx2`, `i2/fx`, `out`. `cv-module.ID` stays for the default ids only; nothing
  new reads it.
- **Engine part**: an `Inst` or a `Chain` in the worklet. Part ids: positional `i0` / `c0` until a track node has received its
  first `{t: 'graph'}`; from then on **device ids**: an Inst is `iN`, a shared chain `fxN`, a Serum's own FX `iN/fx`.
- **Primary** (`track.prim`): the instrument today's single-instrument code paths mean when they say "the track's model":
  `graph.insts[0]`, salt 0, MIDI program change target, the instrument a classic file keeps the track id for.
- **Graphed node**: a track node that has received a graph message. `N.graphed` in main.js; from then on that node is driven by
  the graph protocol only (even once the track is canonical again), until the node is recreated.

## 2. Engine (`engine.js`, lane A)

### 2.1 Structure

```
Track
 ├─ insts[]   render order; insts[0] = i0 = the primary        Inst: id, on, zlo, zhi, zxp, salt, sharedRack, fxc, rack, live
 ├─ chains[]  shared panels in render order; c0 = chains[0] || i0.fxc   Chain: id, rack, srcs[], g (Float64Array), alias, ownBy,
 │                                                                       Lb/Rb (alias of its single source's, else own), live, mon, t
 ├─ dying[]   removed Insts / Chains, rendered until silent, then dropped
 ├─ outSrc[]  the parts cabled into OUT, outG (gains);  Track.Lb/Rb = alias of the single OUT source's buffers (g 1), else own
 ├─ hold      per (ch, note): which Insts received the note-on and at which pitch; held velocity (for restrike)
 └─ out       panicFade → outStage, as today
```

- **Legacy structure** (constructor, before any graph): `c0 = new Chain`, `i0 = new Inst(T, os, c0)`, `i0.fxc = c0`, `i0.rack =
  c0.rack`, `chains = [c0]`, `c0.srcs = [i0]`, `c0.alias = 1`, `c0.ownBy = i0`, `outSrc = [c0]`, `Track.Lb = i0.Lb`. Ids `i0` / `c0`.
  This is 1d's object graph exactly; `facade()` is unchanged.
- **Every Inst owns a private Chain** `fxc` (its own FX when it is a Serum). A classic Inst's `rack` is the rack of the shared chain
  it feeds when it is that chain's only source (alias shape), else `null`. In legacy structure `i0.rack = c0.rack` for both kinds,
  as today. A Serum Inst's `rack` is always `fxc.rack`. The Track re-resolves `rack` after every patch that changes an Inst's kind
  (graph nodes only; legacy nodes never touch `rack`).
- **`sharedRack`** = 1 on a classic Inst of a graph node whose `rack` is a shared chain's. `Inst.setPatch` / `setSerum` call
  `rack.set(p.fxr || null, p.fxrT)` only when `sharedRack === 0` (legacy: always, as today). Shared chains are set only by
  `{t: 'chain'}`.
- **`ownBy`**: the Inst whose private chain this is. The Track never processes a chain whose `ownBy` is a Serum (legacy: today's
  `I.kind !== 'serum'` guard, same operations). Shared chains have `ownBy = null`.

### 2.2 Span (§6.3) — `Track.renderSpan(Lo, Ro, off, n)`

```
for I of insts, then dying:  I.live = I.renderSpan(n)            // 0 = skipped (nothing rendered, buffers stale)
for c of chains (order), then dying chains:
    if (c.ownBy && c.ownBy.kind === 'serum') continue               // a Serum's own FX ran inside renderSerum
    live sources = c.srcs with .live
    none live: if (c.rack.idle()) { c.live = 0; continue }  else zero c.Lb/Rb (own buffers; an aliased chain aliases only a live source)
    one live source at g 1 and c.alias: c.Lb === src.Lb (no copy)   else copy-first: Lb[i] = s0.Lb[i] * g0 (g 1: plain copy), add the rest
    c.rack.setNote(most recent note-on among its sources) — only when c.srcs.length > 1 (one source: the Inst called it, as today)
    timed: c.rack.process(c.Lb, c.Rb, n); c.live = 1
no part feeding OUT is live: zero Lo/Ro, return                      // the Track-level skip: no panicFade, no outStage (§6.4)
OUT: Track.Lb === the single live source's buffers (g 1), else copy-first sum into own buffers
if (pnN) panicFade(n); outStage(Lo, Ro, off, n)
```

With the legacy structure this is: `i0.renderSpan` → (classic) `c0.rack.process(i0.Lb, i0.Rb)` → `panicFade` → `outStage`, i.e. 1d's
`renderSpan` operation for operation. **No arithmetic is added on any alias path.**

**Idle** (`Inst.renderSpan`): today's rule, plus power: skip when nothing is active or fading **and** (`on === 0` **or** quiet > 2 s)
**and** (`!rack || rack.idle()`). A powered-off Inst therefore skips as soon as its 3 ms fade has ended (budget ≤ 0.0005). Serum's
`SD.idle` keeps clocks as today.

**Sequencers** (`Track.process`): the scan of §6.3 step 1 runs over every Inst with `on === 1` (`sxSeq.fire/next`, `seqEvents`,
`q.pos += len`); a powered-off Inst neither fires nor splits spans. One Inst: today's statements.

### 2.3 Notes, zones, power (§6.6)

- `Track.noteOn(n, v, ch, ext, aud, i)` / `noteOff(n, rv, ch, ext, aud, i)` keep their names (tests wrap them). `aud` targets one
  Inst: `i` (an id) or `insts[0]`. Otherwise every Inst with `on === 1` and `zlo ≤ n ≤ zhi` receives `noteOn(n + zxp, v, ch, ext, 0)`
  (a transposed note outside 0…127 is dropped); the Track records the receivers and their transposed pitches in `hold`
  (preallocated: `Uint8Array(17·128)` receiver bits by Inst index, `Int16Array(8·17·128)` pitches, `Float64Array(17·128)` velocity;
  `ch` indexes as `(ch | 0)`, the original `ch` is passed through). A note-off reaches exactly the recorded receivers at the recorded
  pitches, whatever the zones are now. One Inst, zone 0…127, xp 0: today's calls.
- Controller state (`bend`, `wheel`, `sus`, `at`, `pat`, `mpe`, `os` without `i`) reaches every Inst, powered or not (as 1d).
- `{t: 'power', i, on}`: off → `on = 0`, `allOff(true)`, `seqRelease()` (303), its cables' audio fades with the voices; the Inst
  keeps every setting and keeps receiving controller state. On → `on = 1`; held keys (velocity > 0 in `hold`, in zone) are restruck
  through `noteOn`; its sequencer re-anchors: `if (I.sq) I.sq.syncStep = null`; `if (I.sxSeq) I.sxSeq.transport(tp.play)`.
  Click-free: largest output step < −60 dB on off and on (engine-track test).

### 2.4 Seeds (§6.2.1)

`Inst.salt` (uint32; 0 for `i0` of a legacy node and for the primary). Applied: `this.r = 987654321 ^ salt` at the two reset
sites; each `AVoice` / `FVoice` after construction: `v.r = ((v.r ^ salt) >>> 0) || 1`; `Chorus` gets a `seed` field (`22222`,
reset uses it; the Inst sets `chorus.seed = 22222 ^ salt`); `serum-dsp.js` / `sx-mod.js` / `sx-seq.js` XOR `(proc.seedSalt | 0)`
where they set `SEED` / `SEED2` (one token per site; `proc.seedSalt` is the Inst's `salt`). Salt 0 changes nothing (goldens).
Solina's `Math.random` is scope-shared: documented, tested as "two Solinas depend on build order".

### 2.5 Messages (§6.8)

| Message | Dir | Effect |
|---|---|---|
| `{t:'graph', insts:[{id, on, zone:{lo,hi,xp}, salt}], chains:[{id}], edges:[[src, dst, g]], out:'out', key}` | → | Applied between quanta. `insts` is the render order (`[0]` the primary); `chains` in render order; `src` an Inst or chain id, `dst` a chain id or `'out'`, `g` a number (1 skipped). **First graph on a node adopts the legacy parts by position**: `i0` becomes `insts[0].id` (state and tails kept, no re-patch needed); `c0` becomes `chains[0].id` when the primary is classic, else stays the primary's own `fxc` named `<id>/fx`. Later graphs match by id: unknown Inst ids are built (`new Inst(T, os, new Chain)`, patched by a following `patch`), unknown chains built; missing ones move to `dying` (`allOff(true)`, rendered until silent / idle, then dropped). Alias / rack / sharedRack resolved after every graph |
| `{t:'patch', i, p}` | → | one Inst (a Serum's includes its own FX as today). No `i`: `insts[0]`. A classic Inst's patch on a graph node carries no `fxr` / `fxrT` (main strips them); even if it did, `sharedRack` ignores it |
| `{t:'chain', c, fxr, fxrT}` | → | one shared chain: `rack.set(fxr, fxrT)`, `fxOver` (posts `{t:'fxover', ids, c}`) |
| `{t:'power', i, on}` | → | §2.3 |
| `seq`, `seqcmd`, `sqt`, `ct`, `fxtap`, `fxph` | → | gain `i` (`fxtap` / `fxph`: `i` = a Serum's own FX, `c` = a shared chain); absent: `insts[0]` / `c0` |
| `os` | → | no `i`: every Inst (as today); `{t:'os', i, v}`: one Inst (the safeguard) |
| `on` / `off` | → | optional `i` with `aud` |
| `mon` | → | ids are part ids (legacy `i0` / `c0`, or device ids after a graph); `smon` = every part |
| `stats` | ← | `per`: every Inst `{id, load, voices, os}` (its own `renderSpan` time, a Serum's own FX excluded), every shared chain and every Serum's own chain `{id, load}`. `load`, `voices`, `os` as today (`voices`, `os` of `insts[0]`) |
| `smon` | ← | legacy node: today's single message. Graph node: one message per subscribed part: `{t:'smon', i, s, gr, fxph, ftap}` (an Inst: snapshot and its own FX's meters) or `{t:'smon', c, gr, fxph, ftap}` |
| `step`, `fxover`, `fxph` reply | ← | gain `i` / `c` on graph nodes only |
| `processorOptions` | → | besides today's fields: `graph`, `patches: {id: p}`, `chains: {id: {fxr, fxrT}}`, `seqs: {id: s}` applied in that order after `patch` / `seq` (offline bounce = live) |

Legacy nodes post exactly today's messages (canonical-stream); every message above without `i` / `c` behaves as today.

### 2.6 Warm-up, limits, allocation

- `Track.warmUp` adds, after today's rounds: two classic Insts into one shared chain into OUT; a Serum through its own FX into a
  shared chain; a power-off with held keys and a power-on restrike. Only analog `WARM` patches for the extra Insts (**never a Solina:
  `Math.random` is seeded by the harness**). `restore` drops the extra parts and returns to the legacy structure.
- Limits: ≤ 8 Insts, ≤ 16 shared chains, preallocated index arrays; no allocation in `process` / `renderSpan` (`noAlloc`); building
  parts allocates in `msg` only.
- `Date.now()` pairs per Inst and per processed chain (today's pattern).

## 3. Compile, model, host (lane B)

### 3.1 `cv-graph.js`

- `validate`: **fan-in is allowed** (several `*.out` into one `*.in`); `fan-out` and `chain` (panel → panel) stay refused (stage 4);
  `own-fx` stays; `g` must be a finite number ≥ 0 when present; zones `{lo, hi, xp}` ints 0…127 / −48…48 (`zone` code); `on` / `solo`
  booleans.
- `compileTrack(t)` non-canonical result: `{ canonical: false, why, errors, graph, patches, chains, order, powered }` with
  `graph = {insts: [{id, on, zone, salt}], chains: [{id}], edges: [[a, b, g]], out, key}` (ids in `order`, primary first;
  `on` = `powered(t)` membership; `salt` = 0 for the primary, else `(devNum(id) * 0x9E3779B9) >>> 0`), `patches = {id: {model, vals,
  preset, seq, fx}}` (`fx`: a Serum's own; `undefined` for a classic), `chains = {id: fxState}` (today's whole FX state or the
  single-rack form, as `fxOfPanel`). `key`: a string of the structure (ids, order, edges with gains, on, zones, salts) for change
  detection. Edges of unpowered instruments are included (they do not sound).
- `compileGraph(t)`: the same result for a **canonical** track (used by graphed nodes). Exported; `compileTrack` keeps its canonical
  answer unchanged.

### 3.2 `cv-model.js` — the editing API (pure, node-tested; History is the caller's)

```
addInst(t, modelId, {vals, preset, ui, name}) → id   zone 0…127/0, on, auto-patch: a wire to the shared panel with the most
                                                     instrument sources (ties: lowest id), else to OUT; a Serum the same (its own FX
                                                     is inside it)
removeInst(t, id) → {ok, why}                        refused for the last instrument; its wires dropped; a removed primary → the
                                                     lowest remaining instrument id becomes prim
addPanel(t, {fx, name}) → id                         no wires
removePanel(t, id)                                   every source of the panel is re-wired to what the panel fed (OUT); wires dropped
connect(t, a, b, g = 1) → {ok, why, wire}            trial copy through validate; a's existing wire is replaced (re-patch); refusal =
                                                     the validate message (the own-fx one offers the fix below)
disconnect(t, wireId)
setPower(t, id, on)   setSolo(t, id, solo)   setZone(t, id, {lo, hi, xp})   makePrimary(t, id)
setModel(t, id, modelId, {vals}) → kept FX rules      classic → Serum: when the instrument was the only source of its panel and that
                                                     panel fed OUT, the panel's state becomes the Serum's own FX and the panel goes
                                                     (today's reshape); otherwise the Serum keeps feeding the panel with empty own FX.
                                                     Serum → classic: its own FX becomes a new panel between it and its destination
sharedPanelFix(t, serumId, srcId) → panelId          "Make a shared panel": a panel after the Serum, both connected to it, the panel
                                                     to what the Serum fed
instIds(t) → [ids] (prim first)   isGraphShape(t)    (not canonical)
```
`reshape` for the primary accessors keeps working. `song.normDev` keeps `on`, `solo`, `zone`, `name`, wire `g`. Schema **4**
(`STEPS[3]` additive: nothing to convert; a 3 opens as before). `toV1` unchanged (already splits per instrument).

### 3.3 `main.js` host side (lane B owns these functions; nothing in the canvas region)

- `sendPatch(tr)`: `c = compileTrack(tr)`. Legacy path (bit-for-bit today's code) when `c.canonical && !N.graphed`. Otherwise
  `N.graphed = true` and the graph path: `g = c.canonical ? compileGraph(tr) : c`; post `{t:'graph'}` when `N.gkey !== g.graph.key`;
  per Inst `buildInstPatch(tr, id, sr, offline)` = `patchFor(model, vals, ownFx || defaultFx(), opts)` with, for a classic, `fxr` /
  `fxrT` deleted and the FX `needs` removed; caps / voiceSeen as today per Serum; `postPatch` generalised with a part cache per Inst
  (`N.insts: Map(id → {engine, ctKey, ctParts, sqParts, xsKey, last})`) and `{t:'patch', i, p}`; per shared chain `compileFx(fx,
  {bpm, rate, seed, smooth, silence, qr})` + `compileFxT`, cache `N.chains: Map(id → {xsKey, last})`, `{t:'chain', c, fxr, fxrT}`;
  assets: `tables.ensure` over the union of needs, patches waiting as today.
- `makeNode(tr)`: a non-canonical track builds with `processorOptions.graph / patches / chains / seqs` (helper shared with
  `renderOffline`); `N.graphed = true`. Canonical: today's options.
- `postTo(tr, m, dev)`: adds `i` (instrument) or `c` (panel) only when `N.graphed` and `dev` is given. Callers that must pass a
  device: `seqSend` (303 of device), `sxHost` (`seqCmd`, `ct`, `sqt`, audition `on`/`off`, `fxTap`), `fxHost` (`fxtap`, `fxph`).
  Legacy nodes never get `i` / `c` (the stream).
- `monitors.sub(trackId, dev, {role: 'inst' | 'fx' | 'both', live, deliver})`: `sync` resolves part ids through
  `partsOf(t, N, dev, role)` (legacy: `i0` / `c0`; graphed: `dev`, `dev + '/fx'` for a Serum's own FX, a panel id); `deliver` routes a
  graph node's `smon` by `d.i` / `d.c` to the subs of that device (legacy: every sub, as today). `monitors.fx(trackId, dev)`.
- `cvCpu`: part id → module key (legacy `i0` → `primId(t)`, `c0` → `fxDevOf(t).id` or `prim + '/fx'`; graph ids are keys); `N.cpu`
  keyed by module key; `powerOff` clears.
- `renderOffline`: per track `compileTrack` → graph options for non-canonical tracks (offline = live, tested). `renderLast(t, o)`
  renders `o.dev` (a Serum id, default the primary) alone through `buildInstPatch`. `previewPatch` / `smprender` unchanged.
- Safeguard (`lowerOS`): per track the heaviest Inst from `N.cpu`: classic → `{t:'os', i, v: OS/2}` (session-only; legacy nodes:
  today's broadcast); Serum → today's `sxCap` / `qrStep` steps. `capsOf(t, dev)` for the badge (lane C2 draws it).
- MIDI (`midi.js` + host): `learn(trackId, dev, dest)`; the map lives in that Serum's `vals.s.midi`; `mapCC` applies a CC to every
  Serum instrument of each target track (`H.instsOf(t)` → `[{id, s, fx}]`), each with its own map; program change → the primary;
  `isMpe` → the primary. `fxSet` takes the device. Tests: per-instance learn / CC, program change.
- Sequencer plumbing: `seqOf(t, dev)`, `seqSend(t, dev)`, `seqRun` keyed `trackId + '/' + dev`; `step` with `i` → the right
  ClassicPanel instance (C2 provides `classicPanels.get(trackId/dev)`; B leaves a hook `seqStepTo(t, dev, s)` that C2 fills).
- `applyRestore` / `loadProject` / `freshProject` / `duplicateTrack`: unchanged except `song.normDev` fields.

## 4. Canvas widgets (lane C1 — no `main.js`) and integration (lane C2)

### 4.1 `cv-module.js`
- `createModule(o)` gains `power: {on, onToggle}` (the `.cv-pow` slot becomes a ⏻ button, `aria-pressed`; `setPower(on)` dims the
  module with `[data-off]`), `zone: {lo, hi, xp, onChange}` (the key-zone pill on the left edge, "keys: all" / "keys: C3–C6 · +12";
  tap → a small `wk` popover with low / high / transpose; `setZone`), `setBadge(text | null)` (a bar badge: "not connected – silent",
  "OS 4→2"), `solo` in the menu is the host's. `createTrackView(world, track, host)` becomes device-driven: `host.devices(track) →
  [{key, kind: 'inst' | 'fx' | 'out', model, dev}]`, `host.bodies.mount(key, el)` / `unmount(key)`, `host.title(key)`, `host.menu(key)`,
  `host.size(key)`; `sync` diffs by key. `tidy(track, sizes)`: instruments stacked left (prim first), panels in the middle (a Serum's
  own FX beside its Serum), OUT right; `layOf` for any key; `makeRoom(rects, key)` for any key. Costs for `W.add` as today.
- `fxKey(model)` stays for the default ids; new code uses `dev + '/fx'`.

### 4.2 `cv-cables.js`
- `cablesOf(track)`: audio cables from `track.wires` (editable: no `data-ro`), plus the derived read-only `iN.out → iN/fx.in` inside
  every Serum (label `routeLabel`). A wire end `iN.out` of a Serum is drawn from port `iN/fx.out`. Colour: the source instrument's
  colour (track colour until instruments have their own); `dim` when the source is powered off (`cv-off`: grey).
- Interaction (`createCables(worldEl, {onSelect(id | null), onAction(id, action)})`): tap selects (highlight; a floating `×`
  Disconnect at the midpoint while selected), long-press / right-click → `wk` menu (Disconnect); Escape clears.
- `createCableDrag(world, {ports, jacks, canConnect(a, b) → {ok, why}, onConnect(a, b), onRepatch(wireId, a, b)})`: a press on a
  `[data-cv-jack]` (cv-world routes it: never a pan, cancelled by a second finger) draws a live bézier from the jack; compatible jacks
  glow (`cv-ok`), incompatible dim with the reason as a title; release within 32 screen px snaps; release on a module body picks its
  first compatible input; tap on a jack → "Connect to…" `popupMenu` of compatible jacks. Dragging a cable end off a jack re-patches.
- Stroke widths from `--ik` as today; no `vector-effect`.

### 4.3 `cv-tray.js` — the Effects tray
`effectsTray(el, {items: [{id: 'panel'} | {id: <effect type>, name, group}], pick(id), drag: {begin, move, drop(id, {over: 'canvas' |
'panel', key?, at}), cancel}, overOf, cost(id) → '~3 %' | ''})`, mirroring `sourcesTray` (tiles `button.cv-tile[data-fx]`, grouped as
the rack's add menu, `wk.dragSource`, the tray slides shut as a drag leaves it and never on its own). `index.html` gets the tray
markup in place of the placeholder; `style.css` the tiles, the ⏻ / `[data-off]` / zone pill / badge / `cv-ok` / `cv-off` styles.

### 4.4 `cv-world.js`
A press on `[data-cv-jack]` goes to a `jack` hook (`hooks.jack(ev, jackEl)`; returns true when taken) before the pan; `sleeper`
already skips jacks. Two fingers cancel the hook's drag (`cancel`). Nothing else changes (no cards, no collision, Lock view kept).

### 4.5 Lane C2 — `main.js` integration (after lanes A, B, C1 are merged)
- Bodies per device: `classicPanels: Map('trackId/dev' → ClassicPanel)`, `serumPanels` (SerumUI records with `dev`), `fxPanels`
  (one `fxPanelRec` per shared panel and per Serum's own FX); `cvParts` bodies created per device (not moved singletons);
  `renderPanel` / `renderCustom` / `renderFxTab` take `(t, dev)`; the track-switch mounting jobs are one per device body; the global
  `model` / `vals` / `cpanel` mean **the current instrument** of the selected track (`curDev` per track: the last tapped instrument
  module, default the primary; `bind()` follows it). Presets, the chip, Save / Delete / Init sound, About, Hardware / Simple, the
  303 sequencer page services take `(t, dev)`.
- Sources tray: a drop on **empty canvas** adds an instrument (`CMOD.addInst` + `lay` at the drop point + auto-patch, one History
  step, the Replace notice becomes "Added Juno-60 · tap to undo"); a drop on an instrument's bar or `Replace with…` replaces that
  instrument (`CMOD.setModel`); a tap in replace mode replaces the current instrument. "Make primary", Delete (refused for the last),
  Duplicate, Solo in track, Power in the ⋯ menu; ⏻ on the bar; the zone pill; the "not connected – silent" badge from
  `validate` / wires; a module with a safeguard cap shows its badge.
- Effects tray: `effectsTray` wired: the panel tile drops a shared panel at the point (cabled to OUT, nothing feeding it); an effect
  tile onto a panel module adds the instance to its rack (`core.newInstance` as the rack's add menu does, one History step), onto
  empty canvas creates a panel holding it.
- Cables: `cablesOf(t)` drawn; connect / re-patch / disconnect through `CMOD.connect` / `disconnect` with one History step each,
  the refusal in `#notice`, the own-fx refusal with the one-tap "Make a shared panel" action (`noticeActs`).
- Soft caps (lane D's `cv-cost.js`): the 4th instrument on a touch device warns (notice), a second heavy Serum confirms; tile costs on
  both trays; ⚙ gets "Measure this device".
- After every edit: `queuePatch(t)`, `cvRender()`, `renderHeads()`; the track chip shows "2 instruments" (`trkChipUI`).
- Transition accessors: left in place this stage (the ~180 sites keep meaning the primary); C2 removes only the ones its own changes
  make dead. Their removal is logged as a 2a item.
- Page-sim tests (`canvas-sim`): drop adds (graph message, one undo step), cables, power, zone, Effects tray, Make primary, delete
  refused for the last, badge, CPU per device, monitors per device, Save as classic project of a two-instrument track.

### 4.6 Lane D — `cv-cost.js` (pure + a Worker runner, no `main.js`)
- `COST`: per-model load estimates per voice at OS 4 from `tests/bench.json` (`c1`–`c6` rows → per-voice; Serum default / heavy;
  an effect ≈ from rows j–m), `estimate(dev | modelId | effectId, factor) → load`, `label(load) → '~3 %'`.
- `measureDevice(opts) → Promise<factor>`: a Worker (the `smprender.js` loading pattern: the DSP scripts + engine.js, `?v=`) renders
  rows `c1`, `j` and a light Serum row for 1 s each, median of 3, divided by the `node` reference rows → the device factor; stored by
  the caller in prefs (`cv.devFactor`). Progress and cancel.
- `softCap(track, adding, {touch, factor}) → {warn: string | null, confirm: string | null}` (§9.2 soft caps).
- Tests: `cv-cost.test.mjs` (estimates monotone, labels, softCap table; the Worker runner behind a stub).

## 5. Protocol fixtures shared by the lanes

`tests/fixtures/graph-1e.mjs` (lane B writes it first, lane A reads it): three hand-built v2 tracks and the exact messages
`compileTrack` + the host produce for them — (a) Juno-60 + Minimoog → fx1 → out; (b) Serum (own FX with a reverb) + Prophet-5 → fx1 →
out, the Prophet soloed off; (c) two Juno-60 → separate panels → out with a 0.5 gain on one wire — with the canonical (a′) single
Juno → fx1 → out through the graph form. Lane A's engine tests consume these messages; lane B's cv-graph tests assert them.

## 6. Lanes, ownership, order

| Lane | Files (exclusive) | Tests it owns |
|---|---|---|
| **A engine** | `engine.js`; seed sites in `serum-dsp.js`, `sx-mod.js`, `sx-seq.js` (one token each); `tests/bench-scenarios.mjs` (+ `measure` for a `track` kind), `tests/bench.json` targets (row `r`) | `engine-track`, `golden-graph` (new §11.2 cases), `bench` (row r), `integration` noAlloc case extended |
| **B compile / host** | `cv-graph.js`, `cv-model.js`, `cv-migrate.js`, `song.js`, `midi.js`, `tests/fixtures/graph-1e.mjs`; `main.js` **host functions only**: `buildPatch` / `buildInstPatch`, `sendPatch` / `postPatch` / `partCache` / caches, `makeNode` (options + `onmessage` routing), `cvCpu` / `CPU_PART`, `postTo`, `monitors` / `sxMonitor` / `fxTab.mon` part ids, `lowerOS` / `statsText` / `capsOf`, `renderOffline` / `renderLast` / `resampleTo`, `midiLearn` / `programChange` / the `midi` host, `seqOf` / `seqSend` / `seqRun`, `sxHost` / `fxHost` message calls (`dev` plumbing only), `loadProject` / `applyRestore` normalisation | `cv-graph`, `cv-migrate`, `midi`, `main` (host cases), `canonical-stream` (must pass unchanged), a new `graph-host.test.mjs` (main-sim: a two-instrument track posts graph / patch i / chain; offline = live options) |
| **C1 widgets** | `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-world.js`, `index.html`, `style.css` | `cv-module`, `cv-cables`, `cv-tray`, `cv-world`, `wk-dom` cases |
| **D cost** | `cv-cost.js` (new), `tests/cv-cost.test.mjs` | `cv-cost` |
| **C2 integration** (phase 2, one builder) | `main.js` canvas / shell / presets / panels regions, `classic-panel.js` if needed, `canvas-sim` / `cv-shell-sim` / `cv-fixes-sim` | page sims, `pwa` (precache), `lint` |

Rules for every lane: work in your own worktree on a branch `1e-<lane>` from `canvas`; commit as you go; never run two test files at
once; one file at a time with `node --max-old-space-size=2048 --test tests/<file>.test.mjs`; never pass fake-DOM nodes to `assert`;
`import './v8-guard.mjs'` first; `?v=9` on every import; new files reachable from `main.js` (C2 runs `node tools/precache.mjs
--write` at the end); goldens bit-identical; match the code's voice (dense, terse comments). Phase 1 = A ∥ B ∥ C1 ∥ D; the lead merges
(B's `main.js` host hunks and C2's regions do not overlap); phase 2 = C2; then review.

## 7. Gates (acceptance, SPEC §10 1e)

- `golden-classic`, `golden-fx`, `golden-presets`, `golden-random`, `golden-graph` (1d cases) bit-identical; `canonical-stream`
  unchanged; **new golden-graph cases**: every classic model (default + its presets), every Serum factory preset, every FX chain,
  rendered through `{t:'graph'}` + `{t:'patch', i}` + `{t:'chain'}` on the new engine equal the legacy `{t:'patch', p}` render on
  `ref-1c` bit for bit (messages compared after mapping `i1 → i0`, `fx1` / `i1/fx → c0` and dropping `i` / `c`).
- `engine-track`: two sequencer-free Insts into one chain = `copy(A) + B` rendered alone, before the limiter, bit for bit (render A
  and B each as a single-Inst Track with the same empty chain and compare the sum against the two-Inst Track's chain input); with a
  running TB-303 or a Serum ARP beside them the difference is measured and asserted below a recorded bound; two identical Junos on
  one track are not sample-identical (salts); a powered-off TB-303 fires no notes and splits no spans; power off / on click-free
  (largest step < −60 dB) and ≤ 0.0005 load when off; bend / wheel set while off are current at power-on; zones and note-off routing
  (zone changed mid-note); restrike of held keys; MIDI OUT into a two-instrument track; `stats.per` and `smon` per part on a graph
  node; the first graph adopts `i0` / `c0`; removal fades.
- Offline bounce = live render for a two-instrument track (`graph-host` / `main` test).
- Bench: V8 ≤ 2 % per row vs `bench.json node` (A/B as 1d), JSC ≤ 3 % (the lead runs the shell method), **row r** (Prophet-5 +
  Juno-60 + default Serum + EQ / chorus / delay panel) recorded with its target; allocation-free (`noAlloc`, GC check); warm-up: the
  first quantum of each new path ≤ 1.5× steady state (bench.test).
- iPad: the user's five-pass bench after deploy: every row within 5 % of `"ipad1d"`; row r within 25 % of the device factor.
- UI (page sims + the user on the iPad): a Juno and a Minimoog and a Serum on one track, shared or separate panels, each switchable,
  mixed into one OUT; Effects tray; power; zones; cables editable; Save as classic project of such a track lists what is lost.

## 8. Notes (2026-10-18, after the review round)

### 8.1 What was built, by lane

- **A engine** (`engine.js`; one-token seed sites in `serum-dsp.js`, `sx-mod.js`, `sx-seq.js`): the graph of §2 as specified. Decisions: the
  first graph adopts `c0` as the panel the classic primary feeds (found from the edges; `c0 = chains[0] || i0.fxc`); a classic → Serum patch
  on a graph node takes over the panel the last graph removed while that instrument was its only source (as its own FX), and Serum → classic
  hands its own FX to the newly built panel it alone feeds (without this the model-switch cases could not be bit-identical in graph form);
  removed parts keep their last route (`dyTo` / `dyG` / `dyO`, review E1) and dying panels render before kept ones; shared panels with several
  sources are keyed from the most recent source note-on and triggered by fanned-out note-ons (sequencer notes do not trigger them); panels
  with several sources get `rack.transport()` at play start (E3); a panic or bye that ends mid-span re-resolves the alias shape only after
  `outStage` (E2); `Chain.used` = "not built by the latest graph", set only by `graphMsg` (E6); a re-struck key at a new transpose releases
  the old pitch first (E8); the power-on restrike triggers drive panels (E7) and re-anchors `sxSeq` on Serum Insts only; `fxtap` / `fxph`
  with `i` on a classic Inst target the panel it feeds (E9); a preview (`aud`) to a powered-off Inst is dropped; new Insts start at the
  Track's host oversampling; a salt that changes on a live Inst (Make primary) shifts the running PRNG states and a Serum's own streams take
  it at their next attach / reset; the warm-up runs a graph (two classic Insts into a shared panel, a Serum through its own FX into it, a
  power-off with held keys and the restrike) with analog `WARM` patches only, ≈ 25 ms, then `restore` returns the legacy structure.
  Validation inside the engine: ids unique and never `'out'`, 1 ≤ instruments ≤ 8, ≤ 16 panels (an invalid graph is ignored whole); zones
  ints (lo / hi 0…127, xp −48…48); `g` a number 0…1e6 else 1; an edge source `'iN/fx'` means instrument `iN`; a patch with an unknown `i` is
  ignored; a chain message before the first graph is ignored; a power message whose `on` already matches is a no-op.
- **B compile / model / host** (`cv-graph.js`, `cv-model.js`, `cv-migrate.js`, `song.js`, `midi.js`, the host functions of `main.js`):
  §3 as specified plus `compileGraph`, `instPatch` / `chainPatch`, `saltOf` / `zoneOf` / `devNum`; the editing API of §3.2 with `destOf`.
  Decisions: an invalid track still compiles (the first cable per output is kept, panel → panel cables dropped); auto-patch joins only a
  panel that already has an instrument source, else OUT; Serum → classic while feeding a shared panel keeps feeding it and a non-empty own
  FX becomes a new unconnected panel (panel → panel is stage 4); classic → Serum that is not its panel's only source keeps the cable with an
  empty own rack; `removePanel` on a panel with no output cuts its sources; `connect` swaps reversed ports, keeps a re-patched wire's id,
  and refuses only on errors the track did not already have (the own-fx refusal returns `fix: 'panel'`); `sharedPanelFix` joins the panel
  the Serum already feeds; a Serum that folds a panel into its own FX remembers its id (`dev.fxId`, saved) and unfolds under that id when it
  is free, else `nextId` — no other id is ever reused (review H4); `t.fx` of a classic primary straight into OUT reads `undefined` and a
  write is a no-op (`fxOf` hands out a detached empty rack; H4); the legacy node path is taken only for one-instrument tracks whose panel,
  if any, is the primary's (`legacyOk`; H2); a zone or transpose on the sounding instrument makes the shape non-canonical (H3); undo / redo
  keep the sound per device id, the 1c "rack kept on a model change" rule only when the primary is the same device and the rack moved
  between its panel and the Serum (H1); `duplicateTrack` clones every device (H6); a Serum is monitored through its Inst part only (its
  `smon` carries its own FX meters; H5); a graph post is atomic after assets (graph, power, patches, chains, new 303 patterns in one `go`;
  H10 / H11); `lowerOS` re-posts per-Inst oversampling after a broadcast (H7); `cvCpu` prunes removed parts (H9); `curDevs` is cleared on
  New / Open (H13); `toV1` lists zones, cable levels, solo, a Serum feeding a panel and silent instruments that become audible (H8).
- **C1 widgets** (`cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-world.js`, `index.html`, `style.css`): §4.1–4.4 as specified, with
  `devicesOf`, `tidy` for any number of devices, the zone pill / ⏻ / badge, `cablesOf` / `createCableDrag` / `effectsTray` / the world's
  jack hook. Decisions: the Effects tray never closes during a drag (ROADMAP wins over §4.3's "slides shut"); a lifted cable end dropped on
  nothing goes back (Disconnect stays explicit); grey cables also cover solo; cables do not pan (a press selects on a tap); the jacks inside
  a Serum are not patchable (its external jack is `iN/fx.out`).
- **D cost** (`cv-cost.js`): per-model costs measured in node on the reference Mac for all 12 classic models (bench.json has no node
  c-rows; the iPad `c1`–`c6` agree within 0.7–1.05), Serum terms fitted to rows d–h' (±8 %), effects measured per type; `measureDevice`
  runs rows c1, j, e in a Blob Worker (the smprender loading pattern) and returns the median load / reference ratio; soft caps on touch
  devices only; pref `synth.cv.devFactor`.
- **C2 integration** (`main.js`): device views (`instView`; the primary is its track through the transition accessors), the current
  instrument (`curDevs`: last tapped, default the primary; `bind` / `model` / `vals` / `cpanel` follow it), `#inst` / `#fxrack` belong to the
  primary and its FX while other devices get their own elements built after the sync; per-device records `classicPanels`, `serumPanels`,
  `fxPanels`; the Sources tray adds on empty canvas and replaces on a bar or by tap; ⋯ gains Power, Solo in track, Make primary, Duplicate,
  Delete; the Effects tray lists `core.FXTYPES`; cables, badges, soft caps and Measure this device wired. History: Add, Replace, Power,
  Solo, Key zone (coalesced over 2 s), Make primary, Duplicate, Delete, Connect, Re-patch, Disconnect, Make a shared panel, Add FX panel,
  Delete panel are one step each; **an effect added to an existing panel is not a History step** (the rack "+" policy: FX edits are kept
  through undo by the knob-tweak rule), with a notice. Panel titles use the device number ("FX Panel 3").
- **Review fixes U1–U17** (`cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-world.js`, `style.css`, `main.js` canvas regions):
  `fx1` and `i1/fx` share one lay entry only when they are not both modules (U1); `world.band()` now means the visible band minus the
  toolbar and minimap boxes (`reserved()`, `setDragging()`, a `'resize'` event), the default camera, fit, focus and reveal frame into it,
  the minimap hides and the toolbar takes no presses during any drag (`#cvToolbar[data-cv-drag]`), the untouched default camera is
  re-derived on resize (U14); piano-roll auditions reach every powered instrument whose zone holds the note, transposed, with the
  receivers kept per note (U2); the default camera frames the key-zone pill (`zoneW`), so a lone Minimoog opens at ≈ 0.94 instead of 1 on a
  1440 px band, and ⋯ gains "Key zone…" (U3; the user may prefer the pill inside the module instead); Make primary keeps every body
  except the two that change home (U4); the toolbar moves right of an open left tray (U15); new modules follow the Snap toggle (U16);
  ⏻ has a 44 px × `--ik` hit area growing left and up (U5); the badge follows the cable through one panel to OUT, a panel fed by nothing
  says "nothing connected" (U10); an effect dropped on an instrument goes into its FX, a panel dropped on a module lands beside it, an
  Effects drag shows an outline (U11); Duplicate runs the soft caps (U9); `inputSubs` is keyed per device (U6); `wtEdit` remembers its
  device (U7); the chord notice is skipped with several instruments (U8); read-only jacks are not patchable or focusable but remain drop
  targets, so the own-FX refusal and its fix are reached by dropping an output on the Serum's own-FX input or module body (U12, reverses
  C1); a press on a cable pans and a tap selects it (U13, reverses C1); track-switch mounting with several bodies is page-tested (U17).
  New `__synthTest.cv` hooks: `touch`, `wheelToWt`, `chordCheck`, `mount`, `delPanel`.

### 8.2 Gates as measured (M4 Max, node 24, 2026-10-18)

- Sound: golden-classic 8/8, golden-fx 3/3, golden-presets 8/8, golden-random 1/1; golden-graph 6/6 with every classic preset, every Serum
  preset, every FX chain and every 1d case rendered on the new engine in legacy, graph-message and processorOptions form, each bit for bit
  against ref-1c; canonical-stream 1/1 unchanged (fixture untouched).
- engine-track 34/34: copy(A)+B bit for bit at the panel input; co-resident sequencer bound 9.2e-4 (−60.8 dB) beside a TB-303 (asserted
  < 2e-3) and 3.3e-8 beside a Serum ARP (< 1e-6), 1e-16 without controller moves; salts; powered-off TB-303 silent and no span splits;
  power off −77.5 dB / on −62.4 dB; removal < −76 dB at a 0.1 cable, through a quiet EQ kept or removed, and unconnected (E1); quiet load
  0.00021 (Prophet-5), 0.00032 (Serum), 0.00041 (two off with keys held); warm-up first chord ×1.06, restrike ×1.04 of steady state.
- V8 A/B vs the 1d engine (9 interleaved 1 s pairs, 3 processes, median): d 1.002, e 1.000, f 0.995, f' 0.999, g 1.001, g' 1.003,
  g" 1.005, h 0.995, h' 0.999, i 1.003, c1 1.007, c2 1.004, c3 0.999, c4 0.987, c5 0.959, c6 0.993, p 0.980, q1 0.975, q2 0.978; after the
  review fixes d 1.006, g" 1.011, c1 1.008, p 1.013 (A/A floor ≈ 0.5–1 %). Row r (Prophet-5 + Juno-60 + default Serum + EQ / chorus /
  delay panel): 0.097–0.102 calibrated, target 0.15. Allocation-free: noAlloc on a three-instrument graph node with a removed part fading,
  the bench GC check. JavaScriptCore: see 8.4. iPad: pending (the user's five-pass run after the deploy; every row within 5 % of
  `"ipad1d"`, row r within 25 % of the device factor).
- UI: canvas-1e-sim, canvas-sim, cv-shell-sim, cv-fixes-sim, graph-host, cv-module, cv-cables, cv-tray, cv-world, cv-cost, midi,
  cv-graph, cv-migrate, main, lint, pwa green (counts in the sweep log of the deploy commit).

### 8.3 Left for stage 2a

- Remove the transition accessors (`t.model` / `vals` / `preset` / `seq` / `fx`): still ≈ 180 sites meaning the primary. Primary-only
  paths: program change, MPE detection, `zoneOf` (the sample zone), `wtEdit` default, `renderLast` default device, `voiceSeen` and the
  voice-mode labels, `rateText`, `syncPhases` / the FX phase memory on preset save, `resampleTo`, `sxEdit`.
- A dying Inst that fanned out follows only its last panel; graph edits (gain change, disconnect of a sounding Inst) switch without a fade.
- Row r has no `jsc` record yet; SPEC §6.8's protocol table should drop `kind` / `racks` / `order` from the graph message.
- A visual marker for the current instrument; the Serum ARP pause while powered off is not unit-tested (the TB-303 is).

### 8.4 JavaScriptCore gate (macOS jsc shell, both engines in `$262.createRealm()` realms, 7 interleaved 1 s pairs × 3 processes)

Load ratio new / 1d (median of 21 pairs): d 1.003, e 1.013, f 0.992, f' 0.995, g 1.001, g' 0.993, g" 0.999, h 1.001, h' 0.993,
i 0.996 (the measure() overhead itself 0.981), c1 0.995, c2 1.000, c3 1.003, c4 0.995, c5 0.996, c6 1.005 — every row ≤ 3 % (A/A floor
≈ 1 % on medians). Worst quantum, each engine alone (as `measure()`), vs `jsc.worstMs` + 10 %: every row inside except e (0.78–0.86 ms vs
0.81), which the 1d engine misses by the same amount on today's busy machine (Photoshop at 74 % CPU; bench.json's 0.74 dates from
2026-10-13): a baseline gap, not a 1e regression. Row r on JSC: load 0.092–0.096 (target 0.15), worst quantum 0.36–0.40 ms alone.
Harness: scratchpad `jsc1e/` (export.mjs → rows.json + blob.bin, bench.js for jsc, run.sh, summary.py); not in the repo.

### 8.5 Stage 1f: one instrument per track in the UI (2026-10-19)

**Why.** On the iPad the user found a track with five hardware panels unacceptably laggy ("the interface is what is lagging …
zooming and panning"), then: "with 5 panels in view it lags mostly when pinch zooming. also the panels look pixelated at that zoom
and have competing pixels with no anti aliasing so we dont need full resolution rendering at that zoom" (the same in the browser
and the installed app). They chose to take several synths per track out of the UI and keep everything underneath (option A).

**Withdrawn (UI only).**
- Sources tray: a drop anywhere on the canvas replaces the track's instrument (`srcDrag`: stage 1d's `cvDropInstrument` /
  `setTrackModel` path, one History step, "Replaced X with Y · tap to undo", the true-size outline pinned to the instrument); a tap
  replaces; a drop on the track list still adds a track. `cvInstUnder` is gone.
- Module bar and ⋯ menu: no ⏻ and no key-zone pill (`host.power` / `host.zone` not given), no Power / Key zone… / Solo in track /
  Primary instrument / Duplicate / Delete on instruments, no Delete panel. The badge is the CPU safeguard's cap alone (`cvBadge` →
  `capsOf`); the "not connected" badges cannot occur.
- Cables are read-only: `createTrackView`'s new `host.patch: false` marks every cable and jack `data-ro` (no selection, no ×, no
  "Connect to…"); `main.js` no longer calls `cvView.cableDrag`, so the world's jack hook is never installed (cv-world keeps the hook
  and cv-cables `createCableDrag` stays, unused, for milestone 3). Deleted: `cvConnect`, `cvDisconnect`, `cvRefuse` ("Make a shared
  panel"), `cvCan`, `cvTrial`, `cvPortName`, `cvJackPort`, `cvSolo`, `cvMakePrimary`, `cvDuplicate`, `cvDeletePanel`, `cvAt`,
  `fxBeside`, the `__synthTest.cv` hooks `solo`, `primary`, `dup`, `del`, `delPanel`, `cable`, `fx.addPanel`.
- Effects tray: `effectsTray(…, {panel: false})` (no Empty FX Panel tile); an effect tapped or dropped on a panel module, an
  instrument or empty canvas goes into the track's FX (`fxTarget`: the module under the pointer, else the primary's FX module) —
  one notice, no History step (the rack "+" rule); the outline sits on that module (no edge pan). No free panel is ever created:
  the one exception is a classic instrument cabled straight into OUT (a 1e project whose panel was deleted), which gets a panel of
  its own between it and OUT (`cvPanelFor`, one step: the canonical shape again). Tile costs and ⚙ Measure this device stay; the
  soft caps (`COSTM.softCap` in `cvAddInstrument`) stay, reachable only through the hook.
- The current instrument is always the primary: `curOf(t) = CMOD.primId(t)`; `curDevs`, `setCur`, `instView` / `curView` and the
  per-device records stay (the hooks, milestone 3).

**Loading several instruments** (`cv-migrate.splitTracks(p, {name}) → {p, notices}`, called by `main.js loadProject` on the
upgraded object before `song.deserialize` — boot's autosave and File › Open; never on autosave writes, History or `applyRestore`,
so hook-made several-instrument tracks survive undo in the tests). A canonical one-instrument track (compile canonical, nothing
beside the instrument but its panel and OUT; a classic straight into OUT counts) is returned as the same object, and a project of
them as the same project (canonical-stream unchanged). Any other track is rebuilt by toV1's per-instrument rule (`instRoutes`, now
shared with `toV1`), in v2 form: the primary keeps the track (id, name, its device ids, the lay entries of the devices it keeps,
nid) → the panel it fed (its FX state; a classic with no panel gets a new `fx<n>`) → OUT, or a Serum (its own FX; a panel after it
is dropped) → OUT; every other instrument becomes a new track right after it (`trk_<max + 1>`, "<track> · <model name>", i1 [→ fx1]
→ out, nid 2, no lay, notes / cc / colour / channel copied; a shared panel copied for each). An instrument that did not sound (off,
not cabled to OUT, another one soloed) comes in muted (decision: what was heard stays what is heard; toV1 makes it sound because
main has no such state); zones, solo, power flags, cable levels, unconnected panels, a folded panel id of a new track (`fxId`) and
modulation rows are dropped. One notice per project: "Track “X” held N instruments: now N tracks" (several tracks: joined with
" · "), shown after boot or at once on Open; an undo of the Open brings the previous project back. A newer-schema (read-only)
project is never split.

**Stays.** `engine.js` graph protocol (dormant: every track the UI makes is canonical), `cv-graph`, `cv-model`'s editing API,
`cv-cost`, song's schema 4 fields, the host's legacy / graph predicate (`legacyOk`), per-device records and monitors, module CPU
per part, Measure this device, every 1e review fix (minimap reserved box, toolbar beside the open tray, undo per device, no panel
re-insertion …). Their tests are unchanged except as listed below.

**Tests.** canvas-1e-sim rewritten (23): new — a canvas drop replaces (empty canvas or another module's bar, one step, the notice
undoes, a tap too); the current instrument is always the primary; no ⏻ / pill, the menus without device items, every cable and
jack read-only; the Effects tray without its panel tile, every drop and the tap into the track's FX with the outline on it; a
Serum's canvas drop into its own FX and a classic straight into OUT getting its own panel; a saved two-instrument project opening
as two tracks with the notice (undo of the Open restores). Kept (through `cv.add` / `cv.power` / `cv.zone`): the add hook's
protocol (graph + patch i + chain, bodies), power / zones, CPU and monitors per device, per-instrument layouts and Tidy, Measure,
Save as classic project, U1, U14 ×2, U2, U6, U7, U8, U17; reduced: U16 (add only), U9 (add only), U10 (the safeguard badge only).
Retired: cables connect / re-patch / disconnect, the own-FX refusal and "Make a shared panel", ⏻ by the bar button and Solo, the
key-zone pill and ⋯ → Key zone… (U3), Make primary (and U4), Delete / Duplicate, the Effects panel tile and free panels (U11's
panel parts), H4's page test of Delete panel (graph-host keeps the host side). canvas-sim, cv-shell-sim, cv-fixes-sim: every 1e
change reverted to the 1d assertions (drops replace without a bar target, the menu without device items, the default camera
without the pill). graph-host H13 rewritten (the current instrument is the primary; the file opens split). cv-migrate +5 (four
splitTracks cases, the autosave page test), cv-module +1 (`host.patch: false`), cv-tray +1 (`panel: false`).

**Milestone 3's open rendering question.** `tests/ui-bench.html` (eeb4a18): on the Mac, five hardware panels pan and pinch at
60 fps when the camera is driven by code at fit zoom; the touch path and closer zooms were not measured. WebKit re-rasters the
module layers at each pinch step and, zoomed out, rasters them at device scale × k without smoothing — the pixelation and the
aliased thin lines the user saw. The candidate for milestone 3: a smoothed low-resolution raster per module below a zoom
threshold — a rendering tier, not a DOM change (SPEC §2.11's "modules render identically at every zoom" stays) — plus the two
switches ui-bench already tries (per-module compositing layers while moving; off-screen bodies not rendered). Several synths per
track can come back once that is measured on the iPad.

**Review round (1f).** Each fix test-first; the split rules above are superseded where they differ:
- R1 A Serum heard through a panel (every 1e add was auto-patched into the shared panel) keeps that sound: with no effects of its
  own, the panel's FX state becomes its own (reshape's 'moved' rule; also for a lone Serum → panel → OUT); with effects of its own
  they stay and the notice says the panel after it was not kept.
- R2 The notice lists, per affected track (single-instrument tracks too), what did not survive: switched off / not connected /
  soloed out (now muted), a key zone / transpose, a cable level, the panel after a Serum, unconnected panels with effects (30 s).
  The autosave as it was is kept once under `synth.project.pre1f` before the first save (HANDOVER §6).
- R3 Undo / redo keep knob tweaks (`keepDevs`) only within one project (`p.uid === project.uid`): an undo of Open / New brings
  the other project back with its own sound.
- R4 `tests/ui-bench.html` snapshots the project and puts it back (`applyRestore`, saved) after the run; its tracks are deleted by
  object first (it passed ids, which threw silently).
- R5 The first instrument that sounded keeps the track (id, name, selection, its lay), not an off primary.
- R6 The boot's notices (storage, the split, the platform) are joined into one line; a recovered project's notice carries them.
- R7 A classic straight into OUT is no longer kept as canonical by the split: it gets an empty panel `fx<n>` (an empty rack: the
  same sound), so every classic has a panel and `cvPanelFor` / `cvBelow` are gone (`cv.add` without a place leaves it to Tidy; an
  Effects drop on a hook-made classic without a panel does nothing).
- R8 `setCur` returns at once unless given the primary; a new track's base name is cut so " · Model" fits 100 characters; a copy
  of a shared panel does not take its name.
