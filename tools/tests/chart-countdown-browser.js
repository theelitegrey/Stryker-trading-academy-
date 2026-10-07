// Charts price-axis countdown test (assets/chart-countdown.js) against tools/tests/chart-dev-server.mjs.
// Needs network (Yahoo via the dev server + Binance). Part 1 checks the pure maths with fixed clocks;
// part 2 opens the page and reads the text the chrome layer last drew (scene.__stkCdText).
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-countdown-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const secs = (t) => { if (!t) return null; const m = /^(\d+)d(?: (\d+)h)?$/.exec(t); if (m) return +m[1] * 86400 + (+m[2] || 0) * 3600; return t.split(':').reduce((a, v) => a * 60 + +v, 0); };

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkCountdown, null, { timeout: 45000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
const set = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id);
  c.setSymbol(sym); c.setTimeframe(tf);
  await new Promise((r) => setTimeout(r, 4000));
}, [sym, tf]);
const read = (p) => p.evaluate(() => {
  const ws = window.STRYKER_VELA; const R = ws.cell(ws.active.id).chart.renderer.renderer;
  return { text: R.scene.__stkCdText, on: R.scene.showCountdown, timer: R.countdownTimer != null, n: R.scene.bars.length };
});

(async () => {
  const b = await launch();
  let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });

  // ---- part 1: maths with fixed clocks (runs in the page so it uses the shipped module) ----
  const U = await p.evaluate(() => {
    const C = window.__stkCountdown;
    const T = (s) => Date.parse(s);
    return {
      // Delayed 1m feed: newest bar opened 10 min ago -> next minute boundary, not 00:00.
      fut1m: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-07T19:42:00Z'), 60000, true),
      fut5m: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-07T19:40:00Z'), 300000, true),
      fut1h: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-07T19:00:00Z'), 3600000, true),
      fut1hBreak: C.countdownFor(T('2026-10-07T20:30:00Z'), T('2026-10-07T20:00:00Z'), 3600000, true), // 16:30 NY -> stops at 17:00
      fut1D: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-07T04:00:00Z'), 86400000, true),       // -> 17:00 NY = 21:00Z
      futBreak: C.countdownFor(T('2026-10-07T21:30:00Z'), T('2026-10-07T20:00:00Z'), 60000, true),       // 17:30 NY daily break
      futWeekend: C.countdownFor(T('2026-10-10T15:00:00Z'), T('2026-10-09T20:59:00Z'), 60000, true),     // Saturday
      btc1D: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-07T00:00:00Z'), 86400000, false),
      btc1W: C.countdownFor(T('2026-10-07T19:52:20Z'), T('2026-10-05T00:00:00Z'), 7 * 86400000, false),
      fmt: [C.fmtCountdown(59e3), C.fmtCountdown(3599e3), C.fmtCountdown(3600e3), C.fmtCountdown(86400e3 + 5 * 3600e3)]
    };
  });
  check(U.fut1m && U.fut1m.text === '00:40', 'delayed NQ 1m counts to next minute', U.fut1m);
  check(U.fut5m && U.fut5m.text === '02:40', 'delayed NQ 5m counts to next 5m boundary', U.fut5m);
  check(U.fut1h && U.fut1h.text === '07:40', 'NQ 1h counts to 20:00Z', U.fut1h);
  check(U.fut1hBreak && U.fut1hBreak.text === '30:00', 'NQ 1h stops at the 17:00 NY break', U.fut1hBreak);
  check(U.fut1D && U.fut1D.text === '1:07:40', 'NQ 1D counts to 17:00 NY in h:mm:ss', U.fut1D);
  check(U.futBreak === null && U.futWeekend === null, 'NQ hidden in daily break and on weekend', [U.futBreak, U.futWeekend]);
  check(U.btc1D && U.btc1D.text === '4:07:40', 'BTC 1D counts to 00:00 UTC', U.btc1D);
  check(U.btc1W && /^4d 4h$/.test(U.btc1W.text), 'BTC 1W shows d h', U.btc1W);
  check(JSON.stringify(U.fmt) === JSON.stringify(['00:59', '59:59', '1:00:00', '1d 5h']), 'formats', U.fmt);

  // ---- part 2: on the page ----
  const cases = [['BINANCE:BTCUSDT', '1'], ['BINANCE:BTCUSDT', '5'], ['NQ1!', '1'], ['NQ1!', '5'], ['NQ1!', '15'], ['NQ1!', '60'], ['NQ1!', '240'], ['NQ1!', '1D']];
  for (const [sym, tf] of cases) {
    await set(p, sym, tf);
    const a = await read(p);
    await p.waitForTimeout(2000);
    const z = await read(p);
    const isFut = /1!$/.test(sym);
    if (isFut && a.text === '') { check(true, `${sym} ${tf}: market closed, countdown hidden`, a); continue; }
    const sa = secs(a.text), sz = secs(z.text);
    check(a.on && a.timer && a.n > 0 && sa > 0, `${sym} ${tf}: countdown drawn`, a);
    if (tf === '1' || tf === '5' || tf === '15') check(sz < sa && sa - sz <= 3 || (sz > sa && sa <= 3), `${sym} ${tf}: decreases over 2 s`, [a.text, z.text]);
    if (tf === '60' || tf === '240') check(/^(\d+:)?\d\d:\d\d$/.test(z.text), `${sym} ${tf}: mm:ss / h:mm:ss`, z.text);
    if (tf === '1D') check(/^\d+:\d\d:\d\d$|^\d\d:\d\d$/.test(z.text), `${sym} ${tf}: h:mm:ss`, z.text);
  }
  await set(p, 'NQ1!', '5');
  await p.screenshot({ path: `${OUT}/cd-1440-nq5.png` });

  // toggle off -> nothing drawn, timer stopped
  const off = await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; const rc = ws.cell(ws.active.id).chart.renderer; const R = rc.renderer;
    R.applyFeature('countdown', false);
    await new Promise((r) => setTimeout(r, 300));
    const res = { on: R.scene.showCountdown, timer: R.countdownTimer != null };
    R.applyFeature('countdown', true);
    return res;
  }).catch((e) => ({ err: String(e) }));
  check(off.on === false && off.timer === false, 'settings toggle off stops the countdown', off);
  check(!errors.length, 'no page errors (1440)', errors);
  await ctx.close();

  ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
  await set(p, 'NQ1!', '1');
  const m = await read(p);
  check(m.text === '' || /^\d\d:\d\d$/.test(m.text) && secs(m.text) >= 1 && secs(m.text) <= 60, '390 NQ 1m countdown', m);
  await p.screenshot({ path: `${OUT}/cd-390-nq1.png` });
  check(!errors.length, 'no page errors (390)', errors);
  await ctx.close();
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
