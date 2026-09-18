'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../lib/money');
const { score } = require('../lib/audit');

test('monthly cost normalises cycles and ignores cancelled', () => {
  assert.equal(money.monthlyCost({ amount: 120, cycle: 'yearly', status: 'active' }), 10);
  assert.equal(money.monthlyCost({ amount: 30, cycle: 'quarterly', status: 'active' }), 10);
  assert.equal(money.monthlyCost({ amount: 5, cycle: 'monthly', status: 'cancelled' }), 0);
  assert.equal(money.monthlyCost({ amount: 99, cycle: 'one-time', status: 'active' }), 0);
});

test('nextRenewal rolls the anchor forward past now', () => {
  const now = new Date('2026-09-18T00:00:00Z');
  const next = money.nextRenewal({ cycle: 'monthly', nextRenewal: '2026-01-05', status: 'active' }, now);
  assert.equal(next.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(money.nextRenewal({ cycle: 'monthly', nextRenewal: '2026-01-05', status: 'active', endDate: '2026-09-30' }, now), null);
  assert.equal(money.nextRenewal({ cycle: 'monthly', nextRenewal: '2026-01-05', status: 'cancelled' }, now), null);
});

test('chargesBetween lists every charge in the window', () => {
  const from = new Date('2026-01-01T00:00:00Z'), to = new Date('2026-04-01T00:00:00Z');
  const c = money.chargesBetween({ cycle: 'monthly', amount: 10, nextRenewal: '2026-06-15', startDate: '2025-01-15', status: 'active' }, from, to);
  assert.deepEqual(c.map(x => x.date.toISOString().slice(0, 10)), ['2026-01-15', '2026-02-15', '2026-03-15']);
  const once = money.chargesBetween({ cycle: 'one-time', amount: 60, startDate: '2026-02-02' }, from, to);
  assert.equal(once.length, 1); assert.equal(once[0].amount, 60);
});

test('audit score penalises outages and rewards clean sites', () => {
  const clean = score({ http: { ok: true, status: 200, ms: 300, finalUrl: 'https://x' }, ssl: { ok: true, daysLeft: 80 }, dns: { resolves: true }, domain: { daysLeft: 300 },
    headers: { hsts: true, csp: true, xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, permissionsPolicy: true },
    seo: { title: 'Hi', titleLength: 2, description: 'd', viewport: true, h1Count: 1, canonical: 'x', lang: 'en', favicon: true, sizeKB: 40 }, robotsTxt: true, sitemap: true });
  assert.equal(clean.score, 100); assert.equal(clean.issues.length, 0);
  const down = score({ http: { ok: false, status: 0, error: 'ECONNREFUSED' }, ssl: null, dns: { resolves: true } });
  assert.ok(down.score <= 50); assert.equal(down.issues[0].sev, 'critical');
});
