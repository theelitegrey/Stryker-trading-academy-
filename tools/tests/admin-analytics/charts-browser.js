// Browser test for the admin analytics charts + Live panel (fixtures only, no network).
// Needs a static server on BASE serving the repo root. Run (under the Chrome lock):
//   STRYKER_TEST_BASE=http://localhost:8765 node tools/tests/admin-analytics/charts-browser.js [shotsDir]
const path = require('path');
const fs = require('fs');
const { launch, BASE } = require('../lib.js');
const stubMod = require('./stub.js');

const SHOTS = process.argv[2] || '/root/projects/stryker-notes/admin-analytics-build/charts-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const CHARTS = ['total', 'new', 'active', 'freepaid', 'conv', 'peak', 'mrr', 'usd', 'payments', 'trials', 'planmix', 'funnel', 'alerts', 'push', 'support', 'sugg'];
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { cond ? pass++ : fail++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : '  ' + JSON.stringify(detail))); };

async function open(browser, mode, w, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  if (theme === 'light') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  await ctx.addInitScript((seed) => { try {
    // Fixture: 60 min of fake samples so the sparkline renders in shots (loaded mode only).
    if (!seed) { sessionStorage.removeItem('tz_admin_online_samples'); return; }
    var now = Date.now(), s = [];
    for (var i = 119; i >= 1; i--) s.push({ t: now - i * 30000, n: 6 + Math.round(4 * Math.sin(i / 9)) + (i % 7 === 0 ? 2 : 0) });
    sessionStorage.setItem('tz_admin_online_samples', JSON.stringify(s));
  } catch (e) {} }, mode === 'loaded');
  await ctx.addInitScript(stubMod.build(mode));
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message || e)));
  await p.goto(BASE + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}

async function shoot(p, name) {
  // Fixed overlays (top bar, cookie notice, push prompt) are not part of the section.
  await p.addStyleTag({ content: '.mobile-topnav,.dash-topbar,.tzc,#push-prompt,.market-strip{display:none!important}' });
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await p.waitForTimeout(150);
  const el = await p.$('#admin-analytics');
  const file = path.join(SHOTS, name + '.png');
  await el.screenshot({ path: file });
  console.log('SHOT  ' + file);
}

(async () => {
  const browser = await launch({ headless: true });
  try {
    // ---- loaded, 1440 dark
    let { ctx, p, errors } = await open(browser, 'loaded', 1440, 'dark');
    const info = await p.evaluate((ids) => ids.map((id) => {
      const c = document.getElementById('aac-c-' + id);
      return { id, svg: !!c.querySelector('svg'), hbars: !!c.querySelector('.aac-hbars'), empty: (c.querySelector('.aac-empty') || {}).textContent || '',
        csv: !!c.querySelector('.aac-csv'), table: !!c.querySelector('table.aac-table'), label: c.getAttribute('aria-label') };
    }), CHARTS);
    const drawn = ['total', 'new', 'active', 'freepaid', 'conv', 'mrr', 'usd', 'payments', 'trials', 'planmix'];
    drawn.forEach((id) => { const r = info.find((x) => x.id === id); ok('loaded: ' + id + ' draws an SVG with CSV + a11y table', r.svg && r.csv && r.table && !!r.label, r); });
    ['funnel', 'support', 'sugg'].forEach((id) => { const r = info.find((x) => x.id === id); ok('loaded: ' + id + ' draws bars', r.hbars && r.csv, r); });
    // Engagement series exist only on today's snapshot: one point is not a trend.
    ['peak', 'alerts', 'push'].forEach((id) => { const r = info.find((x) => x.id === id); ok('loaded: ' + id + ' with 1 snapshot shows empty state, no line', !r.svg && /1 daily snapshot|starts tomorrow/.test(r.empty), r); });
    const live = await p.evaluate(() => ({
      online: document.getElementById('aa-online-now').textContent.trim(), hub: document.getElementById('aac-hub').textContent.trim(),
      signups: document.getElementById('aac-signups-today').textContent.trim(), pay: document.getElementById('aac-payments-today').textContent.trim(),
      trials: document.getElementById('aac-trials-today').textContent.trim(), who: document.querySelectorAll('#aac-online-list li').length,
      whoPage: (document.querySelector('#aac-online-list .aac-who-p') || {}).textContent, ago: document.getElementById('aac-live-ago').textContent,
      pulse: getComputedStyle(document.getElementById('aa-online-dot')).animationName
    }));
    ok('live: online 10, hub 6, signups 4', live.online === '10' && live.hub === '6' && live.signups === '4', live);
    ok('live: payments/trials today are numbers', /^\d+$/.test(live.pay) && /^\d+$/.test(live.trials), live);
    ok('live: who list shows names with page paths', live.who === 3 && live.whoPage === '/charts.html', live);
    ok('live: "Updated … ago" and pulsing dot', /Updated/.test(live.ago) && live.pulse === 'aacPulse', live);
    // tooltip
    await p.$eval('#aac-c-total .aac-plot', (e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await p.waitForTimeout(100);
    const box = await p.$eval('#aac-c-total .aac-plot', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await p.mouse.move(box.x + box.w - 12, box.y + box.h / 2);
    await p.waitForTimeout(100);
    const hit = await p.evaluate((b) => { const e = document.elementFromPoint(b.x + b.w - 12, b.y + b.h / 2); return e ? (e.closest('.aac-plot') ? 'plot' : e.className || e.tagName) : null; }, box);
    if (hit !== 'plot') console.log('tooltip probe hit: ' + JSON.stringify(hit) + ' box ' + JSON.stringify(box));
    const tip = await p.$eval('#aac-c-total .aac-tip', (e) => ({ hidden: e.hidden, text: e.textContent }));
    ok('tooltip shows date + exact value (IST snapshot time)', !tip.hidden && /1,000/.test(tip.text) && /IST/.test(tip.text), tip);
    // keyboard
    await p.focus('#aac-c-new .aac-plot');
    await p.keyboard.press('ArrowLeft');
    const ktip = await p.$eval('#aac-c-new .aac-tip', (e) => ({ hidden: e.hidden, text: e.textContent }));
    ok('arrow keys move the tooltip', !ktip.hidden && /New signups/.test(ktip.text), ktip);
    // gap day: 12 days ago has no snapshot
    const gap = await p.evaluate(() => (document.querySelector('#aac-c-total table.aac-table tbody tr:nth-last-child(13) td:last-child') || {}).textContent);
    ok('missing day stays blank in the data table (no invented 0)', gap === '', gap);
    // CSV download
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#aac-c-payments .aac-csv')]);
    const csvText = fs.readFileSync(await dl.path(), 'utf8');
    ok('CSV download: header + 30 rows (30d range)', /^date_ist,Payments\n/.test(csvText) && csvText.trim().split('\n').length === 31, csvText.slice(0, 60));
    // range switch
    await p.click('#aac-range-seg [data-range="7d"]');
    await p.waitForTimeout(200);
    const rows7 = await p.$$eval('#aac-c-total table.aac-table tbody tr', (r) => r.length);
    ok('7d range: 7 rows', rows7 === 7, rows7);
    await p.click('#aac-range-seg [data-range="all"]');
    await p.waitForTimeout(400);
    const rowsAll = await p.$$eval('#aac-c-total table.aac-table tbody tr', (r) => r.length);
    ok('All range starts at seriesStart: 41 rows', rowsAll === 41, rowsAll);
    await p.click('#aac-range-seg [data-range="30d"]');
    await p.waitForTimeout(200);
    await p.mouse.move(5, 5);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('1440: no horizontal overflow', ov <= 1, ov);
    ok('loaded 1440: no page errors', errors.length === 0, errors);
    await shoot(p, '1440-dark');
    await ctx.close();

    // ---- loaded, 1440 light
    ({ ctx, p, errors } = await open(browser, 'loaded', 1440, 'light'));
    await shoot(p, '1440-light');
    await ctx.close();

    // ---- loaded, 390 + 412 dark
    for (const w of [390, 412]) {
      ({ ctx, p, errors } = await open(browser, 'loaded', w, 'dark'));
      const o = await p.evaluate(() => {
        const sec = document.getElementById('admin-analytics');
        const bad = Array.from(sec.querySelectorAll('*')).filter((e) => { if (e.closest('.sr-only')) return false; const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1; })
          .slice(0, 5).map((e) => e.className || e.tagName);
        return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, bad };
      });
      ok(w + ': no horizontal overflow, nothing past the edge', o.over <= 1 && o.bad.length === 0, o);
      const tap = await p.$$eval('#aac-range-seg button, .aac-csv', (b) => b.map((x) => x.getBoundingClientRect().height));
      ok(w + ': segment buttons/CSV at least 32 px tall', tap.every((h) => h >= 32), tap);
      ok(w + ': no page errors', errors.length === 0, errors);
      await shoot(p, w + '-dark');
      await ctx.close();
    }

    // ---- failed + no-data: state words only, never a fake 0 or chart
    for (const mode of ['failed', 'no-data']) {
      ({ ctx, p, errors } = await open(browser, mode, 1440, 'dark'));
      const r = await p.evaluate((ids) => ({
        svgs: ids.filter((id) => document.querySelector('#aac-c-' + id + ' svg')),
        texts: ids.map((id) => (document.querySelector('#aac-c-' + id + ' .aac-empty') || {}).textContent || ''),
        hub: document.getElementById('aac-hub').textContent.trim(), pay: document.getElementById('aac-payments-today').textContent.trim(),
        who: document.getElementById('aac-online-list').textContent.trim()
      }), CHARTS);
      ok(mode + ': hub card reads Unavailable', r.hub === 'Unavailable', r.hub);
      if (mode === 'failed') {
        ok('failed: no chart draws', r.svgs.length === 0, r.svgs);
        ok('failed: every chart reads Unavailable', r.texts.every((t) => t === 'Unavailable'), r.texts);
        ok('failed: today counts + who list Unavailable', r.pay === 'Unavailable' && r.who === 'Unavailable', r);
      } else {
        const daily = ['total', 'new', 'active', 'freepaid', 'conv', 'peak', 'mrr', 'planmix', 'funnel', 'alerts', 'push', 'support', 'sugg'];
        ok('no-data: snapshot charts read No data yet', daily.every((id) => /No data yet/.test(r.texts[CHARTS.indexOf(id)])), r.texts);
        ok('no-data: who list says nobody online', /Nobody online/.test(r.who), r.who);
        ok('no-data: order charts say "No ... in the last 30 days" (answered zero, no empty axis)',
          ['usd', 'payments', 'trials'].every((id) => /^No .* in the last 30 days/.test(r.texts[CHARTS.indexOf(id)])), r.texts);
      }
      ok(mode + ': no page errors', errors.length === 0, errors);
      if (mode === 'no-data') await shoot(p, '1440-dark-no-data');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})();
