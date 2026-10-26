// Cenários do trecho analisado: sugestão respeita a quantidade de quadros,
// escolha manual com lacunas é permitida (com aviso), limites continuam bloqueando.
const assert = require('node:assert/strict');
const { parseMoov, analyzeSegment, suggestSegment } = require('../dist/probe.js');

const box = (type, ...parts) => { const body = Buffer.concat(parts), h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8); h.write(type, 4); return Buffer.concat([h, body]); };
/** Tabela stts a 30 FPS (timescale 30000, delta 1000) com lacunas: [[segundos regulares, lacuna em s], ...]. */
function timing(pieces) {
  const entries = [];
  for (const [regular, gap] of pieces) {
    const n = Math.round(regular * 30);
    if (gap) { entries.push([n - 1, 1000]); entries.push([1, 1000 + Math.round(gap * 30000)]); }
    else entries.push([n, 1000]);
  }
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(30000, 12);
  const hdlr = Buffer.alloc(12); hdlr.write('vide', 8);
  const stts = Buffer.alloc(8 + entries.length * 8); stts.writeUInt32BE(entries.length, 4);
  entries.forEach(([c, d], j) => { stts.writeUInt32BE(c, 8 + j * 8); stts.writeUInt32BE(d, 12 + j * 8); });
  const moov = box('trak', box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), box('minf', box('stbl', box('stts', stts)))));
  return parseMoov(new Uint8Array(moov).buffer);
}

// Arquivo de ~120 s com lacunas em 3 s, 20 s, 51 s e 90 s; o maior trecho limpo fica entre ~20,6 s e ~51 s.
const T = timing([[3, .7], [16.3, .6], [30.3, .5], [38.4, .4], [30]]);
assert.ok(T.variable, 'arquivo deve ser irregular');

// 1) 128 quadros: a sugestão mantém 128 e devolve um trecho sem lacunas.
const s128 = suggestSegment(T, 128, 30, 50);
assert.ok(s128.ok, s128.reason);
const a128 = analyzeSegment(T, s128.start, 128, 30);
assert.ok(a128.ok && a128.regular, 'trecho sugerido para 128 deve ser regular');
assert.equal(a128.sourceTimes.length, 128);

// 2) 64 quadros: mantém 64; empates de regularidade escolhem o início mais próximo do atual (50 s).
const s64 = suggestSegment(T, 64, 30, 50);
assert.ok(s64.ok && analyzeSegment(T, s64.start, 64, 30).regular);
assert.ok(Math.abs(s64.start - 50) < 3, `sugestão deveria ficar perto de 50 s, veio ${s64.start}`);

// 3) Início manual em 50 s com 128 quadros cruza a lacuna de ~51 s: permitido, com lacuna informada.
const m50 = analyzeSegment(T, 50, 128, 30);
assert.equal(m50.ok, true);
assert.equal(m50.start, 50);
assert.ok(m50.gaps.length >= 1 && !m50.regular, 'deve listar a lacuna para o aviso');

// 4) Trecho além da duração continua bloqueado, com explicação.
const over = analyzeSegment(T, T.duration - 1, 128, 30);
assert.equal(over.ok, false); assert.equal(over.blocked, 'duration'); assert.match(over.reason, /termina em/);

// 5) Sem trecho regular compatível: falha explicada, sem propor outra quantidade como ação.
const choppy = timing(Array.from({ length: 20 }, () => [2.5, .5]));
const none = suggestSegment(choppy, 128, 30, 10);
assert.equal(none.ok, false); assert.match(none.reason, /Nenhum parâmetro foi alterado/);
assert.ok(none.maxFrames < 128);

// Amostragem acima da taxa do arquivo continua bloqueada.
assert.equal(analyzeSegment(T, 10, 64, 60).blocked, 'oversampling');

console.log('PASS: sugestão mantém 128/64 quadros, início manual com lacunas permitido, limites de duração e FPS, ausência de trecho regular explicada.');
