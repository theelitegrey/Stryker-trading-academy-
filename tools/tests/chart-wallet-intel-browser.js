// Browser test: Wallet Intel (free for everyone, assets/chart-wallet-intel.js) on hyperliquid:BTC.
//   node tools/tests/chart-dev-server.mjs 8393 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8393 node tools/tests/chart-wallet-intel-browser.js [shotsDir]
// Chart bars + book come from the REAL public Hyperliquid API. The Worker's /hl-* routes are answered either
//   - from tools/fixtures/hl-intel/hl-*.json (the Worker's real answers from S1's live dry run; exact numbers checked), or
//   - end to end by the real Worker code: HL_INTEL_BASE=http://127.0.0.1:8791 with workers/book-recorder/test/hl-local-server.mjs
//     holding live feeder data (then the candle is the last whole minute the server holds, and numbers are checked against it).
// Checks: listed without a PRO tag; clusters drawn; hover card; tap a cluster -> wallets; tap a candle -> totals + wallets;
// tap a wallet -> profile (copy + explorer link); back; book row -> wallets; coverage line; other symbol -> perps note; wording.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const LIVE = process.env.HL_INTEL_BASE || '';
const OUT = process.argv[2] || '/tmp';
const FX = (n) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'hl-intel', n));
const FXC = JSON.parse(FX('hl-candle-BTC-1m.json'));
let CANDLE = FXC;   // E2E: replaced by the server's last whole minute
const SFX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workers', 'book-recorder', 'test', 'fixtures', n)));
const WSTATE = SFX('hl-state.json'), WLABELS = SFX('hl-labels.json').labels;
let walletBody = null;   // S1's own src/hl.js walletBody: what the Worker answers for an address it holds nothing on (ESM, loaded in main)
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = {};

async function open(b, { w, h, mobile, theme, anon }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  if (anon) await ctx.addInitScript(() => { Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => new Promise(() => {}), set() {} }); const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([theme, live]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.removeItem('stryker.vela.session'); localStorage.setItem('stkbp.v1', JSON.stringify({ tab: 'book', src: 'hyperliquid' })); } catch (e) {}
    window.__stkChartTestFree = true;
    if (live) window.__STK_BOOK_RECORDER = live;
  }, [theme, LIVE]);
  await require('./binance-mock.js').install(ctx);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.|api\.hyperliquid\.xyz|[a-z0-9.-]*binance)/, (r) => (LIVE && r.request().url().startsWith(LIVE) ? r.continue() : r.abort()));
  const cors = { 'access-control-allow-origin': '*' };
  if (LIVE) {
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\//, (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
    await ctx.route((u) => u.href.startsWith(LIVE + '/hl-'), (r) => { const k = new URL(r.request().url()).pathname.slice(4); hits[k] = (hits[k] || 0) + 1; r.continue(); });
  } else {
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!hl-)/, (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/hl-/, (r) => {
      const u = new URL(r.request().url()), k = u.pathname.slice(4), q = (x) => u.searchParams.get(x);
      hits[k] = (hits[k] || 0) + 1;
      const send = (j, st) => r.fulfill({ status: st || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
      // the fixtures are BTC: any other coin -> the Worker's 404 no_data
      if (q('coin') && q('coin') !== 'BTC') return send({ error: 'no_data' }, 404);
      if (k === 'clusters') return send(JSON.parse(FX('hl-clusters-BTC.json')));
      if (k === 'meta') return send(JSON.parse(FX('hl-meta.json')));
      // candle: the fixture minute only; other candles get what the Worker answers outside the data it holds (empty, partial)
      if (k === 'candle') return +q('from') === FXC.from && +q('to') === FXC.to ? send(FXC) : send({ v: 1, coin: 'BTC', from: +q('from'), to: +q('to'), updated: FXC.updated, held: FXC.held, partial: true, tot: { trades: 0, sz: 0, ntl: 0, takerBuyNtl: 0, takerSellNtl: 0, wallets: 0, truncated: false }, wallets: [], others: null });
      // level: the real fixture holds one tracked bid at 75532; filter it by the asked band as the Worker does
      if (k === 'level') { const j = JSON.parse(FX('hl-level-BTC.json')), lo = +q('lo'), hi = +q('hi'); j.lo = lo; j.hi = hi; j.levels = j.levels.filter((l) => l.px >= lo && l.px <= hi); if (!j.levels.length) { j.totSz = 0; j.totNtl = 0; } return send(j); }
      // wallet: S1's walletBody over the same real state + labels the clusters fixture was built from (workers/book-recorder/test/fixtures)
      if (k === 'wallet') return /^0x[0-9a-f]{40}$/.test(q('a')) ? send(walletBody(q('a'), WSTATE, WLABELS)) : send({ error: 'bad_request' }, 400);
      return send({ error: 'bad_request' }, 400);
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
  const cl = LIVE ? await (await fetch(LIVE + '/hl-clusters?coin=BTC')).json() : JSON.parse(FX('hl-clusters-BTC.json'));
  const covRe = new RegExp('tracking ' + cl.coverage.wallets + ' of the biggest wallets ≈ ' + Math.round(cl.coverage.oiPct) + '% of open interest');
  // free: no PRO tag in the Indicators window
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /TradeZoro/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
  const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_hlintel"]'); return r ? { pro: !!r.querySelector('.stk-protag'), text: r.textContent } : null; });
  check(row && !row.pro && /Wallet Intel/.test(row.text), tag + ': Wallet Intel listed without a PRO tag ' + JSON.stringify(row && row.text.slice(0, 80)));
  await p.keyboard.press('Escape'); await sleep(300);
  await p.evaluate(() => { const x = document.querySelector('.stkiw-x, .stkiw .stkw-close, [aria-label="Close indicators"]'); if (x) x.click(); });
  await add(p, { minSize: '$10K' }); await sleep(2500);
  const c1 = await chip(p);
  check(new RegExp('Wallet Intel: .*tracked ≈ ' + Math.round(cl.coverage.oiPct) + '% of OI · updated').test(c1), tag + ': chip "' + c1 + '"');
  // clusters sit a few % from the price: on 1m the axis spans ~0.5 %, so check them on 1h (~2 weeks in view)
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('60'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const rb = ws.chart.orchestrator.rawBars; if (rb.length > 50 && rb[1].time - rb[0].time >= 3600000) break; } const c = ws.chart, rb = c.orchestrator.rawBars; c.setVisibleRange({ from: rb[rb.length - 1].time - 14 * 86400000, to: rb[rb.length - 1].time + 3 * 86400000 }); }); await sleep(1800);
  const g = await p.evaluate(() => window.__stkWalletIntel._xy(0, 0));
  check(g && g.boxes.length > 0 && g.boxes.some((x) => x.kind === 'liq') && g.boxes.some((x) => x.kind === 'stop'), tag + ': liquidation + stop clusters drawn and hittable (' + (g && g.boxes.length) + ')');
  await shot(p, 'wi-' + tag + '-chart.png');
  let tracked = '';
  for (const kind of ['stop', 'liq']) {
    // the desktop panel narrows the chart: close it and read the positions again
    await p.evaluate(() => window.__stkWalletIntel.close()); await sleep(700);
    const g2 = await p.evaluate(() => window.__stkWalletIntel._xy(0, 0));
    const bx = g2 && g2.boxes.filter((x) => x.kind === kind).sort((a, b) => b.ntl - a.ntl)[0];
    if (!bx) continue;
    if (!phone) {
      await p.mouse.move(bx.x, bx.y); await sleep(300);
      const t = await p.evaluate(() => { const t = document.querySelector('.stk-wi-tip'); return t && !t.hidden ? t.innerText : ''; });
      check(/(Long|Short) liquidations [\d,]+–[\d,]+|(Buy|Sell) triggers [\d,]+–[\d,]+/.test(t) && /tracked (position|order)/.test(t), tag + ': hover card "' + t.replace(/\n/g, ' | ') + '"');
    }
    await tap(p, phone, bx.x, bx.y); await sleep(600);
    const pt = await panelText(p);
    check((kind === 'liq' ? /liquidations [\d,]+–[\d,]+/.test(pt) && (/Long liquidations/.test(pt) ? /Long \d+x · liq/.test(pt) && !/Short \d+x/.test(pt) : /Short \d+x · liq/.test(pt) && !/Long \d+x/.test(pt)) : /triggers [\d,]+–[\d,]+/.test(pt) && /Stop loss|Take profit/.test(pt)) && /of cluster/.test(pt) && covRe.test(pt), tag + ': ' + kind + ' cluster tap -> wallets + coverage line' + (/of cluster/.test(pt) ? '' : ' GOT ' + JSON.stringify(pt.slice(0, 200)) + ' at ' + JSON.stringify(bx)));
    if (kind === 'liq') {
      await shot(p, 'wi-' + tag + '-cluster.png');
      tracked = await p.evaluate(() => window.__stkWalletIntel.view.c.wallets[0].a);
      // tap its biggest wallet -> a TRACKED profile (positions with liquidation price)
      await p.evaluate(() => document.querySelector('#stkwi .stkwi-row').click()); await sleep(1200);
      const wt = await panelText(p);
      check(/Account value/.test(wt) && /Open positions/.test(wt) && /entry [\d,.]+ · liq/.test(wt) && wt.includes(tracked), tag + ': tracked wallet profile with positions + liq price');
      const links = await p.evaluate(() => ({ copy: !!document.querySelector('#stkwi .stkwi-copy'), ext: (document.querySelector('#stkwi .stkwi-ext') || {}).href || '', back: !document.querySelector('#stkwi .stkwi-back').hidden }));
      check(links.copy && links.ext === 'https://app.hyperliquid.xyz/explorer/address/' + tracked && links.back, tag + ': copy button, explorer link, back button');
      await shot(p, 'wi-' + tag + '-wallet.png');
      await p.evaluate(() => document.querySelector('#stkwi .stkwi-back').click()); await sleep(300);
      check(/liquidations [\d,]+–/.test(await panelText(p)), tag + ': back -> the cluster again');
    }
  }
  // the candle: fixture minute, or (E2E) the last whole minute the server holds
  await p.evaluate(() => window.__stkWalletIntel.close());
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const rb = ws.chart.orchestrator.rawBars; if (rb.length > 50 && rb[1].time - rb[0].time === 60000) break; } }); await sleep(800);
  await p.evaluate((t) => { window.STRYKER_VELA.chart.setVisibleRange({ from: t - 40 * 60000, to: t + 20 * 60000 }); }, CANDLE.from); await sleep(1200);
  const cg = await p.evaluate((t) => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; const b = rb.find((x) => x.time === t); if (!b) return null; const a = window.__stkWalletIntel._xy(t, (b.high + b.low) / 2); return a && { x: a.x, y: a.y }; }, CANDLE.from);
  // the fixture minute (Nov 7 ~17:56 UTC) is only on the chart while it is within the bars loaded; a real tap is checked when it is
  if (cg) {
    await tap(p, phone, cg.x, cg.y); await sleep(900);
    const v = await p.evaluate(() => window.__stkWalletIntel.view);
    check(v && v.kind === 'candle' && v.from === CANDLE.from && v.to === CANDLE.from + 60000, tag + ': real tap on the candle opened its wallets');
  } else console.log('NOTE ' + tag + ': candle ' + CANDLE.from + ' not in the loaded bars; opened through the API');
  let pt = await panelText(p);
  if (!/Volume/.test(pt)) { await p.evaluate((c) => window.__stkWalletIntel.openCandle('BTC', c.from, c.to), CANDLE); await sleep(1200); pt = await panelText(p); }
  const usdS = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : '$' + (v >= 1e4 ? Math.round(v / 1e3) : (v / 1e3).toFixed(1).replace(/\.0$/, '')) + 'K');
  check(/BTC · 1m candle/.test(pt) && pt.includes('Volume\n' + usdS(CANDLE.tot.ntl)) && pt.includes('Trades\n' + CANDLE.tot.trades) && pt.includes('Wallets\n' + CANDLE.tot.wallets), tag + ': candle totals = server (' + usdS(CANDLE.tot.ntl) + ', ' + CANDLE.tot.trades + ' trades, ' + CANDLE.tot.wallets + ' wallets)');
  const pb = Math.round(CANDLE.tot.takerBuyNtl / (CANDLE.tot.takerBuyNtl + CANDLE.tot.takerSellNtl) * 100);
  check(pt.includes('Market buys ' + usdS(CANDLE.tot.takerBuyNtl) + ' · ' + pb + '%'), tag + ': taker split ' + pb + '%');
  const nrows = await p.evaluate(() => document.querySelectorAll('#stkwi .stkwi-row').length);
  check(nrows === CANDLE.wallets.length, tag + ': ' + nrows + ' wallet rows = server');
  check(/% of volume/.test(pt) && /(Bought|Sold) [\d.,]+ at 7\d,\d{3}/.test(pt), tag + ': rows show size, avg price and % of volume');
  check(!CANDLE.others || /Smaller wallets together: \$/.test(pt), tag + ': smaller wallets summed line');
  const ov = await p.evaluate(() => { const b = document.querySelector('#stkwi .stkwi-body'), pn = document.getElementById('stkwi').getBoundingClientRect(); return { sx: b.scrollWidth - b.clientWidth, right: pn.right <= window.innerWidth + 1, docx: document.documentElement.scrollWidth - window.innerWidth }; });
  check(ov.sx <= 1 && ov.right && ov.docx <= 1, tag + ': no horizontal overflow ' + JSON.stringify(ov));
  const tgt = await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-ib:not([hidden]), #stkwi .stkwi-row')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check(tgt.length && Math.min(...tgt) >= 44, tag + ': tap targets >= 44 px (min ' + Math.min(...tgt) + ')');
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-body').scrollTo(0, 0));
  await shot(p, 'wi-' + tag + '-candle.png');
  await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-seg button')].find((b) => b.textContent === 'Net sellers').click()); await sleep(200);
  const sellers = await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-row .stkwi-l2:not(.stkwi-r .stkwi-l2)')].every((e) => e.classList.contains('dn')));
  check(sellers, tag + ': Net sellers filter');
  await p.evaluate(() => [...document.querySelectorAll('#stkwi .stkwi-seg button')].find((b) => b.textContent === 'All').click()); await sleep(200);
  // a candle wallet -> its profile (tracked or not, the panel says which)
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-row').click()); await sleep(1200);
  pt = await panelText(p);
  check(/Account value/.test(pt) && (/Open positions/.test(pt)) && (/We do not track this wallet/.test(pt) || /entry /.test(pt) || /No open positions/.test(pt)), tag + ': candle wallet -> profile (tracked or plainly untracked)');
  await p.evaluate(() => document.querySelector('#stkwi .stkwi-back').click()); await sleep(300);
  check(/1m candle/.test(await panelText(p)), tag + ': back -> the candle again');
  // a candle outside the data held -> the plain empty state
  await p.evaluate((c) => window.__stkWalletIntel.openCandle('BTC', c.held - 3600000, c.held - 3540000), CANDLE); await sleep(1200);
  check(/No wallet data for this candle: wallet data starts/.test(await panelText(p)), tag + ': candle before the data starts -> empty state');
  // named wallet (public leaderboard name + tags)
  if (!LIVE) {
    await p.evaluate(() => window.__stkWalletIntel.openWallet('0x7fdafde5cfb5465924316eced2d3715494c517d1', 'BTC')); await sleep(900);
    const nt = await panelText(p);
    check(/BobbyBigSize/.test(nt) && /Whale/.test(nt) && /Top 100 volume/.test(nt) && /30-day volume/.test(nt), tag + ': named wallet shows its public name and tags');
  }
  // book panel: tap a Book row -> tracked wallets at that level
  await p.evaluate(() => window.__stkWalletIntel.close());
  const bp = await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkbp-phonebtn' : '.stkbp-railbtn'); if (!b || b.hidden) return false; b.click(); return true; }, phone);
  check(bp, tag + ': book panel button on a Hyperliquid chart');
  let r0 = null;
  for (let i = 0; i < 30 && !r0; i++) { await sleep(500); r0 = await p.evaluate(() => { const r = [...document.querySelectorAll('#stkbp .stkbp-r.is-bid')].find((x) => x.dataset.p && x.offsetParent); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, p: r.dataset.p }; }); }
  check(!!r0, tag + ': book rows (real Hyperliquid book)');
  if (r0) {
    await tap(p, phone, r0.x, r0.y); await sleep(1200);
    const v = await p.evaluate(() => window.__stkWalletIntel.view);
    pt = await panelText(p);
    const lvHit = /Bid [\d.,]+ at/.test(pt), lvNone = /No tracked wallet has an order at this price/.test(pt);
    check(v && v.kind === 'level' && Math.abs(v.px - r0.p) / r0.p < 5e-4 /* the real book re-renders between read and tap */ && /BTC orders at/.test(pt) && /orders updated/.test(pt) && (lvHit || lvNone), tag + ': book row tap -> ' + (lvHit ? 'tracked wallets' : 'no tracked order (honest empty state)') + ' at ' + r0.p + (lvHit || lvNone ? '' : ' GOT ' + JSON.stringify(pt.slice(0, 160)) + ' view ' + JSON.stringify(v && { kind: v.kind, px: v.px })));
    if (!lvHit) {
      // find a row the tracked wallets do sit on (E2E: from the server; fixtures: the one real bid at 75532)
      const px = LIVE ? await (async () => { const mid = cl.mid; const j = await (await fetch(LIVE + '/hl-level?coin=BTC&lo=' + Math.floor(mid * 0.995) + '&hi=' + Math.ceil(mid))).json(); const l = j.levels.filter((x) => x.side === 'bid').sort((a, b) => b.px - a.px)[0]; return l && l.px; })() : 75532;
      if (px) { await p.evaluate((x) => window.__stkWalletIntel.openLevel('BTC', x, 0, 0), px); await sleep(1200); pt = await panelText(p); check(/Bid [\d.,]+ at/.test(pt), tag + ': level ' + px + ' -> its tracked wallets'); }
    }
    await shot(p, 'wi-' + tag + '-level.png');
  }
  await p.evaluate(() => window.__stkWalletIntel.close());
  await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkbp-phonebtn' : '.stkbp-railbtn'); if (b) b.click(); }, phone); await sleep(300);
  const words = await p.evaluate(() => [...document.querySelectorAll('.stk-wi-tip,.stk-wi-chip,#stkwi')].map((x) => x.textContent).join(' ') + ' ' + document.querySelector('#stkwi .stkwi-foot').textContent);
  check(/Education only\. Not financial advice\./.test(words) && covRe.test(words), tag + ': footer: coverage line + education line');
  check(!/real-time|realtime|\blive\b/i.test(words), tag + ': no real-time / live wording');
  check(!/intel ?trade|hypurrscan|hyperdash|coinglass|nansen|arkham/i.test(words), tag + ': no rival or vendor names');
  // other symbols: a spot pair and another venue -> the perps note
  await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT')); await sleep(2500);
  check(/Wallet Intel works on Hyperliquid perps/.test(await chip(p)), tag + ': other venue -> Hyperliquid perps note');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  walletBody = (await import('../../workers/book-recorder/src/hl.js')).walletBody;
  if (LIVE) {
    const m = await (await fetch(LIVE + '/hl-meta')).json();
    const from = m.updated - 60000;
    CANDLE = await (await fetch(LIVE + '/hl-candle?coin=BTC&from=' + from + '&to=' + m.updated + '&n=50')).json();
    console.log('E2E against ' + LIVE + ': tracked ' + m.tracked + ', oiPct ' + m.oiPct + ', candle ' + new Date(from).toISOString() + ' ' + CANDLE.tot.trades + ' trades');
  }
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
