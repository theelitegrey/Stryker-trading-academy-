/**
 * Stryker Trading Academy — Replay chart (canvas candlestick view)
 *
 * A deliberately small, dependency-free chart built for bar-by-bar replay:
 * it renders a Series "view" ({ n, bars, last } from replay-engine.js) so the
 * future is never on screen, and it layers the things a backtester needs on
 * top: draggable stop / target / pending-order lines, entry and exit markers,
 * session shading (New York and London hours), a crosshair with an OHLC
 * legend, and a few drawing tools (trend line, ray, horizontal line,
 * rectangle, Fibonacci retracement, measure).
 *
 * Coordinates: bars are addressed by fractional index in the CURRENT view;
 * drawings are stored in { t, price } so they survive timeframe switches.
 */
(function (root) {
  'use strict';

  const DPR = () => (root.devicePixelRatio || 1);
  const AXIS_W = 72, AXIS_H = 24, VOL_FRAC = 0.16, RIGHT_MARGIN_BARS = 6;

  const SESSIONS = {
    ny: { tz: 'America/New_York', from: 9 * 60 + 30, to: 16 * 60, color: 'rgba(3,201,136,0.06)' },
    ldn: { tz: 'Europe/London', from: 8 * 60, to: 16 * 60 + 30, color: 'rgba(0,173,181,0.06)' }
  };
  const fmtCache = {};
  function partsIn(tz, t) {
    const key = tz + '|' + t;
    if (fmtCache[key]) return fmtCache[key];
    const f = fmtCache['#' + tz] || (fmtCache['#' + tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    const o = {};
    for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
    const r = { min: (Number(o.hour) % 24) * 60 + Number(o.minute), wd: o.weekday, mon: o.month, day: o.day, year: o.year, hh: String(Number(o.hour) % 24).padStart(2, '0'), mm: o.minute };
    if (Object.keys(fmtCache).length > 20000) for (const k in fmtCache) { if (k[0] !== '#') delete fmtCache[k]; }
    fmtCache[key] = r;
    return r;
  }

  class ReplayChart {
    constructor(container, opts) {
      this.el = container;
      this.opts = Object.assign({ tz: 'America/New_York', decimals: 2, tick: 0.01, sessions: { ny: true, ldn: false }, theme: 'dark' }, opts || {});
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'rp-canvas';
      this.el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.view = null; this.barW = 9; this.right = 0; this.autoScroll = true;
      this.lines = []; this.markers = []; this.drawings = []; this.tool = 'none'; this.pendingPts = [];
      this.mouse = null; this.drag = null; this.selected = null; this.hoverLine = null;
      this.onLineDrag = null; this.onDrawingsChange = null; this.onSelect = null;
      this.priceMin = 0; this.priceMax = 1; this.plot = { x: 0, y: 0, w: 0, h: 0 };
      this._raf = 0;
      this._bind();
      this.resize();
      if (root.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.el); }
    }
    destroy() { if (this._ro) this._ro.disconnect(); this.canvas.remove(); }

    // ---- public API ----
    setView(view, keepScroll) {
      const prevN = this.view ? this.view.n : 0;
      this.view = view;
      if (this.autoScroll || !keepScroll) this.right = view.n - 1 + RIGHT_MARGIN_BARS;
      else if (view.n < prevN) this.right = Math.min(this.right, view.n - 1 + RIGHT_MARGIN_BARS);
      this.request();
    }
    setLines(lines) { this.lines = lines || []; this.request(); }
    setMarkers(markers) { this.markers = markers || []; this.request(); }
    setDrawings(d) { this.drawings = d || []; this.request(); }
    getDrawings() { return this.drawings; }
    setTool(tool) { this.tool = tool || 'none'; this.pendingPts = []; this.el.classList.toggle('is-drawing', this.tool !== 'none'); this.request(); }
    setOptions(o) { Object.assign(this.opts, o || {}); this.request(); }
    scrollToEnd() { this.autoScroll = true; if (this.view) this.right = this.view.n - 1 + RIGHT_MARGIN_BARS; this.request(); }
    zoom(f) { this._zoomAt(f, this.plot.x + this.plot.w); }
    deleteSelected() {
      if (this.selected == null) return false;
      this.drawings.splice(this.selected, 1); this.selected = null;
      if (this.onDrawingsChange) this.onDrawingsChange(this.drawings);
      this.request(); return true;
    }
    clearDrawings() { this.drawings = []; this.selected = null; if (this.onDrawingsChange) this.onDrawingsChange(this.drawings); this.request(); }

    // ---- geometry ----
    resize() {
      const r = this.el.getBoundingClientRect();
      const w = Math.max(200, Math.floor(r.width)), h = Math.max(160, Math.floor(r.height));
      const d = DPR();
      this.canvas.width = Math.round(w * d); this.canvas.height = Math.round(h * d);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.W = w; this.H = h;
      this.plot = { x: 0, y: 6, w: w - AXIS_W, h: h - AXIS_H - 6 };
      this.request();
    }
    bar(i) { const v = this.view; if (!v || i < 0 || i >= v.n) return null; return i === v.n - 1 ? v.last : v.bars[i]; }
    xOf(i) { return this.plot.x + this.plot.w - (this.right - i) * this.barW; }
    iOf(x) { return this.right - (this.plot.x + this.plot.w - x) / this.barW; }
    yOf(p) { return this.plot.y + (this.priceMax - p) / (this.priceMax - this.priceMin) * this.plot.h; }
    pOf(y) { return this.priceMax - (y - this.plot.y) / this.plot.h * (this.priceMax - this.priceMin); }
    tOf(i) { // fractional index → time
      const v = this.view; if (!v) return 0;
      const k = Math.floor(i), b = this.bar(Math.max(0, Math.min(v.n - 1, k)));
      return b.t + (i - Math.max(0, Math.min(v.n - 1, k))) * v.tfMs;
    }
    iOfT(t) { // time → fractional index (binary search over the view)
      const v = this.view; if (!v) return 0;
      let lo = 0, hi = v.n - 1;
      if (t < this.bar(0).t) return (t - this.bar(0).t) / v.tfMs;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.bar(mid).t <= t) lo = mid; else hi = mid - 1; }
      return lo + (t - this.bar(lo).t) / v.tfMs;
    }
    visibleRange() {
      const n = this.view ? this.view.n : 0;
      const from = Math.max(0, Math.floor(this.iOf(this.plot.x)) - 1), to = Math.min(n - 1, Math.ceil(this.right));
      return { from, to };
    }
    _fitPrice() {
      const { from, to } = this.visibleRange();
      let mn = Infinity, mx = -Infinity;
      for (let i = from; i <= to; i++) { const b = this.bar(i); if (!b) continue; if (b.h > mx) mx = b.h; if (b.l < mn) mn = b.l; }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      // keep order lines in view when close to the range
      for (const l of this.lines) { if (l.price > mx && l.price < mx * 1.02) mx = l.price; if (l.price < mn && l.price > mn * 0.98) mn = l.price; }
      const pad = (mx - mn || mx * 0.01 || 1) * 0.08;
      this.priceMin = mn - pad; this.priceMax = mx + pad;
    }

    // ---- rendering ----
    request() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
    render() {
      const ctx = this.ctx, d = DPR();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const dark = this.opts.theme !== 'light';
      const C = dark ? { bg: '#0b0b0d', grid: 'rgba(255,255,255,0.05)', axis: '#8b93a0', axisBg: '#0b0b0d', text: '#c9cdd3', bull: '#03c988', bear: '#e5484d', cross: 'rgba(255,255,255,0.35)', volBull: 'rgba(3,201,136,0.28)', volBear: 'rgba(229,72,77,0.28)', tag: '#131316', sel: '#f5c542' }
                     : { bg: '#ffffff', grid: 'rgba(0,0,0,0.06)', axis: '#5c6472', axisBg: '#ffffff', text: '#222', bull: '#059669', bear: '#dc2626', cross: 'rgba(0,0,0,0.35)', volBull: 'rgba(5,150,105,0.25)', volBear: 'rgba(220,38,38,0.25)', tag: '#f3f4f6', sel: '#b8901f' };
      this.C = C;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);
      if (!this.view) { ctx.fillStyle = C.axis; ctx.font = '13px sans-serif'; ctx.fillText('No data', 20, 30); return; }
      this._fitPrice();
      const P = this.plot;
      ctx.save(); ctx.beginPath(); ctx.rect(P.x, P.y, P.w, P.h); ctx.clip();
      this._drawSessions(ctx);
      this._drawGrid(ctx, C);
      this._drawCandles(ctx, C);
      this._drawDrawings(ctx, C);
      this._drawLines(ctx, C);
      this._drawMarkers(ctx, C);
      ctx.restore();
      this._drawAxes(ctx, C);
      this._drawCrosshair(ctx, C);
      this._drawLegend(ctx, C);
    }
    _drawSessions(ctx) {
      const v = this.view; if (!v || v.tfMs > 3600000) return;
      const { from, to } = this.visibleRange();
      for (const key of Object.keys(SESSIONS)) {
        if (!this.opts.sessions[key]) continue;
        const s = SESSIONS[key]; ctx.fillStyle = s.color;
        let runStart = null;
        for (let i = from; i <= to + 1; i++) {
          const b = this.bar(i);
          const inS = b ? (function () { const m = partsIn(s.tz, b.t).min; const wd = partsIn(s.tz, b.t).wd; return wd !== 'Sat' && wd !== 'Sun' && m >= s.from && m < s.to; })() : false;
          if (inS && runStart == null) runStart = i;
          if ((!inS || i === to + 1) && runStart != null) { const x0 = this.xOf(runStart) - this.barW / 2, x1 = this.xOf(i) - this.barW / 2; ctx.fillRect(x0, this.plot.y, x1 - x0, this.plot.h); runStart = null; }
        }
      }
    }
    _drawGrid(ctx, C) {
      const P = this.plot; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      const steps = this._priceSteps();
      for (const p of steps) { const y = Math.round(this.yOf(p)) + 0.5; ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.stroke(); }
      for (const tk of this._timeTicks()) { const x = Math.round(this.xOf(tk.i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); ctx.stroke(); }
    }
    _priceSteps() {
      const range = this.priceMax - this.priceMin, target = Math.max(3, Math.floor(this.plot.h / 60));
      const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
      const out = []; for (let p = Math.ceil(this.priceMin / step) * step; p <= this.priceMax; p += step) out.push(p);
      return out;
    }
    _timeTicks() {
      const v = this.view, out = []; if (!v) return out;
      const { from, to } = this.visibleRange();
      const minPx = 90, everyBars = Math.max(1, Math.ceil(minPx / this.barW));
      const tz = this.opts.tz; let lastDay = null;
      for (let i = Math.max(0, from); i <= to; i++) {
        const b = this.bar(i); if (!b) continue;
        const p = partsIn(tz, b.t);
        const dayKey = p.year + p.mon + p.day;
        const newDay = dayKey !== lastDay; lastDay = dayKey;
        let label = null;
        if (v.tfMs >= 86400000) { if (i % everyBars === 0) label = p.mon + ' ' + p.day + (p.mon === 'Jan' && p.day === '1' || i === from ? ' ' + p.year : ''); }
        else if (newDay && i !== from) label = p.wd + ' ' + p.day;
        else if (i % everyBars === 0) label = p.hh + ':' + p.mm;
        if (label) out.push({ i, label, strong: newDay });
      }
      // thin out labels that would collide
      const res = []; let lastX = -Infinity;
      for (const t of out) { const x = this.xOf(t.i); if (x - lastX >= minPx * 0.8 || t.strong) { res.push(t); lastX = x; } }
      return res;
    }
    _drawCandles(ctx, C) {
      const { from, to } = this.visibleRange(); const P = this.plot;
      let vmax = 0; for (let i = from; i <= to; i++) { const b = this.bar(i); if (b && b.v > vmax) vmax = b.v; }
      const bw = Math.max(1, Math.floor(this.barW * 0.7)), volH = P.h * VOL_FRAC;
      for (let i = from; i <= to; i++) {
        const b = this.bar(i); if (!b) continue;
        const x = Math.round(this.xOf(i)), up = b.c >= b.o;
        const col = up ? C.bull : C.bear;
        if (vmax > 0 && b.v) { ctx.fillStyle = up ? C.volBull : C.volBear; const vh = b.v / vmax * volH; ctx.fillRect(x - bw / 2, P.y + P.h - vh, bw, vh); }
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        const yh = this.yOf(b.h), yl = this.yOf(b.l), yo = this.yOf(b.o), yc = this.yOf(b.c);
        ctx.beginPath(); ctx.moveTo(x + 0.5, yh); ctx.lineTo(x + 0.5, yl); ctx.stroke();
        const top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yo - yc));
        if (bw <= 2) { ctx.fillRect(x, top, 1, hgt); }
        else if (up && this.opts.hollowUp) { ctx.strokeRect(x - bw / 2 + 0.5, top + 0.5, bw - 1, hgt); }
        else ctx.fillRect(x - bw / 2, top, bw, hgt);
      }
      // forming candle marker
      const lastX = this.xOf(this.view.n - 1);
      if (this.view.last && !this.view.complete) { ctx.fillStyle = C.axis; ctx.fillRect(lastX - 1, P.y + P.h - 3, 3, 3); }
    }
    _drawLines(ctx, C) {
      const P = this.plot; ctx.font = '11px JetBrains Mono, monospace';
      for (const l of this.lines) {
        const y = Math.round(this.yOf(l.price)) + 0.5; if (y < P.y - 2 || y > P.y + P.h + 2) continue;
        ctx.save(); ctx.strokeStyle = l.color; ctx.lineWidth = (this.hoverLine === l || (this.drag && this.drag.line === l)) ? 2 : 1;
        if (l.dash) ctx.setLineDash(l.dash);
        ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.stroke(); ctx.restore();
        if (l.label) {
          const txt = l.label; const w = ctx.measureText(txt).width + 12;
          ctx.fillStyle = l.color; ctx.globalAlpha = 0.92; ctx.fillRect(P.x + 8, y - 9, w, 17); ctx.globalAlpha = 1;
          ctx.fillStyle = '#04120c'; ctx.fillText(txt, P.x + 14, y + 4);
        }
      }
    }
    _drawMarkers(ctx, C) {
      for (const m of this.markers) {
        const i = this.iOfT(m.t); const x = this.xOf(i), y = this.yOf(m.price);
        if (x < this.plot.x - 10 || x > this.plot.x + this.plot.w + 10) continue;
        ctx.fillStyle = m.color || (m.side === 'buy' ? C.bull : C.bear);
        ctx.beginPath();
        if (m.kind === 'exit') { ctx.rect(x - 4, y - 4, 8, 8); }
        else if (m.side === 'buy') { ctx.moveTo(x, y + 6); ctx.lineTo(x - 6, y + 16); ctx.lineTo(x + 6, y + 16); }
        else { ctx.moveTo(x, y - 6); ctx.lineTo(x - 6, y - 16); ctx.lineTo(x + 6, y - 16); }
        ctx.closePath(); ctx.fill();
        if (m.label) { ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = C.text; ctx.fillText(m.label, x + 8, m.side === 'buy' && m.kind !== 'exit' ? y + 16 : y - 8); }
      }
      // connect entry→exit for closed trades
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      for (const m of this.markers) {
        if (m.kind !== 'exit' || !m.from) continue;
        const x0 = this.xOf(this.iOfT(m.from.t)), y0 = this.yOf(m.from.price), x1 = this.xOf(this.iOfT(m.t)), y1 = this.yOf(m.price);
        ctx.strokeStyle = m.pnl >= 0 ? C.bull : C.bear; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    _drawAxes(ctx, C) {
      const P = this.plot;
      ctx.fillStyle = C.axisBg; ctx.fillRect(P.x + P.w, 0, AXIS_W, this.H); ctx.fillRect(0, P.y + P.h, this.W, AXIS_H);
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(P.x + P.w + 0.5, 0); ctx.lineTo(P.x + P.w + 0.5, P.y + P.h); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
      for (const p of this._priceSteps()) { const y = this.yOf(p); if (y < P.y + 6 || y > P.y + P.h - 4) continue; ctx.fillText(this.fmt(p), P.x + P.w + 8, y + 4); }
      ctx.textAlign = 'center';
      for (const tk of this._timeTicks()) { const x = this.xOf(tk.i); if (x < P.x || x > P.x + P.w) continue; ctx.fillStyle = tk.strong ? C.text : C.axis; ctx.fillText(tk.label, x, P.y + P.h + 16); }
      ctx.textAlign = 'left';
      // last price tag
      const last = this.bar(this.view.n - 1);
      if (last) { const y = this.yOf(last.c); const up = last.c >= last.o; this._tag(ctx, P.x + P.w, y, this.fmt(last.c), up ? C.bull : C.bear, '#04120c'); }
      // order line tags
      for (const l of this.lines) { const y = this.yOf(l.price); if (y >= P.y && y <= P.y + P.h) this._tag(ctx, P.x + P.w, y, this.fmt(l.price), l.color, '#04120c'); }
    }
    _tag(ctx, x, y, txt, bg, fg) {
      ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = bg; ctx.fillRect(x + 1, Math.round(y) - 9, AXIS_W - 2, 18);
      ctx.fillStyle = fg; ctx.fillText(txt, x + 7, Math.round(y) + 4);
    }
    _drawCrosshair(ctx, C) {
      const m = this.mouse; if (!m) return; const P = this.plot;
      if (m.x < P.x || m.x > P.x + P.w || m.y < P.y || m.y > P.y + P.h) return;
      const i = Math.round(this.iOf(m.x)); const x = Math.round(this.xOf(i)) + 0.5;
      ctx.save(); ctx.strokeStyle = C.cross; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P.x, Math.round(m.y) + 0.5); ctx.lineTo(P.x + P.w, Math.round(m.y) + 0.5); ctx.stroke(); ctx.restore();
      this._tag(ctx, P.x + P.w, m.y, this.fmt(this.pOf(m.y)), C.tag, C.text);
      const b = this.bar(i);
      if (b) { const p = partsIn(this.opts.tz, b.t); const lbl = this.view.tfMs >= 86400000 ? p.wd + ' ' + p.mon + ' ' + p.day + ' ' + p.year : p.wd + ' ' + p.mon + ' ' + p.day + ' ' + p.hh + ':' + p.mm;
        ctx.font = '11px JetBrains Mono, monospace'; const w = ctx.measureText(lbl).width + 12; const tx = Math.min(Math.max(P.x, x - w / 2), P.x + P.w - w);
        ctx.fillStyle = C.tag; ctx.fillRect(tx, P.y + P.h + 3, w, 18); ctx.fillStyle = C.text; ctx.fillText(lbl, tx + 6, P.y + P.h + 16); }
      // measure preview / pending drawing preview
      if (this.tool !== 'none' && this.pendingPts.length) this._previewDrawing(ctx, C, m);
    }
    _drawLegend(ctx, C) {
      const i = this.mouse ? Math.round(this.iOf(this.mouse.x)) : this.view.n - 1;
      const b = this.bar(Math.max(0, Math.min(this.view.n - 1, i))); if (!b) return;
      const up = b.c >= b.o, chg = b.o ? (b.c - b.o) / b.o * 100 : 0;
      ctx.font = '11.5px JetBrains Mono, monospace'; ctx.fillStyle = C.text;
      const parts = [['O', this.fmt(b.o)], ['H', this.fmt(b.h)], ['L', this.fmt(b.l)], ['C', this.fmt(b.c)]];
      let x = this.plot.x + 10, y = this.plot.y + 16;
      ctx.fillStyle = C.axis; ctx.fillText(this.opts.symbol ? this.opts.symbol + ' · ' + this.view.tf : this.view.tf, x, y); x += ctx.measureText(this.opts.symbol ? this.opts.symbol + ' · ' + this.view.tf : this.view.tf).width + 14;
      for (const [k, v] of parts) { ctx.fillStyle = C.axis; ctx.fillText(k, x, y); x += 12; ctx.fillStyle = up ? C.bull : C.bear; ctx.fillText(v, x, y); x += ctx.measureText(v).width + 10; }
      ctx.fillStyle = up ? C.bull : C.bear; ctx.fillText((chg >= 0 ? '+' : '') + chg.toFixed(2) + '%', x, y); x += 60;
      if (b.v) { ctx.fillStyle = C.axis; ctx.fillText('Vol ' + fmtVol(b.v), x, y); }
    }

    // ---- drawings ----
    _drawDrawings(ctx, C) {
      this.drawings.forEach((d, idx) => this._drawOne(ctx, C, d, idx === this.selected));
    }
    _pt(p) { return { x: this.xOf(this.iOfT(p.t)), y: this.yOf(p.price) }; }
    _drawOne(ctx, C, d, sel) {
      const col = sel ? C.sel : (d.color || '#4fe3ac');
      ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2 : 1.25; ctx.font = '11px JetBrains Mono, monospace';
      const a = this._pt(d.p1), b = d.p2 ? this._pt(d.p2) : null; const P = this.plot;
      if (d.type === 'hline') { const y = Math.round(a.y) + 0.5; ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.stroke(); ctx.fillText(this.fmt(d.p1.price), P.x + P.w - 70, y - 4); }
      else if (d.type === 'trend' && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      else if (d.type === 'ray' && b) { const dx = b.x - a.x, dy = b.y - a.y; const k = dx !== 0 ? (P.x + P.w + 50 - a.x) / dx : 0; const ex = dx > 0 ? a.x + dx * k : b.x, ey = dx > 0 ? a.y + dy * k : b.y; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke(); }
      else if (d.type === 'rect' && b) { ctx.globalAlpha = 0.14; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.globalAlpha = 1; ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else if (d.type === 'fib' && b) {
        const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1];
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        for (const f of lv) { const pr = d.p1.price + (d.p2.price - d.p1.price) * f; const y = Math.round(this.yOf(pr)) + 0.5; ctx.globalAlpha = f === 0 || f === 1 ? 1 : 0.7; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1 + 60, y); ctx.stroke(); ctx.fillText(f.toFixed(3) + '  ' + this.fmt(pr), x1 + 64, y + 4); }
        ctx.globalAlpha = 1;
      }
      else if (d.type === 'measure' && b) {
        const dp = d.p2.price - d.p1.price, pct = d.p1.price ? dp / d.p1.price * 100 : 0; const bars = Math.round(Math.abs(this.iOfT(d.p2.t) - this.iOfT(d.p1.t)));
        ctx.fillStyle = dp >= 0 ? 'rgba(3,201,136,0.15)' : 'rgba(229,72,77,0.15)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = dp >= 0 ? C.bull : C.bear; ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        const txt = (dp >= 0 ? '+' : '') + this.fmt(dp) + ' (' + pct.toFixed(2) + '%) · ' + bars + ' bars'; const w = ctx.measureText(txt).width + 12;
        ctx.fillStyle = C.tag; ctx.fillRect(b.x - w / 2, Math.min(a.y, b.y) - 22, w, 18); ctx.fillStyle = C.text; ctx.fillText(txt, b.x - w / 2 + 6, Math.min(a.y, b.y) - 9);
      }
      if (sel) { for (const p of [a, b]) if (p) { ctx.fillStyle = C.sel; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 6.283); ctx.fill(); } }
      ctx.restore();
    }
    _previewDrawing(ctx, C, m) {
      const p1 = this.pendingPts[0]; const p2 = { t: this.tOf(this.iOf(m.x)), price: this.pOf(m.y) };
      this._drawOne(ctx, C, { type: this.tool, p1, p2 }, false);
    }
    _hitDrawing(x, y) {
      const dist = (ax, ay, bx, by) => { const l2 = (bx - ax) ** 2 + (by - ay) ** 2; if (!l2) return Math.hypot(x - ax, y - ay); let t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))); };
      for (let i = this.drawings.length - 1; i >= 0; i--) {
        const d = this.drawings[i]; const a = this._pt(d.p1), b = d.p2 ? this._pt(d.p2) : null;
        if (d.type === 'hline') { if (Math.abs(a.y - y) < 6) return i; continue; }
        if (!b) continue;
        if (d.type === 'trend' || d.type === 'ray') { if (dist(a.x, a.y, b.x, b.y) < 6) return i; }
        else if (d.type === 'rect' || d.type === 'measure' || d.type === 'fib') { if (x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4 && y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4) return i; }
      }
      return null;
    }

    // ---- input ----
    _bind() {
      const c = this.canvas;
      const pos = (e) => { const r = c.getBoundingClientRect(); const s = e.touches ? e.touches[0] : e; return { x: s.clientX - r.left, y: s.clientY - r.top }; };
      c.addEventListener('mousemove', (e) => {
        const m = pos(e); this.mouse = m;
        if (this.drag) {
          if (this.drag.kind === 'pan') { const dx = m.x - this.drag.x; this.right = this.drag.right - dx / this.barW; this.autoScroll = false; this._clampRight(); }
          else if (this.drag.kind === 'line') { const p = this.pOf(m.y); this.drag.line.price = this.snap(p); if (this.drag.line.onPreview) this.drag.line.onPreview(this.drag.line.price); }
          this.request(); return;
        }
        // hover on draggable lines
        let hl = null; for (const l of this.lines) if (l.draggable && Math.abs(this.yOf(l.price) - m.y) < 6 && m.x < this.plot.x + this.plot.w) { hl = l; break; }
        this.hoverLine = hl; c.style.cursor = hl ? 'ns-resize' : (this.tool !== 'none' ? 'crosshair' : 'default');
        this.request();
      });
      c.addEventListener('mouseleave', () => { this.mouse = null; this.hoverLine = null; this.request(); });
      c.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; const m = pos(e);
        if (this.hoverLine) { this.drag = { kind: 'line', line: this.hoverLine, start: this.hoverLine.price }; e.preventDefault(); return; }
        if (this.tool !== 'none' && m.x < this.plot.x + this.plot.w && m.y < this.plot.y + this.plot.h) {
          const p = { t: this.tOf(this.iOf(m.x)), price: this.snap(this.pOf(m.y)) };
          if (this.tool === 'hline') { this.drawings.push({ type: 'hline', p1: p }); this._changed(); this.setTool('none'); return; }
          if (!this.pendingPts.length) { this.pendingPts = [p]; this.request(); return; }
          this.drawings.push({ type: this.tool, p1: this.pendingPts[0], p2: p }); this.pendingPts = []; this._changed();
          if (this.tool === 'measure') { this.selected = this.drawings.length - 1; }
          this.setTool('none'); return;
        }
        const hit = this._hitDrawing(m.x, m.y);
        this.selected = hit; if (this.onSelect) this.onSelect(hit);
        this.drag = { kind: 'pan', x: m.x, right: this.right, moved: false };
        e.preventDefault();
      });
      const up = () => {
        if (this.drag && this.drag.kind === 'line') { const l = this.drag.line; if (this.onLineDrag && l.price !== this.drag.start) this.onLineDrag(l, l.price); }
        this.drag = null; this.request();
      };
      root.addEventListener('mouseup', up);
      c.addEventListener('wheel', (e) => { e.preventDefault(); const m = pos(e); if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this._zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, m.x); else { this.right += e.deltaX / this.barW; this.autoScroll = false; this._clampRight(); this.request(); } }, { passive: false });
      c.addEventListener('dblclick', () => this.scrollToEnd());
      // touch: pan + pinch
      let pinch = null;
      c.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), barW: this.barW }; } else { const m = pos(e); this.drag = { kind: 'pan', x: m.x, right: this.right }; } }, { passive: true });
      c.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); this.barW = Math.max(2, Math.min(60, pinch.barW * d / pinch.d)); this.request(); } else if (this.drag) { const m = pos(e); this.right = this.drag.right - (m.x - this.drag.x) / this.barW; this.autoScroll = false; this._clampRight(); this.request(); } }, { passive: true });
      c.addEventListener('touchend', () => { pinch = null; this.drag = null; });
    }
    _zoomAt(f, x) {
      const i = this.iOf(x); this.barW = Math.max(2, Math.min(60, this.barW * f));
      this.right = i + (this.plot.x + this.plot.w - x) / this.barW; this._clampRight(); this.request();
    }
    _clampRight() { if (!this.view) return; this.right = Math.max(5, Math.min(this.view.n - 1 + RIGHT_MARGIN_BARS + this.plot.w / this.barW * 0.5, this.right)); if (this.right >= this.view.n - 1 + RIGHT_MARGIN_BARS - 0.01) this.autoScroll = true; }
    _changed() { if (this.onDrawingsChange) this.onDrawingsChange(this.drawings); this.request(); }
    snap(p) { const t = this.opts.tick; if (!t) return p; return Math.round(p / t) * t; }
    fmt(p) { return Number(p).toFixed(this.opts.decimals); }
  }

  function fmtVol(v) { if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(Math.round(v)); }

  root.ReplayChart = ReplayChart;
})(window);
