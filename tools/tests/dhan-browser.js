// Dhan card test + shots. Serve the repo (python3 -m http.server 8052), then: CHART_BASE=http://127.0.0.1:8052 node tools/tests/dhan-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8052';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
async function open(b, w, h, mobile, theme, partner) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/\/connect\/dhan\/token/, (r) => partner ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true}' }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"configured":false}' }));
  await ctx.route(/\/connect\/(upstox|fyers|alpaca|tastytrade|ctrader|schwab)\//, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"configured":false}' }));
  await ctx.route(/\/connect\/dhan\/data/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: [1], high: [2], low: [1], close: [1.5], volume: [1], timestamp: [1762167600] }) }));
  await ctx.route(/\/connect\/dhan\/master/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[[13,"NIFTY","INDEX","","NSE"]]' }));
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const reqs = []; ctx.on('request', (r) => reqs.push(r.url()));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('#byo-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(800);
  return { ctx, p, reqs };
}
(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [412, 915, true, 'dark', 'd412'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    for (const partner of [false, true]) {
      if (partner && tag !== 'd1440' && tag !== 'd390') continue;
      const { ctx, p, reqs } = await open(b, w, h, mobile, theme, partner), t = tag + (partner ? ' partner ' : ' ');
      await p.evaluate(() => document.querySelector('#byo-btn').click());
      await p.waitForSelector('.byo-row[data-src="dhan"]'); await p.waitForTimeout(400);
      const btn = await p.$eval('.byo-row[data-src="dhan"] button', (x) => [x.textContent, x.disabled]);
      check(btn[0] === 'Connect' && !btn[1], t + 'Dhan row has a live Connect button', btn);
      check(await p.$eval('.byo-row[data-src="dhan"] img', (i) => i.complete && i.naturalWidth > 0 && /brokers\/dhan\.png/.test(i.src)).catch(() => false), t + 'real Dhan logo loaded');
      const row = await p.$eval('.byo-row[data-src="dhan"]', (x) => x.textContent); check(/Data plan/.test(row) && !/Upstox|Fyers/.test(row), t + 'row text: Data plan, no other vendor', row);
      if (!partner) { await p.$eval('.byo-row[data-src="dhan"]', (x) => x.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); await p.screenshot({ path: `${OUT}/dhan-list-${tag}.png` }); }
      await p.evaluate(() => document.querySelector('.byo-row[data-src="dhan"] button').click()); await p.waitForTimeout(400);
      const body = await p.$eval('.byo-body', (x) => x.textContent);
      check(/Steps/.test(body) && (await p.$$eval('.byo-steps-l li', (l) => l.length)) === 4, t + '4-step how-to shown');
      check(/Dhan charges for market data/.test(body), t + 'plain Data-plan warning');
      check((await p.$$eval('.byo-body input', (l) => l.length)) === 2 && (await p.$eval('#byo-f-token', (i) => i.type)) === 'password', t + 'two fields, token hidden');
      check(!!(await p.$('#byo-signin')) === partner, t + 'one-tap button only when the partner flag is on');
      check(/never places, changes or cancels trades/.test(body), t + 'data-only note');
      check(!/Upstox|Fyers|Alpaca|OANDA|Schwab|tastytrade|cTrader|Ironbeam/.test(body), t + 'no other vendor name in the Dhan form');
      check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), t + 'no horizontal overflow');
      check(await p.$$eval('.byo-body input, .byo-body button', (l) => l.every((x) => x.getBoundingClientRect().height >= 40)), t + 'tap targets 40+ px');
      await p.screenshot({ path: `${OUT}/dhan-form-${partner ? 'partner-' : ''}${tag}.png` });
      if (!partner && (tag === 'd390' || tag === 'd1440')) {
        await p.evaluate(() => document.querySelector('.byo-go[type=submit]').click()); await p.waitForTimeout(150);
        const em = await p.$eval('.byo-err', (x) => x.textContent); check(/^Enter your [Dd]han Client ID\.$/.test(em), t + 'empty form says what is missing', em);
        await p.fill('#byo-f-clientId', '1000000001'); await p.fill('#byo-f-token', 'eyJTESTTOKENFAKE' + 'x'.repeat(40));
        await p.evaluate(() => document.querySelector('.byo-go[type=submit]').click()); await p.waitForTimeout(1200);
        const st = await p.$eval('.byo-body', (x) => x.textContent).catch(() => '');
        console.log('   after connect err:', await p.$eval('.byo-err', (x) => x.textContent + '/' + x.hidden).catch(() => 'none'));
        if (/Token ends in/.test(st)) {
          check(/Token ends in 2[34] h/.test(st), t + 'expiry countdown shown');
          check(/Renew it/.test(st), t + 'renew how-to shown');
          await p.screenshot({ path: `${OUT}/dhan-manage-${tag}.png` });
        } else check(false, t + 'manage screen reached', st.slice(0, 120));
      }
      check(!reqs.some((u) => /api\.dhan\.co|auth\.dhan\.co/.test(u)), t + 'browser never called api.dhan.co / auth.dhan.co');
      await ctx.close();
    }
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
