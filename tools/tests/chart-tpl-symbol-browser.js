// Regression: each saved template keeps its own symbol + interval after a full reload (same storage).
//   node tools/tests/chart-fixture-server.mjs 8263 any.json   (any.json = {})
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-tpl-symbol-browser.js [outDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8263';
const OUT = process.argv[2] || '/tmp'; fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x))); };
const cur = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return c.symbol + '|' + c.timeframe; });
const dark = (c) => c.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
// the real click path: Templates menu -> Apply <name>
const applyByName = async (p, name) => {
  await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await p.waitForSelector('button[aria-label="Apply ' + name + '"]', { state: 'attached', timeout: 8000 }).catch(async () => { console.log(await p.evaluate(() => [Object.keys(localStorage).join(','), [...document.querySelectorAll('button[aria-label^="Apply"]')].map((x) => x.getAttribute('aria-label')).join('|')])); });
  await p.evaluate((n) => document.querySelector('button[aria-label="Apply ' + n + '"]').click(), name);
  await sleep(3500);
};

(async () => {
  const b = await launch();
  try {
    for (const [tag, w, h, mobile] of [['1440', 1440, 900, false], ['390', 390, 844, true]]) {
      const A = await newCtx(b, { w, h, mobile }); await dark(A);
      const { p } = await openPage(A, BASE, true);
      const set = async (s, tf) => { await p.evaluate(([s, tf]) => { const c = window.STRYKER_VELA.active; c.setSymbol(s); c.setTimeframe(tf); }, [s, tf]); await sleep(3000); };
      await set('futures:NQ1!', '5');
      await p.evaluate(() => window.StrykerChartTemplates.save('TplNQ', window.STRYKER_VELA.getState()));
      await set('futures:GC1!', '15');
      await p.evaluate(() => window.StrykerChartTemplates.save('TplGC', window.STRYKER_VELA.getState()));
      await sleep(1500);   // let persist write
      const st = await A.storageState(); await A.close();
      for (const [name, want] of [['TplNQ', 'futures:NQ1!|5'], ['TplGC', 'futures:GC1!|15'], ['TplNQ', 'futures:NQ1!|5']]) {
        const C = await newCtx(b, { w, h, mobile }); await dark(C);
        // same storage: copy localStorage in once per context (survives the page's own reloads)
        await C.addInitScript((s) => { const o = JSON.parse(s).origins; o.forEach((og) => (og.localStorage || []).forEach((kv) => { if (!/theme|prompt|ack/.test(kv.name)) localStorage.setItem(kv.name, kv.value); })); }, JSON.stringify(st));
        const { p: q } = await openPage(C, BASE, true);
        t(`${tag} reopen = last used chart`, (await cur(q)) === 'futures:GC1!|15', await cur(q));
        await applyByName(q, name);
        t(`${tag} ${name} -> ${want}`, (await cur(q)) === want, await cur(q));
        await q.screenshot({ path: `${OUT}/${process.env.TAG || 'after'}-${tag}-${name}-dark.png` });
        await C.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
