// Browser test: COMMUNITY Pine built-ins (BUILTIN_PINE section 'community') on the Charts page.
//   CHART_BASE=http://127.0.0.1:8061 IDS=manipulation-model-fb DEEP=5000 OUT=<dir> \
//     node tools/tests/chart-pine-community-browser.js
// Run under `flock /tmp/stryker-chrome.lock`.
// Checks per id:
//  - the served assets/pine/<id>.pine is BYTE-IDENTICAL to the Owner's file (CRLF kept as-is)
//    in stryker-notes/reports/workers/pine-imports/community/ (SRC_DIR) when that dir exists;
//  - listed in the Indicators window under COMMUNITY > Top with its own author (never Stryker)
//    and the Community disclaimer notice on top;
//  - first add asks the one-time "I understand"; after it, the script runs and draws;
//  - timings at DEEP bars (default 5000) on NQ1! 5m and BTCUSDT 1m (TFS to override);
//  - phone 390 adds it; no console errors.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || path.join(require('os').tmpdir(), 'pine-community');
const SRC_DIR = process.env.SRC_DIR || '/root/projects/stryker-notes/reports/workers/pine-imports/community';
const DEEP = +(process.env.DEEP || 5000);
const IDS = (process.env.IDS || '').split(',').filter(Boolean);
const TFS = (process.env.TFS || 'futures:NQ1!@5,binance:BTCUSDT@1').split(',').map((x) => x.split('@'));
const PHONE = process.env.PHONE !== '0';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource/i;

async function page(b, w, h){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.StrykerIndicatorWindow && window.StrykerCommunityDisclaimer && window.STRYKER_PINE.__stkcdWrapped, null, { timeout: 60000 });
  return { ctx, p, errs };
}
async function setMarket(p, sym, tf, deep){
  await p.evaluate(([s, t]) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol(s); c.setTimeframe(t); }, [sym, tf]);
  return p.evaluate(async ([s, deep]) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (chart.market.symbol === s && chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
    if (deep) { await chart.setMarket({ bars: deep }); await chart.historyComplete(); }
    return chart.orchestrator.rawBars.length;
  }, [sym, deep]);
}
const clear = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
// Click the row in the window; accept the disclaimer if it shows. Returns ms until the handle exists.
async function addViaWindow(p, name, expectAck){
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-tab[data-k="top"]', { timeout: 20000 });
  await p.click('.stkiw-tab[data-k="top"]');
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  const before = await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
  const t0 = Date.now();
  await p.evaluate((name) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === name).querySelector('.stkiw-name').click(), name);
  const ack = await p.waitForSelector('.stkcd-ok', { timeout: 4000 }).then(() => true).catch(() => false);
  if (expectAck !== undefined) check(ack === expectAck, name + ': disclaimer ' + (expectAck ? 'asked on the first add' : 'not asked again'));
  if (ack) await p.click('.stkcd-ok');
  const t1 = Date.now();
  await p.waitForFunction((n) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > n, before, { timeout: 60000 }).catch(() => {});
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  return Date.now() - t1 + (ack ? 0 : (t1 - t0));
}
async function counts(p){
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
    if (!h) return { none: true, toasts: [...document.querySelectorAll('[class*="toast"]')].map((x) => x.textContent).join(' / ').slice(0, 300) };
    for (let i = 0; i < 160; i++) {
      const ind = (chart.inspect().indicators || []).find((x) => x.id === h.id);
      if (ind && (Object.keys(ind.series || {}).length || ind.boxes || ind.labels || ind.lines || ind.tables)) {
        await new Promise((r) => setTimeout(r, 1200));
        const s2 = (chart.inspect().indicators || []).find((x) => x.id === h.id) || ind;
        return { series: Object.keys(s2.series || {}).length, lines: s2.lines || 0, boxes: s2.boxes || 0, labels: s2.labels || 0, tables: s2.tables || 0 };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { timeout: true };
  });
}

(async () => {
  const b = await launch();
  try {
    const { ctx, p, errs } = await page(b, 1440, 900);
    const list = await p.evaluate(async () => (await import('/assets/chart-pine-builtins.js')).PICKER_SCRIPTS.filter((x) => x.section === 'community'));
    const items = list.filter((x) => !IDS.length || IDS.includes(x.id));
    check(items.length > 0, 'community built-ins found: ' + items.map((x) => x.id).join(', '));
    for (const it of items) {
      check(it.author && !/stryker/i.test(it.author) && !/stryker/i.test(it.name), it.id + ': author "' + it.author + '", no Stryker branding');
      const served = Buffer.from(await p.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch('/assets/' + u.replace(/\?.*$/, ''))).arrayBuffer())), it.source));
      const repoFile = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', it.source.replace(/\?.*$/, '')));
      check(served.equals(repoFile), it.id + ': served bytes == repo file (' + served.length + ' B)');
      const orig = path.join(SRC_DIR, it.id + '.pine');
      if (fs.existsSync(orig)) check(fs.readFileSync(orig).equals(repoFile), it.id + ': repo file BYTE-IDENTICAL to the Owner\'s file (CRLF as-is)');
      else console.log('INFO no original at', orig);
    }
    await p.evaluate(() => localStorage.removeItem(window.StrykerCommunityDisclaimer.KEY));
    // listing
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
    await p.waitForSelector('.stkiw-tab[data-k="top"]', { timeout: 20000 });
    await p.click('.stkiw-tab[data-k="top"]');
    await p.waitForSelector('.stkiw-row', { timeout: 20000 });
    for (const it of items) {
      const r = await p.evaluate((name) => {
        const row = [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === name);
        if (!row) return { found: false };
        const head = (document.querySelector('.stkiw-sect') || {}).textContent || '';
        const l = document.querySelector('.stkiw-list');
        const note = l.firstElementChild && l.firstElementChild.classList.contains('stkcd-note') ? 1 : 0;
        return { found: true, head: head.split(' ')[0], author: row.querySelector('.stkiw-auth').textContent, note };
      }, it.name);
      check(r.found && r.head === 'Top' && r.author === it.author && r.note === 1, it.name + ': under "' + r.head + '", author "' + r.author + '", disclaimer notice ' + r.note);
    }
    await p.waitForTimeout(300);
    await p.screenshot({ path: OUT + '/window-community-1440.png' });
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.close());
    let first = true;
    for (const [sym, tf] of TFS) {
      await clear(p);
      const n = await setMarket(p, sym, tf, DEEP);
      console.log('INFO', sym, tf, n, 'bars');
      for (const it of items) {
        await clear(p);
        const ms = await addViaWindow(p, it.name, first ? true : (sym === TFS[0][0] && tf === TFS[0][1] && it === items[1] ? false : undefined));
        first = false;
        const t1 = Date.now();
        const c = await counts(p);
        const total = ms + Date.now() - t1 - (c.timeout ? 0 : 1200);
        console.log('PERF', it.id, sym, tf, 'bars', n, 'run+first draw', total, 'ms', JSON.stringify(c));
        check(!c.none && !c.timeout && (c.boxes + c.lines + c.labels + c.tables + c.series) > 0, `${it.id} ${sym} ${tf}: draws ${JSON.stringify(c)}`);
        check(total < 20000, `${it.id} ${sym} ${tf}: ${total} ms < 20 s cap at ${n} bars`);
        await p.waitForTimeout(600);
        await p.screenshot({ path: `${OUT}/${it.id}-${sym.split(':')[1].replace('!', '')}-${tf}-1440.png` });
      }
    }
    check(!errs.length, 'desktop console errors: ' + (errs.slice(0, 4).join(' | ') || 'none'));
    await ctx.close();
    if (PHONE) {
      const ph = await page(b, 390, 844);
      await ph.p.evaluate(() => localStorage.setItem(window.StrykerCommunityDisclaimer.KEY, JSON.stringify({ _anon: 1, u1: 1 })));
      await setMarket(ph.p, 'futures:NQ1!', '5', 0);
      for (const it of items) {
        await clear(ph.p);
        await addViaWindow(ph.p, it.name);
        const c = await counts(ph.p);
        check(!c.none && !c.timeout, `phone 390: ${it.id} added ${JSON.stringify(c)}`);
        await ph.p.waitForTimeout(600);
        await ph.p.screenshot({ path: `${OUT}/${it.id}-phone-390.png` });
      }
      check(!ph.errs.length, 'phone console errors: ' + (ph.errs.slice(0, 4).join(' | ') || 'none'));
      await ph.ctx.close();
    }
  } catch (e) { console.log('FAIL exception', e && e.stack || e); fails++; }
  finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED', '| screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
