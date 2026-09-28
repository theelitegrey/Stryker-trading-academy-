// Regression test for the Visits-card stale-response race (SEV-4, build 343).
//
// Bug: aaLoadVisits('30d') issues 30 traffic reads, aaLoadVisits('today') one.
// Clicking 30d then Today quickly let the slower 30d batch resolve LAST and
// overwrite the Today answer, so the chip said Today while the card said
// "587 · last 30 days".
//
// The stub's traffic get() honours window.__trafficCtl(id) -> { data, delayMs,
// fail }; this file installs one whose latency depends on window.__phase, so a
// click can be made deliberately slow and the next click fast.
//
// Usage (needs a static server for the checkout under test):
//   RACE_BASE=http://localhost:8000 node race.js
// Exit code 0 = all pass. It is expected to FAIL against main 138a1133 (no
// sequence guard) and PASS on hermes/dev-visits-race.
const fs = require('fs');
const path = require('path');
const { launch } = require('../lib.js');
const stubMod = require('./stub.js');

const BASE = process.env.RACE_BASE || 'http://localhost:8000';
const OUT = process.env.RACE_OUT || '';

// Per-day visits in the fixture: today 10, each of the other 29 days 10.
// So Today totals 10 and 30d totals 300 — never confusable.
const CTL = function () {
  window.__phase = 'fast';
  window.__trafficCtl = function () {
    var p = window.__phase;
    if (p === 'slow') return { data: { visits: 10 }, delayMs: 900 };
    if (p === 'slow-fail') return { fail: true, delayMs: 900 };
    if (p === 'fast-fail') return { fail: true, delayMs: 30 };
    return { data: { visits: 10 }, delayMs: 30 };
  };
};

async function card(p) {
  return p.evaluate(() => {
    const w = document.getElementById('aa-visits-body');
    if (!w) return { value: null, sub: null };
    const v = w.querySelector('.v');
    const sub = w.querySelector('.sub');
    return { value: v ? v.textContent.trim() : null, sub: sub ? sub.textContent.trim() : null };
  });
}

async function clickRange(p, range) {
  await p.click('#aa-range-seg [data-range="' + range + '"]');
}

async function setPhase(p, phase) {
  await p.evaluate((x) => { window.__phase = x; }, phase);
}

async function scenario(browser, name, steps, expect) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript(stubMod.build('loaded'));
  await ctx.addInitScript('(' + CTL.toString() + ')();');
  const p = await ctx.newPage();
  const consoleErrors = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await p.goto(BASE + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(2500); // initial load + first aaLoadVisits('today') settle

  for (const s of steps) {
    await setPhase(p, s.phase);
    await clickRange(p, s.range);
    await p.waitForTimeout(s.thenWaitMs);
  }
  // Let every in-flight request, including the slow stale one, settle.
  await p.waitForTimeout(1600);

  const got = await card(p);
  const chip = await p.evaluate(() => {
    const a = document.querySelector('#aa-range-seg .active');
    return a ? a.getAttribute('data-range') : null;
  });
  await ctx.close();

  const valueOk = got.value === expect.value;
  const subOk = expect.subIncludes ? String(got.sub || '').includes(expect.subIncludes) : true;
  const chipOk = chip === expect.chip;
  return {
    name,
    pass: valueOk && subOk && chipOk,
    detail: { chip: chip, expectedChip: expect.chip, value: got.value, expectedValue: expect.value, sub: got.sub, subMustInclude: expect.subIncludes || null, consoleErrors: consoleErrors.length }
  };
}

(async () => {
  const browser = await launch({ headless: true });
  const results = [];
  try {
    // 1. The reported bug: slow 30d, then fast Today. Today must win.
    results.push(await scenario(browser, 'late 30d does not overwrite newer Today',
      [{ phase: 'slow', range: '30d', thenWaitMs: 120 }, { phase: 'fast', range: 'today', thenWaitMs: 0 }],
      { value: '10', subIncludes: 'today', chip: 'today' }));

    // 2. Reverse order: slow Today, then fast 30d. 30d must win.
    results.push(await scenario(browser, 'late Today does not overwrite newer 30d',
      [{ phase: 'slow', range: 'today', thenWaitMs: 120 }, { phase: 'fast', range: '30d', thenWaitMs: 0 }],
      { value: '300', subIncludes: 'last 30 days', chip: '30d' }));

    // 3. Stale request that REJECTS late must not flip the card to Unavailable.
    results.push(await scenario(browser, 'late-failing stale request does not flip card to Unavailable',
      [{ phase: 'slow-fail', range: '30d', thenWaitMs: 120 }, { phase: 'fast', range: 'today', thenWaitMs: 0 }],
      { value: '10', subIncludes: 'today', chip: 'today' }));

    // 4. Control: a genuine outage on the CURRENT request still shows Unavailable.
    results.push(await scenario(browser, 'current request failing still shows Unavailable',
      [{ phase: 'fast-fail', range: '7d', thenWaitMs: 0 }],
      { value: 'Unavailable', subIncludes: null, chip: '7d' }));
  } finally {
    await browser.close();
  }

  const allPass = results.every((r) => r.pass);
  for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + '  ' + JSON.stringify(r.detail));
  console.log('\nRACE TESTS: ' + results.filter((r) => r.pass).length + '/' + results.length + '  ALL PASS: ' + allPass);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), allPass, results }, null, 2));
  process.exitCode = allPass ? 0 : 1;
})();
