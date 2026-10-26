// Phone (390) shots of the new UI (?ui=2): backtests list, session top, trade ticket, results.
//   flock /tmp/stryker-chrome.lock node tools/tests/bt-shots2.js <outDir>
const path = require('path');
const R = require('./bt-rig.js');
const OUT = process.argv[2] || '/tmp';
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  try {
    const { p, errors, ctx } = await R.page(b, srv, 'phone');
    await R.startSession(p, srv.base, 'ui=2');
    // a couple of trades so the results are not empty
    const shut = () => p.evaluate(() => { const m = document.getElementById('rp-modal'); if (m) m.hidden = true; window.__btUi.closeAll(); });
    for (const side of ['buy', 'sell', 'buy']) { await shut(); await p.click('#rp-strip-' + side); await p.waitForTimeout(200); await shut(); await p.click('#rp-step10'); await p.waitForTimeout(200); }
    await shut(); await p.evaluate(() => window.__btUi.reveal('#rp-closeall')); await p.click('#rp-closeall').catch(() => {}); await p.waitForTimeout(300);
    await shut(); await p.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const n = document.getElementById('rp-nudge'); if (n) n.hidden = true; window.scrollTo(0, 0); });
    await p.waitForTimeout(300);
    await R.shot(p, path.join(OUT, 'ui2-phone-session-top.png'));
    await p.evaluate(() => window.__btUi.reveal('#rp-submit')); await p.waitForTimeout(500);
    await R.shot(p, path.join(OUT, 'ui2-phone-ticket.png'));
    await p.evaluate(() => window.__btUi.reveal('.rp-tabs [data-tab="stats"]')); await p.waitForTimeout(400);
    await p.click('.rp-tabs [data-tab="stats"]'); await p.waitForTimeout(500);
    await R.shot(p, path.join(OUT, 'ui2-phone-results.png'));
    await p.evaluate(() => window.__btUi.reveal('#rp-tz-live')); await p.waitForTimeout(400);
    await R.shot(p, path.join(OUT, 'ui2-phone-settings.png'));
    await p.evaluate(() => window.__btUi.closeAll()); await p.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    await p.goto(srv.base + '/backtests.html?ui=2', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    await R.shot(p, path.join(OUT, 'ui2-phone-backtests.png'));
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    console.log('backtests sw', sw, 'errors', JSON.stringify(errors.slice(0, 3)));
    await ctx.close();
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
