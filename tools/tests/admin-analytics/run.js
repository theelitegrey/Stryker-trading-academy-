// Admin-analytics build harness: drives dashboard-admin.html through 4 stub
// fixture modes, captures screenshots, and writes ui-checks.json +
// network-raw.json.
//
// Run from tools/tests/admin-analytics/: node run.js
// Needs a local http.server on port 8000 serving the repo root (this script
// does not start one — the caller is expected to, same convention as the
// other suites' manual-run instructions in tools/tests/README.md).
const path = require('path');
const fs = require('fs');
const { launch, BASE } = require('../lib.js');
const stubMod = require('./stub.js');

const OUT_DIR = '/root/projects/stryker-notes/admin-analytics-build';
const SHOTS_DIR = path.join(OUT_DIR, 'shots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const REQUIRED_PANEL_IDS = [
  'admin-ai-panel', 'todo-panel', 'dash-notes-list', 'recent-students-list',
  'chapter-engagement', 'stat-students', 'stat-mrr', 'stat-completion', 'stat-sessions'
];

async function newCtx(browser, viewport, theme) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2,
    isMobile: viewport.width < 700, hasTouch: viewport.width < 700
  });
  if (theme === 'light') {
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  }
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => {
    // Allow nothing external through — the gstatic Firebase SDK scripts are
    // the only same-shape exception, and even those are pointless once
    // window.firebase is fully stubbed before they'd run; abort them all so
    // a real network call is unambiguous evidence of a bug, not noise.
    r.abort();
  });
  return ctx;
}

async function runMode(browser, mode) {
  const results = { mode, checks: [], networkBlocked: 0, screenshots: [] };
  const stubScript = stubMod.build(mode);

  // ---- 1440 dark full page ----
  {
    const ctx = await newCtx(browser, { width: 1440, height: 1000 }, 'dark');
    await ctx.addInitScript(stubScript);
    let blocked = 0;
    ctx.on('page', (p) => p.on('requestfailed', () => { blocked++; }));
    const p = await ctx.newPage();
    p.on('requestfailed', () => { blocked++; });
    await p.goto(BASE + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    // admin-guard.js's non-admin path has a hard-coded 4000ms setTimeout
    // fallback redirect (in case the toast promise never resolves); wait
    // past it rather than the default 2500ms used for the other modes.
    await p.waitForTimeout(mode === 'non-admin' ? 4600 : 2500);

    if (mode === 'non-admin') {
      const url = p.url();
      results.checks.push({ name: 'non-admin redirected', pass: /dashboard-user/.test(url), detail: url });
    } else {
      const layout = await p.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      results.checks.push({ name: mode + '-1440 no horizontal overflow', pass: layout.scrollWidth <= layout.clientWidth + 2, detail: layout });

      const panels = await p.evaluate((ids) => ids.map((id) => ({ id, present: !!document.getElementById(id) })), REQUIRED_PANEL_IDS);
      const missing = panels.filter((x) => !x.present);
      results.checks.push({ name: mode + '-1440 all existing panels present', pass: missing.length === 0, detail: missing });

      const overlap = await p.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.aa-card'));
        const rects = cards.map((c) => c.getBoundingClientRect());
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (overlapX > 2 && overlapY > 2) return true;
          }
        }
        return false;
      });
      results.checks.push({ name: mode + '-1440 no overlapping bento tiles', pass: !overlap });

      if (mode === 'failed' || mode === 'no-data') {
        const bareZero = await p.evaluate(() => {
          // aa-online-now is excluded: it is a live REST aggregation over the
          // presence collection, independent of adminStats/current existing.
          // An empty presence collection really does count to 0 — that is a
          // genuine answered-query zero per the "0 only when real" rule, not
          // a fake/default value, so it is correctly excluded from this check.
          const cards = Array.from(document.querySelectorAll('.aa-card .v'));
          return cards.some((el) => {
            if (el.querySelector('#aa-online-now')) return false;
            return el.textContent.trim() === '0';
          });
        });
        results.checks.push({ name: mode + ' no bare 0 in analytics tiles (excl. live online-now aggregate)', pass: !bareZero });
        // SE review: every snapshot-backed tile must show exactly the state
        // word for this mode (not "—", not 0, not blank), and so must the
        // legacy stat cards that now read the same snapshot.
        const want = mode === 'failed' ? 'Unavailable' : 'No data yet';
        const wrongState = await p.evaluate((w) => {
          const ids = ['aa-total-users', 'aa-new-range', 'aa-active-range', 'aa-paid-conv', 'aa-mrr', 'aa-completion',
                       'stat-students', 'stat-mrr', 'stat-completion'];
          return ids.map((id) => [id, (document.getElementById(id) || {}).textContent])
                    .filter(([, t]) => (t || '').trim() !== w);
        }, want);
        results.checks.push({ name: mode + ' snapshot tiles all read "' + want + '"', pass: wrongState.length === 0, detail: wrongState });
        const visits = await p.evaluate(() => ((document.querySelector('#aa-visits-body .v') || {}).textContent || ''));
        results.checks.push({ name: mode + ' visits tile reads "' + want + '"', pass: visits.trim() === want, detail: visits.trim() });
        if (mode === 'failed') {
          const online = await p.evaluate(() => (document.getElementById('aa-online-now') || {}).textContent || '');
          results.checks.push({ name: 'failed online-now reads "Unavailable"', pass: online.trim() === 'Unavailable', detail: online.trim() });
        }
      }
    }

    const shotPath = path.join(SHOTS_DIR, '1440-dark' + (mode === 'loaded' ? '' : '-' + mode) + '.png');
    if (mode === 'loaded') {
      await p.screenshot({ path: shotPath, fullPage: true });
      results.screenshots.push(shotPath);
    }
    await ctx.close();
    results.networkBlocked += blocked;
  }

  // Only capture the full screenshot matrix + fold + 390 checks for the
  // 'loaded', 'failed' and 'no-data' modes (non-admin only needs the
  // redirect assertion above).
  if (mode !== 'non-admin') {
    const combos = [
      { w: 1440, h: 1000, theme: 'dark', tag: '1440-dark', full: true },
      { w: 1440, h: 1000, theme: 'light', tag: '1440-light', full: true },
      { w: 390, h: 1200, theme: 'dark', tag: '390-dark', full: true },
      { w: 390, h: 1200, theme: 'light', tag: '390-light', full: true },
      { w: 390, h: 844, theme: 'dark', tag: '390-dark-fold', full: false },
      { w: 390, h: 844, theme: 'light', tag: '390-light-fold', full: false }
    ];
    for (const c of combos) {
      // Already did 1440-dark full above for loaded/failed/no-data checks;
      // still take its screenshot again here for consistent naming if not
      // 'loaded' (small extra cost, keeps the shot set uniform per mode).
      const ctx = await newCtx(browser, { width: c.w, height: c.h }, c.theme);
      await ctx.addInitScript(stubScript);
      let blocked = 0;
      const p = await ctx.newPage();
      p.on('requestfailed', () => { blocked++; });
      await p.goto(BASE + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForTimeout(2500);

      if (c.w === 390) {
        const bottoms = await p.evaluate(() => {
          function bottomOf(text) {
            const cards = Array.from(document.querySelectorAll('.aa-card .l'));
            const hit = cards.find((el) => el.textContent.trim() === text);
            if (!hit) return null;
            return hit.closest('.aa-card').getBoundingClientRect().bottom;
          }
          return { totalUsers: bottomOf('Total users'), onlineNow: bottomOf('Online now') };
        });
        results.checks.push({
          name: mode + '-' + c.tag + ' Total users + Online now bottom < 844',
          pass: (bottoms.totalUsers === null || bottoms.totalUsers < 844) && (bottoms.onlineNow === null || bottoms.onlineNow < 844),
          detail: bottoms
        });
        const layout = await p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        results.checks.push({ name: mode + '-' + c.tag + ' no horizontal overflow', pass: layout.scrollWidth <= layout.clientWidth + 2, detail: layout });
      }

      const fname = c.tag + (mode === 'loaded' ? '' : '-' + mode) + '.png';
      const shotPath = path.join(SHOTS_DIR, fname);
      // Skip re-saving 1440-dark loaded (already saved above); still save all others.
      if (!(c.tag === '1440-dark' && mode === 'loaded')) {
        await p.screenshot({ path: shotPath, fullPage: c.full });
        results.screenshots.push(shotPath);
      }
      await ctx.close();
      results.networkBlocked += blocked;
    }
  }

  return results;
}

async function recordNetworkRaw(browser, branchOrMain, mode) {
  // Records every Firestore-shaped call (collection + method + limit) the
  // page makes, by wrapping db.collection before the real page scripts run.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const calls = [];
  const stubScript = stubMod.build(mode);
  await ctx.addInitScript(stubScript);
  await ctx.addInitScript(() => {
    window.__calls = [];
    const origDb = () => window.__stubDb;
    // Wrap collection() after DOMContentLoaded's db assignment happens by
    // patching db.collection directly once it exists.
    Object.defineProperty(window, '__wrapReady', { value: true });
  });
  const p = await ctx.newPage();
  await p.exposeFunction('__record', (entry) => calls.push(entry));
  await p.addInitScript(() => {
    const origDefine = Object.defineProperty;
    let patched = false;
    const tryPatch = () => {
      if (patched || !window.db || !window.db.collection) return;
      patched = true;
      const origCollection = window.db.collection;
      window.db.collection = function (name) {
        const ref = origCollection.call(window.db, name);
        const record = (method, extra) => { try { window.__record({ collection: name, method, extra: extra || null }); } catch (e) {} };
        const wrap = (r) => {
          const origGet = r.get;
          if (origGet) r.get = function () { record('get'); return origGet.apply(r, arguments); };
          const origLimit = r.limit;
          if (origLimit) r.limit = function (n) { record('limit', n); return wrap(origLimit.call(r, n)); };
          const origOrderBy = r.orderBy;
          if (origOrderBy) r.orderBy = function () { record('orderBy'); return wrap(origOrderBy.apply(r, arguments)); };
          const origWhere = r.where;
          if (origWhere) r.where = function () { record('where'); return wrap(origWhere.apply(r, arguments)); };
          const origDoc = r.doc;
          if (origDoc) r.doc = function (id) { record('doc', id); return origDoc.call(r, id); };
          return r;
        };
        return wrap(ref);
      };
    };
    setInterval(tryPatch, 20);
  });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await p.goto(BASE + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(2500);
  await ctx.close();
  return calls;
}

(async () => {
  const browser = await launch({ headless: true });
  try {
    const uiChecks = { generatedAt: new Date().toISOString(), modes: [] };
    for (const mode of ['loaded', 'failed', 'no-data', 'non-admin']) {
      console.log('=== mode: ' + mode + ' ===');
      const r = await runMode(browser, mode);
      uiChecks.modes.push(r);
      r.checks.forEach((c) => console.log((c.pass ? 'PASS  ' : 'FAIL  ') + c.name));
    }

    const totalBlocked = uiChecks.modes.reduce((a, m) => a + m.networkBlocked, 0);
    uiChecks.totalNetworkRequestsBlocked = totalBlocked;
    uiChecks.allPass = uiChecks.modes.every((m) => m.checks.every((c) => c.pass));

    fs.writeFileSync(path.join(OUT_DIR, 'ui-checks.json'), JSON.stringify(uiChecks, null, 2));

    console.log('=== network-raw (branch, loaded mode) ===');
    const branchCalls = await recordNetworkRaw(browser, 'branch', 'loaded');
    fs.writeFileSync(path.join(OUT_DIR, 'network-raw.json'), JSON.stringify({
      branch: branchCalls,
      note: 'main comparison recorded separately from the pre-build main checkout; see handback for the students.get() unbounded call it makes.'
    }, null, 2));

    console.log('\nALL PASS: ' + uiChecks.allPass);
    console.log('TOTAL NETWORK BLOCKED: ' + totalBlocked);
    process.exitCode = uiChecks.allPass ? 0 : 1;
  } finally {
    await browser.close();
  }
})();
