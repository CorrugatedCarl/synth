/* mod-core.js — ModCore, the track-level modulation core of the canvas (SPEC-canvas §7.6; IMPL-2b §2). A classic
 * AudioWorklet script (globalThis.ModCore), loaded after the sx-*.js / serum-dsp.js scripts and before engine.js; the Track
 * creates one per track on its first {t: 'mods'} (none without: N1 — no object, no code on the audio path).
 *
 * What it is: a voice-less Serum modulation state (SerumDSP.attach on a shim processor: OS 1, CH 4, fs = base, no audio)
 * driven by a SYNTHETIC Serum CP the host compiles from the track's modulator modules (processor LFOs = the GLOBAL ones,
 * ENV 2–4 / per-note LFOs = the PER NOTE ones, chaos, macros) plus ONE pseudo-voice (an SxMod.ModV on a shim voice, no
 * output) that ModCore gates from the Track's notes (legato while other keys are held, release when the last lifts) and
 * ticks itself (follow / sources / matrix / advance per chunk). Every cable to a non-Serum target (a classic slot, a span
 * setter, a panel knob) is a synthetic row of that CP into a scratch V-scope destination `vi`: the pseudo-voice's matrix
 * evaluates the full row formula (curve / CT curve / slew / aux / bipolar) and ModCore reads `V.mod.off[vi]` back at the
 * span ends (chunk 0 and nCh − 1: every such target is span-rate). Cables to Serum knobs go through the 16 EXT slots: per
 * chunk source values in MC.ext (ext k, chunk c at [k·32 + c]) that the Track copies into each Serum's g rows 62–77
 * before its own begin (SerumDSP.extIn; the Serum's injected matrix rows read `ext<k>`, IMPL-2b §3.2) — the same code,
 * the same clock, 4-base-frame chunks: a GLOBAL LFO through ext renders bit-identically to the Serum's own MONO LFO (N2).
 *
 *   globalThis.ModCore = { VER, NEXT 16, NVAL 32, create(T, base, sN?) → MC }
 *   MC.setRows(m)         the {t: 'mods'} payload (IMPL-2b §2.2; allocation allowed: between quanta):
 *                           cp, ct           the synthetic CP and its CT (ct: {key, parts} | a full CT | null)
 *                           bpm              the song tempo the CP's BPM LFOs run at while stopped (default 120)
 *                           rows[]           {id, src, vi, dst: {kind: 'cls' | 'set' | 'fx', inst?, chain?, slot?, field?, fx?, key?},
 *                                             xfer?, perNote?} — src: the CP source index the row reads; vi: the CP row's
 *                                             scratch destination (its mDst; absent: the j-th unclaimed CP row with that
 *                                             src, in CP order); xfer (cls / set rows, lane A2's cv-mods.xferOf): {a, b,
 *                                             x0} (T(x) = a + b·x) or {tab: 129 values over the knob's mod space 0…1, x0}
 *                                             with x0 = the knob's position in mod space. The rows of one KNOB on one
 *                                             target (inst + slot, or inst + field; the same transfer) sum their outputs
 *                                             x = V.mod.off[vi] (the synthetic row already applied amt / curve / slew /
 *                                             aux / bi): Σ; the group's offset is T(clamp01(x0 + Σ)) − T(x0) in slot /
 *                                             field units — a cls slot sums its groups' offsets, a set field gets the
 *                                             EFFECTIVE value T_first(x0) + Σ group offsets, an fx row adds x itself
 *                                             (FX-context units, clamped by the rack). Several rows may share a vi (one
 *                                             cable, several targets: read once, applied per row). Without xfer: T(x) =
 *                                             x, x0 = 0
 *                           xfer             per-row transfers by row id or by index (when the row carries none)
 *                           ext[]            {k: 1…16, src}: the CP source each ext slot carries
 *                           vals[]           the value table's initial values: [{k, src, v, id}] (lane B) or v by index
 *                           keep[]           (the keep-alive sources; informational — the CP already holds their rows)
 *   MC.ctl(k, v)          one value-table entry: k 0–7 the macros (the CP's macro lane, smoothed by SxMod as Serum
 *                         smooths macros), k 8–23 the value sources (ModCore's own ext inputs ext1…16 = CP sources
 *                         62–77, smoothed per chunk with the same coefficient), k 24–31 stored (no source carries them:
 *                         IMPL-2b §9 lane A1 — the table has 24 live entries)
 *   MC.noteOn(n, v01, held, ch) / MC.noteOff(n, held)   held = the OTHER keys still down (legato / the last release)
 *   MC.transport(playing) re-seeding as SerumDSP.transport (N5: phases are functions of the frame clock / transport)
 *   MC.span(F, n, nCh)    once per Track span BEFORE any Inst renders: begin, the pseudo-voice, then
 *                           MC.ext         Float64Array(16·32)
 *                           MC.cls0[inst] / MC.cls1[inst]   Float64Array(sN): span-start / span-end slot offsets
 *                           MC.setv[inst]  [{field, v}] effective values of the cabled apply / proc fields (span end)
 *                           MC.fxv[chain]  Float64Array(MAXFX) FX-context offsets; MC.fxHi[chain] its high-water mark;
 *                                          MC.fxKey[chain] the layout key the rows were compiled against (or undefined)
 *                           MC.fxMon(chain)   Float32Array(fxHi) copy of MC.fxv[chain] for the chain's monitor message (null without rows)
 *                           MC.has[inst]   1 for every classic Inst with cls / set rows (the Track's modSpan gate)
 *                           (a payload with no rows and no per-note ext source never ticks the pseudo-voice: begin alone)
 *                           MC.instRows[inst]   that Inst's payload rows ({…row, slot | field, xfer}) in payload order —
 *                                          the Track hands them to Inst.modRows (lane A2) after setRows, null when gone
 *   MC.live               Float32Array(16): the last chunk's value of the ModCore source slots, [lfo 1…10, env 2, 3, 4, 1,
 *                         chaos 1, 2], 0…1 (a chaos source is bipolar: (x + 1) / 2), written per span (the Track posts it
 *                         as {t: 'smon', mc} to a 'mods' monitor subscription: the modules' live meters)
 *   MC.stats() → {lfos, envs, rows, ext, spans, half}   (spans: the spans evaluated since the payload)
 *   ModCore.warmPayload(SxBase) → a {t: 'mods'} payload on a hand-built CP (2 GLOBAL LFOs, a PER NOTE LFO, an ENV, chaos,
 *                         a macro, a value source; cls / set / fx rows, one ext slot) for Track.warmUp's ModCore round
 *
 * Levers (IMPL-2b §9.0 Q4 → N4): the host parks unused LFO slots FREE + MONO (one offSkip per span); rows are read at the
 * span ends only (matrix at chunks 0 and nCh − 1 — with the mono-context slew convention: the chunk-0 evaluation advances
 * no slew time (dt 0: the span starts where the last one ended), the span-end one the whole span (dt nCh·dtC), so a
 * rise / fall row reaches its target in SLEW_T whatever the span length, review E1); MC.half (default on): while no ext
 * slot carries a per-note source the pseudo-voice ticks every second chunk (dt doubled, spans with an odd chunk count
 * tick every chunk; the span-end sources are read at chunk nCh − 1 whatever the tick, review E4; a span-parity change
 * costs one setDt — its lKs refill re-derives the LFO smoothing coefficients, ≈ +10 % on a sequencer splitting spans
 * 32 / 31, review P6); with no rows and no per-note ext source it is not ticked at all (MC.pvOn 0: the ext slots read g —
 * begin alone). Nothing allocates in span / noteOn / noteOff / ctl (tests/modcore.test.mjs, the noAlloc technique).
 * A payload setRows rejects (no cp, a CP the DSP refuses) leaves the previous state untouched (validated before anything
 * is written, review E6).
 */
(() => {
  'use strict';
  try {
    const VER = 1, NEXT = 16, NVAL = 32, MAXCH = 32, NSRC = 78, N_LFO = 10, N_MACRO = 8, MAXFX = 8 + 48 * 24, NLIVE = 16;
    const S_EXT0 = 62, S_CHAOS1 = 17, S_N_DEF = 32;
    const ESRC = Int8Array.of(2, 3, 4, 34), LSRC = Int8Array.of(5, 6, 7, 8, 9, 10, 11, 12, 35, 36);
    const LYSRC = Int8Array.of(37, 38, 39, 40, 41, 42, 43, 44, 45, 46);
    const K_VOICE = 0, K_FREE = 2, K_MONO = 3;
    // sources whose value lives on the pseudo-voice (never in g): ENV 1–4, velo, note, pat, noise, rand 1/2, alt 1/2,
    // mpe x/y/z, relvel, randd, the audio taps, vidx, vmod 1/2 (per-voice LFOs and per-voice chaos: by the CP, setRows)
    const PER = new Uint8Array(NSRC);
    for (const k of [2, 3, 4, 34, 13, 14, 16, 19, 20, 21, 22, 23, 29, 30, 31, 32, 51, 52, 53, 54, 55, 56, 57, 59, 60, 61]) PER[k] = 1;
    const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);     // NaN → 0
    function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }
    function fnv1a32(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
    const fin = x => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;

    // the shim voice the ModV runs on (the TV shape of tests/sx-mod.test.mjs; serum-dsp's note-on prologue: the processor
    // flip-flop and the voice PRNG streams, then ModV.noteOn; no keymap, no unison, no audio)
    class PseudoVoice {
      constructor(proc, sx, M) {
        this.proc = proc; this.sx = sx; this.i = 0; this.dt = proc.CH / proc.fs;
        this.r = 1; this.r2 = 1; this.gate = false; this.active = false; this.note = 60; this.vel = 0; this.onN = 0; this.nLast = 0;
        this.stamp = 0; this.fresh = 0; this.played = 0; this.hid = 0;
        this.mod = new M.ModV(this);
      }
      rnd() { this.r = xorshift(this.r) || 1; return this.r / 4294967296; }
      rnd2() { this.r2 = xorshift(this.r2) || 1; return this.r2 / 4294967296; }
      noteOn(n, vel, legato, other) {
        const sx = this.sx, wasActive = this.active;
        this.note = n; this.vel = vel; this.gate = true;
        legato = legato && wasActive;
        sx.alt = sx.alt ? 0 : 1;
        if (!legato) {
          sx.rng = xorshift(sx.rng) || 1;
          const seed = sx.rng ^ (0x9E3779B9 * (this.i + 1));
          this.r = xorshift(seed) || 1; this.r2 = xorshift((seed ^ 0x85EBCA6B) >>> 0) || 1;
        }
        this.mod.noteOn(n, vel, legato, null, 0, null, other);
        this.active = true; this.played = 1; this.fresh = 1; this.stamp++;
      }
      noteOff(rv) { this.gate = false; this.mod.noteOff(rv); }
    }

    class ModCore {
      constructor(T, base, sN) {
        const SD = globalThis.SerumDSP, M = globalThis.SxMod;
        if (!SD || !M) throw new Error('ModCore: SerumDSP / SxMod missing');
        this.T = T; this.base = base > 0 ? +base : 48000; this.sN = sN > 0 ? sN | 0 : S_N_DEF;
        const id = typeof T.trackId === 'string' ? T.trackId : '';
        const shim = {
          base: this.base, OS: 1, fs: this.base, CH: 4, p: null, ct: null, voices: [], held: [], sx: null, vcN: 0,
          seedSalt: id ? fnv1a32(id) : 0, bpm: 120, pat: null, patSeen: false, mpe: null, seqMacro: new Float64Array(N_MACRO).fill(NaN),
          offline: !!T.offline,
          get wheel() { return +T.wheel || 0; }, get at() { return +T.at || 0; }, get bendRaw() { return +T.bendRaw || 0; },
          songBeat() { return T.songBeat(); },
        };
        this.shim = shim;
        this.sx = SD.attach(shim);
        if (this.sx.mod === null) throw new Error('ModCore: SxMod did not attach');
        this.V = new PseudoVoice(shim, this.sx, M);
        shim.voices.push(this.V);
        this.ok = 0; this.cp = null;
        this.ext = new Float64Array(NEXT * MAXCH); this.extSrc = new Int8Array(NEXT); this.extN = 0;
        this.extPerK = new Int8Array(NEXT); this.extPerN = 0;   // the ext slots fed by the pseudo-voice (per-note sources)
        this.vT = new Float64Array(NVAL); this.vS = new Float64Array(NVAL); this.vUse = new Uint8Array(NVAL);
        this.rows = []; this.tgts = []; this.off0 = new Float64Array(0);
        this.cls0 = Object.create(null); this.cls1 = Object.create(null); this.setv = Object.create(null); this.has = Object.create(null); this.instRows = Object.create(null);
        this.fxv = Object.create(null); this.fxHi = Object.create(null); this.fxKey = Object.create(null); this.fxMo = Object.create(null);
        this.clsIds = []; this.fxIds = [];
        this.half = true; this.halfOn = 0; this.pvOn = 0;
        this.live = new Float32Array(NLIVE); this.spans = 0;
      }
      /* ---- the payload (allocation here only; a rejected one leaves the previous state as it was) ---- */
      setRows(m) {
        if (!m || typeof m !== 'object' || !m.cp || typeof m.cp !== 'object') throw new Error('ModCore: no cp');
        const SD = globalThis.SerumDSP, shim = this.shim, sx = this.sx, mod = sx.mod;
        const rows = Array.isArray(m.rows) ? m.rows : [], ext = Array.isArray(m.ext) ? m.ext : [], vals = Array.isArray(m.vals) ? m.vals : null;
        const bpm = fin(m.bpm) && m.bpm > 0 ? +m.bpm : 120;
        // the CP first: SD.sync refuses before it touches the state (cpOk), so a refusal puts the shim back as it was
        const p0 = shim.p, ct0 = shim.ct, bpm0 = shim.bpm;
        shim.p = { serum: m.cp, seq: null, bpm }; shim.bpm = bpm;
        shim.ct = m.ct && typeof m.ct === 'object' ? m.ct : null;
        if (!SD.sync(shim)) { shim.p = p0; shim.ct = ct0; shim.bpm = bpm0; if (this.ok !== 0) sx.ok = 1; throw new Error('ModCore: the CP was rejected'); }
        this.cp = m.cp;
        // the value table: macros 0–7 as the CP's macro lane (NaN = the CP's own base), 8–31 as ModCore's smoothed inputs
        if (vals) {
          for (let j = 0; j < vals.length; j++) {
            const e = vals[j], obj = e !== null && typeof e === 'object', k = obj ? e.k | 0 : j, v = obj ? e.v : e;   // ({k, src, v, id} or v by index)
            if (!fin(v) || k < 0 || k >= NVAL) continue;
            if (k < N_MACRO) shim.seqMacro[k] = clamp01(v); else this.vT[k] = clamp01(v);
          }
        }
        if (this.ok === 0) this.vS.set(this.vT);                 // (a first payload starts at its values; later ones glide)
        // ext slots
        const es = this.extSrc, pk = this.extPerK, vu = this.vUse;
        es.fill(0); vu.fill(0);
        let extN = 0, extPerN = 0;
        for (const e of ext) {
          if (!e || typeof e !== 'object') continue;
          const k = e.k | 0, s = e.src | 0;
          if (k < 1 || k > NEXT || s <= 0 || s >= NSRC) continue;
          if (es[k - 1] === 0) extN++;
          es[k - 1] = s;
          if (s >= S_EXT0) vu[8 + s - S_EXT0] = 1;
        }
        for (let k = 0; k < NEXT; k++) if (es[k] !== 0 && this.perNote(es[k])) pk[extPerN++] = k;
        this.extN = extN; this.extPerN = extPerN;
        this.pvOn = rows.length > 0 || extPerN > 0 ? 1 : 0;   // (nothing reads the pseudo-voice: ext from global sources only → begin alone)
        this.ext.fill(0);
        // rows: the CP row each payload row reads back (vi), its target (one per inst + slot / field: the rows sum) and
        // the target's transfer (the first row's)
        const claimed = new Uint8Array(mod.mN), R = [], TG = [];
        const cls0 = Object.create(null), cls1 = Object.create(null), setv = Object.create(null), has = Object.create(null), instRows = Object.create(null);
        const fxv = Object.create(null), fxHi = Object.create(null), fxKey = Object.create(null), tgtMap = Object.create(null);
        const xferOf = (row, j) => {
          let x = row.xfer;
          if ((!x || typeof x !== 'object') && m.xfer && typeof m.xfer === 'object') x = Array.isArray(m.xfer) ? m.xfer[j] : m.xfer[row.id];
          return x && typeof x === 'object' ? x : null;
        };
        for (let j = 0; j < rows.length; j++) {
          const row = rows[j];
          if (!row || typeof row !== 'object' || !row.dst || typeof row.dst !== 'object') continue;
          const src = row.src | 0, d = row.dst;
          if (src <= 0 || src >= NSRC) continue;
          let vi = fin(row.vi) ? row.vi | 0 : -1;
          if (vi < 0) { // the j-th unclaimed CP row with this source, in CP order
            for (let r = 0; r < mod.mN; r++) if (claimed[r] === 0 && mod.mSrc[r] === src && (mod.mCtx[r] & 1) !== 0) { claimed[r] = 1; vi = mod.mDst[r]; break; }
          }
          if (!(vi >= 0 && vi < 429)) continue;
          const kind = d.kind === 'cls' ? 0 : d.kind === 'set' ? 1 : d.kind === 'fx' ? 2 : -1;
          if (kind < 0) continue;
          const e = { vi, kind, id: '', fx: -1, tgt: null, src };
          if (kind === 2) {
            if (typeof d.chain !== 'string' || !d.chain || !(d.fx >= 0 && d.fx < MAXFX)) continue;
            e.id = d.chain; e.fx = d.fx | 0;
            if (fxv[e.id] === undefined) { fxv[e.id] = new Float64Array(MAXFX); fxHi[e.id] = 0; fxKey[e.id] = typeof d.key === 'string' ? d.key : undefined; }
            if (e.fx + 1 > fxHi[e.id]) fxHi[e.id] = e.fx + 1;
          } else {
            if (typeof d.inst !== 'string' || !d.inst) continue;
            e.id = d.inst;
            const slot = kind === 0 ? d.slot | 0 : -1, field = kind === 1 ? d.field : '';
            if (kind === 0 && !(d.slot >= 0 && d.slot < this.sN)) continue;
            if (kind === 1 && (typeof field !== 'string' || !field)) continue;
            const x = xferOf(row, j), xs = x ? (fin(x.x0) ? +x.x0 : 0) + '/' + (x.tab ? 'T' + (+x.tab[0]) + '/' + (+x.tab[64]) + '/' + (+x.tab[128]) : (+x.a) + '/' + (+x.b)) : '';
            const fkey = e.id + '\u0000' + field, key = e.id + '\u0000' + kind + '\u0000' + (kind === 0 ? slot : field) + '\u0000' + xs;
            let tg = tgtMap[key];
            if (tg === undefined) {
              let fe = null;
              if (kind === 1) { fe = tgtMap[fkey]; if (fe === undefined) { fe = tgtMap[fkey] = { field, v: 0, b0: 0, n: 0 }; (setv[e.id] || (setv[e.id] = [])).push(fe); } }
              tg = tgtMap[key] = { id: e.id, kind, slot, field, a: 0, b: 1, tab: null, x0: 0, t0: 0, s0: 0, s1: 0, fe };
              if (x) {
                if (x.tab && typeof x.tab === 'object' && x.tab.length >= 129) {
                  const t = new Float64Array(129);
                  for (let i = 0; i < 129; i++) { const v = +x.tab[i]; t[i] = v === v ? v : 0; }
                  tg.tab = t;
                } else { tg.a = fin(x.a) ? +x.a : 0; tg.b = fin(x.b) ? +x.b : 1; }
                tg.x0 = fin(x.x0) ? clamp01(+x.x0) : 0;
              }
              tg.t0 = xf(tg, tg.x0);
              TG.push(tg);
              if (kind === 0) { if (cls0[e.id] === undefined) { cls0[e.id] = new Float64Array(this.sN); cls1[e.id] = new Float64Array(this.sN); } }
              else if (fe.n++ === 0) { fe.b0 = tg.t0; fe.v = tg.t0; }   // (the field's base: the first group's T(x0))
            }
            e.tgt = tg;
            has[e.id] = 1;
            // (lane B's `slot` is the synthetic matrix slot: a set row must not reach Inst.modRows with it — slot −1, review U3)
          (instRows[e.id] || (instRows[e.id] = [])).push(Object.assign({}, row, kind === 0 ? { slot } : { slot: -1, field }, { xfer: x }));
          }
          if (src >= S_EXT0) vu[8 + src - S_EXT0] = 1;
          R.push(e);
        }
        this.rows = R; this.tgts = TG; this.off0 = new Float64Array(R.length);
        this.cls0 = cls0; this.cls1 = cls1; this.setv = setv; this.has = has; this.instRows = instRows; this.fxv = fxv; this.fxHi = fxHi; this.fxKey = fxKey;
        this.clsIds = Object.keys(cls0); this.fxIds = Object.keys(fxv);
        const fxMo = Object.create(null);
        for (let j = 0; j < this.fxIds.length; j++) fxMo[this.fxIds[j]] = new Float32Array(fxHi[this.fxIds[j]]);   // (the monitor's copy, fxMon)
        this.fxMo = fxMo;
        this.halfOn = this.half && extPerN === 0 ? 1 : 0;
        this.ok = 1;
      }
      // a source whose value lives on the pseudo-voice: ENV / note-on values, per-voice LFOs (RETRIG / ENV / FREE on the
      // voice), per-voice chaos
      perNote(s) {
        if (PER[s] !== 0) return true;
        const m = this.sx.mod;
        for (let l = 0; l < N_LFO; l++) if ((s === LSRC[l] || s === LYSRC[l])) { const k = m.lKind[l]; return k === K_VOICE || k === K_FREE; }
        if (s === S_CHAOS1 || s === S_CHAOS1 + 1) return m.chaosMono[s - S_CHAOS1] === 0;
        return false;
      }
      /* ---- values, notes, transport (between quanta; no allocation) ---- */
      ctl(k, v) {
        k = k | 0;
        if (k < 0 || k >= NVAL) return;
        v = clamp01(+v);
        if (k < N_MACRO) this.shim.seqMacro[k] = v; else this.vT[k] = v;
      }
      noteOn(n, v01, held, ch) {
        if (this.ok === 0) return;
        const other = held > 0;
        this.V.noteOn(+n, clamp01(+v01), other, other);
      }
      noteOff(n, held) {
        if (this.ok === 0 || held > 0 || !this.V.gate) return;
        this.V.noteOff(0.5);
      }
      transport(playing) {
        if (this.ok === 0) return;
        globalThis.SerumDSP.transport(this.shim, !!playing);
      }
      /* ---- the span (no allocation) ---- */
      span(F, n, nCh) {
        if (this.ok === 0) return;
        const SD = globalThis.SerumDSP, shim = this.shim, sx = this.sx, m = sx.mod, V = this.V, mv = V.mod;
        SD.begin(shim, n);
        if (sx.ok === 0) return;
        if (nCh > MAXCH) nCh = MAXCH;
        // (1) the value sources 8–23 into ModCore's own ext rows of g (62–77), glided per chunk as the macros are
        const g = m.g, kM = m.kM, vT = this.vT, vS = this.vS, vu = this.vUse;
        for (let j = 0; j < NEXT; j++) {
          if (vu[8 + j] === 0) continue;
          const o = (S_EXT0 + j) * MAXCH, t = vT[8 + j];
          let x = vS[8 + j];
          if (x === t) { for (let c = 0; c < nCh; c++) g[o + c] = t; continue; }
          for (let c = 0; c < nCh; c++) { x += (t - x) * kM; g[o + c] = x; }
          if (x - t < 1e-12 && t - x < 1e-12) x = t;             // (settle exactly: no endless glide)
          vS[8 + j] = x;
        }
        // (2) the pseudo-voice: its chunk loop (every second chunk when it feeds no per-chunk target: halfOn), the rows at
        // the span ends (the span-end sources read at chunk nCh − 1 whatever the tick; the slew of a rise / fall row
        // advanced by the whole span at the end and not at all at chunk 0: the mono-context convention, RXD = this.dt),
        // the per-note ext slots per chunk
        const half = this.halfOn !== 0 && nCh >= 2 && (nCh & 1) === 0 ? 2 : 1, dt = half * m.dtC, dtS = nCh * m.dtC, cE = nCh - 1;
        if (mv.dt !== dt) mv.setDt(dt, true);
        const R = this.rows, nR = R.length, off = mv.off, O0 = this.off0, ext = this.ext, es = this.extSrc, pk = this.extPerK, npk = this.extPerN, vs = mv.src;
        let act = V.active, wrote = 0;
        if (this.pvOn !== 0) for (let c = 0; c < nCh; c += half) {
          const last = c + half >= nCh, fr = (c + half) / nCh;
          if (act && !V.gate && V.fresh === 0 && mv.envsIdle()) { V.active = false; act = false; mv.stop(); }
          if (act) mv.follow(fr);
          if (act || c === 0 || last) mv.sources(last ? cE : c);
          if (c === 0 || last) { mv.dt = last ? dtS : 0; mv.matrix(fr); mv.dt = dt; if (c === 0) for (let r = 0; r < nR; r++) O0[r] = off[R[r].vi]; }
          if (act) {
            mv.advance(c); V.fresh = 0;
            if (npk !== 0) { for (let j = 0; j < npk; j++) { const k = pk[j]; ext[k * MAXCH + c] = vs[es[k]]; } wrote = c + 1; }
          }
        }
        if (m.recent === V && V.active) mv.post();
        // (3) ext: global sources from g, per-note ones from the pseudo-voice (its last values once it ended)
        for (let k = 0; k < NEXT; k++) {
          const s = es[k];
          if (s === 0 || PER[s] !== 0) continue;
          const o = k * MAXCH, gs = s * MAXCH;
          for (let c = 0; c < nCh; c++) ext[o + c] = g[gs + c];
        }
        if (npk !== 0) for (let j = 0; j < npk; j++) { const k = pk[j], x = vs[es[k]], o = k * MAXCH; for (let c = wrote; c < nCh; c++) ext[o + c] = x; }
        // the live meters: the last chunk of every source slot — a processor LFO (kinds K_OFF / K_MONO: odd) / mono chaos
        // from g, a per-voice one and the ENVs from the pseudo-voice's source vector (its last read: chunk nCh − 1,
        // whether or not it is active; a per-voice source is only ever read when the pseudo-voice runs, pvOn)
        const LV = this.live, lk = m.lKind, ev = mv.eV;
        for (let l = 0; l < N_LFO; l++) { const s = LSRC[l]; LV[l] = (lk[l] & 1) !== 0 ? g[s * MAXCH + cE] : vs[s]; }
        LV[10] = ev[1]; LV[11] = ev[2]; LV[12] = ev[3]; LV[13] = ev[0];
        for (let k = 0; k < 2; k++) { const s = S_CHAOS1 + k, x = m.chaosMono[k] !== 0 ? g[s * MAXCH + cE] : vs[s]; LV[14 + k] = 0.5 * (x + 1); }
        // (4) the rows: the sums per target, then slot offsets (start / end) and setter values through the transfer,
        // FX-context offsets as they are
        const TG = this.tgts, nT = TG.length, C0 = this.cls0, C1 = this.cls1, ids = this.clsIds;
        for (let j = 0; j < ids.length; j++) { C0[ids[j]].fill(0); C1[ids[j]].fill(0); }
        for (let j = 0; j < nT; j++) { const tg = TG[j]; tg.s0 = 0; tg.s1 = 0; if (tg.fe !== null) tg.fe.v = tg.fe.b0; }
        const FV = this.fxv, FH = this.fxHi, fids = this.fxIds;
        for (let j = 0; j < fids.length; j++) FV[fids[j]].fill(0, 0, FH[fids[j]]);
        for (let r = 0; r < nR; r++) {
          const e = R[r], x1 = off[e.vi];
          if (e.kind === 2) { FV[e.id][e.fx] += x1; continue; }
          const tg = e.tgt;
          tg.s0 += O0[r]; tg.s1 += x1;
        }
        for (let j = 0; j < nT; j++) {
          const tg = TG[j], d1 = xf(tg, clamp01(tg.x0 + tg.s1)) - tg.t0;
          if (tg.kind === 0) { C0[tg.id][tg.slot] += xf(tg, clamp01(tg.x0 + tg.s0)) - tg.t0; C1[tg.id][tg.slot] += d1; } else tg.fe.v += d1;
        }
        this.spans++;
      }
      // (2b halos) the chain's FX-context offsets of the last span, for its monitor message: a Float32Array(fxHi) (the same
      // array every call, filled here — postMessage copies it), or null for a chain without rows; the host's live dot of a
      // rack knob = clamp(base + mo[fx index])
      fxMon(id) {
        const v = this.fxv[id], o = this.fxMo[id];
        if (v === undefined || o === undefined) return null;
        for (let k = 0; k < o.length; k++) o[k] = v[k];
        return o;
      }
      stats() {
        const m = this.sx.mod;
        let lfos = 0, envs = 0;
        if (this.ok !== 0) {
          for (let l = 0; l < N_LFO; l++) if ((m.lUse & (1 << l)) !== 0) lfos++;
          for (let e = 0; e < 4; e++) if (m.srcUsed[ESRC[e]] !== 0) envs++;
        }
        return { lfos, envs, rows: this.rows.length, ext: this.extN, spans: this.spans, half: this.halfOn };
      }
    }
    // Track.warmUp's ModCore round (review P2): a payload on a hand-built CP v2 (the readers default every missing field) —
    // lfo1 RETRIG GLOBAL, lfo2 FREE GLOBAL BPM-anchored, lfo3 RETRIG PER NOTE, ENV 2, chaos 1 (mono), macro 1, the value
    // source ext1; rows into scratch V-scope destinations with a curve, a slew and a bipolar one; cls rows (a linear and a
    // table transfer) on two Insts, set rows (an envelope time, lfo.rate, a filter character), an fx row, ext1 ← lfo1
    // (+ ext2 ← env2 for the per-chunk variant, `perNote`). B = SxBase (the destination / source indices, NSV)
    function warmPayload(B, perNote) {
      const D = B.DIDX2, NSV = B.NSV, NROW = 64, U8 = n => new Uint8Array(n), F64 = n => new Float64Array(n);
      const base = F64(NSV);
      base[D.L1_RATE] = 0.45; base[D.L2_RATE] = 0.4; base[D.L3_RATE] = 0.5; base[D.L3_SMOOTH] = 0.2;
      base[D.E2_ATT] = 0.1; base[D.E2_DEC] = 0.4; base[D.E2_SUS] = 0.7; base[D.E2_REL] = 0.3;
      base[D.C1_RATE] = 0.5; base[D.G_AMP] = 1;
      // rows: [src, dst, amt, bi, curve, rise, fall]
      const S_LFO1 = 5, S_ENV2 = 3, S_VELO = 13, S_MACRO1 = 24, rows = [
        [S_LFO1, D.A_PAN, 0.5, 0, 0, 0, 0], [S_LFO1 + 1, D.A_LEVEL, 0.5, 0, 0.4, 0, 0], [S_ENV2, D.B_LEVEL, 1, 0, 0, 0.2, 0.2],
        [S_VELO, D.A_WT, 1, 0, 0, 0, 0], [S_CHAOS1, D.B_PAN, 0.3, 1, 0, 0, 0], [S_EXT0, D.A_WARP, 0.5, 0, 0, 0, 0],
        [S_MACRO1, D.B_WT, 1, 0, 0, 0, 0], [S_LFO1 + 2, D.A_FINE, 0.5, 0, 0, 0, 0]];
      const nr = rows.length, mSrc = new Int8Array(NROW), mDst = new Int16Array(NROW), mAmt = F64(NROW), mBi = U8(NROW), mK = F64(NROW);
      const mRise = F64(NROW), mFall = F64(NROW), mCtx = U8(NROW), srcUsed = U8(NSRC), modded = U8(NSV);
      for (let q = 0; q < nr; q++) {
        const w = rows[q];
        mSrc[q] = w[0]; mDst[q] = w[1]; mAmt[q] = w[2]; mBi[q] = w[3]; mK[q] = 6 * w[4]; mRise[q] = w[5]; mFall[q] = w[6]; mCtx[q] = 1;
        srcUsed[w[0]] = 1; modded[w[1]] = 1;
      }
      const lfoLad = F64(N_LFO * 43);
      for (let l = 0; l < N_LFO; l++) for (let j = 0; j < 15; j++) lfoLad[l * 43 + j] = 128 * Math.pow(2, -j);
      const cp = { ver: 2, NSV, NSRC, NROW, base, mN: nr, mSrc, mDst, mAmt, mBi, mK, mAux: new Int8Array(NROW), mInv: U8(NROW), mCtx, mOn: U8(NROW),
        mRise, mFall, srcUsed, modded, use: 32768, wt: ['', '', ''], outMask: 1,
        lfoMode: Uint8Array.from([0, 2, 0, 2, 2, 2, 2, 2, 2, 2]), lfoMono: Uint8Array.from([1, 1, 0, 1, 1, 1, 1, 1, 1, 1]),
        lfoBpm: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), lfoAnchor: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), lfoLad, lfoLadN: U8(N_LFO).fill(15),
        chaosMono: Uint8Array.from([1, 0]), chaosSh: Uint8Array.from([0, 1]), macro: F64(N_MACRO).fill(0.5),
        mono: 0, legato: 0, poly: 1, always: 0, scaled: 0, oneNote: 1, os: 1, s1: 0, smooth: 1, ctKey: '' };
      const tab = F64(129), tabT = F64(129);
      for (let i = 0; i <= 128; i++) { tab[i] = 2 * Math.pow(i / 128, 2); tabT[i] = 0.0015 * Math.pow(2000, i / 128); }
      return { t: 'mods', bpm: 120, cp, ct: null, vals: [{ k: 0, src: S_MACRO1, v: 0.5, id: 'm1.k1' }, { k: 8, src: S_EXT0, v: 0.3, id: 'c1.out' }], keep: [],
        ext: perNote ? [{ k: 1, src: S_LFO1 }, { k: 2, src: S_ENV2 }] : [{ k: 1, src: S_LFO1 }],
        rows: [{ id: 'w0', src: S_LFO1, vi: D.A_PAN, dst: { kind: 'cls', inst: 'w1', slot: 0 }, xfer: { a: 0, b: 2, x0: 0.5 } },
          { id: 'w1', src: S_LFO1 + 1, vi: D.A_LEVEL, dst: { kind: 'cls', inst: 'w1', slot: 3 }, xfer: { tab, x0: 0.3 } },
          { id: 'w2', src: S_ENV2, vi: D.B_LEVEL, dst: { kind: 'set', inst: 'w1', field: 'fenv.a' }, xfer: { tab: tabT, x0: 0.05 } },
          { id: 'w3', src: S_VELO, vi: D.A_WT, dst: { kind: 'set', inst: 'w1', field: 'lfo.rate' }, xfer: { a: 0.1, b: 10, x0: 0.5 } },
          { id: 'w4', src: S_CHAOS1, vi: D.B_PAN, dst: { kind: 'fx', chain: 'wa', fx: 0 } },
          { id: 'w5', src: S_EXT0, vi: D.A_WARP, dst: { kind: 'cls', inst: 'w1', slot: 12 }, xfer: { a: 0, b: 0.5, x0: 0 } },
          { id: 'w6', src: S_MACRO1, vi: D.B_WT, dst: { kind: 'set', inst: 'w1', field: 'vcf.comp' }, xfer: { a: 0, b: 0.5, x0: 0.3 } },
          { id: 'w7', src: S_LFO1 + 2, vi: D.A_FINE, dst: { kind: 'cls', inst: 'w2', slot: 1 }, xfer: { a: 0, b: 1, x0: 0.5 } }] };
    }
    // the transfer T over the knob's mod space 0…1: a + b·x, or the 129-point table (linear interpolation, clamped)
    function xf(e, x) {
      const t = e.tab;
      if (t === null) return e.a + e.b * x;
      const p = x * 128;
      if (!(p > 0)) return t[0];
      if (p >= 128) return t[128];
      const i = p | 0, f = p - i;
      return t[i] + (t[i + 1] - t[i]) * f;
    }
    function create(T, base, sN) { return new ModCore(T, base, sN); }

    globalThis.ModCore = Object.freeze({ VER, NEXT, NVAL, NLIVE, create, warmPayload, ModCore, PseudoVoice });
  } catch (err) {
    globalThis.ModCore = null;                                  // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('mod-core: load failed', err);
  }
})();
