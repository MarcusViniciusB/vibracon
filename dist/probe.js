/* Lê apenas moov/MDHD/STTS de MP4/MOV. Não decodifica nem estima FPS de captura. */
(function(root){
'use strict';
function boxes(v,start,end){const out=[];for(let p=start;p+8<=end;){let size=v.getUint32(p),head=8;const type=String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+p+4,4));if(size===1){if(p+16>end)throw Error('MP4 truncado');size=v.getUint32(p+8)*4294967296+v.getUint32(p+12);head=16;}if(size===0)size=end-p;if(!Number.isSafeInteger(size)||size<head||p+size>end)throw Error('Átomo MP4 inválido');out.push({type,start:p+head,end:p+size});p+=size;}return out;}
function child(v,b,type){return boxes(v,b.start,b.end).find(x=>x.type===type);}
function parseMoov(buffer){const v=new DataView(buffer),rootBox={start:0,end:v.byteLength};
 for(const trak of boxes(v,0,v.byteLength).filter(b=>b.type==='trak')){
 const mdia=child(v,trak,'mdia');if(!mdia)continue;const h=child(v,mdia,'hdlr');if(!h||h.start+12>h.end)continue;const handler=String.fromCharCode(...new Uint8Array(buffer,h.start+8,4));if(handler!=='vide')continue;
 const m=child(v,mdia,'mdhd'),minf=child(v,mdia,'minf');if(!m||!minf)continue;const stbl=child(v,minf,'stbl');if(!stbl)continue;const stts=child(v,stbl,'stts');if(!stts)continue;
 const offset=v.getUint8(m.start)===1?20:12;if(m.start+offset+4>m.end)throw Error('mdhd truncado');const timescale=v.getUint32(m.start+offset);if(stts.start+8>stts.end)throw Error('stts truncado');const entries=v.getUint32(stts.start+4);if(entries>1000000||stts.start+8+entries*8>stts.end)throw Error('Tabela temporal inválida');
 let samples=0,ticks=0;const deltas=new Map(),runs=[];for(let j=0;j<entries;j++){const count=v.getUint32(stts.start+8+j*8),delta=v.getUint32(stts.start+12+j*8);if(count){runs.push({start:ticks/timescale,count,dt:delta/timescale});deltas.set(delta,(deltas.get(delta)||0)+count);}samples+=count;ticks+=count*delta;}
 if(samples>0&&ticks>0&&timescale>0){
 const ranked=[...deltas].sort((a,b)=>a[0]-b[0]);let acc=0,median=ranked[0][0];for(const [delta,count] of ranked){acc+=count;if(acc>=samples/2){median=delta;break;}}
 let nominalFps=timescale/median;if(Math.abs(nominalFps-Math.round(nominalFps))<.01)nominalFps=Math.round(nominalFps);
 const tolerance=Math.max(2,median*.05),variable=ranked.some(([delta])=>Math.abs(delta-median)>tolerance);
 let longest={start:0,end:0},runStart=0;for(const run of runs){if(run.dt>1.5/nominalFps){if(run.start-runStart>longest.end-longest.start)longest={start:runStart,end:run.start};runStart=run.start+run.count*run.dt;}}
 if(ticks/timescale-runStart>longest.end-longest.start)longest={start:runStart,end:ticks/timescale};
 return {fps:samples*timescale/ticks,nominalFps,samples,duration:ticks/timescale,variable,runs,longestRegular:longest,method:'MP4 stts/mdhd',captureFpsKnown:false};
 }
 }return null;}
async function probe(file){for(let pos=0,atoms=0;pos+8<=file.size&&atoms<10000;atoms++){
 const head=new DataView(await file.slice(pos,Math.min(pos+16,file.size)).arrayBuffer());let size=head.getUint32(0),bytes=8;const type=String.fromCharCode(...new Uint8Array(head.buffer,4,4));if(size===1){if(head.byteLength<16)return null;size=head.getUint32(8)*4294967296+head.getUint32(12);bytes=16;}if(size===0)size=file.size-pos;if(!Number.isSafeInteger(size)||size<bytes||pos+size>file.size)return null;if(type==='moov'){if(size>32*1024*1024)return null;return parseMoov(await file.slice(pos+bytes,pos+size).arrayBuffer());}pos+=size;
 }return null;}
/* ── Análise de trechos ──────────────────────────────────────────────
   O app lê o vídeo por seek em instantes uniformes t_k = início + k/fps.
   O navegador mostra o quadro do arquivo cujo intervalo contém t_k
   (retenção); nenhum quadro intermediário é criado. Aqui calculamos,
   a partir da tabela stts, qual quadro do arquivo cada amostra usa. */
function frameTimes(timing){
 if(timing._times)return timing._times;
 const t=new Float64Array(timing.samples);let n=0;
 for(const run of timing.runs||[])for(let i=0;i<run.count&&n<t.length;i++)t[n++]=run.start+i*run.dt;
 Object.defineProperty(timing,'_times',{value:t.subarray(0,n),enumerable:false});return timing._times;
}
function frameAt(times,x){let lo=0,hi=times.length-1;if(x<times[0])return -1;while(lo<hi){const mid=(lo+hi+1)>>1;if(times[mid]<=x)lo=mid;else hi=mid-1;}return lo;}

/** Diagnóstico de um trecho: limites, lacunas (> 1,5 período), retenções e instantes reais usados. */
function analyzeSegment(timing,start,count,fps,duration){
 const end=start+(count-1)/fps,fmt=v=>v.toFixed(2).replace('.',',');
 const total=Number.isFinite(duration)?duration:timing?.duration;
 if(!(start>=0)||!Number.isFinite(end))return {ok:false,reason:'Informe um início válido (0 s ou mais).',start,end};
 if(Number.isFinite(total)&&end>=total)
  return {ok:false,blocked:'duration',start,end,reason:`O trecho vai de ${fmt(start)} s a ${fmt(end)} s, mas o vídeo termina em ${fmt(total)} s. Reduza o início para no máximo ${fmt(Math.max(0,total-(count-1)/fps-.01))} s ou diminua a quantidade de quadros.`};
 if(!timing)return {ok:true,verified:false,start,end,gaps:[],held:0};
 if(fps>timing.nominalFps*1.05)
  return {ok:false,blocked:'oversampling',start,end,reason:`A amostragem pedida (${fps} FPS) supera os intervalos usuais do arquivo (${timing.nominalFps.toFixed(3)} FPS): o navegador repetiria quadros. Use no máximo ${timing.nominalFps.toFixed(2)} FPS.`};
 const times=frameTimes(timing),limit=1.5/fps,gaps=[];
 const first=Math.max(0,frameAt(times,start)),last=Math.max(first,frameAt(times,end));
 if(start<times[0]&&times[0]-start>limit)gaps.push({from:start,to:times[0],seconds:times[0]-start});
 for(let i=first;i<=last;i++){const next=i+1<times.length?times[i+1]:timing.duration,dt=next-times[i];if(dt>limit)gaps.push({from:times[i],to:next,seconds:dt});}
 const source=new Float64Array(count);let held=0,prev=-2;
 for(let k=0;k<count;k++){const idx=frameAt(times,start+k/fps);source[k]=idx>=0?times[idx]:NaN;if(idx===prev)held++;prev=idx;}
 return {ok:true,verified:true,regular:gaps.length===0,start,end,gaps,held,sourceTimes:source,
  maxGap:gaps.reduce((m,g)=>Math.max(m,g.seconds),0)};
}

/** Compatibilidade: mesmo contrato antigo (ok/reason), agora sem bloquear lacunas. */
function validateSegment(timing,start,count,fps,duration){return analyzeSegment(timing,start,count,fps,duration);}

/** Sugere o início mais regular que comporte exatamente `count` quadros a `fps`.
    Não altera quantidade nem FPS. Critério: sem lacunas; menor fração de quadros
    retidos + menor dispersão dos intervalos do arquivo; empate → mais perto do início atual. */
function suggestSegment(timing,count,fps,current=0){
 const span=(count-1)/fps,fmt=v=>v.toFixed(2).replace('.',',');
 if(!timing)return {ok:false,reason:'A temporização deste arquivo não pôde ser lida; não há base para sugerir um trecho.'};
 if(fps>timing.nominalFps*1.05)return {ok:false,reason:`A amostragem pedida (${fps} FPS) supera os intervalos usuais do arquivo (${timing.nominalFps.toFixed(3)} FPS). Ajuste a amostragem antes de pedir uma sugestão.`};
 const times=frameTimes(timing),n=times.length,limit=1.5/fps;
 if(!n)return {ok:false,reason:'O arquivo não tem quadros de vídeo legíveis.'};
 const dts=new Float64Array(n);for(let i=0;i<n;i++)dts[i]=(i+1<n?times[i+1]:timing.duration)-times[i];
 const sorted=Float64Array.from(dts).sort(),median=sorted[n>>1]||1/timing.nominalFps,offset=Math.min(.25*median,.25/fps);
 // Maior trecho sem lacunas (só para explicar quando nada couber).
 let bestRun=0,runStart=times[0];for(let i=0;i<n;i++){if(dts[i]>limit){bestRun=Math.max(bestRun,times[i]-runStart);runStart=i+1<n?times[i+1]:timing.duration;}}
 bestRun=Math.max(bestRun,timing.duration-runStart);
 const stride=Math.max(1,Math.ceil(n/20000));let best=null;
 for(let i=0;i<n;i+=stride){
  const s=Math.round((times[i]+offset)*1000)/1000,e=s+span;if(e>=timing.duration)break;
  // intervalos do arquivo dentro do trecho
  let j=i,bad=false,sum=0,m=0;while(j<n&&times[j]<=e){if(dts[j]>limit){bad=true;break;}sum+=dts[j];m++;j++;}
  if(bad)continue;
  const mean=sum/m;let sq=0;for(let q=i;q<i+m;q++)sq+=(dts[q]-mean)*(dts[q]-mean);
  let held=0,prev=-2;for(let k=0;k<count;k++){const idx=frameAt(times,s+k/fps);if(idx===prev)held++;prev=idx;}
  const jitter=m>1?Math.sqrt(sq/m)/mean:0,score=Math.round((held/count+jitter)*1e4)/1e4;  // 1e-4: ignora ruído de arredondamento
  const dist=Math.abs(s-current);
  if(!best||score<best.score||(score===best.score&&dist<best.dist))best={start:s,end:e,score,held,jitter,dist};
 }
 if(!best){const fit=Math.floor(bestRun*fps)+1;
  return {ok:false,longestRegular:bestRun,maxFrames:fit,
   reason:`Não há trecho sem lacunas que comporte ${count} quadros a ${fps} FPS (${fmt(span)} s). O maior trecho regular do arquivo tem ${fmt(bestRun)} s, o que comporta cerca de ${Math.max(1,fit)} quadros. Nenhum parâmetro foi alterado: você pode reduzir a quantidade de quadros ou escolher um início manualmente e confirmar o processamento com lacunas.`};}
 return {ok:true,...best};
}
root.VibraProbe={probe,parseMoov,validateSegment,analyzeSegment,suggestSegment,frameTimes};if(typeof module!=='undefined')module.exports=root.VibraProbe;
})(typeof self!=='undefined'?self:globalThis);
