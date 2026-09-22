// Guard against the specificity trap that has now bitten five times.
//
// `section { padding: 96px 0 }` is a marketing-page rule that catches any
// <section> an app renderer emits, so each module neutralises it with
// `section.x { padding: 0 }`. That neutraliser outranks a component's own
// `.card { padding: ... }` rule, so a card ends up with its text flush against
// its own border — and it only shows on screen, never in a unit test.
//
// So: sweep every app page, and fail any <section> that paints a background or
// a border but has no padding on a side it needs one. Nothing to remember.
const { chromium, ROOT, BASE, launch } = require('./lib.js');
const fs = require('fs');

const stub = require('./stub.js');

const fixture = (f) => {
  const c = JSON.parse(fs.readFileSync(ROOT + '/assets/' + f, 'utf8'));
  const shift = Date.now() - Date.parse('2026-09-10T09:30:00Z');
  c.generatedAt = new Date(Date.now() - 3600e3).toISOString();
  if (c.events) c.events.forEach(e => { e.at = new Date(Date.parse(e.at) + shift).toISOString(); });
  return c;
};

// Pages that render app modules. The marketing pages legitimately want the
// 96px section rhythm, so they are not swept.
const PAGES = [
  'dashboard-user.html', 'market-brief.html', 'market-map.html', 'economic-calendar.html',
  'roadmap.html', 'backtests.html', 'replay.html', 'trade-journal.html',
  'global-monitor.html', 'smart-money.html', 'achievements.html', 'referrals.html',
  'settings.html', 'profile.html', 'courses.html', 'models.html', 'indicators.html',
  'live-sessions.html', 'giveaways.html', 'trading-floor.html', 'charts.html'
];

(async () => {
  const b = await launch();
  const log = []; const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

  for (const url of PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
    await p.addInitScript(stub);
    for (const f of ['econ-calendar', 'market-brief', 'market-map']) {
      await p.route(new RegExp(f + '\\.json'), r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(f + '.json')) }));
    }
    await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
    await p.goto(BASE + '/' + url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);

    const bad = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('section').forEach(s => {
        const cs = getComputedStyle(s);
        if (cs.display === 'none' || !s.getClientRects().length) return;
        const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
          || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
        if (!painted) return;
        // A painted box needs breathing room on all four sides, unless it is
        // full-bleed (no side border and edge-to-edge), which these are not.
        const pad = ['Top', 'Right', 'Bottom', 'Left'].map(k => parseFloat(cs['padding' + k]));
        if (pad.every(v => v >= 8)) return;
        // A card whose children carry the inset instead is fine; check whether
        // any direct child actually starts inside the box.
        const box = s.getBoundingClientRect();
        const inset = Array.from(s.children).some(ch => {
          const r = ch.getBoundingClientRect();
          return r.left - box.left >= 8 && box.right - r.right >= 8;
        });
        if (inset) return;
        out.push({ cls: s.className.replace(/\s*(stk-rise|is-in)\s*/g, ' ').trim(),
                   pad: pad.join('/'), bg: cs.backgroundColor });
      });
      return out;
    });

    ok(url + ': no painted section is flush against its own border',
       bad.length === 0, bad.map(x => x.cls + ' [' + x.pad + ']').join(' | '));
    await p.close();
  }

  await b.close();
  console.log(log.join('\n'));
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  console.log('\n' + (log.length - fails) + '/' + log.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
