// "Days of history to load" end to end (assets/chart-days-load.js + chart-settings.js + chart-history-pager.js), against
// tools/tests/chart-dev-server.mjs.  node tools/tests/chart-dev-server.mjs 8031 &  CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-days-load-browser.js [shotsDir] [tag]
// Opens Chart settings > Symbol, checks the row + its menu (never more than the data holds), picks 7 days on 15m, checks the
// chart really holds >= 7 days, that 5m stays Auto, that the choice survives a timeframe round trip, and shoots the dialog.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp', TAG = process.argv[3] || 'after';
const DAY = 864e5;
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const cell = `(()=>{const ws=window.STRYKER_VELA;return ws.cell(ws.active.id)})()`;
async function waitLoaded(p, tf) {
  await p.waitForFunction((tf) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id); const o = c.chart.orchestrator; return String(o.config.market.timeframe) === tf && o.rawBars.length > 50 && o.historyCompleted && !o.switchingMarket; }, tf, { timeout: 45000 });
  await p.waitForTimeout(2500);
}
const span = (p) => p.evaluate(() => { const o = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.orchestrator; const b = o.rawBars; return { n: b.length, days: (b[b.length - 1].time - b[0].time) / 864e5 }; });
async function openSettings(p) {
  const shown = await p.evaluate(() => document.getElementById('stkc-settings-btn').getBoundingClientRect().width > 0);
  if (!shown) await p.click('#stkc-more-btn');
  await p.click('#stkc-settings-btn');
  await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' });
  await p.waitForTimeout(400);
  if (await p.$('.vela-dialog--settings .vela-sd-burger') && !(await p.isVisible('.vela-dialog--settings .vela-sd-tab'))) { await p.click('.vela-dialog--settings .vela-sd-burger'); await p.waitForTimeout(300); }
  await p.evaluate(() => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Symbol').click());
  await p.waitForTimeout(400);
}
const trig = () => { const l = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((x) => /Days of history/.test(x.textContent)); return l && l.closest('.vela-field-row').querySelector('.vela-select-trigger'); };
const ITEMS = () => [...document.querySelectorAll('.vela-select-item')].filter((x) => /^(Auto|\d+ days?|Max \()/.test(x.textContent) && x.getBoundingClientRect().width > 0);
async function rowInfo(p) {
  const value = await p.evaluate((f) => { const t = (0, eval)('(' + f + ')')(); if (!t) return null; t.scrollIntoView({ block: 'center' }); return t.textContent; }, trig.toString());
  if (value === null) return null;
  await p.evaluate((f) => (0, eval)('(' + f + ')')().click(), trig.toString()); await p.waitForTimeout(400);
  const options = await p.evaluate(() => [...document.querySelectorAll('.vela-select-item')].map((x) => x.textContent).filter((t) => /^(Auto|[0-9]+ days?|Max \()/.test(t)));
  return { value, options };
}
const pick = async (p, label) => { await p.evaluate(([f, label]) => (0, eval)('(' + f + ')')().find((x) => x.textContent === label).click(), [ITEMS.toString(), label]); await p.waitForTimeout(300); };
const okBtn = (p) => p.evaluate(() => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Ok').click());

(async () => {
  const b = await launch();
  for (const [w, h, mobile, scheme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark']]) {
    const tag = w + '-' + scheme;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((s) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (s === 'light') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, scheme);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHistoryPager, null, { timeout: 60000 });
    await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); if (c.symbol !== 'futures:NQ1!') c.setSymbol('futures:NQ1!'); c.setTimeframe('15'); });
    await waitLoaded(p, '15');
    const before = await span(p);
    await openSettings(p);
    const info = await rowInfo(p);
    check(!!info && info.value === 'Auto', tag + ': row shows Auto by default', info);
    check(info && info.options.length > 2 && info.options[0] === 'Auto', tag + ': menu has Auto + day choices');
    const cap = await p.evaluate(() => window.__stkHistoryPager.cap(window.STRYKER_VELA.active.id));
    check(cap > 0 && cap <= 366, tag + ': 15m cap is within the 366-day deep depth', cap);
    check(info && info.options.every((o) => o === 'Auto' || parseInt(o.replace('Max (', ''), 10) <= cap), tag + ': menu never offers more than the cap', info && info.options);
    await p.screenshot({ path: `${OUT}/daysload-${TAG}-${tag}.png` });
    console.log('shot', `${OUT}/daysload-${TAG}-${tag}.png`);
    if (TAG === 'after' && info && info.options.includes('14 days')) {
      await pick(p, '14 days'); await okBtn(p);
      await p.waitForFunction((d) => { const o = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.orchestrator; const b = o.rawBars; return (b[b.length - 1].time - b[0].time) / 864e5 >= d; }, 12, { timeout: 40000 }).catch(() => {});
      const aft = await span(p);
      check(aft.days >= 12 && aft.days > before.days, tag + ': 14 days chosen -> chart holds ~14+ days (was ' + before.days.toFixed(1) + ')', aft);
      await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).setTimeframe('5')); await waitLoaded(p, '5');
      const s5 = await span(p);
      check(s5.days < 12, tag + ': 5m is untouched (still Auto)', s5);
      await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).setTimeframe('15')); await waitLoaded(p, '15');
      const s15 = await span(p);
      check(s15.days >= 12, tag + ': back on 15m the choice is remembered', s15);
      const saved = await p.evaluate(() => { const st = window.STRYKER_VELA.getState(); return JSON.stringify(st).includes('stryker.daysload'); });
      check(saved, tag + ': choice is in the saved workspace state');
    }
    check(errors.length === 0, tag + ': no page errors', errors);
    await ctx.close();
    if (TAG === 'before') break;
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
