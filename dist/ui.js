/* Vibra 0.7 — componentes de interface (apresentação de estado, sem cálculo). */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = (v, d = 2) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(v);

  /* Etapas: vídeo → região → frequência → amplificação */
  const steps = [...document.querySelectorAll('#flow li')];
  function flow(done) {
    const active = steps.findIndex((_, i) => !done[i]);
    steps.forEach((li, i) => { li.dataset.state = done[i] ? 'done' : i === active ? 'active' : 'pending'; });
  }
  steps.forEach(li => li.addEventListener('click', () => {
    const sec = $(li.dataset.target); if (!sec) return;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sec.classList.add('is-focus'); setTimeout(() => sec.classList.remove('is-focus'), 1000);
  }));

  function state(text, tone = 'idle') { const s = $('state'); s.textContent = text; s.dataset.tone = tone; }

  /* Trilha preenchida dos sliders */
  function fill(input) {
    const min = +input.min || 0, max = +input.max || 100;
    input.style.setProperty('--p', (max > min ? (+input.value - min) / (max - min) * 100 : 0) + '%');
  }
  document.querySelectorAll('input[type=range]').forEach(r => { fill(r); r.addEventListener('input', () => fill(r)); });

  /* Faixa de passagem sobre 0…Nyquist e diagrama de dobramento (aliasing) quando necessário */
  function band(lo, hi, fs, frames) {
    const nyq = fs / 2, pass = $('bandPass'), aliasBox = $('aliasBox');
    const fold = root.VibraAnalysis ? root.VibraAnalysis.foldBand(lo, hi, fs) : { ok: lo > 0 && lo < hi && hi < nyq, aliased: false, effectiveLo: lo, effectiveHi: hi };
    const effLo = fold.ok ? fold.effectiveLo : lo, effHi = fold.ok ? fold.effectiveHi : hi;
    const L = Math.max(0, Math.min(1, effLo / nyq)), H = Math.max(0, Math.min(1, effHi / nyq));
    pass.style.left = L * 100 + '%'; pass.style.width = Math.max(1, (H - L) * 100) + '%';
    pass.classList.toggle('is-bad', !fold.ok);
    pass.classList.toggle('is-alias', !!(fold.ok && fold.aliased));
    $('bandNyq').textContent = fmt(nyq, 1) + ' Hz';

    if (fold.ok && !fold.aliased) {
      $('bandHint').textContent = `Resolução de ${fmt(fs / frames)} Hz com ${frames} quadros. Prefira uma faixa estreita em torno da frequência de operação.`;
      if (aliasBox) aliasBox.hidden = true;
    } else if (fold.ok && fold.aliased) {
      $('bandHint').textContent = `Sub-amostragem (${fold.zone}ª zona de Nyquist${fold.phaseInverted ? ', fase aparente invertida' : ''}): a faixa real ${fmt(lo)}–${fmt(hi)} Hz dobra para ${fmt(fold.effectiveLo)}–${fmt(fold.effectiveHi)} Hz. Resolução de ${fmt(fs / frames)} Hz.`;
      if (aliasBox) {
        aliasBox.hidden = false; aliasBox.dataset.tone = 'warn';
        $('aliasZoneTag').textContent = `${fold.zone}ª zona${fold.phaseInverted ? ' · −φ' : ''}`;
        $('aliasPreviewNote').textContent = `f_aparente = |f − k·fs| na ${fold.zone}ª zona (${fmt((fold.zone - 1) * nyq, 1)}–${fmt(fold.zone * nyq, 1)} Hz). O filtro opera na banda dobrada ${fmt(fold.effectiveLo)}–${fmt(fold.effectiveHi)} Hz.`;
        if (root.VibraCharts?.folding) root.VibraCharts.folding($('foldingPreview'), { fs, lo, hi, effLo: fold.effectiveLo, effHi: fold.effectiveHi, activeZone: fold.zone });
      }
    } else {
      $('bandHint').textContent = fold.reason || 'Faixa inválida: o início deve ser menor que o fim, e o fim menor que metade da taxa de amostragem.';
      if (aliasBox) {
        if (fold.crossesBoundary) {
          aliasBox.hidden = false; aliasBox.dataset.tone = 'error';
          $('aliasZoneTag').textContent = `dobra em ${fmt(fold.boundaryHz, 1)} Hz`;
          $('aliasPreviewNote').textContent = `A faixa cruza um múltiplo de Nyquist (${fmt(fold.boundaryHz, 1)} Hz), onde o espectro reflete. Escolha limites contidos numa única zona.`;
          if (root.VibraCharts?.folding) root.VibraCharts.folding($('foldingPreview'), { fs, lo, hi, activeZone: fold.zone || 2, crossesBoundary: true });
        } else {
          aliasBox.hidden = true;
        }
      }
    }
  }

  /* Progresso do processamento sobre o quadro amplificado */
  const proc = (() => {
    const box = $('proc'), stage = $('procStage'), fillBar = $('procFill'), pct = $('procPct'), clock = $('procClock');
    let labels = {}, timer = 0, t0 = 0;
    const base = { read: 'Lendo quadros', track: 'Estimando o movimento', filter: 'Filtrando a faixa', render: 'Montando o resultado' };
    function show(custom = {}) {
      labels = { ...base, ...custom }; t0 = performance.now(); clearInterval(timer);
      timer = setInterval(() => { clock.textContent = fmt((performance.now() - t0) / 1000, 1) + ' s'; }, 100);
      box.hidden = false; update(0, 'read');
    }
    function update(p, key) {
      p = Math.max(0, Math.min(1, p));
      fillBar.style.width = p * 100 + '%'; pct.textContent = Math.round(p * 100);
      if (key && labels[key]) stage.textContent = labels[key];
    }
    function hide() { clearInterval(timer); box.hidden = true; }
    return { show, update, hide };
  })();

  function busy(btn, on) { btn.classList.toggle('is-busy', on); btn.setAttribute('aria-busy', String(on)); }

  root.VibraUI = { flow, state, fill, band, proc, busy, fmt };
})(window);
