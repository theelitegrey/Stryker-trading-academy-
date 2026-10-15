// TradeZoro — Charts (charts.html) — loaded as <script type="module">
// Depends on: the shared page shell (login gate); assets/chart-templates.js
// (saved templates store, window.StrykerChartTemplates); assets/toast.js.
//
// A full charting workspace powered by Vela (github.com/LuxAlgo/Vela,
// Apache-2.0). The workspace UI lives in the package's ES-module build (the
// global script bundle carries only the headless core), so this imports
// dist/workspace.js and the three data providers from jsDelivr, pinned to an
// exact version. Vela's providers stream free public crypto data from
// Binance, Coinbase and Hyperliquid — no API keys. CME-group futures (NQ, ES,
// CL, GC ...) come from our own provider, assets/chart-futures-provider.js,
// backed by /api/chart/bars (continuous front-month bars from Yahoo Finance,
// edge-cached; polled, not streamed — never describe it as live/real-time; the
// legend's amber data dot, assets/chart-data-dot.js, says "Delayed data").
//
// SRI (P3-4 audit): these load via dynamic import(), which has no
// integrity="" attribute to set (that only exists on <script> tags and on
// <link rel="modulepreload">, and browsers don't check it for import()
// resolution). Left pinned-only — VELA_BASE below is already locked to an
// exact version, never a moving tag.
//
// ATTRIBUTION (Owner order 2026-10-05): the on-chart logomark is turned off
// (renderer default `attribution: false`). Vela's NOTICE allows that ONLY
// because an equivalent attribution — the name "Vela" plus a link to
// https://luxalgo.com/vela — stays on the same page: the (i) Credits popover
// in the chart toolbar (#stkc-credits, charts.html), which also links the
// NOTICE copy in assets/vendor/VELA-NOTICE.txt. Never remove that popover
// without turning the mark back on.
//
// MULTI-CHART: TradingView-style grid picker + "Sync in layout" switches live in
// assets/chart-grid.js (1 to 8 charts on desktop, 4 on tablets/phones); Vela's
// built-in picker (which goes up to 4x4) is dropped from its topbar, and
// maxWebglCells keeps every cell on WebGL only up to 4. Phones show one chart at a
// time (the cell switcher maximizes the active cell over the grid).
//
// persist:true keeps the student's symbol, drawings, indicators and layout in
// localStorage, so the workspace reopens the way they left it. A DEFAULT
// template only applies when there was no saved session at page load (or when
// the member picks it from the Templates menu).
//
// PINE SCRIPT (phase 3): assets/chart-pine.js wires LuxAlgo's AGPL vela-pinets engine
// (loaded unmodified from jsDelivr, lazily) and draws the Pine editor; Pine indicators
// ride the workspace document under ext 'stryker.pine', so persist and templates keep them.
//
// INDICATOR WINDOW: assets/chart-indicator-window.js takes over ws.indicatorPicker (the
// topbar Indicators button and "/") with the TradingView-style window: Favorites, My scripts,
// Technicals by category, Editors' picks / Top / Trending, boosts, stars.
//
// GEX LEVELS: assets/chart-gex-levels.js registers the "TradeZoro GEX Levels" native (call wall,
// put wall, zero gamma from /api/gex/levels) at the top of the indicator window's TradeZoro group.
//
// VOLUME & ORDER FLOW: assets/chart-orderflow.js registers the volume-profile / VWAP /
// relative-volume / order-flow natives and puts them in a "Volume & Order flow" group at the
// top of the Indicators picker; their settings ride the document under ext 'stryker.volume'.

// CANDLE LOOK (Owner order 2026-10-05: "same aesthetics as TradingView"):
// Vela is self-hosted from assets/vendor/vela-0.6.17-s3/ — the unmodified
// 0.6.17 ESM build (Apache-2.0, LICENSE + NOTICE in that folder) with ONE
// patched file, chunk-YCD72KGK.js, marked "TradeZoro patch": 1-device-px wicks
// (Vela drew 1.5 px) and TradingView's body-width curve (~80% of the bar
// spacing, 3 px floor, collapsing to a 1 px stick when zoomed far out), plus
// TV-like dark/light theme defaults (#0f0f0f / white, faint grid, TV font
// stack). Candle colours were already TV's (#089981 / #F23645). s2 adds the
// settings-window hooks (margins, 12h time, weekday, previous-close colouring;
// see CHANGES.md there). The chunk files carry no ?v=, so any further patch
// goes in a NEW folder (-s3) and
// the charts.html import map ("@luxalgo/vela/plugin") must move with it, or
// the Pine engine gets a second copy of Vela's registries.
const VELA_BASE = './vendor/vela-0.6.17-s3/';
// One-time migration for members whose saved workspace still carries the old
// Vela theme defaults (see migrateTvLook below).
const TV_LOOK_KEY = 'stryker_chart_tv_look';
const TV_LOOK_VER = '1';
const PERSIST_KEY = 'vela-workspace';
const PHONE_MAX = 700;

function velaFail(){
  const fb = document.getElementById('stkchart-fallback');
  if (fb) fb.hidden = false;
}

// ---- full-height sizing: header and phone dock are measured, not guessed ----
function measureFrame(){
  const root = document.documentElement;
  const head = document.querySelector('.mobile-topnav');
  const dock = document.getElementById('appnav-dock');
  const top = head && head.getClientRects().length ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0;
  let dockH = 0;
  if (dock && getComputedStyle(dock).display !== 'none' && getComputedStyle(dock).position === 'fixed') {
    dockH = Math.round(dock.getBoundingClientRect().height);
  }
  root.style.setProperty('--stkc-top', top + 'px');
  root.style.setProperty('--stkc-dock', dockH + 'px');
}
measureFrame();
window.addEventListener('resize', measureFrame, { passive: true });
window.addEventListener('load', measureFrame);
document.addEventListener('DOMContentLoaded', measureFrame);
setTimeout(measureFrame, 1500);
setTimeout(measureFrame, 4000);

// ---- tiny popover helper (toolbar menus + credits) ----
const pops = [];
function bindPopover(btn, pop, onOpen){
  const set = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && onOpen) onOpen();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pops.forEach((p) => { if (p.pop !== pop) p.set(false); });
    set(open);
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  pops.push({ pop, set });
  return set;
}
document.addEventListener('click', () => pops.forEach((p) => { if (!p.pop.hidden) p.set(false); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pops.forEach((p) => { if (!p.pop.hidden) p.set(false); }); });

const credBtn = document.getElementById('stkc-credits-btn');
const credPop = document.getElementById('stkc-credits');
if (credBtn && credPop) bindPopover(credBtn, credPop);

function el(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}

const icon = (inner) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
// Saved workspaces snapshot every cosmetic value, so the new TV-like theme
// defaults would never reach a returning member. Once (versioned flag), swap
// ONLY values that still equal Vela's old stock defaults; anything a member
// picked themselves is left alone, and later changes are never touched again.
function migrateTvLook(){
  try {
    if (localStorage.getItem(TV_LOOK_KEY) === TV_LOOK_VER) return;
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
      const swap = (obj, key, map) => { if (obj && typeof obj[key] === 'string' && Object.prototype.hasOwnProperty.call(map, obj[key].toLowerCase())) obj[key] = map[obj[key].toLowerCase()]; };
      (st.charts || []).forEach((c) => {
        const rc = c && c.rendererConfig;
        if (!rc) return;
        const dark = !rc.layout || String(rc.layout.background).toLowerCase() !== '#ffffff';
        swap(rc.layout, 'background', { '#151619': '#0f0f0f' });
        swap(rc.layout, 'fontFamily', { 'sans-serif': FONT });
        const grid = dark ? { '#20222c': '#1c1c1c' } : { '#cccccc': '#f0f3fa' };
        const border = dark ? { '#2a2b30': '#2a2a2a' } : { '#d4dae3': '#e0e3eb' };
        if (rc.grid) { swap(rc.grid.vertLines, 'color', grid); swap(rc.grid.horzLines, 'color', grid); }
        swap(rc.priceScale, 'borderColor', border);
        swap(rc.panes, 'separatorColor', border);
      });
      localStorage.setItem(PERSIST_KEY, JSON.stringify(st));
    }
    localStorage.setItem(TV_LOOK_KEY, TV_LOOK_VER);
  } catch (e) { console.warn('TradeZoro: chart look migration', e); }
}

// toast.js signature is showToast(type, message).
const toast = (m, type) => { try { if (window.showToast) window.showToast(type || 'success', m); } catch (e) {} };

(async () => {
  const host = document.getElementById('vela-chart');
  if (!host) return;

  // FIRST CHART FASTER (2026-10-14): the bars for the chart(s) the member will see are requested NOW,
  // in parallel with the module downloads and the login gate, instead of after the workspace boots
  // (live 537: gate cleared 2.9 s, bars requested 3.6 s, candles 4.7 s). They land in the shared
  // page memo of assets/chart-futures-provider.js, which the chart reads when it starts. Symbols and
  // timeframes come from the saved workspace (any object with a string symbol + timeframe), else
  // the default NQ1! 15m. Futures/forex only; anything else is ignored by prefetchBars.
  try {
    const want = [];
    try {
      const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 6 || want.length >= 8) return;
        if (typeof o.symbol === 'string' && o.timeframe != null) want.push([o.symbol, String(o.timeframe)]);
        for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1);
      };
      walk(JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null'), 0);
    } catch (e) {}
    if (!want.length) want.push(['futures:NQ1!', '15']);
    import('./chart-futures-provider.js?v=566')
      .then((m) => { if (m.prefetchBars) want.slice(0, 4).forEach(([s, tf]) => m.prefetchBars(s, tf)); })
      .catch(() => {});
  } catch (e) {}

  // LAZY HEAVY MODULES (2026-10-15): order flow (130 KB), footprint, GEX levels / heatmap and Expected Move
  // are not needed to paint the first candles. They download in parallel (modulepreload) but are
  // evaluated + installed after the first chart paints. A saved session / template / tick interval that
  // uses them (state mentions stk_*, stryker.volume or a tick/second interval) still installs them
  // BEFORE boot, exactly as before, so nothing restores half-empty.
  const HEAVY_URLS = ['orderflow', 'gex-levels', 'gex-heatmap', 'expected-move', 'footprint'].map((n) => './chart-' + n + '.js?v=566');
  let heavyNeeded = false;
  try {
    heavyNeeded = !!localStorage.getItem('stryker.volume');
    if (!heavyNeeded) for (let i = 0; i < localStorage.length && !heavyNeeded; i++) {
      const v = localStorage.getItem(localStorage.key(i)) || '';
      if (v.length < 3e6 && /stk_|stryker\.volume|"\d+[TtSs]"/.test(v)) heavyNeeded = true;
    }
  } catch (e) { heavyNeeded = true; }

  let mods;
  try {
    mods = await Promise.all([
      import(VELA_BASE + 'workspace.js'),
      import(VELA_BASE + 'providers/binance.js'),
      import(VELA_BASE + 'providers/coinbase.js'),
      import(VELA_BASE + 'providers/hyperliquid.js'),
      import('./chart-futures-provider.js?v=566'),
      import(VELA_BASE + 'index.js'),
      import('./chart-pine.js?v=566'),
      Promise.resolve(null),
      import('./chart-settings.js?v=566'),
      import(VELA_BASE + 'chunk-YCD72KGK.js'),
      import('./chart-grid.js?v=566'),
      import('./chart-alerts.js?v=566'),
      import('./chart-events.js?v=566'),
      import('./chart-intervals.js?v=566'),
      Promise.resolve(null),
      import('./chart-legend-rows.js?v=566'),
      import('./chart-paper.js?v=566'),
      import('./chart-bar-replay.js?v=566'),
      import('./chart-tick-boost.js?v=566'),
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
      import('./chart-tool-icons.js?v=566'),
      import(VELA_BASE + 'chunk-IFJJPXSV.js')
    ]);
  } catch (err) {
    console.error('TradeZoro: Vela modules failed to load', err);
    velaFail();
    return;
  }

  // eslint-disable-next-line
  const loadHeavy = () => Promise.all(HEAVY_URLS.map((u) => import(u)));
  if (heavyNeeded) { try { const h = await loadHeavy(); mods[7] = h[0]; mods[14] = h[1]; mods[19] = h[2]; mods[20] = h[3]; mods[21] = h[4]; } catch (err) { console.error('TradeZoro: Vela modules failed to load', err); velaFail(); return; } }
  const W = mods[0];
  const VelaWorkspace = W.VelaWorkspace;
  // Binance candles follow every trade (aggTrade), not just the ~1 s kline push: assets/chart-tick-boost.js.
  let BinanceProvider = mods[1].BinanceProvider;
  try { BinanceProvider = mods[18].boostBinance(BinanceProvider); } catch (e) { console.warn('TradeZoro: tick boost', e); }
  const CoinbaseProvider = mods[2].CoinbaseProvider;
  const HyperliquidProvider = mods[3].HyperliquidProvider;
  const FuturesProvider = mods[4].FuturesProvider;
  const FxProvider = mods[4].FxProvider;
  const COMMODITY_ROOTS = mods[4].COMMODITY_ROOTS || [];
  let Flow, Gex, GexHeat;
  const Core = mods[5];
  const Pine = mods[6];
  const Settings = mods[8];
  const Grid = mods[10];
  const Alerts = mods[11];
  const Events = mods[12];
  const Iv = mods[13];
  // Every TradeZoro overlay/native that lacks its own emitted model gets a legend row (eye / cog / ×)
  // through one path (assets/chart-legend-rows.js). Keep order-flow on raw Core to avoid repaint risk.
  const LCore = mods[15].legendCore(Core, () => ws);
  const Paper = mods[16];
  // BAR REPLAY (Owner order 2026-10-12): the outermost provider wrapper + toolbar + control bar
  // (assets/chart-bar-replay.js). A pass-through while replay is off.
  const Replay = mods[17];
  // Tick bars (and seconds where a venue has no 1-second candles) are built from the same trade
  // sources the order-flow tools use.

  // Logomark off — the Credits popover carries the attribution (see header).
  try { Core.registerRendererDefaults({ attribution: false }); } catch (e) { console.warn('TradeZoro: attribution default', e); }

  // Grid shapes (1 to 8 charts, assets/chart-grid.js) are registered before boot so a
  // persisted / template / saved-layout state that uses one resolves.
  let ws;
  try { W.registerBuiltinLayouts(); Grid.installGrid(W, Core, () => ws); } catch (e) { console.warn('TradeZoro: layout register', e); }

  // Pine Script (assets/chart-pine.js): its persistence handler must be registered
  // before the workspace restores a saved session. The engine itself loads lazily.
  try { Pine.installPine(Core, () => ws); } catch (e) { console.warn('TradeZoro: Pine install', e); }
  // Install of the lazy-heavy modules (see HEAVY_URLS): before boot when the saved state needs them, else after the first paint.
  const installHeavy = () => {
    Flow = mods[7]; Gex = mods[14]; GexHeat = mods[19];
    // Tick bars (and seconds where a venue has no 1-second candles) are built from the same trade
    // sources the order-flow tools use.
    try { Iv.useTrades(Flow); } catch (e) { console.warn('TradeZoro: interval trades', e); }
  // Volume & order-flow tools (assets/chart-orderflow.js): registered before boot too, so a
  // saved session or template that carries them restores.
  try { Flow.installOrderflow(Core); } catch (e) { console.warn('TradeZoro: volume tools install', e); }
  // Order flow from exchange trades (assets/chart-footprint.js): the Footprint chart type + the
  // "Order Flow" indicators. Registered before boot so a saved session or template restores them.
  try { mods[21].installFootprint(Core, Flow); } catch (e) { console.warn('TradeZoro: order flow install', e); }
  // TradeZoro GEX Levels (assets/chart-gex-levels.js): registered before boot so a saved session restores it.
  try { Gex.installGexLevels(LCore); } catch (e) { console.warn('TradeZoro: GEX levels install', e); }
  // TradeZoro GEX Heatmap (assets/chart-gex-heatmap.js): net GEX by strike over time, behind the candles.
  try { GexHeat.installGexHeatmap(LCore); } catch (e) { console.warn('TradeZoro: GEX heatmap install', e); }
  // Expected Move (options ATM straddle range; assets/chart-expected-move.js), same plug-in path as GEX.
  try { mods[20].installExpectedMove(LCore); } catch (e) { console.warn('TradeZoro: expected move install', e); }
  };
  if (heavyNeeded) installHeavy();
  // News markers + Economic events natives (assets/chart-news-markers.js, Pro): registered before boot too.
  try { (await import('./chart-news-markers.js?v=566')).installNewsMarkers(LCore); } catch (e) { console.warn('TradeZoro: news markers install', e); }
  // Settings window (assets/chart-settings.js): its per-cell state handler registers before boot too.
  try { Alerts.installChartAlerts(Core); } catch (e) { console.warn('TradeZoro: alerts install', e); }
  try { Events.installChartEvents(Core); } catch (e) { console.warn('TradeZoro: events install', e); }
  try { Settings.installChartSettings(Core, mods[9]); } catch (e) { console.warn('TradeZoro: settings install', e); }
  // ONE icon set for every drawing tool (Owner order 2026-10-14, TradingView look): the column,
  // its flyouts, the phone sheet, the object tree and the favourites bar all read these; plus
  // separate Long / Short Position tools (assets/chart-tool-icons.js). Before the workspace is built.
  const ToolIcons = mods[22];
  try {
    const miss = ToolIcons.installToolIcons(Core, mods[23].PositionTool);
    if (miss.length) console.warn('TradeZoro: drawing tools without an icon', miss);
  } catch (e) { console.warn('TradeZoro: tool icons', e); }
  // Paper trading (assets/chart-paper.js): its on-chart line layer + right-click items register before boot.
  try { Paper.installPaper(Core); } catch (e) { console.warn('TradeZoro: paper install', e); }

  let day = false;
  try { day = localStorage.getItem('stryker_theme') === 'day'; } catch (e) {}
  migrateTvLook();
  let hadSession = false;
  try { hadSession = !!localStorage.getItem(PERSIST_KEY); } catch (e) {}

  // The page shell starts as .gate-pending (visibility:hidden) until the
  // login gate resolves. Boot the chart only after that clears (or after a
  // few seconds regardless), then two frames later, so Vela measures the
  // page's final layout instead of a mid-boot one.
  await new Promise((resolve) => {
    const shell = document.querySelector('.dash-shell');
    if (!shell || !shell.classList.contains('gate-pending')) { resolve(); return; }
    const done = () => { obs.disconnect(); clearTimeout(cap); resolve(); };
    const obs = new MutationObserver(() => {
      if (!shell.classList.contains('gate-pending')) done();
    });
    obs.observe(shell, { attributes: true, attributeFilter: ['class'] });
    const cap = setTimeout(done, 6000);
  });
  measureFrame();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Charts phase 4 (Rithmic, assets/rithmic-config.js): behind a flag that is OFF for every
  // member today. When off, rith stays null, nothing else loads and the chart is unchanged.
  let rith = null;
  try { rith = await (await import('./rithmic-config.js?v=566')).loadRithmicIfEnabled(); }
  catch (e) { console.warn('TradeZoro: Rithmic module', e); rith = null; }

  try {
    ws = window.STRYKER_VELA = new VelaWorkspace('#vela-chart', {
      layout: '1',
      symbol: 'futures:NQ1!',
      timeframe: '15',
      // Seeds for the extra cells when a member widens the grid.
      cells: {
        A: { symbol: 'futures:NQ1!', timeframe: '15' },
        B: { symbol: 'futures:ES1!', timeframe: '15' },
        C: { symbol: 'futures:GC1!', timeframe: '15' },
        D: { symbol: 'futures:CL1!', timeframe: '15' },
        E: { symbol: 'futures:YM1!', timeframe: '15' },
        F: { symbol: 'futures:RTY1!', timeframe: '15' },
        G: { symbol: 'futures:SI1!', timeframe: '15' },
        H: { symbol: 'binance:BTCUSDT', timeframe: '15' }
      },
      maxWebglCells: 4,
      // Vela's own layout dropdown offers grids up to 4x4; ours (assets/chart-grid.js)
      // caps at 8 on desktop and 4 on tablets / phones.
      topbar: { left: ['symbol', 'timeframes', 'style', 'indicators', 'actions', 'undo-redo'], right: ['actions', 'alerts', 'panels', 'screenshot'] },
      live: true,
      theme: day ? 'light' : 'dark',
      providers: {
        // Iv.wrapFactory (assets/chart-intervals.js) builds the intervals a source does not
        // serve natively (futures 2m/3m/10m/45m/3h, 3M/6M/12M everywhere) from a smaller one.
        futures: Replay.wrapFactory(Iv.wrapFactory(rith ? rith.providerFactory(FuturesProvider) : () => new FuturesProvider(), 'futures'), 'futures'),
        binance: Replay.wrapFactory(Iv.wrapFactory(() => new BinanceProvider(), 'binance'), 'binance'),
        coinbase: Replay.wrapFactory(Iv.wrapFactory(() => new CoinbaseProvider(), 'coinbase'), 'coinbase'),
        hyperliquid: Replay.wrapFactory(Iv.wrapFactory(() => new HyperliquidProvider(), 'hyperliquid'), 'hyperliquid'),
        // Spot forex pairs (same /api/chart/bars endpoint, Yahoo "=X" series, delayed).
        fx: Replay.wrapFactory(Iv.wrapFactory(() => new FxProvider(), 'fx'), 'fx')
      },
      persist: true
    });
  } catch (err) {
    console.error('TradeZoro: Vela failed to start', err);
    velaFail();
    return;
  }

  try { ToolIcons.addShortToToolbar(ws, Core); } catch (e) { console.warn('TradeZoro: short position tool', e); }

  // Symbol search "Commodities" tab: Vela files a row there only when its type is "commodity",
  // and our metals/energy contracts are typed "futures" (so they also stay in the Futures tab).
  // While that tab is open the picker's pool gets type-"commodity" copies of those rows (same
  // ticker + venue, so picking one opens the same futures symbol). No vendor patch.
  try {
    const sp = ws.symbolPicker;
    if (sp && typeof sp.pool === 'function' && COMMODITY_ROOTS.length) {
      const basePool = sp.pool.bind(sp);
      const isCmd = (d) => d && String(d.type || '').toLowerCase() === 'futures' && COMMODITY_ROOTS.includes(String(d.ticker || '').toUpperCase().replace(/1!$/, ''));
      sp.pool = () => {
        const pool = basePool();
        return sp.activeTab === 'Commodities' ? pool.map((d) => (isCmd(d) ? Object.assign({}, d, { type: 'commodity' }) : d)) : pool;
      };
    }
  } catch (e) { console.warn('TradeZoro: commodities tab', e); }

  const cellCount = () => { try { return ws.layout.cells.length; } catch (e) { return 1; } };
  const currentTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const liveCells = () => { try { return ws.context().cells; } catch (e) { return []; } };

  // ---------------- prefetch (Owner order 2026-10-14: symbol switch under 1 s) ----------------
  // Warms the shared bars memo in assets/chart-futures-provider.js (prefetchBars) so a switch paints
  // from memory: a watchlist or symbol-search row the pointer rests on for 120 ms, and at idle the
  // Owner's contracts + the first watchlist rows at the active chart's timeframe (again whenever the
  // timeframe changes). Futures and forex only, a handful of small edge-cached GETs, sequential.
  try {
    const prefetchBars = mods[4].prefetchBars;
    if (typeof prefetchBars === 'function') {
      const activeTf = () => { try { return String(ws.chart.market.timeframe || '15'); } catch (e) { return '15'; } };
      let hoverT = null;
      document.addEventListener('pointerover', (e) => {
        const row = e.target && e.target.closest && e.target.closest('.stkw-row[data-sym], .vela-sp-row[data-ticker]');
        if (!row) return;
        clearTimeout(hoverT);
        hoverT = setTimeout(() => prefetchBars(row.dataset.sym || row.dataset.ticker, activeTf()), 120);
      }, { passive: true });
      const OWNER = ['NQ1!', 'ES1!', 'YM1!', 'GC1!', 'SI1!', 'CL1!', 'MNQ1!', 'MES1!', 'MYM1!', 'MGC1!', 'MCL1!'];
      const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
      let warmedTf = null, warming = false;
      const warm = () => {
        const tf = activeTf();
        if (warming || tf === warmedTf || document.hidden || (navigator.connection && navigator.connection.saveData)) return;
        warming = true; warmedTf = tf;
        const list = OWNER.slice();
        document.querySelectorAll('.stkw-row[data-sym]').forEach((r, i) => { if (i < 12) list.push(r.dataset.sym); });
        (async () => { for (const s of list) { if (activeTf() !== tf) break; await prefetchBars(s, tf); } })()
          .finally(() => { warming = false; });
      };
      setTimeout(() => idle(warm), 3000);
      setInterval(() => { if (activeTf() !== warmedTf) idle(warm); }, 4000);
    }
  } catch (e) { console.warn('TradeZoro: bars prefetch', e); }

  // ---------------- toolbar ----------------
  const barL = document.getElementById('stkc-bar-l');
  const isPhone = () => window.innerWidth <= PHONE_MAX;

  // Grid picker + Sync in layout (assets/chart-grid.js)
  const grid = Grid.mountGrid(ws, { bindPopover, onStructural: () => afterStructural() });
  const layWrap = grid.el;
  const SYNCS = [['crosshair'], ['viewport'], ['symbol'], ['timeframe']];

  // Phone cell switcher
  const cellSw = el('div', { class: 'stkc-cells', role: 'tablist', 'aria-label': 'Charts in this layout' });

  // Templates menu
  const tplBtn = el('button', { type: 'button', class: 'stkc-btn', id: 'stkc-tpl-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Templates',
    html: icon('<path d="M6 4h12v16l-6-4-6 4z"/>') + '<span class="stkc-btn-l">Templates</span>' });
  const tplPop = el('div', { class: 'stkc-pop stkc-tpl', id: 'stkc-tpl-pop', role: 'dialog', 'aria-label': 'Templates', hidden: '' });
  const tplWrap = el('div', { class: 'stkc-menu' }, [tplBtn, tplPop]);
  const setTpl = bindPopover(tplBtn, tplPop, () => renderTemplates());

  barL.appendChild(layWrap);
  barL.appendChild(tplWrap);
  try { Pine.mountPine(ws, barL, { toast, tfLabel }); } catch (e) { console.warn('TradeZoro: Pine editor', e); }
  barL.appendChild(cellSw);
  if (rith) { try { rith.mount(ws, Core); } catch (e) { console.warn('TradeZoro: Rithmic UI', e); } }
  // Data-status dot by each symbol (green real-time / amber delayed / grey closed): assets/chart-data-dot.js.
  import('./chart-data-dot.js?v=566')
    .then((m) => m.installDataDot(ws, { rith, FuturesProvider, FxProvider }))
    .catch((e) => console.warn('TradeZoro: data dot', e));
  // Price-axis countdown to bar close: current wall-clock bar, hidden while CME is closed,
  // timers paused on hidden tabs: assets/chart-countdown.js.
  import('./chart-countdown.js?v=566')
    .then((m) => m.installCountdown(ws))
    .catch((e) => console.warn('TradeZoro: countdown', e));
  // Floating Favorites drawing toolbar (starred tools, draggable): assets/chart-fav-toolbar.js.
  import('./chart-fav-toolbar.js?v=566')
    .then((m) => m.mountFavToolbar(ws, Core, { toast }))
    .catch((e) => console.warn('TradeZoro: favorites toolbar', e));
  const mountHeavy = () => {
    window.__stkFlow = Flow;
    try { Flow.mountOrderflow(ws, { toast }); } catch (e) { console.warn('TradeZoro: volume tools', e); }
  };
  if (heavyNeeded) mountHeavy();
  try { Pine.mountCommunityPicker(ws); } catch (e) { console.warn('TradeZoro: community picker', e); }
  try { Settings.mountChartSettings(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: settings window', e); }
  try { Alerts.mountChartAlerts(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: alerts', e); }
  // PAPER TRADING (Owner order 2026-10-12): demo money, simulated fills, no broker. Trade button,
  // order ticket, on-chart lines, one-click Buy/Sell, bottom panel: assets/chart-paper.js.
  try { Paper.mountPaper(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: paper trading', e); }
  try { Replay.mountBarReplay(ws, { toast, Paper, store: mods[9].sharedBarStore }); } catch (e) { console.warn('TradeZoro: bar replay', e); }
  // Right-side Watchlist panel + icon rail (phones: a full-screen sheet): assets/chart-watchlist.js.
  // SymbolPicker comes from Vela's widget build (same chunk the workspace already loaded).
  Promise.all([import('./chart-watchlist.js?v=566'), import(VELA_BASE + 'widget.js')])
    .then(([m, Wd]) => m.mountWatchlist(ws, { toast, Core, SymbolPicker: Wd.SymbolPicker, rith }))
    .catch((e) => console.warn('TradeZoro: watchlist', e));
  // News panel (right icon bar, phones: a sheet): headlines for the chart's market, replay-safe (assets/chart-news.js).
  import('./chart-news.js?v=566').then((m) => m.mountNews(ws, { toast })).catch((e) => console.warn('TradeZoro: news', e));
  // Symbol info panel (right icon bar, phones: a sheet): contract specs, roll calendar, session (assets/chart-symbol-info.js).
  import('./chart-symbol-info.js?v=566').then((m) => m.mountSymbolInfo(ws)).catch((e) => console.warn('TradeZoro: symbol info', e));
  // Indicator Settings → Inputs: every input.symbol opens the same symbol search
  // (assets/chart-symbol-input.js).
  Promise.all([import('./chart-symbol-input.js?v=566'), import(VELA_BASE + 'widget.js')])
    .then(([m, Wd]) => m.mountSymbolInputPicker(ws, { toast, SymbolPicker: Wd.SymbolPicker, COMMODITY_ROOTS }))
    .catch((e) => console.warn('TradeZoro: symbol inputs', e));
  // "+" on the price axis (alerts / disabled trade items / horizontal line): assets/chart-plus.js
  import('./chart-plus.js?v=566').then((m) => m.mountChartPlus(ws, { openAlerts: Alerts.openAlerts, chartPlots: Alerts.chartPlots })).catch((e) => console.warn('TradeZoro: + menu', e));
  try { Events.mountChartEvents(ws); } catch (e) { console.warn('TradeZoro: events', e); }
  // TradingView-style interval row + menu (assets/chart-intervals.js).
  try { Iv.mountIntervals(ws, { toast }); } catch (e) { console.warn('TradeZoro: intervals', e); }
  if (!heavyNeeded) {
    // First paint done (or 6 s at most), then an idle slot: load, install and mount the heavy modules.
    const firstPaint = () => new Promise((res) => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = ws.cells().some((c) => c.chart.orchestrator.rawBars.length > 0); } catch (e) {}
        if (ok || Date.now() - t0 > 6000) res(); else setTimeout(tick, 100);
      };
      tick();
    });
    firstPaint().then(() => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 2500 }) : setTimeout(r, 300))))
      .then(loadHeavy).then((h) => { mods[7] = h[0]; mods[14] = h[1]; mods[19] = h[2]; mods[20] = h[3]; mods[21] = h[4]; installHeavy(); mountHeavy(); window.__stkHeavyReady = true; try { window.dispatchEvent(new Event('stk:heavy-ready')); } catch (e) {} })
      .catch((e) => console.warn('TradeZoro: order flow / GEX modules', e));
  } else window.__stkHeavyReady = true;
  // ONE toolbar (Owner order 2026-10-14): Vela's chart topbar joins #stkc-bar on a desktop-mode
  // chart, so the chart gets the second row's height; ⋯ More takes what does not fit
  // (assets/chart-onebar.js). Buttons added later (layout menu, watchlist) are picked up live.
  import('./chart-onebar.js?v=566')
    .then((m) => m.mountOneBar(ws))
    .catch((e) => console.warn('TradeZoro: one toolbar', e));
  // TradingView-style left drawing column, right icon bar, fullscreen (assets/chart-tv-toolbars.js).
  import('./chart-tv-toolbars.js?v=566')
    .then((m) => m.mountTvToolbars(ws, { toast }))
    .catch((e) => console.warn('TradeZoro: tv toolbars', e));
  // TradingView-style "Indicators, metrics, and strategies" window replaces Vela's picker
  // (assets/chart-indicator-window.js); loaded after the two picker wrappers above.
  import('./chart-indicator-window.js?v=566')
    .then((m) => m.mountIndicatorWindow(ws, { toast, tfLabel }))
    .catch((e) => console.warn('TradeZoro: indicator window', e));

  function refreshLayoutUi(){
    grid.refresh();
    renderCellSwitcher();
  }

  function setLayout(id){ grid.setLayout(id); }

  function tfLabel(tf){
    tf = String(tf || '');
    if (/^\d+$/.test(tf)) { const n = +tf; return n % 60 === 0 && n >= 60 ? (n / 60) + 'h' : n + 'm'; }
    try { return Iv.ivShort(tf); } catch (e) { return tf; }
  }

  // Phone: one chart at a time — maximize the active cell; chips switch it.
  let swKey = '';
  function renderCellSwitcher(){
    const cells = liveCells();
    const show = isPhone() && cells.length > 1;
    cellSw.hidden = !show;
    if (!show) {
      swKey = '';
      cellSw.innerHTML = '';
      try { if (ws.maximizedCell && !isPhone()) ws.maximizeCell(null); } catch (e) {}
      return;
    }
    let active = null; try { active = ws.active.id; } catch (e) {}
    if (!cells.some((c) => c.id === active)) active = cells[0].id;
    const key = active + '|' + cells.map((c) => c.id + c.symbol + c.timeframe).join(',');
    if (key !== swKey) {
      swKey = key;
      cellSw.innerHTML = '';
      cells.forEach((c, i) => {
        const lab = (String(c.symbol || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '') + ' ' + tfLabel(c.timeframe)).trim();
        cellSw.appendChild(el('button', { type: 'button', role: 'tab', class: 'stkc-cell' + (c.id === active ? ' on' : ''),
          'aria-selected': c.id === active ? 'true' : 'false', title: 'Chart ' + (i + 1), text: lab || String(i + 1),
          onclick: () => { try { ws.setActiveCell(c.id); ws.maximizeCell(c.id); } catch (e) {} renderCellSwitcher(); } }));
      });
    }
    try { if (ws.maximizedCell !== active) ws.maximizeCell(active); } catch (e) {}
  }

  function afterStructural(){
    grid.enforceCap();
    try { ws.setTheme(currentTheme()); } catch (e) {}
    refreshLayoutUi();
  }

  try { ws.on('layout:changed', () => setTimeout(refreshLayoutUi, 0)); } catch (e) {}
  try { ws.on('cell:active', () => { if (isPhone()) setTimeout(renderCellSwitcher, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => { if (isPhone()) renderCellSwitcher(); }); } catch (e) {}
  let lastPhone = isPhone();
  window.addEventListener('resize', () => { if (isPhone() !== lastPhone) { lastPhone = isPhone(); swKey = ''; renderCellSwitcher(); } }, { passive: true });
  // A grid wider than this device allows (8 on desktop, 4 on tablets/phones) drops to 4.
  if (cellCount() > Grid.maxCells()) afterStructural();
  refreshLayoutUi();

  // ---------------- templates ----------------
  const T = window.StrykerChartTemplates;

  // Built-in starters (read-only, never stored).
  const STARTERS = [
    { id: 'starter:nq-scalp', name: 'NQ scalping', layout: '2h', cells: [['futures:NQ1!', '1'], ['futures:NQ1!', '5']], sync: { crosshair: true, viewport: true } },
    { id: 'starter:index-pair', name: 'Index pair', layout: '2h', cells: [['futures:NQ1!', '5'], ['futures:ES1!', '5']], sync: {} },
    { id: 'starter:quad', name: 'Quad', layout: '4', cells: [['futures:NQ1!', '15'], ['futures:ES1!', '15'], ['futures:GC1!', '15'], ['futures:CL1!', '15']], sync: {} }
  ];

  function applyStarter(s){
    try { ws.maximizeCell(null); } catch (e) {}
    try { Pine.clearAllPine(); } catch (e) {}
    SYNCS.forEach(([k]) => { try { ws.sync.set(k, false); } catch (e) {} });
    grid.setDateRange(false);
    ws.setLayout(s.layout);
    const cells = liveCells();
    s.cells.forEach(([sym, tf], i) => {
      const c = cells[i] && ws.cell(cells[i].id);
      if (!c) return;
      try { c.setSymbol(sym); c.setTimeframe(tf); } catch (e) { console.warn('TradeZoro: starter cell', e); }
    });
    SYNCS.forEach(([k]) => { if (s.sync[k]) { try { ws.sync.set(k, true); } catch (e) {} } });
    afterStructural();
  }
  function applySaved(t){
    let doc = t.state;
    if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { doc = null; } }
    if (!doc) { toast('That template could not be read.', 'error'); return; }
    try { ws.maximizeCell(null); } catch (e) {}
    try { Pine.clearAllPine(); } catch (e) {}
    ws.applyState(doc);
    afterStructural();
  }
  function applyAny(t){ if (t.starter) applyStarter(t); else applySaved(t); }

  window.STRYKER_CHART_UI = { applyStarter, applySaved, STARTERS, setLayout, refreshLayoutUi, grid };

  // Layout menu (assets/chart-layouts.js): mounted after the default template has had its
  // chance to apply, so a shared-layout link (?layout=) is never overwritten by it.
  function mountLayoutMenu(){
    import('./chart-layouts.js?v=566')
      .then((m) => m.mountLayouts(ws, { barL, bindPopover, toast, ui: window.STRYKER_CHART_UI, grid, Pine }))
      .catch((e) => console.warn('TradeZoro: layout menu', e));
  }
  if (!T) { tplWrap.hidden = true; mountLayoutMenu(); return; }

  let editing = null;   // id of the template being renamed
  let saving = false;
  let lastErr = '';

  async function renderTemplates(){
    let list = [];
    let defId = null;
    let note = '';
    try { const r = await T.list(); list = r.items; defId = r.defaultId; note = r.note || ''; }
    catch (e) { note = 'Could not load your templates.'; }
    tplPop.innerHTML = '';

    const nameIn = el('input', { type: 'text', class: 'stkc-in', maxlength: String(T.NAME_MAX), placeholder: 'Template name', 'aria-label': 'Template name' });
    const saveBtn = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Save' });
    const doSave = async () => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return; }
      if (saving) return;
      saving = true; saveBtn.disabled = true; lastErr = '';
      try { await T.save(name, ws.getState()); toast('Template saved'); }
      catch (e) { lastErr = (e && e.userMessage) || 'Could not save the template.'; console.warn('TradeZoro: template save', e); }
      saving = false; renderTemplates();
    };
    saveBtn.addEventListener('click', doSave);
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Save current as…' }));
    tplPop.appendChild(el('div', { class: 'stkc-saverow' }, [nameIn, saveBtn]));
    const msg = lastErr || note;
    if (msg) tplPop.appendChild(el('p', { class: 'stkc-err', role: 'status', text: msg }));

    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'My templates' + (list.length ? ' (' + list.length + '/' + T.MAX_COUNT + ')' : '') }));
    if (!list.length) tplPop.appendChild(el('p', { class: 'stkc-empty', text: 'None saved yet.' }));
    const ul = el('ul', { class: 'stkc-tlist' });
    list.forEach((t) => ul.appendChild(row(t, t.id === defId)));
    tplPop.appendChild(ul);

    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Starters' }));
    const ul2 = el('ul', { class: 'stkc-tlist' });
    STARTERS.forEach((s) => ul2.appendChild(row(Object.assign({ starter: true }, s), s.id === defId)));
    tplPop.appendChild(ul2);
    tplPop.appendChild(el('p', { class: 'stkc-note', text: T.signedIn() ? 'Saved to your account. The default opens when this browser has no chart session yet.' : 'Saved in this browser. Sign in to keep them on your account.' }));
  }

  function row(t, isDef){
    const li = el('li', { class: 'stkc-trow' + (isDef ? ' is-def' : '') });
    if (editing === t.id && !t.starter) {
      const inp = el('input', { type: 'text', class: 'stkc-in', maxlength: String(T.NAME_MAX), 'aria-label': 'New name' });
      inp.value = t.name;
      const ok = el('button', { type: 'button', class: 'stkc-sbtn', text: 'OK' });
      const go = async () => {
        const v = inp.value.trim(); if (!v) return;
        try { await T.rename(t.id, v); lastErr = ''; } catch (e) { lastErr = 'Could not rename.'; }
        editing = null; renderTemplates();
      };
      ok.addEventListener('click', go);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') { e.stopPropagation(); editing = null; renderTemplates(); }
      });
      li.appendChild(inp); li.appendChild(ok);
      setTimeout(() => inp.focus(), 0);
      return li;
    }
    li.appendChild(el('button', { type: 'button', class: 'stkc-tname', title: 'Load',
      onclick: () => { applyAny(t); setTpl(false); } }, [el('span', { text: t.name }), isDef ? el('em', { text: 'default' }) : null]));
    const acts = el('span', { class: 'stkc-tacts' });
    acts.appendChild(el('button', { type: 'button', class: 'stkc-ib' + (isDef ? ' on' : ''),
      title: isDef ? 'Default (click to clear)' : 'Set as default', 'aria-label': (isDef ? 'Clear default: ' : 'Set as default: ') + t.name, 'aria-pressed': isDef ? 'true' : 'false',
      html: icon('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"' + (isDef ? ' fill="currentColor"' : '') + '/>'),
      onclick: async () => { try { await T.setDefault(isDef ? null : t.id); lastErr = ''; } catch (e) { lastErr = 'Could not set the default.'; } renderTemplates(); } }));
    if (!t.starter) {
      acts.appendChild(el('button', { type: 'button', class: 'stkc-ib', title: 'Rename', 'aria-label': 'Rename ' + t.name,
        html: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>'), onclick: () => { editing = t.id; renderTemplates(); } }));
      acts.appendChild(el('button', { type: 'button', class: 'stkc-ib stkc-del', title: 'Delete', 'aria-label': 'Delete ' + t.name,
        html: icon('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
        onclick: async () => {
          if (!window.confirm('Delete the template "' + t.name + '"?')) return;
          try { await T.remove(t.id); lastErr = ''; } catch (e) { lastErr = 'Could not delete.'; }
          renderTemplates();
        } }));
    }
    li.appendChild(acts);
    return li;
  }

  window.STRYKER_CHART_UI.renderTemplates = renderTemplates;

  // Default template: only when this browser had no saved session at load.
  if (!hadSession) {
    try {
      const r = await T.list();
      if (r.defaultId) {
        const t = r.defaultId.startsWith('starter:')
          ? STARTERS.map((s) => Object.assign({ starter: true }, s)).find((s) => s.id === r.defaultId)
          : r.items.find((x) => x.id === r.defaultId);
        if (t) applyAny(t);
      }
    } catch (e) { /* no default: keep the stock chart */ }
  }
  mountLayoutMenu();
})();
