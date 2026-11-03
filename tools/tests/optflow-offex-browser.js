// Browser test: Options Flow Marks (Pro, assets/chart-optflow.js) and Off-exchange Volume (Free, assets/chart-offex.js). 390 + 1440, dark + light.
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/optflow-offex-browser.js [shotsDir]
// The recorder's GET /tide is answered from a SYNTHETIC two-session series built here by a fixed formula (see sample()), so every
// expected total is known. Firebase is stubbed (richstub.js, an Elite member); the Free case applies the Free limit the way
// assets/plan-limits.js does (GEX page) and window.__stkChartTestFree (charts).
// Wording check: no live / real-time / delayed anywhere on the tab.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- synthetic /tide reply -----------------------------------------------------------------------
function etEpoch(day, h, m) {   // New York wall time -> epoch seconds (tries EDT then EST)
  for (const off of [4, 5]) {
    const t = Date.parse(day + 'T' + String(h + off).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00Z') / 1000;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(t * 1000));
    if (f.startsWith(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'))) return t;
  }
  throw new Error('bad time');
}
function lastWeekdays(n) {
  const out = []; const d = new Date();
  while (out.length < n) {
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    if (!/Sat|Sun/.test(dow)) out.push(ymd);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const DAYS = lastWeekdays(2);
const nowS = Math.floor(Date.now() / 1000);
function sample(k) {   // per minute: calls bought 100 + (k % 7) * 10 net, puts sold net -(40 + (k % 5) * 5)
  const cn = 100 + (k % 7) * 10, pn = -(40 + (k % 5) * 5);
  return { cn, pn, cp: cn + 200, pp: -pn + 120 };
}
function session(day, spot0, endS) {
  const d = { day, t: [], s: [], cn: [], pn: [], cp: [], pp: [], cv: [], pv: [] };
  const t0 = etEpoch(day, 9, 31);
  for (let k = 0; k < 389; k++) {
    const t = t0 + k * 60; if (t > endS - 60) break;
    const x = sample(k);
    d.t.push(t); d.s.push(+(spot0 + Math.sin(k / 30) * 12 + k * 0.02).toFixed(2)); d.cn.push(x.cn); d.pn.push(x.pn); d.cp.push(x.cp); d.pp.push(x.pp); d.cv.push(30); d.pv.push(20);
  }
  return d;
}
const SPOT = { SPX: 7690, SPY: 689, QQQ: 640 };
function reply(u) {
  const days = DAYS.map((day, i) => session(day, SPOT[u], i === 0 ? nowS - 120 : 1e12)).filter((d) => d.t.length);
  return { v: 1, u, keepDays: 30, days };
}
function expectedTotals(u) {
  const d = reply(u).days[0], sum = (a) => a.reduce((x, y) => x + y, 0);
  return { cn: sum(d.cn), pn: sum(d.pn), cp: sum(d.cp), pp: sum(d.pp), n: d.t.length };
}


const FINRA = () => {   // synthetic FINRA file: every weekday of the last 120 days at ~30 % of 60M, weekly rows around the page's price (set in-page)
  const daily = {}; const d = new Date(); const rows = [];
  for (let i = 1; i < 120; i++) { const x = new Date(d.getTime() - i * 86400000); const w = x.getUTCDay(); if (w === 0 || w === 6) continue; rows.push([x.toISOString().slice(0, 10).replace(/-/g, ''), 18000000 + (i % 9) * 400000, 9000000]); }
  daily.SPY = rows.reverse(); return { v: 1, generatedAt: Date.now() - 86400000, daily, weekly: { SPY: [] } };
};
async function open(b, { w, h, mobile, free, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([free, theme]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme); } catch (e) {}
    if (free) window.__stkChartTestFree = true;
  }, [!!free, theme]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.|raw\.githubusercontent\.com)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(gex-|opt-)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/tide/, (r) => { const u = new URL(r.request().url()).searchParams.get('u'); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(u)) }); });
  await ctx.route(/raw\.githubusercontent\.com\/.*finra-data\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FINRA()) }));
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} } });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  return { ctx, p, errors };
}
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(3500); };
const add = (p, type, inputs) => p.evaluate(([t, i]) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const count = (p, type) => p.evaluate((t) => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((x) => x.nativeType === t).length, type);
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const phone = (o) => !!o.mobile;

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  // ---- Options Flow Marks (Pro) on ES 5 min
  if (o.free) {
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
    check(await p.evaluate(() => !!document.querySelector('.stkiw-row[data-key="b:stk_optflow"] .stk-protag')), tag + ': Free sees the PRO tag on Options Flow Marks');
    check(await p.evaluate(() => !document.querySelector('.stkiw-row[data-key="b:stk_offex"] .stk-protag') && !!document.querySelector('.stkiw-row[data-key="b:stk_offex"]')), tag + ': Off-exchange Volume is listed with no PRO tag');
    await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_optflow"] .stkiw-name').click()); await sleep(1200);
    check((await count(p, 'stk_optflow')) === 0, tag + ': Free click does not add Options Flow Marks');
    await p.keyboard.press('Escape'); await sleep(300);
  } else {
    await setSym(p, 'futures:ES1!', '5');
    await add(p, 'stk_optflow', { sensitivity: 'Medium' }); await sleep(3500);   // synthetic premiums are a few hundred $, so the $100K default floor is lowered here
    check((await count(p, 'stk_optflow')) === 1, tag + ': Options Flow Marks added');
    const ok = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-of]'); return !!cv; });
    check(ok, tag + ': marks layer canvas mounted');
    const painted = await p.evaluate(() => { let g = 0, r = 0; for (const c of document.querySelectorAll('canvas[data-stk-of]')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 60 && d[i + 1] > 150 && d[i] < 120) g++; if (d[i + 3] > 60 && d[i] > 200 && d[i + 1] < 110) r++; } } return { g, r }; });
    check(painted.g > 100 && painted.r > 100, tag + ': green and red bubbles painted (' + painted.g + ' / ' + painted.r + ' px)');
    // hover / tap the first mark: find its screen position through the canvas hit list
    const pos = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-of]'); const r = cv.getBoundingClientRect(); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const dpr = cv.width / r.width; for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { const i = (y * cv.width + x) * 4; if (d[i + 3] > 120) return { x: r.left + x / dpr + 1, y: r.top + y / dpr + 6 }; } return null; });
    if (pos) {
      for (let k = 0; k < 8; k++) {
        if (phone(o)) await p.touchscreen.tap(pos.x, pos.y + k); else await p.mouse.move(pos.x, pos.y + k);
        await sleep(250);
        const t = await p.evaluate(() => { const t = document.querySelector('.stk-of-tip'); return t && !t.hidden ? t.innerText : null; });
        if (t) { check(/(Calls|Puts) · large premium/.test(t) && /Premium/.test(t) && /Contracts/.test(t) && /not in the data/.test(t) && /Not a single trade/.test(t), tag + ': tip "' + t.replace(/\n/g, ' | ') + '"'); break; }
        if (k === 7) check(false, tag + ': no tooltip on a mark');
      }
    } else check(false, tag + ': no mark pixel found');
    await shot(p, 'optflow-' + tag + '.png');
    await p.keyboard.press('Escape');
    await setSym(p, 'IDX:AAPL', '5'); await sleep(1500);
    check(/SPX, SPY, QQQ, ES, NQ/.test(await p.evaluate(() => (document.querySelector('.stk-of-chip') || {}).textContent || '')), tag + ': other symbols get the plain note');
  }
  // ---- Off-exchange Volume (Free) on SPY 1D
  await setSym(p, 'IDX:SPY', '1D');
  await add(p, 'stk_offex'); await add(p, 'stk_offex_lv'); await sleep(1500);
  await p.evaluate(async () => { const m = await import('/assets/chart-offex.js?v=843'); const bars = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const px = bars[bars.length - 1].close; window.__px = px; });
  await p.evaluate(async () => {
    const m = await import('/assets/chart-offex.js?v=843'); const px = window.__px;
    const wk = []; const base = new Date(); for (let i = 0; i < 10; i++) { const x = new Date(base.getTime() - (21 + i * 7) * 86400000); const ws = x.toISOString().slice(0, 10); const pr = px * (1 + ((i % 5) - 2) * 0.012); const sh = 30e6 + i * 2e6; wk.push([ws, sh, sh * pr, sh * 1.1, sh * 1.1 * pr]); }
    const j = await (await fetch('https://raw.githubusercontent.com/x/y/data-finra/finra-data.json')).json(); j.weekly.SPY = wk; m._setData(j);
    window.STRYKER_VELA.context().cells[0].chart.indicators().filter((x) => /^stk_offex/.test(x.nativeType)).forEach((h) => h.setInputs(h.inputValues()));
  });
  await sleep(2500);
  const st = await p.evaluate(() => window.__stkOffex || null);
  check(st && st.sym === 'SPY' && st.n > 20 && st.last > 5 && st.last <= 100 && st.levels >= 2 && st.lvSym === 'SPY', tag + ': off-exchange share points ' + JSON.stringify(st));
  const lvl = await p.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('canvas[data-stk-offex]')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 120) n++; } return n; });
  check(lvl > 400, tag + ': weekly level lines painted (' + lvl + ' px)');
  const pos2 = await p.evaluate(() => (window.__stkOffexHits || [])[0] || null);
  if (pos2) {
    for (let k = 0; k < 10; k++) {
      if (phone(o)) await p.touchscreen.tap(pos2.x, pos2.y + k); else await p.mouse.move(pos2.x, pos2.y + k);
      await sleep(250);
      const t = await p.evaluate(() => { const t = document.querySelector('.stk-ox-tip'); return t && !t.hidden ? t.innerText : null; });
      if (t) { check(/Average price/.test(t) && /FINRA data, updated weekly/.test(t), tag + ': level tip "' + t.replace(/\n/g, ' | ').slice(0, 140) + '"'); break; }
      if (k === 9) check(false, tag + ': no tooltip on a level label');
    }
  } else check(false, tag + ': no level label pixel');
  const text = await p.evaluate(() => document.body.innerText);
  check(!/\blive\b|real-time|delayed/i.test(await p.evaluate(() => [...document.querySelectorAll('.stk-ox-tip,.stk-of-tip,.stk-of-chip')].map((x) => x.textContent).join(' '))), tag + ': no live / real-time wording in our tips');
  await shot(p, 'offex-' + tag + '.png');
  await setSym(p, 'futures:ES1!', '5'); await sleep(1500);
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, '1440-dark', { w: 1440, h: 900, theme: 'dark' });
    await run(b, '1440-light', { w: 1440, h: 900, theme: 'light' });
    await run(b, '390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' });
    await run(b, '390-light', { w: 390, h: 844, mobile: true, theme: 'light' });
    await run(b, '390-free', { w: 390, h: 844, mobile: true, free: true, theme: 'dark' });
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
