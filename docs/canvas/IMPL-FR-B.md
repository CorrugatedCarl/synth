# Stage FR, Cut B: per-frame truth in heard time (IMPL-FR-B) — contract, amended after the skeptic's review (§13) and the user's answers (§11)

ROADMAP row 23 (docs/canvas/ROADMAP.md:44 [R]), Cut B. The design notes are IMPL-FR.md Part II (§II.1–II.4). This contract fixes them.
Cut A is live (IMPL-FR Part I; its facts, lanes, reviews and fixer notes are in IMPL-FR §11–§14, current at 76f79ee). **Base: `canvas` at
c515abf** (76f79ee plus the popup skins, the cords' track-switch rest and ROADMAP 26; that diff changes no file or behaviour Cut B relies
on: main.js gained only the `popSkin` hook, wk.js only `popSkin` / `skinTo`, checked). Tags as IMPL-FR: **[R]** a fact (file:line at
c515abf, checked for this contract), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with
a reason in §14, never an [R]).

**Scope.** Every motion display gets per-frame truth in heard time:
- **The fast lane.** The engine posts *outputs* at up to 120 Hz, and only while a display asks.
- **The anchor ring.** The page keys the posts by audio frame `F` and reads them at the heard frame `Fh`. It interpolates, and extrapolates
  within a bound.
- **The consumers.** Serum / rig LFO and ENV dots, knob rings and mod arcs, the heavy displays (under Cut A's rate class), fx-ui GR /
  Ducker, the master's meters, and the canvas and master modulator bodies.

**The goal.** 240 fps visibly smoother than 120. Today's LFO data is ≈ 29 Hz (engine.js:4737 [R]: a post every `base · 0.033` frames, 13
quanta at 48 kHz). The ≈ 35 ms an interpolating glide would have added (map-fps.md:119 [R]) is gone: no glide, the value at the heard frame.

**Added scope (the user, 2026-11-01): the track-side BPM-LFO tempo gap is fixed inside Cut B.** BPM-synced canvas LFOs on tracks follow the
real tempo everywhere, so the per-frame display and the sound agree (§1.1). This is a deliberate sound change for those tracks, and §9
lists exactly what moves. **ROADMAP 26** (the LFO combiner, ROADMAP.md:47 [R]) stays in view: §10 says what Cut B exposes for it.
Nothing of it is built here.

**Standing rules.** Sound bit-identical everywhere else (every golden), browser first (no iPad app rebuild; its node tests stay in the
sweep), no per-stage iPad session, "push it live when it's done", the leaner multi-agent shape (a contract first, builders in worktrees reset
to the base, failing-test-first fixes, one sweep, one test file at a time).

**Invariants**
- **FR1 (kept).** Without `{t:'fastOn'}` every Track / MASTER post is byte for byte today's: golden-graph's message logs
  (tests/golden-graph.test.mjs:244–260 [R]), master-proc:384–393 [R], engine-track:160–167 [R].
- **FR1b.** With the fast lane **on**, the audio and **every slow message** are identical to fast off. `stats` is timing, so it is left out
  of the comparison. The fast lane never steals the slow lane's peaks: its accumulators are its own (§2.4).
- **FR4 (kept, made exact here).** Visual values are read at `Fh` (§3). A retrigger, a seek, a stage change or a GR step shows on the first
  frame whose `Fh` has reached its `F`.
- **FR5′ (refines FR5, [C]).** The fast lane is opt-in, ≤ `FAST_MAX` = 120 Hz per part and allocation-free in the worklet (persistent
  message objects and arrays). A message is ≤ 2 KB and carries ≤ 4 arrays: 70 fixed floats + ≤ 64 requested `eff` values + a GR block do
  not fit Part II's "≈ 400 B". The clone cost is per object and array more than per byte, and G8 measures it.
- **FR6 (kept).** Never below 60 fps. The iPad does not regress: its data is capped at 60 Hz (§6).
- **FR7 (new).** Visual readers read the **view** (heard time). **Functional** readers keep the **raw** slow message: the CLIP recorder,
  the phase capture (`memNow`, `notes`) and the CLIP playhead's own post-anchored machinery (Cut A B6). A heard-time value never drives
  a recording or an edit. **The functional work keeps its slow cadence while the fast lane is live** (§13 P1-1: once per slow message, on
  the first frame after it, §4.3).
- **FR8 (new, the tempo; the user, QA: "fix all of it, no switch").** Every tempo-dependent law of a canvas modulator on a track runs at
  the project tempo in every state (playing or stopped, ANCHOR on or off), live and bounced alike. ModCore's `m.bpm` (sx-mod.js:1268 [R])
  feeds all of them:
  - BPM LFO rates: `lfoHz` :410; the steps :1104 / :1121 / :1158 / :540 / :2102;
  - the anchored in-span ramp: `dB` :1299;
  - **Hz LFOs with ANCHOR on**: :1147, `x = lfoStart + beat · 60 / bpm · hz`;
  - **BPM ENVs**: :2049, `k = 60 / bpm`;
  - **the chaos BPM snap**: `snapRate(rate, bpm)`, :1235 / :2139;
  - **the rise / delay time scale**: `tsc = 120 / bpm`, :510 / :1226 / :1782 / :1936.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at c515abf; "→" what they force)

| piece | where [R] | → Cut B |
|---|---|---|
| **The slow posts.** The Track's gate `this.mon && (monF += n) ≥ base · 0.033` (≈ 29 Hz); `watch(all, ids)` **posts a full snapshot at every `{t:'mon'}`**; `postMon` sends one message per subscribed part (legacy `i0` / `c0` without ids; graphed `{i}` / `{c}`; `{mc, mcx}` for `'mods'`); `F` is in no slow message; `this.frames = currentFrame + n` (context frames) | engine.js:4737; :4100–4121 (posts at :4109 / :4120); :4954–5008; :4703–4704 | `F = this.frames` on every fast post. Rate / ix changes travel in **a new message `{t:'fastOn'}`**, never as `{t:'mon'}` fields (every `mon` costs a full snapshot; Cut A's lesson "add a message, not a field") |
| **The snapshot's side effects.** `SD.snapshot(I)` **resets the channel peaks** (`sx.pk[c] = 0`, serum-dsp.js:2036) and writes `sx.snap`; the Track resets `I.mixPk` per slow post (engine.js:4964 / :4995); `Meters.summary` **restarts tp / pk** (master-dsp.js:298) | as cited; peak taps serum-dsp.js:3587–3590, engine.js:3453–3474 (`peak2` :3488), master-dsp.js:178–233 (`pL` :215, `tL` :228, write-back :233) | the fast reads are **separate and side-effect-free**: `sx.pkF`, `I.mixPkF`, `Meters` `tF / pF` + `peek()` (§2.4) |
| **SxMod's snapshot reads.** `snap(proc, sx, s)`: `eff` (NSV from the recent voice's `mv.eff` / `m.bT`, FX `base + fxOff` clamped), the LFO phase / out / Y kind logic, ENV value / stage / time | sx-mod.js:1456–1476 (eff :1458–1464, LFO kinds :1465–1473, ENV :1474–1476) | the fast read uses **an additive copy** of those lines in sx-mod.js (`snap` untouched; a test pins equality) |
| **The snapshot layout.** `makeSnap`: `eff` F32[NSV + MAXFX = 429 + 1160], `lfoPh / lfoOut / lfoY` [10], `env / envStage / envT` [4], `wtPos` [3], `smpPos` [12], `noisePos`, `notes`, `mix` [11], `seq` F64[16], … | serum-dsp.js:1656–1665; `NSV / MAXFX` sx-base.js:112, serum-dsp.js:156 | the fast vector's fixed part `SXF` (70 floats, §2.2) |
| **The sequencer read.** `sq.snapshot(out)` fills `seq` with no side effect | sx-seq.js:1803 | the fast `q` reuses it |
| **ModCore's monitor fields.** `MC.live` F32[16] written per span; `livePh` F32[20] / `liveEnv` F32[8] written by `mread()` **only while `MC.mon`** (the `'mods'` id); `fxMon(id)` copies `fxv` into a persistent array | mod-core.js:158–183 (`mread` :172; per span :374); :397–402 | the fast `'mods'` part needs `'mods'` watched (`ids ⊆` the watched ids); `MC.fastRead(x)` packs the two fields |
| **The rack's GR.** `gr()` returns the persistent `grOut` F32[4 · 48] (instance `i` at `[4i…4i + 3]`), written in `post()` for unit kinds 6 / 14 / 22 (22 = the Ducker: `[4i]` dB, `[4i + 1]` position or −1); `grOut.fill(0)` on a layout change | fx-dsp.js:2299, :2770, :3429–3441, :2522 / :2834 / :2842; fx-ui reads `[o + 1]` for a Ducker, fx-ui.js:2567–2569 | `grFast()`: a persistent `grF` sized at layout to the highest GR index (Part II's P3-2) |
| **The classic adapter.** `Inst.modEff()` returns the persistent `moEff` (engine units, per payload row) | engine.js:2138–2149; posted as `{s: {eff}}`, :4980 | the fast `e` |
| **MASTER.** `watch(ids ⊆ ['meters','mfx','mods'])` posts at once; `postMon` sends `mmon` (`Meters.summary`), `{c:'mfx', gr, fxph, ftap, mo?}`, `{mc, mcx}`; the gate is `(mm ∥ mx ∥ mcMon)`; `this.frames` | engine.js:5306–5311, :5315–5323, :5380, :5366–5367 | the same fast parts by the same names |
| **The audio clock.** `outFrame` = the render time − `outDelay` (WebKit: smoothed `outputLatency` + ring + stalls + pipe; Chromium: the speaker stamp); `heardFrame()` is **one `outFrame` per rAF**, shared; `heardTickNow()`; the hosts get `heardFrame / heardTick / fps` | audioclock.js:41–70; main.js:5905–5911; :3883 / :3919 / :7140 | a post's `F` leads `Fh` by `outDelay` (10–40 ms; 150+ ms on Bluetooth): **read at `Fh`**. Precedent: cv-drum's heard queue `deliver(e, upto)` (cv-drum.js:354–369) |
| **The page monitors.** `monitors.sub / wanted / sync / deliver / fx`; `on` holds the ids' `join` (`monitors.fx` splits it); `wanted → []` while `document.hidden`; the track handler (:1158) and the master's (:1442–1443) | main.js:3060–3108 | `sub(…, { fast, onFast, ix })`, a separate `fastOn` map, `deliverFast` (§5.1) |
| **The consumers today, at delivery (29 Hz).** Serum: `sxMonitor → r.ui.setSnapshot`; mods: `mcMonitor → mcSnap → B.update(v)`; FX: rec subs (`rec.gr`, `fxLive`); classic: `cpMonitor → cpSnap → P.setLive`; master: `mout.update` / `mrow.update` | main.js:3109–3118; :9666–9690; :4039, :7159, :10290–10304; :10329–10365; :7108, :7258 | each gets a ring and a per-frame read (§4, §5) |
| **The Serum host.** `setSnapshot` stores `smon` / `snap` = `msg.s` and paints in one rAF; `paintMods` calls `el.wk.setMod({arcs, live})` per modded control (`modEls[].i` = the eff index, collected in `scanMods`); `updateVoices` runs every page's `kit.live` callbacks; `kit.snap: () => ui.snap`; `shownPages()` allocates per call; the readers of `this.snap` | sx-host.js:2428–2447, :2475–2483 (`modEls` :2471), :2484–2507 (lives :2503–2506), :1654, :2357; readers :2059, :2476, :2486, :2500, :2532, :2535, :4027, :4161 | `this.snap` **is the view**; `this.raw` = the message's `s` (FR7); a host clock client (§4) |
| **The kit's live users.** The MIX meters `meterFrame` (sx-ui-mix.js:271, :553–562, :588); the XY dot / filter handles (sx-ui-osc.js:2381, :2556); the unison warning (:2804); the ARP pattern editor's playhead (sx-ui-seq.js:1013–1017); the CLIP page (recorder + head, :2132–2157); `headSee` / `seeSnap` read `K.snap()` + `K.snapSeq()` (sx-ui-seq.js:1849, :1941) | as cited | visual users move to **`kit.frame(fn)`**; `headSee` / the recorder read **`kit.msg()`** (FR7) |
| **The heavy displays.** `liveN` / `livePos` / `liveQ` / `posQ` read `kit.snap().eff[vi]` / `.wtPos` while `notes > 0`; `HEAVY_HZ = 60` on the wavetable display, the filter display and the spectral filter; `rateMs` (`k = floor(E / 60)`); `impulse()` → `filterImpulse` / `SxFilt2.impulse`, which allocate a fresh `SFilter` + 4096 arrays (≈ 330 KB a redraw, IMPL-FR §14 M-A "for the lead" (1)) | sx-ui-osc.js:767–782, :119, :1534 / :2568 / :3121, :3245–3258; sx-host.js:1184; serum-dsp.js:1525–1541 (`SFilter` :650, `reset()` :1142); sx-filt2.js:942 | the view feeds their keys per frame, so the rate class now binds (60–119 / s); an impulse **scratch** (§2.6) or the heap gate fails |
| **The live dot.** `haloPainter(arcs, liveN)` repaints arcs and the dot together; `liveOf` (shown when `|live − base| > 0.002`); `attr` skips no-op writes; the knob's `setMod` (:357–361), the ring toggle's (:828), the modBar widgets' (:610, :949, :1148, :1205) | wk.js:154–176, :180–186, :73 | **`el.wk.setLive(n)`**: the dot alone (§4.5) |
| **fx-ui.** `grLoop` is `ticker(…, { fps: 30 })`; `drawGr` lazily over the caches; `setLive(liveOf)` runs a **regex per modded knob per call** and then `setMod` | fx-ui.js:2613–2622, :2563–2606, :3169–3182 | the cap is lifted while fast; per-knob parse cached; `setLive` per frame |
| **master-ui.** The OUT: `update(s)` folds `tp` into `acc0 / acc1` **at arrival**, `levels(T)` (`PK_HOLD` 50 ms, `TP_REL` 24 dB/s); the row: `update(s)` folds `pk` / `tp`, `run()` / `clockIf` | master-ui.js:455–463, :331–342, :55–60; :639–649, :602–633 | `heard(…)` folds at heard time; `setHeard(on)` stops the arrival fold (§5.5) |
| **The modulator bodies.** `slotBody` → `slotHost(kind, {get, live, edit, …})` (no `heardFrame` passed); `update(v)` → `H.live(v)`, which writes `snap.lfoPh[i]` … and `setSnapshot({s: snap})`; `MC_KINDS` = lfo / env / chaos; `modMount`'s options | cv-mods-ui.js:266–297; sx-host.js:4290–4375 (`live` :4360–4374); main.js:9659, :9584–9612 | `heardFrame` passed down; `H.live(v)` with `v.F` pushes into the host's ring (§4.4) |
| **The editors' playheads.** `animator` = `ticker(el, fn, { fps: Infinity })`; `drawOverlay` reads `o.playhead()` every clock frame (CurveEditor `evalPts` at the phase, EnvEditor stage / t, PathEditor [x, y]); providers sx-host.js:4027, sx-ui-mod.js:268 / :439 read the snap | graph.js:513, :1209, :1648, :2090–2097 | **unchanged**: they read the view, so the dots move every frame |
| **The presets.** `FPS_Q` beside `PERFS`; `perfPick` / `fpsPick`; `CLK.webkit` (iOS or Apple's vendor: Safari on the Mac too); `wk.reducedMotion` | cv-world.js:137 / :144; main.js:6401 / :6439, :978; wk.js:2974 | `FAST_Q` per preset, `FAST_WEBKIT` 60 (§5.2) |
| **The harness.** `HZ = { snap: 29, gr: 30, heavyMax: 60 }`; `EXPECT` per scene; `rateOf('heavy') = min(60, snap)` with its Cut B comment ("min(snap, E / floor(E / 60))") | tests/ui-bench-fps.mjs:46–48, :76–138, :141–156 | §7 G7 |
| **The node's monitor lifecycle.** `monitors.on` is (re)set in four places: a new node's first `{t:'mon'}`, the graph change, `masterSync`, and powerOn's rebuild of every node | main.js:1175–1176 (`makeNode` :1113), :803, :1513 (`masterSync` :1510), `powerOn` :1012 | `fastOn` follows `on` at each of them (§13 P1-2) |
| **The tempo gestures.** The drum TEMPO drag: `drumSetBpm(v, ph)` with `drBpmG` while `'move'`. The tempo box: `numIn('tBpm', …)` → `onchange` per step, a held spinner included. TAP: one change per tap. The deferred repost: `postMods`' timer closes over the record (`tr`). `applyRestore` replaces every track object (`project = p`) and reposts through `sendPatch → go() → postMods` | main.js:4290–4300; :4974–4975; :4306–4320; :488–491; :1933–1965 (`sendPatch` :702, `postMods` in `go()` :812) | the throttle only during a gesture; the timer re-resolves the record by id; `applyRestore` clears the pending timers (§1.1, §13 P2-2) |
| **The tempo gap.** The track payload carries **no `bpm`**: `buildMods` passes the compiled payload as is, and only the master's goes through `mPayOf` (bpm + `key@bpm`); ModCore's shim defaults to 120 (mod-core.js:139, :189); SxMod takes `m.bpm` from the shim per span (`begin`, sx-mod.js:1268) and steps the beat clock by `dtC · bpm / 60` (:1299); an anchored LFO re-locks to `songBeat()` per span. A Serum's own LFOs get the song tempo from `Inst.bpm` (engine.js:3166: the transport's while playing, else the patch's `p.bpm` = `project.bpm`, main.js:520). `setProjectBpm` → `queueAll()` → every `postMods` | main.js:450–465, :4282–4289, :825, :478–496 (`MODS_MIN_MS` :484); described in IMPL-MM.md:64, :579–582, :607–610, measured :640–644; HANDOVER.md:195–196 | **a page-side fix** (§1.1): every track's payload carries `bpm`, as the master's does. No engine change |

---------------------------------------------------------------------------------------------------------------------------------

## 1. Phase 0 — the lead (before the lanes branch)

### 1.1 The tempo fix (failing test first) [C]
**Cause** [R]: main.js `buildMods` (:450–456) posts `CG.compileMods(…)` with no `bpm` for tracks. ModCore then runs at its default 120.
Measured in IMPL-MM.md:640–644: at 140 BPM a 1/4 GLOBAL LFO's period is 0.4999 s with ANCHOR off while playing, and in any mode while
stopped. Anchored and playing it is 0.4285 s.

**The fix.** `mPayOf` (main.js:461–465) becomes **`bpmPay(pay)` for every record, tracks and `MREC` alike**:
- A `WeakMap` maps each compiled payload to `{ bpm, out }`.
- `out = Object.assign({}, pay, { bpm, key: pay.key + '@' + bpm })`, the master's format unchanged.
- The memo's object is never written, and `vals` stays shared, so `refreshVals` rides along as today.

`buildMods` returns `bpmPay(pay)` for any non-off payload. `modsFor` (the bounce's processorOptions, main.js:1123, :3646, :5317) and
`modsPay` follow, so **export = playback**. `cv-graph.compileMods` is **untouched**, so ref-WC's G1 hashes of `compileMods`
(tests/ref-WC/record.mjs:8–13 [R]) hold.

**The scope** (FR8, the user's QA). The payload's `bpm` becomes ModCore's `m.bpm` (mod-core.js:189–192 → sx-mod.js:1268 [R]), so one
fix covers every law FR8 lists: BPM rates, the in-span ramp, anchored Hz LFOs, BPM ENVs, the chaos snap and the rise / delay scale.

**The repost rate [C] (§13 P2-2).** Throttling applies **only during a tempo gesture**:
- **What counts as a gesture.** `tempoGest`, set by the drum TEMPO drag's `'move'` phases (`drumSetBpm`, main.js:4290) and while the tempo
  box's spinner is held (a pointerdown on `#tBpm` until the pointer is released).
- **During a gesture**, a tempo-only change (the key differs from the node's last only in its `@<bpm>` suffix) reposts **at most once per
  `MODS_MIN_MS`** per node (MASTER too: it posts through the same `postMods`, main.js:659 / :1500). The leading edge goes at once; the
  newest value follows on postMods' timer (`N.modsT`), timed from `N.modsTempoAt`, the last tempo-only post.
- **The gesture's end flushes at once** (`tempoFlush()`: every pending tempo timer posts now). **Every other change posts at once**: a
  typed tempo, TAP, an undo, a load, any edit.
- **The timer re-resolves its record by id** (`MREC`, or `project.tracks.find(x => x.id === id)`), so a track object replaced meanwhile still
  gets its post. `applyRestore` clears every pending `N.modsT`; its `sendPatch` reposts at once.

The reason: a drum TEMPO drag or a held spinner calls `setProjectBpm` every frame, and every cabled track would otherwise get a `setRows`
per frame (the 2b lesson, HANDOVER.md:242). The master's pin holds (canvas-MM-sim.test.mjs:174–178: one change, no gesture, posted at
once).

**Why not in the engine** (the alternative):
- The Track knows no tempo while stopped. Its stop message carries none (main.js:2095 [R]).
- A shim tempo derived from `tp.fpt` while playing (as `Inst.bpm`) differs from `project.bpm` by the float round trip of
  `60·sr/(fpt·960)`.
- Applied to MASTER it would move the 140 BPM pins of master-mods **G2 / G3** (tests/master-mods.test.mjs; corrected after review:
  ref-MM is a single live hash, tests/ref-MM/live-p1-mm.sha). Applied only to tracks it would break G2's MASTER ≡ Track bit-identity
  (:130–141 [R], whose Track already gets the payload's `bpm` by hand, :85).

Recorded in §12: a ModCore GLOBAL BPM LFO and a Serum's own MONO BPM LFO (N2) agree exactly while stopped. While playing at tempos ≠ 120
they agree to within one ulp of the tempo.

**Tests (new file `tests/tempo-mods.test.mjs`; each fails at c515abf):**
- **T1 (sim, `bootMain({ clock: 'std' })`).**
  - A Juno track with canvas LFOs cabled to its cutoff, at `project.bpm = 140`: the `{t:'mods'}` posted to its node has `bpm: 140` and a
    key ending `@140`.
  - `api.buildMods(t).bpm === 140`. A 120 project posts `bpm: 120` (the same sound as today).
  - `setProjectBpm(150)` (no gesture) reposts at once with `bpm: 150`.
  - A drum TEMPO drag (20 `'move'` steps, one frame each, the clock still) posts ≤ 2 times per node, and its `'end'` posts the final
    tempo at once. The same 20 steps without a gesture post 20 times.
  - The bounce's payload (`modsFor`) carries the same `bpm` (canvas-2b-sim.test.mjs:290's path). The master's payload format is unchanged.
- **T2 (engine, cv-graph-engine.test's Track build).** T1's posted payload fed to a real `Track`, 6 s, the period from the unwrapped LFO
  phase (`MC.livePh`, `'mods'` watched), ≤ 1 ms off:
  - BPM 1/4, ANCHOR off: stopped → 60 / 140 s; playing at 140 → the same.
  - BPM 1/4, ANCHOR on: stopped → 60 / 140 s; playing → unchanged from c515abf (0.4286 s).
  - **Hz 1.5, ANCHOR on, playing at 140 → 0.666 s** (1 / 1.5; reads 0.571 s at c515abf).
  - At c515abf the ANCHOR-off and stopped cases read 0.5 s: that is the failure.
- **T3 (continuity).** A 140 payload, 3 s, then the same payload at 150 (`setRows` mid-run, `MC.mon` on): the LFO phase does not jump at
  the repost (the step is ≤ one chunk's increment at the new rate), and the period afterwards is 0.4 s.
- **T4 (the bounce).** An offline Track built with T1's `modsFor` payload (`processorOptions.mods`, engine.js:3626) has
  `mc.shim.bpm === 140`, and its stopped and playing ANCHOR-off periods are T2's. Live and bounce run the same tempo, which is what
  export = playback needs.

### 1.2 The anchor ring `motion.js` [C]
Built here, then **owned by lane M-B** (the user's split: "M-B page ring"). The reason: M-B and H-B both consume it, so it is the one
shared page interface and has to exist before they branch. The API is §3. Tests: `tests/motion.test.mjs` (new). main.js imports it with
`?v=9` (reachable, so precached), and lane H-B uses the import.

### 1.3 The sweep
`node tools/precache.mjs --write`; every test file one at a time (2 GB each), before the lanes branch; then the lanes reset to the phase-0
commit. A pin the sweep shows moved by the tempo fix is fixed there and listed in §14 (none is expected; §9).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The worklet: the fast lane (lane E) [C]

### 2.1 Messages, page → worklet
`{ t: 'fastOn', hz, ids, ix, ixv }`:
- **`hz`**: 0 = off, else 1…`FAST_MAX` (= 120; clamped; non-finite → 0).
- **`ids`**: the parts to post fast for, a subset of the node's watched ids. On a Track these are Inst ids, chain ids, `'i0'` / `'c0'` on a
  legacy node, and `'mods'`. On MASTER: `'meters' | 'mfx' | 'mods'`. An id not watched (`mon`) posts nothing until it is.
- **`ix`**: `{ [instId]: Int16Array }` or null. Per Serum part, the `eff` indices (sorted, unique, ≤ 64, `0 ≤ i < NSV + MAXFX`) whose values
  ride its `v` after the fixed 70.
- **`ixv`**: an integer version of `ix`, echoed as `k` on the Serum messages, so the page maps `v` against the `ix` that produced it (no
  race with a message in flight).

`fastOn` allocates the per-part message objects and buffers (allocation at message time is allowed) and sets `fastHz`, `fastP = base / hz`
and `fastAcc = fastP` (the first post at the end of the next quantum). Track: a `case 'fastOn'` in `msg` (engine.js:3992–4033; today an unknown
`t` falls to `i0.msg` / `partMsg`). MASTER: in `msg` (:5160–5180). **Nothing else changes: no snapshot at `fastOn`** (unlike `watch`).

### 2.2 Messages, worklet → page (all `t: 'fast'`, `F = this.frames` at the post)
| part | message | contents |
|---|---|---|
| Serum Inst (legacy `i: 'i0'`) | `{ t, F, i, k, v, q?, gr? }` | `v` F32[70 + n]: `SXF` below, then `eff[ix[j]]`. `k` = `ixv`. `q` F64[16] = `sq.snapshot` only when the Inst has `sxSeq`. `gr` = its own rack's `grF` only when that rack has a GR unit |
| classic Inst with ModCore rows (`mc !== null && (moN > 0 ∥ moFN > 0)`, the slow rule engine.js:4980) | `{ t, F, i, e }` | `e` = `I.modEff()` |
| FX part: a panel, legacy `c: 'c0'` | `{ t, F, c, gr, mo }` | `gr` = `rack.grFast()` or null; `mo` = `mc.fxMon(c)` or null; **no post when both are null** |
| `'mods'` (Track and MASTER) | `{ t, F, mc, x }` | `mc` = `MC.live` F32[16]; `x` F32[28] = [`livePh` 20 \| `liveEnv` 8] (`MC.fastRead(x)`) |
| MASTER `'meters'` (`M !== null`) | `{ t, F, m }` | `m` F32[7] = [tpL, tpR, pkL, pkR (dB, the maxima since the previous fast post: `Meters.peek`), corr, momentary, short-term (LUFS)]; −Infinity = silence, NaN corr = "—", as `summary` |
| MASTER `'mfx'` | `{ t, F, c: 'mfx', gr, mo }` | as a panel |

A Serum's own FX (`'iN/fx'`) has no fast part of its own: the page never watches it for a Serum (main.js partsOf :3053–3054 [R]), and its
GR rides the Inst's message, as the slow lane does.

**`SXF`, the fixed layout** (identical constants in serum-dsp.js `FAST` and motion.js `SXF`; a test asserts equality):

| field | offset | n | ring kind (§3) |
|---|---|---|---|
| `mix` (dBFS: 7 Serum channels from `sx.pkF`, 4 engine taps from `I.mixPkF`) | 0 | 11 | PEAK |
| `wtPos` | 11 | 3 | LIN |
| `smpPos` (per osc: pos, start, loop start, loop end) | 14 | 12 | POS, HOLD, HOLD, HOLD |
| `noisePos` | 26 | 1 | PH |
| `notes` | 27 | 1 | HOLD |
| `lfoPh` | 28 | 10 | PH |
| `lfoOut` | 38 | 10 | LIN |
| `lfoY` | 48 | 10 | LIN |
| `env` | 58 | 4 | LIN |
| `envStage` | 62 | 4 | HOLD |
| `envT` | 66 | 4 | TIME (group: `envStage[j]`) |
| `eff[ix]` | 70 | n | LIN |

One message object per part, reused. `F` is written in place and every array is persistent: **no allocation per post**. **The array
fields are re-fetched at every post** (`rack.grFast()`, `mc.fxMon(c)`, `I.modEff()`, `MC.live`): a layout or rows change may replace
them between posts (§13 P3).

### 2.3 The gate (Track.process after :4737; MASTER after :5380)
- **`hz > 30`**: `if (watched && (fastAcc += n) >= fastP) { fastAcc -= fastP; postFast(); }`. `watched` is `this.mon` on a Track and
  `(mm ∥ mx ∥ mcMon)` on MASTER. At 48 kHz / 120 Hz this gives **4, 3, 3, 3, 3, 3, 3, 3 quanta** (mean 3.125, IMPL-FR §13 P3-1); at
  44.1 kHz mostly 3 with an occasional 2.
- **`0 < hz ≤ 30`**: one fast post **right after each slow post** in the same quantum (the same `F`).

`postFast()` iterates the fast parts in postMon's order (engine.js:4954–5008 / :5315–5323).

### 2.4 The reads (each additive, side-effect-free, allocation-free)
- **serum-dsp.js**
  - `SD.fastSnap(I, v, ix, n)` fills `v`. Positions and `notes` come from the recent voice and the voice list (the same expressions as
    `snapshot` :1990–2024, which is not edited). `mix[0…6]` come from **`sx.pkF`** (allocated at `attach`, folded beside `sx.pk` at
    :3587–3590 by `if (p > pkF[c]) pkF[c] = p`, reset by `fastSnap` alone). `mix[7…10]` come from `I.mixPkF`.
  - LFO / ENV come through `SxMod.fastRead(proc, sx, v, off)`, and `eff` at `ix` through `SxMod.effAt(proc, sx, ix, n, v, off)`.
  - The `FAST` constants are exported.
- **sx-mod.js.** `fastRead` / `effAt` are **an additive copy** of snap's lines :1458–1476. `snap` is untouched, and a test asserts equal
  values on 200 random states (per-voice / processor / FREE kinds, a Path LFO, no voice).
- **engine.js.**
  - `I.mixPkF` F64[4] (beside :1837; reset with `mixPk`'s at :1777). At :3455–3458 / :3474 each block max is computed once
    (`peak2(…, 0)`) and folded into both `mixPk` and `mixPkF`: max is exact, so the slow values are bit-identical. The fast post resets
    `mixPkF` only. The `mixHook` branch (:3453 / :3473: no `FXRack.mixPeaks` in fx-dsp.js today [R]) folds `mixPk` into `mixPkF` after the
    hook.
  - `postFast()`, the gate, `case 'fastOn'`.
  - `fastRead()` (tests, G5′'s truth): the same reads into a scratch, **PEAK fields skipped and no accumulator reset**, so it can run
    after every quantum without touching the posts.
- **mod-core.js.** `MC.fastRead(x)` copies `livePh` / `liveEnv` into `x` (valid while `MC.mon`, which `'mods'` being watched implies).
- **fx-dsp.js.** `rack.grFast()` returns `grF` F32[4 · (hi + 1)] (`hi` = the highest index of a kind-6 / 14 / 22 unit), filled by copy
  from `grOut`; or null when there is no GR unit. **`grF` is sized only at the layout change** (:2522, where the instance indices move); at
  the wipe / clear (:2834 / :2842) it is zeroed, never resized (§13 P2-8).
- **master-dsp.js.**
  - `Meters.peek(out)` writes [tF L/R, pF L/R as dB, corr, m, s] and resets `tF / pF` only.
  - In `push`, the per-block maxima start from 0 in locals and are folded into both the slow `tL / pL` and the fast `tF / pF` after the
    loop (:199 / :215 / :228 / :233). The result is exactly today's running max, with no extra per-sample work. `summary` is untouched.

### 2.5 FR1b and the shapes (`tests/fast-lane.test.mjs`, new)
**Scenes.** A legacy Serum (an LFO on cutoff, an own-FX compressor and a Ducker); a graphed Track (a Serum + a panel with a compressor + a
classic Inst with ModCore rows + `'mods'`); MASTER (meters + an `mfx` compressor + mods). Each runs 3 s, with the same `{t:'mon'}` and
the same inputs, once with and once without `{t:'fastOn', hz: 120, …}`.

**What the test asserts:**
- **The audio** is bit-identical.
- **The non-`fast`, non-`stats` messages** are equal in order (typed arrays compared by value).
- **Every fast field equals the slow one in a quantum where both post.** `v`'s LFO / ENV / positions / notes against `s`; `e` against `s.eff` at `ix`; `mc` /
  `x` against `mc` / `mcx`; `gr` against `gr[0…len)`; `m`'s corr / momentary / short against `mmon`'s.
- **The peaks partition (§13 P2-6).** At `hz: 30` (one fast post per slow one) every fast `mix` / `tp` / `pk` equals its slow twin
  exactly. At 120, a test hook records the per-quantum block maxima. Each fast post's peak = the max of its quanta's blocks, each slow
  post's = the max of its own, and over the whole run the max of the fast posts = the max of the slow posts. Nothing is stolen.
- **The cadence.** The 120 Hz pattern (the first post at the quantum after `fastOn`); `hz: 30` = exactly one fast post per slow post (the same `F`); `hz: 0` → none.
- **The shapes.** Keys, lengths, `F === this.frames`, `k === ixv`.
- **No allocation per post.** The message objects and arrays are `===` across posts on a recording port. `grF` is null without a GR unit.

Plus `SXF ≡ FAST`.

**G5′ (node, with phase 0's `motion.js`).** The Track's posts at 120 Hz feed a ring. The truth is the same reads called on the Track after
**every** quantum (the test's `T.fastRead()`, side-effect-free by FR1b; peak fields excluded). At every quantum end `F_q` over 4 s,
`ring.at(F_q)` is compared with the truth (§7).

### 2.6 The impulse scratch (IMPL-FR §14 M-A "for the lead" (1); §13 P1-3)
`filterImpulse(type, fc, res, drive, vr, fs, len, x, y, pz, scratch?)` (serum-dsp.js:1525) and `SxFilt2.impulse(…, scratch?)`
(sx-filt2.js:942) take an optional `scratch = { out }`: the 4096 output array, reused across calls. **The filter itself stays fresh per
call.** The skeptic found that `SFilter.reset()` (:1142) does not reproduce a fresh filter for types 91 / 93 [R], so no filter object is
reused. The response stays bit-identical to today's (a test: 40 random parameter sets × every classic type and the SxFilt2 types).
Callers without a scratch are unchanged. The cost is bounded by the curve's rate (§4.3), not by the scratch.

### 2.7 Cost rows (G8)
tests/bench-scenarios.mjs gains `fast-sx`, `fast-fx` and `fast-master`, each with its base twin (fast off). They are measured as **paired,
interleaved medians** (on / off alternating, ≥ 9 pairs) **with an A/A pair** (off / off) for the noise. The gate is Δ ≤ max(0.002,
2 × the A/A spread) (§13 P3). tests/bench.json records the rows (node, ipad est.) and the jsc shell.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The ring — `motion.js` (phase 0 builds; lane M-B owns) — API fixed here [C]
```
export const K = { LIN: 0, PH: 1, HOLD: 2, PEAK: 3, TIME: 4, POS: 5 }
export const RING_N = 64, EXTRA_S = 0.25, EXTRA_N = 2, STALE_S = 0.5, PH_STEP = 0.25
export const ST = { NONE: 0, BEFORE: 1, EXACT: 2, BRACKET: 3, EXTRA: 4, HELD: 5 }
export const SXF = { mix: 0, wtPos: 11, smpPos: 14, noisePos: 26, notes: 27, lfoPh: 28, lfoOut: 38, lfoY: 48, env: 58, envStage: 62, envT: 66, N: 70 }
export const SXF_K, SXF_G, SXF_LO, SXF_HI     the fixed 70's kinds, TIME groups and ranges (§2.2's table; every LIN / POS field 0…1)
export const SLOT_K = { lfo: [LIN, PH, LIN, LIN] (v, ph, y, out), env: [LIN, HOLD, TIME→1] (v, stage, t), chaos: [LIN] (v) } (+ SLOT_G)
export const MASTER_K = [PEAK × 4, LIN × 3]
export function grKinds(units, out?)    units [{ idx, type }] → Uint8Array(4·(hi + 1)): LIN, POS at 4·idx + 1 for type 'duck'
export function ring(w, kinds, o?)      → R. o: { n = RING_N, groups?: Int16Array(w) (a TIME field's HOLD key index, −1 none),
                                          lo?, hi?: Float64Array(w) (the LIN / POS extrapolation clamp; default ∓Infinity) }
R.push(F, src, off = 0)                 copies w values from src[off…]; F < newest → flush first (a new F axis: a power cycle, a rate
                                          change); F == newest → replace; non-finite F ignored
R.at(Fh, out, sr) → ST                  out untouched on NONE / BEFORE
R.newest() / R.oldest() / R.size / R.age(Fh, sr) (s; negative while anchors lead) / R.live(Fh, sr) (size > 0 && age < STALE_S) / R.flush()
```
**Two rings per Serum part** (§13 P2-9 d): the fixed 70 (`SXF_K`) in one ring that an `ix` change never flushes, and the requested `eff`
values in their own (LIN, 0…1), rebuilt when the count changes.
**The read at `Fh`.** With `F0 ≤ Fh < F1` the bracketing anchors (BRACKET), `Fh == F` (EXACT), and α = (Fh − F0) / (F1 − F0):
- **LIN**: linear.
- **PH**: shortest-path unwrap (d − round(d)), wrapped to [0, 1). **When |d| > 0.25 it holds** the anchor at F0: an ambiguous step,
  either an LFO faster than a quarter of the data rate (30 Hz at 120 Hz data) or a retrigger's jump. That shows a step at the next anchor
  instead of a sweep the wrong way.
- **HOLD**: the anchor at F0.
- **TIME** (§13 P2-9 a): linear only when its group key is equal at F0 and F1 **and t1 ≥ t0**; else HOLD.
- **POS** (§13 P2-9 a): linear only when **0 ≤ p0 ≤ p1**; else HOLD (the Ducker's −1, a dip restarting, a sample loop's wrap back).
  `smpPos`' position is a POS field.
- **PEAK**: the max over the anchors with `F ∈ (lastFh, Fh]`, each consumed once (cv-drum's `deliver` rule). None → the previous result.
  Reading the same `Fh` twice returns the same.

**Past the newest (EXTRA, `Fh − F_newest ≤ EXTRA_S·sr`)** (§13 P2-9 b, c).
- **LIN / POS**: the last pair's slope, for at most `EXTRA_N` = 2 of the last pair's intervals, clamped to the field's `[lo, hi]`; then the
  newest value. POS extrapolates only when its last pair interpolates (0 ≤ p0 ≤ p1).
- **PH**: the last pair's slope while that pair's |d| ≤ `PH_STEP` (the data rate decides, not the display rate); else the newest.
- **TIME**: t1 + (Fh − F1) / sr (the stage runs on).
- **HOLD / PEAK**: the newest.

Beyond `EXTRA_S`: HELD (every field the newest). Before the oldest anchor: BEFORE, and the caller keeps the slow values (the fast lane
starting). **Every consumer guards its reads with `R.live(Fh, sr)`** (§13 P3): a stale ring never overrides the slow values.

Storage is F64[n·w] + F64[n]; `at()` writes into the caller's `out`. **No allocation after construction** (a test counts it). Tests
(`tests/motion.test.mjs`) cover:
- every kind, the wrap, the PH step rule (bracketed and extrapolated), the groups, POS / TIME going backwards;
- PEAK draining and repeated reads;
- extrapolation and both of its bounds, and the clamp;
- flush on a backward F, replace on an equal F, stale / live;
- a 1e8-frame axis, `grKinds`, and the `SXF` table.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The Serum host, the slot hosts, the kit (lane M-B) [C]

### 4.1 The view (sx-host.js)
- **The objects.** `this.msg` holds the slow message, `this.raw` its `s`, and `this.snap` **the view**: a persistent object holding exactly
  the fields the slow messages carried (arrays copied into the view's own arrays, scalars assigned). Partial snapshots stay partial:
  serum-ui.test.mjs:1343 / :1391 and sx-host.test.mjs:601 / :667 [R] send them.
- **`setSnapshot(msg)`** does today's work plus the copy, then marks the memo stale (`vF = NaN`). **While the fast data is live it does
  not schedule its own paint**; it sets **`slowDue`**, and the tick runs the slow work on its next frame (§4.3, §13 P1-1). Otherwise it
  paints as today, so without the fast lane everything behaves exactly as at c515abf.
- **`setFast(d, ix)`** (`ix` = the union `Int16Array` for `d.k`, resolved by main.js):
  - `v[0…70)` goes into `this.fr` (the fixed ring, never flushed by an `ix` change); `v[70…)` into `this.fe` (w = ix.length; rebuilt
    and flushed when the count changes) (§13 P2-9 d). The arrays are read from each message (a structured clone: new every post);
  - `q` goes into a HOLD ring (16);
  - `gr` goes into a gr ring (kinds from `grKinds(fxLayout units)`);
  - the tick client is added (§4.3).
- **`viewNow()`.** `Fh = host.heardFrame()`. If `Fh === vF` it returns at once (one read per frame, whoever reads first: the editors'
  clock clients and the host's tick see the same values, whatever their order). Otherwise, **while `R.live(Fh, sr)`**, it reads the rings
  at `Fh` and, on EXACT / BRACKET / EXTRA / HELD, writes the `SXF` fields, `eff[ix[j]]`, `seq` and `grV` into the view. BEFORE or NONE, or
  a stale ring (no post for `STALE_S`), leaves the slow values in place: a fast lane that stopped never freezes the view.
- **`fastReset()`** flushes the host's rings (main.js calls it when its part's `hz` goes to 0, and at a power cycle).
- **The readers.**
  - `kit.snap()` → `ui.viewNow()`.
  - The internal visual readers :2059, :2476, :2486, :2500, :4027, :4161 read `viewNow()`.
  - **The functional readers read `this.raw`** (FR7): `checkCapture` :2532 / :2535.
- **New kit members.** `kit.msg()` → `ui.raw`. `kit.snapSeq()` is unchanged (it counts slow messages).

### 4.2 The requested indices (`ix`)
`fastIx()` → `Int16Array` (§13 P2-3), memoised (the same array while unchanged):
- **the modded controls**: the `modEls` whose `arcs.length > 0` after a `paintMods(full)` (a control with halo arcs; `scanMods` alone
  lists every control with a row, not only the moving ones);
- **plus the heavy displays' live ids**: each heavy canvas declares `liveIds()`. The wavetable display: its oscillator's WT POS; the filter
  display: cutoff, res, drive, var, x, y; the spectral filter: its `liveN` ids.

All of it over the shown pages and the popover, ≤ 64, sorted, unique; beyond 64 the rest stay slow (recorded). After a full paint
changes it, the host calls `host.fastIx()`, and main.js re-syncs on a microtask.

### 4.3 The tick, `kit.frame`, `setLive`
- **The tick client.** `wk.clock.add({ name: 'sx-fast', live, fn })`. It is added on the first fast push and removed once the rings are
  stale (`R.live` false: no post for 0.5 s) or at `destroy` (:4180). `live` = not dead, the rings live, and a view of this host shown
  (off-screen hosts are not live: Part II P2-6).
- **`fn(ts)`, each painted frame.** `viewNow()`, then `paintMods(false)` (the dots through `setLive`), `paintCanvases(ts)` (the keys move,
  and the rate class bounds the heavy ones), then the shown pages' `kit.frame` callbacks. **When `slowDue`** (a slow message came since
  the last frame): `updateVoices()` (the voice count, the meter, every page's `kit.live`, so the CLIP recorder runs) and `checkCapture()`
  run once, then `slowDue = false` (§13 P1-1). `shownPages()` is memoised per view change (no array per frame).
- **The filter display (the user, QB; §13 P1-3).** Its **curve** redraws at most **60 / s on High, 30 / s on Medium / Low**:
  - `canvas(…, { capHz })`, a ceiling: k = ceil(E / capHz), unlike the heavy class's `floor`. `capHz` is a function read each period:
    `K.host.curveHz()` (main.js: 60 on High, 30 on Medium / Low).
  - Its **cutoff marker** is drawn **every frame** on an overlay canvas at `liveN(cutoff)` from the view.
  - The wavetable and spectral displays keep the 60 class (60–119 / s).
- **`kit.frame(fn)`**: `fn(shown)` on every painted frame of the tick, and on every slow paint while fast is not live, so a page needs no
  second path.
  - **Moved onto it:** the MIX meters' `meterFrame` (sx-ui-mix.js:271 / :588; registered with `(K.frame ∥ K.live)`, so stub kits in
    tests/sx-ui-mix.test.mjs:198–204 hold), the XY dot and the filter handles (sx-ui-osc.js:2381 / :2556), and the ARP pattern editor's
    playhead (sx-ui-seq.js:1013–1017, from the view's `seq` at `Fh`).
  - **Left on `kit.live`:** the unison warning (:2804) and the CLIP page (recorder + head).
- **`paintMods(full)`.** `setMod` for arcs only when `full`, or when the arcs changed. The live value goes through `el.wk.setLive(v)` when
  the widget has it, else through `setMod` as today.

### 4.4 The slot hosts (canvas and master modulator bodies)
- **`slotHost(dev, o)`** reads `o.heardFrame`; cv-mods-ui.js `slotBody` forwards `O.heardFrame` (cv-mods-ui.js:281–283).
- **`H.live(v)` with a finite `v.F`** pushes into the host's ring (w by kind, `SLOT_K`) and paints nothing; the host's tick (§4.3) reads at
  `Fh` into `snap.lfoPh[i] / lfoOut / lfoY` or `envStage / envT / env` and paints. Without `F` it takes today's path (:4360–4374).
- **MM5 holds:** the master's bodies take the same path.

### 4.5 wk.js `setLive(n)`
On the knob, the ring toggle and every modBar widget (wk.js :357 / :828 / :610 / :949 / :1148 / :1205's widgets): the live marker
alone, with `liveOf`'s 0.002 rule. No arc work, no array, no string beyond `attr`'s two numbers. `setMod({live})` keeps working (the
documented API, wk.js:25–27).

### 4.6 Other files
- **serum-ui.js:402** `gr: () => this.grNow()` (the view's `grV` while live, else `smon.gr`); `tap` unchanged. The FX page's host
  adapter also gains **`fast: () => this.fastLive()`**, so its rack's GR loop lifts the 30 cap like a canvas rack's (§5.4; §13 P3).
- **sx-ui-seq.js** `headSee` (:1849) and `seeSnap` (:1941) read `K.msg()` (FR7: Cut A's post-anchored CLIP head and the recorder unchanged).
- **sx-ui-osc.js:3245–3258** passes a per-display `{ out }` scratch to `filterImpulse` / `SxFilt2.impulse` (extra arguments are ignored
  before E's merge). Its filter display takes `capHz` and the overlay marker (§4.3).
- **M-B tests** add: with fast live, a CLIP recording still records and a phase capture still fires (P1-1); `fastIx` from the arcs and
  the heavy ids (P2-3); an `ix` change keeps the fixed ring's anchors (P2-9 d); the filter curve at ≤ 60 / ≤ 30 a second with the marker
  every frame (P1-3).

---------------------------------------------------------------------------------------------------------------------------------

## 5. The consumers (lane H-B) [C]

### 5.1 Monitors and routing (main.js)
- **`monitors.sub(trackId, dev, o)`** gains `o.fast` (bool), `o.onFast(d, ix?)` and `o.ix()` (→ Int16Array | null).
- **`sync()`.** After the `mon` post, per node:
  - `parts` = the union of the live fast subs' `cur` (+ `'mods'` for a `mods` sub) ∩ the wanted ids;
  - `hz = parts.length ? fastHz() : 0`;
  - `ix` = per Serum part, the union of its subs' `o.ix()`;
  - `ixv` increments when `ix` changes;
  - the key `hz | parts | ix` lives in **a separate `monitors.fastOn` map** (`on` keeps its format: Part II P2-3). When the key changes it
    posts `{t:'fastOn', hz, ids: parts, ix, ixv}`, including one `hz: 0` after a non-zero.
  - It keeps the last two `ix` per part by `ixv` for `ixOf(id, part, k)`.
  - MASTER does the same over its devs.
- **`deliverFast(id, d)`**: part = `d.i ?? d.c ?? (d.mc ? 'mods' : d.m ? 'meters' : null)`, matched as `deliver` does (MASTER by dev). The
  callback is `S.onFast(d, ixOf(…, d.k))`.
- **The handlers.** `else if (d.t === 'fast') monitors.deliverFast(id, d)` (main.js:1158; MASTER :1442–1443).
- **Re-sync triggers:** a preset pick (`perfPick` :6401), a reduced-motion change, a host's `fastIx`, visibility (already).
- **`fastOn` follows `on` everywhere (§13 P1-2).**
  - A new node's first `{t:'mon'}` (main.js:1175–1176) is followed by its `{t:'fastOn'}` (a node starts with fast off).
  - The graph change (:803) and `masterSync` (:1513) delete the node's `fastOn` entry with its `on` entry.
  - powerOn's new nodes start empty.
  - `fastReset()` clears `monitors.fastOn` along with the rings.
  - A sim test checks that fast is live again after powerOff → powerOn and after a model change (a new node, the graph change).

### 5.2 The rate
- **cv-world.js** (beside `FPS_Q` :144): `FAST_Q = { high: 120, medium: 60, low: 30 }`, `FAST_MAX = 120`, `FAST_WEBKIT = 60`, all frozen.
  **(Review 2, the lead's P2-3: `FAST_WEBKIT = 0` — the lane off in WebKit until the device harness measures it; §6, §12, §14.)**
- **main.js** `fastHz() = min(FAST_Q[perf], CLK.webkit ? FAST_WEBKIT : FAST_MAX)`, and `min(·, 30)` under reduced motion. It is
  independent of the display rate: no re-sync flapping with macOS's idle 120 → 60 → 30 (IMPL-FR §14 G9).
- **A Frame rate pick posts nothing.** `__synthTest.fr.force(hz | null)` overrides the rate (the harness's on / off).
- **`curveHz()`** on `sxHost` (main.js:3825): 60 on High, 30 on Medium / Low (the filter curve's cap, the user's QB; §4.3).

### 5.3 The rings and the per-frame client (main.js)
| consumer | sub (where [R]) | ring | per frame (`fastTick`) |
|---|---|---|---|
| Serum / Wavecraft host | sxMonitor :3109–3118 (`fast`, `onFast: (d, ix) => { r.ui.setFast(d, ix); sxInjFast(id, dev, d); }`, `ix: () => r.ui.fastIx()`); `sxHost` (main.js:3825; its `heardFrame` :3883) gains `fastIx: () => monitors.sync()` (a microtask) and `curveHz()` | the host's (§4) | the host's own tick |
| **injected canvas ENV bodies** (a canvas ENV living in a Serum's free ENV slot, `sxInjEnv` / `sxInjSnap` main.js:9712–9720; §13 P2-5) | the same `onFast` (`sxInjFast`) | the slot hosts' | each body `B.update({ v: d.v[58 + k], stage: d.v[62 + k], t: d.v[66 + k], F: d.F })` (k = its slot); `sxInjSnap` from the slow `s` only while that body's ring is not live |
| modulator bodies | mcMonitor :9666–9673 (`fast`, `onFast: d => mcFast(tid, d)`) | the slot hosts' | `mcFast` = mcSnap's mapping (:9677–9690) plus `F` on each update: `{v, ph: x[i], y: x[10 + i], out: v, F}`; `{v, stage: x[20 + j], t: x[24 + j], F}`; `{v, F}`. modMount (:9584–9612) adds `o.heardFrame = () => heardFrame()` |
| FX racks (tracks, master) | rec subs :4039 / :7159 (`fast`, `onFast: (d, ix) => fxFast(rec, d, ix)`; **a Serum's own FX rec also gives `ix()`**: its modded knobs' FX-context eff indices `core.NSV + 8 + flat`, §13 P2-4) | `rec.grR` (`grKinds` per layout key), `rec.moR` (LIN); for an own-FX rec, `rec.effR` (LIN) over its indices' positions in the union `ix` | `rec.grV` at `Fh` (`fxHost` :3897 and `mfxHost` :7131 return it from `gr()` (:3910 / :7136) while live, and gain `fast()` for fx-ui); the dots: `fxLive(tid, key, rec, …)` from `moView` (a panel) or from the own-FX values read from `v[70 + j]` (j = the index's position in the union `ix` of `d.k`) |
| classic panels | cpMonitor :10329–10334 (`fast`, `onFast: d => cpFast(tid, dev, d)`) | per panel (LIN) | `cpSnap(tid, dev, view)` (:10340): the inverse transfer of the read value, then `P.setLive` (dots only, classic-panel.js:412). **The per-row transfers are resolved once per (payload key, values version)**, not by a string `sig` built per call (§13 P3) |
| master OUT / row | :7108 / :7258 (`fast`, `onFast: mFast`) | one (`MASTER_K`) | drained: `mout.heard(tpL, tpR)`, `mrow.heard(pkL, pkR, max(tpL, tpR))`; `setHeard(true)` while live |

`fastTick` is a `wkClock.add({ name: 'fastTick', live: fastAny, fn })` registered after frameTick (main.js:10780). It is not
essential: reduced motion runs it at 10 fps. `fastReset()` flushes every ring and clears `monitors.fastOn` at powerOff (:1083) / powerOn
(:1012), and `push`'s backward rule covers a context the page did not see restart.

**While a consumer's ring is live, its slow deliver only updates the fallback values** (§13 P2-4). It paints nothing and calls no
`setLive(null)`: today a slow message without `mo` / `eff` blanks the dots (`fxLive` :10290–10304), and that must not fight the per-frame
values. When the ring goes stale, the slow path takes over again.

**Fh within a clock frame (§13 P2-10).** `frameEvery(t)` (main.js:5901) records the frame's rAF timestamp, and `heardFrame()` returns
`outFrame(frameTs)` for that frame: the view is computed for the frame's display time, not for whenever a client happens to run. Between
frames it behaves as today (≤ 20 ms). Cut A's pins that read `heardFrame` are re-checked (canvas-2a-sim, canvas-R-sim's `frameNow()`,
canvas-7a / 9b-sim's lamp pumps, fps-determinism); one that moves is listed in §14.

**Hooks:** `__synthTest.fr = { force, hz, rings, trace(n) }`. `trace` records the next n painted frames' `{ t, Fh, newest, status,
probe }`, where the probe is the first live Serum host's `lfoPh[0]` and its overlay's drawn x.

### 5.4 fx-ui.js
- **`grLoop`**: `ticker(this.rack, …, { fps: host.fast && host.fast() ? Infinity : 30 })`, re-armed on `refresh` when that flips. With fast
  off, the fx-ui:1301 / :1973 pins hold.
- **`setLive(liveOf)`**: the `fx.<id>.<param>` split cached per knob, `w.setLive(v)` when present.

### 5.5 master-ui.js
- **`heard(tp0, tp1)` on the OUT** and **`heard(pk0, pk1, tp)` on the row** fold into `acc0 / acc1` (`accTp`) with the existing
  `a ≥ v → hold` rule.
- **`setHeard(on)`**: while on, `update(s)` takes the text values (m, s, i, lra, tpMax, corr) but **does not fold the bar peaks** (FR4:
  bars rise when heard). Off is exactly today.

### 5.6 The harness (tests/ui-bench-fps.mjs, + .test.mjs, tests/ui-bench.html)
- **`rateOf(cls, eff, o)` with `o.fast`.**
  - `'snap'` and `'gr'` → `eff` (the view moves every frame);
  - `'heavy'` → `min(o.snap ?? eff, eff / max(1, floor(eff / HZ.heavyMax)))`, per its comment (:151–153);
  - with `o.fast` false, as today.
- **`EXPECT`**. The entries keep their classes (`rateOf` maps them under `o.fast`), with these changes:
  - the filter display's curve: `'snap'` → a new class **`'curve'`**, `min(eff, 60)` on High and `min(eff, 30)` at Medium / Low,
    judged from above too. Its **cutoff marker overlay** is a new entry, `'snap'` (every frame under fast);
  - the LFO-driven knob dots and the master OUT meters (change-gated writers) get `tol: 0.5` / `0.4`;
  - the GR bars keep `'gr'` and their `tol`.
- **The cells.** A `--fast on|off` flag (default on), passing `__synthTest.fr.force`. **The smooth probe** hooks `arc` on
  `.gx-lfo canvas.gx-ov` (tutorial: LFO 1's overlay) and records x per painted frame.
- **`--load`** (G8): 10 cycles of [5 s fast on, 5 s off] and A/A [5 s off, 5 s off], interleaved, reading every node's `stats.load`.
- **`--serve --port N`**: COOP / COEP, `POST /result` (≤ 1 MB) → `--out`. `ui-bench.html?fps=1&load=1&post=1` runs the load protocol on a
  device or the simulator and posts the result there.

---------------------------------------------------------------------------------------------------------------------------------

## 6. The iPad / WebKit
- **(Review 2, the lead's P2-3: shipped OFF in WebKit — `FAST_WEBKIT = 0`, Cut A's behaviour on the iPad and in Safari — because G8i
  could not run; the device harness now runs in the app's own top-level page, so it can measure WebKit later. The rest of this section
  is the plan for when it does: §12, §14.)**
- **The data is capped at 60 Hz in WebKit** (`CLK.webkit`: the iPad in every browser, Safari on the Mac). The interpolation reads at the
  display's rate (60 on the iPad today, IMPL-FR §8), and WebKit's `outDelay` (≥ the ring + `outputLatency`) leaves the bracketing anchors
  present at 60 Hz.
- **Measured before it ships there** (G8i): in the **iOS Simulator's Safari** (the "SYNTH iPad Pro 13" simulator, `localhost`), the same
  WebKit AudioWorklet, message clone and 1 ms timers. Its CPU numbers are the Mac's, recorded as such. The iPad pass (one, after the
  features) re-measures.
- **The iPad app is not rebuilt** (browser first); its node tests run in the sweep. 120 Hz data in WebKit is measured, never promised
  (IMPL-FR Q3's app spike stays later).

---------------------------------------------------------------------------------------------------------------------------------

## 7. Gates

| gate | what | target |
|---|---|---|
| **G1 sound** | every golden (classic / fx / presets / random / graph / 606 / 909 / drums / moog ×3 / sdsv), master-proc, engine-track, canonical-stream, canvas-M-bounce, canvas-SC-sim, ref-M / MM / SC / WC / P / 7a–7d / 9 / 9b / 9c, run in the sweep; lane E's DSP diff additive only (the lead reads it); FR1: no `{t:'fastOn'}` posted while no display asks (canvas-FR-sim) | exact |
| **G-T the tempo** (phase 0) | §1.1 T1–T4 | exact |
| **FR1b** (lane E) | §2.5 | exact |
| **G5′ the ring ≡ the worklet at `Fh`** (lane E in node with `motion.js`; reviewer 2 in Chrome through `trace`) | at every quantum end over 4 s (an LFO at 0.5 / 2 / 8 Hz on cutoff, an ENV through its stages, a Ducker keyed at 128 BPM, a compressor, a 1/4 BPM canvas LFO, the master's meters). **HOLD** = the truth at the newest anchor ≤ `F_q`, exactly. **LIN / PH / TIME / POS fields linear in F between anchors** (LFO phase at a constant rate, ENV time, the Ducker's position) within **1e-6**. **Curved fields** (`lfoOut`, `eff`, `mo`, `e` under a sine LFO) within the chord bound computed from the truth itself, `max |Δ²| · (k²/8)` over the bracket (k = the anchor spacing in quanta), **truth-based, never a hand-set tolerance** (§13 P2-7), and that bound must come out **≤ 2e-3 normalised for LFOs ≤ 2 Hz** at 120 Hz anchors. **PEAK** (the master's `m`): the max over the anchors drained by `F_q` = the max over the same frames of a reference `MASTERDSP.Meters` fed what MASTER's own meters measure and `peek`ed every quantum; the Serum `mix` peaks are covered by FR1b's partition. **Discontinuities** (a retrigger, an S&H step, a stage change, a seek) affect ≤ one anchor interval each (counted, reported). **EXTRA** measured at 10 / 50 / 250 ms past the newest (recorded) | exact / bounded |
| **G6 lag ≤ 1 frame** | sims (H-B: canvas-FR-sim with `clock: 'std'` and a scripted heard frame; M-B: sx-host with a stub `heardFrame`): a GR step, an LFO retrigger, an ENV stage change, a peak posted at `F` show on the first frame with `Fh ≥ F` (one frame of slack allowed); a frame's view is always computed from that frame's `Fh`. Chrome (reviewer 2, `trace`): the drawn probe = `ring.at(Fh)` of the same frame on ≥ 99 % of painted frames. **Recorded before / after**: today's dot leads the heard audio by `outDelay` and steps at 29 Hz | ≤ 1 frame |
| **G7 frame cost and liveness** (reviewer 2: tests/ui-bench-fps.mjs, Chrome for Testing, downloads denied; sizes d / l / p; CPU 1 / 4 / 6 ×; caps 60 / 120 / 240 + the cross cells) | the scenes `tutorial / serum / master / busy / clip` with `--fast on` and `--fast off` (the A/B), `EXPECT` and `rateOf` per §5.6. **The smooth probe at 120 and 240, 1×**: the LFO overlay's x differs from the previous frame on ≥ 0.9 × `eff` frames, and the coefficient of variation of `|Δx|` (wrap frames excluded) ≤ 0.3. At c515abf it reads ≈ 29 / `eff`: that is "240 visibly smoother than 120". Frame cost (every rAF callback + the handlers): med ≤ 2 / p95 ≤ 4 ms at 1 × every cap, ≤ 8 at 4 × / 60, ≤ 12 at 6 × / 60; idle layout + style < 1 ms / s; **retained** heap growth (after GC) ≤ 1 MB / s; the allocation rate recorded, not gated (the fast messages' clones and the filter curve's fresh filter included; §13 P1-3); the filter curve at ≤ 60 / s (High) and ≤ 30 / s (Medium / Low), its marker every frame; no console error; recorded as bench.json **`ui-fps-mac-b`** (the `ui-fps-mac` row kept) | within |
| **G8 cost** | node / jsc rows (§2.7): paired interleaved medians with an A/A, Δ ≤ max(0.002, 2 × the A/A spread). Chrome, the real worklet (reviewer 1, `--load`, `tutorial` + `master`): Δ load (on − off) ≤ **max(0.005, 2 × the A/A spread)** | within |
| **G8i the iOS simulator (WebKit, the cap of 60)** (reviewer 1; review 2: the lane ships off in WebKit — run with `&fast=60`, the protocol now in the app's own page, §14) | `xcrun simctl openurl` on the booted "SYNTH iPad Pro 13" → `http://localhost:<port>/tests/ui-bench.html?fps=1&load=1&post=1` (the harness's `--serve`), Run tapped with the iOS Simulator control tool. Checks: `fastOn` posts `hz: 60`; the fast messages per part per second are 60 ± 3; Δ load ≤ max(0.005, 2 × the A/A spread); the view moves on every painted frame (`trace`); no console error. Recorded with the Mac's CPU named. **The iOS Simulator control tool asks the user's permission at its first use of a device**: the reviewer asks the lead (who asks the user) before G8i (§13 P3) | within / recorded |
| **G9′ the real 120 Hz panel** (reviewer 2, the lid open, headed Chrome for Testing on the built-in display) | the LFO dot's x changes on ≥ 0.9 × 120 frames / s; a knob dot under an LFO moves every frame; Medium → data 60 and the dots still every frame. 240 Hz hardware is untested (the virtual display is the proof) | pass / recorded |
| **G10 UI parity** | static scenes (nothing moving) byte-identical to c515abf's (tests/ui-layout-fx.mjs + a Wavecraft at rest + the master canvas at rest) | pass |
| **G11 the sweep** | every test file, one at a time, after phase 0 and again at integration | green |

---------------------------------------------------------------------------------------------------------------------------------

## 8. Lanes, order, rules

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **phase 0** (the lead) | main.js's `buildMods` / `bpmPay` / `postMods` (the gesture throttle, the timer by id) and their comments (:450–496), the gesture flag at `drumSetBpm` (:4290–4300) and `#tBpm`'s pointer (:4974–4975), `applyRestore`'s timer clear (:1933), the `drumSetBpm` / `tempoGest` test hooks, the `motion.js` import line; **motion.js** (new); tests/tempo-mods.test.mjs, tests/motion.test.mjs (new); the phase-0 gates; `precache --write` | G-T, the ring's tests | the lead (Opus 5.5) |
| **E** the engine fast lane | engine.js, serum-dsp.js, sx-mod.js, mod-core.js, fx-dsp.js, master-dsp.js, sx-filt2.js (§2: additive only); tests/fast-lane.test.mjs (new), tests/bench-scenarios.mjs, tests/bench.json (rows + targets), tests/modcore.test.mjs, tests/sx-mod.test.mjs, tests/master-dsp.test.mjs (+ the additive reads) | FR1, FR1b, G5′ (node), §2.6, G8 (node / jsc) | **Opus 5.5** (the lead, 2026-11-01: no Fable anywhere in Cut B) |
| **M-B** the page ring and the Serum host | motion.js (after phase 0), sx-host.js, serum-ui.js, wk.js (`setLive` only), sx-ui-mix.js, sx-ui-osc.js, sx-ui-seq.js, sx-ui-mod.js (if needed), cv-mods-ui.js (forward `heardFrame`); tests/motion.test.mjs, tests/sx-host.test.mjs, tests/serum-ui.test.mjs (its safe assert wrapper), tests/wk.test.mjs, tests/sx-ui-mix / -osc / -seq / -mod.test.mjs, tests/cv-mods-ui.test.mjs | §4, G6 (host), FR7 | **Opus 5.5** |
| **H-B** the consumers | main.js (everything §5 names; not phase 0's lines), fx-ui.js, master-ui.js, cv-world.js (the `FAST_*` constants only); tests/canvas-FR-sim.test.mjs (new), tests/master-ui.test.mjs, tests/fx-ui.test.mjs, tests/canvas-P-sim.test.mjs, tests/cv-world.test.mjs, tests/ui-bench-fps.mjs, tests/ui-bench-fps.test.mjs, tests/ui-bench.html | §5, G6 (sims), the harness for G7 / G8 / G8i | **Opus 5.5** |
| reviewers × 2 | (1) **the real engine**: FR1b re-derived, G5′ in node, G8 (node / jsc + Chrome `--load`), **G8i** in the simulator, the sweep; (2) **Chrome for Testing**: G5′ / G6 by `trace`, G7 full matrix on / off, **G9′** on the built-in 120 Hz panel, G10, the iPad sizes, a power cycle / hidden tab / preset switch mid-animation | — | Opus 5.5 × 2 |
| fixers | the finding's files, failing test first | | Sonnet 5.5 (one file) / Opus 5.5 (across files) |

**Interfaces between the lanes** (fixed by §2, §3, §4.1–§4.5 and §5.1). E ↔ H-B: the message shapes. H-B ↔ M-B: `ui.setFast(d, ix)`,
`ui.fastIx()`, `ui.fastReset()`, `ui.fastLive()`, `host.fastIx()`, `host.curveHz()`, `host.heardFrame()` (exists; frame-stamped by H-B,
§5.3), `o.heardFrame` (slot hosts), `B.update({…, F})` (the slot bodies), `el.wk.setLive(n)`, `host.fast()` (fx-ui, the serum-ui adapter
included).
**Each lane tests against fakes of the others' side**: E with a recording port; M-B with a stub host and synthetic `fast` messages; H-B
by injecting `{t:'fast'}` into the sim nodes' ports.

**Order.** Phase 0 → E, M-B, H-B in parallel (worktrees reset to the phase-0 commit; `git log -1` checked) → integration by the lead (a
Chrome smoke with the real engine: the tutorial scene's dots move every frame, no console error) → reviews → fixers → the sweep →
`precache --write` → deploy (`tools/deploy-canvas.sh`) → ROADMAP row 23 / 22 (the tempo gap closed) / HANDOVER items 22–23 → the user tries
it.

**Rules** (IMPL-FR §10.2 plus these):
- **DSP files.** Only lane E touches them, additively: no sample changes, and every golden stays bit-identical (a lane that needs a
  sample change stops and says so).
- **No silent poll.** `{t:'fastOn'}` is never posted while no display asks.
- **Commits.** No lane commits `sw.js`.
- **Browsers.** Browser gates use Chrome for Testing only, with downloads denied. The simulator is driven only with the iOS Simulator tools
  / `simctl` (no app build).
- **Per-frame paths** allocate nothing per frame beyond what G7's heap gate allows; reviewers grep the new per-frame code for `new `,
  `[...`, `.map(`, `.filter(`, `split(`, regex literals and string keys.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Pins that change by design (and the ones that must not)

**Change by design:**
- **The tempo fix (phase 0).** A track's `{t:'mods'}` gains `bpm` and a key suffix `@bpm`. **Sound changes on a track at a tempo ≠ 120
  for every law FR8 lists** (the user, QA: all of it, no switch):
  - BPM LFOs with ANCHOR off, or while stopped;
  - anchored BPM LFOs within each span (the ramp);
  - Hz LFOs with ANCHOR on, while playing;
  - BPM ENVs;
  - the chaos BPM snap;
  - BPM-synced rise / delay times.

  Nothing changes at 120 (`bpm: 120` = ModCore's default).
  - **No frozen ref covers that case** (checked):
    - project-p1 (canvas-M-bounce, 124 BPM) holds no canvas modulator;
    - the canonical streams hold no `mods` payload;
    - golden-graph posts none;
    - ref-WC records `compileMods`, which is untouched;
    - the master's path is unchanged: master-mods' 140 BPM pins (G2 / G3, the Track's `bpm` already by hand), master-proc, ref-MM's
      single hash;
    - modcore.test's N2 cases run at 120 (tests/modcore.test.mjs:39).
  - **Expected to hold:** canvas-2b-sim.test.mjs:347 (`N.modsKey === api.buildMods(j).key`), canvas-MM-sim.test.mjs:148–178 / :357–363.
  - **Comments that change:** main.js:457–459's "the tracks' payloads carry none", and IMPL-MM §11's limit (closed at the docs step).
- **canvas-P-sim.test.mjs:93 and :151** ("no worklet message at any pick or preset switch"). A preset switch now posts
  `{t:'fastOn'}` (only that) to a node with a live fast subscription; a Frame rate pick still posts nothing. If a scene has no live fast
  subscription the pin holds as written, and a new test pins the move (H-B).
- **tests/ui-bench-fps.mjs** `rateOf` (:141–156: `'heavy'` per its comment, `'snap'` / `'gr'` under `o.fast`) and the `EXPECT` comments;
  tests/ui-bench-fps.test.mjs's `rateOf` cases.
- **bench.json.** New rows `fast-sx / fast-fx / fast-master` and `ui-fps-mac-b`.
- **The filter display's class** (the user, QB): its curve moves from Cut A's 60 class (60–119 / s) to `capHz` 60 / 30. sx-host /
  sx-ui-osc tests that pin the filter display's class move with it (M-B); the wavetable and spectral displays' pins hold.
- **`heardFrame()` frame-stamped** (P2-10): any Cut A pin that read it between a frame's clients moves, and is listed in §14 (H-B).
- **Internal readers.** `ui.snap` is the view (a persistent object, no longer `msg.s` itself). The values the existing sx-host /
  serum-ui tests read are unchanged; a test asserting identity, if the sweep finds one, moves to `ui.raw`.

**Must not change:**
- Every golden and frozen ref; FR1's message logs (golden-graph:244–260, master-proc:384–393, engine-track:160–167); canonical-stream.
- fx-ui.test:1301 / :1973 with fast off; master-ui's existing tests (`setHeard` off); cv-cords:779.
- app.test's worklet module count (:165, 18: no worklet module is added); bench.json's existing rows.
- The CLIP head and recorder tests (sx-ui-seq: they read `kit.msg()`); tests/sx-ui-mix.test.mjs:198–204 (the stub kit's `live`).

---------------------------------------------------------------------------------------------------------------------------------

## 10. ROADMAP 26 (the LFO combiner): what Cut B exposes — not built here
- **The tempo is true everywhere.** After §1.1 every BPM-synced LFO (Serum's own, canvas on tracks, master) runs at the song tempo in every
  state, so an LFO's cycle in beats (`lfoLadder(dot, trip)` serum-core.js:424 / `LFO_LADDER` :408 [R]; Hz LFOs: (BPM / 60) / Hz) maps
  straight onto the bar grid. Without the fix, a bar view would have drawn ANCHOR-off LFOs at the wrong speed against what is heard.
- **A heard (phase, beat) pair per LFO, every frame.**
  - Serum / Wavecraft LFOs: `kit.snap().lfoPh / lfoY` at `Fh` (the view).
  - Canvas and master LFOs: the slot hosts' views from the `'mods'` fast part.
  - With `host.heardTick()` (main.js:5911) at the same `Fh`, the bar curve is `shape(φ_h + (b − b_h) / beatsPerCycle)` for every beat
    `b` of the bar. It is exact for anchored BPM LFOs (their phase is a closed form of the song beat), and exact for FREE / Hz LFOs until
    a retrigger or a rate modulation.
- **The shapes are already page-side.** `laws.js evalPts` (:132 [R], used by graph.js's overlays) and the Path LFO's Y.
- **Heard history.** A `motion.js` ring with a larger `n` (e.g. 512 ≈ 4.3 s at 120 Hz) keeps the heard output of the bar's past part, at
  no engine cost.
- **Left for row 26's own contract:**
  - the combined output as a ModCore source (engine);
  - a pure page evaluator `lfoAt(dev, beat, anchor)` (ladder, shape, mode, direction);
  - the face;
  - the inputs on one stacked jack;
  - the kick marks.

---------------------------------------------------------------------------------------------------------------------------------

## 11. The user's answers (2026-11-01; every question settled)
- **Q1. Existing songs (the tempo fix).** **No switch**: saved songs at tempos ≠ 120 run their tempo-synced canvas modulators at the
  song's tempo from now on, with no notice and no "old behaviour" option.
- **QA. The tempo scope** (asked after the skeptic's P2-1). **Fix all of it, no switch**: Hz LFOs with ANCHOR on, BPM ENVs, the chaos
  BPM snap, rise / delay times and the anchored ramp, as well as the BPM LFO rates (FR8).
- **Q2. The data rate per preset.** The first guess stands: High 120 Hz, Medium 60, Low 30, with the dots and rings drawn every frame on
  every preset.
- **Q3. The iPad and Safari.** The first guess stands: data capped at 60 Hz in WebKit until the iPad pass measures 120.
- **Q4. Bluetooth / AirPods.** **The dots match the sound**: they show what is heard, and on Bluetooth trail the hand by the output delay.
  The knob and its arcs follow the hand at once.
- **Q5. The master's meters.** The first guess stands: the peak bars rise when the peak is heard; the LUFS / LRA text stays at 10 Hz.
- **Q6. Very fast LFOs.** The first guess stands: above a quarter of the data rate the dot steps, and above half it may drift. No
  special drawing.
- **QB. The filter display** (asked after the skeptic's P1-3). **The curve redraws at 60 / s on High and 30 / s on Medium / Low; the
  cutoff marker moves every frame** (§4.3).

(Settled, not asked: the fast lane runs only while a display on screen asks; reduced motion runs it at 30 Hz with the dots at 10 fps;
the wavetable and spectral displays keep Cut A's 60–119 / s class.)

## 12. Known limits (recorded)
- **Slow-only fields stay at arrival time** (ahead of the heard audio by `outDelay`, as today): `eff` beyond the 64 requested indices,
  `mOut`, `filtTap`, `ftap`, `fxph`, `memNow`, the voice counts, the master's LUFS text.
- **Discontinuities between two anchors.** For LIN / POS fields, and a PH jump of ≤ 0.25 cycle, a discontinuity blends over ≤ one
  anchor interval (8.3 ms at 120, 33 ms on Low). HOLD fields, and PH jumps of > 0.25, flip at the anchor's `F` (≤ one interval late).
  An LFO retrigger has no discrete key to group on.
- **Phase interpolation** steps above a quarter of the data rate and aliases above half (Q6).
- **What follows the render, not the ear.** The head meters' and the OUT scopes' analysers are render-time, not heard-time (unchanged).
  The heard frame's accuracy is the audio clock's (`outDelay`; the Latency popover on Bluetooth).
- **N2 at tempos ≠ 120** (a ModCore GLOBAL BPM LFO ≡ a Serum's own MONO one): exact while stopped, within one ulp of the tempo while
  playing (§1.1).
- **The CLIP playhead** keeps Cut A's post-anchored machinery (slow posts). Stopped / Hz-rate arps use the ARP playhead from the fast `q`
  at `Fh` (HOLD).
- **Hardware not measured.** 240 Hz hardware is untested (the virtual display and the cadence tests stand in). WebKit's numbers in G8i
  are the Mac's CPU, and the iPad pass re-measures.
- **The filter display** (QB). The curve is at most 60 / s (High) or 30 / s (Medium / Low), so between redraws its shape lags the
  cutoff marker by ≤ 17 / 33 ms. Each redraw builds a fresh `SFilter` (the reset is not exact for types 91 / 93), so allocation runs at
  up to ≈ 330 KB × 60 a second: recorded, with the retained heap gated.
- **The slow functional work while fast is live** (P1-1) runs on the first painted frame after its message: ≤ one frame later than
  today, and at the slow rate as today.
- **During a tempo gesture** (P2-2) a track's modulators follow the dragged tempo in ≤ `MODS_MIN_MS` (66 ms) steps; the gesture's end is
  exact at once. Each tempo repost is a `setRows`: the phases run on (T3) and only the rate changes.
- **One frame of order** (P2-10): a client that reads `heardFrame()` before the frame's `frameEvery` (none today: the stall client is
  the first registered) would see the previous frame's value.
- **WebKit: the fast lane is off** (review 2, the lead's P2-3). G8i could not run (the device protocol ran in a srcdoc / iframe frame,
  where WebKit's AudioWorklet is not the app's), so `FAST_WEBKIT = 0`: Safari and the iPad keep Cut A's motion (≈ 29 Hz data, drawn at
  arrival) until the device harness — now the app's own page, `index.html?fpsdev=1`, opened by `tests/ui-bench.html?fps=1` — measures
  WebKit's cost (G8i) and the iPad pass confirms it. No `{t:'fastOn'}` is ever posted there.
- **G8 in Chrome is confounded by the CPU clock** (review 2, P2-2). With the fast lane on the worklet's measured load goes *down*
  (Δ −0.039 on the tutorial): the main thread's extra work raises the CPU's clock (DVFS), so the worklet's quanta run faster. The control
  (reviewer 2's dvfs.mjs: the lane off in both arms, one arm burning 1 ms a frame on the main thread) moves the load the same way: Δ −0.019
  paired median, A/A spread 0.0024 (this branch). Chrome's `--load` Δ is therefore recorded, not trusted: **the node / jsc rows (bench.json
  `fastB`) are the authority for the fast lane's cost.**
- **The frame floor under load** (review 2, P1-1). The heavy displays are ≤ 30 / s on Medium / Low; when the frame clock measures dropped
  frames (a 0.5 s window of its own cadence below 0.9 × E) the heavy class halves per level (≥ 15 / s); from level 2 the fast lane's
  per-frame motion (the dots' ticks, the playhead overlays, the GR loops: `shed` clients) paints every other frame, and at the top level
  (3) at 30 / s — Cut A's own rate, read at the heard frame. It recovers a level per 2 s of frames that keep up; a drop soon after a
  recovery doubles the wait (≤ 4 s). So under sustained load the dots and playheads may run at half the display's rate or at 30 / s,
  and a recovery that fails costs ≤ 0.5 s of dropped frames once per wait (4 s).
- **The lane idles** (review 2, P2-1). A part whose payload holds posts once more, then nothing; on its change the held values are
  re-posted at the previous check's `F` first. A field that changes by less than a float's resolution (none known) would keep posting.

## 13. Review log — the skeptic (2026-11-01, against b0683fa: 3 P1 · 10 P2 · 19 P3) and what the lead did with each
Every finding was **adopted**; QA and QB went to the user (§11).
- **P1-1** (with fast live, `setSnapshot` skips its paint, so `updateVoices` / `checkCapture` never run: the CLIP recorder and the phase
  capture die). Adopted: `slowDue` + the tick (§4.1, §4.3, FR7); an M-B test records a clip and fires a capture with fast live.
- **P1-2** (`fastOn` lost at a new node, a graph change, `masterSync`, powerOn). Adopted: `fastOn` follows `on` everywhere, and
  `fastReset` clears the map (§5.1); an H-B sim test covers powerOff → powerOn and a model change.
- **P1-3** (the filter display at 60–119 / s with a ≈ 1.9 ms impulse each, and the 8 KB target unreachable: types 91 / 93 differ after
  a reset). Adopted with the user's QB: the curve at 60 / 30 a second with the marker every frame (§4.3); the 8 KB target dropped, the
  allocation recorded and the retained heap gated (§7 G7); the scratch keeps `out` only (§2.6).
- **P2-1** (the tempo scope is wider than BPM LFO rates). Adopted with the user's QA: FR8 lists every law, §9 the sound change, §11 QA;
  T2 gains the Hz + ANCHOR on case (0.571 → 0.666 s); the "ref-MM" fact corrected (the 140 BPM pins are master-mods G2 / G3, §1.1).
- **P2-2** (throttling every tempo-only repost delays typed tempos, TAP and undo; the timer's closure goes stale after a restore).
  Adopted: the throttle runs only during a gesture, the end flushes, the timer re-resolves by id, `applyRestore` clears the timers (§1.1).
- **P2-3** (`modEls` holds every control with a row, not the halo'd ones; the heavy displays' ids may be missing). Adopted (§4.2).
- **P2-4** (a slow deliver without `mo` / `eff` blanks the dots under the fast ones; a Serum's own FX module has no fast values).
  Adopted: slow delivers update only the fallback while the ring is live, and the own-FX rec subs give `ix()` (§5.3).
- **P2-5** (injected canvas ENV bodies get no fast data). Adopted: fed from sxMonitor's `onFast` (§5.3).
- **P2-6** (the peak partition is untestable at 120 as written). Adopted: exact at 30; per-quantum block maxima through a hook at 120,
  plus run totals (§2.5).
- **P2-7** (the "≤ 2e-3 at 4 Hz" tolerance is not met by linear interpolation). Adopted: the truth-based chord bound, ≤ 2e-3 for ≤ 2 Hz
  (§7 G5′).
- **P2-8** (`grF` resized at wipe / clear would drop the page's kinds). Adopted: sized at :2522 only, zeroed at wipe / clear (§2.4).
- **P2-9** (ring semantics). Adopted:
  - (a) POS / TIME interpolate only forward;
  - (b) LIN / POS extrapolate ≤ 2 intervals, clamped;
  - (c) the PH step rule by the last pair (the data rate);
  - (d) the fixed 70 in a ring an `ix` change never flushes (§3, §4.1).
- **P2-10** (`heardFrame()` read mid-frame uses the read time, not the frame's). Adopted: frame-stamped (§5.3); Cut A's pins re-checked.
- **P3 (19, each folded in as a one-liner)**, the ones named in the lead's summary:
  - the facts added to §0 (the monitor lifecycle, the tempo gestures);
  - the interfaces list completed (§8);
  - the serum-ui adapter's `fast()` (§4.6);
  - the array fields re-fetched per post (§2.2);
  - `cpSnap`'s per-row transfers resolved once per payload / version (§5.3);
  - the `R.live` guards on every consumer read (§3);
  - G8's node rows as paired interleaved medians with an A/A (§2.7, §7);
  - the §12 records;
  - G8i's permission note (§7).

  **The rest were folded from the lead's summary** ("and the rest"); the lead adds any the summary did not name here.
- **Models**: no Fable anywhere in Cut B; lane E on Opus 5.5 (§8).

## 14. Notes (the builders fill in)

### Phase 0 (2026-11-01; base a29e905 = the amended contract)
- **Commits.** 65e12f7 the failing tests; 531d42c the tempo fix; then motion.js with its tests, the import and the precache.
- **The tempo fix (§1.1), main.js.**
  - `bpmPay(pay)` (a `WeakMap` per compiled payload and tempo) replaces `mPayOf`, for every record. Every non-off payload carries
    `bpm` and `key@bpm`.
  - **The gesture throttle.** `tempoGest()` = the tempo box held, or a drum TEMPO `'start'` / `'move'` step within **`TEMPO_GEST_MS` =
    500 ms**. [C] refinement: a drag that never sends `'end'` cannot keep the throttle on.
  - **The release.** The tempo box's gesture ends at `pointerup` / `pointercancel` (window) or `blur` (a release the page never saw).
  - `postMods` times a tempo-only repost from `N.modsTempoAt` (undefined → the leading edge goes at once) and keeps the knob-drag rule
    (`N.modsHold`, `N.modsAt`) as it was. The timer re-resolves its record by id. `tempoFlush()` runs at the drag's `'end'` and the box's
    release. `modsTimersClear()` runs in `applyRestore` before `syncNodes`.
  - **Test hooks:** `__synthTest.cv.drumSetBpm`, `tempoGest`.
- **T2's periods at 140 BPM**, BPM 1/4 ANCHOR off stopped · ANCHOR on stopped · ANCHOR off playing · ANCHOR on playing · Hz 1.5 ANCHOR on
  playing:
  - at a29e905: 0.5 · 0.5 · 0.5 · 0.4286 · 0.5714 s;
  - after the fix: 60 / 140 s for the first four and 1 / 1.5 s for the fifth, each ≤ 1 ms off.
  - T1's spinner case advances the sim clock 1 s before it, because the drag's last tempo-only post (the clock still) would otherwise
    hold its leading edge.
- **motion.js (§3) as written, plus one member.** `R.drained` [C] says whether the last read drained a new anchor into its PEAK fields
  (none → the previous result, as §3 says), so a consumer that folds peaks (master-ui's `heard`, H-B) folds only new ones.
  - The layouts are frozen plain arrays (a typed array cannot be frozen); `ring()` copies them.
  - LIN with a non-finite end holds (−Infinity LUFS, a NaN correlation).
  - `at(Fh, out, sr)` takes the sample rate itself (no options object).
- **Gates** (one file at a time, 2 GB each): tempo-mods 4 / 4 · motion 12 · modcore 24 · master-mods 7 · canvas-MM-sim 23 ·
  canvas-2b-sim 23 · canvas-7a-sim 24 · tap-tempo-sim 18 · canvas-M-bounce 1 · golden-graph 6 · golden-classic 8 · golden-fx 3 ·
  golden-presets 8 · golden-random 1 · main 49 · lint 173 · pwa 25 (after `precache --write`: sw.js BUILD 377f81fe317e, 105 versioned
  files). 0 failures. No engine / DSP file touched, so the goldens are untouched by construction (and ran green).
- **For the lanes.**
  - H-B: main.js imports `MOTION` (`void`'d until used).
  - M-B owns motion.js from here.
  - Nothing else of §2–§5 was started.

### Lane E (2026-11-01; base ab22e0e = phase 0)
- **Commits.** a55a019 the failing tests (tests/fast-lane.test.mjs 12, and one each in sx-mod / modcore / master-dsp); then the fast lane
  (engine.js, serum-dsp.js, sx-mod.js, mod-core.js, fx-dsp.js, master-dsp.js, sx-filt2.js), the test fixes below, bench.json's record
  and these notes. sw.js not committed.
- **Built as §2 says.** `{t: 'fastOn'}` on Track and MASTER, `postFast()` in postMon's order, the two gates, `sx.pkF` / `I.mixPkF` /
  `Meters` `tF / pF` (each block's maximum folded into the slow and the fast accumulator), `SD.fastSnap` + `SD.FAST`, `SxMod.fastRead`
  / `effAt`, `MC.fastRead(x)`, `rack.grFast()` (`grF` sized at set()'s layout change only, zeroed at a wipe / clear), `Meters.peek`,
  `fastRead()` on both processors, the impulse scratch.
- **[C] refinements.**
  - **A Serum part has four persistent message objects** (with / without `q`, `gr`), sharing `v` and `q`: `q?` / `gr?` are absent, not
    null, when they do not apply. Every other part has one.
  - `fastSnap(proc, v, ix, n, keep)` fills `mix[0…7)` and `[11…70 + n)`; `mix[7…11)` are the engine's (`I.mixPkF`, its state).
    `keep` (fastRead): the peaks NaN, nothing restarted. `Meters.peek(out, keep)`; `peek(null)` only restarts.
  - **The fast peaks restart when the lane starts** (a `fastOn` with hz from 0), so the first post holds nothing from before it.
  - **hz ≤ 30: watch()'s immediate slow post gets its fast twin too** (message time, the same F): every slow post has one.
  - **`ix`**: the strictly increasing, in-range prefix, ≤ 64, is used (`v.length` = 70 + that count). The page sends sorted unique ones.
  - **The 120 Hz phase.** From `fastAcc = fastP` the first post ends quantum 0, then 3 × 8, 4, 3 × 7, 4 … quanta: §2.3's cycle, phase
    shifted. Pinned.
  - **G8 rows are kind `'fast'`** with `B.host` `'track'` / `'master'`: master-proc's G4 pins its list of `'master'` rows.
    `measureFast` (tests/bench-scenarios.mjs). The A/A spread is the median |off′ − off|.
- **A pre-Cut-B slow-lane loss, found by FR1b (for the lead; not changeable here).** `Track.stats()` (every 0.25 s) reads the voice
  count through `Inst.sxVoices()` → `SerumDSP.snapshot()`, which zeroes `sx.pk`. So a Serum's smon `mix[0…7)` lose the peaks since
  their last slow post at every stats post (legacy scene: 11 of 86 slow posts). It also builds a whole snapshot 4× a second per Serum,
  watched or not. tests/ref-1c/engine.js has the same path, so changing it would move golden-graph's message logs. The fast lane's
  `pkF` is restarted by its posts alone: there the fast peaks are ≥ the slow ones, and equal to the true block maxima. The FR1b tests
  model that restart: hz 30 exact everywhere else, peaks included; the partition exact with it.
- **Test fixes (in the tests' own setup, nothing loosened).** The master scene's noise source is fresh per render (it was shared
  between the off and on renders). G5′'s ≤ 2 Hz bound leaves out the brackets where the truth shows a discontinuity (an ENV stage or
  the gate count changing: a voice that ends freezes the recent voice's LFO / eff reads).
- **Gates** (one file at a time, 2 GB): fast-lane 12 · sx-mod 56 · modcore 25 · master-dsp 18 · golden-graph 6 · golden-classic 8 ·
  golden-fx 3 · golden-presets 8 · golden-random 1 · golden-606 11 · golden-909 9 · golden-drums 5 · golden-moog 6 · golden-moog-b 6
  · golden-moog-c 4 · golden-sdsv 5 · master-mods 7 · master-proc 27 · engine-track 107 · canonical-stream 1 · canvas-M-bounce 1 ·
  canvas-SC-sim 15 · canvas-MM-live 1 · canvas-MM-session 1 · canvas-SC-live 1 · canvas-WC-sim 51 · cv-cables 69 · patch-core 52 ·
  serum-dsp 115 · fx-dsp 78 · sx-filt2 27 · tempo-mods 4 · cv-graph-engine 5 · motion 12 · bench 6 · lint 173 · pwa 25 (after
  `precache --write`: BUILD 91d5c6330e67, 105 versioned files). 0 failures.
- **G5′ (node, 4 s).** 26 856 HOLD reads exact. 47 427 PH / TIME / POS reads, max err 4.5e-8. 119 360 curved reads, each within the
  truth's chord bound: 1.25e-3 under the 2 Hz LFO, 1.8e-4 under the 0.5 Hz one (≤ 2e-3); away from a discontinuity the normalised max
  err is 1.8e-2 (the 8 Hz LFO). 1 809 reads fell in brackets with a discontinuity, one anchor interval each. The master: 478 PEAK reads
  equal the reference meter over their frames; 4 402 corr / M / S reads within the bound.
  - **EXTRA**, |err| median / max for 0.5 · 2 · 8 Hz · the canvas 2.13 Hz LFO: 10 ms 2.1e-4 / 5.0e-4 · 3.4e-3 / 7.8e-3 · 3.7e-2 /
    1.2e-1 · 5.5e-3 / 8.8e-3; 50 ms 3.7e-2 / 7.9e-2 · 1.3e-1 / 3.1e-1 · 3.4e-1 / 9.6e-1 · 2.7e-1 / 3.3e-1. Past EXTRA_N's two intervals
    (≈ 17 ms) the ring holds, so beyond that the error is the signal's own motion.
- **G8.** Δ = on − off, paired medians, 9 pairs, 3 processes. Gate Δ ≤ max(0.002, 2 × the A/A spread). Recorded as bench.json `fastB`.
  - **node** (posts structuredClone'd): fast-sx 0.00037–0.00091, fast-fx 0.00041–0.00056, fast-master 0.00068–0.00078; A/A spreads
    0.00007–0.00073; 120 posts a second a part.
  - **the macOS jsc shell** (the rows' messages dumped from node; no structuredClone in the shell, so every post is deep-copied):
    fast-sx 0.00013–0.00034, fast-fx 0.00014–0.00023, fast-master 0.00015–0.00023.
  - Targets: node 0.002 (the floor); ipad / jsc 0.003, estimates until G8i and the iPad pass.
- **For the page lanes (H-B, M-B).**
  - `q` / `gr` are absent when they do not apply. Each message's arrays are new per post after the clone.
  - A MASTER `m`'s peaks are since the previous *fast* post.
  - A Serum's fast `mix` is not equal to the slow `mix` (the stats loss above): don't pair them.
  - `filterImpulse(…, scratch)` / `SxFilt2.impulse(…, scratch)` store the array they used in `scratch.out` (a new one when `len`
    changes) and return it: it is overwritten by the next call.
  - **FR5′'s 2 KB bound can be exceeded by `mo`** (ModCore's `Float32Array(fxHi)`, the slow lane's array). It reaches 4.6 KB when a
    panel's rows target its last knobs.

### Lane M-B (2026-11-01; base d840485 = phase 0 merged with canvas, the WC-2 displays)
- **Commits.** 78568e0 / 0d7b9ad the coordinator's extra (below); 55b08e8 the failing tests; cde38bc wk `setLive`; a5eb009 the view, the
  rings and the tick; 52ad20f the pages memo fix (and the test adjustments); 018ea99, 0a239c9 lint and a no-op `setLive`. sw.js not
  committed (the pwa gate ran on a `precache --write` that was then reverted).
- **As written (§4).** `host.raw` / `kit.msg()` the slow message's `s`; `host.snap` / `kit.snap()` the persistent view (`viewCopy`:
  exactly the message's fields, typed arrays copied into the view's own); `setFast(d, ix)` into `fr` (SXF, never flushed by an `ix`
  change), `fe` (rebuilt on a count change), `fq` (HOLD), `fg` (`grKinds` from fx-core `fxLayout(this.fx())`, rebuilt when the layout
  key changes, looked at once per paint); `viewNow()` once per heard frame, every ring `R.live`-guarded, the fields a read wrote put back
  from `raw` before the next read (BEFORE / NONE / stale: the slow values); `slowDue` + the `sx-fast` clock client (live while a view is
  shown, gone once stale: `fastEnd` restores and paints); `fastIx()` / `host.fastIx()`; `fastReset()`, `fastLive()`, `grNow()`;
  `paintMods` through `setLive` (setMod on a full paint or new arcs); the header meter per tick frame (`meterNow`); `checkCapture` on
  `raw`; slot hosts' `.live({…, F})` into a `SLOT_K` ring; cv-mods-ui `slotBody` forwards `heardFrame`. serum-ui's FX adapter
  `gr: grNow()`, `fast: fastLive()`. sx-ui-seq: CLIP on `kit.msg()` throughout (play state, recorder, the post-anchored head), launch /
  stop decisions (ARP slot play, the keyboard's CLIP keys) from the message, ARP on `kit.frame`. sx-ui-mix: the meters on `kit.frame`.
- **[C] refinements (with the reason).**
  - `kit.frame(fn)` calls `fn(shown, fast)`: `fast` says whether the tick is running, so a client can pick its drawing (the filter
    marker). `paint()` and the slow paint also run the frame clients (every repaint, as `kit.live`).
  - The **filter marker overlay** (`canvas.sxo-fmark`, `aria-hidden`, absolute on the display's content box from `offsetLeft/Top +
    clientLeft/Top` and `clientWidth/Height`, re-measured when the display is; inserted right after the display wherever its parent is,
    so a rig's screen carries it) **exists only while the fast lane is live**: fast off, the marker stays in the curve and the DOM is
    exactly c515abf's (G10). At either switch the curve is redrawn at once (`cv.last = null`; `ovOn` is in its key). The curve uses
    `capHz: () => host.curveHz()` (60 without it) instead of `maxHz`.
  - `liveIds()` return ids **only while their view is the active type view** (an inactive view requests nothing). Besides §4.2's: the
    filter display's type id; the sample / granular / spectral display declares its X|Y dot's ids while X|Y is on, the spectral display
    its Hi / Lo (they move per frame through `kit.frame`).
  - The eff ring is also **flushed when `d.k` changes at the same count** (anchors of two different `ix` never blend).
  - Slot hosts take `o.sampleRate` too (the ring's stale / extrapolation bounds; 48 kHz without it); a fast push before any slow
    message makes the view from the slot's fields without a paint.
  - sx-host's former internal `viewNow()` (the view being built, for disposers) is renamed `viewBuilt()`: the contract's name is the
    heard-time view. sx-host's marker-less destination widgets get a no-op `setLive`.
  - The pages are memoised (`pagesNow`: per view `shown()` flags, SerumUI's page; dropped at a mount, an unmount, a full paint and
    destroy). **The heap lesson:** a first cut that kept the views themselves in the memo pushed canvas-WC-sim's retained heap past
    2 GB (1.36 GB at 14 s against the base's 0.83, measured after a full GC every 2 s); now 0.85.
- **Tests.** wk 113 (setLive on the knob, the ring toggle, menu / numBox / seg / slider / rangeBar, the X/Y rails); sx-host 39 (the view
  and `msg()`, the rings at `Fh` with BEFORE / stale, the P2-9 d `ix` rule, `fastReset`; P1-1 through the real `wk.clock`: no paint of
  its own, the CLIP recorder anchoring and the phase capture from the raw message, the client gone once stale; `fastIx` from the arcs and
  the displays, ≤ 64, `host.fastIx` once per change; the filter curve 55–60 / s on High and 27–30 / s on Medium / Low over 120 frames at
  120 Hz with the marker on ≥ 115 of them; G6 on the host — a retrigger, a stage change, a GR step and a peak at `F` shown at the first
  `Fh ≥ F`, never before; the slot rings; `slotBody`); serum-ui 64 (the adapter, the kit / stub parity); sx-ui-osc 63, sx-ui-seq 59,
  sx-ui-mix 18. **Pins moved by design (§9):** the filter display's class (sx-host's and sx-ui-osc's B3 tests: `maxHz` 60 → `capHz`).
  tests/serum-ui-stubs/kit.js gains `msg()` / `frame()` (`T.msg`, `T.fast`, `T.frames`).
- **Gates** (one file at a time, 2 GB): motion 12 · sx-host 39 · serum-ui 64 · sx-ui-osc 63 · sx-ui-seq 59 · sx-ui-mix 18 · cv-mods-ui 13
  (its `slotBody` case runs in sx-host, which has the Serum stubs) · wk 113 · rig-ui 28 · canvas-WC-sim 52 · canvas-sim 25 ·
  canvas-3-sim 25 · canvas-MM-sim 23 · fps-determinism 2 · lint 173 · pwa 25 (after `precache --write`). 0 failures.
- **The coordinator's extra (an existing bug, confirmed on 406e5b8).** In a Wavecraft face the first switch of an oscillator to a type
  never shown threw `insertBefore` in `OscPanel.typeView` (a browser's rule: the reference is no child — the face holds `route.btn`'s
  ⚙ replacement, a built view's el in its screen, its head items), so the paint died and the face kept the old view; "after Tidy" was
  incidental (any first switch on a laid face). The fake DOMs are lax: the tests (sx-ui-osc and rig-ui) apply the browser's rule.
  `typeView` now inserts before the next built view's el / head item still in the body / head, else the pitch row / route button if
  still there, else appends.
- **For the lead / H-B / E.**
  - H-B: `ixOf(…, d.k)` must hand `setFast` the very `ix` lane E kept (E keeps the sorted, unique, in-range first ≤ 64): the host maps
    `v[70 + j]` to `ix[j]`, so main.js should send `fastOn` an `ix` already in that form (the host's `fastIx()` is). The union over
    several subs must be sanitized the same way before it is posted.
  - H-B: fx-ui's wrapper widgets (fx-ui.js:1486's stashed `setMod`, :1838's no-op) have no `setLive`: in a Serum's own FX page the host
    falls back to `setMod({ arcs, live })` per frame there (an object a frame, the stash written). A `setLive` on them closes it.
  - E's notes taken: absent `q` / `gr` are skipped; the scratch's `out` is copied at once by the filter display (`response`); the
    Serum's fast `mix` is never paired with the slow one (the view's `mix` is the fast PEAK while live, the slow copy otherwise).
  - Not run here: the browser (the overlay's placement in a real layout, G7's heap) — the integration smoke and reviewer 2.

### Lane H-B (2026-11-01; base d840485 = phase 0 merged with canvas)
- **Commits.** 63d797c the failing tests; ca7896c the second round (M-B's wrapper ask, the marker class, the sims driven by the
  render); 93ce30c the consumers. `sw.js` is not committed (`precache --write` at integration).
- **Built as §5 says.** `monitors.fastOn` (key `hz | parts | ix`, the last two `[ixv, ix]`), `fastSync` after each `mon`, `deliverFast`,
  `fastHz()` = `fastRate(perf, CLK.webkit, reduced motion)`; the rings: the FX racks (`rec.grR / moR / effR`, `recView` once per heard
  frame — `fxHost.gr()` / `mfxHost.gr()` return the view while live, `fast()` lifts fx-ui's GR cap), the classic panels (`cpFastSt`,
  `cpSnap` through `cpPlan`: the transfers once per payload / values version / model, one persistent live object per plan), the master
  (`mRing`, read in `frameTick` before the OUT draws and in `fastTick`: `heard()` only on `R.drained`, `setHeard` while live); `mcFast`
  and `sxInjFast` hand the slot hosts `{…, F}` (one reused value object per body); `modMount` passes `heardFrame` and `sampleRate`.
  master-ui `heard` / `setHeard`; fx-ui's GR loop, `setLive` (split cached, `w.setLive`), `moddedIds()`, the wrappers' `setLive`.
- **[C] refinements (with the reason).**
  - **The graph change marks the node's `fastOn` entry stale** (`fastStale`: key '') instead of deleting it: the node is the same, so a
    delete would leave the engine's old ids posting when the new state asks nothing; stale, the next sync reposts — `hz 0` included.
  - **`ixv` is one counter for the page**, never restarted with a node: a post in flight from a gone node never maps onto a new `ix`.
  - **The union `ix` is sanitized as lane E keeps it** (integers, `0 ≤ i < NSV + MAXFX`, sorted, unique, the first 64), so `v[70 + j]`
    is `ix[j]` on both sides (M-B's ask).
  - **A legacy node's routing.** Its Serum's `i0` post also reaches the own FX module's subscription (`cur` `['c0']`, the one with `ix`):
    its GR and knob values ride the Serum's post. The Serum host's `onFast` takes Inst posts only (`d.v`): a `c0` post is the rack's.
  - **`fastPush`** starts a ring afresh when a post comes more than `EXTRA_S` past its newest (a part that left the fast ids and came
    back): no bracket across the gap. `fastDrop(id)` at `hz 0` flushes that node's consumers' rings and calls the hosts' `fastReset`.
  - **A body fed fast** (mcSnap's / sxInjSnap's skip, P2-4): its last post's `F` within (−2 s, `STALE_S`) of `Fh` (more than 2 s ahead:
    another F axis — a context restarted); `fastReset` clears it.
  - **The frame stamp** is `outFrame(min(frameTs, now))`; between frames as before (≤ 20 ms, then afresh).
  - **The master's ring is emptied once stale** (frameTick reads it only while it holds anchors).
  - **fx-ui's GR loop re-arms itself** when `host.fast()` flips (within a tick; a refresh too): no host call needed.
  - **The harness.** An EXPECT entry may say `fast: true` (asked only with the lane live: M-B's marker overlay `canvas.sxo-fmark` exists
    only then); the heavy class's cadence `k` comes from the clock's E (`ctx.eff`), never the frames delivered (119.8 delivered would
    ask 119.8); `smoothOf` judges the probe in its own direction (a backward LFO) with the wraps out; `loadVerdict` uses paired medians
    (on − off per pair) and the A/A spread as the paired median of |A/A₁ − A/A₂|. `--serve` writes the first POSTed report and exits.
  - Hooks: `__synthTest.fr = { force, hz, rate, rings, trace, heard, outFrame, fastOn, injEnv, recs, cp, master, off }` (`off`: powerOff,
    for the sims). `trace`'s `probe.x` is the host's `probeX()` when it has one (M-B's has none: null; the harness hooks `arc` itself).
- **Pins moved.** By design (§9): canvas-P-sim :93 / :151 (a preset switch posts `fastOn` alone: the Master row asks; Frame rate picks
  post nothing — and a new test pins the move); ui-bench-fps `rateOf` / `EXPECT` / the class list (+ `curve`). Kept, observed differently:
  fx-ui's 2b halos test logs a widget's `setLive` as the same `[arcs, live]` pair. **Not listed in §9, for the lead:** canvas-MM-sim G5's
  slow-path pin ("MASTER's smon with mc moves the bodies; the rack's smon mo lights its dots") now runs with the fast lane forced off
  (`fr.force(0)`): with lane E's engine the fast lane is live there and P2-4 keeps the heard values (the assertions unchanged).
- **Cut A's `heardFrame` pins re-checked** (frame-stamped): canvas-2a-sim 26, canvas-R-sim 28, fps-determinism 2, canvas-7a-sim 24,
  canvas-9b-sim 15 — none moved.
- **Gates** (one file at a time, 2 GB): main 49 · master-ui 52 · fx-ui 80 · canvas-P-sim 15 · canvas-MM-sim 23 · canvas-M-sim 21 ·
  canvas-sim 25 · canvas-7a-sim 24 · canvas-9b-sim 15 · cv-world 91 · ui-bench-fps 26 · tempo-mods 4 · canvas-FR-sim 12 · lint 173 ·
  pwa 25 (after `precache --write`). 0 failures.
- **Integration, checked in a scratch copy** (lane E's d4738d7 and M-B's 5f017bd overlaid on this lane): canvas-FR-sim 12, fx-ui 80,
  master-ui 52, canvas-MM-sim 23, canvas-P-sim 15, canvas-M-sim 21, canvas-sim 25, canvas-3-sim 25, canvas-2b-sim 23, canvas-WC-sim 52,
  main 49, canvas-7a-sim 24, canvas-9b-sim 15, canvas-2a-sim 26, canvas-R-sim 28, fps-determinism 2, tempo-mods 4, sx-host 39 — 0
  failures. The real engine: a Serum's posts every 3 / 4 quanta with `v.length = 70 + ix.length`, the master's meters heard, a Juno's `e`
  and `'mods'` posts on its dot and its LFO body. canvas-FR-sim injects posts after `quiet()`-ing the engine's own (`fastOn` hz 0 straight
  to the processor): E's posts would interleave with the injected ones.
- **The harness smoke there** (Chrome for Testing, downloads denied, killed after; d 1440 × 900, 1 ×, cap 120): tutorial / master / serum
  every expected display live (8/8, 6/6, 5/5: snap and gr at 120), cost med 0.35–0.6 ms, retained heap 72–97 KB / s, no console error;
  **the smooth probe moves on every frame at 120 and 240 (cv 0 / 0.001)**. G7's full matrix, G8 / G8i and G9′ are the reviewers'.

### Integration (the fixer, 2026-11-01; base 23ca862 = phase 0 + E + M-B + H-B)
- **canonical-stream: the pin moves by design (§9).** The master gets `{t:'fastOn', hz: 120, ids: ['meters']}` once per power: the OUT
  meters are watched (`{t:'mon', ids: ['meters']}`, already left out) and their sub is fast, so a display asks (§8 holds). H-B's tree alone
  fails it the same way (not in H-B's gate list). `fastOn` joins the monitor subscriptions the test leaves out (which displays are live is
  UI; FR1b: sound-free); the fixtures and every compared message are unchanged. Not silently: each `fastOn` is checked against the
  node's `mon` before it (ids ⊆ the watched ids, hz 1…120, or hz 0 with no ids; Track / MASTER only, never the limiter).
- **canvas-1e-sim U17: fixed in main.js.** With E's engine answering the master's `fastOn`, `mRing` holds anchors, so frameTick's
  `mHeardRead` and fastTick run every frame. Each called `heardFrame()` (fastTick twice), each recompute read the clock twice (heardFrame,
  then outFrame), and under the test's 13 ms-a-read clock the 20 ms rule re-read it mid-frame: 56 reads in the four frames against the
  base's 31 (CV_MOUNT_MAX = 38.5 reads), so the mount timed out a frame early. Now `outFrame(ts, now)` takes heardFrame's read, and the
  frame-clock clients read **`frameHeard()`** = the frame's stamp however late in the frame they run (P2-10's rule; the 20 ms rule stays
  for readers between frames); fastTick hands its `Fh` to `mHeardRead(Fh)`. 35 reads: one a frame for the fast lane.

### Review 1's findings (the fixer, 2026-11-01; tests first: dcbd712)
- **R1-B (P2) the gap rule lives in motion.js.** `R.push(F, src, off, sr)`: with `sr`, a post more than `EXTRA_S` past the newest
  flushes the ring (without `sr`, as before). main.js `fastPush`, the Serum host's `setFast` (its four rings) and the slot host's
  `H.live` all pass the rate, so posts resuming after a gap never bracket across it.
- **R1-C (P2) before the oldest anchor the consumers keep their slow values.** `RING_N` 64 → **128** (1.07 s at 120 Hz: a Bluetooth
  delay fits; §3's constant moves, motion.test pins it). main.js `fastAns(R, Fh, sr)` = live **and** `Fh ≥ R.oldest()`; `R.live` is
  unchanged. It gates `cpFastLive`, `fxDotsLive`, the master's `setHeard` (`mHeardRead`: `live` still decides the flush) and the
  bodies' slow skip (`bodyAns`: the body's slot-host ring, in place of `fastFresh` and `B.fastF`, both gone). **Two H-B pins moved with
  it** (canvas-FR-sim's "a slow mcSnap skips a body fed fast" and the injected ENV's): their slow message now comes once the anchor is
  heard — while it leads, the slow path paints (the new R1-C tests). The reviewer's repro at a 1.4 s delay (past the 128): the bars rise
  from the summaries, the classic dot from the slow eff.
- **R1-A (P3).** `rec.effMiss` (one of the own-FX rack's knobs cut from the union by `FAST_IX`), set once per `ix`: `fxDotsLive` and
  `recView`'s `effOn` (so `fxLiveFn`'s effOn branch and fastTick's per-frame `setLive`) ignore the eff ring, and the slow path paints.
- **P3.** `fastDrop` / `fastReset` call each body's `B.host().fastReset()` (`bodyReset`). Chaos bodies are never fed fast (`MC_FAST`
  = lfo / env in `mcFast`; `MC_KINDS` keeps chaos for the slow path). classic-panel `paintLive` returns when the live value is unchanged
  (`H.lv`). canvas-MM-sim pins the master's fast path: the LFO body's phase and the `mfx` dots on each painted frame at its `Fh`.

### Review 2's findings (the fixer, 2026-11-02; base 79ce52f; tests first: 67e91af, 5a6829e, 55fedfc, 1053cff; the fixes e11ab7f, 10ccbcf, e410047)
- **P1-1 the frame floor.**
  - (a) **Medium / Low: every heavy display ≤ 30 / s.** sx-host `heavyHz()` (main.js `host.heavyHz`: 30 on Medium / Low, 0 on High) is
    a ceiling over the wavetable / spectral class and over the filter curve's `capHz`.
  - (b) **The drop level** (wk.js `clock.drop()`, 0…3). Per 0.5 s window, the frames that came at the clock's own cadence (ticks ≥ one
    E period apart, less the slack) are counted against E; below 0.9 × E the level goes up. Windows that keep up count towards a
    recovery (2 s a level); a drop within the wait after a recovery doubles it (≤ 4 s); a recovery that holds halves it again.
    - The reference E survives the estimate following a loaded display down: a decrease adopted while dropping keeps the old rate
      ≤ 10 s.
    - A stall, a hidden document or a change of E restarts the window. The level is measured only in the measured, gated mode (a
      fixed `config({ display })` or the gate off: 0 unless `config({ drop })` fixes it).
    - sx-host `heavyMs`: the class's k (floor) or the ceiling's (ceil), doubled per level, ≥ 15 / s.
    - `dropSpan(reset)` is the harness's window; `dropReset()` restarts the level (each harness cell its own condition).
  - **[C] beyond the brief, measured: the fast lane's per-frame motion sheds** (one `shed` flag per clock client: sx-host's `sx-fast`
    tick, main.js `fastTick`, graph.js's playhead animators, fx-ui's GR loop). With (a) + (b) alone the busy scene at Medium 4 × still
    ran at 42–52 fps, with the heavy displays already at 15 / s.
    - Blocking one painter at a time (scratch busyexp / dotexp): the knob dots, the playhead overlays, the GR bars and the heavy displays
      each cost a few fps, none alone the frames — dots blocked 53, all four 60. One transform write a dot, a device-pixel gate or a
      stagger gained nothing.
    - So from level 2 a shed client paints every other frame of its cadence, and at the top level (3) at 30 / s — Cut A's rate, still
      read at the heard frame. Levels 0 / 1 change nothing.
    - The first G7 run tried a 16 s wait and one shed step. It left a 1 × cell shedding after the 6 × ones (the smooth probe at half
      the frames) and d busy 4 × / 240 at 52.9 fps (157 off). Hence the 4 s cap and the floor at level 3.
  - **The busy scene, G7** (tests/ui-bench-fps.mjs, build 56209db, d; reviewer 2's 79ce52f in brackets), lane on / off:

    | cell | on | off |
    |---|---|---|
    | 1 × / 240 | 229.7 (190.2) | 240.3 |
    | 4 × / 60 | 59.5 (39.0) | 59.9 |
    | 6 × / 60 | 50.4 (24.5) | 53.6 |
    | 4 × / 120 | 89.2 (41.1) | 97.7 |
    | 4 × / 240 | 146.4 (39.4) | 157.4 |
    | 6 × / 120 | 55.8 (25.6) | 63.8 |
    | 6 × / 240 | 51.7 (25.4) | 88.0 |
    | Medium 4 × / 60 (`--perf medium`) | 60.2 (42, busyperf) | 59.9 |

    1 × / 60 and 120 hold their display in both. Fast off is faster than reviewer 2's off run because the drop level sheds there too
    (the playheads, the GR loop, the heavy class).
  - **The idle scene** at every size and cell: on = off within the noise (cost med ≤ 0.09 ms; L + S ≤ 0.93 ms / s).
  - **The full matrix, the lane on** (264 cells; reviewer 2: 8 failing): 1 fails, l busy 6 × / 60 (28.8 fps). The touch sizes read as
    iPadOS in Chrome (MacIntel with touch points: `isIOS`), so the lane is off there; fast off fails it the same. The clip scene's
    ResizeObserver build error at all three sizes predates this branch. The smooth probe moves on every frame at 120 and 240 (d, cv 0.001).
  - **The harness.**
    - `--perf high|medium|low` (⚙'s own preset select, every cell) and `heavyRate`.
    - `rateOf` under `o.drop`: heavy / curve halved per level, ≥ 15; heavy ≤ 30 on Medium / Low; under fast, snap / gr at half the
      cadence at level 2 and 30 / s at level 3.
    - `evalExpect` judges from below at the window's highest level and the curve from above at its lowest.
    - `prepare` restarts the level; the smooth probe is judged by the cell's own lane; the summary shows `drop lo–hi`.
- **P2-1 the lane idles** (engine.js, lane E's file). `fastSend(port, h, m, F)` per part:
  - A payload equal to the last posted (every array, element by element, NaN equal; the same message shape) posts once more (a flat last
    pair: nothing for the ring to extrapolate), then nothing.
  - On its change the held values are re-posted first, then the new ones. [C] They are stamped at the part's previous check's `F`: the
    lane's own previous post quantum, the last frame the payload was read unchanged. The bracket spans one fast period; a pause past
    `EXTRA_S` starts the ring afresh.
  - The hold's twin copies the arrays only at a new shape or length. No allocation per post: FR1b's throwing-constructor test holds.
  - FR1b holds: the audio and the slow messages are identical with the lane on or off. The new test covers a legacy Serum at rest until
    a note, and a silent MASTER until noise.
  - Measured (reviewer 2's idle.mjs, this branch): a Wavecraft at rest 120 → 0 fast posts / s, the silent master 240 → 0. Its meters
    post while the short-term LUFS settles, then stop.
  - **G10** (reviewer 2's g10.mjs with the lane forced on / off on this build; d and l; Wavecraft, master and Juno at rest): the world's
    DOM is equal (the DSP-load text masked: it differs run to run), every canvas' pixels are equal, and there is no marker overlay at rest.
- **P2-3 WebKit (the lead's decision): the lane off there.** `FAST_WEBKIT = 0` (cv-world), so `fastRate(·, webkit)` → 0 and no
  `{t:'fastOn'}` is ever posted in Safari or on the iPad (Cut A's motion) until the device harness measures it (§6, §12).
  - **The device harness runs in the app's own top-level page.** Under `?fpsdev=1`, before its store opens, main.js sets `__synthTest`
    and calls tests/ui-bench-fps.mjs `devBoot(window)`: the hooks, the store's writes off once it exists, then `devRun`.
  - One scene per page load (a fresh app per scene, as the frame was). The report is carried in sessionStorage and the next scene loads
    by `location.replace(devUrl(…))`.
  - A Continue button appears where the audio waits for a gesture (WebKit). The results and the POST come in the app page at the end.
  - `tests/ui-bench.html?fps=1` is the launcher (Run → `index.html?fpsdev=1&…&i=0`).
  - `&fast=<hz>` forces a rate. G8i: `&fast=60` measures the lane WebKit ships without; `--serve` prints that URL, §7's row says it.
  - Checked in Chrome for Testing (scratch devcheck): idle and tutorial ran at the top level, one page load each, no frame, no console
    error, the report and Copy at the end; with `&fast=60` the tutorial's trace showed the lane at 60 Hz and the view moving on every
    traced frame. Not run in WebKit here (the simulator needs the user's permission).
- **P3-1.** A legacy Serum's `c0` posts fast only with ModCore offsets (`fastChain(…, own)`); its GR rides `i0`'s post.
- **P2-2.**
  - Recorded in §12: Chrome's G8 `--load` Δ is confounded by the CPU clock. Reviewer 2's dvfs.mjs on this build: the lane off in both
    arms, one arm burning 1 ms a frame, Δ load −0.019 paired median (A/A spread 0.0024), the same sign as the lane's −0.039.
  - The node / jsc rows (`fastB`) are the authority.
  - **`ui-fps-mac-b`** (bench.json): reviewer 2's row re-measured on this branch (56209db), the full matrix with the lane on.
- **Pins moved by design.**
  - fast-lane: the legacy scene's fast parts are `['i0']` (c0 posts none: P3-1, pinned); the no-allocation count is over the posting
    parts.
  - cv-world / canvas-FR-sim: `FAST_WEBKIT` 0, `rate(·, webkit)` 0.
  - ui-bench-fps.test: the device protocol has no frame (was: mounted through `mountFrame`).
  - New tests: fast-lane (the lane idles); wk (the drop level, `shed`, `dropReset`); sx-host (the heavy period under heavyHz and the
    level); ui-bench-fps.test (rateOf under the drop level and Medium, `--perf`, the top-level device protocol, `devFast`);
    canvas-FR-sim (`heavyHz` per preset).
- **Gates** (one file at a time, 2 GB): fast-lane 13 · golden-606 11 · golden-909 9 · golden-classic 8 · golden-drums 5 · golden-fx 3 · golden-graph 6 · golden-moog-b 6
  · golden-moog-c 4 · golden-moog 6 · golden-presets 8 · golden-random 1 · golden-sdsv 5 · motion 13 · sx-host 41 · serum-ui 64 ·
  sx-ui-osc 63 · main 49 · master-ui 52 · fx-ui 80 · canvas-FR-sim 15 · canvas-sim 25 · canvas-MM-sim 24 · cv-world 91 ·
  ui-bench-fps 28 · wk 115 · lint 173 · pwa 25 (after `precache --write`: BUILD 50af402dc5f2). 0 failures (the files the last
  wk.js / harness changes touch re-run after them).
