# ROADMAP 21 (automation recording) — read-only map of `/Users/dom/Documents/Claude - Synth Synth`, branch `canvas`, HEAD d5aad78

Paths are relative to that folder. Nothing was edited. "Does not exist" is stated wherever I looked and found nothing.

## 1. Parameter addressing

**Dest id formats.** A control's address is the pair (nearest ancestor `[data-dev]`, its own `[data-dest]`), joined as `<dev>:<dest>`. The modulation system uses the same string.
- `cv-module.js:1226-1243` (`indexOf`) builds `dv + ':' + id`.
- `cv-cables.js:24,1147` resolves a drop via `closest('[data-dest]')` → `closest('[data-dev]')`.
- `cv-model.js:527` `addMod(t, src, dst)` stores `row.dst = '<dev>:<param>'`.
- `song.js:~690` regex `MDST = /^[a-z][a-z0-9]{0,15}:[A-Za-z][\w.]{0,47}$/`.
- `SPEC-canvas.md:785` states "Destination id `<devId>:<paramId>`. DOM: each module root has `data-dev`, controls keep a local `data-dest`".
- `main.js:10670` (`modSplit`) splits it.

So a dest id IS the modulation id. The `<dev>` is a track device id (`i1`, `i2`, `fx1`, or `mfx` for the master), never a track id.

**`wk.js` plumbing.**
- `wk.js:77-80` `setDest(el, dest)` writes `data-dest`.
- It is called from `update()` of knob (:353), menu (:616), toggle (:841), numBox (:957), seg (:1141) and slider (:1212), so the value can be a function.
- `wk.js:1523` — the XY pad has `data-dest-x` / `data-dest-y` plus a data-dest on each rail.

**Per-panel formats.**
- **Classic synths and drum machines (TR-808 / 606 / 909 / SDS-V):**
  - `classic-panel.js:194` `wrap.setAttribute('data-dest', c.id)`; the id is the `models.js` control id (`cf`, `rs`, …).
  - `classic-panel.js:196` sets `data-dev` = `track.prim` (`i1` …) on the root.
  - Values are native panel units, not 0..1. Knobs are 0..10 or min..max, selectors are an index, toggles are 0/1. Descriptors: `cv-mods.js:368` `classicDescs`.
  - These panels do not use `wk.knob`; they have their own `dragB` (`classic-panel.js:~318`).
- **Wavecraft rig and Serum-engine parts:**
  - The id is a serum-core `DESTS` id (`serum-core.js:535`): `f.cutoff`, `a.wt`, `e1.att`, `l3.rate`, `g.master`, `m1..m8`, virtual `arp.*` / `clip.*`.
  - Values are normalised n in 0..1.
  - Part faces (`rig-ui.js`; `findDest` :123, `V.dests()` :692) are donor panels from `sx-ui-*.js`, with `dest: id` at `sx-ui-osc.js:296` and `sx-ui-mix.js:273`.
  - The module key `i1/filter` is only a module key; the dest `dev` is `i1` (`cv-module.js:1235` takes `k.split('/')[0]`).
  - 900 Series knobs carry `data-dest` but `data-nomod="1"` (`cv-patch.js:882`) and are written by `ptKnob` (`main.js:9926`).
- **Effects (`fx-ui.js`):**
  - Id is `fx.<instance id>.<pid>` (`fx-ui.js:1409` `dest = pid => 'fx.' + id + '.' + pid`; power LEDs `fx.<id>.on` at :1176 and :1261).
  - Normalised n. Rows come from `FXP_TAB` (`fx-core.js:645`).
  - Device is `fxN` for a shared panel, `iN` for a Serum/rig's own FX, `mfx` for the master rack (`main.js:4436`, :7618).
  - Master rack is also `mfx:fx.<inst>.<pid>` (`song.js:~725` normMaster comment).
- **Drum kit (DM):**
  - Ids are `k<slot a..p><field>`: `t` type, `u` tune, `d` decay, `l` level, `c` choke, `1..4` (`kit-ui.js:735,752,754`; `IMPL-DM.md:416`).
  - They are `vals` entries in 0..10 units, written via `P.set(t, dev, code+f, v, ph)` (`kit-ui.js:~722` `setK`), which drops the 'start' phase.
  - `destOk` refuses them: `cv-mods.js:651,658` `NOMOD_KIT` ("take modulation in its next update").
- **Mixer and master:**
  - No `data-dest` exists. The track volume and pan are plain `<input type=range class=hvol/hpan>` (`main.js:4998-5003`) writing `t.vol` / `t.pan` then `mix()`.
  - `mix()` (`main.js:1280-1287`) applies `N.gain.gain.setTargetAtTime(...)` / `N.pan.pan.setTargetAtTime(...)` on main-thread Web Audio nodes.
  - Master volume is `settings.master` (`#mst`, `main.js:11815`).
  - Mute / solo / arm are track booleans.
  - The Serum-side `g.master` / `g.bus1v` etc. are DESTS ids inside `s.p`, not the mixer.
  - `master-ui.js` is meters only.

**What is modulatable.**
- `cv-mods.js:652-670` `destOk(dev, id, keep)` gives a verdict per control.
- Classic: classes sm / apply / proc are OK; chunk is "from stage 5" (refused); struct / none are refused (`CLASS_TABLE`).
- Serum/rig: any `DESTS` id except `PLAIN_SW` (`f.route*`).
- FX: any id whose row is not `nomod`.
- Kit, modulator knobs (`NOMOD_MOD`) and 900 Series knobs: refused.
- This verdict is a ready-made "automatable" filter, but a recorder need not be limited to it; recording writes the base value, not a cable.

**Functions that set a value from an id.** There is no single `setByDest`. Four writers exist:
1. **Classic.**
   - `ClassicPanel.set(id, v, ph)` at `classic-panel.js:138-143`: `vals[id]=v; update(id); host.changed(track,id,ph)`.
   - Host `valChanged` at `main.js:866-877`: `ph==='end'` → `queuePatch` only; otherwise `iv.preset=null` ("Custom"), `N.modsHold` on 'move', `cpVer++`, `queuePatch`, `persist`.
   - `gestureEnd` is `classic-panel.js:144`.
2. **Serum/rig.**
   - `SerumHost.setN(id, n, ph)` at `sx-host.js:2017` (read: `getN` :2016 = `baseN` :247 = `core.destBase`).
   - It routes `isFxPar` → `editFx`, `VIRT_RE` → `virtSet`, else `edit(s => s.p[id]=v; syncS1)`.
   - The host's `edit` is `main.js:4222` → `sxEdit` (`main.js:3556`): `fn(s); sxDirty.add; queuePatch; persist`.
   - Pure helpers: `serum-core.js:3542` `setDestBase(s, fx, id, n, opts)` and :999 `destBase(s, fx, id)`. `midi.js:~147` `writeCC(s, dest, val, fxSet, fx)` writes by dest id for learned CCs.
3. **Effects.**
   - `FXRackUI.setP(id, pid, n, phase)` at `fx-ui.js:1035` → `edit(...)` → `host.editFx`.
   - Host: `main.js:4294` `fxHost.editFx` → `fxEditDev` (:3535) → `fxOfDev(...)`, `fxPrune`, `queuePatch`, `persist`.
   - `fxSet(t, id, n, dev)` (`main.js:258`) uses `core.fxDest(id, fx)` (`fx-core.js:891`) and sets `inst.p[pid]`.
4. **Rack-less mixer values:** direct field write plus `mix()` (above).

## 2. How a knob move reaches the engine today

**Phases.**
- `wk.js:23` documents `set(value, phase)` with phases 'start' (pointerdown), 'move', 'end', 'set' (discrete).
- `wk.knob` emits 'start' at `wk.js:402` (`o.set(n0,'start')`), 'move' at the pointermove (`o.set(n,'move')`), 'end' at :451, and `reset()` and `put()` emit 'set'.
- numBox: :995 start, :1017 end. slider: :1259 start, :1287 end.
- The two-finger rollback sends 'move' (value from before the press) then 'end' (`wk.js:60`, `twoF`).
- **Classic panels differ.**
  - `dragB` (`classic-panel.js:~318-368`) emits NO 'start': `b.set(v,'move')` only when the value changed, then `b.end()` at lift (only `if moved`).
  - Wheel, keys, dblclick-reset and selector/toggle clicks call `set(id, v)` with no phase.
- The kit voice face ignores 'start' (`kit-ui.js` `setK`).

**What main does per phase.**
- **No `History.record` happens on a knob move.** `valChanged`, `sxEdit` and `fxEditDev` record none.
- Knob tweaks are deliberately not undoable: `main.js:1946` "knob-tweak policy (§11.8)" and `keepDevs` :1968 keep device `vals` / `fx` across undo (`applyRestore` :1979, `p.uid === project.uid`).
- A knob move therefore goes: widget `set` → write into `iv.vals` / `s.p` / `inst.p` → `queuePatch(tr)` + `persist()`.
- **There is NO per-parameter engine message.**
  - `queuePatch` (`main.js:692`) coalesces to one rAF per frame per track → `sendPatch` (:741) → `buildPatch` / `sendGraph` → `postPatch` (:772).
  - `postPatch` posts `{t:'patch', p}` (or `{t:'patch', i, p}` for a graph node). It skips the post when `sameVal` shows nothing changed; with only tables changed it posts `{t:'ct'}` / `{t:'sqt'}` (:781-784).
  - The comment `engine.js:364` says "Panel moves arrive as whole patches (~60 Hz)".
  - Shared panel FX: `{t:'chain', c, fxr}` (`postChain` :815).
- **Closest thing to a "set value now" message:**
  - `{t:'mval', k, v}` (engine `Track.msg` `engine.js:4184`, master :5426 → `mc.ctl(k, v)`).
  - Sent by `modVal` (`main.js:10714`) for ModCore's value table (macro knobs and CC modules).
  - Table: k 0-7 macros, 8-23 value sources, 24-31 stored (`mod-core.js` header). Payload side: `VAL_N = 16` value slots per track (`cv-graph.js:533`); pads, combiners and CC modules compete for them (`cv-model.js:403` `VALS_FULL`).
- A held classic knob throttles `postMods` reposts to `MODS_MIN_MS=66` (`main.js:~500`).

**Smoothing.**
- Engine classic: `sm` slots are two cascaded one-poles of ~6 ms (`engine.js:1949-1990`, `smStep`).
- apply / proc / chunk fields jump at patch arrival.
- FX: base one-pole τ = 10 ms × `smooth` (`fx-dsp.js:44`, :3080; `fxp.smooth`).
- `prefs.smooth` (`main.js:157`, clamp 0.01..8, from `synth.sx.prefs`) is passed into `buildPatch` prefs and `compileMods({smooth: prefs.smooth})` (:466).
- `project.rec` has no smoothing field.

**"The knob follows a value" today (modulated value shown on a knob).**
- It is a live marker beside the base, not a moving base.
- `wk.js:372-378` knob `setMod({arcs, live})` / `setLive(n)`; `liveOfV` :186; same on menu :627-629, toggle :847-849, numBox/slider/seg.
- Classic: `ClassicPanel.setMods(rowsByDest, eff)` / `setLive(eff)` (`classic-panel.js:400,412`).
  - Fed by `cpHalos` (`main.js:11358`) → `cpMonitor` (:11368) → `monitors.sub(... deliver: cpSnap ...)` (:11402) with engine eff values (inverse transfer to knob units), plus the fast lane `cpFast` (:3382).
- FX: `fxHalos` (:11300) → `rec.ui.paintMods`; `fxLive` (:11329) → `u.setLive`.
- Serum: `haloArcs` (`sx-host.js:~278`) plus the snapshot's eff.
- Heard time: `heardFrame()` (:6323), `heardTickNow()` (:6334), `motion.js` ring `R.at(Fh)`.
- **Redrawing a base value from outside:**
  - Classic `P.update(id)` / `P.refresh()` (`classic-panel.js:145-146`).
  - wk widget `W.update()`.
  - FX `FXRackUI.refresh/schedule` (via `peerRefresh`).
  - Serum host `ui.queue()` after `edit`.
  - Nothing moves a base knob on a timeline today.
- **Existing "lane at the heard tick" reader:**
  - `modLane(kind, t)` (`main.js:10778`) is a binary search of `t.cc` per kind at `heardTickNow()`.
  - `cvModPlay()` (:10686, called from `frameTick` :6340) updates the Wheel / Aftertouch / Bend module bodies.
  - `perfValue` :2513 is the unsorted-scan version.

## 3. Recording today

**CC (all that exists).**
- `midi.js:324-335` routes each CC to four places:
  1. Serum learn.
  2. `H.modCC` (canvas CC modules).
  3. The roles: CC1 → `ctl('wheel')`, CC64 → `ctl('sus')`, bend, channel pressure → `ctl('bend'/'at')`.
  4. `mapCC` (`midi.js:~175`, `writeCC` into `s.p` for learned CCs).
- **Only `wheel`, `sus`, `bend`, `at` are recorded.** `ctl()` (`main.js:2498`) posts the live message then calls `recCC(trs, kind, v, ts)` (:2413).
- **Learned Serum CCs (`s.midi`) and canvas CC-module values are NOT recorded.**
- Storage: `track.cc = [{t, k, v, take}]`.
  - `k` ∈ `CC_KINDS = ['bend','wheel','sus','at']` (`song.js:24`).
  - Validated by `mkCC` (`song.js:153`); `take` is dropped on save/load.
  - `recCC` pushes `{t,k,v,take}` and de-dupes within 12 ticks (:2423); only for `tr.arm` or `T.padRec` tracks; `recStep()` first.
- Playback: `songData` (`main.js:1864`) emits flat `[t, CCK[k] ?? 1, v]` with `CCK = {bend:0, wheel:1, sus:2, at:3}` (:1858). An unknown `k` silently becomes wheel (1).
  - Sent as `{t:'song', notes, cc}` (`sendSong` :1876, 60 ms debounce, `now` flag).
  - Engine `songMsg` (`engine.js:4738`) stores `this.sc`; `songEvents` (:4818) applies kinds 0-3 at their tick.
  - A bounce passes `songData(tr, start, end)` in `processorOptions.song` (`main.js:5732`).
- Roll and arrangement draw no CC (see §5). `song.js` time operations carry `cc` with seam logic (see §4).
- Replace mode does not sweep CC: `sweep` (`main.js:2433`) filters `tr.notes` only.

**Stage R machinery** (`docs/canvas/IMPL-R.md` §2, lines 32-72; all in `main.js`):
- `const T = {playing, rec, a, as, seekA, pos, startPos, take, lastClr, padRec, pass, pass0, step, stepE}` :2073.
- `passOf` WeakMap :2081; `seekAs` WeakSet :2083; `passStep` WeakMap :2075.
- `passAt(F, a)` :2086; `heardPass(F)` :2091; `chase` / `floorAt` / `heardFloor` :2096-2099.
- `anchor(F, tick)` :2078; `loopInfo()` :2077; `fpt()` :2076.
- `curTick(perfTs)` :2107; `recTick(perfTs)` :2113 (sets `recP`; handles the seek line).
- `toggleRec()` :2183: arms the selected track if none armed, `T.take = S.newId()`, `T.step=-1`, then `play(T.pos, countIn)` or joins the running song. It records no History step.
- `play(from, countBars)` :2127; `stop()` :2141 (`recAdv(recP); finishRec(t)`); `seek` :2175; `reanchor` :2159; `postTransport` :2122.
- `recStep()` :2391: `hist.record(project, 'Record'|'Record pass N', true)` once per pass at its first change; `passStep.set(entry, {take, pass})`. Skipped when `gesture` is true or `recIdle` is set.
- `recAdv(p)` :2406: when the heard pass moves on, commit held notes at the loop end; Replace sweeps the old tail.
- `recStart(tr,key,n,v,ts)` :2334; `recEnd` :2336; `commitNote(r, t1, k)` :2347; `overwrite(tr, x)` :2373; `finishRec(t)` :2386.
- `replaceSweep(t)` :2427; `sweep(ranges)` :2433.
- Undo-while-recording: `undo(own)` :2015, `redo` :2023, `recHold` :2036, `recResume` :2038, `recDropPass` :2047, `keepArm` :2057, `recIdle` :2035.
- Frame hook: `frameTick` (:6335) does `recAdv(heardPass(F))`, `roll.setPlayhead`, `arr.setPlayhead`, `replaceSweep(tk)`, `cvModPlay()`.
- Modes and quantize: `project.rec = {mode:'overdub'|'replace', inputQuantize}` (`song.js:66,756`). Input quantize applies only to note starts in `commitNote` (:2354 `S.quantize`); CC and automation do not use it.
- Arm: per-track `tr.arm` (header button `main.js:4987`); `#tRec` button (`index.html:70`).
- Held notes use `recLive` / `recCut` maps (:2319-2333).

## 4. Song model (`song.js`)

**Track object.**
- Created by `newTrack` (`song.js:77-97`): `{id, name, color, model, vals, preset, ch, mute, solo, arm, vol, pan, notes: [], cc: []}`.
- v2 canvas tracks add `prim, nid, dev, wires`, plus optional `mods`, `mid`, `lay`.
- Note `{id, t, d, n, v}`; cc `{t, k, v}`.
- `PPQ = 960` (:16).
- `takes` / `lanes`: there is no such field; take only rides on live objects as `take` on notes and cc.
- **There is no `normTrack`.** The track whitelist is inline in `deserialize` (`song.js:736-820`, the `tr = {…}` literal at ~:778) plus:
  - `normDev(r)` (:584, returns `{prim, nid, dev, wires, mods?, mid?}`);
  - `V2_KEYS = ['prim','nid','dev','wires']` (`cv-migrate.js:~131`);
  - `normLay` (:554);
  - `normMods` (:685).
  - Unknown track fields are dropped on load. A new per-track automation store must be added there or it vanishes on reload / undo / file.
  - Other copy sites to touch:
    - `duplicateTrack` (`main.js:5039`: `c.cc = …` then copies `mods`, `mid`, `lay`);
    - `cv-migrate.js:545` (splitTracks: `tr.cc = plainCopy(t.cc)`);
    - `loadProject` extras (`main.js:306-330`);
    - the `song.js` range ops, which handle `cc` with seam logic at :128 (songEnd), :314-320 (copyRange), :331-340 (clearRange), :344-355 (deleteTime), :365-372 (insertTime), :385-406 (pasteRange / duplicateRange);
    - `exportMIDI` (`ccBytes` :~848: any non-wheel/sus/at kind falls to a pitch-bend event) / `importMIDI` (:972-977);
    - lint's accessor ratchet (`tests/lint.test.mjs:100`) only counts v1 track fields, which a new `track.auto` would not trigger.

**History** (`song.js:425-535`).
- `hist = new S.History(200)` (`main.js:366`).
- Snapshots are per track (`{m, t[]}`, interned strings, 64e6 chars cap).
- `record(project, label='', force=false)` :456 (skips if top equals state unless `force`; always `dropRedo()`).
- `dropRedo()` :463; `undo(project)` :471; `undoStep` :481; `redo` :489; `prune(project)` :500 (drops newest steps equal to project); `mark(project)` :507 / `fold(mark)` :508 (one step for several records); `canUndoFrom/canRedoFrom` :519; `entry.meta` (a step's own data, carried across undo); `seq` counter.
- Any new per-track field is snapshotted automatically (whole track JSON). Device `vals` are restored by undo only for loads, never for knob tweaks (`keepDevs`).

**Schema.** `export const SCHEMA = 18` (`cv-migrate.js:133`).
- `STEPS[]` (:~143-189): each stage appends a step; additive steps are `p => Object.assign({}, p, {schema: N})`. The stage DM step 17→18 is the last (:~188).
- `upgrade(o)` :~203 (a newer schema → `readOnly`).
- `stamp(p, src)` :~284. Readers: `appstore.js:13` (schema gate), `main.js:98,112,128`.
- Bumping means: `SCHEMA`, one `STEPS` entry, `tests/cv-migrate.test.mjs` pins, and the "a newer file opens read-only" notice. `IMPL-DM.md` §5.6 and §6 (G6) is the model.

## 5. Piano roll, arrangement, transport

**Roll (`roll.js`, 1629 lines).**
- Lanes: only the **bottom velocity lane**, fixed height `VEL = 72` (:13; `gb` = H − VEL − 1 :138; `v2y/y2v` :182-183; `_region` :198 returns 'vel'/'velg'; `_velDown` :1027; velocity paint `velpaint`).
- **No CC lane or automation lane exists in the roll, and no CC drawing anywhere.** The only other regions are 'ruler', 'corner', 'keys', 'grid'.
- Hosted by `initEditors()` (`main.js:5099`); `roll = new PianoRoll($('#rollwrap'), host)` at :5117. Host members:
  - `getProject`, `getTrack` (`trk()`), `edit(label, fn)` (→ `edit()` :1934: `hist.record(project); fn(); changed()`);
  - `beginEdit` (`hist.record(project); gesture=true`; the label is ignored) / `endEdit` (`gesture=false; changed()`) / `changed` (`sendSong; arr.render`);
  - `audition`, `auditionOff`, `getPlayhead` (`curTick`), `setPlayhead` (`seek`), `setLoop`, `restoreLoop`, `getSnap` (`project.snap`), `onSelect`, `touch`, `rollRowH`, `onRows`, `mods`, `consumeMods`, `drumRows`, `drumRowsOn`, `heldNotes`.
- Roll API used by main: `render()` :217, `_view()` :219, `setTrack()` :221, `setHeld` :229, `setPlayhead(t, sync, play, floor)` :347, `reveal(t)` :361.
- The roll sits in `#tab-roll` (`index.html:257`), toggled with the canvas view (`#tab-inst`).

**Arrangement (`arrange.js`, 481 lines).**
- One canvas `Arrangement(container, host)` (:13), ruler plus **one lane per track**, fixed `rowHeight: 56` (`main.js:5110`; `rh()` :127).
- **No clip model, no clip objects.**
  - A "clip" is whatever the track's notes span (`first..last`) painted as a tinted block with mini-notes (`paint` :373-430, notes loop ~:416).
  - Time is selected as a bar **range** (`host.getRange` / `setRange`; `rangeOp` in main :~5160 → `S.copyRange/clearRange/deleteTime/insertTime/pasteRange/duplicateRange`).
- Host: `getProject, selectTrack, openTrack, getPlayhead, setPlayhead, setLoop, restoreLoop, getRange, setRange, rowHeight`.
- Track list: `#heads` rows from `renderHeads()` (`main.js:4960`). The studio is `#studio` (`index.html:187`), height set by `#topGrip`.
- Hooks reading the project: `arr.render()`, `arr.setPlayhead(tk, true)`.

**Time, clock, heard frame.**
- `PPQ = 960` (`song.js:16`); `barTicks` / `beatTicks` :102-103; `fpt()` frames per tick (`main.js:2076`).
- Loop: `project.loop = {on, start, end}`; `loopInfo()` :2077; `setLoop` :5083; `reanchor` on change.
- Anchor `{frame, tick, fpt, loop, ls, le, wrap}` (:2078).
- `audioclock.js`: `tickAt(F, a)` :60 (wraps at `le`), `heardTick(F, as)` :68, `outFrame(C, ctx, ts, now)` :56, `renderTime` :41, `outDelay` :48.
- `main.js`: `outFrame(perfTs)` :2103; `curTick(perfTs)` :2107; per-frame `heardFrame()` :6323 (one `getOutputTimestamp` per frame); `heardTickNow()` :6334; `frameHeard()`.
- Heard-frame queue / ring: `motion.js` (`ring(w, kinds, o)` :74; `R.push(F,…)`, `R.at(Fh, out, sr)`); the fast lane `fastTick` (`main.js:3429`, `wkClock.add({name:'fastTick'})` :11853).
- Engine side: `Track.tickAt(F)` (`engine.js:4766-4783`), `transportMsg` :4766 (stores `tp.pend`), `songEvents(F)` :4818 returns frames to the next event, and `process` :4972 splits spans at that distance (`len = max(4, ceil(d/4)*4)`), i.e. event timing is quantised to 4 frames.
- Metronome: `metroTick` :2278.

## 6. Engine side

**Worklet message types** (`Track.msg`, `engine.js:4155-4197`):
- Notes: `on`, `off`.
- State: `patch` (via `partMsg` → `setPatch` :2186), `chain`, `graph`, `power`.
- Timeline: `song` (`songMsg`), `transport`.
- Controllers: `bend`, `wheel`, `at`, `sus`, `pat`, `mpe`, `os`.
- Modulation: `mods` (`modsMsg`), `mval`.
- Assets and misc: `wt`, `wtf`, `wtdel`, `smp`, `smpdel`, `smon`, `mon`, `fastOn`, `fxph`, `fxtap`, `seq`, `seqcmd`, `sqt`, `ct`, `panic`, `bye`.
- Master processor: `engine.js:5419-5436` (`chain`, `transport`, `mods`, `mval`, `mon`, `fastOn`, `bypass`, `mreset`, …).
- Initial options: `processorOptions` (`main.js:1161` song, transport, patch, seq, …).

**Is there a sample-accurate scheduled parameter change?**
- **No** for parameters: every parameter change is a whole-patch post applied at message arrival, then smoothed.
- Timed events exist only for notes and the four CC kinds: the `song` message's `sn` and `sc` arrays, consumed in `songEvents` at 4-frame span granularity against `tp.tick`.
- A timed-parameter path would be a new array alongside `sc` handled in `songEvents`, or a new ModCore source (`mc.transport(playing)`, `engine.js:4796`; ModCore has per-chunk evaluation, `mod-core.js` header).
- `SPEC-canvas.md:90` records "Per-parameter automation lanes (a later 'lane' source module fits the modulation model)" as a v1 non-goal.

**Goldens (what a new path must stay out of).**
- Files: `tests/golden-classic`, `-fx`, `-presets`, `-random`, `-graph`, `-drums`, `-606`, `-909`, `-sdsv`, `-kit`, `-lc`, `-moog`, `-moog-b`, `-moog-c` (`.test.mjs`); harness `tests/golden-harness.mjs`.
- `golden-harness.mjs` header: ref side `tests/ref-p1/` (Phase-1 `serum-core`, `wt`, `models`, `serum-dsp`, `fx-dsp`, `engine`) vs the current tree; DSP list `DSP_V2` :~28.
- `golden-graph.test.mjs` (header :1-13): compares the current `engine.js` with `tests/ref-1c/engine.js` (SHA-pinned; `REF_SHA` :~19) in legacy, graph and processorOptions forms, including "the posted messages equal".
- Other frozen refs under `tests/ref-*`: 7a-7d, 9, 9-core, 9b, 9c, DM, LC, M, MM, P, SC, SX0, WC (each with `MANIFEST.json`; sha-pinned in their tests, e.g. `golden-drums.test.mjs:126`).
- A new engine path must be inert without its new message or payload field: no new keys in `processorOptions` / `po`, no new engine-posted messages for tracks without automation. Also pinned by `tests/canonical-stream.test.mjs` (stream fixture `tests/fixtures/stream-main.json`) and `tests/engine-track.test.mjs`.
- Adding a DSP script would also have to join the §0.3 list (`wk.js` `loadDSP.URLS`, `golden-harness.mjs` `DSP_V2`, `bench.html`); `engine.js` alone needs none.

## 7. Tests and gates

**Page-simulation harness.**
- `tests/main-sim.mjs` (431 lines) boots the real `main.js` against a DOM stub (`makeDom` :~40), Web Audio fakes, a real `SynthProcessor` per node via `tests/dsp-scope.mjs`, fake storage / IDB (`tests/fakes.mjs`), a controllable rAF (`sim.raf()`), and a fake `performance.now()` (`sim.ms`).
- API: `sim.power()`, `settle(n)`, `run(frames)`, `raf()`, `key(code, down, ev)`, `$()`, `nodeOf(trackId)`, `ms`; `bootMain({ls, idb, clock:'std'|'webkit', outLat, …})`.
- main.js publishes hooks at `main.js:11875` (`__synthTest.api` = project, nodes, noteOn/noteOff, ctl, transport (T), curTick, songData, postTo, buildPatch, sxHost, fxHost, roll, arr, …), `globalThis.__synthTest.acc` (:11890: classicPanels, instView, loadProject, …) and `.cv` (`cv.hist`, `cv.undo`, `cv.classicPanels`).
- `tests/canvas-R-sim.test.mjs` (756 lines):
  - Header :1-11. Boot at :21 `await bootMain({ls: fakeStorage({}), clock:'std', outLat: 0.03})`.
  - Helpers: `until(pass, to)` :31 runs the engine in 128-frame quanta, an rAF every 6 quanta, until the heard tick is past `to` of loop pass `pass`; `take(o)` :54 sets notes, arm, bpm 240, loop 1920 ticks, Overdub/Replace, then clicks `#tRec`; `play(n, pa, a, b)` :70; `stopAll`; `undoKey` / `redoKey`; `engSong` :81 reads the node's `proc.sn`; `debounce` :83 settles the 60 ms song timer; `labels(k)` :86 = `cv.hist.u.slice(-k).map(e=>e.label)`.
  - Style: strings, numbers and booleans only into assert.
  - To move a classic knob in a sim: `cv.classicPanels.get(trackId + '/i1').set('cf', 3)` (`canvas-2b-sim.test.mjs:164`).

**Fake DOM and safety.**
- `tests/serum-ui-stubs/dom.js`: `safeAssert(assertBase)` :20 is a Proxy over `node:assert` that scrubs fake nodes via `scrub` before `equal` / `deepEqual` / `ok` (the 32 GB hazard, header :1-6).
- `CLAUDE.md` Tests section: new test files `import './v8-guard.mjs'` FIRST (`tests/v8-guard.mjs`: `v8.setFlagsFromString('--no-sparkplug')`; `lint.test.mjs:116` enforces), versioned imports (`?v=9`), never fake-DOM nodes to bare `assert.*`.
- One file at a time: `node --max-old-space-size=2048 --test tests/<file>.test.mjs`; `tools/sweep.sh` runs all.
- Lint: `tests/lint.test.mjs` (every import carries `?v=N`; `VERSION` equality; the accessor ratchet).
- PWA: `tests/pwa.test.mjs` plus `node tools/precache.mjs --write` after any site file change; new modules must be reachable from `main.js`.

**Frame and layout gates.**
- `tests/ui-bench-fps.mjs`:
  - `SCENE_IDS` :62 = idle, play8, roll8, tutorial, mods, master, busy, clip, comb, kit.
  - `EXPECT` lists per scene (:87 play8, :91 roll8).
  - `BUDGET` :~48: frame cost med ≤ 2 ms / p95 ≤ 4 ms at 1×; 4× at 60 Hz med ≤ 8 ms; 6× ≤ 12 ms; layout+style ≤ 1 ms/s; heap ≤ 1 MiB/s; rate ≥ 0.8.
  - Scenes are built in `BUILD` (`play8` :660 = 8 tracks playing, arrangement playhead; `roll8` :669 = roll open).
  - Run with Chrome for Testing; its test is `tests/ui-bench-fps.test.mjs`.
  - A new lane or panel drawn per frame would need its own scene (or `EXPECT` entries) there.
- Other benches: `ui-bench-frame`, `ui-bench-wc` (module canvas pan/pinch), `ui-bench-1i`, `ui-bench-m9`; `tests/bench.json` rows.
- Layout gates (Chrome for Testing, not in the sweep): `tests/ui-layout-wc.mjs` (rig faces), `ui-layout-fx.mjs` (FX look), `ui-layout-kit.mjs` (DM). `rig-grid.js` `GRID` numbers are pinned; any new knob face reuse must leave their JSON identical (`IMPL-DM.md:575` G8).
- Roll tests: `tests/roll.test.mjs` (lights read budget).

## 8. Docs

- **`docs/canvas/ROADMAP.md:42` row 21, verbatim:** "Automation recording (requested 2026-10-26) | The user: "eventually we will need to add modulation recording on the tracks like ableton has for as many variables as we can" — arm, move knobs while the song plays, the moves become editable automation curves per track, played back (the knob follows) until the user grabs it (override / re-enable as in Ableton). Every control already carries a data-dest id (the modulation addressing), so nearly every parameter can be a target (synths, Wavecraft, effects, mixer); reuse stage R's recording / per-pass undo / overwrite and the existing CC recording. Questions when it starts: lanes under the clip vs in the arrangement, grab = pause vs overwrite, which parameters first | **Eventually** (the user)".
  - Row 22 (master modulators, :43) overlaps: the master canvas refuses modulation today ("no modulation on the master canvas", cited at ~`main.js:9621`).
  - `docs/HANDOVER.md:51`: "move ROADMAP 21 up the queue?" asked, no answer yet.
  - Decisions log is ROADMAP :~93 onward.
- **`docs/canvas/SPEC-canvas.md`:** only `:90` "Per-parameter automation lanes (a later "lane" source module fits the modulation model)" under non-goals; :785 dest id; :750 MIDI learn; :470, :915 drop resolution. Nothing else on automation / lanes / clips beyond the Serum clip player.
- **`docs/canvas/IMPL-R.md`** (285 lines): §1 Overwrite :14, §2 One undo step per loop pass :32, §3 Piano roll's lights :73, **§4 Limits :114-139**, then "Review fixes (lane B)" :140 and "(lane A)" :178.
  - Limits that bear on 21: the pass step costs one whole-project History snapshot at its first change (:116); keys held at Ctrl+Z are not recorded; Replace's sweep follows the heard playhead while the engine renders ahead; the roll lights only the shown track's song notes; "the step labels are kept for a future undo menu: the toolbar shows none".
- **`docs/canvas/IMPL-DM.md`** (the model of a contract), section structure:
  - Title "Stage DM … — contract" :1, header block to :101, `## 0. What exists (facts at ⟨B⟩ = …, re-pinned by the skeptic; "→" what they force)` :102, `## 1. What the machine is` (1.1 modules, 1.2 flows) :136, `## 2. The voices` :180, `## 3. The sequencer` :245, `## 4. The faces and the canvas` (4.1-4.8) :311, `## 5. The model and the project` (5.1 model entry … 5.6 Schema 18 … 5.8 Bounce and files) :406, `## 6. Hooks for row 20 / 26` :486, `## 7. Engine work and cost` (7.1 Files, 7.2 Budgets, 7.3 UI on the iPad) :515, `## 8. Gates` (table G1-G12: columns gate / what / target) :564, `## 9. Lanes` (9.0 before the builders, 9.1 lanes table, 9.2 Interfaces, 9.3 Rules, 9.4 Pins that move by design, 9.5 Docs) :583, `## 10. The cuts` :653, `## 11. Questions for the user` :683, `## 12. Known limits` :704, `## 13. Notes (the builders fill in)` :732, `## 14. Skeptic + re-plan` :1352 (14.1 facts re-pinned … 14.6 questions), `## The user's answers` :1507.
  - Tags used inline: [C] contract, [R] reference to a line at ⟨B⟩.
  - Gate G1 (:567) is the "every golden exact, canonical-stream fixtures, existing tests green with only §9.4's pins moved" row to copy for a goldens-untouched rule.

## Findings that bear on the contract

1. **Recording hook.** There is no central "a parameter changed" signal. The three writers `valChanged` (classic), `sxEdit` / `SerumHost.setN` (Serum / rig) and `fxEditDev` (effects) are the natural places to emit (track id, dev, param, value, phase). Mixer and master volume need their own `data-dest`-less hooks.
2. **Playback.** Moving a knob from a timeline needs a base-value writer per family: `ClassicPanel.set`, `setDestBase` with `queuePatch`, `fxSet` / `fxEditDev` (the three above), plus a repaint. Alternatively a ModCore lane / `mval` source avoids whole-patch posts, but ModCore has only 16 value slots a track and `destOk` refuses chunk, struct, kit and 900 Series knobs.
3. **Phases.** Classic panels emit no 'start' phase, so grab detection there is the first 'move' (or a DOM `pointerdown` on `[data-dest]`); wk widgets and the Serum / FX paths do emit 'start'.
4. **Undo.** Knob tweaks never enter History and survive undo (`keepDevs`), but anything stored on the track (like `cc`) is snapshotted and restored with the pass step (`recStep`).
5. **Do not reuse `track.cc` for arbitrary parameters.**
   - `mkCC` rejects any `k` outside `CC_KINDS`.
   - `songData`'s `CCK[k] ?? 1` turns unknown kinds into wheel.
   - `ccBytes` exports unknown kinds as pitch bend.
   - `modLane` / `perfValue` filter by kind.
   - A separate per-track store needs `deserialize`, `duplicateTrack`, `splitTracks`, range ops, MIDI export and a schema bump (SCHEMA 18 → 19).
6. **UI hosts.** Neither roll nor arrangement has an extensible lane system. The roll's bottom strip is the hard-coded 72 px velocity lane, and the arrangement is one fixed 56 px canvas row per track with no clip model. A lane UI is new geometry in either; the studio height is governed by `#topGrip`.