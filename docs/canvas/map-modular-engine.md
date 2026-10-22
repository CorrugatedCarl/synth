# Stage 9 map — engine, canvas, format (mapping agent, read-only; branch `canvas` @ 8aab46f)

Evidence = file:line in the repo (paths relative to the repo root). **[V]** verified in code/docs, **[I]** inference, **[M]** needs a measurement
(nothing was run; no test, no bench). Docs read: CLAUDE.md, HANDOVER, ROADMAP, SPEC §2.9/§6/§10 (stages 4–6), IMPL-3 §1.4/§9.0, IMPL-1i §1, map-rendering.md.

## 0. Headline findings

1. Today's Moog Modular is **not a DSP of its own**: it is a `models.js` entry whose `map()` builds a patch for the generic **analog** engine
   (`AVoice`, one voice, mono) — the same engine, one monolithic inlined render loop, that plays the Minimoog. There is no per-module code to reuse
   except three small classes (`Env`, `Ladder`, `HP4`) and the inlined oscillator cores.
2. The panel `panels/modular.js` **already draws the real front panels** of 921×3, 995, 903A, 904B, 904A, 902, 911×2, CP3A, CP8A, the 951 with
   **80 jacks, all `inert: true`** (drawn into the face, no DOM jack) — a layout/art asset for stage 9, but at cabinet scale (2176×1280 px), not per module.
3. The engine is one `AudioWorkletNode` per track holding `Inst`s; the **drum family is the exact precedent** for "a new Inst kind with its own DSP
   script, patch payload, sequencer and golden freeze" (`dr-808.js` via `Dr808.create(inst, id)`, `Inst.kind = 'drums'`). A patch graph fits that
   shape as a new kind + new classic script; **per-module AudioNodes do not fit** (feedback needs ≥ 128 frames of delay, §2.5).
4. Everything on the canvas today assumes **jacks on module edges (left/right/inline) and one `out`→one `in` per device** (`cv-graph.js:146`,
   `:228–235`); cables are cubic béziers with horizontal tangents, **no sag**, drawn **under** the modules. Both are rewritten for patch cords.
5. The hard limits that bite first: `song.js` 64 devices/track, 256 wires, 256 lay keys (`:519`, `:556`, `:585`); `LIMITS.inst` 8; jacks on a 2 px/mm face
   are 38 world px apart (jack hit radius is 22 screen px → overlap below k ≈ 0.56); iPad DOM envelope (S0: 1866 painted elements P+, five hardware
   panels' 2768 controls only "P with single 50–90 ms frames").

## 1. Today's Moog Modular

### 1.1 Where it lives
- **Model**: `models.js:49–92` (`const modular`). Name "Moog Modular / System 55", tag "Mono · 3× 921 VCO · 904A ladder LPF · 904B HPF · 911 envelopes" (`:51`).
  `about` (`:52`) says "Modelled as a fixed patch". `theme` `:53` (`knob:'moog'`, `wood:1`). `MODELS` order `:870` (modular first); every model's
  `map` is wrapped to fill missing vals with defaults (`:872–883`); `patchFor` composes map + FX rack (`:888+`).
- **DSP**: `engine.js` only. `map()` returns an `engine:'analog'` patch (`models.js:76–91`) consumed by `PatchP` (`engine.js:1397`) → `Inst.setPatch`
  (`:1978`) → `AVoice` (`:374`, `render` `:556–852`). No `mm-*.js`/worklet script exists for it.
- **Panel**: `panels/modular.js` (554 lines), registered in `panels/index.js` (`LAYOUTS`/`HW_IDS`, `layoutOf`); Simple layout width `FLOW_W.modular = 1024`
  (`cv-module.js:64`). Hardware size **2176×1280** after 1i (`tests/cv-panel.test.mjs:61`, `tests/canvas-1i-sim.test.mjs:271`).

### 1.2 Voice structure (what `map()` builds)
- `mode:'mono'`, `prio:'low'`, `legato:true`, `glide: glideT(v.gl)` (`models.js:78`), `drift ×1.6`, `sawBow .05`, `bw 26000`, `level = vol/10·1.09` (`:79`).
  Voices: `nv = kind divide|drums ? 0 : mode==='poly' ? p.poly : max(1, unison)` (`engine.js:1991`) → **1 AVoice**.
- Per audio sample (`engine.js:693–843`): noise (xorshift, optional Kellet pink) → osc 3 → [mod3] → osc 1 → osc 2 (each polyBLEP saw/pulse/polyBLAMP tri/sine,
  written out inline at three sites, `:707–776`; the header says why: a call "was too big to inline, and every call boxed its arguments", `:68–69`, `:600–601`)
  → mixer `w0*lev0 + w1*lev1 + w2*lev2 + sub + noise + ring + ext` (`:801–808`) → one-pole bandwidth `mlp` (`bwc`, `:809`) → 904B `HP4` (`:811`, `makeHP('4p')` `:355`)
  → 904A `Ladder(false)` = zero-delay-feedback transistor ladder with per-sample tanh secant linearisation (`Ladder` `:110–160`, `makeLP` default `:344–351`)
  → `fbp = y*a` (post-VCA external feedback, AC-coupled, loop gain capped 0.9·(1+k), `:667–672`, `:824`) → VCA `buf[idx] += y*a*vg` (`:842`).
  Control rate: once per chunk CH = 4·OS samples (`:605–691`): pitch glide, `fenv.tick()`, drift OU noise, cutoff `co` (octaves), smoothed slots `SA/SD/SB` (`:366–369`).
- Modules the Modular "models" internally (all as scalars of one patch, none addressable): 3×921 (osc tune `t#`, range `r#` via `FEET_ST` `:46`, waveform `w#`, PW `pw#`, level `l#`),
  903A noise (`nz`, `nc` white/pink), 995 attenuator #1 = `ea` (envelope → filter amount, ×5 `:85`), 904B HP (`hp`, only if > 0.05 `:86`), 904A (`fc` fixed CV, `rg` regeneration,
  `kb` keyboard CV 0/1), 911→904A and 911→902 (`Env` `engine.js:77–98`: RC with analog overshoot `envOv` 1.3, T1/T2/T3 + E-sus: `a1 b1 s1 c1`, `a2 b2 s2 c2`), 902 VCA (the `a·vg` stage,
  gain slewed 2 ms: `ampK` `:1708`, `:663–667`), CP3A master `vol`, 951 portamento `gl`. **Not modelled** (drawn inert): FM/audio CV inputs, sync, PW CV, 995 #2–3, 902 inputs, clamp, MULTIPLE, trunk lines.
- Control ids (30 live): `r1..3 t1..3 w1..3 pw1..3 l1..3 nz nc fc rg ea kb hp a1 b1 s1 c1 a2 b2 s2 c2 gl vol` (`models.js:54–68`). `perf:keys` 61 keys MIDI 36–96 (`panels/modular.js:214`).
- Presets (`models.js:70–75`): Switched-On Lead, Cathedral Bass, Bach Harpsichord, Sine Choir. Vals store: `dev.vals` (flat id→number).
- Mod-wheel: `lfo.wheelPitch 0.6`, `lfo.rate 5.5` (`models.js:89`) — the only modulation; canvas modulation (2b) reaches its sm/apply/proc knobs through the classic adapter (`Inst.modRows`, `engine.js:1791`; class table `cv-mods.js`; `modular.hp` is a `struct` control, `tests/cv-mods.test.mjs:32`).

### 1.3 Panel facts reusable by stage 9
- `panels/modular.js` counts [V, grep]: **80 jacks, 38 knobs, 6 rotaries, 13 switches, 5 S-trig sockets**, 115 `inert:true`. Sections (mm, 2 px/mm): osc1–3 (107.95 mm = 216 px wide), att 995, noise 903A,
  hpf 904B, lpf 904A, vca 902, env1/env2 911, cp3a, blank, cp8a, kbd (951 plate), keys. Jack labels are the real ones ("FREQUENCY CONTROL INPUT"×9, "WIDTH CONTROL IN"×6, "SIGNAL INPUT/OUTPUT"×4,
  "MIXER INPUT 1–4", "ATTENUATOR n IN/OUT", noise outputs, "CLAMP TRIG. (V)", "AUXILIARY OUTPUT ±", sine/triangular/sawtooth/rectangular outputs).
- `cv-panel.js` already knows `inert:'later'` — "a labelled jack at full contrast: cable-able with full patching" (`:17`, `:175–177`, `:424–427`, `inertSvg` `:1087`); the 808/909/SDS-V multi-out jacks use it
  (`panels/tr808.js:61`, `tr909.js:53`, `sdsv.js:53`). It is **art only**: the jack is a `<g class="hw-inert hw-later">` baked into the GL face texture; no DOM element, no hit target, no port.
- The research JSON for the panel ("scratchpad/canvas/panels/research/modular.json") is scratch and gone; the layout file is the surviving record (notes `:548–553`: option B, "genuine modules this voice uses", 951 case, 61 keys from a secondary source).

### 1.4 Tests that pin it (all must stay green; the sound pins must stay bit-identical)
- **Sound**: `tests/golden-classic.test.mjs` — every classic model incl. `modular`, default + 4 presets, 48 kHz×4 and 44.1 kHz×1 (GOLDEN_FULL adds 2×/8×/96k), frozen `tests/ref-p1` engine+models vs current (`:15–38`);
  it also asserts `MODELS.length === 12` on the **frozen** list (`:19`) and that each id and its preset names still exist in the current list (`:21–26`) → **the `modular` model id, its presets and its `map` must remain**.
  `tests/golden-graph.test.mjs` — ref-1c engine vs current in legacy/graph/processorOptions form for `B.models.MODELS.filter(m => !m.custom && m.family !== 'drums')` (`:24`) and asserts the count `12 + presets` (`:171`): **a new non-drum, non-custom model breaks it** unless the filter learns the new family
  (the 7a precedent; a family needs its own ref). `tests/golden-fx.test.mjs:15` iterates the frozen ref list (stable). `tests/canonical-stream.test.mjs` pins the message stream of canonical shapes.
  `golden-presets`/`golden-random` are Serum only. Drum refs `ref-7a/7b/7c/7d` each hold a frozen `engine.js`: any engine edit keeps all of ref-p1, ref-1c, ref-7a..7d bit-identical.
- **Layout/size pins that name `modular`**: `tests/cv-panel.test.mjs:40,53,61,63,66,130` (`HW_IDS` literal list, TARGET/PINNED sizes, bed range), `tests/cv-face.test.mjs:111–115` (face sizes, dpr 2.5/3 numbers),
  `tests/canvas-1i-sim.test.mjs:268–294` (makeRoom 1728→2176, KEYED), `tests/cv-module.test.mjs:92`, `tests/cv-mods.test.mjs:114,202–205`, `tests/ui-bench-1i.mjs:25,358` (the modular face paint is "over 100 ms on the iPad"),
  count pins `tests/cv-art.test.mjs:39`, `tests/cv-tray.test.mjs:796` (`MODELS.length`).
- **Bench**: no modular row. `cv-cost.js:91` costs it as `C('c3','transistor ladder',1,0.0055,0.0063)` = 0.0118 for a chord (mono). Nearest measured row **c3 (Minimoog, 1 note, OS 4): iPad 0.010** (`bench.json` ipad / ipad1d / ipad1e / ipad2b all 0.010).
  So today's 3 VCO + HP + ladder + 2 env mono voice ≈ 1 % of an iPad core. Targets table `bench.json:targets` has no c-row targets; r (Prophet+Juno+Serum+panel) iPad 0.12.

## 2. The engine's shape

### 2.1 Track / Inst / Chain (SPEC §6.2; `engine.js`)
- One `AudioWorkletNode('synth-engine')` per track (`main.js:988–1006`, `registerProcessor` `engine.js:4492`) = `Track` (`:3238`) holding ≤ 8 `Inst` (`:1560`; `MAX_I`, `MAX_C`, `:3204`) and ≤ 16 shared `Chain`s (`:3191`, each an `FXRack`, `fx-dsp.js`), then OUT sum → `panicFade` → `outStage` (DC block, limiter, clip, `:4474–4489`). Messages: `Track.msg` `:3578`; graph `graphMsg` `:3740`, `wire` `:3792`, `resolve` `:3815`.
- `Track.process` (`:4235`) splits each 128-frame quantum into spans on a **4-frame grid** at song/ext/sequencer events (`:4248–4268`); `renderSpan` (`:4280`) / `spanG` (`:4291`) render each Inst then Chains.
  Cost accounting: `Date.now()` (1 ms resolution on WebKit) around Inst/Chain spans (`:4294`, `stats` `:4398`): **per-module CPU inside a patch is not measurable that way** [V/I].
- `Inst` kinds: `analog` (AVoice), `fm` (FVoice), `divide` (Solina `Divide`), `serum` (SerumVoice ×32 + own FX), `drums` (machine object). Kind switch in `setPatch` (`:1978–2039`): `kind==='drums'` → `nv = 0`, `drOn(p)` (`:2199`), machine kept across kind changes (`dmL`).
  Every path constructs `Track`+`Inst` (live, preview, offline, golden harness): "one monomorphic class" (`:1551–1559`); fields are declared in `Inst.init` (`:1613–1684`) so the hidden class never changes — a new kind adds its fields there (as `dm*`, `dr*` did, `:1615–1623`).
- Oversampling: `Inst.setOS(os)` (`:1686`): `fs = base·os`, `CH = 4·os`, `buf = Float64Array(128·os)`, decimators `decChain(os)` (cascaded Kaiser half-bands, `:1544–1549`, `:1071`), 64-bit end to end; app OS 1/2/4/8 with `sampleRate·OS ≤ 384 kHz` (`main.js:748`), per-Inst safeguard `lowerOS` (`main.js:1199+`). Everything in an Inst runs at the OS rate and is decimated once at the end (`renderSpan` `:3039–3046`).
- Parameter path: panel → `buildPatch` → `{t:'patch', p}` (whole patch, ~60 Hz) → `smTargets`/`smStep` two cascaded one-poles (6 ms panel, 1.5 ms bend/wheel) interpolated per chunk (`:1743–1778`).
  Posts are content-keyed with a 66 ms drag throttle (HANDOVER §5 2b lessons).

### 2.2 ModCore (`mod-core.js`, SPEC §7.6, IMPL-2b)
- A track-level, **control-rate** modulation core: a voice-less Serum modulation state on a shim + one "most recent note" pseudo-voice, created on the first `{t:'mods'}` (`engine.js:3644`); nothing on the audio path without rows (N1).
  Value slots: 24 live of `NVAL 32` (macros 0–7, value sources 8–23), `NEXT 16` ext slots, ENV slots 4, LFO slots 10, chaos 2 (`mod-core.js:5–60`, `cv-graph.js` compileMods doc). Per-4-frame-chunk values (ext at `[k·32 + c]`); a classic target gets slot offsets (`MC.cls0/cls1`, `Inst.modSpan` `engine.js:1859`) or span setters (`MC.setv`) at **span rate**; Serum targets go through `ext<k>` rows; FX racks through `MC.fxv`.
  A modulator reaches a knob by a `track.mods` row `{src, dst:'<dev>:<param>', amt, bi, curve, …}` (`cv-model.js addMod` doc); `destOk`/`classOf` (`cv-mods.js`) decide which classic knobs accept it (236 of 425; the table is checked in and tested against a perturbation run).
  **Consequence**: ModCore is not an audio-rate path (≈12 kHz at 48 kHz, 4-frame chunks, interpolation only for smoothed slots). A canvas LFO/ENV could enter a patch only as a control-rate `ext`-style source into a "CV in" jack.

### 2.3 The drum family = the template for a new Inst kind (`dr-808.js`, 4468 lines)
- Classic script (IIFE publishes `globalThis.Dr808`, failure → `null` without throwing, `dr-808.js:56–60`), loaded by `main.js:800–801` (`DSP_FILES` — also read by `tools/precache.mjs:9,65–66` and `wk.loadDSP`), listed in `tests/golden-harness.mjs:28`, `tests/dsp-scope.mjs:39`, `sw.js:46` (generated by `node tools/precache.mjs --write`).
  `MACH` (`dr-808.js:3498`) = a frozen descriptor table, one entry per machine (tr808/tr606/tr909/sdsv) over one shell; `Dr808.create(inst, id)` → machine (`set(drum)`, `setOS(os, fs)`, `hit`, `render(buf, N, F0)` at OS rate, `post(L,R,mono,n)` base rate, `poll`, `live`, `reset`, `mon`, `setSalt`).
  Time base: control work per absolute 4-base-frame chunk "so the same hits render the same bytes whatever splits the spans" (`dr-808.js:20+`) — the property a patch engine needs too (offline bounce = live).
- Inst side: `drOn` (`engine.js:2199`), `renderDrums(n)` (`:2346–2391`: tails, `dm.render`, decimate, osFade, `dm.post`), `drHit`/`drStep`/`drClock`, `fadeDrums` (de-click), `drMon` (monitor), `setOS` hook (`:1736`), `anyActive` (`:1974`), `restore`/`warmDrums*` (`:3355–3525`: JIT warm-up rounds per machine). Host side: payload `drumPayload` (`main.js:995`), `{t:'drumsErr'}` (`:1029`), tests `ref-7a..7d` frozen copies, `bench-scenarios.mjs` rows `d8p…dvx`, `cv-cost.js` entries.
- State kept by id across edits: `FXRack` keeps each effect unit by instance id while type matches (`fx-dsp.js:13–15`) — the pattern a recompiled patch needs (modules keyed by id keep their state when cables change).
- Closest existing "graph-ish" DSP: `FXRack` serial racks + splitters with latency `align` and bus routing "in dependency order" (`fx-dsp.js:19`, `:2891`). **No module-to-module feedback anywhere except**: AVoice's external-input feedback `fbp` (one-sample delayed, gain-capped, `engine.js:667–672`, `:824`) and each filter's internal ZDF loop. [V]

### 2.4 Serum
Serum is not a graph either: fixed sources→routes→filters→VOICE with a modulation matrix (64 rows) evaluated per voice; its "cables" are views of state (`sx-edges.js`, IMPL-3). 32 preallocated voices (`SXV`), own FX, own oversampling (`sxOSFor`). It cannot host arbitrary audio-rate patching.

### 2.5 What could host a graph of DSP blocks — options and consequences
| Option | Fits? | Consequence |
|---|---|---|
| **A. New `Inst` kind (e.g. `'patch'`) + new classic script (e.g. `mm-*.js`), graph interpreted inside the track's worklet at the OS rate** | **yes** (drum precedent) | 64-bit, OS and decimation reused, deterministic order, bounce = live, one limiter, ModCore/held-keys/zones/power/FX chain unchanged. New: compile (pure module) → typed-array program; worklet interpreter; own warm-up; cost per module in a typed-array loop |
| B. One AudioWorkletNode per module (WebAudio graph) | **no** | Web Audio mutes a cycle without a `DelayNode` and clamps a cycle's delay to ≥ **128 frames** (2.67 ms @ 48 kHz): audio-rate feedback/FM-from-filter get a comb/pitch error; Float32 at every hop; no shared oversampling; ≈ 30 nodes per track; PWA bounce differs. SPEC §6.11 already rejected "several nodes per track" for these reasons |
| C. Extend `AVoice` with routing flags | no | cannot do any-into-any; edits `AVoice.render` (verbatim-move rule) and risks every golden |

**Option A, how feedback works**: the sample loop already runs at 192 kHz (48 kHz × OS 4); a cycle needs a unit delay on one back-edge = 5.2 µs (10.4 µs @ OS 2, 20.8 µs @ OS 1) — an acceptable analogue of a cable/stage delay [I].
Compile design implied by the code (not built): topological order over the acyclic part, **strongly-connected components stepped sample by sample**, the chosen back-edge reads the previous sample (like `fbp`); acyclic parts can run **block-wise per module** over the span's `Float64Array` (N = n·OS), which avoids the call-boxing the engine header warns about (`engine.js:68`, `:600`).
Unit-delayed loops through a ZDF filter change its loop gain/phase slightly [I]; `fbp`'s cap (0.9·(1+k)) shows the project's answer to latching — a limiter/saturation per module output is needed [I].
- Allocation-free audio path is a gate (`noAlloc`, `tests/dsp-scope.mjs`, used by `tests/dr-808.test.mjs:590`, `classic-mod.test.mjs:381`); `v8-guard.mjs` (`--no-sparkplug`) runs in every test file. A program of `Int32Array` ops + preallocated buffers fits; structural edits allocate **between quanta** (as `modsMsg`, `graphMsg`).
- JIT: JavaScriptCore tiers shared code to the last receiver shape; every new mode needs a warm-up round and the plain paths a re-warm (HANDOVER §5 2b lesson; `warmUp` `engine.js:3324`) → one warm patch per module type/variant, and `ready` is posted only after warm-up (`:3282`, `:3308`).

### 2.6 Oscillator/filter reuse
Oscillators are inline code in `AVoice.render`, not classes (`engine.js:68`); `Env`/`Ladder`/`DiodeLadder`/`SKLow`/`SKHigh`/`SVF`/`HP4` are module-scope classes of `engine.js` (not exported; a classic script cannot import them — they would have to be handed to the new script or copied, "verbatim move" rule `SPEC §6.2`). Hard sync/audio-rate PWM is the `slave()` band-limited path (`:493–544`, osc 2 only).
A 921/901 with sync input, linear/exponential FM, PWM CV and four simultaneous outputs is a **new** oscillator core (4 outputs from one phase; sync from another module) — the polyBLEP helpers (`blep`/`blamp`, `:56–66`) are the only shared code.

## 3. Polyphony
- **Today: mono.** `p.mode='mono'`, `prio 'low'`, legato (`models.js:78`) → `Inst.noteOn` → `held` stack + `monoPlay` (`engine.js:2602–2606`, `:2735–2757`): lowest held key, single `AVoice`, glide `glc`; `noteOff` re-plays the next held key (`:2787–2796`).
- The classic engine's voices: poly mode builds `p.poly` (default 8) `AVoice`s and allocates by oldest/non-gated/sustain stealing (`:2608–2624`, `Inst.setPatch` `:1991–2004`); unison = N voices detuned (`:2013`); Serum 32 voices; Solina divide-down is per key. Each polyphonic voice is a **full copy** of the whole signal path ("voices duplicated").
- Controller state (bend/wheel/aftertouch/sustain) is a scalar per Inst (`:2023`, `Track.msg` `:3609–3617`); held keys per Inst by slot (`holdR`, `Track` `:3271`). A powered-off Inst keeps controller state (SPEC §6.6).
- **How a patched graph could be voiced** (design space, none exists):
  1. **Mono** (faithful: one 951 keyboard → one CV, gate, trigger) — keyboard module outputs from the held stack, low-note priority default (as today), S-/V-trigger conventions; cost = one copy of the graph. Lowest risk; matches the user's reference instrument.
  2. **Voice-duplicated graph**: compile the program once, keep per-voice state arrays; each module is **per-voice** (downstream of keyboard CV/gate) or **global** (LFO, noise, 960 sequencer/clock, S&H clock). Needs a *voice-scope inference* rule: a global module receiving a per-voice signal (e.g. 912 envelope follower → shared LFO rate), or a per-voice module feeding a global one (summing), is ill-defined → refuse, force per-voice, or sum. Cost = N × the per-voice sub-graph [I]: a 30-module patch ×8 voices would be ≈ 8× a mono patch.
  3. **Paraphonic** (several oscillators on the voice allocator, one shared filter/VCA/env): a special case of 2 with a different scope inference; a known design in hardware generally, but not how a System 55 patch works — product decision.
- Existing hooks a patch kind can reuse: `Track.noteOn/noteOff` per-Inst zones/transposition (`:3949–4005`), `held`/`monoPlay`, `lastNote`/`nOn` (shared-panel key tracking, `:2584`), `ModCore`'s pseudo-voice for "most recent note" (a mono approximation already accepted for non-Serum targets).
- Sequencers split spans at event times through `Track.process` (`seqEvents`, `sxSeq.next`, `:4257–4263`): a **960/961/962 sequencer module** would be a third instance of this pattern (TB-303 `seq*`, Serum `SxSeq`, `DrSeq`), with its own transport anchoring (`transportHook` `:2865`, `:4100`) and power on/off handling (`Track.power` `:3917`).
- Idle skip: `Inst.renderSpan` skips after 2 s quiet **only if** no voice is active and no tail (`:2981–2995`); a patch with free-running oscillators/LFOs/noise is "always active" unless the kind defines a silence rule (e.g. VCA/OUT level < ε and no gate for 2 s, with feedback self-oscillation exempted) [I].

## 4. Canvas side

### 4.1 Modules, jacks, cables today
- **Module** = `.cv-mod[data-cv-mod][data-cv-kind]` in `#world`: 40 px bar + `.cv-body` + `.cv-jack` spans (`cv-module.js` header `:1–50`, `createModule` jacks `:454–468`). A jack = a 16 px DOM dot with a 44·`--ik` px hit pseudo-element (`style.css:1072–1082`), attributes `data-cv-jack="<mod>.<port>"`, `data-side` (left/right/**inline**), `data-kind` (`audio|mod|warp|note`), `data-dir` (`in|out`), `role=button` when patchable. Folded modules put jacks 14 px outside (`style.css:1077`).
  **Inline jacks** are anchored on `[data-jack="<port>"]` elements inside the body and measured module-local at mount/relayout (`cv-module.js:470–493`; Serum MACROS tiles) — the existing mechanism for jacks inside a face.
- **Model ports**: `PORTS = { inst:['out'], panel:['in','out'], out:['in'] }` (`cv-graph.js:146`); `kindOf` (`:149–152`: synth→inst, panel, out, `MOD_KINDS`); `validate` (`:201–247`): exactly one OUT, ≤ 8 inst/16 panels/48 fx (`LIMITS` `:144`), **`dir` out→in only (`:229`), `fan-out` one output → one input (`:234`), panel→panel `chain` (`:235`), `cycle` refused (`:237`), `dup`**. Every one of these is a rule of the *track-level* FX graph; a modular patch breaks `fan-out` (mults), `cycle` (feedback) and "one `out`/`in` per device".
- **Cables** (`cv-cables.js`): `cablePath` is a cubic with horizontal tangents `d = max(TANGENT_MIN 40, |dx|/2)` (`:190–193`, `TANGENT_MIN` `:55`); **no sag/sway/physics exists** (no match for sag/catenary/verlet anywhere). Two SVG layers in `#world` at the cables' bounding box: audio cables + mod-cable bodies **under** the modules (z 0), mod-cable last `END_PX = 24` screen px + amount badges **over** (z 10000, SPEC §2.9); strokes `calc(Npx * var(--ik))`, `--ik` written at zoom end only (`cv-world.js:660`); snap `SNAP_PX 32`, tap `TAP_PX 8` (`:60`); cable drag `createCableDrag` (`:894+`) with compatible-jack glow, "Connect to…" tap path, re-patch by dragging an end, edge auto-pan via `world.dragPointer` (`cv-world.js:1363–1377`).
- **Mod cables (2a/2b)**: `track.mods` rows from a module's `.out` jack to a **knob** (`[data-dest]` → `'<dev>:<param>'`, `cv-cables.js` header `:12–23`), amount badge, halos on classic knobs (`classic-panel.js`), Mod list sheet (`cv-modlayer.js`). 64-row Serum budget. Control-rate (ModCore). They coexist with, and are not, patch cords.
- **Serum internals as a precedent for "modules that are parts of one instrument with cables that are state"**: part modules keyed `iN/oscA` (`sx-edges.js` PARTS, `cv-module.js:97–130`), internal cable ids `x:<dev>:<edge id>` (`cv-cables.js:297`), edits as field writes with undo (`sx-edges.setEdge/cutEdge`), `jackrules.test.mjs`, lay keys `dev/part` (`song.js:519`), port ids `dev/part.port` (`PORT_ID`, `song.js:550`). Also the Pads module (`pd1…pd8`, inline mod-pad jacks, derived note cables, IMPL-8).
- **Hardware modules**: face = SVG art → `Image` → 2D canvas → WebGL2 texture drawn **under** `#world` by `cv-gl.js`/`cv-face.js` (mipmapped base at min(dpr,3) px/world px, windows above k = 1; `FACE_BUDGET_BYTES 384e6`, `BASE_MAX_PX 16e6`, raster queue = one job per frame, `cv-face.js:21–50`); controls = DOM (`hw-ctls`) on top; the face SVG stays in the DOM, hidden (`visibility:hidden`) in gl mode. 2 px/mm; sizes rounded to the 32 px grid. A module overlapping any other world item drops from `gl` to the `dom` bitmap tier until it is clear (IMPL-1h §3.5).
- **Zoom**: `K_MIN .25 … K_MAX 2` (`cv-world.js:57`); controls sleep below `READ_K 0.5` (a press inside a module pans; double-tap to edit, `:61`, `:1093–1101`); `EDIT_K 0.9`. Modules render identically at every zoom (no cards/LOD) — user rule Z1.

### 4.2 What stage-9 patching needs from this layer
- Jacks drawn **inside the face** (already: 80 on the cabinet, `hw-inert`) must become DOM jack anchors at known face coordinates (the inline-jack mechanism fits) with real ports; labels per jack (the layout already has them).
- Jack pitch on a 921 is 19–20 mm = **≈ 38–39 world px** (`panels/modular.js` jacks x 38.1 / 57.5 / 76.5 mm; d 14 mm = 28 px). The jack hit circle is 44 screen px wide (`style.css:1081`) → neighbouring circles overlap below **k ≈ 0.56** and `READ_K` is 0.5: the pitch is at the edge of usable at fit-all zoom [V arithmetic]. A System-55-sized cabinet row (15 MU ≈ 810 mm = 1620 px) fits a 1200 px iPad viewport at k ≈ 0.7 [I]; bigger patches need pan-while-patching (edge auto-pan exists) or a jack picker (tap-a-jack "Connect to…" exists).
- Cables **over** faces: audio cables are under modules today so "a cable over a knob never steals its touch" (SPEC §2.9). Real cords over panels need an over layer with `pointer-events:none` except plug heads + a thin hit path (decision); GL faces are under all DOM, so cords are DOM/SVG above (fine).
- Cord physics (sag/sway/plug ends) has no code to build on; cost model: N points per cord, re-path only while moving, `d` attribute updates [I]. 40–80 cords animating are cheap in JS; the open question is WebKit repaint of a large SVG layer with `will-change` while the world is compositor-scaled [M].
- Cable cardinality: `fan-in` allowed today (several outs summed into one in), `fan-out` refused; a real modular has multiples (994/MULT) — either allow fan-out for patch cords or model mults as modules [design].

### 4.3 Many modules — what is known (IMPL-3 §9.0, map-rendering.md, bench.json `"ui-m3"`)
- DOM, not art, is the cost. One bundled Serum 3 719 elements/153 knobs; hardware faces are 30–70 % art that goes to the GPU, leaving 120–660 control elements each; the old cabinet = **1 858 total (563 controls + 1 295 hidden face-SVG elements)** (`map-rendering.md §2.3`).
  User five-set (OB-Xa, Jupiter-8, MS-20, CS-80, Prophet-5): 6 637 / **2 768 controls** / 3 869 hidden. A 921-class module ≈ 40 controls (incl. ~10–15 jacks) [from the cabinet count ÷ 10 modules; I].
- iPad verdicts: `sx1` (1 866 painted) **P+**; `p1` (a Serum in parts) P; `p1x`/`hwm` (Serum parts + 6 modulators / five hardware + 6 modulators) P or one settle frame over; `hw5` hand-tested "fail" with single 50–90 ms frames (accepted since 1h); `t2`/`t3` (two Serums in parts / Serum + 3 hardware + FX) **fail** (bursts to 198/116 ms). `SX_HEAVY = 1866` and the touch notice (`main.js:6167–6175`). `opacity0` on idle modules was the only variant that rescued `t2`.
- Module-count caps today: `song.js` 64 devices, 256 wires, 256 lay keys; the in-practice maximum is a Serum in parts + modulators (≈ 20 modules). `tests/ui-bench.html`/`ui-bench-m3.mjs` (CDP harness) is the way to pre-measure a ≈ 20–40-module patch scene (a `?m9=1` spike) [M].
- Faces: 30 small modules = 30 small textures (a 921 face ≈ 216×444 world px ≈ 0.4 Mpx at dpr 2 incl. mips ≈ 2 MB) — far under `FACE_BUDGET_BYTES`; raster queue one job per frame ⇒ ~0.5 s to paint a 30-module patch at load [I]. Rule 1 (no resolution that "renders in" at rest) keeps the faces on GL; controls/jacks/cables stay DOM and re-raster at rest like every other DOM part (accepted for DOM in 3R discussion).
- Tidy (`cv-module.js tidy`) lays out columns instrument → FX → OUT; a patch needs a free-form/rack layout with an "unpatched modules tray" rule [design].

## 5. Project format

- **Today** (schema 11, `cv-migrate.js:98`): a track = `{prim, nid, dev:{<id>:device}, wires:[{id,a,b,g}], lay, mods, mid, notes…}`. Devices (`song.js:551–597 normDev`): `synth` (`model`, `vals` flat plain data, `preset`, `seq`, `fx`, `on`, `solo`, `zone`, `name`, `fxId`, and **`drum`** for drum models via `isDrum(model)` + `normDrum`), `panel` (`fx`), `out`, and the modulator kinds (`normModDev`). Limits: **64 devices**, ids `^[a-z][a-z0-9]{0,15}$`, kinds `^[a-z]{1,12}$`, **256 wires** (a/b match `PORT_ID` = `dev[/part].port`, port `[a-z][a-z0-9]{0,7}`), level `g` 0…4. `lay` ≤ 256 keys `^[a-z][a-z0-9]{0,15}(/[a-z][a-zA-Z0-9]{0,15})?$` with `{x,y,fold,z,ui,auto}` (`song.js:519–537`). The primary must be a `synth` (`:583`).
  Project level: `schema`, `uid`, `perf.wheel`, `pads` (≤ 8 Pads modules). Saved file also mirrors the primary as v1 fields so `main` opens it (`mirror`, SPEC §5.8). Schema history 0→11 documented `cv-migrate.js:7–97`; each bump appends a `STEPS[n]`; a newer schema opens read-only (`appstore.js` gate).
- **Compile**: `cv-graph.compileTrack` (canonical shapes → today's `buildPatch` stream; else `{graph, patches, chains}` graph protocol). The accessor ratchet (`tests/lint.test.mjs:90–110`, allow-list `tests/fixtures/accessor-allow.json`, shrink-only) forbids new reads of a track's v1 fields (`t.model/vals/preset/seq/fx`, `fxOf(`, `isSx(`) in root files: new code must read devices (`instOf(t, dev)`, `instView`).
- **What "a patch of modules" needs (schema 12, additive, nothing to convert — the 8…11 precedent: "a 12 in a schema-11 build opens read-only")**:
  1. A new instrument identity (model id e.g. a modular family; keep `modular` untouched for goldens/old projects) as a `synth` device so `prim`, zones, power, MIDI, FX panel, OUT, roll and the Sources/Hardware machinery work unchanged.
  2. A patch record on that device (the `drum` pattern: `dev.patch`, normalised by a `song.normDev` branch, plain data, bounded): `modules: { <mid>: { type, vals, name?, … } }` (+ per-module state such as sequencer steps), `cords: [{ id, a:'<mid>.<port>', b:'<mid>.<port>', color?, g? }]`, module order/ids counter, poly/mono & keyboard settings, voice-scope overrides if any. Bounds needed: modules (≤ ~64–128), cords (≤ 256 — the existing wires cap is per track, but patch cords should not live in `track.wires`).
  3. Module placement in `track.lay` under keys `iN/<mid>` (the Serum-part key form; `LAY_KEY` allows `dev/part`, ≤ 256 entries per track) and cord ids; or one lay entry per module device if modules are devices.
  4. **Choice with consequences** — modules as *parts of one instrument* (Serum-part model: engine sees one Inst, UI sees many modules; cables are state; no change to `cv-graph.validate`/`LIMITS`; fits the 64-device cap; port ids `iN/<mid>.<port>` fit `PORT_ID`) vs modules as *track devices* (`kind:'mmod'`: each addressable by the mod layer, history and cost layers, but 64-device cap, `validate`/`order`/`compileGraph` rewrite, and each would otherwise look like an Inst). The Serum/Pads precedents favour parts.
  5. A migration story for the existing `modular` instrument: stays a fixed-patch instrument (its 4 presets and goldens frozen); optional "Open as patch" converts it to the equivalent patch (3 osc → mixer → HP → LPF → VCA + 2 env + kbd), which the compile can test against `ref-p1` within a tolerance (not bit-identical by construction) [I].
  6. toV1 (Save as classic project) must name the lost patch; `mirror`/`primV1` need a rule for the new model (as the drums: named in `lost`).
  7. Mod rows (`track.mods`) to patch-module knobs: a row's `dst` is `'<dev>:<param>'` and `cv-mods.js destOk`/`classOf` decide per model/param (Serum params by `DESTS`, classic knobs by the checked-in class table that `tests/cv-mods.test.mjs` verifies against a perturbation run); knobs of patch modules need their own entries (or a patch-level rule) — not verified how `dev/part:param` ids would resolve.

## 6. Risks and constraints

**CPU (bench).**
- Gates in force: V8 and JSC A/B within 1.3 % per row, iPad rows within 5 % of `"ipad1d"` (HANDOVER §3 / ROADMAP "Gates"), JSC ×1 ms-timer quantisation of "worst" columns (0.375 = one tick). New kind ⇒ new rows (`bench-scenarios.mjs` + `bench.html`) with node and iPad targets; today only c3 (0.010 iPad) approximates a modular voice.
- A generic interpreter will cost more than the hand-inlined `AVoice` [I]: if a typed-array block-per-module design reaches ~1–3× c3 per voice of equal topology, a 25-module mono patch is ≈ 0.03–0.06 iPad at OS 4 [I, unmeasured]; voice duplication multiplies it. Measure in a spike before choosing the evaluation strategy; per-module CPU cannot be read with a 1 ms timer (`stats` uses `Date.now`, `engine.js:4294`) — only per-Inst totals, or sample counters [V/I]. CPU safeguard (`main.js:1199+`, `lowerOS`) halves the OS of the heaviest Inst — changes sound of FM/feedback (aliasing and feedback delay depend on OS) [I].
- Self-oscillation / feedback patches never go quiet: idle skip and the 2 s quiet rule need a patch-specific rule; `panicFade`, `osFade`, de-click tails (`fadeN` ≈ 3 ms) must be provided by the new kind's `fadeOut`, like `fadeDrums`.

**Goldens / bit-exactness (never loosen).**
- `modular` model + its map + presets stay (golden-classic frozen list, golden-graph family filter `:24`, `:171`; both would fail on removal/rename). A new family must get its own filter, its own freeze `tests/ref-9` (as ref-7a..7d: verbatim copies of the new script + engine.js with a sha256 manifest) and a golden harness entry (`golden-harness.mjs:28`, `dsp-scope.mjs:39`).
- Existing `engine.js` edits (new kind, fields in `Inst.init`, `setOS` hook, `warmUp` rounds, `anyActive`, `fadeOut`, `msg`) must keep ref-p1, ref-1c and ref-7a/b/c/d bit-identical (`golden-classic/graph/drums/606/909/sdsv`). Adding fields to `Inst` shifts hidden class/inlining (V8 and JSC) — the 7a–8 stages kept it neutral; measure each time.
- Frozen-sound rule: the user's drums approach (build on measured targets, don't block on sign-off) applies; the Moog module sounds are "our own models" from circuit values, no recordings, no Xfer/Moog logos (CLAUDE.md: original art, no logos).

**Lint/accessors/format.**
- Accessor ratchet: no new `t.model/vals/preset/seq/fx` or `isSx(`/`fxOf(` sites; use device views. Version/precache hygiene: every import/URL `?v=N`, `node tools/precache.mjs --write`, new modules reachable from `main.js`, new DSP script in `DSP_FILES` (a missing worklet script must fail soft like `drumsErr`, `main.js:1029`).
- Format caps (64 devices, 256 wires, 256 lay keys, PORT_ID port ≤ 8 chars lowercase) constrain the "modules as devices" option and the port naming (`out`, `in`, `fm`, `sync`, `pwm`… ≤ 8 chars; no uppercase in ports; module part names may use `[a-zA-Z0-9]`).
- Schema bump 12 + `STEPS[11]` (identity), `tests/cv-migrate.test.mjs`, a build at schema 11 must open a 12 read-only (appstore gate), `toV1` lost-line.

**Rendering/DOM/touch.**
- iPad DOM envelope: ≤ ~1 900 painted elements is the only P+ scene; 2.8 k hardware controls were accepted with single 50–90 ms frames; two heavy scenes failed hard. A 30-module patch is ≈ 1.2 k controls + 4 k hidden face-SVG elements [I]: check hidden-face DOM (could be released once rasterised) and jack dots (each a DOM element + a 44·ik hit pseudo-element) — a spike `?m9=1` in the S0 style before building.
- Sub-0.56 jack overlap and `READ_K 0.5` sleeping controls (see §4.2). Two-finger protection and native zoom rules (HANDOVER §2) apply to patching: a cable drag is a one-finger gesture; cords must not break "two fingers win".
- Cords over faces: touch stealing; overlap rule (module over module → dom tier) is likely common in a rack-like layout; "NO module collision" (user, 2026-10-18) stays → expect overlapping modules during drags (dom-tier bitmap).
- 3R (GPU module painter) is parked; stage 9 is the case where "soft while pinching" DOM parts multiply — mention to the lead.

**What makes "any output into any input at audio rate" hard** [consolidated]:
1. Audio-rate **feedback** needs the SCC/unit-delay compile (§2.5) and per-edge stability limits; the cheap block-wise evaluation applies only to the acyclic part.
2. **Dispatch cost**: per-sample module calls box doubles and defeat inlining (`engine.js:68`); the 4-frame span grid makes spans as short as 4·OS samples (16–32) → per-module per-span overhead matters (30 modules × 1 500 spans/s ≈ 45 k calls/s fine, but state load/store per call must be cheap).
3. **Bandlimiting**: FM/sync/ring/rectified signals at audio rate alias; OS 4 helps only partly; polyBLEP with varying dt under FM is an approximation (AVoice does it for `fm01`/`fm10`, `:731`, `:754`); true sync BLEP is a specific path (`slave`, `:493`).
4. **Signal kinds**: audio vs CV vs gate/trigger (S-trigger/V-trigger polarity), 1 V/oct scaling, exponential vs linear FM inputs, DC-coupled CV through AC-coupled paths: needs a unit convention (volts at the OS rate as in `dr-808.js` "units are volts") and per-input scaling; the project's `data-kind` currently has only `audio/mod/warp/note`.
5. **Voicing** (§3): global vs per-voice scope inference; the user asked "any output into any input".
6. **Modulation interplay**: ModCore is control-rate (§2.2); patch-module knobs inside the graph would be addressed by `dev/part:param` ids that `cv-mods destOk/classOf` do not know.
7. **Sequencer/clock modules** (960, 911A trigger delay, 962 sequential switch) need sample-accurate clocks and the transport anchoring path; the 4-frame event grid is fine for gates, not for audio-rate clocking [I].
8. **Determinism & bounce**: the patch evaluation must be a function of the absolute frame clock and module ids/salts (`setSalt`, SPEC §6.2.1) so offline = live; recompile must preserve module state by id and cross-fade (no click) — drum machine and FXRack precedents exist.
9. **Undo/History** snapshots of a large patch record and the Mod list/inspector extended to patch rows; per-module `CPU` badges (`cvCpu`, `main.js` `per` stats) cannot show 30 numbers.
10. **Process**: stage size — new script (~3–6 k lines by the drum precedent: dr-808 4 468), compile module, ~20–30 module types × (model entry, panel layout, tokens, art), keyboard/sequencer, cords renderer, Sources view, cost/bench, tests/refs. The leaner process (CLAUDE.md) applies: contract first, builders in worktrees reset to the base, two reviewers, goldens bit-identical, one test file at a time.

## 7. Not measured / assumptions to confirm before the contract
- Interpreter cost of a typed-array program on V8 and JSC vs c3; hidden-DOM and jack-dot cost of 30 modules on the iPad (S0-style spike); cord physics on WebKit; `Date.now()`-free per-module CPU option.
- Whether the existing `modular` should be hidden from the Sources tray once the new one exists (Sources view lists by `CLASSIC` filter, `cv-tray.js:346+`; `SRC_VIEWS` is data: a "Modular" view is one more entry, like Drums/Controllers).
- Product choices to put to the user: mono vs voice-duplicated vs paraphonic; whether 951 keyboard is a module (it is a separate case today, 1i); fan-out of outputs (mults); where cords hang; module sizes real (2 px/mm) vs enlarged jacks on touch.

## 8. Ten-line summary
1. Today's Moog Modular = one `models.js` entry (`models.js:49–92`) mapped onto the generic mono analog `AVoice` (`engine.js:374/556`); its "modules" are scalars of one patch — nothing per-module to reuse except `Env`, `Ladder`, `HP4`.
2. Its panel already draws 80 real jacks (all inert, art only) over 15 module panels; `inert:'later'` exists but gives no DOM jack/port (`cv-panel.js:175–177,424–427`).
3. Goldens pin it (`golden-classic` frozen 12-model list `:19`, `golden-graph` family filter `:24/:171`, ref-p1/ref-1c + ref-7a..7d engines): keep model `modular` as is; new instrument = new family/model + own ref freeze.
4. Best host: a new `Inst` kind + new classic worklet script run at the OS rate inside the track's node (drum-family precedent: `dr-808.js`, `renderDrums`, `DSP_FILES`); feedback = SCC stepped per sample with a unit delay (5.2 µs @192 kHz); per-module AudioNodes cannot do audio-rate feedback (≥128-frame delay, Float32, no OS).
5. Mono today (`mode:'mono'`, low-note priority, `monoPlay`); a patch could be mono (faithful), voice-duplicated (needs per-voice/global scope inference, N× cost) or paraphonic — a product decision.
6. Canvas jacks are edge/inline DOM dots with `out→in` ports and the track graph forbids fan-out/cycles (`cv-graph.js:229–237`); cables are béziers under the modules with no sag — cord physics, over-face layer and in-face jacks are all new (inline-jack anchors exist as a base).
7. Save as parts-of-one-instrument (Serum/Pads precedent): `synth` device + `dev.patch` record, lay keys `iN/<mid>`, schema 12 additive; caps 64 devices / 256 wires / 256 lay keys / port ≤ 8 chars; accessor ratchet forbids new v1-field reads.
8. Rendering: faces on GPU are cheap per small module; the risk is DOM (controls + jacks): iPad P+ only to 1 866 painted elements, five hardware panels (2.8 k controls) borderline, t2/t3 failed; jack pitch 39 px vs 44 px hit circles overlaps below k ≈ 0.56 (READ_K 0.5).
9. CPU: only c3 (0.010 iPad) approximates a voice; an interpreter's cost, voice duplication, JIT warm-up per module type and per-module CPU (1 ms timer) are unmeasured — a spike for engine cost and a `?m9=1` rendering spike should precede the contract.
10. Biggest hard parts of "any output into any input": audio-rate feedback/stability, dispatch cost under 4-frame spans, bandlimiting FM/sync, signal-kind conventions (volts, gates), voice scope, ModCore being control-rate, and keeping every frozen golden bit-identical.
