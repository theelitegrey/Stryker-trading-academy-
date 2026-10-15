// Browser regression: paper ticket accepts exchange-prefixed futures from saved layouts.
//   node tools/tests/chart-dev-server.mjs 8056 & node tools/tests/chart-paper-symbol-browser.js http://127.0.0.1:8056 <outdir>
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8056';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 500)); };

async function runCase(browser, tag, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => { errs.push(e.message); console.log('pageerror', e.message.slice(0, 200)); });
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_CHART_UI && window.__stkPaper && window.__stkPaper.account, null, { timeout: 45000 });
  await p.evaluate(() => {
    const doc = { version: 1, layout: '1', charts: [{ id: 'gary-a', symbol: 'CME_MINI:NQ1!', timeframe: '1' }] };
    window.STRYKER_CHART_UI.applySaved({ state: doc });
  });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA.active && window.STRYKER_VELA.active.symbol === 'CME_MINI:NQ1!', null, { timeout: 15000 });
  // paper trading is OFF by default (Chart settings → Paper trading, 2026-10-14): this suite trades
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await p.evaluate(() => window.__stkPaper.account.setLast('CME_MINI:NQ1!', 21000));
  await p.click('.stkpt-trade');
  await p.waitForSelector('#stkpt-tk:not([hidden])', { timeout: 8000 });
  const r = await p.evaluate(() => {
    const tk = document.getElementById('stkpt-tk');
    const text = tk ? tk.textContent : '';
    const sp = window.PaperEngine.specOf(window.STRYKER_VELA.active.symbol);
    return {
      active: window.STRYKER_VELA.active.symbol,
      ok: sp.ok,
      canonical: sp.symbol,
      title: (document.querySelector('#stkpt-tk-h') || {}).textContent || '',
      qty: (document.querySelector('#stkpt-tk input[name="qty"]') || {}).value || '',
      unsupported: /not supported|covers futures and crypto/i.test(text),
      visible: !!tk && !tk.hidden
    };
  });
  t(tag + ': saved exchange-prefixed symbol active', r.active === 'CME_MINI:NQ1!', r);
  t(tag + ': ticket opens, no unsupported toast/message', r.visible && !r.unsupported, r);
  t(tag + ': spec canonicalises to futures:NQ1!', r.ok && r.canonical === 'futures:NQ1!', r);
  t(tag + ': ticket shows NQ quantity defaults', /NQ1!/.test(r.title) && r.qty === '1', r);
  // working order placed under the canonical key must draw on the CME_MINI:NQ1! chart (build 519 follow-up)
  await p.keyboard.press('Escape').catch(() => {});
  const ord = await p.evaluate(() => { try { const a = window.__stkPaper.account; a.setLast('CME_MINI:NQ1!', 21000); return a.placeOrder({ symbol: 'CME_MINI:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 }).order.symbol; } catch (e) { return 'ERR ' + e.message; } });
  t(tag + ': limit order stored under futures:NQ1!', ord === 'futures:NQ1!', ord);
  const chip = await p.waitForFunction(() => document.querySelector('.stkpt-chip[data-kind="ord"]'), null, { timeout: 8000 }).then(() => true, () => false);
  t(tag + ': working order line drawn on the CME_MINI:NQ1! chart', chip);
  await p.waitForTimeout(6500); // let unrelated provider-load toast fade before screenshot proof
  await p.screenshot({ path: OUT + 'paper-symbol-' + tag + '.png', fullPage: true });
  t(tag + ': no page errors', errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await runCase(b, '1440', { width: 1440, height: 900 }, false);
    await runCase(b, '390', { width: 390, height: 844 }, true);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
