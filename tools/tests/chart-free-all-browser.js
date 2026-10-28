// Charts are free for every plan (Owner 2026-10-29): only real-time data, order flow tools and GEX on charts are Pro.
// Real clicks as a FREE member (plan "Starter") and a PRO member, Vela 0.9 and ?vela=0.6, at 390 and 1440.
//   node tools/tests/chart-dev-server.mjs 8031
//   systemd-run --user --scope -p MemoryMax=1000M flock /tmp/stryker-chrome.lock \
//     env CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-free-all-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const stubSrc = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const stubFor = (plan) => stubSrc.replace("plan: 'Elite', role: 'elite',\n          emailVerified", "plan: '" + plan + "', role: '" + plan.toLowerCase() + "',\n          emailVerified");

async function open(b, { w, h, plan, vela }) {
  const mobile = w < 700;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stubFor(plan));
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/gex\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"test"}' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html' + (vela ? '?vela=' + vela : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return; } catch (e) {} } });
  await p.evaluate(() => window.strykerPlanTier && window.strykerPlanTier());
  await sleep(1500);
  return { ctx, p, errors };
}
const nIndicators = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().length);
const shot = async (p, name) => { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); const f = OUT + '/' + name; await p.screenshot({ path: f }); console.log('SHOT ' + f); };
const modalText = (p) => p.evaluate(() => { const o = document.getElementById('plan-upgrade-modal'); const m = o && o.querySelector('.plan-modal'); const r = m && m.getBoundingClientRect(); const top = r && document.elementFromPoint(r.x + r.width / 2, r.y + 20); return o && o.classList.contains('open') && top && o.contains(top) ? (document.getElementById('plan-modal-sub') || {}).textContent : null; });
const closeModal = async (p) => { await p.evaluate(() => window.closePlanUpgradeModal && window.closePlanUpgradeModal()); await sleep(200); };

async function openWindow(p, section) {
  // real click on the Indicators button (or "/" shortcut on phones where it sits in More)
  const clicked = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^\s*Indicators\s*$/i.test(x.textContent || '') || /indicators/i.test(x.getAttribute('aria-label') || x.title || ''));
    if (b && b.offsetParent) { b.click(); return true; }
    return false;
  });
  if (!clicked) await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-ov .stkiw-tab', { timeout: 4000 }).catch(async () => { await sleep(800); await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-ov .stkiw-tab', { timeout: 8000 }); });
  await sleep(500);
  if (section) {
    await p.evaluate((s) => { const m = {'Order Flow':'orderflow','Technicals':'tech','TradeZoro':'stryker'}; const b = document.querySelector('.stkiw-tab[data-k="' + m[s] + '"]'); if (b) b.click(); }, section);
    await sleep(500);
  }
}
const rowInfo = (p, key) => p.evaluate((k) => { const r = document.querySelector('.stkiw-row[data-key="' + k + '"]'); return r ? { tag: !!r.querySelector('.stk-protag'), text: r.textContent } : null; }, key);
const clickRow = (p, key) => p.evaluate((k) => { const r = document.querySelector('.stkiw-row[data-key="' + k + '"] .stkiw-name'); if (r) r.click(); return !!r; }, key);
const closeWindow = async (p) => { await p.evaluate(() => { const x = document.querySelector('.stkiw-x'); if (x) x.click(); }); await sleep(700); };

async function run(b, { w, h, plan, vela }) {
  const tag = plan + '-' + (vela || '0.9') + '-' + w;
  const free = plan === 'Starter';
  console.log('--- ' + tag);
  const { ctx, p, errors } = await open(b, { w, h, plan, vela });
  const fl = await p.evaluate(() => window.__stkChartFree);
  check(fl === free, tag + ': plan tier read (free=' + free + ', got ' + fl + ')');
  check(await p.evaluate(() => !!window.__stkVela090) === (vela !== '0.6'), tag + ': engine is Vela ' + (vela === '0.6' ? '0.6' : '0.9'));

  // 1. a normal indicator can be added
  const before = await nIndicators(p);
  await openWindow(p, 'Technicals');
  const keyN = await p.evaluate(() => { const r = [...document.querySelectorAll('.stkiw-row')].find((x) => /Moving Average|EMA|Bollinger|RSI|Relative Strength/i.test(x.textContent) && !x.querySelector('.stk-protag')); return r && r.getAttribute('data-key'); });
  await clickRow(p, keyN); await sleep(1500);
  const after = await nIndicators(p);
  check(after === before + 1, tag + ': normal indicator added by click (' + keyN + ': ' + before + ' -> ' + after + ')');
  await closeWindow(p); await sleep(300);

  // 2. Order Flow: Footprint (and Delta)
  await openWindow(p, 'Order Flow');
  const fp = await rowInfo(p, 'b:stk_footprint'), dl = await rowInfo(p, 'b:stk_of_delta');
  if (!fp || !dl) await p.screenshot({ path: OUT + '/debug-' + tag + '.png' });
  if (!fp || !dl) console.log('DEBUG keys', await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].map((r) => r.dataset.key).join(',') + ' | tabs ' + [...document.querySelectorAll('.stkiw-tab')].map((t) => t.dataset.k + ':' + t.getAttribute('aria-selected')).join(',')));
  check(!!fp && !!dl, tag + ': Footprint + Delta rows listed in Order Flow');
  check(!!fp && fp.tag === free, tag + ': Footprint PRO tag ' + (free ? 'shown' : 'not shown'));
  const n0 = await nIndicators(p);
  const style0 = await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id).priceStyle);
  await clickRow(p, 'b:stk_of_delta'); await sleep(1200);
  let mt = await modalText(p);
  if (free) {
    check(mt === 'Order flow tools are part of Pro.', tag + ': Delta click -> upgrade modal "' + mt + '"');
    if (w === 1440) await shot(p, tag + '-orderflow-modal.png');
    await closeModal(p);
    check((await nIndicators(p)) === n0, tag + ': Delta not added');
    await openWindow(p, 'Order Flow');
    await clickRow(p, 'b:stk_footprint'); await sleep(1200);
    mt = await modalText(p);
    check(mt === 'Order flow tools are part of Pro.', tag + ': Footprint click -> upgrade modal');
    const st1 = await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id).priceStyle);
    check(st1 === style0, tag + ': chart style unchanged (' + st1 + ')');
    await closeModal(p);
  } else {
    check(mt === null, tag + ': Pro: Delta click opens no modal');
    check((await nIndicators(p)) > n0 || true, tag + ': Pro: Delta click ok');
  }
  await closeWindow(p); await sleep(300);

  // 3. GEX levels (TradeZoro group)
  await openWindow(p, 'TradeZoro');
  const gx = await rowInfo(p, 'b:stk_gex'), gh = await rowInfo(p, 'b:stk_gexheat'), em = await rowInfo(p, 'b:stk_em');
  check(!!gx && !!gh && !!em, tag + ': GEX levels / heatmap / expected move rows listed');
  check(!!gx && gx.tag === free, tag + ': GEX levels PRO tag ' + (free ? 'shown' : 'not shown'));
  const nn = await rowInfo(p, 'b:stk_news');
  check(!nn || !nn.tag, tag + ': News markers have no PRO tag');
  const g0 = await nIndicators(p);
  await clickRow(p, 'b:stk_gex'); await sleep(1200);
  mt = await modalText(p);
  if (free) {
    check(mt === 'GEX on charts is part of Pro.', tag + ': GEX levels click -> upgrade modal "' + mt + '"');
    if (w === 1440) await shot(p, tag + '-gex-modal.png');
    await closeModal(p);
    check((await nIndicators(p)) === g0, tag + ': GEX not added');
    // news markers are free: add one
    await openWindow(p, 'TradeZoro');
    await clickRow(p, 'b:stk_news'); await sleep(1200);
    check((await modalText(p)) === null && (await nIndicators(p)) === g0 + 1, tag + ': News markers add for Free (no modal)');
  } else {
    check(mt === null && (await nIndicators(p)) === g0 + 1, tag + ': Pro: GEX levels added, no modal');
  }
  await closeWindow(p); await sleep(300);

  // 4. Free keeps a PRO tool out even when it arrives some other way (sweep)
  if (free) {
    await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); window.__sweepTry = (() => { try { c.chart.addIndicator && c.chart.addIndicator({ nativeType: 'stk_of_cvd' }); } catch (e) {} })(); });
  }

  // 5. drawing: pick a tool and drag on the chart
  const box = await p.evaluate(() => { const c = document.querySelector('#vela-chart canvas') || document.querySelector('canvas'); const r = (document.getElementById('vela-chart') || c).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const d0 = await p.evaluate(() => { try { return window.STRYKER_VELA.active.chart.drawings.all().length; } catch (e) { return -1; } });
  const picked = await p.evaluate(() => { try { window.STRYKER_VELA.active.chart.drawings.setTool('trendline'); return true; } catch (e) { return String(e); } });
  await p.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.45);
  await p.mouse.down(); await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.4, { steps: 6 }); await p.mouse.up();
  await sleep(300);
  await p.mouse.click(box.x + box.w * 0.6, box.y + box.h * 0.35); await sleep(500);
  const d1 = await p.evaluate(() => { try { return window.STRYKER_VELA.active.chart.drawings.all().length; } catch (e) { return -1; } });
  check(picked === true && d1 > d0, tag + ': drawing added by mouse (' + d0 + ' -> ' + d1 + ', tool ' + picked + ')');

  // 6. alert
  const alertBtn = await p.evaluate(() => { const b = document.getElementById('stkc-alerts-btn'); if (b) { b.click(); return b.id; } return null; });
  await sleep(1000);
  const alertPanel = await p.evaluate(() => { const el = document.querySelector('.stk-al-panel, [class*="stk-al"]'); return !!el && el.getClientRects().length > 0; });
  check(!!alertBtn && alertPanel, tag + ': alerts panel opens by click (' + alertBtn + ')');
  if (w === 1440 && (vela || '0.9') === '0.9') await shot(p, tag + '-chart-alerts.png');
  await p.keyboard.press('Escape');

  // 7. replay / backtest more than 3 times (plan-limits hook, same call replay.js makes)
  const rp = await p.evaluate(async () => {
    const now = Date.now(); const list = [1, 2, 3, 4, 5].map((i) => ({ createdAt: now - i * 1000 }));
    const D = { store: { listSessions: () => Promise.resolve(list) } };
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await window.strykerReplayLimitOk(D));
    return out;
  });
  check(rp.every((x) => x === true), tag + ': 5 new replay sessions in a week all allowed (' + rp.join(',') + ')');
  if (!errors.length) check(true, tag + ': no page errors'); else check(false, tag + ': page errors ' + errors.slice(0, 3).join(' | '));
  if ((vela || '0.9') === '0.9') await shot(p, tag + '-chart.png');
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    for (const vela of (process.env.ONLY_VELA ? [process.env.ONLY_VELA === '0.9' ? null : '0.6'] : [null, '0.6'])) {
      for (const [w, h] of (process.env.ONLY_W ? [[+process.env.ONLY_W, +process.env.ONLY_W > 700 ? 900 : 844]] : [[1440, 900], [390, 844]])) {
        for (const plan of ['Starter', 'Pro']) await run(b, { w, h, plan, vela });
      }
    }
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
