// Fresh live shots for the homepage: Learn, Creator Hub, ZoroTide (GEX+ tab), Liquidity Map. Usage: node home-shots.mjs <outdir>
import { launch, login, BASE } from './lib/browser.mjs';
const out = process.argv[2];
{ // signed out: Learn + Creator Hub example community
  const { b, page } = await launch(1440, 900);
  await page.goto(BASE + '/learn', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  await page.screenshot({ path: out + '/learn.png' });
  await page.goto(BASE + '/c/tradezoro', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000);
  await page.screenshot({ path: out + '/hub.png' });
  await b.close();
}
{ const { b, page, errors } = await launch(1440, 900);
  console.log('landed', await login(page));
  await page.goto(BASE + '/gex', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12000);
  await page.click('.gex-vtab[data-view="tide"]').catch((e) => console.log('tide tab', e.message.slice(0, 80)));
  await page.waitForTimeout(8000);
  await page.screenshot({ path: out + '/tide.png' });
  await page.goto(BASE + '/charts', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14000);
  const r = await page.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('binance:BTCUSDT'); ws.active.setTimeframe('1'); await new Promise((r) => setTimeout(r, 6000)); return !!ws.chart.addNativeIndicator('stk_liqmap', {}); });
  console.log('liqmap added', r);
  await page.waitForTimeout(60000);
  await page.screenshot({ path: out + '/liq.png' });
  console.log('errors', errors.slice(0, 3));
  await b.close();
}
