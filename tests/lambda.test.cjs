const assert=require('node:assert/strict');const M=require('../dist/motion.js');
// Campo sintético uniforme: δ = 1 px vertical em todos os nós, 1 quadro.
const n=64,step=4,gw=17,gh=17,m=gw*gh,field={n,t:1,gw,gh,step,dx:new Float32Array(m),dy:new Float32Array(m).fill(1),confidence:new Float32Array(m).fill(1)};
const roi={x:0,y:0,w:n,h:n},d={x:0,y:0,w:n,h:n};
const free=M.displacement(field,0,32,32,roi,d,20);assert(Math.abs(free[1]-19)<1e-6);          // (α−1)·δ sem limite
const lim=M.displacement(field,0,32,32,roi,d,20,null,40);assert(Math.abs(lim[1]-(40/8-1))<1e-6); // α·δ ≤ λc/8 → α' = 5
const loose=M.displacement(field,0,32,32,roi,d,20,null,400);assert(Math.abs(loose[1]-19)<1e-6); // limite folgado não altera
const tiny=M.displacement(field,0,32,32,roi,d,20,null,4);assert(Math.abs(tiny[1])<1e-9);         // nunca abaixo de ganho 1
console.log('PASS: limite λc de Wu et al. aplicado ao incremento (α−1)·δ.');
