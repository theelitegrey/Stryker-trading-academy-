// New session dialog (replay.html) shots + real-tap check, classic and ?ui=2, 1440 and 390, dark and day.
//   ROOT_DIR=<repo copy> OUT=<dir> TAG=before|after node form-newsession-shots.js
const R = require('./bt-rig.js');
const fs = require('fs');
(async () => {
  const OUT = process.env.OUT || '/tmp'; const TAG = process.env.TAG || 'after';
  const srv = await R.serve(process.env.ROOT_DIR); const b = await R.launch(); const res = [];
  for (const dev of ['desktop', 'phone']) for (const ui of ['classic', 'ui2']) for (const theme of ['dark', 'day']) {
    const { ctx, p, errors } = await R.page(b, srv, dev, theme === 'day' ? () => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} } : null);
    await p.goto(srv.base + '/replay.html?new=1' + (ui === 'ui2' ? '&ui=2' : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#rp-start-btn', { state: 'visible', timeout: 20000 });
    await p.waitForTimeout(700);
    const m = await p.evaluate(() => {
      const ids = ['rp-symbol', 'rp-start', 'rp-days', 'rp-balance', 'rp-name', 'rp-tz', 'rp-commission', 'rp-slippage'];
      const r = ids.map((id) => { const el = document.getElementById(id); const bx = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { id, top: Math.round(bx.top), h: Math.round(bx.height), bg: cs.backgroundColor, ap: cs.appearance }; });
      const card = document.querySelector('#rp-setup-modal .rp-modal-card').getBoundingClientRect();
      return { r, card: { top: Math.round(card.top), h: Math.round(card.height), w: Math.round(card.width), bottom: Math.round(card.bottom) }, sw: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight };
    });
    const f = OUT + '/newsession-' + TAG + '-' + dev + '-' + ui + '-' + theme + '.png';
    await p.screenshot({ path: f });
    res.push({ dev, ui, theme, f, m, errors });
    await ctx.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
