// Dashboard v2 ("Your desk") browser test. Offline: local static server, Firebase = rich stub (bt-rig.js).
//   node tools/tests/dash-desk-browser.js [shotsDir]     (run under the shared Chrome lock)
// Members: new (free, nothing saved), active (free, layouts + journal + progress), pro.
// Per member x device (390/412/1440) x theme: no horizontal overflow, <main> not inside aside.sidebar,
// no JS errors, every .dk-rv visible after the 1.5 s safety net, no skeleton left, cards non-empty.
// Plus: empty-state CTAs for new, Pro chip/card only for free, GEX+ opens/closes the paywall modal for free,
// a real touch test at 390 (tile taps, More menu), a 400px-step scroll with viewport shots.
const R = require('./bt-rig.js');
const fs = require('fs');
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

const scenario = (kind) => '(' + (function (kind) {
  const free = kind !== 'pro';
  const wrapDoc = (d, mod) => Object.assign({}, d, { get: () => d.get().then((s) => (s.exists ? { exists: true, id: s.id, data: () => mod(s.data()) } : s)) });
  const sc = window.__stubDb.collection;
  const empty = { forEach() {}, size: 0, empty: true, docs: [] };
  const snap = (rows) => ({ forEach: (f) => rows.forEach((r) => f({ id: r.id, data: () => r })), size: rows.length, empty: !rows.length, docs: rows.map((r) => ({ id: r.id, data: () => r })) });
  const day = (n) => { const d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); };
  const fix = (d) => { const sub = d.collection; d.collection = (n) => fixCol(sub(n), n); return d; };
  const fixCol = (c, key) => {
    if (key === 'students') {
      const doc = c.doc;
      c.doc = (id) => fix(wrapDoc(doc(id), (x) => {
        if (kind === 'new') return Object.assign({}, x, { plan: 'Starter', role: 'starter', completedLessons: [], completedChapters: [], streak: 0, currentStreak: 0 });
        if (kind === 'active') return Object.assign({}, x, { plan: 'Starter', role: 'starter', currentStreak: 5 });
        return x;
      }));
    }
    if (kind === 'new' && (key === 'journal' || key === 'replay' || key === 'chartLayouts')) c.get = () => Promise.resolve(empty);
    if (key === 'chartLayouts') {
      if (kind !== 'new') { const rows = [{ id: 'abcdefghij1234567890', name: 'NQ opening range', symbol: 'NQ1!', interval: '5', updatedAt: Date.now() - 36e5 }, { id: 'abcdefghij1234567891', name: 'ES levels', symbol: 'ES1!', interval: '15', updatedAt: Date.now() - 864e5 }]; c.get = () => Promise.resolve(snap(rows)); }
    }
    if (key === 'journal' && kind !== 'new') {
      const rows = [3, 2, 2, 1, 0].map((n, i) => ({ id: 'j' + i, date: day(n), time: '10:0' + i, pnl: [120, -60, 90, 40, -30][i] }));
      c.get = () => Promise.resolve(snap(rows));
    }
    return c;
  };
  window.__stubDb.collection = (path) => fixCol(sc(path), String(path).split('/').pop());
}).toString() + ')(' + JSON.stringify(kind) + ')';

const probe = () => {
  const q = (s) => document.querySelector(s);
  const hid = [...document.querySelectorAll('.dk-rv')].filter((e) => getComputedStyle(e).opacity < 0.99).length;
  return {
    docW: document.documentElement.scrollWidth, vw: innerWidth,
    mainInAside: !!q('aside.sidebar main'),
    mainAfterAside: (() => { const a = q('aside.sidebar'), m = q('main'); return !a || !m || !!(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(m); })(),
    hiddenRv: hid, skels: [...document.querySelectorAll('#dk-grid .dov-skel')].length,
    proCard: !!q('#dk-pro') && !q('#dk-pro').hidden, proChip: !!q('#dk-gex-pro') && !q('#dk-gex-pro').hidden,
    pill: (q('#dk-session-t') || {}).textContent, name: (q('#dash-first-name') || {}).textContent,
    ev: (q('#dk-ev') || {}).textContent, map: !!q('#dk-map .mv-tile'), lad: !!q('#dk-lad .mv-lad'),
    layouts: (q('#dk-layouts') || {}).textContent, journal: (q('#dk-journal') || {}).textContent, replay: (q('#dk-replay') || {}).textContent, floor: (q('#dk-floor') || {}).textContent,
    cr: (q('#dk-cr-a') || {}).textContent, ring: (q('#gp-ring-pct') || {}).textContent, segs: document.querySelectorAll('.gp-seg').length, doneSegs: document.querySelectorAll('.gp-seg.is-done').length, status: [...document.querySelectorAll('#dk-status li')].map((l) => l.className + ':' + l.textContent), wave: document.querySelectorAll('.dk-wv-i').length, breadth: !!q('#dk-breadth svg'), heat: document.querySelectorAll('.dk-heat span').length, slots: document.querySelectorAll('.dk-slot').length, lay: document.querySelectorAll('.dk-lay-c').length, dial: document.querySelectorAll('.dk-d-arc').length, cv: (() => { const c = q('#dk-cv'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })(), nextT: (q('#gp-next-t') || {}).textContent
  };
};

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const devs = [['phone', 390], ['phone412', 412], ['desktop', 1440]];
  try {
    for (const kind of ['new', 'active', 'pro']) {
      for (const [dev, w] of devs) {
        for (const theme of ['dark', 'light']) {
          const { ctx, p, errors } = await R.page(b, srv, dev, scenario(kind));
          // Fixture only: the committed feeds age out, so shift them to "now" to exercise the live (not stale) path.
          await ctx.route(/\/assets\/(econ-calendar|market-brief|market-map)\.json/, async (route) => {
            const res = await route.fetch(); const d = await res.json(); const delta = Date.now() - Date.parse(d.generatedAt);
            d.generatedAt = new Date().toISOString(); d.goodUntil = new Date(Date.now() + 864e5).toISOString();
            if (d.events) d.events.forEach((e) => { e.at = new Date(Date.parse(e.at) + delta).toISOString(); });
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
          });
          await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
          await p.goto(srv.base + '/dashboard-user.html', { waitUntil: 'domcontentloaded' });
          await p.waitForSelector('#dk-hero', { timeout: 15000 });
          await p.waitForTimeout(2600);
          const r = await p.evaluate(probe);
          const tag = `${kind} ${w} ${theme}`;
          check(r.docW <= r.vw, `${tag}: no horizontal overflow (${r.docW}/${r.vw})`);
          check(!r.mainInAside && r.mainAfterAside, `${tag}: <main> is not inside aside.sidebar`);
          check(r.hiddenRv === 0, `${tag}: no unrevealed card after 2.6s (${r.hiddenRv})`);
          check(r.skels === 0, `${tag}: no skeleton left (${r.skels})`);
          check(errors.length === 0, `${tag}: no JS errors ${errors.slice(0, 2).join(' | ')}`);
          check(!!r.pill && r.pill !== 'Market clock', `${tag}: session pill ticking ("${r.pill}")`);
          check(!!r.map && !!r.lad && /\d/.test(r.ev || ''), `${tag}: market pulse filled (map ${r.map}, ladders ${r.lad}, event "${(r.ev || '').slice(0, 40)}")`);
          if (kind === 'new') check(/Save your first layout/.test(r.layouts) && /Log your first trade/.test(r.journal) && /Start a replay/.test(r.replay), `${tag}: empty states with first actions`);
          if (kind === 'active') check(/Open/.test(r.layouts) && /trades? in the last 7 days/.test(r.journal), `${tag}: layouts + journal snapshot (${(r.journal || '').slice(0, 30)})`);
          check(r.segs > 10, `${tag}: segmented ring (${r.segs} segs, ${r.doneSegs} done)`);
          check(r.status.length === 3 && r.status.every((x) => /is-ok/.test(x)), `${tag}: system status strip all current (${r.status.join(' | ').slice(0, 120)})`);
          check(r.wave >= 3 && r.breadth && r.dial >= 6 && r.cv > 500, `${tag}: HUD parts drawn (wave ${r.wave}, breadth ${r.breadth}, dial arcs ${r.dial}, canvas px ${r.cv})`);
          if (kind === 'new') check(r.slots >= 3, `${tag}: ${r.slots} illustrated empty slots`);
          if (kind === 'active') check(r.heat === 7 && r.lay === 2, `${tag}: heat strip ${r.heat}, layout cards ${r.lay}`);
          check(kind === 'pro' ? !r.proCard : r.proCard, `${tag}: Pro card ${kind === 'pro' ? 'hidden' : 'shown'}`);
          check(/\$|€|£|\/mo|per month/.test(await p.evaluate(() => document.querySelector('#dk-grid').textContent + document.querySelector('#dk-hero').textContent)) === false, `${tag}: no price text on the desk`);
          if (OUT && theme) {
            // scroll through once so every count-up / draw-on has played before the full-page shot
            const H0 = await p.evaluate(() => document.documentElement.scrollHeight);
            for (let y = 0; y < H0; y += 500) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(120); }
            await p.waitForTimeout(1800); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
            await p.screenshot({ path: `${OUT}/${kind}-${w}-${theme}-full.png`, fullPage: true });
          }
          if (kind === 'active' && w === 390 && theme === 'dark') {
            // real scroll in 400px steps
            const H = await p.evaluate(() => document.documentElement.scrollHeight);
            for (let y = 0, i = 0; y < H; y += 400, i++) {
              await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(350);
              if (OUT) await p.screenshot({ path: `${OUT}/scroll-390-${String(i).padStart(2, '0')}.png` });
              const hid = await p.evaluate(() => [...document.querySelectorAll('.dk-rv')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).opacity < 0.99; }).length);
              check(hid === 0, `scroll y=${y}: no blank (unrevealed) card in view`);
            }
          }
          if (kind !== 'pro' && w === 390 && theme === 'dark') {
            // touch test
            await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
            await p.tap('#dk-gex'); await p.waitForTimeout(600);
            const open = await p.evaluate(() => !!document.querySelector('.plan-modal-overlay, .pm-overlay, [class*="plan-modal"]:not([hidden])') && [...document.querySelectorAll('[class*="plan-modal"],[id*="plan-modal"]')].some((e) => e.getBoundingClientRect().height > 50 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'));
            check(open, `${kind} 390 touch: GEX+ tap opens the paywall modal`);
            await p.keyboard.press('Escape'); await p.waitForTimeout(500);
            const closed = await p.evaluate(() => ![...document.querySelectorAll('[class*="plan-modal"],[id*="plan-modal"]')].some((e) => e.getBoundingClientRect().height > 50 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity > 0.5));
            check(closed, `${kind} 390 touch: paywall closes`);
            if (OUT) await p.screenshot({ path: `${OUT}/${kind}-390-after-paywall.png` });
            await p.tap('#appnav-more'); await p.waitForTimeout(500);
            const more = await p.evaluate(() => { const s = document.getElementById('appnav-sheet'); return !!s && s.getBoundingClientRect().height > 100 && getComputedStyle(s).visibility !== 'hidden'; });
            check(more, `${kind} 390 touch: More menu opens`);
            if (OUT) await p.screenshot({ path: `${OUT}/${kind}-390-more.png` });
            await p.keyboard.press('Escape');
            const hrefs = await p.evaluate(() => [...document.querySelectorAll('#dk-tiles .dk-tile')].map((a) => a.getAttribute('href')));
            check(hrefs.join() === 'charts.html,trade-journal.html,backtests.html,gex.html,scanner.html', `tile order: ${hrefs.join(', ')}`);
            const tall = await p.evaluate(() => [...document.querySelectorAll('#dk-tiles .dk-tile')].every((a) => a.getBoundingClientRect().height >= 44));
            check(tall, `${kind} 390: tiles >= 44px tall`);
          }
          await ctx.close();
        }
      }
    }
  } finally { await b.close(); srv.close(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
