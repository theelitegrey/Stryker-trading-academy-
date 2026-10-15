// Charts "Symbol info" panel browser test (assets/chart-symbol-info.js) at 1440 + 390.
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-symbol-info-browser.js [shotsDir]
// /scan?part=syminfo is answered from tools/tests/fixtures/scan/syminfo.json.gz (real info-feeder output 2026-10-14).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const GZ = fs.readFileSync(path.join(__dirname, 'fixtures', 'scan', 'syminfo.json.gz'));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stkin_open'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  let hits = 0;
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan/, (r) => {
    hits++;
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip' }, body: GZ });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await p.waitForFunction(() => window.__stkSymInfo, null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return { ctx, p, errors, hits: () => hits };
}
const setSym = async (p, sym) => { await p.evaluate((s) => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol(s); }, sym); await sleep(2500); };
const txt = (p) => p.evaluate(() => { const e = document.getElementById('stkin'); return e && !e.hidden ? e.innerText : null; });
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(300); await p.screenshot({ path: OUT + '/' + name }); console.log('shot ' + OUT + '/' + name); }
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, mobile: true }]) {
      const tag = vp.w;
      const { ctx, p, errors, hits } = await open(b, vp);
      check(await p.evaluate(() => !!window.__stkSymInfo), tag + ': panel mounted');
      check(hits() === 0, tag + ': nothing fetched until the panel opens');
      if (vp.mobile) await p.click('.stkin-phonebtn'); else await p.click('.stkin-railbtn');
      await sleep(1200);
      let t = await txt(p);
      check(t && /Contract/i.test(t) && /Roll calendar/i.test(t) && /Trading session/i.test(t), tag + ': three sections');
      check(/Tick size\s*0\.25/.test(t || ''), tag + ': NQ tick 0.25');
      check(/Tick value\s*\$5/.test(t || ''), tag + ': tick value $5');
      check(/Front contract expires\s*[^\n]*\(in \d+ days?\)|Front contract expires\s*[^\n]*today/.test(t || ''), tag + ': next roll in X days line: ' + ((t || '').match(/Front contract expires\s*([^\n]*)/) || [])[1]);
      check(/Hours\s*17:00 - 16:00/.test(t || ''), tag + ': session hours');
      check(/Education only\. Not financial advice\./.test(t || ''), tag + ': education line');
      check(/Updated (within the hour|\d+ h ago|\d+ days ago)/.test(t || ''), tag + ': updated line');
      check(!/real-time|delayed|live\b/i.test(t || ''), tag + ': no banned words');
      check(hits() === 1, tag + ': one fetch (' + hits() + ')');
      const geo = await p.evaluate(() => { const r = document.getElementById('stkin').getBoundingClientRect(); const b = document.querySelector('.stkin-body'); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth, over: b.scrollWidth - b.clientWidth }; });
      check(geo.r <= geo.w + 1 && geo.l >= -1 && geo.sw <= geo.w, tag + ': inside the viewport, no sideways scroll ' + JSON.stringify(geo));
      await shot(p, 'syminfo-nq-' + tag + '.png');
      // other symbols
      await setSym(p, 'futures:MGC1!');
      t = await txt(p);
      check(/Symbol info[\s\S]{1,4}MGC/i.test(t || '') && /Micro of GC/i.test(t || '') && !/^Typical roll/m.test(t || ''), tag + ': MGC -> gold facts, micro note, no index roll line');
      await setSym(p, 'binance:BTCUSDT');
      t = await txt(p);
      check(/No contract info for this symbol/.test(t || ''), tag + ': crypto -> short note');
      await setSym(p, 'futures:ES1!');
      t = await txt(p);
      check(/E-mini S&P 500/i.test(t || '') && /Typical roll/.test(t || ''), tag + ': ES facts follow the chart symbol');
      if (vp.mobile) await shot(p, 'syminfo-es-390.png'); else await shot(p, 'syminfo-es-1440.png');
      // closes; rail button toggles
      if (vp.mobile) await p.keyboard.press('Escape'); else await p.click('.stkin-railbtn');
      await sleep(400);
      check((await txt(p)) === null, tag + ': closes');
      check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
