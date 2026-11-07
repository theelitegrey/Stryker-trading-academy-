// Browser test: Dark Pool Prints on FUTURES charts (ES 5m <- SPY prints, NQ 1m <- QQQ prints), assets/chart-darkpool-map.js.
//   node tools/tests/chart-dev-server.mjs 8197 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8197 node tools/tests/darkpool-futures-browser.js [shotsDir]
// /scan?part=dp_spy / dp_qqq = SAVED REAL feeder parts of 2026-11-06 (tools/fixtures/darkpool-{spy,qqq}-2026-11-06.json). Bars come from the dev server's
// real /api/chart/bars (futures AND the ETF 1m bars the mapping reads). Firebase stubbed (richstub.js); a Free member, since the prints are free for everyone.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const OUT = process.argv[2] || '/tmp';
const FX = (s) => zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-' + s + '-2026-11-06.json')));
const PART = { spy: FX('spy'), qqq: FX('qqq') };
const DAY0 = Date.UTC(2026, 10, 6, 14, 30), DAY1 = Date.UTC(2026, 10, 6, 21, 0);
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {} window.__stkChartTestFree = true; }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!scan\?part=dp_)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=dp_/, (r) => {
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
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(4500); };
const add = (p) => p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_darkpool', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
const view = (p, f, t) => p.evaluate(([f, t]) => window.STRYKER_VELA.context().cells[0].chart.setVisibleRange({ from: f, to: t }), [f, t]);
const chip = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-dp-chip')].filter((x) => !x.hidden).map((x) => x.textContent).join(' | '));
const st = (p) => p.evaluate(() => window.__stkDarkpool || null);
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(700); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
async function waitMapped(p, sym) { for (let i = 0; i < 40; i++) { const s = await st(p); if (s && s.sym === sym && s.fut && s.n > 0) return s; await sleep(500); } return await st(p); }

async function run(b, tag, o, root, etf, tf, lastPx) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  await setSym(p, 'futures:' + root + '1!', tf);
  await add(p); await sleep(1500);
  await view(p, DAY0 - 600000, DAY1 + 300000); await sleep(1500);
  const s = await waitMapped(p, etf);
  check(s && s.fut === root && s.n > 300 && s.skipped >= 0, tag + ': ' + root + ' ' + tf + 'm shows ' + etf + ' prints: ' + JSON.stringify(s));
  const c = await chip(p);
  check(new RegExp(etf + ': \\d+ dark pool prints? ≥ \\$1M, shown at ' + root + ' price · Updated').test(c), tag + ': pill "' + c + '"');
  const painted = await p.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('canvas[data-stk-dp]')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; } return n; });
  check(painted > 800, tag + ': prints painted (' + painted + ' px)');
  // label says "SPY $40M"
  const pos = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-dp]'); const r = cv.getBoundingClientRect(); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, dpr = cv.width / r.width; for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { const i = (y * cv.width + x) * 4; if (d[i + 3] > 200 && d[i + 1] > 150 && d[i] < 80) return { x: r.left + x / dpr + 2, y: r.top + y / dpr + 3 }; } return null; });
  if (pos) {
    let t = null;
    for (let k = 0; k < 8 && !t; k++) { if (phone) await p.touchscreen.tap(pos.x, pos.y + k); else await p.mouse.move(pos.x, pos.y + k); await sleep(250); t = await p.evaluate(() => { const t = document.querySelector('.stk-dp-tip'); return t && !t.hidden ? t.innerText : null; }); }
    const re = new RegExp(etf + ' [\\d,]+\\.\\d\\d · at ' + root + ' ≈ [\\d,]+\\.\\d\\d');
    check(!!t && re.test(t), tag + ': tooltip "' + String(t).replace(/\n/g, ' | ') + '"');
    const m = t && /≈ ([\d,]+\.\d\d)/.exec(t); const px = m && +m[1].replace(/,/g, '');
    check(px && px > lastPx[0] && px < lastPx[1], tag + ': tooltip futures price ' + px + ' is an ' + root + ' level');
    await shot(p, 'dpfut-' + tag + '-tip.png');
    await p.keyboard.press('Escape');
  } else check(false, tag + ': no $10M+ dot found');
  // list panel
  await p.evaluate((ph) => document.querySelector(ph ? '.stkdkp-phonebtn' : '.stkdkp-railbtn').click(), phone); await sleep(1500);
  const hd = await p.evaluate(() => ({ sub: document.querySelector('#stkdkp .stkdkp-sub').textContent, hidden: document.querySelector('#stkdkp .stkdkp-sub').hidden, col: document.querySelector('#stkdkp .stkdkp-cols span:nth-child(2)').textContent, rows: document.querySelectorAll('#stkdkp .stkdkp-row').length, stat: document.querySelector('#stkdkp .stkdkp-stat').textContent, title: document.querySelector('#stkdkp .stkdkp-title').textContent }));
  check(hd.sub === etf + ' prints, shown at ' + root + ' price' && !hd.hidden, tag + ': list header "' + hd.sub + '"');
  check(hd.rows > 100 && /not placed|prints ≥ \$1M/.test(hd.stat) && hd.col === root + ' price', tag + ': list ' + JSON.stringify(hd));
  const row1 = await p.evaluate(() => document.querySelector('#stkdkp .stkdkp-row').title);
  check(new RegExp('^' + etf + ' [\\d,]+\\.\\d\\d · at ' + root + ' ≈').test(row1), tag + ': row hint "' + row1 + '"');
  await shot(p, 'dpfut-' + tag + '-panel.png');
  await p.evaluate(() => document.querySelector('#stkdkp .stkdkp-x').click()); await sleep(500);
  await view(p, DAY0 - 600000, DAY1 + 300000); await sleep(1200);
  await shot(p, 'dpfut-' + tag + '.png');
  const words = await p.evaluate(() => [...document.querySelectorAll('.stk-dp-tip,.stk-dp-chip,#stkdkp')].map((x) => x.textContent).join(' '));
  check(!/\blive\b|real-time|realtime|delayed|insight|yahoo|polygon|databento/i.test(words), tag + ': no live / vendor wording');
  // option off -> note
  await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_darkpool'); h.setInputs(Object.assign(h.inputValues(), { futEtf: false })); }); await sleep(800);
  check(/futures option is off/.test(await chip(p)), tag + ': option off -> note "' + await chip(p) + '"');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    const runs = [['es5-1440-dark', { w: 1440, h: 900, theme: 'dark' }, 'ES', 'SPY', '5', [7000, 7800]],
      ['nq1-1440-dark', { w: 1440, h: 900, theme: 'dark' }, 'NQ', 'QQQ', '1', [25000, 29000]],
      ['nq1-1440-light', { w: 1440, h: 900, theme: 'light' }, 'NQ', 'QQQ', '1', [25000, 29000]],
      ['nq1-390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }, 'NQ', 'QQQ', '1', [25000, 29000]]];
    for (const [t, o, r, e, tf, px] of runs) if (!only || only.split(',').includes(t)) await run(b, t, o, r, e, tf, px);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
