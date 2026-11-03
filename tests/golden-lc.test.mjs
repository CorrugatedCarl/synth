import './v8-guard.mjs';
// Stage LC's frozen ref (docs/canvas/IMPL-LC.md §10): the combiners project (tests/ref-LC/record.mjs — a Juno with three track LFOs
// into an Add combiner, a Wavecraft's own three LFOs into a Multiply one onto its cutoff and a Utility's pan, the master's two LFOs into
// a combiner onto a Delay's mix; 128 BPM) rendered live through the page simulation (▶, a 2-bar loop wrapping once) and bounced —
// every node's output and the bounce, hash for hash, against tests/ref-LC/live.sha and bounce.sha. Those are recorded ONCE by the lead
// at integration (`node --max-old-space-size=2048 tests/ref-LC/record.mjs --write` on the merged tree); until then this test fails
// with that instruction (a missing reference is never a pass). Strings only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/golden-lc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { record, FILES } from './ref-LC/record.mjs';

test('LC §10: the combiners project, live (every node) and bounced, hash for hash against tests/ref-LC', async () => {
  for (const k of ['live', 'bounce']) assert.ok(existsSync(FILES[k]), `tests/ref-LC/${k}.sha is not recorded yet — the lead records it once at integration: node --max-old-space-size=2048 tests/ref-LC/record.mjs --write`);
  const r = await record();
  for (const k of ['live', 'bounce']) {
    const ref = readFileSync(FILES[k], 'utf8').split('\n').filter(Boolean), got = r[k].split('\n').filter(Boolean);
    assert.ok(ref.length >= 3, k + ': a real reference');
    assert.equal(got.length, ref.length, k + ': as many lines (nodes)');
    for (let i = 0; i < ref.length; i++) assert.equal(got[i], ref[i], k + ' line ' + i);
  }
});
