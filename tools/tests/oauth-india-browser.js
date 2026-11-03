// Upstox + Fyers sign-in sheet test + shots. CHART_BASE=http://127.0.0.1:8044 node tools/tests/oauth-india-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
async function open(b, w, h, mobile, theme, configured) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/\/connect\/(upstox|fyers)\/token/, (r) => configured ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"client_id":"FAKECLIENTID1"}' }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"configured":false}' }));
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
  const AUTH = { upstox: ['api.upstox.com', '/v2/login/authorization/dialog', 'Sign in with Upstox', /every night/], fyers: ['api-t1.fyers.in', '/api/v3/generate-authcode', 'Sign in with Fyers', /every morning/] };
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    for (const cfg of [false, true]) {
      const { ctx, p } = await open(b, w, h, mobile, theme, cfg);
      await p.evaluate(() => document.querySelector('#byo-btn').click());
      await p.waitForSelector('.byo-row[data-src="upstox"]'); await p.waitForTimeout(500);
      for (const id of ['upstox', 'fyers']) {
        const t = tag + (cfg ? ' on ' : ' off ') + id + ': ';
        const btn = await p.$eval(`.byo-row[data-src="${id}"] button`, (x) => [x.textContent, x.disabled]);
        check(cfg ? btn[0] === 'Sign in' && !btn[1] : btn[0] === 'Coming soon' && btn[1], t + 'row button', btn);
        if (id === 'upstox') await p.screenshot({ path: `${OUT}/india-list-${tag}-${cfg ? 'on' : 'off'}.png` });
        if (!cfg) continue;   // flag off: a disabled "Coming soon" row, nothing to open
        await p.evaluate((i) => document.querySelector(`.byo-row[data-src="${i}"] button`).click(), id);
        await p.waitForTimeout(350);
        const si = await p.$('#byo-signin');
        check(!!si && !(await p.$('#byo-keyalt')) && !(await p.$('.byo-body input')), t + 'Sign in button, no key form, no key link');
        if (si) {
          check((await si.textContent()).trim() === AUTH[id][2], t + 'button label');
          check(await p.$eval('#byo-signin img', (i) => i.complete && i.naturalWidth > 0 && /brokers\/(upstox|fyers)\./.test(i.src)).catch(() => false), t + 'official logo loaded');
          const body = await p.$eval('.byo-body', (x) => x.textContent);
          check(body.includes("TradeZoro only reads prices. It can't place trades."), t + 'read-only line shown');
          check(AUTH[id][3].test(body), t + 'daily sign-in line shown');
          check(/never places, changes or cancels trades/.test(body), t + 'data-only note shown');
        }
        check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), t + 'no horizontal overflow');
        await p.screenshot({ path: `${OUT}/india-${id}-signin-${tag}.png` });
        if (tag === 'd1440') {
          await ctx.route(new RegExp(AUTH[id][0].replace(/\./g, '\\.')), (r) => r.fulfill({ status: 200, contentType: 'text/html', body: id }));
          await p.evaluate(() => document.querySelector('#byo-signin').click());
          await p.waitForURL(new RegExp(AUTH[id][0].replace(/\./g, '\\.')), { timeout: 5000 }).catch(() => {});
          const u = new URL(p.url());
          check(u.hostname === AUTH[id][0] && u.pathname === AUTH[id][1] && !u.searchParams.has('scope') && u.searchParams.get('response_type') === 'code' && u.searchParams.get('redirect_uri') === `https://tradezoro.com/connect/${id}/callback` && (u.searchParams.get('state') || '').length >= 20, t + 'goes to the broker sign-in page', u.search);
          break;
        }
        await p.evaluate(() => document.querySelector('.byo-back').click()); await p.waitForTimeout(250);
      }
      await ctx.close();
    }
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/oauth-callback.html?error=access_denied&error_description=%3Cb%3Ex%3C/b%3E', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    check(!p.url().includes('error'), tag + ' callback strips the query', p.url());
    check(!(await p.$('main b')), tag + ' callback shows nothing from the URL');
    await p.screenshot({ path: `${OUT}/oauth-callback-${tag}.png` });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
