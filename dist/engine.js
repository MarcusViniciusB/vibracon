/* Vibra 0.1 — banco complexo multiescala experimental, sem aprendizado de máquina.
   Implementação independente inspirada no processamento de fase de Wadhwa et al. (2013).
   Não é reprodução integral da pirâmide orientável do artigo. */
(function(root){
'use strict';
function fft(r,i,inverse=false){
 const n=r.length; if(n<2 || (n&(n-1))) throw Error('FFT requer potência de dois.');
 for(let a=1,b=0;a<n;a++){let bit=n>>1;for(;b&bit;bit>>=1)b^=bit;b^=bit;if(a<b){[r[a],r[b]]=[r[b],r[a]];[i[a],i[b]]=[i[b],i[a]];}}
 for(let len=2;len<=n;len*=2){const ang=(inverse?2:-2)*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);
 for(let a=0;a<n;a+=len){let ur=1,ui=0;for(let j=0;j<len/2;j++){const p=a+j,q=p+len/2,vr=r[q]*ur-i[q]*ui,vi=r[q]*ui+i[q]*ur;r[q]=r[p]-vr;i[q]=i[p]-vi;r[p]+=vr;i[p]+=vi;const nr=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=nr;}}}
 if(inverse)for(let a=0;a<n;a++){r[a]/=n;i[a]/=n;}
}
function fft2(r,i,n,inverse=false){const a=new Float64Array(n),b=new Float64Array(n);
 for(let y=0;y<n;y++){for(let x=0;x<n;x++){a[x]=r[y*n+x];b[x]=i[y*n+x];}fft(a,b,inverse);r.set(a,y*n);i.set(b,y*n);}
 for(let x=0;x<n;x++){for(let y=0;y<n;y++){a[y]=r[y*n+x];b[y]=i[y*n+x];}fft(a,b,inverse);for(let y=0;y<n;y++){r[y*n+x]=a[y];i[y*n+x]=b[y];}}
}
function filters(n){const bank=[],den=new Float64Array(n*n);
 for(const center of [.25,.125,.0625])for(let ori=0;ori<4;ori++){
 const h=new Float64Array(n*n),theta=ori*Math.PI/4;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
 const fx=(x<n/2?x:x-n)/n,fy=(y<n/2?y:y-n)/n,r=Math.hypot(fx,fy);if(!r || x===n/2 || y===n/2)continue;
 const c=Math.max(0,Math.cos(Math.atan2(fy,fx)-theta));h[y*n+x]=Math.exp(-Math.pow(Math.log2(r/center),2)/.8)*Math.pow(c,4);
 }bank.push(h);
 }
 for(const h of bank)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=y*n+x,q=((n-y)%n)*n+(n-x)%n;den[p]+=h[p]**2+h[q]**2;}
 for(const h of bank)for(let p=0;p<h.length;p++)h[p]/=Math.sqrt(Math.max(den[p],1e-8));
 return bank;
}
function temporalWeights(t,fs,lo,hi){const weights=new Float64Array(t),edge=Math.min((hi-lo)/4,fs/t);
 for(let k=0;k<t;k++){const f=Math.min(k,t-k)*fs/t;if(f>=lo&&f<=hi){weights[k]=1;if(edge>0){if(f<lo+edge)weights[k]=.5-.5*Math.cos(Math.PI*(f-lo)/edge);if(f>hi-edge)weights[k]=.5-.5*Math.cos(Math.PI*(hi-f)/edge);}}}return weights;
}
async function process(frames,n,fs,lo,hi,gain,mask,progress=()=>{}){
 const t=frames.length,pixels=n*n;
 if(!Number.isFinite(fs)||!Number.isFinite(lo)||!Number.isFinite(hi)||!Number.isFinite(gain)||!(0<lo&&lo<hi&&hi<fs/2)||gain<1||gain>100)throw Error('Confira frequência mínima, máxima, taxa de quadros e ganho (1–100).');
 if(t<16||t>128||(t&(t-1))||![64,128,256,512].includes(n))throw Error('Tamanho de processamento inválido.');
 const weights=temporalWeights(t,fs,lo,hi);if(!weights.some(w=>w>.01))throw Error('A faixa não contém frequências resolvíveis. Aumente a duração ou amplie a faixa.');
 const spectrum=frames.map(frame=>{const r=Float32Array.from(frame),i=new Float32Array(pixels);fft2(r,i,n);return {r,i};});
 const out=frames.map(f=>Float32Array.from(f)),bank=filters(n),tr=new Float64Array(t),ti=new Float64Array(t);
 for(let band=0;band<bank.length;band++){
 const h=bank[band],coeff=spectrum.map(s=>{const r=Float32Array.from(s.r,(v,p)=>v*h[p]),i=Float32Array.from(s.i,(v,p)=>v*h[p]);fft2(r,i,n,true);return {r,i};});
 // Reuse each coefficient plane after its phase trajectory has been read.
 const delta=coeff;
 for(let p=0;p<pixels;p++){
 let previous=Math.atan2(coeff[0].i[p],coeff[0].r[p]),unwrapped=previous,avgAmplitude=0;
 for(let k=0;k<t;k++){
 const phase=Math.atan2(coeff[k].i[p],coeff[k].r[p]);if(k)unwrapped+=Math.atan2(Math.sin(phase-previous),Math.cos(phase-previous));previous=phase;tr[k]=unwrapped;ti[k]=0;avgAmplitude+=Math.hypot(coeff[k].r[p],coeff[k].i[p])/t;
 }
 // Remove linear drift before periodic temporal filtering. End effects remain a limitation.
 const slope=(tr[t-1]-tr[0])/(t-1),base=tr[0];for(let k=0;k<t;k++)tr[k]-=base+slope*k;
 fft(tr,ti);for(let k=0;k<t;k++){tr[k]*=weights[k];ti[k]*=weights[k];}fft(tr,ti,true);
 const confidence=Math.min(1,avgAmplitude/1.5);
 for(let k=0;k<t;k++){const angle=(gain-1)*tr[k]*confidence,c=Math.cos(angle)-1,s=Math.sin(angle),r=coeff[k].r[p],i=coeff[k].i[p];delta[k].r[p]=r*c-i*s;delta[k].i[p]=i*c+r*s;}
 }
 for(let k=0;k<t;k++){const d=delta[k];fft2(d.r,d.i,n);for(let p=0;p<pixels;p++){d.r[p]*=h[p];d.i[p]*=h[p];}fft2(d.r,d.i,n,true);for(let p=0;p<pixels;p++)out[k][p]+=2*d.r[p]*(mask?mask[p]:1);}
 progress((band+1)/bank.length);await new Promise(r=>setTimeout(r,0));
 }
 return out;
}
root.VibraEngine={fft,fft2,filters,process,temporalWeights};
if(typeof module!=='undefined')module.exports=root.VibraEngine;
})(typeof self!=='undefined'?self:globalThis);
