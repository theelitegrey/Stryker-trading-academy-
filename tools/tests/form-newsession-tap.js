// Real-tap check of the New session dialog after the .tz-* form move: type into every field,
// open Coach settings, check thousands formatting, Escape/Cancel close, start a session and read back
// the balance, commission and slippage the engine got.  OUT=<dir> node form-newsession-tap.js
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.env.OUT || '/tmp'; const srv = await R.serve(); const b = await R.launch(); const out = {}; let fails = 0;
  const ok = (k, v) => { out[k] = v; if (!v) fails++; };
  for (const dev of ['desktop', 'phone']) for (const ui of ['', 'ui=2']) {
    const tag = dev + (ui ? '-ui2' : '-classic');
    const { ctx, p, errors } = await R.page(b, srv, dev);
    await p.goto(srv.base + '/replay.html?new=1' + (ui ? '&' + ui : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#rp-start-btn', { state: 'visible', timeout: 20000 }); await p.waitForTimeout(500);
    ok(tag + ' balance shows 100,000', (await p.inputValue('#rp-balance')) === '100,000');
    await p.fill('#rp-balance', ''); await p.click('#rp-balance'); await p.keyboard.type('250000');
    ok(tag + ' typing regroups 250,000', (await p.inputValue('#rp-balance')) === '250,000');
    await p.fill('#rp-balance', '50'); await p.click('#rp-name');
    ok(tag + ' min 100 clamps on blur', (await p.inputValue('#rp-balance')) === '100');
    await p.fill('#rp-balance', '250000'); await p.click('#rp-name'); await p.keyboard.type('Tap test');
    ok(tag + ' commission help grammar', /^per contract, per side$/.test(await p.textContent('#rp-commission-unit')));
    await p.click('.tz-disclosure > summary'); await p.waitForTimeout(200);
    ok(tag + ' coach settings opens', await p.evaluate(() => document.querySelector('.rp-adv').open));
    await p.click('label:has(#rp-opt-checklist)');
    ok(tag + ' switch toggles', await p.isChecked('#rp-opt-checklist'));
    await p.click('label:has(#rp-opt-checklist)');
    // phone: focus the slippage field and check it is in the visible part of the sheet, above the sticky footer
    await p.click('#rp-slippage'); await p.waitForTimeout(400);
    const vis = await p.evaluate(() => { const s = document.querySelector('#rp-setup-modal .tz-sheet').getBoundingClientRect(); const f = document.querySelector('.tz-actions').getBoundingClientRect(); const e = document.getElementById('rp-slippage').getBoundingClientRect(); const foot = getComputedStyle(document.querySelector('.tz-actions')).position === 'sticky' ? f.top : s.bottom; return { ok: e.top >= s.top && e.bottom <= foot + 1, sw: document.documentElement.scrollWidth, vw: innerWidth, sheetSw: document.querySelector('#rp-setup-modal .tz-sheet').scrollWidth, sheetCw: document.querySelector('#rp-setup-modal .tz-sheet').clientWidth }; });
    ok(tag + ' focused field visible', vis.ok); ok(tag + ' no horizontal scroll', vis.sw <= vis.vw && vis.sheetSw <= vis.sheetCw);
    await p.keyboard.press('Control+A'); await p.keyboard.type('2');
    await p.fill('#rp-commission', '1.5');
    await p.screenshot({ path: OUT + '/newsession-after-' + tag + '-filled.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(tag + ' Escape closes', await p.evaluate(() => document.getElementById('rp-setup-modal').hidden));
    await p.evaluate(() => { document.getElementById('rp-setup-modal').hidden = false; });
    await p.click('#rp-setup-cancel');
    ok(tag + ' Cancel closes', await p.evaluate(() => document.getElementById('rp-setup-modal').hidden));
    await p.evaluate(() => { document.getElementById('rp-setup-modal').hidden = false; });
    await p.evaluate(() => { const d = new Date(Date.now() - 10 * 86400000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1); document.getElementById('rp-start').value = d.toISOString().slice(0, 10); document.getElementById('rp-days').value = '7'; });
    // the symbol change handler resets commission to the market default, so set it after
    await p.fill('#rp-commission', '1.5');
    await p.click('#rp-start-btn');
    await p.waitForSelector('#rp-work:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(600);
    const s = await p.evaluate(() => { const r = window.__RP || {}; const sess = r.session || {}; return { bal: sess.balance, name: sess.name, com: sess.settings && sess.settings.commission, slip: sess.settings && sess.settings.slippage }; });
    out[tag + ' session'] = s;
    ok(tag + ' session got 250000/1.5/2/name', s.bal === 250000 && s.com === 1.5 && s.slip === 2 && s.name === 'Tap test');
    ok(tag + ' no console errors', errors.length === 0); if (errors.length) out[tag + ' errors'] = errors.slice(0, 3);
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1)); console.log('FAILS', fails);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
