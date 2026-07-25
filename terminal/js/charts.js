/* =============================================================================
 * charts.js — dependency-free canvas charting.
 * Line / area / candlestick / OHLC price charts with volume, axes, crosshair
 * and tooltip; sparklines; horizontal + vertical bars; yield curves; and a
 * squarified DOM treemap for the sector heat map.
 * All colours read from CSS custom properties so charts follow the theme.
 * ========================================================================== */

(function () {
  'use strict';

  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
  const css = (el, name, fallback) =>
    (getComputedStyle(el).getPropertyValue(name) || '').trim() || fallback;

  function palette(el) {
    return {
      up: css(el, '--up', '#00a862'),
      down: css(el, '--down', '#e2483d'),
      line: css(el, '--chart-line', '#2f6fd0'),
      grid: css(el, '--chart-grid', 'rgba(128,128,128,.18)'),
      axis: css(el, '--chart-axis', 'rgba(128,128,128,.55)'),
      text: css(el, '--chart-text', '#8a8f98'),
      fillTop: css(el, '--chart-fill-top', 'rgba(47,111,208,.28)'),
      fillBottom: css(el, '--chart-fill-bottom', 'rgba(47,111,208,0)'),
      crosshair: css(el, '--chart-cross', 'rgba(128,128,128,.7)'),
      bg: css(el, '--chart-bg', 'transparent')
    };
  }

  const fmtNum = (v, d) => {
    if (v == null || !isFinite(v)) return '—';
    return (+v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtAbbr = (v) => {
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  };

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(min / step) * step;
    const out = [];
    for (let v = start; v <= max + step * 0.001; v += step) out.push(+v.toFixed(10));
    return out;
  }

  /* ==========================================================================
   * PriceChart
   * ======================================================================== */
  class PriceChart {
    constructor(canvas, opts) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.o = Object.assign({
        type: 'area',           // 'area' | 'line' | 'candle' | 'ohlc'
        volume: true,
        decimals: 2,
        padding: { t: 12, r: 62, b: 22, l: 8 },
        volumeRatio: 0.2,
        baseline: null,         // draw a dashed reference line (prev close)
        crosshair: true,
        timeFormat: 'auto',
        onHover: null
      }, opts || {});
      this.bars = [];
      this.hoverIdx = null;
      this._bind();
      this._observe();
    }

    setData(bars) { this.bars = bars || []; this.draw(); return this; }
    setType(t) { this.o.type = t; this.draw(); return this; }
    setBaseline(v) { this.o.baseline = v; this.draw(); return this; }

    _observe() {
      this._ro = new ResizeObserver(() => this.draw());
      this._ro.observe(this.c.parentElement || this.c);
      this._mq = window.matchMedia('(prefers-color-scheme: dark)');
      this._mqh = () => this.draw();
      this._mq.addEventListener('change', this._mqh);
    }

    _bind() {
      if (!this.o.crosshair) return;
      const move = (ev) => {
        const r = this.c.getBoundingClientRect();
        const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        const y = (ev.touches ? ev.touches[0].clientY : ev.clientY) - r.top;
        this.mouse = { x, y };
        this.hoverIdx = this._indexAt(x, r.width);
        this.draw();
        if (this.o.onHover) this.o.onHover(this.bars[this.hoverIdx] || null, this.hoverIdx);
      };
      const leave = () => {
        this.mouse = null; this.hoverIdx = null; this.draw();
        if (this.o.onHover) this.o.onHover(null, null);
      };
      this.c.addEventListener('mousemove', move);
      this.c.addEventListener('mouseleave', leave);
      this.c.addEventListener('touchmove', move, { passive: true });
      this.c.addEventListener('touchend', leave);
    }

    _indexAt(x, w) {
      const p = this.o.padding;
      const plotW = w - p.l - p.r;
      const i = Math.round(((x - p.l) / plotW) * (this.bars.length - 1));
      return Math.max(0, Math.min(this.bars.length - 1, i));
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._mq) this._mq.removeEventListener('change', this._mqh);
    }

    draw() {
      const c = this.c, ctx = this.ctx, bars = this.bars;
      const parent = c.parentElement || c;
      const w = parent.clientWidth || c.clientWidth || 600;
      const h = parent.clientHeight || c.clientHeight || 260;
      const dpr = DPR();
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = w + 'px'; c.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!bars.length) return;

      const P = palette(c);
      const p = this.o.padding;
      const volH = this.o.volume ? (h - p.t - p.b) * this.o.volumeRatio : 0;
      const plotW = w - p.l - p.r;
      const plotH = h - p.t - p.b - volH;

      let lo = Infinity, hi = -Infinity;
      bars.forEach(b => {
        lo = Math.min(lo, this.o.type === 'candle' || this.o.type === 'ohlc' ? b.l : b.c);
        hi = Math.max(hi, this.o.type === 'candle' || this.o.type === 'ohlc' ? b.h : b.c);
      });
      if (this.o.baseline != null) { lo = Math.min(lo, this.o.baseline); hi = Math.max(hi, this.o.baseline); }
      const pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
      lo -= pad; hi += pad;

      const X = (i) => p.l + (i / Math.max(1, bars.length - 1)) * plotW;
      const Y = (v) => p.t + plotH - ((v - lo) / (hi - lo)) * plotH;

      /* grid + price axis */
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      const ticks = niceTicks(lo, hi, 5);
      ticks.forEach(t => {
        const y = Y(t);
        ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.l, Math.round(y) + .5); ctx.lineTo(p.l + plotW, Math.round(y) + .5); ctx.stroke();
        ctx.fillStyle = P.text; ctx.textAlign = 'left';
        ctx.fillText(fmtNum(t, this.o.decimals), p.l + plotW + 6, y);
      });

      /* time axis */
      const labels = this._timeLabels(bars, plotW);
      labels.forEach(({ i, label }, k) => {
        const x = X(i);
        ctx.strokeStyle = P.grid;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, p.t); ctx.lineTo(Math.round(x) + .5, p.t + plotH); ctx.stroke();
        ctx.fillStyle = P.text;
        // Keep the first and last labels inside the plot instead of clipping.
        ctx.textAlign = k === 0 ? 'left' : k === labels.length - 1 ? 'right' : 'center';
        ctx.fillText(label, x, h - p.b / 2);
      });
      ctx.textAlign = 'center';

      /* baseline (previous close) */
      if (this.o.baseline != null) {
        ctx.save();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = P.axis; ctx.lineWidth = 1;
        const y = Math.round(Y(this.o.baseline)) + .5;
        ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + plotW, y); ctx.stroke();
        ctx.restore();
      }

      // Colour against the reference line when there is one (a 1D chart is red
      // if it is below the previous close, regardless of where the session began).
      const rising = this.o.baseline != null
        ? bars[bars.length - 1].c >= this.o.baseline
        : bars[bars.length - 1].c >= bars[0].c;
      const seriesColor = this.o.color || (this.o.type === 'area' || this.o.type === 'line'
        ? (rising ? P.up : P.down) : P.line);

      /* volume */
      if (this.o.volume) {
        const maxV = Math.max(...bars.map(b => b.v || 0)) || 1;
        const bw = Math.max(1, plotW / bars.length * 0.6);
        bars.forEach((b, i) => {
          const bh = ((b.v || 0) / maxV) * (volH - 6);
          ctx.fillStyle = (b.c >= b.o ? P.up : P.down);
          ctx.globalAlpha = 0.28;
          ctx.fillRect(X(i) - bw / 2, p.t + plotH + volH - bh, bw, bh);
        });
        ctx.globalAlpha = 1;
      }

      /* series */
      if (this.o.type === 'candle' || this.o.type === 'ohlc') {
        const bw = Math.max(1.5, (plotW / bars.length) * 0.62);
        bars.forEach((b, i) => {
          const x = X(i), up = b.c >= b.o;
          ctx.strokeStyle = ctx.fillStyle = up ? P.up : P.down;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, Y(b.h)); ctx.lineTo(Math.round(x) + .5, Y(b.l)); ctx.stroke();
          if (this.o.type === 'candle') {
            const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
            ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
          } else {
            ctx.beginPath();
            ctx.moveTo(x - bw / 2, Y(b.o)); ctx.lineTo(x, Y(b.o));
            ctx.moveTo(x, Y(b.c)); ctx.lineTo(x + bw / 2, Y(b.c));
            ctx.stroke();
          }
        });
      } else {
        if (this.o.type === 'area') {
          const g = ctx.createLinearGradient(0, p.t, 0, p.t + plotH);
          g.addColorStop(0, hexA(seriesColor, .30)); g.addColorStop(1, hexA(seriesColor, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(X(0), p.t + plotH);
          bars.forEach((b, i) => ctx.lineTo(X(i), Y(b.c)));
          ctx.lineTo(X(bars.length - 1), p.t + plotH); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = seriesColor; ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        bars.forEach((b, i) => i ? ctx.lineTo(X(i), Y(b.c)) : ctx.moveTo(X(i), Y(b.c)));
        ctx.stroke();
      }

      /* last price tag */
      const lastY = Y(bars[bars.length - 1].c);
      ctx.fillStyle = seriesColor;
      ctx.fillRect(p.l + plotW + 2, lastY - 8, p.r - 4, 16);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(fmtNum(bars[bars.length - 1].c, this.o.decimals), p.l + plotW + 6, lastY);

      /* crosshair */
      if (this.hoverIdx != null && this.mouse) {
        const b = bars[this.hoverIdx];
        const x = X(this.hoverIdx), y = Y(b.c);
        ctx.save();
        ctx.setLineDash([3, 3]); ctx.strokeStyle = P.crosshair; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, p.t); ctx.lineTo(Math.round(x) + .5, p.t + plotH + volH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.l, Math.round(y) + .5); ctx.lineTo(p.l + plotW, Math.round(y) + .5); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = P.axis;
        ctx.fillRect(p.l + plotW + 2, y - 8, p.r - 4, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.fillText(fmtNum(b.c, this.o.decimals), p.l + plotW + 6, y);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = seriesColor; ctx.fill();
      }
    }

    _timeLabels(bars, plotW) {
      const span = bars[bars.length - 1].t - bars[0].t;
      const count = Math.max(2, Math.min(7, Math.floor(plotW / 90)));
      const out = [];
      for (let k = 0; k < count; k++) {
        const i = Math.round((k / (count - 1)) * (bars.length - 1));
        const d = new Date(bars[i].t);
        let label;
        if (span < 2 * 864e5) label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        else if (span < 400 * 864e5) label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        else label = d.toLocaleDateString([], { month: 'short', year: '2-digit' });
        out.push({ i, label });
      }
      return out;
    }
  }

  function hexA(color, alpha) {
    if (color.startsWith('#')) {
      const h = color.slice(1);
      const n = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
      const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    if (color.startsWith('rgb')) return color.replace(/rgba?\(([^)]+)\)/, (m, inner) => {
      const parts = inner.split(',').slice(0, 3).map(s => s.trim());
      return `rgba(${parts.join(',')},${alpha})`;
    });
    return color;
  }

  /* ==========================================================================
   * Sparkline
   * ======================================================================== */
  function spark(canvas, values, opts) {
    const o = Object.assign({ color: null, fill: true, width: 1.4 }, opts || {});
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement || canvas;
    const w = o.w || canvas.clientWidth || parent.clientWidth || 80;
    const h = o.h || canvas.clientHeight || 24;
    const dpr = DPR();
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!values || values.length < 2) return;
    const P = palette(canvas);
    const lo = Math.min(...values), hi = Math.max(...values);
    const color = o.color || (values[values.length - 1] >= values[0] ? P.up : P.down);
    const X = i => (i / (values.length - 1)) * (w - 2) + 1;
    const Y = v => h - 2 - ((v - lo) / ((hi - lo) || 1)) * (h - 4);
    if (o.fill) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hexA(color, .35)); g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(X(0), h);
      values.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
      ctx.lineTo(X(values.length - 1), h); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = color; ctx.lineWidth = o.width; ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.stroke();
  }

  /* ==========================================================================
   * Bar chart (vertical, signed) — used for financials and % change lists
   * ======================================================================== */
  function bars(canvas, items, opts) {
    const o = Object.assign({ decimals: 1, suffix: '', signed: true, labels: true }, opts || {});
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement || canvas;
    const w = parent.clientWidth || 400, h = parent.clientHeight || 180;
    const dpr = DPR();
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!items.length) return;
    const P = palette(canvas);
    const pad = { t: 14, r: 8, b: 22, l: 8 };
    const vals = items.map(i => i.v);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = (hi - lo) || 1;
    const plotH = h - pad.t - pad.b, plotW = w - pad.l - pad.r;
    const zeroY = pad.t + plotH * (hi / span);
    const bw = plotW / items.length * 0.62;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    items.forEach((it, i) => {
      const x = pad.l + (i + 0.5) * (plotW / items.length);
      const y = pad.t + plotH * ((hi - it.v) / span);
      const col = it.color || (o.signed ? (it.v >= 0 ? P.up : P.down) : P.line);
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, Math.min(y, zeroY), bw, Math.max(1, Math.abs(zeroY - y)));
      if (o.labels) {
        ctx.fillStyle = P.text;
        ctx.textBaseline = 'top';
        ctx.fillText(it.label, x, h - pad.b + 5);
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmtNum(it.v, o.decimals) + o.suffix, x, (it.v >= 0 ? y : zeroY) - 2);
      }
    });
    ctx.strokeStyle = P.axis;
    ctx.beginPath(); ctx.moveTo(pad.l, Math.round(zeroY) + .5); ctx.lineTo(w - pad.r, Math.round(zeroY) + .5); ctx.stroke();
  }

  /* ==========================================================================
   * Yield curve
   * ======================================================================== */
  function curve(canvas, points, opts) {
    const o = Object.assign({ decimals: 2, suffix: '%' }, opts || {});
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement || canvas;
    const w = parent.clientWidth || 420, h = parent.clientHeight || 200;
    const dpr = DPR();
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const P = palette(canvas);
    const pad = { t: 12, r: 40, b: 22, l: 10 };
    const ys = points.map(p => p.y);
    const lo = Math.min(...ys) - 0.15, hi = Math.max(...ys) + 0.15;
    const X = i => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
    const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
    niceTicks(lo, hi, 4).forEach(t => {
      const y = Y(t);
      ctx.strokeStyle = P.grid;
      ctx.beginPath(); ctx.moveTo(pad.l, Math.round(y) + .5); ctx.lineTo(w - pad.r, Math.round(y) + .5); ctx.stroke();
      ctx.fillStyle = P.text; ctx.textAlign = 'left';
      ctx.fillText(t.toFixed(o.decimals) + o.suffix, w - pad.r + 5, y);
    });
    const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    g.addColorStop(0, hexA(P.line, .28)); g.addColorStop(1, hexA(P.line, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(X(0), h - pad.b);
    points.forEach((p, i) => ctx.lineTo(X(i), Y(p.y)));
    ctx.lineTo(X(points.length - 1), h - pad.b); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.line; ctx.lineWidth = 1.8;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.y)) : ctx.moveTo(X(i), Y(p.y)));
    ctx.stroke();
    ctx.fillStyle = P.line;
    points.forEach((p, i) => { ctx.beginPath(); ctx.arc(X(i), Y(p.y), 2.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = P.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    points.forEach((p, i) => { if (i % 2 === 0 || points.length < 8) ctx.fillText(p.t, X(i), h - pad.b + 6); });
  }

  /* ==========================================================================
   * Treemap heat map (DOM, squarified) — sectors then constituents
   * ======================================================================== */
  function treemap(el, items, opts) {
    const o = Object.assign({ scale: 2.5, onClick: null, label: i => i.label }, opts || {});
    const W = el.clientWidth, H = el.clientHeight;
    el.innerHTML = '';
    if (!W || !H || !items.length) return;
    const total = items.reduce((s, i) => s + Math.max(i.weight, 1e-9), 0);
    const rects = squarify(items.map(i => ({ ...i, area: (Math.max(i.weight, 1e-9) / total) * W * H })), { x: 0, y: 0, w: W, h: H });
    rects.forEach(r => {
      const d = document.createElement('div');
      d.className = 'hm-cell';
      d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${Math.max(0, r.w - 2)}px;height:${Math.max(0, r.h - 2)}px;background:${heatColor(r.item.pct, o.scale)}`;
      const small = r.w < 74 || r.h < 40;
      d.innerHTML = small
        ? `<span class="hm-sym">${escapeHtml(r.item.label)}</span>`
        : `<span class="hm-sym">${escapeHtml(r.item.label)}</span><span class="hm-pct">${r.item.pct >= 0 ? '+' : ''}${r.item.pct.toFixed(2)}%</span>`;
      d.title = `${r.item.title || r.item.label}  ${r.item.pct >= 0 ? '+' : ''}${r.item.pct.toFixed(2)}%`;
      if (o.onClick) d.addEventListener('click', () => o.onClick(r.item));
      el.appendChild(d);
    });
  }

  function squarify(items, rect) {
    const out = [];
    let list = items.slice().sort((a, b) => b.area - a.area);
    let r = { ...rect };
    while (list.length) {
      const row = [];
      let best = Infinity;
      while (list.length) {
        const cand = row.concat([list[0]]);
        const w = Math.min(r.w, r.h);
        const ratio = worst(cand, w);
        if (ratio > best) break;
        best = ratio; row.push(list.shift());
      }
      const sum = row.reduce((s, i) => s + i.area, 0);
      const horizontal = r.w >= r.h;
      const thickness = sum / (horizontal ? r.h : r.w);
      let off = 0;
      row.forEach(it => {
        const len = it.area / thickness;
        out.push(horizontal
          ? { x: r.x, y: r.y + off, w: thickness, h: len, item: it }
          : { x: r.x + off, y: r.y, w: len, h: thickness, item: it });
        off += len;
      });
      if (horizontal) { r.x += thickness; r.w -= thickness; }
      else { r.y += thickness; r.h -= thickness; }
      if (r.w < 1 || r.h < 1) break;
    }
    return out;
  }
  function worst(row, w) {
    const sum = row.reduce((s, i) => s + i.area, 0);
    const max = Math.max(...row.map(i => i.area)), min = Math.min(...row.map(i => i.area));
    const w2 = w * w, s2 = sum * sum;
    return Math.max((w2 * max) / s2, s2 / (w2 * min));
  }

  function heatColor(pct, scale) {
    const t = Math.max(-1, Math.min(1, pct / (scale || 2.5)));
    if (Math.abs(t) < 0.008) return 'var(--hm-flat)';
    const mag = Math.abs(t);
    const l = 22 + mag * 20;
    return t > 0 ? `hsl(150 62% ${l}%)` : `hsl(4 66% ${l}%)`;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.Charts = {
    PriceChart, spark, bars, curve, treemap, heatColor,
    fmtNum, fmtAbbr, niceTicks, palette
  };
})();
