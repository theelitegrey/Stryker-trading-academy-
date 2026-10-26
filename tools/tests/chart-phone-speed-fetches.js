// Who fetches what before the first candle (fixture server): every fetch() with its caller stack.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await ctx.addInitScript(require('./richstub.js'));
  await ctx.addInitScript(() => {
    window.__f = [];
    const of = window.fetch;
    window.fetch = function (u, o) { try { const s = String(u && u.url || u); window.__f.push([Math.round(performance.now()), s.slice(0, 90), (new Error().stack || '').split('\n').slice(2, 6).map((x) => x.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '').replace(/\?v=\d+/, '')).join(' < ')]); } catch (e) {} return of.apply(this, arguments); };
    const OW = window.WebSocket;
    window.WebSocket = function (u, p) { window.__f.push([Math.round(performance.now()), 'WS ' + String(u).slice(0, 80), (new Error().stack || '').split('\n').slice(2, 5).map((x) => x.trim()).join(' < ')]); return new OW(u, p); };
    window.WebSocket.prototype = OW.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  });
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html' + (process.env.Q || ''), { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__stkHeavyReady, null, { timeout: 90000 });
  await p.waitForTimeout(4000);
  const f = await p.evaluate(() => window.__f);
  await b.close();
  f.forEach((x) => console.log(x[0] + '  ' + x[1] + '\n      ' + x[2]));
})().catch((e) => { console.error(e); process.exit(1); });
