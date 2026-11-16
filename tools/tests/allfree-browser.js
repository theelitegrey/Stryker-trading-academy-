// ALL TOOLS FREE (Owner 2026-11-13), browser side, against chart-dev-server.mjs.
//   node tools/tests/chart-dev-server.mjs 8031; CHART_BASE=http://127.0.0.1:8031 node tools/tests/allfree-browser.js [shotsDir]
// A signed-in FREE member (plan Starter, no live book) on NQ: Footprint (L2), GEX levels and the DOM panel open with no lock and no
// upgrade modal, no PRO tag anywhere, and the futures L2 shows the delayed label + "Get live data". The live-data paywall opens
// only from that button, with the live-data wording, no price number and no vendor name. Shots: 1440 dark/light, 390 dark.
const fs = require('fs');
const { launch } = require('./lib.js');
const stubSrc = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const stub = stubSrc.replace("plan: 'Elite', role: 'elite', residenceCountry", "plan: 'Starter', role: 'starter', residenceCountry");
const modalOpen = (p) => p.evaluate(() => { const o = document.getElementById('plan-upgrade-modal'); return !!(o && o.classList.contains('open')); });

async function run(b, { w, h, theme }) {
  const tag = w + '-' + theme, mobile = w < 700;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.setItem('theme', theme); } catch (e) {}
    const user = { uid: 'u-free', getIdToken: () => Promise.resolve('dummy.free.token') };
    firebase.apps = [{}];
    const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
  }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', (r) => r.fulfill({ json: { admin: true, l2: false }, headers: { 'cache-control': 'no-store' } }));   // L1 live (agreement), NO live book
  await ctx.route(/\/api\/gex\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"test"}' }));
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('futures:NQ1!'); window.STRYKER_VELA.active.setTimeframe('5'); });
  await sleep(3000);
  const add = (k) => p.evaluate((k) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); try { c.chart.addNativeIndicator(k, { inputs: {} }); return true; } catch (e) { return String(e); } }, k);
  const n = () => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().length);
  const n0 = await n();
  for (const k of ['stk_l2f_fp', 'stk_gex', 'stk_depth_heat']) await add(k);
  await sleep(3500);
  check((await n()) >= n0 + 3, tag + ': Footprint (L2), GEX levels and Depth Heatmap stay on a Free member chart (' + n0 + ' -> ' + (await n()) + ')');
  check(!(await modalOpen(p)), tag + ': no upgrade modal opened');
  check(!(await p.evaluate(() => /is not a function|\[A\]|part of Pro/i.test(document.body.innerText))), tag + ': no error / "part of Pro" text on screen');
  check(await p.evaluate(() => !document.querySelector('.stk-protag')), tag + ': no PRO tag in the page');
  // DOM panel (rail button on desktop, DOM button on the phone)
  await p.evaluate(() => { const b = document.querySelector('.stkbp-railbtn, .stkbp-phonebtn'); const v = [...document.querySelectorAll('.stkbp-railbtn, .stkbp-phonebtn')].find((x) => x.offsetParent); (v || b) && (v || b).click(); });
  await sleep(1500);
  check(await p.evaluate(() => { const x = document.getElementById('stkbp'); return !!x && !x.hidden; }), tag + ': DOM panel opens for a Free member');
  check(!(await modalOpen(p)), tag + ': DOM: no upgrade modal');
  const txt = await p.evaluate(() => document.body.innerText);
  check(/10 min(utes)? delayed/i.test(txt), tag + ': futures L2 shows the delayed label');
  check(await p.evaluate(() => !!(window.STRYKER_L2_DELAYED && window.STRYKER_L2_DELAYED())), tag + ': STRYKER_L2_DELAYED() true for a member without the live book');
  await p.screenshot({ path: OUT + '/allfree-chart-' + tag + '.png' });
  // paywall only from "Get live data"
  const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /get live data/i.test(x.textContent || '')); if (b) { b.click(); return true; } return false; });
  await sleep(1200);
  const pw = await p.evaluate(() => { const o = document.getElementById('plan-upgrade-modal'); return o && o.classList.contains('open') ? o.innerText : null; });
  check(clicked && !!pw, tag + ': "Get live data" opens the paywall');
  if (pw) {
    check(/paid data feed/i.test(pw) && /Tools are free/i.test(pw), tag + ': paywall says tools are free, the data is the paid part');
    check(/Live data/.test(pw), tag + ': plan shown as "Pro · Live data"');
    check(!/part of Pro/i.test(pw), tag + ': paywall has no "part of Pro"');
    await p.screenshot({ path: OUT + '/allfree-paywall-' + tag + '.png' });
  }
  check(!errors.length, tag + ': no page errors' + (errors.length ? ' ' + errors.slice(0, 2).join(' | ') : ''));
  await ctx.close();
}
(async () => {
  const b = await launch();
  try { for (const c of [{ w: 1440, h: 900, theme: 'dark' }, { w: 1440, h: 900, theme: 'light' }, { w: 390, h: 844, theme: 'dark' }]) await run(b, c); }
  catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
