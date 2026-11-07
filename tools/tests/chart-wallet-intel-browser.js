// Browser test: Wallet Intel (free for everyone, assets/chart-wallet-intel.js) on HYPERLIQUID:BTC 1m.
//   node tools/tests/chart-dev-server.mjs 8197 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8197 node tools/tests/chart-wallet-intel-browser.js [shotsDir]
// Chart bars + book come from the REAL public Hyperliquid API. The book-recorder /hl/* endpoints are answered from the fixtures in
// tools/fixtures/hl-intel/ (REAL public data captured 2026-11-07, see make_fixtures.py), or from the S1 dev Worker when
// HL_INTEL_BASE=https://... is set (then the fixture checks that pin exact numbers are skipped).
// Checks: listed without a PRO tag; clusters drawn; hover card; tap a cluster -> wallets; tap the fixture candle -> totals + wallets;
// tap a wallet -> profile (copy + explorer link); back; book level -> wallets; other venue -> note; wording; no overflow at 390.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const LIVE = process.env.HL_INTEL_BASE || '';
const OUT = process.argv[2] || '/tmp';
const FX = (n) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'hl-intel', n));
const CANDLE = JSON.parse(FX('candle-btc-1m.json'));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = { candle: 0, clusters: 0, level: 0, wallet: 0 };

async function open(b, { w, h, mobile, theme, anon }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  if (anon) await ctx.addInitScript(() => { Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => new Promise(() => {}), set() {} }); const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([theme, live]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.removeItem('stryker.vela.session'); } catch (e) {}
    window.__stkChartTestFree = true;
    if (live) window.__STK_BOOK_RECORDER = live;
  }, [theme, LIVE]);
  await require('./binance-mock.js').install(ctx);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.|api\.hyperliquid\.xyz|[a-z0-9.-]*binance)/, (r) => (LIVE && r.request().url().startsWith(LIVE) ? r.continue() : r.abort()));
  if (!LIVE) {
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!hl\/)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/hl\//, (r) => {
      const u = new URL(r.request().url()), k = u.pathname.split('/').pop();
      hits[k] = (hits[k] || 0) + 1;
      const file = { candle: 'candle-btc-1m.json', clusters: 'clusters-btc.json', level: 'level-btc.json', wallet: 'wallet.json' }[k];
      // only BTC is in the fixtures; any other coin = no data yet (404)
      if (!file || (u.searchParams.get('coin') && u.searchParams.get('coin') !== 'BTC')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
      let body = FX(file);
      // the level fixture holds real tracked orders at ONE price: answer at the tapped price so the panel reads consistently
      if (k === 'level') { const j = JSON.parse(body), px = +u.searchParams.get('px'); j.px = j.lo = j.hi = px; j.orders.forEach((o) => { o.px = px; o.ntl = Math.round(o.sz * px * 100) / 100; }); body = JSON.stringify(j); }
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
    });
  }
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics|Failed to load resource|CORS|Firestore|FirebaseError/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkWalletIntel, null, { timeout: 60000 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'hyperliquid:BTC' && ws.chart.orchestrator.rawBars.length > 50) break; }
  });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(800);
  return { ctx, p, errors };
}
const add = (p, inputs) => p.evaluate((i) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_hlintel', { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, inputs);
const chip = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-wi-chip')].filter((x) => !x.hidden).map((x) => x.textContent).join(' | '));
const panelText = (p) => p.evaluate(() => { const e = document.getElementById('stkwi'); return e && !e.hidden ? e.innerText : ''; });
const SHOOT = /wi-(1440-dark|1440-light|412-dark|390-dark)/;
async function shot(p, name) { if (!SHOOT.test(name)) return; await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
async function tap(p, phone, x, y) { if (phone) await p.touchscreen.tap(x, y); else { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); } }

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  // free: no PRO tag in the Indicators window
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /TradeZoro/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
  const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_hlintel"]'); return r ? { pro: !!r.querySelector('.stk-protag'), text: r.textContent } : null; });
  check(row && !row.pro, tag + ': Wallet Intel listed without a PRO tag ' + JSON.stringify(row && row.text.slice(0, 80)));
  await p.keyboard.press('Escape'); await sleep(300);
  await p.evaluate(() => { const x = document.querySelector('.stkiw-x, .stkiw .stkw-close, [aria-label="Close indicators"]'); if (x) x.click(); });
  await add(p, { minSize: '$10K' }); await sleep(2500);
  const c1 = await chip(p);
  check(/Wallet Intel: \d+ (of \d+ )?clusters?( in view)? · tracked wallets ~22% of OI · updated/.test(c1) || (LIVE && /Wallet Intel/.test(c1)), tag + ': chip "' + c1 + '"');
  // clusters sit a few % from the price: on 1m the axis spans ~0.5 %, so check them on 1h (~2 weeks in view)
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('60'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const rb = ws.chart.orchestrator.rawBars; if (rb.length > 50 && rb[1].time - rb[0].time >= 3600000) break; } const c = ws.chart, rb = c.orchestrator.rawBars; c.setVisibleRange({ from: rb[rb.length - 1].time - 14 * 86400000, to: rb[rb.length - 1].time + 3 * 86400000 }); }); await sleep(1800);
  const g = await p.evaluate(() => window.__stkWalletIntel._xy(0, 0));
  check(g && g.boxes.length > 0, tag + ': clusters drawn and hittable (' + (g && g.boxes.length) + ': ' + (g ? [...new Set(g.boxes.map((x) => x.kind))].join('+') : '') + ')');
  await shot(p, 'wi-' + tag + '-chart.png');
  // hover card on a cluster (mouse)
  if (g && g.boxes.length) {
    const bx = g.boxes.slice().sort((a, b) => b.ntl - a.ntl)[0];
    if (!phone) {
      await p.mouse.move(bx.x, bx.y); await sleep(300);
      const t = await p.evaluate(() => { const t = document.querySelector('.stk-wi-tip'); return t && !t.hidden ? t.innerText : ''; });
      check(/(Long|Short) liquidations near|(Buy|Sell) stops near/.test(t) && /tracked wallet/.test(t), tag + ': hover card "' + t.replace(/\n/g, ' | ') + '"');
    }
    await tap(p, phone, bx.x, bx.y); await sleep(600);
    const pt = await panelText(p);
    check(/(liquidations|stops) near/.test(pt) && /tracked wallet/.test(pt) && /of cluster/.test(pt), tag + ': cluster tap -> wallets panel');
    await shot(p, 'wi-' + tag + '-cluster.png');
  }
  // back to 1m, ~1 h around the fixture candle, then tap it (its middle)
  await p.evaluate(() => window.__stkWalletIntel.close());
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const rb = ws.chart.orchestrator.rawBars; if (rb.length > 50 && rb[1].time - rb[0].time === 60000) break; } }); await sleep(800);
  await p.evaluate((t) => { window.STRYKER_VELA.chart.setVisibleRange({ from: t - 40 * 60000, to: t + 20 * 60000 }); }, CANDLE.from); await sleep(1200);
  const cg = await p.evaluate((t) => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; const b = rb.find((x) => x.time === t); if (!b) return null; const a = window.__stkWalletIntel._xy(t, (b.high + b.low) / 2); return a && { x: a.x, y: a.y, hl: b.high - b.low }; }, CANDLE.from);
  check(!!cg, tag + ': fixture candle on the chart');
  if (cg) {
    await p.evaluate(() => window.__stkWalletIntel.close()); await sleep(200);
    await tap(p, phone, cg.x, cg.y); await sleep(900);
    const v = await p.evaluate(() => window.__stkWalletIntel.view);
    check(v && v.kind === 'candle' && v.from === CANDLE.from, tag + ': candle tap opened its wallets ' + JSON.stringify(v));
  }
  // if the tap missed, open it through the API so the rest of the checks still run
  let pt = await panelText(p);
  if (!/Volume/.test(pt)) { await p.evaluate((c) => window.__stkWalletIntel.openCandle('BTC', c.from, c.to), CANDLE); await sleep(800); pt = await panelText(p); }
  check(/BTC · 1m candle/.test(pt) && /Volume\s*\$39K/.test(pt) && /Trades\s*75/.test(pt) && /Wallets\s*50/.test(pt) || (LIVE && /Volume/.test(pt)), tag + ': candle totals');
  check(/Market buys \$11K · 27%/.test(pt) && /73% · \$29K market sells/.test(pt) || LIVE, tag + ': taker split');
  const nrows = await p.evaluate(() => document.querySelectorAll('#stkwi .stkwi-row').length);
  check(nrows === 50 || (LIVE && nrows > 0), tag + ': 50 wallet rows (' + nrows + ')');
  check(/% of candle/.test(pt) && /avg 75,/.test(pt), tag + ': rows show size, avg price and % of candle');
  const ov = await p.evaluate(() => { const b = document.querySelector('#stkwi .stkwi-body'), pn = document.getElementById('stkwi').getBoundingClientRect(); return { sx: b.scrollWidth - b.clientWidth, right: pn.right <= window.innerWidth + 1, docx: document.documentElement.scrollWidth - window.innerWidth }; });
  check(ov.sx <= 1 && ov.right && ov.docx <= 1, tag + ': no horizontal overflow ' + JSON.stringify(ov));
  const tgt = await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-ib:not([hidden]), #stkwi .stkwi-row')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check(tgt.length && Math.min(...tgt) >= 44, tag + ': tap targets >= 44 px (min ' + Math.min(...tgt) + ')');
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-body').scrollTo(0, 0));
  await shot(p, 'wi-' + tag + '-candle.png');
  // segmented filter
  await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-seg button')].find((b) => b.textContent === 'Net sellers').click()); await sleep(200);
  const sellers = await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-row .stkwi-l2:not(.stkwi-r .stkwi-l2)')].every((e) => e.classList.contains('dn')));
  check(sellers, tag + ': Net sellers filter');
  await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-seg button')].find((b) => b.textContent === 'All').click()); await sleep(200);
  // wallet profile
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-row').click()); await sleep(900);
  pt = await panelText(p);
  check(/Account value/.test(pt) && /Open positions/.test(pt) && /Recent large fills/.test(pt) && /0x63f6411ca61733af716c9a50a56a84ea38a0af59/.test(pt) || (LIVE && /Account value/.test(pt)), tag + ': wallet profile');
  check(/liq /.test(pt) && /entry /.test(pt), tag + ': positions show entry and liquidation price');
  const links = await p.evaluate(() => ({ copy: !!document.querySelector('#stkwi .stkwi-copy'), ext: (document.querySelector('#stkwi .stkwi-ext') || {}).href || '', back: !document.querySelector('#stkwi .stkwi-back').hidden }));
  check(links.copy && /app\.hyperliquid\.xyz\/explorer\/address\/0x/.test(links.ext) && links.back, tag + ': copy button, explorer link, back button ' + JSON.stringify(links));
  await shot(p, 'wi-' + tag + '-wallet.png');
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-back').click()); await sleep(300);
  check(/1m candle/.test(await panelText(p)), tag + ': back -> the candle again');
  // book panel: tap a Book row -> tracked wallets at that level
  await p.evaluate(() => window.__stkWalletIntel.close());
  const bp = await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkbp-phonebtn' : '.stkbp-railbtn'); if (!b || b.hidden) return false; b.click(); return true; }, phone);
  check(bp, tag + ': book panel button on a Hyperliquid chart');
  let r0 = null;
  for (let i = 0; i < 30 && !r0; i++) { await sleep(500); r0 = await p.evaluate(() => { const r = [...document.querySelectorAll('#stkbp .stkbp-r.is-bid')].find((x) => x.dataset.p && x.offsetParent); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, p: r.dataset.p }; }); }
  check(!!r0, tag + ': book rows (real Hyperliquid book)');
  if (r0) {
    await tap(p, phone, r0.x, r0.y); await sleep(900);
    const v = await p.evaluate(() => window.__stkWalletIntel.view);
    pt = await panelText(p);
    check(v && v.kind === 'level' && +v.px === +r0.p && /BTC orders at/.test(pt) && (/Bid|Ask/.test(pt) || LIVE), tag + ': book row tap -> wallets at ' + r0.p);
    await shot(p, 'wi-' + tag + '-level.png');
  }
  await p.evaluate(() => window.__stkWalletIntel.close());
  await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkbp-phonebtn' : '.stkbp-railbtn'); if (b) b.click(); }, phone); await sleep(300);
  // wording
  const words = await p.evaluate(() => [...document.querySelectorAll('.stk-wi-tip,.stk-wi-chip,#stkwi')].map((x) => x.textContent).join(' ') + ' ' + document.querySelector('#stkwi .stkwi-foot').textContent);
  check(/Education only\. Not financial advice\./.test(words) && /tracked wallets only/.test(words), tag + ': footer: coverage + education line');
  check(!/real-time|realtime|\blive\b/i.test(words), tag + ': no real-time / live wording');
  check(!/intel ?trade|hypurrscan|hyperdash|coinglass|nansen|arkham/i.test(words), tag + ': no rival or vendor names');
  // other venue
  await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT')); await sleep(2500);
  check(/Wallet data is available on Hyperliquid charts only/.test(await chip(p)), tag + ': other venue -> Hyperliquid-only note');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, theme: 'light' }],
      ['412-dark', { w: 412, h: 915, mobile: true, theme: 'dark' }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark', anon: true }]];
    for (const [tag, o] of runs) { if (only && !tag.includes(only)) continue; await run(b, tag, o); }
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
  await b.close();
  console.log('endpoint hits ' + JSON.stringify(hits));
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
