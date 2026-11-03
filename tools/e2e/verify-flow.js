// Real signup -> verify-email flow on the live site (run from GitHub Actions).
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.BASE || 'https://tradezoro.com';
const OUT = 'out'; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (u, o = {}) => { const r = await fetch('https://api.mail.tm' + u, o); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
(async () => {
  const doms = await J('/domains'); const dom = doms['hydra:member'][0].domain;
  const addr = `tz${Date.now().toString(36)}@${dom}`, mpw = 'Vf!' + Math.random().toString(36).slice(2) + 'Aa1';
  await J('/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: addr, password: mpw }) });
  const tok = (await J('/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: addr, password: mpw }) })).token;
  console.log('::add-mask::' + tok);
  log('mail inbox', addr);
  const browser = await chromium.launch();
  const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log('shot', n, p.url().replace(/oobCode=[^&]+/, 'oobCode=X')); };
  const state = async p => p.evaluate(() => ({
    url: location.pathname, gate: !!document.getElementById('email-verify-overlay'),
    gateText: (document.getElementById('email-verify-overlay') || {}).innerText || '',
    verified: (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.emailVerified : null,
    obModalOpen: !!document.querySelector('#ob-modal:not([hidden])') }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('tz_test_user', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('console', m => { if (/error|warn/i.test(m.type())) log('console', m.text().slice(0, 200)); });
  let pass = 'Zq9!' + Math.random().toString(36).slice(2) + 'Xx';
  console.log('::add-mask::' + pass);
  try {
    await page.goto(BASE + '/signup', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); await page.fill('#signup-name', 'Probe Test'); await page.fill('#signup-email', addr); await page.fill('#signup-password', pass);
    await page.click('#signup-form button[type=submit]');
    await page.waitForTimeout(8000);
    await shot(page, '1-after-signup'); log('state', JSON.stringify(await state(page)));
    // wait for mail
    let msg = null;
    for (let i = 0; i < 30 && !msg; i++) { const l = await J('/messages', { headers: { authorization: 'Bearer ' + tok } }); msg = l['hydra:member'] && l['hydra:member'][0]; if (!msg) await sleep(4000); }
    if (!msg) { log('FAIL no email in 2 min'); throw new Error('no mail'); }
    const full = await J('/messages/' + msg.id, { headers: { authorization: 'Bearer ' + tok } });
    log('mail from', msg.from.address, 'subject', msg.subject);
    const body = (full.text || '') + ' ' + (full.html || []).join(' ');
    const m = body.match(/https:\/\/[^\s"'<>]*__\/auth\/action\?[^\s"'<>]*/); 
    if (!m) throw new Error('no link');
    const link = m[0].replace(/&amp;/g, '&');
    const oob = (link.match(/oobCode=([^&]+)/) || [])[1]; if (oob) console.log('::add-mask::' + oob);
    log('link host/path', link.split('?')[0], 'continueUrl', decodeURIComponent((link.match(/continueUrl=([^&]+)/) || [])[1] || ''));
    // Test A: open link in a SECOND page of same context (same device, other tab) while first tab stays on gate
    const p2 = await ctx.newPage();
    await p2.goto(link, { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(2500);
    await shot(p2, '2-action-page'); log('action page text:', (await p2.innerText('body')).replace(/\s+/g, ' ').slice(0, 200));
    const complete = p2.locator('button, a').filter({ hasText: /complete verification/i }).first();
    log('complete-verification button', await complete.count());
    log('tab1 state before link applied', JSON.stringify(await state(page)));
    if (await complete.count()) { await complete.click(); await p2.waitForTimeout(4000); }
    await shot(p2, '2b-after-complete'); log('action page text after:', (await p2.innerText('body')).replace(/\s+/g, ' ').slice(0, 200));
    const cont = p2.locator('button, a').filter({ hasText: /continue/i }).first();
    log('continue present', await cont.count());
    if (await cont.count()) { await cont.click(); await p2.waitForTimeout(9000); }
    await shot(p2, '3-after-continue'); log('tab2 state', JSON.stringify(await state(p2)));
    // tab1 "I've confirmed it"
    if (await page.locator('#ev-check').count()) { await page.click('#ev-check'); await page.waitForTimeout(7000); }
    await shot(page, '3b-tab1-before').catch(()=>{}); await shot(page, '4-tab1-after-check'); log('tab1 state', JSON.stringify(await state(page)));
    // fresh login on mobile after verification
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    await mp.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(3000); await mp.fill('#login-email', addr); await mp.fill('#login-password', pass);
    await mp.click('#login-form button[type=submit]'); await mp.waitForTimeout(8000);
    await shot(mp, '5-mobile-login'); log('mobile state', JSON.stringify(await state(mp)));
  } catch (e) { log('ERROR', e.message); await shot(page, 'error').catch(() => {}); }
  finally {
  // cleanup: delete the Firebase account (always)
  try {
    const r = await page.evaluate(async (pw) => { if (!auth.currentUser) return 'no user'; try { try { await db.collection('students').doc(auth.currentUser.uid).delete(); } catch (e) {} await auth.currentUser.delete(); return 'deleted'; } catch (e) { return e.code; } }, pass);
    log('cleanup', r);
  } catch (e) { log('cleanup err', e.message); }
  await browser.close();
  }
})();
