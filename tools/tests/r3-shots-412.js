// Connect sheet visual shots (tall viewport shows the whole sheet). node r3-shots.js outDir
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = 'http://127.0.0.1:8051', OUT = process.argv[2] || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  try {
    for (const [n, w, h, mob] of [['p412', 412, 1500, true]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: 'ws://127.0.0.1:8751' })); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && document.getElementById('stkrb-btn'), null, { timeout: 60000 });
      await sleep(1500);
      if (mob && !(await p.evaluate(() => document.getElementById('stkrb-btn').offsetWidth > 0))) await p.locator('#stkc-more-btn').tap();
      await p.evaluate(() => document.getElementById('stkrb-btn').click());
      await p.waitForFunction(() => document.getElementById('stkrb-sys').options.length > 2, null, { timeout: 15000 });
      await p.evaluate(() => { const s = document.getElementById('stkrb-sys'); s.value = 'TradeSea'; s.dispatchEvent(new Event('change')); const u = document.getElementById('stkrb-user'); u.value = 'LT-22GKF4H2'; u.dispatchEvent(new Event('input')); });
      await sleep(400);
      await p.screenshot({ path: `${OUT}/r3-${n}-empty-pass.png` });
      await p.evaluate(() => { const q = document.getElementById('stkrb-pass'); q.value = 'abc'; q.dispatchEvent(new Event('input')); document.getElementById('stkrb-remember').click(); });
      await p.focus('#stkrb-user'); await sleep(300);
      await p.screenshot({ path: `${OUT}/r3-${n}-filled.png` });
      await p.evaluate(() => document.getElementById('stkrb-where').click()); await sleep(600);
      await p.setViewportSize({ width: w, height: n === 'phone' ? 800 : 900 }); await sleep(300);
      await p.screenshot({ path: `${OUT}/r3-${n}-checklist-settled.png` });
      console.log(n, JSON.stringify(await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        return { sys: r('#stkrb-sysbtn') , sel: r('#stkrb-sys'), user: r('#stkrb-user'), pass: r('#stkrb-pass'), go: r('#stkrb-go'), eye: r('.stkrb-eye'), x: r('.stkrb-fullx'), goDis: document.getElementById('stkrb-go').disabled, font: getComputedStyle(document.getElementById('stkrb-user')).fontFamily.slice(0, 30), sw: document.documentElement.scrollWidth }; })));
      await ctx.close();
    }
  } finally { await b.close(); }
})();
