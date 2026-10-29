// Connect broker System picker on a phone (own list sheet) and desktop (native select).
//   node tools/tests/chart-dev-server.mjs 8031 ; RITHMIC_MOCK_DELAY=3000 node tools/tests/rithmic-mock.mjs 8765
//   CHART_BASE=... RITHMIC_MOCK=ws://127.0.0.1:8765 node tools/tests/rithmic-picker-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  try {
    for (const cfg of [{ n: 'phone', w: 390, h: 800, mobile: true }, { n: 'desk', w: 1440, h: 900, mobile: false }]) {
      for (const vela of ['', '?vela=0.6']) {
        const ctx = await b.newContext({ viewport: { width: cfg.w, height: cfg.h }, isMobile: cfg.mobile, hasTouch: cfg.mobile });
        await ctx.addInitScript(stub);
        await ctx.addInitScript((g) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: g })); } catch (e) {} }, MOCK);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
        const p = await ctx.newPage();
        const tag = cfg.n + (vela ? '-v06' : '-v09');
        await p.goto(BASE + '/charts.html' + vela, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && document.getElementById('stkrb-btn') && document.getElementById('stkrb-btn').offsetWidth > 0, null, { timeout: 60000 });
        await p.waitForFunction(() => { try { return window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } }, null, { timeout: 60000 });
        await sleep(800);
        const tap = (sel) => cfg.mobile ? p.locator(sel).tap() : p.locator(sel).click();
        if (cfg.mobile && !(await p.evaluate(() => document.getElementById('stkrb-btn').offsetWidth > 0))) await p.locator('#stkc-more-btn').tap();
        await tap('#stkrb-btn');
        await sleep(300);
        const sysBtn = '#stkrb-sysbtn';
        if (cfg.mobile) {
          const disabledEarly = await p.evaluate(() => document.getElementById('stkrb-sysbtn').disabled);
          await p.locator(sysBtn).tap({ force: true }).catch(() => {});
          await sleep(300);
          check(disabledEarly && await p.evaluate(() => document.getElementById('stkrb-syslist').hidden), tag + ' tap during loading opens nothing, button disabled');
          await p.waitForFunction(() => document.getElementById('stkrb-sys').options.length > 2, null, { timeout: 15000 });
          await p.locator(sysBtn).tap();
          await sleep(1500);
          check(!(await p.evaluate(() => document.getElementById('stkrb-syslist').hidden)), tag + ' list stays open');
          await p.screenshot({ path: `${OUT}/t5-picker-${tag}-list.png` });
          await p.setViewportSize({ width: cfg.w, height: 420 });
          await sleep(600);
          check(!(await p.evaluate(() => document.getElementById('stkrb-syslist').hidden)), tag + ' list survives viewport shrink');
          await p.fill('#stkrb-syslist input', 'trade');
          check((await p.locator('.stkrb-sysrow').count()) === 1, tag + ' search filters');
          await p.locator('.stkrb-sysrow').first().tap();
          await p.setViewportSize({ width: cfg.w, height: cfg.h });
          await sleep(300);
        } else {
          await p.waitForFunction(() => document.getElementById('stkrb-sys').options.length > 2, null, { timeout: 15000 });
          check(await p.evaluate(() => document.getElementById('stkrb-sysbtn').hidden), tag + ' desktop keeps native select');
          await p.selectOption('#stkrb-sys', 'TradeSea');
        }
        check((await p.inputValue('#stkrb-sys')) === 'TradeSea', tag + ' TradeSea sticks');
        check(!cfg.mobile || (await p.textContent(sysBtn)) === 'TradeSea', tag + ' button label shows TradeSea');
        check(!(await p.evaluate(() => document.getElementById('stkrb-pop').hidden)), tag + ' sheet still open');
        if (cfg.mobile) {
          check(await p.evaluate(() => { const r = document.getElementById('stkrb-pop').getBoundingClientRect(); return getComputedStyle(document.getElementById('stkrb-pop')).position === 'fixed' && r.width >= innerWidth - 2 && document.getElementById('stkrb-pop').parentNode === document.body; }), tag + ' sheet is a fixed full-screen layer on body');
          for (const [sel, txt] of [['#stkrb-user', 'demo'], ['#stkrb-pass', 'demo-pass'], ['#stkrb-gw', null]]) {
            await p.locator(sel).tap();
            await sleep(150);
            await p.setViewportSize({ width: cfg.w, height: Math.round(cfg.h * 0.55) });   // keyboard up
            await sleep(500);
            check(await p.evaluate((s) => !document.getElementById('stkrb-pop').hidden && document.activeElement === document.querySelector(s), sel), tag + ' ' + sel + ' keeps focus + sheet open while keyboard is up');
            if (txt) { await p.keyboard.type(txt, { delay: 20 }); await sleep(200); check((await p.inputValue(sel)) === txt, tag + ' typed into ' + sel); }
            await p.setViewportSize({ width: cfg.w, height: cfg.h });
            await sleep(400);
            check(!(await p.evaluate(() => document.getElementById('stkrb-pop').hidden)), tag + ' sheet open after keyboard down (' + sel + ')');
          }
          check((await p.inputValue('#stkrb-sys')) === 'TradeSea' && (await p.inputValue('#stkrb-user')) === 'demo' && (await p.inputValue('#stkrb-pass')) === 'demo-pass', tag + ' values persisted');
        } else { await p.fill('#stkrb-user', 'demo'); await p.fill('#stkrb-pass', 'demo-pass'); }
        await p.screenshot({ path: `${OUT}/t5-picker-${tag}-form.png` });
        await (cfg.mobile ? p.locator('#stkrb-go').tap() : p.click('#stkrb-go'));
        const ok = await p.waitForFunction(() => document.getElementById('stkrb-pop').hidden, null, { timeout: 20000 }).then(() => true, () => false);
        check(ok, tag + ' Connect works against mock (sheet closed after login)');
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
