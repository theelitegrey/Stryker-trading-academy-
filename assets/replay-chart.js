/**
 * Stryker Trading Academy — Replay chart on TradingView Lightweight Charts
 *
 * Wraps lightweight-charts v5 (window.LightweightCharts, Apache-2.0) with
 * everything the backtester needs on top of the stock candlestick chart:
 *   - a replay-safe data feed: only the Series view (complete candles plus the
 *     forming one) is ever handed to the chart, updated incrementally
 *   - order lines (entry, stop, target, pending) as native price lines with a
 *     drag layer so stops and targets move by dragging
 *   - entry / exit markers, an OHLC + indicator legend, a trading-strip slot
 *   - indicators from replay-indicators.js: overlays on the main pane,
 *     oscillators in their own panes, ICT boxes / levels / markers on an
 *     overlay canvas
 *   - drawing tools on the same overlay (trend, ray, horizontal, rectangle,
 *     Fibonacci, measure), stored in { t, price } so they survive timeframe
 *     changes
 *   - session shading (New York / London), display timezone, dark and light
 *
 * Time handling: Lightweight Charts formats timestamps in UTC only, so bar
 * times are shifted by the display timezone's offset before they are handed
 * to the chart. Indices, not times, are used for every calculation, so the
 * shift is purely cosmetic. Logical index i on the chart == index i in the
 * view, which is what makes the overlay math simple.
 */
(function (root) {
  'use strict';
  const RT = root.ReplayTime, IND = root.ReplayIndicators;

  const THEMES = {
    dark: { bg: '#0b0b0d', grid: 'rgba(255,255,255,0.05)', text: '#8b93a0', border: 'rgba(255,255,255,0.10)', up: '#03c988', down: '#e5484d', volUp: 'rgba(3,201,136,0.35)', volDown: 'rgba(229,72,77,0.35)', cross: 'rgba(255,255,255,0.35)', tag: '#131316', legend: '#c9cdd3', sel: '#f5c542', draw: '#4fe3ac' },
    light: { bg: '#ffffff', grid: 'rgba(0,0,0,0.06)', text: '#5c6472', border: 'rgba(0,0,0,0.12)', up: '#059669', down: '#dc2626', volUp: 'rgba(5,150,105,0.3)', volDown: 'rgba(220,38,38,0.3)', cross: 'rgba(0,0,0,0.35)', tag: '#f3f4f6', legend: '#222', sel: '#b8901f', draw: '#0f766e' }
  };
  const SESSIONS = { ny: { tz: 'America/New_York', from: 9 * 60 + 30, to: 16 * 60, color: 'rgba(3,201,136,0.05)' }, ldn: { tz: 'Europe/London', from: 8 * 60, to: 16 * 60 + 30, color: 'rgba(0,173,181,0.05)' } };
  const SHAPE_WINDOW = 4000;   // ICT shape indicators only look at the last N bars per recompute

  class ReplayChart {
    constructor(container, opts) {
      const LW = root.LightweightCharts; if (!LW) throw new Error('Lightweight Charts did not load');
      this.LW = LW; this.el = container; this.el.classList.add('rp-chartwrap');
      this.opts = Object.assign({ tz: 'America/New_York', decimals: 2, tick: 0.01, symbol: '', theme: 'dark', sessions: { ny: true, ldn: false } }, opts || {});
      this.el.innerHTML = '<div class="rp-lwc"></div><canvas class="rp-overlay"></canvas><div class="rp-legend"></div><div class="rp-strip"></div><div class="rp-indlegend"></div>';
      this.chartEl = this.el.querySelector('.rp-lwc'); this.ov = this.el.querySelector('.rp-overlay'); this.legendEl = this.el.querySelector('.rp-legend'); this.stripEl = this.el.querySelector('.rp-strip'); this.indLegendEl = this.el.querySelector('.rp-indlegend');
      const T = THEMES[this.opts.theme] || THEMES.dark; this.T = T;
      this.chart = LW.createChart(this.chartEl, this._chartOptions(T));
      this.candles = this.chart.addSeries(LW.CandlestickSeries, { upColor: T.up, downColor: T.down, borderVisible: false, wickUpColor: T.up, wickDownColor: T.down, priceFormat: { type: 'price', precision: this.opts.decimals, minMove: this.opts.tick || Math.pow(10, -this.opts.decimals) }, priceLineVisible: true, lastValueVisible: true });
      this.volume = this.chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.markersApi = LW.createSeriesMarkers(this.candles, []);
      this.view = null; this.n = 0; this.times = []; this.data = []; this.lastTf = null;
      this.lines = []; this.priceLines = new Map(); this.markers = [];
      this.drawings = []; this.tool = 'none'; this.pendingPts = []; this.selected = null; this.hoverLine = null; this.drag = null; this.mouse = null;
      this.indicators = []; this.indSeq = 1; this.shapes = [];
      this.onLineDrag = null; this.onDrawingsChange = null; this.onSelect = null; this.onIndicatorAction = null; this.onCrosshair = null;
      this._raf = 0; this._indTimer = 0;
      this._bind(); this.resize();
      if (root.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.el); }
      this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.request());
      this.chart.subscribeCrosshairMove((p) => this._onCross(p));
    }
    _chartOptions(T) {
      return { layout: { background: { type: 'solid', color: T.bg }, textColor: T.text, fontFamily: "'JetBrains Mono', 'Archivo', monospace", fontSize: 11, panes: { separatorColor: T.border, separatorHoverColor: 'rgba(3,201,136,0.3)', enableResize: true }, attributionLogo: true },
        grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
        crosshair: { mode: 0, vertLine: { color: T.cross, labelBackgroundColor: T.tag, style: 3 }, horzLine: { color: T.cross, labelBackgroundColor: T.tag, style: 3 } },
        rightPriceScale: { borderColor: T.border, scaleMargins: { top: 0.08, bottom: 0.2 } },
        timeScale: { borderColor: T.border, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 8, minBarSpacing: 0.5, shiftVisibleRangeOnNewBar: true, rightBarStaysOnScroll: true },
        localization: { locale: 'en-US', timeFormatter: (t) => this._fmtTime(t, true), priceFormatter: (p) => this.fmt(p) },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        autoSize: false };
    }
    destroy() { if (this._ro) this._ro.disconnect(); clearTimeout(this._indTimer); root.removeEventListener('mousemove', this._winMove); root.removeEventListener('mouseup', this._winUp); this.chart.remove(); this.el.innerHTML = ''; this.el.classList.remove('rp-chartwrap'); }

    // ---- time <-> chart -------------------------------------------------------------
    _offset(t) { const h = Math.floor(t / 3600000) * 3600000; const k = this.opts.tz + '|' + h; if (this._offCache && this._offCache.k === k) return this._offCache.v; const v = RT.offsetMs(this.opts.tz, h); this._offCache = { k, v }; return v; }
    _chartTime(t, prev) { let s = Math.floor((t + this._offset(t)) / 1000); if (prev != null && s <= prev) s = prev + 1; return s; }
    _fmtTime(t, withDate) { const d = new Date(t * 1000); const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()], mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; const hm = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); return withDate ? wd + ' ' + d.getUTCDate() + ' ' + mon + (this.view && this.view.tfMs >= 86400000 ? ' ' + d.getUTCFullYear() : ' ' + hm) : hm; }
    bar(i) { return i >= 0 && i < this.n ? this.data[i] : null; }
    indexOfT(t) { const b = this.data; if (!b.length) return 0; if (t < b[0].t) return (t - b[0].t) / this.view.tfMs; let lo = 0, hi = b.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid].t <= t) lo = mid; else hi = mid - 1; } return lo + (t - b[lo].t) / this.view.tfMs; }
    tOfIndex(i) { const k = Math.max(0, Math.min(this.n - 1, Math.floor(i))); const b = this.data[k]; return b ? b.t + (i - k) * this.view.tfMs : 0; }
    xOf(i) { const x = this.chart.timeScale().logicalToCoordinate(i); return x == null ? NaN : x; }
    iOf(x) { const l = this.chart.timeScale().coordinateToLogical(x); return l == null ? NaN : l; }
    yOf(p) { const y = this.candles.priceToCoordinate(p); return y == null ? NaN : y; }
    pOf(y) { const p = this.candles.coordinateToPrice(y); return p == null ? NaN : p; }
    paneRect() { const s = this.chart.paneSize(0); return { x: 0, y: 0, w: s.width, h: s.height }; }
    snap(p) { const t = this.opts.tick; return t ? Math.round(p / t) * t : p; }
    fmt(p) { return Number(p).toFixed(this.opts.decimals); }

    // ---- data -------------------------------------------------------------------------
    setView(view) {
      const n = view.n; const prevN = this.n; const sameTf = this.lastTf === view.tf && this.view && this.data.length && this.data[0].t === view.bars[0].t;
      const full = !sameTf || n < prevN || n - prevN > 2;
      if (full) {
        this.data = view.bars.slice(0, n - 1); this.data.push(view.last); this.times = new Array(n);
        let prev = null; for (let i = 0; i < n; i++) { prev = this._chartTime(this.data[i].t, prev); this.times[i] = prev; }
        this.candles.setData(this.data.map((b, i) => ({ time: this.times[i], open: b.o, high: b.h, low: b.l, close: b.c })));
        this.volume.setData(this.data.map((b, i) => ({ time: this.times[i], value: b.v || 0, color: b.c >= b.o ? this.T.volUp : this.T.volDown })));
      } else {
        for (let i = Math.max(0, prevN - 1); i < n; i++) {
          const b = i < n - 1 ? view.bars[i] : view.last; this.data[i] = b;
          if (i >= this.times.length) this.times[i] = this._chartTime(b.t, this.times[i - 1]);
          this.candles.update({ time: this.times[i], open: b.o, high: b.h, low: b.l, close: b.c });
          this.volume.update({ time: this.times[i], value: b.v || 0, color: b.c >= b.o ? this.T.volUp : this.T.volDown });
        }
        this.data.length = n;
      }
      this.view = view; this.n = n; this.lastTf = view.tf;
      if (full) { this._resetPriceLines(); this._applyMarkers(); this.chart.timeScale().scrollToRealTime(); }
      this._scheduleIndicators(full ? 0 : 120);
      this._legend(); this.request();
    }
    scrollToEnd() { this.chart.timeScale().scrollToRealTime(); }
    zoom(f) { const ts = this.chart.timeScale(); const r = ts.getVisibleLogicalRange(); if (!r) return; const w = (r.to - r.from) / f; ts.setVisibleLogicalRange({ from: r.to - w, to: r.to }); }
    setOptions(o) {
      const themeChanged = o.theme && o.theme !== this.opts.theme; const tzChanged = o.tz && o.tz !== this.opts.tz;
      Object.assign(this.opts, o); if (o.sessions) this.opts.sessions = Object.assign({}, this.opts.sessions, o.sessions);
      if (themeChanged) { const T = THEMES[this.opts.theme] || THEMES.dark; this.T = T; this.chart.applyOptions(this._chartOptions(T)); this.candles.applyOptions({ upColor: T.up, downColor: T.down, wickUpColor: T.up, wickDownColor: T.down }); }
      if (tzChanged && this.view) { this._offCache = null; this.lastTf = null; this.setView(this.view); }
      this.request();
    }
    resize() { const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.chart.resize(w, h); const d = root.devicePixelRatio || 1; this.ov.width = Math.round(w * d); this.ov.height = Math.round(h * d); this.ov.style.width = w + 'px'; this.ov.style.height = h + 'px'; this.request(); }

    // ---- order lines --------------------------------------------------------------------
    setLines(lines) {
      this.lines = lines || []; const seen = new Set();
      for (const l of this.lines) {
        seen.add(l.id); let pl = this.priceLines.get(l.id);
        const o = { price: l.price, color: l.color, lineWidth: l.width || 1, lineStyle: l.dash ? 2 : 0, axisLabelVisible: l.axis !== false, title: l.label || '', lineVisible: true };
        if (!pl) { pl = this.candles.createPriceLine(o); this.priceLines.set(l.id, pl); } else if (!(this.drag && this.drag.line.id === l.id)) pl.applyOptions(o);
      }
      for (const [id, pl] of this.priceLines) if (!seen.has(id)) { this.candles.removePriceLine(pl); this.priceLines.delete(id); }
    }
    _resetPriceLines() { for (const [, pl] of this.priceLines) this.candles.removePriceLine(pl); this.priceLines.clear(); const l = this.lines; this.lines = []; this.setLines(l); }
    setMarkers(markers) { this.markers = markers || []; this._applyMarkers(); }
    _applyMarkers() {
      if (!this.n) return; const out = [];
      for (const m of this.markers) { const i = Math.round(this.indexOfT(m.t)); if (i < 0 || i >= this.n) continue; out.push({ time: this.times[i], position: m.kind === 'exit' ? (m.side === 'buy' ? 'aboveBar' : 'belowBar') : (m.side === 'buy' ? 'belowBar' : 'aboveBar'), shape: m.kind === 'exit' ? 'square' : (m.side === 'buy' ? 'arrowUp' : 'arrowDown'), color: m.color || (m.side === 'buy' ? this.T.up : this.T.down), text: m.label || '', size: m.kind === 'exit' ? 1 : 1.4 }); }
      out.sort((a, b) => a.time - b.time); this.markersApi.setMarkers(out);
    }

    // ---- indicators ---------------------------------------------------------------------
    addIndicator(id, params, iid) {
      const d = IND.get(id); if (!d) return null; const LW = this.LW;
      const inst = { iid: iid || 'i' + (this.indSeq++), id, params: Object.assign(IND.defaults(id), params || {}), def: d, series: {}, levels: [], visible: true, pane: 0, last: {} };
      if (!d.overlay) { const pane = this.chart.addPane(); inst.pane = pane.paneIndex(); pane.setHeight(120); }
      for (const p of d.plots) {
        const opts = { color: p.color, lineWidth: p.width || 1, lineStyle: p.style === 'dashed' ? 2 : 0, priceLineVisible: false, lastValueVisible: !d.overlay, crosshairMarkerVisible: false, priceFormat: d.overlay ? { type: 'price', precision: this.opts.decimals, minMove: this.opts.tick } : { type: 'price', precision: 2, minMove: 0.01 } };
        inst.series[p.key] = p.type === 'hist' ? this.chart.addSeries(LW.HistogramSeries, Object.assign(opts, { base: 0 }), inst.pane) : this.chart.addSeries(LW.LineSeries, opts, inst.pane);
      }
      if (d.levels && !d.overlay) { const first = Object.values(inst.series)[0]; if (first) for (const lv of d.levels) inst.levels.push(first.createPriceLine({ price: lv.price, color: lv.color, lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: '' })); }
      this.indicators.push(inst); this._scheduleIndicators(0); this._indLegend(); return inst.iid;
    }
    removeIndicator(iid) {
      const k = this.indicators.findIndex((x) => x.iid === iid); if (k < 0) return; const inst = this.indicators[k];
      for (const s of Object.values(inst.series)) this.chart.removeSeries(s);   // an emptied pane is removed by the library
      this.indicators.splice(k, 1);
      for (const o of this.indicators) { const first = Object.values(o.series)[0]; if (first) o.pane = first.getPane().paneIndex(); }
      this._scheduleIndicators(0); this._indLegend();
    }
    setIndicatorParams(iid, params) { const inst = this.indicators.find((x) => x.iid === iid); if (!inst) return; inst.params = Object.assign({}, inst.params, params); this._scheduleIndicators(0); this._indLegend(); }
    toggleIndicator(iid) { const inst = this.indicators.find((x) => x.iid === iid); if (!inst) return; inst.visible = !inst.visible; for (const s of Object.values(inst.series)) s.applyOptions({ visible: inst.visible }); this._scheduleIndicators(0); this._indLegend(); }
    getIndicators() { return this.indicators.map((i) => ({ iid: i.iid, id: i.id, params: i.params, visible: i.visible })); }
    _scheduleIndicators(delay) { clearTimeout(this._indTimer); this._indTimer = setTimeout(() => this._computeIndicators(), delay); }
    _computeIndicators() {
      if (!this.n) return; const ctx = { tz: this.opts.tz, tick: this.opts.tick, tfMs: this.view.tfMs }; this.shapes = [];
      for (const inst of this.indicators) {
        if (!inst.visible) continue; const d = inst.def;
        if (d.intradayOnly && this.view.tfMs > 3600000) continue;
        const shapeOnly = !d.plots.length; const off = shapeOnly && this.n > SHAPE_WINDOW ? this.n - SHAPE_WINDOW : 0;
        let out; try { out = IND.compute(inst.id, inst.params, off ? this.data.slice(off) : this.data, ctx); } catch (e) { console.warn('indicator', inst.id, e); continue; }
        for (const p of d.plots) { const arr = out.lines[p.key]; const s = inst.series[p.key]; if (!arr || !s) continue; const cols = out.colors && out.colors[p.key]; const pts = []; for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v == null || isNaN(v)) continue; const pt = { time: this.times[i + off], value: v }; if (cols) pt.color = cols[i]; else if (p.type === 'hist') pt.color = v >= 0 ? 'rgba(3,201,136,0.6)' : 'rgba(229,72,77,0.6)'; pts.push(pt); } s.setData(pts); inst.last[p.key] = arr[arr.length - 1]; }
        for (const sh of out.shapes) { const s = Object.assign({}, sh); if (off) { s.i0 = s.i0 != null ? s.i0 + off : s.i0; s.i1 = s.i1 != null ? s.i1 + off : s.i1; if (s.i != null) s.i += off; } this.shapes.push(s); }
      }
      this._indLegend(); this.request();
    }
    _indLegend() {
      this.indLegendEl.innerHTML = this.indicators.map((inst) => { const vals = inst.def.plots.filter((p) => p.type !== 'hist' || !inst.def.overlay).map((p) => '<i style="color:' + p.color + '">' + (inst.last[p.key] != null && !isNaN(inst.last[p.key]) ? (inst.def.overlay ? this.fmt(inst.last[p.key]) : Number(inst.last[p.key]).toFixed(2)) : '—') + '</i>').join(' '); const pr = inst.def.inputs.filter((i) => i.type === 'int' || i.type === 'float').map((i) => inst.params[i.key]).join(' '); return '<div class="rp-indrow' + (inst.visible ? '' : ' is-off') + '" data-iid="' + inst.iid + '"><b>' + inst.def.name + '</b><span>' + pr + '</span>' + vals + '<button type="button" data-act="toggle" title="Show / hide">👁</button><button type="button" data-act="settings" title="Settings">⚙</button><button type="button" data-act="remove" title="Remove">✕</button></div>'; }).join('');
    }

    // ---- legend / crosshair -------------------------------------------------------------
    _onCross(p) { const i = p.logical != null ? Math.round(p.logical) : null; this._legend(i); if (p.point) { this.mouse = { x: p.point.x, y: p.point.y }; if (this.tool !== 'none' && this.pendingPts.length) this.request(); } else this.mouse = null; if (this.onCrosshair) this.onCrosshair(i != null ? this.bar(i) : null); }
    _legend(i) {
      const b = this.bar(i != null && i >= 0 && i < this.n ? i : this.n - 1); if (!b) { this.legendEl.innerHTML = ''; return; }
      const up = b.c >= b.o, chg = b.o ? (b.c - b.o) / b.o * 100 : 0; const col = up ? this.T.up : this.T.down;
      this.legendEl.innerHTML = '<b>' + (this.opts.symbol || '') + '</b><span class="tf">' + (this.view ? this.view.tf : '') + '</span>' + [['O', b.o], ['H', b.h], ['L', b.l], ['C', b.c]].map(([k, v]) => '<em>' + k + '</em><i style="color:' + col + '">' + this.fmt(v) + '</i>').join('') + '<i style="color:' + col + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</i>' + (b.v ? '<em>Vol</em><i>' + fmtVol(b.v) + '</i>' : '');
    }

    // ---- overlay rendering --------------------------------------------------------------
    request() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
    render() {
      const ctx = this.ov.getContext('2d'); const d = root.devicePixelRatio || 1; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, this.ov.width, this.ov.height);
      if (!this.n) return; const R = this.paneRect(); ctx.save(); ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
      const range = this.chart.timeScale().getVisibleLogicalRange(); const from = range ? Math.max(0, Math.floor(range.from) - 1) : 0, to = range ? Math.ceil(range.to) + 1 : this.n;
      this._drawSessions(ctx, R, from, to); this._drawShapes(ctx, R, from, to); this._drawDrawings(ctx, R);
      if (this.tool !== 'none' && this.pendingPts.length && this.mouse) this._drawOne(ctx, R, { type: this.tool, p1: this.pendingPts[0], p2: { t: this.tOfIndex(this.iOf(this.mouse.x)), price: this.pOf(this.mouse.y) } }, false);
      ctx.restore();
    }
    _drawSessions(ctx, R, from, to) {
      if (this.view.tfMs > 3600000) return;
      for (const key of Object.keys(SESSIONS)) { if (!this.opts.sessions[key]) continue; const s = SESSIONS[key]; ctx.fillStyle = s.color; let start = null; for (let i = from; i <= Math.min(to, this.n); i++) { const b = this.bar(i); const inS = b ? (function () { const q = RT.parts(s.tz, b.t); return !q.weekend && q.min >= s.from && q.min < s.to; })() : false; if (inS && start == null) start = i; if ((!inS || i === Math.min(to, this.n)) && start != null) { const x0 = this.xOf(start - 0.5), x1 = this.xOf(i - 0.5); if (!isNaN(x0) && !isNaN(x1)) ctx.fillRect(x0, R.y, x1 - x0, R.h); start = null; } } }
    }
    _drawShapes(ctx, R, from, to) {
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      for (const s of this.shapes) {
        if (s.type === 'marker') { if (s.i < from || s.i > to) continue; const x = this.xOf(s.i), y = this.yOf(s.price); if (isNaN(x) || isNaN(y)) continue; ctx.fillStyle = s.color; ctx.beginPath(); if (s.kind === 'up') { ctx.moveTo(x, y + 4); ctx.lineTo(x - 4, y + 11); ctx.lineTo(x + 4, y + 11); } else if (s.kind === 'down') { ctx.moveTo(x, y - 4); ctx.lineTo(x - 4, y - 11); ctx.lineTo(x + 4, y - 11); } else ctx.arc(x, y, 3, 0, 6.283); ctx.closePath(); ctx.fill(); if (s.text) { ctx.fillStyle = s.color; ctx.textAlign = 'center'; ctx.fillText(s.text, x, s.kind === 'up' ? y + 22 : y - 14); ctx.textAlign = 'left'; } continue; }
        const i1 = s.i1 == null ? this.n - 1 + 6 : s.i1; if (i1 < from || s.i0 > to) continue;
        const x0 = this.xOf(s.i0 - 0.5), x1 = this.xOf(i1 + 0.5); if (isNaN(x0) || isNaN(x1)) continue;
        if (s.type === 'bg') { ctx.fillStyle = s.color; ctx.fillRect(x0, R.y, x1 - x0, R.h); if (s.text && x0 >= R.x) { ctx.fillStyle = this.T.text; ctx.globalAlpha = 0.7; ctx.fillText(s.text, x0 + 4, R.y + R.h - 6); ctx.globalAlpha = 1; } continue; }
        if (s.type === 'level') { const y = Math.round(this.yOf(s.price)) + 0.5; if (isNaN(y)) continue; ctx.strokeStyle = s.color; ctx.setLineDash(s.dashed ? [4, 4] : []); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]); if (s.text) { ctx.fillStyle = s.color; ctx.fillText(s.text, Math.min(x1, R.w - 40) - ctx.measureText(s.text).width, y - 3); } continue; }
        if (s.type === 'box') { const yt = this.yOf(s.top), yb = this.yOf(s.bottom); if (isNaN(yt) || isNaN(yb)) continue; ctx.fillStyle = s.fill || 'rgba(255,255,255,0.05)'; ctx.fillRect(x0, yt, x1 - x0, yb - yt); ctx.strokeStyle = s.color; ctx.setLineDash(s.dashed ? [4, 4] : []); ctx.strokeRect(Math.round(x0) + 0.5, Math.round(yt) + 0.5, Math.round(x1 - x0), Math.round(yb - yt)); ctx.setLineDash([]); if (s.text && yb - yt > 9 && x0 >= R.x) { ctx.fillStyle = s.color; ctx.fillText(s.text, x0 + 3, yt + 10); } }
      }
    }
    // ---- drawings -----------------------------------------------------------------------
    setDrawings(d) { this.drawings = d || []; this.request(); }
    getDrawings() { return this.drawings; }
    setTool(tool) { this.tool = tool || 'none'; this.pendingPts = []; this.ov.style.pointerEvents = this.tool === 'none' ? 'none' : 'auto'; this.ov.style.cursor = this.tool === 'none' ? '' : 'crosshair'; this.request(); }
    deleteSelected() { if (this.selected == null) return false; this.drawings.splice(this.selected, 1); this.selected = null; this._changed(); return true; }
    clearDrawings() { this.drawings = []; this.selected = null; this._changed(); }
    _changed() { if (this.onDrawingsChange) this.onDrawingsChange(this.drawings); this.request(); }
    _pt(p) { return { x: this.xOf(this.indexOfT(p.t)), y: this.yOf(p.price) }; }
    _drawDrawings(ctx, R) { this.drawings.forEach((d, i) => this._drawOne(ctx, R, d, i === this.selected)); }
    _drawOne(ctx, R, d, sel) {
      const col = sel ? this.T.sel : (d.color || this.T.draw); ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2 : 1.25; ctx.font = '11px JetBrains Mono, monospace';
      const a = this._pt(d.p1), b = d.p2 ? this._pt(d.p2) : null; if (isNaN(a.x) || isNaN(a.y) || (b && (isNaN(b.x) || isNaN(b.y)))) { ctx.restore(); return; }
      if (d.type === 'hline') { const y = Math.round(a.y) + 0.5; ctx.beginPath(); ctx.moveTo(R.x, y); ctx.lineTo(R.x + R.w, y); ctx.stroke(); ctx.fillText(this.fmt(d.p1.price), R.x + R.w - 70, y - 4); }
      else if (d.type === 'trend' && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      else if (d.type === 'ray' && b) { const dx = b.x - a.x, dy = b.y - a.y; let ex = b.x, ey = b.y; if (dx > 0) { const k = (R.x + R.w + 50 - a.x) / dx; ex = a.x + dx * k; ey = a.y + dy * k; } ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke(); }
      else if (d.type === 'rect' && b) { ctx.globalAlpha = 0.14; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.globalAlpha = 1; ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else if (d.type === 'fib' && b) { const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1]; const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x); for (const f of lv) { const pr = d.p1.price + (d.p2.price - d.p1.price) * f; const y = Math.round(this.yOf(pr)) + 0.5; ctx.globalAlpha = f === 0 || f === 1 ? 1 : 0.7; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1 + 60, y); ctx.stroke(); ctx.fillText(f.toFixed(3) + '  ' + this.fmt(pr), x1 + 64, y + 4); } ctx.globalAlpha = 1; }
      else if (d.type === 'measure' && b) { const dp = d.p2.price - d.p1.price, pct = d.p1.price ? dp / d.p1.price * 100 : 0; const bars = Math.round(Math.abs(this.indexOfT(d.p2.t) - this.indexOfT(d.p1.t))); ctx.fillStyle = dp >= 0 ? 'rgba(3,201,136,0.15)' : 'rgba(229,72,77,0.15)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.strokeStyle = dp >= 0 ? this.T.up : this.T.down; ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); const txt = (dp >= 0 ? '+' : '') + this.fmt(dp) + ' (' + pct.toFixed(2) + '%) · ' + bars + ' bars · ' + (this.opts.tick ? Math.round(Math.abs(dp) / this.opts.tick) + ' ticks' : ''); const w = ctx.measureText(txt).width + 12; ctx.fillStyle = this.T.tag; ctx.fillRect(b.x - w / 2, Math.min(a.y, b.y) - 22, w, 18); ctx.fillStyle = this.T.legend; ctx.fillText(txt, b.x - w / 2 + 6, Math.min(a.y, b.y) - 9); }
      if (sel) for (const p of [a, b]) if (p) { ctx.fillStyle = this.T.sel; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 6.283); ctx.fill(); }
      ctx.restore();
    }
    _hitDrawing(x, y) {
      const dist = (ax, ay, bx, by) => { const l2 = (bx - ax) ** 2 + (by - ay) ** 2; if (!l2) return Math.hypot(x - ax, y - ay); let t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))); };
      for (let i = this.drawings.length - 1; i >= 0; i--) { const d = this.drawings[i]; const a = this._pt(d.p1), b = d.p2 ? this._pt(d.p2) : null; if (d.type === 'hline') { if (Math.abs(a.y - y) < 6) return i; continue; } if (!b) continue; if (d.type === 'trend' || d.type === 'ray') { if (dist(a.x, a.y, b.x, b.y) < 6) return i; } else if (x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4 && y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4) return i; }
      return null;
    }
    // ---- screenshot ------------------------------------------------------------------------
    screenshot(width) {
      const c = this.chart.takeScreenshot(); const w = width || 640; const scale = w / c.width; const out = document.createElement('canvas'); out.width = w; out.height = Math.round(c.height * scale);
      const ctx = out.getContext('2d'); ctx.drawImage(c, 0, 0, out.width, out.height); ctx.drawImage(this.ov, 0, 0, out.width, out.height); return out.toDataURL('image/jpeg', 0.62);
    }

    // ---- input ---------------------------------------------------------------------------
    _bind() {
      const pos = (e) => { const r = this.chartEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const hitLine = (m) => { const R = this.paneRect(); if (m.x > R.w || m.y > R.h) return null; for (const l of this.lines) if (l.draggable) { const y = this.yOf(l.price); if (!isNaN(y) && Math.abs(y - m.y) < 6) return l; } return null; };
      this.chartEl.addEventListener('mousemove', (e) => { if (this.drag) return; const hl = hitLine(pos(e)); this.hoverLine = hl; this.chartEl.style.cursor = hl ? 'ns-resize' : ''; });
      this.chartEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; const m = pos(e); const hl = hitLine(m);
        if (hl) { this.drag = { line: hl, start: hl.price }; this.chart.applyOptions({ handleScroll: false, handleScale: false }); e.preventDefault(); e.stopPropagation(); return; }
        this._down = { x: m.x, y: m.y };
      }, true);
      this._winMove = (e) => { if (!this.drag) return; const m = pos(e); const p = this.snap(this.pOf(m.y)); if (isNaN(p)) return; this.drag.line.price = p; const pl = this.priceLines.get(this.drag.line.id); if (pl) pl.applyOptions({ price: p, title: (this.drag.line.dragLabel ? this.drag.line.dragLabel(p) : this.drag.line.label) || '' }); };
      this._winUp = (e) => {
        if (this.drag) { const l = this.drag.line; this.chart.applyOptions({ handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true } }); const moved = l.price !== this.drag.start; this.drag = null; if (moved && this.onLineDrag) this.onLineDrag(l, l.price); return; }
        if (this._down && this.tool === 'none') { const m = pos(e); if (Math.hypot(m.x - this._down.x, m.y - this._down.y) < 4) { const hit = this._hitDrawing(m.x, m.y); if (hit !== this.selected) { this.selected = hit; if (this.onSelect) this.onSelect(hit); this.request(); } } this._down = null; }
      };
      root.addEventListener('mousemove', this._winMove); root.addEventListener('mouseup', this._winUp);
      // drawing tools on the overlay
      this.ov.addEventListener('mousedown', (e) => {
        if (this.tool === 'none') return; const r = this.ov.getBoundingClientRect(); const m = { x: e.clientX - r.left, y: e.clientY - r.top }; const R = this.paneRect(); if (m.x > R.w || m.y > R.h) return;
        const p = { t: this.tOfIndex(this.iOf(m.x)), price: this.snap(this.pOf(m.y)) }; if (isNaN(p.price)) return;
        if (this.tool === 'hline') { this.drawings.push({ type: 'hline', p1: p }); this._changed(); this.setTool('none'); return; }
        if (!this.pendingPts.length) { this.pendingPts = [p]; this.mouse = m; this.request(); return; }
        this.drawings.push({ type: this.tool, p1: this.pendingPts[0], p2: p }); this.pendingPts = []; if (this.tool === 'measure') this.selected = this.drawings.length - 1; this._changed(); this.setTool('none');
      });
      this.ov.addEventListener('mousemove', (e) => { if (this.tool === 'none') return; const r = this.ov.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; if (this.pendingPts.length) this.request(); });
      this.indLegendEl.addEventListener('click', (e) => { const b = e.target.closest('button'); const row = e.target.closest('[data-iid]'); if (!b || !row) return; if (this.onIndicatorAction) this.onIndicatorAction(row.dataset.iid, b.dataset.act); });
    }
  }
  function fmtVol(v) { if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(Math.round(v)); }
  root.ReplayChart = ReplayChart;
})(window);
