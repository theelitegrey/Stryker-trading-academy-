// Screenshots for /features/journal, /features/backtesting and /features/models (FEATB, 19 Nov 2026): the REAL member pages
// (trade-journal.html, backtests.html, replay.html, models.html, model.html) with Firebase stubbed by tools/tests/richstub.js
// (a signed-in member whose journal and backtests are the apps' own built-in demo data) and the replay bars from the
// deterministic mock in tools/tests/bt-rig.js. Every other host is blocked. All of it is SAMPLE DATA and labelled so.
// Result figures (money amounts and percentages) are blurred in every capture: no P&L or win-rate figure on a public page.
// Provider names and feed-timing words are hidden too (brief 19 Nov).
//   tools/chrome-slot.sh node tools/feature-pages/shoot-apps.js <outDir> [scene...]      (serves the repo itself)
const fs = require('fs'), path = require('path');
const R = require('../tests/bt-rig.js');
const OUT = process.argv[2] || '/tmp/appshots', ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INIT = () => { try {
  localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
  localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ u1: 1, _anon: 1 }));
} catch (e) {} };
const blur = (p) => p.evaluate(() => {
  const money = /[-+−]?\s?[$€£₹]\s?[\d,]+(\.\d+)?[kKmM]?|[-+]?\d[\d,]*(\.\d+)?\s?%/;
  const prov = /\b(Yahoo Finance|Yahoo|TradingView|Rithmic|Tradovate|Binance|Coinbase|Kraken|Bybit|OKX|Bitget|Hyperliquid|Finatic|TradeZella|FTMO|Topstep|Apex)\b/gi;
  const w = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (w.nextNode()) hit.push(w.currentNode);
  hit.forEach((n) => { const t = n.nodeValue, el = n.parentElement; if (!el) return;
    const v = t.replace(prov, '').replace(/\s·\s(·\s)+/g, ' · ').replace(/^\s*·\s*|\s*·\s*$/g, '');
    if (v !== t) n.nodeValue = v;
    if (/delayed|real-?time|real edge/i.test(t)) { el.style.visibility = 'hidden'; return; }
    if (money.test(t)) el.style.filter = 'blur(9px)'; });
  // figures split over several spans ($18,006 + .64): blur the short element that holds the whole figure
  (document.querySelector('main') || document.body).querySelectorAll('*').forEach((e) => {
    const t = (e.textContent || '').trim();
    if (t.length && t.length < 24 && money.test(t) && /^[-+−$€£₹\d,.\s%kKmM]+$/.test(t)) e.style.filter = 'blur(9px)'; });
  // canvases / svg charts keep their shape; their axis labels are text in svg (blurred above) or canvas (left as drawn)
});
const hideChrome = (p) => p.addStyleTag({ content: '.tzc,.toast,.stk-toast,#stk-toasts,.cookie-notice,#cookie-notice,.jfab,.fab,[class*=fab-]{display:none!important} html{scroll-behavior:auto!important} .jz-hero-val,[id^=jstat-],[id*=pnl],[class*=pnl-val]{filter:blur(12px)!important}' }).catch(() => {});
async function go(p, base, u, wait = 4500) { await p.goto(base + u, { waitUntil: 'domcontentloaded' }); await sleep(wait); await hideChrome(p); }
async function el(p, sel, name, pad = 0) {
  await blur(p);
  const h = await p.$(sel); if (!h) { console.log('MISSING', sel); return; }
  await h.evaluate((e) => window.scrollTo(0, scrollY + e.getBoundingClientRect().top - 120)); await sleep(600);
  await p.evaluate(() => document.querySelectorAll('header, nav, .dash-topbar, .site-nav, .appnav-dock, .mobile-topnav').forEach((e) => { if (/sticky|fixed/.test(getComputedStyle(e).position)) e.style.visibility = 'hidden'; }));
  const b = await h.boundingBox();
  await p.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad } });
  await p.evaluate(() => document.querySelectorAll('header, nav, .dash-topbar, .site-nav, .appnav-dock, .mobile-topnav').forEach((e) => { e.style.visibility = ''; }));
  console.log('SHOT', name, sel, Math.round(b.width) + 'x' + Math.round(b.height));
}
async function view(p, name) { await blur(p); await p.evaluate(() => scrollTo(0, 0)); await sleep(400); await p.screenshot({ path: path.join(OUT, name + '.png') }); console.log('SHOT', name, 'viewport'); }
const D2 = Object.assign({}, R.DEVICES.desktop, { deviceScaleFactor: 2 });

const scenes = {
  async journal(b, srv) {
    const { ctx, p, errors } = await R.page(b, srv, D2, INIT);
    await go(p, srv.base, '/trade-journal.html#dashboard', 6000);
    await view(p, 'nm-dashboard');
    await el(p, '.jz-top', 'nm-score');
    await el(p, '#jz-kpis', 'nm-kpis');
    await el(p, '.jz-charts', 'nm-charts');
    for (const t of ['calendar', 'analytics', 'ai', 'propfirms', 'history', 'add', 'playbook']) {
      await p.evaluate((t) => { location.hash = t; }, t); await sleep(2500);
      await view(p, 'nm-' + t);
      await el(p, '#tab-' + t, 'nm-' + t + '-panel');
    }
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async backtests(b, srv) {
    const { ctx, p, errors } = await R.page(b, srv, D2, INIT);
    await go(p, srv.base, '/backtests.html', 6000);
    await view(p, 'kr-dashboard');
    for (const t of ['sessions', 'trades', 'analytics']) { await p.evaluate((t) => { location.hash = t; }, t); await sleep(2500); await view(p, 'kr-' + t); }
    await el(p, '#v-analytics, section.bt-view:not([hidden])', 'kr-analytics-panel');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async replay(b, srv) {
    const { ctx, p, errors } = await R.page(b, srv, D2, INIT);
    await R.startSession(p, srv.base, ''); await sleep(4000); await hideChrome(p);
    for (let i = 0; i < 12; i++) { await p.click('#rp-step10').catch(() => {}); await sleep(120); }
    await p.evaluate(() => document.querySelectorAll('.stk-toast, [class*=notice], [class*=toast]').forEach((e) => { if (/Killzones|Open old chart/.test(e.textContent)) e.remove(); }));
    await sleep(800); await view(p, 'kr-replay');
    // a market buy with stop + target, then a few more bars
    await p.click('#rp-strip-buy').catch(() => {}); await sleep(800);
    for (let i = 0; i < 4; i++) { await p.click('#rp-step').catch(() => {}); await sleep(250); }
    await sleep(1000); await view(p, 'kr-replay-trade');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async models(b, srv) {
    const { ctx, p, errors } = await R.page(b, srv, D2, INIT);
    await go(p, srv.base, '/models.html', 5000);
    await view(p, 'md-top');
    await el(p, '.notice', 'md-process');
    await el(p, '.mdl-head', 'md-libhead');
    await p.evaluate(() => { const g = document.querySelector('.mdl-grid'); g && window.scrollTo(0, scrollY + g.getBoundingClientRect().top - 220); }); await sleep(800);
    await p.screenshot({ path: path.join(OUT, 'md-library.png') }); console.log('SHOT md-library');
    await el(p, '.mdl-card', 'md-card');
    for (const id of ['orb-model-a', 'silver-bullet-model', 'ifvg-model-c']) {
      await go(p, srv.base, '/model.html?id=' + id, 4500);
      await view(p, 'md-' + id);
      await el(p, '#model-steps', 'md-' + id + '-steps');
      await el(p, '#model-body .mm-rise img', 'md-' + id + '-example');
      await el(p, '#model-hero', 'md-' + id + '-hero');
    }
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async indpage(b, srv) {
    const { ctx, p, errors } = await R.page(b, srv, D2, INIT);
    await go(p, srv.base, '/indicators.html', 4000); await view(p, 'ix-catalog');
    await go(p, srv.base, '/indicators/liquidity-master.html', 3000); await view(p, 'ix-guide');
    await go(p, srv.base, '/indicators-access.html', 4000); await view(p, 'ix-access');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
};

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  try { for (const [n, fn] of Object.entries(scenes)) if (!ONLY.length || ONLY.includes(n)) { try { await fn(b, srv); } catch (e) { console.log('SCENE FAIL', n, String(e).slice(0, 300)); } } }
  finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
