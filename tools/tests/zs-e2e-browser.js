// Zscript integration, end to end on the real chart page (hermes/zs-integrate). Fixtures only, no network, no real payments.
//   node tools/tests/chart-fixture-server.mjs 8461 <bars fixture.json> &
//   CHART_BASE=http://127.0.0.1:8461 flock /tmp/stryker-chrome.lock node tools/tests/zs-e2e-browser.js [shotsDir]
// 1. hidden by default: no Zscript editor / tab / library page until ?zs=1 (assets/zs-config.js ZS_LAUNCHED=false)
// 2. write a script, run it, plots reach the chart; the 5 Examples run
// 3. book.* / flow.* as Pro on NQ: values from the data hub (frames -> arrays in the worker); as Free: plan notice, na, no crash
// 4. gex.* / opt.* on SPX (archived SPX GEX fixture tools/tests/fixtures/gex/SPX-0.json, mocked ZoroOptions summary)
// 5. request.security through the hub (the chart's fetchSeries)
// 6. paid protected library script: the REAL /api/zs/get deliver() (functions/api/zs/get.js) answers the page, with a test server key
//    and a Firestore mock that answers like the rules: a buyer runs it (program opened only inside the worker), a non-buyer gets the
//    paid notice and nothing runs; the page never sees the program
// 7. publish from the editor (protected: the program is sealed before it is written), and publish -> listed in the Script Library
// Education only. Not financial advice.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { open, setNQ, launch } = require('./zs-data-browser.js');
const richstub = require('./richstub.js');
const { stub: libStub } = require('../zs-library/browser.test.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8461';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

const SPX0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/tests/fixtures/gex/SPX-0.json'), 'utf8'));
const spxRoute = async (ctx) => {
  await ctx.route(/\/api\/gex\/levels\/SPX/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, SPX0, { fetched_at: Math.floor(Date.now() / 1000) })) }));
};
const spy = (p) => p.evaluate(() => { window.__toasts = []; const o = window.showToast; window.showToast = (t, m, op) => { window.__toasts.push([t, String(m), op && op.action ? op.action.label : '']); try { return o && o(t, m, op); } catch (e) { return Promise.resolve(); } }; });
// run a source on cell 0 and read back its model: last finite value of each series
const runRead = (p, src, title, wait) => p.evaluate(async ([src, title, wait]) => {
  const Z = window.STRYKER_ZS, c = window.STRYKER_VELA.context().cells[0].chart;
  const r = await Z.runOnChart(c, src);
  await new Promise((res) => setTimeout(res, wait));
  const rec = c.orchestrator.registry.all().find((x) => x.model && x.model.title === title);
  const vals = {};
  if (rec) for (const s of rec.model.series || []) { const pts = (s.points || []).filter((q) => q && Number.isFinite(q.value)); vals[s.title] = { n: pts.length, last: pts.length ? pts[pts.length - 1].value : null }; }
  return { ok: r.ok, msg: r.msg || '', on: !!rec, vals, toasts: window.__toasts || [] };
}, [src, title, wait || 3000]);
const clearZs = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_ZS.handles(c).forEach((h) => h.remove()); });

(async () => {
  // ---- server side of the protected-script delivery (real code: functions/api/zs/get.js deliver + assets/creator-seal.js) ----
  const Seal = await import(pathToFileURL(path.join(ROOT, 'assets/creator-seal.js')).href);
  const API = await import(pathToFileURL(path.join(ROOT, 'functions/api/zs/get.js')).href);
  const ZS = await import(pathToFileURL(path.join(ROOT, 'assets/zs/index.js')).href);
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const keyText = JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));   // test key, made here, never stored
  const kj = JSON.parse(keyText), PUB = { kty: kj.kty, crv: kj.crv, x: kj.x, y: kj.y };
  const PAID_SRC = '//@zscript 1\nindicator("Paid band", overlay=true)\nlen = input.int(10, "Length")\nplot(ta.sma(close, len) + 1, "Band")\n';
  const comp = ZS.compile(PAID_SRC);
  const SID = 'P'.repeat(20);
  const bin = await Seal.seal(PUB, JSON.stringify({ kind: 'zsbin', sid: SID, authorUid: 'au', v: 1, program: comp.program }));
  const enc = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v }
    : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, enc(b)])) } } : { nullValue: null });
  const doc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([a, b]) => [a, enc(b)])) });
  let buyer = true, served = [];
  const fsMock = async (url, opt) => {   // answers like the rules: bin/ of the current version only for a buyer
    if (!(opt && opt.headers && opt.headers.authorization)) return new Response('', { status: 401 });
    const p = url.split('/documents/')[1];
    if (p === 'zsScripts/' + SID) return new Response(JSON.stringify(doc({ name: 'Paid band', version: 1, access: 'protected', status: 'live', authorUid: 'au', sale: { mode: 'paid', price: { amount: 19, currency: 'USD' } } })));
    if (p === `zsScripts/${SID}/bin/v1`) return buyer ? new Response(JSON.stringify(doc({ version: 1, sealed: bin }))) : new Response('{}', { status: 403 });
    return new Response('{}', { status: 404 });
  };
  const apiRoute = async (ctx) => {
    await ctx.route(/\/api\/zs\/get/, async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      try {
        const out = await API.deliver({ uid: buyer ? 'buyer' : 'other', token: 't', email: 'x@x.com', verified: true }, body, keyText, fsMock);
        const txt = JSON.stringify({ ok: true, ...out }); served.push(txt);
        r.fulfill({ status: 200, contentType: 'application/json', body: txt });
      } catch (e) { r.fulfill({ status: e.status || 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: e.code, message: e.message }) }); }
    });
  };

  // ---- paid checkout, server side, mocks only: the real creatorPay zsCheckout with firebase-admin mocked and Stripe's API answered
  // by a fake fetch (test-mode key 'sk_test_offline'; nothing leaves this process) ----
  {
    const Module = require('module'), orig = Module._load;
    const DB = { 'settings/commerce': { creatorFeePct: 0 }, 'creatorAccounts/au': { acct: 'acct_T', status: 'active', live: false },
      ['zsScripts/' + SID]: { authorUid: 'au', authorName: 'Ana', name: 'Paid band', status: 'live', access: 'protected', sale: { mode: 'paid', price: { amount: 19, currency: 'USD' } } } };
    let auto = 0;
    const ref = (p2) => ({ path: p2, id: p2.split('/').pop(), get: async () => ({ id: p2.split('/').pop(), exists: p2 in DB, data: () => DB[p2] }),
      set: async (v) => { DB[p2] = v; }, update: async (v) => { DB[p2] = Object.assign({}, DB[p2], v); }, collection: (c) => col(p2 + '/' + c) });
    const col = (c) => ({ doc: (id) => ref(c + '/' + (id || 'auto' + (++auto))), where: () => col(c), limit: () => col(c), get: async () => ({ empty: true, size: 0, docs: [] }) });
    const fdb = { collection: col, runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => r.set(v), update: (r, v) => r.update(v) }) };
    const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => fdb, { FieldValue: { serverTimestamp: () => 1, increment: (x) => x, delete: () => null }, Timestamp: { fromMillis: (x) => x, now: () => 1 } }) };
    const fx = { https: { onCall: (f) => f, onRequest: (f) => f, HttpsError: class extends Error { constructor(c, m) { super(c + ': ' + m); this.code = c; } } }, runWith() { return this; } };
    Module._load = function (r, ...a) { if (r === 'firebase-admin') return admin; if (r === 'firebase-functions') return fx; return orig.call(this, r, ...a); };
    const keep = { key: process.env.STRIPE_SECRET_KEY, fetch: globalThis.fetch };
    process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'offline';
    const sent = [];
    globalThis.fetch = async (url, o) => {
      if (!String(url).startsWith('https://api.stripe.com/v1/')) throw new Error('unexpected network call ' + url);
      const p2 = String(url).replace('https://api.stripe.com/v1/', '').split('?')[0];
      sent.push({ path: p2, body: decodeURIComponent(o.body || ''), acct: o.headers['Stripe-Account'], auth: /Bearer sk_test_/.test(o.headers.Authorization || o.headers.authorization || '') });
      const body = p2 === 'products' ? { id: 'prod_1' } : p2 === 'prices' ? { id: 'price_1' } : p2 === 'customers' ? { id: 'cus_1' } : p2 === 'checkout/sessions' ? { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' } : {};
      return { ok: true, status: 200, json: async () => body };
    };
    try {
      const CP = require(path.join(ROOT, 'functions-src/creatorPay.js')).__creatorPayInternals;
      const ctxOf = (uid) => ({ auth: { uid, token: { email: uid + '@x.com' } } });
      const out = await CP.actions.zsCheckout('buyer', { sid: SID }, ctxOf('buyer'));
      const cs = sent.find((x) => x.path === 'checkout/sessions'), pr = sent.find((x) => x.path === 'prices');
      check(out && /^https:\/\/checkout\.stripe\.com\//.test(out.url) && /^cs_test_/.test(out.sessionId), 'checkout: zsCheckout returns a Stripe test-mode Checkout URL', out);
      check(cs && cs.auth && cs.acct === 'acct_T' && /mode=payment/.test(cs.body) && /client_reference_id=buyer/.test(cs.body) && /metadata\[kind\]=zs/.test(cs.body), 'checkout: test key, author account, one-time payment, buyer + kind=zs metadata');
      check(pr && /unit_amount=1900/.test(pr.body) && /currency=usd/i.test(pr.body), 'checkout: price comes from the script doc on the server (1900 cents)');
      check(!DB['zsScripts/' + SID + '/buyers/buyer'], 'checkout: no access granted before Stripe confirms (webhook only)');
      let refused = false; try { await CP.gate('buyer', ctxOf('buyer')); } catch (e) { refused = true; }
      check(refused, 'checkout: on a test key a normal member is gated (no charge path from tests)');
    } finally { Module._load = orig; globalThis.fetch = keep.fetch; if (keep.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = keep.key; }
  }

  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---------- 1. hidden by default ----------
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(richstub);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
      await sleep(2500);
      await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(800);
      const h = await p.evaluate(() => ({ zs: !!window.STRYKER_ZS, seg: document.querySelectorAll('.stkc-langseg').length, panel: !!document.getElementById('stkc-zs'), tab: !!document.querySelector('.stkiw-tab[data-k="zscript"]'), txt: /Zscript/.test(document.body.innerText) }));
      check(!h.zs && !h.seg && !h.panel && !h.tab && !h.txt, 'hidden: no Zscript editor, switch, indicator-window tab or text on /charts', h);
      await p.goto(BASE + '/script-library.html', { waitUntil: 'load' }); await sleep(1500);
      const lib = await p.evaluate(() => ({ t: document.getElementById('zl-root').innerText, pub: !!document.getElementById('zl-pub') }));
      check(/not open yet/.test(lib.t) && !lib.pub, 'hidden: /script-library says not open yet', lib.t.slice(0, 80));
      await p.goto(BASE + '/charts.html?zs=1', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_ZS, null, { timeout: 60000 });
      check(true, '?zs=1 preview loads Zscript');
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 }); await sleep(1500);
      check(await p.evaluate(() => !!window.STRYKER_ZS), 'preview stays on for the tab (sessionStorage)');
      await ctx.close();
    }

    // ---------- 2-5. Pro (admin stub) on NQ, then SPX ----------
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: true, theme: 'dark', extra: async (c) => { await spxRoute(c); await apiRoute(c); } });
      await setNQ(p); await spy(p);
      let r = await runRead(p, '//@zscript 1\nindicator("My SMA", overlay=true)\nplot(ta.sma(close, 20), "SMA")\nplot(ta.ema(close, 50), "EMA")\n', 'My SMA', 2000);
      check(r.ok && r.vals.SMA && r.vals.SMA.n > 100 && r.vals.EMA.n > 100, 'write + run: both plots on the chart', r.vals);
      const ex = await p.evaluate(() => window.STRYKER_ZS.examples.map((x) => [x.name, x.source]));
      check(ex.length === 5, '5 examples', ex.map((x) => x[0]));
      for (const [name, src] of ex) {
        r = await runRead(p, src, (/indicator\("([^"]+)"/.exec(src) || [])[1], 2500);
        check(r.ok && r.on && Object.keys(r.vals).length > 0, 'example runs: ' + name, { msg: r.msg, vals: r.vals });
      }
      await clearZs(p);
      r = await runRead(p, '//@zscript 1\nindicator("Book flow", overlay=false)\nplot(book.imbalance(5), "Imb")\nplot(book.bid(1), "Bid")\nplot(flow.delta, "Delta")\nplot(flow.buyvol, "Buy")\n', 'Book flow', 16000);
      check(r.ok && r.vals.Bid && r.vals.Bid.last > 20000, 'Pro: book.bid(1) from the hub (real NQ-like level)', r.vals);
      check(r.vals.Imb && r.vals.Imb.n >= 1 && Math.abs(r.vals.Imb.last) <= 1, 'Pro: book.imbalance(5) in -1..1', r.vals.Imb);
      check(r.vals.Buy && r.vals.Buy.n >= 1 && r.vals.Buy.last > 0 && r.vals.Delta && r.vals.Delta.n >= 1, 'Pro: flow.buyvol / flow.delta from the hub', [r.vals.Buy, r.vals.Delta]);
      check(!r.toasts.some((t) => /plan|Pro/.test(t[1])), 'Pro: no plan notice', r.toasts);
      await p.screenshot({ path: OUT + '/E2E-1440-pro-bookflow.png' });
      // request.security: same symbol, higher timeframe, through the hub + the chart's fetchSeries
      r = await runRead(p, '//@zscript 1\nindicator("HTF", overlay=true)\nh = request.security(syminfo.tickerid, "60", close)\nplot(h, "H1 close")\n', 'HTF', 5000);
      check(r.ok && r.vals['H1 close'] && r.vals['H1 close'].n > 10, 'request.security("60") through the hub', r.vals);
      await clearZs(p);
      // SPX: gex + opt
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('idx:SPX'); ws.active.setTimeframe('15'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'idx:SPX' && c.orchestrator.rawBars.length > 50) break; } });
      await sleep(1000);
      r = await runRead(p, '//@zscript 1\nindicator("SPX levels", overlay=true)\nplot(gex.callwall, "Call wall")\nplot(gex.putwall, "Put wall")\nplot(opt.ivrank, "IV rank")\n', 'SPX levels', 9000);
      check(r.ok && r.vals['Call wall'] && [7800, 720].includes(r.vals['Call wall'].last) && r.vals['Put wall'] && [7770, 680].includes(r.vals['Put wall'].last), 'SPX: gex.callwall / putwall (archived SPX fixture live, recorder history before)', r.vals);
      check(r.vals['IV rank'] && r.vals['IV rank'].last === 37, 'SPX: opt.ivrank from the ZoroOptions summary', r.vals['IV rank']);
      await p.screenshot({ path: OUT + '/E2E-1440-spx-gex.png' });
      await clearZs(p);
      // paid protected script: buyer runs it, page never sees the program
      served = []; buyer = true;
      r = await p.evaluate(async (sid) => { const x = await window.STRYKER_ZS.addLibrary(sid); return { ok: x.ok, msg: x.msg || '' }; }, SID);
      await sleep(3000);
      const bu = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = window.STRYKER_ZS.handles(c); const rec = c.orchestrator.registry.all().find((x) => x.model && x.model.title === 'Paid band'); const s = rec && rec.model.series[0]; return { n: h.length, src: h.map((x) => x.source).join('|'), title: rec ? rec.model.title : '', pts: s ? s.points.filter((q) => Number.isFinite(q.value)).length : 0, inputs: rec ? rec.model.inputs.map((i) => i.title) : [] }; });
      check(r.ok && bu.n === 1 && bu.title === 'Paid band' && bu.pts > 50, 'buyer: paid protected script runs on the chart', bu);
      check(bu.inputs.join() === 'Length', 'buyer: its inputs reach the settings dialog', bu.inputs);
      check(!/ta\.sma|input\.int/.test(bu.src) && served.length > 0 && served.every((t) => !/"units"|"code"|ta\.sma/.test(t) && /"sealed"/.test(t)), 'buyer: the page holds only a stub; every API answer is sealed (no program, no source)', bu.src);
      const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
      check(/\/\/@lib P{20}/.test(st) && !/ta\.sma\(close, len\)/.test(st), 'buyer: saved layout keeps the stub, never the code');
      await clearZs(p);
      buyer = false; await p.evaluate(() => { window.__toasts.length = 0; });
      r = await p.evaluate(async (sid) => { const x = await window.STRYKER_ZS.addLibrary(sid); return { ok: x.ok, msg: x.msg || '', toasts: window.__toasts, n: window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).length }; }, SID);
      check(!r.ok && r.n === 0 && /paid/.test(r.msg), 'non-buyer: refused with the paid notice, nothing runs', r);
      check(errors.length === 0, 'Pro run: no page errors', errors.slice(0, 3));
      // editor Publish: protected -> the editor's compiled program is sealed before it is written
      await p.evaluate(() => { window.__batches = []; const db = window.__stubDb; db.batch = () => { const ops = []; return { set: (r, v) => ops.push(['set', r.id, JSON.stringify(v).slice(0, 4000)]), update: (r, v) => ops.push(['update', r.id]), delete: () => {}, commit: () => { window.__batches.push(ops); return Promise.resolve(); } }; }; });
      await p.evaluate(async () => { const Z = window.STRYKER_ZS; Z.open(); await Z.load('My band', '//@zscript 1\nindicator("My band", overlay=true)\nplot(ta.sma(close, 9), "B")\n', null); });
      await sleep(500);
      await p.click('#stkc-zs .stkc-pine-acts button:last-child');
      await p.waitForSelector('#zp-name', { timeout: 15000 }).catch(() => null);
      const sheet = await p.evaluate(() => ({ open: !!document.getElementById('zp-name'), name: (document.getElementById('zp-name') || {}).value, src: !!document.getElementById('zp-src') }));
      check(sheet.open && sheet.name === 'My band' && !sheet.src, 'editor Publish opens the publish sheet with the editor\'s script', sheet);
      await p.screenshot({ path: OUT + '/E2E-1440-publish-sheet.png' });
      if (sheet.open) {
        await p.fill('#zp-desc', 'Sample script. Draws a 9-bar average.');
        await p.click('#zp-acc [data-v="protected"]');
        await p.click('#zp-go'); await sleep(2500);
        const bt = await p.evaluate(() => window.__batches);
        const flat = (bt[0] || []).map((x) => x.join(' ')).join('\n');
        check(bt.length === 1 && /"sealed":\{/.test(flat) && /"source":"\/\/@zscript 1/.test(flat), 'publish protected: one batch with sealed bin + author-only src', flat.slice(0, 200));
        check(!/"units"/.test(flat), 'publish protected: no readable program in any write');
      }
      await ctx.close();
    }

    // ---------- 3b. Free member: plan notice, na, no crash ----------
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: false, theme: 'dark' });
      await p.evaluate(() => { window.__stkChartTestFree = true; });
      await setNQ(p); await spy(p);
      const r = await runRead(p, '//@zscript 1\nindicator("Book flow", overlay=false)\nplot(book.imbalance(5), "Imb")\nplot(book.bid(1), "Bid")\nplot(flow.delta, "Delta")\nplot(close - close[1], "Change")\n', 'Book flow', 5000);
      check(r.ok && r.on, 'Free: the script still runs (no crash)', r.msg);
      check(r.vals.Bid && r.vals.Bid.n === 0 && r.vals.Delta.n === 0 && r.vals.Change.n > 100, 'Free: book/flow are na, plain price math still plots', r.vals);
      check(r.toasts.some((t) => /Pro/.test(t[1]) && t[2] === 'See plans'), 'Free: plan notice with a See plans action', r.toasts);
      await p.screenshot({ path: OUT + '/E2E-1440-free-notice.png' });
      check(errors.length === 0, 'Free: no page errors', errors.slice(0, 3));
      await ctx.close();
    }

    // ---------- 7. publish -> listed in the Script Library ----------
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
      await ctx.addInitScript(libStub);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(BASE + '/script-library.html?who=au', { waitUntil: 'load' });
      await p.waitForSelector('.zl-card', { timeout: 15000 });
      await p.click('#zl-pub'); await p.waitForSelector('#zp-name');
      await p.fill('#zp-name', 'Sample: Range Line');
      await p.fill('#zp-desc', 'Sample script. Draws the bar range as a line.');
      await p.fill('#zp-src', '//@zscript 1\nindicator("Sample: Range Line")\nplot(high - low)\n');
      await p.click('#zp-go');
      await p.waitForSelector('.zs-page', { timeout: 10000 }).catch(() => null);
      const page1 = await p.evaluate(() => document.getElementById('main').innerText);
      check(/Sample: Range Line/.test(page1) && /v1/.test(page1), 'publish: opens the new script page', page1.slice(0, 120));
      await p.click('.zs-back, [data-back], a.cx-back').catch(() => p.goBack());
      await p.waitForSelector('.zl-card', { timeout: 8000 }).catch(() => null);
      const names = await p.evaluate(() => [...document.querySelectorAll('.zl-card')].map((c) => c.innerText.split('\n')[0]));
      check(names.some((n) => /Range Line/.test(n)), 'publish: listed in the library', names);
      // paid script page as a member: Buy sends only {action, sid} to the creatorPay callable (captured by the stub, never sent)
      await p.goto(BASE + '/script-library.html?who=bu&s=' + 'B'.repeat(20), { waitUntil: 'load' });
      await p.waitForSelector('#zs-buy', { timeout: 10000 }).catch(() => null);
      const code = await p.evaluate(() => ({ add: !!document.getElementById('zs-add'), src: !!document.getElementById('zs-src') }));
      check(!code.add && !code.src, 'non-buyer: script page has no Add and no View code', code);
      await p.evaluate(() => sessionStorage.removeItem('__c'));
      await p.click('#zs-buy').catch(() => null); await sleep(800);
      const calls = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__c') || '[]'));
      check(calls.length === 1 && calls[0].name === 'creatorPay' && calls[0].data.action === 'zsCheckout' && Object.keys(calls[0].data).join() === 'action,sid', 'Buy: page calls creatorPay zsCheckout {sid} only', calls);
      check(errs.length === 0, 'library: no page errors', errs.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
