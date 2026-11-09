// Rithmic order entry (ADMIN-ONLY, paper / test only) browser test against the LOCAL mock. Never a real Rithmic server.
//   node tools/tests/chart-dev-server.mjs 8031 &   node tools/tests/rithmic-mock.mjs 8765 &
//   CHART_BASE=http://127.0.0.1:8031 RITHMIC_MOCK=ws://127.0.0.1:8765 flock /tmp/stryker-chrome.lock node tools/tests/rithmic-trade-browser.js <shotsDir>
// Fake login demo-trade / demo-pass (mock only). Prices from the mock are SYNTHETIC test data.
// Checks: member never downloads rithmic-trade*.js and sees nothing; admin: button + Paper/Test badge, live system refused,
// login, account picker, market / limit / stop / bracket through the confirm sheet, modify (panel + chart line drag),
// cancel, flatten & cancel all, P&L / position panel, DOM ladder click hook, order log, no credentials in DOM/log.
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const CTL = MOCK.replace(/^ws/, 'http') + '/__trade/';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined && !ok ? ' ' + JSON.stringify(x).slice(0, 1500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctl = async (c) => (await fetch(CTL + c)).json();

async function open(b, { w, h, mobile, theme, admin }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([theme, admin, mock]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night');
      localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: mock })); localStorage.removeItem('stk.rtrade.prefs'); } catch (e) {}
    window.__stkChartTestFree = true;
    const t = setInterval(() => {
      const fb = window.firebase, base = window.__stubDb; if (!fb || !base || base.__rt) return; clearInterval(t);
      const db = Object.assign({}, base, { __rt: 1, collection: (n) => { const c = base.collection(n); return n === 'admins' ? Object.assign({}, c, { doc: (id) => Object.assign({}, c.doc(id), { get: () => Promise.resolve({ id, exists: admin, data: () => ({}) }) }) }) : c; } });
      window.__stubDb = db; window.db = db; fb.firestore = Object.assign(() => db, fb.firestore);
    }, 0);
  }, [theme, admin, MOCK]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = [], loaded = [], frames = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Firestore|FirebaseError|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('request', (r) => loaded.push(r.url()));
  p.on('websocket', (ws) => { if (ws.url().startsWith(MOCK)) ws.on('framesent', () => frames.push(ws.url())); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:ES1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:ES1!') break; } });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(2500);
  return { ctx, p, errors, loaded, frames };
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e && !e.hidden ? e.innerText : ''; }, sel);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const setF = (p, f, v) => p.evaluate(([f, v]) => { const e = document.querySelector('#stkrt [data-f="' + f + '"]'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [f, v]);
const waitFor = async (p, fn, arg, ms = 10000) => { try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const sheetOpen = (p) => waitFor(p, () => { const s = document.getElementById('stkrt-cf'); return s && !s.hidden; }, null, 5000);
const sess = (p, fn) => p.evaluate(fn);

async function login(p, system) {
  await click(p, '#stkrt-btn');
  await waitFor(p, () => [...document.querySelectorAll('#stkrt-sys option')].some((o) => o.textContent === 'Rithmic Test'));
  await p.evaluate(([s]) => { const e = document.getElementById('stkrt-sys'); [...e.options].forEach((o) => { if (o.textContent === s) e.value = o.value || o.textContent; }); }, [system]);
  await p.fill('#stkrt-user', 'demo-trade'); await p.fill('#stkrt-pass', 'demo-pass');
  await click(p, '#stkrt [data-a="connect"]');
}
// place an order through the ticket and the confirm sheet
async function place(p, o) {
  await p.evaluate((o) => { const T = window.__stkRtTest.S.t; Object.assign(T, { side: o.side, type: o.type, qty: 1, price: '', trigger: '', tp: '', sl: '' }, o.f || {}); window.__stkRtTest.render(); }, o);
  await waitFor(p, () => { const b = document.querySelector('#stkrt [data-a="review"]'); return b && !b.disabled; });
  await click(p, '#stkrt [data-a="review"]');
  const open = await sheetOpen(p);
  const sheet = await txt(p, '#stkrt-cf');
  await click(p, '#stkrt-cf [data-ok]');
  await sleep(700);
  return { open, sheet };
}

async function run(b, tag, o) {
  await ctl('reset');
  const { ctx, p, errors, loaded, frames } = await open(b, o);
  const tradeJs = () => loaded.filter((u) => /rithmic-trade(-core)?\.js/.test(u));
  if (!o.admin) {
    await sleep(2000);
    check(!(await p.evaluate(() => !!document.getElementById('stkrt-btn') || !!document.getElementById('stkrt') || !!window.__stkRithmicTrade)), tag + ': member sees no trading button / panel / hook');
    check(tradeJs().length === 0, tag + ': member never downloads rithmic-trade.js or rithmic-trade-core.js', tradeJs());
    check(!errors.length, tag + ': no page errors', errors);
    await ctx.close(); return;
  }
  check(await waitFor(p, () => !!document.getElementById('stkrt-btn')), tag + ': admin sees the Paper button');
  check(tradeJs().length === 2, tag + ': admin loaded the trading module + core', tradeJs());
  // a live system is refused before any socket (fake: try the core directly with the mock url)
  const refused = await p.evaluate(async () => { const C = await import('/assets/rithmic-trade-core.js?v=' + document.querySelector('meta[name="stryker-build"]').content);
    const s = new C.TradeSession({ gateway: 'wss://rprotocol.rithmic.com:443', appName: 'x', WebSocketImpl: class { constructor() { throw new Error('socket opened'); } } });
    try { await s.connect({ user: 'u', password: 'p', systemName: 'Rithmic 01' }); return 'connected?!'; } catch (e) { return e.message; } });
  check(/limited to Rithmic Test and Rithmic Paper Trading/.test(refused), tag + ': live system refused before any socket', refused);
  // the mock's ES price is synthetic (~3333); move it next to the chart's own last price so order lines sit on screen (drag test + shots)
  await waitFor(p, () => { try { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return b.length > 0 && b[b.length - 1].close > 0; } catch (e) { return false; } }, null, 30000);
  const chartPx = await p.evaluate(() => { try { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return b[b.length - 1].close; } catch (e) { return 0; } });
  if (chartPx > 0) await ctl('base?sym=ESZ6&px=' + chartPx);
  console.log('INFO mock ES base set to the chart price: ' + chartPx);
  await click(p, '#stkrt-btn');
  await waitFor(p, () => [...document.querySelectorAll('#stkrt-sys option')].length > 1);
  const sysList = await p.evaluate(() => [...document.querySelectorAll('#stkrt-sys option')].map((x) => x.textContent));
  check(sysList.every((s) => s === 'Rithmic Test' || s === 'Rithmic Paper Trading') && sysList.includes('Rithmic Test'), tag + ': system picker lists only paper / test systems', sysList);
  let t = await txt(p, '#stkrt');
  check(/Paper \/ Test/i.test(t) && /Education only\. Not financial advice\./.test(t) && /Live accounts are refused/.test(t), tag + ': login panel: Paper / Test badge, education line, live refused note');
  if (o.shots) await shot(p, 'rt-' + tag + '-login.png');
  await click(p, '#stkrt [data-a="close"]');
  await login(p, 'Rithmic Test');
  check(await waitFor(p, () => window.__stkRtTest.sess && window.__stkRtTest.sess.state === 'ready', null, 15000), tag + ': connected + synced (ready)');
  check(await p.evaluate(() => document.getElementById('stkrt-pass') === null || document.getElementById('stkrt-pass').value === ''), tag + ': password field gone / cleared');
  check(await waitFor(p, () => { const x = document.getElementById('stkrt-pill'); return x && !x.hidden && /Paper \/ Test/.test(x.textContent); }), tag + ': chart pill "Paper / Test" visible');
  check(await waitFor(p, () => { const b = document.querySelector('#stkrt [data-a="review"]'); return b && !b.disabled; }, null, 12000), tag + ': fresh prices unlock the ticket');
  const accts = await p.evaluate(() => [...document.querySelectorAll('#stkrt [data-f="acct"] option')].map((x) => x.value));
  check(accts.join() === 'PAPER-1,PAPER-2', tag + ': account picker from the account list', accts);
  // market buy -> long 1
  let r = await place(p, { side: 'buy', type: 'market' });
  check(r.open && /Buy ESZ6/.test(r.sheet) && /Paper \/ Test/i.test(r.sheet) && /No real money/.test(r.sheet) && /Rithmic Test/.test(r.sheet), tag + ': confirm sheet before the market order', r.sheet);
  check(await waitFor(p, () => /Long 1 ESZ6/.test(document.getElementById('stkrt').innerText)), tag + ': position panel: Long 1 ESZ6');
  check(await waitFor(p, () => /Bought 1 ESZ6/.test(document.getElementById('stkrt').innerText)), tag + ': fills list shows the fill');
  check(await waitFor(p, () => /\$/.test((document.querySelector('[data-live="bal"]') || {}).textContent || '')), tag + ': balance from the P&L plant');
  check(await p.evaluate(() => !!document.querySelector('#stkrt [data-a="flatten"]')), tag + ': Flatten & cancel all visible with a position');
  // size cap: qty + stepper stops at 1 by default
  await p.evaluate(() => { window.__stkRtTest.S.t.qty = 1; window.__stkRtTest.render(); }); await click(p, '#stkrt [data-a="qty"][data-v="1"]');
  check(await p.evaluate(() => document.querySelector('#stkrt .stkrt-step output').textContent === '1'), tag + ': quantity capped at 1 (default max)');
  // limit buy below the market -> working; then modify; then cancel
  const bid = await sess(p, () => window.__stkRtTest.sess.quote('ESZ6').bid);
  r = await place(p, { side: 'buy', type: 'limit', f: { price: String(bid - 10) } });
  check(r.open && /Limit price/.test(r.sheet), tag + ': limit confirm sheet');
  check(await waitFor(p, () => window.__stkRtTest.sess.working('PAPER-1').some((o) => o.type === 'limit')), tag + ': limit order working');
  if (o.shots) await shot(p, 'rt-' + tag + '-working.png');
  const bk = await sess(p, () => window.__stkRtTest.sess.working('PAPER-1').find((o) => o.type === 'limit').basket);
  // chart line: present with a chip
  check(await waitFor(p, () => !!document.querySelector('.stkrt-chip[data-rt^="o"]')), tag + ': order line chip on the chart');
  // modify from the panel
  await p.evaluate(([b, v]) => { const i = document.querySelector('#stkrt [data-mv="' + b + '"]'); i.value = String(v); }, [bk, bid - 12]);
  await click(p, '#stkrt [data-a="move"][data-v="' + bk + '"]');
  check(await sheetOpen(p) && /Move order/.test(await txt(p, '#stkrt-cf')), tag + ': modify goes through the confirm sheet');
  await click(p, '#stkrt-cf [data-ok]');
  check(await waitFor(p, ([b, v]) => window.__stkRtTest.sess.orders.get(b).price === v, [bk, bid - 12]), tag + ': modify applied (price moved)');
  // drag the line (Chart trading off -> nothing); on -> confirm sheet
  const chipBox = async () => p.evaluate(() => { const c = document.querySelector('.stkrt-chip[data-rt^="o"]'); const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  if (!o.mobile) {
    let c = await chipBox(); await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x, c.y + 40, { steps: 5 }); await p.mouse.up(); await sleep(400);
    check(!(await p.evaluate(() => { const s = document.getElementById('stkrt-cf'); return s && !s.hidden; })), tag + ': drag does nothing while Chart trading is off');
    await p.evaluate(() => { window.__stkRtTest.S.prefs.chart = true; });
    c = await chipBox(); await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x, c.y + 40, { steps: 8 }); await p.mouse.up();
    const dragged = await sheetOpen(p);
    check(dragged && /Move order/.test(await txt(p, '#stkrt-cf')), tag + ': drag with Chart trading on -> Move order confirm sheet');
    await click(p, '#stkrt-cf [data-ok]');
    check(await waitFor(p, ([b, v]) => window.__stkRtTest.sess.orders.get(b).price < v, [bk, bid - 12]), tag + ': drag modify applied (lower price)');
  }
  await click(p, '#stkrt [data-a="cancel"][data-v="' + bk + '"]');
  check(await waitFor(p, (b) => window.__stkRtTest.sess.orders.get(b).kind === 'done', bk), tag + ': cancel applied');
  // stop above the market
  const ask = await sess(p, () => window.__stkRtTest.sess.quote('ESZ6').ask);
  await sleep(2100);
  r = await place(p, { side: 'buy', type: 'stop', f: { trigger: String(ask + 10) } });
  check(r.open && /Stop price/.test(r.sheet) && await waitFor(p, () => window.__stkRtTest.sess.working('PAPER-1').some((o) => o.type === 'stop')), tag + ': stop order working');
  // bracket: sell 1 market with TP 40 / SL 40 (wide: the mock price wanders ~12 ticks, a tight stop would fill at once)
  if (!o.mobile) await sleep(10500);  // desktop adds the drag modify: wait out the 5-actions-per-10 s guard (tested in the unit tests)
  r = await place(p, { side: 'sell', type: 'market', f: { tp: '40', sl: '40' } });
  check(r.open && /Take profit\s*40 ticks/.test(r.sheet) && /Stop loss\s*40 ticks/.test(r.sheet), tag + ': bracket confirm sheet shows TP / SL', r.sheet);
  check(await waitFor(p, () => window.__stkRtTest.sess.working('PAPER-1').filter((o) => o.parent).length === 2), tag + ': bracket children (TP + SL) working', await p.evaluate(() => JSON.stringify([...window.__stkRtTest.sess.orders.values()].slice(-4).map((o) => [o.kind, o.type, o.side, o.price, o.trigger, o.parent, o.status, o.reason]))) + ' ' + JSON.stringify(await ctl('state')).slice(0, 600));
  check(await waitFor(p, () => document.querySelectorAll('.stkrt-chip').length >= 3), tag + ': TP / SL / stop lines on the chart');
  // a working limit one tick from the bracket's take-profit line: the chips must stack, not overlap each other or the legend
  if (o.shots) await shot(p, 'rt-' + tag + '-bracket.png');
  // synthetic lines (test hook, no orders): three lines 6 px apart in mid-chart + one at the very top edge of the plot
  const ov0 = await p.evaluate(async () => {
    const T = window.__stkRtTest; const c0 = T.inject([]); const a = c0.args; if (!a) return null;
    const co = a.coords, y0 = a.bounds.top + a.bounds.height / 2, p1 = co.priceToY(7420, a.scale, a.bounds), p2 = co.priceToY(7421, a.scale, a.bounds);
    const at = (y) => 7420 + (y - p1) / (p2 - p1);
    const mk = (id, y, ex) => Object.assign({ id, price: at(y), color: '#0ea5e9', solid: false, a: id.toUpperCase(), b: String(Math.round(at(y))), drag: false }, ex || {});
    const lines = [mk('o1', y0), mk('o2', y0 + 6, { basket: 'x' }), mk('o3', y0 + 14), mk('o4', a.bounds.top + 1)];
    T.inject(lines); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const chips = [...document.querySelectorAll('.stkrt-chip')].filter((c) => c.style.visibility !== 'hidden').map((c) => c.getBoundingClientRect());
        const cell = document.querySelector('.stkrt-chip').closest('.vela-cell');
        const leg = cell ? [...cell.querySelectorAll('.vela-statusline, .vela-legend')].map((l) => l.getBoundingClientRect()).filter((r) => r.height) : [];
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        let cc = 0, cl = 0; chips.forEach((a, i) => { chips.slice(i + 1).forEach((b) => { if (hit(a, b)) cc++; }); leg.forEach((l) => { if (hit(a, l)) cl++; }); });
        return { n: chips.length, leg: leg.length, cc, cl };
  });
  const ov = ov0 || {}; check(!!ov0 && ov.n >= 4 && ov.cc === 0, tag + ': chips never overlap each other', JSON.stringify(ov));
  check(ov.cl === 0, tag + ': chips stay clear of the legend rows', JSON.stringify(ov));
  check(await p.evaluate(() => ['tp', 'sl'].every((k) => { const i = document.querySelector('#stkrt [data-f="' + k + '"]'); const l = i && document.querySelector('label[for="' + i.id + '"]'); return l && /\(ticks\)$/.test(l.textContent) && i.offsetHeight >= 44; })), tag + ': TP / SL have visible labels and 44 px inputs');
  if (o.shots) await shot(p, 'rt-' + tag + '-stacked.png');
  // DOM ladder click: hook only acts with Chart trading on; bid cell -> buy limit confirm
  await p.evaluate(() => { window.__stkRtTest.S.prefs.chart = false; });
  check(await p.evaluate(() => window.__stkRithmicTrade.domClick('bid', 3300, 3330, 3330.25, 'ES1!') === false), tag + ': DOM click ignored while Chart trading is off');
  await p.evaluate(() => { window.__stkRtTest.S.prefs.chart = true; });
  const b2 = await sess(p, () => window.__stkRtTest.sess.quote('ESZ6').bid);
  check(await p.evaluate((b) => window.__stkRithmicTrade.domClick('bid', b - 5, b, b + 0.25, 'ES1!') === true, b2), tag + ': DOM bid click handled');
  check(await sheetOpen(p) && /Buy ESZ6/.test(await txt(p, '#stkrt-cf')) && /Limit/.test(await txt(p, '#stkrt-cf')), tag + ': DOM bid click -> buy limit confirm sheet');
  await click(p, '#stkrt-cf [data-x]'); await sleep(300);
  // flatten & cancel all
  if (o.shots) await shot(p, 'rt-' + tag + '-panel.png');
  await click(p, '#stkrt [data-a="flatten"]');
  check(await sheetOpen(p) && /Flatten & cancel all/.test(await txt(p, '#stkrt-cf')), tag + ': flatten confirm sheet');
  if (o.shots) await shot(p, 'rt-' + tag + '-flatten-sheet.png');
  await click(p, '#stkrt-cf [data-ok]');
  check(await waitFor(p, () => { const s = window.__stkRtTest.sess; return s.working('PAPER-1').length === 0 && (s.position('PAPER-1', 'ESZ6') || {}).net === 0; }), tag + ': flat with no working orders');
  check(await waitFor(p, () => !document.querySelector('#stkrt [data-a="flatten"]')), tag + ': flatten button gone when flat');
  check(await waitFor(p, () => document.querySelectorAll('.stkrt-chip').length === 0), tag + ': chart lines cleared');
  // stale prices lock the ticket
  await ctl('freeze?on=1');
  check(await waitFor(p, () => { const b = document.querySelector('#stkrt [data-a="review"]'); return b && b.disabled && /fresh prices/.test(b.textContent); }, null, 9000), tag + ': stale prices (>5 s) disable the order button');
  await ctl('freeze?on=0');
  // log + no credentials anywhere
  const log = await sess(p, () => window.__stkRtTest.sess.log.map((e) => e.action + ':' + e.result).join(' '));
  for (const k of ['login:ok', 'new order:accepted', 'modify:accepted', 'cancel:accepted', 'flatten:sent']) check(log.includes(k), tag + ': log has ' + k);
  check(await p.evaluate(() => !/demo-pass/.test(document.body.innerHTML + JSON.stringify(window.__stkRtTest.sess.log) + JSON.stringify(localStorage))), tag + ': no password in DOM, log or localStorage');
  const st = await ctl('state');
  check(st.trade.nonPaper.length === 0, tag + ': mock saw no order on a non-paper system');
  check(!errors.length, tag + ': no page errors', errors);
  // disconnect locks
  await fetch(MOCK.replace(/^ws/, 'http') + '/__drop');
  check(await waitFor(p, () => /Disconnected\. Trading is locked/.test(document.getElementById('stkrt').innerText)), tag + ': dropped connection -> "Trading is locked"');
  if (o.shots) await shot(p, 'rt-' + tag + '-locked.png');
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    await run(b, 'member-1440', { w: 1440, h: 900, admin: false });
    await run(b, 'member-390', { w: 390, h: 844, mobile: true, admin: false });
    await run(b, '1440-dark', { w: 1440, h: 900, admin: true, theme: 'dark', shots: true });
    await run(b, '1440-light', { w: 1440, h: 900, admin: true, theme: 'light', shots: true });
    await run(b, '390-dark', { w: 390, h: 844, mobile: true, admin: true, theme: 'dark', shots: true });
    await run(b, '390-light', { w: 390, h: 844, mobile: true, admin: true, theme: 'light', shots: true });
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
