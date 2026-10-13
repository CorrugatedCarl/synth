// Golden shard 3 (owner I; SPEC-serum2 §15.1 item 3): every preset (and the default panel) of the 12 classic models
// through the event script, ref-p1 engine vs the current engine, default FX rack: bit-identical (non-negotiable 1:
// the classic models stay sample-identical). The TB-303 renders run its step sequencer locked to the song transport.
// Default: 48 kHz at the app's 4× and 44.1 kHz at 1×; GOLDEN_FULL=1 adds 48 kHz 2× and 8× and 96 kHz 2×.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './golden-harness.mjs';

const [A, B] = await H.sides();
const RATES = H.FULL ? [[48000, 4], [44100, 1], [48000, 2], [48000, 8], [96000, 2]] : [[48000, 4], [44100, 1]];
const MODELS = A.models.MODELS.filter(m => !m.custom);
const st = (n, o, a, s, g = 1) => ({ n, o, a, s, g });
const SEQ303 = { pat: [st(0, 0, 1, 0), st(0, 0, 0, 0), st(12, 0, 0, 1), st(0, 0, 0, 0), st(3, 0, 1, 0), st(0, 0, 0, 1), st(10, 0, 0, 0), st(0, 0, 0, 0, 0),
  st(0, 0, 1, 0), st(7, 0, 0, 1), st(5, 0, 0, 0), st(3, 0, 0, 0), st(12, 0, 1, 1), st(0, 1, 0, 0), st(5, 0, 0, 0), st(6, 0, 1, 0)],
len: 16, bpm: 120, swing: 0.1, root: 48, sync: true, run: false };

test('the frozen and the current model lists agree (12 classic models, their presets)', () => {
  assert.equal(MODELS.length, 12);
  for (const m of MODELS) {
    const n = B.models.MODELS.find(x => x.id === m.id);
    assert.ok(n, m.id + ' still exists');
    assert.deepEqual(n.presets.slice(0, m.presets.length).map(p => p.name), m.presets.map(p => p.name), m.id + ' presets');
  }
});

test('the scopes’ Math.random is mulberry32(fnv1a32(render id)), reseeded per render (Solina Divide phases, §0.4)', () => {
  const r = id => H.renderTrack(A, { id, model: 'solina', vals: H.classicVals(A, 'solina', null), fx: A.core.defaultFx(), os: 1, hostOS: 1, seconds: 0.5 });
  const a = r('seed-check'), b = r('seed-check'), c = r('seed-check-2');
  assert.equal(H.compare(a, b).max, 0, 'same id: same render');
  assert.ok(H.compare(a, c).max > 0, 'another id: other divider phases');
  assert.ok(H.scope(A).math !== Math && H.scope(A).math.random !== Math.random, 'the test realm keeps its own Math.random');
});

for (const [sr, os] of RATES) {
  test(`every classic preset at ${sr / 1000} kHz × ${os}: ref-p1 engine vs current engine, bit-identical`, () => {
    const bad = [];
    let n = 0;
    for (const m of MODELS) {
      for (const pr of [null, ...m.presets]) {
        const id = `classic:${m.id}:${pr ? pr.name : '(default)'}:${sr}:${os}`, r = [];
        for (const X of [A, B]) {
          r.push(H.renderTrack(X, { id, model: m.id, vals: H.classicVals(A, m.id, pr), fx: H.fxState(X, A.core.defaultFx()), os, hostOS: os, sr,
            events: H.script(sr), seq: m.id === 'tb303' ? SEQ303 : null }));
        }
        n++;
        if (!H.finite(r[0]) || !(H.peak(r[0]) > 1e-3)) bad.push(`${id}: reference render silent or not finite`);
        const d = H.compare(r[0], r[1]);
        if (d.max !== 0) bad.push(`${id}: ${H.describe(d, sr)}`);
      }
    }
    assert.equal(n, 12 + MODELS.reduce((k, m) => k + m.presets.length, 0));
    assert.deepEqual(bad, []);
  });
}

// RULINGS2 bug fix 1 — the expected-different golden cases (H.TRANSPORT_CASES; documented in tests/ref-p1/MANIFEST.json
// "notes"): the reference drops the song notes at a play / seek tick handled after an unaligned frame and loop-start notes
// at unaligned or rounded wraps; the current engine plays them at the span boundary handling the start / wrap. Proof per
// case: (1) every note-on of the reference happens in the current engine at the same frame; (2) the current engine's
// extra note-ons are exactly the notes at the anchor ticks, each ≤ 4 frames after its start / wrap frame (loops: at every
// wrap); (3) the audio is bit-identical up to the first extra note-on and differs after it. Unaligned start: (4) the
// reference equals the current engine rendering the song without the dropped notes, bit for bit.
const key = e => e[0] + ':' + e[1];
for (const c of H.TRANSPORT_CASES) {
  test(`transport note-drop fix (expected different): ${c.name}`, () => {
    const a = H.renderTransportCase(A, c), b = H.renderTransportCase(B, c);
    const fpt = c.sr * 60 / (c.bpm * H.PPQ), N = a.L.length;
    const notesAt = t => { const r = []; for (let j = 0; j < c.notes.length; j += 4) if (c.notes[j] === t) r.push(c.notes[j + 2]); return r; };
    // anchors: [frame, notes due there]
    const anchors = [];
    if (c.loop) {
      const [f0, m] = c.tp[0], L = (m.le - m.ls) * fpt;
      for (let k = 1; f0 + k * L < N; k++) anchors.push([f0 + k * L, notesAt(m.ls)]);
    } else for (const [f, m] of c.tp) if (c.anchorTicks.includes(m.tick)) anchors.push([f, notesAt(m.tick)]);
    // (1) the reference's note-ons are a sub-multiset of the current engine's, frame for frame
    const rest = new Map();
    for (const e of b.log) rest.set(key(e), (rest.get(key(e)) || 0) + 1);
    for (const e of a.log) {
      const n = rest.get(key(e)) || 0;
      assert.ok(n > 0, `the reference's note-on ${key(e)} also happens in the current engine`);
      rest.set(key(e), n - 1);
    }
    const extra = b.log.filter(e => { const n = rest.get(key(e)) || 0; if (n > 0) { rest.set(key(e), n - 1); return true; } return false; });
    // (2) the extra note-ons: the anchor notes, ≤ 4 frames after their anchor frame (one span; a rounded wrap: exactly 4)
    assert.ok(extra.length > 0, 'the reference drops notes in this case');
    for (const [f, n] of extra) {
      assert.ok(anchors.some(([af, ns]) => f >= af && f <= af + 4 + 1e-6 && ns.includes(n)), `extra note-on ${n} at frame ${f} is an anchor note (anchors ${JSON.stringify(anchors.map(x => [+x[0].toFixed(3), x[1]]))})`);
    }
    for (const [af, ns] of anchors) {
      const got = b.log.filter(([f]) => f >= af && f <= af + 4 + 1e-6).map(e => e[1]).sort();
      assert.deepEqual(got, ns.slice().sort(), `the current engine plays the notes at the anchor frame ${af.toFixed(3)}`);
    }
    if (!c.loop) assert.deepEqual(extra.map(e => e[1]).sort(), anchors.flatMap(x => x[1]).sort(), 'exactly the start / seek tick notes were dropped');
    // (3) bit-identical until the first extra note-on, different after it
    const f1 = Math.min(...extra.map(e => e[0]));
    let pre = 0, post = 0;
    for (const ch of ['L', 'R']) for (let i = 0; i < N; i++) { const d = Math.abs(a[ch][i] - b[ch][i]); if (i < f1) pre = Math.max(pre, d); else post = Math.max(post, d); }
    assert.equal(pre, 0, 'identical before the first restored note');
    assert.ok(post > 1e-3, 'the restored notes sound: ' + post);
    // (4) unaligned start: the reference = the current engine without the dropped notes
    if (!c.loop && c.tp.length === 1) {
      const t0 = c.tp[0][1].tick, keep = [];
      for (let j = 0; j < c.notes.length; j += 4) if (c.notes[j] !== t0) keep.push(...c.notes.slice(j, j + 4));
      const b2 = H.renderTransportCase(B, Object.assign({}, c, { notes: keep }));
      assert.equal(H.compare(a, b2).max, 0, 'reference ≡ current engine without the start-tick notes');
    }
  });
}
