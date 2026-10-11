// Test stub of wt.js for tests/serum-ui.test.mjs (records the conversions serum-ui asks for).
export const __stub = true;
export const calls = [];
export function expandTable() { return new Float32Array(256 * 2048); }
export function makeNoise() {
  const L = new Float32Array(4096);
  for (let i = 0; i < L.length; i++) L[i] = Math.sin(i / 7);
  return { levels: [{ L }] };
}
export function generateNoise(id) {
  calls.push(['generateNoise', id]);
  const L = new Float32Array(4096);
  for (let i = 0; i < L.length; i++) L[i] = Math.sin(i / 5);
  return { name: id, ch: 1, len: L.length, rate: 48000, root: 60, oneshot: 0, loopStart: 0, loopEnd: L.length, L, R: null };
}
// a 1000-sample mono file; an 8-byte buffer stands for a file with a smpl loop
export function readWav(buf) {
  calls.push(['readWav', buf.byteLength]);
  return { sr: 44100, ch: [new Float32Array(1000)], loop: buf.byteLength === 8 ? { start: 100, end: 900 } : null };
}
export function frameToPoints(frame, n) { calls.push(['frameToPoints', n]); return [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]]; }
export function ptsToFrame(tab) { calls.push(['ptsToFrame', tab.length]); return new Float32Array(2048); }
export function lfoToNoise(tab, name) {
  calls.push(['lfoToNoise', tab.length]);
  return { kind: 'noise', name: name || 'LFO', rate: 535821, ch: 1, len: 2048, loopStart: 0, loopEnd: 2048, root: 60, L: new Float32Array(2048), R: null };
}
export function bandlimit() { return new Float32Array(2048); }
export function factoryTable(id) { return { name: id, frames: [new Float32Array(2048)], morph: 0, factory: 1 }; }
export function parseSplitSize(t) { const n = parseInt(t, 10); return n > 0 && n < 10000 ? n : null; }
