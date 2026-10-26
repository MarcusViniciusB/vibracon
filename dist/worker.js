importScripts('engine.js?v=0.6.0','motion.js?v=0.6.0');
onmessage=async e=>{try{const {frames,n,fs,lo,hi,gain,mask,method='flow'}=e.data;const started=performance.now();
 if(method==='flow'){const motion=await VibraMotion.estimate(frames,n,fs,lo,hi,value=>postMessage({progress:value}));postMessage({motion,seconds:(performance.now()-started)/1000},[motion.dx.buffer,motion.dy.buffer,motion.confidence.buffer]);}
 else{const out=await VibraEngine.process(frames,n,fs,lo,hi,gain,mask,value=>postMessage({progress:value}));postMessage({frames:out,seconds:(performance.now()-started)/1000},out.map(x=>x.buffer));}
 }catch(error){postMessage({error:error.message});}};
