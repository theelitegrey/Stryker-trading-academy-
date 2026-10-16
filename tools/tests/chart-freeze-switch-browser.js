// Frozen candles after rapid timeframe switches (Owner 2026-10-16). Live host by default.
//   FREEZE_URL=https://tradezoro.com node tools/tests/chart-freeze-switch-browser.js <shotsDir> [watchSeconds=60]
// Loads Charts MNQ1!, clicks through 12 timeframe buttons in ~9 s, then samples the last candle's close
// (the "C" value in the OHLC legend) every 4 s for the watch time. FAIL if it never changes after the
// burst or no bridge socket is open at the end. Run it under: systemd-run --user --scope -q -p MemoryMax=1400M flock -w 900 /tmp/stryker-chrome.lock node ...
const path = require('path');
const { chromium } = require('playwright-core');
const BASE = process.env.FREEZE_URL || 'https://tradezoro.com';
const OUT = process.argv[2] || '/tmp', SECS = Number(process.argv[3]) || 60;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.addInitScript(() => { const W = window.WebSocket; window.__socks = []; window.WebSocket = function (u, ...a) { const o = new W(u, ...a); if (/chart\/stream/.test(u)) window.__socks.push(o); return o; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); });
  let errs = 0; p.on('pageerror', (e) => { errs++; console.log('PAGEERR', String(e).slice(0, 200)); });
  const rd = () => p.evaluate(() => { const m = document.body.innerText.match(/C ([\d,.]+)/); return { c: m && m[1], open: window.__socks.filter((s) => s.readyState === 1).length }; });
  await p.goto(BASE + '/charts.html?symbol=MNQ1!', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  for (const t of ['1m', '5m', '15m', '1h', '1m', '5m', '1m', '15m', '5m', '1m', '1h', '1m']) { await p.click(`button:has-text("${t}")`).catch(() => {}); await p.waitForTimeout(700); }
  await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(OUT, 'freeze-after-burst.png') });
  const seen = new Set(); let last = null;
  for (let i = 0; i < SECS / 4; i++) { last = await rd(); if (last.c) seen.add(last.c); await p.waitForTimeout(4000); }
  await p.screenshot({ path: path.join(OUT, 'freeze-end.png') });
  console.log('distinct closes', seen.size, [...seen].slice(0, 8).join(' '), 'open sockets', last.open, 'pageerrors', errs);
  await b.close();
  const okc = seen.size >= 3 && last.open >= 1 && !errs;
  console.log(okc ? 'PASS candles keep moving after a switch burst' : 'FAIL candles frozen after a switch burst');
  process.exit(okc ? 0 : 1);
})();
