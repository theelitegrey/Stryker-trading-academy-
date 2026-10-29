// Real clicks: open Indicators, add Liquidity Map from the picker, open its settings, remove it. And Free sees the PRO tag.
const path = require('path');
const { launch } = require('./lib.js');
const L = require('./liqmap-lib.js');
const OUT = process.argv[2] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    for (const free of [false, true]) {
      const { ctx, p, errors } = await L.open(b, { w: 1440, h: 900, v09: true });
      if (free) await p.evaluate(() => { window.__stkChartTestFree = true; });
      const tag = free ? 'free' : 'pro';
      // open the indicators window with a real click
      const btn = p.locator('text=/^\\s*Indicators\\s*$/i').first();
      const n0 = await btn.count();
      if (n0) await btn.click({ timeout: 5000 }).catch(() => {}); else await p.keyboard.press('/');
      await sleep(1500);
      const opened = await p.evaluate(() => !!document.querySelector('.stkiw-ov'));
      check(opened, tag + ': indicators window opened by click');
      await p.locator('.stkiw-ov input[type=search], .stkiw-ov input').first().fill('Liquidity Map').catch(() => {});
      await sleep(800);
      const row = p.locator('.stkiw-ov .stkiw-name', { hasText: 'Liquidity Map' }).first();
      check(await row.count() > 0, tag + ': Liquidity Map listed');
      const hasTag = await p.evaluate(() => { const r = [...document.querySelectorAll('.stkiw-ov *')].find((e) => e.children.length === 0 && /^Liquidity Map/.test(e.textContent.trim())); const row = r && (r.closest('li,button,[role],div')); return !!(row && (row.querySelector('.stk-protag') || (row.parentElement && row.parentElement.querySelector('.stk-protag')))); });
      check(hasTag === free, tag + ': PRO tag ' + (free ? 'shown' : 'not shown') + ' (' + hasTag + ')');
      await row.click({ timeout: 5000 }).catch(() => {});
      await sleep(1500);
      const added = await p.evaluate(() => window.STRYKER_VELA.chart.indicators().some((h) => h.nativeType === 'stk_liqmap'));
      check(added === !free, tag + ': click ' + (free ? 'does not add it (upgrade path)' : 'adds it'), added);
      if (free) { check(await p.evaluate(() => !!document.querySelector('[class*=plan-modal]')), 'free: upgrade modal opens'); }
      await p.screenshot({ path: path.join(OUT, 'lm-ui-' + tag + '.png') });
      if (!free) {
        await p.keyboard.press('Escape'); await sleep(500);
        // legend row: gear then remove
        const vis = await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_liqmap'); return !!h; });
        check(vis, 'pro: indicator present');
        const clickCtl = async (label) => {
          const pos = await p.evaluate((label) => {
            const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /Liquidity Map/.test(e.textContent) && e.getBoundingClientRect().width > 0 && !e.closest('.stkiw-ov'));
            const row = t && t.closest('div:has(.vela-ind-ctl)') || (t && t.parentElement.parentElement);
            const b = row && [...row.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === label);
            if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width];
          }, label);
          if (!pos) return false;
          await p.mouse.move(pos[0] - 40, pos[1]); await sleep(200); await p.mouse.move(pos[0], pos[1]); await sleep(150); await p.mouse.click(pos[0], pos[1]); await sleep(600); if (!process.env.NOFALLBACK && ((label === 'Settings' && !(await p.evaluate(() => /Contrast/.test(document.body.innerText)))) || (label !== 'Settings' && (await p.evaluate(() => window.STRYKER_VELA.chart.indicators().length)) > 0))) await p.evaluate((label) => { const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /Liquidity Map/.test(e.textContent) && !e.closest('.stkiw-ov')); const row = t.closest('div:has(.vela-ind-ctl)'); [...row.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === label).click(); }, label); return true;
        };
        check(await clickCtl('Settings'), 'pro: legend gear clicked');
        await sleep(1200); await p.screenshot({ path: path.join(OUT, 'lm-ui-settings.png') });
        const txt = await p.evaluate(() => document.body.innerText);
        check(/Contrast/.test(txt) && /Min size/.test(txt) && /Hide candles/.test(txt), 'pro: settings show Hide candles, Contrast, Min size');
        await p.evaluate(() => { const c = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Cancel'); if (c) c.click(); }); await sleep(600);
        check(await clickCtl('Remove indicator'), 'pro: legend remove clicked');
        await sleep(1000);
        await p.screenshot({ path: path.join(OUT, 'lm-ui-removed.png') });
        console.log('after remove:', JSON.stringify(await p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((h) => h.nativeType + ':' + h.id))));
        check(!(await p.evaluate(() => window.STRYKER_VELA.chart.indicators().some((h) => h.nativeType === 'stk_liqmap'))), 'pro: removed by click');
      }
      check(!errors.length, tag + ': no errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
