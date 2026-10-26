/* Vibra 0.6 — orquestração da interface.
   Seções: 1 estado · 2 utilidades · 3 fonte (demo/arquivo) · 4 região
   · 5 parâmetros · 6 processamento · 7 exibição · 8 análise · 9 exportação.
   O cálculo continua em motion.js / engine.js (via worker.js). */
'use strict';

/* ═══ 1. Estado ═════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const original = $('original'), result = $('result'), video = $('sourceVideo');
const ctx = original.getContext('2d'), rctx = result.getContext('2d');
const W = 512, H = 384, BG = '#1f2226';

let source = null;          // {kind:'demo'|'video', name, poster?, timing?}
let polygon = [], drawing = false;
let busy = false, worker = null, job = 0;
let playing = false, raf = 0, frameIndex = 0;
let processed = null;       // {motion} (clássico) ou Float32Array[] (fase)
let renderingMask = null, displayFrames = null, videoUrl = null, meta = null;
let regionChosen = false, filterTouched = false, showGuides = true;
let segMode = 'manual', segCheck = null;   // trecho: 'manual' ou 'suggested' (sugestão automática)
const view = { probe: null, dir: 'v', axis: 'auto', trace: null, spec: null, slices: null };

const off = document.createElement('canvas'); off.width = W; off.height = H;
const ox = off.getContext('2d', { willReadFrequently: true });

/* ═══ 2. Utilidades de interface ════════════════════════════════ */
function status(text, tone = '') { const s = $('status'); s.textContent = text; s.className = 'status' + (tone ? ' ' + tone : ''); }
const fmt = (v, d = 2) => VibraCharts.fmt(v, d);

function segmentReady() { return !!segCheck?.ok && (!segCheck.gaps?.length || $('gapConfirm').checked); }
function available() { $('run').disabled = busy || !source || (source.kind === 'video' && !$('confirm').checked) || !segmentReady(); }

/* Diagnóstico do trecho analisado: limites, lacunas e modo de escolha. */
function evaluateSegment() {
  const box = $('segStatus'), fps = +$('fps').value, count = +$('count').value, start = +$('start').value;
  const show = (tone, text) => { box.dataset.tone = tone; $('segText').textContent = text; };
  const isVideo = source?.kind === 'video';
  $('regular').hidden = $('regularHint').hidden = !(isVideo && source.timing);
  $('gapWrap').hidden = true; segCheck = null;
  box.dataset.mode = source?.kind === 'demo' ? 'demo' : segMode;
  $('segMode').textContent = !source ? 'Trecho' : source.kind === 'demo' ? 'Demonstração'
    : segMode === 'suggested' ? 'Sugestão automática, baseada na temporização do arquivo' : 'Escolha manual';
  if (!source) return show('idle', 'Carregue um vídeo para definir o trecho.');
  if (!(fps >= 1 && fps <= 240)) return show('error', 'Informe uma amostragem entre 1 e 240 FPS em “Aquisição e resolução”.');
  const c = VibraProbe.analyzeSegment(isVideo ? source.timing : null, start, count, fps, isVideo ? video.duration : Infinity);
  segCheck = c;
  if (!c.ok) return show('error', c.reason);
  const range = `${fmt(start)}–${fmt(c.end)} s do arquivo, ${count} quadros a ${fmt(fps)} FPS`;
  if (source.kind === 'demo') return show('ok', `Quadros gerados a ${fmt(fps)} FPS: ${count} quadros (${fmt((count - 1) / fps)} s).`);
  if (!c.verified) return show('warn', `${range}. A temporização do arquivo não pôde ser lida, então as lacunas não podem ser verificadas e a amostragem uniforme não está confirmada.`);
  if (c.regular) return show('ok', `${range}. Sem lacunas neste intervalo${c.held ? `; ${c.held} amostra${c.held > 1 ? 's repetem' : ' repete'} o quadro anterior` : ''}.`);
  const big = c.gaps.reduce((a, g) => g.seconds > a.seconds ? g : a);
  $('gapWrap').hidden = false;
  show('warn', `${range}. O intervalo tem ${c.gaps.length} lacuna${c.gaps.length > 1 ? 's' : ''} na gravação; a maior dura ${fmt(big.seconds)} s, a partir de ${fmt(big.from)} s. Nesses pontos o navegador repete o último quadro disponível: o tempo deixa de ser uniforme e frequência e amplitude podem sair distorcidas.`);
}

function updateFlow() {
  VibraUI.flow([!!source, !!source && (regionChosen || !!processed), !!source && (filterTouched || !!processed), !!processed]);
}

function stop() { playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶'; $('play').classList.remove('is-playing'); $('play').setAttribute('aria-label', 'Reproduzir'); }

function setResultEnabled(on) {
  for (const id of ['play', 'timeline', 'export', 'report']) $(id).disabled = !on;
  $('csv').disabled = !(on && processed?.motion);
  result.classList.toggle('is-pickable', !!on);
}

function invalidate() {
  stop(); processed = null; renderingMask = null; displayFrames = null; meta = null;
  view.trace = view.spec = view.slices = view.probe = null;
  setResultEnabled(false);
  $('emptyResult').hidden = false; $('resultTag').textContent = 'sem resultado'; $('originalTag').textContent = 'desenhe aqui';
  VibraUI.state(source ? 'Pronto para configurar' : 'Aguardando vídeo', source ? 'ready' : 'idle');
  rctx.clearRect(0, 0, W, H); $('elapsed').textContent = '–';
  clearAnalysis(); updateFlow();
}

function controls(disabled) {
  busy = disabled;
  document.querySelectorAll('aside.controls input, aside.controls select, aside.controls button').forEach(e => { e.disabled = disabled; });
  document.querySelector('aside.controls').classList.toggle('is-busy', disabled);
  $('cancel').disabled = false; $('cancel').hidden = !disabled; $('progress').hidden = !disabled;
  syncMethod(); available();
}

function grayImage(frame, n) {
  const image = new ImageData(n, n);
  for (let p = 0; p < n * n; p++) { const v = Math.min(255, Math.max(0, Math.round(frame[p]))); image.data.set([v, v, v, 255], p * 4); }
  return image;
}

/* ═══ 3. Fonte: régua virtual e arquivo ═════════════════════════ */
function demoFrame(k, fs = 32) {
  ox.fillStyle = '#24272c'; ox.fillRect(0, 0, W, H);
  ox.strokeStyle = '#2d3137'; ox.lineWidth = 1;
  for (let y = 0; y < H; y += 32) { ox.beginPath(); ox.moveTo(0, y); ox.lineTo(W, y); ox.stroke(); }
  for (let x = 0; x < W; x += 32) { ox.beginPath(); ox.moveTo(x, 0); ox.lineTo(x, H); ox.stroke(); }
  ox.fillStyle = '#8a9099'; ox.fillRect(52, 140, 66, 110); ox.fillStyle = '#3a3e45'; ox.fillRect(62, 151, 46, 88);
  // 2,4 px na ponta livre (prévia de 512 px), 4 Hz.
  const deflect = x => 2.4 * Math.pow((x - 110) / 345, 2) * Math.sin(2 * Math.PI * 4 * k / fs);
  ox.beginPath(); ox.moveTo(110, 181);
  for (let x = 110; x <= 455; x += 5) ox.lineTo(x, 181 + deflect(x));
  for (let x = 455; x >= 110; x -= 5) ox.lineTo(x, 199 + deflect(x));
  ox.closePath(); ox.fillStyle = '#d4d8de'; ox.fill();
  ox.strokeStyle = '#5a606a';
  for (let x = 130; x < 450; x += 15) { ox.beginPath(); ox.moveTo(x, 182 + deflect(x)); ox.lineTo(x, 188 + deflect(x)); ox.stroke(); }
  ox.fillStyle = '#f7f8fa'; [200, 320, 435].forEach(x => { ox.beginPath(); ox.arc(x, 190 + deflect(x), 3, 0, Math.PI * 2); ox.fill(); });
  return ox.getImageData(0, 0, W, H);
}

$('demo').onclick = () => {
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  video.removeAttribute('src');
  source = { kind: 'demo', name: 'Régua virtual · 4 Hz' }; polygon = []; regionChosen = false; filterTouched = false;
  invalidate();
  $('fps').value = 32; $('slow').value = 1; $('count').value = 64; $('lo').value = 2; $('hi').value = 6; $('start').value = 0; $('gain').value = 10;
  $('confirmWrap').hidden = true; $('confirm').checked = true; segMode = 'manual'; $('gapConfirm').checked = false;
  $('timingInfo').textContent = '32 FPS · 4 Hz · 2,4 px na ponta';
  $('sourceInfo').textContent = 'Viga engastada sintética, para conhecer o fluxo. Não é um ensaio real.';
  $('emptyOriginal').hidden = true;
  drawSource(); syncLabels(); evaluateSegment(); available(); updateFlow();
  status('Régua carregada. Contorne a viga no quadro Original ou use a imagem inteira.');
};

function waitEvent(el, event, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('O navegador demorou para ler este vídeo. Tente um MP4 curto.')), timeout);
    const ok = () => finish(), bad = () => finish(Error('Formato de vídeo não suportado neste navegador.'));
    function finish(err) { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', bad); err ? reject(err) : resolve(); }
    el.addEventListener(event, ok, { once: true }); el.addEventListener('error', bad, { once: true });
  });
}
async function seek(t) { if (Math.abs(video.currentTime - t) < .00001 && video.readyState >= 2) return; const ready = waitEvent(video, 'seeked'); video.currentTime = t; await ready; }
function fitScale() { return Math.min(W / video.videoWidth, H / video.videoHeight); }
function videoFrame() {
  ox.fillStyle = BG; ox.fillRect(0, 0, W, H);
  const s = fitScale(), w = video.videoWidth * s, h = video.videoHeight * s;
  ox.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
  return ox.getImageData(0, 0, W, H);
}

async function loadFile(f) {
  if (!f) return;
  if (f.size > 250 * 1024 * 1024) { status('Use um vídeo de até 250 MB nesta versão.', 'error'); return; }
  invalidate(); source = null; polygon = []; regionChosen = false; filterTouched = false; segMode = 'manual'; $('gapConfirm').checked = false; evaluateSegment(); available();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(f);
  try {
    const loaded = waitEvent(video, 'loadeddata'); video.src = videoUrl; video.load(); await loaded;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('Não foi possível determinar a duração.');
    const timing = await VibraProbe.probe(f).catch(() => null);
    source = { kind: 'video', name: f.name, poster: videoFrame(), timing };
    $('fps').value = timing ? Number(timing.nominalFps.toFixed(5)) : 30; $('slow').value = 1; $('start').value = 0;
    $('confirmWrap').hidden = false; $('confirm').checked = false; $('emptyOriginal').hidden = true;
    $('sourceInfo').textContent = `${f.name} · ${video.videoWidth} × ${video.videoHeight} · ${fmt(video.duration)} s. Confira os FPS em “Aquisição e resolução”.`;
    drawSource(); VibraUI.state('Confira a gravação', 'warn');
    $('timingInfo').textContent = timing
      ? `Média ${timing.fps.toFixed(3)} FPS · usual ≈ ${timing.nominalFps.toFixed(3)} FPS · ${timing.samples} quadros. ${timing.variable ? 'Há lacunas em alguns pontos do arquivo.' : 'Temporização aproximadamente regular.'} Câmera lenta e quadros duplicados não são detectados.`
      : 'Não foi possível ler os FPS do arquivo. Confira as propriedades; não use automaticamente os FPS da câmera.';
    status(timing?.variable ? 'O arquivo tem lacunas na temporização. Veja o diagnóstico em “Trecho analisado”: peça uma sugestão regular ou mantenha seu início e confirme as lacunas.' : 'Vídeo carregado. Confira os FPS e confirme para processar.');
  } catch (err) { status(err.message, 'error'); $('emptyOriginal').hidden = false; }
  syncLabels(); evaluateSegment(); available(); updateFlow();
}
$('file').onchange = e => loadFile(e.target.files[0]);
$('demoQuick').onclick = () => { if (!busy) $('demo').click(); };

// Arrastar e soltar sobre a área de importação.
const drop = document.querySelector('.drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); if (!busy) drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', e => { e.preventDefault(); if (!busy) loadFile(e.dataTransfer.files[0]); });

$('regular').onclick = () => {
  if (busy || source?.kind !== 'video') return;
  const fps = +$('fps').value, count = +$('count').value, current = +$('start').value;
  const r = VibraProbe.suggestSegment(source.timing, count, fps, Number.isFinite(current) ? current : 0);
  if (!r.ok) { status(r.reason, 'error'); return; }          // nada é alterado
  invalidate(); drawSource();
  $('start').value = r.start; segMode = 'suggested'; $('gapConfirm').checked = false;
  evaluateSegment(); syncLabels(); available();
  status(`Início sugerido: ${fmt(r.start, 3)} s. Intervalo ${fmt(r.start)}–${fmt(r.end)} s, sem lacunas, com os mesmos ${count} quadros a ${fmt(fps)} FPS. Só o início foi alterado.`, 'ok');
};
$('confirm').onchange = available;
$('gapConfirm').onchange = available;

/* ═══ 4. Região de interesse (contorno livre) ═══════════════════ */
function polygonOverlay() {
  if (!polygon.length) return;
  ctx.save(); ctx.beginPath();
  polygon.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  if (!drawing) ctx.closePath();
  ctx.fillStyle = 'rgba(127,156,240,.16)'; if (!drawing) ctx.fill();
  ctx.strokeStyle = '#7f9cf0'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.restore();
}
function drawSource() {
  ctx.clearRect(0, 0, W, H); if (!source) return;
  if (source.kind === 'demo') ctx.putImageData(demoFrame(0), 0, 0); else if (source.poster) ctx.putImageData(source.poster, 0, 0);
  polygonOverlay();
}
/** Coordenadas na prévia 512×384 a partir de um evento (o canvas usa object-fit: contain). */
function position(e, canvas) {
  const box = canvas.getBoundingClientRect(), scale = Math.min(box.width / W, box.height / H);
  const left = box.left + (box.width - W * scale) / 2, top = box.top + (box.height - H * scale) / 2;
  return { x: Math.max(0, Math.min(W, (e.clientX - left) / scale)), y: Math.max(0, Math.min(H, (e.clientY - top) / scale)) };
}
original.onpointerdown = e => { if (!source || busy) return; e.preventDefault(); invalidate(); drawing = true; polygon = [position(e, original)]; original.setPointerCapture(e.pointerId); drawSource(); };
original.onpointermove = e => { if (!drawing) return; e.preventDefault(); const p = position(e, original), last = polygon[polygon.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > 2) polygon.push(p); drawSource(); };
function finishDraw() {
  if (!drawing) return; drawing = false;
  let area = 0; polygon.forEach((p, i) => { const q = polygon[(i + 1) % polygon.length]; area += p.x * q.y - p.y * q.x; });
  if (polygon.length < 3 || Math.abs(area) < 300) { polygon = []; status('Desenhe uma região maior. A imagem inteira continua selecionada.'); }
  else { regionChosen = true; status('Região definida. Ajuste a faixa de frequência e amplifique.'); }
  $('selectionInfo').textContent = polygon.length ? 'Contorno livre selecionado. Uma margem de 20 px entra no cálculo.' : 'A imagem inteira está selecionada.';
  drawSource(); updateFlow();
}
original.onpointerup = finishDraw; original.onpointercancel = finishDraw;
function clearRegion(chosen) { if (busy) return; polygon = []; invalidate(); regionChosen = chosen; $('selectionInfo').textContent = 'A imagem inteira está selecionada.'; drawSource(); updateFlow(); }
$('all').onclick = () => clearRegion(true);
$('clear').onclick = () => clearRegion(false);

function region() {
  if (!polygon.length) {
    if (source?.kind === 'video') { const s = fitScale(), w = video.videoWidth * s, h = video.videoHeight * s; return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
    return { x: 0, y: 0, w: W, h: H };
  }
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const x = Math.max(0, Math.floor(Math.min(...xs) - 20)), y = Math.max(0, Math.floor(Math.min(...ys) - 20));
  const right = Math.min(W, Math.ceil(Math.max(...xs) + 20)), bottom = Math.min(H, Math.ceil(Math.max(...ys) + 20));
  return { x, y, w: right - x, h: bottom - y };
}
function dimensions(roi, n) { const s = (n - 8) / Math.max(roi.w, roi.h); return { w: roi.w * s, h: roi.h * s, x: (n - roi.w * s) / 2, y: (n - roi.h * s) / 2 }; }
function makeMask(roi, n, d) {
  if (!polygon.length) return null;
  const c = document.createElement('canvas'); c.width = n; c.height = n; const x = c.getContext('2d');
  x.filter = 'blur(1px)'; x.beginPath();
  polygon.forEach((p, i) => { const px = d.x + (p.x - roi.x) / roi.w * d.w, py = d.y + (p.y - roi.y) / roi.h * d.h; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.closePath(); x.fillStyle = 'white'; x.fill();
  const a = x.getImageData(0, 0, n, n).data; return Float32Array.from({ length: n * n }, (_, p) => a[p * 4 + 3] / 255);
}
function sample(image, roi, n, d) {
  ox.putImageData(image, 0, 0);
  const c = document.createElement('canvas'); c.width = n; c.height = n; const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = BG; x.fillRect(0, 0, n, n); x.drawImage(off, roi.x, roi.y, roi.w, roi.h, d.x, d.y, d.w, d.h);
  const a = x.getImageData(0, 0, n, n).data; return Float32Array.from({ length: n * n }, (_, p) => .2126 * a[4 * p] + .7152 * a[4 * p + 1] + .0722 * a[4 * p + 2]);
}

/* ═══ 5. Parâmetros ═════════════════════════════════════════════ */
const lambdaC = () => (processed && !processed.motion) || $('method').value !== 'flow' ? 0 : +$('lambda').value;
function syncLabels() {
  const g = $('gain').value, lam = +$('lambda').value, fs = +$('fps').value * +$('slow').value, T = +$('count').value;
  const lo = +$('lo').value, hi = +$('hi').value, fold = VibraAnalysis.foldBand(lo, hi, fs);
  $('gainLabel').textContent = g + '×'; $('gainMetric').innerHTML = g + '<em>×</em>';
  $('bandMetric').innerHTML = fold.ok && fold.aliased
    ? `${fmt(lo)}–${fmt(hi)}<em>Hz (→ ${fmt(fold.effectiveLo)}–${fmt(fold.effectiveHi)} Hz, Z${fold.zone})</em>`
    : `${fmt(lo)}–${fmt(hi)}<em>Hz</em>`;
  $('lambdaLabel').textContent = lam ? lam + ' px' : 'sem limite';
  $('lambdaMetric').innerHTML = $('method').value === 'flow' && lam ? lam + '<em>px</em>' : '–';
  $('resMetric').innerHTML = fs > 0 ? fmt(fs / T) + '<em>Hz</em>' : '–';
  VibraUI.band(lo, hi, fs, T);
  ['gain', 'lambda'].forEach(id => VibraUI.fill($(id)));
}
function syncMethod() {
  const flow = $('method').value === 'flow';
  $('lambdaWrap').classList.toggle('is-off', !flow); if (!busy) $('lambda').disabled = !flow;
  $('lambdaHint').innerHTML = flow
    ? 'Limita o deslocamento amplificado a λ<sub>c</sub>/8 para reduzir borrões (Wu et al., 2012). Muda na hora, sem reprocessar.'
    : 'Não se aplica ao método de fase.';
  syncLabels();
}
for (const id of ['lo', 'hi', 'fps', 'slow', 'count', 'size', 'start'])
  $(id).oninput = () => {
    if (id === 'lo' || id === 'hi') filterTouched = true;
    const segChanged = id === 'start' || id === 'count' || id === 'fps';
    if (segChanged) { segMode = 'manual'; $('gapConfirm').checked = false; }
    invalidate(); drawSource(); syncLabels(); evaluateSegment(); available();
    if (segChanged && source?.kind === 'video') status(segCheck?.ok ? (segCheck.gaps?.length ? 'Trecho escolhido manualmente com lacunas. Confirme em “Trecho analisado” para processar.' : 'Trecho escolhido manualmente.') : 'Trecho inválido. Veja a explicação em “Trecho analisado”.', segCheck?.ok ? '' : 'error');
  };
$('method').onchange = () => { filterTouched = true; invalidate(); drawSource(); syncMethod(); available(); };

// Ganho e λc: no modo clássico são aplicados na exibição, sem recalcular o campo.
let refreshTimer = 0;
function liveVisual() {
  syncLabels();
  if (processed?.motion && meta) {
    meta.requestedGain = +$('gain').value; meta.lambdaC = lambdaC();
    $('resultTag').textContent = 'ganho ' + meta.requestedGain + '×';
    drawFrame(frameIndex);
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => computeSlices(), 90);
    status('Atualizado sem reprocessar.', 'ok');
  } else { invalidate(); drawSource(); available(); }
}
$('gain').oninput = liveVisual;
$('lambda').oninput = liveVisual;

/* ═══ 6. Processamento ══════════════════════════════════════════ */
function shortSegmentMessage(count, fps, slow, minHz) {
  const fs = fps * slow, duration = count / fs, cycles = duration * minHz, required = Math.ceil(2 * fs / minHz);
  const explanation = `Trecho insuficiente para ${fmt(minHz)} Hz: ${count} quadros correspondem a ${fmt(duration)} s do movimento real (${fmt(cycles)} ${cycles > 1 ? 'ciclos' : 'ciclo'}). O protótipo exige pelo menos 2 ciclos da frequência mínima.`;
  const ok = [32, 64, 128].find(n => n >= required);
  if (ok) return `${explanation} Selecione ${ok} quadros em “Quadros analisados”.`;
  return `${explanation} Seriam necessários ${required} quadros (${fmt(required / fps)} s de reprodução${slow > 1 ? ` com câmera lenta de ${fmt(slow)}×` : ''}). Esta versão aceita até 128. Use frequência mínima de pelo menos ${fmt(Math.ceil(2 * fs / count * 100) / 100)} Hz.`;
}

function validate({ fps, slow, fs, lo, hi, gain, t, start }) {
  if (gain < 1 || gain > 100) throw Error('Use ganho entre 1× e 100×.');
  if (![fps, slow, lo, hi, gain, start].every(Number.isFinite) || fps < 1 || fps > 240 || slow < 1 || slow > 16 || start < 0 || !(lo > 0 && lo < hi))
    throw Error('Use 0 < frequência mínima < máxima. Confira os demais valores.');
  const fold = VibraAnalysis.foldBand(lo, hi, fs);
  if (!fold.ok) throw Error(fold.reason);
  if (t / fs * fold.effectiveLo < 2) throw Error(shortSegmentMessage(t, fps, slow, fold.effectiveLo));
  if (source.kind === 'demo' && (fps !== 32 || slow !== 1)) throw Error('A demonstração usa 32 FPS e câmera lenta 1×.');
  evaluateSegment();
  if (!segCheck?.ok) throw Error(segCheck?.reason || 'Trecho inválido.');
  if (segCheck.gaps?.length && !$('gapConfirm').checked)
    throw Error('Este trecho tem lacunas. Marque a confirmação em “Trecho analisado” para processá-lo mesmo assim, ou peça uma sugestão de trecho regular.');
  return fold;
}

$('run').onclick = async () => {
  const ticket = ++job; stop(); invalidate();
  const fps = +$('fps').value, slow = +$('slow').value, fs = fps * slow, lo = +$('lo').value, hi = +$('hi').value;
  const gain = +$('gain').value, n = +$('size').value, t = +$('count').value, start = +$('start').value, method = $('method').value;
  try {
    const fold = validate({ fps, slow, fs, lo, hi, gain, t, start });
    const effLo = fold.effectiveLo, effHi = fold.effectiveHi;
    controls(true); regionChosen = filterTouched = true; updateFlow();
    $('progress').value = 0; VibraUI.state('Preparando quadros', 'busy');
    VibraUI.proc.show({ track: method === 'flow' ? 'Rastreamento do movimento' : 'Decomposição em fase', filter: method === 'flow' ? 'Filtragem temporal' : 'Filtragem e amplificação' });
    const seg = segCheck;
    const roi = region(), d = dimensions(roi, n), frames = [], full = [];

    for (let k = 0; k < t; k++) {
      if (ticket !== job) return;
      let im;
      if (source.kind === 'demo') im = demoFrame(k, fps);
      else { await seek(start + k / fps); if (ticket !== job) return; im = videoFrame(); }
      full.push(im); frames.push(sample(im, roi, n, d));
      if (k % 8 === 0) {
        status(`Lendo quadro ${k + 1} de ${t}…`); $('progress').value = .2 * k / t; VibraUI.proc.update(.2 * k / t, 'read');
        await new Promise(r => setTimeout(r, 0));
      }
    }

    displayFrames = full; const mask = makeMask(roi, n, d); renderingMask = mask;
    meta = {
      version: '0.8.0', source: source.name, synthetic: source.kind === 'demo',
      method: method === 'flow' ? 'experimental-classical-motion-warp' : 'experimental-complex-phase-filterbank',
      rendering: method === 'flow' ? 'warp-recorded-pixels-at-preview-resolution' : 'complete-reconstructed-crop',
      fileTiming: source.timing ? { fpsMean: source.timing.fps, nominalFps: source.timing.nominalFps, variable: source.timing.variable } : null,
      temporalResampling: 'uniform requested times; browser frame holds, no generated intermediate images',
      samplingFps: fps, slowMotionFactor: slow, assumedPhysicalSamplingFps: fs,
      lowHz: effLo, highHz: effHi, requestedLowHz: lo, requestedHighHz: hi,
      aliasing: {
        active: fold.aliased, zone: fold.zone, phaseInverted: fold.phaseInverted,
        nyquistHz: fold.nyquist, requestedBandHz: [lo, hi], foldedBandHz: [effLo, effHi]
      },
      requestedGain: gain, lambdaC: method === 'flow' ? +$('lambda').value : 0,
      frames: t, physicalDuration: t / fs, resolution: n, startSeconds: start, roi, dimensions: d,
      previewScale: source.kind === 'video' ? fitScale() : 1,
      polygon: polygon.map(p => ({ ...p })), validatedOnDevice: false,
      segment: {
        choice: source.kind === 'demo' ? 'demo' : segMode === 'suggested' ? 'automatic-suggestion-from-file-timing' : 'manual',
        startSeconds: start, endSeconds: seg.end, frames: t, samplingFps: fps,
        temporalCheck: source.kind === 'demo' ? 'synthetic' : !seg.verified ? 'not-verified-no-timing-table' : seg.regular ? 'no-gaps-in-file-timing' : 'gaps-confirmed-by-user',
        userConfirmedGaps: !!(seg.gaps?.length && $('gapConfirm').checked),
        uniformSamplingValidated: !!(seg.verified && seg.regular),
        gaps: (seg.gaps || []).map(g => ({ fromSeconds: +g.from.toFixed(4), toSeconds: +g.to.toFixed(4), seconds: +g.seconds.toFixed(4) })),
        heldSamples: seg.held || 0,
        sourceFrameTimes: seg.sourceTimes ? Array.from(seg.sourceTimes, v => +v.toFixed(5)) : null
      }
    };

    worker = new Worker('worker.js?v=0.6.0');
    VibraUI.state(method === 'flow' ? 'Rastreando deslocamentos' : 'Calculando fases', 'busy');
    status(method === 'phase' && n >= 256 ? 'Processando em alta resolução; pode levar alguns minutos.' : 'Processando. Mantenha a página aberta.');

    worker.onmessage = e => {
      if (ticket !== job) return;
      const data = e.data;
      if (data.progress !== undefined) {
        const p = .2 + .8 * data.progress; $('progress').value = p;
        VibraUI.proc.update(p, method === 'flow' && data.progress >= .7 ? 'filter' : data.progress >= .95 ? 'filter' : 'track');
        status(`Processando… ${Math.round(data.progress * 100)}%`);
        return;
      }
      worker.terminate(); worker = null;
      if (data.error) { VibraUI.proc.hide(); controls(false); status(data.error, 'error'); VibraUI.state('Ajuste os parâmetros', 'warn'); return; }
      VibraUI.proc.update(1, 'render');
      processed = data.motion ? { motion: data.motion } : data.frames; meta.seconds = data.seconds;
      requestAnimationFrame(() => finishRun(method, roi, d, t, fs, gain));
    };
    worker.onerror = () => {
      if (ticket !== job) return; worker?.terminate(); worker = null; VibraUI.proc.hide(); controls(false);
      status('Falha no processamento. Tente resolução de 64 px e 32 quadros.', 'error'); VibraUI.state('Falha no cálculo', 'warn');
    };
    worker.postMessage({ frames, n, fs, lo: effLo, hi: effHi, gain, mask, method }, frames.map(f => f.buffer));
  } catch (err) {
    if (ticket !== job) return; VibraUI.proc.hide(); controls(false); status(err.message, 'error'); VibraUI.state('Ajuste os parâmetros', 'warn');
  }
};

function finishRun(method, roi, d, t, fs, gain) {
  controls(false);
  $('elapsed').innerHTML = fmt(meta.seconds, 1) + '<em>s</em>';
  $('emptyResult').hidden = true;
  $('resultTag').textContent = 'ganho ' + gain + '×' + (meta.aliasing?.active ? ` · Z${meta.aliasing.zone} (aliasing)` : '');
  $('originalTag').textContent = 'referência';
  VibraUI.state('Resultado experimental', 'done');
  $('timeline').max = t - 1; $('timeline').value = 0; VibraUI.fill($('timeline')); frameIndex = 0;
  setResultEnabled(true);
  computeAnalysis();
  drawFrame(0);
  VibraUI.proc.hide(); updateFlow();
  const downscale = Math.max(roi.w / d.w, roi.h / d.h);
  status(method === 'flow'
    ? 'Pronto. Toque no quadro amplificado para escolher o ponto de medição.'
    : downscale > 1.5 ? 'Pronto. A região foi reduzida no cálculo; use uma região menor ou resolução maior.' : 'Pronto.', 'ok');
  $('resultInfo').textContent = `${t} quadros, ${fmt(meta.physicalDuration)} s de movimento real, grade de ${Math.round(d.w)} × ${Math.round(d.h)} px. O início e o fim do trecho podem ter artefatos.`;
  if (meta.aliasing?.active) {
    $('resultInfo').textContent += ` Sub-amostragem (${meta.aliasing.zone}ª zona de Nyquist${meta.aliasing.phaseInverted ? ', fase aparente invertida' : ''}): faixa solicitada ${fmt(meta.requestedLowHz)}–${fmt(meta.requestedHighHz)} Hz filtrada na banda dobrada ${fmt(meta.lowHz)}–${fmt(meta.highHz)} Hz.`;
  }
  if (meta.segment.userConfirmedGaps) {
    const g = meta.segment.gaps.length;
    $('resultTag').textContent = 'ganho ' + gain + '×, trecho com lacunas';
    $('resultInfo').textContent += ` Atenção: o trecho tem ${g} lacuna${g > 1 ? 's' : ''} confirmada${g > 1 ? 's' : ''} por você; a amostragem não é uniforme e frequência e amplitude podem estar distorcidas.`;
    status('Pronto, com lacunas no trecho. Use o resultado só para inspeção visual; a temporização não é uniforme.', 'warn');
  }
}

$('cancel').onclick = () => {
  job++; worker?.terminate(); worker = null; VibraUI.proc.hide(); controls(false); invalidate(); drawSource();
  status('Processamento cancelado. Ajuste e tente novamente.');
};

/* ═══ 7. Exibição sincronizada ══════════════════════════════════ */
const tile = document.createElement('canvas');
function zoomBox(roi) { const s = Math.min(W / roi.w, H / roi.h), w = roi.w * s, h = roi.h * s; return { s, x: (W - w) / 2, y: (H - h) / 2, w, h }; }
/** prévia → coordenadas do canvas exibido (considera o zoom no recorte). */
function toScreen(p) { if (!$('zoom').checked) return p; const z = zoomBox(meta.roi); return { x: z.x + (p.x - meta.roi.x) * z.s, y: z.y + (p.y - meta.roi.y) * z.s }; }
function fromScreen(p) { if (!$('zoom').checked) return p; const z = zoomBox(meta.roi); return { x: meta.roi.x + (p.x - z.x) / z.s, y: meta.roi.y + (p.y - z.y) / z.s }; }

function blitZoomed(target, image) {
  const z = zoomBox(meta.roi);
  ox.putImageData(image, 0, 0); target.fillStyle = BG; target.fillRect(0, 0, W, H);
  target.drawImage(off, meta.roi.x, meta.roi.y, meta.roi.w, meta.roi.h, z.x, z.y, z.w, z.h);
}

function guides(target) {
  if (!showGuides || !view.probe) return;
  const roi = meta.roi, p = toScreen(view.probe);
  const a = toScreen(view.dir === 'v' ? { x: view.probe.x, y: roi.y } : { x: roi.x, y: view.probe.y });
  const b = toScreen(view.dir === 'v' ? { x: view.probe.x, y: roi.y + roi.h } : { x: roi.x + roi.w, y: view.probe.y });
  target.save();
  target.strokeStyle = 'rgba(224,155,22,.85)'; target.lineWidth = 1.25; target.setLineDash([5, 4]);
  target.beginPath(); target.moveTo(a.x, a.y); target.lineTo(b.x, b.y); target.stroke(); target.setLineDash([]);
  target.strokeStyle = '#7f9cf0'; target.lineWidth = 2;
  target.beginPath(); target.arc(p.x, p.y, 7, 0, Math.PI * 2); target.stroke();
  target.beginPath(); target.moveTo(p.x - 12, p.y); target.lineTo(p.x - 4, p.y); target.moveTo(p.x + 4, p.y); target.lineTo(p.x + 12, p.y);
  target.moveTo(p.x, p.y - 12); target.lineTo(p.x, p.y - 4); target.moveTo(p.x, p.y + 4); target.lineTo(p.x, p.y + 12); target.stroke();
  target.restore();
}

function drawFrame(k) {
  if (!processed || !meta) return;
  frameIndex = k;
  const base = new ImageData(new Uint8ClampedArray(displayFrames[k].data), W, H);
  for (let p = 0; p < base.data.length; p += 4) { const y = .2126 * base.data[p] + .7152 * base.data[p + 1] + .0722 * base.data[p + 2]; base.data[p] = base.data[p + 1] = base.data[p + 2] = y; }
  const n = meta.resolution, d = meta.dimensions, roi = meta.roi, zoom = $('zoom').checked;
  // A referência mantém a resolução da prévia; apenas o resultado vem da grade.
  ctx.imageSmoothingEnabled = rctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = rctx.imageSmoothingQuality = 'high';
  if (zoom) blitZoomed(ctx, base); else ctx.putImageData(base, 0, 0);
  if (processed.motion) {
    const warped = new ImageData(VibraMotion.warp(base.data, W, H, roi, d, processed.motion, k, meta.requestedGain, renderingMask, lambdaC()), W, H);
    if (zoom) blitZoomed(rctx, warped); else rctx.putImageData(warped, 0, 0);
  } else {
    tile.width = n; tile.height = n; tile.getContext('2d').putImageData(grayImage(processed[k], n), 0, 0);
    if (zoom) { const z = zoomBox(roi); rctx.fillStyle = BG; rctx.fillRect(0, 0, W, H); rctx.drawImage(tile, d.x, d.y, d.w, d.h, z.x, z.y, z.w, z.h); }
    else { rctx.putImageData(base, 0, 0); rctx.drawImage(tile, d.x, d.y, d.w, d.h, roi.x, roi.y, roi.w, roi.h); }
  }
  guides(ctx); guides(rctx);
  $('timeline').value = k; VibraUI.fill($('timeline'));
  $('time').textContent = `${k + 1} / ${meta.frames}`;
  paintAnalysis();
}

$('zoom').onchange = () => { if (processed) drawFrame(frameIndex); };
$('timeline').oninput = () => { stop(); drawFrame(+$('timeline').value); };
$('play').onclick = () => {
  if (playing) { stop(); return; }
  if (!processed) return;
  playing = true; $('play').textContent = '❚❚'; $('play').classList.add('is-playing'); $('play').setAttribute('aria-label', 'Pausar');
  let last = performance.now();
  (function tick(now) {
    if (!playing) return;
    const interval = 1000 / (meta.samplingFps * +$('speed').value);
    if (now - last >= interval) { const steps = Math.floor((now - last) / interval); drawFrame((frameIndex + steps) % meta.frames); last += steps * interval; }
    raf = requestAnimationFrame(tick);
  })(last);
};

// Escolha do ponto de medição tocando no painel amplificado.
result.addEventListener('pointerdown', e => {
  if (!processed || !meta || busy) return;
  const p = fromScreen(position(e, result));
  if (!VibraAnalysis.inside(p, meta.roi)) { status('Toque dentro do recorte processado para escolher o ponto.', 'error'); return; }
  view.probe = p; computeAnalysis(true); drawFrame(frameIndex);
  status(`Ponto de medição em (${fmt(p.x, 0)}, ${fmt(p.y, 0)}) px da prévia.`, 'ok');
});

/* ═══ 8. Análise: fatia espaço-temporal, x(t), espectro e dobramento (aliasing) ═══ */
function clearAnalysis() {
  document.querySelector('.analysis').classList.add('is-empty');
  VibraCharts.empty($('trace'), 'Sem dados');
  VibraCharts.empty($('spectrum'), 'Sem dados');
  VibraCharts.empty($('folding'), 'Sem dados');
  for (const id of ['sliceOrig', 'sliceAmp']) VibraCharts.setup($(id));
  $('peakTag').textContent = '–'; $('foldingTag').textContent = '–'; $('sliceEnd').textContent = 'tempo';
  $('foldingInfo').textContent = 'Relaciona a frequência aparente medida em [0, fs/2] às frequências reais candidatas nas zonas de Nyquist.';
}

function computeSlices() {
  if (!processed || !meta || !view.probe) return;
  view.slices = VibraAnalysis.slices({ frames: displayFrames, processed, meta, mask: renderingMask, gain: meta.requestedGain, lambdaC: lambdaC() }, view.probe, view.dir);
  paintAnalysis();
}

function computeAnalysis(keepProbe = false) {
  if (!processed || !meta) return;
  document.querySelector('.analysis').classList.remove('is-empty');
  const field = processed.motion, fs = meta.assumedPhysicalSamplingFps, activeZone = meta.aliasing?.zone || 1;
  if (!keepProbe || !view.probe) view.probe = field ? VibraAnalysis.dominant(field, meta, renderingMask) : { x: meta.roi.x + meta.roi.w / 2, y: meta.roi.y + meta.roi.h / 2 };
  if (field) {
    view.trace = VibraAnalysis.trace(field, meta, view.probe);
    const axis = view.axis === 'auto' ? view.trace.dominantAxis : view.axis;
    view.spec = VibraAnalysis.spectrum(view.trace[axis], view.trace.fs);
    const peakAmp = view.spec.a[view.spec.peak], peakF = view.spec.f[view.spec.peak];
    const cands = VibraAnalysis.aliasCandidates(peakF, fs, Math.max(4, activeZone + 1));
    const targetF = cands.find(c => c.zone === activeZone)?.fReal ?? peakF;
    const candList = cands.slice(0, 4).map(c => `${fmt(c.fReal)} Hz (${c.zone}ª zona${c.phaseInverted ? ', −φ' : ''})`).join(' · ');
    if (meta.aliasing?.active) {
      $('peakTag').textContent = `aparente ${fmt(peakF)} Hz → ${fmt(targetF)} Hz (Z${activeZone})`;
      $('traceInfo').textContent = `${axis === 'dy' ? 'Vertical' : 'Horizontal'}, no ponto (${fmt(view.probe.x, 0)}, ${fmt(view.probe.y, 0)}). Amplitude de ${fmt(peakAmp, 2)} px a ${fmt(peakF)} Hz aparentes (${fmt(targetF)} Hz na ${activeZone}ª zona${meta.aliasing.phaseInverted ? ', fase invertida' : ''}). Sem calibração em mm.`;
      $('foldingTag').textContent = `${activeZone}ª zona de Nyquist${meta.aliasing.phaseInverted ? ' · fase invertida' : ''}`;
      $('foldingInfo').textContent = `Sub-amostragem ativa: o pico aparente de ${fmt(peakF)} Hz reconstrói ${fmt(targetF)} Hz na ${activeZone}ª zona. Candidatos equivalentes por dobramento: ${candList}.`;
    } else {
      $('peakTag').textContent = `pico em ${fmt(peakF)} Hz`;
      $('traceInfo').textContent = `${axis === 'dy' ? 'Vertical' : 'Horizontal'}, no ponto (${fmt(view.probe.x, 0)}, ${fmt(view.probe.y, 0)}). Amplitude de ${fmt(peakAmp, 2)} px a ${fmt(peakF)} Hz, antes do ganho e sem calibração em mm.`;
      $('foldingTag').textContent = `1ª zona (${fmt(peakF)} Hz) · Nyquist ${fmt(fs / 2, 1)} Hz`;
      $('foldingInfo').textContent = `Frequências reais que dobrariam no pico medido de ${fmt(peakF)} Hz (fs = ${fmt(fs)} Hz): ${candList}.`;
    }
  } else {
    view.trace = view.spec = null; $('peakTag').textContent = '–';
    $('traceInfo').textContent = 'Disponível apenas no método de deslocamento.';
    $('foldingTag').textContent = meta.aliasing?.active ? `${activeZone}ª zona de Nyquist` : `1ª zona · Nyquist ${fmt(fs / 2, 1)} Hz`;
    $('foldingInfo').textContent = meta.aliasing?.active
      ? `Sub-amostragem na ${activeZone}ª zona: faixa real ${fmt(meta.requestedLowHz)}–${fmt(meta.requestedHighHz)} Hz dobrada na banda ${fmt(meta.lowHz)}–${fmt(meta.highHz)} Hz.`
      : `Faixa ${fmt(meta.lowHz)}–${fmt(meta.highHz)} Hz na 1ª zona de Nyquist (0–${fmt(fs / 2, 1)} Hz).`;
  }
  $('sliceEnd').textContent = `${fmt(meta.physicalDuration)} s`;
  $('sliceInfo').textContent = `Linha ${view.dir === 'v' ? 'vertical' : 'horizontal'} tracejada nos vídeos, empilhada quadro a quadro ao longo do tempo.`;
  computeSlices();
}

function paintAnalysis() {
  if (!processed || !meta) return;
  if (view.slices) {
    const mark = view.probe ? Math.round(view.dir === 'v' ? view.probe.y - meta.roi.y : view.probe.x - meta.roi.x) : -1;
    VibraAnalysis.paintSlice($('sliceOrig'), view.slices.original, frameIndex, mark);
    VibraAnalysis.paintSlice($('sliceAmp'), view.slices.amplified, frameIndex, mark);
  }
  if (view.trace) {
    const axis = view.axis === 'auto' ? view.trace.dominantAxis : view.axis;
    VibraCharts.line($('trace'), { t: view.trace.t, y: view.trace[axis], head: frameIndex, yUnit: 'px', xUnit: 's' });
    VibraCharts.bars($('spectrum'), { f: view.spec.f, a: view.spec.a, lo: meta.lowHz, hi: meta.highHz, peak: view.spec.peak, yUnit: 'px' });
  } else {
    VibraCharts.empty($('trace'), 'Disponível no método de deslocamento');
    VibraCharts.empty($('spectrum'), 'Disponível no método de deslocamento');
  }
  VibraCharts.folding($('folding'), {
    fs: meta.assumedPhysicalSamplingFps,
    lo: meta.requestedLowHz ?? meta.lowHz,
    hi: meta.requestedHighHz ?? meta.highHz,
    effLo: meta.lowHz,
    effHi: meta.highHz,
    peak: view.spec ? view.spec.f[view.spec.peak] : -1,
    activeZone: meta.aliasing?.zone || 1
  });
}

document.querySelectorAll('.seg__btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-on', b === btn));
  view.dir = btn.dataset.dir;
  if (processed) { computeAnalysis(true); drawFrame(frameIndex); }
}));
$('axis').onchange = () => { view.axis = $('axis').value; if (processed) { computeAnalysis(true); paintAnalysis(); } };
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    syncLabels();
    if (processed) paintAnalysis(); else clearAnalysis();
  }, 120);
});

/* ═══ 9. Exportação ═════════════════════════════════════════════ */
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }

$('report').onclick = () => {
  if (!meta) return;
  download(new Blob([JSON.stringify({ ...meta, probe: view.probe, note: 'Protótipo experimental, sem validação metrológica. FPS informados pelo usuário. A imagem amplificada não é uma medição.' }, null, 2)], { type: 'application/json' }), 'vibra-parametros.json');
};

$('csv').onclick = () => {
  if (!meta || !view.trace) return;
  download(new Blob([VibraAnalysis.csv(meta, view.trace, view.probe)], { type: 'text/csv' }), 'vibra-deslocamento.csv');
  status('CSV salvo: t, dx e dy no ponto, filtrados na faixa, em px da prévia e nativos. Calibre em mm com uma referência no mesmo plano.', 'ok');
};

$('export').onclick = async () => {
  if (!processed) return; stop();
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { status('Este navegador não exporta vídeo. Você ainda pode comparar os quadros e salvar os parâmetros.', 'error'); return; }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { status('Exportação WebM indisponível neste navegador.', 'error'); return; }
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 420;
  const x = canvas.getContext('2d'), chunks = [], stream = canvas.captureStream(Math.min(30, meta.samplingFps)), rec = new MediaRecorder(stream, { mimeType: mime });
  controls(true); $('cancel').hidden = true; $('progress').hidden = true; setResultEnabled(false); VibraUI.busy($('export'), true); showGuides = false;
  const snapshot = meta, results = processed;
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = reject; });
  try {
    status('Gravando a comparação em tempo real. Mantenha a página visível.'); rec.start();
    for (let k = 0; k < snapshot.frames; k++) {
      if (processed !== results) throw Error('O resultado mudou durante a exportação.');
      drawFrame(k);
      x.fillStyle = '#1f2226'; x.fillRect(0, 0, 1024, 420); x.drawImage(original, 0, 36); x.drawImage(result, 512, 36);
      x.font = '500 14px "IBM Plex Sans", system-ui'; x.fillStyle = '#e6e8eb'; x.fillText('ORIGINAL · ' + snapshot.source, 12, 24);
      x.fillStyle = '#9fb5f5'; x.fillText(`AMPLIFICADO · α ${snapshot.requestedGain}× · ${snapshot.lowHz}–${snapshot.highHz} Hz${snapshot.lambdaC ? ' · λc ' + snapshot.lambdaC + ' px' : ''}`, 524, 24);
      x.font = '400 11px "IBM Plex Sans", system-ui'; x.fillStyle = '#9aa1aa'; x.fillText('Vibra · OhmCinética · protótipo experimental, não é medição', 12, 412);
      await new Promise(r => setTimeout(r, 1000 / snapshot.samplingFps));
    }
    rec.stop(); await done; download(new Blob(chunks, { type: mime }), 'vibra-comparacao.webm');
    status('Comparação salva em WebM, sem áudio. A cadência da exportação em tempo real pode variar.', 'ok');
  } catch (err) { if (rec.state !== 'inactive') rec.stop(); status('Não foi possível exportar: ' + err.message, 'error'); }
  finally {
    stream.getTracks().forEach(t => t.stop()); showGuides = true; VibraUI.busy($('export'), false);
    controls(false); setResultEnabled(!!processed); if (processed) drawFrame(frameIndex); available();
  }
};

/* ═══ Inicialização ═════════════════════════════════════════════ */
// Aparelhos de toque usam grade mais leve; computadores, 256 px.
if (window.matchMedia('(pointer:coarse)').matches) $('size').value = '128';
syncMethod(); clearAnalysis(); evaluateSegment(); updateFlow();
