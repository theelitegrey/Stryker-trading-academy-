// Zoro for Vest (extensions/vest): browser test on a MOCKED Vest trade page. No login, no network to Vest: every
// next.vestmarkets.com and api-gateway request is answered here from fixtures (exchangeInfo/ticker captured from Vest's public
// gateway; levels pack captured from our own feed). The private-account answers are test doubles (made-up ids, clearly test).
// Runs the real built dist/chrome/page.js in the page, like the extension's MAIN-world content script.
// Run: python3 extensions/vest/build.py && flock /tmp/stryker-chrome.lock node tools/tests/vest-ext-browser.js [--shots]
const path = require('path'), fs = require('fs');
const { launch, ROOT } = require('./lib.js');
const EXT = path.join(ROOT, 'extensions/vest'), FX = path.join(EXT, 'test/fixtures');
const SHOTS = process.argv.includes('--shots') ? (process.env.VEST_EXT_SHOTS || path.join(ROOT, 'vest-ext-shots')) : null;
const PAGE_JS = fs.readFileSync(path.join(EXT, 'dist/chrome/page.js'), 'utf8');
const USER_JS = fs.readFileSync(path.join(EXT, 'dist/zoro-for-vest.user.js'), 'utf8');
const LEVELS = fs.readFileSync(path.join(ROOT, 'tools/tests/fixtures/platform-levels/pack-json.json'), 'utf8');
const BUNDLE = fs.readFileSync(path.join(FX, 'bundle-excerpt.js'), 'utf8');
const ACC = { M: 'test-master-00000001', F1: 'test-follow-00000002', F2: 'test-follow-00000003' };
const SECRET = 'T'.repeat(43);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a stand-in for Vest's page: their screenshot as the backdrop, Vest's module script tag, a chart iframe with a recording chart API,
// and a tiny "Vest app" that reads the accounts with the member's session (that is how the panel learns the session)
function mockPage(theme, bg) {
  return '<!doctype html><html class="' + theme + '"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vest</title>' +
    '<script type="module" src="/assets/index-rv9Op3JB.js"></script>' +
    '<style>html,body{margin:0;height:100%;background:#0e0f12} body{background:url(/__fx/' + bg + ') top left/100% auto no-repeat}' +
    'iframe{position:absolute;left:0;top:0;width:1px;height:1px;border:0;opacity:0}</style></head><body>' +
    '<iframe id="tradingview_abc12" srcdoc="<html><body></body></html>"></iframe>' +
    '<script>window.__shapes=[];window.__vestApp=function(){fetch("https://api-gateway.hz.vestmarkets.com/v3/accounts?active=true",{headers:{Authorization:"Bearer test-user-session"}});};' +
    'document.getElementById("tradingview_abc12").addEventListener("load",function(e){var cw=e.target.contentWindow,n=0;cw.tradingViewApi={activeChart:function(){return{createShape:function(p,o){window.__shapes.push({price:p.price,text:o.text});return "s"+(++n);},removeEntity:function(id){window.__shapes=window.__shapes.filter(function(_,i){return "s"+(i+1)!==id;});}};}};});' +
    'setTimeout(window.__vestApp,300);</script></body></html>';
}

async function setup(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
  const page = await ctx.newPage();
  const sent = [], external = [];
  page.on('request', (r) => { const u = r.url(); if (!/^https:\/\/(next\.vestmarkets\.com|api-gateway\.hz\.vestmarkets\.com)\//.test(u) && !u.startsWith('data:') && !u.startsWith('about:')) external.push(u); });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, json = (s, j) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof j === 'string' ? j : JSON.stringify(j) });
    if (u.host === 'next.vestmarkets.com') {
      if (p.startsWith('/trade')) return route.fulfill({ status: 200, contentType: 'text/html', body: mockPage(o.theme || 'dark', o.bg || 'page-1440.jpg') });
      if (p === '/assets/index-rv9Op3JB.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: o.bundle != null ? o.bundle : '/*' + BUNDLE.replace(/\*\//g, '') + '*/' });
      if (p.startsWith('/__fx/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(FX, p.slice(6))) });
      return route.fulfill({ status: 404, body: '' });
    }
    if (u.host === 'api-gateway.hz.vestmarkets.com') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const auth = req.headers().authorization || '', body = req.postData() ? JSON.parse(req.postData()) : null;
      if (p === '/v3/exchangeInfo') return json(200, fs.readFileSync(path.join(FX, 'exchangeInfo.json'), 'utf8'));
      if (p === '/v3/ticker/latest') return json(200, fs.readFileSync(path.join(FX, 'ticker.json'), 'utf8'));
      if (!auth) return json(401, {});
      if (p === '/v3/auth/account-token') return json(200, { accessToken: 'acc-' + body.accountId, accessExpiresAtMs: Date.now() + 3600e3, accountId: body.accountId });
      if (p === '/v3/accounts') return json(200, { accounts: [{ account_id: ACC.M, account_type: 1, amount: '10000' }, { account_id: ACC.F1, account_type: 3, amount: '5000' }, { account_id: ACC.F2, account_type: 2, amount: '2500' }] });
      if (p === '/v3/positions/opened') return json(200, { positions: [] });
      if (p === '/v3/positions/opened-orders') return json(200, { orders: [] });
      if (p === '/v3/user-state') return json(200, { accounts: [] });
      if (/^\/v3\/positions\//.test(p)) {
        const acct = auth.replace('Bearer acc-', '');
        sent.push({ acct, m: req.method(), p, body });
        if (o.failFor === acct) return json(400, { detail: { code: 4001, msg: 'Insufficient margin (test)' } });
        return json(200, { commandId: 'c' + sent.length, orderId: 'o' + sent.length, positionId: 'p-' + acct });
      }
      return json(404, {});
    }
    return route.abort();
  });
  // the extension's isolated bridge + background, reduced to what the page sees: answers to postMessage requests
  await page.addInitScript(({ lv, hasLink }) => {
    let link = hasLink;
    window.addEventListener('message', (e) => {
      const d = e.data; if (!d || d.zv !== 'req') return;
      const b = d.body; let res;
      if (b.op === 'setLink') { link = !!b.secret; res = { status: 'ok' }; }
      else res = link ? { status: 'ok', json: Object.assign(JSON.parse(lv), { updated: new Date(Date.now() - 4 * 60e3).toISOString() }), hasLink: true } : { status: 'nolink', hasLink: false };
      setTimeout(() => window.postMessage({ zv: 'res', id: d.id, body: res }, location.origin), 10);
    });
  }, { lv: LEVELS, hasLink: !!o.link });
  if (o.accepted) await page.addInitScript(() => localStorage.setItem('zv:terms', JSON.stringify({ v: 1, at: 'test' })));
  if (o.settings) await page.addInitScript((s) => localStorage.setItem('zv:settings', JSON.stringify(s)), o.settings);
  if (o.userscript) {
    // Tampermonkey stand-in: GM_* storage in memory, GM_xmlhttpRequest answers from the levels fixture and records the URL
    await page.addInitScript(({ lv }) => {
      const store = {}; window.__gmUrls = [];
      window.GM_getValue = (k, d) => (k in store ? store[k] : d); window.GM_setValue = (k, v) => { store[k] = v; }; window.GM_deleteValue = (k) => { delete store[k]; };
      window.GM_xmlhttpRequest = (r) => { window.__gmUrls.push(r.url); setTimeout(() => r.onload({ status: 200, responseText: lv }), 10); };
      window.unsafeWindow = window;
    }, { lv: LEVELS });
    await page.addInitScript(USER_JS);
  } else await page.addInitScript(PAGE_JS);
  await page.goto('https://next.vestmarkets.com/trade/' + (o.sym || 'SPX-USD-PERP'), { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  return { ctx, page, sent, external };
}
// the panel is in a closed shadow root: the test spies attachShadow (before the content script runs) to reach it
const Z = (page, fn, arg) => page.evaluate(([f, a]) => { const sr = window.__zvTestRoot; return (new Function('sr', 'a', 'return (' + f + ')(sr, a)'))(sr, a); }, [fn.toString(), arg]);

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    // 1. first run: terms sheet, buttons off until accepted
    {
      const s = await setupWithGrab({});
      const t = await Z(s.page, (sr) => ({ sheet: !!sr.querySelector('.sheet'), text: sr.querySelector('.sheet').textContent, buy: sr.querySelector('[data-act="buy"]').disabled }));
      ok(t.sheet, 'terms sheet on first run');
      ok(/real orders on your real Vest accounts/.test(t.text) && /late/.test(t.text) && /responsible/.test(t.text) && /Not financial advice/.test(t.text) && /not affiliated with Vest/.test(t.text) && /country restrictions/.test(t.text), 'terms say all six points');
      ok(t.buy, 'Buy is disabled before the terms');
      await Z(s.page, (sr) => sr.querySelector('[data-sh="ok"]').click());
      ok(await Z(s.page, (sr) => !!sr.querySelector('.sheet') && !sr.querySelector('#zv-agree-h').hidden), 'I agree without the tick is refused');
      await Z(s.page, (sr) => { sr.querySelector('#zv-agree').click(); sr.querySelector('[data-sh="ok"]').click(); });
      ok(await Z(s.page, (sr) => !sr.querySelector('.sheet')), 'terms accepted with the tick');
      ok(await s.page.evaluate(() => JSON.parse(localStorage.getItem('zv:terms')).v === 1), 'acceptance stored');
      ok(s.external.length === 0, 'no request left Vest/our mocks (no ping, nothing to TradeZoro): ' + s.external.join(','));
      ok(await s.page.evaluate(() => Object.keys(window.__zoroForVest).join() === 'version' && typeof window.ZV_CORE === 'undefined' && typeof window.ZV_Engine === 'undefined'), 'only a version marker is on Vest\'s window');
      await s.ctx.close();
    }
    // 2. order panel: bracket in points, confirm sheet, one order with the legs
    {
      const s = await setupWithGrab({ accepted: true, settings: { master: ACC.M } });
      await sleep(500);
      const st = await Z(s.page, (sr) => ({ status: sr.querySelector('.status').textContent, sym: sr.querySelector('#zv-sym').textContent, mark: sr.querySelector('#zv-mark').textContent }));
      ok(/Master/.test(st.status) && /Copy OFF/.test(st.status), 'status shows master + copy off: ' + st.status);
      ok(st.sym === 'SPX-USD-PERP' && /^\d/.test(st.mark), 'market + mark price from Vest: ' + st.sym + ' ' + st.mark);
      await Z(s.page, (sr) => { const set = (k, v) => { const i = sr.querySelector('[data-f="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('qty', '0.01'); set('stop', '10'); set('t1', '10'); set('t2', '20'); });
      const calc = await Z(s.page, (sr) => sr.querySelector('#zv-calc').textContent);
      ok(/0\.01 contracts/.test(calc) && /stop/.test(calc) && /targets/.test(calc), 'live sizing line: ' + calc);
      await Z(s.page, (sr) => sr.querySelector('[data-act="buy"]').click());
      const cf = await Z(s.page, (sr) => sr.querySelector('.sheet') && sr.querySelector('.sheet').textContent);
      ok(cf && /Buy SPX-USD-PERP/.test(cf) && /Send 1 order/.test(cf), 'confirm sheet before sending');
      ok(s.sent.length === 0, 'nothing sent before confirm');
      if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'confirm-1440-dark.png') });
      await Z(s.page, (sr) => sr.querySelector('.sheet [data-sh="ok"]').click());
      await sleep(800);
      const o = s.sent[0] || {};
      ok(s.sent.length === 1 && o.p === '/v3/positions/open' && o.acct === ACC.M, 'one open order on the master');
      const mark = Number(JSON.parse(fs.readFileSync(path.join(FX, 'ticker.json'), 'utf8')).tickers.find((t) => t.symbol === 'SPX-USD-PERP').markPrice);
      const r4 = (x) => String(Math.round(x * 4) / 4);
      ok(o.body && o.body.side === 'long' && o.body.quantity === '0.01' && o.body.orderType === 'market' && o.body.stopLosses[0].triggerPrice === r4(mark - 10) && o.body.takeProfits.length === 2 && o.body.takeProfits[0].triggerPrice === r4(mark + 10) && o.body.takeProfits[1].triggerPrice === r4(mark + 20) && o.body.takeProfits[0].quantity === '0.005' && o.body.takeProfits[1].quantity === '0.005',
        'points became prices on the tick, 2 targets split the size: ' + JSON.stringify(o.body));
      // turning confirm off: next order goes straight out
      await Z(s.page, (sr) => sr.querySelector('[data-set="confirm"]').click());
      await Z(s.page, (sr) => { const i = sr.querySelector('[data-f="t1"]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); const j = sr.querySelector('[data-f="t2"]'); j.value = ''; j.dispatchEvent(new Event('input', { bubbles: true })); sr.querySelector('[data-act="sell"]').click(); });
      await sleep(800);
      ok(s.sent.length === 2 && s.sent[1].body.side === 'short' && s.sent[1].body.stopLosses[0].triggerPrice === r4(mark + 10), 'confirm off for the visit: sell goes out, stop above');
      ok(await s.page.evaluate(() => sessionStorage.getItem('zv:confirm') === 'off'), 'confirm-off is per visit (sessionStorage)');
      await s.ctx.close();
    }
    // 3. copy: master + 2 followers scaled to balance; one fails and drops out; kill switch
    {
      const s = await setupWithGrab({ accepted: true, failFor: ACC.F1, settings: { master: ACC.M, followers: [ACC.F1, ACC.F2], sizing: 'balance' } });
      await sleep(400);
      await Z(s.page, (sr) => sr.querySelector('[data-tab="copy"]').click());
      await Z(s.page, (sr) => sr.querySelector('[data-set="copy"]').click());
      ok(await Z(s.page, (sr) => /ON\. Master actions go to 2 followers/.test(sr.querySelector('#zv-kill-t').textContent)), 'copy ON with 2 followers');
      if (SHOTS) { await sleep(400); await s.page.screenshot({ path: path.join(SHOTS, 'copy-1440-dark.png') }); }
      await Z(s.page, (sr) => sr.querySelector('[data-tab="trade"]').click());
      await Z(s.page, (sr) => { const i = sr.querySelector('[data-f="qty"]'); i.value = '0.02'; i.dispatchEvent(new Event('input', { bubbles: true })); sr.querySelector('[data-act="buy"]').click(); });
      const cf = await Z(s.page, (sr) => sr.querySelector('.sheet').textContent);
      ok(/Send 3 orders/.test(cf) && /0\.01/.test(cf) && /0\.005/.test(cf), 'confirm lists 3 accounts with scaled sizes');
      await Z(s.page, (sr) => sr.querySelector('.sheet [data-sh="ok"]').click());
      await sleep(1000);
      ok(s.sent.map((x) => x.acct).join() === [ACC.M, ACC.F1, ACC.F2].join(), 'master first, then followers');
      ok(s.sent.map((x) => x.body.quantity).join() === '0.02,0.01,0.005', 'sizes 0.02 / 0.01 / 0.005 (10k / 5k / 2.5k balances)');
      await Z(s.page, (sr) => sr.querySelector('[data-tab="copy"]').click());
      const dr = await Z(s.page, (sr) => sr.querySelector('#zv-fol').textContent);
      ok(/Dropped: .*Insufficient margin/.test(dr) && /Retry/.test(dr), 'failing follower shows Dropped + Retry');
      ok(await Z(s.page, (sr) => /1 follower/.test(sr.querySelector('#zv-kill-t').textContent)), 'dropped follower is out of the copy count');
      await Z(s.page, (sr) => sr.querySelector('[data-tab="log"]').click());
      const lg = await Z(s.page, (sr) => sr.querySelector('#zv-log').textContent);
      ok(/accepted/.test(lg) && /Copied/.test(lg) && /Dropped out/.test(lg), 'log has per-account lines');
      if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'log-1440-dark.png') });
      await Z(s.page, (sr) => sr.querySelector('[data-tab="copy"]').click());
      await Z(s.page, (sr) => sr.querySelector('[data-set="copy"]').click());
      ok(await Z(s.page, (sr) => /OFF/.test(sr.querySelector('#zv-kill-t').textContent)), 'kill switch: copy OFF');
      await s.ctx.close();
    }
    // 4. change detection: Vest's code without our endpoints -> trading off, buttons disabled
    {
      const s = await setupWithGrab({ accepted: true, bundle: '/* nothing */', settings: { master: ACC.M } });
      const st = await Z(s.page, (sr) => ({ t: sr.querySelector('.status').textContent, buy: sr.querySelector('[data-act="buy"]').disabled, dot: sr.querySelector('.hd .dot').className }));
      ok(/Vest changed its page/.test(st.t) && st.buy && /off/.test(st.dot), 'changed page -> trading off: ' + st.t);
      await s.ctx.close();
    }
    // 5. levels: no link -> upsell without prices; with link -> lines on the chart + list
    {
      const s = await setupWithGrab({ accepted: true });
      await Z(s.page, (sr) => sr.querySelector('[data-tab="levels"]').click());
      await sleep(1300);
      const t = await Z(s.page, (sr) => sr.querySelector('#zv-lv').textContent);
      ok(/part of Pro/.test(t) && !/\$\d/.test(t) && !/₹/.test(t), 'no link: Pro upsell, no prices: ' + t);
      await s.ctx.close();
      const s2 = await setupWithGrab({ accepted: true, link: true, settings: { showLevels: true } });
      await Z(s2.page, (sr) => sr.querySelector('[data-tab="levels"]').click());
      await sleep(1500);
      const t2 = await Z(s2.page, (sr) => sr.querySelector('#zv-lv').textContent);
      const shapes = await s2.page.evaluate(() => window.__shapes);
      ok(/Call Ceiling/.test(t2) && /updated 4 min ago/.test(t2) && !/live|real-time|delayed|behind/i.test(t2), 'levels list + "updated X min ago" wording');
      ok(shapes.length >= 5 && shapes.every((x) => /^TZ /.test(x.text)) && shapes.some((x) => x.price === 7450), 'levels drawn on Vest\'s chart (' + shapes.length + ')');
      if (SHOTS) await s2.page.screenshot({ path: path.join(SHOTS, 'levels-1440-dark.png') });
      await s2.ctx.close();
      // NDX: QQQ levels moved by Vest's two marks
      const s3 = await setupWithGrab({ accepted: true, link: true, sym: 'NDX-USD-PERP', settings: { showLevels: true } });
      await sleep(1200);
      const sh3 = await s3.page.evaluate(() => window.__shapes);
      const tk = JSON.parse(fs.readFileSync(path.join(FX, 'ticker.json'), 'utf8')).tickers, mk = (x) => Number(tk.find((t) => t.symbol === x).markPrice);
      ok(sh3.length > 0 && Math.abs(sh3[0].price - Math.round(JSON.parse(LEVELS).levels[0].price * mk('NDX-USD-PERP') / mk('QQQ-USD-PERP') * 100) / 100) < 0.011, 'NDX gets QQQ-feed levels on NDX scale');
      await s3.ctx.close();
      const s4 = await setupWithGrab({ accepted: true, link: true, sym: 'BTC-PERP' });
      await Z(s4.page, (sr) => sr.querySelector('[data-tab="levels"]').click()); await sleep(800);
      ok(/No TradeZoro levels for BTC-PERP/.test(await Z(s4.page, (sr) => sr.querySelector('#zv-lv').textContent)) && (await s4.page.evaluate(() => window.__shapes.length)) === 0, 'BTC: says no levels, draws nothing');
      await s4.ctx.close();
    }
    // 6. userscript build: same panel, levels link kept in GM storage, levels fetched only from tradezoro.com
    {
      const s = await setupWithGrab({ accepted: true, userscript: true, settings: { master: ACC.M, showLevels: true } });
      ok(await Z(s.page, (sr) => /Master/.test(sr.querySelector('.status').textContent)), 'userscript: panel runs, session learnt');
      await Z(s.page, (sr) => sr.querySelector('[data-tab="levels"]').click());
      await Z(s.page, (sr, a) => { sr.querySelector('#zv-link').value = 'https://tradezoro.com/api/lv/feed/' + a + '.csv?u=SPX'; sr.querySelector('[data-act="savelink"]').click(); }, SECRET);
      await sleep(2500);
      const urls = await s.page.evaluate(() => window.__gmUrls);
      ok(urls.length > 0 && urls.every((u) => u.startsWith('https://tradezoro.com/api/lv/feed/' + SECRET + '.json?u=SPX')), 'userscript: levels via GM_xmlhttpRequest to tradezoro.com only');
      ok(await s.page.evaluate((sec) => !JSON.stringify(localStorage).includes(sec), SECRET), 'userscript: levels link not in Vest\'s localStorage');
      await s.ctx.close();
    }
    // 7. shots: panel 1440 dark/light, 390 dark (minimised pill and opened)
    if (SHOTS) {
      let s = await setupWithGrab({ accepted: true, settings: { master: ACC.M, followers: [ACC.F1] } });
      await Z(s.page, (sr) => { const set = (k, v) => { const i = sr.querySelector('[data-f="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('qty', '0.05'); set('stop', '12'); set('t1', '15'); set('t2', '30'); });
      await s.page.screenshot({ path: path.join(SHOTS, 'panel-1440-dark.png') }); await s.ctx.close();
      s = await setupWithGrab({ accepted: true, theme: 'light', settings: { master: ACC.M, followers: [ACC.F1] } });
      await Z(s.page, (sr) => { const set = (k, v) => { const i = sr.querySelector('[data-f="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('qty', '0.05'); set('stop', '12'); set('t1', '15'); });
      await s.page.screenshot({ path: path.join(SHOTS, 'panel-1440-light.png') }); await s.ctx.close();
      s = await setupWithGrab({ accepted: true, w: 390, h: 844, mobile: true, bg: 'page-390.jpg', settings: { master: ACC.M } });
      await s.page.screenshot({ path: path.join(SHOTS, 'pill-390-dark.png') });
      await Z(s.page, (sr) => sr.querySelector('.pill').click());
      await Z(s.page, (sr) => { const set = (k, v) => { const i = sr.querySelector('[data-f="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('qty', '0.05'); set('stop', '12'); set('t1', '15'); });
      await s.page.screenshot({ path: path.join(SHOTS, 'panel-390-dark.png') });
      const r = await s.page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
      ok(r[0] === r[1], '390: no sideways scroll');
      await s.ctx.close();
      s = await setupWithGrab({ w: 390, h: 844, mobile: true, bg: 'page-390.jpg' });
      await s.page.screenshot({ path: path.join(SHOTS, 'terms-390-dark.png') }); await s.ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);

  function setupWithGrab(o) { return setupGrabbed(browser, o); }
})();

async function setupGrabbed(browser, o) {
  const realNewContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await realNewContext(opts);
    await ctx.addInitScript(() => {
      const a = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (i) { const r = a.call(this, i); if (this.id === 'zoro-for-vest') window.__zvTestRoot = r; return r; };
    });
    return ctx;
  };
  try { return await setup(browser, o); } finally { browser.newContext = realNewContext; }
}
