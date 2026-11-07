// Browser test: Dark Pool Prints (free for everyone, assets/chart-darkpool.js): chart markers + "Dark pool" list panel.
// 1440 + 412 + 390, dark + light; Elite, Free member and signed-out visitor all get the prints and the list.
//   node tools/tests/chart-dev-server.mjs 8197 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8197 node tools/tests/darkpool-browser.js [shotsDir]
// The recorder's GET /scan?part=dp_spy / dp_aapl is answered from the SAVED REAL feeder parts (tools/fixtures/darkpool-*-2026-11-06.json:
// every off-exchange print >= $1M of that session). Chart bars come from the dev server's /api/chart/bars (IDX:SPY, 5 min).
// Firebase is stubbed (richstub.js, an Elite member); Free uses window.__stkChartTestFree; signed-out: no user and a plan that never resolves.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const OUT = process.argv[2] || '/tmp';
const FX = (s) => zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-' + s + '-2026-11-06.json')));
const PART = { spy: FX('spy'), aapl: FX('aapl') };
const DAY0 = Date.UTC(2026, 10, 6, 14, 30), DAY1 = Date.UTC(2026, 10, 6, 21, 0);   // 2026-11-06 regular session in UTC
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fetched = 0;

async function open(b, { w, h, mobile, free, anon, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // signed-out: the plan never resolves (same as chart-gex-ladder-browser.js 'anon') and there is no user
  if (anon) await ctx.addInitScript(() => { Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => new Promise(() => {}), set() {} }); const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([free, theme]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {}
    if (free) window.__stkChartTestFree = true;
  }, [!!free, theme]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!scan\?part=dp_)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=dp_/, (r) => {
    fetched++;
    const s = new URL(r.request().url()).searchParams.get('part').slice(3);
    if (!PART[s]) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no data' });
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t', 'x-scan-gzip': '1' }, body: PART[s] });
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} } });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  return { ctx, p, errors };
}
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(4000); };
const add = (p, type, inputs) => p.evaluate(([t, i]) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const count = (p, type) => p.evaluate((t) => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((x) => x.nativeType === t).length, type);
const view = (p, from, to) => p.evaluate(([f, t]) => window.STRYKER_VELA.context().cells[0].chart.setVisibleRange({ from: f, to: t }), [from, to]);
const chip = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-dp-chip')].filter((x) => !x.hidden).map((x) => x.textContent).join(' | '));
const SHOOT = /darkpool-(1440-dark|1440-light|412-dark|390-dark|390-signedout)(-|\.)/;
async function shot(p, name) { if (!SHOOT.test(name)) return; await p.mouse.move(2, 2).catch(() => {}); await sleep(700); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const openPanel = (p, phone) => p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkdp-phonebtn' : '.stkdp-railbtn'); if (b) b.click(); return !!b; }, phone);

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  if (o.free || o.anon) {
    // free for everyone: no PRO tag in the Indicators window, and a click adds it
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /TradeZoro/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
    const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_darkpool"]'); return r ? { pro: !!r.querySelector('.stk-protag') } : null; });
    check(row && !row.pro, tag + ': Dark Pool Prints listed without a PRO tag ' + JSON.stringify(row));
    await p.keyboard.press('Escape'); await sleep(400);
  }
  await setSym(p, 'IDX:SPY', '5');
  fetched = 0;
  await add(p, 'stk_darkpool'); await sleep(2500);
  check(fetched > 0, tag + ': prints fetched (' + fetched + ')');
  check(!(await p.evaluate(() => document.querySelector('#stkdp .stkdp-lock, .stk-pro-modal, .stkpg-modal'))), tag + ': no lock card / upgrade modal');
  await view(p, DAY0 - 600000, DAY1 + 300000); await sleep(1500);
  check((await count(p, 'stk_darkpool')) === 1, tag + ': Dark Pool Prints added');
  const st = await p.evaluate(() => window.__stkDarkpool || null);
  check(st && st.sym === 'SPY' && st.n === 982 && st.big === 80 && st.drawn === 761, tag + ': real SPY part read: ' + JSON.stringify(st));
  const c1 = await chip(p);
  check(/SPY: \d+ dark pool prints ≥ \$1M · Updated/.test(c1), tag + ': status pill "' + c1 + '"');
  const painted = await p.evaluate(() => { let n = 0, g = 0; for (const c of document.querySelectorAll('canvas[data-stk-dp]')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 60) n++; if (d[i + 3] > 150 && d[i + 1] > 150 && d[i] < 80) g++; } } return { n, g }; });
  check(painted.n > 800 && painted.g > 40, tag + ': prints painted (' + painted.n + ' px, ' + painted.g + ' px $10M+ mint)');
  // hover / tap the biggest dot through the hit list
  const pos = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-dp]'); const r = cv.getBoundingClientRect(); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, dpr = cv.width / r.width; for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { const i = (y * cv.width + x) * 4; if (d[i + 3] > 200 && d[i + 1] > 150 && d[i] < 80) return { x: r.left + x / dpr + 2, y: r.top + y / dpr + 3 }; } return null; });
  if (pos) {
    let t = null;
    for (let k = 0; k < 8 && !t; k++) {
      if (phone) await p.touchscreen.tap(pos.x, pos.y + k); else await p.mouse.move(pos.x, pos.y + k);
      await sleep(250);
      t = await p.evaluate(() => { const t = document.querySelector('.stk-dp-tip'); return t && !t.hidden ? t.innerText : null; });
    }
    check(!!t && /(Block|Dark pool) print · \$/.test(t) && /Price/.test(t) && /Shares/.test(t) && /off the exchanges/.test(t), tag + ': card "' + String(t).replace(/\n/g, ' | ') + '"');
    if (t && !phone) await shot(p, 'darkpool-' + tag + '-tip.png');
    await p.keyboard.press('Escape');
  } else check(false, tag + ': no $10M+ dot found');
  // size filter $10M
  await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_darkpool'); h.setInputs(Object.assign(h.inputValues(), { minSize: '$10M' })); }); await sleep(1200);
  const st2 = await p.evaluate(() => window.__stkDarkpool || null);
  check(st2 && st2.n === 80 && st2.min === 10e6, tag + ': $10M filter -> 80 prints');
  await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_darkpool'); h.setInputs(Object.assign(h.inputValues(), { minSize: '$1M' })); }); await sleep(1200);
  await shot(p, 'darkpool-' + tag + '.png');
  // the Dark pool list
  check(await openPanel(p, phone), tag + ': panel button present'); await sleep(1500);
  const rows = await p.evaluate(() => document.querySelectorAll('#stkdp .stkdp-row').length);
  check(rows === 600, tag + ': list shows the newest 600 of 982 prints (' + rows + ')');
  const stat = await p.evaluate(() => document.querySelector('#stkdp .stkdp-stat').textContent);
  check(/982 prints ≥ \$1M, last session · Updated/.test(stat), tag + ': list status "' + stat + '"');
  const hdr = await p.evaluate(() => [...document.querySelectorAll('#stkdp .stkdp-cols span')].map((x) => x.textContent).join(','));
  check(hdr === 'Time,Price,Shares,Value', tag + ': columns ' + hdr);
  const ov = await p.evaluate(() => { const l = document.querySelector('#stkdp .stkdp-list'); const pn = document.getElementById('stkdp'); return { sx: l.scrollWidth - l.clientWidth, pw: pn.getBoundingClientRect().right <= window.innerWidth + 1 }; });
  check(ov.sx <= 1 && ov.pw, tag + ': no horizontal overflow in the list ' + JSON.stringify(ov));
  await shot(p, 'darkpool-' + tag + '-panel.png');
  await p.evaluate(() => [...document.querySelectorAll('#stkdp .stkdp-seg button')].find((b) => b.dataset.m === '$10M').click()); await sleep(500);
  const rows10 = await p.evaluate(() => document.querySelectorAll('#stkdp .stkdp-row').length);
  check(rows10 === 80, tag + ': list $10M+ -> 80 rows');
  // tap a row -> the chart jumps to it and rings the print
  const want = await p.evaluate(() => { const r = document.querySelectorAll('#stkdp .stkdp-row')[40]; const t = r.getAttribute('aria-label'); r.click(); return t; }); await sleep(1500);
  const vr = await p.evaluate(() => { const r = window.STRYKER_VELA.context().cells[0].chart.getVisibleRange(); return r && { from: r.from, to: r.to }; });
  check(vr && vr.from > DAY0 - 86400000 && vr.to < DAY1 + 86400000 && vr.to > vr.from, tag + ': row "' + String(want).slice(0, 60) + '" moved the chart to 2026-11-06 ' + JSON.stringify(vr));
  if (!phone) await p.evaluate(() => document.querySelector('#stkdp .stkdp-x').click());
  await sleep(500);
  // wording
  const words = await p.evaluate(() => [...document.querySelectorAll('.stk-dp-tip,.stk-dp-chip,#stkdp')].map((x) => x.textContent).join(' '));
  check(!/\blive\b|real-time|realtime|delayed/i.test(words), tag + ': no live / real-time / delayed wording');
  check(!/insight|finra_adf|tradingview|unusual whales|databento|polygon/i.test(words), tag + ': no vendor or rival names');
  // other markets
  await setSym(p, 'futures:ES1!', '5'); await sleep(1000);
  check(/US stocks and ETFs only/.test(await chip(p)), tag + ': futures get the short note');
  await setSym(p, 'IDX:AAPL', '5'); await view(p, DAY0 - 600000, DAY1 + 300000); await sleep(1500);
  const st3 = await p.evaluate(() => window.__stkDarkpool || null);
  check(st3 && st3.sym === 'AAPL' && st3.n === 268 && st3.big === 33, tag + ': real AAPL part read: ' + JSON.stringify(st3));
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    // the shot set is a FREE member (Owner: free for everyone); Elite and signed-out get the same checks
    const runs = [['1440-dark', { w: 1440, h: 900, free: true, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, free: true, theme: 'light' }],
      ['412-dark', { w: 412, h: 915, mobile: true, free: true, theme: 'dark' }], ['390-dark', { w: 390, h: 844, mobile: true, free: true, theme: 'dark' }],
      ['1440-elite', { w: 1440, h: 900, theme: 'dark' }],
      ['1440-signedout', { w: 1440, h: 900, anon: true, theme: 'dark' }], ['390-signedout', { w: 390, h: 844, mobile: true, anon: true, theme: 'dark' }]];
    for (const [t, o] of runs) if (!only || only.split(',').includes(t)) await run(b, t, o);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
