// Data source sheet browser test. CHART_BASE=http://127.0.0.1:8044 node tools/tests/byo-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
const BARS = { bars: [{ t: '2026-11-03T14:30:00Z', o: 100, h: 101, l: 99, c: 100.5, v: 10 }], next_page_token: null };
const WSSTUB = () => {
  window.__ws = [];
  window.WebSocket = class { constructor(u) { this.url = u; this.sent = []; window.__ws.push(this); setTimeout(() => this.onmessage && this.onmessage({ data: '[{"T":"success","msg":"connected"}]' }), 20); }
    send(m) { const j = JSON.parse(m); this.sent.push(j); if (j.action === 'auth') setTimeout(() => this.onmessage({ data: '[{"T":"success","msg":"authenticated"}]' }), 10); }
    close() {} };
};
async function open(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.addInitScript(WSSTUB);
  await ctx.route(/data\.alpaca\.markets/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(BARS) }));
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
(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    const { ctx, p, logs, reqs } = await open(b, w, h, mobile, theme);
    const t = tag + ': ';
    await p.evaluate(() => document.querySelector('#byo-btn').click());
    await p.waitForSelector('.byo-row', { timeout: 5000 });
    const rows = await p.$$eval('.byo-row', (r) => r.map((x) => x.dataset.src));
    check(rows.length >= 6 && rows.includes('alpaca') && rows.includes('oanda'), t + 'sheet lists sources', rows);
    await p.screenshot({ path: `${OUT}/byo-sheet-${tag}.png` });
    if (tag === 'd1440') {
      await p.click('.byo-chip[data-f="forex"]');
      const fx = await p.$$eval('.byo-row', (r) => r.map((x) => x.dataset.src));
      check(fx.includes('oanda') && !fx.includes('alpaca'), t + 'Forex chip filters', fx);
      await p.click('.byo-chip[data-f="all"]');
      const dead = await p.$$eval('.byo-row', (r) => r.filter((x) => { const bt = x.querySelector('button'); return !bt || (bt.disabled && !/soon/i.test(x.textContent)); }).length);
      check(dead === 0, t + 'no dead buttons');
      await p.click('.byo-row[data-src="alpaca"] button');
      await p.waitForSelector('.byo-in');
      await p.screenshot({ path: `${OUT}/byo-form-${tag}.png` });
      await p.click('.byo-go');
      check((await p.$$eval('.byo-in[aria-invalid="true"]', (e) => e.length)) >= 1, t + 'empty form is rejected');
      // only the broker's own host counts (the page also fetches its own alpaca icon and the /connect/alpaca/token?probe=1 sign-in availability check)
      const brokerReqs = reqs.filter((u) => /^https?:\/\/[^/]*alpaca\.markets/.test(u));
      check(!brokerReqs.length, t + 'no broker request for an empty form', brokerReqs);
      const ins = await p.$$('.byo-in');
      await ins[0].fill('PKFAKEKEY123'); await ins[1].fill('FAKESECRETVALUE456');
      await p.screenshot({ path: `${OUT}/byo-form-filled-${tag}.png` });
      // Connect with fake key (broker answered by fixture), then a live tick reaches the adapter's candle, then Forget.
      await p.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
      await p.click('.byo-go');
      await p.waitForSelector('#byo-forget', { timeout: 8000 }).catch(() => {});
      if (!(await p.$('#byo-forget'))) console.log('ERRTEXT', await p.$eval('.byo-err', (e) => e.textContent).catch(() => 'none'), await p.evaluate(() => typeof firebase + ' ' + (window.firebase && firebase.apps && firebase.apps.length)));
      check(await p.$('#byo-forget') !== null, t + 'connects (manage view with Forget)');
      await p.screenshot({ path: `${OUT}/byo-manage-${tag}.png` });
      const live = await p.evaluate(async () => {
        const c = await import('/assets/byo-core.js?v=980');
        const got = [];
        const hub = c.statusOf('alpaca') && c.route('byo', 'AAPL');
        const stop = hub.ad.subscribe(hub.rec.hub, 'AAPL', '1', { time: Math.floor(Date.now() / 60000) * 60000, open: 1, high: 1, low: 1, close: 1, volume: 0 }, (b2) => got.push(b2));
        await new Promise((r) => setTimeout(r, 900));
        const ws = window.__ws[window.__ws.length - 1];
        ws.onmessage({ data: JSON.stringify([{ T: 't', S: 'AAPL', p: 123.45, s: 2, t: new Date().toISOString() }]) });
        stop();
        return { n: got.length, close: got[0] && got[0].close, subs: ws.sent.map((m) => m.action) };
      });
      check(live.n === 1 && live.close === 123.45 && live.subs.join() === 'auth,subscribe', t + 'live tick updates the chart candle from the adapter', live);
      const dot = await p.evaluate(() => { const c = document.querySelector('.stkc-dd'); return c ? c.getAttribute('title') || c.textContent : ''; });
      await p.click('#byo-forget');
      await p.waitForSelector('.byo-row', { timeout: 5000 });
      const left = await p.evaluate(async () => { const c = await import('/assets/byo-core.js?v=980'); return c.connectedIds().length; });
      const idb = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('tz-byo'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result.filter((k) => String(k).startsWith('c:')).length); }; r.onerror = () => res(-1); }));
      check(left === 0 && idb === 0, t + 'Forget removes the connection and the stored record', { left, idb });
      check(!logs.join('\n').includes('FAKESECRETVALUE456'), t + 'secret not in console');
    }
    check(!logs.some((l) => /PAGEERR/.test(l)), t + 'no page errors', logs.filter((l) => /PAGEERR/.test(l)));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
