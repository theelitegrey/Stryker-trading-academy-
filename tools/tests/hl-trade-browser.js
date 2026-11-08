// Browser test: Hyperliquid trading panel (assets/hl-trade.js, ADMIN-ONLY beta, testnet) on ZoroCharts, hyperliquid:BTC.
//   node tools/tests/chart-dev-server.mjs 8394 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8394 node tools/tests/hl-trade-browser.js [shotsDir]
// Chart bars come from the real public Hyperliquid mainnet API (market data only). The TESTNET trading API is MOCKED:
//   /info answers = tools/fixtures/hl-trade/*.json (real testnet answers for a public testnet address, captured 2026-11-08);
//   /exchange checks every L1 signature recovers the agent key the wallet approved, records the action, and answers like HL.
// The wallet is a mock EIP-1193 provider that signs typed data with a throwaway key (in the page), as MetaMask would.
// Checks: hidden for non-admins; geo block (US); connect -> account (equity, positions, orders, fills); enable trading =
// approveAgent signed by the wallet; limit order -> confirm sheet (every field + custody line) -> order action signed by the
// agent; caps (max notional); cancel; close position; chart lines (entry / order chips), drag to modify -> batchModify;
// no withdraw/transfer action is ever sent; plain-English error; no request to any non-Hyperliquid order endpoint.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8394';
const OUT = process.argv[2] || '/tmp';
const FX = (n) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'hl-trade', n), 'utf8');
const USER = JSON.parse(FX('README.json')).user;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, theme, admin = true, country = 'IN' }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([theme, admin, user]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.removeItem('stryker.vela.session'); } catch (e) {}
    window.__stkChartTestFree = true;
    // admins/{uid}: exists only for the admin run
    const t = setInterval(() => {
      const fb = window.firebase, base = window.__stubDb; if (!fb || !base || base.__hl) return; clearInterval(t);
      const db = Object.assign({}, base, { __hl: 1, collection: (n) => { const c = base.collection(n); return n === 'admins' ? Object.assign({}, c, { doc: (id) => Object.assign({}, c.doc(id), { get: () => Promise.resolve({ id, exists: admin, data: () => ({}) }) }) }) : c; } });
      window.__stubDb = db; window.db = db; fb.firestore = Object.assign(() => db, fb.firestore);
    }, 0);
    // mock injected wallet (EIP-1193): address = the fixture account; signs typed data with a throwaway key in the page
    const wallet = { calls: [] };
    window.__mockWallet = wallet;
    window.ethereum = {
      isMetaMask: true,
      on() {},
      async request({ method, params }) {
        wallet.calls.push(method);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [user];
        if (method === 'eth_chainId') return '0xa4b1';
        if (method === 'eth_signTypedData_v4') {
          const C = await import('/assets/hl-trade-core.js?v=' + document.querySelector('meta[name="stryker-build"]').content);
          const typed = JSON.parse(params[1]); wallet.lastTyped = typed;
          if (!wallet.key) wallet.key = C.newAgentKey();
          const s = await C.signDigest(C.typedDataDigest(typed), wallet.key);
          return s.r + s.s.slice(2).padStart(64, '0') + s.v.toString(16);
        }
        throw Object.assign(new Error('unsupported ' + method), { code: 4200 });
      },
    };
  }, [theme, admin, USER]);
  const sent = [], bad = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.hyperliquid\.xyz|api\.hyperliquid-testnet\.xyz)/, (r) => r.abort());
  await ctx.route(/\/api\/hl-geo/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ country, region: '' }) }));
  await ctx.routeWebSocket(/api\.hyperliquid-testnet\.xyz\/ws/, () => {});   // account stream: stays quiet (REST fixtures are the state)
  const cors = { 'access-control-allow-origin': '*' };
  let agent = '';
  await ctx.route(/api\.hyperliquid\.xyz\/exchange/, (r) => { bad.push('MAINNET ' + r.request().postData()); r.abort(); });
  await ctx.route(/api\.hyperliquid-testnet\.xyz\/(info|exchange)/, async (r) => {
    const req = r.request(); const body = JSON.parse(req.postData() || '{}');
    const send = (j) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: typeof j === 'string' ? j : JSON.stringify(j) });
    if (req.url().endsWith('/info')) {
      const map = { meta: 'meta.json', allMids: 'allMids.json', clearinghouseState: 'clearinghouseState.json', frontendOpenOrders: 'frontendOpenOrders.json', userFills: 'userFills.json', userFees: 'userFees.json' };
      if (body.type === 'maxBuilderFee') return send('0');
      return map[body.type] ? send(FX(map[body.type])) : send({});
    }
    // /exchange: verify the signature with our core (in node), record, answer like Hyperliquid
    const C = await import('../../assets/hl-trade-core.js');
    const a = body.action;
    sent.push(a);
    if (!['approveAgent', 'order', 'cancel', 'batchModify', 'updateLeverage'].includes(a.type)) { bad.push('ACTION ' + a.type); return send({ status: 'err', response: 'blocked by test' }); }
    if (a.type === 'approveAgent') { agent = a.agentAddress.toLowerCase(); return send({ status: 'ok', response: { type: 'default' } }); }
    const signer = C.recoverAddress(C.typedDataDigest(C.l1Typed(C.actionHash(a, null, body.nonce, null), false)), body.signature);
    if (signer !== agent) { bad.push('SIGNER ' + signer + ' != agent ' + agent); return send({ status: 'err', response: 'User or API Wallet ' + signer + ' does not exist.' }); }
    if (a.type === 'order' && a.orders[0].s === '0.00002') return send({ status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Order must have minimum value of $10. asset=3' }] } } });
    if (a.type === 'order') return send({ status: 'ok', response: { type: 'order', data: { statuses: a.orders.map((o, i) => (o.t.limit && o.t.limit.tif === 'Ioc' ? { filled: { totalSz: o.s, avgPx: '75800.0', oid: 900 + i } } : i === 0 ? { resting: { oid: 800 + i } } : 'waitingForTrigger')) } } });
    if (a.type === 'cancel') return send({ status: 'ok', response: { type: 'cancel', data: { statuses: a.cancels.map(() => 'success') } } });
    if (a.type === 'batchModify') return send({ status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: a.modifies[0].oid } }] } } });
    return send({ status: 'ok', response: { type: 'default' } });
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|WebSocket|net::|status of 4|status of 5|Failed to load resource|CORS|Firestore|FirebaseError/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('15');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'hyperliquid:BTC' && ws.chart.orchestrator.rawBars.length > 50) break; }
  });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(1500);
  return { ctx, p, errors, sent, bad };
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(500); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e && !e.hidden ? e.innerText : ''; }, sel);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const fill = (p, f, v) => p.evaluate(([f, v]) => { const e = document.querySelector('#stkhl [data-f="' + f + '"]'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [f, v]);
const sheetText = (p) => txt(p, '#stkhl-cf');

async function run(b, tag, o) {
  const { ctx, p, errors, sent, bad } = await open(b, o);
  const btn = await p.evaluate(() => !!document.getElementById('stkhl-btn'));
  if (!o.admin) { check(!btn && !(await p.evaluate(() => !!document.getElementById('stkhl'))), tag + ': non-admin sees no Hyperliquid trading button or panel'); check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300)); await ctx.close(); return; }
  check(btn, tag + ': admin sees the Wallet button');
  await click(p, '#stkhl-btn'); await sleep(1200);
  if (o.country === 'US') {
    const t = await txt(p, '#stkhl');
    check(/not available in your region/.test(t) && !/Connect wallet/.test(t), tag + ': US -> "not available in your region", no connect button');
    await shot(p, 'hl-' + tag + '-geo.png'); await ctx.close(); return;
  }
  let t = await txt(p, '#stkhl');
  check(/Connect wallet/.test(t) && /TradeZoro never holds your funds/.test(t) && /cannot withdraw/i.test(t) && /Education only\. Not financial advice\./.test(t) && /Admin beta · Testnet/.test(t), tag + ': signed-out panel: connect, custody line, cannot withdraw, education line, Admin beta · Testnet');
  if (o.shots) await shot(p, 'hl-' + tag + '-connect.png');
  await click(p, '#stkhl [data-a="connect"]'); await sleep(1500);
  t = await txt(p, '#stkhl');
  check(/Enable trading/.test(t) && /\$358\.60/.test(t) && /0x1b8d…dc03/.test(t), tag + ': connected: address, equity $358.60 (testnet fixture), Enable trading');
  await click(p, '#stkhl [data-a="enable"]'); await sleep(1500);
  const ap = sent.find((a) => a.type === 'approveAgent');
  const typed = await p.evaluate(() => window.__mockWallet.lastTyped);
  check(ap && ap.agentName === 'TradeZoro' && ap.hyperliquidChain === 'Testnet' && ap.signatureChainId === '0xa4b1' && typed.primaryType === 'HyperliquidTransaction:ApproveAgent', tag + ': Enable trading = ONE wallet signature (approveAgent, Testnet, wallet chain id)');
  t = await txt(p, '#stkhl');
  check(/Buy \/ Long/.test(t) && /BTC-USD/.test(t) && /Long 0\.00193 BTC/.test(t) && /Short 0\.1027 ETH/.test(t) && /Open orders/.test(t) && /74,299/.test(t) && /Recent fills/.test(t), tag + ': account: ticket, positions (BTC long, ETH short), open orders, fills');
  check(/Deposit or withdraw on Hyperliquid/.test(t) && await p.evaluate(() => document.querySelector('#stkhl .stkhl-links a').href.startsWith('https://app.hyperliquid-testnet.xyz/')), tag + ': deposits/withdrawals link out to Hyperliquid (not built here)');
  if (o.shots) { await p.evaluate(() => { document.querySelector('#stkhl .stkhl-body').scrollTop = 0; }); await shot(p, 'hl-' + tag + '-panel.png'); }
  // cap: $5,000 order is refused before any signing
  const n0 = sent.length;
  await click(p, '#stkhl [data-k="kind"][data-v="limit"]'); await sleep(200);
  await fill(p, 'px', '74000'); await click(p, '#stkhl [data-k="unit"][data-v="usd"]'); await fill(p, 'size', '5000');
  await click(p, '#stkhl [data-a="review"]'); await sleep(400);
  check(/limit here is \$1,000 per order/.test(await txt(p, '#stkhl')) && sent.length === n0 && !(await sheetText(p)), tag + ': over the per-order cap -> refused in the panel, nothing sent, no sheet');
  // limit buy $200 with TP/SL in points -> confirm sheet
  await fill(p, 'size', '200'); await click(p, '#stkhl [data-k="brMode"][data-v="pts"]'); await fill(p, 'tp', '1000'); await fill(p, 'sl', '500');
  await click(p, '#stkhl [data-a="review"]'); await sleep(500);
  const sh = await sheetText(p);
  check(/Buy BTC/.test(sh) && /Buy \/ long/.test(sh) && /Limit/.test(sh) && /0\.0027 BTC/.test(sh) && /74,000/.test(sh) && /Leverage/.test(sh) && /cross|isolated/.test(sh) && /Est\. fees/.test(sh) && /Est\. liquidation/.test(sh) && /Take profit\s+75,000/.test(sh) && /Stop loss\s+73,500/.test(sh) && /Orders go to Hyperliquid from your wallet\. TradeZoro never holds your funds\./.test(sh), tag + ': confirm sheet: coin, side, type, size, price, leverage + mode, fees, liquidation, TP/SL, custody line');
  if (o.shots) await shot(p, 'hl-' + tag + '-confirm.png');
  await click(p, '#stkhl-cf [data-ok]'); await sleep(1200);
  const ord = sent.filter((a) => a.type === 'order').pop();
  check(ord && ord.grouping === 'normalTpsl' && ord.orders.length === 3 && ord.orders[0].p === '74000' && ord.orders[0].s === '0.0027' && ord.orders[0].t.limit.tif === 'Gtc' && ord.orders[1].t.trigger.tpsl === 'tp' && ord.orders[1].t.trigger.triggerPx === '75000' && ord.orders[2].t.trigger.triggerPx === '73500' && ord.orders[2].r === true && !('builder' in ord), tag + ': order action: GTC limit 0.0027 @ 74000 + TP 75000 + SL 73500 (reduce-only), grouping normalTpsl, no builder (off)');
  // cancelling the sheet sends nothing
  const n1 = sent.length;
  await click(p, '#stkhl [data-a="review"]'); await sleep(400); await click(p, '#stkhl-cf [data-x]'); await sleep(400);
  check(sent.length === n1, tag + ': Cancel on the confirm sheet sends nothing');
  // a tiny market order -> HL error in plain English
  await click(p, '#stkhl [data-k="kind"][data-v="market"]'); await click(p, '#stkhl [data-k="unit"][data-v="coin"]'); await fill(p, 'size', '0.00002'); await fill(p, 'tp', ''); await fill(p, 'sl', '');
  await click(p, '#stkhl [data-a="review"]'); await sleep(400);
  check(/at least \$10/.test(await txt(p, '#stkhl')), tag + ': under $10 -> plain-English message before sending');
  // cancel one order
  await p.evaluate(() => document.querySelector('#stkhl [data-a="cancel"]').click()); await sleep(800);
  const cn = sent.filter((a) => a.type === 'cancel').pop();
  check(cn && cn.cancels.length === 1 && cn.cancels[0].a === 4 && typeof cn.cancels[0].o === 'number', tag + ': Cancel -> cancel action (asset 4 = ETH on testnet)');
  // close the BTC position -> confirm -> reduce-only IOC
  await p.evaluate(() => document.querySelector('#stkhl [data-a="closepos"][data-v="BTC"]').click()); await sleep(400);
  check(/Close BTC/.test(await sheetText(p)) && /reduce-only/.test(await sheetText(p)), tag + ': Close position -> confirm sheet (reduce-only market)');
  await click(p, '#stkhl-cf [data-ok]'); await sleep(800);
  const cl = sent.filter((a) => a.type === 'order').pop();
  check(cl && cl.orders[0].b === false && cl.orders[0].r === true && cl.orders[0].s === '0.00193' && cl.orders[0].t.limit.tif === 'Ioc', tag + ': close = sell 0.00193 BTC, reduce-only IOC');
  // chart lines: entry + BTC order chips on the chart
  await p.evaluate(() => window.__stkHlTrade.pushLines(true)); await sleep(800);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.stkhl-chip')].map((c) => ({ id: c.dataset.id, kind: c.dataset.kind, text: c.innerText.replace(/\n/g, ' '), vis: c.style.visibility !== 'hidden' })));
  check(chips.some((c) => c.kind === 'pos' && /LONG 0\.00193/.test(c.text)) && chips.filter((c) => c.kind === 'ord').length === 3, tag + ': chart: position entry chip + 3 BTC order chips ' + JSON.stringify(chips.map((c) => c.text)));
  // drag a visible order chip -> confirm -> batchModify
  await click(p, '#stkhl [data-a="close"]'); await sleep(300);
  const vis = chips.find((c) => c.kind === 'ord' && c.vis) || chips.find((c) => c.kind === 'pos' && c.vis);
  if (!vis) check(false, tag + ': no visible chip to drag');
  else {
    const box = await p.evaluate((id) => { const r = document.querySelector('.stkhl-chip[data-id="' + id + '"] .a').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, vis.id);
    if (o.shots) await shot(p, 'hl-' + tag + '-chart.png');
    await p.mouse.move(box.x, box.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(box.x, box.y - i * 8); await sleep(30); } await p.mouse.up(); await sleep(500);
    check(/Move order|Set take profit|Set stop loss/.test(await sheetText(p)), tag + ': drag a line -> confirm sheet "' + (await sheetText(p)).split('\n')[0] + '"');
    await click(p, '#stkhl-cf [data-ok]'); await sleep(800);
    const last = sent[sent.length - 1];
    check(last && (last.type === 'batchModify' || (last.type === 'order' && last.grouping === 'positionTpsl')), tag + ': drag committed as ' + (last && last.type));
  }
  check(!bad.length, tag + ': every signed action recovers the approved agent; no mainnet / withdraw / transfer request ' + bad.join(' | '));
  check(!sent.some((a) => /withdraw|send|transfer|vault/i.test(a.type)), tag + ': no withdraw / transfer action ever sent');
  const words = await p.evaluate(() => [document.getElementById('stkhl'), document.getElementById('stkhl-cf')].map((e) => (e ? e.textContent : '')).join(' '));
  check(!/real-time|guarantee|(?<!take )profit(s|able)? |win rate|returns/i.test(words), tag + ': no result / real-time claims in the copy');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark', admin: true, shots: true }], ['1440-light', { w: 1440, h: 900, theme: 'light', admin: true, shots: true }],
      ['412-dark', { w: 412, h: 915, mobile: true, theme: 'dark', admin: true, shots: true }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark', admin: true, shots: true }],
      ['390-light', { w: 390, h: 844, mobile: true, theme: 'light', admin: true, shots: true }],
      ['1440-member', { w: 1440, h: 900, theme: 'dark', admin: false }], ['390-us', { w: 390, h: 844, mobile: true, theme: 'dark', admin: true, country: 'US' }]];
    for (const [tag, o] of runs) { if (only && !tag.includes(only)) continue; await run(b, tag, o); }
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
