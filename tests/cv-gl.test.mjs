import './v8-guard.mjs';
// cv-gl.js (stage 1h, lane G; docs/canvas/IMPL-1h.md §2): gridUniforms (the 2D path's maths: floors, fade, sizes, folded
// origins), createGL on a fake WebGL2 context (null without one; programs compiled once; resize sets the buffer; upload /
// free bytes accounting with mips ×4/3; draw order and call counts; context loss → textures dead; three losses → destroy).
// Fake DOM: tests/wk-dom.mjs. Never pass fake-DOM nodes (or the fake gl) to assert.*: primitives or JSON only.
// Run alone: node --max-old-space-size=2048 --test tests/cv-gl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as G from '../cv-gl.js?v=9';
import * as W from '../cv-world.js?v=9';

const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ': ' + a + ' vs ' + b + ' (±' + tol + ')');
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------ a fake WebGL2 context: records every call */
const ENUMS = ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'TRIANGLES', 'TRIANGLE_STRIP',
  'TEXTURE_2D', 'RGBA8', 'RGBA', 'UNSIGNED_BYTE', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TEXTURE_MAG_FILTER', 'TEXTURE_MIN_FILTER', 'CLAMP_TO_EDGE',
  'LINEAR', 'LINEAR_MIPMAP_LINEAR', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST', 'SCISSOR_TEST',
  'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNPACK_FLIP_Y_WEBGL', 'TEXTURE0'];
function fakeGL(o = {}) {
  const calls = [], gl = { calls, n: { shader: 0, program: 0, texture: 0 }, ext: null };
  ENUMS.forEach((k, i) => { gl[k] = 1000 + i; });
  const rec = (k, a) => { calls.push([k, ...a.map(x => (x && typeof x === 'object' && !ArrayBuffer.isView(x) ? x.tag || '[obj]' : ArrayBuffer.isView(x) ? Array.from(x) : x))]); };
  const fn = (k, r) => { gl[k] = (...a) => { rec(k, a); return typeof r === 'function' ? r(...a) : r; }; };
  for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'useProgram', 'bindVertexArray', 'bindBuffer',
    'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'uniform3f', 'uniform1i', 'uniform4fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'pixelStorei',
    'activeTexture', 'viewport', 'clear', 'drawArrays', 'bindTexture', 'texImage2D', 'texParameteri', 'generateMipmap', 'deleteTexture', 'deleteBuffer', 'deleteVertexArray']) fn(k);
  fn('createShader', () => ({ tag: 'shader' + (++gl.n.shader) }));
  fn('createProgram', () => ({ tag: 'program' + (++gl.n.program) }));
  fn('createTexture', () => ({ tag: 'tex' + (++gl.n.texture) }));
  fn('createBuffer', () => ({ tag: 'buf' }));
  fn('createVertexArray', () => ({ tag: 'vao' }));
  fn('getUniformLocation', (p, name) => ({ tag: 'u:' + name }));
  fn('getShaderParameter', () => !o.failShader);
  fn('getProgramParameter', () => !o.failLink);
  fn('getShaderInfoLog', () => 'nope'); fn('getProgramInfoLog', () => 'nope');
  fn('getExtension', name => (name === 'WEBGL_lose_context' ? (gl.ext = gl.ext || { lost: 0, loseContext() { this.lost++; } }) : null));
  gl.count = k => calls.filter(c => c[0] === k).length;
  gl.since = i => calls.slice(i).map(c => c[0]);
  return gl;
}
// a viewport with #world in it; its canvases answer getContext('webgl2') with the fake (or null)
function setup(o = {}) {
  const d = dom.fresh(), win = d.defaultView, vp = d.createElement('div'), w = d.createElement('div');
  vp.id = 'viewport'; w.id = 'world'; vp.append(w); d.body.append(vp);
  const gl = o.gl === null ? null : o.gl || fakeGL(o);
  const made = [];
  const doc = { createElement: tag => { const el = d.createElement(tag); if (tag === 'canvas') { made.push(el); el.getContext = kind => (kind === 'webgl2' ? gl : null); } return el; } };
  let T = 0;
  const ev = [];
  const GL = G.createGL(vp, { doc, win, world: w, test: !!o.test, now: () => T, onLost: dead => ev.push(['lost', dead]), onRestored: () => ev.push(['restored']) });
  return { d, win, vp, w, gl, made, GL, ev, tick: ms => { T += ms; }, fire: type => { const e = { type, prevented: false, preventDefault() { this.prevented = true; } }; made[0].dispatchEvent(Object.assign(new dom.Ev(type), { preventDefault: () => { e.prevented = true; } })); return e; } };
}
const src = (w, h) => ({ width: w, height: h, tag: 'src' });

/* ------------------------------------------------------------------ gridUniforms */
test('gridUniforms: the 2D path\'s maths — buffer size, periods and folded origins, sizes = gridSizes(d), the fade of gridBg, the GRID_MIN_DPX floors', () => {
  eq([G.LOSS_MAX, G.LOSS_WINDOW_MS], [3, 60000]);
  const u = G.gridUniforms({ tx: 100, ty: -40, k: 1 }, 1440, 900, 2);
  eq([u.w, u.h, u.s, u.S, u.side, u.r, u.a, u.minorA, u.majorA, u.minor, u.major, u.d, u.k, u.tx, u.ty], [2880, 1800, 64, 256, 3, 2, 1, 0.15, 0.24, true, true, 2, 1, 100, -40]);
  eq([u.ox, u.oy, u.OX, u.OY], [200 % 64, (-80 % 256 + 256) % 64, 200, 256 - 80], 'origins = t·d folded into [0, period)');
  eq(G.gridUniforms({ tx: 0, ty: 0, k: 1 }, 1000.4, 600.6, 1).w + ',' + G.gridUniforms({ tx: 0, ty: 0, k: 1 }, 1000.4, 600.6, 1).h, '1000,601', 'round(vw·d) × round(vh·d)');
  for (const d of [1, 2, 3]) { const z = W.gridSizes(d), g = G.gridUniforms({ tx: 0, ty: 0, k: 1 }, 100, 100, d); eq([g.side, g.r], [z.side, z.side && z.r], 'sizes at d ' + d); }
  // the fade: gridBg's alpha, ×0.15 rounded to 3 decimals (gridDraw's fillStyle)
  for (const k of [0.25, 0.4, 0.5, 0.6, 0.75, 1, 2]) {
    const a = W.gridBg({ tx: 0, ty: 0, k }).minor.a, g = G.gridUniforms({ tx: 0, ty: 0, k }, 800, 600, 2);
    eq([g.a, g.minorA, g.minor], [a, a > 0 ? Math.round(0.15 * a * 1000) / 1000 : 0, a > 0], 'k ' + k);
  }
  // the floors: minor below DOT·k·d < 6 (only reachable with the fade gone anyway), major below MAJOR·k·d < 6
  const lo = G.gridUniforms({ tx: 0, ty: 0, k: 0.04 }, 800, 600, 1);
  eq([lo.minor, lo.minorA, lo.major, lo.majorA, lo.S], [false, 0, false, 0, 5.12], 'k 0.04: both floors');
  const mid = G.gridUniforms({ tx: 0, ty: 0, k: 0.1 }, 800, 600, 1);
  eq([mid.minor, mid.major, mid.majorA], [false, true, 0.24], 'k 0.1 at d 1: minor 3.2 px apart (off), major 12.8 (on)');
  eq(G.gridUniforms({ tx: 0, ty: 0, k: 0.25 }, 800, 600, 1).major, true, 'K_MIN: the major layer always');
  // random cameras: a dot's centre from the folded origin lands on a world multiple
  const R = rng(5);
  for (let i = 0; i < 200; i++) {
    const c = { tx: (R() - 0.5) * 6000, ty: (R() - 0.5) * 6000, k: 0.25 + R() * 1.75 }, d = [1, 2, 3][i % 3], g = G.gridUniforms(c, 1000, 700, d);
    ok(g.ox >= 0 && g.ox < g.s && g.OX >= 0 && g.OX < g.S, 'folded ' + JSON.stringify([g.ox, g.s, g.OX, g.S]));
    const wx = ((g.ox + 3 * g.s) / d - c.tx) / c.k, WX = ((g.OX + 2 * g.S) / d - c.tx) / c.k; // a minor / a major centre back in world px
    near(wx / 32, Math.round(wx / 32), 1e-6, 'a minor centre on a DOT multiple'); near(WX / 128, Math.round(WX / 128), 1e-6, 'a major centre on a MAJOR multiple');
  }
  eq(G.gridUniforms({ tx: NaN, ty: 0, k: 0 }, 0, 0, 0).w, 0, 'garbage in: no buffer, no NaN');
});

/* ------------------------------------------------------------------ createGL */
test('createGL: null without WebGL2 (no context, a context that is not GL, a failed link, o.disabled); nothing inserted then', () => {
  eq(setup({ gl: null }).GL, null, 'getContext("webgl2") → null');
  eq(setup({ gl: { foo: 1 } }).GL, null, 'not a GL context');
  const f = setup({ failLink: true });
  eq([f.GL, f.vp.childNodes.length, f.gl.ext && f.gl.ext.lost], [null, 1, 1], 'a failed link: null, the canvas not inserted, the context released');
  eq(setup({ failShader: true }).GL, null);
  eq(G.createGL(null, {}), null);
  const d = dom.fresh(), vp = d.createElement('div');
  eq(G.createGL(vp, { doc: d, disabled: true }), null, 'o.disabled');
});

test('createGL: the canvas (.cv-gl, aria-hidden, before #world), programs compiled once, the blend state; resize sets the drawing buffer (round(vw·d) × round(vh·d), CSS-sized); alive / ready', () => {
  const { vp, w, gl, GL, made } = setup();
  ok(GL && GL.alive && GL.ready, 'built');
  const cv = made[0];
  eq([cv.localName, cv.className, cv.getAttribute('aria-hidden'), vp.childNodes[0] === cv, vp.childNodes[1] === w, GL.canvas === cv], ['canvas', 'cv-gl', 'true', true, true, true]);
  eq([gl.count('createShader'), gl.count('compileShader'), gl.count('createProgram'), gl.count('linkProgram'), gl.count('deleteShader'), gl.count('createVertexArray')], [4, 4, 2, 2, 4, 2], 'two programs of two shaders, two geometries');
  ok(gl.calls.some(c => c[0] === 'blendFunc' && c[1] === gl.ONE && c[2] === gl.ONE_MINUS_SRC_ALPHA) && gl.calls.some(c => c[0] === 'enable' && c[1] === gl.BLEND), 'premultiplied blend');
  ok(gl.calls.some(c => c[0] === 'pixelStorei' && c[1] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && c[2] === true), 'uploads premultiplied');
  eq(gl.count('shaderSource'), 4);
  const srcs = gl.calls.filter(c => c[0] === 'shaderSource').map(c => c[2]);
  ok(srcs.every(s => s.startsWith('#version 300 es')), 'GLSL ES 3.00');
  ok(/gl_FragCoord/.test(srcs[1]) && /smoothstep/.test(srcs[1]) && /fract/.test(srcs[1]), 'the grid fragment: distance to the nearest multiple, the disc ramp');
  ok(/texture\(t,uv\)/.test(srcs[3]) && /length\(max\(d,0\.0\)\)/.test(srcs[3]), 'the face fragment: the texture, the rounded-rect SDF');
  eq(GL.resize(1440.4, 900, 2), true);
  eq([cv.width, cv.height, cv.style.width, cv.style.height, GL.stats().w, GL.stats().h, GL.stats().d], [2881, 1800, '1440.5px', '900px', 2881, 1800, 2]);
  eq(GL.resize(1440.4, 900, 2), false, 'unchanged: false');
  eq(gl.calls.filter(c => c[0] === 'viewport').pop().slice(1), [0, 0, 2881, 1800], 'the GL viewport follows');
  eq(GL.resize(1000, 600, 1), true);
  eq([cv.width, cv.height, cv.style.width], [1000, 600, '1000px']);
});

test('upload / free: RGBA8 premultiplied LINEAR CLAMP_TO_EDGE textures (mips: LINEAR_MIPMAP_LINEAR + generateMipmap, bytes ×4/3); free is idempotent; stats count bytes and textures', () => {
  const { gl, GL } = setup();
  const a = GL.upload(src(300, 200)), b = GL.upload(src(100, 50), { mips: true });
  eq([a.w, a.h, a.bytes, a.mips, a.dead, b.w, b.h, b.bytes, b.mips], [300, 200, 240000, false, false, 100, 50, Math.round(100 * 50 * 4 * 4 / 3), true]);
  eq([GL.stats().bytes, GL.stats().texes], [240000 + b.bytes, 2]);
  const up = gl.calls.filter(c => c[0] === 'texImage2D');
  eq(up.length, 2); eq(up[0].slice(1), [gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 'src'], 'RGBA8 from the source');
  const params = t => gl.calls.filter(c => c[0] === 'texParameteri').map(c => c.slice(2));
  const P = params();
  eq(P.slice(0, 4), [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_MIN_FILTER, gl.LINEAR]], 'no mips: LINEAR');
  eq(P[7], [gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], 'mips: LINEAR_MIPMAP_LINEAR');
  eq(gl.count('generateMipmap'), 1);
  GL.free(a); GL.free(a);
  eq([a.dead, GL.stats().bytes, GL.stats().texes, gl.count('deleteTexture')], [true, b.bytes, 1, 1], 'freed once');
  eq([GL.upload(null), GL.upload(src(0, 10)), GL.upload({})], [null, null, null], 'no source / empty: null');
  GL.free(null); GL.free({ dead: true });
  GL.free(b);
  eq([GL.stats().bytes, GL.stats().texes], [0, 0]);
});

test('draw: clear → the grid (one uniform block, one triangle) → the quads in order (one bind + one block + one draw each; dead / empty ones skipped); the uniforms from gridUniforms; frames / ms / max counted', () => {
  const { gl, GL, tick } = setup();
  GL.resize(1000, 600, 2);
  const i0 = gl.calls.length;
  eq(GL.draw({ tx: 10, ty: 20, k: 1 }, 1000, 600, 2, []), true);
  eq(gl.since(i0), ['clear', 'useProgram', 'bindVertexArray', 'uniform4fv', 'drawArrays', 'bindVertexArray'], 'the grid alone');
  const u = gl.calls.filter(c => c[0] === 'uniform4fv').pop()[2], g = G.gridUniforms({ tx: 10, ty: 20, k: 1 }, 1000, 600, 2);
  eq(u.map(v => Math.round(v * 1000) / 1000), [g.ox, g.oy, g.s, 1200, g.OX, g.OY, g.S, g.side, g.r, g.minorA, g.majorA, 0], 'the block: origins, periods, the buffer height, sizes, alphas');
  eq(gl.calls.filter(c => c[0] === 'drawArrays').pop().slice(1), [gl.TRIANGLES, 0, 3]);
  const a = GL.upload(src(200, 100)), b = GL.upload(src(400, 200), { mips: true }), c = GL.upload(src(8, 8));
  GL.free(c);
  const quads = [
    { tex: a, x: 0, y: 0, w: 100, h: 50, clip: { x: 0, y: 0, w: 100, h: 50, r: [8, 8, 0, 0] }, alpha: 1 },
    { tex: c, x: 0, y: 0, w: 10, h: 10, clip: null, alpha: 1 }, // dead: skipped
    { tex: b, x: 30, y: 40, w: 200, h: 100, clip: null, alpha: 0.5 },
    { tex: a, x: 0, y: 0, w: 0, h: 50, clip: null }, // empty: skipped
  ];
  const i1 = gl.calls.length;
  tick(2);
  GL.draw({ tx: -5, ty: 7, k: 0.5 }, 1000, 600, 2, quads);
  eq(gl.since(i1), ['clear', 'useProgram', 'bindVertexArray', 'uniform4fv', 'drawArrays', 'useProgram', 'bindVertexArray', 'uniform4fv',
    'bindTexture', 'uniform4fv', 'drawArrays', 'bindTexture', 'uniform4fv', 'drawArrays', 'bindVertexArray'], 'grid, then two quads in order');
  const after = gl.calls.slice(i1);
  eq(after.filter(c => c[0] === 'bindTexture').map(c => c[2]), ['tex1', 'tex2'], 'a then b');
  const blocks = after.filter(c => c[0] === 'uniform4fv').map(c => c[2]);
  eq(blocks[1], [-5, 7, 0.5, 2, 2000, 1200, 0, 0], 'the camera block: tx ty k d W H');
  eq(blocks[2], [0, 0, 100, 50, 0, 0, 100, 50, 8, 8, 0, 0, 1, 1, 0, 0], 'quad a: rect, clip, radii, alpha, clip on');
  eq(blocks[3], [30, 40, 200, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0], 'quad b: no clip, alpha 0.5');
  eq(after.filter(c => c[0] === 'drawArrays').slice(1).map(c => c.slice(1)), [[gl.TRIANGLE_STRIP, 0, 4], [gl.TRIANGLE_STRIP, 0, 4]]);
  const s = GL.stats();
  eq([s.frames, s.max >= 0, s.ms >= 0, s.lost, s.texes], [2, true, true, 0, 2]);
  // a draw with another size resizes the buffer first (a missed resize never draws off-scale)
  GL.draw({ tx: 0, ty: 0, k: 1 }, 800, 400, 1, null);
  eq([GL.stats().w, GL.stats().h, GL.stats().frames], [800, 400, 3]);
  eq(GL.stats(true).frames, 3); eq(GL.stats().frames, 0, 'reset');
  eq(GL.draw({ tx: 0, ty: 0, k: 1 }, 0, 0, 1, []), false, 'no buffer: nothing');
});

test('context loss: preventDefault, every texture dead (free a no-op, draw skips them), onLost(false), no draw until the restore rebuilds the programs (onRestored); three losses in a minute → destroyed, onLost(true), the canvas gone', () => {
  const { vp, gl, GL, ev, made, tick } = setup();
  GL.resize(500, 300, 1);
  const a = GL.upload(src(10, 10)), b = GL.upload(src(20, 20), { mips: true });
  const lost = new dom.Ev('webglcontextlost'); let prevented = 0; lost.preventDefault = () => { prevented++; };
  made[0].dispatchEvent(lost);
  eq([prevented, a.dead, b.dead, GL.stats().bytes, GL.stats().texes, GL.stats().lost, GL.ready, GL.alive], [1, true, true, 0, 0, 1, false, true]);
  eq(ev, [['lost', false]]);
  const n = gl.count('deleteTexture');
  GL.free(a); GL.free(b);
  eq(gl.count('deleteTexture'), n, 'free on a dead texture: no GL call');
  eq([GL.draw({ tx: 0, ty: 0, k: 1 }, 500, 300, 1, []), GL.upload(src(4, 4))], [false, null], 'lost: no draw, no upload');
  const p0 = gl.count('linkProgram');
  made[0].dispatchEvent(new dom.Ev('webglcontextrestored'));
  eq([gl.count('linkProgram') - p0, GL.ready, ev.length, ev[1][0]], [2, true, 2, 'restored'], 'programs rebuilt, the owner told');
  eq(gl.calls.filter(c => c[0] === 'viewport').pop().slice(1), [0, 0, 500, 300], 'the viewport set again');
  eq(GL.draw({ tx: 0, ty: 0, k: 1 }, 500, 300, 1, [{ tex: a, x: 0, y: 0, w: 10, h: 10 }]), true, 'drawing again (the dead quad skipped)');
  const c = GL.upload(src(4, 4));
  ok(c && !c.dead, 'uploads again');
  // two more within the minute: the third kills it
  tick(20000); made[0].dispatchEvent(new dom.Ev('webglcontextlost'));
  eq([GL.alive, ev.length], [true, 3]);
  made[0].dispatchEvent(new dom.Ev('webglcontextrestored'));
  tick(20000); made[0].dispatchEvent(new dom.Ev('webglcontextlost'));
  eq([GL.alive, GL.ready, ev[ev.length - 1], GL.stats().lost, vp.childNodes.includes(made[0]), made[0].width, made[0].height], [false, false, ['lost', true], 3, false, 0, 0], 'the third: destroyed, onLost(true), the canvas removed');
  eq([GL.draw({ tx: 0, ty: 0, k: 1 }, 500, 300, 1, []), GL.upload(src(4, 4))], [false, null]);
  made[0].dispatchEvent(new dom.Ev('webglcontextrestored'));
  eq([GL.alive, ev.length], [false, 5], 'dead for good: no restore');
  GL.destroy(); // idempotent
});

test('losses spread over more than a minute never give the layer up; destroy() releases textures, programs, the context (WEBGL_lose_context) and the canvas', () => {
  const { gl, GL, made, tick, vp } = setup();
  for (let i = 0; i < 4; i++) { made[0].dispatchEvent(new dom.Ev('webglcontextlost')); made[0].dispatchEvent(new dom.Ev('webglcontextrestored')); tick(31000); }
  eq([GL.alive, GL.stats().lost], [true, 4], 'four losses 31 s apart: alive');
  const t = GL.upload(src(2, 2));
  const d0 = gl.count('deleteTexture'), p0 = gl.count('deleteProgram');
  GL.destroy();
  eq([GL.alive, t.dead, gl.count('deleteTexture') - d0, gl.count('deleteProgram') - p0, gl.ext.lost, vp.childNodes.includes(made[0]), GL.stats().bytes], [false, true, 1, 2, 1, false, 0]);
  GL.destroy();
  eq(gl.ext.lost, 1, 'idempotent');
});

// ---- 1h fixes A: the quad's grayscale (a powered-off module's filter: grayscale(0.7); a mod drag's .cv-nodest: 0.8)
test('1h fix 9: a Quad\'s `gray` goes into the quad block (alpha, clipOn, gray) and the face fragment mixes the luma in by it (mix(luma, rgb, 1 − gray) on the premultiplied sample — the CSS grayscale() matrix); absent: 0', () => {
  const { gl, GL } = setup();
  const fs = gl.calls.filter(c => c[0] === 'shaderSource').map(c => c[2])[3];
  ok(/dot\(s\.rgb,vec3\(0\.2126,0\.7152,0\.0722\)\)/.test(fs) && /mix\(vec3\(l\),s\.rgb,1\.0-q\[3\]\.z\)/.test(fs), 'the luma mix by q[3].z');
  GL.resize(400, 300, 1);
  const a = GL.upload(src(10, 10));
  const i0 = gl.calls.length;
  GL.draw({ tx: 0, ty: 0, k: 1 }, 400, 300, 1, [{ tex: a, x: 0, y: 0, w: 10, h: 10, clip: null, alpha: 0.45, gray: 0.7 }, { tex: a, x: 0, y: 0, w: 10, h: 10, clip: null, alpha: 1 }, { tex: a, x: 0, y: 0, w: 10, h: 10, clip: null, alpha: 1, gray: 'x' }]);
  const blocks = gl.calls.slice(i0).filter(c => c[0] === 'uniform4fv').map(c => c[2]);
  eq(blocks[2].slice(12).map(v => Math.round(v * 1000) / 1000), [0.45, 0, 0.7, 0], 'alpha, clip off, gray 0.7');
  eq(blocks[3].slice(12), [1, 0, 0, 0], 'no gray: 0');
  eq(blocks[4].slice(12), [1, 0, 0, 0], 'garbage: 0');
});

// ---- P (IMPL-P §1.1, lane T): the real MAX_TEXTURE_SIZE (≈ 25 % of Android WebGL2 devices say 4096) and gl's error flags on an
// upload. The fake gains getParameter / getError / isContextLost only when a test asks (o.max, o.errs): every test above runs
// without them, as main-sim's stub and tests/cv-face's fake do
const E = { NO_ERROR: 0, INVALID_VALUE: 0x0501, INVALID_OPERATION: 0x0502, OUT_OF_MEMORY: 0x0505, CONTEXT_LOST_WEBGL: 0x9242, MAX_TEXTURE_SIZE: 0x0D33 };
function errGL(o = {}) { // a fake with the error flags: gl.flags (pending), gl.on[call] = a flag that call raises; o.max: MAX_TEXTURE_SIZE
  const gl = fakeGL(o);
  Object.assign(gl, E, { flags: [], on: {}, lostNow: false });
  if (o.max !== undefined) gl.getParameter = p => { gl.calls.push(['getParameter', p]); if (o.max === 'throw') throw new Error('no'); return p === E.MAX_TEXTURE_SIZE ? o.max : null; };
  if (o.errs !== false) {
    gl.getError = () => { gl.calls.push(['getError']); return gl.flags.length ? gl.flags.shift() : E.NO_ERROR; };
    gl.isContextLost = () => gl.lostNow;
    for (const k of ['texImage2D', 'generateMipmap', 'texParameteri']) { const f = gl[k]; gl[k] = (...a) => { const r = f(...a); if (gl.on[k]) gl.flags.push(gl.on[k]); return r; }; }
  }
  return gl;
}
test('P maxTex: GL.maxTex = gl.getParameter(MAX_TEXTURE_SIZE), read once at build; lowered — never raised — by o.maxTex (cv-world\'s ?texmax); no getParameter (the fakes), a throw or garbage: 8192', () => {
  eq(G.MAX_TEX_DEFAULT, 8192);
  eq(setup().GL.maxTex, 8192, 'a fake without getParameter: 8192 (today\'s TEX_MAX_DIM)');
  const g16 = setup({ gl: errGL({ max: 16384 }) });
  eq([g16.GL.maxTex, g16.gl.count('getParameter')], [16384, 1], 'the iPad / the Mac: 16384, read once');
  g16.GL.upload(src(4, 4)); g16.GL.draw({ tx: 0, ty: 0, k: 1 }, 10, 10, 1, []); eq(g16.gl.count('getParameter'), 1, 'never again');
  eq(setup({ gl: errGL({ max: 4096 }) }).GL.maxTex, 4096, 'a 4096 device');
  const mk = (max, maxTex) => { const s = setup({ gl: errGL({ max }) }); return G.createGL(s.vp, { doc: { createElement: tag => { const el = s.d.createElement(tag); if (tag === 'canvas') el.getContext = () => s.gl; return el; } }, win: s.win, world: s.w, maxTex }).maxTex; };
  eq([mk(16384, 4096), mk(4096, 16384), mk(16384, 0), mk(16384, 'x'), mk(16384, -5), mk(8192, 3000.7)], [4096, 4096, 16384, 16384, 16384, 3000], 'o.maxTex lowers only (garbage ignored; whole px)');
  eq([mk('throw'), mk(0), mk('x'), mk(NaN)], [8192, 8192, 8192, 8192], 'a throw / garbage: 8192');
});
test('P upload errors (R2-F3: ONE getError round trip an upload): gl\'s flags read once, after the upload — clean: one call; a flag found: ours (a too-big texImage2D, an out-of-memory mipmap) or one an earlier call left (the cords\' draw, a grid uniform), told apart by one retry — a stale flag never fails a good texture, an error that stays → null (every texture made deleted, nothing counted); CONTEXT_LOST_WEBGL (or isContextLost) → null and not ready (the loss path: the event follows), never an error, never retried; no getError (the fakes): as today', () => {
  const { gl, GL } = setup({ gl: errGL({ max: 8192 }) });
  const n0 = gl.count('getError');
  ok(GL.upload(src(4, 4)), 'a clean upload stands');
  eq(gl.count('getError') - n0, 1, 'a clean upload: ONE getError round trip (it was two: a drain, a check)');
  const n1 = gl.count('getError');
  ok(GL.upload(src(40, 30), { mips: true }), 'with mips too');
  eq(gl.count('getError') - n1, 1, 'mips: still one');
  // a flag left by an earlier call: the check finds it, drains it, the retry (clean) stands — the texture is good
  gl.flags.push(E.INVALID_OPERATION, E.INVALID_VALUE);
  const t0 = gl.count('createTexture'), d0 = gl.count('deleteTexture'), n2 = gl.count('getError'), b00 = GL.stats().bytes;
  const a = GL.upload(src(30, 20), { mips: true });
  ok(a && !a.dead, 'a stale flag: the upload stands (never fails a good texture)');
  eq([GL.stats().texes, gl.flags.length, gl.count('createTexture') - t0, gl.count('deleteTexture') - d0, GL.stats().bytes - b00], [3, 0, 2, 1, Math.round(30 * 20 * 4 * 4 / 3)], 'the flags drained; one retry (a texture made twice, the first deleted); only the retry counted');
  eq(gl.count('getError') - n2, 4, 'the stale case, once: the check drains 2 flags + NO_ERROR (3 calls), the retry\'s check 1');
  eq(GL.upload(src(4, 4)) && gl.count('getError') - n2, 5, 'and the next upload is clean again: one call');
  gl.on.texImage2D = E.INVALID_VALUE; gl.on.generateMipmap = E.INVALID_OPERATION; // (a side over MAX_TEXTURE_SIZE: the level is never defined)
  const c0 = gl.count('createTexture'), e0 = gl.count('deleteTexture'), b0 = GL.stats().bytes, tx0 = GL.stats().texes;
  eq(GL.upload(src(9000, 10), { mips: true }), null, 'texImage2D\'s error: null (the retry fails the same way)');
  eq([gl.count('createTexture') - c0, gl.count('deleteTexture') - e0, GL.stats().bytes, GL.stats().texes - tx0, gl.flags.length, GL.ready], [2, 2, b0, 0, 0, true], 'both textures deleted, nothing counted, every flag drained, still ready');
  gl.on.texImage2D = 0; gl.on.generateMipmap = E.OUT_OF_MEMORY;
  eq(GL.upload(src(40, 40), { mips: true }), null, 'generateMipmap\'s error (out of memory): null');
  gl.on.generateMipmap = 0;
  ok(GL.upload(src(40, 40), { mips: true }), 'and the next one stands');
  // the context lost under the upload: CONTEXT_LOST_WEBGL in the check (a stale one too), or isContextLost
  gl.flags.push(E.CONTEXT_LOST_WEBGL);
  const l0 = gl.count('createTexture');
  eq([GL.upload(src(4, 4)), GL.ready, GL.alive, gl.count('createTexture') - l0], [null, false, true, 1], 'lost (the check): null, not ready, not retried');
  eq(GL.draw({ tx: 0, ty: 0, k: 1 }, 10, 10, 1, []), false, 'no draw until the restore');
  made0(GL).dispatchEvent(new dom.Ev('webglcontextrestored'));
  eq(GL.ready, true, 'the restore: ready again');
  gl.on.texImage2D = E.CONTEXT_LOST_WEBGL;
  eq([GL.upload(src(4, 4)), GL.ready], [null, false], 'lost (after the upload): null, not ready');
  gl.on.texImage2D = 0; made0(GL).dispatchEvent(new dom.Ev('webglcontextrestored'));
  gl.lostNow = true;
  const g0 = gl.count('getError');
  eq([GL.upload(src(4, 4)), GL.ready, gl.count('getError') - g0], [null, false, 0], 'isContextLost: null before any round trip');
  gl.lostNow = false;
  // a fake without getError: every upload as today (no check, no throw)
  const p = setup({ gl: errGL({ errs: false }) });
  ok(p.GL.upload(src(4, 4), { mips: true }) && p.gl.count('getError') === 0, 'no getError: as today');
});
const made0 = GL => GL.canvas;
