// News markers + Economic events natives (assets/chart-news-markers.js) against
// tools/tests/chart-dev-server.mjs. /news and /cal are answered from fixtures placed around the
// last bars of the loaded chart; bars are live.
//   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock node --max-old-space-size=768 tools/tests/chart-news-markers-browser.js <shotsDir>
// Checks (1440, Pro): News markers draw on the bars that had headlines; hover shows them; a click
// opens the popover with links. Economic events draw dashed lines + labels; the header chip says
// "CPI in N min". Replay: with the clock before the last headline/event, those are not drawn and
// the request carries to=. Free: both show an "Unlock … with Pro" pill and no markers. 390: draws, no errors.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); };
const reqs = [];
let anchorMs = 0;   // last bar time, filled in from the page

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: !!free }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(news|cal)/, (r) => {
    const u = new URL(r.request().url());
    reqs.push(u.pathname + u.search);
    const A = anchorMs || Date.now();
    const H = (min, h, s) => ({ id: 'n' + min, t: Math.floor((A - min * 60000) / 1000), s: s || 'Reuters', h, u: 'https://example.com/' + min, g: ['NQ', 'MACRO'] });
    if (u.pathname === '/news') {
      const to = Number(u.searchParams.get('to')) || Infinity;
      const items = [H(15, 'Nasdaq futures extend losses after CPI'), H(15, 'Treasury yields jump on hot inflation', 'Mace News'), H(75, 'Microsoft slips after cloud warning'), H(200, 'Fed speaker says policy is in a good place'), H(400, 'Oil steadies ahead of inventory data')].filter((x) => x.t <= to);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items, updated: Math.floor(A / 1000) }) });
    }
    const E = (min, i, c, ti, x) => Object.assign({ t: A + min * 60000, i, c, cur: 'USD', ti }, x || {});
    const items = [E(-120, 'high', 'US', 'Core CPI MoM', { a: 0.4, f: 0.3, p: 0.2, u: '%' }), E(-60, 'medium', 'US', 'Retail Sales MoM'), E(-30, 'high', 'US', 'Initial Jobless Claims', { a: 230 }), E(20, 'high', 'US', 'Fed Interest Rate Decision'), E(-90, 'high', 'EU', 'ECB Interest Rate Decision')];
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ kind: 'events', items }) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('crash', () => console.log('PAGE CRASHED (renderer died: memory?)'));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkNewsMarkers && window.STRYKER_VELA.context().cells[0].chart.bars && window.STRYKER_VELA.context().cells[0].chart.bars().length > 50, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2500);
  anchorMs = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; let bs = []; try { bs = c.bars(); } catch (e) {} return bs.length ? bs[bs.length - 1].time : Date.now(); });
  return { ctx, p, errors };
}
const add = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_news', {}); c.addNativeIndicator('stk_econ', { inputs: { warn: 60 } }); window.STRYKER_VELA.context().stateChanged(); });
const state = (p) => p.evaluate(() => {
  const out = { news: [], econ: [], chips: [] };
  for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) for (const b of window.__stkNewsMarkers.hits(cv) || []) {
    if (b.kind === 'news') out.news.push({ x: b.x, n: b.data.items.length, t: b.data.t, h: b.data.items.map((i) => i.h) });
    else out.econ.push({ x: b.x, y: b.y, names: b.data.map((e) => e.n), a: b.data.map((e) => e.a) });
  }
  out.chips = [...document.querySelectorAll('.stk-nm-chip')].filter((c) => !c.hidden).map((c) => c.textContent);
  out.pills = [...document.querySelectorAll('.stk-nm-pill')].map((a) => a.textContent);
  const r = document.querySelector('canvas[data-stk-nm]'); out.rect = r ? (({ left, top }) => ({ left, top }))(r.getBoundingClientRect()) : null;
  return out;
});

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---------------- Pro, 1440
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      await p.evaluate(() => { try { window.STRYKER_VELA.context().cells[0].chart.setInterval ? 0 : 0; } catch (e) {} });
      await add(p);
      await p.waitForTimeout(3000);
      let s = await state(p);
      console.log('anchor', new Date(anchorMs).toISOString(), 'markers', s.news.length, 'econ', s.econ.length, 'chips', s.chips);
      check(s.news.length >= 2 && s.news.some((m) => m.n === 2), 'Pro: news markers drawn (two headlines share one bar)', s.news);
      const allNames = s.econ.flatMap((e) => e.names);
      check(allNames.includes('Core CPI') && allNames.includes('Jobless claims') && !allNames.some((n) => /ECB|Retail/.test(n)), 'Pro: high-impact US events drawn (not medium, not EU)', allNames);
      check(s.chips.some((c) => /FOMC in (19|20|21) min/.test(c)), 'Pro: header warning chip "FOMC in 20 min"', s.chips);
      check(reqs.some((q) => /\/news\?sym=NQ/.test(q)) && reqs.some((q) => /\/cal\?kind=events/.test(q)), 'Pro: asks /news?sym=NQ and /cal', reqs.slice(0, 4));
      // hover a news marker
      const m = s.news.find((x) => x.n === 2);
      const nb = await p.evaluate(() => { for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) { const bx = window.__stkNewsMarkers.hits(cv) || []; const b = bx.find((q) => q.kind === 'news' && q.data.items.length === 2); if (b) { const r = cv.getBoundingClientRect(); return { x: r.left + b.x, y: r.top + b.y }; } } return null; });
      if (nb) {
        await p.mouse.move(nb.x, nb.y);
        await p.waitForTimeout(300);
        const tip = await p.evaluate(() => { const t = document.querySelector('.stk-nm-tip:not(.stk-nm-pop)'); return t && !t.hidden ? t.textContent : ''; });
        check(/Nasdaq futures extend losses/.test(tip) && /Treasury yields/.test(tip), 'hover: tooltip lists the headlines', tip);
        await p.screenshot({ path: OUT + '/markers-1440-hover.png' });
        console.log('screenshot', OUT + '/markers-1440-hover.png');
        await p.mouse.click(nb.x, nb.y);
        await p.waitForTimeout(300);
        const pop = await p.evaluate(() => { const t = document.querySelector('.stk-nm-pop'); return t && !t.hidden ? [...t.querySelectorAll('a')].map((a) => [a.target, a.rel, a.href]) : null; });
        check(pop && pop.length === 2 && pop[0][0] === '_blank' && /noopener/.test(pop[0][1]), 'click: popover with links to the articles', pop);
        await p.keyboard.press('Escape');
      } else check(false, 'news marker with 2 headlines found');
      // econ hover shows numbers
      const eb = await p.evaluate(() => { for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) { const bx = window.__stkNewsMarkers.hits(cv) || []; const b = bx.find((q) => q.kind === 'econ' && q.data.some((e) => e.n === 'Core CPI') && q.ry); if (b) { const r = cv.getBoundingClientRect(); return { x: r.left + b.x, y: r.top + b.y }; } } return null; });
      if (eb) {
        await p.mouse.move(eb.x, eb.y); await p.waitForTimeout(300);
        const tip = await p.evaluate(() => { const t = document.querySelector('.stk-nm-tip:not(.stk-nm-pop)'); return t && !t.hidden ? t.textContent : ''; });
        check(/Core CPI MoM/.test(tip) && /Actual 0.4%/.test(tip) && /Forecast 0.3%/.test(tip), 'hover: event shows actual / forecast / previous', tip);
        await p.screenshot({ path: OUT + '/markers-1440-econ.png' });
        console.log('screenshot', OUT + '/markers-1440-econ.png');
        await p.mouse.move(700, 300);
      } else check(false, 'CPI label found');
      // indicator window lists them in the TradeZoro group
      // replay cut-off: clock 100 min before the last bar
      const cut = anchorMs - 140 * 60000;
      await p.evaluate((cut) => { window.__stkReplayBackup = window.__stkReplay; window.__stkReplay = { on: true, now: () => cut, E: cut }; }, cut);
      await p.waitForTimeout(7000);
      s = await state(p);
      const hs = s.news.flatMap((x) => x.h);
      check(!hs.some((h) => /Nasdaq futures|Treasury|Microsoft/.test(h)) && hs.some((h) => /Fed speaker/.test(h)), 'replay: no headline after the replay clock', hs);
      check(reqs.some((q) => /\/news\?.*to=\d+/.test(q)), 'replay: news request carries to=', reqs.slice(-3));
      const rn = s.econ.flatMap((e) => e.names);
      check(rn.length === 0, "replay: no event line after the clock", rn);
      check(s.chips.some((c) => /Core CPI in (19|20|21) min/.test(c)), 'replay: chip counts down from the replay clock ("Core CPI in 20 min")', s.chips);
      await p.screenshot({ path: OUT + '/markers-1440-replay.png' });
      console.log('screenshot', OUT + '/markers-1440-replay.png');
      await p.evaluate(() => { window.__stkReplay = window.__stkReplayBackup; });
      check(errors.length === 0, 'Pro 1440: no console errors', errors);
      await ctx.close();
    }
    // ---------------- Free, 1440
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, free: true });
      await add(p);
      await p.waitForTimeout(3000);
      const s = await state(p);
      check(s.news.length === 0 && s.econ.length === 0, 'Free: no markers drawn', s);
      check(s.pills.some((x) => /Unlock News markers with Pro/.test(x)) && s.pills.some((x) => /Unlock Economic events with Pro/.test(x)), 'Free: unlock pills', s.pills);
      await p.screenshot({ path: OUT + '/markers-1440-free.png' });
      console.log('screenshot', OUT + '/markers-1440-free.png');
      check(errors.length === 0, 'Free: no console errors', errors);
      await ctx.close();
    }
    // ---------------- Pro, 390
    {
      const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
      await add(p);
      await p.waitForTimeout(3000);
      const s = await state(p);
      check(s.news.length >= 1 && s.econ.length >= 1, '390: markers + events drawn', { n: s.news.length, e: s.econ.length });
      await p.screenshot({ path: OUT + '/markers-390.png' });
      console.log('screenshot', OUT + '/markers-390.png');
      check(errors.length === 0, '390: no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
