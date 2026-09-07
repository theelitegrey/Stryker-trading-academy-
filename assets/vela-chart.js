// Stryker Trading Academy — Charts (charts.html) — loaded as <script type="module">
// Depends on: the shared page shell (login gate); no other site scripts.
//
// A full charting workspace powered by Vela (github.com/LuxAlgo/Vela,
// Apache-2.0). The workspace UI lives in the package's ES-module build (the
// global script bundle carries only the headless core), so this imports
// dist/workspace.js and the three data providers from jsDelivr, pinned to an
// exact version. Vela's providers stream free public crypto data from
// Binance, Coinbase and Hyperliquid — no API keys.
//
// ATTRIBUTION: Vela renders its own small watermark on the chart and this
// page credits it in the footer line. Per its NOTICE terms the watermark must
// stay unless equivalent visible attribution exists — we keep both, so never
// call renderer.set('attribution', false) here.
//
// persist:true keeps the student's symbol, drawings, indicators and layout in
// localStorage, so the workspace reopens the way they left it.

const VELA_BASE = 'https://cdn.jsdelivr.net/npm/@luxalgo/vela@0.6.17/dist/';

function velaFail(){
  const fb = document.getElementById('stkchart-fallback');
  if (fb) fb.hidden = false;
}

(async () => {
  const host = document.getElementById('vela-chart');
  if (!host) return;

  let mods;
  try {
    mods = await Promise.all([
      import(VELA_BASE + 'workspace.js'),
      import(VELA_BASE + 'providers/binance.js'),
      import(VELA_BASE + 'providers/coinbase.js'),
      import(VELA_BASE + 'providers/hyperliquid.js')
    ]);
  } catch (err) {
    console.error('Stryker: Vela modules failed to load', err);
    velaFail();
    return;
  }

  const VelaWorkspace = mods[0].VelaWorkspace;
  const BinanceProvider = mods[1].BinanceProvider;
  const CoinbaseProvider = mods[2].CoinbaseProvider;
  const HyperliquidProvider = mods[3].HyperliquidProvider;

  let day = false;
  try { day = localStorage.getItem('stryker_theme') === 'day'; } catch (e) {}

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
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    window.STRYKER_VELA = new VelaWorkspace('#vela-chart', {
      layout: false,                 // one chart; the workspace UI can split it
      symbol: 'binance:BTCUSDT',
      timeframe: '60',
      live: true,
      theme: day ? 'light' : 'dark',
      providers: {
        binance: () => new BinanceProvider(),
        coinbase: () => new CoinbaseProvider(),
        hyperliquid: () => new HyperliquidProvider()
      },
      persist: true
    });
  } catch (err) {
    console.error('Stryker: Vela failed to start', err);
    velaFail();
  }
})();
