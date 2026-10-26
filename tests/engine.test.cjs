const assert=require('node:assert/strict');const {fft,fft2,process}=require('../dist/engine.js');
function amplitude(frames,n,cycles,f,fs){const phase=frames.map(a=>{let r=0,i=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){r+=a[y*n+x]*Math.cos(2*Math.PI*cycles*x/n);i-=a[y*n+x]*Math.sin(2*Math.PI*cycles*x/n);}return Math.atan2(i,r);});let c=0,s=0;phase.forEach((p,t)=>{c+=p*Math.cos(2*Math.PI*f*t/fs);s+=p*Math.sin(2*Math.PI*f*t/fs);});return 2*Math.hypot(c,s)/phase.length/(2*Math.PI*cycles/n);}
(async()=>{const n=64,t=64,fs=32,f=4,cycles=8;const r=Float64Array.from({length:64},(_,i)=>Math.sin(i)),i=new Float64Array(64),orig=r.slice();fft(r,i);fft(r,i,true);assert(Math.max(...r.map((v,j)=>Math.abs(v-orig[j])))<1e-10);
const frames=Array.from({length:t},(_,k)=>Float32Array.from({length:n*n},(_,p)=>128+70*Math.cos(2*Math.PI*cycles*((p%n)-.25*Math.sin(2*Math.PI*f*k/fs))/n)));
const one=await process(frames,n,fs,2,6,1);assert(Math.max(...one[17].map((v,j)=>Math.abs(v-frames[17][j])))<1e-5);
const out=await process(frames,n,fs,2,6,5),a=amplitude(frames,n,cycles,f,fs),b=amplitude(out,n,cycles,f,fs);console.log(JSON.stringify({input_pixels:a,output_pixels:b,gain:b/a}));assert(Math.abs(b/a-5)<.25);
const rejected=await process(frames,n,fs,9,13,5);const rejectedGain=amplitude(rejected,n,cycles,f,fs)/a;assert(Math.abs(rejectedGain-1)<.1);
const zero=await process(frames,n,fs,2,6,5,new Float32Array(n*n));assert.deepEqual(zero,frames);
const tiny=Array.from({length:t},(_,k)=>Float32Array.from({length:n*n},(_,p)=>128+70*Math.cos(2*Math.PI*cycles*((p%n)-.02*Math.sin(2*Math.PI*f*k/fs))/n)));
const high=await process(tiny,n,fs,2,6,100),highGain=amplitude(high,n,cycles,f,fs)/amplitude(tiny,n,cycles,f,fs);console.log(JSON.stringify({requested_gain:100,measured_gain:highGain}));assert(Math.abs(highGain-100)<5);assert(high.every(frame=>frame.every(Number.isFinite)));
await assert.rejects(()=>process(frames,n,fs,2,6,101));
await assert.rejects(()=>process(frames,n,fs,4,18,5));console.log('PASS: FFT roundtrip, unity gain, selected-band gain, rejected band, empty mask, Nyquist validation, phase gain 100 and gain limit.');})();
