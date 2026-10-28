// Market Stats page (market-stats.html) at 1440 and 390: real clicks, the drill-down sheet, the Chart link, and the chart
// deep link (?date=) on Vela 0.9 and 0.6. /scan?part=ms_* is answered from tools/tests/fixtures/market-stats (real feeder output).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/market-stats-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'market-stats');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile }, url) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_ms'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan/, (r) => {
    const part = new URL(r.request().url()).searchParams.get('part');
    const f = path.join(FIX, part + '.json.gz');
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no data' });
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t' }, body: fs.readFileSync(f) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errors };
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(300); await p.screenshot({ path: OUT + '/' + name }); console.log('shot ' + OUT + '/' + name); }

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 1000 }, { w: 390, h: 844, mobile: true }]) {
      const tag = vp.w;
      const { ctx, p, errors } = await open(b, vp, '/market-stats.html');
      await p.waitForSelector('.ms-card', { timeout: 20000 }).catch(() => {});
      await p.evaluate(() => document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')));
      await sleep(400);
      let s = await p.evaluate(() => ({
        cards: document.querySelectorAll('.ms-card').length,
        first: (document.querySelector('.ms-card.main') || {}).innerText,
        ox: document.documentElement.scrollWidth - window.innerWidth,
        disc: /Historical frequencies with sample sizes\. Not predictions\./.test(document.body.innerText),
        credit: /Statistics engine based on LuxAlgo Edge Stats \(MIT\)/.test(document.body.innerText),
        bad: /win rate|real-?time|delayed|profit/i.test(document.querySelector('.ms-page').innerText)
      }));
      check(s.cards >= 10, tag + ': ' + s.cards + ' cards');
      check(/N = \d+/.test(s.first) && /95% interval/.test(s.first), tag + ': first card shows N and 95% interval: ' + String(s.first).replace(/\n/g, ' | ').slice(0, 140));
      check(s.disc && s.credit && !s.bad, tag + ': disclaimer line + LuxAlgo credit, no banned words');
      check(s.ox <= 0, tag + ': no sideways overflow (' + s.ox + ')');
      await shot(p, 'ms-' + tag + '-gap.png');
      // report tab, symbol, filters by real clicks
      await p.click('.ms-tab[data-rep="or15"]'); await sleep(300);
      check(await p.evaluate(() => /First break up/.test(document.querySelector('.ms-grid').innerText)), tag + ': opening range tab renders');
      await p.click('.ms-chip[data-sym="ES"]'); await p.waitForSelector('.ms-chip.on[data-sym="ES"]'); await sleep(800);
      check(await p.evaluate(() => document.querySelectorAll('.ms-card').length > 5), tag + ': ES loads');
      await p.selectOption('#ms-dow', '1'); await sleep(300);
      const sum = await p.evaluate(() => document.querySelector('.ms-sum b').textContent);
      check(Number(sum) > 20 && Number(sum) < 80, tag + ': Tuesday filter -> ' + sum + ' sessions');
      await p.selectOption('#ms-dow', '-1'); await p.click('.ms-tab[data-rep="gap"]'); await p.click('.ms-chip[data-sym="NQ"]'); await sleep(500);
      // drill-down
      await p.click('.ms-card.main'); await p.waitForSelector('#ms-sheet .ms-sess tbody tr');
      s = await p.evaluate(() => ({ rows: document.querySelectorAll('#ms-sheet tbody tr').length, head: document.querySelector('.ms-sh-sum').innerText, link: document.querySelector('.ms-go').getAttribute('href') }));
      check(s.rows > 10, tag + ': sheet lists ' + s.rows + ' sessions; ' + s.head.replace(/\n/g, ' '));
      check(/^charts\?symbol=NQ&date=\d{4}-\d{2}-\d{2}&tf=5&vela=0\.9&o=[\d.]+&pdh=/.test(s.link), tag + ': chart link ' + s.link.slice(0, 90));
      await shot(p, 'ms-' + tag + '-sheet.png');
      await p.keyboard.press('Escape'); await sleep(200);
      check(await p.evaluate(() => !document.getElementById('ms-sheet')), tag + ': Esc closes the sheet');
      check(errors.length === 0, tag + ': no page errors ' + errors.join(' | ').slice(0, 200));
      // open a session on the chart (drill link), Vela 0.9 then 0.6
      if (tag === 1440 || true) {
        await p.click('.ms-card.main'); await p.waitForSelector('#ms-sheet .ms-go');
        const href = await p.evaluate(() => document.querySelector('.ms-go').getAttribute('href'));
        const oldHref = await p.evaluate(() => document.querySelectorAll('.ms-go')[55].getAttribute('href'));
        await ctx.close();
        for (const v of ['0.9', '0.6']) {
          const link = href.replace('vela=0.9', 'vela=' + v) + '&t=20&lbl=Gap%20filled';
          const c = await open(b, vp, '/' + link);
          const date = /date=([\d-]+)/.exec(href)[1];
          await c.p.waitForFunction(() => window.STRYKER_VELA && window.__stkFirstCandles, null, { timeout: 40000 }).catch(() => {});
          await sleep(9000);
          const r = await c.p.evaluate((date) => {
            const ws = window.STRYKER_VELA; if (!ws) return { err: 'no workspace' };
            const ch = ws.active.chart, o = ch.orchestrator;
            const bars = o.rawBars, vr = ch.visibleRange ? ch.visibleRange() : null;
            const inds = ch.indicators().map((h) => h.nativeType).filter(Boolean);
            const first = bars.length ? new Date(bars[0].time).toISOString() : '', last = bars.length ? new Date(bars[bars.length - 1].time).toISOString() : '';
            return { sym: String(o.config.market.symbol), tf: String(o.config.market.timeframe), n: bars.length, first, last, inds, chip: (document.querySelector('.stk-ms-chip') || {}).textContent, nodata: window.__msNoData || false, vr };
          }, date);
          console.log(v, tag, JSON.stringify(r).slice(0, 400));
          check(r.sym && /NQ/.test(r.sym) && r.tf === '5', tag + ' vela ' + v + ': NQ 5m (' + r.sym + ' ' + r.tf + ')');
          check((r.inds || []).includes('stk_msess') && /Gap/.test(r.chip || ''), tag + ' vela ' + v + ': overlay on, chip "' + (r.chip || '') + '"');
          await shot(c.p, 'ms-' + tag + '-chart-' + v + '.png');
          await c.ctx.close();
        }
        if (tag === 1440) {
          const c = await open(b, vp, '/' + oldHref + '&t=40&lbl=Gap%20filled');
          await c.p.waitForFunction(() => window.STRYKER_VELA && window.__stkFirstCandles, null, { timeout: 40000 }).catch(() => {});
          await sleep(12000);
          const r = await c.p.evaluate(() => { const o = window.STRYKER_VELA.active.chart.orchestrator; return { tf: String(o.config.market.timeframe), first: new Date(o.rawBars[0].time).toISOString(), n: o.rawBars.length, chip: (document.querySelector('.stk-ms-chip') || {}).textContent, nodata: window.__msNoData || false }; });
          const od = /date=([\d-]+)/.exec(oldHref)[1];
          console.log('older session', od, JSON.stringify(r));
          check(r.first.slice(0, 10) <= od && (r.chip || '').includes(od), '1440: a session ~3 months back opens on the chart (tf ' + r.tf + ', first bar ' + r.first.slice(0, 10) + ')');
          await shot(c.p, 'ms-1440-chart-older.png');
          await c.ctx.close();
        }
        continue;
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
