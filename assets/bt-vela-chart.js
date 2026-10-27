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
  const V = '?v=694';
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
      if (!document.getElementById('bt-phone-js')) { const s = document.createElement('script'); s.id = 'bt-phone-js'; s.src = '/assets/bt-phone.js' + V; document.head.appendChild(s); }
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
      this._wireLabels(); this._wireToasts();
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
      if (skipped.length) this._migrateNotice([...new Set(skipped)]);
    }

    // plain-words notice for old-session items with no match: once per session, top of the plot, 6 s
    _migrateNotice(ids) {
      const N = { killzones: 'Killzones', sesshl: 'Session highs and lows', pdhl: 'Previous day and week highs and lows', orb: 'Opening range', fvg: 'Fair value gaps', ob: 'Order blocks', swings: 'Swing points', liq: 'Liquidity levels', supertrend: 'Supertrend', wma: 'Weighted MA', stoch: 'Stochastic', volma: 'Volume MA', text: 'Text notes', arrow: 'Arrows' };
      const names = ids.map((x) => N[x] || String(x).replace(/^./, (c) => c.toUpperCase()));
      const list = names.length > 2 ? names.slice(0, 2).join(', ') + ' and more' : names.join(' and ');
      const key = 'bt_tz_notice_' + (this.ctx.sessionId || 'x');
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) {}
      const show = () => {
        const host = document.getElementById('rp-chart-main'); if (!host) return;
        const old = document.getElementById('bt-oldnote'); if (old) old.remove();
        const el = document.createElement('div'); el.id = 'bt-oldnote'; el.className = 'bt-oldnote'; el.setAttribute('role', 'status');
        el.innerHTML = '<span></span><a href="#">Open old chart</a><button type="button" aria-label="Dismiss">\u2715</button>';
        el.querySelector('span').textContent = list + " from this session aren't" + ' on the new chart yet. Your session is safe.';
        const u = new URL(location.href); u.searchParams.set('chart', 'lw');
        el.querySelector('a').href = u.toString();
        el.querySelector('button').addEventListener('click', () => el.remove());
        document.body.appendChild(el); setTimeout(() => el.remove(), 6000);
      };
      setTimeout(show, 1200);
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
    // ---- real market + day instead of "SESSION · BT" (legend, watermark, symbol button) ---------------------------
    _name() {
      const sp = this.ctx.spec || {}; const root = String(sp.label || sp.symbol || 'Session').split(' \u00b7 ')[0].trim();
      let day = ''; try { const s = this.ctx.series; const t0 = (this.ctx.session && this.ctx.session.startMs) || (s && s.base && s.base[0] && s.base[0].t); if (t0) day = new Date(t0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); } catch (e) {}
      return { root, day };
    }
    _relabel() {
      const { root, day } = this._name(); const host = document.getElementById('vela-chart'); const bar = document.getElementById('stkc-bar');
      const fix = (el, fn) => { if (!el) return; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const v = fn(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } };
      const sub = (s) => s.replace(/SESSION/g, root).replace(/\bBT\b/g, day || 'Backtest');
      const wm = (s) => s.replace(/SESSION/g, root).replace(/(\d+[mhDW])\s*$/, (m) => m + (day ? ' \u00b7 ' + day : ''));
      if (host) { host.querySelectorAll('.vela-sl-symbol, .vela-sl-meta, .vela-widget-symbol').forEach((e) => fix(e, sub)); host.querySelectorAll('.vela-watermark').forEach((e) => fix(e, (s) => (/\u00b7 [A-Z][a-z]{2} \d/.test(s) ? s.replace(/SESSION/g, root) : wm(s)))); }
      if (bar) bar.querySelectorAll('.vela-mb-symbol').forEach((e) => fix(e, sub));
      // legend avatar: initials of the market ("NQ"), not of SESSION ("SE")
      const ini = root.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
      document.querySelectorAll('#rp-chart-main span, #rp-chart-main div').forEach((e) => { if (!e.children.length && e.textContent === 'SE' && /icon|avatar|badge/i.test(e.className.toString())) e.textContent = ini; });
    }
    _symbolInfo() {
      const sp = this.ctx.spec || {}, { root, day } = this._name(); let a = '', z = '';
      try { const s = this.ctx.series; const b = s && s.base; if (b && b.length) { const f = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }); a = f(b[0].t); z = f(b[b.length - 1].t); } } catch (e) {}
      const src = sp.src === 'yahoo' ? 'Yahoo Finance, 1-minute bars' : (sp.src || 'session data');
      return { title: root + ' \u00b7 ' + (sp.label || '').split(' \u00b7 ').slice(1).join(' \u00b7 '), rows: [['Market', sp.label || root], ['Session day', day], ['Data window', a && z ? a + ' \u2192 ' + z : '-'], ['Data source', src], ['Mode', 'Backtest (simulated, no real orders)']] };
    }
    _showInfo() {
      const i = this._symbolInfo(); let el = document.getElementById('bt-syminfo'); if (el) el.remove();
      el = document.createElement('div'); el.id = 'bt-syminfo'; el.className = 'bt-syminfo'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Session info');
      el.innerHTML = '<div class="bt-syminfo-card"><div class="bt-syminfo-h"><b></b><button type="button" aria-label="Close">\u2715</button></div><dl></dl><p>The market is fixed by this session. Start a new session to change it.</p></div>';
      el.querySelector('b').textContent = i.title;
      el.querySelector('dl').innerHTML = i.rows.map((r) => '<dt>' + r[0] + '</dt><dd></dd>').join('');
      el.querySelectorAll('dd').forEach((d, k) => { d.textContent = i.rows[k][1]; });
      const close = () => el.remove(); el.addEventListener('click', (e) => { if (e.target === el) close(); }); el.querySelector('button').addEventListener('click', close);
      document.body.appendChild(el);
    }
    _wireToasts() {
      const hostEl = () => document.getElementById('stryker-toast-host'); if (this._toastMo) return;
      const watch = () => { const h = hostEl(); if (!h) return false; this._toastMo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) setTimeout(() => { const x = n.querySelector('.toast-close'); if (x) x.click(); }, 2500); }))); this._toastMo.observe(h, { childList: true }); return true; };
      if (!watch()) { const iv = setInterval(() => { if (watch()) clearInterval(iv); }, 500); setTimeout(() => clearInterval(iv), 15000); }
    }
    _wireLabels() {
      const host = document.getElementById('vela-chart'); if (!host) return;
      let t = null; const run = () => { t = null; this._relabel(); };
      this._mo = new MutationObserver(() => { if (!t) t = setTimeout(run, 30); });
      this._mo.observe(document.getElementById('rp-chart-main') || host, { subtree: true, childList: true, characterData: true });
      this._relabel();
      // tapping the symbol shows the session info (the market is fixed): capture before Vela opens Symbol Search
      document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.vela-mb-symbol, .vela-widget-symbol, .vela-sl-symbol'); if (!t || !document.getElementById('rp-chart-main').contains(t) && !document.getElementById('stkc-bar').contains(t)) return; e.preventDefault(); e.stopImmediatePropagation(); this._showInfo(); }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const x = document.getElementById('bt-syminfo'); if (x) x.remove(); } });
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
