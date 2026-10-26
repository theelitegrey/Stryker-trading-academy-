/**
 * TradeZoro — Backtest chart on OUR chart (Vela), replay.html?chart=tz
 *
 * Classic script. Gives replay.js an object with the same public API as ReplayChart
 * (assets/replay-chart.js, Lightweight Charts) but drawn by the Charts page engine: it boots
 * assets/vela-chart.js in backtest mode (window.__stkBt), with one data provider "bt"
 * (assets/bt-vela-feed.js) that serves the session's bars up to the replay cursor only.
 *
 * replay.js / replay-engine.js stay the single source of truth for the cursor, fills and P&L; this
 * file only (1) tells Vela when the cursor moved, (2) draws order lines + markers, (3) maps the
 * old session indicators / drawings, (4) reports timeframe changes back.
 *
 *   await BtVelaChart.load();                       // scripts + import map, once
 *   RP.chart = new BtVelaChart(el, { tz, decimals, tick, symbol, theme }, { series, getCursor, spec });
 */
(function (root) {
  'use strict';
  const V = '?v=683';
  const SCRIPTS = ['chart-templates.js', 'paper-engine.js', 'bar-replay-core.js', 'chart-pine-scripts.js', 'chart-pine-guard.js', 'chart-pine-library.js'];
  let loading = null;

  function loadScript(src) {
    return new Promise((res) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s);
    });
  }
  function velaEngine() {
    let on = true;
    try {
      const q = new URLSearchParams(location.search).get('vela');
      if (q === '0.9' || q === '090') { localStorage.removeItem('stryker_vela06'); localStorage.setItem('stryker_vela090', '1'); }
      else if (q === '0.6' || q === 'off') { localStorage.setItem('stryker_vela06', '1'); localStorage.removeItem('stryker_vela090'); }
      on = localStorage.getItem('stryker_vela06') === '1' ? false : true;
    } catch (e) {}
    return on;
  }

  class BtVelaChart {
    static load() {
      if (loading) return loading;
      loading = (async () => {
        for (const f of SCRIPTS) await loadScript('/assets/' + f + V);
      })();
      return loading;
    }

    constructor(container, opts, ctx) {
      this.el = container; this.opts = Object.assign({ tz: 'America/New_York', decimals: 2, tick: 0.01, symbol: '', theme: 'dark' }, opts || {});
      this.ctx = ctx; this.ws = null; this.ready = false; this.dead = false;
      this.lines = []; this.markers = []; this.selected = null; this.tool = 'none';
      this.onTimeframe = null; this.onReady = null;
      this._last = { tf: null, cursor: null };
      this._boot();
    }

    async _boot() {
      const el = this.el;
      document.documentElement.classList.add('bt-tz');
      if (!document.getElementById('bt-vela-css')) { const l = document.createElement('link'); l.id = 'bt-vela-css'; l.rel = 'stylesheet'; l.href = '/assets/bt-vela.css' + V; document.head.appendChild(l); }
      el.classList.add('rp-chartwrap', 'bt-vela');
      el.innerHTML = '<div class="stkc-bar" id="stkc-bar" role="toolbar" aria-label="Chart toolbar"><div class="stkc-bar-l" id="stkc-bar-l"></div><div class="stkc-bar-r"></div></div>' +
        '<div class="panel stkchart-panel"><div id="vela-chart"></div><div id="stkchart-fallback" class="stkchart-fallback" hidden><p><b>The chart engine did not load.</b></p><p>Check your connection and reload. Switch back with <a href="?chart=lw">?chart=lw</a>.</p></div></div>';
      // the credits button vela-chart.js looks for (optional)
      const feedCtx = this.ctx;
      const { createBtFeed, velaTf } = await import('/assets/bt-vela-feed.js' + V);
      this.velaTf = velaTf;
      this.feed = createBtFeed(feedCtx);
      root.__stkVela090 = velaEngine();
      root.__stkBt = {
        feed: this.feed, tf: velaTf(feedCtx.tf ? feedCtx.tf() : '5m'),
        install: async (Core) => { const m = await import('/assets/chart-bt-orders.js' + V); this.orders = m.installBtOrders(Core, { bands: () => this._bands(), fmt: (p) => this.fmt(p), tick: () => this.opts.tick, onDrag: (l, p) => this.onLineDrag && this.onLineDrag(l, p), onAction: (l, a) => this.onLineAction && this.onLineAction(l, a) }); },
        onReady: (ws, api) => this._ready(ws, api)
      };
      try { await import('/assets/vela-chart.js' + V); } catch (e) { console.error('Backtest chart failed', e); const fb = el.querySelector('#stkchart-fallback'); if (fb) fb.hidden = false; }
    }

    _ready(ws, api) {
      if (this.dead) return;
      this.ws = ws; this.api = api; this.ready = true;
      try { const c = this._cell(); if (c && c.symbol !== 'bt:SESSION') c.setSymbol('bt:SESSION'); } catch (e) {}
      try { ws.setTimezone(this.opts.tz); } catch (e) {}
      try { ws.on('state:changed', () => this._tfWatch()); } catch (e) {}
      this._last = { tf: this._cellTf(), cursor: this.ctx.getCursor() };
      this.hadState = (() => { try { return !!localStorage.getItem('vela-workspace-bt-090-' + this.ctx.sessionId) || !!localStorage.getItem('vela-workspace-bt-' + this.ctx.sessionId); } catch (e) { return false; } })();
      root.__stkBtBooted = true;
      try { const m = this._main; if (m) m.chart.history && m.chart.history.onChange && m.chart.history.onChange(() => this._objectsChanged()); } catch (e) {}
      this._migrate();
      if (this.ctx.session && this.ctx.session.htfOn) this.setHtf(true, this.ctx.htfTf ? this.ctx.htfTf() : '1h'); else if (this.ws.layout.cells.length > 1) this.setHtf(false);
      this._pushOrders();
      if (this.onReady) this.onReady(this);
    }

    _cell() { return this._main; }
    _cellTf() { const c = this._cell(); return c ? String(c.timeframe) : null; }
    _tfWatch() {
      this._objectsChanged();
      const m = this._main, h = this._htfCell;
      const tf = m ? String(m.timeframe) : null;
      if (tf && tf !== this._last.tf) { this._last.tf = tf; const re = this.feedReTf(tf); if (re && this.onTimeframe) this.onTimeframe(re); }
      if (h) { const ht = String(h.timeframe); if (ht !== this._lastHtf) { this._lastHtf = ht; const re = this.feedReTf(ht); if (re && this.onHtfTf) this.onHtfTf(re); } }
    }
    feedReTf(v) { return ({ '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', 'D': '1D', 'W': '1W' })[String(v)] || null; }

    // ---- data: replay.js calls this after every cursor / timeframe change ---------------------------------
    setView(view) {
      if (!this.ready) return;
      this.view = view;
      const cursor = this.ctx.getCursor(), tf = this.velaTf(view.tf);
      const cell = this._cell(); if (!cell) return;
      const prev = this._last;
      if (String(cell.timeframe) !== tf) { this._last = { tf, cursor }; try { cell.setTimeframe(tf); } catch (e) {} this.feed.resetSent(); return; }
      if (prev.cursor != null && cursor >= prev.cursor && cursor - prev.cursor <= 400) {
        this._last = { tf, cursor };
        if (cursor !== prev.cursor) this.feed.push();
      } else {
        this._last = { tf, cursor };
        this.reload();
      }
    }
    // jump (Day / NY / resume / step back): rebuild the cell from the provider
    async reload() {
      try { this.api.mods[9].sharedBarStore && this.api.mods[9].sharedBarStore.clear(); } catch (e) {}
      for (const cell of (this.ws ? this.ws.cells() : [])) {
        try { await cell.chart.setMarket({ data: [] }); } catch (e) { console.warn('bt reload', e); }
        try { delete cell.chart.orchestrator.config.market.data; } catch (e) {}
      }
      this.feed.resetSent();
    }

    // ---- API parity with ReplayChart ----------------------------------------------------------------------
    setLines(lines) { this.lines = lines || []; this._pushOrders(); }
    setMarkers(m) { this.markers = m || []; this._pushOrders(); }
    _pushOrders() { if (!this.ready || !this.orders) return; let cells = []; try { cells = this.ws.cells(); } catch (e) {} this.orders.set(cells, this.lines, this.markers, this.opts.sessions); }
    get _main() { try { return this.ws.cells()[0]; } catch (e) { return null; } }
    get _htfCell() { try { return this.ws.cells()[1] || null; } catch (e) { return null; } }

    // ---- indicators: the Charts indicator window adds them; the object tree reads them from Vela ----------
    _handles(cell) {
      const out = []; if (!cell) return out;
      try { for (const h of cell.nativeHandles()) out.push({ h, kind: 'native', name: h.title || h.nativeType || 'Indicator' }); } catch (e) {}
      try { for (const h of (root.STRYKER_PINE ? root.STRYKER_PINE.pineHandles(cell.chart) : [])) out.push({ h, kind: 'pine', name: h.title || h.name || 'Script' }); } catch (e) {}
      return out;
    }
    get indicators() {
      return this._handles(this._main).map((x, i) => ({ iid: 'v' + i, def: { name: x.name, inputs: [] }, visible: x.h.visible !== false, params: {}, _h: x.h }));
    }
    get drawings() {
      const c = this._main; if (!c) return [];
      try { return c.chart.drawings.all().map((d) => ({ type: d.type, hidden: d.visible === false || d.hidden === true, p1: d.anchors[0] ? { t: d.anchors[0].time, price: d.anchors[0].price } : { t: 0, price: 0 }, p2: d.anchors[1] ? { t: d.anchors[1].time, price: d.anchors[1].price } : null, _id: d.id, _d: d })); } catch (e) { return []; }
    }
    getIndicators() { return this.indicators.map((i) => ({ iid: i.iid, id: i.def.name, params: {}, visible: i.visible })); }
    getDrawings() { return this.drawings.map((d) => ({ type: d.type, p1: d.p1, p2: d.p2 })); }
    addIndicator() {}
    setIndicatorParams() {}
    removeIndicator(iid) { const x = this.indicators.find((i) => i.iid === iid); if (x) { try { x._h.remove(); } catch (e) {} this._objectsChanged(); } }
    toggleIndicator(iid) { const x = this.indicators.find((i) => i.iid === iid); if (x) { try { x._h.setVisible(!x.visible); } catch (e) {} this._objectsChanged(); } }
    openIndicatorSettings() { if (this.onNotice) this.onNotice('Open the gear next to the indicator name on the chart for its settings and Style tabs.'); }
    setDrawings(d) { this.legacyDrawings = d || []; }
    removeDrawing(i) { const d = this.drawings[i]; if (d) { try { this._main.chart.drawings.remove(d._id); } catch (e) {} this._objectsChanged(); } }
    toggleDrawing(i) { const d = this.drawings[i]; if (d) { try { this._main.chart.drawings.show(d._id, d.hidden); } catch (e) {} this._objectsChanged(); } }
    selectDrawing(i) { const d = this.drawings[i]; this.selected = i; if (d) { try { this._main.chart.drawings.select(d._id); } catch (e) {} } }
    deleteSelected() { if (this.selected == null) return false; this.removeDrawing(this.selected); this.selected = null; return true; }
    clearDrawings() { const c = this._main; if (!c) return; try { for (const d of c.chart.drawings.all()) c.chart.drawings.remove(d.id); } catch (e) {} this._objectsChanged(); }
    _changed() { this._objectsChanged(); }
    setTool(t) { this.tool = t || 'none'; const m = { trend: 'trendline', ray: 'ray', hline: 'hline', rect: 'box', fib: 'fibretracement' }[t]; const c = this._main; try { c && c.chart.drawings.setTool(m || null); } catch (e) {} }
    _objectsChanged() { clearTimeout(this._objT); this._objT = setTimeout(() => { if (this.onObjectsChanged) this.onObjectsChanged(); }, 120); }

    // ---- old session -> new chart (nothing is deleted: the old fields stay in the session) ---------------------
    _migrate() {
      const s = this.ctx.session, lg = this.ctx.legacy || {}; if (!s || s.tzMigrated || this.hadState) return;
      s.tzMigrated = true; const c = this._main; if (!c) return;
      const NAT = { sma: 'sma', ema: 'ema', rsi: 'rsi', macd: 'macd', atr: 'atr', vwap: 'vwap', bb: 'bollinger-bands' };
      let skipped = [];
      for (const ind of (lg.indicators || [])) {
        const type = NAT[ind.id];
        if (!type) { skipped.push(ind.id); continue; }
        try { const h = c.chart.addNativeIndicator(type); const len = ind.params && (ind.params.len || ind.params.length); if (h && len) { try { h.setInputs({ length: len }); } catch (e) {} } } catch (e) { skipped.push(ind.id); }
      }
      const TY = { trend: 'trendline', ray: 'ray', hline: 'hline', rect: 'box', fib: 'fibretracement' };
      for (const d of (lg.drawings || [])) {
        const ty = TY[d.type]; if (!ty || !d.p1) { skipped.push(d.type); continue; }
        const an = [{ time: d.p1.t, price: d.p1.price }]; if (d.p2) an.push({ time: d.p2.t, price: d.p2.price });
        try { c.chart.drawings.add(ty, { paneId: 'price', anchors: an }) || skipped.push(d.type); } catch (e) { skipped.push(d.type); }
      }
      if (skipped.length && this.onNotice) this.onNotice('Some old items have no match on the new chart (' + [...new Set(skipped)].join(', ') + '). They are kept in this session: ?chart=lw shows them.');
    }

    // ---- higher-timeframe chart = a second Vela cell --------------------------------------------------------------
    setHtf(on, reTf) {
      if (!this.ready) return; const s = this.ctx.session; if (s) s.htfOn = !!on;
      const two = this.ws.layout.cells.length > 1;
      try {
        if (on && !two) this.ws.setLayout('2h');
        else if (!on && two) this.ws.setLayout('1');
      } catch (e) { console.warn('bt htf layout', e); }
      const h = this._htfCell;
      if (on && h) {
        const tf = this.velaTf(reTf || '1h');
        try { if (h.symbol !== 'bt:SESSION') h.setSymbol('bt:SESSION'); if (String(h.timeframe) !== tf) h.setTimeframe(tf); } catch (e) {}
      }
      this.feed.resetSent(); setTimeout(() => { this._pushOrders(); this.resize(); }, 150);
    }

    _bands() {
      const RT = root.ReplayTime, s = this.ctx.series, out = [];
      if (!RT || !s || !s.base || (this.view && this.view.tfMs > 3600000)) return out;
      const SES = { ny: { tz: 'America/New_York', from: 570, to: 960, color: 'rgba(3,201,136,0.06)' }, ldn: { tz: 'Europe/London', from: 480, to: 990, color: 'rgba(0,173,181,0.06)' } };
      const key = Object.keys(SES).filter((k) => this.opts.sessions && this.opts.sessions[k]).join();
      if (this._bandKey !== key || !this._bandAll) {
        this._bandKey = key; this._bandAll = [];
        for (const k of key ? key.split(',') : []) {
          const d = SES[k]; let st = null, last = null;
          for (const b of s.base) { const q = RT.parts(d.tz, b.t); const inS = !q.weekend && q.min >= d.from && q.min < d.to; if (inS && st == null) st = b.t; if (!inS && st != null) { this._bandAll.push({ t0: st, t1: last, color: d.color }); st = null; } last = b.t; }
          if (st != null) this._bandAll.push({ t0: st, t1: last, color: d.color });
        }
      }
      const cur = s.base[this.ctx.getCursor()]; const ct = cur ? cur.t : 0;
      for (const b of this._bandAll) { if (b.t0 > ct) break; out.push(b.t1 > ct ? { t0: b.t0, t1: ct, color: b.color } : b); }
      return out;
    }
    scrollToEnd() { const c = this._main; try { c && c.chart.scrollToRealTime && c.chart.scrollToRealTime(); } catch (e) {} }
    zoom() {}
    setOptions(o) { o = o || {}; if (o.sessions) { this.opts.sessions = Object.assign({}, this.opts.sessions, o.sessions); this._bandAll = null; } if (o.tz) this.opts.tz = o.tz; if (this.ready && o.tz) { try { this.ws.setTimezone(o.tz); } catch (e) {} } this._pushOrders(); }
    resize() { try { root.dispatchEvent(new Event('resize')); } catch (e) {} }
    snap(p) { const t = this.opts.tick; return t ? Math.round(p / t) * t : p; }
    fmt(p) { return Number(p).toFixed(this.opts.decimals); }
    screenshot() { try { return this.ws.screenshot(); } catch (e) { return null; } }
    destroy() { this.dead = true; document.documentElement.classList.remove('bt-tz'); try { this.ws && this.ws.destroy(); } catch (e) {} this.ws = null; this.el.innerHTML = ''; root.__stkBt = null; }
  }

  root.BtVelaChart = BtVelaChart;
})(window);
