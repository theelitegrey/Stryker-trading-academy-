// ZoroTide browser test: the GEX+ "ZoroTide" tab (assets/gex-tide.js) and the ZoroCharts "ZoroTide" indicator (assets/chart-zorotide.js).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/zorotide-browser.js [shotsDir]
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

async function open(b, { w, h, mobile, free, page, q }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) window.__stkChartTestFree = true;
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  const hits = [];
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(gex-|opt-)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/tide/, (r) => {
    const u = new URL(r.request().url()).searchParams.get('u'); hits.push(u);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply(u)) });
  });
  if (page === 'gex') {
    const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', n + '-0.json')));
    const LV = { SPX: fx('SPX'), QQQ: fx('QQQ') };
    await ctx.route(/\/api\/gex\/(levels|candles)\//, (r) => {
      const u = new URL(r.request().url());
      if (/candles/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candles: [] }) });
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[u.pathname.split('/').pop().toUpperCase()] || LV.SPX) });
    });
  }
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + (page === 'gex' ? '/gex.html' : '/charts.html' + (q || '')), { waitUntil: 'domcontentloaded' });
  if (page === 'gex') await sleep(4500);
  else { await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 }); await waitBars(p); }
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} }
  return false;
});
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(500); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }

// ---- GEX+ page ----------------------------------------------------------------------------------------
async function gexPage(b, tag, o) {
  const { ctx, p, errors, hits } = await open(b, Object.assign({ page: 'gex' }, o));
  if (o.free) await p.evaluate(() => window.strykerGexSetLimit({ markets: ['SPX'], dtes: [0], noLadder: true }));
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.gex-vtab')].map((x) => x.textContent));
  check(tabs[0] === 'Chart' && tabs[1] === 'Heatmap' && tabs[tabs.length - 1] === 'ZoroTide', tag + ': tab bar ' + tabs.join(','));
  await p.click('.gex-vtab[data-view="tide"]');
  await p.waitForFunction(() => { const s = window.strykerGexTide && window.strykerGexTide.state; return s && s.cum; }, null, { timeout: 15000 }).catch(() => {});
  const exp = expectedTotals('SPX');
  const txt = await p.evaluate(() => document.getElementById('gex-tide-totals').innerText);
  const fmtM = (v) => (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (Math.abs(v) / 1e3).toFixed(0) + 'K' : String(Math.abs(v)));
  check(txt.includes('+$' + fmtM(exp.cn)) && txt.includes('−$' + fmtM(exp.pn)), tag + ': totals net call +$' + fmtM(exp.cn) + ', net put −$' + fmtM(exp.pn) + ' (' + txt.replace(/\n/g, ' | ') + ')');
  const ratio = (exp.cp / exp.pp).toFixed(2);
  check(txt.includes(ratio), tag + ': call/put ratio ' + ratio);
  const status = await p.evaluate(() => document.getElementById('gex-tide-status').innerText);
  check(/^Estimated from options volume and quotes\. (Updated (just now|\d+ min ago)\.|Session of)/.test(status), tag + ': status "' + status + '"');
  const all = await p.evaluate(() => document.getElementById('gex-tide-card').innerText + ' ' + document.getElementById('gex-tide-card').textContent);
  check(!/\blive\b|real-time|delayed|market tide|unusual whales/i.test(all), tag + ': no banned words');
  check(/Options money flow: calls vs puts/.test(all) && /top 25%/.test(all) && /volume now − volume at the previous sample/.test(all), tag + ': subtitle and method help text present');
  const painted = await p.evaluate(() => {
    const c = document.getElementById('gex-tide-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let gr = 0, rd = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 120) gr++; if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) rd++; }
    return { gr, rd };
  });
  check(painted.gr > 150 && painted.rd > 150, tag + ': green and red lines painted (' + painted.gr + ' / ' + painted.rd + ' px)');
  const box = await p.evaluate(() => { const r = document.getElementById('gex-tide-wrap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.evaluate((y) => window.scrollTo(0, window.scrollY + y - 120), box.y);
  await sleep(300);
  const box2 = await p.evaluate(() => { const r = document.getElementById('gex-tide-wrap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  if (o.mobile) await p.touchscreen.tap(box2.x + box2.w * 0.5, box2.y + box2.h * 0.5); else await p.mouse.move(box2.x + box2.w * 0.5, box2.y + box2.h * 0.5);
  await sleep(500);
  const tip = await p.evaluate(() => { const t = document.getElementById('gex-tide-tip'); return t.hidden ? null : t.innerText; });
  check(tip && /ET/.test(tip) && /Net calls \+\$/.test(tip) && /Net puts −\$/.test(tip), tag + ': tap/hover shows values "' + (tip || '').replace(/\n/g, ' | ') + '"');
  const ow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(ow.sw <= ow.cw + 1, tag + ': no horizontal overflow (' + ow.sw + ' <= ' + ow.cw + ')');
  await shot(p, 'zorotide-gex-' + tag + '.png');
  const opts = await p.evaluate(() => [...document.querySelectorAll('#gex-tide-day option')].map((x) => x.value));
  check(opts.length === 2 && opts[0] === DAYS[0], tag + ': day list ' + opts.join(','));
  await p.evaluate(() => window.scrollTo(0, 0));
  if (!o.free) {
    await p.click('#gex-tabs [data-m="QQQ"]'); await sleep(2500);
    check(hits.includes('QQQ'), tag + ': QQQ requested after picking QQQ');
    const t2 = await p.evaluate(() => document.getElementById('gex-tide-title').textContent);
    check(/QQQ/.test(t2), tag + ': title follows the market (' + t2 + ')');
  } else {
    await p.click('#gex-tabs [data-m="QQQ"]'); await sleep(1500);
    const lock = await p.evaluate(() => !!document.querySelector('#gex-lock-slot .plan-lock, #gex-tide-lock'));
    check(lock && !hits.includes('QQQ'), tag + ': Free taps QQQ -> Pro lock, QQQ never requested (hits ' + hits.join(',') + ')');
  }
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}

// ---- ZoroCharts ---------------------------------------------------------------------------------------------
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(1500); };
const nInd = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((x) => x.nativeType === 'stk_tide').length);
async function chartsRun(b, tag, o) {
  const { ctx, p, errors, hits } = await open(b, Object.assign({ page: 'charts' }, o));
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
  const listed = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_tide"]'); return r ? r.textContent : null; });
  check(listed && /ZoroTide/.test(listed), tag + ': indicator window lists ZoroTide (' + (listed || '').slice(0, 90) + ')');
  if (o.free) {
    check(await p.evaluate(() => !!document.querySelector('.stkiw-row[data-key="b:stk_tide"] .stk-protag')), tag + ': Free sees the PRO tag');
    await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_tide"] .stkiw-name').click()); await sleep(1200);
    check((await nInd(p)) === 0, tag + ': Free click does not add it');
    const m = await p.evaluate(() => { const m = document.getElementById('plan-upgrade-modal'); return m && m.classList.contains('open') ? m.innerText.slice(0, 160) : null; });
    check(!!m && /Pro/i.test(m) && /options flow on charts are part of Pro/.test(m), tag + ': upgrade modal opens (' + m + ')');
    await shot(p, 'zorotide-chart-' + tag + '-modal.png');
    check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close(); return;
  }
  await p.keyboard.press('Escape'); await sleep(400);
  await setSym(p, 'futures:ES1!', '5');
  await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_tide', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
  await sleep(3500);
  check((await nInd(p)) === 1 && hits.length >= 1 && hits.every((u) => u === 'SPX'), tag + ': ES asks SPX only (' + hits.join(',') + ')');
  const exp = expectedTotals('SPX');
  const tide = await p.evaluate(() => window.__stkTide || null);
  check(tide && tide.u === 'SPX' && tide.n > 5, tag + ': call and put lines have points (' + (tide && tide.n) + ')');
  // the chart's newest candle can end before the newest sample (a delayed candle feed): the line then shows the running total as of
  // that candle's end, never a later one. So the value must be one of the day's running totals, at most the full-day total.
  const runs = (() => { const d = reply('SPX').days[0]; let a = 0, c = 0; const A = [], C = []; d.cn.forEach((v, i) => { a += v; c += d.pn[i]; A.push(a); C.push(c); }); return { A, C }; })();
  const iCall = tide ? runs.A.indexOf(tide.call) : -1;
  check(iCall >= 0 && runs.C[iCall] === tide.put && tide.call <= exp.cn, tag + ': last value is the running total at one sample (call ' + (tide && tide.call) + ' / put ' + (tide && tide.put) + ' = sample ' + iCall + ' of ' + exp.n + ', never past the full-day total)');
  await shot(p, 'zorotide-chart-' + tag + '-es.png');
  await setSym(p, 'futures:NQ1!', '5'); await sleep(2000);
  check(hits.includes('QQQ'), tag + ': NQ asks QQQ');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await gexPage(b, '1440-pro', { w: 1440, h: 900 });
    await gexPage(b, '390-pro', { w: 390, h: 844, mobile: true });
    await gexPage(b, '390-free', { w: 390, h: 844, mobile: true, free: true });
    for (const v of ['0.9', '0.6']) {
      const q = v === '0.6' ? '?vela=0.6' : '';
      await chartsRun(b, '1440-v' + v + '-pro', { w: 1440, h: 900, q });
      await chartsRun(b, '390-v' + v + '-pro', { w: 390, h: 844, mobile: true, q });
      await chartsRun(b, '390-v' + v + '-free', { w: 390, h: 844, mobile: true, free: true, q });
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
