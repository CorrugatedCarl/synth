import './v8-guard.mjs';
// IMPL-FR §9 G4 (FR3, rate independence; lane H-A): one scripted feed painted with the frame clock at config({ display: 60 })
// and config({ display: 240 }) — at the shared 60 Hz frame times every post- and decay-driven value agrees within 1e-6:
//  - the master OUT's true-peak levels and the Master row's bars (master-ui on tests/wk-dom.mjs; mmon summaries delivered
//    just before shared frames: the OUT lands a summary at the next frame, the row at once), the graph editors' overlay keys
//    (Curve / Env / Path playheads from providers that move with the time — 29 Hz steps and every-frame motion);
//  - the head meters of the page (main.js booted in the simulation, tests/main-sim.mjs, o.clock 'std': performance.now() is
//    the scripted time), each track's analyser stubbed to a non-zero window only at the shared 60 Hz frame times (§13 P2-7:
//    the analyser-sampled meters are compared on such a stub, never on a live signal), and the transport's texts; the head
//    meters' fall per second equal (0.88 per 16.667 ms: 0.88^60 a second).
// Frames are driven exactly: the time of every frame is computed (shared ones bit-identical in both runs), never summed.
// Never passes fake-DOM nodes to assert.* (numbers and strings only). Run alone:
//   node --max-old-space-size=2048 --test tests/fps-determinism.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, place } from './wk-dom.mjs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as wk from '../wk.js?v=9';
import * as U from '../master-ui.js?v=9';
import * as G from '../graph.js?v=9';

const P60 = 1000 / 60;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol || (a === b), `${msg}: ${a} vs ${b} (±${tol})`);
// drives `ms` of frames at hz (a multiple of 60): before each frame feed(t, shared, j), then the queued rAF callbacks at
// t0 + t, then at each shared 60 Hz frame sample(t, j). Frame k of the 60 Hz grid j: t = j·P60 + k·(1000 / hz)
function drive(hz, ms, feed, sample, rafQ, t0 = 0) {
  const per = hz / 60;
  for (let j = 0; j * P60 <= ms + 1e-6; j++) {
    for (let k = 0; k < per; k++) {
      const t = j * P60 + k * (1000 / hz);
      feed(t, k === 0, j);
      const q = rafQ.splice(0);
      for (const f of q) f(t0 + t);
      if (k === 0) sample(t, j);
    }
  }
}

/* ============================================================ master-ui and the graph editors (the fake DOM) */
test('G4: the master OUT\'s true peaks, the Master row\'s bars and the Curve / Env / Path overlay keys agree at the shared 60 Hz frames when painted at 60 and at 240 fps', () => {
  const runs = {};
  for (const hz of [60, 240]) {
    const d = fresh(), rafQ = [];
    globalThis.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
    globalThis.cancelAnimationFrame = id => { if (rafQ[id - 1]) rafQ[id - 1] = () => {}; };
    wk.clock._reset(); wk.clock.config({ display: hz });
    let now = 0;
    try {
      const out = U.createMasterOut(d.body, { doc: d, now: () => now });
      const row = U.createMasterRow(d.body, { doc: d, now: () => now });
      out.setLive(true);
      const off = wk.clock.add({ name: 'host', essential: true, fn: t => out.draw(t) }); // (main.js's frameTick: the OUT at the cap)
      // the playheads: an LFO dot stepping with 29 Hz posts, an envelope's stage and time, a path's point moving every frame
      const host = d.createElement('div');
      d.body.appendChild(host);
      const step = () => Math.floor(now / 34.5);
      const cur = new G.CurveEditor(host, { kind: 'lfo', get: () => [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]], set() {}, playhead: () => (step() % 50) / 50 });
      const env = new G.EnvEditor(host, { env: () => ({ a: 1, h: 0.5, d: 1, s: 0.5, r: 1 }), set() {}, lock: () => true, playhead: () => ({ stage: 1 + (step() >> 3) % 5, t: (step() % 8) / 10 }) });
      const pth = new G.PathEditor(host, { get: () => [[0.1, 0.2, 0], [0.5, 0.9, 0], [0.9, 0.3, 0]], set() {}, playhead: () => [(now % 1000) / 1000, 0.5] });
      for (const e of [cur, env, pth]) { place(e.root, 0, 0, 214, 160); e.refresh(); }
      const S = [];
      // the feed: a loud passage (peaks every 33.3 ms, just before every second shared frame), then silence summaries
      drive(hz, 3000, (t, shared, j) => {
        now = t;
        if (!shared || j % 2) return;
        const loud = t < 400, k = j / 2;
        const sm = loud ? { m: -10, s: -11, i: -12, tp: [-2 - (k % 5), -6 - (k % 3)], pk: [-4 - (k % 4), -9 - (k % 6)], corr: 0.5 } : { m: -Infinity, s: -Infinity, tp: [-Infinity, -Infinity], pk: [-Infinity, -Infinity] };
        out.update(sm); row.update(sm);
      }, () => {
        const o = out.state().tp, r = row.state().pk;
        S.push([o[0], o[1], r[0], r[1], cur.ph, env.phS, env.phT, pth.phX, pth.phY]);
      }, rafQ);
      runs[hz] = S;
      off(); out.destroy(); row.destroy(); cur.destroy(); env.destroy(); pth.destroy();
    } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; wk.clock._reset(); }
  }
  const A = runs[60], B = runs[240];
  assert.equal(A.length, B.length);
  assert.ok(A.length >= 150, 'frames sampled: ' + A.length);
  const names = ['OUT tp L', 'OUT tp R', 'row pk L', 'row pk R', 'Curve key', 'Env stage', 'Env t key', 'Path x key', 'Path y key'];
  for (let j = 0; j < A.length; j++) for (let c = 0; c < names.length; c++) near(A[j][c], B[j][c], 1e-6, names[c] + ' at frame ' + j);
  // the scene moved: the peaks rose and fell to rest, the keys changed
  const col = c => A.map(x => x[c]);
  assert.ok(Math.max(...col(0)) > -3 && col(0).at(-1) === U.TP_LO && Math.max(...col(2)) > -5 && col(2).at(-1) === U.PK_LO, 'the bars rose, then rested');
  for (const [c, m] of [[4, 10], [5, 4], [6, 5], [7, 10]]) assert.ok(new Set(col(c)).size > m, names[c] + ' moved: ' + new Set(col(c)).size);
});

/* ============================================================ the page's head meters and transport (main.js in the simulation) */
test('G4: the head meters (analysers non-zero only at the shared 60 Hz frames) and the transport texts agree at the shared frames at 60 and 240 fps; the fall is 0.88^60 a second at both', async () => {
  const runs = {};
  for (const hz of [60, 240]) {
    const s = await bootMain({ clock: 'std', hash: '#serum', ls: fakeStorage({}) });
    await s.power(); await s.settle(5);
    const api = s.api;
    api.addTrack(); s.raf(); await s.settle(3);
    const tracks = api.project().tracks.slice(0, 2), Ns = tracks.map(t => api.nodes.get(t.id));
    assert.ok(Ns.every(N => N && N.an), 'two tracks with their nodes');
    let shared = false, j0 = 0;
    // a burst of peaks for the first 0.5 s (a different level per track and frame), silence after
    Ns.forEach((N, i) => { N.an.getFloatTimeDomainData = a => { a.fill(0); if (shared && j0 < 30) a[5 + i] = (i ? 0.3 : 0.7) * (1 - (j0 % 7) / 10); }; });
    api.project().metronome.countIn = 0;
    s.$('#tPlay').click(); await s.settle(2);
    s.run(2400);
    wk.clock.config({ display: hz });
    const T0 = s.ms + 100, rafQ = { splice: () => s.rafQ.splice(0) }, S = [];
    // the audio runs along at the shared frames only (the same render in both runs): the heard clock moves with the frames
    drive(hz, 1500, (t, sh, j) => { s.ms = T0 + t; shared = sh; j0 = j; if (sh) s.run(768, false); }, () => {
      S.push([Ns[0].peak, Ns[1].peak, s.$('#tBBT').textContent, s.$('#tTime').textContent]);
    }, rafQ, T0);
    s.$('#tPlay').click(); await s.settle(2);
    runs[hz] = S;
  }
  const A = runs[60], B = runs[240];
  assert.equal(A.length, B.length);
  for (let j = 0; j < A.length; j++) {
    near(A[j][0], B[j][0], 1e-6, 'head meter 1 at frame ' + j);
    near(A[j][1], B[j][1], 1e-6, 'head meter 2 at frame ' + j);
    assert.equal(A[j][2] + ' ' + A[j][3], B[j][2] + ' ' + B[j][3], 'the transport at frame ' + j);
  }
  // after the last peak (frame 29), a second of fall: 0.88^60 at both rates
  for (const S of [A, B]) near(S[89][0] / S[29][0], Math.pow(0.88, 60), 1e-9, 'the fall per second');
  assert.ok(A[29][0] > 0.4 && A[29][1] > 0.1 && A.at(-1)[0] < 1e-3, 'the meters rose and fell');
  assert.ok(new Set(A.map(x => x[3])).size > 50, 'the transport moved');
});
