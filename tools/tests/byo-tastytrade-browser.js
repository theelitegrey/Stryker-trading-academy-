// tastytrade connect form browser test (fixtures, no real keys). CHART_BASE=http://127.0.0.1:8077 node tools/tests/byo-tastytrade-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
const TOKEN = 'h.' + Buffer.from(JSON.stringify({ scope: 'read' })).toString('base64url') + '.s';
const WSSTUB = () => {
  window.__ws = [];
  window.WebSocket = class {
    constructor(u) { this.url = u; this.sent = []; window.__ws.push(this); setTimeout(() => this.onopen && this.onopen(), 5); }
    reply(o) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 5); }
    send(m) {
      const j = JSON.parse(m); this.sent.push(j);
      if (j.type === 'SETUP') this.reply({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
      if (j.type === 'AUTH') this.reply({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
      if (j.type === 'CHANNEL_REQUEST') this.reply({ type: 'CHANNEL_OPENED', channel: 3 });
      if (j.type === 'FEED_SETUP') this.reply({ type: 'FEED_CONFIG', channel: 3 });
    }
    close() {}
  };
};
async function open(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.addInitScript(WSSTUB);
  await ctx.route(/api\.tastyworks\.com/, (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = u.pathname === '/oauth/token' ? { access_token: TOKEN, expires_in: 900 } : u.pathname === '/api-quote-tokens' ? { data: { token: 'QT', 'dxlink-url': 'wss://tasty-openapi-ws.dxfeed.com/realtime' } } : null;
    return body ? r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) }) : r.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const reqs = []; ctx.on('request', (r) => reqs.push(r.url()));
  const p = await ctx.newPage(); const logs = [];
  p.on('console', (m) => logs.push(m.text()));
  p.on('pageerror', (e) => logs.push('PAGEERR ' + e));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('#byo-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(800);
  return { ctx, p, logs, reqs };
}
const idbKeys = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('tz-byo'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result.filter((k) => String(k).startsWith('c:')).length); }; }));
(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    const { ctx, p, logs, reqs } = await open(b, w, h, mobile, theme);
    const t = tag + ': ';
    await p.evaluate(() => document.querySelector('#byo-btn').click());
    await p.waitForSelector('.byo-row');
    const row = await p.$eval('.byo-row[data-src="tastytrade"]', (r) => ({ txt: r.textContent, btn: r.querySelector('button').textContent, dis: r.querySelector('button').disabled }));
    check(/Beta/.test(row.txt) && row.btn === 'Connect' && !row.dis, t + 'tastytrade row is Beta with a working Connect', row);
    await p.screenshot({ path: `${OUT}/tt-sheet-${tag}.png` });
    await p.click('.byo-row[data-src="tastytrade"] button');
    await p.waitForSelector('.byo-in');
    await p.click('.byo-steps summary');
    const link = await p.$eval('.byo-steps a', (a) => a.href);
    check(/^https:\/\/developer\.tastytrade\.com\//.test(link), t + 'How to get these links to tastytrade', link);
    await p.screenshot({ path: `${OUT}/tt-form-${tag}.png` });
    await p.evaluate(() => document.querySelector('.byo-body').scrollTo(0, 9999));
    await p.click('.byo-go');
    check((await p.$$eval('.byo-in[aria-invalid="true"]', (e) => e.length)) === 3, t + 'empty form rejected (3 fields)');
    check(!reqs.some((u) => /tastyworks/.test(u)), t + 'no request for an empty form');
    const ins = await p.$$('.byo-in');
    await ins[0].fill('FAKECLIENTID'); await ins[1].fill('FAKESECRETVALUE456'); await ins[2].fill('FAKEREFRESH789');
    check((await p.$eval('#byo-f-clientSecret', (e) => e.type)) === 'password' && (await p.$eval('#byo-f-refreshToken', (e) => e.type)) === 'password', t + 'secret fields are masked');
    await p.screenshot({ path: `${OUT}/tt-form-filled-${tag}.png` });
    await p.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    await p.click('.byo-go');
    await p.waitForSelector('#byo-forget', { timeout: 8000 }).catch(() => {});
    if (!(await p.$('#byo-forget'))) console.log('ERRTEXT', await p.$eval('.byo-err', (e) => e.textContent).catch(() => 'none'));
    check(await p.$('#byo-forget') !== null, t + 'connects (manage view with Forget)');
    await p.screenshot({ path: `${OUT}/tt-manage-${tag}.png` });
    if (tag === 'd1440') {
      const live = await p.evaluate(async () => {
        const c = await import('/assets/byo-core.js?v=941');
        const got = []; const r = c.route('byo', 'AAPL');
        const stop = r.ad.subscribe(r.rec.hub, 'AAPL', '1', { time: Math.floor(Date.now() / 60000) * 60000, open: 1, high: 1, low: 1, close: 1, volume: 0 }, (x) => got.push(x));
        await new Promise((res) => setTimeout(res, 1200));
        const ws = window.__ws[window.__ws.length - 1];
        ws.onmessage({ data: JSON.stringify({ type: 'FEED_DATA', channel: 3, data: ['Trade', ['Trade', 'AAPL', 321.5, 2]] }) });
        stop();
        return { n: got.length, close: got[0] && got[0].close, types: ws.sent.map((m) => m.type), url: ws.url };
      });
      check(live.n === 1 && live.close === 321.5 && live.types.join() === 'SETUP,AUTH,CHANNEL_REQUEST,FEED_SETUP,FEED_SUBSCRIPTION', t + 'live trade -> candle over DXLink', live);
      const bad = reqs.filter((u) => /tastyworks/.test(u) && !/\/(oauth\/token|api-quote-tokens)(\?|$)/.test(u));
      check(bad.length === 0, t + 'only token + quote-token requests were made', bad);
      check((await idbKeys(p)) === 1, t + 'credentials stored in the vault (encrypted record)');
      await p.click('#byo-forget');
      await p.waitForSelector('.byo-row');
      check((await idbKeys(p)) === 0, t + 'Forget wipes the stored record');
      await p.click('.byo-row[data-src="tastytrade"] button'); await p.waitForSelector('.byo-in');
      const ins2 = await p.$$('.byo-in');
      await ins2[0].fill('FAKECLIENTID'); await ins2[1].fill('FAKESECRETVALUE456'); await ins2[2].fill('FAKEREFRESH789'); await p.selectOption('#byo-f-keep', 'no');
      await p.click('.byo-go'); await p.waitForSelector('#byo-forget', { timeout: 8000 });
      check((await idbKeys(p)) === 0, t + '"This tab only" writes no credentials');
    }
    const ovf = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(ovf <= 0, t + 'no horizontal overflow', ovf);
    check(!logs.join('\n').match(/FAKESECRETVALUE456|FAKEREFRESH789/), t + 'secrets not in console');
    check(!logs.some((l) => /PAGEERR/.test(l)), t + 'no page errors', logs.filter((l) => /PAGEERR/.test(l)));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
