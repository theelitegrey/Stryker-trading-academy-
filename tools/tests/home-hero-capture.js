// Captures the homepage hero's "back screens": the real /trade-journal and /replay pages with the QA fixture data
// (rich Firebase stub = demo journal; replay = the bt-rig mocked NQ walk). Dark + light, 1440x900. Raw PNGs only;
// cropping/softening + webp happens in a separate step. Offline, nothing reaches Firebase.
//   node tools/tests/home-hero-capture.js <outDir>
const path = require('path');
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.argv[2] || '/tmp';
  const srv = await R.serve(); const b = await R.launch();
  try {
    for (const theme of ['dark', 'light']) {
      const init = `try{localStorage.setItem('stryker_theme','${theme === 'dark' ? 'night' : 'day'}')}catch(e){}`;
      // journal: dashboard tab with the demo journal from the fixture
      let { p, ctx, errors } = await R.page(b, srv, 'desktop', init);
      await p.goto(srv.base + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(5000);
      // calendar tab, not the dashboard: no account-total P&L or win-rate tiles in the frame
      await p.evaluate(() => switchJournalTab('calendar')); await p.waitForTimeout(800);
      await p.click('#jc-prev-btn').catch(() => {}); await p.waitForTimeout(1200);
      await R.shot(p, path.join(OUT, 'journal-' + theme + '.png'));
      await p.evaluate(() => switchJournalTab('analytics')); await p.waitForTimeout(1500);
      await R.shot(p, path.join(OUT, 'journal-an-' + theme + '.png'));
      if (errors.length) console.log('journal errors', errors.slice(0, 3));
      await ctx.close();
      // replay: a running session
      ({ p, ctx, errors } = await R.page(b, srv, 'desktop', init));
      await R.startSession(p, srv.base, '');
      await p.click('#rp-step10').catch(() => {}); await p.click('#rp-step10').catch(() => {});
      await p.waitForTimeout(800);
      await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('[class*=toast], .rp-notice, [role=status]').forEach((e) => { if (/Killzones/.test(e.textContent)) e.remove(); }); });
      await p.waitForTimeout(300);
      await R.shot(p, path.join(OUT, 'replay-' + theme + '.png'));
      if (errors.length) console.log('replay errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
