/* Vibra 0.6 — análise do movimento já processado.
   • ponto de medição (nó dominante ou escolhido pelo usuário);
   • deslocamento filtrado x(t) no ponto, em px da prévia (antes do ganho);
   • espectro de amplitude desse sinal;
   • fatias espaço-temporais (original × amplificado) ao longo de uma linha;
   • exportação CSV.
   Tudo é heurístico e sem calibração: px da prévia ≠ mm. */
(function (root) {
  'use strict';
  const M = root.VibraMotion || (typeof require !== 'undefined' ? require('./motion.js') : null);
  const E = root.VibraEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  /* ── dobramento de frequência (aliasing / zonas de Nyquist) ── */
  /** Dobra uma frequência física f (Hz) para a 1ª zona de Nyquist [0, fs/2]. */
  function foldFrequency(f, fs) {
    if (!(fs > 0) || !Number.isFinite(f) || f < 0) return null;
    const nyquist = fs / 2, k = Math.round(f / fs), folded = Math.abs(f - k * fs);
    const zone = f <= nyquist ? 1 : Math.ceil(f / nyquist);
    const atBoundary = f > 0 && (folded <= 1e-6 || Math.abs(folded - nyquist) <= 1e-6);
    const phaseInverted = zone % 2 === 0 && !atBoundary;
    return { f, fs, nyquist, folded, zone, harmonic: k, aliased: f > nyquist, phaseInverted, atBoundary };
  }

  /** Avalia e dobra uma faixa [lo, hi] (Hz) para [effectiveLo, effectiveHi] em (0, fs/2).
      Faixas acima de Nyquist são aceitas quando inteiramente contidas numa única zona de Nyquist. */
  function foldBand(lo, hi, fs) {
    const nyquist = fs / 2;
    if (![lo, hi, fs].every(Number.isFinite) || !(fs > 0) || !(lo > 0 && lo < hi))
      return { ok: false, aliased: false, nyquist, fs, requestedLo: lo, requestedHi: hi, reason: 'Use 0 < frequência mínima < máxima.' };
    if (hi < nyquist) {
      return {
        ok: true, aliased: false, zone: 1, phaseInverted: false,
        requestedLo: lo, requestedHi: hi, effectiveLo: lo, effectiveHi: hi, nyquist, fs
      };
    }
    const m = Math.floor(lo / nyquist), zLo = m * nyquist, zHi = (m + 1) * nyquist;
    if (lo <= zLo + 1e-9 || hi >= zHi - 1e-9) {
      const boundaryHz = lo <= zLo + 1e-9 && m > 0 ? zLo : zHi;
      return {
        ok: false, aliased: true, crossesBoundary: true, boundaryHz,
        zone: m + 1, requestedLo: lo, requestedHi: hi, nyquist, fs,
        reason: `A faixa (${lo}–${hi} Hz) toca ou cruza a dobra de Nyquist em ${Number(boundaryHz.toFixed(2))} Hz. Mantenha a faixa inteira dentro de uma única zona de Nyquist.`
      };
    }
    const fLo = foldFrequency(lo, fs).folded, fHi = foldFrequency(hi, fs).folded;
    const zone = m + 1, phaseInverted = zone % 2 === 0;
    const effectiveLo = Math.min(fLo, fHi), effectiveHi = Math.max(fLo, fHi);
    return {
      ok: true, aliased: true, zone, phaseInverted,
      requestedLo: lo, requestedHi: hi, effectiveLo, effectiveHi, nyquist, fs
    };
  }

  /** Frequências físicas candidatas nas primeiras `maxZones` zonas de Nyquist que dobram em `fApparent`. */
  function aliasCandidates(fApparent, fs, maxZones = 4) {
    if (!(fs > 0) || !Number.isFinite(fApparent) || fApparent < 0 || fApparent > fs / 2 + 1e-9) return [];
    const fa = Math.max(0, Math.min(fs / 2, fApparent)), out = [];
    for (let zone = 1; zone <= maxZones; zone++) {
      const phaseInverted = zone % 2 === 0;
      const fReal = phaseInverted ? (zone / 2) * fs - fa : ((zone - 1) / 2) * fs + fa;
      out.push({ zone, fReal, fApparent: fa, phaseInverted });
    }
    return out;
  }

  /* ── coordenadas: grade de cálculo (n×n) ↔ prévia (512×384) ── */
  const toGrid = (p, { roi, dimensions: d }) => ({ x: d.x + (p.x - roi.x) * d.w / roi.w, y: d.y + (p.y - roi.y) * d.h / roi.h });
  const toPreview = (g, { roi, dimensions: d }) => ({ x: roi.x + (g.x - d.x) * roi.w / d.w, y: roi.y + (g.y - d.y) * roi.h / d.h });
  const inside = (p, roi) => p.x >= roi.x && p.y >= roi.y && p.x < roi.x + roi.w && p.y < roi.y + roi.h;

  /** Nó com maior deslocamento RMS ponderado pela confiança e pela máscara. */
  function dominant(field, meta, mask) {
    const { n, gw, step, t } = field, m = gw * field.gh, d = meta.dimensions, nodes = [];
    let cmax = 0; for (let j = 0; j < m; j++) cmax = Math.max(cmax, field.confidence[j]);
    for (let j = 0; j < m; j++) {
      const gx = Math.min(n - 1, (j % gw) * step), gy = Math.min(n - 1, Math.floor(j / gw) * step);
      if (field.confidence[j] < .5 * cmax) continue;            // textura suficiente
      if (gx < d.x + 2 || gy < d.y + 2 || gx > d.x + d.w - 2 || gy > d.y + d.h - 2) continue;
      if (mask && M.sample(mask, n, n, gx, gy) < .5) continue;
      let s = 0; for (let k = 0; k < t; k++) { const a = field.dx[k * m + j], b = field.dy[k * m + j]; s += a * a + b * b; }
      nodes.push({ gx, gy, score: Math.sqrt(s / t) * field.confidence[j] });
    }
    if (!nodes.length) return { x: meta.roi.x + meta.roi.w / 2, y: meta.roi.y + meta.roi.h / 2 };
    // Centro do grupo de maior movimento (≥ 60% do máximo), evitando nós isolados em bordas.
    const top = Math.max(...nodes.map(q => q.score)), group = nodes.filter(q => q.score >= .6 * top);
    let cx = 0, cy = 0, w = 0; for (const q of group) { cx += q.gx * q.score; cy += q.gy * q.score; w += q.score; }
    cx /= w; cy /= w;
    const pick = group.reduce((b, q) => Math.hypot(q.gx - cx, q.gy - cy) < Math.hypot(b.gx - cx, b.gy - cy) ? q : b);
    return toPreview({ x: pick.gx, y: pick.gy }, meta);
  }

  /** Deslocamento estimado no ponto, em px da prévia; t físico relativo ao início do trecho. */
  function trace(field, meta, p) {
    const g = toGrid(p, meta), sx = meta.roi.w / meta.dimensions.w, sy = meta.roi.h / meta.dimensions.h, fs = meta.assumedPhysicalSamplingFps;
    const T = field.t, t = new Float64Array(T), dx = new Float64Array(T), dy = new Float64Array(T);
    for (let k = 0; k < T; k++) { t[k] = k / fs; dx[k] = M.component(field, k, g.x, g.y, 'dx') * sx; dy[k] = M.component(field, k, g.x, g.y, 'dy') * sy; }
    let ex = 0, ey = 0; for (let k = 0; k < T; k++) { ex += dx[k] * dx[k]; ey += dy[k] * dy[k]; }
    return { t, dx, dy, dominantAxis: ey >= ex ? 'dy' : 'dx', fs };
  }

  /** Espectro de amplitude (janela de Hann, amplitude de pico corrigida). */
  function spectrum(y, fs) {
    const N = y.length, re = new Float64Array(N), im = new Float64Array(N); let ws = 0;
    for (let k = 0; k < N; k++) { const w = .5 - .5 * Math.cos(2 * Math.PI * k / (N - 1)); re[k] = y[k] * w; ws += w; }
    E.fft(re, im);
    const half = N / 2, f = new Float64Array(half + 1), a = new Float64Array(half + 1); let peak = 1;
    for (let i = 0; i <= half; i++) { f[i] = i * fs / N; a[i] = (i === 0 || i === half ? 1 : 2) * Math.hypot(re[i], im[i]) / ws; if (i > 0 && a[i] > a[peak]) peak = i; }
    return { f, a, peak };
  }

  /* ── luminância bilinear num quadro RGBA da prévia ── */
  function lum(data, w, h, x, y) {
    x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x1 = Math.min(w - 1, ix + 1), y1 = Math.min(h - 1, iy + 1);
    const L = (a, b) => { const p = 4 * (b * w + a); return .2126 * data[p] + .7152 * data[p + 1] + .0722 * data[p + 2]; };
    return (L(ix, iy) * (1 - fx) + L(x1, iy) * fx) * (1 - fy) + (L(ix, y1) * (1 - fx) + L(x1, y1) * fx) * fy;
  }

  /** Amostrador do resultado amplificado, coerente com o que drawFrame exibe. */
  function amplifiedSampler(ctx) {
    const { frames, processed, meta, mask, gain, lambdaC } = ctx, roi = meta.roi, d = meta.dimensions;
    if (processed.motion) return (k, x, y) => {
      const u = M.displacement(processed.motion, k, x, y, roi, d, gain, mask, lambdaC);
      return lum(frames[k].data, 512, 384, u ? x - u[0] : x, u ? y - u[1] : y);
    };
    const n = meta.resolution;
    return (k, x, y) => {
      const g = toGrid({ x, y }, meta);
      if (g.x < d.x || g.y < d.y || g.x > d.x + d.w || g.y > d.y + d.h) return lum(frames[k].data, 512, 384, x, y);
      return Math.max(0, Math.min(255, M.sample(processed[k], n, n, g.x, g.y)));
    };
  }

  /** Fatias espaço-temporais: eixo horizontal = tempo, vertical = posição na linha. */
  function slices(ctx, probe, dir) {
    const { frames, meta } = ctx, roi = meta.roi, T = meta.frames, amp = amplifiedSampler(ctx);
    const L = Math.max(2, Math.round(dir === 'v' ? roi.h : roi.w));
    const a = new ImageData(T, L), b = new ImageData(T, L);
    for (let k = 0; k < T; k++) for (let i = 0; i < L; i++) {
      const x = dir === 'v' ? probe.x : roi.x + i, y = dir === 'v' ? roi.y + i : probe.y, p = 4 * (i * T + k);
      const o = lum(frames[k].data, 512, 384, x, y), v = amp(k, x, y);
      a.data[p] = a.data[p + 1] = a.data[p + 2] = o; a.data[p + 3] = 255;
      b.data[p] = b.data[p + 1] = b.data[p + 2] = v; b.data[p + 3] = 255;
    }
    // Realce de contraste comum às duas fatias (percentis 1–99 do original).
    const hist = new Uint32Array(256); for (let p = 0; p < a.data.length; p += 4) hist[a.data[p] | 0]++;
    const total = T * L; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < total * .01) lo = v; if (acc <= total * .99) hi = v; }
    const span = Math.max(16, hi - lo);
    for (const img of [a, b]) for (let p = 0; p < img.data.length; p += 4) { const v = Math.max(0, Math.min(255, (img.data[p] - lo) * 255 / span)); img.data[p] = img.data[p + 1] = img.data[p + 2] = v; }
    return { original: a, amplified: b, length: L };
  }

  /** Desenha uma fatia (ImageData T×L) esticada no canvas, com cursor do quadro e marca do ponto. */
  const cache = new WeakMap();
  function paintSlice(canvas, image, head, mark) {
    const { x, w, h } = VibraCharts.setup(canvas);
    let off = cache.get(canvas);
    if (!off || off.image !== image) {
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      c.getContext('2d').putImageData(image, 0, 0); off = { c, image }; cache.set(canvas, off);
    }
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(off.c, 0, 0, w, h);
    if (mark >= 0) { const y = (mark + .5) / image.height * h; x.strokeStyle = 'rgba(224,155,22,.7)'; x.setLineDash([2, 4]); x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); x.setLineDash([]); }
    if (head >= 0) { const px = (head + .5) / image.width * w; x.fillStyle = 'rgba(224,155,22,.95)'; x.fillRect(px - 1, 0, 2, h); }
  }

  /** CSV com t, dx, dy (px da prévia e px nativos quando houver vídeo). */
  function csv(meta, tr, probe) {
    const s = meta.previewScale || 1, f = v => Number(v).toFixed(6), rows = [
      '# Vibra ' + meta.version + ' — deslocamento estimado (experimental, sem calibração em mm)',
      '# fonte: ' + meta.source + (meta.synthetic ? ' (sintética)' : ''),
      '# ponto na prévia 512x384: x=' + probe.x.toFixed(2) + ' y=' + probe.y.toFixed(2),
      '# faixa filtrada (aparente): ' + meta.lowHz + '-' + meta.highHz + ' Hz; fs fisico=' + meta.assumedPhysicalSamplingFps + ' Hz; camera lenta=' + meta.slowMotionFactor + 'x',
      ...(meta.aliasing?.active ? ['# ALIASING (sub-amostragem): faixa real solicitada=' + meta.aliasing.requestedBandHz[0] + '-' + meta.aliasing.requestedBandHz[1] + ' Hz (' + meta.aliasing.zone + 'a zona de Nyquist' + (meta.aliasing.phaseInverted ? ', fase aparente invertida' : '') + ') dobrada em ' + meta.lowHz + '-' + meta.highHz + ' Hz'] : []),
      '# dx/dy ja filtrados na faixa e suavizados espacialmente; NAO sao deslocamento bruto. Campo Euleriano: posicao fixa, nao ponto material.',
      '# px_nativo = px_previa / ' + s.toFixed(6) + ' (escala de ajuste da previa)',
      '# trecho: ' + (meta.segment?.choice || 'manual') + '; verificacao temporal: ' + (meta.segment?.temporalCheck || 'n/d') + '; amostragem uniforme validada: ' + (meta.segment?.uniformSamplingValidated ? 'sim' : 'nao'),
      ...(meta.segment?.gaps?.length ? ['# ATENCAO: trecho com ' + meta.segment.gaps.length + ' lacuna(s) confirmada(s) pelo usuario; t_fisico supoe amostragem uniforme e NAO e valido nesses pontos. Use t_quadro_arquivo_s.'] : []),
      'k,t_fisico_s,t_arquivo_s,t_quadro_arquivo_s,dx_px_previa,dy_px_previa,dx_px_nativo,dy_px_nativo'
    ];
    const src = meta.segment?.sourceFrameTimes;
    for (let k = 0; k < tr.t.length; k++)
      rows.push([k, f(tr.t[k]), f(meta.startSeconds + k / meta.samplingFps), src ? f(src[k]) : '', f(tr.dx[k]), f(tr.dy[k]), f(tr.dx[k] / s), f(tr.dy[k] / s)].join(','));
    return rows.join('\n') + '\n';
  }

  root.VibraAnalysis = { dominant, trace, spectrum, slices, paintSlice, csv, toGrid, toPreview, inside, foldFrequency, foldBand, aliasCandidates };
  if (typeof module !== 'undefined') module.exports = root.VibraAnalysis;
})(typeof self !== 'undefined' ? self : globalThis);
