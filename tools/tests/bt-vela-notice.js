// old session with killzones -> tz: notice text, link, once, 6 s. node bt-vela-notice.js <dev> <label>
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'phone', label = process.argv[3] || 'fix3'; const DIR = process.env.SHOTDIR || process.env.TMPDIR;
(async () => { const srv = await R.serve(); const b = await R.launch(); const { ctx, p, errors } = await R.page(b, srv, dev);
  await R.startSession(p, srv.base, 'chart=lw&ui=2'); await p.waitForTimeout(2500);
  const sid = await p.evaluate(async () => { const RP = window.__RP; RP.chart.addIndicator('killzones', {}); for (let i = 0; i < 3; i++) document.getElementById('rp-step10').click(); await new Promise((r) => setTimeout(r, 1500)); return RP.session.id; });
  await p.waitForTimeout(2500);
  const url = srv.base + '/replay.html?session=' + encodeURIComponent(sid) + '&chart=tz&ui=2';
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rp-work:not([hidden])', { timeout: 40000 });
  let n = null; for (let i = 0; i < 20 && !n; i++) { await p.waitForTimeout(400); n = await p.evaluate(() => { const e = document.getElementById('bt-oldnote'); if (!e) return null; const r = e.getBoundingClientRect(); const lg = document.querySelector('.vela-sl-symbol'); return { txt: e.innerText.replace(/\s+/g, ' '), href: e.querySelector('a').getAttribute('href'), y: Math.round(r.y), h: Math.round(r.height), legendBottom: lg ? Math.round(lg.getBoundingClientRect().bottom) : null, hasParam: /chart=|\?/.test(e.querySelector('span').textContent) }; }); }
  console.log('notice', JSON.stringify(n)); await R.shot(p, DIR + '/' + label + '-notice-' + dev + '.png');
  await p.waitForTimeout(6500); console.log('auto-hidden', await p.evaluate(() => !document.getElementById('bt-oldnote')));
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rp-work:not([hidden])', { timeout: 40000 }).catch(() => {}); await p.waitForTimeout(4500);
  console.log('shown again after reload', await p.evaluate(() => !!document.getElementById('bt-oldnote')));
  console.log('errors', JSON.stringify(errors.slice(0, 3))); await b.close(); srv.close(); })();
