// Charts shots: the layout pointer is browser-localStorage only, so the harness opens the saved layout through the app's own API.
import { launch, login, BASE } from './lib/browser.mjs';
const out = process.argv[2];
for (const W of [1440, 390]) {
  const { b, page, errors } = await launch(W, W < 500 ? 844 : 900);
  await login(page);
  await page.goto(BASE + '/charts', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12000);
  const ok = await page.evaluate(async () => { const L = window.STRYKER_LAYOUTS; if (!L) return 'no api'; await L.openById('lyNQgex5m'); return L.current && L.current.name; });
  console.log(W, 'layout', ok);
  await page.waitForTimeout(16000);
  await page.screenshot({ path: `${out}/charts-${W}.png` });
  if (W > 500) {
    await page.click('.stkgl-railbtn').catch((e) => console.log('ladder btn', e.message.slice(0, 60)));
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${out}/charts-ladder-${W}.png` });
  }
  console.log(W, 'errors', errors.filter((e) => !/Could not reach/.test(e)).slice(0, 3));
  await b.close();
}
