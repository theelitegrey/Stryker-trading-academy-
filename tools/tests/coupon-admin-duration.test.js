'use strict';

// Coupon admin duration UI/round-trip test. Firebase is fully stubbed; no live writes.
// OUT=<shots dir> node tools/tests/coupon-admin-duration.test.js
const fs = require('fs');
const path = require('path');
const R = require('./bt-rig.js');
const { ADMIN_INIT } = require('./form-probe.js');
const OUT = process.env.OUT || path.join(process.env.TMPDIR || '/tmp', 'coupon-duration-shots');
fs.mkdirSync(OUT, { recursive: true });

const DATA = () => {
  const PLANS = {
    starter: { name: 'Starter', rank: 0, price: '0', period: 'forever' },
    pro: { name: 'Pro', rank: 1, price: '49', period: 'month', yearlyPlanId: 'proYearly' },
    proYearly: { name: 'Pro Yearly', rank: 1, price: '349', period: 'year', hidden: true }
  };
  const COUPONS = {
    WELCOME: { type: 'free', value: 0, appliesToPlan: 'pro', active: true, marksFounding: true,
      redemptionCount: 1, maxRedemptions: 50, expiresAt: null, createdAtMillis: 1 }
  };
  const snap = (src) => {
    const docs = Object.keys(src).map((id) => ({ id, exists: true, data: () => Object.assign({}, src[id]) }));
    return { size: docs.length, empty: !docs.length, docs, forEach: (fn) => docs.forEach(fn) };
  };
  const wrap = () => {
    const db = window.__stubDb;
    if (!db || db.__couponDuration) return;
    db.__couponDuration = true;
    window.__couponDurationWrites = [];
    const originalCollection = db.collection;
    db.collection = (name) => {
      const c = originalCollection(name);
      const src = name === 'plans' ? PLANS : name === 'coupons' ? COUPONS : null;
      if (!src) return c;
      c.get = () => Promise.resolve(snap(src));
      const originalDoc = c.doc;
      c.doc = (id) => {
        const d = originalDoc(id);
        d.get = () => Promise.resolve({ id, exists: Object.prototype.hasOwnProperty.call(src, id), data: () => Object.assign({}, src[id]) });
        d.set = (value, options) => {
          src[id] = options && options.merge ? Object.assign({}, src[id] || {}, value) : Object.assign({}, value);
          window.__couponDurationWrites.push({ collection: name, id, value: Object.assign({}, value) });
          return Promise.resolve();
        };
        d.delete = () => { delete src[id]; return Promise.resolve(); };
        return d;
      };
      return c;
    };
  };
  wrap();
  document.addEventListener('DOMContentLoaded', wrap);
};

(async () => {
  const srv = await R.serve();
  const browser = await R.launch();
  const failures = [];
  const ok = (condition, message) => {
    console.log((condition ? 'PASS ' : 'FAIL ') + message);
    if (!condition) failures.push(message);
  };
  const combos = [
    ['phone', 'dark'], ['phone', 'light'],
    ['phone412', 'dark'], ['phone412', 'light'],
    ['desktop', 'dark'], ['desktop', 'light']
  ];

  for (const [device, theme] of combos) {
    const themeInit = theme === 'light'
      ? () => localStorage.setItem('stryker_theme', 'day')
      : () => localStorage.setItem('stryker_theme', 'night');
    const { ctx, p, errors } = await R.page(browser, srv, device, themeInit);
    await ctx.addInitScript(ADMIN_INIT);
    await ctx.addInitScript(DATA);
    await p.goto(srv.base + '/coupons-admin.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#coupon-list .record-card');

    await p.click('#add-coupon-btn');
    await p.fill('#coupon-code', 'DURATION6');
    await p.selectOption('#coupon-plan', 'pro');
    ok(await p.$eval('#coupon-access-months-field', (e) => !e.hidden), device + ' ' + theme + ' free duration visible');
    ok(await p.$eval('#coupon-access-months', (e) => e.min === '1' && e.max === '60' && e.step === '1'), device + ' ' + theme + ' integer bounds');
    await p.fill('#coupon-access-months', '61');
    await p.click('#save-coupon-btn');
    ok(await p.$eval('#coupon-error', (e) => getComputedStyle(e).display !== 'none' && /whole number from 1 to 60/.test(e.textContent)),
      device + ' ' + theme + ' rejects out-of-range duration before write');
    ok(await p.evaluate(() => window.__couponDurationWrites.filter((w) => w.id === 'DURATION6').length === 0),
      device + ' ' + theme + ' invalid duration does not write coupon');
    await p.fill('#coupon-access-months', '6');
    await p.click('#save-coupon-btn');
    await p.waitForSelector('[data-edit-coupon="DURATION6"]');
    ok(await p.$eval('[data-edit-coupon="DURATION6"]', (e) => /6 months/.test(e.closest('.record-card').textContent)), device + ' ' + theme + ' list shows 6 months');

    await p.click('[data-edit-coupon="DURATION6"]');
    ok(await p.$eval('#coupon-access-months', (e) => e.value === '6'), device + ' ' + theme + ' edit restores 6');
    await p.fill('#coupon-access-months', '12');
    await p.click('#save-coupon-btn');
    await p.waitForSelector('[data-edit-coupon="DURATION6"]');
    ok(await p.$eval('[data-edit-coupon="DURATION6"]', (e) => /12 months/.test(e.closest('.record-card').textContent)), device + ' ' + theme + ' list shows 12 months');

    await p.click('[data-edit-coupon="DURATION6"]');
    const tag = device + '-' + theme;
    await p.screenshot({ path: path.join(OUT, 'coupon-duration-' + tag + '.png'), fullPage: true });
    await p.check('#coupon-founding');
    ok(await p.$eval('#coupon-access-months', (e) => e.disabled && e.value === '12'), device + ' ' + theme + ' founding disables but preserves duration');
    ok(await p.$eval('#coupon-access-help', (e) => /permanent/i.test(e.textContent) && /ignored/i.test(e.textContent)), device + ' ' + theme + ' founding explains permanent/ignored');
    await p.screenshot({ path: path.join(OUT, 'coupon-founding-' + tag + '.png'), fullPage: true });

    const layout = await p.evaluate(() => {
      const input = document.getElementById('coupon-access-months').getBoundingClientRect();
      const check = document.querySelector('.coupon-check-field > label').getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll('.coupon-actions .btn')).filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.getBoundingClientRect().height);
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth, inputHeight: input.height, checkHeight: check.height, buttons };
    });
    ok(layout.scrollWidth <= layout.innerWidth + 1, device + ' ' + theme + ' no horizontal overflow');
    ok(layout.inputHeight >= 48 && layout.checkHeight >= 44 && layout.buttons.every((h) => h >= 44), device + ' ' + theme + ' touch targets');
    await p.click('#save-coupon-btn');
    await p.waitForSelector('[data-edit-coupon="DURATION6"]');
    const lastWrite = await p.evaluate(() => window.__couponDurationWrites.filter((w) => w.id === 'DURATION6').slice(-1)[0]);
    ok(lastWrite && lastWrite.value.marksFounding === true && lastWrite.value.accessMonths === 12,
      device + ' ' + theme + ' founding save preserves 12-month audit value');
    ok(await p.$eval('[data-edit-coupon="DURATION6"]', (e) => /12 months \(ignored\)/.test(e.closest('.record-card').textContent)),
      device + ' ' + theme + ' founding row marks duration ignored');
    ok(errors.length === 0, device + ' ' + theme + ' no console/page errors: ' + errors.slice(0, 2).join(' / '));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failures.length ? 'FAILED ' + failures.length : 'ALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
