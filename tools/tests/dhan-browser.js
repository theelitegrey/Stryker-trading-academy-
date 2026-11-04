// Dhan card test + shots (own-API-key mode + paste fallback). Serve the repo (python3 -m http.server 8052), then: CHART_BASE=http://127.0.0.1:8052 node tools/tests/dhan-browser.js [shotsDir]
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
  for (const [w, h, mobile, theme, tag] of [[390, 844, true, 'dark', 'd390'], [412, 915, true, 'dark', 'd412'], [1440, 900, false, 'dark', 'd1440']]) {
    const { ctx, p, reqs } = await open(b, w, h, mobile, theme, false), t = tag + ' ';
    const keyCalls = []; await ctx.route(/\/connect\/dhan\/key/, (r) => { keyCalls.push(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://auth.dhan.co/login/consentApp-login?consentAppId=f1e2d3c4-aaaa-bbbb' }) }); });
    await ctx.route(/auth\.dhan\.co/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'dhan login' }));
    await p.evaluate(() => { window.__byoV = (/byo-ui\.js\?v=(\d+)/.exec(document.documentElement.innerHTML) || /vela-chart\.js\?v=(\d+)/.exec(document.documentElement.innerHTML) || [, '861'])[1]; document.querySelector('#byo-btn').click(); });
    await p.waitForSelector('.byo-row[data-src="dhan"]'); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('.byo-row[data-src="dhan"] button').click()); await p.waitForTimeout(500);
    let body = await p.$eval('.byo-body', (x) => x.textContent);
    check((await p.$$eval('.byo-steps-l li', (l) => l.length)) === 4 && /Access DhanHQ APIs/.test(body) && /App name: TradeZoro/.test(body), t + 'four numbered steps');
    check((await p.$eval('#dhan-redirect', (x) => x.textContent)) === 'https://tradezoro.com/connect/dhan/callback' && !!(await p.$('#dhan-copy')), t + 'redirect URL + copy button');
    check(/Data plan/.test(body) && /Paste a token instead/.test(body) && /never places, changes or cancels trades/.test(body), t + 'data plan note, paste fallback, data-only note');
    check((await p.$eval('#dhan-k-appSecret', (i) => i.type)) === 'password' && (await p.$eval('#dhan-k-appId', (i) => i.type)) === 'password', t + 'key + secret hidden');
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), t + 'no horizontal overflow');
    check(await p.$$eval('.byo-body input, .byo-body button', (l) => l.every((x) => x.getBoundingClientRect().height >= 40)), t + 'tap targets 40+ px');
    await p.screenshot({ path: `${OUT}/dhan-key-setup-${tag}.png` });
    await p.evaluate(() => document.querySelector('#dhan-save').click()); await p.waitForTimeout(200);
    check(/Enter your Dhan Client ID/.test(await p.$eval('.byo-err', (x) => x.textContent)), t + 'empty form says what is missing');
    await p.fill('#dhan-k-clientId', '1000000001'); await p.fill('#dhan-k-appId', 'appid-1234'); await p.fill('#dhan-k-appSecret', 'secret-APPSECRET-9');
    await p.evaluate(() => document.querySelector('#dhan-save').click()); await p.waitForTimeout(1200);
    check(keyCalls.length === 1 && keyCalls[0].grant === 'start' && keyCalls[0].clientId === '1000000001', t + 'save runs step 1 through our function', keyCalls.map((k) => k.grant));
    check(reqs.every((u) => !/api\.dhan\.co/.test(u)) && !reqs.some((u) => /auth\.dhan\.co\/app\//.test(u)), t + 'browser never calls Dhan REST / auth app endpoints');
    check(/auth\.dhan\.co\/login\/consentApp-login/.test(p.url()), t + 'browser sent to the Dhan login page', p.url());
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__stkHeavyReady && document.querySelector('#byo-btn'), null, { timeout: 45000 }); await p.waitForTimeout(600);
    await p.evaluate(() => { window.__byoV = (/v=(\d+)/.exec(document.documentElement.innerHTML) || [, '861'])[1]; document.querySelector('#byo-btn').click(); }); await p.waitForSelector('.byo-row[data-src="dhan"]');
    await p.evaluate(() => document.querySelector('.byo-row[data-src="dhan"] button').click()); await p.waitForTimeout(600);
    body = await p.$eval('.byo-body', (x) => x.textContent);
    check(!!(await p.$('#dhan-signin')) && !(await p.$('#dhan-k-appSecret')) && !/APPSECRET/.test(body), t + 'keys remembered: one tap, no re-paste');
    await p.evaluate(async () => { const c = await import('/assets/byo-core.js?v=861'); try { await c.saveSource('dhan', { access: 'x'.repeat(40), clientId: '1000000001', expires: true, exp: Date.now() + 20 * 36e5 }, undefined, true); } catch (e) { window.__err = String(e); } });
    console.log('   save err:', await p.evaluate(() => window.__err || 'none'));
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('.byo-back').click()); await p.waitForTimeout(300);
    console.log('   row:', await p.evaluate(() => { const b = document.querySelector('.byo-row[data-src="dhan"] button'); return b ? b.textContent : 'norow ' + document.querySelector('.byo-body').textContent.slice(0, 60); }));
    await p.evaluate(() => document.querySelector('.byo-row[data-src="dhan"] button').click()); await p.waitForTimeout(600);
    body = await p.$eval('.byo-body', (x) => x.textContent); check(/Connected/.test(body) || /waiting/.test(body), t + 'signed-in state shown', body.slice(0, 100));
    await p.screenshot({ path: `${OUT}/dhan-key-signedin-${tag}.png` });
    await p.evaluate(async () => { const c = await import('/assets/byo-core.js?v=861'); await c.saveSource('dhan', { access: 'x'.repeat(40), clientId: '1000000001', expires: true, exp: Date.now() - 1000 }, undefined, true); });
    await p.waitForTimeout(800);
    await p.evaluate(() => { const a = document.querySelector('#dhan-again'); if (a) a.click(); }); await p.waitForTimeout(500);
    body = await p.$eval('.byo-body', (x) => x.textContent); check(/Sign in with Dhan again/.test(body) && !!(await p.$('#dhan-signin')) && !(await p.$('#dhan-k-appSecret')), t + 'expired: Sign in with Dhan again, no re-paste', body.slice(0, 120));
    await p.screenshot({ path: `${OUT}/dhan-key-again-${tag}.png` });
    await p.evaluate(() => document.querySelector('#dhan-paste').click()); await p.waitForTimeout(300);
    check(!!(await p.$('#byo-f-token')), t + 'paste-token fallback form still opens');
    await ctx.close();
  }
  await b.close(); console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
