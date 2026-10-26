// Testes do dobramento de frequência (Frequency Aliasing Folding Diagram):
// zonas de Nyquist, inversão de fase em zonas pares, bloqueio de cruzamento de dobra e candidatos de aliasing.
const assert = require('node:assert/strict');
const { foldFrequency, foldBand, aliasCandidates } = require('../dist/analysis.js');

// 1) 1ª zona de Nyquist (sem aliasing): f = 4 Hz com fs = 32 Hz (Nyquist = 16 Hz)
const z1 = foldFrequency(4, 32);
assert.equal(z1.zone, 1);
assert.equal(z1.aliased, false);
assert.equal(z1.phaseInverted, false);
assert.ok(Math.abs(z1.folded - 4) < 1e-9);

// 2) 2ª zona de Nyquist (fase invertida): f = 26 Hz com fs = 30 Hz (Nyquist = 15 Hz) -> f_alias = |26 - 30| = 4 Hz
const z2 = foldFrequency(26, 30);
assert.equal(z2.zone, 2);
assert.equal(z2.aliased, true);
assert.equal(z2.phaseInverted, true);
assert.ok(Math.abs(z2.folded - 4) < 1e-9);

// 3) 3ª zona de Nyquist (fase preservada): f = 34 Hz com fs = 30 Hz -> f_alias = |34 - 30| = 4 Hz
const z3 = foldFrequency(34, 30);
assert.equal(z3.zone, 3);
assert.equal(z3.aliased, true);
assert.equal(z3.phaseInverted, false);
assert.ok(Math.abs(z3.folded - 4) < 1e-9);

// 4) Faixa na 1ª zona [2, 6] Hz com fs = 32 Hz
const b1 = foldBand(2, 6, 32);
assert.equal(b1.ok, true);
assert.equal(b1.aliased, false);
assert.equal(b1.zone, 1);
assert.equal(b1.effectiveLo, 2);
assert.equal(b1.effectiveHi, 6);

// 5) Faixa na 2ª zona [24, 28] Hz com fs = 32 Hz (Nyquist = 16 Hz) -> dobra para [4, 8] Hz
const b2 = foldBand(24, 28, 32);
assert.equal(b2.ok, true);
assert.equal(b2.aliased, true);
assert.equal(b2.zone, 2);
assert.equal(b2.phaseInverted, true);
assert.ok(Math.abs(b2.effectiveLo - 4) < 1e-9);
assert.ok(Math.abs(b2.effectiveHi - 8) < 1e-9);

// 6) Faixa que cruza a dobra de Nyquist (ex.: 14 a 18 Hz com Nyquist = 16 Hz) é rejeitada
const cross = foldBand(14, 18, 32);
assert.equal(cross.ok, false);
assert.equal(cross.crossesBoundary, true);
assert.equal(cross.boundaryHz, 16);

// 7) Candidatos de aliasing para f_aparente = 4 Hz com fs = 30 Hz nas 4 primeiras zonas
const cands = aliasCandidates(4, 30, 4);
assert.equal(cands.length, 4);
assert.deepEqual(cands.map(c => c.fReal), [4, 26, 34, 56]);
assert.deepEqual(cands.map(c => c.phaseInverted), [false, true, false, true]);
for (const c of cands) {
  assert.ok(Math.abs(foldFrequency(c.fReal, 30).folded - 4) < 1e-9);
}

console.log('PASS: dobramento de frequência (aliasing), zonas de Nyquist, inversão de fase, validação de borda e candidatos por zona.');
