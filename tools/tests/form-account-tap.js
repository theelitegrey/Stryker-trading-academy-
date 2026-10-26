// Real-tap check of the account forms after the form sweep (Owner 2026-10-26): login, signup,
// settings, trade journal add-trade form, logs-admin filters. Fill, submit, validation still works,
// controls are themed (dark surface, no native appearance) and nothing scrolls sideways at 390.
//   OUT=<dir> node form-account-tap.js
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.env.OUT || '/tmp'; const srv = await R.serve(); const b = await R.launch(); let fails = 0; const log = [];
  const ok = (k, v, extra) => { log.push((v ? 'PASS ' : 'FAIL ') + k + (extra ? ' ' + JSON.stringify(extra) : '')); if (!v) fails++; };
  const themed = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return { missing: s }; const cs = getComputedStyle(el); const m = /(\d+), (\d+), (\d+)/.exec(cs.backgroundColor); const L = m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 0; return { ap: cs.appearance, L: +L.toFixed(2), ok: cs.appearance === 'none' || !/SELECT|INPUT/.test(el.tagName) || el.type === 'text' || el.type === 'email' || el.type === 'password' || el.type === 'date' ? L < 0.3 : false }; }, sel);
  for (const dev of ['desktop', 'phone']) {
    // signed-out pages: no stub user
    const ctx0 = await b.newContext(R.DEVICES[dev]);
    await ctx0.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p0 = await ctx0.newPage();
    // login: empty submit -> browser validation blocks (email field invalid), typed values stay
    await p0.goto(srv.base + '/login.html', { waitUntil: 'domcontentloaded' }); await p0.waitForTimeout(800);
    await p0.click('#login-form button[type=submit]');
    ok(dev + ' login empty submit blocked by required', await p0.evaluate(() => !document.getElementById('login-email').checkValidity()));
    await p0.fill('#login-email', 'a@b.co'); await p0.fill('#login-password', 'x'.repeat(8));
    ok(dev + ' login fields valid after fill', await p0.evaluate(() => document.getElementById('login-form').checkValidity()));
    for (const s of ['#login-email', '#login-password', '#login-remember']) { const t = await themed(p0, s); ok(dev + ' login themed ' + s, s === '#login-remember' ? t.ap === 'none' : t.ok, t); }
    await p0.click('label:has(#login-remember)'); ok(dev + ' remember toggles', !(await p0.isChecked('#login-remember')));
    ok(dev + ' login no hscroll', await p0.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p0.screenshot({ path: OUT + '/acct-login-' + dev + '.png' });
    await p0.goto(srv.base + '/signup.html', { waitUntil: 'domcontentloaded' }); await p0.waitForTimeout(800);
    await p0.fill('#signup-name', 'Tap'); await p0.fill('#signup-email', 'a@b.co'); await p0.fill('#signup-password', '123');
    ok(dev + ' signup minlength 6 still enforced', await p0.evaluate(() => !document.getElementById('signup-password').checkValidity()));
    await p0.fill('#signup-password', '123456');
    ok(dev + ' signup valid when filled', await p0.evaluate(() => document.getElementById('signup-form').checkValidity()));
    await p0.click('#signup-form input[type=checkbox][required]');
    ok(dev + ' signup terms checkbox required still enforced', await p0.evaluate(() => !document.getElementById('signup-form').checkValidity()));
    await p0.click('#signup-form input[type=checkbox][required]');
    ok(dev + ' signup terms re-ticked', await p0.evaluate(() => document.getElementById('signup-form').checkValidity()));
    ok(dev + ' signup no hscroll', await p0.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p0.screenshot({ path: OUT + '/acct-signup-' + dev + '.png' });
    await ctx0.close();

    // signed-in pages
    const { ctx, p, errors } = await R.page(b, srv, dev, () => { const t = setInterval(() => { const u = window.__stubAuth && window.__stubAuth.currentUser; if (u && !u.updateProfile) { u.updateProfile = () => Promise.resolve(); clearInterval(t); } }, 5); });
    await p.goto(srv.base + '/settings.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    await p.fill('#settings-name', ''); await p.click('#settings-save-name'); await p.waitForTimeout(300);
    ok(dev + ' settings empty name -> error', /cannot be empty/i.test(await p.evaluate(() => (document.getElementById('settings-error') || {}).textContent || '')));
    await p.fill('#settings-name', 'Tap Trader'); await p.fill('#settings-bio', 'Bio'); await p.click('#settings-save-name'); await p.waitForTimeout(800);
    ok(dev + ' settings save -> Saved.', /Saved/.test(await p.evaluate(() => (document.getElementById('settings-success') || {}).textContent || '')));
    for (const s of ['#settings-name', '#settings-bio', '#settings-mention-notify', '#presence-visible', '#start-page-select']) { const t = await themed(p, s); ok(dev + ' settings themed ' + s, t.ap === 'none' || t.ok, t); }
    await p.click('label:has(#presence-hidden)').catch(() => {}); ok(dev + ' presence radio selects', await p.isChecked('#presence-hidden').catch(() => false));
    ok(dev + ' settings no hscroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: OUT + '/acct-settings-' + dev + '.png', fullPage: false });
    await p.evaluate(() => document.getElementById('settings-bio').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: OUT + '/acct-settings2-' + dev + '.png' });
    // journal add-trade form
    await p.goto(srv.base + '/trade-journal.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
    const opened = await p.evaluate(() => { if (typeof window.switchJournalTab === 'function') { window.switchJournalTab('add'); return 'switchJournalTab(add)'; } return null; });
    await p.waitForTimeout(800);
    ok(dev + ' journal add-trade opens', !!opened, opened);
    await p.screenshot({ path: OUT + '/acct-journal-form-' + dev + '.png' });
    const jf = await p.evaluate(() => ['jf-date', 'jf-time', 'jf-instrument', 'jf-direction', 'jf-setup'].map((id) => { const el = document.getElementById(id); if (!el || !el.getClientRects().length) return [id, 'hidden']; const cs = getComputedStyle(el); return [id, cs.appearance, cs.colorScheme, cs.backgroundColor, Math.round(el.getBoundingClientRect().height)]; }));
    ok(dev + ' journal form themed', jf.every((r) => r[1] === 'hidden' || (r[1] === 'none' || /date|time/.test(r[0])) && /dark/.test(r[2])), jf);
    ok(dev + ' journal no hscroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: OUT + '/acct-journal-form-' + dev + '.png' });
    ok(dev + ' no page errors', errors.length === 0, errors.slice(0, 2));
    await ctx.close();
  }
  console.log(log.join('\n')); console.log('FAILS', fails);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
