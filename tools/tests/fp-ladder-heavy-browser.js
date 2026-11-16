// Ladder (delta) bars with "Highlight heavy activity" on: when nothing is heavy (5m, row 30, fixed 100) ordinary bars must be MUTED,
// not look like the old solid red/green that members read as "heavy on every bar" (GK 15 Nov). FIXTURE data only.
//   node tools/tests/chart-dev-server.mjs 8147
//   CHART_BASE=http://127.0.0.1:8147 flock /tmp/stryker-chrome.lock node tools/tests/fp-ladder-heavy-browser.js <shotsDir> [tag]
const fs = require('fs'), os = require('os'), path = require('path');
const OUT = process.argv[2] || '/tmp', TAG = process.argv[3] || 'after';
// reuse the fixture/launch helpers of fp-tf-heavy-browser.js: load it as text, cut the run block, eval the helpers
const src = fs.readFileSync(path.join(__dirname, 'fp-tf-heavy-browser.js'), 'utf8').split('// Highlight heavy activity on a higher timeframe')[0];
const tmp = path.join(__dirname, '.fp-ladder-helpers.js');
fs.writeFileSync(tmp, src.replace("process.argv[2] || '/tmp'", JSON.stringify(OUT)) + '\nmodule.exports = { b: null, open, setSym, setCfg, tf, zoomTo, orderflowBody, launch, sleep, check, getFail: () => fail };');
const H = require(tmp); fs.unlinkSync(tmp);
// counts the ordinary ladder fill (buy/sell colour at 0.78 alpha)
const solid = (p) => p.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width || !c.height) continue; let d; try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; if (a < 185 || a > 215) continue; if ((r < 20 && g > 190 && b > 120 && b < 150) || (r > 230 && g > 40 && g < 70 && b > 55 && b < 85)) n++; } } return n; });
(async () => {
  const b = await H.launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, vp, theme] of [[1440, 900, false, '1440', 'dark'], [1440, 900, false, '1440', 'light'], [390, 844, true, '390', 'dark']]) {
      const t = vp + '-' + theme;
      const { ctx, p, errors } = await H.open(b, { w, h, mobile, free: false, theme });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: H.orderflowBody() }));
      await H.setSym(p, 'futures:NQ1!');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await H.sleep(2500);
      await H.setCfg(p, { fpSrc: 'l1', fpStyle: 'ladder', fpLadShow: 'delta', fpRows: 30, fpHeavy: 'off', fpHeavyFixed: 100 }); await H.sleep(2500);
      await H.tf(p, '5'); await H.sleep(3500); await H.zoomTo(p, w < 520 ? 4 : 8); await H.sleep(1500); await H.zoomTo(p, w < 520 ? 4 : 8); await H.sleep(2500);
      const off = await solid(p); await p.screenshot({ path: OUT + '/ladheavy-' + TAG + '-' + t + '-off.png' });
      await H.setCfg(p, { fpHeavy: 'fixed' }); await H.sleep(1200);
      const on = await solid(p); await p.screenshot({ path: OUT + '/ladheavy-' + TAG + '-' + t + '-on.png' });
      console.log('INFO ' + TAG + ' ' + t + ' solid ladder pixels: heavy off ' + off + ' / heavy on, nothing heavy ' + on);
      H.check(off > 2000, t + ': baseline (heavy off) has solid bars', off);
      H.check(on < off * 0.1, t + ': heavy on + nothing heavy -> ordinary bars muted', [on, off]);
      H.check(errors.length === 0, t + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(H.getFail() ? 'FAILED' : 'ALL PASS'); process.exit(H.getFail() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
