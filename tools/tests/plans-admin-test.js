// Admin plans/coupons lists: only Starter + Pro listed, yearly twin under Pro, Elite archived.
// OUT=<shots dir> node plans-admin-test.js   (run under the chrome lock)
const R = require('./bt-rig.js');
const { ADMIN_INIT } = require('./form-probe.js');
const OUT = process.env.OUT || '/tmp';
const DATA = () => {
  const PLANS = {
    starter: { name: 'Starter', rank: 0, price: '0', period: 'forever', features: ['Free chapters'], chapterAccess: '1-6' },
    pro: { name: 'Pro', rank: 1, price: '49', period: 'month', features: ['All chapters'], chapterAccess: 'all', featured: true, yearlyPlanId: 'proYearly' },
    proYearly: { name: 'Pro Yearly', rank: 1, price: '349', period: 'year', hidden: true, features: [], chapterAccess: 'all' },
    elite: { name: 'Elite', rank: 2, price: '99', period: 'month', archived: true, features: ['Everything'], chapterAccess: 'all' }
  };
  const COUPONS = {
    WELCOME: { type: 'free', value: 0, appliesToPlan: 'elite', active: true, redemptionCount: 3, maxRedemptions: 50, createdAtMillis: 3 },
    YEAR20: { type: 'percent', value: 20, appliesToPlan: 'proYearly', active: true, redemptionCount: 0, createdAtMillis: 2 },
    ANY10: { type: 'percent', value: 10, appliesToPlan: 'all', active: true, redemptionCount: 0, createdAtMillis: 1 }
  };
  const snap = (o) => { const docs = Object.keys(o).map((id) => ({ id, exists: true, data: () => Object.assign({}, o[id]) })); return { size: docs.length, empty: !docs.length, docs, forEach: (f) => docs.forEach(f) }; };
  const wrap = () => {
    const db = window.__stubDb; if (!db || db.__pl) return; db.__pl = 1;
    window.__writes = [];
    const col = db.collection;
    db.collection = (p) => {
      const c = col(p); const src = p === 'plans' ? PLANS : p === 'coupons' ? COUPONS : null;
      if (!src) return c;
      c.get = () => Promise.resolve(snap(src));
      const d0 = c.doc;
      c.doc = (id) => { const d = d0(id); d.get = () => Promise.resolve({ id, exists: !!src[id], data: () => Object.assign({}, src[id]) });
        d.set = (v) => { window.__writes.push([p, id, v]); return Promise.resolve(); }; return d; };
      return c;
    };
  };
  wrap(); document.addEventListener('DOMContentLoaded', wrap);
};
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  for (const dev of ['phone', 'desktop']) {
    const { ctx, p, errors } = await R.page(b, srv, dev);
    await ctx.addInitScript(ADMIN_INIT); await ctx.addInitScript(DATA);
    // --- plans admin
    await p.goto(srv.base + '/billing-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    await p.waitForSelector('#plans-grid .price-card');
    const top = await p.$$eval('#plans-grid > .price-card', (e) => e.map((x) => x.querySelector('h3').textContent));
    ok(top.length === 2 && top[0] === 'Free' && top[1] === 'Pro', dev + ' plans top-level cards: ' + top.join(' | '));
    ok(await p.$eval('.plan-twin', (e) => /Yearly price/.test(e.textContent) && /349/.test(e.textContent)), dev + ' yearly price inside Pro card');
    ok(await p.$$eval('details, .plans-archived', (e) => e.length === 0) && !(await p.content()).match(/Archived plans|Elite/), dev + ' no Archived section, no Elite on plans page');
    await p.screenshot({ path: OUT + '/plans-' + dev + '.png', fullPage: true });
    await p.click('.edit-twin-btn'); await p.waitForTimeout(300);
    ok(await p.$eval('#plan-price', (e) => e.value === '349'), dev + ' Edit yearly opens twin editor (price 349)');
    await p.screenshot({ path: OUT + '/plans-' + dev + '-edit-yearly.png' });
    await p.click('#cancel-plan-btn');
    // --- coupons admin
    await p.goto(srv.base + '/coupons-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    await p.waitForSelector('#coupon-list .record-card');
    const opts = await p.$$eval('#coupon-plan option', (o) => o.map((x) => x.textContent));
    console.log('   options:', JSON.stringify(opts));
    ok(!opts.some((t) => /elite|retired|legacy|Pro Yearly|Starter/i.test(t)) && opts.length === 4 && opts[1] === 'Free' && opts[2] === 'Pro (monthly)', dev + ' new-coupon list has no Elite/proYearly rows: ' + opts.join(' | '));
    const rows = await p.$$eval('#coupon-list .record-card', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
    ok(rows.some((t) => /WELCOME/.test(t) && /Pro \(legacy\)/.test(t) && !/Elite/.test(t)), dev + ' WELCOME row shows Pro (legacy)');
    ok(rows.some((t) => /YEAR20/.test(t) && /Pro \(yearly\)/.test(t)), dev + ' YEAR20 row shows Pro (yearly)');
    await p.screenshot({ path: OUT + '/coupons-' + dev + '-list.png', fullPage: true });
    await p.click('[data-edit-coupon="WELCOME"]'); await p.waitForTimeout(400);
    ok(await p.$eval('#coupon-plan', (s) => s.value === 'elite' && /Pro \(legacy\)/.test(s.selectedOptions[0].textContent)), dev + ' edit WELCOME keeps elite selected');
    await p.screenshot({ path: OUT + '/coupons-' + dev + '-edit-elite.png' });
    await p.click('#save-coupon-btn'); await p.waitForTimeout(400);
    const w = await p.evaluate(() => window.__writes);
    ok(w.length === 1 && w[0][2].appliesToPlan === 'elite', dev + ' save keeps appliesToPlan=elite');
    await p.click('[data-edit-coupon="YEAR20"]'); await p.waitForTimeout(300);
    ok(await p.$eval('#coupon-plan', (s) => s.value === 'proYearly'), dev + ' edit YEAR20 keeps proYearly');
    await p.click('#cancel-coupon-btn');
    await p.click('#add-coupon-btn'); await p.waitForTimeout(300);
    await p.screenshot({ path: OUT + '/coupons-' + dev + '-new.png' });
    // --- students admin: Free / Pro filters
    await p.goto(srv.base + '/students-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    const btns = await p.$$eval('#users-role-filter .users-role-btn', (b) => b.map((x) => x.textContent));
    ok(btns.includes('Free') && btns.includes('Pro') && !btns.some((t) => /elite|starter/i.test(t)), dev + ' students filters: ' + btns.join(','));
    await p.click('[data-role="plan-pro"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: OUT + '/students-' + dev + '-pro-filter.png' });
    ok(errors.length === 0, dev + ' no console errors ' + errors.slice(0, 2).join(' / '));
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails.length ? 'FAILED ' + fails.length : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
