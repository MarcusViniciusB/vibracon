/* Conventional small-displacement tracking and backward warping. No learned model.
   Linearized Lucas–Kanade against the temporal mean; coarse field, temporal FFT.
   Experimental: brightness changes, camera motion and large motions can bias it. */
(function(root){
'use strict';
const E=root.VibraEngine||(typeof require!=='undefined'?require('./engine.js'):null);
function integral(a,n){const s=new Float64Array((n+1)*(n+1));for(let y=0;y<n;y++){let row=0;for(let x=0;x<n;x++){row+=a[y*n+x];s[(y+1)*(n+1)+x+1]=s[y*(n+1)+x+1]+row;}}return s;}
function sum(s,n,x,y,r){const a=Math.max(0,x-r),b=Math.min(n,x+r+1),c=Math.max(0,y-r),d=Math.min(n,y+r+1),w=n+1;return s[d*w+b]-s[c*w+b]-s[d*w+a]+s[c*w+a];}
function blur(a,n){let b=new Float32Array(a.length),c=new Float32Array(a.length);for(let y=0;y<n;y++)for(let x=0;x<n;x++)b[y*n+x]=(a[y*n+Math.max(0,x-1)]+2*a[y*n+x]+a[y*n+Math.min(n-1,x+1)])/4;for(let y=0;y<n;y++)for(let x=0;x<n;x++)c[y*n+x]=(b[Math.max(0,y-1)*n+x]+2*b[y*n+x]+b[Math.min(n-1,y+1)*n+x])/4;return c;}
function axes(n,step){const a=[];for(let x=0;x<n;x+=step)a.push(x);if(a.at(-1)!==n-1)a.push(n-1);return a;}
function temporal(a,offset,t,fs,lo,hi){const re=new Float64Array(t),im=new Float64Array(t);let mean=0,slope=0,varTime=0;for(let k=0;k<t;k++)mean+=a[offset+k]/t;for(let k=0;k<t;k++){const tt=k-(t-1)/2;slope+=tt*(a[offset+k]-mean);varTime+=tt*tt;}slope/=varTime;for(let k=0;k<t;k++)re[k]=a[offset+k]-mean-slope*(k-(t-1)/2);E.fft(re,im);const w=E.temporalWeights(t,fs,lo,hi);for(let k=0;k<t;k++){re[k]*=w[k];im[k]*=w[k];}E.fft(re,im,true);for(let k=0;k<t;k++)a[offset+k]=re[k];}
async function estimate(frames,n,fs,lo,hi,progress=()=>{}){
 const t=frames.length;if(![64,128,256,512].includes(n)||t<16||t>128||(t&(t-1))||![fs,lo,hi].every(Number.isFinite)||!(0<lo&&lo<hi&&hi<fs/2))throw Error('Parâmetros de rastreamento inválidos.');
 const tw=E.temporalWeights(t,fs,lo,hi);if(!tw.some(v=>v>.01))throw Error('A faixa não contém frequências resolvíveis. Amplie a faixa ou o trecho.');
 let reference=new Float32Array(n*n);for(const frame of frames)for(let p=0;p<reference.length;p++)reference[p]+=frame[p]/t;reference=blur(reference,n);
 const gx=new Float32Array(n*n),gy=new Float32Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){gx[y*n+x]=x>=2&&x<n-2?(reference[y*n+x-2]-8*reference[y*n+x-1]+8*reference[y*n+x+1]-reference[y*n+x+2])/12:(reference[y*n+Math.min(n-1,x+1)]-reference[y*n+Math.max(0,x-1)])/2;gy[y*n+x]=y>=2&&y<n-2?(reference[(y-2)*n+x]-8*reference[(y-1)*n+x]+8*reference[(y+1)*n+x]-reference[(y+2)*n+x])/12:(reference[Math.min(n-1,y+1)*n+x]-reference[Math.max(0,y-1)*n+x])/2;}
 const mul=(a,b)=>Float32Array.from(a,(v,p)=>v*b[p]);const xx=integral(mul(gx,gx),n),xy=integral(mul(gx,gy),n),yy=integral(mul(gy,gy),n),ix=integral(gx,n),iy=integral(gy,n);
 const step=Math.max(4,Math.round(n/32)),xs=axes(n,step),ys=axes(n,step),gw=xs.length,gh=ys.length,m=gw*gh,r=Math.min(16,Math.max(6,Math.round(n/16))),nodes=[];
 for(const y of ys)for(const x of xs){const area=(Math.min(n,x+r+1)-Math.max(0,x-r))*(Math.min(n,y+r+1)-Math.max(0,y-r));const sx=sum(ix,n,x,y,r),sy=sum(iy,n,x,y,r),a=sum(xx,n,x,y,r)-sx*sx/area,b=sum(xy,n,x,y,r)-sx*sy/area,c=sum(yy,n,x,y,r)-sy*sy/area,trace=Math.max(0,a+c),lambda=Math.max(.001,trace*.001),det=(a+lambda)*(c+lambda)-b*b;nodes.push({x,y,area,sx,sy,a:a+lambda,b,c:c+lambda,det,weight:Math.min(1,trace/area/4)});}
 const u=new Float32Array(m*t),v=new Float32Array(m*t);let rejected=0;
 for(let k=0;k<t;k++){
 const frame=blur(frames[k],n),diff=Float32Array.from(frame,(q,p)=>q-reference[p]),idt=integral(diff,n),ixt=integral(mul(diff,gx),n),iyt=integral(mul(diff,gy),n);
 for(let j=0;j<m;j++){const node=nodes[j];if(node.weight<.005||node.det<=0)continue;const d=sum(idt,n,node.x,node.y,r)/node.area,rx=-sum(ixt,n,node.x,node.y,r)+node.sx*d,ry=-sum(iyt,n,node.x,node.y,r)+node.sy*d;const ux=(node.c*rx-node.b*ry)/node.det,vy=(node.a*ry-node.b*rx)/node.det;if(Math.hypot(ux,vy)>2.5){rejected++;continue;}u[j*t+k]=ux;v[j*t+k]=vy;}
 if(k%8===0){progress(.7*(k+1)/t);await new Promise(r=>setTimeout(r,0));}
 }
 for(let j=0;j<m;j++){temporal(u,j*t,t,fs,lo,hi);temporal(v,j*t,t,fs,lo,hi);}
 // Extend reliable edge motion a little into adjacent flat regions; estimate
 // remains local. This does not segment an object or remove camera motion.
 const dx=new Float32Array(m*t),dy=new Float32Array(m*t),confidence=new Float32Array(m);
 for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){const j=y*gw+x;let wsum=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const xx=x+ox,yy=y+oy;if(xx<0||xx>=gw||yy<0||yy>=gh)continue;const q=yy*gw+xx,w=nodes[q].weight*(ox===0?2:1)*(oy===0?2:1);wsum+=w;for(let k=0;k<t;k++){dx[k*m+j]+=w*u[q*t+k];dy[k*m+j]+=w*v[q*t+k];}}confidence[j]=Math.min(1,wsum/8);if(wsum>.001)for(let k=0;k<t;k++){dx[k*m+j]/=wsum;dy[k*m+j]/=wsum;}}
 progress(1);return {n,t,gw,gh,step,dx,dy,confidence,rejectedFraction:rejected/(m*t),model:'linearized-local-lucas-kanade',maxOriginalDisplacement:2.5};
}
function sample(a,w,h,x,y,channels=1,ch=0){x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,x1=Math.min(w-1,ix+1),y1=Math.min(h-1,iy+1);return (a[(iy*w+ix)*channels+ch]*(1-fx)+a[(iy*w+x1)*channels+ch]*fx)*(1-fy)+(a[(y1*w+ix)*channels+ch]*(1-fx)+a[(y1*w+x1)*channels+ch]*fx)*fy;}
function component(field,k,x,y,key){const n=field.n,step=field.step,gx=Math.min(field.gw-2,Math.max(0,Math.floor(x/step))),gy=Math.min(field.gh-2,Math.max(0,Math.floor(y/step))),x0=gx*step,y0=gy*step,x1=Math.min(n-1,(gx+1)*step),y1=Math.min(n-1,(gy+1)*step),fx=Math.max(0,Math.min(1,(x-x0)/(x1-x0))),fy=Math.max(0,Math.min(1,(y-y0)/(y1-y0))),a=field[key],offset=k*field.gw*field.gh,p=offset+gy*field.gw+gx;return (a[p]*(1-fx)+a[p+1]*fx)*(1-fy)+(a[p+field.gw]*(1-fx)+a[p+field.gw+1]*fx)*fy;}
/* Incremento (α−1)·δ no ponto (x,y) da prévia, em px da prévia.
   lambdaC>0 aplica o limite de Wu et al. (2012): onde α·|δ| > λc/8 o ganho
   é reduzido para λc/(8|δ|); o deslocamento amplificado fica limitado a λc/8. */
function displacement(field,k,x,y,roi,d,gain,mask=null,lambdaC=0){
 const n=field.n,scaleX=roi.w/d.w,scaleY=roi.h/d.h,px=d.x+(x-roi.x)/scaleX,py=d.y+(y-roi.y)/scaleY;
 if(px<0||py<0||px>=n||py>=n)return null;const weight=mask?sample(mask,n,n,px,py):1;if(weight<.001)return null;
 const ux=component(field,k,px,py,'dx')*scaleX*weight,vy=component(field,k,px,py,'dy')*scaleY*weight;let g=gain;
 if(lambdaC>0){const m=Math.hypot(ux,vy);if(m>1e-9&&g*m>lambdaC/8)g=Math.max(1,lambdaC/(8*m));}
 return [(g-1)*ux,(g-1)*vy];
}
function warp(frame,w,h,roi,d,field,k,gain,mask=null,lambdaC=0){
 if(!Number.isFinite(gain)||gain<1||gain>100)throw Error('Use ganho entre 1 e 100.');const out=new Uint8ClampedArray(frame);if(gain===1)return out;
 for(let y=Math.max(0,Math.floor(roi.y));y<Math.min(h,Math.ceil(roi.y+roi.h));y++)for(let x=Math.max(0,Math.floor(roi.x));x<Math.min(w,Math.ceil(roi.x+roi.w));x++){
 const u=displacement(field,k,x,y,roi,d,gain,mask,lambdaC);if(!u)continue;const srcX=x-u[0],srcY=y-u[1],p=4*(y*w+x);
 for(let c=0;c<3;c++)out[p+c]=sample(frame,w,h,srcX,srcY,4,c);
 }
 return out;
}
root.VibraMotion={estimate,warp,component,displacement,sample};if(typeof module!=='undefined')module.exports=root.VibraMotion;
})(typeof self!=='undefined'?self:globalThis);
