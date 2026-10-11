// mip-level saw playback aliasing experiment
function sawLevel(H, len) { const t = new Float64Array(len); for (let i = 0; i < len; i++) { let s = 0; for (let k = 1; k <= H; k++) s += Math.sin(2*Math.PI*k*i/len)/k; t[i] = s*2/Math.PI; } return t; }
function dft(x, fs, f) { let re=0, im=0; const n=x.length; for (let i=0;i<n;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(n-1)); const a=2*Math.PI*f*i/fs; re+=x[i]*w*Math.cos(a); im-=x[i]*w*Math.sin(a);} return Math.hypot(re,im); }
function fftMag(x) { const n = x.length; const re = Float64Array.from(x, (v,i)=>v*(0.35875-0.48829*Math.cos(2*Math.PI*i/n)+0.14128*Math.cos(4*Math.PI*i/n)-0.01168*Math.cos(6*Math.PI*i/n))), im = new Float64Array(n);
  for (let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for (let s=2;s<=n;s<<=1){ const a=-2*Math.PI/s; for(let i=0;i<n;i+=s) for(let k=0;k<s/2;k++){ const c=Math.cos(a*k), d=Math.sin(a*k); const xr=re[i+k+s/2]*c-im[i+k+s/2]*d, xi=re[i+k+s/2]*d+im[i+k+s/2]*c; re[i+k+s/2]=re[i+k]-xr; im[i+k+s/2]=im[i+k]-xi; re[i+k]+=xr; im[i+k]+=xi; } }
  const m = new Float64Array(n/2); for (let i=0;i<n/2;i++) m[i]=Math.hypot(re[i],im[i]); return m; }
function play(tab, f0, fs, n, interp) { const L = tab.length, out = new Float64Array(n); let ph = 0; const inc = f0/fs;
  for (let i=0;i<n;i++){ const x = ph*L, i0 = Math.floor(x), fr = x-i0; const m = L-1;
    const a=tab[(i0-1)&m], b=tab[i0&m], c=tab[(i0+1)&m], d=tab[(i0+2)&m];
    let y; if (interp==='lin') y = b+(c-b)*fr; else { const c1=0.5*(c-a), c2=a-2.5*b+2*c-0.5*d, c3=0.5*(d-a)+1.5*(b-c); y=((c3*fr+c2)*fr+c1)*fr+b; }
    out[i]=y; ph+=inc; if(ph>=1) ph-=1; } return out; }
const npow2 = h => { let p=1; while(p<h) p<<=1; return p; };
function measure(fs, base, f0, mult, interp) {
  const flim = fs - Math.min(20000, 0.45*base); const Hmax = Math.floor(flim/f0);
  const levels=[1023]; for (let l=1;l<=10;l++) levels.push(1024>>l);
  let H = levels.find(h => h <= Hmax) || 1; const len = Math.min(2048, Math.max(256, mult*npow2(H)));
  const tab = sawLevel(H, len); const N = 1<<16; const y = play(tab, f0, fs, N, interp); const m = fftMag(y);
  const bin = fs/N; const fund = m[Math.round(f0/bin)];
  let worst = 0, wf=0; const lim = Math.min(20000, 0.45*base);
  for (let k=2;k<N/2;k++){ const f=k*bin; if (f>lim) break; const h = f/f0; if (Math.abs(h-Math.round(h))*f0 < 10*bin) continue; if (m[k]>worst){worst=m[k]; wf=f;} }
  let topH = 0; for (let k=1;k<=H;k++) if (k*f0<lim) topH=k;
  return { H, len, alias: (20*Math.log10(worst/fund)).toFixed(1), at: wf.toFixed(0), topHarmAudible: topH, topHz: (topH*f0).toFixed(0) };
}
for (const [fs, base] of [[48000,48000],[96000,48000],[192000,48000]]) for (const mult of [4,8]) for (const interp of ['lin','herm']) for (const f0 of [110, 440, 1046.5, 2093, 4186]) {
  console.log(fs, mult, interp, f0, JSON.stringify(measure(fs, base, f0, mult, interp)));
}
