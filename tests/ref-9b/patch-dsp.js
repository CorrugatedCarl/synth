/*
 * patch-dsp.js — the patch engine's evaluator (stage 9 lane V9a, IMPL-9 §3.2 / §3.3 / §12 "Spike (a)"): a graph of
 * patchable modules — nodes per (module, section), cords, normals, multiples, rear links — compiled to a schedule and run
 * per absolute 4-base-frame chunk. Generic (D5): no module, family or constant of any instrument lives here; a family is a
 * classic script publishing `globalThis.Patch<Family>` (moog-dsp.js → PatchMoog), looked up at create (the scripts load in
 * parallel: nothing is read at load). Classic script: one IIFE publishing the frozen `globalThis.PatchDSP` (null on a load
 * failure, never a throw).
 *
 * PatchDSP.create(inst, family) → a machine, or null (no `Patch<Family>`, or a family without T / JACKS). It reads
 * inst.OS / fs / salt (seedSalt) at create, hands `inst` to its modules (the controller reads bend / wheel / at / sustain
 * per chunk) and reports a payload's first offending item once through inst.ptFail(why) (else inst.port.postMessage
 * ({t: 'ptErr', why})). The machine:
 *   set(pv)            values (§3.2): { '0': [module 0's values in its PARAMS order], 'm<k>': { _t, <id>: v } } — raw dial
 *                      positions; bound by id through the family's PARAMS (an unknown id ignored; an entry whose _t is not
 *                      the module's type, or none, → the defaults; module 0's may also be an object of ids); kept for
 *                      modules that arrive later. A module that has not run yet and every `snap` param take the value at
 *                      once; the rest glide (one-pole, 6 ms, per chunk)
 *   graph(pg)          a graph payload { v, f, mods: [[n, type, drvN | -1]], cords: [[aN, aPort, bN, bPort, g?]] } (n 0 =
 *                      the controller; a port = the jack's index in its type's JACKS; a = the source end): builds, reuses
 *                      (same n and type: its state kept) or retires modules, wires, compiles the schedule; allocates — the
 *                      message handler only. Returns { steps, loops, live, ramps, why } (null, nothing changed: not a payload)
 *   note(n, v, on)     to module 0 (its note(n, v, on))
 *   setOS(os, fs)      every module's setOS(fs); a transition in progress completes first
 *   render(buf, N, F0) N OS-rate samples (whole chunks: CH = 4 · OS, OS ≤ 8) of MAIN OUT × module 0's `og` added into
 *                      buf; F0 = the span's absolute base frame (the chunk number cc = F0 / 4 + k keys the flush and ctl)
 *   live()             MAIN OUT has a source (or a transition is in progress) — the engine's idle rule (§3.6)
 *   reset()            state only (panic, Play from a stop — P-2): every module's reset(), its outputs zeroed, values
 *                      snapped, back-edges and transitions cleared; the graph and the values stay. = a fresh machine
 *   setSalt(s)         every module's setSalt(s)
 *   ev(n, k)           (stage 9b) a momentary event: module n's ev(k) at once (the class holds it for its next ctl); → 1, or 0
 *                      dropped (no module n, k outside its type's EV row, a class without ev)
 *   lamps(F)           (stage 9b) → { F, l: [n, bits, …] } for the live modules whose type declares lamps (their int `lamp`);
 *                      lampN their count (set by graph(): the monitor posts when > 0)
 *   mon()              a debug snapshot (tests): modules, the running schedule, transition, errors
 * PatchDSP.schedule(pg, fam) (pure; fam = a family object or id) → { nodes: [[n, sec]], live, steps: [{ loop, sink?,
 * nodes }], edges, back, why }: the compile step graph() uses, for tests and tools.
 *
 * A family (`Patch<Family>`, IMPL-9 §3.4): { id, T: { type: class }, JACKS: { type: [{ id, dir: 'in' | 'out' | 'any',
 * sig: 'v' | 's', sec?, norm? }] } (moog-core's TYPE.jacks order), PARAMS: { type: [[id, def, snap?]] } (slot order; module
 * 0's = the model's control order), SINK: '<module 0's MAIN OUT jack id>', LINK?: { '<driven type>': { from: '<driver
 * type>', def: [the link inputs' values when undriven] } }, SECS?: { type: count }, OUT_K?: og's fallback, EV?: { type: [event
 * ids] }, LAMPS?: { type: [lamp ids] } (9b: a type with events has ev(k), one with lamps an int `lamp`) }. The jacks:
 * 'in' jacks are a module's inputs (ins[k] = the k-th, in table order), 'out' jacks its outputs (outs[k]); 'any' jacks
 * belong to the evaluator — a section's 'any' jacks are one passive multiple (its driven jacks averaged — one driver: as is —,
 * every other jack reading that; one multiple may drive another, never in a loop), never seen by the module. `norm`: an unpatched input
 * reads that jack of its module (an output, an input — its own sources or normal —, or a multiple). LINK: a driven module
 * whose payload drv names a module of type `from` reads that driver's link outputs (outs[nOut + k], section 0) on its link
 * inputs (ins[nIn + k], section 0) — an edge driver → driven —; undriven, `def[k]`. The sink section holds the sink jack
 * only (no output): the evaluator, not the module, adds it into buf.
 *
 * A module (a family class, the base shape, IMPL-9 §7.4): `new Cls({ fs, OS, n, salt, inst, type })` builds `outs` — one
 * Float64Array(32) per output, then the link outputs (two jacks may share one) — and its state (fresh: phases, filters,
 * envelopes 0; noise seeded from salt and n). The evaluator then assigns `ins` (an array: one buffer per input, then the
 * link inputs), `p` / `t` (Float64Array current values / targets, PARAMS order: the evaluator writes both), `mv` and `om`
 * (the module reads them, never writes them).
 * Called by the evaluator, in this order each chunk: flush() (every 32nd absolute chunk: recursive states below 1e-30 → 0),
 * ctl(cc) (once per chunk, before any run: control-rate work; `mv` = 1 when a value moved, the module is new, or after
 * setOS / reset — recompute the coefficients then), run(sec, i0, n) (section sec over chunk samples [i0, i0 + n): reads
 * ins[k][i], writes outs[k][i] for the outputs whose bit is set in `om` only — an unread output is never computed; n is CH
 * in a block step and 1 inside a loop step: the result must not depend on it). Also setOS(fs), reset() (the fresh state),
 * setSalt(s); module 0: note(n, v, on) and `og` (MAIN OUT's gain, full scale per volt, read after its ctl).
 *
 * The schedule (§3.3, spike (a)'s decisions): nodes = (module, section) pairs; edges = cords, normals and links (a multiple
 * resolved into its drivers: an input it feeds reads them, averaged when it has several); live = the nodes MAIN OUT is reachable from (the
 * rest frozen: no ctl, no run); Tarjan's SCCs in topological order (ties by module number, section); a one-node component
 * without a self-edge is a block step (run(sec, 0, CH)), any other a loop step: per sample, its members sources-first (the
 * farthest from MAIN OUT first, ties by number), every edge from a member to an earlier or the same member read one sample
 * late (bounded to ±1e4 V, NaN → 0: a loop through passive modules at gains > 1 stays finite). An input reads its
 * source's buffer directly (one source, gain 1, not late), the zero buffer, a constant, or a feed (a scratch: a sum
 * Σ g · source, a late read, a ramp) computed just before its node runs — per sample inside a loop step.
 * Output mask: graph() sets each module's `om` to the outputs some input reads.
 *
 * Changes (§3.3): an input of a node live before and after whose sources changed crossfades from the old ones to the new
 * over ≈ 2 ms (a whole number of chunks: 24 at 48 kHz; a raised cosine — [C] refined from "linear", §12 lane V9a: a linear
 * ramp's corners are a −52 dB second-difference step at OS 4, −40 dB at OS 1; the cosine's −89 / −65 dB); an S input
 * switches at the midpoint, never a 0.5. Nodes leaving the live set retire: they keep running on their inputs as they
 * were, under a transition plan that also schedules the ramps (per sample inside loops), until the ramps end — then the
 * final plan, built with the transition, is installed at that chunk boundary (no allocation) and they freeze, or go with
 * their module. A second graph() before a transition has rendered drops it (the settled plan back), one under way
 * completes first. Deterministic (D7): the same chunks whatever the span splits; reset() = a fresh machine.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const CHMAX = 32;                  // a chunk at OS 8: every module output, feed and constant buffer
    const MAXM = 64, MAXC = 256;       // a payload's bounds (patch-core's records hold ≤ 49 modules, ≤ 128 cords)
    const GMAX = 4;                    // a connection's gain (a wire's level, song.js)
    const RAMP_S = 0.002, GLIDE_S = 0.006, FLUSH_N = 32, MAXSEC = 16;
    const LATE = 1e4;                  // a late read's bound (V; NaN → 0): a loop through passive modules at gains > 1 stays finite
    const DIR = { in: 0, i: 0, out: 1, o: 1, any: 2, a: 2 };
    const EMPTY = Object.freeze([]);

    /* ---------------------------------------------------------------- a family's tables (once per family object) */
    const FTC = new WeakMap();
    function famName(id) { return typeof id === 'string' && /^[a-z][a-z0-9]*$/.test(id) ? 'Patch' + id[0].toUpperCase() + id.slice(1) : ''; }
    function famTable(F) {
      let FT = FTC.get(F);
      if (FT !== undefined) return FT;
      const L = F.LINK && typeof F.LINK === 'object' ? F.LINK : {}, nLO = Object.create(null), types = Object.create(null);
      for (const ty of Object.keys(L)) {
        const x = L[ty];
        if (x && typeof x.from === 'string' && Array.isArray(x.def)) nLO[x.from] = Math.max(nLO[x.from] || 0, x.def.length);
      }
      const T = F.T && typeof F.T === 'object' ? F.T : {}, J = F.JACKS && typeof F.JACKS === 'object' ? F.JACKS : {};
      const P = F.PARAMS && typeof F.PARAMS === 'object' ? F.PARAMS : {}, S = F.SECS && typeof F.SECS === 'object' ? F.SECS : {};
      const EV = F.EV && typeof F.EV === 'object' ? F.EV : {}, LP = F.LAMPS && typeof F.LAMPS === 'object' ? F.LAMPS : {};
      for (const type of Object.keys(T)) {
        const TI = typeInfo(type, T[type], J[type], P[type], L[type], nLO[type] || 0, S[type]);
        if (TI === null) continue;
        TI.nEv = Array.isArray(EV[type]) ? EV[type].length : 0; TI.nLamp = Array.isArray(LP[type]) ? LP[type].length : 0;   // (9b: events, lamps)
        types[type] = TI;
      }
      FT = { F, types, sink: typeof F.SINK === 'string' ? F.SINK : '', outK: typeof F.OUT_K === 'number' ? F.OUT_K : 0.1 };
      FTC.set(F, FT);
      return FT;
    }
    // one type: its jacks (dir 0 in / 1 out / 2 any, sig 0 v / 1 s, section, normal, slot), slots per section, params
    function typeInfo(type, Cls, J, P, Lk, nLO, secs) {
      if (typeof Cls !== 'function' || !Array.isArray(J)) return null;
      const jk = [], ids = Object.create(null);
      let nIn = 0, nOut = 0, nSec = 1;
      for (let k = 0; k < J.length; k++) {
        const j = J[k];
        if (!j || typeof j.id !== 'string' || ids[j.id] !== undefined) return null;
        const dir = DIR[j.dir !== undefined ? j.dir : j.d], sg = j.sig !== undefined ? j.sig : j.s, sec = j.sec === undefined ? 0 : j.sec;
        if (dir === undefined || (sg !== undefined && sg !== 'v' && sg !== 's') || !(Number.isInteger(sec) && sec >= 0 && sec < MAXSEC)) return null;
        if (sec + 1 > nSec) nSec = sec + 1;
        jk.push({ id: j.id, dir, s: sg === 's' ? 1 : 0, sec, norm: -1, slot: dir === 0 ? nIn++ : dir === 1 ? nOut++ : -1, nm: j.norm });
        ids[j.id] = k;
      }
      for (let k = 0; k < jk.length; k++) {
        const j = jk[k], t = typeof j.nm === 'string' ? ids[j.nm] : undefined;
        if (j.dir === 0 && t !== undefined && t !== k) j.norm = t;
        delete j.nm;
      }
      const lk = Lk && typeof Lk.from === 'string' && Array.isArray(Lk.def) ? Lk : null, nLI = lk ? lk.def.length : 0;
      if (Number.isInteger(secs) && secs > nSec && secs <= MAXSEC) nSec = secs;
      else if (Array.isArray(secs) && secs.length > nSec && secs.length <= MAXSEC) nSec = secs.length;
      if (nOut + nLO > 30) return null; // (om is a 31-bit mask)
      const nInT = nIn + nLI, nOutT = nOut + nLO;
      const inSec = new Int32Array(nInT), inS = new Uint8Array(nInT), inJack = new Int32Array(nInT).fill(-1), outSec = new Int32Array(nOutT);
      const secSlots = [], secOut = new Uint8Array(nSec);
      for (let s = 0; s < nSec; s++) secSlots.push([]);
      let secMask = 0;
      for (let k = 0; k < jk.length; k++) {
        const j = jk[k];
        if (j.dir === 0) { inSec[j.slot] = j.sec; inS[j.slot] = j.s; inJack[j.slot] = k; secSlots[j.sec].push(j.slot); secMask |= 1 << j.sec; }
        else if (j.dir === 1) { outSec[j.slot] = j.sec; secOut[j.sec] = 1; secMask |= 1 << j.sec; }
      }
      for (let k = 0; k < nLI; k++) { secSlots[0].push(nIn + k); secMask |= 1; }
      if (nLO > 0) { secOut[0] = 1; secMask |= 1; }
      const pa = Array.isArray(P) ? P : [], pid = [], pdef = [], psnap = [], pidx = Object.create(null);
      for (const e of pa) {
        const id = Array.isArray(e) ? e[0] : e && e.id, def = Array.isArray(e) ? e[1] : e && e.def, sn = Array.isArray(e) ? e[2] : e && e.snap;
        if (typeof id !== 'string' || pidx[id] !== undefined) continue;
        pidx[id] = pid.length; pid.push(id); pdef.push(typeof def === 'number' && Number.isFinite(def) ? def : 0); psnap.push(sn ? 1 : 0);
      }
      return { type, Cls, jk, ids, nIn, nOut, nLI, nLO, nInT, nOutT, nSec, inSec, inS, inJack, outSec, secSlots, secOut, secMask,
        linkFrom: lk ? lk.from : '', linkDef: Float64Array.from(lk ? lk.def.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)) : []),
        par: { id: pid, def: Float64Array.from(pdef), snap: Uint8Array.from(psnap), idx: pidx }, nEv: 0, nLamp: 0 };
    }

    /* ---------------------------------------------------------------- the payload → modules and each input's sources */
    // An entry = one source of an input: { r (the source module's record, null = a constant), o (its output slot), g (gain),
    // c (the constant) }; an input's entries are canonical (by source number, slot; equal sources merged, gain 0 dropped)
    const entOrder = (x, y) => (x.r === null ? -1 : x.r.n) - (y.r === null ? -1 : y.r.n) || ((x.r === null ? 0 : x.r.uid || 0) - (y.r === null ? 0 : y.r.uid || 0)) || x.o - y.o || x.c - y.c;
    function canon(L) {
      L.sort(entOrder);
      const out = [];
      for (const e of L) {
        const p = out.length ? out[out.length - 1] : null;
        if (p !== null && p.r === e.r && p.o === e.o && p.c === e.c) p.g += e.g; else out.push({ r: e.r, o: e.o, g: e.g, c: e.c });
      }
      return out.filter(e => e.g !== 0);
    }
    function analyse(pg, FT, why) {
      if (!pg || typeof pg !== 'object' || !Array.isArray(pg.mods) || !Array.isArray(pg.cords)) { why.push('graph'); return null; }
      const recs = [], byN = new Map(), gone = new Set();
      for (const e of pg.mods) {
        if (!Array.isArray(e) || !(Number.isInteger(e[0]) && e[0] >= 0 && e[0] <= 4096) || byN.has(e[0])) { why.push('mod'); continue; }
        const TI = typeof e[1] === 'string' ? FT.types[e[1]] : undefined;
        if (TI === undefined) { why.push('type'); gone.add(e[0]); continue; }  // (an unknown type: silent, its cords dropped)
        if (recs.length >= MAXM) { why.push('limit'); gone.add(e[0]); continue; }
        const r = { n: e[0], type: e[1], TI, drv: Number.isInteger(e[2]) ? e[2] : -1, uid: 0, ins: [], plug: new Uint8Array(TI.nIn), res: [] };
        for (let k = 0; k < TI.nInT; k++) { r.ins.push([]); r.res.push(null); }
        byN.set(r.n, r); recs.push(r);
      }
      recs.sort((a, b) => a.n - b.n);
      // the multiples: a (module, section)'s 'any' jacks; drivers = output entries, up = [group, gain] (a multiple driving it)
      const groups = new Map();
      const grp = (r, sec) => { const k = r.n * MAXSEC + sec; let G = groups.get(k); if (G === undefined) { G = { r, drv: [], up: [], down: [], res: null, busy: 0 }; groups.set(k, G); } return G; };
      const reaches = (A, B) => { // B reachable from A along the multiples' drive edges
        const seen = new Set([A]), st = [A];
        while (st.length) { const X = st.pop(); if (X === B) return true; for (const Y of X.down) if (!seen.has(Y)) { seen.add(Y); st.push(Y); } }
        return false;
      };
      let nc = 0;
      for (const c of pg.cords) {
        if (!Array.isArray(c)) { why.push('cord'); continue; }
        const a = byN.get(c[0]), b = byN.get(c[2]);
        if (a === undefined || b === undefined) { if (!gone.has(c[0]) && !gone.has(c[2])) why.push('cord'); continue; }
        const ja = Number.isInteger(c[1]) ? a.TI.jk[c[1]] : undefined, jb = Number.isInteger(c[3]) ? b.TI.jk[c[3]] : undefined;
        if (ja === undefined || jb === undefined) { why.push('port'); continue; }
        if (ja.dir === 0 || jb.dir === 1 || ja.s !== jb.s) { why.push('cord'); continue; }  // into an output, out of an input, S ↔ 1/4"
        let g = c[4] === undefined ? 1 : c[4];
        if (typeof g !== 'number' || g !== g) { why.push('cord'); continue; }
        g = g < 0 ? 0 : g > GMAX ? GMAX : g;
        if (nc >= MAXC) { why.push('limit'); continue; }
        nc++;
        if (ja.dir === 1 && jb.dir === 0) { b.ins[jb.slot].push({ r: a, o: ja.slot, g, c: 0 }); b.plug[jb.slot] = 1; }
        else if (ja.dir === 1) grp(b, jb.sec).drv.push({ r: a, o: ja.slot, g, c: 0 });
        else if (jb.dir === 0) { b.ins[jb.slot].push({ G: grp(a, ja.sec), g }); b.plug[jb.slot] = 1; }
        else { // a multiple driving another: never a passive loop
          const A = grp(a, ja.sec), B = grp(b, jb.sec);
          if (A === B || reaches(B, A)) { why.push('loop'); continue; }
          B.up.push([A, g]); A.down.push(B);
        }
      }
      const expand = G => {
        if (G.res !== null) return G.res;
        if (G.busy) return EMPTY;
        G.busy = 1;
        // outputs tied together average (a passive multiple cannot gain: summed, a loop through two attenuators ran to 74 dBFS —
        // review 1 F2): n = the cords driving it — its own driven jacks and each multiple into it that carries a signal; one: as is
        const L = G.drv.slice(), U = [];
        for (const [A, g] of G.up) { const x = expand(A); if (x.length) U.push([x, g]); }
        const w = L.length + U.length > 1 ? 1 / (L.length + U.length) : 1;
        if (w !== 1) for (let k = 0; k < L.length; k++) { const e = L[k]; L[k] = { r: e.r, o: e.o, g: e.g * w, c: e.c }; }
        for (const [x, g] of U) for (const e of x) L.push({ r: e.r, o: e.o, g: e.g * g * w, c: e.c });
        G.busy = 0; G.res = canon(L);
        return G.res;
      };
      const res = (r, k, d) => { // input slot k's entries: its cords (multiples expanded), else its normal
        if (r.res[k] !== null) return r.res[k];
        let L = [];
        for (const it of r.ins[k]) {
          if (it.G !== undefined) { for (const e of expand(it.G)) L.push({ r: e.r, o: e.o, g: e.g * it.g, c: e.c }); }
          else L.push(it);
        }
        const j = r.TI.jk[r.TI.inJack[k]];
        if (!r.plug[k] && j.norm >= 0 && d < 8) {
          const jn = r.TI.jk[j.norm];
          L = jn.dir === 1 ? [{ r, o: jn.slot, g: 1, c: 0 }] : jn.dir === 0 ? res(r, jn.slot, d + 1).slice() : expand(grp(r, jn.sec)).slice();
        }
        r.res[k] = canon(L);
        return r.res[k];
      };
      for (const r of recs) for (let k = 0; k < r.TI.nIn; k++) res(r, k, 0);
      // rear links: a driven module's link inputs ← its driver's link outputs, or the constants
      for (const r of recs) {
        const TI = r.TI;
        if (TI.nLI === 0) { if (r.drv >= 0) why.push('drv'); continue; }
        const d = r.drv >= 0 ? byN.get(r.drv) : undefined, ok = d !== undefined && d !== r && d.type === TI.linkFrom;
        if (r.drv >= 0 && !ok && !gone.has(r.drv)) why.push('drv');
        for (let k = 0; k < TI.nLI; k++) {
          const v = TI.linkDef[k];
          r.res[TI.nIn + k] = ok ? [{ r: d, o: d.TI.nOut + k, g: 1, c: 0 }] : v !== 0 ? [{ r: null, o: -1, g: 1, c: v }] : [];
        }
      }
      // MAIN OUT: module 0's sink jack (an input in a section with no output)
      let sink = null;
      const r0 = byN.get(0);
      if (r0 !== undefined) {
        const t = FT.sink !== '' ? r0.TI.ids[FT.sink] : undefined, j = t !== undefined ? r0.TI.jk[t] : null;
        if (j !== null && j.dir === 0 && !r0.TI.secOut[j.sec]) sink = { r: r0, k: j.slot }; else why.push('sink');
      }
      return { recs, sink };
    }

    /* ---------------------------------------------------------------- the schedule (pure) */
    // G = { recs (each .n, .uid, .TI), ent[i][k] (input k's entries), old[i][k] (a ramp's old entries) | null, sec[i] (the
    // sections that are nodes, a mask) | null (every section with a slot), sink { i, k } | null, all (every node live) }
    function order(G) {
      const R = G.recs, nRec = R.length, idx = new Map(), key = new Map(), nR = [], nS = [], rank = [];
      for (let i = 0; i < nRec; i++) idx.set(R[i], i);
      for (let i = 0; i < nRec; i++) {
        const TI = R[i].TI, mk = G.sec !== null ? G.sec[i] : TI.secMask;
        for (let s = 0; s < TI.nSec; s++) if (mk & (1 << s)) { key.set(i * MAXSEC + s, nR.length); nR.push(i); nS.push(s); rank.push((R[i].n * MAXSEC + s) * 1e6 + ((R[i].uid || 0) % 1e6)); }
      }
      const N = nR.length, out = [], inn = [], eset = new Set(), edges = [];
      for (let v = 0; v < N; v++) { out.push([]); inn.push([]); }
      const nodeOf = e => { if (e.r === null) return -1; const j = idx.get(e.r); if (j === undefined) return -1; const v = key.get(j * MAXSEC + e.r.TI.outSec[e.o]); return v === undefined ? -1 : v; };
      const add = (u, v) => { if (u < 0) return; const k = u * N + v; if (eset.has(k)) return; eset.add(k); out[u].push(v); inn[v].push(u); edges.push([u, v]); };
      for (let i = 0; i < nRec; i++) {
        const TI = R[i].TI, E = G.ent[i], O = G.old !== null ? G.old[i] : null;
        for (let k = 0; k < TI.nInT; k++) {
          const v = key.get(i * MAXSEC + TI.inSec[k]);
          if (v === undefined) continue;
          const L = E[k];
          if (L) for (const e of L) add(nodeOf(e), v);
          const L2 = O !== null ? O[k] : null;
          if (L2) for (const e of L2) add(nodeOf(e), v);
        }
      }
      const sk = G.sink !== null ? key.get(G.sink.i * MAXSEC + R[G.sink.i].TI.inSec[G.sink.k]) : undefined, sinkN = sk === undefined ? -1 : sk;
      // the live set: MAIN OUT's ancestors (reverse BFS), with each one's distance to it
      const live = new Uint8Array(N), dist = new Int32Array(N).fill(-1);
      if (sinkN >= 0) {
        const q = [sinkN]; live[sinkN] = 1; dist[sinkN] = 0;
        for (let h = 0; h < q.length; h++) { const a = q[h]; for (const b of inn[a]) if (!live[b]) { live[b] = 1; dist[b] = dist[a] + 1; q.push(b); } }
      }
      if (G.all) live.fill(1);
      // Tarjan's strongly-connected components over the live nodes
      const IX = new Int32Array(N).fill(-1), LOW = new Int32Array(N), ON = new Uint8Array(N), stk = [], comps = [], compOf = new Int32Array(N).fill(-1);
      let ix = 0;
      const strong = v => {
        IX[v] = LOW[v] = ix++; stk.push(v); ON[v] = 1;
        for (const w of out[v]) {
          if (!live[w]) continue;
          if (IX[w] < 0) { strong(w); if (LOW[w] < LOW[v]) LOW[v] = LOW[w]; } else if (ON[w] && IX[w] < LOW[v]) LOW[v] = IX[w];
        }
        if (LOW[v] === IX[v]) { const c = []; let w; do { w = stk.pop(); ON[w] = 0; compOf[w] = comps.length; c.push(w); } while (w !== v); comps.push(c); }
      };
      for (let v = 0; v < N; v++) if (live[v] && IX[v] < 0) strong(v);
      // the condensation in topological order, ties by (module number, section)
      const nC = comps.length, cr = new Float64Array(nC), cOut = [], indeg = new Int32Array(nC), cset = new Set();
      for (let c = 0; c < nC; c++) { let m = Infinity; for (const v of comps[c]) if (rank[v] < m) m = rank[v]; cr[c] = m; cOut.push([]); }
      for (const [u, v] of edges) {
        if (!live[u] || !live[v]) continue;
        const a = compOf[u], b = compOf[v];
        if (a === b || cset.has(a * nC + b)) continue;
        cset.add(a * nC + b); cOut[a].push(b); indeg[b]++;
      }
      const ready = [], corder = [];
      for (let c = 0; c < nC; c++) if (indeg[c] === 0) ready.push(c);
      while (ready.length) {
        let bi = 0;
        for (let k = 1; k < ready.length; k++) if (cr[ready[k]] < cr[ready[bi]]) bi = k;
        const c = ready.splice(bi, 1)[0];
        corder.push(c);
        for (const d of cOut[c]) if (--indeg[d] === 0) ready.push(d);
      }
      // steps: a loop's members sources-first (the farthest from MAIN OUT first, ties by number)
      const steps = [], stepOf = new Int32Array(N).fill(-1), pos = new Int32Array(N);
      for (const c of corder) {
        const m = comps[c], loop = m.length > 1 || eset.has(m[0] * N + m[0]) ? 1 : 0;
        if (loop) m.sort((a, b) => (dist[b] - dist[a]) || (rank[a] - rank[b]));
        for (let k = 0; k < m.length; k++) { stepOf[m[k]] = steps.length; pos[m[k]] = k; }
        steps.push({ loop, mem: m });
      }
      const late = (u, v) => u >= 0 && stepOf[u] >= 0 && stepOf[u] === stepOf[v] && steps[stepOf[u]].loop === 1 && pos[u] >= pos[v];
      return { N, nR, nS, key, live, steps, stepOf, pos, sinkN, edges, nodeOf, late };
    }
    function schedule(pg, fam) {
      const F = typeof fam === 'string' ? globalThis[famName(fam)] : fam, why = [];
      if (!F || typeof F !== 'object') return null;
      const FT = famTable(F), A = analyse(pg, FT, why);
      if (A === null) return { nodes: [], live: [], steps: [], edges: [], back: [], why };
      const ri = new Map(A.recs.map((r, i) => [r, i]));
      const O = order({ recs: A.recs, ent: A.recs.map(r => r.res), old: null, sec: null, sink: A.sink !== null ? { i: ri.get(A.sink.r), k: A.sink.k } : null, all: false });
      return {
        nodes: O.nR.map((i, v) => [A.recs[i].n, O.nS[v]]), live: Array.from(O.live),
        steps: O.steps.map(s => (s.loop === 0 && s.mem[0] === O.sinkN ? { loop: 0, sink: 1, nodes: s.mem.slice() } : { loop: s.loop, nodes: s.mem.slice() })),
        edges: O.edges.map(e => e.slice()), back: O.edges.filter(([u, v]) => O.late(u, v)).map(e => e.slice()), why,
      };
    }

    /* ---------------------------------------------------------------- the machine */
    class Rec { // a module in the machine
      constructor(n, type, TI, m, uid) { this.n = n; this.type = type; this.TI = TI; this.m = m; this.uid = uid; this.fresh = 1; this.gl = 0; this.mv1 = 1; this.mvw = 1; }
    }
    // a scratch an input reads: Σ g · source (late: the source's previous sample), or a ramp from the old sources (the
    // first nA) to the new; pre: one late source at gain k0 (a loop's back-edge, filled for every member at the sample's start)
    class Feed {
      constructor(L) {
        this.z = new Float64Array(L); this.n = 0; this.nA = 0; this.s = []; this.g = null; this.d = null; this.l = null;
        // (l0 / k0 doubles from the first write, pre written twice: wire sets them later — a field first changed after the warm-up deopts)
        this.hd = 0; this.rp = 0; this.sw = 0; this.pos = 0; this.len = 0; this.pre = 1; this.pre = 0; this.s0 = null;
        this.l0 = 0.5; this.l0 = 0; this.k0 = 0.5; this.k0 = 1;
      }
    }
    class Step { // block: m.run(sec, 0, CH) after its feeds; loop: per sample, its members in order
      constructor() {
        this.loop = 0; this.m = null; this.sec = 0; this.F = []; this.nF = 0;
        this.ms = []; this.secs = null; this.nm = 0; this.pre = []; this.nPre = 0; this.mf = []; this.mfS = null; this.dl = []; this.nDl = 0; this.at = null;
      }
    }
    class Plan {
      constructor() {
        this.recs = []; this.nR = 0; this.steps = []; this.nS = 0; this.sinkB = null; this.sinkF = null; this.sinkOn = 0; this.sinkK = -1; this.m0 = null;
        this.wR = []; this.wS = null; this.wB = []; this.nW = 0; this.mR = []; this.mM = null; this.nM = 0; this.dF = []; this.nDF = 0; this.nRamp = 0;
        this.ent = null; this.liveN = []; this.liveK = null; this.byN = null; this.all = []; this.nAll = 0; this.left = 0; this.total = 0; this.next = null;
        this.lampR = EMPTY; this.nLampR = 0;           // (9b) the plan's modules whose type declares lamps (lamps())
      }
    }

    class Machine {
      constructor(inst, FT) {
        this.inst = inst || null; this.FT = FT; this.outK = FT.outK;
        const os = inst && inst.OS > 0 ? inst.OS | 0 : 1;
        // (every field that ever holds a double starts as one — fs / base / kG / salt: V8 changes the object's map when a small-
        // integer field first takes a double, and the compiled code of a Track's first quanta deopts on it: "wrong map")
        this.OS = 1; this.fs = 0.5; this.fs = 48000; this.base = 0.5; this.base = 48000; this.CH = 4; this.kG = 0.5; this.kG = 0; this.rampCh = 1; this.rampLen = 4; this.RT = null;
        this.salt = 0.5; this.salt = inst ? ((inst.salt !== undefined ? inst.salt : inst.seedSalt) | 0) : 0;
        this.Z = new Float64Array(CHMAX); this.cb = new Map(); this.uid = 0;
        this.cur = null; this.pend = null; this.lat = null; this.m0 = null; this.pv = null;
        this.g0 = NaN; this.ps = 0; this.why = []; this.errSent = 0;
        this.lampN = 0;                                // (9b) the live modules with lamps in the latest graph (the monitor posts when > 0)
        this.rate(os, inst && inst.fs > 0 ? inst.fs : 48000 * os);
      }
      rate(os, fs) { // the rate-dependent constants: chunk, glide, the ramp (whole chunks) and its raised-cosine table
        this.OS = os; this.fs = fs; this.base = fs / os; this.CH = 4 * os;
        this.kG = 1 - Math.exp(-4 / (this.base * GLIDE_S));
        this.rampCh = Math.max(1, Math.round(RAMP_S * this.base / 4)); this.rampLen = this.rampCh * this.CH;
        const L = this.rampLen, RT = new Float64Array(L + 1);
        for (let p = 0; p <= L; p++) RT[p] = 0.5 - 0.5 * Math.cos(Math.PI * p / L);
        this.RT = RT;
      }
      cbuf(v) { let b = this.cb.get(v); if (b === undefined) { b = new Float64Array(CHMAX).fill(v); this.cb.set(v, b); } return b; }
      err(why) {
        if (why.length === 0) return;
        for (const w of why) if (this.why.length < 32) this.why.push(w);
        if (this.errSent === 1) return;
        this.errSent = 1;
        const I = this.inst;
        try {
          if (I && typeof I.ptFail === 'function') I.ptFail(why[0]);
          else if (I && I.port && typeof I.port.postMessage === 'function') I.port.postMessage({ t: 'ptErr', why: why[0] });
        } catch (e) { /* the report never throws */ }
      }
      make(q) { // a fresh module of q's type (null: its class failed or broke the base shape)
        const TI = q.TI;
        let m = null;
        try { m = new TI.Cls({ fs: this.fs, OS: this.OS, n: q.n, salt: this.salt, inst: this.inst, type: q.type }); } catch (e) { return null; }
        if (!m || typeof m.ctl !== 'function' || typeof m.run !== 'function' || !m.outs || m.outs.length < TI.nOutT) return null;
        for (let k = 0; k < TI.nOutT; k++) { const b = m.outs[k]; if (!(b instanceof Float64Array) || b.length < CHMAX) return null; }
        const ins = [];
        for (let k = 0; k < TI.nInT; k++) ins.push(this.Z);
        m.ins = ins; m.p = new Float64Array(TI.par.def); m.t = new Float64Array(TI.par.def); m.mv = 1; m.om = 0;
        const r = new Rec(q.n, q.type, TI, m, ++this.uid);
        if (this.pv !== null) this.vals(r, this.pv);
        return r;
      }
      vals(r, pv) { // the module's entry of pv → its targets (defaults first); a module that has not run, or a snap param, jumps
        const TI = r.TI, m = r.m, PR = TI.par, t = m.t, p = m.p, n = t.length;
        for (let k = 0; k < n; k++) t[k] = PR.def[k];
        const e = r.n === 0 ? pv['0'] : pv['m' + r.n];
        if (e && typeof e === 'object') {
          if (Array.isArray(e)) { for (let k = 0; k < n && k < e.length; k++) { const v = e[k]; if (typeof v === 'number' && Number.isFinite(v)) t[k] = v; } }
          else if (e._t === r.type || (r.n === 0 && e._t === undefined)) {
            for (const id of Object.keys(e)) { const k = PR.idx[id], v = e[id]; if (k !== undefined && typeof v === 'number' && Number.isFinite(v)) t[k] = v; }
          }
        }
        let gl = 0;
        for (let k = 0; k < n; k++) if (p[k] !== t[k]) { if (r.fresh === 1 || PR.snap[k] === 1) { p[k] = t[k]; r.mv1 = 1; } else gl = 1; }
        if (gl === 1) r.gl = 1;
      }

      /* ---- the message handler's side (allocates) */
      set(pv) {
        if (!pv || typeof pv !== 'object') return;
        this.pv = pv;
        const L = this.lat;
        if (L !== null) for (let k = 0; k < L.nAll; k++) this.vals(L.all[k], pv);
      }
      note(n, v, on) { const m = this.m0; if (m !== null && typeof m.note === 'function') m.note(n, v, on); }
      // (9b, IMPL-9b §3.2) a momentary event k of module n → its class's ev(k) at once: the class keeps it (its own ring) and
      // applies it at its next ctl — messages land between quanta, so the next chunk is the next quantum's first: no queue
      // here, nothing in the chunk loop. No module n (in the latest graph), one outside the latest plan (not live: no ctl runs,
      // its ring would hold the event until a cord makes it live — review 1 F2: live only, so dropped), k outside its type's EV
      // row, or no ev → dropped (0)
      ev(n, k) {
        const L = this.lat;
        if (L === null) return 0;
        const r = L.byN.get(n);
        if (r === undefined || !(Number.isInteger(k) && k >= 0 && k < r.TI.nEv) || typeof r.m.ev !== 'function' || L.recs.indexOf(r) < 0) return 0;
        r.m.ev(k);
        return 1;
      }
      // (9b) the live lamp modules' lamps at frame F → { F, l: [n, bits, …] } (bit i = lamp i of its type's LAMPS row): the
      // monitor's, a copy (never from render); a module out of the live set keeps its last lamps on the host
      lamps(F) {
        const P = this.lat, l = [];
        if (P !== null) for (let k = 0; k < P.nLampR; k++) { const r = P.lampR[k]; l.push(r.n, r.m.lamp | 0); }
        return { F, l };
      }
      graph(pg) {
        const why = [], A = analyse(pg, this.FT, why);
        if (A === null) { this.err(why); return null; }                 // (not a payload: nothing changes)
        if (this.pend !== null) { // a transition under way completes; one not yet heard is dropped (the settled plan back)
          if (this.pend.left < this.pend.total) this.settle();
          else { this.pend = null; this.install(this.cur); }
        }
        const cur = this.cur, pool = cur !== null ? cur.byN : null, real = new Map();
        for (const q of A.recs) {
          let r = pool !== null ? pool.get(q.n) : undefined;
          if (r === undefined || r.type !== q.type) r = this.make(q);
          if (r === null) why.push('type'); else real.set(q, r);
        }
        const qs = A.recs.filter(q => real.has(q)), recs = qs.map(q => real.get(q));
        const conv = L => L.filter(e => e.r === null || real.has(e.r)).map(e => ({ r: e.r === null ? null : real.get(e.r), o: e.o, g: e.g, c: e.c }));
        const ent = qs.map(q => q.res.map(L => (L === null ? [] : conv(L))));
        const sink = A.sink !== null && real.has(A.sink.r) ? { i: qs.indexOf(A.sink.r), k: A.sink.k } : null;
        const G = { recs, ent, old: null, sec: null, sink, all: false }, O = order(G), B = this.bind(G, O);
        B.byN = new Map(recs.map(r => [r.n, r])); B.all = recs; B.nAll = recs.length;
        // the transition: the inputs of nodes live before and after whose sources changed ramp; nodes leaving retire
        let T = null;
        if (cur !== null) {
          const ramps = new Set();
          for (const [r, s] of B.liveN) {
            if (!cur.liveK.has(r.uid * MAXSEC + s)) continue;
            const E0 = cur.ent.get(r), E1 = B.ent.get(r);
            for (const k of r.TI.secSlots[s]) if (!same(E0[k], E1[k])) ramps.add(r.uid * 1024 + k);
          }
          if (ramps.size > 0) T = this.trans(cur, B, ramps);
        }
        if (T !== null) { this.pend = T; this.install(T); } else { this.cur = B; this.install(B); }
        const r0 = B.byN.get(0);
        this.lat = B; this.m0 = r0 !== undefined ? r0.m : null; this.lampN = B.nLampR;
        this.err(why);
        const P = T !== null ? T : B;
        return { steps: B.nS, loops: B.steps.filter(s => s.loop === 1).length, live: B.liveN.length, ramps: P.nRamp, why };
      }
      // the transition plan: B's live nodes (the changed inputs as ramps from cur's sources) + the retiring ones (cur's
      // live nodes B lacks, on their inputs as they were); every node run until the ramps end, then B
      trans(cur, B, ramps) {
        const recs = [], secM = new Map(), ret = new Set();
        const add = (r, s) => { if (!secM.has(r)) { secM.set(r, 0); recs.push(r); } secM.set(r, secM.get(r) | (1 << s)); };
        for (const [r, s] of B.liveN) add(r, s);
        for (const [r, s] of cur.liveN) if (!B.liveK.has(r.uid * MAXSEC + s)) { add(r, s); ret.add(r.uid * MAXSEC + s); }
        recs.sort((a, b) => a.n - b.n || a.uid - b.uid);
        const ent = [], old = [], sec = [];
        for (const r of recs) {
          const TI = r.TI, E = [], O = [], E0 = cur.ent.get(r), E1 = B.ent.get(r);
          for (let k = 0; k < TI.nInT; k++) {
            const s = TI.inSec[k], gone = ret.has(r.uid * MAXSEC + s);
            E.push(gone ? (E0 ? E0[k] : EMPTY) : (E1 ? E1[k] : EMPTY));
            O.push(!gone && ramps.has(r.uid * 1024 + k) ? E0[k] : null);
          }
          ent.push(E); old.push(O); sec.push(secM.get(r));
        }
        const b0 = B.byN.get(0), sink = B.sinkK >= 0 && b0 !== undefined ? { i: recs.indexOf(b0), k: B.sinkK } : null;
        const G = { recs, ent, old, sec, sink: sink !== null && sink.i >= 0 ? sink : null, all: true }, T = this.bind(G, order(G));
        T.next = B; T.left = T.total = this.rampCh; T.byN = B.byN; T.all = B.all; T.nAll = B.nAll;
        return T;
      }
      // a plan from a schedule: its steps, feeds, wiring, masks (the module objects untouched until install)
      bind(G, O) {
        const P = new Plan(), R = G.recs, Z = this.Z, L = CHMAX, mask = new Map(), inPlan = new Set();
        const wR = [], wS = [], wB = [];
        const bufOf = e => (e.r !== null ? e.r.m.outs[e.o] : this.cbuf(e.c));
        const use = e => { if (e.r !== null) mask.set(e.r, (mask.get(e.r) || 0) | (1 << e.o)); };
        // input k of record i at node v → the buffer its module reads (a feed when it must be computed)
        const wire = (i, k, v) => {
          const E = G.ent[i][k] || EMPTY, A = G.old !== null && G.old[i] ? G.old[i][k] : null;
          for (const e of E) use(e);
          if (A !== null) for (const e of A) use(e);
          const late = e => O.late(O.nodeOf(e), v);
          let f = null, b = Z;
          if (A === null && E.length === 0) b = Z;
          else if (A === null && E.length === 1 && E[0].g === 1 && !late(E[0])) b = bufOf(E[0]);
          else {
            const all = A !== null ? A.concat(E) : E;
            f = new Feed(L);
            f.n = all.length; f.nA = A !== null ? A.length : 0; f.s = all.map(bufOf);
            f.g = Float64Array.from(all, e => e.g); f.d = Uint8Array.from(all, e => (late(e) ? 1 : 0)); f.l = new Float64Array(all.length);
            f.hd = f.d.indexOf(1) >= 0 ? 1 : 0; f.rp = A !== null ? 1 : 0; f.sw = R[i].TI.inS[k]; f.len = this.rampLen; f.s0 = Z;
            if (f.rp === 0 && f.n === 1 && f.hd === 1) { f.pre = 1; f.s0 = f.s[0]; f.k0 = f.g[0]; }
            if (f.rp === 1) P.nRamp++;
            if (f.hd === 1) P.dF.push(f);
            b = f.z;
          }
          wR.push(R[i]); wS.push(k); wB.push(b);
          return f;
        };
        for (const st of O.steps) {
          const v0 = st.mem[0];
          if (st.loop === 0 && v0 === O.sinkN) { // MAIN OUT: the evaluator's
            const i = O.nR[v0], f = wire(i, G.sink.k, v0), E = G.ent[i][G.sink.k] || EMPTY, A = G.old !== null && G.old[i] ? G.old[i][G.sink.k] : null;
            P.sinkF = f; P.sinkB = wB[wB.length - 1]; P.sinkOn = E.length > 0 || (A !== null && A.length > 0) ? 1 : 0;
            inPlan.add(R[i]);
            continue;
          }
          const S = new Step();
          S.at = st.mem.map(v => [R[O.nR[v]].n, O.nS[v]]);
          if (st.loop === 0) {
            const i = O.nR[v0], r = R[i];
            if (r.TI.secOut[O.nS[v0]] === 0) continue; // (a section with no output: nothing to run — a retiring old sink)
            S.m = r.m; S.sec = O.nS[v0]; inPlan.add(r);
            for (const k of r.TI.secSlots[S.sec]) { const f = wire(i, k, v0); if (f !== null) S.F.push(f); }
            S.nF = S.F.length;
          } else {
            S.loop = 1; S.nm = st.mem.length; S.secs = new Int32Array(S.nm); S.mfS = new Int32Array(S.nm + 1);
            for (let j = 0; j < S.nm; j++) {
              const v = st.mem[j], i = O.nR[v], r = R[i];
              S.ms.push(r.m); S.secs[j] = O.nS[v]; inPlan.add(r);
              for (const k of r.TI.secSlots[O.nS[v]]) {
                const f = wire(i, k, v);
                if (f === null) continue;
                if (f.pre === 1) S.pre.push(f); else S.mf.push(f);
                if (f.hd === 1) S.dl.push(f);
              }
              S.mfS[j + 1] = S.mf.length;
            }
            S.nPre = S.pre.length; S.nDl = S.dl.length;
          }
          P.steps.push(S);
        }
        P.nS = P.steps.length;
        P.recs = [...inPlan].sort((a, b) => a.n - b.n || a.uid - b.uid); P.nR = P.recs.length;
        P.lampR = P.recs.filter(r => r.TI.nLamp > 0); P.nLampR = P.lampR.length;
        P.wR = wR; P.wS = Int32Array.from(wS); P.wB = wB; P.nW = wR.length;
        P.mR = P.recs; P.mM = Int32Array.from(P.recs, r => mask.get(r) || 0); P.nM = P.recs.length; P.nDF = P.dF.length;
        const s0 = G.sink !== null ? R[G.sink.i] : null;
        P.m0 = s0 !== null ? s0.m : null; P.sinkK = s0 !== null ? G.sink.k : -1;
        if (s0 !== null && O.sinkN < 0) P.sinkK = -1;
        P.ent = new Map(R.map((r, i) => [r, G.ent[i]]));
        for (let v = 0; v < O.N; v++) if (O.live[v]) P.liveN.push([R[O.nR[v]], O.nS[v]]);
        P.liveK = new Set(P.liveN.map(([r, s]) => r.uid * MAXSEC + s));
        return P;
      }

      /* ---- the render side (no allocation) */
      install(P) { // a plan's wiring and masks into the modules; the late reads' history from the sources' last samples
        const wR = P.wR, wS = P.wS, wB = P.wB, mR = P.mR, mM = P.mM, dF = P.dF, CH1 = this.CH - 1;
        for (let k = 0; k < P.nW; k++) wR[k].m.ins[wS[k]] = wB[k];
        for (let k = 0; k < P.nM; k++) mR[k].m.om = mM[k];
        for (let k = 0; k < P.nDF; k++) {
          const f = dF[k], d = f.d, s = f.s, l = f.l;
          for (let j = 0; j < f.n; j++) if (d[j] === 1) l[j] = s[j][CH1];
          if (f.pre === 1) f.l0 = f.s0[CH1];
        }
      }
      settle() { const T = this.pend; this.pend = null; this.cur = T.next; this.install(this.cur); }
      glide(r) { // one chunk of the knobs' one-pole glide → 1 when a value moved
        const m = r.m, p = m.p, t = m.t, k = this.kG, n = p.length;
        let mv = 0, gl = 0;
        for (let i = 0; i < n; i++) {
          const ti = t[i];
          let v = p[i];
          if (v === ti) continue;
          v += (ti - v) * k;
          if (Math.abs(ti - v) < 1e-6 * (1 + Math.abs(ti))) v = ti; else gl = 1;
          p[i] = v; mv = 1;
        }
        r.gl = gl;
        return mv;
      }
      feedRun(f, i0, n) {
        const z = f.z, e = i0 + n, S = f.s, G = f.g, nE = f.n;
        if (f.rp === 0 && f.hd === 0) { // a sum (block steps): source by source
          const s0 = S[0], g0 = G[0];
          if (g0 === 1) for (let i = i0; i < e; i++) z[i] = s0[i]; else for (let i = i0; i < e; i++) z[i] = g0 * s0[i];
          for (let k = 1; k < nE; k++) { const sk = S[k], gk = G[k]; for (let i = i0; i < e; i++) z[i] += gk * sk[i]; }
          return;
        }
        const D = f.d, Lv = f.l, nA = f.nA, RT = this.RT;
        for (let i = i0; i < e; i++) {
          let vA = 0, vB = 0;
          for (let k = 0; k < nE; k++) {
            let x = S[k][i];
            if (D[k] === 1) { x = i > 0 ? S[k][i - 1] : Lv[k]; x = x > LATE ? LATE : x < -LATE ? -LATE : x === x ? x : 0; }
            const y = G[k] * x;
            if (k < nA) vA = k === 0 ? y : vA + y; else vB = k === nA ? y : vB + y;
          }
          if (f.rp === 1) {
            const len = f.len, p = f.pos < len ? ++f.pos : len;
            z[i] = p >= len ? vB : f.sw === 1 ? (2 * p >= len ? vB : vA) : vA + (vB - vA) * RT[p];
          } else z[i] = vB;
        }
      }
      loopRun(st, i0, i1) { // a loop step over samples [i0, i1): per sample, the back-edges, then each member after its feeds
        const ms = st.ms, sc = st.secs, nm = st.nm, pre = st.pre, np = st.nPre, mf = st.mf, mfS = st.mfS;
        for (let i = i0; i < i1; i++) {
          for (let k = 0; k < np; k++) { const f = pre[k], x = i > 0 ? f.s0[i - 1] : f.l0; f.z[i] = f.k0 * (x > LATE ? LATE : x < -LATE ? -LATE : x === x ? x : 0); }
          for (let k = 0; k < nm; k++) {
            for (let j = mfS[k], e = mfS[k + 1]; j < e; j++) this.feedRun(mf[j], i, 1);
            ms[k].run(sc[k], i, 1);
          }
        }
      }
      loopEnd(st) { // the late reads' history: each source's last sample of the chunk
        const CH1 = this.CH - 1, pre = st.pre, dl = st.dl;
        for (let k = 0; k < st.nPre; k++) { const f = pre[k]; f.l0 = f.s0[CH1]; }
        for (let k = 0; k < st.nDl; k++) { const f = dl[k], d = f.d, s = f.s, l = f.l; for (let j = 0; j < f.n; j++) if (d[j] === 1) l[j] = s[j][CH1]; }
      }
      ctlAll(P, cc) { // the chunk's control step: the flush (every 32nd absolute chunk), the glide, each module's ctl once
        const R = P.recs, nR = P.nR;
        if ((cc & (FLUSH_N - 1)) === 0) for (let k = 0; k < nR; k++) { const m = R[k].m; if (typeof m.flush === 'function') m.flush(); }
        for (let k = 0; k < nR; k++) {
          const r = R[k], m = r.m;
          let mv = r.mv1;
          r.mv1 = 0;
          if (r.gl === 1 && this.glide(r) === 1) mv = 1;
          if (mv === 1 || r.mvw === 1) { m.mv = mv; r.mvw = mv; } // (a 1 always, a 0 once after it: the store is megamorphic)
          m.ctl(cc);
          if (r.fresh === 1) r.fresh = 0;
        }
        let g = this.outK;
        const m0 = P.m0;
        if (m0 !== null) { const v = m0.og; if (typeof v === 'number' && v === v) g = v; }
        return g;
      }
      sinkRun(P, buf, c0, i0, n, g0, g1) { // MAIN OUT × og (linear across the chunk when it moved) into buf
        if (P.sinkF !== null) this.feedRun(P.sinkF, i0, n);
        if (P.sinkOn === 0) return;
        const x = P.sinkB, e = i0 + n;
        if (g0 === g1) { for (let i = i0; i < e; i++) buf[c0 + i] += x[i] * g1; return; }
        const dg = (g1 - g0) / this.CH;
        for (let i = i0; i < e; i++) buf[c0 + i] += x[i] * (g0 + dg * (i + 1));
      }
      // (render is a thin loop over chunk(): its own arguments come as a small integer or a heap number as the caller's field
      // happens to be, and a compiled render that meets the other kind deopts — left in the interpreter at the end of a warm-up,
      // the whole chunk body ran there for a Track's first quanta; chunk() is called 32 times a quantum and tiers up at once)
      render(buf, N, F0) {
        if (this.pend === null && this.cur === null) return;
        const CH = this.CH;
        let cc = Math.floor(F0 / 4);
        for (let c0 = 0; c0 < N; c0 += CH, cc++) this.chunk(buf, c0, cc);
      }
      chunk(buf, c0, cc) { // one chunk: the control step, then every step of the plan, then MAIN OUT into buf
        const CH = this.CH, P = this.pend !== null ? this.pend : this.cur, g1 = this.ctlAll(P, cc), g0 = this.g0 === this.g0 ? this.g0 : g1;
        const S = P.steps, nS = P.nS;
        if (this.ps === 0) {
          for (let s = 0; s < nS; s++) {
            const st = S[s];
            if (st.loop === 0) { const F = st.F; for (let j = 0; j < st.nF; j++) this.feedRun(F[j], 0, CH); st.m.run(st.sec, 0, CH); }
            else { this.loopRun(st, 0, CH); this.loopEnd(st); }
          }
          this.sinkRun(P, buf, c0, 0, CH, g0, g1);
        } else { // (tests: the whole schedule per sample — the reference the block steps must equal)
          for (let i = 0; i < CH; i++) {
            for (let s = 0; s < nS; s++) {
              const st = S[s];
              if (st.loop === 0) { const F = st.F; for (let j = 0; j < st.nF; j++) this.feedRun(F[j], i, 1); st.m.run(st.sec, i, 1); }
              else this.loopRun(st, i, i + 1);
            }
            this.sinkRun(P, buf, c0, i, 1, g0, g1);
          }
          for (let s = 0; s < nS; s++) if (S[s].loop === 1) this.loopEnd(S[s]);
        }
        this.g0 = g1;
        if (P === this.pend && --P.left === 0) this.settle();
      }
      live() { return this.pend !== null || (this.cur !== null && this.cur.sinkOn === 1); }
      reset() {
        if (this.pend !== null) { this.cur = this.pend.next; this.pend = null; }
        this.g0 = NaN;
        const P = this.cur;
        if (P === null) return;
        for (let k = 0; k < P.nAll; k++) {
          const r = P.all[k], m = r.m, O = m.outs;
          if (typeof m.reset === 'function') m.reset();
          for (let j = 0; j < r.TI.nOutT; j++) O[j].fill(0);
          m.p.set(m.t); r.gl = 0; r.mv1 = 1; r.fresh = 1;
        }
        this.install(P);
      }
      setOS(os, fs) {
        os = os > 0 ? os | 0 : 1;
        if (this.pend !== null) this.settle();
        this.rate(os, fs > 0 ? fs : this.base * os);
        const P = this.cur;
        if (P === null) return;
        for (let k = 0; k < P.nAll; k++) { const r = P.all[k]; if (typeof r.m.setOS === 'function') r.m.setOS(this.fs); r.mv1 = 1; }
        this.install(P);
      }
      setSalt(s) {
        this.salt = s | 0;
        const P = this.lat;
        if (P !== null) for (let k = 0; k < P.nAll; k++) { const m = P.all[k].m; if (typeof m.setSalt === 'function') m.setSalt(this.salt); }
      }
      mon() {
        const P = this.pend !== null ? this.pend : this.cur, L = this.lat;
        return {
          mods: L !== null ? L.all.map(r => [r.n, r.type]) : [], os: this.OS, ch: this.CH, rampCh: this.rampCh,
          steps: P !== null ? P.steps.map(s => ({ loop: s.loop, nodes: s.at.map(a => a.slice()) })) : [],
          live: P !== null ? P.liveN.map(([r, s]) => [r.n, s]) : [], run: P !== null ? P.recs.map(r => r.n) : [],
          om: P !== null ? P.recs.map(r => [r.n, r.m.om]) : [], pend: this.pend !== null, left: this.pend !== null ? this.pend.left : 0,
          ramps: this.pend !== null ? this.pend.nRamp : 0, out: this.live(), why: this.why.slice(),
        };
      }
    }
    function same(a, b) {
      if (a === b) return true;
      if (!a || !b || a.length !== b.length) return false;
      for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; if (x.r !== y.r || x.o !== y.o || x.g !== y.g || x.c !== y.c) return false; }
      return true;
    }
    function create(inst, family) {
      try {
        const F = globalThis[famName(family)];
        if (!F || typeof F !== 'object' || !F.T || !F.JACKS) return null;
        return new Machine(inst, famTable(F));
      } catch (err) { return null; }
    }

    globalThis.PatchDSP = Object.freeze({ VER, CHMAX, RAMP_S, GLIDE_S, FLUSH_N, MAXM, MAXC, GMAX, create, schedule });
  } catch (err) {
    globalThis.PatchDSP = null;                                // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('patch-dsp: load failed', err);
  }
})();
