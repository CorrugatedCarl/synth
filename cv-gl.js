// cv-gl.js — the canvas's GPU layer (stage 1h, docs/canvas/IMPL-1h.md §2; owner: lane G). One WebGL2 canvas (.cv-gl) under
// #world draws, every written frame, the dot grid as a procedural shader (every dot's centre at the exact screen position
// of its world multiple, sizes / fade / floors the 2D path's: gridSizes, gridBg, GRID_MIN_DPX shared with cv-world) and
// the hardware faces as textured quads (cv-face: a mipmapped base texture, a finer window at k > 1) cut by a rounded-rect
// SDF — so nothing of the grid or a face is rasterised at a zoom end: the same camera gives the same pixels mid-gesture
// and at rest (G1), a dot sits where its world multiple is (G3). Without WebGL2 createGL() is null and cv-world keeps
// its 2D grid canvas (G4). Rules: plain ES module, no DOM / window access at module top level (node imports it: tests);
// every GL call guarded (tests pass a fake context; main-sim's stub returns a 2D proxy: the programs fail to link → null);
// no allocation per frame (the uniform arrays are kept; gridBg / gridSizes make two small objects a frame — shared maths).
// Context loss: webglcontextlost (preventDefault) kills every Tex (free is a no-op on them) and tells the owner (onLost);
// webglcontextrestored rebuilds the programs (onRestored: the owners re-upload); three losses within a minute destroy the
// layer (onLost(true): cv-world falls back to the 2D grid live).
import { gridBg, gridSizes, GRID_MIN_DPX, DOT, MAJOR } from './cv-world.js?v=9';

/** Losses within LOSS_WINDOW_MS that give the layer up (G4). */
export const LOSS_MAX = 3, LOSS_WINDOW_MS = 60000;
/** The grid's colour (gridDraw's rgba(233, 231, 226, …)) and the major dots' alpha; the minor alpha is 0.15 × gridBg's fade. */
const GRID_RGB = [233 / 255, 231 / 255, 226 / 255], MAJOR_A = 0.24, MINOR_A = 0.15;

/**
 * The grid shader's uniforms for the camera over a vw × vh CSS px viewport at device ratio d — pure, the maths of the 2D
 * path: the drawing buffer w × h = round(vw·d) × round(vh·d); the minor period s = DOT·k·d and the major S = MAJOR·k·d
 * (device px), their origins ox / oy and OX / OY = the camera's translation in device px folded into [0, period) (folded
 * here in doubles so the shader works on small numbers: a fragment's distance to the nearest multiple is then exact to
 * ≈ 1e-4 px); side / r = gridSizes(d); minorA = 0.15 × gridBg(cam).minor.a (as gridDraw rounds it) or 0 below the floor
 * (DOT·k·d < GRID_MIN_DPX) / when faded; majorA = 0.24 or 0 below the floor (MAJOR·k·d < GRID_MIN_DPX). Also `a`, the raw
 * fade, and the flags minor / major (the layers drawn).
 * @returns {{tx: number, ty: number, k: number, d: number, w: number, h: number, s: number, S: number, ox: number, oy: number,
 *   OX: number, OY: number, side: number, r: number, a: number, minorA: number, majorA: number, minor: boolean, major: boolean}}
 */
export function gridUniforms(cam, vw, vh, d) {
  d = +d > 0 ? +d : 1;
  const k = +cam.k > 0 ? +cam.k : 1, tx = +cam.tx || 0, ty = +cam.ty || 0;
  const w = Math.max(0, Math.round((+vw || 0) * d)), h = Math.max(0, Math.round((+vh || 0) * d));
  const s = DOT * k * d, S = MAJOR * k * d, Z = gridSizes(d), a = gridBg(cam).minor.a;
  const fold = (t, p) => { const r = t % p; return (r < 0 ? r + p : r) || 0; };
  const minor = a > 0 && s >= GRID_MIN_DPX, major = S >= GRID_MIN_DPX;
  return { tx, ty, k, d, w, h, s, S, ox: fold(tx * d, s), oy: fold(ty * d, s), OX: fold(tx * d, S), OY: fold(ty * d, S),
    side: Z.side, r: Z.r, a, minorA: minor ? Math.round(MINOR_A * a * 1000) / 1000 : 0, majorA: major ? MAJOR_A : 0, minor, major };
}

// the shaders (GLSL ES 3.00). The grid: a full-canvas triangle; per fragment the pixel centre in device px (y down: the
// buffer's height − gl_FragCoord.y), its signed distance to the nearest minor / major centre per axis ((fract − step)·period:
// in (−period/2, period/2]); a minor dot = a side × side square with a one-px coverage ramp, skipped where the nearest minor
// dot is a major one (gridDraw's rule: the disc alone there); a major dot = a disc of radius r, smoothstep(r + 0.5, r − 0.5).
// Premultiplied output (rgb × a, a) under ONE / ONE_MINUS_SRC_ALPHA.
const GRID_VS = '#version 300 es\nlayout(location=0) in vec2 a;\nvoid main(){gl_Position=vec4(a,0.0,1.0);}';
const GRID_FS = '#version 300 es\nprecision highp float;\n'
  + 'uniform vec4 u[3];\n' // [0] ox oy s H · [1] OX OY S side · [2] r minorA majorA rgb-scale(unused)
  + 'uniform vec3 col;\nout vec4 o;\n'
  + 'void main(){'
  + 'vec2 p=vec2(gl_FragCoord.x,u[0].w-gl_FragCoord.y);'
  + 'float s=u[0].z,S=u[1].z;'
  + 'vec2 fm=fract((p-u[0].xy)/s);vec2 dm=(fm-step(0.5,fm))*s;'
  + 'vec2 fM=fract((p-u[1].xy)/S);vec2 dM=(fM-step(0.5,fM))*S;'
  + 'vec2 am=abs(dm),aM=abs(dM);'
  + 'float onM=step(aM.x,s*0.5)*step(aM.y,s*0.5);'
  + 'float cm=(1.0-onM)*clamp(u[1].w*0.5+0.5-max(am.x,am.y),0.0,1.0);'
  + 'float cM=smoothstep(u[2].x+0.5,u[2].x-0.5,length(dM));'
  + 'float a=cm*u[2].y+cM*u[2].z;'
  + 'o=vec4(col*a,a);}';
// the faces: the unit quad → the texture's world rect → the camera → device px → clip space; the fragment samples the
// (premultiplied) texture and multiplies by the coverage of the clip rect's rounded-rect SDF (world px → device px by k·d:
// a one-px ramp) and the quad's alpha.
const FACE_VS = '#version 300 es\nlayout(location=0) in vec2 a;\n'
  + 'uniform vec4 c[2];\n' // [0] tx ty k d · [1] W H 0 0
  + 'uniform vec4 q[4];\n' // [0] rect x y w h · [1] clip x y w h · [2] radii tl tr br bl · [3] alpha clipOn 0 0
  + 'out vec2 uv;out vec2 wp;\n'
  + 'void main(){uv=a;wp=q[0].xy+a*q[0].zw;'
  + 'vec2 dv=(wp*c[0].z+c[0].xy)*c[0].w;'
  + 'gl_Position=vec4(dv.x/c[1].x*2.0-1.0,1.0-dv.y/c[1].y*2.0,0.0,1.0);}';
const FACE_FS = '#version 300 es\nprecision highp float;\n'
  + 'uniform sampler2D t;uniform vec4 c[2];uniform vec4 q[4];\nin vec2 uv;in vec2 wp;out vec4 o;\n'
  + 'void main(){vec4 s=texture(t,uv);float cov=1.0;'
  + 'if(q[3].y>0.5){vec2 h=q[1].zw*0.5;vec2 p=wp-(q[1].xy+h);'
  + 'float r=p.x<0.0?(p.y<0.0?q[2].x:q[2].w):(p.y<0.0?q[2].y:q[2].z);r=min(r,min(h.x,h.y));'
  + 'vec2 d=abs(p)-h+r;float sd=length(max(d,0.0))+min(max(d.x,d.y),0.0)-r;'
  + 'cov=clamp(0.5-sd*c[0].z*c[0].w,0.0,1.0);}'
  + 'o=s*(cov*q[3].x);}';

/**
 * The GL layer over `viewport` (IMPL-1h §2), or null without WebGL2 (o.disabled, no context, a failed link — main-sim's
 * stub). o: { doc, win, world (#world: the canvas goes before it; else first in the viewport), test (preserveDrawingBuffer:
 * readPixels after a frame), now(), onLost(dead: boolean), onRestored() }.
 * @returns {null | {canvas: any, resize: Function, upload: Function, free: Function, draw: Function, stats: Function, destroy: Function, readonly alive: boolean}}
 */
export function createGL(viewport, o) {
  o = o || {};
  if (o.disabled || !viewport) return null;
  const win = o.win || (typeof window !== 'undefined' ? window : globalThis);
  const doc = o.doc || win.document || globalThis.document || null;
  if (!doc || typeof doc.createElement !== 'function') return null;
  const now = typeof o.now === 'function' ? o.now : () => { const p = win.performance || globalThis.performance; return p && typeof p.now === 'function' ? p.now() : Date.now(); };
  let canvas = null, gl = null;
  try {
    canvas = doc.createElement('canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: !!o.test, powerPreference: 'high-performance' });
  } catch (err) { gl = null; }
  if (!gl || typeof gl.createShader !== 'function' || typeof gl.getProgramParameter !== 'function') return null;

  /* ---- state */
  const texes = new Set(); // the live Tex records
  const st = { frames: 0, ms: 0, max: 0, bytes: 0, lost: 0 };
  const U = new Float32Array(12), C = new Float32Array(8), Q = new Float32Array(16); // the uniform blocks (kept: no allocation per frame)
  let P = null; // the programs and buffers (rebuilt after a restore): { grid, gridU, gridCol, face, faceC, faceQ, tri, quad }
  let W = 0, H = 0, D = 1, ready = false, destroyed = false, loss = [];
  const offs = [];

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = typeof gl.getShaderInfoLog === 'function' ? gl.getShaderInfoLog(s) : ''; gl.deleteShader(s); throw new Error('cv-gl: shader ' + (log || 'failed')); }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = typeof gl.getProgramInfoLog === 'function' ? gl.getProgramInfoLog(p) : ''; gl.deleteProgram(p); throw new Error('cv-gl: link ' + (log || 'failed')); }
    return p;
  }
  function vao(data) { // one attribute (location 0, vec2) over a static buffer
    const v = gl.createVertexArray(), b = gl.createBuffer();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { v, b };
  }
  function build() { // the programs, the two geometries, the blend state (once, and after a restore)
    const grid = program(GRID_VS, GRID_FS), face = program(FACE_VS, FACE_FS);
    P = { grid, gridU: gl.getUniformLocation(grid, 'u'), gridCol: gl.getUniformLocation(grid, 'col'),
      face, faceC: gl.getUniformLocation(face, 'c'), faceQ: gl.getUniformLocation(face, 'q'), faceT: gl.getUniformLocation(face, 't'),
      tri: vao(new Float32Array([-1, -1, 3, -1, -1, 3])), quad: vao(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])) };
    gl.useProgram(grid); gl.uniform3f(P.gridCol, GRID_RGB[0], GRID_RGB[1], GRID_RGB[2]);
    gl.useProgram(face); gl.uniform1i(P.faceT, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    ready = true;
  }
  try { build(); } catch (err) { try { if (typeof gl.getExtension === 'function') { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } } catch (e2) { /* gone */ } return null; }

  /* ---- the canvas: before #world (where the 2D grid canvas sits), CSS-sized by resize */
  canvas.className = 'cv-gl';
  try { canvas.setAttribute('aria-hidden', 'true'); } catch (err) { /* inert */ }
  try {
    const Wd = o.world || null;
    if (Wd && Wd.parentNode === viewport && typeof viewport.insertBefore === 'function') viewport.insertBefore(canvas, Wd); else viewport.prepend(canvas);
  } catch (err) { return null; }

  /* ---- context loss (G4): every texture dead, the owner told; three in a minute → the layer gives up */
  const killTexes = () => { for (const t of texes) t.dead = true; texes.clear(); st.bytes = 0; };
  const onLost = e => {
    if (destroyed) return;
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (err) { /* inert */ }
    ready = false; st.lost++;
    killTexes();
    const t = now();
    loss.push(t); loss = loss.filter(x => t - x <= LOSS_WINDOW_MS);
    const dead = loss.length >= LOSS_MAX;
    if (dead) destroy();
    if (typeof o.onLost === 'function') { try { o.onLost(dead); } catch (err) { console.error(err); } }
  };
  const onRestored = () => {
    if (destroyed) return;
    try { build(); } catch (err) { console.error(err); ready = false; return; }
    if (W > 0 && H > 0) gl.viewport(0, 0, W, H);
    if (typeof o.onRestored === 'function') { try { o.onRestored(); } catch (err) { console.error(err); } }
  };
  const listen = (type, fn) => { if (typeof canvas.addEventListener !== 'function') return; canvas.addEventListener(type, fn, false); offs.push(() => canvas.removeEventListener(type, fn, false)); };
  listen('webglcontextlost', onLost);
  listen('webglcontextrestored', onRestored);

  /* ---- the API */
  function resize(vw, vh, d) { // the drawing buffer = the viewport in device px (no overscan, no transform); true when it changed
    d = +d > 0 ? +d : 1;
    const w = Math.max(0, Math.round((+vw || 0) * d)), h = Math.max(0, Math.round((+vh || 0) * d));
    if (w === W && h === H && d === D) return false;
    W = w; H = h; D = d;
    try { canvas.width = w; canvas.height = h; canvas.style.width = (w / d) + 'px'; canvas.style.height = (h / d) + 'px'; } catch (err) { /* inert */ }
    if (ready) gl.viewport(0, 0, w, h);
    return true;
  }
  function upload(src, opt) { // RGBA8 premultiplied, LINEAR (mips: LINEAR_MIPMAP_LINEAR, NPOT is fine in WebGL2), CLAMP_TO_EDGE
    if (destroyed || !ready || !src) return null;
    const w = +src.width || 0, h = +src.height || 0;
    if (!(w > 0) || !(h > 0)) return null;
    const mips = !!(opt && opt.mips);
    const id = gl.createTexture();
    if (!id) return null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, id);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    } catch (err) { try { gl.deleteTexture(id); } catch (e2) { /* gone */ } return null; }
    const bytes = Math.round(w * h * 4 * (mips ? 4 / 3 : 1));
    const tex = { id, w, h, bytes, mips, dead: false };
    texes.add(tex); st.bytes += bytes;
    return tex;
  }
  function free(tex) { // idempotent; a no-op on a dead one (lost context)
    if (!tex || tex.dead) return;
    tex.dead = true;
    if (texes.delete(tex)) st.bytes -= tex.bytes;
    if (!destroyed) { try { gl.deleteTexture(tex.id); } catch (err) { /* gone */ } }
  }
  function draw(cam, vw, vh, d, quads) { // one frame: clear, the grid, the quads in order (each one uniform block + one draw)
    if (destroyed || !ready) return false;
    const t0 = now();
    resize(vw, vh, d);
    if (!(W > 0) || !(H > 0)) return false;
    gl.clear(gl.COLOR_BUFFER_BIT);
    const g = gridUniforms(cam, vw, vh, d);
    U[0] = g.ox; U[1] = g.oy; U[2] = g.s; U[3] = H;
    U[4] = g.OX; U[5] = g.OY; U[6] = g.S; U[7] = g.side;
    U[8] = g.r; U[9] = g.minorA; U[10] = g.majorA; U[11] = 0;
    gl.useProgram(P.grid);
    gl.bindVertexArray(P.tri.v);
    gl.uniform4fv(P.gridU, U);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const n = quads ? quads.length : 0;
    if (n) {
      gl.useProgram(P.face);
      gl.bindVertexArray(P.quad.v);
      C[0] = g.tx; C[1] = g.ty; C[2] = g.k; C[3] = d; C[4] = W; C[5] = H; C[6] = 0; C[7] = 0;
      gl.uniform4fv(P.faceC, C);
      for (let i = 0; i < n; i++) {
        const q = quads[i], tex = q && q.tex;
        if (!tex || tex.dead || !(q.w > 0) || !(q.h > 0)) continue;
        gl.bindTexture(gl.TEXTURE_2D, tex.id);
        Q[0] = q.x; Q[1] = q.y; Q[2] = q.w; Q[3] = q.h;
        const c = q.clip;
        if (c) {
          const r = c.r;
          Q[4] = c.x; Q[5] = c.y; Q[6] = c.w; Q[7] = c.h;
          Q[8] = r ? +r[0] || 0 : 0; Q[9] = r ? +r[1] || 0 : 0; Q[10] = r ? +r[2] || 0 : 0; Q[11] = r ? +r[3] || 0 : 0;
          Q[13] = 1;
        } else { Q[4] = Q[5] = Q[6] = Q[7] = Q[8] = Q[9] = Q[10] = Q[11] = 0; Q[13] = 0; }
        Q[12] = q.alpha == null ? 1 : +q.alpha; Q[14] = 0; Q[15] = 0;
        gl.uniform4fv(P.faceQ, Q);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    gl.bindVertexArray(null);
    const ms = now() - t0;
    st.frames++; st.ms += ms; if (ms > st.max) st.max = ms;
    return true;
  }
  function stats(reset) {
    const s = { frames: st.frames, ms: st.ms, max: st.max, bytes: st.bytes, texes: texes.size, lost: st.lost, w: W, h: H, d: D, alive: !destroyed, ready };
    if (reset) { st.frames = 0; st.ms = 0; st.max = 0; }
    return s;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const t of [...texes]) { t.dead = true; try { if (ready) gl.deleteTexture(t.id); } catch (err) { /* gone */ } }
    texes.clear(); st.bytes = 0; ready = false;
    if (P) { try { gl.deleteProgram(P.grid); gl.deleteProgram(P.face); gl.deleteBuffer(P.tri.b); gl.deleteBuffer(P.quad.b); gl.deleteVertexArray(P.tri.v); gl.deleteVertexArray(P.quad.v); } catch (err) { /* gone */ } P = null; }
    for (const f of offs.splice(0)) { try { f(); } catch (err) { /* gone */ } }
    try { if (typeof gl.getExtension === 'function') { const x = gl.getExtension('WEBGL_lose_context'); if (x && typeof x.loseContext === 'function') x.loseContext(); } } catch (err) { /* gone */ }
    try { canvas.width = 0; canvas.height = 0; canvas.remove(); } catch (err) { /* gone */ }
  }
  return { canvas, gl, resize, upload, free, draw, stats, destroy, get alive() { return !destroyed; }, get ready() { return ready; } };
}
