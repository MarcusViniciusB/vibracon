/* Vibra 0.6 — gráficos em canvas, sem dependências.
   Linha temporal (deslocamento), barras (espectro) e mensagens de vazio.
   Cores lidas das variáveis CSS para manter um único design system. */
(function (root) {
  'use strict';

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const palette = () => ({
    grid: '#eef0f3', axis: css('--line-2'), text: css('--muted'), label: css('--muted'),
    data: css('--accent'), band: 'rgba(43,75,163,.07)', peak: css('--ok'), head: css('--marker')
  });
  const fmt = (v, d = 2) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);

  /** Ajusta o buffer ao tamanho exibido × devicePixelRatio e devolve o contexto em px CSS. */
  function setup(canvas) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.round(canvas.clientWidth || canvas.width));
    const h = Math.max(80, Math.round(canvas.clientHeight || canvas.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    return { x, w, h };
  }

  function empty(canvas, message) {
    const { x, w, h } = setup(canvas), c = palette();
    x.fillStyle = c.text; x.font = '400 12.5px "IBM Plex Sans", system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(message, w / 2, h / 2);
  }

  function niceStep(range, ticks) {
    const raw = range / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }

  function frame(x, w, h, pad, xMin, xMax, yMin, yMax, xUnit, yUnit) {
    const c = palette(), X = v => pad.l + (v - xMin) / (xMax - xMin) * (w - pad.l - pad.r),
      Y = v => h - pad.b - (v - yMin) / (yMax - yMin) * (h - pad.t - pad.b);
    x.font = '400 10.5px "IBM Plex Mono", ui-monospace, monospace'; x.lineWidth = 1;
    const ys = niceStep(yMax - yMin, 4);
    x.textAlign = 'right'; x.textBaseline = 'middle';
    for (let v = Math.ceil(yMin / ys) * ys; v <= yMax + 1e-9; v += ys) {
      x.strokeStyle = Math.abs(v) < 1e-9 ? c.axis : c.grid;
      x.beginPath(); x.moveTo(pad.l, Y(v)); x.lineTo(w - pad.r, Y(v)); x.stroke();
      x.fillStyle = c.text; x.fillText(fmt(v, 3), pad.l - 6, Y(v));
    }
    const xs = niceStep(xMax - xMin, Math.max(3, Math.floor((w - pad.l - pad.r) / 80)));
    x.textAlign = 'center'; x.textBaseline = 'top';
    for (let v = Math.ceil(xMin / xs) * xs; v <= xMax + 1e-9; v += xs) {
      x.strokeStyle = c.grid; x.beginPath(); x.moveTo(X(v), pad.t); x.lineTo(X(v), h - pad.b); x.stroke();
      x.fillStyle = c.text; x.fillText(fmt(v, 2), X(v), h - pad.b + 6);
    }
    x.fillStyle = c.label; x.textAlign = 'right'; x.fillText(xUnit, w - pad.r, h - 14);
    x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(yUnit, pad.l + 4, 4);
    return { X, Y };
  }

  /** Série temporal com cursor no quadro atual. */
  function line(canvas, { t, y, head = -1, yUnit = 'px', xUnit = 's' }) {
    const { x, w, h } = setup(canvas), c = palette(), pad = { l: 52, r: 12, t: 22, b: 28 };
    let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
    m = m > 0 ? m * 1.15 : 1;
    const { X, Y } = frame(x, w, h, pad, t[0], t[t.length - 1], -m, m, xUnit, yUnit);
    x.save(); x.beginPath(); x.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); x.clip();
    const g = x.createLinearGradient(0, pad.t, 0, h - pad.b);
    g.addColorStop(0, 'rgba(43,75,163,.10)'); g.addColorStop(.5, 'rgba(43,75,163,0)'); g.addColorStop(1, 'rgba(43,75,163,.10)');
    x.beginPath(); x.moveTo(X(t[0]), Y(0));
    y.forEach((v, i) => x.lineTo(X(t[i]), Y(v)));
    x.lineTo(X(t[t.length - 1]), Y(0)); x.closePath(); x.fillStyle = g; x.fill();
    x.beginPath(); y.forEach((v, i) => i ? x.lineTo(X(t[i]), Y(v)) : x.moveTo(X(t[i]), Y(v)));
    x.strokeStyle = c.data; x.lineWidth = 1.5; x.lineJoin = 'round'; x.stroke();
    if (head >= 0 && head < y.length) {
      x.strokeStyle = c.head; x.lineWidth = 1; x.setLineDash([3, 3]);
      x.beginPath(); x.moveTo(X(t[head]), pad.t); x.lineTo(X(t[head]), h - pad.b); x.stroke(); x.setLineDash([]);
      x.fillStyle = c.head; x.beginPath(); x.arc(X(t[head]), Y(y[head]), 3.5, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }

  /** Espectro de amplitude com faixa de passagem destacada e pico marcado. */
  function bars(canvas, { f, a, lo, hi, peak = -1, yUnit = 'px' }) {
    const { x, w, h } = setup(canvas), c = palette(), pad = { l: 52, r: 12, t: 22, b: 28 };
    let m = 0; for (const v of a) m = Math.max(m, v); m = m > 0 ? m * 1.18 : 1;
    const fMax = f[f.length - 1];
    const { X, Y } = frame(x, w, h, pad, 0, fMax, 0, m, 'Hz', yUnit);
    x.fillStyle = c.band; x.fillRect(X(Math.max(0, lo)), pad.t, X(Math.min(fMax, hi)) - X(Math.max(0, lo)), h - pad.t - pad.b);
    const bw = Math.max(1.5, (w - pad.l - pad.r) / f.length * .62);
    f.forEach((fr, i) => {
      x.fillStyle = i === peak ? c.peak : (fr >= lo && fr <= hi ? c.data : c.axis);
      const top = Y(a[i]); x.fillRect(X(fr) - bw / 2, top, bw, Y(0) - top);
    });
    if (peak >= 0) {
      x.fillStyle = c.peak; x.font = '500 11px "IBM Plex Mono", monospace'; x.textBaseline = 'bottom';
      const px = X(f[peak]); x.textAlign = px > w - 90 ? 'right' : 'left';
      x.fillText(fmt(f[peak], 2) + ' Hz', px + (x.textAlign === 'left' ? 6 : -6), Y(a[peak]) - 2);
    }
  }

  /** Diagrama de dobramento de frequência (Frequency Aliasing Folding Diagram):
      f real (zonas de Nyquist 1…N) × f aparente dobrada em [0, fs/2]. */
  function folding(canvas, { fs, lo, hi, effLo, effHi, peak = -1, activeZone = 1, crossesBoundary = false }) {
    if (!(fs > 0)) return empty(canvas, 'Informe uma taxa de amostragem válida');
    const { x, w, h } = setup(canvas), c = palette(), pad = { l: 48, r: 14, t: 22, b: 28 };
    const nyq = fs / 2, maxTarget = Number.isFinite(hi) && hi > 0 ? hi : nyq;
    const zones = Math.max(4, Math.min(12, Math.ceil(maxTarget / nyq + .05))), fMax = zones * nyq;
    const { X, Y } = frame(x, w, h, pad, 0, fMax, 0, nyq, 'f real (Hz)', 'f apar. (Hz)');

    x.save(); x.beginPath(); x.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); x.clip();
    const plotH = h - pad.t - pad.b, zoneW = (w - pad.l - pad.r) / zones;

    // Zonas de Nyquist: sombreamento alternado, dobras em m·(fs/2) e rótulos Z1, Z2 (-φ)...
    for (let z = 1; z <= zones; z++) {
      const x0 = X((z - 1) * nyq), x1 = X(z * nyq);
      if (z === activeZone && activeZone > 1) {
        x.fillStyle = 'rgba(43,75,163,.08)'; x.fillRect(x0, pad.t, x1 - x0, plotH);
      } else if (z % 2 === 0) {
        x.fillStyle = 'rgba(23,25,28,.025)'; x.fillRect(x0, pad.t, x1 - x0, plotH);
      }
      if (z < zones) {
        x.strokeStyle = c.axis; x.lineWidth = 1; x.setLineDash([3, 3]);
        x.beginPath(); x.moveTo(x1, pad.t); x.lineTo(x1, h - pad.b); x.stroke(); x.setLineDash([]);
      }
      if (zoneW >= 26) {
        x.fillStyle = z === activeZone && activeZone > 1 ? c.data : c.text;
        x.font = (z === activeZone && activeZone > 1 ? '500 ' : '400 ') + '9.5px "IBM Plex Mono", monospace';
        x.textAlign = 'center'; x.textBaseline = 'top';
        const label = zoneW >= 54 && z % 2 === 0 ? `Z${z} (−φ)` : `Z${z}`;
        x.fillText(label, (x0 + x1) / 2, pad.t + 3);
      }
    }

    // Faixa de passagem aparente [effLo, effHi] (horizontal) e faixa solicitada [lo, hi] (vertical).
    if (!crossesBoundary && Number.isFinite(effLo) && Number.isFinite(effHi) && effHi > effLo) {
      const yTop = Y(Math.min(nyq, effHi)), yBot = Y(Math.max(0, effLo));
      x.fillStyle = c.band; x.fillRect(pad.l, yTop, w - pad.l - pad.r, Math.max(1, yBot - yTop));
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      const x0 = X(Math.max(0, lo)), x1 = X(Math.min(fMax, hi));
      x.fillStyle = crossesBoundary ? 'rgba(184,58,46,.14)' : 'rgba(43,75,163,.10)';
      x.fillRect(x0, pad.t, Math.max(1.5, x1 - x0), plotH);
    }

    // Curva em dente de serra / sanfona do dobramento de Nyquist.
    x.beginPath(); x.moveTo(X(0), Y(0));
    for (let z = 1; z <= zones; z++) x.lineTo(X(z * nyq), Y(z % 2 === 1 ? nyq : 0));
    x.strokeStyle = c.data; x.lineWidth = 1.4; x.lineJoin = 'round'; x.stroke();

    // Destaque do segmento correspondente à faixa escolhida sobre a rampa da zona ativa.
    if (!crossesBoundary && Number.isFinite(lo) && Number.isFinite(hi) && Number.isFinite(effLo) && Number.isFinite(effHi)) {
      const yLo = activeZone % 2 === 0 ? effHi : effLo, yHi = activeZone % 2 === 0 ? effLo : effHi;
      x.beginPath(); x.moveTo(X(lo), Y(yLo)); x.lineTo(X(hi), Y(yHi));
      x.strokeStyle = activeZone > 1 ? c.head : c.data; x.lineWidth = 3; x.stroke();
    }

    // Linha horizontal de frequência aparente de referência (pico medido ou centro da banda) e candidatos por zona.
    const refFa = peak > 0 && peak <= nyq ? peak : (!crossesBoundary && Number.isFinite(effLo) && Number.isFinite(effHi) ? (effLo + effHi) / 2 : -1);
    if (refFa > 0 && refFa <= nyq) {
      const yRef = Y(refFa), mainColor = peak > 0 ? c.peak : c.head;
      x.strokeStyle = mainColor; x.lineWidth = 1; x.setLineDash([2, 3]);
      x.beginPath(); x.moveTo(pad.l, yRef); x.lineTo(w - pad.r, yRef); x.stroke(); x.setLineDash([]);

      for (let z = 1; z <= zones; z++) {
        const fCand = z % 2 === 0 ? (z / 2) * fs - refFa : ((z - 1) / 2) * fs + refFa;
        const px = X(fCand), isTarget = z === activeZone;
        x.fillStyle = isTarget ? mainColor : c.data;
        x.beginPath(); x.arc(px, yRef, isTarget ? 3.8 : 2.5, 0, Math.PI * 2); x.fill();
        if (isTarget || (z === 1 && activeZone > 1 && zoneW >= 42)) {
          x.fillStyle = isTarget ? mainColor : c.text;
          x.font = '500 10px "IBM Plex Mono", monospace';
          x.textAlign = px > w - 68 ? 'right' : 'left';
          x.textBaseline = yRef < pad.t + 26 ? 'top' : 'bottom';
          const dy = x.textBaseline === 'top' ? 5 : -5;
          x.fillText(fmt(fCand, 1) + ' Hz', px + (x.textAlign === 'left' ? 5 : -5), yRef + dy);
        }
      }
    }
    x.restore();
  }

  root.VibraCharts = { setup, empty, line, bars, folding, fmt };
})(window);
