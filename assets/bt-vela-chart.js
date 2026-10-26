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
  const V = '?v=681';
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
      this.lines = []; this.markers = []; this.drawings = []; this.indicators = []; this.selected = null; this.tool = 'none';
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
        install: async (Core) => { const m = await import('/assets/chart-bt-orders.js' + V); this.orders = m.installBtOrders(Core, { fmt: (p) => this.fmt(p), tick: () => this.opts.tick, onDrag: (l, p) => this.onLineDrag && this.onLineDrag(l, p), onAction: (l, a) => this.onLineAction && this.onLineAction(l, a) }); },
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
      this._pushOrders();
      if (this.onReady) this.onReady(this);
    }

    _cell() { try { return this.ws.active || this.ws.cells()[0]; } catch (e) { return null; } }
    _cellTf() { const c = this._cell(); return c ? String(c.timeframe) : null; }
    _tfWatch() {
      const tf = this._cellTf(); if (!tf || tf === this._last.tf) return;
      this._last.tf = tf;
      const re = this.feedReTf(tf);
      if (re && this.onTimeframe) this.onTimeframe(re);
    }
    feedReTf(v) { return ({ '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', 'D': '1D', 'W': '1W' })[String(v)] || null; }

    // ---- data: replay.js calls this after every cursor / timeframe change ---------------------------------
    setView(view) {
      if (!this.ready) return;
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
      const cell = this._cell(); if (!cell) return;
      try { this.api.mods[9].sharedBarStore && this.api.mods[9].sharedBarStore.clear(); } catch (e) {}
      try { await cell.chart.setMarket({ data: [] }); } catch (e) { console.warn('bt reload', e); }
      try { delete cell.chart.orchestrator.config.market.data; } catch (e) {}
      this.feed.resetSent();
    }

    // ---- API parity with ReplayChart (filled in by the next steps) -------------------------------------------
    setLines(lines) { this.lines = lines || []; this._pushOrders(); }
    setMarkers(m) { this.markers = m || []; this._pushOrders(); }
    _pushOrders() { if (!this.ready || !this.orders) return; let cells = []; try { cells = this.ws.cells(); } catch (e) {} this.orders.set(cells, this.lines, this.markers); }
    setDrawings(d) { this.drawings = d || []; }
    getDrawings() { return this.drawings; }
    getIndicators() { return this.indicators.map((i) => ({ iid: i.iid, id: i.id, params: i.params, visible: i.visible })); }
    addIndicator() {} removeIndicator() {} toggleIndicator() {} setIndicatorParams() {}
    setTool(t) { this.tool = t || 'none'; }
    deleteSelected() { return false; } clearDrawings() {} removeDrawing() {} toggleDrawing() {} selectDrawing() {} _changed() {}
    scrollToEnd() { const c = this._cell(); try { c && c.chart.scrollToRealTime && c.chart.scrollToRealTime(); } catch (e) {} }
    zoom() {}
    setOptions(o) { Object.assign(this.opts, o || {}); if (this.ready && o && o.tz) { try { this.ws.setTimezone(o.tz); } catch (e) {} } }
    resize() { try { root.dispatchEvent(new Event('resize')); } catch (e) {} }
    snap(p) { const t = this.opts.tick; return t ? Math.round(p / t) * t : p; }
    fmt(p) { return Number(p).toFixed(this.opts.decimals); }
    screenshot() { try { return this.ws.screenshot(); } catch (e) { return null; } }
    destroy() { this.dead = true; document.documentElement.classList.remove('bt-tz'); try { this.ws && this.ws.destroy(); } catch (e) {} this.ws = null; this.el.innerHTML = ''; root.__stkBt = null; }
  }

  root.BtVelaChart = BtVelaChart;
})(window);
